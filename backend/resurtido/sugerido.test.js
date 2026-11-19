const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { crearRepositorioSicar } = require('../sicarRepositorio');
const { enCamino, calcularSugerido } = require('./sugerido');
const { listar, listaProveedor, ponerAjuste } = require('./consultas');
const { explicar } = require('./explicacion');
const AHORA = '2026-11-19T18:00:00Z';

function prepararDB(t) {
  const db = new Database(':memory:'); crearRepositorioSicar(db); t.after(() => db.close());
  for (const suc of [1, 3, 6]) {
    db.prepare('INSERT INTO sicar_sucursales_mapa(sicar_sucursal,sucursal_id) VALUES (?,?)').run(String(suc), suc);
  }
  for (const suc of [1, 3]) {
    db.prepare('INSERT INTO sicar_tiendas(sucursal_id) VALUES (?)').run(suc);
    db.prepare("INSERT INTO sicar_articulos VALUES (?, 'a','A','Cuerda 1a',NULL,'JR',?)").run(suc, AHORA);
    db.prepare("INSERT INTO sicar_existencias VALUES (?, 'a',50000,?)").run(suc, AHORA);
    db.prepare("INSERT INTO resurtido_minmax VALUES (?,'A','JR',100000,200000,3000,300,0,'calculado','aproximada',?)").run(suc, AHORA);
  }
  return db;
}
let folio = 0;
function traspaso(db, { suc = 3, destino = '3', estado = 'enviado', fecha = '2026-11-09', cantidad = '8.0000' } = {}) {
  const id = `t${++folio}`;
  db.prepare(`INSERT INTO sicar_traspasos VALUES (?, ?, ?, '6', ?, ?, ?, NULL, NULL, 0, ?)`)
    .run(suc, id, `F${folio}`, destino, fecha, estado, AHORA);
  db.prepare("INSERT INTO sicar_traspasos_detalle VALUES (?, ?, 'a', ?, 0, 0)").run(suc, id, cantidad);
}

test('en camino: solo enviados hacia la tienda en los últimos 45 días; los viejos aparte', t => {
  const db = prepararDB(t);
  traspaso(db);
  traspaso(db, { estado: 'recibido' });
  traspaso(db, { estado: 'cancelado' });
  traspaso(db, { fecha: '2026-09-20', cantidad: '3.0000' });
  traspaso(db, { destino: '1' });
  const r = enCamino(db, 3, AHORA);
  assert.equal(r.porClave.get('A'), 80000);
  assert.equal(r.viejo.get('A'), 30000);
  assert.equal(enCamino(db, 1, AHORA).porClave.get('A'), 80000);
});

test('en camino: el mismo traspaso visto por dos agentes cuenta una vez', t => {
  const db = prepararDB(t);
  traspaso(db, { suc: 3 });
  folio--; traspaso(db, { suc: 1 });
  assert.equal(enCamino(db, 3, AHORA).porClave.get('A'), 80000);
});

test('fórmula del sugerido: máximo menos lo que hay menos lo que viene, en piezas enteras', () => {
  const fila = { lista: 'calculado', maximo: 200000, existencia: 50000, ajuste: null };
  assert.equal(calcularSugerido(fila, 80000, false), 70000);
  assert.equal(calcularSugerido({ ...fila, existencia: 250000 }, 0, false), 0);
  assert.equal(calcularSugerido({ ...fila, existencia: -30000 }, 0, false), 200000);
  assert.equal(calcularSugerido({ ...fila, maximo: 205000 }, 0, false), 160000);
  assert.equal(calcularSugerido({ ...fila, maximo: 300000, ajuste: { maximo: 300000 } }, 0, false), 250000);
  assert.equal(calcularSugerido({ ...fila, lista: 'sin_movimiento', maximo: 0, existencia: 0 }, 0, false), 0);
  assert.equal(calcularSugerido({ ...fila, lista: 'no_se_mueve', maximo: 0, existencia: 0 }, 0, false), 0);
  const conAjuste = { ...fila, lista: 'sin_movimiento', maximo: 20000, existencia: 0, ajuste: { maximo: 20000 } };
  assert.equal(calcularSugerido(conAjuste, 0, false), 20000);
  assert.equal(calcularSugerido({ ...fila, ya_no_la_maneja: true, ajuste: { maximo: 200000 } }, 0, false), 0);
  assert.equal(calcularSugerido({ ...fila, ya_no_es_marca: true, ajuste: { maximo: 200000 } }, 0, false), 0);
  assert.equal(calcularSugerido(fila, 0, true), null);
});

test('la lista trae en camino y sugerido; tienda atrasada no sugiere', t => {
  const db = prepararDB(t);
  traspaso(db);
  const f = listar(db, { sucursal_id: 3 }, AHORA).filas[0];
  assert.deepEqual([f.en_camino, f.sugerido], [80000, 70000]);
  db.exec("UPDATE sicar_existencias SET actualizado_en='2026-11-01T00:00:00Z' WHERE sucursal_id=3");
  assert.equal(listar(db, { sucursal_id: 3 }, AHORA).filas[0].sugerido, null);
});

test('lista para el proveedor suma tiendas, respeta el alcance y valida la marca', t => {
  const db = prepararDB(t);
  traspaso(db);
  const todas = listaProveedor(db, { marca: 'JR' }, AHORA);
  assert.equal(todas.renglones.length, 1);
  const r = todas.renglones[0];
  assert.equal(r.total, 220000);
  assert.deepEqual(r.por_tienda, [{ sucursal_id: 1, sugerido: 150000 }, { sucursal_id: 3, sugerido: 70000 }]);
  const propia = listaProveedor(db, { marca: 'JR', sucursal_id: 3 }, AHORA);
  assert.deepEqual(propia.renglones[0].por_tienda, [{ sucursal_id: 3, sugerido: 70000 }]);
  assert.equal(listaProveedor(db, { marca: 'SOLCOR' }, AHORA).renglones.length, 0);
  assert.throws(() => listaProveedor(db, { marca: 'OTRA' }, AHORA), { status: 400 });
  assert.throws(() => listaProveedor(db, {}, AHORA), { status: 400 });
});

test('lista para el proveedor omite lo que ya llega a su máximo y lo que no se pide', t => {
  const db = prepararDB(t);
  db.exec('UPDATE sicar_existencias SET existencia_diezmilesimas=200000 WHERE sucursal_id=1');
  db.exec("UPDATE resurtido_minmax SET lista='sin_movimiento',minimo=0,maximo=0 WHERE sucursal_id=3");
  db.exec('UPDATE sicar_existencias SET existencia_diezmilesimas=0 WHERE sucursal_id=3');
  assert.equal(listaProveedor(db, { marca: 'JR' }, AHORA).renglones.length, 0);
  ponerAjuste(db, { sucursal_id: 3, clave: 'A', minimo: 1, maximo: 2, motivo: 'Exhibición' }, '1', AHORA);
  assert.equal(listaProveedor(db, { marca: 'JR' }, AHORA).renglones[0].total, 20000);
});

test('la explicación dice cuánto pedir y por qué', t => {
  const db = prepararDB(t);
  traspaso(db);
  traspaso(db, { fecha: '2026-09-20', cantidad: '3.0000' });
  const e = explicar(db, 3, 'A', AHORA);
  assert.deepEqual([e.en_camino, e.en_camino_viejo, e.sugerido, e.lista], [8, 3, 7, 'calculado']);
});
