export const pesos = (n) => Number(n || 0).toLocaleString("es-MX", {
  style: "currency", currency: "MXN", maximumFractionDigits: 0,
});

import { esCapturaDeVenta, pesosConCentavos } from "./marcas.js";

export const ventaDelDia = (capturas, fecha) =>
  capturas.find((captura) => captura.vigente && captura.fecha === fecha && esCapturaDeVenta(captura)) || null;

export function resumenVenta({ meta, total }) {
  if (!(meta > 0)) return { texto: `Llevas ${pesosConCentavos(total)} registrados`, porcentaje: null };
  const porcentaje = Math.round(total / meta * 100);
  return { texto: `Llevas ${pesosConCentavos(total)} de ${pesosConCentavos(meta)} · ${porcentaje} %`, porcentaje };
}

export const fechaCorta = (fecha) => `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}`;

export function fechaLarga(fecha) {
  const [anio, mes, dia] = fecha.split("-").map(Number);
  const calendario = new Date(Date.UTC(anio, mes - 1, dia));
  const opciones = { timeZone: "UTC" };
  const semana = calendario.toLocaleDateString("es-MX", { ...opciones, weekday: "long" });
  const nombreMes = calendario.toLocaleDateString("es-MX", { ...opciones, month: "long" });
  return `${semana} ${dia} de ${nombreMes}`;
}

export const hoyLocal = (fecha = new Date()) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Mexico_City",
}).format(fecha);

export const mesActual = () => hoyLocal().slice(0, 7);

export function sugerenciaGuardada(sugerencia, lineas) {
  return lineas.some((linea) => Number(linea.vendedor_id) === Number(sugerencia.vendedor_id) &&
    Number(linea.monto) === Number(sugerencia.monto));
}

export function finDelMes(mes) {
  const fecha = new Date(`${mes}-01T00:00:00Z`);
  fecha.setUTCMonth(fecha.getUTCMonth() + 1, 0);
  return fecha.toISOString().slice(0, 10);
}

export function diasDeAtraso(captura) {
  if (!captura.capturado_en) return 0;
  const registrada = new Date(captura.capturado_en);
  if (Number.isNaN(registrada.getTime())) return 0;
  // Comparamos días de calendario de Chiapas, no bloques de 24 horas desde la captura.
  return Math.max(0, Math.round((Date.parse(hoyLocal(registrada)) - Date.parse(captura.fecha)) / 86400000));
}

export async function leer(respuesta, mensaje) {
  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) {
    const error = new Error(datos.error || mensaje);
    error.status = respuesta.status;
    throw error;
  }
  return datos;
}

export const cuentaMalLigada = "Tu cuenta está ligada a un vendedor que ya no existe en el catálogo. " +
  "Pídele a quien administra el personal que la vuelva a ligar desde Roles y Personal.";
