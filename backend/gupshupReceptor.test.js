const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createHash } = require('node:crypto');
const express = require('express');
const Database = require('better-sqlite3');
const { inicializarPersistenciaCentroLeads } = require('./centroLeads/persistencia');
const { registrarReceptorGupshup, tipoDeEvento, MAX_CUERPO, MAX_SERIALIZADO, MAX_PENDIENTES } = require('./bandeja/gupshupReceptor');

const TOKEN = 't'.repeat(40);
const FECHA = '2026-11-11T12:00:00.000Z';
const hash = cuerpo => 'sha256:' + createHash('sha256').update(cuerpo).digest('hex');

test('contador conserva puntos Unicode y NUL sin materializar Array.from del cuerpo', async t => {
  const { contadorPendientes } = require('./bandeja/gupshupPendientes');
  const f = await preparar(t, { pendientes: () => 0 });
  const original = Array.from;
  t.mock.method(Array, 'from', function(valor, ...args) {
    assert.notEqual(typeof valor, 'string', 'no materializar el cuerpo en un arreglo');
    return original.call(this, valor, ...args);
  });
  for (const cuerpo of ['abc', 'México 🎸', 'antes\0despues']) {
    assert.equal((await f.pedir(cuerpo)).status, 200);
  }
  const esperado = f.sqlite.prepare('SELECT sum(length(payload_json)) n FROM lead_eventos_externos').get().n;
  assert.equal(contadorPendientes(f.sqlite).adicionales, esperado);
});
async function preparar(t, opciones = {}) {
  const sqlite = opciones.sqlite || new Database(':memory:');
  inicializarPersistenciaCentroLeads(sqlite);
  const avisos = [];
  const app = express();
  registrarReceptorGupshup(app, { sqlite, token: TOKEN, disponible: () => true,
    mantenimiento: { estaActivo: () => false }, ahora: () => new Date(FECHA), avisar: m => avisos.push(m), ...opciones });
  app.use(express.json());
  app.post('/api/eco', (req, res) => res.json(req.body));
  const servidor = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(async () => {
    servidor.closeAllConnections();
    await new Promise(resolve => servidor.close(resolve));
    if (!opciones.sqlite) sqlite.close();
  });
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const pedir = (body = '{}', token = TOKEN, method = 'POST', headers = {}) =>
    fetch(`${base}/api/integraciones/gupshup/${token}`, { method, headers, ...(method === 'POST' ? { body } : {}) });
  const filas = () => sqlite.prepare('SELECT * FROM lead_eventos_externos').all();
  return { sqlite, servidor, base, pedir, filas, avisos };
}

test('token correcto guarda una fila y responde 200 vacio', async t => {
  const f = await preparar(t);
  const cuerpo = JSON.stringify({ entry: [{ changes: [{ field: 'messages' }, { field: 'smb_message_echoes' }] }] });
  const r = await f.pedir(cuerpo);
  assert.equal(r.status, 200);
  assert.equal(await r.text(), '');
  assert.deepEqual(f.filas(), [{ id: 1, fuente_id: null, proveedor: 'gupshup', identificador_evento_externo: hash(cuerpo),
    tipo: 'messages,smb_message_echoes', recibido_en: FECHA, ocurrido_en: null, payload_json: cuerpo,
    procesado_en: null, error_procesamiento: null }]);
});

test('token incorrecto y de distinta longitud responden 401 sin fila', async t => {
  const f = await preparar(t);
  for (const token of ['x'.repeat(40), TOKEN + 'extra', 'x']) assert.equal((await f.pedir('{}', token)).status, 401);
  assert.equal(f.filas().length, 0);
});

for (const token of [undefined, '', 't'.repeat(31)]) {
  test(`sin token valido configurado (${String(token)}) responde 404`, async t => {
    const f = await preparar(t, { token });
    assert.equal((await f.pedir()).status, 404);
    assert.equal(f.filas().length, 0);
  });
}

test('cuerpo identico dos veces guarda una sola fila y responde 200 ambas', async t => {
  const f = await preparar(t);
  for (let i = 0; i < 2; i++) {
    const r = await f.pedir();
    assert.equal(r.status, 200);
    assert.equal(await r.text(), '');
  }
  assert.equal(f.filas().length, 1);
});

test('cuerpo de 1572865 bytes responde 413 sin fila', async t => {
  const f = await preparar(t);
  assert.equal(MAX_CUERPO, 1572864);
  assert.equal((await f.pedir(Buffer.alloc(MAX_CUERPO + 1, 97))).status, 413);
  assert.equal(f.filas().length, 0);
});

test('JSON valido de 1000000 bytes se guarda', async t => {
  const f = await preparar(t);
  const cuerpo = JSON.stringify('a'.repeat(999998));
  assert.equal(Buffer.byteLength(cuerpo), 1000000);
  assert.equal((await f.pedir(cuerpo)).status, 200);
  assert.equal(f.filas()[0].payload_json, cuerpo);
});

test('JSON con muchas comillas excede serializado y responde 413 sin fila', async t => {
  const f = await preparar(t);
  const cuerpo = JSON.stringify('"'.repeat(500000));
  assert.equal(MAX_SERIALIZADO, 1900000);
  assert.ok(Buffer.byteLength(cuerpo) < MAX_CUERPO);
  assert.ok(Buffer.byteLength(JSON.stringify(cuerpo)) > MAX_SERIALIZADO);
  assert.equal((await f.pedir(cuerpo)).status, 413);
  assert.equal(f.filas().length, 0);
});

test('JSON invalido se guarda con tipo no_json', async t => {
  const f = await preparar(t);
  assert.equal((await f.pedir('no es JSON')).status, 200);
  assert.equal(f.filas()[0].tipo, 'no_json');
  assert.equal(f.filas()[0].payload_json, 'no es JSON');
});

test('tipo: v2, desconocido, fields unicos ordenados y recorte a 200', () => {
  assert.equal(tipoDeEvento('{"app":"x","type":"message","payload":{}}'), 'message');
  for (const valor of [{}, null, [], { type: 1 }, { entry: [] }]) assert.equal(tipoDeEvento(JSON.stringify(valor)), 'desconocido');
  assert.equal(tipoDeEvento(JSON.stringify({ type: 'x'.repeat(201) })), 'x'.repeat(200));
  assert.equal(tipoDeEvento(JSON.stringify({ entry: [{ changes: [{ field: 'z' }, { field: 'a' }] },
    { changes: [{ field: 'z' }, null, { field: 2 }] }, null] })), 'a,z');
});

for (const [nombre, opciones] of [
  ['mantenimiento activo', { mantenimiento: { estaActivo: () => true } }],
  ['bandeja no disponible', { disponible: () => false }],
]) {
  test(`${nombre} responde 503 sin fila`, async t => {
    const f = await preparar(t, opciones);
    assert.equal((await f.pedir()).status, 503);
    assert.equal(f.filas().length, 0);
  });
}

test('pendientes sobre el tope responde 503 sin otra fila y avisa una vez por minuto', async t => {
  const f = await preparar(t, { maxPendientes: 1 });
  assert.equal(MAX_PENDIENTES, 209715200);
  assert.equal((await f.pedir('{}')).status, 200);
  assert.equal((await f.pedir('MARCADOR_PRIVADO')).status, 503);
  assert.equal((await f.pedir('MARCADOR_PRIVADO')).status, 503);
  assert.equal(f.filas().length, 1);
  assert.equal(f.avisos.length, 1);
  assert.ok(!JSON.stringify(f.avisos).includes('MARCADOR_PRIVADO'));
});

test('tope cacheado evita suma SQL y suma solo inserciones nuevas', async t => {
  const f = await preparar(t, { pendientes: () => 0, maxPendientes: 3 });
  const original = f.sqlite.prepare.bind(f.sqlite);
  t.mock.method(f.sqlite, 'prepare', sql => {
    if (/sum\(length\(payload_json\)\)/i.test(sql)) throw new Error('No debe sumar por peticion');
    return original(sql);
  });
  assert.equal((await f.pedir('{}')).status, 200);
  assert.equal((await f.pedir('{}')).status, 200, 'duplicado no suma');
  assert.equal((await f.pedir('[]')).status, 200);
  assert.equal((await f.pedir('siguiente')).status, 503);
  assert.equal(f.filas().length, 2);
});

test('cache sobre tope rechaza sin sumar SQL', async t => {
  const f = await preparar(t, { pendientes: () => MAX_PENDIENTES + 1 });
  const original = f.sqlite.prepare.bind(f.sqlite);
  t.mock.method(f.sqlite, 'prepare', sql => {
    if (/sum\(length\(payload_json\)\)/i.test(sql)) throw new Error('No debe sumar');
    return original(sql);
  });
  assert.equal((await f.pedir()).status, 503);
  assert.equal(f.filas().length, 0);
  assert.ok(f.avisos.some(m => m.includes('tope')), 'el rechazo viene del cache, no de un fallo SQL');
});

test('procesador recalcula el cache del receptor y libera capacidad', async t => {
  const { crearProcesadorGupshup } = require('./bandeja/gupshupProcesador');
  const { crearContextoBandeja } = require('./bandeja/mensajes');
  let procesador;
  const f = await preparar(t, { pendientes: () => procesador.pendientes(), maxPendientes: 3 });
  const DB = { crm: { clientes: [], contactos_cliente: [], estados_historial: [] } };
  const ctx = crearContextoBandeja({ sqlite: f.sqlite, DB });
  procesador = crearProcesadorGupshup({ sqlite: f.sqlite, DB, ctx, guardar: () => {}, mantenimiento: { estaActivo: () => false } });
  const cuerpo = JSON.stringify({ entry: [{ changes: [{ field: 'account_update', value: {} }] }] });
  assert.equal((await f.pedir(cuerpo)).status, 200);
  assert.equal((await f.pedir('siguiente')).status, 503);
  assert.equal(procesador.recalcularPendientes(), cuerpo.length);
  assert.equal((await f.pedir('siguiente')).status, 503, 'recalcular no pierde bytes pendientes');
  await procesador.procesarPendientes();
  assert.equal(procesador.pendientes(), 0);
  assert.equal((await f.pedir(cuerpo + ' ')).status, 200);
});

test('mas de N peticiones por minuto responde 429 y se reinicia la ventana', async t => {
  let ahora = new Date(FECHA);
  const f = await preparar(t, { limitePorMinuto: 1, ahora: () => ahora });
  assert.equal((await f.pedir()).status, 200);
  assert.equal((await f.pedir('otro')).status, 429);
  assert.equal(f.filas().length, 1);
  ahora = new Date(ahora.getTime() + 60000);
  assert.equal((await f.pedir('otro')).status, 200);
});

test('GET correcto responde 200 vacio e incorrecto 401', async t => {
  const f = await preparar(t);
  const r = await f.pedir(undefined, TOKEN, 'GET');
  assert.equal(r.status, 200);
  assert.equal(await r.text(), '');
  assert.equal((await f.pedir(undefined, 'malo', 'GET')).status, 401);
  assert.equal(f.filas().length, 0);
});

test('UTF-8 con BOM, emoji y acentos se guarda exacto sin depender de Content-Type', async t => {
  const f = await preparar(t);
  for (const [i, headers] of [{}, { 'Content-Type': 'text/plain' }, { 'Content-Type': 'application/json' }].entries()) {
    const cuerpo = Buffer.from('\ufeff' + JSON.stringify({ texto: `México 🎸 ${i}` }));
    assert.equal((await f.pedir(cuerpo, TOKEN, 'POST', headers)).status, 200);
    assert.equal(f.filas()[i].payload_json, cuerpo.toString('utf8'));
    assert.equal(f.filas()[i].identificador_evento_externo, hash(cuerpo));
  }
});

test('ruta JSON normal sigue funcionando', async t => {
  const f = await preparar(t);
  const r = await fetch(`${f.base}/api/eco`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"hola":1}' });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { hola: 1 });
});

test('conexion cortada a mitad del cuerpo no deja fila', async t => {
  const f = await preparar(t);
  let recibido;
  const inicio = new Promise(resolve => { recibido = resolve; });
  f.servidor.once('request', req => req.once('data', recibido));
  const req = http.request(`${f.base}/api/integraciones/gupshup/${TOKEN}`, { method: 'POST', headers: { 'Content-Length': 1000 } });
  req.on('error', () => {});
  req.write('{"parcial":');
  await inicio;
  req.destroy();
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(f.filas().length, 0);
});

test('413 avisa sin contenido y fallo de guardado devuelve 503 sin datos', async t => {
  const f = await preparar(t);
  assert.equal((await f.pedir('MARCADOR_PRIVADO' + 'x'.repeat(MAX_CUERPO))).status, 413);
  assert.ok(f.avisos.length > 0);
  f.sqlite.exec("CREATE TRIGGER fallo BEFORE INSERT ON lead_eventos_externos BEGIN SELECT RAISE(ABORT, 'MARCADOR_PRIVADO'); END");
  assert.equal((await f.pedir('MARCADOR_PRIVADO')).status, 503);
  assert.equal(f.filas().length, 0);
  assert.ok(!JSON.stringify(f.avisos).includes('MARCADOR_PRIVADO'));
});

test('el evento mas grande aceptado no rompe el respaldo y se restaura exacto', async t => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { crearRepositorioSicar } = require('./sicarRepositorio');
  const respaldo = require('./sicarRespaldo');
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'gupshup-respaldo-'));
  const sqlite = new Database(path.join(carpeta, 'prueba.sqlite'));
  sqlite.pragma('journal_mode = WAL');
  const repo = crearRepositorioSicar(sqlite);
  t.after(() => {
    sqlite.close();
    fs.rmSync(carpeta, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  const f = await preparar(t, { sqlite });
  const cuerpo = JSON.stringify('"'.repeat(474998) + 'aa');
  assert.equal(Buffer.byteLength(JSON.stringify(cuerpo)), 1900000);
  assert.ok(Buffer.byteLength(cuerpo) < MAX_CUERPO);
  assert.equal((await f.pedir(cuerpo)).status, 200);
  const filas = f.filas();
  assert.equal(filas.length, 1);
  const archivos = new Map();
  const drive = {
    asegurarCarpetaRespaldos: async () => 'carpeta',
    async subirArchivoADrive(_DB, args) {
      const id = String(archivos.size + 1);
      archivos.set(id, Buffer.from(args.contenidoBuffer));
      return { id };
    },
    async descargarArchivoDeDriveLimitado(_DB, id, limite) {
      const bytes = archivos.get(id);
      assert.ok(bytes.length <= limite);
      return bytes;
    },
    async eliminarArchivoDeDrive(_DB, id) { archivos.delete(id); },
  };
  const m = await respaldo.crearSnapshotSicar(repo, drive, { DB: {}, llave: Buffer.alloc(32, 7) });
  assert.equal(m.conteos.lead_eventos_externos, 1);
  await respaldo.verificarSnapshotSicar(repo, drive, m);
  sqlite.exec('DELETE FROM lead_eventos_externos');
  const restauracion = await respaldo.prepararRestauracionSicar(repo, drive, m);
  try { restauracion.aplicar(() => {}, { clientes: [], fechaFoto: m.generado_en }); }
  finally { restauracion.liberar(); }
  assert.deepEqual(f.filas(), filas);
});
