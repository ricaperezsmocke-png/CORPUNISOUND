/**
 * Tablero semanal de los cinco caminos por tienda (spec 2026-10-24, sección 4.1).
 *
 * Solo LEE: las ventas SICAR con cliente (`sicar_ventas`), las de mostrador (`sicar_ventas_mostrador`), sus detalles,
 * el catálogo de artículos de SICAR y el Radar. Nunca escribe en SQLite ni en el JSON.
 *
 * - Dinero en centavos enteros; porcentajes con un decimal; `null` cuando no hay denominador.
 * - Las cuentas se hacen en SQL (COUNT/SUM/GROUP BY): la historia de una tienda son decenas de miles de ventas.
 * - "Sin dato" (`sin_dato` + `motivo`): tienda sin agente (`sin_agente`), semana sin ventas de mostrador vigentes
 *   (`sin_mostrador`) o menos de 30 ventas vigentes (`pocas_ventas`). Los números se devuelven igual, pero no se califican.
 */
const { clasificarEstadoDemanda } = require('../radar/metricas');
const { diaLocal } = require('../fechas');
const { semanaAnterior, mismaSemanaAnio, ultimasSemanas, sumarDias, exigirLunes } = require('./semanas');

const MINIMO_VENTAS = 30;
const SEMANAS_BASE = 8;
// Si los registros del Radar por cada 10 tickets caen más de 30% contra su base, la conversión no es confiable.
const CAIDA_NO_CONFIABLE = 0.7;
const TIPOS = new Set(['instrumento', 'accesorio']);

const redondear = (valor, decimales) => {
  const f = 10 ** decimales;
  return Math.round(valor * f) / f;
};
const pct = (numerador, denominador) => (denominador ? redondear((numerador * 100) / denominador, 1) : null);

function errorConEstado(status, mensaje) {
  const e = new Error(mensaje);
  e.status = status;
  return e;
}

function sucursalValida(valor) {
  const id = typeof valor === 'number' || typeof valor === 'string' ? Number(valor) : NaN;
  if (!Number.isSafeInteger(id) || id <= 0) throw errorConEstado(400, 'La tienda es inválida.');
  return id;
}

// Rango de una semana sobre `fecha_local` ('YYYY-MM-DDTHH:MM:SS'): desde el lunes y antes del lunes siguiente.
// Comparar como texto contra días sueltos es exacto: '2026-10-19' < '2026-10-19T00:00:00'.
const VIGENTES_CLIENTE = `FROM sicar_ventas WHERE sucursal_id = @suc AND estado = 'vigente'
  AND fecha_local >= @desde AND fecha_local < @hasta`;
const VIGENTES_MOSTRADOR = `FROM sicar_ventas_mostrador WHERE sucursal_id = @suc AND estado = 'vigente'
  AND fecha_local >= @desde AND fecha_local < @hasta`;

// "Con cliente" = cliente identificado que NO es cuenta interna de la tienda (`sicar_internas`). La venta de una cuenta
// interna o una vigente sin cli_id sigue siendo venta, pero cuenta como sin cliente.
const CON_CLIENTE = `cli_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sicar_internas i
  WHERE i.sucursal_id = sicar_ventas.sucursal_id AND i.cli_id = sicar_ventas.cli_id)`;

const SQL_TOTALES = `SELECT
  (SELECT COUNT(*) ${VIGENTES_CLIENTE}) AS ventas_cliente,
  (SELECT COUNT(*) ${VIGENTES_CLIENTE} AND ${CON_CLIENTE}) AS con_cliente,
  (SELECT COALESCE(SUM(total_centavos), 0) ${VIGENTES_CLIENTE}) AS centavos_cliente,
  (SELECT COUNT(*) ${VIGENTES_MOSTRADOR}) AS ventas_mostrador,
  (SELECT COALESCE(SUM(total_centavos), 0) ${VIGENTES_MOSTRADOR}) AS centavos_mostrador,
  EXISTS (SELECT 1 FROM sicar_tiendas WHERE sucursal_id = @suc) AS con_agente`;

// Clientes identificados de la semana (uno por cli_id, sin cuentas internas): nuevos si no tienen venta vigente anterior en toda la
// historia de la tienda; recompra si tienen otra venta vigente en los 90 días previos al lunes.
const SQL_CLIENTES = `SELECT COUNT(*) AS clientes,
  COALESCE(SUM(NOT EXISTS (SELECT 1 FROM sicar_ventas p WHERE p.sucursal_id = s.sucursal_id AND p.cli_id = s.cli_id
    AND p.estado = 'vigente' AND p.fecha_local < @desde)), 0) AS nuevos,
  COALESCE(SUM(EXISTS (SELECT 1 FROM sicar_ventas p WHERE p.sucursal_id = s.sucursal_id AND p.cli_id = s.cli_id
    AND p.estado = 'vigente' AND p.fecha_local >= @hace90 AND p.fecha_local < @desde)), 0) AS recompra
  FROM (SELECT DISTINCT sucursal_id, cli_id ${VIGENTES_CLIENTE} AND ${CON_CLIENTE}) s`;

// Renglones de las ventas vigentes de la semana (con cliente y de mostrador), tipificados con las reglas del gerente.
// Una regla con categoría gana a la del departamento entero. La cantidad se suma en diezmilésimas enteras.
const SQL_DETALLE = `WITH reglas AS (
    SELECT json_extract(value, '$.departamento') AS d, json_extract(value, '$.categoria') AS c,
      json_extract(value, '$.tipo') AS t FROM json_each(@reglas)
  ), renglones AS (
    SELECT 'c' AS origen, d.ven_id, d.art_id, d.cantidad FROM sicar_ventas v
      JOIN sicar_detalles d ON d.sucursal_id = v.sucursal_id AND d.ven_id = v.ven_id
      WHERE v.sucursal_id = @suc AND v.estado = 'vigente' AND v.fecha_local >= @desde AND v.fecha_local < @hasta
    UNION ALL
    SELECT 'm', d.ven_id, d.art_id, d.cantidad FROM sicar_ventas_mostrador v
      JOIN sicar_detalles_mostrador d ON d.sucursal_id = v.sucursal_id AND d.ven_id = v.ven_id
      WHERE v.sucursal_id = @suc AND v.estado = 'vigente' AND v.fecha_local >= @desde AND v.fecha_local < @hasta
  ), tipos AS (
    SELECT r.origen, r.ven_id, CAST(ROUND(CAST(r.cantidad AS REAL) * 10000) AS INTEGER) AS diezmilesimas,
      COALESCE((SELECT t FROM reglas WHERE d = a.departamento AND c = a.categoria LIMIT 1),
        (SELECT t FROM reglas WHERE d = a.departamento AND c IS NULL LIMIT 1)) AS tipo
    FROM renglones r LEFT JOIN sicar_articulos a ON a.sucursal_id = @suc AND a.art_id = r.art_id
  ), por_venta AS (
    SELECT origen, ven_id, MAX(tipo = 'instrumento') AS instrumento, MAX(tipo = 'accesorio') AS accesorio
    FROM tipos GROUP BY origen, ven_id
  )
  SELECT (SELECT COALESCE(SUM(diezmilesimas), 0) FROM tipos) AS diezmilesimas,
    (SELECT COUNT(*) FROM por_venta WHERE instrumento = 1) AS con_instrumento,
    (SELECT COUNT(*) FROM por_venta WHERE instrumento = 1 AND accesorio = 1) AS con_ambos`;

// Tickets por semana de las semanas base, en una sola pasada por tabla.
const SQL_TICKETS_BASE = tabla => `SELECT CAST((julianday(substr(fecha_local, 1, 10)) - julianday(@inicio)) / 7 AS INTEGER) AS k,
  COUNT(*) AS n FROM ${tabla} WHERE sucursal_id = @suc AND estado = 'vigente' AND fecha_local >= @inicio AND fecha_local < @desde
  GROUP BY k`;

function reglasValidas(DB) {
  const lista = DB?.pos?.cinco_caminos?.categorias;
  return Array.isArray(lista) ? lista.filter(r => r && typeof r.departamento === 'string' && TIPOS.has(r.tipo)) : [];
}

function diaDeRegistro(registro) {
  const fecha = registro?.fecha_registro;
  if (typeof fecha !== 'string' || !fecha.trim() || Number.isNaN(Date.parse(fecha))) return null;
  return diaLocal(fecha);
}

const diasEntre = (desde, hasta) => Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86400000);

function calcularRadar(sqlite, registrosTienda, { suc, lunes, domingo, ventas, conBase }) {
  // Conversión sobre lo registrado entre 60 y 30 días antes del domingo: lo reciente sigue pendiente.
  const ventanaDesde = sumarDias(domingo, -60);
  const ventanaHasta = sumarDias(domingo, -30);
  let convertidas = 0, noConvertidas = 0, enSemana = 0;
  for (const { dia, clase } of registrosTienda) {
    if (dia >= lunes && dia <= domingo && clase !== 'DESCARTADA') enSemana += 1;
    if (dia < ventanaDesde || dia > ventanaHasta) continue;
    if (clase === 'CONVERTIDA') convertidas += 1;
    else if (clase === 'NO_CONVERTIDA') noConvertidas += 1;
  }
  const porDiez = ventas ? (enSemana * 10) / ventas : null;
  let noConfiable = null;
  if (conBase) {
    const base = basePorDiez(sqlite, registrosTienda, suc, lunes);
    // Sin semanas base no hay contra qué medir la caída: no se sabe (null), que no es lo mismo que confiable.
    noConfiable = base === null || porDiez === null ? null : base > 0 && porDiez < base * CAIDA_NO_CONFIABLE;
  }
  return {
    conversion: pct(convertidas, convertidas + noConvertidas),
    conversion_detalle: { numerador: convertidas, denominador: convertidas + noConvertidas },
    registros_por_10_tickets: porDiez === null ? null : redondear(porDiez, 1),
    no_confiable: noConfiable,
  };
}

// Promedio de registros por cada 10 tickets en las 8 semanas previas; solo semanas con al menos 30 ventas.
// Los registros cancelados (DESCARTADA) no cuentan: inflarlos no debe tapar ni subir la vara.
function basePorDiez(sqlite, registrosTienda, suc, lunes) {
  const inicio = sumarDias(lunes, -7 * SEMANAS_BASE);
  const tickets = new Array(SEMANAS_BASE).fill(0);
  for (const tabla of ['sicar_ventas', 'sicar_ventas_mostrador']) {
    for (const { k, n } of sqlite.prepare(SQL_TICKETS_BASE(tabla)).all({ suc, inicio, desde: lunes })) {
      if (k >= 0 && k < SEMANAS_BASE) tickets[k] += n;
    }
  }
  const registros = new Array(SEMANAS_BASE).fill(0);
  for (const { dia, clase } of registrosTienda) {
    if (clase !== 'DESCARTADA' && dia >= inicio && dia < lunes) registros[Math.floor(diasEntre(inicio, dia) / 7)] += 1;
  }
  const razones = tickets.flatMap((t, k) => (t >= MINIMO_VENTAS ? [(registros[k] * 10) / t] : []));
  return razones.length ? razones.reduce((a, b) => a + b, 0) / razones.length : null;
}

function registrosDeTienda(DB, suc) {
  const lista = Array.isArray(DB?.radar_demanda?.registros) ? DB.radar_demanda.registros : [];
  return lista.flatMap(r => {
    if (Number(r?.sucursal_id) !== suc) return [];
    const dia = diaDeRegistro(r);
    return dia ? [{ dia, clase: clasificarEstadoDemanda(r.estado) }] : [];
  });
}

function numerosSemana(sqlite, DB, { sucursal_id, lunes }, opciones = {}) {
  const suc = sucursalValida(sucursal_id);
  exigirLunes(lunes);
  const domingo = sumarDias(lunes, 6);
  const rango = { suc, desde: lunes, hasta: sumarDias(lunes, 7) };
  const t = sqlite.prepare(SQL_TOTALES).get(rango);
  const ventas = t.ventas_cliente + t.ventas_mostrador;
  const ventaCentavos = t.centavos_cliente + t.centavos_mostrador;
  // Sin mostrador vigente la carga de público en general no está prendida o no ha terminado: el número saldría torcido.
  let motivo = null;
  if (!t.con_agente) motivo = 'sin_agente';
  else if (t.ventas_mostrador === 0) motivo = 'sin_mostrador';
  else if (ventas < MINIMO_VENTAS) motivo = 'pocas_ventas';
  const c = sqlite.prepare(SQL_CLIENTES).get({ ...rango, hace90: sumarDias(lunes, -90) });
  const reglas = reglasValidas(DB);
  const configurado = ['instrumento', 'accesorio'].every(tipo => reglas.some(r => r.tipo === tipo));
  const d = sqlite.prepare(SQL_DETALLE).get({ ...rango, reglas: JSON.stringify(reglas.map(r => ({
    departamento: r.departamento, categoria: typeof r.categoria === 'string' ? r.categoria : null, tipo: r.tipo }))) });
  const registrosTienda = opciones.registrosTienda || registrosDeTienda(DB, suc);
  return {
    sucursal_id: suc,
    lunes,
    domingo,
    sin_dato: motivo !== null,
    motivo,
    venta_centavos: ventaCentavos,
    ventas,
    pct_con_cliente: pct(t.con_cliente, ventas),
    clientes_nuevos: c.nuevos,
    recompra_90: pct(c.recompra, c.clientes),
    ticket_promedio_centavos: ventas ? Math.round(ventaCentavos / ventas) : null,
    articulos_por_ticket: ventas ? redondear(d.diezmilesimas / 10000 / ventas, 2) : null,
    pct_instrumento_con_accesorio: configurado ? pct(d.con_ambos, d.con_instrumento) : 'sin_configurar',
    radar: calcularRadar(sqlite, registrosTienda, { suc, lunes, domingo, ventas, conBase: opciones.conBaseRadar !== false }),
  };
}

// Promedio de un campo sobre las semanas que sí tienen número.
function promedio(semanas, leer, decimales) {
  const valores = semanas.map(leer).filter(v => typeof v === 'number' && Number.isFinite(v));
  if (!valores.length) return null;
  return redondear(valores.reduce((a, b) => a + b, 0) / valores.length, decimales);
}

// Motivo de un promedio sin semanas útiles: el de todas si coinciden; si no, la falta de ventas.
function motivoComun(semanas) {
  const motivos = new Set(semanas.map(s => s.motivo));
  return motivos.size === 1 ? [...motivos][0] : 'pocas_ventas';
}

function promediar(semanas, { sucursal_id, lunesMasViejo, domingo }) {
  const validas = semanas.filter(s => !s.sin_dato);
  const prom = (leer, decimales = 1) => promedio(validas, leer, decimales);
  const configurado = semanas.every(s => s.pct_instrumento_con_accesorio !== 'sin_configurar');
  return {
    sucursal_id,
    lunes: lunesMasViejo,
    domingo,
    semanas: validas.length,
    sin_dato: validas.length === 0,
    motivo: validas.length === 0 ? motivoComun(semanas) : null,
    venta_centavos: prom(s => s.venta_centavos, 0),
    ventas: prom(s => s.ventas),
    pct_con_cliente: prom(s => s.pct_con_cliente),
    clientes_nuevos: prom(s => s.clientes_nuevos),
    recompra_90: prom(s => s.recompra_90),
    ticket_promedio_centavos: prom(s => s.ticket_promedio_centavos, 0),
    articulos_por_ticket: prom(s => s.articulos_por_ticket, 2),
    pct_instrumento_con_accesorio: configurado ? prom(s => s.pct_instrumento_con_accesorio) : 'sin_configurar',
    radar: {
      conversion: prom(s => s.radar.conversion),
      registros_por_10_tickets: prom(s => s.radar.registros_por_10_tickets),
      no_confiable: null,
    },
  };
}

function tableroTienda(sqlite, DB, { sucursal_id, lunes }) {
  const suc = sucursalValida(sucursal_id);
  exigirLunes(lunes);
  const registrosTienda = registrosDeTienda(DB, suc);
  const semana = (l, conBaseRadar = true) => numerosSemana(sqlite, DB, { sucursal_id: suc, lunes: l }, { registrosTienda, conBaseRadar });
  const anteriorLunes = semanaAnterior(lunes);
  const previas = ultimasSemanas(anteriorLunes, SEMANAS_BASE);
  return {
    actual: semana(lunes),
    anterior: semana(anteriorLunes),
    mismo_2025: semana(mismaSemanaAnio(lunes)),
    promedio_8: promediar(previas.map(l => semana(l, false)), {
      sucursal_id: suc, lunesMasViejo: previas[previas.length - 1], domingo: sumarDias(anteriorLunes, 6),
    }),
  };
}

module.exports = { numerosSemana, tableroTienda, promedio, registrosDeTienda, MINIMO_VENTAS, TIPOS };
