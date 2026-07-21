/**
 * reportes.js — Agregaciones de solo lectura para el módulo Reportes.
 *
 * Cada función recibe (DB, filtros, alcance) y filtra primero por sucursal
 * con filtrarPorSucursal (mismo patrón que ya usa compras.listarRecepciones)
 * antes de agregar — así ningún reporte se puede usar para ver datos fuera
 * del alcance de un usuario amarrado a una sucursal.
 */

const { filtrarPorSucursal } = require("./auth");

function redondear(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function enRango(fecha, desde, hasta) {
  if (desde && fecha < desde) return false;
  if (hasta && fecha > hasta) return false;
  return true;
}

function reporteVentas(DB, filtros, alcance) {
  const { fecha_inicio, fecha_fin, vendedor_id, cliente_id, tipo_documento } = filtros;
  let ventas = filtrarPorSucursal(DB.pos.ventas, alcance)
    .filter((v) => enRango(v.fecha, fecha_inicio, fecha_fin));
  if (vendedor_id) ventas = ventas.filter((v) => v.vendedor_id === Number(vendedor_id));
  if (cliente_id) ventas = ventas.filter((v) => v.cliente_id === Number(cliente_id));
  if (tipo_documento) ventas = ventas.filter((v) => (v.tipo_documento || "Ticket") === tipo_documento);

  const nombreCliente = (id) => (DB.crm.clientes.find((c) => c.id === id) || {}).nombre || "Público en General";
  const nombreVendedor = (id) => (DB.pos.vendedores.find((v) => v.id === id) || {}).nombre || "—";
  const nombreSucursal = (id) => (DB.pos.sucursales.find((s) => s.id === id) || {}).nombre || "—";

  const general = ventas.map((v) => ({
    id: v.id, fecha: v.fecha, sucursal_nombre: nombreSucursal(v.sucursal_id),
    cliente_nombre: nombreCliente(v.cliente_id), vendedor_nombre: nombreVendedor(v.vendedor_id),
    tipo_documento: v.tipo_documento || "Ticket", estatus: v.estatus, total: v.total,
  })).sort((a, b) => a.fecha.localeCompare(b.fecha));

  const vigentes = general.filter((f) => f.estatus !== "cancelada");
  const canceladas = general.filter((f) => f.estatus === "cancelada");

  const idsVigentes = new Set(vigentes.map((f) => f.id));
  const detalle = DB.pos.venta_detalle.filter((d) => idsVigentes.has(d.venta_id));

  const porArticuloMapa = new Map();
  detalle.forEach((d) => {
    const producto = DB["catalogo-productos"].productos.find((p) => p.id === d.producto_id);
    const nombre = d.descripcion || (producto ? producto.nombre : "Producto");
    const actual = porArticuloMapa.get(nombre) || { producto: nombre, cantidad: 0, importe: 0 };
    actual.cantidad += d.cantidad;
    actual.importe += d.subtotal;
    porArticuloMapa.set(nombre, actual);
  });
  const porArticulo = [...porArticuloMapa.values()]
    .map((f) => ({ ...f, importe: redondear(f.importe) }))
    .sort((a, b) => b.importe - a.importe);

  const porVendedorMapa = new Map();
  vigentes.forEach((f) => {
    const actual = porVendedorMapa.get(f.vendedor_nombre) || { vendedor: f.vendedor_nombre, numero_ventas: 0, total: 0 };
    actual.numero_ventas += 1;
    actual.total += f.total;
    porVendedorMapa.set(f.vendedor_nombre, actual);
  });
  const porVendedor = [...porVendedorMapa.values()]
    .map((f) => ({ ...f, total: redondear(f.total) }))
    .sort((a, b) => b.total - a.total);

  return {
    general, canceladas, porArticulo, porVendedor,
    totales: {
      numero_ventas: vigentes.length,
      total_vigente: redondear(vigentes.reduce((a, f) => a + f.total, 0)),
      total_cancelado: redondear(canceladas.reduce((a, f) => a + f.total, 0)),
    },
  };
}

function reporteUtilidad(DB, filtros, alcance) {
  const { fecha_inicio, fecha_fin, vendedor_id } = filtros;
  let ventas = filtrarPorSucursal(DB.pos.ventas, alcance)
    .filter((v) => v.estatus !== "cancelada")
    .filter((v) => enRango(v.fecha, fecha_inicio, fecha_fin));
  if (vendedor_id) ventas = ventas.filter((v) => v.vendedor_id === Number(vendedor_id));

  const idsVentas = new Set(ventas.map((v) => v.id));
  const detalle = DB.pos.venta_detalle.filter((d) => idsVentas.has(d.venta_id));

  let ventaTotal = 0, costoTotal = 0;
  const porArticuloMapa = new Map();
  const porDepartamentoMapa = new Map();

  detalle.forEach((d) => {
    const producto = DB["catalogo-productos"].productos.find((p) => p.id === d.producto_id);
    const costoUnitario = producto ? Number(producto.costo) || 0 : 0;
    const costoLinea = costoUnitario * d.cantidad;
    const ventaLinea = d.subtotal;
    ventaTotal += ventaLinea;
    costoTotal += costoLinea;

    const nombreArticulo = d.descripcion || (producto ? producto.nombre : "Producto");
    const filaArt = porArticuloMapa.get(nombreArticulo) || { producto: nombreArticulo, venta: 0, costo: 0 };
    filaArt.venta += ventaLinea; filaArt.costo += costoLinea;
    porArticuloMapa.set(nombreArticulo, filaArt);

    const departamento = producto && producto.departamento_id
      ? (DB["catalogo-productos"].departamentos.find((dep) => dep.id === producto.departamento_id) || {}).nombre
      : null;
    const nombreDepto = departamento || "Sin departamento";
    const filaDepto = porDepartamentoMapa.get(nombreDepto) || { departamento: nombreDepto, venta: 0, costo: 0 };
    filaDepto.venta += ventaLinea; filaDepto.costo += costoLinea;
    porDepartamentoMapa.set(nombreDepto, filaDepto);
  });

  const conUtilidad = (f) => ({ ...f, venta: redondear(f.venta), costo: redondear(f.costo), utilidad: redondear(f.venta - f.costo) });

  return {
    porArticulo: [...porArticuloMapa.values()].map(conUtilidad).sort((a, b) => b.utilidad - a.utilidad),
    porDepartamento: [...porDepartamentoMapa.values()].map(conUtilidad).sort((a, b) => b.utilidad - a.utilidad),
    totales: {
      venta: redondear(ventaTotal), costo: redondear(costoTotal), utilidad: redondear(ventaTotal - costoTotal),
      margen_pct: ventaTotal > 0 ? redondear(((ventaTotal - costoTotal) / ventaTotal) * 100) : 0,
    },
  };
}

function reporteCompras(DB, filtros, alcance) {
  const { fecha_inicio, fecha_fin, proveedor_id } = filtros;
  let compras = filtrarPorSucursal(DB.inventario.compras, alcance)
    .filter((c) => enRango(c.fecha.slice(0, 10), fecha_inicio, fecha_fin));
  if (proveedor_id) compras = compras.filter((c) => c.proveedor_id === Number(proveedor_id));

  const idsCompras = new Set(compras.map((c) => c.id));
  const detalle = DB.inventario.compra_detalle.filter((d) => idsCompras.has(d.compra_id));

  const nombreProveedor = (id) => (DB["catalogo-productos"].proveedores.find((p) => p.id === id) || {}).nombre || "—";
  const totalDeCompra = (compraId) => DB.inventario.compra_detalle
    .filter((d) => d.compra_id === compraId)
    .reduce((a, d) => a + d.costo * d.cantidad, 0);

  const general = compras.map((c) => ({
    id: c.id, fecha: c.fecha.slice(0, 10), proveedor_nombre: nombreProveedor(c.proveedor_id),
    factura: c.factura || "", total: redondear(totalDeCompra(c.id)),
  })).sort((a, b) => a.fecha.localeCompare(b.fecha));

  const porProveedorMapa = new Map();
  general.forEach((f) => {
    const actual = porProveedorMapa.get(f.proveedor_nombre) || { proveedor: f.proveedor_nombre, numero_compras: 0, total: 0 };
    actual.numero_compras += 1; actual.total += f.total;
    porProveedorMapa.set(f.proveedor_nombre, actual);
  });

  const porArticuloMapa = new Map();
  detalle.forEach((d) => {
    const producto = DB["catalogo-productos"].productos.find((p) => p.id === d.producto_id);
    const nombre = producto ? producto.nombre : "Producto";
    const actual = porArticuloMapa.get(nombre) || { producto: nombre, cantidad: 0, importe: 0 };
    actual.cantidad += d.cantidad; actual.importe += d.costo * d.cantidad;
    porArticuloMapa.set(nombre, actual);
  });

  return {
    general,
    porProveedor: [...porProveedorMapa.values()].map((f) => ({ ...f, total: redondear(f.total) })).sort((a, b) => b.total - a.total),
    porArticulo: [...porArticuloMapa.values()].map((f) => ({ ...f, importe: redondear(f.importe) })).sort((a, b) => b.importe - a.importe),
    totales: { numero_compras: general.length, total: redondear(general.reduce((a, f) => a + f.total, 0)) },
  };
}

function reporteCortesCaja(DB, filtros, alcance) {
  const { fecha_inicio, fecha_fin } = filtros;
  const cortes = filtrarPorSucursal(DB.pos.cortes_caja, alcance)
    .filter((c) => enRango(c.fecha, fecha_inicio, fecha_fin));

  const nombreSucursal = (id) => (DB.pos.sucursales.find((s) => s.id === id) || {}).nombre || "—";

  const filas = cortes.map((c) => ({
    id: c.id, fecha: c.fecha, sucursal_nombre: nombreSucursal(c.sucursal_id), usuario_nombre: c.usuario_nombre,
    total_calculado: c.total_calculado, total_contado: c.total_contado, total_diferencia: c.total_diferencia,
    total_retiro: c.total_retiro,
  })).sort((a, b) => a.fecha.localeCompare(b.fecha));

  return {
    filas,
    totales: {
      numero_cortes: filas.length,
      total_calculado: redondear(filas.reduce((a, f) => a + f.total_calculado, 0)),
      total_contado: redondear(filas.reduce((a, f) => a + f.total_contado, 0)),
      total_diferencia: redondear(filas.reduce((a, f) => a + f.total_diferencia, 0)),
      total_retiro: redondear(filas.reduce((a, f) => a + f.total_retiro, 0)),
    },
  };
}

function reporteExistencias(DB, filtros, alcance) {
  const { departamento_id, estado } = filtros;
  const sucursalesVisibles = alcance.verTodas
    ? DB.pos.sucursales.map((s) => s.id)
    : [alcance.sucursalId];

  const filas = DB["catalogo-productos"].productos
    .filter((p) => !departamento_id || p.departamento_id === Number(departamento_id))
    .map((p) => {
      const existenciasProducto = DB.inventario.existencias.filter(
        (e) => e.producto_id === p.id && sucursalesVisibles.includes(e.sucursal_id)
      );
      const cantidad = existenciasProducto.reduce((a, e) => a + (e.cantidad_actual || 0), 0);
      const minima = existenciasProducto.reduce((a, e) => a + (e.cantidad_minima || 0), 0);
      const maxima = existenciasProducto.reduce((a, e) => a + (e.cantidad_maxima || 0), 0);
      const departamento = DB["catalogo-productos"].departamentos.find((d) => d.id === p.departamento_id);
      const costo = Number(p.costo) || 0;
      const precioVenta = Number(p.precio_venta) || 0;
      return {
        producto_id: p.id, nombre: p.nombre, sku: p.sku,
        departamento_nombre: departamento ? departamento.nombre : "Sin departamento",
        cantidad, minima, maxima, costo, precio_venta: precioVenta,
        valor_a_costo: redondear(cantidad * costo),
        valor_a_precio_venta: redondear(cantidad * precioVenta),
      };
    })
    .filter((f) => {
      if (estado === "con_existencia") return f.cantidad > 0;
      if (estado === "sin_existencia") return f.cantidad <= 0;
      if (estado === "sobre_maximo") return f.maxima > 0 && f.cantidad > f.maxima;
      if (estado === "bajo_minimo") return f.minima > 0 && f.cantidad < f.minima;
      return true;
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre));

  const idsConMovimiento = new Set(DB.pos.venta_detalle.map((d) => d.producto_id));
  const sinMovimiento = filas.filter((f) => !idsConMovimiento.has(f.producto_id));

  return {
    filas, sinMovimiento,
    totales: {
      numero_articulos: filas.length,
      valor_a_costo: redondear(filas.reduce((a, f) => a + f.valor_a_costo, 0)),
      valor_a_precio_venta: redondear(filas.reduce((a, f) => a + f.valor_a_precio_venta, 0)),
    },
  };
}

function reporteEstadoCuentaClientes(DB, filtros, alcance) {
  const { cliente_id } = filtros;
  const clientes = filtrarPorSucursal(DB.crm.clientes.filter((c) => c.id !== 0), alcance);

  const filas = clientes.map((c) => ({
    id: c.id, clave: c.clave || "", nombre: c.nombre,
    limite_credito: Number(c.limite_credito) || 0, saldo: Number(c.saldo) || 0,
    credito_disponible: Math.max(0, (Number(c.limite_credito) || 0) - (Number(c.saldo) || 0)),
  })).sort((a, b) => a.nombre.localeCompare(b.nombre));

  let detalleCliente = null;
  if (cliente_id) {
    const ventasCredito = DB.pos.ventas
      .filter((v) => v.cliente_id === Number(cliente_id) && v.estatus !== "cancelada")
      .filter((v) => (v.metodo_pago || "").toUpperCase().startsWith("CR"))
      .map((v) => ({ id: v.id, fecha: v.fecha, total: v.total }))
      .sort((a, b) => a.fecha.localeCompare(b.fecha));
    detalleCliente = { cliente_id: Number(cliente_id), ventas_credito: ventasCredito };
  }

  return {
    filas, detalleCliente,
    totales: {
      numero_clientes: filas.length,
      saldo_total: redondear(filas.reduce((a, f) => a + f.saldo, 0)),
      limite_total: redondear(filas.reduce((a, f) => a + f.limite_credito, 0)),
    },
  };
}

module.exports = { redondear, enRango, reporteVentas, reporteUtilidad, reporteCompras, reporteCortesCaja, reporteExistencias, reporteEstadoCuentaClientes };
