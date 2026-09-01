/**
 * Evidencia objetiva para Inteligencia de Compras.
 *
 * Este módulo es deliberadamente de solo lectura: no normaliza DB, no crea
 * entidades y no decide acciones comerciales. La identidad de un producto
 * catalogado es exclusivamente producto_id.
 */

const { fechaLocal } = require("./fechas");
const { agruparRegistrosLibres } = require("./radar/identidad");

const VENTANAS = Object.freeze([7, 30, 60, 90, 180]);

function texto(valor) {
  return valor == null ? "" : String(valor).trim();
}

function normalizarTexto(valor) {
  return texto(valor).replace(/\s+/g, " ").toLocaleLowerCase("es");
}

function fechaValida(valor, nombre) {
  const fecha = texto(valor);
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
  const instante = partes && new Date(`${fecha}T00:00:00.000Z`);
  if (!partes || Number.isNaN(instante.getTime()) || instante.toISOString().slice(0, 10) !== fecha) {
    throw new Error(`${nombre} debe ser una fecha válida con formato YYYY-MM-DD`);
  }
  return fecha;
}

function sumarDias(fecha, dias) {
  const instante = new Date(`${fecha}T00:00:00.000Z`);
  instante.setUTCDate(instante.getUTCDate() + dias);
  return instante.toISOString().slice(0, 10);
}

function inicioVentana(fechaFin, dias) {
  return sumarDias(fechaFin, -(dias - 1));
}

function estaEnVentana(fecha, fechaFin, dias) {
  return fecha >= inicioVentana(fechaFin, dias) && fecha <= fechaFin;
}

function fechaDeRegistro(valor) {
  return fechaLocal(valor);
}

function fechaDeVenta(venta) {
  const valor = texto(venta.fecha);
  return /^\d{4}-\d{2}-\d{2}$/.test(valor) ? valor : fechaLocal(venta.fecha_hora || valor);
}

function claveContacto(registro) {
  if (registro.cliente_id != null && Number(registro.cliente_id) !== 0) {
    return `cliente:${Number(registro.cliente_id)}`;
  }
  const telefono = normalizarTexto(registro.telefono_contacto);
  if (telefono) return `telefono:${telefono}`;
  const nombre = normalizarTexto(registro.nombre_contacto);
  return nombre ? `nombre:${nombre}` : null;
}

function resolverSucursalesAutorizadas(DB, alcance) {
  const existentes = new Set((DB.pos?.sucursales || []).map((s) => Number(s.id)));
  if (alcance?.verTodas === true) {
    const solicitadas = Array.isArray(alcance.sucursalIds)
      ? alcance.sucursalIds.map(Number).filter((id) => existentes.has(id))
      : [...existentes];
    return new Set(solicitadas);
  }
  const id = Number(alcance?.sucursalId);
  return new Set(existentes.has(id) ? [id] : []);
}

function nuevaMetricaRadar() {
  return { solicitudes: 0, cantidad_solicitada: 0, contactos: new Set(), primera_solicitud: null, ultima_solicitud: null, motivos: new Map() };
}

function agregarRadar(metrica, registro, fecha) {
  metrica.solicitudes += 1;
  metrica.cantidad_solicitada += Number(registro.cantidad) || 0;
  const contacto = claveContacto(registro);
  if (contacto) metrica.contactos.add(contacto);
  if (!metrica.primera_solicitud || fecha < metrica.primera_solicitud) metrica.primera_solicitud = fecha;
  if (!metrica.ultima_solicitud || fecha > metrica.ultima_solicitud) metrica.ultima_solicitud = fecha;
  const motivo = texto(registro.motivo_no_venta) || "OTRO";
  metrica.motivos.set(motivo, (metrica.motivos.get(motivo) || 0) + 1);
}

function serializarRadar(metrica) {
  return {
    solicitudes: metrica.solicitudes,
    cantidad_solicitada: metrica.cantidad_solicitada,
    contactos_distintos: metrica.contactos.size,
    primera_solicitud: metrica.primera_solicitud,
    ultima_solicitud: metrica.ultima_solicitud,
    motivos: Object.fromEntries([...metrica.motivos].sort(([a], [b]) => a.localeCompare(b))),
  };
}

function claveProductoSucursal(productoId, sucursalId) {
  return `${Number(productoId)}:${Number(sucursalId)}`;
}

function obtenerEvidenciaCompras(DB, alcance, filtros = {}) {
  const fechaFin = filtros.fecha_fin ? fechaValida(filtros.fecha_fin, "fecha_fin") : fechaLocal();
  const autorizadas = resolverSucursalesAutorizadas(DB, alcance);
  const sucursales = DB.pos?.sucursales || [];
  const sucursalPorId = new Map(sucursales.map((s) => [Number(s.id), s]));
  const productosLista = DB["catalogo-productos"]?.productos || [];
  const productoPorId = new Map(productosLista.map((p) => [Number(p.id), p]));
  const proveedorPorId = new Map((DB["catalogo-productos"]?.proveedores || []).map((p) => [Number(p.id), p]));

  const radarPorClave = new Map();
  const registrosLibres = [];
  for (const registro of DB.radar_demanda?.registros || []) {
    const sucursalId = Number(registro.sucursal_id);
    if (!autorizadas.has(sucursalId)) continue;
    const fecha = fechaDeRegistro(registro.fecha_registro);
    if (!estaEnVentana(fecha, fechaFin, 180)) continue;
    const productoId = registro.producto_id == null ? null : Number(registro.producto_id);
    if (productoId != null) {
      if (productoPorId.has(productoId)) {
        const clave = claveProductoSucursal(productoId, sucursalId);
        if (!radarPorClave.has(clave)) {
          radarPorClave.set(clave, { productoId, sucursalId, ventanas: new Map(VENTANAS.map((d) => [d, nuevaMetricaRadar()])) });
        }
        for (const dias of VENTANAS) {
          if (estaEnVentana(fecha, fechaFin, dias)) agregarRadar(radarPorClave.get(clave).ventanas.get(dias), registro, fecha);
        }
      }
      // Un id huérfano es un problema de integridad, no un producto libre. No
      // se intenta rescatar por snapshot, nombre, SKU ni otra coincidencia.
      continue;
    }

    // Los productos libres nunca consultan catálogo, ventas ni inventario.
    registrosLibres.push(registro);
  }

  const libresPorIdentidad = agruparRegistrosLibres(registrosLibres).map((grupo, indice) => {
    const lider = grupo.registro_lider;
    const libre = {
      identidad_textual: `libre:${indice}`,
      producto_solicitado: grupo.nombre_visible,
      marca: texto(lider.marca_solicitada), modelo: texto(lider.modelo_solicitado),
      variante: texto(lider.variante_solicitada), categoria: texto(lider.categoria_solicitada),
      formas_distintas: grupo.formas_distintas, formas: grupo.formas,
      solicitudes: 0, cantidad_solicitada: 0, contactos: new Set(), sucursales: new Set(),
      primera_solicitud: null, ultima_solicitud: null, motivos: new Map(),
      radar30d: nuevaMetricaRadar(),
    };
    for (const registro of grupo.registros) {
      const fecha = fechaDeRegistro(registro.fecha_registro);
      libre.solicitudes += 1;
      libre.cantidad_solicitada += Number(registro.cantidad) || 0;
      const contacto = claveContacto(registro); if (contacto) libre.contactos.add(contacto);
      libre.sucursales.add(Number(registro.sucursal_id));
      if (!libre.primera_solicitud || fecha < libre.primera_solicitud) libre.primera_solicitud = fecha;
      if (!libre.ultima_solicitud || fecha > libre.ultima_solicitud) libre.ultima_solicitud = fecha;
      const motivo = texto(registro.motivo_no_venta) || "OTRO";
      libre.motivos.set(motivo, (libre.motivos.get(motivo) || 0) + 1);
      if (estaEnVentana(fecha, fechaFin, 30)) agregarRadar(libre.radar30d, registro, fecha);
    }
    return libre;
  });

  const ventasPorId = new Map();
  for (const venta of DB.pos?.ventas || []) {
    if (venta.estatus !== "cerrada" || !autorizadas.has(Number(venta.sucursal_id))) continue;
    ventasPorId.set(Number(venta.id), { venta, fecha: fechaDeVenta(venta) });
  }
  const ventasPorClave = new Map();
  for (const detalle of DB.pos?.venta_detalle || []) {
    if (detalle.producto_id == null) continue;
    const encabezado = ventasPorId.get(Number(detalle.venta_id));
    if (!encabezado || !productoPorId.has(Number(detalle.producto_id))) continue;
    const clave = claveProductoSucursal(detalle.producto_id, encabezado.venta.sucursal_id);
    if (!ventasPorClave.has(clave)) ventasPorClave.set(clave, new Map(VENTANAS.map((d) => [d, 0])));
    for (const dias of VENTANAS) {
      if (estaEnVentana(encabezado.fecha, fechaFin, dias)) {
        ventasPorClave.get(clave).set(dias, ventasPorClave.get(clave).get(dias) + (Number(detalle.cantidad) || 0));
      }
    }
  }

  const existenciaPorClave = new Map();
  for (const existencia of DB.inventario?.existencias || []) {
    if (!autorizadas.has(Number(existencia.sucursal_id))) continue;
    existenciaPorClave.set(claveProductoSucursal(existencia.producto_id, existencia.sucursal_id), existencia);
  }

  const traspasosPorClave = new Map();
  for (const traspaso of DB.inventario?.traspasos || []) {
    if (traspaso.estatus !== "en_transito" || !autorizadas.has(Number(traspaso.sucursal_destino_id))) continue;
    const clave = claveProductoSucursal(traspaso.producto_id, traspaso.sucursal_destino_id);
    const actual = traspasosPorClave.get(clave) || { cantidad: 0, numero: 0 };
    actual.cantidad += Number(traspaso.cantidad) || 0;
    actual.numero += 1;
    traspasosPorClave.set(clave, actual);
  }

  const compraPorId = new Map();
  for (const compra of DB.inventario?.compras || []) {
    if (autorizadas.has(Number(compra.sucursal_id))) compraPorId.set(Number(compra.id), compra);
  }
  const comprasPorProducto = new Map();
  for (const detalle of DB.inventario?.compra_detalle || []) {
    const compra = compraPorId.get(Number(detalle.compra_id));
    if (!compra) continue;
    const productoId = Number(detalle.producto_id);
    if (!comprasPorProducto.has(productoId)) comprasPorProducto.set(productoId, []);
    comprasPorProducto.get(productoId).push({ detalle, compra, fecha: fechaDeRegistro(compra.fecha) });
  }

  const expedientes = [];
  for (const grupo of radarPorClave.values()) {
    const producto = productoPorId.get(grupo.productoId);
    const sucursal = sucursalPorId.get(grupo.sucursalId);
    const ventasVentanas = ventasPorClave.get(claveProductoSucursal(grupo.productoId, grupo.sucursalId)) || new Map();
    const ventas = Object.fromEntries(VENTANAS.map((d) => [`unidades_${d}d`, ventasVentanas.get(d) || 0]));
    ventas.promedio_diario_observado_30d = ventas.unidades_30d / 30;
    ventas.promedio_diario_observado_90d = ventas.unidades_90d / 90;

    const existencia = existenciaPorClave.get(claveProductoSucursal(grupo.productoId, grupo.sucursalId));
    const calidad = ["PEDIDOS_PROVEEDOR_NO_DISPONIBLES"];
    let inventario;
    if (!existencia) {
      inventario = { existencia_registrada: false, cantidad_actual: null, cantidad_minima: null, cantidad_maxima: null, sin_existencia: null, bajo_minimo: null, sobre_maximo: null, cobertura_dias_30d: null };
      calidad.push("SIN_FILA_EXISTENCIA");
    } else {
      const actual = Number(existencia.cantidad_actual) || 0;
      const minima = Number(existencia.cantidad_minima) || 0;
      const maxima = Number(existencia.cantidad_maxima) || 0;
      if (actual < 0) calidad.push("STOCK_NEGATIVO");
      if (minima === 0) calidad.push("MINIMO_NO_CONFIGURADO");
      if (maxima === 0) calidad.push("MAXIMO_NO_CONFIGURADO");
      inventario = {
        existencia_registrada: true, cantidad_actual: actual, cantidad_minima: minima, cantidad_maxima: maxima,
        sin_existencia: actual <= 0, bajo_minimo: minima > 0 && actual < minima,
        sobre_maximo: maxima > 0 && actual > maxima,
        cobertura_dias_30d: actual >= 0 && ventas.promedio_diario_observado_30d > 0 ? actual / ventas.promedio_diario_observado_30d : null,
      };
    }
    if (ventas.unidades_180d === 0) calidad.push("SIN_HISTORIAL_VENTAS");

    const otrasSucursales = [];
    for (const otraId of autorizadas) {
      if (otraId === grupo.sucursalId) continue;
      const fila = existenciaPorClave.get(claveProductoSucursal(grupo.productoId, otraId));
      if (!fila) {
        otrasSucursales.push({ sucursal_id: otraId, sucursal_nombre: sucursalPorId.get(otraId)?.nombre || null, existencia_registrada: false, cantidad_actual: null, cantidad_minima: null, cantidad_maxima: null, minimo_configurado: false, excedente_matematico_sobre_minimo: null, calidad_datos: ["SIN_FILA_EXISTENCIA"] });
      } else {
        const actual = Number(fila.cantidad_actual) || 0;
        const minima = Number(fila.cantidad_minima) || 0;
        const maxima = Number(fila.cantidad_maxima) || 0;
        const calidadOtra = [];
        if (actual < 0) calidadOtra.push("STOCK_NEGATIVO");
        if (minima === 0) calidadOtra.push("MINIMO_NO_CONFIGURADO");
        if (maxima === 0) calidadOtra.push("MAXIMO_NO_CONFIGURADO");
        otrasSucursales.push({ sucursal_id: otraId, sucursal_nombre: sucursalPorId.get(otraId)?.nombre || null, existencia_registrada: true, cantidad_actual: actual, cantidad_minima: minima, cantidad_maxima: maxima, minimo_configurado: minima !== 0, excedente_matematico_sobre_minimo: Math.max(0, actual - minima), calidad_datos: calidadOtra });
      }
    }

    const historico = (comprasPorProducto.get(grupo.productoId) || []).sort((a, b) => a.compra.fecha.localeCompare(b.compra.fecha) || Number(a.detalle.id) - Number(b.detalle.id));
    const ultima = historico.at(-1) || null;
    const cantidadTotal = historico.reduce((suma, x) => suma + (Number(x.detalle.cantidad) || 0), 0);
    const costoTotal = historico.reduce((suma, x) => suma + (Number(x.detalle.costo) || 0) * (Number(x.detalle.cantidad) || 0), 0);
    if (!ultima) calidad.push("SIN_HISTORIAL_COMPRAS");
    const proveedorConfigurado = proveedorPorId.get(Number(producto.proveedor_id));
    const ultimoProveedor = ultima ? proveedorPorId.get(Number(ultima.compra.proveedor_id)) : null;
    if (!proveedorConfigurado && !ultimoProveedor) calidad.push("PROVEEDOR_NO_IDENTIFICADO");

    const traspasos = traspasosPorClave.get(claveProductoSucursal(grupo.productoId, grupo.sucursalId)) || { cantidad: 0, numero: 0 };
    expedientes.push({
      producto: { producto_id: producto.id, sku: producto.sku || "", nombre: producto.nombre || "", producto_activo: producto.activo !== false },
      sucursal: { sucursal_id: grupo.sucursalId, sucursal_nombre: sucursal?.nombre || null },
      radar: Object.fromEntries(VENTANAS.map((d) => [`${d}d`, serializarRadar(grupo.ventanas.get(d))])),
      ventas,
      inventario,
      otras_sucursales: otrasSucursales.sort((a, b) => a.sucursal_id - b.sucursal_id),
      traspasos: { cantidad_entrante_en_transito: traspasos.cantidad, numero_traspasos_entrantes: traspasos.numero },
      compras_historicas: {
        ultima_recepcion_fecha: ultima?.fecha || null,
        ultima_recepcion_sucursal_id: ultima ? Number(ultima.compra.sucursal_id) : null,
        ultima_recepcion_sucursal_nombre: ultima ? sucursalPorId.get(Number(ultima.compra.sucursal_id))?.nombre || null : null,
        ultimo_proveedor_id: ultima ? Number(ultima.compra.proveedor_id) : null,
        ultimo_proveedor_nombre: ultimoProveedor?.nombre || null,
        ultimo_costo: ultima ? Number(ultima.detalle.costo) || 0 : null,
        unidades_recibidas_90d: historico.filter((x) => estaEnVentana(x.fecha, fechaFin, 90)).reduce((s, x) => s + (Number(x.detalle.cantidad) || 0), 0),
        unidades_recibidas_180d: historico.filter((x) => estaEnVentana(x.fecha, fechaFin, 180)).reduce((s, x) => s + (Number(x.detalle.cantidad) || 0), 0),
        costo_promedio_historico_ponderado: cantidadTotal > 0 ? costoTotal / cantidadTotal : null,
      },
      proveedores: {
        proveedor_configurado_id: proveedorConfigurado ? Number(proveedorConfigurado.id) : null,
        proveedor_configurado_nombre: proveedorConfigurado?.nombre || null,
        ultimo_proveedor_recepcion_id: ultimoProveedor ? Number(ultimoProveedor.id) : null,
        ultimo_proveedor_recepcion_nombre: ultimoProveedor?.nombre || null,
      },
      calidad_datos: [...new Set(calidad)],
    });
  }

  const productosNoManejados = libresPorIdentidad.map((libre) => ({
    identidad_textual: libre.identidad_textual,
    producto_solicitado: libre.producto_solicitado, marca: libre.marca, modelo: libre.modelo,
    variante: libre.variante, categoria: libre.categoria, solicitudes: libre.solicitudes,
    formas_distintas: libre.formas_distintas, formas: libre.formas,
    cantidad_solicitada: libre.cantidad_solicitada, contactos_distintos: libre.contactos.size,
    sucursales: libre.sucursales.size, sucursal_ids: [...libre.sucursales].sort((a, b) => a - b),
    primera_solicitud: libre.primera_solicitud, ultima_solicitud: libre.ultima_solicitud,
    motivos: Object.fromEntries([...libre.motivos].sort(([a], [b]) => a.localeCompare(b))),
    radar_30d: serializarRadar(libre.radar30d),
  }));

  return {
    periodo: { fecha_fin: fechaFin, ventanas_dias: [...VENTANAS], fecha_inicio_180d: inicioVentana(fechaFin, 180) },
    productos: expedientes.sort((a, b) => a.producto.producto_id - b.producto.producto_id || a.sucursal.sucursal_id - b.sucursal.sucursal_id),
    productos_no_manejados: productosNoManejados.sort((a, b) => b.solicitudes - a.solicitudes || a.identidad_textual.localeCompare(b.identidad_textual)),
    capacidades: { pedidos_proveedor_disponibles: false },
  };
}

module.exports = { obtenerEvidenciaCompras, VENTANAS };
