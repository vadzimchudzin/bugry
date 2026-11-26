/* База данных SCADA «Бугры»: сырьё, сырьевые бункеры, рецепты, готовая
   продукция, программы производства, бункеры ГП. В оригинале — SQL-база
   SCADA; здесь хранится в браузере (localStorage). Таблицы и поля — как на
   экранах «Сырьё», «Сырьевые бункера», «Рецепты», «Готовая продукция»,
   «Программы производства», «Бункера ГП». */

(function (global) {
  "use strict";
  const KEY = "bugry-db-v1";

  const RAW = [
    // name, code, место приёмки, место дозирования, плотность, допуск -%, +%, очистка
    ["Пшеница", 1001, "Завальная яма зерна", "БВ", 760, 2, 2, true],
    ["Ячмень", 1002, "Завальная яма зерна", "БВ", 640, 2, 2, true],
    ["Кукуруза", 1003, "Завальная яма зерна", "БВ", 720, 2, 2, true],
    ["Тритикале", 1004, "Завальная яма зерна", "БВ", 700, 2, 2, true],
    ["Овёс", 1005, "Завальная яма зерна", "БВ", 500, 2, 2, true],
    ["Горох", 1006, "Завальная яма зерна", "БВ", 780, 2, 2, true],
    ["Шрот подсолнечный", 2001, "Ручная засыпка", "СВ", 550, 3, 3, false],
    ["Шрот соевый", 2002, "Ручная засыпка", "СВ", 600, 3, 3, false],
    ["Мел кормовой", 2003, "Ручная засыпка", "СВ", 1100, 3, 3, false],
    ["Соль поваренная", 2004, "Ручная засыпка", "СВ", 1200, 3, 3, false],
    ["Премикс КРС", 2005, "Ручная засыпка", "СВ", 700, 2, 2, false],
    ["Монокальцийфосфат", 2006, "Ручная засыпка", "СВ", 900, 3, 3, false],
    ["Дрожжи кормовые", 2007, "Ручная засыпка", "СВ", 600, 3, 3, false],
    ["Жмых рапсовый", 2008, "Ручная засыпка", "СВ", 620, 3, 3, false],
    ["Масло растительное", 3001, "ВЖД", "УДЖК", 920, 5, 5, false],
  ].map(([name, code, recv, place, dens, tm, tp, clean]) => ({ name, code, recv, place, dens, tm, tp, clean, s4: 100, s3: 60, s2: 40, s1: 10, to3: place === "БВ" ? 30 : 3, to2: place === "БВ" ? 20 : 2, to1: place === "БВ" ? 10 : 1, korr: 1 }));

  const BUNKERS = [];
  [[101, 1001, 20], [102, 1002, 20], [103, 1003, 20], [104, 1004, 15], [105, 1005, 15], [106, 1006, 15]].forEach(([n, c, vol]) => BUNKERS.push({ n, code: c, vol, place: "БВ", blockLoad: false, blockDos: false, auto: true, zachistka: false }));
  [201, 202, 203, 204, 205, 206, 207, 208].forEach((n, i) => BUNKERS.push({ n, code: 2001 + i, vol: 0.15, place: "СВ", blockLoad: false, blockDos: false, auto: true, zachistka: false }));
  BUNKERS.push({ n: 501, code: 3001, vol: 2, place: "УДЖК", blockLoad: false, blockDos: false, auto: true, zachistka: false });

  // Рецепты: компоненты в % ввода (сумма 100 %)
  const RECIPES = [
    { name: "КК-60 для коров", code: "КК-60", comps: [[1001, 28], [1002, 30], [1003, 15], [1004, 8], [2001, 9], [2002, 4], [2003, 1.6], [2004, 0.8], [2005, 1], [3001, 2.6]] },
    { name: "КК-55 для свиней (откорм)", code: "КК-55", comps: [[1001, 32], [1002, 34], [1003, 18], [1006, 4], [2002, 8], [2003, 1.2], [2004, 0.4], [2006, 0.4], [2005, 1], [3001, 1]] },
    { name: "ПК-1 для кур-несушек", code: "ПК-1", comps: [[1003, 42], [1001, 22], [1006, 6], [2001, 10], [2002, 9], [2003, 7.5], [2006, 0.8], [2004, 0.3], [2005, 1], [3001, 1.4]] },
    { name: "КК-61 для телят (гранулы)", code: "КК-61", comps: [[1002, 34], [1001, 24], [1005, 12], [1003, 10], [2002, 8], [2007, 4], [2001, 3], [2003, 1.5], [2004, 0.5], [2005, 1], [3001, 2]] },
  ];
  const PRODUCTS = [
    { name: "Комбикорм КК-60 (коровы)", code: "КК-60", ver: 1, type: "Россыпь", portion: 400, dry: 30, wet: 180, dens: 560, recipe: "КК-60" },
    { name: "Комбикорм КК-55 (свиньи)", code: "КК-55", ver: 2, type: "Россыпь", portion: 400, dry: 30, wet: 150, dens: 580, recipe: "КК-55" },
    { name: "Комбикорм ПК-1 (куры)", code: "ПК-1", ver: 1, type: "Россыпь", portion: 380, dry: 40, wet: 160, dens: 620, recipe: "ПК-1" },
    { name: "Гранулы КК-61 (телята)", code: "КК-61Г", ver: 1, type: "Гранулы", portion: 380, dry: 30, wet: 120, dens: 600, recipe: "КК-61" },
  ];

  function defaults() {
    return {
      raw: RAW.map((r) => ({ ...r })),
      bunkers: BUNKERS.map((b) => ({ ...b })),
      recipes: RECIPES.map((r) => ({ name: r.name, code: r.code, comps: r.comps.map(([code, pct]) => ({ code, pct })) })),
      products: PRODUCTS.map((p) => ({ ...p })),
      programs: [
        { id: 1, name: "КК-60 — 4 т", product: "КК-60", total: 4000, status: "новая", unload: [2] },
        { id: 2, name: "Гранулы КК-61 — 2 т", product: "КК-61Г", total: 2000, status: "новая", unload: [4] },
      ],
      users: [{ login: "Оператор", role: "Оператор" }, { login: "Технолог", role: "Технолог" }, { login: "Администратор", role: "Администратор" }],
      nextPP: 3,
    };
  }

  let D = null;
  function load() {
    try { D = JSON.parse((typeof localStorage !== "undefined" && localStorage.getItem(KEY)) || "null"); } catch (e) { D = null; }
    if (!D || !D.raw) D = defaults();
    return D;
  }
  function save() { try { if (typeof localStorage !== "undefined") localStorage.setItem(KEY, JSON.stringify(D)); } catch (e) { /* нет места */ } }
  function reset() { D = defaults(); save(); return D; }

  const raw = (code) => D.raw.find((r) => +r.code === +code);
  const bunkerOf = (code, place) => D.bunkers.find((b) => +b.code === +code && (!place || b.place === place) && !b.blockDos);
  const product = (code) => D.products.find((p) => p.code === code);
  const recipe = (code) => D.recipes.find((r) => r.code === code);

  // Составить программу производства для ПЛК: компоненты с бункерами и местами дозирования.
  function buildProgram(pp) {
    const p = product(pp.product); if (!p) return { error: `Нет продукта «${pp.product}»` };
    const r = recipe(p.recipe); if (!r) return { error: `Нет рецепта «${p.recipe}»` };
    const sum = r.comps.reduce((a, c) => a + +c.pct, 0);
    if (Math.abs(sum - 100) > 0.5) return { error: `Рецепт «${r.name}»: сумма ввода ${sum.toFixed(2)} % ≠ 100 %` };
    const comps = [];
    for (const c of r.comps) {
      const m = raw(c.code); if (!m) return { error: `Нет сырья с кодом ${c.code}` };
      const b = bunkerOf(c.code, m.place);
      if (!b) return { error: `Сырьё «${m.name}» не назначено ни в один бункер (${m.place})` };
      comps.push({ code: c.code, name: m.name, place: m.place, bunk: b.n, pct: +c.pct });
    }
    // большие весы — по убыванию доли (как на объекте), средние — по номеру бункера
    comps.sort((a, b) => (a.place === b.place ? (a.place === "БВ" ? b.pct - a.pct : a.bunk - b.bunk) : 0));
    const portions = Math.max(1, Math.round(pp.total / p.portion));
    const bigKg = comps.filter((c) => c.place === "БВ").reduce((a, c) => a + c.pct, 0) * p.portion / 100;
    if (bigKg > 500) return { error: `Порция на больших весах ${bigKg.toFixed(0)} кг превышает 500 кг` };
    return { prog: { id: pp.id, name: pp.name, product: p.name, code: p.code, type: p.type, portionKg: p.portion, portions,
      timeDry: p.dry, timeWet: p.wet, comps, unload: (pp.unload || []).slice(), status: "", issued: 0, done: 0 } };
  }

  load();
  const api = { get data() { return D; }, load, save, reset, raw, product, recipe, bunkerOf, buildProgram, defaults };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.DB = api;
})(typeof window !== "undefined" ? window : globalThis);
