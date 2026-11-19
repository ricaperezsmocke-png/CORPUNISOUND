const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { crearRepositorioSicar } = require('../sicarRepositorio');
const { revisarAvisos, decidirAviso, listarAvisos } = require('./avisos');
const { listaProveedor } = require('./consultas');
const pedido = require('./pedido');
const AHORA = '2026-11-19T18:00:00Z';

// Clave A (JR): mínimo 5 y máximo 10 en las tres tiendas. Ocosingo tiene 12 (2 de sobra); Yajalón y San Cristóbal, 0.
function prepararDB(t) {
  const db = new Database(':memory:'); crearRepositorioSicar(db); t.after(() => db.close());
  for (const suc of [1, 2, 3, 6]) {
    db.prepare('INSERT INTO sicar_sucursales_mapa(sicar_sucursal,sucursal_id) VALUES (?,?)').run(String(suc), suc);
  }
  for (const [suc, existencia] of [[1, 120000], [2, 0], [3, 0]]) {
    db.prepare('INSERT INTO sicar_tiendas(sucursal_id) VALUES (?)').run(suc);
    db.prepare("INSERT INTO sicar_articulos VALUES (?, 'a','A','Cuerda 1a',NULL,'JR',?)").run(suc, AHORA);
    db.prepare("INSERT INTO sicar_existencias VALUES (?, 'a',?,?)").run(suc, existencia, AHORA);
    db.prepare("INSERT INTO resurtido_minmax VALUES (?,'A','JR',50000,100000,?,300,0,'calculado','aproximada',?)").run(suc, suc * 1000, AHORA);
  }
  return db;
}
const aviso = (db, suc) => db.prepare("SELECT * FROM resurtido_avisos WHERE sucursal_id=? AND clave='A' ORDER BY id DESC").get(suc);
const propuesta = (db, suc, suc_alcance = suc, ahora = AHORA) =>
  listarAvisos(db, suc_alcance, ahora).avisos.find(a => a.sucursal_id === suc && a.estado === 'abierto')?.propuesta;

test('donante con 12 y máximo 10 ofrece 2, no más; la receptora solo ve nombre, clave y piezas', t => {
  const db = prepararDB(t);
  revisarAvisos(db, AHORA);
  assert.equal(aviso(db, 1), undefined);
  const p = propuesta(db, 3);
  assert.deepEqual(p, { falta: 50000, pasar: [{ sucursal_id: 1, nombre: 'Ocosingo', clave: 'A', piezas: 20000 }], pedir: 100000 });
});

test('ninguna donante sobre su máximo: solo pedir', t => {
  const db = prepararDB(t);
  db.exec('UPDATE sicar_existencias SET existencia_diezmilesimas=100000 WHERE sucursal_id=1');
  revisarAvisos(db, AHORA);
  assert.deepEqual(propuesta(db, 3).pasar, []);
  assert.throws(() => decidirAviso(db, aviso(db, 3).id, { decision: 'pasar' }, '33', 3, AHORA), { status: 409 });
});

test('dos receptoras no reservan las mismas piezas; la reserva vencida las libera', t => {
  const db = prepararDB(t);
  revisarAvisos(db, AHORA);
  const r = decidirAviso(db, aviso(db, 2).id, { decision: 'pasar' }, '22', 2, AHORA);
  assert.deepEqual(r.pasar, [{ sucursal_id: 1, nombre: 'Ocosingo', clave: 'A', piezas: 20000 }]);
  assert.match(r.mensaje, /revisa la existencia en SICAR/);
  assert.deepEqual(db.prepare('SELECT donante, receptora, piezas, estado, vence FROM resurtido_reservas').all(),
    [{ donante: 1, receptora: 2, piezas: 20000, estado: 'viva', vence: '2026-11-22T18:00:00.000Z' }]);
  assert.deepEqual(propuesta(db, 3).pasar, []);
  assert.throws(() => decidirAviso(db, aviso(db, 3).id, { decision: 'pasar' }, '33', 3, AHORA), { status: 409 });
  assert.throws(() => decidirAviso(db, aviso(db, 2).id, { decision: 'pasar' }, '22', 2, AHORA), { status: 409 });
  const despues = '2026-11-23T08:00:00Z';
  db.exec(`UPDATE sicar_existencias SET actualizado_en='${despues}'`);
  revisarAvisos(db, despues);
  assert.equal(db.prepare('SELECT estado FROM resurtido_reservas').get().estado, 'vencida');
  assert.deepEqual(propuesta(db, 3, 3, despues).pasar.map(x => x.piezas), [20000]);
});

test('la reserva se consume cuando aparece el traspaso de la donante a la receptora en SICAR', t => {
  const db = prepararDB(t);
  revisarAvisos(db, AHORA);
  decidirAviso(db, aviso(db, 2).id, { decision: 'pasar' }, '22', 2, AHORA);
  db.exec(`INSERT INTO sicar_traspasos VALUES (1,'t1','F1','1','2','2026-11-20 10:00:00','enviado',NULL,NULL,0,'hoy');
    INSERT INTO sicar_traspasos_detalle VALUES (1,'t1','a','2.0000',0,0)`);
  revisarAvisos(db, '2026-11-20T18:00:00Z');
  assert.equal(db.prepare('SELECT estado FROM resurtido_reservas').get().estado, 'consumida');
});

test('aviso se cierra solo al llegar la existencia y no se abren dos para la misma tienda y clave', t => {
  const db = prepararDB(t);
  revisarAvisos(db, AHORA); revisarAvisos(db, AHORA);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM resurtido_avisos WHERE sucursal_id=3").get().n, 1);
  db.exec('UPDATE sicar_existencias SET existencia_diezmilesimas=50000 WHERE sucursal_id=3');
  revisarAvisos(db, AHORA);
  assert.deepEqual([aviso(db, 3).estado, aviso(db, 3).cerrado_en], ['resuelto', AHORA]);
  assert.equal(aviso(db, 2).estado, 'abierto');
});

test('pedir extra arma un pedido corto con el mismo visto bueno; dos clics no lo duplican', t => {
  const db = prepararDB(t);
  revisarAvisos(db, AHORA);
  const id = aviso(db, 3).id;
  const r = decidirAviso(db, id, { decision: 'pedir', motivo: 'Temporada de escuelas' }, '33', 3, AHORA);
  assert.throws(() => decidirAviso(db, id, { decision: 'pedir' }, '33', 3, AHORA), { status: 409 });
  const p = db.prepare('SELECT * FROM resurtido_pedidos').all();
  assert.equal(p.length, 1);
  assert.deepEqual([p[0].tipo, p[0].estado, p[0].llave, p[0].aviso_id, r.pedido_id], ['extra', 'borrador', `JR:2026-11:extra:${id}`, id, p[0].id]);
  assert.deepEqual(db.prepare('SELECT sucursal_id, clave, pedido FROM resurtido_pedido_renglones').all(), [{ sucursal_id: 3, clave: 'A', pedido: 100000 }]);
  pedido.vistoBuenoTienda(db, p[0].id, 3, [], '33', AHORA);
  assert.equal(pedido.aprobar(db, p[0].id, '9', AHORA).ok, true);
  assert.equal(aviso(db, 3).decision, 'pedir');
});

test('decidir un aviso de otra tienda da 403; decisión inválida da 400; esperar se puede cambiar después', t => {
  const db = prepararDB(t);
  revisarAvisos(db, AHORA);
  const id = aviso(db, 3).id;
  assert.throws(() => decidirAviso(db, id, { decision: 'esperar' }, '22', 2, AHORA), { status: 403 });
  assert.throws(() => decidirAviso(db, id, { decision: 'regalar' }, '33', 3, AHORA), { status: 400 });
  decidirAviso(db, id, { decision: 'esperar', motivo: 'Viene en el pedido del mes' }, '33', 3, AHORA);
  assert.deepEqual([aviso(db, 3).decision, aviso(db, 3).actor, aviso(db, 3).motivo], ['esperar', '33', 'Viene en el pedido del mes']);
  decidirAviso(db, id, { decision: 'pasar' }, '33', null, AHORA);
  assert.equal(aviso(db, 3).decision, 'pasar');
});

test('la donante ve lo que le apartaron para hacer el traspaso en SICAR', t => {
  const db = prepararDB(t);
  revisarAvisos(db, AHORA);
  decidirAviso(db, aviso(db, 3).id, { decision: 'pasar' }, '33', 3, AHORA);
  assert.deepEqual(listarAvisos(db, 1, AHORA).apartados.map(a => [a.receptora, a.nombre_receptora, a.clave, a.piezas]),
    [[3, 'San Cristóbal', 'A', 20000]]);
  assert.deepEqual(listarAvisos(db, 2, AHORA).apartados, []);
  assert.deepEqual(listarAvisos(db, 2, AHORA).avisos.map(a => a.sucursal_id), [2]);
});

test('"tiene de sobra" aparece en la lista para el proveedor solo con donante arriba de su máximo', t => {
  const db = prepararDB(t);
  assert.deepEqual(listaProveedor(db, { marca: 'JR', sucursal_id: 3 }, AHORA).renglones[0].sobra, [{ sucursal_id: 1, piezas: 20000 }]);
  db.exec('UPDATE sicar_existencias SET existencia_diezmilesimas=100000 WHERE sucursal_id=1');
  assert.deepEqual(listaProveedor(db, { marca: 'JR' }, AHORA).renglones[0].sobra, []);
});

test('el borrador del pedido también avisa la sobra de otra tienda, sin cambiar números', t => {
  const db = prepararDB(t);
  const { pedido_id } = pedido.armarBorrador(db, 'JR', AHORA);
  const d = pedido.verPedido(db, pedido_id, 3, AHORA);
  assert.deepEqual([d.renglones[0].pedido, d.renglones[0].sobra], [100000, [{ sucursal_id: 1, piezas: 20000 }]]);
});

test('el ciclo diario revisa los avisos', t => {
  const db = prepararDB(t);
  require('./servicio').tareasDiarias(db, AHORA);
  assert.equal(aviso(db, 3).estado, 'abierto');
});

test('si lo apartado venció sin traspaso, la tienda puede volver a decidir', t => {
  const db = prepararDB(t);
  revisarAvisos(db, AHORA);
  const id = aviso(db, 3).id;
  decidirAviso(db, id, { decision: 'pasar' }, '33', 3, AHORA);
  const despues = '2026-11-23T08:00:00Z';
  db.exec(`UPDATE sicar_existencias SET actualizado_en='${despues}'`);
  revisarAvisos(db, despues);
  assert.equal(decidirAviso(db, id, { decision: 'pedir' }, '33', 3, despues).decision, 'pedir');
});
