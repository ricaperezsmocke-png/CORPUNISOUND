/**
 * cortesSicar.js — Funciones puras de las pantallas "Cortes SICAR" y "Personal de SICAR".
 * Sin React: se prueban con `node --test`. Las cifras son las de SICAR; aquí solo se presentan.
 */

const FORMAS_PAGO = {
  1: "Efectivo", 2: "Cheque", 3: "Crédito", 4: "Transferencia", 5: "Vales", 6: "Tarjeta", 7: "Anticipo", 8: "SICAR Pagos",
};
const UMBRAL = 100n;

/** Cuántos centavos enteros tiene un texto "-12.34"; null si no es un importe válido. */
function centavos(texto) {
  const m = /^(-?)(\d+)\.(\d{2})$/.exec(String(texto ?? ""));
  if (!m) return null;
  const v = BigInt(m[2]) * 100n + BigInt(m[3]);
  return m[1] === "-" ? -v : v;
}

/** "Usuario SICAR 52 — sin nombre" / "Fulana (SICAR 52)" / "Ventas sin usuario registrado". */
export function textoPersona(p) {
  if (!p) return "—";
  if (p.usu_id === "" || p.usu_id === undefined || p.usu_id === null) return "Ventas sin usuario registrado";
  return p.nombre ? `${p.nombre} (SICAR ${p.usu_id})` : `Usuario SICAR ${p.usu_id} — sin nombre`;
}

/** Color de la diferencia (contado − calculado): ámbar faltante, azul sobrante, tenue si es menor a $1. */
export function claseDiferencia(texto) {
  const c = centavos(texto);
  if (c === null || c === 0n) return "text-slate-900";
  const grande = c >= UMBRAL || c <= -UMBRAL;
  if (c < 0n) return grande ? "text-amber-700 font-semibold" : "text-amber-500";
  return grande ? "text-blue-700 font-semibold" : "text-blue-400";
}

/** Frase fija sobre de quién es la diferencia del turno: dice solo lo que se sabe; ante la duda, no culpa a nadie. */
export function textoAtribucion(corte) {
  switch (corte?.atribucion) {
    case "propia": return `Del turno de ${textoPersona(corte.atribuida_a)}, que fue la única persona que cobró`;
    case "compartida": return "Cobraron varias personas o hay ventas sin usuario registrado: no se atribuye a nadie";
    case "sin_usuario": return "Las ventas del turno no tienen usuario registrado en SICAR: no se atribuye a nadie";
    case "sin_ventas": return "SICAR no registró cobros para este turno: no se atribuye a nadie";
    default: return "No se atribuye a nadie";
  }
}

/**
 * Numera las peticiones de la pantalla: una respuesta solo se muestra si sigue siendo la de la última petición.
 * Así una consulta vieja que llega tarde no tapa la de los filtros actuales.
 */
export function contadorDePeticiones() {
  let ultima = 0;
  return { nueva: () => ++ultima, vigente: (n) => n === ultima };
}

/** "-1234.50" -> "-$1,234.50". Texto con dos decimales, sin pasar por números binarios. */
export function formatoDinero(texto) {
  const m = /^(-?)(\d+)\.(\d{2})$/.exec(String(texto ?? ""));
  if (!m) return "—";
  const miles = m[2].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cero = /^0+$/.test(m[2]) && m[3] === "00";
  return `${m[1] && !cero ? "-" : ""}$${miles}.${m[3]}`;
}

export function nombreFormaPago(id) {
  return FORMAS_PAGO[Number(id)] || `Forma de pago ${id}`;
}

/** "2026-10-23 17:53:00" -> "23/10/2026 17:53". */
export function fechaHoraCorte(texto) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(texto ?? ""));
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : "—";
}

/** Fecha local AAAA-MM-DD de hoy menos `dias`. */
export function fechaRelativa(dias, ahora = new Date()) {
  const d = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() - dias);
  const dos = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

/**
 * Parámetros de la consulta. `sucursal_id` va SIEMPRE (vacío = todas): así el selector del encabezado,
 * que apiFetch agregaría solo, no recorta el resultado en silencio.
 */
export function parametrosCortes({ sucursal, desde, hasta, caja, persona }) {
  const p = new URLSearchParams();
  p.set("sucursal_id", sucursal || "");
  if (desde) p.set("desde", desde);
  if (hasta) p.set("hasta", hasta);
  if ((caja || "").trim()) p.set("caj_id", caja.trim());
  if ((persona || "").trim()) p.set("usu_id", persona.trim());
  return p.toString();
}
