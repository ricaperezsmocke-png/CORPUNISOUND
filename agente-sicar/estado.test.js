const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { inicial, guardar, cargar, bloquear, registrar } = require('./estado');
const { enviarPendiente } = require('./envio');
const { sobre } = require('./formato');
async function entorno(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sicar-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return path.join(dir, 'estado.json');
}
async function pendiente(t) {
  const archivo = await entorno(t);
  const estado = inicial();
  estado.pendiente = { bytes: JSON.stringify(sobre('1', 'incremental', new Date('2026-10-15T03:00:00Z'))),
    cambios: { ven_id: '40' } };
  await guardar(archivo, estado);
  return { archivo, estado };
}
const respuesta = (status, datos) => ({ status, json: async () => datos });
test('guarda atómicamente bytes UTF8 y rechaza estado ilegible sin reiniciar cursores', async t => {
  const archivo = await entorno(t);
  const estado = inicial();
  estado.pendiente = { bytes: '{"nombre":"José"}', cambios: {} };
  await guardar(archivo, estado);
  assert.deepEqual(await cargar(archivo), estado);
  assert.deepEqual(await fs.readdir(path.dirname(archivo)), ['estado.json']);
  await fs.writeFile(archivo, '{roto');
  await assert.rejects(cargar(archivo));
});
test('bloqueo excluye otra corrida y se libera al terminar', async t => {
  const archivo = await entorno(t);
  const liberar = await bloquear(archivo);
  assert.equal(typeof liberar, 'function');
  assert.equal(await bloquear(archivo), null);
  await liberar();
  const nueva = await bloquear(archivo);
  assert.equal(typeof nueva, 'function');
  await nueva();
});
test('caída deja cursores intactos y otra corrida reenvía bytes idénticos', async t => {
  const { archivo, estado } = await pendiente(t);
  const bytes = estado.pendiente.bytes;
  const deps = { esperar: async () => {}, reloj: () => 90000, intentos: 1 };
  await enviarPendiente(archivo, estado, { llave: 'secreto' }, { ...deps, fetch: async () => { throw new Error('secreto'); } });
  const disco = await cargar(archivo);
  assert.equal(disco.ven_id, '0');
  assert.equal(disco.siguiente_secuencia, '1');
  assert.equal(disco.pendiente.bytes, bytes);
  await enviarPendiente(archivo, disco, { llave: 'secreto' }, { ...deps, fetch: async (_, opciones) => {
    assert.equal(opciones.body, bytes);
    return respuesta(200, { next_sequence: '2' });
  } });
  assert.equal((await cargar(archivo)).ven_id, '40');
  assert.equal(disco.siguiente_secuencia, '2');
  assert.equal(disco.pendiente, null);
});
test('409 de secuencia rearma con UUID nuevo; no cambia cursor antes de 200', async t => {
  const { archivo, estado } = await pendiente(t);
  const anterior = JSON.parse(estado.pendiente.bytes);
  await enviarPendiente(archivo, estado, {}, { intentos: 1, esperar: async () => {}, reloj: () => 90000,
    fetch: async () => respuesta(409, { codigo: 'SECUENCIA_INCORRECTA', siguiente_secuencia: '8' }) });
  const nuevo = JSON.parse((await cargar(archivo)).pendiente.bytes);
  assert.equal(nuevo.sequence, '8');
  assert.notEqual(nuevo.batch_id, anterior.batch_id);
  assert.equal(estado.ven_id, '0');
  assert.equal(estado.siguiente_secuencia, '1');
});
for (const status of [400, 401, 413, 422, 409]) {
  test(`${status} detiene y no reintenta en otra corrida`, async t => {
    const { archivo, estado } = await pendiente(t);
    let veces = 0;
    const deps = { esperar: async () => {}, reloj: () => 90000, fetch: async () => {
      veces++;
      return respuesta(status, { codigo: 'CONFLICTO_BATCH' });
    } };
    await assert.rejects(enviarPendiente(archivo, estado, {}, deps));
    await assert.rejects(enviarPendiente(archivo, await cargar(archivo), {}, deps));
    assert.equal(veces, 1);
    assert.equal(estado.ven_id, '0');
  });
}
for (const status of [429, 503]) {
  test(`${status} reenvía bytes idénticos tras espera y confirma solo con 200`, async t => {
    const { archivo, estado } = await pendiente(t);
    const enviados = [], pausas = [];
    await enviarPendiente(archivo, estado, {}, { esperar: async ms => pausas.push(ms), reloj: () => 90000,
      fetch: async (_, opciones) => {
        enviados.push(opciones.body);
        return enviados.length === 1 ? respuesta(status, {}) : respuesta(200, { next_sequence: '2' });
      } });
    assert.equal(enviados.length, 2);
    assert.equal(enviados[0], enviados[1]);
    assert.ok(pausas.some(ms => ms >= (status === 429 ? 60000 : 5000)));
    assert.equal(estado.ven_id, '40');
  });
}
test('registro descarta errores arbitrarios con secretos completos o parciales', () => {
  const salida = [];
  const log = registrar(linea => salida.push(linea));
  log('RED_NO_DISPONIBLE', new Error('password=MYSQL-ABC-SECRET llave=TIENDA-XYZ-SECRET'));
  log('ABC-SECRET');
  const texto = salida.join('\n');
  for (const trozo of ['MYSQL', 'ABC', 'TIENDA', 'XYZ', 'SECRET']) assert.equal(texto.includes(trozo), false);
  assert.match(texto, /RED_NO_DISPONIBLE/);
});
test('si la espera cruza las 07:00 conserva lote histórico sin transmitirlo', async t => {
  const { archivo, estado } = await pendiente(t);
  const lote = JSON.parse(estado.pendiente.bytes);
  lote.mode = 'historico';
  estado.pendiente.bytes = JSON.stringify(lote);
  let ahora = Date.parse('2026-10-15T12:59:59Z');
  estado.ultimo_envio = ahora;
  let envios = 0;
  const resultado = await enviarPendiente(archivo, estado, {}, {
    reloj: () => ahora, esperar: async ms => { ahora += ms; },
    fetch: async () => { envios++; return respuesta(200, { next_sequence: '2' }); },
  });
  assert.equal(envios, 0);
  assert.equal(resultado, false);
  assert.equal(estado.ven_id, '0');
});
test('401 con respuesta no JSON también detiene sin reintentar', async t => {
  const { archivo, estado } = await pendiente(t);
  let envios = 0;
  await assert.rejects(enviarPendiente(archivo, estado, {}, { esperar: async () => {}, fetch: async () => {
    envios++;
    return { status: 401, json: async () => { throw new Error('respuesta HTML'); } };
  } }));
  assert.equal(envios, 1);
  assert.equal((await cargar(archivo)).detenido, 'HTTP_401');
});
test('un estado.json de antes de los proveedores arranca su lista desde cero y rechaza cursores raros', async t => {
  const archivo = await entorno(t);
  const viejo = inicial();
  delete viejo.proveedores_cursor;
  delete viejo.proveedores_dia;
  await fs.writeFile(archivo, JSON.stringify(viejo));
  const estado = await cargar(archivo);
  assert.equal(estado.proveedores_cursor, '0');
  assert.equal(estado.proveedores_dia, null);
  for (const raro of [{ proveedores_cursor: 'x' }, { proveedores_cursor: 5 }, { proveedores_dia: 'ayer' }]) {
    await fs.writeFile(archivo, JSON.stringify({ ...viejo, ...raro }));
    await assert.rejects(cargar(archivo), /ESTADO_INVALIDO/);
  }
  assert.equal(registrar(x => x)('PROVEEDOR_OMITIDO', { prv_id: '7', codigo: 'TEXTO_VACIO' }), 'PROVEEDOR_OMITIDO prv_id=7 codigo=TEXTO_VACIO');
  assert.equal(registrar(x => x)('PROVEEDORES_NO_DISPONIBLES'), 'PROVEEDORES_NO_DISPONIBLES');
});
