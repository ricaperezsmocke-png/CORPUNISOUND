/**
 * fechas.js — La fecha del día en la tienda (Chiapas), para los filtros de
 * las pantallas.
 *
 * Sin esto, los filtros usaban `new Date().toISOString()`, que da la fecha en
 * UTC: después de las 6:00 pm hora local, "hoy" ya era mañana. El backend
 * ahora guarda las fechas en hora de la tienda (backend/fechas.js), así que
 * los filtros tienen que hablar el mismo idioma o dejarían fuera lo que se
 * acaba de capturar.
 *
 * Se fija la zona a propósito, en vez de usar la del navegador: así el
 * sistema se comporta igual desde cualquier computadora.
 */

export const ZONA_TIENDA = "America/Mexico_City";

// "en-CA" produce YYYY-MM-DD directo.
const formateador = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONA_TIENDA,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Fecha de hoy en la tienda, en formato YYYY-MM-DD. */
export function hoyLocal() {
  return formateador.format(new Date());
}

/** Fecha de hace n días en la tienda, en formato YYYY-MM-DD. */
export function haceDiasLocal(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return formateador.format(d);
}
