/**
 * condicionesPago.js — Descuento/recargo configurable por forma de pago,
 * y por sucursal (ej. "en esta sucursal deshabilitamos el descuento en
 * efectivo por el costo logístico").
 *
 * Guarda un % de descuento por cada forma de pago. Se aplica sobre el
 * total del ticket al momento de cobrar.
 */

function siguienteId(lista) {
  return lista.length ? Math.max(...lista.map((x) => x.id)) + 1 : 1;
}

const FORMAS_PAGO_DEFAULT = ["EFECTIVO", "TARJETA", "VALES", "CHEQUE", "TRANSFERENCIA", "CRÉDITO"];

function asegurarSeed(DB, sucursal_id) {
  const existentes = DB.pos.condiciones_pago.filter((c) => c.sucursal_id === sucursal_id);
  if (existentes.length > 0) return;
  FORMAS_PAGO_DEFAULT.forEach((nombre) => {
    DB.pos.condiciones_pago.push({
      id: siguienteId(DB.pos.condiciones_pago),
      sucursal_id,
      nombre,
      descuento_pct: (nombre === "EFECTIVO" || nombre === "TRANSFERENCIA") ? 6 : 0,
      activo: true,
    });
  });
}

function listarCondiciones(DB, sucursal_id = 1) {
  asegurarSeed(DB, sucursal_id);
  return DB.pos.condiciones_pago.filter((c) => c.sucursal_id === sucursal_id);
}

function actualizarCondicion(DB, id, datos) {
  const idx = DB.pos.condiciones_pago.findIndex((c) => c.id === Number(id));
  if (idx === -1) throw new Error("Condición de pago no encontrada");
  DB.pos.condiciones_pago[idx] = {
    ...DB.pos.condiciones_pago[idx],
    descuento_pct: datos.descuento_pct !== undefined ? Number(datos.descuento_pct) : DB.pos.condiciones_pago[idx].descuento_pct,
    activo: datos.activo !== undefined ? !!datos.activo : DB.pos.condiciones_pago[idx].activo,
  };
  return DB.pos.condiciones_pago[idx];
}

module.exports = { listarCondiciones, actualizarCondicion };
