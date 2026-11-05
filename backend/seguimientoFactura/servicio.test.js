const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { crearRepositorioSicar } = require('../sicarRepositorio');

const CORTE = '2026-09-01T18:00:00.000Z';
const RECIENTE = '2026-11-08T18:00:00.000Z';
// La compra es del 2026-09-20; el 2026-11-09 (hora de México) cumple 50 días.
const DIA_50 = '2026-11-09T18:00:00.000Z';
const DIA_61 = '2026-11-20T18:00:00.000Z';

function prepararDB(t, { incorporadas = [1, 6] } = {}) {
  const db = new Database(':memory:');
  const repo = crearRepositorioSicar(db);
  t.after(() => db.close());
  for (const suc of [1, 6]) {
    db.prepare('INSERT INTO sicar_tiendas(sucursal_id, ultima_recepcion) VALUES (?, ?)').run(suc, RECIENTE);
    db.prepare(`INSERT INTO sicar_articulos(sucursal_id, art_id, clave, descripcion, actualizado_en)
      VALUES (?, ?, 'A', 'Artículo', ?)`).run(suc, `art-${suc}`, RECIENTE);
    db.prepare('INSERT INTO sicar_sucursales_mapa(sicar_sucursal, sucursal_id) VALUES (?, ?)').run(`s${suc}`, suc);
    if (incorporadas.includes(suc)) db.prepare('INSERT INTO seguimiento_tiendas(sucursal_id, corte) VALUES (?, ?)').run(suc, CORTE);
  }
  return { db, repo };
}

function compra(db, id, { cantidad = '10.0000', precio = 1000n, fecha = '2026-09-20T10:00:00' } = {}) {
  db.prepare(`INSERT INTO sicar_compras
    (sucursal_id, com_id, fecha, pro_id, folio, comentario, estado, total_centavos, primera_vez, actualizado_en)
    VALUES (6, ?, ?, '1', ?, '', 'vigente', 0, ?, ?)`).run(id, fecha, id, RECIENTE, RECIENTE);
  db.prepare('INSERT INTO sicar_compras_detalle VALUES (6, ?, 0, ?, ?, 10000, ?, 0, 0)').run(id, 'art-6', cantidad, precio);
}

function ventaCedis(db, id, cantidad) {
  db.prepare('INSERT INTO sicar_ventas_mostrador VALUES (6, ?, ?, ?, 100, ?)').run(id, '2026-10-01T10:00:00', 'vigente', RECIENTE);
  db.prepare('INSERT INTO sicar_detalles_mostrador VALUES (6, ?, 0, ?, ?, 100, 0)').run(id, 'art-6', cantidad);
}

const servicio = () => require('./servicio');
const pendientes = db => db.prepare('SELECT clave FROM seguimiento_pendientes ORDER BY clave').all().map(f => f.clave);
const avisos = db => db.prepare('SELECT com_id, etapa, estado FROM seguimiento_avisos ORDER BY id').all()
  .map(a => ({ ...a }));
const historial = db => db.prepare(`SELECT a.etapa, h.estado, h.motivo FROM seguimiento_avisos_historial h
  JOIN seguimiento_avisos a ON a.id=h.aviso_id ORDER BY h.id`).all().map(h => ({ ...h }));
const resultado = db => db.prepare('SELECT com_id, renglon, clave, datos_json FROM seguimiento_resultado ORDER BY com_id')
  .all().map(r => ({ ...r, datos: JSON.parse(r.datos_json) }));

function procesar(db, ahora = DIA_50) {
  return servicio().procesarPendientes(db, { limite: 50, ahora });
}

function loteVenta(sequence, extra = {}) {
  return { schema_version: 1, mapping_version: 'ocosingo-f0-v1', batch_id: `lote-${sequence}`, sequence, clientes: [],
    ventas: [], mostrador: [{ ven_id: `v${sequence}`, fecha_local: '2026-10-12T16:30:00', estado: 'vigente', total: '50.00',
      detalle: [{ art_id: 'art-1', cantidad: '1.0000', importe_con: '50.00', descuento_total: '0.00' }] }], ...extra };
}

test('un lote del agente con una venta marca su clave pendiente en la misma transacción', t => {
  const { db, repo } = prepararDB(t);
  repo.aplicarLote({ sucursalId: 1, lote: loteVenta('1'), hash: 'h1' });
  assert.deepEqual(pendientes(db), ['A']);
});

test('sin tiendas incorporadas no se marca nada', t => {
  const { db, repo } = prepararDB(t, { incorporadas: [] });
  repo.aplicarLote({ sucursalId: 1, lote: loteVenta('1'), hash: 'h1' });
  assert.deepEqual(pendientes(db), []);
});

test('un artículo que cambia de clave marca la clave vieja y la nueva', t => {
  const { db, repo } = prepararDB(t);
  const lote = loteVenta('1', { mostrador: [], articulos: [{ art_id: 'art-1', clave: 'B', descripcion: 'Artículo' }] });
  repo.aplicarLote({ sucursalId: 1, lote, hash: 'h1' });
  assert.deepEqual(pendientes(db), ['A', 'B']);
});

test('procesar calcula la factura, crea su aviso y vacía pendientes; dos veces no duplica', t => {
  const { db } = prepararDB(t);
  compra(db, 'C1');
  ventaCedis(db, 'v1', '4.0000');
  servicio().marcarPendientes(db, 6, ['art-6'], DIA_50);
  assert.deepEqual(procesar(db), { procesadas: 1, errores: [], quedan: 0 });
  const [fila] = resultado(db);
  assert.equal(fila.clave, 'A');
  assert.equal(fila.datos.vendido, '40000');
  assert.equal(fila.datos.queda, '60000');
  assert.equal(fila.datos.fecha_compra, '2026-09-20');
  assert.deepEqual(avisos(db), [{ com_id: 'C1', etapa: 'traslado', estado: 'nuevo' }]);
  assert.deepEqual(pendientes(db), []);
  servicio().marcarPendientes(db, 6, ['art-6'], DIA_50);
  procesar(db);
  assert.equal(resultado(db).length, 1);
  assert.deepEqual(avisos(db), [{ com_id: 'C1', etapa: 'traslado', estado: 'nuevo' }]);
  assert.deepEqual(historial(db), [{ etapa: 'traslado', estado: 'nuevo', motivo: null }]);
});

test('al cambiar de etapa se retira el aviso anterior y nace el nuevo', t => {
  const { db } = prepararDB(t);
  compra(db, 'C1');
  servicio().marcarPendientes(db, 6, ['art-6'], DIA_50);
  procesar(db, DIA_50);
  servicio().marcarPendientes(db, 6, ['art-6'], DIA_61);
  procesar(db, DIA_61);
  assert.deepEqual(avisos(db), [{ com_id: 'C1', etapa: 'traslado', estado: 'retirado' },
    { com_id: 'C1', etapa: 'margen_75', estado: 'nuevo' }]);
  assert.deepEqual(historial(db).at(-2), { etapa: 'traslado', estado: 'retirado', motivo: 'cambio_de_etapa' });
});

test('compra cancelada borra sus resultados y retira su aviso', t => {
  const { db } = prepararDB(t);
  compra(db, 'C1');
  servicio().marcarPendientes(db, 6, ['art-6'], DIA_50);
  procesar(db);
  db.exec("UPDATE sicar_compras SET estado='cancelada' WHERE com_id='C1'");
  servicio().marcarPendientes(db, 6, ['art-6'], DIA_50);
  procesar(db);
  assert.deepEqual(resultado(db), []);
  assert.deepEqual(avisos(db), [{ com_id: 'C1', etapa: 'traslado', estado: 'retirado' }]);
  assert.equal(historial(db).at(-1).motivo, 'sin_resultado');
});

test('factura agotada retira su aviso; nada lo limpia salvo ventas reales', t => {
  const { db } = prepararDB(t);
  compra(db, 'C1');
  servicio().marcarPendientes(db, 6, ['art-6'], DIA_50);
  procesar(db);
  ventaCedis(db, 'v1', '10.0000');
  servicio().marcarPendientes(db, 6, ['art-6'], DIA_50);
  procesar(db);
  assert.deepEqual(avisos(db), [{ com_id: 'C1', etapa: 'traslado', estado: 'retirado' }]);
  assert.equal(historial(db).at(-1).motivo, 'agotada');
});

test('posposición vencida vuelve a nuevo con historial; la vigente se respeta', t => {
  const { db } = prepararDB(t);
  db.exec(`INSERT INTO seguimiento_avisos(id, sucursal_id, com_id, etapa, estado, pospuesto_hasta) VALUES
    (1, 6, 'C1', 'traslado', 'pospuesto', '2026-11-09'), (2, 6, 'C2', 'traslado', 'pospuesto', '2026-11-10')`);
  servicio().vencerPosposiciones(db, DIA_50);
  assert.deepEqual(avisos(db).map(a => a.estado), ['nuevo', 'pospuesto']);
  assert.deepEqual(historial(db), [{ etapa: 'traslado', estado: 'nuevo', motivo: 'posposicion_vencida' }]);
});

test('un error a la mitad no deja la factura a medias y la clave sigue pendiente', t => {
  const { db } = prepararDB(t);
  compra(db, 'C1');
  compra(db, 'C2', { fecha: '2026-09-21T10:00:00' });
  servicio().marcarPendientes(db, 6, ['art-6'], DIA_50);
  procesar(db);
  const antes = resultado(db);
  ventaCedis(db, 'v1', '3.0000');
  db.exec(`CREATE TRIGGER falla BEFORE INSERT ON seguimiento_resultado WHEN NEW.com_id='C2'
    BEGIN SELECT RAISE(ABORT, 'falla de prueba'); END`);
  servicio().marcarPendientes(db, 6, ['art-6'], DIA_50);
  const r = procesar(db);
  assert.equal(r.procesadas, 0);
  assert.deepEqual(r.errores.map(e => e.clave), ['A']);
  assert.deepEqual(resultado(db), antes);
  assert.deepEqual(pendientes(db), ['A']);
  db.exec('DROP TRIGGER falla');
  procesar(db);
  assert.equal(resultado(db).find(f => f.com_id === 'C1').datos.vendido, '30000');
});

test('vuelta completa marca las claves de compras vigentes de CEDIS y las que ya tienen resultado', t => {
  const { db } = prepararDB(t);
  compra(db, 'C1');
  db.prepare(`INSERT INTO seguimiento_resultado VALUES (6, 'VIEJA', 0, 'Z', '{}', 1, ?)`).run(RECIENTE);
  servicio().vueltaCompleta(db, DIA_50);
  assert.deepEqual(pendientes(db), ['A', 'Z']);
});

test('existencias solas no marcan pendientes: el cálculo no las usa y llegan todas cada noche', t => {
  const { db, repo } = prepararDB(t);
  repo.aplicarLote({ sucursalId: 1, lote: loteVenta('1', { mostrador: [], existencias: [{ art_id: 'art-1', existencia: '5.0000' }] }), hash: 'h1' });
  assert.deepEqual(pendientes(db), []);
});

test('vuelta completa no marca claves de compras anteriores al corte de CEDIS', t => {
  const { db } = prepararDB(t);
  compra(db, 'VIEJA', { fecha: '2026-08-01T10:00:00' }); // antes del corte (2026-09-01)
  servicio().vueltaCompleta(db, DIA_50);
  assert.deepEqual(pendientes(db), []);
  compra(db, 'NUEVA');
  servicio().vueltaCompleta(db, DIA_50);
  assert.deepEqual(pendientes(db), ['A']);
});

test('presupuesto de tiempo: procesa al menos una clave, se detiene y dice cuántas quedan', t => {
  const { db } = prepararDB(t);
  for (const clave of ['B', 'C', 'D']) db.prepare('INSERT INTO seguimiento_pendientes VALUES (?, ?)').run(clave, DIA_50);
  const r = servicio().procesarPendientes(db, { limite: 50, ahora: DIA_50, presupuestoMs: 0 });
  assert.deepEqual(r, { procesadas: 1, errores: [], quedan: 2 });
  assert.deepEqual(procesar(db), { procesadas: 2, errores: [], quedan: 0 });
});

test('ciclos: la vuelta diaria corre una vez por día y deja todo procesado sin encimarse', t => {
  const { db } = prepararDB(t);
  compra(db, 'C1', { fecha: `${require('../fechas').fechaLocal()}T00:00:01` });
  const ciclos = require('./rutas').iniciarCiclosSeguimiento(() => db, { tramoMs: 200, pausaMs: 10 });
  ciclos.revisarDia();
  assert.deepEqual(pendientes(db), []);
  assert.equal(resultado(db).length, 1);
  db.prepare("INSERT INTO seguimiento_pendientes VALUES ('Z', 'x')").run();
  ciclos.revisarDia(); // mismo día: no repite la vuelta ni procesa
  assert.deepEqual(pendientes(db), ['Z']);
});
