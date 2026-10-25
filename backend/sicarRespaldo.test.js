const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { crearRepositorioSicar } = require('./sicarRepositorio');
const respaldos = require('./respaldos');
const { construirDBPrueba } = require('./testHelpers');
const { desempaquetar } = require('./respaldoCifrado');
const LLAVE = Buffer.alloc(32, 7);
const LIMITE = 2 * 1024 * 1024;
const MANIFIESTO_INVALIDO = 'El manifiesto SICAR es inválido.';
const { TABLAS_15 } = require('./sicarRespaldo');

test('Drive limitado cancela al recibir 2097153 bytes y conserva la descarga anterior', async t => {
  const drive = require('./drive');
  assert.equal(typeof drive.descargarArchivoDeDriveLimitado, 'function');
  let cancelado = false;
  let responder = () => new Response(new ReadableStream({
    start(c) { c.enqueue(new Uint8Array(LIMITE)); c.enqueue(new Uint8Array(1)); },
    cancel() { cancelado = true; },
  }));
  t.mock.method(globalThis, 'fetch', async () => responder());
  const DB = { drive: { cuenta: { access_token: 'ficticio', expires_at: Date.now() + 3600000 } } };
  await assert.rejects(drive.descargarArchivoDeDriveLimitado(DB, 'local', LIMITE), { codigo: 'TROZO_EXCESIVO' });
  assert.equal(cancelado, true);
  responder = () => new Response(Buffer.alloc(LIMITE + 1));
  assert.equal((await drive.descargarArchivoDeDrive(DB, 'local')).length, LIMITE + 1);
  responder = () => new Response('áéí', { status: 200 });
  assert.equal((await drive.descargarArchivoDeDriveLimitado(DB, 'local', 6)).toString(), 'áéí');
  responder = () => new Response('rechazado', { status: 403 });
  await assert.rejects(drive.descargarArchivoDeDriveLimitado(DB, 'local', 6), /Error al descargar.*rechazado/);
});

function driveFalso() {
  const archivos = new Map();
  let n = 0;
  return {
    archivos,
    asegurarCarpetaRespaldos: async () => 'carpeta',
    async subirArchivoADrive(_DB, args) {
      const id = `archivo-${++n}`;
      archivos.set(id, Buffer.from(args.contenidoBuffer));
      return { id };
    },
    async descargarArchivoDeDrive(_DB, id) {
      if (!archivos.has(id)) throw new Error('Trozo faltante');
      return archivos.get(id);
    },
    async descargarArchivoDeDriveLimitado(DB, id, limite) {
      const bytes = await this.descargarArchivoDeDrive(DB, id);
      assert.ok(bytes.length <= limite);
      return bytes;
    },
    async eliminarArchivoDeDrive(_DB, id) { archivos.delete(id); },
  };
}

function preparar(t) {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'sicar-respaldo-'));
  const ruta = path.join(carpeta, 'prueba.sqlite');
  const sqlite = new Database(ruta);
  sqlite.pragma('journal_mode = WAL');
  sqlite.exec('CREATE TABLE estado (id INTEGER PRIMARY KEY, datos TEXT NOT NULL, actualizado TEXT DEFAULT CURRENT_TIMESTAMP)');
  const repo = crearRepositorioSicar(sqlite);
  const DB = construirDBPrueba();
  for (const k of respaldos.COLECCIONES_RESPALDADAS) DB[k] ??= {};
  DB.respaldos = respaldos.nuevoEstadoRespaldos();
  const guardar = db => sqlite.prepare('INSERT OR REPLACE INTO estado(id, datos) VALUES (1, ?)').run(JSON.stringify(db));
  guardar(DB);
  const drive = driveFalso();
  t.after(() => {
    if (sqlite.open) sqlite.close();
    fs.rmSync(carpeta, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    require('./mantenimiento').desactivar();
  });
  return { sqlite, repo, DB, drive, guardar, ruta };
}

function lote(sequence = '1') {
  return { batch_id: `lote-${sequence}`, sequence, mapping_version: 'v1',
    clientes: [{ cli_id: '123', nombre: `José ${sequence}` }],
    ventas: [{ ven_id: '456', cli_id: '123', fecha_local: '2026-10-13T12:00:00', estado: 'vigente', total: '200.00',
      detalle: [{ art_id: '9', descripcion: 'Guitarrón', cantidad: '1.0000', precio_con: '200.0000',
        precio_sin: '172.4138', importe_con: '200.00', descuento_total: '0.00' }] }] };
}

function sembrar(f) {
  const recibo = f.repo.aplicarLote({ sucursalId: 1, lote: lote(), hash: 'hash-1' });
  f.repo.guardarLlave({ key_id: 'llave', sucursal_id: 1, secreto_hash: 'a'.repeat(64), creada: '2026-10-13', actor: '1' });
  f.sqlite.exec(`INSERT INTO sicar_vinculos VALUES (1, '123', NULL, 'deshecho', 2, 'Separar', '1', 'hoy', 'hoy');
    INSERT INTO sicar_decisiones VALUES (1, 1, '123', NULL, 'deshacer', 2, 1, 'Separar', '1', 'hoy');
    INSERT INTO sicar_intentos(id, sucursal_id, key_id, codigo, hora) VALUES (1, 1, 'llave', '200', 'hoy')`);
  return recibo;
}

function api() {
  assert.ok(fs.existsSync(path.join(__dirname, 'sicarRespaldo.js')), 'Falta implementar el respaldo SICAR');
  return require('./sicarRespaldo');
}

test('respaldo conserva estados SICAR e historial completo', async t => {
  const f = preparar(t), g = preparar(t), s = api();
  sembrar(f);
  const datos = { sucursal_id: 1, cli_id: '123', estado: 'contactado', usuario_id: 9, fecha_hora: '2026-10-15T20:00:00.000Z' };
  f.repo.guardarEstadoCliente(datos);
  f.repo.guardarEstadoCliente({ ...datos, estado: 'interesado' });
  const m = await s.crearSnapshotSicar(f.repo, f.drive, { DB: f.DB, llave: LLAVE });
  assert.equal(m.conteos.sicar_estados, 1);
  assert.equal(m.conteos.sicar_estados_historial, 2);
  s.configurarContexto(g.repo, { DB: g.DB, llave: LLAVE });
  const p = await s.prepararRestauracionSicar(g.repo, f.drive, m);
  p.aplicar(); p.liberar();
  for (const tabla of ['sicar_estados', 'sicar_estados_historial']) {
    assert.deepEqual(g.sqlite.prepare(`SELECT * FROM ${tabla}`).all(), f.sqlite.prepare(`SELECT * FROM ${tabla}`).all());
  }
});

test('respaldo viejo sin seguimiento restaura vacio sobre estados posteriores', async t => {
  const f = preparar(t), s = api();
  sembrar(f);
  const m = await s.crearSnapshotSicar(f.repo, f.drive, { DB: f.DB, llave: LLAVE });
  delete m.conteos.sicar_estados;
  delete m.conteos.sicar_estados_historial;
  delete m.conteos.sicar_internas;
  delete m.conteos.sicar_internas_historial;
  delete m.conteos.sicar_articulos;
  delete m.conteos.sicar_proveedores;
  delete m.conteos.sicar_existencias;
  for (const tabla of [...CORTES, ...CAJEROS, ...MOSTRADOR]) delete m.conteos[tabla];
  f.repo.guardarEstadoCliente({ sucursal_id: 1, cli_id: '123', estado: 'contactado', usuario_id: 9, fecha_hora: '2026-10-15T20:00:00Z' });
  const p = await s.prepararRestauracionSicar(f.repo, f.drive, m);
  p.aplicar(); p.liberar();
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM sicar_estados').get().n, 0);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM sicar_estados_historial').get().n, 0);
});

for (const generacion of [12, 14]) {
  test(`respaldo de ${generacion} tablas deja articulos vacios al restaurar`, async t => {
    const f = preparar(t), s = api();
    sembrar(f);
    const m = await s.crearSnapshotSicar(f.repo, f.drive, { DB: f.DB, llave: LLAVE });
    for (const tabla of ['sicar_internas', 'sicar_internas_historial', 'sicar_articulos'].slice(generacion === 12 ? 0 : 2)) {
      delete m.conteos[tabla];
    }
    delete m.conteos.sicar_proveedores;
    delete m.conteos.sicar_existencias;
    for (const tabla of [...CORTES, ...CAJEROS, ...MOSTRADOR]) delete m.conteos[tabla];
    f.sqlite.prepare(`INSERT INTO sicar_articulos
      (sucursal_id, art_id, clave, descripcion, categoria, departamento, actualizado_en)
      VALUES (1, '9', 'SKU-9', 'Artículo pendiente', 'Cuerdas', 'Accesorios', 'hoy')`).run();

    const p = await s.prepararRestauracionSicar(f.repo, f.drive, m);
    p.aplicar();
    p.liberar();

    assert.equal(f.sqlite.prepare('SELECT count(*) n FROM sicar_articulos').get().n, 0);
  });
}

test('manifiesto que omite solo una tabla de seguimiento se rechaza', async t => {
  const f = preparar(t), s = api();
  sembrar(f);
  const m = await s.crearSnapshotSicar(f.repo, f.drive, { DB: f.DB, llave: LLAVE });
  m.conteos.sicar_estados = 0;
  delete m.conteos.sicar_estados_historial;
  await assert.rejects(s.prepararRestauracionSicar(f.repo, f.drive, m), /inválido|conteo/);
});

for (const antiguo of [true, false]) {
  test(`restaura renglones de respaldo ${antiguo ? 'viejo sin renglon' : 'nuevo con repetidos'}`, async t => {
    const f = preparar(t), g = preparar(t), s = api();
    const datos = lote();
    datos.ventas[0].total = '400.00';
    datos.ventas[0].detalle.push({ ...datos.ventas[0].detalle[0], art_id: antiguo ? '8' : '9', descripcion: 'Segundo' });
    f.repo.aplicarLote({ sucursalId: 1, lote: datos, hash: 'h' });
    if (antiguo) {
      const campos = f.sqlite.pragma('table_info(sicar_detalles)').map(c => c.name).filter(c => c !== 'renglon').join(',');
      f.sqlite.exec(`CREATE TABLE detalles_viejos AS SELECT ${campos} FROM sicar_detalles ORDER BY rowid;
        DROP TABLE sicar_detalles; ALTER TABLE detalles_viejos RENAME TO sicar_detalles;`);
    }
    const m = await s.crearSnapshotSicar(f.repo, f.drive, { DB: f.DB, llave: LLAVE });
    s.configurarContexto(g.repo, { DB: g.DB, llave: LLAVE });
    const p = await s.prepararRestauracionSicar(g.repo, f.drive, m);
    p.aplicar(); p.liberar();
    const filas = g.sqlite.prepare('SELECT renglon, descripcion, importe_centavos FROM sicar_detalles ORDER BY renglon').all();
    assert.deepEqual(filas, [
      { renglon: 0, descripcion: 'Guitarrón', importe_centavos: 20000 },
      { renglon: 1, descripcion: 'Segundo', importe_centavos: 20000 },
    ]);
  });
}

const opciones = copiaId => ({ copiaId, llave: LLAVE, clave: 'local', confirmacion: 'RESTAURAR',
  env: { CLAVE_RESTAURACION: 'local' }, usuario: { id: 1 }, permisos: ['ver_todas_las_sucursales'] });

for (const modo of ['sin copia', 'dañada', 'previo fallido']) {
test(`restauración parcial (${modo}) suelta vínculos posteriores y huérfanos de forma atómica`, async t => {
  const f = preparar(t);
  respaldos.configurarSicar(f.DB, f.repo, f.guardar);
  if (modo !== 'sin copia') sembrar(f);
  const c = await respaldos.crearRespaldo(f.DB, f.drive, { llave: LLAVE });
  if (modo === 'sin copia') sembrar(f);
  if (modo === 'dañada') {
    const foto = await respaldos.leerRespaldo(f.DB, f.drive, c.id, LLAVE);
    f.drive.archivos.get(foto.foto.sicar.trozos[0].drive_file_id)[0] ^= 1;
  }
  if (modo === 'previo fallido') {
    const subir = f.drive.subirArchivoADrive;
    f.drive.subirArchivoADrive = async (db, args) => {
      if (args.nombre.startsWith('sicar-')) throw new Error('SICAR no se pudo respaldar');
      return subir(db, args);
    };
  }
  const anterior = '2000-01-01T00:00:00.000Z';
  const posterior = '2099-01-01T00:00:00.000Z';
  const nativo = f.DB.crm.clientes[1].id;
  for (const [cli, id, creada, decision] of [
    ['nuevo', nativo, posterior, anterior], ['decision', nativo, anterior, posterior],
    ['huerfano', 999999, anterior, anterior], ['seguro', nativo, anterior, anterior],
  ]) {
    f.sqlite.prepare('INSERT INTO sicar_clientes(sucursal_id, cli_id, nombre) VALUES (1, ?, ?)').run(cli, cli);
    f.sqlite.prepare('INSERT INTO sicar_vinculos VALUES (1, ?, ?, ?, 1, NULL, ?, ?, ?)')
      .run(cli, id, 'confirmado', '1', creada, creada);
    f.sqlite.prepare('INSERT INTO sicar_decisiones(sucursal_id, cli_id, cliente_id, accion, version, actor, fecha) VALUES (1, ?, ?, ?, 1, ?, ?)')
      .run(cli, id, 'confirmar', '1', decision);
  }
  const decisiones = f.sqlite.prepare('SELECT * FROM sicar_decisiones').all();
  const clientes = structuredClone(f.DB.crm.clientes);
  f.DB.crm.clientes[1].nombre = 'Otro estado';
  f.guardar(f.DB);
  const persistido = f.sqlite.prepare('SELECT datos FROM estado').get().datos;
  const antes = JSON.stringify(f.DB);
  respaldos.configurarSicar(f.DB, f.repo, db => { f.guardar(db); throw new Error('fallo simulado'); });
  await assert.rejects(respaldos.restaurar(f.DB, f.drive, opciones(c.id)), /fallo simulado/);
  assert.equal(f.DB.crm.clientes[1].nombre, JSON.parse(antes).crm.clientes[1].nombre);
  assert.equal(f.sqlite.prepare('SELECT datos FROM estado').get().datos, persistido);
  assert.equal(f.sqlite.prepare("SELECT cliente_id FROM sicar_vinculos WHERE cli_id='nuevo'").get().cliente_id, nativo);
  respaldos.configurarSicar(f.DB, f.repo, f.guardar);
  await respaldos.restaurar(f.DB, f.drive, opciones(c.id));
  for (const cli of ['nuevo', 'decision', 'huerfano']) {
    const v = f.sqlite.prepare('SELECT * FROM sicar_vinculos WHERE cli_id=?').get(cli);
    assert.equal(v.cliente_id, null);
    assert.equal(v.estado, 'pendiente');
    assert.match(v.motivo, /restauración parcial/i);
  }
  assert.equal(f.sqlite.prepare("SELECT cliente_id FROM sicar_vinculos WHERE cli_id='seguro'").get().cliente_id, nativo);
  assert.deepEqual(f.sqlite.prepare('SELECT * FROM sicar_decisiones').all(), decisiones);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM sicar_ventas').get().n, 1);
  assert.deepEqual(f.DB.crm.clientes, clientes);
  assert.deepEqual(JSON.parse(f.sqlite.prepare('SELECT datos FROM estado').get().datos).crm.clientes, clientes);
});
}

test('servidor de reemplazo con llave nueva revoca las llaves desconocidas de la foto', async t => {
  const f = preparar(t), s = api();
  sembrar(f);
  const m = await s.crearSnapshotSicar(f.repo, f.drive, { DB: f.DB, llave: LLAVE });
  f.sqlite.exec('DELETE FROM sicar_intentos; DELETE FROM sicar_llaves');
  f.repo.guardarLlave({ key_id: 'nueva', sucursal_id: 1, secreto_hash: 'b'.repeat(64), creada: '2026-10-14', actor: '1' });
  const inicio = Date.now();
  const p = await s.prepararRestauracionSicar(f.repo, f.drive, m);
  p.aplicar(); p.liberar();
  assert.ok(Date.parse(f.repo.obtenerLlave('llave').revocada) >= inicio);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM sicar_ventas').get().n, 1);
});

test('snapshot y restauración recuperan compra, detalle, enlace deshecho y recibo sin duplicar ni cambiar dinero', async t => {
  const f = preparar(t), s = api();
  const recibo = sembrar(f);
  require('./cajas').sembrarCajas(f.DB);
  f.guardar(f.DB);
  const antes = JSON.stringify(f.DB);
  const cortes = () => f.DB.pos.cajas.map(c => require('./cortes').calcularCorteEnCurso(f.DB, c.sucursal_id, c.id));
  const cortesAntes = cortes();
  const { reporteUtilidad } = require('./reportes');
  const utilidad = reporteUtilidad(f.DB, {}, { verTodas: true, sucursalId: null });
  const m = await s.crearSnapshotSicar(f.repo, f.drive, { DB: f.DB, llave: LLAVE });
  assert.equal(m.version_esquema, 2);
  assert.equal(Object.keys(m.conteos).length, 24);
  f.repo.aplicarLote({ sucursalId: 1, lote: lote('2'), hash: 'hash-2' });
  const preparado = await s.prepararRestauracionSicar(f.repo, f.drive, m);
  assert.equal(f.repo.estado(1).siguiente_secuencia, '3');
  preparado.aplicar();
  preparado.liberar();
  assert.deepEqual(f.repo.aplicarLote({ sucursalId: 1, lote: lote(), hash: 'hash-1' }), recibo);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM sicar_ventas').get().n, 1);
  assert.equal(f.sqlite.prepare('SELECT descripcion FROM sicar_detalles').get().descripcion, 'Guitarrón');
  assert.equal(f.sqlite.prepare('SELECT estado FROM sicar_vinculos').get().estado, 'deshecho');
  assert.equal(f.sqlite.prepare('SELECT bloquear_union FROM sicar_decisiones').get().bloquear_union, 1);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM sicar_intentos').get().n, 1);
  assert.equal(JSON.stringify(f.DB), antes);
  assert.equal(f.sqlite.prepare('SELECT datos FROM estado').get().datos, antes);
  assert.deepEqual(cortes(), cortesAntes);
  assert.deepEqual(reporteUtilidad(f.DB, {}, { verTodas: true, sucursalId: null }), utilidad);
});

for (const defecto of ['faltante', 'corrupto', 'versión']) {
  test(`preparación rechaza ${defecto} sin sustituir tablas vivas`, async t => {
    const f = preparar(t), s = api();
    sembrar(f);
    const m = await s.crearSnapshotSicar(f.repo, f.drive, { DB: f.DB, llave: LLAVE });
    f.repo.aplicarLote({ sucursalId: 1, lote: lote('2'), hash: 'hash-2' });
    if (defecto === 'faltante') f.drive.archivos.delete(m.trozos.at(-1).drive_file_id);
    if (defecto === 'corrupto') f.drive.archivos.get(m.trozos.at(-1).drive_file_id)[0] ^= 1;
    if (defecto === 'versión') m.version_esquema = 99;
    await assert.rejects(s.prepararRestauracionSicar(f.repo, f.drive, m));
    assert.equal(f.repo.estado(1).siguiente_secuencia, '3');
    assert.equal(f.sqlite.prepare('SELECT nombre FROM sicar_clientes').get().nombre, 'José 2');
  });
}

test('lectura consistente con lote durante subida, trozos acotados y ninguna escritura fs', async t => {
  const f = preparar(t), s = api();
  sembrar(f);
  const insertar = f.sqlite.prepare('INSERT INTO sicar_clientes(sucursal_id, cli_id, nombre) VALUES (1, ?, ?)');
  f.sqlite.transaction(() => { for (let i = 0; i < 1800; i++) insertar.run(`extra-${i}`, 'á'.repeat(1000)); })();
  const original = f.drive.subirArchivoADrive;
  let concurrente = false;
  f.drive.subirArchivoADrive = async (...args) => {
    assert.ok(args[1].contenidoBuffer.length <= LIMITE);
    if (!concurrente) {
      concurrente = true;
      f.repo.aplicarLote({ sucursalId: 1, lote: lote('2'), hash: 'hash-2' });
    }
    return original(...args);
  };
  for (const nombre of ['writeFileSync', 'writeFile', 'appendFileSync', 'appendFile', 'createWriteStream']) {
    t.mock.method(fs, nombre, () => assert.fail(`Escritura prohibida: ${nombre}`));
  }
  for (const nombre of ['writeFile', 'appendFile']) t.mock.method(fs.promises, nombre, () => assert.fail(`Escritura prohibida: ${nombre}`));
  const m = await s.crearSnapshotSicar(f.repo, f.drive, { DB: f.DB, llave: LLAVE });
  assert.equal(m.conteos.sicar_envios, 1);
  assert.ok(m.trozos.filter(c => c.tabla === 'sicar_clientes').length > 1);
  const p = await s.prepararRestauracionSicar(f.repo, f.drive, m);
  p.aplicar(); p.liberar();
  assert.equal(f.sqlite.prepare("SELECT nombre FROM sicar_clientes WHERE cli_id='123'").get().nombre, 'José 1');
  assert.equal(f.repo.estado(1).siguiente_secuencia, '2');
});

test('llave revocada después del respaldo nunca revive', async t => {
  const f = preparar(t), s = api();
  sembrar(f);
  const m = await s.crearSnapshotSicar(f.repo, f.drive, { DB: f.DB, llave: LLAVE });
  f.repo.revocarLlave('llave');
  const revocada = f.repo.obtenerLlave('llave').revocada;
  const p = await s.prepararRestauracionSicar(f.repo, f.drive, m);
  p.aplicar(); p.liberar();
  assert.equal(f.repo.obtenerLlave('llave').revocada, revocada);
});

test('Drive falla a mitad: el negocio queda respaldado y SICAR parcial, nunca completo', async t => {
  const f = preparar(t);
  sembrar(f);
  assert.equal(typeof respaldos.configurarSicar, 'function');
  respaldos.configurarSicar(f.DB, f.repo, f.guardar);
  const original = f.drive.subirArchivoADrive;
  let n = 0;
  f.drive.subirArchivoADrive = async (...args) => {
    if (++n === 3) throw new Error('Drive interrumpido');
    return original(...args);
  };
  const c = await respaldos.crearRespaldo(f.DB, f.drive, { llave: LLAVE });
  assert.equal(c.estado, 'ok');
  assert.equal(c.sicar_estado, 'parcial');
  assert.equal(c.verificado_en, null);
  assert.equal(f.DB.respaldos.ultimo_exitoso, c.fecha_hora);
  assert.equal(respaldos.estadoCoberturaSicar(f.DB).ultimo_completo, null);
  assert.equal(respaldos.estadoCoberturaSicar(f.DB).estado, 'parcial');
  assert.ok(c.drive_file_id);
  assert.equal(f.repo.estado(1).siguiente_secuencia, '2');
  const foto = desempaquetar(f.drive.archivos.get(c.drive_file_id), LLAVE);
  assert.equal(foto.version_formato, 3);
  assert.equal(foto.sicar.estado, 'parcial');
  // El negocio se puede recuperar igual; SICAR se conserva como estaba y lo dice.
  const ventas = f.sqlite.prepare('SELECT count(*) n FROM sicar_ventas').get().n;
  const r = await respaldos.restaurar(f.DB, f.drive, opciones(c.id));
  assert.equal(r.aplicado, true);
  assert.equal(r.sicar_restaurado, false);
  assert.match(r.aviso_sicar, /SICAR se conservó/);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM sicar_ventas').get().n, ventas);
});

test('formato 2 conserva compatibilidad sin SICAR y con SICAR restaura el negocio avisando que SICAR no cambió', async t => {
  const f = preparar(t);
  assert.equal(typeof respaldos.configurarSicar, 'function');
  respaldos.configurarSicar(f.DB, f.repo, f.guardar);
  const c = await respaldos.crearRespaldo(f.DB, f.drive, { llave: LLAVE });
  assert.equal((await respaldos.leerRespaldo(f.DB, f.drive, c.id, LLAVE)).foto.version_formato, 2);
  assert.equal(typeof respaldos.configurarSicar, 'function');
  sembrar(f);
  respaldos.configurarSicar(f.DB, f.repo, f.guardar);
  const antes = f.sqlite.prepare('SELECT count(*) n FROM sicar_ventas').get().n;
  const r = await respaldos.restaurar(f.DB, f.drive, opciones(c.id));
  assert.equal(r.aplicado, true);
  assert.equal(r.sicar_restaurado, false);
  assert.match(r.aviso_sicar, /no trae una copia SICAR completa/);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM sicar_ventas').get().n, antes);
});

test('respaldo general verifica todos los trozos y una corrupción quita solo la cobertura SICAR', async t => {
  const f = preparar(t);
  sembrar(f);
  assert.equal(typeof respaldos.configurarSicar, 'function');
  respaldos.configurarSicar(f.DB, f.repo, f.guardar);
  const c = await respaldos.crearRespaldo(f.DB, f.drive, { llave: LLAVE });
  assert.equal(c.estado, 'ok');
  assert.ok(respaldos.estadoCoberturaSicar(f.DB).ultimo_completo);
  const foto = (await respaldos.leerRespaldo(f.DB, f.drive, c.id, LLAVE)).foto;
  f.drive.archivos.delete(foto.sicar.trozos.at(-1).drive_file_id);
  const v = await respaldos.verificarRespaldo(f.DB, f.drive, c.id, LLAVE);
  assert.equal(v.ok, true);
  assert.ok(v.sicar_error);
  assert.equal(c.sicar_estado, 'fallido');
  assert.equal(respaldos.estadoCoberturaSicar(f.DB).ultimo_completo, null);
});

test('restauración general guarda ambas fuentes antes de responder y rechaza al agente con 503', async t => {
  const f = preparar(t);
  sembrar(f);
  assert.equal(typeof respaldos.configurarSicar, 'function');
  respaldos.configurarSicar(f.DB, f.repo, f.guardar);
  const { crearLlaveSicar } = require('./sicarIngesta');
  const credencial = crearLlaveSicar(f.repo, 1, 1);
  const c = await respaldos.crearRespaldo(f.DB, f.drive, { llave: LLAVE });
  const nombre = f.DB.crm.clientes[1].nombre;
  f.DB.crm.clientes[1].nombre = 'Cambio nativo';
  f.guardar(f.DB);
  f.repo.aplicarLote({ sucursalId: 1, lote: lote('2'), hash: 'hash-2' });
  const app = require('express')();
  require('./sicarRutas').registrarAgenteSicar(app, { repo: f.repo, mantenimiento: require('./mantenimiento') });
  const servidor = app.listen(0, '127.0.0.1');
  await new Promise(resolve => servidor.once('listening', resolve));
  t.after(async () => { servidor.closeAllConnections(); await new Promise(resolve => servidor.close(resolve)); });
  // Los trozos se bajan ya con el sistema en mantenimiento: el agente recibe 503 en ese momento.
  const descargar = f.drive.descargarArchivoDeDriveLimitado;
  let comprobado = false;
  f.drive.descargarArchivoDeDriveLimitado = async (...args) => {
    if (!comprobado) {
      comprobado = true;
      const respuesta = await fetch(`http://127.0.0.1:${servidor.address().port}/api/integraciones/sicar/v1/lotes`, {
        method: 'POST', headers: { Authorization: `Bearer ${credencial.llave}`, 'Content-Type': 'application/json' }, body: '{}',
      });
      assert.equal(respuesta.status, 503);
    }
    return descargar.apply(f.drive, args);
  };
  const r = await respaldos.restaurar(f.DB, f.drive, opciones(c.id));
  assert.equal(r.aplicado, true);
  assert.equal(f.DB.crm.clientes[1].nombre, nombre);
  assert.equal(JSON.parse(f.sqlite.prepare('SELECT datos FROM estado').get().datos).crm.clientes[1].nombre, nombre);
  assert.equal(f.repo.estado(1).siguiente_secuencia, '2');
  assert.equal(require('./mantenimiento').estaActivo(), false);
});

for (const momento of ['antes', 'después']) {
  test(`caída ${momento} del COMMIT y reinicio conservan ambas fuentes de la misma foto`, async t => {
    const f = preparar(t), s = api();
    sembrar(f);
    const m = await s.crearSnapshotSicar(f.repo, f.drive, { DB: f.DB, llave: LLAVE });
    f.repo.aplicarLote({ sucursalId: 1, lote: lote('2'), hash: 'hash-2' });
    f.guardar({ marcador: 'vivo' });
    f.sqlite.close();
    const fuente = `
      const fs = require('node:fs');
      const entrada = JSON.parse(fs.readFileSync(0, 'utf8'));
      const db = new (require('better-sqlite3'))(entrada.ruta);
      const repo = require('./sicarRepositorio').crearRepositorioSicar(db);
      const s = require('./sicarRespaldo');
      s.configurarContexto(repo, { DB: {}, llave: Buffer.alloc(32, 7) });
      const drive = { descargarArchivoDeDriveLimitado: async (_, id) => Buffer.from(entrada.archivos[id], 'base64') };
      (async () => {
        const p = await s.prepararRestauracionSicar(repo, drive, entrada.m);
        p.aplicar(() => {
          db.prepare('UPDATE estado SET datos=?').run(JSON.stringify({ marcador: 'restaurado' }));
          if (entrada.momento === 'antes') process.exit(71);
        });
        process.exit(72);
      })().catch(e => { console.error(e); process.exit(1); });
    `;
    const r = require('node:child_process').spawnSync(process.execPath,
      ['--preserve-symlinks', '--preserve-symlinks-main', '-e', fuente], {
        cwd: __dirname, encoding: 'utf8', timeout: 15000,
        input: JSON.stringify({ ruta: f.ruta, momento, m,
          archivos: Object.fromEntries([...f.drive.archivos].map(([id, b]) => [id, b.toString('base64')])) }),
      });
    assert.equal(r.status, momento === 'antes' ? 71 : 72, r.stderr);
    const nueva = new Database(f.ruta);
    try {
      assert.equal(JSON.parse(nueva.prepare('SELECT datos FROM estado').get().datos).marcador, momento === 'antes' ? 'vivo' : 'restaurado');
      assert.equal(nueva.prepare('SELECT siguiente_secuencia FROM sicar_tiendas').get().siguiente_secuencia, momento === 'antes' ? '3' : '2');
    } finally { nueva.close(); }
  });
}

test('sin reserva de disco no prepara tablas ni cambia las vivas', async t => {
  const f = preparar(t), s = api();
  sembrar(f);
  const m = await s.crearSnapshotSicar(f.repo, f.drive, { DB: f.DB, llave: LLAVE });
  t.mock.method(fs, 'statfsSync', () => ({ bavail: 1, bsize: 4096 }));
  await assert.rejects(s.prepararRestauracionSicar(f.repo, f.drive, m), /espacio|disco|reserva/i);
  assert.equal(f.repo.estado(1).siguiente_secuencia, '2');
});

for (const limite of ['tiempo', 'WAL']) {
  test(`límite de ${limite} libera la lectura y deja fallido el snapshot`, async t => {
    const f = preparar(t), s = api();
    sembrar(f);
    let excedido = false;
    const reloj = Date.now;
    const stat = fs.statSync;
    if (limite === 'tiempo') t.mock.method(Date, 'now', () => reloj() + (excedido ? 60001 : 0));
    else t.mock.method(fs, 'statSync', (ruta, ...args) => {
      const datos = stat(ruta, ...args);
      if (excedido && String(ruta).endsWith('-wal')) datos.size += 33 * 1024 * 1024;
      return datos;
    });
    const original = f.drive.subirArchivoADrive;
    f.drive.subirArchivoADrive = async (...args) => { const r = await original(...args); excedido = true; return r; };
    await assert.rejects(s.crearSnapshotSicar(f.repo, f.drive, { DB: f.DB, llave: LLAVE }), /60 segundos|WAL/);
    excedido = false;
    assert.equal(f.sqlite.pragma('wal_checkpoint(TRUNCATE)')[0].busy, 0);
    assert.equal(f.drive.archivos.size, 0);
    f.repo.aplicarLote({ sucursalId: 1, lote: lote('2'), hash: 'hash-2' });
    assert.equal(f.repo.estado(1).siguiente_secuencia, '3');
  });
}

test('instalación nueva revoca las llaves recuperadas y conserva compras', async t => {
  const f = preparar(t), g = preparar(t), s = api();
  sembrar(f);
  const m = await s.crearSnapshotSicar(f.repo, f.drive, { DB: f.DB, llave: LLAVE });
  s.configurarContexto(g.repo, { DB: g.DB, llave: LLAVE });
  const p = await s.prepararRestauracionSicar(g.repo, f.drive, m);
  p.aplicar(); p.liberar();
  assert.ok(g.repo.obtenerLlave('llave').revocada);
  assert.equal(g.sqlite.prepare('SELECT total_centavos FROM sicar_ventas').get().total_centavos, 20000);
});

test('fallo de guardado nativo hace rollback SICAR y mantiene memoria y estado persistido', async t => {
  const f = preparar(t);
  sembrar(f);
  respaldos.configurarSicar(f.DB, f.repo, () => { throw new Error('Disco interrumpido'); });
  const c = await respaldos.crearRespaldo(f.DB, f.drive, { llave: LLAVE });
  f.DB.crm.clientes[1].nombre = 'Nativo vivo';
  f.guardar(f.DB);
  const persistido = f.sqlite.prepare('SELECT datos FROM estado').get().datos;
  f.repo.aplicarLote({ sucursalId: 1, lote: lote('2'), hash: 'hash-2' });
  await assert.rejects(respaldos.restaurar(f.DB, f.drive, opciones(c.id)), /Disco interrumpido/);
  assert.equal(f.DB.crm.clientes[1].nombre, 'Nativo vivo');
  assert.equal(f.sqlite.prepare('SELECT datos FROM estado').get().datos, persistido);
  assert.equal(f.repo.estado(1).siguiente_secuencia, '3');
  assert.equal(require('./mantenimiento').estaActivo(), false);
});

test('revocaciones posteriores de llaves ausentes de la foto también se conservan', async t => {
  const f = preparar(t), s = api();
  sembrar(f);
  const m = await s.crearSnapshotSicar(f.repo, f.drive, { DB: f.DB, llave: LLAVE });
  f.repo.guardarLlave({ key_id: 'posterior', sucursal_id: 2, secreto_hash: 'b'.repeat(64), creada: 'hoy', actor: '1' });
  f.repo.revocarLlave('posterior');
  const p = await s.prepararRestauracionSicar(f.repo, f.drive, m);
  p.aplicar(); p.liberar();
  assert.ok(f.repo.obtenerLlave('posterior').revocada);
});

test('un manifiesto con conteos o trozos duplicados no prepara tablas', async t => {
  const f = preparar(t), s = api();
  sembrar(f);
  const m = await s.crearSnapshotSicar(f.repo, f.drive, { DB: f.DB, llave: LLAVE });
  const duplicado = structuredClone(m);
  duplicado.trozos[1] = { ...duplicado.trozos[0], orden: 1 };
  await assert.rejects(s.prepararRestauracionSicar(f.repo, f.drive, duplicado), /inválido|orden/);
  m.conteos.sicar_clientes++;
  await assert.rejects(s.prepararRestauracionSicar(f.repo, f.drive, m), /conteo/);
});

test('verificación con conteos inconsistentes nunca muestra completo verificado', async t => {
  const f = preparar(t);
  sembrar(f);
  respaldos.configurarSicar(f.DB, f.repo, f.guardar);
  const c = await respaldos.crearRespaldo(f.DB, f.drive, { llave: LLAVE });
  c.conteos.ventas++;
  assert.equal((await respaldos.verificarRespaldo(f.DB, f.drive, c.id, LLAVE)).ok, false);
  assert.equal(respaldos.estadoCoberturaSicar(f.DB).estado, 'fallido');
});

test('un borrado de huérfanos detenido no retiene el lector ni impide el respaldo del negocio', { timeout: 2000 }, async t => {
  const f = preparar(t);
  sembrar(f);
  respaldos.configurarSicar(f.DB, f.repo, f.guardar);
  let excedido = false;
  const reloj = Date.now;
  t.mock.method(Date, 'now', () => reloj() + (excedido ? 60001 : 0));
  const subir = f.drive.subirArchivoADrive;
  let n = 0;
  f.drive.subirArchivoADrive = async (...args) => {
    if (++n === 2) { excedido = true; throw new Error('Drive interrumpido'); }
    return subir(...args);
  };
  f.drive.eliminarArchivoDeDrive = () => new Promise(() => {});
  const c = await respaldos.crearRespaldo(f.DB, f.drive, { llave: LLAVE });
  assert.equal(c.estado, 'ok');
  assert.equal(c.sicar_estado, 'parcial');
  assert.equal(c.sicar_archivos.length, 1);
  assert.equal(f.sqlite.pragma('wal_checkpoint(TRUNCATE)')[0].busy, 0);
});

const CORTES = ['sicar_cortes', 'sicar_cortes_pagos', 'sicar_cortes_cobros'];
const CAJEROS = ['sicar_cajeros', 'sicar_cajeros_historial'];
const MOSTRADOR = ['sicar_ventas_mostrador', 'sicar_detalles_mostrador'];
const conProveedor = f => f.repo.aplicarLote({ sucursalId: 1, hash: 'hash-p', lote: { batch_id: 'lote-p', sequence: '2',
  mapping_version: 'v1', clientes: [], ventas: [], proveedores: [{ prv_id: '7', nombre: 'Casa Veerkamp' }] } });

test('respaldo viejo de 15 tablas (sin proveedores) sigue abriendo y deja los proveedores vacios', async t => {
  const f = preparar(t), s = api();
  sembrar(f);
  const m = await s.crearSnapshotSicar(f.repo, f.drive, { DB: f.DB, llave: LLAVE });
  const quitadas = ['sicar_proveedores', 'sicar_existencias', ...CORTES, ...CAJEROS, ...MOSTRADOR];
  for (const tabla of quitadas) delete m.conteos[tabla];
  m.trozos = m.trozos.filter(c => !quitadas.includes(c.tabla));
  assert.deepEqual(Object.keys(m.conteos), TABLAS_15, 'misma forma que los respaldos que ya estan en Drive');
  await s.verificarSnapshotSicar(f.repo, f.drive, m);
  conProveedor(f);
  const p = await s.prepararRestauracionSicar(f.repo, f.drive, m);
  p.aplicar(); p.liberar();
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM sicar_proveedores').get().n, 0);
  assert.equal(f.sqlite.prepare('SELECT nombre FROM sicar_clientes').get().nombre, 'José 1');
});

test('respaldo de 24 tablas trae y devuelve los proveedores', async t => {
  const f = preparar(t), g = preparar(t), s = api();
  sembrar(f);
  conProveedor(f);
  const m = await s.crearSnapshotSicar(f.repo, f.drive, { DB: f.DB, llave: LLAVE });
  assert.deepEqual(Object.keys(m.conteos), [...TABLAS_15, 'sicar_proveedores', 'sicar_existencias', ...CORTES, ...CAJEROS, ...MOSTRADOR]);
  assert.equal(m.conteos.sicar_proveedores, 1);
  s.configurarContexto(g.repo, { DB: g.DB, llave: LLAVE });
  const p = await s.prepararRestauracionSicar(g.repo, f.drive, m);
  p.aplicar(); p.liberar();
  assert.deepEqual(g.sqlite.prepare('SELECT sucursal_id, prv_id, nombre FROM sicar_proveedores').all(),
    [{ sucursal_id: 1, prv_id: '7', nombre: 'Casa Veerkamp' }]);
});

const conExistencia = (f, sequence = '2') => f.repo.aplicarLote({ sucursalId: 1, hash: 'hash-e', lote: { batch_id: 'lote-e', sequence,
  mapping_version: 'v1', clientes: [], ventas: [], existencias: [{ art_id: '7', existencia: '-1.5000' }] } });
const sinTablas = (m, tablas) => {
  for (const tabla of tablas) delete m.conteos[tabla];
  m.trozos = m.trozos.filter(c => !tablas.includes(c.tabla));
  return m;
};
const comoRespaldoDe16Tablas = m => sinTablas(m, ['sicar_existencias', ...CORTES, ...CAJEROS, ...MOSTRADOR]);

test('respaldo viejo de 16 tablas (con proveedores, sin existencias) abre y deja las existencias vacias', async t => {
  const f = preparar(t), s = api();
  sembrar(f);
  conProveedor(f);
  const m = comoRespaldoDe16Tablas(await s.crearSnapshotSicar(f.repo, f.drive, { DB: f.DB, llave: LLAVE }));
  assert.deepEqual(Object.keys(m.conteos), [...TABLAS_15, 'sicar_proveedores']);
  await s.verificarSnapshotSicar(f.repo, f.drive, m);
  conExistencia(f, '3');
  const p = await s.prepararRestauracionSicar(f.repo, f.drive, m);
  p.aplicar(); p.liberar();
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM sicar_existencias').get().n, 0);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM sicar_proveedores').get().n, 1);
});

test('respaldo nuevo de 24 tablas conserva las existencias, tambien las negativas', async t => {
  const f = preparar(t), g = preparar(t), s = api();
  sembrar(f);
  conExistencia(f);
  const m = await s.crearSnapshotSicar(f.repo, f.drive, { DB: f.DB, llave: LLAVE });
  assert.equal(Object.keys(m.conteos).at(-8), 'sicar_existencias');
  assert.equal(m.conteos.sicar_existencias, 1);
  s.configurarContexto(g.repo, { DB: g.DB, llave: LLAVE });
  const p = await s.prepararRestauracionSicar(g.repo, f.drive, m);
  p.aplicar(); p.liberar();
  assert.deepEqual(g.sqlite.prepare('SELECT sucursal_id, art_id, existencia_diezmilesimas n FROM sicar_existencias').all(),
    [{ sucursal_id: 1, art_id: '7', n: -15000 }]);
});

test('un manifiesto con existencias pero sin proveedores no es una generacion conocida', async t => {
  const f = preparar(t), s = api();
  sembrar(f);
  const m = await s.crearSnapshotSicar(f.repo, f.drive, { DB: f.DB, llave: LLAVE });
  delete m.conteos.sicar_proveedores;
  m.trozos = m.trozos.filter(c => c.tabla !== 'sicar_proveedores');
  await assert.rejects(() => s.verificarSnapshotSicar(f.repo, f.drive, m), { message: MANIFIESTO_INVALIDO });
});

const corteDePrueba = {
  cor_id: '5', caj_id: '2', fecha_local: '2026-10-22T20:15:00', usu_id: null, contado: '10.00', calculado: '10.33', diferencia: '-0.33',
  retiro: '0.00', pagos: [{ tpa_id: '1', contado: '10.00', calculado: '10.33', diferencia: '-0.33', retiro: '0.00' }],
  cobros: [{ usu_id: null, ventas: 1, total: '10.33', canceladas: 0, total_canceladas: '0.00' }] };
const conCorte = (f, sequence = '5') => f.repo.aplicarLote({ sucursalId: 1, hash: 'hash-c', lote: { batch_id: 'lote-c', sequence,
  mapping_version: 'v1', clientes: [], ventas: [], cortes: [corteDePrueba] } });
const cuenta = (f, tabla) => f.sqlite.prepare(`SELECT count(*) n FROM ${tabla}`).get().n;

test('respaldo de 17 tablas (generacion de existencias) abre y deja los cortes vacios', async t => {
  const f = preparar(t), s = api();
  sembrar(f);
  conExistencia(f);
  const m = sinTablas(await s.crearSnapshotSicar(f.repo, f.drive, { DB: f.DB, llave: LLAVE }), [...CORTES, ...CAJEROS, ...MOSTRADOR]);
  assert.equal(Object.keys(m.conteos).length, 17);
  await s.verificarSnapshotSicar(f.repo, f.drive, m);
  conCorte(f, '3');
  const p = await s.prepararRestauracionSicar(f.repo, f.drive, m);
  p.aplicar(); p.liberar();
  for (const tabla of CORTES) assert.equal(cuenta(f, tabla), 0, tabla);
  assert.equal(cuenta(f, 'sicar_existencias'), 1);
});

test('respaldo nuevo de 24 tablas conserva cortes, pagos y cobros', async t => {
  const f = preparar(t), g = preparar(t), s = api();
  sembrar(f);
  conCorte(f, '2');
  const m = await s.crearSnapshotSicar(f.repo, f.drive, { DB: f.DB, llave: LLAVE });
  assert.deepEqual(Object.keys(m.conteos).slice(-7, -4), CORTES);
  assert.deepEqual([m.conteos.sicar_cortes, m.conteos.sicar_cortes_pagos, m.conteos.sicar_cortes_cobros], [1, 1, 1]);
  s.configurarContexto(g.repo, { DB: g.DB, llave: LLAVE });
  const p = await s.prepararRestauracionSicar(g.repo, f.drive, m);
  p.aplicar(); p.liberar();
  assert.deepEqual(g.sqlite.prepare('SELECT cor_id, diferencia_centavos FROM sicar_cortes').all(), [{ cor_id: '5', diferencia_centavos: -33 }]);
  assert.deepEqual(g.sqlite.prepare('SELECT tpa_id, diferencia_centavos FROM sicar_cortes_pagos').all(), [{ tpa_id: '1', diferencia_centavos: -33 }]);
  assert.deepEqual(g.sqlite.prepare('SELECT usu_id, total_centavos FROM sicar_cortes_cobros').all(), [{ usu_id: '', total_centavos: 1033 }]);
});

test('un manifiesto con pagos de corte pero sin cortes no es una generacion conocida', async t => {
  const f = preparar(t), s = api();
  sembrar(f);
  conCorte(f, '2');
  const m = sinTablas(await s.crearSnapshotSicar(f.repo, f.drive, { DB: f.DB, llave: LLAVE }), ['sicar_cortes']);
  await assert.rejects(() => s.verificarSnapshotSicar(f.repo, f.drive, m), { message: MANIFIESTO_INVALIDO });
});

const conNombre = (f, nombre = 'Ana') => f.sqlite.exec(`INSERT INTO sicar_cajeros VALUES (1, '52', '${nombre}', '9', 'hoy')
  ON CONFLICT(sucursal_id, usu_id) DO UPDATE SET nombre=excluded.nombre;
  INSERT INTO sicar_cajeros_historial(sucursal_id, usu_id, nombre_anterior, nombre_nuevo, actor, fecha)
  VALUES (1, '52', NULL, '${nombre}', '9', 'hoy')`);

test('respaldo de 20 tablas (generacion de cortes) abre y deja vacios los nombres del personal', async t => {
  const f = preparar(t), s = api();
  sembrar(f);
  conCorte(f, '2');
  conNombre(f);
  const m = sinTablas(await s.crearSnapshotSicar(f.repo, f.drive, { DB: f.DB, llave: LLAVE }), [...CAJEROS, ...MOSTRADOR]);
  assert.equal(Object.keys(m.conteos).length, 20);
  assert.deepEqual(Object.keys(m.conteos).slice(-3), CORTES, 'misma forma que los respaldos de cortes que ya estan en Drive');
  await s.verificarSnapshotSicar(f.repo, f.drive, m);
  conNombre(f, 'Beto');
  const p = await s.prepararRestauracionSicar(f.repo, f.drive, m);
  p.aplicar(); p.liberar();
  for (const tabla of CAJEROS) assert.equal(cuenta(f, tabla), 0, tabla);
  assert.equal(cuenta(f, 'sicar_cortes'), 1);
});

test('respaldo nuevo de 24 tablas conserva nombres del personal y su historial', async t => {
  const f = preparar(t), g = preparar(t), s = api();
  sembrar(f);
  conCorte(f, '2');
  conNombre(f);
  conNombre(f, 'Ana María');
  const m = await s.crearSnapshotSicar(f.repo, f.drive, { DB: f.DB, llave: LLAVE });
  assert.equal(Object.keys(m.conteos).length, 24);
  assert.deepEqual(Object.keys(m.conteos).slice(-7), [...CORTES, ...CAJEROS, ...MOSTRADOR]);
  assert.deepEqual([m.conteos.sicar_cajeros, m.conteos.sicar_cajeros_historial], [1, 2]);
  s.configurarContexto(g.repo, { DB: g.DB, llave: LLAVE });
  const p = await s.prepararRestauracionSicar(g.repo, f.drive, m);
  p.aplicar(); p.liberar();
  for (const tabla of CAJEROS) {
    assert.deepEqual(g.sqlite.prepare(`SELECT * FROM ${tabla}`).all(), f.sqlite.prepare(`SELECT * FROM ${tabla}`).all(), tabla);
  }
});

test('un manifiesto con historial de nombres pero sin nombres no es una generacion conocida', async t => {
  const f = preparar(t), s = api();
  sembrar(f);
  conCorte(f, '2');
  conNombre(f);
  const m = sinTablas(await s.crearSnapshotSicar(f.repo, f.drive, { DB: f.DB, llave: LLAVE }), ['sicar_cajeros']);
  await assert.rejects(() => s.verificarSnapshotSicar(f.repo, f.drive, m), { message: MANIFIESTO_INVALIDO });
});

const ventaMostrador = { ven_id: '70', fecha_local: '2026-10-22T10:00:00', estado: 'vigente', total: '30.25',
  detalle: [{ art_id: '1', cantidad: '1.5000', importe_con: '10.25', descuento_total: '0.50' },
    { art_id: '2', cantidad: '1.0000', importe_con: '20.00', descuento_total: '0.00' }] };
const conMostrador = (f, sequence = '6') => f.repo.aplicarLote({ sucursalId: 1, hash: 'hash-m', lote: { batch_id: 'lote-m', sequence,
  mapping_version: 'v1', clientes: [], ventas: [], mostrador: [ventaMostrador] } });
const filasMostrador = f => ({
  ventas: f.sqlite.prepare('SELECT * FROM sicar_ventas_mostrador ORDER BY ven_id').all(),
  detalles: f.sqlite.prepare('SELECT * FROM sicar_detalles_mostrador ORDER BY ven_id, renglon').all() });

test('respaldo de 22 tablas (generacion de nombres del personal) abre y deja vacio el mostrador', async t => {
  const f = preparar(t), s = api();
  sembrar(f);
  conNombre(f);
  const m = sinTablas(await s.crearSnapshotSicar(f.repo, f.drive, { DB: f.DB, llave: LLAVE }), MOSTRADOR);
  assert.equal(Object.keys(m.conteos).length, 22);
  assert.deepEqual(Object.keys(m.conteos).slice(-2), CAJEROS, 'misma forma que los respaldos de 22 tablas que ya estan en Drive');
  await s.verificarSnapshotSicar(f.repo, f.drive, m);
  conMostrador(f, '2');
  const p = await s.prepararRestauracionSicar(f.repo, f.drive, m);
  p.aplicar(); p.liberar();
  for (const tabla of MOSTRADOR) assert.equal(cuenta(f, tabla), 0, tabla);
  assert.equal(cuenta(f, 'sicar_cajeros'), 1);
});

test('respaldo nuevo de 24 tablas conserva ventas y renglones de mostrador', async t => {
  const f = preparar(t), g = preparar(t), s = api();
  sembrar(f);
  conMostrador(f, '2');
  const m = await s.crearSnapshotSicar(f.repo, f.drive, { DB: f.DB, llave: LLAVE });
  assert.equal(Object.keys(m.conteos).length, 24);
  assert.deepEqual(Object.keys(m.conteos).slice(-2), MOSTRADOR);
  assert.deepEqual([m.conteos.sicar_ventas_mostrador, m.conteos.sicar_detalles_mostrador], [1, 2]);
  s.configurarContexto(g.repo, { DB: g.DB, llave: LLAVE });
  const p = await s.prepararRestauracionSicar(g.repo, f.drive, m);
  p.aplicar(); p.liberar();
  assert.equal(cuenta(g, 'sicar_detalles_mostrador'), 2);
  assert.deepEqual(filasMostrador(g), filasMostrador(f));
});

test('un manifiesto con renglones de mostrador pero sin ventas de mostrador no es una generacion conocida', async t => {
  const f = preparar(t), s = api();
  sembrar(f);
  conMostrador(f, '2');
  const m = sinTablas(await s.crearSnapshotSicar(f.repo, f.drive, { DB: f.DB, llave: LLAVE }), ['sicar_ventas_mostrador']);
  await assert.rejects(() => s.verificarSnapshotSicar(f.repo, f.drive, m), { message: MANIFIESTO_INVALIDO });
});
