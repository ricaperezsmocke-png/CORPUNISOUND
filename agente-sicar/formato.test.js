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
