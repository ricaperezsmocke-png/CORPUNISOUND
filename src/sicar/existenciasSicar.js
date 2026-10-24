/**
 * existenciasSicar.js — Funciones puras de la pantalla "Existencias SICAR".
 * Sin React: se prueban con `node --test`.
 */

const MIN = 60000;
const HORA = 60 * MIN;

const dos = (n) => String(n).padStart(2, "0");

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

/** "el 21/10 18:04" en la hora local del navegador. */
function fechaCorta(t) {
  const d = new Date(t);
  return `el ${dos(d.getDate())}/${dos(d.getMonth() + 1)} ${dos(d.getHours())}:${dos(d.getMinutes())}`;
}

/** Texto visible bajo una existencia vencida: "sin confirmar desde el 21/10 18:04"; null si está confirmada. */
export function textoSinConfirmar(desde) {
  const t = desde ? Date.parse(desde) : NaN;
  if (Number.isNaN(t)) return null;
  return `sin confirmar desde ${fechaCorta(t)}`;
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
