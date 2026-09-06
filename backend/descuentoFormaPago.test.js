const { test } = require("node:test");
const assert = require("node:assert");

const { construirDBPrueba } = require("./testHelpers");
const { sembrarCajas } = require("./cajas");
const { crearVenta } = require("./ventas");
const { listarCondiciones } = require("./condicionesPago");

function prepararDB() {
  const DB = construirDBPrueba();
  DB.pos.ventas = [];
  DB.pos.venta_detalle = [];
  DB.pos.cajas = [];
  sembrarCajas(DB);
  DB.pos.configuracion = { permitir_ventas_sin_existencia: true };
  return DB;
}

/** El producto 3 del catalogo de prueba vale 32. */
const LINEA = { producto_id: 3, cantidad: 1 };

function pctDe(DB, sucursalId, nombre) {
  return listarCondiciones(DB, sucursalId).find((c) => c.nombre === nombre)?.descuento_pct || 0;
}

/**
 * REGRESION DEL 2026-09-05, VIVA EN PRODUCCION.
 *
 * Las condiciones de pago traen un descuento por forma de pago —6% en EFECTIVO
 * y TRANSFERENCIA por defecto— que la pantalla SI aplica: `PuntoDeVenta.jsx:340`
 * calcula el "Total a cobrar" ya descontado, y eso es lo que la cajera cobra.
 *
 * Cuando el servidor copiaba el total del navegador, el descuento viajaba
 * dentro y todo cuadraba. Al pasar a recalcular desde el catalogo, el servidor
 * dejo de aplicarlo: la pantalla dice $23.50 y la venta se guarda en $25.00.
 *
 * La cajera cobra lo que dice la pantalla y el corte le pide lo otro: un
 * faltante por cada descuento de pago que da en el dia, y ninguno explicable.
 */
test("el descuento por forma de pago se aplica al total de la venta", () => {
  const DB = prepararDB();
  const pct = pctDe(DB, 4, "EFECTIVO");
  assert.ok(pct > 0, "el fixture debe traer descuento en EFECTIVO para que la prueba valga");

  const venta = crearVenta(DB, { sucursal_id: 4, metodo_pago: "EFECTIVO", lineas: [LINEA] });

  const esperado = Math.round(32 * (1 - pct / 100) * 100) / 100;
  assert.strictEqual(venta.total, esperado);
});

/** El subtotal es lo de lista; el descuento recoge lo que se dejo de cobrar. */
test("subtotal menos descuento sigue siendo igual al total", () => {
  const DB = prepararDB();

  const venta = crearVenta(DB, { sucursal_id: 4, metodo_pago: "EFECTIVO", lineas: [LINEA] });

  assert.strictEqual(Math.round((venta.subtotal - venta.descuento) * 100) / 100, venta.total);
  assert.strictEqual(venta.subtotal, 32);
});

test("una forma de pago sin descuento cobra el precio completo", () => {
  const DB = prepararDB();
  assert.strictEqual(pctDe(DB, 4, "TARJETA"), 0, "el fixture no debe descontar en TARJETA");

  const venta = crearVenta(DB, { sucursal_id: 4, metodo_pago: "TARJETA", lineas: [LINEA] });

  assert.strictEqual(venta.total, 32);
});

/**
 * La bandera de configuracion manda: si los descuentos por forma de pago estan
 * apagados, la pantalla no los muestra y el servidor tampoco los aplica.
 */
test("con los descuentos de pago apagados se cobra completo", () => {
  const DB = prepararDB();
  DB.pos.configuracion = { permitir_ventas_sin_existencia: true, descuentos_pago_habilitado: false };

  const venta = crearVenta(DB, { sucursal_id: 4, metodo_pago: "EFECTIVO", lineas: [LINEA] });

  assert.strictEqual(venta.total, 32);
});

/** Una condicion desactivada tampoco descuenta, igual que en la pantalla. */
test("una condicion de pago desactivada no descuenta", () => {
  const DB = prepararDB();
  listarCondiciones(DB, 4).forEach((c) => { if (c.nombre === "EFECTIVO") c.activo = false; });

  const venta = crearVenta(DB, { sucursal_id: 4, metodo_pago: "EFECTIVO", lineas: [LINEA] });

  assert.strictEqual(venta.total, 32);
});
