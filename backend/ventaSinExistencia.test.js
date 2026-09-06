const { test } = require("node:test");
const assert = require("node:assert");

const { construirDBPrueba } = require("./testHelpers");
const { sembrarCajas } = require("./cajas");
const { crearVenta } = require("./ventas");

function prepararDB() {
  const DB = construirDBPrueba();
  DB.pos.ventas = [];
  DB.pos.venta_detalle = [];
  DB.pos.cajas = [];
  sembrarCajas(DB);
  DB.pos.configuracion = { permitir_ventas_sin_existencia: true };
  return DB;
}

const existenciaDe = (DB, productoId, sucursalId) =>
  DB.inventario.existencias.find((e) => e.producto_id === productoId && e.sucursal_id === sucursalId);

/**
 * `ajustarExistencia` lanza cuando el producto no tiene FILA de existencia en
 * esa sucursal, y `crearVenta` se tragaba esa excepcion en silencio: la venta se
 * cobraba, el dinero entraba, y el inventario NO se movia. Nadie se enteraba.
 *
 * Pasa mas de lo que parece: un producto dado de alta en una tienda y vendido en
 * otra, o uno que llego de la migracion sin fila en todas las sucursales.
 *
 * No se rechaza la venta —seria negarle una compra a un cliente que esta
 * enfrente con el producto en la mano, por un dato administrativo— y no se
 * calla: se crea la fila y se descuenta, aunque quede en negativo. La existencia
 * negativa es justo la senal de que a ese producto le falta un ajuste.
 */
test("vender sin fila de existencia la crea y descuenta, no se calla", () => {
  const DB = prepararDB();
  // El producto 1 no tiene fila en la sucursal 4.
  DB.inventario.existencias = DB.inventario.existencias.filter((e) => !(e.producto_id === 1 && e.sucursal_id === 4));

  crearVenta(DB, { sucursal_id: 4, lineas: [{ producto_id: 1, cantidad: 2 }] });

  const fila = existenciaDe(DB, 1, 4);
  assert.ok(fila, "la fila tiene que quedar creada");
  assert.strictEqual(fila.cantidad_actual, -2, "queda en negativo, que es la senal");
});

test("vender sin fila de existencia deja movimiento de inventario", () => {
  const DB = prepararDB();
  DB.inventario.existencias = DB.inventario.existencias.filter((e) => !(e.producto_id === 1 && e.sucursal_id === 4));
  const antes = DB.inventario.movimientos_inventario.length;

  crearVenta(DB, { sucursal_id: 4, lineas: [{ producto_id: 1, cantidad: 2 }] });

  assert.strictEqual(DB.inventario.movimientos_inventario.length, antes + 1);
  const mov = DB.inventario.movimientos_inventario.slice(-1)[0];
  assert.strictEqual(mov.cantidad, -2);
  assert.strictEqual(mov.sucursal_id, 4);
});

/** La red: vender donde SI hay fila sigue funcionando igual que siempre. */
test("vender donde ya hay existencia sigue descontando igual", () => {
  const DB = prepararDB();
  const antes = existenciaDe(DB, 1, 1).cantidad_actual;

  crearVenta(DB, { sucursal_id: 1, lineas: [{ producto_id: 1, cantidad: 3 }] });

  assert.strictEqual(existenciaDe(DB, 1, 1).cantidad_actual, antes - 3);
});

/**
 * Cancelar esa venta tiene que devolver las piezas al mismo lugar: si el
 * reintegro partiera de un punto falso, cancelar crearia inventario de la nada.
 */
test("cancelar una venta hecha sin fila devuelve las piezas al mismo lugar", () => {
  const { cancelarVenta } = require("./ventas");
  const DB = prepararDB();
  DB.inventario.existencias = DB.inventario.existencias.filter((e) => !(e.producto_id === 1 && e.sucursal_id === 4));

  const venta = crearVenta(DB, { sucursal_id: 4, lineas: [{ producto_id: 1, cantidad: 2 }] });
  assert.strictEqual(existenciaDe(DB, 1, 4).cantidad_actual, -2);

  cancelarVenta(DB, venta.id, "prueba", { nombre: "Ana" });

  assert.strictEqual(existenciaDe(DB, 1, 4).cantidad_actual, 0);
});
