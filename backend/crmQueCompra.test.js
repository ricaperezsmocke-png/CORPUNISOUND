const { test } = require('node:test');
const assert = require('node:assert/strict');
const { preparar, ctx } = require('./crmCompraTestHelpers');

function detalleSicar(f, venta, { clave = ' G-1 ', descripcion = 'Guitarra vieja', cantidad = '2', importe = 30000, descuento = 0 } = {}) {
  f.sqlite.prepare(`INSERT INTO sicar_detalles(sucursal_id, ven_id, art_id, renglon, clave, descripcion,
    cantidad, precio_con, precio_sin, importe_centavos, descuento_centavos) VALUES (1,?,'1',0,?,?,?,'0','0',?,?)`)
    .run(venta, clave, descripcion, cantidad, importe, descuento);
}
test('categorías, artículos por SKU, importe neto y ajuste cuadran con ficha', t => {
  const f = preparar(t);
  f.DB['catalogo-productos'] = { categorias: [{ id: 3, nombre: 'Cuerdas' }],
    productos: [{ id: 7, sku: 'G-1', nombre: 'Guitarra', categoria_id: 3 }] };
  const id = f.pos(450, '2020-01-01');
  f.DB.pos.venta_detalle.push({ venta_id: id, producto_id: 7, cantidad: 1, subtotal: 500 });
  detalleSicar(f, f.sicar(30000), { descuento: 10000 });
  f.unir();
  assert.equal(typeof f.consultas.queCompra, 'function');
  const r = f.consultas.queCompra(ctx, 'crm:10');
  assert.deepEqual(r.categorias, [{ categoria_id: 3, nombre: 'Cuerdas', monto_centavos: 80000, piezas: 3 }]);
  assert.deepEqual(r.articulos, [{ clave: 'G-1', descripcion: 'Guitarra', piezas: 3, monto_centavos: 80000, ultima_fecha: ctx.hoyLocal }]);
  assert.equal(r.ajustes_centavos, -5000);
  assert.equal(r.total_centavos, f.consultas.ficha(ctx, 'crm:10').monto_centavos);
  assert.equal(r.categorias.reduce((n, c) => n + c.monto_centavos, r.ajustes_centavos), r.total_centavos);
});
test('rápidos, claves desconocidas y productos sin categoría; cantidades no finitas conservan importe', t => {
  const f = preparar(t);
  f.DB['catalogo-productos'].productos.push({ id: 7, nombre: 'Accesorio', sku: 'A' });
  const id = f.pos(100);
  f.DB.pos.venta_detalle.push({ venta_id: id, producto_id: 7, cantidad: 1, precio_unitario: 50 },
    { venta_id: id, descripcion: '  Rápido ', cantidad: 2, precio_unitario: 25 });
  detalleSicar(f, f.sicar(1000), { clave: null, descripcion: 'rápido', cantidad: 'NaN', importe: 1000 });
  detalleSicar(f, f.sicar(2000), { clave: 'desconocida', cantidad: 'Infinity', importe: 2000 });
  f.unir();
  assert.equal(typeof f.consultas.queCompra, 'function');
  const r = f.consultas.queCompra(ctx, 'crm:10');
  assert.deepEqual(r.categorias, [{ categoria_id: null, nombre: 'Sin categoría', monto_centavos: 13000, piezas: 3 }]);
  assert.equal(r.articulos.length, 3);
  assert.equal(r.articulos[0].monto_centavos, 6000);
  assert.equal(r.articulos[0].piezas, 2);
  assert.equal(r.ajustes_centavos, 0);
});
test('solo ventas vigentes, categorías por monto y top 20 artículos', t => {
  const f = preparar(t);
  f.DB['catalogo-productos'].categorias = [{ id: 1, nombre: 'Mayor' }, { id: 2, nombre: 'Menor' }];
  for (let i = 1; i <= 22; i++) {
    f.DB['catalogo-productos'].productos.push({ id: i, nombre: `Artículo ${i}`, categoria_id: i === 22 ? 1 : 2 });
    const id = f.pos(i === 22 ? 1000 : i);
    f.DB.pos.venta_detalle.push({ venta_id: id, producto_id: i, cantidad: 1, precio_unitario: i === 22 ? 1000 : i });
  }
  const cancelada = f.pos(9999, ctx.hoyLocal, 'cancelada');
  f.DB.pos.venta_detalle.push({ venta_id: cancelada, descripcion: 'No debe aparecer', cantidad: 1, subtotal: 9999 });
  detalleSicar(f, f.sicar(999999, ctx.hoyLocal, 'cancelada'));
  detalleSicar(f, f.sicar(999999, ctx.hoyLocal, 'excluida'));
  f.unir();
  assert.equal(typeof f.consultas.queCompra, 'function');
  const r = f.consultas.queCompra(ctx, 'crm:10');
  assert.deepEqual(r.categorias.map(c => c.nombre), ['Mayor', 'Menor']);
  assert.equal(r.articulos.length, 20);
  assert.equal(r.articulos[0].descripcion, 'Artículo 22');
  assert.equal(r.articulos.at(-1).descripcion, 'Artículo 3');
  assert.equal(r.ajustes_centavos, 0);
});
test('alcance idéntico a ficha; vacío cuadra; sin permiso SICAR solo POS', t => {
  const f = preparar(t);
  assert.equal(typeof f.consultas.queCompra, 'function');
  const local = { ...ctx, alcance: { verTodas: false, sucursalId: 1 }, filtroSucursal: 2 };
  assert.throws(() => f.consultas.queCompra(local, 'crm:20'), { status: 404 });
  assert.throws(() => f.consultas.queCompra(local, 'sicar:2:8'), { status: 404 });
  assert.deepEqual(f.consultas.queCompra(local, 'crm:10'), { categorias: [], articulos: [], ajustes_centavos: 0, total_centavos: 0 });
  detalleSicar(f, f.sicar(30000));
  f.unir();
  assert.equal(f.consultas.queCompra({ ...ctx, verSicar: false }, 'crm:10').total_centavos, 0);
});
