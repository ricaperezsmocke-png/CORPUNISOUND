/**
 * pedidosMarcados.js — "Ya lo pedí": silenciar una fila de Compras tres semanas.
 *
 * POR QUÉ EXISTE: este sistema no sabe qué mercancía ya se le pidió al
 * proveedor. Una compra, aquí, es mercancía QUE YA LLEGÓ —se registra y sube la
 * existencia en el acto—, así que el pedido hecho y no recibido no está en
 * ninguna parte. Sin ese dato, la pantalla de Compras seguiría pidiendo el
 * mismo producto todas las semanas que tarde el proveedor, y obedecerla
 * significa comprar de más y dejar dinero parado en mercancía.
 *
 * DECISIÓN DE VICTOR (2026-09-20): nada de capturar fecha de entrega ni de
 * montar una bitácora de pedidos con responsable y conciliación. Se marca la
 * fila y se silencia TRES SEMANAS. Si a las tres semanas no ha llegado, vuelve
 * a salir sola, que es justo cuando conviene volver a mirarla.
 *
 * SILENCIAR NO ES ESCONDER: la fila se sigue viendo, con quién la marcó y
 * cuántos días le quedan. Deja de presentarse como una compra por hacer, nada
 * más. Esconderla sería peor: nadie podría revisar lo que está esperando.
 *
 * LO QUE ESTO NO ES: no registra una compra, no crea una orden, no toca
 * catálogo ni inventario, no sube existencia. Es una nota del Radar sobre sus
 * propias filas, y vive en su propia colección. Cuando la mercancía llegue de
 * verdad, se recibe por donde se ha recibido siempre.
 *
 * Toda marca lleva nombre y fecha: una operación sin nombre encima es una
 * operación que nadie puede explicar después.
 */

const { fechaLocal } = require("../fechas");

/** Tres semanas. Lo decidió Victor; no se cambia sin decisión suya. */
const DIAS_SILENCIO = 21;

/**
 * LEER NO ESCRIBE. Consultar la evidencia de Compras no puede crear la
 * colección ni tocar nada: hay pruebas que congelan que una consulta deja el
 * DB exactamente igual, y con razón — una lectura que muta es una lectura que
 * puede corromper. Por eso hay dos funciones y no una.
 */
function leer(DB) {
  const lista = DB.radar_demanda?.pedidos_marcados;
  return Array.isArray(lista) ? lista : [];
}

/** Solo para escribir: asegura la colección antes de guardar una marca. */
function normalizar(DB) {
  if (!DB.radar_demanda || typeof DB.radar_demanda !== "object") DB.radar_demanda = {};
  if (!Array.isArray(DB.radar_demanda.pedidos_marcados)) DB.radar_demanda.pedidos_marcados = [];
  return DB.radar_demanda.pedidos_marcados;
}

function sumarDias(dia, dias) {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

function exigirProductoYSucursal(DB, datos) {
  const productoId = Number(datos?.producto_id);
  const sucursalId = Number(datos?.sucursal_id);
  const productos = DB["catalogo-productos"]?.productos || [];
  if (!Number.isInteger(productoId) || !productos.some((p) => Number(p.id) === productoId)) {
    throw new Error("Producto no encontrado en el catálogo");
  }
  const sucursales = DB.pos?.sucursales || [];
  if (!Number.isInteger(sucursalId) || !sucursales.some((s) => Number(s.id) === sucursalId)) {
    throw new Error("Sucursal no encontrada");
  }
  return { productoId, sucursalId };
}

const mismaFila = (marca, productoId, sucursalId) => Number(marca.producto_id) === productoId
  && Number(marca.sucursal_id) === sucursalId;

/**
 * Marca (o vuelve a marcar) un producto de una tienda como ya pedido. Volver a
 * marcarlo renueva el plazo desde hoy en vez de duplicar la nota.
 */
function marcarPedido(DB, datos, usuario, hoy = fechaLocal()) {
  const { productoId, sucursalId } = exigirProductoYSucursal(DB, datos);
  const lista = normalizar(DB);
  const previa = lista.find((marca) => mismaFila(marca, productoId, sucursalId));
  const marca = {
    producto_id: productoId,
    sucursal_id: sucursalId,
    fecha_marca: hoy,
    vence: sumarDias(hoy, DIAS_SILENCIO),
    marcado_por: usuario?.nombre || "",
    marcado_por_id: usuario?.id ?? null,
  };
  if (previa) Object.assign(previa, marca);
  else lista.push(marca);
  return previa || marca;
}

/** Quita la marca: la mercancía llegó antes, o el pedido se canceló. */
function quitarMarcaPedido(DB, datos, usuario, hoy = fechaLocal()) {
  const { productoId, sucursalId } = exigirProductoYSucursal(DB, datos);
  const lista = normalizar(DB);
  const indice = lista.findIndex((marca) => mismaFila(marca, productoId, sucursalId));
  if (indice === -1) return null;
  const [quitada] = lista.splice(indice, 1);
  return { ...quitada, quitada_por: usuario?.nombre || "", fecha_baja: hoy };
}

/** La marca si el silencio sigue vigente ese día; null si caducó o no existe. */
function pedidoVigente(DB, productoId, sucursalId, hoy = fechaLocal()) {
  const marca = leer(DB).find(
    (item) => mismaFila(item, Number(productoId), Number(sucursalId))
  );
  if (!marca) return null;
  return String(hoy) <= String(marca.vence) ? marca : null;
}

/**
 * Cómo se ve el estado en el expediente de Compras. Siempre devuelve el mismo
 * juego de campos, marcado o no, para que la pantalla no tenga que adivinar.
 */
function estadoPedido(DB, productoId, sucursalId, hoy = fechaLocal()) {
  const marca = pedidoVigente(DB, productoId, sucursalId, hoy);
  if (!marca) {
    return { marcado: false, fecha_marca: null, vence: null, dias_restantes: null, marcado_por: null };
  }
  const restantes = Math.round(
    (new Date(`${marca.vence}T12:00:00Z`) - new Date(`${hoy}T12:00:00Z`)) / 86400000
  );
  return {
    marcado: true,
    fecha_marca: marca.fecha_marca,
    vence: marca.vence,
    dias_restantes: Math.max(0, restantes),
    marcado_por: marca.marcado_por || null,
  };
}

function listarPedidosMarcados(DB) {
  return leer(DB).map((marca) => ({ ...marca }));
}

module.exports = {
  DIAS_SILENCIO,
  marcarPedido,
  quitarMarcaPedido,
  pedidoVigente,
  estadoPedido,
  listarPedidosMarcados,
};
