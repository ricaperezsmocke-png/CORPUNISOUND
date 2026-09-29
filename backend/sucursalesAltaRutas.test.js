const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const BASE = path.join(os.tmpdir(), `corpunisound-alta-${process.pid}-${Date.now()}.sqlite`);
process.env.DB_PATH = BASE;
process.env.JWT_SECRET = process.env.JWT_SECRET || "secreto-solo-para-pruebas";
const app = require("./server");
const { sembrarCuentas } = require("./testHelpers");
const { firmarToken } = require("./auth");
const { cargar } = require("./persistencia");
const cuentas = [
  { id: 801, nombre: "Administrador prueba", rol_id: 1, sucursal_id: 1 },
  { id: 802, rol_id: 802, sucursal_id: 1 },
  { id: 803, rol_id: 803, sucursal_id: 1 },
];
const [admin, vecino, local] = cuentas.map(firmarToken);
const datos = { nombre: "Innotec", ciudad: "Ocosingo", lat: "16.9", lng: "-92.1" };
let servidor;
let base;
let sucursales;
let cajas;
before(async () => {
  sembrarCuentas(app, cuentas);
  app.DB.admin.roles.push(
    { id: 802, nombre: "Vecino", permisos: ["administrar_roles", "ver_todas_las_sucursales"], modulos: ["admin"] },
    { id: 803, nombre: "Local", permisos: ["administrar_roles", "administrar_sucursales"], modulos: ["admin"] },
  );
  sucursales = structuredClone(app.DB.pos.sucursales);
  cajas = structuredClone(app.DB.pos.cajas);
  await new Promise((resolve) => { servidor = app.listen(0, resolve); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});
beforeEach(() => {
  app.DB.pos.sucursales = structuredClone(sucursales);
  app.DB.pos.cajas = structuredClone(cajas);
});
after(async () => {
  if (servidor) await new Promise((resolve) => servidor.close(resolve));
  try { fs.unlinkSync(BASE); } catch { /* Base temporal abierta en Windows. */ }
});
async function crear(token, cuerpo = datos) {
  const respuesta = await fetch(`${base}/api/sucursales`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(cuerpo),
  });
  const texto = await respuesta.text();
  return { status: respuesta.status, datos: texto.startsWith("{") ? JSON.parse(texto) : texto };
}
for (const [nombre, token, status] of [["sin login", null, 401], ["permiso vecino", vecino, 403], ["sin alcance", local, 403]]) {
  test(`POST rechaza ${nombre} sin mutar`, async () => {
    const antes = structuredClone(app.DB.pos);
    assert.equal((await crear(token)).status, status);
    assert.deepEqual(app.DB.pos, antes);
  });
}
test("admin crea tienda y sus cajas y persiste en SQLite; GET protege datos", async () => {
  const respuesta = await crear(admin);
  assert.equal(respuesta.status, 200);
  assert.equal(respuesta.datos.id, 7);
  assert.deepEqual(respuesta.datos.creada_por, { usuario_id: 801, nombre: "Administrador prueba" });
  const persistido = cargar();
  assert.deepEqual(persistido.pos.sucursales.find((s) => s.id === 7), respuesta.datos);
  assert.equal(persistido.pos.cajas.filter((c) => c.sucursal_id === 7).length, 2);
  for (const token of [null, local]) {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const lista = await (await fetch(`${base}/api/sucursales`, { headers })).json();
    const nueva = lista.find((s) => s.id === 7);
    if (token) assert.deepEqual(nueva, respuesta.datos);
    else for (const campo of ["lat", "lng", "fecha_alta", "creada_por"]) assert.equal(campo in nueva, false);
  }
});
test("validación HTTP devuelve 400 con error y no altera tiendas ni cajas", async () => {
  const antes = structuredClone(app.DB.pos);
  const respuesta = await crear(admin, { ...datos, nombre: [] });
  assert.equal(respuesta.status, 400);
  assert.equal(typeof respuesta.datos.error, "string");
  assert.deepEqual(app.DB.pos, antes);
});
test("solo Administrador recibe automáticamente el permiso nuevo", () => {
  const rolesSembrados = app.DB.admin.roles.filter((r) => r.id < 800);
  assert.deepEqual(rolesSembrados.filter((r) => r.permisos.includes("administrar_sucursales")).map((r) => r.id), [1]);
});
