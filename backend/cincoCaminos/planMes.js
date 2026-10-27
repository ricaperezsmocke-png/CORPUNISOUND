/**
 * Plan del mes de los cinco caminos (spec 2026-10-24, sección 6), parte pura: arma los datos que verá la IA y valida
 * lo que proponga. No llama al modelo, no escribe en la base y no crea metas.
 *
 * Todo lo que la IA diga se revisa aquí, en el servidor: camino, tácticas del manual, cifras dentro de [+5 %, +15 %] de
 * la base propia y números del "por qué" que existan en los datos enviados.
 */
const { tableroTienda } = require('./tablero');
const { semanaDe } = require('./semanas');
const { vistaManual } = require('./manual');
const { NUMEROS_META, valorDelPeriodo } = require('./metaNumero');
const { quitarNombres } = require('../planIADatos');

const CAMINOS_PLAN = ['calidad_dato', 'prospectos', 'conversion', 'compras_por_cliente', 'venta_promedio'];
const RESPONSABLES = ['vendedores', 'encargado', 'compras', 'gerente'];
const MINIMO_PCT_CON_CLIENTE = 500; // décimas: 50 %
const SUBE_MINIMO = 1.05;
const SUBE_MAXIMO = 1.15;
const MAX_POR_QUE = 300;
const SEMANAS_BASE = 8;
const TEXTO_POR_QUE = 'Propuesta basada en los números de la tienda';
// Cuántas unidades enteras caben en una unidad legible, según la escala del número.
const DIVISOR = { decimas: 10, centavos: 100, centesimas: 100, entero: 1 };

const aLegible = (numero, entero) => (entero === null ? null : entero / DIVISOR[NUMEROS_META[numero].escala]);
const aEntero = (numero, legible) => Math.round(legible * DIVISOR[NUMEROS_META[numero].escala]);

const comparable = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const numerosEn = texto => (texto.match(/\d[\d,]*(?:\.\d+)?/g) || []).map(s => Number(s.replace(/,/g, '')));
const hablaDeDescuento = texto => /descuent|rebaj/.test(comparable(texto));

function numerosDe(valor, lista = []) {
  if (typeof valor === 'number' && Number.isFinite(valor)) lista.push(valor);
  else if (valor && typeof valor === 'object') Object.values(valor).forEach(v => numerosDe(v, lista));
  return lista;
}

function falla(motivo) {
  const error = new Error(`La IA devolvió un plan inválido: ${motivo}`);
  error.planInvalido = true;
  throw error;
}

function planesAnteriores(DB, sucursal, mes) {
  const lista = DB.pos?.cinco_caminos?.planes_mes;
  if (!Array.isArray(lista)) return [];
  return lista.filter(p => p && Number(p.sucursal_id) === sucursal && p.mes !== mes)
    .map(p => ({ mes: p.mes, camino: p.camino, tacticas: Array.isArray(p.tacticas) ? p.tacticas : [] }));
}

function manualParaIA(DB, sucursal) {
  return vistaManual(DB, { verTodas: false, sucursalId: sucursal })
    .filter(t => t.activa === true && t.como_se_mide !== 'fase_2' && t.como_se_mide !== 'fase_3')
    .map(t => ({
      id: t.id, nombre: quitarNombres(DB, t.nombre), camino: t.camino, numero_que_mueve: t.numero_que_mueve, candado: t.candado,
      quien: t.quien, como_se_mide: t.como_se_mide, probada_en: t.probada_en,
      etiqueta_tienda: { estado: t.etiqueta_tienda.estado, mes: t.etiqueta_tienda.mes,
        resultado: t.etiqueta_tienda.resultado === null ? null : quitarNombres(DB, t.etiqueta_tienda.resultado) },
    }));
}

/**
 * Datos agregados de una tienda para proponer el plan de `mes` ('AAAA-MM'). Devuelve:
 * - `datos`: lo único que ve la IA (sin nombres de persona);
 * - `bases`: por número, los valores enteros del promedio de 8 semanas y del mismo mes de 2025 (null = sin dato);
 * - `calidad_primero`: true si el % de ventas con cliente del promedio es menor que 50;
 * - `cifrasPermitidas`: los números que el "por qué" puede citar.
 */
function armarDatosPlanMes(sqlite, DB, { sucursal_id, mes, hoy }) {
  const sucursal = Number(sucursal_id);
  const lunesHoy = semanaDe(hoy).lunes;
  const previo = tableroTienda(sqlite, DB, { sucursal_id: sucursal, lunes: lunesHoy }).promedio_8;
  const anio = Number(mes.slice(0, 4)) - 1;
  const bases = {};
  const numeros = {};
  for (const [clave, def] of Object.entries(NUMEROS_META)) {
    const crudo = def.leer(previo);
    const promedio8 = typeof crudo === 'number' ? Math.round(crudo * def.factor) : null;
    const mismo = valorDelPeriodo(sqlite, DB, { sucursal_id: sucursal, numero: clave, periodo: 'mensual', inicio: `${anio}-${mes.slice(5)}-01`, hoy });
    bases[clave] = { promedio_8: promedio8, mismo_mes: mismo.valor };
    numeros[clave] = { nombre: def.etiqueta, unidad: def.unidad === 'centavos' ? 'pesos' : def.unidad,
      promedio_8_semanas: aLegible(clave, promedio8), mismo_mes_2025: aLegible(clave, mismo.valor) };
  }
  const datos = {
    fecha_hoy: hoy, mes, semanas_base: SEMANAS_BASE, anio_comparacion: anio, numeros,
    registros_por_10_tickets: previo.radar.registros_por_10_tickets,
    manual: manualParaIA(DB, sucursal),
    planes_anteriores: planesAnteriores(DB, sucursal, mes),
  };
  const calidadPrimero = bases.pct_con_cliente.promedio_8 !== null && bases.pct_con_cliente.promedio_8 < MINIMO_PCT_CON_CLIENTE;
  return { datos, bases, calidad_primero: calidadPrimero, cifrasPermitidas: numerosDe(datos) };
}

const textoValido = (v, maximo) => typeof v === 'string' && v.trim().length > 0 && v.trim().length <= maximo;

function porQue(valor, permitidas) {
  return textoValido(valor, MAX_POR_QUE) && numerosEn(valor).every(n => permitidas.has(n)) ? valor.trim() : TEXTO_POR_QUE;
}

function normalizarId(id) {
  const n = typeof id === 'number' || (typeof id === 'string' && /^\d+$/.test(id)) ? Number(id) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function validarTacticas(lista, manual, camino, permitidas) {
  if (!Array.isArray(lista) || lista.length !== 2) falla('debe traer exactamente 2 tácticas');
  const vistos = new Set();
  return lista.map((item, i) => {
    const id = normalizarId(item?.id);
    const tactica = manual.find(t => t.id === id);
    if (!tactica) falla(`la táctica ${i + 1} no está en el manual o no está disponible`);
    if (vistos.has(id)) falla('trae una táctica repetida');
    vistos.add(id);
    const texto = porQue(item.por_que, permitidas);
    const descuento = camino === 'conversion' && (hablaDeDescuento(tactica.nombre) || hablaDeDescuento(texto));
    return { id, nombre: tactica.nombre, por_que: texto,
      ...(descuento ? { rechazada: true, motivo_rechazo: 'No se propone descuento para un problema de conversión' } : {}) };
  });
}

function validarMeta(m, i, ctx, permitidas, calidadPrimero) {
  const n = i + 1;
  if (!m || typeof m !== 'object') falla(`la meta ${n} no tiene contenido`);
  if (!Object.hasOwn(NUMEROS_META, m.numero)) falla(`la meta ${n} usa un número que no se puede medir`);
  if (!RESPONSABLES.includes(m.responsable_rol)) falla(`el responsable de la meta ${n} debe ser un rol válido`);
  if (typeof m.valor !== 'number' || !Number.isFinite(m.valor) || m.valor <= 0) falla(`la cifra de la meta ${n} debe ser un número mayor que 0`);
  const def = NUMEROS_META[m.numero];
  const base = ctx.bases?.[m.numero]?.mismo_mes ?? ctx.bases?.[m.numero]?.promedio_8 ?? null;
  if (base === null) return { descartada: { numero: m.numero, motivo: 'sin dato para fijar una base' } };
  const maximo = Math.min(Math.round(base * SUBE_MAXIMO), def.maximo);
  const minimo = Math.min(Math.round(base * SUBE_MINIMO), maximo);
  const propuesto = aEntero(m.numero, m.valor);
  const entero = Math.min(Math.max(propuesto, minimo), maximo);
  return { meta: { numero: m.numero, valor: aLegible(m.numero, entero), valor_entero: entero, base: aLegible(m.numero, base),
    rango: { minimo: aLegible(m.numero, minimo), maximo: aLegible(m.numero, maximo) }, responsable_rol: m.responsable_rol,
    por_que: porQue(m.por_que, permitidas),
    ...(entero !== propuesto ? { ajustada: true, propuesta_ia: m.valor } : {}),
    ...(calidadPrimero && m.numero !== 'pct_con_cliente' ? { fuera_de_camino: true } : {}) } };
}

/**
 * Revisa la propuesta de la IA contra el contexto de `armarDatosPlanMes`. Lanza un error con `planInvalido` si la forma
 * no sirve; si sirve, devuelve el plan con las cifras ajustadas, las tácticas rechazadas marcadas y las metas descartadas.
 */
function validarPropuestaMes(propuesta, ctx) {
  if (!propuesta || typeof propuesta !== 'object') falla('sin contenido');
  if (!CAMINOS_PLAN.includes(propuesta.camino)) falla('el camino no es válido');
  const permitidas = new Set(ctx.cifrasPermitidas);
  const camino = ctx.calidad_primero ? 'calidad_dato' : propuesta.camino;
  const tacticas = validarTacticas(propuesta.tacticas, ctx.datos.manual, camino, permitidas);
  const crudas = propuesta.metas;
  if (!Array.isArray(crudas) || crudas.length < 1 || crudas.length > 3) falla('debe traer de 1 a 3 metas');
  if (new Set(crudas.map(m => m?.numero)).size !== crudas.length) falla('trae un número repetido en las metas');
  const resultados = crudas.map((m, i) => validarMeta(m, i, ctx, permitidas, ctx.calidad_primero));
  const metas = resultados.filter(r => r.meta).map(r => r.meta);
  if (!metas.length) falla('ninguna meta tiene datos para fijar una base');
  return { camino, camino_ia: propuesta.camino, camino_forzado: camino !== propuesta.camino,
    por_que_camino: porQue(propuesta.por_que_camino, permitidas), tacticas, metas,
    descartadas: resultados.filter(r => r.descartada).map(r => r.descartada) };
}

module.exports = { armarDatosPlanMes, validarPropuestaMes, TEXTO_POR_QUE, CAMINOS_PLAN, RESPONSABLES };
