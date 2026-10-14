const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'vinculos-sicar-prueba';
process.env.NODE_ENV = 'test';
process.env.SENTRY_ENABLED = 'false';
const app = require('./server');
const { obtenerConexionSqlite } = require('./persistencia');
const { firmarToken } = require('./auth');
const { crearRepositorioSicar } = require('./sicarRepositorio');
const { crearLlaveSicar } = require('./sicarIngesta');
const sqlite = obtenerConexionSqlite();
const repo = crearRepositorioSicar(sqlite);
let servidor, base, admin, local, vecino, llave;
const fuente = (cli_id = '100', telefono = '9191234567') => ({ cli_id, nombre: 'José Muñoz', telefono });
const nativo = (id = 10, telefono = '9191234567', sucursal_id = 1) => ({ id, nombre: 'Ana', telefono, sucursal_id });
const vinculo = (sucursal = 1, id = '100') => sqlite.prepare('SELECT * FROM sicar_vinculos WHERE sucursal_id=? AND cli_id=?').get(sucursal, id);

before(async () => {
  const propios = ['resolver_vinculos_sicar', 'crear_cliente', 'registrar_demanda'];
  for (const [id, permisos] of [[991, [...propios, 'ver_todas_las_sucursales']], [992, propios],
    [993, ['ver_clientes_sicar', 'ver_sincronizacion_sicar']]]) {
    app.DB.admin.roles.push({ id, nombre: id === 991 ? 'Administrador' : `Prueba ${id}`, permisos, modulos: ['sicar', 'crm', 'radar_demanda'] });
    app.DB.admin.usuarios.push({ id, nombre: 'Prueba', usuario: `vinculos${id}`, rol_id: id, sucursal_id: 1, activo: true });
  }
  [admin, local, vecino] = [991, 992, 993].map(id => firmarToken({ id, rol_id: id, sucursal_id: 1 }));
  await new Promise(resolve => { servidor = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});
beforeEach(() => {
  for (const tabla of ['decisiones', 'vinculos', 'detalles', 'ventas', 'clientes', 'intentos', 'envios', 'llaves', 'tiendas']) {
    sqlite.exec(`DELETE FROM sicar_${tabla}`);
  }
  app.DB.crm.clientes = [nativo()];
  app.DB.radar_demanda = { registros: [], seguimientos: [], ultimo_id: 0, ultimo_seguimiento_id: 0 };
  llave = crearLlaveSicar(repo, 1, 991).llave;
});
after(async () => {
  servidor?.closeAllConnections();
  if (servidor) await new Promise(resolve => servidor.close(resolve));
  sqlite.close();
});
async function pedir(ruta, token = admin, body) {
  const res = await fetch(base + ruta, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token || ''}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const texto = await res.text();
  let datos;
  try { datos = JSON.parse(texto); } catch { datos = texto; }
  return { status: res.status, datos };
}
function compra(cli_id = '100') {
  return { ven_id: '900', cli_id, fecha_local: '2026-10-12T16:30:00', timezone: 'America/Mexico_City',
    estado: 'vigente', moneda: 'MXN', total: '100.00', detalle: [{ art_id: '8', descripcion: 'Cable',
      cantidad: '1.0000', precio_con: '100.0000', precio_sin: '86.2069', importe_con: '100.00', descuento_total: '0.00' }] };
}
async function importar(clientes = [fuente()], ventas = [], token = llave, sequence = '1') {
  const respuesta = await pedir('/api/integraciones/sicar/v1/lotes', token, {
    schema_version: 1, mapping_version: 'ocosingo-f0-v1', batch_id: randomUUID(), sequence,
    captured_at: '2026-10-13T18:00:00Z', mode: 'incremental',
    window: { from: '2026-10-11T12:00:00-06:00', to: '2026-10-13T12:00:00-06:00' }, clientes, ventas,
  });
  assert.equal(respuesta.status, 200, JSON.stringify(respuesta.datos));
}
const decidir = (accion, version, token = admin, sucursal = 1) => pedir(`/api/sicar/vinculos/${sucursal}/100/resolver?sucursal_id=4`, token,
  { accion, expected_version: String(version), motivo: 'Revisión con el cliente' });

test('única coincidencia crea pendiente, agrupa compras y no muta el JSON nativo', async () => {
  const antes = structuredClone(app.DB);
  const json = sqlite.prepare('SELECT * FROM estado').all();
  await importar([fuente()], [compra()]);
  assert.equal(vinculo()?.cliente_id, 10);
  assert.equal(vinculo().estado, 'pendiente');
  const r = await pedir('/api/sicar/vinculos');
  assert.equal(r.status, 200);
  assert.equal(r.datos.items[0].cliente_ref, 'crm:10');
  assert.equal(r.datos.items[0].monto_centavos, 10000);
  assert.equal(r.datos.items[0].numero_compras, 1);
  assert.deepEqual(app.DB, antes);
  assert.deepEqual(sqlite.prepare('SELECT * FROM estado').all(), json);
});

for (const [caso, telefono, nativos] of [
  ['sin coincidencia', '9197654321', [nativo()]],
  ['id cero', '9191234567', [nativo(0)]],
  ['vacío, mismo nombre y RFC genérico', '', [{ ...nativo(), nombre: 'José Muñoz', rfc: 'XAXX010101000' }]],
  ['corto', '1234567', [nativo(10, '1234567')]],
  ['extranjero', '+1 9191234567', [nativo()]],
  ['prefijo ambiguo', '9999191234567', [nativo()]],
  ['varios candidatos', '9191234567', [nativo(), nativo(11)]],
]) test(`${caso}: conserva referencia externa sin unir`, async () => {
  app.DB.crm.clientes = nativos;
  await importar([{ ...fuente('100', telefono), rfc: 'XAXX010101000' }]);
  assert.equal(vinculo()?.cliente_id, null);
  const r = await pedir('/api/sicar/vinculos');
  assert.equal(r.status, 200);
  assert.equal(r.datos.items[0].cliente_ref, 'sicar:1:100');
  assert.equal(r.datos.items[0].numero_compras, 0);
  assert.equal(r.datos.items[0].monto_centavos, 0);
  assert.equal(r.datos.items[0].ultima_compra, null);
});

test('teléfono y celular con candidatos distintos quedan en revisión visible', async () => {
  app.DB.crm.clientes.push(nativo(11, '9197654321'));
  await importar([{ ...fuente(), celular: '9197654321' }]);
  assert.equal(vinculo()?.estado, 'revision');
  assert.equal(vinculo().cliente_id, null);
});

test('confirmar conserva compras; deshacer las devuelve y la relectura no vuelve a unir', async () => {
  await importar([fuente()], [compra()]);
  const ventas = sqlite.prepare('SELECT * FROM sicar_ventas').all();
  const detalles = sqlite.prepare('SELECT * FROM sicar_detalles').all();
  const uno = await decidir('confirmar', 1);
  assert.equal(uno.status, 200);
  assert.equal(vinculo().estado, 'confirmado');
  assert.equal((await decidir('deshacer', 2)).status, 200);
  assert.equal(vinculo().cliente_id, null);
  await importar([{ ...fuente(), nombre: 'Nombre actualizado' }], [], llave, '2');
  assert.equal(vinculo().cliente_id, null);
  const r = await pedir('/api/sicar/vinculos');
  assert.equal(r.datos.items[0].cliente_ref, 'sicar:1:100');
  assert.equal(r.datos.items[0].nombre, 'Nombre actualizado');
  assert.equal(r.datos.items[0].monto_centavos, 10000);
  assert.deepEqual(sqlite.prepare('SELECT * FROM sicar_ventas').all(), ventas);
  assert.deepEqual(sqlite.prepare('SELECT * FROM sicar_detalles').all(), detalles);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM sicar_decisiones WHERE bloquear_union=1').get().n, 1);
});

test('dos revisores con la misma versión reciben 200 y 409 sin pisar la decisión', async () => {
  await importar();
  const respuestas = await Promise.all([decidir('confirmar', 1), decidir('deshacer', 1)]);
  assert.deepEqual(respuestas.map(r => r.status).sort(), [200, 409]);
  assert.equal(vinculo().version, 2);
});

test('cambiar teléfono confirmado conserva el enlace y muestra aviso', async () => {
  await importar();
  assert.equal((await decidir('confirmar', 1)).status, 200);
  await importar([fuente('100', '9197654321')], [], llave, '2');
  assert.equal(vinculo().cliente_id, 10);
  assert.equal(vinculo().estado, 'confirmado');
  assert.match(vinculo().motivo, /cambi|conflicto/i);
  assert.equal(vinculo().version, 3);
});

test('compra corregida cambia de ficha una sola vez y recalcula ambos resúmenes', async () => {
  await importar([fuente(), fuente('101', '9197654321')], [compra()]);
  await importar([], [compra('101')], llave, '2');
  const r = await pedir('/api/sicar/vinculos');
  assert.equal(r.status, 200);
  const porId = Object.fromEntries(r.datos.items.map(c => [c.cli_id, c]));
  assert.equal(porId['100'].monto_centavos, 0);
  assert.equal(porId['100'].numero_compras, 0);
  assert.equal(porId['100'].ultima_compra, null);
  assert.equal(porId['101'].monto_centavos, 10000);
  assert.equal(porId['101'].numero_compras, 1);
});

test('identidad incluye tienda, lectura local no filtra nombres ajenos y selector no autoriza', async () => {
  await importar();
  const llave2 = crearLlaveSicar(repo, 2, 991).llave;
  await importar([{ ...fuente(), nombre: 'Nombre ajeno' }], [compra()], llave2);
  assert.equal(vinculo(2)?.cliente_id, 10);
  const r = await pedir('/api/sicar/vinculos?sucursal_id=2', local);
  assert.equal(r.status, 200);
  assert.equal(r.datos.items.length, 1);
  assert.equal(r.datos.items[0].monto_centavos, 0);
  assert.ok(!JSON.stringify(r.datos).includes('Nombre ajeno'));
  assert.equal((await decidir('confirmar', 1, local, 2)).status, 404);
  assert.equal((await decidir('confirmar', 1, admin, 2)).status, 200);
});

test('login y permiso propio obligatorios aunque tenga permisos vecinos', async () => {
  for (const body of [undefined, { accion: 'confirmar', expected_version: 1, motivo: 'Revisado' }]) {
    const url = body ? '/api/sicar/vinculos/1/100/resolver' : '/api/sicar/vinculos';
    assert.equal((await pedir(url, '', body)).status, 401);
    assert.equal((await pedir(url, vecino, body)).status, 403);
  }
});

test('público F0 nunca genera ficha ni vínculo', async () => {
  await importar([fuente('1'), { ...fuente('4566'), nombre: 'PÚBLICO EN GENERAL 2' }, fuente()]);
  const r = await pedir('/api/sicar/vinculos');
  assert.equal(r.status, 200);
  assert.deepEqual(r.datos.items.map(c => c.cli_id), ['100']);
  assert.equal(vinculo(1, '1'), undefined);
  assert.equal(vinculo(1, '4566'), undefined);
});

for (const radar of [false, true]) {
  const alta = () => radar
    ? pedir('/api/radar-demanda?sucursal_id=1', local, { producto_buscado: 'Guitarra', cantidad: 1,
      motivo_no_venta: 'NO_MANEJAMOS', intencion_compra: true, consentimiento_aviso: true,
      nombre_contacto: 'Nueva persona', telefono_contacto: '9197654321' })
    : pedir('/api/clientes', local, { nombre: 'Nueva persona', telefono: '9197654321', sucursal_id: '1' });
  test(`alta ${radar ? 'Radar' : 'manual'} vuelve a resolver sin duplicar ni trasladar demandas`, async () => {
    await importar([fuente('100', '9197654321')]);
    const r = await alta();
    assert.equal(r.status, 200, JSON.stringify(r.datos));
    const nuevo = app.DB.crm.clientes.find(c => c.nombre === 'Nueva persona');
    assert.equal(vinculo()?.cliente_id, nuevo.id);
    assert.equal(app.DB.crm.clientes.length, 2);
    if (radar) {
      assert.equal(app.DB.radar_demanda.registros[0].cliente_id, nuevo.id);
      assert.equal(app.DB.radar_demanda.registros[0].sucursal_id, 1);
    }
    const persistido = JSON.parse(sqlite.prepare('SELECT datos FROM estado WHERE id=1').get().datos);
    assert.deepEqual(persistido.crm.clientes, app.DB.crm.clientes);
  });
  test(`fallo de decisión revierte alta ${radar ? 'Radar' : 'manual'}, memoria y SQLite`, async () => {
    await importar([fuente('100', '9197654321')]);
    const antes = structuredClone(app.DB);
    const json = sqlite.prepare('SELECT * FROM estado').all();
    sqlite.exec(`CREATE TEMP TRIGGER fallar_decision BEFORE INSERT ON sicar_decisiones BEGIN SELECT RAISE(ABORT, 'fallo'); END`);
    try {
      const r = await alta();
      assert.equal(r.status, 503);
      assert.deepEqual(app.DB, antes);
      assert.deepEqual(sqlite.prepare('SELECT * FROM estado').all(), json);
      assert.equal(vinculo().cliente_id, null);
    } finally { sqlite.exec('DROP TRIGGER fallar_decision'); }
  });
}

test('prefijo mexicano explícito +52 se normaliza sin aceptar otros prefijos', async () => {
  await importar([fuente('100', '+52 (919) 123-4567')]);
  assert.equal(vinculo()?.cliente_id, 10);
});

test('ids públicos documentados F0 Ocosingo se excluyen aunque cambie su nombre', async () => {
  await importar(['2', '3', '13', '21', '33', '4566', '4567', '4572'].map(id => fuente(id)));
  assert.equal(sqlite.prepare('SELECT count(*) n FROM sicar_vinculos').get().n, 0);
});

test('el alta devuelve el aviso de unión pendiente para pantalla y Radar', async () => {
  await importar([fuente('100', '9197654321')]);
  const r = await pedir('/api/clientes', local, { nombre: 'Alta con aviso', telefono: '9197654321', sucursal_id: '1' });
  assert.equal(r.status, 200);
  assert.equal(r.datos.aviso_sicar, 'Unión SICAR pendiente de revisión.');
  assert.equal(app.DB.crm.clientes.find(c => c.nombre === 'Alta con aviso').aviso_sicar, undefined);
});

test('un fallo al hacer COMMIT restaura memoria y no responde éxito', async () => {
  await importar([fuente('100', '9197654321')]);
  const antes = structuredClone(app.DB);
  const json = sqlite.prepare('SELECT * FROM estado').all();
  sqlite.exec(`CREATE TEMP TABLE padre_commit(id INTEGER PRIMARY KEY);
    CREATE TEMP TABLE hijo_commit(id INTEGER REFERENCES padre_commit(id) DEFERRABLE INITIALLY DEFERRED);
    CREATE TEMP TRIGGER fallo_commit AFTER INSERT ON sicar_decisiones BEGIN INSERT INTO hijo_commit VALUES (999); END`);
  try {
    const r = await pedir('/api/clientes', local, { nombre: 'Alta fallida', telefono: '9197654321', sucursal_id: '1' });
    assert.equal(r.status, 503);
    assert.deepEqual(app.DB, antes);
    assert.deepEqual(sqlite.prepare('SELECT * FROM estado').all(), json);
    assert.equal(vinculo().cliente_id, null);
  } finally { sqlite.exec('DROP TRIGGER fallo_commit; DROP TABLE hijo_commit; DROP TABLE padre_commit'); }
});

test('unión con nativo ajeno no revela su nombre y solo Administrador la resuelve', async () => {
  app.DB.crm.clientes = [nativo(10, '9191234567', 2)];
  await importar();
  const r = await pedir('/api/sicar/vinculos', local);
  assert.equal(r.status, 200);
  assert.equal(r.datos.items[0].cliente_nombre, null);
  assert.equal(r.datos.items[0].puede_resolver, false);
  assert.equal((await decidir('confirmar', 1, local)).status, 404);
  assert.equal((await decidir('confirmar', 1, admin)).status, 200);
});

test('decisión inválida, sin motivo o con versión mal formada no cambia nada', async () => {
  await importar();
  const antes = vinculo();
  for (const datos of [
    { accion: 'confirmar', expected_version: 1, motivo: '' },
    { accion: 'inventar', expected_version: 1, motivo: 'Revisado' },
    { accion: 'confirmar', expected_version: null, motivo: 'Revisado' },
    { accion: 'confirmar', expected_version: true, motivo: 'Revisado' },
    { accion: 'confirmar', expected_version: 1, motivo: 'Revisado', cliente_id: '99' },
  ]) {
    assert.equal((await pedir('/api/sicar/vinculos/1/100/resolver', admin, datos)).status, 400);
    assert.deepEqual(vinculo(), antes);
  }
});
