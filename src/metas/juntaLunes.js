// Funciones puras de la junta del lunes de los cinco caminos (plan 2026-10-26, Task 3).
// La tienda y el usuario de cada operación los pone el servidor desde el token: aquí ningún cuerpo los manda.
import { sumarDias } from "./tableroCincoCaminos.js";

const PERMISO_JUNTA = "marcar_junta_cinco_caminos";

const dia = (iso) => new Date(iso).toLocaleDateString("es-MX", { timeZone: "America/Mexico_City", day: "2-digit", month: "2-digit", year: "numeric" });
const entre = (valor, min, max) => typeof valor === "string" && valor.trim().length >= min && valor.trim().length <= max;

export const estadoCompromiso = (c) => (c.cancelado ? "cancelado" : c.hecho ? "hecho" : "pendiente");

export function textoEstadoCompromiso(c) {
  if (c.cancelado) return `Cancelado el ${dia(c.cancelado.en)}: ${c.cancelado.motivo}`;
  if (c.hecho) return `Hecho${c.hecho.por_nombre ? ` por ${c.hecho.por_nombre}` : ""} el ${dia(c.hecho.en)}`;
  return "Pendiente";
}

export const textoIndicador = (indicador) => (indicador ? `Juntas hechas: ${indicador.con_junta} de ${indicador.semanas} semanas` : "");

// El compromiso cae en la semana de la junta o en la siguiente (el servidor lo vuelve a validar).
export const rangoFechaCompromiso = (lunes) => ({ min: lunes, max: sumarDias(lunes, 13) });

export function fechaCompromisoInicial(lunes, hoy) {
  const { min, max } = rangoFechaCompromiso(lunes);
  return hoy < min ? min : hoy > max ? max : hoy;
}

export function compromisoValido(form, lunes) {
  const { min, max } = rangoFechaCompromiso(lunes);
  const fecha = form.fecha_compromiso;
  return entre(form.texto, 3, 200) && entre(form.responsable, 3, 80) && /^\d{4}-\d{2}-\d{2}$/.test(fecha || "") && fecha >= min && fecha <= max;
}

// Solo estos campos viajan: nunca la tienda ni el usuario.
export const cuerpoCompromiso = (form, lunes) => ({
  lunes, texto: form.texto.trim(), responsable: form.responsable.trim(), fecha_compromiso: form.fecha_compromiso,
});
export const cuerpoCancelar = (motivo) => ({ motivo: motivo.trim() });
export const cuerpoJuntaHecha = (lunes) => ({ lunes });

export const puedeMarcarJunta = ({ compromisos, junta }) => !junta && compromisos.some((c) => !c.cancelado);

// El servidor escribe siempre en la tienda del token; quien ve otra tienda con "ver todas" solo la mira.
export function puedeEscribirJunta(permisos, usuario, sucursal) {
  return permisos.includes(PERMISO_JUNTA) && Boolean(usuario) && String(usuario.sucursal_id ?? "") === String(sucursal);
}

export const queryJunta = (sucursal, lunes) => new URLSearchParams({ sucursal_id: sucursal, lunes }).toString();
