/**
 * reportes.js — Agregaciones de solo lectura para el módulo Reportes.
 *
 * Cada función recibe (DB, filtros, alcance) y filtra primero por sucursal
 * con filtrarPorSucursal (mismo patrón que ya usa compras.listarRecepciones)
 * antes de agregar — así ningún reporte se puede usar para ver datos fuera
 * del alcance de un usuario amarrado a una sucursal.
 */

const { filtrarPorSucursal } = require("./auth");

function redondear(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function enRango(fecha, desde, hasta) {
  if (desde && fecha < desde) return false;
  if (hasta && fecha > hasta) return false;
  return true;
}

module.exports = { redondear, enRango };
