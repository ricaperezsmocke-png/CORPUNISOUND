// Datos que se le mandan a la IA para proponer un plan de metas extra. SOLO cifras agregadas de la tienda:
// nunca nombres, clientes, teléfonos, costos ni ventas individuales (decisión de Victor 2026-08-16).
const { CLASES_ACTIVIDAD } = require("./objetivosActividadesCatalogo");
const { objetivoVigente } = require("./objetivos");
const { listarElementos } = require("./objetivosCatalogos");
const { estaActivo } = require("./vendedores");

const MESES_HISTORIAL = 6;
// Para comparar una cifra semanal o trimestral contra el historial mensual.
const FACTOR_PERIODO = { semanal: 0.25, mensual: 1, trimestral: 3 };
const PRUEBA_DE_EVIDENCIA = { link: "liga", foto: "foto" };

function mesesAnteriores(hoy, cuantos) {
  const [anio, mes] = hoy.split("-").map(Number);
  return Array.from({ length: cuantos }, (_, i) => new Date(Date.UTC(anio, mes - 2 - i, 1)).toISOString().slice(0, 7)).reverse();
}

const comparable = (s) => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function armarDatosPlan(DB, { sucursal_id, periodo, inicio }, hoy) {
  const deTienda = (r) => sucursal_id === null || Number(r.sucursal_id) === sucursal_id;
  const meses = mesesAnteriores(hoy, MESES_HISTORIAL);
  const mesActual = hoy.slice(0, 7);
  const ventasCerradas = DB.pos.ventas.filter((v) => v.estatus === "cerrada" && deTienda(v));
  const ventaDe = (mes, hasta = "9999-12-31") => Math.round(ventasCerradas
    .filter((v) => String(v.fecha || "").slice(0, 7) === mes && String(v.fecha).slice(0, 10) <= hasta)
    .reduce((suma, v) => suma + Number(v.total || 0), 0));
  const tiendas = sucursal_id === null ? DB.pos.sucursales.map((s) => s.id) : [sucursal_id];
  const metaVenta = tiendas.reduce((suma, id) =>
    suma + (objetivoVigente(DB, { tipo: "venta", mes: mesActual, sucursal_id: id, vendedor_id: null })?.monto ?? 0), 0);

  const actividades = (DB.pos.objetivo_actividades || []).filter((a) => a.vigente && deTienda(a));
  const actividades_por_mes = meses.map((mes) => Object.fromEntries([["mes", mes],
    ...CLASES_ACTIVIDAD.map((c) => [c.clave, actividades.filter((a) => a.mes === mes && a.actividad === c.clave).length])]));

  const capturas = DB.pos.meta_capturas.filter((c) => !c.anulada && deTienda(c));
  const metas_anteriores = DB.pos.metas_personalizadas
    // Las metas de una sola persona no van: su resultado sería una cifra individual.
    .filter((m) => m.vigente && m.alcance !== "persona" && m.inicio < inicio && (sucursal_id === null || m.sucursal_id === sucursal_id))
    .sort((a, b) => b.inicio.localeCompare(a.inicio)).slice(0, 20)
    .map((m) => ({ nombre: quitarNombres(DB, m.nombre), unidad: m.unidad, periodo: m.periodo, valor_meta: m.valor_meta,
      resultado: capturas.filter((c) => c.meta_clave === m.clave).reduce((suma, c) => suma + Number(c.cantidad || 0), 0) }));

  const tienda = sucursal_id === null ? "toda la empresa" : DB.pos.sucursales.find((s) => s.id === sucursal_id)?.nombre || "tienda";
  const datos = {
    tienda, periodo, inicio,
    venta_por_mes: meses.map((mes) => ({ mes, venta: ventaDe(mes) })),
    venta_mes_actual: { mes: mesActual, meta: metaVenta, vendido_hasta_hoy: ventaDe(mesActual, hoy) },
    personas_activas: DB.pos.vendedores.filter((v) => estaActivo(v) && deTienda(v)).length,
    actividades_por_mes, metas_anteriores,
    marcas: listarElementos(DB, "marcas").map((e) => e.nombre).slice(0, 60),
  };

  const catalogo = CLASES_ACTIVIDAD.map((c) => ({ accion: `actividad:${c.clave}`, nombre: c.etiqueta, unidad: c.unidad,
    prueba: PRUEBA_DE_EVIDENCIA[c.evidencia] }));
  const maximos = Object.fromEntries(CLASES_ACTIVIDAD.map((c) =>
    [`actividad:${c.clave}`, Math.max(0, ...actividades_por_mes.map((m) => m[c.clave]))]));
  for (const m of metas_anteriores) {
    const accion = `meta:${m.nombre}`;
    if (!catalogo.some((c) => c.accion === accion)) catalogo.push({ accion, nombre: m.nombre, unidad: m.unidad, prueba: "ninguna" });
    maximos[accion] = Math.max(maximos[accion] || 0, Math.round(m.resultado / FACTOR_PERIODO[m.periodo]));
  }
  for (const c of catalogo) {
    const original = DB.pos.metas_personalizadas.find((m) => `meta:${m.nombre}` === c.accion);
    if (original) c.prueba = original.prueba;
  }

  const sinHistorial = datos.venta_por_mes.every((m) => m.venta === 0) && actividades.length === 0 && metas_anteriores.length === 0;
  return { datos, catalogo, maximos, cifrasPermitidas: numerosDe(datos), sinHistorial };
}

function numerosDe(valor, lista = []) {
  if (typeof valor === "number" && Number.isFinite(valor)) lista.push(valor);
  else if (valor && typeof valor === "object") Object.values(valor).forEach((v) => numerosDe(v, lista));
  return lista;
}

// Partes de nombres compuestos ("María de los Ángeles") que también son palabras comunes del objetivo.
const CONECTORES = new Set(["del", "las", "los", "san", "santa", "santo"]);

// Cambia por "[persona]" cada palabra del texto que coincida con una palabra de un nombre de personal o de usuario.
function quitarNombres(DB, texto) {
  const nombres = [...DB.pos.vendedores, ...(DB.admin?.usuarios || [])].flatMap((p) => [p.nombre, p.usuario])
    .filter(Boolean).flatMap((n) => comparable(n).match(/\p{L}+/gu) || []).filter((palabra) => palabra.length >= 3 && !CONECTORES.has(palabra));
  const prohibidas = new Set(nombres);
  // Un teléfono escrito en el objetivo tampoco sale: 7 dígitos o más, con espacios o guiones.
  return texto.replace(/\p{L}+/gu, (palabra) => (prohibidas.has(comparable(palabra)) ? "[persona]" : palabra))
    .replace(/\d(?:[\s-]?\d){6,}/g, "[número]");
}

module.exports = { armarDatosPlan, quitarNombres, FACTOR_PERIODO };
