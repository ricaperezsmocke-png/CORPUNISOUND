/**
 * radarComprasReposicion.test.js — La pantalla de Inteligencia para Compras
 * solo veía lo que alguien había escrito a mano en el Radar de Demanda.
 *
 * EL DEFECTO: `obtenerEvidenciaCompras` arma un expediente por cada par
 * producto/sucursal que aparece en `radar_demanda.registros`, y nada más. Las
 * ventas, las existencias y los mínimos ENRIQUECEN esos expedientes, pero no
 * crean ninguno. Un producto que se agotó, que tiene mínimo configurado y que
 * se vende bien NO aparece en Compras si a nadie se le ocurrió capturar una
 * demanda — que es justamente lo que pasa con la reposición normal de la
 * tienda: nadie levanta una "demanda" por algo que siempre se ha tenido.
 *
 * QUÉ LE CUESTA A VICTOR: la pantalla que debería decirle qué comprar le
 * esconde el caso más común del negocio, y le muestra en cambio solo lo
 * excepcional. Decide sobre una lista incompleta sin saber que lo es.
 *
 * LA REGLA: un par producto/sucursal entra a Compras cuando hay faltante
 * —agotado o por debajo de su mínimo— Y hay respaldo comercial de que ese
 * producto se mueve: ventas recientes o una demanda registrada. El Radar
 * sigue sin inventar nada: no crea demandas, no toca catálogo ni inventario,
 * solo deja de esconder un producto que el propio inventario ya señala.
 *
 * LO QUE NO DEBE PASAR: que la pantalla se llene de catálogo muerto. Un
 * producto agotado que no vende nada y que nadie ha pedido NO entra; un
 * producto con existencia suficiente tampoco.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { obtenerEvidenciaCompras } = require("./radarDemandaInteligencia");
const { clasificarEvidenciaCompra } = require("./radarDemandaReglas");

const FIN = "2026-08-20";
const global = { verTodas: true };
const soloSucursal1 = { verTodas: false, sucursalId: 1 };

/** Base SIN una sola demanda capturada: ese es el punto de estas pruebas. */
function base() {
  return {
    pos: {
      sucursales: [{ id: 1, nombre: "Ocosingo" }, { id: 2, nombre: "Palenque" }],
      ventas: [], venta_detalle: [],
    },
    inventario: { existencias: [], compras: [], compra_detalle: [], traspasos: [] },
    "catalogo-productos": {
      productos: [{ id: 10, sku: "CUERDA-01", nombre: "Cuerdas para guitarra", proveedor_id: 1, activo: true }],
      proveedores: [{ id: 1, nombre: "Proveedor" }],
    },
    radar_demanda: { registros: [], seguimientos: [], ultimo_id: 0 },
  };
}

function conVentas(DB, { productoId = 10, sucursalId = 1, unidades = 10 } = {}) {
  const id = DB.pos.ventas.length + 1;
  DB.pos.ventas.push({ id, fecha: FIN, sucursal_id: sucursalId, estatus: "cerrada" });
  DB.pos.venta_detalle.push({ id, venta_id: id, producto_id: productoId, cantidad: unidades });
  return DB;
}

function conExistencia(DB, { productoId = 10, sucursalId = 1, actual = 0, minima = 5 } = {}) {
  DB.inventario.existencias.push({
    producto_id: productoId, sucursal_id: sucursalId,
    cantidad_actual: actual, cantidad_minima: minima, cantidad_maxima: 0,
  });
  return DB;
}

function ejecutar(DB, alcance = global) {
  return obtenerEvidenciaCompras(DB, alcance, { fecha_fin: FIN });
}

function expedienteDe(resultado, productoId, sucursalId) {
  return resultado.productos.find(
    (p) => p.producto.producto_id === productoId && p.sucursal.sucursal_id === sucursalId
  );
}

test("un producto AGOTADO que se vende y tiene mínimo aparece en Compras aunque nadie capturó demanda", () => {
  const DB = conExistencia(conVentas(base()), { actual: 0, minima: 5 });
  const resultado = ejecutar(DB);
  const exp = expedienteDe(resultado, 10, 1);
  assert.ok(exp, "el producto agotado que se vende tiene que llegar a la pantalla de Compras");
  assert.equal(exp.inventario.cantidad_actual, 0);
  assert.equal(exp.inventario.cantidad_minima, 5);
  assert.equal(exp.ventas.unidades_30d, 10);
  // No se inventa demanda: el Radar sigue diciendo la verdad, que es cero.
  assert.equal(exp.radar["30d"].solicitudes, 0);
  assert.equal(exp.radar["180d"].solicitudes, 0);
});

test("ese expediente se clasifica como REVISAR_COMPRA, que es lo que Victor necesita ver", () => {
  const DB = conExistencia(conVentas(base()), { actual: 0, minima: 5 });
  const exp = expedienteDe(ejecutar(DB), 10, 1);
  const fallo = clasificarEvidenciaCompra(exp);
  assert.equal(fallo.clasificacion, "REVISAR_COMPRA");
  assert.ok(fallo.razones.includes("STOCK_LOCAL_CERO"), "la razón visible es que está agotado");
  assert.ok(fallo.razones.includes("VENTAS_RECIENTES"), "y que sí se vende");
});

test("un producto BAJO SU MÍNIMO también entra, no hace falta que llegue a cero", () => {
  const DB = conExistencia(conVentas(base()), { actual: 2, minima: 5 });
  const exp = expedienteDe(ejecutar(DB), 10, 1);
  assert.ok(exp, "por debajo del mínimo ya es faltante");
  assert.equal(clasificarEvidenciaCompra(exp).clasificacion, "REVISAR_COMPRA");
});

test("un producto con existencia SUFICIENTE no aparece: la pantalla no se llena de ruido", () => {
  const DB = conExistencia(conVentas(base()), { actual: 20, minima: 5 });
  assert.equal(expedienteDe(ejecutar(DB), 10, 1), undefined);
});

test("un producto agotado que NO vende ni nadie pidió tampoco aparece: no es catálogo muerto", () => {
  const DB = conExistencia(base(), { actual: 0, minima: 5 });
  assert.equal(expedienteDe(ejecutar(DB), 10, 1), undefined);
});

test("una venta CANCELADA no basta para traer un producto a Compras", () => {
  const DB = conExistencia(base(), { actual: 0, minima: 5 });
  DB.pos.ventas.push({ id: 1, fecha: FIN, sucursal_id: 1, estatus: "cancelada" });
  DB.pos.venta_detalle.push({ id: 1, venta_id: 1, producto_id: 10, cantidad: 10 });
  assert.equal(expedienteDe(ejecutar(DB), 10, 1), undefined);
});

test("el alcance se respeta: una tienda no ve el faltante de la otra", () => {
  const DB = base();
  conVentas(DB, { sucursalId: 2 });
  conExistencia(DB, { sucursalId: 2, actual: 0, minima: 5 });
  assert.ok(expedienteDe(ejecutar(DB, global), 10, 2), "quien ve todas sí lo ve");
  assert.equal(expedienteDe(ejecutar(DB, soloSucursal1), 10, 2), undefined);
});

test("un producto sin fila de existencia no se inventa una", () => {
  const DB = conVentas(base());
  assert.equal(expedienteDe(ejecutar(DB), 10, 1), undefined);
});

test("si además hay demanda capturada, no se duplica el expediente", () => {
  const DB = conExistencia(conVentas(base()), { actual: 0, minima: 5 });
  DB.radar_demanda.registros.push({
    id: 1, sucursal_id: 1, producto_id: 10, cantidad: 1, estado: "REGISTRADA",
    fecha_registro: `${FIN}T12:00:00Z`, motivo_no_venta: "SIN_EXISTENCIA",
  });
  const resultado = ejecutar(DB);
  const suyos = resultado.productos.filter(
    (p) => p.producto.producto_id === 10 && p.sucursal.sucursal_id === 1
  );
  assert.equal(suyos.length, 1, "un solo expediente por producto y tienda");
  assert.equal(suyos[0].radar["30d"].solicitudes, 1, "y conserva la demanda que sí existía");
});
