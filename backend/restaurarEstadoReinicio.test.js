const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

// Render reinicia el servidor en cada despliegue: lo que el código crea sobre la marcha, fuera de la
// semilla, tiene que sobrevivirlo. Cada fase corre en un proceso nuevo sobre la misma base.
function fase(dbPath, codigo) {
  const r = spawnSync(process.execPath, ["--preserve-symlinks", "--preserve-symlinks-main", "-e", codigo], {
    cwd: __dirname, encoding: "utf8", timeout: 60000,
    env: { ...process.env, DB_PATH: dbPath, JWT_SECRET: "secreto-de-pruebas", NODE_ENV: "test" },
  });
  const linea = (r.stdout || "").split("\n").find((l) => l.startsWith("RESULTADO "));
  assert.ok(linea, `la fase no imprimió resultado: ${r.stderr}`);
  return JSON.parse(linea.slice("RESULTADO ".length));
}

const LEER = `
  const app = require("./server");
  const { guardar } = require("./persistencia");
  guardar(app.DB);
  console.log("RESULTADO " + JSON.stringify({
    pedidos: app.DB.radar_demanda.pedidos_marcados,
    historial: app.DB.pos.historial_ventas_mensual,
    carpeta: app.DB.drive.carpeta_raiz_id,
  }));
  process.exit(0);`;

test("pedidos marcados, historial mensual y carpeta de Drive siguen después de dos reinicios", () => {
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "restaurar-reinicio-")), "datos.sqlite");
  fase(dbPath, `
    const app = require("./server");
    const { guardar } = require("./persistencia");
    app.DB.radar_demanda.pedidos_marcados = [{ id: 1, producto: "Cuerdas" }];
    app.DB.pos.historial_ventas_mensual = [{ mes: "2026-01", total: 5000 }];
    app.DB.drive.carpeta_raiz_id = "carpeta-123";
    guardar(app.DB);
    console.log("RESULTADO {}");
    process.exit(0);`);
  for (const vuelta of [1, 2]) {
    const r = fase(dbPath, LEER);
    assert.deepEqual(r.pedidos, [{ id: 1, producto: "Cuerdas" }], `pedidos marcados, reinicio ${vuelta}`);
    assert.deepEqual(r.historial, [{ mes: "2026-01", total: 5000 }], `historial mensual, reinicio ${vuelta}`);
    assert.equal(r.carpeta, "carpeta-123", `carpeta de Drive, reinicio ${vuelta}`);
  }
});
