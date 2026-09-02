const { test, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cajas-ruta-")), "datos.sqlite");
process.env.JWT_SECRET = process.env.JWT_SECRET || "secreto-de-pruebas";

const app = require("./server");
const { sembrarCuentas } = require("./testHelpers");
const { firmarToken } = require("./auth");

const CAJERA_OCOSINGO = firmarToken({
  id: 71,
  nombre: "Cajera Ocosingo",
  rol_id: 3,
  sucursal_id: 1,
});

let servidor = null;
let base = "";

before(async () => {
  sembrarCuentas(app, [{ id: 71, rol_id: 3, sucursal_id: 1 }]);
  await new Promise((listo) => { servidor = app.listen(0, listo); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(async () => {
  if (servidor) await new Promise((listo) => servidor.close(listo));
});

test("una cajera amarrada a una sucursal no recibe cajas de otra", async () => {
  const respuesta = await fetch(`${base}/api/cajas?sucursal_id=2`, {
    headers: { Authorization: `Bearer ${CAJERA_OCOSINGO}` },
  });
  const cajas = await respuesta.json();

  assert.strictEqual(respuesta.status, 200);
  assert.strictEqual(cajas.length, 2);
  assert.ok(cajas.every((caja) => caja.sucursal_id === 1));
  assert.deepStrictEqual(cajas.map((caja) => caja.nombre).sort(), ["Administrativa", "Fiscal"]);
});
