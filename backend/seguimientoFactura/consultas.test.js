const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { crearRepositorioSicar } = require('../sicarRepositorio');
const { transitoHacia } = require('./consultas');

const AL = '2026-11-05T18:00:00.000Z';

function prepararDB(t) {
  const db = new Database(':memory:');
  crearRepositorioSicar(db);
  t.after(() => db.close());
  for (const suc of [1, 6]) {
    db.prepare('INSERT INTO sicar_tiendas(sucursal_id, ultima_recepcion) VALUES (?, ?)').run(suc, AL);
    db.prepare(`INSERT INTO sicar_articulos(sucursal_id, art_id, clave, descripcion, actualizado_en)
      VALUES (?, ?, 'A', 'Artículo', ?)`).run(suc, `art-${suc}`, AL);
    db.prepare('INSERT INTO sicar_sucursales_mapa(sicar_sucursal, sucursal_id) VALUES (?, ?)').run(`s${suc}`, suc);
  }
  return db;
}

function punta(db, suc, folio, estado, cantidad = '5.0000') {
  db.prepare('INSERT INTO sicar_traspasos VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, ?)')
    .run(suc, `${folio}-${suc}`, folio, 's6', 's1', '2026-11-01', estado, AL);
  db.prepare('INSERT INTO sicar_traspasos_detalle VALUES (?, ?, ?, ?, 0, 0)').run(suc, `${folio}-${suc}`, `art-${suc}`, cantidad);
}

test('en tránsito: solo lo enviado por el origen que el destino aún no recibe ni cancela', t => {
  const db = prepararDB(t);
  punta(db, 6, 'RECIBIDO', 'enviado');  // el SICAR de CEDIS lo sigue viendo enviado...
  punta(db, 1, 'RECIBIDO', 'recibido'); // ...pero Ocosingo ya lo recibió: no está en camino
  punta(db, 6, 'CANCELADO', 'enviado');
  punta(db, 1, 'CANCELADO', 'cancelado');
  punta(db, 6, 'EN_CAMINO', 'enviado', '3.0000'); // sin recepción todavía: sí está en camino
  punta(db, 6, 'ANULADO', 'cancelado');
  assert.deepEqual(transitoHacia(db, 'A'), { 1: 30000n });
});
