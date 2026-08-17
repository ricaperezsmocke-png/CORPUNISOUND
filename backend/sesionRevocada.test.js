/**
 * sesionRevocada.test.js — Desactivar a alguien lo SACA del sistema.
 *
 * Comprobado en la auditoría contra el servidor real: se creaba una cajera, se
 * desactivaba como si la despidieran, y su sesión anterior seguía abriendo
 * productos, ventas y clientes. Los tres respondían 200. El token dura 12 h.
 *
 * O sea: se corría a alguien enojado a las 9 de la mañana y hasta las 9 de la
 * noche podía seguir entrando desde su casa, cancelando ventas o bajándose la
 * lista de clientes.
 *
 * `requiereLogin` solo verificaba la FIRMA del token; nunca preguntaba si la
 * cuenta seguía existiendo. Ahora consulta el estado vivo en cada petición.
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

// ⚠️ ANTES de requerir server.js, o la prueba ensucia la base real.
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "revocada-")), "datos.sqlite");
process.env.JWT_SECRET = process.env.JWT_SECRET || "secreto-de-pruebas";

const app = require("./server");
const { sembrarCuentas } = require("./testHelpers");
const { firmarToken } = require("./auth");

const ADMIN = firmarToken({ id: 1, nombre: "Victor", rol_id: 1, sucursal_id: 1 });
const CAJERA = firmarToken({ id: 70, nombre: "Cajera", rol_id: 3, sucursal_id: 1 });
const FANTASMA = firmarToken({ id: 999, nombre: "Ya No Existe", rol_id: 3, sucursal_id: 1 });

let servidor = null;
let base = "";

before(async () => {
  sembrarCuentas(app, [
    { id: 1, rol_id: 1, sucursal_id: 1 },
    { id: 70, rol_id: 3, sucursal_id: 1 },
  ]);
  await new Promise((listo) => { servidor = app.listen(0, listo); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(async () => { if (servidor) await new Promise((listo) => servidor.close(listo)); });

async function pedir(ruta, token) {
  const r = await fetch(base + ruta, {
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  });
  let cuerpo = null;
  try { cuerpo = await r.json(); } catch (_) {}
  return { status: r.status, cuerpo };
}

const cuentaDe = (id) => app.DB.admin.usuarios.find((u) => u.id === id);

test("con la cuenta activa, la sesión funciona", async () => {
  for (const ruta of ["/api/productos", "/api/ventas", "/api/clientes"]) {
    assert.strictEqual((await pedir(ruta, CAJERA)).status, 200, ruta);
  }
});

test("al DESACTIVAR la cuenta, la sesión abierta deja de servir de inmediato", async () => {
  cuentaDe(70).activo = false;
  try {
    for (const ruta of ["/api/productos", "/api/ventas", "/api/clientes"]) {
      const r = await pedir(ruta, CAJERA);
      assert.strictEqual(r.status, 401, `${ruta} debió cerrarse`);
      // El mensaje tiene que decirle a la persona qué hacer, no dejarla
      // adivinando si es su internet.
      assert.match(r.cuerpo.error, /cuenta|activa/i);
    }
  } finally {
    cuentaDe(70).activo = true;
  }
});

test("reactivarla devuelve el acceso, sin tener que volver a entrar", async () => {
  cuentaDe(70).activo = false;
  assert.strictEqual((await pedir("/api/productos", CAJERA)).status, 401);
  cuentaDe(70).activo = true;
  assert.strictEqual((await pedir("/api/productos", CAJERA)).status, 200);
});

test("el token de una cuenta BORRADA tampoco sirve", async () => {
  // `eliminarUsuario` borra el renglón sin más; el token seguía vivo 12 h.
  assert.strictEqual((await pedir("/api/productos", FANTASMA)).status, 401);
});

test("cambiarle el rol a alguien surte efecto en la siguiente petición", async () => {
  // El token lleva el `rol_id` congelado, así que quitarle un permiso a un rol
  // no tenía efecto hasta que la persona volviera a entrar. Y como los ids de
  // rol se reciclan, podía despertar con los permisos de OTRO rol.
  const sinPermiso = await pedir("/api/usuarios", CAJERA);
  assert.strictEqual(sinPermiso.status, 403, "una cajera no administra personal");

  cuentaDe(70).rol_id = 1; // ascendida a Administrador
  try {
    const conPermiso = await pedir("/api/usuarios", CAJERA);
    assert.strictEqual(conPermiso.status, 200, "el rol nuevo debe aplicar ya");
  } finally {
    cuentaDe(70).rol_id = 3;
  }

  assert.strictEqual((await pedir("/api/usuarios", CAJERA)).status, 403, "y degradarla también");
});

test("la sucursal del token NO se pisa con la de la base", async () => {
  // Se refresca solo el rol. La sucursal del token ya viene del registro del
  // usuario (el login firma el registro completo), así que sobrescribirla no
  // aportaría nada y sí podría romper el alcance por sorpresa.
  cuentaDe(70).sucursal_id = 4;
  try {
    const r = await pedir("/api/ventas", CAJERA);
    assert.strictEqual(r.status, 200);
    assert.ok(
      r.cuerpo.every((v) => Number(v.sucursal_id) === 1),
      "debe seguir viendo la sucursal de su token, no la 4",
    );
  } finally {
    cuentaDe(70).sucursal_id = 1;
  }
});

test("el administrador no se ve afectado mientras su cuenta esté sana", async () => {
  assert.strictEqual((await pedir("/api/usuarios", ADMIN)).status, 200);
});
