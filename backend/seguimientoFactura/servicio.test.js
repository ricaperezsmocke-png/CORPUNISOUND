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

const fechaRevision = '2026-11-13T18:00:00.000Z';
const despues = dias => new Date(Date.parse(fechaRevision) + dias * 86400000).toISOString();

function avisoRevisable(db, etapa = 'liquidar', queda = '90071992547409930000', transito = '7') {
  db.prepare(`INSERT INTO seguimiento_resultado VALUES (6, 'REV', 0, 'REV', ?, 2, ?)`)
    .run(JSON.stringify({ queda, transito, fecha_compra: '2026-01-01' }), fechaRevision);
  return db.prepare(`INSERT INTO seguimiento_avisos(sucursal_id, com_id, etapa, estado)
    VALUES (6, 'REV', ?, 'nuevo')`).run(etapa).lastInsertRowid;
}

function revisar(db, id) {
  return require('./rutas').gestionarAviso(db, String(id), { estado: 'revisado', motivo: 'Verificado' }, '9', fechaRevision);
}

test('revisar guarda queda más tránsito exactos y fecha; migración de avisos es idempotente', t => {
  const { db } = prepararDB(t);
  const id = avisoRevisable(db);
  const aviso = revisar(db, id);
  assert.equal(aviso.saldo_revision, '90071992547409930007');
  assert.equal(aviso.fecha_revision, fechaRevision);
  crearRepositorioSicar(db);
  assert.deepEqual(db.prepare('SELECT * FROM seguimiento_avisos WHERE id=?').get(id), aviso);
});

for (const etapa of ['traslado', 'margen_75', 'margen_50', 'liquidar']) {
  test(`revisado en ${etapa}: día 14 sigue; día 15 vuelve con motivo y actor sistema`, t => {
    const { db } = prepararDB(t);
    const id = avisoRevisable(db, etapa);
    revisar(db, id);
    servicio().vencerPosposiciones(db, despues(14));
    assert.equal(db.prepare('SELECT estado FROM seguimiento_avisos').get().estado, 'revisado');
    servicio().vencerPosposiciones(db, despues(15));
    assert.equal(db.prepare('SELECT estado FROM seguimiento_avisos').get().estado, 'nuevo');
    const h = db.prepare('SELECT estado, motivo, actor, fecha FROM seguimiento_avisos_historial ORDER BY id DESC').get();
    assert.deepEqual({ ...h }, { estado: 'nuevo', motivo: 'sin_movimiento_desde_revision', actor: 'sistema', fecha: despues(15) });
    servicio().vencerPosposiciones(db, despues(16));
    assert.equal(db.prepare('SELECT count(*) n FROM seguimiento_avisos_historial').get().n, 2);
  });
}

test('saldo menor renueva referencia y plazo; 15 días después sin movimiento vuelve', t => {
  const { db } = prepararDB(t);
  revisar(db, avisoRevisable(db));
  db.prepare('UPDATE seguimiento_resultado SET datos_json=?')
    .run(JSON.stringify({ queda: '90071992547409930000', transito: '6' }));
  servicio().vencerPosposiciones(db, despues(15));
  const aviso = db.prepare('SELECT * FROM seguimiento_avisos').get();
  assert.equal(aviso.estado, 'revisado');
  assert.equal(aviso.saldo_revision, '90071992547409930006');
  assert.equal(aviso.fecha_revision, despues(15));
  servicio().vencerPosposiciones(db, despues(29));
  assert.equal(db.prepare('SELECT estado FROM seguimiento_avisos').get().estado, 'revisado');
  servicio().vencerPosposiciones(db, despues(30));
  assert.equal(db.prepare('SELECT estado FROM seguimiento_avisos').get().estado, 'nuevo');
});

test('revisado antiguo inicia en primera evaluación, sin usar los 60 días del historial', t => {
  const { db } = prepararDB(t);
  const id = avisoRevisable(db);
  db.exec("UPDATE seguimiento_avisos SET estado='revisado'");
  db.prepare(`INSERT INTO seguimiento_avisos_historial(aviso_id, estado, motivo, actor, fecha)
    VALUES (?, 'revisado', 'Visto', '9', ?)`).run(id, despues(-60));
  servicio().vencerPosposiciones(db, fechaRevision);
  const aviso = db.prepare('SELECT * FROM seguimiento_avisos').get();
  assert.equal(aviso.estado, 'revisado');
  assert.equal(aviso.fecha_revision, fechaRevision);
  assert.equal(aviso.saldo_revision, '90071992547409930007');
  servicio().vencerPosposiciones(db, despues(1));
  servicio().vencerPosposiciones(db, despues(14));
  assert.equal(db.prepare('SELECT estado FROM seguimiento_avisos').get().estado, 'revisado');
  servicio().vencerPosposiciones(db, despues(15));
  assert.equal(db.prepare('SELECT estado FROM seguimiento_avisos').get().estado, 'nuevo');
});

test('caducidad configurable y saldo mayor también reabre', t => {
  const { db } = prepararDB(t);
  revisar(db, avisoRevisable(db));
  db.exec("INSERT INTO seguimiento_config(clave, valor) VALUES ('dias_revisado_caduca', '10')");
  db.prepare('UPDATE seguimiento_resultado SET datos_json=?').run(JSON.stringify({ queda: '90071992547409930008', transito: '0' }));
  servicio().vencerPosposiciones(db, despues(9));
  assert.equal(db.prepare('SELECT estado FROM seguimiento_avisos').get().estado, 'revisado');
  servicio().vencerPosposiciones(db, despues(10));
  assert.equal(db.prepare('SELECT estado FROM seguimiento_avisos').get().estado, 'nuevo');
});

test('migración agrega columnas a una tabla de avisos anterior sin perder filas', t => {
  const db = new Database(':memory:');
  t.after(() => db.close());
  db.exec(`CREATE TABLE seguimiento_avisos (id INTEGER PRIMARY KEY, sucursal_id INTEGER, com_id TEXT,
    etapa TEXT, estado TEXT, pospuesto_hasta TEXT, UNIQUE(sucursal_id, com_id, etapa));
    INSERT INTO seguimiento_avisos VALUES (1, 6, 'ANT', 'liquidar', 'revisado', NULL)`);
  crearRepositorioSicar(db);
  crearRepositorioSicar(db);
  const aviso = db.prepare('SELECT * FROM seguimiento_avisos').get();
  assert.equal(aviso.saldo_revision, null);
  assert.equal(aviso.fecha_revision, null);
  assert.equal(aviso.estado, 'revisado');
});
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

test('al vencer, procesar usa la venta pendiente antes de comparar el saldo revisado', t => {
  const { db } = prepararDB(t);
  compra(db, 'C1');
  const inicio = '2027-01-20T18:00:00.000Z', fin = '2027-02-04T18:00:00.000Z';
  servicio().marcarPendientes(db, 6, ['art-6'], inicio);
  procesar(db, inicio);
  const id = db.prepare('SELECT id FROM seguimiento_avisos').get().id;
  require('./rutas').gestionarAviso(db, id, { estado: 'revisado', motivo: 'Verificado' }, '9', inicio);
  ventaCedis(db, 'v1', '1.0000');
  servicio().marcarPendientes(db, 6, ['art-6'], fin);
  assert.equal(procesar(db, fin).errores.length, 0);
  const aviso = db.prepare('SELECT * FROM seguimiento_avisos').get();
  assert.equal(aviso.estado, 'revisado');
  assert.equal(aviso.saldo_revision, '90000');
  assert.equal(aviso.fecha_revision, fin);
  assert.equal(db.prepare("SELECT count(*) n FROM seguimiento_avisos_historial WHERE motivo='sin_movimiento_desde_revision'").get().n, 0);
});

test('un recálculo fallido no reabre con saldo viejo; al recuperarse renueva la referencia', t => {
  const { db } = prepararDB(t);
  compra(db, 'C1');
  const inicio = '2027-01-20T18:00:00.000Z', fin = '2027-02-04T18:00:00.000Z';
  servicio().marcarPendientes(db, 6, ['art-6'], inicio);
  procesar(db, inicio);
  const id = db.prepare('SELECT id FROM seguimiento_avisos').get().id;
  require('./rutas').gestionarAviso(db, id, { estado: 'revisado', motivo: 'Verificado' }, '9', inicio);
  ventaCedis(db, 'v1', '1.0000');
  servicio().marcarPendientes(db, 6, ['art-6'], fin);
  db.exec(`CREATE TRIGGER falla_revision BEFORE INSERT ON seguimiento_resultado
    BEGIN SELECT RAISE(ABORT, 'fallo de prueba'); END`);
  assert.equal(procesar(db, fin).errores.length, 1);
  assert.equal(db.prepare('SELECT estado FROM seguimiento_avisos').get().estado, 'revisado');
  db.exec('DROP TRIGGER falla_revision');
  assert.equal(procesar(db, fin).errores.length, 0);
  const aviso = db.prepare('SELECT * FROM seguimiento_avisos').get();
  assert.equal(aviso.estado, 'revisado');
  assert.equal(aviso.saldo_revision, '90000');
  assert.equal(aviso.fecha_revision, fin);
});

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

// Rescate: CEDIS arranca 2026-11-06 00:05 y Yajalón (2) entra 2026-11-11 12:40 (hora de México).
const RESCATE_AHORA = '2026-11-12T18:00:00.000Z';

function prepararRescate(t, fotoY) {
  const db = new Database(':memory:');
  crearRepositorioSicar(db);
  t.after(() => db.close());
  for (const suc of [2, 6]) {
    db.prepare('INSERT INTO sicar_tiendas(sucursal_id, ultima_recepcion) VALUES (?, ?)').run(suc, RESCATE_AHORA);
    db.prepare(`INSERT INTO sicar_articulos(sucursal_id, art_id, clave, descripcion, actualizado_en)
      VALUES (?, ?, 'A', 'Artículo', ?)`).run(suc, `art-${suc}`, RECIENTE);
    db.prepare('INSERT INTO sicar_sucursales_mapa(sicar_sucursal, sucursal_id) VALUES (?, ?)').run(`s${suc}`, suc);
  }
  db.prepare('INSERT INTO seguimiento_tiendas(sucursal_id, corte) VALUES (6, ?), (2, ?)').run('2026-11-06T06:05:00.000Z', '2026-11-11T18:40:00.000Z');
  db.prepare("INSERT INTO seguimiento_foto VALUES (6, 'A', '0'), (2, 'A', ?)").run(String(fotoY * 10000));
  // Mostrador de otra clave después del corte de Yajalón: su carga ya cubre la ventana.
  db.prepare(`INSERT INTO sicar_articulos(sucursal_id, art_id, clave, descripcion, actualizado_en)
    VALUES (2, 'otra', 'OTRA', 'Otra', ?)`).run(RECIENTE);
  ventaY(db, 'cubre', '2026-11-12T10:00:00', 1, 'otra');
  db.prepare(`INSERT INTO sicar_compras (sucursal_id, com_id, fecha, pro_id, folio, comentario, estado, total_centavos,
    primera_vez, actualizado_en) VALUES (6, 'C1', '2026-11-06T12:00:00', '1', 'C1', '', 'vigente', 0, ?, ?)`).run(RECIENTE, RECIENTE);
  db.prepare("INSERT INTO sicar_compras_detalle VALUES (6, 'C1', 0, 'art-6', '10.0000', 10000, 1000, 0, 0)").run();
  return db;
}

function ventaY(db, id, fecha, piezas, art = 'art-2') {
  db.prepare('INSERT INTO sicar_ventas_mostrador VALUES (2, ?, ?, ?, 100, ?)').run(id, fecha, 'vigente', RECIENTE);
  db.prepare('INSERT INTO sicar_detalles_mostrador VALUES (2, ?, 0, ?, ?, 100, 0)').run(id, art, `${piezas}.0000`);
}

function envioY(db, fecha, aplicada) {
  for (const [suc, estado, apl] of [[6, 'enviado', null], [2, 'recibido', aplicada]]) {
    db.prepare("INSERT INTO sicar_traspasos VALUES (?, ?, 'FY', 's6', 's2', ?, ?, ?, NULL, 0, ?)").run(suc, `t${suc}`, fecha, estado, apl, RECIENTE);
    db.prepare("INSERT INTO sicar_traspasos_detalle VALUES (?, ?, ?, '10.0000', 0, 0)").run(suc, `t${suc}`, `art-${suc}`);
  }
}

function procesarRescate(db) {
  db.prepare("INSERT INTO seguimiento_pendientes VALUES ('A', ?)").run(RESCATE_AHORA);
  return servicio().procesarPendientes(db, { limite: 50, ahora: RESCATE_AHORA });
}

test('rescate: la clave rescatable guarda el resultado reconstruido con su marca y versión 3', t => {
  const db = prepararRescate(t, 9);
  envioY(db, '2026-11-06', '2026-11-06T13:00:00');
  ventaY(db, 'v1', '2026-11-08T11:00:00', 3);
  assert.deepEqual(procesarRescate(db), { procesadas: 1, errores: [], quedan: 0 });
  const [fila] = resultado(db);
  // Foto reconstruida 2 = 9 − 10 + 3: la venta se lleva primero esas 2 anteriores y 1 de la factura.
  assert.deepEqual(fila.datos.por_sucursal, { 2: { queda: '90000', vendido: '10000' } });
  assert.equal(fila.datos.sin_agente, '0');
  assert.deepEqual(fila.datos.rescate, { desde: '2026-11-06T00:05:00.000', tiendas: [2] });
  assert.ok(!fila.datos.calidad.problemas.some(p => p.motivo === 'rescate_inconsistente'));
  assert.equal(servicio().VERSION, 3);
  assert.equal(db.prepare('SELECT version FROM seguimiento_resultado').get().version, 3);
});

test('rescate: si el control no cuadra se guarda el resultado de hoy y el problema rescate_inconsistente', t => {
  const db = prepararRescate(t, 9);
  ventaY(db, 'v1', '2026-11-07T11:00:00', 3); // vende 3 con solo 2 en existencia: la historia de la ventana no cierra
  envioY(db, '2026-11-08', '2026-11-08T13:00:00');
  const { movimientosPorClave } = require('./lector');
  const hoy = require('./motor').calcular(movimientosPorClave(db, 'A', { ahora: RESCATE_AHORA }).movimientos);
  procesarRescate(db);
  const [fila] = resultado(db);
  assert.equal(fila.datos.rescate, undefined);
  const [lote] = hoy.lotes;
  for (const campo of ['vendido', 'queda', 'transito', 'sin_agente', 'por_aclarar']) assert.equal(fila.datos[campo], lote[campo], campo);
  assert.deepEqual(fila.datos.por_sucursal, lote.por_sucursal);
  assert.deepEqual(fila.datos.dinero, lote.dinero);
  assert.equal(fila.datos.sin_agente, '100000', 'como hoy: lo enviado a Yajalón antes de su foto sigue gris');
  assert.deepEqual(fila.datos.calidad.problemas.filter(p => p.motivo === 'rescate_inconsistente'),
    [{ clave: 'A', motivo: 'rescate_inconsistente', detalle: [{ sucursal_id: 2, motivo: 'control_no_cuadra' }] }]);
});

test('rescate: si el lector no puede rescatar se guarda el resultado de hoy con el motivo', t => {
  const db = prepararRescate(t, 5); // 5 − 10 + 3 < 0: la foto reconstruida sería negativa
  envioY(db, '2026-11-06', '2026-11-06T13:00:00');
  ventaY(db, 'v1', '2026-11-08T11:00:00', 3);
  procesarRescate(db);
  const [fila] = resultado(db);
  assert.equal(fila.datos.rescate, undefined);
  assert.equal(fila.datos.sin_agente, '100000');
  assert.deepEqual(fila.datos.calidad.problemas.filter(p => p.motivo === 'rescate_inconsistente'),
    [{ clave: 'A', motivo: 'rescate_inconsistente', detalle: [{ sucursal_id: 2, motivo: 'foto_negativa' }] }]);
});
