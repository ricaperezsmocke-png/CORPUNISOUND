const {
  ErrorDominioCentroLeads,
  validarIdLogico,
  instanteContexto,
  textoRequerido,
  validarMetadataNoSensible,
} = require("./validaciones");

function mapearFuente(fila) {
  if (!fila) return null;
  return {
    id: fila.id,
    canal: fila.canal,
    plataforma: fila.plataforma,
    proveedor: fila.proveedor,
    identificador_externo: fila.identificador_externo,
    nombre: fila.nombre,
    sucursal_id: fila.sucursal_responsable_id,
    vendedor_id: fila.vendedor_responsable_id,
    activa: fila.activa === 1,
    metadata: fila.metadata_json ? JSON.parse(fila.metadata_json) : null,
    creada_en: fila.creada_en,
    actualizada_en: fila.actualizada_en,
  };
}

function obtenerFuente(sqlite, fuenteId) {
  const id = validarIdLogico(fuenteId, "fuente_id", { opcional: false });
  const fila = sqlite.prepare("SELECT * FROM lead_fuentes WHERE id = ?").get(id);
  if (!fila) throw new ErrorDominioCentroLeads("FUENTE_NO_EXISTE", `La fuente ${id} no existe`);
  return mapearFuente(fila);
}

function crearFuente(sqlite, datos = {}, contexto = {}) {
  const canal = textoRequerido(datos.canal, "canal").toLowerCase();
  const plataforma = textoRequerido(datos.plataforma, "plataforma").toLowerCase();
  const proveedor = textoRequerido(datos.proveedor, "proveedor").toLowerCase();
  const identificador = textoRequerido(datos.identificador_externo, "identificador_externo");
  const nombre = textoRequerido(datos.nombre, "nombre");
  const sucursal = validarIdLogico(datos.sucursal_id, "sucursal_id");
  const vendedor = validarIdLogico(datos.vendedor_id, "vendedor_id");
  const metadata = validarMetadataNoSensible(datos.metadata);
  const ahora = instanteContexto(contexto);
  const existente = sqlite.prepare(`
    SELECT id FROM lead_fuentes WHERE proveedor = ? AND identificador_externo = ?
  `).get(proveedor, identificador);
  if (existente) return obtenerFuente(sqlite, existente.id);

  const resultado = sqlite.prepare(`
    INSERT INTO lead_fuentes (
      canal, plataforma, proveedor, identificador_externo, nombre,
      sucursal_responsable_id, vendedor_responsable_id, activa,
      metadata_json, creada_en, actualizada_en
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
  `).run(canal, plataforma, proveedor, identificador, nombre, sucursal, vendedor, metadata, ahora, ahora);
  return obtenerFuente(sqlite, Number(resultado.lastInsertRowid));
}

module.exports = { crearFuente, obtenerFuente };
