const { extraerDeCrudo, extraerDePayload } = require('./gupshupFormato');
const { FILTRO_CRUDOS } = require('./gupshupProcesador');

const MEDIOS = new Set(['image', 'video', 'audio', 'document', 'sticker']);
const ERRORES = new Set(['json_invalido', 'fecha_invalida', 'forma_desconocida', 'error_interno']);
const lista = valor => Array.isArray(valor) ? valor : [];

function diagnosticarMedios(payload, medios, claves) {
  for (const e of lista(payload?.entry)) for (const c of lista(e?.changes)) {
    const v = c?.value;
    let mensajes = [];
    if (c?.field === 'messages') mensajes = lista(v?.messages);
    if (c?.field === 'smb_message_echoes') mensajes = lista(v?.message_echoes);
    if (c?.field === 'history') mensajes = lista(v?.history).flatMap(h => lista(h?.threads).flatMap(t => lista(t?.messages)));
    for (const m of mensajes) {
      if (!MEDIOS.has(m?.type)) continue;
      const medio = m[m.type];
      if (!medio || typeof medio !== 'object' || Array.isArray(medio)) continue;
      medios.total++;
      if (Object.hasOwn(medio, 'url')) medios.con_url++;
      for (const clave of Object.keys(medio)) {
        // Solo nombres de campos: nunca devolver una URL u otro texto libre usado como clave.
        if (/^[a-z][a-z0-9_]{0,63}$/.test(clave)) claves.add(clave);
      }
    }
  }
}

// La ruta la arma gupshupFormato solo con nombres de campos fijos: nunca trae valores del crudo.
function rutaDelFallo(payloadTexto) {
  try { extraerDeCrudo(payloadTexto); } catch (e) { return typeof e.ruta === 'string' ? e.ruta : null; }
  return null;
}

function agruparDescartados(avisos, grupos) {
  for (const a of avisos) for (const d of a.descartados || []) {
    const clave = `${d.ruta}|${d.codigo}`;
    if (grupos.has(clave)) grupos.get(clave).veces++;
    else grupos.set(clave, { ruta: d.ruta, codigo: d.codigo, veces: 1, forma: d.forma });
  }
}

function resumenGupshup(sqlite, ahora = new Date()) {
  const desde = new Date(ahora.getTime() - 7 * 86400000).toISOString();
  const filtro = `FROM lead_eventos_externos WHERE ${FILTRO_CRUDOS} AND recibido_en >= ?`;
  const por_tipo = sqlite.prepare(`SELECT tipo, count(*) AS eventos ${filtro} GROUP BY tipo ORDER BY tipo`).all(desde);
  const totales = sqlite.prepare(`SELECT min(recibido_en) AS primera, max(recibido_en) AS ultima,
    coalesce(sum(procesado_en IS NULL), 0) AS sin_procesar, coalesce(sum(length(payload_json)), 0) AS bytes,
    coalesce(sum(procesado_en IS NOT NULL), 0) AS procesados, coalesce(sum(error_procesamiento IS NOT NULL), 0) AS con_error
    ${filtro}`).get(desde);
  const errores_recientes = sqlite.prepare(`SELECT id, error_procesamiento, recibido_en, payload_json ${filtro}
    AND error_procesamiento IS NOT NULL ORDER BY id DESC LIMIT 5`).all(desde).map(f => ({ id: f.id, recibido_en: f.recibido_en,
    motivo: ERRORES.has(f.error_procesamiento) ? f.error_procesamiento : 'error_interno', ruta: rutaDelFallo(f.payload_json) }));
  const interacciones_por_tipo = sqlite.prepare(`SELECT i.tipo, count(*) AS mensajes FROM lead_interacciones i
    JOIN lead_conversaciones c ON c.id = i.conversacion_id JOIN lead_fuentes f ON f.id = c.fuente_id
    WHERE f.proveedor = 'gupshup' GROUP BY i.tipo ORDER BY i.tipo`).all();
  const canales = new Set(sqlite.prepare(`SELECT identificador_externo FROM lead_fuentes
    WHERE proveedor = 'gupshup' AND canal = 'whatsapp' AND activa = 1`).all().map(f => f.identificador_externo));
  const medios = { total: 0, con_url: 0, claves: [] }, claves = new Set();
  const muestra = new Set(sqlite.prepare(`SELECT id ${filtro}
    AND (instr(',' || tipo || ',', ',messages,') > 0 OR instr(',' || tipo || ',', ',smb_message_echoes,') > 0
      OR instr(',' || tipo || ',', ',history,') > 0)
    ORDER BY recibido_en DESC, id DESC LIMIT 200`).all(desde).map(f => f.id));
  let pendientes_sin_canal = 0, historial_rechazado = 0;
  const grupos = new Map();
  for (const fila of sqlite.prepare(`SELECT id, payload_json, procesado_en, error_procesamiento ${filtro}`).iterate(desde)) {
    try {
      const payload = JSON.parse(fila.payload_json);
      if (muestra.has(fila.id)) diagnosticarMedios(payload, medios, claves);
      const { avisos } = extraerDePayload(payload);
      if (avisos.some(a => a.motivo === 'historial_rechazado')) historial_rechazado++;
      if (fila.procesado_en) agruparDescartados(avisos, grupos);
      if (!fila.procesado_en && !fila.error_procesamiento && avisos.some(a => a.phoneNumberId && !canales.has(a.phoneNumberId))) {
        pendientes_sin_canal++;
      }
    } catch { /* Un payload roto no prueba que falte un canal. */ }
  }
  medios.claves = [...claves].sort();
  const descartados = [...grupos.values()].sort((a, b) => b.veces - a.veces).slice(0, 10);
  return { desde, por_tipo, ...totales, errores_recientes, pendientes_sin_canal, interacciones_por_tipo, medios, historial_rechazado,
    descartados };
}

module.exports = { resumenGupshup };
