const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { crearProducto, actualizarProducto, clonarProducto, listarProductos, crearDepartamento } = require("./productos");

test("crearProducto con departamento_id resuelve el nombre desde el catálogo", () => {
  const DB = construirDBPrueba();
  const depto = crearDepartamento(DB, "Cuerdas y Accesorios");
  const nuevoId = crearProducto(DB, { descripcion: "Cuerdas de guitarra", departamento_id: depto.id }, 1).id;
  const producto = listarProductos(DB, 1).find((p) => p.id === nuevoId);
  assert.strictEqual(producto.departamento_id, depto.id);
  assert.strictEqual(producto.departamento_nombre, "Cuerdas y Accesorios");
});

test("crearProducto sin departamento_id queda en null y muestra 'Sin definir'", () => {
  const DB = construirDBPrueba();
  const nuevoId = crearProducto(DB, { descripcion: "Producto sin depto" }, 1).id;
  const producto = listarProductos(DB, 1).find((p) => p.id === nuevoId);
  assert.strictEqual(producto.departamento_id, null);
  assert.strictEqual(producto.departamento_nombre, "Sin definir");
});

test("listarProductos cae al texto legado en productos ya existentes sin departamento_id", () => {
  const DB = construirDBPrueba();
  // Simula un producto creado ANTES de este cambio: solo tiene el string `departamento`.
  DB["catalogo-productos"].productos.push({
    id: 999, sku: "LEGADO-1", nombre: "Producto legado", categoria_id: null,
    departamento: "Ferretería", proveedor_id: null, precio_venta: 10, costo: 5,
    precios: [], activo: true,
  });
  const producto = listarProductos(DB, 1).find((p) => p.id === 999);
  assert.strictEqual(producto.departamento_nombre, "Ferretería");
});

test("actualizarProducto cambia departamento_id", () => {
  const DB = construirDBPrueba();
  const depto = crearDepartamento(DB, "Percusiones");
  const nuevoId = crearProducto(DB, { descripcion: "Batería", departamento_id: null }, 1).id;
  actualizarProducto(DB, nuevoId, { departamento_id: depto.id }, 1);
  const producto = listarProductos(DB, 1).find((p) => p.id === nuevoId);
  assert.strictEqual(producto.departamento_nombre, "Percusiones");
});

test("clonarProducto propaga el departamento_id del original", () => {
  const DB = construirDBPrueba();
  const depto = crearDepartamento(DB, "Vientos");
  const originalId = crearProducto(DB, { descripcion: "Trompeta", departamento_id: depto.id }, 1).id;
  const clon = clonarProducto(DB, originalId, 1);
  assert.strictEqual(clon.departamento_id, depto.id);
});
