// Metas personalizadas: OKRs y metas que crea el Administrador (decisión de Victor 2026-10-08).
// Cada cambio es una versión nueva con motivo; eliminar es retirar, nunca borrar: una meta
// incumplida no puede desaparecer del historial.
const { validarPeriodo } = require("./metasPeriodos");

const ALCANCES = ["tienda", "persona", "empresa"];
const PRUEBAS = ["ninguna", "liga", "foto"];
const EDITABLES_META = ["nombre", "descripcion", "unidad", "prueba", "valor_meta"];
const EDITABLES_OKR = ["titulo", "descripcion"];

const siguienteId = (lista) => lista.reduce((maximo, r) => Math.max(maximo, r.id), 0) + 1;

function texto(valor, campo, maximo, { obligatorio = true } = {}) {
  if (valor === undefined || valor === null || (typeof valor === "string" && !valor.trim())) {
    if (obligatorio) throw new Error(`El campo ${campo} es obligatorio`);
    return null;
  }
  if (typeof valor !== "string") throw new Error(`El campo ${campo} debe ser texto`);
  const limpio = valor.trim();
  if (limpio.length > maximo) throw new Error(`El campo ${campo} no puede tener más de ${maximo} caracteres`);
  return limpio;
}

function motivoObligatorio(motivo, accion) {
  if (typeof motivo !== "string" || !motivo.trim()) throw new Error(`${accion} requiere un motivo; no puede estar vacío`);
  return motivo.trim();
}

function auditoria(usuario) {
  return { creado_por_id: usuario?.id ?? null, creado_por: usuario?.nombre || "desconocido", creado_en: new Date().toISOString() };
}

function periodoSellado(DB, periodo, inicio) {
  return (DB.pos.meta_sellos || []).some((s) => s.periodo === periodo && s.inicio === inicio);
}

function exigirAbierto(DB, periodo, inicio) {
  if (periodoSellado(DB, periodo, inicio)) throw new Error("El periodo ya está sellado; solo se puede rectificar el sello");
}

function validarAlcance(DB, { alcance, sucursal_id, vendedor_id, participantes }) {
  if (!ALCANCES.includes(alcance)) throw new Error("El alcance debe ser tienda, persona o empresa");
  if (alcance === "tienda") {
    const id = Number(sucursal_id);
    if (!DB.pos.sucursales.some((s) => s.id === id)) throw new Error("La tienda no existe");
    return { alcance, sucursal_id: id, vendedor_id: null, participantes: [] };
  }
  if (alcance === "persona") {
    const vendedor = DB.pos.vendedores.find((v) => v.id === Number(vendedor_id));
    if (!vendedor) throw new Error("La persona no existe");
    return { alcance, sucursal_id: vendedor.sucursal_id, vendedor_id: vendedor.id, participantes: [] };
  }
  const ids = Array.isArray(participantes) ? [...new Set(participantes.map(Number))].sort((a, b) => a - b) : [];
  if (!ids.length || ids.some((id) => !DB.pos.vendedores.some((v) => v.id === id))) {
    throw new Error("Una meta de empresa necesita participantes que existan");
  }
  return { alcance, sucursal_id: null, vendedor_id: null, participantes: ids };
}

function validarCifra(valor) {
  if (!Number.isInteger(valor) || valor < 1 || valor > 1000000) {
    throw new Error("La cifra meta debe ser un entero entre 1 y 1,000,000");
  }
  return valor;
}

function validarPrueba(prueba) {
  if (!PRUEBAS.includes(prueba)) throw new Error("La prueba debe ser ninguna, liga o foto");
  return prueba;
}

const vigenteDe = (lista, clave) => lista.find((r) => r.clave === Number(clave) && r.vigente) || null;
const okrVigente = (DB, clave) => vigenteDe(DB.pos.okrs, clave);
const metaVigente = (DB, clave) => vigenteDe(DB.pos.metas_personalizadas, clave);

function historial(DB, coleccion, clave) {
  return DB.pos[coleccion].filter((r) => r.clave === Number(clave)).sort((a, b) => a.version - b.version);
}

function nuevaVersion(lista, anterior, cambios, motivo, usuario) {
  const nuevo = { ...anterior, ...cambios, id: siguienteId(lista), version: anterior.version + 1, vigente: true,
    retirada: null, reemplaza_a: anterior.id, motivo, ...auditoria(usuario) };
  anterior.vigente = false;
  lista.push(nuevo);
  return nuevo;
}

function retirar(registro, motivo, usuario) {
  registro.vigente = false;
  registro.retirada = { por_id: usuario?.id ?? null, por_nombre: usuario?.nombre || "desconocido", en: new Date().toISOString(), motivo };
  return registro;
}

function crearOkr(DB, datos, usuario) {
  const titulo = texto(datos.titulo, "título", 120);
  const descripcion = texto(datos.descripcion, "descripción", 500, { obligatorio: false });
  validarPeriodo(datos.periodo, datos.inicio);
  exigirAbierto(DB, datos.periodo, datos.inicio);
  const alcance = validarAlcance(DB, datos);
  const id = siguienteId(DB.pos.okrs);
  const okr = { id, clave: id, version: 1, vigente: true, retirada: null, reemplaza_a: null, motivo: null,
    titulo, descripcion, periodo: datos.periodo, inicio: datos.inicio, ...alcance, ...auditoria(usuario) };
  DB.pos.okrs.push(okr);
  return okr;
}

function editarOkr(DB, clave, datos, usuario) {
  const anterior = okrVigente(DB, clave);
  if (!anterior) throw new Error("El OKR no existe o fue eliminado");
  exigirAbierto(DB, anterior.periodo, anterior.inicio);
  if (Object.keys(datos).some((k) => k !== "motivo" && !EDITABLES_OKR.includes(k))) {
    throw new Error("Del OKR solo se puede cambiar título y descripción; no se puede cambiar periodo ni alcance");
  }
  const motivo = motivoObligatorio(datos.motivo, "Cambiar un OKR");
  const cambios = {};
  if ("titulo" in datos) cambios.titulo = texto(datos.titulo, "título", 120);
  if ("descripcion" in datos) cambios.descripcion = texto(datos.descripcion, "descripción", 500, { obligatorio: false });
  return nuevaVersion(DB.pos.okrs, anterior, cambios, motivo, usuario);
}

function retirarOkr(DB, clave, motivo, usuario) {
  const okr = okrVigente(DB, clave);
  if (!okr) throw new Error("El OKR no existe o fue eliminado");
  exigirAbierto(DB, okr.periodo, okr.inicio);
  const limpio = motivoObligatorio(motivo, "Eliminar un OKR");
  for (const meta of DB.pos.metas_personalizadas.filter((m) => m.vigente && m.okr_clave === okr.clave)) {
    retirar(meta, limpio, usuario);
  }
  return retirar(okr, limpio, usuario);
}

function crearMeta(DB, datos, usuario) {
  const nombre = texto(datos.nombre, "nombre", 120);
  const descripcion = texto(datos.descripcion, "descripción", 500, { obligatorio: false });
  const unidad = texto(datos.unidad, "unidad", 40);
  const prueba = validarPrueba(datos.prueba);
  const valor_meta = validarCifra(datos.valor_meta);
  let base = datos;
  let okr_clave = null;
  if (datos.okr_clave !== undefined && datos.okr_clave !== null) {
    const okr = okrVigente(DB, datos.okr_clave);
    if (!okr) throw new Error("El OKR no existe o fue eliminado");
    okr_clave = okr.clave;
    base = okr;
  }
  validarPeriodo(base.periodo, base.inicio);
  exigirAbierto(DB, base.periodo, base.inicio);
  const alcance = validarAlcance(DB, base);
  const id = siguienteId(DB.pos.metas_personalizadas);
  const meta = { id, clave: id, version: 1, vigente: true, retirada: null, reemplaza_a: null, motivo: null,
    okr_clave, nombre, descripcion, unidad, prueba, valor_meta, periodo: base.periodo, inicio: base.inicio,
    ...alcance, ...auditoria(usuario) };
  DB.pos.metas_personalizadas.push(meta);
  return meta;
}

function editarMeta(DB, clave, datos, usuario) {
  const anterior = metaVigente(DB, clave);
  if (!anterior) throw new Error("La meta no existe o fue eliminada");
  exigirAbierto(DB, anterior.periodo, anterior.inicio);
  if (Object.keys(datos).some((k) => k !== "motivo" && !EDITABLES_META.includes(k))) {
    throw new Error("Periodo, inicio, alcance y OKR no se pueden cambiar: elimina la meta y crea otra");
  }
  const motivo = motivoObligatorio(datos.motivo, "Cambiar una meta");
  const cambios = {};
  if ("nombre" in datos) cambios.nombre = texto(datos.nombre, "nombre", 120);
  if ("descripcion" in datos) cambios.descripcion = texto(datos.descripcion, "descripción", 500, { obligatorio: false });
  if ("unidad" in datos) cambios.unidad = texto(datos.unidad, "unidad", 40);
  if ("prueba" in datos) cambios.prueba = validarPrueba(datos.prueba);
  if ("valor_meta" in datos) cambios.valor_meta = validarCifra(datos.valor_meta);
  return nuevaVersion(DB.pos.metas_personalizadas, anterior, cambios, motivo, usuario);
}

function retirarMeta(DB, clave, motivo, usuario) {
  const meta = metaVigente(DB, clave);
  if (!meta) throw new Error("La meta no existe o fue eliminada");
  exigirAbierto(DB, meta.periodo, meta.inicio);
  return retirar(meta, motivoObligatorio(motivo, "Eliminar una meta"), usuario);
}

module.exports = {
  ALCANCES, PRUEBAS, periodoSellado, okrVigente, metaVigente, historial,
  crearOkr, editarOkr, retirarOkr, crearMeta, editarMeta, retirarMeta, motivoObligatorio,
};
