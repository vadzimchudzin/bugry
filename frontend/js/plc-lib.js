/* Комбикормовый завод «Бугры» — библиотека функциональных блоков ПЛК.
   Каждый блок перенесён из проекта Machine Expert «Bugry» (LD), расшифровка —
   docs/plc/<имя блока>.txt. Порядок цепей сохранён: он определяет, какие
   значения видны внутри одного цикла. Время — в секундах.

   Общие для всех блоков глобальные переменные проекта передаются в G:
   GEmer (общая авария), ResetErrors (сброс аварий), MGod (наладка),
   MAuto (не ручной режим). MEmul (эмуляция ПЛК) здесь всегда FALSE —
   эмулятором служит модель установки. */

(function (global) {
  "use strict";

  /* ------------------------------------------------ стандартные блоки IEC */
  const TON = () => ({ et: 0, q: false });
  function ton(t, IN, pt, dt) {
    if (!IN) { t.et = 0; t.q = false; return false; }
    t.et = Math.min(pt, t.et + dt);
    t.q = t.et >= pt;
    return t.q;
  }
  const TOF = () => ({ et: 0, q: false });
  function tof(t, IN, pt, dt) {
    if (IN) { t.q = true; t.et = 0; }
    else if (t.q) { t.et += dt; if (t.et >= pt) t.q = false; }
    return t.q;
  }
  const TP = () => ({ et: 0, q: false, prev: false });
  function tp(t, IN, pt, dt) {
    if (!t.q && IN && !t.prev) { t.q = true; t.et = 0; }
    if (t.q) { t.et += dt; if (t.et >= pt) t.q = false; }
    t.prev = IN;
    return t.q;
  }
  // Контакты LD с фронтом: память у каждого экземпляра блока.
  function rtrig(o, key, v) { const r = !!v && !o[key]; o[key] = !!v; return r; }
  function ftrig(o, key, v) { const r = !v && !!o[key]; o[key] = !!v; return r; }

  // MHCalc — наработка в часах (MH) и общая (aMH).
  function mhcalc(fb, run, dt) { if (run) { fb.mh += dt / 3600; fb.amh += dt / 3600; } }

  const stateOf = (fb) => (fb.da ? 2 : fb.run ? 1 : 0);

  /* ------------------------------------------------ FUNCTION_BLOCK Noria */
  // Нории. ДКС должен «моргать» (импульсы метки на валу): постоянный сигнал
  // 3 с — авария. ДСЛ: постоянный сигнал 4 с или более 40 импульсов за 4 с.
  function newNoria() {
    return { kind: "noria", ton_dks_on: TON(), ton_dks_off: TON(), ton_dsl1: TON(), ton_dsl2: TON(),
      blink: 0, cntDsl1: 0, cntDsl2: 0, ton_on: TON(), ton_off: TON(), ton_lpusk: TON(), couPusk: 0,
      errAZ: false, errDKS: false, errDP: false, errDSL1: false, errDSL2: false,
      rr: false, da: false, run: false, run_auto: false, mh: 0, amh: 0, state: 0 };
  }
  function noria(fb, I, dt, G) {
    ton(fb.ton_dks_on, fb.run && I.dks, 3, dt);
    ton(fb.ton_dks_off, fb.run && !I.dks, 3, dt);
    if (I.AZ) fb.errAZ = true;
    if ((fb.ton_dks_on.q || fb.ton_dks_off.q) && !I.off_dks) fb.errDKS = true;
    if (I.dp && !I.off_dp) fb.errDP = true;
    if (ton(fb.ton_dsl1, fb.run && !I.off_dsl1 && I.dsl1, 4, dt)) fb.errDSL1 = true;
    if (ton(fb.ton_dsl2, fb.run && !I.off_dsl2 && I.dsl2, 4, dt)) fb.errDSL2 = true;
    // BLINK_ClrCounter: раз в 4 с счётчики импульсов ДСЛ обнуляются
    if (fb.run) { fb.blink += dt; if (fb.blink >= 4) { fb.blink = 0; fb.cntDsl1 = 0; fb.cntDsl2 = 0; } } else fb.blink = 0;
    if (fb.run && !I.off_dsl1 && rtrig(fb, "_rd1", I.dsl1)) { fb.cntDsl1++; if (fb.cntDsl1 > 40) fb.errDSL1 = true; }
    if (fb.run && !I.off_dsl2 && rtrig(fb, "_rd2", I.dsl2)) { fb.cntDsl2++; if (fb.cntDsl2 > 40) fb.errDSL2 = true; }
    if (G.ResetErrors) { fb.errDKS = fb.errDP = fb.errDSL1 = fb.errDSL2 = fb.errAZ = false; }
    const ok = !fb.errAZ && !fb.errDKS && !fb.errDSL1 && !fb.errDSL2 && !fb.errDP;
    fb.rr = ok && !G.GEmer && !I.localStop;
    fb.da = !ok;
    if (I.canRunAuto && I.SlowHand && rtrig(fb, "_rh", I.HandMode)) I.io.yRun = fb.run;
    if (I.canRunAuto && I.SlowHand && ftrig(fb, "_fh", I.HandMode)) fb.run_auto = I.io.yRun;
    if (ton(fb.ton_on, I.canRunAuto && fb.rr && I.next, I.timeBeforeStart, dt)) fb.run_auto = true;
    ton(fb.ton_off, !I.canRunAuto && !I.prev, I.timeToStop, dt);
    if (fb.ton_off.q || !fb.rr || !I.next) fb.run_auto = false;
    if ((!I.next && !G.MGod) || !fb.rr || I.localStop || !I.HandMode) I.io.yRun = false;
    localTriple(fb, I, dt, G);
    fb.run = ((!I.HandMode && fb.run_auto) || (I.HandMode && I.localPusk) || I.io.yRun) && !I.localStop && fb.rr;
    mhcalc(fb, fb.run, dt);
    fb.state = stateOf(fb);
  }
  // «Включение ручного пуска после 3-кратного нажатия местного пуска» (только в наладке)
  function localTriple(fb, I, dt, G) {
    if (rtrig(fb, "_rlp", I.localPusk) && I.HandMode && G.MGod) {
      fb.couPusk++;
      if (fb.couPusk >= 2) { fb.couPusk = 0; I.io.yRun = true; }
    }
    ton(fb.ton_lpusk, !I.localPusk, 2, dt);
    if (I.localStop || !I.HandMode || fb.ton_lpusk.q) fb.couPusk = 0;
  }

  /* ------------------------------------------------ FUNCTION_BLOCK Transporter */
  // Шнековые и скребковые конвейеры. ДКС: dksMustBlink — импульсный датчик
  // (иначе 1 — норма); контроль начинается через timedks после пуска.
  // ДП — авария, пока сигнал держится (TOF 2 с), сама снимается.
  function newTransporter() {
    return { kind: "transporter", delayDks: TON(), t_dks_on: TON(), t_dks_off: TON(), tof_dp: TOF(),
      ton_start: TON(), ton_stop: TON(), ton_lpusk: TON(), couPusk: 0, maxDks: 0,
      err_AZ: false, err_DKS: false, err_DP: false, rr: false, da: false, run: false, run_auto: false,
      isEmpty: false, mh: 0, amh: 0, state: 0 };
  }
  function transporter(fb, I, dt, G) {
    const td = I.timedks || 4;
    ton(fb.delayDks, fb.run, td, dt);
    ton(fb.t_dks_on, fb.delayDks.q && I.dks, td, dt);
    ton(fb.t_dks_off, fb.delayDks.q && !I.dks, td, dt);
    fb.maxDks = Math.max(fb.maxDks, fb.t_dks_on.et, fb.t_dks_off.et);
    if (I.errAZ) fb.err_AZ = true;
    const mustBlink = I.dksMustBlink !== false;
    if ((((fb.t_dks_on.q || fb.t_dks_off.q) && mustBlink) || (fb.t_dks_off.q && !mustBlink)) && fb.run && !I.DKS_off) fb.err_DKS = true;
    fb.err_DP = tof(fb.tof_dp, !!I.DP, 2, dt) && !I.DP_off;
    if (G.ResetErrors) { fb.err_AZ = false; fb.err_DP = false; fb.err_DKS = false; }
    const ok = !fb.err_DKS && !fb.err_DP && !fb.err_AZ;
    fb.rr = ok && !G.GEmer && !I.localStop;
    fb.da = !ok;
    if (I.SlowHand && rtrig(fb, "_rh", I.HandMode)) I.io.yRun = fb.run;
    if (I.SlowHand && ftrig(fb, "_fh", I.HandMode)) fb.run_auto = I.io.yRun;
    localTriple(fb, I, dt, G);
    if (ton(fb.ton_start, I.canRunAuto && fb.rr && I.next, I.timeBeforeStart, dt)) { fb.isEmpty = false; fb.run_auto = true; }
    if (ton(fb.ton_stop, !I.canRunAuto && !I.prev, I.timeToStop, dt)) fb.isEmpty = true;
    if (fb.isEmpty || !fb.rr || !I.next) fb.run_auto = false;
    if ((!I.next && !G.MGod) || !fb.rr || I.localStop || !I.HandMode) I.io.yRun = false;
    fb.run = ((!I.HandMode && fb.run_auto) || (I.HandMode && I.localPusk) || I.io.yRun) && !I.localStop && fb.rr;
    if (fb.run) fb.isEmpty = false;
    mhcalc(fb, fb.run, dt);
    fb.state = stateOf(fb);
  }

  /* ------------------------------------------------ FUNCTION_BLOCK ReverseTransporter */
  // Реверсивный шнек 10500: подача влево (10600) или вправо (10700).
  // Два ДП — на концах, ДКС — общий. Направление нельзя сменить на ходу.
  function newReverse() {
    return { kind: "reverse", delayDks: TON(), t_dks_on: TON(), t_dks_off: TON(), tof_dp1: TOF(), tof_dp2: TOF(),
      ton_startL: TON(), ton_startR: TON(), ton_stop: TON(),
      err_AZ: false, err_DKS: false, err_DP: false, rr: false, da: false,
      runL: false, runR: false, run: false, autoL: false, autoR: false, mh: 0, amh: 0, state: 0 };
  }
  function reverseTr(fb, I, dt, G) {
    ton(fb.delayDks, fb.run, 4, dt);
    ton(fb.t_dks_on, fb.delayDks.q && I.dks, 4, dt);
    ton(fb.t_dks_off, fb.delayDks.q && !I.dks, 4, dt);
    if (I.errAZ) fb.err_AZ = true;
    if (fb.t_dks_off.q && fb.run && !I.DKS_off) fb.err_DKS = true;
    const dp1 = tof(fb.tof_dp1, !!I.DP1, 2, dt) && !I.DP1_off, dp2 = tof(fb.tof_dp2, !!I.DP2, 2, dt) && !I.DP2_off;
    fb.err_DP = dp1 || dp2;
    if (G.ResetErrors) { fb.err_AZ = false; fb.err_DKS = false; }
    const ok = !fb.err_DKS && !fb.err_DP && !fb.err_AZ;
    fb.rr = ok && !G.GEmer && !I.localStop;
    fb.da = !ok;
    if (ton(fb.ton_startL, I.canRunAutoLeft && fb.rr && I.next_left && !fb.runR, I.timeBeforeStart, dt)) fb.autoL = true;
    if (ton(fb.ton_startR, I.canRunAutoRight && fb.rr && I.next_right && !fb.runL, I.timeBeforeStart, dt)) fb.autoR = true;
    ton(fb.ton_stop, !I.canRunAutoLeft && !I.canRunAutoRight && !I.prev, I.timeToStop, dt);
    if (fb.ton_stop.q || !fb.rr || !I.next_left || (!I.canRunAutoLeft && !I.prev && fb.ton_stop.q)) fb.autoL = false;
    if (fb.ton_stop.q || !fb.rr || !I.next_right) fb.autoR = false;
    if (!fb.rr || !I.HandMode || (I.io.yRunLeft && I.io.yRunRight)) { I.io.yRunLeft = false; I.io.yRunRight = false; }
    if (!I.next_left && !G.MGod) I.io.yRunLeft = false;
    if (!I.next_right && !G.MGod) I.io.yRunRight = false;
    fb.runL = fb.rr && !I.localStop && ((!I.HandMode && fb.autoL) || I.io.yRunLeft) && !fb.runR;
    fb.runR = fb.rr && !I.localStop && ((!I.HandMode && fb.autoR) || I.io.yRunRight) && !fb.runL;
    fb.run = fb.runL || fb.runR;
    mhcalc(fb, fb.run, dt);
    fb.state = stateOf(fb);
  }

  /* ------------------------------------------------ FUNCTION_BLOCK Mehanizm / Scalperator / Drobilka */
  // Скальператор, дробилки, смеситель, вентиляторы: без датчиков движения.
  function newMeh(kind) {
    return { kind: kind || "meh", ton_on: TON(), ton_off: TON(), errAZ: false, errPCH: false, errDoor: false,
      rr: false, da: false, run: false, run_auto: false, mh: 0, amh: 0, state: 0 };
  }
  function mehanizm(fb, I, dt, G) {
    if (I.AZ) fb.errAZ = true;
    if (I.ErrPCH) fb.errPCH = true;
    if (I.Door && !I.OffDoor) fb.errDoor = true;
    if (G.ResetErrors) { fb.errAZ = false; fb.errPCH = false; fb.errDoor = false; }
    const ok = !fb.errAZ && !fb.errPCH && !fb.errDoor;
    fb.rr = ok && !G.GEmer && !I.localStop;
    fb.da = !ok;
    if (I.canRunAuto && I.SlowHand && rtrig(fb, "_rh", I.HandMode)) I.io.yRun = fb.run;
    if (I.canRunAuto && I.SlowHand && ftrig(fb, "_fh", I.HandMode)) fb.run_auto = I.io.yRun;
    if (ton(fb.ton_on, I.canRunAuto && fb.rr && I.next, I.timeBeforeStart, dt)) fb.run_auto = true;
    ton(fb.ton_off, !I.canRunAuto && !I.prev, I.timeToStop, dt);
    if (fb.ton_off.q || !fb.rr || !I.next) fb.run_auto = false;
    if ((!I.next && !G.MGod) || !fb.rr || !I.HandMode) I.io.yRun = false;
    fb.run = ((!I.HandMode && fb.run_auto) || I.io.yRun) && fb.rr;
    mhcalc(fb, fb.run, dt);
    fb.state = stateOf(fb);
  }

  /* ------------------------------------------------ FUNCTION_BLOCK Zatvor (шлюзовый затвор) */
  function newZatvor() {
    return { kind: "zatvor", t_dks_on: TON(), t_dks_off: TON(), ton_start: TON(), ton_stop: TON(),
      err_AZ: false, err_DKS: false, rr: false, da: false, run: false, run_auto: false, mh: 0, amh: 0, state: 0 };
  }
  function zatvor(fb, I, dt, G) {
    ton(fb.t_dks_on, fb.run && I.dks, 4, dt);
    ton(fb.t_dks_off, fb.run && !I.dks, 4, dt);
    if (I.errAZ) fb.err_AZ = true;
    if ((fb.t_dks_on.q || fb.t_dks_off.q) && !I.DKS_off) fb.err_DKS = true;
    if (G.ResetErrors) { fb.err_AZ = false; fb.err_DKS = false; }
    const ok = !fb.err_DKS && !fb.err_AZ;
    fb.rr = ok && !G.GEmer;
    fb.da = !ok;
    if (I.canRunAuto && I.SlowHand && rtrig(fb, "_rh", I.HandMode)) I.io.yRun = fb.run;
    if (I.canRunAuto && I.SlowHand && ftrig(fb, "_fh", I.HandMode)) fb.run_auto = I.io.yRun;
    if (ton(fb.ton_start, I.canRunAuto && fb.rr && I.next, I.timeBeforeStart, dt)) fb.run_auto = true;
    ton(fb.ton_stop, !I.canRunAuto && !I.prev, I.timeToStop, dt);
    if (fb.ton_stop.q || !fb.rr || !I.next) fb.run_auto = false;
    if ((!I.next && !G.MGod) || !fb.rr || !I.HandMode) I.io.yRun = false;
    fb.run = (!I.HandMode && fb.run_auto) || I.io.yRun;
    mhcalc(fb, fb.run, dt);
    fb.state = stateOf(fb);
  }

  /* ------------------------------------------------ FUNCTION_BLOCK AutoShiber */
  // Шибер с электроприводом и двумя концевиками. Долгое переключение
  // (maxTTO) и оба концевика сразу (1 с, кроме наладки) — аварии.
  function newShiber() {
    return { kind: "shiber", ton_lt: TON(), ton_konc: TON(), errLT: false, errKonc: false, errAZOut: false,
      rr: false, da: false, runToOpen: false, runToClose: false, mh: 0, amh: 0, state: 0 };
  }
  function autoShiber(fb, I, dt, G) {
    if (ton(fb.ton_lt, (fb.runToOpen && !I.opened) || (fb.runToClose && !I.closed), I.maxTTO || 10, dt)) fb.errLT = true;
    if (ton(fb.ton_konc, !G.MGod && I.opened && I.closed, 1, dt)) fb.errKonc = true;
    if (I.errAZ) fb.errAZOut = true;
    if (G.ResetErrors) { fb.errAZOut = false; fb.errLT = false; fb.errKonc = false; }
    fb.rr = !I.errAZ && !fb.errLT && !fb.errKonc && !G.GEmer;
    fb.da = !(!I.errAZ && !fb.errLT && !fb.errKonc);
    const io = I.io;
    if (I.opened || rtrig(fb, "_rc", io.yClose)) io.yOpen = false;
    if (I.closed || rtrig(fb, "_ro", io.yOpen)) io.yClose = false;
    if (!I.HandMode || !fb.rr || (io.yOpen && io.yClose)) { io.yOpen = false; io.yClose = false; }
    fb.runToOpen = ((fb.rr && io.yOpen) || (fb.rr && !I.HandMode && I.toOpen)) && !fb.runToClose && !I.opened;
    fb.runToClose = ((fb.rr && io.yClose) || (fb.rr && !I.HandMode && I.toClose)) && !fb.runToOpen && !I.closed;
    mhcalc(fb, fb.runToOpen || fb.runToClose, dt);
    fb.state = fb.da ? 4 : I.closed ? 0 : I.opened ? 1 : (fb.runToOpen || fb.runToClose) ? 3 : 2;
  }

  /* ------------------------------------------------ FUNCTION_BLOCK DVPT / PP */
  // Двухпоточник 10210 и переключатели потока ППМ-2.200 (40910, 40960, 51110).
  function newDvpt() {
    return { kind: "dvpt", ton_lt: TON(), ton_konc: TON(), errLT: false, errKonc: false, errAZOut: false,
      rr: false, da: false, runToPos1: false, runToPos2: false, mh: 0, amh: 0, state: 0 };
  }
  function dvpt(fb, I, dt, G) {
    if (ton(fb.ton_lt, (fb.runToPos1 && !I.curPos1) || (fb.runToPos2 && !I.curPos2), I.maxTTO || 10, dt)) fb.errLT = true;
    if (ton(fb.ton_konc, I.curPos1 && I.curPos2, 1, dt)) fb.errKonc = true;
    if (I.errAZ) fb.errAZOut = true;
    if (G.ResetErrors) { fb.errAZOut = false; fb.errKonc = false; fb.errLT = false; }
    const ok = !fb.errAZOut && !fb.errLT && !fb.errKonc;
    fb.rr = ok && !G.GEmer;
    fb.da = !ok;
    const io = I.io;
    if (I.curPos1 || rtrig(fb, "_r2", io.yRun2)) io.yRun1 = false;
    if (I.curPos2 || rtrig(fb, "_r1", io.yRun1)) io.yRun2 = false;
    if (!I.HandMode || !fb.rr || (io.yRun1 && io.yRun2)) { io.yRun1 = false; io.yRun2 = false; }
    const t1 = ((fb.rr && !I.HandMode && I.toPos1) || (fb.rr && io.yRun1)) && !I.curPos1;
    const t2 = ((fb.rr && !I.HandMode && I.toPos2) || (fb.rr && io.yRun2)) && !I.curPos2;
    if (t1) { fb.runToPos1 = true; fb.runToPos2 = false; }
    if (t2) { fb.runToPos1 = false; fb.runToPos2 = true; }
    if (fb.da) { fb.runToPos1 = false; fb.runToPos2 = false; }
    // привод отключается, когда концевик достигнут (так ведёт себя пускатель ППМ)
    if (fb.runToPos1 && I.curPos1) fb.runToPos1 = false;
    if (fb.runToPos2 && I.curPos2) fb.runToPos2 = false;
    mhcalc(fb, fb.runToPos1 || fb.runToPos2, dt);
    fb.state = fb.da ? 3 : (fb.runToPos1 || fb.runToPos2) && !I.curPos1 && !I.curPos2 ? 2 : I.curPos2 ? 1 : 0;
  }

  /* ------------------------------------------------ FUNCTION_BLOCK DualShiber (KlapSMS, ShiberDownSms) */
  // Пневмозаслонки смесителя: катушка «открыть», пружинный возврат.
  function newKlap() {
    return { kind: "klap", ton_lto: TON(), ton_ltc: TON(), ton_konc: TON(), errLTOpen: false, errLTClose: false,
      errKonc: false, rr: false, da: false, runToOpen: false, mh: 0, amh: 0, state: 0 };
  }
  function klap(fb, I, dt, G) {
    if (ton(fb.ton_lto, fb.runToOpen && !I.opened, I.maxTTO || 10, dt)) fb.errLTOpen = true;
    if (ton(fb.ton_ltc, !fb.runToOpen && !I.closed, I.maxTTO || 10, dt)) fb.errLTClose = true;
    if (ton(fb.ton_konc, I.opened && I.closed, 1, dt)) fb.errKonc = true;
    if (G.ResetErrors) { fb.errLTOpen = false; fb.errLTClose = false; fb.errKonc = false; }
    const ok = !fb.errLTOpen && !fb.errLTClose && !fb.errKonc;
    fb.rr = ok && !G.GEmer && !I.lowPress;
    fb.da = !ok;
    if (!I.HandMode || !fb.rr) I.io.yOpen = false;
    fb.runToOpen = fb.rr && !I.noOpen && ((!I.HandMode && I.toOpen) || (I.HandMode && I.io.yOpen));
    mhcalc(fb, fb.runToOpen, dt);
    fb.state = fb.da ? 4 : I.closed ? 0 : I.opened ? 1 : 3;
  }

  /* ------------------------------------------------ FUNCTION_BLOCK TVibrator */
  function newVibrator() { return { kind: "vibr", ton0: TON(), ton1: TON(), tonMax: TON(), ErrAZ: false, run: false, da: false, mh: 0, amh: 0 }; }
  function vibrator(fb, I, dt, G) {
    const arun = I.RunAuto && !fb.ton0.q;
    ton(fb.ton0, I.RunAuto && !fb.ton1.q, I.TimeAutoRun, dt);
    ton(fb.ton1, I.RunAuto && fb.ton0.q, I.TimeAutoSleep, dt);
    if (I.RunAuto) I.io.yRun = false;
    if (I.AZ) { I.io.yRun = false; fb.ErrAZ = true; }
    if (G.ResetErrors) fb.ErrAZ = false;
    if (ton(fb.tonMax, I.io.yRun, I.MaxTimeOn, dt)) I.io.yRun = false;
    fb.run = (arun || I.io.yRun) && !G.GEmer && !fb.ErrAZ;
    fb.da = fb.ErrAZ;
    mhcalc(fb, fb.run, dt);
  }

  /* ------------------------------------------------ FUNCTION_BLOCK TAsp2 (аспирация: вентилятор + шлюз) */
  // Вентилятор запускается первым, шлюзовый затвор — после разгона (5 с);
  // при остановке шлюз работает ещё TTS, чтобы выгрузить циклон.
  function newAsp() {
    return { kind: "asp", ton_fan: TON(), tof_gw: TOF(), t_dks_on: TON(), t_dks_off: TON(),
      errAZ: false, errAZGw: false, errDKS: false, rr: false, da: false, run: false, runGw: false,
      mh: 0, amh: 0, mhGw: 0, amhGw: 0, state: 0 };
  }
  function asp(fb, I, dt, G) {
    if (I.Az) fb.errAZ = true;
    if (I.AzGway) fb.errAZGw = true;
    ton(fb.t_dks_on, fb.runGw && I.dks, 4, dt);
    ton(fb.t_dks_off, fb.runGw && !I.dks, 4, dt);
    if ((fb.t_dks_on.q || fb.t_dks_off.q) && !I.offDks) fb.errDKS = true;
    if (G.ResetErrors) { fb.errAZ = false; fb.errAZGw = false; fb.errDKS = false; }
    const ok = !fb.errAZ && !fb.errAZGw && !fb.errDKS;
    fb.rr = ok && !G.GEmer;
    fb.da = !ok;
    if (!I.HandMode || !fb.rr) { I.io.yRun = false; I.io.yRunGw = false; }
    const want = (!I.HandMode && (I.conditionToWork || I.prev)) || (I.HandMode && I.io.yRun);
    fb.run = fb.rr && want;
    const fanUp = ton(fb.ton_fan, fb.run, 5, dt);
    fb.runGw = fb.rr && !fb.errAZGw && (tof(fb.tof_gw, fanUp, I.TTS || 5, dt) || (I.HandMode && I.io.yRunGw));
    mhcalc(fb, fb.run, dt);
    if (fb.runGw) { fb.mhGw += dt / 3600; fb.amhGw += dt / 3600; }
    fb.state = stateOf(fb);
  }

  /* ------------------------------------------------ FUNCTION_BLOCK Dozator */
  // Шнековый дозатор с ПЧ: 4 скорости, переход по остатку до задания
  // (VesTo3/2/1, кг), затем ожидание успокоения веса и учёт выбега
  // («падающий столб»), который корректируется после каждой дозы.
  function newDozator() {
    return { kind: "dozator", phase: "idle", tSettle: TON(), t_dks: TON(), tof_dp: TOF(),
      errDP: false, errDKS: false, errPCH: false, da: false, run: false, done: false,
      speed: 0, freq: 0, vesDone: 0, vesStart: 0, noWeight: false, tNoWeight: TON(), mh: 0, amh: 0, state: 0 };
  }
  function dozator(fb, I, dt, G) {
    fb.errDP = fb.errDP || (tof(fb.tof_dp, !!I.DP, 2, dt) && !I.DP_off);
    if (I.errPCH) fb.errPCH = true;
    if (G.ResetErrors) { fb.errDP = false; fb.errDKS = false; fb.errPCH = false; }
    fb.da = fb.errDP || fb.errDKS || fb.errPCH;
    const ok = !fb.da && !G.GEmer;
    if (I.DONE_Reset) { fb.done = false; fb.phase = "idle"; fb.redose = false; }
    const rest = I.VesRequire - (I.Ves - I.VesStart);          // осталось досыпать, кг
    if (I.Cycle && fb.phase === "idle" && !fb.done && ok) { fb.phase = "dose"; fb.vesStart = I.VesStart; }
    if (!I.Cycle && fb.phase === "dose") fb.phase = "idle";
    if (fb.phase === "dose") {
      // при досыпке недовеса выбег не учитывается, работаем на 1-й скорости
      const stolb = fb.redose ? 0 : I.VesStolba || 0;
      if (rest - stolb <= 0) { fb.phase = "settle"; }
      else if (fb.redose || rest <= I.VesTo1) fb.speed = 1;
      else if (rest <= I.VesTo2) fb.speed = 2;
      else if (rest <= I.VesTo3) fb.speed = 3;
      else fb.speed = 4;
    }
    // нет прироста веса за 8 с работы шнека — бункер пуст или свод над шнеком
    if (fb.run && !I.Pause) {
      fb.nwT = (fb.nwT || 0) + dt;
      if (fb.nwT >= 8) { fb.noWeight = I.Ves - fb.nwV < (I.NoWeightKg || 0.05); fb.nwT = 0; fb.nwV = I.Ves; }
    } else { fb.nwT = 0; fb.nwV = I.Ves; if (fb.phase === "idle") fb.noWeight = false; }
    if (fb.phase === "settle") {
      fb.speed = 0;
      if (ton(fb.tSettle, true, I.DelayAfterDos || 3, dt)) {
        fb.tSettle.et = 0; fb.tSettle.q = false;
        const done = I.Ves - I.VesStart;
        const tol = Math.max(0.2, I.VesRequire * (I.DopPogr || 0.02));
        if (I.VesRequire - done > tol && I.Cycle) {
          if (!fb.redose) fb.firstDone = done;
          fb.phase = "dose"; fb.redose = true;                // большой недовес — досыпаем
        } else {
          // выбег («падающий столб») корректируется по первому взвешиванию:
          // недовес уменьшает его, перевес — увеличивает
          const first = fb.redose ? fb.firstDone : done;
          if (I.AutoStolb) I.io.VesStolba = Math.max(0, Math.min(15, (I.VesStolba || 0) + 0.5 * (first - I.VesRequire)));
          fb.vesDone = done; fb.done = true; fb.phase = "idle"; fb.redose = false;
        }
      }
    }
    const handRun = I.HandMode && I.MustHand && I.io.yHand;
    fb.run = ok && !I.Pause && ((fb.phase === "dose" && fb.speed > 0) || handRun);
    const spd = [0, I.SPEED_1, I.SPEED_2, I.SPEED_3, I.SPEED_4][fb.speed] || 0;
    fb.freq = fb.run ? (handRun ? I.FreqManual : (spd / 100) * I.Freq100Prc) : 0;
    ton(fb.t_dks, fb.run && !I.DKS && !I.DKS_off, 6, dt);
    if (fb.t_dks.q) fb.errDKS = true;
    mhcalc(fb, fb.run, dt);
    fb.state = fb.da ? 2 : I.Pause && fb.phase !== "idle" ? 3 : fb.run ? 1 : 0;
  }

  /* ------------------------------------------------ FUNCTION_BLOCK Ohladitel */
  // Охладитель гранул противоточный: стол (решётчатая заслонка) открывается
  // через интервал, зависящий от уровня (ДВУ/ДСУ/ДНУ); дверь, температура
  // воздуха. isEmpty — охладитель выгружен после остановки гранулятора.
  function newOhl() {
    return { kind: "ohl", timer: 0, ton_empty: TON(), ton_temp: TON(), ton_sbros: TON(), autoStol: false, step1: false,
      interval: 0, isEmpty: true, errDoor: false, errTemp: false, errDksStol: false,
      openStol: false, runStol: false, ready: false, mustEmpty: false, da: false, run: false };
  }
  function ohladitel(fb, I, dt, G) {
    if (G.ResetErrors) { fb.errDoor = false; fb.errTemp = false; fb.errDksStol = false; }
    if (I.Door && !I.OffOpenDoor) fb.errDoor = true;
    fb.mustEmpty = I.canRunAuto && !I.Prev && !I.HandMode && !fb.isEmpty;
    if (I.DNU || I.DSU || I.DVU || I.Prev) fb.isEmpty = false;
    if (ftrig(fb, "_fme", fb.mustEmpty) || rtrig(fb, "_rdnu", I.DNU)) fb.timer = 0;
    if (!I.DNU && fb.openStol && fb.runStol) fb.timer += dt;
    if (ton(fb.ton_empty, fb.mustEmpty && fb.timer >= 20 && I.Next, I.TimeClear || 30, dt)) fb.isEmpty = true;
    if (ton(fb.ton_temp, I.TempVozd >= I.MaxTempVozd, 5, dt)) fb.errTemp = true;
    const auto = (I.canRunAuto && !I.HandMode && !fb.isEmpty) || (I.HandMode && I.io.yRun);
    let vygr = false;
    if (auto && I.MustFree) { fb.interval = I.Interval0; vygr = true; }
    else if (auto && I.DVU) { fb.interval = I.Interval2; vygr = true; }
    else if (auto && I.DSU) { fb.interval = I.Interval1; vygr = true; }
    else if (I.HandMode && I.io.yRun) { fb.interval = I.IntervalH; vygr = true; }
    ton(fb.ton_sbros, !fb.autoStol && vygr, 600, dt);
    if (vygr && fb.ton_sbros.et * 1000 >= fb.interval) fb.autoStol = true;
    // стол качается до прихода метки ДКС стола (один ход «вперёд-назад»)
    if (fb.autoStol && !I.DksStol) fb.step1 = true;
    if (fb.autoStol && rtrig(fb, "_rdks", I.DksStol) && fb.step1) fb.autoStol = false;
    if (!fb.autoStol) fb.step1 = false;
    fb.openStol = (I.canRunAuto && I.MustFree) || I.io.yOpen;
    fb.runStol = fb.autoStol;
    fb.ready = (!fb.errDoor && !fb.errDksStol && !fb.errTemp && I.Next) || (!fb.errDoor && !fb.errDksStol && !fb.errTemp && G.MHand && G.MGod);
    fb.da = fb.errDoor || fb.errTemp || fb.errDksStol;
    fb.run = fb.runStol;
    fb.timeToOpen = vygr ? Math.max(0, Math.round(fb.interval / 1000 - fb.ton_sbros.et)) : 0;
  }

  /* ------------------------------------------------ PID (MyPID) */
  function newPid() { return { i: 0, prev: 0, out: 0 }; }
  function pid(p, sp, pv, kp, ti, td, lo, hi, dt) {
    const e = sp - pv;
    p.i = Math.max(lo, Math.min(hi, p.i + (ti > 0 ? (kp * e * dt) / ti : 0)));
    const d = td > 0 ? (kp * td * (e - p.prev)) / Math.max(dt, 1e-3) : 0;
    p.prev = e;
    p.out = Math.max(lo, Math.min(hi, kp * e + p.i + d));
    return p.out;
  }

  const api = {
    TON, ton, TOF, tof, TP, tp, rtrig, ftrig,
    newNoria, noria, newTransporter, transporter, newReverse, reverseTr, newMeh, mehanizm,
    newZatvor, zatvor, newShiber, autoShiber, newDvpt, dvpt, newKlap, klap,
    newVibrator, vibrator, newAsp, asp, newDozator, dozator, newOhl, ohladitel, newPid, pid,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.PLCLIB = api;
})(typeof window !== "undefined" ? window : globalThis);
