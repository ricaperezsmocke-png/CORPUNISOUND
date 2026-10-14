const { test } = require('node:test');
const assert = require('node:assert/strict');
const respaldos = require('./respaldos');

test('retención protege la última SICAR completa y la última completa verificada', async () => {
  const DB = { respaldos: respaldos.nuevoEstadoRespaldos() };
  DB.respaldos.copias = [
    [1, 'completo', true], [2, 'completo', true], [3, 'completo', false], [4, 'fallido', true],
  ].map(([id, sicar_estado, verificada]) => ({ id, sicar_estado, estado: 'ok', tipo: 'hora',
    fecha_hora: `2020-01-0${id}T00:00:00Z`, drive_file_id: `foto-${id}`,
    sicar_archivos: [`trozo-${id}`], verificado_en: verificada ? '2020-01-05' : null }));
  const borrados = [];
  await respaldos.limpiarViejos(DB, { eliminarArchivoDeDrive: async (_, id) => borrados.push(id) });
  assert.deepEqual(DB.respaldos.copias.map(c => c.id), [2, 3, 4]);
  assert.deepEqual(borrados, ['trozo-1', 'foto-1']);
});

test('DELETE detenido vence a los 30 segundos y retención conserva el renglón para reintentar', async t => {
  const drive = require('./drive');
  const DB = { respaldos: respaldos.nuevoEstadoRespaldos(),
    drive: { cuenta: { access_token: 'ficticio', expires_at: Date.now() + 3600000 } } };
  DB.respaldos.copias = [1, 2].map(id => ({ id, estado: 'ok', tipo: 'hora',
    fecha_hora: `2020-01-0${id}T00:00:00Z`, drive_file_id: `foto-${id}` }));
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let señal;
  let iniciada;
  const inicio = new Promise(resolve => { iniciada = resolve; });
  t.mock.method(globalThis, 'fetch', async (_, opciones) => {
    señal = opciones.signal;
    iniciada();
    return new Promise((_, reject) => señal?.addEventListener('abort', () => reject(new Error('timeout'))));
  });
  const pendiente = respaldos.limpiarViejos(DB, drive);
  await inicio;
  assert.ok(señal, 'DELETE debe poder abortarse');
  t.mock.timers.tick(29999);
  assert.equal(señal.aborted, false);
  t.mock.timers.tick(1);
  assert.equal(señal.aborted, true);
  assert.deepEqual(await pendiente, { borradas: 0, conservadas: 2 });
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 204 }));
  assert.deepEqual(await respaldos.limpiarViejos(DB, drive), { borradas: 1, conservadas: 1 });
});
