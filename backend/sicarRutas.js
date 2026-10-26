const { TextDecoder } = require('node:util');
const {
  validarLoteSicar, validarSobreSicar, crearLlaveSicar, autenticarLlaveSicar, crearControlSicar, hashSicar, UUID,
} = require('./sicarIngesta');

const LIMITE = 1024 * 1024;
const { listarVinculosSicar, resolverDecisionSicar } = require('./sicarVinculos');

// Se monta ANTES del parser global y de la persistencia del JSON. Nunca recibe DB.
function registrarAgenteSicar(app, { repo, mantenimiento }) {
  const control = crearControlSicar();
  app.use('/api/integraciones/sicar', (req, res) => {
    const inicio = Date.now();
    let llave = null, batchId = null, recibidos = null, bytes = 0, terminado = false, ocupada = false;
    const liberar = () => {
      if (ocupada) control.liberar(llave.sucursal_id);
      ocupada = false;
    };
    const responder = (status, datos, enviar = true) => {
      if (terminado) return;
      terminado = true;
      liberar();
      try {
        repo.registrarIntento({
          sucursal_id: llave?.sucursal_id ?? null, key_id: llave?.key_id ?? null, batch_id: batchId,
          recibidos, aceptados: status === 200 ? recibidos : recibidos === null ? null : 0,
          rechazados: status >= 400 ? recibidos : recibidos === null ? null : 0,
          bytes, codigo: String(status), hora: new Date().toISOString(), duracion_ms: Date.now() - inicio,
        });
      } catch {
        status = 503;
        datos = { codigo: 'AUDITORIA_NO_DISPONIBLE', error: 'No se pudo registrar el intento. Reintenta el mismo lote.' };
      }
      if (enviar && !res.destroyed) {
        res.set('Cache-Control', 'no-store');
        if (status === 429) res.set('Retry-After', '60');
        res.status(status).json(datos);
      }
    };
    const rechazar = (status, codigo, referencia) => responder(status, { codigo, error: 'Solicitud SICAR rechazada.',
      ...(referencia ? { referencia } : {}),
      ...(status === 422 ? { aceptados: 0, rechazados: recibidos } : {}) });
    const mantener = () => {
      if (!mantenimiento.estaActivo()) return false;
      rechazar(503, 'MANTENIMIENTO');
      return true;
    };
    try {
      const keyId = /^Bearer ([\da-f-]{36})\./i.exec(req.headers.authorization || '')?.[1];
      if (keyId && UUID.test(keyId)) llave = repo.obtenerLlave(keyId) ?? null;
      const autenticada = autenticarLlaveSicar(repo, req.headers.authorization);
      const identidadRitmo = autenticada ? `llave:${autenticada.key_id}` : `origen:${req.socket.remoteAddress}`;
      if (!control.admitir(identidadRitmo)) return rechazar(429, 'RITMO_EXCEDIDO');
      if (!autenticada) return rechazar(401, 'LLAVE_INVALIDA');
      llave = autenticada;
      if (mantener()) return;
      if (req.method === 'GET' && req.path === '/v1/estado') {
        return responder(200, { schema_version: 1, sucursal_id: llave.sucursal_id, ...repo.estado(llave.sucursal_id) });
      }
      if (req.method !== 'POST' || req.path !== '/v1/lotes') return rechazar(400, 'RUTA_NO_SOPORTADA');
      if (!control.ocupar(llave.sucursal_id)) return rechazar(429, 'TIENDA_OCUPADA');
      ocupada = true;
      if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') return rechazar(400, 'COMPRESION_NO_ADMITIDA');
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] || '')) return rechazar(400, 'JSON_REQUERIDO');
      const longitud = Number(req.headers['content-length']);
      if (Number.isSafeInteger(longitud) && longitud > LIMITE) {
        bytes = longitud;
        req.resume();
        return rechazar(413, 'CUERPO_EXCESIVO');
      }
      const partes = [];
      const temporizador = setTimeout(() => { req.resume(); rechazar(400, 'CUERPO_INCOMPLETO'); }, 30000);
      temporizador.unref();
      res.once('close', () => { clearTimeout(temporizador); liberar(); });
      req.once('aborted', () => responder(400, { codigo: 'CUERPO_INCOMPLETO' }, false));
      req.once('error', () => responder(400, { codigo: 'CUERPO_INCOMPLETO' }, false));
      req.on('data', parte => {
        if (terminado) return;
        bytes += parte.length;
        if (bytes > LIMITE) { partes.length = 0; rechazar(413, 'CUERPO_EXCESIVO'); return; }
        partes.push(parte);
      });
      req.once('end', () => {
        clearTimeout(temporizador);
        if (terminado) return;
        // Puede comenzar mantenimiento o revocarse la llave mientras llegan los bytes.
        if (mantener()) return;
        let body;
        const crudo = Buffer.concat(partes);
        try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(crudo)); }
        catch { return rechazar(400, 'JSON_INVALIDO'); }
        if (body && typeof body.batch_id === 'string' && UUID.test(body.batch_id)) batchId = body.batch_id;
        if (Array.isArray(body?.clientes) && Array.isArray(body?.ventas)) recibidos = body.clientes.length + body.ventas.length;
        try {
          if (!autenticarLlaveSicar(repo, req.headers.authorization)) return rechazar(401, 'LLAVE_INVALIDA');
          validarSobreSicar(body);
          const hash = hashSicar(crudo);
          const anterior = repo.reciboAnterior(llave.sucursal_id, body.batch_id, hash);
          if (anterior) return responder(200, anterior);
          const lote = validarLoteSicar(body);
          const recibo = repo.aplicarLote({ sucursalId: llave.sucursal_id, lote, hash });
          responder(200, recibo);
        } catch (e) {
          if (e.codigo === 'CONFLICTO_BATCH' || e.codigo === 'SECUENCIA_INCORRECTA') {
            return responder(409, { codigo: e.codigo, siguiente_secuencia: repo.estado(llave.sucursal_id).siguiente_secuencia });
          }
          if (e.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') return rechazar(422, 'REFERENCIA_CLIENTE_INVALIDA');
          if (e.status) return rechazar(e.status, e.codigo, e.referencia);
          return rechazar(503, 'TRANSACCION_NO_DISPONIBLE');
        }
      });
    } catch { rechazar(503, 'SERVICIO_NO_DISPONIBLE'); }
  });
}

function registrarRutasSicar(app, opciones) {
  const { repo, requiereLogin, requierePermiso, resolverPermisos, resolverAlcanceAutorizado, tiendas, mantenimiento,
    esAdministrador = () => false, usuarios = () => [] } = opciones;
  const permiso = clave => [requiereLogin, requierePermiso(clave, resolverPermisos)];
  const visible = (alcance, sucursalId) => alcance.verTodas || alcance.sucursalId === Number(sucursalId);
  const tiendasVisibles = alcance => tiendas().filter(t => visible(alcance, t.id)).map(t => ({ id: t.id, nombre: t.nombre }));
  const ejecutar = fn => (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD' && mantenimiento.estaActivo()) return res.status(503).json({ codigo: 'MANTENIMIENTO' });
      return fn(req, res, resolverAlcanceAutorizado(req));
    } catch (e) {
      return res.status(e.status || 503).json({ error: e.status ? e.message : 'No se pudo completar la operación SICAR.' });
    }
  };
  const actor = req => ({ id: req.usuarioToken.id, administrador: esAdministrador(req.usuarioToken) });
  app.get('/api/sicar/vinculos', ...permiso('resolver_vinculos_sicar'), ejecutar((req, res, alcance) => {
    res.json(listarVinculosSicar(repo, alcance, actor(req), Number(req.query.cursor ?? 0)));
  }));
  app.post('/api/sicar/vinculos/:sucursal/:cliId/resolver', ...permiso('resolver_vinculos_sicar'), ejecutar((req, res, alcance) => {
    const identidad = { sucursal_id: req.params.sucursal, cli_id: req.params.cliId };
    res.json(resolverDecisionSicar(repo, identidad, req.body, actor(req), alcance));
  }));
  app.get('/api/sicar/llaves', ...permiso('administrar_llaves_sicar'), ejecutar((req, res, alcance) => {
    res.json({ tiendas: tiendasVisibles(alcance), llaves: repo.listarLlaves().filter(k => visible(alcance, k.sucursal_id)) });
  }));
  app.post('/api/sicar/llaves', ...permiso('administrar_llaves_sicar'), ejecutar((req, res, alcance) => {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => k !== 'sucursal_id')) {
      return res.status(400).json({ error: 'Indica únicamente la tienda.' });
    }
    const sucursalId = Number(body.sucursal_id);
    if (!['number', 'string'].includes(typeof body.sucursal_id) || !Number.isSafeInteger(sucursalId) || sucursalId <= 0) {
      return res.status(400).json({ error: 'La tienda es inválida.' });
    }
    if (!visible(alcance, sucursalId)) return res.status(403).json({ error: 'Tienda fuera de tu alcance.' });
    if (!tiendas().some(t => Number(t.id) === sucursalId)) return res.status(400).json({ error: 'La tienda no existe.' });
    res.status(201).json(crearLlaveSicar(repo, sucursalId, req.usuarioToken.id));
  }));
  app.post('/api/sicar/llaves/:id/revocar', ...permiso('administrar_llaves_sicar'), ejecutar((req, res, alcance) => {
    const llave = repo.obtenerLlave(req.params.id);
    if (!llave || !visible(alcance, llave.sucursal_id)) return res.status(404).json({ error: 'Llave no encontrada.' });
    repo.revocarLlave(llave.key_id);
    res.json({ revocada: true });
  }));
  app.get('/api/sicar/envios', ...permiso('ver_sincronizacion_sicar'), ejecutar((req, res, alcance) => {
    // El selector no participa en la autorización ni cambia la tienda de un token local.
    if (!alcance.verTodas && (!Number.isSafeInteger(alcance.sucursalId) || alcance.sucursalId <= 0)) {
      return res.status(403).json({ error: 'No tienes una tienda autorizada.' });
    }
    const sucursalId = alcance.verTodas ? null : alcance.sucursalId;
    res.json({ tiendas: tiendasVisibles(alcance), envios: repo.listarEnvios(sucursalId), intentos: repo.listarIntentos(sucursalId) });
  }));
  // Quien tiene el permiso ve todas las tiendas con agente: el alcance NO sale de ?sucursal_id= ni del encabezado.
  app.get('/api/sicar/existencias', ...permiso('ver_existencias_sicar'), ejecutar((req, res) => {
    const nombres = Object.fromEntries(tiendas().map(t => [t.id, t.nombre]));
    const { q, solo, pagina } = req.query;
    res.json(repo.consultarExistencias({ q: String(q ?? ''), solo, pagina }, new Date(), nombres));
  }));
  // Traspasos SICAR: el alcance sale solo del token. El mapa es de toda la empresa: verlo con el permiso, cambiarlo con alcance total.
  const nombresTiendas = () => Object.fromEntries(tiendas().map(t => [t.id, t.nombre]));
  const traspasos = require('./sicarTraspasos');
  app.get('/api/sicar/traspasos', ...permiso('ver_traspasos_sicar'), ejecutar((req, res, alcance) => {
    const { desde, hasta, estado } = req.query;
    res.json(traspasos.consultarTraspasosSicar(repo.conexionParaVinculos(), { desde, hasta, estado }, alcance, nombresTiendas()));
  }));
  app.get('/api/sicar/sucursales-mapa', ...permiso('ver_traspasos_sicar'), ejecutar((req, res, alcance) => {
    res.json({ tiendas: tiendas().map(t => ({ id: t.id, nombre: t.nombre })),
      mapa: traspasos.listarMapaSicar(repo.conexionParaVinculos(), nombresTiendas()),
      sin_asignar: traspasos.listarSinAsignarSicar(repo.conexionParaVinculos(), alcance) });
  }));
  app.put('/api/sicar/sucursales-mapa', ...permiso('administrar_sucursales'), ejecutar((req, res, alcance) => {
    const existe = id => tiendas().some(t => Number(t.id) === id);
    res.json(traspasos.asignarMapaSicar(repo.conexionParaVinculos(), req.body, String(req.usuarioToken.id), alcance, existe));
  }));
  // Cortes SICAR: el alcance sale solo del token (ver todas o su tienda); ?sucursal_id= es un filtro que lo recorta.
  app.get('/api/sicar/cortes', ...permiso('ver_cortes_sicar'), ejecutar((req, res, alcance) => {
    const { desde, hasta, sucursal_id, caj_id, usu_id } = req.query;
    res.json(repo.consultarCortes({ desde, hasta, sucursal_id, caj_id, usu_id }, alcance));
  }));
  app.get('/api/sicar/personal', ...permiso('ver_cortes_sicar'), ejecutar((req, res, alcance) => {
    // El nombre de quien hizo cada cambio sale de la base principal de usuarios, como el de las tiendas.
    const nombres = new Map((usuarios() || []).map(u => [String(u.id), u.nombre]));
    res.json(repo.listarPersonal(alcance, id => nombres.get(String(id)) || null));
  }));
  // Ver los cortes no da para cambiar a quién se le atribuye una diferencia: permiso propio y historial.
  app.put('/api/sicar/personal/:sucursal_id/:usu_id', ...permiso('asignar_cajeros_sicar'), ejecutar((req, res, alcance) => {
    const datos = { sucursal_id: req.params.sucursal_id, usu_id: req.params.usu_id, nombre: req.body?.nombre };
    res.json(repo.asignarNombre(datos, String(req.usuarioToken.id), alcance));
  }));
}

module.exports = { registrarAgenteSicar, registrarRutasSicar };
