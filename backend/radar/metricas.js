/**
 * La única definición de conversión y recuperación de Radar.
 *
 * Antes había dos: /resumen dividía las convertidas entre TODOS los registros
 * y /analisis entre los cierres decididos. Con los mismos datos, un tablero
 * decía 10% y el otro 100%. Las fórmulas de aquí son las aprobadas, y se
 * devuelve numerador y denominador para que el número se pueda comprobar a
 * mano.
 */

const ESTADOS_PENDIENTES = new Set([
  "REGISTRADA", "EN_SEGUIMIENTO", "PRODUCTO_DISPONIBLE", "CLIENTE_CONTACTADO",
]);

function porcentaje(numerador, denominador) {
  return denominador ? Math.round((numerador / denominador) * 10000) / 100 : 0;
}

function calcularMetricas(registros) {
  let pendientes = 0, convertidas = 0, noConvertidas = 0, canceladas = 0, cantidad = 0;
  for (const item of registros) {
    cantidad += Number(item.cantidad) || 0;
    if (ESTADOS_PENDIENTES.has(item.estado)) pendientes += 1;
    else if (item.estado === "CONVERTIDA") convertidas += 1;
    else if (item.estado === "NO_CONVERTIDA") noConvertidas += 1;
    else if (item.estado === "CANCELADA") canceladas += 1;
  }
  const denominadorConversion = convertidas + noConvertidas;
  const denominadorRecuperacion = pendientes + convertidas + noConvertidas;
  return {
    total: registros.length,
    cantidad_solicitada: cantidad,
    pendientes,
    convertidas,
    no_convertidas: noConvertidas,
    canceladas,
    tasa_conversion: porcentaje(convertidas, denominadorConversion),
    tasa_recuperacion: porcentaje(convertidas, denominadorRecuperacion),
    conversion_detalle: { numerador: convertidas, denominador: denominadorConversion },
    recuperacion_detalle: { numerador: convertidas, denominador: denominadorRecuperacion },
  };
}

module.exports = { ESTADOS_PENDIENTES, porcentaje, calcularMetricas };
