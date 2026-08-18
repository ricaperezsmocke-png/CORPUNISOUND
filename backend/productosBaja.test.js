/**
 * productosBaja.test.js — Dar de baja un producto sin destruir los documentos
 * donde aparece.
 *
 * El defecto que motivó estas pruebas: `eliminarProducto` borraba el renglón
 * del catálogo, y como `obtenerVentaDetalle` resuelve el nombre del producto
 * contra ese catálogo, el ticket de una venta vieja pasaba a decir
 * literalmente "Producto". Comprobado con una venta de guitarra: el nombre no
 * se recuperaba de ningún lado porque el Punto de Venta no guarda
 * `descripcion` en los renglones que salen del catálogo.
 */

const test = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const {
  listarProductos, eliminarProducto, reactivarProducto, rastroHistorico,
} = require("./productos");
const { obtenerVentaDetalle } = require("./ventas");

/** Venta real (id 1) del DB de prueba: su renglón apunta al producto 1. */
function conNombreDeProducto(DB, id, nombre) {
  DB["catalogo-productos"].productos.find((p) => p.id === id).nombre = nombre;
}

test("borrar un producto que ya se vendió NO borra el nombre del ticket: lo desactiva", () => {
  const DB = construirDBPrueba();
  conNombreDeProducto(DB, 1, "Guitarra Fender Stratocaster");

  const resultado = eliminarProducto(DB, 1);

  assert.strictEqual(resultado.desactivado, true, "un producto con ventas se desactiva, no se borra");
  assert.ok(
    DB["catalogo-productos"].productos.some((p) => p.id === 1),
    "el renglón del catálogo tiene que seguir existiendo"
  );

  const ticket = obtenerVentaDetalle(DB, 1);
  assert.strictEqual(
    ticket.lineas[0].descripcion,
    "Guitarra Fender Stratocaster",
    'el ticket debe seguir diciendo el nombre real del producto, no "Producto"'
  );
});

test("el aviso dice POR QUÉ no se borró, con las cuentas", () => {
  const DB = construirDBPrueba();
  const resultado = eliminarProducto(DB, 1);
  assert.match(resultado.detalle, /1 ventas/, "debe decirle al usuario qué historial lo está reteniendo");
});

test("un producto SIN historial sí se borra de verdad, junto con sus existencias", () => {
  const DB = construirDBPrueba();
  // Alta recién capturada con la clave mal escrita: no aparece en ningún documento.
  DB["catalogo-productos"].productos.push({ id: 77, sku: "ERROR-01", nombre: "Alta equivocada", activo: true });
  DB.inventario.existencias.push({ producto_id: 77, sucursal_id: 1, cantidad_actual: 0, cantidad_minima: 0, cantidad_maxima: 0 });

  const resultado = eliminarProducto(DB, 77);

  assert.strictEqual(resultado.desactivado, false, "sin historial el borrado real sigue siendo posible");
  assert.ok(!DB["catalogo-productos"].productos.some((p) => p.id === 77), "debe desaparecer del catálogo");
  assert.ok(!DB.inventario.existencias.some((e) => e.producto_id === 77), "y sus existencias con él");
});

test("desactivar NO toca las existencias: la mercancía del anaquel es real", () => {
  const DB = construirDBPrueba();
  const antes = DB.inventario.existencias.find((e) => e.producto_id === 1 && e.sucursal_id === 1).cantidad_actual;

  eliminarProducto(DB, 1);

  const despues = DB.inventario.existencias.find((e) => e.producto_id === 1 && e.sucursal_id === 1);
  assert.ok(despues, "el registro de existencia no se borra al desactivar");
  assert.strictEqual(despues.cantidad_actual, antes, "y la cantidad no cambia");
});

test("un producto desactivado deja de ofrecerse: no sale en el catálogo por default", () => {
  const DB = construirDBPrueba();
  eliminarProducto(DB, 1);

  const visibles = listarProductos(DB, 1);
  assert.ok(!visibles.some((p) => p.id === 1), "la caja, traspasos y garantías no deben poder elegirlo");
});

test("con incluirInactivos el catálogo sí lo trae, marcado como inactivo", () => {
  const DB = construirDBPrueba();
  eliminarProducto(DB, 1);

  const todos = listarProductos(DB, 1, { incluirInactivos: true });
  const desactivado = todos.find((p) => p.id === 1);
  assert.ok(desactivado, "la casilla 'ver inactivos' tiene que poder encontrarlo para reactivarlo");
  assert.strictEqual(desactivado.activo, false);
});

test("REGLA SICAR: un producto sin el campo `activo` sigue estando activo", () => {
  const DB = construirDBPrueba();
  // Así llegan los productos importados de SICAR: sin el campo.
  DB["catalogo-productos"].productos.push({ id: 88, sku: "SICAR-01", nombre: "Importado de SICAR" });

  const visibles = listarProductos(DB, 1);
  const importado = visibles.find((p) => p.id === 88);
  assert.ok(importado, "filtrar con `=== true` desaparecería todo el catálogo migrado de la caja");
  assert.strictEqual(importado.activo, true, "y se normaliza a booleano para que el catálogo no lo pinte gris");
});

test("reactivar devuelve el producto a la caja", () => {
  const DB = construirDBPrueba();
  eliminarProducto(DB, 1);
  reactivarProducto(DB, 1);

  assert.ok(listarProductos(DB, 1).some((p) => p.id === 1), "tras reactivar vuelve a poder venderse");
});

test("reactivar un producto que no existe avisa en vez de fallar en silencio", () => {
  const DB = construirDBPrueba();
  assert.throws(() => reactivarProducto(DB, 4242), /no encontrado/i);
});

// ---------------------------------------------------------------------------
// Cada tipo de documento, por separado: si uno solo deja de contar como
// historial, ese producto se vuelve borrable y rompe justo esa pantalla.
// ---------------------------------------------------------------------------

/** Producto 9: limpio, sin ningún documento, para colgarle uno a la vez. */
function conProductoLimpio(DB) {
  DB["catalogo-productos"].productos.push({ id: 9, sku: "X-9", nombre: "Producto 9", activo: true });
  return 9;
}

test("una COMPRA recibida retiene el producto", () => {
  const DB = construirDBPrueba();
  const id = conProductoLimpio(DB);
  DB.inventario.compra_detalle.push({ id: 1, compra_id: 1, producto_id: id, cantidad: 5 });

  assert.strictEqual(eliminarProducto(DB, id).desactivado, true);
  assert.match(rastroHistorico(DB, id).map((r) => r.tipo).join(), /compras/);
});

test("un TRASPASO retiene el producto", () => {
  const DB = construirDBPrueba();
  const id = conProductoLimpio(DB);
  DB.inventario.traspasos.push({ id: 1, producto_id: id, sucursal_origen_id: 1, sucursal_destino_id: 2, cantidad: 3 });

  assert.strictEqual(eliminarProducto(DB, id).desactivado, true);
});

test("una GARANTÍA retiene el producto", () => {
  const DB = construirDBPrueba();
  const id = conProductoLimpio(DB);
  DB.inventario.garantias.push({ id: 1, producto_id: id, sucursal_id: 1, estatus: "en_tienda" });

  assert.strictEqual(eliminarProducto(DB, id).desactivado, true);
});

test("una PUBLICACIÓN de MercadoLibre retiene el producto", () => {
  const DB = construirDBPrueba();
  const id = conProductoLimpio(DB);
  // testHelpers no arma `DB.ml`; se agrega como lo haría el server real.
  DB.ml = { cuenta: null, publicaciones: [{ ml_item_id: "MLM1", producto_id: id, titulo: "Producto 9" }], ordenes_importadas: [] };

  assert.strictEqual(eliminarProducto(DB, id).desactivado, true);
});

test("un APARTADO retiene el producto, y se nombra como apartado y no como venta", () => {
  const DB = construirDBPrueba();
  const id = conProductoLimpio(DB);
  DB.pos.ventas.push({ id: 50, fecha: "2026-07-01", sucursal_id: 1, cliente_id: 1, total: 500, tipo_documento: "Apartado", estatus: "apartado" });
  DB.pos.venta_detalle.push({ id: 50, venta_id: 50, producto_id: id, cantidad: 1, precio_unitario: 500, descuento: 0, subtotal: 500 });

  const resultado = eliminarProducto(DB, id);
  assert.strictEqual(resultado.desactivado, true);
  assert.match(resultado.detalle, /apartados/, "un apartado no es una venta: el aviso debe distinguirlos");
});

test("sin DB.ml (bases anteriores a MercadoLibre) no revienta", () => {
  const DB = construirDBPrueba();
  const id = conProductoLimpio(DB);
  assert.doesNotThrow(() => eliminarProducto(DB, id));
});
