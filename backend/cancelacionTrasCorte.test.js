const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { sembrarCajas } = require("./cajas");
const { calcularCorteEnCurso, crearCorte } = require("./cortes");
const { cancelarVenta } = require("./ventas");

const EPOCA = "2026-09-01T09:00:00.000Z";
const usuario = { id: 7, nombre: "Encargada" };

function prepararDB() {
  const DB = construirDBPrueba();
  DB.pos.ventas = [];
  DB.pos.venta_detalle = [];
  DB.pos.cortes_caja = [];
  DB.pos.apartado_abonos = [];
  DB.pos.cajas = [];
  DB.pos.corte_epoca = EPOCA;
  DB.gastos.gastos = [];
  sembrarCajas(DB);
  return DB;
}

function caja(DB, nombre = "Administrativa") {
  return DB.pos.cajas.find((c) => c.sucursal_id === 4 && c.nombre === nombre);
}

function venderYCortar(DB, total) {
  const A = caja(DB);
  DB.pos.ventas.push({
    id: 1, fecha: "2026-09-01", fecha_hora: "2026-09-01T10:00:00.000Z",
    sucursal_id: 4, caja_id: A.id, cliente_id: 0, tipo_documento: "Ticket",
    metodo_pago: "EFECTIVO", total, estatus: "cerrada", corte_id: null,
  });
  crearCorte(DB, {
    sucursal_id: 4, caja_id: A.id, usuario_id: usuario.id,
    usuario_nombre: usuario.nombre, contado: { EFECTIVO: total },
  });
  return A;
}

/**
 * El caso que encontro la auditoria. Cancelar una venta YA CONTADA en un corte
 * cerrado no puede tocar ese corte —su foto esta congelada a proposito— pero si
 * hubo devolucion de efectivo, el cajon tiene menos dinero del que el siguiente
 * corte espera, y hoy nada lo explicaba.
 *
 * NO se construye un contramovimiento: en esta tienda devolver efectivo es
 * excepcional, y meter maquinaria en el camino del dinero para un caso raro es
 * peor que el problema. Lo que se hace es dejar RASTRO para que ese faltante se
 * pueda explicar en cinco segundos en vez de buscar dinero que nadie robo.
 */
test("cancelar una venta ya cortada no altera el corte cerrado", () => {
  const DB = prepararDB();
  venderYCortar(DB, 500);
  const corteAntes = JSON.parse(JSON.stringify(DB.pos.cortes_caja[0]));

  cancelarVenta(DB, 1, "El cliente se arrepintio", usuario);

  assert.deepStrictEqual(
    DB.pos.cortes_caja[0], corteAntes,
    "un corte cerrado es una foto congelada: nada posterior puede moverlo"
  );
});

test("cancelar deja constancia de cuando y de quien, no solo del motivo", () => {
  const DB = prepararDB();
  venderYCortar(DB, 500);

  const antes = new Date().toISOString();
  cancelarVenta(DB, 1, "Error de captura", usuario);
  const venta = DB.pos.ventas[0];

  assert.ok(venta.fecha_hora_cancelacion >= antes, "sin la hora no se sabe a que turno afecto");
  assert.strictEqual(venta.cancelada_por, usuario.nombre);
});

test("el corte en curso avisa del dinero cancelado que ya habia sido contado", () => {
  const DB = prepararDB();
  const A = venderYCortar(DB, 500);

  cancelarVenta(DB, 1, "El cliente se arrepintio", usuario);
  const enCurso = calcularCorteEnCurso(DB, 4, A.id);

  assert.strictEqual(
    enCurso.cancelado_de_cortes_anteriores, 500,
    "si el cajon sale corto por una devolucion, el corte tiene que poder explicarlo"
  );
});

test("una cancelacion de una venta NO cortada no aparece en el aviso", () => {
  const DB = prepararDB();
  const A = caja(DB);
  DB.pos.ventas.push({
    id: 2, fecha: "2026-09-01", fecha_hora: "2026-09-01T11:00:00.000Z",
    sucursal_id: 4, caja_id: A.id, cliente_id: 0, tipo_documento: "Ticket",
    metodo_pago: "EFECTIVO", total: 300, estatus: "cerrada", corte_id: null,
  });

  cancelarVenta(DB, 2, "Error de captura", usuario);
  const enCurso = calcularCorteEnCurso(DB, 4, A.id);

  assert.strictEqual(
    enCurso.cancelado_de_cortes_anteriores, 0,
    "esa venta nunca se conto, asi que su cancelacion no descuadra nada"
  );
});
