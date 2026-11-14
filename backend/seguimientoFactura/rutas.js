// Rutas del seguimiento por factura de CEDIS. Ver: ver_seguimiento_facturas. Cambiar: gestionar_seguimiento_facturas.
// El actor sale siempre del token; ningún id de usuario del cuerpo cuenta.

const { fechaLocal } = require('../fechas');
const { VALORES_INICIALES, leerConfig } = require('./config');
const { incorporar } = require('./incorporar');
const { vueltaCompleta, procesarPendientes, saldoFactura, guardarRevision } = require('./servicio');
const consultas = require('./consultas');

const error = (status, mensaje) => Object.assign(new Error(mensaje), { status });

// Rango permitido de cada valor configurable (enteros).
const RANGOS = {
  dias_revisado_caduca: [1, 365], dias_posponer_maximo: [1, 365], dias_transito_alarma: [1, 365],
  dias_traslado: [1, 3650], dias_margen_75: [1, 3650], dias_margen_50: [1, 3650], dias_liquidacion: [1, 3650],
  ganancia_75_porcentaje: [0, 100], ganancia_50_porcentaje: [0, 100], ganancia_liquidacion_porcentaje: [0, 100],
  semanas_ventas: [1, 52], semanas_informativas: [1, 52], multiplicador_destino: [1, 10], semanas_con_ventas: [1, 52],
  semanas_cobertura_destino: [1, 52], semanas_reserva_origen: [0, 52], dias_datos_atrasados: [1, 30], horas_foto_vieja: [1, 168],
};

function motivoValido(motivo) {
  if (typeof motivo !== 'string') throw error(400, 'El motivo es obligatorio.');
  const limpio = motivo.trim();
  if (limpio.length < 3 || limpio.length > 200) throw error(400, 'El motivo debe tener de 3 a 200 caracteres.');
  return limpio;
}

/** Revisado o pospuesto (con fecha futura). 'nuevo' y 'retirado' solo los pone el sistema. */
function gestionarAviso(sqlite, id, cuerpo, actor, ahora = new Date().toISOString()) {
  const avisoId = /^\d+$/.test(String(id)) ? Number(id) : 0;
  const { estado, pospuesto_hasta } = cuerpo || {};
  if (!['revisado', 'pospuesto'].includes(estado)) throw error(400, 'Estado inválido: usa revisado o pospuesto.');
  const motivo = motivoValido(cuerpo?.motivo);
  let hasta = null;
  if (estado === 'pospuesto') {
    const hoy = fechaLocal(ahora);
    const valido = typeof pospuesto_hasta === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(pospuesto_hasta)
      && new Date(`${pospuesto_hasta}T00:00:00Z`).toISOString().slice(0, 10) === pospuesto_hasta;
    if (!valido || pospuesto_hasta <= hoy) throw error(400, 'Posponer requiere una fecha futura (AAAA-MM-DD).');
    const maximo = leerConfig(sqlite).dias_posponer_maximo;
    const limite = new Date(Date.parse(`${hoy}T00:00:00Z`) + maximo * 86400000).toISOString().slice(0, 10);
    if (pospuesto_hasta > limite) throw error(400, `No se puede posponer más de ${maximo} días.`);
    hasta = pospuesto_hasta;
  }
  return sqlite.transaction(() => {
    const aviso = sqlite.prepare('SELECT * FROM seguimiento_avisos WHERE id=?').get(avisoId);
    if (!aviso) throw error(404, 'Aviso no encontrado.');
    if (aviso.estado === 'retirado') throw error(409, 'El aviso ya fue retirado por el sistema.');
    sqlite.prepare('UPDATE seguimiento_avisos SET estado=?, pospuesto_hasta=? WHERE id=?').run(estado, hasta, avisoId);
    if (estado === 'revisado') guardarRevision(sqlite, aviso, saldoFactura(sqlite, aviso.sucursal_id, aviso.com_id), ahora);
    sqlite.prepare(`INSERT INTO seguimiento_avisos_historial(aviso_id, estado, motivo, actor, fecha) VALUES (?, ?, ?, ?, ?)`)
      .run(avisoId, estado, motivo, actor, ahora);
    return sqlite.prepare('SELECT * FROM seguimiento_avisos WHERE id=?').get(avisoId);
  }).immediate();
}

function verConfig(sqlite) {
  return { valores: leerConfig(sqlite), iniciales: VALORES_INICIALES,
    historial: sqlite.prepare('SELECT * FROM seguimiento_config_historial ORDER BY id DESC LIMIT 200').all() };
}

/** Solo claves conocidas, enteros en rango y etapas/porcentajes en orden. Cambios con historial; luego recalcula. */
function cambiarConfig(sqlite, cuerpo, actor, ahora = new Date().toISOString()) {
  if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo) || !Object.keys(cuerpo).length) {
    throw error(400, 'Manda al menos un valor.');
  }
  for (const [clave, valor] of Object.entries(cuerpo)) {
    if (!Object.hasOwn(RANGOS, clave)) throw error(400, `Valor desconocido: ${clave}.`);
    const [min, max] = RANGOS[clave];
    if (typeof valor !== 'number' || !Number.isInteger(valor) || valor < min || valor > max) {
      throw error(400, `${clave} debe ser un entero de ${min} a ${max}.`);
    }
  }
  return sqlite.transaction(() => {
    const actual = leerConfig(sqlite), nuevo = { ...actual, ...cuerpo };
    if (!(nuevo.dias_traslado < nuevo.dias_margen_75 && nuevo.dias_margen_75 < nuevo.dias_margen_50
      && nuevo.dias_margen_50 < nuevo.dias_liquidacion)) throw error(400, 'Los días de las etapas deben ir en aumento.');
    if (!(nuevo.ganancia_75_porcentaje > nuevo.ganancia_50_porcentaje
      && nuevo.ganancia_50_porcentaje >= nuevo.ganancia_liquidacion_porcentaje)) {
      throw error(400, 'Los porcentajes de ganancia deben ir en descenso.');
    }
    if (nuevo.semanas_informativas > nuevo.semanas_ventas) throw error(400, 'Las semanas informativas no pueden exceder las de ventas.');
    for (const [clave, valor] of Object.entries(cuerpo)) {
      if (actual[clave] === valor) continue;
      sqlite.prepare(`INSERT INTO seguimiento_config(clave, valor, actor, fecha) VALUES (?, ?, ?, ?)
        ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor, actor=excluded.actor, fecha=excluded.fecha`)
        .run(clave, String(valor), actor, ahora);
      sqlite.prepare(`INSERT INTO seguimiento_config_historial(clave, anterior, nuevo, actor, fecha) VALUES (?, ?, ?, ?, ?)`)
        .run(clave, String(actual[clave]), String(valor), actor, ahora);
    }
    vueltaCompleta(sqlite, ahora);
    return verConfig(sqlite);
  }).immediate();
}

function registrarRutasSeguimiento(app, { sqlite, requiereLogin, requierePermiso, resolverPermisosDeRol }) {
  const permiso = clave => [requiereLogin, requierePermiso(clave, resolverPermisosDeRol)];
  const VER = 'ver_seguimiento_facturas', GESTIONAR = 'gestionar_seguimiento_facturas';
  const ejecutar = fn => (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { res.json(fn(sqlite(), req, String(req.usuarioToken.id))); }
    catch (e) {
      if (!e.status) console.error('SEGUIMIENTO_FALLO', e.message);
      res.status(e.status || 500).json({ error: e.status ? e.message : 'No se pudo completar la operación.' });
    }
  };
  const base = '/api/seguimiento-facturas';
  app.get(`${base}/tiendas`, ...permiso(VER), ejecutar(db => consultas.tiendas(db)));
  app.get(`${base}/config`, ...permiso(GESTIONAR), ejecutar(db => verConfig(db)));
  app.put(`${base}/config`, ...permiso(GESTIONAR), ejecutar((db, req, actor) => cambiarConfig(db, req.body, actor)));
  app.post(`${base}/tiendas/:sucursal_id/incorporar`, ...permiso(GESTIONAR), ejecutar((db, req, actor) => {
    const foto = incorporar(db, { sucursal_id: req.params.sucursal_id, actor });
    vueltaCompleta(db);
    return { sucursal_id: Number(req.params.sucursal_id), corte: foto.corte, claves: foto.claves.length, problemas: foto.problemas.length };
  }));
  app.post(`${base}/avisos/:id`, ...permiso(GESTIONAR), ejecutar((db, req, actor) => gestionarAviso(db, req.params.id, req.body, actor)));
  // Mismo alcance que la lista: quien ve el módulo ve todo. Solo se leen paginación y filtro; nunca ?sucursal_id=.
  app.get(`${base}/en-camino`, ...permiso(VER), ejecutar((db, req) => {
    const { pagina, por_pagina, solo_alarmas } = req.query;
    return consultas.enCamino(db, { pagina, por_pagina, solo_alarmas });
  }));
  app.get(`${base}/sicar-sin-asignar`, ...permiso(VER), ejecutar(db => consultas.sicarSinAsignar(db)));
  app.get(base, ...permiso(VER), ejecutar((db, req) => consultas.listar(db, req.query)));
  app.get(`${base}/:sucursal_id/:com_id`, ...permiso(VER),
    ejecutar((db, req) => consultas.detalle(db, req.params.sucursal_id, req.params.com_id)));
}

/**
 * Ciclos del servidor. El recálculo va en tramos de máximo 200 ms con pausa de 1 s entre tramos: el mismo
 * servidor cobra en las tiendas y no se le puede trabar. La vuelta diaria se revisa cada hora y al arrancar
 * (un despliegue reinicia los relojes; sin esto los avisos de 45/60/90/120 días dejarían de avanzar).
 */
function iniciarCiclosSeguimiento(sqlite, { tramoMs = 200, pausaMs = 1000 } = {}) {
  let ocupado = false, ultimoDia = null;
  const tramo = () => {
    if (ocupado) return;
    ocupado = true;
    let quedan = 0;
    try { quedan = procesarPendientes(sqlite(), { limite: 200, presupuestoMs: tramoMs }).quedan; }
    catch (e) { console.error('SEGUIMIENTO_FALLO', e.message); }
    finally { ocupado = false; }
    if (quedan > 0) setTimeout(tramo, pausaMs).unref();
  };
  const revisarDia = () => {
    const hoy = fechaLocal();
    if (hoy === ultimoDia) return;
    try { vueltaCompleta(sqlite()); ultimoDia = hoy; } catch (e) { console.error('SEGUIMIENTO_FALLO', e.message); }
    tramo();
  };
  setTimeout(revisarDia, 60000).unref();
  setInterval(revisarDia, 3600000).unref();
  setInterval(tramo, 5 * 60000).unref();
  return { tramo, revisarDia };
}

module.exports = { registrarRutasSeguimiento, iniciarCiclosSeguimiento, gestionarAviso, cambiarConfig, RANGOS };
