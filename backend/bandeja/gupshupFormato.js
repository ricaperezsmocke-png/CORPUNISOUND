function fallo(codigo = 'forma_desconocida') {
  throw Object.assign(new Error(codigo), { codigo });
}

function limpiarTexto(valor) {
  return String(valor ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\uFFFD]/gu, '')
    .slice(0, 4096).trim() || '[Mensaje vacío]';
}

function cadena(valor) {
  if (typeof valor !== 'string' || !valor.trim()) fallo();
  return valor;
}

function lista(valor) {
  if (!Array.isArray(valor)) fallo();
  return valor;
}

function fecha(timestamp) {
  if (typeof timestamp !== 'string' || !/^\d+$/.test(timestamp)) fallo('fecha_invalida');
  const d = new Date(Number(timestamp) * 1000);
  if (!Number.isFinite(d.getTime())) fallo('fecha_invalida');
  return d.toISOString();
}

function texto(m) {
  if (m.type === 'text') {
    if (typeof m.text?.body !== 'string') fallo();
    return limpiarTexto(m.text.body);
  }
  const etiquetas = { image: '[Foto]', video: '[Video]', audio: '[Audio]', sticker: '[Sticker]',
    location: '[Ubicación]', contacts: '[Contacto compartido]', media_placeholder: '[Archivo del historial]' };
  const medio = m[m.type];
  const etiqueta = m.type === 'document' ? `[Documento: ${medio?.filename || 'sin nombre'}]`
    : etiquetas[m.type] || '[Mensaje no soportado]';
  return limpiarTexto(etiqueta + (typeof medio?.caption === 'string' ? ` ${medio.caption}` : ''));
}

function normalizar(m, origen, cliente, nombre = null) {
  if (!m || typeof m !== 'object') fallo();
  if (m.type === 'reaction') return null;
  let direccion = origen === 'telefono' ? 'saliente' : 'entrante';
  if (origen === 'historial') {
    if (m.history_context?.from_me !== undefined && typeof m.history_context.from_me !== 'boolean') fallo();
    direccion = (m.history_context?.from_me ?? (cadena(m.from) !== cliente)) ? 'saliente' : 'entrante';
  }
  return { wamid: cadena(m.id), wa_id: cadena(cliente), direccion, origen, ocurrido_en: fecha(m.timestamp),
    texto: texto(m), nombre, placeholder: m.type === 'media_placeholder' };
}

function traducir(field, v) {
  const ignorado = motivo => ({ clase: 'ignorado', motivo });
  if (!['messages', 'smb_message_echoes', 'history', 'smb_app_state_sync'].includes(field)) return [ignorado('otro_campo')];
  if (!v || typeof v !== 'object') fallo();
  if (field === 'messages' && v.messages === undefined && Array.isArray(v.statuses)) return [ignorado('statuses')];
  const phoneNumberId = cadena(v.metadata?.phone_number_id);
  if (field === 'smb_app_state_sync') {
    const contactos = lista(v.state_sync).map(s => {
      if (s?.type !== 'contact' || !['add', 'remove'].includes(s.action)) fallo();
      const nombre = s.contact?.full_name || s.contact?.first_name;
      return { wa_id: cadena(s.contact?.phone_number), nombre: nombre ? limpiarTexto(nombre) : null, accion: s.action };
    });
    return [{ clase: 'contactos', phoneNumberId, contactos }];
  }
  if (field === 'history') {
    return lista(v.history).map(h => {
      if (h?.errors !== undefined) {
        if (lista(h.errors).length && h.errors.every(e => e.code === 2593109)) return ignorado('historial_rechazado');
        fallo();
      }
      if (h?.threads === undefined && h?.metadata) return ignorado('fase_historial');
      const mensajes = lista(h?.threads).flatMap(t => {
        const cliente = cadena(t?.id);
        return lista(t.messages).map(m => normalizar(m, 'historial', cliente)).filter(Boolean);
      });
      return { clase: 'mensajes', phoneNumberId, mensajes };
    });
  }
  const origen = field === 'messages' ? 'vivo' : 'telefono';
  const perfiles = new Map((v.contacts === undefined ? [] : lista(v.contacts)).map(c => [c.wa_id, c.profile?.name]));
  const mensajes = lista(origen === 'vivo' ? v.messages : v.message_echoes).map(m => {
    const cliente = origen === 'vivo' ? m?.from : m?.to;
    const nombre = perfiles.get(cliente);
    return normalizar(m, origen, cliente, nombre ? limpiarTexto(nombre) : null);
  }).filter(Boolean);
  return [{ clase: 'mensajes', phoneNumberId, mensajes }];
}

function extraerDeCrudo(payloadTexto) {
  let payload;
  try { payload = JSON.parse(payloadTexto); } catch { fallo('json_invalido'); }
  const avisos = lista(payload?.entry).flatMap(e => lista(e?.changes).flatMap(c => traducir(cadena(c?.field), c.value)));
  return { avisos };
}

module.exports = { extraerDeCrudo, limpiarTexto };
