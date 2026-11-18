const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { crearRepositorioSicar } = require('../sicarRepositorio');
const { fechaLocal } = require('../fechas');
const { tomarFoto, reconstruir, diasEnCero } = require('./existenciaDiaria');
const AHORA = '2026-11-18T18:00:00Z';

function prepararDB(t) {
  const db = new Database(':memory:'); const repo = crearRepositorioSicar(db); t.after(() => db.close());
  for (const suc of [3, 6, 7]) {
    db.prepare('INSERT INTO sicar_tiendas(sucursal_id) VALUES (?)').run(suc);
    db.prepare("INSERT INTO sicar_articulos VALUES (?, 'a', 'A', 'Cable', NULL, 'SOLCOR', ?)").run(suc, AHORA);
    db.prepare("INSERT INTO sicar_existencias VALUES (?, 'a', 50000, ?)").run(suc, AHORA);
    db.prepare('INSERT INTO sicar_sucursales_mapa(sicar_sucursal,sucursal_id) VALUES (?,?)').run(String(suc), suc);
  }
  return { db, repo };
}
const foto = db => db.prepare('SELECT * FROM resurtido_existencia_diaria WHERE sucursal_id=3 AND clave=? AND dia=?');
function lote(repo, secuencia, existencia) {
  return repo.aplicarLote({ sucursalId: 3, hash: `hash-${secuencia}`, lote: {
    batch_id: `lote-${secuencia}`, sequence: String(secuencia), mapping_version: 'v1', clientes: [], ventas: [],
    existencias: [{ art_id: 'a', existencia }],
  } });
}
function traspaso(db, suc, cantidad = '10.0000') {
  db.prepare(`INSERT INTO sicar_traspasos VALUES (?, 't', 'F1', '6', '3', '2026-11-16', 'aplicado',
    '2026-11-16', NULL, 0, ?)`).run(suc, AHORA);
  db.prepare("INSERT INTO sicar_traspasos_detalle VALUES (?, 't', 'a', ?, 0, 0)").run(suc, cantidad);
}

test('foto registra negativos, excluye CEDIS/Innotec y días en cero los incluye', t => {
  const { db } = prepararDB(t); db.exec('UPDATE sicar_existencias SET existencia_diezmilesimas=-30000');
  assert.equal(tomarFoto(db, '2026-11-18', AHORA).filas, 1);
  assert.equal(foto(db).get('A', '2026-11-18').piezas_diezmilesimas, -30000);
  assert.deepEqual([...diasEnCero(db, 3, 'A', '2026-11-01', '2026-11-18')], ['2026-11-18']);
});

test('foto repetida conserva mínimo del día y no duplica filas', t => {
  const { db } = prepararDB(t);
  tomarFoto(db, '2026-11-18', AHORA);
  db.exec('UPDATE sicar_existencias SET existencia_diezmilesimas=0'); tomarFoto(db, '2026-11-18', AHORA);
  db.exec('UPDATE sicar_existencias SET existencia_diezmilesimas=80000'); tomarFoto(db, '2026-11-18', AHORA);
  assert.equal(foto(db).get('A', '2026-11-18')?.piezas_diezmilesimas, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM resurtido_existencia_diaria').get().n, 1);
});

test('ingesta 5 → 0 → 8 conserva agotamiento local, existencia actual queda 8', t => {
  const { db, repo } = prepararDB(t); lote(repo, 1, '0.0000'); lote(repo, 2, '8.0000');
  assert.equal(foto(db).get('A', fechaLocal())?.piezas_diezmilesimas, 0);
  assert.equal(db.prepare('SELECT existencia_diezmilesimas n FROM sicar_existencias WHERE sucursal_id=3').get().n, 80000);
});

test('ingesta suma art_id de una clave antes de observar y reemplaza origen aproximado', t => {
  const { db, repo } = prepararDB(t);
  db.prepare("INSERT INTO sicar_articulos VALUES (3, 'b', 'A', 'Cable', NULL, 'SOLCOR', ?)").run(AHORA);
  db.prepare("INSERT INTO sicar_existencias VALUES (3, 'b', 20000, ?)").run(AHORA);
  db.prepare("INSERT INTO resurtido_existencia_diaria VALUES (3,'A',?,0,'reconstruida')").run(fechaLocal());
  lote(repo, 1, '0.0000');
  assert.equal(foto(db).get('A', fechaLocal())?.piezas_diezmilesimas, 20000);
  assert.equal(foto(db).get('A', fechaLocal()).origen, 'foto');
});

test('fallo al observar se registra y no deshace la ingesta', t => {
  const { db, repo } = prepararDB(t); const avisos = [];
  t.mock.method(console, 'warn', (...args) => avisos.push(args.join(' ')));
  db.exec(`CREATE TRIGGER falla_observacion BEFORE INSERT ON resurtido_existencia_diaria
    BEGIN SELECT RAISE(ABORT, 'fallo deliberado'); END`);
  lote(repo, 1, '0.0000');
  assert.equal(db.prepare('SELECT existencia_diezmilesimas n FROM sicar_existencias WHERE sucursal_id=3').get().n, 0);
  assert.ok(avisos.some(a => a.includes('fallo deliberado')));
});

test('reconstrucción 5 + venta 3 - entrada 10, deduplicada, sin pisar foto', t => {
  const { db } = prepararDB(t);
  db.exec(`INSERT INTO sicar_ventas_mostrador VALUES (3,'v','2026-11-17T12:00:00','vigente',0,'hoy');
    INSERT INTO sicar_detalles_mostrador VALUES (3,'v',0,'a','3.0000',0,0);
    INSERT INTO resurtido_existencia_diaria VALUES (3,'A','2026-11-14',90000,'foto')`);
  traspaso(db, 3); traspaso(db, 6);
  const r = reconstruir(db, 3, '2026-11-14', '2026-11-17');
  assert.equal(r.filas, 3); assert.equal(r.rara, 0);
  assert.deepEqual(db.prepare('SELECT dia,piezas_diezmilesimas FROM resurtido_existencia_diaria ORDER BY dia').all(), [
    { dia: '2026-11-14', piezas_diezmilesimas: 90000 }, { dia: '2026-11-15', piezas_diezmilesimas: 0 },
    { dia: '2026-11-16', piezas_diezmilesimas: 0 }, { dia: '2026-11-17', piezas_diezmilesimas: 80000 },
  ]);
});

test('reconstrucción cuenta una clave rara solo bajo -2, aunque varios días sean negativos', t => {
  const { db } = prepararDB(t); traspaso(db, 3, '11.0000');
  const r = reconstruir(db, 3, '2026-11-14', '2026-11-17');
  assert.equal(r.rara, 1);
  assert.equal(foto(db).get('A', '2026-11-15').piezas_diezmilesimas, 0);
});
