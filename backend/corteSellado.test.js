const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { sembrarCajas } = require("./cajas");
const { calcularCorteEnCurso, crearCorte } = require("./cortes");
const { cambiarCajaVenta, cancelarVenta } = require("./ventas");
const { avisarSiLaEpocaEstaEnElFuturo } = require("./corteEpoca");

const EPOCA = "2026-09-01T09:00:00.000Z";
const usuario = { id: 81, nombre: "Encargada Palenque" };

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

function cajasDe(DB) {
  return {
    administrativa: DB.pos.cajas.find((c) => c.sucursal_id === 4 && c.nombre === "Administrativa"),
    fiscal: DB.pos.cajas.find((c) => c.sucursal_id === 4 && c.nombre === "Fiscal"),
  };
}

function agregarVenta(DB, { id, caja_id, total, fecha_hora, estatus = "cerrada" }) {
  DB.pos.ventas.push({
    id,
    fecha: fecha_hora.slice(0, 10),
    fecha_hora,
    sucursal_id: 4,
    caja_id,
    cliente_id: 0,
    tipo_documento: "Ticket",
    metodo_pago: "EFECTIVO",
    total,
    estatus,
    corte_id: null,
  });
}

function cortar(DB, caja) {
  return crearCorte(DB, {
    sucursal_id: 4,
    caja_id: caja.id,
    usuario_id: usuario.id,
    usuario_nombre: usuario.nombre,
    contado: {},
    retiro: {},
  });
}

/**
 * Invariante reusable: cada peso de una venta cerrada posterior a la epoca
 * esta o sellado por exactamente un corte existente, o visible una sola vez
 * en uno de los turnos abiertos.
 */
function comprobarConservacion(DB) {
  const cajas = Object.values(cajasDe(DB));
  const posteriores = DB.pos.ventas.filter(
    (v) => v.estatus === "cerrada" && v.tipo_documento !== "Apartado" && v.fecha_hora > DB.pos.corte_epoca
  );
  const totalCobrado = posteriores.reduce((suma, v) => suma + v.total, 0);
  const cortesExistentes = new Set(DB.pos.cortes_caja.map((c) => c.id));
  const contadoPorCortes = posteriores
    .filter((v) => v.corte_id != null && cortesExistentes.has(v.corte_id))
    .reduce((suma, v) => suma + v.total, 0);
  const esperando = cajas.reduce(
    (suma, caja) => suma + calcularCorteEnCurso(DB, 4, caja.id).total_calculado,
    0
  );

  assert.strictEqual(contadoPorCortes + esperando, totalCobrado);
}

test("conserva el dinero al cortar A, mover una venta a B y cortar B", () => {
  const DB = prepararDB();
  const { administrativa: A, fiscal: B } = cajasDe(DB);
  agregarVenta(DB, { id: 1, caja_id: A.id, total: 100, fecha_hora: "2026-09-01T10:00:00.000Z" });
  cortar(DB, A);
  agregarVenta(DB, { id: 2, caja_id: A.id, total: 230, fecha_hora: "2026-09-01T10:10:00.000Z" });
  cambiarCajaVenta(DB, 2, B.id, usuario);
  cortar(DB, B);
  comprobarConservacion(DB);
});

test("conserva el dinero entre movimientos y cortes repetidos de ambas cajas", () => {
  const DB = prepararDB();
  const { administrativa: A, fiscal: B } = cajasDe(DB);
  agregarVenta(DB, { id: 1, caja_id: A.id, total: 110, fecha_hora: "2026-09-01T10:00:00.000Z" });
  agregarVenta(DB, { id: 2, caja_id: A.id, total: 220, fecha_hora: "2026-09-01T10:05:00.000Z" });
  cambiarCajaVenta(DB, 1, B.id, usuario);
  cortar(DB, A);
  agregarVenta(DB, { id: 3, caja_id: B.id, total: 330, fecha_hora: "2026-09-01T10:10:00.000Z" });
  cambiarCajaVenta(DB, 3, A.id, usuario);
  cortar(DB, A);
  cortar(DB, B);
  comprobarConservacion(DB);
});

test("conserva el dinero si B corta antes de recibir una venta de A", () => {
  const DB = prepararDB();
  const { administrativa: A, fiscal: B } = cajasDe(DB);
  agregarVenta(DB, { id: 1, caja_id: A.id, total: 410, fecha_hora: "2026-09-01T10:00:00.000Z" });
  cortar(DB, B);
  cambiarCajaVenta(DB, 1, B.id, usuario);
  cortar(DB, A);
  cortar(DB, B);
  comprobarConservacion(DB);
});

test("conserva solo lo posterior a la epoca aunque conviva con una venta historica pendiente", () => {
  const DB = prepararDB();
  const { administrativa: A, fiscal: B } = cajasDe(DB);
  agregarVenta(DB, { id: 1, caja_id: A.id, total: 90, fecha_hora: "2026-09-01T08:30:00.000Z" });
  agregarVenta(DB, { id: 2, caja_id: A.id, total: 120, fecha_hora: "2026-09-01T10:00:00.000Z" });
  agregarVenta(DB, { id: 3, caja_id: B.id, total: 240, fecha_hora: "2026-09-01T10:05:00.000Z" });
  cortar(DB, A);
  cortar(DB, B);
  assert.ok(DB.pos.cortes_caja.some((c) => c.id === DB.pos.ventas[0].corte_id));
  comprobarConservacion(DB);
});

test("una venta movida antes de cortar aparece una sola vez en la caja nueva", () => {
  const DB = prepararDB();
  const { administrativa: A, fiscal: B } = cajasDe(DB);
  agregarVenta(DB, { id: 1, caja_id: A.id, total: 175, fecha_hora: "2026-09-01T10:00:00.000Z" });
  cambiarCajaVenta(DB, 1, B.id, usuario);
  assert.strictEqual(calcularCorteEnCurso(DB, 4, A.id).ventas_incluidas, 0);
  assert.strictEqual(calcularCorteEnCurso(DB, 4, B.id).ventas_incluidas, 1);
});

test("cortar A no estampa una venta de B", () => {
  const DB = prepararDB();
  const { administrativa: A, fiscal: B } = cajasDe(DB);
  agregarVenta(DB, { id: 1, caja_id: B.id, total: 80, fecha_hora: "2026-09-01T10:00:00.000Z" });
  cortar(DB, A);
  assert.strictEqual(DB.pos.ventas[0].corte_id, null);
});

test("una venta anterior a la epoca no se cuenta dos veces", () => {
  const DB = prepararDB();
  const { administrativa: A } = cajasDe(DB);
  agregarVenta(DB, { id: 1, caja_id: A.id, total: 95, fecha_hora: "2026-09-01T08:30:00.000Z" });
  const primero = cortar(DB, A);
  const segundo = cortar(DB, A);
  assert.strictEqual(primero.total_calculado, 95);
  assert.strictEqual(segundo.total_calculado, 0);
  assert.strictEqual(DB.pos.ventas[0].corte_id, primero.id);
});

test("cancelar una venta despues de contarla no cambia el corte cerrado", () => {
  const DB = prepararDB();
  const { administrativa: A } = cajasDe(DB);
  agregarVenta(DB, { id: 1, caja_id: A.id, total: 300, fecha_hora: "2026-09-01T10:00:00.000Z" });
  const corte = cortar(DB, A);
  cancelarVenta(DB, 1, "Devolucion");
  assert.strictEqual(corte.total_calculado, 300);
  assert.strictEqual(corte.ventas_incluidas, 1);
  assert.strictEqual(DB.pos.ventas[0].corte_id, corte.id);
});

test("el primer corte tras actualizar coincide con la regla historica", () => {
  const DB = prepararDB();
  const { administrativa: A } = cajasDe(DB);
  DB.pos.cortes_caja.push({
    id: 20,
    sucursal_id: 4,
    caja_id: A.id,
    fecha_hora: "2026-09-01T08:00:00.000Z",
  });
  agregarVenta(DB, { id: 1, caja_id: A.id, total: 50, fecha_hora: "2026-09-01T07:30:00.000Z" });
  agregarVenta(DB, { id: 2, caja_id: A.id, total: 125, fecha_hora: "2026-09-01T08:30:00.000Z" });
  agregarVenta(DB, { id: 3, caja_id: A.id, total: 275, fecha_hora: "2026-09-01T10:00:00.000Z" });
  assert.strictEqual(cortar(DB, A).total_calculado, 400);
});

test("abonos y gastos posteriores se sellan una vez y no se pierden", () => {
  const DB = prepararDB();
  const { administrativa: A, fiscal: B } = cajasDe(DB);
  DB.pos.apartado_abonos.push({
    id: 1, venta_id: 90, sucursal_id: 4, monto: 150, forma_pago: "EFECTIVO",
    fecha_hora: "2026-09-01T10:00:00.000Z", corte_id: null,
  });
  DB.gastos.gastos.push({
    id: 1, sucursal_id: 4, monto: 40, forma_pago: "EFECTIVO", estatus: "activo",
    fecha_hora: "2026-09-01T10:05:00.000Z", corte_id: null,
  });
  assert.strictEqual(calcularCorteEnCurso(DB, 4, B.id).total_calculado, 0);
  const primero = cortar(DB, A);
  assert.strictEqual(primero.total_calculado, 110);
  assert.strictEqual(DB.pos.apartado_abonos[0].corte_id, primero.id);
  assert.strictEqual(DB.gastos.gastos[0].corte_id, primero.id);
  assert.strictEqual(cortar(DB, A).total_calculado, 0);
});

test("abonos y gastos historicos sellados por el primer corte no reaparecen", () => {
  const DB = prepararDB();
  const { administrativa: A, fiscal: B } = cajasDe(DB);
  DB.pos.apartado_abonos.push({
    id: 1, venta_id: 90, sucursal_id: 4, monto: 200, forma_pago: "EFECTIVO",
    fecha_hora: "2026-09-01T08:30:00.000Z",
  });
  DB.gastos.gastos.push({
    id: 1, sucursal_id: 4, monto: 50, forma_pago: "EFECTIVO", estatus: "activo",
    fecha_hora: "2026-09-01T08:35:00.000Z",
  });
  const primero = cortar(DB, A);
  assert.strictEqual(primero.total_calculado, 150);
  assert.strictEqual(DB.pos.apartado_abonos[0].corte_id, primero.id);
  assert.strictEqual(DB.gastos.gastos[0].corte_id, primero.id);
  assert.strictEqual(calcularCorteEnCurso(DB, 4, B.id).total_calculado, 0);
});

module.exports = { comprobarConservacion };

/**
 * La frontera de la epoca es inclusiva, y esto no es una sutileza de operador.
 *
 * La epoca se fija al arrancar con la hora del servidor, y la primera venta de
 * ese arranque puede caer en el MISMO milisegundo. Con `>` esa venta se iba por
 * la rama historica: si su caja ya tenia un corte posterior, no la reclamaba
 * nadie y su importe desaparecia del calculado — exactamente el hueco que el
 * sellado vino a cerrar, colandose por la puerta de atras.
 *
 * Un movimiento que ocurre EN la epoca ya pertenece a la era sellada.
 */
test("una venta con la hora exacta de la epoca se rige por el sello, no por el reloj", () => {
  const DB = prepararDB();
  const { administrativa: A } = cajasDe(DB);

  // Un corte previo de esa caja, POSTERIOR a la epoca: mueve la frontera de
  // tiempo por delante de la venta que viene.
  agregarVenta(DB, { id: 1, caja_id: A.id, total: 55, fecha_hora: "2026-09-01T09:30:00.000Z" });
  crearCorte(DB, { sucursal_id: 4, caja_id: A.id, usuario_id: usuario.id, usuario_nombre: usuario.nombre, contado: { EFECTIVO: 55 } });

  // Y ahora la venta del milisegundo exacto de la epoca, todavia sin sellar.
  agregarVenta(DB, { id: 2, caja_id: A.id, total: 120, fecha_hora: EPOCA });

  const enCurso = calcularCorteEnCurso(DB, 4, A.id);

  assert.strictEqual(
    enCurso.calculado.EFECTIVO, 120,
    "con la frontera exclusiva esta venta no la reclamaba ningun corte y su importe se perdia"
  );
  assert.strictEqual(enCurso.ventas_incluidas, 1);
});

test("una marca de agua en el futuro se avisa a gritos en vez de operar en silencio", () => {
  const DB = prepararDB();
  DB.pos.corte_epoca = new Date(Date.now() + 86400000).toISOString(); // mañana

  const dichos = [];
  const aviso = avisarSiLaEpocaEstaEnElFuturo(DB, (m) => dichos.push(m));

  assert.strictEqual(aviso, true);
  assert.match(dichos.join(" "), /FUTURO/);
  assert.match(
    dichos.join(" "), /fuera de todos los cortes/,
    "el aviso tiene que decir la consecuencia, no solo que algo esta raro"
  );
});

test("una marca de agua normal no avisa nada", () => {
  const DB = prepararDB();
  const dichos = [];
  assert.strictEqual(avisarSiLaEpocaEstaEnElFuturo(DB, (m) => dichos.push(m)), false);
  assert.strictEqual(dichos.length, 0);
});
