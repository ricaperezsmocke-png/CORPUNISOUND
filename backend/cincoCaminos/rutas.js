/**
 * Rutas del tablero de los cinco caminos (spec 2026-10-24, secciones 4.1 y 7).
 *
 * Alcance (regla 5 de CLAUDE.md): sale solo de quien pregunta. Sin `ver_todas_las_sucursales` siempre se ve la tienda
 * del token, diga lo que diga `?sucursal_id=` (que `src/api.js` inyecta desde el selector del encabezado).
 */
const { tableroTienda, TIPOS } = require('./tablero');
const { semanaDe, ultimaSemanaCompleta } = require('./semanas');
const { fechaLocal } = require('../fechas');
const { vistaManual, crearTactica, cambiarTactica, retirarTactica, reactivarTactica, historialDe } = require('./manual');

const {
  crearCompromiso, marcarHecho, cancelarCompromiso, marcarJunta, vista: vistaJunta, lunesValido,
} = require('./juntas');

// Texto fijo del manual v1 (seccion "Excluidas a proposito"); no son tacticas y no se siembran.
const EXCLUIDAS_TEXTO = '2x1, 4x3 y descuentos como táctica (comen margen); deshacerse de clientes C/D o atender solo clientes A '
  + '(en pueblo, el que hoy compra cuerdas mañana compra el bafle); subir precios contra MercadoLibre; comprar, rentar o vender bases '
  + 'de datos (ilegal por la ley de protección de datos); subir niveles de crédito; equipos solo a comisión; no pagar tiempo extra; '
  + 'publicidad cara (TV, cine, dirigibles), libro, multinivel.';

const MAX_TEXTO = 100;
const MAX_REGLAS = 500;
const CONTROL = /[\u0000-\u001f\u007f]/;
const SQL_DISPONIBLES = `SELECT departamento, categoria, COUNT(*) AS articulos FROM sicar_articulos
  WHERE departamento IS NOT NULL AND TRIM(departamento) <> ''
  GROUP BY departamento, categoria ORDER BY departamento, categoria`;

function textoValido(valor) {
  return typeof valor === 'string' && valor.trim() !== '' && valor.length <= MAX_TEXTO && !CONTROL.test(valor);
}

// Lista de lo permitido: cualquier otra forma se rechaza entera y no cambia nada.
function validarCategorias(body) {
  const lista = body && typeof body === 'object' && !Array.isArray(body) ? body.categorias : undefined;
  if (!Array.isArray(lista) || lista.length > MAX_REGLAS) return null;
  const vistas = new Set();
  const limpias = [];
  for (const r of lista) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
    if (Object.keys(r).some(k => !['departamento', 'categoria', 'tipo'].includes(k))) return null;
    const categoria = r.categoria === undefined ? null : r.categoria;
    if (!textoValido(r.departamento) || (categoria !== null && !textoValido(categoria)) || !TIPOS.has(r.tipo)) return null;
    const llave = JSON.stringify([r.departamento, categoria]);
    if (vistas.has(llave)) return null;
    vistas.add(llave);
    limpias.push({ departamento: r.departamento, categoria, tipo: r.tipo });
  }
  return limpias;
}

function registrarRutasCincoCaminos(app, deps) {
  const { DB, sqlite, requiereLogin, requierePermiso, resolverPermisosDeRol, resolverAlcanceAutorizado, tiendas } = deps;
  const capturarError = deps.capturarError || (() => {});
  const permiso = clave => [requiereLogin, requierePermiso(clave, resolverPermisosDeRol)];
  const config = () => {
    if (!DB.pos.cinco_caminos || typeof DB.pos.cinco_caminos !== 'object') DB.pos.cinco_caminos = { categorias: [] };
    if (!Array.isArray(DB.pos.cinco_caminos.categorias)) DB.pos.cinco_caminos.categorias = [];
    return DB.pos.cinco_caminos;
  };
  const ejecutar = (ruta, fn) => (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      return fn(req, res);
    } catch (e) {
      if (!e.status) {
        console.error(`Error inesperado en ${ruta}:`, e && e.message ? e.message : e);
        try { capturarError(e); } catch { /* Sentry no debe tumbar la respuesta */ }
      }
      return res.status(e.status || 500).json({ error: e.status ? e.message : 'No se pudo calcular el tablero.' });
    }
  };
  const conexion = res => {
    const c = sqlite();
    if (!c) res.status(503).json({ error: 'La integración SICAR no está disponible.' });
    return c;
  };

  app.get('/api/cinco-caminos/tablero', ...permiso('ver_cinco_caminos'), ejecutar('/api/cinco-caminos/tablero', (req, res) => {
    const alcance = resolverAlcanceAutorizado(req);
    let sucursalId = alcance.sucursalId;
    if (alcance.verTodas) {
      const pedida = req.query.sucursal_id;
      sucursalId = pedida === undefined || pedida === '' ? Number(req.usuarioToken.sucursal_id) : Number(pedida);
    }
    if (!Number.isSafeInteger(sucursalId) || sucursalId <= 0) {
      return res.status(alcance.verTodas ? 400 : 403).json({ error: 'No hay una tienda autorizada para el tablero.' });
    }
    if (!tiendas().some(t => Number(t.id) === sucursalId)) return res.status(404).json({ error: 'La tienda no existe.' });
    const semana = req.query.semana;
    const lunes = semana === undefined || semana === '' ? ultimaSemanaCompleta(fechaLocal()) : semanaDe(String(semana)).lunes;
    const c = conexion(res);
    if (!c) return;
    res.json(tableroTienda(c, DB, { sucursal_id: sucursalId, lunes }));
  }));

  app.get('/api/cinco-caminos/categorias', ...permiso('ver_cinco_caminos'), ejecutar('/api/cinco-caminos/categorias', (req, res) => {
    res.json({ categorias: config().categorias });
  }));

  app.get('/api/cinco-caminos/categorias/disponibles', ...permiso('ver_cinco_caminos'), ejecutar('/api/cinco-caminos/categorias/disponibles', (req, res) => {
    const c = conexion(res);
    if (!c) return;
    res.json({ disponibles: c.prepare(SQL_DISPONIBLES).all() });
  }));

  // Cambiar qué es instrumento y qué es accesorio mueve un número del tablero: queda quién y cuándo.
  app.put('/api/cinco-caminos/categorias', ...permiso('administrar_manual_tacticas'), ejecutar('/api/cinco-caminos/categorias', (req, res) => {
    const categorias = validarCategorias(req.body);
    if (!categorias) {
      return res.status(400).json({ error: 'Cada regla lleva departamento (texto de hasta 100), categoría (texto o vacía) '
        + 'y tipo instrumento o accesorio, sin repetirse.' });
    }
    const cfg = config();
    cfg.categorias = categorias;
    if (!Array.isArray(cfg.categorias_historial)) cfg.categorias_historial = [];
    cfg.categorias_historial.push({ fecha_hora: new Date().toISOString(), usuario_id: Number(req.usuarioToken.id),
      categorias: categorias.map(r => ({ ...r })) });
    res.json({ categorias });
  }));

  // Manual de tácticas. Quién escribe y qué tienda se ve salen SIEMPRE del token. La etiqueta no tiene ruta de escritura.
  const alcanceManual = req => {
    const a = resolverAlcanceAutorizado(req);
    return { verTodas: a.verTodas, sucursalId: Number(req.usuarioToken.sucursal_id) };
  };
  const usuarioDelToken = req => Number(req.usuarioToken.id);
  const vistaDe = (req, id) => vistaManual(DB, alcanceManual(req)).find(t => t.id === id);
  const idDeRuta = req => req.params.id;
  // El nombre se arma al leer, nunca se guarda: quien ya no existe queda señalado, y null es "el sistema".
  const nombreDeUsuario = usuarioId => {
    if (usuarioId === null || usuarioId === undefined) return null;
    const u = (DB.admin?.usuarios || []).find(x => Number(x.id) === Number(usuarioId));
    return u && u.nombre ? u.nombre : `Usuario #${usuarioId} (ya no existe)`;
  };

  app.get('/api/cinco-caminos/manual', ...permiso('ver_cinco_caminos'), ejecutar('/api/cinco-caminos/manual', (req, res) => {
    res.json({ tacticas: vistaManual(DB, alcanceManual(req)), excluidas_texto: EXCLUIDAS_TEXTO });
  }));

  app.post('/api/cinco-caminos/manual', ...permiso('administrar_manual_tacticas'), ejecutar('/api/cinco-caminos/manual', (req, res) => {
    const t = crearTactica(DB, req.body, usuarioDelToken(req));
    res.status(201).json({ tactica: vistaDe(req, t.id) });
  }));

  app.put('/api/cinco-caminos/manual/:id', ...permiso('administrar_manual_tacticas'), ejecutar('/api/cinco-caminos/manual/:id', (req, res) => {
    const t = cambiarTactica(DB, idDeRuta(req), req.body, usuarioDelToken(req));
    res.json({ tactica: vistaDe(req, t.id) });
  }));

  app.post('/api/cinco-caminos/manual/:id/retirar', ...permiso('administrar_manual_tacticas'),
    ejecutar('/api/cinco-caminos/manual/:id/retirar', (req, res) => {
      const motivo = req.body && typeof req.body === 'object' ? req.body.motivo : undefined;
      const t = retirarTactica(DB, idDeRuta(req), motivo, usuarioDelToken(req));
      res.json({ tactica: vistaDe(req, t.id) });
    }));

  app.post('/api/cinco-caminos/manual/:id/reactivar', ...permiso('administrar_manual_tacticas'),
    ejecutar('/api/cinco-caminos/manual/:id/reactivar', (req, res) => {
      const t = reactivarTactica(DB, idDeRuta(req), usuarioDelToken(req));
      res.json({ tactica: vistaDe(req, t.id) });
    }));

  // Sin "ver todas", las entradas de etiqueta de otras tiendas no se muestran: revelarían qué probó cada una.
  app.get('/api/cinco-caminos/manual/:id/historial', ...permiso('ver_cinco_caminos'),
    ejecutar('/api/cinco-caminos/manual/:id/historial', (req, res) => {
      const { verTodas, sucursalId } = alcanceManual(req);
      const historial = historialDe(DB, idDeRuta(req))
        .filter(h => verTodas || h.accion !== 'etiqueta' || (h.despues && h.despues.sucursal_id === sucursalId))
        .map(h => ({ ...h, usuario_nombre: nombreDeUsuario(h.usuario_id) }));
      res.json({ historial });
    }));

  // Junta del lunes. Escribir: la tienda y el usuario salen SIEMPRE del token (el cuerpo no elige tienda, y no hay ruta
  // para editar el texto de un compromiso). Leer: con "ver todas" el filtro elige tienda; sin él, solo la del token.
  const contextoJunta = req => ({
    usuarioId: usuarioDelToken(req), usuarioNombre: nombreDeUsuario(usuarioDelToken(req)),
    sucursalId: Number(req.usuarioToken.sucursal_id), hoy: fechaLocal(),
  });
  const SIN_TIENDA_JUNTA = 'No hay una tienda autorizada para la junta.';
  // Escribir exige la misma tienda válida del token que leer: sin ella no se guarda nada.
  const escribirJunta = (ruta, manejador) => ejecutar(ruta, (req, res) => {
    const ctx = contextoJunta(req);
    if (!Number.isSafeInteger(ctx.sucursalId) || ctx.sucursalId <= 0) return res.status(403).json({ error: SIN_TIENDA_JUNTA });
    return manejador(req, res, ctx);
  });
  const RUTA_JUNTA = '/api/cinco-caminos/junta';

  app.get(RUTA_JUNTA, ...permiso('ver_cinco_caminos'), ejecutar(RUTA_JUNTA, (req, res) => {
    const alcance = resolverAlcanceAutorizado(req);
    const ctx = contextoJunta(req);
    let sucursalId = ctx.sucursalId;
    if (alcance.verTodas && req.query.sucursal_id !== undefined && req.query.sucursal_id !== '') sucursalId = Number(req.query.sucursal_id);
    if (!Number.isSafeInteger(sucursalId) || sucursalId <= 0) return res.status(403).json({ error: SIN_TIENDA_JUNTA });
    const pedido = req.query.lunes;
    const lunes = pedido === undefined || pedido === '' ? semanaDe(ctx.hoy).lunes : lunesValido(String(pedido), ctx.hoy);
    res.json(vistaJunta(DB, sucursalId, lunes, ctx.hoy));
  }));

  app.post(`${RUTA_JUNTA}/compromisos`, ...permiso('marcar_junta_cinco_caminos'), escribirJunta(`${RUTA_JUNTA}/compromisos`, (req, res, ctx) => {
    res.status(201).json({ compromiso: crearCompromiso(DB, req.body, ctx) });
  }));

  app.post(`${RUTA_JUNTA}/compromisos/:id/hecho`, ...permiso('marcar_junta_cinco_caminos'),
    escribirJunta(`${RUTA_JUNTA}/compromisos/:id/hecho`, (req, res, ctx) => {
      res.json({ compromiso: marcarHecho(DB, req.params.id, ctx) });
    }));

  app.post(`${RUTA_JUNTA}/compromisos/:id/cancelar`, ...permiso('marcar_junta_cinco_caminos'),
    escribirJunta(`${RUTA_JUNTA}/compromisos/:id/cancelar`, (req, res, ctx) => {
      const motivo = req.body && typeof req.body === 'object' ? req.body.motivo : undefined;
      res.json({ compromiso: cancelarCompromiso(DB, req.params.id, motivo, ctx) });
    }));

  app.post(`${RUTA_JUNTA}/hecha`, ...permiso('marcar_junta_cinco_caminos'), escribirJunta(`${RUTA_JUNTA}/hecha`, (req, res, ctx) => {
    const lunes = req.body && typeof req.body === 'object' ? req.body.lunes : undefined;
    res.json({ junta: marcarJunta(DB, lunes, ctx) });
  }));
}

module.exports = { registrarRutasCincoCaminos, validarCategorias };
