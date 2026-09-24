const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// La ruta real usa una base desechable, nunca datos.sqlite del worktree.
const BASE_DESECHABLE = path.join(os.tmpdir(), `corpunisound-cliente-destino-${process.pid}.sqlite`);
process.env.DB_PATH = BASE_DESECHABLE;
process.env.JWT_SECRET = process.env.JWT_SECRET || "secreto-solo-para-pruebas";
const app = require("./server");
const { sembrarCuentas } = require("./testHelpers");
const { firmarToken } = require("./auth");

const cuentas = [
  { id: 1, rol_id: 1, sucursal_id: 1 },
  { id: 2, rol_id: 2, sucursal_id: 1 },
  { id: 3, rol_id: 2, sucursal_id: 2 },
];
const [global, gerente, gerenteOtraTienda] = cuentas.map(firmarToken);
const ERROR_ALCANCE = { error: "No puedes mover el cliente a una sucursal fuera de tu alcance." };
let servidor;
let base;

before(async () => {
  sembrarCuentas(app, cuentas);
  await new Promise((listo) => { servidor = app.listen(0, listo); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});

beforeEach(() => {
  app.DB.crm.clientes = [
    { id: 0, nombre: "Público en General", sucursal_id: 1, vendedor_asignado_id: null, telefono: "111", saldo: 0 },
    { id: 10, nombre: "Cliente de prueba", sucursal_id: 1, vendedor_asignado_id: null, telefono: "111", saldo: 120 },
  ];
});

after(async () => {
  if (servidor) await new Promise((listo) => servidor.close(listo));
  try { fs.unlinkSync(BASE_DESECHABLE); } catch { /* La base desechable ya no estaba. */ }
});

async function editar(token, id, datos, query = "") {
  const respuesta = await fetch(`${base}/api/clientes/${id}${query}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(datos),
  });
  return { status: respuesta.status, datos: await respuesta.json() };
}

async function comprobarRechazo(token, id, destino, status, query = "") {
  const antes = structuredClone(app.DB.crm.clientes);
  const respuesta = await editar(token, id, { sucursal_id: destino, telefono: "NO GUARDAR" }, query);
  assert.equal(respuesta.status, status);
  if (status === 403) assert.deepEqual(respuesta.datos, ERROR_ALCANCE);
  assert.deepEqual(app.DB.crm.clientes, antes, "el rechazo no modifica ningún dato del cliente");
}

test("gerente no mueve su cliente a otra tienda aunque manipule el filtro de sucursal", async () => {
  await comprobarRechazo(gerente, 10, "2", 403, "?sucursal_id=2");
});

test("gerente reenvía la misma sucursal como texto y guarda el teléfono", async () => {
  const respuesta = await editar(gerente, 10, { sucursal_id: "1", telefono: "222" });
  assert.equal(respuesta.status, 200);
  assert.equal(respuesta.datos.sucursal_id, 1);
  assert.equal(app.DB.crm.clientes[1].telefono, "222");
});

test("gerente edita el teléfono sin enviar sucursal", async () => {
  const respuesta = await editar(gerente, 10, { telefono: "222" });
  assert.equal(respuesta.status, 200);
  assert.equal(app.DB.crm.clientes[1].sucursal_id, 1);
  assert.equal(app.DB.crm.clientes[1].telefono, "222");
});

test("alcance global mueve un cliente entre tiendas", async () => {
  const respuesta = await editar(global, 10, { sucursal_id: "2", telefono: "222" }, "?sucursal_id=todas");
  assert.equal(respuesta.status, 200);
  assert.equal(respuesta.datos.sucursal_id, 2);
  assert.equal(app.DB.crm.clientes[1].sucursal_id, 2);
  assert.equal(app.DB.crm.clientes[1].telefono, "222");
});

for (const destino of ["", 0, "NaN", 999999, null]) {
  for (const [nombre, token] of [["gerente", gerente], ["global", global]]) {
    test(`${nombre} rechaza destino inválido ${JSON.stringify(destino)} sin modificar nada`, async () => {
      await comprobarRechazo(token, 10, destino, 400);
    });
  }
}

test("Público en General conserva su sucursal al editar desde otra tienda", async () => {
  const respuesta = await editar(gerenteOtraTienda, 0, { sucursal_id: "1", telefono: "222" });
  assert.equal(respuesta.status, 200);
  assert.equal(respuesta.datos.id, 0);
  assert.equal(app.DB.crm.clientes[0].sucursal_id, 1);
  assert.equal(app.DB.crm.clientes[0].telefono, "222");
});

test("gerente no mueve Público en General a otra tienda", async () => {
  await comprobarRechazo(gerente, 0, 2, 403);
});

test("gerente de otra tienda tampoco mueve Público en General a su propia tienda", async () => {
  await comprobarRechazo(gerenteOtraTienda, 0, 2, 403);
});

test("alcance global puede mover Público en General", async () => {
  const respuesta = await editar(global, 0, { sucursal_id: 2 });
  assert.equal(respuesta.status, 200);
  assert.equal(app.DB.crm.clientes[0].sucursal_id, 2);
});
