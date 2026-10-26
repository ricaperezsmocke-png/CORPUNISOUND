/**
 * Metas de tienda que se miden con los cinco caminos (spec 2026-10-26, Task 1).
 *
 * La cifra meta es un entero (`valor_meta`, 1 a 1,000,000) y la unidad la pone el servidor, no el usuario:
 * porcentajes en décimas de punto (452 = 45.2 %), ticket en centavos, clientes nuevos por semana en enteros y
 * artículos por ticket en centésimas (185 = 1.85). Solo LEE el tablero; nunca escribe.
 */
const { numerosSemana, registrosDeTienda, promedio } = require('./tablero');
const { semanaDe, sumarDias } = require('./semanas');
const { finDePeriodo } = require('../metasPeriodos');

const PREFIJO = 'cinco_caminos:';
const MAX_ENTERO = 1000000;
const decimas = { escala: 'decimas', maximo: 1000, factor: 10 };

const NUMEROS_META = {
  pct_con_cliente: { ...decimas, unidad: '%', etiqueta: 'Ventas con cliente identificado', leer: s => s.pct_con_cliente },
  recompra_90: { ...decimas, unidad: '%', etiqueta: 'Clientes que recompran en 90 días', leer: s => s.recompra_90 },
  pct_instrumento_con_accesorio: { ...decimas, unidad: '%', etiqueta: 'Ventas de instrumento con accesorio',
    leer: s => s.pct_instrumento_con_accesorio },
  conversion: { ...decimas, unidad: '%', etiqueta: 'Conversión del Radar de Demanda',
    leer: s => (s.radar.no_confiable === true ? null : s.radar.conversion) },
  ticket_promedio_centavos: { escala: 'centavos', maximo: MAX_ENTERO, factor: 1, unidad: 'centavos',
    etiqueta: 'Ticket promedio', leer: s => s.ticket_promedio_centavos },
  clientes_nuevos: { escala: 'entero', maximo: MAX_ENTERO, factor: 1, unidad: 'clientes por semana',
    etiqueta: 'Clientes nuevos por semana', leer: s => s.clientes_nuevos },
  articulos_por_ticket: { escala: 'centesimas', maximo: MAX_ENTERO, factor: 100, unidad: 'artículos por ticket',
    etiqueta: 'Artículos por ticket', leer: s => s.articulos_por_ticket },
};

const esFuenteNumero = fuente => typeof fuente === 'string' && fuente.startsWith(PREFIJO) && Object.hasOwn(NUMEROS_META, fuente.slice(PREFIJO.length));
const numeroDeFuente = fuente => fuente.slice(PREFIJO.length);

// Lunes de las semanas que empiezan dentro del periodo.
function lunesDelPeriodo(periodo, inicio) {
  const fin = finDePeriodo(periodo, inicio);
  const { lunes } = semanaDe(inicio);
  const lista = [];
  for (let l = lunes < inicio ? sumarDias(lunes, 7) : lunes; l <= fin; l = sumarDias(l, 7)) lista.push(l);
  return lista;
}

/**
 * Valor de un número de los cinco caminos en un periodo: promedio de las semanas cuyo lunes cae dentro del periodo y
 * cuyo domingo ya pasó, saltando las semanas sin dato. Sin ninguna semana válida: `valor: null` (sin dato).
 */
function valorDelPeriodo(sqlite, DB, { sucursal_id, numero, periodo, inicio, hoy }) {
  const def = NUMEROS_META[numero];
  if (!def) throw new Error('El número de los cinco caminos no es válido');
  const registrosTienda = registrosDeTienda(DB, Number(sucursal_id));
  const validas = [];
  for (const lunes of lunesDelPeriodo(periodo, inicio)) {
    if (sumarDias(lunes, 6) >= hoy) continue;
    const s = numerosSemana(sqlite, DB, { sucursal_id, lunes }, { registrosTienda, conBaseRadar: numero === 'conversion' });
    if (s.sin_dato) continue;
    const crudo = promedio([s], def.leer, 6);
    if (crudo !== null) validas.push({ lunes, crudo, semana: s });
  }
  if (!validas.length) return { valor: null, semanas: [], sin_dato: true };
  const media = promedio(validas.map(v => v.semana), def.leer, 6);
  return {
    valor: Math.round(media * def.factor),
    semanas: validas.map(v => ({ lunes: v.lunes, valor: Math.round(v.crudo * def.factor) })),
    sin_dato: false,
  };
}

module.exports = { NUMEROS_META, PREFIJO, esFuenteNumero, numeroDeFuente, valorDelPeriodo };
