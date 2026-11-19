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
const CORTO = { 1: 'Oco', 2: 'Yaj', 3: 'SC', 4: 'Pal' };
export function textoWhatsApp(datos, fechaTexto) {
  const lineas = datos.renglones.map(r => {
    // El sugerido de solo lectura trae `sugerido`; el pedido guardado trae lo que quedó `pedido`.
    const reparto = r.por_tienda.map(t => `${CORTO[t.sucursal_id] || t.sucursal_id} ${piezas(t.pedido ?? t.sugerido)}`).join(', ');
    return `${r.clave} ${r.descripcion} — ${piezas(r.total)} (${reparto})`;
  });
  // Una tienda atrasada no entra al pedido: el texto copiado lo dice para que no se mande incompleto sin saberlo.
  const nombres = ids => (ids || []).map(id => NOMBRE[id] || String(id));
  const fuera = nombres(datos.tiendas_atrasadas), tarde = nombres(datos.tiendas_fuera_de_tiempo);
  return [`Pedido ${datos.marca} — ${fechaTexto}`, ...(lineas.length ? lineas : ['No hay nada que pedir.']),
    ...(fuera.length ? [`Sin datos al día, NO incluidas: ${fuera.join(', ')}`] : []),
    ...(tarde.length ? [`Sin visto bueno a tiempo, NO incluidas: ${tarde.join(', ')}`] : [])].join('\n');
}
// Solo aviso: no cambia ningún número del pedido.
export function textoSobra(sobra) {
  if (!sobra?.length) return '';
  return `Antes de comprar: ${sobra.map(s => `${NOMBRE[s.sucursal_id] || s.sucursal_id} tiene ${piezas(s.piezas)} de sobra`).join(', ')}`;
}
const ESTADOS_PEDIDO = { borrador: 'Borrador', en_revision: 'En revisión de tiendas', aprobado: 'Aprobado',
  enviado: 'Enviado al proveedor', surtido: 'Surtido', cancelado: 'Cancelado' };
export function textoEstadoPedido(estado) { return ESTADOS_PEDIDO[estado] || estado; }
// Misma regla que el servidor (que es quien la hace cumplir): subir más del doble de lo sugerido pide motivo.
export function necesitaMotivo(renglon, piezasNuevas) {
  const nuevo = Number(piezasNuevas) * 10000;
  return nuevo > 2 * renglon.sugerido && nuevo > renglon.pedido;
}
export function cambiosTienda(renglones, valores, motivos) {
  return renglones.filter(r => valores[r.clave] !== undefined && valores[r.clave] !== ''
    && Number(valores[r.clave]) * 10000 !== r.pedido)
    .map(r => ({ clave: r.clave, pedido: Number(valores[r.clave]), motivo: String(motivos[r.clave] || '').trim() }));
}
export function estadoTiendas(renglones) {
  const porTienda = new Map();
  for (const r of renglones) {
    const t = porTienda.get(r.sucursal_id) || { sucursal_id: r.sucursal_id, estado: 'listo', marcados: 0 };
    if (r.estado === 'fuera_de_tiempo') t.estado = 'fuera_de_tiempo';
    else if (!r.visto_bueno_por && t.estado === 'listo') t.estado = 'pendiente';
    t.marcados += r.marcado ? 1 : 0;
    porTienda.set(r.sucursal_id, t);
  }
  return [...porTienda.values()].sort((a, b) => a.sucursal_id - b.sucursal_id);
}
const NOMBRE = { 1: 'Ocosingo', 2: 'Yajalón', 3: 'San Cristóbal', 4: 'Palenque' };
const POR_QUE_NO = { sin_movimiento: ': no se ha vendido en el año', no_se_mueve: ': tiene existencia y no se vende' };
export function textoSugerido(d) {
  if (d.sugerido == null) return 'Datos atrasados: no se sugiere.';
  if (!(d.sugerido > 0)) {
    const razon = POR_QUE_NO[d.lista];
    if (razon) return `No se sugiere pedir${razon}. Corrige el máximo a mano si quieres pedirlo.`;
    if (!(d.maximo > 0)) return 'No se sugiere pedir.';
    const viene = d.en_camino > 0 ? ` y lo que viene en camino (${d.en_camino})` : '';
    return `No se sugiere pedir: con lo que hay (${Math.max(d.existencia, 0)})${viene} llega a su máximo (${d.maximo}).`;
  }
  const hay = Math.max(d.existencia, 0), exacto = d.maximo - hay - d.en_camino === d.sugerido;
  return `Se sugiere pedir ${d.sugerido} (máximo ${d.maximo} − hay ${hay} − en camino ${d.en_camino}`
    + `${exacto ? '' : ', redondeado a pieza entera'}).`;
}
export function textoEstado(fila) {
  return { agotado: 'Agotado', bajo_minimo: 'Bajo mínimo', bien: 'Bien', sobre_maximo: 'Sobre máximo', sin_pedir: 'No se pide' }[fila.estado] || 'Sin cálculo';
}
export function textoCalidad(fila) {
  if (fila.calidad === 'aproximada') return 'Aproximado: algunos días en cero se calcularon hacia atrás';
  return fila.calidad === 'observada' ? 'Observado: todos los días tienen registros reales' : 'Sin cálculo';
}
