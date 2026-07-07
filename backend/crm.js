/**
 * crm.js — Capa de inteligencia del CRM.
 *
 * A diferencia de clientes.js (que solo hace CRUD de los datos básicos del
 * cliente), este archivo NUNCA guarda compras a mano: las calcula siempre
 * cruzando pos.ventas + pos.venta_detalle por cliente_id. Así el historial
 * de compras del CRM y las ventas reales del Punto de Venta nunca se
 * desincronizan — son la misma fuente de datos, vista desde dos módulos.
 */

function hoy() {
  return new Date().toISOString().slice(0, 10);
}

function diasDesde(fechaISO) {
  if (!fechaISO) return 999;
  const f = fechaISO.length > 10 ? fechaISO.slice(0, 10) : fechaISO;
  return Math.floor((new Date(hoy()) - new Date(f)) / 86400000);
}

/** Historial de compras real de un cliente, derivado de las ventas del POS */
function comprasDeCliente(DB, clienteId) {
  const ventas = DB.pos.ventas.filter((v) => v.cliente_id === Number(clienteId) && v.estatus === "cerrada");
  const productos = DB["catalogo-productos"].productos;
  return ventas
    .map((v) => {
      const detalle = DB.pos.venta_detalle.filter((d) => d.venta_id === v.id);
      const nombres = detalle.map((d) => productos.find((p) => p.id === d.producto_id)?.nombre).filter(Boolean);
      return {
        venta_id: v.id,
        fecha: v.fecha,
        producto: nombres.length ? nombres.join(", ") : "Venta sin detalle",
        monto: v.total,
        sucursal_id: v.sucursal_id,
      };
    })
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
}

/** Score 0-100: combina monto total, frecuencia de compra y qué tan reciente fue la última */
function calcularScore(compras) {
  const total = compras.reduce((a, c) => a + c.monto, 0);
  const frecuencia = compras.length;
  const ultima = compras.length ? compras[compras.length - 1].fecha : null;
  const recencia = ultima ? Math.max(0, 100 - diasDesde(ultima)) : 0;
  return Math.round(Math.min(100, Math.min(40, total / 500) + Math.min(30, frecuencia * 10) + recencia * 0.3));
}

/** Segmento de valor según qué tan reciente fue su última compra */
function calcularSegmento(compras) {
  const ultima = compras.length ? compras[compras.length - 1].fecha : null;
  if (!ultima) return "inactivo";
  const d = diasDesde(ultima);
  return d <= 30 ? "activo" : d <= 90 ? "en_riesgo" : "inactivo";
}

/** Alertas automáticas de seguimiento */
function calcularAlertas(cliente, segmento) {
  const alertas = [];
  const d = diasDesde(cliente.ultimo_contacto);
  if (d >= 30) alertas.push("sin_contacto");
  if (cliente.estado === "interesado" && d >= 3) alertas.push("pendiente");
  if (segmento === "en_riesgo") alertas.push("riesgo");
  return alertas;
}

/** Lista enriquecida de clientes para el CRM (excluye "Público en General", id 0) */
function listarClientesCRM(DB, alcance) {
  return DB.crm.clientes
    .filter((c) => c.id !== 0)
    .filter((c) => !alcance || alcance.verTodas || Number(c.sucursal_id) === alcance.sucursalId)
    .map((c) => {
      const compras = comprasDeCliente(DB, c.id);
      const score = calcularScore(compras);
      const segmento = calcularSegmento(compras);
      const alertas = calcularAlertas(c, segmento);
      return { ...c, compras, score, segmento, alertas };
    });
}

function obtenerClienteCRM(DB, id) {
  const c = DB.crm.clientes.find((x) => x.id === Number(id));
  if (!c) throw new Error("Cliente no encontrado");
  const compras = comprasDeCliente(DB, c.id);
  return { ...c, compras, score: calcularScore(compras), segmento: calcularSegmento(compras), alertas: calcularAlertas(c, calcularSegmento(compras)) };
}

function cambiarEstadoCliente(DB, id, estado) {
  const cliente = DB.crm.clientes.find((c) => c.id === Number(id));
  if (!cliente) throw new Error("Cliente no encontrado");
  cliente.estado = estado;
  cliente.ultimo_contacto = hoy();
  return cliente;
}

function siguienteId(lista) {
  return lista.length ? Math.max(...lista.map((x) => x.id)) + 1 : 1;
}

function registrarContacto(DB, clienteId, { tipo, resultado, venta_id }) {
  const cliente = DB.crm.clientes.find((c) => c.id === Number(clienteId));
  if (!cliente) throw new Error("Cliente no encontrado");
  const contacto = {
    id: siguienteId(DB.crm.contactos_cliente),
    cliente_id: Number(clienteId),
    fecha: hoy(),
    tipo,
    resultado,
    venta_id: venta_id ? Number(venta_id) : null,
  };
  DB.crm.contactos_cliente.push(contacto);
  cliente.ultimo_contacto = hoy();
  return contacto;
}

function listarContactos(DB, clienteId) {
  return DB.crm.contactos_cliente
    .filter((c) => c.cliente_id === Number(clienteId))
    .sort((a, b) => b.fecha.localeCompare(a.fecha));
}

/**
 * Ventas cerradas que ya cumplieron los "días para seguimiento postventa"
 * configurados, y todavía NO tienen un contacto tipo "postventa" registrado.
 * "Público en General" (id 0) se excluye porque no hay a quién contactar.
 */
function obtenerSeguimientosPostventaPendientes(DB, diasConfigurados, alcance) {
  const dias = Number(diasConfigurados) || 0;
  if (dias <= 0) return [];

  const productos = DB["catalogo-productos"].productos;

  return DB.pos.ventas
    .filter((v) => v.estatus === "cerrada" && v.cliente_id !== 0)
    .filter((v) => !alcance || alcance.verTodas || Number(v.sucursal_id) === alcance.sucursalId)
    .filter((v) => diasDesde(v.fecha) >= dias)
    .filter((v) => !DB.crm.contactos_cliente.some((c) => c.venta_id === v.id && c.tipo === "postventa"))
    .map((v) => {
      const cliente = DB.crm.clientes.find((c) => c.id === v.cliente_id);
      if (!cliente) return null;
      const detalle = DB.pos.venta_detalle.filter((d) => d.venta_id === v.id);
      const nombresProductos = detalle
        .map((d) => d.descripcion || productos.find((p) => p.id === d.producto_id)?.nombre)
        .filter(Boolean);
      return {
        venta_id: v.id,
        cliente_id: cliente.id,
        cliente_nombre: cliente.nombre,
        telefono: cliente.telefono,
        fecha_venta: v.fecha,
        dias_transcurridos: diasDesde(v.fecha),
        productos: nombresProductos,
        total: v.total,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.dias_transcurridos - a.dias_transcurridos);
}

/** Resumen por sucursal (para el tab Dashboard del CRM) */
function resumenPorSucursal(DB, alcance) {
  const clientes = listarClientesCRM(DB, alcance);
  const sucursales = !alcance || alcance.verTodas
    ? DB.pos.sucursales
    : DB.pos.sucursales.filter((s) => s.id === alcance.sucursalId);
  return sucursales.map((s) => {
    const cs = clientes.filter((c) => c.sucursal_id === s.id);
    const ventas = cs.reduce((a, c) => a + c.compras.reduce((b, p) => b + p.monto, 0), 0);
    return { sucursal_id: s.id, nombre: s.nombre, clientes: cs.length, ventas, convertidos: cs.filter((c) => c.estado === "compro").length };
  });
}

/** Ranking de vendedores (para el tab Dashboard del CRM) */
function rankingVendedores(DB, alcance) {
  const clientes = listarClientesCRM(DB, alcance);
  const vendedores = !alcance || alcance.verTodas
    ? DB.pos.vendedores
    : DB.pos.vendedores.filter((v) => Number(v.sucursal_id) === alcance.sucursalId);
  return vendedores.map((v) => {
    const cs = clientes.filter((c) => c.vendedor_asignado_id === v.id);
    const ventas = cs.reduce((a, c) => a + c.compras.reduce((b, p) => b + p.monto, 0), 0);
    return { vendedor_id: v.id, nombre: v.nombre, clientes: cs.length, ventas, convertidos: cs.filter((c) => c.estado === "compro").length };
  }).sort((a, b) => b.ventas - a.ventas);
}

module.exports = {
  comprasDeCliente, listarClientesCRM, obtenerClienteCRM, cambiarEstadoCliente,
  registrarContacto, listarContactos, resumenPorSucursal, rankingVendedores,
  obtenerSeguimientosPostventaPendientes,
};
