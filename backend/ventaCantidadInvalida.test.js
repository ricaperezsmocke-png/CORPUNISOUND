const { test } = require("node:test");
const assert = require("node:assert/strict");
const { construirDBPrueba } = require("./testHelpers");
const { sembrarCajas } = require("./cajas");
const { crearVenta } = require("./ventas");
const { calcularCorteEnCurso } = require("./cortes");

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

test("una venta con cantidad negativa se rechaza", () => {
  const DB = prepararDB();
  assert.throws(
    () => crearVenta(DB, { sucursal_id: 1, cliente_id: 1, metodo_pago: "EFECTIVO",
      lineas: [{ producto_id: 3, cantidad: -1 }] }),
    /cantidad/i
  );
});

test("cantidad cero tampoco: una linea que no vende nada no es una venta", () => {
  const DB = prepararDB();
  assert.throws(() => crearVenta(DB, { sucursal_id: 1, cliente_id: 1, metodo_pago: "EFECTIVO",
    lineas: [{ producto_id: 3, cantidad: 0 }] }), /cantidad/i);
});

test("cantidad de TEXTO negativa tambien se rechaza: el cuerpo HTTP manda texto", () => {
  const DB = prepararDB();
  assert.throws(() => crearVenta(DB, { sucursal_id: 1, cliente_id: 1, metodo_pago: "EFECTIVO",
    lineas: [{ producto_id: 3, cantidad: "-5" }] }), /cantidad/i);
});

test("basura en la cantidad se rechaza, no se convierte en cero en silencio", () => {
  const DB = prepararDB();
  for (const cantidad of [null, undefined, "", "abc", NaN, Infinity, {}]) {
    assert.throws(() => crearVenta(DB, { sucursal_id: 1, cliente_id: 1, metodo_pago: "EFECTIVO",
      lineas: [{ producto_id: 3, cantidad }] }), /cantidad/i, `paso con cantidad: ${String(cantidad)}`);
  }
});

test("la red: una venta normal de 2 piezas sigue funcionando", () => {
  const DB = prepararDB();
  const v = crearVenta(DB, { sucursal_id: 1, cliente_id: 1, metodo_pago: "EFECTIVO",
    lineas: [{ producto_id: 3, cantidad: 2 }] });
  assert.equal(v.total > 0, true);
});

test("el corte nunca recibe un efectivo esperado negativo por una venta", () => {
  const DB = prepararDB();
  try { crearVenta(DB, { sucursal_id: 1, cliente_id: 1, metodo_pago: "EFECTIVO",
    lineas: [{ producto_id: 3, cantidad: -1 }] }); } catch { /* se espera el rechazo */ }
  assert.equal(calcularCorteEnCurso(DB, 1).calculado.EFECTIVO, 0);
});
