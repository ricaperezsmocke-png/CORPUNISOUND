/**
 * condicionesPagoAlcance.test.js — El descuento por forma de pago es de CADA
 * tienda, y solo su gente lo puede ver y tocar.
 *
 * Esta ruta era la única de todo el sistema que resolvía el alcance desde
 * `?sucursal_id=` en vez del token. Y `src/api.js` inyecta ese parámetro desde
 * localStorage en TODAS las llamadas, así que ese valor ERA la autorización:
 * bastaba cambiar el número en la barra de direcciones.
 *
 * Lo que permitía, verificado antes del arreglo: el gerente de Ocosingo le
 * ponía 99% de descuento en efectivo a Yajalón — cada venta de esa tienda se
 * cobraba al 1%.
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

// ⚠️ ANTES de requerir server.js, o la prueba ensucia la base real.
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "condpago-")), "datos.sqlite");
process.env.JWT_SECRET = process.env.JWT_SECRET || "secreto-de-pruebas";

const app = require("./server");
const { sembrarCuentas } = require("./testHelpers");
const { firmarToken } = require("./auth");

// Rol 2 = "Gerente de sucursal": tiene editar_configuracion_pos pero NO
// ver_todas_las_sucursales. Rol 3 = "Cajero". Rol 1 = Administrador.
const GERENTE_OCOSINGO = firmarToken({ id: 60, nombre: "Gerente Ocosingo", rol_id: 2, sucursal_id: 1 });
const CAJERA_OCOSINGO = firmarToken({ id: 61, nombre: "Cajera", rol_id: 3, sucursal_id: 1 });
const ADMIN = firmarToken({ id: 1, nombre: "Victor", rol_id: 1, sucursal_id: 1 });

let servidor = null;
let base = "";

before(async () => {
  // Cuentas REALES que respaldan los tokens firmados arriba: desde que la
  // sesión comprueba que la cuenta siga activa, un token de un usuario
  // inexistente ya no sirve (ver auth.js).
  sembrarCuentas(app, [{ id: 1, rol_id: 1, sucursal_id: 1 }, { id: 60, rol_id: 2, sucursal_id: 1 }, { id: 61, rol_id: 3, sucursal_id: 1 }]);
  await new Promise((listo) => { servidor = app.listen(0, listo); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(async () => { if (servidor) await new Promise((listo) => servidor.close(listo)); });

async function pedir(ruta, opciones = {}) {
  const r = await fetch(base + ruta, {
    ...opciones,
    headers: { "Content-Type": "application/json", ...(opciones.headers || {}) },
  });
  let cuerpo = null;
  try { cuerpo = await r.json(); } catch (_) {}
  return { status: r.status, cuerpo };
}

const comoGerente = { Authorization: `Bearer ${GERENTE_OCOSINGO}` };
const comoCajera = { Authorization: `Bearer ${CAJERA_OCOSINGO}` };
const comoAdmin = { Authorization: `Bearer ${ADMIN}` };

test("preparación: existen condiciones sembradas en las dos sucursales", async () => {
  // El administrador las siembra al consultarlas (asegurarSeed).
  const s1 = await pedir("/api/condiciones-pago?sucursal_id=1", { headers: comoAdmin });
  const s2 = await pedir("/api/condiciones-pago?sucursal_id=2", { headers: comoAdmin });
  assert.strictEqual(s1.status, 200);
  assert.ok(s1.cuerpo.length > 0, "sucursal 1 sembrada");
  assert.ok(s2.cuerpo.length > 0, "sucursal 2 sembrada");
  assert.ok(s1.cuerpo.every((c) => c.sucursal_id === 1));
  assert.ok(s2.cuerpo.every((c) => c.sucursal_id === 2));
});

// ---------- Leer ----------

test("pedir ?sucursal_id= de otra tienda NO devuelve la de esa tienda", async () => {
  for (const intento of ["?sucursal_id=2", "?sucursal_id=4", "?sucursal_id=todas", ""]) {
    const r = await pedir(`/api/condiciones-pago${intento}`, { headers: comoGerente });
    assert.strictEqual(r.status, 200, intento);
    assert.ok(
      r.cuerpo.every((c) => Number(c.sucursal_id) === 1),
      `con "${intento}" se coló una condición de otra sucursal`,
    );
    assert.ok(r.cuerpo.length > 0, `con "${intento}" debería ver las suyas`);
  }
});

test("una cajera tampoco puede espiar los descuentos de otra tienda", async () => {
  const r = await pedir("/api/condiciones-pago?sucursal_id=2", { headers: comoCajera });
  assert.strictEqual(r.status, 200);
  assert.ok(r.cuerpo.every((c) => Number(c.sucursal_id) === 1));
});

test("el administrador SÍ puede consultar la de otra tienda", async () => {
  // El query solo ESTRECHA, y solo para quien ya puede ver todas.
  const r = await pedir("/api/condiciones-pago?sucursal_id=2", { headers: comoAdmin });
  assert.strictEqual(r.status, 200);
  assert.ok(r.cuerpo.length > 0);
  assert.ok(r.cuerpo.every((c) => Number(c.sucursal_id) === 2));
});

test("sin sucursal elegida NO se inventa la 1: se devuelve vacío", async () => {
  // El `else 1` de antes le enseñaba Ocosingo a cualquiera que mandara basura.
  const r = await pedir("/api/condiciones-pago?sucursal_id=todas", { headers: comoAdmin });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.cuerpo, [], "debe fallar cerrado, no caer a la sucursal 1");
});

// ---------- Escribir ----------

test("un gerente NO puede cambiar el descuento de otra sucursal", async () => {
  // Es el ataque completo: cada venta de esa tienda se cobraría al 1%.
  const deYajalon = (await pedir("/api/condiciones-pago?sucursal_id=2", { headers: comoAdmin })).cuerpo;
  const efectivo = deYajalon.find((c) => c.nombre === "EFECTIVO");
  assert.ok(efectivo, "hace falta el registro de Yajalón para la prueba");
  const antes = efectivo.descuento_pct;

  const r = await pedir(`/api/condiciones-pago/${efectivo.id}?sucursal_id=2`, {
    method: "PUT", headers: comoGerente,
    body: JSON.stringify({ descuento_pct: 99, activo: true }),
  });
  assert.notStrictEqual(r.status, 200, "debe rechazarse");
  // Mismo mensaje que "no existe": no se confirma que el registro ajeno exista.
  assert.match(r.cuerpo.error, /no encontrada/i);

  const despues = (await pedir("/api/condiciones-pago?sucursal_id=2", { headers: comoAdmin }))
    .cuerpo.find((c) => c.id === efectivo.id);
  assert.strictEqual(despues.descuento_pct, antes, "el descuento ajeno NO debió moverse");
});

test("un gerente SÍ puede cambiar el descuento de la suya", async () => {
  const mias = (await pedir("/api/condiciones-pago", { headers: comoGerente })).cuerpo;
  const efectivo = mias.find((c) => c.nombre === "EFECTIVO");

  const r = await pedir(`/api/condiciones-pago/${efectivo.id}`, {
    method: "PUT", headers: comoGerente,
    body: JSON.stringify({ descuento_pct: 8 }),
  });
  assert.strictEqual(r.status, 200, JSON.stringify(r.cuerpo));
  assert.strictEqual(r.cuerpo.descuento_pct, 8);
  assert.strictEqual(r.cuerpo.sucursal_id, 1, "y sigue siendo la suya");
});

test("tampoco se puede desactivar una forma de pago de otra tienda", async () => {
  // Desactivar EFECTIVO en una tienda ajena le impide cobrar en efectivo.
  const deYajalon = (await pedir("/api/condiciones-pago?sucursal_id=2", { headers: comoAdmin })).cuerpo;
  const tarjeta = deYajalon.find((c) => c.nombre === "TARJETA");

  const r = await pedir(`/api/condiciones-pago/${tarjeta.id}`, {
    method: "PUT", headers: comoGerente, body: JSON.stringify({ activo: false }),
  });
  assert.notStrictEqual(r.status, 200);

  const despues = (await pedir("/api/condiciones-pago?sucursal_id=2", { headers: comoAdmin }))
    .cuerpo.find((c) => c.id === tarjeta.id);
  assert.strictEqual(despues.activo, true, "debe seguir activa");
});

test("una cajera no puede tocar ni las de su propia tienda", async () => {
  // Le falta `editar_configuracion_pos`; el permiso sigue mandando.
  const mias = (await pedir("/api/condiciones-pago", { headers: comoCajera })).cuerpo;
  const r = await pedir(`/api/condiciones-pago/${mias[0].id}`, {
    method: "PUT", headers: comoCajera, body: JSON.stringify({ descuento_pct: 50 }),
  });
  assert.strictEqual(r.status, 403);
});
