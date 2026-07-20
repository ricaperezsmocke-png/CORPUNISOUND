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

module.exports = { redondear, enRango, reporteVentas };
