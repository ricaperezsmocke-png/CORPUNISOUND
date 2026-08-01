/**
 * fechas.js — Única fuente de verdad de "qué día es en la tienda".
 *
 * El sistema corre en Render, cuyo reloj está en UTC, pero las tiendas están
 * en Chiapas (UTC-6). Calcular la fecha con `new Date().toISOString()` hacía
 * que TODO lo capturado a partir de las 6:00 pm quedara con la fecha del día
 * siguiente: un gasto del 31 de julio a las 8 de la noche se contaba en
 * agosto. Como la regla de operación es capturar los gastos al cerrar el
 * corte —de noche—, eso afectaba a la mayoría de los registros.
 *
 * Se usa la zona IANA y no un "-6" escrito a mano: México quitó el horario de
 * verano en 2022, pero si eso vuelve a cambiar la zona se ajusta sola.
 *
 * OJO: aquí solo se resuelven las fechas SOLAS (YYYY-MM-DD). Las marcas de
 * tiempo completas siguen en UTC a propósito — son instantes, son correctas, y
 * el corte de caja compara `fecha_hora > desde` entre ellas.
 */

const ZONA_TIENDA = "America/Mexico_City";

// "en-CA" produce YYYY-MM-DD directo, que es justo el formato que el sistema
// guarda y compara como texto.
const formateador = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONA_TIENDA,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Fecha del día en la tienda, en formato YYYY-MM-DD.
 *  Acepta un Date, un string ISO, o nada (= ahora). */
function fechaLocal(instante) {
  const d = instante ? new Date(instante) : new Date();
  return formateador.format(d);
}

/** Marca de tiempo completa, en UTC. Se mantiene tal cual a propósito. */
function ahora() {
  return new Date().toISOString();
}

module.exports = { fechaLocal, ahora, ZONA_TIENDA };
