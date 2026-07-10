/**
 * sucursales.js — Reconciliación de la sucursal CEDIS (id 6) contra lo que
 * quede persistido en SQLite.
 *
 * server.js siembra DB.pos.sucursales con CEDIS incluido, pero el bloque de
 * restauración de arranque reemplaza esa tabla por completo con lo último
 * guardado en disco. En cualquier instancia que ya tenía datos persistidos
 * ANTES de esta feature (5 sucursales, sin CEDIS, sin sin_ubicacion en la 5),
 * CEDIS desaparecería y MercadoLibre volvería a ser "configurable" por error.
 *
 * Esta función se aplica siempre, después de la restauración, para garantizar
 * que CEDIS exista y que las sucursales 5 y 6 tengan sin_ubicacion=true —
 * sin tocar nada más (ni las sucursales 1-4, ni otros campos de la 5/6).
 * Es idempotente: correrla varias veces da el mismo resultado.
 */

function reconciliarSucursalesCedis(sucursales) {
  const CEDIS = { id: 6, nombre: "CEDIS", ciudad: "Chiapas", sin_ubicacion: true, lat: null, lng: null };
  const conCedis = sucursales.some((s) => s.id === 6) ? sucursales : [...sucursales, CEDIS];
  return conCedis.map((s) => (s.id === 5 || s.id === 6) ? { ...s, sin_ubicacion: true } : s);
}

module.exports = { reconciliarSucursalesCedis };
