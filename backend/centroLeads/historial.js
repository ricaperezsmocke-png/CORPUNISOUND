const { validarIdLogico } = require("./validaciones");

function registrarEventoHistorial(sqlite, leadId, tipo, datos, contexto = {}) {
  const lead_id = validarIdLogico(leadId, "lead_id", { opcional: false });
  const actor_usuario_id = validarIdLogico(contexto.usuario_id, "usuario_id");
  const ocurrido_en = contexto.ocurrido_en;
  const resultado = sqlite.prepare(`
    INSERT INTO lead_historial
      (lead_id, tipo, actor_tipo, actor_usuario_id, origen, datos_json, correlacion_id, ocurrido_en)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    lead_id,
    tipo,
    actor_usuario_id === null ? "sistema" : "usuario",
    actor_usuario_id,
    contexto.origen || null,
    datos == null ? null : JSON.stringify(datos),
    contexto.correlacion_id || null,
    ocurrido_en
  );
  return Number(resultado.lastInsertRowid);
}

function obtenerHistorialLead(sqlite, leadId) {
  const id = validarIdLogico(leadId, "lead_id", { opcional: false });
  return sqlite.prepare(`
    SELECT id, lead_id, tipo, actor_tipo, actor_usuario_id, origen,
           datos_json, correlacion_id, ocurrido_en
    FROM lead_historial
    WHERE lead_id = ?
    ORDER BY ocurrido_en ASC, id ASC
  `).all(id).map((fila) => ({
    ...fila,
    datos: fila.datos_json ? JSON.parse(fila.datos_json) : null,
  }));
}

module.exports = { registrarEventoHistorial, obtenerHistorialLead };
