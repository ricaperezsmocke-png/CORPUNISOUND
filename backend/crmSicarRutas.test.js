const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'crm-sicar-rutas-prueba';
process.env.NODE_ENV = 'test';
process.env.SENTRY_ENABLED = 'false';
const app = require('./server');
const { obtenerConexionSqlite } = require('./persistencia');
const { firmarToken } = require('./auth');
const { fechaLocal } = require('./fechas');
const sqlite = obtenerConexionSqlite();
let servidor, base, global, ocosingo, vecino;

before(async () => {
  const roles = [[971, ['ver_clientes_sicar', 'ver_todas_las_sucursales']], [972, ['ver_clientes_sicar']],
    // Permiso vecino del mismo módulo: ve la sincronización pero no las compras SICAR.
    [973, ['ver_sincronizacion_sicar', 'resolver_vinculos_sicar']]];
  for (const [id, permisos] of roles) {
    app.DB.admin.roles.push({ id, nombre: `Prueba ${id}`, permisos, modulos: ['crm', 'sicar'] });
    app.DB.admin.usuarios.push({ id, nombre: 'Prueba', usuario: `crmsicar${id}`, rol_id: id, sucursal_id: 1, activo: true });
  }
  [global, ocosingo, vecino] = [971, 972, 973].map(id => firmarToken({ id, rol_id: id, sucursal_id: 1 }));
  await new Promise(resolve => { servidor = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});
beforeEach(() => {
  for (const tabla of ['decisiones', 'vinculos', 'detalles', 'ventas', 'clientes', 'intentos', 'envios', 'llaves', 'tiendas']) {
    sqlite.exec(`DELETE FROM sicar_${tabla}`);
  }
  app.DB.crm.clientes = [{ id: 10, nombre: 'Ana Ocosingo', telefono: '9191234567', sucursal_id: 1 },
    { id: 20, nombre: 'Beto Yajalón', telefono: '9197654321', sucursal_id: 2 }];
  app.DB.pos.ventas = [];
  for (const s of [1, 2]) sqlite.prepare('INSERT INTO sicar_tiendas(sucursal_id) VALUES (?)').run(s);
  sqlite.prepare("INSERT INTO sicar_clientes(sucursal_id, cli_id, nombre) VALUES (1,'500','Cliente SICAR Ocosingo')").run();
  sqlite.prepare("INSERT INTO sicar_clientes(sucursal_id, cli_id, nombre) VALUES (2,'700','Cliente SICAR Yajalón')").run();
  sqlite.prepare(`INSERT INTO sicar_ventas(sucursal_id, ven_id, cli_id, fecha_local, estado, total_centavos, revision, hash)
    VALUES (1,'1','500',?,'vigente',10000,'1','h'), (2,'1','700',?,'vigente',50000,'1','h')`).run(`${fechaLocal()}T10:00:00`, `${fechaLocal()}T10:00:00`);
});
after(async () => {
  servidor?.closeAllConnections();
  if (servidor) await new Promise(resolve => servidor.close(resolve));
  sqlite.close();
});
async function pedir(ruta, token) {
  const res = await fetch(base + ruta, { headers: { Authorization: `Bearer ${token}` } });
  return { status: res.status, datos: await res.json() };
}
const refs = r => r.datos.items.map(i => i.ref).sort();

test('la ficha trae monto, frecuencia, última compra y fuente sin arreglo completo de compras', async () => {
  const r = await pedir('/api/crm/v2/clientes/sicar%3A1%3A500', ocosingo);
  assert.equal(r.status, 200);
  for (const campo of ['monto_centavos', 'numero_compras', 'ultima_compra', 'fuente', 'score', 'segmento']) assert.ok(campo in r.datos, campo);
  assert.equal(r.datos.compras, undefined);
  assert.equal(r.datos.score, 40);
});

test('el selector ajeno o "todas" no amplía el alcance del token', async () => {
  for (const q of ['', '?sucursal_id=2', '?sucursal_id=todas', '?sucursal_id=%222%22']) {
    assert.deepEqual(refs(await pedir(`/api/crm/v2/clientes${q}`, ocosingo)), ['crm:10', 'sicar:1:500'], q);
  }
  assert.equal((await pedir('/api/crm/v2/clientes/crm%3A20', ocosingo)).status, 404);
  assert.equal((await pedir('/api/crm/v2/compras/sicar%3A2%3A1', ocosingo)).status, 404);
  const resumen = await pedir('/api/crm/v2/resumen?sucursal_id=2', ocosingo);
  assert.deepEqual(resumen.datos.sucursales.map(s => s.sucursal_id), [1]);
});

test('quien ve todas abre la ficha de Ocosingo con Yajalón seleccionado, y el filtro recorta su lista', async () => {
  assert.equal((await pedir('/api/crm/v2/clientes/crm%3A10?sucursal_id=2', global)).status, 200);
  assert.deepEqual(refs(await pedir('/api/crm/v2/clientes?sucursal_id=2', global)), ['crm:20', 'sicar:2:700']);
});

test('un permiso vecino sin ver_clientes_sicar no ve compras ni fichas SICAR', async () => {
  assert.deepEqual(refs(await pedir('/api/crm/v2/clientes', vecino)), ['crm:10']);
  assert.equal((await pedir('/api/crm/v2/clientes/sicar%3A1%3A500', vecino)).status, 404);
  assert.equal((await pedir('/api/crm/v2/compras/sicar%3A1%3A1', vecino)).status, 404);
});

test('sin sesión no responde datos', async () => {
  const res = await fetch(`${base}/api/crm/v2/clientes`);
  assert.equal(res.status, 401);
});

for (const [caso, tokenDe, tienda, esperaTarea] of [
  ['local no ve Yajalón', () => ocosingo, 2, true],
  ['global sí ve Yajalón', () => global, 2, false],
  ['sin permiso SICAR no ve ni Ocosingo', () => vecino, 1, true],
]) test(`Gerencia: ${caso}`, async () => {
  for (const id of [971, 972, 973]) {
    const rol = app.DB.admin.roles.find(r => r.id === id);
    if (!rol.permisos.includes('usar_gerente_ventas')) rol.permisos.push('usar_gerente_ventas');
    app.DB.admin.usuarios.find(u => u.id === id).vendedor_id = 981;
  }
  app.DB.pos.vendedores = [{ id: 981, nombre: 'Vendedora', sucursal_id: 1, meta_mensual: 0 }];
  app.DB.pos.tareas_venta = require('./gerenteVentas').nuevoEstadoTareasVenta();
  app.DB.crm.clientes[0].vendedor_asignado_id = 981;
  sqlite.prepare(`INSERT INTO sicar_vinculos(sucursal_id, cli_id, cliente_id, estado, creada, actualizada)
    VALUES (?, ?, 10, 'pendiente', '2026-10-01', '2026-10-01')`).run(tienda, tienda === 1 ? '500' : '700');
  const r = await pedir('/api/gerente-ventas/981?sucursal_id=2', tokenDe());
  assert.equal(r.status, 200, JSON.stringify(r.datos));
  const tarea = r.datos.tareas.find(t => t.cliente_id === 10);
  assert.equal(!!tarea, esperaTarea);
  if (esperaTarea) assert.match(tarea.descripcion, /nunca ha comprado/);
});
