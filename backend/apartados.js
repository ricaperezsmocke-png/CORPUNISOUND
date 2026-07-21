/**
 * apartados.js — Apartados (layaway): el cliente paga un anticipo, el
 * producto se reserva (se descuenta existencia de inmediato) y viene
 * después a liquidar en uno o varios abonos, antes de 60 días.
 *
 * Un apartado es una fila más en DB.pos.ventas (tipo_documento: "Apartado"),
 * con un ciclo de vida propio de estatus: "apartado" (vigente, con saldo
 * pendiente) → "cerrada" (liquidado) o "cancelada" (cancelado o vencido).
 * Los pagos parciales (el anticipo cuenta como el primero) viven en
 * DB.pos.apartado_abonos — nunca se suma venta.total al Corte de Caja ni
 * a Movimientos de Caja para un apartado; se suman sus abonos por fecha
 * real de pago (ver reportes.js/cortes.js).
 */

const { ajustarExistencia } = require("./productos");

const DIAS_LIMITE_APARTADO = 60;
const DIAS_AVISO_POR_VENCER = 7;

function siguienteId(lista) {
  return lista.length ? Math.max(...lista.map((x) => x.id)) + 1 : 1;
}

function hoy() {
  return new Date().toISOString().slice(0, 10);
}

function sumaAbonos(DB, ventaId) {
  return DB.pos.apartado_abonos
    .filter((a) => a.venta_id === ventaId)
    .reduce((acc, a) => acc + a.monto, 0);
}

function saldoPendiente(DB, venta) {
  return Math.round((venta.total - sumaAbonos(DB, venta.id)) * 100) / 100;
}

function diasEntre(fechaA, fechaB) {
  return Math.floor((new Date(fechaB) - new Date(fechaA)) / 86400000);
}

function crearApartado(DB, datos, sucursalId, usuario) {
  const cliente_id = Number(datos.cliente_id);
  if (!cliente_id) throw new Error("Selecciona un cliente para el apartado — no puede ser Público en General");
  if (!Array.isArray(datos.lineas) || datos.lineas.length === 0) {
    throw new Error("El apartado no tiene productos");
  }
  const anticipoMonto = Number(datos.anticipo_monto);
  if (!anticipoMonto || anticipoMonto <= 0) throw new Error("El anticipo debe ser mayor a $0");
  if (!datos.anticipo_forma_pago) throw new Error("Selecciona la forma de pago del anticipo");

  const sucursal_id = Number(sucursalId) || 1;

  // Misma validación de existencia suficiente que crearVenta (ventas.js) —
  // no dejar apartar más de lo que hay, agrupando por producto por si el
  // mismo producto aparece en más de un renglón.
  const cantidadPedida = {};
  datos.lineas.forEach((l) => {
    if (!l.producto_id) return;
    cantidadPedida[l.producto_id] = (cantidadPedida[l.producto_id] || 0) + (Number(l.cantidad) || 0);
  });
  Object.entries(cantidadPedida).forEach(([productoId, cantidad]) => {
    const exist = DB.inventario.existencias.find((e) => e.producto_id === Number(productoId) && e.sucursal_id === sucursal_id);
    if (!exist) return; // sin registro de existencia en esta sucursal — no se puede validar, se deja pasar (igual que ajustarExistencia)
    if (cantidad > exist.cantidad_actual) {
      const producto = DB["catalogo-productos"].productos.find((p) => p.id === Number(productoId));
      throw new Error(`No hay existencia suficiente de "${producto?.nombre || "producto"}" (disponible: ${exist.cantidad_actual}, solicitado: ${cantidad})`);
    }
  });

  const nuevoId = siguienteId(DB.pos.ventas);
  const subtotal = datos.lineas.reduce((a, l) => a + Number(l.cantidad) * Number(l.precio_unitario), 0);
  const descuento = datos.lineas.reduce((a, l) => a + (Number(l.cantidad) * Number(l.precio_unitario) * (Number(l.descuento_pct) || 0)) / 100, 0);
  const total = Math.round((subtotal - descuento) * 100) / 100;
  const fechaHoy = hoy();
  const fechaLimiteObj = new Date();
  fechaLimiteObj.setDate(fechaLimiteObj.getDate() + DIAS_LIMITE_APARTADO);

  const venta = {
    id: nuevoId,
    fecha: fechaHoy,
    fecha_hora: new Date().toISOString(),
    sucursal_id,
    vendedor_id: datos.vendedor_id ? Number(datos.vendedor_id) : null,
    cliente_id,
    tipo_documento: "Apartado",
    metodo_pago: "MIXTO",
    subtotal: Math.round(subtotal * 100) / 100,
    descuento: Math.round(descuento * 100) / 100,
    total,
    estatus: "apartado",
    motivo_cancelacion: null,
    fecha_limite: fechaLimiteObj.toISOString().slice(0, 10),
    fecha_liquidacion: null,
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
      descripcion: l.descripcion || null,
      cantidad,
      precio_unitario: precio,
      descuento: descPct,
      subtotal: Math.round(cantidad * precio * (1 - descPct / 100) * 100) / 100,
    });

    if (l.producto_id) {
      try {
        ajustarExistencia(DB, l.producto_id, { cantidad: -cantidad, motivo: `Apartado — folio ${nuevoId}`, sucursal_id });
      } catch (e) { /* si no existe registro de existencia en esta sucursal, no detiene el apartado */ }
    }
  });

  const nuevoAbonoId = siguienteId(DB.pos.apartado_abonos);
  DB.pos.apartado_abonos.push({
    id: nuevoAbonoId,
    venta_id: nuevoId,
    sucursal_id,
    fecha: fechaHoy,
    fecha_hora: new Date().toISOString(),
    monto: Math.round(anticipoMonto * 100) / 100,
    forma_pago: String(datos.anticipo_forma_pago).toUpperCase(),
    usuario_nombre: usuario?.nombre || "—",
  });

  if (saldoPendiente(DB, venta) <= 0) {
    liquidarApartado(DB, venta.id);
  }

  return venta;
}

function registrarAbono(DB, ventaId, datos, usuario) {
  const venta = DB.pos.ventas.find((v) => v.id === Number(ventaId));
  if (!venta || venta.tipo_documento !== "Apartado") throw new Error("Apartado no encontrado");
  if (venta.estatus !== "apartado") throw new Error("Este apartado ya no está vigente");

  const monto = Number(datos.monto);
  if (!monto || monto <= 0) throw new Error("El monto del abono debe ser mayor a $0");
  if (!datos.forma_pago) throw new Error("Selecciona la forma de pago del abono");

  const saldo = saldoPendiente(DB, venta);
  if (monto > saldo) throw new Error(`El abono ($${monto.toFixed(2)}) no puede ser mayor al saldo pendiente ($${saldo.toFixed(2)})`);

  const nuevoAbonoId = siguienteId(DB.pos.apartado_abonos);
  DB.pos.apartado_abonos.push({
    id: nuevoAbonoId,
    venta_id: venta.id,
    sucursal_id: venta.sucursal_id,
    fecha: hoy(),
    fecha_hora: new Date().toISOString(),
    monto: Math.round(monto * 100) / 100,
    forma_pago: String(datos.forma_pago).toUpperCase(),
    usuario_nombre: usuario?.nombre || "—",
  });

  if (saldoPendiente(DB, venta) <= 0) {
    liquidarApartado(DB, venta.id);
  }

  return DB.pos.ventas.find((v) => v.id === venta.id);
}

function liquidarApartado(DB, ventaId) {
  const venta = DB.pos.ventas.find((v) => v.id === Number(ventaId));
  if (!venta || venta.tipo_documento !== "Apartado") throw new Error("Apartado no encontrado");
  if (venta.estatus !== "apartado") throw new Error("Este apartado ya no está vigente");
  venta.estatus = "cerrada";
  venta.fecha_liquidacion = hoy();
  return venta;
}

function cancelarApartado(DB, ventaId, motivo) {
  const venta = DB.pos.ventas.find((v) => v.id === Number(ventaId));
  if (!venta || venta.tipo_documento !== "Apartado") throw new Error("Apartado no encontrado");
  if (venta.estatus !== "apartado") throw new Error("Este apartado ya no está vigente");

  const yaAbonado = sumaAbonos(DB, venta.id);

  venta.estatus = "cancelada";
  venta.motivo_cancelacion = motivo || "Cancelado";

  DB.pos.venta_detalle
    .filter((d) => d.venta_id === venta.id)
    .forEach((l) => {
      if (l.producto_id) {
        try {
          ajustarExistencia(DB, l.producto_id, { cantidad: Number(l.cantidad), motivo: `Cancelación de apartado — folio ${venta.id}`, sucursal_id: venta.sucursal_id });
        } catch (e) { /* si no existe existencia, no detiene la cancelación */ }
      }
    });

  if (yaAbonado > 0) {
    const cliente = DB.crm.clientes.find((c) => c.id === venta.cliente_id);
    if (cliente) cliente.monedero = Math.round(((cliente.monedero || 0) + yaAbonado) * 100) / 100;
  }

  return venta;
}

function procesarVencimientos(DB) {
  const fechaHoy = hoy();
  DB.pos.ventas
    .filter((v) => v.tipo_documento === "Apartado" && v.estatus === "apartado" && v.fecha_limite < fechaHoy)
    .forEach((v) => cancelarApartado(DB, v.id, "Vencido — 60 días sin liquidar"));
}

function listarApartados(DB, alcance) {
  procesarVencimientos(DB);
  let lista = DB.pos.ventas.filter((v) => v.tipo_documento === "Apartado" && v.estatus === "apartado");
  if (alcance && !alcance.verTodas) lista = lista.filter((v) => v.sucursal_id === alcance.sucursalId);

  return lista
    .map((v) => {
      const cliente = DB.crm.clientes.find((c) => c.id === v.cliente_id);
      return {
        ...v,
        cliente_nombre: cliente ? cliente.nombre : "—",
        saldo_pendiente: saldoPendiente(DB, v),
        dias_restantes: diasEntre(hoy(), v.fecha_limite),
        abonos: DB.pos.apartado_abonos
          .filter((a) => a.venta_id === v.id)
          .sort((a, b) => a.fecha_hora.localeCompare(b.fecha_hora)),
      };
    })
    .sort((a, b) => a.dias_restantes - b.dias_restantes);
}

function obtenerApartadosProximosAVencer(DB, alcance) {
  procesarVencimientos(DB);
  let lista = DB.pos.ventas.filter((v) => v.tipo_documento === "Apartado" && v.estatus === "apartado");
  if (alcance && !alcance.verTodas) lista = lista.filter((v) => v.sucursal_id === alcance.sucursalId);

  return lista
    .map((v) => ({ ...v, dias_restantes: diasEntre(hoy(), v.fecha_limite) }))
    .filter((v) => v.dias_restantes <= DIAS_AVISO_POR_VENCER)
    .filter((v) => !DB.crm.contactos_cliente.some((c) => c.venta_id === v.id && c.tipo === "apartado_por_vencer"))
    .map((v) => {
      const cliente = DB.crm.clientes.find((c) => c.id === v.cliente_id);
      if (!cliente) return null;
      return {
        venta_id: v.id,
        cliente_id: cliente.id,
        cliente_nombre: cliente.nombre,
        telefono: cliente.telefono,
        dias_restantes: v.dias_restantes,
        saldo_pendiente: saldoPendiente(DB, v),
        total: v.total,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.dias_restantes - b.dias_restantes);
}

module.exports = {
  crearApartado, registrarAbono, liquidarApartado, cancelarApartado,
  procesarVencimientos, listarApartados, obtenerApartadosProximosAVencer,
  saldoPendiente,
};
