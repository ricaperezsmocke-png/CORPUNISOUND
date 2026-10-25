const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { crearRepositorioSicar } = require('./sicarRepositorio');
const { consultarCortesSicar, listarPersonalSicar, asignarNombreSicar, centavosATexto } = require('./sicarCortes');

const HOY = '2026-10-23';
const TODAS = { verTodas: true, sucursalId: null };
const SOLO_1 = { verTodas: false, sucursalId: 1 };

let porTienda = {};
let lotes = 0;
function prepararDB(t) {
  porTienda = {};
  const sqlite = new Database(':memory:');
  t.after(() => sqlite.close());
  return { sqlite, repo: crearRepositorioSicar(sqlite) };
}
function sembrar(repo, sucursalId, cortes) {
  lotes += 1;
  porTienda[sucursalId] = (porTienda[sucursalId] || 0) + 1;
  repo.aplicarLote({ sucursalId, hash: `h${lotes}`, lote: { schema_version: 1, mapping_version: 'v', batch_id: `b${lotes}`,
    sequence: String(porTienda[sucursalId]), clientes: [], ventas: [], cortes } });
}
const cobro = (usu_id, ventas = 3, total = '300.00', canceladas = 0, total_canceladas = '0.00') =>
  ({ usu_id, ventas, total, canceladas, total_canceladas });
const corte = (cor_id, { usu_id = '14', diferencia = '-5.00', cobros = [], fecha = '2026-10-20T21:00:00', caj_id = '1' } = {}) => ({
  cor_id, caj_id, fecha_local: fecha, usu_id, contado: '100.00', calculado: '105.00', diferencia, retiro: '50.00',
  pagos: [{ tpa_id: '1', contado: '100.00', calculado: '105.00', diferencia, retiro: '50.00' }], cobros });
const consulta = (sqlite, filtros = {}, alcance = TODAS) => consultarCortesSicar(sqlite, filtros, alcance, HOY);
const persona = (r, sucursal_id, usu_id) => r.resumen.find(p => p.persona.sucursal_id === sucursal_id && p.persona.usu_id === usu_id);
const errorCon = status => e => e.status === status;

test('centavos a texto exacto con signo', () => {
  assert.equal(centavosATexto(-33), '-0.33');
  assert.equal(centavosATexto(-100), '-1.00');
  assert.equal(centavosATexto(0), '0.00');
  assert.equal(centavosATexto(5), '0.05');
  assert.equal(centavosATexto(123456), '1234.56');
  assert.equal(centavosATexto(9007199254740991n * 3n), '270215977642229.73');
});

test('un solo cobro: la diferencia es propia de quien cobro, no de quien cerro', t => {
  const { sqlite, repo } = prepararDB(t);
  sembrar(repo, 1, [corte('8006', { usu_id: '14', diferencia: '-5.00', cobros: [cobro('52', 4, '400.00', 1, '20.00')] })]);
  const r = consulta(sqlite);
  assert.equal(r.umbral, '1.00');
  assert.equal(r.cortes.length, 1);
  const c = r.cortes[0];
  assert.equal(c.atribucion, 'propia');
  assert.deepEqual(c.atribuida_a, { sucursal_id: 1, usu_id: '52', nombre: null });
  assert.deepEqual(c.cerro, { sucursal_id: 1, usu_id: '14', nombre: null });
  assert.deepEqual([c.contado, c.calculado, c.diferencia, c.retiro], ['100.00', '105.00', '-5.00', '50.00']);
  assert.deepEqual(c.pagos, [{ tpa_id: '1', contado: '100.00', calculado: '105.00', diferencia: '-5.00', retiro: '50.00' }]);
  assert.deepEqual(c.cobraron, [{ sucursal_id: 1, usu_id: '52', nombre: null, ventas: 4, total: '400.00', canceladas: 1,
    total_canceladas: '20.00' }]);
  assert.deepEqual([c.sucursal_id, c.cor_id, c.caj_id, c.fecha_local], [1, '8006', '1', '2026-10-20T21:00:00']);
  const p52 = persona(r, 1, '52'), p14 = persona(r, 1, '14');
  assert.deepEqual(p52, { persona: { sucursal_id: 1, usu_id: '52', nombre: null }, turnos_cobro: 1, ventas: 4, total: '400.00',
    turnos_cerro: 0, diferencia_propia: '-5.00', faltantes_propios: 1, sobrantes_propios: 0, diferencia_compartida: '0.00' });
  assert.equal(p14.turnos_cerro, 1);
  assert.equal(p14.diferencia_propia, '0.00');
  assert.equal(p14.faltantes_propios, 0);
  assert.equal(p14.turnos_cobro, 0);
});

test('dos cobros con ventas: compartida, nadie con faltante, ambos con diferencia compartida', t => {
  const { sqlite, repo } = prepararDB(t);
  sembrar(repo, 1, [corte('1', { usu_id: '52', diferencia: '-7.50', cobros: [cobro('52'), cobro('7', 1, '50.00')] })]);
  const r = consulta(sqlite);
  assert.equal(r.cortes[0].atribucion, 'compartida');
  assert.equal(r.cortes[0].atribuida_a, null);
  for (const usu of ['52', '7']) {
    const p = persona(r, 1, usu);
    assert.equal(p.diferencia_compartida, '-7.50', usu);
    assert.equal(p.diferencia_propia, '0.00', usu);
    assert.equal(p.faltantes_propios, 0, usu);
    assert.equal(p.turnos_cobro, 1, usu);
  }
  assert.equal(persona(r, 1, '52').turnos_cerro, 1);
});

test('cobro sin usuario registrado mas uno con usuario: compartida; solo ventas sin usuario: sin_usuario', t => {
  const { sqlite, repo } = prepararDB(t);
  sembrar(repo, 1, [corte('1', { cobros: [cobro(null, 2, '80.00'), cobro('52')] }), corte('2', { cobros: [cobro(null, 2, '80.00')] })]);
  const r = consulta(sqlite);
  const [c1, c2] = ['1', '2'].map(id => r.cortes.find(c => c.cor_id === id));
  assert.equal(c1.atribucion, 'compartida');
  assert.ok(c1.cobraron.some(p => p.usu_id === '' && p.nombre === null));
  assert.equal(persona(r, 1, '52').faltantes_propios, 0);
  assert.equal(persona(r, 1, '52').diferencia_compartida, '-5.00');
  assert.equal(c2.atribucion, 'sin_usuario', 'solo ventas sin usuario: no hay a quien atribuir');
  assert.equal(c2.atribuida_a, null);
  assert.equal(persona(r, 1, '52').diferencia_compartida, '-5.00', 'el turno sin usuario no se le suma a nadie con usu_id');
  assert.equal(persona(r, 1, '52').diferencia_propia, '0.00');
  const sinUsuario = persona(r, 1, '');
  assert.equal(sinUsuario.diferencia_compartida, '-10.00', 'solo en la fila de ventas sin usuario registrado');
  assert.equal(sinUsuario.diferencia_propia, '0.00');
  assert.equal(sinUsuario.faltantes_propios, 0);
  assert.equal(sinUsuario.turnos_cobro, 2);
});

test('sin ventas: sin_ventas, aunque haya un renglon con solo canceladas', t => {
  const { sqlite, repo } = prepararDB(t);
  sembrar(repo, 1, [corte('1', { cobros: [] }), corte('2', { cobros: [cobro('52', 0, '0.00', 2, '90.00')] })]);
  const r = consulta(sqlite);
  for (const c of r.cortes) {
    assert.equal(c.atribucion, 'sin_ventas', c.cor_id);
    assert.equal(c.atribuida_a, null);
  }
  assert.equal(persona(r, 1, '52').faltantes_propios, 0);
  assert.equal(persona(r, 1, '52').turnos_cobro, 0);
});

test('umbral de $1: centavos no cuentan como faltante ni sobrante, -1.00 y +1.00 si', t => {
  const { sqlite, repo } = prepararDB(t);
  sembrar(repo, 1, [
    corte('1', { diferencia: '-0.33', cobros: [cobro('52')] }),
    corte('2', { diferencia: '-1.00', cobros: [cobro('52')] }),
    corte('3', { diferencia: '0.50', cobros: [cobro('52')] }),
    corte('4', { diferencia: '1.00', cobros: [cobro('52')] }),
    corte('5', { diferencia: '-0.99', cobros: [cobro('52')] }),
  ]);
  const p = persona(consulta(sqlite), 1, '52');
  assert.equal(p.faltantes_propios, 1);
  assert.equal(p.sobrantes_propios, 1);
  assert.equal(p.diferencia_propia, '-0.82');
  assert.equal(p.turnos_cobro, 5);
});

test('resumen agrupa por tienda y usu_id: dos usuarios con el mismo nombre no se suman', t => {
  const { sqlite, repo } = prepararDB(t);
  sembrar(repo, 1, [corte('1', { diferencia: '-2.00', cobros: [cobro('52')] }), corte('2', { diferencia: '-3.00', cobros: [cobro('7')] })]);
  sembrar(repo, 2, [corte('1', { diferencia: '-4.00', cobros: [cobro('52')] })]);
  for (const [s, u] of [[1, '52'], [1, '7'], [2, '52']]) {
    asignarNombreSicar(sqlite, { sucursal_id: s, usu_id: u, nombre: 'Ana' }, '1', TODAS);
  }
  const r = consulta(sqlite);
  assert.equal(persona(r, 1, '52').diferencia_propia, '-2.00');
  assert.equal(persona(r, 1, '7').diferencia_propia, '-3.00');
  assert.equal(persona(r, 2, '52').diferencia_propia, '-4.00');
  assert.equal(persona(r, 1, '52').persona.nombre, 'Ana');
  assert.equal(r.resumen.filter(p => p.persona.nombre === 'Ana').length, 3);
});

test('filtros: ultimos 30 dias por defecto, desde/hasta, caja y persona', t => {
  const { sqlite, repo } = prepararDB(t);
  sembrar(repo, 1, [
    corte('1', { fecha: '2026-09-23T23:59:59', cobros: [cobro('52')] }),
    corte('2', { fecha: '2026-09-24T00:00:00', cobros: [cobro('52')] }),
    corte('3', { fecha: '2026-10-23T22:00:00', caj_id: '2', usu_id: '9', cobros: [cobro('7')] }),
  ]);
  const ids = filtros => consulta(sqlite, filtros).cortes.map(c => c.cor_id).sort();
  assert.deepEqual(ids({}), ['2', '3']);
  assert.deepEqual(ids({ desde: '2026-09-01', hasta: '2026-09-30' }), ['1', '2']);
  assert.deepEqual(ids({ desde: '2026-09-01', caj_id: '2' }), ['3']);
  assert.deepEqual(ids({ desde: '2026-09-01', usu_id: '7' }), ['3']);
  assert.deepEqual(ids({ desde: '2026-09-01', usu_id: '9' }), ['3'], 'tambien quien cerro');
  assert.deepEqual(ids({ desde: '2026-09-01', usu_id: '52' }), ['1', '2']);
  assert.deepEqual(ids({ desde: '', hasta: '' }), ['2', '3']);
  assert.throws(() => consulta(sqlite, { desde: '2026-13-01' }), errorCon(400));
  // Tope de rango: 366 dias de diferencia pasa (2025-10-22), 367 no; tambien con solo desde (hasta = hoy).
  assert.doesNotThrow(() => consulta(sqlite, { desde: '2025-10-22', hasta: '2026-10-23' }));
  assert.throws(() => consulta(sqlite, { desde: '2025-10-21', hasta: '2026-10-23' }), /366 d/);
  assert.throws(() => consulta(sqlite, { desde: '2020-01-01' }), errorCon(400));
  assert.throws(() => consulta(sqlite, { hasta: 'ayer' }), errorCon(400));
  assert.throws(() => consulta(sqlite, { sucursal_id: 'x' }), errorCon(400));
  assert.throws(() => consulta(sqlite, { caj_id: ['1', '2'] }), errorCon(400));
});

test('alcance: sin ver todas solo su tienda; el filtro de tienda se interseca, nunca amplia', t => {
  const { sqlite, repo } = prepararDB(t);
  sembrar(repo, 1, [corte('1', { cobros: [cobro('52')] })]);
  sembrar(repo, 2, [corte('9', { cobros: [cobro('52')] })]);
  const tiendas = (filtros, alcance) => consulta(sqlite, filtros, alcance).cortes.map(c => c.sucursal_id);
  assert.deepEqual(tiendas({}, SOLO_1), [1]);
  assert.deepEqual(tiendas({ sucursal_id: '2' }, SOLO_1), []);
  assert.deepEqual(consulta(sqlite, { sucursal_id: 2 }, SOLO_1).resumen, []);
  assert.deepEqual(tiendas({ sucursal_id: '1' }, SOLO_1), [1]);
  assert.deepEqual(tiendas({ sucursal_id: '2' }, TODAS), [2]);
  assert.deepEqual(tiendas({}, TODAS).sort(), [1, 2]);
  assert.throws(() => consulta(sqlite, {}, { verTodas: false, sucursalId: NaN }), errorCon(403));
  assert.throws(() => consulta(sqlite, {}, { verTodas: false, sucursalId: 0 }), errorCon(403));
});

test('personal: usu_id vistos en cortes o cobros, sin vacio, con turnos, ultimo e historial, por alcance', t => {
  const { sqlite, repo } = prepararDB(t);
  sembrar(repo, 1, [
    corte('1', { usu_id: '14', fecha: '2026-10-01T20:00:00', cobros: [cobro('52'), cobro(null)] }),
    corte('2', { usu_id: null, fecha: '2026-10-05T20:00:00', cobros: [cobro('52')] }),
  ]);
  sembrar(repo, 2, [corte('1', { usu_id: '3', fecha: '2026-10-02T20:00:00' })]);
  asignarNombreSicar(sqlite, { sucursal_id: 1, usu_id: '52', nombre: 'Ana' }, '9', TODAS);
  const lista = listarPersonalSicar(sqlite, TODAS);
  assert.deepEqual(lista.map(p => [p.sucursal_id, p.usu_id]), [[1, '14'], [1, '52'], [2, '3']]);
  const ana = lista.find(p => p.usu_id === '52');
  assert.equal(ana.nombre, 'Ana');
  assert.equal(ana.turnos, 2);
  assert.equal(ana.ultimo, '2026-10-05T20:00:00');
  assert.equal(ana.historial.length, 1);
  assert.equal(lista.find(p => p.usu_id === '14').nombre, null);
  assert.deepEqual(listarPersonalSicar(sqlite, SOLO_1).map(p => p.sucursal_id), [1, 1]);
  assert.throws(() => listarPersonalSicar(sqlite, { verTodas: false, sucursalId: NaN }), errorCon(403));
});

test('asignar nombre: valida, exige que el usuario exista en esa tienda, alcance y deja historial', t => {
  const { sqlite, repo } = prepararDB(t);
  sembrar(repo, 1, [corte('1', { usu_id: '14', diferencia: '-3.00', cobros: [cobro('52')] })]);
  sembrar(repo, 2, [corte('1', { usu_id: '3' })]);
  const asignar = (datos, alcance = TODAS) => asignarNombreSicar(sqlite, datos, '9', alcance);
  const invisibles = ['\u200B', '\u200D', '\u200F', '\u202A', '\u202C', '\u202E', '\u2066', '\u2069',
    '\u00ad', '\u180e', '\u2060', '\u2061', '\u2062', '\u2063', '\u2064', '\ufeff'].map(x => `Ana${x}Ruiz`);
  for (const nombre of ['a', ' a ', 'x\u0000y', 'Ana\u0007', 'An\uFFFDa', 'A\u2028b', ...invisibles, 'x'.repeat(81), '', 5, null, undefined]) {
    assert.throws(() => asignar({ sucursal_id: 1, usu_id: '52', nombre }), errorCon(400), JSON.stringify(nombre));
  }
  assert.throws(() => asignar({ sucursal_id: 'x', usu_id: '52', nombre: 'Ana' }), errorCon(400));
  assert.throws(() => asignar({ sucursal_id: 1, usu_id: '', nombre: 'Ana' }), errorCon(404));
  assert.throws(() => asignar({ sucursal_id: 1, usu_id: '3', nombre: 'Ana' }), errorCon(404), 'el 3 es de la tienda 2');
  assert.throws(() => asignar({ sucursal_id: 2, usu_id: '3', nombre: 'Ana' }, SOLO_1), errorCon(403));
  assert.equal(sqlite.prepare('SELECT count(*) n FROM sicar_cajeros_historial').get().n, 0);
  const r1 = asignar({ sucursal_id: '1', usu_id: '52', nombre: '  Ana López  ' }, SOLO_1);
  assert.equal(r1.nombre, 'Ana López');
  assert.equal(r1.sucursal_id, 1);
  asignar({ sucursal_id: 1, usu_id: '52', nombre: 'Ana María López' });
  asignar({ sucursal_id: 1, usu_id: '14', nombre: 'x'.repeat(80) });
  const hist = sqlite.prepare('SELECT * FROM sicar_cajeros_historial WHERE usu_id=? ORDER BY id').all('52');
  assert.deepEqual(hist.map(h => [h.sucursal_id, h.nombre_anterior, h.nombre_nuevo, h.actor]),
    [[1, null, 'Ana López', '9'], [1, 'Ana López', 'Ana María López', '9']]);
  assert.ok(hist.every(h => !Number.isNaN(Date.parse(h.fecha))));
  const fila = sqlite.prepare('SELECT * FROM sicar_cajeros WHERE usu_id=?').get('52');
  assert.equal(fila.asignado_por, '9');
  const c = consulta(sqlite, { sucursal_id: 1 }).cortes[0];
  assert.deepEqual(c.atribuida_a, { sucursal_id: 1, usu_id: '52', nombre: 'Ana María López' });
  assert.equal(c.cerro.nombre, 'x'.repeat(80));
  const p = listarPersonalSicar(sqlite, SOLO_1).find(x => x.usu_id === '52');
  assert.deepEqual(p.historial.map(h => h.nombre_nuevo), ['Ana María López', 'Ana López']);
  // Quien hizo el cambio: su nombre en CORPUNISOUND; si no se encuentra, "usuario N".
  assert.deepEqual(p.historial.map(h => h.actor_nombre), ['usuario 9', 'usuario 9']);
  const conNombre = listarPersonalSicar(sqlite, SOLO_1, id => (id === '9' ? 'Victor Pérez' : null)).find(x => x.usu_id === '52');
  assert.deepEqual(conNombre.historial.map(h => [h.actor, h.actor_nombre]), [['9', 'Victor Pérez'], ['9', 'Victor Pérez']]);
});

test('rutas: permisos separados, alcance del token y nunca del filtro', async t => {
  process.env.DB_PATH = ':memory:';
  process.env.SENTRY_ENABLED = 'false';
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'sicar-cortes-desechable';
  const app = require('./server');
  const { obtenerConexionSqlite } = require('./persistencia');
  const { firmarToken } = require('./auth');
  const sqlite = obtenerConexionSqlite();
  t.after(() => sqlite.close());
  porTienda = {};
  const repo = crearRepositorioSicar(sqlite);
  const hoy = require('./fechas').fechaLocal();
  sembrar(repo, 1, [corte('1', { fecha: `${hoy}T10:00:00`, cobros: [cobro('52')] })]);
  sembrar(repo, 2, [corte('7', { fecha: `${hoy}T11:00:00`, usu_id: '3', cobros: [cobro('3')] })]);
  const vecinos = ['dar_alta_personal', 'activar_pantallas_caja'];
  const roles = {
    991: [...vecinos, 'ver_cortes_sicar'],
    992: [...vecinos, 'asignar_cajeros_sicar'],
    993: [...vecinos, 'ver_cortes_sicar', 'asignar_cajeros_sicar'],
    994: [...vecinos, 'ver_cortes_sicar', 'asignar_cajeros_sicar', 'ver_todas_las_sucursales'],
  };
  for (const [id, permisos] of Object.entries(roles)) {
    app.DB.admin.roles.push({ id: Number(id), nombre: `Cortes ${id}`, permisos, modulos: ['admin'] });
    app.DB.admin.usuarios.push({ id: Number(id), nombre: `Prueba ${id}`, usuario: `cor${id}`, rol_id: Number(id), sucursal_id: 1, activo: true });
  }
  const token = id => firmarToken({ id, rol_id: id, sucursal_id: 1 });
  const servidor = app.listen(0, '127.0.0.1');
  await new Promise(resolve => servidor.once('listening', resolve));
  t.after(async () => { servidor.closeAllConnections(); await new Promise(resolve => servidor.close(resolve)); });
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const pedir = (ruta, id, opciones = {}) => fetch(base + ruta, { ...opciones,
    headers: { Authorization: `Bearer ${token(id)}`, 'Content-Type': 'application/json' } })
    .then(async r => ({ status: r.status, datos: await r.json() }));
  const poner = (ruta, id, body) => pedir(ruta, id, { method: 'PUT', body: JSON.stringify(body) });

  assert.equal((await pedir('/api/sicar/cortes', 992)).status, 403);
  assert.equal((await pedir('/api/sicar/personal', 992)).status, 403);
  const propia = await pedir('/api/sicar/cortes', 991);
  assert.equal(propia.status, 200);
  assert.deepEqual(propia.datos.cortes.map(c => c.sucursal_id), [1]);
  assert.equal(propia.datos.umbral, '1.00');
  const ajena = await pedir('/api/sicar/cortes?sucursal_id=2', 991);
  assert.equal(ajena.status, 200);
  assert.deepEqual(ajena.datos.cortes, []);
  assert.deepEqual(ajena.datos.resumen, []);
  assert.deepEqual((await pedir('/api/sicar/cortes?sucursal_id=2', 994)).datos.cortes.map(c => c.cor_id), ['7']);
  assert.equal((await pedir('/api/sicar/cortes', 994)).datos.cortes.length, 2);
  assert.equal((await pedir('/api/sicar/cortes?desde=basura', 994)).status, 400);
  const largo = await pedir('/api/sicar/cortes?desde=2020-01-01&hasta=2026-01-01', 994);
  assert.equal(largo.status, 400);
  assert.match(largo.datos.error, /366 d/);
  assert.deepEqual((await pedir('/api/sicar/personal', 991)).datos.map(p => p.sucursal_id), [1, 1]);

  assert.equal((await poner('/api/sicar/personal/1/52', 991, { nombre: 'Ana' })).status, 403, 'ver no da para asignar');
  assert.equal((await poner('/api/sicar/personal/2/3', 993, { nombre: 'Beto' })).status, 403, 'otra tienda');
  assert.equal((await poner('/api/sicar/personal/1/52', 993, { nombre: 'a' })).status, 400);
  assert.equal((await poner('/api/sicar/personal/1/52', 993, { nombre: 'A\u0000na' })).status, 400);
  assert.equal((await poner('/api/sicar/personal/1/999', 993, { nombre: 'Nadie' })).status, 404);
  const ok = await poner('/api/sicar/personal/1/52', 993, { nombre: 'Ana' });
  assert.equal(ok.status, 200);
  assert.equal(ok.datos.nombre, 'Ana');
  assert.equal(ok.datos.asignado_por, '993');
  assert.equal((await poner('/api/sicar/personal/2/3', 994, { nombre: 'Beto' })).status, 200);
  const cortes = (await pedir('/api/sicar/cortes', 994)).datos.cortes;
  assert.equal(cortes.find(c => c.sucursal_id === 1).atribuida_a.nombre, 'Ana');
  assert.equal(cortes.find(c => c.sucursal_id === 2).cerro.nombre, 'Beto');
  const hist = sqlite.prepare('SELECT actor, nombre_nuevo FROM sicar_cajeros_historial ORDER BY id').all();
  assert.deepEqual(hist, [{ actor: '993', nombre_nuevo: 'Ana' }, { actor: '994', nombre_nuevo: 'Beto' }]);
  // El historial trae el nombre de quien hizo el cambio, resuelto de la base principal de usuarios.
  const personal = (await pedir('/api/sicar/personal', 994)).datos;
  const historialDe = (s, u) => personal.find(p => p.sucursal_id === s && p.usu_id === u).historial;
  assert.deepEqual(historialDe(1, '52').map(h => [h.actor, h.actor_nombre]), [['993', 'Prueba 993']]);
  assert.deepEqual(historialDe(2, '3').map(h => [h.actor, h.actor_nombre]), [['994', 'Prueba 994']]);
  sqlite.prepare("UPDATE sicar_cajeros_historial SET actor = '123456' WHERE actor = '993'").run();
  const sinCuenta = (await pedir('/api/sicar/personal', 994)).datos.find(p => p.usu_id === '52').historial;
  assert.equal(sinCuenta[0].actor_nombre, 'usuario 123456');
});

test('permisos nuevos en el catalogo, modulo admin', () => {
  const { PERMISOS } = require('./permisosCatalogo');
  for (const clave of ['ver_cortes_sicar', 'asignar_cajeros_sicar']) {
    const p = PERMISOS.find(x => x.clave === clave);
    assert.ok(p, clave);
    assert.equal(p.modulo, 'admin');
    assert.equal(p.implementado, true);
  }
});
