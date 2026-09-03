/**
 * cortes.js — Corte de Caja por turno, como en SICAR.
 *
 * El flujo real del negocio: al terminar un turno (o salir a comer), la
 * cajera hace su corte — cuenta el dinero físico (Contado), el sistema le
 * dice cuánto DEBERÍA haber según las ventas del turno (Calculado), se ve
 * la Diferencia, se registra el Retiro (dinero que se guarda), y la
 * siguiente cajera empieza de cero.
 *
 * Antes de corte_epoca, "el turno" conserva la ventana histórica posterior
 * al último corte. Después de corte_epoca, cada movimiento pendiente se
 * reconoce por corte_id null y crearCorte registra el corte que lo contó.
 */

const { gastosEfectivoDelTurno, gastosEfectivoDelTurnoLista } = require("./gastos");
const { fechaLocal } = require("./fechas");
const { resolverCajaDeSucursal, esDeEstaCaja } = require("./cajas");
const { esDeLaEraSellada } = require("./corteEpoca");

function siguienteId(lista) {
  return lista.length ? Math.max(...lista.map((x) => x.id)) + 1 : 1;
}

const FORMAS_CORTE = ["EFECTIVO", "CHEQUE", "VALES", "TARJETA"];

function fechaHoraDeVenta(v) {
  // Ventas viejas no tienen fecha_hora — se toman como el inicio de su día
  return v.fecha_hora || `${v.fecha}T00:00:00.000Z`;
}

/** Ventas del turno en curso: cerradas y de la caja.
 *  Excluye Apartados — su dinero se cuenta por abono real (ver abonosDelTurno),
 *  nunca por el total completo de la venta, para no duplicarlo al liquidarse.
 *  La época mantiene intacta la ventana histórica y hace que las ventas nuevas
 *  dependan solo del sello, nunca de una frontera móvil de tiempo. */
function ventasDelTurno(DB, sucursal_id, caja) {
  // `caja` puede venir en null: es una base sin catálogo de cajas sembrado.
  // Ahí el concepto de caja no existe, así que no puede cambiar nada — el turno
  // vuelve a ser "toda la sucursal desde su último corte", exactamente como
  // antes de este trabajo. Sin este camino, al hacer que la resolución
  // devolviera null se cayeron de golpe 13 pruebas del dinero: apartados,
  // gastos y el calculado del turno.
  const cortes = DB.pos.cortes_caja.filter(
    (c) => c.sucursal_id === Number(sucursal_id) && esDeEstaCaja(c, caja)
  );
  const ultimoCorte = cortes.length ? cortes.reduce((a, b) => (a.fecha_hora > b.fecha_hora ? a : b)) : null;
  const desde = ultimoCorte ? ultimoCorte.fecha_hora : null;

  return {
    desde,
    ventas: DB.pos.ventas.filter(
      (v) =>
        v.estatus === "cerrada" &&
        v.tipo_documento !== "Apartado" &&
        v.sucursal_id === Number(sucursal_id) &&
        esDeEstaCaja(v, caja) &&
        (() => {
          const fechaHora = fechaHoraDeVenta(v);
          if (esDeLaEraSellada(fechaHora, DB)) return v.corte_id == null;
          return v.corte_id == null && (!desde || fechaHora > desde);
        })()
    ),
  };
}

/**
 * Abonos de esta caja; los que no tienen caja los absorbe la predeterminada.
 *
 * Los abonos nuevos conservan la caja donde se cobraron. Los históricos sin
 * caja pertenecen a la predeterminada para no contarlos dos veces. Sin
 * catálogo (`caja` en null) se cuentan todos, como siempre: el dinero de un
 * abono no puede desaparecer porque falte un catálogo.
 */
function abonosDelTurno(DB, sucursal_id, desde, caja) {
  return DB.pos.apartado_abonos.filter(
    (a) =>
      a.sucursal_id === Number(sucursal_id) &&
      esDeEstaCaja(a, caja) &&
      (esDeLaEraSellada(a.fecha_hora, DB)
        ? a.corte_id == null
        : a.corte_id == null && (!desde || a.fecha_hora > desde))
  );
}

/** Suma `monto` a `calculado[forma]` si es una de las 4 formas físicas del
 *  corte; si no, regresa el delta correspondiente a transferencias/crédito
 *  (o cae a EFECTIVO si la forma no se reconoce) — mismo criterio que ya
 *  usaba calcularCorteEnCurso para ventas, ahora compartido con abonos. */
function acumularPorFormaPago(calculado, forma, monto) {
  if (calculado[forma] !== undefined) {
    calculado[forma] += monto;
    return { transferencias: 0, credito: 0 };
  }
  // Un pago de MercadoLibre es electrónico: nunca está físicamente en el
  // cajón, así que se informa junto con las transferencias y no en calculado.
  if (forma === "TRANSFERENCIA" || forma === "MERCADOLIBRE") {
    return { transferencias: monto, credito: 0 };
  }
  if (forma === "CRÉDITO" || forma === "CREDITO") return { transferencias: 0, credito: monto };
  calculado.EFECTIVO += monto;
  return { transferencias: 0, credito: 0 };
}

/** Lo que el sistema calcula que debería haber en caja, por forma de pago */
function calcularCorteEnCurso(DB, sucursal_id, caja_id, incluirMovimientos = false) {
  const caja = resolverCajaDeSucursal(DB, sucursal_id, caja_id);
  const { desde, ventas } = ventasDelTurno(DB, sucursal_id, caja);
  const abonos = abonosDelTurno(DB, sucursal_id, desde, caja);

  const calculado = { EFECTIVO: 0, CHEQUE: 0, VALES: 0, TARJETA: 0 };
  let transferencias = 0;
  let credito = 0;

  ventas.forEach((v) => {
    const r = acumularPorFormaPago(calculado, (v.metodo_pago || "EFECTIVO").toUpperCase(), v.total);
    transferencias += r.transferencias;
    credito += r.credito;
  });
  abonos.forEach((a) => {
    const r = acumularPorFormaPago(calculado, (a.forma_pago || "EFECTIVO").toUpperCase(), a.monto);
    transferencias += r.transferencias;
    credito += r.credito;
  });

  const redondear = (n) => Math.round(n * 100) / 100;
  FORMAS_CORTE.forEach((f) => (calculado[f] = redondear(calculado[f])));

  // Los gastos pagados con efectivo de la caja SALIERON de la caja: si no se
  // restan aquí, al contar el dinero aparecen como faltante y se ven igual
  // que un robo. Solo restan los activos, en EFECTIVO, de esta sucursal y de
  // este turno (ver gastosEfectivoDelTurno).
  const gastosDelTurno = gastosEfectivoDelTurnoLista(DB, sucursal_id, desde, caja);
  const gastosEfectivo = gastosEfectivoDelTurno(DB, sucursal_id, desde, caja);
  const gastosIncluidos = gastosDelTurno.length;
  calculado.EFECTIVO = redondear(calculado.EFECTIVO - gastosEfectivo);

  const resultado = {
    desde,
    ventas_incluidas: ventas.length,
    abonos_incluidos: abonos.length,
    calculado,
    total_calculado: redondear(FORMAS_CORTE.reduce((a, f) => a + calculado[f], 0)),
    transferencias: redondear(transferencias),
    credito: redondear(credito),
    gastos_efectivo: gastosEfectivo,
    gastos_incluidos: gastosIncluidos,
  };
  if (incluirMovimientos) resultado.movimientos_incluidos = { ventas, abonos, gastos: gastosDelTurno };
  return resultado;
}

/** Guarda el corte: congela el calculado del momento, registra contado/retiro/diferencias */
function crearCorte(DB, { sucursal_id, caja_id, usuario_id, usuario_nombre, contado = {}, retiro = {} }) {
  // Sin sucursal no se adivina: antes caía a la 1, y el corte cerraba el turno
  // de Ocosingo con el efectivo contado en otra tienda — faltante inventado en
  // una y turno cerrado en la otra sin que nadie lo pidiera.
  const sucursalDelCorte = Number(sucursal_id);
  if (!Number.isInteger(sucursalDelCorte) || sucursalDelCorte <= 0) {
    throw new Error("Falta la sucursal de la que es este corte de caja");
  }
  // Sin catálogo de cajas el corte se guarda con `caja_id: null`, que es
  // exactamente lo que ya tienen los cortes históricos. Nunca se impide cortar
  // por un problema de catálogo: la caja es un dato del corte, no un permiso.
  const caja = resolverCajaDeSucursal(DB, sucursalDelCorte, caja_id);
  const enCurso = calcularCorteEnCurso(DB, sucursalDelCorte, caja?.id ?? null, true);

  const redondear = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const contadoLimpio = {};
  const retiroLimpio = {};
  const diferencia = {};
  FORMAS_CORTE.forEach((f) => {
    contadoLimpio[f] = redondear(contado[f]);
    retiroLimpio[f] = redondear(retiro[f]);
    diferencia[f] = redondear(contadoLimpio[f] - enCurso.calculado[f]);
  });

  const corte = {
    id: siguienteId(DB.pos.cortes_caja),
    sucursal_id: sucursalDelCorte,
    caja_id: caja?.id ?? null,
    usuario_id: usuario_id ?? null,
    usuario_nombre: usuario_nombre || "—",
    fecha: fechaLocal(),
    fecha_hora: new Date().toISOString(),
    desde: enCurso.desde,
    ventas_incluidas: enCurso.ventas_incluidas,
    abonos_incluidos: enCurso.abonos_incluidos,
    calculado: enCurso.calculado,
    contado: contadoLimpio,
    diferencia,
    retiro: retiroLimpio,
    total_calculado: enCurso.total_calculado,
    gastos_efectivo: enCurso.gastos_efectivo,
    gastos_incluidos: enCurso.gastos_incluidos,
    total_contado: redondear(FORMAS_CORTE.reduce((a, f) => a + contadoLimpio[f], 0)),
    total_retiro: redondear(FORMAS_CORTE.reduce((a, f) => a + retiroLimpio[f], 0)),
    transferencias: enCurso.transferencias,
    credito: enCurso.credito,
  };
  corte.total_diferencia = redondear(corte.total_contado - corte.total_calculado);

  // No hay await entre el cálculo, estos sellos y el alta del corte. La ruta
  // persiste después la fotografía completa de DB en una sola escritura.
  enCurso.movimientos_incluidos.ventas.forEach((venta) => (venta.corte_id = corte.id));
  enCurso.movimientos_incluidos.abonos.forEach((abono) => (abono.corte_id = corte.id));
  enCurso.movimientos_incluidos.gastos.forEach((gasto) => (gasto.corte_id = corte.id));
  DB.pos.cortes_caja.push(corte);
  return corte;
}

/**
 * Corte a ciegas: sin "ver_montos_corte" el cajero cuenta el dinero físico
 * sin ver cuánto "debería" haber, así no puede ajustar su conteo para que
 * "cuadre" a propósito. Se ponen en 0 calculado, total_calculado,
 * transferencias, crédito y ventas_incluidas (server-side, para que ni por
 * curl se vea el real). El POST /api/cortes no pasa por aquí: el corte
 * siempre se guarda con los montos reales, para que un administrativo
 * pueda revisar después en el historial si hubo faltantes.
 */
function filtrarCorteEnCursoPorPermiso(resultado, permisos) {
  if (Array.isArray(permisos) && permisos.includes("ver_montos_corte")) return resultado;
  const calculadoEnCero = {};
  FORMAS_CORTE.forEach((f) => (calculadoEnCero[f] = 0));
  return {
    desde: resultado.desde,
    ventas_incluidas: 0,
    abonos_incluidos: 0,
    calculado: calculadoEnCero,
    total_calculado: 0,
    transferencias: 0,
    credito: 0,
  };
}

function listarCortes(DB, sucursal_id) {
  let lista = [...DB.pos.cortes_caja];
  if (sucursal_id) lista = lista.filter((c) => c.sucursal_id === Number(sucursal_id));
  return lista.sort((a, b) => b.fecha_hora.localeCompare(a.fecha_hora));
}

module.exports = { calcularCorteEnCurso, crearCorte, listarCortes, filtrarCorteEnCursoPorPermiso, FORMAS_CORTE };
