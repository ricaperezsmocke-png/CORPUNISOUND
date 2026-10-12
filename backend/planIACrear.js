// Lo que propuso la IA se crea SOLO aquí, y solo si una persona con permiso decidió cada punto
// (regla de Victor 2026-10-12). Todo o nada: si una sola cosa no se puede crear, no se crea ninguna.
const M = require("./metasPersonalizadas");
const { estaActivo } = require("./vendedores");

const DECISIONES = ["aceptar", "rechazar"];
const CAMBIABLES_OKR = ["titulo", "descripcion"];
const CAMBIABLES_META = ["nombre", "unidad", "prueba", "valor_meta"];

function planEnBorrador(DB, id) {
  const plan = DB.pos.planes_ia.find((p) => p.id === Number(id));
  if (!plan) throw new Error("El plan no existe");
  if (plan.estado !== "borrador") throw new Error("Este plan ya no está en borrador; no se puede validar ni descartar otra vez");
  return plan;
}

function leerCambios(cambios, permitidos, original) {
  if (cambios === undefined || cambios === null) return { valores: {}, diferencias: {} };
  if (typeof cambios !== "object") throw new Error("Los cambios deben ser un objeto");
  const valores = {};
  const diferencias = {};
  for (const [campo, valor] of Object.entries(cambios)) {
    if (!permitidos.includes(campo)) throw new Error(`No se puede cambiar ${campo} desde el plan`);
    valores[campo] = valor;
    if (original[campo] !== valor) diferencias[campo] = [original[campo] ?? null, valor];
  }
  return { valores, diferencias };
}

function leerDecisiones(plan, cuerpo) {
  const propuestas = plan.propuesta.metas;
  if (!DECISIONES.includes(cuerpo?.okr?.decision)) throw new Error("Falta decidir si aceptas o rechazas el OKR");
  if (!Array.isArray(cuerpo.metas) || cuerpo.metas.length !== propuestas.length) throw new Error("Falta decidir sobre todas las metas");
  const vistos = new Set();
  const metas = cuerpo.metas.map((d) => {
    const indice = typeof d?.indice === "number" || (typeof d?.indice === "string" && d.indice.trim()) ? Number(d.indice) : NaN;
    const original = Number.isSafeInteger(indice) ? propuestas.find((m) => m.indice === indice) : null;
    if (!original || vistos.has(original.indice)) throw new Error("Las decisiones no corresponden a las metas del plan");
    vistos.add(original.indice);
    if (!DECISIONES.includes(d.decision)) throw new Error(`Falta decidir sobre la meta "${original.nombre}"`);
    const persona = d.alcance === "persona";
    if (d.alcance !== undefined && d.alcance !== "base" && !persona) throw new Error("El alcance de la meta debe ser base o persona");
    return { original, decision: d.decision, persona, vendedor_id: d.vendedor_id, ...leerCambios(d.cambios, CAMBIABLES_META, original) };
  });
  const okr = { decision: cuerpo.okr.decision, ...leerCambios(cuerpo.okr.cambios, CAMBIABLES_OKR, plan.propuesta.okr) };
  if (okr.decision === "rechazar" && metas.every((m) => m.decision === "rechazar")) {
    throw new Error("No aceptaste ningún punto; si no quieres nada del plan, descártalo");
  }
  return { okr, metas };
}

function alcanceBase(DB, entrada) {
  if (entrada.sucursal_id !== null) return { alcance: "tienda", sucursal_id: entrada.sucursal_id };
  return { alcance: "empresa", participantes: DB.pos.vendedores.filter(estaActivo).map((v) => v.id) };
}

function validarPlan(DB, id, cuerpo, usuario) {
  const plan = planEnBorrador(DB, id);
  const { okr, metas } = leerDecisiones(plan, cuerpo);
  const { periodo, inicio } = plan.entrada;
  const base = alcanceBase(DB, plan.entrada);
  const validado_en = new Date().toISOString();
  const origen = { tipo: "plan_ia", plan_id: plan.id, validado_por_nombre: usuario?.nombre || "desconocido", validado_en };
  const largoOkrs = DB.pos.okrs.length;
  const largoMetas = DB.pos.metas_personalizadas.length;
  let creados;
  try {
    // Todo es síncrono: ninguna otra petición se mete entre estas altas, así que recortar las listas deshace todo.
    const okrCreado = okr.decision === "aceptar"
      ? M.crearOkr(DB, { ...plan.propuesta.okr, ...okr.valores, periodo, inicio, ...base }, usuario, { origen }) : null;
    const metas_claves = metas.filter((m) => m.decision === "aceptar").map((m) => {
      const { nombre, unidad, prueba, valor_meta } = { ...m.original, ...m.valores };
      const destino = m.persona ? { periodo, inicio, alcance: "persona", vendedor_id: m.vendedor_id }
        : okrCreado ? { okr_clave: okrCreado.clave } : { periodo, inicio, ...base };
      return M.crearMeta(DB, { nombre, unidad, prueba, valor_meta, ...destino }, usuario, { origen }).clave;
    });
    creados = { okr_clave: okrCreado?.clave ?? null, metas_claves };
  } catch (e) {
    DB.pos.okrs.length = largoOkrs;
    DB.pos.metas_personalizadas.length = largoMetas;
    throw e;
  }
  plan.decisiones = [{ punto: "okr", decision: okr.decision, cambios: okr.diferencias },
    ...metas.map((m) => ({ punto: m.original.indice, decision: m.decision, cambios: m.diferencias }))];
  Object.assign(plan, { estado: "validado", validado_por_id: usuario?.id ?? null, validado_por_nombre: origen.validado_por_nombre,
    validado_en, creados });
  return plan;
}

function descartarPlan(DB, id, usuario) {
  const plan = planEnBorrador(DB, id);
  Object.assign(plan, { estado: "descartado", descartado_por_nombre: usuario?.nombre || "desconocido", descartado_en: new Date().toISOString() });
  return plan;
}

const listarPlanes = (DB) => [...DB.pos.planes_ia].sort((a, b) => b.id - a.id).slice(0, 50);

module.exports = { validarPlan, descartarPlan, listarPlanes };
