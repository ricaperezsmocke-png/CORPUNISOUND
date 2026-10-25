const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { crearRepositorioSicar } = require('./sicarRepositorio');
const { consultarExistenciasSicar, diezmilesimasATexto } = require('./sicarExistencias');

const AHORA = new Date('2026-10-23T18:00:00.000Z');
const hace = horas => new Date(AHORA.getTime() - horas * 3600000).toISOString();

function prepararDB(t) {
  porTienda = {};
  const sqlite = new Database(':memory:');
  t.after(() => sqlite.close());
  return { sqlite, repo: crearRepositorioSicar(sqlite) };
}
let secuencia = 0;
let porTienda = {};
function sembrar(repo, sqlite, sucursalId, articulos, existencias, { actualizado = hace(1), recepcion = hace(1) } = {}) {
  secuencia += 1;
  porTienda[sucursalId] = (porTienda[sucursalId] || 0) + 1;
  const seq = String(porTienda[sucursalId]);
  repo.aplicarLote({ sucursalId, hash: `h${secuencia}`, lote: { schema_version: 1, mapping_version: 'v', batch_id: `b${secuencia}`,
    sequence: seq, clientes: [], ventas: [], articulos, existencias } });
  sqlite.prepare('UPDATE sicar_existencias SET actualizado_en=? WHERE sucursal_id=?').run(actualizado, sucursalId);
  sqlite.prepare('UPDATE sicar_tiendas SET ultima_recepcion=? WHERE sucursal_id=?').run(recepcion, sucursalId);
}
const art = (art_id, clave, descripcion) => ({ art_id, clave, descripcion, categoria: 'Cat', departamento: 'Dep' });
const ex = (art_id, existencia) => ({ art_id, existencia });
const consulta = (sqlite, p = {}) => consultarExistenciasSicar(sqlite, { q: '', solo: 'todas', pagina: 1, ...p }, AHORA);

test('diezmilesimas a texto exacto con negativos y enteros grandes', () => {
  assert.equal(diezmilesimasATexto(30000), '3.0000');
  assert.equal(diezmilesimasATexto(-10000), '-1.0000');
  assert.equal(diezmilesimasATexto(-5), '-0.0005');
  assert.equal(diezmilesimasATexto(0), '0.0000');
  assert.equal(diezmilesimasATexto(1), '0.0001');
  assert.equal(diezmilesimasATexto(9007199254740991n * 10n), '9007199254740.9910');
});

test('agrupa por clave entre tiendas y suma el total; sin clave, un renglon por tienda', t => {
  const { sqlite, repo } = prepararDB(t);
  sembrar(repo, sqlite, 1, [art('1', 'GUI-1', 'Guitarra'), art('2', null, 'Cable')], [ex('1', '2.0000'), ex('2', '1.0000')]);
  sembrar(repo, sqlite, 2, [art('9', 'GUI-1', 'Guitarra'), art('8', null, 'Cable')], [ex('9', '1.5000'), ex('8', '4.0000')]);
  const r = consulta(sqlite);
  assert.deepEqual(r.tiendas.map(x => x.id), [1, 2]);
  const gui = r.renglones.find(x => x.clave === 'GUI-1');
  assert.equal(gui.total, '3.5000');
  assert.deepEqual(gui.por_tienda[1], { existencia: '2.0000', sin_confirmar_desde: null });
  assert.equal(gui.por_tienda[2].existencia, '1.5000');
  const cables = r.renglones.filter(x => x.descripcion === 'Cable');
  assert.equal(cables.length, 2);
  assert.deepEqual(cables.map(c => Object.keys(c.por_tienda).length), [1, 1]);
  assert.equal(r.pagina, 1);
  assert.equal(r.paginas, 1);
});

test('filtro solo: con (default), negativas y todas', t => {
  const { sqlite, repo } = prepararDB(t);
  sembrar(repo, sqlite, 1, [art('1', 'A', 'Uno'), art('2', 'B', 'Dos'), art('3', 'C', 'Tres'), art('4', 'D', 'Cuatro')],
    [ex('1', '2.0000'), ex('2', '0.0000'), ex('3', '-1.0000'), ex('4', '5.0000')]);
  sembrar(repo, sqlite, 2, [art('4', 'D', 'Cuatro')], [ex('4', '-2.0000')]);
  const claves = solo => consultarExistenciasSicar(sqlite, { q: '', solo, pagina: 1 }, AHORA).renglones.map(x => x.clave).sort();
  assert.deepEqual(claves('con'), ['A', 'D']);
  assert.deepEqual(claves(undefined), ['A', 'D']);
  assert.deepEqual(claves('negativas'), ['C', 'D']);
  assert.deepEqual(claves('todas'), ['A', 'B', 'C', 'D']);
  assert.deepEqual(claves('raro'), ['A', 'D']);
});

test('fila de 37 h queda fuera del total y marcada; la de 35 h cuenta', t => {
  const { sqlite, repo } = prepararDB(t);
  sembrar(repo, sqlite, 1, [art('1', 'A', 'Uno')], [ex('1', '2.0000')], { actualizado: hace(37) });
  sembrar(repo, sqlite, 2, [art('1', 'A', 'Uno')], [ex('1', '3.0000')], { actualizado: hace(35) });
  const fila = consulta(sqlite).renglones[0];
  assert.equal(fila.total, '3.0000');
  assert.equal(fila.por_tienda[1].sin_confirmar_desde, hace(37));
  assert.equal(fila.por_tienda[1].existencia, '2.0000');
  assert.equal(fila.por_tienda[2].sin_confirmar_desde, null);
});

test('busca sin acentos ni mayusculas, y % y _ son literales', t => {
  const { sqlite, repo } = prepararDB(t);
  sembrar(repo, sqlite, 1, [art('1', 'G1', 'Guitárra eléctrica'), art('2', '50%', 'Cuerda'), art('3', 'X_1', 'Otra'), art('4', 'XA1', 'Pedal')],
    [ex('1', '1.0000'), ex('2', '1.0000'), ex('3', '1.0000'), ex('4', '1.0000')]);
  const claves = q => consulta(sqlite, { q }).renglones.map(x => x.clave);
  assert.deepEqual(claves('guitarra'), ['G1']);
  assert.deepEqual(claves('GUITÁRRA'), ['G1']);
  assert.deepEqual(claves('%'), ['50%']);
  assert.deepEqual(claves('_'), ['X_1']);
  assert.deepEqual(claves('x_1'), ['X_1']);
  assert.deepEqual(claves('g1'), ['G1']);
});

test('sin_contacto_24h y ultimo_cambio por tienda', t => {
  const { sqlite, repo } = prepararDB(t);
  sembrar(repo, sqlite, 1, [art('1', 'A', 'Uno')], [ex('1', '1.0000')], { recepcion: hace(25), actualizado: hace(30) });
  sembrar(repo, sqlite, 2, [art('1', 'A', 'Uno')], [ex('1', '1.0000')], { recepcion: hace(23), actualizado: hace(2) });
  const [t1, t2] = consulta(sqlite).tiendas;
  assert.equal(t1.sin_contacto_24h, true);
  assert.equal(t1.ultimo_contacto, hace(25));
  assert.equal(t1.ultimo_cambio, hace(30));
  assert.equal(t2.sin_contacto_24h, false);
  assert.equal(consultarExistenciasSicar(sqlite, {}, AHORA, { 2: 'San Dos' }).tiendas[1].nombre, 'San Dos');
});

test('pagina de 50 en 50', t => {
  const { sqlite, repo } = prepararDB(t);
  const arts = Array.from({ length: 120 }, (_, i) => art(String(i + 1), `C${String(i).padStart(3, '0')}`, `Art ${i}`));
  for (let i = 0; i < 120; i += 60) {
    sembrar(repo, sqlite, 1, arts.slice(i, i + 60), arts.slice(i, i + 60).map(a => ex(a.art_id, '1.0000')));
  }
  const p3 = consulta(sqlite, { pagina: 3 });
  assert.equal(p3.paginas, 3);
  assert.equal(p3.renglones.length, 20);
  assert.equal(consulta(sqlite, { pagina: '2' }).renglones.length, 50);
  assert.equal(consulta(sqlite, { pagina: 99 }).pagina, 3);
  assert.equal(consulta(sqlite, { pagina: 'x' }).pagina, 1);
});

test('ruta: exige ver_existencias_sicar e ignora sucursal_id', async t => {
  process.env.DB_PATH = ':memory:';
  process.env.SENTRY_ENABLED = 'false';
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'sicar-existencias-desechable';
  const app = require('./server');
  const { obtenerConexionSqlite } = require('./persistencia');
  const { firmarToken } = require('./auth');
  const sqlite = obtenerConexionSqlite();
  t.after(() => sqlite.close());
  porTienda = {};
  const repo = crearRepositorioSicar(sqlite);
  // La ruta usa el reloj real: las marcas se siembran relativas a ahora, no a la fecha fija de AHORA.
  const reciente = new Date(Date.now() - 3600000).toISOString();
  const frescas = { actualizado: reciente, recepcion: reciente };
  sembrar(repo, sqlite, 1, [art('1', 'A', 'Uno')], [ex('1', '1.0000')], frescas);
  sembrar(repo, sqlite, 2, [art('1', 'A', 'Uno')], [ex('1', '2.0000')], frescas);
  const vecinos = ['ver_clientes_sicar', 'ver_sincronizacion_sicar'];
  for (const [id, permisos] of [[981, [...vecinos, 'ver_existencias_sicar']], [982, vecinos]]) {
    app.DB.admin.roles.push({ id, nombre: `Existencias ${id}`, permisos, modulos: ['sicar', 'inventario'] });
    app.DB.admin.usuarios.push({ id, nombre: 'Prueba', usuario: `exi${id}`, rol_id: id, sucursal_id: 1, activo: true });
  }
  const [con, sin] = [981, 982].map(id => firmarToken({ id, rol_id: id, sucursal_id: 1 }));
  const servidor = app.listen(0, '127.0.0.1');
  await new Promise(resolve => servidor.once('listening', resolve));
  t.after(async () => { servidor.closeAllConnections(); await new Promise(resolve => servidor.close(resolve)); });
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const pedir = (ruta, token) => fetch(base + ruta, { headers: { Authorization: `Bearer ${token}` } })
    .then(async r => ({ status: r.status, datos: await r.json() }));
  assert.equal((await pedir('/api/sicar/existencias', sin)).status, 403);
  assert.equal((await pedir('/api/sicar/existencias', 'basura')).status, 401);
  const a = await pedir('/api/sicar/existencias', con);
  const b = await pedir('/api/sicar/existencias?sucursal_id=2', con);
  assert.equal(a.status, 200);
  assert.deepEqual(b.datos, a.datos);
  assert.equal(a.datos.tiendas.length, 2);
  assert.equal(a.datos.renglones[0].total, '3.0000');
  assert.ok(a.datos.tiendas.every(x => typeof x.nombre === 'string' && x.nombre));
});
