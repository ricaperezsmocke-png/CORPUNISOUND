const { test } = require("node:test");
const assert = require("node:assert/strict");
const { construirDBPrueba } = require("./testHelpers");
const { sembrarCajas } = require("./cajas");
const { crearVenta, cancelarVenta } = require("./ventas");

function prepararDB(saldo = 500) {
  const DB = construirDBPrueba();
  DB.pos.ventas = [];
  DB.pos.venta_detalle = [];
  DB.pos.cajas = [];
  sembrarCajas(DB);
  DB.pos.configuracion = { permitir_ventas_sin_existencia: true };
  DB.crm.clientes.find((c) => c.id === 1).monedero = saldo;
  return DB;
}
const saldoDe = (DB) => DB.crm.clientes.find((c) => c.id === 1).monedero;
const datosVenta = (extra = {}) => ({
  sucursal_id: 1, metodo_pago: "TARJETA", cliente_id: 1,
  lineas: [{ producto_id: 3, cantidad: 10 }], ...extra,
});

for (const caso of [
  { nombre: "aplica lo pedido", saldo: 500, pedido: 120, aplicado: 120, restante: 380 },
  { nombre: "recorta al saldo disponible", saldo: 120, pedido: 9999, aplicado: 120, restante: 0 },
  { nombre: "recorta al total", saldo: 500, pedido: 500, aplicado: 320, restante: 180 },
  { nombre: "no inventa saldo", saldo: 0, pedido: 120, aplicado: 0, restante: 0 },
  { nombre: "acepta importes e ids HTTP como texto", saldo: 500, pedido: "120", aplicado: 120, restante: 380 },
]) {
  test(caso.nombre, () => {
    const DB = prepararDB(caso.saldo);
    const venta = crearVenta(DB, datosVenta({ cliente_id: "1", monedero_aplicado: caso.pedido }));
    assert.equal(venta.monedero_aplicado, caso.aplicado);
    assert.equal(saldoDe(DB), caso.restante);
    assert.equal(venta.total, 320, "el monedero no cambia el valor de la mercancía");
  });
}

for (const cliente_id of [0, "0", null, 9999]) {
  test(`rechaza monedero sin cliente real (${cliente_id}) sin consumir saldo`, () => {
    const DB = prepararDB();
    assert.throws(() => crearVenta(DB, datosVenta({ cliente_id, monedero_aplicado: 120 })), /cliente/i);
    assert.equal(saldoDe(DB), 500);
    assert.equal(DB.pos.ventas.length, 0);
  });
}

test("una venta normal guarda cero y conserva el saldo", () => {
  const DB = prepararDB();
  const venta = crearVenta(DB, datosVenta());
  assert.equal(venta.monedero_aplicado, 0);
  assert.equal(venta.total, 320);
  assert.equal(saldoDe(DB), 500);
});

test("pagar todo con monedero registra venta y descuenta inventario", () => {
  const DB = prepararDB();
  DB.inventario.existencias.push({ producto_id: 3, sucursal_id: 1, cantidad_actual: 20 });
  const venta = crearVenta(DB, datosVenta({ monedero_aplicado: 320 }));
  assert.equal(venta.monedero_aplicado, 320);
  assert.equal(venta.estatus, "cerrada");
  assert.equal(DB.pos.venta_detalle[0].cantidad, 10);
  assert.equal(DB.inventario.existencias.find((e) => e.producto_id === 3 && e.sucursal_id === 1).cantidad_actual, 10);
});

test("una caja inválida no consume el saldo del cliente", () => {
  const DB = prepararDB();
  assert.throws(() => crearVenta(DB, datosVenta({ caja_id: 9999, monedero_aplicado: 120 })), /caja/i);
  assert.equal(saldoDe(DB), 500);
  assert.equal(DB.pos.ventas.length, 0);
});

for (const monedero_aplicado of [-1, "basura", Infinity]) {
  test(`rechaza una propuesta inválida (${monedero_aplicado})`, () => {
    const DB = prepararDB();
    assert.throws(() => crearVenta(DB, datosVenta({ monedero_aplicado })), /monedero/i);
    assert.equal(saldoDe(DB), 500);
    assert.equal(DB.pos.ventas.length, 0);
  });
}

test("no permite consumir monedero como apartado", () => {
  const DB = prepararDB();
  assert.throws(() => crearVenta(DB, datosVenta({ tipo_documento: "Apartado", monedero_aplicado: 120 })), /apartado/i);
  assert.equal(saldoDe(DB), 500);
});

test("cancelar devuelve exactamente el monedero aplicado al cliente", () => {
  const DB = prepararDB();
  const venta = crearVenta(DB, datosVenta({ monedero_aplicado: 120 }));
  assert.equal(saldoDe(DB), 380);
  cancelarVenta(DB, venta.id, "Cambio de opinión", { nombre: "Ana" });
  assert.equal(saldoDe(DB), 500);
  assert.equal(venta.monedero_aplicado, 120, "conserva el rastro del saldo reintegrado");
  assert.equal(venta.estatus, "cancelada");
});

test("cancelar dos veces no devuelve dos veces el monedero", () => {
  const DB = prepararDB();
  const venta = crearVenta(DB, datosVenta({ monedero_aplicado: 120 }));
  cancelarVenta(DB, venta.id, "Cancelación");
  assert.throws(() => cancelarVenta(DB, venta.id, "Otra vez"), /cancelada/i);
  assert.equal(saldoDe(DB), 500);
});

test("cancelar reintegra solo lo aplicado aunque se haya pedido más", () => {
  const DB = prepararDB(120);
  const venta = crearVenta(DB, datosVenta({ monedero_aplicado: 9999 }));
  venta.cliente_id = "1";
  cancelarVenta(DB, venta.id, "Cancelación");
  assert.equal(saldoDe(DB), 120);
});

test("cancelar venta histórica sin monedero no crea saldo", () => {
  const DB = prepararDB();
  const venta = crearVenta(DB, datosVenta());
  delete venta.monedero_aplicado;
  cancelarVenta(DB, venta.id, "Cancelación");
  assert.equal(saldoDe(DB), 500);
});
