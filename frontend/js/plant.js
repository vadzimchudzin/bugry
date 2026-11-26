/* Комбикормовый завод «Бугры» — модель установки вокруг программы ПЛК.
   ПЛК (plc.js) решает, что включить. Здесь — всё, что за клеммами:
   двигатели с разгоном и выбегом, импульсные ДКС, концевики шиберов и
   переключателей, уровни бункеров, весы, ток дробилок и пресса,
   температура пара и гранул, движение продукта по тракту, автотранспорт. */

(function (global) {
  "use strict";

  const PLC = global.PLC;
  const plc = PLC.createPLC();
  const V = plc.v;

  const W = 5200, H = 2500;

  /* ============================================================ узлы схемы */
  // Геометрия задаётся в координатах мира. kind определяет рисунок и точки
  // присоединения; drive — привод ПЛК, по которому узел анимируется.
  const ND = {};
  const N = (id, o) => { ND[id] = Object.assign({ id }, o); return ND[id]; };
  const noria = (id, x, y1, y2, poz) => N(id, { kind: "noria", drive: id, x, y: y1, w: 96, h: y2 - y1, poz });
  const screw = (id, x1, x2, y, o) => N(id, Object.assign({ kind: "screw", drive: id, x: Math.min(x1, x2), y: y - 18, w: Math.abs(x2 - x1), h: 36, x1, x2, cy: y, dir: x2 >= x1 ? 1 : -1 }, o));
  const scraper = (id, x1, y1, x2, y2, o) => N(id, Object.assign({ kind: "scraper", drive: id, x1, y1, x2, y2, x: Math.min(x1, x2), y: Math.min(y1, y2) - 20, w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) + 40 }, o));
  const bunker = (id, cx, y1, y2, w, o) => N(id, Object.assign({ kind: "bunker", x: cx - w / 2, y: y1, w, h: y2 - y1, cx }, o));

  // ---------------- загрузка БВ
  N("truck_in", { kind: "truck", x: 30, y: 690, w: 300, h: 132, serves: "pit" });
  N("pit", { kind: "pit", x: 70, y: 840, w: 320, h: 190, poz: "10100", label: "Завальная яма" });
  scraper("TrHole", 250, 1000, 520, 840, { poz: "10110", screwType: true });
  noria("NorHole", 520, 150, 930, "10200");
  N("DVPT", { kind: "diverter", drive: "DVPT", x: 690, y: 300, w: 70, h: 70, poz: "10210" });
  N("Scalp", { kind: "scalp", drive: "Scalp", x: 640, y: 470, w: 230, h: 150, poz: "10300" });
  N("trash", { kind: "box", x: 650, y: 680, w: 110, h: 70, label: "Отходы" });
  noria("Nor1", 940, 120, 930, "10400");
  screw("Tr1", 1160, 1585, 238, { poz: "10500", reverse: true, motorAt: "mid" });
  screw("Tr1L", 1160, 1505, 330, { poz: "10600", chain: true });
  screw("Tr1R", 1555, 1935, 330, { poz: "10700", chain: true });
  const BK = [1215, 1343, 1471, 1619, 1747, 1875];
  BK.forEach((cx, i) => bunker("b" + (101 + i), cx, 395, 880, 116, { num: 101 + i, level: "b" + (101 + i), kindB: "raw" }));
  [["ShL1", 0], ["ShL2", 1], ["ShR1", 3], ["ShR2", 4]].forEach(([id, i]) => N(id, { kind: "shiber", drive: id, x: BK[i] - 22, y: 352, w: 44, h: 26, poz: PLC.DEF[id].poz }));
  BK.forEach((cx, i) => screw("K" + (i + 1), cx - 44, cx + 30, 905, { poz: "2001" + (i + 1), small: true, dozer: true, bunk: 101 + i }));
  N("scale1", { kind: "scale", x: 1150, y: 935, w: 790, h: 78, poz: "20100", label: "Весы бункерного типа 500 кг", level: "scale1" });
  N("ZatvK", { kind: "gate", drive: "ZatvK", x: 1520, y: 1013, w: 50, h: 20 });
  screw("TrKomp", 1150, 2035, 1068, { poz: "20110" });

  // ---------------- дробление
  noria("Nor2", 2040, 140, 1120, "20200");
  screw("TrPBD", 2150, 2440, 210, { poz: "20300" });
  bunker("PBD", 2400, 250, 470, 170, { poz: "30100", label: "НДБ", level: "PBD", kindB: "hopper2" });
  screw("Pit1", 2250, 2345, 530, { poz: "30210", small: true, pch: true });
  screw("Pit2", 2550, 2455, 530, { poz: "30220", small: true, pch: true });
  N("mag1", { kind: "magnet", x: 2335, y: 552, w: 46, h: 54, poz: "30310" });
  N("mag2", { kind: "magnet", x: 2420, y: 552, w: 46, h: 54, poz: "30320" });
  N("Drob1", { kind: "crusher", drive: "Drob1", x: 2140, y: 640, w: 230, h: 320, poz: "30410", motor: "left", hx: 2300 });
  N("Drob2", { kind: "crusher", drive: "Drob2", x: 2430, y: 640, w: 230, h: 320, poz: "30420", motor: "right", hx: 2500 });
  screw("TrDrob", 2210, 2700, 1000, { poz: "30500" });
  noria("Nor3", 2700, 120, 1060, "30600");

  // ---------------- добавки (средние весы), масло, смеситель
  const DK = [];
  for (let i = 0; i < 8; i++) { const cx = 2875 + i * 86; DK.push(cx); bunker("b" + (201 + i), cx, 70, 300, 78, { num: 201 + i, level: "b" + (201 + i), kindB: "add" }); }
  DK.forEach((cx, i) => screw("D" + (i + 1), cx - 30, cx + 24, 322, { poz: "210" + (i < 3 ? "1" + (i + 1) : "2" + (i - 2)), small: true, dozer: true, bunk: 201 + i }));
  N("Vibr1", { kind: "vibr", drive: "Vibr1", x: DK[0] - 52, y: 150, w: 26, h: 34 });
  N("Vibr2", { kind: "vibr", drive: "Vibr2", x: DK[4] - 52, y: 150, w: 26, h: 34 });
  N("scale2", { kind: "scale", x: 2830, y: 345, w: 690, h: 58, poz: "21100", label: "Весы средние 100 кг", level: "scale2" });
  N("ZatvD", { kind: "gate", drive: "ZatvD", x: 2850, y: 403, w: 40, h: 18 });
  screw("TrDob", 3000, 2790, 448, { poz: "21110", pch: true });
  bunker("UpBunk", 2960, 520, 690, 170, { poz: "НСБ", label: "Надсмесительный бункер", level: "UpBunk", kindB: "hopper2" });
  N("KlapSms", { kind: "gate", drive: "KlapSms", x: 2938, y: 690, w: 44, h: 18 });
  N("Sms", { kind: "mixer", drive: "Sms", x: 2830, y: 712, w: 300, h: 130, poz: "30700", level: "Sms" });
  N("ShDownSms", { kind: "gate", drive: "ShDownSms", x: 2950, y: 842, w: 44, h: 18 });
  bunker("DownBunk", 2972, 866, 1010, 170, { poz: "ПСБ", label: "Подсмесительный бункер", level: "DownBunk", kindB: "hopper2" });
  N("tankOil", { kind: "tank", x: 3200, y: 470, w: 200, h: 120, poz: "ВЖД4", label: "Масло", level: "tankOil" });
  N("Jir", { kind: "oilscale", drive: "Jir", x: 3215, y: 640, w: 80, h: 92, poz: "21700", label: "УДЖК", level: "Jir" });
  N("compr", { kind: "compressor", x: 3410, y: 650, w: 110, h: 80, label: "Компрессор" });
  screw("TrSms", 2890, 3590, 1062, { poz: "30800", pch: true });
  N("ShTrSms", { kind: "shiber", drive: "ShTrSms", x: 3130, y: 1082, w: 44, h: 24, poz: "40110" });

  // ---------------- выгрузка готовой продукции
  noria("Nor4", 3600, 110, 1240, "50100");
  screw("TrGP", 3715, 4330, 170, { poz: "50200" });
  N("Sh50210", { kind: "shiber", drive: "Sh50210", x: 3758, y: 190, w: 44, h: 24, poz: "50210" });
  screw("Tr50300", 3760, 4235, 262, { poz: "50300" });
  screw("Tr50400", 4300, 4775, 262, { poz: "50400" });
  const GK = [3820, 3935, 4050, 4165, 4360, 4475, 4590, 4705];
  GK.forEach((cx, i) => bunker("b" + (301 + i), cx, 330, 790, 106, { num: 301 + i, level: "s" + (i + 1), kindB: "gp" }));
  [["Sh50310", 0], ["Sh50320", 1], ["Sh50330", 2], ["Sh50410", 4], ["Sh50420", 5], ["Sh50430", 6]].forEach(([id, i]) => N(id, { kind: "shiber", drive: id, x: GK[i] - 22, y: 282, w: 44, h: 24, poz: PLC.DEF[id].poz }));
  GK.forEach((cx, i) => N("ShO" + (i + 1), { kind: "shiber", drive: "ShO" + (i + 1), x: cx - 22, y: 798, w: 44, h: 22, poz: PLC.DEF["ShO" + (i + 1)].poz, vertical: true }));
  N("truck_g1", { kind: "truck", x: 3770, y: 880, w: 330, h: 145, serves: [1, 2, 3, 4], flip: true });
  N("truck_g2", { kind: "truck", x: 4310, y: 880, w: 330, h: 145, serves: [5, 6, 7, 8], flip: true });

  // ---------------- линия гранулирования
  screw("Tr40100", 3175, 2350, 2400, { poz: "40100" });
  noria("Nor5", 2240, 1300, 2440, "40200");
  N("FiltNor5", { kind: "filter", drive: "FiltNor5", x: 2160, y: 1250, w: 60, h: 90, poz: "40210" });
  screw("Tr40300", 2380, 2616, 1380, { poz: "40300" });
  bunker("PBGran", 2600, 1410, 1610, 170, { poz: "40400", label: "БО-5", level: "PBGran", kindB: "hopper2" });
  N("VibrG1", { kind: "vibr", drive: "VibrG1", x: 2486, y: 1450, w: 24, h: 30 });
  N("VibrG2", { kind: "vibr", drive: "VibrG2", x: 2690, y: 1450, w: 24, h: 30 });
  screw("PitGr", 2640, 2480, 1638, { poz: "40501", small: true, pch: true });
  N("KondGr", { kind: "conditioner", drive: "KondGr", x: 2440, y: 1668, w: 360, h: 64, poz: "40502" });
  N("Gran", { kind: "press", drive: "Gran", x: 2680, y: 1768, w: 370, h: 250, poz: "40500" });
  N("ZatvOhl", { kind: "sluice", drive: "ZatvOhl", x: 2758, y: 2022, w: 44, h: 36, poz: "40601" });
  N("Ohl", { kind: "cooler", drive: "Ohl", x: 2680, y: 2062, w: 200, h: 218, poz: "40600", level: "Ohl" });
  N("AspGr", { kind: "cyclone", drive: "AspGr", x: 2880, y: 1380, w: 110, h: 290, poz: "60100" });
  screw("Tr40700", 2740, 3770, 2304, { poz: "40700", chain: true });
  noria("Nor6", 3780, 1300, 2340, "40900");
  N("FiltNor6", { kind: "filter", drive: "FiltNor6", x: 3880, y: 1250, w: 60, h: 90, poz: "40920" });
  N("PP1", { kind: "diverter", drive: "PP1", x: 3930, y: 1345, w: 64, h: 64, poz: "40910" });
  N("Pros", { kind: "sifter", drive: "Pros1", drive2: "Pros2", x: 3990, y: 1440, w: 330, h: 180, poz: "40950" });
  N("PP2", { kind: "diverter", drive: "PP2", x: 4175, y: 1690, w: 64, h: 64, poz: "40960" });
  scraper("Tr51100", 4364, 1738, 4612, 1052, { poz: "51100" });
  N("PP3", { kind: "diverter", drive: "PP3", x: 4600, y: 1097, w: 64, h: 64, poz: "51110" });
  scraper("Tr51200", 4575, 1185, 3790, 1185, { poz: "51200" });
  bunker("Torba", 4220, 1780, 2080, 150, { poz: "51300", num: 310, label: "Биг-бег", level: "s10", kindB: "torba" });
  N("Leb", { kind: "bigbag", drive: "Leb", x: 4150, y: 2090, w: 290, h: 200, poz: "51300" });
  noria("Nor7", 4700, 1300, 2340, "50100г");
  N("FiltNor7", { kind: "filter", drive: "FiltNor7", x: 4800, y: 1250, w: 60, h: 90, poz: "50110" });
  bunker("b309", 4930, 1400, 1960, 150, { num: 309, level: "s9", kindB: "gp" });
  N("ShO9", { kind: "shiber", drive: "ShO9", x: 4908, y: 1968, w: 44, h: 22, vertical: true, poz: "50300*" });
  N("truck_g3", { kind: "truck", x: 4810, y: 2040, w: 330, h: 145, serves: [9], flip: true });
  screw("Tr40800", 4100, 3200, 2400, { poz: "40800" });
  N("boiler", { kind: "boiler", x: 1560, y: 1500, w: 540, h: 300, label: "Паровой котёл" });
  N("cab", { kind: "cabinet", x: 140, y: 1300, w: 420, h: 260, label: "Шкафы управления ШУ / ШЧ / ШД" });
  N("Asp1", { kind: "cyclone", drive: "Asp1", x: 300, y: 120, w: 110, h: 300, poz: "АС-1" });
  N("Asp2", { kind: "cyclone", drive: "Asp2", x: 4980, y: 110, w: 110, h: 300, poz: "АС-2" });

  /* ============================================================ точки присоединения */
  const A = {};
  const at = (n, u, v) => [n.x + u * n.w, n.y + v * n.h];
  for (const n of Object.values(ND)) {
    const a = {};
    switch (n.kind) {
      case "noria": a.in = [n.x + 4, n.y + n.h - 46]; a.out = [n.x + n.w + 26, n.y + 58]; a.top = n.y + 40; a.bot = n.y + n.h - 34; break;
      case "screw": {
        const l = n.x1, r = n.x2;
        a.in = [l + n.dir * 22, n.cy - 18]; a.out = [r - n.dir * 16, n.cy + 18]; a.y = n.cy; break;
      }
      case "scraper": a.in = [n.x1, n.y1 - 14]; a.out = [n.x2, n.y2 + 14]; break;
      case "bunker": a.in = [n.cx, n.y]; a.out = [n.cx, n.y + n.h]; break;
      case "diverter": a.in = [n.x + n.w / 2, n.y]; a.o1 = [n.x + n.w * 0.22, n.y + n.h]; a.o2 = [n.x + n.w * 0.78, n.y + n.h]; break;
      default: a.in = at(n, 0.5, 0); a.out = at(n, 0.5, 1);
    }
    A[n.id] = a;
  }
  // уточнения по рисунку машин
  A.pit.out = [258, 1012];
  A.Scalp.in = [690, 478]; A.Scalp.out = [860, 600]; A.Scalp.waste = [705, 620];
  A.scale1.out = [1545, 1020];
  A.Drob1.in = [2300, 652]; A.Drob1.out = [2300, 958];
  A.Drob2.in = [2500, 652]; A.Drob2.out = [2500, 958];
  A.Sms.in = [2960, 714]; A.Sms.out = [2972, 842]; A.Sms.oil = [3100, 716];
  A.KondGr.in = [2496, 1670]; A.KondGr.out = [2780, 1732]; A.KondGr.steam = [2740, 1668];
  A.Gran.in = [2780, 1772]; A.Gran.out = [2780, 2020];
  A.Ohl.in = [2780, 2064]; A.Ohl.out = [2780, 2280]; A.Ohl.duct = [2880, 2090];
  A.AspGr.in = [2882, 1440]; A.AspGr.out = [2935, 1670];
  A.Pros.in = [4040, 1448]; A.Pros.out = [4300, 1622]; A.Pros.waste = [4090, 1622];
  A.Nor5.in = [ND.Nor5.x + ND.Nor5.w - 4, ND.Nor5.y + ND.Nor5.h - 46];
  A.boiler.steam = [1990, 1500];
  A.Leb.in = [4295, 2100];

  /* ============================================================ имена механизмов */
  const NAMES = {};
  plc.D.forEach((d) => { NAMES[d.id] = [d.name, d.poz]; });
  plc.DOZ.forEach((z) => { NAMES[z.id] = [`Дозатор шнековый бункера ${z.bunk}`, z.scale === 1 ? "2001" + z.idx : "21" + (z.idx <= 3 ? "01" + z.idx : "02" + (z.idx - 3))]; });
  Object.assign(NAMES, {
    ZatvK: ["Затвор больших весов (пневмо)", "20100"], ZatvD: ["Затвор средних весов (пневмо)", "21100"],
    KlapSms: ["Клапан надсмесительного бункера", "30700"], ShDownSms: ["Заслонка смесителя (выгрузка в ПСБ)", "30700"],
    ClapMasloIn: ["Клапан долива масла УДЖК", "21700"], ClapMasloOut: ["Клапан подачи масла в смеситель", "21700"],
    Jir: ["Установка дозирования жидких компонентов УДЖК-1-БП", "21700"],
  });

  /* ============================================================ состояние */
  const S = {
    W, H, ND, A, V, plc, NAMES,
    machines: {},
    clock: 0, timeScale: 1, scanDt: 0.02, ambient: 18,
    autoTrucks: true, autoAdd: true,
    trucks: {
      truck_in: { phase: "park", x: 0, load: 1, material: "1001" },
      truck_g1: { phase: "away", x: 0, load: 0, silo: 0 },
      truck_g2: { phase: "away", x: 0, load: 0, silo: 0 },
      truck_g3: { phase: "away", x: 0, load: 0, silo: 0 },
    },
    alarms: [], archive: [], log: [],
    user: { login: "Оператор", role: "Оператор" },
    leb: { y: 0, x: 0 },
    bagOn: true, bagSide: -1, bagsOut: 0,
    fork: { phase: "away", x: 1, lift: 0, load: 0 },
  };

  /* ---------------------------------------------- приводы: разгон, выбег, наработка */
  const RAMP = { noria: [6, 12], transporter: [3.5, 6], reverse: [3.5, 6], meh: [9, 16], zatvor: [1.5, 3], asp: [9, 20], vibr: [0.3, 0.6], dozator: [0.8, 1.2], ohl: [1, 1], leb: [1, 1] };
  function mkMachine(id) {
    const [name, poz] = NAMES[id] || [id, ""];
    const fb = plc.fbs[id] || {};
    return {
      id, name, poz, fb: fb.kind || "",
      w: 0, spin: 0, pos: 0, dksT: Math.random(), dksPh: 0,
      hours: 0, hoursTotal: 1200 + ((id.length * 977) % 3000), toHours: 500,
      sim: { az: false, dks: false, dsl1: false, dsl2: false, dp: false, pch: false, jam: false, door: false, konc: false, slip: false },
      local: { stop: false, pusk: false, mode: false },
      current: 0,
    };
  }
  Object.keys(NAMES).forEach((id) => { S.machines[id] = mkMachine(id); });

  /* ============================================================ продукт */
  // Ёмкости: масса (кг), вид продукта, название. Виды: grain — зерно,
  // meal — дерть (после дробилки), add — добавки, mash — россыпной
  // комбикорм, pellet — гранулы (горячие/холодные), fines — мелочь, oil — масло.
  const C = {};
  const cont = (id, cap, o) => { C[id] = Object.assign({ id, cap, mass: 0, kind: "grain", prod: "" }, o); return C[id]; };
  cont("pit", 12000, { mass: 9000, prod: "Пшеница" });
  for (let i = 1; i <= 6; i++) cont("b" + (100 + i), i <= 3 ? 14000 : 10500);
  for (let i = 1; i <= 8; i++) cont("b" + (200 + i), 120, { kind: "add" });
  cont("scale1", 600); cont("scale2", 120, { kind: "add" });
  cont("PBD", 900, { kind: "grain" });
  cont("Drob1", 25, { kind: "grain" }); cont("Drob2", 25, { kind: "grain" });
  cont("UpBunk", 900, { kind: "meal" });
  cont("Sms", 900, { kind: "mash" });
  cont("DownBunk", 1000, { kind: "mash" });
  cont("tankOil", 1800, { mass: 1300, kind: "oil", prod: "Масло растительное" });
  cont("Jir", 60, { kind: "oil" });
  for (let i = 1; i <= 8; i++) cont("s" + i, 9000, { kind: "mash" });
  cont("s9", 9000, { kind: "pellet" });
  cont("s10", 1200, { kind: "pellet" });
  cont("trash", 400, { kind: "fines" });
  cont("PBGran", 3000, { kind: "mash" });
  cont("Kond", 20, { kind: "mash" });
  cont("Gran", 12, { kind: "mash" });
  cont("Ohl", 650, { kind: "pellet", temp: 18 });
  cont("cyc", 60, { kind: "fines" });
  cont("bigbag", 1000, { kind: "pellet" });
  // начальные запасы на складе (вчерашняя смена)
  const START = { b101: [7800, "Пшеница"], b102: [5600, "Ячмень"], b103: [6100, "Кукуруза"], b104: [3900, "Тритикале"], b105: [2400, "Овёс"], b106: [3100, "Горох"],
    b201: [64, "Шрот подсолнечный"], b202: [58, "Шрот соевый"], b203: [70, "Мел кормовой"], b204: [52, "Соль поваренная"], b205: [60, "Премикс КРС"],
    b206: [44, "Монокальцийфосфат"], b207: [55, "Дрожжи кормовые"], b208: [49, "Жмых рапсовый"],
    s1: [3200, "Комбикорм КК-60 (коровы)"], s3: [1400, "Комбикорм КК-55 (свиньи)"], s5: [5200, "Комбикорм КК-60 (коровы)"], s9: [2600, "Гранулы КК-60"] };
  for (const [k, [m, p]] of Object.entries(START)) { C[k].mass = m; C[k].prod = p; }
  ["s1", "s3", "s5"].forEach((k) => { C[k].kind = "mash"; }); C.s9.kind = "pellet";

  // Элемент тракта: транспортная задержка из N ячеек; движется со скоростью привода.
  const EL = {};
  function el(id, cfg) {
    const e = Object.assign({ id, N: 24, T: 20, Q: 3, cells: null, kinds: null, acc: 0, outlets: [], blocked: false, flow: 0 }, cfg);
    e.cells = new Float64Array(e.N); e.kinds = new Array(e.N).fill("grain");
    e.cap = (e.Q * e.T) / e.N;            // номинальная загрузка ячейки
    EL[id] = e; return e;
  }
  const run = (id) => (S.machines[id] ? S.machines[id].spin : 0);
  // приёмники продукта: ёмкость, элемент или функция
  function accept(to, kg, kind, prod) {
    if (kg <= 0) return 0;
    if (typeof to === "function") return to(kg, kind, prod);
    if (EL[to]) {
      const e = EL[to];
      const room = Math.max(0, e.cap * 2.6 - e.cells[0]);
      const a = Math.min(room, kg);
      if (a > 0) { e.cells[0] += a; e.kinds[0] = kind; if (prod) e.prod = prod; }
      return a;
    }
    const c = C[to];
    if (!c) return kg;
    const a = Math.max(0, Math.min(kg, c.cap * 1.04 - c.mass));
    if (a > 0) {
      if (c.mass < 1 || c.kind === kind) c.kind = kind;
      else if (to === "Sms" || to === "UpBunk") c.kind = to === "Sms" ? "mash" : "meal";
      c.mass += a; if (prod) c.prod = prod;
      if (kind === "pellet" && c.temp !== undefined) c.temp = (c.temp * (c.mass - a) + (S.tPellet || 80) * a) / c.mass;
    }
    return a;
  }

  // ---------------- тракт загрузки
  el("TrHole", { N: 20, T: 14, Q: 5.6, to: "NorHole" });
  el("NorHole", { N: 30, T: 9, Q: 5.6, to: () => 0 });
  EL.NorHole.to = (kg, k, p) => (V.DVPT_Na_Scalp ? accept("Scalp", kg, k, p) : V.DVPT_Na_Nor1 ? accept("Nor1", kg, k, p) : 0);
  el("Scalp", { N: 12, T: 8, Q: 5.6, to: "Nor1", waste: 0.006 });
  el("Nor1", { N: 32, T: 10, Q: 5.6, to: "Tr1" });
  el("Tr1", { N: 20, T: 8, Q: 5.6 });
  EL.Tr1.to = (kg, k, p) => (V.GoL_Tr1 ? accept("Tr1L", kg, k, p) : V.GoR_Tr1 ? accept("Tr1R", kg, k, p) : 0);
  el("Tr1L", { N: 30, T: 16, Q: 5.6, outlets: [{ at: 0.18, to: "b101", when: () => V.Opened_ShL1 }, { at: 0.55, to: "b102", when: () => V.Opened_ShL2 }], to: "b103" });
  el("Tr1R", { N: 30, T: 16, Q: 5.6, outlets: [{ at: 0.18, to: "b104", when: () => V.Opened_ShR1 }, { at: 0.55, to: "b105", when: () => V.Opened_ShR2 }], to: "b106" });
  // ---------------- компоненты → дробление → НСБ
  el("TrKomp", { N: 26, T: 14, Q: 9, to: "Nor2" });
  el("Nor2", { N: 30, T: 10, Q: 9, to: "TrPBD" });
  el("TrPBD", { N: 14, T: 6, Q: 9, to: "PBD" });
  el("Pit1", { N: 8, T: 4, Q: 1.6, to: "Drob1" });
  el("Pit2", { N: 8, T: 4, Q: 1.6, to: "Drob2" });
  el("TrDrob", { N: 22, T: 12, Q: 4, to: "Nor3" });
  el("Nor3", { N: 30, T: 10, Q: 6, to: "UpBunk" });
  el("TrDob", { N: 14, T: 6, Q: 4, to: "Nor3" });
  // ---------------- выгрузка ГП
  el("TrSms", { N: 28, T: 14, Q: 6, outlets: [{ at: 0.33, to: "Tr40100", when: () => V.Opened_ShTrSms }], to: "Nor4" });
  el("Nor4", { N: 34, T: 11, Q: 7, to: "TrGP" });
  el("TrGP", { N: 24, T: 12, Q: 7, outlets: [{ at: 0.08, to: "Tr50300", when: () => V.Opened_Sh50210 }], to: "Tr50400" });
  el("Tr50300", { N: 24, T: 12, Q: 7, outlets: [{ at: 0.12, to: "s1", when: () => V.Opened_Sh50310 }, { at: 0.37, to: "s2", when: () => V.Opened_Sh50320 }, { at: 0.62, to: "s3", when: () => V.Opened_Sh50330 }], to: "s4" });
  el("Tr50400", { N: 24, T: 12, Q: 7, outlets: [{ at: 0.12, to: "s5", when: () => V.Opened_Sh50410 }, { at: 0.37, to: "s6", when: () => V.Opened_Sh50420 }, { at: 0.62, to: "s7", when: () => V.Opened_Sh50430 }], to: "s8" });
  // ---------------- гранулирование
  el("Tr40100", { N: 18, T: 9, Q: 7.5, to: "Nor5" });
  el("Nor5", { N: 32, T: 11, Q: 9, to: "Tr40300" });
  el("Tr40300", { N: 14, T: 7, Q: 9, to: "PBGran" });
  el("PitGr", { N: 8, T: 4, Q: 1.25, to: "Kond" });
  el("Tr40700", { N: 20, T: 10, Q: 6, to: "Nor6" });
  el("Nor6", { N: 32, T: 11, Q: 6, to: null });
  EL.Nor6.to = (kg, k, p) => (V.PP1_Pos1 ? accept("Pros", kg, k, p) : V.PP1_Pos2 ? accept("s10", kg, k, p) : 0);
  el("Pros", { N: 14, T: 12, Q: 2, to: null, sieve: 0.06 });
  EL.Pros.to = (kg, k, p) => (V.PP2_Pos2 ? accept("Tr51100", kg, k, p) : V.PP2_Pos1 ? accept("s10", kg, k, p) : 0);
  el("Tr51100", { N: 22, T: 11, Q: 2, to: null });
  EL.Tr51100.to = (kg, k, p) => (V.PP3_Pos1 ? accept("Tr51200", kg, k, p) : V.PP3_Pos2 ? accept("Nor7", kg, k, p) : 0);
  el("Tr51200", { N: 30, T: 15, Q: 2, to: "Nor4" });
  el("Nor7", { N: 32, T: 11, Q: 2, to: "s9" });
  el("Tr40800", { N: 36, T: 18, Q: 1.2, to: "Tr40100" });
  Object.values(EL).forEach((e) => { if (!e.drive) e.drive = e.id === "Pros" ? "Pros1" : e.id; });

  // Поставщики: забор продукта из ёмкости в элемент со скоростью привода.
  const takeFrom = (cid, kg) => { const c = C[cid]; const a = Math.min(c.mass, kg); c.mass -= a; return a; };

  /* ============================================================ датчики */
  function dksPulse(m, dt, blink) {
    // метка на валу: 2 импульса на оборот, частота ~ скорости
    m.dksT += dt * (0.6 + 1.8 * m.spin);
    const ph = m.dksT % 1;
    // датчик видит метку при любой скорости вращения (частотные приводы стартуют с 15 Гц)
    return blink ? m.spin > 0.05 && ph < 0.35 : m.spin > 0.05;
  }

  function sensors(dt) {
    plc.D.forEach((d) => {
      const m = S.machines[d.id]; if (!m) return;
      const t = d.id;
      V["ErrAz_" + t] = m.sim.az;
      if (d.pch) V["ErrPCH_" + t] = m.sim.pch;
      if (d.door) V["Door_" + t] = m.sim.door;
      if (d.doorDp) V["Door_" + t] = m.sim.door;
      V["LStop_" + t] = m.local.stop;
      V["LPusk_" + t] = m.local.pusk; V["Local_" + t] = m.local.mode;
      if (d.fb === "noria" || d.fb === "transporter" || d.fb === "reverse") {
        const blink = d.fb === "noria" || d.dksMustBlink !== false;
        V["DKS_" + t] = m.sim.dks ? (m.sim.dksStuck === "on") : dksPulse(m, dt, blink) && !m.sim.slip;
        if (m.sim.slip && m.spin > 0.3) V["DKS_" + t] = false;
        if (d.fb === "noria") { V["DSL1_" + t] = m.sim.dsl1; V["DSL2_" + t] = m.sim.dsl2; }
        const e = EL[t];
        V["DP_" + t] = m.sim.dp || (e ? e.blocked : false);
        if (d.fb === "reverse") { V.DP1_Tr1 = m.sim.dp || (EL.Tr1.blocked && V.GoL_Tr1); V.DP2_Tr1 = m.sim.dp && false || (EL.Tr1.blocked && V.GoR_Tr1); }
      }
      if (d.fb === "zatvor") V["DKS_" + t] = !m.sim.dks && dksPulse(m, dt, true);
      if (d.fb === "asp") { V["DKS_Gw" + t] = !m.sim.dks && dksPulse(S.machines[t], dt, true) && V["Go_Gw" + t]; V["ErrAz_Gw" + t] = m.sim.az2 || false; }
    });
    // концевики шиберов: ход 4…6 с, отказы — заклинивание и обрыв концевика
    plc.D.filter((d) => d.fb === "shiber").concat(["ZatvK", "ZatvD"].map((id) => ({ id, fb: "shiber" }))).forEach((d) => {
      const m = S.machines[d.id], t = d.id;
      const open = d.id === "ZatvK" || d.id === "ZatvD" ? V["Go_Open" + t] : V["Go_Open" + t];
      const close = V["Go_Close" + t];
      const sp = 1 / (d.id.startsWith("ShO") ? 6 : 4.5);
      if (!m.sim.jam) { if (open) m.pos = Math.min(1, m.pos + sp * dt); if (close) m.pos = Math.max(0, m.pos - sp * dt); }
      m.spin = open || close ? 1 : 0;
      // отказы концевиков: «both» — оба замкнуты, «lost» — обрыв концевика «открыт»
      V["Opened_" + t] = m.sim.konc === "both" || (m.sim.konc !== "lost" && m.pos > 0.98);
      V["Closed_" + t] = m.sim.konc === "both" || m.pos < 0.02;
      V["ErrAz_" + t] = m.sim.az;
    });
    // переключатели потока: ход 4 с
    [["DVPT", "DVPT_Na_Scalp", "DVPT_Na_Nor1"], ["PP1", "PP1_Pos1", "PP1_Pos2"], ["PP2", "PP2_Pos1", "PP2_Pos2"], ["PP3", "PP3_Pos1", "PP3_Pos2"]].forEach(([id, p1, p2]) => {
      const m = S.machines[id];
      if (!m.sim.jam) { if (V["Go_" + id + "_1"]) m.pos = Math.max(0, m.pos - dt / 4); if (V["Go_" + id + "_2"]) m.pos = Math.min(1, m.pos + dt / 4); }
      m.spin = V["Go_" + id + "_1"] || V["Go_" + id + "_2"] ? 1 : 0;
      V[p1] = m.pos < 0.02 || m.sim.konc === "both"; V[p2] = m.pos > 0.98 || m.sim.konc === "both";
      V["ErrAz_" + id] = m.sim.az;
    });
    // пневмоклапаны смесителя и УДЖК: ход 1,5 с, нужен воздух от компрессора
    const air = !S.machines.compr || !V.LowPress;
    [["KlapSms", "Go_Klap", "KlapOpened", "KlapClosed"], ["ShDownSms", "Go_ZaslDown", "ZaslDownOpened", "ZaslDownClosed"],
      ["ClapMasloIn", null, "ClapInOpened", "ClapInClosed"], ["ClapMasloOut", null, "ClapOutOpened", "ClapOutClosed"]].forEach(([id, out, o, c]) => {
      const m = S.machines[id];
      const cmd = out ? V[out] : plc.fbs[id].runToOpen;
      if (!m.sim.jam && air) m.pos = cmd ? Math.min(1, m.pos + dt / 1.5) : Math.max(0, m.pos - dt / 1.5);
      m.spin = cmd ? 1 : 0;
      V[o] = m.pos > 0.97; V[c] = m.pos < 0.03;
    });
    // уровни
    const lv = (id) => C[id].mass / C[id].cap;
    for (let i = 1; i <= 6; i++) { V.DVU_BunkK[i] = lv("b" + (100 + i)) > 0.92 || S.machines["K" + i].sim.dvu; V.DNU_BunkK[i] = lv("b" + (100 + i)) > 0.03; }
    for (let i = 1; i <= 8; i++) { V.DVU_BunkD[i] = lv("b" + (200 + i)) > 0.92; V.DNU_BunkD[i] = lv("b" + (200 + i)) > 0.05; }
    for (let i = 1; i <= 10; i++) { V.DVU_Silo[i] = lv("s" + i) > 0.94; V.DNU_Silo[i] = lv("s" + i) > 0.04; }
    V.DVU_PBD = lv("PBD") > 0.85; V.DNU_PBD = C.PBD.mass > 8;
    V.DVU_UpBunk = lv("UpBunk") > 0.9; V.DNU_UpBunk = C.UpBunk.mass > 6;
    V.DVU_DownBunk = lv("DownBunk") > 0.9; V.DNU_DownBunk = C.DownBunk.mass > 6;
    V.DVU_PBGran = lv("PBGran") > 0.85; V.DNU_PBGran = C.PBGran.mass > 10;
    V.DVU_OhlGr = C.Ohl.mass > 470; V.DSU_OhlGr = C.Ohl.mass > 250; V.DNU_OhlGr = C.Ohl.mass > 40;
    V.DVU_Maslo = C.tankOil.mass < 20;       // ДНУ ёмкости ВЖД4 — нет масла для долива
    V.DVU_Torba = V.DVU_Silo[10]; V.DNU_Torba = V.DNU_Silo[10];
    V.MassPBD = C.PBD.mass; V.MassCrush = C.Drob1.mass + C.Drob2.mass + EL.Pit1.cells.reduce((a, b) => a + b, 0) + EL.Pit2.cells.reduce((a, b) => a + b, 0) + EL.TrDrob.cells.reduce((a, b) => a + b, 0);
    V.MassSms = C.Sms.mass; V.MassPSB = C.DownBunk.mass; V.MassUp = C.UpBunk.mass;
    V.FlowNor3 = EL.Nor3.flow + EL.TrDob.flow;
    // весы: тензодатчики с шумом и фильтром
    const noise = (a) => (Math.random() - 0.5) * a;
    S.ves1f = (S.ves1f || 0) + (C.scale1.mass - (S.ves1f || 0)) * Math.min(1, dt * 4);
    S.ves2f = (S.ves2f || 0) + (C.scale2.mass - (S.ves2f || 0)) * Math.min(1, dt * 4);
    V.Ves1 = +(S.ves1f + noise(0.3) + (S.machines.ZatvK.sim.drift ? 7 : 0)).toFixed(1);
    V.Ves2 = +(S.ves2f + noise(0.06)).toFixed(2);
    V.Ves4 = +(C.Jir.mass + noise(0.03)).toFixed(2);
    V.LowPress = S.machines.compr ? S.machines.compr.sim.az : false;
    V.ErrAz_Kompr = V.LowPress;
    V.DoorOhlGr = S.machines.Ohl.sim.door;
    // дробилки и пресс: скорость в норме — разгон завершён
    V.DrobSpeedOK1 = S.machines.Drob1.spin > 0.95; V.DrobSpeedOK2 = S.machines.Drob2.spin > 0.95;
    V.GranSpeedOK = S.machines.Gran.spin > 0.95;
  }
  // реальные ДКС оборудования без собственного блока ПЛК
  S.machines.compr = mkMachine("compr"); S.machines.compr.name = "Компрессор (пневматика заслонок)"; S.machines.compr.poz = "—";

  /* ============================================================ динамика приводов */
  function drives(dt) {
    for (const [id, m] of Object.entries(S.machines)) {
      const fb = plc.fbs[id];
      if (!fb) continue;
      if (["shiber", "dvpt", "klap"].includes(fb.kind)) continue;
      let on = !!fb.run;
      if (fb.kind === "asp") on = fb.run;
      if (fb.kind === "dozator") on = fb.run;
      if (id === "Jir") on = fb.run;
      const [tu, td] = RAMP[fb.kind] || [2, 4];
      // приводы с ПЧ: скорость задаётся частотой
      let target = on ? 1 : 0;
      if (on && fb.kind === "dozator") target = Math.max(0.15, (V["Freq_" + id] || 0) / 50);
      if (on && (id === "Pit1" || id === "Pit2")) target = Math.max(0.1, (V["FreqPit" + id.slice(3)] || 0) / 50);
      if (on && id === "PitGr") target = Math.max(0.05, (V.FreqPitGr || 0) / 50);
      if (m.sim.jam && on) target = 0;
      const k = target > m.spin ? dt / tu : dt / td;
      m.spin += Math.max(-k, Math.min(k, target - m.spin));
      if (fb.kind === "asp") { const g = S.machines[id]; g.spinGw = (g.spinGw || 0) + Math.max(-dt / 2, Math.min(dt / 2, (fb.runGw ? 1 : 0) - (g.spinGw || 0))); }
      if (on) { m.hours += dt / 3600; m.hoursTotal += dt / 3600; }
    }
    // лебёдка биг-бега: подъём/опускание и ход тележки
    const lb = S.leb;
    if (V.Go_LebUp) lb.y = Math.max(0, lb.y - dt / 12); if (V.Go_LebDn) lb.y = Math.min(1, lb.y + dt / 12);
    if (V.Go_LebTo1) lb.x = Math.max(0, lb.x - dt / 10); if (V.Go_LebTo2) lb.x = Math.min(1, lb.x + dt / 10);
    V.Leb_Up = lb.y <= 0.001; V.Leb_Dn = lb.y >= 0.999; V.Leb_Pol1 = lb.x <= 0.001; V.Leb_Pol2 = lb.x >= 0.999;
    S.machines.Leb.spin = V.Go_Leb ? 1 : 0;
  }

  if (typeof module !== "undefined" && module.exports) module.exports = { S, C, EL, plc, V };
  global.PLANT_CORE = { S, C, EL, ND, A, accept, takeFrom, sensors, drives, plc, V, run, el };
})(typeof window !== "undefined" ? window : globalThis);
