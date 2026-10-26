import { esMetaNumero, legibleAEntero, textoFaltante } from "./avanceMetas.js";

// Funciones puras de las metas de Objetivos. Los periodos son los MISMOS que valida el
// servidor (backend/metasPeriodos.js): semana de lunes a domingo, mes y trimestre de calendario.
const DIA_MS = 24 * 60 * 60 * 1000;
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const aUTC = (fecha) => { const [a, m, d] = fecha.split("-").map(Number); return new Date(Date.UTC(a, m - 1, d)); };
const aTexto = (fecha) => fecha.toISOString().slice(0, 10);
const partes = (fecha) => { const d = aUTC(fecha); return { dia: d.getUTCDate(), mes: d.getUTCMonth(), anio: d.getUTCFullYear() }; };

export const COLOR_SEMAFORO = { verde: "bg-emerald-500", amarillo: "bg-amber-400", rojo: "bg-red-500" };
export const TEXTO_SEMAFORO = { verde: "Vas a tiempo", amarillo: "Un poco atrás", rojo: "Muy atrás" };
export const TEXTO_PRUEBA = { ninguna: "Sin prueba", liga: "Liga de la publicación", foto: "Foto" };
export const TEXTO_PERIODO = { semanal: "Semana", mensual: "Mes", trimestral: "Trimestre" };

// Vacío explícito impide que apiFetch herede la sucursal del encabezado.
export function queryTablero({ periodo, inicio, sucursal_id, vendedor_id, usuario_id }) {
  return new URLSearchParams({ periodo, inicio, sucursal_id: sucursal_id ?? "", vendedor_id: vendedor_id ?? "", usuario_id: usuario_id ?? "" }).toString();
}

export function inicioDePeriodo(periodo, fecha) {
  const d = aUTC(fecha);
  if (periodo === "semanal") return aTexto(new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DIA_MS));
  const mes = periodo === "mensual" ? d.getUTCMonth() : d.getUTCMonth() - (d.getUTCMonth() % 3);
  return aTexto(new Date(Date.UTC(d.getUTCFullYear(), mes, 1)));
}

export function finDePeriodo(periodo, inicio) {
  const d = aUTC(inicio);
  if (periodo === "semanal") return aTexto(new Date(d.getTime() + 6 * DIA_MS));
  const meses = periodo === "mensual" ? 1 : 3;
  return aTexto(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + meses, 0)));
}

export function fechaPropuestaCaptura(periodo, inicio, hoy) {
  const fin = finDePeriodo(periodo, inicio);
  return hoy < inicio ? inicio : hoy > fin ? fin : hoy;
}

export function inicioAlCambiarPeriodo(periodo, inicio, nuevo, hoy) {
  const contieneHoy = hoy >= inicio && hoy <= finDePeriodo(periodo, inicio);
  return inicioDePeriodo(nuevo, contieneHoy ? hoy : inicio);
}

export function moverPeriodo(periodo, inicio, pasos) {
  const d = aUTC(inicio);
  if (periodo === "semanal") return aTexto(new Date(d.getTime() + pasos * 7 * DIA_MS));
  const meses = (periodo === "mensual" ? 1 : 3) * pasos;
  return aTexto(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + meses, 1)));
}

export function etiquetaPeriodo(periodo, inicio) {
  const a = partes(inicio);
  const b = partes(finDePeriodo(periodo, inicio));
  if (periodo === "mensual") return `${MESES[a.mes][0].toUpperCase()}${MESES[a.mes].slice(1)} de ${a.anio}`;
  if (periodo === "trimestral") return `Trimestre ${MESES[a.mes]}–${MESES[b.mes]} de ${a.anio}`;
  if (a.mes === b.mes) return `Semana del ${a.dia} al ${b.dia} de ${MESES[a.mes]} de ${a.anio}`;
  const anioA = a.anio === b.anio ? "" : ` de ${a.anio}`;
  return `Semana del ${a.dia} de ${MESES[a.mes]}${anioA} al ${b.dia} de ${MESES[b.mes]} de ${b.anio}`;
}

export const periodoTerminado = (periodo, inicio, hoy) => hoy > finDePeriodo(periodo, inicio);

// Meta de los cinco caminos: la cifra se escribe en su unidad legible y viaja como entero escalado; la unidad la pone el servidor.
function cuerpoMetaNumero(form) {
  const cifra = legibleAEntero(form.fuente, form.valor_meta);
  if (!cifra.ok) throw new Error(cifra.error);
  return { nombre: form.nombre, descripcion: form.descripcion || undefined, prueba: "ninguna", valor_meta: cifra.valor,
    periodo: form.periodo, inicio: form.inicio, alcance: "tienda", sucursal_id: Number(form.sucursal_id), fuente: form.fuente };
}

export function cuerpoMeta(form) {
  if (!form.okr_clave && form.alcance === "tienda" && esMetaNumero(form.fuente)) return cuerpoMetaNumero(form);
  const comun = { nombre: form.nombre, descripcion: form.descripcion || undefined, unidad: form.unidad, prueba: form.prueba,
    valor_meta: Number(form.valor_meta) };
  if (form.okr_clave) return { ...comun, okr_clave: Number(form.okr_clave) };
  const base = { ...comun, periodo: form.periodo, inicio: form.inicio, alcance: form.alcance };
  if (form.alcance === "tienda") return { ...base, sucursal_id: Number(form.sucursal_id) };
  if (form.alcance === "persona") return { ...base, vendedor_id: Number(form.vendedor_id) };
  if (form.alcance === "corporativo") {
    const fuente = form.fuente || "manual";
    return { ...base, prueba: fuente === "manual" ? form.prueba : "ninguna", usuario_id: Number(form.usuario_id),
      sucursal_id: form.sucursal_id ? Number(form.sucursal_id) : null, fuente };
  }
  return { ...base, participantes: (form.participantes || []).map(Number) };
}

export function cuerpoCaptura(meta, form) {
  const nota = form.nota?.trim() ? { nota: form.nota.trim() } : {};
  if (meta.prueba === "liga") return { fecha: form.fecha, link: form.link, ...nota };
  if (meta.prueba === "foto") return { fecha: form.fecha, archivo: form.archivo, ...nota };
  return { fecha: form.fecha, cantidad: Number(form.cantidad), ...nota };
}

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

// "Faltan 4 videos · termina el domingo 18 de octubre": lo que le falta a la meta y cuánto tiempo queda.
export function textoFaltan(meta, fin, hoy) {
  if (meta.sin_dato === true || meta.resultado === null || meta.resultado === undefined) return hoy > fin ? "Sin dato" : "Sin dato todavía";
  const faltan = meta.valor_meta - meta.resultado;
  if (faltan <= 0) return "Meta cumplida";
  const falta = textoFaltante(meta, faltan);
  if (hoy > fin) return `Faltaron ${falta}`;
  const { dia, mes } = partes(fin);
  const cuando = hoy === fin ? "termina hoy" : `termina el ${DIAS[aUTC(fin).getUTCDay()]} ${dia} de ${MESES[mes]}`;
  return `Faltan ${falta} · ${cuando}`;
}

// Id de la ventana de "Hecho": si la señal falla y se vuelve a guardar, el servidor no la cuenta dos veces.
export function nuevaOperacion() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
