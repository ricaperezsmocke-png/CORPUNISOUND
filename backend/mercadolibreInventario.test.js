const { test } = require("node:test");
const assert = require("node:assert");
const { mapearLineasDeOrden } = require("./mercadolibre");

function prepararDB() {
  return {
    "catalogo-productos": { productos: [{ id: 7, sku: "GTR-001", nombre: "Guitarra", precio: 12000 }] },
    inventario: { existencias: [{ producto_id: 7, sucursal_id: 5, cantidad: 3 }], movimientos_inventario: [] },
    pos: { ventas: [], venta_detalle: [] },
    crm: { clientes: [] },
    ml: { ordenes_importadas: [], publicaciones: [], pendientes_vinculo: [] },
  };
}

test("un SKU que si esta en el catalogo se mapea a su producto", () => {
  const DB = prepararDB();
  const { lineas, sinVincular } = mapearLineasDeOrden(DB, {
    order_items: [{ item: { seller_sku: "GTR-001", id: "MLM1", title: "Guitarra" }, quantity: 1, unit_price: 12000 }],
  });
  assert.equal(lineas[0].producto_id, 7);
  assert.equal(sinVincular.length, 0);
});

test("un SKU que NO esta en el catalogo se reporta, no se traga en silencio", () => {
  const DB = prepararDB();
  const { lineas, sinVincular } = mapearLineasDeOrden(DB, {
    order_items: [{ item: { seller_sku: "NO-EXISTE", id: "MLM9", title: "Bajo electrico" }, quantity: 2, unit_price: 8000 }],
  });
  assert.equal(lineas[0].producto_id, null);
  assert.equal(sinVincular.length, 1, "el renglon sin vincular tiene que salir reportado");
  assert.equal(sinVincular[0].sku, "NO-EXISTE");
  assert.equal(sinVincular[0].nombre, "Bajo electrico");
  assert.equal(sinVincular[0].cantidad, 2);
});

test("una orden mixta reporta solo el renglon sin vincular", () => {
  const DB = prepararDB();
  const { lineas, sinVincular } = mapearLineasDeOrden(DB, {
    order_items: [
      { item: { seller_sku: "GTR-001", id: "MLM1", title: "Guitarra" }, quantity: 1, unit_price: 12000 },
      { item: { seller_sku: "NO-EXISTE", id: "MLM9", title: "Bajo" }, quantity: 1, unit_price: 8000 },
    ],
  });
  assert.equal(lineas[0].producto_id, 7);
  assert.equal(lineas[1].producto_id, null);
  assert.equal(sinVincular.length, 1);
  assert.equal(sinVincular[0].sku, "NO-EXISTE");
});

const { validarExistenciaDeOrden } = require("./mercadolibre");

test("si alcanza la existencia, no se queja", () => {
  const DB = prepararDB(); // Guitarra id 7: 3 piezas en sucursal 5
  assert.doesNotThrow(() => validarExistenciaDeOrden(DB, [
    { producto_id: 7, cantidad: 3, nombre: "Guitarra" },
  ]));
});

test("si NO alcanza la existencia, se rechaza y el mensaje dice que falta", () => {
  const DB = prepararDB();
  assert.throws(
    () => validarExistenciaDeOrden(DB, [{ producto_id: 7, cantidad: 4, nombre: "Guitarra" }]),
    /existencia|alcanza/i
  );
});

test("un producto sin renglon de existencia en la sucursal 5 cuenta como cero", () => {
  const DB = prepararDB();
  DB.inventario.existencias = [];
  assert.throws(() => validarExistenciaDeOrden(DB, [{ producto_id: 7, cantidad: 1, nombre: "Guitarra" }]), /existencia|alcanza/i);
});

test("los renglones SIN producto vinculado no se validan aqui: son el otro caso", () => {
  const DB = prepararDB();
  assert.doesNotThrow(() => validarExistenciaDeOrden(DB, [
    { producto_id: null, cantidad: 99, nombre: "Bajo sin vincular" },
  ]));
});

test("dos renglones del MISMO producto se suman antes de comparar", () => {
  const DB = prepararDB(); // 3 piezas
  assert.throws(
    () => validarExistenciaDeOrden(DB, [
      { producto_id: 7, cantidad: 2, nombre: "Guitarra" },
      { producto_id: 7, cantidad: 2, nombre: "Guitarra" },
    ]),
    /existencia|alcanza/i,
    "2 + 2 = 4 pasa de las 3 que hay: tiene que rechazar"
  );
});

const { registrarPendientesDeVinculo } = require("./mercadolibre");

test("cada renglon sin vincular deja un pendiente con su orden y su venta", () => {
  const DB = prepararDB();
  registrarPendientesDeVinculo(DB, {
    ordenId: 555, ventaId: 90,
    sinVincular: [{ sku: "NO-EXISTE", nombre: "Bajo electrico", cantidad: 2 }],
  });
  assert.equal(DB.ml.pendientes_vinculo.length, 1);
  const p = DB.ml.pendientes_vinculo[0];
  assert.equal(p.orden_id, 555);
  assert.equal(p.venta_id, 90);
  assert.equal(p.sku, "NO-EXISTE");
  assert.equal(p.cantidad, 2);
  assert.equal(p.resuelto, false);
  assert.ok(p.id, "cada pendiente necesita id propio para poder resolverlo");
  assert.ok(p.fecha, "sin fecha no se sabe cuanto lleva sin descontarse");
});

test("una orden sin renglones sueltos no deja pendientes", () => {
  const DB = prepararDB();
  registrarPendientesDeVinculo(DB, { ordenId: 1, ventaId: 2, sinVincular: [] });
  assert.equal(DB.ml.pendientes_vinculo.length, 0);
});

test("los ids de los pendientes no se repiten entre ordenes", () => {
  const DB = prepararDB();
  registrarPendientesDeVinculo(DB, { ordenId: 1, ventaId: 1, sinVincular: [{ sku: "A", nombre: "A", cantidad: 1 }] });
  registrarPendientesDeVinculo(DB, { ordenId: 2, ventaId: 2, sinVincular: [{ sku: "B", nombre: "B", cantidad: 1 }] });
  const ids = DB.ml.pendientes_vinculo.map((p) => p.id);
  assert.equal(new Set(ids).size, 2, "dos pendientes no pueden compartir id");
});
