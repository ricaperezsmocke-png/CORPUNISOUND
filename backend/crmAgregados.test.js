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

// ---------- El ranking frente a un vendedor desactivado ----------

test("un vendedor desactivado SIN cartera se cae del ranking, pero CON cartera se queda", () => {
  // Si se fuera con clientes asignados, sacarlo haría que la suma del ranking
  // no cuadre con el total de la sucursal y Victor vería un hueco sin explicación.
  const { rankingVendedores } = require("./crm");
  const DB = {
    pos: {
      sucursales: [{ id: 1, nombre: "Ocosingo" }],
      vendedores: [
        { id: 1, nombre: "Sigue Aqui", sucursal_id: 1 },
        { id: 2, nombre: "Se Fue Con Cartera", sucursal_id: 1, activo: false },
        { id: 3, nombre: "Se Fue Sin Cartera", sucursal_id: 1, activo: false },
      ],
      ventas: [],
      venta_detalle: [],
    },
    "catalogo-productos": { productos: [] },
    crm: {
      clientes: [
        { id: 1, nombre: "Cliente A", sucursal_id: 1, vendedor_asignado_id: 2, estado: "compro" },
      ],
    },
  };
  const ranking = rankingVendedores(DB, { verTodas: true });
  const ids = ranking.map((r) => r.vendedor_id);
  assert.ok(ids.includes(1), "el activo se queda");
  assert.ok(ids.includes(2), "el desactivado con cartera se queda o la suma no cuadra");
  assert.ok(!ids.includes(3), "el desactivado sin cartera se cae");
});
