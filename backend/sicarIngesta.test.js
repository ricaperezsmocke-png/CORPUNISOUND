const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { randomUUID, createHash } = require('node:crypto');
const { crearRepositorioSicar } = require('./sicarRepositorio');

function lote() {
  return {
    schema_version: 1, mapping_version: 'ocosingo-f0-v1', batch_id: randomUUID(), sequence: '1',
    captured_at: '2026-10-13T18:00:00.000Z', mode: 'incremental',
    window: { from: '2026-10-11T12:00:00-06:00', to: '2026-10-13T12:00:00-06:00' },
    clientes: [{ cli_id: '9007199254740993', nombre: 'José Muñoz', telefono: '9191234567', celular: null, email: null, rfc: null }],
    ventas: [{ ven_id: '4501', cli_id: '9007199254740993', fecha_local: '2026-10-12T16:30:00',
      timezone: 'America/Mexico_City', moneda: 'MXN', estado: 'vigente', total: '100.00',
      detalle: [{ art_id: '81', clave: 'CABLE', descripcion: 'Cable acústico', cantidad: '2.0000',
        precio_con: '50.0000', precio_sin: '43.1034', importe_con: '100.00', descuento_total: '0.00' }] }],
  };
}

test('el contrato conserva acentos e ids grandes sin convertirlos a Number', () => {
  const entrada = lote();
  const { validarLoteSicar } = require('./sicarIngesta');
  assert.deepEqual(validarLoteSicar(entrada), entrada);
});

const casos = [
  ['tienda falsificada', b => { b.sucursal_id = 2; }, 400],
  ['propiedad anidada no declarada', b => { b.clientes[0].saldo = 12; }, 400],
  ['SQL en lugar de estructura', b => { b.ventas = 'SELECT * FROM venta'; }, 422],
  ['versión desconocida', b => { b.schema_version = 2; }, 400],
  ['estado desconocido', b => { b.ventas[0].estado = 'abierta'; }, 422],
  ['id cero', b => { b.clientes[0].cli_id = '0'; }, 422],
  ['id numérico', b => { b.clientes[0].cli_id = 123; }, 422],
  ['id ambiguo', b => { b.clientes[0].cli_id = '001'; }, 422],
  ['nombre excesivo', b => { b.clientes[0].nombre = 'á'.repeat(251); }, 422],
  ['teléfono excesivo', b => { b.clientes[0].telefono = '9'.repeat(41); }, 422],
  ['clientes excesivos', b => { b.clientes = Array.from({ length: 101 }, (_, i) => ({ cli_id: String(i + 1), nombre: 'Á' })); }, 422],
  ['ventas excesivas', b => { b.ventas = Array(101).fill(b.ventas[0]); }, 422],
  ['detalle excesivo', b => { b.ventas[0].detalle = Array(501).fill(b.ventas[0].detalle[0]); }, 422],
  ['detalle vacío vigente', b => { b.ventas[0].detalle = []; }, 422],
  ['detalle vacío cancelada', b => { b.ventas[0].estado = 'cancelada'; b.ventas[0].detalle = []; }, 422],
  ['cliente duplicado', b => { b.clientes.push(b.clientes[0]); }, 422],
  ['artículo duplicado', b => { b.ventas[0].detalle.push(b.ventas[0].detalle[0]); }, 422],
  ['fecha imposible', b => { b.ventas[0].fecha_local = '2026-02-30T16:30:00'; }, 422],
  ['zona incorrecta', b => { b.ventas[0].timezone = 'UTC'; }, 422],
  ['moneda incorrecta', b => { b.ventas[0].moneda = 'USD'; }, 422],
];
for (const campo of ['total', 'importe_con', 'descuento_total']) {
  for (const valor of ['-1.00', '1', '1.001', '1e2', 'NaN', '90071992547409.92', 100]) {
    casos.push([`${campo} inválido ${valor}`, b => {
      const destino = campo === 'total' ? b.ventas[0] : b.ventas[0].detalle[0];
      destino[campo] = valor;
    }, 422]);
  }
}
for (const [nombre, cambiar, status] of casos) {
  test(`rechaza ${nombre} sin modificar el argumento`, () => {
    const { validarLoteSicar } = require('./sicarIngesta');
    const b = lote();
    cambiar(b);
    const antes = structuredClone(b);
    assert.throws(() => validarLoteSicar(b), e => e.status === status);
    assert.deepEqual(b, antes);
  });
}

test('migración v2 idempotente: acepta diferencia y calcula cuadra al centavo sin recalcular el total', t => {
  const sqlite = new Database(':memory:');
  t.after(() => sqlite.close());
  const repo = crearRepositorioSicar(sqlite);
  for (const [sequence, importe, cuadra] of [['1', '90.00', 0], ['2', '100.00', 1]]) {
    const b = lote();
    b.sequence = sequence;
    b.ventas[0].detalle[0].importe_con = importe;
    b.ventas[0].detalle[0].precio_con = '999.0000';
    repo.aplicarLote({ sucursalId: 1, lote: b, hash: sequence });
    assert.deepEqual(sqlite.prepare('SELECT total_centavos, cuadra FROM sicar_ventas').get(), { total_centavos: 10000, cuadra });
  }
  crearRepositorioSicar(sqlite);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM sicar_esquema WHERE version=2').get().n, 1);
  const b = { ...lote(), sequence: '3', mapping_version: null, clientes: [], ventas: [{ ven_id: '4501', estado: 'cancelada' }] };
  repo.aplicarLote({ sucursalId: 1, lote: b, hash: '3' });
  assert.equal(sqlite.prepare('SELECT mapping_version FROM sicar_tiendas').get().mapping_version, 'ocosingo-f0-v1');
  assert.equal(sqlite.prepare('SELECT cuadra FROM sicar_ventas').get().cuadra, 1);
});

test('llave de 32 bytes: hash persistido, autenticación constante y revocación inmediata', t => {
  const sqlite = new Database(':memory:');
  t.after(() => sqlite.close());
  const repo = crearRepositorioSicar(sqlite);
  const { crearLlaveSicar, autenticarLlaveSicar } = require('./sicarIngesta');
  const creada = crearLlaveSicar(repo, 1, '7');
  const [keyId, secreto] = creada.llave.split('.');
  assert.equal(Buffer.from(secreto, 'hex').length, 32);
  const fila = sqlite.prepare('SELECT * FROM sicar_llaves').get();
  assert.equal(fila.secreto_hash, createHash('sha256').update(secreto).digest('hex'));
  assert.ok(!JSON.stringify(repo.listarLlaves()).includes(secreto));
  assert.ok(!JSON.stringify(repo.listarLlaves()).includes(fila.secreto_hash));
  assert.equal(autenticarLlaveSicar(repo, `Bearer ${creada.llave}`).sucursal_id, 1);
  assert.equal(autenticarLlaveSicar(repo, `Bearer ${keyId}.${'0'.repeat(64)}`), null);
  repo.revocarLlave(keyId);
  assert.equal(autenticarLlaveSicar(repo, `Bearer ${creada.llave}`), null);
});

test('ritmo: doce por minuto, nueva ventana y un solo lote por tienda entre llaves rotadas', () => {
  const { crearControlSicar } = require('./sicarIngesta');
  let ahora = 1000;
  const control = crearControlSicar(() => ahora);
  for (let i = 0; i < 12; i++) assert.equal(control.admitir('llave:a'), true);
  assert.equal(control.admitir('llave:a'), false);
  assert.equal(control.admitir('llave:b'), true);
  ahora += 60000;
  assert.equal(control.admitir('llave:a'), true);
  assert.equal(control.ocupar(1), true);
  assert.equal(control.ocupar(1), false);
  assert.equal(control.ocupar(2), true);
  control.liberar(1);
  assert.equal(control.ocupar(1), true);
});

test('admite mil detalles y rechaza el detalle mil uno en el lote completo', () => {
  const { validarLoteSicar } = require('./sicarIngesta');
  const b = lote();
  const detalle = Array.from({ length: 500 }, (_, i) => ({ ...b.ventas[0].detalle[0], art_id: String(i + 1) }));
  b.ventas = ['1', '2'].map(ven_id => ({ ...b.ventas[0], ven_id, detalle }));
  assert.doesNotThrow(() => validarLoteSicar(b));
  b.ventas.push({ ...b.ventas[0], ven_id: '3', detalle: [detalle[0]] });
  assert.throws(() => validarLoteSicar(b), e => e.status === 422 && e.codigo === 'LIMITE_ENTIDADES');
});

test('migrar una base v1 con datos calcula cuadra sin alterar clientes, importes ni recibos', t => {
  const sqlite = new Database(':memory:');
  t.after(() => sqlite.close());
  const repo = crearRepositorioSicar(sqlite);
  const b = lote();
  b.ventas[0].detalle[0].importe_con = '90.00';
  repo.aplicarLote({ sucursalId: 1, lote: b, hash: 'v1' });
  const recibos = sqlite.prepare('SELECT * FROM sicar_envios').all();
  const clientes = sqlite.prepare('SELECT * FROM sicar_clientes').all();
  // Reconstruye el esquema anterior sin depender de una copia del código de producción.
  sqlite.exec('ALTER TABLE sicar_ventas DROP COLUMN cuadra; DELETE FROM sicar_esquema WHERE version=2');
  crearRepositorioSicar(sqlite);
  assert.deepEqual(sqlite.prepare('SELECT cuadra, total_centavos FROM sicar_ventas').get(), { cuadra: 0, total_centavos: 10000 });
  assert.deepEqual(sqlite.prepare('SELECT * FROM sicar_envios').all(), recibos);
  assert.deepEqual(sqlite.prepare('SELECT * FROM sicar_clientes').all(), clientes);
  crearRepositorioSicar(sqlite);
  assert.deepEqual(sqlite.prepare('SELECT version FROM sicar_esquema ORDER BY version').all(), [{ version: 1 }, { version: 2 }]);
});
