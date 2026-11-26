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
  const SPRITES = ["truck", "cyclone", "magnet", "fan"];
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
    cv = canvas; ctx = cv.getContext("2d");
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
    L([2340, 548], A.Drob1.in, flowOf("Pit1"), null, { pts: [[2340, 548], [2340, 575], [2300, 600], [2300, 622]] });
    L([2462, 548], A.Drob2.in, flowOf("Pit2"), null, { pts: [[2462, 548], [2462, 575], [2500, 600], [2500, 622]] });
    L(A.Drob1.out, [2300, 842], () => (CT.Drob1.mass > 0.2 && running("Drob1") ? 1.5 : 0), () => "meal");
    L(A.Drob2.out, [2500, 842], () => (CT.Drob2.mass > 0.2 && running("Drob2") ? 1.5 : 0), () => "meal");
    L(A.TrDrob.out, A.Nor3.in, flowOf("TrDrob"));
    L(A.Nor3.out, A.UpBunk.in, flowOf("Nor3"), () => "meal", { pts: [A.Nor3.out, [2830, 476], [2960, 476], A.UpBunk.in] });
    for (let i = 0; i < 8; i++) { const cx = 2875 + i * 86; L([cx + 18, 340], [cx + 18, 345], () => (running("D" + (i + 1)) ? 1 : 0), () => "add", { w: 8 }); }
    L([2870, 421], [2870, 430], () => (M.ZatvD.pos > 0.3 && CT.scale2.mass > 0.2 ? 2 : 0), () => "add");
    L(A.TrDob.out, A.Nor3.in, flowOf("TrDob"), () => "add", { pts: [A.TrDob.out, [2806, 500], [2760, 500], [2760, 880], A.Nor3.in] });
    L([2960, 708], [2960, 714], () => (M.KlapSms.pos > 0.3 && CT.UpBunk.mass > 1 ? 4 : 0), () => "meal");
    L(A.Sms.out, [2972, 866], () => (M.ShDownSms.pos > 0.3 && CT.Sms.mass > 1 ? 4 : 0), () => "mash");
    L(A.DownBunk.out, A.TrSms.in, () => (running("TrSms") && CT.DownBunk.mass > 1 ? 4 : 0), () => "mash", { pts: [A.DownBunk.out, [2972, 1040], [2912, 1040], [2912, 1044]] });
    L([3300, 590], [3255, 640], () => (V.Go_MasloDop ? 1 : 0), () => "oil", { w: 7, pts: [[3300, 590], [3300, 615], [3255, 615], [3255, 640]] });
    L([3255, 732], A.Sms.oil, () => (V.Go_MasloDos ? 1 : 0), () => "oil", { w: 7, pts: [[3255, 732], [3255, 700], [3100, 700], A.Sms.oil] });
    L([3152, 1080], A.Tr40100.in, outletOn("TrSms", 0), () => "mash", { pts: [[3152, 1080], [3152, 1106], [3152, 2200], [2862, 2240], A.Tr40100.in] });
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
    L(A.Tr40100.out, A.Nor5.in, flowOf("Tr40100"), kindOf("Tr40100"));
    L(A.Nor5.out, A.Tr40300.in, flowOf("Nor5"), () => "mash");
    L(A.Tr40300.out, A.PBGran.in, flowOf("Tr40300"), () => "mash");
    L(A.PBGran.out, [3462, 1600], () => (running("PitGr") ? 1 : 0), () => "mash", { pts: [A.PBGran.out, [3500, 1596], [3462, 1596], [3462, 1600]] });
    L([3548, 1636], A.KondGr.in, flowOf("PitGr"), () => "mash", { pts: [[3548, 1636], [3548, 1642], [3420, 1642], A.KondGr.in] });
    L(A.KondGr.out, A.Gran.in, () => (S.kondFlow || 0) * 2, () => "mash", { pts: [A.KondGr.out, [3610, 1715], [3600, 1728]] });
    L(A.Gran.out, A.Ohl.in, () => (S.granFlow || 0) * 2, () => "pellet");
    L(A.Ohl.out, A.Tr40700.in, () => (M.Ohl.spin > 0.3 && CT.Ohl.mass > 5 ? 2 : 0), () => "pellet", { pts: [A.Ohl.out, [3525, 2262], [3462, 2262], A.Tr40700.in] });
    L(A.Tr40700.out, A.Nor6.in, flowOf("Tr40700"), () => "pellet");
    L(A.Nor6.out, A.PP1.in, flowOf("Nor6"), () => "pellet", { pts: [A.Nor6.out, [3962, 1358], A.PP1.in] });
    L(A.PP1.o1, A.Pros.in, () => (V.PP1_Pos1 ? EL.Nor6.flow : 0), () => "pellet", { pts: [A.PP1.o1, [3944, 1430], [4010, 1430], A.Pros.in] });
    L(A.PP1.o2, A.Torba.in, () => (V.PP1_Pos2 ? EL.Nor6.flow : 0), () => "pellet", { pts: [A.PP1.o2, [3980, 1700], [4220, 1740], A.Torba.in] });
    L(A.Pros.out, A.PP2.in, flowOf("Pros"), () => "pellet", { pts: [A.Pros.out, [4282, 1580], A.PP2.in] });
    L(A.Pros.waste, A.Tr40800.in, () => (EL.Pros.flow > 0.05 ? 0.4 : 0), () => "fines", { pts: [A.Pros.waste, [4150, 2340], [4250, 2350]] });
    L(A.PP2.o2, A.Tr51100.in, () => (V.PP2_Pos2 ? EL.Pros.flow : 0), () => "pellet", { pts: [A.PP2.o2, [4300, 1686]] });
    L(A.PP2.o1, A.Torba.in, () => (V.PP2_Pos1 ? EL.Pros.flow : 0), () => "pellet", { pts: [A.PP2.o1, [4264, 1720], [4220, 1740], A.Torba.in] });
    L(A.Tr51100.out, A.PP3.in, flowOf("Tr51100"), () => "pellet", { pts: [A.Tr51100.out, [4632, 1240]] });
    L(A.PP3.o1, A.Tr51200.in, () => (V.PP3_Pos1 ? EL.Tr51100.flow : 0), () => "pellet", { pts: [A.PP3.o1, [4614, 1191], [4590, 1191]] });
    L(A.PP3.o2, A.Nor7.in, () => (V.PP3_Pos2 ? EL.Tr51100.flow : 0), () => "pellet", { pts: [A.PP3.o2, [4650, 1330], [4650, 2280], A.Nor7.in] });
    L(A.Tr51200.out, A.Nor4.in, flowOf("Tr51200"), () => "pellet", { pts: [A.Tr51200.out, [3690, 1230], [3640, 1230], [3606, 1194]] });
    L(A.Nor7.out, A.b309.in, flowOf("Nor7"), () => "pellet", { pts: [A.Nor7.out, [4930, 1358], A.b309.in] });
    L([4930, 1990], [4930, 2060], () => (M.ShO9.pos > 0.3 && CT.s9.mass > 5 ? 5 : 0), () => "pellet", { w: 14 });
    L(A.Torba.out, [4295, 2100], () => (V.Go_Leb || CT.bigbag.mass > 0 ? 0 : 0), () => "pellet");
    L(A.Tr40800.out, A.Tr40100.in, flowOf("Tr40800"), () => "fines", { pts: [A.Tr40800.out, [2850, 2392], [2850, 2300], A.Tr40100.in] });
  }
  // аспирационные воздуховоды (пунктир)
  const DUCTS = [
    { id: "Asp1", pts: [[355, 120], [355, 80], [760, 80], [760, 470]] },
    { id: "Asp1", pts: [[355, 80], [570, 80], [570, 150]] },
    { id: "Asp1", pts: [[760, 80], [990, 80], [990, 120]] },
    { id: "Asp2", pts: [[5035, 110], [5035, 60], [3060, 60], [3060, 712]] },
    { id: "Asp2", pts: [[3650, 60], [3650, 110]] },
    { id: "Asp2", pts: [[2750, 60], [2750, 120], [2750, 60], [2400, 60], [2400, 250]] },
    { id: "AspGr", pts: [A.Ohl.duct, [3650, 2010], [3650, 1950], [3700, 1930]] },
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
  function drawPipes() {
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    for (const L of LINKS) {
      polyPath(L.pts);
      const oil = L.kind() === "oil";
      ctx.strokeStyle = oil ? "#8a6a10" : COL.pipeEdge; ctx.lineWidth = L.w + 3; ctx.stroke();
      ctx.strokeStyle = oil ? "#c99a2a" : COL.pipe; ctx.lineWidth = L.w; ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,.35)"; ctx.lineWidth = 2.5; ctx.stroke();
    }
  }
  function drawDucts() {
    ctx.save(); ctx.lineJoin = "round";
    for (const d of DUCTS) {
      const on = running(d.id);
      polyPath(d.pts);
      ctx.strokeStyle = on ? "rgba(132,58,160,.85)" : "rgba(132,58,160,.32)"; ctx.lineWidth = 5;
      ctx.setLineDash([16, 11]); ctx.lineDashOffset = on ? -(performance.now() / 1000) * 40 : 0; ctx.stroke();
    }
    ctx.restore();
  }

  /* ============================================================ машины */
  function drawNoria(n) {
    const m = M[n.id], e = EL[n.id], x = n.x, y = n.y, w = n.w, h = n.h, f = faulty(n.id);
    const legW = w * 0.3, lx = x + w * 0.12, rx = x + w * 0.58;
    // опоры-ноги (две трубы), головка, башмак
    [lx, rx].forEach((X) => { ctx.fillStyle = metal(X, 0, X + legW, 0); ctx.fillRect(X, y + 50, legW, h - 100); ctx.strokeStyle = "#26323a"; ctx.lineWidth = 1.5; ctx.strokeRect(X, y + 50, legW, h - 100); });
    for (let yy = y + 120; yy < y + h - 60; yy += 160) { ctx.fillStyle = "#4a5a64"; ctx.fillRect(lx - 4, yy, w * 0.84, 7); }
    // смотровое окно на подъёмной ветви: ковши с продуктом
    const dist = (m ? m.spin : 0) * performance.now() / 1000 * 140 + (m ? m.hours * 3600 * 140 : 0);
    const wy0 = y + 80, wy1 = y + h - 70;
    ctx.save(); ctx.beginPath(); ctx.rect(lx + 4, wy0, legW - 8, wy1 - wy0); ctx.clip();
    ctx.fillStyle = "#1d262d"; ctx.fillRect(lx + 4, wy0, legW - 8, wy1 - wy0);
    const sp = 26, off = ((m && m.spin > 0.01 ? (m._belt = (m._belt || 0) + m.spin * 3) : (m && m._belt) || 0)) % sp;
    for (let yy = wy1 + sp - off; yy > wy0 - sp; yy -= sp) {
      ctx.fillStyle = "#8795a2"; ctx.beginPath(); ctx.moveTo(lx + 6, yy); ctx.lineTo(lx + legW - 6, yy); ctx.lineTo(lx + legW - 10, yy + 11); ctx.lineTo(lx + 8, yy + 11); ctx.closePath(); ctx.fill();
      if (e) {
        const t = 1 - (yy - wy0) / (wy1 - wy0), q = cellAt(e, t) / (e.cap || 1);
        if (q > 0.03) { ctx.fillStyle = kc(e.kinds[Math.min(e.N - 1, Math.floor(t * e.N))] || "grain", 1); ctx.fillRect(lx + 8, yy - Math.min(8, 8 * q), legW - 16, Math.min(8, 8 * q) + 1); }
      }
    }
    ctx.restore();
    void dist;
    // головка
    ctx.fillStyle = metal(x, y, x + w, y + 60); rr(x + 2, y, w - 4, 62, 26); ctx.fill(); ctx.strokeStyle = "#26323a"; ctx.lineWidth = 2; ctx.stroke();
    // выпускной патрубок
    ctx.fillStyle = metal(x + w - 10, y + 30, x + w + 30, y + 30); ctx.beginPath(); ctx.moveTo(x + w - 8, y + 26); ctx.lineTo(x + w + 34, y + 46); ctx.lineTo(x + w + 22, y + 66); ctx.lineTo(x + w - 8, y + 54); ctx.closePath(); ctx.fill(); ctx.stroke();
    // приводной барабан (вращается)
    const hx = x + w / 2, hy = y + 30, hr = 18, ang = m && m._belt ? m._belt / hr : 0;
    ctx.fillStyle = "#3c4752"; ctx.beginPath(); ctx.arc(hx, hy, hr, 0, TAU); ctx.fill();
    ctx.strokeStyle = "#c8d2da"; ctx.lineWidth = 3;
    for (let k = 0; k < 6; k++) { const q = ang + k * TAU / 6; ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx + Math.cos(q) * hr * 0.85, hy + Math.sin(q) * hr * 0.85); ctx.stroke(); }
    // мотор-редуктор
    ctx.fillStyle = "#3f5f86"; rr(x - 34, y + 14, 34, 30, 5); ctx.fill(); ctx.fillStyle = "#2f4a6c"; ctx.fillRect(x - 40, y + 18, 8, 22);
    // башмак
    ctx.fillStyle = metal(x, y + h - 60, x + w, y + h); ctx.fillRect(x, y + h - 60, w, 60); ctx.strokeStyle = "#26323a"; ctx.lineWidth = 2; ctx.strokeRect(x, y + h - 60, w, 60);
    if (e) { const boot = e.cells[0] + e.cells[1] + e.cells[2]; const fr = Math.min(1, boot / (e.cap * 3)); if (fr > 0.02) { ctx.fillStyle = kc(e.kinds[0], 1); ctx.fillRect(x + 6, y + h - 6 - 46 * fr, w - 12, 46 * fr); } }
    ctx.fillStyle = "#26323a"; ctx.fillRect(x - 6, y + h - 4, w + 12, 8);
    if (f) { ctx.strokeStyle = COL.bad; ctx.lineWidth = 4; ctx.setLineDash([10, 6]); ctx.strokeRect(x - 8, y - 6, w + 16, h + 12); ctx.setLineDash([]); }
    led(x + w / 2, y + h - 30, n.id, 8);
  }

  function drawScrew(n) {
    const m = M[n.id], e = EL[n.id], f = faulty(n.id);
    const small = n.small, h = small ? 22 : n.h, cy = n.cy, x = n.x, w = n.w, y = cy - h / 2;
    // кожух
    ctx.fillStyle = metal(0, y, 0, y + h); rr(x, y, w, h, small ? 5 : 9); ctx.fill();
    ctx.strokeStyle = "#26323a"; ctx.lineWidth = 2; ctx.stroke();
    // окно с витками и продуктом
    const wx = x + (small ? 6 : 16), ww = w - (small ? 12 : 32), wy = y + h * 0.22, wh = h * 0.56;
    ctx.save(); ctx.beginPath(); ctx.rect(wx, wy, ww, wh); ctx.clip();
    ctx.fillStyle = "#13202a"; ctx.fillRect(wx, wy, ww, wh);
    // продукт по ячейкам
    if (e) {
      const nom = e.cap || 1;
      ctx.beginPath(); ctx.moveTo(wx, wy + wh);
      for (let X = wx; X <= wx + ww; X += 4) {
        const t = n.dir > 0 ? (X - x) / w : (x + w - X) / w;
        const q = Math.min(1, cellAt(e, t) / nom);
        ctx.lineTo(X, wy + wh - wh * 0.85 * q);
      }
      ctx.lineTo(wx + ww, wy + wh); ctx.closePath();
      ctx.fillStyle = kc(e.kinds[Math.floor(e.N / 2)], 1); ctx.fill();
    } else if (n.dozer && m && m.spin > 0.05) {
      ctx.fillStyle = kc(n.bunk > 200 ? "add" : "grain", 1); ctx.fillRect(wx, wy + wh * 0.4, ww, wh * 0.6);
    }
    // витки
    m._ph = (m._ph || 0) + (m.spin || 0) * 0.25 * (n.reverse ? (V.GoR_Tr1 ? 1 : -1) : n.dir);
    const pitch = small ? 12 : n.chain ? 26 : 20;
    ctx.strokeStyle = n.chain ? "#6d7b86" : "#b9c6ce"; ctx.lineWidth = n.chain ? 4 : 2.6;
    const ph = ((m._ph * pitch) % pitch + pitch) % pitch;
    for (let X = wx - pitch + ph; X < wx + ww + pitch; X += pitch) {
      ctx.beginPath();
      if (n.chain) { ctx.moveTo(X, wy + 2); ctx.lineTo(X, wy + wh - 2); }
      else { ctx.moveTo(X, wy); ctx.lineTo(X + pitch * 0.55, wy + wh); }
      ctx.stroke();
    }
    if (!n.chain) { ctx.fillStyle = "#8d9aa4"; ctx.fillRect(wx, wy + wh / 2 - 2, ww, 4); }
    ctx.restore();
    // мотор
    if (!small || n.dozer) {
      const mx = n.motorAt === "mid" ? x + w / 2 - 18 : n.dir > 0 ? x - (small ? 20 : 34) : x + w;
      const mw = small ? 20 : 34, mh = small ? 16 : 26;
      ctx.fillStyle = "#3f5f86"; rr(mx, cy - mh / 2 - (n.motorAt === "mid" ? h / 2 + 10 : 0), mw, mh, 4); ctx.fill();
    }
    if (n.pch && !small) { ctx.font = "800 13px Raleway"; ctx.fillStyle = "#0a4c9a"; ctx.textAlign = "left"; ctx.fillText("ПЧ", x + 4, y - 4); }
    if (f) { ctx.strokeStyle = COL.bad; ctx.lineWidth = 4; ctx.setLineDash([10, 6]); ctx.strokeRect(x - 6, y - 6, w + 12, h + 12); ctx.setLineDash([]); }
    led(n.dir > 0 ? x + w - 12 : x + 12, cy, n.id, small ? 5 : 7);
  }

  function drawScraper(n) {
    const m = M[n.id], e = EL[n.id], f = faulty(n.id);
    const { x1, y1, x2, y2 } = n, ang = Math.atan2(y2 - y1, x2 - x1), len = Math.hypot(x2 - x1, y2 - y1), h = 40;
    ctx.save(); ctx.translate(x1, y1); ctx.rotate(ang);
    ctx.fillStyle = metal(0, -h / 2, 0, h / 2); rr(0, -h / 2, len, h, 8); ctx.fill(); ctx.strokeStyle = "#26323a"; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = "#13202a"; ctx.fillRect(12, -h * 0.3, len - 24, h * 0.6);
    if (e) {
      ctx.beginPath(); ctx.moveTo(12, h * 0.3);
      for (let X = 12; X <= len - 12; X += 5) ctx.lineTo(X, h * 0.3 - h * 0.55 * Math.min(1, cellAt(e, X / len) / (e.cap || 1)));
      ctx.lineTo(len - 12, h * 0.3); ctx.closePath(); ctx.fillStyle = kc(e.kinds[Math.floor(e.N / 2)], 1); ctx.fill();
    }
    m._ph = (m._ph || 0) + m.spin * 0.25;
    ctx.strokeStyle = "#6d7b86"; ctx.lineWidth = 3;
    const ph = (m._ph * 30) % 30;
    for (let X = 12 + ph; X < len - 12; X += 30) { ctx.beginPath(); ctx.moveTo(X, -h * 0.3); ctx.lineTo(X, h * 0.3); ctx.stroke(); }
    ctx.fillStyle = "#3f5f86"; rr(len - 4, -h / 2 - 8, 30, 26, 4); ctx.fill();
    if (f) { ctx.strokeStyle = COL.bad; ctx.lineWidth = 4; ctx.setLineDash([10, 6]); ctx.strokeRect(-6, -h / 2 - 6, len + 12, h + 12); ctx.setLineDash([]); }
    ctx.restore();
    led(x2 - Math.cos(ang) * 20, y2 - Math.sin(ang) * 20, n.id, 7);
  }

  function bunkerFill(n) { const c = CT[n.level]; return c ? Math.max(0, Math.min(1.04, c.mass / c.cap)) : 0; }
  function drawBunker(n) {
    const c = CT[n.level], x = n.x, y = n.y, w = n.w, h = n.h;
    const cone = Math.min(w * 0.55, h * 0.3), body = h - cone;
    const shape = () => { ctx.beginPath(); ctx.moveTo(x, y + 8); ctx.lineTo(x + w, y + 8); ctx.lineTo(x + w, y + body); ctx.lineTo(x + w / 2 + 12, y + h); ctx.lineTo(x + w / 2 - 12, y + h); ctx.lineTo(x, y + body); ctx.closePath(); };
    shape(); ctx.fillStyle = metal(x, 0, x + w, 0); ctx.fill();
    // уровень продукта (сечение)
    const fr = bunkerFill(n);
    if (c && fr > 0.002) {
      ctx.save(); shape(); ctx.clip();
      // объём: конус + цилиндр, упрощённо — линейно по высоте
      const lvlY = y + h - (h - 8) * Math.min(1, fr);
      const g = ctx.createLinearGradient(0, lvlY, 0, y + h);
      g.addColorStop(0, kc(c.kind, 0)); g.addColorStop(1, kc(c.kind, 2));
      ctx.fillStyle = g; ctx.fillRect(x, lvlY, w, y + h - lvlY);
      ctx.restore();
    }
    // внутреннее «окно» — затемнение верхней пустой части
    ctx.save(); shape(); ctx.clip(); ctx.fillStyle = "rgba(20,30,40,.16)"; ctx.fillRect(x, y, w, (y + h - (h - 8) * Math.min(1, fr)) - y); ctx.restore();
    shape(); ctx.strokeStyle = "#26323a"; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.fillStyle = "#4c5a64"; ctx.fillRect(x - 4, y, w + 8, 10);
    // рёбра жёсткости
    ctx.strokeStyle = "rgba(255,255,255,.18)"; ctx.lineWidth = 1.5;
    for (let yy = y + 50; yy < y + body - 10; yy += 60) { ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + w, yy); ctx.stroke(); }
    // ДВУ / ДНУ
    if (VOPT.levels && c) {
      const dvu = sensorDVU(n), dnu = sensorDNU(n);
      if (dvu !== null) sensorLamp(x + w - 10, y + 22, dvu, true);
      if (dnu !== null) sensorLamp(x + w - 10, y + body - 10, dnu, false);
    }
    // номер и процент
    if (n.num) badge(String(n.num), x + w / 2, y + 40, { size: Math.min(26, w * 0.24), bg: "#004395", edge: "#cfe0f5", color: "#fff" });
    else if (n.label) label(BSHORT[n.id] || n.label, x - 8, y + 34, { size: 17, align: "right" });
    if (c) {
      const pct = Math.round(fr * 100);
      badge(c.mass >= 1000 ? (c.mass / 1000).toFixed(1) + " т" : Math.round(c.mass) + " кг", x + w / 2, y + body * 0.55, { size: Math.min(18, w * 0.16) });
      if (n.kindB !== "add") badge(pct + "%", x + w / 2, y + body * 0.55 + 30, { size: Math.min(16, w * 0.14), edge: "#89a0b3", color: "#d7e5f0" });
      if (c.prod && c.mass > 1 && VOPT.labels && w >= 100) {
        ctx.save(); ctx.translate(x + w / 2, y + body - 8);
        ctx.font = "700 13px Raleway"; ctx.textAlign = "center"; ctx.fillStyle = "#fff";
        wrap(c.prod, w - 10).forEach((ln, i, arr) => ctx.fillText(ln, 0, -((arr.length - 1 - i) * 15)));
        ctx.restore();
      }
    }
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
  function sensorLamp(x, y, on, top) {
    ctx.beginPath(); ctx.arc(x, y, 6, 0, TAU);
    ctx.fillStyle = on ? (top ? "#ff5a3c" : "#47e07a") : "#55626c"; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = "#1b252c"; ctx.stroke();
  }

  function drawShiber(n) {
    const m = M[n.id] || { pos: 0 }, f = faulty(n.id), x = n.x, y = n.y, w = n.w, h = n.h;
    ctx.fillStyle = "#4d5c66"; rr(x, y, w, h, 3); ctx.fill(); ctx.strokeStyle = "#1e2a31"; ctx.lineWidth = 1.5; ctx.stroke();
    // заслонка: ширина просвета = положение
    const gap = (w - 10) * m.pos;
    ctx.fillStyle = "#c7d1d8"; ctx.fillRect(x + 5 + gap, y + h / 2 - 3, w - 10 - gap, 6);
    const moving = m.spin > 0;
    const c = f ? COL.bad : moving ? COL.warn : m.pos > 0.98 ? COL.ok : "#9aa6b0";
    ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x + w + 8, y + h / 2, 5.5, 0, TAU); ctx.fill();
    ctx.strokeStyle = "#1b252c"; ctx.lineWidth = 1.2; ctx.stroke();
  }
  function drawGate(n) { drawShiber(n); }

  function drawScale(n) {
    const c = CT[n.level], x = n.x, y = n.y, w = n.w, h = n.h;
    ctx.fillStyle = metal(0, y, 0, y + h); rr(x, y, w, h, 8); ctx.fill(); ctx.strokeStyle = "#26323a"; ctx.lineWidth = 2; ctx.stroke();
    if (c && c.mass > 0.05) { const fr = Math.min(1, c.mass / c.cap); ctx.fillStyle = kc(c.kind, 1); ctx.fillRect(x + 8, y + h - 8 - (h - 16) * fr, w - 16, (h - 16) * fr); }
    // тензодатчики
    [x + 18, x + w - 30].forEach((X) => { ctx.fillStyle = "#26323a"; ctx.fillRect(X, y + h, 12, 10); });
    const val = n.id === "scale1" ? V.Ves1 : V.Ves2;
    ctx.fillStyle = "#0e161c"; rr(x + w / 2 - 70, y + h / 2 - 17, 140, 34, 4); ctx.fill();
    ctx.font = "700 24px 'Courier New', monospace"; ctx.fillStyle = "#ff5040"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText((+val || 0).toFixed(n.id === "scale1" ? 1 : 2) + " кг", x + w / 2, y + h / 2 + 1); ctx.textBaseline = "alphabetic";
    label(n.label, x + 14, y + h / 2 + 6, { align: "left", size: 15, color: "#fff", halo: false, fixed: true, base: "middle" });
  }

  function drawDiverter(n) {
    const m = M[n.id] || { pos: 0 }, x = n.x, y = n.y, w = n.w, h = n.h, f = faulty(n.id);
    ctx.fillStyle = metal(x, 0, x + w, 0);
    ctx.beginPath(); ctx.moveTo(x + w * 0.3, y); ctx.lineTo(x + w * 0.7, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w * 0.62, y + h); ctx.lineTo(x + w / 2, y + h * 0.55); ctx.lineTo(x + w * 0.38, y + h); ctx.lineTo(x, y + h); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = f ? COL.bad : "#26323a"; ctx.lineWidth = f ? 4 : 2; ctx.stroke();
    // клапан: pos 0 → левый выход, 1 → правый
    const a = -0.5 + m.pos;
    ctx.strokeStyle = "#ffd65a"; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(x + w / 2, y + 6); ctx.lineTo(x + w / 2 + Math.sin(a) * h * 0.55, y + 6 + Math.cos(a) * h * 0.5); ctx.stroke();
    ctx.fillStyle = "#3f5f86"; rr(x + w + 2, y + 6, 22, 20, 3); ctx.fill();
    led(x + w + 13, y + 36, n.id, 5);
  }

  function drawScalp(n) {
    const m = M[n.id], x = n.x, y = n.y, w = n.w, h = n.h;
    ctx.fillStyle = metal(0, y, 0, y + h); rr(x, y, w, h * 0.72, 14); ctx.fill(); ctx.strokeStyle = "#26323a"; ctx.lineWidth = 2; ctx.stroke();
    // барабан
    const cx = x + w * 0.5, cy = y + h * 0.36, r = h * 0.26;
    ctx.fillStyle = "#1a252c"; ctx.fillRect(x + 30, cy - r, w - 60, 2 * r);
    m._ph = (m._ph || 0) + m.spin * 0.12;
    ctx.strokeStyle = "#a9b6bf"; ctx.lineWidth = 2;
    for (let k = 0; k < 12; k++) { const X = x + 30 + (((k * 16 + m._ph * 30) % (w - 60)) + (w - 60)) % (w - 60); ctx.beginPath(); ctx.moveTo(X, cy - r); ctx.lineTo(X, cy + r); ctx.stroke(); }
    const e = EL.Scalp; if (e && elMass("Scalp") > 0.2) { ctx.fillStyle = kc("grain", 1); ctx.fillRect(x + 32, cy + r * 0.3, (w - 64) * Math.min(1, elMass("Scalp") / 20), r * 0.6); }
    // ножки и выпуски
    ctx.fillStyle = "#3a4852"; ctx.fillRect(x + 20, y + h * 0.72, 12, h * 0.28); ctx.fillRect(x + w - 32, y + h * 0.72, 12, h * 0.28);
    ctx.fillStyle = "#3f5f86"; rr(x + w - 10, y + 10, 34, 28, 4); ctx.fill();
    void cx; led(x + w - 20, y + h * 0.6, n.id, 7);
    if (faulty(n.id)) { ctx.strokeStyle = COL.bad; ctx.lineWidth = 4; ctx.setLineDash([10, 6]); ctx.strokeRect(x - 6, y - 6, w + 12, h + 12); ctx.setLineDash([]); }
  }

  function drawCrusher(n) {
    const m = M[n.id], x = n.x, y = n.y, w = n.w, h = n.h, c = CT[n.id];
    ctx.fillStyle = metal(x, 0, x + w, 0); rr(x + 10, y, w - 20, h * 0.78, 16); ctx.fill(); ctx.strokeStyle = "#26323a"; ctx.lineWidth = 2; ctx.stroke();
    const cx = x + w / 2, cy = y + h * 0.4, r = Math.min(w, h) * 0.3;
    ctx.fillStyle = "#151f26"; ctx.beginPath(); ctx.arc(cx, cy, r + 6, 0, TAU); ctx.fill();
    if (c && c.mass > 0.1) { ctx.fillStyle = kc("meal", 1); ctx.beginPath(); ctx.arc(cx, cy, r + 5, 0.15 * Math.PI, 0.85 * Math.PI); ctx.fill(); }
    m._ph = (m._ph || 0) + m.spin * 0.9;
    ctx.strokeStyle = "#b9c6ce"; ctx.lineWidth = 5; ctx.lineCap = "round";
    for (let k = 0; k < 8; k++) { const a = m._ph + k * TAU / 8; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r * 0.3, cy + Math.sin(a) * r * 0.3); ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); ctx.stroke(); }
    ctx.fillStyle = "#d5dde3"; ctx.beginPath(); ctx.arc(cx, cy, r * 0.22, 0, TAU); ctx.fill();
    // станина и двигатель
    ctx.fillStyle = "#3a4852"; ctx.fillRect(x + 6, y + h * 0.78, w - 12, 14);
    const mx = n.motor === "left" ? x - 46 : x + w - 4;
    ctx.fillStyle = "#3f5f86"; rr(mx, cy - 24, 50, 48, 6); ctx.fill(); ctx.fillStyle = "#2f4a6c"; for (let k = 0; k < 5; k++) ctx.fillRect(mx + 6 + k * 8, cy - 24, 3, 48);
    const cur = n.id === "Drob1" ? V.TokDrob1 : V.TokDrob2, max = n.id === "Drob1" ? V.TokMax1 : V.TokMax2;
    badge((cur || 0) + " А", cx, y + h - 6, { size: 18, color: (cur || 0) > max ? "#ff6a5a" : "#5cf08a", edge: (cur || 0) > max ? "#ff6a5a" : "#47e07a" });
    led(cx, y + 14, n.id, 7);
    if (faulty(n.id)) { ctx.strokeStyle = COL.bad; ctx.lineWidth = 4; ctx.setLineDash([10, 6]); ctx.strokeRect(x - 6, y - 6, w + 12, h + 12); ctx.setLineDash([]); }
  }

  function drawMixer(n) {
    const m = M[n.id], x = n.x, y = n.y, w = n.w, h = n.h, c = CT.Sms;
    ctx.fillStyle = metal(0, y, 0, y + h); rr(x, y, w, h, 30); ctx.fill(); ctx.strokeStyle = "#26323a"; ctx.lineWidth = 2.5; ctx.stroke();
    const ix = x + 26, iw = w - 52, iy = y + 18, ih = h - 36;
    ctx.save(); rr(ix, iy, iw, ih, 22); ctx.clip();
    ctx.fillStyle = "#16212a"; ctx.fillRect(ix, iy, iw, ih);
    const fr = Math.min(1, c.mass / c.cap);
    if (fr > 0.005) {
      const top = iy + ih - ih * Math.min(1, fr * 1.3), wave = m.spin * 6;
      ctx.beginPath(); ctx.moveTo(ix, iy + ih);
      for (let X = ix; X <= ix + iw; X += 8) ctx.lineTo(X, top + Math.sin(X / 18 + (m._ph || 0) * 2) * wave);
      ctx.lineTo(ix + iw, iy + ih); ctx.closePath(); ctx.fillStyle = kc(S.oilInMix > 0.3 && V.SmsMainState3 ? "mash" : c.kind, 1); ctx.fill();
    }
    m._ph = (m._ph || 0) + m.spin * 0.15;
    ctx.strokeStyle = "#c2ced6"; ctx.lineWidth = 4;
    for (let k = 0; k < 7; k++) { const X = ix + 20 + k * (iw - 40) / 6, a = m._ph + k * 0.9; ctx.beginPath(); ctx.moveTo(X, iy + ih / 2); ctx.lineTo(X + Math.cos(a) * 22, iy + ih / 2 + Math.sin(a) * 22); ctx.stroke(); }
    ctx.fillStyle = "#8d9aa4"; ctx.fillRect(ix, iy + ih / 2 - 3, iw, 6);
    ctx.restore();
    ctx.fillStyle = "#3f5f86"; rr(x + w - 6, y + h / 2 - 22, 52, 44, 6); ctx.fill();
    led(x + w + 20, y + h / 2, n.id, 8);
    const st = mixStage();
    if (st) badge(st, x + w / 2, y + h + 70, { size: 15, edge: "#4b8fd1", color: "#bfe0ff" });
    if (faulty(n.id)) { ctx.strokeStyle = COL.bad; ctx.lineWidth = 4; ctx.setLineDash([10, 6]); ctx.strokeRect(x - 6, y - 6, w + 12, h + 12); ctx.setLineDash([]); }
  }
  function mixStage() { const j = plc.prod.S.mixJob; return j ? `Порция ${j.n}: ${j.stage}` : ""; }

  function drawTank(n) {
    const c = CT[n.level], x = n.x, y = n.y, w = n.w, h = n.h;
    ctx.fillStyle = metal(0, y, 0, y + h); rr(x, y, w, h, h / 2); ctx.fill(); ctx.strokeStyle = "#26323a"; ctx.lineWidth = 2; ctx.stroke();
    const fr = c ? Math.min(1, c.mass / c.cap) : 0;
    ctx.save(); rr(x + 6, y + 6, w - 12, h - 12, h / 2 - 6); ctx.clip();
    ctx.fillStyle = "rgba(20,30,40,.25)"; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = kc("oil", 1); ctx.fillRect(x, y + h - 6 - (h - 12) * fr, w, h);
    ctx.restore();
    label(n.label, x + w / 2, y - 8, { size: 17 });
    if (c) badge(Math.round(c.mass) + " кг", x + w / 2, y + h / 2, { size: 16 });
  }
  function drawOilScale(n) {
    const x = n.x, y = n.y, w = n.w, h = n.h, c = CT.Jir;
    ctx.fillStyle = metal(x, 0, x + w, 0); rr(x, y, w, h - 20, 10); ctx.fill(); ctx.strokeStyle = "#26323a"; ctx.lineWidth = 2; ctx.stroke();
    const fr = Math.min(1, c.mass / c.cap);
    ctx.fillStyle = kc("oil", 1); ctx.fillRect(x + 6, y + h - 26 - (h - 32) * fr, w - 12, (h - 32) * fr);
    ctx.fillStyle = "#0e161c"; rr(x - 10, y + h - 16, w + 20, 26, 3); ctx.fill();
    ctx.font = "700 16px 'Courier New', monospace"; ctx.fillStyle = "#ff5040"; ctx.textAlign = "center"; ctx.fillText((+V.Ves4 || 0).toFixed(2), x + w / 2, y + h + 3);
    label("УДЖК", x + w / 2, y - 8, { size: 16 });
    led(x + w - 8, y + 10, "Jir", 5);
  }
  function drawCompressor(n) {
    const x = n.x, y = n.y, w = n.w, h = n.h, bad = !!V.LowPress;
    ctx.fillStyle = "#5a6f80"; rr(x, y + 20, w, h - 20, 8); ctx.fill();
    ctx.fillStyle = metal(0, y, 0, y + 30); rr(x + 10, y, w - 20, 30, 12); ctx.fill();
    ctx.fillStyle = bad ? COL.bad : COL.ok; ctx.beginPath(); ctx.arc(x + w - 14, y + h - 14, 7, 0, TAU); ctx.fill();
    label(n.label, x + w / 2, y + h + 22, { size: 15, w: 700 });
  }
  function drawBox(n) {
    const x = n.x, y = n.y, w = n.w, h = n.h, c = CT.trash;
    ctx.fillStyle = "#6c7a84"; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w - 10, y + h); ctx.lineTo(x + 10, y + h); ctx.closePath(); ctx.fill();
    const fr = Math.min(1, c.mass / c.cap); ctx.fillStyle = kc("fines", 1); ctx.fillRect(x + 12, y + h - (h - 6) * fr, w - 24, (h - 6) * fr);
    label(n.label + " " + Math.round(c.mass) + " кг", x + w / 2, y + h + 22, { size: 15, w: 700 });
  }
  function drawPit(n) {
    const x = n.x, y = n.y, w = n.w, h = n.h, c = CT.pit;
    ctx.fillStyle = "#59636b"; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w * 0.62, y + h); ctx.lineTo(x + w * 0.38, y + h); ctx.closePath(); ctx.fill();
    const fr = Math.min(1, c.mass / c.cap);
    ctx.save(); ctx.beginPath(); ctx.moveTo(x + 8, y + 6); ctx.lineTo(x + w - 8, y + 6); ctx.lineTo(x + w * 0.62 - 4, y + h - 4); ctx.lineTo(x + w * 0.38 + 4, y + h - 4); ctx.closePath(); ctx.clip();
    ctx.fillStyle = "#1a242b"; ctx.fillRect(x, y, w, h);
    const g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, kc("grain", 0)); g.addColorStop(1, kc("grain", 2));
    ctx.fillStyle = g; ctx.fillRect(x, y + h - h * fr, w, h * fr); ctx.restore();
    // решётка
    ctx.strokeStyle = "#2a343b"; ctx.lineWidth = 3; for (let X = x + 8; X < x + w; X += 16) { ctx.beginPath(); ctx.moveTo(X, y - 4); ctx.lineTo(X, y + 6); ctx.stroke(); }
    ctx.fillStyle = "#2a343b"; ctx.fillRect(x - 10, y - 8, w + 20, 6);
    label(n.label, x + w / 2, y + h + 26, { size: 19 });
    badge((c.mass / 1000).toFixed(1) + " т", x + w / 2, y + h * 0.45, { size: 17 });
  }
  function truckX(id) { const t = S.trucks[id]; return t ? t.x * 420 * (ND[id].flip ? 1 : -1) : 0; }
  function drawTruck(n) {
    const t = S.trucks[n.id]; if (!t || t.phase === "away") return;
    const im = IMG[n.flip ? "truck_flip" : "truck"]; const x = n.x + truckX(n.id), y = n.y;
    ctx.save();
    if (n.id === "truck_in" && t.tilt) { ctx.translate(x + n.w * 0.85, y + n.h * 0.8); ctx.rotate(-0.08 * t.tilt); ctx.translate(-(x + n.w * 0.85), -(y + n.h * 0.8)); }
    if (im) ctx.drawImage(im, x, y, n.w, n.w * im.height / im.width);
    // груз в кузове
    const load = Math.max(0, Math.min(1, t.load || 0));
    if (load > 0.01) {
      const bx = n.flip ? x + n.w * 0.02 : x + n.w * 0.40, bw = n.w * 0.58, by = y + n.h * 0.13;
      ctx.fillStyle = kc(n.id === "truck_in" ? "grain" : (t.silo === 9 ? "pellet" : "mash"), 1);
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.quadraticCurveTo(bx + bw / 2, by - 28 * load, bx + bw, by); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    if (t.phase !== "away" && n.id !== "truck_in") badge(`${(t.load * 20).toFixed(1)} т`, x + n.w / 2, y + n.h + 14, { size: 14 });
  }
  function drawMagnet(n) { const im = IMG.magnet; if (im) ctx.drawImage(im, n.x, n.y, n.w, n.w * im.height / im.width); }
  function drawCyclone(n) {
    const im = IMG.cyclone; if (im) ctx.drawImage(im, n.x, n.y, n.w, n.w * im.height / im.width);
    if (n.id !== "AspGr") { const f = IMG.fan; if (f) ctx.drawImage(f, n.x + n.w - 10, n.y + 10, 90, 90 * f.height / f.width); }
    led(n.x + n.w / 2, n.y + n.h + 14, n.id, 7);
    if (faulty(n.id)) { ctx.strokeStyle = COL.bad; ctx.lineWidth = 4; ctx.setLineDash([10, 6]); ctx.strokeRect(n.x - 6, n.y - 6, n.w + 100, n.h + 30); ctx.setLineDash([]); }
  }
  function drawVibr(n) {
    const m = M[n.id], j = m && m.spin > 0.2 ? Math.sin(performance.now() / 25) * 2 : 0;
    ctx.fillStyle = running(n.id) ? "#2e8f55" : "#56636d"; rr(n.x + j, n.y, n.w, n.h, 4); ctx.fill(); ctx.strokeStyle = "#1b252c"; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.font = "800 12px Raleway"; ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.fillText("В", n.x + n.w / 2 + j, n.y + n.h / 2 + 4);
  }
  function drawFilter(n) {
    const x = n.x, y = n.y, w = n.w, h = n.h;
    ctx.fillStyle = metal(x, 0, x + w, 0); rr(x, y, w, h * 0.75, 6); ctx.fill(); ctx.strokeStyle = "#26323a"; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, y + h * 0.75); ctx.lineTo(x + w, y + h * 0.75); ctx.lineTo(x + w / 2, y + h); ctx.closePath(); ctx.fill(); ctx.stroke();
    led(x + w / 2, y + 14, n.id, 6);
  }
  function drawConditioner(n) {
    const m = M[n.id], x = n.x, y = n.y, w = n.w, h = n.h;
    ctx.fillStyle = metal(0, y, 0, y + h); rr(x, y, w, h, h / 2); ctx.fill(); ctx.strokeStyle = "#26323a"; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = "#16212a"; ctx.fillRect(x + 20, y + 14, w - 40, h - 28);
    const q = Math.min(1, CT.Kond.mass / 8); if (q > 0.02) { ctx.fillStyle = kc("mash", 1); ctx.fillRect(x + 20, y + h - 14 - (h - 28) * q, w - 40, (h - 28) * q); }
    m._ph = (m._ph || 0) + m.spin * 0.3; ctx.strokeStyle = "#c2ced6"; ctx.lineWidth = 3;
    for (let X = x + 26 + ((m._ph * 14) % 14); X < x + w - 22; X += 14) { ctx.beginPath(); ctx.moveTo(X, y + 16); ctx.lineTo(X + 6, y + h - 16); ctx.stroke(); }
    // пар
    if ((+V.SteamValve || 0) > 1 && m.spin > 0.3) { ctx.fillStyle = "rgba(255,255,255,.55)"; for (let k = 0; k < 6; k++) { const t = (performance.now() / 900 + k / 6) % 1; ctx.beginPath(); ctx.arc(x + 40 + k * 30, y - 10 - t * 40, 6 + t * 10, 0, TAU); ctx.fill(); } }
    badge((+V.TempKond || 0).toFixed(0) + " °C", x + w + 40, y + h / 2, { size: 15, color: (+V.TempKond || 0) < V.TempKondMin ? "#ffd166" : "#5cf08a" });
    led(x + 12, y + h / 2, n.id, 6);
  }
  function drawPress(n) {
    const m = M[n.id], x = n.x, y = n.y, w = n.w, h = n.h;
    ctx.fillStyle = "#4c6c8f"; rr(x, y + h * 0.2, w, h * 0.65, 10); ctx.fill(); ctx.strokeStyle = "#1e2a31"; ctx.lineWidth = 2; ctx.stroke();
    const cx = x + w * 0.42, cy = y + h * 0.52, r = h * 0.27;
    ctx.fillStyle = metal(cx - r, cy - r, cx + r, cy + r); ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill(); ctx.stroke();
    m._ph = (m._ph || 0) + m.spin * 0.12;
    ctx.fillStyle = "#1a242b"; for (let k = 0; k < 24; k++) { const a = m._ph + k * TAU / 24; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * r * 0.85, cy + Math.sin(a) * r * 0.85, 3, 0, TAU); ctx.fill(); }
    ctx.fillStyle = "#9aa8b1"; [0, Math.PI].forEach((o) => { const a = -m._ph * 2 + o; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * r * 0.42, cy + Math.sin(a) * r * 0.42, r * 0.3, 0, TAU); ctx.fill(); });
    ctx.fillStyle = "#3f5f86"; rr(x + w * 0.72, y + h * 0.3, w * 0.3, h * 0.45, 8); ctx.fill();
    ctx.fillStyle = "#3a4852"; ctx.fillRect(x - 6, y + h * 0.85, w + 12, 16);
    const cur = +V.TokGran || 0;
    badge(cur + " А", x + w / 2, y + h * 0.1, { size: 16, color: cur > V.TokMaxGran ? "#ff6a5a" : "#5cf08a" });
    if (S.dieJam) badge("МАТРИЦА ЗАБИТА", x + w / 2, y + h + 24, { size: 14, color: "#fff", bg: "#b3141a", edge: "#ff8080" });
    led(x + w - 14, y + h * 0.25, n.id, 7);
    if (faulty(n.id) || V.Err30_8) { ctx.strokeStyle = COL.bad; ctx.lineWidth = 4; ctx.setLineDash([10, 6]); ctx.strokeRect(x - 6, y - 6, w + 12, h + 12); ctx.setLineDash([]); }
  }
  function drawSluice(n) {
    const m = M[n.id], x = n.x, y = n.y, w = n.w, h = n.h;
    ctx.fillStyle = "#56636d"; rr(x, y, w, h, 5); ctx.fill();
    m._ph = (m._ph || 0) + m.spin * 0.2; ctx.strokeStyle = "#d0d9df"; ctx.lineWidth = 2.5;
    for (let k = 0; k < 3; k++) { const a = m._ph + k * Math.PI / 3; ctx.beginPath(); ctx.moveTo(x + w / 2 - Math.cos(a) * w * 0.4, y + h / 2 - Math.sin(a) * h * 0.4); ctx.lineTo(x + w / 2 + Math.cos(a) * w * 0.4, y + h / 2 + Math.sin(a) * h * 0.4); ctx.stroke(); }
    led(x + w + 10, y + h / 2, n.id, 5);
  }
  function drawCooler(n) {
    const x = n.x, y = n.y, w = n.w, h = n.h, c = CT.Ohl;
    ctx.fillStyle = metal(x, 0, x + w, 0); ctx.fillRect(x, y, w, h * 0.8); ctx.strokeStyle = "#26323a"; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h * 0.8);
    ctx.beginPath(); ctx.moveTo(x, y + h * 0.8); ctx.lineTo(x + w, y + h * 0.8); ctx.lineTo(x + w * 0.58, y + h); ctx.lineTo(x + w * 0.42, y + h); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#16212a"; ctx.fillRect(x + 14, y + 14, w - 28, h * 0.8 - 28);
    const fr = Math.min(1, c.mass / 520);
    const tc = Math.max(0, Math.min(1, (c.temp - 20) / 60));
    if (fr > 0.01) { ctx.fillStyle = `rgb(${Math.round(134 + 90 * tc)},${Math.round(86 - 20 * tc)},${Math.round(42 - 20 * tc)})`; ctx.fillRect(x + 14, y + h * 0.8 - 14 - (h * 0.8 - 28) * fr, w - 28, (h * 0.8 - 28) * fr); }
    // стол (решётка выгрузки)
    ctx.strokeStyle = V.OpenStol ? "#5cf08a" : "#9aa6b0"; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(x + 14, y + h * 0.8 - 12); ctx.lineTo(x + w - 14, y + h * 0.8 - 12); ctx.stroke();
    [["ДВУ", V.DVU_OhlGr, 0.12], ["ДСУ", V.DSU_OhlGr, 0.4], ["ДНУ", V.DNU_OhlGr, 0.7]].forEach(([t, on, k]) => { sensorLamp(x + w - 8, y + h * 0.8 * k + 10, on, t === "ДВУ"); });
    badge((+V.TempGranOut || 0).toFixed(0) + " °C", x + w / 2, y + 40, { size: 15 });
    led(x + 16, y + h - 10, "Ohl", 6);
  }
  function drawSifter(n) {
    const m = M.Pros1, m2 = M.Pros2, x = n.x, y = n.y, w = n.w, h = n.h;
    const j = (m.spin > 0.2 || m2.spin > 0.2) ? Math.sin(performance.now() / 30) * 3 : 0;
    ctx.save(); ctx.translate(j, 0);
    ctx.fillStyle = metal(0, y, 0, y + h); rr(x, y, w, h * 0.7, 8); ctx.fill(); ctx.strokeStyle = "#26323a"; ctx.lineWidth = 2; ctx.stroke();
    ctx.strokeStyle = "#1a242b"; ctx.lineWidth = 2; for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.moveTo(x + 12, y + 18 + k * 18); ctx.lineTo(x + w - 12, y + 28 + k * 18); ctx.stroke(); }
    const q = Math.min(1, elMass("Pros") / 12); if (q > 0.02) { ctx.fillStyle = kc("pellet", 1); ctx.fillRect(x + 14, y + 14, (w - 28) * q, 8); }
    ctx.restore();
    ctx.fillStyle = "#3a4852"; ctx.fillRect(x + 10, y + h * 0.7, 12, h * 0.3); ctx.fillRect(x + w - 22, y + h * 0.7, 12, h * 0.3);
    led(x + w - 30, y + h * 0.55, "Pros1", 6); led(x + w - 14, y + h * 0.55, "Pros2", 6);
  }
  function drawBigbag(n) {
    const x = n.x, y = n.y, w = n.w, h = n.h, lb = S.leb, c = CT.bigbag;
    ctx.strokeStyle = "#3a4852"; ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(x, y + h); ctx.lineTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + h); ctx.stroke();
    const bx = x + 30 + lb.x * (w - 150), by = y + 26 + lb.y * 60;
    ctx.strokeStyle = "#202a31"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(bx + 45, y + 4); ctx.lineTo(bx + 45, by); ctx.stroke();
    ctx.fillStyle = "#e7e2d2"; rr(bx, by, 90, 100, 10); ctx.fill(); ctx.strokeStyle = "#8d8573"; ctx.stroke();
    const fr = Math.min(1, c.mass / c.cap); if (fr > 0.01) { ctx.fillStyle = kc("pellet", 1); ctx.fillRect(bx + 6, by + 96 - 88 * fr, 78, 88 * fr); }
    ctx.fillStyle = "#3f5f86"; rr(bx + 30, y - 12, 30, 18, 3); ctx.fill();
    led(x + w - 14, y + 18, "Leb", 6);
  }
  function drawBoiler(n) {
    const x = n.x, y = n.y, w = n.w, h = n.h;
    ctx.fillStyle = "#8a3c2e"; rr(x, y + 20, w, h - 20, 14); ctx.fill(); ctx.fillStyle = metal(0, y, 0, y + 40); rr(x + 30, y, w - 60, 34, 10); ctx.fill();
    ctx.fillStyle = "#f8b15a"; ctx.beginPath(); ctx.arc(x + w / 2, y + h * 0.6, 14, 0, TAU); ctx.fill();
    label(n.label, x + w / 2, y + h + 24, { size: 15, w: 700 });
    badge(`Пар ${Math.round(+V.SteamValve || 0)}%`, x + w / 2, y + h * 0.35, { size: 14 });
  }
  function drawCabinet(n) {
    const x = n.x, y = n.y, w = n.w, h = n.h, k = 3;
    for (let i = 0; i < k; i++) {
      const cx = x + i * (w / k);
      ctx.fillStyle = "#d7dce1"; rr(cx + 4, y, w / k - 8, h, 4); ctx.fill(); ctx.strokeStyle = "#7b8691"; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = "#b9c2ca"; ctx.fillRect(cx + 16, y + 14, w / k - 32, 44);
    }
    const lamps = [["Авария", V.RunLamp, COL.bad], ["Сирена", V.RunSirena, COL.warn], ["ПУСК", !V.EmerPuskBtn, COL.ok]];
    lamps.forEach(([t, on, c], i) => { const X = x + 34, Y = y + 96 + i * 52; ctx.beginPath(); ctx.arc(X, Y, 14, 0, TAU); ctx.fillStyle = on ? c : "#5a646c"; ctx.fill(); ctx.strokeStyle = "#222"; ctx.lineWidth = 2; ctx.stroke(); label(t, X + 24, Y + 8, { size: 22, w: 800, align: "left", fixed: true }); });
    ctx.fillStyle = V.EmerStopShkaf ? "#ff3020" : "#d8231a"; ctx.beginPath(); ctx.arc(x + w - 50, y + 100, 28, 0, TAU); ctx.fill(); ctx.fillStyle = "#ffd700"; ctx.beginPath(); ctx.arc(x + w - 50, y + 100, 36, 0, TAU); ctx.globalCompositeOperation = "destination-over"; ctx.fill(); ctx.globalCompositeOperation = "source-over";
    label(n.label, x + w / 2, y - 12, { size: 18 });
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
      if (id === "KondGr") { x = n.x - 10; y = n.y + 40; align = "right"; }
      if (id === "AspGr") { x = n.x + n.w + 8; y = n.y + 120; align = "left"; }
      if (id === "Ohl") { x = n.x - 10; y = n.y + 60; align = "right"; }
      if (id === "Gran") { x = n.x - 10; y = n.y + 120; align = "right"; }
      label(t, x, y, { size: n.kind === "noria" ? 20 : 17, align, color: faulty(id === "Pros" ? "Pros1" : id) ? "#b3141a" : COL.text });
      if (VOPT.tags && handOf(id === "Pros" ? "Pros1" : id)) badge("Р", x + (align === "center" ? ctx.measureText(t).width / 2 + 18 : 12), y - 7, { size: 12, bg: "#1f63c6", edge: "#bcd4f5", color: "#fff" });
    }
  }
  const ZONES = [
    ["ПРИЁМКА ЗЕРНА · ЗАГРУЗКА БВ", 30, 1110],
    ["ДОЗИРОВАНИЕ · БОЛЬШИЕ ВЕСЫ", 1150, 1150],
    ["ДРОБЛЕНИЕ", 2210, 960], ["ДОБАВКИ · СМЕШИВАНИЕ · УДЖК", 3190, 860],
    ["ГОТОВАЯ ПРОДУКЦИЯ", 3770, 1080], ["ЛИНИЯ ГРАНУЛИРОВАНИЯ", 2830, 1395],
  ];
  function drawBackdrop() {
    const g = ctx.createLinearGradient(0, 0, 0, S.H); g.addColorStop(0, COL.bg1); g.addColorStop(1, COL.bg0);
    ctx.fillStyle = g; ctx.fillRect(-2000, -2000, S.W + 4000, S.H + 4000);
    ctx.strokeStyle = COL.grid; ctx.lineWidth = 1;
    for (let x = 0; x <= S.W; x += 80) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, S.H); ctx.stroke(); }
    for (let y = 0; y <= S.H; y += 80) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(S.W, y); ctx.stroke(); }
    // участок гранулирования — подложка
    ctx.fillStyle = "rgba(0,67,149,.035)"; ctx.fillRect(2800, 1230, 2380, 1180);
    ctx.strokeStyle = "rgba(0,67,149,.18)"; ctx.setLineDash([12, 10]); ctx.strokeRect(2800, 1230, 2380, 1180); ctx.setLineDash([]);
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
    drawBackdrop();
    if (VOPT.pipes) drawDucts();
    drawPipes();
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
