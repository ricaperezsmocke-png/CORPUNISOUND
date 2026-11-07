/**
 * autorizadorTitere.test.js — Una cuenta dada de alta por quien pide no puede
 * autorizarle nada (revisión 2026-10-27, R1).
 *
 * La revisión mostraba que un gerente con `dar_alta_personal` y
 * `autorizar_monedero` creaba una cuenta "títere" con su mismo rol y con ella
 * se autorizaba su propio monedero (saldo de $500 a $450) o una cancelación.
 * Aquí se exige lo contrario, contra las rutas REALES:
 * - el alta sin alcance global ya no concede autorizar_monedero ni
 *   autorizar_cancelaciones;
 * - y aunque la títere exista (alta vieja o hecha por otro camino), el
 *   autorizador rechaza a una cuenta cuyo creado_por_id es quien pide.
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "autorizador-titere-")), "datos.sqlite");
process.env.JWT_SECRET = process.env.JWT_SECRET || "secreto-de-pruebas";

const app = require("./server");
const { sembrarCuentas } = require("./testHelpers");
const { firmarToken, hashearPassword } = require("./auth");

const DB = app.DB;
let servidor = null, base = "";

const ROL_GERENTE = 95;
const ROL_CAJERA = 96;
const PERMISOS_GERENTE = [
  "cerrar_venta", "dar_alta_personal", "aplicar_monedero", "autorizar_monedero",
  "cancelar_ventas", "autorizar_cancelaciones",
];

async function cuenta(datos) {
  DB.admin.usuarios.push({ vendedor_id: null, activo: true, ...datos, password_hash: await hashearPassword(datos.password) });
}

before(async () => {
  DB.admin.roles.push({ id: ROL_GERENTE, nombre: "Gerente con altas", permisos: PERMISOS_GERENTE, modulos: ["pos", "admin"] });
  // Lo que el gerente SÍ puede conceder: vecinos del mismo módulo, sin autorizar.
  DB.admin.roles.push({ id: ROL_CAJERA, nombre: "Cajera", permisos: ["cerrar_venta", "aplicar_monedero", "cancelar_ventas"],
    modulos: ["pos"] });
  sembrarCuentas(app, [{ id: 1, rol_id: 1, sucursal_id: 1 }]);
  await cuenta({ id: 60, nombre: "Gerente Ocosingo", usuario: "gerente.oco", password: "Gerente2026", rol_id: ROL_GERENTE,
    sucursal_id: 1 });
  await cuenta({ id: 62, nombre: "Supervisora", usuario: "supervisora", password: "Supervisa2026", rol_id: ROL_GERENTE,
    sucursal_id: 1 });
  // La títere: mismo rol que el gerente y firmada como creada por él.
  await cuenta({ id: 70, nombre: "Titere", usuario: "titere", password: "Titere2026", rol_id: ROL_GERENTE, sucursal_id: 1,
    creado_por_id: 60 });
  await new Promise((listo) => { servidor = app.listen(0, listo); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(async () => {
  if (servidor) await new Promise((listo) => servidor.close(listo));
});

const token = (id) => {
  const u = DB.admin.usuarios.find((x) => x.id === id);
  return firmarToken({ id: u.id, nombre: u.nombre, rol_id: u.rol_id, sucursal_id: u.sucursal_id });
};

async function pedir(metodo, ruta, tk, body) {
  const r = await fetch(base + ruta, {
    method: metodo,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${tk}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: await r.json().catch(() => null) };
}

function clienteOcosingo(saldo) {
  const c = DB.crm.clientes.find((x) => Number(x.sucursal_id) === 1 && Number(x.id) > 0);
  c.monedero = saldo;
  return c;
}

const venta = (extra = {}) => ({
  metodo_pago: "Efectivo", vendedor_id: 1,
  lineas: [{ producto_id: 1, descripcion: "Arroz 1kg", cantidad: 4, precio_unitario: 25 }], ...extra,
});

test("alta sin alcance global con un rol que autoriza monedero o cancelaciones → 403 y no se crea (R1 invertida)", async () => {
  const antes = DB.admin.usuarios.length;
  const r = await pedir("POST", "/api/usuarios", token(60),
    { nombre: "Titere 2", usuario: "titere2", password: "Titere2026", rol_id: ROL_GERENTE, sucursal_id: 1 });
  assert.strictEqual(r.status, 403, JSON.stringify(r.json));
  assert.strictEqual(DB.admin.usuarios.length, antes);
  assert.ok(!DB.admin.usuarios.some((u) => u.usuario === "titere2"));
});

test("el mismo gerente sí da de alta una cajera que no autoriza nada", async () => {
  const r = await pedir("POST", "/api/usuarios", token(60),
    { nombre: "Cajera nueva", usuario: "cajera.nueva", password: "Cajera2026", rol_id: ROL_CAJERA, sucursal_id: 1 });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
});

test("monedero: la títere no le autoriza a quien la creó y el saldo no se mueve (R1 invertida)", async () => {
  const cliente = clienteOcosingo(500);
  const ventasAntes = DB.pos.ventas.length;
  const r = await pedir("POST", "/api/ventas", token(60), venta({ cliente_id: cliente.id, monedero_aplicado: 50,
    autorizador: { usuario: "titere", password: "Titere2026" } }));
  assert.deepStrictEqual(r, { status: 403, json: { error: "La autorización no es válida" } });
  assert.strictEqual(cliente.monedero, 500);
  assert.strictEqual(DB.pos.ventas.length, ventasAntes);
});

test("monedero: la títere sí le autoriza a otra persona (la regla es sobre quien la creó)", async () => {
  const cliente = clienteOcosingo(500);
  const r = await pedir("POST", "/api/ventas", token(62), venta({ cliente_id: cliente.id, monedero_aplicado: 50,
    autorizador: { usuario: "titere", password: "Titere2026" } }));
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.strictEqual(cliente.monedero, 450);
});

test("cancelación: la títere no le autoriza a quien la creó y la venta sigue viva (R1 invertida)", async () => {
  const hecha = await pedir("POST", "/api/ventas", token(60), venta());
  assert.strictEqual(hecha.status, 200, JSON.stringify(hecha.json));
  const r = await pedir("PUT", `/api/ventas/${hecha.json.id}/cancelar`, token(60),
    { motivo: "prueba", autorizador: { usuario: "titere", password: "Titere2026" } });
  assert.deepStrictEqual(r, { status: 403, json: { error: "La autorización no es válida" } });
  const v = DB.pos.ventas.find((x) => x.id === hecha.json.id);
  assert.notStrictEqual(v.estatus, "cancelada");
  // Control: otra persona sí la autoriza.
  const ok = await pedir("PUT", `/api/ventas/${hecha.json.id}/cancelar`, token(60),
    { motivo: "prueba", autorizador: { usuario: "supervisora", password: "Supervisa2026" } });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.json));
});
