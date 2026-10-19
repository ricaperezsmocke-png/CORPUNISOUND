const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function prepararDB(t) {
  const sqlite = new Database(':memory:');
  t.after(() => sqlite.close());
  const { crearRepositorioSicar } = require('./sicarRepositorio');
  return { sqlite, repo: crearRepositorioSicar(sqlite) };
}

function lote(sequence = '1') {
  return {
    schema_version: 1, mapping_version: 'ocosingo-f0-v1', batch_id: `lote-${sequence}`, sequence,
    clientes: [{ cli_id: '9007199254740993', nombre: 'José Muñoz', telefono: '9191234567',
      celular: null, email: null, rfc: 'XAXX010101000', status: '1', clave: 'JOSÉ' }],
    ventas: [{ ven_id: '9007199254740995', cli_id: '9007199254740993', fecha_local: '2026-10-12T16:30:00',
      timezone: 'America/Mexico_City', moneda: 'MXN', estado: 'vigente', total: '100.00',
      detalle: ['81', '82'].map(art_id => ({ art_id, clave: `C-${art_id}`, descripcion: 'Cable acústico',
        cantidad: '1.0000', precio_con: '50.0000', precio_sin: '43.1034', importe_con: '50.00', descuento_total: '0.00' })) }],
  };
}

function aplicar(repo, datos = lote(), sucursalId = 1, hash = `hash-${datos.sequence}`) {
  return repo.aplicarLote({ sucursalId, lote: datos, hash });
}

function foto(sqlite) {
  const tablas = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'sicar_%' ORDER BY name").all();
  return Object.fromEntries(tablas.map(({ name }) => [name, sqlite.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()]));
}

test('migra detalles antiguos por rowid dentro de cada venta sin perder filas y es idempotente', t => {
  const { sqlite, repo } = prepararDB(t);
  aplicar(repo);
  aplicar(repo, lote(), 2);
  const campos = sqlite.pragma('table_info(sicar_detalles)').map(c => c.name).filter(c => c !== 'renglon').join(',');
  sqlite.exec(`CREATE TABLE detalles_viejos AS SELECT ${campos} FROM sicar_detalles ORDER BY sucursal_id, art_id DESC;
    DROP TABLE sicar_detalles; ALTER TABLE detalles_viejos RENAME TO sicar_detalles;`);
  const antes = sqlite.prepare('SELECT * FROM sicar_detalles ORDER BY rowid').all();
  require('./sicarRepositorio').crearRepositorioSicar(sqlite);
  const despues = sqlite.prepare('SELECT * FROM sicar_detalles ORDER BY sucursal_id, ven_id, renglon').all();
  assert.deepEqual(despues.map(({ renglon, ...fila }) => fila), antes);
  assert.deepEqual(despues.map(d => d.renglon), [0, 1, 0, 1]);
  const estado = foto(sqlite);
  require('./sicarRepositorio').crearRepositorioSicar(sqlite);
  assert.deepEqual(foto(sqlite), estado);
  assert.deepEqual(sqlite.pragma('foreign_key_check'), []);
});

test('el esquema indexa las decisiones por identidad y bloqueo de unión', t => {
  const { sqlite } = prepararDB(t);
  const indices = sqlite.pragma('index_list(sicar_decisiones)');
  assert.ok(indices.some(i => {
    const columnas = sqlite.pragma(`index_info(${i.name})`).map(c => c.name);
    return JSON.stringify(columnas) === JSON.stringify(['sucursal_id', 'cli_id', 'bloquear_union']);
  }));
});

test('descarta público por nombre, id y tienda incluso en ventas sin cliente en el lote', t => {
  const { sqlite, repo } = prepararDB(t);
  const datos = lote();
  datos.clientes.push({ cli_id: '800', nombre: 'PÚBLICO EN GENERAL MOSTRADOR' });
  datos.ventas.push({ ...datos.ventas[0], ven_id: 'publica', cli_id: '800' });
  const r = aplicar(repo, datos);
  assert.deepEqual(r.descartados, { clientes: 1, ventas: 1, renglones: 2 });
  assert.equal(sqlite.prepare("SELECT count(*) n FROM sicar_clientes WHERE cli_id='800'").get().n, 0);
  const siguiente = { ...lote('2'), clientes: [], ventas: [{ ...datos.ventas[0], cli_id: '2' }] };
  assert.equal(aplicar(repo, siguiente).descartados.ventas, 1);
  const otra = lote();
  otra.clientes[0].cli_id = '2';
  otra.ventas[0].cli_id = '2';
  assert.equal(aplicar(repo, otra, 2).aceptados.ventas, 1, 'id 2 solo es público medido en Ocosingo');
});

test('descarta nuevas compras de público histórico sin borrar filas anteriores', t => {
  const { sqlite, repo } = prepararDB(t);
  aplicar(repo);
  sqlite.prepare("UPDATE sicar_clientes SET nombre='PUBLICO EN GENERAL ANTIGUO'").run();
  const antes = sqlite.prepare('SELECT * FROM sicar_ventas').all();
  const datos = lote('2');
  datos.clientes = [];
  datos.ventas[0].ven_id = 'otra';
  assert.equal(aplicar(repo, datos).descartados.ventas, 1);
  assert.deepEqual(sqlite.prepare('SELECT * FROM sicar_ventas').all(), antes);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM sicar_clientes').get().n, 1);
});

test('una venta ya recibida que pasa a público se quita de la ficha del cliente anterior', t => {
  const { sqlite, repo } = prepararDB(t);
  aplicar(repo);
  const datos = lote('2');
  datos.clientes = [];
  datos.ventas[0].cli_id = '1';
  assert.equal(aplicar(repo, datos).descartados.ventas, 1);
  const venta = sqlite.prepare('SELECT estado, cli_id FROM sicar_ventas WHERE ven_id=?').get('9007199254740995');
  assert.deepEqual({ ...venta }, { estado: 'excluida', cli_id: null });
  assert.equal(sqlite.prepare('SELECT count(*) n FROM sicar_detalles').get().n, 0);
});

test('la migración es idempotente, activa FK y crea las catorce tablas aisladas', t => {
  const { sqlite } = prepararDB(t);
  const antes = foto(sqlite);
  require('./sicarRepositorio').crearRepositorioSicar(sqlite);
  assert.deepEqual(foto(sqlite), antes);
  assert.equal(Object.keys(antes).length, 15);
  assert.deepEqual(antes.sicar_esquema.map(fila => fila.version), [1, 2]);
  for (const tabla of ['sicar_llaves', 'sicar_vinculos', 'sicar_decisiones']) assert.deepEqual(antes[tabla], []);
  for (const tabla of ['sicar_estados', 'sicar_estados_historial']) assert.deepEqual(antes[tabla], []);
  assert.equal(sqlite.pragma('foreign_keys', { simple: true }), 1);
  assert.deepEqual(sqlite.pragma('table_info(sicar_clientes)').map(c => c.name),
    ['sucursal_id', 'cli_id', 'nombre', 'telefono', 'celular', 'email', 'rfc', 'status', 'clave']);
});

test('la migración fallida no deja tablas ni versión parcialmente creadas', t => {
  const sqlite = new Database(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec('CREATE TABLE sicar_ventas (incompatible TEXT)');
  assert.throws(() => require('./sicarRepositorio').crearRepositorioSicar(sqlite), e => e.code === 'SQLITE_ERROR');
  assert.deepEqual(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all(), [{ name: 'sicar_ventas' }]);
});

test('los mismos ids grandes en dos tiendas son identidades diferentes y conservan acentos', t => {
  const { sqlite, repo } = prepararDB(t);
  aplicar(repo);
  const segunda = lote();
  segunda.clientes[0].nombre = 'María';
  segunda.ventas[0].total = '120.01';
  aplicar(repo, segunda, 2);
  assert.deepEqual(sqlite.prepare('SELECT nombre FROM sicar_clientes ORDER BY sucursal_id').all(),
    [{ nombre: 'José Muñoz' }, { nombre: 'María' }]);
  assert.deepEqual(sqlite.prepare('SELECT ven_id, total_centavos FROM sicar_ventas ORDER BY sucursal_id').all(),
    [{ ven_id: '9007199254740995', total_centavos: 10000 }, { ven_id: '9007199254740995', total_centavos: 12001 }]);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM sicar_detalles').get().n, 4);
});

test('FK impide detalle huérfano y venta con cliente de otra tienda', t => {
  const { sqlite, repo } = prepararDB(t);
  aplicar(repo);
  assert.throws(() => sqlite.prepare('UPDATE sicar_detalles SET ven_id = ?').run('999'), /FOREIGN KEY/);
  aplicar(repo, { ...lote(), clientes: [], ventas: [] }, 2);
  assert.throws(() => sqlite.prepare('UPDATE sicar_ventas SET sucursal_id = 2').run(), /FOREIGN KEY/);
});

test('repetir lote devuelve el recibo original sin reescribir una compra ni sus dos líneas', t => {
  const { sqlite, repo } = prepararDB(t);
  const recibo = aplicar(repo);
  const antes = foto(sqlite);
  assert.deepEqual(aplicar(repo), recibo);
  assert.deepEqual(foto(sqlite), antes);
  assert.equal(antes.sicar_ventas.length, 1);
  assert.equal(antes.sicar_detalles.length, 2);
  assert.deepEqual(recibo, { schema_version: 1, batch_id: 'lote-1', sequence: '1',
    aceptados: { clientes: 1, ventas: 1 }, rechazados: 0, next_sequence: '2', received_at: recibo.received_at });
  assert.equal(repo.estado(1).ultima_recepcion, recibo.received_at);
});

test('reemplazar el detalle de dos líneas por una elimina el sobrante', t => {
  const { sqlite, repo } = prepararDB(t);
  aplicar(repo);
  const siguiente = lote('2');
  siguiente.ventas[0].detalle.pop();
  siguiente.ventas[0].detalle[0].cantidad = '0.5000';
  aplicar(repo, siguiente);
  const detalles = sqlite.prepare('SELECT art_id, cantidad, precio_sin FROM sicar_detalles').all();
  assert.deepEqual(detalles, [{ art_id: '81', cantidad: '0.5000', precio_sin: '43.1034' }]);
  assert.equal(sqlite.prepare('SELECT revision FROM sicar_ventas').get().revision, '2');
});

test('cancelar conserva la fila y sus importes pero deja cero compras vigentes', t => {
  const { sqlite, repo } = prepararDB(t);
  aplicar(repo);
  aplicar(repo, { ...lote('2'), clientes: [], ventas: [{ ven_id: '9007199254740995', estado: 'cancelada' }] });
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM sicar_ventas WHERE estado='vigente'").get().n, 0);
  const venta = sqlite.prepare('SELECT estado, total_centavos FROM sicar_ventas').get();
  assert.deepEqual(venta, { estado: 'cancelada', total_centavos: 10000 });
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM sicar_detalles').get().n, 2);
});

test('excluir una venta conocida elimina su referencia personal y su detalle', t => {
  const { sqlite, repo } = prepararDB(t);
  aplicar(repo);
  aplicar(repo, { ...lote('2'), clientes: [], ventas: [{ ven_id: '9007199254740995', estado: 'excluida' }] });
  assert.deepEqual(sqlite.prepare('SELECT estado, cli_id FROM sicar_ventas').get(), { estado: 'excluida', cli_id: null });
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM sicar_detalles').get().n, 0);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM sicar_clientes').get().n, 1);
});

test('un tombstone desconocido no crea una venta', t => {
  const { sqlite, repo } = prepararDB(t);
  for (const [i, estado] of ['cancelada', 'excluida'].entries()) {
    aplicar(repo, { ...lote(String(i + 1)), clientes: [], ventas: [{ ven_id: '999', estado }] });
  }
  assert.deepEqual(sqlite.prepare('SELECT * FROM sicar_ventas').all(), []);
});

test('fallar entre cabecera y detalle revierte clientes, venta, detalle, recibo y secuencia', t => {
  const { sqlite, repo } = prepararDB(t);
  aplicar(repo);
  const antes = foto(sqlite);
  let cabeceraObservada = false;
  sqlite.function('comprobar_cabecera', total => {
    cabeceraObservada = total === 20000;
    return 1;
  });
  sqlite.exec(`CREATE TEMP TRIGGER fallar_detalle BEFORE INSERT ON sicar_detalles BEGIN
    SELECT comprobar_cabecera(total_centavos) FROM sicar_ventas
      WHERE sucursal_id=NEW.sucursal_id AND ven_id=NEW.ven_id;
    SELECT RAISE(ABORT, 'fallo simulado de detalle'); END`);
  const siguiente = lote('2');
  siguiente.clientes[0].nombre = 'Nombre corregido';
  siguiente.ventas[0].total = '200.00';
  assert.throws(() => aplicar(repo, siguiente), /fallo simulado/);
  assert.equal(cabeceraObservada, true);
  assert.deepEqual(foto(sqlite), antes);
});

test('un fallo al guardar el recibo revierte también la primera tienda', t => {
  const { sqlite, repo } = prepararDB(t);
  const antes = foto(sqlite);
  sqlite.exec(`CREATE TEMP TRIGGER fallar_recibo BEFORE INSERT ON sicar_envios BEGIN
    SELECT RAISE(ABORT, 'fallo simulado de recibo'); END`);
  assert.throws(() => aplicar(repo), /fallo simulado/);
  assert.deepEqual(foto(sqlite), antes);
});

test('secuencia incorrecta y hash distinto producen errores tipados sin mutar', t => {
  const { sqlite, repo } = prepararDB(t);
  const { ErrorSicar } = require('./sicarRepositorio');
  assert.deepEqual(repo.estado(1), { siguiente_secuencia: '1', ultima_recepcion: null });
  aplicar(repo);
  const antes = foto(sqlite);
  for (const sequence of ['1', '3']) {
    const datos = { ...lote(sequence), batch_id: `otro-${sequence}` };
    assert.throws(() => aplicar(repo, datos), e => e instanceof ErrorSicar
      && e.codigo === 'SECUENCIA_INCORRECTA' && e.siguiente_secuencia === '2');
  }
  assert.throws(() => aplicar(repo, lote(), 1, 'otro-hash'),
    e => e instanceof ErrorSicar && e.codigo === 'CONFLICTO_BATCH');
  assert.deepEqual(foto(sqlite), antes);
});

test('reiniciar desde archivo temporal conserva recibo, estado y secuencia', () => {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'sicar-repositorio-'));
  let sqlite;
  try {
    const { crearRepositorioSicar } = require('./sicarRepositorio');
    const archivo = path.join(carpeta, 'prueba.sqlite');
    sqlite = new Database(archivo);
    let repo = crearRepositorioSicar(sqlite);
    const recibo = aplicar(repo);
    const estado = repo.estado(1);
    sqlite.close();
    sqlite = new Database(archivo);
    repo = crearRepositorioSicar(sqlite);
    assert.deepEqual(repo.estado(1), estado);
    assert.deepEqual(aplicar(repo), recibo);
    aplicar(repo, lote('2'));
    assert.equal(repo.estado(1).siguiente_secuencia, '3');
  } finally {
    if (sqlite?.open) sqlite.close();
    fs.rmSync(carpeta, { recursive: true, force: true });
  }
});

test('la conexión explícita conserva cargar/guardar y el JSON durante la ingesta', () => {
  // La integración se ejecuta en otro proceso con DB_PATH desechable antes de importar persistencia.
  const programa = `
    const assert = require('node:assert/strict');
    const p = require('./persistencia');
    assert.equal(typeof p.obtenerConexionSqlite, 'function');
    const sqlite = p.obtenerConexionSqlite();
    assert.equal(p.obtenerConexionSqlite(), sqlite);
    assert.equal(p.cargar(), null);
    const datos = { clientes: [{ nombre: 'José' }], pos: { ventas: [] }, saldo: 12.34 };
    p.guardar(datos);
    const antes = sqlite.prepare('SELECT * FROM estado').get();
    assert.equal(antes.datos, JSON.stringify(datos));
    const repo = require('./sicarRepositorio').crearRepositorioSicar(sqlite);
    repo.aplicarLote({ sucursalId: 1, lote: ${JSON.stringify(lote())}, hash: 'hash-prueba' });
    assert.deepEqual(sqlite.prepare('SELECT * FROM estado').get(), antes);
    assert.deepEqual(p.cargar(), datos);
    datos.pos.ventas.push({ id: 1, total: 25 });
    p.guardar(datos);
    assert.equal(sqlite.prepare('SELECT datos FROM estado').get().datos, JSON.stringify(datos));
    assert.deepEqual(p.cargar(), datos);
    sqlite.close();
  `;
  const r = spawnSync(process.execPath, ['--preserve-symlinks', '--preserve-symlinks-main', '-e', programa], {
    cwd: __dirname, env: { ...process.env, DB_PATH: ':memory:' }, encoding: 'utf8',
  });
  assert.equal(r.status, 0, `${r.error || ''}\n${r.stdout}\n${r.stderr}`);
});

test('guarda articulos por tienda, recorta texto y los reemplaza sin romper el reenvio', t => {
  const { sqlite, repo } = prepararDB(t);
  const datos = { ...lote(), clientes: [], ventas: [], articulos: [{ art_id: '81', clave: ' CABLE ',
    descripcion: ' Cable acustico ', categoria: ' Cables ', departamento: ' Audio ' }] };
  const recibo = aplicar(repo, datos);
  assert.equal(recibo.aceptados.articulos, 1);
  assert.deepEqual(sqlite.prepare('SELECT sucursal_id, art_id, clave, descripcion, categoria, departamento FROM sicar_articulos').all(), [{
    sucursal_id: 1, art_id: '81', clave: 'CABLE', descripcion: 'Cable acustico', categoria: 'Cables', departamento: 'Audio',
  }]);
  assert.deepEqual(aplicar(repo, datos), recibo);
  const reemplazo = { ...datos, batch_id: 'lote-2', sequence: '2', articulos: [{ ...datos.articulos[0], categoria: 'Bafles' }] };
  aplicar(repo, reemplazo);
  assert.equal(sqlite.prepare("SELECT categoria FROM sicar_articulos WHERE sucursal_id=1 AND art_id='81'").get().categoria, 'Bafles');
  const otraTienda = { ...reemplazo, batch_id: 'lote-1', sequence: '1' };
  aplicar(repo, otraTienda, 2);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM sicar_articulos WHERE art_id='81'").get().n, 2);
});
