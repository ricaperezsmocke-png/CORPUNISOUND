/**
 * corteEpoca.js — La frontera entre el corte viejo y el corte sellado.
 *
 * `DB.pos.corte_epoca` es el instante en que este sistema empezó a registrar en
 * qué corte se contó cada movimiento, en vez de deducirlo del reloj. Todo lo
 * anterior conserva la regla vieja —"posterior al último corte de esa caja"— y
 * todo lo posterior se rige por su sello `corte_id`.
 *
 * POR QUÉ ESTE ARCHIVO EXISTE. La comparación estaba escrita cuatro veces:
 * en las ventas del turno, en los abonos, en los gastos y en la corrección de
 * caja de una venta. Cuatro copias de la misma frontera es cuatro
 * oportunidades de que se separen, y una frontera que no coincide consigo
 * misma deja movimientos que ningún corte reclama. Aquí hay una sola.
 *
 * LA FRONTERA ES INCLUSIVA, y no es una sutileza de operador. La época se fija
 * al arrancar con la hora del servidor, y la primera venta de ese arranque
 * puede caer en el MISMO milisegundo. Con una frontera exclusiva esa venta se
 * iba por la rama histórica: si su caja ya tenía un corte posterior, no la
 * reclamaba nadie y su importe desaparecía del calculado — el mismo hueco que
 * el sellado vino a cerrar, colándose por la puerta de atrás.
 */

/** El instante que marca el inicio de la era sellada, o null si aún no existe. */
function epocaDe(DB) {
  return DB.pos?.corte_epoca || null;
}

/**
 * ¿Este movimiento pertenece a la era sellada?
 *
 * Sin época todavía, nada lo es: el sistema entero sigue con la regla vieja,
 * que es exactamente como se comportaba antes de este trabajo.
 */
function esDeLaEraSellada(fechaHora, DB) {
  const epoca = epocaDe(DB);
  return Boolean(epoca && fechaHora >= epoca);
}

/**
 * Una época en el futuro haría que todo movimiento nuevo se comportara como
 * histórico, reabriendo los huecos que el sello cierra. No debería poder pasar
 * —se fija con la hora del servidor y no se vuelve a tocar— pero sí puede
 * llegar así al restaurar un respaldo de otra máquina. Se avisa a gritos en el
 * arranque en vez de operar en silencio con la contabilidad expuesta.
 */
function avisarSiLaEpocaEstaEnElFuturo(DB, avisar = console.error) {
  const epoca = epocaDe(DB);
  if (!epoca) return false;
  if (epoca <= new Date().toISOString()) return false;
  avisar(
    `🚨 La marca de agua de los cortes (corte_epoca = ${epoca}) está en el FUTURO. ` +
    "Mientras siga así, cada venta, abono y gasto nuevo se trata como histórico y puede " +
    "quedar fuera de todos los cortes. Suele venir de restaurar un respaldo de otra máquina."
  );
  return true;
}

module.exports = { epocaDe, esDeLaEraSellada, avisarSiLaEpocaEstaEnElFuturo };
