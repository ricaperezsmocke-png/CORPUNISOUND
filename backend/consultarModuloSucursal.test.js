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

// Finding 3 del review final: inventario.movimientos_inventario tiene
// sucursal_id propio (lo estampa ajustarExistencia) pero no estaba en la
// lista fija TABLAS_CON_SUCURSAL — un amarrado podía pedírsela al asistente
// de IA y ver el historial de movimientos de TODAS las sucursales.
test("consultarModulo ahora filtra movimientos_inventario para un amarrado (antes no estaba protegida)", () => {
  const DB = construirDBPrueba();
  DB.inventario.movimientos_inventario.push(
    { id: 1, producto_id: 1, sucursal_id: 1, fecha: "2026-06-01", tipo: "salida", cantidad: -5, referencia_documento: "Venta — folio 1" },
    { id: 2, producto_id: 2, sucursal_id: 2, fecha: "2026-06-02", tipo: "salida", cantidad: -3, referencia_documento: "Venta — folio 2" }
  );
  const r = consultarModulo({ modulo: "inventario", tabla: "movimientos_inventario" }, YAJALON, DB);
  assert.strictEqual(r.length, 1);
  assert.ok(r.every((m) => m.sucursal_id === 2), "solo movimientos de Yajalón, no puede espiar la sucursal 1");
});

test("consultarModulo con movimientos_inventario vacío no revienta y no filtra nada de la nada (fail-safe)", () => {
  const DB = construirDBPrueba();
  const r = consultarModulo({ modulo: "inventario", tabla: "movimientos_inventario" }, YAJALON, DB);
  assert.deepStrictEqual(r, []);
});

test("consultarModulo: usuario global ve movimientos_inventario de todas las sucursales", () => {
  const DB = construirDBPrueba();
  DB.inventario.movimientos_inventario.push(
    { id: 1, producto_id: 1, sucursal_id: 1, fecha: "2026-06-01", tipo: "salida", cantidad: -5, referencia_documento: "Venta — folio 1" },
    { id: 2, producto_id: 2, sucursal_id: 2, fecha: "2026-06-02", tipo: "salida", cantidad: -3, referencia_documento: "Venta — folio 2" }
  );
  const r = consultarModulo({ modulo: "inventario", tabla: "movimientos_inventario" }, TODAS, DB);
  assert.strictEqual(r.length, 2);
});
