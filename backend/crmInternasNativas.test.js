const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { preparar, ctx } = require('./crmCompraTestHelpers');
test('fallo persistiendo nativo conserva marca e historial previos en memoria', t => {
  const f = preparar(t);
  const ruta = path.join(__dirname, 'crmCuentasInternas.js');
  assert.ok(fs.existsSync(ruta), 'Falta servicio de cuentas internas');
  const { cambiarCuentaInterna } = require('./crmCuentasInternas');
  const antes = JSON.stringify(f.DB);
  assert.throws(() => cambiarCuentaInterna({ DB: f.DB, repo: f.repo, consultas: f.consultas,
    guardar() { throw new Error('Disco interrumpido'); } }, ctx, 'crm:10', { interna: true, motivo: 'Tienda' }, '7'), /Disco interrumpido/);
  assert.equal(JSON.stringify(f.DB), antes);
});
