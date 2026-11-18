const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { crearRepositorioSicar } = require('../sicarRepositorio');
const { listar, ponerAjuste, quitarAjuste } = require('./consultas');
const AHORA = '2026-11-18T18:00:00Z';

function prepararDB(t) {
  const db = new Database(':memory:'); crearRepositorioSicar(db); t.after(() => db.close());
  for (const suc of [1, 3]) {
    db.prepare('INSERT INTO sicar_tiendas(sucursal_id) VALUES (?)').run(suc);
    db.prepare("INSERT INTO sicar_articulos VALUES (?, 'a','A','Cable',NULL,'SOLCOR',?)").run(suc, AHORA);
    db.prepare("INSERT INTO sicar_existencias VALUES (?, 'a',-30000,?)").run(suc, AHORA);
    db.prepare("INSERT INTO resurtido_minmax VALUES (?,'A','SOLCOR',20000,50000,3000,249,116,'calculado','aproximada',?)").run(suc, AHORA);
  }
  return db;
}
const ajuste = { sucursal_id: 3, clave: 'A', minimo: 4, maximo: 8, motivo: 'Exhibición' };

test('ajuste en piezas gana sobre cálculo y conserva quién, cuándo y por qué', t => {
  const db = prepararDB(t); ponerAjuste(db, ajuste, 'Victor', AHORA);
  const f = listar(db, { sucursal_id: 3 }, AHORA).filas[0];
  assert.equal(f?.minimo, 40000); assert.equal(f.maximo, 80000); assert.equal(f.minimo_calculado, 20000);
  assert.deepEqual(f.ajuste, { minimo: 40000, maximo: 80000, motivo: 'Exhibición', actor: 'Victor', fecha: AHORA });
  assert.equal(db.prepare('SELECT accion FROM resurtido_ajustes_historial').get().accion, 'poner');
});

test('quitar ajuste vuelve a calculado y guarda motivo en historial', t => {
  const db = prepararDB(t); ponerAjuste(db, ajuste, 'Victor', AHORA);
  quitarAjuste(db, { sucursal_id: 3, clave: 'A', motivo: 'Volver al cálculo' }, 'Ana', AHORA);
  const f = listar(db, { sucursal_id: 3 }, AHORA).filas[0];
  assert.equal(f?.minimo, 20000); assert.equal(f.ajuste, null);
  assert.deepEqual(db.prepare('SELECT accion,actor FROM resurtido_ajustes_historial ORDER BY id').all(), [
    { accion: 'poner', actor: 'Victor' }, { accion: 'quitar', actor: 'Ana' },
  ]);
});

test('validación rechaza máximo menor, motivo vacío, fracciones, infinitos y claves desconocidas', t => {
  const db = prepararDB(t);
  for (const cambio of [{ maximo: 3 }, { motivo: '' }, { minimo: -1 }, { minimo: 1.5 }, { maximo: Infinity },
    { maximo: Number.MAX_SAFE_INTEGER }, { minimo: '4' }, { sucursal_id: 7 }]) {
    assert.throws(() => ponerAjuste(db, { ...ajuste, ...cambio }, 'Victor', AHORA), { status: 400 });
  }
  assert.throws(() => ponerAjuste(db, { ...ajuste, clave: 'NO' }, 'Victor', AHORA), { status: 404 });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM resurtido_ajustes').get().n, 0);
});

test('ajuste sobre clave que cambió de marca sigue visible con advertencia', t => {
  const db = prepararDB(t); ponerAjuste(db, ajuste, 'Victor', AHORA);
  db.exec("UPDATE sicar_articulos SET departamento='STEREN' WHERE sucursal_id=3");
  const f = listar(db, { sucursal_id: 3 }, AHORA).filas[0];
  assert.equal(f?.ya_no_es_marca, true); assert.equal(f.minimo, 40000);
});

test('existencia negativa es agotado y lista no filtra ni expone otra tienda', t => {
  const db = prepararDB(t), r = listar(db, { sucursal_id: 3, estado: 'agotado', q: 'Cable' }, AHORA);
  assert.equal(r.total, 1); assert.equal(r.filas[0].existencia, -30000); assert.equal(r.filas[0].estado, 'agotado');
  assert.equal(r.filas[0].venta_mes, 90000); assert.equal(r.filas[0].calidad, 'aproximada');
  assert.equal(r.calculado_en, AHORA);
  db.exec("UPDATE sicar_existencias SET actualizado_en='2026-11-01' WHERE sucursal_id=1");
  assert.deepEqual(listar(db, { sucursal_id: 3 }, AHORA).tiendas_atrasadas, []);
  assert.ok(listar(db, {}, AHORA).tiendas_atrasadas.includes(1));
});

test('paginación de cien y filtros marca/lista/estado', t => {
  const db = prepararDB(t);
  for (let i = 0; i < 101; i++) {
    db.prepare("INSERT INTO sicar_articulos VALUES (3,?,?, 'Púa',NULL,'JR',?)").run(`b${i}`, `B${i}`, AHORA);
    db.prepare("INSERT INTO resurtido_minmax VALUES (3,?,'JR',10000,20000,0,0,365,'sin_historia','aproximada',?)").run(`B${i}`, AHORA);
  }
  const filtros = { sucursal_id: 3, marca: 'JR', lista: 'sin_historia', estado: 'agotado' };
  const r = listar(db, filtros, AHORA), siguiente = listar(db, { ...filtros, pagina: 2 }, AHORA);
  assert.equal(r.total, 101); assert.equal(r.filas.length, 100); assert.equal(siguiente.filas.length, 1);
  assert.equal(new Set([...r.filas, ...siguiente.filas].map(f => f.clave)).size, 101);
});
