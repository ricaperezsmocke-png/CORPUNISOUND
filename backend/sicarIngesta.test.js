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
  ['venta duplicada', b => { b.ventas.push(b.ventas[0]); }, 422],
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

test('articulos opcionales aceptan lote exclusivo y rechazan limites, duplicados y texto invalido', () => {
  const { validarLoteSicar } = require('./sicarIngesta');
  const articulo = { art_id: '81', clave: ' CABLE ', descripcion: ' Cable acustico ', categoria: ' Cables ', departamento: ' Audio ' };
  const soloArticulos = { ...lote(), clientes: [], ventas: [], articulos: [articulo] };
  assert.deepEqual(validarLoteSicar(soloArticulos), soloArticulos);
  for (const [nombre, cambiar, codigo] of [
    ['limite', b => { b.articulos = Array.from({ length: 501 }, (_, i) => ({ ...articulo, art_id: String(i + 1) })); }, 'LIMITE_ENTIDADES'],
    ['duplicado', b => { b.articulos.push({ ...articulo }); }, 'ID_DUPLICADO'],
    ['texto largo', b => { b.articulos[0].departamento = 'a'.repeat(101); }, 'TEXTO_INVALIDO'],
    ['utf8 invalido', b => { b.articulos[0].categoria = '\ufffd'; }, 'TEXTO_INVALIDO'],
  ]) {
    const entrada = structuredClone(soloArticulos);
    cambiar(entrada);
    assert.throws(() => validarLoteSicar(entrada), e => e.codigo === codigo, nombre);
  }
});

test('proveedores opcionales aceptan lote exclusivo y rechazan limites, duplicados, propiedades y texto invalido', () => {
  const { validarLoteSicar } = require('./sicarIngesta');
  const proveedor = { prv_id: '7', nombre: ' Casa Veerkamp ' };
  const soloProveedores = { ...lote(), clientes: [], ventas: [], proveedores: [proveedor] };
  assert.deepEqual(validarLoteSicar(soloProveedores), soloProveedores);
  for (const [nombre, cambiar, codigo] of [
    ['limite', b => { b.proveedores = Array.from({ length: 501 }, (_, i) => ({ ...proveedor, prv_id: String(i + 1) })); }, 'LIMITE_ENTIDADES'],
    ['duplicado', b => { b.proveedores.push({ ...proveedor }); }, 'ID_DUPLICADO'],
    ['id invalido', b => { b.proveedores[0].prv_id = 7; }, 'ID_INVALIDO'],
    ['propiedad extra', b => { b.proveedores[0].rfc = 'XAXX010101000'; }, 'PROPIEDAD_NO_DECLARADA'],
    ['sin nombre', b => { b.proveedores[0].nombre = '  '; }, 'TEXTO_INVALIDO'],
    ['nombre largo', b => { b.proveedores[0].nombre = 'a'.repeat(251); }, 'TEXTO_INVALIDO'],
    ['utf8 invalido', b => { b.proveedores[0].nombre = 'Casa �'; }, 'TEXTO_INVALIDO'],
    ['no es lista', b => { b.proveedores = 'SELECT * FROM proveedor'; }, 'LIMITE_ENTIDADES'],
  ]) {
    const entrada = structuredClone(soloProveedores);
    cambiar(entrada);
    assert.throws(() => validarLoteSicar(entrada), e => e.codigo === codigo, nombre);
  }
});

test('existencias opcionales aceptan lote exclusivo, nulos y rechazan formatos, limites, duplicados y propiedades', () => {
  const { validarLoteSicar } = require('./sicarIngesta');
  const soloExistencias = { ...lote(), clientes: [], ventas: [],
    existencias: [{ art_id: '7', existencia: '-1.0000' }, { art_id: '8', existencia: null }] };
  assert.deepEqual(validarLoteSicar(soloExistencias), soloExistencias);
  for (const [nombre, cambiar, codigo] of [
    ['entero', b => { b.existencias[0].existencia = '3'; }, 'IMPORTE_INVALIDO'],
    ['cinco decimales', b => { b.existencias[0].existencia = '3.12345'; }, 'IMPORTE_INVALIDO'],
    ['tres decimales', b => { b.existencias[0].existencia = '1.000'; }, 'IMPORTE_INVALIDO'],
    ['numero', b => { b.existencias[0].existencia = 3; }, 'IMPORTE_INVALIDO'],
    ['signo mas', b => { b.existencias[0].existencia = '+1.0000'; }, 'IMPORTE_INVALIDO'],
    ['espacio', b => { b.existencias[0].existencia = ' 1.0000'; }, 'IMPORTE_INVALIDO'],
    ['17 enteros', b => { b.existencias[0].existencia = '99999999999999999.0000'; }, 'IMPORTE_INVALIDO'],
    ['mayor a safe integer', b => { b.existencias[0].existencia = '9999999999999999.0000'; }, 'IMPORTE_INVALIDO'],
    ['duplicado', b => { b.existencias.push({ art_id: '7', existencia: '1.0000' }); }, 'ID_DUPLICADO'],
    ['limite', b => { b.existencias = Array.from({ length: 501 }, (_, i) => ({ art_id: String(i + 1), existencia: '1.0000' })); }, 'LIMITE_ENTIDADES'],
    ['propiedad extra', b => { b.existencias[0].clave = 'X'; }, 'PROPIEDAD_NO_DECLARADA'],
    ['id invalido', b => { b.existencias[0].art_id = 7; }, 'ID_INVALIDO'],
  ]) {
    const entrada = structuredClone(soloExistencias);
    cambiar(entrada);
    assert.throws(() => validarLoteSicar(entrada), e => e.codigo === codigo, nombre);
  }
  const cero = structuredClone(soloExistencias);
  cero.existencias[0].existencia = '-0.0000';
  assert.deepEqual(validarLoteSicar(cero), cero);
});

function corteValido(id = '5') {
  return { cor_id: id, caj_id: '2', fecha_local: '2026-10-22T20:15:00', usu_id: '3',
    contado: '1500.00', calculado: '1500.33', diferencia: '-0.33', retiro: '0.00',
    pagos: [{ tpa_id: '1', contado: '1000.00', calculado: '1000.33', diferencia: '-0.33', retiro: '0.00' },
      { tpa_id: '2', contado: '500.00', calculado: '500.00', diferencia: '0.00', retiro: '0.00' }],
    cobros: [{ usu_id: '3', ventas: 12, total: '1500.33', canceladas: 1, total_canceladas: '80.00' },
      { usu_id: null, ventas: 0, total: '0.00', canceladas: 0, total_canceladas: '0.00' }] };
}

test('cortes opcionales aceptan lote exclusivo y rechazan importes, duplicados, limites, propiedades y conteos', () => {
  const { validarLoteSicar } = require('./sicarIngesta');
  const soloCortes = { ...lote(), clientes: [], ventas: [], cortes: [corteValido()] };
  assert.deepEqual(validarLoteSicar(soloCortes), soloCortes);
  const sinUsuario = structuredClone(soloCortes);
  sinUsuario.cortes[0].usu_id = null;
  assert.deepEqual(validarLoteSicar(sinUsuario), sinUsuario);
  for (const [nombre, cambiar, codigo] of [
    ['un decimal', b => { b.cortes[0].diferencia = '1.5'; }, 'IMPORTE_INVALIDO'],
    ['numero', b => { b.cortes[0].diferencia = 1.5; }, 'IMPORTE_INVALIDO'],
    ['signo mas', b => { b.cortes[0].contado = '+1.00'; }, 'IMPORTE_INVALIDO'],
    ['mayor a safe integer', b => { b.cortes[0].retiro = '9999999999999999.00'; }, 'IMPORTE_INVALIDO'],
    ['importe de pago', b => { b.cortes[0].pagos[0].calculado = '1'; }, 'IMPORTE_INVALIDO'],
    ['total de cobro', b => { b.cortes[0].cobros[0].total = '3'; }, 'IMPORTE_INVALIDO'],
    ['tpa repetido', b => { b.cortes[0].pagos[1].tpa_id = '1'; }, 'ID_DUPLICADO'],
    ['usu repetido en cobros', b => { b.cortes[0].cobros[1].usu_id = '3'; }, 'ID_DUPLICADO'],
    ['null repetido en cobros', b => { b.cortes[0].cobros.push({ ...b.cortes[0].cobros[1] }); }, 'ID_DUPLICADO'],
    ['cor repetido', b => { b.cortes.push(corteValido()); }, 'ID_DUPLICADO'],
    ['limite de cortes', b => { b.cortes = Array.from({ length: 101 }, (_, i) => corteValido(String(i + 1))); }, 'LIMITE_ENTIDADES'],
    ['limite de pagos', b => { b.cortes[0].pagos = Array.from({ length: 9 }, (_, i) => ({ ...b.cortes[0].pagos[0], tpa_id: String(i + 1) })); }, 'LIMITE_ENTIDADES'],
    ['limite de cobros', b => { b.cortes[0].cobros = Array.from({ length: 51 }, (_, i) => ({ ...b.cortes[0].cobros[0], usu_id: String(i + 1) })); }, 'LIMITE_ENTIDADES'],
    ['propiedad extra en fila', b => { b.cortes[0].nombre = 'X'; }, 'PROPIEDAD_NO_DECLARADA'],
    ['propiedad extra en pago', b => { b.cortes[0].pagos[0].nombre = 'X'; }, 'PROPIEDAD_NO_DECLARADA'],
    ['propiedad extra en cobro', b => { b.cortes[0].cobros[0].nombre = 'X'; }, 'PROPIEDAD_NO_DECLARADA'],
    ['ventas negativas', b => { b.cortes[0].cobros[0].ventas = -1; }, 'DATOS_INVALIDOS'],
    ['ventas decimales', b => { b.cortes[0].cobros[0].ventas = 1.5; }, 'DATOS_INVALIDOS'],
    ['canceladas texto', b => { b.cortes[0].cobros[0].canceladas = '1'; }, 'DATOS_INVALIDOS'],
    ['ventas sobre el maximo', b => { b.cortes[0].cobros[0].ventas = 100001; }, 'DATOS_INVALIDOS'],
    ['fecha invalida', b => { b.cortes[0].fecha_local = '2026-10-22'; }, 'FECHA_INVALIDA'],
    ['cor invalido', b => { b.cortes[0].cor_id = 5; }, 'ID_INVALIDO'],
    ['caj invalido', b => { b.cortes[0].caj_id = '0'; }, 'ID_INVALIDO'],
    ['usu invalido', b => { b.cortes[0].usu_id = 3; }, 'ID_INVALIDO'],
    ['pagos no arreglo', b => { b.cortes[0].pagos = null; }, 'LIMITE_ENTIDADES'],
  ]) {
    const entrada = structuredClone(soloCortes);
    cambiar(entrada);
    assert.throws(() => validarLoteSicar(entrada), e => e.codigo === codigo, nombre);
  }
  const cero = structuredClone(soloCortes);
  cero.cortes[0].diferencia = '-0.00';
  assert.deepEqual(validarLoteSicar(cero), cero);
});

test('mostrador opcional acepta fila completa y cancelacion corta, y rechaza datos de persona, estados, importes y limites', () => {
  const { validarLoteSicar } = require('./sicarIngesta');
  const fila = (ven_id, n = 1) => ({ ven_id, fecha_local: '2026-10-22T10:00:00', estado: 'vigente', total: '100.00',
    detalle: Array.from({ length: n }, (_, i) => ({ art_id: String(i + 1), cantidad: '2.0000', importe_con: '100.00', descuento_total: '0.00' })) });
  const solo = { ...lote(), clientes: [], ventas: [], mostrador: [fila('9'), { ven_id: '10', estado: 'cancelada' }] };
  assert.deepEqual(validarLoteSicar(solo), solo);
  for (const [nombre, cambiar, codigo] of [
    ['cli_id', b => { b.mostrador[0].cli_id = '5'; }, 'PROPIEDAD_NO_DECLARADA'],
    ['nombre', b => { b.mostrador[0].nombre = 'Ana'; }, 'PROPIEDAD_NO_DECLARADA'],
    ['clave en renglon', b => { b.mostrador[0].detalle[0].clave = 'X'; }, 'PROPIEDAD_NO_DECLARADA'],
    ['descripcion en renglon', b => { b.mostrador[0].detalle[0].descripcion = 'Cable'; }, 'PROPIEDAD_NO_DECLARADA'],
    ['clave', b => { b.mostrador[0].clave = 'X'; }, 'PROPIEDAD_NO_DECLARADA'],
    ['descripcion', b => { b.mostrador[0].descripcion = 'X'; }, 'PROPIEDAD_NO_DECLARADA'],
    ['excluida', b => { b.mostrador[0].estado = 'excluida'; }, 'ESTADO_INVALIDO'],
    ['cancelacion corta con total', b => { b.mostrador[1].total = '1.00'; }, 'PROPIEDAD_NO_DECLARADA'],
    ['importe con un decimal', b => { b.mostrador[0].detalle[0].importe_con = '1.5'; }, 'IMPORTE_INVALIDO'],
    ['total con un decimal', b => { b.mostrador[0].total = '1.5'; }, 'IMPORTE_INVALIDO'],
    ['cantidad con 2 decimales', b => { b.mostrador[0].detalle[0].cantidad = '2.00'; }, 'IMPORTE_INVALIDO'],
    ['fecha invalida', b => { b.mostrador[0].fecha_local = '2026-10-22'; }, 'FECHA_INVALIDA'],
    ['detalle vacio', b => { b.mostrador[0].detalle = []; }, 'DETALLE_VACIO'],
    ['duplicado', b => { b.mostrador[1].ven_id = '9'; }, 'ID_DUPLICADO'],
    ['id invalido', b => { b.mostrador[0].ven_id = 9; }, 'ID_INVALIDO'],
    ['101 filas', b => { b.mostrador = Array.from({ length: 101 }, (_, i) => fila(String(i + 1))); }, 'LIMITE_ENTIDADES'],
    ['1001 renglones', b => { b.mostrador = [fila('1', 500), fila('2', 500), fila('3', 1)]; }, 'LIMITE_ENTIDADES'],
  ]) {
    const entrada = structuredClone(solo);
    cambiar(entrada);
    assert.throws(() => validarLoteSicar(entrada), e => e.codigo === codigo, nombre);
  }
  const mil = { ...solo, mostrador: [fila('1', 500), fila('2', 500)] };
  assert.deepEqual(validarLoteSicar(mil), mil);
});

function traspasoValido(id = '7') {
  return { tra_id: id, folio: 'T-0001', suc_origen: '1', suc_destino: '2', fecha: '2026-10-22', estado: 'enviado',
    fecha_aplicado: null, fecha_cancelado: null, total: '1500.50',
    detalle: [{ art_id: '10', cantidad: '3.0000', precio_sin: '100.00', precio_con: '116.00' },
      { art_id: '11', cantidad: '1.5000', precio_sin: '50.00', precio_con: '58.00' }] };
}
const renglonesTraspaso = n => Array.from({ length: n }, (_, i) => ({ art_id: String(i + 1), cantidad: '1.0000', precio_sin: '1.00', precio_con: '1.16' }));

test('traspasos opcionales aceptan lote exclusivo y rechazan estados, fechas, importes, duplicados, limites y propiedades', () => {
  const { validarLoteSicar } = require('./sicarIngesta');
  const solo = { ...lote(), clientes: [], ventas: [], traspasos: [traspasoValido()] };
  assert.deepEqual(validarLoteSicar(solo), solo);
  const recibido = structuredClone(solo);
  Object.assign(recibido.traspasos[0], { estado: 'recibido', fecha_aplicado: '2026-10-23T09:30:00' });
  assert.deepEqual(validarLoteSicar(recibido), recibido);
  const cancelado = structuredClone(solo);
  Object.assign(cancelado.traspasos[0], { estado: 'cancelado', fecha_cancelado: '2026-10-23T09:30:00' });
  assert.deepEqual(validarLoteSicar(cancelado), cancelado);
  for (const [nombre, cambiar, codigo] of [
    ['estado', b => { b.traspasos[0].estado = 'perdido'; }, 'ESTADO_INVALIDO'],
    ['fecha con hora', b => { b.traspasos[0].fecha = '2026-10-22T10:00:00'; }, 'FECHA_INVALIDA'],
    ['fecha inexistente', b => { b.traspasos[0].fecha = '2026-02-30'; }, 'FECHA_INVALIDA'],
    ['fecha_aplicado solo dia', b => { b.traspasos[0].fecha_aplicado = '2026-10-23'; }, 'FECHA_INVALIDA'],
    ['fecha_cancelado invalida', b => { b.traspasos[0].fecha_cancelado = '2026-13-01T00:00:00'; }, 'FECHA_INVALIDA'],
    ['fecha_aplicado ausente', b => { delete b.traspasos[0].fecha_aplicado; }, 'FECHA_INVALIDA'],
    ['total un decimal', b => { b.traspasos[0].total = '1.5'; }, 'IMPORTE_INVALIDO'],
    ['total numero', b => { b.traspasos[0].total = 1.5; }, 'IMPORTE_INVALIDO'],
    ['total mayor a safe integer', b => { b.traspasos[0].total = '99999999999999999.00'; }, 'IMPORTE_INVALIDO'],
    ['cantidad 2 decimales', b => { b.traspasos[0].detalle[0].cantidad = '2.00'; }, 'IMPORTE_INVALIDO'],
    ['precio_sin un decimal', b => { b.traspasos[0].detalle[0].precio_sin = '1.0'; }, 'IMPORTE_INVALIDO'],
    ['precio_con 4 decimales', b => { b.traspasos[0].detalle[0].precio_con = '1.0000'; }, 'IMPORTE_INVALIDO'],
    ['tra repetido', b => { b.traspasos.push(traspasoValido()); }, 'ID_DUPLICADO'],
    ['art repetido', b => { b.traspasos[0].detalle[1].art_id = '10'; }, 'ID_DUPLICADO'],
    ['101 traspasos', b => { b.traspasos = Array.from({ length: 101 }, (_, i) => traspasoValido(String(i + 1))); }, 'LIMITE_ENTIDADES'],
    ['501 renglones', b => { b.traspasos[0].detalle = renglonesTraspaso(501); }, 'LIMITE_ENTIDADES'],
    ['1001 renglones en el lote', b => {
      b.traspasos = [1, 2, 3].map(n => ({ ...traspasoValido(String(n)), detalle: renglonesTraspaso(n === 3 ? 1 : 500) }));
    }, 'LIMITE_ENTIDADES'],
    ['detalle vacio', b => { b.traspasos[0].detalle = []; }, 'DETALLE_VACIO'],
    ['folio largo', b => { b.traspasos[0].folio = 'F'.repeat(46); }, 'DATOS_INVALIDOS'],
    ['folio vacio', b => { b.traspasos[0].folio = ' '; }, 'DATOS_INVALIDOS'],
    ['tra invalido', b => { b.traspasos[0].tra_id = 7; }, 'ID_INVALIDO'],
    ['art invalido', b => { b.traspasos[0].detalle[0].art_id = '0'; }, 'ID_INVALIDO'],
    ['origen invalido', b => { b.traspasos[0].suc_origen = 1; }, 'ID_INVALIDO'],
    ['destino invalido', b => { b.traspasos[0].suc_destino = null; }, 'ID_INVALIDO'],
    ['aliasOri', b => { b.traspasos[0].aliasOri = 'Ocosingo'; }, 'PROPIEDAD_NO_DECLARADA'],
    ['propiedad extra en renglon', b => { b.traspasos[0].detalle[0].clave = 'X'; }, 'PROPIEDAD_NO_DECLARADA'],
  ]) {
    const entrada = structuredClone(solo);
    cambiar(entrada);
    assert.throws(() => validarLoteSicar(entrada), e => e.codigo === codigo, nombre);
  }
  const mil = { ...solo, traspasos: [1, 2].map(n => ({ ...traspasoValido(String(n)), detalle: renglonesTraspaso(500) })) };
  assert.deepEqual(validarLoteSicar(mil), mil);
});
