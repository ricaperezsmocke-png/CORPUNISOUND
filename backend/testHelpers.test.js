const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");

test("el fixture tiene ventas en varias sucursales y roles sembrados", () => {
  const DB = construirDBPrueba();
  const sucursales = new Set(DB.pos.ventas.map((v) => v.sucursal_id));
  assert.ok(sucursales.size >= 3, "debe haber ventas en al menos 3 sucursales");
  assert.ok(DB.admin.roles.length >= 3, "roles deben estar sembrados");
  assert.ok(DB.crm.clientes.some((c) => c.id === 0), "debe existir Público en General");
});
