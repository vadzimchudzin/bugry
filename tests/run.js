// Сценарные тесты эмулятора «Бугры» без браузера: node tests/run.js [имя]
"use strict";
const assert = require("assert");
const loadSim = require("./load.js");

function fresh() {
  const P = loadSim();
  P.V.EmerPuskBtn = false;           // «ПУСК» на шкафу нажат
  P.runFor(3);
  return P;
}
function until(P, cond, maxSec, step) {
  for (let t = 0; t < maxSec; t += step || 5) { P.runFor(step || 5); if (cond()) return t; }
  return -1;
}
const total = (P, ids) => ids.reduce((a, k) => a + P.C[k].mass, 0);

const TESTS = {
  "россыпь: ПП из 3 порций выполняется и выгружается в бункер 302"() {
    const P = fresh(), { C, V, plc } = P, DB = globalThis.DB;
    const s2 = C.s2.mass;
    const r = DB.buildProgram({ id: 1, name: "t", product: "КК-60", total: 1200, unload: [2] });
    assert.ok(!r.error, r.error);
    plc.prod.cmd.activate(r.prog); plc.prod.cmd.setUnloadList([2]);
    assert.strictEqual(plc.prod.cmd.startProduction(), null);
    const t = until(P, () => r.prog.status === "выполнена" && !V.Regim2_10 && C.DownBunk.mass < 5, 2400, 10);
    assert.ok(t > 0, "программа не завершилась: " + plc.prod.S.msg);
    assert.strictEqual(r.prog.done, 3);
    P.runFor(120);
    const got = C.s2.mass - s2;
    assert.ok(got > 1100 && got < 1300, `в бункер 302 пришло ${got.toFixed(0)} кг, ожидалось ≈1200`);
    assert.ok(/КК-60/.test(C.s2.prod), "продукт в бункере: " + C.s2.prod);
    assert.ok(!P.S.alarms.some((a) => a.active && a.kind === "bad"), "аварии: " + P.S.alarms.map((a) => a.text));
  },

  "гранулы: продукт проходит пресс и охладитель в бункер 304"() {
    const P = fresh(), { C, V, plc } = P, DB = globalThis.DB;
    const s4 = C.s4.mass;
    const r = DB.buildProgram({ id: 2, name: "g", product: "КК-61Г", total: 760, unload: [4] });
    assert.ok(!r.error, r.error);
    plc.prod.cmd.activate(r.prog); plc.prod.cmd.setUnloadList([4]);
    assert.strictEqual(plc.prod.cmd.startProduction(), null);
    let maxI = 0, maxT = 0;
    const t = until(P, () => { maxI = Math.max(maxI, V.TokGran); maxT = Math.max(maxT, V.TempKond); return r.prog.status === "выполнена" && !V.GranUnlRun; }, 3600, 10);
    assert.ok(t > 0, `гранулирование не завершилось: ${plc.prod.S.msg}, GrStart=${V.GrStart}, БО-5=${C.PBGran.mass.toFixed(0)}`);
    assert.ok(!V.Err30_8, "забивание матрицы");
    assert.ok(maxI > V.TokXX + 50, "ток пресса не рос: " + maxI);
    assert.ok(maxT > 60, "кондиционер не нагрел продукт: " + maxT);
    const got = C.s4.mass - s4;
    assert.ok(got > 600, `в бункер 304 пришло ${got.toFixed(0)} кг гранул`);
    assert.strictEqual(C.s4.kind, "pellet");
  },

  "загрузка БВ: зерно из завальной ямы в бункер 101"() {
    const P = fresh(), { C, V, plc } = P;
    const b = C.b101.mass, pit = C.pit.mass;
    plc.prod.cmd.startLoad(C.pit.prod, [1], true);
    P.runFor(150);
    assert.ok(V.Go_TrHole && V.Go_NorHole && V.Go_Nor1 && V.GoL_Tr1 && V.Go_Tr1L, "тракт загрузки не запущен");
    assert.ok(V.Opened_ShL1, "шибер бункера 101 не открыт");
    const got = C.b101.mass - b;
    assert.ok(got > 300, `в бункер 101 пришло ${got.toFixed(0)} кг`);
    assert.ok(pit - C.pit.mass > got, "масса не сходится");
    plc.prod.cmd.stopLoad();
    P.runFor(90);
    assert.ok(!V.Go_TrHole && !V.Go_Nor1, "тракт не остановился после «Стоп»");
  },

  "аварийный стоп: все приводы отключаются, после ПУСК — снова готов"() {
    const P = fresh(), { C, V, plc } = P;
    plc.prod.cmd.startLoad(C.pit.prod, [4], true);
    P.runFor(60);
    assert.ok(V.Go_Nor1, "нория 10400 не запущена");
    V.EmerStopShkaf = true; P.runFor(1);
    assert.ok(V.GEmer, "нет общей аварии");
    assert.ok(plc.D.every((d) => !plc.fbs[d.id].run), "есть работающие приводы при GEmer");
    V.EmerStopShkaf = false; V.EmerPuskBtn = true; P.runFor(1); V.EmerPuskBtn = false; P.runFor(3);
    assert.ok(!V.GEmer, "общая авария не снята");
  },

  "неисправность: обрыв ДКС нории → авария, сброс после устранения"() {
    const P = fresh(), { C, V, plc, S } = P;
    plc.prod.cmd.startLoad(C.pit.prod, [1], true);
    P.runFor(40);
    assert.ok(V.Go_NorHole);
    S.machines.NorHole.sim.dks = true;
    P.runFor(6);
    assert.ok(plc.fbs.NorHole.errDKS && plc.fbs.NorHole.da, "нет аварии ДКС");
    assert.ok(!V.Go_NorHole && !V.Go_TrHole, "нория или предыдущий транспортёр не остановлены");
    assert.ok(S.alarms.some((a) => a.active && /10200/.test(a.text)), "нет записи в журнале аварий");
    S.machines.NorHole.sim.dks = false;
    V.Regim2_14 = true; P.runFor(3);
    assert.ok(!plc.fbs.NorHole.da, "авария не сброшена");
    P.runFor(30);
    assert.ok(V.Go_NorHole, "нория не перезапустилась в автомате");
  },

  "дозатор: свод в бункере → «нет прироста веса»"() {
    const P = fresh(), { C, V, plc } = P, DB = globalThis.DB;
    const r = DB.buildProgram({ id: 3, name: "v", product: "КК-60", total: 400, unload: [2] });
    plc.prod.cmd.activate(r.prog); plc.prod.cmd.setUnloadList([2]);
    plc.prod.cmd.startProduction();
    const first = r.prog.comps.find((c) => c.place === "БВ").bunk;
    C["b" + first].vault = true;
    P.runFor(80);
    const warn = P.S.log.filter((l) => /нет прироста веса/.test(l.text)).length;
    assert.strictEqual(warn, 1, "сообщений о своде: " + warn);
    C["b" + first].vault = false;
    const t = until(P, () => plc.prod.S.kJob && plc.prod.S.kJob.K[0].status === "сдозировано", 120, 2);
    assert.ok(t >= 0, "дозирование не продолжилось после устранения свода");
  },
};

const only = process.argv[2];
let fail = 0;
for (const [name, fn] of Object.entries(TESTS)) {
  if (only && !name.includes(only)) continue;
  const t0 = Date.now();
  try { fn(); console.log(`✔ ${name} (${((Date.now() - t0) / 1000).toFixed(1)} с)`); }
  catch (e) { fail++; console.log(`✘ ${name}\n   ${e.message}`); }
}
process.exit(fail ? 1 : 0);
