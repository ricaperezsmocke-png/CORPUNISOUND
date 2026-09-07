const { test } = require("node:test");
const assert = require("node:assert/strict");
const { construirDBPrueba } = require("./testHelpers");
const { sembrarCajas } = require("./cajas");
const { crearVenta } = require("./ventas");
const { calcularCorteEnCurso, crearCorte, filtrarCorteEnCursoPorPermiso } = require("./cortes");

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
const vender = (DB, extra = {}) => crearVenta(DB, {
  sucursal_id: 1, cliente_id: 1, metodo_pago: "EFECTIVO",
  lineas: [{ producto_id: 3, cantidad: 10 }], monedero_aplicado: 120, ...extra,
});

for (const metodo_pago of ["EFECTIVO", "TARJETA", "TRANSFERENCIA"]) {
  test(`${metodo_pago}: venta de 320 con monedero de 120 cuenta solo 200`, () => {
    const DB = prepararDB();
    vender(DB, { metodo_pago });
    const corte = calcularCorteEnCurso(DB, 1);
    assert.equal(metodo_pago === "TRANSFERENCIA" ? corte.transferencias : corte.calculado[metodo_pago], 200);
    assert.equal(corte.calculado.EFECTIVO, metodo_pago === "EFECTIVO" ? 200 : 0);
    assert.equal(corte.monedero_aplicado, 120);
  });
}

test("500 menos 120 de monedero deja 380 de efectivo sin faltante", () => {
  const DB = prepararDB();
  vender(DB, { lineas: [{ producto_id: 1, cantidad: 20 }] });
  const corte = crearCorte(DB, { sucursal_id: 1, contado: { EFECTIVO: 380 } });
  assert.equal(corte.calculado.EFECTIVO, 380);
  assert.equal(corte.diferencia.EFECTIVO, 0);
  assert.equal(corte.total_calculado, 380);
  assert.equal(corte.monedero_aplicado, 120);
});

test("pago íntegro con monedero entra y se sella sin sumar efectivo", () => {
  const DB = prepararDB();
  const venta = vender(DB, { monedero_aplicado: 320 });
  const corte = crearCorte(DB, { sucursal_id: 1 });
  assert.equal(corte.calculado.EFECTIVO, 0);
  assert.equal(corte.total_calculado, 0);
  assert.equal(corte.ventas_incluidas, 1);
  assert.equal(corte.monedero_aplicado, 320);
  assert.equal(venta.corte_id, corte.id);
  const siguiente = calcularCorteEnCurso(DB, 1);
  assert.equal(siguiente.monedero_aplicado, 0);
  assert.equal(siguiente.ventas_incluidas, 0);
});

test("el corte guarda la suma informativa y no la repite en el siguiente turno", () => {
  const DB = prepararDB();
  vender(DB);
  vender(DB, { metodo_pago: "TARJETA", monedero_aplicado: 80 });
  const corte = crearCorte(DB, { sucursal_id: 1 });
  assert.equal(corte.monedero_aplicado, 200);
  assert.equal(corte.total_calculado, 440);
  assert.equal(DB.pos.cortes_caja[0].monedero_aplicado, 200);
  assert.equal(calcularCorteEnCurso(DB, 1).monedero_aplicado, 0);
  assert.equal(corte.monedero_aplicado, 200, "la foto guardada no cambia");
});

test("una venta histórica sin monedero conserva su total completo", () => {
  const DB = prepararDB();
  const venta = vender(DB, { monedero_aplicado: 0 });
  delete venta.monedero_aplicado;
  const corte = calcularCorteEnCurso(DB, 1);
  assert.equal(corte.calculado.EFECTIVO, 320);
  assert.equal(corte.monedero_aplicado, 0);
  assert.equal(Object.hasOwn(venta, "monedero_aplicado"), false);
});

test("el descuento por efectivo se aplica antes del monedero", () => {
  const DB = prepararDB();
  DB.pos.configuracion.descuentos_pago_habilitado = true;
  const venta = vender(DB);
  assert.equal(venta.total, 300.8);
  assert.equal(calcularCorteEnCurso(DB, 1).calculado.EFECTIVO, 180.8);
});

test("otra caja o sucursal no cuenta ni sella el monedero", () => {
  const DB = prepararDB();
  const fiscal = DB.pos.cajas.find((c) => c.sucursal_id === 1 && !c.predeterminada);
  const venta = vender(DB, { caja_id: fiscal.id });
  venta.caja_id = String(venta.caja_id);
  assert.equal(crearCorte(DB, { sucursal_id: 1 }).monedero_aplicado, 0);
  assert.equal(crearCorte(DB, { sucursal_id: 2 }).monedero_aplicado, 0);
  assert.equal(venta.corte_id, null);
  assert.equal(crearCorte(DB, { sucursal_id: 1, caja_id: fiscal.id }).monedero_aplicado, 120);
});

test("el corte a ciegas no revela el monedero aplicado", () => {
  const DB = prepararDB();
  vender(DB);
  const corte = calcularCorteEnCurso(DB, 1);
  assert.equal(corte.monedero_aplicado, 120);
  assert.equal(filtrarCorteEnCursoPorPermiso(corte, ["realizar_corte_caja"]).monedero_aplicado, undefined);
});
