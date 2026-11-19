export function piezas(diezmilesimas) { return Number(diezmilesimas) / 10000; }
export function textoTemporada(d) {
  return d.temporada_origen === 'sicar' ? 'Temporada medida en SICAR de San Cristóbal (2022–2025)'
    : 'Temporada calculada con las ventas de las cuatro tiendas';
}
export function textoPedidoEspecial(d) {
  return d.piezas_pedido_especial > 0
    ? `${d.piezas_pedido_especial} piezas vendidas en tickets grandes se tomaron como pedido especial y no suben el mínimo.` : '';
}
export const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export function textoExplicacion(d) {
  const ventana = d.dias_historia === 365 ? '12 meses' : `${d.dias_historia} días`;
  const limites = d.minimo == null ? 'Sin cálculo de mínimo y máximo.' : `Mínimo ${d.minimo}, máximo ${d.maximo}.`;
  return `Vendió ${d.piezas_vendidas} piezas en los últimos ${ventana} (${d.venta_mensual_simple} al mes). `
    + `Estuvo ${d.dias_en_cero} días en cero. Por temporada de ${MESES[d.mes_calculo - 1]} se ajusta ×${d.factor}. ${limites}`;
}
export function textoEstado(fila) {
  return { agotado: 'Agotado', bajo_minimo: 'Bajo mínimo', bien: 'Bien', sobre_maximo: 'Sobre máximo', sin_pedir: 'No se pide' }[fila.estado] || 'Sin cálculo';
}
export function textoCalidad(fila) {
  if (fila.calidad === 'aproximada') return 'Aproximado: algunos días en cero se calcularon hacia atrás';
  return fila.calidad === 'observada' ? 'Observado: todos los días tienen registros reales' : 'Sin cálculo';
}
