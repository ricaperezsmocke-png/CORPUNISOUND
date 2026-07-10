const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { actualizarCostoDesdeCompra } = require("./productos");

test("actualizarCostoDesdeCompra actualiza el costo y recalcula precioVenta conservando la utilidad", () => {
  const DB = construirDBPrueba();
  const producto = DB["catalogo-productos"].productos.find((p) => p.id === 1);
  producto.costo = 100;
  producto.precios = [{ utilidad: 20, precioVenta: 120 }, { utilidad: 50, precioVenta: 150 }, { utilidad: 0, precioVenta: 0 }, { utilidad: 0, precioVenta: 0 }];

  const actualizado = actualizarCostoDesdeCompra(DB, 1, 200);

  assert.strictEqual(actualizado.costo, 200);
  assert.strictEqual(actualizado.precios[0].utilidad, 20, "la utilidad no cambia");
  assert.strictEqual(actualizado.precios[0].precioVenta, 240, "200 * 1.20");
  assert.strictEqual(actualizado.precios[1].precioVenta, 300, "200 * 1.50");
  assert.strictEqual(actualizado.precio_venta, 240, "precio_venta espeja el nivel 1");
});

test("actualizarCostoDesdeCompra no hace nada si el costo capturado es igual al actual", () => {
  const DB = construirDBPrueba();
  const producto = DB["catalogo-productos"].productos.find((p) => p.id === 1);
  producto.costo = 100;
  producto.precios = [{ utilidad: 20, precioVenta: 120 }, { utilidad: 0, precioVenta: 0 }, { utilidad: 0, precioVenta: 0 }, { utilidad: 0, precioVenta: 0 }];

  const antes = JSON.stringify(producto.precios);
  actualizarCostoDesdeCompra(DB, 1, 100);
  assert.strictEqual(JSON.stringify(producto.precios), antes, "no debe tocar los precios si el costo no cambió");
});

test("actualizarCostoDesdeCompra funciona igual cuando el costo previo era 0", () => {
  const DB = construirDBPrueba();
  const producto = DB["catalogo-productos"].productos.find((p) => p.id === 2);
  producto.costo = 0;
  producto.precios = [{ utilidad: 25, precioVenta: 0 }, { utilidad: 0, precioVenta: 0 }, { utilidad: 0, precioVenta: 0 }, { utilidad: 0, precioVenta: 0 }];

  const actualizado = actualizarCostoDesdeCompra(DB, 2, 80);
  assert.strictEqual(actualizado.costo, 80);
  assert.strictEqual(actualizado.precios[0].precioVenta, 100, "80 * 1.25");
});

test("actualizarCostoDesdeCompra rechaza producto inexistente", () => {
  const DB = construirDBPrueba();
  assert.throws(() => actualizarCostoDesdeCompra(DB, 999, 50), /Producto no encontrado/);
});
