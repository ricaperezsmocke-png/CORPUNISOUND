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

test('importe SICAR: consultas suma exactamente los dos renglones aunque difieran de precio por cantidad', t => {
  const db = escenarioIva(t);
  db.exec(`UPDATE sicar_compras_detalle SET importe_con_centavos = CASE renglon WHEN 0 THEN 35999 ELSE 20001 END
    WHERE com_id='1'`);
  const d = procesarYDetalle(db);
  const f = require('./consultas').listar(db, {}, AL).facturas.find(x => x.com_id === '1');
  assert.equal(f.total_con_iva_centavos, '56000');
  assert.equal(d.factura.total_con_iva_centavos, '56000');
  assert.deepEqual(d.renglones.map(r => r.valor_con_iva_centavos), ['35999', '20001']);
});

test('importe SICAR: con importe cero conserva precio por cantidad y sin precio conserva null', t => {
  const db = escenarioIva(t);
  const d = require('./consultas').detalle(db, 6, '1', AL);
  assert.deepEqual(d.renglones.map(r => r.valor_con_iva_centavos), ['36000', '20002']);
  assert.equal(d.factura.total_con_iva_centavos, '56002');
  const sinPrecio = require('./consultas').detalle(db, 6, '2', AL);
  assert.equal(sinPrecio.renglones[0].valor_con_iva_centavos, null);
  assert.equal(sinPrecio.factura.total_con_iva_centavos, null);
});

test('importe SICAR: cambiar importes con IVA conserva dinero y total sin IVA', t => {
  const db = escenarioIva(t);
  const antes = require('./consultas').detalle(db, 6, '1', AL);
  db.exec(`UPDATE sicar_compras_detalle SET importe_con_centavos = CASE renglon WHEN 0 THEN 35999 ELSE 20001 END
    WHERE com_id='1'`);
  const despues = procesarYDetalle(db);
  const dinero = { vendido: '10345', queda: '37932', transito: '0', gris: '0', por_aclarar: '0' };
  for (const d of [antes, despues]) {
    assert.deepEqual(d.factura.dinero, dinero);
    assert.equal(d.factura.total_sin_iva_centavos, '48277');
    assert.deepEqual(d.renglones.map(r => r.valor_centavos), ['31035', '17242']);
  }
  const f = require('./consultas').listar(db, {}, AL).facturas.find(x => x.com_id === '1');
  assert.deepEqual(f.dinero, dinero);
  assert.equal(f.total_sin_iva_centavos, '48277');
});

// ---- Fase 2: en el camino y por aclarar ----
const CORTE_F2 = '2026-09-01T18:00:00.000Z';

/** CEDIS (6), Ocosingo (1) y Yajalón (2) incorporadas, con mapa s6/s1/s2 y una compra de CEDIS por factura pedida. */
function escenarioCamino(t, compras = [['C1', '20.0000']]) {
  const db = prepararDB(t);
  db.prepare('INSERT INTO sicar_tiendas(sucursal_id, ultima_recepcion) VALUES (2, ?)').run(AL);
  db.prepare(`INSERT INTO sicar_articulos(sucursal_id, art_id, clave, descripcion, actualizado_en)
    VALUES (2, 'art-2', 'A', 'Artículo', ?)`).run(AL);
  db.prepare("INSERT INTO sicar_sucursales_mapa(sicar_sucursal, sucursal_id) VALUES ('s2', 2)").run();
  for (const suc of [1, 2, 6]) db.prepare('INSERT INTO seguimiento_tiendas(sucursal_id, corte) VALUES (?, ?)').run(suc, CORTE_F2);
  db.prepare("INSERT INTO sicar_proveedores(sucursal_id, prv_id, nombre, actualizado_en) VALUES (6, '1', 'Proveedor Uno', ?)").run(AL);
  compras.forEach(([id, cantidad], i) => {
    db.prepare(`INSERT INTO sicar_compras (sucursal_id, com_id, fecha, pro_id, folio, comentario, estado, total_centavos,
      primera_vez, actualizado_en) VALUES (6, ?, ?, '1', ?, '', 'vigente', 0, ?, ?)`)
      .run(id, `2026-09-2${i}T10:00:00`, `F-${id}`, AL, AL);
    db.prepare('INSERT INTO sicar_compras_detalle VALUES (6, ?, 0, ?, ?, 10000, 1000, 1160, 0)').run(id, 'art-6', cantidad);
  });
  return db;
}

/** Una punta de traspaso con precio de $10.00 sin IVA y $11.60 con IVA por pieza. */
function puntaF2(db, suc, folio, { origen = 's6', destino = 's1', fecha = '2026-10-20', estado = 'enviado', aplicada = null,
  cantidad = '20.0000', total = 0 } = {}) {
  db.prepare('INSERT INTO sicar_traspasos VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)')
    .run(suc, `${folio}-${suc}`, folio, origen, destino, fecha, estado, aplicada, total, AL);
  db.prepare('INSERT INTO sicar_traspasos_detalle VALUES (?, ?, ?, ?, 1000, 1160)').run(suc, `${folio}-${suc}`, `art-${suc}`, cantidad);
}

function recalcular(db, ahora = AL) {
  const servicio = require('./servicio');
  servicio.marcarPendientes(db, 6, ['art-6'], ahora);
  assert.deepEqual(servicio.procesarPendientes(db, { ahora }), { procesadas: 1, errores: [], quedan: 0 });
}
const camino = (db, q = {}) => require('./consultas').enCamino(db, q, AL);
const facturaDe = (db, id) => require('./consultas').listar(db, {}, AL).facturas.find(f => f.com_id === id);

test('en camino: envío 20 y recepción 18 deja 2 por aclarar con folio, fecha, tiendas, días y dinero; el cuadre sigue', t => {
  const db = escenarioCamino(t);
  puntaF2(db, 6, 'PARCIAL');
  puntaF2(db, 1, 'PARCIAL', { estado: 'recibido', aplicada: '2026-10-21', cantidad: '18.0000' });
  recalcular(db);
  const datos = JSON.parse(db.prepare('SELECT datos_json FROM seguimiento_resultado').get().datos_json);
  assert.deepEqual(datos.movimientos_abiertos, [{ tramo: 'por_aclarar', motivo: 'recepcion_menor', folio: 'PARCIAL',
    fecha_envio: '2026-10-20', origen: 6, destino: 1, sicar_origen: 's6', sicar_destino: 's1', piezas: '20000',
    centavos: '2000', centavos_con_iva: '2320' }]);
  assert.equal(Object.values(datos.dinero).reduce((a, v) => a + BigInt(v), 0n), 20000n, 'los tramos suman la factura');
  assert.deepEqual(datos.traspasos_sin_entender, []);
  const r = camino(db);
  assert.equal(r.total, 1);
  const [fila] = r.filas;
  assert.deepEqual({ tipo: fila.tipo, motivo: fila.motivo, com_id: fila.com_id, folio_factura: fila.folio_factura,
    proveedor: fila.proveedor, clave: fila.clave, folio: fila.folio, fecha_envio: fila.fecha_envio, origen: fila.origen,
    destino: fila.destino, dias: fila.dias, piezas: fila.piezas, centavos: fila.centavos, centavos_con_iva: fila.centavos_con_iva,
    alarma: fila.alarma }, { tipo: 'por_aclarar', motivo: 'recepcion_menor', com_id: 'C1', folio_factura: 'F-C1',
    proveedor: 'Proveedor Uno', clave: 'A', folio: 'PARCIAL', fecha_envio: '2026-10-20', origen: 6, destino: 1, dias: 16,
    piezas: '20000', centavos: '2000', centavos_con_iva: '2320', alarma: false });
  assert.deepEqual(r.totales.por_aclarar, { centavos: '2000', centavos_con_iva: '2320', filas: 1, sin_dinero: 0 });
  assert.equal(r.totales.transito.centavos, '0');
  assert.equal(r.totales.sin_entender.valor_sicar_centavos, '0');
  const f = facturaDe(db, 'C1');
  assert.equal(f.sin_entender, false);
  assert.equal(f.transito_alarma, false);
  assert.equal(f.revisar_traspasos, true, 'tiene piezas por aclarar');
});

test('en camino: tránsito de 8 días con alarma y de 6 sin ella; con la configuración en 3, los dos', t => {
  const db = escenarioCamino(t);
  puntaF2(db, 6, 'OCHO', { fecha: '2026-10-28', cantidad: '3.0000' });
  puntaF2(db, 6, 'SEIS', { fecha: '2026-10-30', cantidad: '5.0000' });
  recalcular(db);
  let r = camino(db);
  assert.equal(r.dias_transito_alarma, 7);
  assert.deepEqual(r.filas.map(f => [f.folio, f.tipo, f.dias, f.alarma, f.centavos]),
    [['SEIS', 'transito', 6, false, '5000'], ['OCHO', 'transito', 8, true, '3000']], 'orden: dinero y luego días');
  assert.equal(r.alarmas, 1);
  assert.deepEqual(r.totales.transito, { centavos: '8000', centavos_con_iva: '9280', filas: 2, sin_dinero: 0 });
  assert.deepEqual(camino(db, { solo_alarmas: '1' }).filas.map(f => f.folio), ['OCHO']);
  assert.equal(camino(db, { solo_alarmas: '1' }).totales.transito.centavos, '8000', 'los totales no dependen del filtro');
  assert.equal(facturaDe(db, 'C1').transito_alarma, true);
  assert.equal(facturaDe(db, 'C1').revisar_traspasos, true);
  db.exec("INSERT INTO seguimiento_config(clave, valor) VALUES ('dias_transito_alarma', '3')");
  r = camino(db);
  assert.deepEqual(r.filas.map(f => f.alarma), [true, true]);
  db.exec("UPDATE seguimiento_config SET valor='8'");
  assert.equal(camino(db).alarmas, 0, '8 días no es más de 8');
  assert.equal(facturaDe(db, 'C1').transito_alarma, false);
  assert.equal(facturaDe(db, 'C1').revisar_traspasos, false, 'tránsito joven, nada por aclarar');
  assert.deepEqual(camino(db, { por_pagina: '1', pagina: '2' }).filas.map(f => f.folio), ['OCHO']);
  for (const q of [{ pagina: '0' }, { por_pagina: '201' }, { pagina: 'x' }]) assert.throws(() => camino(db, q), e => e.status === 400);
});

test('en camino: traspaso entre tiendas en tránsito conserva origen, destino y la factura de CEDIS', t => {
  const db = escenarioCamino(t, [['C1', '5.0000']]);
  puntaF2(db, 6, 'IDA', { fecha: '2026-10-10', cantidad: '5.0000' });
  puntaF2(db, 1, 'IDA', { fecha: '2026-10-10', estado: 'recibido', aplicada: '2026-10-11', cantidad: '5.0000' });
  puntaF2(db, 1, 'TIENDAS', { origen: 's1', destino: 's2', fecha: '2026-11-01', cantidad: '3.0000' });
  recalcular(db);
  const r = camino(db);
  assert.deepEqual(r.filas.map(f => [f.tipo, f.folio, f.origen, f.destino, f.com_id, f.folio_factura, f.piezas, f.dias, f.centavos]),
    [['transito', 'TIENDAS', 1, 2, 'C1', 'F-C1', '30000', 4, '3000']]);
});

test('en camino: traspaso a una sucursal SICAR sin mapa no mueve piezas, marca las facturas y sale una sola vez', t => {
  const db = escenarioCamino(t, [['C1', '10.0000'], ['C2', '10.0000']]);
  puntaF2(db, 6, 'INNO', { destino: 's5', fecha: '2026-10-25', cantidad: '4.0000', total: 99900 });
  puntaF2(db, 6, 'ANULADO', { destino: 's5', fecha: '2026-10-26', estado: 'cancelado', cantidad: '9.0000', total: 500000 });
  recalcular(db);
  for (const fila of db.prepare('SELECT datos_json FROM seguimiento_resultado ORDER BY com_id').all()) {
    const datos = JSON.parse(fila.datos_json);
    assert.equal(datos.queda, '100000', 'no se mueven piezas a ciegas');
    assert.deepEqual(datos.movimientos_abiertos, []);
    assert.deepEqual(datos.traspasos_sin_entender, [{ motivo: 'sin_mapa', folio: 'INNO', fecha: '2026-10-25',
      sicar_origen: 's6', sicar_destino: 's5', piezas: '40000', valor_sicar_centavos: '4000', valor_sicar_con_iva_centavos: '4640' }]);
  }
  assert.equal(facturaDe(db, 'C1').sin_entender, true);
  assert.equal(facturaDe(db, 'C2').sin_entender, true);
  assert.equal(facturaDe(db, 'C2').revisar_traspasos, true);
  const r = camino(db);
  assert.equal(r.total, 1, 'una fila por traspaso, no una por factura');
  const [fila] = r.filas;
  assert.deepEqual(fila, { tipo: 'sin_entender', motivo: 'sin_mapa', com_id: null, folio_factura: null, proveedor: null, clave: 'A',
    folio: 'INNO', fecha_envio: '2026-10-25', origen: 6, destino: null, sicar_origen: 's6', sicar_destino: 's5', dias: 11,
    piezas: '40000', centavos: null, centavos_con_iva: null, valor_sicar_centavos: '4000', valor_sicar_con_iva_centavos: '4640',
    alarma: false, facturas: [{ com_id: 'C1', folio: 'F-C1', proveedor: 'Proveedor Uno' },
      { com_id: 'C2', folio: 'F-C2', proveedor: 'Proveedor Uno' }] });
  assert.deepEqual(r.totales.sin_entender, { valor_sicar_centavos: '4000', valor_sicar_con_iva_centavos: '4640', filas: 1 });
  assert.equal(r.totales.transito.centavos, '0', 'lo sin entender nunca se mezcla con el tránsito');
  assert.equal(r.totales.por_aclarar.centavos, '0');
  assert.deepEqual(require('./consultas').sicarSinAsignar(db), { sin_asignar: [{ sicar_sucursal: 's5', traspasos: 1,
    total_centavos: '99900' }], bajas: [] });
});

test('asignar el mapa deja pendiente la clave y, al recalcular, las piezas se mueven y sin_entender se apaga', t => {
  const db = escenarioCamino(t, [['C1', '10.0000']]);
  db.exec("DELETE FROM sicar_sucursales_mapa; INSERT INTO sicar_sucursales_mapa(sicar_sucursal, sucursal_id) VALUES ('6', 6), ('1', 1)");
  puntaF2(db, 6, 'INNO', { origen: '6', destino: '5', fecha: '2026-10-25', cantidad: '4.0000', total: 99900 });
  recalcular(db);
  assert.equal(facturaDe(db, 'C1').sin_entender, true);
  assert.equal(db.prepare('SELECT count(*) n FROM seguimiento_pendientes').get().n, 0);
  const { asignarMapaSicar } = require('../sicarTraspasos');
  asignarMapaSicar(db, { sicar_sucursal: '5', sucursal_id: 2 }, '77', { verTodas: true, sucursalId: null }, () => true);
  assert.deepEqual(db.prepare('SELECT clave FROM seguimiento_pendientes').all().map(f => f.clave), ['A']);
  assert.equal(facturaDe(db, 'C1').sin_entender, true, 'no se recalcula dentro de la petición');
  assert.deepEqual(require('./servicio').procesarPendientes(db, { ahora: AL }), { procesadas: 1, errores: [], quedan: 0 });
  const f = facturaDe(db, 'C1');
  assert.equal(f.sin_entender, false);
  assert.equal(f.piezas.queda, '60000');
  assert.equal(f.piezas.transito, '40000');
  assert.deepEqual(camino(db).filas.map(x => [x.tipo, x.folio, x.origen, x.destino]), [['transito', 'INNO', 6, 2]]);
  assert.deepEqual(require('./consultas').sicarSinAsignar(db), { sin_asignar: [], bajas: [] });
});

test('en camino: un resultado guardado con la versión anterior no rompe la pestaña ni la lista', t => {
  const db = escenarioCamino(t);
  puntaF2(db, 6, 'VIEJO', { fecha: '2026-10-20', cantidad: '3.0000' });
  recalcular(db);
  const fila = db.prepare('SELECT datos_json FROM seguimiento_resultado').get();
  const viejo = JSON.parse(fila.datos_json);
  delete viejo.movimientos_abiertos;
  delete viejo.traspasos_sin_entender;
  db.prepare('UPDATE seguimiento_resultado SET datos_json=?, version=2').run(JSON.stringify(viejo));
  assert.equal(camino(db).total, 0);
  const f = facturaDe(db, 'C1');
  assert.equal(f.sin_entender, false);
  assert.equal(f.transito_alarma, false);
  const servicio = require('./servicio');
  servicio.vueltaCompleta(db, AL);
  servicio.procesarPendientes(db, { ahora: AL });
  assert.equal(db.prepare('SELECT version FROM seguimiento_resultado').get().version, 3);
  assert.equal(camino(db).total, 1, 'la vuelta diaria lo recalcula solo');
});

test('bajas: lista abierta agrupada, ordenada y exacta; excluye recibidos y cancelados', t => {
  const db = escenarioCamino(t);
  db.exec(`INSERT INTO sicar_sucursales_mapa(sicar_sucursal, baja, nombre) VALUES ('3', 1, 'Cerrada'), ('7', 1, NULL)`);
  puntaF2(db, 6, 'ABIERTO', { destino: '3', fecha: '2026-10-25', total: 9007199254740993n });
  puntaF2(db, 1, 'ABIERTO', { destino: '3', fecha: '2026-10-25', total: 1 });
  puntaF2(db, 6, 'ANTES', { destino: '3', fecha: '2026-10-24', total: 7 });
  puntaF2(db, 6, 'RECIBIDO', { destino: '3', estado: 'recibido', total: 90 });
  puntaF2(db, 6, 'CANCELADO', { destino: '3', estado: 'cancelado', total: 100 });
  puntaF2(db, 6, 'DOS', { destino: '3', total: 200 });
  puntaF2(db, 1, 'DOS', { destino: '3', estado: 'recibido', total: 200 });
  const r = require('./consultas').sicarSinAsignar(db, '2026-11-05T18:00:00.000Z');
  assert.deepEqual(r.sin_asignar, []);
  assert.deepEqual(r.bajas, [{ sicar_sucursal: '3', nombre: 'Cerrada', total_centavos: '9007199254741000', envios: [
    { folio: 'ANTES', fecha: '2026-10-24', sicar_origen: 's6', sicar_destino: '3', origen: 6, destino: null, total_centavos: '7', dias: 12 },
    { folio: 'ABIERTO', fecha: '2026-10-25', sicar_origen: 's6', sicar_destino: '3', origen: 6, destino: null,
      total_centavos: '9007199254740993', dias: 11 },
  ] }, { sicar_sucursal: '7', nombre: null, envios: [], total_centavos: '0' }]);
});

test('baja marca pendientes y cambia el motivo sin atribuir piezas; repetir no recalcula', t => {
  const db = escenarioCamino(t, [['C1', '10.0000']]);
  puntaF2(db, 6, 'BAJA', { destino: '3', fecha: '2026-10-25', cantidad: '4.0000' });
  recalcular(db);
  const poner = () => require('../sicarTraspasos').asignarMapaSicar(db,
    { sicar_sucursal: '3', baja: true }, '77', { verTodas: true }, () => true);
  poner();
  assert.deepEqual(db.prepare('SELECT clave FROM seguimiento_pendientes').all(), [{ clave: 'A' }]);
  require('./servicio').procesarPendientes(db, { ahora: AL });
  const r = camino(db);
  assert.equal(r.total, 1);
  assert.equal(r.filas[0].motivo, 'sucursal_baja');
  assert.equal(facturaDe(db, 'C1').piezas.queda, '100000');
  poner();
  assert.equal(db.prepare('SELECT count(*) n FROM seguimiento_pendientes').get().n, 0);
});
