// La ruta se arma solo con nombres de campos fijos de este archivo y [] en lugar de índices: nunca lleva valores.
function fallo(codigo = 'forma_desconocida', ruta = null) {
  throw Object.assign(new Error(codigo), { codigo, ruta });
}

const CLAVE_SEGURA = /^[a-z][a-z0-9_]{0,63}$/;

// Esqueleto de un objeto: solo nombres de claves seguros y tipos, nunca valores (igual que diagnosticarMedios).
function esqueleto(valor, nivel = 1) {
  if (valor === null) return 'null';
  if (Array.isArray(valor)) return 'array';
  if (typeof valor !== 'object') return typeof valor;
  if (nivel > 3) return 'object';
  const forma = {};
  for (const [clave, interno] of Object.entries(valor)) {
    if (CLAVE_SEGURA.test(clave)) forma[clave] = esqueleto(interno, nivel + 1);
    else forma['?'] = '?';
  }
  return forma;
}

function limpiarTexto(valor) {
  return String(valor ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f�]/gu, '')
    .slice(0, 4096).trim() || '[Mensaje vacío]';
}

function cadena(valor, ruta) {
  if (typeof valor !== 'string' || !valor.trim()) fallo('forma_desconocida', ruta);
  return valor;
}

function lista(valor, ruta) {
  if (!Array.isArray(valor)) fallo('forma_desconocida', ruta);
  return valor;
}

function fecha(timestamp, ruta) {
  if (typeof timestamp !== 'string' || !/^\d+$/.test(timestamp)) fallo('fecha_invalida', ruta);
  const d = new Date(Number(timestamp) * 1000);
  if (!Number.isFinite(d.getTime())) fallo('fecha_invalida', ruta);
  return d.toISOString();
}

function texto(m, base) {
  if (m.type === 'revoke') return '[Mensaje eliminado]';
  if (m.type === 'edit') {
    const nuevo = m.edit?.message;
    const contenido = nuevo?.type === 'text' ? nuevo.text?.body : nuevo?.[nuevo?.type]?.caption;
    return limpiarTexto('[Mensaje editado]' + (typeof contenido === 'string' ? ` ${contenido}` : ''));
  }
  if (m.type === 'text') {
    if (typeof m.text?.body !== 'string') fallo('forma_desconocida', `${base}.text.body`);
    return limpiarTexto(m.text.body);
  }
  const etiquetas = { image: '[Foto]', video: '[Video]', audio: '[Audio]', sticker: '[Sticker]',
    location: '[Ubicación]', contacts: '[Contacto compartido]', media_placeholder: '[Archivo del historial]' };
  const medio = m[m.type];
  const etiqueta = m.type === 'document' ? `[Documento: ${medio?.filename || 'sin nombre'}]`
    : etiquetas[m.type] || '[Mensaje no soportado]';
  return limpiarTexto(etiqueta + (typeof medio?.caption === 'string' ? ` ${medio.caption}` : ''));
}

function normalizar(m, origen, cliente, { nombre = null, base, rutaCliente }) {
  if (!m || typeof m !== 'object') fallo('forma_desconocida', base);
  if (m.type === 'reaction') return null;
  let direccion = origen === 'telefono' ? 'saliente' : 'entrante';
  if (origen === 'historial') {
    if (m.history_context?.from_me !== undefined && typeof m.history_context.from_me !== 'boolean') {
      fallo('forma_desconocida', `${base}.history_context.from_me`);
    }
    direccion = (m.history_context?.from_me ?? (cadena(m.from, `${base}.from`) !== cliente)) ? 'saliente' : 'entrante';
  }
  return { wamid: cadena(m.id, `${base}.id`), wa_id: cadena(cliente, rutaCliente), direccion, origen,
    ocurrido_en: fecha(m.timestamp, `${base}.timestamp`), texto: texto(m, base), nombre,
    placeholder: m.type === 'media_placeholder' };
}

// En el historial un mensaje o hilo roto se omite y se reporta. Solo errores del formato: un error interno sigue subiendo.
function aislar(objeto, fn, descartados) {
  try { return fn(); } catch (e) {
    if (!e.codigo) throw e;
    descartados.push({ ruta: e.ruta, codigo: e.codigo, forma: esqueleto(objeto) });
    return [];
  }
}

function hilosDeHistorial(h) {
  const descartados = [];
  const base = 'history[].threads[]';
  const opciones = { base: `${base}.messages[]`, rutaCliente: `${base}.id` };
  const mensaje = cliente => m => aislar(m, () => [normalizar(m, 'historial', cliente, opciones)], descartados);
  const hilo = t => {
    const cliente = cadena(t?.id, `${base}.id`);
    return lista(t.messages, `${base}.messages`).flatMap(mensaje(cliente)).filter(Boolean);
  };
  const mensajes = lista(h?.threads, 'history[].threads').flatMap(t => aislar(t, () => hilo(t), descartados));
  return { mensajes, descartados };
}

function traducir(field, v) {
  const ignorado = motivo => ({ clase: 'ignorado', motivo });
  if (!['messages', 'smb_message_echoes', 'history', 'smb_app_state_sync'].includes(field)) return [ignorado('otro_campo')];
  if (!v || typeof v !== 'object') fallo('forma_desconocida', 'value');
  if (field === 'messages' && v.messages === undefined && Array.isArray(v.statuses)) return [ignorado('statuses')];
  const phoneNumberId = cadena(v.metadata?.phone_number_id, 'metadata.phone_number_id');
  if (field === 'smb_app_state_sync') {
    const contactos = lista(v.state_sync, 'state_sync').map(s => {
      if (s?.type !== 'contact' || !['add', 'remove'].includes(s.action)) fallo('forma_desconocida', 'state_sync[]');
      const nombre = s.contact?.full_name || s.contact?.first_name;
      return { wa_id: cadena(s.contact?.phone_number, 'state_sync[].contact.phone_number'),
        nombre: nombre ? limpiarTexto(nombre) : null, accion: s.action };
    });
    return [{ clase: 'contactos', phoneNumberId, contactos }];
  }
  if (field === 'history') {
    return lista(v.history, 'history').map(h => {
      if (h?.errors !== undefined) {
        if (lista(h.errors, 'history[].errors').length && h.errors.every(e => e.code === 2593109)) return ignorado('historial_rechazado');
        fallo('forma_desconocida', 'history[].errors');
      }
      if (h?.threads === undefined && h?.metadata) return ignorado('fase_historial');
      return { clase: 'mensajes', phoneNumberId, ...hilosDeHistorial(h) };
    });
  }
  const origen = field === 'messages' ? 'vivo' : 'telefono';
  const campo = origen === 'vivo' ? 'messages' : 'message_echoes';
  const perfiles = new Map((v.contacts === undefined ? [] : lista(v.contacts, 'contacts')).map(c => [c.wa_id, c.profile?.name]));
  const mensajes = lista(v[campo], campo).map(m => {
    const cliente = origen === 'vivo' ? m?.from : m?.to;
    const nombre = perfiles.get(cliente);
    return normalizar(m, origen, cliente, { nombre: nombre ? limpiarTexto(nombre) : null, base: `${campo}[]`,
      rutaCliente: `${campo}[].${origen === 'vivo' ? 'from' : 'to'}` });
  }).filter(Boolean);
  return [{ clase: 'mensajes', phoneNumberId, mensajes }];
}

function extraerDeCrudo(payloadTexto) {
  let payload;
  try { payload = JSON.parse(payloadTexto); } catch { fallo('json_invalido'); }
  return extraerDePayload(payload);
}

function extraerDePayload(payload) {
  const avisos = lista(payload?.entry, 'entry').flatMap(e => lista(e?.changes, 'entry[].changes')
    .flatMap(c => traducir(cadena(c?.field, 'entry[].changes[].field'), c.value)));
  // Un historial donde todo se descartó y nada sirvió es error del crudo: nunca se marca procesado en silencio.
  const historial = avisos.filter(a => a.descartados);
  if (historial.some(a => a.descartados.length) && !historial.some(a => a.mensajes.length)) {
    const primero = historial.find(a => a.descartados.length).descartados[0];
    fallo(primero.codigo, primero.ruta);
  }
  return { avisos };
}

module.exports = { extraerDeCrudo, extraerDePayload, limpiarTexto };
