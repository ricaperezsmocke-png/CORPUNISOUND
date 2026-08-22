const { ErrorRadar } = require("./errores");

/**
 * CONVERTIDA significa que el cliente volvió y compró.
 *
 * Sin venta ligada, "convertida" es una afirmación sin respaldo: inflaría la
 * recuperación sin haber vendido nada. La demanda que no se recuperó tiene su
 * propio estado: NO_CONVERTIDA.
 */
function exigirVentaParaConvertir(nuevoEstado, ventaId) {
  if (nuevoEstado === "CONVERTIDA" && (ventaId === null || ventaId === undefined)) {
    throw new ErrorRadar(
      "Para dar por convertida la demanda hay que ligar la venta con la que se recuperó",
      400
    );
  }
  return ventaId;
}

/**
 * Una demanda ya convertida debe conservar la venta que respalda su cierre.
 * La venta puede corregirse por otra válida, pero nunca borrarse.
 */
function exigirVentaEnDemandaConvertida(estado, ventaId) {
  if (estado === "CONVERTIDA" && (ventaId === null || ventaId === undefined)) {
    throw new ErrorRadar(
      "Una demanda convertida debe conservar una venta ligada",
      400
    );
  }
  return ventaId;
}

/**
 * Una venta no puede figurar como recuperación de dos demandas distintas: se
 * contaría dos veces en los indicadores.
 */
function exigirVentaNoUsada(registros, ventaId, demandaId) {
  if (ventaId === null || ventaId === undefined) return ventaId;
  const ocupada = registros.find(
    (item) => Number(item.venta_recuperada_id) === Number(ventaId) && item.id !== demandaId
  );
  if (ocupada) {
    throw new ErrorRadar(
      `Esa venta ya está ligada a la demanda ${ocupada.id}`,
      409
    );
  }
  return ventaId;
}

module.exports = {
  exigirVentaParaConvertir,
  exigirVentaEnDemandaConvertida,
  exigirVentaNoUsada,
};
