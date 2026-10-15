const { randomUUID } = require('node:crypto');
const { setTimeout: esperarReal } = require('node:timers/promises');
const { guardar } = require('./estado');
const { id, esHorarioHistorico } = require('./formato');
const DESTINO = 'https://punto-de-venta-backend.onrender.com/api/integraciones/sicar/v1/lotes';
async function enviarPendiente(archivo, estado, config, deps = {}) {
  const { fetch = globalThis.fetch, esperar = esperarReal, reloj = Date.now, intentos = 3, log = () => {} } = deps;
  if (estado.detenido) throw new Error(estado.detenido);
  for (let intento = 0; estado.pendiente && intento < intentos; intento++) {
    // También se conserva el ritmo entre procesos y entre reinicios.
    if (estado.ultimo_envio !== null) await esperar(Math.max(0, estado.ultimo_envio + 6000 - reloj()));
    if (JSON.parse(estado.pendiente.bytes).mode === 'historico' && !esHorarioHistorico(new Date(reloj()))) {
      log('FUERA_DE_HORARIO');
      return false;
    }
    estado.ultimo_envio = reloj();
    await guardar(archivo, estado);
    let res, datos;
    try {
      res = await fetch(DESTINO, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
        headers: { Authorization: `Bearer ${config.llave}`, 'Content-Type': 'application/json' }, body: estado.pendiente.bytes });
    } catch {
      log('RED_NO_DISPONIBLE');
      if (intento + 1 < intentos) await esperar([5000, 15000, 30000][intento]);
      continue;
    }
    try { datos = await res.json(); } catch { datos = {}; }
    if (res.status === 200 && !datos.next_sequence) {
      log('RED_NO_DISPONIBLE');
      continue;
    }
    if (res.status === 200) {
      const siguiente = id(datos.next_sequence);
      if (BigInt(siguiente) !== BigInt(JSON.parse(estado.pendiente.bytes).sequence) + 1n) {
        estado.detenido = 'HTTP_INESPERADO';
        await guardar(archivo, estado);
        throw new Error(estado.detenido);
      }
      Object.assign(estado, estado.pendiente.cambios, { siguiente_secuencia: siguiente, pendiente: null });
      await guardar(archivo, estado);
      log('LOTE_CONFIRMADO');
      return true;
    }
    if (res.status === 409 && datos.codigo === 'SECUENCIA_INCORRECTA') {
      const lote = JSON.parse(estado.pendiente.bytes);
      lote.sequence = id(datos.siguiente_secuencia);
      lote.batch_id = randomUUID();
      estado.pendiente.bytes = JSON.stringify(lote);
      await guardar(archivo, estado);
      continue;
    }
    if ([429, 503].includes(res.status)) {
      log(`HTTP_${res.status}`);
      if (intento + 1 < intentos) await esperar(res.status === 429 ? 60000 : 15000);
      continue;
    }
    estado.detenido = [400, 401, 409, 413, 422].includes(res.status) ? `HTTP_${res.status}` : 'HTTP_INESPERADO';
    await guardar(archivo, estado);
    log(estado.detenido);
    throw new Error(estado.detenido);
  }
  return !estado.pendiente;
}
module.exports = { enviarPendiente };
