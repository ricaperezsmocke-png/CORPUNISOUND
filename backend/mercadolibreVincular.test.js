const { test } = require("node:test");
const assert = require("node:assert");
const { resolverPendienteVinculo } = require("./mercadolibre");

function prepararDBConPendiente() {
  return {
    "catalogo-productos": { productos: [{ id: 7, sku: "GTR-001", nombre: "Guitarra", precio: 12000 }] },
    inventario: { existencias: [{ producto_id: 7, sucursal_id: 5, cantidad_actual: 10 }], movimientos_inventario: [] },
    pos: { ventas: [{ id: 90, sucursal_id: 5 }], venta_detalle: [{ id: 1, venta_id: 90, producto_id: null, cantidad: 2 }] },
    crm: { clientes: [] },
    ml: {
      ordenes_importadas: [555], publicaciones: [],
      pendientes_vinculo: [{ id: 1, orden_id: 555, venta_id: 90, sku: "NO-EXISTE", nombre: "Bajo", cantidad: 2, fecha: "2026-09-12", resuelto: false }],
    },
  };
}

function existenciaDe(DB, productoId) {
  const e = DB.inventario.existencias.find((x) => x.producto_id === productoId && x.sucursal_id === 5);
  return e ? e.cantidad_actual : 0;
}

test("vincular un pendiente descuenta la mercancia y deja rastro de quien fue", () => {
  const DB = prepararDBConPendiente();
  resolverPendienteVinculo(DB, 1, 7, { nombre: "Victor" });
  assert.equal(existenciaDe(DB, 7), 8, "10 - 2 = 8");
  assert.equal(DB.ml.pendientes_vinculo[0].resuelto, true);
  assert.equal(DB.inventario.movimientos_inventario.length, 1, "un ajuste de inventario sin movimiento es un ajuste sin rastro");
});

test("el renglon de la venta queda ligado al producto", () => {
  const DB = prepararDBConPendiente();
  resolverPendienteVinculo(DB, 1, 7, { nombre: "Victor" });
  assert.equal(DB.pos.venta_detalle[0].producto_id, 7, "si el renglon sigue en null, el reporte de utilidad nunca vera esta venta");
});

test("resolver DOS VECES el mismo pendiente no descuenta dos veces", () => {
  const DB = prepararDBConPendiente();
  resolverPendienteVinculo(DB, 1, 7, { nombre: "Victor" });
  assert.throws(() => resolverPendienteVinculo(DB, 1, 7, { nombre: "Victor" }), /ya (fue )?resuelto|resuelto/i);
  assert.equal(existenciaDe(DB, 7), 8, "la existencia no puede bajar dos veces por la misma venta");
});

test("no se puede vincular a un producto que no existe", () => {
  const DB = prepararDBConPendiente();
  assert.throws(() => resolverPendienteVinculo(DB, 1, 999, { nombre: "Victor" }), /producto/i);
  assert.equal(DB.ml.pendientes_vinculo[0].resuelto, false, "si falla, el pendiente sigue abierto");
});

test("un pendiente que no existe da error claro", () => {
  const DB = prepararDBConPendiente();
  assert.throws(() => resolverPendienteVinculo(DB, 404, 7, { nombre: "Victor" }), /pendiente/i);
});

test("si no alcanza la existencia al vincular, no se descuenta y el pendiente sigue abierto", () => {
  const DB = prepararDBConPendiente();
  DB.inventario.existencias[0].cantidad_actual = 1;   // piden 2
  assert.throws(() => resolverPendienteVinculo(DB, 1, 7, { nombre: "Victor" }), /existencia|alcanza/i);
  assert.equal(existenciaDe(DB, 7), 1, "no se toco");
  assert.equal(DB.ml.pendientes_vinculo[0].resuelto, false);
});
