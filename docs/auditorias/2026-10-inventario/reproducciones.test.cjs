/**
 * Reproducciones de la auditoria de inventario 2026-10.
 *
 * Cada prueba DOCUMENTA UN DEFECTO TAL COMO ESTA HOY: pasa (verde) mientras el
 * defecto exista. El dia que se cierre, la prueba correspondiente se pone roja,
 * y eso es lo esperado: se borra o se invierte junto con el arreglo.
 *
 * No toca codigo de la aplicacion. Se corre desde backend/ para que resuelva
 * sus node_modules:
 *
 *   cd backend && node --test ../docs/auditorias/2026-10-inventario/reproducciones.test.cjs
 */
const { test } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

const B = path.join(__dirname, "..", "..", "..", "backend");
const { construirDBPrueba } = require(path.join(B, "testHelpers"));
const { sembrarCajas } = require(path.join(B, "cajas"));
const { crearVenta, cancelarVenta } = require(path.join(B, "ventas"));
const { crearTraspaso, recibirTraspaso } = require(path.join(B, "traspasos"));
const { crearRecepcion } = require(path.join(B, "compras"));
const { crearGarantia, marcarEnviada, registrarResolucion, recibirEnTienda, entregarACliente } = require(path.join(B, "garantias"));
const { ajusteManualExistencia, crearProducto, listarProductos } = require(path.join(B, "productos"));
const { aplicarImportacion } = require(path.join(B, "migracion"));
const ml = require(path.join(B, "mercadolibre"));

function prepararDB() {
  const DB = construirDBPrueba();
  DB.pos.ventas = [];
  DB.pos.venta_detalle = [];
  DB.pos.cortes_caja = [];
  DB.pos.apartado_abonos = [];
  DB.pos.cajas = [];
  sembrarCajas(DB);
  DB.ml = {
    cuenta: { access_token: "x", expires_at: Date.now() + 3600_000, user_id: 1 },
    publicaciones: [], ordenes_importadas: [], pendientes_vinculo: [],
  };
  DB["catalogo-productos"].proveedores.push({ id: 1, nombre: "Proveedor" });
  return DB;
}

const existencia = (DB, producto_id, sucursal_id) =>
  DB.inventario.existencias.filter((e) => e.producto_id === producto_id && e.sucursal_id === sucursal_id)
    .reduce((s, e) => s + e.cantidad_actual, 0);
const movimientosDe = (DB, producto_id, sucursal_id) =>
  DB.inventario.movimientos_inventario.filter((m) => m.producto_id === producto_id && m.sucursal_id === sucursal_id);
const ADMIN = { id: 1, nombre: "Admin" };
const CAJERA = { id: 7, nombre: "Cajera Palenque" };

function conFetchFalso(respuesta, fn) {
  const original = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => respuesta });
  return Promise.resolve(fn()).finally(() => { global.fetch = original; });
}

// H1 ---------------------------------------------------------------------------
test("H1 publicar en ML SOBREESCRIBE la existencia de la sucursal 5 sin movimiento ni usuario", async () => {
  const DB = prepararDB();
  // CEDIS manda 10 piezas a MercadoLibre por traspaso y ML las recibe.
  DB.inventario.existencias.push({ producto_id: 1, sucursal_id: 6, cantidad_actual: 10, cantidad_minima: 0, cantidad_maxima: 0 });
  const t = crearTraspaso(DB, { producto_id: 1, cantidad: 10, sucursal_destino_id: 5 }, 6, ADMIN);
  recibirTraspaso(DB, t.id, {}, 5, ADMIN);
  assert.strictEqual(existencia(DB, 1, 5), 10);
  const movsAntes = movimientosDe(DB, 1, 5).length;

  // Alguien publica el producto en ML con "cantidad: 1".
  const item = { id: "MLM1", title: "Arroz", price: 25, available_quantity: 1, status: "active", permalink: "" };
  await conFetchFalso(item, () => ml.publicarProducto(DB, 1, { cantidad: 1, categoria_ml: "X" }));
  assert.strictEqual(existencia(DB, 1, 5), 1, "9 piezas desaparecen de la existencia de ML");
  assert.strictEqual(movimientosDe(DB, 1, 5).length, movsAntes, "y no queda ningun movimiento que lo explique");

  // Y al reves: publicar con 50 inventa 49 piezas de la nada.
  await conFetchFalso({ ...item, available_quantity: 50 }, () => ml.publicarProducto(DB, 1, { cantidad: 50 }));
  assert.strictEqual(existencia(DB, 1, 5), 50);
  assert.strictEqual(movimientosDe(DB, 1, 5).length, movsAntes);
});

// H2 ---------------------------------------------------------------------------
test("H2 garantia con un cliente cualquiera (aun inexistente) saca stock propio sin bajar la existencia", () => {
  const DB = prepararDB();
  const antes = existencia(DB, 3, 3); // 60 piezas en San Cristobal
  // cliente_id 999 no existe; venta_id 12345 tampoco. Nada se valida.
  const g = crearGarantia(DB, { producto_id: 3, cliente_id: 999, venta_id: 12345 }, 3, CAJERA);
  marcarEnviada(DB, g.id, { destino_nombre: "Proveedor" }, CAJERA, { verTodas: true });
  registrarResolucion(DB, g.id, { tipo_resolucion: "reemplazo" }, CAJERA, { verTodas: true });
  recibirEnTienda(DB, g.id, CAJERA, { verTodas: true });
  entregarACliente(DB, g.id, CAJERA, { verTodas: true });
  assert.strictEqual(g.estado, "cerrada");
  assert.strictEqual(existencia(DB, 3, 3), antes, "la pieza salio de la tienda y la existencia no se movio");
  assert.strictEqual(movimientosDe(DB, 3, 3).length, 0, "ni un solo movimiento de inventario");
});

// H3 ---------------------------------------------------------------------------
test("H3 la Migracion fija existencias absolutas firmadas 'Importacion SICAR', sin quien subio el archivo", () => {
  const DB = prepararDB();
  // Ocosingo tiene 120 de Arroz. Se importa un Excel viejo que dice 80.
  const r = aplicarImportacion(DB, "articulos", [{ numero_fila: 2, clave: "AB-001", existencia: "80" }], 1, {}, "cualquier-nombre.xlsx");
  assert.strictEqual(r.actualizados, 1);
  assert.strictEqual(existencia(DB, 1, 1), 80, "40 piezas menos en el sistema, la encargada carga el faltante");
  const m = movimientosDe(DB, 1, 1).at(-1);
  assert.strictEqual(m.cantidad, -40);
  assert.strictEqual(m.usuario, "Importación SICAR");
  assert.match(m.referencia_documento, /cualquier-nombre\.xlsx/, "el nombre del archivo lo pone quien manda la peticion");
  // Tambien acepta existencia negativa.
  aplicarImportacion(DB, "articulos", [{ numero_fila: 3, clave: "AB-001", existencia: "-5" }], 1, {}, "x");
  assert.strictEqual(existencia(DB, 1, 1), -5);
});

// H4 ---------------------------------------------------------------------------
test("H4 la misma recepcion de compra se registra dos veces y la existencia sube dos veces", () => {
  const DB = prepararDB();
  const datos = { proveedor_id: 1, factura: "A-100", renglones: [{ producto_id: 2, cantidad: 30, costo: 12 }] };
  crearRecepcion(DB, datos, 6, ADMIN);
  crearRecepcion(DB, datos, 6, ADMIN); // misma factura, mismo proveedor
  assert.strictEqual(existencia(DB, 2, 6), 60);
  // El folio fiscal se compara letra por letra: en mayusculas y en minusculas son "distintos".
  const uuid = "6f1c2a10-0b1e-4c8e-9d3a-1a2b3c4d5e6f";
  crearRecepcion(DB, { ...datos, uuid_cfdi: uuid }, 6, ADMIN);
  crearRecepcion(DB, { ...datos, uuid_cfdi: uuid.toUpperCase() }, 6, ADMIN);
  crearRecepcion(DB, { ...datos, uuid_cfdi: ` ${uuid}` }, 6, ADMIN);
  assert.strictEqual(existencia(DB, 2, 6), 150, "la misma factura entro 5 veces: 150 piezas por 30 recibidas");
});

// H5 ---------------------------------------------------------------------------
test("H5 traspaso: el destino solo puede confirmar la cantidad completa aunque llegue menos", () => {
  const DB = prepararDB();
  const t = crearTraspaso(DB, { producto_id: 1, cantidad: 5, sucursal_destino_id: 2 }, 1, ADMIN);
  // Llegan 4. La unica forma de recibir es confirmar 5 y anotar un comentario.
  recibirTraspaso(DB, t.id, { cantidad: 4, comentario: "llegaron 4" }, 2, CAJERA);
  assert.strictEqual(existencia(DB, 1, 2), 5, "Yajalon queda con 5 en sistema y 4 en el anaquel: faltante de 1 a su cargo");
});

test("H10 traspaso a una sucursal que no existe: sale del origen y no llega a ninguna tienda", () => {
  const DB = prepararDB();
  const t = crearTraspaso(DB, { producto_id: 1, cantidad: 7, sucursal_destino_id: 99 }, 1, ADMIN);
  assert.strictEqual(existencia(DB, 1, 1), 113);
  assert.strictEqual(t.estatus, "en_transito");
  // Un usuario global "recibe" en nombre del destino real (99): la ruta lo permite.
  recibirTraspaso(DB, t.id, {}, t.sucursal_destino_id, ADMIN);
  assert.strictEqual(existencia(DB, 1, 99), 7, "las 7 piezas viven en una sucursal fantasma");
});

// H8 ---------------------------------------------------------------------------
test("H8 venta ML cancelada y despues 'vinculada': descuenta piezas de una venta que ya no existe", () => {
  const DB = prepararDB();
  DB.inventario.existencias.push({ producto_id: 1, sucursal_id: 5, cantidad_actual: 3, cantidad_minima: 0, cantidad_maxima: 0 });
  // Venta ML importada con un renglon sin vincular (simula lo que deja importarOrdenComoVenta).
  DB.pos.ventas.push({ id: 50, fecha: "2026-10-01", fecha_hora: "2026-10-01T10:00:00Z", sucursal_id: 5, cliente_id: 0,
    tipo_documento: "Ticket", metodo_pago: "mercadolibre", total: 25, estatus: "cerrada" });
  DB.pos.venta_detalle.push({ id: 1, venta_id: 50, producto_id: null, ml_item_id: "MLM9", cantidad: 1, precio_unitario: 25, subtotal: 25 });
  ml.registrarPendientesDeVinculo(DB, { ordenId: "777", ventaId: 50, sinVincular: [{ sku: "ZZ", ml_item_id: "MLM9", cantidad: 1 }] });
  // El comprador devuelve; se cancela la venta. El renglon sin producto no reintegra nada (correcto).
  cancelarVenta(DB, 50, "devolucion ML", ADMIN, { id: 2, nombre: "Gerente" });
  assert.strictEqual(existencia(DB, 1, 5), 3);
  // Dias despues alguien resuelve el pendiente, que sigue en la lista.
  ml.resolverPendienteVinculo(DB, 1, 1, ADMIN);
  assert.strictEqual(existencia(DB, 1, 5), 2, "baja 1 pieza por una venta cancelada: faltante inventado");
});

// H9 ---------------------------------------------------------------------------
test("H9 ML: un SKU numerico se confunde con el id de otro producto", () => {
  const DB = prepararDB();
  // El producto 3 tiene clave "2" (claves numericas, comunes en SICAR). El producto 2 tiene clave "BE-001".
  DB["catalogo-productos"].productos.find((p) => p.id === 3).sku = "2";
  const orden = { order_items: [{ item: { id: "MLM5", seller_sku: "2", title: "Detergente" }, quantity: 1, unit_price: 32 }] };
  const { lineas } = ml.mapearLineasDeOrden(DB, orden);
  assert.strictEqual(lineas[0].producto_id, 2, "se descontaria Refresco (id 2) en vez de Detergente (clave 2)");
});

// H11 ---------------------------------------------------------------------------
test("H11 ajuste a un producto que no existe crea existencia que hereda el siguiente producto dado de alta", () => {
  const DB = prepararDB();
  ajusteManualExistencia(DB, 4, { cantidad: 50, sucursal_id: 1, usuario: ADMIN, motivo: "Venta — folio 1" });
  const nuevo = crearProducto(DB, { descripcion: "Guitarra nueva", existencia_inicial: 0 }, 1, ADMIN);
  assert.strictEqual(nuevo.id, 4);
  const vista = listarProductos(DB, 1).find((p) => p.id === 4);
  assert.strictEqual(vista.existencia, 50, "la guitarra recien dada de alta aparece con 50 piezas en Ocosingo");
  assert.strictEqual(movimientosDe(DB, 4, 1)[0].referencia_documento, "Venta — folio 1", "y el motivo lo escribe quien ajusta");
});

// H7 --------------------------------------------------------------------------
test("H7 mercancia real vendida como articulo rapido: se cobra y la existencia no baja", () => {
  const DB = prepararDB();
  const v = crearVenta(DB, { sucursal_id: 1, lineas: [{ descripcion: "Arroz 1kg", cantidad: 5, precio_unitario: 25 }] },
    { permisos: ["agregar_articulo_rapido"], usuario: CAJERA });
  assert.strictEqual(v.total, 117.5, "se cobra (con el 6% de efectivo)");
  assert.strictEqual(existencia(DB, 1, 1), 120, "las 5 piezas salen y el sistema sigue diciendo 120");
  assert.strictEqual(movimientosDe(DB, 1, 1).length, 0);
});

// Comprobaciones de lo que SI esta bien (para no volver a revisarlo) -------------
// H6 ---------------------------------------------------------------------------
test("H6 de fabrica la validacion de existencia esta APAGADA: se vende lo que no hay", () => {
  const DB = prepararDB();
  assert.strictEqual(DB.pos.configuracion, null, "base nueva: toma CONFIG_DEFAULT");
  DB.inventario.existencias.find((e) => e.producto_id === 3 && e.sucursal_id === 3).cantidad_actual = 3;
  crearVenta(DB, { sucursal_id: 3, lineas: [{ producto_id: 3, cantidad: 5, precio_unitario: 32 }] }, {});
  assert.strictEqual(DB.pos.configuracion.permitir_ventas_sin_existencia, true);
  assert.strictEqual(existencia(DB, 3, 3), -2);
});

test("OK venta (con la validacion encendida): el mismo producto en dos renglones se valida junto y con id de texto", () => {
  const DB = prepararDB();
  DB.pos.configuracion = { permitir_ventas_sin_existencia: false };
  DB.inventario.existencias.find((e) => e.producto_id === 3 && e.sucursal_id === 3).cantidad_actual = 3;
  assert.throws(() => crearVenta(DB, { sucursal_id: 3, lineas: [
    { producto_id: "3", cantidad: 2, precio_unitario: 32 }, { producto_id: 3, cantidad: 2, precio_unitario: 32 },
  ] }, {}), /existencia suficiente/);
  assert.strictEqual(existencia(DB, 3, 3), 3);
});

test("OK cancelar dos veces no reintegra dos veces; traspaso no se recibe dos veces", () => {
  const DB = prepararDB();
  const v = crearVenta(DB, { sucursal_id: 1, lineas: [{ producto_id: 1, cantidad: 2, precio_unitario: 25 }] }, { usuario: CAJERA });
  cancelarVenta(DB, v.id, "error", CAJERA, { id: 2, nombre: "Gerente" });
  assert.throws(() => cancelarVenta(DB, v.id, "otra", CAJERA, { id: 2, nombre: "Gerente" }), /ya está cancelada/);
  assert.strictEqual(existencia(DB, 1, 1), 120);
  const t = crearTraspaso(DB, { producto_id: 1, cantidad: 1, sucursal_destino_id: 2 }, 1, ADMIN);
  recibirTraspaso(DB, t.id, {}, 2, CAJERA);
  assert.throws(() => recibirTraspaso(DB, t.id, {}, 2, CAJERA), /ya fue recibido/);
  assert.strictEqual(existencia(DB, 1, 2), 1);
});
