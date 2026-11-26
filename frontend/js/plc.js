/* Комбикормовый завод «Бугры» — эмуляция программы ПЛК (Machine Expert «Bugry»).
   Подключение экземпляров блоков (next / prev / canRunAuto / HandMode)
   взято из программ PrgLoading, PrgUnloadToSms, PrgSmesitel, PrgUnLoad,
   PrgUnLoadDop, PrgGran, PrgAsp, PrgUnloadToCar (docs/plc/*.txt).
   Обмен со SCADA (msgToScada…, msgFromScada…) заменён прямыми вызовами
   панели оператора: окна панели — часть этого же эмулятора. */

(function (global) {
  "use strict";
  const L = global.PLCLIB || (typeof require !== "undefined" ? require("./plc-lib.js") : null);
  const { TON, ton, TP, tp, rtrig } = L;

  /* ------------------------------------------------------------ группы режимов */
  // HandMode в проекте: механизм в ручном, если его участок не в автомате,
  // включено общее «Ручное управление» (MHand) или персональный флаг fHand.
  const GROUPS = {
    load: { hand: (v) => !v.Load1St1 || v.MHand, slow: (v) => v.Load1St1 },
    dos:  { hand: (v) => v.MHand || !v.RunDosing, slow: (v) => v.RunDosing },
    unl:  { hand: (v) => v.MHand || v.HandUnl || !v.UnloadSt1, slow: (v) => v.UnloadSt1 },
    gran: { hand: (v) => v.MHand || !v.GranUnlRun, slow: (v) => v.GranUnlRun },
    grn2: { hand: (v) => v.MHand || !v.GrStart, slow: (v) => v.GrStart },
  };

  /* ------------------------------------------------------------ приводы */
  // fb — тип блока; tag — суффикс переменных (Go_<tag>, DKS_<tag>, …);
  // sens — какие датчики есть у механизма; tc — параметр «время очистки».
  const D = [];
  const def = (o) => { D.push(o); return o; };
  const T = (s) => s; // время, с

  // ---- Загрузка сырьевых бункеров БВ (PrgLoading)
  def({ id: "TrHole", fb: "transporter", grp: "load", poz: "10110", name: "Транспортёр завальной ямы", sens: ["dks", "dp"], dksMustBlink: true,
    next: (v) => v.Go_NorHole && !v.PolnBunkCur, prev: () => false, auto: (v) => v.CanRunLoad && !v.Regim2_7, t1: 5, tc: "tcTrHole" });
  def({ id: "NorHole", fb: "noria", grp: "load", poz: "10200", name: "Нория завальной ямы", sens: ["dks", "dsl1", "dsl2"],
    next: (v) => (v.Regim2_6 && v.DVPT_Na_Scalp && v.Go_Scalp) || (!v.Regim2_6 && v.DVPT_Na_Nor1 && v.Go_Nor1),
    prev: (v) => v.Go_TrHole, auto: (v) => v.CanRunLoad, t1: 5, tc: "tcNorHole" });
  def({ id: "DVPT", fb: "dvpt", grp: "load", poz: "10210", name: "Двухпоточник (на скальператор / на норию 10400)",
    to1: (v) => v.Load1St1 && v.Regim2_6 && v.Go_Nor1, to2: (v) => v.Load1St1 && !v.Regim2_6 && v.Go_Nor1,
    pos1: "DVPT_Na_Scalp", pos2: "DVPT_Na_Nor1", maxTTO: 15 });
  def({ id: "Scalp", fb: "meh", grp: "load", poz: "10300", name: "Скальператор (ПЧ)", pch: true,
    next: (v) => v.Go_Nor1, prev: (v) => v.DVPT_Na_Scalp && v.Go_NorHole, auto: (v) => v.Regim2_6 && v.CanRunLoad, t1: 5, tc: "tcScalp" });
  def({ id: "Nor1", fb: "noria", grp: "load", poz: "10400", name: "Нория загрузки БВ", sens: ["dks", "dsl1", "dsl2"],
    next: (v) => v.GoR_Tr1 || v.GoL_Tr1, prev: (v) => (v.Regim2_6 && v.Go_Scalp) || (!v.Regim2_6 && v.Go_NorHole),
    auto: (v) => v.CanRunLoad, t1: 5, tc: "tcNor1" });
  def({ id: "Tr1", fb: "reverse", grp: "load", poz: "10500", name: "Конвейер шнековый реверсивный КШU-250 6М/15", sens: ["dks", "dp1", "dp2"],
    nextL: (v) => v.Go_Tr1L || (!v.Load1St1 && v.MGod), nextR: (v) => v.Go_Tr1R || (!v.Load1St1 && v.MGod),
    prev: (v) => v.Go_Nor1, autoL: (v) => v.CanRunLoadL, autoR: (v) => v.CanRunLoadR, t1: 4, tc: "tcTr1" });
  def({ id: "Tr1L", fb: "transporter", grp: "load", poz: "10600", name: "Конвейер скребковый КЦСв-60-13 (бункеры 101–103)", sens: ["dks", "dp"], dksMustBlink: false,
    next: (v) => (v.NextTr1L && v.Go_Asp1) || (v.NextTr1L && !v.Load1St1 && v.MGod), prev: (v) => v.GoL_Tr1, auto: (v) => v.CanRunLoad, t1: 5, tc: "tcTr1LR" });
  def({ id: "Tr1R", fb: "transporter", grp: "load", poz: "10700", name: "Конвейер скребковый КЦСв-60-13 (бункеры 104–106)", sens: ["dks", "dp"], dksMustBlink: false,
    next: (v) => (v.NextTr1R && v.Go_Asp1) || (v.NextTr1R && !v.Load1St1 && v.MGod), prev: (v) => v.GoR_Tr1, auto: (v) => v.CanRunLoad, t1: 5, tc: "tcTr1LR" });
  [["ShL1", "10610", 1], ["ShL2", "10620", 2], ["ShR1", "10710", 4], ["ShR2", "10720", 5]].forEach(([id, poz, b]) =>
    def({ id, fb: "shiber", grp: "load", poz, name: `Шибер на бункер ${100 + b}`,
      toOpen: (v) => v.Load1St1 && !v["DA_" + id] && v.LoadBunkK[b] && !v["Opened_" + id] && !v.CloseAllSh1,
      toClose: (v) => (v.Load1St1 && !v["DA_" + id] && !v.LoadBunkK[b] && !v["Closed_" + id]) || v.CloseAllSh1 }));
  def({ id: "Asp1", fb: "asp", grp: "load", poz: "АС-1", name: "Аспирация АС-1 (вентилятор + шлюзовый затвор)",
    prev: (v) => v.Go_Tr1L || v.Go_Tr1R || v.RunDosing, cond: (v) => v.Load1St0 || v.RunDosing, tts: 8 });

  // ---- Дозирование компонентов и дробление (PrgDosingK, PrgUnloadToSms)
  def({ id: "TrKomp", fb: "transporter", grp: "dos", poz: "20110", name: "Транспортёр весов компонентов", sens: ["dks", "dp"], dksMustBlink: true,
    next: (v) => v.Go_Nor2 && !v.DVU_PBD, prev: () => false, auto: (v) => v.PBDState0 && !v.PBDState1 && !v.isBlocketKomp, t1: 4, tStop: 1 });
  def({ id: "Nor2", fb: "noria", grp: "dos", poz: "20200", name: "Нория подачи на дробление", sens: ["dks", "dsl1", "dsl2"],
    next: () => true, prev: (v) => v.Go_TrKomp, auto: (v) => v.CanRunAutoK, t1: 1, tc: "tcNor2" });
  def({ id: "TrPBD", fb: "transporter", grp: "dos", poz: "20300", name: "Конвейер в наддробильный бункер", sens: ["dks", "dp"], dksMustBlink: true,
    next: () => true, prev: (v) => v.Go_Nor2, auto: (v) => v.RunKomp, t1: 1, tc: "tcTrPBD" });
  [1, 2].forEach((n) => {
    def({ id: "Pit" + n, fb: "transporter", grp: "dos", poz: n === 1 ? "30210" : "30220", name: `Питатель дробилки №${n} (ПЧ)`, sens: [], pch: true, freq: true,
      next: (v) => ((v["DrobIsRun" + n] && !v["BlockDrob" + n] && v.WorkPit) || (v["DrobIsRun" + n] && !v["BlockDrob" + n] && !v.RunDosing)) && (v.UsedDrob & n) && v.Go_TrDrob,
      prev: () => false, auto: (v) => v.WorkPit && v.RunDrob && v["DrobIsRun" + n] && v.Go_TrDrob, t1: 2, tStop: 2 });
    def({ id: "Drob" + n, fb: "meh", grp: "dos", poz: n === 1 ? "30410" : "30420", name: `Дробилка молотковая №${n}`, door: true,
      next: () => true, prev: (v) => v["Go_Pit" + n], auto: (v) => v["RunDrob" + n], t1: n === 1 ? 2 : 12, tStop: 10 });
  });
  def({ id: "TrDrob", fb: "transporter", grp: "dos", poz: "30500", name: "Конвейер из-под дробилок", sens: ["dks", "dp"], dksMustBlink: true,
    next: (v) => v.Go_Nor3, prev: (v) => v.Go_Drob1 || v.Go_Drob2, auto: (v) => v.RunDrob, t1: 3, tc: "tcTrDrob" });
  def({ id: "Nor3", fb: "noria", grp: "dos", poz: "30600", name: "Нория надсмесительного бункера", sens: ["dks", "dsl1", "dsl2"],
    next: () => true, prev: (v) => v.Go_TrDrob || v.Go_TrDob, auto: (v) => v.RunDrob || v.RunDob, t1: 5, tc: "tcNor3" });
  def({ id: "TrDob", fb: "transporter", grp: "dos", poz: "21110", name: "Конвейер шнековый средних весов (добавки)", sens: ["dks", "dp"], dksMustBlink: true, pch: true,
    next: (v) => v.Go_Nor3, prev: (v) => v.SmsUpState1 && !v.SmsUpState2,
    auto: (v) => v.DosingD_Done && v.SmsUpState1 && !v.SmsUpState2 && v.RunDob && !v.isBlocketDob, t1: 1, tStop: 1 });
  def({ id: "Sms", fb: "meh", grp: "dos", poz: "30700", name: "Смеситель горизонтальный", door: true, dks: true,
    next: () => true, prev: (v) => v.SmsMainState0 || v.SmsUpState10, auto: (v) => v.RunDosing, t1: 3, tc: "tcSms" });
  def({ id: "Vibr1", fb: "vibr", grp: "dos", poz: "201", name: "Вибромолоток бункера 201",
    runAuto: (v) => v.RunDosing && v.noWeightD1 && v.Go_Pusk_D1, tRun: 10, tSleep: 5, max: 15 });
  def({ id: "Vibr2", fb: "vibr", grp: "dos", poz: "205", name: "Вибромолоток бункера 205",
    runAuto: (v) => v.RunDosing && v.noWeightD5 && v.Go_Pusk_D5, tRun: 10, tSleep: 5, max: 15 });
  def({ id: "Asp2", fb: "asp", grp: "unl", poz: "АС-2", name: "Аспирация АС-2 (вентилятор + шлюзовый затвор)",
    prev: (v) => v.UnloadSt0 || v.UnloadSt1 || v.RunDosing, cond: (v) => v.UnloadSt0 || v.RunDosing, tts: 8 });

  // ---- Выгрузка готовой продукции (PrgUnLoad)
  def({ id: "TrSms", fb: "transporter", grp: "unl", poz: "30800", name: "Конвейер шнековый из-под смесителя (ПЧ)", sens: ["dks", "dp"], dksMustBlink: true, pch: true,
    next: (v) => v.NextTrSms, prev: (v) => v.canAutoUnl, auto: (v) => v.canAutoUnl, t1: 3, tc: "tcTrSms" });
  def({ id: "ShTrSms", fb: "shiber", grp: "unl", poz: "40110", name: "Шибер на линию гранулирования",
    toOpen: (v) => v.ShTrSmsMustOpen && !v.Opened_ShTrSms, toClose: (v) => !v.ShTrSmsMustOpen && !v.Closed_ShTrSms });
  def({ id: "Nor4", fb: "noria", grp: "unl", poz: "50100", name: "Нория готовой продукции", sens: ["dks", "dsl1", "dsl2"],
    next: (v) => v.Go_TrGP, prev: (v) => v.Go_TrSms || v.Go_Tr51200, auto: (v) => v.canAutoUnl || (v.GranUnlRun && v.GranUnl8), t1: 5, tc: "tcNor4", slowKey: "UnloadSt1" });
  def({ id: "TrGP", fb: "transporter", grp: "unl", poz: "50200", name: "Конвейер шнековый КШU-250 7М/15", sens: ["dks", "dp"], dksMustBlink: true,
    next: (v) => v.Next50200, prev: (v) => v.Go_Nor4, auto: (v) => v.canAutoUnl || (v.GranUnlRun && v.GranUnl8), t1: 3, tc: "tcTrGP" });
  def({ id: "Sh50210", fb: "shiber", grp: "unl", poz: "50210", name: "Шибер на конвейер 50300",
    toOpen: (v) => v.UseKonv50300 && !v.Opened_Sh50210 && !v.CloseAllSh3, toClose: (v) => (!v.UseKonv50300 || v.CloseAllSh3) && !v.Closed_Sh50210 });
  def({ id: "Tr50300", fb: "transporter", grp: "unl", poz: "50300", name: "Конвейер шнековый КШU-250 10,5М/15 (бункеры 301–304)", sens: ["dks", "dp"], dksMustBlink: true,
    next: (v) => v.Next50300, prev: (v) => v.Go_TrGP && v.Opened_Sh50210, auto: (v) => v.canAutoUnlGP, t1: 2, tc: "tcTrGP12" });
  def({ id: "Tr50400", fb: "transporter", grp: "unl", poz: "50400", name: "Конвейер шнековый КШU-250 10,5М/15 (бункеры 305–308)", sens: ["dks", "dp"], dksMustBlink: true,
    next: (v) => v.Next50400, prev: (v) => v.Go_TrGP && v.Closed_Sh50210, auto: (v) => v.canAutoUnlGP, t1: 2, tc: "tcTrGP12" });
  [["Sh50310", "50310", 1], ["Sh50320", "50320", 2], ["Sh50330", "50330", 3], ["Sh50410", "50410", 5], ["Sh50420", "50420", 6], ["Sh50430", "50430", 7]].forEach(([id, poz, b]) =>
    def({ id, fb: "shiber", grp: "unl", poz, name: `Шибер на бункер ГП ${300 + b}`,
      toOpen: (v) => v.UnloadBunk[b] && !v["Opened_" + id] && !v.CloseAllSh3, toClose: (v) => (!v.UnloadBunk[b] || v.CloseAllSh3) && !v["Closed_" + id] }));
  for (let i = 1; i <= 9; i++) {
    def({ id: "ShO" + i, fb: "shiber", grp: "car", poz: i < 9 ? "506" + i + "0" : "50300*", name: `Шибер выгрузки из бункера ${300 + i}`,
      toOpen: (v) => v["LOpen_ShO" + i] && (v.UnBlockSilos0 || v.UnBlockSilos[i]), toClose: (v) => v["LClose_ShO" + i], maxTTO: 12, autoMode: true });
  }

  // ---- Линия гранулирования (PrgUnLoadDop, PrgGran)
  def({ id: "Tr40100", fb: "transporter", grp: "gran", poz: "40100", name: "Конвейер шнековый КШU-250 7,5М/20", sens: ["dks", "dp"], dksMustBlink: true,
    next: (v) => v.Go_Nor5, prev: (v) => (v.Go_TrSms && v.Opened_ShTrSms) || v.Go_Tr40800, auto: (v) => v.GranUnlRun, t1: 3, tc: "tcTr40100" });
  def({ id: "Nor5", fb: "noria", grp: "gran", poz: "40200", name: "Нория НЗ-В.40.11 (на гранулятор)", sens: ["dks", "dsl1", "dsl2"],
    next: (v) => v.Go_Tr40300 && v.Go_FiltNor5, prev: (v) => v.Go_Tr40100, auto: (v) => v.GranUnlRun, t1: 5, tc: "tcNor5" });
  def({ id: "FiltNor5", fb: "meh", grp: "gran", poz: "40210", name: "Аспирация нории 40200 (фильтр)",
    next: (v) => v.Go_Tr40300, prev: (v) => v.Go_Nor5, auto: (v) => v.GranUnlRun, t1: 5, tStop: 10 });
  def({ id: "Tr40300", fb: "transporter", grp: "gran", poz: "40300", name: "Конвейер шнековый КШU-250 3М/20 (в БО-5)", sens: ["dks", "dp"], dksMustBlink: true,
    next: (v) => !v.DVU_PBGran || !v.GranUnlRun, prev: (v) => v.Go_Nor5, auto: (v) => v.GranUnlRun && !v.DVU_PBGran, t1: 3, tc: "tcTr40300" });
  def({ id: "VibrG1", fb: "vibr", grp: "grn2", poz: "40400", name: "Электровибратор ИВ-01-50 БО-5 №1",
    runAuto: (v) => v.GrStart && v.Go_PitGr && v.PitNoFlow, tRun: 5, tSleep: 10, max: 55 });
  def({ id: "VibrG2", fb: "vibr", grp: "grn2", poz: "40400", name: "Электровибратор ИВ-01-50 БО-5 №2",
    runAuto: (v) => v.GrStart && v.Go_PitGr && v.PitNoFlow, tRun: 4, tSleep: 9, max: 60 });
  def({ id: "PitGr", fb: "transporter", grp: "grn2", poz: "40501", name: "Питатель пресс-гранулятора (ПЧ)", sens: ["dks", "dp"], dksMustBlink: true, pch: true, freq: true,
    next: (v) => v.Go_KondGr && v.GranIsWork && v.Go_ZatvOhl && !v.GrStopLoad && !v.GrHotStopLoad,
    prev: (v) => v.DNU_PBGran, auto: (v) => v.GrStart && !v.GrStopLoad && !v.GranIsEmpty, t1: 2, tc: "tcPitGr" });
  def({ id: "KondGr", fb: "transporter", grp: "grn2", poz: "40502", name: "Кондиционер пресс-гранулятора", sens: ["dks"], dksMustBlink: true, doorDp: true,
    next: (v) => v.GranIsWork && v.Go_ZatvOhl && !v.GrHotStopLoad, prev: (v) => v.Go_PitGr,
    auto: (v) => v.GrStart && !v.GrStopLoad && !v.GranIsEmpty, t1: 3, tc: "tcKond" });
  def({ id: "Gran", fb: "transporter", grp: "grn2", poz: "40500", name: "Главный привод пресс-гранулятора (ПЧ)", sens: ["dks"], dksMustBlink: true, pch: true,
    next: (v) => v.OnPchGr && v.Go_ZatvOhl && !v.Err30_8, prev: (v) => v.Go_KondGr, auto: (v) => v.GrStart, t1: 5, tStop: 20 });
  def({ id: "ZatvOhl", fb: "zatvor", grp: "gran", poz: "40601", name: "Шлюзовый затвор охладителя гранул",
    next: () => true, prev: (v) => v.GrStart || v.Go_Gran || !v.GranIsEmpty, auto: (v) => v.AutoUnlOhl, t1: 2, tStop: 2 });
  def({ id: "Ohl", fb: "ohl", grp: "gran", poz: "40600", name: "Охладитель гранул (стол)" });
  def({ id: "AspGr", fb: "asp", grp: "gran", poz: "60100", name: "Аспирация охладителя (вентилятор + шлюз ЗШ-17)",
    prev: (v) => v.AutoUnlOhl, cond: (v) => v.AutoUnlOhl, tts: 5 });
  def({ id: "Tr40700", fb: "transporter", grp: "gran", poz: "40700", name: "Конвейер цепной скребковый КЦСв-20-05", sens: ["dks", "dp"], dksMustBlink: false,
    next: (v) => v.Go_Nor6, prev: (v) => !v.GranIsEmpty || !v.OhlIsEmpty, auto: (v) => v.GranUnlRun, t1: 3, tc: "tcTr40700" });
  def({ id: "Nor6", fb: "noria", grp: "gran", poz: "40900", name: "Нория НЗ-В.20.12 (на просеиватель)", sens: ["dks", "dsl1", "dsl2"],
    next: (v) => v.Go_FiltNor6 && ((v.PP1_Pos1 && (v.Go_Pros1 || v.Go_Pros2)) || v.PP1_Pos2), prev: (v) => v.Go_Tr40700, auto: (v) => v.GranUnlRun, t1: 5, tc: "tcNor6" });
  def({ id: "FiltNor6", fb: "meh", grp: "gran", poz: "40920", name: "Аспирация нории 40900 (фильтр)",
    next: () => true, prev: (v) => v.Go_Nor6, auto: (v) => v.GranUnlRun, t1: 1, tStop: 15 });
  def({ id: "PP1", fb: "dvpt", grp: "gran", poz: "40910", name: "Переключатель потока ППМ-2.200 (от нории 40900)",
    to1: (v) => v.AutoPros && !v.GrClear && !v.PP1_Pos1, to2: (v) => (v.GranUnlZ310 || v.GrClear) && !v.PP1_Pos2, pos1: "PP1_Pos1", pos2: "PP1_Pos2" });
  [1, 2].forEach((n) => def({ id: "Pros" + n, fb: "meh", grp: "gran", poz: "40950", name: `Просеиватель PVE1 — двигатель №${n}`,
    next: (v) => (v.PP2_Pos1 || (v.PP2_Pos2 && v.Go_Tr51100)) && v.Go_Tr40800, prev: (v) => v.Go_Nor6 && v.PP1_Pos1, auto: (v) => v.AutoPros, t1: 5, tStop: 10 }));
  def({ id: "PP2", fb: "dvpt", grp: "gran", poz: "40960", name: "Переключатель потока ППМ-2.200 (от просеивателя)",
    to1: (v) => v.GranUnl310 && !v.Go_Pros1 && !v.Go_Pros2, to2: (v) => (v.GranUnl309 || v.GranUnl8) && !v.Go_Pros1 && !v.Go_Pros2, pos1: "PP2_Pos1", pos2: "PP2_Pos2" });
  def({ id: "Tr40800", fb: "transporter", grp: "gran", poz: "40800", name: "Конвейер шнековый КШU-150 7М/5 (возврат мелочи)", sens: ["dks", "dp"], dksMustBlink: true,
    next: (v) => v.Go_Tr40100, prev: (v) => v.Go_AspGr || v.Go_Pros1 || v.Go_Pros2, auto: (v) => v.GranUnlRun, t1: 3, tc: "tcTr40800" });
  def({ id: "Tr51100", fb: "transporter", grp: "gran", poz: "51100", name: "Конвейер скребковый КЦСв-20-10", sens: ["dks", "dp"], dksMustBlink: false,
    next: (v) => (v.PP3_Pos1 && v.Go_Tr51200) || (v.PP3_Pos2 && v.Go_Nor7), prev: (v) => (v.Go_Pros1 || v.Go_Pros2) && v.PP2_Pos2,
    auto: (v) => (v.GranUnlRun && v.GranUnl8) || (v.GranUnlRun && v.GranUnl309), t1: 3, tc: "tcTr51100" });
  def({ id: "PP3", fb: "dvpt", grp: "gran", poz: "51110", name: "Переключатель потока ППМ-2.200 (от конвейера 51100)",
    to1: (v) => v.GranUnl8, to2: (v) => v.GranUnl309, pos1: "PP3_Pos1", pos2: "PP3_Pos2" });
  def({ id: "Tr51200", fb: "transporter", grp: "gran", poz: "51200", name: "Конвейер скребковый КЦСв-20-08 (на норию ГП)", sens: ["dks", "dp"], dksMustBlink: false,
    next: (v) => v.Go_Nor4, prev: (v) => v.Go_Tr51100 && v.PP3_Pos1, auto: (v) => v.GranUnlRun && v.GranUnl8, t1: 3, tc: "tcTr51200" });
  def({ id: "Nor7", fb: "noria", grp: "gran", poz: "50100г", name: "Нория НЗ-В.20.13 (на бункер 309)", sens: ["dks", "dsl1", "dsl2"],
    next: (v) => v.Go_FiltNor7 && !v.DVU_Silo[9], prev: (v) => v.Go_Tr51100 && v.PP3_Pos2, auto: (v) => v.GranUnlRun && v.GranUnl309, t1: 5, tc: "tcNor7" });
  def({ id: "FiltNor7", fb: "meh", grp: "gran", poz: "50110", name: "Аспирация нории 50100г (фильтр)",
    next: () => true, prev: (v) => v.Go_Nor7, auto: (v) => v.GranUnlRun && v.GranUnl309, t1: 1, tStop: 10 });
  def({ id: "Leb", fb: "leb", grp: "gran", poz: "51300", name: "Лебёдка биг-бега (вверх-вниз, вперёд-назад)" });

  const DEF = {};
  D.forEach((d) => { DEF[d.id] = d; });

  // Время очистки (остановки) механизмов — окно «Настройки».
  const TC_DEFAULT = {
    tcNorHole: 20, tcNor1: 20, tcNor2: 20, tcNor3: 20, tcNor4: 20, tcNor5: 20, tcNor6: 20, tcNor7: 20,
    tcTrHole: 5, tcTr1: 15, tcTr1LR: 20, tcTrPBD: 15, tcTrDrob: 20, tcTrSms: 25, tcTrGP: 20, tcTrGP12: 25,
    tcTr40100: 20, tcTr40300: 15, tcTr40700: 25, tcTr40800: 20, tcTr51100: 25, tcTr51200: 20,
    tcScalp: 15, tcSms1: 25, tcSms: 30, tcDownBunk: 40, tcPitGr: 10, tcKond: 30, tcAsp1: 30, tcAsp2: 30,
  };

  /* ------------------------------------------------------------ контроллер */
  function createPLC(opts) {
    const v = Object.create(null);
    const fbs = {}, io = {};
    const misc = { tonReset: TON(), tpPusk: TP(), tpSirLoad: TP(), tpSiren: TP(), tonStartLoad: TON(), tonRunDos: TON(),
      tonChange: TON(), tonPoln: TON(), tonGranWork: TON(), tonGranEmpty: TON(), tonOverload: TON(), tonCold: TON(),
      steamPid: L.newPid(), pitPid: [L.newPid(), L.newPid()], tonIdleDrob: TON(), pp: { counter: 0, ov: 0, notOv: 0 },
      prevErr: 0, prevGEmer: false };

    // массивы, индексируемые как в проекте (с 1)
    v.LoadBunkK = [false, false, false, false, false, false, false];
    v.DVU_BunkK = Array(7).fill(false); v.DNU_BunkK = Array(7).fill(false);
    v.DVU_BunkD = Array(9).fill(false); v.DNU_BunkD = Array(9).fill(false);
    v.UnloadBunk = Array(10).fill(false);
    v.DVU_Silo = Array(11).fill(false); v.DNU_Silo = Array(11).fill(false);
    v.UnBlockSilos = Array(10).fill(false);
    Object.assign(v, TC_DEFAULT);
    v.Regim2_6 = true;            // со скальператором
    v.UsedDrob = 3;               // «Использовать дробилки: Обе»
    v.TokNom1 = 160; v.TokNom2 = 160; v.TokMax1 = 210; v.TokMax2 = 210; v.TokXX = 38;
    v.TokNomGran = 320; v.TokMaxGran = 400;       // А, главный привод пресса 160 кВт
    v.TempKondSet = 78; v.TempKondMin = 60;       // °C после кондиционера
    v.ppPwStart = 30; v.ppPwTarg = 100; v.ppPwDelta = 10; v.ppInterval = 20; v.pw1Percent = 1;   // % от номинала питателя
    v.OhlTimeInt0 = 4000; v.OhlTimeInt1 = 25000; v.OhlTimeInt2 = 6000; v.OhlTimeIntH = 5000;
    v.TimeClearOhl = 40; v.MaxTempVozdOhl = 70;
    v.DopOstBig = 2.0; v.DopOstMid = 0.5;         // допустимый остаток на весах, кг
    v.UspVes = [0, 3, 2, 2];                      // успокоение весов, с (большие, средние, масло)
    v.EmerPuskBtn = true;                         // при включении шкафа ПУСК не нажат
    v.GranIsEmpty = true; v.OhlIsEmpty = true; v.AutoGrStart = true; v.GranDest = 8;
    v.HandFreqPit1 = 25; v.HandFreqPit2 = 25; v.HandFreqPitGr = 20; v.SteamManualPos = 50;
    v.CloseAllSh1 = false; v.CloseAllSh3 = false;
    D.forEach((d) => {
      io[d.id] = {};
      switch (d.fb) {
        case "noria": fbs[d.id] = L.newNoria(); break;
        case "transporter": fbs[d.id] = L.newTransporter(); break;
        case "reverse": fbs[d.id] = L.newReverse(); break;
        case "meh": fbs[d.id] = L.newMeh(); break;
        case "zatvor": fbs[d.id] = L.newZatvor(); break;
        case "shiber": fbs[d.id] = L.newShiber(); break;
        case "dvpt": fbs[d.id] = L.newDvpt(); break;
        case "vibr": fbs[d.id] = L.newVibrator(); break;
        case "asp": fbs[d.id] = L.newAsp(); break;
        case "ohl": fbs[d.id] = L.newOhl(); break;
        default: fbs[d.id] = { kind: d.fb, run: false, da: false, mh: 0, amh: 0 };
      }
      v["fHand_" + d.id] = false;
    });
    // Дозаторы: 6 больших весов (K), 8 средних (D), УДЖК (масло)
    const DOZ = [];
    for (let i = 1; i <= 6; i++) DOZ.push({ id: "K" + i, scale: 1, bunk: 100 + i, idx: i });
    for (let i = 1; i <= 8; i++) DOZ.push({ id: "D" + i, scale: 2, bunk: 200 + i, idx: i });
    DOZ.forEach((z) => { fbs[z.id] = L.newDozator(); io[z.id] = { VesStolba: z.scale === 1 ? 1.2 : 0.12 }; });
    fbs.Jir = { kind: "udjk", phase: "idle", run: false, da: false, mh: 0, amh: 0 }; io.Jir = {};

    const G = { GEmer: false, ResetErrors: false, MGod: false, MAuto: true, MHand: false };
    const get = (k) => !!v[k];
    const handOf = (d) => !!(GROUPS[d.grp] ? GROUPS[d.grp].hand(v) : true) || get("fHand_" + d.id);
    const slowOf = (d) => !!(GROUPS[d.grp] ? GROUPS[d.grp].slow(v) : false);
    const tStop = (d) => (d.tc ? +v[d.tc] || 1 : d.tStop || 20);

    function scanDrive(d, dt) {
      const fb = fbs[d.id], t = d.id, x = io[d.id];
      const common = { HandMode: handOf(d), SlowHand: slowOf(d), io: x };
      switch (d.fb) {
        case "noria":
          L.noria(fb, { ...common, localPusk: get("LPusk_" + t) && get("Local_" + t), localStop: get("LStop_" + t),
            next: !!d.next(v), prev: !!d.prev(v), canRunAuto: !!d.auto(v), dp: get("DP_" + t), off_dp: true,
            dks: get("DKS_" + t), off_dks: get("OffDKS_" + t), dsl1: get("DSL1_" + t), dsl2: get("DSL2_" + t),
            off_dsl1: get("OffDSL1_" + t), off_dsl2: get("OffDSL2_" + t), AZ: get("ErrAz_" + t),
            timeBeforeStart: d.t1 || 5, timeToStop: tStop(d) }, dt, G);
          v["Go_" + t] = fb.run; break;
        case "transporter":
          L.transporter(fb, { ...common, localPusk: get("LPusk_" + t) && get("Local_" + t), localStop: get("LStop_" + t),
            next: !!d.next(v), prev: !!d.prev(v), canRunAuto: !!d.auto(v),
            errAZ: get("ErrAz_" + t) || (d.pch && get("ErrPCH_" + t)), dks: get("DKS_" + t), dksMustBlink: d.dksMustBlink,
            DKS_off: get("OffDKS_" + t) || !(d.sens || []).includes("dks"), DP: d.doorDp ? get("Door_" + t) : get("DP_" + t),
            DP_off: get("OffDP_" + t) || !((d.sens || []).includes("dp") || d.doorDp),
            timeBeforeStart: d.t1 || 5, timeToStop: tStop(d) }, dt, G);
          v["Go_" + t] = fb.run; break;
        case "reverse":
          L.reverseTr(fb, { ...common, localStop: get("LStop_" + t), next_left: !!d.nextL(v), next_right: !!d.nextR(v),
            prev: !!d.prev(v), canRunAutoLeft: !!d.autoL(v), canRunAutoRight: !!d.autoR(v), errAZ: get("ErrAz_" + t),
            dks: get("DKS_" + t), DKS_off: get("OffDKS_" + t), DP1: get("DP1_" + t), DP1_off: get("OffDP1_" + t),
            DP2: get("DP2_" + t), DP2_off: get("OffDP2_" + t), timeBeforeStart: d.t1, timeToStop: tStop(d) }, dt, G);
          v.GoL_Tr1 = fb.runL; v.GoR_Tr1 = fb.runR; v["Go_" + t] = fb.run; break;
        case "meh":
          L.mehanizm(fb, { ...common, next: !!d.next(v), prev: !!d.prev(v), canRunAuto: !!d.auto(v), AZ: get("ErrAz_" + t),
            ErrPCH: d.pch && get("ErrPCH_" + t), Door: d.door && get("Door_" + t), OffDoor: get("OffDoor_" + t),
            localStop: get("LStop_" + t), timeBeforeStart: d.t1 || 5, timeToStop: tStop(d) }, dt, G);
          v["Go_" + t] = fb.run; break;
        case "zatvor":
          L.zatvor(fb, { ...common, next: !!d.next(v), prev: !!d.prev(v), canRunAuto: !!d.auto(v), errAZ: get("ErrAz_" + t),
            dks: get("DKS_" + t), DKS_off: get("OffDKS_" + t), timeBeforeStart: d.t1, timeToStop: tStop(d) }, dt, G);
          v["Go_" + t] = fb.run; break;
        case "shiber":
          L.autoShiber(fb, { ...common, HandMode: d.autoMode ? false : common.HandMode, opened: get("Opened_" + t), closed: get("Closed_" + t),
            toOpen: !!d.toOpen(v), toClose: !!d.toClose(v), maxTTO: d.maxTTO || 10, errAZ: get("ErrAz_" + t) }, dt, G);
          v["Go_Open" + t] = fb.runToOpen; v["Go_Close" + t] = fb.runToClose; v["DA_" + t] = fb.da; break;
        case "dvpt":
          L.dvpt(fb, { ...common, curPos1: get(d.pos1), curPos2: get(d.pos2), toPos1: !!d.to1(v), toPos2: !!d.to2(v),
            maxTTO: d.maxTTO || 10, errAZ: get("ErrAz_" + t) }, dt, G);
          v["Go_" + t + "_1"] = fb.runToPos1; v["Go_" + t + "_2"] = fb.runToPos2; break;
        case "vibr":
          L.vibrator(fb, { RunAuto: !!d.runAuto(v) && !get("fHand_" + t), TimeAutoRun: d.tRun, TimeAutoSleep: d.tSleep,
            MaxTimeOn: d.max, AZ: get("ErrAz_" + t), io: x }, dt, G);
          v["Go_" + t] = fb.run; break;
        case "asp":
          L.asp(fb, { ...common, Az: get("ErrAz_" + t), AzGway: get("ErrAz_Gw" + t), dks: get("DKS_Gw" + t),
            offDks: get("OffDKS_Gw" + t), prev: !!d.prev(v), conditionToWork: !!d.cond(v), TTS: d.tts }, dt, G);
          v["Go_" + t] = fb.run; v["Go_Gw" + t] = fb.runGw; break;
        case "ohl":
          L.ohladitel(fb, { HandMode: v.MHand || get("fHand_Ohl"), io: x, Next: get("Go_Tr40700"), Prev: v.GranIsWork && !v.GranIsEmpty,
            Door: get("DoorOhlGr"), OffOpenDoor: get("OffDoorOhlGr"), DksStol: get("DKS_OhlGr"), DVU: get("DVU_OhlGr"),
            DSU: get("DSU_OhlGr") || (get("DNU_OhlGr") && v.GranIsEmpty), DNU: get("DNU_OhlGr"),
            Interval0: v.OhlTimeInt0, Interval1: v.OhlTimeInt1, Interval2: v.OhlTimeInt2, IntervalH: v.OhlTimeIntH,
            TempVozd: +v.TempOhlIn || 0, MaxTempVozd: v.MaxTempVozdOhl, TimeClear: v.TimeClearOhl,
            MustFree: v.OhlMustEmpty && !fb.isEmpty && !get("DNU_OhlGr"), canRunAuto: v.GranPath > 0 }, dt, G);
          v.OpenStol = fb.openStol; v.RunStol = fb.runStol; v.OhlIsEmpty = fb.isEmpty; v.Go_Ohl = fb.runStol; break;
        case "leb":
          // лебёдка: кнопки на месте (Btn_LebTo*) и в окне; концевики ставит модель
          v.Go_LebUp = !G.GEmer && (get("Btn_LebToUp") || !!x.up) && !get("Leb_Up"); v.Go_LebDn = !G.GEmer && (get("Btn_LebToDn") || !!x.down) && !get("Leb_Dn");
          v.Go_LebTo1 = !G.GEmer && (get("Btn_LebTo1") || !!x.to1) && !get("Leb_Pol1"); v.Go_LebTo2 = !G.GEmer && (get("Btn_LebTo2") || !!x.to2) && !get("Leb_Pol2");
          if (get("Leb_Up")) x.up = false; if (get("Leb_Dn")) x.down = false; if (get("Leb_Pol1")) x.to1 = false; if (get("Leb_Pol2")) x.to2 = false;
          fb.run = v.Go_LebUp || v.Go_LebDn || v.Go_LebTo1 || v.Go_LebTo2; v.Go_Leb = fb.run; break;
        default: break;
      }
    }

    const api = { v, fbs, io, D, DEF, DOZ, G, scan: null, prod: null };
    api.prod = global.PLCPROD ? global.PLCPROD.create(api) : (typeof require !== "undefined" ? require("./plc-prod.js").create(api) : null);

    function scan(dt) {
      // ---- MainCycle1: общие режимы, аварийные стопы, сброс
      if (tp(misc.tpPusk, L.ftrig(misc, "_fPusk", v.EmerPuskBtn), 2, dt)) v.ResetErrors = true;
      if (v.Regim2_14) v.ResetErrors = true;
      G.ResetErrors = !!v.ResetErrors;
      if (ton(misc.tonReset, !!v.Regim2_14, 2, dt)) v.Regim2_14 = false;
      v.EmerStopScada = !!v.Regim2_13;
      const est = ["EmerPuskBtn", "EmerStopShkaf", "EmerStopScalp", "EmerStopBunkZ", "EmerStopBunkD", "EmerStopBunkV", "EmerStopExit", "EmerStopUdjk", "EmerStopScada"];
      v.GEmer = G.GEmer = est.some(get) || get("EmerStopFire");
      if (G.ResetErrors) { v.Regim2_13 = false; v.ErrUnloadK = false; v.Err30_8 = false; v.ErrRKF = false; v.ErrLowPress = false; }
      v.MHand = G.MHand = !!v.Regim0;
      v.MGod = G.MGod = !!v.Regim1;
      v.MAuto = G.MAuto = !v.MHand;
      v.OnPchGr = !v.GEmer;
      ["Scalp", "TrDob", "Pit1", "Pit2", "TrSms"].forEach((k) => { v["RunPCH_" + k] = !v.GEmer; });
      if (v.GEmer && !misc.prevGEmer) api.prod.onEmergency();
      misc.prevGEmer = v.GEmer;
      if (get("ErrAz_Kompr") || get("LowPress")) v.ErrLowPress = true;

      // ---- программы участков (порядок задачи MAST)
      api.prod.loading(dt);
      api.prod.dosing(dt);
      api.prod.unload(dt);
      api.prod.gran(dt);
      D.forEach((d) => scanDrive(d, dt));
      api.prod.after(dt);

      // ---- сирена и лампа аварии
      const errCount = D.reduce((n, d) => n + (fbs[d.id].da ? 1 : 0), 0) + (v.GEmer ? 1 : 0) + (v.ErrLowPress ? 1 : 0) + (v.Err30_8 ? 1 : 0);
      const newErr = errCount > misc.prevErr; misc.prevErr = errCount;
      v.RunLamp = errCount > 0;
      const sirLoad = tp(misc.tpSirLoad, !!(v.Load1St0 || v.Regim2_9 || v.UnloadSt0 || v.GrStart), 5, dt);
      const sirErr = tp(misc.tpSiren, newErr, 2, dt);
      v.RunSirena = ((sirLoad || sirErr) && !v.Regim2_2) || !!v.Regim2_4;
      G.ResetErrors = false;
      if (v.ResetErrors && !v.Regim2_14) v.ResetErrors = false;
    }
    api.scan = scan;
    api.handOf = handOf;
    return api;
  }

  const api = { createPLC, D, DEF, GROUPS, TC_DEFAULT };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.PLC = api;
})(typeof window !== "undefined" ? window : globalThis);
