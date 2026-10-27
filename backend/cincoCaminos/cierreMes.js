/**
 * Cierre del mes de los cinco caminos (plan 2026-10-27 P5, spec 2026-10-24 secciones 6.5 y 9).
 *
 * Al terminar un mes (más 3 días de gracia), cada táctica del plan aprobado de cada tienda se califica sola:
 * ¿se hizo? (por número o por evidencia) y ¿se movió su número sin que cayera su candado? El resultado queda en un
 * cierre inmutable y en la etiqueta de la táctica para esa tienda. No hay ruta para cerrar ni para reabrir.
 *
 * Esta parte es pura: recibe las cifras ya calculadas (enteros como en el tablero) y no toca la base.
 */
const { NUMEROS_META, formatearValor, valorDelPeriodo, primerDiaParaSellar } = require('./metaNumero');
const { tableroTienda, numerosSemana, registrosDeTienda, promedio } = require('./tablero');
const { semanaDe, sumarDias } = require('./semanas');
const { finDePeriodo } = require('../metasPeriodos');
const { fechaLocal } = require('../fechas');
// Se llama como manual.fijarEtiqueta (no desestructurada): es la única forma de escribir una etiqueta.
const manual = require('./manual');

// Umbrales del contrato: se movió con +5 %; el candado cae con -5 % (el Radar con -30 %). En enteros para no redondear.
const SUBE_PCT = 105;
const CAE_PCT = 95;
const CAE_PCT_RADAR = 70;
const RADAR = 'registros_por_10_tickets';
const MAX_TEXTO = 300;
const MEDIDOS = ['sistema', 'evidencia', 'sistema_y_evidencia'];

// Los registros del Radar no pueden ser meta (no están en NUMEROS_META), pero sí número o candado de una táctica.
const LECTORES = {
  ...Object.fromEntries(Object.entries(NUMEROS_META).map(([k, d]) => [k, { leer: d.leer, factor: d.factor, etiqueta: d.etiqueta }])),
  [RADAR]: { leer: s => s.radar.registros_por_10_tickets, factor: 100, etiqueta: 'Registros del Radar por cada 10 tickets' },
};

const esNumero = v => typeof v === 'number' && Number.isFinite(v);
const nombre = n => LECTORES[n]?.etiqueta || n;
const legible = (n, v) => (n === RADAR ? (v / 100).toFixed(2) : formatearValor(n, v));
const cambioPct = (valor, base) => (esNumero(valor) && esNumero(base) && base > 0 ? Math.round(((valor - base) * 1000) / base) / 10 : null);
const conSigno = pct => `${pct >= 0 ? '+' : ''}${pct.toFixed(1)} %`;

// Capturas que cuentan: de la meta ligada, no anuladas, con fecha dentro del mes y CON evidencia (foto o liga).
// Cada captura vale 1: la cantidad no cuenta, porque una captura sin prueba puede decir cualquier número.
function contarEvidencia(evidencia, mes) {
  if (!evidencia) return { registro: null, hecha: false, suma: 0 };
  const validas = (evidencia.capturas || []).filter(c => c && !c.anulada && typeof c.fecha === 'string' && c.fecha.slice(0, 7) === mes
    && !!c.evidencia && typeof c.evidencia === 'object');
  const suma = validas.length;
  const requeridas = Number(evidencia.requeridas);
  return {
    registro: { meta_clave: evidencia.meta_clave, requeridas, capturas_contadas: validas.map(c => c.id) },
    hecha: Number.isInteger(requeridas) && requeridas > 0 && suma >= requeridas,
    suma,
  };
}

function seHizo(t, ev) {
  const porNumero = esNumero(t.valor);
  if (t.como_se_mide === 'sistema') return porNumero;
  if (t.como_se_mide === 'evidencia') return ev.hecha;
  return porNumero && ev.hecha;
}

function calificar(t, ev) {
  if (!MEDIDOS.includes(t.como_se_mide)) return 'sin_dato';
  if (!seHizo(t, ev)) return 'no_se_hizo';
  if (!esNumero(t.valor) || !esNumero(t.base) || t.base <= 0) return 'sin_dato';
  let cayo = false;
  if (t.candado) {
    if (!esNumero(t.candado_valor) || !esNumero(t.candado_base) || t.candado_base <= 0) return 'sin_dato';
    cayo = cayoElCandado(t);
  }
  return t.valor * 100 >= t.base * SUBE_PCT && !cayo ? 'probada' : 'no_funciono';
}

const cayoElCandado = r => r.candado_valor * 100 < r.candado_base * (r.candado === RADAR ? CAE_PCT_RADAR : CAE_PCT);
const anioAnterior = mes => Number(String(mes).slice(0, 4)) - 1;

/** Texto de la etiqueta (≤ 300 caracteres, sin nombres de persona), armado solo con cifras del cierre de `mes`. */
function textoResultado(r, mes) {
  const recortar = s => s.slice(0, MAX_TEXTO);
  if (r.resultado === 'no_se_hizo') {
    if (r.como_se_mide === 'sistema') return recortar(`No se hizo: ${nombre(r.numero)} sin dato en el mes`);
    const ev = r.evidencia;
    return recortar(ev ? `No se hizo: evidencia ${ev.capturas_contadas.length} de ${ev.requeridas}` : 'No se hizo: sin meta de evidencia');
  }
  if (!MEDIDOS.includes(r.como_se_mide)) return 'Sin dato: la táctica todavía no se puede medir';
  if (!esNumero(r.valor) || !esNumero(r.base) || r.base <= 0) return recortar(`Sin dato: ${nombre(r.numero)} sin cifra o sin base para comparar`);
  const contra = r.base_tipo === 'mismo_mes' ? `mismo mes ${anioAnterior(mes)}` : '8 semanas previas';
  let texto = `${nombre(r.numero)}: ${legible(r.numero, r.base)} → ${legible(r.numero, r.valor)} (${conSigno(r.cambio_pct)}) contra ${contra}`;
  if (r.candado && r.candado_cambio_pct === null) texto += `; candado ${nombre(r.candado)} sin dato`;
  else if (r.candado) texto += `; candado ${nombre(r.candado)} ${cayoElCandado(r) ? `cayó ${conSigno(r.candado_cambio_pct)}` : 'bien'}`;
  if (r.en_conjunto_con != null) texto += '; en conjunto con otra táctica del mes';
  return recortar(texto);
}

/**
 * Califica una táctica. Entrada: `{ id, como_se_mide, mes, numero, valor, base, base_tipo, candado, candado_valor, candado_base,
 * evidencia: { meta_clave, requeridas, capturas } | null }`. Devuelve el registro del cierre con su `texto`.
 */
function evaluarTactica(t) {
  const ev = contarEvidencia(t.evidencia, t.mes);
  const registro = {
    id: t.id, como_se_mide: t.como_se_mide, numero: t.numero, valor: esNumero(t.valor) ? t.valor : null, base: esNumero(t.base) ? t.base : null,
    base_tipo: esNumero(t.base) ? t.base_tipo || null : null, cambio_pct: cambioPct(t.valor, t.base), candado: t.candado || null,
    candado_valor: esNumero(t.candado_valor) ? t.candado_valor : null, candado_base: esNumero(t.candado_base) ? t.candado_base : null,
    candado_cambio_pct: t.candado ? cambioPct(t.candado_valor, t.candado_base) : null, evidencia: ev.registro,
    resultado: calificar(t, ev), en_conjunto_con: null,
  };
  registro.texto = textoResultado(registro, t.mes);
  return registro;
}

/** Califica todas las tácticas de un plan. Dos `probada` que mueven el mismo número quedan en conjunto, cruzadas. */
function evaluarPlan(tacticas) {
  const registros = tacticas.map(evaluarTactica);
  for (const r of registros) {
    if (r.resultado !== 'probada') continue;
    const otra = registros.find(x => x !== r && x.resultado === 'probada' && x.numero === r.numero);
    if (!otra) continue;
    r.en_conjunto_con = otra.id;
    r.texto = textoResultado(r, tacticas.find(x => x.id === r.id).mes);
  }
  return registros;
}

// ---------------------------------------------------------------------------------------------------------------------
// Cierre sobre la base: lee SICAR y el JSON, califica y escribe el cierre y las etiquetas, todo o nada por tienda y mes.
// ---------------------------------------------------------------------------------------------------------------------
const GRACIA_DIAS = 3;
// La conversión y los registros del Radar no tienen año anterior: siempre se comparan contra sus 8 semanas previas.
const SOLO_OCHO_SEMANAS = ['conversion', RADAR];
// `no_se_hizo` y `sin_dato` solo se escriben sobre estas; `probada` y `no_funciono` sustituyen cualquiera.
const ETIQUETAS_DEBILES = ['por_probar', 'sin_dato'];

function asegurarCierres(DB) {
  if (!DB.pos.cinco_caminos || typeof DB.pos.cinco_caminos !== 'object') DB.pos.cinco_caminos = {};
  if (!Array.isArray(DB.pos.cinco_caminos.cierres)) DB.pos.cinco_caminos.cierres = [];
  return DB.pos.cinco_caminos.cierres;
}

/** Día desde el que el mes 'AAAA-MM' se califica: primer día para sellarlo más 3 días de gracia para anular evidencia. */
const diaDeCierre = mes => sumarDias(primerDiaParaSellar('mensual', `${mes}-01`), GRACIA_DIAS);

const primerLunes = mes => {
  const { lunes } = semanaDe(`${mes}-01`);
  return lunes < `${mes}-01` ? sumarDias(lunes, 7) : lunes;
};

// Valor del mes de un número, como `valorDelPeriodo`. Los registros del Radar no son meta: se promedian aquí igual.
function valorDelMes(sqlite, DB, { sucursal_id, numero, mes, hoy }) {
  if (numero !== RADAR) return valorDelPeriodo(sqlite, DB, { sucursal_id, numero, periodo: 'mensual', inicio: `${mes}-01`, hoy }).valor;
  const registrosTienda = registrosDeTienda(DB, Number(sucursal_id));
  const fin = finDePeriodo('mensual', `${mes}-01`);
  const semanas = [];
  for (let lunes = primerLunes(mes); lunes <= fin; lunes = sumarDias(lunes, 7)) {
    if (sumarDias(lunes, 6) >= hoy) continue;
    const s = numerosSemana(sqlite, DB, { sucursal_id, lunes }, { registrosTienda, conBaseRadar: false });
    if (!s.sin_dato) semanas.push(s);
  }
  const media = promedio(semanas, LECTORES[RADAR].leer, 6);
  return media === null ? null : Math.round(media * LECTORES[RADAR].factor);
}

function cifrasDe(sqlite, DB, { sucursal_id, mes, hoy }, cache) {
  const ocho = () => {
    if (cache.ocho === undefined) cache.ocho = tableroTienda(sqlite, DB, { sucursal_id, lunes: primerLunes(mes) }).promedio_8;
    return cache.ocho;
  };
  return numero => {
    if (cache[numero]) return cache[numero];
    const lector = LECTORES[numero];
    if (!lector) return (cache[numero] = { valor: null, base: null, base_tipo: null });
    const valor = valorDelMes(sqlite, DB, { sucursal_id, numero, mes, hoy });
    const anterior = `${Number(mes.slice(0, 4)) - 1}${mes.slice(4)}`;
    const mismo = SOLO_OCHO_SEMANAS.includes(numero) ? null
      : valorDelPeriodo(sqlite, DB, { sucursal_id, numero, periodo: 'mensual', inicio: `${anterior}-01`, hoy }).valor;
    if (mismo !== null) return (cache[numero] = { valor, base: mismo, base_tipo: 'mismo_mes' });
    const crudo = lector.leer(ocho());
    const base = typeof crudo === 'number' && Number.isFinite(crudo) ? Math.round(crudo * lector.factor) : null;
    return (cache[numero] = { valor, base, base_tipo: base === null ? null : 'promedio_8' });
  };
}

// Evidencia ligada al plan, tal como se aprobó: prueba y veces requeridas guardadas en el plan, con las capturas de esa
// clave. Editar la meta después no cambia nada. Un plan viejo sin esos campos usa la PRIMERA versión de la meta.
function evidenciaDe(DB, plan, tacticaId) {
  const ligada = (Array.isArray(plan.evidencias) ? plan.evidencias : []).find(e => e && Number(e.tactica_id) === tacticaId);
  if (!ligada) return null;
  const clave = Number(ligada.meta_clave);
  const capturas = (DB.pos.meta_capturas || []).filter(c => c && Number(c.meta_clave) === clave);
  if (ligada.requeridas !== undefined || ligada.prueba !== undefined) {
    return { meta_clave: clave, prueba: ligada.prueba ?? null, requeridas: ligada.requeridas ?? null, capturas };
  }
  const versiones = (DB.pos.metas_personalizadas || []).filter(m => m.clave === clave);
  if (!versiones.length) return null;
  const primera = versiones.reduce((a, b) => (b.version < a.version ? b : a));
  return { meta_clave: clave, prueba: primera.prueba, requeridas: primera.valor_meta, capturas };
}

/** Avance de la evidencia de cada táctica del plan, contada igual que en el cierre (con prueba, no anuladas y dentro del mes). */
function avanceEvidencias(DB, plan) {
  return (Array.isArray(plan.evidencias) ? plan.evidencias : []).flatMap(e => {
    const ev = evidenciaDe(DB, plan, Number(e?.tactica_id));
    if (!ev) return [];
    return [{ tactica_id: Number(e.tactica_id), meta_clave: ev.meta_clave, prueba: ev.prueba, requeridas: ev.requeridas,
      hechas: contarEvidencia(ev, plan.mes).suma }];
  });
}

function tacticaDelManual(DB, id) {
  const t = (DB.pos.cinco_caminos.tacticas || []).find(x => x && x.id === Number(id));
  if (!t) throw new Error(`La táctica ${id} del plan no está en el manual`);
  return t;
}

// La táctica tal como se aprobó (snapshot del plan). Solo un plan viejo, sin snapshot, se califica con el manual vivo.
function tacticaAprobada(DB, plan, id) {
  const aprobadas = Array.isArray(plan.tacticas_aprobadas) ? plan.tacticas_aprobadas : null;
  if (!aprobadas) return tacticaDelManual(DB, id);
  const t = aprobadas.find(x => x && Number(x.id) === Number(id));
  if (!t) throw new Error(`La táctica ${id} del plan no está en lo aprobado`);
  return { id: Number(t.id), como_se_mide: t.como_se_mide, numero_que_mueve: t.numero_que_mueve, candado: t.candado || null };
}

function calificarPlan(sqlite, DB, plan, hoy) {
  const sucursal_id = Number(plan.sucursal_id);
  const cifra = cifrasDe(sqlite, DB, { sucursal_id, mes: plan.mes, hoy }, {});
  const entradas = (Array.isArray(plan.tacticas) ? plan.tacticas : []).map(id => {
    const t = tacticaAprobada(DB, plan, id);
    const numero = cifra(t.numero_que_mueve);
    const candado = t.candado ? cifra(t.candado) : { valor: null, base: null };
    return { id: t.id, como_se_mide: t.como_se_mide, mes: plan.mes, numero: t.numero_que_mueve, valor: numero.valor, base: numero.base,
      base_tipo: numero.base_tipo, candado: t.candado || null, candado_valor: candado.valor, candado_base: candado.base,
      evidencia: evidenciaDe(DB, plan, t.id) };
  });
  return evaluarPlan(entradas);
}

// La etiqueta de la tienda: `probada` y `no_funciono` ganan (si no hay una de un mes más nuevo); lo demás solo pisa lo débil.
function escribirEtiqueta(DB, registro, sucursal_id, mes) {
  const previa = tacticaDelManual(DB, registro.id).etiquetas?.[String(sucursal_id)] || null;
  if (previa && typeof previa.mes === 'string' && previa.mes > mes) return;
  const fuerte = registro.resultado === 'probada' || registro.resultado === 'no_funciono';
  if (!fuerte && previa && !ETIQUETAS_DEBILES.includes(previa.estado)) return;
  manual.fijarEtiqueta(DB, registro.id, sucursal_id, { estado: fuerte ? registro.resultado : 'sin_dato', mes, resultado: registro.texto });
}

function cerrarPlan(sqlite, DB, plan, hoy, cierres) {
  const registros = calificarPlan(sqlite, DB, plan, hoy);
  const sucursal_id = Number(plan.sucursal_id);
  // Todo o nada: si una etiqueta truena, se regresan las ya escritas de este cierre (etiqueta, historial y fecha).
  const respaldo = registros.map(r => {
    const t = tacticaDelManual(DB, r.id);
    return { t, etiquetas: JSON.parse(JSON.stringify(t.etiquetas || {})), largo: t.historial.length, actualizada_en: t.actualizada_en };
  });
  try {
    registros.forEach(r => escribirEtiqueta(DB, r, sucursal_id, plan.mes));
    const cierre = { id: cierres.reduce((mx, c) => Math.max(mx, Number(c.id) || 0), 0) + 1, sucursal_id, mes: plan.mes, plan_mes_id: plan.id,
      cerrado_en: new Date().toISOString(), tacticas: registros };
    cierres.push(cierre);
    return cierre;
  } catch (e) {
    for (const r of respaldo) Object.assign(r.t, { etiquetas: r.etiquetas, actualizada_en: r.actualizada_en }).historial.length = r.largo;
    throw e;
  }
}

// ¿SICAR ya mandó todo el mes de esa tienda? Su última recepción (día de México) debe ser del día siguiente al último
// domingo del mes o después. Sin fila, sin recepción o con fecha ilegible: no está al día. Falla cerrando.
function sicarAlDia(sqlite, sucursal_id, mes) {
  const fila = sqlite.prepare('SELECT ultima_recepcion FROM sicar_tiendas WHERE sucursal_id = ?').get(Number(sucursal_id));
  const recibido = typeof fila?.ultima_recepcion === 'string' ? new Date(fila.ultima_recepcion) : null;
  if (!recibido || Number.isNaN(recibido.getTime())) return false;
  return fechaLocal(recibido) >= primerDiaParaSellar('mensual', `${mes}-01`);
}

/**
 * Cierra todo mes de plan aprobado que ya pasó su gracia y no tiene cierre. Sin SICAR, o con SICAR de esa tienda sin
 * mandar todo el mes, no cierra (se reintenta en la siguiente vuelta). Una tienda que truena no detiene a las demás.
 * Devuelve los cierres nuevos; nunca recalcula ni borra.
 */
function cerrarMesesPendientes(sqlite, DB, { hoy }) {
  if (!sqlite) return [];
  const cierres = asegurarCierres(DB);
  const planes = Array.isArray(DB.pos.cinco_caminos.planes_mes) ? DB.pos.cinco_caminos.planes_mes : [];
  const pendientes = planes.filter(p => p && typeof p.mes === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(p.mes) && hoy >= diaDeCierre(p.mes)
    && !cierres.some(c => Number(c.sucursal_id) === Number(p.sucursal_id) && c.mes === p.mes))
    .sort((a, b) => a.mes.localeCompare(b.mes) || Number(a.sucursal_id) - Number(b.sucursal_id));
  const hechos = [];
  for (const plan of pendientes) {
    try {
      if (!sicarAlDia(sqlite, plan.sucursal_id, plan.mes)) continue;
      hechos.push(cerrarPlan(sqlite, DB, plan, hoy, cierres));
    } catch (e) {
      console.warn(`Cierre del mes ${plan.mes} de la tienda ${plan.sucursal_id} no se pudo hacer; se reintenta en la siguiente vuelta:`, e.message);
    }
  }
  return hechos;
}

module.exports = {
  evaluarTactica, evaluarPlan, textoResultado, cerrarMesesPendientes, asegurarCierres, diaDeCierre, avanceEvidencias, LECTORES, RADAR,
};
