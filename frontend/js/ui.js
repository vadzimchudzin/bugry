/* Комбикормовый завод «Бугры» — интерфейс оператора: окна панели (HMI),
   экраны SCADA (программы производства, рецепты, бункеры), таблицы, журнал.
   Команды пишут те же переменные, что SCADA/панель пишут в ПЛК
   (Regim*, fHand_*, Off*, команды кнопок блоков через io). */

(function () {
  "use strict";

  const P = window.PLANT, R = window.RENDER, DB = window.DB;
  const { S, C, V, plc } = P;
  const PS = plc.prod.S, CMD = plc.prod.cmd;
  const M = S.machines;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else if (k === "class") e.className = v;
      else if (k === "html") e.innerHTML = v;
      else e.setAttribute(k, v === true ? "" : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
    return e;
  }
  let toastT = 0;
  function toast(msg, bad) {
    const t = $("#toast"); t.textContent = msg; t.className = "toast show" + (bad ? " bad" : "");
    clearTimeout(toastT); toastT = setTimeout(() => { t.className = "toast" + (bad ? " bad" : ""); }, 3200);
  }
  const fmtKg = (kg) => (Math.abs(kg) >= 1000 ? (kg / 1000).toFixed(2) + " т" : (+kg).toFixed(kg < 10 ? 2 : 0) + " кг");
  const fmtT = (d) => (d instanceof Date ? d : new Date(d)).toLocaleTimeString("ru-RU");

  /* ================================================================ механизмы */
  const GRP = { load: "Загрузка БВ", dos: "Дозирование / дробление", unl: "Выгрузка ГП", gran: "Гранулирование", grn2: "Гранулятор", car: "Отгрузка в авто" };
  const DEF = plc.DEF;
  const EXTRA = ["K1", "K2", "K3", "K4", "K5", "K6", "D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "ZatvK", "ZatvD", "KlapSms", "ShDownSms", "ClapMasloIn", "ClapMasloOut"];
  const ALL = plc.D.map((d) => d.id).concat(EXTRA);
  const fb = (id) => plc.fbs[id] || {};
  const kindOf = (id) => (DEF[id] ? DEF[id].fb : fb(id).kind);
  const isHand = (id) => {
    if (DEF[id]) return plc.handOf(DEF[id]);
    if (/^[KD]\d$/.test(id)) return !!(V.MHand || !V.RunDosing || V["fHand_" + id]);
    return !!(V.MHand || V["fHand_" + id]);
  };
  function errList(id) {
    const list = (P.ERRS[fb(id).kind] || []).filter(([k]) => fb(id)[k]).map(([, t]) => t);
    return list;
  }
  // Состояние механизма: [текст, класс чипа, класс светодиода]
  function drvState(id) {
    const f = fb(id), k = kindOf(id), m = M[id] || {};
    if (f.da) return ["АВАРИЯ: " + (errList(id).join(", ") || "есть ошибка"), "bad", "fault"];
    if (k === "shiber" || k === "klap") {
      const op = k === "klap" ? m.pos > 0.97 : V["Opened_" + id], cl = k === "klap" ? m.pos < 0.03 : V["Closed_" + id];
      if (f.runToOpen) return ["Открывается", "warn", "wait"];
      if (f.runToClose) return ["Закрывается", "warn", "wait"];
      if (op) return ["Открыт", "ok", "run"];
      if (cl) return ["Закрыт", "", ""];
      return ["Промежуточное положение", "warn", "wait"];
    }
    if (k === "dvpt") {
      const d = DEF[id];
      if (f.runToPos1 || f.runToPos2) return ["Переключение", "warn", "wait"];
      if (V[d.pos1]) return ["Положение 1", "ok", "run"];
      if (V[d.pos2]) return ["Положение 2", "ok", "run"];
      return ["Не в положении", "warn", "wait"];
    }
    if (V.GEmer && k !== "vibr") return ["Нет готовности — общая авария", "bad", "fault"];
    if (k === "reverse" && f.run) return [f.runL ? "Работа — влево (на 10600)" : "Работа — вправо (на 10700)", "ok", isHand(id) ? "hand" : "run"];
    if (f.run || (k === "dozator" && f.run)) return [isHand(id) ? "Ручной · работа" : "Работа", "ok", isHand(id) ? "hand" : "run"];
    const t = f.ton_on || f.ton_start;
    if (t && t.et > 0 && !f.run) return ["Пуск через " + Math.max(0, Math.ceil((DEF[id] && DEF[id].t1 || 5) - t.et)) + " с", "warn", "wait"];
    if (m.spin > 0.05) return ["Выбег", "warn", "wait"];
    if (isHand(id) && DEF[id] && ["load", "dos", "unl", "gran", "grn2"].includes(DEF[id].grp) && !V.MHand && !V["fHand_" + id]) return ["Остановлен (участок не в автомате)", "", ""];
    if (isHand(id)) return ["Ручной режим", "info", "hand"];
    return ["Остановлен", "", ""];
  }
  const title = (id) => (M[id] ? M[id].name : id);
  const poz = (id) => (M[id] ? M[id].poz : "");

  /* ================================================================ окна */
  let dlg = null;
  function openDlg(o) {
    const root = $("#modal-root"); root.innerHTML = "";
    const ups = [], body = h("div", { class: "dlg-b" });
    const box = h("div", { class: "dlg" + (o.wide ? " wide" : ""), role: "dialog", "aria-modal": "true", "aria-label": o.title },
      h("div", { class: "dlg-h" },
        h("button", { class: "dlg-x", type: "button", "aria-label": "Закрыть", onclick: closeDlg }, "✕"),
        h("div", { class: "dlg-title" }, o.title, o.sub ? h("small", {}, o.sub) : null)),
      body);
    root.append(box); root.classList.add("open");
    dlg = { id: o.id, ups, box };
    o.build(body, (fn) => ups.push(fn));
    ups.forEach((f) => f());
    const first = box.querySelector(".dlg-b button:not(:disabled), .dlg-b input");
    (first || box.querySelector(".dlg-x")).focus({ preventScroll: true });
    R.setSelected(o.node || null);
  }
  function closeDlg() { $("#modal-root").classList.remove("open"); $("#modal-root").innerHTML = ""; dlg = null; R.setSelected(null); }
  $("#modal-root").addEventListener("mousedown", (e) => { if (e.target.id === "modal-root") closeDlg(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && dlg) closeDlg(); });
  function refresh() { if (dlg) dlg.ups.forEach((f) => { try { f(); } catch (e) { console.error(e); } }); }

  const row = (label, ...right) => h("div", { class: "row" }, h("span", {}, label), ...right);
  function toggle(get, set, up, disabled) {
    const b = h("button", { class: "toggle", type: "button", role: "switch" }, h("i"));
    b.addEventListener("click", () => { const r = set(!get()); if (typeof r === "string") toast(r, true); refresh(); });
    up(() => { const on = !!get(); b.classList.toggle("on", on); b.setAttribute("aria-checked", on); if (disabled) b.disabled = !!disabled(); });
    return b;
  }
  function num(get, set, up, unit, step) {
    const i = h("input", { type: "number", step: step || 1 });
    const commit = () => { const v = parseFloat(String(i.value).replace(",", ".")); if (!isFinite(v)) { i.value = get(); return; } set(v); P.save(); };
    i.addEventListener("change", commit);
    i.addEventListener("keydown", (e) => { if (e.key === "Enter") { commit(); i.blur(); } });
    up(() => { if (document.activeElement !== i) i.value = Math.round((+get() || 0) * 100) / 100; });
    return h("span", {}, i, unit ? h("span", { class: "unit" }, unit) : null);
  }
  const val = (get, up, fmt) => { const s = h("span", { class: "val" }); up(() => { s.textContent = fmt ? fmt(get()) : get(); }); return s; };
  function lampb(label, get, up, kind) { const s = h("span", { class: "lampb", title: label }, label); up(() => { s.className = "lampb" + (get() ? " " + (kind || "on") : ""); }); return s; }
  function statusRow(get, up) {
    const st = h("div", { class: "row" }, h("span", { class: "status" }));
    up(() => { const [t, cls] = get(); st.className = "row" + (cls === "bad" ? " bad" : cls === "ok" ? " good" : cls === "warn" ? " warn" : ""); st.firstChild.textContent = t; });
    return st;
  }
  const sect = (t) => h("div", { class: "sect" }, t);
  const note = (t) => h("div", { class: "note" }, t);
  const btn = (cls, text, onclick, up, dis, tip) => { const b = h("button", { class: cls, type: "button", onclick }, text); if (up && dis) up(() => { b.disabled = !!dis(); if (tip) b.title = tip(); }); return b; };
  const linkRow = (text, fn) => h("div", { class: "row link", tabindex: 0, onclick: fn, onkeydown: (e) => { if (e.key === "Enter") fn(); } }, h("span", {}, text), h("span", {}, "»"));

  /* ---------------------------------------------------------------- окно механизма */
  const SENS = { dks: ["OffDKS_", "Отключить контроль ДКС"], dp: ["OffDP_", "Отключить контроль ДП (подпор)"], dsl1: ["OffDSL1_", "Отключить ДСЛ 1 (сход ленты)"],
    dsl2: ["OffDSL2_", "Отключить ДСЛ 2 (сход ленты)"], dp1: ["OffDP1_", "Отключить ДП 1 (левый)"], dp2: ["OffDP2_", "Отключить ДП 2 (правый)"] };
  const FB_NAME = { noria: "Noria", transporter: "Transporter", reverse: "ReverseTransporter", meh: "Mehanizm", zatvor: "Zatvor", shiber: "AutoShiber",
    dvpt: "DVPT", klap: "DualShiber", vibr: "TVibrator", asp: "Aspiration", dozator: "Dozator", ohl: "Ohladitel", leb: "Lebedka" };
  function openDrive(id) {
    const k = kindOf(id), d = DEF[id] || {}, m = M[id], x = plc.io[id] || (plc.io[id] = {});
    if (k === "shiber" || k === "klap") return openShiber(id);
    if (k === "dvpt") return openDvpt(id);
    if (k === "dozator") return openDozator(id);
    if (k === "leb") return openLeb();
    openDlg({
      id, title: m.name, sub: `Поз. ${m.poz} · блок ${FB_NAME[k] || k}${d.grp ? " · участок «" + GRP[d.grp] + "»" : ""}`, node: nodeOf(id),
      build(b, up) {
        b.append(statusRow(() => drvState(id), up));
        b.append(h("div", { class: "cond-grid" },
          lampb("RR", () => fb(id).rr || fb(id).ready, up), lampb("RUN", () => fb(id).run, up), lampb("АВАРИЯ", () => fb(id).da, up, "bad"),
          lampb("РУЧН.", () => isHand(id), up, "warn"), lampb("ДКС", () => V["DKS_" + id] || V["DKS_Gw" + id], up)));
        if (d.next) b.append(h("div", { class: "cond-grid" },
          lampb("NEXT", () => d.next(V), up), lampb("PREV", () => d.prev(V), up), lampb("АВТО", () => (d.auto ? d.auto(V) : false), up),
          lampb("ДП", () => V["DP_" + id], up, "bad"), lampb("ДВЕРЬ", () => V["Door_" + id], up, "bad")));
        b.append(note("RR — готовность блока, NEXT — следующий по потоку механизм работает, PREV — предыдущий работает, АВТО — условие автоматического пуска участка (canRunAuto)."));
        if (id === "Drob1" || id === "Drob2") {
          const n = id.slice(-1);
          b.append(row("Ток двигателя", val(() => V["TokDrob" + n], up), h("span", { class: "unit" }, "А")));
          b.append(row("Частота питателя", val(() => (+V["FreqPit" + n] || 0).toFixed(1), up), h("span", { class: "unit" }, "Гц")));
        }
        if (id === "Gran") {
          b.append(row("Ток главного привода", val(() => V.TokGran, up), h("span", { class: "unit" }, "А")));
          b.append(linkRow("Окно «Гранулирование»", openGran));
        }
        if (id === "Sms") b.append(linkRow("Окно «Смеситель и УДЖК»", openMixer));
        if (id === "Ohl") {
          b.append(row("Температура гранул", val(() => V.TempGranOut, up), h("span", { class: "unit" }, "°C")));
          b.append(row("Воздух на выходе", val(() => V.TempOhlIn, up), h("span", { class: "unit" }, "°C")));
          b.append(row("До качания стола", val(() => fb(id).timeToOpen || 0, up), h("span", { class: "unit" }, "с")));
        }
        (d.sens || []).forEach((s) => { const c = SENS[s]; if (c) b.append(row(c[1], toggle(() => V[c[0] + id], (v) => { V[c[0] + id] = v; }, up))); });
        if (d.tc) b.append(row("Время очистки (останова)", num(() => V[d.tc], (v) => { V[d.tc] = Math.max(1, v); }, up, "с")));
        // ручное управление
        b.append(sect("Ручное управление"));
        b.append(row("Персональный ручной режим (fHand)", toggle(() => V["fHand_" + id], (v) => { V["fHand_" + id] = v; }, up)));
        const handOK = () => isHand(id);
        const tip = () => (handOK() ? "" : "Кнопки работают в ручном режиме: общий (Regim0), участок не в автомате или fHand");
        if (k === "reverse") {
          b.append(h("div", { class: "btn-row" },
            btn("big-go sm", "◀ ВЛЕВО", () => { x.yRunLeft = true; x.yRunRight = false; }, up, () => !handOK(), tip),
            btn("big-go sm", "ВПРАВО ▶", () => { x.yRunRight = true; x.yRunLeft = false; }, up, () => !handOK(), tip),
            btn("big-stop sm", "СТОП", () => { x.yRunLeft = false; x.yRunRight = false; }, up, () => !handOK(), tip)));
        } else {
          b.append(h("div", { class: "btn-row" },
            btn("big-go", "ПУСК", () => { x.yRun = true; if (k === "asp") x.yRunGw = true; refresh(); }, up, () => !handOK(), tip),
            btn("big-stop", "СТОП", () => { x.yRun = false; if (k === "asp") x.yRunGw = false; refresh(); }, up, () => !handOK(), tip)));
          if (k === "ohl") b.append(row("Открыть стол (выгрузка)", toggle(() => x.yOpen, (v) => { x.yOpen = v; }, up)));
        }
        b.append(note(k === "vibr" ? "Вибратор в автомате работает циклами (работа/пауза) при дозировании или сводообразовании; ручной пуск ограничен максимальным временем включения."
          : "В автомате ПЛК запускает механизм после выдержки «пуск через», когда разрешён участок (АВТО), готов следующий (NEXT) и нет аварий. Останов — через время очистки после пропадания АВТО и PREV или сразу при пропадании NEXT. Ручной пуск без NEXT возможен только в режиме наладки (Regim1)."));
        b.append(row("Наработка с ТО", val(() => m.hours, up, (v) => v.toFixed(2)), h("span", { class: "unit" }, "ч")));
        b.append(row("Общая наработка", val(() => m.hoursTotal, up, (v) => v.toFixed(1)), h("span", { class: "unit" }, "ч")));
        b.append(row("Периодичность ТО", num(() => m.toHours, (v) => { m.toHours = Math.max(1, v); }, up, "ч")));
        b.append(row("Сброс наработки после ТО", h("button", { class: "btn-sw", type: "button", onclick: () => { m.hours = 0; toast("Наработка сброшена"); } }, "Сброс")));
        b.append(simSection(id, up));
      },
    });
  }
  // Имитация неисправностей — входы ПЛК со стороны оборудования
  function simSection(id, up) {
    const d = DEF[id] || {}, m = M[id], k = kindOf(id), sens = d.sens || [];
    const inner = h("div", { class: "inner" });
    const sim = (label, key, valOn) => inner.append(row(label, toggle(() => (valOn ? m.sim[key] === valOn : m.sim[key]), (v) => { m.sim[key] = v ? (valOn || true) : false; }, up)));
    if (k !== "ohl" && k !== "dozator") sim("Сработал автомат защиты (АЗ)", "az");
    if (d.pch) sim("Авария преобразователя частоты", "pch");
    if (sens.includes("dks") || k === "zatvor" || k === "asp") sim("ДКС: нет импульсов / обрыв", "dks");
    if (sens.includes("dks") && k === "noria") sim("Пробуксовка ленты", "slip");
    if (sens.includes("dsl1")) sim("ДСЛ 1: сход ленты", "dsl1");
    if (sens.includes("dsl2")) sim("ДСЛ 2: сход ленты", "dsl2");
    if (sens.includes("dp") || sens.includes("dp1")) sim("ДП: подпор (датчик)", "dp");
    if (d.door || k === "ohl") sim("Открыта дверь / люк", "door");
    if (k === "asp") sim("Авария шлюзового затвора", "az2");
    if (["noria", "transporter", "reverse", "meh", "zatvor"].includes(k)) sim("Заклинивание (вал не вращается)", "jam");
    if (["noria", "transporter", "meh", "reverse"].includes(k)) {
      inner.append(sect("Местный пост"));
      inner.append(row("Местный стоп нажат (LStop)", toggle(() => m.local.stop, (v) => { m.local.stop = v; }, up)));
      if (k !== "meh") inner.append(row("Местный режим (Local)", toggle(() => m.local.mode, (v) => { m.local.mode = v; }, up)));
      if (k !== "meh") {
        const hold = h("button", { class: "btn-sw", type: "button", title: "Удерживайте — как кнопку на посту" }, "Пуск (удерж.)");
        const on = () => { m.local.pusk = true; }, off = () => { m.local.pusk = false; };
        hold.addEventListener("pointerdown", on); hold.addEventListener("pointerup", off); hold.addEventListener("pointerleave", off);
        up(() => hold.classList.toggle("on", !!m.local.pusk));
        inner.append(row("Местный пуск (LPusk)", hold));
      }
    }
    return h("details", {}, h("summary", {}, "Имитация: неисправности и местный пост"), inner);
  }

  function openShiber(id) {
    const k = kindOf(id), m = M[id], x = plc.io[id] || (plc.io[id] = {});
    const pneumo = k === "klap";
    openDlg({
      id, title: m.name, sub: `Поз. ${m.poz} · блок ${pneumo ? "DualShiber (пневмо)" : "AutoShiber"}`, node: nodeOf(id),
      build(b, up) {
        b.append(statusRow(() => drvState(id), up));
        b.append(h("div", { class: "cond-grid" },
          lampb("ОТКРЫТ", () => (pneumo ? m.pos > 0.97 : V["Opened_" + id]), up), lampb("ЗАКРЫТ", () => (pneumo ? m.pos < 0.03 : V["Closed_" + id]), up),
          lampb("→ОТКР", () => fb(id).runToOpen, up, "warn"), lampb("→ЗАКР", () => fb(id).runToClose, up, "warn"), lampb("АВАРИЯ", () => fb(id).da, up, "bad")));
        b.append(row("Положение", val(() => Math.round(m.pos * 100), up), h("span", { class: "unit" }, "%")));
        b.append(sect("Ручное управление"));
        b.append(row("Персональный ручной режим (fHand)", toggle(() => V["fHand_" + id], (v) => { V["fHand_" + id] = v; }, up)));
        const tip = () => (isHand(id) ? "" : "Только в ручном режиме");
        if (pneumo) b.append(h("div", { class: "btn-row" },
          btn("big-go sm", "ОТКРЫТЬ", () => { x.yOpen = true; }, up, () => !isHand(id), tip), btn("big-stop sm", "ЗАКРЫТЬ", () => { x.yOpen = false; }, up, () => !isHand(id), tip)));
        else b.append(h("div", { class: "btn-row" },
          btn("big-go sm", "ОТКРЫТЬ", () => { x.yOpen = true; x.yClose = false; }, up, () => !isHand(id), tip), btn("big-stop sm", "ЗАКРЫТЬ", () => { x.yClose = true; x.yOpen = false; }, up, () => !isHand(id), tip)));
        if (/^ShO\d$/.test(id)) b.append(note("Шиберы выгрузки в автомобиль открывает водитель кнопками у бункера (LOpen/LClose) после разрешения оператора. Окно «Отгрузка ГП» — вызов машины."));
        b.append(note(pneumo ? "Пневмоклапан: катушка «открыть», возврат пружиной. Без воздуха (авария компрессора) не переключается." : "Привод шибера останавливается по концевику. Долгое переключение (> 10 с) или оба концевика сразу — авария."));
        const inner = h("div", { class: "inner" });
        const sim = (label, key, v1) => inner.append(row(label, toggle(() => (v1 ? M[id].sim[key] === v1 : M[id].sim[key]), (v) => { M[id].sim[key] = v ? (v1 || true) : false; }, up)));
        sim("Заклинивание заслонки", "jam");
        if (!pneumo) { sim("Сработал автомат защиты", "az"); sim("Концевики: оба замкнуты", "konc", "both"); sim("Обрыв концевика «открыт»", "konc", "lost"); }
        b.append(h("details", {}, h("summary", {}, "Имитация неисправностей"), inner));
      },
    });
  }
  function openDvpt(id) {
    const d = DEF[id], m = M[id], x = plc.io[id] || (plc.io[id] = {});
    const LBL = { DVPT: ["На скальператор 10300", "На норию 10400 (минуя скальператор)"], PP1: ["На просеиватель 40950", "В бункер биг-бега 51300"],
      PP2: ["В бункер биг-бега 51300", "На конвейер 51100"], PP3: ["На конвейер 51200 → нория ГП", "На норию 50100г → бункер 309"] }[id];
    openDlg({
      id, title: m.name, sub: `Поз. ${m.poz} · блок DVPT`, node: nodeOf(id),
      build(b, up) {
        b.append(statusRow(() => { const [t, c] = drvState(id); return [V[d.pos1] ? LBL[0] : V[d.pos2] ? LBL[1] : t, c]; }, up));
        b.append(h("div", { class: "cond-grid" }, lampb("ПОЛ. 1", () => V[d.pos1], up), lampb("ПОЛ. 2", () => V[d.pos2], up),
          lampb("→1", () => fb(id).runToPos1, up, "warn"), lampb("→2", () => fb(id).runToPos2, up, "warn"), lampb("АВАРИЯ", () => fb(id).da, up, "bad")));
        b.append(row("Персональный ручной режим (fHand)", toggle(() => V["fHand_" + id], (v) => { V["fHand_" + id] = v; }, up)));
        const tip = () => (isHand(id) ? "" : "Только в ручном режиме");
        b.append(row("1: " + LBL[0], btn("btn-sw", "Перевести", () => { x.yRun1 = true; }, up, () => !isHand(id), tip)));
        b.append(row("2: " + LBL[1], btn("btn-sw", "Перевести", () => { x.yRun2 = true; }, up, () => !isHand(id), tip)));
        const inner = h("div", { class: "inner" });
        inner.append(row("Заклинивание", toggle(() => m.sim.jam, (v) => { m.sim.jam = v; }, up)));
        inner.append(row("Оба концевика замкнуты", toggle(() => m.sim.konc === "both", (v) => { m.sim.konc = v ? "both" : false; }, up)));
        inner.append(row("Сработал автомат защиты", toggle(() => m.sim.az, (v) => { m.sim.az = v; }, up)));
        b.append(h("details", {}, h("summary", {}, "Имитация неисправностей"), inner));
      },
    });
  }
  function openDozator(id) {
    const z = plc.DOZ.find((q) => q.id === id), x = plc.io[id], m = M[id];
    openDlg({
      id, title: m.name, sub: `Поз. ${m.poz} · блок Dozator · ${z.scale === 1 ? "большие весы 500 кг" : "средние весы 100 кг"}`, node: id,
      build(b, up) {
        b.append(statusRow(() => { const f = fb(id); return f.da ? drvState(id) : f.run ? [`Дозирование · ${f.phase || ""}`, "ok"] : f.noWeight ? ["Нет прироста веса", "warn"] : ["Остановлен", ""]; }, up));
        b.append(row("Бункер", val(() => z.bunk + " · " + (C["b" + z.bunk].prod || "—"), up)));
        b.append(row("Остаток в бункере", val(() => fmtKg(C["b" + z.bunk].mass), up)));
        b.append(row("Частота ПЧ", val(() => (+V["Freq_" + id] || 0).toFixed(1), up), h("span", { class: "unit" }, "Гц")));
        b.append(row("Вес на весах", val(() => (z.scale === 1 ? V.Ves1 : V.Ves2), up), h("span", { class: "unit" }, "кг")));
        b.append(row("«Падающий столб» (выбег)", num(() => x.VesStolba, (v) => { x.VesStolba = Math.max(0, v); }, up, "кг", 0.01)));
        b.append(row("Ручной режим дозатора (fHand)", toggle(() => V["fHand_" + id], (v) => { V["fHand_" + id] = v; }, up)));
        b.append(h("div", { class: "btn-row" },
          btn("big-go", "ПУСК", () => { x.yHand = true; }, up, () => !isHand(id), () => (isHand(id) ? "" : "Только в ручном режиме")),
          btn("big-stop", "СТОП", () => { x.yHand = false; }, up)));
        b.append(note("В автомате дозатор работает на 4 скоростях: переход на меньшую — по остатку до задания (VesTo3/2/1). После останова ждёт успокоения весов и учитывает «падающий столб» для следующей дозы."));
        b.append(linkRow(z.scale === 1 ? "Окно «Большие весы»" : "Окно «Средние весы»", () => openScale(z.scale === 1 ? "scale1" : "scale2")));
        const inner = h("div", { class: "inner" });
        inner.append(row("Сводообразование (бункер не отдаёт)", toggle(() => C["b" + z.bunk].vault, (v) => { C["b" + z.bunk].vault = v; }, up)));
        inner.append(row("Авария ПЧ дозаторов", toggle(() => V["ErrPCH_Doz" + (z.scale === 1 ? "Komp" : "Dob")], (v) => { V["ErrPCH_Doz" + (z.scale === 1 ? "Komp" : "Dob")] = v; }, up)));
        b.append(h("details", {}, h("summary", {}, "Имитация неисправностей"), inner));
      },
    });
  }
  function openLeb() {
    const x = plc.io.Leb;
    openDlg({
      id: "Leb", title: "Лебёдка биг-бега", sub: "Поз. 51300 · подъём / опускание, ход тележки", node: "Leb",
      build(b, up) {
        b.append(h("div", { class: "cond-grid" }, lampb("ВВЕРХУ", () => V.Leb_Up, up), lampb("ВНИЗУ", () => V.Leb_Dn, up), lampb("ПОЗ. 1", () => V.Leb_Pol1, up), lampb("ПОЗ. 2", () => V.Leb_Pol2, up), lampb("РАБОТА", () => V.Go_Leb, up)));
        b.append(h("div", { class: "btn-row" }, btn("btn-sw", "▲ Вверх", () => { x.up = true; x.down = false; }), btn("btn-sw", "▼ Вниз", () => { x.down = true; x.up = false; }),
          btn("btn-sw", "◀ Поз. 1", () => { x.to1 = true; x.to2 = false; }), btn("btn-sw", "Поз. 2 ▶", () => { x.to2 = true; x.to1 = false; })));
        b.append(row("Затвор бункера 51300 (наполнение мешка)", toggle(() => S.bagValve, (v) => { S.bagValve = v; }, up)));
        b.append(row("В мешке", val(() => fmtKg(C.bigbag.mass), up)));
        b.append(row("Выдача мешка (поз. 2)", h("div", { class: "btn-row" },
          btn("btn-sw", "◀ Влево", () => { S.bagSide = -1; }), btn("btn-sw", "Вправо ▶", () => { S.bagSide = 1; }))));
        b.append(row("Сторона выдачи", val(() => (S.bagSide < 0 ? "влево" : "вправо"), up)));
        b.append(row("Погрузчик", val(() => ({ away: "ожидает", arrive: "подъезжает", lift: "поднимает мешок", leave: "увозит мешок" })[S.fork.phase], up)));
        b.append(row("Вывезено мешков", val(() => String(S.bagsOut), up)));
        b.append(row("Заменить мешок", h("button", { class: "btn-sw", type: "button", onclick: () => { C.bigbag.mass = 0; S.bagOn = true; toast("Новый мешок подвешен"); } }, "Заменить")));
        b.append(note("Поз. 1 — налив под головкой: мешок опущен и открыт затвор бункера 310. Поз. 2 — мешок уезжает по рольгангу в выбранную сторону, его забирает погрузчик. Новый мешок подвешивают, когда тележка вернётся в поз. 1."));
      },
    });
  }

  /* ---------------------------------------------------------------- бункеры и весы */
  function openBunker(nid) {
    const n = S.ND[nid], c = C[n.level], num = n.num;
    const raw = /^b10\d$/.test(nid), add = /^b20\d$/.test(nid), gp = /^s\d+$/.test(n.level);
    openDlg({
      id: nid, title: num ? `Бункер ${num}` : n.label || nid, sub: raw ? "Сырьевой бункер БВ (большие весы)" : add ? "Бункер добавок (средние весы)" : gp ? "Бункер готовой продукции" : "Оперативный бункер · " + (n.poz || ""), node: nid,
      build(b, up) {
        b.append(row("Продукт", val(() => (c.mass > 0.5 ? c.prod || "—" : "пусто"), up)));
        b.append(row("Масса", val(() => fmtKg(c.mass), up)));
        b.append(row("Заполнение", val(() => Math.round(c.mass / c.cap * 100), up), h("span", { class: "unit" }, "%")));
        b.append(row("Вместимость", val(() => fmtKg(c.cap), up)));
        const dv = () => (raw ? V.DVU_BunkK[num - 100] : add ? V.DVU_BunkD[num - 200] : gp ? V.DVU_Silo[+n.level.slice(1)] : V["DVU_" + n.level]);
        const dn = () => (raw ? V.DNU_BunkK[num - 100] : add ? V.DNU_BunkD[num - 200] : gp ? V.DNU_Silo[+n.level.slice(1)] : V["DNU_" + n.level]);
        b.append(h("div", { class: "cond-grid" }, lampb("ДВУ", dv, up, "bad"), lampb("ДНУ", dn, up)));
        if (raw || add) {
          const bk = DB.data.bunkers.find((q) => q.n === num);
          const sel = h("select", {}, DB.data.raw.filter((r) => r.place === (raw ? "БВ" : "СВ")).map((r) => h("option", { value: r.code }, `${r.code} · ${r.name}`)));
          sel.value = bk.code;
          sel.addEventListener("change", () => { bk.code = +sel.value; DB.save(); toast(`Бункер ${num}: назначено «${DB.raw(bk.code).name}»`); });
          b.append(row("Сырьё по назначению", sel));
          b.append(row("Запрет дозирования", toggle(() => bk.blockDos, (v) => { bk.blockDos = v; DB.save(); }, up)));
          if (c.mass > 1 && c.prod && DB.raw(bk.code) && c.prod !== DB.raw(bk.code).name) b.append(note(`⚠ В бункере «${c.prod}», а назначено «${DB.raw(bk.code).name}». Дозирование возьмёт то, что лежит в бункере.`));
          b.append(row("Сводообразование", toggle(() => c.vault, (v) => { c.vault = v; }, up)));
        }
        if (add) b.append(row("Засыпать мешок 25 кг", h("button", { class: "btn-sw", type: "button", onclick: () => { const r = DB.raw(DB.data.bunkers.find((q) => q.n === num).code); C["b" + num].mass = Math.min(c.cap, c.mass + 25); if (r) c.prod = r.name; toast(`Бункер ${num}: +25 кг`); } }, "+25 кг")));
        if (raw) b.append(linkRow("Окно «Загрузка БВ»", openLoad));
        if (gp) {
          const s = +n.level.slice(1);
          b.append(row("Выгрузить в автомобиль", h("button", { class: "btn-sw", type: "button", onclick: () => callTruck(s) }, "Вызвать машину")));
          b.append(linkRow("Окно «Отгрузка ГП»", openCars));
        }
        if (nid === "UpBunk" || nid === "DownBunk") b.append(linkRow("Окно «Смеситель и УДЖК»", openMixer));
        if (nid === "PBGran") b.append(linkRow("Окно «Гранулирование»", openGran));
      },
    });
  }
  function callTruck(s) {
    const id = s === 9 ? "truck_g3" : s <= 4 ? "truck_g1" : "truck_g2", t = S.trucks[id];
    if (t.phase !== "away") return toast("Машина у этого ряда бункеров уже на загрузке", true);
    if (C["s" + s].mass < 50) return toast(`Бункер ${300 + s} пуст`, true);
    t.req = s; toast(`Машина вызвана под бункер ${300 + s}`);
    if (!S.autoTrucks) { t.silo = s; t.req = 0; t.phase = "arrive"; t.x = 1.4; t.load = 0; }
  }
  function compTable(list, cur, scaleId) {
    const t = h("table", { class: "hmi-table" }, h("tr", {}, h("th", {}, "Бунк."), h("th", {}, "Компонент"), h("th", {}, "Задание"), h("th", {}, "Факт"), h("th", {}, "Статус")));
    (list || []).forEach((c, i) => t.append(h("tr", { class: i === cur ? "cur" : c.status === "сдозировано" ? "done" : "" }, h("td", {}, c.bunk), h("td", {}, c.name), h("td", {}, c.req.toFixed(scaleId === "scale1" ? 1 : 2)), h("td", {}, (+c.done || 0).toFixed(scaleId === "scale1" ? 1 : 2)), h("td", {}, c.status))));
    return t;
  }
  function openScale(sid) {
    const big = sid === "scale1";
    openDlg({
      id: sid, title: big ? "Большие весы 500 кг" : "Средние весы 100 кг", sub: big ? "Поз. 20100 · компоненты из бункеров 101–106 · PrgDosingK" : "Поз. 21100 · добавки из бункеров 201–208 · PrgDosingD", node: sid, wide: true,
      build(b, up) {
        b.append(row("Вес", val(() => (big ? V.Ves1 : V.Ves2), up), h("span", { class: "unit" }, "кг")));
        b.append(row("Порция", val(() => { const j = big ? PS.kJob : PS.dJob; return j ? `${j.n} · ПП «${j.pp.name}»` : "нет"; }, up)));
        const box = h("div", {});
        b.append(box);
        let sig = "";
        up(() => {
          const j = big ? PS.kJob : PS.dJob, list = j ? (big ? j.K : j.D) : null, cur = big ? PS.kComp : PS.dComp;
          const s = JSON.stringify(list ? list.map((c) => [c.status, (+c.done || 0).toFixed(1)]) : null) + cur;
          if (s === sig) return; sig = s;
          box.innerHTML = ""; if (list) box.append(compTable(list, cur, sid)); else box.append(note("Весы свободны: нет порции в дозировании."));
        });
        b.append(row("Затвор весов", val(() => (M[big ? "ZatvK" : "ZatvD"].pos > 0.5 ? "открыт" : "закрыт"), up)));
        b.append(row("Пауза дозирования", toggle(() => V[big ? "PauseDosingK" : "PauseDosingD"], (v) => { V[big ? "PauseDosingK" : "PauseDosingD"] = v; }, up)));
        b.append(row("Допустимый остаток на весах", num(() => V[big ? "DopOstBig" : "DopOstMid"], (v) => { V[big ? "DopOstBig" : "DopOstMid"] = v; }, up, "кг", 0.1)));
        b.append(row("Время успокоения весов", num(() => V.UspVes[big ? 1 : 2], (v) => { V.UspVes[big ? 1 : 2] = Math.max(0, v); }, up, "с")));
        b.append(linkRow("Затвор весов — окно", () => openDrive(big ? "ZatvK" : "ZatvD")));
        const inner = h("div", { class: "inner" });
        if (big) inner.append(row("Дрейф нуля тензодатчиков (+7 кг)", toggle(() => M.ZatvK.sim.drift, (v) => { M.ZatvK.sim.drift = v; }, up)));
        inner.append(row("Заклинивание затвора", toggle(() => M[big ? "ZatvK" : "ZatvD"].sim.jam, (v) => { M[big ? "ZatvK" : "ZatvD"].sim.jam = v; }, up)));
        b.append(h("details", {}, h("summary", {}, "Имитация неисправностей"), inner));
      },
    });
  }

  /* ---------------------------------------------------------------- участки */
  function openLoad() {
    const sel = { q: [] };
    openDlg({
      id: "load", title: "Загрузка бункеров БВ", sub: "MainCycleLoad + PrgLoading · завальная яма → нория 10200 → скальператор → нория 10400 → шнек 10500 → бункеры 101–106", wide: true, node: "pit",
      build(b, up) {
        b.append(statusRow(() => (V.Load1St0 ? [`Загрузка: бункер ${100 + (PS.queueLoad[0] || 0)} · очередь ${PS.queueLoad.map((q) => 100 + q).join(", ")}`, "ok"] : ["Загрузка не запущена", ""]), up));
        b.append(row("В завальной яме", val(() => `${fmtKg(C.pit.mass)} · ${C.pit.prod || "—"}`, up)));
        const mat = h("select", {}, DB.data.raw.filter((r) => r.place === "БВ").map((r) => h("option", { value: r.name }, r.name)));
        mat.value = S.pitMaterial || C.pit.prod || "Пшеница";
        mat.addEventListener("change", () => { S.pitMaterial = mat.value; toast(`Следующие самосвалы привезут «${mat.value}»`); });
        b.append(row("Самосвалы везут", mat));
        b.append(row("Автоподвоз зерна", toggle(() => S.autoTrucks, (v) => { S.autoTrucks = v; }, up)));
        b.append(row("Через скальператор (Regim2.6)", toggle(() => V.Regim2_6, (v) => { V.Regim2_6 = v; }, up, () => V.Load1St0)));
        b.append(sect("Очередь бункеров (порядок выбора)"));
        const pick = h("div", { class: "chk-row" });
        for (let i = 1; i <= 6; i++) {
          const bt = h("button", { class: "btn-sw", type: "button" }, String(100 + i));
          bt.addEventListener("click", () => { const k = sel.q.indexOf(i); if (k >= 0) sel.q.splice(k, 1); else sel.q.push(i); refresh(); });
          up(() => { const k = sel.q.indexOf(i); bt.classList.toggle("on", k >= 0); bt.textContent = (k >= 0 ? k + 1 + ": " : "") + (100 + i) + " · " + Math.round(C["b" + (100 + i)].mass / C["b" + (100 + i)].cap * 100) + "%"; });
          pick.append(bt);
        }
        b.append(pick);
        b.append(note("Загружаемое сырьё должно совпадать с назначением бункера в базе («Сырьевые бункера»). Бункер переключается по ДВУ или кнопке «Следующий бункер»; тракт перед переключением выгружается."));
        b.append(h("div", { class: "btn-row" },
          btn("big-go sm", "ПУСК", () => {
            if (!sel.q.length) return toast("Выберите бункеры для загрузки", true);
            const wrong = sel.q.filter((i) => { const bk = DB.data.bunkers.find((q) => q.n === 100 + i); const r = DB.raw(bk.code); return r && C.pit.prod && r.name !== C.pit.prod && C.pit.mass > 100; });
            if (wrong.length) toast(`Внимание: в яме «${C.pit.prod}», бункеры ${wrong.map((i) => 100 + i).join(", ")} назначены под другое сырьё`, true);
            const r = CMD.startLoad(C.pit.prod, sel.q, true); if (r) toast(r, true); else toast("Загрузка БВ запущена");
          }, up, () => V.Load1St0 || V.GEmer, () => (V.GEmer ? "Общая авария" : "")),
          btn("big-blue", "Следующий бункер", () => CMD.nextLoadBunk(), up, () => !V.Load1St0),
          btn("big-stop sm", "СТОП", () => CMD.stopLoad(), up, () => !V.Load1St0)));
      },
    });
  }
  function openMixer() {
    openDlg({
      id: "mix", title: "Смеситель и УДЖК", sub: "PrgUnloadToSms + PrgSmesitel · НСБ → смеситель 30700 → ПСБ; масло УДЖК-1-БП", node: "Sms", wide: true,
      build(b, up) {
        b.append(statusRow(() => { const j = PS.mixJob; return j ? [`Порция ${j.n} · ${j.pp.product}: ${j.stage}`, "ok"] : ["Смеситель свободен", ""]; }, up));
        b.append(row("Надсмесительный бункер (НСБ)", val(() => fmtKg(C.UpBunk.mass), up)));
        b.append(row("В смесителе", val(() => fmtKg(C.Sms.mass), up)));
        b.append(row("Подсмесительный бункер (ПСБ)", val(() => fmtKg(C.DownBunk.mass), up)));
        b.append(row("Масло в весовой ёмкости УДЖК", val(() => V.Ves4, up), h("span", { class: "unit" }, "кг")));
        b.append(row("Масло в ёмкости ВЖД4", val(() => fmtKg(C.tankOil.mass), up)));
        b.append(row("Фаза УДЖК", val(() => ({ idle: "ожидание", dose: "ввод в смеситель", blow: "продувка" }[PS.jir.phase] || PS.jir.phase), up)));
        b.append(h("div", { class: "cond-grid" }, lampb("ДОЛИВ", () => V.Go_MasloDop, up), lampb("ПОДАЧА", () => V.Go_MasloDos, up), lampb("ПРОДУВ", () => V.Go_Produv, up), lampb("КЛАПАН НСБ", () => M.KlapSms.pos > 0.5, up), lampb("ЗАСЛ. ПСБ", () => M.ShDownSms.pos > 0.5, up)));
        b.append(row("Масло не доливается — повторить", h("button", { class: "btn-sw", type: "button", onclick: () => CMD.retryOil() }, "Повторить")));
        b.append(row("Пропустить ввод масла в порции", h("button", { class: "btn-sw", type: "button", onclick: () => CMD.stopOil() }, "Без масла")));
        b.append(linkRow("Смеситель 30700 — окно привода", () => openDrive("Sms")));
        const inner = h("div", { class: "inner" });
        inner.append(row("Авария насоса долива масла", toggle(() => M.Jir.sim.pump, (v) => { M.Jir.sim.pump = v; }, up)));
        inner.append(row("Авария компрессора (нет воздуха)", toggle(() => M.compr.sim.az, (v) => { M.compr.sim.az = v; }, up)));
        inner.append(row("Заклинивание клапана НСБ", toggle(() => M.KlapSms.sim.jam, (v) => { M.KlapSms.sim.jam = v; }, up)));
        b.append(h("details", {}, h("summary", {}, "Имитация неисправностей"), inner));
      },
    });
  }
  function openGran() {
    openDlg({
      id: "gran", title: "Гранулирование", sub: "PrgGran · БО-5 → питатель → кондиционер (пар) → пресс → охладитель → просеиватель", node: "Gran", wide: true,
      build(b, up) {
        b.append(statusRow(() => (V.Err30_8 ? ["Перегрузка главного привода — забивание матрицы", "bad"] : V.GrStart ? [V.GranIsWork ? "Гранулирование идёт" : "Пуск линии гранулирования", "ok"] : ["Гранулятор остановлен", ""]), up));
        b.append(h("div", { class: "cond-grid" }, lampb("ЛИНИЯ", () => V.GranUnlRun, up), lampb("ПРЕСС", () => V.GranIsWork, up), lampb("ПОДАЧА", () => V.Go_PitGr, up), lampb("СТОП ПОД.", () => V.GrStopLoad, up, "warn"), lampb("ХОЛОДНО", () => V.GrHotStopLoad, up, "warn")));
        b.append(row("Запустить гранулирование (GrStart)", toggle(() => V.GrStart, (v) => { V.GrStart = v; if (v) toast("Линия гранулирования запускается"); }, up)));
        b.append(row("Автозапуск при наличии продукта в БО-5", toggle(() => V.AutoGrStart, (v) => { V.AutoGrStart = v; }, up)));
        const dest = h("select", {}, [[8, "Нория ГП → бункера 301–308"], [309, "Бункер 309 (нория 50100г)"], [310, "Биг-бег 51300"]].map(([v, t]) => h("option", { value: v }, t)));
        dest.value = V.GranDest || 8; dest.addEventListener("change", () => { V.GranDest = +dest.value; });
        b.append(row("Куда гранулы", dest));
        b.append(row("Остановить подачу (выработать продукт)", toggle(() => V.GrStopLoadBtn, (v) => { V.GrStopLoadBtn = v; }, up)));
        b.append(row("Очистка без просеивания (GrClear)", toggle(() => V.GrClear, (v) => { V.GrClear = v; }, up)));
        b.append(sect("Процесс"));
        b.append(row("БО-5", val(() => fmtKg(C.PBGran.mass), up)));
        b.append(row("Ток пресса (ном. / макс.)", val(() => `${V.TokGran} А  (${V.TokNomGran} / ${V.TokMaxGran})`, up)));
        b.append(row("Производительность питателя", val(() => `${Math.round(V.ppPwCurrent || 0)} % · +через ${V.ppSecToInc || 0} с`, up)));
        b.append(row("Частота питателя", val(() => (+V.FreqPitGr || 0).toFixed(1), up), h("span", { class: "unit" }, "Гц")));
        b.append(row("Температура после кондиционера", val(() => V.TempKond, up), h("span", { class: "unit" }, "°C")));
        b.append(row("Задание температуры", num(() => V.TempKondSet, (v) => { V.TempKondSet = v; }, up, "°C")));
        b.append(row("Мин. температура подачи", num(() => V.TempKondMin, (v) => { V.TempKondMin = v; }, up, "°C")));
        b.append(row("Клапан пара", val(() => Math.round(+V.SteamValve || 0), up), h("span", { class: "unit" }, "%")));
        b.append(row("Ручное управление паром", toggle(() => V.SteamManual, (v) => { V.SteamManual = v; }, up)));
        b.append(row("Положение клапана (ручн.)", num(() => V.SteamManualPos, (v) => { V.SteamManualPos = Math.max(0, Math.min(100, v)); }, up, "%")));
        b.append(row("Гранулы после охладителя", val(() => V.TempGranOut, up), h("span", { class: "unit" }, "°C")));
        b.append(note("Питатель стартует с ppPwStart и каждые ppInterval с прибавляет ppPwDelta, пока ток пресса не превысит номинальный; при перегрузке 10 с — отступает. Ток выше максимального 3 с — авария Err30.8 (забивание матрицы)."));
        b.append(row("Сброс аварии гранулятора", h("button", { class: "btn-sw", type: "button", onclick: () => { V.Regim2_14 = true; } }, "Сброс")));
        const inner = h("div", { class: "inner" });
        inner.append(row("Сводообразование в БО-5", toggle(() => C.PBGran.vault, (v) => { C.PBGran.vault = v; }, up)));
        inner.append(row("Нет пара (котёл остановлен)", toggle(() => S.noSteam, (v) => { S.noSteam = v; }, up)));
        inner.append(row("Перегрев воздуха охладителя", toggle(() => M.Ohl.sim.hot, (v) => { M.Ohl.sim.hot = v; }, up)));
        b.append(h("details", {}, h("summary", {}, "Имитация неисправностей"), inner));
      },
    });
  }
  function openCars() {
    openDlg({
      id: "cars", title: "Отгрузка готовой продукции", sub: "PrgUnloadToCar · бункеры 301–309 → автомобили", wide: true, node: null,
      build(b, up) {
        b.append(row("Автоматический вызов машин", toggle(() => S.autoTrucks, (v) => { S.autoTrucks = v; }, up)));
        const t = h("table", { class: "hmi-table" }, h("tr", {}, h("th", {}, "Бункер"), h("th", {}, "Продукт"), h("th", {}, "Масса"), h("th", {}, "Шибер"), h("th", {}, "")));
        for (let s = 1; s <= 9; s++) {
          const tr = h("tr", {}, h("td", {}, 300 + s), h("td", {}), h("td", {}), h("td", {}), h("td", {}, h("button", { class: "btn-sw", type: "button", onclick: () => callTruck(s) }, "Машину")));
          up(() => { const c = C["s" + s]; tr.children[1].textContent = c.mass > 1 ? c.prod : "—"; tr.children[2].textContent = fmtKg(c.mass); tr.children[3].textContent = M["ShO" + s].pos > 0.95 ? "открыт" : M["ShO" + s].pos > 0.02 ? "движется" : "закрыт"; });
          t.append(tr);
        }
        b.append(t);
        b.append(sect("Машины"));
        ["truck_g1", "truck_g2", "truck_g3"].forEach((id, i) => b.append(row(["Ряд 301–304", "Ряд 305–308", "Бункер 309"][i],
          val(() => { const tr = S.trucks[id]; return { away: "нет машины", arrive: `едет к ${300 + tr.silo}`, load: `загрузка из ${300 + tr.silo}: ${(tr.load * 20).toFixed(1)} т`, leave: "уезжает" }[tr.phase] || tr.phase; }, up))));
      },
    });
  }
  function openProd() {
    openDlg({
      id: "prod", title: "Производство", sub: "MainCycle1 · программы производства из SCADA", node: null,
      build(b, up) {
        b.append(statusRow(() => [PS.msg, V.Regim2_10 ? "ok" : V.Regim2_9 ? "warn" : ""], up));
        b.append(h("div", { class: "cond-grid" }, lampb("Regim2.9", () => V.Regim2_9, up), lampb("ДОЗИР.", () => V.RunDosing, up), lampb("ВЫГР.", () => V.UnloadSt0, up), lampb("ГРАН.", () => V.GranUnlRun, up), lampb("СТОП", () => V.StopDosing, up, "warn")));
        b.append(row("Порций в работе", val(() => PS.jobs.filter((j) => !j.mixed).length, up)));
        b.append(row("Бункер ГП для выгрузки", val(() => (V.UnloadTarget ? 300 + V.UnloadTarget : "—"), up)));
        b.append(h("div", { class: "btn-row" },
          btn("big-go sm", "ПУСК", startProd, up, () => V.Regim2_9),
          btn("big-blue", "После порции", () => CMD.stopProduction(2), up, () => !V.Regim2_9),
          btn("big-stop sm", "СТОП", () => CMD.stopProduction(3), up, () => !V.Regim2_9 && !V.Regim2_10)));
        b.append(linkRow("Программы, рецепты и порции — вкладка «Производство»", () => { closeDlg(); switchTab("prod"); }));
        b.append(linkRow("Большие весы", () => openScale("scale1")));
        b.append(linkRow("Средние весы", () => openScale("scale2")));
        b.append(linkRow("Смеситель и УДЖК", openMixer));
        b.append(linkRow("Дробление: дробилка 30410", () => openDrive("Drob1")));
      },
    });
  }
  function openCabinet() {
    const ES = [["EmerStopShkaf", "Аварийный стоп на шкафу"], ["EmerStopScalp", "Аварийный стоп у завальной ямы"], ["EmerStopBunkZ", "Аварийный стоп у бункеров загрузки"],
      ["EmerStopBunkD", "Аварийный стоп у бункеров добавок"], ["EmerStopBunkV", "Аварийный стоп у бункеров выгрузки"], ["EmerStopExit", "Аварийный стоп у лестницы"],
      ["EmerStopUdjk", "Аварийный стоп у УДЖК"], ["EmerStopFire", "Пожарная сигнализация"]];
    openDlg({
      id: "cab", title: "Шкаф управления ШУ", sub: "Кнопки и переключатели на двери шкафа · режимы работы (Regim)", node: "cab",
      build(b, up) {
        b.append(statusRow(() => (V.GEmer ? ["Общая авария (GEmer)", "bad"] : ["Готов к работе", "ok"]), up));
        b.append(row("Кнопка «ПУСК» на шкафу", btn("big-go sm", "ПУСК", () => { V.EmerPuskBtn = false; toast("Шкаф включён: сброс аварий"); })));
        b.append(row("Состояние «ПУСК» (EmerPuskBtn = нет пуска)", lampb("НЕТ ПУСКА", () => V.EmerPuskBtn, up, "bad")));
        b.append(row("Отключить шкаф (снять «ПУСК»)", h("button", { class: "btn-sw", type: "button", onclick: () => { V.EmerPuskBtn = true; } }, "Откл.")));
        b.append(sect("Аварийные стопы (грибки)"));
        ES.forEach(([k, t]) => b.append(row(t, toggle(() => V[k], (v) => { V[k] = v; }, up))));
        b.append(sect("Режимы"));
        b.append(row("Ручное управление всеми механизмами (Regim0)", toggle(() => V.Regim0, (v) => { V.Regim0 = v; }, up)));
        b.append(row("Режим наладки (Regim1) — пуск без блокировок", toggle(() => V.Regim1, (v) => { V.Regim1 = v; }, up)));
        b.append(row("Отключить сирену (Regim2.2)", toggle(() => V.Regim2_2, (v) => { V.Regim2_2 = v; }, up)));
        b.append(row("Проверка сирены (Regim2.4)", toggle(() => V.Regim2_4, (v) => { V.Regim2_4 = v; }, up)));
        b.append(row("Сброс аварий (Regim2.14)", h("button", { class: "btn-sw", type: "button", onclick: () => { V.Regim2_14 = true; toast("Сброс аварий"); } }, "Сброс")));
        b.append(h("div", { class: "cond-grid" }, lampb("АВАРИЯ", () => V.RunLamp, up, "bad"), lampb("СИРЕНА", () => V.RunSirena, up, "warn"), lampb("GEMER", () => V.GEmer, up, "bad"), lampb("РУЧН.", () => V.MHand, up, "warn"), lampb("НАЛАДКА", () => V.MGod, up, "warn")));
        b.append(note("После включения шкафа «ПУСК» не нажат — это общая авария (GEmer), все механизмы заблокированы. Нажатие «ПУСК» снимает её и сбрасывает защёлкнутые аварии."));
      },
    });
  }
  function openJournal() { closeDlg(); switchTab("alarms"); }
  function openMenu() {
    openDlg({
      id: "menu", title: "Меню управления", node: null,
      build(b) {
        [["Загрузка бункеров БВ", openLoad], ["Производство", openProd], ["Большие весы", () => openScale("scale1")], ["Средние весы", () => openScale("scale2")],
          ["Смеситель и УДЖК", openMixer], ["Гранулирование", openGran], ["Отгрузка готовой продукции", openCars], ["Шкаф управления", openCabinet],
          ["Программы и рецепты", () => { closeDlg(); switchTab("prod"); }], ["Журнал аварий", openJournal], ["Настройки", () => { closeDlg(); switchTab("settings"); }]]
          .forEach(([t, f]) => b.append(h("button", { class: "menu-item", type: "button", onclick: f }, t)));
      },
    });
  }
  function startProd() {
    const r = CMD.startProduction();
    if (r) { toast(r, true); return false; }
    toast("Пуск производства: предпусковая сирена 20 с"); return true;
  }

  // узел мнемосхемы → окно
  function nodeOf(id) { for (const [k, n] of Object.entries(S.ND)) if (n.drive === id || n.drive2 === id) return k; return null; }
  function openNode(nid) {
    const n = S.ND[nid]; if (!n) return;
    if (nid === "Pros") return openDrive("Pros1");
    if (n.dozer) return openDozator(nid);
    if (n.drive && (DEF[n.drive] || plc.fbs[n.drive])) {
      if (nid === "Jir") return openMixer();
      return openDrive(n.drive);
    }
    if (n.kind === "bunker") return openBunker(nid);
    if (n.kind === "scale") return openScale(nid);
    if (nid === "pit" || nid === "truck_in") return openLoad();
    if (nid.startsWith("truck_g")) return openCars();
    if (nid === "cab") return openCabinet();
    if (nid === "tankOil" || nid === "compr") return openMixer();
    if (nid === "boiler") return openGran();
    if (nid === "trash") { C.trash.mass = 0; return toast("Контейнер отходов вывезен"); }
  }

  /* ================================================================ правая панель */
  const RAIL_ORDER = ALL.filter((id) => M[id]);
  function buildRail() {
    const box = $("#rail-machines"); box.innerHTML = "";
    RAIL_ORDER.forEach((id) => box.append(h("button", { class: "rail-machine", type: "button", "data-id": id, onclick: () => { R.focus(nodeOf(id) || id); openDrive(id); } },
      h("span", { class: "led" }), h("span", {}, title(id)), h("span", { class: "poz" }, poz(id)))));
    $("#rail-search").addEventListener("input", (e) => {
      const q = e.target.value.trim().toLowerCase();
      $$(".rail-machine").forEach((b) => { b.style.display = !q || b.textContent.toLowerCase().includes(q) ? "" : "none"; });
    });
    $("#btn-menu").addEventListener("click", openMenu);
    $("#rail-load").addEventListener("click", openLoad);
    $("#rail-prod").addEventListener("click", openProd);
    $("#rail-gran").addEventListener("click", openGran);
    $("#rail-cars").addEventListener("click", openCars);
    $("#rail-cabinet").addEventListener("click", openCabinet);
  }
  function updateRail() {
    $$(".rail-machine").forEach((b) => { const id = b.dataset.id; b.firstChild.className = "led " + drvState(id)[2]; });
  }

  /* ================================================================ вкладки */
  let tab = "mimic";
  function switchTab(t) {
    tab = t;
    $$(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === t));
    $$(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + t));
    if (t === "prod") renderProd(true);
    if (t === "settings") buildSettings();
    if (t === "signals") buildSignals();
    updateViews();
  }
  $$(".tab").forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));

  /* ---------------------------------------------------------------- производство */
  const draft = { product: "КК-60", total: 4000, name: "", unload: [2] };
  function panel(titleText, ...kids) { return h("section", { class: "panel" }, h("h3", {}, titleText), ...kids); }
  function renderProd(full) {
    const body = $("#prod-body");
    if (full || !body.firstChild) {
      body.innerHTML = "";
      const grid = h("div", { class: "pr-grid" });
      // программы ПП (SCADA)
      const prog = panel("Программы производства",
        h("p", { class: "muted" }, "Программа (ПП) — продукт, масса и бункеры ГП для выгрузки. «Активировать» передаёт её в ПЛК; ПЛК выполняет активные программы по очереди."),
        progForm(), h("div", { class: "table-wrap" }, h("table", { class: "grid-table compact" },
          h("thead", {}, h("tr", {}, h("th", {}, "№"), h("th", {}, "Название"), h("th", {}, "Продукт"), h("th", { class: "c-num" }, "Масса"), h("th", {}, "Выгрузка"), h("th", {}, "Статус"), h("th", {}))),
          h("tbody", { id: "pp-rows" }))));
      prog.classList.add("wide");
      grid.append(prog);
      grid.append(panel("Выполнение в ПЛК", h("div", { id: "pp-plc" })));
      grid.append(panel("Порции в работе", h("p", { class: "muted" }, "Конвейер порций: весы → дробление → НСБ → смеситель → ПСБ → бункер ГП."), h("div", { id: "pp-jobs" })));
      grid.append(panel("Рецепты", h("div", { id: "pp-recipes" })));
      grid.append(panel("Сырьевые бункера", h("p", { class: "muted" }, "Назначение сырья по бункерам: из какого бункера дозировать компонент рецепта."), h("div", { id: "pp-bunkers" })));
      const gp = panel("Готовая продукция", h("div", { id: "pp-products" }));
      grid.append(gp);
      body.append(grid);
      renderStatic();
    }
    renderProgRows(); renderPlcProgs(); renderJobs();
  }
  function progForm() {
    const prodSel = h("select", {}, DB.data.products.map((p) => h("option", { value: p.code }, `${p.code} · ${p.name}`)));
    prodSel.value = draft.product;
    const total = h("input", { type: "number", min: 100, step: 100, value: draft.total });
    const name = h("input", { type: "text", placeholder: "авто", value: draft.name });
    const silos = h("div", { class: "silo-pick" });
    const drawSilos = () => { silos.innerHTML = ""; for (let s = 1; s <= 8; s++) { const k = draft.unload.indexOf(s); silos.append(h("button", { type: "button", class: k >= 0 ? "on" : "", title: "Порядок выгрузки", onclick: () => { if (k >= 0) draft.unload.splice(k, 1); else draft.unload.push(s); drawSilos(); } }, (k >= 0 ? k + 1 + "·" : "") + (300 + s))); } };
    drawSilos();
    prodSel.addEventListener("change", () => { draft.product = prodSel.value; });
    total.addEventListener("change", () => { draft.total = +total.value; });
    name.addEventListener("input", () => { draft.name = name.value; });
    const add = h("button", { class: "btn btn-go", type: "button", onclick: () => {
      const p = DB.product(draft.product);
      const pp = { id: DB.data.nextPP++, name: draft.name.trim() || `${p.code} — ${(draft.total / 1000).toFixed(1)} т`, product: draft.product, total: Math.max(100, +draft.total || 0), status: "новая", unload: draft.unload.slice() };
      const r = DB.buildProgram(pp); if (r.error) return toast(r.error, true);
      DB.data.programs.push(pp); DB.save(); draft.name = ""; name.value = ""; renderProgRows(); toast(`ПП «${pp.name}» создана: ${r.prog.portions} порций по ${r.prog.portionKg} кг`);
    } }, "+ Создать ПП");
    return h("div", { class: "form-row" }, h("label", {}, "Продукт", prodSel), h("label", {}, "Масса, кг", total), h("label", {}, "Название", name), h("label", {}, "Бункеры ГП (порядок)", silos), add);
  }
  let ppSig = "";
  function renderProgRows() {
    const tb = $("#pp-rows"); if (!tb) return;
    const sig = JSON.stringify(DB.data.programs.map((p) => [p.id, p.status])) + PS.programs.map((p) => p.id + p.status).join();
    if (sig === ppSig && tb.childElementCount) return; ppSig = sig;
    tb.innerHTML = "";
    if (!DB.data.programs.length) tb.append(h("tr", {}, h("td", { colspan: 7, class: "empty-note" }, "Нет программ")));
    DB.data.programs.forEach((pp) => {
      const inPlc = PS.programs.find((q) => q.id === pp.id && !["выполнена", "прервана"].includes(q.status));
      const st = inPlc ? inPlc.status : pp.status;
      tb.append(h("tr", {}, h("td", { class: "c-poz" }, pp.id), h("td", {}, pp.name), h("td", {}, pp.product), h("td", { class: "c-num" }, fmtKg(pp.total)),
        h("td", {}, (pp.unload || []).map((s) => 300 + s).join(" → ") || "—"),
        h("td", {}, h("span", { class: "chip " + (st === "работает" ? "ok" : st === "активирована" ? "info" : st === "выполнена" ? "ok" : st === "прервана" ? "bad" : "") }, st)),
        h("td", {}, inPlc ? null : h("button", { class: "btn btn-sm", type: "button", onclick: () => activate(pp) }, "Активировать"),
          inPlc ? null : h("button", { class: "btn btn-sm", type: "button", onclick: () => { DB.data.programs = DB.data.programs.filter((q) => q !== pp); DB.save(); renderProgRows(); } }, "✕"))));
    });
  }
  function activate(pp) {
    const r = DB.buildProgram(pp); if (r.error) return toast(r.error, true);
    const missing = r.prog.comps.filter((c) => c.place !== "УДЖК" && C["b" + c.bunk].mass < r.prog.portionKg * c.pct / 100 * 1.05);
    plc.prod.cmd.activate(r.prog);
    if (!PS.unloadList.length || PS.programs.filter((p) => p.status === "работает").length === 1) CMD.setUnloadList(r.prog.unload);
    pp.status = "активирована"; DB.save(); ppSig = ""; renderProgRows(); renderPlcProgs();
    toast(`ПП «${pp.name}» активирована` + (missing.length ? `. Мало сырья в бункерах ${missing.map((c) => c.bunk).join(", ")}` : ""), !!missing.length);
  }
  function renderPlcProgs() {
    const box = $("#pp-plc"); if (!box) return;
    const list = PS.programs;
    box.innerHTML = "";
    if (!list.length) { box.append(h("div", { class: "empty-note" }, "Нет активированных программ. Создайте ПП и нажмите «Активировать», затем «Пуск производства».")); return; }
    box.append(h("div", { class: "sig-row" }, h("span", {}, "Состояние"), h("b", {}, PS.msg)));
    box.append(h("div", { class: "sig-row" }, h("span", {}, "Очередь бункеров ГП"), h("b", {}, PS.unloadList.map((s) => 300 + s).join(" → ") || "—")));
    list.forEach((p) => {
      const pct = p.portions ? p.done / p.portions * 100 : 0;
      box.append(h("div", { class: "sig-row" }, h("span", {}, h("b", {}, p.name), " · ", p.product, h("br"), h("span", { class: "muted" }, `порции: выдано ${p.issued}, готово ${p.done} из ${p.portions} по ${p.portionKg} кг`)),
        h("span", {}, h("span", { class: "mini-bar" }, h("i", { style: `width:${pct}%` })), h("span", { class: "chip " + (p.status === "работает" ? "ok" : p.status === "выполнена" ? "ok" : p.status === "прервана" ? "bad" : "info") }, p.status))));
    });
  }
  const STAGES = ["весы", "дробление", "НСБ", "смеситель", "ПСБ", "выгружено"];
  function renderJobs() {
    const box = $("#pp-jobs"); if (!box) return;
    const jobs = PS.jobs.filter((j) => !(j.mixed && j.stage === "выгружено")).slice(-6);
    box.innerHTML = "";
    if (!jobs.length) { box.append(h("div", { class: "empty-note" }, "Порций в работе нет.")); return; }
    jobs.forEach((j) => {
      const k = j.K.filter((c) => c.status === "сдозировано").length, d = j.D.filter((c) => c.status === "сдозировано").length;
      box.append(h("div", { class: "sig-row" },
        h("span", {}, h("b", {}, `Порция ${j.n}`), ` · ${j.pp.name}`, h("br"), h("span", { class: "muted" }, `БВ ${k}/${j.K.length} · СВ ${d}/${j.D.length} · масло ${j.J.toFixed(1)} кг · ${j.stage}`)),
        h("span", { class: "chip info" }, j.stage)));
    });
  }
  function renderStatic() {
    const rec = $("#pp-recipes"); rec.innerHTML = "";
    DB.data.recipes.forEach((r) => {
      const t = h("table", { class: "grid-table compact" }, h("thead", {}, h("tr", {}, h("th", {}, "Код"), h("th", {}, "Сырьё"), h("th", {}, "Место"), h("th", { class: "c-num" }, "%"))), h("tbody", {},
        r.comps.map((c) => { const m = DB.raw(c.code) || {}; return h("tr", {}, h("td", {}, c.code), h("td", {}, m.name || "?"), h("td", {}, m.place || ""), h("td", { class: "c-num" }, (+c.pct).toFixed(1))); })));
      rec.append(h("details", {}, h("summary", { style: "cursor:pointer;font-weight:800;padding:6px 0" }, `${r.code} · ${r.name}`), h("div", { class: "table-wrap" }, t)));
    });
    const bk = $("#pp-bunkers"); bk.innerHTML = "";
    const tb = h("tbody", {});
    DB.data.bunkers.filter((b) => b.place !== "УДЖК").forEach((b) => {
      const sel = h("select", {}, DB.data.raw.filter((r) => r.place === b.place).map((r) => h("option", { value: r.code }, r.name)));
      sel.value = b.code; sel.addEventListener("change", () => { b.code = +sel.value; DB.save(); toast(`Бункер ${b.n}: «${DB.raw(b.code).name}»`); });
      const c = C["b" + b.n];
      tb.append(h("tr", {}, h("td", { class: "c-poz" }, b.n), h("td", {}, b.place), h("td", {}, sel), h("td", { class: "c-num" }, fmtKg(c.mass)), h("td", {}, c.prod || "—")));
    });
    bk.append(h("div", { class: "table-wrap" }, h("table", { class: "grid-table compact" }, h("thead", {}, h("tr", {}, h("th", {}, "Бункер"), h("th", {}, "Весы"), h("th", {}, "Назначено"), h("th", { class: "c-num" }, "Лежит"), h("th", {}, "Фактически"))), tb)));
    const pr = $("#pp-products"); pr.innerHTML = "";
    pr.append(h("div", { class: "table-wrap" }, h("table", { class: "grid-table compact" },
      h("thead", {}, h("tr", {}, h("th", {}, "Код"), h("th", {}, "Наименование"), h("th", {}, "Тип"), h("th", { class: "c-num" }, "Порция"), h("th", { class: "c-num" }, "Сух./мокр., с"), h("th", {}, "Рецепт"))),
      h("tbody", {}, DB.data.products.map((p) => h("tr", {}, h("td", { class: "c-poz" }, p.code), h("td", {}, p.name), h("td", {}, p.type), h("td", { class: "c-num" }, p.portion + " кг"), h("td", { class: "c-num" }, `${p.dry} / ${p.wet}`), h("td", {}, p.recipe)))))));
  }

  /* ---------------------------------------------------------------- оборудование */
  function renderEquip() {
    const q = $("#eq-search").value.trim().toLowerCase(), f = $("#eq-filter").value;
    const tb = $("#eq-rows"); tb.innerHTML = "";
    ALL.filter((id) => M[id]).forEach((id) => {
      const [t, cls, ledc] = drvState(id), m = M[id], hand = isHand(id);
      if (q && !(m.name + " " + m.poz + " " + id).toLowerCase().includes(q)) return;
      if (f === "run" && ledc !== "run" && ledc !== "hand") return;
      if (f === "stop" && (ledc === "run" || cls === "bad")) return;
      if (f === "fault" && cls !== "bad") return;
      if (f === "hand" && !hand) return;
      if (f === "to" && m.hours < m.toHours) return;
      const d = DEF[id];
      let extra = "";
      if (id === "Drob1" || id === "Drob2") extra = V["TokDrob" + id.slice(-1)] + " А";
      else if (id === "Gran") extra = V.TokGran + " А";
      else if (/^[KD]\d$/.test(id) || /^Pit/.test(id)) extra = (+V["Freq_" + id] || +V["Freq" + id] || 0).toFixed(1) + " Гц";
      tb.append(h("tr", { class: cls === "bad" ? "row-bad" : "" }, h("td", { class: "c-poz" }, m.poz), h("td", {}, m.name), h("td", {}, d ? GRP[d.grp] || "" : /^K/.test(id) ? "Дозирование" : /^D/.test(id) ? "Дозирование" : "Смешивание"),
        h("td", {}, h("span", { class: "chip " + cls }, t)), h("td", {}, hand ? "Ручной" : "Авто"), h("td", { class: "c-num" }, extra),
        h("td", { class: "c-num" + (m.hours >= m.toHours ? " due" : "") }, m.hours.toFixed(2) + " / " + m.toHours),
        h("td", {}, h("button", { class: "btn btn-sm", type: "button", onclick: () => openDrive(id) }, "Окно"))));
    });
  }
  $("#eq-search").addEventListener("input", () => renderEquip());
  $("#eq-filter").addEventListener("change", () => renderEquip());

  /* ---------------------------------------------------------------- аварии */
  function renderAlarms() {
    const scope = $("#al-scope").value, tb = $("#al-rows"), causes = $("#al-causes");
    causes.innerHTML = "";
    if (V.GEmer) causes.append(h("div", { class: "cause" }, "Общая авария: " + gemerCause()));
    tb.innerHTML = "";
    const rows = scope === "active" ? S.alarms : scope === "archive" ? S.archive.slice(0, 300) : S.log.slice(0, 300);
    if (!rows.length) tb.append(h("tr", {}, h("td", { colspan: 4, class: "empty-note" }, scope === "log" ? "Событий нет" : "Аварий нет")));
    rows.forEach((a) => {
      const kind = a.kind === "bad" ? ["Авария", "bad"] : a.kind === "warn" ? ["Предупр.", "warn"] : ["Событие", "info"];
      tb.append(h("tr", { class: a.active ? "row-bad" : "" }, h("td", { class: "c-num" }, fmtT(a.t)), h("td", {}, h("span", { class: "chip " + kind[1] }, kind[0])), h("td", {}, a.text),
        h("td", {}, scope === "log" ? "" : scope === "archive" ? a.state : a.active ? "активна" : "ушла " + fmtT(a.tEnd))));
    });
  }
  $("#al-scope").addEventListener("change", () => renderAlarms());
  $("#al-reset").addEventListener("click", () => { V.Regim2_14 = true; toast("Сброс аварий"); });
  function gemerCause() {
    const G = [["EmerPuskBtn", "не нажат «ПУСК» на шкафу управления"], ["EmerStopShkaf", "нажат аварийный стоп на шкафу"], ["EmerStopScalp", "нажат стоп у завальной ямы"],
      ["EmerStopBunkZ", "нажат стоп у бункеров загрузки"], ["EmerStopBunkD", "нажат стоп у бункеров добавок"], ["EmerStopBunkV", "нажат стоп у бункеров выгрузки"],
      ["EmerStopExit", "нажат стоп у лестницы"], ["EmerStopUdjk", "нажат стоп у УДЖК"], ["EmerStopScada", "аварийный стоп со SCADA"], ["EmerStopFire", "пожарная сигнализация"]];
    return G.filter(([k]) => V[k]).map(([, t]) => t).join("; ") || "—";
  }

  /* ---------------------------------------------------------------- сигналы */
  const SIG_GROUPS = [
    ["Режимы (MainCycle1)", ["GEmer", "EmerPuskBtn", "Regim0", "Regim1", "MHand", "MGod", "Regim2_9", "Regim2_10", "RunDosing", "StopDosing", "Regim2_13", "Regim2_14", "RunLamp", "RunSirena", "ErrLowPress", "Err30_8", "ErrUnloadK"]],
    ["Загрузка БВ", ["Load1St0", "Load1St1", "CanRunLoad", "CanRunLoadL", "CanRunLoadR", "PolnBunkCur", "ChangeLoadBunk", "NextTr1L", "NextTr1R", "DVPT_Na_Scalp", "DVPT_Na_Nor1", "GoL_Tr1", "GoR_Tr1", "Regim2_6"]],
    ["Весы и дозирование", ["Ves1", "Ves2", "Ves4", "DosingK_Done", "DosingD_Done", "PBDState0", "PBDState1", "WorkPit", "RunDrob", "RunDrob1", "RunDrob2", "DrobIsRun1", "DrobIsRun2", "TokDrob1", "TokDrob2", "FreqPit1", "FreqPit2", "MassPBD", "UsedDrob"]],
    ["Смеситель", ["SmsUpState0", "SmsUpState1", "SmsUpState2", "SmsMainState0", "SmsMainState1", "SmsMainState3", "SmsMainState13", "MustKlapOpen", "MustShOpen", "Go_Klap", "Go_ZaslDown", "KlapOpened", "KlapClosed", "ZaslDownOpened", "ZaslDownClosed", "WantDolivJ1", "Go_MasloDop", "Go_MasloDos", "JirPhase", "MassUp", "MassSms", "MassPSB"]],
    ["Выгрузка ГП", ["UnloadSt0", "UnloadSt1", "canAutoUnl", "canAutoUnlGP", "UseGran", "UnloadTarget", "PolnSiloCur", "Next50200", "Next50300", "Next50400", "NextTrSms", "UseKonv50300"]],
    ["Гранулирование", ["GrStart", "GranUnlRun", "GranIsWork", "GranIsEmpty", "OhlIsEmpty", "GranFeedEnd", "GrStopLoad", "GrHotStopLoad", "GranDest", "TokGran", "ppPwCurrent", "FreqPitGr", "TempKond", "SteamValve", "TempGranOut", "TempOhlIn", "OpenStol", "RunStol", "DVU_OhlGr", "DSU_OhlGr", "DNU_OhlGr", "PP1_Pos1", "PP1_Pos2", "PP2_Pos1", "PP2_Pos2", "PP3_Pos1", "PP3_Pos2"]],
  ];
  function buildSignals() {
    const body = $("#signals-body"); body.innerHTML = "";
    const grid = h("div", { class: "sig-grid" });
    SIG_GROUPS.forEach(([t, keys]) => grid.append(h("section", { class: "panel" }, h("h3", {}, t), keys.map((k) => h("div", { class: "sig-row" }, h("code", {}, k), h("span", { "data-sig": k }))))));
    grid.append(h("section", { class: "panel" }, h("h3", {}, "Уровни (ДВУ / ДНУ)"), h("div", { id: "sig-levels" })));
    grid.append(h("section", { class: "panel wide" }, h("h3", {}, "Выходы Go_* (включённые)"), h("div", { id: "sig-go", class: "bits", style: "flex-wrap:wrap" })));
    body.append(grid);
    renderSignals();
  }
  const fmtV = (v) => (typeof v === "boolean" ? (v ? "1" : "0") : v === undefined ? "—" : typeof v === "number" ? (Math.round(v * 100) / 100).toString() : String(v));
  function renderSignals() {
    $$("[data-sig]").forEach((s) => { const v = V[s.dataset.sig]; s.innerHTML = typeof v === "boolean" || v === undefined ? `<span class="bit${v ? " on" : ""}">${v ? 1 : 0}</span>` : esc(fmtV(v)); });
    const lv = $("#sig-levels");
    if (lv) {
      const bits = (arr, from, to, base) => { let s = ""; for (let i = from; i <= to; i++) s += `<span class="bit${arr[i] ? " on" : ""}" title="${base + i}">${base + i}</span>`; return s; };
      lv.innerHTML = `<div class="sig-row"><span>ДВУ БВ</span><span class="bits">${bits(V.DVU_BunkK, 1, 6, 100)}</span></div><div class="sig-row"><span>ДНУ БВ</span><span class="bits">${bits(V.DNU_BunkK, 1, 6, 100)}</span></div>` +
        `<div class="sig-row"><span>ДНУ СВ</span><span class="bits">${bits(V.DNU_BunkD, 1, 8, 200)}</span></div><div class="sig-row"><span>ДВУ ГП</span><span class="bits">${bits(V.DVU_Silo, 1, 10, 300)}</span></div>` +
        `<div class="sig-row"><span>ДНУ ГП</span><span class="bits">${bits(V.DNU_Silo, 1, 10, 300)}</span></div>` +
        ["PBD", "UpBunk", "DownBunk", "PBGran"].map((k) => `<div class="sig-row"><code>DVU_${k} / DNU_${k}</code><span class="bits"><span class="bit bad${V["DVU_" + k] ? " on" : ""}">В</span><span class="bit${V["DNU_" + k] ? " on" : ""}">Н</span></span></div>`).join("");
    }
    const go = $("#sig-go");
    if (go) go.innerHTML = Object.keys(V).filter((k) => /^Go_/.test(k) && V[k] === true).sort().map((k) => `<span class="bit on" style="padding:3px 6px">${esc(k)}</span>`).join("") || '<span class="muted">Все выходы отключены</span>';
  }

  /* ---------------------------------------------------------------- настройки */
  function setRow(label, input) { return h("div", { class: "set-row" }, h("span", {}, label), input); }
  function setNum(key, step, obj) {
    const o = obj || V;
    const i = h("input", { type: "number", step: step || 1, value: o[key] });
    i.addEventListener("change", () => { const v = parseFloat(i.value); if (isFinite(v)) { o[key] = v; P.save(); toast("Сохранено"); } });
    return i;
  }
  function setChk(get, set) { const i = h("input", { type: "checkbox" }); i.checked = !!get(); i.addEventListener("change", () => { set(i.checked); P.save(); }); return i; }
  function buildSettings() {
    const body = $("#settings-body"); body.innerHTML = "";
    const drob = h("section", { class: "panel" }, h("h3", {}, "Дробление"),
      setRow("Использовать дробилки (1 — №1, 2 — №2, 3 — обе)", setNum("UsedDrob")),
      setRow("Номинальный ток дробилки 1, А", setNum("TokNom1")), setRow("Максимальный ток дробилки 1, А", setNum("TokMax1")),
      setRow("Номинальный ток дробилки 2, А", setNum("TokNom2")), setRow("Максимальный ток дробилки 2, А", setNum("TokMax2")),
      setRow("Ток холостого хода, А", setNum("TokXX")));
    const dos = h("section", { class: "panel" }, h("h3", {}, "Дозирование"),
      setRow("Допустимый остаток на больших весах, кг", setNum("DopOstBig", 0.1)), setRow("Допустимый остаток на средних весах, кг", setNum("DopOstMid", 0.1)),
      setRow("Успокоение больших весов, с", setNum(1, 1, V.UspVes)), setRow("Успокоение средних весов, с", setNum(2, 1, V.UspVes)));
    const gran = h("section", { class: "panel" }, h("h3", {}, "Гранулятор"),
      setRow("Номинальный ток пресса, А", setNum("TokNomGran")), setRow("Максимальный ток пресса, А", setNum("TokMaxGran")),
      setRow("Старт питателя, %", setNum("ppPwStart")), setRow("Цель питателя, %", setNum("ppPwTarg")), setRow("Шаг питателя, %", setNum("ppPwDelta")), setRow("Интервал шага, с", setNum("ppInterval")),
      setRow("Задание температуры кондиционера, °C", setNum("TempKondSet")), setRow("Мин. температура подачи, °C", setNum("TempKondMin")),
      setRow("Охладитель: интервал при ДСУ, мс", setNum("OhlTimeInt1", 100)), setRow("Охладитель: интервал при ДВУ, мс", setNum("OhlTimeInt2", 100)),
      setRow("Охладитель: время очистки, с", setNum("TimeClearOhl")), setRow("Макс. температура воздуха охладителя, °C", setNum("MaxTempVozdOhl")));
    const model = h("section", { class: "panel" }, h("h3", {}, "Модель и отображение"),
      setRow("Автоподвоз зерна и вызов машин под ГП", setChk(() => S.autoTrucks, (v) => { S.autoTrucks = v; })),
      setRow("Подсобный рабочий досыпает добавки", setChk(() => S.autoAdd, (v) => { S.autoAdd = v; })),
      setRow("Подписи механизмов", setChk(() => R.options.labels, (v) => { R.options = { labels: v }; })),
      setRow("Аспирационные воздуховоды", setChk(() => R.options.pipes, (v) => { R.options = { pipes: v }; })),
      setRow("Значки ручного режима «Р»", setChk(() => R.options.tags, (v) => { R.options = { tags: v }; })),
      setRow("Лампы ДВУ / ДНУ на бункерах", setChk(() => R.options.levels, (v) => { R.options = { levels: v }; })),
      setRow("Новогодняя гирлянда по периметру схемы", setChk(() => R.garland.show, (v) => { R.garland.show = v; })));
    const tc = h("section", { class: "panel wide" }, h("h3", {}, "Время очистки механизмов"), h("p", { class: "muted" }, "Сколько механизм работает после пропадания условия пуска (выгрузка тракта), с. Переменные tc* окна «Настройки» SCADA."),
      h("div", { class: "set-grid" }, Object.keys(window.PLC.TC_DEFAULT).map((k) => setRow(k.replace(/^tc/, ""), setNum(k)))));
    body.append(drob, dos, gran, model, tc);
  }
  $("#set-reset-db").addEventListener("click", () => { DB.reset(); toast("База рецептов и программ восстановлена"); renderProd(true); });
  $("#set-reset-all").addEventListener("click", () => { try { localStorage.removeItem("bugry-sim-v1"); localStorage.removeItem("bugry-db-v1"); } catch (e) { /* нет хранилища */ } location.reload(); });

  /* ================================================================ хром */
  function gemerLine() { return V.GEmer ? "Общая авария: " + gemerCause() : ""; }
  function statusLine() {
    if (V.GEmer) return gemerLine();
    const a = S.alarms.find((q) => q.active && q.kind === "bad") || S.alarms.find((q) => q.active);
    if (a) return a.text;
    return S.log[0] ? fmtT(S.log[0].t) + " · " + S.log[0].text : "Нет аварий";
  }
  function updateChrome() {
    const now = new Date();
    $("#clock").textContent = now.toLocaleTimeString("ru-RU"); $("#date").textContent = now.toLocaleDateString("ru-RU");
    const lamp = (id, on, cls) => { $(id).className = "lamp" + (on ? " " + cls : ""); };
    lamp("#lamp-prod", V.Regim2_10 || V.Regim2_9, V.Regim2_10 ? "on-ok" : "on-warn");
    lamp("#lamp-hand", V.MHand || V.MGod, "on-warn");
    lamp("#lamp-gemer", V.GEmer || V.RunLamp, "on-bad");
    lamp("#lamp-siren", V.RunSirena, "on-warn");
    const es = $("#btn-estop"), pressed = V.GEmer;
    es.classList.toggle("pressed", !!pressed);
    es.textContent = pressed ? (V.EmerPuskBtn && !V.Regim2_13 && !V.EmerStopShkaf ? "Нажать «ПУСК» на шкафу" : "Отжать аварийный стоп") : "Аварийный стоп";
    es.title = pressed ? gemerLine() : "Аварийный стоп со SCADA (Regim2.13)";
    $("#btn-start").disabled = !!V.Regim2_9 || !!V.GEmer;
    $("#btn-start").title = V.GEmer ? "Общая авария: сначала снимите причину" : "Regim2.9 — запуск производства по активной программе";
    $("#btn-stop").disabled = !V.Regim2_9 && !V.Regim2_10;
    $("#btn-mute").textContent = V.Regim2_2 ? "Сирена откл." : "Сирена вкл.";
    $("#btn-mute").classList.toggle("active", !!V.Regim2_2);
    const line = $("#alarm-line");
    line.textContent = statusLine();
    line.className = "alarm-line" + (V.GEmer || S.alarms.some((a) => a.active && a.kind === "bad") ? "" : " ok");
    const bar = $("#gemer-bar"), barText = V.GEmer ? gemerLine() : "";
    if (bar.hidden !== !V.GEmer) bar.hidden = !V.GEmer;
    if (bar.textContent !== barText) bar.textContent = barText;
    $("#route-line").textContent = PS.msg + (V.Load1St0 ? " · загрузка БВ " + (100 + (PS.queueLoad[0] || 0)) : "") + (V.GrStart ? " · гранулирование" : "");
    const n = S.alarms.filter((a) => a.active).length;
    $("#tab-alarm-count").textContent = n ? n : "";
    if ($("#speed").value !== String(S.timeScale)) $("#speed").value = S.timeScale;
    updateProdCard();
  }
  let cardCollapsed = false;
  function updateProdCard() {
    const card = $("#prod-card");
    const p = PS.programs.find((q) => q.status === "работает");
    if (!p && !V.Regim2_9 && !V.Regim2_10 && !V.Load1St0 && !V.GrStart) { if (card.innerHTML) card.innerHTML = ""; return; }
    const rowH = (a, b) => `<div class="pc-row"><span>${esc(a)}</span><span>${esc(b)}</span></div>`;
    let html = `<h4><span>${esc(PS.msg)}</span><button class="pc-toggle" type="button" data-pc>${cardCollapsed ? "▾" : "▴"}</button></h4><div class="pc-body">`;
    if (p) {
      html += rowH("Продукт", p.product) + rowH("Порции", `${p.done} из ${p.portions} готово · выдано ${p.issued}`);
      html += `<div class="pc-bar"><i style="width:${p.portions ? p.done / p.portions * 100 : 0}%"></i></div>`;
    }
    const kj = PS.kJob, dj = PS.dJob;
    if (kj && kj.K[PS.kComp]) html += rowH("Большие весы", `${kj.K[PS.kComp].name}: ${(+V.Ves1).toFixed(1)} кг`);
    if (dj && dj.D[PS.dComp]) html += rowH("Средние весы", `${dj.D[PS.dComp].name}: ${(+V.Ves2).toFixed(2)} кг`);
    if (PS.mixJob) html += rowH("Смеситель", `порция ${PS.mixJob.n}: ${PS.mixJob.stage}`);
    if (V.UnloadTarget) html += rowH("Выгрузка в", "бункер " + (300 + V.UnloadTarget));
    if (V.Load1St0) html += rowH("Загрузка БВ", `бункер ${100 + (PS.queueLoad[0] || 0)} · ${C.pit.prod || ""}`);
    if (V.GrStart) html += rowH("Гранулятор", `${V.TokGran} А · ${V.TempKond} °C · питатель ${Math.round(V.ppPwCurrent || 0)} %`);
    html += "</div>";
    card.innerHTML = html; card.classList.toggle("collapsed", cardCollapsed);
  }
  $("#prod-card").addEventListener("click", (e) => { if (e.target.closest("[data-pc]")) { cardCollapsed = !cardCollapsed; updateProdCard(); } else openProd(); });
  function updateViews() {
    if (tab === "equip") renderEquip();
    if (tab === "alarms") renderAlarms();
    if (tab === "signals") renderSignals();
    if (tab === "prod") renderProd(false);
  }

  $("#btn-start").addEventListener("click", () => { if (!startProd()) switchTab("prod"); });
  $("#pr-start").addEventListener("click", startProd);
  $("#btn-stop").addEventListener("click", () => { CMD.stopProduction(2); toast("Останов производства после текущей порции"); });
  $("#pr-stop2").addEventListener("click", () => { CMD.stopProduction(2); toast("Останов после текущей порции"); });
  $("#pr-stop3").addEventListener("click", () => { CMD.stopProduction(3); toast("Полный стоп производства", true); });
  $("#btn-ack").addEventListener("click", () => { V.Regim2_14 = true; toast("Сброс аварий"); });
  $("#btn-mute").addEventListener("click", () => { V.Regim2_2 = !V.Regim2_2; });
  $("#speed").addEventListener("change", (e) => { S.timeScale = +e.target.value; P.save(); });
  $("#btn-estop").addEventListener("click", () => {
    if (V.GEmer) {
      V.Regim2_13 = false; V.EmerStopShkaf = false;
      ["EmerStopScalp", "EmerStopBunkZ", "EmerStopBunkD", "EmerStopBunkV", "EmerStopExit", "EmerStopUdjk", "EmerStopFire"].forEach((k) => { if (V[k]) toast("Отожмите местный аварийный стоп — окно «Шкаф управления»", true); });
      V.EmerPuskBtn = false; V.Regim2_14 = true;
    } else { V.Regim2_13 = true; toast("Аварийный стоп со SCADA", true); }
  });

  /* ================================================================ холст */
  function tipFor(id) {
    if (id === "@garland-start") return "<b>Гирлянда</b><br>ПУСК — включить";
    if (id === "@garland-stop") return "<b>Гирлянда</b><br>СТОП — выключить";
    const n = S.ND[id];
    if (n.dozer) { const [t] = drvState(id); return `<b>${esc(title(id))}</b><br>${esc(t)}`; }
    if (id === "Pros") return `<b>${esc(title("Pros1"))}</b><br>${esc(drvState("Pros1")[0])} · №2: ${esc(drvState("Pros2")[0])}`;
    if (n.drive && M[n.drive]) return `<b>${esc(title(n.drive))}</b> · поз. ${esc(poz(n.drive))}<br>${esc(drvState(n.drive)[0])}`;
    if (n.kind === "bunker") { const c = C[n.level]; return `<b>${n.num ? "Бункер " + n.num : esc(n.label || id)}</b><br>${esc(c.mass > 0.5 ? c.prod || "" : "пусто")} · ${fmtKg(c.mass)} (${Math.round(c.mass / c.cap * 100)} %)`; }
    if (n.kind === "scale") return `<b>${esc(n.label)}</b><br>${id === "scale1" ? V.Ves1 : V.Ves2} кг`;
    if (id === "pit") return `<b>Завальная яма</b><br>${esc(C.pit.prod || "")} · ${fmtKg(C.pit.mass)}`;
    if (id.startsWith("truck")) { const t = S.trucks[id]; return id === "truck_in" ? `<b>Самосвал с зерном</b><br>${esc(t.material || "")}` : `<b>Автомобиль под ГП</b><br>загружен ${(t.load * 20).toFixed(1)} т`; }
    if (id === "cab") return "<b>Шкафы управления</b><br>кнопки ПУСК, аварийные стопы, режимы";
    if (id === "trash") return `<b>Контейнер отходов</b><br>${fmtKg(C.trash.mass)} · щелчок — вывезти`;
    if (id === "tankOil") return `<b>Ёмкость масла ВЖД4</b><br>${fmtKg(C.tankOil.mass)}`;
    if (id === "compr") return `<b>Компрессор</b><br>${V.LowPress ? "АВАРИЯ — нет давления" : "давление в норме"}`;
    if (id === "boiler") return `<b>Паровой котёл</b><br>клапан пара ${Math.round(+V.SteamValve || 0)} %`;
    return esc(n.label || id);
  }
  function bindCanvas() {
    const cv = $("#plant-canvas"), tip = $("#tooltip");
    let drag = null;
    cv.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY, moved: false }; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener("pointermove", (e) => {
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (drag.moved || Math.hypot(dx, dy) > 5) { drag.moved = true; cv.classList.add("grab"); R.panBy(dx, dy); drag.x = e.clientX; drag.y = e.clientY; tip.style.display = "none"; return; }
      }
      const [wx, wy] = R.toWorld(e.clientX, e.clientY), id = R.hitAt(wx, wy);
      R.setHover(id); cv.classList.toggle("hot", !!id);
      if (!id) { tip.style.display = "none"; return; }
      tip.innerHTML = tipFor(id); tip.style.display = "block";
      tip.style.left = Math.min(window.innerWidth - 330, e.clientX + 14) + "px"; tip.style.top = e.clientY + 14 + "px";
    });
    cv.addEventListener("pointerup", (e) => {
      const was = drag; drag = null; cv.classList.remove("grab");
      if (was && !was.moved) { const [wx, wy] = R.toWorld(e.clientX, e.clientY), id = R.hitAt(wx, wy); if (id === "@garland-start" || id === "@garland-stop") R.garland.run = id === "@garland-start"; else if (id) openNode(id); }
    });
    cv.addEventListener("pointerleave", () => { R.setHover(null); tip.style.display = "none"; });
    cv.addEventListener("wheel", (e) => { e.preventDefault(); R.zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.15 : 1 / 1.15); }, { passive: false });
    const center = (k) => { const r = cv.getBoundingClientRect(); R.zoomAt(r.left + r.width / 2, r.top + r.height / 2, k); };
    $("#zoom-in").addEventListener("click", () => center(1.25));
    $("#zoom-out").addEventListener("click", () => center(1 / 1.25));
    $("#zoom-fit").addEventListener("click", () => R.fit());
    $("#legend-btn").addEventListener("click", () => { const l = $("#legend"); l.hidden = !l.hidden; $("#legend-btn").setAttribute("aria-expanded", String(!l.hidden)); $("#legend-btn").classList.toggle("active", !l.hidden); });
  }

  /* ================================================================ запуск */
  function init() {
    buildRail();
    R.init($("#plant-canvas"));
    bindCanvas();
    S.onAlarm = (a) => { if (a.kind === "bad") toast(a.text, true); };
    let last = performance.now(), acc = 0;
    function frame(t) {
      const dt = (t - last) / 1000; last = t;
      try { P.tick(dt); } catch (e) { console.error(e); }
      R.render(t);
      acc += dt;
      if (acc > 0.25) { acc = 0; updateChrome(); updateRail(); refresh(); updateViews(); }
      requestAnimationFrame(frame);
    }
    updateChrome();
    requestAnimationFrame(frame);
    window.UI = { openNode, openDrive, openLoad, openProd, openGran, openCars, openMixer, openScale, openCabinet, openMenu, closeDlg, switchTab, drvState };
  }
  init();
})();
