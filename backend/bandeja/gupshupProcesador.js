const { performance } = require('node:perf_hooks');
const { extraerDeCrudo, limpiarTexto } = require('./gupshupFormato');
const { telefonoWhatsApp } = require('./mensajes');
const { crearCliente } = require('../clientes');
const { crearNativoConVinculos, telefonos } = require('../sicarVinculos');
const { registrarContacto } = require('../crm');
const { aplicarHechoNativo } = require('./estados');
const { registrarEventoHistorial } = require('../centroLeads/historial');
const { contadorPendientes } = require('./gupshupPendientes');

const FILTRO_CRUDOS = "proveedor = 'gupshup' AND identificador_evento_externo LIKE 'sha256:%'";
const CODIGOS = new Set(['json_invalido', 'fecha_invalida', 'forma_desconocida']);
const TIPOS = { vivo: 'mensaje', telefono: 'mensaje_telefono', historial: 'mensaje_historial' };
const claveIdentidad = numero => {
  const nacional = telefonoWhatsApp(numero);
  return nacional ? `52${nacional}` : numero;
};

function indexarClientes(clientes) {
  const porTelefono = new Map(), ambiguos = new Set(), porId = new Map();
  for (const c of clientes || []) {
    porId.set(Number(c.id), c);
    if (!(Number(c.id) > 0)) continue;
    const { numeros, ambiguo } = telefonos(c);
    for (const numero of numeros) {
      if (!porTelefono.has(numero)) porTelefono.set(numero, []);
      porTelefono.get(numero).push(c);
    }
    if (!ambiguo) continue;
    // telefonoWhatsApp produce diez dígitos: todas las ventanas preservan includes(), incluso entre campos mal capturados.
    for (const valor of [c.telefono, c.celular]) {
      const digitos = String(valor ?? '').replace(/\D/g, '');
      for (let i = 0; i + 10 <= digitos.length; i++) ambiguos.add(digitos.slice(i, i + 10));
    }
  }
  return { porTelefono, ambiguos, porId };
}

function buscarCliente(indice, telefono) {
  if (!telefono) return { cliente: null, crear: false };
  const encontrados = indice.porTelefono.get(telefono) || [];
  if (encontrados.length === 1) return { cliente: encontrados[0], crear: false };
  const posibles = indice.ambiguos.has(telefono);
  return { cliente: null, crear: encontrados.length === 0 && !posibles };
}

function crearEscritura({ sqlite, DB, repo, guardar, ctx, ahora }) {
  const identidadDe = sqlite.prepare("SELECT * FROM lead_identidades_externas WHERE proveedor = 'gupshup' AND identificador_externo = ?");
  const conversacionDe = sqlite.prepare(`SELECT id FROM lead_conversaciones WHERE fuente_id = ?
    AND canal = 'whatsapp' AND identificador_conversacion_externa = ?`);
  const hijoDe = sqlite.prepare(`SELECT e.id, e.tipo FROM lead_eventos_externos e
    WHERE e.proveedor = 'gupshup' AND e.identificador_evento_externo = ?`);

  function prepararIdentidades(canal, mensajes, respaldar) {
    const identidades = new Map(), nuevos = [];
    const indice = indexarClientes(DB.crm.clientes);
    for (const m of mensajes) {
      const clave = claveIdentidad(m.wa_id);
      if (identidades.has(clave) || hijoDe.get(`wamid:${m.wamid}`)) continue;
      const fila = identidadDe.get(clave);
      const telefono = telefonoWhatsApp(m.wa_id);
      const cliente = fila?.cliente_id ? indice.porId.get(Number(fila.cliente_id)) : null;
      const nombre = String(m.nombre || fila?.nombre_mostrado || '').trim().slice(0, 120) || null;
      const item = { clave, fila, telefono, cliente, nombre };
      identidades.set(clave, item);
      // Una identidad sin cliente pero con conversación ya quedó Por identificar: nunca se liga a escondidas.
      if (cliente || (fila && (fila.cliente_id || sqlite.prepare('SELECT id FROM lead_conversaciones WHERE identidad_externa_id = ?').get(fila.id)))) {
        continue;
      }
      const resuelto = buscarCliente(indice, telefono);
      item.cliente = resuelto.cliente;
      if (resuelto.crear) nuevos.push(item);
    }
    // 521 y 52 ya comparten clave. Crear todo el lote dentro de una sola operación SICAR.
    const crear = () => nuevos.map(item => {
      item.cliente = crearCliente(DB, { nombre: item.nombre || `WhatsApp ${item.telefono.slice(-4)}`,
        celular: item.telefono, sucursal_id: canal.sucursal_responsable_id, origen: 'whatsapp' });
      return item.cliente;
    });
    if (nuevos.length) {
      respaldar();
      crearNativoConVinculos(repo, DB, () => {}, crear);
    }
    return { identidades, nuevos: nuevos.length };
  }

  function identidad(item, canal, fecha) {
    if (!item.fila) {
      const id = sqlite.prepare(`INSERT INTO lead_identidades_externas
        (fuente_id, proveedor, identificador_externo, nombre_mostrado, telefono_normalizado, cliente_id, creada_en, actualizada_en)
        VALUES (?, 'gupshup', ?, ?, ?, ?, ?, ?)`).run(canal.id, item.clave, item.nombre, item.telefono,
        item.cliente?.id ?? null, fecha, fecha).lastInsertRowid;
      item.fila = { id: Number(id), cliente_id: item.cliente?.id ?? null };
    } else if (item.cliente && !item.fila.cliente_id) {
      sqlite.prepare('UPDATE lead_identidades_externas SET cliente_id = ?, actualizada_en = ? WHERE id = ?')
        .run(item.cliente.id, fecha, item.fila.id);
    }
    return item.fila.id;
  }

  function expediente(cliente, fecha) {
    const previo = sqlite.prepare('SELECT id FROM leads WHERE cliente_id = ?').get(cliente.id);
    if (previo) return previo.id;
    // El expediente nace sin última actividad. Solo registrarInteraccion de un mensaje no histórico la fija.
    const id = Number(sqlite.prepare(`INSERT INTO leads
      (cliente_id, estado, nombre, origen, creado_en, actualizado_en, ultima_interaccion_en)
      VALUES (?, 'NUEVO', ?, 'bandeja', ?, ?, NULL)`).run(cliente.id, cliente.nombre, fecha, fecha).lastInsertRowid);
    registrarEventoHistorial(sqlite, id, 'LEAD_CREADO', { estado: 'NUEVO' }, { origen: 'bandeja', ocurrido_en: fecha });
    return id;
  }

  function insertar(canal, m, item, fecha, respaldar) {
    const previo = hijoDe.get(`wamid:${m.wamid}`);
    if (previo) {
      if (previo.tipo === 'media_placeholder' && !m.placeholder) {
        sqlite.prepare('UPDATE lead_interacciones SET texto = ? WHERE evento_externo_id = ?').run(limpiarTexto(m.texto), previo.id);
        sqlite.prepare("UPDATE lead_eventos_externos SET tipo = 'mensaje' WHERE id = ?").run(previo.id);
      }
      return false;
    }
    const identidadId = identidad(item, canal, fecha);
    let conversacionId = conversacionDe.get(canal.id, item.clave)?.id;
    if (!conversacionId) conversacionId = Number(sqlite.prepare(`INSERT INTO lead_conversaciones
      (fuente_id, canal, identificador_conversacion_externa, iniciada_en, ultima_interaccion_en, identidad_externa_id)
      VALUES (?, 'whatsapp', ?, ?, ?, ?)`).run(canal.id, item.clave, m.ocurrido_en, m.ocurrido_en, identidadId).lastInsertRowid);
    const eventoId = Number(sqlite.prepare(`INSERT INTO lead_eventos_externos
      (fuente_id, proveedor, identificador_evento_externo, tipo, recibido_en, ocurrido_en, procesado_en)
      VALUES (?, 'gupshup', ?, ?, ?, ?, ?)`).run(canal.id, `wamid:${m.wamid}`,
      m.placeholder ? 'media_placeholder' : 'mensaje', fecha, m.ocurrido_en, fecha).lastInsertRowid);
    const leadId = item.cliente ? expediente(item.cliente, fecha) : null;
    ctx.registrarInteraccion({ conversacionId, leadId, eventoId, identidadId, direccion: m.direccion, texto: limpiarTexto(m.texto),
      ocurrido: m.ocurrido_en, tipo: TIPOS[m.origen] });
    if (m.origen === 'historial' || !item.cliente) return false;
    respaldar();
    registrarContacto(DB, item.cliente.id, { tipo: 'whatsapp', resultado: `mensaje_${m.direccion}` });
    aplicarHechoNativo(DB, item.cliente.id, m.direccion, m.ocurrido_en);
    return true;
  }

  function mensajes(canal, lote) {
    let respaldo;
    const respaldar = () => {
      if (!respaldo) respaldo = { crm: structuredClone(DB.crm), radar: structuredClone(DB.radar_demanda) };
    };
    try {
      sqlite.transaction(() => {
        const fecha = ahora().toISOString();
        const { identidades, nuevos } = prepararIdentidades(canal, lote, respaldar);
        let cambiado = nuevos > 0;
        for (const m of lote) cambiado = insertar(canal, m, identidades.get(claveIdentidad(m.wa_id)), fecha, respaldar) || cambiado;
        if (cambiado) guardar(DB);
      }).immediate();
    } catch (e) {
      if (respaldo) {
        DB.crm = respaldo.crm;
        if (respaldo.radar === undefined) delete DB.radar_demanda;
        else DB.radar_demanda = respaldo.radar;
      }
      throw e;
    }
  }

  function contactos(canal, lote) {
    let previo;
    try {
      sqlite.transaction(() => {
        let cambiado = false;
        const fecha = ahora().toISOString();
        for (const c of lote) {
          if (c.accion === 'remove') continue;
          const clave = claveIdentidad(c.wa_id), telefono = telefonoWhatsApp(c.wa_id);
          const fila = identidadDe.get(clave);
          const nombre = c.nombre ? limpiarTexto(c.nombre).slice(0, 120) : null;
          if (!fila) {
            identidad({ clave, telefono, nombre, cliente: null }, canal, fecha);
            continue;
          }
          sqlite.prepare('UPDATE lead_identidades_externas SET nombre_mostrado = coalesce(?, nombre_mostrado), actualizada_en = ? WHERE id = ?')
            .run(nombre, fecha, fila.id);
          const cliente = DB.crm.clientes.find(x => Number(x.id) > 0 && Number(x.id) === fila.cliente_id);
          if (nombre && telefono && cliente?.origen === 'whatsapp' && cliente.nombre === `WhatsApp ${telefono.slice(-4)}`) {
            previo ??= structuredClone(DB.crm);
            cliente.nombre = nombre;
            cambiado = true;
          }
        }
        if (cambiado) guardar(DB);
      }).immediate();
    } catch (e) {
      if (previo) DB.crm = previo;
      throw e;
    }
  }
  return { mensajes, contactos };
}

function crearProcesadorGupshup({ sqlite, DB, repo = null, guardar, ctx, mantenimiento, ahora = () => new Date(), trozo = 200 }) {
  if (!Number.isInteger(trozo) || trozo < 1) throw new Error('Trozo invalido');
  const escritura = crearEscritura({ sqlite, DB, repo, guardar, ctx, ahora });
  const contador = contadorPendientes(sqlite);
  let corriendo = false;
  const fallasOperativas = new Map();
  const canalDe = numero => sqlite.prepare(`SELECT * FROM lead_fuentes
    WHERE proveedor = 'gupshup' AND canal = 'whatsapp' AND identificador_externo = ? AND activa = 1`).get(numero);
  function recalcularPendientes() {
    contador.base = sqlite.prepare(`SELECT coalesce(sum(length(payload_json)), 0) n FROM lead_eventos_externos
      WHERE ${FILTRO_CRUDOS} AND procesado_en IS NULL`).get().n;
    contador.adicionales = 0;
    return contador.base;
  }

  async function procesarPendientes({ maxMs = 20000 } = {}) {
    const resumen = { procesados: 0, errores: 0, sin_canal: 0 };
    if (corriendo || mantenimiento.estaActivo()) return resumen;
    corriendo = true;
    const limite = performance.now() + maxMs;
    const parar = () => mantenimiento.estaActivo() || performance.now() >= limite;
    let ultimoId = 0;
    try {
      recalcularPendientes();
      while (!parar()) {
        const crudo = sqlite.prepare(`SELECT id, payload_json FROM lead_eventos_externos WHERE ${FILTRO_CRUDOS}
          AND procesado_en IS NULL AND error_procesamiento IS NULL AND id > ? ORDER BY id LIMIT 1`).get(ultimoId);
        if (!crudo) break;
        ultimoId = crudo.id;
        try {
          const { avisos } = extraerDeCrudo(crudo.payload_json);
          if (avisos.some(a => a.clase !== 'ignorado' && !canalDe(a.phoneNumberId))) {
            resumen.sin_canal++;
          } else {
            for (const a of avisos) {
              if (a.clase === 'ignorado') continue;
              const canal = canalDe(a.phoneNumberId);
              const items = a.clase === 'mensajes' ? a.mensajes : a.contactos;
              for (let i = 0; i < items.length; i += trozo) {
                if (parar()) return resumen;
                escritura[a.clase](canal, items.slice(i, i + trozo));
                await new Promise(setImmediate);
              }
            }
            if (parar()) return resumen;
            sqlite.prepare('UPDATE lead_eventos_externos SET procesado_en = ? WHERE id = ?').run(ahora().toISOString(), crudo.id);
            fallasOperativas.delete(crudo.id);
            resumen.procesados++;
          }
        } catch (e) {
          resumen.errores++;
          if (!CODIGOS.has(e.codigo)) {
            const seguro = valor => typeof valor === 'string' && /^[A-Za-z0-9_]{1,80}$/.test(valor) ? valor : 'desconocido';
            console.error(`${seguro(e.name)} ${seguro(e.code)}`);
            const fallas = (fallasOperativas.get(crudo.id) || 0) + 1;
            if (fallas < 3) {
              fallasOperativas.set(crudo.id, fallas);
              return resumen;
            }
            fallasOperativas.delete(crudo.id);
            sqlite.prepare('UPDATE lead_eventos_externos SET error_procesamiento = ? WHERE id = ?').run('error_interno', crudo.id);
            await new Promise(setImmediate);
            continue;
          }
          sqlite.prepare('UPDATE lead_eventos_externos SET error_procesamiento = ? WHERE id = ?').run(e.codigo, crudo.id);
        }
        await new Promise(setImmediate);
      }
      return resumen;
    } finally { corriendo = false; recalcularPendientes(); }
  }
  recalcularPendientes();
  return { procesarPendientes, recalcularPendientes, pendientes: () => contador.base };
}

module.exports = { crearProcesadorGupshup, FILTRO_CRUDOS };
