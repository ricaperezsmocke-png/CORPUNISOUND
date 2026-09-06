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
const { listarCondiciones } = require("./condicionesPago");
const { esDeLaEraSellada } = require("./corteEpoca");
const { calcularCorteEnCurso } = require("./cortes");

/** Centavos, no flotantes sueltos: sumar precios sin redondear arrastra error. */
function redondear(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function siguienteId(lista) {
  return lista.length ? Math.max(...lista.map((x) => x.id)) + 1 : 1;
}

function crearVenta(DB, datos, opciones = {}) {
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
  // EL CREDITO ESTA APAGADO A PROPOSITO (decision de Victor, 2026-09-04).
  //
  // El sistema aceptaba la venta pero NUNCA generaba la deuda: `cliente.saldo`
  // se inicializa en cero (clientes.js) y ninguna linea de produccion lo sube.
  // Esta funcion ni siquiera busca al cliente. Asi que una venta a credito era
  // mercancia entregada, cliente debiendo cero y caja cuadrada — sin faltante
  // que delatara nada. Era el unico hueco de este tamano al alcance de una
  // cajera del rol estandar, y tambien se aceptaba a "Publico en General".
  //
  // SE VALIDA CONTRA LA LISTA DE LO PERMITIDO, NO CONTRA LO PROHIBIDO, y esa
  // diferencia no es de estilo: es la que decide si la guarda falla abriendo o
  // cerrando. La primera version comparaba contra "CREDITO" normalizando el
  // acento, y una peticion con el cuerpo mal codificado —el acento mandado en
  // Latin-1 en vez de UTF-8— llegaba como "CR�DITO", no coincidia con
  // nada, y la venta a credito ENTRABA. Se descubrio probando contra el
  // servidor real; ninguna prueba lo habria encontrado, porque todas mandan
  // texto bien formado. Ahora cualquier cosa que no sea exactamente una forma
  // de pago configurada y permitida se rechaza.
  //
  // El credito se vuelve a encender el dia que existan cuentas por cobrar de
  // verdad —que generen la deuda, validen el limite y registren abonos—, y no
  // antes: mientras tanto sigue fuera de la lista de permitidas.
  const sinAcentos = (s) => String(s).trim().toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  // Vacio o solo espacios = EFECTIVO: una venta sin forma de pago declarada es
  // de contado, y asi se ha comportado siempre. Se decide aqui una sola vez
  // para que "" y "   " no acaben tratados distinto.
  const declarada = String(datos.metodo_pago ?? "").trim();
  const formaPago = declarada === "" ? "EFECTIVO" : sinAcentos(declarada);
  const permitidas = listarCondiciones(DB, sucursalId)
    .map((c) => sinAcentos(c.nombre))
    .filter((n) => n !== "CREDITO");
  if (!permitidas.includes(formaPago)) {
    throw new Error(
      formaPago === "CREDITO"
        ? "Las ventas a crédito están deshabilitadas: el sistema todavía no lleva cuentas por cobrar"
        : `Forma de pago no válida: "${datos.metodo_pago}". Las ventas a crédito están deshabilitadas.`
    );
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

  // EL SERVIDOR DECIDE EL PRECIO. Lo que manda el navegador es una propuesta,
  // no un hecho: quien manda la peticion a mano se salta cualquier limite de la
  // pantalla. Antes se copiaban `subtotal`, `descuento` y `total` tal como
  // llegaban, asi que un articulo de $12,000 se podia registrar en $1 — y en los
  // reportes se veia como una venta barata legitima, sin ninguna senal.
  //
  // Las lineas SIN `producto_id` son productos rapidos / piezas especiales: no
  // tienen catalogo contra el cual recalcular, y su precio lo sigue poniendo
  // quien vende.
  //
  // El descuento exige `aplicar_descuentos_articulos_venta`, permiso que YA
  // existia en el catalogo y que solo se comprobaba en la pantalla. Cuando no se
  // pasan permisos (llamadas internas y pruebas) se asume que NO hay permiso:
  // una guarda de dinero falla cerrando.
  const permisos = Array.isArray(opciones.permisos) ? opciones.permisos : [];
  const puedeDescontar = permisos.includes("aplicar_descuentos_articulos_venta");

  const lineasCalculadas = datos.lineas.map((l) => {
    const cantidad = Number(l.cantidad) || 0;
    const producto = l.producto_id
      ? DB["catalogo-productos"].productos.find((p) => p.id === Number(l.producto_id))
      : null;
    if (l.producto_id && !producto) throw new Error("Uno de los productos de la venta no existe");

    // Un producto del catalogo SIN precio no se vende en cero en silencio. Al
    // tomar el precio del catalogo en vez del que manda la pantalla, un producto
    // al que nadie le puso precio pasaria a regalarse — y el ticket diria $0 sin
    // que nadie entienda por que. Se rechaza diciendo cual es.
    let precio;
    if (producto) {
      precio = Number(producto.precio_venta) || 0;
      if (precio <= 0) {
        throw new Error(`"${producto.nombre}" no tiene precio de venta configurado — ponle precio en Inventario y Productos antes de venderlo`);
      }
    } else {
      precio = Number(l.precio_unitario) || 0;
    }

    const descPct = Number(l.descuento_pct) || 0;
    if (descPct !== 0) {
      if (!puedeDescontar) {
        throw new Error("No tienes permiso para aplicar descuentos a los artículos de la venta");
      }
      if (descPct < 0 || descPct > 100) {
        throw new Error("El descuento debe estar entre 0 y 100 por ciento");
      }
    }

    const bruto = redondear(cantidad * precio);
    return { ...l, cantidad, precio, descPct, bruto, subtotal: redondear(bruto * (1 - descPct / 100)) };
  });

  const subtotalCalculado = redondear(lineasCalculadas.reduce((s, l) => s + l.bruto, 0));
  const totalCalculado = redondear(lineasCalculadas.reduce((s, l) => s + l.subtotal, 0));
  const descuentoCalculado = redondear(subtotalCalculado - totalCalculado);

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
    // Se guarda la forma de pago YA VALIDADA, no la que llego en el cuerpo:
    // persistir el texto crudo dejaba entrar espacios y basura mal codificada
    // que despues no coincide con nada al filtrar o al cortar.
    metodo_pago: formaPago,
    subtotal: subtotalCalculado,
    descuento: descuentoCalculado,
    total: totalCalculado,
    estatus: "cerrada",
    motivo_cancelacion: null,
    corte_id: null,
  };
  DB.pos.ventas.push(venta);

  let siguienteDetalleId = siguienteId(DB.pos.venta_detalle);
  lineasCalculadas.forEach((l) => {
    const cantidad = l.cantidad;
    DB.pos.venta_detalle.push({
      id: siguienteDetalleId++,
      venta_id: nuevoId,
      producto_id: l.producto_id ?? null,
      descripcion: l.descripcion || null, // se usa cuando es un "producto rápido" sin catálogo
      cantidad,
      precio_unitario: l.precio,
      descuento: l.descPct,
      subtotal: l.subtotal,
    });

    // Solo se descuenta inventario si es un producto real del catálogo
    // (los productos rápidos / piezas especiales no tienen existencia que ajustar)
    if (l.producto_id) {
      try {
        ajustarExistencia(DB, l.producto_id, { cantidad: -cantidad, motivo: `Venta — folio ${nuevoId}`, sucursal_id: venta.sucursal_id });
      } catch (e) {
        // ULTIMO RECURSO. Desde que `ajustarExistencia` crea la fila que falte,
        // esto ya no se dispara por el caso comun. Si aun asi falla, la venta NO
        // se detiene —hay un cliente enfrente— pero el fallo deja de ser
        // invisible: antes se tragaba en silencio y la tienda perdia la cuenta
        // de lo que tiene sin que nadie se enterara.
        console.error(`[inventario] la venta ${nuevoId} no pudo descontar el producto ${l.producto_id} en la sucursal ${venta.sucursal_id}: ${e.message}`);
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
        } catch (e) {
          // Ultimo recurso: la cancelacion no se detiene, pero se dice. Un
          // reintegro que falla en silencio deja mercancia fuera del inventario.
          console.error(`[inventario] la cancelacion de la venta ${venta.id} no pudo reintegrar el producto ${l.producto_id}: ${e.message}`);
        }
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
