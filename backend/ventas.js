/**
 * ventas.js — Registro real de las ventas cerradas en el Punto de Venta.
 *
 * Antes, cerrar una venta en el POS solo llamaba a "ajustar existencia"
 * por cada línea, sin dejar un registro de la venta en sí. Eso significaba
 * que "Consultas de Ventas" no tendría nada real que mostrar, y que el CRM
 * tampoco vería crecer el historial de compras de un cliente.
 *
 * Ahora: crearVenta() es el único lugar donde se cierra una venta — crea
 * el encabezado, el detalle, Y descuenta el inventario, todo junto. Así
 * el POS, el CRM y esta pantalla de consultas siempre ven los mismos datos.
 */

const { ajustarExistencia } = require("./productos");
const { obtenerConfiguracion } = require("./configuracion");

function siguienteId(lista) {
  return lista.length ? Math.max(...lista.map((x) => x.id)) + 1 : 1;
}

function crearVenta(DB, datos) {
  if (!Array.isArray(datos.lineas) || datos.lineas.length === 0) {
    throw new Error("La venta no tiene productos");
  }

  // No dejar vender más de lo que hay en existencia, a menos que la
  // configuración lo permita explícitamente ("Permitir Ventas de
  // Artículos Sin Existencia"). Se valida TODO antes de crear nada,
  // para no dejar una venta a medias si una línea falla.
  const config = obtenerConfiguracion(DB);
  if (!config.permitir_ventas_sin_existencia) {
    const sucursalId = Number(datos.sucursal_id) || 1;
    for (const l of datos.lineas) {
      if (!l.producto_id) continue; // productos rápidos no tienen existencia que validar
      const exist = DB.inventario.existencias.find((e) => e.producto_id === Number(l.producto_id) && e.sucursal_id === sucursalId);
      const disponible = exist ? exist.cantidad_actual : 0;
      const cantidadPedida = Number(l.cantidad) || 0;
      if (cantidadPedida > disponible) {
        const producto = DB["catalogo-productos"].productos.find((p) => p.id === Number(l.producto_id));
        throw new Error(`No hay existencia suficiente de "${producto?.nombre || "producto"}" (disponible: ${disponible}, solicitado: ${cantidadPedida})`);
      }
    }
  }

  const nuevoId = siguienteId(DB.pos.ventas);
  const venta = {
    id: nuevoId,
    fecha: new Date().toISOString().slice(0, 10),
    fecha_hora: new Date().toISOString(), // con hora — el corte de caja agrupa ventas por turno
    sucursal_id: Number(datos.sucursal_id) || 1,
    vendedor_id: datos.vendedor_id ? Number(datos.vendedor_id) : null,
    cliente_id: datos.cliente_id !== undefined && datos.cliente_id !== null ? Number(datos.cliente_id) : 0,
    tipo_documento: datos.tipo_documento || "Ticket",
    metodo_pago: datos.metodo_pago || "EFECTIVO",
    subtotal: Number(datos.subtotal) || 0,
    descuento: Number(datos.descuento) || 0,
    total: Number(datos.total) || 0,
    estatus: "cerrada",
    motivo_cancelacion: null,
  };
  DB.pos.ventas.push(venta);

  let siguienteDetalleId = siguienteId(DB.pos.venta_detalle);
  datos.lineas.forEach((l) => {
    const cantidad = Number(l.cantidad) || 0;
    const precio = Number(l.precio_unitario) || 0;
    const descPct = Number(l.descuento_pct) || 0;
    DB.pos.venta_detalle.push({
      id: siguienteDetalleId++,
      venta_id: nuevoId,
      producto_id: l.producto_id ?? null,
      descripcion: l.descripcion || null, // se usa cuando es un "producto rápido" sin catálogo
      cantidad,
      precio_unitario: precio,
      descuento: descPct,
      subtotal: Math.round(cantidad * precio * (1 - descPct / 100) * 100) / 100,
    });

    // Solo se descuenta inventario si es un producto real del catálogo
    // (los productos rápidos / piezas especiales no tienen existencia que ajustar)
    if (l.producto_id) {
      try {
        ajustarExistencia(DB, l.producto_id, { cantidad: -cantidad, motivo: `Venta — folio ${nuevoId}`, sucursal_id: venta.sucursal_id });
      } catch (e) {
        // Si el producto no tiene registro de existencia en esta sucursal, no se detiene la venta
      }
    }
  });

  return venta;
}

function listarVentas(DB, filtros = {}) {
  let lista = [...DB.pos.ventas];
  if (filtros.fecha_inicio) lista = lista.filter((v) => v.fecha >= filtros.fecha_inicio);
  if (filtros.fecha_fin) lista = lista.filter((v) => v.fecha <= filtros.fecha_fin);
  if (filtros.sucursal_id) lista = lista.filter((v) => v.sucursal_id === Number(filtros.sucursal_id));
  if (filtros.vendedor_id) lista = lista.filter((v) => v.vendedor_id === Number(filtros.vendedor_id));
  if (filtros.estatus) lista = lista.filter((v) => v.estatus === filtros.estatus);
  if (filtros.tipo_documento) lista = lista.filter((v) => v.tipo_documento === filtros.tipo_documento);
  if (filtros.texto) {
    const t = filtros.texto.toLowerCase();
    lista = lista.filter((v) => {
      const cliente = DB.crm.clientes.find((c) => c.id === v.cliente_id);
      return String(v.id).includes(t) || (cliente && cliente.nombre.toLowerCase().includes(t));
    });
  }
  return lista
    .map((v) => {
      const cliente = DB.crm.clientes.find((c) => c.id === v.cliente_id);
      const vendedor = DB.pos.vendedores.find((x) => x.id === v.vendedor_id);
      return {
        ...v,
        cliente_nombre: cliente ? cliente.nombre : "Público en General",
        vendedor_nombre: vendedor ? vendedor.nombre : "—",
      };
    })
    .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id - a.id);
}

function obtenerVentaDetalle(DB, id) {
  const venta = DB.pos.ventas.find((v) => v.id === Number(id));
  if (!venta) throw new Error("Venta no encontrada");
  const lineas = DB.pos.venta_detalle
    .filter((d) => d.venta_id === venta.id)
    .map((d) => {
      const prod = DB["catalogo-productos"].productos.find((p) => p.id === d.producto_id);
      return { ...d, descripcion: d.descripcion || prod?.nombre || "Producto" };
    });
  const cliente = DB.crm.clientes.find((c) => c.id === venta.cliente_id);
  const vendedor = DB.pos.vendedores.find((x) => x.id === venta.vendedor_id);
  const sucursal = DB.pos.sucursales.find((s) => s.id === venta.sucursal_id);
  return {
    ...venta,
    lineas,
    cliente_nombre: cliente ? cliente.nombre : "Público en General",
    vendedor_nombre: vendedor ? vendedor.nombre : "—",
    sucursal_nombre: sucursal ? sucursal.nombre : "—",
  };
}

function cancelarVenta(DB, id, motivo) {
  const venta = DB.pos.ventas.find((v) => v.id === Number(id));
  if (!venta) throw new Error("Venta no encontrada");
  if (venta.estatus === "cancelada") throw new Error("Esta venta ya está cancelada");
  venta.estatus = "cancelada";
  venta.motivo_cancelacion = motivo || "";

  // Reintegra al inventario lo que sí venía de catálogo
  DB.pos.venta_detalle
    .filter((d) => d.venta_id === venta.id)
    .forEach((l) => {
      if (l.producto_id) {
        try {
          ajustarExistencia(DB, l.producto_id, { cantidad: Number(l.cantidad), motivo: `Cancelación de venta — folio ${venta.id}`, sucursal_id: venta.sucursal_id });
        } catch (e) { /* si no existe existencia, no detiene la cancelación */ }
      }
    });

  return venta;
}

module.exports = { crearVenta, listarVentas, obtenerVentaDetalle, cancelarVenta };
