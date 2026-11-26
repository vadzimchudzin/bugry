/* Комбикормовый завод «Бугры» — материалы и типовые детали мнемосхемы.
   Фактуры (оцинковка, окраска, перфорация, решётка, бетон) строятся один раз
   на внеэкранных холстах. Детали (двигатель, мотор-редуктор, фланец, болты,
   труба, воздуховод) рисуются в мировых координатах текущего контекста. */

(function (global) {
  "use strict";

  const TAU = Math.PI * 2;
  let ctx = null;
  const PAT = {};

  function rnd(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
  function off(w, h, draw) { const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h); return c; }

  /* ------------------------------------------------------------ фактуры */
  function buildPatterns() {
    // оцинковка: крупные «цветы» кристаллизации цинка, едва заметные
    PAT.galv = off(256, 256, (g, w, h) => {
      const r = rnd(7); g.fillStyle = "#b8c2c8"; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 70; i++) {
        const x = r() * w, y = r() * h, s = 14 + r() * 30, l = 170 + Math.floor(r() * 40);
        g.fillStyle = `rgba(${l},${l + 8},${l + 14},.35)`; g.beginPath();
        for (let k = 0; k < 7; k++) { const a = k / 7 * TAU + r() * 0.5, rr = s * (0.6 + r() * 0.5); g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
        g.closePath(); g.fill();
      }
      for (let i = 0; i < 1600; i++) { const v = Math.floor(150 + r() * 90); g.fillStyle = `rgba(${v},${v},${v + 6},.18)`; g.fillRect(r() * w, r() * h, 1, 1); }
    });
    // шлифованная сталь (валы, крышки)
    PAT.brushed = off(256, 64, (g, w, h) => {
      const r = rnd(11); g.fillStyle = "#a9b4bb"; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 260; i++) { const y = r() * h, v = Math.floor(140 + r() * 100); g.strokeStyle = `rgba(${v},${v + 4},${v + 8},.28)`; g.lineWidth = 0.6; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y + (r() - 0.5) * 2); g.stroke(); }
    });
    // порошковая окраска двигателей (RAL 5015) — мелкая шагрень
    PAT.paint = off(128, 128, (g, w, h) => {
      const r = rnd(5); g.fillStyle = "#2c66ad"; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 1400; i++) { const a = r() * 0.16; g.fillStyle = r() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,30,${a})`; g.fillRect(r() * w, r() * h, 1.3, 1.3); }
    });
    // перфорированный лист (сито, кожух муфты)
    PAT.perf = off(12, 12, (g) => { g.fillStyle = "#9aa6ae"; g.fillRect(0, 0, 12, 12); g.fillStyle = "#1b252c"; g.beginPath(); g.arc(3, 3, 2, 0, TAU); g.arc(9, 9, 2, 0, TAU); g.fill(); });
    // сетка сита (тонкая)
    PAT.mesh = off(8, 8, (g) => { g.fillStyle = "rgba(20,28,34,.9)"; g.fillRect(0, 0, 8, 8); g.strokeStyle = "#a6b1b8"; g.lineWidth = 1; g.beginPath(); g.moveTo(0, 0.5); g.lineTo(8, 0.5); g.moveTo(0.5, 0); g.lineTo(0.5, 8); g.stroke(); });
    // просечно-вытяжная решётка ограждения
    PAT.grate = off(18, 10, (g) => { g.strokeStyle = "#c9a227"; g.lineWidth = 2; g.beginPath(); g.moveTo(0, 5); g.lineTo(4.5, 0); g.lineTo(13.5, 0); g.lineTo(18, 5); g.lineTo(13.5, 10); g.lineTo(4.5, 10); g.closePath(); g.stroke(); });
    // бетон фундамента
    PAT.concrete = off(128, 128, (g, w, h) => {
      const r = rnd(3); g.fillStyle = "#a3a6a5"; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 900; i++) { const v = Math.floor(120 + r() * 90); g.fillStyle = `rgba(${v},${v},${v},.35)`; g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2); }
    });
    // тёплая изоляция котла (алюминиевая обшивка с гофрой)
    PAT.clad = off(40, 40, (g) => { g.fillStyle = "#c6cbcf"; g.fillRect(0, 0, 40, 40); for (let x = 0; x < 40; x += 10) { const gr = g.createLinearGradient(x, 0, x + 10, 0); gr.addColorStop(0, "rgba(255,255,255,.35)"); gr.addColorStop(0.5, "rgba(0,0,0,.08)"); gr.addColorStop(1, "rgba(255,255,255,.2)"); g.fillStyle = gr; g.fillRect(x, 0, 10, 40); } });
    for (const k of Object.keys(PAT)) PAT[k] = { img: PAT[k], p: null };
  }
  function pat(name) { const e = PAT[name]; if (!e.p) e.p = ctx.createPattern(e.img, "repeat"); return e.p; }

  function use(c) { if (ctx !== c) { ctx = c; for (const k of Object.keys(PAT)) PAT[k].p = null; } }

  /* ------------------------------------------------------------ свет и форма */
  // Объём цилиндра: поперечный градиент поверх фактуры (свет сверху-слева).
  function shadeCyl(x0, y0, x1, y1, k) {
    k = k == null ? 1 : k;
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, `rgba(0,0,0,${0.32 * k})`); g.addColorStop(0.18, `rgba(255,255,255,${0.32 * k})`);
    g.addColorStop(0.32, `rgba(255,255,255,${0.08 * k})`); g.addColorStop(0.75, `rgba(0,0,0,${0.12 * k})`); g.addColorStop(1, `rgba(0,0,0,${0.45 * k})`);
    return g;
  }
  // Плоская панель: лёгкий перепад света сверху вниз.
  function shadeFlat(x, y, w, h) {
    const g = ctx.createLinearGradient(x, y, x + w * 0.3, y + h);
    g.addColorStop(0, "rgba(255,255,255,.16)"); g.addColorStop(1, "rgba(0,0,0,.18)"); return g;
  }
  function path(pts, close) { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); if (close) ctx.closePath(); }
  function rr(x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  // Заливка текущего пути фактурой + свет + чёткий контур.
  function skin(mat, shade, edge, lw) {
    ctx.fillStyle = pat(mat); ctx.fill();
    if (shade) { ctx.fillStyle = shade; ctx.fill(); }
    ctx.lineWidth = lw || 1.6; ctx.strokeStyle = edge || "#2a343b"; ctx.stroke();
  }
  // Листовой корпус из оцинковки с отбортовкой и болтами по фланцам.
  function sheetBox(x, y, w, h, o) {
    o = o || {};
    rr(x, y, w, h, o.r || 3); skin(o.mat || "galv", o.cyl ? shadeCyl(x, y, x, y + h) : shadeFlat(x, y, w, h), o.edge, o.lw || 1.8);
    if (o.seams) { ctx.strokeStyle = "rgba(40,52,60,.45)"; ctx.lineWidth = 1; for (let k = 1; k < o.seams; k++) { const X = x + (w * k) / o.seams; ctx.beginPath(); ctx.moveTo(X, y + 2); ctx.lineTo(X, y + h - 2); ctx.stroke(); } }
    if (o.bolts) { bolts(x + 6, y + 5, x + w - 6, y + 5, Math.max(2, Math.round(w / 26))); bolts(x + 6, y + h - 5, x + w - 6, y + h - 5, Math.max(2, Math.round(w / 26))); }
  }
  function bolts(x0, y0, x1, y1, n, r) {
    r = r || 2.2;
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1), x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = "#6c7880"; ctx.fill();
      ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.45, 0, TAU); ctx.fillStyle = "rgba(255,255,255,.7)"; ctx.fill();
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.lineWidth = 0.7; ctx.strokeStyle = "#20292f"; ctx.stroke();
    }
  }
  // Фланец, перпендикулярный направлению (ux,uy) в точке (x,y).
  function flange(x, y, ux, uy, w) {
    const nx = -uy, ny = ux, hw = w / 2 + 5, t = 3.2;
    path([[x + nx * hw - ux * t, y + ny * hw - uy * t], [x + nx * hw + ux * t, y + ny * hw + uy * t], [x - nx * hw + ux * t, y - ny * hw + uy * t], [x - nx * hw - ux * t, y - ny * hw - uy * t]], true);
    ctx.fillStyle = "#7d8a93"; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = "#1f292f"; ctx.stroke();
    bolts(x + nx * (hw - 2.5), y + ny * (hw - 2.5), x - nx * (hw - 2.5), y - ny * (hw - 2.5), 2, 1.4);
  }

  /* ------------------------------------------------------------ электродвигатель */
  // Асинхронный двигатель IEC, вид сбоку: станина с рёбрами, кожух вентилятора
  // с решёткой, клеммная коробка, лапы, конец вала. dir: куда смотрит вал (+1 вправо).
  // run (0..1) — обороты: решётка «мерцает» лопатками крыльчатки, корпус дрожит.
  function motor(x, y, len, dia, o) {
    o = o || {};
    const dir = o.dir || 1, run = o.run || 0, t = o.t || 0;
    const j = run > 0.3 ? Math.sin(t * 90) * 0.35 * run : 0;
    ctx.save(); ctx.translate(x + j, y);
    if (dir < 0) { ctx.translate(len, 0); ctx.scale(-1, 1); }
    const fan = len * 0.22, body = len - fan - 10, r = dia / 2;
    // лапы
    ctx.fillStyle = "#24548f"; ctx.fillRect(fan + body * 0.1, dia - 2, body * 0.8, 6); ctx.strokeStyle = "#13253b"; ctx.lineWidth = 1; ctx.strokeRect(fan + body * 0.1, dia - 2, body * 0.8, 6);
    // кожух вентилятора
    rr(0, dia * 0.08, fan + 4, dia * 0.84, dia * 0.22); skin("paint", shadeCyl(0, 0, 0, dia), "#142a46", 1.4);
    ctx.save(); rr(3, dia * 0.16, fan - 2, dia * 0.68, dia * 0.16); ctx.clip();
    ctx.fillStyle = "rgba(10,20,34,.75)"; ctx.fillRect(0, 0, fan + 4, dia);
    ctx.strokeStyle = "rgba(150,175,205,.85)"; ctx.lineWidth = 1.1;
    for (let k = 0; k < 7; k++) { const Y = dia * 0.2 + k * dia * 0.6 / 6; ctx.beginPath(); ctx.moveTo(2, Y); ctx.lineTo(fan, Y); ctx.stroke(); }
    if (run > 0.05) {   // лопатки крыльчатки за решёткой — бегущая тень
      const ph = (t * 40 * run) % 1;
      ctx.fillStyle = `rgba(255,255,255,${0.10 + 0.12 * run})`;
      for (let k = 0; k < 3; k++) { const Y = dia * 0.16 + ((ph + k / 3) % 1) * dia * 0.68; ctx.fillRect(2, Y - 2, fan, 4); }
    }
    ctx.restore();
    // станина с продольными рёбрами охлаждения
    rr(fan, 0, body, dia, r * 0.35); skin("paint", shadeCyl(0, 0, 0, dia), "#142a46", 1.6);
    ctx.lineWidth = 1.2;
    for (let k = 1; k < 9; k++) {
      const Y = (dia * k) / 9;
      ctx.strokeStyle = "rgba(8,20,40,.55)"; ctx.beginPath(); ctx.moveTo(fan + 4, Y); ctx.lineTo(fan + body - 6, Y); ctx.stroke();
      ctx.strokeStyle = "rgba(170,200,240,.25)"; ctx.beginPath(); ctx.moveTo(fan + 4, Y + 1.2); ctx.lineTo(fan + body - 6, Y + 1.2); ctx.stroke();
    }
    // подшипниковый щит со стороны вала
    rr(fan + body - 8, dia * 0.06, 10, dia * 0.88, 3); skin("paint", shadeCyl(0, 0, 0, dia), "#142a46", 1.2);
    // клеммная коробка и шильдик
    const tb = Math.min(body * 0.34, dia * 0.6);
    rr(fan + body * 0.36, -dia * 0.2, tb, dia * 0.24, 2); skin("paint", shadeFlat(0, -dia * 0.2, tb, dia * 0.24), "#142a46", 1.2);
    ctx.fillStyle = "#2a2f33"; ctx.fillRect(fan + body * 0.36 + tb * 0.75, -dia * 0.26, tb * 0.16, dia * 0.07);
    ctx.fillStyle = "#d8dde0"; ctx.fillRect(fan + body * 0.2, dia * 0.52, body * 0.18, dia * 0.18);
    ctx.strokeStyle = "#5b6670"; ctx.lineWidth = 0.6; ctx.strokeRect(fan + body * 0.2, dia * 0.52, body * 0.18, dia * 0.18);
    // рым-болт
    ctx.beginPath(); ctx.arc(fan + body * 0.18, -2, dia * 0.07, Math.PI, 0); ctx.lineWidth = 2; ctx.strokeStyle = "#3a4046"; ctx.stroke();
    // конец вала
    if (!o.noShaft) {
      ctx.fillStyle = pat("brushed"); ctx.fillRect(len - 10, r - dia * 0.1, 12, dia * 0.2);
      ctx.strokeStyle = "#2a343b"; ctx.lineWidth = 1; ctx.strokeRect(len - 10, r - dia * 0.1, 12, dia * 0.2);
      if (run > 0.05) { ctx.strokeStyle = "rgba(255,255,255,.6)"; const k = (t * 30 * run) % 1; ctx.beginPath(); ctx.moveTo(len - 9 + k * 10, r - dia * 0.1); ctx.lineTo(len - 9 + k * 10, r + dia * 0.1); ctx.stroke(); }
    }
    ctx.restore();
  }
  // Мотор-редуктор: цилиндрический редуктор (серый чугун) + фланцевый двигатель.
  // (x,y) — центр выходного вала редуктора, size — масштаб, dir — куда «уходит» двигатель.
  function gearMotor(x, y, size, o) {
    o = o || {};
    const s = size || 1, dir = o.dir || 1, gw = 34 * s, gh = 40 * s;
    ctx.save(); ctx.translate(x, y); if (dir < 0) ctx.scale(-1, 1);
    // корпус редуктора
    rr(-gw * 0.3, -gh / 2, gw, gh, 5 * s); skin("paint", shadeFlat(-gw * 0.3, -gh / 2, gw, gh), "#142a46", 1.4);
    ctx.fillStyle = "rgba(0,0,0,.18)"; ctx.fillRect(-gw * 0.3, -gh * 0.06, gw, 2 * s);
    bolts(-gw * 0.3 + 4 * s, -gh / 2 + 4 * s, gw * 0.7 - 4 * s, -gh / 2 + 4 * s, 3, 1.6 * s);
    // выходной вал / ступица
    ctx.beginPath(); ctx.arc(0, 0, 8 * s, 0, TAU); ctx.fillStyle = pat("brushed"); ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = "#20292f"; ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, 3 * s, 0, TAU); ctx.fillStyle = "#3a454c"; ctx.fill();
    ctx.restore();
    // двигатель на фланце редуктора
    const ml = 58 * s, md = 26 * s;
    if (dir > 0) motor(x + gw * 0.7 - 2, y - md / 2 - gh * 0.1, ml, md, { dir: -1, run: o.run, t: o.t, noShaft: true });
    else motor(x - gw * 0.7 + 2 - ml, y - md / 2 - gh * 0.1, ml, md, { dir: 1, run: o.run, t: o.t, noShaft: true });
  }

  /* ------------------------------------------------------------ трубы */
  // Самотёчная/продуктовая труба: стальной «цилиндр» в три слоя + фланцы
  // на концах и хомуты-подвесы. kind: galv | oil | steam | water | air.
  const PIPE = {
    galv: ["#55616a", "#a7b2b9", "rgba(255,255,255,.55)"],
    oil: ["#5c4a12", "#9a8a5a", "rgba(255,244,200,.55)"],
    steam: ["#5b2a22", "#b4483a", "rgba(255,210,200,.45)"],
    water: ["#1f3e63", "#4f86c6", "rgba(220,236,255,.5)"],
    air: ["#4b5a66", "#9fb0bd", "rgba(255,255,255,.5)"],
  };
  function pipe(pts, w, o) {
    o = o || {};
    const c = PIPE[o.kind || "galv"];
    ctx.save(); ctx.lineJoin = "miter"; ctx.miterLimit = 3; ctx.lineCap = "butt";
    path(pts); ctx.strokeStyle = "#20292f"; ctx.lineWidth = w + 3; ctx.stroke();
    path(pts); ctx.strokeStyle = c[0]; ctx.lineWidth = w; ctx.stroke();
    path(pts); ctx.strokeStyle = c[1]; ctx.lineWidth = w * 0.62; ctx.stroke();
    ctx.translate(-w * 0.14, -w * 0.14); path(pts); ctx.strokeStyle = c[2]; ctx.lineWidth = Math.max(1.2, w * 0.16); ctx.stroke();
    ctx.restore();
    if (o.flanges !== false && pts.length > 1) {
      const end = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; flange(a[0] + dx / l * 3, a[1] + dy / l * 3, dx / l, dy / l, w); };
      end(pts[0], pts[1]); end(pts[pts.length - 1], pts[pts.length - 2]);
      // сварные швы на изгибах
      for (let i = 1; i < pts.length - 1; i++) { ctx.beginPath(); ctx.arc(pts[i][0], pts[i][1], w * 0.5 + 1, 0, TAU); ctx.lineWidth = 1; ctx.strokeStyle = "rgba(30,40,46,.6)"; ctx.stroke(); }
    }
  }
  // Поток жидкости/пара внутри трубы: бегущие «порции» по оси.
  function pipeFlow(pts, w, color, speed, t, dash) {
    ctx.save(); path(pts); ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.setLineDash(dash || [w * 1.4, w * 1.1]); ctx.lineDashOffset = -t * speed;
    ctx.strokeStyle = color; ctx.lineWidth = w * 0.42; ctx.stroke(); ctx.restore();
  }

  /* ------------------------------------------------------------ аспирация */
  // Круглый оцинкованный воздуховод с бандажными хомутами и отводами;
  // при работе вентилятора по нему бегут светлые струи воздуха с пылью.
  function duct(pts, w, on, t) {
    ctx.save(); ctx.lineJoin = "round"; ctx.lineCap = "butt";
    path(pts); ctx.strokeStyle = "#2a343b"; ctx.lineWidth = w + 3; ctx.stroke();
    path(pts); ctx.strokeStyle = pat("galv"); ctx.lineWidth = w; ctx.stroke();
    ctx.translate(-w * 0.16, -w * 0.16); path(pts); ctx.strokeStyle = "rgba(255,255,255,.45)"; ctx.lineWidth = w * 0.18; ctx.stroke();
    ctx.translate(w * 0.32, w * 0.32); path(pts); ctx.strokeStyle = "rgba(0,0,0,.22)"; ctx.lineWidth = w * 0.2; ctx.stroke();
    ctx.restore();
    // хомуты через ~110 px
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], L = Math.hypot(x1 - x0, y1 - y0); if (L < 1) continue;
      const ux = (x1 - x0) / L, uy = (y1 - y0) / L;
      for (let d = 40; d < L - 20; d += 110) { const x = x0 + ux * d, y = y0 + uy * d; ctx.beginPath(); ctx.moveTo(x - uy * (w / 2 + 2), y + ux * (w / 2 + 2)); ctx.lineTo(x + uy * (w / 2 + 2), y - ux * (w / 2 + 2)); ctx.lineWidth = 3; ctx.strokeStyle = "#6a767e"; ctx.stroke(); }
    }
    if (on) {
      ctx.save(); path(pts); ctx.lineCap = "round"; ctx.setLineDash([10, 26]); ctx.lineDashOffset = -t * 160;
      ctx.strokeStyle = "rgba(255,255,255,.75)"; ctx.lineWidth = Math.max(2, w * 0.18); ctx.stroke();
      ctx.setLineDash([4, 40]); ctx.lineDashOffset = -t * 160 + 17; ctx.strokeStyle = "rgba(190,160,110,.7)"; ctx.lineWidth = Math.max(2, w * 0.22); ctx.stroke();
      ctx.restore();
    }
  }
  // Аспирационный патрубок с дроссель-клапаном на корпусе машины.
  function aspNozzle(x, y, w) {
    rr(x - w / 2, y - 10, w, 12, 2); skin("galv", shadeCyl(x - w / 2, 0, x + w / 2, 0), "#2a343b", 1.2);
    ctx.beginPath(); ctx.moveTo(x - w / 2 - 3, y - 12); ctx.lineTo(x + w / 2 + 3, y - 12); ctx.lineWidth = 3; ctx.strokeStyle = "#6a767e"; ctx.stroke();
  }

  /* ------------------------------------------------------------ прочее */
  // Манометр: стрелка по доле шкалы.
  function gauge(x, y, r, frac, o) {
    o = o || {};
    ctx.beginPath(); ctx.arc(x, y, r + 2, 0, TAU); ctx.fillStyle = "#3a4249"; ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = "#f4f1e8"; ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, r * 0.78, Math.PI * 0.75 + Math.PI * 1.5 * 0.8, Math.PI * 2.25); ctx.lineWidth = r * 0.16; ctx.strokeStyle = "#d03a2a"; ctx.stroke();
    ctx.strokeStyle = "#333"; ctx.lineWidth = 0.8;
    for (let k = 0; k <= 10; k++) { const a = Math.PI * 0.75 + Math.PI * 1.5 * k / 10; ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * r * 0.62, y + Math.sin(a) * r * 0.62); ctx.lineTo(x + Math.cos(a) * r * 0.85, y + Math.sin(a) * r * 0.85); ctx.stroke(); }
    const a = Math.PI * 0.75 + Math.PI * 1.5 * Math.max(0, Math.min(1, frac));
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * r * 0.8, y + Math.sin(a) * r * 0.8); ctx.lineWidth = 1.6; ctx.strokeStyle = "#111"; ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, r * 0.12, 0, TAU); ctx.fillStyle = "#111"; ctx.fill();
    if (o.stem) { ctx.fillStyle = pat("brushed"); ctx.fillRect(x - 2, y + r + 2, 4, o.stem); }
  }
  // Запорная арматура (вентиль/шаровой кран) на трубе в точке x,y.
  function valve(x, y, s, open, vertical) {
    ctx.save(); ctx.translate(x, y); if (vertical) ctx.rotate(Math.PI / 2);
    path([[-9 * s, -7 * s], [9 * s, 7 * s], [9 * s, -7 * s], [-9 * s, 7 * s]], true);
    ctx.fillStyle = open ? "#3c9a5c" : "#7b868e"; ctx.fill(); ctx.lineWidth = 1.2; ctx.strokeStyle = "#1e282e"; ctx.stroke();
    ctx.fillStyle = "#2a343b"; ctx.fillRect(-1.5 * s, -16 * s, 3 * s, 9 * s);
    ctx.fillStyle = open ? "#d23b2b" : "#8a2b22"; ctx.fillRect(-7 * s, -19 * s, 14 * s, 4 * s);
    ctx.restore();
  }
  // Пружина виброопоры между точками (x,y0)→(x,y1).
  function spring(x, y0, y1, w, k) {
    const n = 6; ctx.beginPath(); ctx.moveTo(x, y0);
    for (let i = 1; i <= n * 2; i++) ctx.lineTo(x + (i % 2 ? w / 2 : -w / 2), y0 + (y1 - y0) * i / (n * 2 + 1));
    ctx.lineTo(x, y1); ctx.lineWidth = 2.4; ctx.strokeStyle = k ? "#c7452e" : "#b23b28"; ctx.stroke();
  }

  // Фактура сыпучего продукта: отдельные зёрна / крупка / цилиндрики гранул.
  const GP = {};
  function grain(kind, cols) {
    let e = GP[kind];
    if (!e) {
      const pel = kind === "pellet", fine = kind === "meal" || kind === "mash" || kind === "add" || kind === "fines";
      e = GP[kind] = { p: null, c: null, img: off(64, 64, (g, w, h) => {
        const r = rnd(kind.length * 31 + 7); g.fillStyle = cols[1]; g.fillRect(0, 0, w, h);
        const n = pel ? 70 : fine ? 700 : 260;
        for (let i = 0; i < n; i++) {
          const x = r() * w, y = r() * h; g.fillStyle = cols[Math.floor(r() * 3)];
          g.beginPath();
          if (pel) g.ellipse(x, y, 4.5 + r() * 2, 2.3, r() * Math.PI, 0, TAU);
          else if (fine) g.rect(x, y, 1 + r(), 1 + r());
          else g.ellipse(x, y, 2.2 + r(), 1.3 + r() * 0.5, r() * Math.PI, 0, TAU);
          g.fill();
          if (!fine && r() > 0.5) { g.fillStyle = "rgba(255,255,255,.35)"; g.beginPath(); g.ellipse(x - 0.8, y - 0.6, 1, 0.6, 0, 0, TAU); g.fill(); }
        }
      }) };
    }
    if (!e.p || e.c !== ctx) { e.p = ctx.createPattern(e.img, "repeat"); e.c = ctx; }
    return e.p;
  }

  global.RKIT = { grain, use, buildPatterns, pat, shadeCyl, shadeFlat, path, rr, skin, sheetBox, bolts, flange, motor, gearMotor, pipe, pipeFlow, duct, aspNozzle, gauge, valve, spring, TAU };
})(window);
