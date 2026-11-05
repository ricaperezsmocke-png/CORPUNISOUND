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

test('renglón de compra sin clave: la factura dice información insuficiente y no desaparece', t => {
  const { listar, detalle } = require('./consultas');
  const servicio = require('./servicio');
  const db = prepararDB(t);
  db.prepare('INSERT INTO seguimiento_tiendas(sucursal_id, corte) VALUES (6, ?)').run('2026-09-01T18:00:00.000Z');
  db.prepare(`INSERT INTO sicar_articulos(sucursal_id, art_id, clave, descripcion, actualizado_en)
    VALUES (6, 'sin-clave', NULL, 'Amplificador', ?)`).run(AL);
  const compra = (com_id, renglones) => {
    db.prepare(`INSERT INTO sicar_compras (sucursal_id, com_id, fecha, pro_id, folio, comentario, estado, total_centavos,
      primera_vez, actualizado_en) VALUES (6, ?, '2026-09-20T10:00:00', '1', ?, '', 'vigente', 0, ?, ?)`).run(com_id, `F${com_id}`, AL, AL);
    renglones.forEach(([art, precio], i) => db.prepare('INSERT INTO sicar_compras_detalle VALUES (6, ?, ?, ?, ?, 10000, ?, 0, 0)')
      .run(com_id, i, art, '1.0000', precio));
  };
  compra('1', [['art-6', 10000], ['sin-clave', 1000000]]); // $100 con clave + $10,000 sin clave
  compra('2', [['sin-clave', 500000]]); // toda sin clave
  compra('3', [['art-6', 20000]]); // completa
  servicio.marcarPendientes(db, 6, ['art-6'], AL);
  servicio.procesarPendientes(db, { ahora: AL });
  const lista = listar(db, {}, AL).facturas;
  const f = id => lista.find(x => x.com_id === id);
  assert.equal(f('1').renglones_sin_seguimiento, 1);
  assert.equal(f('1').dinero, null, 'no presenta $100 como si fuera toda la factura');
  assert.equal(f('2').renglones_sin_seguimiento, 1);
  assert.equal(f('2').dinero, null);
  assert.equal(f('3').renglones_sin_seguimiento, 0);
  assert.equal(f('3').dinero.queda, '20000');
  assert.equal(detalle(db, 6, '2', AL).factura.renglones_sin_seguimiento, 1);
});
