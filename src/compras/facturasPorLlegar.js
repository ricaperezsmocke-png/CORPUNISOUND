/**
 * facturasPorLlegar.js — Funciones puras de la pantalla "Facturas por Llegar".
 * Sin React: se prueban con `node --test`.
 */

const ESTADOS = { por_llegar: "Por llegar", llego: "Llegó", cancelada: "Cancelada" };
const MAX_XML = 5 * 1024 * 1024;

export const nombreEstado = (estado) => ESTADOS[estado] || String(estado ?? "—");

export function textoEspera(f) {
  if (f?.estado !== "por_llegar" || f.dias_espera === null || f.dias_espera === undefined) return "—";
  if (f.dias_espera === 0) return "Hoy";
  return `${f.dias_espera} ${f.dias_espera === 1 ? "día" : "días"}`;
}

/** Centavos enteros a pesos con miles, sin pasar por decimales binarios. */
export function formatoCentavos(centavos) {
  if (!Number.isSafeInteger(centavos)) return "—";
  const abs = Math.abs(centavos);
  const pesos = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${centavos < 0 ? "-" : ""}$${pesos}.${String(abs % 100).padStart(2, "0")}`;
}

/** Total con su moneda; para MXN queda como siempre. */
export function textoTotal(f) {
  const base = formatoCentavos(f?.total_centavos);
  return f?.moneda && f.moneda !== "MXN" ? `${base} ${f.moneda}` : base;
}

export function textoMonedaProhibida(f) {
  if (!f?.moneda_prohibida) return "";
  return `Factura en ${f.moneda}: las compras en moneda extranjera están prohibidas. Revisar con quién la autorizó.`;
}

export function resumenProhibidas(datos) {
  const n = datos?.prohibidas || 0;
  if (n === 0) return "";
  return n === 1 ? "1 factura en moneda distinta de MXN (prohibida)." : `${n} facturas en moneda distinta de MXN (prohibida).`;
}

export function motivoValido(texto) {
  const t = String(texto ?? "").trim();
  return t.length >= 3 && t.length <= 200;
}

export const puedeRegistrar = (permisos) => (permisos || []).includes("registrar_facturas_por_llegar");

export function resumenFacturas(datos) {
  const n = datos?.vencidas || 0;
  if (n === 0) return "";
  const dias = datos.dias_aviso ?? 15;
  return n === 1 ? `1 factura lleva más de ${dias} días sin llegar.` : `${n} facturas llevan más de ${dias} días sin llegar.`;
}

/** "2026-10-25 08:00:00" o ISO -> "25/10/2026". */
export function fechaCorta(texto) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(texto ?? ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
}

/** Texto del problema, o "" si el archivo sirve para intentar subirlo. */
export function archivoXmlValido(archivo) {
  if (!/\.xml$/i.test(archivo?.name || "")) return "Solo se aceptan archivos XML.";
  if (archivo.size > MAX_XML) return "El archivo es demasiado grande.";
  return "";
}

export function mensajeResultado(resultados) {
  return {
    ok: resultados.filter((r) => r.ok).length,
    errores: resultados.filter((r) => !r.ok).map((r) => `${r.nombre}: ${r.error}`),
  };
}
