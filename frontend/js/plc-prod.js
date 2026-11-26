/* Комбикормовый завод «Бугры» — программы участков ПЛК:
   MainCycleLoad + PrgLoading      — загрузка сырьевых бункеров БВ (101–106);
   MainCycle1 + PrgDosingK/D/J1    — дозирование порций на больших и средних весах, УДЖК;
   PrgUnloadToSms                  — разгрузка весов, дробление, надсмесительный бункер;
   PrgSmesitel                     — смеситель: сухое и мокрое смешивание, выгрузка в ПСБ;
   PrgUnLoad + MainCycleUnload     — выгрузка готовой продукции в бункера 301–308;
   PrgGran + PrgUnLoadDop          — линия гранулирования, охладитель, просеиватель;
   PrgUnloadToCar                  — выгрузка из бункеров ГП в автомобили.
   Конвейер порций повторяет проект: пока одна порция смешивается, следующая
   дробится и поступает в НСБ, а на весах дозируется третья. */

(function (global) {
  "use strict";
  const L = global.PLCLIB || (typeof require !== "undefined" ? require("./plc-lib.js") : null);
  const { TON, ton, rtrig } = L;

  function create(P) {
    const { v, fbs, io, G } = P;
    const S = {
      queueLoad: [],             // очередь загрузки бункеров БВ
      loadMaterial: null,        // код загружаемого сырья
      programs: [],              // активированные программы производства
      jobs: [],                  // порции в работе
      kJob: null, dJob: null, upJob: null, mixJob: null, psbJob: null,
      kComp: 0, dComp: 0, kVesStart: 0, dVesStart: 0,
      unloadList: [],            // очередь бункеров ГП на выгрузку продукции
      unloadAll: false,
      events: [],                // сообщения для журнала (читает панель)
      jir: { phase: "idle", target: 0, start: 0, tryFail: false },
      t: {},
      msg: "Производство не запущено",
      seq: 1,
    };
    const T = (k) => (S.t[k] || (S.t[k] = TON()));
    const event = (text, kind) => { S.events.push({ text, kind: kind || "info" }); };
    const klapK = L.newShiber(), klapD = L.newShiber();
    const klapUp = L.newKlap(), klapDown = L.newKlap();
    const clapIn = L.newKlap(), clapOut = L.newKlap();
    Object.assign(fbs, { ZatvK: klapK, ZatvD: klapD, KlapSms: klapUp, ShDownSms: klapDown, ClapMasloIn: clapIn, ClapMasloOut: clapOut });
    ["ZatvK", "ZatvD", "KlapSms", "ShDownSms", "ClapMasloIn", "ClapMasloOut"].forEach((k) => { io[k] = io[k] || {}; v["fHand_" + k] = false; });

    /* ============================================================ ЗАГРУЗКА БВ */
    function loading(dt) {
      const cur = S.queueLoad[0] || 0;
      for (let b = 1; b <= 6; b++) v.LoadBunkK[b] = b === cur && !!v.Load1St0;
      if (v.Load1St0 && !cur) { v.Load1St0 = false; event("Загрузка БВ: очередь пуста — загрузка завершена"); }
      v.PolnBunkCur = ton(T("poln"), cur > 0 && !!v.DVU_BunkK[cur], 2, dt);
      // бункер заполнен: подача остановлена, ждём выгрузки тракта и переходим к следующему
      if (ton(T("change"), v.Load1St0 && (v.PolnBunkCur || v.NextLoadBunk) && !v.Go_TrHole, +v.tcNorHole + 8, dt) || (v.NextLoadBunk && !v.Load1St0)) {
        const done = S.queueLoad.shift();
        v.NextLoadBunk = false;
        if (done) event(`Загрузка БВ: бункер ${100 + done} — ${v.DVU_BunkK[done] ? "заполнен" : "переход к следующему"}`);
        v.ChangeLoadBunk = true;
        T("change").et = 0;
      }
      if (v.ChangeLoadBunk && ton(T("chg2"), true, 6, dt)) { v.ChangeLoadBunk = false; T("chg2").et = 0; }
      v.CanRunLoad = !!v.Load1St0 && !v.ChangeLoadBunk && !v.Load1St2;
      v.CanRunLoadL = v.CanRunLoad && (v.LoadBunkK[1] || v.LoadBunkK[2] || v.LoadBunkK[3]);
      v.CanRunLoadR = v.CanRunLoad && (v.LoadBunkK[4] || v.LoadBunkK[5] || v.LoadBunkK[6]);
      const K = v.LoadBunkK, DV = v.DVU_BunkK;
      const sel = (a, b, c, s1, s2) => (K[a] && v["Opened_" + s1]) || (K[b] && v["Closed_" + s1] && v["Opened_" + s2]) || (K[c] && v["Closed_" + s1] && v["Closed_" + s2]);
      const god = (a, b, c, s1, s2) => v.MGod || (!DV[a] && v["Opened_" + s1]) || (!DV[b] && v["Closed_" + s1] && v["Opened_" + s2]) || (!DV[c] && v["Closed_" + s1] && v["Closed_" + s2]);
      v.NextTr1L = !fbs.Tr1L.da && (sel(1, 2, 3, "ShL1", "ShL2") || (god(1, 2, 3, "ShL1", "ShL2") && !v.Load1St1));
      v.NextTr1R = !fbs.Tr1R.da && (sel(4, 5, 6, "ShR1", "ShR2") || (god(4, 5, 6, "ShR1", "ShR2") && !v.Load1St1));
      if (ton(T("cas1"), !!v.CloseAllSh1, 15, dt)) v.CloseAllSh1 = false;
    }

    /* ============================================================ ДОЗИРОВАНИЕ */
    const pp = () => S.programs.find((p) => p.status === "работает") || null;
    function newJob(p) {
      const n = p.issued + 1;
      const job = { id: S.seq++, pp: p, n, K: [], D: [], J: 0, total: p.portionKg,
        kUnloaded: false, dUnloaded: false, crushed: false, mixed: false, stage: "весы" };
      p.comps.forEach((c) => {
        const kg = +(p.portionKg * c.pct / 100).toFixed(2);
        if (c.place === "БВ") job.K.push({ bunk: c.bunk, code: c.code, name: c.name, req: kg, done: 0, status: "ожидает" });
        else if (c.place === "СВ") job.D.push({ bunk: c.bunk, code: c.code, name: c.name, req: kg, done: 0, status: "ожидает" });
        else if (c.place === "УДЖК") job.J += kg;
      });
      job.Jname = (p.comps.find((c) => c.place === "УДЖК") || {}).name || "";
      p.issued++;
      S.jobs.push(job);
      return job;
    }

    function scanDozators(dt, scale, job, idx, vesStartKey) {
      const list = scale === 1 ? job && job.K : job && job.D;
      P.DOZ.filter((z) => z.scale === scale).forEach((z) => {
        const comp = list && list[idx];
        const active = !!(comp && comp.bunk === z.bunk && v.RunDosing && !v["PauseDosing" + (scale === 1 ? "K" : "D")]);
        const fb = fbs[z.id], x = io[z.id];
        const prm = (P.dozParams && P.dozParams[z.bunk]) || {};
        L.dozator(fb, {
          DP: false, DP_off: true, DKS: true, DKS_off: true, errPCH: !!v["ErrPCH_Doz" + (scale === 1 ? "Komp" : "Dob")],
          Cycle: active, MustHand: true, VesStart: S[vesStartKey], Ves: scale === 1 ? +v.Ves1 || 0 : +v.Ves2 || 0,
          VesRequire: comp && active ? comp.req : 0, VesTo3: prm.to3 ?? (scale === 1 ? 30 : 3), VesTo2: prm.to2 ?? (scale === 1 ? 20 : 2),
          VesTo1: prm.to1 ?? (scale === 1 ? 10 : 1), Freq100Prc: 50, SPEED_4: prm.s4 ?? 100, SPEED_3: prm.s3 ?? 60, SPEED_2: prm.s2 ?? 40, SPEED_1: prm.s1 ?? 10,
          FreqManual: 25, AutoStolb: prm.auto !== false, DONE_Reset: !active && fb.done, Pause: !!v.MAutoPause,
          HandMode: v.MHand || !v.RunDosing || !!v["fHand_" + z.id], VesStolba: x.VesStolba, DelayAfterDos: v.UspVes[scale] || 2,
          DopPogr: 0.02, NoWeightKg: scale === 1 ? 1 : 0.1, io: { get yHand() { return !!x.yHand; }, set VesStolba(val) { x.VesStolba = val; } },
        }, dt, G);
        v["Go_Pusk_" + z.id] = fb.run;
        v["Freq_" + z.id] = fb.freq;
        v["noWeight" + z.id] = fb.noWeight;
        if (fb.noWeight && active && !x._nw) { event(`Бункер ${z.bunk}: нет прироста веса — сводообразование или бункер пуст`, "warn"); }
        x._nw = fb.noWeight && active;
      });
      v["Go_PCH_Doz" + (scale === 1 ? "Komp" : "Dob")] = P.DOZ.some((z) => z.scale === scale && fbs[z.id].run);
    }

    function dosing(dt) {
      // Regim2.9 — производство запущено со SCADA; через 20 с сирены — RunDosing (Regim2.10)
      if (v.Regim2_9 && !v.Regim2_10 && ton(T("runDos"), true, 20, dt)) { v.Regim2_10 = true; event("Производство: дозирование начато"); }
      if (!v.Regim2_9) T("runDos").et = 0;
      v.RunDosing = !!v.Regim2_10;
      v.StopDosing = v.Regim2_10 && !v.Regim2_9;
      const prog = pp();

      // ---------- большие весы (компоненты К, бункеры 101–106)
      if (v.RunDosing && !S.kJob && !S.dJob && prog && !v.StopDosing && prog.issued < prog.portions && !v.GEmer) {
        const inPipe = S.jobs.filter((j) => !j.kUnloaded).length;
        if (inPipe === 0) { S.kJob = newJob(prog); S.kComp = 0; S.kVesStart = +v.Ves1 || 0; S.dComp = 0; S.dVesStart = +v.Ves2 || 0;
          S.dJob = S.kJob; event(`ПП «${prog.name}»: порция ${S.kJob.n} из ${prog.portions} — дозирование`); }
      }
      const kj = S.kJob;
      if (kj && kj.K[S.kComp]) {
        const c = kj.K[S.kComp], z = P.DOZ.find((q) => q.bunk === c.bunk), fb = fbs[z.id];
        c.status = "дозируется"; c.done = Math.max(0, (+v.Ves1 || 0) - S.kVesStart);
        if (fb.done) { c.done = fb.vesDone; c.status = "сдозировано"; S.kComp++; S.kVesStart = +v.Ves1 || 0; }
      }
      scanDozators(dt, 1, kj, S.kComp, "kVesStart");
      const kDosed = !!kj && S.kComp >= kj.K.length;
      // разгрузка больших весов в наддробильный бункер — когда НСБ свободен для этой порции
      if (kDosed && !kj.kUnloaded && (S.upJob === null || S.upJob === kj) && !v.DVU_PBD && !v.PBDState0) {
        v.PBDState0 = true; v.PBDState1 = false; S.upJob = kj; v.SmsUpState1 = true; v.SmsUpState2 = kj.D.length === 0 ? false : v.SmsUpState2;
        kj.stage = "разгрузка весов"; event(`Порция ${kj.n}: разгрузка больших весов на дробление`);
      }
      L.tof(T("komp_tail2"), !!v.PBDState0, 25, dt);
      v.RunKomp = !!v.PBDState0 || T("komp_tail2").q;
      v.CanRunAutoK = v.RunKomp;
      const kOpen = v.PBDState0 && !v.PBDState1 && v.Go_TrKomp;
      L.autoShiber(klapK, { opened: !!v.Opened_ZatvK, closed: !!v.Closed_ZatvK, toOpen: kOpen, toClose: !kOpen, maxTTO: 6,
        errAZ: false, HandMode: v.MHand || !!v.fHand_ZatvK, io: io.ZatvK }, dt, G);
      v.Go_OpenZatvK = klapK.runToOpen; v.Go_CloseZatvK = klapK.runToClose;
      if (v.PBDState0 && !v.PBDState1 && v.Opened_ZatvK && ton(T("kEmpty"), (+v.Ves1 || 0) < v.DopOstBig, v.UspVes[1], dt)) {
        v.PBDState1 = true; T("kEmpty").et = 0;
      }
      if (v.PBDState1 && v.Closed_ZatvK && !v.Go_TrKomp) {
        v.PBDState0 = false; v.PBDState1 = false;
        if (kj) { kj.kUnloaded = true; kj.stage = "дробление"; S.kJob = null; }
      }
      v.ErrUnloadK = ton(T("kLong"), v.PBDState0 && !v.PBDState1, 240, dt);

      // ---------- средние весы (добавки, бункеры 201–208)
      const dj = S.dJob;
      if (dj && dj.D[S.dComp]) {
        const c = dj.D[S.dComp], z = P.DOZ.find((q) => q.bunk === c.bunk), fb = fbs[z.id];
        c.status = "дозируется"; c.done = Math.max(0, (+v.Ves2 || 0) - S.dVesStart);
        if (fb.done) { c.done = fb.vesDone; c.status = "сдозировано"; S.dComp++; S.dVesStart = +v.Ves2 || 0; }
      }
      scanDozators(dt, 2, dj, S.dComp, "dVesStart");
      v.DosingD_Done = !!dj && S.dComp >= dj.D.length && dj.D.length > 0 && !dj.dUnloaded;
      if (dj && dj.D.length === 0 && dj.kUnloaded) { dj.dUnloaded = true; S.dJob = null; }
      v.RunDob = v.RunDosing && v.DosingD_Done && S.upJob === dj;
      const dOpen = v.RunDob && v.SmsUpState1 && !v.SmsUpState2 && v.Go_TrDob;
      L.autoShiber(klapD, { opened: !!v.Opened_ZatvD, closed: !!v.Closed_ZatvD, toOpen: dOpen, toClose: !dOpen, maxTTO: 6,
        errAZ: false, HandMode: v.MHand || !!v.fHand_ZatvD, io: io.ZatvD }, dt, G);
      v.Go_OpenZatvD = klapD.runToOpen; v.Go_CloseZatvD = klapD.runToClose;
      if (dOpen && v.Opened_ZatvD && ton(T("dEmpty"), (+v.Ves2 || 0) < v.DopOstMid, v.UspVes[2], dt)) {
        v.SmsUpState2 = true; T("dEmpty").et = 0;
        if (dj) { dj.dUnloaded = true; S.dJob = null; event(`Порция ${dj.n}: добавки выгружены в НСБ`); }
      }

      // ---------- дробление (PrgUnloadToSms)
      const pbdHas = !!v.DNU_PBD || !!v.PBDState0;
      v.RunDrob = v.RunDosing && (pbdHas || S.jobs.some((j) => j.kUnloaded && !j.crushed));
      v.RunDrob1 = v.RunDrob && !!(v.UsedDrob & 1); v.RunDrob2 = v.RunDrob && !!(v.UsedDrob & 2);
      v.WorkPit = v.RunDosing && v.RunDrob;
      [1, 2].forEach((n) => {
        v["DrobIsRun" + n] = !!v["Go_Drob" + n] && !!v["DrobSpeedOK" + n];
        const tok = +v["TokDrob" + n] || 0;
        v["BlockDrob" + n] = tok > v["TokMax" + n] || !!v["fBlockDrob" + n];
        // ПИД питателя: держим ток дробилки около номинала
        const sp = v["TokNom" + n];
        const f = v["Go_Pit" + n] ? L.pid(P_misc.pit[n - 1], sp, tok, 0.18, 4, 0, 5, 50, dt) : (P_misc.pit[n - 1].i = 10, 0);
        v["FreqPit" + n] = P.handOf(P.DEF["Pit" + n]) ? +v["HandFreqPit" + n] || 25 : f;
      });
      const crushJob = S.jobs.find((j) => j.kUnloaded && !j.crushed);
      if (crushJob && ton(T("idleDrob"), !v.PBDState0 && (+v.MassPBD || 0) < 1 && (+v.MassCrush || 0) < 0.5, 10, dt)) {
        crushJob.crushed = true; crushJob.stage = "НСБ"; T("idleDrob").et = 0;
      }

      // ---------- надсмесительный бункер → смеситель (PrgSmesitel)
      const up = S.upJob;
      const upReady = !!up && up.kUnloaded && up.crushed && (up.dUnloaded || up.D.length === 0) &&
        ton(T("upIdle"), !v.Go_TrDrob && !v.Go_TrDob && (+v.FlowNor3 || 0) < 0.05, 6, dt);
      v.SmsUpState10 = upReady;
      if (upReady && !S.mixJob && v.Go_Sms && !v.MustKlapOpen) { v.MustKlapOpen = true; event(`Порция ${up.n}: загрузка смесителя из НСБ`); }
      L.klap(klapUp, { opened: !!v.KlapOpened, closed: !!v.KlapClosed, toOpen: !!v.MustKlapOpen && !!v.ZaslDownClosed, noOpen: !!fbs.Sms.errDoor,
        maxTTO: 10, HandMode: v.MHand || !v.RunDosing || !!v.fHand_KlapSms, io: io.KlapSms, lowPress: !!v.ErrLowPress }, dt, G);
      v.Go_Klap = klapUp.runToOpen;
      if (v.MustKlapOpen && v.KlapOpened && ton(T("vigr12"), !v.DNU_UpBunk, +v.tcSms1 || 20, dt)) {
        v.MustKlapOpen = false; T("vigr12").et = 0;
        if (up) { S.mixJob = up; S.upJob = null; up.stage = "смеситель"; }
        v.SmsUpState1 = false; v.SmsUpState2 = false;
        v.SmsMainState0 = true; v.SmsMainState1 = false; v.SmsMainState3 = false; v.SmsMainState13 = false;
        v.TimeZames1 = 0; v.TimeZames2 = 0;
        const p = S.mixJob ? S.mixJob.pp : null;
        v.TimeZames01 = p ? p.timeDry : 30; v.TimeZames02 = p ? p.timeWet : 180;
      }
      // таймеры смешивания идут только при вращении вала (Go_Sms), пауза — при остановке
      const mj = S.mixJob;
      if (v.SmsMainState0 && !v.SmsMainState1 && v.Go_Sms) v.TimeZames1 += dt;
      if (v.SmsMainState0 && !v.SmsMainState1 && v.TimeZames1 >= v.TimeZames01) {
        v.SmsMainState1 = true; if (mj) mj.stage = mj.J > 0 ? "ввод масла" : "мокрое смешивание";
        if (!mj || mj.J <= 0) v.SmsMainState13 = true;
      }
      jir(dt, mj);
      const mokr = v.SmsMainState0 && v.SmsMainState1 && v.SmsMainState13;
      if (mokr && !v.SmsMainState3 && v.Go_Sms) v.TimeZames2 += dt;
      if (mokr && !v.SmsMainState3 && v.TimeZames2 >= v.TimeZames02) { v.SmsMainState3 = true; if (mj) mj.stage = "готово к выгрузке"; }
      // выгрузка смесителя в ПСБ: ПСБ пуст и тракт выгрузки работает
      const pathReady = (v.Go_TrSms && (v.Opened_ShTrSms || v.Closed_ShTrSms)) && !v.DNU_DownBunk;
      if (v.SmsMainState3 && pathReady && !v.MustShOpen && !S.psbJob) { v.MustShOpen = true; if (mj) { mj.stage = "выгрузка в ПСБ"; S.psbJob = mj; } }
      L.klap(klapDown, { opened: !!v.ZaslDownOpened, closed: !!v.ZaslDownClosed, toOpen: !!v.MustShOpen, noOpen: false, maxTTO: 10,
        HandMode: v.MHand || !v.RunDosing || !!v.fHand_ShDownSms, io: io.ShDownSms, lowPress: !!v.ErrLowPress }, dt, G);
      v.Go_ZaslDown = klapDown.runToOpen;
      if (v.MustShOpen && v.ZaslDownOpened && ton(T("smsEmpty"), (+v.MassSms || 0) < 3, 4, dt)) {
        v.MustShOpen = false; T("smsEmpty").et = 0;
        if (mj) { mj.mixed = true; mj.stage = "выгрузка ГП"; mj.pp.done++; event(`ПП «${mj.pp.name}»: порция ${mj.n} готова (${mj.pp.done}/${mj.pp.portions})`); }
        S.mixJob = null; v.SmsMainState0 = false; v.SmsMainState1 = false; v.SmsMainState3 = false; v.SmsMainState13 = false;
      }
      // конец программы: все порции смешаны → следующая активированная или останов
      const pr = pp();
      if (pr && pr.done >= pr.portions) { pr.status = "выполнена"; event(`ПП «${pr.name}» выполнена`); const nx = S.programs.find((p) => p.status === "активирована"); if (nx) nx.status = "работает"; }
      if (v.Regim2_10 && !pp() && !S.jobs.some((j) => !j.mixed) && !v.SmsMainState0) {
        if (ton(T("endDos"), !v.Go_TrSms && (+v.MassPSB || 0) < 5, 10, dt)) { v.Regim2_9 = false; v.Regim2_10 = false; event("Производство остановлено: все программы выполнены"); }
      }
      if (v.StopDosing && !S.jobs.some((j) => !j.mixed) && !S.kJob) { v.Regim2_10 = false; event("Производство остановлено оператором"); }
      // упрощённое удаление завершённых порций
      S.jobs = S.jobs.filter((j) => !(j.mixed && j.stage === "выгружено"));
      v.CurPortK = kj ? kj.n : 0; v.CurPortSms = mj ? mj.n : 0;
      S.msg = !v.Regim2_9 && !v.Regim2_10 ? "Производство не запущено" : !v.Regim2_10 ? "Предпусковая сигнализация…" : pr ? `Работает ПП «${pr.name}»` : "Завершение производства";
    }
    const P_misc = { pit: [L.newPid(), L.newPid()] };

    // УДЖК: долив масла из ВЖД4 в весовую ёмкость, затем подача в смеситель
    function jir(dt, mj) {
      const J = S.jir;
      const need = mj && v.SmsMainState1 && !v.SmsMainState13 ? mj.J : 0;
      const nextNeed = S.jobs.filter((j) => !j.mixed && j !== mj).reduce((m, j) => Math.max(m, j.J), 0);
      // долив до нужного веса заранее (WantDolivJ1)
      const want = Math.max(need, nextNeed);
      const ves = +v.Ves4 || 0;
      v.WantDolivJ1 = want > 0 && ves < want + 0.5 && J.phase !== "dose";
      const dolivOn = v.RunDosing && v.WantDolivJ1 && !J.stopTry && !v.DVU_Maslo;
      L.klap(clapIn, { opened: !!v.ClapInOpened, closed: !!v.ClapInClosed, toOpen: dolivOn, maxTTO: 8,
        HandMode: v.MHand || !!v.fHand_ClapMasloIn, io: io.ClapMasloIn, lowPress: !!v.ErrLowPress }, dt, G);
      v.Go_MasloDop = dolivOn && !!v.ClapInOpened;      // насос долива
      if (ton(T("dolivFail"), v.Go_MasloDop && (+v.FlowMaslo || 0) < 0.01, 15, dt) && !J.tryFail) { J.tryFail = true; event("Не удаётся долить масло в весовую ёмкость", "bad"); }
      if (need > 0 && J.phase === "idle" && ves >= need - 0.2 && !v.Go_MasloDop) { J.phase = "dose"; J.start = ves; J.target = need; mj.stage = "ввод масла"; }
      const dOn = J.phase === "dose" && v.Go_Sms;
      L.klap(clapOut, { opened: !!v.ClapOutOpened, closed: !!v.ClapOutClosed, toOpen: dOn, maxTTO: 8,
        HandMode: v.MHand || !!v.fHand_ClapMasloOut, io: io.ClapMasloOut, lowPress: !!v.ErrLowPress }, dt, G);
      v.Go_MasloDos = dOn && !!v.ClapOutOpened;
      v.Go_Produv = J.phase === "blow";
      if (J.phase === "dose" && J.start - ves >= J.target - 0.15) { J.phase = "blow"; J.tb = 0; }
      if (J.phase === "blow") { J.tb += dt; if (J.tb > 4) { J.phase = "idle"; v.SmsMainState13 = true; if (mj) mj.stage = "мокрое смешивание"; } }
      fbs.Jir.run = v.Go_MasloDop || v.Go_MasloDos;
      v.JirPhase = J.phase;
    }

    /* ============================================================ ВЫГРУЗКА ГП */
    function unload(dt) {
      const prog = pp();
      // маршрут выгрузки ПСБ определяется продуктом порции, которая сейчас в ПСБ/смесителе, а не текущей ПП:
      // последняя порция гранул уходит на гранулирование и после того, как ПП отмечена выполненной
      const curJob = S.psbJob || S.mixJob;
      v.UseGran = (curJob ? curJob.pp.type === "Гранулы" : !!(prog && prog.type === "Гранулы")) || !!v.UnloadToGran;
      v.ShTrSmsMustOpen = v.UseGran;
      const anyMash = (+v.MassPSB || 0) > 1 || v.SmsMainState3 || !!S.psbJob;
      // участок выгрузки ГП в автомате и пока линия гранулирования выгружает гранулы на норию ГП (GranUnl8)
      v.UnloadSt0 = v.RunDosing || !!v.UnloadManual || !!(v.GranUnlRun && v.GranUnl8);
      v.UnloadSt1 = v.UnloadSt0;
      v.canAutoUnl = v.UnloadSt0 && anyMash && !v.HandUnl;
      // целевой бункер ГП: первый незаполненный из очереди
      while (S.unloadList.length && v.DVU_Silo[S.unloadList[0]] && S.unloadList.length > 1) { const b = S.unloadList.shift(); event(`Бункер ГП ${300 + b} заполнен — переход к следующему`, "warn"); }
      if (S.unloadAll && !S.unloadList.length) S.unloadList = [1, 2, 3, 4, 5, 6, 7, 8].filter((b) => !v.DVU_Silo[b]);
      const tgt = S.unloadList[0] || 0;
      v.UnloadTarget = tgt;
      v.PolnSiloCur = tgt > 0 && !!v.DVU_Silo[tgt];
      for (let b = 1; b <= 8; b++) v.UnloadBunk[b] = b === tgt;
      v.UseKonv50300 = tgt >= 1 && tgt <= 4;
      const route = !v.UseGran || (v.GranUnlRun && v.GranUnl8);
      v.canAutoUnlGP = (v.canAutoUnl && !v.UseGran) || (v.GranUnlRun && v.GranUnl8);
      v.Next50300 = !v.PolnSiloCur && ((tgt === 1 && v.Opened_Sh50310) || (tgt === 2 && v.Closed_Sh50310 && v.Opened_Sh50320) ||
        (tgt === 3 && v.Closed_Sh50310 && v.Closed_Sh50320 && v.Opened_Sh50330) || (tgt === 4 && v.Closed_Sh50310 && v.Closed_Sh50320 && v.Closed_Sh50330));
      v.Next50400 = !v.PolnSiloCur && ((tgt === 5 && v.Opened_Sh50410) || (tgt === 6 && v.Closed_Sh50410 && v.Opened_Sh50420) ||
        (tgt === 7 && v.Closed_Sh50410 && v.Closed_Sh50420 && v.Opened_Sh50430) || (tgt === 8 && v.Closed_Sh50410 && v.Closed_Sh50420 && v.Closed_Sh50430));
      v.Next50200 = route && ((v.Opened_Sh50210 && v.Go_Tr50300) || (v.Closed_Sh50210 && v.Go_Tr50400));
      v.NextTrSms = (v.UseGran && v.Opened_ShTrSms && v.Go_Tr40100) || (!v.UseGran && v.Closed_ShTrSms && v.Go_Nor4);
      if (S.psbJob && S.psbJob.mixed && !v.MustShOpen && ton(T("psbEmpty"), (+v.MassPSB || 0) < 2, 8, dt)) { S.psbJob.stage = "выгружено"; S.psbJob = null; }
      // выгрузка в автомобили: разрешение и кнопки «Открыть/Закрыть» у бункеров
      v.UnBlockSilos0 = !!v.UnBlockAll;
    }

    /* ============================================================ ГРАНУЛИРОВАНИЕ */
    function gran(dt) {
      // GrStart — «Запустить гранулирование»; при производстве гранул и наличии
      // продукта в БО-5 гранулятор запускается сам (опция «Автозапуск»).
      const prodGran = v.RunDosing && v.UseGran;
      if (prodGran && v.AutoGrStart && v.DNU_PBGran && !v.GrStart && !v.Err30_8 && !v.GEmer) { v.GrStart = true; event("Гранулятор: автозапуск — в БО-5 есть продукт"); }
      if (rtrig(S, "_rGr", !!v.GrStart)) { v.GranIsEmpty = false; v.GranUnlRun = true; v.GrStopLoadBtn = false; }
      if (prodGran || v.GranLine) v.GranUnlRun = true;
      // конец подачи россыпи на гранулирование (isVigr3Wait = 2)
      // шнек 40100 возит и возврат мелочи (40800), поэтому конец подачи — только по выгрузке ПСБ на гранулирование
      v.GranFeedEnd = (!prodGran && !(v.Go_TrSms && v.Opened_ShTrSms)) || !!v.GrStopLoadBtn;
      if (v.GrStart && v.GranFeedEnd && ton(T("grHHEnd"), !v.DNU_PBGran && !v.Go_PitGr && (+v.TokGran || 0) < v.TokXX + 25, 30, dt)) {
        if (!v.GranIsEmpty) event("Гранулятор: продукт выработан, охладитель выгружается");
        v.GranIsEmpty = true;
      }
      if (v.GranIsEmpty && v.OhlIsEmpty && v.GranFeedEnd && !v.GranLine && !prodGran) {
        if (ton(T("grOff"), true, 5, dt)) { v.GranUnlRun = false; if (v.GrStart) event("Гранулирование завершено"); v.GrStart = false; }
      } else T("grOff").et = 0;
      v.AutoUnlOhl = v.GranUnlRun;
      v.GranPath = v.GranUnlRun ? 1 : 0;
      v.AutoPros = v.GranUnlRun && !v.GrClear;
      const dest = v.GranDest || 8;   // 8 — на норию ГП (бункера 301–308), 309, 310 — биг-бег
      v.GranUnl8 = v.GranUnlRun && dest === 8; v.GranUnl309 = v.GranUnlRun && dest === 309; v.GranUnl310 = v.GranUnlRun && dest === 310;
      v.GranUnlZ310 = v.GranUnl310 && !!v.GrBypassPros;
      v.GranWork10sec = ton(T("gw10"), !!v.Go_Gran, 10, dt);
      v.GranIsWork = !!v.Go_Gran && v.GranWork10sec && !!v.GranSpeedOK && !fbs.Gran.da;
      if (v.Go_PitGr) v.GranIsEmpty = false;
      // БО-5 пуст — подача останавливается; холодный продукт — тоже
      v.GrStopLoad = !!v.GrStopLoadBtn || ton(T("pbEmpty"), !v.DNU_PBGran, 30, dt);   // питатель выбирает остаток из конуса БО-5
      v.GrHotStopLoad = ton(T("cold"), !!v.Go_PitGr && (+v.TempKond || 0) < v.TempKondMin, 120, dt);
      // перегрузка главного привода: ток > максимального 3 с — Err30.8 (забивание матрицы)
      if (ton(T("ovl"), (+v.TokGran || 0) > v.TokMaxGran, 3, dt)) { if (!v.Err30_8) event("Гранулятор: перегрузка главного привода — забивание матрицы", "bad"); v.Err30_8 = true; }
      // наращивание производительности питателя (PrgGran, ppPwCurrent)
      const m = S.pp || (S.pp = { cur: v.ppPwStart, counter: 0, ov: 0, notOv: 0, was: false, lastPlus: 0 });
      if (!v.Go_PitGr || v.GrStopLoad) { m.cur = v.ppPwStart; m.counter = 0; }
      else {
        m.counter += dt;
        const tok = +v.TokGran || 0;
        if (tok > v.TokNomGran) { m.ov += dt; m.notOv = 0; } else { m.notOv += dt; if (m.notOv > 2) { m.ov = 0; m.was = false; } }
        if (m.counter >= v.ppInterval && m.ov === 0) {
          m.counter = 0;
          if (m.cur < v.ppPwTarg) { m.lastPlus = Math.min(v.ppPwDelta, v.ppPwTarg - m.cur); m.cur += m.lastPlus; }
        }
        if (m.ov >= 10) { m.ov = 0; m.cur = Math.max(v.pw1Percent * 2, m.cur - (m.was ? v.ppPwDelta / 2 : m.lastPlus / 2 || v.ppPwDelta / 2)); m.was = true; }
        if (m.cur > v.ppPwTarg) m.cur = v.ppPwTarg;
      }
      v.ppPwCurrent = m.cur;
      v.ppSecToInc = v.Go_PitGr ? Math.max(0, Math.round(v.ppInterval - m.counter)) : 0;
      v.FreqAutoPitGr = (m.cur / 100) * 50;
      v.FreqPitGr = P.handOf(P.DEF.PitGr) ? +v.HandFreqPitGr || 20 : v.FreqAutoPitGr;
      // пар: клапан по ПИД держит температуру после кондиционера
      if (v.SteamManual) v.SteamValve = Math.max(0, Math.min(100, +v.SteamManualPos || 0));
      else if (v.Go_KondGr && v.Go_PitGr) v.SteamValve = L.pid(S.steam || (S.steam = L.newPid()), v.TempKondSet, +v.TempKond || 0, 2.2, 25, 0, 0, 100, dt);
      else { v.SteamValve = 0; if (S.steam) S.steam.i = 25; }
      v.OhlMustEmpty = v.GranIsEmpty && v.GranFeedEnd;
    }

    function after(dt) {
      // события для журнала аварий из ФБ
      if (G.ResetErrors) { S.jir.tryFail = false; S.jir.stopTry = false; }
    }

    function onEmergency() {
      event("Общая авария: аварийный стоп / нет ПУСК на шкафу", "bad");
      v.MustKlapOpen = false; v.MustShOpen = false;
    }

    /* ------------------------------------------------ команды панели оператора */
    const cmd = {
      startLoad(material, queue, auto) {
        if (!queue.length) return "Очередь загрузки пуста";
        S.queueLoad = queue.slice(); S.loadMaterial = material; v.Load1St0 = true; v.Load1St1 = auto !== false; v.Load1St2 = false;
        event(`Загрузка БВ запущена: бункеры ${queue.map((b) => 100 + b).join(", ")}`); return null;
      },
      stopLoad() { v.Load1St0 = false; S.queueLoad = []; event("Загрузка БВ остановлена оператором"); },
      nextLoadBunk() { if (v.Load1St0) { v.NextLoadBunk = true; v.PolnBunkCur = false; } },
      activate(p) { p.status = S.programs.some((q) => q.status === "работает") ? "активирована" : "работает"; p.issued = p.issued || 0; p.done = p.done || 0; S.programs.push(p); },
      startProduction() {
        if (!S.programs.some((p) => p.status === "работает" || p.status === "активирована")) return "Нет активированных программ производства";
        if (!S.programs.some((p) => p.status === "работает")) S.programs.find((p) => p.status === "активирована").status = "работает";
        if (!S.unloadList.length && !S.unloadAll && (pp().type !== "Гранулы" || (v.GranDest || 8) === 8)) return "Не задана очередь бункеров на выгрузку продукции";
        v.Regim2_9 = true; event("Запуск производства — предпусковая сирена 20 с"); return null;
      },
      stopProduction(mode) {
        // 1 — после выполнения ПП, 2 — после порции, 3 — полный стоп
        if (mode === 3) {
          v.Regim2_9 = false; v.Regim2_10 = false; S.kJob = null; S.dJob = null; v.PBDState0 = false; v.PBDState1 = false;
          S.programs.forEach((p) => { if (p.status === "работает") p.status = "прервана"; });
          event("Производство: полный стоп", "warn");
        } else { v.Regim2_9 = false; S.programs.forEach((p) => { if (p.status === "работает") p.portions = Math.max(p.issued, p.done); }); event("Производство: останов после текущей порции"); }
      },
      setUnloadList(list, all) { S.unloadList = list.slice(); S.unloadAll = !!all; },
      retryOil() { S.jir.tryFail = false; S.jir.stopTry = false; },
      stopOil() { S.jir.tryFail = false; S.jir.stopTry = true; v.SmsMainState13 = true; S.jir.phase = "idle"; },
    };

    return { S, loading, dosing, unload, gran, after, onEmergency, cmd, event };
  }

  const api = { create };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.PLCPROD = api;
})(typeof window !== "undefined" ? window : globalThis);
