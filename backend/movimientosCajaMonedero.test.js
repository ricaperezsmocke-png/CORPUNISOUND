const { test } = require("node:test");
const assert = require("node:assert/strict");
const { construirDBPrueba } = require("./testHelpers");
const { sembrarCajas } = require("./cajas");
const { crearVenta } = require("./ventas");
const { calcularCorteEnCurso } = require("./cortes");
const { reporteMovimientosCaja } = require("./reportes");

function prepararDB() {
  const DB = construirDBPrueba();
  DB.pos.ventas = [];
  DB.pos.venta_detalle = [];
  DB.pos.cortes_caja = [];
  DB.pos.apartado_abonos = [];
  DB.pos.cajas = [];
  DB.pos.corte_epoca = "2026-01-01T00:00:00.000Z";
  sembrarCajas(DB);
  DB.pos.configuracion = { permitir_ventas_sin_existencia: true, descuentos_pago_habilitado: false };
  DB.crm.clientes.find((c) => c.id === 1).monedero = 500;
  return DB;
}


test("el reporte informa lo que entro al cajon, no el valor de la venta", () => {
  const DB = prepararDB();
  DB.crm.clientes.find((c) => c.id === 1).monedero = 10;
  crearVenta(DB, { sucursal_id: 1, cliente_id: 1, metodo_pago: "EFECTIVO",
    monedero_aplicado: 10, lineas: [{ producto_id: 3, cantidad: 1 }] });
  const r = reporteMovimientosCaja(DB, {}, { verTodas: true, sucursalId: null });
  const efectivo = r.entradas.find((e) => e.forma_pago === "EFECTIVO");
  assert.equal(efectivo.total, 22, "el corte espera 22; el reporte tiene que decir lo mismo");
});

test("el reporte y el corte dan la MISMA cifra de efectivo", () => {
  const DB = prepararDB();
  DB.crm.clientes.find((c) => c.id === 1).monedero = 10;
  crearVenta(DB, { sucursal_id: 1, cliente_id: 1, metodo_pago: "EFECTIVO",
    monedero_aplicado: 10, lineas: [{ producto_id: 3, cantidad: 1 }] });
  const r = reporteMovimientosCaja(DB, {}, { verTodas: true, sucursalId: null });
  const delReporte = r.entradas.find((e) => e.forma_pago === "EFECTIVO").total;
  const delCorte = calcularCorteEnCurso(DB, 1).calculado.EFECTIVO;
  assert.equal(delReporte, delCorte, "dos pantallas no pueden contar historias distintas del mismo cajon");
});

test("la red: una venta SIN monedero sigue valiendo su total completo", () => {
  const DB = prepararDB();
  crearVenta(DB, { sucursal_id: 1, cliente_id: 1, metodo_pago: "EFECTIVO",
    lineas: [{ producto_id: 3, cantidad: 1 }] });
  const r = reporteMovimientosCaja(DB, {}, { verTodas: true, sucursalId: null });
  assert.equal(r.entradas.find((e) => e.forma_pago === "EFECTIVO").total, 32);
});

test("una venta pagada ENTERA con monedero no suma nada al cajon", () => {
  const DB = prepararDB();
  DB.crm.clientes.find((c) => c.id === 1).monedero = 500;
  crearVenta(DB, { sucursal_id: 1, cliente_id: 1, metodo_pago: "EFECTIVO",
    monedero_aplicado: 500, lineas: [{ producto_id: 3, cantidad: 1 }] });
  const r = reporteMovimientosCaja(DB, {}, { verTodas: true, sucursalId: null });
  const efectivo = r.entradas.find((e) => e.forma_pago === "EFECTIVO");
  assert.equal(efectivo ? efectivo.total : 0, 0);
});
