const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ORIGENES, TIENDAS_APARTE, perteneceCadena } = require('./config');

test('orígenes y separación de cadenas definidos en un solo lugar', () => {
  assert.deepEqual(ORIGENES, [
    { sucursal_id: 6, nombre: 'CEDIS', traslada: true },
    { sucursal_id: 7, nombre: 'Innotec', traslada: false },
  ]);
  assert.ok(Object.isFrozen(ORIGENES));
  assert.deepEqual(TIENDAS_APARTE, [7]);
  assert.ok(Object.isFrozen(TIENDAS_APARTE));
  assert.equal(perteneceCadena(6, 1), true);
  assert.equal(perteneceCadena(6, 7), false);
  assert.equal(perteneceCadena(7, 7), true);
  assert.equal(perteneceCadena(7, 6), false);
});
