const crypto = require("crypto");
const {
  ErrorDominioCentroLeads,
  validarIdLogico,
  normalizarFechaUtc,
  instanteContexto,
  textoRequerido,
} = require("./validaciones");
const { obtenerContenido } = require("./contenidos");

const DESTINOS = Object.freeze(["WHATSAPP", "MESSENGER", "LANDING"]);

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function mapearEnlace(fila) {
  return {
    id: fila.id,
    contenido_id: fila.contenido_id,
    campana: fila.campana_externa_id,
    vendedor_origen_id: fila.vendedor_origen_id,
    sucursal_origen_id: fila.sucursal_origen_id,
    destino_tipo: fila.destino_tipo,
    destino_url: fila.destino_url,
    activa: fila.activa === 1,
    creado_por_usuario_id: fila.creado_por_usuario_id,
    creado_en: fila.creado_en,
    expira_en: fila.expira_en,
    archivado_en: fila.archivado_en,
  };
}

function generarEnlaceRastreado(sqlite, datos = {}, contexto = {}) {
  const contenidoId = validarIdLogico(datos.contenido_id, "contenido_id", { opcional: false });
  const contenido = obtenerContenido(sqlite, contenidoId);
  if (!contenido.activa) throw new ErrorDominioCentroLeads("CONTENIDO_ARCHIVADO", "El contenido está archivado");
  const destino = textoRequerido(datos.destino_tipo, "destino_tipo").toUpperCase();
  if (!DESTINOS.includes(destino)) {
    throw new ErrorDominioCentroLeads("DESTINO_INVALIDO", `Destino de enlace inválido: ${destino}`);
  }
  const url = textoRequerido(datos.destino_url, "destino_url");
  const token = typeof contexto.generarToken === "function"
    ? contexto.generarToken()
    : crypto.randomBytes(32).toString("base64url");
  if (Buffer.byteLength(String(token), "utf8") < 32) {
    throw new ErrorDominioCentroLeads("TOKEN_DEBIL", "El token rastreado no tiene suficiente entropía");
  }
  const ahora = instanteContexto(contexto);
  const expira = datos.expira_en == null ? null : normalizarFechaUtc(datos.expira_en, "expira_en");
  const resultado = sqlite.prepare(`
    INSERT INTO lead_enlaces_rastreados (
      token_hash, contenido_id, campana_externa_id,
      vendedor_origen_id, sucursal_origen_id, destino_tipo, destino_url,
      creado_por_usuario_id, creado_en, expira_en
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    hashToken(token),
    contenidoId,
    datos.campana || contenido.campana,
    contenido.vendedor_origen_id,
    contenido.sucursal_origen_id,
    destino,
    url,
    validarIdLogico(contexto.usuario_id, "usuario_id"),
    ahora,
    expira
  );
  return { ...mapearEnlace(sqlite.prepare("SELECT * FROM lead_enlaces_rastreados WHERE id = ?").get(resultado.lastInsertRowid)), token };
}

function resolverEnlaceRastreado(sqlite, token, contexto = {}) {
  const fila = sqlite.prepare("SELECT * FROM lead_enlaces_rastreados WHERE token_hash = ?").get(hashToken(token));
  if (!fila) throw new ErrorDominioCentroLeads("ENLACE_NO_EXISTE", "El enlace rastreado no existe");
  if (fila.activa !== 1 || fila.archivado_en) {
    throw new ErrorDominioCentroLeads("ENLACE_INACTIVO", "El enlace rastreado está inactivo");
  }
  const ahora = instanteContexto(contexto);
  if (fila.expira_en && fila.expira_en < ahora) {
    throw new ErrorDominioCentroLeads("ENLACE_EXPIRADO", "El enlace rastreado está expirado");
  }
  const contenido = obtenerContenido(sqlite, fila.contenido_id);
  if (!contenido.activa) throw new ErrorDominioCentroLeads("CONTENIDO_ARCHIVADO", "El contenido está archivado");
  return { ...mapearEnlace(fila), contenido };
}

module.exports = { generarEnlaceRastreado, resolverEnlaceRastreado };
