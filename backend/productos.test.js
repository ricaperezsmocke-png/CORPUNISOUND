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

test("actualizarProducto: rechaza guardar si los 4 niveles llegan en $0.00 y el producto ya tenía precio (guardia contra el bug original)", () => {
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

  assert.throws(
    () => actualizarProducto(DB, 100, datos, 1),
    /\$0\.00/,
    "debe rechazar guardar un producto que ya tenía precio si los 4 niveles llegan en $0.00 — es la señal del bug original (campos vacíos), no una decisión real del usuario"
  );
  const sinCambios = DB["catalogo-productos"].productos.find((p) => p.id === 100);
  assert.strictEqual(sinCambios.precio_venta, 25, "el producto no debe quedar modificado si se rechazó el guardado");
});

test("actualizarProducto: permite un precio bajo pero no cero (ej. producto en $0.01) sin bloquear", () => {
  const DB = construirDBPrueba();
  DB["catalogo-productos"].productos.push({
    id: 101, sku: "LEGACY-03", nombre: "Producto legacy 3", categoria_id: null,
    departamento_id: null, proveedor_id: null, unidad_compra: "PZA", unidad_venta: "PZA",
    factor: 1, iva: true, costo: 18, neto: true, unidad_medida: "pza",
    unidades_por_mayoreo: 0, ubicacion: "-", clave_sat: "", localizacion: "",
    promocion: false, imagen_url: "", activo: true, precio_venta: 25,
  });

  const datos = {
    descripcion: "Producto legacy 3",
    precio_compra: 18,
    precios: [
      { utilidad: 0.01, precioVenta: 0.01 },
      { utilidad: 0, precioVenta: 0 },
      { utilidad: 0, precioVenta: 0 },
      { utilidad: 0, precioVenta: 0 },
    ],
  };

  const actualizado = actualizarProducto(DB, 101, datos, 1);
  assert.strictEqual(actualizado.precio_venta, 0.01, "un precio bajo pero distinto de cero en al menos un nivel no debe bloquearse");
});

test("actualizarProducto: no bloquea un producto que ya estaba en $0.00 (no hay nada que proteger)", () => {
  const DB = construirDBPrueba();
  DB["catalogo-productos"].productos.push({
    id: 102, sku: "LEGACY-04", nombre: "Producto ya en cero", categoria_id: null,
    departamento_id: null, proveedor_id: null, unidad_compra: "PZA", unidad_venta: "PZA",
    factor: 1, iva: true, costo: 18, neto: true, unidad_medida: "pza",
    unidades_por_mayoreo: 0, ubicacion: "-", clave_sat: "", localizacion: "",
    promocion: false, imagen_url: "", activo: true, precio_venta: 0,
  });

  const datos = {
    descripcion: "Producto ya en cero (renombrado)",
    precio_compra: 18,
    precios: [
      { utilidad: 0, precioVenta: 0 },
      { utilidad: 0, precioVenta: 0 },
      { utilidad: 0, precioVenta: 0 },
      { utilidad: 0, precioVenta: 0 },
    ],
  };

  const actualizado = actualizarProducto(DB, 102, datos, 1);
  assert.strictEqual(actualizado.precio_venta, 0, "si el producto ya estaba en $0.00, no hay valor previo que proteger — debe permitirse guardar");
});
