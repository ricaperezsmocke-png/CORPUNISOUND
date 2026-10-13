// Datos que se le mandan a la IA para proponer un plan de metas extra. SOLO cifras agregadas de la tienda:
// nunca nombres, clientes, teléfonos, costos ni ventas individuales (decisión de Victor 2026-08-16).
const { CLASES_ACTIVIDAD } = require("./objetivosActividadesCatalogo");
const { objetivoVigente } = require("./objetivos");
const { listarElementos } = require("./objetivosCatalogos");
const { estaActivo } = require("./vendedores");
const { finDePeriodo } = require("./metasPeriodos");

const MESES_HISTORIAL = 6;
// Para comparar una cifra semanal o trimestral contra el historial mensual.
const FACTOR_PERIODO = { semanal: 0.25, mensual: 1, trimestral: 3 };
const PRUEBA_DE_EVIDENCIA = { link: "liga", foto: "foto" };

function mesesAnteriores(hoy, cuantos) {
  const [anio, mes] = hoy.split("-").map(Number);
  return Array.from({ length: cuantos }, (_, i) => new Date(Date.UTC(anio, mes - 2 - i, 1)).toISOString().slice(0, 7)).reverse();
}

const comparable = (s) => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function realVigente(cierre, linea, campo, marca_id = null) {
  const rectificacion = (cierre.rectificaciones || []).filter((r) =>
    Number(r.vendedor_id) === Number(linea.vendedor_id) && r.campo === campo &&
    (r.marca_id ?? null) === marca_id && r.producto_meta_id == null && r.financiera == null && r.actividad == null).at(-1);
  const original = marca_id === null ? linea[campo] : linea.marcas.find((m) => m.marca_id === marca_id)?.[campo];
  return rectificacion?.valor_nuevo ?? original ?? 0;
}

const sumarPesos = (valores) => valores.reduce((suma, n) => suma + Math.round(n * 100), 0) / 100;

function ventasDelMes(DB, mes, tiendas) {
  const aportes = tiendas.map((id) => {
    const cierre = (DB.pos.objetivo_cierres || []).find((c) => c.mes === mes && Number(c.sucursal_id) === Number(id));
    if (cierre) return { venta: sumarPesos(cierre.lineas.map((l) => realVigente(cierre, l, "real_sicar"))), fuente: "sicar" };
    const capturas = (DB.pos.objetivo_capturas || []).filter((c) =>
      c.vigente && c.tipo === "venta" && c.mes === mes && Number(c.sucursal_id) === Number(id));
    return capturas.length ? { venta: sumarPesos(capturas.map((c) => c.monto)), fuente: "declarado" } : null;
  }).filter(Boolean);
  const fuentes = new Set(aportes.map((a) => a.fuente));
  return { mes, venta: aportes.length ? sumarPesos(aportes.map((a) => a.venta)) : null,
    fuente: fuentes.size > 1 ? "mixto" : aportes[0]?.fuente || "sin_dato" };
}

function marcasVendidas(DB, meses, deTienda) {
  const marcas = new Map();
  for (const cierre of (DB.pos.objetivo_cierres || []).filter((c) => meses.includes(c.mes) && deTienda(c))) {
    for (const linea of cierre.lineas) {
      for (const marca of linea.marcas || []) {
        const agregado = marcas.get(marca.marca_id) || { marca: quitarNombres(DB, marca.nombre), valores: [], meses: new Set() };
        agregado.valores.push(realVigente(cierre, linea, "real", marca.marca_id));
        agregado.meses.add(cierre.mes);
        marcas.set(marca.marca_id, agregado);
      }
    }
  }
  return [...marcas.values()].map((m) => ({ marca: m.marca, venta_sicar: sumarPesos(m.valores), meses_con_dato: m.meses.size }))
    .sort((a, b) => b.venta_sicar - a.venta_sicar).slice(0, 15);
}

function armarDatosPlan(DB, { sucursal_id, periodo, inicio }, hoy) {
  const deTienda = (r) => sucursal_id === null || Number(r.sucursal_id) === sucursal_id;
  const meses = mesesAnteriores(hoy, MESES_HISTORIAL);
  const mesActual = hoy.slice(0, 7);
  const declarado = (DB.pos.objetivo_capturas || []).filter((c) =>
    c.vigente && c.tipo === "venta" && c.mes === mesActual && c.fecha <= hoy && deTienda(c));
  const tiendas = sucursal_id === null ? DB.pos.sucursales.map((s) => s.id) : [sucursal_id];
  const metaVenta = tiendas.reduce((suma, id) =>
    suma + (objetivoVigente(DB, { tipo: "venta", mes: mesActual, sucursal_id: id, vendedor_id: null })?.monto ?? 0), 0);

  const actividades = (DB.pos.objetivo_actividades || []).filter((a) => a.vigente && deTienda(a));
  const actividades_por_mes = meses.map((mes) => Object.fromEntries([["mes", mes],
    ...CLASES_ACTIVIDAD.map((c) => [c.clave, actividades.filter((a) => a.mes === mes && a.actividad === c.clave).length])]));

  const capturas = DB.pos.meta_capturas.filter((c) => !c.anulada && deTienda(c));
  const metas_anteriores = DB.pos.metas_personalizadas
    // Las metas de una sola persona no van: su resultado sería una cifra individual.
    .filter((m) => m.vigente && m.alcance !== "persona" && finDePeriodo(m.periodo, m.inicio) < hoy && deTienda(m))
    .sort((a, b) => b.inicio.localeCompare(a.inicio)).slice(0, 20)
    .map((m) => ({ accion: `meta:${m.clave}`, nombre: quitarNombres(DB, m.nombre), unidad: quitarNombres(DB, m.unidad), periodo: m.periodo,
      inicio: m.inicio, fin: finDePeriodo(m.periodo, m.inicio), valor_meta: m.valor_meta,
      resultado: capturas.filter((c) => c.meta_clave === m.clave).reduce((suma, c) => suma + Number(c.cantidad || 0), 0) }));

  const tienda = sucursal_id === null ? "toda la empresa" : DB.pos.sucursales.find((s) => s.id === sucursal_id)?.nombre || "tienda";
  const fin = finDePeriodo(periodo, inicio);
  const dias = (desde, hasta) => (Date.parse(hasta) - Date.parse(desde)) / 86400000 + 1;
  const datos = {
    tienda, periodo, inicio,
    fecha_hoy: hoy, periodo_inicio: inicio, periodo_fin: fin, dias_del_periodo: dias(inicio, fin),
    dias_restantes: hoy > fin ? 0 : dias(hoy < inicio ? inicio : hoy, fin),
    venta_por_mes: meses.map((mes) => ventasDelMes(DB, mes, tiendas)),
    venta_mes_actual: { mes: mesActual, meta: metaVenta, declarado_hasta_hoy: sumarPesos(declarado.map((c) => c.monto)), fuente: "declarado" },
    personas_activas: DB.pos.vendedores.filter((v) => estaActivo(v) && deTienda(v)).length,
    actividades_por_mes, metas_anteriores,
    marcas: listarElementos(DB, "marcas").map((e) => quitarNombres(DB, e.nombre)).slice(0, 60),
    marcas_vendidas: marcasVendidas(DB, meses, deTienda),
    metas_del_periodo: DB.pos.metas_personalizadas.filter((m) => m.vigente && m.periodo === periodo && m.inicio === inicio &&
      (sucursal_id === null ? m.alcance === "empresa" : m.alcance === "tienda" && Number(m.sucursal_id) === sucursal_id))
      .map((m) => ({ nombre: quitarNombres(DB, m.nombre), unidad: quitarNombres(DB, m.unidad), valor_meta: m.valor_meta })),
  };

  const catalogo = CLASES_ACTIVIDAD.map((c) => ({ accion: `actividad:${c.clave}`, nombre: c.etiqueta, unidad: c.unidad,
    prueba: PRUEBA_DE_EVIDENCIA[c.evidencia] }));
  const maximos = Object.fromEntries(CLASES_ACTIVIDAD.map((c) =>
    [`actividad:${c.clave}`, Math.max(0, ...actividades_por_mes.map((m) => m[c.clave]))]));
  for (const m of metas_anteriores) {
    const accion = m.accion;
    if (!catalogo.some((c) => c.accion === accion)) catalogo.push({ accion, nombre: m.nombre, unidad: m.unidad, prueba: "ninguna" });
    maximos[accion] = Math.max(maximos[accion] || 0, Math.round(m.resultado / FACTOR_PERIODO[m.periodo]));
  }
  for (const c of catalogo) {
    const original = DB.pos.metas_personalizadas.find((m) => m.vigente && `meta:${m.clave}` === c.accion);
    if (original) { c.prueba = original.prueba; c.unidad = quitarNombres(DB, original.unidad); }
    c.maximo_permitido = maximos[c.accion] > 0 ? Math.ceil(3 * maximos[c.accion] * FACTOR_PERIODO[periodo]) : null;
  }

  const sinHistorial = datos.venta_por_mes.every((m) => m.venta === null) && actividades.length === 0 && metas_anteriores.length === 0;
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
  return texto.replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[correo]")
    .replace(/\p{L}+/gu, (palabra) => (prohibidas.has(comparable(palabra)) ? "[persona]" : palabra))
    .replace(/\d(?:[\s-]?\d){6,}/g, "[número]");
}

module.exports = { armarDatosPlan, quitarNombres, FACTOR_PERIODO };
