/**
 * cortes.js — Corte de Caja por turno, como en SICAR.
 *
 * El flujo real del negocio: al terminar un turno (o salir a comer), la
 * cajera hace su corte — cuenta el dinero físico (Contado), el sistema le
 * dice cuánto DEBERÍA haber según las ventas del turno (Calculado), se ve
 * la Diferencia, se registra el Retiro (dinero que se guarda), y la
 * siguiente cajera empieza de cero.
 *
 * "El turno" se define solo: son las ventas cerradas desde el último corte
 * de esa sucursal hasta ahora. Guardar un corte "cierra" el turno — el
 * siguiente cálculo parte de ese momento.
 */

function siguienteId(lista) {
  return lista.length ? Math.max(...lista.map((x) => x.id)) + 1 : 1;
}

const FORMAS_CORTE = ["EFECTIVO", "CHEQUE", "VALES", "TARJETA"];

function fechaHoraDeVenta(v) {
  // Ventas viejas no tienen fecha_hora — se toman como el inicio de su día
  return v.fecha_hora || `${v.fecha}T00:00:00.000Z`;
}

/** Ventas del turno en curso: cerradas, de la sucursal, posteriores al último corte */
function ventasDelTurno(DB, sucursal_id) {
  const cortes = DB.pos.cortes_caja.filter((c) => c.sucursal_id === Number(sucursal_id));
  const ultimoCorte = cortes.length ? cortes.reduce((a, b) => (a.fecha_hora > b.fecha_hora ? a : b)) : null;
  const desde = ultimoCorte ? ultimoCorte.fecha_hora : null;

  return {
    desde,
    ventas: DB.pos.ventas.filter(
      (v) =>
        v.estatus === "cerrada" &&
        v.sucursal_id === Number(sucursal_id) &&
        (!desde || fechaHoraDeVenta(v) > desde)
    ),
  };
}

/** Lo que el sistema calcula que debería haber en caja, por forma de pago */
function calcularCorteEnCurso(DB, sucursal_id) {
  const { desde, ventas } = ventasDelTurno(DB, sucursal_id);

  const calculado = { EFECTIVO: 0, CHEQUE: 0, VALES: 0, TARJETA: 0 };
  let transferencias = 0;
  let credito = 0;

  ventas.forEach((v) => {
    const metodo = (v.metodo_pago || "EFECTIVO").toUpperCase();
    if (calculado[metodo] !== undefined) calculado[metodo] += v.total;
    else if (metodo === "TRANSFERENCIA") transferencias += v.total;
    else if (metodo === "CRÉDITO" || metodo === "CREDITO") credito += v.total;
    else calculado.EFECTIVO += v.total; // formas no mapeadas caen a efectivo
  });

  const redondear = (n) => Math.round(n * 100) / 100;
  FORMAS_CORTE.forEach((f) => (calculado[f] = redondear(calculado[f])));

  return {
    desde,
    ventas_incluidas: ventas.length,
    calculado,
    total_calculado: redondear(FORMAS_CORTE.reduce((a, f) => a + calculado[f], 0)),
    transferencias: redondear(transferencias),
    credito: redondear(credito),
  };
}

/** Guarda el corte: congela el calculado del momento, registra contado/retiro/diferencias */
function crearCorte(DB, { sucursal_id, usuario_id, usuario_nombre, contado = {}, retiro = {} }) {
  const enCurso = calcularCorteEnCurso(DB, sucursal_id);

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
    sucursal_id: Number(sucursal_id) || 1,
    usuario_id: usuario_id ?? null,
    usuario_nombre: usuario_nombre || "—",
    fecha: new Date().toISOString().slice(0, 10),
    fecha_hora: new Date().toISOString(),
    desde: enCurso.desde,
    ventas_incluidas: enCurso.ventas_incluidas,
    calculado: enCurso.calculado,
    contado: contadoLimpio,
    diferencia,
    retiro: retiroLimpio,
    total_calculado: enCurso.total_calculado,
    total_contado: redondear(FORMAS_CORTE.reduce((a, f) => a + contadoLimpio[f], 0)),
    total_retiro: redondear(FORMAS_CORTE.reduce((a, f) => a + retiroLimpio[f], 0)),
    transferencias: enCurso.transferencias,
    credito: enCurso.credito,
  };
  corte.total_diferencia = redondear(corte.total_contado - corte.total_calculado);

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
