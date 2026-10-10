// Sello de un periodo de metas personalizadas (decisión de Victor 2026-10-08): al terminar el periodo,
// el Administrador lo sella; después nada cambia. Rectificar corrige el RESULTADO con motivo y deja
// el sellado intacto; la cifra meta nunca se rectifica (sería maquillar el cumplimiento).
const { validarPeriodo, finDePeriodo } = require("./metasPeriodos");
const { periodoSellado, motivoObligatorio } = require("./metasPersonalizadas");
const { resultadoMeta, resultadoRectificado, porcentaje } = require("./metasAvance");
const { createHash } = require("node:crypto");

const siguienteId = (lista) => lista.reduce((maximo, r) => Math.max(maximo, r.id), 0) + 1;

function previoSello(DB, { periodo, inicio }, hoy) {
  validarPeriodo(periodo, inicio);
  const fin = finDePeriodo(periodo, inicio);
  if (hoy <= fin) throw new Error("El periodo todavía no termina; se sella a partir del día siguiente a su fin");
  if (periodoSellado(DB, periodo, inicio)) throw new Error("El periodo ya está sellado");
  const metas = DB.pos.metas_personalizadas.filter((m) => m.vigente && m.periodo === periodo && m.inicio === inicio);
  const previo = {
    periodo, inicio, fin,
    resultados: metas.map((m) => {
      const resultado = resultadoMeta(DB, m);
      return { clave: m.clave, nombre: m.nombre, alcance: m.alcance, sucursal_id: m.sucursal_id, vendedor_id: m.vendedor_id,
        valor_meta: m.valor_meta, resultado, porcentaje: porcentaje(resultado, m.valor_meta) };
    }),
  };
  const delPeriodo = (m) => m.periodo === periodo && m.inicio === inicio;
  const incluidas = DB.pos.metas_personalizadas.filter((m) => (m.vigente || m.retirada) && delPeriodo(m));
  const claves = new Set(incluidas.map((m) => m.clave));
  const porId = (a, b) => a.id - b.id;
  const contenido = {
    periodo, inicio,
    resultados: previo.resultados.map(({ clave, resultado, valor_meta, porcentaje }) => ({ clave, resultado, valor_meta, porcentaje }))
      .sort((a, b) => a.clave - b.clave),
    metas: incluidas.map((m) => ({ clave: m.clave, id: m.id, retirada: Boolean(m.retirada) })).sort(porId),
    capturas: DB.pos.meta_capturas.filter((c) => claves.has(c.meta_clave))
      .map((c) => ({ id: c.id, anulada: Boolean(c.anulada) })).sort(porId),
    okrs: DB.pos.okrs.filter((o) => (o.vigente || o.retirada) && delPeriodo(o))
      .map((o) => ({ id: o.id, retirada: Boolean(o.retirada) })).sort(porId),
  };
  previo.huella = createHash("sha256").update(JSON.stringify(contenido)).digest("hex");
  return previo;
}

function sellarPeriodo(DB, datos, usuario, hoy) {
  const previo = previoSello(DB, datos, hoy);
  if (!datos.huella || datos.huella !== previo.huella) {
    throw Object.assign(new Error("Algo cambió desde que revisaste (capturas o metas). Revisa otra vez antes de sellar."), { status: 409 });
  }
  const { periodo, inicio } = datos;
  const claves = new Set(previo.resultados.map((r) => r.clave));
  const delPeriodo = (r) => r.periodo === periodo && r.inicio === inicio;
  // Un periodo sin ninguna meta (ni eliminada) no se sella: solo impediría crearle metas después.
  if (!DB.pos.metas_personalizadas.some((m) => (m.vigente || m.retirada) && delPeriodo(m))) {
    throw new Error("No hay metas que sellar en este periodo");
  }
  const foto = structuredClone({
    okrs: DB.pos.okrs.filter((o) => o.vigente && delPeriodo(o)),
    metas: DB.pos.metas_personalizadas.filter((m) => m.vigente && claves.has(m.clave)),
    capturas: DB.pos.meta_capturas.filter((c) => !c.anulada && claves.has(c.meta_clave)),
    resultados: previo.resultados,
    // Lo eliminado en el periodo también queda en el sello ("que quede el historial", Victor 2026-10-08).
    retiradas: DB.pos.metas_personalizadas.filter((m) => m.retirada && delPeriodo(m)),
    okrs_retirados: DB.pos.okrs.filter((o) => o.retirada && delPeriodo(o)),
  });
  const sello = { id: siguienteId(DB.pos.meta_sellos), periodo, inicio, fin: previo.fin,
    sellado_por_id: usuario?.id ?? null, sellado_por: usuario?.nombre || "desconocido", sellado_en: new Date().toISOString(),
    foto, rectificaciones: [] };
  DB.pos.meta_sellos.push(sello);
  return sello;
}

function rectificarSello(DB, selloId, { meta_clave, valor_nuevo, motivo, campo }, usuario) {
  const sello = DB.pos.meta_sellos.find((s) => s.id === Number(selloId));
  if (!sello) throw new Error("El sello no existe");
  if (campo !== undefined && campo !== "resultado") throw new Error("Solo se rectifica el resultado; la cifra meta no se puede cambiar");
  const sellado = sello.foto.resultados.find((r) => r.clave === Number(meta_clave));
  if (!sellado) throw new Error("La meta no está en este sello");
  if (!Number.isInteger(valor_nuevo) || valor_nuevo < 0) throw new Error("El resultado debe ser un entero mayor o igual a cero");
  const limpio = motivoObligatorio(motivo, "Rectificar un sello");
  const meta = sello.foto.metas.find((m) => m.clave === sellado.clave);
  const rectificacion = { id: siguienteId(sello.rectificaciones), meta_clave: sellado.clave,
    valor_anterior: resultadoRectificado(DB, meta), valor_nuevo, motivo: limpio,
    por_id: usuario?.id ?? null, por_nombre: usuario?.nombre || "desconocido", en: new Date().toISOString() };
  sello.rectificaciones.push(rectificacion);
  return rectificacion;
}

module.exports = { previoSello, sellarPeriodo, rectificarSello };
