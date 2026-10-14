const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'migracion-sicar-prueba';
process.env.NODE_ENV = 'test';
process.env.SENTRY_ENABLED = 'false';
const app = require('./server');
const { obtenerConexionSqlite } = require('./persistencia');
const { firmarToken } = require('./auth');
const { crearRepositorioSicar } = require('./sicarRepositorio');
const { crearLlaveSicar } = require('./sicarIngesta');
const sqlite = obtenerConexionSqlite();
const repo = crearRepositorioSicar(sqlite);
let servidor, base, admin;

// Q6 (Victor, 2026-10-13): con el agente SICAR activo en una tienda, sus clientes ya no se importan por Excel.
before(async () => {
  app.DB.admin.roles.push({ id: 981, nombre: 'Prueba migración', modulos: ['migracion'],
    permisos: ['migrar_datos', 'ver_todas_las_sucursales'] });
  app.DB.admin.usuarios.push({ id: 981, nombre: 'Prueba', usuario: 'migracion981', rol_id: 981, sucursal_id: 1, activo: true });
  admin = firmarToken({ id: 981, rol_id: 981, sucursal_id: 1 });
  await new Promise(resolve => { servidor = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});
beforeEach(() => {
  for (const tabla of ['decisiones', 'vinculos', 'detalles', 'ventas', 'clientes', 'intentos', 'envios', 'llaves', 'tiendas']) {
    sqlite.exec(`DELETE FROM sicar_${tabla}`);
  }
});
after(async () => {
  servidor?.closeAllConnections();
  if (servidor) await new Promise(resolve => servidor.close(resolve));
  sqlite.close();
});
async function pedir(ruta, body) {
  const res = await fetch(base + ruta, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, datos: await res.json() };
}
const previsualizar = (tipo, sucursal_id = 1) => pedir('/api/migracion/previsualizar',
  { tipo, sucursal_id, archivo_base64: 'no-es-un-excel' });
const aplicar = (tipo, sucursal_id = 1) => pedir('/api/migracion/aplicar',
  { tipo, sucursal_id, filas: [{ nombre: 'Cliente Excel', telefono: '9191234567', clave: '100' }], nombre_archivo: 'x.xlsx' });

test('tienda con agente activo rechaza clientes por Excel al previsualizar y al aplicar', async () => {
  crearLlaveSicar(repo, 1, 981);
  const antes = app.DB.crm.clientes.length;
  for (const r of [await previsualizar('clientes'), await aplicar('clientes')]) {
    assert.equal(r.status, 409);
    assert.match(r.datos.error, /SICAR/);
  }
  assert.equal(app.DB.crm.clientes.length, antes);
});

test('el id del cuerpo puede llegar como texto y el bloqueo se mantiene', async () => {
  crearLlaveSicar(repo, 1, 981);
  assert.equal((await previsualizar('clientes', '1')).status, 409);
});

test('tienda sin agente, o con la llave revocada, conserva el comportamiento de siempre', async () => {
  crearLlaveSicar(repo, 2, 981);
  assert.equal((await previsualizar('clientes', 1)).status, 400);
  const { key_id } = crearLlaveSicar(repo, 1, 981);
  repo.revocarLlave(key_id);
  assert.equal((await previsualizar('clientes', 1)).status, 400);
});

test('artículos y proveedores no se bloquean en la tienda con agente', async () => {
  crearLlaveSicar(repo, 1, 981);
  for (const tipo of ['articulos', 'proveedores']) assert.notEqual((await previsualizar(tipo)).status, 409);
});
