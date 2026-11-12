// Lecturas del seguimiento por factura: lista, detalle con estrategias y tiendas. Solo lectura.
// Piezas en diezmilésimas y dinero en centavos, ambos como texto en la salida.

const { fechaLocal } = require('../fechas');
const { aDiezmilesimas } = require('../cantidades');
const { NO_INTERNA } = require('../sicarVentaReal');
const { leerConfig } = require('./config');
const { corteLocal } = require('./lector');
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

/**
 * Renglones de cada compra vigente de CEDIS posterior a su corte, según SICAR. Sirve para descubrir renglones que el
 * cálculo no pudo seguir (artículo sin clave en el catálogo de CEDIS): esa factura no se presenta como completa.
 */
function renglonesEsperados(sqlite) {
  const cedis = sqlite.prepare('SELECT corte FROM seguimiento_tiendas WHERE sucursal_id=?').get(CEDIS);
  if (!cedis) return new Map();
  return new Map(sqlite.prepare(`SELECT c.com_id, c.fecha, count(*) n FROM sicar_compras c
    JOIN sicar_compras_detalle d ON d.sucursal_id=c.sucursal_id AND d.com_id=c.com_id
    WHERE c.sucursal_id=? AND c.estado='vigente' AND c.fecha > ? GROUP BY c.com_id`).all(CEDIS, corteLocal(cedis.corte))
    .map(f => [f.com_id, f]));
}

const SIN_DINERO = { dinero: null, dinero_con_iva: null, total_sin_iva_centavos: null, total_con_iva_centavos: null };

/** Factura sin ningún renglón calculable: aparece con ceros y "información insuficiente", nunca desaparece. */
function sinDatos(com_id, esperada, encabezado, aviso, ahora) {
  const fecha = esperada.fecha.slice(0, 10);
  return { sucursal_id: CEDIS, com_id, folio: encabezado?.folio ?? null, proveedor: encabezado?.proveedor ?? null,
    comentario: encabezado?.comentario ?? null, fecha_compra: fecha, dias: diasDesde(fecha, ahora), etapa: null, agotada: false,
    piezas: Object.fromEntries(['comprado', 'vendido', 'queda', 'transito', 'sin_agente', 'por_aclarar'].map(k => [k, '0'])),
    ...SIN_DINERO, pendiente_centavos: '0', claves: [], tiendas: [], datos_al: null, renglones_sin_seguimiento: esperada.n,
    aviso: aviso ? { id: aviso.id, etapa: aviso.etapa, estado: aviso.estado, pospuesto_hasta: aviso.pospuesto_hasta } : null };
}

/** Marca la factura si SICAR tiene más renglones de los que se pudieron seguir; sin dinero parcial. */
function completar(factura, esperada, calculados) {
  const faltan = esperada ? Math.max(0, esperada.n - calculados) : 0;
  return faltan ? { ...factura, renglones_sin_seguimiento: faltan, ...SIN_DINERO, agotada: false }
    : { ...factura, renglones_sin_seguimiento: 0 };
}

function avisosActivos(sqlite) {
  return new Map(sqlite.prepare(`SELECT * FROM seguimiento_avisos WHERE sucursal_id=? AND estado <> 'retirado'`)
    .all(CEDIS).map(a => [a.com_id, a]));
}

/** Suma los renglones de una factura. Si un renglón no tiene dinero calculable, la factura lo dice. */
// Incertidumbre que invalida la atribución entera del lote (spec §11.1): clave con problema o unidad/cantidad dudosa.
const INVALIDAN = ['clave_con_problema', 'cantidad_fraccionaria'];
const atribucionInvalida = datos => (datos.motivos || []).some(m => INVALIDAN.includes(m));

const totalTramos = d => String(TRAMOS.reduce((a, k) => a + d[k], 0n));
const textoTramos = d => Object.fromEntries(TRAMOS.map(k => [k, String(d[k])]));

/** Dinero de la factura sin IVA (base de costos y avisos) y con IVA (lo que dice la factura), con sus totales. */
function dineroFactura(calculable, sinIva, calculableConIva, conIva) {
  return { dinero: calculable ? textoTramos(sinIva) : null, total_sin_iva_centavos: calculable ? totalTramos(sinIva) : null,
    dinero_con_iva: calculableConIva ? textoTramos(conIva) : null,
    total_con_iva_centavos: calculableConIva ? totalTramos(conIva) : null };
}

function resumir(com_id, renglones, encabezado, aviso, config, ahora) {
  const piezas = Object.fromEntries(['comprado', 'vendido', 'queda', 'transito', 'sin_agente', 'por_aclarar'].map(k => [k, 0n]));
  const dinero = Object.fromEntries(TRAMOS.map(k => [k, 0n])), conIva = Object.fromEntries(TRAMOS.map(k => [k, 0n]));
  let calculable = true, calculableConIva = true, datos_al = null;
  const tiendas = new Set();
  for (const { datos } of renglones) {
    for (const k of Object.keys(piezas)) piezas[k] += BigInt(datos[k]);
    if (datos.dinero) for (const k of TRAMOS) dinero[k] += BigInt(datos.dinero[k]);
    else calculable = false;
    // Un solo renglón sin precio con IVA (o guardado antes de este dato) deja la factura sin total con IVA.
    if (datos.dinero_con_iva) for (const k of TRAMOS) conIva[k] += BigInt(datos.dinero_con_iva[k]);
    else calculableConIva = false;
    // Atribución inválida (clave con problema en la foto): no se presenta un reparto en dinero como si fuera cierto.
    if (atribucionInvalida(datos)) calculable = false;
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
    // Agotada solo si no queda NADA pendiente: lo gris o por aclarar sigue visible (pendiente de comprobación).
    etapa: saldo > 0n ? etapaDe(dias, config) : null,
    agotada: saldo === 0n && piezas.sin_agente === 0n && piezas.por_aclarar === 0n,
    piezas: Object.fromEntries(Object.entries(piezas).map(([k, v]) => [k, String(v)])),
    ...dineroFactura(calculable, dinero, calculable && calculableConIva, conIva),
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
    const esperadas = renglonesEsperados(sqlite);
    const calculadas = [...porFactura].map(([com_id, filas]) => completar(
      resumir(com_id, filas, cabezas.get(com_id), avisos.get(com_id), config, ahora), esperadas.get(com_id), filas.length));
    const faltantes = [...esperadas].filter(([com_id]) => !porFactura.has(com_id))
      .map(([com_id, e]) => sinDatos(com_id, e, cabezas.get(com_id), avisos.get(com_id), ahora));
    const todas = [...calculadas, ...faltantes].filter(f => pasaFiltros(f, filtros)).sort(compararFacturas);
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
/**
 * Existencia SICAR de la clave por tienda. Lo desconocido queda desconocido (sin valor, con motivo): clave repetida,
 * artículo sin fila de existencia, existencia más vieja que dias_datos_atrasados, o catálogo incompleto en la tienda.
 */
function existenciasDe(sqlite, clave, tiendas, config, ahora) {
  const valores = {}, motivos = {};
  const limite = config.dias_datos_atrasados * DIA_MS, instante = Date.parse(ahora);
  for (const s of tiendas) {
    const filas = sqlite.prepare(`SELECT CAST(e.existencia_diezmilesimas AS TEXT) piezas, e.actualizado_en FROM sicar_articulos a
      LEFT JOIN sicar_existencias e ON e.sucursal_id=a.sucursal_id AND e.art_id=a.art_id
      WHERE a.sucursal_id=? AND a.clave=?`).all(s, clave);
    // Sin artículo con esa clave: cero solo si el catálogo está completo (ninguna existencia sin artículo o sin clave).
    if (!filas.length) {
      const huerfana = sqlite.prepare(`SELECT 1 FROM sicar_existencias e LEFT JOIN sicar_articulos a
        ON a.sucursal_id=e.sucursal_id AND a.art_id=e.art_id
        WHERE e.sucursal_id=? AND (a.art_id IS NULL OR a.clave IS NULL OR trim(a.clave) = '') LIMIT 1`).get(s);
      if (huerfana) motivos[s] = 'catalogo_incompleto';
      else valores[s] = 0n;
    }
    else if (filas.length > 1) motivos[s] = 'clave_repetida';
    else if (filas[0].piezas === null) motivos[s] = 'sin_existencia';
    else if (!(instante - Date.parse(filas[0].actualizado_en) <= limite)) motivos[s] = 'existencia_atrasada';
    else valores[s] = BigInt(filas[0].piezas);
  }
  return { valores, motivos };
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
  const mismaClave = sqlite.prepare('SELECT com_id, datos_json FROM seguimiento_resultado WHERE sucursal_id=? AND clave=?')
    .all(CEDIS, clave).map(f => ({ com_id: f.com_id, clave, datos: JSON.parse(f.datos_json) }));
  // El traslado se calcula POR ARTÍCULO con el saldo de todas sus facturas en aviso: así dos facturas viejas de la
  // misma clave muestran la misma sugerencia y Compras no mueve el doble.
  const enAviso = mismaClave.filter(f => f.datos.fecha_compra && etapaDe(diasDesde(f.datos.fecha_compra, ahora), config));
  const saldoViejo = {};
  for (const f of enAviso) {
    for (const [s, v] of Object.entries(f.datos.por_sucursal)) {
      if (BigInt(v.queda) > 0n) saldoViejo[s] = (saldoViejo[s] ?? 0n) + BigInt(v.queda);
    }
  }
  // Si la atribución de la clave no es confiable, no hay cantidades: solo "información insuficiente" por origen.
  const invalida = atribucionInvalida(datos) || enAviso.some(f => atribucionInvalida(f.datos));
  const traslados = invalida
    ? Object.keys(saldoViejo).map(Number).sort((a, b) => a - b).map(de => ({ de, a: null, piezas: null, razon: 'informacion_insuficiente' }))
    : sugerirTraslados({ saldoViejo, velocidades: velocidades(ventasPorSemana(sqlite, clave, tiendas, config, ahora), config),
      existencias: existenciasDe(sqlite, clave, tiendas, config, ahora).valores, transito: transitoHacia(sqlite, clave),
      atrasadas: datos.calidad?.atrasadas ?? [], config });
  const comprado = BigInt(datos.comprado), valor = BigInt(datos.valor_centavos);
  // Costo desconocido o cero: ninguna recomendación de precio (nunca "liquidar a $0.00").
  const costo = comprado > 0n && valor > 0n && datos.dinero && !invalida ? (valor * 10000n + comprado - 1n) / comprado : null;
  const margen = costo === null
    ? { texto: 'El costo de esta factura no es calculable: revísalo antes de cambiar precios.', precio_referencia_centavos: null }
    : textoMargen({ costo_pieza_centavos: costo, ultimo_precio_centavos: ultimoPrecio(sqlite, clave), etapa: factura.etapa, config });
  const recientes = mismaClave.filter(f => f.com_id !== renglon.com_id
    && f.datos.fecha_compra > datos.fecha_compra && BigInt(f.datos.queda) + BigInt(f.datos.transito) > 0n)
    .map(f => ({ piezas: BigInt(f.datos.queda) + BigInt(f.datos.transito), dias: diasDesde(f.datos.fecha_compra, ahora) }));
  return { traslados, facturas_en_aviso: enAviso.length, margen, articulo_compartido: avisoArticuloCompartido(recientes) };
}

/**
 * Saldo calculado de la clave contra la existencia SICAR en cada tienda incorporada. La diferencia se muestra como
 * "movimientos por aclarar", nunca como faltante. calculado null = resultado viejo pendiente de recálculo;
 * sicar null = clave repetida en esa tienda (no se puede saber).
 */
function comparar(sqlite, { clave, datos }, config, ahora) {
  const tiendas = sqlite.prepare('SELECT sucursal_id FROM seguimiento_tiendas ORDER BY sucursal_id').all().map(t => t.sucursal_id);
  const { valores, motivos } = existenciasDe(sqlite, clave, tiendas, config, ahora);
  return tiendas.map(s => {
    const calculado = datos.saldo_clave ? BigInt(datos.saldo_clave[s] ?? '0') : null;
    const sicar = valores[s];
    return { sucursal_id: s, calculado: calculado === null ? null : String(calculado), sicar: sicar === undefined ? null : String(sicar),
      motivo_sicar: motivos[s] ?? null, diferencia: calculado === null || sicar === undefined ? null : String(sicar - calculado) };
  });
}

function detalle(sqlite, sucursal_id, com_id, ahora = new Date().toISOString()) {
  if (Number(sucursal_id) !== CEDIS || typeof com_id !== 'string' || !/^\d{1,128}$/.test(com_id)) throw error(404, 'Factura no encontrada.');
  return sqlite.transaction(() => {
    const filas = filasResultado(sqlite, com_id);
    const esperada = renglonesEsperados(sqlite).get(com_id);
    const cabeza = encabezados(sqlite).get(com_id), aviso = avisosActivos(sqlite).get(com_id);
    if (!filas.length && !esperada) throw error(404, 'Factura no encontrada.');
    const config = leerConfig(sqlite);
    const factura = filas.length ? completar(resumir(com_id, filas, cabeza, aviso, config, ahora), esperada, filas.length)
      : sinDatos(com_id, esperada, cabeza, aviso, ahora);
    const descripcion = sqlite.prepare('SELECT descripcion FROM sicar_articulos WHERE sucursal_id=? AND clave=? LIMIT 1');
    const renglones = filas.map(r => ({ renglon: r.renglon, clave: r.clave, descripcion: descripcion.get(CEDIS, r.clave)?.descripcion ?? null,
      ...r.datos, rescate: r.datos.rescate ?? null, // { desde, tiendas } si la clave se reconstruyó con el rescate
      estrategias: estrategias(sqlite, r, factura, config, ahora), comparacion: comparar(sqlite, r, config, ahora) }));
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
