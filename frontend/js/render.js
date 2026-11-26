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
  const SPRITES = ["truck", "magnet", "logo"];
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
    loadMachSprites(layoutMachSprites);
  }
  function flip(im) {
    const c = document.createElement("canvas"); c.width = im.naturalWidth; c.height = im.naturalHeight;
    const x = c.getContext("2d"); x.translate(c.width, 0); x.scale(-1, 1); x.drawImage(im, 0, 0); return c;
  }
  // «погашенная» копия спрайта: выключенный механизм темнее, при разгоне светлеет
  function dark(im) {
    const w = im.naturalWidth || im.width, h = im.naturalHeight || im.height, c = document.createElement("canvas"); c.width = w; c.height = h;
    const x = c.getContext("2d"); x.filter = "brightness(.6) saturate(.65)"; x.drawImage(im, 0, 0); return c;
  }
  const OFF_K = 0.9;
  function drawLit(key, W, ox, oy, H, run) {
    ctx.drawImage(mipImg(key, W), ox, oy, W, H);
    const k = (1 - Math.max(0, Math.min(1, run))) * OFF_K;
    if (k > 0.01 && IMG[key + "_dk"]) { ctx.globalAlpha = k; ctx.drawImage(mipImg(key + "_dk", W), ox, oy, W, H); ctx.globalAlpha = 1; }
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
    const gh = garHit(wx, wy); if (gh) return gh;
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
  // сигнальная лампа в обечайке на корпусе
  function bezelLed(x, y, id, r) {
    ctx.beginPath(); ctx.arc(x, y, r + 3, 0, TAU); ctx.fillStyle = "#2a3238"; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = "#11171b"; ctx.stroke();
    led(x, y, id, r);
  }
  // лампа на кронштейне, приваренном к корпусу в точке (x, y0)
  function lampMount(x, y0, y, id, r) {
    ctx.fillStyle = "#56626a"; ctx.fillRect(x - 2.5, Math.min(y0, y) - 1, 5, Math.abs(y - y0) + 2);
    ctx.fillStyle = "#7d8a93"; ctx.fillRect(x - 6, y0 - 1.5, 12, 3);
    bezelLed(x, y, id, r);
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
    L([2370, 470], A.Pit1.in, () => (running("Pit1") ? 1.2 : 0), () => CT.PBD.kind, { pts: [[2370, 470], [2370, 490], [A.Pit1.in[0], 490], A.Pit1.in] });
    L([2430, 470], A.Pit2.in, () => (running("Pit2") ? 1.2 : 0), () => CT.PBD.kind, { pts: [[2430, 470], [2430, 490], [A.Pit2.in[0], 490], A.Pit2.in] });
    [["Pit1", "mag1", "Drob1"], ["Pit2", "mag2", "Drob2"]].forEach(([p, mg, d]) => {
      const o = A[p].out, i = A[d].in, g = ND[mg], gb = g ? g.y + g.h + 4 : o[1] + 40;
      L(o, i, flowOf(p), null, { pts: [o, [o[0], gb], [o[0], Math.max(gb + 4, i[1] - 26)], [i[0], i[1] - 10], i] });
    });
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
    gk.forEach((cx, i) => L([cx, 820], [cx, 900], () => (M["ShO" + (i + 1)].pos > 0.3 && CT["s" + (i + 1)].mass > 5 ? 5 : 0), () => CT["s" + (i + 1)].kind, { w: 14, spout: true }));
    // гранулирование
    L(A.Tr40100.out, A.Nor5.in, flowOf("Tr40100"), kindOf("Tr40100"), { pts: [[2350, 2400], [A.Nor5.in[0], 2400]] });
    L(A.Nor5.out, A.Tr40300.in, flowOf("Nor5"), () => "mash", { pts: [A.Nor5.out, A.Tr40300.in] });
    L(A.Tr40300.out, A.PBGran.in, flowOf("Tr40300"), () => "mash", { pts: [[2600, 1398], A.PBGran.in] });
    L(A.PBGran.out, [2600, 1627], () => (running("PitGr") ? 1 : 0), () => "mash", { pts: [A.PBGran.out, [2600, 1627]] });
    L([2496, 1649], A.KondGr.in, flowOf("PitGr"), () => "mash", { pts: [[2496, 1649], A.KondGr.in] });
    L(A.KondGr.out, A.Gran.in, () => (S.kondFlow || 0) * 2, () => "mash", { pts: [A.KondGr.out, A.Gran.in] });
    L(A.Gran.out, A.Ohl.in, () => (S.granFlow || 0) * 2, () => "pellet");
    L(A.Ohl.out, A.Tr40700.in, () => (M.Ohl.spin > 0.3 && CT.Ohl.mass > 5 ? 2 : 0), () => "pellet", { pts: [A.Ohl.out, [A.Ohl.out[0], A.Tr40700.in[1]]] });
    L(A.Tr40700.out, A.Nor6.in, flowOf("Tr40700"), () => "pellet", { pts: [A.Tr40700.out, [A.Tr40700.out[0] + 4, A.Tr40700.out[1] + 6], A.Nor6.in] });
    L(A.Nor6.out, A.PP1.in, flowOf("Nor6"), () => "pellet", { pts: [A.Nor6.out, [3962, 1358], A.PP1.in] });
    L(A.PP1.o1, A.Pros.in, () => (V.PP1_Pos1 ? EL.Nor6.flow : 0), () => "pellet", { pts: [A.PP1.o1, [A.PP1.o1[0], 1424], [A.Pros.in[0], 1424], A.Pros.in] });
    L(A.PP1.o2, A.Torba.in, () => (V.PP1_Pos2 ? EL.Nor6.flow : 0), () => "pellet", { pts: [A.PP1.o2, [A.PP1.o2[0], A.PP1.o2[1] + 14], [3952, A.PP1.o2[1] + 44], [3952, 1676], [4152, 1770], [4152, 1780]] });
    L(A.Pros.out, A.PP2.in, flowOf("Pros"), () => "pellet", { pts: [A.Pros.out, A.PP2.in], front: true });
    L(A.Pros.waste, A.Tr40800.in, () => (EL.Pros.flow > 0.05 ? 0.4 : 0), () => "fines", { pts: [A.Pros.waste, [A.Pros.waste[0], 2340], [A.Tr40800.in[0], 2366], A.Tr40800.in], front: true });
    L(A.PP2.o2, A.Tr51100.in, () => (V.PP2_Pos2 ? EL.Pros.flow : 0), () => "pellet", { pts: [A.PP2.o2, [A.PP2.o2[0], A.PP2.o2[1] + 10], [ND.Torba.x + ND.Torba.w + 18, A.PP2.o2[1] + 10], A.Tr51100.in] });
    L(A.PP2.o1, A.Torba.in, () => (V.PP2_Pos1 ? EL.Pros.flow : 0), () => "pellet", { pts: [A.PP2.o1, [A.PP2.o1[0], 1780]] });
    L(A.Tr51100.out, A.PP3.in, flowOf("Tr51100"), () => "pellet", { pts: [A.Tr51100.out, [A.PP3.in[0], A.Tr51100.out[1] + 8], A.PP3.in] });
    L(A.PP3.o1, A.Tr51200.in, () => (V.PP3_Pos1 ? EL.Tr51100.flow : 0), () => "pellet", { pts: [A.PP3.o1, [A.Tr51200.in[0], A.PP3.o1[1]], A.Tr51200.in], behind: true });
    L(A.PP3.o2, A.Nor7.in, () => (V.PP3_Pos2 ? EL.Tr51100.flow : 0), () => "pellet", { pts: [A.PP3.o2, [A.Nor7.in[0] - 40, A.PP3.o2[1]], [A.Nor7.in[0] - 40, A.Nor7.in[1] - 40], A.Nor7.in] });
    { const bi = A.Nor4.sin || [A.Nor4.in[0] + 120, A.Nor4.in[1]]; L(A.Tr51200.out, bi, flowOf("Tr51200"), () => "pellet", { pts: [A.Tr51200.out, [A.Tr51200.out[0], bi[1] - 10], [bi[0] + 6, bi[1] - 10], bi] }); }
    L(A.Nor7.out, A.b309.in, flowOf("Nor7"), () => "pellet", { pts: [A.Nor7.out, [4930, 1358], A.b309.in] });
    L([4930, 1990], [4930, 2060], () => (M.ShO9.pos > 0.3 && CT.s9.mass > 5 ? 5 : 0), () => "pellet", { w: 14, spout: true });
    if (A.Leb && A.Leb.in) L(A.Torba.out, A.Leb.in, () => (S.bagFill ? 2 : 0), () => "pellet", { pts: [A.Torba.out, A.Leb.in] });
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
      L._sp = (L._sp || 0) + Math.min(140, q * 22) * dt;
      const sg = segsOf(L); if (!sg.list.length) continue;
      while (L._sp >= 1) {
        L._sp -= 1;
        if (PARTS.length > 4000) break;
        if (L.kind() === "oil") { L._sp = 0; continue; }
        const r = hash(seed++);
        PARTS.push({ L, s: r * 4, v: 120 + 80 * hash(seed++), seg: 0, off: (r - 0.5) * (L.w * 0.6), c: kc(L.kind(), (seed % 3)), k: L.kind(), r: r * 6.28 });
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
      if (p.L.behind) continue;   // труба идёт за механизмом — продукт в ней не виден
      const sg = segsOf(p.L), sc = sg.list[p.seg], d = p.s - sc.from;
      const x = sc.x0 + sc.ux * d - sc.uy * p.off, y = sc.y0 + sc.uy * d + sc.ux * p.off;
      // отдельные частицы: зерно кувыркается в потоке, гранула — цилиндрик, мука — пыль
      const k = p.k || "grain", a = (p.r || 0) + p.s * 0.08;
      if (k === "pellet") { ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.fillStyle = "#3a230d"; ctx.fillRect(-3.4, -1.3, 7, 3); ctx.fillStyle = p.c; ctx.fillRect(-3.6, -1.6, 7, 3); ctx.restore(); }
      else if (k === "meal" || k === "mash" || k === "fines" || k === "add") { ctx.fillStyle = p.c; ctx.fillRect(x - 0.9, y - 0.9, 1.8, 1.8); ctx.fillRect(x + 2.2, y + 1.1, 1.3, 1.3); }
      else { ctx.beginPath(); ctx.ellipse(x, y, 2.6, 1.35, a, 0, TAU); ctx.fillStyle = "rgba(50,30,8,.55)"; ctx.fill(); ctx.beginPath(); ctx.ellipse(x - 0.3, y - 0.3, 2.3, 1.1, a, 0, TAU); ctx.fillStyle = p.c; ctx.fill(); }
    }
  }
  /* ============================================================ трубы, воздуховоды, пар */
  const T = () => performance.now() / 1000;
  // Телескопический загрузочный рукав отгрузки в автомобиль: гофра + пылезащитный конус
  function loadSpout([x, y], w) {
    const y0 = y - 30;
    for (let k = 0; k < 5; k++) { const yy = y0 + k * 6; K.rr(x - w / 2 - 4, yy, w + 8, 5, 2); ctx.fillStyle = k % 2 ? "#3b4349" : "#4c565d"; ctx.fill(); ctx.strokeStyle = "#1b2227"; ctx.lineWidth = 0.8; ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(x - w / 2 - 3, y); ctx.lineTo(x + w / 2 + 3, y); ctx.lineTo(x + w / 2 + 13, y + 14); ctx.lineTo(x - w / 2 - 13, y + 14); ctx.closePath();
    const g = ctx.createLinearGradient(x - w, 0, x + w, 0); g.addColorStop(0, "#22292e"); g.addColorStop(0.45, "#4d575e"); g.addColorStop(1, "#1d2328");
    ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = "#11171b"; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = "#f0c040"; ctx.fillRect(x - w / 2 - 12, y + 12, w + 24, 2);
  }
  function drawPipes(front) {
    const t = T();
    for (const L of LINKS) {
      if (front && !L.front) continue;
      const oil = L.kind() === "oil";
      K.pipe(L.pts, oil ? 8 : L.w, { kind: oil ? "oil" : "galv" });
      if (!oil && L.w >= 10 && L.pts.length > 1) {
        const n = L.pts.length, f = (p, q) => { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d > 6) K.flange(p[0] + (q[0] - p[0]) / d * 4, p[1] + (q[1] - p[1]) / d * 4, (q[0] - p[0]) / d, (q[1] - p[1]) / d, L.w); };
        f(L.pts[0], L.pts[1]); if (L.spout) loadSpout(L.pts[n - 1], L.w); else f(L.pts[n - 1], L.pts[n - 2]);
      }
      if (oil && (+L.on() || 0) > 0.05) K.pipeFlow(L.pts, 8, "rgba(246,196,40,.95)", 70, t);
    }
  }
  // Магистраль и врезки: врезка рисуется под магистралью и закрывается тройником;
  // врезка в конце магистрали — продолжение магистрали отводом (без стыка «внахлёст»).
  function onSeg(p, pts) {
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      if (Math.abs(y0 - y1) < 1 && Math.abs(p[1] - y0) < 2 && p[0] >= Math.min(x0, x1) - 1 && p[0] <= Math.max(x0, x1) + 1) return { i, end: Math.abs(p[0] - x1) < 2 && i === pts.length - 1 };
    }
    return null;
  }
  function tee(x, y, w, mw) {
    K.rr(x - w / 2 - 6, y - mw / 2 - 3, w + 12, mw + 6, 2); K.skin("galv", K.shadeCyl(x - w / 2 - 6, 0, x + w / 2 + 6, 0), "#26323a", 1.4);
    K.flange(x, y + mw / 2 + 5, 0, 1, w);
  }
  function drawDucts() {
    const t = T(), mains = DUCTS.filter((d) => !d.end && !d.stack), joins = [];
    for (const d of DUCTS.filter((d) => d.end)) {
      const mn = mains.find((m) => m.id === d.id && onSeg(d.pts[0], m.pts)), hit = mn && onSeg(d.pts[0], mn.pts);
      if (hit && hit.end) { mn._elbow = d; continue; }
      if (hit) joins.push([d.pts[0][0], d.pts[0][1], d.w, mn.w]);
      K.duct(d.pts, d.w, running(d.id), t);
    }
    for (const d of DUCTS) {
      if (d.end) continue;
      if (d._elbow) {
        // магистраль переходит в отвод: тот же диаметр до переходника, далее врезка
        const e = d._elbow, [ex, ey] = e.pts[0], down = ey + d.w * 0.5 + 14;
        K.duct(e.pts.map((p, i) => (i === 0 ? [ex, down] : p)), e.w, running(e.id), t);
        K.duct([...d.pts.slice(0, -1), [ex, ey], [ex, down]], d.w, running(d.id), t);
        K.rr(ex - d.w / 2 - 1, down - 2, d.w + 2, 8, 2); K.skin("galv", K.shadeCyl(ex - d.w / 2, 0, ex + d.w / 2, 0), "#26323a", 1.2);
        const p = e.pts[e.pts.length - 1], q = e.pts[e.pts.length - 2]; if (Math.abs(p[0] - q[0]) < 1) K.aspNozzle(p[0], p[1] + 2, e.w + 6);
      } else K.duct(d.pts, d.w, running(d.id), t);
      if (!d.stack && (d.id === "Asp1" || d.id === "Asp2" || d.id === "AspGr") && A[d.id] && A[d.id].in && Math.hypot(d.pts[0][0] - A[d.id].in[0], d.pts[0][1] - A[d.id].in[1]) < 2) {
        const [x0, y0] = d.pts[0], [x1, y1] = d.pts[1], L = Math.hypot(x1 - x0, y1 - y0) || 1; K.flange(x0 + (x1 - x0) / L * 3, y0 + (y1 - y0) / L * 3, (x1 - x0) / L, (y1 - y0) / L, d.w);
      }
    }
    joins.forEach(([x, y, w, mw]) => tee(x, y, w, mw));
    for (const d of DUCTS) if (d.end && !mains.some((m) => m._elbow === d)) { const p = d.pts[d.pts.length - 1], q = d.pts[d.pts.length - 2]; if (Math.abs(p[0] - q[0]) < 1) K.aspNozzle(p[0], p[1] + 2, d.w + 6); }
    mains.forEach((m) => { m._elbow = null; });
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
  // фактура продукта: зерно/добавки — по названию сырья, продукты переработки — по виду
  const matPat = (k, prod) => K.material(k === "grain" || k === "add" ? prod : "", k || "grain", KIND[k] || KIND.grain);
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
    // смотровые окна обеих ветвей: восходящая (со стороны загрузки) — ковши с продуктом
    // идут вверх; нисходящая — пустые ковши после разгрузки идут вниз
    const wy0 = y + 90, wy1 = y + h - 76;
    if (m) m._belt = (m._belt || 0) + run * 3;
    const sp = 26, off = ((m && m._belt) || 0) % sp, upX = lx, dnX = rx;
    [[upX, 1], [dnX, -1]].forEach(([X, dir]) => {
      ctx.save(); ctx.beginPath(); ctx.rect(X + 4, wy0, legW - 8, wy1 - wy0); ctx.clip();
      cavity(X + 4, wy0, legW - 8, wy1 - wy0);
      const bx = dir > 0 ? X + 6 : X + legW - 10; ctx.fillStyle = "#3b3b36"; ctx.fillRect(bx, wy0, 4, wy1 - wy0);   // лента
      ctx.fillStyle = "rgba(255,255,255,.12)"; for (let yy = wy0 + ((dir > 0 ? -off : off) % 9 + 9) % 9; yy < wy1; yy += 9) ctx.fillRect(bx, yy, 4, 1);
      for (let k = -1; k < (wy1 - wy0) / sp + 2; k++) {
        const yy = dir > 0 ? wy1 - k * sp - off : wy0 + k * sp + off - sp;
        if (dir > 0) {
          K.path([[X + 9, yy], [X + legW - 6, yy - 3], [X + legW - 9, yy + 10], [X + 9, yy + 11]], true);
          ctx.fillStyle = "#c46f2a"; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = "#5a2f10"; ctx.stroke();   // ковш открыт вверх
          if (e) {
            const tt = 1 - (yy - wy0) / (wy1 - wy0), q = cellAt(e, tt) / (e.cap || 1);
            if (q > 0.03) { const hh = Math.min(7, 7 * q + 1); ctx.save(); ctx.beginPath(); ctx.ellipse(X + legW / 2 + 1, yy + 1, legW / 2 - 9, hh, 0, Math.PI, 0); ctx.translate(0, -(m ? m._belt : 0)); ctx.fillStyle = matPat(e.kinds[Math.min(e.N - 1, Math.max(0, Math.floor(tt * e.N)))] || "grain", e.prod); ctx.fill(); ctx.restore(); }
          }
        } else {
          K.path([[X + legW - 9, yy], [X + 6, yy + 3], [X + 9, yy - 10], [X + legW - 9, yy - 11]], true);
          ctx.fillStyle = "#b3611f"; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = "#5a2f10"; ctx.stroke();   // пустой ковш, перевёрнут
        }
      }
      ctx.restore();
      cutFrame(X + 4, wy0, legW - 8, wy1 - wy0);
      // стрелка направления хода ленты
      const ay = (wy0 + wy1) / 2, ax = X + legW + 8; ctx.fillStyle = run > 0.05 ? "#5cf08a" : "rgba(120,140,150,.6)"; ctx.beginPath();
      if (dir > 0) { ctx.moveTo(ax - 5, ay + 4); ctx.lineTo(ax + 5, ay + 4); ctx.lineTo(ax, ay - 6); } else { ctx.moveTo(ax - 5, ay - 4); ctx.lineTo(ax + 5, ay - 4); ctx.lineTo(ax, ay + 6); }
      ctx.closePath(); if (dir < 0 || X === upX) ctx.fill();
    });
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
    if (run < 0.99) { ctx.fillStyle = `rgba(6,12,18,${0.32 * (1 - run)})`; [lx, rx].forEach((X) => ctx.fillRect(X - 3, y + 60, legW + 6, h - 126)); }
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
    const ph = o.phase || 0, sg = o.sgn || 1, floor = wy + wh;
    // карман с продуктом: горка прижата к толкающей кромке (виток/скребок) и сползает вперёд;
    // фактура сдвигается вместе с карманом — видно, как едет каждое зерно
    const pocket = (xa, xb, push, hh, k, pr, mov) => {
      if (hh < 0.6) return;
      const xp = push, xf = push === xa ? xb : xa;
      ctx.beginPath(); ctx.moveTo(xp, floor); ctx.lineTo(xp, floor - hh);
      ctx.quadraticCurveTo(xp + (xf - xp) * 0.35, floor - hh * 1.02, xf, floor - hh * 0.35); ctx.lineTo(xf, floor); ctx.closePath();
      ctx.save(); ctx.translate(mov, 0); ctx.fillStyle = matPat(k, pr); ctx.fill(); ctx.restore();
      const g = ctx.createLinearGradient(0, floor - hh, 0, floor); g.addColorStop(0, "rgba(255,240,210,.12)"); g.addColorStop(1, "rgba(20,12,2,.4)"); ctx.fillStyle = g; ctx.fill();
    };
    if (chain) {
      // нижняя (рабочая) ветвь цепи со скребками, продукт волочится по днищу
      const pitch = 28, p0 = ((ph * pitch) % pitch + pitch) % pitch, mov = ph * pitch;
      // рабочая (нижняя) ветвь: продукт волочится по днищу перед скребком по ходу движения
      for (let X = wx - pitch + p0; X < wx + ww + pitch; X += pitch) {
        const [q, k, pr] = o.prod(X + pitch / 2);
        if (q > 0.01) pocket(X + 2, X + 2 + sg * pitch * 0.92, X + 2, wh * 0.66 * Math.min(1, q * 1.25), k, pr, mov);
      }
      for (let X = wx - pitch + p0; X < wx + ww + pitch; X += pitch) {
        ctx.fillStyle = "#1e2428"; ctx.fillRect(X, wy + wh * 0.42, pitch * 0.55, 4); ctx.fillRect(X + pitch * 0.45, wy + wh * 0.42 + 1, pitch * 0.55, 2);
        ctx.fillStyle = "#c8cfd3"; ctx.fillRect(X, wy + wh * 0.3, 4, wh * 0.66); ctx.fillStyle = "rgba(40,50,58,.6)"; ctx.fillRect(X + (sg > 0 ? 3 : 0), wy + wh * 0.3, 1, wh * 0.66);
      }
      // холостая (верхняя) ветвь идёт обратно
      const r0 = ((-ph * pitch) % pitch + pitch) % pitch;
      for (let X = wx - pitch + r0; X < wx + ww + pitch; X += pitch) { ctx.fillStyle = "#1e2428"; ctx.fillRect(X, wy + 3, pitch * 0.55, 3); ctx.fillStyle = "#8d969b"; ctx.fillRect(X, wy + 1, 3, 7); }
    } else {
      // шнек: задняя кромка витка (тёмная) → продукт → передняя кромка (светлая) → вал
      const pitch = small ? 12 : o.pitch || 22, p0 = ((ph * pitch) % pitch + pitch) % pitch;
      ctx.strokeStyle = "#56626a"; ctx.lineWidth = small ? 1.5 : 2.2;
      for (let X = wx - pitch + p0; X < wx + ww + pitch; X += pitch) { ctx.beginPath(); ctx.moveTo(X + pitch * 0.5, wy + wh); ctx.quadraticCurveTo(X + pitch * 0.75, wy + wh / 2, X + pitch, wy); ctx.stroke(); }
      // продукт в межвитковых карманах: виток толкает его по ходу, карман едет со скоростью шага
      const mov = ph * pitch;
      for (let X = wx - pitch + p0; X < wx + ww + pitch; X += pitch) {
        const [q, k, pr] = o.prod(X + pitch / 2);
        if (q > 0.01) { const xa = X + pitch * 0.5, xb = X + pitch * 1.5; pocket(xa, xb, sg > 0 ? xa : xb, wh * 0.82 * Math.min(1, q * 1.2), k, pr, mov); }
      }
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
    if (n.chain) return drawChain(n);
    const m = M[n.id], e = EL[n.id], f = faulty(n.id), t = T(), run = m ? m.spin : 0;
    const small = n.small, h = small ? 22 : n.h, cy = n.cy, x = n.x, w = n.w;
    m._ph = (m._ph || 0) + run * 0.22 * (n.reverse ? (V.GoR_Tr1 ? 1 : -1) : n.dir);
    const prod = (X) => {
      if (e) { const tt = n.dir > 0 ? X / w : 1 - X / w; return [Math.min(1, cellAt(e, tt) / (e.cap || 1)), e.kinds[Math.max(0, Math.min(e.N - 1, Math.floor(tt * e.N)))], e.prod]; }
      if (n.dozer && run > 0.05) { const c = CT["b" + n.bunk]; return [0.45, n.bunk > 200 ? "add" : "grain", c && c.prod]; }
      return [0, "grain"];
    };
    // опоры
    if (!small) [x + 30, x + w - 34].forEach((X) => { ctx.fillStyle = "#56636c"; ctx.fillRect(X, cy + h / 2, 6, 14); ctx.fillRect(X - 6, cy + h / 2 + 12, 18, 4); });
    ctx.save(); ctx.translate(x, cy);
    conveyorBody(w, h, { chain: n.chain, small, phase: m._ph, prod, sgn: n.reverse ? (V.GoR_Tr1 ? 1 : -1) : n.dir });
    if (run < 0.99) { K.rr(-3, -h / 2 - 3, w + 6, h + 6, small ? 4 : 6); ctx.fillStyle = `rgba(6,12,18,${0.32 * (1 - run)})`; ctx.fill(); }
    ctx.restore();
    // патрубки загрузки / выгрузки
    if (!small && !n.chain) {
      const ix = n.dir > 0 ? x + 22 : x + w - 22, ox = n.dir > 0 ? x + w - 16 : x + 16;
      K.rr(ix - 13, cy - h / 2 - 8, 26, 9, 1); K.skin("galv", null, "#26323a", 1.2);
      K.rr(ox - 11, cy + h / 2 - 1, 22, 8, 1); K.skin("galv", null, "#26323a", 1.2);
    }
    // привод
    if (n.motorAt === "mid") K.gearMotor(x + w / 2, cy - h / 2 - 16, 0.6, { dir: 1, run, t });
    else if (small) { const sd = n.motorOut ? -n.dir : n.dir; if (n.dozer || n.pch) K.gearMotor(sd > 0 ? x - 6 : x + w + 6, cy, 0.42, { dir: sd > 0 ? -1 : 1, run, t }); }
    else K.gearMotor(n.dir > 0 ? x - 8 : x + w + 8, cy, n.chain ? 0.7 : 0.62, { dir: n.dir > 0 ? -1 : 1, run, t });
    if (n.pch && !small) { ctx.font = "800 13px Raleway"; ctx.fillStyle = "#0a4c9a"; ctx.textAlign = "left"; ctx.fillText("ПЧ", x + 4, cy - h / 2 - 6); }
    if (f) faultFrame(x, cy - h / 2, w, h);
    // патрубки питателей с ПЧ: загрузка сверху, выпуск снизу — точно под/над трубами
    if (small && n.pch && A[n.id]) {
      const ix = A[n.id].in[0], ox = A[n.id].out[0], ty = cy - h / 2, by = cy + h / 2;
      K.rr(ix - 9, ty - 8, 18, 9, 1); K.skin("galv", K.shadeCyl(ix - 9, 0, ix + 9, 0), "#26323a", 1.2);
      K.rr(ox - 9, by - 1, 18, 9, 1); K.skin("galv", K.shadeCyl(ox - 9, 0, ox + 9, 0), "#26323a", 1.2);
    }
    lampMount(n.dir > 0 ? x + w - 12 : x + 12, cy + h / 2, cy + h / 2 + (small ? 8 : 10), n.id, small ? 4 : 5);
  }
  /* ---------- цепной скребковый транспортёр (ТСЦ): секционный короб с крышкой и фланцами,
     смотровые окна по секциям (цепь из пластин, скребки, продукт перед скребком, холостая ветвь),
     натяжная секция с винтами, приводная головка со звёздочкой и выпуском, опоры. */
  const CHAIN_SUP = { Tr51100: "trestle", Tr51200: "hang", Tr40700: "feet" };
  // Где у ТЦ загрузка и выпуск. out: "end" — торцевой носок головки; "v" — патрубок вниз у головки;
  // outs — дополнительные выпуски вниз (мировые x) над шиберами.
  const CHAIN_IO = { Tr51100: { out: "v" }, Tr51200: { out: "end" }, Tr40700: { out: "end" },
    Tr1L: { outs: [1215, 1343, 1471] }, Tr1R: { outs: [1619, 1747, 1875] } };
  function chainGeom(n) {
    const x1 = n.x1, x2 = n.cx2 ?? n.x2, y1 = n.cy1 ?? n.y1 ?? n.cy, y2 = n.cy2 ?? n.y2 ?? n.cy, h = n.kind === "scraper" ? 40 : Math.max(36, n.h0 || n.h);
    const ang = Math.atan2(y2 - y1, x2 - x1), len = Math.hypot(x2 - x1, y2 - y1), ux = Math.cos(ang), uy = Math.sin(ang);
    const flip = ux < -1e-6, nx = flip ? uy : -uy, ny = flip ? -ux : ux;
    const W = (X, Y) => [x1 + ux * X + nx * Y, y1 + uy * X + ny * Y];
    const Xof = (wx) => (wx - x1) / ux;   // проекция мирового x на ось (для не вертикальных)
    return { x1, y1, x2, y2, h, ang, len, ux, uy, flip, nx, ny, W, Xof };
  }
  // Точки подключения труб — на патрубках корпуса (вызывается до построения труб).
  function chainAnchors() {
    for (const id of Object.keys(CHAIN_IO)) {
      const n = ND[id], a = A[id]; if (!n || !a) continue;
      const g = chainGeom(n), io = CHAIN_IO[id], set = (dst, p) => { dst[0] = p[0]; dst[1] = p[1]; };
      const top = (X) => { const p = g.W(X, g.flip ? g.h / 2 : -g.h / 2); return [p[0], Math.min(p[1], g.W(X, g.flip ? -g.h / 2 : g.h / 2)[1]) - 10]; };
      if (a.in) { const X = Math.max(14, Math.min(g.len - 80, g.Xof(a.in[0]))); n._inX = X; set(a.in, top(X)); }
      if (io.out === "end") { n._outX = g.len; set(a.out, g.W(g.len + 18, 5)); }
      else if (io.out === "v") { const X = g.len - 30, p = g.W(X, g.h / 2); n._outX = X; set(a.out, [p[0], p[1] + 12]); }
    }
  }
  function sprocket(cx, cy, r, ang) {
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(ang);
    ctx.beginPath(); ctx.arc(0, 0, r + 4, 0, TAU); ctx.fillStyle = "#0f1418"; ctx.fill();
    const nT = 10; ctx.beginPath();
    for (let k = 0; k < nT * 2; k++) { const a = (k / (nT * 2)) * TAU, rr = k % 2 ? r * 0.8 : r; ctx.lineTo(Math.cos(a - 0.08) * rr, Math.sin(a - 0.08) * rr); ctx.lineTo(Math.cos(a + 0.08) * rr, Math.sin(a + 0.08) * rr); }
    ctx.closePath(); const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, 1, 0, 0, r); g.addColorStop(0, "#b4bec4"); g.addColorStop(1, "#4b555c");
    ctx.fillStyle = g; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = "#1b2227"; ctx.stroke();
    for (let k = 0; k < 4; k++) { const a = k * TAU / 4; ctx.beginPath(); ctx.arc(Math.cos(a) * r * 0.48, Math.sin(a) * r * 0.48, r * 0.14, 0, TAU); ctx.fillStyle = "#20282d"; ctx.fill(); }
    ctx.beginPath(); ctx.arc(0, 0, r * 0.24, 0, TAU); ctx.fillStyle = "#d4dadd"; ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#2a3238"; ctx.fillRect(-r * 0.05, -r * 0.24, r * 0.1, r * 0.12);
    ctx.restore();
  }
  function chainLinks(x0, x1, y, step, off) {
    for (let X = x0 - step * 2 + off, i = Math.floor((x0 - step * 2 + off) / step); X < x1 + step; X += step, i++) {
      if (i % 2 === 0) { K.rr(X - 1.5, y - 3.6, step + 3, 7.2, 3.6); ctx.fillStyle = "#4a545a"; ctx.fill(); ctx.lineWidth = 0.8; ctx.strokeStyle = "#151b1f"; ctx.stroke(); ctx.fillStyle = "rgba(255,255,255,.22)"; ctx.fillRect(X + 1, y - 2.6, step - 2, 1.2); }
      else { K.rr(X, y - 2.6, step, 5.2, 2.6); ctx.fillStyle = "#8a949a"; ctx.fill(); ctx.lineWidth = 0.7; ctx.strokeStyle = "#20282d"; ctx.stroke(); }
      ctx.beginPath(); ctx.arc(X, y, 1.7, 0, TAU); ctx.fillStyle = "#d6dcdf"; ctx.fill();
    }
  }
  function drawChain(n) {
    const m = M[n.id], e = EL[n.id], f = faulty(n.id), t = T(), run = m ? m.spin : 0;
    const G = chainGeom(n), { x1, y1, x2, y2, h, ang, len, ux, flip } = G, io = CHAIN_IO[n.id] || {};
    m._ph = (m._ph || 0) + run * 0.075;
    const pitch = 30, mov = m._ph * pitch, TL = 48, HL = 66, Lm = Math.max(40, len - TL - HL);
    const nSec = Math.max(1, Math.round(Lm / 150)), secL = Lm / nSec;
    const W = G.W;
    const prod = (X) => (e ? [Math.min(1, cellAt(e, X / len) / (e.cap || 1)), e.kinds[Math.max(0, Math.min(e.N - 1, Math.floor(X / len * e.N)))], e.prod] : [0, "grain"]);
    const flX = []; for (let k = 0; k <= nSec; k++) flX.push(TL + k * secL);
    // ---- корпус в локальной системе: X вдоль хода цепи, +Y — днище
    ctx.save(); ctx.translate(x1, y1); ctx.rotate(ang); if (flip) ctx.scale(1, -1);
    K.rr(TL - 2, -h / 2, Lm + 4, h, 2); K.skin("galv", K.shadeCyl(0, -h / 2, 0, h / 2, 0.6), "#26323a", 1.8);
    K.rr(TL - 4, -h / 2 - 6, Lm + 8, 7, 1.5); K.skin("galv", null, "#26323a", 1.2);
    ctx.fillStyle = "rgba(255,255,255,.35)"; ctx.fillRect(TL, -h / 2 - 5, Lm, 1.5);
    ctx.fillStyle = "#3d474e"; ctx.fillRect(TL - 2, h / 2 - 3, Lm + 4, 3);
    const yC = h / 2 - h * 0.34, yR = -h / 2 + h * 0.24, floorY = h / 2 - 5;
    for (let k = 0; k < nSec; k++) {
      const wx = TL + k * secL + 11, ww = secL - 22, wy = -h / 2 + 5, wh = h - 9;
      if (ww < 16) continue;
      ctx.save(); ctx.beginPath(); ctx.rect(wx, wy, ww, wh); ctx.clip(); cavity(wx, wy, ww, wh);
      ctx.fillStyle = "#59636a"; ctx.fillRect(wx, floorY, ww, 4);
      const p0 = ((mov % pitch) + pitch) % pitch;
      for (let X = wx - pitch + p0; X < wx + ww + pitch; X += pitch) {   // продукт перед скребками
        const [q, kd, pr] = prod(X + pitch / 2); if (q < 0.01) continue;
        const hh = (floorY - yC + h * 0.16) * Math.min(1, 0.25 + q * 1.1), xb = X + pitch * 0.96;
        ctx.beginPath(); ctx.moveTo(X + 2, floorY); ctx.lineTo(X + 2, floorY - hh); ctx.quadraticCurveTo(X + pitch * 0.45, floorY - hh * 1.04, xb, floorY - hh * 0.3); ctx.lineTo(xb, floorY); ctx.closePath();
        ctx.save(); ctx.translate(mov, 0); ctx.fillStyle = matPat(kd, pr); ctx.fill(); ctx.restore();
        ctx.fillStyle = "rgba(20,12,2,.25)"; ctx.fill();
      }
      { const [q0, kd0, pr0] = prod(wx + ww / 2); if (q0 > 0.01) { ctx.save(); ctx.translate(mov, 0); ctx.fillStyle = matPat(kd0, pr0); ctx.fillRect(wx - mov, floorY - 3 - 3 * Math.min(1, q0), ww, 3 + 3 * Math.min(1, q0)); ctx.restore(); } }
      chainLinks(wx, wx + ww, yC, pitch / 2, p0);
      for (let X = wx - pitch + p0; X < wx + ww + pitch; X += pitch) {   // скребки рабочей ветви
        const g = ctx.createLinearGradient(X - 3, 0, X + 3, 0); g.addColorStop(0, "#e2e7ea"); g.addColorStop(1, "#7f898f");
        ctx.fillStyle = g; ctx.fillRect(X - 2.5, yC - 6, 5, floorY - yC + 5); ctx.strokeStyle = "#1b2227"; ctx.lineWidth = 0.8; ctx.strokeRect(X - 2.5, yC - 6, 5, floorY - yC + 5);
      }
      const r0 = (((-mov) % pitch) + pitch) % pitch;   // холостая ветвь идёт обратно
      ctx.fillStyle = "#4e585e"; ctx.fillRect(wx, yR + 4.5, ww, 2.5);
      for (let X = wx - pitch + r0; X < wx + ww + pitch; X += pitch) { ctx.fillStyle = "#a9b3b8"; ctx.fillRect(X - 2.5, yR - 9, 5, 12); ctx.strokeStyle = "#1b2227"; ctx.lineWidth = 0.8; ctx.strokeRect(X - 2.5, yR - 9, 5, 12); }
      chainLinks(wx, wx + ww, yR, pitch / 2, r0);
      const gl = ctx.createLinearGradient(wx, wy, wx + ww * 0.6, wy + wh); gl.addColorStop(0, "rgba(255,255,255,.12)"); gl.addColorStop(0.35, "rgba(255,255,255,0)"); ctx.fillStyle = gl; ctx.fillRect(wx, wy, ww, wh);
      ctx.restore(); cutFrame(wx, wy, ww, wh, 2);
    }
    flX.forEach((X) => { ctx.fillStyle = "#7d8a93"; ctx.fillRect(X - 3.5, -h / 2 - 8, 7, h + 11); ctx.strokeStyle = "#1f292f"; ctx.lineWidth = 1; ctx.strokeRect(X - 3.5, -h / 2 - 8, 7, h + 11); K.bolts(X, -h / 2 - 3, X, h / 2 - 3, 4, 1.3); });
    // натяжная секция: винты натяжения, загрузочный патрубок, звёздочка
    [-h * 0.27, h * 0.27].forEach((Y) => { ctx.fillStyle = "#a3adb3"; ctx.fillRect(-24, Y - 2, 28, 4); ctx.fillStyle = "rgba(0,0,0,.35)"; for (let X = -22; X < 2; X += 3) ctx.fillRect(X, Y - 2, 1, 4); ctx.fillStyle = "#5d686f"; ctx.fillRect(-21, Y - 5, 6, 10); ctx.strokeStyle = "#1b2227"; ctx.lineWidth = 0.8; ctx.strokeRect(-21, Y - 5, 6, 10); });
    K.rr(-2, -h / 2 - 9, TL + 2, h + 18, 3); K.skin("galv", K.shadeFlat(-2, -h / 2 - 9, TL + 2, h + 18), "#26323a", 1.8);
    const rs = h * 0.34; sprocket(TL / 2, 0, rs, mov / rs);
    // приводная головка: звёздочка, подшипниковый узел, выпускной патрубок
    const hx = len - HL; K.rr(hx, -h / 2 - 11, HL + 4, h + 22, 4); K.skin("galv", K.shadeFlat(hx, -h / 2 - 11, HL + 4, h + 22), "#26323a", 2);
    K.bolts(hx + 6, -h / 2 - 6, hx + HL - 2, -h / 2 - 6, 4, 1.4); K.bolts(hx + 6, h / 2 + 6, hx + HL - 2, h / 2 + 6, 4, 1.4);
    if (io.out === "end") {   // торцевой разгрузочный носок головки
      K.rr(len + 2, -9, 16, 26, 1); K.skin("galv", K.shadeCyl(0, -9, 0, 17), "#26323a", 1.3);
      ctx.fillStyle = "#7d8a93"; ctx.fillRect(len + 16, -12, 4, 32); ctx.strokeStyle = "#1f292f"; ctx.lineWidth = 1; ctx.strokeRect(len + 16, -12, 4, 32);
    }
    const rh = h * 0.42; sprocket(hx + HL / 2 + 2, 0, rh, mov / rh);
    if (run < 0.99) { K.rr(-2, -h / 2 - 11, len + 6, h + 22, 4); ctx.fillStyle = `rgba(6,12,18,${0.32 * (1 - run)})`; ctx.fill(); }
    ctx.restore();
    // вертикальные патрубки: загрузка сверху, выпуски вниз (с фланцем), ровно под/над трубами
    const stub = (X, down) => {
      const a = W(X, down ? h / 2 : -h / 2), b = W(X, down ? -h / 2 : h / 2), ys = down ? Math.max(a[1], b[1]) - 4 : Math.min(a[1], b[1]) + 4, x = a[0];
      const y0 = down ? ys : ys - 14, hh = 14;
      K.rr(x - 11, y0, 22, hh, 1); K.skin("galv", K.shadeCyl(x - 11, 0, x + 11, 0), "#26323a", 1.3);
      const fy = down ? y0 + hh - 3 : y0; ctx.fillStyle = "#7d8a93"; ctx.fillRect(x - 15, fy, 30, 4); ctx.strokeStyle = "#1f292f"; ctx.lineWidth = 1; ctx.strokeRect(x - 15, fy, 30, 4);
    };
    if (n._inX != null) stub(n._inX, false);
    if (io.out === "v" && n._outX != null) stub(n._outX, true);
    (io.outs || []).forEach((wx) => stub(G.Xof(wx), true));
    // мотор-редуктор на консоли над приводной головкой
    const [mx, my] = W(len - HL / 2 + 2, -h / 2 - 24), [bx, by] = W(len - HL / 2 + 2, -h / 2 - 11);
    ctx.strokeStyle = "#4c565d"; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(mx, my + 6); ctx.stroke();
    K.gearMotor(mx, my, 0.6, { dir: ux >= 0 ? -1 : 1, run, t });
    if (f) faultFrame(Math.min(x1, x2), Math.min(y1, y2) - h / 2, Math.abs(x2 - x1), Math.abs(y2 - y1) + h);
    const [lx, ly] = W(len - HL + 10, h / 2 + 2); bezelLed(lx, ly, n.id, 5);
  }
  // Опоры ТЦ. Стойка крепится к днищу короба через приварную косынку (по уклону
  // короба сверху, горизонтальная площадка снизу) на болтах; внизу — опорная плита на полу.
  // trestle — эстакада с раскосами; floor — стойки до пола (за соседними механизмами);
  // hang — подвески к перекрытию.
  const CHAIN_FLOOR = { Tr40700: 2420, Tr51100: 2420 };
  function chainSupports(n) {
    const G = chainGeom(n), { y1, y2, h, len, W } = G, sup = CHAIN_SUP[n.id]; if (!sup) return;
    const TL = 48, HL = 66, Lm = Math.max(40, len - TL - HL), nSec = Math.max(1, Math.round(Lm / 150)), secL = Lm / nSec;
    const post = (X, floor) => {
      // опорный лист, приваренный к днищу короба (заходит под корпус), стойка — от его нижней кромки
      const q = [W(X - 13, h / 2 - 8), W(X + 13, h / 2 - 8), W(X + 13, h / 2 + 12), W(X - 13, h / 2 + 12)], c = W(X, h / 2 + 12), cx = c[0];
      const top = Math.min(q[2][1], q[3][1]) + 2;
      ctx.fillStyle = "#56626a"; ctx.fillRect(cx - 5, top, 10, floor - top); ctx.fillStyle = "#8c979e"; ctx.fillRect(cx - 1.5, top, 3, floor - top);
      ctx.strokeStyle = "#1f282d"; ctx.lineWidth = 1; ctx.strokeRect(cx - 5, top, 10, floor - top);
      K.path(q, true); ctx.fillStyle = "#4c575e"; ctx.fill(); ctx.stroke();
      const m1 = W(X - 6, h / 2 + 6), m2 = W(X + 6, h / 2 + 6); [m1, m2].forEach(([bx, by]) => { ctx.beginPath(); ctx.arc(bx, by, 1.6, 0, TAU); ctx.fillStyle = "#c3cbd0"; ctx.fill(); });
      ctx.fillStyle = "#3f4a51"; ctx.fillRect(cx - 15, floor - 4, 30, 6); K.bolts(cx - 10, floor - 1, cx + 10, floor - 1, 2, 1.3);
      return [cx, top];
    };
    if (sup === "trestle") {
      const floor = CHAIN_FLOOR[n.id] || Math.max(y1, y2) + 34, cols = [0.2, 0.5, 0.78].map((q) => post(len * q, floor));
      ctx.lineWidth = 2; ctx.strokeStyle = "#6b767d";
      for (let k = 0; k + 1 < cols.length; k++) { const a = cols[k], b = cols[k + 1]; ctx.beginPath(); ctx.moveTo(a[0], a[1] + 30); ctx.lineTo(b[0], floor - 8); ctx.moveTo(b[0], b[1] + 30); ctx.lineTo(a[0], floor - 8); ctx.stroke(); }
    } else if (sup === "hang") {
      for (let k = 0; k <= nSec; k++) { const [hx, hy] = W(TL + k * secL, -h / 2 - 6), top = hy - 52;
        ctx.strokeStyle = "#7a858c"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(hx - 7, hy); ctx.lineTo(hx - 7, top); ctx.moveTo(hx + 7, hy); ctx.lineTo(hx + 7, top); ctx.stroke();
        ctx.fillStyle = "#4c565d"; ctx.fillRect(hx - 11, hy - 30, 22, 7); ctx.fillRect(hx - 16, top - 5, 32, 6);
        ctx.strokeStyle = "#1f282d"; ctx.lineWidth = 1; ctx.strokeRect(hx - 16, top - 5, 32, 6); K.bolts(hx - 9, top - 2, hx + 9, top - 2, 2, 1.3); }
    } else if (sup === "feet") {
      const floor = CHAIN_FLOOR[n.id] || Math.max(y1, y2) + 60;
      for (let k = 0; k <= nSec; k++) post(TL + k * secL, floor);
    }
  }
  // Перекрытие под просеивателем 40950: машина стоит на нём опорами рамы,
  // трубы выпусков проходят сквозь проёмы. Справа — линия обрыва (перекрытие продолжается).
  function drawSifterFloor() {
    const n = ND.Pros, z = n && n._spr, nr = ND.Nor6; if (!z || !nr) return;
    const y = z.P([0.5, 1])[1], x0 = nr.x + nr.w / 2, x1 = z.P([1, 1])[0] + 26, th = 18;
    ctx.fillStyle = "#4b555c"; ctx.fillRect(x0, y + th, x1 - x0, 7); ctx.fillStyle = "#6e7a82"; ctx.fillRect(x0, y + th, x1 - x0, 2);   // балка перекрытия
    for (let X = x0 + 30; X < x1 - 10; X += 46) { ctx.fillStyle = "#56626a"; ctx.fillRect(X, y + th, 3, 7); }
    ctx.fillStyle = K.pat("concrete") || "#8d9297"; ctx.fillRect(x0, y, x1 - x0, th);
    ctx.fillStyle = "rgba(0,0,0,.18)"; ctx.fillRect(x0, y + th - 4, x1 - x0, 4); ctx.fillStyle = "rgba(255,255,255,.25)"; ctx.fillRect(x0, y, x1 - x0, 1.5);
    ctx.strokeStyle = "#3d454b"; ctx.lineWidth = 1.2; ctx.strokeRect(x0, y, x1 - x0, th);
    ctx.beginPath(); ctx.moveTo(x1, y - 6); ctx.lineTo(x1, y + 3); ctx.lineTo(x1 + 6, y + 5); ctx.lineTo(x1 - 6, y + 9); ctx.lineTo(x1, y + 11); ctx.lineTo(x1, y + th + 12);
    ctx.strokeStyle = "#3d454b"; ctx.lineWidth = 1.4; ctx.stroke();
  }
  function drawStructs() {
    drawSifterFloor();
    for (const n of Object.values(ND)) if ((n.chain || (n.kind === "scraper" && !n.screwType)) && CHAIN_SUP[n.id]) chainSupports(n);
  }
  function drawScraper(n) {
    if (!n.screwType) return drawChain(n);
    const m = M[n.id], e = EL[n.id], f = faulty(n.id), t = T(), run = m ? m.spin : 0;
    const { x1, y1, x2, y2 } = n, ang = Math.atan2(y2 - y1, x2 - x1), len = Math.hypot(x2 - x1, y2 - y1), h = 40;
    m._ph = (m._ph || 0) + run * 0.22;
    const prod = (X) => (e ? [Math.min(1, cellAt(e, X / len) / (e.cap || 1)), e.kinds[Math.max(0, Math.min(e.N - 1, Math.floor(X / len * e.N)))], e.prod] : [0, "grain"]);
    ctx.save(); ctx.translate(x1, y1); ctx.rotate(ang);
    conveyorBody(len, h, { chain: !n.screwType, phase: m._ph, prod, pitch: 26, sgn: 1 });
    if (run < 0.99) { K.rr(-3, -h / 2 - 3, len + 6, h + 6, 4); ctx.fillStyle = `rgba(6,12,18,${0.32 * (1 - run)})`; ctx.fill(); }
    ctx.restore();
    K.gearMotor(x2 + Math.cos(ang) * 10, y2 + Math.sin(ang) * 10 - 4, 0.66, { dir: Math.cos(ang) >= 0 ? 1 : -1, run, t });
    if (f) faultFrame(Math.min(x1, x2), Math.min(y1, y2) - h / 2, Math.abs(x2 - x1), Math.abs(y2 - y1) + h);
    { const lx = x2 - Math.cos(ang) * 20, ly = y2 - Math.sin(ang) * 20; lampMount(lx, ly + h / 2, ly + h / 2 + 10, n.id, 5); }
  }

  /* ============================================================ бункеры */
  function bunkerFill(n) { const c = CT[n.level]; return c ? Math.max(0, Math.min(1.04, c.mass / c.cap)) : 0; }
  function drawBunker(n) {
    const c = CT[n.level], x = n.x, y = n.y, w = n.w, h = n.h;
    const outs = n.outs, ecc = n.ecc, cone = ecc ? h * 0.58 : outs ? h * 0.42 : Math.min(w * 0.55, h * 0.3), body = h - cone, nz = outs || ecc ? 22 : Math.max(18, w * 0.16), ridge = y + body - 34;
    const shape = () => {
      ctx.beginPath(); ctx.moveTo(x, y + 8); ctx.lineTo(x + w, y + 8); ctx.lineTo(x + w, y + body);
      if (ecc) { ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - nz, y + h); }
      else if (outs) { const [o1, o2] = outs; ctx.lineTo(o2 + nz / 2, y + h); ctx.lineTo(o2 - nz / 2, y + h); ctx.lineTo(x + w / 2, ridge); ctx.lineTo(o1 + nz / 2, y + h); ctx.lineTo(o1 - nz / 2, y + h); }
      else { ctx.lineTo(x + w / 2 + nz / 2, y + h); ctx.lineTo(x + w / 2 - nz / 2, y + h); }
      ctx.lineTo(x, y + body); ctx.closePath();
    };
    // разрез: полость, продукт с откосом, стенки по краям
    const fr = bunkerFill(n);
    ctx.save(); shape(); ctx.clip();
    cavity(x, y, w, h);
    if (c) heap(n, c, fr, x, y, w, h, body, nz);
    // внутренняя тень стенок
    const gs = ctx.createLinearGradient(x, 0, x + w, 0); gs.addColorStop(0, "rgba(0,0,0,.45)"); gs.addColorStop(0.12, "rgba(0,0,0,0)"); gs.addColorStop(0.88, "rgba(0,0,0,0)"); gs.addColorStop(1, "rgba(0,0,0,.45)");
    ctx.fillStyle = gs; ctx.fillRect(x, y, w, h);
    ctx.restore();
    // стенки из оцинкованного листа (видна толщина), рёбра жёсткости, швы конуса
    const wall = 6;
    [[x, y + 8, wall, body - 8], [x + w - wall, y + 8, wall, body - 8]].forEach(([X, Y, W, H]) => { ctx.fillStyle = K.pat("galv"); ctx.fillRect(X, Y, W, H); ctx.fillStyle = "rgba(0,0,0,.2)"; ctx.fillRect(X, Y, W, H); });
    shape(); ctx.lineWidth = 2.6; ctx.strokeStyle = "#26323a"; ctx.stroke();
    for (let yy = y + 60; yy < y + body - 10; yy += 70) { ctx.fillStyle = "#6e7b84"; ctx.fillRect(x - 5, yy, 7, 9); ctx.fillRect(x + w - 2, yy, 7, 9); }
    if (!outs && !ecc) { ctx.strokeStyle = "rgba(200,210,216,.5)"; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x + 3, y + body); ctx.lineTo(x + w / 2 - nz / 2 + 2, y + h - 2); ctx.moveTo(x + w - 3, y + body); ctx.lineTo(x + w / 2 + nz / 2 - 2, y + h - 2); ctx.stroke(); }
    ctx.fillStyle = "#7d8a93"; ctx.fillRect(x - 3, y + body - 3, 8, 6); ctx.fillRect(x + w - 5, y + body - 3, 8, 6);
    // крыша с люком
    ctx.beginPath(); ctx.rect(x - 4, y, w + 8, 10); K.skin("galv", K.shadeFlat(x, y, w, 10), "#26323a", 1.4);
    K.bolts(x, y + 5, x + w, y + 5, Math.max(3, Math.round(w / 22)), 1.3);
    if (w >= 90) { K.rr(x + w * 0.62, y - 7, w * 0.22, 8, 2); K.skin("galv", null, "#26323a", 1); }
    // выпускной фланец
    (ecc ? [x + w - nz / 2] : outs || [x + w / 2]).forEach((ox) => { ctx.fillStyle = "#7d8a93"; ctx.fillRect(ox - nz / 2 - 4, y + h - 3, nz + 8, 6); ctx.strokeStyle = "#1f292f"; ctx.lineWidth = 1; ctx.strokeRect(ox - nz / 2 - 4, y + h - 3, nz + 8, 6); });
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
  // Насыпь в бункере. Продукт лежит столбиками по ширине бункера, в каждом —
  // стопка слоёв со своим сырьём. Загрузка идёт струёй в точку загрузки,
  // выгрузка — из выпуска по центру (сверху образуется воронка). После каждого
  // шага склоны осыпаются до угла естественного откоса этого продукта,
  // поэтому горох даёт пологий конус, а мел и шроты — крутой.
  function heap(n, c, fr, x, y, w, h, body, nz) {
    const cxm = x + w / 2;
    if (n.ecc) {
      const ox = x + w - nz;
      return heapG(n, c, fr, { x, w, top: y + 8, bot: y + h, nz, cx: ox + nz / 2, inX: A.TrPBD ? A.TrPBD.out[0] : undefined, floor: (X) => (X >= ox ? y + h - 1 : y + body + (h - body) * (X - x) / (ox - x)) });
    }
    if (n.outs) {
      const [o1, o2] = n.outs, ridge = y + body - 34, lin = (X, xa, ya, xb, yb) => ya + (yb - ya) * (X - xa) / (xb - xa);
      return heapG(n, c, fr, { x, w, top: y + 8, bot: y + h, nz, cx: cxm, outs: n.outs, floor: (X) => {
        if (X < o1 - nz / 2) return lin(X, x, y + body, o1 - nz / 2, y + h);
        if (X <= o1 + nz / 2) return y + h - 1;
        if (X < cxm) return lin(X, o1 + nz / 2, y + h, cxm, ridge);
        if (X < o2 - nz / 2) return lin(X, cxm, ridge, o2 - nz / 2, y + h);
        if (X <= o2 + nz / 2) return y + h - 1;
        return lin(X, o2 + nz / 2, y + h, x + w, y + body);
      } });
    }
    return heapG(n, c, fr, { x, w, top: y + 8, bot: y + h, nz, cx: cxm, floor: (X) => { const d = Math.abs(X - cxm); return d <= nz / 2 ? y + h - 1 : y + body + (h - body) * Math.max(0, Math.min(1, (w / 2 - d) / (w / 2 - nz / 2))); } });
  }
  // geo: x, w — ширина насыпи; top — верх ёмкости; bot — низ (для тени);
  // floor(X) — дно/стенки по X; cx, nz — центр и ширина выпуска; inX — точка загрузки
  function heapG(n, c, fr, geo) {
    const { x, w, top } = geo, N = Math.max(12, Math.round(w / 4)), dx = w / N, cxm = geo.cx, nz = geo.nz, t = T(), y = top - 8, h = geo.bot - y;
    let st = n._heap;
    if (!st || st.N !== N || st.x !== x) {
      st = n._heap = { N, x, F: new Float32Array(N), H: new Float32Array(N), L: [], cap: 0, inT: -9, outT: -9, debt: 0 };
      for (let i = 0; i < N; i++) {
        st.F[i] = Math.max(top + 1, geo.floor(x + (i + 0.5) * dx));
        st.cap += (st.F[i] - top) * dx; st.L[i] = [];
      }
      // начальная засыпка: уровень подбирается под массу, сверху — пологий конус
      const A = Math.min(1, fr) * st.cap; let lo = top, hi = y + h;
      for (let k = 0; k < 30; k++) { const mid = (lo + hi) / 2; let a = 0; for (let i = 0; i < N; i++) a += Math.max(0, st.F[i] - mid) * dx; if (a > A) lo = mid; else hi = mid; }
      for (let i = 0; i < N; i++) { const hh = Math.max(0, st.F[i] - lo); st.H[i] = hh; if (hh > 0) st.L[i].push([c.prod || "", c.kind, hh]); }
    }
    const H = st.H, F = st.F, L = st.L;
    const addTop = (i, pr, k, a) => { const tp = L[i][L[i].length - 1]; if (tp && tp[0] === pr) tp[2] += a; else L[i].push([pr, k, a]); H[i] += a; };
    const takeTop = (i, a, out) => { let got = 0; while (a > 1e-6 && L[i].length) { const tp = L[i][L[i].length - 1], q = Math.min(a, tp[2]); tp[2] -= q; a -= q; got += q; H[i] -= q; if (out) out.push([tp[0], tp[1], q]); if (tp[2] <= 1e-6) L[i].pop(); } if (H[i] < 0) H[i] = 0; return got; };
    let cur = 0; for (let i = 0; i < N; i++) cur += H[i]; cur *= dx;
    const want = Math.min(1, fr) * st.cap, d = want - cur;
    st.inX = geo.inX != null ? geo.inX : st.inX;
    if (d > 0.02 * dx) {            // загрузка струёй
      const ii = Math.max(0, Math.min(N - 1, Math.floor(((st.inX != null ? st.inX : cxm) - x) / dx)));
      addTop(ii, c.prod || "", c.kind, d / dx); st.inT = t;
    } else if (d < -0.02 * dx) {    // выгрузка: из колонн над выпуском
      st.debt += -d / dx; st.outT = t;
    }
    if (st.debt > 1e-4) {
      const r0 = Math.max(1, Math.round(nz / dx / 2)), outX = geo.outs || [cxm];
      for (let pass = 0; pass < 2 && st.debt > 1e-4; pass++) {
        const per = st.debt / (2 * r0 * outX.length);
        for (const ox of outX) { const c0 = Math.max(0, Math.min(N - 1, Math.floor((ox - x) / dx))); for (let i = c0 - r0; i < c0 + r0; i++) if (i >= 0 && i < N) st.debt -= takeTop(i, per); }
      }
      if (cur < 1) st.debt = 0;
    }
    // осыпание склонов до угла откоса (продукт верхнего слоя)
    const spec = K.matSpec(c.prod, c.kind), rep = ((spec && spec.repose) || 0.6) * dx;
    const passes = Math.abs(d) > 40 * dx ? 80 : 14, mv = [];
    for (let k = 0; k < passes; k++) {
      let moved = false;
      for (let dir = 0; dir < 2; dir++) for (let j = 0; j < N - 1; j++) {
        const i = dir ? N - 2 - j : j, S0 = F[i] - H[i], S1 = F[i + 1] - H[i + 1], diff = S1 - S0;
        if (Math.abs(diff) <= rep) continue;
        const from = diff > 0 ? i : i + 1, to = diff > 0 ? i + 1 : i, a = Math.min(H[from], (Math.abs(diff) - rep) / 2);
        if (a < 1e-3) continue;
        mv.length = 0; takeTop(from, a, mv); for (const [pr, kk, q] of mv) addTop(to, pr, kk, q); moved = true;
      }
      if (!moved) break;
    }
    // отрисовка: слои по колоннам, затем сглаженная поверхность и тень
    // слои одного сырья собираются в один контур — одна заливка на продукт
    const groups = new Map();
    for (let i = 0; i < N; i++) {
      let yb = F[i] + 1; const X = x + i * dx;
      for (const [pr, kk, a] of L[i]) {
        const yt = yb - a; let gq = groups.get(pr);
        if (!gq) { gq = { kk, r: [] }; groups.set(pr, gq); }
        const r = gq.r, last = r[r.length - 1];
        if (last && Math.abs(last[0] + last[2] - X + 0.3) < 0.01 && Math.abs(last[1] - yt) < 0.6 && Math.abs(last[1] + last[3] - yb - 0.4) < 0.6) last[2] += dx;
        else r.push([X - 0.3, yt, dx + 0.6, yb - yt + 0.4]);
        yb = yt;
      }
    }
    if (!groups.size) return;
    for (const [pr, gq] of groups) { ctx.beginPath(); for (const q of gq.r) ctx.rect(q[0], q[1], q[2], q[3]); ctx.fillStyle = K.material(pr, gq.kk, KIND[gq.kk]); ctx.fill(); }
    const sx = (i) => x + (i + 0.5) * dx, sy = (i) => F[i] - H[i];
    // гладкая кромка поверхности поверх ступенек колонн
    ctx.beginPath(); ctx.moveTo(x, sy(0));
    for (let i = 0; i < N - 1; i++) { if (H[i] < 0.05 && H[i + 1] < 0.05) { ctx.moveTo(sx(i + 1), sy(i + 1)); continue; } ctx.quadraticCurveTo(sx(i), sy(i), (sx(i) + sx(i + 1)) / 2, (sy(i) + sy(i + 1)) / 2); }
    ctx.lineTo(x + w, sy(N - 1));
    ctx.lineWidth = Math.max(2, dx * 0.9); ctx.strokeStyle = K.material(L[N >> 1].length ? L[N >> 1][L[N >> 1].length - 1][0] : c.prod, c.kind, KIND[c.kind]); ctx.stroke();
    ctx.lineWidth = 1; ctx.strokeStyle = "rgba(255,244,215,.45)"; ctx.stroke();
    // объём: светлее у поверхности, темнее в глубине
    let ymin = y + h; for (let i = 0; i < N; i++) if (H[i] > 0.05) ymin = Math.min(ymin, sy(i));
    const g = ctx.createLinearGradient(0, ymin, 0, geo.bot); g.addColorStop(0, "rgba(255,240,210,.10)"); g.addColorStop(1, "rgba(30,18,4,.42)");
    ctx.beginPath(); ctx.moveTo(x, sy(0)); for (let i = 0; i < N; i++) ctx.lineTo(sx(i), sy(i)); ctx.lineTo(x + w, sy(N - 1)); ctx.lineTo(x + w, geo.bot); ctx.lineTo(x, geo.bot); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
    // струя загрузки и воронка выгрузки
    const cols = (spec && spec.cols) || KIND[c.kind] || KIND.grain;
    if (t - st.inT < 0.35 && !geo.noStream && (c.mass || 0) > 1) {
      const ix = st.inX != null ? st.inX : cxm, ii = Math.max(0, Math.min(N - 1, Math.floor((ix - x) / dx))), yS = sy(ii);
      for (let k = 0; k < 34; k++) { const s2 = (t * 2.6 + k / 34) % 1, Y = top + s2 * (yS - top); ctx.fillStyle = cols[k % 3]; ctx.fillRect(ix - 3 + hash(k) * 6, Y, 2.4, 3.2); }
      for (let k = 0; k < 8; k++) { const s2 = (t * 1.5 + k / 8) % 1, side = k % 2 ? 1 : -1; ctx.fillStyle = cols[(k + 1) % 3]; ctx.fillRect(ix + side * s2 * w * 0.22, yS + s2 * s2 * 10 - 2, 2.2, 2.6); }
    }
    if (t - st.outT < 0.35) {
      const ii = Math.max(0, Math.min(N - 1, Math.floor((cxm - x) / dx))), yS = sy(ii);
      for (let k = 0; k < 10; k++) { const s2 = (t * 1.2 + k / 10) % 1, side = k % 2 ? 1 : -1; ctx.fillStyle = cols[k % 3]; ctx.fillRect(cxm + side * (1 - s2) * w * 0.2, yS - 6 + s2 * 8 + (1 - s2) * (1 - s2) * -6, 2.2, 2.6); }
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
    // самосвал ямы приезжает гружёным передом; машины отгрузки сдают пустыми задом под бункер
    // и после погрузки уезжают передом обратно — через механизмы не едут
    const fl = n.id === "truck_in" ? n.flip : true;
    const im = IMG[fl ? "truck_flip" : "truck"]; const x = n.x + truckX(n.id), y = n.y;
    ctx.save();
    if (n.id === "truck_in" && t.tilt) { ctx.translate(x + n.w * 0.85, y + n.h * 0.8); ctx.rotate(-0.08 * t.tilt); ctx.translate(-(x + n.w * 0.85), -(y + n.h * 0.8)); }
    if (im) {
      // насыпь, нарисованная в картинке, срезается — груз рисуется по фактической загрузке
      const ih = n.w * im.height / im.width, bx0 = fl ? x + n.w * 0.01 : x + n.w * 0.39;
      ctx.save(); ctx.beginPath(); ctx.rect(x - 2, y - 40, n.w + 4, ih + 44); ctx.rect(bx0, y - 40, n.w * 0.61, 40 + ih * 0.132); ctx.clip("evenodd");
      ctx.drawImage(im, x, y, n.w, ih); ctx.restore();
      const Wt = WHEELS.truck;
      Wt.pts.forEach(([fx, fy]) => wheel(x + (fl ? 1 - fx : fx) * n.w, y + fy * ih, Wt.rim * n.w, x / (Wt.r * n.w), false));
    }
    const load = Math.max(0, Math.min(1, t.load || 0));
    if (load > 0.01) {
      const bx = fl ? x + n.w * 0.02 : x + n.w * 0.40, bw = n.w * 0.58, by = y + n.h * 0.13;
      ctx.fillStyle = n.id === "truck_in" ? K.material(t.material || "Пшеница", "grain", KIND.grain) : prodPat(t.silo === 9 ? "pellet" : "mash");
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.quadraticCurveTo(bx + bw / 2, by - 28 * load, bx + bw, by); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    if (t.phase !== "away" && n.id !== "truck_in") badge(`${(t.load * 20).toFixed(1)} т` + (t.phase === "arrive" ? " · подъезд" : t.phase === "load" ? " · погрузка" : " · выезд"), x + n.w / 2, y + n.h + 14, { size: 14 });
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

  /* ============================================================ машины-спрайты */
  // Корпуса технологических машин — рисованные спрайты в стиле «Родины»
  // (assets/mach/*.webp). Координаты окна-разреза и патрубков заданы в долях
  // картинки; спрайт ставится так, чтобы его патрубок совпал с точкой
  // подключения трубы, остальные точки подключения берутся со спрайта.
  // В окне разреза поверх картинки рисуется живое состояние: продукт,
  // вращение ротора/лопастей/матрицы, пар, кипение.
  const MSPR = {
    crusher: { win: [[0.19, 0.21], [0.615, 0.21], [0.615, 0.615], [0.19, 0.615]], pts: { in: [0.40, 0.0], out: [0.238, 0.875] }, rotor: [0.40, 0.375] },
    press: { circle: [0.62, 0.43, 0.135], pts: { in: [0.614, 0.0], out: [0.62, 0.80] } },
    mixer: { win: [[0.149, 0.196], [0.787, 0.196], [0.787, 0.50], [0.149, 0.50]], pts: { in: [0.22, 0.0], oil: [0.655, 0.0], out: [0.47, 0.84], top: [0.5, 0.06] } },
    conditioner: { win: [[0.355, 0.33], [0.78, 0.33], [0.78, 0.62], [0.355, 0.62]], pts: { in: [0.21, 0.0], out: [0.935, 0.85], steam: [0.61, 0.06] } },
    cooler: { win: [[0.19, 0.225], [0.70, 0.225], [0.70, 0.622], [0.19, 0.622]], pts: { in: [0.485, 0.0], out: [0.485, 0.90], duct: [0.70, 0.09] } },
    sifter: { win: [[0.17, 0.21], [0.71, 0.145], [0.71, 0.53], [0.17, 0.595]], pts: { in: [0.165, 0.0], waste: [0.237, 0.79], out: [0.63, 0.812] } },
    scalp: { win: [[0.355, 0.18], [0.773, 0.18], [0.773, 0.61], [0.355, 0.61]], pts: { in: [0.88, 0.0], out: [0.726, 0.915], waste: [0.98, 0.82], asp: [0.35, 0.0] } },
    boiler: { win: [[0.40, 0.357], [0.74, 0.357], [0.74, 0.66], [0.40, 0.66]], pts: { steam: [0.55, 0.0] } },
    tank: { win: [[0.393, 0.164], [0.679, 0.164], [0.679, 0.526], [0.393, 0.526]], pts: {} },
    compressor: { pts: {} },
    noria_head: { win: [[0.34, 0.27], [0.70, 0.27], [0.70, 0.72], [0.34, 0.72]], pul: [0.52, 0.39, 0.12], legs: [0.374, 0.682], pts: { out: [0.935, 0.635], asp: [0.63, 0.0] } },
    noria_boot: { win: [[0.333, 0.27], [0.728, 0.27], [0.728, 0.79], [0.333, 0.79]], pul: [0.533, 0.65, 0.14], legs: [0.322, 0.731], pts: { in: [0.03, 0.22], asp: [0.9, 0.49] } },
    cyclone: { win: [[0.42, 0.27], [0.58, 0.27], [0.58, 0.40], [0.42, 0.40]], pts: { in: [0.03, 0.155], air: [0.46, 0.0], out: [0.44, 0.87] } },
    filter: { win: [[0.2, 0.25], [0.8, 0.25], [0.8, 0.62], [0.2, 0.62]], pts: { in: [0.49, 0.0], out: [0.5, 0.95] } },
    sluice: { circle: [0.40, 0.445, 0.2], pts: { in: [0.40, 0.0], out: [0.40, 0.88] } },
    diverter: { win: [[0.29, 0.24], [0.69, 0.24], [0.69, 0.58], [0.29, 0.58]], pts: { in: [0.46, 0.0], o1: [0.03, 0.74], o2: [0.92, 0.74] } },
    trash: { win: [[0.07, 0.06], [0.93, 0.06], [0.9, 0.2], [0.1, 0.2]], pts: { in: [0.5, 0.03] } },
    pit: { win: [[0.12, 0.09], [0.88, 0.09], [0.60, 0.71], [0.40, 0.71]], pts: { in: [0.5, 0.05], out: [0.5, 0.885] }, grate: 0.046, wall: [0.90, 0.952], floor: 0.93 },
    oilscale: { win: [[0.33, 0.3], [0.58, 0.3], [0.58, 0.56], [0.33, 0.56]], pts: { in: [0.25, 0.0], out: [0.45, 0.85] } },
    bigbag: { pts: { in: [0.395, 0.0], head: [0.395, 0.17], spout: [0.395, 0.37], out: [0.395, 0.95] }, roll: 0.795, rollL: 0.0, rollR: 0.665 },
    forklift: { pts: {}, mast: 0.225, fork: 0.925 },
    fan: { circle: [0.64, 0.5, 0.15], pts: { in: [0.27, 0.49], out: [0.85, 0.0] } },
    gearmotor: { win: [[0.515, 0.1], [0.88, 0.1], [0.88, 0.85], [0.515, 0.85]], pul: [0.78, 0.48, 0.1], pts: { hub: [0.70, 0.48] } },
    cabinet: { pts: { lr: [0.502, 0.164], ly: [0.502, 0.273], lg: [0.502, 0.38], es: [0.823, 0.44], hmi: [0.175, 0.25] } },
  };
  // Размещение: размер по высоте (h) или ширине (w) в мировых единицах,
  // якорь — патрубок спрайта, совмещаемый с точкой подключения A[id][at]
  // (или A[to]), либо вписывание в прямоугольник узла (box).
  const MPLACE = [
    ["Drob1", { spr: "crusher", flip: true, h: 330, at: "in" }],
    ["Drob2", { spr: "crusher", h: 330, at: "in" }],
    ["Sms", { spr: "mixer", w: 340, at: "in" }],
    ["Gran", { spr: "press", w: 390, at: "in" }],
    ["KondGr", { spr: "conditioner", w: 330, at: "out", to: ["Gran", "in", 0, -6] }],
    ["Ohl", { spr: "cooler", h: 290, at: "in" }],
    ["Pros", { spr: "sifter", w: 360, at: "in" }],
    ["Scalp", { spr: "scalp", flip: true, h: 210, at: "in" }],
    ["boiler", { spr: "boiler", w: 520, at: "steam" }],
    ["tankOil", { spr: "tank", box: true }],
    ["compr", { spr: "compressor", box: true }],
    ["Asp1", { spr: "cyclone", flip: true, box: true, h: 300 }],
    ["Asp2", { spr: "cyclone", box: true, h: 300 }],
    ["AspGr", { spr: "cyclone", flip: true, box: true, h: 290 }],
    ["ZatvOhl", { spr: "sluice", h: 52, at: "in", to: ["Gran", "out", 0, 4] }],
    ["DVPT", { spr: "diverter", h: 78, at: "in" }],
    ["PP1", { spr: "diverter", h: 72, at: "in" }],
    ["PP2", { spr: "diverter", h: 72, at: "in" }],
    ["PP3", { spr: "diverter", h: 72, at: "in" }],
    ["pit", { spr: "pit", w: 340, at: "in" }],
    ["Jir", { spr: "oilscale", h: 118, at: "in" }],
    ["Leb", { spr: "bigbag", box: true, h: 230 }],
    ["cab", { spr: "cabinet", box: true, w: 440 }],
  ];
  // уменьшенные копии спрайтов: при обзоре всей схемы картинка в 900 px
  // не пережимается в каждом кадре, берётся ближайший по размеру уровень
  const MIPS = {};
  function mipImg(key, destW) {
    const im = IMG[key]; if (!im) return null;
    let lv = MIPS[key];
    if (!lv) {
      lv = MIPS[key] = [im]; let c = im;
      while ((c.width || c.naturalWidth) > 96) {
        const w = Math.round((c.width || c.naturalWidth) / 2), h = Math.round((c.height || c.naturalHeight) / 2), o = document.createElement("canvas");
        o.width = w; o.height = h; const g = o.getContext("2d"); g.imageSmoothingQuality = "high"; g.drawImage(c, 0, 0, w, h); lv.push(o); c = o;
      }
    }
    const need = destW * scale * (window.devicePixelRatio || 1) * 1.25;
    let best = lv[0]; for (const c of lv) { if ((c.width || c.naturalWidth) >= need) best = c; else break; }
    return best;
  }
  function loadMachSprites(done) {
    const names = Object.keys(MSPR); let left = names.length;
    names.forEach((nm) => {
      const im = new Image();
      im.onload = () => { IMG["m_" + nm] = im; IMG["m_" + nm + "_flip"] = flip(im); IMG["m_" + nm + "_dk"] = dark(im); IMG["m_" + nm + "_flip_dk"] = dark(IMG["m_" + nm + "_flip"]); if (--left === 0) done(); };
      im.onerror = () => { if (--left === 0) done(); };
      im.src = "assets/mach/" + nm + ".webp";
    });
  }
  function layoutMachSprites() {
    for (const [id, p] of MPLACE) {
      const n = ND[id], im = IMG["m_" + p.spr], sp = MSPR[p.spr];
      if (!n || !im) continue;
      const iw = im.naturalWidth, ih = im.naturalHeight;
      const fx = (f) => (p.flip ? 1 - f : f);
      let s, ox, oy;
      if (p.box) {
        s = p.h ? p.h / ih : p.w ? p.w / iw : Math.min(n.w / iw, n.h / ih) * (p.k || 1.15);
        ox = n.x + n.w / 2 - iw * s / 2; oy = n.y + n.h - ih * s;
      } else {
        s = p.h ? p.h / ih : p.w / iw;
        const a = sp.pts[p.at], tg = p.to ? [A[p.to[0]][p.to[1]][0] + (p.to[2] || 0), A[p.to[0]][p.to[1]][1] + (p.to[3] || 0)] : A[id][p.at];
        ox = tg[0] - fx(a[0]) * iw * s; oy = tg[1] - a[1] * ih * s;
      }
      const W = iw * s, H = ih * s, P = (f) => [ox + fx(f[0]) * W, oy + f[1] * H];
      n._spr = { name: p.spr, img: "m_" + p.spr + (p.flip ? "_flip" : ""), ox, oy, W, H, P, flip: !!p.flip, sp };
      if (A[id]) for (const [k, f] of Object.entries(sp.pts)) { if (!A[id][k]) A[id][k] = [0, 0]; const q = P(f); A[id][k][0] = q[0]; A[id][k][1] = q[1]; }
      n._box = { x: n.x, y: n.y, w: n.w, h: n.h };
      n.x = ox; n.y = oy; n.w = W; n.h = H;
      if (n.kind === "crusher") n.hx = P(sp.pts.in)[0];
    }
    // нории: рисованные головка и башмак, ноги стыкуются с ногами нории
    for (const n of Object.values(ND)) {
      if (n.kind !== "noria" || !IMG.m_noria_head || !IMG.m_noria_boot) continue;
      const a = A[n.id], put = (nm, legs, ww, top, flipIt) => {
        const im = IMG["m_" + nm], s = ww / im.naturalWidth, W = ww, H = im.naturalHeight * s, sp = MSPR[nm];
        const fx = (f) => (flipIt ? 1 - f : f), lc = flipIt ? 1 - legs[1] : legs[0];
        const ox = n.x + 0.27 * n.w - lc * W, oy = top ? n.y - 6 : n.y + n.h - H + 8;
        return { name: nm, img: "m_" + nm + (flipIt ? "_flip" : ""), ox, oy, W, H, sp, flip: flipIt, P: (f) => [ox + fx(f[0]) * W, oy + f[1] * H] };
      };
      const hs = MSPR.noria_head.legs, bs = MSPR.noria_boot.legs;
      n._nh = put("noria_head", hs, 0.46 * n.w / (hs[1] - hs[0]), true, false);
      n._nb = put("noria_boot", bs, 0.46 * n.w / (bs[1] - bs[0]), false, a.in[0] > n.x + n.w / 2);
      const o = n._nh.P(MSPR.noria_head.pts.out), i = n._nb.P(MSPR.noria_boot.pts.in);
      a.out[0] = o[0]; a.out[1] = o[1]; a.in[0] = i[0]; a.in[1] = i[1];
      a.asp = n._nh.P(MSPR.noria_head.pts.asp); a.basp = n._nb.P(MSPR.noria_boot.pts.asp);
    }
    // фильтры норий стоят на патрубке аспирации головки
    for (const id of ["FiltNor5", "FiltNor6", "FiltNor7"]) {
      const n = ND[id], nor = ND["Nor" + id.slice(-1)], im = IMG.m_filter;
      if (!n || !nor || !nor._nh || !im) continue;
      const H = 96, s = H / im.naturalHeight, W = im.naturalWidth * s, [fx, fy] = A[nor.id].asp, ox = fx - 0.5 * W, oy = fy - 0.95 * H;
      n._spr = { name: "filter", img: "m_filter", ox, oy, W, H, sp: MSPR.filter, flip: false, P: (f) => [ox + f[0] * W, oy + f[1] * H] };
      A[id].in = n._spr.P([0.49, 0]); A[id].out = [fx, fy];
      n.x = ox; n.y = oy; n.w = W; n.h = H;
    }
    // контейнер отходов — точно под патрубком отходов скальператора
    if (A.Scalp.waste && IMG.m_trash) {
      const n = ND.trash, im = IMG.m_trash, W = 74, s = W / im.naturalWidth, H = im.naturalHeight * s;
      const ox = A.Scalp.waste[0] - W * 0.62, oy = ND.Scalp.y + ND.Scalp.h + 26;
      n._spr = { name: "trash", img: "m_trash", ox, oy, W, H, sp: MSPR.trash, flip: false, P: (f) => [ox + f[0] * W, oy + f[1] * H] };
      A.trash.in[0] = ox + W / 2; A.trash.in[1] = oy + 4; A.trash.out[0] = ox + W / 2; A.trash.out[1] = oy + H;
      n.x = ox; n.y = oy; n.w = W; n.h = H;
    }
    // вентилятор аспирации у каждого циклона: со стороны, противоположной
    // входу; воздуховод из верхнего патрубка циклона, выхлоп — вверх
    if (IMG.m_fan) for (const id of ["Asp1", "Asp2", "AspGr"]) {
      const n = ND[id], z = n && n._spr; if (!z) continue;
      const left = z.flip, H = id === "Asp2" ? 78 : 112, W = H, sp = MSPR.fan, flip = left;
      const ox = left ? z.ox - W - 14 : z.ox + z.W + 6, oy = z.oy - (id === "Asp2" ? 20 : 34);
      const P = (f) => [ox + (flip ? 1 - f[0] : f[0]) * W, oy + f[1] * H];
      n._fan = { name: "fan", img: "m_fan" + (flip ? "_flip" : ""), ox, oy, W, H, sp, flip, P };
      const air = z.P(MSPR.cyclone.pts.air), inl = P(sp.pts.in), out = P(sp.pts.out), sgn = left ? 1 : -1, yUp = Math.min(air[1] - 24, oy - 14);
      DUCTS.push({ id, w: 16, pts: [air, [air[0], yUp], [inl[0] + sgn * 26, yUp], [inl[0] + sgn * 26, inl[1]], inl] });
      DUCTS.push({ id, w: 16, stack: true, pts: [out, [out[0], Math.max(8, out[1] - 46)]] });
    }
    // завальная яма: самосвал стоит колёсами на решётке, нижняя головка ТС 10110 —
    // под выпуском бункера ямы, транспортёр выходит через проём в стене
    if (ND.pit._spr) {
      const z = ND.pit._spr, gy = z.oy + z.sp.grate * z.H, tr = ND.truck_in, im = IMG.truck;
      if (tr && im) tr.y = gy - tr.w * (im.height / im.width) * 0.975;
      const o = z.P(z.sp.pts.out), sc = ND.TrHole;
      if (sc) {
        sc.x1 = o[0] + 36; sc.y1 = o[1] - 8;
        sc.x = Math.min(sc.x1, sc.x2); sc.y = Math.min(sc.y1, sc.y2) - 20; sc.w = Math.abs(sc.x2 - sc.x1); sc.h = Math.abs(sc.y2 - sc.y1) + 40;
        A.TrHole.in[0] = sc.x1; A.TrHole.in[1] = sc.y1 - 14;
      }
    }
    // магнитные сепараторы — на течке питатель → дробилка
    [["mag1", "Pit1"], ["mag2", "Pit2"]].forEach(([mg, p]) => {
      const g = ND[mg], o = A[p] && A[p].out, im = IMG.magnet; if (!g || !o) return;
      g.w = 50; g.h = im ? g.w * im.height / im.width : 56; g.x = o[0] - g.w / 2; g.y = o[1] + 18;
    });
    // биг-бэг: загрузочная головка точно под выпуском бункера 310
    if (ND.Leb && ND.Leb._spr && A.Torba && A.Torba.out) {
      const n = ND.Leb, z = n._spr, dx = A.Torba.out[0] - z.P(MSPR.bigbag.pts.in)[0];
      z.ox += dx; n.x += dx; const P0 = z.P; z.P = (f) => { const q = P0(f); return [q[0] + dx, q[1]]; };
      A.Leb = A.Leb || {}; for (const [k, f] of Object.entries(MSPR.bigbag.pts)) A.Leb[k] = z.P(f);
    }
    // боковой загрузочный носок башмака нории 50300 — для ТЦ 51200 (подход справа)
    if (ND.Nor4 && ND.Nor4._nb) A.Nor4.sin = ND.Nor4._nb.P([0.97, 0.66]);
    // нижняя головка ТЦ 51100 — под правым выходом ПП 40960
    if (A.PP2 && A.PP2.o2 && ND.Tr51100) { const sc = ND.Tr51100; sc.x1 = A.PP2.o2[0] + 136; sc.y1 = A.PP2.o2[1] + 150; A.Tr51100.in[0] = sc.x1; A.Tr51100.in[1] = sc.y1 - 14; sc.x = Math.min(sc.x1, sc.x2); sc.y = Math.min(sc.y1, sc.y2) - 20; sc.w = Math.abs(sc.x2 - sc.x1); sc.h = Math.abs(sc.y2 - sc.y1) + 40; }
    // концы воздуховодов аспирации — на патрубки машин
    const dEnd = (x0, pts) => DUCTS.find((d) => d.pts[d.pts.length - 1][0] === x0 && (d.pts = pts));
    if (A.Ohl.duct) { const [dx, dy] = A.Ohl.duct, yy = dy - 46; dEnd(2896, [[3014, 1409], [3072, 1409], [3072, yy], [dx, yy], [dx, dy]]); }
    if (A.Scalp.asp) dEnd(795, [[A.Scalp.asp[0], 70], A.Scalp.asp]);
    if (A.Sms.top) dEnd(3062, [[3062, 50], [3062, A.Sms.top[1]]]);
    // ответвления к головкам норий — в патрубок на крыше головки
    [["NorHole", 568], ["Nor1", 990], ["Nor2", 2088], ["Nor3", 2748], ["Nor4", 3648]].forEach(([id, x0]) => {
      const q = A[id] && A[id].asp; if (!q) return;
      const d = DUCTS.find((d) => d.end && d.pts[0][0] === x0); if (d) d.pts = [[q[0], d.pts[0][1]], q];
    });
    // магистрали: от входного патрубка циклона, с охватом всех ответвлений
    const mainFrom = (id, i0) => {
      const d = DUCTS.find((d) => d.id === id && !d.end), q = A[id] && A[id].in; if (!d || !q) return;
      const ys = d.pts[2][1], xs = DUCTS.filter((e) => e.id === id && e.end).map((e) => e.pts[0][0]);
      const xEnd = d.pts[3][0] < d.pts[2][0] ? Math.min(...xs) : Math.max(...xs);
      d.pts = [[q[0], q[1]], [d.pts[1][0], q[1]], [d.pts[1][0], ys], [xEnd, ys]];
    };
    mainFrom("Asp1"); mainFrom("Asp2");
    const dg = DUCTS.find((d) => d.id === "AspGr"); if (dg && A.AspGr.in) { dg.pts[0] = [A.AspGr.in[0], A.AspGr.in[1]]; dg.pts[1] = [3072, A.AspGr.in[1]]; }
    if (IMG.m_gearmotor) K.setGearMotor((w, flip) => mipImg("m_gearmotor" + (flip ? "_flip" : ""), w), IMG.m_gearmotor.naturalHeight / IMG.m_gearmotor.naturalWidth, MSPR.gearmotor);
    // ТЦ 40700 — наклонный: хвост под выпуском охладителя, головка не доходит до нории 40900,
    // из носка головки продукт идёт в башмак трубой под 45°
    if (ND.Tr40700 && A.Nor6 && A.Ohl) { const c = ND.Tr40700; c.h0 = c.h0 || c.h; c.cy1 = A.Ohl.out[1] + 6 + c.h0 / 2; c.cx2 = A.Nor6.in[0] - 150; c.cy2 = A.Nor6.in[1] - 137;
      c.y = Math.min(c.cy1, c.cy2) - c.h0 / 2; c.h = Math.abs(c.cy1 - c.cy2) + c.h0; c.w = c.cx2 - c.x1; }
    // ТЦ 51200 — хвост левее наклонного ТЦ 51100, чтобы корпуса не наезжали
    if (ND.Tr51200 && ND.Tr51100) { const c = ND.Tr51200; c.x1 = 4515; c.x = Math.min(c.x1, c.x2); c.w = Math.abs(c.x2 - c.x1); }
    chainAnchors();
    LINKS.length = 0; buildLinks(); fitLinks();
  }
  // Стыки течек с патрубками: из головки нории — по оси наклонного патрубка, в башмак —
  // по оси загрузочного носка, из переключателя — горизонтально из бокового фланца, в верх — вертикально.
  function fitLinks() {
    const near = (p, q) => q && Math.hypot(p[0] - q[0], p[1] - q[1]) < 2;
    for (const L of LINKS) {
      const P = L.pts; if (P.length < 2) continue;
      for (const n of Object.values(ND)) {
        const a = A[n.id]; if (!a) continue;
        if (n.kind === "noria" && n._nh) {
          if (near(P[0], a.out)) P.splice(1, 0, [a.out[0] + 16, a.out[1] + 15]);
          if (near(P[P.length - 1], a.in)) P.splice(P.length - 1, 0, [a.in[0] - 16, a.in[1] - 16]);
          if (near(P[P.length - 1], a.sin)) P.splice(P.length - 1, 0, [a.sin[0] + 18, a.sin[1] - 16]);
        }
        if (n.kind === "diverter" && n._spr) {
          const cx = n.x + n.w / 2;
          ["o1", "o2"].forEach((k) => { if (near(P[0], a[k])) P.splice(1, 0, [a[k][0] + (a[k][0] < cx ? -14 : 14), a[k][1]]); });
          if (near(P[P.length - 1], a.in) && Math.abs(P[P.length - 2][0] - a.in[0]) > 1) P.splice(P.length - 1, 0, [a.in[0], a.in[1] - 18]);
        }
      }
      L._sg = null;
    }
  }
  // контур окна разреза в мировых координатах
  function machWin(n) {
    const z = n._spr, sp = z.sp;
    if (sp.circle) { const [cx, cy] = z.P(sp.circle), r = sp.circle[2] * z.W; return { x: cx - r, y: cy - r, w: 2 * r, h: 2 * r, cx, cy, r }; }
    if (!sp.win) return null;
    const pts = sp.win.map(z.P), xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { pts, x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  function clipWin(wn) {
    ctx.beginPath();
    if (wn.r) ctx.arc(wn.cx, wn.cy, wn.r, 0, TAU); else K.path(wn.pts, true);
    ctx.clip();
  }
  const dim = (wn, a) => { ctx.fillStyle = `rgba(10,16,24,${a})`; ctx.fillRect(wn.x - 2, wn.y - 2, wn.w + 4, wn.h + 4); };
  // слой продукта с волнистой поверхностью, fr — доля заполнения окна
  function prodLayer(wn, fr, kind, wave, ph) {
    if (fr <= 0.005) return 0;
    const top = wn.y + wn.h - wn.h * Math.min(1, fr);
    ctx.beginPath(); ctx.moveTo(wn.x, wn.y + wn.h + 2);
    for (let X = wn.x; X <= wn.x + wn.w + 6; X += 6) ctx.lineTo(X, top + (wave ? Math.sin(X / 15 + ph * 3) * wave + Math.sin(X / 6 - ph * 5) * wave * 0.35 : 0));
    ctx.lineTo(wn.x + wn.w, wn.y + wn.h + 2); ctx.closePath();
    ctx.fillStyle = prodPat(kind); ctx.fill();
    const g = ctx.createLinearGradient(0, top, 0, wn.y + wn.h); g.addColorStop(0, "rgba(255,240,210,.12)"); g.addColorStop(1, "rgba(30,18,4,.45)"); ctx.fillStyle = g; ctx.fill();
    return top;
  }
  // лопасти/молотки на горизонтальном валу (вид сбоку): задние — за продуктом
  function shaftBlades(x0, x1, cy, R, n, ph, front, o) {
    for (let k = 0; k < n; k++) {
      const X = x0 + (k + 0.5) * (x1 - x0) / n, a = ph + k * (o.step || 0.785), s = Math.sin(a), cz = Math.cos(a);
      if ((cz >= 0) !== front) continue;
      const ty = cy + s * R, bw = (o.bw || 14) * (0.35 + 0.65 * Math.abs(cz));
      ctx.strokeStyle = front ? "#b9c3ca" : "#4f5a62"; ctx.lineWidth = o.arm || 3; ctx.beginPath(); ctx.moveTo(X, cy); ctx.lineTo(X, ty); ctx.stroke();
      ctx.fillStyle = front ? "#d3dbe0" : "#5d6870"; ctx.fillRect(X - bw / 2, ty - (o.th || 6) / 2, bw, o.th || 6);
      ctx.strokeStyle = "#1c252b"; ctx.lineWidth = 0.7; ctx.strokeRect(X - bw / 2, ty - (o.th || 6) / 2, bw, o.th || 6);
    }
  }
  const INSIDE = {
    crusher(n, wn, run, t) {
      const m = M[n.id], c = CT[n.id], z = n._spr, [rx, ry] = z.P(z.sp.rotor), fill = c ? Math.min(1, c.mass / 6) : 0;
      if (m) m._ph = (m._ph || 0) + run * 0.75;
      if (run > 0.15) {
        dim(wn, 0.72);
        const R = wn.h * 0.36, ph = m ? m._ph : 0;
        // кольцо измельчаемого продукта у сита и вихрь частиц
        if (fill > 0.02) { ctx.fillStyle = prodPat("meal"); ctx.globalAlpha = 0.85; ctx.fillRect(wn.x, wn.y + wn.h * (0.86 - 0.12 * fill), wn.w, wn.h); ctx.globalAlpha = 1; }
        ctx.fillStyle = "rgba(200,210,216,.16)"; ctx.fillRect(wn.x, ry - R - 6, wn.w, 2 * R + 12);
        ctx.fillStyle = K.pat("brushed"); ctx.fillRect(wn.x, ry - 6, wn.w, 12); ctx.strokeStyle = "#1c252b"; ctx.lineWidth = 0.8; ctx.strokeRect(wn.x, ry - 6, wn.w, 12);
        shaftBlades(wn.x + 6, wn.x + wn.w - 6, ry, R, 6, ph, false, { step: 1.9, bw: 16, th: 9, arm: 4 });
        shaftBlades(wn.x + 6, wn.x + wn.w - 6, ry, R, 6, ph, true, { step: 1.9, bw: 16, th: 9, arm: 4 });
        if (fill > 0.02) { ctx.fillStyle = kc("grain", 0); for (let k = 0; k < 28; k++) { const X = wn.x + ((hash(k) * wn.w + t * 900 * (k % 2 ? 1 : -1)) % wn.w + wn.w) % wn.w, Y = ry + Math.sin(t * 30 + k) * R * 1.05; ctx.fillRect(wn.x + (X - wn.x), Y, 3, 2); } }
        ctx.fillStyle = "rgba(220,205,160,.18)"; ctx.fillRect(wn.x, wn.y, wn.w, wn.h);   // мучная пыль
      } else if (fill > 0.02) bulk(wn.x, wn.w, wn.y + wn.h - wn.h * 0.3 * fill, wn.y + wn.h, "grain", 6);
    },
    press(n, wn, run, t) {
      const m = M[n.id], flow = (S.granFlow || 0) > 0.05 && run > 0.3;
      if (m) m._ph = (m._ph || 0) + run * 0.07;
      if (run < 0.15) return;
      const ph = m ? m._ph : 0, cx = wn.cx, cy = wn.cy, Rd = wn.r * 0.93;
      dim(wn, 0.6);
      ctx.beginPath(); ctx.arc(cx, cy, Rd, 0, TAU); ctx.arc(cx, cy, Rd * 0.8, 0, TAU, true); ctx.fillStyle = K.pat("brushed"); ctx.fill();
      ctx.fillStyle = "#141a1f"; for (let k = 0; k < 40; k++) { const a = ph + k * TAU / 40; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * Rd * 0.9, cy + Math.sin(a) * Rd * 0.9, Rd * 0.035, 0, TAU); ctx.fill(); }
      if (flow) {
        ctx.beginPath(); ctx.arc(cx, cy, Rd * 0.8, 0, TAU); ctx.arc(cx, cy, Rd * 0.7, 0, TAU, true); ctx.fillStyle = prodPat("mash"); ctx.fill();
        ctx.fillStyle = kc("pellet", 0); for (let k = 0; k < 40; k += 2) { const a = ph + k * TAU / 40, L = Rd * (0.05 + ((k * 7 + t * 40) % 8) / 80); ctx.save(); ctx.translate(cx + Math.cos(a) * Rd, cy + Math.sin(a) * Rd); ctx.rotate(a); ctx.fillRect(0, -1.6, L, 3.2); ctx.restore(); }
      }
      [0, Math.PI].forEach((o) => {
        const rx = cx + Math.cos(o + 0.4) * Rd * 0.42, ry = cy + Math.sin(o + 0.4) * Rd * 0.42, rr = Rd * 0.3;
        ctx.beginPath(); ctx.arc(rx, ry, rr, 0, TAU); ctx.fillStyle = K.pat("brushed"); ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = "#1c252b"; ctx.stroke();
        ctx.strokeStyle = "#5a656c"; ctx.lineWidth = 1.3; for (let k = 0; k < 12; k++) { const a = -ph * 3.2 + k * TAU / 12; ctx.beginPath(); ctx.moveTo(rx + Math.cos(a) * rr * 0.72, ry + Math.sin(a) * rr * 0.72); ctx.lineTo(rx + Math.cos(a) * rr, ry + Math.sin(a) * rr); ctx.stroke(); }
        ctx.beginPath(); ctx.arc(rx, ry, rr * 0.25, 0, TAU); ctx.fillStyle = "#2a343b"; ctx.fill();
      });
      ctx.beginPath(); ctx.arc(cx, cy, Rd * 0.12, 0, TAU); ctx.fillStyle = "#2a343b"; ctx.fill();
    },
    mixer(n, wn, run, t) {
      const m = M[n.id], c = CT.Sms, fr = Math.min(1, c.mass / c.cap) * 1.3, kind = S.oilInMix > 0.3 && V.SmsMainState3 ? "mash" : c.kind;
      if (m) m._ph = (m._ph || 0) + run * 0.16;
      const ph = m ? m._ph : 0, cy = wn.y + wn.h * 0.55, R = wn.h * 0.4;
      if (run > 0.15) { dim(wn, 0.55); shaftBlades(wn.x + 8, wn.x + wn.w - 8, cy, R, 8, ph, false, { bw: 18 }); }
      prodLayer(wn, fr, kind, run * 6, ph);
      if (fr > 0.005 && S.oilInMix > 0.05) { ctx.fillStyle = "rgba(242,196,55,.22)"; ctx.fillRect(wn.x, wn.y + wn.h * (1 - Math.min(1, fr)), wn.w, wn.h); }
      if (run > 0.15) {
        ctx.fillStyle = K.pat("brushed"); ctx.fillRect(wn.x, cy - 4, wn.w, 8); ctx.strokeStyle = "#20292f"; ctx.lineWidth = 0.6; ctx.strokeRect(wn.x, cy - 4, wn.w, 8);
        shaftBlades(wn.x + 8, wn.x + wn.w - 8, cy, R, 8, ph, true, { bw: 18 });
        if (fr > 0.05) { ctx.fillStyle = kc(kind, 0); for (let k = 0; k < 30; k++) { const X = wn.x + ((hash(k) * wn.w + ph * 30 * (k % 2 ? 1 : -1)) % wn.w + wn.w) % wn.w, Y = wn.y + wn.h * (1 - Math.min(1, fr)) - ((t * 3 + hash(k + 9)) % 1) * 18; ctx.fillRect(X, Y, 2.5, 2.5); } }
      }
      if (V.Go_MasloDos) { ctx.fillStyle = "rgba(246,196,40,.8)"; for (let j = 0; j < 4; j++) { const X = wn.x + wn.w * (0.2 + j * 0.2); for (let d = 0; d < 9; d++) { const s2 = (t * 2.2 + d / 9) % 1; ctx.beginPath(); ctx.arc(X + (d - 4) * 4 * s2, wn.y + 4 + s2 * wn.h * 0.5, 1.6, 0, TAU); ctx.fill(); } } }
    },
    conditioner(n, wn, run, t) {
      const m = M[n.id], q = Math.min(1, CT.Kond.mass / 8), steam = (+V.SteamValve || 0) > 1 && !S.noSteam;
      if (m) m._ph = (m._ph || 0) + run * 0.3;
      const ph = m ? m._ph : 0, cy = wn.y + wn.h * 0.5, R = wn.h * 0.36;
      if (run > 0.15) { dim(wn, 0.5); shaftBlades(wn.x + 4, wn.x + wn.w - 4, cy, R, 14, ph, false, { step: 0.7, bw: 10, th: 4, arm: 2 }); }
      const top = prodLayer(wn, q * 0.85, "mash", run * 2.5, t * 2);
      if (top) { ctx.fillStyle = `rgba(120,70,20,${0.1 + Math.min(0.3, ((+V.TempKond || 20) - 20) / 200)})`; ctx.fillRect(wn.x, top, wn.w, wn.y + wn.h - top); }
      if (run > 0.15) { ctx.fillStyle = K.pat("brushed"); ctx.fillRect(wn.x, cy - 3, wn.w, 6); shaftBlades(wn.x + 4, wn.x + wn.w - 4, cy, R, 14, ph, true, { step: 0.7, bw: 10, th: 4, arm: 2 }); }
      if (steam && run > 0.2) for (let k = 0; k < 12; k++) { const s2 = (t * 0.9 + k / 12) % 1, X = wn.x + 14 + ((k * 53) % (wn.w - 28)); ctx.beginPath(); ctx.arc(X + s2 * 18, wn.y + 3 + s2 * wn.h * 0.45, 3 + s2 * 7, 0, TAU); ctx.fillStyle = `rgba(255,255,255,${0.5 * (1 - s2)})`; ctx.fill(); }
    },
    cooler(n, wn, run, t) {
      const c = CT.Ohl, air = running("AspGr"), fr = Math.min(1, c.mass / 520), tc = Math.max(0, Math.min(1, (c.temp - 20) / 60));
      if (fr > 0.01) {
        const top = wn.y + wn.h - wn.h * fr;
        ctx.beginPath(); ctx.moveTo(wn.x, wn.y + wn.h + 2); ctx.lineTo(wn.x, top + 10); ctx.quadraticCurveTo(wn.x + wn.w / 2, top - 10, wn.x + wn.w, top + 10); ctx.lineTo(wn.x + wn.w, wn.y + wn.h + 2); ctx.closePath();
        ctx.fillStyle = prodPat("pellet"); ctx.fill();
        const g = ctx.createLinearGradient(0, top, 0, wn.y + wn.h); g.addColorStop(0, `rgba(255,${Math.round(120 - 60 * tc)},40,${0.1 + 0.4 * tc})`); g.addColorStop(1, "rgba(30,20,10,.35)"); ctx.fillStyle = g; ctx.fill();
      }
      if (air) { ctx.strokeStyle = "rgba(200,225,255,.6)"; ctx.lineWidth = 1.6; for (let k = 0; k < 8; k++) { const X = wn.x + 10 + k * (wn.w - 20) / 7, s2 = (t * 0.7 + k * 0.13) % 1, Y = wn.y + wn.h - s2 * wn.h; ctx.beginPath(); ctx.moveTo(X, Y + 14); ctx.quadraticCurveTo(X + 4, Y + 7, X, Y); ctx.stroke(); } }
    },
    sifter(n, wn, run, t) {
      const q = Math.min(1, elMass("Pros") / 12), z = n._spr;
      if (q < 0.02) return;
      // две наклонные деки спрайта: слой гранул движется к выпуску, мелочь сыплется вниз
      [[0.30, 0.235, 0.36], [0.45, 0.385, 0.51]].forEach(([yl, yr, yb], i) => {
        const [x0, y0] = z.P([0.18, yl]), [x1, y1] = z.P([0.70, yr]), lay = (i ? 5 : 8) + 10 * q;
        ctx.save(); ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x1, y1 - lay); ctx.lineTo(x0, y0 - lay); ctx.closePath(); ctx.clip();
        ctx.translate(((t * 50 * run) % 64), 0); ctx.fillStyle = prodPat(i ? "fines" : "pellet"); ctx.fillRect(Math.min(x0, x1) - 70, Math.min(y0, y1) - lay - 6, Math.abs(x1 - x0) + 140, Math.abs(y1 - y0) + lay + 12);
        ctx.restore();
      });
      if (run > 0.2) { ctx.fillStyle = kc("fines", 1); for (let k = 0; k < 24; k++) { const X = wn.x + 8 + ((k * 41) % (wn.w - 16)), Y = wn.y + wn.h * 0.35 + ((t * 70 + k * 11) % (wn.h * 0.6)); ctx.fillRect(X, Y, 2, 2); } }
    },
    scalp(n, wn, run, t) {
      // барабанный скальператор: перфорированный цилиндр на горизонтальном валу.
      // Зерно проходит сквозь отверстия в бункер, крупные примеси катятся
      // вдоль барабана к торцу и уходят в патрубок отходов.
      const m = M[n.id], q = Math.min(1, elMass("Scalp") / 3), z = n._spr;
      if (m) m._ph = (m._ph || 0) + run * 0.09;
      const ph = m ? m._ph : 0;
      const dx = wn.x + 6, dw = wn.w - 12, R0 = wn.h * 0.3, cy = wn.y + wn.h * 0.42, dy = cy - R0;
      const wasteLeft = z.P(z.sp.pts.waste)[0] < wn.x + wn.w / 2, dir = wasteLeft ? -1 : 1;
      ctx.fillStyle = "#0e151b"; ctx.fillRect(wn.x - 2, wn.y - 2, wn.w + 4, wn.h + 4);
      // поток в бункер под барабаном
      if (q > 0.02 && run > 0.2) {
        ctx.fillStyle = kc("grain", 0);
        for (let k = 0; k < 70; k++) {
          const X = dx + hash(k) * dw, s2 = (t * (1.4 + hash(k + 5)) + hash(k + 9)) % 1, Y = cy + R0 * 0.8 + s2 * (wn.y + wn.h - cy - R0 * 0.8);
          ctx.fillStyle = kc("grain", k % 3); ctx.fillRect(X, Y, 2.2, 3);
        }
      }
      if (q > 0.02) bulk(wn.x, wn.w, wn.y + wn.h - 4 - 10 * q, wn.y + wn.h + 2, "grain", 5);
      // зерно внутри: слой у дна, увлечённый вращением вверх по стенке
      if (q > 0.02) {
        const lift = run > 0.2 ? 0.45 : 0;
        ctx.save(); ctx.beginPath(); ctx.ellipse(dx + dw / 2, cy, dw / 2, R0, 0, 0, TAU); ctx.clip();
        ctx.beginPath(); ctx.moveTo(dx, cy + R0);
        for (let X = dx; X <= dx + dw + 4; X += 4) ctx.lineTo(X, cy + R0 * (0.25 - 0.35 * q) - lift * R0 * 0.35 * Math.sin((X - dx) / dw * Math.PI) + Math.sin(X / 7 + t * 9) * (run > 0.2 ? 2 : 0));
        ctx.lineTo(dx + dw, cy + R0); ctx.closePath(); ctx.fillStyle = prodPat("grain"); ctx.fill();
        if (run > 0.2) {
          for (let k = 0; k < 40; k++) {   // каскад: зёрна подбрасываются и падают
            const s2 = (t * 1.8 + hash(k + 21)) % 1, X = dx + hash(k + 3) * dw, Y = cy + R0 * 0.2 - Math.sin(s2 * Math.PI) * R0 * 0.75;
            ctx.fillStyle = kc("grain", k % 3); ctx.fillRect(X, Y, 2.4, 3);
          }
          for (let k = 0; k < 7; k++) {   // примеси: солома и комки катятся к торцу
            const s2 = (t * 0.22 + hash(k + 40)) % 1, X = wasteLeft ? dx + dw * (1 - s2) : dx + dw * s2, Y = cy + R0 * 0.05 + Math.sin(t * 6 + k) * 3;
            ctx.save(); ctx.translate(X, Y); ctx.rotate(t * 4 * dir + k);
            if (k % 3) { ctx.fillStyle = "#c9a54a"; ctx.fillRect(-7, -1, 14, 2.2); } else { ctx.fillStyle = "#6b5641"; ctx.beginPath(); ctx.arc(0, 0, 3.2, 0, TAU); ctx.fill(); }
            ctx.restore();
          }
        }
        ctx.restore();
      }
      // сам барабан: сетка с отверстиями, ряды бегут при вращении
      const g = ctx.createLinearGradient(0, dy, 0, dy + 2 * R0);
      g.addColorStop(0, "rgba(120,132,140,.55)"); g.addColorStop(0.35, "rgba(225,232,236,.42)"); g.addColorStop(1, "rgba(40,50,58,.7)");
      ctx.beginPath(); ctx.ellipse(dx + dw / 2, cy, dw / 2, R0, 0, 0, TAU); ctx.fillStyle = g; ctx.fill();
      ctx.save(); ctx.beginPath(); ctx.ellipse(dx + dw / 2, cy, dw / 2, R0, 0, 0, TAU); ctx.clip();
      for (let k = 0; k < 18; k++) {
        const a = ph + k * TAU / 18, cz = Math.cos(a); if (cz < 0.05) continue;
        const Y = cy + Math.sin(a) * R0, rr = 1.1 + 0.9 * cz;
        ctx.fillStyle = `rgba(8,12,16,${0.35 + 0.45 * cz})`;
        for (let X = dx + 6 + (k % 2) * 4; X < dx + dw - 4; X += 8) { ctx.beginPath(); ctx.ellipse(X, Y, rr * 1.4, rr * cz, 0, 0, TAU); ctx.fill(); }
        ctx.strokeStyle = `rgba(210,220,226,${0.25 * cz})`; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(dx, Y + 3); ctx.lineTo(dx + dw, Y + 3); ctx.stroke();
      }
      ctx.restore();
      ctx.beginPath(); ctx.ellipse(dx + dw / 2, cy, dw / 2, R0, 0, 0, TAU); ctx.lineWidth = 1.4; ctx.strokeStyle = "#2b353c"; ctx.stroke();
      // бандажи и торцевые кольца
      [0.02, 0.5, 0.98].forEach((f) => { const X = dx + dw * f; ctx.fillStyle = K.pat("brushed"); ctx.fillRect(X - 3, dy - 2, 6, 2 * R0 + 4); ctx.strokeStyle = "#1c252b"; ctx.lineWidth = 0.7; ctx.strokeRect(X - 3, dy - 2, 6, 2 * R0 + 4); });
      // вал и звёздочка привода на торце со стороны мотора
      const hx = wasteLeft ? dx + dw - 2 : dx + 2;
      ctx.fillStyle = "#3a454c"; ctx.fillRect(dx, cy - 2.5, dw, 5);
      ctx.save(); ctx.translate(hx, cy); ctx.rotate(ph * 2);
      ctx.beginPath(); ctx.arc(0, 0, R0 * 0.34, 0, TAU); ctx.fillStyle = K.pat("brushed"); ctx.fill(); ctx.strokeStyle = "#1c252b"; ctx.lineWidth = 0.9; ctx.stroke();
      ctx.strokeStyle = "#262f35"; ctx.lineWidth = 1.6; for (let k = 0; k < 4; k++) { const a = k * TAU / 4; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * R0 * 0.3, Math.sin(a) * R0 * 0.3); ctx.stroke(); }
      ctx.fillStyle = "#262f35"; for (let k = 0; k < 12; k++) { const a = k * TAU / 12; ctx.fillRect(Math.cos(a) * R0 * 0.36 - 1.2, Math.sin(a) * R0 * 0.36 - 1.2, 2.4, 2.4); }
      ctx.restore();
      if (run > 0.2) { ctx.fillStyle = "rgba(220,205,160,.10)"; ctx.fillRect(wn.x, wn.y, wn.w, wn.h); }
    },
    boiler(n, wn, run, t) {
      const fire = !S.noSteam, pos = +V.SteamValve || 0, B = n._st || (n._st = { p: 0, lvl: 0.62 });
      B.p += ((fire ? 0.62 - pos / 900 : 0) - B.p) * 0.01;
      const wl = wn.y + wn.h * (1 - B.lvl);
      // вода в окне: полупрозрачная, жаровые трубы спрайта видны сквозь неё
      const gW = ctx.createLinearGradient(0, wl, 0, wn.y + wn.h); gW.addColorStop(0, "rgba(95,154,214,.55)"); gW.addColorStop(1, "rgba(31,79,134,.7)");
      ctx.fillStyle = gW; ctx.beginPath(); ctx.moveTo(wn.x, wn.y + wn.h); ctx.lineTo(wn.x, wl);
      for (let X = wn.x; X <= wn.x + wn.w; X += 6) ctx.lineTo(X, wl + (fire ? Math.sin(X / 9 + t * 7) * 2 : 0)); ctx.lineTo(wn.x + wn.w, wn.y + wn.h); ctx.closePath(); ctx.fill();
      if (fire) {
        const fl = 0.75 + 0.25 * Math.sin(t * 13) * Math.sin(t * 5), g = ctx.createRadialGradient(wn.x + wn.w * 0.6, wn.y + wn.h * 0.6, 4, wn.x + wn.w * 0.6, wn.y + wn.h * 0.6, wn.w * 0.6);
        g.addColorStop(0, `rgba(255,150,40,${0.45 * fl})`); g.addColorStop(1, "rgba(255,90,20,0)"); ctx.fillStyle = g; ctx.fillRect(wn.x, wn.y, wn.w, wn.h);
        ctx.fillStyle = "rgba(255,255,255,.8)"; for (let k = 0; k < 30; k++) { const X = wn.x + 6 + ((k * 29) % (wn.w - 12)), s2 = (t * (0.6 + hash(k) * 0.6) + hash(k + 3)) % 1, Y = wn.y + wn.h - s2 * (wn.y + wn.h - wl); ctx.beginPath(); ctx.arc(X + Math.sin(t * 6 + k) * 2, Y, 1.4 + hash(k) * 2, 0, TAU); ctx.fill(); }
        if (pos > 1) { ctx.fillStyle = "rgba(255,255,255,.45)"; for (let k = 0; k < 6; k++) { const s2 = (t * 0.8 + k / 6) % 1; ctx.beginPath(); ctx.arc(wn.x + wn.w * (0.15 + k * 0.14), wl - s2 * (wl - wn.y), 4 + s2 * 6, 0, TAU); ctx.fill(); } }
      }
    },
    cyclone(n, wn, run, t) {
      dim(wn, 0.6);
      if (run < 0.15) return;
      ctx.strokeStyle = "rgba(215,200,160,.75)"; ctx.lineWidth = 1.3;
      for (let k = 0; k < 5; k++) { const Y = wn.y + ((t * 40 + k * wn.h / 5) % wn.h), ph = t * 14 + k; ctx.beginPath(); ctx.ellipse(wn.x + wn.w / 2, Y, wn.w * 0.42, 2.5, 0, ph % TAU, ph % TAU + 2.4); ctx.stroke(); }
    },
    filter(n, wn, run, t) {
      if (!run) return;
      const sh = Math.sin(t * 22) * 0.8;
      ctx.fillStyle = "rgba(210,190,150,.18)"; ctx.fillRect(wn.x, wn.y + wn.h * 0.7 + sh, wn.w, wn.h * 0.3);
    },
    sluice(n, wn, run, t) {
      const m = M[n.id]; if (m) m._ph = (m._ph || 0) + run * 0.12;
      const ph = m ? m._ph : 0, flow = (S.granFlow || 0) > 0.05 && run > 0.2;
      dim(wn, 0.75);
      for (let k = 0; k < 6; k++) {   // карманы между лопатками — с гранулами
        const a0 = ph + k * TAU / 6;
        if (flow && Math.sin(a0 + 0.5) > -0.2) { ctx.beginPath(); ctx.moveTo(wn.cx, wn.cy); ctx.arc(wn.cx, wn.cy, wn.r * 0.9, a0 + 0.1, a0 + TAU / 6 - 0.1); ctx.closePath(); ctx.fillStyle = prodPat("pellet"); ctx.fill(); }
      }
      ctx.strokeStyle = "#c4ccd2"; ctx.lineWidth = wn.r * 0.12;
      for (let k = 0; k < 6; k++) { const a = ph + k * TAU / 6; ctx.beginPath(); ctx.moveTo(wn.cx, wn.cy); ctx.lineTo(wn.cx + Math.cos(a) * wn.r * 0.92, wn.cy + Math.sin(a) * wn.r * 0.92); ctx.stroke(); }
      ctx.beginPath(); ctx.arc(wn.cx, wn.cy, wn.r * 0.2, 0, TAU); ctx.fillStyle = K.pat("brushed"); ctx.fill(); ctx.strokeStyle = "#1c252b"; ctx.lineWidth = 1; ctx.stroke();
    },
    diverter(n, wn, run, t) {
      // заслонка на оси в развилке: прижата к стенке закрытого выхода, продукт
      // скатывается по ней в открытый. pos 0 → выход o1, pos 1 → выход o2.
      const m = M[n.id], pos = m ? m.pos : 0, z = n._spr, sg = z.flip ? -1 : 1;
      const px = wn.x + wn.w / 2, py = wn.y + wn.h - 3, L = wn.h * 0.92;
      dim(wn, 0.82);
      const ang = (0.5 - pos) * 1.15 * sg;            // 0 → к стенке o2, 1 → к стенке o1
      const o = z.P(pos < 0.5 ? z.sp.pts.o1 : z.sp.pts.o2), dir = Math.sign(o[0] - px) || 1;
      const src = EL[{ DVPT: "NorHole", PP1: "Nor6", PP2: "Pros", PP3: "Tr51100" }[n.id]], flow = !!src && src.flow > 0.05;
      const open = pos < 0.02 || pos > 0.98;
      if (flow && open) {
        const cols = KIND.grain;
        for (let k = 0; k < 18; k++) { const s2 = (t * 2.2 + k / 18) % 1, X = px - dir * L * 0.55 * (1 - s2) + dir * s2 * wn.w * 0.42, Y = wn.y + 2 + s2 * (wn.h - 4); ctx.fillStyle = cols[k % 3]; ctx.fillRect(X + (k % 3) * 2 - 2, Y, 2.4, 3); }
      }
      ctx.save(); ctx.translate(px, py); ctx.rotate(ang);
      ctx.fillStyle = K.pat("brushed"); ctx.fillRect(-3, -L, 6, L); ctx.strokeStyle = "#1c252b"; ctx.lineWidth = 0.8; ctx.strokeRect(-3, -L, 6, L);
      ctx.restore();
      ctx.beginPath(); ctx.arc(px, py, 4.5, 0, TAU); ctx.fillStyle = "#2a343b"; ctx.fill();
    },
    trash(n, wn) {
      const c = CT.trash, fr = Math.min(1, c.mass / c.cap); if (fr < 0.01) return;
      ctx.restore(); ctx.save();   // куча отходов выступает над бортом
      const x = wn.x + 4, w = wn.w - 8, top = wn.y + wn.h - (wn.h + 10) * fr;
      bulk(x, w, top, wn.y + wn.h + 4, "fines", 8);
      ctx.fillStyle = "#c9a54a"; for (let k = 0; k < 10 * fr; k++) { const X = x + hash(k) * w, Y = top + 6 + hash(k + 3) * 8; ctx.save(); ctx.translate(X, Y); ctx.rotate(hash(k + 7) * 3); ctx.fillRect(-6, -1, 12, 2); ctx.restore(); }
    },
    pit(n, wn, run, t) {
      const c = CT.pit, z = n._spr, fr = Math.min(1, c.mass / c.cap), q = z.sp.win.map(z.P);
      const [x0, yT] = q[0], x1 = q[1][0], [bl, yB] = q[3], br = q[2][0];
      const tr = ND.truck_in, tk = S.trucks && S.trucks.truck_in, rearX = tr ? tr.x + truckX("truck_in") + tr.w * 0.93 : (x0 + x1) / 2;
      dim(wn, 0.35);
      heapG(n, c, fr, {
        x: x0, w: x1 - x0, top: yT, bot: yB, nz: br - bl, cx: (bl + br) / 2, inX: Math.max(x0 + 8, Math.min(x1 - 8, rearX)), noStream: true,
        floor: (X) => X < bl ? yT + (X - x0) / (bl - x0) * (yB - yT) : X > br ? yT + (x1 - X) / (x1 - br) * (yB - yT) : yB,
      });
    },
    oilscale(n, wn, run, t) {
      const c = CT.Jir, fr = Math.min(1, c.mass / c.cap), top = wn.y + wn.h * (1 - fr);
      dim(wn, 0.9);
      if (fr > 0.01) {
        ctx.beginPath(); ctx.moveTo(wn.x, wn.y + wn.h); ctx.lineTo(wn.x, top);
        for (let X = wn.x; X <= wn.x + wn.w; X += 3) ctx.lineTo(X, top + Math.sin(X / 6 + t * 6) * (V.Go_MasloDop ? 1.6 : 0.4));
        ctx.lineTo(wn.x + wn.w, wn.y + wn.h); ctx.closePath();
        const g = ctx.createLinearGradient(0, top, 0, wn.y + wn.h); g.addColorStop(0, "#f7d35a"); g.addColorStop(1, "#a77a08"); ctx.fillStyle = g; ctx.fill();
      }
      if (V.Go_MasloDop) { ctx.fillStyle = "rgba(246,196,40,.9)"; for (let k = 0; k < 6; k++) ctx.fillRect(wn.x + wn.w * 0.3, wn.y + ((t * 90 + k * 9) % Math.max(4, top - wn.y)), 2, 5); }
    },
    tank(n, wn) {
      const c = CT[n.level]; if (!c) return;
      const fr = Math.min(1, c.mass / (c.cap || 1)), top = wn.y + wn.h * (1 - fr);
      dim(wn, 0.88);
      ctx.fillStyle = "rgba(255,255,255,.06)"; ctx.fillRect(wn.x, wn.y, wn.w, top - wn.y);
      if (fr > 0.01) { const g = ctx.createLinearGradient(0, top, 0, wn.y + wn.h); g.addColorStop(0, "#f6cf47"); g.addColorStop(1, "#b98510"); ctx.fillStyle = g; ctx.fillRect(wn.x, top, wn.w, wn.y + wn.h - top); ctx.fillStyle = "rgba(255,250,210,.7)"; ctx.fillRect(wn.x, top, wn.w, 2); }
      // змеевик подогрева
      ctx.strokeStyle = "rgba(200,120,70,.9)"; ctx.lineWidth = 3; ctx.beginPath(); for (let k = 0; k <= 5; k++) { const X = wn.x + wn.w * (0.45 + k * 0.09); ctx.moveTo(X, wn.y + wn.h * 0.35); ctx.lineTo(X, wn.y + wn.h * 0.92); } ctx.stroke();
    },
  };
  // без привода — не гасятся
  const PASSIVE = new Set(["pit", "diverter", "bigbag", "cabinet", "tank", "oilscale", "trash", "filter", "sluice"]);
  // ---------- станция биг-бэгов: мешок, рольганг выдачи, погрузчик
  function bagGeo(n, z) {
    const sp = z.sp, [sx] = z.P(sp.pts.spout), roll = z.oy + sp.roll * z.H, bw = z.W * 0.25, bh = z.H * 0.43;
    const side = S.bagSide < 0 ? -1 : 1, ex = side < 0 ? z.ox - bw / 2 - 14 : z.ox + z.W + bw / 2 + 14;
    return { sx, roll, bw, bh, side, ex, floor: z.oy + z.H };
  }
  function drawBagShape(cx, bottom, bw, bh, fr, t, hung) {
    const bxx = cx - bw / 2, by = bottom - bh, k = 0.5 + 0.5 * fr;
    ctx.beginPath(); ctx.moveTo(bxx + 6, by); ctx.lineTo(bxx + bw - 6, by);
    ctx.quadraticCurveTo(bxx + bw + 6 * fr, by + bh * 0.5, bxx + bw - 3, bottom); ctx.lineTo(bxx + 3, bottom); ctx.quadraticCurveTo(bxx - 6 * fr, by + bh * 0.5, bxx + 6, by); ctx.closePath();
    const gb = ctx.createLinearGradient(bxx, 0, bxx + bw, 0); gb.addColorStop(0, "#cfc8b2"); gb.addColorStop(0.45, "#f4f0e2"); gb.addColorStop(1, "#bdb59c"); ctx.fillStyle = gb; ctx.fill();
    ctx.save(); ctx.clip();
    if (fr > 0.01) { ctx.globalAlpha = 0.28; ctx.fillStyle = K.material("гранул", "pellet", KIND.pellet); ctx.fillRect(bxx, bottom - bh * fr, bw, bh * fr); ctx.globalAlpha = 1; ctx.fillStyle = "rgba(90,60,30,.25)"; ctx.fillRect(bxx, bottom - bh * fr, bw, 2); }
    ctx.strokeStyle = "rgba(150,140,115,.35)"; ctx.lineWidth = 0.6; for (let yy = by; yy < bottom; yy += 3) { ctx.beginPath(); ctx.moveTo(bxx, yy); ctx.lineTo(bxx + bw, yy); ctx.stroke(); }
    ctx.restore(); ctx.lineWidth = 1.2; ctx.strokeStyle = "#8d8573"; ctx.stroke();
    ctx.fillStyle = "#2f6db5"; [bxx + 7, bxx + bw - 13].forEach((X) => ctx.fillRect(X, by - (hung ? 10 : 4), 6, bh * 0.4 + (hung ? 10 : 4)));   // стропы
    ctx.fillStyle = "#e9e4d3"; ctx.fillRect(cx - bw * 0.12, by - 8, bw * 0.24, 10); ctx.strokeStyle = "#8d8573"; ctx.strokeRect(cx - bw * 0.12, by - 8, bw * 0.24, 10);   // загрузочный рукав
  }
  function bagBehind(n, z, t) {
    if (!S.bagOn) return;
    const g = bagGeo(n, z), lb = S.leb, c = CT.bigbag, fr = Math.min(1, c.mass / c.cap);
    const cx = g.sx + (g.ex - g.sx) * (lb.x || 0), lift = (lb.x || 0) < 0.02 ? 30 * (1 - (lb.y || 0)) : 0;
    drawBagShape(cx, g.roll - lift, g.bw, g.bh, fr, t, (lb.x || 0) < 0.02);
  }
  function rollers(x0, x1, roll, floor, ph) {
    const a = Math.min(x0, x1), b = Math.max(x0, x1), H = 12;
    ctx.fillStyle = "#4a555d"; ctx.fillRect(a, roll + 7, b - a, 8); ctx.fillStyle = "#2c353b"; ctx.fillRect(a, roll + 15, b - a, 2);
    for (let X = a + 8; X < b - 4; X += 34) { ctx.fillStyle = "#39434a"; ctx.fillRect(X, roll + 17, 6, floor - roll - 21); ctx.fillStyle = "#1e2428"; ctx.fillRect(X - 4, floor - 6, 14, 6); }
    for (let X = a + 6; X < b - 4; X += 11) {
      const g2 = ctx.createLinearGradient(0, roll, 0, roll + H); g2.addColorStop(0, "#c9d1d6"); g2.addColorStop(0.5, "#7e8a92"); g2.addColorStop(1, "#3c464d");
      ctx.beginPath(); ctx.arc(X, roll + 5, 5, 0, TAU); ctx.fillStyle = g2; ctx.fill(); ctx.strokeStyle = "#20292f"; ctx.lineWidth = 0.6; ctx.stroke();
      const a2 = ph + X * 0.3; ctx.strokeStyle = "rgba(30,36,40,.7)"; ctx.beginPath(); ctx.moveTo(X, roll + 5); ctx.lineTo(X + Math.cos(a2) * 4, roll + 5 + Math.sin(a2) * 4); ctx.stroke();
    }
  }
  // Колёсный диск поверх колеса картинки: поворот = пройденный путь / радиус шины,
  // поэтому колёса катятся ровно со скоростью машины и стоят, когда она стоит.
  function wheel(cx, cy, r, ang, dark) {
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(ang);
    const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
    if (dark) { g.addColorStop(0, "#5d646a"); g.addColorStop(1, "#1d2226"); } else { g.addColorStop(0, "#eef1f3"); g.addColorStop(0.6, "#a7b0b6"); g.addColorStop(1, "#5c666d"); }
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = "#20272c"; ctx.lineWidth = Math.max(0.8, r * 0.08); ctx.stroke();
    const nSlot = dark ? 5 : 8;
    for (let k = 0; k < nSlot; k++) {   // вентиляционные прорези диска
      const a = k * TAU / nSlot; ctx.save(); ctx.rotate(a); ctx.beginPath(); ctx.ellipse(r * 0.7, 0, r * 0.16, r * 0.09, 0, 0, TAU); ctx.fillStyle = "#1a1f23"; ctx.fill(); ctx.restore();
    }
    ctx.beginPath(); ctx.arc(0, 0, r * 0.44, 0, TAU); ctx.fillStyle = dark ? "#2c3237" : "#7f8a91"; ctx.fill();
    for (let k = 0; k < (dark ? 5 : 10); k++) {   // гайки крепления
      const a = k * TAU / (dark ? 5 : 10); ctx.beginPath(); ctx.arc(Math.cos(a) * r * 0.32, Math.sin(a) * r * 0.32, Math.max(0.7, r * 0.065), 0, TAU); ctx.fillStyle = dark ? "#8a949a" : "#d9dfe3"; ctx.fill();
    }
    ctx.beginPath(); ctx.arc(0, 0, r * 0.15, 0, TAU); ctx.fillStyle = "#30383e"; ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,.35)"; ctx.fillRect(-r * 0.04, -r * 0.42, r * 0.08, r * 0.2);   // метка — видно вращение
    ctx.restore();
  }
  // координаты колёс на картинках (доли ширины/высоты; при зеркалировании x → 1 − x)
  const WHEELS = {
    truck: { r: 0.075, rim: 0.043, pts: [[0.121, 0.823], [0.625, 0.826], [0.795, 0.826]] },
    forklift: { pts: [[0.371, 0.840, 0.10, 0.052], [0.871, 0.876, 0.08, 0.042]] },
  };
  function bagHint() {
    const lb = S.leb, f = S.fork, m = CT.bigbag.mass, cap = CT.bigbag.cap, kg = `${Math.round(m)} кг`;
    if (f.phase === "arrive") return ["погрузчик едет за мешком", "ok"];
    if (f.phase === "lift") return ["погрузчик поднимает мешок", "ok"];
    if (f.phase === "leave") return ["погрузчик увозит мешок", "ok"];
    if (!S.bagOn) return ["мешок вывезен — тележку в поз. 1", "warn"];
    if (V.Leb_Pol2) return m >= 50 ? ["мешок на выдаче — ждёт погрузчик", "ok"] : ["мешок пуст — погрузчик не вызывается", "warn"];
    if (!V.Leb_Pol1) return [`тележка едет · ${kg}`, ""];
    if (m >= cap - 1) return ["мешок полон — поз. 2 (выдача)", "warn"];
    if (!V.Leb_Dn) return [`опустите мешок ▼ · ${kg}`, "warn"];
    if ((CT.s10 || {}).mass <= 0.5) return [`бункер 310 пуст · ${kg}`, "warn"];
    if (!S.bagValve) return [`откройте затвор · ${kg}`, "warn"];
    return [`налив ${kg} из ${cap}`, "ok"];
  }
  function forklift(n, z, t) {
    const f = S.fork, im = IMG.m_forklift; if (!im || f.phase === "away") return;
    const g = bagGeo(n, z), side = f.side < 0 ? -1 : 1, FH = z.H * 0.62, FW = FH * im.width / im.height, sp = MSPR.forklift;
    // вилы под мешком: острия до середины мешка; подъезд — с выбранной стороны
    const drive = side * f.x * 520, tipX = g.ex - side * g.bw * 0.05 + drive, mastX = tipX + side * FW * 0.2, forkY = g.roll + 2 - f.lift * 26;
    const left = side > 0 ? mastX - sp.mast * FW : mastX - (1 - sp.mast) * FW, top = g.floor - FH;
    const key = side > 0 ? "m_forklift" : "m_forklift_flip";
    ctx.save();
    // родные вилы спрайта у пола вырезаем — вместо них каретка с вилами на нужной высоте
    ctx.beginPath(); ctx.rect(left - 2, top - 2, FW + 4, FH + 4);
    const fx0 = side > 0 ? left - 2 : left + (1 - sp.mast) * FW, fx1 = side > 0 ? left + sp.mast * FW : left + FW + 2;
    ctx.rect(fx1, top + FH * 0.84, fx0 - fx1, FH * 0.17); ctx.clip("evenodd");
    ctx.drawImage(mipImg(key, FW), left, top, FW, FH); ctx.restore();
    WHEELS.forklift.pts.forEach(([fx, fy, rt, rr]) => wheel(left + (side > 0 ? fx : 1 - fx) * FW, top + fy * FH, rr * FW, left / (rt * FW), true));
    ctx.fillStyle = "#2b3136"; ctx.fillRect(mastX - (side > 0 ? 3 : 0), forkY - 24, 4, 26);                          // каретка
    ctx.fillStyle = "#3a4248"; ctx.fillRect(Math.min(mastX, tipX - side * 6), forkY, Math.abs(mastX - tipX) + 6, 4);   // вилы
    ctx.fillStyle = "#5d676e"; ctx.fillRect(Math.min(mastX, tipX - side * 6), forkY, Math.abs(mastX - tipX) + 6, 1.2);
    if (f.load > 0) drawBagShape(mastX - side * (g.bw / 2 + 2), forkY, g.bw, g.bh, Math.min(1, f.load / CT.bigbag.cap), t, false);
    const st = { arrive: "погрузчик подъезжает", lift: "подъём мешка", leave: "вывоз мешка" }[f.phase];
    if (st) badge(st, mastX + side * FW * 0.4, top - 12, { size: 11 });
  }
  function drawMach(n) {
    const z = n._spr, im = IMG[z.img], t = T(), m = M[n.id === "Pros" ? "Pros1" : n.id];
    const run = n.id === "Pros" ? Math.max(M.Pros1.spin, M.Pros2.spin) : m ? m.spin : 0;
    let jx = 0, jy = 0;
    if (n.kind === "crusher" || n.kind === "press") { const cur = n.kind === "press" ? +V.TokGran || 0 : n.id === "Drob1" ? +V.TokDrob1 || 0 : +V.TokDrob2 || 0; [jx, jy] = jit(n.id, run > 0.2 ? 0.4 + Math.min(1, cur / 120) : 0, 90); }
    if (n.kind === "sifter" && run > 0.2) { jx = Math.cos(t * 75) * 1.8 * run; jy = Math.sin(t * 75) * 1.3 * run; }
    if (n.kind === "compressor" && running("compr")) { jy = Math.sin(t * 90) * 0.6; }
    ctx.save(); ctx.translate(jx, jy);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    if (n.kind === "bigbag") bagBehind(n, z, t);
    drawLit(z.img, z.W, z.ox, z.oy, z.H, PASSIVE.has(n.kind) ? 1 : run);
    const wn = machWin(n), f = INSIDE[z.name];
    if (wn && f) { ctx.save(); clipWin(wn); f(n, wn, run, t); ctx.restore(); }
    ctx.restore();
    machOverlay(n, run, t);
  }
  function noriaPart(n, z, run, t, ph, head) {
    const im = IMG[z.img]; if (!im) return;
    drawLit(z.img, z.W, z.ox, z.oy, z.H, run);
    const pts = z.sp.win.map(z.P), [cx, cy] = z.P(z.sp.pul), r = z.sp.pul[2] * z.W, c = CT[n.id], e = EL[n.id];
    const load = c ? Math.min(1, c.mass / Math.max(1, c.cap * 0.25)) : 0, kind = (c && c.kind) || (e && e.kinds[0]) || "grain", prod = e && e.prod;
    ctx.save(); K.path(pts, true); ctx.clip();
    ctx.fillStyle = "rgba(10,16,24,.82)"; ctx.fillRect(z.ox, z.oy, z.W, z.H);
    const ys = pts.map((q) => q[1]), y0 = Math.min(...ys) - 4, y1 = Math.max(...ys) + 4;
    // насыпь в башмаке: продукт с загрузочного носка, ковши черпают её снизу
    let heapTop = y1;
    if (!head && e) {
      const fr = Math.min(1, (e.cells[0] + e.cells[1]) / (e.cap * 2.2));
      if (fr > 0.02) {
        const xs = pts.map((q) => q[0]), xa = Math.min(...xs), xb = Math.max(...xs); heapTop = y1 - (y1 - cy) * 1.6 * fr;
        ctx.beginPath(); ctx.moveTo(xa, y1); ctx.lineTo(xa, heapTop - 6); ctx.quadraticCurveTo((xa + xb) / 2, heapTop + 4, xb, heapTop + 8); ctx.lineTo(xb, y1); ctx.closePath();
        ctx.fillStyle = matPat(kind, prod); ctx.fill(); ctx.fillStyle = "rgba(20,12,2,.3)"; ctx.fill();
      }
    }
    // лента: у головки вверх слева → через верх → вниз справа; у башмака вниз справа → под барабаном → вверх слева
    const seg = head ? y1 - cy : cy - y0;
    ctx.strokeStyle = "#2b2f33"; ctx.lineWidth = 3.5; ctx.beginPath();
    if (head) { ctx.moveTo(cx - r, y1); ctx.lineTo(cx - r, cy); ctx.arc(cx, cy, r, Math.PI, TAU, false); ctx.lineTo(cx + r, y1); }
    else { ctx.moveTo(cx + r, y0); ctx.lineTo(cx + r, cy); ctx.arc(cx, cy, r, 0, Math.PI, false); ctx.lineTo(cx - r, y0); }
    ctx.stroke();
    const L = 2 * seg + Math.PI * r, step = 15, off = (ph * 26) % step;
    for (let d = -off; d < L; d += step) {
      let bx, by, ang, full;
      if (d < seg) { if (head) { bx = cx - r; by = y1 - d; ang = Math.PI; full = true; } else { bx = cx + r; by = y0 + d; ang = 0; full = false; } }
      else if (d < seg + Math.PI * r) { const a = (d - seg) / r; ang = head ? Math.PI + a : a; bx = cx + Math.cos(ang) * r; by = cy + Math.sin(ang) * r; full = head ? a < Math.PI * 0.55 : a > Math.PI * 0.45 && by + 4 > heapTop - 2 || a > Math.PI * 0.7 && load > 0.03; }
      else { const dd = d - seg - Math.PI * r; if (head) { bx = cx + r; by = cy + dd; ang = 0; full = false; } else { bx = cx - r; by = cy - dd; ang = Math.PI; full = load > 0.03; } }
      ctx.save(); ctx.translate(bx, by); ctx.rotate(ang + Math.PI / 2);
      ctx.fillStyle = "#e0782a"; ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(6, 0); ctx.lineTo(4, 7); ctx.lineTo(-4, 7); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "#7a3a10"; ctx.lineWidth = 0.6; ctx.stroke();
      if (load > 0.03 && run > 0.1 && full) { ctx.fillStyle = matPat(kind, prod); ctx.fillRect(-4.5, 0.3, 9, 3.6); }
      ctx.restore();
    }
    // барабан со спицами: вращается по часовой — как и лента
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.92, 0, TAU); ctx.fillStyle = K.pat("brushed"); ctx.fill(); ctx.strokeStyle = "#1c252b"; ctx.lineWidth = 1; ctx.stroke();
    ctx.strokeStyle = "#39434a"; ctx.lineWidth = 2.2;
    for (let k = 0; k < 6; k++) { const a = ph * 26 / r + k * TAU / 6; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r * 0.2, cy + Math.sin(a) * r * 0.2); ctx.lineTo(cx + Math.cos(a) * r * 0.82, cy + Math.sin(a) * r * 0.82); ctx.stroke(); }
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.2, 0, TAU); ctx.fillStyle = "#2a343b"; ctx.fill();
    // сброс: ковши, переваливая через барабан, выбрасывают продукт в выпускной патрубок
    if (head && load > 0.03 && run > 0.3) {
      const cols = (K.matSpec(prod, kind) || {}).cols || KIND[kind] || KIND.grain;
      for (let k = 0; k < 22; k++) { const s2 = (t * 2.2 * run + k / 22) % 1, a0 = -Math.PI * 0.35; const X = cx + Math.cos(a0) * r + s2 * r * 1.9, Y = cy + Math.sin(a0) * r + s2 * s2 * r * 2.4 + (k % 3) * 2; ctx.fillStyle = cols[k % 3]; ctx.save(); ctx.translate(X, Y); ctx.rotate(k + t * 6); ctx.fillRect(-1.6, -1, 3.2, 2); ctx.restore(); }
    }
    ctx.restore();
  }
  function drawNoriaSpr(n) {
    DRAW.noria(n);
    const m = M[n.id], run = m ? m.spin : 0, t = T();
    if (m) m._ph = (m._ph || 0) + run * 0.115;
    const ph = m ? m._ph : 0;
    noriaPart(n, n._nb, run, t, ph, false);
    noriaPart(n, n._nh, run, t, ph, true);
    led(...n._nh.P([0.12, 0.2]), n.id, 6);
  }
  // показания и индикаторы поверх спрайта
  function machOverlay(n, run, t) {
    const z = n._spr, x = n.x, y = n.y, w = n.w, h = n.h;
    const ok = (bad) => ({ color: bad ? "#ff6a5a" : "#5cf08a", edge: bad ? "#ff6a5a" : "#47e07a" });
    switch (n.kind) {
      case "crusher": {
        const cur = n.id === "Drob1" ? V.TokDrob1 : V.TokDrob2, max = n.id === "Drob1" ? V.TokMax1 : V.TokMax2, [mx, my] = z.P([0.82, 0.76]);
        badge((cur || 0) + " А", mx, my + h * 0.2, Object.assign({ size: 17 }, ok((cur || 0) > max)));
        led(...z.P([0.68, 0.2]), n.id, 7);
        if ((CT[n.id] && CT[n.id].mass > 0.2) && run > 0.2) { const [ox, oy] = z.P(z.sp.pts.out); ctx.fillStyle = kc("meal", 1); for (let k = 0; k < 10; k++) { const Y = oy - 30 + ((t * 90 + k * 7) % 30); ctx.fillRect(ox - 10 + (k * 7) % 20, Y, 2, 3); } }
        break;
      }
      case "press": {
        const cur = +V.TokGran || 0, [mx, my] = z.P([0.12, 0.36]);
        badge(cur + " А", mx, my, Object.assign({ size: 16 }, ok(cur > V.TokMaxGran)));
        if (S.dieJam) badge("МАТРИЦА ЗАБИТА", ...z.P([0.62, 0.92]), { size: 14, color: "#fff", bg: "#b3141a", edge: "#ff8080" });
        led(...z.P([0.82, 0.2]), n.id, 7);
        if (faulty(n.id) || V.Err30_8) faultFrame(x, y, w, h);
        return;
      }
      case "mixer": {
        led(...z.P([0.95, 0.9]), n.id, 7);
        const st = mixStage(); if (st) badge(st, x + w / 2, y + h + 64, { size: 15, edge: "#4b8fd1", color: "#bfe0ff" });
        const dp = (M.ShDownSms && M.ShDownSms.pos) || 0; if (dp > 0.3) { const [ox, oy] = z.P([0.47, 0.82]); badge("створки открыты", ox, oy + 26, { size: 11, edge: "#47e07a" }); }
        break;
      }
      case "conditioner":
        badge((+V.TempKond || 0).toFixed(0) + " °C", x + w + 36, y + h * 0.45, { size: 15, color: (+V.TempKond || 0) < V.TempKondMin ? "#ffd166" : "#5cf08a" });
        led(...z.P([0.1, 0.9]), n.id, 6);
        break;
      case "cooler": {
        const k3 = [["ДВУ", V.DVU_OhlGr, 0.28], ["ДСУ", V.DSU_OhlGr, 0.42], ["ДНУ", V.DNU_OhlGr, 0.57]];
        k3.forEach(([tt, on, k]) => levelSensor(...z.P([0.76, k]), on, tt === "ДВУ"));
        badge((+V.TempGranOut || 0).toFixed(0) + " °C", ...z.P([0.45, 0.27]), { size: 15 });
        if (V.OpenStol && CT.Ohl.mass > 5) { const [ox, oy] = z.P([0.485, 0.72]); ctx.fillStyle = kc("pellet", 1); for (let k = 0; k < 10; k++) ctx.fillRect(ox - 12 + (k * 5) % 24, oy + ((t * 100 + k * 8) % (h * 0.16)), 3, 6); }
        led(...z.P([0.1, 0.86]), "Ohl", 6);
        return;
      }
      case "sifter":
        [["Pros1", 0.83, 0.3], ["Pros2", 0.83, 0.42]].forEach(([id, fx, fy]) => led(...z.P([fx + 0.12, fy]), id, 5));
        break;
      case "scalp": led(...z.P([0.25, 0.3]), n.id, 6); break;
      case "boiler": {
        const B = n._st || { p: 0 }, [gx, gy] = z.P([0.87, 0.24]);
        badge(`${B.p.toFixed(2)} МПа`, gx, gy - 34, { size: 13 });
        if (S.noSteam) badge("НЕТ ПАРА", x + w * 0.2, y + h * 0.08, { size: 15, color: "#fff", bg: "#b3141a", edge: "#ff8080" });
        else badge("Горелка: работа", x + w * 0.2, y + h * 0.08, { size: 13, edge: "#47e07a" });
        if (!S.noSteam) { const [bx, by] = z.P([0.06, 0.46]); ctx.beginPath(); ctx.arc(bx, by, 5, 0, TAU); ctx.fillStyle = `rgba(255,${130 + 60 * Math.sin(t * 20)},40,.9)`; ctx.fill(); }
        label(n.label, x + w / 2, y + h + 46, { size: 17 });
        return;
      }
      case "tank": { const c = CT[n.level]; if (c) badge(Math.round(c.mass) + " кг", x + w * 0.54, y + h * 0.66, { size: 16 }); label(n.label, x + w / 2, y - 8, { size: 15 }); return; }
      case "cyclone": {
        led(...z.P([0.72, 0.2]), n.id, 6);
        if (n._fan && IMG[n._fan.img]) {
          const f = n._fan, wn = { cx: f.P(f.sp.circle)[0], cy: f.P(f.sp.circle)[1], r: f.sp.circle[2] * f.W };
          ctx.drawImage(mipImg(f.img, f.W), f.ox, f.oy, f.W, f.H);
          const m = M[n.id]; if (m) m._fph = (m._fph || 0) + run * 0.5;
          ctx.save(); ctx.beginPath(); ctx.arc(wn.cx, wn.cy, wn.r, 0, TAU); ctx.clip();
          if (run > 0.15) {
            ctx.fillStyle = "rgba(10,16,24,.78)"; ctx.fillRect(wn.cx - wn.r, wn.cy - wn.r, 2 * wn.r, 2 * wn.r);
            const ph = (m && m._fph) || 0; ctx.strokeStyle = "#c4ccd2"; ctx.lineWidth = Math.max(1, wn.r * 0.1);
            for (let k = 0; k < 12; k++) { const a = ph + k * TAU / 12; ctx.beginPath(); ctx.moveTo(wn.cx + Math.cos(a) * wn.r * 0.35, wn.cy + Math.sin(a) * wn.r * 0.35); ctx.quadraticCurveTo(wn.cx + Math.cos(a + 0.35) * wn.r * 0.75, wn.cy + Math.sin(a + 0.35) * wn.r * 0.75, wn.cx + Math.cos(a + 0.55) * wn.r * 0.95, wn.cy + Math.sin(a + 0.55) * wn.r * 0.95); ctx.stroke(); }
            ctx.beginPath(); ctx.arc(wn.cx, wn.cy, wn.r * 0.3, 0, TAU); ctx.fillStyle = K.pat("brushed"); ctx.fill();
          }
          ctx.restore();
          // колпак на выхлопной трубе
          const top = DUCTS.find((d) => d.stack && d.id === n.id);
          if (top) { const [qx, qy] = top.pts[1]; ctx.fillStyle = K.pat("galv"); K.path([[qx - 20, qy - 2], [qx, qy - 14], [qx + 20, qy - 2]], true); ctx.fill(); ctx.strokeStyle = "#3d4850"; ctx.lineWidth = 1; ctx.stroke(); }
          led(...f.P([0.1, 0.7]), n.id, 5);
        }
        const im = IMG.m_trash, [ox, oy] = z.P(z.sp.pts.out); if (!im) return;
        const st = n._dust || (n._dust = { v: 0.25 }); if (run > 0.2) st.v = Math.min(0.95, st.v + 0.00004);
        const W = 50, H = W * im.naturalHeight / im.naturalWidth, bx = ox - W / 2, by = oy + 26;
        ctx.fillStyle = K.pat("galv"); ctx.fillRect(ox - 4, oy, 8, by - oy + 4); ctx.strokeStyle = "#3d4850"; ctx.lineWidth = 0.8; ctx.strokeRect(ox - 4, oy, 8, by - oy + 4);
        if (run > 0.2) { ctx.fillStyle = "rgba(200,185,140,.8)"; for (let k = 0; k < 5; k++) ctx.fillRect(ox - 2 + (k % 2) * 2, oy + ((t * 40 + k * 6) % (by - oy)), 1.6, 2); }
        ctx.drawImage(mipImg("m_trash", W), bx, by, W, H);
        bulk(bx + 5, W - 10, by + 2 + (H * 0.18) * (1 - st.v), by + H * 0.2, "fines", 4);
        label("Пыль", ox, by + H + 13, { size: 11 });
        return;
      }
      case "filter": led(...z.P([0.86, 0.3]), n.id, 5); return;
      case "sluice": led(...z.P([0.86, 0.15]), n.id, 5); return;
      case "diverter": {
        const m = M[n.id], pos = m ? m.pos : 0, mid = pos > 0.02 && pos < 0.98, o = z.P(pos < 0.5 ? z.sp.pts.o1 : z.sp.pts.o2);
        badge(mid ? "⇄" : o[0] > x + w / 2 ? "▶" : "◀", ...z.P([0.5, 0.86]), { size: 11, edge: mid ? "#f0c040" : undefined }); if (faulty(n.id)) faultFrame(x, y, w, h); return; }
      case "box": label(n.label + " " + Math.round(CT.trash.mass) + " кг", x + w / 2, y + h + 18, { size: 15, w: 700 }); return;
      case "pit": {
        const c = CT.pit, gy = z.oy + z.sp.grate * h, [wl, wr] = z.sp.wall.map((f) => x + f * w), sc = ND.TrHole;
        // проём в бетонной стене там, где её пересекает ТС 10110
        if (sc) { const k = (sc.y2 - sc.y1) / (sc.x2 - sc.x1), yc = sc.y1 + k * ((wl + wr) / 2 - sc.x1); ctx.fillStyle = "#11171c"; ctx.fillRect(wl - 1, yc - 30, wr - wl + 2, 52); ctx.strokeStyle = "#5b6266"; ctx.lineWidth = 1.5; ctx.strokeRect(wl - 1, yc - 30, wr - wl + 2, 52); }
        // задвижка выпуска открыта, пока работает ТС 10110
        const [ox, oy] = z.P(z.sp.pts.out), open = running("TrHole") && c.mass > 5;
        if (sc) K.pipe([[ox, oy - 2], [ox, oy + 4], [sc.x1 - 6, sc.y1 - 16]], 12, { kind: "galv" });
        badge(open ? "задвижка откр." : "задвижка закр.", ox - 62, oy - 4, { size: 10, edge: open ? "#47e07a" : "#89a0b3", color: open ? "#5cf08a" : "#d7e5f0" });
        if (open) { const cols = (K.matSpec(c.prod, "grain") || {}).cols || KIND.grain; for (let k = 0; k < 10; k++) { ctx.fillStyle = cols[k % 3]; ctx.fillRect(ox - 4 + (k % 3) * 3, oy + ((t * 70 + k * 4) % 12), 2.4, 3); } }
        // разгрузка самосвала: струя из кузова сквозь решётку в насыпь
        if (S.pitDump) {
          const tr = ND.truck_in, rx = tr.x + truckX("truck_in") + tr.w * 0.97, ry = tr.y + tr.h * 0.45, st = n._heap;
          const cols = (K.matSpec(S.trucks.truck_in.material, "grain") || {}).cols || KIND.grain, sy = st ? Math.min(...Array.from(st.F, (f, i) => f - st.H[i])) : gy + 60;
          for (let k = 0; k < 70; k++) {
            const s2 = (t * 1.6 + k / 70) % 1, X = rx + 6 + s2 * 14 + (hash(k) - 0.5) * 18 * s2, Y = ry + s2 * (sy - ry);
            ctx.fillStyle = cols[k % 3]; ctx.fillRect(X, Y, 2.6, 3.4);
          }
          ctx.fillStyle = "rgba(225,205,150,.18)"; ctx.beginPath(); ctx.ellipse(rx + 14, gy, 46, 10, 0, 0, TAU); ctx.fill();
        }
        badge((c.mass / 1000).toFixed(1) + " т", x + w / 2, y + h * 0.36, { size: 17 }); label(n.label, x + w / 2, y + h + 22, { size: 16 }); return; }
      case "oilscale": {
        const [dx, dy] = z.P([0.95, 0.33]); ctx.fillStyle = "#0b1114"; ctx.fillRect(dx - 22, dy - 9, 44, 16);
        ctx.font = "700 12px 'Courier New', monospace"; ctx.fillStyle = "#ff5040"; ctx.textAlign = "center"; ctx.fillText((+V.Ves4 || 0).toFixed(2), dx, dy + 3);
        label("УДЖК", x + w / 2, y - 12, { size: 16 }); led(...z.P([0.82, 0.12]), "Jir", 5); return;
      }
      case "bigbag": {
        const g = bagGeo(n, z), lbm = S.leb, ph = (lbm.x || 0) * 40;
        rollers(g.side < 0 ? z.ox + z.W * z.sp.rollL + 4 : z.ox + z.W - 6, g.ex + g.side * (g.bw / 2 + 12), g.roll, g.floor, ph);
        if (S.bagOn && (lbm.x || 0) > 0.02) {
          const cx = g.sx + (g.ex - g.sx) * lbm.x, hid = g.side > 0 ? cx - g.bw / 2 < z.ox + z.W : cx + g.bw / 2 > z.ox;   // выходит из-за рамы
          if (hid) { ctx.save(); ctx.beginPath(); g.side > 0 ? ctx.rect(z.ox + z.W, g.roll - g.bh - 20, 999, g.bh + 30) : ctx.rect(z.ox - 999, g.roll - g.bh - 20, 999, g.bh + 30); ctx.clip(); drawBagShape(cx, g.roll, g.bw, g.bh, Math.min(1, CT.bigbag.mass / CT.bigbag.cap), t, false); ctx.restore(); }
          else drawBagShape(cx, g.roll, g.bw, g.bh, Math.min(1, CT.bigbag.mass / CT.bigbag.cap), t, false);
        }
        // течка: выпуск бункера 310 → задвижка → патрубок через балку → наливная головка
        const [hx, hy] = z.P(z.sp.pts.head), to = A.Torba && A.Torba.out;
        if (to) {
          K.pipe([[to[0], to[1] - 4], [hx, hy + 2]], 16, { kind: "galv" });
          K.flange(hx, hy - 1, 0, 1, 16); K.flange(hx, z.oy + 2, 0, 1, 18); K.flange(to[0], to[1] + 2, 0, 1, 16);
          const gy = to[1] + 10, open = !!S.bagValve;
          K.rr(to[0] - 15, gy, 30, 11, 2); K.skin("paint", null, "#1f2a30", 1); ctx.fillStyle = open ? "#47e07a" : "#c0392b"; ctx.fillRect(to[0] + 9, gy + 3, 4, 5);
          ctx.strokeStyle = "#2a343b"; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(to[0] + 15, gy + 5); ctx.lineTo(to[0] + 26, gy + 5); ctx.stroke(); ctx.beginPath(); ctx.arc(to[0] + 29, gy + 5, 4, 0, TAU); ctx.stroke();
          badge(open ? "затвор откр." : "затвор закр.", to[0] - 58, gy + 6, { size: 10, edge: open ? "#47e07a" : "#89a0b3", color: open ? "#5cf08a" : "#d7e5f0" });
        }
        forklift(n, z, t);
        // что сейчас со станцией и какой следующий шаг оператора
        const [hint, tone] = bagHint();
        badge(hint, x + w * 0.83, y + h + 16, { size: 11, edge: tone === "ok" ? "#47e07a" : tone === "warn" ? "#f0c040" : "#89a0b3", color: tone === "ok" ? "#5cf08a" : tone === "warn" ? "#ffe08a" : "#d7e5f0" });
        const [sx, sy] = z.P(z.sp.pts.spout);
        if (S.bagFill) { const cols = (K.matSpec("гранул", "pellet") || {}).cols || KIND.pellet; for (let k = 0; k < 12; k++) { ctx.fillStyle = cols[k % 3]; ctx.fillRect(sx - 5 + (k % 4) * 3, sy + ((t * 70 + k * 5) % 18), 3, 5); } }
        led(...z.P([0.9, 0.4]), "Leb", 6); return;
      }
      case "cabinet": {
        [["lr", "Авария", V.RunLamp, COL.bad], ["ly", "Сирена", V.RunSirena, COL.warn], ["lg", "ПУСК", !V.EmerPuskBtn, COL.ok]].forEach(([k, tt, on, c]) => {
          const [X, Y] = z.P(z.sp.pts[k]), bl = on && tt !== "ПУСК" ? Math.floor(t * 2.5) % 2 : 1, r = h * 0.045;
          if (on && bl) { ctx.beginPath(); ctx.arc(X, Y, r * 1.9, 0, TAU); ctx.fillStyle = c + "55"; ctx.fill(); ctx.beginPath(); ctx.arc(X, Y, r, 0, TAU); ctx.fillStyle = c; ctx.fill(); ctx.beginPath(); ctx.arc(X - r * 0.3, Y - r * 0.3, r * 0.3, 0, TAU); ctx.fillStyle = "rgba(255,255,255,.7)"; ctx.fill(); }
          label(tt, X + r * 2.2, Y + 6, { size: 15, w: 800, align: "left" });
        });
        if (V.EmerStopShkaf) { const [X, Y] = z.P(z.sp.pts.es); ctx.beginPath(); ctx.arc(X, Y, h * 0.09, 0, TAU); ctx.fillStyle = "rgba(255,80,60,.45)"; ctx.fill(); }
        if (IMG.logo) {   // фирменная табличка SYSAT на средней дверце
          const im = IMG.logo, [cx, cy] = z.P([0.502, 0.66]), pw = w * 0.15, ph = pw * im.height / im.width, px = cx - pw / 2, py = cy - ph / 2;
          K.rr(px - 6, py - 5, pw + 12, ph + 10, 2.5); ctx.fillStyle = "#f6f7f4"; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = "#8d969b"; ctx.stroke();
          ctx.drawImage(im, px, py, pw, ph);
          [[px - 2.5, py - 1.5], [px + pw + 2.5, py - 1.5], [px - 2.5, py + ph + 1.5], [px + pw + 2.5, py + ph + 1.5]].forEach(([rx, ry]) => { ctx.beginPath(); ctx.arc(rx, ry, 1.4, 0, TAU); ctx.fillStyle = "#9aa1a5"; ctx.fill(); });
        }
        const [hx, hy] = z.P(z.sp.pts.hmi); ctx.fillStyle = "rgba(90,200,255,.55)"; ctx.fillRect(hx - w * 0.04, hy - h * 0.04, w * 0.08, h * 0.08);
        label(n.label, x + w / 2, y - 14, { size: 18 }); return;
      }
      case "compressor": label(n.label, x + w / 2, y + h + 18, { size: 14 }); if (V.LowPress) badge("Низкое давление", x + w / 2, y - 14, { size: 12, color: "#fff", bg: "#b3141a", edge: "#ff8080" }); return;
    }
    if (faulty(n.id === "Pros" ? "Pros1" : n.id)) faultFrame(x, y, w, h);
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
      if (id === "TrHole") { x = (n.x1 + n.x2) / 2 + 40; y = (n.y1 + n.y2) / 2 + 34; align = "left"; }
      if (id === "Leb") { x = n.x + n.w * 0.83; y = n.y - 10; }
      if (id === "KondGr") { x = n.x - 12; y = n.y + n.h * 0.62; align = "right"; }
      if (id === "PitGr") { x = 2560; y = 1608; align = "right"; }
      if (id === "Tr40300") y = n.cy - 26;
      if (n.kind === "cyclone" && n._fan) { x = n._fan.ox + n._fan.W / 2; y = n._fan.oy + n._fan.H + 22; if (n._fan.ox + n._fan.W > S.W - 60) { x = n.x + n.w / 2; y = n.y + n.h + 58; } }
      if (id === "Pros") { x = n.x + n.w * 0.3; y = n.y - 10; align = "left"; }
      if (id === "Ohl") { x = n.x - 10; y = n.y + 60; align = "right"; }
      if (id === "Gran") { x = n.x - 12; y = n.y + n.h * 0.62; align = "right"; }
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
  /* ---------- новогодняя гирлянда по периметру схемы: провод с провисами, приглушённые лампы
     с мягким ореолом, щиток «ГИРЛЯНДА» с кнопками ПУСК / СТОП. Состояние — в localStorage. */
  const GAR_KEY = "bugry-garland";
  const GAR = (() => { let o = {}; try { o = JSON.parse(localStorage.getItem(GAR_KEY) || "{}"); } catch (e) { /* нет хранилища */ } return { show: o.show !== false, run: !!o.run }; })();
  const garSave = () => { try { localStorage.setItem(GAR_KEY, JSON.stringify(GAR)); } catch (e) { /* нет хранилища */ } };
  const GAR_COL = ["#e9b34a", "#c9584a", "#4f9e7c", "#5a83c4", "#efe2c2"];
  const GAR_BOX = { x: 48, y: 1720, w: 168, h: 66 }, GAR_K = 1.4;
  let garGeo = null, garSpr = null, garFade = 0;
  function garBuild() {
    const m = 16, sag = 22, span = 240, wire = [], bulbs = [];
    const edge = (x0, y0, x1, y1, side) => {   // side: 0 верх, 1 право, 2 низ, 3 лево
      const L = Math.hypot(x1 - x0, y1 - y0), nSp = Math.max(1, Math.round(L / span)), ux = (x1 - x0) / L, uy = (y1 - y0) / L;
      for (let k = 0; k <= nSp * 24; k++) {
        const f = k / (nSp * 24), u = (f * nSp) % 1, d = Math.sin(Math.PI * u);
        const px = x0 + ux * L * f, py = y0 + uy * L * f;
        wire.push(side === 0 || side === 2 ? [px, py + sag * d] : [px + (side === 1 ? -10 : 10) * d, py]);
      }
    };
    const W = S.W, H = S.H;
    edge(m, m, W - m, m, 0); edge(W - m, m, W - m, H - m - sag, 1); edge(W - m, H - m - sag, m, H - m - sag, 2); edge(m, H - m - sag, m, m, 3);
    let acc = 0, i = 0;
    for (let k = 1; k < wire.length; k++) {
      const [ax, ay] = wire[k - 1], [bx, by] = wire[k]; acc += Math.hypot(bx - ax, by - ay);
      if (acc >= 46) { acc = 0; const side = bx < m + 12 ? 3 : bx > W - m - 12 ? 1 : 0; bulbs.push({ x: bx, y: by, a: side === 3 ? Math.PI / 2 : side === 1 ? -Math.PI / 2 : 0, c: i % GAR_COL.length, i: i++ }); }
    }
    garGeo = { wire, bulbs };
  }
  function garSprites() {
    const mk = (w, h, f) => { const c = document.createElement("canvas"); c.width = w; c.height = h; f(c.getContext("2d")); return c; };
    const bulb = (col, lit) => mk(32, 52, (g) => {
      g.fillStyle = "#24342a"; g.fillRect(11, 0, 10, 12); g.fillStyle = "rgba(255,255,255,.25)"; g.fillRect(12, 1, 2, 10);
      g.beginPath(); g.moveTo(16, 10); g.bezierCurveTo(28, 18, 28, 36, 16, 50); g.bezierCurveTo(4, 36, 4, 18, 16, 10); g.closePath();
      const gr = g.createRadialGradient(13, 26, 1, 16, 30, 18);
      if (lit) { gr.addColorStop(0, "#fffaf0"); gr.addColorStop(0.35, col); gr.addColorStop(1, col); g.globalAlpha = 1; }
      else { gr.addColorStop(0, "rgba(255,255,255,.55)"); gr.addColorStop(0.3, col + "88"); gr.addColorStop(1, col + "55"); }
      g.fillStyle = gr; g.fill(); g.lineWidth = 1; g.strokeStyle = "rgba(30,30,30,.45)"; g.stroke();
      g.fillStyle = "rgba(255,255,255,.7)"; g.beginPath(); g.ellipse(12, 24, 2, 5, -0.3, 0, TAU); g.fill();
    });
    const glow = (col) => mk(96, 96, (g) => { const gr = g.createRadialGradient(48, 48, 2, 48, 48, 48); gr.addColorStop(0, col + "aa"); gr.addColorStop(0.4, col + "44"); gr.addColorStop(1, col + "00"); g.fillStyle = gr; g.fillRect(0, 0, 96, 96); });
    garSpr = GAR_COL.map((c) => ({ off: bulb(c, false), on: bulb(c, true), glow: glow(c) }));
  }
  function garLevel(b, t) {   // яркость лампы по программе: бегущая волна → мерцание → чередование → ровный свет
    const ph = (t / 11) % 4, mode = Math.floor(ph), mix = Math.min(1, (ph % 1) * 11);
    const f = (md) => md === 0 ? 0.2 + 0.8 * Math.pow(Math.max(0, Math.cos(b.i * 0.32 - t * 2.4)), 6)
      : md === 1 ? 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * (1.1 + hash(b.i) * 1.6) + hash(b.i + 7) * 20))
      : md === 2 ? (b.i % 2 ? 1 : 0) * (0.5 + 0.5 * Math.sin(t * 1.4)) + (b.i % 2 ? 0 : 1) * (0.5 - 0.5 * Math.sin(t * 1.4))
      : 0.82 + 0.18 * Math.sin(t * 2 + b.i);
    return mix < 1 ? f((mode + 3) % 4) * (1 - mix) + f(mode) * mix : f(mode);
  }
  function drawGarland() {
    if (!GAR.show) return;
    if (!garGeo) garBuild(); if (!garSpr) garSprites();
    const t = T(); garFade += ((GAR.run ? 1 : 0) - garFade) * 0.08;
    ctx.save(); ctx.lineJoin = "round";
    ctx.beginPath(); garGeo.wire.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.strokeStyle = "#1f2d24"; ctx.lineWidth = 2.6; ctx.stroke(); ctx.strokeStyle = "rgba(255,255,255,.18)"; ctx.lineWidth = 0.8; ctx.stroke();
    for (const b of garGeo.bulbs) {
      const sp = garSpr[b.c], lv = garFade > 0.01 ? garFade * garLevel(b, t) : 0;
      ctx.setTransform(scale * Math.cos(b.a), scale * Math.sin(b.a), -scale * Math.sin(b.a), scale * Math.cos(b.a), offX + b.x * scale, offY + b.y * scale);
      if (lv > 0.02) { ctx.globalAlpha = lv * 0.75; ctx.drawImage(sp.glow, -48, -18, 96, 96); }
      ctx.globalAlpha = 1; ctx.drawImage(sp.off, -10, -3, 20, 32);
      if (lv > 0.02) { ctx.globalAlpha = lv; ctx.drawImage(sp.on, -10, -3, 20, 32); }
    }
    ctx.globalAlpha = 1; ctx.setTransform(scale, 0, 0, scale, offX, offY);
    // щиток управления, подвешенный к проводу
    const { x, y, w, h } = GAR_BOX;
    ctx.strokeStyle = "#1f2d24"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(18, y + 16 * GAR_K); ctx.lineTo(x, y + 16 * GAR_K); ctx.moveTo(18, y + (h - 16) * GAR_K); ctx.lineTo(x, y + (h - 16) * GAR_K); ctx.stroke();
    ctx.translate(x, y); ctx.scale(GAR_K, GAR_K); ctx.translate(-x, -y);
    K.rr(x, y, w, h, 6); const g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, "#e4e6e3"); g.addColorStop(1, "#b9bdb9"); ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = "#5a625c"; ctx.lineWidth = 1.5; ctx.stroke();
    [[x + 6, y + 6], [x + w - 6, y + 6], [x + 6, y + h - 6], [x + w - 6, y + h - 6]].forEach(([sx, sy]) => { ctx.beginPath(); ctx.arc(sx, sy, 2, 0, TAU); ctx.fillStyle = "#8c938e"; ctx.fill(); });
    ctx.fillStyle = "#2b3a31"; ctx.font = `700 11px Raleway, 'Segoe UI', sans-serif`; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText("ГИРЛЯНДА", x + 12, y + 14);
    ctx.beginPath(); ctx.arc(x + w - 16, y + 14, 5, 0, TAU); ctx.fillStyle = GAR.run ? "#f0c85a" : "#6d6a5c"; ctx.fill(); ctx.strokeStyle = "#3b3f3c"; ctx.lineWidth = 1; ctx.stroke();
    if (GAR.run) { ctx.globalAlpha = 0.35 + 0.25 * Math.sin(t * 3); ctx.drawImage(garSpr[0].glow, x + w - 30, y, 28, 28); ctx.globalAlpha = 1; }
    const btn = (cx, cy, col, lbl, pressed, hov) => {
      ctx.beginPath(); ctx.arc(cx, cy, 14, 0, TAU); ctx.fillStyle = "#3c4440"; ctx.fill();
      ctx.beginPath(); ctx.arc(cx, cy + (pressed ? 1.5 : 0), pressed ? 10.5 : 11.5, 0, TAU);
      const bg = ctx.createRadialGradient(cx - 3, cy - 4, 1, cx, cy, 12); bg.addColorStop(0, pressed ? col[1] : col[0]); bg.addColorStop(1, col[1]); ctx.fillStyle = bg; ctx.fill();
      if (hov) { ctx.strokeStyle = "rgba(0,67,149,.6)"; ctx.lineWidth = 2; ctx.stroke(); }
      ctx.fillStyle = "#2b3a31"; ctx.font = `700 8px Raleway, 'Segoe UI', sans-serif`; ctx.textAlign = "center"; ctx.fillText(lbl, cx, cy + 22);
    };
    btn(x + 52, y + 33, ["#7fc59a", "#2f7a4c"], "ПУСК", GAR.run, hover === "@garland-start");
    btn(x + 114, y + 33, ["#e08a7e", "#9b3a30"], "СТОП", !GAR.run, hover === "@garland-stop");
    ctx.restore();
  }
  function garHit(wx, wy) {
    if (!GAR.show) return null;
    const { x, y } = GAR_BOX;
    const lx = x + (wx - x) / GAR_K, ly = y + (wy - y) / GAR_K;
    if (Math.hypot(lx - (x + 52), ly - (y + 33)) < 16) return "@garland-start";
    if (Math.hypot(lx - (x + 114), ly - (y + 33)) < 16) return "@garland-stop";
    return null;
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
  // Плавный пуск: пока привод разгоняется (или выбегает), над ним шкала скорости.
  const NO_RAMP = new Set(["shiber", "gate", "diverter", "truck", "bunker", "scale", "tank", "box", "pit", "magnet"]);
  function drawRamp() {
    for (const [id, m] of Object.entries(M)) {
      const n = ND[id === "Pros1" || id === "Pros2" ? "Pros" : id]; if (!n || NO_RAMP.has(n.kind)) continue;
      const s = m.spin || 0;
      const fb = plc.fbs[id], pch = fb && (fb.kind === "dozator" || /^Pit/.test(id));
      if (Math.abs(s - (m._rs || 0)) > 1e-4) { m._rdir = s > (m._rs || 0) ? 1 : -1; m._rs = s; if (!m._r0) m._r0 = T(); m._rt = T(); }
      if (T() - (m._rt || 0) > 0.6) m._r0 = 0;
      // приводы с ПЧ меняют скорость по заданию постоянно — шкалу показываем только при пуске с нуля
      if (pch && !(m._r0 && s < 0.9 && m._rdir > 0 && (m._r0 && T() - m._r0 < 4))) continue;
      if (s <= 0.02 || s >= 0.985 || !m._r0) continue;
      const up = m._rdir > 0, bx = n.x + n.w / 2 + (id === "Pros2" ? 70 : 0), by = (n.kind === "screw" ? n.cy - n.h / 2 : n.y) - 22, W = 64;
      badge(`${up ? "разгон" : "выбег"} ${Math.round(s * 100)}%`, bx, by - 14, { size: 11, color: up ? "#ffe08a" : "#bcd0dc", edge: up ? "#f0c040" : "#7f97a8" });
      ctx.fillStyle = "rgba(10,16,24,.8)"; ctx.fillRect(bx - W / 2, by - 3, W, 6);
      ctx.fillStyle = up ? "#f0c040" : "#7f97a8"; ctx.fillRect(bx - W / 2 + 1, by - 2, (W - 2) * s, 4);
    }
  }
  function render(now) {
    if (!cv) return;
    const dt = last ? (now - last) / 1000 : 0.016; last = now;
    stepParticles(dt * Math.min(3, S.timeScale || 1));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.setTransform(scale, 0, 0, scale, offX, offY);
    K.use(ctx);
    drawBackdrop();
    drawStructs();
    if (VOPT.pipes) drawDucts();
    drawPipes();
    drawSteam();
    const nodes = Object.values(ND).sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
    for (const n of nodes) { const f = n._spr && IMG[n._spr.img] ? drawMach : n._nh ? drawNoriaSpr : DRAW[n.kind]; if (f) { try { f(n); } catch (e) { if (!render._err) { render._err = 1; console.error(n.id, e); } } } }
    drawPipes(true);
    drawParticles();
    drawRamp();
    drawLabels();
    drawGarland();
    drawSelection();
  }

  buildLinks();
  global.RENDER = {
    init, render, toWorld, toClient, hitAt, zoomAt, panBy, fit, focus,
    setHover: (id) => { hover = id; }, setSelected: (id) => { selected = id; },
    garland: { get show() { return GAR.show; }, set show(v) { GAR.show = !!v; garSave(); }, get run() { return GAR.run; }, set run(v) { GAR.run = !!v; garSave(); } },
    get options() { return VOPT; }, set options(o) { VOPT = Object.assign(VOPT, o); },
    SHORT,
  };
})(window);
