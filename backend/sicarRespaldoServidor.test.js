// Separada de sicarRespaldo.test.js: carga server.js completo (timers y SQLite propios),
// igual que sicarAislamiento.test.js, para no compartir proceso con las pruebas unitarias.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { crearRepositorioSicar } = require('./sicarRepositorio');
const respaldos = require('./respaldos');
const { construirDBPrueba } = require('./testHelpers');
const LLAVE = Buffer.alloc(32, 7);

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
    fs.rmSync(carpeta, { recursive: true, force: true });
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

test('servidor expone cobertura SICAR con su permiso y respalda automáticamente las tablas', async t => {
  const limpiezas = [];
  const f = preparar({ after: fn => limpiezas.push(fn) });
  sembrar(f);
  process.env.DB_PATH = f.ruta;
  process.env.SENTRY_ENABLED = 'false';
  process.env.RESPALDO_LLAVE = LLAVE.toString('hex');
  const app = require('./server');
  const persistencia = require('./persistencia');
  Object.assign(app.DB, f.DB);
  const { sembrarCuentas } = require('./testHelpers');
  sembrarCuentas(app, [{ id: 99, rol_id: 1, sucursal_id: 1 }]);
  const token = require('./auth').firmarToken({ id: 99, rol_id: 1, sucursal_id: 1 });
  const real = require('./drive');
  for (const k of ['asegurarCarpetaRespaldos', 'subirArchivoADrive', 'descargarArchivoDeDrive',
    'descargarArchivoDeDriveLimitado', 'eliminarArchivoDeDrive']) t.mock.method(real, k, f.drive[k].bind(f.drive));
  const servidor = app.listen(0, '127.0.0.1');
  await new Promise(resolve => servidor.once('listening', resolve));
  t.after(async () => {
    servidor.closeAllConnections();
    await new Promise(resolve => servidor.close(resolve));
    persistencia.obtenerConexionSqlite().close();
    for (const limpiar of limpiezas) limpiar();
  });
  const base = `http://127.0.0.1:${servidor.address().port}/api`;
  const headers = { Authorization: `Bearer ${token}` };
  const antes = await fetch(`${base}/sicar/respaldo`, { headers });
  assert.equal(antes.status, 200);
  assert.equal((await antes.json()).ultimo_completo, null);
  const copia = await fetch(`${base}/respaldos/ahora`, { method: 'POST', headers });
  assert.equal(copia.status, 200, await copia.clone().text());
  assert.equal((await copia.json()).sicar_estado, 'completo');
  const despues = await fetch(`${base}/sicar/respaldo`, { headers });
  assert.ok((await despues.json()).ultimo_completo);
  assert.equal((await fetch(`${base}/sicar/respaldo`)).status, 401);
  process.env.CLAVE_RESTAURACION = 'local';
  const id = app.DB.respaldos.copias[0].id;
  const foto = await respaldos.leerRespaldo(app.DB, real, id, LLAVE);
  f.drive.archivos.delete(foto.foto.sicar.trozos[0].drive_file_id);
  const restaurada = await fetch(`${base}/respaldos/${id}/restaurar`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ clave: 'local', confirmacion: 'RESTAURAR' }),
  });
  assert.equal(restaurada.status, 200, await restaurada.clone().text());
  const resultado = await restaurada.json();
  assert.equal(resultado.sicar_restaurado, false);
  assert.match(resultado.aviso_sicar, /SICAR/);
});
