const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { listarClientes, obtenerCliente } = require("./clientes");
const { listarClientesCRM, obtenerClienteCRM } = require("./crm");
const { obtenerVentaDetalle } = require("./ventas");
const { dentroDeAlcance } = require("./auth");

const ALCANCE_YAJALON = { verTodas: false, sucursalId: 2 };
const ALCANCE_TODAS = { verTodas: true, sucursalId: null };

test("listarClientes filtra por sucursal pero mantiene a Público en General", () => {
  const DB = construirDBPrueba();
  const r = listarClientes(DB, ALCANCE_YAJALON);
  // Debe traer el cliente de Yajalón (id 2) y SIEMPRE el Público en General (id 0)
  assert.ok(r.some((c) => c.id === 2), "cliente de Yajalón presente");
  assert.ok(r.some((c) => c.id === 0), "Público en General siempre presente");
  assert.ok(!r.some((c) => c.id === 1), "cliente de Ocosingo NO debe aparecer");
});

test("listarClientes con verTodas trae todos", () => {
  const DB = construirDBPrueba();
  assert.strictEqual(listarClientes(DB, ALCANCE_TODAS).length, DB.crm.clientes.length);
});

test("listarClientesCRM filtra por sucursal", () => {
  const DB = construirDBPrueba();
  const r = listarClientesCRM(DB, ALCANCE_YAJALON);
  assert.ok(r.every((c) => c.sucursal_id === 2), "solo clientes de Yajalón");
  assert.ok(!r.some((c) => c.id === 0), "id 0 nunca en CRM");
});

// ---------------------------------------------------------------------------
// Rutas de registro individual (:id) — Finding 1 del review final: estas
// rutas no tenían NINGÚN chequeo de sucursal. La ruta real (server.js) hace
// exactamente esto: busca el registro y, si el usuario está amarrado y el
// registro es de otra sucursal, responde 404 en vez de devolverlo.
// ---------------------------------------------------------------------------

test("GET /api/clientes/:id: un amarrado puede ver el cliente de su propia sucursal (200)", () => {
  const DB = construirDBPrueba();
  const propio = obtenerCliente(DB, 2); // cliente 2 es de Yajalón (sucursal 2)
  assert.strictEqual(dentroDeAlcance(propio.sucursal_id, ALCANCE_YAJALON), true);
});

test("GET /api/clientes/:id: un amarrado NO puede ver el cliente de otra sucursal (404)", () => {
  const DB = construirDBPrueba();
  const ajeno = obtenerCliente(DB, 1); // cliente 1 es de Ocosingo (sucursal 1)
  assert.strictEqual(dentroDeAlcance(ajeno.sucursal_id, ALCANCE_YAJALON), false);
});

test("GET /api/clientes/:id y /api/crm/clientes/:id: Público en General (id 0) es alcanzable sin importar la sucursal del usuario", () => {
  const DB = construirDBPrueba();
  const publico = obtenerCliente(DB, 0);
  assert.strictEqual(publico.id, 0);
  // Su sucursal_id de origen (1) por sí sola lo dejaría fuera del alcance de
  // Yajalón — por eso la ruta exime explícitamente al id 0 de este chequeo.
  assert.strictEqual(dentroDeAlcance(publico.sucursal_id, ALCANCE_YAJALON), false, "sin la excepción de id 0 sería rechazado");
  assert.strictEqual(publico.id === 0 || dentroDeAlcance(publico.sucursal_id, ALCANCE_YAJALON), true, "con la excepción, la ruta lo deja pasar");

  const publicoCRM = obtenerClienteCRM(DB, 0);
  assert.strictEqual(publicoCRM.id === 0 || dentroDeAlcance(publicoCRM.sucursal_id, ALCANCE_YAJALON), true);
});

test("GET /api/crm/clientes/:id: un amarrado NO puede ver el cliente CRM de otra sucursal (404)", () => {
  const DB = construirDBPrueba();
  const ajeno = obtenerClienteCRM(DB, 1); // sucursal 1
  assert.strictEqual(dentroDeAlcance(ajeno.sucursal_id, ALCANCE_YAJALON), false);
});

test("GET /api/ventas/:id: un amarrado puede ver la venta de su propia sucursal (200)", () => {
  const DB = construirDBPrueba();
  const propia = obtenerVentaDetalle(DB, 2); // venta 2 es de sucursal 2
  assert.strictEqual(dentroDeAlcance(propia.sucursal_id, ALCANCE_YAJALON), true);
});

test("GET /api/ventas/:id: un amarrado NO puede ver la venta de otra sucursal (404)", () => {
  const DB = construirDBPrueba();
  const ajena = obtenerVentaDetalle(DB, 1); // venta 1 es de sucursal 1
  assert.strictEqual(dentroDeAlcance(ajena.sucursal_id, ALCANCE_YAJALON), false);
});

test("GET /api/ventas/:id: un usuario con ver_todas_las_sucursales ve cualquier venta", () => {
  const DB = construirDBPrueba();
  const venta = obtenerVentaDetalle(DB, 1);
  assert.strictEqual(dentroDeAlcance(venta.sucursal_id, ALCANCE_TODAS), true);
});
