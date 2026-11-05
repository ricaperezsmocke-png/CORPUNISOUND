const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { crearRepositorioSicar } = require('../sicarRepositorio');
const respaldo = require('../sicarRespaldo');
const LLAVE = Buffer.alloc(32, 7);
const TABLAS = ['seguimiento_config', 'seguimiento_config_historial', 'seguimiento_tiendas',
  'seguimiento_foto', 'seguimiento_foto_problemas', 'seguimiento_pendientes', 'seguimiento_resultado',
  'seguimiento_avisos', 'seguimiento_avisos_historial'];

function prepararDB(t) {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'seguimiento-'));
  const sqlite = new Database(path.join(carpeta, 'prueba.sqlite'));
  sqlite.pragma('journal_mode = WAL');
  const repo = crearRepositorioSicar(sqlite);
  respaldo.configurarContexto(repo, { DB: {}, llave: LLAVE });
  t.after(() => {
    sqlite.close();
    fs.rmSync(carpeta, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  const archivos = new Map();
  const drive = {
    asegurarCarpetaRespaldos: async () => 'carpeta',
    async subirArchivoADrive(_DB, { contenidoBuffer }) {
      const id = String(archivos.size + 1);
      archivos.set(id, contenidoBuffer);
      return { id };
    },
    async descargarArchivoDeDriveLimitado(_DB, id) { return archivos.get(id); },
    async eliminarArchivoDeDrive(_DB, id) { archivos.delete(id); },
  };
  return { sqlite, repo, drive };
}

function sembrar(sqlite) {
  sqlite.exec(`
    INSERT INTO seguimiento_config VALUES ('dias_traslado', '46', '9', 'hoy');
    INSERT INTO seguimiento_config_historial(clave, anterior, nuevo, actor, fecha)
      VALUES ('dias_traslado', '45', '46', '9', 'hoy');
    INSERT INTO seguimiento_tiendas VALUES (6, '2026-11-05T11:00:00.000Z', '9', 'hoy');
    INSERT INTO seguimiento_foto VALUES (6, 'A', '9007199254740993');
    INSERT INTO seguimiento_foto_problemas VALUES (6, 'B', 'clave_repetida');
    INSERT INTO seguimiento_pendientes VALUES ('A', 'hoy');
    INSERT INTO seguimiento_resultado VALUES (6, '123456789012345678901234567890', 0, 'A', '{}', 1, 'hoy');
    INSERT INTO seguimiento_avisos VALUES (1, 6, '123456789012345678901234567890', 'traslado', 'nuevo', NULL);
    INSERT INTO seguimiento_avisos_historial(aviso_id, estado, motivo, actor, fecha)
      VALUES (1, 'nuevo', 'Etapa', '9', 'hoy');
  `);
}

test('generación nueva conserva todas las tablas y restaura atómicamente', async t => {
  const f = prepararDB(t), g = prepararDB(t);
  sembrar(f.sqlite);
  const m = await respaldo.crearSnapshotSicar(f.repo, f.drive, { DB: {}, llave: LLAVE });
  for (const tabla of TABLAS) assert.equal(m.conteos[tabla], 1);
  const p = await respaldo.prepararRestauracionSicar(g.repo, f.drive, m);
  assert.throws(() => p.aplicar(() => { throw new Error('fallo de guardado'); }), /fallo de guardado/);
  for (const tabla of TABLAS) assert.equal(g.sqlite.prepare(`SELECT count(*) n FROM ${tabla}`).get().n, 0);
  p.aplicar();
  p.liberar();
  for (const tabla of TABLAS) {
    assert.deepEqual(g.sqlite.prepare(`SELECT * FROM ${tabla}`).all(), f.sqlite.prepare(`SELECT * FROM ${tabla}`).all());
  }
});

test('sin filas conserva generación anterior; restaurarla deja seguimiento vacío', async t => {
  const f = prepararDB(t), g = prepararDB(t);
  const m = await respaldo.crearSnapshotSicar(f.repo, f.drive, { DB: {}, llave: LLAVE });
  assert.equal(Object.keys(m.conteos).length, 30);
  for (const tabla of TABLAS) assert.equal(Object.hasOwn(m.conteos, tabla), false);
  sembrar(g.sqlite);
  const p = await respaldo.prepararRestauracionSicar(g.repo, f.drive, m);
  p.aplicar();
  p.liberar();
  for (const tabla of TABLAS) assert.equal(g.sqlite.prepare(`SELECT count(*) n FROM ${tabla}`).get().n, 0);
});

test('una sobrescritura sola activa la generación nueva y cuenta como datos respaldables', async t => {
  const f = prepararDB(t);
  assert.equal(respaldo.tieneDatosSicar(f.repo), false);
  f.sqlite.exec("INSERT INTO seguimiento_config(clave, valor) VALUES ('dias_traslado', '46')");
  assert.equal(respaldo.tieneDatosSicar(f.repo), true);
  const m = await respaldo.crearSnapshotSicar(f.repo, f.drive, { DB: {}, llave: LLAVE });
  assert.equal(m.conteos.seguimiento_config, 1);
  assert.equal(Object.keys(m.conteos).length, 44);
});

test('avisos rechaza estados ajenos al contrato y duplicados por factura y etapa', t => {
  const f = prepararDB(t);
  sembrar(f.sqlite);
  assert.throws(() => f.sqlite.exec("UPDATE seguimiento_avisos SET estado='vendido'"), /CHECK/);
  assert.throws(() => f.sqlite.exec(`INSERT INTO seguimiento_avisos
    VALUES (2, 6, '123456789012345678901234567890', 'traslado', 'nuevo', NULL)`), /UNIQUE/);
});
