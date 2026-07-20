const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { reporteVentas } = require("./reportes");

const ALCANCE_TODAS = { verTodas: true, sucursalId: null };

test("reporteVentas: agrupa ventas vigentes y calcula totales", () => {
  const DB = construirDBPrueba();
  const r = reporteVentas(DB, { fecha_inicio: "2026-05-01", fecha_fin: "2026-06-30" }, ALCANCE_TODAS);

  assert.strictEqual(r.general.length, 3, "las 3 ventas semilla caen en el rango");
  assert.strictEqual(r.totales.numero_ventas, 3);
  assert.strictEqual(r.totales.total_vigente, 1200 + 800 + 2100);
  assert.strictEqual(r.totales.total_cancelado, 0);
});

test("reporteVentas: respeta el rango de fechas", () => {
  const DB = construirDBPrueba();
  const r = reporteVentas(DB, { fecha_inicio: "2026-06-01", fecha_fin: "2026-06-30" }, ALCANCE_TODAS);
  assert.strictEqual(r.general.length, 1, "solo la venta 3 (2026-06-05) cae en junio");
  assert.strictEqual(r.totales.total_vigente, 2100);
});

test("reporteVentas: separa canceladas y no las suma al total vigente", () => {
  const DB = construirDBPrueba();
  DB.pos.ventas[0].estatus = "cancelada";
  const r = reporteVentas(DB, { fecha_inicio: "2026-05-01", fecha_fin: "2026-06-30" }, ALCANCE_TODAS);
  assert.strictEqual(r.canceladas.length, 1);
  assert.strictEqual(r.totales.total_cancelado, 1200);
  assert.strictEqual(r.totales.total_vigente, 800 + 2100);
});

test("reporteVentas: agrupa por artículo sumando cantidad e importe", () => {
  const DB = construirDBPrueba();
  const r = reporteVentas(DB, { fecha_inicio: "2026-05-01", fecha_fin: "2026-06-30" }, ALCANCE_TODAS);
  const arroz = r.porArticulo.find((f) => f.producto === "Arroz 1kg");
  assert.ok(arroz, "debe aparecer Arroz 1kg (vendido en la venta 1)");
  assert.strictEqual(arroz.cantidad, 20);
  assert.strictEqual(arroz.importe, 500);
});

test("reporteVentas: agrupa por vendedor", () => {
  const DB = construirDBPrueba();
  const r = reporteVentas(DB, { fecha_inicio: "2026-05-01", fecha_fin: "2026-06-30" }, ALCANCE_TODAS);
  const ana = r.porVendedor.find((f) => f.vendedor === "Ana López");
  assert.ok(ana);
  assert.strictEqual(ana.numero_ventas, 1);
  assert.strictEqual(ana.total, 1200);
});

test("reporteVentas: respeta el alcance de sucursal", () => {
  const DB = construirDBPrueba();
  const alcanceSucursal1 = { verTodas: false, sucursalId: 1 };
  const r = reporteVentas(DB, { fecha_inicio: "2026-05-01", fecha_fin: "2026-06-30" }, alcanceSucursal1);
  assert.strictEqual(r.general.length, 1, "solo la venta de la sucursal 1");
  assert.strictEqual(r.general[0].id, 1);
});

test("reporteVentas: filtra por vendedor_id", () => {
  const DB = construirDBPrueba();
  const r = reporteVentas(DB, { fecha_inicio: "2026-05-01", fecha_fin: "2026-06-30", vendedor_id: 3 }, ALCANCE_TODAS);
  assert.strictEqual(r.general.length, 1);
  assert.strictEqual(r.general[0].vendedor_nombre, "María R.");
});
