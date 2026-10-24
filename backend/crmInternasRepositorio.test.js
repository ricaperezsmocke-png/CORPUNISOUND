const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { crearRepositorioSicar } = require('./sicarRepositorio');
const respaldo = require('./sicarRespaldo');

function preparar(t, persistente = false) {
  const carpeta = persistente ? fs.mkdtempSync(path.join(__dirname, 'tmp-internas-')) : null;
  const sqlite = new Database(carpeta ? path.join(carpeta, 'prueba.sqlite') : ':memory:');
  if (persistente) sqlite.pragma('journal_mode = WAL');
  const repo = crearRepositorioSicar(sqlite);
  sqlite.exec("INSERT INTO sicar_tiendas(sucursal_id) VALUES (1); INSERT INTO sicar_clientes(sucursal_id, cli_id, nombre) VALUES (1, '9', 'Tienda');");
  t.after(() => {
    sqlite.close();
    if (carpeta) fs.rmSync(carpeta, { recursive: true });
  });
  return { sqlite, repo };
}
const datos = interna => ({ sucursal_id: 1, cli_id: '9', interna, motivo: 'Cuenta de tienda', usuario_id: 7, fecha_hora: '2026-10-15T12:00:00Z' });

test('marca y desmarca SICAR con usuario e historial; conflictos no escriben', t => {
  const { sqlite, repo } = preparar(t);
  assert.equal(typeof repo.guardarCuentaInterna, 'function');
  repo.guardarCuentaInterna(datos(true));
  assert.equal(sqlite.prepare('SELECT usuario_id FROM sicar_internas').get().usuario_id, 7);
  assert.throws(() => repo.guardarCuentaInterna(datos(true)), { status: 409 });
  assert.equal(sqlite.prepare('SELECT count(*) n FROM sicar_internas_historial').get().n, 1);
  repo.guardarCuentaInterna(datos(false));
  assert.equal(sqlite.prepare('SELECT count(*) n FROM sicar_internas').get().n, 0);
  assert.throws(() => repo.guardarCuentaInterna(datos(false)), { status: 409 });
  const historia = sqlite.prepare('SELECT accion, motivo, usuario_id FROM sicar_internas_historial ORDER BY id').all();
  assert.deepEqual(historia, ['marcar', 'desmarcar'].map(accion => ({ accion, motivo: 'Cuenta de tienda', usuario_id: 7 })));
});

test('fallo al escribir historial revierte la marca SICAR', t => {
  const { sqlite, repo } = preparar(t);
  assert.equal(typeof repo.guardarCuentaInterna, 'function');
  sqlite.exec(`CREATE TRIGGER fallo BEFORE INSERT ON sicar_internas_historial BEGIN SELECT RAISE(ABORT, 'fallo historial'); END;`);
  assert.throws(() => repo.guardarCuentaInterna(datos(true)), /fallo historial/);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM sicar_internas').get().n, 0);
});

for (const generacion of [10, 12, 14]) {
  test(`restaura respaldo de ${generacion} tablas y sustituye marcas e historial`, async t => {
    const { sqlite, repo } = preparar(t, true);
    assert.equal(respaldo.TABLAS.length, 16);
    const archivos = new Map();
    const drive = {
      asegurarCarpetaRespaldos: async () => 'carpeta',
      subirArchivoADrive: async (_, { contenidoBuffer }) => {
        const id = String(archivos.size + 1);
        archivos.set(id, contenidoBuffer);
        return { id };
      },
      descargarArchivoDeDriveLimitado: async (_, id) => archivos.get(id),
      eliminarArchivoDeDrive: async (_, id) => archivos.delete(id),
    };
    const contexto = { DB: {}, llave: Buffer.alloc(32, 7) };
    respaldo.configurarContexto(repo, contexto);
    if (generacion === 14) repo.guardarCuentaInterna(datos(true));
    const foto = await respaldo.crearSnapshotSicar(repo, drive, contexto);
    for (const tabla of respaldo.TABLAS.slice(generacion)) delete foto.conteos[tabla];
    foto.trozos = foto.trozos.filter(trozo => Object.hasOwn(foto.conteos, trozo.tabla));
    if (generacion !== 14) repo.guardarCuentaInterna(datos(true));
    else repo.guardarCuentaInterna(datos(false));
    const preparado = await respaldo.prepararRestauracionSicar(repo, drive, foto);
    try { preparado.aplicar(); } finally { preparado.liberar(); }
    assert.equal(sqlite.prepare('SELECT count(*) n FROM sicar_internas').get().n, generacion === 14 ? 1 : 0);
    assert.equal(sqlite.prepare('SELECT count(*) n FROM sicar_internas_historial').get().n, generacion === 14 ? 1 : 0);
    assert.equal(sqlite.prepare('SELECT nombre FROM sicar_clientes').get().nombre, 'Tienda');
  });
}
