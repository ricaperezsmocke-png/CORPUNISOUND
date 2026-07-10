const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { resumenPorSucursal, rankingVendedores } = require("./crm");

const YAJALON = { verTodas: false, sucursalId: 2 };
const TODAS = { verTodas: true, sucursalId: null };

test("resumenPorSucursal amarrado solo devuelve su sucursal", () => {
  const DB = construirDBPrueba();
  const r = resumenPorSucursal(DB, YAJALON);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].sucursal_id, 2);
});

test("resumenPorSucursal global devuelve las 6", () => {
  const DB = construirDBPrueba();
  assert.strictEqual(resumenPorSucursal(DB, TODAS).length, 6);
});

test("rankingVendedores amarrado solo trae vendedores de su sucursal", () => {
  const DB = construirDBPrueba();
  const r = rankingVendedores(DB, YAJALON);
  assert.ok(r.every((v) => DB.pos.vendedores.find((x) => x.id === v.vendedor_id)?.sucursal_id === 2));
});
