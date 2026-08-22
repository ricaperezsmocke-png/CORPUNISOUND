const {
  ErrorDominioCentroLeads,
  validarIdLogico,
  instanteContexto,
  textoRequerido,
} = require("./validaciones");
const { obtenerLead } = require("./leads");
const { registrarEventoHistorial } = require("./historial");

function mapearAsignacion(fila) {
  if (!fila) return null;
  return {
    id: fila.id,
    lead_id: fila.lead_id,
    vendedor_id: fila.vendedor_asignado_id,
    sucursal_id: fila.sucursal_asignada_id,
    regla: fila.regla,
    motivo: fila.motivo,
    asignada_por_usuario_id: fila.asignada_por_usuario_id,
    asignada_en: fila.asignada_en,
    finalizada_en: fila.finalizada_en,
    origen_registro: "HISTORIAL_ASIGNACIONES",
  };
}

function obtenerAsignacionActual(sqlite, leadId) {
  const id = validarIdLogico(leadId, "lead_id", { opcional: false });
  const lead = obtenerLead(sqlite, id);
  const fila = sqlite.prepare(`
    SELECT * FROM lead_asignaciones
    WHERE lead_id = ? AND finalizada_en IS NULL
  `).get(id);
  if (fila) return mapearAsignacion(fila);
  if (lead.vendedor_asignado_id !== null || lead.sucursal_asignada_id !== null) {
    return {
      id: null,
      lead_id: id,
      vendedor_id: lead.vendedor_asignado_id,
      sucursal_id: lead.sucursal_asignada_id,
      regla: null,
      motivo: null,
      asignada_por_usuario_id: null,
      asignada_en: null,
      finalizada_en: null,
      origen_registro: "SNAPSHOT_FASE2",
    };
  }
  return null;
}

function listarAsignaciones(sqlite, leadId) {
  const id = validarIdLogico(leadId, "lead_id", { opcional: false });
  obtenerLead(sqlite, id);
  return sqlite.prepare(`
    SELECT * FROM lead_asignaciones
    WHERE lead_id = ?
    ORDER BY asignada_en ASC, id ASC
  `).all(id).map(mapearAsignacion);
}

function validarDestino(datos) {
  const vendedor = validarIdLogico(datos.vendedor_id, "vendedor_id");
  const sucursal = validarIdLogico(datos.sucursal_id, "sucursal_id");
  if (vendedor === null && sucursal === null) {
    throw new ErrorDominioCentroLeads("ASIGNACION_VACIA", "La asignación requiere vendedor_id o sucursal_id");
  }
  return {
    vendedor_id: vendedor,
    sucursal_id: sucursal,
    regla: textoRequerido(datos.regla, "regla"),
    motivo: datos.motivo == null ? null : String(datos.motivo).trim() || null,
  };
}

function insertarAsignacion(sqlite, leadId, destino, contexto, ahora) {
  const actor = validarIdLogico(contexto.usuario_id, "usuario_id");
  const resultado = sqlite.prepare(`
    INSERT INTO lead_asignaciones (
      lead_id, vendedor_asignado_id, sucursal_asignada_id,
      regla, motivo, asignada_por_usuario_id, asignada_en
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    leadId,
    destino.vendedor_id,
    destino.sucursal_id,
    destino.regla,
    destino.motivo,
    actor,
    ahora
  );
  return Number(resultado.lastInsertRowid);
}

function asignarLead(sqlite, leadId, datos = {}, contexto = {}) {
  const id = validarIdLogico(leadId, "lead_id", { opcional: false });
  const destino = validarDestino(datos);
  const ahora = instanteContexto(contexto);
  const operacion = sqlite.transaction(() => {
    const lead = obtenerLead(sqlite, id);
    const actual = obtenerAsignacionActual(sqlite, id);
    if (actual && actual.id !== null) {
      throw new ErrorDominioCentroLeads("ASIGNACION_YA_EXISTE", "El lead ya tiene una asignación activa");
    }
    if (
      actual && actual.id === null &&
      (actual.vendedor_id !== destino.vendedor_id || actual.sucursal_id !== destino.sucursal_id)
    ) {
      throw new ErrorDominioCentroLeads("REASIGNACION_REQUERIDA", "El lead ya tiene un snapshot asignado; usa reasignarLead");
    }
    const asignacionId = insertarAsignacion(sqlite, id, destino, contexto, ahora);
    sqlite.prepare(`
      UPDATE leads
      SET vendedor_asignado_id = ?, sucursal_asignada_id = ?, actualizado_en = ?
      WHERE id = ?
    `).run(destino.vendedor_id, destino.sucursal_id, ahora, id);
    registrarEventoHistorial(sqlite, id, "ASIGNACION_REALIZADA", {
      vendedor_anterior_id: actual ? actual.vendedor_id : null,
      vendedor_nuevo_id: destino.vendedor_id,
      sucursal_anterior_id: actual ? actual.sucursal_id : null,
      sucursal_nueva_id: destino.sucursal_id,
      regla: destino.regla,
      motivo: destino.motivo,
      ...(actual && actual.origen_registro === "SNAPSHOT_FASE2"
        ? { origen_registro_anterior: "SNAPSHOT_FASE2" }
        : {}),
    }, { usuario_id: contexto.usuario_id, ocurrido_en: ahora });
    if (lead.estado === "NUEVO") {
      sqlite.prepare(`
        UPDATE leads SET estado = 'ASIGNADO', actualizado_en = ? WHERE id = ?
      `).run(ahora, id);
      registrarEventoHistorial(sqlite, id, "CAMBIO_ESTADO", {
        estado_anterior: "NUEVO",
        estado_nuevo: "ASIGNADO",
      }, { usuario_id: contexto.usuario_id, ocurrido_en: ahora });
    }
    return mapearAsignacion(sqlite.prepare("SELECT * FROM lead_asignaciones WHERE id = ?").get(asignacionId));
  });
  return operacion();
}

function reasignarLead(sqlite, leadId, datos = {}, contexto = {}) {
  const id = validarIdLogico(leadId, "lead_id", { opcional: false });
  const destino = validarDestino(datos);
  const motivo = textoRequerido(datos.motivo, "motivo");
  destino.motivo = motivo;
  const ahora = instanteContexto(contexto);
  const operacion = sqlite.transaction(() => {
    const actual = obtenerAsignacionActual(sqlite, id);
    if (!actual) throw new ErrorDominioCentroLeads("ASIGNACION_NO_EXISTE", "El lead no tiene una asignación que reasignar");
    if (actual.id !== null) {
      sqlite.prepare(`
        UPDATE lead_asignaciones SET finalizada_en = ?
        WHERE id = ? AND finalizada_en IS NULL
      `).run(ahora, actual.id);
    }
    const nuevaId = insertarAsignacion(sqlite, id, destino, contexto, ahora);
    sqlite.prepare(`
      UPDATE leads
      SET vendedor_asignado_id = ?, sucursal_asignada_id = ?, actualizado_en = ?
      WHERE id = ?
    `).run(destino.vendedor_id, destino.sucursal_id, ahora, id);
    registrarEventoHistorial(sqlite, id, "REASIGNACION_REALIZADA", {
      vendedor_anterior_id: actual.vendedor_id,
      vendedor_nuevo_id: destino.vendedor_id,
      sucursal_anterior_id: actual.sucursal_id,
      sucursal_nueva_id: destino.sucursal_id,
      regla: destino.regla,
      motivo,
      ...(actual.origen_registro === "SNAPSHOT_FASE2"
        ? { origen_registro_anterior: "SNAPSHOT_FASE2" }
        : {}),
    }, { usuario_id: contexto.usuario_id, ocurrido_en: ahora });
    return mapearAsignacion(sqlite.prepare("SELECT * FROM lead_asignaciones WHERE id = ?").get(nuevaId));
  });
  return operacion();
}

function evaluarCreadorPrioritario(datos = {}) {
  if (!datos.vendedor_origen_id) return { es_candidato: false, motivo: "SIN_CREADOR_COMPROBADO" };
  if (!datos.activo) return { es_candidato: false, motivo: "VENDEDOR_INACTIVO" };
  if (!datos.puede_atender) return { es_candidato: false, motivo: "NO_PUEDE_ATENDER" };
  if (!datos.disponible) return { es_candidato: false, motivo: "VENDEDOR_NO_DISPONIBLE" };
  if (!datos.tiene_capacidad) return { es_candidato: false, motivo: "SIN_CAPACIDAD" };
  if (!datos.alcance_permitido) return { es_candidato: false, motivo: "FUERA_DE_ALCANCE" };
  return { es_candidato: true, motivo: "CREADOR_PRIORITARIO" };
}

module.exports = {
  asignarLead,
  reasignarLead,
  obtenerAsignacionActual,
  listarAsignaciones,
  evaluarCreadorPrioritario,
};
