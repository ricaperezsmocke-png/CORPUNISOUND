/**
 * rutasSinLogin.test.js — Ninguna ruta de datos del negocio responde sin token.
 *
 * `GET /api/roles` ya se cerró (Tarea 11 del plan antifraude del 2026-09-04),
 * pero `GET /api/permisos-catalogo` publica LA MISMA información: el mapa
 * completo de módulos y permisos del sistema. No saca un peso por sí solo; le
 * dice a quien quiera entrar dónde están todas las puertas.
 *
 * Junto a él quedaron abiertas rutas que sí sueltan datos del negocio: la lista
 * de PROVEEDORES —con quién compra Victor—, categorías y departamentos.
 *
 * Lo que SÍ debe seguir público, y esta prueba lo fija para que nadie lo cierre
 * por error: la salud del servicio (Render la consulta sin token) y el arranque
 * de sesión, incluido el alta del primer usuario cuando no hay ninguno.
 */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

// ANTES de requerir server.js, o la prueba ensucia la base real.
const DB_TEMPORAL = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sinlogin-")), "datos.sqlite");
process.env.DB_PATH = DB_TEMPORAL;
process.env.JWT_SECRET = process.env.JWT_SECRET || "secreto-de-pruebas";

const app = require("./server");
const { sembrarCuentas } = require("./testHelpers");
const { firmarToken } = require("./auth");

const TOKEN_ADMIN = firmarToken({ id: 1, nombre: "Victor", rol_id: 1, sucursal_id: 1 });
const TOKEN_CAJERA = firmarToken({ id: 50, nombre: "Ana López", rol_id: 3, sucursal_id: 1 });

let servidor = null;
let base = "";

before(async () => {
  sembrarCuentas(app, [{ id: 1, rol_id: 1, sucursal_id: 1 }, { id: 50, rol_id: 3, sucursal_id: 1 }]);
  await new Promise((listo) => { servidor = app.listen(0, listo); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(async () => {
  if (servidor) await new Promise((listo) => servidor.close(listo));
});

async function pedir(ruta, token) {
  const r = await fetch(base + ruta, {
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  let cuerpo = null;
  try { cuerpo = await r.json(); } catch { /* respuesta sin cuerpo JSON */ }
  return { status: r.status, cuerpo };
}

const CERRADAS = [
  "/api/permisos-catalogo",
  "/api/categorias",
  "/api/proveedores",
  "/api/departamentos",
  "/api/productos/generar-clave",
];

for (const ruta of CERRADAS) {
  test(`${ruta} no responde sin token`, async () => {
    const { status } = await pedir(ruta);
    assert.equal(status, 401, `${ruta} sigue abierta a internet`);
  });
}

test("el mapa de permisos no se le entrega a quien no administra roles", async () => {
  const { status } = await pedir("/api/permisos-catalogo", TOKEN_CAJERA);
  assert.equal(status, 403, "una cajera con sesión tampoco necesita el mapa completo del sistema");
});

test("quien administra roles sí recibe el catálogo: la pantalla de Roles depende de él", async () => {
  const { status, cuerpo } = await pedir("/api/permisos-catalogo", TOKEN_ADMIN);
  assert.equal(status, 200);
  assert.ok(Array.isArray(cuerpo.permisos) && cuerpo.permisos.length > 0, "trae los permisos");
  assert.ok(Array.isArray(cuerpo.modulos) && cuerpo.modulos.length > 0, "y los módulos");
});

test("los catálogos del negocio se ven con sesión, sin exigir un permiso especial", async () => {
  // Los usan pantallas de varios roles (Gastos, Garantías, Compras, Radar,
  // Reportes). Exigirles un permiso propio rompería a media tienda; lo que se
  // cierra aquí es que se vean SIN sesión.
  for (const ruta of ["/api/categorias", "/api/proveedores", "/api/departamentos"]) {
    const { status } = await pedir(ruta, TOKEN_CAJERA);
    assert.equal(status, 200, `${ruta} tiene que seguir sirviendo a quien ya entró`);
  }
});

test("la salud del servicio sigue pública: Render la consulta sin token", async () => {
  const { status, cuerpo } = await pedir("/api/salud");
  assert.equal(status, 200);
  assert.equal(cuerpo.ok, true);
});

test("el arranque de sesión sigue público, o nadie podría entrar nunca", async () => {
  const { status } = await pedir("/api/auth/necesita-setup");
  assert.equal(status, 200);
});
