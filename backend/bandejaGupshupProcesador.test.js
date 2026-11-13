const { test } = require('node:test');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { prepararBandeja } = require('./bandejaTestHelpers');
const { crearProcesadorGupshup } = require('./bandeja/gupshupProcesador');
const { ultimasEntradas } = require('./bandeja/estados');

const FECHA = '2026-11-13T12:00:00.000Z';
const NUMERO = '5219190000001';
const msg = (id = 'uno', extra = {}) => ({ id, from: NUMERO, timestamp: '1775627842', type: 'text', text: { body: 'Hola' }, ...extra });
const aviso = (field, value, numero = 'tienda') => ({ field, value: { metadata: { phone_number_id: numero }, ...value } });
const vivo = (mensajes = [msg()], numero) => aviso('messages', { messages: mensajes }, numero);
const historia = mensajes => aviso('history', { history: [{ threads: [{ id: NUMERO, messages: mensajes }] }] });
const contacto = (nombre, action = 'add', numero = NUMERO) => aviso('smb_app_state_sync', {
  state_sync: [{ type: 'contact', action, contact: { phone_number: numero, ...(nombre ? { full_name: nombre } : {}) } }],
});

function preparar(t, opciones = {}) {
  const f = prepararBandeja(t, opciones);
  const guardar = db => f.guardados.push(structuredClone(db.crm));
  f.procesador = crearProcesadorGupshup({ ...f, guardar, mantenimiento: { estaActivo: () => false },
    ahora: () => new Date(FECHA), ...opciones });
  f.canal = () => f.ctx.registrarCanal({ canal: 'whatsapp', proveedor: 'gupshup', identificador_externo: 'tienda',
    sucursal_id: 2, nombre: 'Tienda' });
  let n = 0;
  f.crudo = (...changes) => {
    const payload = typeof changes[0] === 'string' ? changes[0] : JSON.stringify({ entry: [{ changes }] });
    return Number(f.sqlite.prepare(`INSERT INTO lead_eventos_externos
      (proveedor, identificador_evento_externo, tipo, recibido_en, payload_json)
      VALUES ('gupshup', ?, 'prueba', ?, ?)`).run(`sha256:${++n}`, FECHA, payload).lastInsertRowid);
  };
  f.fila = id => f.sqlite.prepare('SELECT * FROM lead_eventos_externos WHERE id = ?').get(id);
  f.mensajes = () => f.sqlite.prepare('SELECT * FROM lead_interacciones ORDER BY id').all();
  return f;
}

test('vivo crea cliente de la tienda, hijo wamid procesado y contacto una sola vez', async t => {
  const f = preparar(t);
  f.canal();
  const id = f.crudo(aviso('messages', { messages: [msg()], contacts: [{ wa_id: NUMERO, profile: { name: 'Ana' } }] }));
  assert.deepEqual(await f.procesador.procesarPendientes(), { procesados: 1, errores: 0, sin_canal: 0 });
  const cliente = f.DB.crm.clientes[1];
  assert.equal(cliente.nombre, 'Ana');
  assert.equal(cliente.sucursal_id, 2);
  assert.equal(cliente.estado, 'interesado');
  assert.equal(f.DB.crm.contactos_cliente.length, 1);
  assert.equal(f.mensajes()[0].ocurrida_en, new Date(1775627842000).toISOString());
  assert.equal(f.mensajes()[0].tipo, 'mensaje');
  assert.equal(f.fila(id).procesado_en, FECHA);
  const hijo = f.fila(f.mensajes()[0].evento_externo_id);
  assert.equal(hijo.identificador_evento_externo, 'wamid:uno');
  assert.equal(hijo.procesado_en, FECHA);
  assert.equal(f.guardados.length, 1, 'alta y contacto se guardan juntos por trozo');
  f.crudo(vivo());
  f.crudo(historia([msg()]));
  await f.procesador.procesarPendientes();
  assert.equal(f.mensajes().length, 1);
  assert.equal(f.DB.crm.contactos_cliente.length, 1);
});

test('historial crea con contactado sin transiciones, contacto ni ultima actividad', async t => {
  const f = preparar(t);
  f.canal();
  f.crudo(historia([msg()]));
  await f.procesador.procesarPendientes();
  assert.equal(f.DB.crm.clientes[1].estado, 'contactado');
  assert.deepEqual(f.DB.crm.estados_historial, []);
  assert.deepEqual(f.DB.crm.contactos_cliente, []);
  assert.equal(f.DB.crm.clientes[1].ultimo_contacto, null);
  assert.equal(f.mensajes()[0].tipo, 'mensaje_historial');
  assert.equal(f.sqlite.prepare('SELECT ultima_interaccion_en FROM leads').get().ultima_interaccion_en, null);
  assert.equal(ultimasEntradas(f.sqlite).size, 0);
  const previo = structuredClone(f.DB.crm);
  f.crudo(historia([msg('dos', { timestamp: '1880000000' })]));
  await f.procesador.procesarPendientes();
  assert.deepEqual(f.DB.crm, previo);
  assert.equal(f.sqlite.prepare('SELECT ultima_interaccion_en FROM leads').get().ultima_interaccion_en, null);
});

test('placeholder se completa sin duplicar ni convertir historial en contacto', async t => {
  const f = preparar(t);
  f.canal();
  f.crudo(historia([msg('uno', { type: 'media_placeholder' })]));
  await f.procesador.procesarPendientes();
  f.crudo(vivo([msg('uno', { type: 'image', image: { caption: 'precio?' } })]));
  await f.procesador.procesarPendientes();
  assert.equal(f.mensajes().length, 1);
  assert.equal(f.mensajes()[0].texto, '[Foto] precio?');
  assert.equal(f.mensajes()[0].tipo, 'mensaje_historial');
  assert.equal(f.DB.crm.contactos_cliente.length, 0);
  f.crudo(historia([msg('uno', { type: 'media_placeholder' })]));
  await f.procesador.procesarPendientes();
  assert.equal(f.mensajes()[0].texto, '[Foto] precio?');
});

test('eco es saliente sin usuario ni contacto entrante inventado', async t => {
  const f = preparar(t);
  f.canal();
  f.crudo(aviso('smb_message_echoes', { message_echoes: [msg('eco', { from: 'tienda', to: NUMERO })] }));
  await f.procesador.procesarPendientes();
  assert.equal(f.mensajes()[0].tipo, 'mensaje_telefono');
  assert.equal(f.mensajes()[0].direccion, 'saliente');
  assert.equal(f.mensajes()[0].usuario_id, null);
  assert.equal(ultimasEntradas(f.sqlite).size, 0);
});

test('sin canal y apagado quedan pendientes y entran al habilitar el canal', async t => {
  const f = preparar(t);
  const id = f.crudo(vivo());
  assert.equal((await f.procesador.procesarPendientes()).sin_canal, 1);
  assert.equal(f.fila(id).procesado_en, null);
  assert.equal(f.fila(id).error_procesamiento, null);
  f.canal();
  f.sqlite.prepare('UPDATE lead_fuentes SET activa = 0').run();
  assert.equal((await f.procesador.procesarPendientes()).sin_canal, 1);
  assert.equal(f.mensajes().length, 0);
  f.sqlite.prepare('UPDATE lead_fuentes SET activa = 1').run();
  await f.procesador.procesarPendientes();
  assert.equal(f.mensajes().length, 1);
});

test('errores seguros no detienen el siguiente crudo ni se reintentan solos', async t => {
  const f = preparar(t);
  f.canal();
  const roto = f.crudo('{');
  const fecha = f.crudo(vivo([msg('fecha', { timestamp: 'abc' })]));
  f.crudo(vivo([msg('sano', { text: { body: 'a\u0007\uFFFDb' } })]));
  assert.deepEqual(await f.procesador.procesarPendientes(), { procesados: 1, errores: 2, sin_canal: 0 });
  assert.equal(f.fila(roto).error_procesamiento, 'json_invalido');
  assert.equal(f.fila(fecha).error_procesamiento, 'fecha_invalida');
  assert.equal(f.mensajes()[0].texto, 'ab');
  assert.deepEqual(await f.procesador.procesarPendientes(), { procesados: 0, errores: 0, sin_canal: 0 });
});

test('fallo interno revierte trozo y no filtra secretos ni procesa el siguiente crudo', async t => {
  const f = preparar(t);
  f.canal();
  const original = f.ctx.registrarInteraccion;
  f.ctx.registrarInteraccion = datos => {
    if (datos.texto === 'romper') throw Object.assign(new Error('https://x?key=SECRETO'), { codigo: 'https://x?key=SECRETO' });
    return original(datos);
  };
  const id = f.crudo(vivo([msg('roto', { text: { body: 'romper' } })]));
  f.crudo(vivo([msg('sano')]));
  const log = t.mock.method(console, 'error', () => {});
  assert.equal((await f.procesador.procesarPendientes()).errores, 1);
  assert.equal(f.fila(id).error_procesamiento, null);
  assert.deepEqual(log.mock.calls.map(c => c.arguments), [['Error desconocido']]);
  assert.equal(f.mensajes().length, 0);
  assert.equal(f.DB.crm.clientes.length, 1);
  assert.equal(f.DB.crm.contactos_cliente.length, 0);
  assert.equal(f.sqlite.prepare("SELECT count(*) n FROM lead_eventos_externos WHERE identificador_evento_externo = 'wamid:roto'").get().n, 0);
});

test('contactos antes y despues de mensajes: nombre automatico cambia, manual no, remove conserva', async t => {
  const f = preparar(t);
  f.canal();
  f.crudo(historia([msg()]));
  await f.procesador.procesarPendientes();
  assert.equal(f.DB.crm.clientes[1].nombre, 'WhatsApp 0001');
  f.crudo(contacto('Ana'));
  await f.procesador.procesarPendientes();
  assert.equal(f.DB.crm.clientes[1].nombre, 'Ana');
  f.DB.crm.clientes[1].nombre = 'Nombre manual';
  f.crudo(contacto('Otro nombre'), contacto(null, 'remove'));
  await f.procesador.procesarPendientes();
  assert.equal(f.DB.crm.clientes[1].nombre, 'Nombre manual');
  assert.equal(f.sqlite.prepare('SELECT nombre_mostrado FROM lead_identidades_externas').get().nombre_mostrado, 'Otro nombre');
  const otro = '5219190000002';
  f.crudo(contacto('Beto', 'add', otro));
  await f.procesador.procesarPendientes();
  f.crudo(vivo([msg('otro', { from: otro })]));
  await f.procesador.procesarPendientes();
  assert.equal(f.DB.crm.clientes.find(c => c.celular === '9190000002').nombre, 'Beto');
});

test('ambiguedad y numeros no mexicanos quedan por identificar sin clientes nuevos', async t => {
  const f = preparar(t, { clientes: [{ id: 5, nombre: 'A', celular: '9190000001' },
    { id: 6, nombre: 'B', celular: '9190000001' }, { id: 7, nombre: 'C', celular: '52 9190000002 casa' }] });
  f.canal();
  f.crudo(vivo([msg(), msg('dos', { from: '529190000002' }), msg('tres', { from: '441234567890' })]));
  await f.procesador.procesarPendientes();
  assert.equal(f.DB.crm.clientes.length, 4);
  assert.ok(f.sqlite.prepare('SELECT cliente_id FROM lead_identidades_externas').all().every(i => i.cliente_id === null));
});

test('mantenimiento, limite de tiempo y concurrencia permiten reanudar sin duplicar', async t => {
  let activo = true;
  const f = preparar(t, { mantenimiento: { estaActivo: () => activo }, trozo: 1 });
  f.canal();
  const id = f.crudo(historia([msg(), msg('dos'), msg('tres')]));
  assert.deepEqual(await f.procesador.procesarPendientes(), { procesados: 0, errores: 0, sin_canal: 0 });
  activo = false;
  await f.procesador.procesarPendientes({ maxMs: 0 });
  assert.equal(f.mensajes().length, 0);
  const original = global.setImmediate;
  t.mock.method(global, 'setImmediate', fn => original(() => { activo = true; fn(); }));
  await f.procesador.procesarPendientes();
  assert.equal(f.mensajes().length, 1);
  assert.equal(f.fila(id).procesado_en, null);
  t.mock.restoreAll();
  activo = false;
  await Promise.all([f.procesador.procesarPendientes(), f.procesador.procesarPendientes()]);
  assert.equal(f.mensajes().length, 3);
  assert.equal(f.fila(id).procesado_en, FECHA);
});

test('5000 mensajes / 300 nuevos con 5000 clientes existentes: trozos menores a 200 ms', async t => {
  const clientes = Array.from({ length: 5000 }, (_, n) => ({ id: n + 1, nombre: `Cliente ${n}`,
    celular: `918${String(n).padStart(7, '0')}`, sucursal_id: 2 }));
  const f = preparar(t, { clientes });
  f.canal();
  const threads = Array.from({ length: 300 }, (_, n) => ({ id: `52919${String(n).padStart(7, '0')}`, messages: [] }));
  for (let n = 0; n < 5000; n++) {
    const hilo = threads[n % 300];
    hilo.messages.push(msg(`m${n}`, { from: hilo.id }));
  }
  f.crudo(aviso('history', { history: [{ threads }] }));
  const muestras = [], guardadosPorTrozo = [];
  let inicio = performance.now(), guardados = 0;
  const original = global.setImmediate;
  t.mock.method(global, 'setImmediate', fn => {
    muestras.push(performance.now() - inicio);
    guardadosPorTrozo.push(f.guardados.length - guardados);
    guardados = f.guardados.length;
    return original(() => { inicio = performance.now(); fn(); });
  });
  const r = await f.procesador.procesarPendientes();
  muestras.push(performance.now() - inicio);
  assert.equal(r.procesados, 1);
  assert.equal(f.mensajes().length, 5000);
  assert.equal(f.DB.crm.clientes.length, 5301);
  assert.ok(guardadosPorTrozo.every(n => n <= 1));
  assert.equal(f.guardados.length, 25);
  const maximo = Math.max(...muestras);
  t.diagnostic(`Tramo sincronico maximo: ${maximo.toFixed(3)} ms (${muestras.length} tramos)`);
  assert.ok(maximo <= 200, `Tramo ${maximo.toFixed(3)} ms excede 200 ms`);
});

test('historial conocido, duplicados y contactos sin cambios no clonan la memoria', async t => {
  const f = preparar(t);
  f.canal();
  f.crudo(historia([msg()]));
  await f.procesador.procesarPendientes();
  f.crudo(historia([msg('dos')]));
  f.crudo(vivo());
  f.crudo(contacto(null));
  const clonar = t.mock.method(global, 'structuredClone');
  assert.equal((await f.procesador.procesarPendientes()).procesados, 3);
  assert.equal(clonar.mock.callCount(), 0);
});

test('fallo operativo revierte memoria, queda pendiente, detiene ciclo y registra solo nombre y codigo', async t => {
  let fallar = true;
  const f = preparar(t, { guardar: () => {
    if (fallar) throw Object.assign(new Error('https://privado/SECRETO'), { code: 'EIO' });
  } });
  f.canal();
  const previo = structuredClone(f.DB);
  const id = f.crudo(vivo()), siguiente = f.crudo(vivo([msg('dos')]));
  const log = t.mock.method(console, 'error', () => {});
  assert.deepEqual(await f.procesador.procesarPendientes(), { procesados: 0, errores: 1, sin_canal: 0 });
  assert.deepEqual(f.DB, previo);
  assert.equal(f.mensajes().length, 0);
  for (const n of [id, siguiente]) {
    assert.equal(f.fila(n).procesado_en, null);
    assert.equal(f.fila(n).error_procesamiento, null);
  }
  assert.deepEqual(log.mock.calls.map(c => c.arguments), [['Error EIO']]);
  fallar = false;
  assert.equal((await f.procesador.procesarPendientes()).procesados, 2);
  assert.equal(f.mensajes().length, 2);
});

test('TypeError persistente se descarta al tercer ciclo y permite procesar el siguiente crudo', async t => {
  const f = preparar(t);
  f.canal();
  const original = f.ctx.registrarInteraccion;
  f.ctx.registrarInteraccion = datos => {
    if (datos.texto === 'romper') throw new TypeError('Campo inesperado');
    return original(datos);
  };
  const id = f.crudo(vivo([msg('roto', { text: { body: 'romper' } })]));
  const siguiente = f.crudo(vivo([msg('sano')]));
  const log = t.mock.method(console, 'error', () => {});
  for (let ciclo = 1; ciclo <= 2; ciclo++) {
    assert.deepEqual(await f.procesador.procesarPendientes(), { procesados: 0, errores: 1, sin_canal: 0 });
    for (const n of [id, siguiente]) {
      assert.equal(f.fila(n).procesado_en, null);
      assert.equal(f.fila(n).error_procesamiento, null);
    }
    assert.equal(f.mensajes().length, 0);
  }
  assert.deepEqual(log.mock.calls.map(c => c.arguments), [['TypeError desconocido'], ['TypeError desconocido']]);
  assert.deepEqual(await f.procesador.procesarPendientes(), { procesados: 1, errores: 1, sin_canal: 0 });
  assert.equal(f.fila(id).error_procesamiento, 'error_interno');
  assert.equal(f.fila(siguiente).procesado_en, FECHA);
  assert.equal(f.fila(siguiente).error_procesamiento, null);
  assert.equal(f.mensajes().length, 1);
  assert.deepEqual(await f.procesador.procesarPendientes(), { procesados: 0, errores: 0, sin_canal: 0 });
});

test('TypeError transitorio permite completar el crudo sin error en el siguiente ciclo', async t => {
  const f = preparar(t);
  f.canal();
  const original = f.ctx.registrarInteraccion;
  let intentos = 0;
  f.ctx.registrarInteraccion = datos => {
    if (++intentos === 1) throw new TypeError('Campo inesperado');
    return original(datos);
  };
  t.mock.method(console, 'error', () => {});
  const id = f.crudo(vivo());
  assert.deepEqual(await f.procesador.procesarPendientes(), { procesados: 0, errores: 1, sin_canal: 0 });
  assert.equal(f.fila(id).procesado_en, null);
  assert.equal(f.fila(id).error_procesamiento, null);
  assert.deepEqual(await f.procesador.procesarPendientes(), { procesados: 1, errores: 0, sin_canal: 0 });
  assert.equal(f.fila(id).procesado_en, FECHA);
  assert.equal(f.fila(id).error_procesamiento, null);
  assert.equal(f.mensajes().length, 1);
});

test('state_sync add sin nombre conserva el nombre mostrado', async t => {
  const f = preparar(t);
  f.canal();
  f.crudo(contacto('Ana'));
  f.crudo(contacto(null));
  await f.procesador.procesarPendientes();
  assert.equal(f.sqlite.prepare('SELECT nombre_mostrado FROM lead_identidades_externas').get().nombre_mostrado, 'Ana');
});

test('perfil y contacto limitan nombres a 120 caracteres antes de crear cliente e identidad', async t => {
  const f = preparar(t);
  f.canal();
  const nombre = `  ${'A'.repeat(200)}  `;
  f.crudo(aviso('messages', { messages: [msg()], contacts: [{ wa_id: NUMERO, profile: { name: nombre } }] }));
  f.crudo(contacto(nombre, 'add', '529190000002'));
  f.crudo(vivo([msg('dos', { from: '529190000002' })]));
  await f.procesador.procesarPendientes();
  assert.ok(f.DB.crm.clientes.slice(1).every(c => c.nombre === 'A'.repeat(120)));
  assert.ok(f.sqlite.prepare('SELECT nombre_mostrado FROM lead_identidades_externas').all()
    .every(c => c.nombre_mostrado === 'A'.repeat(120)));
});
