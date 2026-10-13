// Revisa la forma antes de mostrar el plan y ajusta las cifras que excedan los topes.
const { FACTOR_PERIODO } = require("./planIADatos");
const { PRUEBAS } = require("./metasPersonalizadas");

const MIN_METAS = 3;
const MAX_METAS = 6;
const MAX_NUEVAS = 2;
const TOPE_HISTORICO = 3;
const TEXTO_POR_QUE = "Propuesta basada en el historial de la tienda";

const textoValido = (v, maximo) => typeof v === "string" && v.trim().length > 0 && v.trim().length <= maximo;
const numerosEn = (texto) => (texto.match(/\d[\d,]*(?:\.\d+)?/g) || []).map((s) => Number(s.replace(/,/g, "")));

function falla(motivo) {
  const error = new Error(`La IA devolvió un plan inválido: ${motivo}`);
  error.planInvalido = true;
  throw error;
}

function validarPropuesta(propuesta, { catalogo, maximos, periodo, cifrasPermitidas }) {
  if (!propuesta || typeof propuesta !== "object") falla("sin contenido");
  const { okr, metas } = propuesta;
  if (!okr || !textoValido(okr.titulo, 120)) falla("el OKR necesita un título de hasta 120 caracteres");
  if (okr.descripcion != null && (typeof okr.descripcion !== "string" || okr.descripcion.length > 500)) falla("descripción del OKR");
  if (!Array.isArray(metas) || metas.length < MIN_METAS || metas.length > MAX_METAS) falla("debe traer de 3 a 6 metas");
  if (metas.filter((m) => m?.accion === "nueva").length > MAX_NUEVAS) falla("trae más de 2 ideas nuevas");

  const acciones = new Set(catalogo.map((c) => c.accion));
  const permitidas = new Set(cifrasPermitidas);
  const usadas = new Set();
  const limpias = metas.map((m, indice) => {
    const n = indice + 1;
    if (!m || !textoValido(m.nombre, 120) || !textoValido(m.unidad, 40)) falla(`la meta ${n} no tiene nombre o unidad válidos`);
    if (!PRUEBAS.includes(m.prueba)) falla(`la prueba de la meta ${n} debe ser ninguna, liga o foto`);
    if (!Number.isInteger(m.valor_meta) || m.valor_meta < 1) falla(`la cifra de la meta ${n} debe ser un entero mayor que 0`);
    const nueva = m.accion === "nueva";
    if (!nueva && !acciones.has(m.accion)) falla(`la meta ${n} usa una acción fuera del catálogo`);
    if (!nueva && usadas.has(m.accion)) falla(`la meta ${n} usa una acción repetida`);
    if (!nueva) usadas.add(m.accion);
    const referencia = catalogo.find((c) => c.accion === m.accion);
    const maximo = nueva ? 0 : maximos[m.accion] || 0;
    const tope = maximo > 0 ? Math.ceil(TOPE_HISTORICO * maximo * FACTOR_PERIODO[periodo]) : null;
    const valor_meta = Math.min(m.valor_meta, tope ?? 1000000, 1000000);
    const reemplazo = tope === null ? "Propuesta sin datos históricos de la tienda" : TEXTO_POR_QUE;
    const porQue = textoValido(m.por_que, 200) && numerosEn(m.por_que).every((x) => permitidas.has(x)) ? m.por_que.trim() : reemplazo;
    return { indice, accion: m.accion, nueva, nombre: m.nombre.trim(), unidad: referencia?.unidad ?? m.unidad.trim(),
      prueba: referencia?.prueba ?? m.prueba, valor_meta, tope, sin_historico: tope === null, por_que: porQue,
      ...(valor_meta < m.valor_meta ? { ajustada: true, propuesta_ia: m.valor_meta } : {}) };
  });
  return { okr: { titulo: okr.titulo.trim(), descripcion: okr.descripcion?.trim() || null }, metas: limpias };
}

module.exports = { validarPropuesta, TEXTO_POR_QUE, MIN_METAS, MAX_METAS, MAX_NUEVAS };
