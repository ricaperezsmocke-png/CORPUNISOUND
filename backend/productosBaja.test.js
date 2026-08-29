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
  listarProductos, crearProducto, eliminarProducto, reactivarProducto, rastroHistorico,
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

// ---------------------------------------------------------------------------
// Rastro que NO son documentos con folio: historial importado, la bitácora de
// inventario, el Radar y la mercancía que sigue en el anaquel. Ninguno de
// éstos imprime un ticket, pero borrar el producto los deja huérfanos —
// apuntando a un `producto_id` que ya no existe y sin manera de recuperar el
// nombre.
// ---------------------------------------------------------------------------

test("el HISTORIAL DE VENTAS importado de SICAR retiene el producto", () => {
  const DB = construirDBPrueba();
  const id = conProductoLimpio(DB);
  DB.pos.historial_ventas_mensual.push({ producto_id: id, sucursal_id: 1, periodo: "2025-03", cantidad: 12 });

  assert.strictEqual(
    eliminarProducto(DB, id).desactivado, true,
    "son años de venta real y además alimentan las predicciones de demanda"
  );
  assert.match(rastroHistorico(DB, id).map((r) => r.tipo).join(), /historial de ventas/);
});

test("un MOVIMIENTO DE INVENTARIO retiene el producto", () => {
  const DB = construirDBPrueba();
  const id = conProductoLimpio(DB);
  DB.inventario.movimientos_inventario.push({
    id: 1, producto_id: id, sucursal_id: 1, fecha: "2026-08-01T10:00:00.000Z",
    tipo: "salida", cantidad: -2, referencia_documento: "Merma",
  });

  assert.strictEqual(
    eliminarProducto(DB, id).desactivado, true,
    "la bitácora de entradas y salidas es historial: sin el producto queda un renglón sin nombre"
  );
});

test("una consulta del RADAR DE DEMANDA retiene el producto", () => {
  const DB = construirDBPrueba();
  const id = conProductoLimpio(DB);
  // testHelpers no arma `DB.radar_demanda`; se agrega como lo haría el server real.
  DB.radar_demanda = { registros: [{ id: 1, producto_id: id, sucursal_id: 1, cliente_id: 1 }] };

  assert.strictEqual(
    eliminarProducto(DB, id).desactivado, true,
    "es la constancia de que un cliente preguntó por ese producto"
  );
});

test("EXISTENCIA en el anaquel retiene el producto aunque no tenga ningún documento", () => {
  const DB = construirDBPrueba();
  const id = conProductoLimpio(DB);
  // `crearProducto` guarda la existencia_inicial SIN generar movimiento: un
  // producto capturado con mercancía y nunca vendido no tiene otra huella.
  DB.inventario.existencias.push({ producto_id: id, sucursal_id: 1, cantidad_actual: 12, cantidad_minima: 0, cantidad_maxima: 0 });

  assert.strictEqual(
    eliminarProducto(DB, id).desactivado, true,
    "borrarlo tiraría 12 piezas reales del conteo de inventario"
  );
  assert.match(rastroHistorico(DB, id).map((r) => r.tipo).join(), /existencia/);
});

test("una existencia NEGATIVA también retiene: es un descuadre que hay que poder ver", () => {
  const DB = construirDBPrueba();
  const id = conProductoLimpio(DB);
  DB.inventario.existencias.push({ producto_id: id, sucursal_id: 2, cantidad_actual: -3, cantidad_minima: 0, cantidad_maxima: 0 });

  assert.strictEqual(eliminarProducto(DB, id).desactivado, true);
});

test("sin DB.radar_demanda (bases anteriores al Radar) no revienta", () => {
  const DB = construirDBPrueba();
  const id = conProductoLimpio(DB);
  assert.doesNotThrow(() => eliminarProducto(DB, id));
});

test("una TAREA del Gerente de Ventas retiene el producto", () => {
  const DB = construirDBPrueba();
  const id = conProductoLimpio(DB);
  DB.pos.tareas_venta = {
    tareas: [{
      id: 1, vendedor_id: 1, tipo: "empujar_producto", descripcion: "Empuja el Producto 9",
      cliente_id: null, producto_id: id, estado: "pendiente", origen: "motor",
    }],
    ultimo_id: 1,
  };

  assert.strictEqual(eliminarProducto(DB, id).desactivado, true, "la tarea quedaría apuntando a un producto que ya no existe");
});

test("un producto_id guardado como TEXTO también retiene: el guard no puede fallar abriendo", () => {
  const DB = construirDBPrueba();
  const id = conProductoLimpio(DB);
  // `ventas.js` y `apartados.js` guardan `producto_id` crudo del cuerpo HTTP:
  // un cliente que mande "9" en vez de 9 deja un texto guardado para siempre.
  DB.pos.ventas.push({ id: 60, fecha: "2026-08-01", sucursal_id: 1, cliente_id: 1, total: 100, tipo_documento: "Ticket" });
  DB.pos.venta_detalle.push({ id: 60, venta_id: 60, producto_id: String(id), cantidad: 1, precio_unitario: 100, subtotal: 100 });

  assert.strictEqual(
    eliminarProducto(DB, id).desactivado, true,
    "con comparación estricta ese renglón no contaba y el producto se borraba con una venta encima"
  );
});

test("el alta recién capturada por el sistema real, con existencia 0, SÍ se puede borrar", () => {
  const DB = construirDBPrueba();
  // Pasa por `crearProducto` de verdad, que siembra una fila de existencia en
  // TODAS las sucursales: si algún día sembrara también un movimiento de alta,
  // ningún producto nuevo podría volver a borrarse y nadie se enteraría.
  const nuevo = crearProducto(DB, { descripcion: "Alta con la clave mal escrita", existencia_inicial: 0 }, 1);

  assert.strictEqual(
    eliminarProducto(DB, nuevo.id).desactivado, false,
    "corregir un alta mal capturada es justo el caso que justifica que el borrado duro exista"
  );
});

test("al borrar de verdad se va también la existencia guardada con producto_id de texto", () => {
  const DB = construirDBPrueba();
  const id = conProductoLimpio(DB);
  DB.inventario.existencias.push({ producto_id: String(id), sucursal_id: 1, cantidad_actual: 0, cantidad_minima: 0, cantidad_maxima: 0 });

  eliminarProducto(DB, id);

  assert.ok(
    !DB.inventario.existencias.some((e) => Number(e.producto_id) === id),
    "si no se limpia queda huérfana, y `siguienteId` reutiliza el id: se colgaría del próximo producto"
  );
});

test("el alta con el campo de existencia VACÍO también se puede borrar", () => {
  const DB = construirDBPrueba();
  // El formulario de Inventario es un <input>: cuando el usuario no escribe
  // nada manda "", no 0. Si `Number("")` no se tratara como cero, ningún alta
  // capturada sin existencia se podría corregir.
  const nuevo = crearProducto(DB, { descripcion: "Sin existencia", existencia_inicial: "" }, 1);

  assert.strictEqual(eliminarProducto(DB, nuevo.id).desactivado, false);
  assert.ok(
    !DB.inventario.existencias.some((e) => Number(e.producto_id) === nuevo.id),
    "crearProducto siembra una fila por sucursal: el borrado tiene que llevárselas todas"
  );
});

test("PERO el alta capturada CON piezas ya no se borra: esa mercancía es un conteo real", () => {
  const DB = construirDBPrueba();
  const nuevo = crearProducto(DB, { descripcion: "Guitarra recién llegada", existencia_inicial: 5 }, 1);

  const resultado = eliminarProducto(DB, nuevo.id);
  assert.strictEqual(resultado.desactivado, true, "es la frontera exacta de la decisión: sin piezas se borra, con piezas se desactiva");
  assert.match(resultado.detalle, /existencia/);
});
