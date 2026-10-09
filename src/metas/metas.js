// Funciones puras de la pantalla de Metas y OKRs. Los periodos son los MISMOS que valida el
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

export function cuerpoMeta(form) {
  const comun = { nombre: form.nombre, descripcion: form.descripcion || undefined, unidad: form.unidad, prueba: form.prueba,
    valor_meta: Number(form.valor_meta) };
  if (form.okr_clave) return { ...comun, okr_clave: Number(form.okr_clave) };
  const base = { ...comun, periodo: form.periodo, inicio: form.inicio, alcance: form.alcance };
  if (form.alcance === "tienda") return { ...base, sucursal_id: Number(form.sucursal_id) };
  if (form.alcance === "persona") return { ...base, vendedor_id: Number(form.vendedor_id) };
  return { ...base, participantes: (form.participantes || []).map(Number) };
}

export function cuerpoCaptura(meta, form) {
  const nota = form.nota?.trim() ? { nota: form.nota.trim() } : {};
  if (meta.prueba === "liga") return { fecha: form.fecha, link: form.link, ...nota };
  if (meta.prueba === "foto") return { fecha: form.fecha, archivo: form.archivo, ...nota };
  return { fecha: form.fecha, cantidad: Number(form.cantidad), ...nota };
}
