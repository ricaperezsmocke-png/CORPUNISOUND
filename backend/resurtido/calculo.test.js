const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calcularMinMax } = require('./calculo');
const { VALORES_INICIALES } = require('./config');
const dias = Array.from({ length: 365 }, (_, i) => new Date(Date.UTC(2025, 0, 1) + i * 86400000).toISOString().slice(0, 10));
function datos() {
  return { desde: '2025-01-01', hasta: '2025-12-31', indices: Array(12).fill(1), mesCalculo: 10,
    ventasPorDia: new Map(Array.from({ length: 73 }, (_, i) => [dias[Math.floor(i * 249 / 73)], 10000])),
    diasEnCero: new Set(dias.slice(249)), config: VALORES_INICIALES };
}

test('73 piezas en 249 días válidos: mínimo 10, máximo 19, sin diluir 116 días agotados', () => {
  const d = datos(), r = calcularMinMax(d);
  assert.equal(r.minimo, 100000); assert.equal(r.maximo, 190000);
  assert.equal(r.venta_diaria, 2932); assert.equal(r.dias_validos, 249); assert.equal(r.dias_en_cero, 116);
  assert.equal(r.lista, 'calculado');
  assert.ok(calcularMinMax({ ...d, diasEnCero: new Set() }).minimo < r.minimo);
});

test('temporada octubre/noviembre sube mínimo y máximo', () => {
  const d = datos(), plano = calcularMinMax(d); d.indices[9] = 1.3; d.indices[10] = 1.2;
  const alto = calcularMinMax(d);
  assert.ok(alto.minimo > plano.minimo); assert.ok(alto.maximo > plano.maximo);
});

test('sin venta: muchos agotados proponen 1/2; con existencia no se mueve', () => {
  const d = { ...datos(), ventasPorDia: new Map(), diasEnCero: new Set(dias.slice(0, 300)) };
  const r = calcularMinMax(d);
  assert.deepEqual([r.lista, r.minimo, r.maximo], ['sin_historia', 10000, 20000]);
  const quieto = calcularMinMax({ ...d, diasEnCero: new Set(dias.slice(0, 10)) });
  assert.deepEqual([quieto.lista, quieto.minimo, quieto.maximo], ['no_se_mueve', 0, 0]);
});

test('venta en día agotado lo hace válido; poca historia propone 1/2', () => {
  const r = calcularMinMax({ ...datos(), diasEnCero: new Set(dias), ventasPorDia: new Map([[dias[0], 10000]]) });
  assert.equal(r.dias_validos, 1); assert.equal(r.lista, 'sin_historia');
  assert.equal(r.minimo, 10000); assert.equal(r.maximo, 20000);
});

test('desestacionalizar antes de desviación: venta proporcional a índice tiene variación cero', () => {
  const r = calcularMinMax({ desde: '2025-01-01', hasta: '2025-02-28', mesCalculo: 12,
    indices: [0.5, 1.5, ...Array(10).fill(1)], diasEnCero: new Set(), config: VALORES_INICIALES,
    ventasPorDia: new Map(dias.slice(0, 59).map(d => [d, d.slice(5, 7) === '01' ? 10000 : 30000])),
  });
  assert.equal(r.minimo, 300000); assert.equal(r.maximo, 750000);
});

test('redondea una sola vez a piezas enteras y máximo supera mínimo', () => {
  const d = datos(); d.config = { ...d.config, plazo_dias: 1, ciclo_dias: 1, z_servicio_centesimas: 1 };
  const r = calcularMinMax(d);
  assert.equal(r.minimo, 10000); assert.equal(r.maximo, 20000);
  assert.equal(r.minimo % 10000, 0); assert.equal(r.maximo % 10000, 0);
});
