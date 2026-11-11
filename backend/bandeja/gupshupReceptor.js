const { createHash, timingSafeEqual } = require('node:crypto');

const MAX_CUERPO = 1572864;
const MAX_SERIALIZADO = 1900000;
const MAX_PENDIENTES = 209715200;
const sha256 = valor => createHash('sha256').update(valor).digest();

function tipoDeEvento(texto) {
  let evento;
  try { evento = JSON.parse(texto); } catch { return 'no_json'; }
  let tipo;
  if (Array.isArray(evento?.entry)) {
    const campos = evento.entry.flatMap(e => Array.isArray(e?.changes) ? e.changes : [])
      .map(c => c?.field).filter(c => typeof c === 'string' && c);
    tipo = [...new Set(campos)].sort().join(',');
  } else if (typeof evento?.type === 'string') tipo = evento.type;
  return (tipo || 'desconocido').slice(0, 200);
}

function registrarReceptorGupshup(app, {
  sqlite, disponible, mantenimiento, token, ahora = () => new Date(), avisar = m => console.warn(m),
  maxPendientes = MAX_PENDIENTES, limitePorMinuto = 600,
}) {
  const habilitado = typeof token === 'string' && token.length >= 32;
  const secreto = habilitado ? sha256(token) : null;
  const rechazos = { 401: 0, 429: 0, 413: 0 };
  let minutoActual, peticiones = 0, ultimoAvisoTope;

  function atender(req, res) {
    const responder = codigo => {
      if (Object.hasOwn(rechazos, codigo)) rechazos[codigo] += 1;
      if (!res.writableEnded && !res.destroyed) res.status(codigo).end();
    };
    const fallo = () => {
      avisar('Gupshup: no se pudo guardar el evento.');
      responder(503);
    };
    try {
      if (!habilitado) return responder(404);
      if (!timingSafeEqual(sha256(req.params.token), secreto)) return responder(401);
      const minuto = Math.floor(ahora().getTime() / 60000);
      if (minuto !== minutoActual) { minutoActual = minuto; peticiones = 0; }
      peticiones += 1;
      if (peticiones > limitePorMinuto) return responder(429);
      if (!disponible() || mantenimiento.estaActivo()) return responder(503);
      if (req.method === 'GET' || req.method === 'HEAD') return responder(200);

      let partes = [], bytes = 0, terminado = false;
      req.on('aborted', () => { terminado = true; partes = []; });
      req.on('error', () => { terminado = true; partes = []; responder(503); });
      req.on('data', parte => {
        if (terminado) return;
        bytes += parte.length;
        if (bytes > MAX_CUERPO) {
          terminado = true;
          partes = [];
          avisar('Gupshup: evento rechazado por tamano.');
          responder(413);
          return;
        }
        partes.push(parte);
      });
      req.on('end', () => {
        if (terminado || req.aborted) return;
        terminado = true;
        try {
          const cuerpo = Buffer.concat(partes);
          partes = [];
          const texto = cuerpo.toString('utf8');
          if (Buffer.byteLength(JSON.stringify(texto)) > MAX_SERIALIZADO) {
            avisar('Gupshup: evento rechazado por tamano serializado.');
            return responder(413);
          }
          if (!disponible() || mantenimiento.estaActivo()) return responder(503);
          const { pendientes } = sqlite.prepare(`SELECT coalesce(sum(length(payload_json)), 0) AS pendientes
            FROM lead_eventos_externos WHERE proveedor = 'gupshup' AND procesado_en IS NULL`).get();
          if (pendientes > maxPendientes) {
            const minutoTope = Math.floor(ahora().getTime() / 60000);
            if (ultimoAvisoTope !== minutoTope) {
              ultimoAvisoTope = minutoTope;
              avisar('Gupshup: se alcanzo el tope de eventos pendientes.');
            }
            return responder(503);
          }
          sqlite.prepare(`INSERT INTO lead_eventos_externos
            (proveedor, identificador_evento_externo, tipo, recibido_en, payload_json)
            VALUES ('gupshup', ?, ?, ?, ?)
            ON CONFLICT(proveedor, identificador_evento_externo) DO NOTHING`)
            .run('sha256:' + sha256(cuerpo).toString('hex'), tipoDeEvento(texto), ahora().toISOString(), texto);
          responder(200);
        } catch { fallo(); }
      });
    } catch { fallo(); }
  }

  app.get('/api/integraciones/gupshup/:token', atender);
  app.post('/api/integraciones/gupshup/:token', atender);
}

module.exports = { registrarReceptorGupshup, tipoDeEvento, MAX_CUERPO, MAX_SERIALIZADO, MAX_PENDIENTES };
