/**
 * altaPersonalEscalada.test.js — Nadie da de alta una cuenta ni crea un rol con
 * más poder que el suyo (auditoría de permisos 2026-10, A1).
 *
 * La reproducción H1 mostraba que con solo `dar_alta_personal`, amarrado a una
 * tienda, `POST /api/usuarios` aceptaba `rol_id: 1` (Administrador) y cualquier
 * sucursal; y que `POST /api/roles` no pedía alcance global. Aquí se exige lo
 * contrario, contra las rutas REALES.
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "alta-escalada-")), "datos.sqlite");
process.env.JWT_SECRET = process.env.JWT_SECRET || "secreto-de-pruebas";

const app = require("./server");
const { sembrarCuentas } = require("./testHelpers");
const { firmarToken } = require("./auth");
const { crearRol } = require("./roles");

const DB = app.DB;
let servidor = null, base = "";
let TK_ALTAS = "", TK_ALTAS_ROLES = "", TK_ADMIN = "";
let ROL_PERMITIDO = null, ROL_DE_MAS = null, ROL_CON_ROLES = null;

before(async () => {
  // Quien da de alta: amarrado a Yajalón, con permisos vecinos del módulo.
  const altas = crearRol(DB, { nombre: "Encargado de altas", permisos: ["dar_alta_personal", "cerrar_venta", "cambiar_cliente"], modulos: ["admin", "pos"] });
  const altasRoles = crearRol(DB, {
    nombre: "Encargado de altas y roles", permisos: ["dar_alta_personal", "administrar_roles", "cerrar_venta"], modulos: ["admin", "pos"],
  });
  ROL_PERMITIDO = crearRol(DB, { nombre: "Cajera limitada", permisos: ["cerrar_venta", "cambiar_cliente"], modulos: ["pos"] });
  ROL_DE_MAS = crearRol(DB, { nombre: "Cajera que cancela", permisos: ["cerrar_venta", "cancelar_ventas"], modulos: ["pos"] });
  ROL_CON_ROLES = crearRol(DB, { nombre: "Mini admin", permisos: ["administrar_roles", "cerrar_venta"], modulos: ["admin", "pos"] });
  sembrarCuentas(app, [
    { id: 301, rol_id: altas.id, sucursal_id: 2, nombre: "Encargado Yajalón" },
    { id: 302, rol_id: altasRoles.id, sucursal_id: 2, nombre: "Encargado roles Yajalón" },
    { id: 303, rol_id: 1, sucursal_id: 1, nombre: "Victor" },
  ]);
  TK_ALTAS = firmarToken({ id: 301, nombre: "Encargado Yajalón", rol_id: altas.id, sucursal_id: 2 });
  TK_ALTAS_ROLES = firmarToken({ id: 302, nombre: "Encargado roles Yajalón", rol_id: altasRoles.id, sucursal_id: 2 });
  TK_ADMIN = firmarToken({ id: 303, nombre: "Victor", rol_id: 1, sucursal_id: 1 });
  await new Promise((listo) => { servidor = app.listen(0, listo); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(async () => {
  if (servidor) await new Promise((listo) => servidor.close(listo));
});

let consecutivo = 0;
async function alta(tk, extra = {}) {
  consecutivo += 1;
  const usuario = `nueva${consecutivo}`;
  const r = await fetch(`${base}/api/usuarios`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${tk}` },
    body: JSON.stringify({ nombre: "Cuenta nueva", usuario, password: "secreta1", rol_id: ROL_PERMITIDO.id, sucursal_id: 2, ...extra }),
  });
  return { status: r.status, body: await r.json(), creada: DB.admin.usuarios.find((u) => u.usuario === usuario) };
}

const RECHAZO_ROL = { error: "No puedes dar de alta con ese rol" };

test("amarrado no da de alta un Administrador y no se crea la cuenta (H1 invertida)", async () => {
  const r = await alta(TK_ALTAS, { rol_id: 1 });
  assert.deepStrictEqual([r.status, r.body], [403, RECHAZO_ROL]);
  assert.strictEqual(r.creada, undefined);
});

test("rol_id \"1\" como texto también se rechaza", async () => {
  const r = await alta(TK_ALTAS, { rol_id: "1" });
  assert.deepStrictEqual([r.status, r.body], [403, RECHAZO_ROL]);
  assert.strictEqual(r.creada, undefined);
});

test("un rol con un permiso que el creador no tiene → 403", async () => {
  const r = await alta(TK_ALTAS, { rol_id: ROL_DE_MAS.id });
  assert.deepStrictEqual([r.status, r.body], [403, RECHAZO_ROL]);
  assert.strictEqual(r.creada, undefined);
});

test("un rol con administrar_roles se rechaza aunque el creador lo tenga", async () => {
  const r = await alta(TK_ALTAS_ROLES, { rol_id: ROL_CON_ROLES.id });
  assert.deepStrictEqual([r.status, r.body], [403, RECHAZO_ROL]);
  assert.strictEqual(r.creada, undefined);
});

test("un rol que no existe → 403", async () => {
  const r = await alta(TK_ALTAS, { rol_id: 99999 });
  assert.strictEqual(r.status, 403);
  assert.strictEqual(r.creada, undefined);
});

test("otra sucursal → 403 y no se crea", async () => {
  const r = await alta(TK_ALTAS, { sucursal_id: 1 });
  assert.strictEqual(r.status, 403);
  assert.strictEqual(r.creada, undefined);
  const texto = await alta(TK_ALTAS, { sucursal_id: "1" });
  assert.strictEqual(texto.status, 403);
});

test("un alta válida queda en su sucursal y guarda quién la hizo", async () => {
  const r = await alta(TK_ALTAS, { rol_id: String(ROL_PERMITIDO.id), sucursal_id: "2" });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.creada.rol_id, ROL_PERMITIDO.id);
  assert.strictEqual(r.creada.sucursal_id, 2);
  assert.strictEqual(r.creada.creado_por_id, 301);
  assert.strictEqual(r.creada.creado_por_nombre, "Encargado Yajalón");
  assert.ok(r.creada.creado_en);
});

test("sin sucursal en el cuerpo, el amarrado da de alta en la suya (no en la 1)", async () => {
  const r = await alta(TK_ALTAS, { sucursal_id: undefined });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.creada.sucursal_id, 2);
});

test("con alcance global se da de alta como siempre y guarda quién", async () => {
  const r = await alta(TK_ADMIN, { rol_id: 1, sucursal_id: 3 });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.creada.rol_id, 1);
  assert.strictEqual(r.creada.sucursal_id, 3);
  assert.strictEqual(r.creada.creado_por_id, 303);
});

test("POST /api/roles sin alcance global → 403 y no se crea", async () => {
  const antes = DB.admin.roles.length;
  const r = await fetch(`${base}/api/roles`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TK_ALTAS_ROLES}` },
    body: JSON.stringify({ nombre: "Todo poderoso", permisos: ["ver_todas_las_sucursales", "administrar_roles"], modulos: ["admin"] }),
  });
  assert.strictEqual(r.status, 403);
  assert.strictEqual(DB.admin.roles.length, antes);
});
