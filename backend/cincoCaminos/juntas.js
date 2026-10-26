/**
 * Junta del lunes de los cinco caminos (plan 2026-10-26, Task 2).
 *
 * Vive en DB.pos.cinco_caminos.compromisos y .juntas, así entra solo al respaldo de Drive. Los compromisos nunca se
 * borran ni se editan: se marcan hechos o se cancelan con motivo, siempre con el usuario del token. La tienda sale del
 * contexto (el token), jamás del cuerpo. "Junta hecha" exige al menos un compromiso vigente de esa semana y no se deshace.
 */
const { semanaDe, exigirLunes, sumarDias, ultimasSemanas, ultimaSemanaCompleta } = require('./semanas');
const { fechaLocal } = require('../fechas');

const CONTROL = /[\u0000-\u001f\u007f]/;
const CAMPOS = ['lunes', 'texto', 'responsable', 'fecha_compromiso'];
const SEMANAS_INDICADOR = 8;

function error(status, mensaje) {
  return Object.assign(new Error(mensaje), { status });
}

function esObjeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function texto(v, min, max) {
  if (typeof v !== 'string') return null;
  const limpio = v.trim();
  if (limpio.length < min || limpio.length > max || CONTROL.test(limpio)) return null;
  return limpio;
}

function asegurar(DB) {
  if (!DB.pos.cinco_caminos || typeof DB.pos.cinco_caminos !== 'object') DB.pos.cinco_caminos = {};
  const cc = DB.pos.cinco_caminos;
  if (!Array.isArray(cc.compromisos)) cc.compromisos = [];
  if (!Array.isArray(cc.juntas)) cc.juntas = [];
  return cc;
}

// Para LEER: un lunes de verdad y que ya llegó (las semanas pasadas se pueden consultar).
function lunesValido(lunes, hoy) {
  if (typeof lunes !== 'string') throw error(400, 'La semana se indica con su lunes (AAAA-MM-DD).');
  exigirLunes(lunes);
  if (lunes > hoy) throw error(400, 'La junta de una semana que todavía no empieza no se puede registrar.');
  return lunes;
}

// Para ESCRIBIR: solo la semana actual. Registrar una junta de una semana pasada inflaría el indicador.
function lunesActual(lunes, hoy) {
  if (typeof lunes !== 'string' || lunes !== semanaDe(hoy).lunes) throw error(400, 'Solo se registra la junta de esta semana.');
  return lunes;
}

const mismaTienda = (x, sucursalId) => esObjeto(x) && Number(x.sucursal_id) === Number(sucursalId);
const vigente = c => !c.cancelado;

function crearCompromiso(DB, body, { usuarioId, sucursalId, hoy = fechaLocal() }) {
  const cc = asegurar(DB);
  if (!esObjeto(body) || Object.keys(body).some(k => !CAMPOS.includes(k))) {
    throw error(400, 'El compromiso lleva solo texto, responsable, fecha de compromiso y, si se quiere, el lunes.');
  }
  const lunes = lunesActual(body.lunes === undefined ? semanaDe(hoy).lunes : body.lunes, hoy);
  const txt = texto(body.texto, 3, 200);
  const responsable = texto(body.responsable, 3, 80);
  if (!txt || !responsable) throw error(400, 'El compromiso lleva texto (3 a 200) y responsable (3 a 80).');
  const fecha = body.fecha_compromiso;
  if (typeof fecha !== 'string') throw error(400, 'La fecha de compromiso debe ser AAAA-MM-DD.');
  semanaDe(fecha);
  if (fecha < lunes || fecha > sumarDias(lunes, 13)) {
    throw error(400, 'La fecha de compromiso debe caer en la semana de la junta o en la siguiente.');
  }
  const id = cc.compromisos.reduce((max, x) => (esObjeto(x) && Number.isInteger(x.id) ? Math.max(max, x.id) : max), 0) + 1;
  const c = {
    id, sucursal_id: Number(sucursalId), lunes, texto: txt, responsable, fecha_compromiso: fecha,
    hecho: null, cancelado: null, creado_por_id: Number(usuarioId), creado_en: new Date().toISOString(),
  };
  cc.compromisos.push(c);
  return c;
}

// Regla 4: el id de la ruta es texto; solo dígitos, normalizado con Number antes de comparar.
function buscar(DB, id, sucursalId) {
  const valido = typeof id === 'number' || (typeof id === 'string' && /^\d+$/.test(id));
  const n = valido ? Number(id) : 0;
  const c = n > 0 ? asegurar(DB).compromisos.find(x => esObjeto(x) && Number(x.id) === n) : null;
  if (!c || !mismaTienda(c, sucursalId)) throw error(404, 'El compromiso no existe.');
  return c;
}

function marcarHecho(DB, id, { usuarioId, usuarioNombre, sucursalId }) {
  const c = buscar(DB, id, sucursalId);
  if (c.cancelado) throw error(409, 'El compromiso está cancelado.');
  if (c.hecho) throw error(409, 'El compromiso ya estaba marcado como hecho.');
  c.hecho = { por_id: Number(usuarioId), por_nombre: usuarioNombre || null, en: new Date().toISOString() };
  return c;
}

function cancelarCompromiso(DB, id, motivo, { usuarioId, sucursalId }) {
  const c = buscar(DB, id, sucursalId);
  const m = texto(motivo, 3, 200);
  if (!m) throw error(400, 'Cancelar pide un motivo de 3 a 200 caracteres.');
  if (c.cancelado) throw error(409, 'El compromiso ya estaba cancelado.');
  if (c.hecho) throw error(409, 'El compromiso ya se hizo; no se puede cancelar.');
  const cc = asegurar(DB);
  const juntaMarcada = cc.juntas.some(j => mismaTienda(j, sucursalId) && j.lunes === c.lunes);
  const otroVigente = cc.compromisos.some(x => x !== c && mismaTienda(x, sucursalId) && x.lunes === c.lunes && vigente(x));
  if (juntaMarcada && !otroVigente) throw error(409, 'La junta ya se marcó con este compromiso; no se puede cancelar el último.');
  c.cancelado = { por_id: Number(usuarioId), motivo: m, en: new Date().toISOString() };
  return c;
}

function marcarJunta(DB, lunes, { usuarioId, sucursalId, hoy = fechaLocal() }) {
  const cc = asegurar(DB);
  lunesActual(lunes, hoy);
  if (cc.juntas.some(j => mismaTienda(j, sucursalId) && j.lunes === lunes)) throw error(409, 'La junta de esa semana ya estaba marcada.');
  if (!cc.compromisos.some(c => mismaTienda(c, sucursalId) && c.lunes === lunes && vigente(c))) {
    throw error(400, 'La junta necesita al menos un compromiso vigente de esa semana.');
  }
  const j = { sucursal_id: Number(sucursalId), lunes, por_id: Number(usuarioId), en: new Date().toISOString() };
  cc.juntas.push(j);
  return j;
}

// Sobre las 8 semanas completas previas a hoy: cuántas tuvieron junta en esa tienda.
function indicador(DB, sucursalId, hoy = fechaLocal()) {
  const lunes = new Set(ultimasSemanas(ultimaSemanaCompleta(hoy), SEMANAS_INDICADOR));
  const con = new Set(asegurar(DB).juntas.filter(j => mismaTienda(j, sucursalId) && lunes.has(j.lunes)).map(j => j.lunes));
  return { semanas: SEMANAS_INDICADOR, con_junta: con.size, pct: Math.round((con.size / SEMANAS_INDICADOR) * 100) };
}

// El nombre se arma al leer, nunca se guarda: quien ya no existe queda señalado.
function nombreDe(DB, usuarioId) {
  const u = (DB.admin?.usuarios || []).find(x => Number(x.id) === Number(usuarioId));
  return u && u.nombre ? u.nombre : `Usuario #${usuarioId} (ya no existe)`;
}

function conNombres(DB, c) {
  const v = JSON.parse(JSON.stringify(c));
  v.creado_por_nombre = nombreDe(DB, v.creado_por_id);
  if (v.hecho) {
    v.hecho.por_nombre = v.hecho.por_nombre || nombreDe(DB, v.hecho.por_id);
    v.hecho.nombre = v.hecho.por_nombre;
  }
  if (v.cancelado) {
    v.cancelado.por_nombre = nombreDe(DB, v.cancelado.por_id);
    v.cancelado.nombre = v.cancelado.por_nombre;
  }
  return v;
}

function vista(DB, sucursalId, lunes, hoy = fechaLocal()) {
  const cc = asegurar(DB);
  const junta = cc.juntas.find(j => mismaTienda(j, sucursalId) && j.lunes === lunes);
  return {
    compromisos: cc.compromisos.filter(c => mismaTienda(c, sucursalId) && c.lunes === lunes).map(c => conNombres(DB, c)),
    junta: junta ? { ...junta, por_nombre: nombreDe(DB, junta.por_id) } : null,
    indicador: indicador(DB, sucursalId, hoy),
  };
}

module.exports = { asegurar, crearCompromiso, marcarHecho, cancelarCompromiso, marcarJunta, indicador, vista, lunesValido };
