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
 *  Acepta un Date, un string ISO, o nada (= ahora).
 *  Si `instante` es una fecha inválida (dato malformado), cae en HOY en vez de
 *  reventar: este helper alimenta fecha, fecha_alta, ultimo_contacto, etc. de
 *  ventas, cortes y gastos, y la única llamada que recibe un dato de fuera del
 *  sistema (orden.date_created de MercadoLibre) no debe poder tumbar toda una
 *  importación por un ISO malformado — en un punto de venta, una fecha de
 *  respaldo es preferible a que se caiga la operación. */
function fechaLocal(instante) {
  const d = instante ? new Date(instante) : new Date();
  return formateador.format(isNaN(d.getTime()) ? new Date() : d);
}

/** Marca de tiempo completa, en UTC. Se mantiene tal cual a propósito. */
function ahora() {
  return new Date().toISOString();
}

// Igual que `formateador` pero con hora y minuto. hourCycle "h23" evita el
// "24:00" que en-CA produce a medianoche con hour12:false.
const formateadorMomento = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONA_TIENDA,
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

/**
 * Fecha Y hora de la tienda, ya partidas. Lo usa el reloj de respaldos para
 * saber si son las 4 o las 5 de la tarde EN CHIAPAS — no en UTC, que es donde
 * corre Render. Sin esto, los "puntos del día" caerían a las 10 de la mañana.
 *
 * Acepta Date, string ISO, milisegundos, o nada (= ahora).
 */
function momentoLocal(instante) {
  const d = instante === undefined || instante === null ? new Date() : new Date(instante);
  const valido = isNaN(d.getTime()) ? new Date() : d;
  const partes = Object.fromEntries(
    formateadorMomento.formatToParts(valido).map((p) => [p.type, p.value])
  );
  const hora = Number(partes.hour);
  const minuto = Number(partes.minute);
  return {
    fecha: `${partes.year}-${partes.month}-${partes.day}`,
    hora, minuto,
    hhmm: `${partes.hour}:${partes.minute}`,
  };
}

module.exports = { fechaLocal, ahora, momentoLocal, ZONA_TIENDA };
