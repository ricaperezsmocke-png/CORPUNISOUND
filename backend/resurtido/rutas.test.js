const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
process.env.DB_PATH = ':memory:'; process.env.JWT_SECRET = 'resurtido-rutas-prueba';
process.env.NODE_ENV = 'test'; process.env.SENTRY_ENABLED = 'false';
const app = require('../server');
const { obtenerConexionSqlite } = require('../persistencia');
const { firmarToken } = require('../auth');
const sqlite = obtenerConexionSqlite(), tokens = {};
let servidor, base;

before(async () => {
  const comunes = ['ver_resurtido', 'corregir_minimos_resurtido', 'configurar_resurtido'];
  for (const [id, permisos, suc] of [[981, ['ver_existencias_sicar', 'gestionar_seguimiento_facturas'], 3],
    [982, ['ver_resurtido', 'ver_existencias_sicar'], 3], [983, comunes, 3],
    [984, [...comunes, 'ver_todas_las_sucursales'], 1], [985, comunes, null]]) {
    app.DB.admin.roles.push({ id, nombre: `Resurtido ${id}`, permisos, modulos: ['inventario'] });
    app.DB.admin.usuarios.push({ id, usuario: `resurtido${id}`, nombre: `Actor ${id}`, rol_id: id, sucursal_id: suc, activo: true });
    tokens[id] = firmarToken({ id: String(id), rol_id: id, sucursal_id: suc });
  }
  await new Promise(resolve => { servidor = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${servidor.address().port}/api/resurtido`;
});
beforeEach(() => {
  for (const tabla of ['resurtido_ajustes_historial', 'resurtido_ajustes', 'resurtido_config_historial',
    'resurtido_config', 'resurtido_minmax', 'sicar_existencias', 'sicar_articulos']) sqlite.exec(`DELETE FROM ${tabla}`);
  for (const suc of [1, 3]) {
    sqlite.prepare('INSERT OR IGNORE INTO sicar_tiendas(sucursal_id) VALUES (?)').run(suc);
    sqlite.prepare("INSERT INTO sicar_articulos VALUES (?,'a','A','Cable',NULL,'JR',?)").run(suc, new Date().toISOString());
    sqlite.prepare("INSERT INTO sicar_existencias VALUES (?,'a',0,?)").run(suc, new Date().toISOString());
    sqlite.prepare("INSERT INTO resurtido_minmax VALUES (?,'A','JR',10000,20000,0,0,365,'sin_historia','aproximada',?)")
      .run(suc, new Date().toISOString());
  }
});
after(async () => {
  servidor?.closeAllConnections(); if (servidor) await new Promise(resolve => servidor.close(resolve)); sqlite.close();
});
async function pedir(ruta = '', id = 983, method = 'GET', cuerpo) {
  const res = await fetch(base + ruta, { method, headers: {
    'Content-Type': 'application/json', ...(id ? { Authorization: `Bearer ${tokens[id]}` } : {}),
  }, ...(cuerpo === undefined ? {} : { body: JSON.stringify(cuerpo) }) });
  const texto = await res.text();
  return { status: res.status, datos: texto.startsWith('{') ? JSON.parse(texto) : texto };
}
const ajuste = { sucursal_id: '3', clave: 'A', minimo: 4, maximo: 8, motivo: 'Exhibición', actor: 'Suplantado' };

test('rutas reales exigen login y permisos propios frente a permisos vecinos', async () => {
  assert.equal((await pedir('', null)).status, 401);
  assert.equal((await pedir('', 981)).status, 403);
  assert.equal((await pedir('/ajuste', 982, 'PUT', ajuste)).status, 403);
  assert.equal((await pedir('/ajuste', 982, 'DELETE', ajuste)).status, 403);
  assert.equal((await pedir('/config', 982)).status, 403);
  assert.equal((await pedir('/config', 982, 'PUT', { plazo_dias: 25 })).status, 403);
});

test('tienda solo ve alcance del token; pedir otra por URL o cuerpo da 403', async () => {
  const r = await pedir(); assert.equal(r.status, 200);
  assert.deepEqual(r.datos.filas.map(f => f.sucursal_id), [3]);
  assert.equal((await pedir('?sucursal_id=1')).status, 403);
  for (const method of ['PUT', 'DELETE']) {
    assert.equal((await pedir('/ajuste?sucursal_id=1', 983, method, ajuste)).status, 403);
    assert.equal((await pedir('/ajuste?sucursal_id=3', 983, method, { ...ajuste, sucursal_id: '1' })).status, 403);
  }
  assert.equal((await pedir('/config?sucursal_id=1')).status, 403);
  assert.equal((await pedir('', 985)).status, 403);
});

test('administrador filtra todas o una tienda y encabezado no limita ajuste autorizado', async () => {
  const r = await pedir('?sucursal_id=todas', 984); assert.equal(r.status, 200); assert.equal(r.datos.total, 2);
  assert.equal((await pedir('?sucursal_id=1', 984)).datos.total, 1);
  assert.equal((await pedir('/ajuste?sucursal_id=1', 984, 'PUT', ajuste)).status, 200);
  assert.equal(sqlite.prepare('SELECT sucursal_id FROM resurtido_ajustes').get().sucursal_id, 3);
});

test('ajustar y quitar por HTTP conserva auditoría del token, sin aceptar autor enviado', async () => {
  assert.equal((await pedir('/ajuste', 983, 'PUT', ajuste)).status, 200);
  let r = await pedir(); assert.equal(r.datos.filas[0].minimo, 40000); assert.equal(r.datos.filas[0].ajuste.actor, '983');
  assert.equal((await pedir('/ajuste', 983, 'DELETE', { ...ajuste, motivo: 'Volver al cálculo' })).status, 200);
  r = await pedir(); assert.equal(r.datos.filas[0].minimo, 10000); assert.equal(r.datos.filas[0].ajuste, null);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM resurtido_ajustes_historial').get().n, 2);
});

test('configuración: solo quien ve todas las tiendas, ignora el filtro del encabezado y valida con 400', async () => {
  assert.equal((await pedir('/config')).status, 403);
  const r = await pedir('/config?sucursal_id=6', 984); assert.equal(r.status, 200); assert.equal(r.datos.valores.plazo_dias, 20);
  assert.equal((await pedir('/config', 984, 'PUT', { plazo_dias: 0 })).status, 400);
  assert.equal((await pedir('/config', 984, 'PUT', { plazo_dias: 25 })).status, 200);
  assert.equal((await pedir('/config', 984)).datos.valores.plazo_dias, 25);
  assert.equal(sqlite.prepare('SELECT actor FROM resurtido_config_historial').get().actor, '984');
});

test('ajustes inválidos y filtros inválidos no pasan al servidor', async () => {
  assert.equal((await pedir('/ajuste', 983, 'PUT', { ...ajuste, maximo: 2 })).status, 400);
  assert.equal((await pedir('/ajuste', 983, 'PUT', { ...ajuste, motivo: '' })).status, 400);
  assert.equal((await pedir('?pagina=-1')).status, 400);
  assert.equal((await pedir('?sucursal_id=7', 984)).status, 400);
  assert.equal((await pedir('?estado=desconocido')).status, 400);
});

test('explicación exige ver_resurtido, login y alcance del token', async () => {
  assert.equal((await pedir('/explicacion?clave=A', null)).status, 401);
  assert.equal((await pedir('/explicacion?clave=A', 981)).status, 403);
  assert.equal((await pedir('/explicacion?clave=A&sucursal_id=1', 982)).status, 403);
  const r = await pedir('/explicacion?clave=A', 982);
  assert.equal(r.status, 200); assert.equal(r.datos.sucursal_id, 3);
  assert.equal((await pedir('/explicacion?clave=A', 985)).status, 403);
});

test('administrador explica una tienda explícita y rechaza claves ausentes', async () => {
  const r = await pedir('/explicacion?clave=A&sucursal_id=1', 984);
  assert.equal(r.status, 200); assert.equal(r.datos.sucursal_id, 1);
  assert.equal((await pedir('/explicacion?clave=A&sucursal_id=todas', 984)).status, 400);
  assert.equal((await pedir('/explicacion?clave=NO&sucursal_id=1', 984)).status, 404);
});

test('lista resuelve el nombre actual del autor sin cambiar su id de auditoría', async () => {
  await pedir('/ajuste', 983, 'PUT', ajuste);
  const r = await pedir();
  assert.equal(r.datos.filas[0].ajuste.nombre_actor, 'Actor 983');
  assert.equal(r.datos.filas[0].ajuste.actor, '983');
});

test('autor eliminado se muestra como usuario #id', async () => {
  sqlite.prepare('INSERT INTO resurtido_ajustes VALUES (3,?,?,?,?,?,?)').run('A', 40000, 80000, 'Exhibición', '999999', 'hoy');
  const r = await pedir();
  assert.equal(r.datos.filas[0].ajuste.nombre_actor, 'usuario #999999');
});

test('lista para el proveedor: permiso propio, alcance del token y marca validada', async () => {
  assert.equal((await pedir('/sugerido?marca=JR', null)).status, 401);
  assert.equal((await pedir('/sugerido?marca=JR', 981)).status, 403);
  const propia = await pedir('/sugerido?marca=JR', 982);
  assert.equal(propia.status, 200);
  assert.deepEqual(propia.datos.renglones[0].por_tienda, [{ sucursal_id: 3, sugerido: 20000 }]);
  assert.equal((await pedir('/sugerido?marca=JR&sucursal_id=1', 982)).status, 403);
  const todas = await pedir('/sugerido?marca=JR&sucursal_id=todas', 984);
  assert.equal(todas.datos.renglones[0].total, 40000);
  assert.deepEqual(todas.datos.renglones[0].por_tienda.map(t => t.sucursal_id), [1, 3]);
  const filtro = await pedir('/sugerido?marca=JR&sucursal_id=3', 984);
  assert.deepEqual(filtro.datos.renglones[0].por_tienda.map(t => t.sucursal_id), [3]);
  assert.equal((await pedir('/sugerido?marca=OTRA', 984)).status, 400);
  assert.equal((await pedir('/sugerido', 984)).status, 400);
});
