const {
  ErrorDominioCentroLeads,
  validarIdLogico,
  normalizarFechaUtc,
  instanteContexto,
} = require("./validaciones");
const { registrarEventoHistorial } = require("./historial");
const { obtenerLead } = require("./leads");

function mapearSeguimiento(fila) {
  if (!fila) return null;
  return {
    id: fila.id,
    lead_id: fila.lead_id,
    usuario_id: fila.responsable_usuario_id,
    fecha: fila.programado_para,
    comentario: fila.nota,
    proxima_fecha: fila.proxima_fecha,
    creado_en: fila.creado_en,
  };
}

function agregarSeguimiento(sqlite, leadId, datos = {}, contexto = {}) {
  const lead_id = validarIdLogico(leadId, "lead_id", { opcional: false });
  const usuario_id = validarIdLogico(datos.usuario_id, "usuario_id", { opcional: false });
  const comentario = datos.comentario == null ? "" : String(datos.comentario).trim();
  if (!comentario) {
    throw new ErrorDominioCentroLeads("COMENTARIO_REQUERIDO", "El comentario es obligatorio");
  }
  const fecha = normalizarFechaUtc(datos.fecha, "fecha");
  const proxima_fecha = datos.proxima_fecha == null || datos.proxima_fecha === ""
    ? null
    : normalizarFechaUtc(datos.proxima_fecha, "proxima_fecha");
  const creado_en = instanteContexto(contexto);

  const operacion = sqlite.transaction(() => {
    const lead = obtenerLead(sqlite, lead_id);
    const resultado = sqlite.prepare(`
      INSERT INTO lead_seguimientos (
        lead_id, responsable_usuario_id, estado, programado_para,
        completado_en, nota, creado_en, proxima_fecha
      ) VALUES (?, ?, 'completado', ?, ?, ?, ?, ?)
    `).run(lead_id, usuario_id, fecha, fecha, comentario, creado_en, proxima_fecha);
    const id = Number(resultado.lastInsertRowid);
    if (!lead.ultima_interaccion_en || fecha > lead.ultima_interaccion_en) {
      sqlite.prepare(`
        UPDATE leads SET ultima_interaccion_en = ?, actualizado_en = ? WHERE id = ?
      `).run(fecha, creado_en, lead_id);
    }
    registrarEventoHistorial(sqlite, lead_id, "SEGUIMIENTO_AGREGADO", {
      seguimiento_id: id,
      fecha,
      proxima_fecha,
    }, {
      usuario_id,
      origen: contexto.origen,
      ocurrido_en: creado_en,
    });
    return mapearSeguimiento(sqlite.prepare("SELECT * FROM lead_seguimientos WHERE id = ?").get(id));
  });
  return operacion();
}

function listarSeguimientosLead(sqlite, leadId) {
  const id = validarIdLogico(leadId, "lead_id", { opcional: false });
  obtenerLead(sqlite, id);
  return sqlite.prepare(`
    SELECT * FROM lead_seguimientos
    WHERE lead_id = ?
    ORDER BY programado_para ASC, id ASC
  `).all(id).map(mapearSeguimiento);
}

module.exports = { agregarSeguimiento, listarSeguimientosLead };
