/* Комбикормовый завод «Бугры» — движение продукта, технологические
   процессы (дробление, смешивание, кондиционирование, прессование,
   охлаждение, просеивание), автотранспорт, журнал аварий и цикл модели. */

(function (global) {
  "use strict";
  const P = global.PLANT_CORE;
  const { S, C, EL, accept, takeFrom, sensors, drives, plc, V, run } = P;
  const M = S.machines;

  /* ============================================================ элементы тракта */
  function advance(e, dt) {
    const s = run(e.drive);
    e.flowAcc = 0;
    // выпуски по длине (открытые шиберы) — продукт падает сразу
    for (const o of e.outlets) {
      if (!o.when()) continue;
      const i = Math.min(e.N - 1, Math.floor(o.at * e.N));
      if (e.cells[i] > 0) { const a = accept(o.to, e.cells[i], e.kinds[i], e.prod); e.cells[i] -= a; e.flowAcc += a; }
    }
    // ДП срабатывает, только если продукт реально не уходит с выхода
    if (s <= 0.01) { e.flow *= 0.9; e.blocked = e.stuck && e.cells[e.N - 1] > e.cap * 2.4; return; }
    e.acc += (s * dt * e.N) / e.T;
    while (e.acc >= 1) {
      e.acc -= 1;
      let last = e.cells[e.N - 1];
      if (last > 0) {
        let toKg = last;
        if (e.waste) { const w = last * e.waste; accept("trash", w, "fines"); toKg -= w; }
        if (e.sieve) { const f = last * e.sieve; accept("Tr40800", f, "fines"); toKg -= f; }
        const d = e.to ? accept(e.to, toKg, e.kinds[e.N - 1], e.prod) : 0;
        e.cells[e.N - 1] = toKg - d;
        e.flowAcc += d + (last - toKg);
        last = e.cells[e.N - 1];
      }
      e.stuck = last > 1e-6;
      if (last < 1e-6) {
        for (let i = e.N - 1; i > 0; i--) { e.cells[i] = e.cells[i - 1]; e.kinds[i] = e.kinds[i - 1]; }
        e.cells[0] = 0;
      } else {
        // выход занят — продукт уплотняется к выходу (подпор)
        const max = e.cap * 2.6;
        for (let i = e.N - 1; i > 0; i--) {
          const m = Math.min(e.cells[i - 1], Math.max(0, max - e.cells[i]));
          if (m > 0) { e.cells[i] += m; e.cells[i - 1] -= m; e.kinds[i] = e.kinds[i - 1]; }
        }
      }
    }
    e.blocked = !!e.stuck && e.cells[e.N - 1] > e.cap * 1.6;
    e.flow += (e.flowAcc / Math.max(dt, 1e-3) - e.flow) * Math.min(1, dt * 2);
  }
  // загрузка из ёмкости в начало элемента — не больше номинальной загрузки ячейки
  const feed = (e, kg, kind, prod) => { const a = Math.min(kg, Math.max(0, e.cap * 1.05 - e.cells[0])); e.cells[0] += a; if (a > 0) { e.kinds[0] = kind; if (prod) e.prod = prod; } return a; };
  const mass = (e) => e.cells.reduce((a, b) => a + b, 0);

  /* ============================================================ процессы */
  const rawName = (b) => (C[b].prod || "");
  function process(dt) {
    // ---- загрузка: завальная яма → транспортёр
    if (run("TrHole") > 0.2) { const a = takeFrom("pit", 5.6 * run("TrHole") * dt); const back = a - feed(EL.TrHole, a, "grain", C.pit.prod); C.pit.mass += back; }
    // ---- дозаторы: бункер → весы (шнек под бункером, скорость по частоте ПЧ)
    // продукт из шнека летит до весов ~0,7 с — это и есть «падающий столб»
    S.fly = S.fly || { scale1: 0, scale2: 0 };
    plc.DOZ.forEach((z) => {
      const m = M[z.id]; if (m.spin < 0.05) return;
      const b = "b" + z.bunk, scale = z.scale === 1 ? "scale1" : "scale2";
      if (M[z.id].sim.jam || C[b].vault) return;                 // свод в бункере
      const q = (z.scale === 1 ? 4.2 : 0.32) * m.spin * (0.92 + 0.16 * Math.sin(S.clock * 3 + z.idx));
      const a = takeFrom(b, q * dt);
      S.fly[scale] += a; C[scale].prod = rawName(b);
    });
    ["scale1", "scale2"].forEach((k) => {
      const a = S.fly[k] * Math.min(1, dt / 0.7);
      S.fly[k] -= accept(k, a, k === "scale1" ? "grain" : "add", C[k].prod);
    });
    // ---- разгрузка весов
    if (V.Opened_ZatvK || M.ZatvK.pos > 0.4) { const a = takeFrom("scale1", 16 * M.ZatvK.pos * dt); C.scale1.mass += a - feed(EL.TrKomp, a, "grain", "Компоненты"); }
    if (V.Opened_ZatvD || M.ZatvD.pos > 0.4) { const a = takeFrom("scale2", 3 * M.ZatvD.pos * dt); C.scale2.mass += a - feed(EL.TrDob, a, "add", "Добавки"); }
    // ---- НДБ → питатели → дробилки (магнитные сепараторы на входе)
    [1, 2].forEach((n) => {
      const pit = EL["Pit" + n];
      if (run("Pit" + n) > 0.05) { const a = takeFrom("PBD", 1.6 * run("Pit" + n) * dt); C.PBD.mass += a - feed(pit, a, "grain", "Компоненты"); }
      const d = C["Drob" + n], m = M["Drob" + n];
      const grind = m.spin > 0.5 ? Math.min(d.mass, 2.4 * m.spin * dt) : 0;
      const out = grind > 0 ? accept("TrDrob", grind, "meal", "Дерть") : 0;
      d.mass -= out;
      m.load = m.load === undefined ? 0 : m.load + ((out / Math.max(dt, 1e-3)) - m.load) * Math.min(1, dt * 1.5);
      const nom = V["TokNom" + n], xx = V.TokXX;
      const accel = m.spin > (m.prevSpin || 0) + 1e-6; m.prevSpin = m.spin;
      const inrush = accel && m.spin < 0.93 ? (1 - m.spin) * 5.5 * nom : 0;
      const tgt = m.spin > 0.02 ? xx * m.spin + m.load * ((nom - xx) / 1.35) + inrush + (Math.random() - 0.5) * 6 : 0;
      m.current = Math.max(0, m.current + (tgt - m.current) * Math.min(1, dt * 3));
      V["TokDrob" + n] = Math.round(m.current);
      m.hammerWear = (m.hammerWear || 0) + (out * 1e-6);
    });
    // ---- НСБ → смеситель → ПСБ
    if (M.KlapSms.pos > 0.3) { const a = takeFrom("UpBunk", 32 * M.KlapSms.pos * dt); C.UpBunk.mass += a - accept("Sms", a, "mash", C.UpBunk.prod); }
    if (C.Sms.mass > 1 && M.Sms.spin > 0.2) C.Sms.kind = "mash";
    if (M.ShDownSms.pos > 0.3 && M.Sms.spin > 0.3) {
      const a = takeFrom("Sms", 26 * M.ShDownSms.pos * dt); C.Sms.mass += a - accept("DownBunk", a, "mash", S.curProduct || C.Sms.prod);
    }
    if (run("TrSms") > 0.05) { const a = takeFrom("DownBunk", 6 * run("TrSms") * dt); C.DownBunk.mass += a - feed(EL.TrSms, a, "mash", C.DownBunk.prod); }
    // ---- УДЖК: насос долива из ВЖД4 в весовую ёмкость, подача масла в смеситель
    V.FlowMaslo = 0;
    if (V.Go_MasloDop && !M.Jir.sim.az && !M.Jir.sim.pump) { const a = takeFrom("tankOil", 0.7 * dt); V.FlowMaslo = a / dt; C.tankOil.mass += a - accept("Jir", a, "oil", "Масло"); }
    if (V.Go_MasloDos && M.ClapMasloOut.pos > 0.5) { const a = takeFrom("Jir", 0.45 * dt); C.Jir.mass += a - accept("Sms", a, "mash"); S.oilInMix = (S.oilInMix || 0) + a; }
    M.Jir.spin = V.Go_MasloDop || V.Go_MasloDos ? 1 : Math.max(0, M.Jir.spin - dt);
    // ---- гранулирование: БО-5 → питатель → кондиционер (пар) → пресс → шлюз → охладитель
    if (run("PitGr") > 0.03) {
      const vib = (V.Go_VibrG1 || V.Go_VibrG2) ? 1 : 0;
      const vault = C.PBGran.vault && !vib;
      const a = vault ? 0 : takeFrom("PBGran", 1.0 * run("PitGr") * dt);
      C.PBGran.mass += a - feed(EL.PitGr, a, "mash", C.PBGran.prod);
      V.PitNoFlow = vault || (C.PBGran.mass > 60 && a < 0.2 * dt);
      if (vib && C.PBGran.vault && Math.random() < dt * 0.3) C.PBGran.vault = false;
    }
    const kond = C.Kond, km = M.KondGr;
    const kOut = km.spin > 0.4 ? Math.min(kond.mass, (kond.mass / 6 + 0.02) * dt) : 0;
    const kDel = accept("Gran", kOut, "mash", kond.prod); kond.mass -= kDel;
    S.kondFlow = (S.kondFlow || 0) + (kDel / Math.max(dt, 1e-3) - (S.kondFlow || 0)) * Math.min(1, dt);
    // температура после кондиционера: пар греет продукт, поток уносит тепло
    const steamOk = !S.noSteam;
    const flowR = Math.max(0.2, S.kondFlow / 0.9);
    const teq = S.ambient + (steamOk ? 92 * (V.SteamValve || 0) / 100 / Math.sqrt(flowR) : 0);
    S.tKond = S.tKond === undefined ? S.ambient : S.tKond + (Math.min(99, teq) - S.tKond) * Math.min(1, dt / (km.spin > 0.3 ? 22 : 60));
    V.TempKond = +(S.tKond + (Math.random() - 0.5) * 0.3).toFixed(1);
    V.Steam = steamOk ? +(0.6 * (V.SteamValve || 0) / 100 * 4.5).toFixed(2) : 0;   // кг/мин пара (условно)
    // пресс-гранулятор: ток зависит от производительности и температуры
    const g = C.Gran, gm = M.Gran;
    const can = gm.spin > 0.9 && !S.dieJam && (run("ZatvOhl") > 0.5 || C.Ohl.mass < C.Ohl.cap);
    const pel = can ? Math.min(g.mass, (g.mass / 2.2 + 0.01) * dt) : 0;
    let pDel = 0;
    if (pel > 0) {
      S.tPellet = (V.TempKond || 20) + 7;
      if (run("ZatvOhl") > 0.4) { pDel = accept("Ohl", pel, "pellet", "Гранулы " + (S.curProductShort || "")); }
      else { S.gateHold = (S.gateHold || 0) + pel; pDel = pel; }      // шлюз стоит — гранулы копятся над шлюзом
      g.mass -= pDel;
    }
    if (run("ZatvOhl") > 0.4 && S.gateHold) { const a = accept("Ohl", S.gateHold, "pellet"); S.gateHold -= a; }
    S.granFlow = (S.granFlow || 0) + (pDel / Math.max(dt, 1e-3) - (S.granFlow || 0)) * Math.min(1, dt * 0.8);
    const cold = Math.max(0, V.TempKondSet - (V.TempKond || 0)) / 32;
    const gAcc = gm.spin > (gm.prevSpin || 0) + 1e-6; gm.prevSpin = gm.spin;
    const inr = gAcc && gm.spin < 0.93 ? (1 - gm.spin) * 2.2 * V.TokNomGran : 0;
    const tgtI = gm.spin > 0.02 ? V.TokXX * 1.1 * gm.spin + S.granFlow * 250 * (1 + cold) + inr + (g.mass > g.cap * 0.95 ? 120 : 0) + (Math.random() - 0.5) * 8 : 0;
    gm.current = Math.max(0, gm.current + (tgtI - gm.current) * Math.min(1, dt * 2));
    V.TokGran = Math.round(gm.current);
    V.TokPitGr = Math.round(run("PitGr") * 6.5 + (run("PitGr") > 0.05 ? 1.2 : 0));
    if (gm.current > V.TokMaxGran * 1.08 && gm.spin > 0.9) S.jamT = (S.jamT || 0) + dt; else S.jamT = 0;
    if (S.jamT > 4) { S.dieJam = true; }
    if (V.ResetErrors && !V.Go_Gran && S.dieJam) { S.dieJam = false; accept("trash", g.mass, "fines"); g.mass = 0; P.log("Матрица гранулятора очищена"); }
    // ---- охладитель: противоток воздуха, стол выгружает по ходам (ДКС стола)
    const o = C.Ohl, om = M.Ohl, fan = M.AspGr.spin;
    const tau = fan > 0.5 ? 170 : 900;
    o.temp = (o.temp === undefined ? S.ambient : o.temp) + ((S.ambient + 4) - o.temp) * Math.min(1, dt / tau);
    V.TempOhlIn = +((fan > 0.3 ? S.ambient + 0.55 * (o.temp - S.ambient) * Math.min(1, o.mass / 120) : S.ambient + 3) + (om.sim.hot ? 60 : 0)).toFixed(1);
    V.TempGranOut = +o.temp.toFixed(1);
    om.ph = (om.ph || 0) + (V.RunStol ? dt / 2.4 : 0);
    om.spin = V.RunStol ? 1 : 0; om.pos = V.OpenStol ? 1 : V.RunStol ? 0.5 + 0.5 * Math.sin(om.ph * Math.PI * 2) : 0;
    V.DKS_OhlGr = (om.ph % 1) > 0.82 && !om.sim.dks;      // метка на валу стола видна и при остановленном столе
    const disch = (V.RunStol ? 14 : 0) + (V.OpenStol ? 4 : 0);        // ход стола сбрасывает ~30 кг слоя
    if (disch > 0 && o.mass > 0) { const a = takeFrom("Ohl", disch * dt); const d = feed(EL.Tr40700, a, o.temp > 35 ? "pellet" : "pellet", o.prod); o.mass += a - d; }
    // пыль в циклон (вентилятор аспирации), шлюз циклона — в шнек 40800
    if (fan > 0.5 && S.granFlow > 0.05) accept("cyc", S.granFlow * 0.015 * dt, "fines");
    if ((M.AspGr.spinGw || 0) > 0.5 && C.cyc.mass > 0) { const a = takeFrom("cyc", 0.4 * dt); C.cyc.mass += a - feed(EL.Tr40800, a, "fines"); }
    // ---- биг-бег: затвор под бункером 51300
    if (S.bagValve && S.leb && V.Leb_Dn && C.s10.mass > 0) { const a = takeFrom("s10", 2 * dt); C.s10.mass += a - accept("bigbag", a, "pellet", C.s10.prod); }
    // ---- шлюзы аспираций АС-1/АС-2: пыль — в отходы
    ["Asp1", "Asp2"].forEach((k) => { M[k].dust = (M[k].dust || 0) + (M[k].spin > 0.5 ? dt * 0.002 : 0); });
    // ---- продвижение по элементам
    Object.values(EL).forEach((e) => advance(e, dt));
  }

  /* ============================================================ автотранспорт */
  const SILO_X = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 0, 6: 1, 7: 2, 8: 3, 9: 0 };
  function trucks(dt) {
    const t0 = S.trucks.truck_in;
    // самосвал к завальной яме
    if (t0.phase === "park" && S.autoTrucks && C.pit.mass < C.pit.cap * 0.3) { t0.phase = "arrive"; t0.x = -1; t0.load = 1; t0.material = S.pitMaterial || "Пшеница"; }
    if (t0.phase === "arrive") { t0.x = Math.min(0, t0.x + dt / 6); if (t0.x >= 0) t0.phase = "tip"; }
    if (t0.phase === "tip") {
      t0.tilt = Math.min(1, (t0.tilt || 0) + dt / 4);
      if (t0.tilt >= 1 && t0.load > 0) { const a = Math.min(t0.load * 10000, 220 * dt); const d = accept("pit", a, "grain", t0.material); t0.load -= d / 10000; S.pitDump = d > 0; if (d < a * 0.5) t0.load = 0; }
      if (t0.load <= 0.001) { t0.phase = "untip"; S.pitDump = false; }
    }
    if (t0.phase === "untip") { t0.tilt = Math.max(0, t0.tilt - dt / 4); if (t0.tilt <= 0) { t0.phase = "leave"; P.log(`Самосвал разгружен в завальную яму: ${t0.material}`); } }
    if (t0.phase === "leave") { t0.x += dt / 6; if (t0.x > 1.2) { t0.phase = "gone"; t0.wait = 25; } }
    if (t0.phase === "gone") { t0.wait -= dt; if (t0.wait <= 0) { t0.phase = "park"; t0.x = 0; t0.load = 1; t0.parked = true; } }
    // машины под бункерами готовой продукции
    [["truck_g1", [1, 2, 3, 4]], ["truck_g2", [5, 6, 7, 8]], ["truck_g3", [9]]].forEach(([id, silos]) => {
      const t = S.trucks[id];
      if (t.phase === "away" && S.autoTrucks) {
        const best = silos.filter((s) => C["s" + s].mass > C["s" + s].cap * (s === 9 ? 0.45 : 0.55)).sort((a, b) => C["s" + b].mass - C["s" + a].mass)[0];
        if (best || t.req) { t.silo = t.req || best; t.req = 0; t.phase = "arrive"; t.x = 1.4; t.load = 0; }
      }
      if (t.phase === "arrive") { const tx = SILO_X[t.silo] / 3.6; t.x = Math.max(tx, t.x - dt / 7); if (t.x <= tx + 1e-3) { t.phase = "load"; V["LOpen_ShO" + t.silo] = true; V.UnBlockSilos[t.silo] = true; } }
      if (t.phase === "load") {
        V["LOpen_ShO" + t.silo] = M["ShO" + t.silo].pos < 0.98 && !t.closeReq;
        const sh = M["ShO" + t.silo];
        if (sh.pos > 0.2) { const a = takeFrom("s" + t.silo, 30 * sh.pos * dt); t.load += a / 20000; t.prod = C["s" + t.silo].prod; }
        if ((t.load >= 1 || C["s" + t.silo].mass < 5) && !t.closeReq) { t.closeReq = true; }
        V["LClose_ShO" + t.silo] = !!t.closeReq && sh.pos > 0.02;
        if (t.closeReq && sh.pos <= 0.02) { t.closeReq = false; V["LClose_ShO" + t.silo] = false; V.UnBlockSilos[t.silo] = false; t.phase = "leave"; P.log(`Автомобиль загружен из бункера ${300 + t.silo}: ${(t.load * 20).toFixed(1)} т «${t.prod || ""}»`); }
      }
      if (t.phase === "leave") { t.x += dt / 7; if (t.x > 1.4) { t.phase = "away"; t.load = 0; } }
    });
    // подсобный рабочий досыпает добавки в бункеры 201–208
    if (S.autoAdd) for (let i = 1; i <= 8; i++) { const c = C["b" + (200 + i)]; if (c.mass < c.cap * 0.15) c.refill = true; if (c.refill) { if ((S.clock % 4) < dt) c.mass = Math.min(c.cap * 0.85, c.mass + 25); if (c.mass >= c.cap * 0.84) c.refill = false; } }
    if (C.tankOil.mass < 200 && S.autoTrucks) { C.tankOil.mass += 0.9 * dt * 10; }
  }

  /* ============================================================ журнал аварий */
  const ERRS = {
    noria: [["errAZ", "сработал автомат защиты"], ["errDKS", "авария ДКС — нет импульсов / пробуксовка ленты"], ["errDSL1", "сбег ленты (ДСЛ 1)"], ["errDSL2", "сбег ленты (ДСЛ 2)"], ["errDP", "подпор"]],
    transporter: [["err_AZ", "сработал автомат защиты / авария ПЧ"], ["err_DKS", "авария ДКС — вал не вращается"], ["err_DP", "подпор (датчик подпора)"]],
    reverse: [["err_AZ", "сработал автомат защиты"], ["err_DKS", "авария ДКС"], ["err_DP", "подпор"]],
    meh: [["errAZ", "сработал автомат защиты"], ["errPCH", "авария преобразователя частоты"], ["errDoor", "открыта дверь (люк)"]],
    zatvor: [["err_AZ", "сработал автомат защиты"], ["err_DKS", "авария ДКС — ротор не вращается"]],
    shiber: [["errLT", "долгое переключение"], ["errKonc", "авария концевиков (оба замкнуты)"], ["errAZOut", "сработал автомат защиты"]],
    dvpt: [["errLT", "долгое переключение"], ["errKonc", "авария концевиков"], ["errAZOut", "сработал автомат защиты"]],
    klap: [["errLTOpen", "не открылся за отведённое время"], ["errLTClose", "не закрылся за отведённое время"], ["errKonc", "авария концевиков"]],
    vibr: [["ErrAZ", "сработал автомат защиты"]],
    asp: [["errAZ", "авария вентилятора"], ["errAZGw", "авария шлюзового затвора"], ["errDKS", "шлюзовый затвор: авария ДКС"]],
    dozator: [["errPCH", "авария ПЧ дозаторов"], ["errDKS", "авария ДКС"], ["errDP", "подпор"]],
    ohl: [["errDoor", "открыта дверь охладителя"], ["errTemp", "перегрев воздуха на выходе"], ["errDksStol", "авария ДКС стола"]],
  };
  const GLOBAL = [
    ["EmerPuskBtn", "Не нажат «ПУСК» на шкафу управления"], ["EmerStopShkaf", "Нажат аварийный стоп на шкафу"],
    ["EmerStopScalp", "Нажат аварийный стоп у завальной ямы"], ["EmerStopBunkZ", "Нажат аварийный стоп у бункеров загрузки"],
    ["EmerStopBunkD", "Нажат аварийный стоп у бункеров добавок"], ["EmerStopBunkV", "Нажат аварийный стоп у бункеров выгрузки"],
    ["EmerStopExit", "Нажат аварийный стоп у лестницы"], ["EmerStopUdjk", "Нажат аварийный стоп у УДЖК"],
    ["EmerStopScada", "Аварийный стоп со SCADA"], ["EmerStopFire", "Пожарная сигнализация"],
    ["ErrLowPress", "Авария компрессора — низкое давление воздуха"], ["Err30_8", "Гранулятор: перегрузка главного привода (забивание матрицы)"],
    ["ErrUnloadK", "Большие весы не разгружаются более 4 мин"], ["GrHotStopLoad", "Гранулятор: низкая температура после кондиционера — подача остановлена"],
    ["PolnSiloCur", "Бункер готовой продукции заполнен"],
  ];
  function scanAlarms() {
    const now = new Date();
    const active = new Map();
    for (const [id, fb] of Object.entries(plc.fbs)) {
      const list = ERRS[fb.kind]; if (!list) continue;
      for (const [k, txt] of list) if (fb[k]) active.set(id + ":" + k, `${M[id] ? M[id].poz + " " : ""}${(M[id] && M[id].name) || id}: ${txt}`);
    }
    for (const [k, txt] of GLOBAL) if (V[k]) active.set("G:" + k, txt);
    if (plc.prod.S.jir.tryFail) active.set("G:oil", "Не удаётся долить масло в весовую ёмкость УДЖК");
    // новые
    for (const [key, text] of active) {
      if (!S.alarms.some((a) => a.key === key && a.active)) {
        const a = { key, text, t: now, active: true, kind: key.startsWith("G:Poln") || key.startsWith("G:GrHot") ? "warn" : "bad" };
        S.alarms.unshift(a); S.archive.unshift({ ...a, state: "Возникла" });
        if (S.onAlarm) S.onAlarm(a);
      }
    }
    for (const a of S.alarms) if (a.active && !active.has(a.key)) { a.active = false; a.tEnd = now; S.archive.unshift({ ...a, t: now, state: "Ушла" }); }
    S.alarms = S.alarms.filter((a) => a.active || now - a.t < 120000).slice(0, 200);
    S.archive.length = Math.min(S.archive.length, 1000);
    // события программ
    const ev = plc.prod.S.events;
    while (ev.length) { const e = ev.shift(); P.log(e.text, e.kind); }
  }
  P.log = (text, kind) => { S.log.unshift({ t: new Date(), text, kind: kind || "info" }); S.log.length = Math.min(S.log.length, 400); if (S.onLog) S.onLog(text, kind); };

  /* ============================================================ цикл */
  function step(dt) {
    S.clock += dt;
    const ps = plc.prod.S;
    if (ps.mixJob) { S.curProduct = ps.mixJob.pp.product; S.curProductShort = ps.mixJob.pp.code || ""; }
    sensors(dt);
    plc.scan(dt);
    drives(dt);
    process(dt);
    trucks(dt);
    if ((S._al = (S._al || 0) + dt) > 0.25) { S._al = 0; scanAlarms(); }
  }
  let acc = 0;
  function tick(realDt) {
    acc += Math.min(0.25, realDt) * S.timeScale;
    let n = 0;
    while (acc >= S.scanDt && n < 400) { step(S.scanDt); acc -= S.scanDt; n++; }
  }
  // Мгновенно прокрутить модель (тесты, «перемотка»)
  function runFor(sec) { const n = Math.round(sec / S.scanDt); for (let i = 0; i < n; i++) step(S.scanDt); }

  /* ============================================================ сохранение (RETAIN) */
  const KEY = "bugry-sim-v1";
  const RETAIN = ["Regim2_6", "UsedDrob", "TokNom1", "TokNom2", "TokMax1", "TokMax2", "TokNomGran", "TokMaxGran", "TempKondSet", "TempKondMin",
    "ppPwStart", "ppPwTarg", "ppPwDelta", "ppInterval", "OhlTimeInt0", "OhlTimeInt1", "OhlTimeInt2", "OhlTimeIntH", "TimeClearOhl", "MaxTempVozdOhl",
    "DopOstBig", "DopOstMid", "AutoGrStart", ...Object.keys(global.PLC.TC_DEFAULT)];
  function save() {
    try {
      const o = { v: {}, hours: {}, opt: { autoTrucks: S.autoTrucks, autoAdd: S.autoAdd, timeScale: S.timeScale }, stolb: {} };
      RETAIN.forEach((k) => { o.v[k] = V[k]; });
      for (const [id, m] of Object.entries(M)) o.hours[id] = [m.hours, m.hoursTotal, m.toHours];
      plc.DOZ.forEach((z) => { o.stolb[z.id] = plc.io[z.id].VesStolba; });
      localStorage.setItem(KEY, JSON.stringify(o));
    } catch (e) { /* хранилище недоступно */ }
  }
  function load() {
    try {
      const o = JSON.parse(localStorage.getItem(KEY) || "null"); if (!o) return;
      RETAIN.forEach((k) => { if (o.v[k] !== undefined && o.v[k] !== null) V[k] = o.v[k]; });
      for (const [id, h] of Object.entries(o.hours || {})) if (M[id]) [M[id].hours, M[id].hoursTotal, M[id].toHours] = h;
      Object.assign(S, o.opt || {});
      for (const [id, s] of Object.entries(o.stolb || {})) if (plc.io[id]) plc.io[id].VesStolba = s;
    } catch (e) { /* повреждённые данные — значения по умолчанию */ }
  }
  if (typeof localStorage !== "undefined") { load(); setInterval(save, 5000); }

  const PLANT = Object.assign(P, { step, tick, runFor, save, load, mass, ERRS, scanAlarms });
  if (typeof module !== "undefined" && module.exports) module.exports = PLANT;
  global.PLANT = PLANT;
})(typeof window !== "undefined" ? window : globalThis);
