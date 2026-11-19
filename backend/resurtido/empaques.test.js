const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { crearRepositorioSicar } = require('../sicarRepositorio');
const { listarEmpaques, confirmarEmpaque, quitarEmpaque } = require('./empaques');
const AHORA = '2026-11-19T18:00:00Z';

function prepararDB(t) {
  const db = new Database(':memory:'); crearRepositorioSicar(db); t.after(() => db.close());
  for (const suc of [1, 3]) {
    db.prepare('INSERT INTO sicar_tiendas(sucursal_id) VALUES (?)').run(suc);
    db.prepare("INSERT INTO sicar_articulos VALUES (?, 'c','C1',' cable uso rudo 2x14',NULL,'SOLCOR',?)").run(suc, AHORA);
    db.prepare("INSERT INTO sicar_articulos VALUES (?, 'k','K1','CLAVIJA',NULL,' solcor ',?)").run(suc, AHORA);
    db.prepare("INSERT INTO sicar_articulos VALUES (?, 'j','J1','CABLE JR',NULL,'JR',?)").run(suc, AHORA);
  }
  return db;
}

test('empaques: todas las claves Solcor; las de cable traen sugerencia de rollo de 100 sin confirmar', t => {
  const db = prepararDB(t);
  const r = listarEmpaques(db);
  assert.deepEqual(r.claves.map(e => [e.clave, e.sugerido, e.confirmado]), [['C1', 1000000, null], ['K1', null, null]]);
});

test('confirmar, cambiar y quitar empaque deja quién y cuándo, con historial', t => {
  const db = prepararDB(t);
  confirmarEmpaque(db, { clave: 'C1', piezas: 100 }, '9', AHORA);
  confirmarEmpaque(db, { clave: 'C1', piezas: 200 }, '8', AHORA);
  const c = listarEmpaques(db).claves.find(e => e.clave === 'C1');
  assert.deepEqual(c.confirmado, { tamano: 2000000, por: '8', en: AHORA });
  quitarEmpaque(db, { clave: 'C1' }, '7', AHORA);
  assert.equal(listarEmpaques(db).claves.find(e => e.clave === 'C1').confirmado, null);
  assert.deepEqual(db.prepare('SELECT clave, accion, anterior, nuevo, actor FROM resurtido_empaques_historial ORDER BY id').all(), [
    { clave: 'C1', accion: 'confirmar', anterior: null, nuevo: 1000000, actor: '9' },
    { clave: 'C1', accion: 'confirmar', anterior: 1000000, nuevo: 2000000, actor: '8' },
    { clave: 'C1', accion: 'quitar', anterior: 2000000, nuevo: null, actor: '7' },
  ]);
  assert.throws(() => quitarEmpaque(db, { clave: 'C1' }, '7', AHORA), { status: 404 });
});

test('empaque inválido o de clave que no es Solcor se rechaza', t => {
  const db = prepararDB(t);
  for (const datos of [{ clave: 'C1', piezas: 1 }, { clave: 'C1', piezas: 0 }, { clave: 'C1', piezas: 2.5 }, { clave: 'C1', piezas: '100' },
    { clave: 'C1' }, null]) {
    assert.throws(() => confirmarEmpaque(db, datos, '9', AHORA), { status: 400 });
  }
  assert.throws(() => confirmarEmpaque(db, { clave: 'J1', piezas: 100 }, '9', AHORA), { status: 404 });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM resurtido_empaques').get().n, 0);
});
