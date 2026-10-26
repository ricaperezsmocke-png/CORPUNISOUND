/**
 * Manual de tácticas de los cinco caminos (spec 2026-10-24, secciones 5, 7 y 9).
 *
 * Vive en DB.pos.cinco_caminos.tacticas, así entra solo al respaldo de Drive. Las tácticas nunca se borran: se retiran
 * con motivo. Todo cambio deja una entrada inmutable en `historial` con quién lo hizo.
 *
 * La etiqueta de prueba por tienda NO se edita por ninguna ruta: `validarTactica` rechaza cualquier cuerpo que la traiga
 * y `fijarEtiqueta` es una función interna, sin ruta, que usará el cierre del mes (P5).
 */
const { TACTICAS_V1 } = require('./manualSemilla');

const CAMINOS = ['calidad_dato', 'prospectos', 'conversion', 'compras_por_cliente', 'venta_promedio', 'margen'];
// Claves del tablero (tablero.js), más las dos de la fase 3 que todavía no tienen cálculo.
const NUMEROS = [
  'pct_con_cliente', 'clientes_nuevos', 'conversion', 'registros_por_10_tickets', 'recompra_90',
  'ticket_promedio_centavos', 'articulos_por_ticket', 'pct_instrumento_con_accesorio', 'margen', 'descuento_promedio',
];
const QUIEN = ['cajera', 'vendedor', 'encargado', 'gerente', 'compras'];
const MEDICIONES = ['sistema', 'evidencia', 'sistema_y_evidencia', 'fase_2', 'fase_3'];
const ESTADOS_ETIQUETA = ['por_probar', 'probada', 'no_funciono', 'sin_dato'];
const CAMPOS = ['nombre', 'descripcion', 'camino', 'numero_que_mueve', 'candado', 'quien', 'como_se_mide', 'referencia_pdf'];
const OBLIGATORIOS = ['nombre', 'camino', 'numero_que_mueve', 'quien', 'como_se_mide'];

const CONTROL = /[\u0000-\u001f\u007f]/;
const CONTROL_CON_SALTOS = /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/;
const MES = /^\d{4}-(0[1-9]|1[0-2])$/;

function error(status, mensaje) {
  return Object.assign(new Error(mensaje), { status });
}

function esObjeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function ahora() {
  return new Date().toISOString();
}

function copia(valor) {
  return JSON.parse(JSON.stringify(valor));
}

function texto(v, min, max, conSaltos) {
  if (typeof v !== 'string') return null;
  const limpio = v.trim();
  if (limpio.length < min || limpio.length > max) return null;
  return (conSaltos ? CONTROL_CON_SALTOS : CONTROL).test(limpio) ? null : limpio;
}

function quienValido(v) {
  if (!Array.isArray(v) || v.length === 0 || v.length > QUIEN.length) return null;
  if (v.some(x => !QUIEN.includes(x)) || new Set(v).size !== v.length) return null;
  return QUIEN.filter(x => v.includes(x));
}

/**
 * Valida con lista de lo permitido. Devuelve el objeto limpio o null; null rechaza la petición entera.
 * Con `parcial` solo exige que venga al menos un campo; sin él, exige los obligatorios.
 */
function validarTactica(body, { parcial = false } = {}) {
  if (!esObjeto(body)) return null;
  const claves = Object.keys(body);
  if (claves.length === 0 || claves.some(k => !CAMPOS.includes(k))) return null;
  if (!parcial && OBLIGATORIOS.some(k => body[k] === undefined)) return null;
  const limpio = {};
  if (body.nombre !== undefined) {
    limpio.nombre = texto(body.nombre, 3, 120, false);
    if (limpio.nombre === null) return null;
  }
  if (body.descripcion !== undefined) {
    limpio.descripcion = body.descripcion === '' ? '' : texto(body.descripcion, 0, 600, true);
    if (limpio.descripcion === null) return null;
  }
  if (body.referencia_pdf !== undefined) {
    limpio.referencia_pdf = body.referencia_pdf === '' ? '' : texto(body.referencia_pdf, 0, 60, false);
    if (limpio.referencia_pdf === null) return null;
  }
  if (body.camino !== undefined) {
    if (!CAMINOS.includes(body.camino)) return null;
    limpio.camino = body.camino;
  }
  if (body.numero_que_mueve !== undefined) {
    if (!NUMEROS.includes(body.numero_que_mueve)) return null;
    limpio.numero_que_mueve = body.numero_que_mueve;
  }
  if (body.candado !== undefined) {
    if (body.candado !== null && !NUMEROS.includes(body.candado)) return null;
    limpio.candado = body.candado;
  }
  if (body.quien !== undefined) {
    limpio.quien = quienValido(body.quien);
    if (limpio.quien === null) return null;
  }
  if (body.como_se_mide !== undefined) {
    if (!MEDICIONES.includes(body.como_se_mide)) return null;
    limpio.como_se_mide = body.como_se_mide;
  }
  if (limpio.candado && limpio.candado === limpio.numero_que_mueve) return null;
  return limpio;
}

function lista(DB) {
  if (!DB.pos.cinco_caminos || typeof DB.pos.cinco_caminos !== 'object') DB.pos.cinco_caminos = {};
  if (!Array.isArray(DB.pos.cinco_caminos.tacticas)) throw error(500, 'El manual de tácticas no está sembrado');
  return DB.pos.cinco_caminos.tacticas;
}

function normalizarId(id) {
  if (id === null || id === undefined || (typeof id === 'string' && id.trim() === '')) return null;
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function buscar(DB, id) {
  const n = normalizarId(id);
  const t = n === null ? null : lista(DB).find(x => x.id === n);
  if (!t) throw error(404, 'Táctica no encontrada');
  return t;
}

function usuarioDe(usuarioId) {
  const n = normalizarId(usuarioId);
  return n === null ? null : n;
}

function entrada(usuarioId, accion, antes, despues, extra = {}) {
  return { fecha_hora: ahora(), usuario_id: usuarioDe(usuarioId), accion, antes, despues, ...extra };
}

/** Siembra v1: solo si la lista no existe todavía. Una lista vacía o corregida no se toca. Devuelve cuántas sembró. */
function sembrarManual(DB) {
  if (!DB.pos.cinco_caminos || typeof DB.pos.cinco_caminos !== 'object') DB.pos.cinco_caminos = {};
  const cc = DB.pos.cinco_caminos;
  if (Array.isArray(cc.tacticas)) return 0;
  const hora = ahora();
  cc.tacticas = TACTICAS_V1.map(t => ({
    id: t.numero_v1,
    ...copia(t),
    activa: true,
    motivo_retiro: null,
    etiquetas: {},
    historial: [entrada(null, 'alta', null, copia(t), { origen: 'semilla_v1' })],
    creada_en: hora,
    actualizada_en: hora,
  }));
  return cc.tacticas.length;
}

function errorDeValidacion() {
  return error(400, 'Datos de la táctica no válidos');
}

function crearTactica(DB, body, usuarioId) {
  const limpio = validarTactica(body, { parcial: false });
  if (!limpio) throw errorDeValidacion();
  const todas = lista(DB);
  const hora = ahora();
  const datos = { descripcion: '', candado: null, referencia_pdf: '', ...limpio };
  const t = {
    id: todas.reduce((max, x) => Math.max(max, x.id), 0) + 1,
    numero_v1: null,
    ...datos,
    activa: true,
    motivo_retiro: null,
    etiquetas: {},
    historial: [entrada(usuarioId, 'alta', null, copia(datos))],
    creada_en: hora,
    actualizada_en: hora,
  };
  todas.push(t);
  return copia(t);
}

function cambiarTactica(DB, id, body, usuarioId) {
  const limpio = validarTactica(body, { parcial: true });
  if (!limpio) throw errorDeValidacion();
  const t = buscar(DB, id);
  if (!t.activa) throw error(409, 'La táctica está retirada: reactívala para editarla');
  const antes = {};
  const despues = {};
  for (const [campo, valor] of Object.entries(limpio)) {
    if (JSON.stringify(t[campo]) !== JSON.stringify(valor)) {
      antes[campo] = copia(t[campo]);
      despues[campo] = valor;
    }
  }
  if (Object.keys(despues).length === 0) return copia(t);
  const candado = despues.candado !== undefined ? despues.candado : t.candado;
  const numero = despues.numero_que_mueve !== undefined ? despues.numero_que_mueve : t.numero_que_mueve;
  if (candado && candado === numero) throw errorDeValidacion();
  Object.assign(t, despues);
  t.historial.push(entrada(usuarioId, 'cambio', antes, despues));
  t.actualizada_en = ahora();
  return copia(t);
}

function retirarTactica(DB, id, motivo, usuarioId) {
  const t = buscar(DB, id);
  const limpio = texto(motivo, 3, 200, false);
  if (limpio === null) throw error(400, 'El motivo del retiro debe tener de 3 a 200 caracteres');
  if (!t.activa) throw error(409, 'La táctica ya está retirada');
  t.activa = false;
  t.motivo_retiro = limpio;
  t.historial.push(entrada(usuarioId, 'retiro', { activa: true }, { activa: false, motivo_retiro: limpio }));
  t.actualizada_en = ahora();
  return copia(t);
}

function reactivarTactica(DB, id, usuarioId) {
  const t = buscar(DB, id);
  if (t.activa) throw error(409, 'La táctica ya está activa');
  const antes = { activa: false, motivo_retiro: t.motivo_retiro };
  t.activa = true;
  t.motivo_retiro = null;
  t.historial.push(entrada(usuarioId, 'reactivacion', antes, { activa: true, motivo_retiro: null }));
  t.actualizada_en = ahora();
  return copia(t);
}

/**
 * INTERNA, sin ruta: la usará el cierre del mes (P5). Escribe la etiqueta de prueba de una tienda.
 * El usuario queda en null: la escribe el sistema, no una persona.
 */
function fijarEtiqueta(DB, id, sucursalId, { estado, mes = null, resultado = null } = {}) {
  const t = buscar(DB, id);
  const suc = normalizarId(sucursalId);
  if (suc === null) throw error(400, 'Sucursal no válida');
  if (!ESTADOS_ETIQUETA.includes(estado)) throw error(400, 'Estado de etiqueta no válido');
  if (mes !== null && (typeof mes !== 'string' || !MES.test(mes))) throw error(400, 'Mes no válido');
  if (resultado !== null && texto(resultado, 1, 300, false) === null) throw error(400, 'Resultado no válido');
  const nueva = { estado, mes, resultado: resultado === null ? null : resultado.trim() };
  const previa = t.etiquetas[String(suc)] || null;
  t.etiquetas[String(suc)] = nueva;
  t.historial.push(entrada(null, 'etiqueta', { sucursal_id: suc, etiqueta: previa }, { sucursal_id: suc, etiqueta: copia(nueva) }));
  t.actualizada_en = ahora();
  return copia(t);
}

/**
 * Lista del manual recortada por alcance. Con `verTodas` trae las etiquetas de todas las tiendas; sin él, solo la de
 * `sucursalId` (que debe salir del token) y el conteo `probada_en`, que no revela cuáles tiendas son.
 */
function vistaManual(DB, { verTodas = false, sucursalId = null } = {}) {
  const suc = normalizarId(sucursalId);
  return lista(DB).map(t => {
    const { etiquetas, historial, ...resto } = copia(t);
    const propia = suc === null ? null : etiquetas[String(suc)];
    const vista = {
      ...resto,
      etiqueta_tienda: propia || { estado: 'por_probar', mes: null, resultado: null },
      probada_en: Object.values(etiquetas).filter(e => e.estado === 'probada').length,
    };
    if (verTodas) vista.etiquetas = etiquetas;
    return vista;
  });
}

function historialDe(DB, id) {
  return copia(buscar(DB, id).historial);
}

module.exports = {
  sembrarManual, validarTactica, crearTactica, cambiarTactica, retirarTactica, reactivarTactica, fijarEtiqueta, vistaManual,
  historialDe, NUMEROS, CAMINOS, QUIEN, MEDICIONES, ESTADOS_ETIQUETA,
};
