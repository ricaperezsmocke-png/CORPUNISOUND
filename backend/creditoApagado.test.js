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

const LINEA = { descripcion: "Servicio", cantidad: 1, precio_unitario: 100 };

/**
 * El credito NO genera deuda: `cliente.saldo` se inicializa en cero
 * (clientes.js) y ninguna linea de produccion lo sube nunca. `crearVenta` no
 * busca al cliente ni una sola vez. Aceptar una venta a credito es entregar la
 * mercancia y dejar la caja cuadrada, sin faltante y sin deuda: es el hueco mas
 * caro del sistema y el unico abierto a una cajera del rol estandar.
 *
 * Se apaga en el SERVIDOR, no en la pantalla: el boton escondido no detiene a
 * quien manda la peticion a mano.
 */
test("una venta a credito se rechaza", () => {
  const DB = prepararDB();

  assert.throws(
    () => crearVenta(DB, { sucursal_id: 4, metodo_pago: "CRÉDITO", lineas: [LINEA], total: 100 }),
    /cr[eé]dito/i
  );
  assert.strictEqual(DB.pos.ventas.length, 0, "no se guarda nada");
});

/**
 * En el repo el credito se escribe "CRÉDITO" CON ACENTO (condicionesPago.js:14,
 * apartados.js:54 y :169), y cortes.js:131 acepta las dos formas. Un rechazo que
 * solo atrape una de las dos deja el agujero abierto con las pruebas en verde.
 */
test("se rechaza sin importar acento, mayusculas ni espacios", () => {
  for (const forma of ["credito", "Crédito", "CRÉDITO", "CREDITO", "  crédito  ", "CrÉdItO"]) {
    const DB = prepararDB();
    assert.throws(
      () => crearVenta(DB, { sucursal_id: 4, metodo_pago: forma, lineas: [LINEA], total: 100 }),
      /cr[eé]dito/i,
      `no rechazo "${forma}"`
    );
  }
});

/** La red que evita que apagar el credito rompa el cobro de todos los dias. */
test("las demas formas de pago siguen funcionando", () => {
  for (const forma of ["EFECTIVO", "TARJETA", "TRANSFERENCIA", "VALES", "CHEQUE"]) {
    const DB = prepararDB();
    const venta = crearVenta(DB, { sucursal_id: 4, metodo_pago: forma, lineas: [LINEA], total: 100 });
    assert.strictEqual(venta.estatus, "cerrada", `se rompio ${forma}`);
  }
});

/** Una venta sin forma de pago declarada cae en EFECTIVO y tiene que seguir pasando. */
test("una venta sin metodo_pago declarado sigue funcionando", () => {
  const DB = prepararDB();
  const venta = crearVenta(DB, { sucursal_id: 4, lineas: [LINEA], total: 100 });
  assert.strictEqual(venta.estatus, "cerrada");
});
