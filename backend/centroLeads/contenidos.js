const {
  ErrorDominioCentroLeads,
  validarIdLogico,
  normalizarFechaUtc,
  instanteContexto,
  textoRequerido,
  validarMetadataNoSensible,
} = require("./validaciones");
const { obtenerFuente } = require("./fuentes");

const TIPOS_CONTENIDO = Object.freeze([
  "VIDEO", "REEL", "PUBLICACION", "ANUNCIO", "CAMPAÑA", "QR", "ENLACE",
]);

function textoOpcional(valor) {
  if (valor === undefined || valor === null) return null;
  const texto = String(valor).trim();
  return texto || null;
}

function mapearContenido(fila) {
  return {
    ...fila,
    campana: fila.campana_externa_id,
    activa: fila.activa === 1,
    metadata: fila.metadata_json ? JSON.parse(fila.metadata_json) : null,
  };
}

function obtenerContenido(sqlite, contenidoId) {
  const id = validarIdLogico(contenidoId, "contenido_id", { opcional: false });
  const fila = sqlite.prepare("SELECT * FROM lead_contenidos WHERE id = ?").get(id);
  if (!fila) throw new ErrorDominioCentroLeads("CONTENIDO_NO_EXISTE", `El contenido ${id} no existe`);
  return mapearContenido(fila);
}

function crearContenido(sqlite, datos = {}, contexto = {}) {
  const fuenteId = validarIdLogico(datos.fuente_id, "fuente_id", { opcional: false });
  const fuente = obtenerFuente(sqlite, fuenteId);
  const tipo = textoRequerido(datos.tipo, "tipo").toUpperCase();
  if (!TIPOS_CONTENIDO.includes(tipo)) {
    throw new ErrorDominioCentroLeads("TIPO_CONTENIDO_INVALIDO", `Tipo de contenido inválido: ${tipo}`);
  }
  const identificador = textoRequerido(datos.identificador_externo, "identificador_externo");
  const existente = sqlite.prepare(`
    SELECT id FROM lead_contenidos WHERE fuente_id = ? AND identificador_externo = ?
  `).get(fuenteId, identificador);
  if (existente) return obtenerContenido(sqlite, existente.id);

  const publicado = datos.publicado_en == null ? null : normalizarFechaUtc(datos.publicado_en, "publicado_en");
  const creado = instanteContexto(contexto);
  const resultado = sqlite.prepare(`
    INSERT INTO lead_contenidos (
      fuente_id, canal, tipo, identificador_externo, titulo, url,
      campana_externa_id, producto_id, vendedor_origen_id,
      sucursal_origen_id, publicado_en, activa, metadata_json, creado_en
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    fuenteId,
    fuente.canal,
    tipo,
    identificador,
    textoOpcional(datos.titulo),
    textoOpcional(datos.url),
    textoOpcional(datos.campana),
    validarIdLogico(datos.producto_id, "producto_id"),
    validarIdLogico(datos.vendedor_origen_id, "vendedor_origen_id"),
    validarIdLogico(datos.sucursal_origen_id, "sucursal_origen_id"),
    publicado,
    validarMetadataNoSensible(datos.metadata),
    creado
  );
  return obtenerContenido(sqlite, Number(resultado.lastInsertRowid));
}

module.exports = { TIPOS_CONTENIDO, crearContenido, obtenerContenido };
