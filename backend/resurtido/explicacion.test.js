const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { crearRepositorioSicar } = require('../sicarRepositorio');
const AHORA = '2026-11-18T18:00:00Z';
function prepararDB(t) {
  const db = new Database(':memory:'); crearRepositorioSicar(db); t.after(() => db.close());
  db.exec(`INSERT INTO sicar_tiendas(sucursal_id) VALUES (3);
    INSERT INTO sicar_articulos VALUES (3,'a','A','Cable',NULL,'JR','${AHORA}');
    INSERT INTO sicar_existencias VALUES (3,'a',50000,'${AHORA}');
    INSERT INTO resurtido_minmax VALUES (3,'A','JR',20000,60000,1234,363,2,'calculado','aproximada','${AHORA}');
    INSERT INTO resurtido_existencia_diaria VALUES (3,'A','2026-11-15',0,'foto'),(3,'A','2026-11-16',0,'reconstruida');
    INSERT INTO sicar_ventas_mostrador VALUES (3,'v','2026-11-17T12:00:00','vigente',0,'hoy');
    INSERT INTO sicar_detalles_mostrador VALUES (3,'v',0,'a','73',0,0)`);
  return db;
}

test('explicación en piezas separa venta simple, final y ceros observados de reconstruidos sin escribir', t => {
  const db = prepararDB(t), { explicar } = require('./explicacion');
  const antes = db.prepare('SELECT total_changes() n').get().n;
  const r = explicar(db, 3, 'A', AHORA);
  assert.equal(r.existencia, 5); assert.equal(r.piezas_vendidas, 73);
  assert.equal(r.venta_mensual_simple, 6); assert.equal(r.venta_diaria, 0.1);
  assert.equal(r.dias_en_cero, 2); assert.equal(r.ceros_observados, 1); assert.equal(r.ceros_reconstruidos, 1);
  assert.equal(r.dias_historia, 365); assert.equal(r.desde, '2025-11-18'); assert.equal(r.hasta, '2026-11-17');
  assert.deepEqual(r.indices, Array(12).fill(1)); assert.equal(r.factor, 1);
  assert.equal(r.minimo, 2); assert.equal(r.maximo, 6);
  assert.equal(db.prepare('SELECT total_changes() n').get().n, antes);
});

test('serie de doce meses separa compras/traspasos y reconstruye cierre antes de movimientos del mes siguiente', t => {
  const db = prepararDB(t), { explicar } = require('./explicacion');
  db.exec(`INSERT INTO sicar_sucursales_mapa(sicar_sucursal,sucursal_id) VALUES ('3',3);
    INSERT INTO sicar_traspasos VALUES (3,'t','F','99','3','2026-11-01','recibido','2026-11-01',NULL,0,'hoy');
    INSERT INTO sicar_traspasos_detalle VALUES (3,'t','a','80',0,0);
    INSERT INTO sicar_compras VALUES (3,'c','2026-10-10','p','F','','vigente',NULL,0,'hoy','hoy');
    INSERT INTO sicar_compras_detalle VALUES (3,'c',0,'a','2',30000,0,0,0)`);
  const r = explicar(db, 3, 'A', AHORA);
  assert.equal(r.serie_mensual.length, 12);
  assert.equal(r.serie_mensual[0].mes, '2025-12');
  const octubre = r.serie_mensual.find(m => m.mes === '2026-10'), noviembre = r.serie_mensual.at(-1);
  assert.equal(octubre.entradas_compra, 6); assert.equal(octubre.existencia_cierre, 0);
  assert.equal(noviembre.piezas_vendidas, 73); assert.equal(noviembre.entradas_traspaso, 80);
  assert.equal(noviembre.existencia_cierre, 5); assert.equal(noviembre.hasta, '2026-11-17');
});

test('explicación respeta corrección manual y rechaza tienda o clave ajenas', t => {
  const db = prepararDB(t), { explicar } = require('./explicacion');
  db.exec("INSERT INTO resurtido_ajustes VALUES (3,'A',40000,90000,'Exhibición','1','hoy')");
  const r = explicar(db, 3, 'A', AHORA);
  assert.equal(r.minimo, 4); assert.equal(r.maximo, 9); assert.equal(r.corregido, true);
  assert.throws(() => explicar(db, 7, 'A', AHORA), { status: 400 });
  assert.throws(() => explicar(db, 3, 'NO', AHORA), { status: 404 });
  assert.throws(() => explicar(db, 3, '', AHORA), { status: 400 });
});

test('sin cálculo no presenta mínimos ni venta final inventados', t => {
  const db = prepararDB(t), { explicar } = require('./explicacion');
  db.exec('DELETE FROM resurtido_minmax');
  const r = explicar(db, 3, 'A', AHORA);
  assert.equal(r.calculado_en, null); assert.equal(r.venta_diaria, null);
  assert.equal(r.minimo, null); assert.equal(r.maximo, null);
});
