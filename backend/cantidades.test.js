const test = require('node:test');
const assert = require('node:assert/strict');

test('aDiezmilesimas conserva conversion exacta BigInt y comportamiento previo', () => {
  const { aDiezmilesimas } = require('./cantidades');
  for (const [entrada, esperado] of [
    ['36', 360000n], ['12.3400', 123400n], ['-0.0001', -1n], ['-0.0000', 0n],
    ['9007199254740993.1234', 90071992547409931234n], [2, 20000n],
    ['1.00001', 0n], ['abc', 0n], [null, 0n], [undefined, 0n], ['', 0n], ['+1', 0n],
  ]) assert.equal(aDiezmilesimas(entrada), esperado);
});
