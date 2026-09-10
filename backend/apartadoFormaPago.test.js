const { test } = require("node:test");
const assert = require("node:assert/strict");
const { construirDBPrueba } = require("./testHelpers");
const { crearApartado, registrarAbono } = require("./apartados");
const { sembrarCajas } = require("./cajas");

function prepararDB() {
  const DB = construirDBPrueba();
  DB.pos.ventas = [];
  DB.pos.venta_detalle = [];
  DB.pos.apartado_abonos = [];
  DB.pos.cortes_caja = [];
  DB.pos.cajas = [];
  DB.pos.corte_epoca = "2026-01-01T00:00:00.000Z";
  sembrarCajas(DB);
  return DB;
}

test("un anticipo con una forma de pago inventada se rechaza", () => {
  const DB = prepararDB();
  assert.throws(() => crearApartado(DB, { cliente_id: 1, anticipo_monto: 500,
    anticipo_forma_pago: "MERCADOLIBRE",
    lineas: [{ producto_id: 3, cantidad: 20, precio_unitario: 32 }] }, 1, { nombre: "Ana" }),
    /forma de pago/i);
});

test("EL CIRCUITO COMPLETO: no se puede fabricar monedero sin que entre dinero", () => {
  const DB = prepararDB();
  const antes = Number(DB.crm.clientes.find((c) => c.id === 1).monedero) || 0;
  assert.throws(() => crearApartado(DB, { cliente_id: 1, anticipo_monto: 500,
    anticipo_forma_pago: "MERCADOLIBRE",
    lineas: [{ producto_id: 3, cantidad: 20, precio_unitario: 32 }] }, 1, { nombre: "Ana" }));
  assert.equal(Number(DB.crm.clientes.find((c) => c.id === 1).monedero) || 0, antes,
    "el saldo del cliente no se movio ni un peso");
});

test("un abono con forma de pago inventada tambien se rechaza", () => {
  const DB = prepararDB();
  const a = crearApartado(DB, { cliente_id: 1, anticipo_monto: 100, anticipo_forma_pago: "EFECTIVO",
    lineas: [{ producto_id: 3, cantidad: 20, precio_unitario: 32 }] }, 1, { nombre: "Ana" });
  assert.throws(() => registrarAbono(DB, a.id, { monto: 100, forma_pago: "MERCADOLIBRE" },
    { nombre: "Ana" }), /forma de pago/i);
});

test("el credito sigue rechazado, y tambien con el acento mal codificado", () => {
  const DB = prepararDB();
  for (const forma of ["CREDITO", "CRÉDITO", "cr�dito"]) {
    assert.throws(() => crearApartado(DB, { cliente_id: 1, anticipo_monto: 100,
      anticipo_forma_pago: forma,
      lineas: [{ producto_id: 3, cantidad: 20, precio_unitario: 32 }] }, 1, { nombre: "Ana" }),
      undefined, `paso con la forma: ${forma}`);
  }
});

test("la red: EFECTIVO y TRANSFERENCIA siguen funcionando", () => {
  for (const forma of ["EFECTIVO", "TRANSFERENCIA"]) {
    const DB = prepararDB();
    const a = crearApartado(DB, { cliente_id: 1, anticipo_monto: 100, anticipo_forma_pago: forma,
      lineas: [{ producto_id: 3, cantidad: 20, precio_unitario: 32 }] }, 1, { nombre: "Ana" });
    assert.equal(a.estatus, "apartado");
  }
});
