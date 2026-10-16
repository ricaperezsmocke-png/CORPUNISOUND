const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'crm-seguimiento-prueba';
process.env.NODE_ENV = 'test';
process.env.SENTRY_ENABLED = 'false';
const app = require('./server');
const { obtenerConexionSqlite } = require('./persistencia');
const { firmarToken } = require('./auth');
const sqlite = obtenerConexionSqlite();
let servidor, base;
const tokens = {};
before(async () => {
  for (const [id, permisos] of [[961, ['cambiar_estado_cliente', 'ver_clientes_sicar']],
    [962, ['cambiar_estado_cliente', 'ver_clientes_sicar', 'ver_todas_las_sucursales']],
    [963, ['ver_clientes_sicar', 'ver_lista_clientes']], [964, ['cambiar_estado_cliente']]]) {
    app.DB.admin.roles.push({ id, nombre: `Prueba ${id}`, permisos, modulos: ['crm', 'sicar'] });
    app.DB.admin.usuarios.push({ id, usuario: `seguimiento${id}`, nombre: 'Prueba', rol_id: id, sucursal_id: 1, activo: true });
    tokens[id] = firmarToken({ id, rol_id: id, sucursal_id: 1 });
  }
  await new Promise(resolve => { servidor = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});
beforeEach(() => {
  for (const tabla of ['estados_historial', 'estados']) {
    if (sqlite.prepare('SELECT 1 FROM sqlite_master WHERE name=?').get(`sicar_${tabla}`)) sqlite.exec(`DELETE FROM sicar_${tabla}`);
  }
  for (const tabla of ['decisiones', 'vinculos', 'detalles', 'ventas', 'clientes', 'intentos', 'envios', 'llaves', 'tiendas']) {
    sqlite.exec(`DELETE FROM sicar_${tabla}`);
  }
  sqlite.exec(`INSERT INTO sicar_tiendas(sucursal_id) VALUES (1),(2);
    INSERT INTO sicar_clientes(sucursal_id, cli_id, nombre) VALUES (1,'123','Ana'), (2,'456','Beto');`);
  app.DB.crm.clientes = [{ id: 10, nombre: 'Nativo', sucursal_id: 1 }];
  app.DB.pos.ventas = [];
});
after(async () => {
  servidor?.closeAllConnections();
  if (servidor) await new Promise(resolve => servidor.close(resolve));
  sqlite.close();
});
async function cambiar(ref, estado, id = 961, query = '') {
  const res = await fetch(`${base}/api/crm/v2/clientes/${encodeURIComponent(ref)}/estado${query}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', ...(id ? { Authorization: `Bearer ${tokens[id]}` } : {}) },
    body: JSON.stringify({ estado, usuario_id: 999, sucursal_id: 2 }),
  });
  const texto = await res.text();
  return { status: res.status, datos: texto.startsWith('{') ? JSON.parse(texto) : texto };
}
test('ruta cambia SICAR con actor del token, deja historial y no crea cliente nativo', async () => {
  const r = await cambiar('sicar:1:123', 'interesado');
  assert.equal(r.status, 200);
  assert.equal(r.datos.estado, 'interesado');
  const fila = sqlite.prepare('SELECT * FROM sicar_estados_historial').get();
  assert.equal(fila.usuario_id, 961);
  assert.equal(fila.anterior, null);
  assert.equal(fila.nuevo, 'interesado');
  assert.equal(new Date(fila.fecha_hora).toISOString(), fila.fecha_hora);
  assert.equal(app.DB.crm.clientes.length, 1);
});
test('ruta delega cambio nativo', async () => {
  assert.equal((await cambiar('crm:10', 'visito_tienda')).status, 200);
  assert.equal(app.DB.crm.clientes[0].estado, 'visito_tienda');
  assert.ok(app.DB.crm.clientes[0].ultimo_contacto);
});
test('rechaza compro y estados no permitidos sin escribir', async () => {
  for (const estado of ['compro', 'inventado', null, {}, ['interesado'], 'COMPRO']) {
    const r = await cambiar('sicar:1:123', estado);
    assert.equal(r.status, 400);
    if (estado === 'compro') assert.equal(r.datos.error, 'El estado Compró se gana con una venta cerrada, no se asigna a mano');
  }
  assert.equal(sqlite.prepare('SELECT count(*) n FROM sicar_estados_historial').get().n, 0);
});
test('permiso vecino no autoriza; sin sesion 401; sin ver SICAR 404', async () => {
  assert.equal((await cambiar('sicar:1:123', 'contactado', 963)).status, 403);
  assert.equal((await cambiar('sicar:1:123', 'contactado', null)).status, 401);
  assert.equal((await cambiar('sicar:1:123', 'contactado', 964)).status, 404);
});
test('alcance viene del token y global abre ficha ignorando selector', async () => {
  assert.equal((await cambiar('sicar:2:456', 'contactado', 961, '?sucursal_id=2')).status, 404);
  assert.equal((await cambiar('sicar:1:123', 'contactado', 962, '?sucursal_id=2')).status, 200);
  assert.equal((await cambiar('sicar:2:456', 'contactado', 962, '?sucursal_id=1')).status, 200);
});

test('HTTP transmite orden, fechas y estado y devuelve 400 para filtros invalidos', async () => {
  for (const query of ['orden=desconocido', 'desde=2026-02-30', 'hasta=no', 'estado=otro', 'orden=nombre&orden=monto']) {
    const res = await fetch(`${base}/api/crm/v2/clientes?${query}`, { headers: { Authorization: `Bearer ${tokens[962]}` } });
    assert.equal(res.status, 400, query);
  }
  await cambiar('sicar:1:123', 'interesado');
  const res = await fetch(`${base}/api/crm/v2/clientes?estado=interesado&orden=nombre`,
    { headers: { Authorization: `Bearer ${tokens[962]}` } });
  const datos = await res.json();
  assert.deepEqual(datos.items.map(p => p.ref), ['sicar:1:123']);
});
