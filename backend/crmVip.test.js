const { test } = require('node:test');
const assert = require('node:assert/strict');
const { preparar, ctx } = require('./crmCompraTestHelpers');

for (const [monto, vip] of [[20000, true], [19999.99, false]]) {
  test(`VIP POS con ${monto} devuelve ${vip}`, t => {
    const f = preparar(t);
    f.pos(monto);
    const ficha = f.consultas.ficha(ctx, 'crm:10');
    assert.equal(ficha.vip, vip);
    assert.equal(ficha.monto_12m_centavos, Math.round(monto * 100));
  });
}
test('ventana incluye día 365 y excluye 366 y canceladas en ambas fuentes', t => {
  const f = preparar(t);
  f.pos(100, '2025-10-15');
  f.pos(1000, '2025-10-14');
  f.pos(1000, ctx.hoyLocal, 'cancelada');
  f.sicar(1990000, '2025-10-15T00:00:00');
  f.sicar(8000000, '2025-10-14T23:59:59');
  f.sicar(8000000, ctx.hoyLocal, 'cancelada');
  f.sicar(8000000, ctx.hoyLocal, 'excluida');
  f.unir();
  assert.equal(f.consultas.ficha(ctx, 'crm:10').monto_12m_centavos, 2000000);
  assert.equal(f.consultas.ficha(ctx, 'crm:10').vip, true);
});
test('sin hoy de prueba usa fechaLocal de México', t => {
  const fechas = require('./fechas');
  t.mock.method(fechas, 'fechaLocal', () => '2026-10-15');
  const f = preparar(t);
  f.pos(20000, '2025-10-15');
  assert.equal(f.consultas.ficha({ ...ctx, hoyLocal: undefined }, 'crm:10').vip, true);
});
test('interna nativa con un millón sigue visible pero no es VIP ni suma totales', t => {
  const f = preparar(t);
  f.pos(1000000);
  f.pos(50, ctx.hoyLocal, 'cerrada', 20);
  f.sicar(20000, ctx.hoyLocal, 'vigente', 2, '8');
  f.unir(2, '8');
  f.DB.crm.clientes[0].cuenta_interna = { motivo: 'Tienda', usuario_id: 7, fecha_hora: 'hoy' };
  const lista = f.consultas.listar(ctx);
  const ana = lista.items.find(p => p.ref === 'crm:10');
  assert.equal(ana.vip, false);
  assert.equal(ana.cuenta_interna.motivo, 'Tienda');
  assert.deepEqual(lista.totales, { clientes: 2, compradores: 1, monto_centavos: 5000,
    monto_pos_centavos: 5000, monto_sicar_centavos: 0 });
  assert.deepEqual(f.consultas.resumen(ctx).sucursales.map(s => [s.clientes, s.convertidos, s.monto_pos_centavos, s.monto_sicar_centavos]),
    [[1, 0, 0, 0], [1, 1, 5000, 0]]);
});
test('interna SICAR no suma y unida hereda exclusivamente la marca del nativo', t => {
  const f = preparar(t);
  f.sicar(100000000);
  f.repo.guardarCuentaInterna({ sucursal_id: 1, cli_id: '9', interna: true, motivo: 'Tienda', usuario_id: 7, fecha_hora: 'hoy' });
  assert.equal(f.consultas.ficha(ctx, 'sicar:1:9').vip, false);
  assert.equal(f.consultas.listar(ctx).totales.monto_centavos, 0);
  assert.equal(f.consultas.resumen(ctx).sucursales[0].monto_sicar_centavos, 0);
  f.unir();
  assert.equal(f.consultas.ficha(ctx, 'crm:10').vip, true);
  assert.equal(f.consultas.ficha(ctx, 'crm:10').cuenta_interna, null);
});
test('VIP se combina con búsqueda, estado y tienda; no incluye internas', t => {
  const f = preparar(t);
  f.pos(20000);
  f.pos(30000, ctx.hoyLocal, 'cerrada', 20);
  f.DB.crm.clientes[1].cuenta_interna = { motivo: 'Tienda' };
  f.DB.crm.clientes[0].estado = 'interesado';
  assert.deepEqual(f.consultas.listar(ctx, { vip: '1', buscar: 'ana', estado: 'interesado' }).items.map(p => p.ref), ['crm:10']);
  assert.equal(f.consultas.listar({ ...ctx, filtroSucursal: 2 }, { vip: '1' }).items.length, 0);
});
test('VIP rechaza todo valor distinto del texto 1 o ausente', t => {
  const f = preparar(t);
  for (const vip of ['si', '', '0', 1, true, null, ['1'], {}]) {
    assert.throws(() => f.consultas.listar(ctx, { vip }), { status: 400 });
  }
});
test('sin permiso SICAR ni alcance de otra tienda sus ventas no suman VIP', t => {
  const f = preparar(t);
  f.sicar(2000000, ctx.hoyLocal, 'vigente', 2, '8');
  f.unir(2, '8');
  assert.equal(f.consultas.ficha({ ...ctx, verSicar: false }, 'crm:10').vip, false);
  assert.equal(f.consultas.ficha({ ...ctx, alcance: { verTodas: false, sucursalId: 1 } }, 'crm:10').vip, false);
});
