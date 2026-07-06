const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { listarClientes } = require("./clientes");
const { listarClientesCRM } = require("./crm");

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
