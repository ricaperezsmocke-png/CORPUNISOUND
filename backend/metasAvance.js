// Avance de metas personalizadas. Son conteos, no dinero: la vendedora ve el total y el % de las
// metas compartidas, pero nunca quién capturó qué (solo lo suyo). La jefatura ve el desglose.
const { validarPeriodo, finDePeriodo, ritmoEsperado } = require("./metasPeriodos");
const { periodoSellado } = require("./metasPersonalizadas");
const { capturaParaRespuesta } = require("./metasCapturas");

// Las capturas apuntan a la clave estable: editar la meta no pierde lo ya capturado.
const validas = (DB, meta) => DB.pos.meta_capturas.filter((c) => c.meta_clave === meta.clave && !c.anulada);

function resultadoMeta(DB, meta) {
  return validas(DB, meta).reduce((suma, c) => suma + c.cantidad, 0);
}

function porcentaje(resultado, valor) {
  return Math.min(100, Math.round((resultado / valor) * 1000) / 10);
}

function semaforo(pct, ritmo) {
  const esperado = ritmo * 100;
  if (pct >= esperado) return "verde";
  if (pct >= esperado * 0.7) return "amarillo";
  return "rojo";
}

function selloDe(DB, periodo, inicio) {
  return (DB.pos.meta_sellos || []).find((s) => s.periodo === periodo && s.inicio === inicio) || null;
}

function resultadoRectificado(DB, meta) {
  const sello = selloDe(DB, meta.periodo, meta.inicio);
  if (!sello) return resultadoMeta(DB, meta);
  const rectificaciones = (sello.rectificaciones || []).filter((r) => r.meta_clave === meta.clave);
  if (rectificaciones.length) return rectificaciones.at(-1).valor_nuevo;
  const sellado = (sello.foto?.resultados || []).find((r) => r.clave === meta.clave);
  return sellado ? sellado.resultado : resultadoMeta(DB, meta);
}

function puedeVer(DB, meta, visor) {
  if (visor.jefatura) {
    if (visor.verTodas) return true;
    return meta.alcance !== "empresa" && meta.sucursal_id === visor.sucursalId;
  }
  if (visor.vendedor_id === null) return false;
  if (meta.alcance === "persona") return meta.vendedor_id === visor.vendedor_id;
  if (meta.alcance === "empresa") return meta.participantes.includes(visor.vendedor_id);
  const propio = DB.pos.vendedores.find((v) => v.id === visor.vendedor_id);
  return Boolean(propio) && propio.sucursal_id === meta.sucursal_id;
}

// Si quien ve el tablero puede marcar "Hecho" en esta meta. El servidor ya rechaza la captura ajena;
// esto evita que la pantalla ofrezca un botón que va a fallar.
function puedeCapturar(DB, meta, vendedor_id) {
  if (vendedor_id === null || vendedor_id === undefined) return false;
  if (meta.alcance === "persona") return meta.vendedor_id === vendedor_id;
  if (meta.alcance === "empresa") return meta.participantes.includes(vendedor_id);
  return DB.pos.vendedores.find((v) => v.id === vendedor_id)?.sucursal_id === meta.sucursal_id;
}

function desglosePorPersona(DB, capturas) {
  const porPersona = new Map();
  for (const c of capturas) porPersona.set(c.vendedor_id, (porPersona.get(c.vendedor_id) || 0) + c.cantidad);
  return [...porPersona].sort(([a], [b]) => a - b).map(([vendedor_id, total]) => ({
    vendedor_id, nombre: DB.pos.vendedores.find((v) => v.id === vendedor_id)?.nombre || "desconocido", resultado: total,
  }));
}

function avanceMeta(DB, meta, visor, ritmo) {
  const resultado = resultadoRectificado(DB, meta);
  const pct = porcentaje(resultado, meta.valor_meta);
  const capturas = validas(DB, meta);
  const avance = {
    clave: meta.clave, okr_clave: meta.okr_clave, nombre: meta.nombre, descripcion: meta.descripcion, unidad: meta.unidad,
    prueba: meta.prueba, alcance: meta.alcance, sucursal_id: meta.sucursal_id, vendedor_id: meta.vendedor_id,
    valor_meta: meta.valor_meta, resultado, porcentaje: pct, ritmo, semaforo: semaforo(pct, ritmo),
    mis_capturas: capturas.filter((c) => c.vendedor_id === visor.vendedor_id).map(capturaParaRespuesta),
    puede_capturar: puedeCapturar(DB, meta, visor.vendedor_id),
  };
  if (visor.jefatura) avance.por_persona = desglosePorPersona(DB, capturas);
  return avance;
}

function tablero(DB, visor, { periodo, inicio, sucursal_id = null, vendedor_id = null }, hoy) {
  validarPeriodo(periodo, inicio);
  const ritmo = ritmoEsperado(periodo, inicio, hoy);
  const filtro = (m) => (sucursal_id === null || m.sucursal_id === sucursal_id) && (vendedor_id === null || m.vendedor_id === vendedor_id);
  const metas = DB.pos.metas_personalizadas
    .filter((m) => m.vigente && m.periodo === periodo && m.inicio === inicio && puedeVer(DB, m, visor) && filtro(m))
    .map((m) => avanceMeta(DB, m, visor, ritmo));
  const okrs = DB.pos.okrs
    .filter((o) => o.vigente && o.periodo === periodo && o.inicio === inicio)
    .map((o) => {
      const suyas = metas.filter((m) => m.okr_clave === o.clave);
      const pct = suyas.length ? Math.round((suyas.reduce((s, m) => s + m.porcentaje, 0) / suyas.length) * 10) / 10 : null;
      return { clave: o.clave, titulo: o.titulo, descripcion: o.descripcion, alcance: o.alcance, sucursal_id: o.sucursal_id,
        vendedor_id: o.vendedor_id, porcentaje: pct, metas: suyas };
    })
    .filter((o) => o.metas.length);
  return { periodo, inicio, fin: finDePeriodo(periodo, inicio), sellado: periodoSellado(DB, periodo, inicio),
    okrs, sueltas: metas.filter((m) => m.okr_clave === null) };
}

module.exports = { resultadoMeta, porcentaje, semaforo, resultadoRectificado, tablero };
