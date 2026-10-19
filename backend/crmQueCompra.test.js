const { test } = require('node:test');
const assert = require('node:assert/strict');
const { preparar, ctx } = require('./crmCompraTestHelpers');

function detalleSicar(f, venta, opciones = {}) {
  const { art_id = '1', clave = ' G-1 ', descripcion = 'Guitarra vieja', cantidad = '2', importe = 30000,
    descuento = 0 } = opciones;
  f.sqlite.prepare(`INSERT INTO sicar_detalles(sucursal_id, ven_id, art_id, renglon, clave, descripcion,
    cantidad, precio_con, precio_sin, importe_centavos, descuento_centavos) VALUES (1,?,?,0,?,?,?,'0','0',?,?)`)
    .run(venta, art_id, clave, descripcion, cantidad, importe, descuento);
}

function articuloSicar(f, opciones = {}) {
  const { art_id = '1', clave = 'G-1', descripcion = 'Guitarra SICAR', categoria = 'Cuerdas',
    departamento = 'Instrumentos' } = opciones;
  f.sqlite.prepare(`INSERT INTO sicar_articulos
    (sucursal_id, art_id, clave, descripcion, categoria, departamento, actualizado_en)
    VALUES (1,?,?,?,?,?, 'hoy')`).run(art_id, clave, descripcion, categoria, departamento);
}

test('renglon SICAR usa articulo de tienda, conserva su descripcion y cuadra departamentos', t => {
  const f = preparar(t);
  articuloSicar(f, { descripcion: 'Guitarra desde SICAR', categoria: 'Cuerdas', departamento: 'Instrumentos' });
  detalleSicar(f, f.sicar(30000));
  f.unir();

  const r = f.consultas.queCompra(ctx, 'crm:10');

  assert.deepEqual(r.departamentos, [{ nombre: 'Instrumentos', monto_centavos: 30000, piezas: 2,
    categorias: [{ nombre: 'Cuerdas', monto_centavos: 30000, piezas: 2 }] }]);
  assert.deepEqual(r.articulos, [{ clave: 'G-1', descripcion: 'Guitarra desde SICAR', piezas: 2,
    monto_centavos: 30000, ultima_fecha: ctx.hoyLocal }]);
  assert.equal(r.ajustes_centavos, 0);
  assert.equal(r.total_centavos, 30000);
});

test('SICAR cae al catalogo por SKU, normaliza nombres y usa ambos nombres de respaldo', t => {
  const f = preparar(t);
  f.DB['catalogo-productos'] = {
    departamentos: [{ id: 2, nombre: 'Áudio' }],
    categorias: [{ id: 3, nombre: ' Bafles ' }],
    productos: [{ id: 7, sku: 'G-1', nombre: 'Desde catálogo', categoria_id: 3, departamento_id: 2 }],
  };
  detalleSicar(f, f.sicar(10000), { art_id: '1', importe: 10000 });
  articuloSicar(f, { art_id: '2', clave: 'G-2', categoria: 'bafles', departamento: 'AUDIO' });
  detalleSicar(f, f.sicar(20000), { art_id: '2', clave: 'G-2', importe: 20000 });
  detalleSicar(f, f.sicar(30000), { art_id: '3', clave: null, descripcion: 'Sin ficha' });
  f.unir();

  const r = f.consultas.queCompra(ctx, 'crm:10');

  assert.deepEqual(r.departamentos, [
    { nombre: 'Áudio', monto_centavos: 30000, piezas: 4,
      categorias: [{ nombre: 'Bafles', monto_centavos: 30000, piezas: 4 }] },
    { nombre: 'Sin departamento', monto_centavos: 30000, piezas: 2,
      categorias: [{ nombre: 'Sin categoría', monto_centavos: 30000, piezas: 2 }] },
  ]);
  assert.equal(r.articulos.find(a => a.clave === 'G-1').descripcion, 'Desde catálogo');
  assert.equal(r.ajustes_centavos, 0);
});

test('POS toma departamento y categoria del catalogo y los ajustes conservan el total', t => {
  const f = preparar(t);
  f.DB['catalogo-productos'] = {
    departamentos: [{ id: 4, nombre: 'Accesorios' }],
    categorias: [{ id: 5, nombre: 'Cables' }],
    productos: [{ id: 6, sku: 'C-1', nombre: 'Cable', categoria_id: 5, departamento_id: 4 }],
  };
  const id = f.pos(450, '2020-01-01');
  f.DB.pos.venta_detalle.push({ venta_id: id, producto_id: 6, cantidad: 1, subtotal: 500 });
  f.unir();

  const r = f.consultas.queCompra(ctx, 'crm:10');

  assert.deepEqual(r.departamentos, [{ nombre: 'Accesorios', monto_centavos: 50000, piezas: 1,
    categorias: [{ nombre: 'Cables', monto_centavos: 50000, piezas: 1 }] }]);
  assert.equal(r.ajustes_centavos, -5000);
  assert.equal(r.departamentos.reduce((n, d) => n + d.monto_centavos, r.ajustes_centavos), r.total_centavos);
  assert.ok(r.departamentos.every(d => d.categorias.reduce((n, c) => n + c.monto_centavos, 0) === d.monto_centavos));
});

test('solo ventas vigentes, departamentos por monto y top 20 articulos', t => {
  const f = preparar(t);
  f.DB['catalogo-productos'] = {
    departamentos: [{ id: 1, nombre: 'Mayor' }, { id: 2, nombre: 'Menor' }],
    categorias: [{ id: 1, nombre: 'Mayor', departamento_id: 1 }, { id: 2, nombre: 'Menor', departamento_id: 2 }],
    productos: [],
  };
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

  const r = f.consultas.queCompra(ctx, 'crm:10');

  assert.deepEqual(r.departamentos.map(d => d.nombre), ['Mayor', 'Menor']);
  assert.equal(r.articulos.length, 20);
  assert.equal(r.articulos[0].descripcion, 'Artículo 22');
  assert.equal(r.articulos.at(-1).descripcion, 'Artículo 3');
  assert.equal(r.ajustes_centavos, 0);
});

test('alcance identico a ficha; vacio devuelve departamentos y sin permiso SICAR deja solo POS', t => {
  const f = preparar(t);
  const local = { ...ctx, alcance: { verTodas: false, sucursalId: 1 }, filtroSucursal: 2 };
  assert.throws(() => f.consultas.queCompra(local, 'crm:20'), { status: 404 });
  assert.throws(() => f.consultas.queCompra(local, 'sicar:2:8'), { status: 404 });
  assert.deepEqual(f.consultas.queCompra(local, 'crm:10'), {
    departamentos: [], articulos: [], ajustes_centavos: 0, total_centavos: 0,
  });
  detalleSicar(f, f.sicar(30000));
  f.unir();
  assert.equal(f.consultas.queCompra({ ...ctx, verSicar: false }, 'crm:10').total_centavos, 0);
});
