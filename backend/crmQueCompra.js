const normalizar = valor => String(valor || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
const claveDe = valor => String(valor || '').trim() || null;
const nombreDe = valor => String(valor || '').trim().replace(/\s+/g, ' ') || null;
const centavos = valor => Math.round(Number(valor || 0) * 100);
const SIN_DEPARTAMENTO = 'Sin departamento';
const SIN_CATEGORIA = 'Sin categoría';

function consultarQueCompra(DB, sqlite, persona) {
  const catalogo = DB['catalogo-productos'] || {};
  const productos = catalogo.productos || [];
  const porId = new Map(productos.map(p => [Number(p.id), p]));
  const porSku = new Map(productos.filter(p => claveDe(p.sku)).map(p => [claveDe(p.sku), p]));
  const categoriasCatalogo = new Map((catalogo.categorias || []).map(c => [Number(c.id), c]));
  const departamentosCatalogo = new Map((catalogo.departamentos || []).map(d => [Number(d.id), d]));
  // Departamento del producto propio; si no lo trae, el de su categoría.
  function clasificarProducto(producto) {
    if (!producto) return { departamento: null, categoria: null };
    const categoria = producto.categoria_id != null ? categoriasCatalogo.get(Number(producto.categoria_id)) : null;
    const depId = producto.departamento_id ?? categoria?.departamento_id;
    const departamento = depId != null ? departamentosCatalogo.get(Number(depId)) : null;
    return { departamento: nombreDe(departamento?.nombre), categoria: nombreDe(categoria?.nombre) };
  }
  const departamentos = new Map(), articulos = new Map();
  function agregar({ departamento, categoria, producto, clave, descripcion, cantidad, monto, fecha }) {
    const piezas = Number.isFinite(Number(cantidad)) ? Number(cantidad) : 0;
    const nombreDep = departamento || SIN_DEPARTAMENTO, nombreCat = categoria || SIN_CATEGORIA;
    const llaveDep = normalizar(nombreDep);
    if (!departamentos.has(llaveDep)) departamentos.set(llaveDep, { nombre: nombreDep, monto_centavos: 0, piezas: 0, categorias: new Map() });
    const d = departamentos.get(llaveDep);
    d.monto_centavos += monto;
    d.piezas += piezas;
    const llaveCat = normalizar(nombreCat);
    if (!d.categorias.has(llaveCat)) d.categorias.set(llaveCat, { nombre: nombreCat, monto_centavos: 0, piezas: 0 });
    const c = d.categorias.get(llaveCat);
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
      const producto = d.producto_id != null ? porId.get(Number(d.producto_id)) : null;
      agregar({ ...clasificarProducto(producto), producto, clave: null,
        descripcion: d.descripcion, cantidad: d.cantidad, monto: centavos(d.subtotal ?? d.cantidad * d.precio_unitario),
        fecha: String(venta.fecha).slice(0, 10) });
    }
  }
  if (sqlite && persona.identidades.length) {
    const detalles = sqlite.prepare(`SELECT d.clave, d.descripcion, d.cantidad, d.importe_centavos, v.fecha_local,
        a.clave AS art_clave, a.descripcion AS art_descripcion, a.categoria AS art_categoria, a.departamento AS art_departamento
      FROM sicar_detalles d JOIN sicar_ventas v ON v.sucursal_id=d.sucursal_id AND v.ven_id=d.ven_id
      LEFT JOIN sicar_articulos a ON a.sucursal_id=d.sucursal_id AND a.art_id=d.art_id
      WHERE v.sucursal_id=? AND v.cli_id=? AND v.estado='vigente' ORDER BY v.fecha_local, d.ven_id, d.renglon`);
    for (const identidad of persona.identidades) {
      for (const d of detalles.all(identidad.sucursal_id, identidad.cli_id)) {
        const clave = claveDe(d.clave) || claveDe(d.art_clave);
        const producto = porSku.get(clave);
        const deSicar = d.art_departamento || d.art_categoria;
        const clasificacion = deSicar ? { departamento: nombreDe(d.art_departamento), categoria: nombreDe(d.art_categoria) }
          : clasificarProducto(producto);
        // El producto propio con la misma clave sigue siendo el mismo artículo aunque SICAR lo clasifique.
        agregar({ ...clasificacion, producto, clave,
          descripcion: d.art_descripcion || d.descripcion, cantidad: d.cantidad, monto: d.importe_centavos,
          fecha: d.fecha_local.slice(0, 10) });
      }
    }
  }
  const porMonto = (a, b) => b.monto_centavos - a.monto_centavos;
  const listaDepartamentos = [...departamentos.values()].sort(porMonto)
    .map(d => ({ nombre: d.nombre, monto_centavos: d.monto_centavos, piezas: d.piezas, categorias: [...d.categorias.values()].sort(porMonto) }));
  return { departamentos: listaDepartamentos, articulos: [...articulos.values()].sort(porMonto).slice(0, 20),
    ajustes_centavos: persona.monto_centavos - listaDepartamentos.reduce((n, d) => n + d.monto_centavos, 0),
    total_centavos: persona.monto_centavos };
}
module.exports = { consultarQueCompra };
