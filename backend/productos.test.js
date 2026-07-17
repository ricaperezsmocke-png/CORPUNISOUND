const test = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { actualizarProducto } = require("./productos");

test("actualizarProducto: conserva el precio_venta si el frontend manda un precios[0] derivado del precio/costo existentes", () => {
  const DB = construirDBPrueba();
  // Simula un producto legacy SIN array `precios` (como los del seed de server.js)
  DB["catalogo-productos"].productos.push({
    id: 99, sku: "LEGACY-01", nombre: "Producto legacy", categoria_id: null,
    departamento_id: null, proveedor_id: null, unidad_compra: "PZA", unidad_venta: "PZA",
    factor: 1, iva: true, costo: 18, neto: true, unidad_medida: "pza",
    unidades_por_mayoreo: 0, ubicacion: "-", clave_sat: "", localizacion: "",
    promocion: false, imagen_url: "", activo: true, precio_venta: 25,
  });

  // Simula exactamente lo que el frontend corregido debe mandar: precios[0] derivado
  // del costo/precio_venta existentes (utilidad = (25-18)/18*100 ≈ 38.89), no en blanco.
  const datos = {
    descripcion: "Producto legacy (renombrado)",
    precio_compra: 18,
    precios: [
      { utilidad: 38.89, precioVenta: 25 },
      { utilidad: 0, precioVenta: 0 },
      { utilidad: 0, precioVenta: 0 },
      { utilidad: 0, precioVenta: 0 },
    ],
  };

  const actualizado = actualizarProducto(DB, 99, datos, 1);

  assert.strictEqual(actualizado.precio_venta, 25, "el precio de venta debe conservarse, no irse a 0");
  assert.strictEqual(actualizado.nombre, "Producto legacy (renombrado)", "el cambio solicitado sí debe aplicarse");
});

test("actualizarProducto: sigue permitiendo bajar el precio a 0 si el usuario lo hace a propósito", () => {
  const DB = construirDBPrueba();
  DB["catalogo-productos"].productos.push({
    id: 100, sku: "LEGACY-02", nombre: "Producto legacy 2", categoria_id: null,
    departamento_id: null, proveedor_id: null, unidad_compra: "PZA", unidad_venta: "PZA",
    factor: 1, iva: true, costo: 18, neto: true, unidad_medida: "pza",
    unidades_por_mayoreo: 0, ubicacion: "-", clave_sat: "", localizacion: "",
    promocion: false, imagen_url: "", activo: true, precio_venta: 25,
  });

  const datos = {
    descripcion: "Producto legacy 2",
    precio_compra: 18,
    precios: [
      { utilidad: 0, precioVenta: 0 },
      { utilidad: 0, precioVenta: 0 },
      { utilidad: 0, precioVenta: 0 },
      { utilidad: 0, precioVenta: 0 },
    ],
  };

  const actualizado = actualizarProducto(DB, 100, datos, 1);
  assert.strictEqual(actualizado.precio_venta, 0, "si el usuario manda 0 explícitamente, debe respetarse (no es el bug de este fix)");
});
