/**
 * existenciasSicar.js — Funciones puras de la pantalla "Existencias SICAR".
 * Sin React: se prueban con `node --test`.
 */

const MIN = 60000;
const HORA = 60 * MIN;

const FORMATO_TIENDA = new Intl.DateTimeFormat("en-GB", {
  timeZone: "America/Mexico_City", year: "numeric", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

/** Año, día, mes, hora y minuto de un instante en America/Mexico_City (Chiapas), sin depender de la zona del navegador. */
function partesTienda(t) {
  const p = {};
  for (const x of FORMATO_TIENDA.formatToParts(new Date(t))) p[x.type] = x.value;
  return p;
}

/** "hace 3 min" / "hace 2 h" / "el 21/10 18:04" (pasadas 24 h). */
export function haceCuanto(iso, ahora = new Date()) {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return "nunca";
  const dif = ahora.getTime() - t;
  if (dif < MIN) return "hace unos segundos";
  if (dif < HORA) return `hace ${Math.floor(dif / MIN)} min`;
  if (dif < 24 * HORA) return `hace ${Math.floor(dif / HORA)} h`;
  return fechaCorta(t);
}

/** "el 21/10 18:04" en hora de Chiapas. */
function fechaCorta(t) {
  const p = partesTienda(t);
  return `el ${p.day}/${p.month} ${p.hour}:${p.minute}`;
}

/** "hoy 10:42" / "ayer 18:04" / "el 21/10 18:04", comparando el día en hora de Chiapas; "nunca" si no hay fecha. */
export function fechaTienda(iso, ahora = new Date()) {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return "nunca";
  const p = partesTienda(t);
  const hoy = partesTienda(ahora.getTime());
  // "ayer" usa ahora - 24 h: vale porque Ciudad de México ya no tiene horario de verano.
  const ayer = partesTienda(ahora.getTime() - 24 * HORA);
  const hora = `${p.hour}:${p.minute}`;
  if (p.year === hoy.year && p.day === hoy.day && p.month === hoy.month) return `hoy ${hora}`;
  if (p.year === ayer.year && p.day === ayer.day && p.month === ayer.month) return `ayer ${hora}`;
  return `el ${p.day}/${p.month} ${hora}`;
}

/** Texto visible bajo una existencia vencida: "sin confirmar desde ayer 18:04"; null si está confirmada. */
export function textoSinConfirmar(desde, ahora = new Date()) {
  const t = desde ? Date.parse(desde) : NaN;
  if (Number.isNaN(t)) return null;
  return `sin confirmar desde ${fechaTienda(desde, ahora)}`;
}

/** Clase de color de una celda: gris si no está confirmada, rojo si es negativa, gris claro si es cero. */
export function claseExistencia(existencia, sinConfirmarDesde) {
  const n = Number(existencia);
  if (sinConfirmarDesde) return "text-slate-400";
  if (n < 0) return "text-red-600 font-semibold";
  if (n === 0) return "text-slate-400";
  return "text-slate-900";
}

/** "3.0000" -> "3"; "2.5000" -> "2.5"; "-0.0250" -> "-0.025". */
export function formatoExistencia(texto) {
  if (texto === undefined || texto === null || texto === "") return "—";
  const n = Number(texto);
  if (Number.isNaN(n)) return "—";
  const limpio = String(texto).includes(".") ? String(texto).replace(/0+$/, "").replace(/\.$/, "") : String(texto);
  return limpio === "-0" ? "0" : limpio;
}

/** Aviso ámbar si el agente de la tienda lleva más de 24 h sin mandar nada; si no, null. */
export function avisoTienda(tienda, ahora = new Date()) {
  if (!tienda?.sin_contacto_24h) return null;
  const desde = haceCuanto(tienda.ultimo_contacto, ahora);
  return `El agente de esta tienda no ha enviado nada desde ${desde === "nunca" ? "que se registró" : desde}.`;
}

/** La página que el servidor dice que mostró (puede recortar una que ya no existe); si no la manda bien, la local. */
export function paginaDelServidor(local, datos) {
  const n = Number(datos?.pagina);
  return Number.isSafeInteger(n) && n >= 1 ? n : local;
}
