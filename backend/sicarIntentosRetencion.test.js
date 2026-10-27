/**
 * sicarIntentosRetencion.test.js — Los intentos SICAR no llenan el disco de
 * Render (auditoría sicar-crm 2026-10, A1).
 *
 * La reproducción mostraba que 40 peticiones anónimas dejaban 40 filas
 * permanentes en `sicar_intentos`, incluidas las ya frenadas con 429: cualquiera
 * en internet, sin llave, iba llenando el disco de 1 GB. Ahora los 429 y los 401
 * sin llave reconocida solo suben un contador en memoria, y los intentos de una
 * llave real se conservan con tope por tienda y por antigüedad. El contrato del
 * agente no cambia: mismas respuestas y códigos.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
process.env.DB_PATH = ':memory:';
process.env.SENTRY_ENABLED = 'false';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'sicar-retencion-desechable';
const app = require('./server');
const { obtenerConexionSqlite } = require('./persistencia');
const { crearRepositorioSicar } = require('./sicarRepositorio');
const { crearContadorRechazosSicar } = require('./sicarRutas');

const sqlite = obtenerConexionSqlite();
let servidor, base;

before(async () => {
  await new Promise(resolve => { servidor = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(async () => {
  servidor?.closeAllConnections();
  if (servidor) await new Promise(resolve => servidor.close(resolve));
  sqlite.close();
});

const intentos = () => sqlite.prepare('SELECT count(*) n FROM sicar_intentos').get().n;

async function enviarLote(authorization) {
  const res = await fetch(`${base}/api/integraciones/sicar/v1/lotes`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(authorization ? { Authorization: authorization } : {}) },
    body: '{}',
  });
  await res.text();
  return res.status;
}

test('A1 invertida: 40 peticiones anónimas (401 y 429) no dejan ninguna fila nueva', async () => {
  const antes = intentos();
  const codigos = [];
  for (let i = 0; i < 40; i++) codigos.push(await enviarLote(i % 2 ? null : `Bearer ${'0'.repeat(8)}-0000-0000-0000-000000000000.x`));
  assert.ok(codigos.includes(401), 'las primeras siguen respondiendo 401');
  assert.ok(codigos.includes(429), 'el freno de ritmo sigue respondiendo 429');
  assert.equal(intentos() - antes, 0);
});

function repoConTienda(t) {
  const db = new Database(':memory:');
  t.after(() => db.close());
  const repo = crearRepositorioSicar(db);
  db.prepare('INSERT INTO sicar_tiendas(sucursal_id) VALUES (1), (2)').run();
  return { db, repo };
}

function intento(sucursal_id, hora = new Date().toISOString()) {
  return { sucursal_id, key_id: null, batch_id: null, recibidos: null, aceptados: null, rechazados: null,
    bytes: 0, codigo: '400', hora, duracion_ms: 1 };
}

test('una llave real con 5,010 intentos queda en 5,000 y conserva los más nuevos; otra tienda no se toca', t => {
  const { db, repo } = repoConTienda(t);
  repo.registrarIntento(intento(2));
  for (let i = 0; i < 5010; i++) repo.registrarIntento(intento(1));
  const n = db.prepare('SELECT count(*) n, min(id) minimo, max(id) maximo FROM sicar_intentos WHERE sucursal_id=1').get();
  assert.equal(n.n, 5000);
  assert.equal(n.maximo - n.minimo, 4999 + 0, 'quedan los 5,000 más recientes, sin huecos');
  assert.equal(db.prepare('SELECT count(*) n FROM sicar_intentos WHERE sucursal_id=2').get().n, 1);
});

test('al arrancar se borran los intentos de más de 30 días', t => {
  const { db, repo } = repoConTienda(t);
  const dia = 24 * 60 * 60 * 1000;
  repo.registrarIntento(intento(1, new Date(Date.now() - 31 * dia).toISOString()));
  repo.registrarIntento(intento(1, new Date(Date.now() - 29 * dia).toISOString()));
  crearRepositorioSicar(db); // "arranque": se crea el repositorio otra vez sobre la misma base
  assert.equal(db.prepare('SELECT count(*) n FROM sicar_intentos').get().n, 1);
});

test('el contador en memoria guarda 60 minutos y avisa una vez por minuto al pasar de 100', () => {
  let t = Date.UTC(2026, 9, 27, 12, 0, 0);
  const avisos = [];
  const contador = crearContadorRechazosSicar({ ahora: () => t, avisar: m => avisos.push(m) });
  for (let i = 0; i < 150; i++) contador.registrar(401);
  contador.registrar(429);
  assert.equal(avisos.length, 1);
  assert.deepEqual(contador.resumen().at(-1), { minuto: '2026-10-27T12:00', anonimos_401: 150, frenados_429: 1 });
  t += 61 * 60 * 1000;
  contador.registrar(429);
  assert.equal(contador.resumen().length, 1, 'lo de hace más de 60 minutos se olvida');
});
