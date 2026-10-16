const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

// Render reinicia el servidor en cada despliegue: los interruptores tienen que sobrevivirlo.
// Cada fase corre en un proceso nuevo, igual que un arranque real, sobre la misma base.
function fase(dbPath, codigo) {
  const r = spawnSync(process.execPath, ["--preserve-symlinks", "--preserve-symlinks-main", "-e", codigo], {
    cwd: __dirname, encoding: "utf8", timeout: 60000,
    env: { ...process.env, DB_PATH: dbPath, JWT_SECRET: "secreto-de-pruebas", NODE_ENV: "test" },
  });
  const linea = (r.stdout || "").split("\n").find((l) => l.startsWith("RESULTADO "));
  assert.ok(linea, `la fase no imprimió resultado: ${r.stderr}`);
  return JSON.parse(linea.slice("RESULTADO ".length));
}

test("un interruptor apagado y su historial siguen así después de reiniciar el servidor", () => {
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pantallas-reinicio-")), "datos.sqlite");
  const antes = fase(dbPath, `
    const app = require("./server");
    const { guardar } = require("./persistencia");
    const { cambiarPantalla } = require("./pantallasCaja");
    cambiarPantalla(app.DB, { pantalla: "punto_venta", activa: false }, { id: 7, nombre: "Victor" });
    guardar(app.DB);
    console.log("RESULTADO " + JSON.stringify(app.DB.pos.pantallas_caja));
    process.exit(0);`);
  assert.equal(antes.estado.punto_venta, false);
  const despues = fase(dbPath, `
    const app = require("./server");
    const { estaActiva, estadoPantallas } = require("./pantallasCaja");
    console.log("RESULTADO " + JSON.stringify({ activa: estaActiva(app.DB, "punto_venta"), historial: estadoPantallas(app.DB).historial }));
    process.exit(0);`);
  assert.equal(despues.activa, false, "tras reiniciar, Punto de Venta sigue apagado");
  assert.equal(despues.historial.length, 1);
  assert.equal(despues.historial[0].usuario_nombre, "Victor");
});
