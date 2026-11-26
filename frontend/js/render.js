/* Комбикормовый завод «Бугры» — отрисовка мнемосхемы на Canvas.
   Узлы и точки присоединения — из plant.js (S.ND, S.A). Продукт рисуется
   по ячейкам модели тракта (EL): где лежит масса в модели — там она и видна. */

(function (global) {
  "use strict";

  const P = global.PLANT;
  const { S, C: CT, EL, V, plc } = P;
  const ND = S.ND, A = S.A, M = S.machines;

  let cv, ctx, scale = 1, offX = 0, offY = 0, hover = null, selected = null;
  let fitScale = 1, zoom = 1, panX = 0, panY = 0;
  const IMG = {};
  const SPRITES = ["truck", "magnet"];
  const K = global.RKIT;
  let VOPT = { labels: true, pipes: true, tags: true, levels: true };
  const TAU = Math.PI * 2;
  const LBL = 1.75;            // подписи крупнее геометрии: схема 5200×2420 вписывается в экран с масштабом ~0,25
  const lblK = () => Math.max(0.8, LBL / Math.sqrt(zoom));   // при приближении подписи не растут вместе со схемой

  const COL = {
    bg0: "#e4e9ef", bg1: "#f7f8fa", grid: "rgba(0,67,149,.07)",
    pipe: "#8a97a6", pipeEdge: "#5c6977", text: "#16181c", textDim: "#566170",
    ok: "#37b866", warn: "#d9a53a", bad: "#e0503f", info: "#4b8fd1", idle: "#6f7d8c",
    steel0: "#3a4a55", steel1: "#c9d5db", steel2: "#7d929d", steel3: "#2a3944",
  };
  // цвет продукта по виду
  const KIND = {
    grain: ["#f2c14a", "#d49a2a", "#9c6a16"], meal: ["#ecd59a", "#d2b46a", "#a8884a"],
    add: ["#f1efe8", "#d8d3c6", "#a9a393"], mash: ["#d9b77a", "#b58d4c", "#7f5f2c"],
    pellet: ["#a8743c", "#86562a", "#5c3a1a"], oil: ["#f2c437", "#d8a316", "#a77a08"],
    fines: ["#b9b2a4", "#958c7c", "#6f6858"],
  };
  const kc = (k, i) => (KIND[k] || KIND.grain)[i || 0];

  /* ============================================================ камера */
  function init(canvas, onReady) {
    cv = canvas; ctx = cv.getContext("2d"); K.use(ctx); K.buildPatterns();
    resize();
    window.addEventListener("resize", resize);
    if (window.ResizeObserver) new ResizeObserver(resize).observe(cv.parentElement);
    let left = SPRITES.length;
    const done = () => { if (--left === 0 && onReady) onReady(); };
    SPRITES.forEach((name) => {
      const im = new Image();
      im.onload = () => { IMG[name] = im; IMG[name + "_flip"] = flip(im); done(); };
      im.onerror = done;
      im.src = "assets/" + name + ".webp";
    });
    const lg = new Image(); lg.onload = () => { IMG.logo = lg; }; lg.src = "assets/logo-contur.webp";
  }
  function flip(im) {
    const c = document.createElement("canvas"); c.width = im.naturalWidth; c.height = im.naturalHeight;
    const x = c.getContext("2d"); x.translate(c.width, 0); x.scale(-1, 1); x.drawImage(im, 0, 0); return c;
  }
  function resize() {
    const r = cv.parentElement.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.max(320, Math.round(r.width * dpr)); cv.height = Math.max(200, Math.round(r.height * dpr));
    cv.style.width = r.width + "px"; cv.style.height = r.height + "px";
    fitScale = Math.min(cv.width / S.W, cv.height / S.H);
    applyView();
  }
  function applyView() {
    scale = fitScale * zoom;
    const mx = Math.max(0, (S.W * scale - cv.width) / 2), my = Math.max(0, (S.H * scale - cv.height) / 2);
    panX = Math.max(-mx, Math.min(mx, panX)); panY = Math.max(-my, Math.min(my, panY));
    offX = (cv.width - S.W * scale) / 2 + panX; offY = (cv.height - S.H * scale) / 2 + panY;
  }
  function zoomAt(clientX, clientY, k) {
    const r = cv.getBoundingClientRect();
    const sx = (clientX - r.left) * cv.width / r.width, sy = (clientY - r.top) * cv.height / r.height;
    const wx = (sx - offX) / scale, wy = (sy - offY) / scale;
    zoom = Math.max(1, Math.min(8, zoom * k));
    const ns = fitScale * zoom;
    panX = sx - wx * ns - (cv.width - S.W * ns) / 2; panY = sy - wy * ns - (cv.height - S.H * ns) / 2;
    applyView();
  }
  function panBy(dx, dy) { const r = cv.getBoundingClientRect(); panX += dx * cv.width / r.width; panY += dy * cv.height / r.height; applyView(); }
  function fit() { zoom = 1; panX = 0; panY = 0; applyView(); }
  function focus(id) {
    const n = ND[id]; if (!n) return;
    zoom = Math.max(zoom, 2.6);
    const ns = fitScale * zoom, cx = n.x + n.w / 2, cy = n.y + n.h / 2;
    panX = cv.width / 2 - cx * ns - (cv.width - S.W * ns) / 2; panY = cv.height / 2 - cy * ns - (cv.height - S.H * ns) / 2;
    applyView(); selected = id;
  }
  function toWorld(cx, cy) {
    const r = cv.getBoundingClientRect(); if (!r.width) return [NaN, NaN];
    return [((cx - r.left) * cv.width / r.width - offX) / scale, ((cy - r.top) * cv.height / r.height - offY) / scale];
  }
  function toClient(wx, wy) { const r = cv.getBoundingClientRect(); return [r.left + (offX + wx * scale) * r.width / cv.width, r.top + (offY + wy * scale) * r.height / cv.height]; }
  function hitAt(wx, wy) {
    let best = null, area = 1e12;
    for (const [id, n] of Object.entries(ND)) {
      if (n.kind === "truck" && S.trucks[id] && S.trucks[id].phase === "away") continue;
      const tx = n.kind === "truck" ? truckX(id) : 0;
      const pad = n.w < 60 ? 8 : 0;
      if (wx >= n.x + tx - pad && wx <= n.x + tx + n.w + pad && wy >= n.y - pad && wy <= n.y + n.h + pad) {
        const a = n.w * n.h; if (a < area) { area = a; best = id; }
      }
    }
    return best;
  }

  /* ============================================================ утилиты */
  function rr(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function metal(x0, y0, x1, y1, dark) {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    const s = dark ? ["#2a363f", "#6f7f88", "#46555e", "#1c2730"] : [COL.steel0, COL.steel1, COL.steel2, COL.steel3];
    [0, 0.3, 0.6, 1].forEach((p, i) => g.addColorStop(p, s[i]));
    return g;
  }
  const hash = (k) => { const v = Math.sin(k * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
  const fbOf = (id) => plc.fbs[id];
  const running = (id) => !!(id && M[id] && M[id].spin > 0.05);
  const faulty = (id) => !!(id && fbOf(id) && fbOf(id).da);
  const handOf = (id) => !!(plc.DEF[id] && (V.MHand || V["fHand_" + id]));   // значок «Р» — только явный ручной режим
  function stateColor(id) {
    if (faulty(id)) return COL.bad;
    if (running(id)) return COL.ok;
    return COL.idle;
  }
  function led(x, y, id, r) {
    const c = stateColor(id), f = faulty(id);
    if (f && Math.floor(performance.now() / 400) % 2) return;
    ctx.beginPath(); ctx.arc(x, y, r || 7, 0, TAU);
    ctx.fillStyle = c; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = "rgba(0,0,0,.45)"; ctx.stroke();
    if (c !== COL.idle) { ctx.beginPath(); ctx.arc(x - 2, y - 2, (r || 7) * 0.35, 0, TAU); ctx.fillStyle = "rgba(255,255,255,.6)"; ctx.fill(); }
  }
  function label(text, x, y, o) {
    o = o || {};
    ctx.font = `${o.w || 800} ${Math.round((o.size || 22) * (o.fixed ? 1 : lblK()))}px Raleway, 'Segoe UI', sans-serif`;
    ctx.textAlign = o.align || "center"; ctx.textBaseline = o.base || "alphabetic";
    if (o.halo !== false) { ctx.lineWidth = 5; ctx.strokeStyle = "rgba(247,248,250,.92)"; ctx.lineJoin = "round"; ctx.strokeText(text, x, y); }
    ctx.fillStyle = o.color || COL.text; ctx.fillText(text, x, y);
  }
  function badge(text, x, y, o) {
    o = o || {};
    ctx.font = `800 ${o.size || 20}px Raleway, 'Segoe UI', sans-serif`;
    const w = ctx.measureText(text).width + 14, h = (o.size || 20) + 8;
    rr(x - w / 2, y - h / 2, w, h, 4);
    ctx.fillStyle = o.bg || "#13202a"; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = o.edge || "#47e07a"; ctx.stroke();
    ctx.fillStyle = o.color || "#5cf08a"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(text, x, y + 1);
    ctx.textBaseline = "alphabetic";
  }
  function polyPath(pts) { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); }
  const elMass = (id) => (EL[id] ? EL[id].cells.reduce((a, b) => a + b, 0) : 0);
  const cellAt = (e, t) => { const i = Math.floor(Math.max(0, Math.min(0.999, t)) * e.N); return e.cells[i]; };

  /* ============================================================ трубы (самотёк) */
  // Маршрут: вертикально из выпуска, наклонный участок, вертикально во впуск.
  function route(a, b, o) {
    o = o || {};
    if (o.pts) return o.pts;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    if (Math.abs(dx) < 3) return [a, b];
    if (dy > 40) {
      const k = Math.min(60, dy * 0.25), slope = Math.min(Math.abs(dx), dy - 2 * k);
      if (slope >= Math.abs(dx) - 1) return [a, [a[0], a[1] + k], [b[0], a[1] + k + Math.abs(dx)], b];
      return [a, [a[0], b[1] - k - Math.abs(dx)], [b[0], b[1] - k], b];
    }
    return [a, [a[0], a[1] + 14], [b[0], a[1] + 14], b];
  }
  const LINKS = [];
  // on() → интенсивность потока кг/с; kind() → вид продукта
  function link(a, b, on, kind, o) { LINKS.push(Object.assign({ pts: route(a, b, o), on, kind: kind || (() => "grain"), w: 12 }, o)); }
  const flowOf = (id) => () => (EL[id] ? EL[id].flow : 0);
  const kindOf = (id) => () => (EL[id] ? EL[id].kinds[EL[id].N - 1] : "grain");
  const outletOn = (id, i) => () => { const e = EL[id], o = e.outlets[i]; return o.when() ? Math.min(e.flow, 6) + (cellAt(e, o.at) > 0.01 ? 1 : 0) : 0; };
  function buildLinks() {
    const L = link;
    L(A.NorHole.out, [A.DVPT.in[0], A.DVPT.in[1]], flowOf("NorHole"));
    L(A.DVPT.o1, A.Scalp.in, () => (V.DVPT_Na_Scalp ? EL.NorHole.flow : 0));
    L(A.DVPT.o2, [A.Nor1.in[0], A.Nor1.in[1]], () => (V.DVPT_Na_Nor1 ? EL.NorHole.flow : 0), null, { pts: [A.DVPT.o2, [A.DVPT.o2[0] + 60, A.DVPT.o2[1] + 60], [A.DVPT.o2[0] + 60, 820], [A.Nor1.in[0], A.Nor1.in[1]]] });
    L(A.Scalp.out, A.Nor1.in, flowOf("Scalp"), null, { pts: [A.Scalp.out, [880, 660], [880, 860], A.Nor1.in] });
    L(A.Scalp.waste, A.trash.in, () => (EL.Scalp.flow > 0.3 ? 0.4 : 0), () => "fines");
    L(A.Nor1.out, [1372, 222], flowOf("Nor1"), null, { pts: [A.Nor1.out, [1060, 178], [1372, 178], [1372, 222]] });
    L([1172, 256], A.Tr1L.in, () => (V.GoL_Tr1 ? EL.Tr1.flow : 0), null, { pts: [[1175, 254], [1175, 312]] });
    L([1572, 256], A.Tr1R.in, () => (V.GoR_Tr1 ? EL.Tr1.flow : 0), null, { pts: [[1572, 254], [1572, 312]] });
    const tl = (e, i, cx) => L([cx, 348], [cx, 395], outletOn(e, i));
    tl("Tr1L", 0, 1215); tl("Tr1L", 1, 1343); L([1471, 348], [1471, 395], flowOf("Tr1L"));
    tl("Tr1R", 0, 1619); tl("Tr1R", 1, 1747); L([1875, 348], [1875, 395], flowOf("Tr1R"));
    [1215, 1343, 1471, 1619, 1747, 1875].forEach((cx, i) => L([cx + 24, 923], [cx + 24, 935], () => (running("K" + (i + 1)) ? 1 : 0), () => "grain", { w: 9 }));
    L([1545, 1033], [1545, 1050], () => (M.ZatvK.pos > 0.3 && CT.scale1.mass > 0.5 ? 4 : 0));
    L(A.TrKomp.out, A.Nor2.in, flowOf("TrKomp"), null, { pts: [A.TrKomp.out, [2030, 1100], [2030, 1100], A.Nor2.in] });
    L(A.Nor2.out, A.TrPBD.in, flowOf("Nor2"));
    L(A.TrPBD.out, A.PBD.in, flowOf("TrPBD"));
    L([2370, 470], [2300, 512], () => (running("Pit1") ? 1.2 : 0), () => CT.PBD.kind, { pts: [[2370, 470], [2370, 490], [2300, 490], [2300, 512]] });
    L([2430, 470], [2500, 512], () => (running("Pit2") ? 1.2 : 0), () => CT.PBD.kind, { pts: [[2430, 470], [2430, 490], [2500, 490], [2500, 512]] });
    L(A.Pit1.out, A.Drob1.in, flowOf("Pit1"), null, { pts: [A.Pit1.out, [A.Pit1.out[0], 600], [2300, 626], A.Drob1.in] });
    L(A.Pit2.out, A.Drob2.in, flowOf("Pit2"), null, { pts: [A.Pit2.out, [A.Pit2.out[0], 600], [2500, 626], A.Drob2.in] });
    L(A.Drob1.out, [2300, 982], () => (CT.Drob1.mass > 0.2 && running("Drob1") ? 1.5 : 0), () => "meal");
    L(A.Drob2.out, [2500, 982], () => (CT.Drob2.mass > 0.2 && running("Drob2") ? 1.5 : 0), () => "meal");
    L(A.TrDrob.out, A.Nor3.in, flowOf("TrDrob"));
    L(A.Nor3.out, A.UpBunk.in, flowOf("Nor3"), () => "meal", { pts: [A.Nor3.out, [2830, 476], [2960, 476], A.UpBunk.in] });
    for (let i = 0; i < 8; i++) { const cx = 2875 + i * 86; L([cx + 18, 340], [cx + 18, 345], () => (running("D" + (i + 1)) ? 1 : 0), () => "add", { w: 8 }); }
    L([2870, 421], [2870, 430], () => (M.ZatvD.pos > 0.3 && CT.scale2.mass > 0.2 ? 2 : 0), () => "add");
    L(A.TrDob.out, A.Nor3.in, flowOf("TrDob"), () => "add", { pts: [A.TrDob.out, [2806, 500], [2760, 500], [2760, 1000], A.Nor3.in] });
    L([2960, 708], [2960, 714], () => (M.KlapSms.pos > 0.3 && CT.UpBunk.mass > 1 ? 4 : 0), () => "meal");
    L(A.Sms.out, [2972, 866], () => (M.ShDownSms.pos > 0.3 && CT.Sms.mass > 1 ? 4 : 0), () => "mash");
    L(A.DownBunk.out, A.TrSms.in, () => (running("TrSms") && CT.DownBunk.mass > 1 ? 4 : 0), () => "mash", { pts: [A.DownBunk.out, [2972, 1040], [2912, 1040], [2912, 1044]] });
    L([3300, 590], [3255, 640], () => (V.Go_MasloDop ? 1 : 0), () => "oil", { w: 7, pts: [[3300, 590], [3300, 615], [3255, 615], [3255, 640]] });
    L([3255, 732], A.Sms.oil, () => (V.Go_MasloDos ? 1 : 0), () => "oil", { w: 7, pts: [[3255, 732], [3255, 700], [3100, 700], A.Sms.oil] });
    L([3152, 1094], A.Tr40100.in, outletOn("TrSms", 0), () => "mash", { pts: [[3152, 1094], [3152, A.Tr40100.in[1]]] });
    L(A.TrSms.out, A.Nor4.in, flowOf("TrSms"), () => "mash", { pts: [A.TrSms.out, [3590, 1170], A.Nor4.in] });
    L(A.Nor4.out, A.TrGP.in, flowOf("Nor4"), kindOf("Nor4"));
    L([3780, 214], [3780, 244], outletOn("TrGP", 0), kindOf("TrGP"));
    L(A.TrGP.out, A.Tr50400.in, flowOf("TrGP"), kindOf("TrGP"), { pts: [A.TrGP.out, [4314, 214], [4322, 244]] });
    const gk = [3820, 3935, 4050, 4165, 4360, 4475, 4590, 4705];
    [0, 1, 2].forEach((i) => L([gk[i], 306], [gk[i], 330], outletOn("Tr50300", i), kindOf("Tr50300")));
    L([gk[3], 280], [gk[3], 330], flowOf("Tr50300"), kindOf("Tr50300"));
    [0, 1, 2].forEach((i) => L([gk[4 + i], 306], [gk[4 + i], 330], outletOn("Tr50400", i), kindOf("Tr50400")));
    L([gk[7], 280], [gk[7], 330], flowOf("Tr50400"), kindOf("Tr50400"));
    gk.forEach((cx, i) => L([cx, 820], [cx, 900], () => (M["ShO" + (i + 1)].pos > 0.3 && CT["s" + (i + 1)].mass > 5 ? 5 : 0), () => CT["s" + (i + 1)].kind, { w: 14 }));
    // гранулирование
    L(A.Tr40100.out, A.Nor5.in, flowOf("Tr40100"), kindOf("Tr40100"), { pts: [[2350, 2400], [A.Nor5.in[0], 2400]] });
    L(A.Nor5.out, A.Tr40300.in, flowOf("Nor5"), () => "mash", { pts: [A.Nor5.out, A.Tr40300.in] });
    L(A.Tr40300.out, A.PBGran.in, flowOf("Tr40300"), () => "mash", { pts: [[2600, 1398], A.PBGran.in] });
    L(A.PBGran.out, [2600, 1627], () => (running("PitGr") ? 1 : 0), () => "mash", { pts: [A.PBGran.out, [2600, 1627]] });
    L([2496, 1649], A.KondGr.in, flowOf("PitGr"), () => "mash", { pts: [[2496, 1649], A.KondGr.in] });
    L(A.KondGr.out, A.Gran.in, () => (S.kondFlow || 0) * 2, () => "mash", { pts: [A.KondGr.out, A.Gran.in] });
    L(A.Gran.out, A.Ohl.in, () => (S.granFlow || 0) * 2, () => "pellet");
    L(A.Ohl.out, A.Tr40700.in, () => (M.Ohl.spin > 0.3 && CT.Ohl.mass > 5 ? 2 : 0), () => "pellet", { pts: [A.Ohl.out, [2780, 2286]] });
    L(A.Tr40700.out, A.Nor6.in, flowOf("Tr40700"), () => "pellet", { pts: [[3770, 2304], [A.Nor6.in[0], 2304]] });
    L(A.Nor6.out, A.PP1.in, flowOf("Nor6"), () => "pellet", { pts: [A.Nor6.out, [3962, 1358], A.PP1.in] });
    L(A.PP1.o1, A.Pros.in, () => (V.PP1_Pos1 ? EL.Nor6.flow : 0), () => "pellet", { pts: [A.PP1.o1, [A.PP1.o1[0], 1424], [A.Pros.in[0], 1424], A.Pros.in] });
    L(A.PP1.o2, A.Torba.in, () => (V.PP1_Pos2 ? EL.Nor6.flow : 0), () => "pellet", { pts: [A.PP1.o2, [A.PP1.o2[0], 1700], [4200, 1752], [4200, 1780]] });
    L(A.Pros.out, A.PP2.in, flowOf("Pros"), () => "pellet", { pts: [A.Pros.out, A.PP2.in] });
    L(A.Pros.waste, A.Tr40800.in, () => (EL.Pros.flow > 0.05 ? 0.4 : 0), () => "fines", { pts: [A.Pros.waste, [A.Pros.waste[0], 2340], [A.Tr40800.in[0], 2366], A.Tr40800.in] });
    L(A.PP2.o2, A.Tr51100.in, () => (V.PP2_Pos2 ? EL.Pros.flow : 0), () => "pellet", { pts: [A.PP2.o2, A.Tr51100.in] });
    L(A.PP2.o1, A.Torba.in, () => (V.PP2_Pos1 ? EL.Pros.flow : 0), () => "pellet", { pts: [A.PP2.o1, [A.PP2.o1[0], 1730], [4240, 1760], [4240, 1780]] });
    L(A.Tr51100.out, A.PP3.in, flowOf("Tr51100"), () => "pellet", { pts: [A.Tr51100.out, [4632, 1240]] });
    L(A.PP3.o1, A.Tr51200.in, () => (V.PP3_Pos1 ? EL.Tr51100.flow : 0), () => "pellet", { pts: [A.PP3.o1, [4614, 1191], [4590, 1191]] });
    L(A.PP3.o2, A.Nor7.in, () => (V.PP3_Pos2 ? EL.Tr51100.flow : 0), () => "pellet", { pts: [A.PP3.o2, [4650, 1330], [4650, 2280], A.Nor7.in] });
    L(A.Tr51200.out, A.Nor4.in, flowOf("Tr51200"), () => "pellet", { pts: [A.Tr51200.out, [3690, 1230], [3640, 1230], [3606, 1194]] });
    L(A.Nor7.out, A.b309.in, flowOf("Nor7"), () => "pellet", { pts: [A.Nor7.out, [4930, 1358], A.b309.in] });
    L([4930, 1990], [4930, 2060], () => (M.ShO9.pos > 0.3 && CT.s9.mass > 5 ? 5 : 0), () => "pellet", { w: 14 });
    L(A.Torba.out, [4295, 2100], () => (V.Go_Leb || CT.bigbag.mass > 0 ? 0 : 0), () => "pellet");
    L(A.Tr40800.out, A.Tr40100.in, flowOf("Tr40800"), () => "fines", { pts: [[3200, 2400], [3175, 2400]] });
  }
  // аспирационные воздуховоды (пунктир)
  // аспирационные воздуховоды: магистраль (w 24) и отводы к машинам (w 16); end — патрубок на корпусе
  const DUCTS = [
    { id: "Asp1", w: 24, pts: [[434, 129], [470, 129], [470, 70], [990, 70]] },
    { id: "Asp1", w: 16, end: true, pts: [[568, 70], [568, 150]] },
    { id: "Asp1", w: 16, end: true, pts: [[990, 70], [990, 120]] },
    { id: "Asp1", w: 16, end: true, pts: [[795, 70], [795, 470]] },
    { id: "Asp2", w: 26, pts: [[4956, 139], [4930, 139], [4930, 50], [2088, 50]] },
    { id: "Asp2", w: 16, end: true, pts: [[2088, 50], [2088, 140]] },
    { id: "Asp2", w: 16, end: true, pts: [[2440, 50], [2440, 250]] },
    { id: "Asp2", w: 16, end: true, pts: [[2676, 50], [2676, 982]] },
    { id: "Asp2", w: 16, end: true, pts: [[2748, 50], [2748, 120]] },
    { id: "Asp2", w: 16, end: true, pts: [[3062, 50], [3062, 712]] },
    { id: "Asp2", w: 16, end: true, pts: [[3500, 50], [3500, 345]] },
    { id: "Asp2", w: 16, end: true, pts: [[3648, 50], [3648, 110]] },
    { id: "AspGr", w: 20, end: true, pts: [[3014, 1409], [3072, 1409], [3072, 2093], [2896, 2093]] },
  ];

  /* ============================================================ частицы в трубах */
  const PARTS = [];
  function segsOf(L) {
    if (L._sg) return L._sg;
    const s = { list: [], total: 0 };
    for (let i = 1; i < L.pts.length; i++) {
      const [x0, y0] = L.pts[i - 1], [x1, y1] = L.pts[i], len = Math.hypot(x1 - x0, y1 - y0);
      if (len < 0.5) continue;
      s.list.push({ x0, y0, ux: (x1 - x0) / len, uy: (y1 - y0) / len, len, from: s.total }); s.total += len;
    }
    L._sg = s; return s;
  }
  let seed = 1;
  function stepParticles(dt) {
    dt = Math.min(0.05, dt);
    for (const L of LINKS) {
      const q = Math.max(0, +L.on() || 0);
      L._sp = (L._sp || 0) + Math.min(60, q * 9) * dt;
      const sg = segsOf(L); if (!sg.list.length) continue;
      while (L._sp >= 1) {
        L._sp -= 1;
        if (PARTS.length > 2500) break;
        if (L.kind() === "oil") { L._sp = 0; continue; }
        const r = hash(seed++);
        PARTS.push({ L, s: r * 4, v: 120 + 80 * hash(seed++), seg: 0, off: (r - 0.5) * (L.w * 0.55), c: kc(L.kind(), (seed % 3)) });
      }
    }
    let w = 0;
    for (const p of PARTS) {
      const sg = segsOf(p.L); let sc = sg.list[p.seg];
      p.v = Math.max(90, Math.min(900, p.v + (1400 * sc.uy - 400 * Math.abs(sc.ux)) * dt));
      p.s += p.v * dt;
      while (p.seg < sg.list.length - 1 && p.s >= sc.from + sc.len) { p.seg++; sc = sg.list[p.seg]; p.v *= 0.6; }
      if (p.s >= sg.total) continue;
      PARTS[w++] = p;
    }
    PARTS.length = w;
  }
  function drawParticles() {
    for (const p of PARTS) {
      const sg = segsOf(p.L), sc = sg.list[p.seg], d = p.s - sc.from;
      const x = sc.x0 + sc.ux * d - sc.uy * p.off, y = sc.y0 + sc.uy * d + sc.ux * p.off;
      ctx.beginPath(); ctx.ellipse(x, y, 3.4 + Math.min(3, p.v / 260), 2.5, Math.atan2(sc.uy, sc.ux), 0, TAU);
      ctx.fillStyle = p.c; ctx.fill();
    }
  }
  /* ============================================================ трубы, воздуховоды, пар */
  const T = () => performance.now() / 1000;
  function drawPipes() {
    const t = T();
    for (const L of LINKS) {
      const oil = L.kind() === "oil";
      K.pipe(L.pts, oil ? 8 : L.w, { kind: oil ? "oil" : "galv" });
      if (oil && (+L.on() || 0) > 0.05) K.pipeFlow(L.pts, 8, "rgba(246,196,40,.95)", 70, t);
    }
  }
  function drawDucts() {
    const t = T();
    for (const d of DUCTS) {
      K.duct(d.pts, d.w, running(d.id), t);
      if (d.end) { const p = d.pts[d.pts.length - 1], q = d.pts[d.pts.length - 2]; if (Math.abs(p[0] - q[0]) < 1) K.aspNozzle(p[0], p[1] + 2, d.w + 6); }
    }
  }
  // Паропровод котёл → кондиционер (в теплоизоляции), регулирующий клапан, конденсатоотводчик;
  // линии питательной воды и возврата конденсата.
  const STEAM = () => [A.boiler.steam, [A.boiler.steam[0], 1236], [A.KondGr.steam[0], 1236], A.KondGr.steam];
  function drawSteam() {
    const t = T(), pts = STEAM(), pos = +V.SteamValve || 0, fire = !S.noSteam;
    ctx.save(); K.path(pts); ctx.lineJoin = "miter"; ctx.strokeStyle = "#2a343b"; ctx.lineWidth = 23; ctx.stroke();
    K.path(pts); ctx.strokeStyle = K.pat("clad"); ctx.lineWidth = 20; ctx.stroke(); ctx.restore();
    // бандажи изоляции
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], L = Math.hypot(x1 - x0, y1 - y0), ux = (x1 - x0) / L, uy = (y1 - y0) / L;
      for (let d = 30; d < L - 10; d += 70) { const x = x0 + ux * d, y = y0 + uy * d; ctx.beginPath(); ctx.moveTo(x - uy * 11, y + ux * 11); ctx.lineTo(x + uy * 11, y - ux * 11); ctx.lineWidth = 2; ctx.strokeStyle = "#7b858c"; ctx.stroke(); }
    }
    if (fire && pos > 1) K.pipeFlow(pts, 20, `rgba(255,255,255,${0.35 + pos / 250})`, 90 + pos * 2, t, [26, 18]);
    K.flange(pts[0][0], pts[0][1] - 3, 0, -1, 18); K.flange(pts[3][0], pts[3][1] - 3, 0, 1, 18);
    // регулирующий клапан с электроприводом на опуске к кондиционеру
    const vx = A.KondGr.steam[0], vy = 1520;
    K.valve(vx, vy, 1.3, pos > 1, true);
    K.rr(vx + 16, vy - 18, 34, 36, 4); K.skin("paint", K.shadeFlat(vx + 16, vy - 18, 34, 36), "#142a46", 1.2);
    ctx.fillStyle = "#e8eef2"; ctx.fillRect(vx + 20, vy - 6, 26, 12);
    ctx.fillStyle = "#2f9a5a"; ctx.fillRect(vx + 21, vy - 5, 24 * Math.min(1, pos / 100), 10);
    badge(`Пар ${Math.round(pos)}%`, vx - 64, vy, { size: 14, color: fire ? "#ffffff" : "#ff8a7a", edge: fire ? "#c8d6e0" : "#ff6a5a" });
    // манометр после клапана
    K.gauge(vx - 34, 1600, 12, fire ? 0.15 + pos / 160 : 0, { stem: 8 });
    ctx.fillStyle = "#7b858c"; ctx.fillRect(vx - 36, 1620, 26, 3);
    // конденсатоотводчик
    K.rr(vx - 20, 1612, 14, 20, 3); K.skin("brushed", null, "#2a343b", 1);
  }

  /* ============================================================ мелкие помощники */
  const faultFrame = (x, y, w, h) => { ctx.strokeStyle = COL.bad; ctx.lineWidth = 4; ctx.setLineDash([10, 6]); ctx.strokeRect(x - 8, y - 8, w + 16, h + 16); ctx.setLineDash([]); };
  // Вибрация работающей машины (стук/дрожь), амплитуда в мировых единицах.
  const jit = (id, a, f) => { const m = M[id]; if (!m || m.spin < 0.2) return [0, 0]; const t = T() * (f || 70); return [Math.sin(t * 1.7 + hash(id.length)) * a * m.spin, Math.sin(t * 2.3) * a * 0.6 * m.spin]; };
  const prodPat = (k) => K.grain(k || "grain", KIND[k] || KIND.grain);
  // Сыпучий продукт: фактура + тень к низу, верх — естественный откос (горка).
  function bulk(x, w, yTop, yBot, kind, hump) {
    if (yBot - yTop < 0.5) return;
    hump = Math.min(hump || 0, (yBot - yTop) * 0.8);
    ctx.save(); ctx.beginPath(); ctx.moveTo(x, yBot); ctx.lineTo(x, yTop + hump);
    ctx.quadraticCurveTo(x + w * 0.25, yTop + hump * 0.15, x + w / 2, yTop); ctx.quadraticCurveTo(x + w * 0.75, yTop + hump * 0.15, x + w, yTop + hump);
    ctx.lineTo(x + w, yBot); ctx.closePath();
    ctx.fillStyle = prodPat(kind); ctx.fill();
    const g = ctx.createLinearGradient(0, yTop, 0, yBot); g.addColorStop(0, "rgba(255,240,210,.12)"); g.addColorStop(1, "rgba(30,18,4,.38)");
    ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = "rgba(60,40,10,.35)"; ctx.stroke(); ctx.restore();
  }
  // Тёмная полость в разрезе с внутренней тенью.
  function cavity(x, y, w, h, r) {
    K.rr(x, y, w, h, r || 0);
    const g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, "#0d1419"); g.addColorStop(1, "#1d2830");
    ctx.fillStyle = g; ctx.fill();
  }
  // Рамка окна разреза: оцинкованная окантовка с болтами.
  function cutFrame(x, y, w, h, r) { K.rr(x, y, w, h, r || 0); ctx.lineWidth = 3; ctx.strokeStyle = "#5d6a73"; ctx.stroke(); ctx.lineWidth = 1; ctx.strokeStyle = "#1c252b"; ctx.stroke(); }

  /* ============================================================ нория */
  function drawNoria(n) {
    const m = M[n.id], e = EL[n.id], x = n.x, y = n.y, w = n.w, h = n.h, f = faulty(n.id), t = T(), run = m ? m.spin : 0;
    const legW = w * 0.3, lx = x + w * 0.12, rx = x + w * 0.58;
    // трубы (короба) восходящей и нисходящей ветвей, секции на фланцах
    [lx, rx].forEach((X) => {
      ctx.beginPath(); ctx.rect(X, y + 60, legW, h - 120); K.skin("galv", K.shadeCyl(X, 0, X + legW, 0, 0.9), "#26323a", 1.6);
      for (let yy = y + 150; yy < y + h - 70; yy += 150) { ctx.fillStyle = "#7d8a93"; ctx.fillRect(X - 3, yy, legW + 6, 6); ctx.strokeStyle = "#1f292f"; ctx.lineWidth = 1; ctx.strokeRect(X - 3, yy, legW + 6, 6); K.bolts(X - 1, yy + 3, X + legW + 1, yy + 3, 3, 1.2); }
    });
    // связи между ветвями
    for (let yy = y + 225; yy < y + h - 90; yy += 300) { ctx.fillStyle = "#56636c"; ctx.fillRect(lx + legW, yy, rx - lx - legW, 5); }
    // смотровое окно восходящей ветви: лента с ковшами и продукт
    const wy0 = y + 90, wy1 = y + h - 76;
    if (m) m._belt = (m._belt || 0) + run * 3;
    ctx.save(); ctx.beginPath(); ctx.rect(lx + 4, wy0, legW - 8, wy1 - wy0); ctx.clip();
    cavity(lx + 4, wy0, legW - 8, wy1 - wy0);
    ctx.fillStyle = "#3b3b36"; ctx.fillRect(lx + 6, wy0, 4, wy1 - wy0);   // лента
    const sp = 26, off = ((m && m._belt) || 0) % sp;
    for (let yy = wy1 + sp - off; yy > wy0 - sp; yy -= sp) {
      K.path([[lx + 9, yy], [lx + legW - 6, yy - 3], [lx + legW - 9, yy + 10], [lx + 9, yy + 11]], true);
      ctx.fillStyle = "#c46f2a"; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = "#5a2f10"; ctx.stroke();   // пластиковый ковш
      if (e) {
        const tt = 1 - (yy - wy0) / (wy1 - wy0), q = cellAt(e, tt) / (e.cap || 1);
        if (q > 0.03) { const hh = Math.min(7, 7 * q + 1); ctx.fillStyle = prodPat(e.kinds[Math.min(e.N - 1, Math.floor(tt * e.N))] || "grain"); ctx.beginPath(); ctx.ellipse(lx + legW / 2 + 1, yy - hh / 2 + 1, legW / 2 - 9, hh, 0, Math.PI, 0); ctx.fill(); }
      }
    }
    ctx.restore();
    cutFrame(lx + 4, wy0, legW - 8, wy1 - wy0);
    // головка: колпак с разрезом, приводной барабан, лента огибает барабан
    const hx = x + w / 2, hy = y + 46, hr = w / 2 - 2;
    ctx.beginPath(); ctx.moveTo(x + 2, y + 76); ctx.lineTo(x + 2, hy); ctx.arc(hx, hy, hr, Math.PI, 0); ctx.lineTo(x + w - 2, y + 76); ctx.closePath();
    K.skin("galv", K.shadeCyl(x, 0, x + w, 0), "#26323a", 2);
    ctx.fillStyle = "#7d8a93"; ctx.fillRect(x - 2, y + 72, w + 4, 6); K.bolts(x + 2, y + 75, x + w - 2, y + 75, 5, 1.3);
    ctx.save(); ctx.beginPath(); ctx.arc(hx, hy, 27, 0, TAU); ctx.clip(); cavity(hx - 27, hy - 27, 54, 54);
    const ang = m && m._belt ? m._belt / 20 : 0;
    ctx.beginPath(); ctx.arc(hx, hy, 24, 0, TAU); ctx.fillStyle = "#3b3b36"; ctx.fill();   // лента на барабане
    ctx.beginPath(); ctx.arc(hx, hy, 20, 0, TAU); ctx.fillStyle = K.pat("brushed"); ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = "#1c252b"; ctx.stroke();
    ctx.strokeStyle = "#4e5a62"; ctx.lineWidth = 3.5;
    for (let k = 0; k < 6; k++) { const q = ang + k * TAU / 6; ctx.beginPath(); ctx.moveTo(hx + Math.cos(q) * 5, hy + Math.sin(q) * 5); ctx.lineTo(hx + Math.cos(q) * 18, hy + Math.sin(q) * 18); ctx.stroke(); }
    for (let k = 0; k < 8; k++) { const q = ang + k * TAU / 8; ctx.save(); ctx.translate(hx + Math.cos(q) * 25, hy + Math.sin(q) * 25); ctx.rotate(q); ctx.fillStyle = "#c46f2a"; ctx.fillRect(-1, -4, 6, 8); ctx.restore(); }
    ctx.beginPath(); ctx.arc(hx, hy, 5, 0, TAU); ctx.fillStyle = "#2a343b"; ctx.fill();
    ctx.restore(); ctx.beginPath(); ctx.arc(hx, hy, 27, 0, TAU); ctx.lineWidth = 3; ctx.strokeStyle = "#5d6a73"; ctx.stroke();
    // выпускной патрубок головки
    K.path([[x + w - 6, y + 28], [x + w + 30, y + 46], [x + w + 30, y + 70], [x + w - 6, y + 66]], true); K.skin("galv", K.shadeFlat(x + w, y + 28, 36, 42), "#26323a", 1.6);
    K.flange(x + w + 29, y + 58, 1, 0, 22);
    // мотор-редуктор на валу барабана
    K.gearMotor(x - 6, hy + 4, 0.72, { dir: -1, run, t });
    // башмак: натяжные винты, лючок очистки, ДКС на валу
    const by = y + h - 66;
    ctx.beginPath(); ctx.rect(x, by, w, 66); K.skin("galv", K.shadeFlat(x, by, w, 66), "#26323a", 2);
    ctx.fillStyle = "#7d8a93"; ctx.fillRect(x - 2, by - 3, w + 4, 6); K.bolts(x + 2, by, x + w - 2, by, 5, 1.3);
    [x + 10, x + w - 14].forEach((X) => { ctx.fillStyle = K.pat("brushed"); ctx.fillRect(X, by - 22, 4, 26); ctx.fillStyle = "#2a343b"; ctx.fillRect(X - 3, by - 24, 10, 4); });
    if (e) { const boot = e.cells[0] + e.cells[1] + e.cells[2]; const fr = Math.min(1, boot / (e.cap * 3)); ctx.save(); ctx.beginPath(); ctx.rect(x + 8, by + 10, w - 16, 46); ctx.clip(); cavity(x + 8, by + 10, w - 16, 46); if (fr > 0.02) bulk(x + 8, w - 16, by + 56 - 44 * fr, by + 56, e.kinds[0], 8); ctx.restore(); cutFrame(x + 8, by + 10, w - 16, 46); }
    ctx.beginPath(); ctx.arc(x + w - 6, by + 33, 6, 0, TAU); ctx.fillStyle = "#e3b51e"; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = "#5b4508"; ctx.stroke();
    ctx.fillStyle = K.pat("concrete"); ctx.fillRect(x - 10, y + h, w + 20, 10); ctx.strokeStyle = "#5b5f60"; ctx.lineWidth = 1; ctx.strokeRect(x - 10, y + h, w + 20, 10);
    if (f) faultFrame(x, y, w, h);
    led(x + w / 2, by + 33, n.id, 7);
  }

  /* ============================================================ конвейеры */
  // Корпус конвейера в локальных координатах: ось X — вдоль, 0..len; -h/2..h/2.
  // prod(X) → [доля заполнения 0..1, вид продукта].
  function conveyorBody(len, h, o) {
    const t = T(), chain = !!o.chain, small = !!o.small;
    // корпус: трубчатый (шнек) или короб (цепной)
    K.rr(0, -h / 2, len, h, chain ? 3 : h / 2.2);
    K.skin("galv", K.shadeCyl(0, -h / 2, 0, h / 2, chain ? 0.6 : 1), "#26323a", 1.8);
    if (!small) {
      for (let X = 110; X < len - 30; X += 140) { ctx.fillStyle = "#7d8a93"; ctx.fillRect(X, -h / 2 - 2, 5, h + 4); ctx.lineWidth = 1; ctx.strokeStyle = "#1f292f"; ctx.strokeRect(X, -h / 2 - 2, 5, h + 4); K.bolts(X + 2.5, -h / 2 + 3, X + 2.5, h / 2 - 3, 2, 1.2); }
      if (chain) { ctx.fillStyle = "rgba(255,255,255,.25)"; ctx.fillRect(4, -h / 2 + 2, len - 8, 3); }
    }
    // окно разреза
    const pad = small ? 7 : 16, wx = pad, ww = len - pad * 2, wh = h * (small ? 0.62 : 0.6), wy = -wh / 2;
    ctx.save(); ctx.beginPath(); ctx.rect(wx, wy, ww, wh); ctx.clip();
    cavity(wx, wy, ww, wh);
    const ph = o.phase || 0;
    if (chain) {
      // нижняя (рабочая) ветвь цепи со скребками, продукт волочится по днищу
      for (let X = wx; X <= wx + ww; X += 4) { const [q] = o.prod(X); if (q > 0.01) { ctx.fillStyle = prodPat(o.prod(X)[1]); ctx.fillRect(X, wy + wh - wh * 0.62 * q, 4.5, wh * 0.62 * q); } }
      const pitch = 28, p0 = ((ph * pitch) % pitch + pitch) % pitch;
      for (let X = wx - pitch + p0; X < wx + ww + pitch; X += pitch) {
        ctx.fillStyle = "#1e2428"; ctx.fillRect(X, wy + wh * 0.42, pitch * 0.55, 4); ctx.fillRect(X + pitch * 0.45, wy + wh * 0.42 + 1, pitch * 0.55, 2);
        ctx.fillStyle = "#c8cfd3"; ctx.fillRect(X, wy + wh * 0.3, 4, wh * 0.66);   // скребок (UHMW)
        ctx.fillStyle = "#1e2428"; ctx.fillRect(X - pitch * 0.2, wy + 3, pitch * 0.55, 3);   // холостая ветвь
      }
    } else {
      // шнек: задняя кромка витка (тёмная) → продукт → передняя кромка (светлая) → вал
      const pitch = small ? 12 : o.pitch || 22, p0 = ((ph * pitch) % pitch + pitch) % pitch;
      ctx.strokeStyle = "#56626a"; ctx.lineWidth = small ? 1.5 : 2.2;
      for (let X = wx - pitch + p0; X < wx + ww + pitch; X += pitch) { ctx.beginPath(); ctx.moveTo(X + pitch * 0.5, wy + wh); ctx.quadraticCurveTo(X + pitch * 0.75, wy + wh / 2, X + pitch, wy); ctx.stroke(); }
      for (let X = wx; X <= wx + ww; X += 4) { const [q, k] = o.prod(X); if (q > 0.01) { ctx.fillStyle = prodPat(k); ctx.fillRect(X, wy + wh - wh * 0.8 * q, 4.5, wh * 0.8 * q); } }
      for (let X = wx - pitch + p0; X < wx + ww + pitch; X += pitch) {
        ctx.beginPath(); ctx.moveTo(X, wy); ctx.quadraticCurveTo(X + pitch * 0.25, wy + wh / 2, X + pitch * 0.5, wy + wh);
        ctx.strokeStyle = "#cfd8de"; ctx.lineWidth = small ? 2 : 3; ctx.stroke(); ctx.strokeStyle = "rgba(40,50,58,.6)"; ctx.lineWidth = 0.8; ctx.stroke();
      }
      ctx.fillStyle = K.pat("brushed"); ctx.fillRect(wx, -2.5, ww, 5); ctx.fillStyle = "rgba(0,0,0,.3)"; ctx.fillRect(wx, 1.5, ww, 1);
    }
    ctx.restore();
    cutFrame(wx, wy, ww, wh);
    // торцевые крышки с подшипниковыми узлами
    [0, len].forEach((X) => { ctx.fillStyle = "#7d8a93"; ctx.fillRect(X - 3, -h / 2 - 3, 6, h + 6); ctx.strokeStyle = "#1f292f"; ctx.lineWidth = 1; ctx.strokeRect(X - 3, -h / 2 - 3, 6, h + 6); });
    void t;
  }
  function drawScrew(n) {
    const m = M[n.id], e = EL[n.id], f = faulty(n.id), t = T(), run = m ? m.spin : 0;
    const small = n.small, h = small ? 22 : n.h, cy = n.cy, x = n.x, w = n.w;
    m._ph = (m._ph || 0) + run * 0.22 * (n.reverse ? (V.GoR_Tr1 ? 1 : -1) : n.dir);
    const prod = (X) => {
      if (e) { const tt = n.dir > 0 ? X / w : 1 - X / w; return [Math.min(1, cellAt(e, tt) / (e.cap || 1)), e.kinds[Math.floor(e.N / 2)]]; }
      if (n.dozer && run > 0.05) return [0.45, n.bunk > 200 ? "add" : "grain"];
      return [0, "grain"];
    };
    // опоры
    if (!small) [x + 30, x + w - 34].forEach((X) => { ctx.fillStyle = "#56636c"; ctx.fillRect(X, cy + h / 2, 6, 14); ctx.fillRect(X - 6, cy + h / 2 + 12, 18, 4); });
    ctx.save(); ctx.translate(x, cy);
    conveyorBody(w, h, { chain: n.chain, small, phase: m._ph, prod });
    ctx.restore();
    // патрубки загрузки / выгрузки
    if (!small && !n.chain) {
      const ix = n.dir > 0 ? x + 22 : x + w - 22, ox = n.dir > 0 ? x + w - 16 : x + 16;
      K.rr(ix - 13, cy - h / 2 - 8, 26, 9, 1); K.skin("galv", null, "#26323a", 1.2);
      K.rr(ox - 11, cy + h / 2 - 1, 22, 8, 1); K.skin("galv", null, "#26323a", 1.2);
    }
    // привод
    if (n.motorAt === "mid") K.gearMotor(x + w / 2, cy - h / 2 - 16, 0.6, { dir: 1, run, t });
    else if (small) { if (n.dozer || n.pch) K.gearMotor(n.dir > 0 ? x - 6 : x + w + 6, cy, 0.42, { dir: n.dir > 0 ? -1 : 1, run, t }); }
    else K.gearMotor(n.dir > 0 ? x - 8 : x + w + 8, cy, n.chain ? 0.7 : 0.62, { dir: n.dir > 0 ? -1 : 1, run, t });
    if (n.pch && !small) { ctx.font = "800 13px Raleway"; ctx.fillStyle = "#0a4c9a"; ctx.textAlign = "left"; ctx.fillText("ПЧ", x + 4, cy - h / 2 - 6); }
    if (f) faultFrame(x, cy - h / 2, w, h);
    led(n.dir > 0 ? x + w - 12 : x + 12, cy + h / 2 + 9, n.id, small ? 4 : 6);
  }
  function drawScraper(n) {
    const m = M[n.id], e = EL[n.id], f = faulty(n.id), t = T(), run = m ? m.spin : 0;
    const { x1, y1, x2, y2 } = n, ang = Math.atan2(y2 - y1, x2 - x1), len = Math.hypot(x2 - x1, y2 - y1), h = 40;
    m._ph = (m._ph || 0) + run * 0.22;
    const prod = (X) => (e ? [Math.min(1, cellAt(e, X / len) / (e.cap || 1)), e.kinds[Math.floor(e.N / 2)]] : [0, "grain"]);
    ctx.save(); ctx.translate(x1, y1); ctx.rotate(ang);
    conveyorBody(len, h, { chain: !n.screwType, phase: m._ph, prod, pitch: 26 });
    ctx.restore();
    K.gearMotor(x2 + Math.cos(ang) * 10, y2 + Math.sin(ang) * 10 - 4, 0.66, { dir: Math.cos(ang) >= 0 ? 1 : -1, run, t });
    if (f) faultFrame(Math.min(x1, x2), Math.min(y1, y2) - h / 2, Math.abs(x2 - x1), Math.abs(y2 - y1) + h);
    led(x2 - Math.cos(ang) * 20, y2 - Math.sin(ang) * 20 + 26, n.id, 6);
  }

  /* ============================================================ бункеры */
  function bunkerFill(n) { const c = CT[n.level]; return c ? Math.max(0, Math.min(1.04, c.mass / c.cap)) : 0; }
  function drawBunker(n) {
    const c = CT[n.level], x = n.x, y = n.y, w = n.w, h = n.h;
    const cone = Math.min(w * 0.55, h * 0.3), body = h - cone, nz = Math.max(18, w * 0.16);
    const shape = () => { ctx.beginPath(); ctx.moveTo(x, y + 8); ctx.lineTo(x + w, y + 8); ctx.lineTo(x + w, y + body); ctx.lineTo(x + w / 2 + nz / 2, y + h); ctx.lineTo(x + w / 2 - nz / 2, y + h); ctx.lineTo(x, y + body); ctx.closePath(); };
    // разрез: полость, продукт с откосом, стенки по краям
    const fr = bunkerFill(n);
    ctx.save(); shape(); ctx.clip();
    cavity(x, y, w, h);
    if (c && fr > 0.002) {
      const lvlY = y + h - (h - 8) * Math.min(1, fr), hump = Math.min(w * 0.16, (y + h - lvlY) * 0.5);
      bulk(x, w, lvlY - hump * 0.4, y + h, c.kind, hump);
    }
    // внутренняя тень стенок
    const gs = ctx.createLinearGradient(x, 0, x + w, 0); gs.addColorStop(0, "rgba(0,0,0,.45)"); gs.addColorStop(0.12, "rgba(0,0,0,0)"); gs.addColorStop(0.88, "rgba(0,0,0,0)"); gs.addColorStop(1, "rgba(0,0,0,.45)");
    ctx.fillStyle = gs; ctx.fillRect(x, y, w, h);
    ctx.restore();
    // стенки из оцинкованного листа (видна толщина), рёбра жёсткости, швы конуса
    const wall = 6;
    [[x, y + 8, wall, body - 8], [x + w - wall, y + 8, wall, body - 8]].forEach(([X, Y, W, H]) => { ctx.fillStyle = K.pat("galv"); ctx.fillRect(X, Y, W, H); ctx.fillStyle = "rgba(0,0,0,.2)"; ctx.fillRect(X, Y, W, H); });
    shape(); ctx.lineWidth = 2.6; ctx.strokeStyle = "#26323a"; ctx.stroke();
    for (let yy = y + 60; yy < y + body - 10; yy += 70) { ctx.fillStyle = "#6e7b84"; ctx.fillRect(x - 5, yy, 7, 9); ctx.fillRect(x + w - 2, yy, 7, 9); }
    ctx.strokeStyle = "rgba(200,210,216,.5)"; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x + 3, y + body); ctx.lineTo(x + w / 2 - nz / 2 + 2, y + h - 2); ctx.moveTo(x + w - 3, y + body); ctx.lineTo(x + w / 2 + nz / 2 - 2, y + h - 2); ctx.stroke();
    ctx.fillStyle = "#7d8a93"; ctx.fillRect(x - 3, y + body - 3, 8, 6); ctx.fillRect(x + w - 5, y + body - 3, 8, 6);
    // крыша с люком
    ctx.beginPath(); ctx.rect(x - 4, y, w + 8, 10); K.skin("galv", K.shadeFlat(x, y, w, 10), "#26323a", 1.4);
    K.bolts(x, y + 5, x + w, y + 5, Math.max(3, Math.round(w / 22)), 1.3);
    if (w >= 90) { K.rr(x + w * 0.62, y - 7, w * 0.22, 8, 2); K.skin("galv", null, "#26323a", 1); }
    // выпускной фланец
    ctx.fillStyle = "#7d8a93"; ctx.fillRect(x + w / 2 - nz / 2 - 4, y + h - 3, nz + 8, 6); ctx.strokeStyle = "#1f292f"; ctx.lineWidth = 1; ctx.strokeRect(x + w / 2 - nz / 2 - 4, y + h - 3, nz + 8, 6);
    // ДВУ / ДНУ — ротационные датчики уровня на стенке
    if (VOPT.levels && c) {
      const dvu = sensorDVU(n), dnu = sensorDNU(n);
      if (dvu !== null) levelSensor(x + w, y + 26, dvu, true);
      if (dnu !== null) levelSensor(x + w - (cone > 30 ? 0 : 0), y + body - 14, dnu, false);
    }
    if (n.num) badge(String(n.num), x + w / 2, y + 40, { size: Math.min(26, w * 0.24), bg: "#004395", edge: "#cfe0f5", color: "#fff" });
    else if (n.label) label(BSHORT[n.id] || n.label, x - 8, y + 34, { size: 17, align: "right" });
    if (c) {
      const pct = Math.round(fr * 100);
      badge(c.mass >= 1000 ? (c.mass / 1000).toFixed(1) + " т" : Math.round(c.mass) + " кг", x + w / 2, y + body * 0.55, { size: Math.min(18, w * 0.16) });
      if (n.kindB !== "add") badge(pct + "%", x + w / 2, y + body * 0.55 + 30, { size: Math.min(16, w * 0.14), edge: "#89a0b3", color: "#d7e5f0" });
      if (c.prod && c.mass > 1 && VOPT.labels && w >= 100) {
        ctx.save(); ctx.translate(x + w / 2, y + body - 8);
        ctx.font = "700 13px Raleway"; ctx.textAlign = "center"; ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,.6)"; ctx.fillStyle = "#fff";
        wrap(c.prod, w - 10).forEach((ln, i, arr) => { ctx.strokeText(ln, 0, -((arr.length - 1 - i) * 15)); ctx.fillText(ln, 0, -((arr.length - 1 - i) * 15)); });
        ctx.restore();
      }
    }
  }
  function levelSensor(x, y, on, top) {
    K.rr(x - 1, y - 7, 14, 14, 3); K.skin("galv", null, "#26323a", 1);
    ctx.beginPath(); ctx.arc(x + 20, y, 6.5, 0, TAU); ctx.fillStyle = on ? (top ? "#ff5a3c" : "#47e07a") : "#55626c"; ctx.fill();
    if (on) { ctx.beginPath(); ctx.arc(x + 18, y - 2, 2.2, 0, TAU); ctx.fillStyle = "rgba(255,255,255,.7)"; ctx.fill(); }
    ctx.beginPath(); ctx.arc(x + 20, y, 6.5, 0, TAU); ctx.lineWidth = 1.5; ctx.strokeStyle = "#1b252c"; ctx.stroke();
  }
  const BSHORT = { PBD: "НДБ", UpBunk: "НСБ", DownBunk: "ПСБ", PBGran: "БО-5" };
  function wrap(text, width) {
    const words = String(text).split(" "), out = []; let cur = "";
    for (const wd of words) { const t = cur ? cur + " " + wd : wd; if (ctx.measureText(t).width > width && cur) { out.push(cur); cur = wd; } else cur = t; }
    if (cur) out.push(cur); return out.slice(-3);
  }
  function sensorDVU(n) {
    const k = n.level;
    if (/^b10\d$/.test(n.id)) return V.DVU_BunkK[n.num - 100];
    if (/^b20\d$/.test(n.id)) return V.DVU_BunkD[n.num - 200];
    if (/^s\d+$/.test(k)) return V.DVU_Silo[+k.slice(1)];
    const map = { PBD: "DVU_PBD", UpBunk: "DVU_UpBunk", DownBunk: "DVU_DownBunk", PBGran: "DVU_PBGran" };
    return map[k] ? !!V[map[k]] : null;
  }
  function sensorDNU(n) {
    const k = n.level;
    if (/^b10\d$/.test(n.id)) return V.DNU_BunkK[n.num - 100];
    if (/^b20\d$/.test(n.id)) return V.DNU_BunkD[n.num - 200];
    if (/^s\d+$/.test(k)) return V.DNU_Silo[+k.slice(1)];
    const map = { PBD: "DNU_PBD", UpBunk: "DNU_UpBunk", DownBunk: "DNU_DownBunk", PBGran: "DNU_PBGran" };
    return map[k] ? !!V[map[k]] : null;
  }

  /* ============================================================ запорная арматура */
  // Шибер реечный: рама на фланцах, нож (полированная сталь), привод-мотор-редуктор.
  function drawShiber(n) {
    const m = M[n.id] || { pos: 0, spin: 0 }, f = faulty(n.id), x = n.x, y = n.y, w = n.w, h = n.h;
    ctx.beginPath(); ctx.rect(x, y, w, h); K.skin("galv", K.shadeFlat(x, y, w, h), "#1e2a31", 1.6);
    K.bolts(x + 4, y + 4, x + w - 4, y + 4, 3, 1.2); K.bolts(x + 4, y + h - 4, x + w - 4, y + h - 4, 3, 1.2);
    // проём и нож
    cavity(x + 6, y + h / 2 - 5, w - 12, 10);
    const gap = (w - 12) * m.pos;
    ctx.fillStyle = K.pat("brushed"); ctx.fillRect(x + 6 + gap, y + h / 2 - 4, w - 12 - gap + 14, 8);
    ctx.strokeStyle = "#2a343b"; ctx.lineWidth = 0.8; ctx.strokeRect(x + 6 + gap, y + h / 2 - 4, w - 12 - gap + 14, 8);
    // рейка и привод
    ctx.fillStyle = "#3a454c"; ctx.fillRect(x + w, y + h / 2 - 2, 14, 4);
    const moving = m.spin > 0, c = f ? COL.bad : moving ? COL.warn : m.pos > 0.98 ? COL.ok : "#9aa6b0";
    K.rr(x + w + 12, y + h / 2 - 8, 16, 16, 3); K.skin("paint", null, "#142a46", 1);
    ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x + w + 20, y + h / 2, 4, 0, TAU); ctx.fill();
    ctx.strokeStyle = "#1b252c"; ctx.lineWidth = 1; ctx.stroke();
  }
  // Пневмозатвор весов: створка + пневмоцилиндр, шток выдвигается по положению.
  function drawGate(n) {
    const m = M[n.id] || { pos: 0, spin: 0 }, x = n.x, y = n.y, w = n.w, h = n.h, f = faulty(n.id);
    ctx.beginPath(); ctx.rect(x, y, w, h); K.skin("galv", K.shadeFlat(x, y, w, h), "#1e2a31", 1.4);
    cavity(x + 5, y + 3, w - 10, h - 6);
    ctx.save(); ctx.translate(x + 6, y + h / 2); ctx.rotate(m.pos * 1.1); ctx.fillStyle = K.pat("brushed"); ctx.fillRect(0, -2.5, w - 12, 5); ctx.restore();
    const cx0 = x + w + 4, cl = 30;
    K.rr(cx0, y + h / 2 - 5, cl, 10, 3); K.skin("brushed", K.shadeCyl(0, y + h / 2 - 5, 0, y + h / 2 + 5), "#2a343b", 1);
    ctx.fillStyle = "#c3ccd2"; ctx.fillRect(cx0 - 10 * m.pos - 2, y + h / 2 - 1.5, 10 * m.pos + 4, 3);
    ctx.fillStyle = f ? COL.bad : m.pos > 0.95 ? COL.ok : m.spin ? COL.warn : "#9aa6b0"; ctx.beginPath(); ctx.arc(cx0 + cl + 7, y + h / 2, 4.5, 0, TAU); ctx.fill(); ctx.strokeStyle = "#1b252c"; ctx.lineWidth = 1; ctx.stroke();
  }

  /* ============================================================ весы */
  function drawScale(n) {
    const c = CT[n.level], x = n.x, y = n.y, w = n.w, h = n.h;
    // несущая рама
    ctx.fillStyle = "#4f5c65"; ctx.fillRect(x - 10, y + h + 8, w + 20, 7);
    // тензодатчики (балки S-типа) на кронштейнах
    [x + 24, x + w / 2 - 6, x + w - 36].forEach((X) => { ctx.fillStyle = "#3a454c"; ctx.fillRect(X - 6, y + h - 2, 24, 4); K.rr(X, y + h + 1, 12, 8, 2); K.skin("brushed", null, "#2a343b", 1); });
    // бункер весов в разрезе
    ctx.save(); K.rr(x, y, w, h, 6); ctx.clip(); cavity(x, y, w, h);
    if (c && c.mass > 0.05) { const fr = Math.min(1, c.mass / c.cap); bulk(x, w, y + h - (h - 10) * fr, y + h, c.kind, Math.min(14, h * fr * 0.4)); }
    ctx.restore();
    K.rr(x, y, w, h, 6); ctx.lineWidth = 3; ctx.strokeStyle = "#26323a"; ctx.stroke();
    ctx.fillStyle = K.pat("galv"); ctx.fillRect(x, y, w, 7); ctx.fillRect(x, y + h - 6, w, 6); K.bolts(x + 6, y + 3.5, x + w - 6, y + 3.5, Math.round(w / 40), 1.2);
    // индикатор весового терминала
    const val = n.id === "scale1" ? V.Ves1 : V.Ves2;
    K.rr(x + w / 2 - 76, y + h / 2 - 20, 152, 40, 5); K.skin("paint", null, "#142a46", 1.4);
    ctx.fillStyle = "#0b1114"; ctx.fillRect(x + w / 2 - 68, y + h / 2 - 14, 136, 28);
    ctx.font = "700 22px 'Courier New', monospace"; ctx.fillStyle = "#ff5040"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText((+val || 0).toFixed(n.id === "scale1" ? 1 : 2) + " кг", x + w / 2, y + h / 2 + 1); ctx.textBaseline = "alphabetic";
    label(n.label, x + 14, y + h / 2 + 6, { align: "left", size: 15, color: "#fff", halo: false, fixed: true, base: "middle" });
  }

  /* ============================================================ перекидной клапан */
  function drawDiverter(n) {
    const m = M[n.id] || { pos: 0 }, x = n.x, y = n.y, w = n.w, h = n.h, f = faulty(n.id), t = T();
    const body = [[x + w * 0.3, y], [x + w * 0.7, y], [x + w, y + h], [x + w * 0.62, y + h], [x + w / 2, y + h * 0.62], [x + w * 0.38, y + h], [x, y + h]];
    K.path(body, true); K.skin("galv", K.shadeFlat(x, y, w, h), f ? COL.bad : "#26323a", f ? 4 : 1.8);
    // окно: заслонка внутри
    ctx.save(); K.path([[x + w * 0.34, y + 6], [x + w * 0.66, y + 6], [x + w * 0.8, y + h * 0.6], [x + w * 0.2, y + h * 0.6]], true); ctx.clip();
    cavity(x, y, w, h);
    const a = -0.55 + m.pos * 1.1;
    ctx.save(); ctx.translate(x + w / 2, y + 8); ctx.rotate(a); ctx.fillStyle = K.pat("brushed"); ctx.fillRect(-2.5, 0, 5, h * 0.55); ctx.restore();
    ctx.restore();
    ctx.beginPath(); ctx.arc(x + w / 2, y + 8, 3.5, 0, TAU); ctx.fillStyle = "#2a343b"; ctx.fill();
    ctx.fillStyle = "#7d8a93"; ctx.fillRect(x + w * 0.28, y - 3, w * 0.44, 5);
    K.gearMotor(x + w + 6, y + 18, 0.38, { dir: 1, run: M[n.id] ? M[n.id].spin : 0, t });
    led(x + w + 14, y + 42, n.id, 5);
  }

  /* ============================================================ скальператор (барабанный) */
  function drawScalp(n) {
    const m = M[n.id], x = n.x, y = n.y, w = n.w, h = n.h, t = T(), run = m ? m.spin : 0;
    const [jx, jy] = jit(n.id, 0.5);
    const bh = h * 0.72;
    // стойки
    [x + 18, x + w - 30].forEach((X) => { ctx.fillStyle = "#4f5c65"; ctx.fillRect(X, y + bh, 12, h - bh); ctx.fillRect(X - 6, y + h - 4, 24, 5); });
    ctx.save(); ctx.translate(jx, jy);
    ctx.beginPath(); K.rr(x, y, w, bh, 8); K.skin("galv", K.shadeFlat(x, y, w, bh), "#26323a", 2);
    // разрез: перфорированный барабан вращается (рисунок перфорации бежит по образующей)
    const cy = y + bh * 0.5, r = bh * 0.34, dx0 = x + 22, dw = w - 44;
    ctx.save(); ctx.beginPath(); ctx.rect(dx0 - 6, cy - r - 8, dw + 12, 2 * r + 16); ctx.clip(); cavity(dx0 - 6, cy - r - 8, dw + 12, 2 * r + 16);
    m._ph = (m._ph || 0) + run * 0.6;
    ctx.save(); ctx.beginPath(); ctx.rect(dx0, cy - r, dw, 2 * r); ctx.clip();
    ctx.translate(0, (m._ph * 2) % 12); ctx.fillStyle = K.pat("perf"); ctx.fillRect(dx0, cy - r - 12, dw, 2 * r + 24); ctx.restore();
    ctx.fillStyle = K.shadeCyl(0, cy - r, 0, cy + r); ctx.fillRect(dx0, cy - r, dw, 2 * r);
    // зерно внутри барабана у нижней образующей, сход отходов в конце
    const q = Math.min(1, elMass("Scalp") / 20);
    if (q > 0.02) { ctx.globalAlpha = 0.9; bulk(dx0 + 4, dw * (0.4 + 0.6 * q), cy + r * (0.55 - 0.5 * q), cy + r, "grain", 4); ctx.globalAlpha = 1; }
    if (run > 0.2 && q > 0.02) { ctx.fillStyle = kc("grain", 1); for (let k = 0; k < 14; k++) { const X = dx0 + ((k * 37 + t * 60) % dw), Y = cy + r + 2 + ((t * 120 + k * 13) % 10); ctx.fillRect(X, Y, 2, 3); } }
    // кольца жёсткости барабана
    ctx.strokeStyle = "#cfd8de"; ctx.lineWidth = 3; [dx0 + 2, dx0 + dw / 2, dx0 + dw - 2].forEach((X) => { ctx.beginPath(); ctx.moveTo(X, cy - r); ctx.lineTo(X, cy + r); ctx.stroke(); });
    ctx.restore(); cutFrame(dx0 - 6, cy - r - 8, dw + 12, 2 * r + 16, 2);
    // лючки и стяжки
    [x + 10, x + w - 14].forEach((X) => { ctx.fillStyle = "#3a454c"; ctx.fillRect(X, y + 10, 4, bh - 20); });
    ctx.restore();
    // мотор-редуктор барабана
    K.gearMotor(x + w + 6, cy + jy, 0.62, { dir: 1, run, t });
    K.rr(x + 30, y + bh - 2, 40, 12, 2); K.skin("galv", null, "#26323a", 1);   // выпуск отходов
    led(x + w - 20, y + h * 0.62, n.id, 6);
    if (faulty(n.id)) faultFrame(x, y, w, h);
  }

  /* ============================================================ дробилка молотковая */
  // Вид с торца вала: корпус-«улитка» с крышкой, в окне — ротор с шарнирно
  // подвешенными молотками и сито по дуге. Двигатель рядом на общей раме,
  // клиноремённая передача под ограждением. При работе корпус «стучит».
  function drawCrusher(n) {
    const m = M[n.id], c = CT[n.id], x = n.x, y = n.y, w = n.w, h = n.h, t = T(), run = m ? m.spin : 0;
    const hx = n.hx, cur = n.id === "Drob1" ? V.TokDrob1 : V.TokDrob2, max = n.id === "Drob1" ? V.TokMax1 : V.TokMax2;
    const load = Math.min(1.3, (+cur || 0) / ((+max || 100) * 0.8));
    const ay = y + 150, R = 70, mx = n.motor === "left" ? x + 44 : x + w - 44, my = y + 222, mr = 38;
    const [sx, sy] = jit(n.id, 0.9 + 0.8 * load, 90);
    // рама и фундамент
    ctx.fillStyle = K.pat("concrete"); ctx.fillRect(x - 6, y + h - 28, w + 12, 18); ctx.strokeStyle = "#5b5f60"; ctx.lineWidth = 1; ctx.strokeRect(x - 6, y + h - 28, w + 12, 18);
    ctx.fillStyle = "#3e4a52"; ctx.fillRect(x, y + h - 42, w, 14); ctx.fillStyle = "rgba(255,255,255,.15)"; ctx.fillRect(x, y + h - 42, w, 3);
    // ремённая передача под ограждением (за корпусом)
    ctx.save(); ctx.lineCap = "round"; K.path([[mx, my], [hx, ay]]); ctx.strokeStyle = "#1e2428"; ctx.lineWidth = 50; ctx.stroke();
    ctx.strokeStyle = K.pat("grate"); ctx.lineWidth = 46; ctx.stroke(); ctx.strokeStyle = "rgba(40,40,40,.55)"; ctx.lineWidth = 46; ctx.stroke();
    ctx.setLineDash([9, 7]); ctx.lineDashOffset = -t * 300 * run; ctx.strokeStyle = "#111"; ctx.lineWidth = 3;
    [-14, 0, 14].forEach((o) => { const ang = Math.atan2(ay - my, hx - mx), ox = -Math.sin(ang) * o, oy = Math.cos(ang) * o; K.path([[mx + ox, my + oy], [hx + ox, ay + oy]]); ctx.stroke(); });
    ctx.restore();
    // двигатель (вид с торца): станина с рёбрами, кожух вентилятора, клеммная коробка, лапы
    ctx.save(); ctx.translate(sx * 0.4, sy * 0.4);
    ctx.fillStyle = "#24548f"; ctx.fillRect(mx - mr - 4, my + mr - 6, 2 * mr + 8, 10);
    for (let k = 0; k < 28; k++) { const a = k / 28 * TAU; ctx.beginPath(); ctx.moveTo(mx + Math.cos(a) * (mr - 2), my + Math.sin(a) * (mr - 2)); ctx.lineTo(mx + Math.cos(a) * (mr + 5), my + Math.sin(a) * (mr + 5)); ctx.lineWidth = 3.5; ctx.strokeStyle = "#1f4e86"; ctx.stroke(); }
    ctx.beginPath(); ctx.arc(mx, my, mr, 0, TAU); K.skin("paint", K.shadeCyl(mx - mr, my - mr, mx + mr, my + mr), "#142a46", 1.6);
    ctx.beginPath(); ctx.arc(mx, my, mr * 0.72, 0, TAU); ctx.fillStyle = "#0c1622"; ctx.fill();
    ctx.strokeStyle = "rgba(150,175,205,.8)"; ctx.lineWidth = 1.2; for (let k = 1; k < 4; k++) { ctx.beginPath(); ctx.arc(mx, my, mr * 0.72 * k / 4, 0, TAU); ctx.stroke(); }
    const fa = (m ? (m._fan = (m._fan || 0) + run * 0.9) : 0);
    for (let k = 0; k < 9; k++) { const a = fa + k * TAU / 9; ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(mx + Math.cos(a) * mr * 0.7, my + Math.sin(a) * mr * 0.7); ctx.strokeStyle = run > 0.5 ? "rgba(160,180,200,.25)" : "rgba(160,180,200,.7)"; ctx.lineWidth = run > 0.5 ? 6 : 2; ctx.stroke(); }
    ctx.beginPath(); ctx.arc(mx, my, 6, 0, TAU); ctx.fillStyle = "#3a454c"; ctx.fill();
    K.rr(mx - 16, my - mr - 18, 32, 18, 2); K.skin("paint", null, "#142a46", 1.2);
    ctx.restore();
    // корпус дробилки
    ctx.save(); ctx.translate(sx, sy);
    const body = () => { ctx.beginPath(); ctx.moveTo(hx - R, y + h - 42); ctx.lineTo(hx - R, ay); ctx.arc(hx, ay, R, Math.PI, 0); ctx.lineTo(hx + R, y + h - 42); ctx.closePath(); };
    body(); K.skin("paint", null, "#1d2a30", 2.2);
    ctx.fillStyle = "rgba(205,214,220,.86)"; body(); ctx.fill();   // светло-серая эмаль поверх синей грунтовки
    ctx.fillStyle = K.shadeCyl(hx - R, 0, hx + R, 0, 0.8); body(); ctx.fill();
    body(); ctx.lineWidth = 2.2; ctx.strokeStyle = "#1d2a30"; ctx.stroke();
    // разъём крышки и петли
    ctx.fillStyle = "#6e7b84"; ctx.fillRect(hx - R - 4, ay - 3, 2 * R + 8, 6); K.bolts(hx - R - 1, ay, hx + R + 1, ay, 7, 1.4);
    [ay - 40, ay + 30].forEach((Y) => { ctx.fillStyle = "#2a343b"; ctx.fillRect(n.motor === "left" ? hx + R - 3 : hx - R - 5, Y, 8, 16); });
    // окно-разрез: сито, ротор, молотки
    const ir = 54;
    ctx.save(); ctx.beginPath(); ctx.arc(hx, ay, ir + 4, 0, TAU); ctx.clip(); cavity(hx - ir - 4, ay - ir - 4, 2 * ir + 8, 2 * ir + 8);
    // сито — перфорированная дуга (нижние 3/4)
    ctx.beginPath(); ctx.arc(hx, ay, ir, Math.PI * 0.85, Math.PI * 2.15); ctx.lineWidth = 6; ctx.strokeStyle = K.pat("perf"); ctx.stroke();
    ctx.beginPath(); ctx.arc(hx, ay, ir - 3, Math.PI * 0.85, Math.PI * 2.15); ctx.lineWidth = 1; ctx.strokeStyle = "#cfd8de"; ctx.stroke();
    // дека-отражатель сверху
    ctx.beginPath(); ctx.arc(hx, ay, ir, Math.PI * 1.25, Math.PI * 1.75); ctx.lineWidth = 6; ctx.strokeStyle = "#7d8a93"; ctx.stroke();
    // продукт: кольцевой слой у сита, мука проходит через сито вниз
    const fill = c ? Math.min(1, c.mass / 6) : 0;
    if (fill > 0.02 && run > 0.1) {
      ctx.save(); ctx.globalAlpha = 0.85;
      ctx.beginPath(); ctx.arc(hx, ay, ir - 4, 0, TAU); ctx.arc(hx, ay, ir - 4 - 10 * fill, 0, TAU, true); ctx.fillStyle = prodPat("meal"); ctx.fill();
      ctx.restore();
      ctx.fillStyle = kc("grain", 0); for (let k = 0; k < 12; k++) { const a = -t * 14 * run + k * 0.52; ctx.fillRect(hx + Math.cos(a) * (ir - 14 - (k % 3) * 6), ay + Math.sin(a) * (ir - 14 - (k % 3) * 6), 3, 2); }
    } else if (fill > 0.02) bulk(hx - ir, 2 * ir, ay + ir - 26 * fill, ay + ir, "grain", 6);
    // ротор: диски, оси подвеса, молотки (при работе — радиально, стоя — висят)
    if (m) m._ph = (m._ph || 0) + run * 0.75;
    const rot = m ? m._ph : 0, rr0 = 18;
    ctx.beginPath(); ctx.arc(hx, ay, rr0 + 2, 0, TAU); ctx.fillStyle = K.pat("brushed"); ctx.fill(); ctx.lineWidth = 1.2; ctx.strokeStyle = "#1c252b"; ctx.stroke();
    for (let k = 0; k < 4; k++) {
      const a = rot + k * TAU / 4, px = hx + Math.cos(a) * rr0, py = ay + Math.sin(a) * rr0;
      const ha = run > 0.25 ? a : Math.PI / 2 + Math.sin(a) * 0.15;   // ориентация молотка
      ctx.save(); ctx.translate(px, py); ctx.rotate(ha);
      ctx.fillStyle = "#c6ced3"; ctx.fillRect(-1, -4.5, 30, 9); ctx.fillStyle = "#6c7880"; ctx.fillRect(22, -4.5, 8, 9);   // наплавка кромки
      ctx.strokeStyle = "#20292f"; ctx.lineWidth = 0.8; ctx.strokeRect(-1, -4.5, 30, 9);
      ctx.restore();
      ctx.beginPath(); ctx.arc(px, py, 3, 0, TAU); ctx.fillStyle = "#2a343b"; ctx.fill();
    }
    if (run > 0.5) { ctx.beginPath(); ctx.arc(hx, ay, rr0 + 26, 0, TAU); ctx.strokeStyle = "rgba(220,230,236,.18)"; ctx.lineWidth = 12; ctx.stroke(); }
    ctx.beginPath(); ctx.arc(hx, ay, 6, 0, TAU); ctx.fillStyle = "#2a343b"; ctx.fill();
    ctx.restore();
    ctx.beginPath(); ctx.arc(hx, ay, ir + 4, 0, TAU); ctx.lineWidth = 4; ctx.strokeStyle = "#5d6a73"; ctx.stroke(); ctx.lineWidth = 1; ctx.strokeStyle = "#1c252b"; ctx.stroke();
    // загрузочная горловина с магнитной вставкой сверху
    K.path([[hx - 22, y + 12], [hx + 22, y + 12], [hx + 26, ay - R + 14], [hx - 26, ay - R + 14]], true); K.skin("galv", K.shadeFlat(hx - 26, y + 12, 52, 70), "#26323a", 1.6);
    ctx.fillStyle = "#7d8a93"; ctx.fillRect(hx - 27, y + 9, 54, 6); K.bolts(hx - 24, y + 12, hx + 24, y + 12, 4, 1.2);
    // табличка
    ctx.fillStyle = "#e6e9eb"; ctx.fillRect(hx - 22, ay + R * 0.6 + 2, 44, 16); ctx.strokeStyle = "#5b6670"; ctx.lineWidth = 0.6; ctx.strokeRect(hx - 22, ay + R * 0.6 + 2, 44, 16);
    ctx.font = "800 9px Raleway"; ctx.fillStyle = "#1f2a33"; ctx.textAlign = "center"; ctx.fillText("ДМ-" + n.poz.slice(-2), hx, ay + R * 0.6 + 13);
    ctx.restore();
    // разгрузочный бункер под ситом
    K.path([[hx - R, y + h - 42], [hx + R, y + h - 42], [hx + 22, y + h - 6], [hx - 22, y + h - 6]], true); K.skin("galv", K.shadeFlat(hx - R, y + h - 42, 2 * R, 36), "#26323a", 1.8);
    if (c && c.mass > 0.2 && run > 0.2) { ctx.fillStyle = kc("meal", 1); for (let k = 0; k < 10; k++) { const Y = y + h - 40 + ((t * 90 + k * 7) % 34); ctx.fillRect(hx - 14 + (k * 7) % 28, Y, 2, 3); } }
    ctx.fillStyle = "#7d8a93"; ctx.fillRect(hx - 26, y + h - 8, 52, 6);
    // ток двигателя
    badge((cur || 0) + " А", n.motor === "left" ? mx : mx, my + mr + 28, { size: 17, color: (cur || 0) > max ? "#ff6a5a" : "#5cf08a", edge: (cur || 0) > max ? "#ff6a5a" : "#47e07a" });
    led(hx + (n.motor === "left" ? R - 14 : -R + 14), y + h - 54, n.id, 7);
    if (faulty(n.id)) faultFrame(x, y, w, h);
  }

  /* ============================================================ смеситель */
  // Горизонтальный лопастной смеситель в продольном разрезе: вал с лопастями
  // (передние — над продуктом, задние — за ним), «кипящий» слой при работе,
  // форсунки ввода масла, донные створки на выгрузку.
  function drawMixer(n) {
    const m = M[n.id], x = n.x, y = n.y, w = n.w, h = n.h, c = CT.Sms, t = T(), run = m ? m.spin : 0;
    const [jx] = jit(n.id, 0.4);
    ctx.save(); ctx.translate(jx, 0);
    K.rr(x, y, w, h, 26); K.skin("galv", K.shadeCyl(0, y, 0, y + h), "#26323a", 2.4);
    ctx.fillStyle = "#7d8a93"; [x + 4, x + w - 10].forEach((X) => { ctx.fillRect(X, y - 2, 6, h + 4); }); K.bolts(x + 7, y + 6, x + 7, y + h - 6, 5, 1.3); K.bolts(x + w - 7, y + 6, x + w - 7, y + h - 6, 5, 1.3);
    const ix = x + 22, iw = w - 44, iy = y + 14, ih = h - 28, cy = iy + ih / 2, R = ih * 0.42;
    ctx.save(); K.rr(ix, iy, iw, ih, 18); ctx.clip(); cavity(ix, iy, iw, ih);
    if (m) m._ph = (m._ph || 0) + run * 0.16;
    const ph = m ? m._ph : 0, NP = 8;
    const paddle = (k, front) => {
      const X = ix + 24 + k * (iw - 48) / (NP - 1), a = ph + k * 0.785, s = Math.sin(a), cz = Math.cos(a);
      if ((cz >= 0) !== front) return;
      const ty = cy + s * R, bw = 6 + 12 * Math.abs(cz);
      ctx.strokeStyle = front ? "#aeb9c0" : "#56626a"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(X, cy); ctx.lineTo(X, ty); ctx.stroke();
      ctx.fillStyle = front ? "#c9d3d9" : "#5a666e"; ctx.fillRect(X - bw / 2, ty - 3, bw, 6);
      ctx.strokeStyle = "#20292f"; ctx.lineWidth = 0.6; ctx.strokeRect(X - bw / 2, ty - 3, bw, 6);
    };
    for (let k = 0; k < NP; k++) paddle(k, false);
    const fr = Math.min(1, c.mass / c.cap);
    const kind = S.oilInMix > 0.3 && V.SmsMainState3 ? "mash" : c.kind;
    if (fr > 0.005) {
      const top = iy + ih - ih * Math.min(1, fr * 1.3), amp = run * 7;
      ctx.beginPath(); ctx.moveTo(ix, iy + ih);
      for (let X = ix; X <= ix + iw; X += 6) ctx.lineTo(X, top + Math.sin(X / 17 + ph * 3) * amp + Math.sin(X / 7 - ph * 5) * amp * 0.35);
      ctx.lineTo(ix + iw, iy + ih); ctx.closePath(); ctx.fillStyle = prodPat(kind); ctx.fill();
      const g = ctx.createLinearGradient(0, top, 0, iy + ih); g.addColorStop(0, "rgba(255,240,210,.1)"); g.addColorStop(1, "rgba(30,18,4,.4)"); ctx.fillStyle = g; ctx.fill();
      if (run > 0.3) { ctx.fillStyle = kc(kind, 0); for (let k = 0; k < 26; k++) { const X = ix + (hash(k) * iw + ph * 30 * (k % 2 ? 1 : -1)) % iw, Y = top - ((t * 3 + hash(k + 9)) % 1) * 22; ctx.fillRect(X < ix ? X + iw : X, Y, 2.5, 2.5); } }
      if (S.oilInMix > 0.05) { ctx.fillStyle = "rgba(242,196,55,.25)"; ctx.fillRect(ix, top, iw, iy + ih - top); }
    }
    ctx.fillStyle = K.pat("brushed"); ctx.fillRect(ix, cy - 4, iw, 8); ctx.strokeStyle = "#20292f"; ctx.lineWidth = 0.6; ctx.strokeRect(ix, cy - 4, iw, 8);
    for (let k = 0; k < NP; k++) paddle(k, true);
    // форсунки масла
    const oil = !!V.Go_MasloDos;
    for (let k = 0; k < 4; k++) {
      const X = ix + 60 + k * (iw - 120) / 3;
      ctx.fillStyle = "#3a454c"; ctx.fillRect(X - 3, iy, 6, 8);
      if (oil) { ctx.fillStyle = "rgba(246,196,40,.75)"; for (let d = 0; d < 9; d++) { const s2 = (t * 2.2 + d / 9) % 1; ctx.beginPath(); ctx.arc(X + (d - 4) * 4 * s2, iy + 8 + s2 * 40, 1.6, 0, TAU); ctx.fill(); } }
    }
    ctx.restore();
    cutFrame(ix, iy, iw, ih, 18);
    // коллектор масла над смесителем
    ctx.fillStyle = "#9a8a5a"; ctx.fillRect(ix + 50, y - 6, iw - 100, 6); ctx.strokeStyle = "#5c4a12"; ctx.lineWidth = 1; ctx.strokeRect(ix + 50, y - 6, iw - 100, 6);
    ctx.restore();
    // донные створки
    const dp = (M.ShDownSms && M.ShDownSms.pos) || 0;
    [x + w / 2 - 52, x + w / 2 + 52].forEach((X, i) => { ctx.save(); ctx.translate(X, y + h - 2); ctx.rotate((i ? -1 : 1) * dp * 0.9); ctx.fillStyle = K.pat("galv"); ctx.fillRect(i ? -48 : 0, -3, 48, 6); ctx.strokeStyle = "#26323a"; ctx.lineWidth = 1; ctx.strokeRect(i ? -48 : 0, -3, 48, 6); ctx.restore(); });
    // привод: мотор-редуктор с цепной передачей
    K.rr(x + w - 2, y + h / 2 - 34, 24, 68, 5); K.skin("grate", null, "#26323a", 1.4);
    K.gearMotor(x + w + 34, y + h / 2, 0.95, { dir: 1, run, t });
    led(x + w + 12, y + h - 8, n.id, 7);
    const st = mixStage();
    if (st) badge(st, x + w / 2, y + h + 70, { size: 15, edge: "#4b8fd1", color: "#bfe0ff" });
    if (faulty(n.id)) faultFrame(x, y, w, h);
  }
  function mixStage() { const j = plc.prod.S.mixJob; return j ? `Порция ${j.n}: ${j.stage}` : ""; }

  /* ============================================================ масло: ёмкость, УДЖК, компрессор */
  function drawTank(n) {
    const c = CT[n.level], x = n.x, y = n.y, w = n.w, h = n.h, t = T();
    // ложементы
    [x + w * 0.2, x + w * 0.72].forEach((X) => { ctx.fillStyle = "#3e4a52"; K.path([[X - 6, y + h - 14], [X + 22, y + h - 14], [X + 28, y + h + 12], [X - 12, y + h + 12]], true); ctx.fill(); });
    K.rr(x, y, w, h, h / 2); K.skin("paint", K.shadeCyl(0, y, 0, y + h), "#1f2a30", 2);
    ctx.fillStyle = "rgba(225,230,226,.9)"; K.rr(x, y, w, h, h / 2); ctx.fill(); ctx.fillStyle = K.shadeCyl(0, y, 0, y + h); ctx.fill(); K.rr(x, y, w, h, h / 2); ctx.lineWidth = 2; ctx.strokeStyle = "#1f2a30"; ctx.stroke();
    [x + h / 2, x + w - h / 2].forEach((X) => { ctx.strokeStyle = "rgba(40,50,58,.4)"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(X, y + 3); ctx.lineTo(X, y + h - 3); ctx.stroke(); });
    // люк, дыхательный клапан
    K.rr(x + w * 0.4, y - 8, w * 0.2, 10, 2); K.skin("galv", null, "#26323a", 1); ctx.fillStyle = "#3a454c"; ctx.fillRect(x + w * 0.75, y - 16, 6, 16);
    // смотровое стекло уровня
    const fr = c ? Math.min(1, c.mass / c.cap) : 0, gx = x + w * 0.2, gy = y + 12, gh = h - 24;
    ctx.fillStyle = "#e8f0f4"; ctx.fillRect(gx, gy, 12, gh); ctx.fillStyle = "#d8a316"; ctx.fillRect(gx + 2, gy + gh - gh * fr, 8, gh * fr);
    ctx.fillStyle = "rgba(255,255,255,.6)"; ctx.fillRect(gx + 2, gy + gh - gh * fr, 2, gh * fr);
    ctx.strokeStyle = "#2a343b"; ctx.lineWidth = 1.2; ctx.strokeRect(gx, gy, 12, gh); ctx.fillStyle = "#7d8a93"; ctx.fillRect(gx - 3, gy - 4, 18, 4); ctx.fillRect(gx - 3, gy + gh, 18, 4);
    void t;
    label(n.label, x + w / 2, y - 12, { size: 17 });
    if (c) badge(Math.round(c.mass) + " кг", x + w * 0.62, y + h / 2, { size: 16 });
  }
  function drawOilScale(n) {
    const x = n.x, y = n.y, w = n.w, h = n.h, c = CT.Jir, t = T();
    // ёмкость на тензодатчиках
    ctx.save(); K.rr(x, y, w, h - 22, 10); ctx.clip(); cavity(x, y, w, h - 22);
    const fr = Math.min(1, c.mass / c.cap), top = y + h - 26 - (h - 32) * fr;
    if (fr > 0.01) {
      ctx.beginPath(); ctx.moveTo(x, y + h); ctx.lineTo(x, top);
      for (let X = x; X <= x + w; X += 4) ctx.lineTo(X, top + Math.sin(X / 8 + t * 6) * (V.Go_MasloDop ? 2 : 0.6));
      ctx.lineTo(x + w, y + h); ctx.closePath();
      const g = ctx.createLinearGradient(0, top, 0, y + h); g.addColorStop(0, "#f7d35a"); g.addColorStop(1, "#a77a08"); ctx.fillStyle = g; ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,.35)"; ctx.fillRect(x + 6, top + 2, w * 0.3, 2);
    }
    ctx.restore();
    K.rr(x, y, w, h - 22, 10); ctx.lineWidth = 3; ctx.strokeStyle = "#26323a"; ctx.stroke();
    ctx.fillStyle = K.pat("galv"); ctx.fillRect(x - 3, y - 4, w + 6, 6);
    [x + 10, x + w - 22].forEach((X) => { K.rr(X, y + h - 24, 12, 8, 2); K.skin("brushed", null, "#2a343b", 1); });
    // насос с двигателем
    K.motor(x + w + 6, y + h - 40, 46, 20, { dir: -1, run: V.Go_MasloDos ? 1 : 0, t });
    ctx.beginPath(); ctx.arc(x + w + 2, y + h - 30, 9, 0, TAU); ctx.fillStyle = "#8d2c22"; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = "#3a120e"; ctx.stroke();
    K.rr(x - 12, y + h - 16, w + 24, 26, 3); K.skin("paint", null, "#142a46", 1); ctx.fillStyle = "#0b1114"; ctx.fillRect(x - 6, y + h - 12, w + 12, 18);
    ctx.font = "700 15px 'Courier New', monospace"; ctx.fillStyle = "#ff5040"; ctx.textAlign = "center"; ctx.fillText((+V.Ves4 || 0).toFixed(2), x + w / 2, y + h + 2);
    label("УДЖК", x + w / 2, y - 12, { size: 16 });
    led(x + w - 8, y + 10, "Jir", 5);
  }
  function drawCompressor(n) {
    const x = n.x, y = n.y, w = n.w, h = n.h, bad = !!V.LowPress, t = T(), run = bad ? 0 : 1;
    // ресивер
    K.rr(x, y + 30, w, h - 34, (h - 34) / 2); K.skin("paint", K.shadeCyl(0, y + 30, 0, y + h - 4), "#142a46", 1.6);
    ctx.fillStyle = "rgba(160,35,28,.9)"; K.rr(x, y + 30, w, h - 34, (h - 34) / 2); ctx.fill(); ctx.fillStyle = K.shadeCyl(0, y + 30, 0, y + h - 4); ctx.fill();
    [x + 14, x + w - 22].forEach((X) => { ctx.fillStyle = "#2a343b"; ctx.fillRect(X, y + h - 6, 8, 8); });
    // поршневой блок с оребрёнными цилиндрами и двигатель с ремнём
    const py = y + 2, cx0 = x + 16, j = run ? Math.sin(t * 60) * 0.6 : 0;
    for (let k = 0; k < 2; k++) { const X = cx0 + k * 22; ctx.fillStyle = "#4b5258"; ctx.fillRect(X, py + j, 16, 26); ctx.strokeStyle = "#8a939a"; ctx.lineWidth = 1; for (let yy = py + 3; yy < py + 24; yy += 4) { ctx.beginPath(); ctx.moveTo(X, yy + j); ctx.lineTo(X + 16, yy + j); ctx.stroke(); } }
    K.motor(x + w - 46, y + 6, 44, 20, { dir: -1, run, t });
    K.gauge(x + w / 2, y + 54, 9, bad ? 0.15 : 0.7);
    ctx.fillStyle = bad ? COL.bad : COL.ok; ctx.beginPath(); ctx.arc(x + w - 12, y + h - 16, 6, 0, TAU); ctx.fill();
    label(n.label, x + w / 2, y + h + 22, { size: 15, w: 700 });
  }

  /* ============================================================ приёмка: яма, отходы */
  function drawBox(n) {
    const x = n.x, y = n.y, w = n.w, h = n.h, c = CT.trash;
    ctx.save(); K.path([[x, y], [x + w, y], [x + w - 10, y + h], [x + 10, y + h]], true); ctx.clip(); cavity(x, y, w, h);
    const fr = Math.min(1, c.mass / c.cap); bulk(x, w, y + h - (h - 6) * fr, y + h, "fines", 6); ctx.restore();
    K.path([[x, y], [x + w, y], [x + w - 10, y + h], [x + 10, y + h]], true); ctx.lineWidth = 4; ctx.strokeStyle = "#3f5f86"; ctx.stroke();
    [x + 18, x + w - 18].forEach((X) => { ctx.beginPath(); ctx.arc(X, y + h + 7, 7, 0, TAU); ctx.fillStyle = "#222"; ctx.fill(); });
    label(n.label + " " + Math.round(c.mass) + " кг", x + w / 2, y + h + 30, { size: 15, w: 700 });
  }
  function drawPit(n) {
    const x = n.x, y = n.y, w = n.w, h = n.h, c = CT.pit;
    const out = [[x - 20, y - 6], [x + w + 20, y - 6], [x + w * 0.66 + 16, y + h + 12], [x + w * 0.34 - 16, y + h + 12]];
    K.path(out, true); ctx.fillStyle = K.pat("concrete"); ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = "#4d5253"; ctx.stroke();
    const inner = [[x + 6, y + 4], [x + w - 6, y + 4], [x + w * 0.62 - 2, y + h - 2], [x + w * 0.38 + 2, y + h - 2]];
    ctx.save(); K.path(inner, true); ctx.clip(); cavity(x, y, w, h);
    const fr = Math.min(1, c.mass / c.cap); bulk(x, w, y + h - h * fr, y + h, "grain", Math.min(40, h * fr * 0.5));
    ctx.restore();
    K.path(inner, true); ctx.lineWidth = 2; ctx.strokeStyle = "#26323a"; ctx.stroke();
    // приёмная решётка
    ctx.fillStyle = "#2f383e"; ctx.fillRect(x - 10, y - 9, w + 20, 6);
    for (let X = x - 6; X < x + w + 10; X += 14) { ctx.fillStyle = "#56626a"; ctx.fillRect(X, y - 9, 4, 12); }
    label(n.label, x + w / 2, y + h + 34, { size: 19 });
    badge((c.mass / 1000).toFixed(1) + " т", x + w / 2, y + h * 0.45, { size: 17 });
  }

  /* ============================================================ трактор, магнит */
  function truckX(id) { const t = S.trucks[id]; return t ? t.x * 420 * (ND[id].flip ? 1 : -1) : 0; }
  function drawTruck(n) {
    const t = S.trucks[n.id]; if (!t || t.phase === "away") return;
    const im = IMG[n.flip ? "truck_flip" : "truck"]; const x = n.x + truckX(n.id), y = n.y;
    ctx.save();
    if (n.id === "truck_in" && t.tilt) { ctx.translate(x + n.w * 0.85, y + n.h * 0.8); ctx.rotate(-0.08 * t.tilt); ctx.translate(-(x + n.w * 0.85), -(y + n.h * 0.8)); }
    if (im) ctx.drawImage(im, x, y, n.w, n.w * im.height / im.width);
    const load = Math.max(0, Math.min(1, t.load || 0));
    if (load > 0.01) {
      const bx = n.flip ? x + n.w * 0.02 : x + n.w * 0.40, bw = n.w * 0.58, by = y + n.h * 0.13;
      ctx.fillStyle = prodPat(n.id === "truck_in" ? "grain" : (t.silo === 9 ? "pellet" : "mash"));
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.quadraticCurveTo(bx + bw / 2, by - 28 * load, bx + bw, by); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    if (t.phase !== "away" && n.id !== "truck_in") badge(`${(t.load * 20).toFixed(1)} т`, x + n.w / 2, y + n.h + 14, { size: 14 });
  }
  function drawMagnet(n) { const im = IMG.magnet; if (im) ctx.drawImage(im, n.x, n.y, n.w, n.w * im.height / im.width); }

  /* ============================================================ аспирация: циклон с вентилятором */
  function drawCyclone(n) {
    const x = n.x, y = n.y, w = n.w, h = n.h, cx = x + w / 2, t = T(), m = M[n.id], run = m ? m.spin : 0;
    const cylH = h * 0.4, coneB = h * 0.84, left = n.id === "Asp2";
    // опорные стойки
    [x + 6, x + w - 12].forEach((X) => { ctx.fillStyle = "#4f5c65"; ctx.fillRect(X, y + cylH, 6, h - cylH + 6); });
    // тангенциальный вход
    const ix = left ? x - 24 : x + w - 6;
    K.rr(ix, y + 14, 30, 30, 2); K.skin("galv", K.shadeFlat(ix, y + 14, 30, 30), "#26323a", 1.6);
    // корпус: цилиндр + конус
    const shape = () => K.path([[x, y + 8], [x + w, y + 8], [x + w, y + cylH], [cx + 12, y + coneB], [cx - 12, y + coneB], [x, y + cylH]], true);
    shape(); K.skin("galv", K.shadeCyl(x, 0, x + w, 0), "#26323a", 2);
    ctx.fillStyle = "#7d8a93"; ctx.fillRect(x - 4, y + cylH - 3, w + 8, 6); ctx.fillRect(x - 4, y + 5, w + 8, 6); K.bolts(x, y + 8, x + w, y + 8, 5, 1.2);
    // окно: вихрь с пылью
    ctx.save(); ctx.beginPath(); ctx.rect(x + 16, y + 22, w - 32, cylH - 34); ctx.clip(); cavity(x + 16, y + 22, w - 32, cylH - 34);
    if (run > 0.1) { for (let k = 0; k < 7; k++) { const yy = y + 26 + ((k * 13 + t * 40 * run) % (cylH - 40)), ph = t * 9 * run + k; ctx.beginPath(); ctx.ellipse(cx, yy, (w - 40) / 2, 4, 0, ph % TAU, ph % TAU + 2.2); ctx.strokeStyle = "rgba(210,190,150,.65)"; ctx.lineWidth = 2; ctx.stroke(); } }
    ctx.restore(); cutFrame(x + 16, y + 22, w - 32, cylH - 34);
    // выхлопная труба → вентилятор (улитка) → выброс
    const fx = cx + (left ? -34 : 34), fy = y - 34, fr = 26;
    ctx.fillStyle = K.pat("galv"); ctx.fillRect(cx - 9, y - 18, 18, 26); ctx.strokeStyle = "#26323a"; ctx.lineWidth = 1.2; ctx.strokeRect(cx - 9, y - 18, 18, 26);
    ctx.beginPath(); ctx.arc(fx, fy, fr, 0, TAU); ctx.lineTo(fx + (left ? -fr : fr), fy - fr - 16); ctx.lineTo(fx + (left ? -fr + 18 : fr - 18), fy - fr - 16); ctx.closePath();
    K.skin("paint", K.shadeCyl(fx - fr, fy - fr, fx + fr, fy + fr), "#142a46", 1.6);
    ctx.beginPath(); ctx.arc(fx, fy, fr * 0.55, 0, TAU); ctx.fillStyle = "#0c1622"; ctx.fill();
    const fa = m ? (m._fan = (m._fan || 0) + run * 0.8) : 0;
    for (let k = 0; k < 8; k++) { const a = fa + k * TAU / 8; ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx + Math.cos(a) * fr * 0.5, fy + Math.sin(a) * fr * 0.5); ctx.strokeStyle = run > 0.5 ? "rgba(170,190,210,.3)" : "#7e93ad"; ctx.lineWidth = run > 0.5 ? 5 : 1.6; ctx.stroke(); }
    K.motor(left ? fx - fr - 52 : fx + fr + 2, fy - 12, 50, 24, { dir: left ? 1 : -1, run, t });
    if (run > 0.3) for (let k = 0; k < 3; k++) { const s2 = (t * 0.8 + k / 3) % 1; ctx.beginPath(); ctx.arc(fx + (left ? -fr + 9 : fr - 9), fy - fr - 22 - s2 * 30, 4 + s2 * 8, 0, TAU); ctx.fillStyle = `rgba(235,235,235,${0.4 * (1 - s2)})`; ctx.fill(); }
    // шлюзовой затвор под конусом
    const sy = y + coneB + 2;
    ctx.beginPath(); ctx.arc(cx, sy + 12, 14, 0, TAU); K.skin("galv", null, "#26323a", 1.4);
    const sa = m ? (m._sl = (m._sl || 0) + run * 0.08) : 0; ctx.strokeStyle = "#cfd8de"; ctx.lineWidth = 2;
    for (let k = 0; k < 3; k++) { const a = sa + k * Math.PI / 3; ctx.beginPath(); ctx.moveTo(cx - Math.cos(a) * 11, sy + 12 - Math.sin(a) * 11); ctx.lineTo(cx + Math.cos(a) * 11, sy + 12 + Math.sin(a) * 11); ctx.stroke(); }
    K.gearMotor(cx + 22, sy + 12, 0.32, { dir: 1, run, t });
    led(cx, y + h + 18, n.id, 7);
    if (faulty(n.id)) faultFrame(x, y, w, h);
  }
  function drawVibr(n) {
    const m = M[n.id], run = m ? m.spin : 0, t = T(), j = run > 0.2 ? Math.sin(t * 160) * 1.4 : 0;
    const cx = n.x + n.w / 2 + j, cy = n.y + n.h / 2;
    ctx.fillStyle = "#3a454c"; ctx.fillRect(n.x - 2, n.y + n.h - 4, n.w + 4, 5);
    ctx.beginPath(); ctx.arc(cx, cy, n.w / 2, 0, TAU); K.skin("paint", K.shadeCyl(cx - n.w / 2, cy - n.w / 2, cx + n.w / 2, cy + n.w / 2), "#142a46", 1.2);
    // дебалансы
    const a = run > 0.2 ? t * 50 : 0.6; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, n.w * 0.36, a, a + 2.2); ctx.closePath(); ctx.fillStyle = running(n.id) ? "#e0b21c" : "#8c96a0"; ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, 2.5, 0, TAU); ctx.fillStyle = "#1b252c"; ctx.fill();
  }
  function drawFilter(n) {
    const x = n.x, y = n.y, w = n.w, h = n.h, t = T(), run = running(n.id);
    ctx.beginPath(); ctx.rect(x, y, w, h * 0.72); K.skin("galv", K.shadeFlat(x, y, w, h * 0.72), "#26323a", 1.6);
    K.path([[x, y + h * 0.72], [x + w, y + h * 0.72], [x + w / 2 + 8, y + h], [x + w / 2 - 8, y + h]], true); K.skin("galv", null, "#26323a", 1.4);
    ctx.save(); ctx.beginPath(); ctx.rect(x + 6, y + 14, w - 12, h * 0.72 - 20); ctx.clip(); cavity(x + 6, y + 14, w - 12, h * 0.72 - 20);
    for (let k = 0; k < 4; k++) { const X = x + 10 + k * (w - 20) / 4; ctx.fillStyle = "#e8e2cf"; K.rr(X, y + 16, (w - 20) / 4 - 3, h * 0.72 - 26, 3); ctx.fill(); }
    ctx.restore();
    // импульсные клапаны продувки
    for (let k = 0; k < 3; k++) { ctx.fillStyle = "#3a454c"; ctx.fillRect(x + 10 + k * (w - 20) / 3, y - 6, 8, 8); if (run && Math.floor(t * 1.5) % 3 === k) { ctx.fillStyle = "rgba(255,255,255,.7)"; ctx.beginPath(); ctx.arc(x + 14 + k * (w - 20) / 3, y - 10, 5, 0, TAU); ctx.fill(); } }
    led(x + w / 2, y + 8, n.id, 5);
  }

  /* ============================================================ гранулирование */
  // Кондиционер: цилиндр с лопастным валом, коллектор ввода пара с вентилями,
  // в разрезе — продукт и пар над ним; термометр на выходе.
  function drawConditioner(n) {
    const m = M[n.id], x = n.x, y = n.y, w = n.w, h = n.h, t = T(), run = m ? m.spin : 0;
    const steam = (+V.SteamValve || 0) > 1 && !S.noSteam;
    [x + 30, x + w - 40].forEach((X) => { ctx.fillStyle = "#4f5c65"; ctx.fillRect(X, y + h, 10, 26); });
    K.rr(x, y, w, h, h / 2); K.skin("galv", K.shadeCyl(0, y, 0, y + h), "#26323a", 2);
    ctx.fillStyle = "#7d8a93"; [x + 2, x + w - 8].forEach((X) => ctx.fillRect(X, y + 2, 6, h - 4));
    const ix = x + 22, iw = w - 44, iy = y + 12, ih = h - 24, cy = iy + ih / 2;
    ctx.save(); ctx.beginPath(); ctx.rect(ix, iy, iw, ih); ctx.clip(); cavity(ix, iy, iw, ih);
    const q = Math.min(1, CT.Kond.mass / 8);
    if (m) m._ph = (m._ph || 0) + run * 0.3;
    for (let k = 0; k < 16; k++) { const X = ix + 8 + k * (iw - 16) / 15, a = (m ? m._ph : 0) + k * 0.7, s = Math.sin(a); if (Math.cos(a) < 0) { ctx.fillStyle = "#56626a"; ctx.save(); ctx.translate(X, cy + s * ih * 0.36); ctx.rotate(0.6); ctx.fillRect(-6, -2, 12, 4); ctx.restore(); } }
    if (q > 0.02) { const top = iy + ih - ih * 0.9 * q; ctx.beginPath(); ctx.moveTo(ix, iy + ih); for (let X = ix; X <= ix + iw; X += 6) ctx.lineTo(X, top + Math.sin(X / 9 + t * 8 * run) * 2.5 * run); ctx.lineTo(ix + iw, iy + ih); ctx.closePath(); ctx.fillStyle = prodPat("mash"); ctx.fill(); ctx.fillStyle = `rgba(120,70,20,${0.1 + Math.min(0.3, ((+V.TempKond || 20) - 20) / 200)})`; ctx.fill(); }
    ctx.fillStyle = K.pat("brushed"); ctx.fillRect(ix, cy - 3, iw, 6);
    for (let k = 0; k < 16; k++) { const X = ix + 8 + k * (iw - 16) / 15, a = (m ? m._ph : 0) + k * 0.7, s = Math.sin(a); if (Math.cos(a) >= 0) { ctx.strokeStyle = "#aeb9c0"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(X, cy); ctx.lineTo(X, cy + s * ih * 0.36); ctx.stroke(); ctx.fillStyle = "#cfd8de"; ctx.save(); ctx.translate(X, cy + s * ih * 0.36); ctx.rotate(0.6); ctx.fillRect(-6, -2, 12, 4); ctx.restore(); } }
    if (steam && run > 0.2) { for (let k = 0; k < 10; k++) { const s2 = (t * 0.9 + k / 10) % 1, X = ix + 20 + ((k * 53) % (iw - 40)); ctx.beginPath(); ctx.arc(X + s2 * 20, iy + 4 + s2 * ih * 0.4, 3 + s2 * 7, 0, TAU); ctx.fillStyle = `rgba(255,255,255,${0.45 * (1 - s2)})`; ctx.fill(); } }
    ctx.restore(); cutFrame(ix, iy, iw, ih);
    // паровой коллектор с вентилями-инжекторами
    ctx.fillStyle = "#b4483a"; ctx.fillRect(x + w * 0.35, y - 12, w * 0.6, 7); ctx.strokeStyle = "#5b2a22"; ctx.lineWidth = 1; ctx.strokeRect(x + w * 0.35, y - 12, w * 0.6, 7);
    for (let k = 0; k < 4; k++) { const X = x + w * 0.4 + k * w * 0.14; ctx.fillStyle = "#5b2a22"; ctx.fillRect(X - 2, y - 6, 4, 8); K.valve(X, y - 16, 0.45, steam, false); }
    // термометр на выходе
    ctx.fillStyle = "#e8eef2"; ctx.fillRect(x + w - 30, y + h - 4, 6, 18); ctx.fillStyle = "#d03a2a"; ctx.fillRect(x + w - 29, y + h + 14 - 16 * Math.min(1, (+V.TempKond || 0) / 100), 4, 16 * Math.min(1, (+V.TempKond || 0) / 100));
    K.gearMotor(x - 8, y + h / 2, 0.62, { dir: -1, run, t });
    badge((+V.TempKond || 0).toFixed(0) + " °C", x + w + 34, y + h / 2, { size: 15, color: (+V.TempKond || 0) < V.TempKondMin ? "#ffd166" : "#5cf08a" });
    led(x + 34, y + h + 12, n.id, 6);
  }
  // Пресс-гранулятор: корпус камеры прессования с дверцей-разрезом (кольцевая
  // матрица с фильерами, два прессующих вальца, ножи), главный двигатель
  // с клиноремённой передачей под ограждением, рама на фундаменте.
  function drawPress(n) {
    const m = M[n.id], x = n.x, y = n.y, w = n.w, h = n.h, t = T(), run = m ? m.spin : 0;
    const cur = +V.TokGran || 0, load = Math.min(1.3, cur / ((+V.TokMaxGran || 100) * 0.8));
    const [sx, sy] = jit(n.id, 0.4 + 0.6 * load, 80);
    const hx = A.Gran.in[0], cyD = y + 118, Rd = 74;
    // фундамент и рама
    ctx.fillStyle = K.pat("concrete"); ctx.fillRect(x - 6, y + h - 14, w + 12, 14); ctx.strokeStyle = "#5b5f60"; ctx.lineWidth = 1; ctx.strokeRect(x - 6, y + h - 14, w + 12, 14);
    ctx.fillStyle = "#3e4a52"; ctx.fillRect(x, y + h - 30, w, 16);
    // главный двигатель
    const ml = 150, md = 86, mxs = x + w - ml, mys = y + h - 30 - md;
    K.motor(mxs, mys, ml, md, { dir: -1, run, t });
    // ремённое ограждение между двигателем и камерой
    const p0 = [hx + 60, cyD], p1 = [mxs + 4, mys + md / 2];
    ctx.save(); ctx.lineCap = "round"; K.path([p0, p1]); ctx.strokeStyle = "#1e2428"; ctx.lineWidth = 56; ctx.stroke();
    ctx.strokeStyle = K.pat("grate"); ctx.lineWidth = 52; ctx.stroke(); ctx.strokeStyle = "rgba(40,40,40,.5)"; ctx.stroke();
    ctx.setLineDash([9, 6]); ctx.lineDashOffset = -t * 260 * run; ctx.strokeStyle = "#111"; ctx.lineWidth = 3;
    const ang = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
    [-14, 0, 14].forEach((o) => { const ox = -Math.sin(ang) * o, oy = Math.cos(ang) * o; K.path([[p0[0] + ox, p0[1] + oy], [p1[0] + ox, p1[1] + oy]]); ctx.stroke(); }); ctx.restore();
    // корпус камеры
    ctx.save(); ctx.translate(sx, sy);
    K.rr(hx - 96, y + 22, 192, h - 52, 14); K.skin("paint", null, "#1f2a30", 2);
    ctx.fillStyle = "rgba(214,220,222,.88)"; K.rr(hx - 96, y + 22, 192, h - 52, 14); ctx.fill(); ctx.fillStyle = K.shadeFlat(hx - 96, y + 22, 192, h - 52); ctx.fill();
    K.rr(hx - 96, y + 22, 192, h - 52, 14); ctx.lineWidth = 2; ctx.strokeStyle = "#1f2a30"; ctx.stroke();
    // загрузочный лоток (принудительный питатель) сверху
    K.path([[hx - 18, y + 4], [hx + 18, y + 4], [hx + 26, y + 36], [hx - 26, y + 36]], true); K.skin("brushed", null, "#26323a", 1.4);
    // дверца: окно в камеру
    ctx.save(); ctx.beginPath(); ctx.arc(hx, cyD, Rd + 6, 0, TAU); ctx.clip(); cavity(hx - Rd - 6, cyD - Rd - 6, 2 * Rd + 12, 2 * Rd + 12);
    if (m) m._ph = (m._ph || 0) + run * 0.07;
    const ph = m ? m._ph : 0, flow = (S.granFlow || 0) > 0.05 && run > 0.3;
    // кольцевая матрица с фильерами (вращается)
    ctx.beginPath(); ctx.arc(hx, cyD, Rd, 0, TAU); ctx.arc(hx, cyD, Rd - 14, 0, TAU, true); ctx.fillStyle = K.pat("brushed"); ctx.fill();
    ctx.fillStyle = "#1a2025"; for (let k = 0; k < 48; k++) { const a = ph + k * TAU / 48; ctx.beginPath(); ctx.arc(hx + Math.cos(a) * (Rd - 7), cyD + Math.sin(a) * (Rd - 7), 2.2, 0, TAU); ctx.fill(); }
    // гранулы, выходящие из фильер и срезаемые ножами
    if (flow) { ctx.fillStyle = kc("pellet", 0); for (let k = 0; k < 48; k += 2) { const a = ph + k * TAU / 48, L = 4 + ((k * 7 + t * 40) % 8); ctx.save(); ctx.translate(hx + Math.cos(a) * Rd, cyD + Math.sin(a) * Rd); ctx.rotate(a); ctx.fillRect(0, -2, L, 4); ctx.restore(); } }
    // слой мешанки на внутренней поверхности и прессующие вальцы
    if (flow) { ctx.beginPath(); ctx.arc(hx, cyD, Rd - 14, 0, TAU); ctx.arc(hx, cyD, Rd - 22, 0, TAU, true); ctx.fillStyle = prodPat("mash"); ctx.fill(); }
    [0, Math.PI].forEach((o) => { const rx = hx + Math.cos(o + 0.4) * (Rd - 38), ry = cyD + Math.sin(o + 0.4) * (Rd - 38);
      ctx.beginPath(); ctx.arc(rx, ry, 23, 0, TAU); ctx.fillStyle = "#8d989f"; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = "#1c252b"; ctx.stroke();
      ctx.strokeStyle = "#5a656c"; ctx.lineWidth = 1.5; for (let k = 0; k < 12; k++) { const a = -ph * 3.2 + k * TAU / 12; ctx.beginPath(); ctx.moveTo(rx + Math.cos(a) * 17, ry + Math.sin(a) * 17); ctx.lineTo(rx + Math.cos(a) * 23, ry + Math.sin(a) * 23); ctx.stroke(); }
      ctx.beginPath(); ctx.arc(rx, ry, 6, 0, TAU); ctx.fillStyle = "#2a343b"; ctx.fill(); });
    ctx.beginPath(); ctx.arc(hx, cyD, 9, 0, TAU); ctx.fillStyle = "#2a343b"; ctx.fill();
    // ножи
    ctx.fillStyle = "#d9dfe2"; [[-0.3, 1], [Math.PI + 0.3, 1]].forEach(([a]) => { ctx.save(); ctx.translate(hx + Math.cos(a) * (Rd + 4), cyD + Math.sin(a) * (Rd + 4)); ctx.rotate(a); ctx.fillRect(-2, -10, 4, 20); ctx.restore(); });
    ctx.restore();
    ctx.beginPath(); ctx.arc(hx, cyD, Rd + 6, 0, TAU); ctx.lineWidth = 5; ctx.strokeStyle = "#5d6a73"; ctx.stroke(); ctx.lineWidth = 1; ctx.strokeStyle = "#1c252b"; ctx.stroke();
    K.bolts(hx - Rd - 2, cyD - 40, hx - Rd - 2, cyD + 40, 3, 1.6); ctx.fillStyle = "#2a343b"; ctx.fillRect(hx + Rd + 2, cyD - 8, 10, 16);
    ctx.restore();
    // выгрузка гранул из камеры вниз
    K.path([[hx - 30, y + h - 30], [hx + 30, y + h - 30], [hx + 14, y + h - 4], [hx - 14, y + h - 4]], true); K.skin("galv", null, "#26323a", 1.4);
    if ((S.granFlow || 0) > 0.05) { ctx.fillStyle = kc("pellet", 1); for (let k = 0; k < 8; k++) { const Y = cyD + Rd + ((t * 120 + k * 9) % (y + h - cyD - Rd)); ctx.fillRect(hx - 10 + (k * 5) % 20, Y, 3, 6); } }
    badge(cur + " А", mxs + ml / 2, mys - 16, { size: 16, color: cur > V.TokMaxGran ? "#ff6a5a" : "#5cf08a" });
    if (S.dieJam) badge("МАТРИЦА ЗАБИТА", hx, y + h + 26, { size: 14, color: "#fff", bg: "#b3141a", edge: "#ff8080" });
    led(hx + 80, y + 36, n.id, 7);
    if (faulty(n.id) || V.Err30_8) faultFrame(x, y, w, h);
  }
  function drawSluice(n) {
    const m = M[n.id], x = n.x, y = n.y, w = n.w, h = n.h, t = T(), run = m ? m.spin : 0, cx = x + w / 2, cy = y + h / 2, r = Math.min(w, h) / 2;
    ctx.fillStyle = "#7d8a93"; ctx.fillRect(x - 4, y - 2, w + 8, 5); ctx.fillRect(x - 4, y + h - 3, w + 8, 5);
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); K.skin("galv", K.shadeCyl(cx - r, cy - r, cx + r, cy + r), "#26323a", 1.6);
    ctx.beginPath(); ctx.arc(cx, cy, r - 4, 0, TAU); ctx.fillStyle = "#16202a"; ctx.fill();
    m._ph = (m._ph || 0) + run * 0.12;
    for (let k = 0; k < 6; k++) { const a = m._ph + k * TAU / 6; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * (r - 5), cy + Math.sin(a) * (r - 5)); ctx.strokeStyle = "#cfd8de"; ctx.lineWidth = 2.4; ctx.stroke(); if ((S.granFlow || 0) > 0.05 && Math.sin(a) > 0) { ctx.fillStyle = kc("pellet", 1); ctx.beginPath(); ctx.arc(cx + Math.cos(a + 0.5) * r * 0.55, cy + Math.sin(a + 0.5) * r * 0.55, 3, 0, TAU); ctx.fill(); } }
    K.gearMotor(x + w + 6, cy, 0.34, { dir: 1, run, t });
    led(x - 10, cy, n.id, 5);
  }

  // Охладитель противоточный: в разрезе — слой гранул (цвет по температуре),
  // восходящий воздух, качающаяся решётка выгрузки, бункер-конус.
  function drawCooler(n) {
    const x = n.x, y = n.y, w = n.w, h = n.h, c = CT.Ohl, t = T(), air = running("AspGr");
    const bh = h * 0.78;
    [x + 8, x + w - 16].forEach((X) => { ctx.fillStyle = "#4f5c65"; ctx.fillRect(X, y + bh, 8, h - bh + 8); });
    ctx.beginPath(); ctx.rect(x, y, w, bh); K.skin("galv", K.shadeFlat(x, y, w, bh), "#26323a", 2);
    K.path([[x, y + bh], [x + w, y + bh], [x + w * 0.6, y + h], [x + w * 0.4, y + h]], true); K.skin("galv", K.shadeFlat(x, y + bh, w, h - bh), "#26323a", 1.8);
    ctx.fillStyle = "#7d8a93"; ctx.fillRect(x - 4, y + bh - 3, w + 8, 6); ctx.fillRect(x - 4, y - 2, w + 8, 6); K.bolts(x, y + 1, x + w, y + 1, 6, 1.3);
    const ix = x + 14, iy = y + 14, iw = w - 28, ih = bh - 30;
    ctx.save(); ctx.beginPath(); ctx.rect(ix, iy, iw, ih); ctx.clip(); cavity(ix, iy, iw, ih);
    const fr = Math.min(1, c.mass / 520), tc = Math.max(0, Math.min(1, (c.temp - 20) / 60));
    if (fr > 0.01) {
      const top = iy + ih - 12 - (ih - 12) * fr;
      ctx.beginPath(); ctx.moveTo(ix, iy + ih); ctx.lineTo(ix, top + 10); ctx.quadraticCurveTo(ix + iw / 2, top - 8, ix + iw, top + 10); ctx.lineTo(ix + iw, iy + ih); ctx.closePath();
      ctx.fillStyle = prodPat("pellet"); ctx.fill();
      const g = ctx.createLinearGradient(0, top, 0, iy + ih);
      g.addColorStop(0, `rgba(255,${Math.round(120 - 60 * tc)},40,${0.12 + 0.4 * tc})`); g.addColorStop(1, "rgba(40,60,90,.18)");
      ctx.fillStyle = g; ctx.fill();
    }
    // восходящий воздух через слой
    if (air) { ctx.strokeStyle = "rgba(200,225,255,.55)"; ctx.lineWidth = 1.6; for (let k = 0; k < 7; k++) { const X = ix + 10 + k * (iw - 20) / 6, s2 = (t * 0.7 + k * 0.13) % 1, Y = iy + ih - s2 * ih; ctx.beginPath(); ctx.moveTo(X, Y + 14); ctx.quadraticCurveTo(X + 4, Y + 7, X, Y); ctx.stroke(); } }
    // решётка выгрузки (качающиеся колосники)
    const sh = V.OpenStol ? Math.sin(t * 6) * 5 : 0;
    for (let X = ix + 4; X < ix + iw - 4; X += 12) { ctx.fillStyle = V.OpenStol ? "#8fd6a7" : "#8d989f"; ctx.fillRect(X + sh, iy + ih - 8, 8, 5); }
    ctx.restore(); cutFrame(ix, iy, iw, ih);
    // окно выгрузки в конусе: гранулы сыплются при открытом столе
    if (V.OpenStol && c.mass > 5) { ctx.fillStyle = kc("pellet", 1); for (let k = 0; k < 10; k++) { const Y = y + bh + ((t * 100 + k * 8) % (h - bh)); ctx.fillRect(x + w / 2 - 12 + (k * 5) % 24, Y, 3, 6); } }
    // датчики уровня на стенке
    [["ДВУ", V.DVU_OhlGr, 0.16], ["ДСУ", V.DSU_OhlGr, 0.42], ["ДНУ", V.DNU_OhlGr, 0.7]].forEach(([tt, on, k]) => levelSensor(x + w, y + bh * k, on, tt === "ДВУ"));
    // патрубок аспирации к циклону
    K.rr(x + w - 2, y + 20, 18, 22, 2); K.skin("galv", null, "#26323a", 1.2);
    badge((+V.TempGranOut || 0).toFixed(0) + " °C", x + w / 2, y + 36, { size: 15 });
    led(x + 16, y + h - 10, "Ohl", 6);
  }

  // Вибропросеиватель: короб с наклонной ситовой декой на пружинных опорах,
  // два вибродвигателя по бортам. Гранулы идут по сетке к выпуску, мелочь
  // проваливается в поддон и уходит на возврат.
  function drawSifter(n) {
    const m = M.Pros1, m2 = M.Pros2, x = n.x, y = n.y, w = n.w, h = n.h, t = T();
    const run = Math.max(m.spin, m2.spin), q = Math.min(1, elMass("Pros") / 12);
    const fy = y + h - 34;   // верх опорной рамы
    // рама с опорами на фундаменте
    ctx.fillStyle = K.pat("concrete"); ctx.fillRect(x - 6, y + h - 12, w + 12, 12);
    [x + 14, x + w - 26].forEach((X) => { ctx.fillStyle = "#4f5c65"; ctx.fillRect(X, fy, 12, 22); });
    ctx.fillStyle = "#3e4a52"; ctx.fillRect(x, fy - 4, w, 8);
    // колебания короба: по кругу с малой амплитудой
    const ax = run > 0.2 ? Math.cos(t * 75) * 2.2 * run : 0, ay = run > 0.2 ? Math.sin(t * 75) * 1.6 * run : 0;
    const tilt = 0.05, bx = x + 6, by = y + 16, bw = w - 12, bht = 64;
    // пружины (растягиваются вместе с коробом)
    [bx + 26, bx + bw - 30].forEach((X, i) => K.spring(X, by + bht + (i ? bw * tilt : 0) * 0.9 + ay + 6, fy - 4, 14, run > 0.2));
    ctx.save(); ctx.translate(bx + ax, by + ay); ctx.rotate(tilt);
    // короб
    K.rr(0, 0, bw, bht, 6); K.skin("galv", K.shadeFlat(0, 0, bw, bht), "#26323a", 2.2);
    ctx.fillStyle = "#7d8a93"; ctx.fillRect(-3, -3, bw + 6, 6); K.bolts(4, 0, bw - 4, 0, 8, 1.3);
    // разрез: дека-сито, гранулы над ней, мелочь под ней
    const ix = 12, iy = 12, iw = bw - 24, ih = bht - 24, deck = iy + ih * 0.5;
    ctx.save(); ctx.beginPath(); ctx.rect(ix, iy, iw, ih); ctx.clip(); cavity(ix, iy, iw, ih);
    ctx.fillStyle = K.pat("mesh"); ctx.fillRect(ix, deck, iw, 4);
    ctx.fillStyle = "#cfd8de"; ctx.fillRect(ix, deck + 4, iw, 1.5);
    if (q > 0.02) {
      const layer = 4 + 10 * q, speed = 55 * run;
      ctx.save(); ctx.beginPath(); ctx.rect(ix, deck - layer, iw * (0.35 + 0.65 * q), layer); ctx.clip();
      ctx.translate((t * speed) % 64, 0); ctx.fillStyle = prodPat("pellet"); ctx.fillRect(ix - 64, deck - layer - 4, iw + 128, layer + 4);
      ctx.restore();
      if (run > 0.2) { ctx.fillStyle = kc("fines", 1); for (let k = 0; k < 18; k++) { const X = ix + 10 + ((k * 41) % (iw - 20)), Y = deck + 6 + ((t * 70 + k * 11) % (ih * 0.5 - 8)); ctx.fillRect(X, Y, 2, 2); } }
      ctx.fillStyle = prodPat("fines"); ctx.fillRect(ix, iy + ih - 5, iw, 5);
    }
    ctx.restore(); cutFrame(ix, iy, iw, ih, 2);
    // крышка-кожух загрузки и лоток выпуска
    K.rr(18, -16, 52, 16, 2); K.skin("galv", null, "#26323a", 1.2);
    ctx.restore();
    // вибродвигатели по бортам (вид с торца: корпус + дебалансы)
    [[bx + bw * 0.34, M.Pros1, "Pros1"], [bx + bw * 0.62, M.Pros2, "Pros2"]].forEach(([X, mm, id]) => {
      const Y = by + bht * 0.5 + (X - bx) * tilt + ay, Xc = X + ax, rr2 = 16;
      ctx.beginPath(); ctx.arc(Xc, Y, rr2, 0, TAU); K.skin("paint", K.shadeCyl(Xc - rr2, Y - rr2, Xc + rr2, Y + rr2), "#142a46", 1.4);
      for (let k = 0; k < 16; k++) { const a = k / 16 * TAU; ctx.beginPath(); ctx.moveTo(Xc + Math.cos(a) * (rr2 - 3), Y + Math.sin(a) * (rr2 - 3)); ctx.lineTo(Xc + Math.cos(a) * rr2, Y + Math.sin(a) * rr2); ctx.strokeStyle = "#163a66"; ctx.lineWidth = 1.5; ctx.stroke(); }
      const a = mm.spin > 0.2 ? t * 75 : 0.4; ctx.beginPath(); ctx.moveTo(Xc, Y); ctx.arc(Xc, Y, rr2 * 0.62, a, a + 2.4); ctx.closePath(); ctx.fillStyle = "#e0b21c"; ctx.fill();
      ctx.beginPath(); ctx.arc(Xc, Y, 3, 0, TAU); ctx.fillStyle = "#1b252c"; ctx.fill();
      led(Xc, Y + rr2 + 12, id, 5);
    });
    // гибкие рукава (вибрация не передаётся на трубы): вход, выход гранул, сход мелочи
    const sleeve = (x0, y0, x1, y1, wd) => {
      const L = Math.hypot(x1 - x0, y1 - y0), a = Math.atan2(y1 - y0, x1 - x0);
      ctx.save(); ctx.translate(x0, y0); ctx.rotate(a);
      K.rr(0, -wd / 2, L, wd, 3); ctx.fillStyle = "#e9e4d3"; ctx.fill(); ctx.lineWidth = 1.2; ctx.strokeStyle = "#7d7562"; ctx.stroke();
      ctx.strokeStyle = "rgba(120,110,90,.6)"; ctx.lineWidth = 1; for (let d = 4; d < L; d += 5) { ctx.beginPath(); ctx.moveTo(d, -wd / 2); ctx.lineTo(d, wd / 2); ctx.stroke(); }
      ctx.fillStyle = "#6c7880"; ctx.fillRect(-1, -wd / 2 - 2, 4, wd + 4); ctx.fillRect(L - 3, -wd / 2 - 2, 4, wd + 4);
      ctx.restore();
    };
    const boxY = (X) => by + ay + (X - bx) * tilt;
    sleeve(A.Pros.in[0], A.Pros.in[1], A.Pros.in[0] + ax, boxY(A.Pros.in[0]) - 14, 20);
    sleeve(x + w - 20 + ax, boxY(x + w - 20) + bht - 4, A.Pros.out[0], A.Pros.out[1], 22);
    sleeve(A.Pros.waste[0] + ax, boxY(A.Pros.waste[0]) + bht - 4, A.Pros.waste[0], A.Pros.waste[1], 18);
  }

  // Станция биг-бегов: рама, тельфер на монорельсе, загрузочный рукав, мешок
  // «биг-бег» с петлями (тканый полипропилен), наполнение видно по форме мешка.
  function drawBigbag(n) {
    const x = n.x, y = n.y, w = n.w, h = n.h, lb = S.leb, c = CT.bigbag, t = T();
    // рама из жёлтого швеллера
    ctx.fillStyle = "#d9a91e"; ctx.fillRect(x - 4, y - 4, w + 8, 10); ctx.fillRect(x - 4, y, 10, h); ctx.fillRect(x + w - 6, y, 10, h);
    ctx.strokeStyle = "#6e5408"; ctx.lineWidth = 1; ctx.strokeRect(x - 4, y - 4, w + 8, 10); ctx.strokeRect(x - 4, y, 10, h); ctx.strokeRect(x + w - 6, y, 10, h);
    ctx.fillStyle = "#3a454c"; ctx.fillRect(x - 10, y + h, 22, 6); ctx.fillRect(x + w - 12, y + h, 22, 6);
    const bx = x + 30 + lb.x * (w - 150), by = y + 26 + lb.y * 60, fr = Math.min(1, c.mass / c.cap);
    // тельфер
    K.rr(bx + 26, y + 6, 40, 16, 3); K.skin("paint", null, "#142a46", 1);
    ctx.strokeStyle = "#202a31"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(bx + 45, y + 22); ctx.lineTo(bx + 45, by - 6); ctx.stroke();
    ctx.fillStyle = "#3a454c"; ctx.fillRect(bx + 10, by - 8, 70, 5);
    // мешок: раздувается по мере наполнения
    const bw = 76 + 14 * fr, bh = 96, bxx = bx + 45 - bw / 2;
    ctx.beginPath(); ctx.moveTo(bxx + 6, by); ctx.lineTo(bxx + bw - 6, by);
    ctx.quadraticCurveTo(bxx + bw + 4 * fr, by + bh * 0.5, bxx + bw - 4, by + bh); ctx.lineTo(bxx + 4, by + bh); ctx.quadraticCurveTo(bxx - 4 * fr, by + bh * 0.5, bxx + 6, by); ctx.closePath();
    ctx.fillStyle = "#ece7d6"; ctx.fill();
    ctx.save(); ctx.clip();
    if (fr > 0.01) { ctx.globalAlpha = 0.28; bulk(bxx, bw, by + bh - bh * fr, by + bh, "pellet", 10); ctx.globalAlpha = 1; }
    ctx.strokeStyle = "rgba(150,140,115,.35)"; ctx.lineWidth = 0.6; for (let yy = by; yy < by + bh; yy += 3) { ctx.beginPath(); ctx.moveTo(bxx, yy); ctx.lineTo(bxx + bw, yy); ctx.stroke(); }
    ctx.restore();
    ctx.lineWidth = 1.4; ctx.strokeStyle = "#8d8573"; ctx.stroke();
    ctx.fillStyle = "#2f6db5"; [bxx + 10, bxx + bw - 16].forEach((X) => ctx.fillRect(X, by - 6, 6, bh * 0.5));   // стропы-петли
    // загрузочный рукав
    ctx.fillStyle = "#cfc9b6"; ctx.fillRect(bx + 38, by - 14, 14, 14);
    if (V.Go_Leb && fr < 1) { ctx.fillStyle = kc("pellet", 1); for (let k = 0; k < 6; k++) ctx.fillRect(bx + 42 + (k % 3) * 3, by - 12 + ((t * 80 + k * 5) % 14), 3, 5); }
    led(x + w - 14, y + 18, "Leb", 6);
  }

  // Паровой котёл (жаротрубный, горизонтальный): обечайка в теплоизоляции на
  // ложементах, фронт с газовой горелкой и смотровым глазком, дымовая труба,
  // паровой колпак с главным вентилем, предохранительные клапаны, манометр,
  // водоуказательное стекло, питательный насос. В окне разреза — жаровые
  // трубы, кипящая вода и паровое пространство.
  function drawBoiler(n) {
    const x = n.x, y = n.y, w = n.w, h = n.h, t = T(), fire = !S.noSteam, pos = +V.SteamValve || 0;
    const B = n._st || (n._st = { p: 0, lvl: 0.62 });
    B.p += ((fire ? 0.62 - pos / 900 : 0) - B.p) * 0.01;
    const sx0 = x + 96, sx1 = x + 456, sy0 = y + 74, sy1 = y + 248, sr = (sy1 - sy0) / 2, scy = (sy0 + sy1) / 2;
    // фундамент и ложементы
    ctx.fillStyle = K.pat("concrete"); ctx.fillRect(x + 60, y + h - 18, 440, 18); ctx.strokeStyle = "#5b5f60"; ctx.lineWidth = 1; ctx.strokeRect(x + 60, y + h - 18, 440, 18);
    [sx0 + 50, sx1 - 90].forEach((X) => { K.path([[X - 8, sy1 - 30], [X + 48, sy1 - 30], [X + 58, y + h - 18], [X - 18, y + h - 18]], true); ctx.fillStyle = "#3e4a52"; ctx.fill(); ctx.strokeStyle = "#1f292f"; ctx.stroke(); });
    // дымовая труба (за котлом)
    const cx = sx1 + 22;
    ctx.beginPath(); ctx.rect(cx - 14, y - 190, 28, sy0 - y + 200); K.skin("brushed", K.shadeCyl(cx - 14, 0, cx + 14, 0), "#26323a", 1.6);
    for (let yy = y - 150; yy < sy0; yy += 70) { ctx.fillStyle = "#6e7b84"; ctx.fillRect(cx - 16, yy, 32, 4); }
    K.path([[cx - 24, y - 194], [cx + 24, y - 194], [cx + 14, y - 206], [cx - 14, y - 206]], true); ctx.fillStyle = "#3a454c"; ctx.fill();
    if (fire) for (let k = 0; k < 4; k++) { const s2 = (t * 0.35 + k / 4) % 1; ctx.beginPath(); ctx.arc(cx + s2 * 30, y - 200 - s2 * 70, 8 + s2 * 16, 0, TAU); ctx.fillStyle = `rgba(170,170,175,${0.35 * (1 - s2)})`; ctx.fill(); }
    // задняя дымовая камера
    K.rr(sx1 - 6, sy0 + 14, 40, sy1 - sy0 - 28, 6); K.skin("galv", K.shadeFlat(sx1, sy0, 40, sy1 - sy0), "#26323a", 1.6);
    // обечайка в алюминиевой обшивке
    K.rr(sx0, sy0, sx1 - sx0, sy1 - sy0, sr * 0.5); K.skin("clad", K.shadeCyl(0, sy0, 0, sy1), "#26323a", 2.4);
    for (let X = sx0 + 60; X < sx1 - 20; X += 60) { ctx.fillStyle = "#8a959c"; ctx.fillRect(X, sy0 + 1, 4, sy1 - sy0 - 2); }
    // окно разреза: паровое пространство, вода, жаровые трубы
    const wx = sx0 + 130, ww = 170, wy = sy0 + 22, wh = sy1 - sy0 - 44, wl = wy + wh * (1 - B.lvl);
    ctx.save(); ctx.beginPath(); ctx.rect(wx, wy, ww, wh); ctx.clip();
    ctx.fillStyle = "#cfd6db"; ctx.fillRect(wx, wy, ww, wh);
    const gW = ctx.createLinearGradient(0, wl, 0, wy + wh); gW.addColorStop(0, "#5f9ad6"); gW.addColorStop(1, "#1f4f86");
    ctx.fillStyle = gW; ctx.beginPath(); ctx.moveTo(wx, wy + wh); ctx.lineTo(wx, wl);
    for (let X = wx; X <= wx + ww; X += 6) ctx.lineTo(X, wl + (fire ? Math.sin(X / 9 + t * 7) * 2 : 0)); ctx.lineTo(wx + ww, wy + wh); ctx.closePath(); ctx.fill();
    // жаровые трубы (дымогарные) — горячие при работе горелки
    for (let r = 0; r < 3; r++) for (let k = 0; k < 6; k++) { const X = wx + 16 + k * 28, Y = wl + 20 + r * 24; if (Y > wy + wh - 8) continue; ctx.beginPath(); ctx.arc(X, Y, 8, 0, TAU); ctx.fillStyle = fire ? `rgb(${200 + 40 * Math.sin(t * 5 + k + r)},${90 + 30 * Math.sin(t * 3 + k)},40)` : "#4a3a33"; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = "#2a343b"; ctx.stroke(); }
    // пузырьки кипения
    if (fire) { ctx.fillStyle = "rgba(255,255,255,.75)"; for (let k = 0; k < 24; k++) { const X = wx + 8 + ((k * 29) % (ww - 16)), s2 = (t * (0.6 + hash(k) * 0.6) + hash(k + 3)) % 1, Y = wy + wh - s2 * (wy + wh - wl); ctx.beginPath(); ctx.arc(X + Math.sin(t * 6 + k) * 2, Y, 1.5 + hash(k) * 2, 0, TAU); ctx.fill(); } }
    if (fire && pos > 1) { ctx.fillStyle = "rgba(255,255,255,.45)"; for (let k = 0; k < 6; k++) { const s2 = (t * 0.8 + k / 6) % 1; ctx.beginPath(); ctx.arc(wx + 40 + k * 22, wl - s2 * (wl - wy), 4 + s2 * 6, 0, TAU); ctx.fill(); } }
    ctx.restore(); cutFrame(wx, wy, ww, wh, 2);
    // паровой колпак и главный паровой вентиль
    const st = A.boiler.steam;
    K.rr(st[0] - 26, sy0 - 26, 52, 30, 6); K.skin("clad", K.shadeCyl(st[0] - 26, 0, st[0] + 26, 0), "#26323a", 1.6);
    ctx.fillStyle = "#b4483a"; ctx.fillRect(st[0] - 8, st[1], 16, sy0 - 26 - st[1]); ctx.strokeStyle = "#5b2a22"; ctx.lineWidth = 1; ctx.strokeRect(st[0] - 8, st[1], 16, sy0 - 26 - st[1]);
    K.valve(st[0], sy0 - 46, 1.1, fire && pos > 1, true);
    // предохранительные клапаны со сбросными трубами
    [sx0 + 150, sx0 + 190].forEach((X) => { K.rr(X - 8, sy0 - 30, 16, 30, 3); K.skin("brushed", null, "#26323a", 1.2); ctx.fillStyle = "#b4483a"; ctx.fillRect(X - 3, sy0 - 64, 6, 34); if (B.p > 0.7) { ctx.fillStyle = "rgba(255,255,255,.6)"; ctx.beginPath(); ctx.arc(X, sy0 - 72 - (t * 30) % 20, 6, 0, TAU); ctx.fill(); } });
    // манометр на сифонной трубке
    ctx.strokeStyle = "#7b858c"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(sx0 + 70, sy0); ctx.lineTo(sx0 + 70, sy0 - 20); ctx.arc(sx0 + 76, sy0 - 20, 6, Math.PI, 0); ctx.lineTo(sx0 + 82, sy0 - 26); ctx.stroke();
    K.gauge(sx0 + 82, sy0 - 46, 18, B.p / 1.0);
    ctx.font = "700 11px Raleway"; ctx.fillStyle = "#1f2a33"; ctx.textAlign = "center"; ctx.fillText(`${B.p.toFixed(2)} МПа`, sx0 + 82, sy0 - 70);
    // фронт котла с горелкой и смотровым глазком
    K.rr(sx0 - 18, sy0 + 6, 26, sy1 - sy0 - 12, 4); K.skin("galv", K.shadeFlat(sx0 - 18, sy0, 26, sy1 - sy0), "#26323a", 1.8);
    K.bolts(sx0 - 5, sy0 + 14, sx0 - 5, sy1 - 14, 6, 1.4);
    const bx0 = x + 6, byc = scy + 10;
    K.rr(bx0 + 30, byc - 34, 50, 68, 6); K.skin("paint", K.shadeFlat(bx0 + 30, byc - 34, 50, 68), "#142a46", 1.6);   // корпус горелки
    ctx.fillStyle = "#7d8a93"; ctx.fillRect(bx0 + 78, byc - 14, 14, 28);   // пламенная голова
    K.motor(bx0, byc - 62, 54, 26, { dir: 1, run: fire ? 1 : 0, t });   // вентилятор горелки
    ctx.fillStyle = "#3a454c"; ctx.fillRect(bx0 + 40, byc + 34, 6, 40); ctx.fillStyle = "#e3b51e"; ctx.fillRect(bx0 + 36, byc + 50, 14, 8);   // газовая рампа
    // глазок — пламя
    ctx.beginPath(); ctx.arc(sx0 - 5, scy - 40, 9, 0, TAU); ctx.fillStyle = "#1b1b1b"; ctx.fill();
    if (fire) { const fl = 0.7 + 0.3 * Math.sin(t * 23) * Math.sin(t * 7); ctx.beginPath(); ctx.arc(sx0 - 5, scy - 40, 7, 0, TAU); const gf = ctx.createRadialGradient(sx0 - 5, scy - 40, 1, sx0 - 5, scy - 40, 7); gf.addColorStop(0, "#fff6c2"); gf.addColorStop(0.5, `rgba(255,${Math.round(150 * fl)},30,1)`); gf.addColorStop(1, "#b03010"); ctx.fillStyle = gf; ctx.fill(); }
    ctx.beginPath(); ctx.arc(sx0 - 5, scy - 40, 9, 0, TAU); ctx.lineWidth = 2; ctx.strokeStyle = "#7d8a93"; ctx.stroke();
    // водоуказательное стекло
    const gx = sx0 + 34, gy0 = sy0 + 30, gh = 90;
    ctx.fillStyle = "#e8f0f4"; ctx.fillRect(gx, gy0, 9, gh); ctx.fillStyle = "#4f86c6"; ctx.fillRect(gx + 1.5, gy0 + gh * (1 - B.lvl), 6, gh * B.lvl);
    ctx.strokeStyle = "#2a343b"; ctx.lineWidth = 1.2; ctx.strokeRect(gx, gy0, 9, gh); ctx.fillStyle = "#7d8a93"; ctx.fillRect(gx - 4, gy0 - 6, 17, 6); ctx.fillRect(gx - 4, gy0 + gh, 17, 6);
    // питательный насос и линии воды / конденсата
    K.motor(x + 20, y + h - 60, 60, 26, { dir: 1, run: fire ? 1 : 0, t });
    ctx.beginPath(); ctx.arc(x + 92, y + h - 47, 13, 0, TAU); ctx.fillStyle = "#2f5d95"; ctx.fill(); ctx.lineWidth = 1.2; ctx.strokeStyle = "#13253b"; ctx.stroke();
    const wIn = [[x - 40, y + h - 20], [x + 92, y + h - 20], [x + 92, y + h - 34]];
    K.pipe(wIn, 8, { kind: "water" });
    K.pipe([[x + 92, y + h - 60], [x + 92, sy1 - 20], [sx0, sy1 - 20]], 8, { kind: "water" });
    if (fire) { K.pipeFlow(wIn, 8, "rgba(210,232,255,.9)", 40, t); K.pipeFlow([[x + 92, y + h - 60], [x + 92, sy1 - 20], [sx0, sy1 - 20]], 8, "rgba(210,232,255,.9)", 40, t); }
    K.pipe([[x - 40, y + 40], [x + 60, y + 40], [x + 60, sy0 + 30], [sx0 - 18, sy0 + 30]], 8, { kind: "water" });
    label("Вода", x - 44, y + h - 14, { size: 14, align: "right", w: 700 });
    label("Конденсат", x - 44, y + 46, { size: 14, align: "right", w: 700 });
    // табличка и подпись
    ctx.fillStyle = "#e6e9eb"; ctx.fillRect(sx0 + 330, scy + 30, 90, 30); ctx.strokeStyle = "#5b6670"; ctx.lineWidth = 0.8; ctx.strokeRect(sx0 + 330, scy + 30, 90, 30);
    ctx.font = "800 10px Raleway"; ctx.fillStyle = "#1f2a33"; ctx.textAlign = "center"; ctx.fillText("ПАРОВОЙ КОТЁЛ", sx0 + 375, scy + 43); ctx.fillText("0,8 МПа · 1 т/ч", sx0 + 375, scy + 55);
    label(n.label, x + w / 2, y + h + 30, { size: 17 });
    if (S.noSteam) badge("НЕТ ПАРА", sx0 + 210, sy0 - 40, { size: 15, color: "#fff", bg: "#b3141a", edge: "#ff8080" });
    else badge(fire ? "Горелка: работа" : "Горелка: стоп", sx0 + 210, sy0 - 40, { size: 13, edge: "#47e07a" });
  }

  // Шкафы управления (RAL 7035): двери с замками, решётки вентиляции,
  // лампы и кнопки на фасаде, «грибок» аварийного останова.
  function drawCabinet(n) {
    const x = n.x, y = n.y, w = n.w, h = n.h, k = 3, cw = w / k, t = T();
    ctx.fillStyle = "#4b5358"; ctx.fillRect(x - 6, y + h, w + 12, 12);
    for (let i = 0; i < k; i++) {
      const cx = x + i * cw;
      K.rr(cx + 4, y, cw - 8, h, 4); ctx.fillStyle = "#d6d8d3"; ctx.fill(); ctx.fillStyle = K.shadeFlat(cx, y, cw, h); ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = "#7b8691"; ctx.stroke();
      ctx.strokeStyle = "rgba(0,0,0,.18)"; ctx.lineWidth = 1; ctx.strokeRect(cx + 12, y + 8, cw - 24, h - 16);
      ctx.fillStyle = "#2f3438"; ctx.fillRect(cx + cw - 22, y + h / 2 - 20, 6, 40);   // ручка-замок
      for (let yy = y + h - 50; yy < y + h - 18; yy += 6) { ctx.fillStyle = "#9aa1a5"; ctx.fillRect(cx + 20, yy, cw - 60, 3); }   // жалюзи
      ctx.fillStyle = "#f2d11c"; K.path([[cx + 22, y + 18], [cx + 40, y + 18], [cx + 31, y + 34]], true); ctx.fill();   // знак «⚡»
      ctx.fillStyle = "#222"; ctx.font = "900 12px Raleway"; ctx.textAlign = "center"; ctx.fillText("!", cx + 31, y + 31);
    }
    const lamps = [["Авария", V.RunLamp, COL.bad], ["Сирена", V.RunSirena, COL.warn], ["ПУСК", !V.EmerPuskBtn, COL.ok]];
    lamps.forEach(([tt, on, c], i) => {
      const X = x + 36, Y = y + 70 + i * 52, bl = on && tt !== "ПУСК" ? Math.floor(t * 2.5) % 2 : 1;
      ctx.beginPath(); ctx.arc(X, Y, 16, 0, TAU); ctx.fillStyle = "#3a4046"; ctx.fill();
      ctx.beginPath(); ctx.arc(X, Y, 12, 0, TAU); ctx.fillStyle = on && bl ? c : "#6a7278"; ctx.fill();
      if (on && bl) { ctx.beginPath(); ctx.arc(X, Y, 20, 0, TAU); ctx.fillStyle = c + "44"; ctx.fill(); }
      ctx.beginPath(); ctx.arc(X - 4, Y - 4, 3.5, 0, TAU); ctx.fillStyle = "rgba(255,255,255,.55)"; ctx.fill();
      label(tt, X + 26, Y + 8, { size: 22, w: 800, align: "left", fixed: true });
    });
    const ex = x + w - 54, ey = y + 96;
    ctx.beginPath(); ctx.arc(ex, ey, 38, 0, TAU); ctx.fillStyle = "#f2c51c"; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = "#7a5f08"; ctx.stroke();
    ctx.beginPath(); ctx.arc(ex, ey + 3, 27, 0, TAU); ctx.fillStyle = "rgba(0,0,0,.3)"; ctx.fill();
    ctx.beginPath(); ctx.arc(ex, ey, 27, 0, TAU); const ge = ctx.createRadialGradient(ex - 8, ey - 8, 3, ex, ey, 27); ge.addColorStop(0, V.EmerStopShkaf ? "#ff8070" : "#f2564a"); ge.addColorStop(1, "#9a120c"); ctx.fillStyle = ge; ctx.fill();
    label(n.label, x + w / 2, y - 14, { size: 18 });
  }

  const DRAW = {
    noria: drawNoria, screw: drawScrew, scraper: drawScraper, bunker: drawBunker, shiber: drawShiber, gate: drawGate,
    scale: drawScale, diverter: drawDiverter, scalp: drawScalp, crusher: drawCrusher, mixer: drawMixer, tank: drawTank,
    oilscale: drawOilScale, compressor: drawCompressor, box: drawBox, pit: drawPit, truck: drawTruck, magnet: drawMagnet,
    cyclone: drawCyclone, vibr: drawVibr, filter: drawFilter, conditioner: drawConditioner, press: drawPress,
    sluice: drawSluice, cooler: drawCooler, sifter: drawSifter, bigbag: drawBigbag, boiler: drawBoiler, cabinet: drawCabinet,
  };

  /* ============================================================ подписи */
  const SHORT = {
    TrHole: "ТС 10110", NorHole: "НОРИЯ 10200", DVPT: "ДВПТ 10210", Scalp: "СКАЛЬПЕРАТОР 10300", Nor1: "НОРИЯ 10400",
    Tr1: "ШНЕК 10500 (реверс)", Tr1L: "ТЦ 10600", Tr1R: "ТЦ 10700", TrKomp: "ШНЕК 20110", Nor2: "НОРИЯ 20200", TrPBD: "ШНЕК 20300",
    Pit1: "", Pit2: "", Drob1: "ДРОБ. 30410", Drob2: "ДРОБ. 30420", TrDrob: "ШНЕК 30500", Nor3: "НОРИЯ 30600",
    TrDob: "ШНЕК 21110", Sms: "СМЕСИТЕЛЬ 30700", TrSms: "ШНЕК 30800", Nor4: "НОРИЯ 50100", TrGP: "ШНЕК 50200",
    Tr50300: "ШНЕК 50300", Tr50400: "ШНЕК 50400", Tr40100: "ШНЕК 40100", Nor5: "НОРИЯ 40200", Tr40300: "ШНЕК 40300",
    PitGr: "ПИТАТЕЛЬ 40501", KondGr: "КОНДИЦИОНЕР 40502", Gran: "ГРАНУЛЯТОР 40500", Ohl: "ОХЛАДИТЕЛЬ 40600", Tr40700: "ТЦ 40700",
    Nor6: "НОРИЯ 40900", PP1: "ПП 40910", Pros: "ПРОСЕИВАТЕЛЬ 40950", PP2: "ПП 40960", Tr51100: "ТЦ 51100", PP3: "ПП 51110",
    Tr51200: "ТЦ 51200", Nor7: "НОРИЯ 50100г", Tr40800: "ШНЕК 40800 (возврат)", Asp1: "АС-1", Asp2: "АС-2", AspGr: "ЦИКЛОН 60100",
    scale1: "", scale2: "", Leb: "БИГ-БЕГ 51300", mag1: "", mag2: "",
  };
  function drawLabels() {
    if (!VOPT.labels) return;
    for (const [id, t] of Object.entries(SHORT)) {
      const n = ND[id]; if (!n || !t) continue;
      let x = n.x + n.w / 2, y = n.y - 12, align = "center";
      if (n.kind === "noria") { y = n.y - 14; }
      if (n.kind === "screw") { y = n.cy + (n.small ? 30 : 40); }
      if (n.kind === "scraper") { x = (n.x1 + n.x2) / 2; y = Math.max(n.y1, n.y2) + 46; }
      if (id === "Tr1") y = n.cy - 30;
      if (id === "TrGP" || id === "Tr50300" || id === "Tr50400") y = n.cy - 24;
      if (n.kind === "diverter") { x = n.x - 8; y = n.y + 20; align = "right"; }
      if (id === "TrHole") { x = 540; y = 1000; align = "left"; }
      if (id === "KondGr") { x = n.x; y = n.y + n.h + 50; align = "left"; }
      if (id === "PitGr") { x = 2560; y = 1608; align = "right"; }
      if (id === "Tr40300") y = n.cy - 26;
      if (id === "AspGr") { x = n.x + n.w / 2; y = n.y - 84; }
      if (id === "Ohl") { x = n.x - 10; y = n.y + 60; align = "right"; }
      if (id === "Gran") { x = n.x - 10; y = n.y + 150; align = "right"; }
      if (n.kind === "crusher") { const L = n.motor === "left"; x = n.hx + (L ? -34 : 34); y = n.y + 40; align = L ? "right" : "left"; }
      label(t, x, y, { size: n.kind === "noria" ? 20 : 17, align, color: faulty(id === "Pros" ? "Pros1" : id) ? "#b3141a" : COL.text });
      if (VOPT.tags && handOf(id === "Pros" ? "Pros1" : id)) badge("Р", x + (align === "center" ? ctx.measureText(t).width / 2 + 18 : 12), y - 7, { size: 12, bg: "#1f63c6", edge: "#bcd4f5", color: "#fff" });
    }
  }
  const ZONES = [
    ["ПРИЁМКА ЗЕРНА · ЗАГРУЗКА БВ", 30, 1110],
    ["ДОЗИРОВАНИЕ · БОЛЬШИЕ ВЕСЫ", 1150, 1150],
    ["ДРОБЛЕНИЕ", 2150, 1090], ["ДОБАВКИ · СМЕШИВАНИЕ · УДЖК", 3190, 860],
    ["ГОТОВАЯ ПРОДУКЦИЯ", 3770, 1080], ["ЛИНИЯ ГРАНУЛИРОВАНИЯ · ПАРОВОЙ КОТЁЛ", 1520, 1248],
  ];
  function drawBackdrop() {
    const g = ctx.createLinearGradient(0, 0, 0, S.H); g.addColorStop(0, COL.bg1); g.addColorStop(1, COL.bg0);
    ctx.fillStyle = g; ctx.fillRect(-2000, -2000, S.W + 4000, S.H + 4000);
    ctx.strokeStyle = COL.grid; ctx.lineWidth = 1;
    for (let x = 0; x <= S.W; x += 80) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, S.H); ctx.stroke(); }
    for (let y = 0; y <= S.H; y += 80) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(S.W, y); ctx.stroke(); }
    // участок гранулирования — подложка
    ctx.fillStyle = "rgba(0,67,149,.035)"; ctx.fillRect(1500, 1230, 3680, 1260);
    ctx.strokeStyle = "rgba(0,67,149,.18)"; ctx.setLineDash([12, 10]); ctx.strokeRect(1500, 1230, 3680, 1260); ctx.setLineDash([]);
    ZONES.forEach(([t, x, y]) => label(t, x, y, { size: 13, align: "left", color: "#4b6f9c", w: 800, halo: false, base: "top" }));
  }
  function drawSelection() {
    for (const [id, col] of [[hover, "rgba(0,67,149,.55)"], [selected, "#e81d23"]]) {
      const n = id && ND[id]; if (!n) continue;
      const tx = n.kind === "truck" ? truckX(id) : 0;
      ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.setLineDash([8, 6]);
      ctx.strokeRect(n.x + tx - 8, n.y - 8, n.w + 16, n.h + 16); ctx.setLineDash([]);
    }
  }

  const ORDER = ["bunker", "pit", "box", "tank", "boiler", "cabinet", "compressor", "scale", "noria", "scraper", "screw", "crusher", "mixer",
    "scalp", "magnet", "conditioner", "press", "cooler", "sifter", "bigbag", "cyclone", "filter", "oilscale", "sluice", "diverter", "shiber", "gate", "vibr", "truck"];
  let last = 0;
  function render(now) {
    if (!cv) return;
    const dt = last ? (now - last) / 1000 : 0.016; last = now;
    stepParticles(dt * Math.min(3, S.timeScale || 1));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.setTransform(scale, 0, 0, scale, offX, offY);
    K.use(ctx);
    drawBackdrop();
    if (VOPT.pipes) drawDucts();
    drawPipes();
    drawSteam();
    const nodes = Object.values(ND).sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
    for (const n of nodes) { const f = DRAW[n.kind]; if (f) { try { f(n); } catch (e) { if (!render._err) { render._err = 1; console.error(n.id, e); } } } }
    drawParticles();
    drawLabels();
    drawSelection();
  }

  buildLinks();
  global.RENDER = {
    init, render, toWorld, toClient, hitAt, zoomAt, panBy, fit, focus,
    setHover: (id) => { hover = id; }, setSelected: (id) => { selected = id; },
    get options() { return VOPT; }, set options(o) { VOPT = Object.assign(VOPT, o); },
    SHORT,
  };
})(window);
