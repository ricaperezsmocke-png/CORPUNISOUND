const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'crm-internas-prueba';
process.env.NODE_ENV = 'test';
process.env.SENTRY_ENABLED = 'false';
const app = require('./server');
const { obtenerConexionSqlite } = require('./persistencia');
const { firmarToken } = require('./auth');
const sqlite = obtenerConexionSqlite();
const tokens = {};
let servidor, base;
before(async () => {
  for (const [id, permisos] of [[971, ['marcar_cuenta_interna', 'ver_clientes_sicar']],
    [972, ['marcar_cuenta_interna', 'ver_clientes_sicar', 'ver_todas_las_sucursales']],
    [973, ['cambiar_estado_cliente', 'ver_lista_clientes', 'ver_clientes_sicar']], [974, ['marcar_cuenta_interna']]]) {
    app.DB.admin.roles.push({ id, nombre: `Prueba ${id}`, permisos, modulos: ['crm', 'sicar'] });
    app.DB.admin.usuarios.push({ id, usuario: `internas${id}`, nombre: `Actor ${id}`, rol_id: id, sucursal_id: 1, activo: true });
    tokens[id] = firmarToken({ id: String(id), rol_id: id, sucursal_id: 1 });
  }
  await new Promise(resolve => { servidor = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});
beforeEach(() => {
  for (const tabla of ['internas_historial', 'internas', 'estados_historial', 'estados', 'decisiones', 'vinculos',
    'detalles', 'ventas', 'clientes', 'intentos', 'envios', 'llaves', 'tiendas']) sqlite.exec(`DELETE FROM sicar_${tabla}`);
  sqlite.exec(`INSERT INTO sicar_tiendas(sucursal_id) VALUES (1),(2);
    INSERT INTO sicar_clientes(sucursal_id, cli_id, nombre) VALUES (1,'9','Ana'),(2,'8','Beto');`);
  app.DB.crm.clientes = [{ id: 10, nombre: 'Nativo', sucursal_id: 1 }, { id: 20, nombre: 'Otra', sucursal_id: 2 }];
  app.DB.crm.cuentas_internas_historial = [];
  app.DB.pos.ventas = [{ id: 1, cliente_id: 10, total: 20000, fecha: require('./fechas').fechaLocal(), estatus: 'cerrada', sucursal_id: 1 }];
  app.DB.pos.venta_detalle = [];
});
after(async () => {
  servidor?.closeAllConnections();
  if (servidor) await new Promise(resolve => servidor.close(resolve));
  sqlite.close();
});
async function pedir(ruta, id = 971, cuerpo) {
  const res = await fetch(`${base}/api/crm/v2/${ruta}`, {
    method: cuerpo ? 'PUT' : 'GET', headers: { 'Content-Type': 'application/json', ...(id ? { Authorization: `Bearer ${tokens[id]}` } : {}) },
    ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}),
  });
  const texto = await res.text();
  return { status: res.status, datos: texto.startsWith('{') ? JSON.parse(texto) : texto };
}
const cambiar = (ref, interna, motivo = 'Cuenta de tienda', id = 971, query = '') =>
  pedir(`clientes/${encodeURIComponent(ref)}/cuenta-interna${query}`, id, { interna, motivo, usuario_id: '999', sucursal_id: '2' });

test('permiso propio: vecinos CRM 403, sin sesión 401 y sin acceso SICAR 404', async () => {
  assert.equal((await cambiar('crm:10', true, 'Tienda', 973)).status, 403);
  assert.equal((await cambiar('crm:10', true, 'Tienda', null)).status, 401);
  assert.equal((await cambiar('sicar:1:9', true, 'Tienda', 974)).status, 404);
});
test('alcance token: local no marca otra tienda, global ignora selector de ficha', async () => {
  for (const ref of ['crm:20', 'sicar:2:8']) assert.equal((await cambiar(ref, true, 'Tienda', 971, '?sucursal_id=2')).status, 404);
  assert.equal((await cambiar('crm:10', true, 'Tienda', 972, '?sucursal_id=2')).status, 200);
  assert.equal((await cambiar('sicar:2:8', true, 'Tienda', 972, '?sucursal_id=1')).status, 200);
});
test('booleano estricto y motivo de 3 a 200 caracteres recortados en ambas fuentes', async () => {
  for (const ref of ['crm:10', 'sicar:1:9']) {
    for (const interna of ['true', 'false', 1, 0, null, {}]) assert.equal((await cambiar(ref, interna)).status, 400);
    for (const motivo of ['', '  ', 'ab', 'x'.repeat(201), null, 12, {}]) assert.equal((await cambiar(ref, true, motivo)).status, 400);
    const r = await cambiar(ref, true, '   ' + 'x'.repeat(200) + '   ');
    assert.equal(r.status, 200);
    assert.equal(r.datos.cuenta_interna.motivo.length, 200);
    assert.equal((await cambiar(ref, false, '')).status, 400);
    assert.equal((await cambiar(ref, false, ' fin ')).status, 200);
  }
});
for (const ref of ['crm:10', 'sicar:1:9']) {
  test(`${ref}: dos cambios auditados, conflictos sin historial y recarga persistida`, async () => {
    const inicio = await cambiar(ref, false);
    assert.equal(inicio.status, 409);
    const marca = await cambiar(ref, true, '  Tienda  ');
    assert.equal(marca.status, 200);
    assert.equal(marca.datos.cuenta_interna.usuario_nombre, 'Actor 971');
    assert.equal(marca.datos.cuenta_interna.motivo, 'Tienda');
    assert.equal(marca.datos.vip, false);
    assert.equal((await cambiar(ref, true)).status, 409);
    const fin = await cambiar(ref, false, 'Cliente real');
    assert.equal(fin.status, 200);
    assert.equal(fin.datos.cuenta_interna, null);
    const recarga = await pedir(`clientes/${ref}`);
    assert.deepEqual(recarga.datos.historial_interna.map(h => [h.anterior, h.nuevo, h.usuario_id, h.usuario_nombre]),
      [[true, false, 971, 'Actor 971'], [false, true, 971, 'Actor 971']]);
    assert.deepEqual(recarga.datos.historial_interna.map(h => h.motivo), ['Cliente real', 'Tienda']);
    for (const h of recarga.datos.historial_interna) assert.equal(new Date(h.fecha_hora).toISOString(), h.fecha_hora);
    if (ref.startsWith('crm')) {
      const guardada = JSON.parse(sqlite.prepare('SELECT datos FROM estado').get().datos);
      assert.equal(guardada.crm.cuentas_internas_historial.length, 2);
    }
  });
}
test('historial devuelve últimos 20 y mantiene todos en almacenamiento', async () => {
  for (const ref of ['crm:10', 'sicar:1:9']) {
    for (let i = 0; i < 22; i++) assert.equal((await cambiar(ref, i % 2 === 0, `Cambio ${i}`)).status, 200);
    const r = await pedir(`clientes/${ref}`);
    assert.equal(r.datos.historial_interna.length, 20);
    assert.equal(r.datos.historial_interna[0].motivo, 'Cambio 21');
    assert.equal(r.datos.historial_interna.at(-1).motivo, 'Cambio 2');
  }
  assert.equal(app.DB.crm.cuentas_internas_historial.length, 22);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM sicar_internas_historial').get().n, 22);
});
test('identidad unida no se marca aparte; nativo marca a la persona', async () => {
  sqlite.exec("INSERT INTO sicar_vinculos(sucursal_id, cli_id, cliente_id, estado, creada, actualizada) VALUES (1,'9',10,'confirmado','hoy','hoy')");
  assert.equal((await cambiar('sicar:1:9', true)).status, 404);
  assert.equal((await cambiar('crm:10', true)).status, 200);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM sicar_internas').get().n, 0);
  assert.equal(app.DB.crm.cuentas_internas_historial.length, 1);
});
test('HTTP transmite filtro VIP, rechaza inválidos y totales bajan al marcar', async () => {
  for (const query of ['vip=si', 'vip=0', 'vip=', 'vip=1&vip=1']) assert.equal((await pedir(`clientes?${query}`)).status, 400);
  assert.deepEqual((await pedir('clientes?vip=1')).datos.items.map(p => p.ref), ['crm:10']);
  await cambiar('crm:10', true);
  assert.equal((await pedir('clientes?vip=1')).datos.items.length, 0);
  const lista = (await pedir('clientes')).datos;
  assert.ok(lista.items.some(p => p.ref === 'crm:10'));
  assert.equal(lista.totales.monto_centavos, 0);
  assert.equal((await pedir('resumen')).datos.sucursales.reduce((n, s) => n + s.monto_pos_centavos, 0), 0);
});
test('qué compra requiere login y mismo alcance que ficha', async () => {
  assert.equal((await pedir('clientes/crm:10/que-compra', null)).status, 401);
  assert.equal((await pedir('clientes/crm:20/que-compra?sucursal_id=2')).status, 404);
  assert.equal((await pedir('clientes/sicar:1:9/que-compra', 974)).status, 404);
  const r = await pedir('clientes/crm:10/que-compra?sucursal_id=2', 972);
  assert.equal(r.status, 200);
  assert.equal(r.datos.total_centavos, 2000000);
});
