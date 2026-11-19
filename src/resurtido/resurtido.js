export function piezas(diezmilesimas) { return Number(diezmilesimas) / 10000; }
export const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export function textoExplicacion(d) {
  const ventana = d.dias_historia === 365 ? '12 meses' : `${d.dias_historia} días`;
  const limites = d.minimo == null ? 'Sin cálculo de mínimo y máximo.' : `Mínimo ${d.minimo}, máximo ${d.maximo}.`;
  return `Vendió ${d.piezas_vendidas} piezas en los últimos ${ventana} (${d.venta_mensual_simple} al mes). `
    + `Estuvo ${d.dias_en_cero} días en cero. Por temporada de ${MESES[d.mes_calculo - 1]} se ajusta ×${d.factor}. ${limites}`;
}
export function textoEstado(fila) {
  return { agotado: 'Agotado', bajo_minimo: 'Bajo mínimo', bien: 'Bien', sobre_maximo: 'Sobre máximo' }[fila.estado] || 'Sin cálculo';
}
export function textoCalidad(fila) {
  if (fila.calidad === 'aproximada') return 'Aproximado: algunos días en cero se calcularon hacia atrás';
  return fila.calidad === 'observada' ? 'Observado: todos los días tienen registros reales' : 'Sin cálculo';
}
