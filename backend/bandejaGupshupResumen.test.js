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
