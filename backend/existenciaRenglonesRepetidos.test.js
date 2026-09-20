/**
 * El mismo producto en DOS renglones se saltaba la validacion de existencia.
 *
 * `crearVenta` comprobaba renglon por renglon contra el disponible completo, asi
 * que con 3 piezas una venta de 2 + 2 del mismo producto pasaba y dejaba la
 * existencia en -1. `crearApartado` ya agrupaba por producto antes de comparar:
 * el arreglo fue llevar ese mismo comportamiento a ventas.
 *
 * La bandera `permitir_ventas_sin_existencia` es un interruptor de todo o nada:
 * encendida, no se valida nada y la existencia PUEDE quedar negativa, que es lo
 * que Victor pide al encenderla.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { construirDBPrueba } = require("./testHelpers");
const { sembrarCajas } = require("./cajas");
const { crearVenta } = require("./ventas");

function preparar({ existencia = 3, permitirSinExistencia = false } = {}) {
  const DB = construirDBPrueba();
  DB.pos.ventas = [];
  DB.pos.venta_detalle = [];
  DB.pos.cajas = [];
  sembrarCajas(DB);
  DB.pos.configuracion = {
    permitir_ventas_sin_existencia: permitirSinExistencia,
    descuentos_pago_habilitado: false,
  };
  const [uno, dos] = DB["catalogo-productos"].productos;
  uno.precio_venta = 100;
  dos.precio_venta = 100;
  DB.inventario.existencias = [
    { producto_id: uno.id, sucursal_id: 1, cantidad_actual: existencia, cantidad_minima: 0, cantidad_maxima: 99 },
    { producto_id: dos.id, sucursal_id: 1, cantidad_actual: existencia, cantidad_minima: 0, cantidad_maxima: 99 },
  ];
  return { DB, uno, dos };
}

const renglon = (producto, cantidad) => ({
  producto_id: producto.id, descripcion: producto.nombre, cantidad, precio_unitario: 100,
});

function vender(DB, lineas, permisos = []) {
  return crearVenta(DB, {
    sucursal_id: 1, caja_id: DB.pos.cajas[0].id, usuario_id: 1, cliente_id: 1,
    forma_pago: "EFECTIVO", lineas,
  }, { permisos });
}

const cuantasQuedan = (DB, producto) =>
  DB.inventario.existencias.find((e) => e.producto_id === producto.id && e.sucursal_id === 1).cantidad_actual;

test("el mismo producto en dos renglones no puede pasarse de la existencia", () => {
  const { DB, uno } = preparar({ existencia: 3 });
  assert.throws(() => vender(DB, [renglon(uno, 2), renglon(uno, 2)]), /existencia suficiente/i);
  assert.equal(cuantasQuedan(DB, uno), 3, "la existencia no se debe mover si la venta se rechaza");
});

test("el mensaje de error dice la cantidad SUMADA, no la de un renglon", () => {
  const { DB, uno } = preparar({ existencia: 3 });
  assert.throws(() => vender(DB, [renglon(uno, 2), renglon(uno, 2)]), /solicitado: 4/);
});

test("tres renglones del mismo producto tampoco pasan", () => {
  const { DB, uno } = preparar({ existencia: 3 });
  assert.throws(() => vender(DB, [renglon(uno, 2), renglon(uno, 2), renglon(uno, 2)]), /existencia suficiente/i);
  assert.equal(cuantasQuedan(DB, uno), 3);
});

test("un solo renglon que se pasa se sigue rechazando", () => {
  const { DB, uno } = preparar({ existencia: 3 });
  assert.throws(() => vender(DB, [renglon(uno, 4)]), /existencia suficiente/i);
  assert.equal(cuantasQuedan(DB, uno), 3);
});

test("dos renglones que JUNTOS caben si se aceptan", () => {
  const { DB, uno } = preparar({ existencia: 5 });
  vender(DB, [renglon(uno, 2), renglon(uno, 2)]);
  assert.equal(cuantasQuedan(DB, uno), 1, "5 menos 4 son 1");
});

test("dos productos DISTINTOS no se suman entre si", () => {
  const { DB, uno, dos } = preparar({ existencia: 3 });
  vender(DB, [renglon(uno, 3), renglon(dos, 3)]);
  assert.equal(cuantasQuedan(DB, uno), 0);
  assert.equal(cuantasQuedan(DB, dos), 0);
});

test("un articulo rapido no estorba la validacion del producto de catalogo", () => {
  const { DB, uno } = preparar({ existencia: 3 });
  const rapido = { descripcion: "Pieza especial", cantidad: 9, precio_unitario: 50 };
  vender(DB, [renglon(uno, 1), rapido, renglon(uno, 1)], ["agregar_articulo_rapido"]);
  assert.equal(cuantasQuedan(DB, uno), 1, "solo bajan las 2 piezas del producto de catalogo");
});

test("con la bandera encendida la venta pasa aunque la existencia quede negativa", () => {
  const { DB, uno } = preparar({ existencia: 3, permitirSinExistencia: true });
  vender(DB, [renglon(uno, 2), renglon(uno, 2)]);
  assert.equal(cuantasQuedan(DB, uno), -1, "esto es lo que Victor pide al encender la bandera");
});
