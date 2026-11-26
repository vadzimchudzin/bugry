// Загрузка модулей эмулятора в Node без браузера (порядок — как в index.html).
"use strict";
const path = require("path");
module.exports = function loadSim() {
  const dir = path.join(__dirname, "..", "frontend", "js");
  for (const f of ["plc-lib.js", "plc-prod.js", "plc.js", "plant.js", "plant-flow.js", "db.js"]) {
    const p = path.join(dir, f);
    delete require.cache[p];
  }
  ["PLCLIB", "PLCPROD", "PLC", "PLANT_CORE", "PLANT", "DB"].forEach((k) => { delete globalThis[k]; });
  require(path.join(dir, "plc-lib.js"));
  require(path.join(dir, "plc-prod.js"));
  require(path.join(dir, "plc.js"));
  require(path.join(dir, "plant.js"));
  require(path.join(dir, "plant-flow.js"));
  try { require(path.join(dir, "db.js")); } catch (e) { if (e.code !== "MODULE_NOT_FOUND") throw e; }
  return globalThis.PLANT;
};
