const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { crearRepositorioSicar } = require('./sicarRepositorio');
const { consultarTraspasosSicar, listarMapaSicar, asignarMapaSicar } = require('./sicarTraspasos');

const HOY = '2026-10-23';
const TODAS = { verTodas: true, sucursalId: null };
const SOLO = id => ({ verTodas: false, sucursalId: id });
const NOMBRES = { 1: 'CEDIS', 2: 'Ocosingo' };
const errorCon = status => e => e.status === status;

let porTienda = {};
let lotes = 0;
function prepararDB(t) {
  porTienda = {};
  const sqlite = new Database(':memory:');
  t.after(() => sqlite.close());
  return { sqlite, repo: crearRepositorioSicar(sqlite) };
}
function sembrar(repo, sucursalId, traspasos) {
  lotes += 1;
  porTienda[sucursalId] = (porTienda[sucursalId] || 0) + 1;
  repo.aplicarLote({ sucursalId, hash: `h${lotes}`, lote: { schema_version: 1, mapping_version: 'v', batch_id: `b${lotes}`,
    sequence: String(porTienda[sucursalId]), clientes: [], ventas: [], traspasos } });
}
const det = (art_id, cantidad) => ({ art_id, cantidad, precio_sin: '10.00', precio_con: '11.60' });
const tra = (tra_id, folio, extra = {}) => ({ tra_id, folio, suc_origen: '6', suc_destino: '2', fecha: '2026-10-18', estado: 'enviado',
  fecha_aplicado: null, fecha_cancelado: null, total: '100.00', detalle: [det('10', '5.0000'), det('11', '2.0000')], ...extra });
function escenario(t, conMapa = true) {
  const { sqlite, repo } = prepararDB(t);
  for (const id of [1, 2, 3]) sqlite.prepare('INSERT OR IGNORE INTO sicar_tiendas (sucursal_id) VALUES (?)').run(id);
  sembrar(repo, 1, [
    tra('10', 'F1'),
    tra('11', 'F2', { suc_destino: '3', fecha: '2026-10-22' }),
    tra('12', 'F3', { estado: 'cancelado', fecha_cancelado: '2026-10-19' }),
    tra('13', 'F4', { fecha: '2026-10-10' }),
  ]);
  sembrar(repo, 2, [tra('20', 'F1', { estado: 'recibido', fecha_aplicado: '2026-10-19T09:00:00', detalle: [det('10', '4.0000')] })]);
  sembrar(repo, 3, [tra('30', 'F9', { suc_origen: '7', suc_destino: '3', fecha: '2026-10-01' })]);
  if (conMapa) {
    sqlite.prepare("INSERT INTO sicar_sucursales_mapa (sicar_sucursal, sucursal_id) VALUES ('6', 1), ('2', 2)").run();
  }
  return sqlite;
}
const consulta = (sqlite, filtros = {}, alcance = TODAS) => consultarTraspasosSicar(sqlite, filtros, alcance, NOMBRES, HOY);
const ids = r => r.traspasos.map(x => `${x.sucursal_id}:${x.tra_id}`).sort();

test('alcance: sin ver todas solo la tienda del token, y el filtro de tienda no existe', t => {
  const sqlite = escenario(t);
  assert.deepEqual(ids(consulta(sqlite, {}, SOLO(1))), ['1:10', '1:11', '1:12', '1:13']);
  assert.deepEqual(ids(consulta(sqlite, {}, SOLO(2))), ['2:20']);
  assert.deepEqual(ids(consulta(sqlite, { sucursal_id: 3 }, SOLO(2))), ['2:20'], 'un filtro ajeno no amplia el alcance');
  assert.deepEqual(ids(consulta(sqlite)), ['1:10', '1:11', '1:12', '1:13', '2:20', '3:30']);
  for (const malo of [null, { verTodas: false, sucursalId: null }, { verTodas: false, sucursalId: 0 }]) {
    assert.throws(() => consulta(sqlite, {}, malo), errorCon(403));
  }
});

test('nombres de tienda por el mapa y "SICAR N" si no esta', t => {
  const sqlite = escenario(t);
  const r = consulta(sqlite);
  const f1 = r.traspasos.find(x => x.tra_id === '10');
  assert.deepEqual([f1.origen, f1.destino], ['CEDIS', 'Ocosingo']);
  const f9 = r.traspasos.find(x => x.tra_id === '30');
  assert.deepEqual([f9.origen, f9.destino], ['SICAR 7', 'SICAR 3']);
  const sinMapa = consulta(escenario(t, false)).traspasos.find(x => x.tra_id === '10');
  assert.deepEqual([sinMapa.origen, sinMapa.destino], ['SICAR 6', 'SICAR 2']);
});

test('alertas: sin recibir mas de 3 dias, cancelado, y dias en transito', t => {
  const r = consulta(escenario(t), {}, SOLO(1));
  const por = id => r.traspasos.find(x => x.tra_id === id);
  assert.equal(por('13').dias_en_transito, 13);
  assert.equal(por('13').alertas.sin_recibir_3_dias, true);
  assert.equal(por('11').dias_en_transito, 1);
  assert.equal(por('11').alertas.sin_recibir_3_dias, false);
  assert.equal(por('12').alertas.cancelado, true);
  assert.equal(por('12').alertas.sin_recibir_3_dias, false);
  assert.equal(por('12').dias_en_transito, null);
  assert.equal(por('10').alertas.sin_recibir_3_dias, false, 'la otra punta ya lo recibio');
  const recibido = consulta(escenario(t), {}, SOLO(2)).traspasos[0];
  assert.equal(recibido.dias_en_transito, 1);
  assert.equal(recibido.total, '100.00');
});

test('diferencias por articulo entre enviado y recibido, exactas y solo con mapa y dos puntas', t => {
  const sqlite = escenario(t);
  const esperadas = [{ art_id: '10', enviado: '5.0000', recibido: '4.0000', diferencia: '-1.0000' },
    { art_id: '11', enviado: '2.0000', recibido: '0.0000', diferencia: '-2.0000' }];
  for (const [alcance, id] of [[SOLO(1), '10'], [SOLO(2), '20']]) {
    const f = consulta(sqlite, {}, alcance).traspasos.find(x => x.tra_id === id);
    assert.equal(f.conciliacion, 'dos_puntas');
    assert.deepEqual(f.diferencias, esperadas);
    assert.equal(f.alertas.con_diferencias, true);
  }
  const una = consulta(sqlite, {}, SOLO(1)).traspasos.find(x => x.tra_id === '13');
  assert.deepEqual([una.conciliacion, una.diferencias], ['una_punta', []]);
  const sinMapa = consulta(escenario(t, false), {}, SOLO(1)).traspasos.find(x => x.tra_id === '10');
  assert.deepEqual([sinMapa.conciliacion, sinMapa.diferencias], ['sin_mapa', []]);
  sqlite.prepare("UPDATE sicar_traspasos_detalle SET cantidad = '5.0000' WHERE sucursal_id = 2").run();
  sqlite.prepare("INSERT INTO sicar_traspasos_detalle VALUES (2, '20', '11', '2.0000', 1000, 1160)").run();
  assert.deepEqual(consulta(sqlite, {}, SOLO(1)).traspasos.find(x => x.tra_id === '10').diferencias, []);
});

test('filtros: estado, fechas y tope de 366 dias', t => {
  const sqlite = escenario(t);
  assert.deepEqual(ids(consulta(sqlite, { estado: 'cancelado' })), ['1:12']);
  assert.deepEqual(ids(consulta(sqlite, { desde: '2026-10-20', hasta: '2026-10-23' })), ['1:11']);
  assert.throws(() => consulta(sqlite, { estado: 'raro' }), errorCon(400));
  assert.throws(() => consulta(sqlite, { desde: 'basura' }), errorCon(400));
  assert.throws(() => consulta(sqlite, { desde: ['2026-10-01'] }), errorCon(400));
  assert.throws(() => consulta(sqlite, { desde: '2020-01-01', hasta: '2026-01-01' }), /366 d/);
});

test('mapa: solo con alcance total, valida, guarda historial y no repite cambios', t => {
  const { sqlite } = prepararDB(t);
  const existe = id => id === 1 || id === 2;
  const poner = (datos, alcance = TODAS, actor = '77') => asignarMapaSicar(sqlite, datos, actor, alcance, existe);
  assert.throws(() => poner({ sicar_sucursal: '6', sucursal_id: 1 }, SOLO(1)), errorCon(403));
  for (const malo of [null, [], { sicar_sucursal: 'x', sucursal_id: 1 }, { sicar_sucursal: '0', sucursal_id: 1 },
    { sicar_sucursal: '6', sucursal_id: 'abc' }, { sicar_sucursal: '6', sucursal_id: 0 }, { sicar_sucursal: '6', sucursal_id: true },
    { sicar_sucursal: '6', sucursal_id: 99 }, { sicar_sucursal: '6' }]) {
    assert.throws(() => poner(malo), errorCon(400));
  }
  assert.throws(() => poner({ sicar_sucursal: '6', sucursal_id: 1 }, TODAS, ''), errorCon(401));
  assert.equal(poner({ sicar_sucursal: 6, sucursal_id: 1 }).asignado_por, '77');
  poner({ sicar_sucursal: '6', sucursal_id: 1 }, TODAS, '88');
  poner({ sicar_sucursal: '6', sucursal_id: 2 }, TODAS, '88');
  poner({ sicar_sucursal: '6', sucursal_id: null }, TODAS, '99');
  const hist = sqlite.prepare('SELECT sicar_sucursal, anterior, nuevo, actor FROM sicar_sucursales_mapa_historial ORDER BY id').all();
  assert.deepEqual(hist, [{ sicar_sucursal: '6', anterior: null, nuevo: '1', actor: '77' },
    { sicar_sucursal: '6', anterior: '1', nuevo: '2', actor: '88' }, { sicar_sucursal: '6', anterior: '2', nuevo: null, actor: '99' }]);
  poner({ sicar_sucursal: '2', sucursal_id: 2 });
  const lista = listarMapaSicar(sqlite, NOMBRES);
  assert.deepEqual(lista.map(m => [m.sicar_sucursal, m.sucursal_id, m.tienda]), [['2', 2, 'Ocosingo'], ['6', null, null]]);
});

test('rutas: permisos exactos con roles vecinos y alcance del token', async t => {
  process.env.DB_PATH = ':memory:';
  process.env.SENTRY_ENABLED = 'false';
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'sicar-traspasos-desechable';
  const app = require('./server');
  const { obtenerConexionSqlite } = require('./persistencia');
  const { firmarToken } = require('./auth');
  const sqlite = obtenerConexionSqlite();
  t.after(() => sqlite.close());
  porTienda = {};
  const repo = crearRepositorioSicar(sqlite);
  const hoy = require('./fechas').fechaLocal();
  sembrar(repo, 1, [tra('10', 'F1', { fecha: hoy })]);
  sembrar(repo, 2, [tra('20', 'F2', { fecha: hoy })]);
  const vecinos = ['ver_existencias_sicar', 'realizar_traspasos', 'ver_cortes_sicar', 'ver_facturas_por_llegar', 'recibir_compra'];
  const roles = {
    971: [...vecinos, 'ver_traspasos_sicar'],
    972: vecinos,
    973: [...vecinos, 'ver_traspasos_sicar', 'administrar_sucursales', 'ver_todas_las_sucursales'],
    974: [...vecinos, 'ver_traspasos_sicar', 'administrar_sucursales'],
    975: [...vecinos, 'administrar_sucursales'],
  };
  for (const [id, permisos] of Object.entries(roles)) {
    app.DB.admin.roles.push({ id: Number(id), nombre: `Traspasos ${id}`, permisos, modulos: ['sicar', 'inventario', 'admin'] });
    app.DB.admin.usuarios.push({ id: Number(id), nombre: `Prueba ${id}`, usuario: `tra${id}`, rol_id: Number(id), sucursal_id: 1, activo: true });
  }
  const servidor = app.listen(0, '127.0.0.1');
  await new Promise(resolve => servidor.once('listening', resolve));
  t.after(async () => { servidor.closeAllConnections(); await new Promise(resolve => servidor.close(resolve)); });
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const pedir = (ruta, id, opciones = {}) => fetch(base + ruta, { ...opciones,
    headers: { Authorization: `Bearer ${firmarToken({ id, rol_id: id, sucursal_id: 1 })}`, 'Content-Type': 'application/json' } })
    .then(async r => ({ status: r.status, datos: await r.json() }));
  const poner = (id, body) => pedir('/api/sicar/sucursales-mapa', id, { method: 'PUT', body: JSON.stringify(body) });

  for (const id of [972, 975]) {
    assert.equal((await pedir('/api/sicar/traspasos', id)).status, 403, `vecino ${id}`);
    assert.equal((await pedir('/api/sicar/sucursales-mapa', id)).status, 403, `vecino ${id}`);
  }
  assert.equal((await pedir('/api/sicar/traspasos', 971)).status, 200);
  const propia = await pedir('/api/sicar/traspasos?sucursal_id=2', 971);
  assert.deepEqual(propia.datos.traspasos.map(x => x.sucursal_id), [1]);
  assert.equal((await pedir('/api/sicar/traspasos', 973)).datos.traspasos.length, 2);
  assert.equal((await pedir('/api/sicar/traspasos?estado=raro', 973)).status, 400);
  assert.equal((await pedir('/api/sicar/traspasos?desde=2020-01-01&hasta=2026-01-01', 973)).status, 400);

  assert.equal((await poner(971, { sicar_sucursal: '6', sucursal_id: 1 })).status, 403, 'ver no da para cambiar');
  assert.equal((await poner(972, { sicar_sucursal: '6', sucursal_id: 1 })).status, 403);
  assert.equal((await poner(974, { sicar_sucursal: '6', sucursal_id: 1 })).status, 403, 'sin alcance total no se cambia el mapa global');
  assert.equal((await poner(973, { sicar_sucursal: '6', sucursal_id: 9999 })).status, 400);
  const ok = await poner(973, { sicar_sucursal: '6', sucursal_id: 1 });
  assert.equal(ok.status, 200);
  assert.equal(ok.datos.asignado_por, '973');
  const mapa = await pedir('/api/sicar/sucursales-mapa', 971);
  assert.deepEqual(mapa.datos.mapa.map(m => [m.sicar_sucursal, m.sucursal_id]), [['6', 1]]);
  assert.ok(mapa.datos.mapa[0].tienda);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM sicar_sucursales_mapa_historial').get().n, 1);
  assert.equal((await pedir('/api/sicar/traspasos', 'basura')).status, 401);
});

test('permiso nuevo en el catalogo, modulo inventario', () => {
  const p = require('./permisosCatalogo').PERMISOS.find(x => x.clave === 'ver_traspasos_sicar');
  assert.ok(p);
  assert.equal(p.modulo, 'inventario');
  assert.equal(p.implementado, true);
});
