const { test } = require('node:test');
const assert = require('node:assert/strict');
const { toparDemanda } = require('./demanda');
const { calcularMinMax } = require('./calculo');
const { VALORES_INICIALES } = require('./config');
const dias = Array.from({ length: 365 }, (_, i) => new Date(Date.UTC(2025, 0, 1) + i * 86400000).toISOString().slice(0, 10));
const normales = Array.from({ length: 72 }, (_, i) => ({ dia: dias[i * 5], cantidad: 10000 }));
const calcular = ventasPorDia => calcularMinMax({ ventasPorDia, diasEnCero: new Set(), desde: dias[0], hasta: dias[364],
  indices: Array(12).fill(1), mesCalculo: 11, config: VALORES_INICIALES });

test('ticket de 63 se limita una sola vez a 12 y el mínimo coincide con sustituirlo por ese tope', () => {
  const r = toparDemanda([...normales, { dia: dias[363], cantidad: 630000 }], new Set(), dias[0], dias[364]);
  assert.equal(r.piezasPedidoEspecial, 510000);
  const esperado = new Map(normales.map(f => [f.dia, f.cantidad])); esperado.set(dias[363], 120000);
  assert.deepEqual(calcular(r.ventasPorDia), calcular(esperado));
});

test('sin tickets grandes conserva exactamente la demanda y el cálculo', () => {
  const r = toparDemanda(normales, new Set(), dias[0], dias[364]);
  assert.equal(r.piezasPedidoEspecial, 0);
  assert.deepEqual(calcular(r.ventasPorDia), calcular(new Map(normales.map(f => [f.dia, f.cantidad]))));
});

test('tope usa días válidos con venta en cero, excluye fechas ajenas y respeta el piso de una pieza', () => {
  const r = toparDemanda([{ dia: dias[0], cantidad: 20000 }, { dia: '2024-12-31', cantidad: 990000 }],
    new Set(dias.slice(1)), dias[0], dias[364]);
  assert.equal(r.ventasPorDia.get(dias[0]), 20000);
  assert.equal(r.ventasPorDia.size, 1);
  const escaso = toparDemanda([{ dia: dias[0], cantidad: 20000 }], new Set(), dias[0], dias[364]);
  assert.equal(escaso.ventasPorDia.get(dias[0]), 10000);
  assert.equal(toparDemanda([], new Set(dias), dias[0], dias[364]).piezasPedidoEspecial, 0);
});
