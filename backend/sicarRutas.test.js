const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const http = require('node:http');
process.env.DB_PATH = ':memory:';
process.env.SENTRY_ENABLED = 'false';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'sicar-prueba-desechable';
const app = require('./server');
const { obtenerConexionSqlite } = require('./persistencia');
const { firmarToken } = require('./auth');
const mantenimiento = require('./mantenimiento');
const sqlite = obtenerConexionSqlite();
let servidor, base, admin, local, vecino;

before(async () => {
  const permisos = ['administrar_llaves_sicar', 'ver_sincronizacion_sicar', 'resolver_vinculos_sicar', 'ver_clientes_sicar'];
  for (const [id, claves] of [[991, [...permisos, 'ver_todas_las_sucursales']], [992, permisos], [993, permisos.slice(2)]]) {
    app.DB.admin.roles.push({ id, nombre: `Prueba ${id}`, permisos: claves, modulos: ['sicar'] });
    app.DB.admin.usuarios.push({ id, nombre: 'Prueba SICAR', usuario: `sicar${id}`, rol_id: id, sucursal_id: 1, activo: true });
  }
  [admin, local, vecino] = [991, 992, 993].map(id => firmarToken({ id, rol_id: id, sucursal_id: 1 }));
  await new Promise(resolve => { servidor = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(async () => {
  mantenimiento.desactivar();
  servidor?.closeAllConnections();
  if (servidor) await new Promise(resolve => servidor.close(resolve));
  sqlite.close();
});

async function pedir(ruta, token, body, method = body === undefined ? 'GET' : 'POST') {
  const res = await fetch(base + ruta, {
    method, headers: { Authorization: `Bearer ${token || ''}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const texto = await res.text();
  let datos;
  try { datos = JSON.parse(texto); } catch { datos = texto; }
  return { status: res.status, datos };
}
async function llave(sucursal = 1) {
  const r = await pedir('/api/sicar/llaves', admin, { sucursal_id: String(sucursal) });
  assert.equal(r.status, 201);
  return r.datos;
}
function lote(sequence = '1') {
  return {
    schema_version: 1, mapping_version: 'ocosingo-f0-v1', batch_id: randomUUID(), sequence,
    captured_at: '2026-10-13T18:00:00.000Z', mode: 'incremental',
    window: { from: '2026-10-11T12:00:00-06:00', to: '2026-10-13T12:00:00-06:00' },
    clientes: [{ cli_id: '123', nombre: 'José Muñoz', telefono: '9191234567', rfc: 'XAXX010101000' }],
    ventas: [{ ven_id: '4501', cli_id: '123', fecha_local: '2026-10-12T16:30:00',
      timezone: 'America/Mexico_City', moneda: 'MXN', estado: 'vigente', total: '100.00',
      detalle: [{ art_id: '81', descripcion: 'Cable acústico', cantidad: '2.0000', precio_con: '50.0000',
        precio_sin: '43.1034', importe_con: '90.00', descuento_total: '0.00' }] }],
  };
}
const ruta = '/api/integraciones/sicar/v1';

test('catálogo, guard y reconciliación conceden SICAR solo al Administrador', () => {
  const { sembrarRolesIniciales, reconciliarRoles } = require('./roles');
  const { PERMISOS, MODULOS_SISTEMA } = require('./permisosCatalogo');
  const { MODULOS_QUE_REQUIEREN_PERMISOS, validarSistemaDePermisos } = require('./validarPermisos');
  assert.equal(PERMISOS.filter(p => p.modulo === 'sicar').length, 4);
  assert.ok(MODULOS_SISTEMA.some(m => m.id === 'sicar'));
  assert.ok(MODULOS_QUE_REQUIEREN_PERMISOS.includes('sicar'));
  validarSistemaDePermisos();
  const DB = { admin: { roles: [] } };
  sembrarRolesIniciales(DB);
  const operativos = structuredClone(DB.admin.roles.slice(1));
  for (const rol of operativos) assert.equal(rol.permisos.some(p => p.endsWith('_sicar')), false);
  DB.admin.roles[0].permisos = [];
  reconciliarRoles(DB);
  assert.ok(DB.admin.roles[0].permisos.includes('administrar_llaves_sicar'));
  assert.deepEqual(DB.admin.roles.slice(1), operativos);
});

test('login, permisos vecinos y alcance del token protegen todas las rutas humanas', async () => {
  for (const [url, body] of [['/api/sicar/llaves'], ['/api/sicar/envios'],
    ['/api/sicar/llaves', { sucursal_id: 1 }], ['/api/sicar/llaves/inexistente/revocar', {}]]) {
    assert.equal((await pedir(url, undefined, body)).status, 401);
    assert.equal((await pedir(url, vecino, body)).status, 403);
  }
  assert.equal((await pedir('/api/sicar/llaves?sucursal_id=2', local, { sucursal_id: '2' })).status, 403);
  const ajena = await llave(2);
  assert.equal((await pedir(`/api/sicar/llaves/${ajena.key_id}/revocar?sucursal_id=2`, local, {})).status, 404);
  const r = await pedir('/api/sicar/llaves?sucursal_id=2', local);
  assert.equal(r.status, 200);
  assert.ok(r.datos.llaves.every(k => k.sucursal_id === 1));
  assert.ok(r.datos.tiendas.every(k => k.id === 1));
  assert.equal((await pedir(`/api/sicar/llaves/${ajena.key_id}/revocar?sucursal_id=1`, admin, {})).status, 200);
});

test('secreto se muestra una vez y llave inválida o revocada obtiene 401', async () => {
  const k = await llave();
  const lista = await pedir('/api/sicar/llaves', admin);
  assert.ok(!JSON.stringify(lista.datos).includes(k.llave));
  assert.ok(!JSON.stringify(lista.datos).includes('secreto_hash'));
  assert.equal((await pedir(`${ruta}/estado?sucursal_id=2`, k.llave)).datos.sucursal_id, 1);
  assert.equal((await pedir(`${ruta}/estado`, 'inexistente.secreto')).status, 401);
  await pedir(`/api/sicar/llaves/${k.key_id}/revocar`, admin, {});
  assert.equal((await pedir(`${ruta}/lotes`, k.llave, lote())).status, 401);
  const intento = sqlite.prepare('SELECT * FROM sicar_intentos ORDER BY id DESC LIMIT 1').get();
  assert.equal(intento.key_id, k.key_id);
  assert.equal(intento.sucursal_id, 1);
});

test('COMMIT, idempotencia, secuencia y acentos; nunca guarda JSON ni modifica DB', async () => {
  const k = await llave();
  const b = lote();
  const antesDB = structuredClone(app.DB);
  const antesJSON = sqlite.prepare('SELECT * FROM estado').all();
  sqlite.exec(`CREATE TEMP TRIGGER prohibir_json BEFORE UPDATE ON estado BEGIN SELECT RAISE(ABORT, 'JSON prohibido'); END`);
  try {
    const uno = await pedir(`${ruta}/lotes`, k.llave, b);
    assert.equal(uno.status, 200);
    assert.equal(sqlite.inTransaction, false);
    assert.equal(sqlite.prepare('SELECT nombre FROM sicar_clientes WHERE sucursal_id=1').get().nombre, 'José Muñoz');
    assert.equal(sqlite.prepare('SELECT cuadra FROM sicar_ventas WHERE sucursal_id=1').get().cuadra, 0);
    assert.deepEqual(await pedir(`${ruta}/lotes`, k.llave, b), uno);
    assert.equal((await pedir(`${ruta}/lotes`, k.llave, { ...b, mode: 'historico' })).status, 409);
    const fuera = await pedir(`${ruta}/lotes`, k.llave, lote('3'));
    assert.equal(fuera.status, 409);
    assert.equal(fuera.datos.siguiente_secuencia, '2');
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM sicar_envios WHERE sucursal_id=1').get().n, 1);
    assert.deepEqual(app.DB, antesDB);
    assert.deepEqual(sqlite.prepare('SELECT * FROM estado').all(), antesJSON);
  } finally { sqlite.exec('DROP TRIGGER prohibir_json'); }
});

test('rechazos de contrato/datos/parser se auditan sin PII ni secreto y sin avanzar', async () => {
  const k = await llave(3);
  const b = lote();
  const pruebas = [
    [{ ...b, tienda: 2 }, 400], [{ ...b, caja_id: 1 }, 400], [{ ...b, schema_version: 2 }, 400],
    [{ ...b, clientes: Array(101).fill(b.clientes[0]) }, 422], ['{"nombre":"José Muñoz",', 400],
    [' '.repeat(1048577), 413],
  ];
  for (const [entrada, status] of pruebas) assert.equal((await pedir(`${ruta}/lotes`, k.llave, entrada)).status, status);
  assert.equal((await pedir(`${ruta}/estado`, k.llave)).datos.siguiente_secuencia, '1');
  const intentos = sqlite.prepare('SELECT * FROM sicar_intentos WHERE key_id=?').all(k.key_id);
  assert.equal(intentos.length, 7);
  for (const secreto of ['José', '9191234567', 'XAXX010101000', k.llave.split('.')[1]]) {
    assert.ok(!JSON.stringify(intentos).includes(secreto));
  }
  assert.ok(intentos.some(i => i.codigo === '413' && i.recibidos === null));
  assert.ok(intentos.some(i => i.codigo === '400' && i.recibidos === null));
});

test('fallo transaccional devuelve 503 y rollback; referencia ajena devuelve 422 completo', async () => {
  const k = await llave(4);
  sqlite.exec(`CREATE TEMP TRIGGER fallar_sicar BEFORE INSERT ON sicar_envios BEGIN SELECT RAISE(ABORT, 'disco simulado'); END`);
  try { assert.equal((await pedir(`${ruta}/lotes`, k.llave, lote())).status, 503); }
  finally { sqlite.exec('DROP TRIGGER fallar_sicar'); }
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM sicar_clientes WHERE sucursal_id=4').get().n, 0);
  const b = lote();
  b.ventas[0].cli_id = '999';
  const r = await pedir(`${ruta}/lotes`, k.llave, b);
  assert.equal(r.status, 422);
  assert.equal(r.datos.aceptados, 0);
  assert.equal(r.datos.rechazados, 2);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM sicar_clientes WHERE sucursal_id=4').get().n, 0);
});

test('mantenimiento bloquea agente y creación de llaves con 503', async () => {
  const k = await llave();
  mantenimiento.activar('Prueba');
  try {
    assert.equal((await pedir(`${ruta}/lotes`, k.llave, lote())).status, 503);
    assert.equal((await pedir(`${ruta}/estado`, k.llave)).status, 503);
    assert.equal((await pedir('/api/sicar/llaves', admin, { sucursal_id: 1 })).status, 503);
  } finally { mantenimiento.desactivar(); }
});

test('mantenimiento: HEAD pasa como GET y un PUT de personal devuelve 503', async () => {
  app.DB.admin.roles.push({ id: 995, nombre: 'Prueba 995', permisos: ['asignar_cajeros_sicar', 'ver_cortes_sicar'], modulos: ['sicar'] });
  app.DB.admin.usuarios.push({ id: 995, nombre: 'Prueba SICAR', usuario: 'sicar995', rol_id: 995, sucursal_id: 1, activo: true });
  const t995 = firmarToken({ id: 995, rol_id: 995, sucursal_id: 1 });
  mantenimiento.activar('Prueba');
  try {
    const put = await pedir('/api/sicar/personal/1/52', t995, { nombre: 'Ana' }, 'PUT');
    assert.equal(put.status, 503);
    assert.equal(put.datos.codigo, 'MANTENIMIENTO');
    const head = await fetch(`${base}/api/sicar/cortes`, { method: 'HEAD', headers: { Authorization: `Bearer ${t995}` } });
    assert.notEqual(head.status, 503);
  } finally { mantenimiento.desactivar(); }
});

test('doce solicitudes por llave; la decimotercera responde 429', async () => {
  const k = await llave();
  for (let i = 0; i < 12; i++) assert.equal((await pedir(`${ruta}/estado`, k.llave)).status, 200);
  assert.equal((await pedir(`${ruta}/estado`, k.llave)).status, 429);
});

test('un lote lento ocupa la tienda incluso con otra llave; al abortar se libera', async () => {
  const a = await llave(2), b = await llave(2);
  const lenta = http.request(`${base}${ruta}/lotes`, {
    method: 'POST', headers: { Authorization: `Bearer ${a.llave}`, 'Content-Type': 'application/json', 'Content-Length': '1000' },
  });
  lenta.on('error', () => {});
  lenta.write('{');
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal((await pedir(`${ruta}/lotes`, b.llave, lote())).status, 429);
  lenta.destroy();
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal((await pedir(`${ruta}/lotes`, b.llave, lote())).status, 200);
});

test('Sentry descarta eventos SICAR con cuerpos y variables locales, preserva otros eventos', () => {
  const { depurarSecretos } = require('./instrument');
  for (const url of [`${ruta}/lotes`, '/api/sicar/llaves']) {
    assert.equal(depurarSecretos({ request: { url, data: 'José', headers: { Authorization: 'Bearer secreto' } },
      exception: { values: [{ stacktrace: { frames: [{ vars: { body: 'José' } }] } }] } }), null);
  }
  assert.deepEqual(depurarSecretos({ message: 'Otro error' }), { message: 'Otro error' });
});

test('errores de validación identifican el renglón sin copiar sus datos personales', async () => {
  const k = await llave(4);
  const b = lote();
  b.ventas[0].detalle[0].descuento_total = '-0.01';
  const respuesta = await pedir(`${ruta}/lotes`, k.llave, b);
  assert.equal(respuesta.status, 422);
  assert.equal(respuesta.datos.referencia, 'ventas[0].detalle[0]');
  assert.equal(respuesta.datos.aceptados, 0);
  assert.equal(respuesta.datos.rechazados, 2);
  assert.ok(!JSON.stringify(respuesta).includes('José'));
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM sicar_clientes WHERE sucursal_id=4').get().n, 0);
});

test('un batch existente con datos cambiados inválidos también produce conflicto de hash', async () => {
  const k = await llave(1);
  const b = lote('2');
  assert.equal((await pedir(`${ruta}/lotes`, k.llave, b)).status, 200);
  b.ventas[0].total = '-100.00';
  assert.equal((await pedir(`${ruta}/lotes`, k.llave, b)).status, 409);
});

test('el límite acepta exactamente 1 MiB y rechaza 1 MiB más un byte con transferencia fragmentada', async () => {
  const k = await llave(3);
  const contenido = JSON.stringify(lote());
  const exacto = contenido + ' '.repeat(1048576 - Buffer.byteLength(contenido));
  assert.equal((await pedir(`${ruta}/lotes`, k.llave, exacto)).status, 200);
  const status = await new Promise((resolve, reject) => {
    const solicitud = http.request(`${base}${ruta}/lotes`, {
      method: 'POST', headers: { Authorization: `Bearer ${k.llave}`, 'Content-Type': 'application/json' },
    }, respuesta => { respuesta.resume(); respuesta.once('end', () => resolve(respuesta.statusCode)); });
    solicitud.on('error', reject);
    solicitud.write(exacto);
    solicitud.end(' ');
  });
  assert.equal(status, 413);
  assert.equal((await pedir(`${ruta}/estado`, k.llave)).datos.siguiente_secuencia, '2');
});

test('UTF-8 inválido y compresión son rechazados antes de interpretar entidades', async () => {
  const k = await llave(4);
  for (const [contenido, extra] of [[Buffer.from([0xff, 0xfe]), {}], [Buffer.from('{}'), { 'Content-Encoding': 'gzip' }]]) {
    const r = await fetch(`${base}${ruta}/lotes`, { method: 'POST', headers: {
      Authorization: `Bearer ${k.llave}`, 'Content-Type': 'application/json', ...extra,
    }, body: contenido });
    assert.equal(r.status, 400);
    await r.text();
  }
  assert.equal((await pedir(`${ruta}/estado`, k.llave)).datos.siguiente_secuencia, '1');
});

test('si falla la auditoría después del COMMIT responde 503 y el reintento recupera el recibo', async () => {
  const k = await llave(4);
  const b = lote();
  sqlite.exec(`CREATE TEMP TRIGGER fallar_intento BEFORE INSERT ON sicar_intentos BEGIN SELECT RAISE(ABORT, 'disco simulado'); END`);
  try { assert.equal((await pedir(`${ruta}/lotes`, k.llave, b)).status, 503); }
  finally { sqlite.exec('DROP TRIGGER fallar_intento'); }
  assert.equal((await pedir(`${ruta}/lotes`, k.llave, b)).status, 200);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM sicar_envios WHERE sucursal_id=4').get().n, 1);
});

test('llave revocada durante la recepción no puede confirmar el lote', async () => {
  const k = await llave(4);
  const contenido = JSON.stringify(lote('2'));
  let solicitud;
  const resultado = new Promise((resolve, reject) => {
    solicitud = http.request(`${base}${ruta}/lotes`, { method: 'POST', headers: {
      Authorization: `Bearer ${k.llave}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(contenido),
    } }, r => { r.resume(); r.once('end', () => resolve(r.statusCode)); });
    solicitud.on('error', reject);
    solicitud.write(contenido.slice(0, 1));
  });
  await new Promise(resolve => setTimeout(resolve, 50));
  await pedir(`/api/sicar/llaves/${k.key_id}/revocar`, admin, {});
  solicitud.end(contenido.slice(1));
  assert.equal(await resultado, 401);
  assert.equal(sqlite.prepare('SELECT siguiente_secuencia FROM sicar_tiendas WHERE sucursal_id=4').get().siguiente_secuencia, '2');
});

test('los envíos y auditorías humanos no revelan otra tienda aunque cambie el selector', async () => {
  const r = await pedir('/api/sicar/envios?sucursal_id=4', local);
  assert.equal(r.status, 200);
  assert.ok(r.datos.envios.length > 0);
  assert.ok(r.datos.envios.every(e => e.sucursal_id === 1));
  assert.ok(r.datos.intentos.every(e => e.sucursal_id === 1));
});

test('los intentos sin autenticar también tienen límite por origen', async () => {
  const estados = [];
  for (let i = 0; i < 13; i++) estados.push((await pedir(`${ruta}/estado`, 'inexistente')).status);
  assert.ok(estados.includes(401));
  assert.equal(estados.at(-1), 429);
});
