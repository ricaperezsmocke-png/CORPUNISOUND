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
    [984, [...comunes, 'ver_todas_las_sucursales'], 1], [985, comunes, null],
    [986, ['ver_resurtido', 'dar_visto_bueno_resurtido'], 2], [987, ['ver_resurtido', 'dar_visto_bueno_resurtido'], 1],
    [989, ['ver_resurtido', 'aprobar_pedido_resurtido'], 1],
    [988, ['ver_resurtido', 'aprobar_pedido_resurtido', 'ver_todas_las_sucursales'], 1]]) {
    app.DB.admin.roles.push({ id, nombre: `Resurtido ${id}`, permisos, modulos: ['inventario'] });
    app.DB.admin.usuarios.push({ id, usuario: `resurtido${id}`, nombre: `Actor ${id}`, rol_id: id, sucursal_id: suc, activo: true });
    tokens[id] = firmarToken({ id: String(id), rol_id: id, sucursal_id: suc });
  }
  await new Promise(resolve => { servidor = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${servidor.address().port}/api/resurtido`;
});
beforeEach(() => {
  for (const tabla of ['resurtido_pedido_historial', 'resurtido_pedido_renglones', 'resurtido_pedidos', 'resurtido_empaques',
    'resurtido_empaques_historial', 'resurtido_reservas', 'resurtido_avisos', 'resurtido_ajustes_historial', 'resurtido_ajustes',
    'resurtido_config_historial', 'resurtido_avisos_historial',
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

// ---- Pedido con visto bueno (Task 10) ----
function sembrarPedido() {
  sqlite.exec(`INSERT INTO resurtido_pedidos(id,marca,tipo,periodo,llave,estado,creado_en,creado_por)
      VALUES (1,'JR','mensual','2026-11','JR:2026-11:mensual','borrador','${new Date().toISOString()}','sistema');
    INSERT INTO resurtido_pedido_renglones(pedido_id,sucursal_id,clave,descripcion,sugerido,pedido) VALUES
      (1,1,'A','Cable',20000,20000),(1,2,'A','Cable',40000,40000)`);
}

test('acciones globales rechazan a quien aprueba con alcance de una sola tienda', async () => {
  sembrarPedido();
  sqlite.exec("UPDATE resurtido_pedido_renglones SET visto_bueno_por='9'");
  for (const [ruta, metodo] of [['/pedidos/1/aprobar', 'POST'], ['/pedidos/1/proveedor', 'GET'],
    ['/pedidos', 'POST'], ['/pedidos/reactivar', 'POST'], ['/pedidos/1/envio', 'POST'],
    ['/pedidos/1/compras', 'GET'], ['/pedidos/1/compra', 'POST']]) {
    const r = await pedir(ruta, 989, metodo, metodo === 'POST' ? { marca: 'JR' } : undefined);
    assert.equal(r.status, 403, ruta);
    assert.equal(r.datos.error, 'Esta acción requiere ver todas las tiendas.');
  }
  assert.equal((await pedir('/pedidos/1/aprobar', 988, 'POST', {})).status, 200);
  assert.equal((await pedir('/pedidos/1/proveedor', 988)).status, 200);
});

test('lista de pedidos solo incluye pedidos con renglones de la tienda del token', async () => {
  sembrarPedido();
  assert.deepEqual((await pedir('/pedidos', 982)).datos.pedidos, []);
  assert.deepEqual((await pedir('/pedidos', 986)).datos.pedidos.map(p => p.id), [1]);
  assert.deepEqual((await pedir('/pedidos?sucursal_id=3', 988)).datos.pedidos.map(p => p.id), [1]);
  assert.deepEqual((await pedir('/pedidos?marca=SOLCOR', 986)).datos.pedidos, []);
});

test('pedido: visto bueno solo de la tienda del token; permisos vecinos no alcanzan', async () => {
  sembrarPedido();
  assert.equal((await pedir('/pedidos/1/visto-bueno', 986, 'POST', { sucursal_id: '1', cambios: [] })).status, 403);
  assert.equal((await pedir('/pedidos/1/visto-bueno?sucursal_id=1', 986, 'POST', { cambios: [] })).status, 403);
  assert.equal((await pedir('/pedidos/1/tienda', 986, 'PUT', { sucursal_id: 1, cambios: [{ clave: 'A', pedido: 9 }] })).status, 403);
  assert.equal((await pedir('/pedidos/1/visto-bueno', 983, 'POST', { cambios: [] })).status, 403);
  assert.equal((await pedir('/pedidos/1/visto-bueno', 988, 'POST', { sucursal_id: 2, cambios: [] })).status, 403);
  assert.equal((await pedir('/pedidos/1/tienda', 986, 'PUT', { cambios: [{ clave: 'A', pedido: 20 }] })).status, 400);
  assert.equal((await pedir('/pedidos/1/tienda', 986, 'PUT', { cambios: [{ clave: 'A', pedido: 20, motivo: 'Escuela' }] })).status, 200);
  assert.equal(sqlite.prepare('SELECT marcado FROM resurtido_pedido_renglones WHERE sucursal_id=2').get().marcado, 1);
  assert.equal((await pedir('/pedidos/1/aprobar', 988, 'POST', {})).status, 409);
  assert.equal((await pedir('/pedidos/1/visto-bueno', 986, 'POST', { cambios: [] })).status, 200);
  assert.equal(sqlite.prepare('SELECT visto_bueno_por v FROM resurtido_pedido_renglones WHERE sucursal_id=2').get().v, '986');
  assert.equal(sqlite.prepare('SELECT visto_bueno_por v FROM resurtido_pedido_renglones WHERE sucursal_id=1').get().v, null);
  const propia = await pedir('/pedidos/1', 986);
  assert.equal(propia.status, 200);
  assert.deepEqual(propia.datos.renglones.map(r => r.sucursal_id), [2]);
  assert.equal(propia.datos.renglones[0].nombre_visto_bueno, 'Actor 986');
  assert.equal((await pedir('/pedidos/1/visto-bueno', 987, 'POST', { cambios: [] })).status, 200);
  assert.equal((await pedir('/pedidos/1/aprobar', 986, 'POST', {})).status, 403);
  const aprobado = await pedir('/pedidos/1/aprobar', 988, 'POST', {});
  assert.equal(aprobado.status, 200); assert.equal(aprobado.datos.marcados, 1);
  assert.equal((await pedir('/pedidos/1/tienda', 986, 'PUT', { cambios: [{ clave: 'A', pedido: 1 }] })).status, 409);
  assert.equal((await pedir('/pedidos/1/proveedor', 986)).status, 403);
  const lista = await pedir('/pedidos/1/proveedor', 988);
  assert.equal(lista.status, 200); assert.equal(lista.datos.renglones[0].total, 220000);
  assert.deepEqual((await pedir('/pedidos/1/reparto', 986)).datos.tiendas.map(t => t.sucursal_id), [2]);
  assert.equal((await pedir('/pedidos/1/envio', 986, 'POST', { referencia: 'WhatsApp' })).status, 403);
  assert.equal((await pedir('/pedidos/1/envio', 988, 'POST', { referencia: 'WhatsApp' })).status, 200);
  assert.equal(sqlite.prepare('SELECT enviado_por FROM resurtido_pedidos').get().enviado_por, '988');
  assert.equal((await pedir('/pedidos/99', 988)).status, 404);
});

test('armar borrador ahora y reactivar pedidos piden permiso de aprobar; la configuración no reactiva', async () => {
  assert.equal((await pedir('/pedidos', 983, 'POST', { marca: 'JR' })).status, 403);
  assert.equal((await pedir('/pedidos', 986, 'POST', { marca: 'JR' })).status, 403);
  const r = await pedir('/pedidos', 988, 'POST', { marca: 'JR' });
  assert.equal(r.status, 200); assert.equal(r.datos.creado, true);
  assert.equal(sqlite.prepare('SELECT creado_por FROM resurtido_pedidos').get().creado_por, '988');
  assert.equal((await pedir('/pedidos', 988, 'POST', { marca: 'JR' })).datos.creado, false);
  assert.equal((await pedir('/pedidos', 988, 'POST', { marca: 'OTRA' })).status, 400);
  sqlite.exec("INSERT INTO resurtido_config VALUES ('pedidos_pausados','1','restauracion','hoy')");
  assert.equal((await pedir('/pedidos', 988, 'POST', { marca: 'SOLCOR' })).status, 409);
  assert.equal((await pedir('/config', 984, 'PUT', { pedidos_pausados: 0 })).status, 403);
  assert.equal((await pedir('/pedidos/reactivar', 986, 'POST', {})).status, 403);
  assert.equal((await pedir('/pedidos/reactivar', 988, 'POST', {})).status, 200);
  assert.equal(sqlite.prepare("SELECT actor FROM resurtido_config_historial WHERE clave='pedidos_pausados'").get().actor, '988');
  assert.equal((await pedir('/pedidos', 988, 'POST', { marca: 'SOLCOR' })).status, 200);
  const lista = await pedir('/pedidos?marca=JR', 987);
  assert.equal(lista.status, 200); assert.deepEqual(lista.datos.pedidos.map(p => p.marca), ['JR']);
});

test('compra candidata del pedido: ver y confirmar solo con permiso de aprobar', async () => {
  sembrarPedido();
  assert.equal((await pedir('/pedidos/1/compras', 986)).status, 403);
  const r = await pedir('/pedidos/1/compras', 988);
  assert.equal(r.status, 200); assert.deepEqual(r.datos.candidatas, []);
  assert.equal((await pedir('/pedidos/1/compra', 986, 'POST', { com_id: '1' })).status, 403);
  assert.equal((await pedir('/pedidos/1/compra', 988, 'POST', { com_id: '1' })).status, 409);
});

test('empaques: cualquiera con ver_resurtido los ve; solo configurar_resurtido de toda la empresa los cambia', async () => {
  sqlite.exec("INSERT INTO sicar_articulos VALUES (3,'c','C1','CABLE 2X14',NULL,'SOLCOR','hoy')");
  const r = await pedir('/empaques', 982);
  assert.equal(r.status, 200); assert.deepEqual(r.datos.claves.map(c => [c.clave, c.sugerido]), [['C1', 1000000]]);
  assert.equal((await pedir('/empaques', 982, 'PUT', { clave: 'C1', piezas: 100 })).status, 403);
  assert.equal((await pedir('/empaques', 983, 'PUT', { clave: 'C1', piezas: 100 })).status, 403);
  assert.equal((await pedir('/empaques', 984, 'PUT', { clave: 'C1', piezas: 1 })).status, 400);
  assert.equal((await pedir('/empaques', 984, 'PUT', { clave: 'C1', piezas: 100, actor: 'Suplantado' })).status, 200);
  assert.equal(sqlite.prepare('SELECT confirmado_por FROM resurtido_empaques').get().confirmado_por, '984');
  assert.equal((await pedir('/empaques', 984)).datos.claves[0].confirmado.nombre_por, 'Actor 984');
  assert.equal((await pedir('/empaques', 983, 'DELETE', { clave: 'C1' })).status, 403);
  assert.equal((await pedir('/empaques', 984, 'DELETE', { clave: 'C1' })).status, 200);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM resurtido_empaques').get().n, 0);
});

test('avisos: cada tienda ve y decide solo los suyos; permisos vecinos no alcanzan', async () => {
  assert.equal((await pedir('/avisos', 981)).status, 403);
  const propia = await pedir('/avisos', 982);
  assert.equal(propia.status, 200); assert.deepEqual(propia.datos.avisos.map(a => a.sucursal_id), [3]);
  assert.equal((await pedir('/avisos?sucursal_id=1', 982)).status, 403);
  const todas = await pedir('/avisos?sucursal_id=todas', 988);
  assert.deepEqual(todas.datos.avisos.map(a => a.sucursal_id).sort(), [1, 3]);
  const de3 = propia.datos.avisos[0].id, de1 = todas.datos.avisos.find(a => a.sucursal_id === 1).id;
  assert.equal((await pedir(`/avisos/${de3}/decision`, 987, 'POST', { decision: 'esperar' })).status, 403);
  assert.equal((await pedir(`/avisos/${de3}/decision`, 982, 'POST', { decision: 'esperar' })).status, 403);
  assert.equal((await pedir(`/avisos/${de3}/decision`, 988, 'POST', { decision: 'esperar' })).status, 403);
  assert.equal((await pedir(`/avisos/${de1}/decision`, 987, 'POST', { decision: 'nada' })).status, 400);
  assert.equal((await pedir(`/avisos/${de1}/decision`, 987, 'POST', { decision: 'esperar', actor: 'Suplantado' })).status, 200);
  assert.equal(sqlite.prepare('SELECT actor FROM resurtido_avisos WHERE id=?').get(de1).actor, '987');
  const extra = await pedir(`/avisos/${de1}/decision`, 987, 'POST', { decision: 'pedir' });
  assert.equal(extra.status, 200);
  assert.equal(sqlite.prepare('SELECT tipo FROM resurtido_pedidos WHERE id=?').get(extra.datos.pedido_id).tipo, 'extra');
  assert.equal((await pedir(`/avisos/${de1}/decision`, 987, 'POST', { decision: 'pedir' })).status, 409);
});
