const { test } = require("node:test");
const assert = require("node:assert");

const { construirDBPrueba } = require("./testHelpers");
const { reporteCancelaciones } = require("./reportes");

const TODAS = { verTodas: true, sucursalId: null };
const RANGO = { fecha_inicio: "2026-09-01", fecha_fin: "2026-09-30" };

function conCancelaciones(DB) {
  DB.pos.ventas = [
    {
      id: 1, sucursal_id: 1, tipo_documento: "Ticket", estatus: "cancelada", total: 8000,
      fecha: "2026-09-04", cancelada_por: "Gerente Ocosingo",
      fecha_hora_cancelacion: "2026-09-04T21:00:00.000Z", motivo_cancelacion: "cliente se arrepintio",
    },
    {
      id: 2, sucursal_id: 2, tipo_documento: "Apartado", estatus: "cancelada", total: 20000,
      fecha: "2026-09-03", cancelada_por: "Sistema (vencimiento automático)",
      fecha_hora_cancelacion: "2026-09-03T10:00:00.000Z", motivo_cancelacion: "Vencido — 60 días sin liquidar",
    },
    // Una venta viva: no es una cancelacion y no debe aparecer.
    { id: 3, sucursal_id: 1, tipo_documento: "Ticket", estatus: "cerrada", total: 500, fecha: "2026-09-04" },
    // Fuera del rango de fechas.
    {
      id: 4, sucursal_id: 1, tipo_documento: "Ticket", estatus: "cancelada", total: 300,
      fecha: "2026-08-01", cancelada_por: "Ana", fecha_hora_cancelacion: "2026-08-01T10:00:00.000Z",
    },
  ];
  return DB;
}

test("el reporte dice quien cancelo, cuando, cuanto y por que", () => {
  const DB = conCancelaciones(construirDBPrueba());

  const { filas } = reporteCancelaciones(DB, RANGO, TODAS);
  const fila = filas.find((f) => f.id === 1);

  assert.strictEqual(fila.cancelada_por, "Gerente Ocosingo");
  assert.strictEqual(fila.total, 8000);
  assert.strictEqual(fila.motivo_cancelacion, "cliente se arrepintio");
  assert.ok(fila.fecha_hora_cancelacion);
  assert.strictEqual(fila.sucursal_nombre, "Ocosingo");
});

/**
 * Los apartados cancelados SON cancelaciones y mueven el mismo dinero. Si el
 * reporte solo mirara tickets, el camino con menos rastro seria justo el que
 * queda fuera del reporte.
 */
test("los apartados cancelados tambien salen, distinguidos por tipo", () => {
  const DB = conCancelaciones(construirDBPrueba());

  const { filas } = reporteCancelaciones(DB, RANGO, TODAS);
  const apartado = filas.find((f) => f.id === 2);

  assert.ok(apartado, "el apartado cancelado tiene que aparecer");
  assert.strictEqual(apartado.tipo_documento, "Apartado");
  assert.match(apartado.cancelada_por, /sistema/i);
});

test("no aparece lo que no es una cancelacion ni lo que esta fuera del rango", () => {
  const DB = conCancelaciones(construirDBPrueba());

  const { filas } = reporteCancelaciones(DB, RANGO, TODAS);

  assert.deepStrictEqual(filas.map((f) => f.id).sort(), [1, 2]);
});

test("los totales suman lo cancelado en el periodo", () => {
  const DB = conCancelaciones(construirDBPrueba());

  const { totales } = reporteCancelaciones(DB, RANGO, TODAS);

  assert.strictEqual(totales.numero_cancelaciones, 2);
  assert.strictEqual(totales.total_cancelado, 28000);
});

/** Una cajera amarrada a su tienda no ve las cancelaciones de las demas. */
test("respeta el alcance de sucursal", () => {
  const DB = conCancelaciones(construirDBPrueba());

  const { filas } = reporteCancelaciones(DB, RANGO, { verTodas: false, sucursalId: 1 });

  assert.deepStrictEqual(filas.map((f) => f.id), [1]);
});

/**
 * Una cancelacion vieja, anterior a que se guardara el usuario, no puede
 * romper el reporte ni inventarse un culpable: se muestra como desconocido.
 */
test("una cancelacion sin usuario registrado no rompe el reporte", () => {
  const DB = construirDBPrueba();
  DB.pos.ventas = [{ id: 9, sucursal_id: 1, tipo_documento: "Ticket", estatus: "cancelada", total: 100, fecha: "2026-09-02" }];

  const { filas } = reporteCancelaciones(DB, RANGO, TODAS);

  assert.strictEqual(filas.length, 1);
  assert.strictEqual(filas[0].cancelada_por, "—");
});
