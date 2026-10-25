const { test } = require('node:test');
const assert = require('node:assert/strict');
const { semanaDe, semanaAnterior, mismaSemanaAnio, ultimasSemanas, ultimaSemanaCompleta } = require('./semanas');

test('semanaDe: lunes a domingo, cualquier día cae en su semana', () => {
  assert.deepEqual(semanaDe('2026-10-24'), { lunes: '2026-10-19', domingo: '2026-10-25' });
  assert.deepEqual(semanaDe('2026-10-19'), { lunes: '2026-10-19', domingo: '2026-10-25' });
  assert.deepEqual(semanaDe('2026-10-25'), { lunes: '2026-10-19', domingo: '2026-10-25' });
  // Cruce de año y de mes.
  assert.deepEqual(semanaDe('2026-01-01'), { lunes: '2025-12-29', domingo: '2026-01-04' });
});

test('semanaDe rechaza fechas inválidas o mal escritas', () => {
  for (const malo of ['2026-02-30', '2026-13-01', '26-10-19', 'basura', '', null, undefined, '2026-10-19T00:00:00']) {
    assert.throws(() => semanaDe(malo), e => e.status === 400, String(malo));
  }
});

test('semana anterior, misma semana del año pasado y últimas semanas', () => {
  assert.equal(semanaAnterior('2026-10-19'), '2026-10-12');
  assert.equal(mismaSemanaAnio('2026-10-19'), '2025-10-20');
  assert.deepEqual(ultimasSemanas('2026-10-19', 3), ['2026-10-19', '2026-10-12', '2026-10-05']);
  assert.deepEqual(ultimasSemanas('2026-10-19', 0), []);
});

test('última semana completa: el domingo todavía no cerró la suya', () => {
  assert.equal(ultimaSemanaCompleta('2026-10-24'), '2026-10-12');
  assert.equal(ultimaSemanaCompleta('2026-10-25'), '2026-10-12');
  assert.equal(ultimaSemanaCompleta('2026-10-26'), '2026-10-19');
});
