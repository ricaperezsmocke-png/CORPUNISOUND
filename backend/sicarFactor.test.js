const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { crearRepositorioSicar } = require('./sicarRepositorio');
const { crearSnapshotSicar, configurarContexto, prepararRestauracionSicar } = require('./sicarRespaldo');

function preparar(t) {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'sicar-factor-'));
  const sqlite = new Database(path.join(carpeta, 'prueba.sqlite'));
  sqlite.pragma('journal_mode = WAL');
  t.after(() => {
    sqlite.close();
    fs.rmSync(carpeta, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  return { sqlite, repo: crearRepositorioSicar(sqlite) };
}

function aplicar(repo, factores, sequence = '1') {
  const lote = { batch_id: `factor-${sequence}`, sequence, mapping_version: 'v1', clientes: [], ventas: [],
    compras: [{ com_id: '9007199254740993', fecha: '2026-11-05T12:00:00', pro_id: '7', folio: 'F-1',
      comentario: 'COMPRA CEDIS', estado: 'vigente', cancelada_en: null, total_con: '100.00',
      detalle: factores.map(factor => ({ art_id: '9', cantidad: '1.0000', precio_sin: '50.00',
        precio_con: '58.00', importe_con: '58.00', ...(factor === undefined ? {} : { factor }) })) }] };
  return repo.aplicarLote({ sucursalId: 6, lote, hash: `hash-${sequence}` });
}

const detalles = sqlite => sqlite.prepare('SELECT * FROM sicar_compras_detalle ORDER BY renglon').all();

test('guarda factores enteros y decimales por renglon sin duplicar el reenvio', t => {
  const { sqlite, repo } = preparar(t);
  const factores = ['36', '36.0000', '1.2345', '0.0001'];
  const recibo = aplicar(repo, factores);
  assert.deepEqual(detalles(sqlite).map(d => d.factor_diezmilesimas), [360000, 360000, 12345, 1]);
  const antes = detalles(sqlite);
  assert.deepEqual(aplicar(repo, factores), recibo);
  assert.deepEqual(detalles(sqlite), antes);
  aplicar(repo, ['12.5000'], '2');
  assert.deepEqual(detalles(sqlite).map(d => d.factor_diezmilesimas), [125000]);
});

test('sin factor guarda 10000 y declara INTEGER NOT NULL DEFAULT 10000', t => {
  const { sqlite, repo } = preparar(t);
  aplicar(repo, [undefined]);
  assert.equal(detalles(sqlite)[0].factor_diezmilesimas, 10000);
  const columna = sqlite.pragma('table_info(sicar_compras_detalle)').find(c => c.name === 'factor_diezmilesimas');
  assert.equal(columna.type, 'INTEGER');
  assert.equal(columna.notnull, 1);
  assert.equal(columna.dflt_value, '10000');
});

function quitarFactor(sqlite) {
  if (sqlite.pragma('table_info(sicar_compras_detalle)').some(c => c.name === 'factor_diezmilesimas')) {
    sqlite.exec('ALTER TABLE sicar_compras_detalle DROP COLUMN factor_diezmilesimas');
  }
}

test('migra base vieja sin perder compras ni detalle y permite repetir el arranque', t => {
  const { sqlite, repo } = preparar(t);
  aplicar(repo, [undefined, undefined]);
  quitarFactor(sqlite);
  const compras = sqlite.prepare('SELECT * FROM sicar_compras').all();
  const antes = detalles(sqlite);
  crearRepositorioSicar(sqlite);
  assert.deepEqual(detalles(sqlite), antes.map(d => ({ ...d, factor_diezmilesimas: 10000 })));
  crearRepositorioSicar(sqlite);
  assert.deepEqual(detalles(sqlite), antes.map(d => ({ ...d, factor_diezmilesimas: 10000 })));
  assert.deepEqual(sqlite.prepare('SELECT * FROM sicar_compras').all(), compras);
  assert.deepEqual(sqlite.pragma('foreign_key_check'), []);
});

for (const viejo of [true, false]) {
  test(`respaldo ${viejo ? 'viejo asigna 10000' : 'nuevo conserva el factor'}`, async t => {
    const origen = preparar(t), destino = preparar(t);
    aplicar(origen.repo, ['36.0000', '1.2345']);
    if (viejo) quitarFactor(origen.sqlite);
    const archivos = new Map();
    const drive = {
      asegurarCarpetaRespaldos: async () => 'carpeta',
      async subirArchivoADrive(_DB, { contenidoBuffer }) {
        const id = String(archivos.size);
        archivos.set(id, contenidoBuffer);
        return { id };
      },
      async descargarArchivoDeDriveLimitado(_DB, id, limite) {
        assert.ok(archivos.get(id).length <= limite);
        return archivos.get(id);
      },
      eliminarArchivoDeDrive: async (_DB, id) => archivos.delete(id),
    };
    const contexto = { DB: {}, llave: Buffer.alloc(32, 7) };
    const manifiesto = await crearSnapshotSicar(origen.repo, drive, contexto);
    configurarContexto(destino.repo, contexto);
    const restauracion = await prepararRestauracionSicar(destino.repo, drive, manifiesto);
    try { restauracion.aplicar(); } finally { restauracion.liberar(); }
    assert.deepEqual(detalles(destino.sqlite).map(d => d.factor_diezmilesimas), viejo ? [10000, 10000] : [360000, 12345]);
    const esperados = detalles(origen.sqlite).map(d => viejo ? { ...d, factor_diezmilesimas: 10000 } : d);
    assert.deepEqual(detalles(destino.sqlite), esperados);
    assert.deepEqual(destino.sqlite.prepare('SELECT * FROM sicar_compras').all(), origen.sqlite.prepare('SELECT * FROM sicar_compras').all());
    assert.deepEqual(destino.sqlite.pragma('foreign_key_check'), []);
  });
}
