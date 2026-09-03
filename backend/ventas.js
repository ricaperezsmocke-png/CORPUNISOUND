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
const { fechaLocal } = require("./fechas");
const { resolverCajaDeSucursal, esDeEstaCaja } = require("./cajas");
const { esDeLaEraSellada } = require("./corteEpoca");
const { calcularCorteEnCurso } = require("./cortes");

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
  // Sin sucursal no se adivina: antes caía a la 1, así que la venta se
  // registraba en Ocosingo y le descontaba el inventario a Ocosingo, viniera
  // de la tienda que viniera.
  const sucursalId = Number(datos.sucursal_id);
  if (!Number.isInteger(sucursalId) || sucursalId <= 0) {
    throw new Error("Falta la sucursal donde se cierra la venta");
  }
  const config = obtenerConfiguracion(DB);
  if (!config.permitir_ventas_sin_existencia) {
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

  // El vendedor tiene que ser de ESTA sucursal. Una venta atribuida a alguien
  // de otra tienda no le cuenta a nadie: `esVentaDeSuTienda` la descarta de su
  // objetivo, pero el reporte sí se la acredita — dos pantallas que se
  // contradicen sobre la misma venta, y la persona que de verdad vendió se
  // queda sin ella. Se rechaza aquí, no solo en la pantalla: la caja se puede
  // saltar, la ruta no.
  let vendedorId = null;
  if (datos.vendedor_id !== undefined && datos.vendedor_id !== null && datos.vendedor_id !== "") {
    const v = DB.pos.vendedores.find((x) => x.id === Number(datos.vendedor_id));
    if (!v) throw new Error("El vendedor de la venta no existe");
    if (v.activo === false) throw new Error(`${v.nombre} ya no está activo como vendedor`);
    if (Number(v.sucursal_id) !== Number(sucursalId)) {
      throw new Error(`${v.nombre} no vende en esta sucursal`);
    }
    vendedorId = v.id;
  }

  const caja = resolverCajaDeSucursal(DB, sucursalId, datos.caja_id);

  const nuevoId = siguienteId(DB.pos.ventas);
  const venta = {
    id: nuevoId,
    fecha: fechaLocal(),
    fecha_hora: new Date().toISOString(), // con hora — el corte de caja agrupa ventas por turno
    sucursal_id: sucursalId,
    caja_id: caja?.id ?? null,
    vendedor_id: vendedorId,
    cliente_id: datos.cliente_id !== undefined && datos.cliente_id !== null ? Number(datos.cliente_id) : 0,
    tipo_documento: datos.tipo_documento || "Ticket",
    metodo_pago: datos.metodo_pago || "EFECTIVO",
    subtotal: Number(datos.subtotal) || 0,
    descuento: Number(datos.descuento) || 0,
    total: Number(datos.total) || 0,
    estatus: "cerrada",
    motivo_cancelacion: null,
    corte_id: null,
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
  // La pertenencia a una caja se decide con `esDeEstaCaja` y en ningun otro
  // lado. Comparar el id a secas escondia justo las ventas historicas
  // (`caja_id: null`), que el corte de la Administrativa SI cuenta: quien
  // investigara un faltante filtraba por Administrativa, no veia ninguna de
  // las ventas que le estaban cobrando, y el faltante parecia inventado.
  if (filtros.caja_id) {
    const caja = (DB.pos.cajas || []).find((c) => c.id === Number(filtros.caja_id));
    lista = caja ? lista.filter((v) => esDeEstaCaja(v, caja)) : [];
  }
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

function cancelarVenta(DB, id, motivo, usuario) {
  const venta = DB.pos.ventas.find((v) => v.id === Number(id));
  if (!venta) throw new Error("Venta no encontrada");
  if (venta.estatus === "cancelada") throw new Error("Esta venta ya está cancelada");
  venta.estatus = "cancelada";
  venta.motivo_cancelacion = motivo || "";
  // Cuándo y quién, no solo por qué. Sin la hora no se puede saber a qué turno
  // afectó una cancelación, y ese dato es justo el que hace falta el día que un
  // corte sale corto: una venta ya contada que se cancela y se reembolsa deja
  // el cajón con menos dinero del que el siguiente corte espera. El corte
  // anterior no se toca —su foto está congelada— así que sin este rastro el
  // faltante aparece sin dueño (ver `cancelado_de_cortes_anteriores` en
  // cortes.js).
  venta.fecha_hora_cancelacion = new Date().toISOString();
  venta.cancelada_por = usuario?.nombre || "—";

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

function ventaQuedaDespuesDelUltimoCorte(DB, venta, caja) {
  // Se consulta al propio cálculo del corte con una vista aislada de la venta.
  // Así esta decisión comparte también su normalización de fechas históricas:
  // no se copia aquí que una venta sin fecha_hora empieza a las 00:00.
  const vista = {
    ...DB,
    pos: {
      ...DB.pos,
      ventas: [{
        ...venta,
        caja_id: caja?.id ?? null,
        estatus: "cerrada",
        tipo_documento: "Ticket",
      }],
    },
  };
  const turno = calcularCorteEnCurso(vista, venta.sucursal_id, caja?.id ?? null);
  return !turno.desde || turno.ventas_incluidas === 1;
}

function cambiarCajaVenta(DB, id, cajaDestinoId, usuario) {
  const venta = DB.pos.ventas.find((v) => v.id === Number(id));
  if (!venta) throw new Error("Venta no encontrada");

  // resolverCajaDeSucursal concentra la validación de existencia y sucursal.
  // Al resolver también el origen, una venta histórica con caja_id null se
  // atribuye a la predeterminada exactamente como la absorbe el corte.
  const cajaOrigen = resolverCajaDeSucursal(DB, venta.sucursal_id, venta.caja_id);
  const cajaDestino = resolverCajaDeSucursal(DB, venta.sucursal_id, cajaDestinoId);
  if (cajaOrigen?.id === cajaDestino?.id) {
    throw new Error(`Esta venta ya pertenece a la caja ${cajaDestino?.nombre || "indicada"}`);
  }

  const esPosteriorAEpoca = esDeLaEraSellada(venta.fecha_hora || `${venta.fecha}T00:00:00.000Z`, DB);
  const yaFueCortada = esPosteriorAEpoca
    ? venta.corte_id != null
    : !ventaQuedaDespuesDelUltimoCorte(DB, venta, cajaOrigen);
  if (yaFueCortada) {
    throw new Error(
      `No se puede cambiar la caja: esta venta ya forma parte de un corte cerrado de la caja ${cajaOrigen?.nombre || "actual"}. Ese corte conserva sus totales históricos.`
    );
  }

  // En la era sellada esta validación es redundante a propósito: una venta
  // con corte_id null seguirá visible aunque la caja destino haya cortado
  // después de su fecha. Se conserva para la transición histórica, donde los
  // registros anteriores a corte_epoca todavía usan la ventana de tiempo.
  if (!esPosteriorAEpoca && !ventaQuedaDespuesDelUltimoCorte(DB, venta, cajaDestino)) {
    throw new Error(
      `No se puede cambiar la caja: la caja destino ${cajaDestino.nombre} ya cerró un corte posterior a esta venta. Si se moviera, la venta no aparecería en ningún corte.`
    );
  }

  const cambio = {
    usuario_id: usuario?.id ?? null,
    usuario_nombre: usuario?.nombre || "—",
    fecha_hora: new Date().toISOString(),
    caja_origen_id: cajaOrigen?.id ?? null,
    caja_origen_nombre: cajaOrigen?.nombre || "Sin caja",
    caja_destino_id: cajaDestino.id,
    caja_destino_nombre: cajaDestino.nombre,
  };
  if (!Array.isArray(venta.cambios_caja)) venta.cambios_caja = [];
  venta.cambios_caja.push(cambio);
  venta.caja_id = cajaDestino.id;
  return venta;
}

module.exports = { crearVenta, listarVentas, obtenerVentaDetalle, cancelarVenta, cambiarCajaVenta };
