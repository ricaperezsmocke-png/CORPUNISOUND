const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { crearRepositorioSicar } = require('../sicarRepositorio');
const { transitoHacia } = require('./consultas');

const AL = '2026-11-05T18:00:00.000Z';

function prepararDB(t) {
  const db = new Database(':memory:');
  crearRepositorioSicar(db);
  t.after(() => db.close());
  for (const suc of [1, 6]) {
    db.prepare('INSERT INTO sicar_tiendas(sucursal_id, ultima_recepcion) VALUES (?, ?)').run(suc, AL);
    db.prepare(`INSERT INTO sicar_articulos(sucursal_id, art_id, clave, descripcion, actualizado_en)
      VALUES (?, ?, 'A', 'Artículo', ?)`).run(suc, `art-${suc}`, AL);
    db.prepare('INSERT INTO sicar_sucursales_mapa(sicar_sucursal, sucursal_id) VALUES (?, ?)').run(`s${suc}`, suc);
  }
  return db;
}

function punta(db, suc, folio, estado, cantidad = '5.0000') {
  db.prepare('INSERT INTO sicar_traspasos VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, ?)')
    .run(suc, `${folio}-${suc}`, folio, 's6', 's1', '2026-11-01', estado, AL);
  db.prepare('INSERT INTO sicar_traspasos_detalle VALUES (?, ?, ?, ?, 0, 0)').run(suc, `${folio}-${suc}`, `art-${suc}`, cantidad);
}

test('en tránsito: solo lo enviado por el origen que el destino aún no recibe ni cancela', t => {
  const db = prepararDB(t);
  punta(db, 6, 'RECIBIDO', 'enviado');  // el SICAR de CEDIS lo sigue viendo enviado...
  punta(db, 1, 'RECIBIDO', 'recibido'); // ...pero Ocosingo ya lo recibió: no está en camino
  punta(db, 6, 'CANCELADO', 'enviado');
  punta(db, 1, 'CANCELADO', 'cancelado');
  punta(db, 6, 'EN_CAMINO', 'enviado', '3.0000'); // sin recepción todavía: sí está en camino
  punta(db, 6, 'ANULADO', 'cancelado');
  assert.deepEqual(transitoHacia(db, 'A'), { 1: 30000n });
});

test('renglón de compra sin clave: la factura dice información insuficiente y no desaparece', t => {
  const { listar, detalle } = require('./consultas');
  const servicio = require('./servicio');
  const db = prepararDB(t);
  db.prepare('INSERT INTO seguimiento_tiendas(sucursal_id, corte) VALUES (6, ?)').run('2026-09-01T18:00:00.000Z');
  db.prepare(`INSERT INTO sicar_articulos(sucursal_id, art_id, clave, descripcion, actualizado_en)
    VALUES (6, 'sin-clave', NULL, 'Amplificador', ?)`).run(AL);
  const compra = (com_id, renglones) => {
    db.prepare(`INSERT INTO sicar_compras (sucursal_id, com_id, fecha, pro_id, folio, comentario, estado, total_centavos,
      primera_vez, actualizado_en) VALUES (6, ?, '2026-09-20T10:00:00', '1', ?, '', 'vigente', 0, ?, ?)`).run(com_id, `F${com_id}`, AL, AL);
    renglones.forEach(([art, precio], i) => db.prepare('INSERT INTO sicar_compras_detalle VALUES (6, ?, ?, ?, ?, 10000, ?, 0, 0)')
      .run(com_id, i, art, '1.0000', precio));
  };
  compra('1', [['art-6', 10000], ['sin-clave', 1000000]]); // $100 con clave + $10,000 sin clave
  compra('2', [['sin-clave', 500000]]); // toda sin clave
  compra('3', [['art-6', 20000]]); // completa
  servicio.marcarPendientes(db, 6, ['art-6'], AL);
  servicio.procesarPendientes(db, { ahora: AL });
  const lista = listar(db, {}, AL).facturas;
  const f = id => lista.find(x => x.com_id === id);
  assert.equal(f('1').renglones_sin_seguimiento, 1);
  assert.equal(f('1').dinero, null, 'no presenta $100 como si fuera toda la factura');
  assert.equal(f('2').renglones_sin_seguimiento, 1);
  assert.equal(f('2').dinero, null);
  assert.equal(f('3').renglones_sin_seguimiento, 0);
  assert.equal(f('3').dinero.queda, '20000');
  assert.equal(detalle(db, 6, '2', AL).factura.renglones_sin_seguimiento, 1);
});

test('detalle compara el saldo calculado contra la existencia de SICAR por tienda', t => {
  const { detalle } = require('./consultas');
  const servicio = require('./servicio');
  const db = prepararDB(t);
  for (const suc of [6, 1]) db.prepare('INSERT INTO seguimiento_tiendas(sucursal_id, corte) VALUES (?, ?)').run(suc, '2026-09-01T18:00:00.000Z');
  db.prepare("INSERT INTO seguimiento_foto VALUES (6, 'A', '20000')").run(); // 2 piezas anteriores en CEDIS
  db.prepare(`INSERT INTO sicar_compras (sucursal_id, com_id, fecha, pro_id, folio, comentario, estado, total_centavos,
    primera_vez, actualizado_en) VALUES (6, '1', '2026-09-20T10:00:00', '1', 'F1', '', 'vigente', 0, ?, ?)`).run(AL, AL);
  db.prepare("INSERT INTO sicar_compras_detalle VALUES (6, '1', 0, 'art-6', '10.0000', 10000, 1000, 0, 0)").run();
  db.prepare("INSERT INTO sicar_ventas_mostrador VALUES (6, 'v1', '2026-10-01T10:00:00', 'vigente', 100, ?)").run(AL);
  db.prepare("INSERT INTO sicar_detalles_mostrador VALUES (6, 'v1', 0, 'art-6', '3.0000', 100, 0)").run();
  db.prepare('INSERT INTO sicar_existencias VALUES (6, ?, ?, ?)').run('art-6', 80000, AL); // SICAR dice 8; calculado 2 + 10 − 3 = 9
  db.prepare('INSERT INTO sicar_existencias VALUES (1, ?, 0, ?)').run('art-1', AL);
  servicio.marcarPendientes(db, 6, ['art-6'], AL);
  servicio.procesarPendientes(db, { ahora: AL });
  const [r] = detalle(db, 6, '1', AL).renglones;
  assert.deepEqual(r.comparacion, [
    { sucursal_id: 1, calculado: '0', sicar: '0', motivo_sicar: null, diferencia: '0' },
    { sucursal_id: 6, calculado: '90000', sicar: '80000', motivo_sicar: null, diferencia: '-10000' },
  ]);
});

test('traslado por artículo: dos facturas viejas de la misma clave no duplican la sugerencia', t => {
  const { detalle } = require('./consultas');
  const servicio = require('./servicio');
  const db = prepararDB(t);
  for (const suc of [6, 1]) db.prepare('INSERT INTO seguimiento_tiendas(sucursal_id, corte) VALUES (?, ?)').run(suc, '2026-09-01T18:00:00.000Z');
  for (const id of ['1', '2']) {
    db.prepare(`INSERT INTO sicar_compras (sucursal_id, com_id, fecha, pro_id, folio, comentario, estado, total_centavos,
      primera_vez, actualizado_en) VALUES (6, ?, '2026-09-20T10:00:00', '1', ?, '', 'vigente', 0, ?, ?)`).run(id, `F${id}`, AL, AL);
    db.prepare("INSERT INTO sicar_compras_detalle VALUES (6, ?, 0, 'art-6', '5.0000', 10000, 1000, 0, 0)").run(id);
  }
  db.prepare('INSERT INTO sicar_existencias VALUES (6, ?, ?, ?)').run('art-6', 100000, AL); // 10 en CEDIS
  db.prepare('INSERT INTO sicar_existencias VALUES (1, ?, 0, ?)').run('art-1', AL);
  // Ocosingo vendió 16 en 8 semanas (8 + 8 en dos semanas distintas): para 4 semanas necesita 8.
  for (const [id, dia] of [['v1', '2026-10-20'], ['v2', '2026-10-27']]) {
    db.prepare('INSERT INTO sicar_ventas_mostrador VALUES (1, ?, ?, ?, 100, ?)').run(id, `${dia}T12:00:00`, 'vigente', AL);
    db.prepare('INSERT INTO sicar_detalles_mostrador VALUES (1, ?, 0, ?, ?, 100, 0)').run(id, 'art-1', '8.0000');
  }
  servicio.marcarPendientes(db, 6, ['art-6'], AL);
  servicio.procesarPendientes(db, { ahora: AL });
  for (const id of ['1', '2']) {
    const e = detalle(db, 6, id, AL).renglones[0].estrategias;
    assert.deepEqual(e.traslados, [{ de: 6, a: 1, piezas: '80000', razon: 'destino_vende_mas' }], `factura ${id}`);
    assert.equal(e.facturas_en_aviso, 2);
  }
});

// ---- Revisión de Codex 2026-11-05 ----
function escenarioTraslado(t, { costo = 1000, existenciaDestino = 'actual' } = {}) {
  const db = prepararDB(t);
  for (const suc of [6, 1]) db.prepare('INSERT INTO seguimiento_tiendas(sucursal_id, corte) VALUES (?, ?)').run(suc, '2026-09-01T18:00:00.000Z');
  db.prepare(`INSERT INTO sicar_compras (sucursal_id, com_id, fecha, pro_id, folio, comentario, estado, total_centavos,
    primera_vez, actualizado_en) VALUES (6, '1', '2026-09-20T10:00:00', '1', 'F1', '', 'vigente', 0, ?, ?)`).run(AL, AL);
  db.prepare("INSERT INTO sicar_compras_detalle VALUES (6, '1', 0, 'art-6', '10.0000', 10000, ?, 0, 0)").run(costo);
  db.prepare('INSERT INTO sicar_existencias VALUES (6, ?, ?, ?)').run('art-6', 100000, AL);
  if (existenciaDestino === 'actual') db.prepare('INSERT INTO sicar_existencias VALUES (1, ?, 0, ?)').run('art-1', AL);
  if (existenciaDestino === 'vieja') db.prepare('INSERT INTO sicar_existencias VALUES (1, ?, 0, ?)').run('art-1', '2026-08-28T18:00:00.000Z');
  for (const [id, dia] of [['v1', '2026-10-20'], ['v2', '2026-10-27']]) {
    db.prepare('INSERT INTO sicar_ventas_mostrador VALUES (1, ?, ?, ?, 100, ?)').run(id, `${dia}T12:00:00`, 'vigente', AL);
    db.prepare('INSERT INTO sicar_detalles_mostrador VALUES (1, ?, 0, ?, ?, 100, 0)').run(id, 'art-1', '8.0000');
  }
  return db;
}
const procesarYDetalle = (db, ahora = AL) => {
  const servicio = require('./servicio');
  servicio.marcarPendientes(db, 6, ['art-6'], ahora);
  servicio.procesarPendientes(db, { ahora });
  return require('./consultas').detalle(db, 6, '1', ahora);
};
const INSUFICIENTE = [{ de: 6, a: null, piezas: null, razon: 'informacion_insuficiente' }];

test('existencia destino ausente o vieja: no se sugiere cantidad', t => {
  assert.deepEqual(procesarYDetalle(escenarioTraslado(t)).renglones[0].estrategias.traslados,
    [{ de: 6, a: 1, piezas: '80000', razon: 'destino_vende_mas' }], 'con existencia actual sí');
  for (const existenciaDestino of ['ausente', 'vieja']) {
    const d = procesarYDetalle(escenarioTraslado(t, { existenciaDestino }));
    assert.deepEqual(d.renglones[0].estrategias.traslados, INSUFICIENTE, existenciaDestino);
    assert.equal(d.renglones[0].comparacion.find(c => c.sucursal_id === 1).sicar, null);
  }
});

test('costo cero o desconocido: nada de liquidar a $0 ni precio sugerido', t => {
  const d = procesarYDetalle(escenarioTraslado(t, { costo: 0 }), '2027-02-01T18:00:00.000Z');
  assert.equal(d.factura.etapa, 'liquidar');
  assert.doesNotMatch(d.renglones[0].estrategias.margen.texto, /\$0\.00/);
  assert.match(d.renglones[0].estrategias.margen.texto, /no es calculable/);
});

test('clave con problema en la foto: sin dinero en la lista y sin cantidades sugeridas', t => {
  const db = escenarioTraslado(t);
  db.prepare("INSERT INTO seguimiento_foto_problemas VALUES (6, 'A', 'existencia_negativa')").run();
  const d = procesarYDetalle(db);
  assert.equal(d.factura.dinero, null);
  assert.deepEqual(d.renglones[0].estrategias.traslados, INSUFICIENTE);
  assert.equal(require('./consultas').listar(db, {}, AL).facturas[0].dinero, null);
});

test('factura enviada completa a tienda sin agente: no es agotada y sigue visible con el filtro inicial', t => {
  const db = escenarioTraslado(t);
  db.prepare('INSERT INTO sicar_sucursales_mapa(sicar_sucursal, sucursal_id) VALUES (?, ?)').run('s2', 2);
  db.prepare("INSERT INTO sicar_traspasos VALUES (6, 'g', 'G', 's6', 's2', '2026-09-25', 'enviado', NULL, NULL, 0, ?)").run(AL);
  db.prepare("INSERT INTO sicar_traspasos_detalle VALUES (6, 'g', 'art-6', '10.0000', 0, 0)").run();
  procesarYDetalle(db);
  const lista = require('./consultas').listar(db, { ocultar_agotadas: '1' }, AL);
  assert.equal(lista.total, 1);
  assert.equal(lista.facturas[0].agotada, false);
  assert.equal(lista.facturas[0].etapa, null, 'lo gris no genera avisos');
});

test('liquidar respeta el porcentaje de ganancia configurado', t => {
  const db = escenarioTraslado(t);
  require('./rutas').cambiarConfig(db, { ganancia_liquidacion_porcentaje: 25 }, '1', AL);
  db.prepare("INSERT INTO sicar_clientes(sucursal_id, cli_id, nombre) VALUES (1, 'c', 'Cliente')").run();
  db.prepare(`INSERT INTO sicar_ventas(sucursal_id, ven_id, cli_id, fecha_local, estado, total_centavos, revision, hash)
    VALUES (1, 'p', 'c', '2026-10-30T10:00:00', 'vigente', 100, 'r', 'h')`).run();
  db.prepare("INSERT INTO sicar_detalles VALUES (1, 'p', 'art-1', 0, 'A', 'Art', '1.0000', '30.00', '30.00', 3000, 0)").run();
  const m = procesarYDetalle(db, '2027-02-01T18:00:00.000Z').renglones[0].estrategias.margen;
  assert.match(m.texto, /25 %/);
  assert.equal(m.precio_referencia_centavos, '1500'); // costo $10 + ⌈25 % de ($30 − $10)⌉
});

test('cantidad fraccionaria invalida la atribución: sin dinero ni cantidades sugeridas', t => {
  const db = escenarioTraslado(t);
  db.exec("UPDATE sicar_compras_detalle SET cantidad='10.0001', factor_diezmilesimas=5000 WHERE com_id='1'");
  const d = procesarYDetalle(db);
  assert.ok(d.renglones[0].motivos.includes('cantidad_fraccionaria'));
  assert.equal(d.factura.dinero, null);
  assert.deepEqual(d.renglones[0].estrategias.traslados, INSUFICIENTE);
});

test('existencia sin artículo en catálogo: SICAR desconocido, nunca un falso cero que cuadra', t => {
  const db = escenarioTraslado(t);
  db.prepare('INSERT INTO sicar_existencias VALUES (1, ?, ?, ?)').run('huerfano', 50000, AL); // 5 piezas sin catálogo
  db.exec("DELETE FROM sicar_articulos WHERE sucursal_id=1 AND art_id='art-1'");
  const c = procesarYDetalle(db).renglones[0].comparacion.find(x => x.sucursal_id === 1);
  assert.equal(c.sicar, null);
  assert.equal(c.motivo_sicar, 'catalogo_incompleto');
});

test('existencia de un artículo sin clave (NULL, vacía o espacios): SICAR desconocido, no cuadra en cero', t => {
  for (const clave of [null, '', '   ']) {
    const db = escenarioTraslado(t);
    // Solo el caso a probar: ninguna existencia huérfana; el artículo existe pero sin clave.
    db.exec("DELETE FROM sicar_existencias WHERE sucursal_id=1 AND art_id='art-1'");
    db.exec("DELETE FROM sicar_articulos WHERE sucursal_id=1 AND art_id='art-1'");
    db.prepare(`INSERT INTO sicar_articulos(sucursal_id, art_id, clave, descripcion, actualizado_en)
      VALUES (1, 'sin-clave', ?, 'Púas', ?)`).run(clave, AL);
    db.prepare('INSERT INTO sicar_existencias VALUES (1, ?, ?, ?)').run('sin-clave', 50000, AL);
    const c = procesarYDetalle(db).renglones[0].comparacion.find(x => x.sucursal_id === 1);
    assert.equal(c.motivo_sicar, 'catalogo_incompleto', JSON.stringify(clave));
    assert.equal(c.sicar, null);
  }
});

// ---- Dinero con IVA (decisión de Victor 2026-11-11: mostrar con y sin IVA) ----
function escenarioIva(t) {
  const db = prepararDB(t);
  db.prepare('INSERT INTO seguimiento_tiendas(sucursal_id, corte) VALUES (6, ?)').run('2026-09-01T18:00:00.000Z');
  const compra = (com_id, renglones) => {
    db.prepare(`INSERT INTO sicar_compras (sucursal_id, com_id, fecha, pro_id, folio, comentario, estado, total_centavos,
      primera_vez, actualizado_en) VALUES (6, ?, '2026-09-20T10:00:00', '1', ?, '', 'vigente', 0, ?, ?)`).run(com_id, `F${com_id}`, AL, AL);
    renglones.forEach(([cantidad, sin, con], i) => db.prepare("INSERT INTO sicar_compras_detalle VALUES (6, ?, ?, 'art-6', ?, 10000, ?, ?, 0)")
      .run(com_id, i, cantidad, sin, con));
  };
  // Factura 1: 3 piezas a $103.45 ($120.00 con IVA) + 2 piezas a $86.21 ($100.01 con IVA).
  compra('1', [['3.0000', 10345, 12000], ['2.0000', 8621, 10001]]);
  // Factura 2: un renglón sin precio con IVA (cero): no se inventa el 16 %.
  compra('2', [['1.0000', 10000, 0]]);
  // Se vende 1 pieza en CEDIS: sale del renglón más viejo (FIFO).
  db.prepare("INSERT INTO sicar_ventas_mostrador VALUES (6, 'v1', '2026-10-01T10:00:00', 'vigente', 100, ?)").run(AL);
  db.prepare("INSERT INTO sicar_detalles_mostrador VALUES (6, 'v1', 0, 'art-6', '1.0000', 100, 0)").run();
  const servicio = require('./servicio');
  servicio.marcarPendientes(db, 6, ['art-6'], AL);
  servicio.procesarPendientes(db, { ahora: AL });
  return db;
}

test('con IVA: cada factura trae el reparto y el total con IVA exactos, y lo sin IVA no cambia', t => {
  const { listar, detalle } = require('./consultas');
  const db = escenarioIva(t);
  const f = listar(db, {}, AL).facturas.find(x => x.com_id === '1');
  // Sin IVA: 3 × 103.45 = 310.35 (vendido 1/3 = 103.45) + 2 × 86.21 = 172.42.
  assert.deepEqual(f.dinero, { vendido: '10345', queda: '37932', transito: '0', gris: '0', por_aclarar: '0' });
  assert.equal(f.total_sin_iva_centavos, '48277');
  // Con IVA: 3 × 120.00 = 360.00 (vendido 120.00) + 2 × 100.01 = 200.02.
  assert.deepEqual(f.dinero_con_iva, { vendido: '12000', queda: '44002', transito: '0', gris: '0', por_aclarar: '0' });
  assert.equal(f.total_con_iva_centavos, '56002');
  const d = detalle(db, 6, '1', AL);
  assert.deepEqual(d.factura.dinero_con_iva, f.dinero_con_iva);
  assert.equal(d.factura.total_con_iva_centavos, '56002');
  assert.deepEqual(d.renglones.map(r => r.valor_con_iva_centavos), ['36000', '20002']);
  assert.deepEqual(d.renglones.map(r => r.valor_centavos), ['31035', '17242']);
});

test('con IVA: sin precio con IVA la factura lo dice (null) y lo sin IVA sigue completo', t => {
  const { listar } = require('./consultas');
  const db = escenarioIva(t);
  const f = listar(db, {}, AL).facturas.find(x => x.com_id === '2');
  assert.deepEqual(f.dinero, { vendido: '0', queda: '10000', transito: '0', gris: '0', por_aclarar: '0' });
  assert.equal(f.total_sin_iva_centavos, '10000');
  assert.equal(f.dinero_con_iva, null);
  assert.equal(f.total_con_iva_centavos, null);
  // El renglón tampoco presume un valor con IVA de $0.00.
  const [r] = require('./consultas').detalle(db, 6, '2', AL).renglones;
  assert.equal(r.valor_con_iva_centavos, null);
  assert.equal(r.dinero_con_iva, null);
});

test('con IVA: un resultado guardado antes del cambio (sin el dato) da null hasta recalcular', t => {
  const { listar } = require('./consultas');
  const db = escenarioIva(t);
  const fila = db.prepare("SELECT rowid, datos_json FROM seguimiento_resultado WHERE com_id='1' AND renglon=1").get();
  const viejo = JSON.parse(fila.datos_json);
  delete viejo.dinero_con_iva;
  delete viejo.valor_con_iva_centavos;
  db.prepare('UPDATE seguimiento_resultado SET datos_json=? WHERE rowid=?').run(JSON.stringify(viejo), fila.rowid);
  const f = listar(db, {}, AL).facturas.find(x => x.com_id === '1');
  assert.equal(f.dinero_con_iva, null);
  assert.equal(f.total_con_iva_centavos, null);
  assert.equal(f.total_sin_iva_centavos, '48277');
});

test('con IVA: factura sin dinero calculable tampoco tiene con IVA ni totales', t => {
  const { listar } = require('./consultas');
  const db = escenarioIva(t);
  db.prepare(`INSERT INTO sicar_compras (sucursal_id, com_id, fecha, pro_id, folio, comentario, estado, total_centavos,
    primera_vez, actualizado_en) VALUES (6, '9', '2026-09-20T10:00:00', '1', 'F9', '', 'vigente', 0, ?, ?)`).run(AL, AL);
  db.prepare(`INSERT INTO sicar_articulos(sucursal_id, art_id, clave, descripcion, actualizado_en)
    VALUES (6, 'sin-clave', NULL, 'Amplificador', ?)`).run(AL);
  db.prepare("INSERT INTO sicar_compras_detalle VALUES (6, '9', 0, 'sin-clave', '1.0000', 10000, 50000, 58000, 0)").run();
  const f = listar(db, {}, AL).facturas.find(x => x.com_id === '9');
  assert.equal(f.dinero, null);
  assert.equal(f.dinero_con_iva, null);
  assert.equal(f.total_con_iva_centavos, null);
  assert.equal(f.total_sin_iva_centavos, null);
});

test('el detalle dice por renglón si la clave se reconstruyó con el rescate (null si no)', t => {
  const { detalle } = require('./consultas');
  const db = prepararDB(t);
  db.prepare('INSERT INTO seguimiento_tiendas(sucursal_id, corte) VALUES (6, ?)').run('2026-09-01T18:00:00.000Z');
  const rescate = { desde: '2026-11-06T00:05:00.000', tiendas: [2] };
  const datos = extra => JSON.stringify({ comprado: '10000', vendido: '0', queda: '10000', transito: '0', sin_agente: '0',
    por_aclarar: '0', por_sucursal: { 6: { queda: '10000', vendido: '0' } }, dinero: null, fecha_compra: '2026-11-04',
    valor_centavos: '0', calidad: { datos_al: AL }, ...extra });
  const guardar = db.prepare("INSERT INTO seguimiento_resultado VALUES (6, '77', ?, 'A', ?, 2, ?)");
  guardar.run(0, datos({ rescate }), AL);
  guardar.run(1, datos({}), AL);
  assert.deepEqual(detalle(db, 6, '77', AL).renglones.map(r => r.rescate), [rescate, null]);
});
