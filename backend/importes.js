/**
 * importes.js — El techo de lo que el sistema puede registrar como dinero.
 *
 * La cantidad y el precio de una línea se validaban por separado, pero nunca su
 * PRODUCTO. `1e308` es un número finito y positivo, así que pasaba limpio por la
 * guarda de cantidad; al multiplicarlo por el precio, el importe se desbordaba a
 * `Infinity` (y en apartados a `NaN`, porque `Infinity * 0` es `NaN`).
 *
 * Lo que eso dejaba: el corte de la caja en `Infinity` —imposible de cuadrar
 * para quien cuenta el cajón—, la existencia del producto en `-1e+308`, y en
 * apartados una guarda que fallaba ABRIENDO, porque `anticipo > NaN` es false.
 *
 * EL TECHO: `redondear()` multiplica por 100 para trabajar en centavos, así que
 * el mayor importe que se puede representar sin perder exactitud es
 * `MAX_SAFE_INTEGER / 100`. Por encima de eso las cifras dejan de ser confiables
 * aunque JavaScript siga operando con ellas.
 *
 * Nadie vende por esas cifras: el tope no le estorba a ninguna operación real
 * —son más de 90 mil millones de pesos en una sola línea— y solo se alcanza
 * mandando la petición a mano, nunca desde la pantalla.
 *
 * Estas funciones son PURAS: no leen ni escriben la base. Las comparten los tres
 * caminos que registran importes (ventas, apartados y la importación de
 * MercadoLibre) para que la regla viva en un solo sitio.
 */

/** Mayor importe representable en centavos sin perder exactitud. */
const TOPE_IMPORTE = Math.floor(Number.MAX_SAFE_INTEGER / 100);

/** Un importe válido es un número finito dentro del rango de centavos. */
function esImporteValido(n) {
  return Number.isFinite(n) && Math.abs(n) <= TOPE_IMPORTE;
}

/**
 * Exige que un importe ya calculado sea registrable. `descripcion` es lo que ve
 * quien está cobrando, para que el error diga de qué artículo se trata.
 */
function exigirImporte(n, descripcion) {
  if (!esImporteValido(n)) {
    throw new Error(`El importe de "${descripcion || "el artículo"}" es una cifra que el sistema no puede registrar`);
  }
  return n;
}

/**
 * Exige que la cantidad de una línea sea vendible: número finito, mayor que
 * cero y dentro del rango de centavos. El tope de arriba es el que faltaba.
 */
function exigirCantidad(valor, descripcion) {
  const cantidad = Number(valor);
  if (!Number.isFinite(cantidad) || cantidad <= 0) {
    throw new Error(`La cantidad de "${descripcion || "el artículo"}" debe ser mayor que cero`);
  }
  if (cantidad > TOPE_IMPORTE) {
    throw new Error(`La cantidad de "${descripcion || "el artículo"}" es una cifra que el sistema no puede registrar`);
  }
  return cantidad;
}

/** Exige un importe registrable que no represente una cantidad negativa. */
function exigirImporteNoNegativo(n, descripcion) {
  exigirImporte(n, descripcion);
  if (n < 0) throw new Error(`El importe de "${descripcion || "el artículo"}" no puede ser negativo`);
  return n;
}

module.exports = { TOPE_IMPORTE, esImporteValido, exigirImporte, exigirCantidad, exigirImporteNoNegativo };
