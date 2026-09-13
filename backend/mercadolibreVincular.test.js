const { test } = require("node:test");
const assert = require("node:assert");
const { resolverPendienteVinculo } = require("./mercadolibre");

function prepararDBConPendiente() {
  return {
    "catalogo-productos": { productos: [{ id: 7, sku: "GTR-001", nombre: "Guitarra", precio: 12000 }] },
    inventario: { existencias: [{ producto_id: 7, sucursal_id: 5, cantidad_actual: 10 }], movimientos_inventario: [] },
    pos: { ventas: [{ id: 90, sucursal_id: 5 }], venta_detalle: [{ id: 1, venta_id: 90, producto_id: null, ml_item_id: "MLB-BAJO", cantidad: 2 }] },
    crm: { clientes: [] },
    ml: {
      ordenes_importadas: [555], publicaciones: [],
      pendientes_vinculo: [{ id: 1, orden_id: 555, venta_id: 90, sku: "NO-EXISTE", ml_item_id: "MLB-BAJO", nombre: "Bajo", cantidad: 2, fecha: "2026-09-12", resuelto: false }],
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

test("dos pendientes de la misma venta ligan cada renglon a su producto y descuentan una sola vez", () => {
  const DB = prepararDBConPendiente();
  DB["catalogo-productos"].productos.push({ id: 8, sku: "AMP-001", nombre: "Amplificador", precio: 8000 });
  DB.inventario.existencias.push({ producto_id: 8, sucursal_id: 5, cantidad_actual: 6 });
  DB.pos.venta_detalle.push({ id: 2, venta_id: 90, producto_id: null, ml_item_id: "MLB-AMPLI", cantidad: 1 });
  DB.ml.pendientes_vinculo.push({
    id: 2, orden_id: 555, venta_id: 90, sku: "OTRO-SKU", ml_item_id: "MLB-AMPLI",
    nombre: "Amplificador", cantidad: 1, fecha: "2026-09-12", resuelto: false,
  });

  resolverPendienteVinculo(DB, 1, 7, { nombre: "Victor" });
  resolverPendienteVinculo(DB, 2, 8, { nombre: "Victor" });

  assert.equal(DB.pos.venta_detalle[0].producto_id, 7, "el Bajo conserva el producto elegido para su pendiente");
  assert.equal(DB.pos.venta_detalle[1].producto_id, 8, "el Amplificador conserva el producto elegido para su pendiente");
  assert.equal(existenciaDe(DB, 7), 8, "el Bajo descuenta 2 una sola vez");
  assert.equal(existenciaDe(DB, 8), 5, "el Amplificador descuenta 1 una sola vez");
  assert.equal(DB.inventario.movimientos_inventario.length, 2, "hay exactamente un movimiento por pendiente");
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
