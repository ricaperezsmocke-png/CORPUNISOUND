/**
 * configuracion.js — Ajustes generales del Punto de Venta.
 *
 * Solo se implementan las opciones que de verdad cambian el comportamiento
 * del POS hoy. El resto de las casillas que aparecen en SICAR (CFDI, Lotes,
 * Monedero Electrónico, Autologin, Inventario en Ruta...) no tienen un
 * sistema detrás todavía en este proyecto — se muestran en la pantalla
 * mercadas como "no disponible" en vez de fingir que hacen algo.
 */

const CONFIG_DEFAULT = {
  documento_por_defecto: "Ticket",
  cerrar_venta_con_enter: true,
  // Encendida por defecto: Gerencia de Ventas entero cuelga de `vendedor_id`,
  // y apagada la caja no preguntaba NUNCA — toda venta entraba con vendedor
  // nulo, el avance de todas se quedaba en cero y el módulo era inalcanzable
  // desde la caja. Quien no lleve objetivos de venta la apaga en Configuración;
  // el default tiene que ser el que hace que los números existan.
  solicitar_vendedor_al_cerrar_venta: true,
  permitir_ventas_sin_existencia: true,
  permitir_cambio_en_todas_las_formas_de_pago: false,
  descuentos_pago_habilitado: true,
  dias_seguimiento_postventa: 7,
  dias_alerta_garantias: 15,
};

/**
 * Enciende "solicitar vendedor al cerrar venta" en las bases que ya existen.
 *
 * Cambiar el valor de fábrica NO alcanza: la configuración se guarda entera en
 * el SQLite, así que una instalación que ya arrancó conserva el `false` viejo
 * para siempre. En la base real de Unisound eso dejaba la caja sin preguntar
 * nunca por el vendedor —toda venta con vendedor nulo, todos los avances en
 * cero— aunque el default nuevo dijera lo contrario.
 *
 * Se hace UNA sola vez y se deja marcado, para que apagar la casilla a
 * propósito no se vuelva a encender en el siguiente arranque. Mismo patrón que
 * reconciliarSucursalesCedis y reconciliarRoles en server.js.
 */
function reconciliarPedirVendedor(DB) {
  if (!DB.pos) return;
  const config = obtenerConfiguracion(DB);
  if (config._pedir_vendedor_reconciliado) return;
  config.solicitar_vendedor_al_cerrar_venta = true;
  config._pedir_vendedor_reconciliado = true;
}

function obtenerConfiguracion(DB) {
  if (!DB.pos.configuracion) DB.pos.configuracion = { ...CONFIG_DEFAULT };
  return DB.pos.configuracion;
}

function actualizarConfiguracion(DB, cambios) {
  const actual = obtenerConfiguracion(DB);
  DB.pos.configuracion = { ...actual, ...cambios };
  return DB.pos.configuracion;
}

module.exports = { obtenerConfiguracion, actualizarConfiguracion, reconciliarPedirVendedor, CONFIG_DEFAULT };
