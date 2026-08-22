const {
  ErrorDominioCentroLeads,
  ESTADOS_TERMINALES,
  validarIdLogico,
  validarTransicion,
  normalizarTelefono,
  normalizarEmail,
  instanteContexto,
} = require("./validaciones");
const { registrarEventoHistorial } = require("./historial");

function textoOpcional(valor) {
  if (valor === undefined || valor === null) return null;
  const texto = String(valor).trim();
  return texto || null;
}

function mapearLead(fila) {
  if (!fila) return null;
  const { telefono_normalizado, email_normalizado, ...resto } = fila;
  return { ...resto, telefono: telefono_normalizado, email: email_normalizado };
}

function obtenerLead(sqlite, leadId) {
  const id = validarIdLogico(leadId, "lead_id", { opcional: false });
  const fila = sqlite.prepare("SELECT * FROM leads WHERE id = ?").get(id);
  if (!fila) {
    throw new ErrorDominioCentroLeads("LEAD_NO_EXISTE", `El lead ${id} no existe`);
  }
  return mapearLead(fila);
}

function crearLead(sqlite, datos = {}, contexto = {}) {
  const ocurrido_en = instanteContexto(contexto);
  const valores = {
    conversacion_principal_id: validarIdLogico(datos.conversacion_principal_id, "conversacion_principal_id"),
    identidad_principal_id: validarIdLogico(datos.identidad_externa_id, "identidad_externa_id"),
    cliente_id: validarIdLogico(datos.cliente_id, "cliente_id"),
    producto_id: validarIdLogico(datos.producto_id, "producto_id"),
    vendedor_origen_id: validarIdLogico(datos.vendedor_origen_id, "vendedor_origen_id"),
    vendedor_asignado_id: validarIdLogico(datos.vendedor_asignado_id, "vendedor_asignado_id"),
    sucursal_origen_id: validarIdLogico(datos.sucursal_origen_id, "sucursal_origen_id"),
    sucursal_asignada_id: validarIdLogico(datos.sucursal_asignada_id, "sucursal_asignada_id"),
    creado_por_usuario_id: validarIdLogico(contexto.usuario_id, "usuario_id"),
    prioridad: textoOpcional(datos.prioridad),
    nombre: textoOpcional(datos.nombre),
    telefono_normalizado: normalizarTelefono(datos.telefono),
    email_normalizado: normalizarEmail(datos.email),
    interes: textoOpcional(datos.interes),
    ubicacion: textoOpcional(datos.ubicacion),
    origen: textoOpcional(datos.origen),
  };

  const operacion = sqlite.transaction(() => {
    const resultado = sqlite.prepare(`
      INSERT INTO leads (
        conversacion_principal_id, identidad_principal_id, cliente_id, producto_id,
        estado, prioridad, vendedor_origen_id, vendedor_asignado_id,
        sucursal_origen_id, sucursal_asignada_id, creado_por_usuario_id,
        creado_en, actualizado_en, ultima_interaccion_en,
        nombre, telefono_normalizado, email_normalizado, interes, ubicacion, origen
      ) VALUES (
        @conversacion_principal_id, @identidad_principal_id, @cliente_id, @producto_id,
        'NUEVO', @prioridad, @vendedor_origen_id, @vendedor_asignado_id,
        @sucursal_origen_id, @sucursal_asignada_id, @creado_por_usuario_id,
        @ocurrido_en, @ocurrido_en, @ocurrido_en,
        @nombre, @telefono_normalizado, @email_normalizado, @interes, @ubicacion, @origen
      )
    `).run({ ...valores, ocurrido_en });
    const id = Number(resultado.lastInsertRowid);
    registrarEventoHistorial(sqlite, id, "LEAD_CREADO", { estado: "NUEVO" }, {
      usuario_id: contexto.usuario_id,
      origen: valores.origen,
      ocurrido_en,
    });
    return obtenerLead(sqlite, id);
  });

  return operacion();
}

const CAMPOS_EDITABLES = Object.freeze({
  nombre: { columna: "nombre", normalizar: textoOpcional },
  telefono: { columna: "telefono_normalizado", normalizar: normalizarTelefono },
  email: { columna: "email_normalizado", normalizar: normalizarEmail },
  cliente_id: { columna: "cliente_id", normalizar: (v) => validarIdLogico(v, "cliente_id") },
  producto_id: { columna: "producto_id", normalizar: (v) => validarIdLogico(v, "producto_id") },
  interes: { columna: "interes", normalizar: textoOpcional },
  ubicacion: { columna: "ubicacion", normalizar: textoOpcional },
  prioridad: { columna: "prioridad", normalizar: textoOpcional },
});

const CAMPOS_PROTEGIDOS = new Set([
  "id",
  "estado",
  "creado_en",
  "actualizado_en",
  "ultima_interaccion_en",
  "cerrado_en",
  "origen",
  "vendedor_origen_id",
  "sucursal_origen_id",
  "vendedor_asignado_id",
  "sucursal_asignada_id",
  "historial",
]);

function actualizarLead(sqlite, leadId, cambios = {}, contexto = {}) {
  const id = validarIdLogico(leadId, "lead_id", { opcional: false });
  const actual = obtenerLead(sqlite, id);
  const cambiosEfectivos = {};
  const asignaciones = [];

  for (const [campo, valor] of Object.entries(cambios)) {
    if (CAMPOS_PROTEGIDOS.has(campo)) {
      throw new ErrorDominioCentroLeads("CAMPO_PROTEGIDO", `${campo} es un campo protegido`);
    }
    const definicion = CAMPOS_EDITABLES[campo];
    if (!definicion) {
      throw new ErrorDominioCentroLeads("CAMPO_NO_PERMITIDO", `${campo} no es un campo editable`);
    }
    const normalizado = definicion.normalizar(valor);
    if (actual[campo] !== normalizado) {
      cambiosEfectivos[campo] = { anterior: actual[campo], nuevo: normalizado };
      asignaciones.push({ columna: definicion.columna, valor: normalizado });
    }
  }

  if (asignaciones.length === 0) return actual;
  const ocurrido_en = instanteContexto(contexto);
  const operacion = sqlite.transaction(() => {
    const clausulas = asignaciones.map(({ columna }) => `${columna} = ?`);
    sqlite.prepare(`
      UPDATE leads
      SET ${clausulas.join(", ")}, actualizado_en = ?
      WHERE id = ?
    `).run(...asignaciones.map(({ valor }) => valor), ocurrido_en, id);
    registrarEventoHistorial(sqlite, id, "DATOS_ACTUALIZADOS", { cambios: cambiosEfectivos }, {
      usuario_id: contexto.usuario_id,
      origen: contexto.origen,
      ocurrido_en,
    });
    return obtenerLead(sqlite, id);
  });
  return operacion();
}

function cambiarEstadoLead(sqlite, leadId, nuevoEstado, contexto = {}) {
  const id = validarIdLogico(leadId, "lead_id", { opcional: false });
  const ocurrido_en = instanteContexto(contexto);
  const operacion = sqlite.transaction(() => {
    const actual = obtenerLead(sqlite, id);
    validarTransicion(actual.estado, nuevoEstado);
    const cerrado_en = ESTADOS_TERMINALES.includes(nuevoEstado) ? ocurrido_en : null;
    sqlite.prepare(`
      UPDATE leads
      SET estado = ?, actualizado_en = ?, cerrado_en = ?
      WHERE id = ?
    `).run(nuevoEstado, ocurrido_en, cerrado_en, id);
    registrarEventoHistorial(sqlite, id, "CAMBIO_ESTADO", {
      estado_anterior: actual.estado,
      estado_nuevo: nuevoEstado,
    }, {
      usuario_id: contexto.usuario_id,
      origen: contexto.origen,
      ocurrido_en,
    });
    return obtenerLead(sqlite, id);
  });
  return operacion();
}

module.exports = { crearLead, obtenerLead, actualizarLead, cambiarEstadoLead };
