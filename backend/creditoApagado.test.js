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
  for (const vacio of [undefined, "", "   "]) {
    const DB = prepararDB();
    const venta = crearVenta(DB, { sucursal_id: 4, metodo_pago: vacio, lineas: [LINEA], total: 100 });
    assert.strictEqual(venta.estatus, "cerrada", `fallo con ${JSON.stringify(vacio)}`);
    assert.strictEqual(venta.metodo_pago ? String(venta.metodo_pago).toUpperCase() : "EFECTIVO", "EFECTIVO");
  }
});

/**
 * EL CASO QUE SE ESCAPO EN LA PRUEBA REAL, Y QUE NINGUNA PRUEBA HABIA VISTO.
 *
 * La primera version de la guarda comparaba contra "CREDITO" normalizando el
 * acento. Una peticion con el cuerpo mal codificado —el acento mandado en
 * Latin-1 en vez de UTF-8— llega como "CR\uFFFDDITO" (caracter de reemplazo),
 * no coincide con nada, y la venta a credito ENTRABA. Se descubrio probando
 * contra el servidor real, no con pruebas: todas mandan texto bien formado.
 *
 * Por eso ahora se valida contra la lista de lo PERMITIDO y no contra lo
 * prohibido: cualquier basura que no sea exactamente una forma de pago
 * configurada se rechaza. La guarda falla cerrando.
 */
test("una forma de pago con el acento mal codificado se rechaza", () => {
  const DB = prepararDB();

  assert.throws(
    () => crearVenta(DB, { sucursal_id: 4, metodo_pago: "CR\uFFFDDITO", lineas: [LINEA], total: 100 }),
    /no v[aá]lida|cr[eé]dito/i
  );
  assert.strictEqual(DB.pos.ventas.length, 0, "no se guarda nada");
});

test("una forma de pago inventada se rechaza", () => {
  const DB = prepararDB();

  for (const basura of ["PAGARE", "EFECTIV0", "<script>", "TARJETA VISA"]) {
    assert.throws(
      () => crearVenta(DB, { sucursal_id: 4, metodo_pago: basura, lineas: [LINEA], total: 100 }),
      /no v[aá]lida/i,
      `dejo pasar ${JSON.stringify(basura)}`
    );
  }
  assert.strictEqual(DB.pos.ventas.length, 0);
});
