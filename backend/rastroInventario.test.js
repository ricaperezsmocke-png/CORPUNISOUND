const { test } = require("node:test");
const assert = require("node:assert");

const { construirDBPrueba } = require("./testHelpers");
const { sembrarCajas } = require("./cajas");
const { crearVenta, cancelarVenta } = require("./ventas");
const { crearApartado, cancelarApartado } = require("./apartados");
const { crearTraspaso, recibirTraspaso } = require("./traspasos");

const ANA = { id: 1, nombre: "Ana" };
const BETO = { id: 2, nombre: "Beto" };

function prepararDB() {
  const DB = construirDBPrueba();
  DB.pos.ventas = [];
  DB.pos.venta_detalle = [];
  DB.pos.apartado_abonos = [];
  DB.pos.cajas = [];
  sembrarCajas(DB);
  DB.pos.configuracion = { permitir_ventas_sin_existencia: true };
  return DB;
}

const movimientosDe = (DB) => DB.inventario.movimientos_inventario;
const ultimo = (DB) => movimientosDe(DB).slice(-1)[0];

/**
 * TODO MOVIMIENTO DE INVENTARIO DICE QUIEN.
 *
 * Lo pidio Victor el 2026-09-06 despues de que una prueba en navegador
 * encontrara que la salida de una venta guardaba `usuario: "—"`: el documento
 * explicaba POR QUE se movieron las piezas ("Venta — folio 10") pero no QUIEN
 * la hizo. El ajuste manual si lo guardaba; los movimientos que nacen de un
 * documento, no.
 *
 * Importa porque el folio solo sirve si alguien lo rastrea a mano. Con el
 * usuario en el propio movimiento, el historial del producto contesta la
 * pregunta directa: quien movio estas piezas.
 */
test("la venta deja su movimiento a nombre de quien vendio", () => {
  const DB = prepararDB();

  crearVenta(DB, { sucursal_id: 1, metodo_pago: "TARJETA", lineas: [{ producto_id: 1, cantidad: 2 }] }, { usuario: ANA });

  assert.strictEqual(ultimo(DB).usuario, "Ana");
});

test("cancelar una venta deja el reintegro a nombre de quien cancelo", () => {
  const DB = prepararDB();
  const venta = crearVenta(DB, { sucursal_id: 1, metodo_pago: "TARJETA", lineas: [{ producto_id: 1, cantidad: 2 }] }, { usuario: ANA });

  cancelarVenta(DB, venta.id, "prueba", BETO);

  assert.strictEqual(ultimo(DB).usuario, "Beto", "el reintegro es de quien cancela, no de quien vendio");
});

test("el apartado y su cancelacion dicen quien", () => {
  const DB = prepararDB();
  const apartado = crearApartado(DB, {
    cliente_id: 1, lineas: [{ producto_id: 1, cantidad: 1, precio_unitario: 25, descuento_pct: 0 }],
    anticipo_monto: 10, anticipo_forma_pago: "EFECTIVO",
  }, 1, ANA);
  assert.strictEqual(ultimo(DB).usuario, "Ana");

  cancelarApartado(DB, apartado.id, "prueba", BETO);
  assert.strictEqual(ultimo(DB).usuario, "Beto");
});

test("el traspaso dice quien lo envio y quien lo recibio", () => {
  const DB = prepararDB();
  const traspaso = crearTraspaso(DB, { producto_id: 1, cantidad: 3, sucursal_destino_id: 2 }, 1, ANA);
  assert.strictEqual(ultimo(DB).usuario, "Ana", "la salida es de quien envia");

  recibirTraspaso(DB, traspaso.id, {}, 2, BETO);
  assert.strictEqual(ultimo(DB).usuario, "Beto", "la entrada es de quien recibe");
});

/**
 * Un movimiento historico —de antes de este cambio— no tiene usuario y no se le
 * inventa uno: se muestra la misma marca que usan las cancelaciones.
 */
test("un movimiento sin usuario guarda una marca, no undefined", () => {
  const DB = prepararDB();
  const { ajustarExistencia } = require("./productos");

  ajustarExistencia(DB, 1, { cantidad: -1, motivo: "sin usuario", sucursal_id: 1 });

  assert.strictEqual(ultimo(DB).usuario, "—");
});
