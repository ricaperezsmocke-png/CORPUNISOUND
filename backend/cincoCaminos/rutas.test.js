const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';
process.env.SENTRY_ENABLED = 'false';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'cinco-caminos-desechable';
const app = require('../server');
const { obtenerConexionSqlite } = require('../persistencia');
const { firmarToken } = require('../auth');
const { semanaDe, ultimaSemanaCompleta } = require('./semanas');
const { fechaLocal } = require('../fechas');

const sqlite = obtenerConexionSqlite();
let ven = 0;
function sembrarTienda(suc, lunes, n) {
  sqlite.prepare('INSERT OR IGNORE INTO sicar_tiendas(sucursal_id) VALUES (?)').run(suc);
  for (let i = 0; i < n; i++) {
    sqlite.prepare(`INSERT INTO sicar_ventas_mostrador (sucursal_id, ven_id, fecha_local, estado, total_centavos, actualizado_en)
      VALUES (?, ?, ?, 'vigente', 1000, 'x')`).run(suc, `m${++ven}`, `${lunes}T12:00:00`);
  }
}
sqlite.prepare('INSERT OR IGNORE INTO sicar_tiendas(sucursal_id) VALUES (1)').run();
sqlite.prepare(`INSERT INTO sicar_articulos (sucursal_id, art_id, descripcion, categoria, departamento, actualizado_en)
  VALUES (1, 'a1', 'Guitarra', 'ACUSTICAS', 'GUITARRAS', 'x'), (1, 'a2', 'Cuerdas', 'CUERDAS', 'ACCESORIOS', 'x'),
  (1, 'a3', 'Otra guitarra', 'ACUSTICAS', 'GUITARRAS', 'x'), (1, 'a4', 'Sin departamento', NULL, NULL, 'x')`).run();
sembrarTienda(1, '2026-10-12', 31);
sembrarTienda(2, '2026-10-12', 45);

// Permisos vecinos del mismo módulo `pos`: sin ellos la prueba pasaría con cualquier clave.
const vecinos = ['usar_gerente_ventas', 'administrar_metas_personalizadas'];
const roles = {
  971: vecinos,
  972: [...vecinos, 'ver_cinco_caminos'],
  973: [...vecinos, 'ver_cinco_caminos', 'ver_todas_las_sucursales'],
  974: [...vecinos, 'ver_cinco_caminos', 'administrar_manual_tacticas'],
};
for (const [id, permisos] of Object.entries(roles)) {
  app.DB.admin.roles.push({ id: Number(id), nombre: `Cinco ${id}`, permisos, modulos: ['pos'] });
  app.DB.admin.usuarios.push({ id: Number(id), nombre: `Prueba ${id}`, usuario: `cc${id}`, rol_id: Number(id), sucursal_id: 1, activo: true });
}
const token = id => firmarToken({ id, rol_id: id, sucursal_id: 1 });

async function conServidor(t) {
  const servidor = app.listen(0, '127.0.0.1');
  await new Promise(resolve => servidor.once('listening', resolve));
  t.after(async () => { servidor.closeAllConnections(); await new Promise(resolve => servidor.close(resolve)); });
  const base = `http://127.0.0.1:${servidor.address().port}`;
  return (ruta, id, opciones = {}) => fetch(base + ruta, { ...opciones,
    headers: { Authorization: `Bearer ${token(id)}`, 'Content-Type': 'application/json' } })
    .then(async r => ({ status: r.status, datos: await r.json() }));
}

test('permisos nuevos en el catálogo (módulo pos) y el guard de arranque los acepta', () => {
  const { PERMISOS } = require('../permisosCatalogo');
  for (const clave of ['ver_cinco_caminos', 'administrar_manual_tacticas']) {
    const p = PERMISOS.find(x => x.clave === clave);
    assert.ok(p, clave);
    assert.equal(p.modulo, 'pos');
    assert.equal(p.implementado, true);
  }
  assert.doesNotThrow(() => require('../validarPermisos').validarSistemaDePermisos());
});

test('la semilla trae DB.pos.cinco_caminos para que sobreviva a la restauración', () => {
  assert.deepEqual(app.DB.pos.cinco_caminos.categorias, []);
});

test('tablero: permiso propio y alcance solo del token', async t => {
  const pedir = await conServidor(t);
  assert.equal((await pedir('/api/cinco-caminos/tablero?semana=2026-10-12', 971)).status, 403);
  // Sin "ver todas": ?sucursal_id= de otra tienda no abre nada, devuelve la del token.
  const propia = await pedir('/api/cinco-caminos/tablero?sucursal_id=2&semana=2026-10-14', 972);
  assert.equal(propia.status, 200);
  assert.equal(propia.datos.actual.sucursal_id, 1);
  assert.equal(propia.datos.actual.lunes, '2026-10-12');
  assert.equal(propia.datos.actual.ventas, 31);
  assert.ok(propia.datos.anterior && propia.datos.mismo_2025 && propia.datos.promedio_8);
  // Con "ver todas" el filtro sí elige la tienda.
  const ajena = await pedir('/api/cinco-caminos/tablero?sucursal_id=2&semana=2026-10-12', 973);
  assert.equal(ajena.status, 200);
  assert.equal(ajena.datos.actual.sucursal_id, 2);
  assert.equal(ajena.datos.actual.ventas, 45);
  assert.equal((await pedir('/api/cinco-caminos/tablero?sucursal_id=99&semana=2026-10-12', 973)).status, 404);
  assert.equal((await pedir('/api/cinco-caminos/tablero?semana=basura', 972)).status, 400);
  // Sin semana: la última semana completa.
  const porDefecto = await pedir('/api/cinco-caminos/tablero', 972);
  assert.equal(porDefecto.status, 200);
  assert.equal(porDefecto.datos.actual.lunes, ultimaSemanaCompleta(fechaLocal()));
  assert.equal(semanaDe(porDefecto.datos.actual.lunes).lunes, porDefecto.datos.actual.lunes);
});

test('categorías: ver con ver_cinco_caminos, cambiar con administrar_manual_tacticas y validadas', async t => {
  const pedir = await conServidor(t);
  const poner = (id, body) => pedir('/api/cinco-caminos/categorias', id, { method: 'PUT', body: JSON.stringify(body) });
  assert.equal((await pedir('/api/cinco-caminos/categorias', 971)).status, 403);
  assert.equal((await pedir('/api/cinco-caminos/categorias/disponibles', 971)).status, 403);
  assert.deepEqual((await pedir('/api/cinco-caminos/categorias', 972)).datos.categorias, []);
  const validas = [{ departamento: 'GUITARRAS', categoria: null, tipo: 'instrumento' },
    { departamento: 'ACCESORIOS', categoria: 'CUERDAS', tipo: 'accesorio' }];
  assert.equal((await poner(972, { categorias: validas })).status, 403, 'ver no da para cambiar');
  assert.equal((await poner(973, { categorias: validas })).status, 403, 'ver todas tampoco');
  const malas = [
    { categorias: [{ departamento: 'GUITARRAS', categoria: null, tipo: 'otro' }] },
    { categorias: [{ departamento: 'G'.repeat(101), categoria: null, tipo: 'instrumento' }] },
    { categorias: [{ departamento: 'GUITARRAS', categoria: 'C'.repeat(101), tipo: 'instrumento' }] },
    { categorias: [{ departamento: '', categoria: null, tipo: 'instrumento' }] },
    { categorias: [{ departamento: 5, categoria: null, tipo: 'instrumento' }] },
    { categorias: [{ departamento: 'GUITARRAS', categoria: 7, tipo: 'instrumento' }] },
    { categorias: [{ departamento: 'GUITARRAS', categoria: null, tipo: 'instrumento', extra: 1 }] },
    { categorias: [validas[0], { ...validas[0], tipo: 'accesorio' }] }, // la misma regla dos veces
    { categorias: 'GUITARRAS' },
    {},
  ];
  for (const body of malas) assert.equal((await poner(974, body)).status, 400, JSON.stringify(body).slice(0, 80));
  assert.deepEqual(app.DB.pos.cinco_caminos.categorias, [], 'un rechazo no cambia nada');
  const ok = await poner(974, { categorias: validas });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.datos.categorias, validas);
  assert.deepEqual(app.DB.pos.cinco_caminos.categorias, validas);
  const historial = app.DB.pos.cinco_caminos.categorias_historial;
  assert.equal(historial.length, 1);
  assert.equal(historial[0].usuario_id, 974);
  assert.deepEqual(historial[0].categorias, validas);
  assert.deepEqual((await pedir('/api/cinco-caminos/categorias', 972)).datos.categorias, validas);
  const disponibles = await pedir('/api/cinco-caminos/categorias/disponibles', 972);
  assert.equal(disponibles.status, 200);
  assert.deepEqual(disponibles.datos.disponibles, [
    { departamento: 'ACCESORIOS', categoria: 'CUERDAS', articulos: 1 },
    { departamento: 'GUITARRAS', categoria: 'ACUSTICAS', articulos: 2 },
  ]);
});
