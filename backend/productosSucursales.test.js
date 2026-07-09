const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { crearProducto, actualizarProducto, clonarProducto } = require("./productos");

test("crearProducto siembra existencia en todas las sucursales de DB.pos.sucursales", () => {
  const DB = construirDBPrueba();
  const nuevoId = crearProducto(DB, { descripcion: "Cuerdas de guitarra", existencia_inicial: 20, existencia_minima: 5, existencia_maxima: 50 }, 2).id;
  const filas = DB.inventario.existencias.filter((e) => e.producto_id === nuevoId);
  assert.strictEqual(filas.length, DB.pos.sucursales.length, "debe haber una fila por sucursal");
  const enOrigen = filas.find((e) => e.sucursal_id === 2);
  assert.strictEqual(enOrigen.cantidad_actual, 20);
  assert.strictEqual(enOrigen.cantidad_minima, 5);
  assert.strictEqual(enOrigen.cantidad_maxima, 50);
  const enOtra = filas.find((e) => e.sucursal_id === 1);
  assert.strictEqual(enOtra.cantidad_actual, 0);
  assert.strictEqual(enOtra.cantidad_minima, 0);
});

test("crearProducto sin sucursalId usa la sucursal 1 por defecto (compatibilidad)", () => {
  const DB = construirDBPrueba();
  const nuevoId = crearProducto(DB, { descripcion: "Púas", existencia_inicial: 100 }).id;
  const enSuc1 = DB.inventario.existencias.find((e) => e.producto_id === nuevoId && e.sucursal_id === 1);
  assert.strictEqual(enSuc1.cantidad_actual, 100);
});

test("actualizarProducto ajusta existencia_minima/maxima de la sucursal indicada", () => {
  const DB = construirDBPrueba();
  const nuevoId = crearProducto(DB, { descripcion: "Cuerdas", existencia_inicial: 10 }, 2).id;
  actualizarProducto(DB, nuevoId, { existencia_minima: 3, existencia_maxima: 30 }, 2);
  const fila = DB.inventario.existencias.find((e) => e.producto_id === nuevoId && e.sucursal_id === 2);
  assert.strictEqual(fila.cantidad_minima, 3);
  assert.strictEqual(fila.cantidad_maxima, 30);
  const filaOtraSucursal = DB.inventario.existencias.find((e) => e.producto_id === nuevoId && e.sucursal_id === 1);
  assert.strictEqual(filaOtraSucursal.cantidad_minima, 0, "no debe tocar la sucursal 1");
});

test("clonarProducto siembra la existencia inicial en la sucursal indicada", () => {
  const DB = construirDBPrueba();
  const originalId = crearProducto(DB, { descripcion: "Original", existencia_inicial: 5 }, 1).id;
  const clon = clonarProducto(DB, originalId, 3);
  const filaClonEnSuc3 = DB.inventario.existencias.find((e) => e.producto_id === clon.id && e.sucursal_id === 3);
  assert.strictEqual(filaClonEnSuc3.cantidad_actual, 0, "clonar siempre arranca en 0, aunque sea en la sucursal del que clona");
});
