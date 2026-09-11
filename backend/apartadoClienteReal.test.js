const { test } = require("node:test");
const assert = require("node:assert/strict");
const { construirDBPrueba } = require("./testHelpers");
const { crearApartado, cancelarApartado } = require("./apartados");
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
  DB.crm.clientes.find((c) => c.id === 1).monedero = 0;
  return DB;
}

test("un apartado a nombre de un cliente inexistente se rechaza", () => {
  const DB = prepararDB();
  assert.throws(() => crearApartado(DB, { cliente_id: 999999, anticipo_monto: 100,
    anticipo_forma_pago: "EFECTIVO", lineas: [{ producto_id: 3, cantidad: 20 }] },
    1, { nombre: "Ana" }), /cliente/i);
});

test("un id de TEXTO de un cliente que si existe se acepta: el cuerpo HTTP manda texto", () => {
  const DB = prepararDB();
  const a = crearApartado(DB, { cliente_id: "1", anticipo_monto: 100,
    anticipo_forma_pago: "EFECTIVO", lineas: [{ producto_id: 3, cantidad: 20 }] },
    1, { nombre: "Ana" });
  assert.equal(Number(a.cliente_id), 1);
});

test("Publico en General sigue sin poder apartar", () => {
  const DB = prepararDB();
  assert.throws(() => crearApartado(DB, { cliente_id: 0, anticipo_monto: 100,
    anticipo_forma_pago: "EFECTIVO", lineas: [{ producto_id: 3, cantidad: 20 }] },
    1, { nombre: "Ana" }), /cliente/i);
});

test("cancelar un apartado real SI acredita el monedero a su dueno", () => {
  const DB = prepararDB();
  const a = crearApartado(DB, { cliente_id: 1, anticipo_monto: 100, anticipo_forma_pago: "EFECTIVO",
    lineas: [{ producto_id: 3, cantidad: 20 }] }, 1, { nombre: "Ana" });
  cancelarApartado(DB, a.id, "prueba", { nombre: "Ana" });
  assert.equal(DB.crm.clientes.find((c) => c.id === 1).monedero, 100);
});
