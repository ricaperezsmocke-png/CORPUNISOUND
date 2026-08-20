/**
 * radarDemanda.js — Núcleo de negocio del Radar de Demanda.
 *
 * Una demanda registra algo que un cliente pidió y que no se pudo vender.
 * Este módulo no crea productos, clientes ni ventas y no modifica inventario.
 * Todas las funciones que reciben alcance fallan cerrado para registros de
 * otra sucursal. El historial es append-only y solo se expone mediante copias.
 */

const MOTIVOS_DEMANDA = Object.freeze([
  "SIN_EXISTENCIA",
  "NO_MANEJAMOS",
  "OTRA_MARCA",
  "OTRA_VARIANTE",
  "PRECIO",
  "TIEMPO_ENTREGA",
  "OTRO",
]);

const ESTADOS_DEMANDA = Object.freeze([
  "REGISTRADA",
  "EN_SEGUIMIENTO",
  "PRODUCTO_DISPONIBLE",
  "CLIENTE_CONTACTADO",
  "CONVERTIDA",
  "NO_CONVERTIDA",
  "CANCELADA",
]);

const TRANSICIONES_PERMITIDAS = Object.freeze({
  REGISTRADA: Object.freeze([
    "EN_SEGUIMIENTO", "PRODUCTO_DISPONIBLE", "CLIENTE_CONTACTADO",
    "CONVERTIDA", "NO_CONVERTIDA", "CANCELADA",
  ]),
  EN_SEGUIMIENTO: Object.freeze([
    "PRODUCTO_DISPONIBLE", "CLIENTE_CONTACTADO", "CONVERTIDA",
    "NO_CONVERTIDA", "CANCELADA",
  ]),
  PRODUCTO_DISPONIBLE: Object.freeze([
    "EN_SEGUIMIENTO", "CLIENTE_CONTACTADO", "CONVERTIDA",
    "NO_CONVERTIDA", "CANCELADA",
  ]),
  CLIENTE_CONTACTADO: Object.freeze([
    "EN_SEGUIMIENTO", "PRODUCTO_DISPONIBLE", "CONVERTIDA",
    "NO_CONVERTIDA", "CANCELADA",
  ]),
  CONVERTIDA: Object.freeze([]),
  NO_CONVERTIDA: Object.freeze([]),
  CANCELADA: Object.freeze([]),
});

const CAMPOS_INMUTABLES = new Set([
  "id", "usuario_id", "vendedor_id", "sucursal_id", "fecha_registro",
  "producto_nombre_registrado", "producto_sku_registrado", "estado",
]);

const CAMPOS_EDITABLES = new Set([
  "cliente_id", "producto_id", "producto_buscado", "marca_solicitada",
  "modelo_solicitado", "variante_solicitada", "categoria_solicitada",
  "cantidad", "motivo_no_venta", "notas", "requiere_seguimiento",
  "nombre_contacto", "telefono_contacto", "fecha_seguimiento",
  "venta_recuperada_id",
]);

const ESTADOS_PENDIENTES = new Set([
  "REGISTRADA", "EN_SEGUIMIENTO", "PRODUCTO_DISPONIBLE", "CLIENTE_CONTACTADO",
]);

function normalizarRadarDemanda(DB) {
  if (!DB.radar_demanda || typeof DB.radar_demanda !== "object") {
    DB.radar_demanda = {};
  }
  if (!Array.isArray(DB.radar_demanda.registros)) DB.radar_demanda.registros = [];
  if (!Array.isArray(DB.radar_demanda.seguimientos)) DB.radar_demanda.seguimientos = [];
  const ahora = new Date().toISOString();
  DB.radar_demanda.registros = DB.radar_demanda.registros
    .filter((item) => item && typeof item === "object");
  DB.radar_demanda.registros.forEach((item) => {
    Object.assign(item, {
      cliente_id: null, producto_id: null,
      producto_nombre_registrado: "", producto_sku_registrado: "",
      producto_buscado: "", marca_solicitada: "", modelo_solicitado: "",
      variante_solicitada: "", categoria_solicitada: "", cantidad: 1,
      motivo_no_venta: "OTRO", notas: "", requiere_seguimiento: false,
      nombre_contacto: "", telefono_contacto: "", estado: "REGISTRADA",
      fecha_seguimiento: null, fecha_registro: ahora,
      fecha_actualizacion: item.fecha_registro || ahora,
      venta_recuperada_id: null, vendedor_id: null,
      ...item,
    });
  });
  DB.radar_demanda.seguimientos = DB.radar_demanda.seguimientos
    .filter((item) => item && typeof item === "object");
  DB.radar_demanda.seguimientos.forEach((item) => {
    Object.assign(item, {
      usuario_id: null, fecha_hora: ahora, tipo: "SEGUIMIENTO", comentario: "",
      estado_anterior: null, estado_nuevo: null, ...item,
    });
  });
  const ultimoRegistro = DB.radar_demanda.registros.reduce(
    (max, item) => Math.max(max, Number(item.id) || 0), 0
  );
  const ultimoSeguimiento = DB.radar_demanda.seguimientos.reduce(
    (max, item) => Math.max(max, Number(item.id) || 0), 0
  );
  DB.radar_demanda.ultimo_id = Math.max(
    Number.isInteger(DB.radar_demanda.ultimo_id) ? DB.radar_demanda.ultimo_id : 0,
    ultimoRegistro
  );
  DB.radar_demanda.ultimo_seguimiento_id = Math.max(
    Number.isInteger(DB.radar_demanda.ultimo_seguimiento_id)
      ? DB.radar_demanda.ultimo_seguimiento_id : 0,
    ultimoSeguimiento
  );
  return DB.radar_demanda;
}

function copiar(valor) {
  if (valor === undefined) return undefined;
  return JSON.parse(JSON.stringify(valor));
}

function texto(valor) {
  return valor == null ? "" : String(valor).trim();
}

function enteroOpcional(valor, nombre) {
  if (valor === undefined || valor === null || valor === "") return null;
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < 0) throw new Error(`${nombre} no es válido`);
  return numero;
}

function validarCantidad(valor) {
  const cantidad = Number(valor);
  if (!Number.isFinite(cantidad) || cantidad <= 0) {
    throw new Error("La cantidad debe ser mayor que cero");
  }
  return cantidad;
}

function validarMotivo(valor) {
  if (!MOTIVOS_DEMANDA.includes(valor)) {
    throw new Error("El motivo de no venta no es válido");
  }
  return valor;
}

function buscarUsuario(DB, usuarioId) {
  const usuario = (DB.admin?.usuarios || []).find(
    (item) => item.id === Number(usuarioId) && item.activo !== false
  );
  if (!usuario) throw new Error("Usuario autenticado no encontrado o inactivo");
  return usuario;
}

function buscarProducto(DB, productoId) {
  if (productoId == null) return null;
  const producto = (DB["catalogo-productos"]?.productos || []).find(
    (item) => item.id === Number(productoId)
  );
  if (!producto) throw new Error("Producto no encontrado");
  return producto;
}

function validarCliente(DB, clienteId, sucursalId) {
  const id = enteroOpcional(clienteId, "El cliente");
  if (id == null) return null;
  const cliente = (DB.crm?.clientes || []).find((item) => item.id === id);
  if (!cliente) throw new Error("Cliente no encontrado");
  if (id !== 0 && Number(cliente.sucursal_id) !== Number(sucursalId)) {
    throw new Error("Cliente no encontrado");
  }
  return id;
}

function validarVenta(DB, ventaId, sucursalId) {
  const id = enteroOpcional(ventaId, "La venta recuperada");
  if (id == null) return null;
  const venta = (DB.pos?.ventas || []).find((item) => item.id === id);
  if (!venta || Number(venta.sucursal_id) !== Number(sucursalId)) {
    throw new Error("Venta recuperada no encontrada");
  }
  return id;
}

function validarSucursal(DB, sucursalId) {
  const id = Number(sucursalId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Selecciona una sucursal concreta para registrar la demanda");
  }
  if (!(DB.pos?.sucursales || []).some((item) => item.id === id)) {
    throw new Error("Sucursal no encontrada");
  }
  return id;
}

function validarProductoSolicitado(DB, datos) {
  const productoId = enteroOpcional(datos.producto_id, "El producto");
  const producto = buscarProducto(DB, productoId);
  const productoBuscado = texto(datos.producto_buscado);
  if (!producto && !productoBuscado) {
    throw new Error("Selecciona un producto del catálogo o describe el producto buscado");
  }
  return { productoId, producto, productoBuscado };
}

function estaDentroDeAlcance(registro, alcance) {
  if (!alcance || alcance.verTodas === true) return true;
  return Number(registro.sucursal_id) === Number(alcance.sucursalId);
}

function buscarRegistro(DB, id, alcance) {
  const radar = normalizarRadarDemanda(DB);
  const registro = radar.registros.find((item) => item.id === Number(id));
  if (!registro || !estaDentroDeAlcance(registro, alcance)) {
    throw new Error("Demanda no encontrada");
  }
  return registro;
}

function siguienteId(radar, campo, lista) {
  const maximoReal = lista.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0);
  radar[campo] = Math.max(Number(radar[campo]) || 0, maximoReal) + 1;
  return radar[campo];
}

function crearDemanda(DB, datos, contexto) {
  const radar = normalizarRadarDemanda(DB);
  const usuario = buscarUsuario(DB, contexto?.usuarioId);
  const sucursalId = validarSucursal(DB, contexto?.sucursalId);
  const { productoId, producto, productoBuscado } = validarProductoSolicitado(DB, datos);
  const ahora = new Date().toISOString();

  const demanda = {
    id: siguienteId(radar, "ultimo_id", radar.registros),
    sucursal_id: sucursalId,
    usuario_id: usuario.id,
    vendedor_id: usuario.vendedor_id == null ? null : Number(usuario.vendedor_id),
    cliente_id: validarCliente(DB, datos.cliente_id, sucursalId),
    producto_id: productoId,
    producto_nombre_registrado: producto ? texto(producto.nombre) : "",
    producto_sku_registrado: producto ? texto(producto.sku) : "",
    producto_buscado: productoBuscado,
    marca_solicitada: texto(datos.marca_solicitada),
    modelo_solicitado: texto(datos.modelo_solicitado),
    variante_solicitada: texto(datos.variante_solicitada),
    categoria_solicitada: texto(datos.categoria_solicitada),
    cantidad: validarCantidad(datos.cantidad),
    motivo_no_venta: validarMotivo(datos.motivo_no_venta),
    notas: texto(datos.notas),
    requiere_seguimiento: !!datos.requiere_seguimiento,
    nombre_contacto: texto(datos.nombre_contacto),
    telefono_contacto: texto(datos.telefono_contacto),
    estado: "REGISTRADA",
    fecha_seguimiento: datos.fecha_seguimiento ? texto(datos.fecha_seguimiento) : null,
    fecha_registro: ahora,
    fecha_actualizacion: ahora,
    venta_recuperada_id: validarVenta(DB, datos.venta_recuperada_id, sucursalId),
  };

  radar.registros.push(demanda);
  return copiar(demanda);
}

function listarDemandas(DB, alcance, filtros = {}) {
  let lista = normalizarRadarDemanda(DB).registros.filter((item) => estaDentroDeAlcance(item, alcance));
  if (filtros.estado) lista = lista.filter((item) => item.estado === filtros.estado);
  if (filtros.motivo_no_venta) {
    lista = lista.filter((item) => item.motivo_no_venta === filtros.motivo_no_venta);
  }
  if (filtros.vendedor_id != null && filtros.vendedor_id !== "") {
    lista = lista.filter((item) => item.vendedor_id === Number(filtros.vendedor_id));
  }
  if (filtros.cliente_id != null && filtros.cliente_id !== "") {
    lista = lista.filter((item) => item.cliente_id === Number(filtros.cliente_id));
  }
  if (filtros.producto_id != null && filtros.producto_id !== "") {
    lista = lista.filter((item) => item.producto_id === Number(filtros.producto_id));
  }
  if (filtros.fecha_inicio) lista = lista.filter((item) => item.fecha_registro >= filtros.fecha_inicio);
  if (filtros.fecha_fin) lista = lista.filter((item) => item.fecha_registro <= filtros.fecha_fin);
  if (filtros.texto) {
    const buscado = texto(filtros.texto).toLocaleLowerCase("es");
    lista = lista.filter((item) => [
      item.producto_nombre_registrado, item.producto_sku_registrado,
      item.producto_buscado, item.marca_solicitada, item.modelo_solicitado,
      item.variante_solicitada, item.nombre_contacto, item.telefono_contacto,
    ].some((valor) => texto(valor).toLocaleLowerCase("es").includes(buscado)));
  }
  return copiar(lista.sort((a, b) => b.fecha_registro.localeCompare(a.fecha_registro) || b.id - a.id));
}

function obtenerDemanda(DB, id, alcance) {
  return copiar(buscarRegistro(DB, id, alcance));
}

function actualizarDemanda(DB, id, cambios, alcance) {
  const demanda = buscarRegistro(DB, id, alcance);
  for (const clave of Object.keys(cambios || {})) {
    if (CAMPOS_INMUTABLES.has(clave)) {
      throw new Error(`El campo ${clave} es histórico y no puede modificarse`);
    }
    if (!CAMPOS_EDITABLES.has(clave)) {
      throw new Error(`El campo ${clave} no se puede modificar`);
    }
  }

  const candidato = { ...demanda, ...(cambios || {}) };
  const { productoId, producto, productoBuscado } = validarProductoSolicitado(DB, candidato);
  candidato.producto_id = productoId;
  candidato.producto_nombre_registrado = producto ? texto(producto.nombre) : "";
  candidato.producto_sku_registrado = producto ? texto(producto.sku) : "";
  candidato.producto_buscado = productoBuscado;
  candidato.cliente_id = validarCliente(DB, candidato.cliente_id, demanda.sucursal_id);
  candidato.venta_recuperada_id = validarVenta(DB, candidato.venta_recuperada_id, demanda.sucursal_id);
  candidato.cantidad = validarCantidad(candidato.cantidad);
  candidato.motivo_no_venta = validarMotivo(candidato.motivo_no_venta);

  for (const campo of [
    "marca_solicitada", "modelo_solicitado", "variante_solicitada",
    "categoria_solicitada", "notas", "nombre_contacto", "telefono_contacto",
  ]) candidato[campo] = texto(candidato[campo]);
  candidato.requiere_seguimiento = !!candidato.requiere_seguimiento;
  candidato.fecha_seguimiento = candidato.fecha_seguimiento ? texto(candidato.fecha_seguimiento) : null;
  candidato.fecha_actualizacion = new Date().toISOString();

  Object.assign(demanda, candidato);
  return copiar(demanda);
}

function agregarEntradaHistorial(DB, demanda, datos, usuarioId) {
  const radar = normalizarRadarDemanda(DB);
  const usuario = buscarUsuario(DB, usuarioId);
  const entrada = {
    id: siguienteId(radar, "ultimo_seguimiento_id", radar.seguimientos),
    demanda_id: demanda.id,
    usuario_id: usuario.id,
    fecha_hora: new Date().toISOString(),
    tipo: texto(datos.tipo) || "SEGUIMIENTO",
    comentario: texto(datos.comentario),
    estado_anterior: datos.estado_anterior || demanda.estado,
    estado_nuevo: datos.estado_nuevo || demanda.estado,
  };
  radar.seguimientos.push(entrada);
  return copiar(entrada);
}

function agregarSeguimiento(DB, demandaId, datos, alcance, usuarioId) {
  const demanda = buscarRegistro(DB, demandaId, alcance);
  const entrada = agregarEntradaHistorial(DB, demanda, {
    tipo: datos?.tipo,
    comentario: datos?.comentario,
    estado_anterior: demanda.estado,
    estado_nuevo: demanda.estado,
  }, usuarioId);
  demanda.fecha_actualizacion = entrada.fecha_hora;
  return entrada;
}

function cambiarEstado(DB, demandaId, nuevoEstado, datos, alcance, usuarioId) {
  const demanda = buscarRegistro(DB, demandaId, alcance);
  if (!ESTADOS_DEMANDA.includes(nuevoEstado)) throw new Error("El estado de demanda no es válido");
  if (!TRANSICIONES_PERMITIDAS[demanda.estado].includes(nuevoEstado)) {
    throw new Error(`No se permite cambiar de ${demanda.estado} a ${nuevoEstado}`);
  }
  const incluyeVenta = datos && Object.prototype.hasOwnProperty.call(datos, "venta_recuperada_id");
  const ventaRecuperadaId = incluyeVenta
    ? validarVenta(DB, datos.venta_recuperada_id, demanda.sucursal_id)
    : demanda.venta_recuperada_id;
  const anterior = demanda.estado;
  demanda.estado = nuevoEstado;
  if (incluyeVenta) demanda.venta_recuperada_id = ventaRecuperadaId;
  const entrada = agregarEntradaHistorial(DB, demanda, {
    tipo: "CAMBIO_ESTADO",
    comentario: datos?.comentario,
    estado_anterior: anterior,
    estado_nuevo: nuevoEstado,
  }, usuarioId);
  demanda.fecha_actualizacion = entrada.fecha_hora;
  return copiar(demanda);
}

function obtenerHistorial(DB, demandaId, alcance) {
  const demanda = buscarRegistro(DB, demandaId, alcance);
  const historial = normalizarRadarDemanda(DB).seguimientos
    .filter((item) => item.demanda_id === demanda.id)
    .sort((a, b) => a.fecha_hora.localeCompare(b.fecha_hora) || a.id - b.id);
  return copiar(historial);
}

/**
 * Proyecciones de lectura para Radar. Se invocan únicamente después de que la
 * ruta validó autenticación, permiso y alcance de la demanda; no enumeran
 * catálogos ni agregan datos persistidos.
 */
function enriquecerDemanda(DB, demanda) {
  const usuario = (DB.admin?.usuarios || []).find((item) => item.id === Number(demanda.usuario_id));
  const vendedor = (DB.pos?.vendedores || []).find((item) => item.id === Number(demanda.vendedor_id));
  const sucursal = (DB.pos?.sucursales || []).find((item) => item.id === Number(demanda.sucursal_id));
  return {
    ...copiar(demanda),
    usuario_nombre: usuario?.nombre || null,
    vendedor_nombre: vendedor?.nombre || null,
    sucursal_nombre: sucursal?.nombre || null,
  };
}

function enriquecerHistorial(DB, historial) {
  return copiar(historial).map((entrada) => {
    const usuario = (DB.admin?.usuarios || []).find((item) => item.id === Number(entrada.usuario_id));
    return { ...entrada, usuario_nombre: usuario?.nombre || null };
  });
}

function listarVentasCandidatas(DB, demanda, filtros = {}) {
  const limiteSolicitado = Number(filtros.limite);
  const limite = Number.isInteger(limiteSolicitado) && limiteSolicitado > 0
    ? Math.min(limiteSolicitado, 100) : 50;
  const textoBuscado = texto(filtros.texto).toLocaleLowerCase("es");

  for (const campo of ["fecha_inicio", "fecha_fin"]) {
    if (!filtros[campo]) continue;
    const valor = texto(filtros[campo]);
    const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
    const fecha = partes && new Date(`${valor}T00:00:00.000Z`);
    if (!partes || Number.isNaN(fecha.getTime()) || fecha.toISOString().slice(0, 10) !== valor) {
      throw new Error(`${campo} debe ser una fecha válida con formato YYYY-MM-DD`);
    }
  }

  let ventas = (DB.pos?.ventas || []).filter(
    (venta) => Number(venta.sucursal_id) === Number(demanda.sucursal_id)
  );
  if (filtros.fecha_inicio) ventas = ventas.filter((venta) => texto(venta.fecha) >= texto(filtros.fecha_inicio));
  if (filtros.fecha_fin) ventas = ventas.filter((venta) => texto(venta.fecha) <= texto(filtros.fecha_fin));
  if (textoBuscado) {
    ventas = ventas.filter((venta) => {
      const cliente = (DB.crm?.clientes || []).find((item) => item.id === Number(venta.cliente_id));
      return String(venta.id).includes(textoBuscado)
        || texto(cliente?.nombre).toLocaleLowerCase("es").includes(textoBuscado);
    });
  }

  return ventas
    .sort((a, b) => texto(b.fecha).localeCompare(texto(a.fecha)) || Number(b.id) - Number(a.id))
    .slice(0, limite)
    .map((venta) => {
      const cliente = (DB.crm?.clientes || []).find((item) => item.id === Number(venta.cliente_id));
      const vendedor = (DB.pos?.vendedores || []).find((item) => item.id === Number(venta.vendedor_id));
      return {
        id: venta.id,
        fecha: venta.fecha || null,
        total: Number(venta.total) || 0,
        cliente_id: venta.cliente_id ?? null,
        cliente_nombre: cliente?.nombre || "Público en General",
        vendedor_id: venta.vendedor_id ?? null,
        vendedor_nombre: vendedor?.nombre || null,
      };
    });
}

function obtenerResumen(DB, alcance) {
  const registros = listarDemandas(DB, alcance);
  const porEstado = {};
  const porMotivo = {};
  const porSucursal = {};
  let cantidadSolicitada = 0;
  for (const item of registros) {
    porEstado[item.estado] = (porEstado[item.estado] || 0) + 1;
    porMotivo[item.motivo_no_venta] = (porMotivo[item.motivo_no_venta] || 0) + 1;
    porSucursal[item.sucursal_id] = (porSucursal[item.sucursal_id] || 0) + 1;
    cantidadSolicitada += Number(item.cantidad) || 0;
  }
  const convertidas = porEstado.CONVERTIDA || 0;
  return {
    total: registros.length,
    cantidad_solicitada: cantidadSolicitada,
    convertidas,
    tasa_conversion: registros.length ? Math.round((convertidas / registros.length) * 10000) / 100 : 0,
    por_estado: porEstado,
    por_motivo: porMotivo,
    por_sucursal: porSucursal,
  };
}

function validarFechaAnalisis(valor, nombre) {
  if (!valor) return null;
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

function normalizarClave(valor) {
  return texto(valor).replace(/\s+/g, " ").toLocaleLowerCase("es");
}

function porcentaje(numerador, denominador) {
  return denominador ? Math.round((numerador / denominador) * 10000) / 100 : 0;
}

function identidadContacto(item) {
  if (item.cliente_id != null && Number(item.cliente_id) !== 0) return `cliente:${Number(item.cliente_id)}`;
  const telefono = normalizarClave(item.telefono_contacto);
  if (telefono) return `telefono:${telefono}`;
  const nombre = normalizarClave(item.nombre_contacto);
  return nombre ? `nombre:${nombre}` : null;
}

function metricasRegistros(registros) {
  let pendientes = 0, convertidas = 0, noConvertidas = 0, canceladas = 0, cantidad = 0;
  for (const item of registros) {
    cantidad += Number(item.cantidad) || 0;
    if (ESTADOS_PENDIENTES.has(item.estado)) pendientes += 1;
    else if (item.estado === "CONVERTIDA") convertidas += 1;
    else if (item.estado === "NO_CONVERTIDA") noConvertidas += 1;
    else if (item.estado === "CANCELADA") canceladas += 1;
  }
  return {
    total: registros.length,
    cantidad_solicitada: cantidad,
    pendientes,
    convertidas,
    no_convertidas: noConvertidas,
    canceladas,
    tasa_conversion: porcentaje(convertidas, convertidas + noConvertidas),
    tasa_recuperacion: porcentaje(convertidas, pendientes + convertidas + noConvertidas),
  };
}

function obtenerAnalisis(DB, alcance, filtros = {}) {
  const { fechaLocal } = require("./fechas");
  const fechaInicio = validarFechaAnalisis(filtros.fecha_inicio, "fecha_inicio");
  const fechaFin = validarFechaAnalisis(filtros.fecha_fin, "fecha_fin") || fechaLocal();
  if (fechaInicio && fechaInicio > fechaFin) throw new Error("fecha_inicio debe ser anterior o igual a fecha_fin");

  // Lectura pura: no se llama normalizarRadarDemanda porque ese helper repara
  // estructuras antiguas in-place. El análisis jamás debe modificar DB.
  const todosAlcance = (Array.isArray(DB.radar_demanda?.registros) ? DB.radar_demanda.registros : [])
    .filter((item) => estaDentroDeAlcance(item, alcance));
  const registros = todosAlcance.filter((item) => {
    // fecha_registro es un instante ISO UTC; se convierte primero al día que
    // vivió la tienda y luego se compara como YYYY-MM-DD (orden lexicográfico).
    const fecha = fechaLocal(item.fecha_registro);
    return (!fechaInicio || fecha >= fechaInicio) && fecha <= fechaFin;
  });
  const resumen = metricasRegistros(registros);
  resumen.seguimientos_vencidos = registros.filter((item) =>
    item.requiere_seguimiento && ESTADOS_PENDIENTES.has(item.estado)
      && item.fecha_seguimiento && texto(item.fecha_seguimiento).slice(0, 10) < fechaLocal()
  ).length;

  const sucursalesPorId = new Map((DB.pos?.sucursales || []).map((item) => [Number(item.id), item]));
  const productos = new Map(), noManejados = new Map(), sucursales = new Map();
  const motivosConteo = new Map(MOTIVOS_DEMANDA.map((motivo) => [motivo, 0]));
  const evolucionConteo = new Map();

  for (const item of registros) {
    motivosConteo.set(item.motivo_no_venta, (motivosConteo.get(item.motivo_no_venta) || 0) + 1);
    const fecha = fechaLocal(item.fecha_registro);
    const dia = evolucionConteo.get(fecha) || { fecha, demandas: 0, cantidad_solicitada: 0, convertidas: 0 };
    dia.demandas += 1; dia.cantidad_solicitada += Number(item.cantidad) || 0;
    if (item.estado === "CONVERTIDA") dia.convertidas += 1;
    evolucionConteo.set(fecha, dia);

    const sucursalId = Number(item.sucursal_id);
    if (!sucursales.has(sucursalId)) sucursales.set(sucursalId, []);
    sucursales.get(sucursalId).push(item);

    const catalogado = item.producto_id != null;
    const clave = catalogado
      ? `producto:${Number(item.producto_id)}`
      : `libre:${[item.producto_buscado, item.marca_solicitada, item.modelo_solicitado, item.variante_solicitada, item.categoria_solicitada].map(normalizarClave).join("|")}`;
    if (!productos.has(clave)) productos.set(clave, {
      producto: catalogado ? texto(item.producto_nombre_registrado) : texto(item.producto_buscado),
      sku: catalogado ? texto(item.producto_sku_registrado) : "",
      catalogado, solicitudes: 0, cantidad_solicitada: 0, contactos: new Set(),
      sucursales: new Set(), convertidas: 0, no_convertidas: 0,
    });
    const grupo = productos.get(clave);
    grupo.solicitudes += 1;
    grupo.cantidad_solicitada += Number(item.cantidad) || 0;
    grupo.sucursales.add(sucursalId);
    const contacto = identidadContacto(item); if (contacto) grupo.contactos.add(contacto);
    if (item.estado === "CONVERTIDA") grupo.convertidas += 1;
    if (item.estado === "NO_CONVERTIDA") grupo.no_convertidas += 1;

    if (item.motivo_no_venta === "NO_MANEJAMOS") {
      const claveNo = [item.producto_buscado || item.producto_nombre_registrado, item.marca_solicitada, item.modelo_solicitado, item.categoria_solicitada].map(normalizarClave).join("|");
      if (!noManejados.has(claveNo)) noManejados.set(claveNo, {
        producto: texto(item.producto_buscado || item.producto_nombre_registrado), marca: texto(item.marca_solicitada),
        modelo: texto(item.modelo_solicitado), categoria: texto(item.categoria_solicitada), solicitudes: 0,
        cantidad_solicitada: 0, sucursales: new Set(), contactos: new Set(), ultima_solicitud: fecha,
      });
      const grupoNo = noManejados.get(claveNo);
      grupoNo.solicitudes += 1; grupoNo.cantidad_solicitada += Number(item.cantidad) || 0;
      grupoNo.sucursales.add(sucursalId); if (contacto) grupoNo.contactos.add(contacto);
      if (fecha > grupoNo.ultima_solicitud) grupoNo.ultima_solicitud = fecha;
    }
  }

  const ventasPorId = new Map((DB.pos?.ventas || []).map((venta) => [Number(venta.id), venta]));
  const ventasRecuperadas = new Map();
  for (const item of registros) {
    if (item.estado !== "CONVERTIDA" || item.venta_recuperada_id == null) continue;
    const venta = ventasPorId.get(Number(item.venta_recuperada_id));
    if (venta && Number(venta.sucursal_id) === Number(item.sucursal_id) && estaDentroDeAlcance(venta, alcance)) {
      ventasRecuperadas.set(Number(venta.id), venta);
    }
  }

  let evolucion = [...evolucionConteo].sort(([a], [b]) => a.localeCompare(b)).map(([, dia]) => dia);
  if (fechaInicio) {
    const dias = Math.round((new Date(`${fechaFin}T00:00:00Z`) - new Date(`${fechaInicio}T00:00:00Z`)) / 86400000) + 1;
    if (dias <= 366) evolucion = Array.from({ length: dias }, (_, i) => {
      const fecha = sumarDias(fechaInicio, i);
      return evolucionConteo.get(fecha) || { fecha, demandas: 0, cantidad_solicitada: 0, convertidas: 0 };
    });
  }

  function comparar(dias) {
    const inicioActual = sumarDias(fechaFin, -(dias - 1));
    const finAnterior = sumarDias(inicioActual, -1);
    const inicioAnterior = sumarDias(finAnterior, -(dias - 1));
    const actuales = todosAlcance.filter((item) => fechaLocal(item.fecha_registro) >= inicioActual && fechaLocal(item.fecha_registro) <= fechaFin).length;
    const anteriores = todosAlcance.filter((item) => fechaLocal(item.fecha_registro) >= inicioAnterior && fechaLocal(item.fecha_registro) <= finAnterior).length;
    const muestraSuficiente = actuales + anteriores >= 5;
    const variacion = anteriores ? Math.round(((actuales - anteriores) / anteriores) * 10000) / 100 : null;
    return {
      dias, muestra_suficiente: muestraSuficiente, actual: actuales, anterior: anteriores,
      variacion_porcentual: variacion,
      clasificacion: actuales > anteriores ? "crecimiento" : actuales < anteriores ? "disminucion" : "estable",
    };
  }

  return copiar({
    periodo: { fecha_inicio: fechaInicio, fecha_fin: fechaFin }, resumen,
    productos: [...productos.values()].map(({ contactos, sucursales: ids, ...item }) => ({ ...item, contactos_identificados: contactos.size, sucursales: ids.size })).sort((a, b) => b.solicitudes - a.solicitudes),
    productos_no_manejados: [...noManejados.values()].map(({ contactos, sucursales: ids, ...item }) => ({ ...item, contactos_interesados: contactos.size, sucursales: ids.size })).sort((a, b) => b.solicitudes - a.solicitudes),
    sucursales: [...sucursales].map(([id, items]) => { const m = metricasRegistros(items); return { sucursal_id: id, sucursal_nombre: sucursalesPorId.get(id)?.nombre || `Sucursal ${id}`, demandas: m.total, cantidad_solicitada: m.cantidad_solicitada, pendientes: m.pendientes, convertidas: m.convertidas, no_convertidas: m.no_convertidas, tasa_recuperacion: m.tasa_recuperacion }; }).sort((a, b) => b.demandas - a.demandas),
    motivos: MOTIVOS_DEMANDA.map((motivo) => ({ motivo, cantidad: motivosConteo.get(motivo) || 0, porcentaje: porcentaje(motivosConteo.get(motivo) || 0, registros.length) })),
    recuperacion: { demandas_convertidas: resumen.convertidas, demandas_no_convertidas: resumen.no_convertidas, pendientes: resumen.pendientes, tasa_recuperacion: resumen.tasa_recuperacion, ventas_recuperadas: ventasRecuperadas.size, valor_recuperado: [...ventasRecuperadas.values()].reduce((total, venta) => total + (Number(venta.total) || 0), 0) },
    evolucion, comparaciones: { ultimos_7_dias: comparar(7), ultimos_30_dias: comparar(30) },
  });
}

module.exports = {
  MOTIVOS_DEMANDA,
  ESTADOS_DEMANDA,
  TRANSICIONES_PERMITIDAS,
  normalizarRadarDemanda,
  crearDemanda,
  listarDemandas,
  obtenerDemanda,
  actualizarDemanda,
  agregarSeguimiento,
  cambiarEstado,
  obtenerHistorial,
  obtenerResumen,
  obtenerAnalisis,
  enriquecerDemanda,
  enriquecerHistorial,
  listarVentasCandidatas,
};
