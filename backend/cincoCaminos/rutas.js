/**
 * Rutas del tablero de los cinco caminos (spec 2026-10-24, secciones 4.1 y 7).
 *
 * Alcance (regla 5 de CLAUDE.md): sale solo de quien pregunta. Sin `ver_todas_las_sucursales` siempre se ve la tienda
 * del token, diga lo que diga `?sucursal_id=` (que `src/api.js` inyecta desde el selector del encabezado).
 */
const { tableroTienda, TIPOS } = require('./tablero');
const { semanaDe, ultimaSemanaCompleta } = require('./semanas');
const { fechaLocal } = require('../fechas');

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
  const permiso = clave => [requiereLogin, requierePermiso(clave, resolverPermisosDeRol)];
  const config = () => {
    if (!DB.pos.cinco_caminos || typeof DB.pos.cinco_caminos !== 'object') DB.pos.cinco_caminos = { categorias: [] };
    if (!Array.isArray(DB.pos.cinco_caminos.categorias)) DB.pos.cinco_caminos.categorias = [];
    return DB.pos.cinco_caminos;
  };
  const ejecutar = fn => (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      return fn(req, res);
    } catch (e) {
      return res.status(e.status || 500).json({ error: e.status ? e.message : 'No se pudo calcular el tablero.' });
    }
  };
  const conexion = res => {
    const c = sqlite();
    if (!c) res.status(503).json({ error: 'La integración SICAR no está disponible.' });
    return c;
  };

  app.get('/api/cinco-caminos/tablero', ...permiso('ver_cinco_caminos'), ejecutar((req, res) => {
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

  app.get('/api/cinco-caminos/categorias', ...permiso('ver_cinco_caminos'), ejecutar((req, res) => {
    res.json({ categorias: config().categorias });
  }));

  app.get('/api/cinco-caminos/categorias/disponibles', ...permiso('ver_cinco_caminos'), ejecutar((req, res) => {
    const c = conexion(res);
    if (!c) return;
    res.json({ disponibles: c.prepare(SQL_DISPONIBLES).all() });
  }));

  // Cambiar qué es instrumento y qué es accesorio mueve un número del tablero: queda quién y cuándo.
  app.put('/api/cinco-caminos/categorias', ...permiso('administrar_manual_tacticas'), ejecutar((req, res) => {
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
}

module.exports = { registrarRutasCincoCaminos, validarCategorias };
