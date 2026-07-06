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
  solicitar_vendedor_al_cerrar_venta: false,
  permitir_ventas_sin_existencia: true,
  permitir_cambio_en_todas_las_formas_de_pago: false,
  descuentos_pago_habilitado: true,
  dias_seguimiento_postventa: 7,
};

function obtenerConfiguracion(DB) {
  if (!DB.pos.configuracion) DB.pos.configuracion = { ...CONFIG_DEFAULT };
  return DB.pos.configuracion;
}

function actualizarConfiguracion(DB, cambios) {
  const actual = obtenerConfiguracion(DB);
  DB.pos.configuracion = { ...actual, ...cambios };
  return DB.pos.configuracion;
}

module.exports = { obtenerConfiguracion, actualizarConfiguracion, CONFIG_DEFAULT };
