/**
 * respaldoReloj.js — Decide CUÁNDO toca respaldar. Nada más.
 *
 * Función pura: recibe el estado guardado y la hora, devuelve un veredicto. No
 * toca red, ni disco, ni Date.now() por su cuenta. Por eso se prueba entera.
 *
 * LA IDEA CENTRAL: no confía en el reloj, confía en el REGISTRO. No se programa
 * "a las 3:00 en punto" — se pregunta "¿cuánto hace que no respaldo?". Con un
 * horario fijo, un redespliegue a las 2:59 se come el respaldo de las 3 y nadie
 * se entera hasta que hace falta. Preguntando por el atraso, el proceso se pone
 * al corriente solo en cuanto vuelve a estar vivo.
 */

const { momentoLocal } = require("./fechas");

const UNA_HORA_MS = 60 * 60 * 1000;
/** Las horas (de Chiapas) cuyo respaldo se marca como punto de restauración del
 *  día y se conserva 30 días. Las pidió Victor así. */
const HORAS_PUNTO_DIA = [16, 17];
/** Cada cuánto se hace la pregunta. Más fino que la hora a propósito: así el
 *  atraso tras un reinicio se corrige en minutos, no en una hora. */
const INTERVALO_REVISION_MS = 5 * 60 * 1000;

function yaExistePuntoDelDia(copias, fecha, hora) {
  return (copias || []).some(
    (c) =>
      c &&
      c.tipo === "dia" &&
      c.fecha === fecha &&
      c.estado === "ok" &&
      Number(String(c.hora_local).slice(0, 2)) === hora
  );
}

/**
 * @param {object} estado  DB.respaldos ({ ultimo_exitoso, copias })
 * @param {number} ahoraMs milisegundos
 * @returns {{respaldar: boolean, tipo: "hora"|"dia"|null, motivo: string}}
 */
function debeRespaldar(estado, ahoraMs = Date.now()) {
  const m = momentoLocal(ahoraMs);
  const esPuntoDia = HORAS_PUNTO_DIA.includes(m.hora);
  const tipo = esPuntoDia ? "dia" : "hora";
  const copias = estado?.copias || [];

  // 1) Un punto del día que todavía no existe se toma AUNQUE no haya pasado la
  //    hora completa. Si el proceso respaldó a las 15:59 por un reinicio, la
  //    regla general dejaría pasar las 4 pm — y ese es de los que se guardan 30
  //    días, no uno cualquiera.
  if (esPuntoDia && !yaExistePuntoDelDia(copias, m.fecha, m.hora)) {
    return { respaldar: true, tipo: "dia", motivo: `punto del día de las ${m.hhmm}` };
  }

  // 2) Regla general: ¿pasó una hora desde el último respaldo que SÍ subió?
  const ultimo = estado?.ultimo_exitoso ? Date.parse(estado.ultimo_exitoso) : NaN;
  if (!Number.isFinite(ultimo)) {
    // Sin registro válido (primer arranque, o dato corrupto) se respalda. Falla
    // ABIERTO a propósito: una copia de más no le hace daño a nadie; una de
    // menos es exactamente el desastre que este módulo existe para evitar.
    return { respaldar: true, tipo, motivo: "sin registro de respaldo previo" };
  }

  const transcurrido = ahoraMs - ultimo;
  if (transcurrido >= UNA_HORA_MS) {
    const minutos = Math.floor(transcurrido / 60000);
    return { respaldar: true, tipo, motivo: `${minutos} minutos desde el último respaldo` };
  }

  return { respaldar: false, tipo: null, motivo: "al corriente" };
}

module.exports = { debeRespaldar, UNA_HORA_MS, HORAS_PUNTO_DIA, INTERVALO_REVISION_MS };
