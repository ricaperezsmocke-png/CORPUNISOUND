/**
 * fechaRegistro.js — Cómo lee el Radar la fecha de una demanda.
 *
 * `diaLocal` (backend/fechas.js) cae en HOY cuando el valor no se puede
 * interpretar. Ese respaldo es correcto donde nació: una venta importada de
 * MercadoLibre no se puede caer por un ISO raro, y en un punto de venta una
 * fecha de respaldo es preferible a que se detenga la operación.
 *
 * En el Radar ese mismo respaldo miente. Una demanda con la fecha dañada
 * aparece como registrada hoy, infla la demanda reciente y ensucia justo la
 * cifra que se mira para decidir una compra. Aquí la fecha no se inventa:
 * si no se entiende, el registro no entra en ninguna ventana temporal.
 *
 * Sigue existiendo y se puede ver en la lista —no se esconde ni se repara—,
 * simplemente no se cuenta como demanda de un periodo que no le consta a
 * nadie. `backend/fechas.js` no se toca: lo comparten ventas, cortes y gastos.
 */

const { diaLocal } = require("../fechas");

const DIA_SUELTO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Devuelve el día (YYYY-MM-DD) que vivió la tienda, o `null` si el valor no es
 * una fecha interpretable. Nunca devuelve hoy como respaldo.
 */
function diaDeRegistro(valor) {
  if (valor == null) return null;
  if (typeof valor === "string") {
    const limpio = valor.trim();
    if (!limpio) return null;
    if (DIA_SUELTO.test(limpio)) return limpio;
    if (Number.isNaN(new Date(limpio).getTime())) return null;
    return diaLocal(limpio);
  }
  if (valor instanceof Date) {
    return Number.isNaN(valor.getTime()) ? null : diaLocal(valor);
  }
  return null;
}

/** true solo si la fecha se entiende Y cae dentro del periodo. */
function dentroDelPeriodo(valor, inicio, fin) {
  const dia = diaDeRegistro(valor);
  if (dia === null) return false;
  return (!inicio || dia >= inicio) && (!fin || dia <= fin);
}

module.exports = { diaDeRegistro, dentroDelPeriodo };
