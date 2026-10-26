/**
 * Siembra v1 del manual de tácticas: las 30 del documento docs/superpowers/specs/2026-10-24-manual-tacticas-v1.md,
 * tal cual. Victor y el gerente de ventas las corrigen después dentro del sistema.
 * Las "Excluidas a propósito" no son tácticas: son el texto fijo EXCLUIDAS_TEXTO.
 */
const CAMINOS = {
  calidad: 'calidad_dato',
  prospectos: 'prospectos',
  conversion: 'conversion',
  compras: 'compras_por_cliente',
  venta: 'venta_promedio',
  margen: 'margen',
};

// Candado de cada número (tabla 4.1 del spec de Cinco Caminos). Sin candado: null.
const CANDADOS = {
  pct_con_cliente: null,
  clientes_nuevos: 'pct_con_cliente',
  conversion: 'registros_por_10_tickets',
  registros_por_10_tickets: null,
  recompra_90: 'pct_con_cliente',
  ticket_promedio_centavos: 'articulos_por_ticket',
  articulos_por_ticket: 'ticket_promedio_centavos',
  pct_instrumento_con_accesorio: null,
  margen: null,
  descuento_promedio: null,
};

const CA = 'pct_con_cliente';
const CN = 'clientes_nuevos';
const CV = 'conversion';
const RC = 'recompra_90';
const TP = 'ticket_promedio_centavos';
const AT = 'articulos_por_ticket';
const IA = 'pct_instrumento_con_accesorio';
const S = 'sistema';
const E = 'evidencia';
const SE = 'sistema_y_evidencia';
const F3 = 'fase_3';
const PARCIAL = 'El sistema lo mide solo en parte.';

// [numero, nombre, camino, quien, numero_que_mueve, como_se_mide, referencia_pdf, descripcion]
const FILAS = [
  [1, 'Teléfono y nombre del cliente en toda venta de más de $500', CAMINOS.calidad, ['cajera', 'vendedor'], CA, S, '', ''],
  [2, 'Nunca "público en general" si el cliente dio su nombre', CAMINOS.calidad, ['cajera'], CA, S, 'PDF Transacciones 4', ''],
  [3, 'Visitar 4 iglesias, escuelas o maestros de música al mes', CAMINOS.prospectos, ['encargado', 'gerente'], CN, SE, 'PDF 1', ''],
  [4, 'Preguntar "¿quién te mandó?" y anotarlo', CAMINOS.prospectos, ['vendedor'], CN, E, 'PDF 71',
    'El sistema lo medirá cuando exista el campo.'],
  [5, 'Una clínica o demostración al mes en tienda, con asistentes registrados', CAMINOS.prospectos, ['encargado'], CN, SE, 'PDF 30, 69', ''],
  [6, 'Cotizar 2 escuelas o municipios al mes', CAMINOS.prospectos, ['gerente'], CN, E, 'PDF 52', ''],
  [7, '3 publicaciones por semana de producto con existencia, en redes y MercadoLibre', CAMINOS.prospectos, ['encargado'], CN, E, 'PDF 64, 47', ''],
  [8, 'Aparador y banqueta renovados cada mes', CAMINOS.prospectos, ['encargado'], CN, E, 'PDF 55, 67', ''],
  [9, 'Toda persona que pregunta y no compra va al Radar con su motivo', CAMINOS.conversion, ['vendedor'], 'registros_por_10_tickets', S,
    'PDF 67, 53', 'Es la base de la conversión.'],
  [10, 'Seguimiento en 48 h a todo registro del Radar con intención real', CAMINOS.conversion, ['vendedor'], CV, SE, 'PDF 14', PARCIAL],
  [11, 'Los 20 productos más pedidos en el Radar nunca en cero', CAMINOS.conversion, ['compras'], CV, S, 'PDF 71', ''],
  [12, 'Ofrecer Coppel Pay / Atrato / apartado en toda venta de más de $3,000', CAMINOS.conversion, ['vendedor'], CV, S, 'PDF 40',
    'Mueve la conversión y el ticket.'],
  [13, 'Dejar probar el instrumento o el equipo en tienda', CAMINOS.conversion, ['vendedor'], CV, E, 'PDF 18, 64', ''],
  [14, 'Toda cotización grande se manda por WhatsApp como plan y se le da seguimiento', CAMINOS.conversion, ['vendedor'], CV, E, 'PDF 65', ''],
  [15, 'Un tema de producto por semana con el equipo', CAMINOS.conversion, ['encargado'], CV, E, 'PDF 26, 45', ''],
  [16, 'Recordatorio de cambio de cuerdas a los 60–90 días', CAMINOS.compras, ['vendedor'], RC, SE, 'PDF 61, 15', PARCIAL],
  [17, 'Contactar en el mes la lista fija de clientes VIP sin compra en 6 meses', CAMINOS.compras, ['encargado'], RC, S, 'PDF 24, 32', ''],
  [18, 'Avisar novedades a quien compró algo afín, sin descuento', CAMINOS.compras, ['vendedor'], RC, E, 'PDF 50', ''],
  [19, 'Calendario y presupuesto de iglesias y escuelas anotados en el CRM', CAMINOS.compras, ['gerente'], RC, E, 'PDF 45', ''],
  [20, 'Un evento para clientes frecuentes por trimestre', CAMINOS.compras, ['encargado'], RC, E, 'PDF 21', ''],
  [21, 'Kit instrumento + accesorios: funda, afinador, cuerdas, cable', CAMINOS.venta, ['vendedor'], IA, S, 'PDF 14, 81', ''],
  [22, 'Paquetes armados en SICAR: "kit principiante", "kit iglesia"', CAMINOS.venta, ['encargado'], AT, S, 'PDF 11', ''],
  [23, 'Lista de verificación de accesorios pegada en mostrador', CAMINOS.venta, ['encargado'], AT, E, 'PDF 19, 44', ''],
  [24, 'Mostrar primero la opción de mejor calidad', CAMINOS.venta, ['vendedor'], TP, E, 'PDF 47', ''],
  [25, 'Entrega a domicilio cobrada en pedidos grandes', CAMINOS.venta, ['encargado'], TP, S, 'PDF 36, 7', ''],
  [26, 'Descuento solo con permiso y con nombre de quien lo autorizó', CAMINOS.margen, ['gerente'], 'descuento_promedio', F3, 'PDF 27', ''],
  [27, 'Rematar lo que tiene más de 180 días, con margen mínimo', CAMINOS.margen, ['compras'], 'margen', F3, 'PDF 61', ''],
  [28, 'Comprar según el Radar y la rotación', CAMINOS.margen, ['compras'], 'margen', F3, 'PDF 48, 63', ''],
  [29, 'Negociar volumen desde CEDIS', CAMINOS.margen, ['compras'], 'margen', F3, 'PDF 5, 12', ''],
  [30, 'Empujar accesorios y marcas de mayor margen', CAMINOS.margen, ['vendedor'], 'margen', F3, 'PDF 59', ''],
];

const TACTICAS_V1 = FILAS.map(([numero, nombre, camino, quien, numeroQueMueve, comoSeMide, referencia, descripcion]) => ({
  numero_v1: numero,
  nombre,
  descripcion,
  camino,
  numero_que_mueve: numeroQueMueve,
  candado: CANDADOS[numeroQueMueve],
  quien,
  como_se_mide: comoSeMide,
  referencia_pdf: referencia,
}));

const EXCLUIDAS_TEXTO = '2x1, 4x3 y descuentos como táctica (comen margen); deshacerse de clientes C/D o atender solo clientes A '
  + '(en pueblo, el que hoy compra cuerdas mañana compra el bafle); subir precios contra MercadoLibre; comprar, rentar o vender '
  + 'bases de datos (ilegal por la ley de protección de datos); subir niveles de crédito; equipos solo a comisión; no pagar '
  + 'tiempo extra; publicidad cara (TV, cine, dirigibles), libro, multinivel.';

module.exports = { TACTICAS_V1, EXCLUIDAS_TEXTO, CANDADOS };
