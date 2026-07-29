const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { crearGarantia } = require("./garantias");
const { reporteGastosGarantias } = require("./reportes");

const ALCANCE_TODAS = { verTodas: true, sucursalId: null };
const USUARIO = { nombre: "Victor" };

/**
 * Siembra gastos con fecha controlada (no usa agregarGasto, que estampa
 * new Date()) para que las pruebas de rango de fechas sean deterministas.
 */
function sembrarGasto(DB, garantiaId, { tipo, monto, fecha, descripcion = "", archivo = false }) {
  const id = DB.inventario.garantia_gastos.length + 1;
  DB.inventario.garantia_gastos.push({
    id,
    garantia_id: garantiaId,
    tipo,
    monto,
    descripcion,
    nombre_archivo: archivo ? "factura.pdf" : null,
    drive_file_id: archivo ? `file-${id}` : null,
    drive_link: archivo ? `https://drive.google.com/file/d/file-${id}/view` : null,
    usuario: "Victor",
    fecha,
  });
}

/** Dos garantías en sucursales distintas (1 Ocosingo, 2 Yajalón) con gastos. */
function escenario() {
  const DB = construirDBPrueba();
  const g1 = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO); // Ocosingo, Arroz 1kg
  const g2 = crearGarantia(DB, { producto_id: 2 }, 2, USUARIO); // Yajalón, Refresco 600ml
  sembrarGasto(DB, g1.id, { tipo: "traslado", monto: 150, fecha: "2026-07-10T12:00:00.000Z" });
  sembrarGasto(DB, g1.id, { tipo: "reparacion", monto: 500, fecha: "2026-07-15T12:00:00.000Z", descripcion: "Cambio de pastilla", archivo: true });
  sembrarGasto(DB, g2.id, { tipo: "traslado", monto: 200, fecha: "2026-07-20T12:00:00.000Z" });
  sembrarGasto(DB, g2.id, { tipo: "otro", monto: 75.5, fecha: "2026-08-02T12:00:00.000Z" });
  return { DB, g1, g2 };
}

test("reporteGastosGarantias: lista todos los gastos y suma el total", () => {
  const { DB } = escenario();
  const r = reporteGastosGarantias(DB, { fecha_inicio: "2026-07-01", fecha_fin: "2026-08-31" }, ALCANCE_TODAS);

  assert.strictEqual(r.general.length, 4);
  assert.strictEqual(r.totales.numero_gastos, 4);
  assert.strictEqual(r.totales.total, 150 + 500 + 200 + 75.5);
  assert.strictEqual(r.totales.numero_garantias, 2, "los 4 gastos vienen de 2 garantías distintas");
  assert.strictEqual(r.totales.numero_sin_comprobante, 3, "solo uno de los 4 trae comprobante");
});

test("reporteGastosGarantias: enriquece cada renglón con folio, sucursal, producto y etiqueta", () => {
  const { DB } = escenario();
  const r = reporteGastosGarantias(DB, {}, ALCANCE_TODAS);

  const reparacion = r.general.find((f) => f.tipo === "reparacion");
  assert.strictEqual(reparacion.folio, "G-0001");
  assert.strictEqual(reparacion.sucursal_nombre, "Ocosingo");
  assert.strictEqual(reparacion.producto_nombre, "Arroz 1kg");
  assert.strictEqual(reparacion.tipo_etiqueta, "Reparación");
  assert.strictEqual(reparacion.descripcion, "Cambio de pastilla");
  assert.ok(reparacion.drive_link, "el gasto con comprobante conserva su link de Drive");
  assert.strictEqual(reparacion.fecha, "2026-07-15", "la fecha se recorta a YYYY-MM-DD");

  const traslado = r.general.find((f) => f.sucursal_nombre === "Yajalón");
  assert.strictEqual(traslado.folio, "G-0002");
  assert.strictEqual(traslado.producto_nombre, "Refresco 600ml");
  assert.strictEqual(traslado.drive_link, null, "sin comprobante ⇒ link null");
});

test("reporteGastosGarantias: el general viene ordenado por fecha ascendente", () => {
  const { DB } = escenario();
  const r = reporteGastosGarantias(DB, {}, ALCANCE_TODAS);
  const fechas = r.general.map((f) => f.fecha);
  assert.deepStrictEqual(fechas, [...fechas].sort((a, b) => a.localeCompare(b)));
});

test("reporteGastosGarantias: respeta el rango de fechas", () => {
  const { DB } = escenario();
  const r = reporteGastosGarantias(DB, { fecha_inicio: "2026-07-01", fecha_fin: "2026-07-31" }, ALCANCE_TODAS);
  assert.strictEqual(r.general.length, 3, "el gasto de agosto queda fuera");
  assert.strictEqual(r.totales.total, 150 + 500 + 200);
});

test("reporteGastosGarantias: incluye los gastos del último día del rango (fecha ISO recortada)", () => {
  const { DB } = escenario();
  // El gasto de reparación es 2026-07-15T12:00:00.000Z. Sin recortar la hora,
  // "2026-07-15T12:00..." > "2026-07-15" y el renglón se perdería.
  const r = reporteGastosGarantias(DB, { fecha_inicio: "2026-07-15", fecha_fin: "2026-07-15" }, ALCANCE_TODAS);
  assert.strictEqual(r.general.length, 1);
  assert.strictEqual(r.general[0].monto, 500);
});

test("reporteGastosGarantias: filtra por tipo", () => {
  const { DB } = escenario();
  const r = reporteGastosGarantias(DB, { tipo: "traslado" }, ALCANCE_TODAS);
  assert.strictEqual(r.general.length, 2);
  assert.strictEqual(r.totales.total, 150 + 200);
  assert.ok(r.general.every((f) => f.tipo === "traslado"));
});

test("reporteGastosGarantias: agrupa por tipo ordenado por total descendente", () => {
  const { DB } = escenario();
  const r = reporteGastosGarantias(DB, {}, ALCANCE_TODAS);

  assert.deepStrictEqual(r.porTipo.map((f) => f.tipo), ["reparacion", "traslado", "otro"]);
  const traslado = r.porTipo.find((f) => f.tipo === "traslado");
  assert.strictEqual(traslado.numero_gastos, 2);
  assert.strictEqual(traslado.total, 350);
  assert.strictEqual(traslado.tipo_etiqueta, "Traslado");
});

test("reporteGastosGarantias: agrupa por sucursal ordenado por total descendente", () => {
  const { DB } = escenario();
  const r = reporteGastosGarantias(DB, {}, ALCANCE_TODAS);

  assert.deepStrictEqual(r.porSucursal.map((f) => f.sucursal), ["Ocosingo", "Yajalón"]);
  assert.strictEqual(r.porSucursal[0].total, 650);
  assert.strictEqual(r.porSucursal[0].numero_gastos, 2);
  assert.strictEqual(r.porSucursal[1].total, 275.5);
});

test("reporteGastosGarantias: un usuario amarrado solo ve los gastos de SU sucursal", () => {
  const { DB } = escenario();
  const r = reporteGastosGarantias(DB, {}, { verTodas: false, sucursalId: 2 });

  assert.strictEqual(r.general.length, 2, "solo los 2 gastos de la garantía de Yajalón");
  assert.strictEqual(r.totales.total, 275.5);
  assert.ok(r.general.every((f) => f.sucursal_nombre === "Yajalón"));
  assert.deepStrictEqual(r.porSucursal.map((f) => f.sucursal), ["Yajalón"]);
});

test("reporteGastosGarantias: un gasto huérfano (sin garantía existente) nunca se cuela", () => {
  const { DB } = escenario();
  sembrarGasto(DB, 999, { tipo: "otro", monto: 10000, fecha: "2026-07-11T12:00:00.000Z" });

  const r = reporteGastosGarantias(DB, {}, ALCANCE_TODAS);
  assert.strictEqual(r.general.length, 4, "el gasto huérfano se ignora");
  assert.strictEqual(r.totales.total, 150 + 500 + 200 + 75.5);
});

test("reporteGastosGarantias: sin gastos regresa estructura vacía en ceros", () => {
  const DB = construirDBPrueba();
  const r = reporteGastosGarantias(DB, {}, ALCANCE_TODAS);

  assert.deepStrictEqual(r.general, []);
  assert.deepStrictEqual(r.porTipo, []);
  assert.deepStrictEqual(r.porSucursal, []);
  assert.strictEqual(r.totales.numero_gastos, 0);
  assert.strictEqual(r.totales.numero_garantias, 0);
  assert.strictEqual(r.totales.total, 0);
  assert.strictEqual(r.totales.numero_sin_comprobante, 0);
});
