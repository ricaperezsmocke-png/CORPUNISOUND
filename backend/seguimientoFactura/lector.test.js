const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { crearRepositorioSicar } = require('../sicarRepositorio');
const CORTE = '2026-11-04T18:30:25.500Z';
const AHORA = '2026-11-08T18:00:00.000Z';
const ACTUALIZADO = '2026-11-07T18:00:00.000Z';
const ID = '123456789012345678901234567890';

function prepararDB(t) {
  const db = new Database(':memory:');
  crearRepositorioSicar(db);
  t.after(() => db.close());
  for (const suc of [1, 2, 6]) {
    db.prepare('INSERT INTO sicar_tiendas(sucursal_id, ultima_recepcion) VALUES (?, ?)').run(suc, ACTUALIZADO);
    db.prepare(`INSERT INTO sicar_articulos(sucursal_id, art_id, clave, descripcion, actualizado_en)
      VALUES (?, ?, 'A', 'Artículo', ?)`).run(suc, `art-${suc}`, ACTUALIZADO);
    db.prepare('INSERT INTO sicar_sucursales_mapa(sicar_sucursal, sucursal_id) VALUES (?, ?)').run(`s${suc}`, suc);
    if (suc === 2) continue;
    db.prepare('INSERT INTO seguimiento_tiendas(sucursal_id, corte) VALUES (?, ?)').run(suc, CORTE);
    db.prepare('INSERT INTO seguimiento_foto VALUES (?, ?, ?)').run(suc, 'A', '100000');
  }
  return db;
}

function leer(db, clave = 'A') {
  return require('./lector').movimientosPorClave(db, clave, { ahora: AHORA });
}

function venta(db, id, { suc = 1, fecha = '2026-11-05T10:00:00', estado = 'vigente', interna = false, mostrador = false } = {}) {
  if (mostrador) {
    db.prepare('INSERT INTO sicar_ventas_mostrador VALUES (?, ?, ?, ?, 100, ?)').run(suc, id, fecha, estado, ACTUALIZADO);
    db.prepare('INSERT INTO sicar_detalles_mostrador VALUES (?, ?, 0, ?, ?, 100, 0)').run(suc, id, `art-${suc}`, '1.2500');
    return;
  }
  db.prepare('INSERT OR IGNORE INTO sicar_clientes(sucursal_id, cli_id, nombre) VALUES (?, ?, ?)').run(suc, id, 'Cliente');
  db.prepare(`INSERT INTO sicar_ventas(sucursal_id, ven_id, cli_id, fecha_local, estado, total_centavos, revision, hash)
    VALUES (?, ?, ?, ?, ?, 100, ?, ?)`).run(suc, id, id, fecha, estado, id, id);
  db.prepare(`INSERT INTO sicar_envios VALUES (?, ?, ?, ?, '{}', 1, 1, 0, ?, 'aceptado')`).run(suc, id, id, id, ACTUALIZADO);
  db.prepare(`INSERT INTO sicar_detalles VALUES (?, ?, ?, 0, 'CLAVE_VIEJA', 'Artículo', '1.2500', '1', '1', 100, 0)`)
    .run(suc, id, `art-${suc}`);
  if (interna) db.prepare('INSERT INTO sicar_internas VALUES (?, ?, ?, 1, ?)').run(suc, id, 'Interna', ACTUALIZADO);
}

function compra(db, id, { suc = 6, cantidad = '1.0000', factor = 360000n, precio = 1234n,
  fecha = '2026-11-05T23:00:00', estado = 'vigente' } = {}) {
  db.prepare(`INSERT INTO sicar_compras
    (sucursal_id, com_id, fecha, pro_id, folio, comentario, estado, total_centavos, primera_vez, actualizado_en)
    VALUES (?, ?, ?, '1', ?, '', ?, 1234, ?, ?)`).run(suc, id, fecha, id, estado, ACTUALIZADO, ACTUALIZADO);
  db.prepare('INSERT INTO sicar_compras_detalle VALUES (?, ?, 0, ?, ?, ?, ?, 1234, 1234)')
    .run(suc, id, `art-${suc}`, cantidad, factor, precio);
}

function punta(db, suc, id, { folio = 'F', origen = 's6', destino = 's1', fecha = '2026-11-05',
  estado = suc === 6 ? 'enviado' : 'recibido', aplicada = '2026-11-06', cantidad = '10.0000' } = {}) {
  db.prepare(`INSERT INTO sicar_traspasos VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?)`)
    .run(suc, id, folio, origen, destino, fecha, estado, aplicada, ACTUALIZADO);
  db.prepare('INSERT INTO sicar_traspasos_detalle VALUES (?, ?, ?, ?, 0, 0)').run(suc, id, `art-${suc}`, cantidad);
}

const traspasos = resultado => resultado.movimientos.filter(m => ['salida', 'recepcion'].includes(m.tipo));

test('corte local exacto por tienda, vigencia, internas y catálogo propio; foto conserva BigInt', t => {
  const db = prepararDB(t);
  for (const [id, fecha] of [['antes', '2026-11-04T12:30:24'], ['igual', '2026-11-04T12:30:25'], ['despues', '2026-11-04T12:30:26']]) {
    venta(db, id, { fecha });
  }
  venta(db, ID);
  venta(db, 'cancelada', { estado: 'cancelada' });
  venta(db, 'interna', { interna: true });
  venta(db, 'mostrador', { mostrador: true });
  venta(db, 'mostrador-cancelada', { mostrador: true, estado: 'cancelada' });
  venta(db, 'no-incorporada', { suc: 2 });
  db.prepare('UPDATE seguimiento_tiendas SET corte=? WHERE sucursal_id=6').run('2026-11-06T18:00:00.000Z');
  venta(db, 'cedis-antes', { suc: 6 });
  db.exec("UPDATE seguimiento_foto SET piezas_diezmilesimas='9007199254740993' WHERE sucursal_id=1");
  const r = leer(db);
  const ventas = r.movimientos.filter(m => m.tipo === 'venta');
  assert.deepEqual(ventas.map(m => m.ven_id).sort(), [ID, 'despues', 'interna', 'mostrador'].sort());
  // La venta interna sí saca la mercancía de la tienda, pero queda por aclarar: nunca cuenta como vendida.
  assert.deepEqual(ventas.filter(m => m.por_aclarar).map(m => [m.ven_id, m.por_aclarar]), [['interna', 'cuenta_interna']]);
  assert.ok(r.movimientos.filter(m => m.tipo === 'venta').every(m => m.piezas === 12500n));
  assert.equal(r.movimientos.find(m => m.tipo === 'foto' && m.sucursal_id === 1).piezas, 9007199254740993n);
});

test('compras solo de CEDIS incorporada, posteriores al corte y vigentes; redondeo autorizado', t => {
  const db = prepararDB(t);
  compra(db, ID);
  compra(db, 'media', { cantidad: '0.5000', factor: 10000n });
  compra(db, 'tercio', { cantidad: '0.3333', factor: 10000n });
  compra(db, 'mitad-centavo', { cantidad: '0.5000', factor: 10000n, precio: 101n });
  compra(db, 'fraccion', { cantidad: '0.0001', factor: 5000n });
  compra(db, 'antes', { fecha: '2026-11-04T12:30:25' });
  compra(db, 'cancelada', { estado: 'cancelada' });
  compra(db, 'otra-tienda', { suc: 1 });
  const compras = leer(db).movimientos.filter(m => m.tipo === 'compra');
  assert.equal(compras.length, 5);
  const porId = Object.fromEntries(compras.map(m => [m.lote.com_id, m]));
  assert.deepEqual(porId[ID].lote, { sucursal_id: 6, com_id: ID, renglon: 0 });
  assert.equal(porId[ID].piezas, 360000n);
  assert.equal(porId[ID].valor_centavos, 1234n);
  assert.equal(porId.media.valor_centavos, 617n);
  assert.equal(porId.tercio.valor_centavos, 411n);
  assert.equal(porId['mitad-centavo'].valor_centavos, 51n);
  assert.equal(porId.fraccion.piezas, 1n);
  assert.equal(porId.fraccion.por_aclarar, 'cantidad_fraccionaria');
  db.exec('DELETE FROM seguimiento_foto WHERE sucursal_id=6; DELETE FROM seguimiento_tiendas WHERE sucursal_id=6');
  assert.equal(leer(db).movimientos.filter(m => m.tipo === 'compra').length, 0);
});

test('dos SICAR con art_id distintos producen una salida y una recepción, cada una con su fecha', t => {
  const db = prepararDB(t);
  punta(db, 6, ID);
  punta(db, 1, 'otro-id');
  const ms = traspasos(leer(db));
  assert.deepEqual(ms.map(m => [m.tipo, m.fecha, m.sucursal_id, m.piezas]), [
    ['salida', '2026-11-05', 6, 100000n], ['recepcion', '2026-11-06', 1, 100000n],
  ]);
  assert.deepEqual(ms[0].traspaso, { origen: 6, destino: 1, folio: 'F', suc_origen: 's6', suc_destino: 's1' });
  assert.ok(ms.every(m => !m.por_aclarar));
});

test('cancelación de origen contra recepción y falta de fecha aplicada quedan por aclarar', t => {
  const db = prepararDB(t);
  punta(db, 6, '1', { estado: 'cancelado' });
  punta(db, 1, '2');
  assert.ok(traspasos(leer(db)).every(m => m.por_aclarar === 'origen_cancelado_destino_recibido'));
  db.exec("UPDATE sicar_traspasos SET estado='enviado' WHERE sucursal_id=6; UPDATE sicar_traspasos SET fecha_aplicado=NULL WHERE sucursal_id=1");
  assert.ok(traspasos(leer(db)).every(m => m.por_aclarar === 'sin_fecha_aplicado'));
});

for (const [cantidad, motivo, diferencia] of [['7.0000', 'recepcion_menor', 30000n], ['12.0000', 'recepcion_mayor', 20000n]]) {
  test(`${motivo}: conserva lo enviado y recibido y separa la diferencia`, t => {
    const db = prepararDB(t);
    punta(db, 6, '1');
    punta(db, 1, '2', { cantidad });
    const [salida, recepcion] = traspasos(leer(db));
    assert.equal(salida.piezas, 100000n);
    assert.equal(recepcion.piezas, cantidad === '7.0000' ? 70000n : 120000n);
    const afectado = cantidad === '7.0000' ? salida : recepcion;
    assert.equal(afectado.por_aclarar, motivo);
    assert.equal(afectado.piezas_por_aclarar, diferencia);
    assert.equal((cantidad === '7.0000' ? recepcion : salida).por_aclarar, undefined);
  });
}

test('traspaso el mismo día del corte de cualquiera de las puntas es incierto; anterior no se cuenta', t => {
  const db = prepararDB(t);
  punta(db, 6, 'viejo', { folio: 'V', fecha: '2026-11-03', aplicada: '2026-11-03' });
  punta(db, 1, 'viejo', { folio: 'V', fecha: '2026-11-03', aplicada: '2026-11-03' });
  punta(db, 6, 'corte', { fecha: '2026-11-04', aplicada: '2026-11-05' });
  punta(db, 1, 'corte', { fecha: '2026-11-04', aplicada: '2026-11-05' });
  assert.equal(traspasos(leer(db)).length, 2);
  assert.ok(traspasos(leer(db)).every(m => m.por_aclarar === 'dia_del_corte'));
  db.exec("UPDATE sicar_traspasos SET fecha='2026-11-05' WHERE folio='F'");
  db.prepare('UPDATE seguimiento_tiendas SET corte=? WHERE sucursal_id=1').run('2026-11-05T18:00:00.000Z'); // 12:00 local: la duda es real
  assert.ok(traspasos(leer(db)).every(m => m.por_aclarar === 'dia_del_corte'));
});

test('sin agente y envío anterior a incorporación permanecen grises aunque recepción sea posterior', t => {
  const db = prepararDB(t);
  punta(db, 6, '1', { destino: 's2' });
  punta(db, 2, '2', { destino: 's2', estado: 'recibido', aplicada: '2026-11-08' });
  let ms = traspasos(leer(db));
  assert.equal(ms.length, 1);
  assert.equal(ms[0].sin_agente, true);
  db.prepare('INSERT INTO seguimiento_tiendas(sucursal_id, corte) VALUES (2, ?)').run('2026-11-07T18:00:00.000Z');
  ms = traspasos(leer(db));
  assert.equal(ms.length, 1);
  assert.equal(ms[0].sin_agente, true);
  assert.equal(ms[0].por_aclarar, undefined);
});

test('mapa ausente o contradictorio y varias coincidencias no se asignan como movimientos ciertos', t => {
  const db = prepararDB(t);
  punta(db, 6, '1');
  punta(db, 1, '2');
  punta(db, 1, '3');
  assert.ok(traspasos(leer(db)).every(m => m.por_aclarar === 'folio_ambiguo'));
  assert.ok(traspasos(leer(db)).every(m => m.solo_observacion === true));
  db.exec("DELETE FROM sicar_sucursales_mapa WHERE sicar_sucursal='s1'");
  assert.ok(traspasos(leer(db)).every(m => m.por_aclarar === 'sin_mapa'));
  db.exec("INSERT INTO sicar_sucursales_mapa(sicar_sucursal, sucursal_id) VALUES ('s1', 6)");
  assert.ok(traspasos(leer(db)).every(m => m.por_aclarar === 'mapa_contradictorio'));
});

test('envío sin recepción no inventa disponibilidad; cancelación consistente no mueve nada', t => {
  const db = prepararDB(t);
  punta(db, 6, '1', { estado: 'recibido' });
  let ms = traspasos(leer(db));
  assert.equal(ms.length, 1);
  assert.equal(ms[0].tipo, 'salida');
  assert.equal(ms[0].sin_agente, false);
  assert.equal(ms[0].por_aclarar, undefined);
  db.exec("UPDATE sicar_traspasos SET estado='cancelado'");
  punta(db, 1, '2', { estado: 'cancelado' });
  // Cancelación consistente: la mercancía nunca salió. Antes se emitía una salida que el motor mandaba a
  // tránsito para siempre (hallazgo 2 de la auditoría 2026-11-05).
  assert.deepEqual(traspasos(leer(db)), []);
});

test('sin catálogo en una punta no se supone recepción cero; origen ausente tampoco crea un lote', t => {
  const db = prepararDB(t);
  punta(db, 6, '1');
  punta(db, 1, '2');
  db.exec("DELETE FROM sicar_articulos WHERE sucursal_id=1");
  let ms = traspasos(leer(db));
  assert.ok(ms.every(m => m.por_aclarar === 'catalogo_incompleto'));
  db.prepare(`INSERT INTO sicar_articulos(sucursal_id, art_id, clave, descripcion, actualizado_en)
    VALUES (1, 'art-1', 'A', 'Artículo', ?)`).run(ACTUALIZADO);
  db.exec('DELETE FROM sicar_traspasos_detalle WHERE sucursal_id=6; DELETE FROM sicar_traspasos WHERE sucursal_id=6');
  ms = traspasos(leer(db));
  assert.equal(ms.length, 1);
  assert.equal(ms[0].tipo, 'recepcion');
  assert.equal(ms[0].por_aclarar, 'sin_punta_origen');
});

test('incorporación posterior habilita solo nuevos envíos; traspasos de tienda y retornos conservan sus puntas', t => {
  const db = prepararDB(t);
  db.prepare('INSERT INTO seguimiento_tiendas(sucursal_id, corte) VALUES (2, ?)').run('2026-11-05T18:00:00.000Z');
  punta(db, 1, '1', { origen: 's1', destino: 's2', fecha: '2026-11-06', estado: 'enviado', aplicada: '2026-11-07' });
  punta(db, 2, '2', { origen: 's1', destino: 's2', fecha: '2026-11-06', estado: 'recibido', aplicada: '2026-11-07' });
  punta(db, 1, '3', { folio: 'R', origen: 's1', destino: 's6', estado: 'enviado' });
  punta(db, 6, '4', { folio: 'R', origen: 's1', destino: 's6', estado: 'recibido' });
  const ms = traspasos(leer(db));
  assert.equal(ms.length, 4);
  assert.ok(ms.every(m => !m.por_aclarar && !m.sin_agente));
  assert.deepEqual(ms.filter(m => m.tipo === 'recepcion').map(m => m.sucursal_id), [6, 2]);
});

test('corte UTC cambia de día en México y conserva segundos, milisegundos y medianoche', t => {
  const db = prepararDB(t);
  db.prepare('UPDATE seguimiento_tiendas SET corte=? WHERE sucursal_id=1').run('2026-11-05T00:00:00.000Z');
  venta(db, 'igual', { fecha: '2026-11-04T18:00:00' });
  venta(db, 'posterior', { fecha: '2026-11-04T18:00:01' });
  assert.deepEqual(leer(db).movimientos.filter(m => m.tipo === 'venta').map(m => m.ven_id), ['posterior']);
  db.prepare('UPDATE seguimiento_tiendas SET corte=? WHERE sucursal_id=1').run('2026-11-05T06:00:00.000Z');
  venta(db, 'medianoche', { fecha: '2026-11-05T00:00:00' });
  venta(db, 'segundo', { fecha: '2026-11-05T00:00:01' });
  assert.deepEqual(leer(db).movimientos.filter(m => m.tipo === 'venta').map(m => m.ven_id), ['segundo']);
});

test('fuente sin fecha no se reemplaza por hoy y tienda sin recepción se reporta atrasada', t => {
  const db = prepararDB(t);
  venta(db, '1');
  db.exec('DELETE FROM sicar_envios; UPDATE sicar_tiendas SET ultima_recepcion=NULL WHERE sucursal_id=1');
  const r = leer(db);
  assert.equal(r.calidad.datos_al, null);
  assert.deepEqual(r.calidad.atrasadas, [1]);
  assert.ok(r.calidad.problemas.some(p => p.motivo === 'fuente_sin_fecha'));
});

test('el corte (foto de arranque) no cuenta como fecha de los datos: datos_al es la fuente real más vieja', t => {
  const db = prepararDB(t);
  venta(db, '1');
  assert.equal(leer(db).calidad.datos_al, ACTUALIZADO);
  db.exec('DELETE FROM seguimiento_foto');
  assert.equal(leer(db).calidad.datos_al, ACTUALIZADO);
});

test('leer no escribe y precisión de piezas y dinero supera Number', t => {
  const db = prepararDB(t);
  compra(db, ID, { cantidad: '900719925474.0991', factor: 360000n, precio: 9007199254740991n });
  const cambios = db.prepare('SELECT total_changes() n').get().n;
  const r = leer(db), m = r.movimientos.find(m => m.tipo === 'compra');
  assert.equal(m.piezas, 9007199254740991n * 36n);
  assert.equal(m.valor_centavos, (9007199254740991n ** 2n + 5000n) / 10000n);
  assert.equal(m.por_aclarar, undefined);
  assert.equal(db.prepare('SELECT total_changes() n').get().n, cambios);
});

test('problemas de foto en una incorporada contaminan todos los movimientos de esa clave', t => {
  const db = prepararDB(t);
  compra(db, '1');
  venta(db, '1');
  punta(db, 6, '1');
  db.exec("INSERT INTO seguimiento_foto_problemas VALUES (1, 'A', 'existencia_negativa')");
  const r = leer(db);
  assert.ok(r.movimientos.length >= 5);
  assert.ok(r.movimientos.every(m => m.por_aclarar === 'clave_con_problema'));
  assert.ok(r.calidad.problemas.some(p => p.sucursal_id === 1 && p.motivo === 'existencia_negativa'));
});

test('clave duplicada en catálogo actual es incierta; misma art_id en otra tienda no cruza claves', t => {
  const db = prepararDB(t);
  venta(db, '1');
  db.prepare(`INSERT INTO sicar_articulos(sucursal_id, art_id, clave, descripcion, actualizado_en)
    VALUES (6, 'art-1', 'OTRA', 'Otro', ?)`).run(ACTUALIZADO);
  assert.equal(leer(db, 'OTRA').movimientos.length, 0);
  db.prepare(`INSERT INTO sicar_articulos(sucursal_id, art_id, clave, descripcion, actualizado_en)
    VALUES (1, 'duplicado', 'A', 'Otro', ?)`).run(ACTUALIZADO);
  assert.ok(leer(db).movimientos.every(m => m.por_aclarar === 'clave_con_problema'));
});

test('calidad: mínimo real de fuentes, umbral configurable estricto y ahora inyectable', t => {
  const db = prepararDB(t);
  venta(db, '1');
  db.exec("UPDATE sicar_envios SET fecha='2026-11-03T20:00:00.000Z'");
  db.exec("UPDATE sicar_tiendas SET ultima_recepcion='2026-11-06T17:59:59.999Z' WHERE sucursal_id=1");
  db.exec("UPDATE sicar_tiendas SET ultima_recepcion='2026-11-06T18:00:00.000Z' WHERE sucursal_id=6");
  let r = leer(db);
  assert.equal(r.calidad.datos_al, '2026-11-03T20:00:00.000Z');
  assert.deepEqual(r.calidad.atrasadas, [1]);
  db.exec("INSERT INTO seguimiento_config(clave, valor) VALUES ('dias_datos_atrasados', '3')");
  r = leer(db);
  assert.deepEqual(r.calidad.atrasadas, []);
});

test('orden por día, foto antes de compras, compras antes de traspasos y ventas; estable y JSON seguro', t => {
  const db = prepararDB(t);
  compra(db, '2');
  compra(db, ID);
  punta(db, 6, '1', { aplicada: '2026-11-05' });
  punta(db, 1, '2', { aplicada: '2026-11-05' });
  venta(db, '1', { fecha: '2026-11-05T01:00:00' });
  const r = leer(db);
  assert.deepEqual(r.movimientos.map(m => m.tipo), ['foto', 'foto', 'compra', 'compra', 'salida', 'recepcion', 'venta']);
  assert.deepEqual(leer(db), r);
  const json = JSON.parse(JSON.stringify(r));
  assert.equal(json.movimientos.find(m => m.tipo === 'compra').piezas, '360000');
  assert.equal(json.movimientos.find(m => m.tipo === 'compra').valor_centavos, '1234');
});

test('traspaso cancelado sin recepción no mueve piezas: la mercancía sigue en el origen', t => {
  const db = prepararDB(t);
  punta(db, 6, 'gris', { folio: 'G', destino: 's2', estado: 'cancelado', aplicada: null }); // a tienda sin agente
  punta(db, 6, 'solo', { folio: 'S', estado: 'cancelado', aplicada: null }); // a Ocosingo, que no lo registró
  punta(db, 6, 'ambas', { folio: 'A', estado: 'cancelado', aplicada: null });
  punta(db, 1, 'ambas', { folio: 'A', estado: 'cancelado', aplicada: null }); // las dos puntas canceladas
  assert.deepEqual(traspasos(leer(db)), []);
});

test('devolución desde una tienda sin agente: la recepción se reconoce como origen no incorporado', t => {
  const db = prepararDB(t);
  punta(db, 6, 'dev', { folio: 'D', origen: 's2', destino: 's6', estado: 'recibido' }); // Yajalón (sin agente) → CEDIS
  const [m] = traspasos(leer(db));
  assert.equal(m.tipo, 'recepcion');
  assert.equal(m.sucursal_id, 6);
  assert.equal(m.por_aclarar, 'origen_no_incorporado');
});

test('devolución histórica: el origen incorporado después no la borra (sigue como origen no incorporado)', t => {
  const db = prepararDB(t);
  punta(db, 6, 'dev', { folio: 'D', origen: 's2', destino: 's6', estado: 'recibido' }); // 2026-11-05 → 06
  db.prepare('INSERT INTO seguimiento_tiendas(sucursal_id, corte) VALUES (2, ?)').run('2026-11-07T18:00:00.000Z');
  const [m] = traspasos(leer(db));
  assert.equal(m.tipo, 'recepcion');
  assert.equal(m.por_aclarar, 'origen_no_incorporado', 'ocurrió antes de que el origen entrara al seguimiento');
});

// Foto de madrugada (tienda cerrada): todo lo fechado ese día en SICAR ocurrió después de la foto.
const MADRUGADA = '2026-11-06T06:05:08.000Z'; // 2026-11-06 00:05 hora de México
const MEDIODIA = '2026-11-06T18:40:00.000Z'; // 2026-11-06 12:40 hora de México
const corte = (db, suc, iso) => db.prepare('UPDATE seguimiento_tiendas SET corte=? WHERE sucursal_id=?').run(iso, suc);

test('corte de origen de madrugada: el traspaso de ese día es posterior a la foto y mueve las piezas', t => {
  const db = prepararDB(t);
  corte(db, 6, MADRUGADA);
  db.exec("UPDATE seguimiento_foto SET piezas_diezmilesimas='0' WHERE sucursal_id=6");
  compra(db, 'C32194', { fecha: '2026-11-06T16:16:00' });
  punta(db, 6, '1', { fecha: '2026-11-06', aplicada: '2026-11-07' });
  punta(db, 1, '2', { fecha: '2026-11-06', aplicada: '2026-11-07' });
  const r = leer(db), ms = traspasos(r);
  assert.deepEqual(ms.map(m => [m.tipo, m.sucursal_id, m.piezas, m.por_aclarar, m.sin_agente]), [
    ['salida', 6, 100000n, undefined, false], ['recepcion', 1, 100000n, undefined, undefined],
  ]);
  const lote = require('./motor').calcular(r.movimientos).lotes.find(l => l.lote.com_id === 'C32194');
  assert.equal(lote.por_aclarar, '0');
  assert.equal(lote.por_sucursal[1].queda, '100000');
  assert.equal(lote.por_sucursal[6].queda, '260000');
});

test('corte de origen a mediodía: el traspaso de ese día sigue siendo dudoso; de madrugada ya no', t => {
  const db = prepararDB(t);
  corte(db, 6, MEDIODIA);
  punta(db, 6, '1', { fecha: '2026-11-06', aplicada: '2026-11-07' });
  punta(db, 1, '2', { fecha: '2026-11-06', aplicada: '2026-11-07' });
  assert.ok(traspasos(leer(db)).every(m => m.por_aclarar === 'dia_del_corte'));
  corte(db, 6, MADRUGADA);
  assert.ok(traspasos(leer(db)).every(m => m.por_aclarar === undefined));
});

test('corte de destino de madrugada: la recepción aplicada ese día no es dudosa', t => {
  const db = prepararDB(t);
  corte(db, 1, MADRUGADA);
  punta(db, 6, '1', { fecha: '2026-11-06', aplicada: '2026-11-06' });
  punta(db, 1, '2', { fecha: '2026-11-06', aplicada: '2026-11-06' });
  let ms = traspasos(leer(db));
  assert.equal(ms.length, 2);
  assert.ok(ms.every(m => m.por_aclarar === undefined && !m.sin_agente));
  corte(db, 1, MEDIODIA);
  ms = traspasos(leer(db));
  assert.ok(ms.every(m => m.por_aclarar === 'dia_del_corte'));
});

test('el límite de madrugada es estricto: 06:59:59 local no es dudoso, 07:00 local sí', t => {
  const db = prepararDB(t);
  punta(db, 6, '1', { fecha: '2026-11-06', aplicada: '2026-11-07' });
  punta(db, 1, '2', { fecha: '2026-11-06', aplicada: '2026-11-07' });
  corte(db, 6, '2026-11-06T12:59:59.999Z');
  assert.ok(traspasos(leer(db)).every(m => m.por_aclarar === undefined));
  corte(db, 6, '2026-11-06T13:00:00.000Z');
  assert.ok(traspasos(leer(db)).every(m => m.por_aclarar === 'dia_del_corte'));
});

test('el corte se juzga en fecha y hora de México: 05:30 UTC es 23:30 del día anterior', t => {
  const db = prepararDB(t);
  corte(db, 6, '2026-11-06T05:30:00.000Z'); // 2026-11-05 23:30 local: no es madrugada
  punta(db, 6, '1', { folio: 'A', fecha: '2026-11-05', aplicada: '2026-11-07' });
  punta(db, 1, '2', { folio: 'A', fecha: '2026-11-05', aplicada: '2026-11-07' });
  punta(db, 6, '3', { folio: 'B', fecha: '2026-11-06', aplicada: '2026-11-07' });
  punta(db, 1, '4', { folio: 'B', fecha: '2026-11-06', aplicada: '2026-11-07' });
  const porFolio = folio => traspasos(leer(db)).filter(m => m.traspaso.folio === folio).map(m => m.por_aclarar);
  assert.deepEqual(porFolio('A'), ['dia_del_corte', 'dia_del_corte']);
  assert.deepEqual(porFolio('B'), [undefined, undefined]);
  corte(db, 6, '2026-11-06T06:30:00.000Z'); // 2026-11-06 00:30 local: madrugada
  assert.deepEqual(porFolio('B'), [undefined, undefined]);
  corte(db, 6, '2026-11-06T05:59:59.000Z'); // 2026-11-05 23:59:59 local
  assert.deepEqual(porFolio('A'), ['dia_del_corte', 'dia_del_corte']);
});
