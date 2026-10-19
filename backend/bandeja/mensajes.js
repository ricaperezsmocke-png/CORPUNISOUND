const { crearFuente, obtenerFuente } = require("../centroLeads/fuentes");
const { crearLead } = require("../centroLeads/leads");
const { registrarEventoHistorial } = require("../centroLeads/historial");
const { crearCliente } = require("../clientes");
const { registrarContacto } = require("../crm");
const { crearNativoConVinculos, telefonos } = require("../sicarVinculos");
const { aplicarHechoNativo } = require("./estados");

const CANALES = Object.freeze(["whatsapp", "messenger", "instagram"]);
const MAX_TEXTO = 4096;

function error(status, mensaje) {
  return Object.assign(new Error(mensaje), { status });
}

// Texto de un mensaje: 1-4096 caracteres, sin caracteres de sustitución ni de control (salvo saltos y tabulador).
function textoMensaje(valor) {
  if (typeof valor !== "string" || !valor.trim() || valor.length > MAX_TEXTO) throw error(400, "El mensaje debe tener de 1 a 4096 caracteres.");
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f�]/u.test(valor)) throw error(400, "El mensaje trae caracteres inválidos.");
  return valor;
}

// Número de WhatsApp de México (52 + 10 dígitos, o el 521 de celulares antiguos) → 10 dígitos nacionales.
function telefonoWhatsApp(valor) {
  const d = String(valor ?? "").replace(/\D/g, "");
  if (/^521\d{10}$/.test(d)) return d.slice(3);
  if (/^52\d{10}$/.test(d)) return d.slice(2);
  return null;
}

function crearContextoBandeja({ sqlite, DB, repo = null, guardar = () => {} }) {
  const ahora = () => new Date().toISOString();

  // JSON y SQLite cambian juntos: si algo falla, la transacción deshace SQLite y aquí se restaura la memoria.
  function operacion(fn) {
    const previo = structuredClone(DB.crm);
    try {
      return sqlite.transaction(() => {
        const resultado = fn();
        guardar(DB);
        return resultado;
      }).immediate();
    } catch (e) {
      DB.crm = previo;
      throw e;
    }
  }

  function fuente(fuenteId) {
    try { return obtenerFuente(sqlite, fuenteId); } catch { throw error(404, "Canal no encontrado."); }
  }

  function registrarCanal(datos) {
    if (!CANALES.includes(datos.canal)) throw error(400, "Canal no válido.");
    return crearFuente(sqlite, { ...datos, plataforma: datos.canal }, { ocurrido_en: ahora() });
  }

  function clienteActivo(clienteId) {
    const cliente = (DB.crm.clientes || []).find(c => Number(c.id) === Number(clienteId));
    if (!cliente || Number(cliente.id) === 0) throw error(404, "Cliente no encontrado.");
    return cliente;
  }

  // Un solo expediente por cliente (índice único V4): guarda el historial de responsables.
  function expediente(cliente) {
    const fila = sqlite.prepare("SELECT id FROM leads WHERE cliente_id = ?").get(Number(cliente.id));
    if (fila) return fila.id;
    // Sin responsable copiado: el responsable vive en el cliente y sus cambios en lead_asignaciones (bandeja/responsable.js).
    return crearLead(sqlite, { cliente_id: Number(cliente.id), nombre: cliente.nombre, origen: "bandeja" },
    { ocurrido_en: ahora() }).id;
  }

  // Clientes nativos con ese teléfono (regla estricta de la unión SICAR). Varios = no se adivina.
  function candidatos(telefono) {
    return (DB.crm.clientes || []).filter(c => Number(c.id) > 0 && telefonos(c).numeros.has(telefono));
  }
  // Un teléfono capturado en otro formato ("52 919…", "919-… casa") que contiene el número no se liga solo,
  // pero tampoco se crea otro cliente: va a Por identificar.
  function posibles(telefono) {
    return (DB.crm.clientes || []).filter(c => Number(c.id) > 0 && telefonos(c).ambiguo
      && [c.telefono, c.celular].some(v => String(v ?? "").replace(/\D/g, "").includes(telefono)));
  }

  function resolverCliente(canal, remitente) {
    const telefono = canal.canal === "whatsapp" ? telefonoWhatsApp(remitente.id_externo) : null;
    if (!telefono) return null;
    const encontrados = candidatos(telefono);
    if (encontrados.length === 1) return encontrados[0];
    if (encontrados.length > 1 || posibles(telefono).length) return null;
    const nombre = String(remitente.nombre ?? "").trim().slice(0, 120) || `WhatsApp ${telefono.slice(-4)}`;
    const crear = () => crearCliente(DB, { nombre, celular: telefono, sucursal_id: canal.sucursal_id, origen: "whatsapp" });
    return repo ? crearNativoConVinculos(repo, DB, () => {}, crear) : crear();
  }

  function identidadPara(canal, remitente) {
    const crudo = String(remitente?.id_externo ?? "").trim();
    if (!crudo || crudo.length > 200) throw error(400, "Remitente no válido.");
    // WhatsApp manda el mismo número de México con 521 o con 52: una sola persona, una sola conversación.
    const nacional = canal.canal === "whatsapp" ? telefonoWhatsApp(crudo) : null;
    const idExterno = nacional ? `52${nacional}` : crudo;
    let fila = sqlite.prepare("SELECT * FROM lead_identidades_externas WHERE proveedor = ? AND identificador_externo = ?")
      .get(canal.proveedor, idExterno);
    if (!fila) {
      const cliente = resolverCliente(canal, remitente);
      const r = sqlite.prepare(`INSERT INTO lead_identidades_externas
        (fuente_id, proveedor, identificador_externo, nombre_mostrado, telefono_normalizado, cliente_id, creada_en, actualizada_en)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(canal.id, canal.proveedor, idExterno, remitente.nombre ? String(remitente.nombre).slice(0, 120) : null,
        canal.canal === "whatsapp" ? telefonoWhatsApp(idExterno) : null, cliente ? Number(cliente.id) : null, ahora(), ahora());
      fila = sqlite.prepare("SELECT * FROM lead_identidades_externas WHERE id = ?").get(r.lastInsertRowid);
    }
    return fila;
  }

  function conversacionPara(canal, identidad, ocurrido) {
    const fila = sqlite.prepare(`SELECT id FROM lead_conversaciones
      WHERE fuente_id = ? AND canal = ? AND identificador_conversacion_externa = ?`).get(canal.id, canal.canal, identidad.identificador_externo);
    if (fila) return fila.id;
    return Number(sqlite.prepare(`INSERT INTO lead_conversaciones
      (fuente_id, canal, identificador_conversacion_externa, iniciada_en, ultima_interaccion_en, identidad_externa_id)
      VALUES (?, ?, ?, ?, ?, ?)`).run(canal.id, canal.canal, identidad.identificador_externo, ocurrido, ocurrido, identidad.id).lastInsertRowid);
  }

  function registrarInteraccion({ conversacionId, leadId, eventoId = null, identidadId, direccion, texto, ocurrido, usuarioId = null }) {
    const id = Number(sqlite.prepare(`INSERT INTO lead_interacciones
      (conversacion_id, lead_id, evento_externo_id, identidad_externa_id, tipo, direccion, texto, ocurrida_en, usuario_id)
      VALUES (?, ?, ?, ?, 'mensaje', ?, ?, ?, ?)`).run(conversacionId, leadId, eventoId, identidadId, direccion, texto, ocurrido, usuarioId)
      .lastInsertRowid);
    sqlite.prepare("UPDATE lead_conversaciones SET ultima_interaccion_en = ? WHERE id = ? AND ultima_interaccion_en < ?")
      .run(ocurrido, conversacionId, ocurrido);
    if (leadId) sqlite.prepare("UPDATE leads SET ultima_interaccion_en = ? WHERE id = ?").run(ocurrido, leadId);
    return id;
  }

  /**
   * Entrada única de mensajes (la usa el canal simulado y, en F4, el webhook del proveedor).
   * Idempotente por (proveedor, id de evento): el mismo aviso dos veces deja un solo mensaje.
   */
  function recibirEntrante(evento) {
    const canal = fuente(evento.fuente_id);
    if (!canal.activa) throw error(409, "El canal está apagado.");
    const idEvento = String(evento.id_evento ?? "").trim();
    if (!idEvento || idEvento.length > 200) throw error(400, "Evento sin identificador.");
    const texto = textoMensaje(evento.texto);
    const ocurrido = Number.isFinite(Date.parse(evento.ocurrido_en)) ? new Date(evento.ocurrido_en).toISOString() : ahora();
    const previo = sqlite.prepare(`SELECT i.conversacion_id FROM lead_eventos_externos e
      JOIN lead_interacciones i ON i.evento_externo_id = e.id WHERE e.proveedor = ? AND e.identificador_evento_externo = ?`)
      .get(canal.proveedor, idEvento);
    if (previo) return { duplicado: true, conversacion_id: previo.conversacion_id };
    return operacion(() => {
      const identidad = identidadPara(canal, evento.remitente);
      // Un mensaje nunca se pierde: si su cliente ya no existe, entra igual sin cliente.
      const cliente = (DB.crm.clientes || []).find(c => Number(c.id) > 0 && Number(c.id) === Number(identidad.cliente_id)) || null;
      const leadId = cliente ? expediente(cliente) : null;
      const conversacionId = conversacionPara(canal, identidad, ocurrido);
      const eventoId = Number(sqlite.prepare(`INSERT INTO lead_eventos_externos
        (fuente_id, proveedor, identificador_evento_externo, tipo, recibido_en, ocurrido_en, procesado_en)
        VALUES (?, ?, ?, 'mensaje', ?, ?, ?)`).run(canal.id, canal.proveedor, idEvento, ahora(), ocurrido, ahora()).lastInsertRowid);
      registrarInteraccion({ conversacionId, leadId, eventoId, identidadId: identidad.id, direccion: "entrante", texto, ocurrido });
      if (cliente) {
        registrarContacto(DB, cliente.id, { tipo: canal.canal, resultado: "mensaje_entrante" });
        aplicarHechoNativo(DB, cliente.id, "entrante", ocurrido);
      }
      return { duplicado: false, conversacion_id: conversacionId, cliente_id: cliente ? Number(cliente.id) : null };
    });
  }

  function conversacion(conversacionId) {
    const fila = sqlite.prepare(`SELECT c.id, c.canal, c.fuente_id, f.sucursal_responsable_id AS sucursal_id, f.nombre AS canal_nombre,
        c.identidad_externa_id AS identidad_id, i.cliente_id, i.nombre_mostrado, i.telefono_normalizado AS telefono,
        c.iniciada_en, c.ultima_interaccion_en
      FROM lead_conversaciones c JOIN lead_fuentes f ON f.id = c.fuente_id
      LEFT JOIN lead_identidades_externas i ON i.id = c.identidad_externa_id WHERE c.id = ?`).get(Number(conversacionId));
    if (!fila) throw error(404, "Conversación no encontrada.");
    return fila;
  }

  function hilo(conversacionId) {
    return sqlite.prepare(`SELECT id, direccion, texto, ocurrida_en, usuario_id FROM lead_interacciones
      WHERE conversacion_id = ? ORDER BY ocurrida_en, id`).all(Number(conversacionId));
  }

  // El proveedor real entrega en F4; aquí se guarda lo que salió y quién lo mandó.
  function enviarSaliente(conversacionId, valor, { usuario_id }) {
    const texto = textoMensaje(valor);
    const conv = conversacion(conversacionId);
    const ocurrido = ahora();
    return operacion(() => {
      const cliente = conv.cliente_id ? clienteActivo(conv.cliente_id) : null;
      const leadId = cliente ? expediente(cliente) : null;
      const id = registrarInteraccion({ conversacionId: conv.id, leadId, identidadId: conv.identidad_id, direccion: "saliente",
        texto, ocurrido, usuarioId: Number(usuario_id) || null });
      if (cliente) {
        registrarContacto(DB, cliente.id, { tipo: conv.canal, resultado: "mensaje_saliente" });
        aplicarHechoNativo(DB, cliente.id, "saliente", ocurrido);
      }
      return { id, direccion: "saliente", texto, ocurrida_en: ocurrido, usuario_id: Number(usuario_id) || null };
    });
  }

  function porIdentificar(alcance) {
    return sqlite.prepare(`SELECT i.id AS identidad_id, i.nombre_mostrado, i.telefono_normalizado AS telefono, f.canal,
        f.sucursal_responsable_id AS sucursal_id, c.id AS conversacion_id, c.ultima_interaccion_en
      FROM lead_identidades_externas i JOIN lead_conversaciones c ON c.identidad_externa_id = i.id
      JOIN lead_fuentes f ON f.id = c.fuente_id WHERE i.cliente_id IS NULL ORDER BY c.ultima_interaccion_en DESC`).all()
      .filter(f => alcance.verTodas || Number(f.sucursal_id) === Number(alcance.sucursalId));
  }

  function ligarIdentidad(identidadId, clienteId, { usuario_id }) {
    const identidad = sqlite.prepare("SELECT * FROM lead_identidades_externas WHERE id = ?").get(Number(identidadId));
    if (!identidad) throw error(404, "Contacto no encontrado.");
    if (identidad.cliente_id) throw error(409, "Este contacto ya está ligado a un cliente.");
    const cliente = clienteActivo(clienteId);
    return operacion(() => {
      sqlite.prepare("UPDATE lead_identidades_externas SET cliente_id = ?, actualizada_en = ? WHERE id = ?")
        .run(Number(cliente.id), ahora(), identidad.id);
      const leadId = expediente(cliente);
      sqlite.prepare(`UPDATE lead_interacciones SET lead_id = ? WHERE identidad_externa_id = ? AND lead_id IS NULL`).run(leadId, identidad.id);
      registrarEventoHistorial(sqlite, leadId, "IDENTIDAD_LIGADA", { identidad_id: identidad.id, proveedor: identidad.proveedor },
        { usuario_id: Number(usuario_id) || null, ocurrido_en: ahora() });
      return { identidad_id: identidad.id, cliente_id: Number(cliente.id) };
    });
  }

  return { registrarCanal, recibirEntrante, enviarSaliente, conversacion, hilo, porIdentificar, ligarIdentidad, expediente,
    operacion, clienteActivo, sqlite, DB };
}

module.exports = { crearContextoBandeja, telefonoWhatsApp, textoMensaje, CANALES };
