const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { crearRepositorioSicar } = require('../sicarRepositorio');

test('base anterior acepta sin movimiento tras migrar, conserva filas y no agrega tablas permanentes', t => {
  const db = new Database(':memory:'); t.after(() => db.close()); crearRepositorioSicar(db);
  const esquema = db.prepare("SELECT sql FROM sqlite_master WHERE name='resurtido_minmax'").get().sql;
  db.exec('DROP TABLE resurtido_minmax');
  db.exec(esquema.replace(",'sin_movimiento'", ''));
  db.exec("INSERT INTO resurtido_minmax VALUES (3,'A','JR',10000,20000,0,0,365,'sin_historia','aproximada','ayer')");
  const tablas = () => db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
  const antes = tablas(), filas = db.prepare('SELECT * FROM resurtido_minmax').all();
  crearRepositorioSicar(db); crearRepositorioSicar(db);
  assert.deepEqual(db.prepare('SELECT * FROM resurtido_minmax').all(), filas);
  assert.deepEqual(tablas(), antes);
  db.exec("UPDATE resurtido_minmax SET lista='sin_movimiento',minimo=0,maximo=0");
  assert.throws(() => db.exec("UPDATE resurtido_minmax SET lista='inventada'"), /CHECK/);
  assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
});
