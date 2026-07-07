const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { consultarModulo } = require("./consultarModulo");

const YAJALON = { verTodas: false, sucursalId: 2 };
const TODAS = { verTodas: true, sucursalId: null };

test("consultarModulo fuerza la sucursal del usuario amarrado en ventas", () => {
  const DB = construirDBPrueba();
  const r = consultarModulo({ modulo: "pos", tabla: "ventas" }, YAJALON, DB);
  assert.ok(r.every((v) => v.sucursal_id === 2), "solo ventas de Yajalón");
});

test("consultarModulo ignora un sucursal_id ajeno pedido por un amarrado", () => {
  const DB = construirDBPrueba();
  const r = consultarModulo({ modulo: "pos", tabla: "ventas", filtros: { sucursal_id: 1 } }, YAJALON, DB);
  assert.ok(r.every((v) => v.sucursal_id === 2), "no puede espiar la sucursal 1");
});

test("consultarModulo filtra venta_detalle cruzando por ventas de la sucursal", () => {
  const DB = construirDBPrueba();
  const r = consultarModulo({ modulo: "pos", tabla: "venta_detalle" }, YAJALON, DB);
  const ventasYajalon = DB.pos.ventas.filter((v) => v.sucursal_id === 2).map((v) => v.id);
  assert.ok(r.every((d) => ventasYajalon.includes(d.venta_id)), "solo detalle de ventas de Yajalón");
});

test("usuario global ve todo", () => {
  const DB = construirDBPrueba();
  const r = consultarModulo({ modulo: "pos", tabla: "ventas" }, TODAS, DB);
  assert.strictEqual(r.length, DB.pos.ventas.length);
});
