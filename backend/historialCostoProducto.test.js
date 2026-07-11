const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { crearRecepcion, historialCostoProducto } = require("./compras");

function conProveedor(DB) {
  DB["catalogo-productos"].proveedores.push({ id: 1, nombre: "Proveedor Uno", contacto: "", tiempo_entrega_dias: 0, condiciones_pago: "", rfc: "" });
  return DB;
}

test("historialCostoProducto sin compras previas devuelve null en ambos", () => {
  const DB = construirDBPrueba();
  const historial = historialCostoProducto(DB, 1);
  assert.strictEqual(historial.ultimo, null);
  assert.strictEqual(historial.promedio, null);
});

test("historialCostoProducto con una compra: ultimo y promedio son el mismo costo, con y sin IVA", () => {
  const DB = conProveedor(construirDBPrueba());
  crearRecepcion(DB, { proveedor_id: 1, renglones: [{ producto_id: 1, cantidad: 5, costo: 100 }] }, 6, { id: 1, nombre: "T" });

  const historial = historialCostoProducto(DB, 1);
  assert.strictEqual(historial.ultimo.neto, 100);
  assert.strictEqual(historial.ultimo.conIva, 116);
  assert.strictEqual(historial.promedio.neto, 100);
  assert.strictEqual(historial.promedio.conIva, 116);
});

test("historialCostoProducto con varias compras: ultimo es la mas reciente, promedio es el promedio simple", () => {
  const DB = conProveedor(construirDBPrueba());
  crearRecepcion(DB, { proveedor_id: 1, renglones: [{ producto_id: 1, cantidad: 5, costo: 100 }] }, 6, { id: 1, nombre: "T" });
  crearRecepcion(DB, { proveedor_id: 1, renglones: [{ producto_id: 1, cantidad: 5, costo: 200 }] }, 6, { id: 1, nombre: "T" });

  const historial = historialCostoProducto(DB, 1);
  assert.strictEqual(historial.ultimo.neto, 200, "la compra mas reciente");
  assert.strictEqual(historial.promedio.neto, 150, "(100 + 200) / 2");
});
