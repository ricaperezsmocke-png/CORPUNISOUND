// Lecturas del seguimiento por factura: lista, detalle con estrategias y tiendas. Solo lectura.
// Piezas en diezmilésimas y dinero en centavos, ambos como texto en la salida.

const { fechaLocal } = require('../fechas');
const { aDiezmilesimas } = require('../cantidades');
const { NO_INTERNA } = require('../sicarVentaReal');
const { leerConfig } = require('./config');
const { revisarFoto } = require('./incorporar');
const { etapa: etapaDe, velocidades, sugerirTraslados, textoMargen, avisoArticuloCompartido } = require('./estrategias');

const CEDIS = 6;
const DIA_MS = 86400000;
const ETAPAS = ['traslado', 'margen_75', 'margen_50', 'liquidar'];
const TRAMOS = ['vendido', 'queda', 'transito', 'gris', 'por_aclarar'];
const error = (status, mensaje) => Object.assign(new Error(mensaje), { status });

const diaUTC = dia => Date.parse(`${dia}T00:00:00Z`);
const sumarDias = (dia, n) => new Date(diaUTC(dia) + n * DIA_MS).toISOString().slice(0, 10);
const diasDesde = (dia, ahora) => Math.floor((diaUTC(fechaLocal(ahora)) - diaUTC(dia)) / DIA_MS);

function filasResultado(sqlite, com_id) {
  const sql = `SELECT r.com_id, r.renglon, r.clave, r.datos_json FROM seguimiento_resultado r WHERE r.sucursal_id=?
    ${com_id === undefined ? '' : 'AND r.com_id=?'} ORDER BY r.com_id, r.renglon`;
  const args = com_id === undefined ? [CEDIS] : [CEDIS, com_id];
  return sqlite.prepare(sql).all(...args).map(f => ({ ...f, datos: JSON.parse(f.datos_json) }));
}

function encabezados(sqlite) {
  return new Map(sqlite.prepare(`SELECT c.com_id, c.folio, c.fecha, c.comentario, c.pro_id, p.nombre proveedor
    FROM sicar_compras c LEFT JOIN sicar_proveedores p ON p.sucursal_id=c.sucursal_id AND p.prv_id=c.pro_id
    WHERE c.sucursal_id=?`).all(CEDIS).map(c => [c.com_id, c]));
}

function avisosActivos(sqlite) {
  return new Map(sqlite.prepare(`SELECT * FROM seguimiento_avisos WHERE sucursal_id=? AND estado <> 'retirado'`)
    .all(CEDIS).map(a => [a.com_id, a]));
}

/** Suma los renglones de una factura. Si un renglón no tiene dinero calculable, la factura lo dice. */
function resumir(com_id, renglones, encabezado, aviso, config, ahora) {
  const piezas = Object.fromEntries(['comprado', 'vendido', 'queda', 'transito', 'sin_agente', 'por_aclarar'].map(k => [k, 0n]));
  const dinero = Object.fromEntries(TRAMOS.map(k => [k, 0n]));
  let calculable = true, datos_al = null;
  const tiendas = new Set();
  for (const { datos } of renglones) {
    for (const k of Object.keys(piezas)) piezas[k] += BigInt(datos[k]);
    if (datos.dinero) for (const k of TRAMOS) dinero[k] += BigInt(datos.dinero[k]);
    else calculable = false;
    for (const s of Object.keys(datos.por_sucursal)) tiendas.add(Number(s));
    const al = datos.calidad?.datos_al;
    if (!al) calculable = false;
    else if (!datos_al || al < datos_al) datos_al = al;
  }
  const fecha = renglones[0].datos.fecha_compra;
  const saldo = piezas.queda + piezas.transito;
  const dias = diasDesde(fecha, ahora);
  return {
    sucursal_id: CEDIS, com_id, folio: encabezado?.folio ?? null, proveedor: encabezado?.proveedor ?? null,
    comentario: encabezado?.comentario ?? null, fecha_compra: fecha, dias,
    etapa: saldo > 0n ? etapaDe(dias, config) : null, agotada: saldo === 0n,
    piezas: Object.fromEntries(Object.entries(piezas).map(([k, v]) => [k, String(v)])),
    dinero: calculable ? Object.fromEntries(TRAMOS.map(k => [k, String(dinero[k])])) : null,
    pendiente_centavos: String(dinero.queda + dinero.transito), claves: [...new Set(renglones.map(r => r.clave))],
    tiendas: [...tiendas].sort((a, b) => a - b), datos_al,
    aviso: aviso ? { id: aviso.id, etapa: aviso.etapa, estado: aviso.estado, pospuesto_hasta: aviso.pospuesto_hasta } : null,
  };
}

function leerFiltros(q) {
  const texto = v => (typeof v === 'string' && v.trim() ? v.trim().toLowerCase() : null);
  const dia = (v, nombre) => {
    if (v === undefined || v === '') return null;
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(diaUTC(v))) throw error(400, `${nombre} inválida.`);
    return v;
  };
  const entero = (v, def, max) => {
    if (v === undefined || v === '') return def;
    const n = Number(v);
    if (!Number.isSafeInteger(n) || n < 1 || n > max) throw error(400, 'Paginación inválida.');
    return n;
  };
  if (q.etapa !== undefined && q.etapa !== '' && !ETAPAS.includes(q.etapa)) throw error(400, 'Etapa desconocida.');
  const tienda = q.tienda === undefined || q.tienda === '' ? null : Number(q.tienda);
  if (tienda !== null && !Number.isSafeInteger(tienda)) throw error(400, 'Tienda inválida.');
  return { proveedor: texto(q.proveedor), folio: texto(q.folio), clave: texto(q.clave), desde: dia(q.desde, 'Fecha desde'),
    hasta: dia(q.hasta, 'Fecha hasta'), tienda, etapa: q.etapa || null, solo_aviso: q.solo_aviso === '1' || q.solo_aviso === 'true',
    ocultar_agotadas: q.ocultar_agotadas === '1' || q.ocultar_agotadas === 'true',
    pagina: entero(q.pagina, 1, 100000), por_pagina: entero(q.por_pagina, 50, 200) };
}

function pasaFiltros(f, x) {
  return (!x.proveedor || (f.proveedor ?? '').toLowerCase().includes(x.proveedor))
    && (!x.folio || (f.folio ?? '').toLowerCase().includes(x.folio))
    && (!x.clave || f.claves.some(c => c.toLowerCase().includes(x.clave)))
    && (!x.desde || f.fecha_compra >= x.desde) && (!x.hasta || f.fecha_compra <= x.hasta)
    && (x.tienda === null || f.tiendas.includes(x.tienda)) && (!x.etapa || f.etapa === x.etapa)
    && (!x.solo_aviso || !!f.aviso) && (!x.ocultar_agotadas || !f.agotada);
}

/** Orden inicial: primero las que tienen aviso; dentro, mayor costo pendiente; luego folio de compra. */
function compararFacturas(a, b) {
  if (!!a.aviso !== !!b.aviso) return a.aviso ? -1 : 1;
  const pa = BigInt(a.pendiente_centavos), pb = BigInt(b.pendiente_centavos);
  if (pa !== pb) return pa > pb ? -1 : 1;
  return a.com_id < b.com_id ? -1 : a.com_id > b.com_id ? 1 : 0;
}

function listar(sqlite, query = {}, ahora = new Date().toISOString()) {
  const filtros = leerFiltros(query);
  return sqlite.transaction(() => {
    const config = leerConfig(sqlite), cabezas = encabezados(sqlite), avisos = avisosActivos(sqlite);
    const porFactura = new Map();
    for (const fila of filasResultado(sqlite)) {
      if (!porFactura.has(fila.com_id)) porFactura.set(fila.com_id, []);
      porFactura.get(fila.com_id).push(fila);
    }
    const todas = [...porFactura].map(([com_id, filas]) => resumir(com_id, filas, cabezas.get(com_id), avisos.get(com_id), config, ahora))
      .filter(f => pasaFiltros(f, filtros)).sort(compararFacturas);
    const inicio = (filtros.pagina - 1) * filtros.por_pagina;
    return { total: todas.length, pagina: filtros.pagina, por_pagina: filtros.por_pagina,
      facturas: todas.slice(inicio, inicio + filtros.por_pagina) };
  })();
}

/** Ventas por semana completa (lunes a domingo, la última termina el domingo pasado) de una clave en cada tienda. */
function ventasPorSemana(sqlite, clave, tiendas, config, ahora) {
  const hoy = fechaLocal(ahora), dow = new Date(diaUTC(hoy)).getUTCDay();
  const fin = sumarDias(hoy, -(dow === 0 ? 7 : dow)), n = config.semanas_ventas, inicio = sumarDias(fin, -(7 * n) + 1);
  const semanas = Object.fromEntries(tiendas.map(s => [s, Array.from({ length: n }, () => 0n)]));
  const sql = `SELECT v.sucursal_id, substr(v.fecha_local, 1, 10) dia, d.cantidad FROM %V v
    JOIN %D d ON d.sucursal_id=v.sucursal_id AND d.ven_id=v.ven_id
    JOIN sicar_articulos a ON a.sucursal_id=d.sucursal_id AND a.art_id=d.art_id
    WHERE v.estado='vigente' AND a.clave=? AND substr(v.fecha_local, 1, 10) BETWEEN ? AND ? %X`;
  const consultas = [sql.replace('%V', 'sicar_ventas').replace('%D', 'sicar_detalles').replace('%X', `AND ${NO_INTERNA('v')}`),
    sql.replace('%V', 'sicar_ventas_mostrador').replace('%D', 'sicar_detalles_mostrador').replace('%X', '')];
  for (const consulta of consultas) {
    for (const f of sqlite.prepare(consulta).all(clave, inicio, fin)) {
      if (!semanas[f.sucursal_id]) continue;
      semanas[f.sucursal_id][Math.floor((diaUTC(f.dia) - diaUTC(inicio)) / (7 * DIA_MS))] += aDiezmilesimas(f.cantidad);
    }
  }
  return semanas;
}

/** Existencia SICAR de la clave por tienda; clave repetida en una tienda = desconocida (undefined). */
function existenciasDe(sqlite, clave, tiendas) {
  const salida = {};
  for (const s of tiendas) {
    const filas = sqlite.prepare(`SELECT CAST(e.existencia_diezmilesimas AS TEXT) piezas FROM sicar_articulos a
      LEFT JOIN sicar_existencias e ON e.sucursal_id=a.sucursal_id AND e.art_id=a.art_id
      WHERE a.sucursal_id=? AND a.clave=?`).all(s, clave);
    if (filas.length > 1) continue;
    salida[s] = filas.length && filas[0].piezas !== null ? BigInt(filas[0].piezas) : 0n;
  }
  return salida;
}

/**
 * Piezas de la clave en camino hacia cada tienda: enviadas según el SICAR de ORIGEN y que el SICAR de destino
 * todavía no marca recibidas ni canceladas (el origen sigue diciendo "enviado" aunque el destino ya las tenga).
 */
function transitoHacia(sqlite, clave) {
  const salida = {};
  for (const f of sqlite.prepare(`SELECT m.sucursal_id destino, d.cantidad FROM sicar_traspasos t
    JOIN sicar_sucursales_mapa o ON o.sicar_sucursal=t.suc_origen AND o.sucursal_id=t.sucursal_id
    JOIN sicar_traspasos_detalle d ON d.sucursal_id=t.sucursal_id AND d.tra_id=t.tra_id
    JOIN sicar_articulos a ON a.sucursal_id=d.sucursal_id AND a.art_id=d.art_id
    JOIN sicar_sucursales_mapa m ON m.sicar_sucursal=t.suc_destino
    WHERE t.estado='enviado' AND a.clave=? AND NOT EXISTS (SELECT 1 FROM sicar_traspasos r
      WHERE r.sucursal_id=m.sucursal_id AND r.folio=t.folio AND r.suc_origen=t.suc_origen AND r.suc_destino=t.suc_destino
        AND r.estado IN ('recibido', 'cancelado'))`).all(clave)) {
    salida[f.destino] = (salida[f.destino] ?? 0n) + aDiezmilesimas(f.cantidad);
  }
  return salida;
}

function ultimoPrecio(sqlite, clave) {
  const f = sqlite.prepare(`SELECT d.precio_sin FROM sicar_ventas v
    JOIN sicar_detalles d ON d.sucursal_id=v.sucursal_id AND d.ven_id=v.ven_id
    JOIN sicar_articulos a ON a.sucursal_id=d.sucursal_id AND a.art_id=d.art_id
    WHERE v.estado='vigente' AND a.clave=? ORDER BY v.fecha_local DESC LIMIT 1`).get(clave);
  if (!f) return undefined;
  return (aDiezmilesimas(f.precio_sin) + 50n) / 100n;
}

function estrategias(sqlite, renglon, factura, config, ahora) {
  const { datos, clave } = renglon;
  if (!factura.etapa) return null;
  const tiendas = sqlite.prepare('SELECT sucursal_id FROM seguimiento_tiendas ORDER BY sucursal_id').all().map(t => t.sucursal_id);
  const saldoViejo = Object.fromEntries(Object.entries(datos.por_sucursal)
    .filter(([, s]) => BigInt(s.queda) > 0n).map(([s, v]) => [s, BigInt(v.queda)]));
  const traslados = sugerirTraslados({ saldoViejo, velocidades: velocidades(ventasPorSemana(sqlite, clave, tiendas, config, ahora), config),
    existencias: existenciasDe(sqlite, clave, tiendas), transito: transitoHacia(sqlite, clave),
    atrasadas: datos.calidad?.atrasadas ?? [], config });
  const comprado = BigInt(datos.comprado), valor = BigInt(datos.valor_centavos);
  const costo = comprado > 0n ? (valor * 10000n + comprado - 1n) / comprado : null;
  const margen = costo === null ? null
    : textoMargen({ costo_pieza_centavos: costo, ultimo_precio_centavos: ultimoPrecio(sqlite, clave), etapa: factura.etapa, config });
  const mismaClave = sqlite.prepare('SELECT com_id, datos_json FROM seguimiento_resultado WHERE sucursal_id=? AND clave=?')
    .all(CEDIS, clave).map(f => ({ com_id: f.com_id, clave, datos: JSON.parse(f.datos_json) }));
  const recientes = mismaClave.filter(f => f.com_id !== renglon.com_id
    && f.datos.fecha_compra > datos.fecha_compra && BigInt(f.datos.queda) + BigInt(f.datos.transito) > 0n)
    .map(f => ({ piezas: BigInt(f.datos.queda) + BigInt(f.datos.transito), dias: diasDesde(f.datos.fecha_compra, ahora) }));
  return { traslados, margen, articulo_compartido: avisoArticuloCompartido(recientes) };
}

function detalle(sqlite, sucursal_id, com_id, ahora = new Date().toISOString()) {
  if (Number(sucursal_id) !== CEDIS || typeof com_id !== 'string' || !/^\d{1,128}$/.test(com_id)) throw error(404, 'Factura no encontrada.');
  return sqlite.transaction(() => {
    const filas = filasResultado(sqlite, com_id);
    if (!filas.length) throw error(404, 'Factura no encontrada.');
    const config = leerConfig(sqlite);
    const factura = resumir(com_id, filas, encabezados(sqlite).get(com_id), avisosActivos(sqlite).get(com_id), config, ahora);
    const descripcion = sqlite.prepare('SELECT descripcion FROM sicar_articulos WHERE sucursal_id=? AND clave=? LIMIT 1');
    const renglones = filas.map(r => ({ renglon: r.renglon, clave: r.clave, descripcion: descripcion.get(CEDIS, r.clave)?.descripcion ?? null,
      ...r.datos, estrategias: estrategias(sqlite, r, factura, config, ahora) }));
    const avisos = sqlite.prepare('SELECT * FROM seguimiento_avisos WHERE sucursal_id=? AND com_id=? ORDER BY id').all(CEDIS, com_id)
      .map(a => ({ ...a, historial: sqlite.prepare(`SELECT estado, motivo, actor, fecha FROM seguimiento_avisos_historial
        WHERE aviso_id=? ORDER BY id`).all(a.id) }));
    return { factura, renglones, avisos, nota: 'Asignación estimada en orden de llegada (FIFO) según SICAR.' };
  })();
}

function tiendas(sqlite, ahora = new Date().toISOString()) {
  const incorporadas = sqlite.prepare(`SELECT t.sucursal_id, t.corte, t.actor, t.fecha,
    (SELECT count(*) FROM seguimiento_foto f WHERE f.sucursal_id=t.sucursal_id) claves,
    (SELECT count(*) FROM seguimiento_foto_problemas p WHERE p.sucursal_id=t.sucursal_id) problemas
    FROM seguimiento_tiendas t ORDER BY t.sucursal_id`).all();
  const ya = new Set(incorporadas.map(t => t.sucursal_id));
  const pendientes = sqlite.prepare('SELECT sucursal_id FROM sicar_tiendas ORDER BY sucursal_id').all()
    .filter(t => !ya.has(t.sucursal_id)).map(({ sucursal_id }) => {
      const foto = revisarFoto(sqlite, sucursal_id, ahora);
      const problemas = {};
      for (const p of foto.problemas) problemas[p.motivo] = (problemas[p.motivo] ?? 0) + 1;
      return { sucursal_id, corte: foto.corte, claves: foto.claves.length, problemas, vieja: foto.vieja };
    });
  return { incorporadas, pendientes };
}

module.exports = { listar, detalle, tiendas, transitoHacia, ETAPAS };
