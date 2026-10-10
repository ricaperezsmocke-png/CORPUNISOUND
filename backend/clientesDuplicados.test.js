const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Base desechable: nunca datos.sqlite del worktree.
const BASE_DESECHABLE = path.join(os.tmpdir(), `corpunisound-clientes-dup-${process.pid}.sqlite`);
process.env.DB_PATH = BASE_DESECHABLE;
process.env.JWT_SECRET = process.env.JWT_SECRET || "secreto-solo-para-pruebas";
const app = require("./server");
const { sembrarCuentas } = require("./testHelpers");
const { firmarToken } = require("./auth");
const { crearCliente } = require("./clientes");

const cuentas = [
  { id: 1, rol_id: 1, sucursal_id: 1 }, // Administrador: ve todas las tiendas
  { id: 2, rol_id: 2, sucursal_id: 1 }, // Gerente de Ocosingo
];
const [global, gerente] = cuentas.map(firmarToken);
let servidor;
let base;

before(async () => {
  sembrarCuentas(app, cuentas);
  await new Promise((listo) => { servidor = app.listen(0, listo); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});

beforeEach(() => {
  app.DB.crm.clientes = [
    { id: 0, nombre: "Público en General", sucursal_id: 1, telefono: "9610000000", email: "publico@x.com" },
    { id: 10, nombre: "Juan Pérez", sucursal_id: 1, telefono: "9611234567", celular: "", email: "juan@x.com", saldo: 500 },
    { id: 11, nombre: "Rosa Díaz", sucursal_id: 2, telefono: "", celular: "919 555 0001", email: "", monedero: 80 },
    { id: 12, nombre: "Cliente viejo de SICAR", sucursal_id: 1, telefono: "", celular: "", email: "" },
  ];
});

after(async () => {
  if (servidor) await new Promise((listo) => servidor.close(listo));
  try { fs.unlinkSync(BASE_DESECHABLE); } catch { /* ya no estaba */ }
});

async function pedir(metodo, ruta, token, datos) {
  const respuesta = await fetch(`${base}/api${ruta}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(datos),
  });
  return { status: respuesta.status, datos: await respuesta.json() };
}
const alta = (datos, token = gerente) => pedir("POST", "/clientes?sucursal_id=1", token, { sucursal_id: 1, ...datos });
const editar = (id, datos, token = gerente) => pedir("PUT", `/clientes/${id}`, token, datos);

test("alta sin teléfono ni celular se rechaza", async () => {
  const r = await alta({ nombre: "Sin número" });
  assert.equal(r.status, 400);
  assert.match(r.datos.error, /teléfono del cliente es obligatorio/);
  assert.equal(app.DB.crm.clientes.length, 4);
});

test("alta con solo celular válido entra y guarda el número como se escribió", async () => {
  const r = await alta({ nombre: "Ana", celular: "(961) 777-8899" });
  assert.equal(r.status, 200);
  assert.equal(r.datos.celular, "(961) 777-8899");
});

test("teléfono incompleto se rechaza", async () => {
  const r = await alta({ nombre: "Ana", telefono: "961-123-45" });
  assert.equal(r.status, 400);
  assert.match(r.datos.error, /10 dígitos/);
});

test("mismo teléfono con +52 y espacios: ya está registrado, con nombre y tienda", async () => {
  const r = await alta({ nombre: "Juanito", telefono: "+52 961 123 4567" });
  assert.equal(r.status, 409);
  assert.equal(r.datos.error, "Este cliente ya está registrado: el teléfono 9611234567 es de Juan Pérez (Ocosingo).");
  assert.deepEqual(Object.keys(r.datos.cliente_existente).sort(), ["id", "nombre", "sucursal"]);
  assert.ok(!JSON.stringify(r.datos).includes("500"), "no expone el saldo del cliente existente");
  assert.equal(app.DB.crm.clientes.length, 4);
});

test("teléfono nuevo igual al celular de otro cliente también choca", async () => {
  const r = await alta({ nombre: "Rosa", telefono: "9195550001" }, global);
  assert.equal(r.status, 409);
  assert.match(r.datos.error, /Rosa Díaz \(Yajalón\)\.$/);
});

test("cliente de otra tienda: al gerente se le dice que lo pida; al administrador no", async () => {
  const r = await alta({ nombre: "Rosa", celular: "9195550001" });
  assert.equal(r.status, 409);
  assert.match(r.datos.error, /Pídele a tu gerente que lo cambie a tu tienda\.$/);
  const r2 = await alta({ nombre: "Rosa", celular: "9195550001" }, global);
  assert.doesNotMatch(r2.datos.error, /Pídele/);
});

test("correo igual sin importar mayúsculas ni espacios", async () => {
  const r = await alta({ nombre: "Otro", telefono: "9612223344", email: "  JUAN@X.com " });
  assert.equal(r.status, 409);
  assert.equal(r.datos.error, "Este cliente ya está registrado: el correo juan@x.com es de Juan Pérez (Ocosingo).");
});

test("Público en General no cuenta como cliente registrado", async () => {
  const r = await alta({ nombre: "Nuevo", telefono: "9610000000", email: "publico@x.com" });
  assert.equal(r.status, 200);
});

test("editar: poner el teléfono de otro cliente se rechaza sin cambiar nada", async () => {
  const antes = structuredClone(app.DB.crm.clientes);
  const r = await editar(12, { telefono: "961 123 4567" });
  assert.equal(r.status, 409);
  assert.deepEqual(app.DB.crm.clientes, antes);
});

test("editar: conservar su propio teléfono o correo no choca consigo mismo", async () => {
  const r = await editar(10, { telefono: "9611234567", email: "juan@x.com", nombre: "Juan P." });
  assert.equal(r.status, 200);
});

test("editar solo el nombre de un cliente viejo sin teléfono sigue funcionando", async () => {
  const r = await editar(12, { nombre: "Cliente viejo" });
  assert.equal(r.status, 200);
});

test("editar: no se puede dejar al cliente sin teléfono ni celular", async () => {
  const r = await editar(10, { telefono: "", celular: "" });
  assert.equal(r.status, 400);
  assert.equal(app.DB.crm.clientes[1].telefono, "9611234567");
});

test("editar: en la edición no se exige el formato de 10 dígitos", async () => {
  const r = await editar(10, { telefono: "222" });
  assert.equal(r.status, 200);
});

test("editar: correo de otro cliente se rechaza", async () => {
  const r = await editar(11, { email: "Juan@x.com" }, global);
  assert.equal(r.status, 409);
});

test("importación de SICAR y Radar (crearCliente directo) siguen aceptando clientes sin teléfono", () => {
  const DB = { crm: { clientes: [] }, pos: { vendedores: [], sucursales: [] } };
  const c = crearCliente(DB, { nombre: "Migrado", sucursal_id: 1 });
  assert.equal(c.telefono, "");
});

test("editar: un número corto histórico tampoco se puede repetir", async () => {
  app.DB.crm.clientes[3].telefono = "222";
  const r = await editar(10, { telefono: "222" });
  assert.equal(r.status, 409);
  assert.equal(app.DB.crm.clientes[1].telefono, "9611234567");
});

test("editar: un duplicado viejo en el campo que no se toca no traba el cambio", async () => {
  app.DB.crm.clientes[3].telefono = "9611234567"; // importado repetido antes de esta regla
  const r = await editar(10, { celular: "9617778899" });
  assert.equal(r.status, 200);
  assert.equal(r.datos.celular, "9617778899");
});

test("teléfono, celular o correo que no son texto se rechazan (no se guardan arreglos ni números)", async () => {
  for (const datos of [
    { nombre: "Ana", telefono: [], celular: "9617778899" },
    { nombre: "Ana", telefono: 9617778899 },
    { nombre: "Ana", telefono: "9617778899", email: { a: 1 } },
  ]) {
    const r = await alta(datos);
    assert.equal(r.status, 400, JSON.stringify(datos));
  }
  const r = await editar(10, { celular: ["9617778899"] });
  assert.equal(r.status, 400);
  assert.equal(app.DB.crm.clientes.length, 4);
});
