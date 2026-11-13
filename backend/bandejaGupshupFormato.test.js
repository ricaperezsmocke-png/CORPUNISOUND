const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extraerDeCrudo, limpiarTexto } = require('./bandeja/gupshupFormato');

const cliente = '5219190000001';
const mensaje = extra => ({ id: 'uno', from: cliente, timestamp: '1775627842', type: 'text', text: { body: 'Hola' }, ...extra });
const crudo = (field, value) => JSON.stringify({ entry: [{ changes: [{ field,
  value: { metadata: { phone_number_id: 'tienda' }, ...value } }] }] });
const extraer = (field, value) => extraerDeCrudo(crudo(field, value)).avisos;

test('edit y revoke usan los campos documentados de coexistencia', () => {
  const casos = [
    ['edit', { message: { type: 'text', text: { body: 'Nuevo texto' } } }, '[Mensaje editado] Nuevo texto'],
    ['edit', { message: { type: 'image', image: { caption: 'Nuevo pie' } } }, '[Mensaje editado] Nuevo pie'],
    ['edit', { message: { type: 'image', image: {} } }, '[Mensaje editado]'],
    ['revoke', { original_message_id: 'original' }, '[Mensaje eliminado]'],
  ];
  for (const [type, contenido, esperado] of casos) {
    assert.equal(extraer('messages', { messages: [mensaje({ type, [type]: contenido })] })[0].mensajes[0].texto, esperado);
  }
});

test('texto vivo conserva identidad, perfil y segundos Unix', () => {
  assert.deepEqual(extraer('messages', { messages: [mensaje()], contacts: [{ wa_id: cliente, profile: { name: 'Ana' } }] }), [{
    clase: 'mensajes', phoneNumberId: 'tienda', mensajes: [{ wamid: 'uno', wa_id: cliente, direccion: 'entrante', origen: 'vivo',
      ocurrido_en: new Date(1775627842000).toISOString(), texto: 'Hola', nombre: 'Ana', placeholder: false }],
  }]);
});

test('tipos de mensajes tienen etiquetas y caption; reacciones se ignoran', () => {
  const casos = [
    ['image', { caption: 'precio?' }, '[Foto] precio?'], ['document', { filename: 'cot.pdf' }, '[Documento: cot.pdf]'],
    ['video', {}, '[Video]'], ['audio', {}, '[Audio]'], ['sticker', {}, '[Sticker]'], ['location', {}, '[Ubicación]'],
    ['contacts', [], '[Contacto compartido]'], ['errors', [], '[Mensaje no soportado]'], ['nuevo', {}, '[Mensaje no soportado]'],
  ];
  for (const [type, contenido, esperado] of casos) {
    assert.equal(extraer('messages', { messages: [mensaje({ type, [type]: contenido })] })[0].mensajes[0].texto, esperado);
  }
  assert.equal(extraer('messages', { messages: [mensaje({ type: 'reaction' })] })[0].mensajes.length, 0);
});

test('ecos son salientes del telefono dirigidos a to', () => {
  const m = extraer('smb_message_echoes', { message_echoes: [mensaje({ from: 'tienda', to: cliente })] })[0].mensajes[0];
  assert.equal(m.wa_id, cliente);
  assert.equal(m.origen, 'telefono');
  assert.equal(m.direccion, 'saliente');
});

test('historial recorre hilos y distingue direccion y placeholders', () => {
  const avisos = extraer('history', { history: [{ threads: [
    { id: cliente, messages: [mensaje({ history_context: { from_me: true } }), mensaje()] },
    { id: 'otro', messages: [mensaje({ type: 'media_placeholder', from: 'tienda' })] },
  ] }] });
  const mensajes = avisos.flatMap(a => a.mensajes || []);
  assert.equal(mensajes.length, 3);
  assert.deepEqual(mensajes.map(m => m.direccion), ['saliente', 'entrante', 'saliente']);
  assert.ok(mensajes.every(m => m.origen === 'historial'));
  assert.equal(mensajes[2].wa_id, 'otro');
  assert.equal(mensajes[2].placeholder, true);
  assert.equal(mensajes[2].texto, '[Archivo del historial]');
});

test('fase y rechazo de historial quedan ignorados con motivo', () => {
  assert.equal(extraer('history', { history: [{ metadata: { phase: 0, progress: 100 } }] })[0].clase, 'ignorado');
  assert.deepEqual(extraer('history', { history: [{ errors: [{ code: 2593109 }] }] }),
    [{ clase: 'ignorado', motivo: 'historial_rechazado' }]);
});

test('contactos sincronizados conservan add y remove', () => {
  const avisos = extraer('smb_app_state_sync', { state_sync: [
    { type: 'contact', action: 'add', contact: { phone_number: cliente, full_name: 'Ana' } },
    { type: 'contact', action: 'remove', contact: { phone_number: 'otro' } },
  ] });
  assert.deepEqual(avisos, [{ clase: 'contactos', phoneNumberId: 'tienda', contactos: [
    { wa_id: cliente, nombre: 'Ana', accion: 'add' }, { wa_id: 'otro', nombre: null, accion: 'remove' },
  ] }]);
});

test('statuses y campos de cuenta se ignoran', () => {
  assert.equal(extraer('messages', { statuses: [{}] })[0].clase, 'ignorado');
  assert.equal(extraer('account_update', {})[0].clase, 'ignorado');
});

test('JSON, fecha y formas invalidas fallan con codigos seguros', () => {
  assert.throws(() => extraerDeCrudo('{'), { codigo: 'json_invalido' });
  for (const timestamp of ['abc', '', null, 'Infinity', '999999999999999999999']) {
    assert.throws(() => extraer('messages', { messages: [mensaje({ timestamp })] }), { codigo: 'fecha_invalida' });
  }
  assert.throws(() => extraer('smb_message_echoes', { messages: [mensaje()] }), { codigo: 'forma_desconocida' });
  assert.throws(() => extraer('history', { history: [{ threads: {} }] }), { codigo: 'forma_desconocida' });
});

test('limpia controles y sustitucion sin perder saltos, limita y reemplaza vacios', () => {
  assert.equal(limpiarTexto('a\u0007\uFFFD\n\tb'), 'a\n\tb');
  assert.equal(limpiarTexto('x'.repeat(5000)).length, 4096);
  assert.equal(limpiarTexto('\u0007\uFFFD'), '[Mensaje vacío]');
  assert.equal(extraer('messages', { messages: [mensaje({ text: { body: 'a\u0007\uFFFDb' } })] })[0].mensajes[0].texto, 'ab');
});

test('texto vacio se presenta con marcador sin rechazar el crudo', () => {
  assert.equal(extraer('messages', { messages: [mensaje({ text: { body: '' } })] })[0].mensajes[0].texto, '[Mensaje vacío]');
});
