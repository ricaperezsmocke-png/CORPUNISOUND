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
  const anterior = demanda.estado;
  demanda.estado = nuevoEstado;
  if (datos && Object.prototype.hasOwnProperty.call(datos, "venta_recuperada_id")) {
    demanda.venta_recuperada_id = validarVenta(DB, datos.venta_recuperada_id, demanda.sucursal_id);
  }
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
};
