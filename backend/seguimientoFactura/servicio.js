// Recálculo del seguimiento por claves pendientes (spec §8 y §12.6-12.7).
// Cada clave se recalcula en su propia transacción: si algo falla, sus resultados y avisos quedan como estaban
// y la clave sigue pendiente. Solo escribe tablas seguimiento_*; nunca toca SICAR.

const { fechaLocal } = require('../fechas');
const { leerConfig } = require('./config');
const { movimientosPorClave } = require('./lector');
const { calcular } = require('./motor');
const { etapa: etapaDe } = require('./estrategias');
const { artIdsDelLote, marcarPendientes } = require('./pendientes');

// Versión 2: resultados con rescate de la ventana de incorporación (datos.rescate) y controles del motor.
const VERSION = 2;
const CEDIS = 6;
const DIA_MS = 86400000;

function registrar(sqlite, avisoId, estado, motivo, ahora) {
  sqlite.prepare(`INSERT INTO seguimiento_avisos_historial(aviso_id, estado, motivo, actor, fecha)
    VALUES (?, ?, ?, 'sistema', ?)`).run(avisoId, estado, motivo, ahora);
}

function cambiarEstado(sqlite, aviso, estado, motivo, ahora) {
  sqlite.prepare('UPDATE seguimiento_avisos SET estado=?, pospuesto_hasta=NULL WHERE id=?').run(estado, aviso.id);
  registrar(sqlite, aviso.id, estado, motivo, ahora);
}

function diasDesde(fechaCompra, ahora) {
  return Math.floor((Date.parse(`${fechaLocal(ahora)}T00:00:00Z`) - Date.parse(`${fechaCompra}T00:00:00Z`)) / DIA_MS);
}

/**
 * Avisos de una factura según sus renglones guardados. Saldo = queda + tránsito (lo gris no genera avisos, §11.4).
 * Un aviso por etapa; al cambiar de etapa se retira el anterior. Sin resultados o sin saldo: se retiran todos.
 */
function revisarAvisos(sqlite, com_id, config, ahora) {
  const filas = sqlite.prepare('SELECT datos_json FROM seguimiento_resultado WHERE sucursal_id=? AND com_id=?')
    .all(CEDIS, com_id).map(f => JSON.parse(f.datos_json));
  const activos = sqlite.prepare(`SELECT * FROM seguimiento_avisos WHERE sucursal_id=? AND com_id=? AND estado <> 'retirado'`)
    .all(CEDIS, com_id);
  const saldo = filas.reduce((a, f) => a + BigInt(f.queda) + BigInt(f.transito), 0n);
  const etapa = filas.length && saldo > 0n ? etapaDe(diasDesde(filas[0].fecha_compra, ahora), config) : null;
  const motivo = !filas.length ? 'sin_resultado' : saldo === 0n ? 'agotada' : etapa ? 'cambio_de_etapa' : 'sin_etapa';
  for (const aviso of activos) if (aviso.etapa !== etapa) cambiarEstado(sqlite, aviso, 'retirado', motivo, ahora);
  if (!etapa) return;
  const existente = sqlite.prepare('SELECT * FROM seguimiento_avisos WHERE sucursal_id=? AND com_id=? AND etapa=?')
    .get(CEDIS, com_id, etapa);
  if (!existente) {
    const { lastInsertRowid } = sqlite.prepare(`INSERT INTO seguimiento_avisos(sucursal_id, com_id, etapa, estado)
      VALUES (?, ?, ?, 'nuevo')`).run(CEDIS, com_id, etapa);
    registrar(sqlite, lastInsertRowid, 'nuevo', null, ahora);
  } else if (existente.estado === 'retirado') {
    cambiarEstado(sqlite, existente, 'nuevo', 'saldo_de_nuevo', ahora);
  }
}

/**
 * Calcula la clave con el rescate de la ventana de incorporación. Todo o nada: si el lector no puede rescatarla o el motor
 * no cuadra sus controles, la clave se calcula exactamente como sin rescate y el intento queda anotado en calidad.
 */
function calcularConRescate(sqlite, clave, ahora) {
  const lectura = movimientosPorClave(sqlite, clave, { ahora, rescate: true });
  const calculo = calcular(lectura.movimientos);
  const { rescate } = lectura;
  if (rescate && !rescate.imposible && calculo.rescate_ok) return { lectura, calculo, rescate };
  if (!rescate) return { lectura, calculo, rescate: null };
  const detalle = rescate.imposible ? [{ sucursal_id: rescate.sucursal_id, motivo: rescate.imposible }] : calculo.rescate_fallas;
  const hoy = rescate.imposible ? lectura : lectura.sinRescate();
  hoy.calidad.problemas.push({ clave, motivo: 'rescate_inconsistente', detalle });
  return { lectura: hoy, calculo: rescate.imposible ? calculo : calcular(hoy.movimientos), rescate: null };
}

function recalcularClave(sqlite, clave, config, ahora) {
  const { lectura: { movimientos, calidad }, calculo, rescate } = calcularConRescate(sqlite, clave, ahora);
  const { lotes, incierto, anterior } = calculo;
  // Saldo calculado de la clave por tienda (sin factura + todas sus facturas): se compara contra la existencia SICAR.
  const saldo = new Map(Object.entries(anterior).map(([s, v]) => [s, BigInt(v)]));
  for (const l of lotes) {
    for (const [s, v] of Object.entries(l.por_sucursal)) saldo.set(s, (saldo.get(s) ?? 0n) + BigInt(v.queda));
  }
  const saldo_clave = Object.fromEntries([...saldo].map(([s, v]) => [s, String(v)]));
  const fechas = new Map(movimientos.filter(m => m.tipo === 'compra')
    .map(m => [JSON.stringify([m.lote.com_id, m.lote.renglon]), m.fecha.slice(0, 10)]));
  const facturas = new Set(sqlite.prepare('SELECT com_id FROM seguimiento_resultado WHERE clave=? AND sucursal_id=?')
    .all(clave, CEDIS).map(f => f.com_id));
  sqlite.prepare('DELETE FROM seguimiento_resultado WHERE clave=?').run(clave);
  const guardar = sqlite.prepare(`INSERT OR REPLACE INTO seguimiento_resultado
    (sucursal_id, com_id, renglon, clave, datos_json, version, calculado_en) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  for (const l of lotes) {
    const { sucursal_id, com_id, renglon } = l.lote;
    const datos = { ...l, clave, fecha_compra: fechas.get(JSON.stringify([com_id, renglon])), calidad, incierto, saldo_clave,
      ...(rescate ? { rescate } : {}) };
    guardar.run(sucursal_id, com_id, renglon, clave, JSON.stringify(datos), VERSION, ahora);
    facturas.add(com_id);
  }
  for (const com_id of [...facturas].sort()) revisarAvisos(sqlite, com_id, config, ahora);
  sqlite.prepare('DELETE FROM seguimiento_pendientes WHERE clave=?').run(clave);
}

/** Avisos pospuestos cuya fecha ya llegó (día local) vuelven a 'nuevo' con historial. */
function vencerPosposiciones(sqlite, ahora = new Date().toISOString()) {
  const hoy = fechaLocal(ahora);
  return sqlite.transaction(() => {
    const vencidos = sqlite.prepare(`SELECT * FROM seguimiento_avisos WHERE estado='pospuesto'
      AND (pospuesto_hasta IS NULL OR pospuesto_hasta <= ?)`).all(hoy);
    for (const aviso of vencidos) cambiarEstado(sqlite, aviso, 'nuevo', 'posposicion_vencida', ahora);
    return vencidos.length;
  }).immediate();
}

/**
 * Procesa hasta `limite` claves pendientes, la más vieja primero. Una clave que falla pasa al final de la fila.
 * Con `presupuestoMs` se detiene al agotarlo (siempre procesa al menos una) para no trabar el servidor de la caja.
 */
function procesarPendientes(sqlite, { limite = 50, ahora = new Date().toISOString(), presupuestoMs = Infinity } = {}) {
  const inicio = Date.now();
  vencerPosposiciones(sqlite, ahora);
  const config = leerConfig(sqlite);
  const claves = sqlite.prepare('SELECT clave FROM seguimiento_pendientes ORDER BY desde, clave LIMIT ?')
    .all(limite).map(f => f.clave);
  const errores = [];
  let procesadas = 0;
  for (const clave of claves) {
    if (procesadas + errores.length > 0 && Date.now() - inicio >= presupuestoMs) break;
    try {
      sqlite.transaction(() => recalcularClave(sqlite, clave, config, ahora)).immediate();
      procesadas++;
    } catch (e) {
      errores.push({ clave, mensaje: e.message });
      sqlite.prepare('UPDATE seguimiento_pendientes SET desde=? WHERE clave=?').run(ahora, clave);
    }
  }
  const quedan = sqlite.prepare('SELECT count(*) n FROM seguimiento_pendientes').get().n;
  return { procesadas, errores, quedan };
}

/**
 * Vuelta diaria: marca las claves de compras vigentes de CEDIS desde el día de su corte (las anteriores son
 * mercancía de la foto, no facturas seguidas) y toda clave con resultado guardado.
 */
function vueltaCompleta(sqlite, ahora = new Date().toISOString()) {
  const cedis = sqlite.prepare('SELECT corte FROM seguimiento_tiendas WHERE sucursal_id=?').get(CEDIS);
  const desdeDia = cedis ? fechaLocal(cedis.corte) : '9999-12-31';
  return sqlite.prepare(`INSERT INTO seguimiento_pendientes(clave, desde)
    SELECT DISTINCT clave, ? FROM (
      SELECT a.clave FROM sicar_compras c
        JOIN sicar_compras_detalle d ON d.sucursal_id=c.sucursal_id AND d.com_id=c.com_id
        JOIN sicar_articulos a ON a.sucursal_id=d.sucursal_id AND a.art_id=d.art_id
        WHERE c.sucursal_id=? AND c.estado='vigente' AND substr(c.fecha, 1, 10) >= ?
      UNION SELECT clave FROM seguimiento_resultado
    ) WHERE clave IS NOT NULL AND trim(clave) <> ''
    ON CONFLICT(clave) DO NOTHING`).run(ahora, CEDIS, desdeDia).changes;
}

module.exports = { VERSION, artIdsDelLote, marcarPendientes, procesarPendientes, vueltaCompleta, vencerPosposiciones };
