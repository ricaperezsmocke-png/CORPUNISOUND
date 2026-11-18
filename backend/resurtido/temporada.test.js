const { test } = require('node:test');
const assert = require('node:assert/strict');
const { indicesTemporada, factorPara } = require('./temporada');

function historia(anios = [2022, 2023, 2024, 2025], grandes = false) {
  return new Map(Array.from({ length: 5 }, (_, clave) => [String(clave), new Map(anios.flatMap(anio =>
    Array.from({ length: 12 }, (_, i) => [
      `${anio}-${String(i + 1).padStart(2, '0')}`, (i === 9 ? 130 : 100) * (grandes && clave === 0 ? 100 : 1),
    ])))]));
}

test('octubre tiene índice 1.27 con años completos y cinco claves', () => {
  const r = indicesTemporada(historia(), '2026-11');
  assert.ok(Math.abs(r.indices[9] - 1.27) < 0.01);
  assert.equal(r.anios, 4);
  assert.equal(r.claves, 5);
  assert.equal(r.motivo, null);
});

test('una clave cien veces mayor mantiene el mismo peso estacional', () => {
  const r = indicesTemporada(historia([2024, 2025], true), '2026-11');
  assert.ok(Math.abs(r.indices[9] - 1.2682926829) < 1e-8);
  assert.deepEqual(r.indices, indicesTemporada(historia([2024, 2025]), '2026-11').indices);
});

test('mes sin venta se acota a 0.5 y picos a 1.5', () => {
  const h = historia();
  for (const meses of h.values()) for (const mes of meses.keys()) {
    if (mes.endsWith('-01')) meses.set(mes, 0);
    if (mes.endsWith('-10')) meses.set(mes, 10000);
  }
  const { indices } = indicesTemporada(h, '2026-11');
  assert.equal(indices[0], 0.5);
  assert.equal(indices[9], 1.5);
});

test('un año completo o menos de cinco claves devuelve índices planos con motivo', () => {
  const r = indicesTemporada(historia([2025]), '2026-11');
  assert.deepEqual(r.indices, Array(12).fill(1));
  assert.equal(r.anios, 1);
  assert.ok(r.motivo);
  const h = historia(); h.delete('0');
  assert.deepEqual(indicesTemporada(h, '2026-11').indices, Array(12).fill(1));
});

test('año en curso y años incompletos no entran', () => {
  const h = historia([2024, 2025, 2026]);
  for (const meses of h.values()) meses.delete('2024-01');
  const r = indicesTemporada(h, '2026-11');
  assert.equal(r.anios, 1);
  assert.deepEqual(r.indices, Array(12).fill(1));
});

test('factor promedia mes actual y siguiente, diciembre pasa a enero', () => {
  const indices = Array(12).fill(1); indices[9] = 1.3; indices[10] = 1.2; indices[11] = 1.4;
  assert.equal(factorPara(indices, 10), 1.25);
  assert.equal(factorPara(indices, 12), 1.2);
});
