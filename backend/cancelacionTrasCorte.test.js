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

/**
 * Todo lo que hay hoy en la base es historico: sin `corte_id`, porque ese sello
 * nacio con la rama de cajas. Si el aviso solo mira lo sellado, esta apagado
 * justo el primer mes — que es cuando la base es casi toda historica, cuando
 * mas probable es cancelar algo viejo, y cuando mas falta hace la explicacion.
 * La cajera cargaba con el faltante y el sistema callaba.
 */
test("una venta historica ya contada y cancelada despues si produce el aviso", () => {
  const DB = prepararDB();
  const A = caja(DB);
  DB.pos.ventas = [{
    id: 1, sucursal_id: 4, caja_id: null, corte_id: null,
    tipo_documento: "Ticket", estatus: "cancelada", metodo_pago: "EFECTIVO",
    fecha: "2026-08-20", fecha_hora: "2026-08-20T18:00:00.000Z", total: 500,
    fecha_hora_cancelacion: "2026-09-02T10:00:00.000Z",
  }];
  // El corte anterior de esta caja: cerro DESPUES de la venta, o sea la conto.
  DB.pos.cortes_caja = [{
    id: 1, sucursal_id: 4, caja_id: A.id, fecha: "2026-08-25",
    fecha_hora: "2026-08-25T00:00:00.000Z", total_calculado: 500, total_contado: 500,
    total_diferencia: 0, total_retiro: 0,
  }];

  const enCurso = calcularCorteEnCurso(DB, 4, A.id);

  assert.strictEqual(
    enCurso.cancelado_de_cortes_anteriores, 500,
    "sin sello, 'ya lo conto un corte' se deduce del reloj, con la misma frontera que ventasDelTurno"
  );
});

test("una venta historica que ningun corte alcanzo a contar no produce aviso", () => {
  const DB = prepararDB();
  const A = caja(DB);
  DB.pos.ventas = [{
    id: 2, sucursal_id: 4, caja_id: null, corte_id: null,
    tipo_documento: "Ticket", estatus: "cancelada", metodo_pago: "EFECTIVO",
    fecha: "2026-08-28", fecha_hora: "2026-08-28T18:00:00.000Z", total: 700,
    fecha_hora_cancelacion: "2026-09-02T10:00:00.000Z",
  }];
  DB.pos.cortes_caja = [{
    id: 1, sucursal_id: 4, caja_id: A.id, fecha: "2026-08-25",
    fecha_hora: "2026-08-25T00:00:00.000Z", total_calculado: 0, total_contado: 0,
    total_diferencia: 0, total_retiro: 0,
  }];

  const enCurso = calcularCorteEnCurso(DB, 4, A.id);

  assert.strictEqual(
    enCurso.cancelado_de_cortes_anteriores, 0,
    "avisar de dinero que ningun corte conto seria inventarle un descuadre a la cajera"
  );
});
