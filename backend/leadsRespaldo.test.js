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

const { inicializarPersistenciaCentroLeads } = require('./centroLeads/persistencia');
const { crearContextoBandeja } = require('./bandeja/mensajes');
const { crearResponsables } = require('./bandeja/responsable');

// Base con SICAR, tablas de la bandeja y una conversación de Ana (cliente 5) con responsable.
function conBandeja(t) {
  const f = preparar(t);
  inicializarPersistenciaCentroLeads(f.sqlite);
  f.DB.crm.clientes.push({ id: 5, nombre: 'Ana', celular: '9191112233', sucursal_id: 1, vendedor_asignado_id: null, estado: null });
  f.DB.pos.vendedores ??= [];
  f.DB.pos.vendedores.push({ id: 71, nombre: 'Vero', sucursal_id: 1, activo: true });
  f.DB.crm.contactos_cliente ??= [];
  f.bandeja = crearContextoBandeja({ sqlite: f.sqlite, DB: f.DB, repo: f.repo, guardar: f.guardar });
  const canal = f.bandeja.registrarCanal({ canal: 'whatsapp', proveedor: 'simulado', identificador_externo: '529190000001',
    nombre: 'WhatsApp Ocosingo', sucursal_id: 1 });
  f.conversacion = f.bandeja.recibirEntrante({ fuente_id: canal.id, id_evento: 'ev-1', remitente: { id_externo: '529191112233' },
    texto: '¿Tienen bafles?', ocurrido_en: '2026-10-18T18:00:00.000Z' }).conversacion_id;
  crearResponsables(f.bandeja).tomar(5, { vendedor_id: 71, usuario_id: 1 });
  return f;
}
const foto = (sqlite, tabla) => sqlite.prepare(`SELECT * FROM ${tabla} ORDER BY rowid`).all();
const TABLAS_LEADS = ['lead_fuentes', 'lead_identidades_externas', 'lead_conversaciones', 'leads', 'lead_interacciones',
  'lead_eventos_externos', 'lead_asignaciones', 'lead_historial'];

const CORTES = ['sicar_cortes', 'sicar_cortes_pagos', 'sicar_cortes_cobros'];
const CAJEROS = ['sicar_cajeros', 'sicar_cajeros_historial'];
const MOSTRADOR = ['sicar_ventas_mostrador', 'sicar_detalles_mostrador'];
test('las conversaciones viajan en la copia y se restauran idénticas junto con los datos del negocio', async t => {
  const f = conBandeja(t), g = preparar(t), s = api();
  inicializarPersistenciaCentroLeads(g.sqlite);
  assert.equal(s.tieneDatosSicar(f.repo), true);
  const m = await s.crearSnapshotSicar(f.repo, f.drive, { DB: f.DB, llave: LLAVE });
  assert.equal(m.conteos.lead_interacciones, 1);
  assert.equal(m.version_leads, 4);
  await s.verificarSnapshotSicar(f.repo, f.drive, m);
  s.configurarContexto(g.repo, { DB: g.DB, llave: LLAVE });
  const p = await s.prepararRestauracionSicar(g.repo, f.drive, m);
  let guardado = false;
  p.aplicar(() => { guardado = true; }, { clientes: f.DB.crm.clientes, fechaFoto: m.generado_en });
  p.liberar();
  assert.equal(guardado, true);
  for (const tabla of TABLAS_LEADS) assert.deepEqual(foto(g.sqlite, tabla), foto(f.sqlite, tabla), tabla);
});

test('una base solo con conversaciones (sin SICAR) también entra al respaldo', async t => {
  const f = preparar(t), s = api();
  inicializarPersistenciaCentroLeads(f.sqlite);
  assert.equal(s.tieneDatosSicar(f.repo), false);
  f.sqlite.prepare(`INSERT INTO lead_fuentes (canal, proveedor, identificador_externo, nombre) VALUES ('whatsapp','simulado','x','X')`).run();
  assert.equal(s.tieneDatosSicar(f.repo), true);
});

test('sin tablas de la bandeja el respaldo sigue con la generación de 24 tablas', async t => {
  const f = preparar(t), s = api();
  sembrar(f);
  const m = await s.crearSnapshotSicar(f.repo, f.drive, { DB: f.DB, llave: LLAVE });
  assert.equal(Object.keys(m.conteos).length, 24);
  assert.equal(m.version_leads, undefined);
});

test('restaurar una copia sin conversaciones conserva los mensajes y suelta las ligas posteriores a la foto', async t => {
  const f = conBandeja(t), s = api();
  const m = await s.crearSnapshotSicar(f.repo, f.drive, { DB: f.DB, llave: LLAVE });
  for (const tabla of Object.keys(m.conteos)) if (!tabla.startsWith('sicar_')) delete m.conteos[tabla];
  m.trozos = m.trozos.filter(c => c.tabla.startsWith('sicar_'));
  m.trozos.forEach((c, i) => { c.orden = i; });
  delete m.version_leads;
  // La foto es de antes de la conversación: la liga de Ana ya no se puede confiar.
  const p = await s.prepararRestauracionSicar(f.repo, f.drive, m);
  p.aplicar(() => {}, { clientes: f.DB.crm.clientes, fechaFoto: '2026-01-01T00:00:00.000Z' });
  p.liberar();
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM lead_interacciones').get().n, 1);
  assert.equal(f.sqlite.prepare('SELECT cliente_id FROM lead_identidades_externas').get().cliente_id, null);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM leads WHERE cliente_id IS NOT NULL').get().n, 0);
});

test('soltar ligas: conserva las anteriores a la foto con cliente vigente y suelta las de clientes que no existen', t => {
  const f = conBandeja(t), s = api();
  s.desligarLeadsParciales(f.sqlite, f.DB.crm.clientes, '2099-01-01T00:00:00.000Z');
  assert.equal(f.sqlite.prepare('SELECT cliente_id FROM lead_identidades_externas').get().cliente_id, 5);
  s.desligarLeadsParciales(f.sqlite, f.DB.crm.clientes.filter(c => c.id !== 5), '2099-01-01T00:00:00.000Z');
  assert.equal(f.sqlite.prepare('SELECT cliente_id FROM lead_identidades_externas').get().cliente_id, null);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM leads WHERE cliente_id IS NOT NULL').get().n, 0);
});

test('una copia con versión de bandeja distinta no se aplica', async t => {
  const f = conBandeja(t), s = api();
  const m = await s.crearSnapshotSicar(f.repo, f.drive, { DB: f.DB, llave: LLAVE });
  m.version_leads = 3;
  await assert.rejects(s.prepararRestauracionSicar(f.repo, f.drive, m), /bandeja/i);
});

test('restauración completa: conversaciones y clientes vuelven juntos a la foto; el previo permite deshacer', async t => {
  const f = conBandeja(t);
  respaldos.configurarSicar(f.DB, f.repo, f.guardar);
  const c = await respaldos.crearRespaldo(f.DB, f.drive, { llave: LLAVE });
  assert.equal(c.sicar_estado, 'completo');
  const canal = f.sqlite.prepare('SELECT id FROM lead_fuentes').get().id;
  f.bandeja.recibirEntrante({ fuente_id: canal, id_evento: 'ev-2', remitente: { id_externo: '529197776655', nombre: 'Pedro' },
    texto: 'Llegué después de la foto', ocurrido_en: new Date().toISOString() });
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM lead_interacciones').get().n, 2);
  const r = await respaldos.restaurar(f.DB, f.drive, { copiaId: c.id, llave: LLAVE, clave: 'local', confirmacion: 'RESTAURAR',
    env: { CLAVE_RESTAURACION: 'local' }, usuario: { id: 1 }, permisos: ['ver_todas_las_sucursales'] });
  assert.equal(r.sicar_restaurado, true);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM lead_interacciones').get().n, 1);
  assert.equal(f.DB.crm.clientes.some(cl => cl.nombre === 'Pedro'), false);
  assert.equal(f.sqlite.prepare('SELECT cliente_id FROM lead_identidades_externas').get().cliente_id, 5);
  assert.equal(r.pre_restauracion.sicar_estado, 'completo');
});

test('restauración parcial (copia dañada): los mensajes se conservan y las ligas posteriores pasan a Por identificar', async t => {
  const f = conBandeja(t);
  respaldos.configurarSicar(f.DB, f.repo, f.guardar);
  const c = await respaldos.crearRespaldo(f.DB, f.drive, { llave: LLAVE });
  const leido = await respaldos.leerRespaldo(f.DB, f.drive, c.id, LLAVE);
  f.drive.archivos.get(leido.foto.sicar.trozos[0].drive_file_id)[0] ^= 1;
  const canal = f.sqlite.prepare('SELECT id FROM lead_fuentes').get().id;
  f.bandeja.recibirEntrante({ fuente_id: canal, id_evento: 'ev-3', remitente: { id_externo: '529197776655', nombre: 'Pedro' },
    texto: 'Después de la foto', ocurrido_en: new Date().toISOString() });
  const r = await respaldos.restaurar(f.DB, f.drive, { copiaId: c.id, llave: LLAVE, clave: 'local', confirmacion: 'RESTAURAR',
    env: { CLAVE_RESTAURACION: 'local' }, usuario: { id: 1 }, permisos: ['ver_todas_las_sucursales'] });
  assert.equal(r.sicar_restaurado, false);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM lead_interacciones').get().n, 2);
  const ligas = f.sqlite.prepare('SELECT identificador_externo, cliente_id FROM lead_identidades_externas ORDER BY id').all();
  assert.deepEqual(ligas, [{ identificador_externo: '529191112233', cliente_id: 5 }, { identificador_externo: '529197776655', cliente_id: null }]);
});

// Forma exacta de los respaldos con bandeja que ya están en Drive: 15 tablas SICAR + 21 de la bandeja, sin proveedores.
test('respaldo viejo de 36 tablas (bandeja sin proveedores) sigue abriendo y trae las conversaciones', async t => {
  const f = conBandeja(t), g = preparar(t), s = api();
  inicializarPersistenciaCentroLeads(g.sqlite);
  const m = await s.crearSnapshotSicar(f.repo, f.drive, { DB: f.DB, llave: LLAVE });
  assert.equal(Object.keys(m.conteos).length, 45);
  assert.deepEqual(Object.keys(m.conteos).slice(15, 25), ['sicar_proveedores', 'sicar_existencias', ...CORTES, ...CAJEROS, ...MOSTRADOR, 'centro_leads_schema_version']);
  const viejo = structuredClone(m);
  const quitadas = ['sicar_proveedores', 'sicar_existencias', ...CORTES, ...CAJEROS, ...MOSTRADOR];
  for (const tabla of quitadas) delete viejo.conteos[tabla];
  viejo.trozos = viejo.trozos.filter(c => !quitadas.includes(c.tabla));
  assert.equal(Object.keys(viejo.conteos).length, 36);
  assert.equal(viejo.trozos.some(c => c.tabla === 'sicar_proveedores'), false);
  g.repo.aplicarLote({ sucursalId: 1, hash: 'hash-p', lote: { batch_id: 'lote-p', sequence: '1', mapping_version: 'v1',
    clientes: [], ventas: [], proveedores: [{ prv_id: '7', nombre: 'Casa Veerkamp' }] } });
  s.configurarContexto(g.repo, { DB: g.DB, llave: LLAVE });
  const p = await s.prepararRestauracionSicar(g.repo, f.drive, viejo);
  p.aplicar(() => {}, { clientes: f.DB.crm.clientes, fechaFoto: m.generado_en });
  p.liberar();
  for (const tabla of TABLAS_LEADS) assert.deepEqual(foto(g.sqlite, tabla), foto(f.sqlite, tabla), tabla);
  assert.equal(g.sqlite.prepare('SELECT count(*) n FROM sicar_proveedores').get().n, 0);
});

test('respaldo viejo de 37 tablas (bandeja con proveedores, sin existencias) sigue abriendo', async t => {
  const f = conBandeja(t), g = preparar(t), s = api();
  inicializarPersistenciaCentroLeads(g.sqlite);
  const m = await s.crearSnapshotSicar(f.repo, f.drive, { DB: f.DB, llave: LLAVE });
  const viejo = structuredClone(m);
  const quitadas = ['sicar_existencias', ...CORTES, ...CAJEROS, ...MOSTRADOR];
  for (const tabla of quitadas) delete viejo.conteos[tabla];
  viejo.trozos = viejo.trozos.filter(c => !quitadas.includes(c.tabla));
  assert.equal(Object.keys(viejo.conteos).length, 37);
  g.repo.aplicarLote({ sucursalId: 1, hash: 'hash-e', lote: { batch_id: 'lote-e', sequence: '1', mapping_version: 'v1',
    clientes: [], ventas: [], existencias: [{ art_id: '7', existencia: '3.0000' }] } });
  s.configurarContexto(g.repo, { DB: g.DB, llave: LLAVE });
  const p = await s.prepararRestauracionSicar(g.repo, f.drive, viejo);
  p.aplicar(() => {}, { clientes: f.DB.crm.clientes, fechaFoto: m.generado_en });
  p.liberar();
  for (const tabla of TABLAS_LEADS) assert.deepEqual(foto(g.sqlite, tabla), foto(f.sqlite, tabla), tabla);
  assert.equal(g.sqlite.prepare('SELECT count(*) n FROM sicar_existencias').get().n, 0);
});

test('respaldo viejo de 38 tablas (bandeja con existencias, sin cortes) sigue abriendo y deja los cortes vacios', async t => {
  const f = conBandeja(t), g = preparar(t), s = api();
  inicializarPersistenciaCentroLeads(g.sqlite);
  const m = await s.crearSnapshotSicar(f.repo, f.drive, { DB: f.DB, llave: LLAVE });
  assert.equal(Object.keys(m.conteos).length, 45);
  const viejo = structuredClone(m);
  for (const tabla of [...CORTES, ...CAJEROS, ...MOSTRADOR]) delete viejo.conteos[tabla];
  viejo.trozos = viejo.trozos.filter(c => ![...CORTES, ...CAJEROS, ...MOSTRADOR].includes(c.tabla));
  assert.equal(Object.keys(viejo.conteos).length, 38);
  s.configurarContexto(g.repo, { DB: g.DB, llave: LLAVE });
  const p = await s.prepararRestauracionSicar(g.repo, f.drive, viejo);
  p.aplicar(() => {}, { clientes: f.DB.crm.clientes, fechaFoto: m.generado_en });
  p.liberar();
  for (const tabla of TABLAS_LEADS) assert.deepEqual(foto(g.sqlite, tabla), foto(f.sqlite, tabla), tabla);
  for (const tabla of CORTES) assert.equal(g.sqlite.prepare(`SELECT count(*) n FROM ${tabla}`).get().n, 0, tabla);
});

test('respaldo viejo de 41 tablas (bandeja con cortes, sin nombres del personal) sigue abriendo y deja los nombres vacios', async t => {
  const f = conBandeja(t), g = preparar(t), s = api();
  inicializarPersistenciaCentroLeads(g.sqlite);
  const m = await s.crearSnapshotSicar(f.repo, f.drive, { DB: f.DB, llave: LLAVE });
  const viejo = structuredClone(m);
  for (const tabla of [...CAJEROS, ...MOSTRADOR]) delete viejo.conteos[tabla];
  viejo.trozos = viejo.trozos.filter(c => ![...CAJEROS, ...MOSTRADOR].includes(c.tabla));
  assert.equal(Object.keys(viejo.conteos).length, 41);
  g.sqlite.exec(`INSERT INTO sicar_tiendas(sucursal_id) VALUES (1);
    INSERT INTO sicar_cajeros VALUES (1, '52', 'Ana', '9', 'hoy');
    INSERT INTO sicar_cajeros_historial(sucursal_id, usu_id, nombre_anterior, nombre_nuevo, actor, fecha) VALUES (1, '52', NULL, 'Ana', '9', 'hoy')`);
  s.configurarContexto(g.repo, { DB: g.DB, llave: LLAVE });
  const p = await s.prepararRestauracionSicar(g.repo, f.drive, viejo);
  p.aplicar(() => {}, { clientes: f.DB.crm.clientes, fechaFoto: m.generado_en });
  p.liberar();
  for (const tabla of TABLAS_LEADS) assert.deepEqual(foto(g.sqlite, tabla), foto(f.sqlite, tabla), tabla);
  for (const tabla of CAJEROS) assert.equal(g.sqlite.prepare(`SELECT count(*) n FROM ${tabla}`).get().n, 0, tabla);
});

test('respaldo viejo de 43 tablas (bandeja con nombres del personal, sin mostrador) sigue abriendo y deja el mostrador vacio', async t => {
  const f = conBandeja(t), g = preparar(t), s = api();
  inicializarPersistenciaCentroLeads(g.sqlite);
  const m = await s.crearSnapshotSicar(f.repo, f.drive, { DB: f.DB, llave: LLAVE });
  const viejo = structuredClone(m);
  for (const tabla of MOSTRADOR) delete viejo.conteos[tabla];
  viejo.trozos = viejo.trozos.filter(c => !MOSTRADOR.includes(c.tabla));
  assert.equal(Object.keys(viejo.conteos).length, 43);
  g.sqlite.exec(`INSERT INTO sicar_tiendas(sucursal_id) VALUES (1);
    INSERT INTO sicar_ventas_mostrador VALUES (1, '70', '2026-10-22T10:00:00', 'vigente', 3025, 'hoy');
    INSERT INTO sicar_detalles_mostrador VALUES (1, '70', 0, '1', '1.0000', 3025, 0)`);
  s.configurarContexto(g.repo, { DB: g.DB, llave: LLAVE });
  const p = await s.prepararRestauracionSicar(g.repo, f.drive, viejo);
  p.aplicar(() => {}, { clientes: f.DB.crm.clientes, fechaFoto: m.generado_en });
  p.liberar();
  for (const tabla of TABLAS_LEADS) assert.deepEqual(foto(g.sqlite, tabla), foto(f.sqlite, tabla), tabla);
  for (const tabla of MOSTRADOR) assert.equal(g.sqlite.prepare(`SELECT count(*) n FROM ${tabla}`).get().n, 0, tabla);
});
