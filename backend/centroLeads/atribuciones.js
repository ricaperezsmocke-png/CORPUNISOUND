const {
  ErrorDominioCentroLeads,
  validarIdLogico,
  instanteContexto,
  textoRequerido,
  validarMetadataNoSensible,
} = require("./validaciones");
const { obtenerLead } = require("./leads");
const { obtenerFuente } = require("./fuentes");
const { obtenerContenido } = require("./contenidos");
const { registrarEventoHistorial } = require("./historial");

const METODOS_ATRIBUCION = Object.freeze([
  "DIRECTA", "ENLACE_RASTREADO", "CAMPAÑA", "DECLARADA", "DESCONOCIDA",
]);
const METODOS_TECNICOS = Object.freeze(["DIRECTA", "ENLACE_RASTREADO", "CAMPAÑA"]);
const PRECEDENCIA = Object.freeze({
  DESCONOCIDA: 1,
  DECLARADA: 2,
  "CAMPAÑA": 3,
  ENLACE_RASTREADO: 4,
  DIRECTA: 5,
});

function mapearAtribucion(fila) {
  if (!fila) return null;
  return {
    ...fila,
    evidencia: fila.evidencia_json ? JSON.parse(fila.evidencia_json) : null,
  };
}

function obtenerAtribucion(sqlite, id) {
  const fila = sqlite.prepare("SELECT * FROM lead_atribuciones WHERE id = ?").get(id);
  return fila ? mapearAtribucion(fila) : null;
}

function obtenerAtribucionPrincipal(sqlite, leadId) {
  const id = validarIdLogico(leadId, "lead_id", { opcional: false });
  obtenerLead(sqlite, id);
  const fila = sqlite.prepare(`
    SELECT * FROM lead_atribuciones
    WHERE lead_id = ? AND rol = 'ORIGEN' AND estado = 'ACTIVA'
  `).get(id);
  return fila ? mapearAtribucion(fila) : null;
}

function listarAtribuciones(sqlite, leadId) {
  const id = validarIdLogico(leadId, "lead_id", { opcional: false });
  obtenerLead(sqlite, id);
  return sqlite.prepare(`
    SELECT * FROM lead_atribuciones
    WHERE lead_id = ?
    ORDER BY detectada_en ASC, id ASC
  `).all(id).map(mapearAtribucion);
}

function validarMetodo(metodo) {
  const normalizado = textoRequerido(metodo, "metodo").toUpperCase();
  if (!METODOS_ATRIBUCION.includes(normalizado)) {
    throw new ErrorDominioCentroLeads("METODO_ATRIBUCION_INVALIDO", `Método de atribución inválido: ${normalizado}`);
  }
  return normalizado;
}

function prepararAtribucion(sqlite, datos, contexto) {
  const metodo = validarMetodo(datos.metodo);
  const fuenteId = validarIdLogico(datos.fuente_id, "fuente_id");
  const contenidoId = validarIdLogico(datos.contenido_id, "contenido_id");
  const eventoId = validarIdLogico(datos.evento_externo_id, "evento_externo_id");
  const fuente = fuenteId === null ? null : obtenerFuente(sqlite, fuenteId);
  const contenido = contenidoId === null ? null : obtenerContenido(sqlite, contenidoId);
  if (contenido && fuente && contenido.fuente_id !== fuente.id) {
    throw new ErrorDominioCentroLeads("FUENTE_CONTENIDO_INCONSISTENTE", "El contenido no pertenece a la fuente indicada");
  }
  if (contenido && !fuente) obtenerFuente(sqlite, contenido.fuente_id);
  if (eventoId !== null) {
    const evento = sqlite.prepare("SELECT id FROM lead_eventos_externos WHERE id = ?").get(eventoId);
    if (!evento) throw new ErrorDominioCentroLeads("EVENTO_NO_EXISTE", `El evento externo ${eventoId} no existe`);
  }
  const evidencia = datos.evidencia || {};
  if (metodo === "DIRECTA" && (eventoId === null || contenidoId === null)) {
    throw new ErrorDominioCentroLeads("EVIDENCIA_DIRECTA_INCOMPLETA", "DIRECTA requiere evento externo y contenido");
  }
  if (metodo === "ENLACE_RASTREADO" && (contenidoId === null || !evidencia.enlace_id)) {
    throw new ErrorDominioCentroLeads("EVIDENCIA_ENLACE_INCOMPLETA", "ENLACE_RASTREADO requiere contenido y enlace_id");
  }
  if (metodo === "CAMPAÑA" && fuenteId === null && contenidoId === null) {
    throw new ErrorDominioCentroLeads("EVIDENCIA_CAMPANA_INCOMPLETA", "CAMPAÑA requiere fuente o contenido");
  }
  const usuarioId = validarIdLogico(contexto.usuario_id, "usuario_id");
  if (metodo === "DECLARADA") {
    if (usuarioId === null) throw new ErrorDominioCentroLeads("ACTOR_REQUERIDO", "DECLARADA requiere un actor usuario");
    textoRequerido(evidencia.resumen_declaracion, "resumen_declaracion");
  }
  const clave = textoRequerido(datos.clave_idempotencia, "clave_idempotencia");
  const vendedor = contenido ? contenido.vendedor_origen_id : null;
  const sucursal = contenido ? contenido.sucursal_origen_id : null;
  return {
    metodo,
    fuente_id: fuenteId || (contenido ? contenido.fuente_id : null),
    contenido_id: contenidoId,
    evento_externo_id: eventoId,
    clave_idempotencia: clave,
    correlacion_id: datos.correlacion_id == null ? null : String(datos.correlacion_id).trim() || null,
    evidencia_json: validarMetadataNoSensible(evidencia),
    vendedor_origen_id: vendedor,
    sucursal_origen_id: sucursal,
    usuario_id: usuarioId,
    detectada_en: instanteContexto(contexto),
  };
}

function mismoRecorrido(actual, candidata) {
  return actual.correlacion_id && candidata.correlacion_id && actual.correlacion_id === candidata.correlacion_id;
}

function debeMejorar(actual, candidata) {
  if (!actual) return true;
  if (actual.metodo === "DIRECTA") return false;
  if (actual.metodo === "DESCONOCIDA" && candidata.metodo !== "DESCONOCIDA") return true;
  if (actual.metodo === "DECLARADA" && METODOS_TECNICOS.includes(candidata.metodo)) return true;
  return mismoRecorrido(actual, candidata) && PRECEDENCIA[candidata.metodo] > PRECEDENCIA[actual.metodo];
}

function insertarAtribucion(sqlite, leadId, datos, rol, reemplazaId = null) {
  const resultado = sqlite.prepare(`
    INSERT INTO lead_atribuciones (
      lead_id, fuente_id, contenido_id, evento_externo_id, metodo, rol, estado,
      clave_idempotencia, correlacion_id, evidencia_json,
      vendedor_origen_id, sucursal_origen_id, detectada_por_usuario_id,
      detectada_en, confirmada_por_usuario_id, confirmada_en,
      reemplaza_atribucion_id
    ) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVA', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    leadId,
    datos.fuente_id,
    datos.contenido_id,
    datos.evento_externo_id,
    datos.metodo,
    rol,
    datos.clave_idempotencia,
    datos.correlacion_id,
    datos.evidencia_json,
    datos.vendedor_origen_id,
    datos.sucursal_origen_id,
    datos.usuario_id,
    datos.detectada_en,
    METODOS_TECNICOS.includes(datos.metodo) ? datos.usuario_id : null,
    METODOS_TECNICOS.includes(datos.metodo) ? datos.detectada_en : null,
    reemplazaId
  );
  return Number(resultado.lastInsertRowid);
}

function materializarPrincipal(sqlite, leadId, atribucionId, datos) {
  if (METODOS_TECNICOS.includes(datos.metodo)) {
    sqlite.prepare(`
      UPDATE leads
      SET atribucion_origen_id = ?,
          vendedor_origen_id = ?,
          sucursal_origen_id = ?,
          actualizado_en = ?
      WHERE id = ?
    `).run(atribucionId, datos.vendedor_origen_id, datos.sucursal_origen_id, datos.detectada_en, leadId);
  } else {
    sqlite.prepare(`
      UPDATE leads SET atribucion_origen_id = ?, actualizado_en = ? WHERE id = ?
    `).run(atribucionId, datos.detectada_en, leadId);
  }
}

function registrarContextoHistorial(sqlite, leadId, atribucionId, datos, contexto, principalAnterior) {
  if (datos.fuente_id) {
    const fuente = obtenerFuente(sqlite, datos.fuente_id);
    registrarEventoHistorial(sqlite, leadId, "FUENTE_IDENTIFICADA", {
      fuente_id: fuente.id,
      plataforma: fuente.plataforma,
      identificador_externo: fuente.identificador_externo,
    }, { usuario_id: contexto.usuario_id, ocurrido_en: datos.detectada_en });
  }
  if (datos.contenido_id) {
    const contenido = obtenerContenido(sqlite, datos.contenido_id);
    registrarEventoHistorial(sqlite, leadId, "CONTENIDO_IDENTIFICADO", {
      contenido_id: contenido.id,
      fuente_id: contenido.fuente_id,
      identificador_externo: contenido.identificador_externo,
    }, { usuario_id: contexto.usuario_id, ocurrido_en: datos.detectada_en });
  }
  let tipo = "ATRIBUCION_ESTABLECIDA";
  let payload = {
    atribucion_id: atribucionId,
    metodo: datos.metodo,
    rol: obtenerAtribucion(sqlite, atribucionId).rol,
    contenido_id: datos.contenido_id,
    vendedor_origen_id: datos.vendedor_origen_id,
    sucursal_origen_id: datos.sucursal_origen_id,
  };
  if (datos.metodo === "DECLARADA" && !principalAnterior) tipo = "ATRIBUCION_DECLARADA";
  if (principalAnterior && obtenerAtribucion(sqlite, atribucionId).rol === "ORIGEN") {
    tipo = "ATRIBUCION_MEJORADA";
    payload = {
      atribucion_anterior_id: principalAnterior.id,
      atribucion_nueva_id: atribucionId,
      metodo_anterior: principalAnterior.metodo,
      metodo_nuevo: datos.metodo,
      motivo: "MISMO_RECORRIDO_MAYOR_EVIDENCIA",
    };
  }
  registrarEventoHistorial(sqlite, leadId, tipo, payload, {
    usuario_id: contexto.usuario_id,
    correlacion_id: datos.correlacion_id,
    ocurrido_en: datos.detectada_en,
  });
}

function registrarAtribucion(sqlite, leadId, datos = {}, contexto = {}) {
  const id = validarIdLogico(leadId, "lead_id", { opcional: false });
  obtenerLead(sqlite, id);
  const clave = textoRequerido(datos.clave_idempotencia, "clave_idempotencia");
  const existente = sqlite.prepare("SELECT * FROM lead_atribuciones WHERE clave_idempotencia = ?").get(clave);
  if (existente) return mapearAtribucion(existente);
  const preparada = prepararAtribucion(sqlite, datos, contexto);

  const operacion = sqlite.transaction(() => {
    const principal = obtenerAtribucionPrincipal(sqlite, id);
    const mejorar = debeMejorar(principal, preparada);
    let atribucionId;
    if (!principal) {
      atribucionId = insertarAtribucion(sqlite, id, preparada, "ORIGEN");
      materializarPrincipal(sqlite, id, atribucionId, preparada);
    } else if (mejorar) {
      atribucionId = insertarAtribucion(sqlite, id, preparada, "ASISTIDA", principal.id);
      sqlite.prepare(`
        UPDATE lead_atribuciones
        SET estado = 'SUPERADA', superada_por_atribucion_id = ?,
            superada_por_usuario_id = ?, superada_en = ?,
            motivo_superacion = 'MISMO_RECORRIDO_MAYOR_EVIDENCIA'
        WHERE id = ?
      `).run(atribucionId, preparada.usuario_id, preparada.detectada_en, principal.id);
      sqlite.prepare("UPDATE lead_atribuciones SET rol = 'ORIGEN' WHERE id = ?").run(atribucionId);
      materializarPrincipal(sqlite, id, atribucionId, preparada);
    } else {
      atribucionId = insertarAtribucion(sqlite, id, preparada, "ASISTIDA");
    }
    registrarContextoHistorial(sqlite, id, atribucionId, preparada, contexto, mejorar ? principal : null);
    return obtenerAtribucion(sqlite, atribucionId);
  });
  return operacion();
}

function validarAutorizacionCorreccion(lead, datos, contexto) {
  if (!Array.isArray(contexto.permisos) || !contexto.permisos.includes("corregir_atribucion_lead")) {
    throw new ErrorDominioCentroLeads("PERMISO_REQUERIDO", "Se requiere el permiso corregir_atribucion_lead");
  }
  textoRequerido(datos.motivo, "motivo");
  validarIdLogico(contexto.usuario_id, "usuario_id", { opcional: false });
  const alcance = contexto.alcance || {};
  const sucursalLead = lead.sucursal_asignada_id || lead.sucursal_origen_id;
  if (!alcance.verTodas && (!sucursalLead || Number(alcance.sucursalId) !== Number(sucursalLead))) {
    throw new ErrorDominioCentroLeads("FUERA_DE_ALCANCE", "El actor no tiene alcance sobre la sucursal del lead");
  }
}

function corregirAtribucionLead(sqlite, leadId, datos = {}, contexto = {}) {
  const id = validarIdLogico(leadId, "lead_id", { opcional: false });
  const lead = obtenerLead(sqlite, id);
  validarAutorizacionCorreccion(lead, datos, contexto);
  const principal = obtenerAtribucionPrincipal(sqlite, id);
  if (!principal || !METODOS_TECNICOS.includes(principal.metodo)) {
    throw new ErrorDominioCentroLeads("ORIGEN_NO_COMPROBADO", "No existe un origen técnico comprobado que corregir");
  }
  const preparada = prepararAtribucion(sqlite, datos, contexto);
  if (!METODOS_TECNICOS.includes(preparada.metodo)) {
    throw new ErrorDominioCentroLeads("CORRECCION_NO_TECNICA", "La corrección debe aportar evidencia técnica");
  }
  if (
    principal.sucursal_origen_id && preparada.sucursal_origen_id &&
    Number(principal.sucursal_origen_id) !== Number(preparada.sucursal_origen_id) &&
    !contexto.alcance.verTodas
  ) {
    throw new ErrorDominioCentroLeads("ALCANCE_GLOBAL_REQUERIDO", "La corrección entre sucursales requiere alcance global");
  }
  const motivo = textoRequerido(datos.motivo, "motivo");
  const yaExiste = sqlite.prepare("SELECT * FROM lead_atribuciones WHERE clave_idempotencia = ?").get(preparada.clave_idempotencia);
  if (yaExiste) return mapearAtribucion(yaExiste);

  const operacion = sqlite.transaction(() => {
    const nuevaId = insertarAtribucion(sqlite, id, preparada, "ASISTIDA", principal.id);
    sqlite.prepare(`
      UPDATE lead_atribuciones
      SET estado = 'SUPERADA', superada_por_atribucion_id = ?,
          superada_por_usuario_id = ?, superada_en = ?, motivo_superacion = ?
      WHERE id = ?
    `).run(nuevaId, contexto.usuario_id, preparada.detectada_en, motivo, principal.id);
    sqlite.prepare("UPDATE lead_atribuciones SET rol = 'ORIGEN' WHERE id = ?").run(nuevaId);
    materializarPrincipal(sqlite, id, nuevaId, preparada);
    registrarEventoHistorial(sqlite, id, "ATRIBUCION_CORREGIDA", {
      atribucion_anterior_id: principal.id,
      atribucion_nueva_id: nuevaId,
      motivo,
    }, {
      usuario_id: contexto.usuario_id,
      correlacion_id: preparada.correlacion_id,
      ocurrido_en: preparada.detectada_en,
    });
    return obtenerAtribucion(sqlite, nuevaId);
  });
  return operacion();
}

function establecerOrigenComprobado(sqlite, leadId, datos, contexto) {
  if (!METODOS_TECNICOS.includes(String(datos.metodo || "").toUpperCase())) {
    throw new ErrorDominioCentroLeads("ORIGEN_NO_TECNICO", "Solo una atribución técnica puede establecer origen comprobado");
  }
  return registrarAtribucion(sqlite, leadId, datos, contexto);
}

module.exports = {
  METODOS_ATRIBUCION,
  METODOS_TECNICOS,
  registrarAtribucion,
  obtenerAtribucionPrincipal,
  listarAtribuciones,
  establecerOrigenComprobado,
  corregirAtribucionLead,
};
