const { test } = require('node:test');
const assert = require('node:assert/strict');
const { prepararBandeja } = require('./bandejaTestHelpers');
const { resumenGupshup } = require('./bandeja/gupshupResumen');

test('diagnostico limita medios a 200 crudos recientes y parsea cada fila una vez', t => {
  const { sqlite } = prepararBandeja(t);
  const insertar = sqlite.prepare(`INSERT INTO lead_eventos_externos
    (proveedor, identificador_evento_externo, tipo, recibido_en, payload_json)
    VALUES ('gupshup', ?, ?, ?, ?)`);
  const fecha = '2026-11-13T12:00:00.000Z';
  const cuerpos = new Set();
  for (let n = 0; n < 205; n++) {
    const field = ['messages', 'smb_message_echoes', 'history'][n % 3];
    const m = { id: `m${n}`, from: '529190000001', to: '529190000001', timestamp: '1775627842',
      type: 'image', image: n < 5 ? { url: 'privado' } : { id: 'medio' } };
    const value = { metadata: { phone_number_id: 'sin_canal' } };
    if (field === 'messages') value.messages = [m];
    if (field === 'smb_message_echoes') value.message_echoes = [m];
    if (field === 'history') value.history = [{ threads: [{ id: m.from, messages: [m] }] }];
    const cuerpo = JSON.stringify({ entry: [{ changes: [{ field, value }] }] });
    cuerpos.add(cuerpo);
    insertar.run(`sha256:${n}`, field, fecha, cuerpo);
  }
  insertar.run('sha256:cuenta', 'account_update', fecha, '{"entry":[{"changes":[{"field":"account_update","value":{}}]}]}');
  const parse = JSON.parse, llamadas = new Map();
  t.mock.method(JSON, 'parse', valor => {
    if (cuerpos.has(valor)) llamadas.set(valor, (llamadas.get(valor) || 0) + 1);
    return parse(valor);
  });
  const r = resumenGupshup(sqlite, new Date(fecha));
  assert.deepEqual(r.medios, { total: 200, con_url: 0, claves: ['id'] });
  assert.equal(r.pendientes_sin_canal, 205, 'el muestreo no recorta los contadores completos');
  assert.equal(llamadas.size, 205);
  assert.ok([...llamadas.values()].every(n => n === 1));
});

test('resumen dice donde fallo y agrupa descartados sin telefonos, texto ni ids', t => {
  const { sqlite } = prepararBandeja(t);
  const insertar = sqlite.prepare(`INSERT INTO lead_eventos_externos
    (proveedor, identificador_evento_externo, tipo, recibido_en, payload_json, procesado_en, error_procesamiento)
    VALUES ('gupshup', ?, 'history', ?, ?, ?, ?)`);
  const fecha = '2026-11-13T12:00:00.000Z';
  const privado = '9191234567 TEXTO_PRIVADO';
  const sano = n => ({ id: `ID_SANO_${n}`, from: '5219191234567', timestamp: '1775627842', type: 'text', text: { body: privado } });
  const roto = n => ({ id: `ID_ROTO_${n}`, from: 9191234567, timestamp: '1775627842', type: 'text', text: { body: privado },
    history_context: { status: privado, [privado]: privado } });
  const sinFecha = n => ({ ...sano(n), id: `ID_FECHA_${n}`, timestamp: privado });
  const cuerpo = mensajes => JSON.stringify({ entry: [{ changes: [{ field: 'history',
    value: { metadata: { phone_number_id: 'tienda' }, history: [{ threads: [{ id: '5219191234567', messages: mensajes }] }] } }] }] });
  insertar.run('sha256:a', fecha, cuerpo([sano(1), roto(1), roto(2), sinFecha(1)]), fecha, null);
  insertar.run('sha256:b', fecha, cuerpo([sano(2), roto(3)]), fecha, null);
  insertar.run('sha256:c', fecha, cuerpo([roto(4)]), null, 'forma_desconocida');
  insertar.run('sha256:d', fecha, '{', null, 'json_invalido');
  const r = resumenGupshup(sqlite, new Date(fecha));
  assert.deepEqual(r.errores_recientes.map(e => [e.motivo, e.ruta]), [
    ['json_invalido', null], ['forma_desconocida', 'history[].threads[].messages[].from'],
  ]);
  assert.deepEqual(r.descartados, [
    { ruta: 'history[].threads[].messages[].from', codigo: 'forma_desconocida', veces: 3, forma: { id: 'string', from: 'number',
      timestamp: 'string', type: 'string', text: { body: 'string' }, history_context: { status: 'string', '?': '?' } } },
    { ruta: 'history[].threads[].messages[].timestamp', codigo: 'fecha_invalida', veces: 1, forma: { id: 'string', from: 'string',
      timestamp: 'string', type: 'string', text: { body: 'string' } } },
  ]);
  const salida = JSON.stringify(r);
  for (const dato of ['9191234567', 'TEXTO_PRIVADO', 'ID_']) assert.ok(!salida.includes(dato), dato);
});

test('descartados se ordenan por veces y cada grupo es ruta mas codigo', t => {
  const { sqlite } = prepararBandeja(t);
  const fecha = '2026-11-13T12:00:00.000Z';
  const base = { from: '5219190000001', timestamp: '1775627842', type: 'text', text: { body: 'x' } };
  const rotos = [
    [1, () => 5], [2, n => ({ ...base, id: n, history_context: { from_me: 'no' } })], [3, n => ({ ...base, id: n, from: 1 })],
    [4, () => ({ ...base, id: 1 })], [5, n => ({ ...base, id: n, timestamp: 'x' })], [6, n => ({ ...base, id: n, text: {} })],
  ];
  const mensajes = [{ ...base, id: 'ok' }];
  for (const [veces, crear] of rotos) for (let k = 0; k < veces; k++) mensajes.push(crear(`r${veces}_${k}`));
  const threads = [{ id: '5219190000001', messages: mensajes }];
  for (let k = 0; k < 7; k++) threads.push({ id: 1, messages: [] });
  for (let k = 0; k < 8; k++) threads.push({ id: '5219190000001', messages: {} });
  const payload = JSON.stringify({ entry: [{ changes: [{ field: 'history', value: { metadata: { phone_number_id: 'tienda' },
    history: [{ threads }] } }] }] });
  sqlite.prepare(`INSERT INTO lead_eventos_externos (proveedor, identificador_evento_externo, tipo, recibido_en, payload_json, procesado_en)
    VALUES ('gupshup', 'sha256:x', 'history', ?, ?, ?)`).run(fecha, payload, fecha);
  const r = resumenGupshup(sqlite, new Date(fecha));
  const p = 'history[].threads[]';
  assert.deepEqual(r.descartados.map(d => [d.ruta, d.codigo, d.veces]), [
    [`${p}.messages`, 'forma_desconocida', 8], [`${p}.id`, 'forma_desconocida', 7], [`${p}.messages[].text.body`, 'forma_desconocida', 6],
    [`${p}.messages[].timestamp`, 'fecha_invalida', 5], [`${p}.messages[].id`, 'forma_desconocida', 4],
    [`${p}.messages[].from`, 'forma_desconocida', 3], [`${p}.messages[].history_context.from_me`, 'forma_desconocida', 2],
    [`${p}.messages[]`, 'forma_desconocida', 1],
  ]);
  assert.equal(r.descartados[7].forma, 'number');
});
