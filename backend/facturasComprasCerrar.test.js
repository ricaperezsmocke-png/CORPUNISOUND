const { test } = require('node:test');
const assert = require('node:assert/strict');

// Archivo propio: el servidor se carga una sola vez por proceso y la prueba de rutas de facturasCompras.test.js
// cierra su conexión al terminar.
test('Decisión 2: cerrar compra exige conciliar_facturas, toma el actor del token y su nombre sale en el resumen', async t => {
  process.env.DB_PATH = ':memory:'; process.env.NODE_ENV = 'test'; process.env.SENTRY_ENABLED = 'false';
  process.env.JWT_SECRET = 'facturas-compras-cerrar-prueba';
  const app = require('./server');
  const sqlite = require('./persistencia').obtenerConexionSqlite();
  t.after(() => sqlite.close());
  sqlite.prepare('INSERT OR IGNORE INTO sicar_tiendas(sucursal_id) VALUES (6)').run();
  sqlite.prepare(`INSERT INTO sicar_proveedores(sucursal_id,prv_id,nombre,rfc,actualizado_en)
    VALUES (6,'1','Proveedor','ABC010101XY9','2026-01-01')`).run();
  sqlite.prepare(`INSERT INTO sicar_compras (sucursal_id,com_id,fecha,pro_id,folio,comentario,estado,total_centavos,primera_vez,actualizado_en)
    VALUES (6,'15','2026-01-02T12:00:00','1','A1','COMPRA CEDIS','vigente',10000,'2026-01-01T12:00:00Z','2026-01-01')`).run();
  const vecinos = ['ver_facturas_por_llegar', 'registrar_facturas_por_llegar'];
  for (const [rol, permisos] of [[971, vecinos], [972, [...vecinos, 'conciliar_facturas']]]) {
    app.DB.admin.roles.push({ id: rol, nombre: String(rol), permisos, modulos: ['inventario'] });
    app.DB.admin.usuarios.push({ id: rol, nombre: `Persona ${rol}`, usuario: String(rol), rol_id: rol, sucursal_id: 1, activo: true });
  }
  const servidor = app.listen(0, '127.0.0.1');
  await new Promise(resolve => servidor.once('listening', resolve));
  t.after(async () => { servidor.closeAllConnections(); await new Promise(resolve => servidor.close(resolve)); });
  const pedir = (ruta, rol, body) => fetch(`http://127.0.0.1:${servidor.address().port}/api/${ruta}`, {
    method: body ? 'POST' : 'GET', body: body && JSON.stringify(body), headers: { 'Content-Type': 'application/json',
      Authorization: 'Bearer ' + require('./auth').firmarToken({ id: rol, rol_id: rol, sucursal_id: 1 }) },
  }).then(async r => ({ status: r.status, datos: await r.json() }));
  const cuerpo = { sucursal_id: '6', com_id: '15', motivo: 'Muestra sin factura', actor: 'falso' };
  assert.equal((await pedir('facturas-compras/cerrar', 971, cuerpo)).status, 403);
  assert.equal((await pedir('facturas-compras/cerrar', 972, { ...cuerpo, motivo: '  ' })).status, 400);
  assert.equal((await pedir('facturas-compras/cerrar', 972, cuerpo)).status, 200);
  assert.equal((await pedir('facturas-compras/cerrar', 972, cuerpo)).status, 409);
  assert.equal(sqlite.prepare('SELECT actor FROM compras_cerradas').get().actor, '972');
  const resumen = await pedir('facturas-compras/resumen', 971);
  assert.equal(resumen.status, 200);
  assert.deepEqual(resumen.datos.compras_cerradas.map(c => [c.com_id, c.actor_nombre, c.motivo]),
    [['15', 'Persona 972', 'Muestra sin factura']]);
});
