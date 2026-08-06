const { test } = require("node:test");
const assert = require("node:assert");
const { estadoCuenta } = require("./estadoCuenta");

const TODAS = { verTodas: true, sucursalId: null };

function DBbase() {
  return {
    pos: { sucursales: [{ id: 1, nombre: "Ocosingo" }, { id: 2, nombre: "Yajalón" }, { id: 6, nombre: "CEDIS" }] },
    "catalogo-productos": { productos: [{ id: 1, nombre: "Cable", costo: 40 }] },
    cuenta_comun: { depositos: [
      { id: 1, sucursal_id: 1, monto: 10000, fecha: "2026-08-03", estatus: "activo", forma_pago: "EFECTIVO", folio: "DEP-0001" },
    ], deposito_movimientos: [], ultimo_id: 1 },
    inventario: { traspasos: [
      // recibido por sucursal 1: 100 piezas × costo 50 (foto) = 5000
      { id: 1, producto_id: 1, cantidad: 100, costo: 50, sucursal_origen_id: 6, sucursal_destino_id: 1, estatus: "recibido", fecha_recepcion: "2026-08-03T20:00:00.000Z" },
      // en tránsito: NO debe contar
      { id: 2, producto_id: 1, cantidad: 10, costo: 50, sucursal_origen_id: 6, sucursal_destino_id: 1, estatus: "en_transito", fecha_recepcion: null },
    ] },
  };
}

test("saldo = depositado − mercancía recibida (a costo)", () => {
  const r = estadoCuenta(DBbase(), {}, TODAS);
  const s1 = r.resumen.find((x) => x.sucursal_id === 1);
  assert.strictEqual(s1.depositado, 10000);
  assert.strictEqual(s1.recibido, 5000, "100 × 50 (foto del costo), el en_transito no cuenta");
  assert.strictEqual(s1.saldo, 5000, "puso de más / a favor");
});

test("un traspaso en_transito NO cuenta como recibido", () => {
  const DB = DBbase();
  DB.inventario.traspasos = DB.inventario.traspasos.filter((t) => t.estatus === "en_transito");
  const r = estadoCuenta(DB, {}, TODAS);
  const s1 = r.resumen.find((x) => x.sucursal_id === 1);
  assert.strictEqual((s1?.recibido) || 0, 0);
});

test("sin foto de costo, usa el costo actual del producto", () => {
  const DB = DBbase();
  delete DB.inventario.traspasos[0].costo; // traspaso viejo
  const r = estadoCuenta(DB, {}, TODAS);
  const s1 = r.resumen.find((x) => x.sucursal_id === 1);
  assert.strictEqual(s1.recibido, 4000, "100 × 40 (costo actual del producto)");
});

test("el alcance oculta las tiendas de otras sucursales", () => {
  const DB = DBbase();
  DB.cuenta_comun.depositos.push({ id: 2, sucursal_id: 2, monto: 999, fecha: "2026-08-03", estatus: "activo", forma_pago: "EFECTIVO", folio: "DEP-0002" });
  const soloS1 = estadoCuenta(DB, {}, { verTodas: false, sucursalId: 1 });
  assert.ok(!soloS1.resumen.some((x) => x.sucursal_id === 2), "una cajera de la 1 no ve la 2");
});

test("el filtro usa la fecha LOCAL de la tienda (un traspaso de las 8pm cae en el día correcto)", () => {
  // fecha_recepcion 2026-08-03T20:00Z = 2pm local; usar rango de un día
  const r = estadoCuenta(DBbase(), { fecha_inicio: "2026-08-03", fecha_fin: "2026-08-03" }, TODAS);
  const s1 = r.resumen.find((x) => x.sucursal_id === 1);
  assert.strictEqual(s1.recibido, 5000, "el traspaso del 3 cae dentro del rango del 3");
});

test("pedir una sola sucursal devuelve el detalle de movimientos", () => {
  const r = estadoCuenta(DBbase(), { sucursal_id: 1 }, TODAS);
  assert.ok(Array.isArray(r.movimientos));
  assert.strictEqual(r.movimientos.length, 2, "1 depósito + 1 traspaso recibido");
});

test("CEDIS no aparece como deudor (es el origen, no destino)", () => {
  const r = estadoCuenta(DBbase(), {}, TODAS);
  assert.ok(!r.resumen.some((x) => x.sucursal_id === 6));
});
