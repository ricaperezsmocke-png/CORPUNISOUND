const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { crearRepositorioSicar } = require('../sicarRepositorio');
const { clavesDeMarca, ventasDiarias, existenciaActual, ventasMensualesMarca } = require('./lector');

function prepararDB(t) {
  const db = new Database(':memory:'); crearRepositorioSicar(db); t.after(() => db.close());
  for (const suc of [1, 2, 3, 4, 6, 7]) {
    db.prepare('INSERT INTO sicar_tiendas(sucursal_id) VALUES (?)').run(suc);
    db.prepare("INSERT INTO sicar_clientes(sucursal_id, cli_id, nombre) VALUES (?, 'cliente', 'Cliente')").run(suc);
    for (const [id, clave, marca] of [['a', 'A', ' JR '], ['b', 'A', 'JR'], ['c', 'C', 'solcor'],
      ['d', 'D', 'STEREN'], ['e', '', 'JR'], ['f', null, 'JR']]) {
      db.prepare('INSERT INTO sicar_articulos VALUES (?, ?, ?, ?, NULL, ?, ?)').run(suc, id, clave, 'Artículo', marca, '2026-11-18T10:00:00Z');
      db.prepare('INSERT INTO sicar_existencias VALUES (?, ?, ?, ?)').run(suc, id, id === 'a' ? 10000 : 20000, '2026-11-18T10:00:00Z');
    }
  }
  return db;
}

function venta(db, id, art, cantidad, { suc = 3, fecha = '2026-11-17T10:00:00', estado = 'vigente', mostrador = false } = {}) {
  if (mostrador) {
    db.prepare('INSERT INTO sicar_ventas_mostrador VALUES (?, ?, ?, ?, 100, ?)').run(suc, id, fecha, estado, fecha);
    db.prepare('INSERT INTO sicar_detalles_mostrador VALUES (?, ?, 0, ?, ?, 100, 0)').run(suc, id, art, cantidad);
  } else {
    db.prepare(`INSERT INTO sicar_ventas(sucursal_id, ven_id, cli_id, fecha_local, estado, total_centavos, revision, hash)
      VALUES (?, ?, 'cliente', ?, ?, 100, '1', 'hash')`).run(suc, id, fecha, estado);
    db.prepare(`INSERT INTO sicar_detalles VALUES (?, ?, ?, 0, NULL, 'Artículo', ?, '100.0000', '100.0000', 100, 0)`)
      .run(suc, id, art, cantidad);
  }
}

test('catálogo agrupa ids por clave, normaliza departamento y cuenta claves omitidas', t => {
  const r = clavesDeMarca(prepararDB(t), 3);
  assert.deepEqual([...r.keys()], ['A', 'C']);
  assert.deepEqual(r.get('A').art_ids, ['a', 'b']);
  assert.equal(r.get('C').marca, 'SOLCOR');
  assert.equal(r.omitidas, 2);
});

test('dos art_id suman existencia; frescura viene de existencias', t => {
  const r = existenciaActual(prepararDB(t), 3);
  assert.equal(r.porClave.get('A'), 30000);
  assert.equal(r.actualizado, '2026-11-18T10:00:00Z');
});

test('cliente y mostrador se suman por día y clave con cuatro decimales', t => {
  const db = prepararDB(t);
  venta(db, '1', 'a', '2.5000'); venta(db, '2', 'b', '1.0000', { mostrador: true });
  assert.equal(ventasDiarias(db, 3, '2026-01-01').get('A')?.get('2026-11-17'), 35000);
});

test('cancelación posterior desaparece en la siguiente lectura', t => {
  const db = prepararDB(t); venta(db, '1', 'a', '1.0000');
  assert.equal(ventasDiarias(db, 3, '2026-01-01').get('A')?.get('2026-11-17'), 10000);
  db.exec("UPDATE sicar_ventas SET estado='cancelada'");
  assert.equal(ventasDiarias(db, 3, '2026-01-01').size, 0);
});

test('cuenta interna excluida conserva ventas de mostrador', t => {
  const db = prepararDB(t); venta(db, '1', 'a', '5.0000'); venta(db, '2', 'a', '2.0000', { mostrador: true });
  db.exec("INSERT INTO sicar_internas(sucursal_id, cli_id, motivo, usuario_id, fecha_hora) VALUES (3, 'cliente', 'Interna', '1', 'hoy')");
  assert.equal(ventasDiarias(db, 3, '2026-01-01').get('A')?.get('2026-11-17'), 20000);
});

test('mensuales devuelve datos por clave para temporada, suma tiendas y excluye CEDIS e Innotec', t => {
  const db = prepararDB(t);
  for (const suc of [1, 2, 6, 7]) venta(db, '1', 'a', '1.0000', { suc, fecha: '2025-01-15T12:00:00' });
  venta(db, '2', 'c', '9.0000', { suc: 1, fecha: '2025-01-15T12:00:00' });
  const r = ventasMensualesMarca(db, 'JR', [1, 2, 3, 4, 6, 7]);
  assert.equal(r.get('A')?.get('2025-01'), 20000);
  assert.equal(r.has('C'), false);
});

test('filtro desde excluye historia anterior y departamentos ajenos', t => {
  const db = prepararDB(t);
  venta(db, '1', 'a', '1.0000', { fecha: '2025-01-15T12:00:00' });
  venta(db, '2', 'a', '2.0000'); venta(db, '3', 'd', '3.0000');
  const r = ventasDiarias(db, 3, '2026-01-01');
  assert.equal(r.get('A')?.size, 1);
  assert.equal(r.get('A')?.get('2026-11-17'), 20000);
  assert.equal(r.has('D'), false);
});
