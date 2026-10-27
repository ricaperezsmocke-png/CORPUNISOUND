/**
 * Revision independiente de fix/huecos-graves-2026-10 — intentos SICAR.
 * Misma convencion que huecos.revision.js: "DEFECTO" pasa mientras el defecto
 * existe; "CONTROL" pasa si el arreglo se porta bien.
 *
 * Correr desde backend/ (proceso aparte: usa base en memoria):
 *   node --test ../docs/revisiones/2026-10-27-huecos-graves/sicar.revision.js
 */

import { createRequire } from "node:module";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const BACKEND = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "backend");
process.env.DB_PATH = ":memory:";
process.env.SENTRY_ENABLED = "false";
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "revision-sicar-desechable";

const app = require(path.join(BACKEND, "server"));
const { obtenerConexionSqlite } = require(path.join(BACKEND, "persistencia"));
const { crearRepositorioSicar } = require(path.join(BACKEND, "sicarRepositorio"));
const { firmarToken } = require(path.join(BACKEND, "auth"));
const Database = require(path.join(BACKEND, "node_modules", "better-sqlite3"));

const sqlite = obtenerConexionSqlite();
let servidor, base, admin;

before(async () => {
  app.DB.admin.roles.push({ id: 991, nombre: "Revision", permisos: ["administrar_llaves_sicar", "ver_sincronizacion_sicar",
    "ver_todas_las_sucursales"], modulos: ["sicar"] });
  app.DB.admin.usuarios.push({ id: 991, nombre: "Revision", usuario: "revision991", rol_id: 991, sucursal_id: 1, activo: true });
  admin = firmarToken({ id: 991, rol_id: 991, sucursal_id: 1 });
  await new Promise((resolve) => { servidor = app.listen(0, "127.0.0.1", resolve); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(async () => {
  servidor?.closeAllConnections();
  if (servidor) await new Promise((resolve) => servidor.close(resolve));
  sqlite.close();
});

async function enviarLote(authorization) {
  const res = await fetch(`${base}/api/integraciones/sicar/v1/lotes`, {
    method: "POST", headers: { "Content-Type": "application/json", ...(authorization ? { Authorization: authorization } : {}) },
    body: "{}",
  });
  return { status: res.status, json: await res.json().catch(() => null), retry: res.headers.get("retry-after") };
}

test("DEFECTO S1: con el key_id de una tienda y un secreto falso, un desconocido empuja fuera su historial real", async () => {
  const r = await fetch(`${base}/api/sicar/llaves`, { method: "POST",
    headers: { Authorization: `Bearer ${admin}`, "Content-Type": "application/json" }, body: JSON.stringify({ sucursal_id: 2 }) });
  assert.equal(r.status, 201);
  const { key_id } = await r.json();
  // 5,000 intentos "reales" del agente de Yajalon (los que sirven para diagnosticarlo).
  const insertar = sqlite.prepare(`INSERT INTO sicar_intentos (sucursal_id, key_id, batch_id, recibidos, aceptados, rechazados,
    bytes, codigo, hora, duracion_ms) VALUES (2, ?, NULL, 10, 10, 0, 100, '200', ?, 5)`);
  sqlite.transaction(() => { for (let i = 0; i < 5000; i++) insertar.run(key_id, new Date().toISOString()); })();
  const primeroReal = sqlite.prepare("SELECT min(id) id FROM sicar_intentos WHERE sucursal_id = 2").get().id;
  const falso = await enviarLote(`Bearer ${key_id}.${"0".repeat(64)}`);
  assert.equal(falso.status, 401);
  const quedan = sqlite.prepare("SELECT count(*) n, min(id) minimo FROM sicar_intentos WHERE sucursal_id = 2").get();
  const ultimo = sqlite.prepare("SELECT codigo FROM sicar_intentos WHERE sucursal_id = 2 ORDER BY id DESC LIMIT 1").get();
  assert.equal(quedan.n, 5000);
  assert.equal(ultimo.codigo, "401", "el intento falso quedo a nombre de Yajalon");
  assert.ok(quedan.minimo > primeroReal, "y el intento real mas viejo de Yajalon se borro para hacerle lugar");
});

test("CONTROL S2: contrato — 401 anonimo y 429 responden igual que antes, sin fila", async () => {
  const antes = sqlite.prepare("SELECT count(*) n FROM sicar_intentos").get().n;
  const codigos = [];
  let ultimo429 = null;
  for (let i = 0; i < 20; i++) {
    const r = await enviarLote(null);
    codigos.push(r.status);
    if (r.status === 401) assert.deepEqual(r.json, { codigo: "LLAVE_INVALIDA", error: "Solicitud SICAR rechazada." });
    if (r.status === 429) ultimo429 = r;
  }
  assert.ok(ultimo429, "el freno responde 429");
  assert.deepEqual(ultimo429.json, { codigo: "RITMO_EXCEDIDO", error: "Solicitud SICAR rechazada." });
  assert.equal(ultimo429.retry, "60");
  assert.equal(sqlite.prepare("SELECT count(*) n FROM sicar_intentos").get().n, antes);
});

test("CONTROL S3: una base existente sin el indice nuevo arranca, lo crea, y la retencion no toca nada reciente ni otras tablas", () => {
  const db = new Database(":memory:");
  crearRepositorioSicar(db);
  db.exec("DROP INDEX sicar_intentos_sucursal"); // asi estaba la base antes de esta rama
  db.prepare("INSERT INTO sicar_tiendas(sucursal_id) VALUES (1)").run();
  const dia = 24 * 60 * 60 * 1000;
  const ins = db.prepare(`INSERT INTO sicar_intentos (sucursal_id, key_id, batch_id, recibidos, aceptados, rechazados, bytes,
    codigo, hora, duracion_ms) VALUES (1, NULL, NULL, NULL, NULL, NULL, 0, '200', ?, 1)`);
  ins.run(new Date(Date.now() - 31 * dia).toISOString());
  ins.run(new Date(Date.now() - 29 * dia).toISOString());
  ins.run(new Date().toISOString());
  const tablasAntes = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
  assert.doesNotThrow(() => crearRepositorioSicar(db));
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='sicar_intentos_sucursal'").get());
  assert.equal(db.prepare("SELECT count(*) n FROM sicar_intentos").get().n, 2);
  assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all(), tablasAntes);
  db.close();
});
