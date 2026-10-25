const { test } = require('node:test');
const assert = require('node:assert/strict');
const { decimal, cliente, venta, sobre, cabe, esHorarioHistorico } = require('./formato');
const c = { cli_id: '42', nombre: 'José Peña', mail: 'j@example.test' };
const d = { art_id: '8', clave: null, descripcion: 'Guitarra', cantidad: '1',
  precioCon: '1500', precioSin: '1293.1034', importeCon: '1500', descTotal: '0' };
const v = { ven_id: '9007199254740993', cli_id: '42', fecha: '2026-10-14 10:00:00', status: 1, total: '1500' };
test('formatea decimales con texto exacto y rechaza números o pérdida de precisión', () => {
  assert.equal(decimal('1500', 2), '1500.00');
  assert.equal(decimal('0.1000', 2), '0.10');
  assert.equal(decimal('1293.1034', 4), '1293.1034');
  for (const valor of [0.1 + 0.2, '1.001', '-1', '1e2', null]) assert.throws(() => decimal(valor, 2));
});
test('excluye todos los públicos y clientes sin nombre, sin excluir RFC genérico', () => {
  for (const cli_id of ['1', '2', '3', '13', '21', '33', '4566', '4567', '4572']) {
    assert.equal(cliente({ ...c, cli_id }), null);
  }
  assert.equal(cliente({ ...c, nombre: 'PÚBLICO EN GENERAL 2' }), null);
  assert.equal(cliente({ ...c, nombre: '  ' }), null);
  assert.deepEqual(cliente({ ...c, rfc: 'XAXX010101000', huella: 'secreto' }), {
    cli_id: '42', nombre: 'José Peña', telefono: null, celular: null, email: 'j@example.test', rfc: 'XAXX010101000',
  });
});
test('conserva total, ids grandes y cada renglón repetido en orden', () => {
  const salida = venta(v, c, [d, { ...d, descripcion: 'Segundo' }], false);
  assert.equal(salida.ven_id, '9007199254740993');
  assert.equal(salida.total, '1500.00');
  assert.equal(salida.fecha_local, '2026-10-14T10:00:00');
  assert.deepEqual(salida.detalle.map(x => x.descripcion), ['Guitarra', 'Segundo']);
  assert.equal(salida.detalle[0].precio_sin, '1293.1034');
});
test('cancelación lleva detalle; cambio a público genera tombstone solo si ya fue enviada', () => {
  assert.equal(venta({ ...v, status: -1 }, c, [d], true).estado, 'cancelada');
  assert.deepEqual(venta(v, { ...c, cli_id: '1' }, [], true), { ven_id: '9007199254740993', estado: 'excluida' });
  assert.equal(venta(v, { ...c, cli_id: '1' }, [], false), null);
  assert.throws(() => venta({ ...v, status: 0 }, c, [d], false));
});
test('aplica límites de entidades, renglones y bytes sin truncar ventas', () => {
  const lote = sobre('1', 'historico', new Date('2026-10-15T03:00:00Z'));
  lote.clientes = Array.from({ length: 100 }, () => cliente(c));
  assert.equal(cabe(lote), true);
  lote.clientes.push(cliente(c));
  assert.equal(cabe(lote), false);
  lote.clientes = [];
  lote.ventas = Array.from({ length: 101 }, () => ({ ven_id: '4', estado: 'excluida' }));
  assert.equal(cabe(lote), false);
  const normal = venta(v, c, [d], false);
  lote.ventas = [{ ...normal, detalle: Array(501).fill(normal.detalle[0]) }];
  assert.equal(cabe(lote), false);
  lote.ventas = Array.from({ length: 3 }, () => ({ ...normal, detalle: Array(400).fill(normal.detalle[0]) }));
  assert.equal(cabe(lote), false);
  lote.ventas = [];
  lote.clientes = [{ cli_id: '42', nombre: 'ñ'.repeat(600000) }];
  assert.equal(cabe(lote), false);
});
test('histórica únicamente desde 20:00 inclusive hasta 07:00 exclusiva en tienda', () => {
  for (const [hora, esperado] of [['01:59:59', false], ['02:00:00', true], ['12:59:59', true], ['13:00:00', false]]) {
    assert.equal(esHorarioHistorico(new Date(`2026-10-15T${hora}Z`)), esperado);
  }
});

test('articulo seguro recorta vacios a null y omite los que no cumplen el contrato', () => {
  const { articuloSeguro } = require('./formato');
  assert.deepEqual(articuloSeguro({ art_id: 8, clave: ' JLX ', descripcion: ' Bafle ', categoria: '', departamento: null }).articulo,
    { art_id: '8', clave: 'JLX', descripcion: 'Bafle', categoria: null, departamento: null });
  for (const [raro, codigo] of [[{ descripcion: '  ' }, 'TEXTO_VACIO'], [{ categoria: 'x'.repeat(101) }, 'TEXTO_INVALIDO'],
    [{ departamento: 'Au\u0001dio' }, 'TEXTO_INVALIDO'], [{ clave: 'c'.repeat(101) }, 'TEXTO_INVALIDO']]) {
    const r = articuloSeguro({ art_id: '9', clave: 'A', descripcion: 'Bafle', categoria: 'B', departamento: 'C', ...raro });
    assert.deepEqual(r, { articulo: null, omitido: { art_id: '9', codigo } });
  }
  assert.throws(() => articuloSeguro({ art_id: 'x', descripcion: 'Bafle' }), /ID_INVALIDO/);
});
test('articulo con relleno de espacios de SICAR cabe una vez recortado', () => {
  const { articuloSeguro } = require('./formato');
  const r = articuloSeguro({ art_id: '9', clave: 'A' + ' '.repeat(150), descripcion: 'Bafle' + ' '.repeat(600), categoria: 'Bafles' + ' '.repeat(200) });
  assert.deepEqual(r.articulo, { art_id: '9', clave: 'A', descripcion: 'Bafle', categoria: 'Bafles', departamento: null });
});
test('proveedor seguro recorta el relleno de SICAR y omite los que no cumplen el contrato', () => {
  const { proveedorSeguro } = require('./formato');
  assert.deepEqual(proveedorSeguro({ prv_id: 7, nombre: ' Casa Veerkamp' + ' '.repeat(300) }),
    { proveedor: { prv_id: '7', nombre: 'Casa Veerkamp' }, omitido: null });
  for (const [nombre, codigo] of [['  ', 'TEXTO_VACIO'], [null, 'TEXTO_VACIO'], ['x'.repeat(251), 'TEXTO_INVALIDO'], ['Ca\u0001sa', 'TEXTO_INVALIDO']]) {
    assert.deepEqual(proveedorSeguro({ prv_id: '9', nombre }), { proveedor: null, omitido: { prv_id: '9', codigo } });
  }
  assert.throws(() => proveedorSeguro({ prv_id: 'x', nombre: 'Casa' }), /ID_INVALIDO/);
});
test('existencia segura conserva el signo, normaliza a 4 decimales y omite lo que el contrato no acepta', () => {
  const { existenciaSegura } = require('./formato');
  for (const [entrada, salida] of [['3.0000', '3.0000'], ['-1.0000', '-1.0000'], ['-0.0000', '0.0000'], ['3', '3.0000'],
    ['-2.5', '-2.5000'], ['0', '0.0000']]) {
    assert.deepEqual(existenciaSegura({ art_id: '7', existencia: entrada }), { existencia: { art_id: '7', existencia: salida }, omitido: null });
  }
  for (const [entrada, codigo] of [['3.12345', 'PRECISION_NO_PACTADA'], [3, 'DECIMAL_INVALIDO'], [null, 'DECIMAL_INVALIDO'],
    ['--1', 'DECIMAL_INVALIDO'], ['+1', 'DECIMAL_INVALIDO'], ['-', 'DECIMAL_INVALIDO']]) {
    assert.deepEqual(existenciaSegura({ art_id: 7, existencia: entrada }), { existencia: null, omitido: { art_id: '7', codigo } });
  }
  assert.throws(() => existenciaSegura({ art_id: 'x', existencia: '1.0000' }), /ID_INVALIDO/);
});
test('un lote cabe con hasta 500 existencias', () => {
  const lote = sobre('1', 'incremental', new Date('2026-10-15T03:00:00Z'));
  lote.existencias = Array.from({ length: 500 }, (_, i) => ({ art_id: String(i + 1), existencia: '1.0000' }));
  assert.equal(cabe(lote), true);
  lote.existencias.push({ art_id: '501', existencia: null });
  assert.equal(cabe(lote), false);
});

// Cortes de caja: corte real de Ocosingo (cor 8006). Los importes llegan como texto (decimalNumbers: false).
const { corteSeguro } = require('./formato');
const { validarLoteSicar } = require('../backend/sicarIngesta');
const corte8006 = { cor_id: '8006', fecha: '2026-10-22 20:41:07', contado: '18242.59', calculado: '18242.590000', diferencia: '0.00',
  retiro: '18242.59', caj_id: '1' };
const pago = (tpa_id, monto = '0.00', retiro = monto) => ({ cor_id: '8006', tpa_id, contado: monto, calculado: monto,
  diferencia: '0.00', retiro });
const pagos8006 = [pago('1', '12486.85'), pago('2'), pago('3'), pago('4', '5755.74'), pago('5'), pago('6'), pago('7')];
const venta8006 = (ven_id, usu_id, total, status) => ({ cor_id: '8006', ven_id, total, status, usu_id });
const ventas8006 = [venta8006('11', '52', '100.00', '1'), venta8006('12', '7', '50.50', '-1'), venta8006('13', '52', '100.00', 1),
  venta8006('14', '52', '100', '1')];
const cierre = [{ id: '8006', usu_id: '7' }];
test('corte real de Ocosingo: totales con signo, solo pagos con importe y cobros por usuario', () => {
  const { corte, omitido } = corteSeguro({ corte: corte8006, pagos: pagos8006, cajeros: cierre, ventas: ventas8006 });
  assert.equal(omitido, null);
  assert.deepEqual(corte, { cor_id: '8006', caj_id: '1', fecha_local: '2026-10-22T20:41:07', usu_id: '7',
    contado: '18242.59', calculado: '18242.59', diferencia: '0.00', retiro: '18242.59',
    pagos: [{ tpa_id: '1', contado: '12486.85', calculado: '12486.85', diferencia: '0.00', retiro: '12486.85' },
      { tpa_id: '4', contado: '5755.74', calculado: '5755.74', diferencia: '0.00', retiro: '5755.74' }],
    cobros: [{ usu_id: '52', ventas: 3, total: '300.00', canceladas: 0, total_canceladas: '0.00' },
      { usu_id: '7', ventas: 0, total: '0.00', canceladas: 1, total_canceladas: '50.50' }] });
  const lote = sobre('1', 'incremental', new Date('2026-10-23T03:00:00Z'));
  lote.cortes = [corte];
  assert.doesNotThrow(() => validarLoteSicar(lote), 'el servidor acepta la fila tal cual');
});
test('corte: venta sin alta en historial va con usu_id null; solo cuenta lo de su corte', () => {
  const ventas = [venta8006('11', null, '100.00', '1'), venta8006('12', '52', '20.00', '1'),
    { ...venta8006('99', '52', '1.00', '1'), cor_id: '8007' }];
  const { corte } = corteSeguro({ corte: corte8006, pagos: [], cajeros: cierre, ventas });
  assert.deepEqual(corte.cobros, [{ usu_id: '52', ventas: 1, total: '20.00', canceladas: 0, total_canceladas: '0.00' },
    { usu_id: null, ventas: 1, total: '100.00', canceladas: 0, total_canceladas: '0.00' }]);
  assert.deepEqual(corte.pagos, []);
});
test('corte: quien cerro sale de su unico renglon CorteCaja; con cero o dos renglones va null', () => {
  assert.equal(corteSeguro({ corte: corte8006, pagos: [], cajeros: [], ventas: [] }).corte.usu_id, null);
  assert.equal(corteSeguro({ corte: corte8006, pagos: [], cajeros: [...cierre, { id: '8006', usu_id: '52' }], ventas: [] }).corte.usu_id, null);
  assert.equal(corteSeguro({ corte: corte8006, pagos: [], cajeros: [{ id: '8005', usu_id: '52' }], ventas: [] }).corte.usu_id, null);
  assert.equal(corteSeguro({ corte: corte8006, pagos: [], cajeros: [{ id: 8006, usu_id: 52 }], ventas: [] }).corte.usu_id, '52');
});
test('corte: diferencia negativa se conserva tal cual la guardo SICAR; -0 va como 0.00', () => {
  const faltante = { ...corte8006, contado: '18242.26', diferencia: '-0.33' };
  const pagos = [{ ...pago('1', '12486.52'), calculado: '12486.85', diferencia: '-0.330000' }, pago('2', '-0.00')];
  const { corte } = corteSeguro({ corte: faltante, pagos, cajeros: cierre, ventas: [] });
  assert.equal(corte.diferencia, '-0.33');
  assert.equal(corte.contado, '18242.26');
  assert.deepEqual(corte.pagos, [{ tpa_id: '1', contado: '12486.52', calculado: '12486.85', diferencia: '-0.33', retiro: '12486.52' }]);
});
test('corte: una venta repetida por el JOIN cuenta una vez; con dos altas distintas va a null', () => {
  const ventas = [venta8006('11', '52', '100.00', '1'), venta8006('11', '52', '100.00', '1'),
    venta8006('12', '52', '10.00', '1'), venta8006('12', '7', '10.00', '1')];
  assert.deepEqual(corteSeguro({ corte: corte8006, pagos: [], cajeros: cierre, ventas }).corte.cobros, [
    { usu_id: '52', ventas: 1, total: '100.00', canceladas: 0, total_canceladas: '0.00' },
    { usu_id: null, ventas: 1, total: '10.00', canceladas: 0, total_canceladas: '0.00' }]);
});
test('corte: dato que el contrato no acepta se omite con su cor_id; un cor_id invalido detiene', () => {
  for (const [entrada, codigo] of [
    [{ corte: { ...corte8006, contado: '1.001' } }, 'PRECISION_NO_PACTADA'],
    [{ corte: { ...corte8006, retiro: null } }, 'DECIMAL_INVALIDO'],
    [{ corte: { ...corte8006, fecha: '0000-00-00 00:00:00' } }, 'FECHA_INVALIDA'],
    [{ corte: { ...corte8006, fecha: '2026-02-30 10:00:00' } }, 'FECHA_INVALIDA'],
    [{ corte: { ...corte8006, caj_id: '0' } }, 'ID_INVALIDO'],
    [{ ventas: [venta8006('11', '52', '100.00', '2')] }, 'ESTADO_VENTA_DESCONOCIDO'],
    [{ ventas: [venta8006('11', '52', 'x', '1')] }, 'DECIMAL_INVALIDO'],
    [{ pagos: [pago('1', '1.00'), pago('1', '2.00')] }, 'ID_INVALIDO'],
    [{ pagos: Array.from({ length: 9 }, (_, i) => pago(String(i + 1), '1.00')) }, 'DETALLE_FUERA_DE_LIMITE'],
  ]) {
    const datos = { corte: corte8006, pagos: [], cajeros: cierre, ventas: [], ...entrada };
    assert.deepEqual(corteSeguro(datos), { corte: null, omitido: { cor_id: '8006', codigo } }, codigo);
  }
  assert.throws(() => corteSeguro({ corte: { ...corte8006, cor_id: 'x' }, pagos: [], cajeros: [], ventas: [] }), /ID_INVALIDO/);
});
test('corte: usu_id invalido no omite el corte: quien cerro va null y la venta cuenta con usu_id null', () => {
  for (const raro of ['0', 'abc', '-3', 1.5]) {
    const { corte, omitido } = corteSeguro({ corte: corte8006, pagos: [], cajeros: [{ id: '8006', usu_id: raro }],
      ventas: [venta8006('11', raro, '100.00', '1'), venta8006('12', '52', '5.00', '-1')] });
    assert.equal(omitido, null, String(raro));
    assert.equal(corte.usu_id, null);
    assert.deepEqual(corte.cobros, [{ usu_id: '52', ventas: 0, total: '0.00', canceladas: 1, total_canceladas: '5.00' },
      { usu_id: null, ventas: 1, total: '100.00', canceladas: 0, total_canceladas: '0.00' }]);
  }
});
test('un lote cabe con hasta 100 cortes', () => {
  const lote = sobre('1', 'incremental', new Date('2026-10-15T03:00:00Z'));
  const { corte } = corteSeguro({ corte: corte8006, pagos: pagos8006, cajeros: cierre, ventas: ventas8006 });
  lote.cortes = Array.from({ length: 100 }, (_, i) => ({ ...corte, cor_id: String(i + 1) }));
  assert.equal(cabe(lote), true);
  lote.cortes.push({ ...corte, cor_id: '101' });
  assert.equal(cabe(lote), false);
});

// Ventas de público en general como mostrador (Cinco Caminos P1): sin cliente, nombre, teléfono, descripción ni clave.
const { ventaSegura } = require('./formato');
const publico = { cli_id: '1', nombre: 'PÚBLICO EN GENERAL', telefono: '9611234567' };
const vPublico = { ven_id: '77', cli_id: '1', fecha: '2025-03-14 10:00:00', status: 1, total: '1500' };
const dPublico = { ven_id: '77', art_id: '8', clave: 'GT-1', descripcion: 'Guitarra', cantidad: '1',
  precioCon: '1500', precioSin: '1293.1034', importeCon: '1500', descTotal: '25.5' };
const filaMostrador = { ven_id: '77', fecha_local: '2025-03-14T10:00:00', estado: 'vigente', total: '1500.00',
  detalle: [{ art_id: '8', cantidad: '1.0000', importe_con: '1500.00', descuento_total: '25.50' }] };
test('mostrador: venta de publico sale como fila de mostrador sin datos de persona ni del articulo', () => {
  const r = ventaSegura(vPublico, publico, [dPublico], false, undefined, { enviada: false });
  assert.deepEqual(r, { venta: null, omitida: null, mostrador: filaMostrador });
  const texto = JSON.stringify(r.mostrador);
  for (const prohibido of ['cli_id', 'nombre', 'telefono', 'descripcion', 'clave', 'precio_con', 'precio_sin', 'Guitarra', 'GT-1']) {
    assert.equal(texto.includes(prohibido), false, prohibido);
  }
  assert.doesNotThrow(() => validarLoteSicar({ ...sobre('1', 'incremental', new Date('2026-10-15T03:00:00Z')), mostrador: [r.mostrador] }));
  // Por nombre aunque el id no esté en la lista, y sin cliente en SICAR.
  const otro = ventaSegura({ ...vPublico, cli_id: '900' }, { cli_id: '900', nombre: 'Público en general Yajalón' }, [dPublico], false, undefined,
    { enviada: false });
  assert.deepEqual(otro.mostrador, filaMostrador);
  assert.deepEqual(ventaSegura({ ...vPublico, cli_id: null }, undefined, [dPublico], false, undefined, { enviada: false }).mostrador, filaMostrador);
});
test('mostrador: el nombre con espacios al inicio tambien es publico en general', () => {
  const r = ventaSegura({ ...vPublico, cli_id: '900' }, { cli_id: '900', nombre: ' PÚBLICO EN GENERAL' }, [dPublico], false, undefined,
    { enviada: false });
  assert.deepEqual(r.mostrador, filaMostrador);
  assert.equal(cliente({ ...c, nombre: '  PÚBLICO EN GENERAL 2' }), null);
});
test('mostrador: cancelada sale cancelada; sin renglones y ya enviada sale como cancelacion corta', () => {
  const r = ventaSegura({ ...vPublico, status: -1 }, publico, [dPublico], false, undefined, { enviada: false });
  assert.equal(r.mostrador.estado, 'cancelada');
  assert.deepEqual(ventaSegura({ ...vPublico, status: -1 }, publico, [], false, undefined, { enviada: true }),
    { venta: null, omitida: null, mostrador: { ven_id: '77', estado: 'cancelada' } });
  const nunca = ventaSegura({ ...vPublico, status: -1 }, publico, [], false, undefined, { enviada: false });
  assert.deepEqual(nunca, { venta: null, omitida: { ven_id: '77', codigo: 'DETALLE_FUERA_DE_LIMITE' }, mostrador: null });
  const rara = ventaSegura({ ...vPublico, total: '1.005' }, publico, [dPublico], false, undefined, { enviada: false });
  assert.deepEqual(rara, { venta: null, omitida: { ven_id: '77', codigo: 'PRECISION_NO_PACTADA' }, mostrador: null });
});
test('mostrador: venta de publico ya enviada como venta con cliente sale excluida y como mostrador', () => {
  const r = ventaSegura(vPublico, publico, [dPublico], true, undefined, { enviada: false });
  assert.deepEqual(r, { venta: { ven_id: '77', estado: 'excluida' }, omitida: null, mostrador: filaMostrador });
});
test('mostrador: venta de cliente normal no trae mostrador; sin el interruptor la salida es la de siempre', () => {
  const r = ventaSegura({ ...vPublico, cli_id: '42' }, c, [dPublico], false, undefined, { enviada: true });
  assert.equal(r.venta.cli_id, '42');
  assert.equal(r.mostrador, null);
  assert.deepEqual(ventaSegura(vPublico, publico, [dPublico], false), { venta: null, omitida: null });
  assert.deepEqual(ventaSegura(vPublico, publico, [dPublico], true), { venta: { ven_id: '77', estado: 'excluida' }, omitida: null });
});
test('un lote cabe con hasta 100 filas de mostrador y 1000 renglones de mostrador, aparte de los de ventas', () => {
  const renglon = filaMostrador.detalle[0];
  const lote = sobre('1', 'incremental', new Date('2026-10-15T03:00:00Z'));
  lote.mostrador = Array.from({ length: 100 }, (_, i) => ({ ...filaMostrador, ven_id: String(i + 1) }));
  assert.equal(cabe(lote), true);
  lote.mostrador.push({ ven_id: '101', estado: 'cancelada' });
  assert.equal(cabe(lote), false);
  lote.mostrador = [1, 2, 3].map(n => ({ ...filaMostrador, ven_id: String(n), detalle: Array(n === 3 ? 200 : 400).fill(renglon) }));
  lote.ventas = [{ ...venta(v, c, Array(400).fill(d)) }, { ...venta({ ...v, ven_id: '5' }, c, Array(400).fill(d)) }];
  assert.equal(cabe(lote), true, 'mil renglones de mostrador y 800 de ventas: el servidor los cuenta por separado');
  lote.mostrador[2].detalle.push(renglon);
  assert.equal(cabe(lote), false);
  lote.mostrador = [{ ...filaMostrador, detalle: Array(501).fill(renglon) }];
  assert.equal(cabe(lote), false);
});
test('fecha imposible (30 de febrero, 0000-00-00) es dato raro en venta de cliente y de publico, como en el servidor', () => {
  for (const fecha of ['2025-02-30 10:00:00', '0000-00-00 00:00:00']) {
    const deCliente = ventaSegura({ ...vPublico, cli_id: '42', fecha }, c, [dPublico], false, undefined, { enviada: false });
    assert.deepEqual(deCliente, { venta: null, omitida: { ven_id: '77', codigo: 'FECHA_INVALIDA' }, mostrador: null }, fecha);
    assert.deepEqual(ventaSegura({ ...vPublico, cli_id: '42', fecha }, c, [dPublico], true),
      { venta: { ven_id: '77', estado: 'excluida' }, omitida: { ven_id: '77', codigo: 'FECHA_INVALIDA' } }, fecha);
    const dePublico = ventaSegura({ ...vPublico, fecha }, publico, [dPublico], false, undefined, { enviada: false });
    assert.deepEqual(dePublico, { venta: null, omitida: { ven_id: '77', codigo: 'FECHA_INVALIDA' }, mostrador: null }, fecha);
  }
  assert.equal(ventaSegura({ ...vPublico, fecha: '2024-02-29 23:59:59' }, publico, [dPublico], false, undefined, { enviada: false })
    .mostrador.fecha_local, '2024-02-29T23:59:59', 'un 29 de febrero bisiesto si es fecha');
});
