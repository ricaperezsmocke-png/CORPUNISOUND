const normalizar = valor => String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
const claveDe = valor => String(valor || '').trim() || null;
const centavos = valor => Math.round(Number(valor || 0) * 100);

function consultarQueCompra(DB, sqlite, persona) {
  const catalogo = DB['catalogo-productos'] || {};
  const productos = catalogo.productos || [];
  const porId = new Map(productos.map(p => [Number(p.id), p]));
  const porSku = new Map(productos.filter(p => claveDe(p.sku)).map(p => [claveDe(p.sku), p]));
  const categoriasCatalogo = new Map((catalogo.categorias || []).map(c => [Number(c.id), c]));
  const categorias = new Map(), articulos = new Map();
  function agregar({ producto, clave, descripcion, cantidad, monto, fecha }) {
    const categoria = producto?.categoria_id != null ? categoriasCatalogo.get(Number(producto.categoria_id)) : null;
    const categoriaId = categoria ? Number(categoria.id) : null;
    const piezas = Number.isFinite(Number(cantidad)) ? Number(cantidad) : 0;
    if (!categorias.has(categoriaId)) {
      categorias.set(categoriaId, { categoria_id: categoriaId, nombre: categoria?.nombre || 'Sin categoría', monto_centavos: 0, piezas: 0 });
    }
    const c = categorias.get(categoriaId);
    c.monto_centavos += monto;
    c.piezas += piezas;
    const sku = claveDe(producto?.sku) || clave;
    const identidad = producto ? `producto:${producto.id}` : sku ? `sku:${sku}` : `descripcion:${normalizar(descripcion)}`;
    if (!articulos.has(identidad)) {
      articulos.set(identidad, { clave: sku || null, descripcion: producto?.nombre || descripcion || 'Artículo sin descripción',
        piezas: 0, monto_centavos: 0, ultima_fecha: null });
    }
    const a = articulos.get(identidad);
    a.piezas += piezas;
    a.monto_centavos += monto;
    if (!a.ultima_fecha || fecha > a.ultima_fecha) a.ultima_fecha = fecha;
  }
  if (persona.cliente_id != null) {
    const ventas = new Map((DB.pos?.ventas || []).filter(v => Number(v.cliente_id) === persona.cliente_id && v.estatus === 'cerrada')
      .map(v => [Number(v.id), v]));
    for (const d of DB.pos?.venta_detalle || []) {
      const venta = ventas.get(Number(d.venta_id));
      if (!venta) continue;
      agregar({ producto: d.producto_id != null ? porId.get(Number(d.producto_id)) : null, clave: null,
        descripcion: d.descripcion, cantidad: d.cantidad, monto: centavos(d.subtotal ?? d.cantidad * d.precio_unitario),
        fecha: String(venta.fecha).slice(0, 10) });
    }
  }
  if (sqlite && persona.identidades.length) {
    const detalles = sqlite.prepare(`SELECT d.clave, d.descripcion, d.cantidad, d.importe_centavos, v.fecha_local
      FROM sicar_detalles d JOIN sicar_ventas v ON v.sucursal_id=d.sucursal_id AND v.ven_id=d.ven_id
      WHERE v.sucursal_id=? AND v.cli_id=? AND v.estado='vigente'`);
    for (const identidad of persona.identidades) {
      for (const d of detalles.all(identidad.sucursal_id, identidad.cli_id)) {
        const clave = claveDe(d.clave);
        agregar({ producto: porSku.get(clave), clave, descripcion: d.descripcion, cantidad: d.cantidad,
          monto: d.importe_centavos, fecha: d.fecha_local.slice(0, 10) });
      }
    }
  }
  const porMonto = (a, b) => b.monto_centavos - a.monto_centavos;
  const listaCategorias = [...categorias.values()].sort(porMonto);
  return { categorias: listaCategorias, articulos: [...articulos.values()].sort(porMonto).slice(0, 20),
    ajustes_centavos: persona.monto_centavos - listaCategorias.reduce((n, c) => n + c.monto_centavos, 0),
    total_centavos: persona.monto_centavos };
}
module.exports = { consultarQueCompra };
