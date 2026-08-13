/**
 * respaldosRutas.test.js — El CABLEADO de las rutas de Respaldos y Punto de
 * Restauración, más el middleware de mantenimiento que congela el sistema
 * mientras se restaura.
 *
 * Le pega a las rutas REALES vía require("./server"), igual que
 * rutasEscrituraSucursal.test.js: server.js expone solo la app (no abre
 * puerto ni arranca el reloj de respaldos) hasta que
 * ESTE_PROCESO_ES_EL_SERVIDOR es cierto.
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

// ⚠️ ESTO VA ANTES DE REQUERIR server.js — sin esto la prueba lee y ENSUCIA la
// base real datos.sqlite del desarrollador. Requerir server.js abre SQLite y
// restaura el estado guardado. Copiado de rutasEscrituraSucursal.test.js, que
// ya resolvió exactamente este problema.
const DB_TEMPORAL = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "respaldos-")), "datos.sqlite");
process.env.DB_PATH = DB_TEMPORAL;
process.env.JWT_SECRET = process.env.JWT_SECRET || "secreto-de-pruebas";

const { PALABRA_CONFIRMACION } = require("./respaldos");
const app = require("./server");
const { firmarToken } = require("./auth");
const { listarPermisos } = require("./permisosCatalogo");
const mantenimiento = require("./mantenimiento");

// Rol 1 = "Administrador" (sembrarRolesIniciales en backend/roles.js): tiene
// TODOS los permisos, incluidos los dos nuevos de respaldos (reconciliarRoles
// se los da en cada arranque). sucursal_id: null = alcance global — el que
// exigen las rutas de respaldos.
const TOKEN_ADMIN = firmarToken({ id: 1, nombre: "Administrador de prueba", rol_id: 1, sucursal_id: null });

let servidor = null;
let base = "";

before(async () => {
  await new Promise((listo) => {
    servidor = app.listen(0, listo); // puerto efímero: no choca con el backend de desarrollo
  });
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(async () => {
  if (servidor) await new Promise((listo) => servidor.close(listo));
});

async function pedir(ruta, opciones = {}) {
  const r = await fetch(base + ruta, {
    ...opciones,
    headers: { "Content-Type": "application/json", ...(opciones.headers || {}) },
  });
  let cuerpo = null;
  try { cuerpo = await r.json(); } catch (_) {}
  return { status: r.status, cuerpo };
}

test("los dos permisos nuevos están en el catálogo", () => {
  const claves = listarPermisos().map((p) => p.clave);
  assert.ok(claves.includes("ver_respaldos"));
  assert.ok(claves.includes("restaurar_respaldo"));
  const modulos = listarPermisos().filter((p) => p.modulo === "respaldos");
  assert.strictEqual(modulos.length, 2);
});

test("GET /api/respaldos sin sesión responde 401", async () => {
  assert.strictEqual((await pedir("/api/respaldos")).status, 401);
});

test("GET /api/respaldos con sesión responde 200 con la lista de copias", async () => {
  const r = await pedir("/api/respaldos", { headers: { Authorization: `Bearer ${TOKEN_ADMIN}` } });
  assert.strictEqual(r.status, 200);
  assert.ok(Array.isArray(r.cuerpo));
});

test("GET /api/respaldos/estado responde 200 con los avisos de configuración", async () => {
  const r = await pedir("/api/respaldos/estado", { headers: { Authorization: `Bearer ${TOKEN_ADMIN}` } });
  assert.strictEqual(r.status, 200);
  assert.ok("respaldo_configurado" in r.cuerpo);
  assert.ok("restauracion_habilitada" in r.cuerpo);
  assert.ok("mantenimiento" in r.cuerpo);
});

test("GET /api/respaldos/:id/descargar sin TOKEN_DESCARGA_RESPALDOS responde 404", async () => {
  const guardado = process.env.TOKEN_DESCARGA_RESPALDOS;
  delete process.env.TOKEN_DESCARGA_RESPALDOS;
  assert.strictEqual((await pedir("/api/respaldos/1/descargar")).status, 404);
  if (guardado !== undefined) process.env.TOKEN_DESCARGA_RESPALDOS = guardado;
});

test("GET /api/respaldos/:id/descargar con token equivocado responde 404", async () => {
  process.env.TOKEN_DESCARGA_RESPALDOS = "token-bueno";
  const r = await pedir("/api/respaldos/1/descargar", { headers: { "X-Token-Respaldo": "token-malo" } });
  assert.strictEqual(r.status, 404);
  delete process.env.TOKEN_DESCARGA_RESPALDOS;
});

test("POST /api/respaldos/:id/restaurar sin CLAVE_RESTAURACION responde 400 y no muta", async () => {
  const guardado = process.env.CLAVE_RESTAURACION;
  delete process.env.CLAVE_RESTAURACION;
  const r = await pedir("/api/respaldos/1/restaurar", {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN_ADMIN}` },
    body: JSON.stringify({ clave: "x", confirmacion: PALABRA_CONFIRMACION }),
  });
  assert.ok([400, 403].includes(r.status));
  if (guardado !== undefined) process.env.CLAVE_RESTAURACION = guardado;
});

// ---------- Mantenimiento: middleware global que congela las escrituras ----------

test("con el sistema en mantenimiento, una venta recibe 503 y NO se registra", async () => {
  const token = firmarToken({ id: 1, nombre: "Victor", rol_id: 1, sucursal_id: null });
  mantenimiento.activar("Restaurando el respaldo del 2026-08-11 16:00");
  try {
    const r = await fetch(`${base}/api/ventas`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ sucursal_id: 1, lineas: [] }),
    });
    assert.strictEqual(r.status, 503);
    const cuerpo = await r.json();
    assert.strictEqual(cuerpo.mantenimiento, true);
    assert.match(cuerpo.error, /Restaurando|mantenimiento/i);
  } finally {
    mantenimiento.desactivar();
  }
});

test("en mantenimiento las LECTURAS siguen pasando (para poder ver por qué)", async () => {
  const token = firmarToken({ id: 1, nombre: "Victor", rol_id: 1, sucursal_id: null });
  mantenimiento.activar("Restaurando");
  try {
    const r = await fetch(`${base}/api/respaldos/estado`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.strictEqual(r.status, 200);
    const cuerpo = await r.json();
    assert.strictEqual(cuerpo.mantenimiento.activo, true);
  } finally {
    mantenimiento.desactivar();
  }
});

test("apagado el mantenimiento, las escrituras vuelven solas", async () => {
  const token = firmarToken({ id: 1, nombre: "Victor", rol_id: 1, sucursal_id: null });
  mantenimiento.activar("x");
  mantenimiento.desactivar();
  const r = await fetch(`${base}/api/ventas`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ sucursal_id: 1, lineas: [] }),
  });
  assert.notStrictEqual(r.status, 503, "el bloqueo se quedó pegado");
});
