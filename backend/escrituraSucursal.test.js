const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { ajustarExistencia } = require("./productos");
const { crearVenta } = require("./ventas");
const { obtenerConfiguracion } = require("./configuracion");

test("ajustarExistencia afecta la existencia de la sucursal indicada", () => {
  const DB = construirDBPrueba();
  // producto 2 tiene existencia en sucursal 2 (cantidad 80)
  ajustarExistencia(DB, 2, { cantidad: -5, motivo: "prueba", sucursal_id: 2 });
  const exist = DB.inventario.existencias.find((e) => e.producto_id === 2 && e.sucursal_id === 2);
  assert.strictEqual(exist.cantidad_actual, 75);
});

test("crearVenta descuenta inventario de su propia sucursal", () => {
  const DB = construirDBPrueba();
  obtenerConfiguracion(DB); // inicializa config
  DB.pos.configuracion.permitir_ventas_sin_existencia = true; // no bloquear por stock en la prueba
  crearVenta(DB, { sucursal_id: 2, cliente_id: 0, lineas: [{ producto_id: 2, cantidad: 10, precio_unitario: 16 }], total: 160 });
  const exist = DB.inventario.existencias.find((e) => e.producto_id === 2 && e.sucursal_id === 2);
  assert.strictEqual(exist.cantidad_actual, 70, "se descontó de la sucursal 2");
});

test("listarProductos muestra la existencia de la sucursal pedida", () => {
  const { listarProductos } = require("./productos");
  const DB = construirDBPrueba();
  // producto 2 tiene 80 en sucursal 2 y 0 en sucursal 1 (fixture)
  const enSuc2 = listarProductos(DB, 2).find((p) => p.id === 2);
  const enSuc1 = listarProductos(DB, 1).find((p) => p.id === 2);
  assert.strictEqual(enSuc2.existencia, 80);
  assert.strictEqual(enSuc1.existencia, 0);
});
