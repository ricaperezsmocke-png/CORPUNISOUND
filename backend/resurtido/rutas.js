const { TIENDAS, VALORES_INICIALES, leerConfig, cambiarConfig } = require('./config');
const { listar, listaProveedor, ponerAjuste, quitarAjuste } = require('./consultas');
const { explicar } = require('./explicacion');
const { registrarRutasPedido } = require('./rutasPedido');
const error = (status, mensaje) => Object.assign(new Error(mensaje), { status });

function registrarRutasResurtido(app, { sqlite, requiereLogin, requierePermiso, resolverPermisosDeRol,
  resolverAlcanceAutorizado, nombreDeUsuario = () => null }) {
  const conexion = () => typeof sqlite === 'function' ? sqlite() : sqlite;
  function alcance(req) {
    const autorizado = resolverAlcanceAutorizado(req);
    const propia = Number(autorizado.sucursalId);
    if (!autorizado.verTodas && !TIENDAS.includes(propia)) throw error(403, 'Tu sesión no tiene una tienda autorizada.');
    for (const origen of [req.query, req.body]) {
      if (!origen || !Object.hasOwn(origen, 'sucursal_id')) continue;
      const valor = origen.sucursal_id;
      if (valor === 'todas' && autorizado.verTodas) continue;
      const id = Number(valor);
      if (!autorizado.verTodas && id !== propia) throw error(403, 'No puedes consultar ni corregir otra tienda.');
      if (!TIENDAS.includes(id)) throw error(400, 'Tienda inválida.');
    }
    return autorizado.verTodas ? null : propia;
  }
  function ruta(metodo, url, permiso, ejecutar, { conTienda = true } = {}) {
    app[metodo](url, requiereLogin, requierePermiso(permiso, resolverPermisosDeRol), (req, res) => {
      try {
        // La configuración es de toda la empresa: el filtro de tienda del encabezado no aplica (regla 5).
        if (!conTienda && !resolverAlcanceAutorizado(req).verTodas) throw error(403, 'La configuración es de toda la empresa.');
        const suc = conTienda ? alcance(req) : null, db = conexion();
        if (!db) throw error(503, 'Integración SICAR no disponible.');
        res.set('Cache-Control', 'no-store');
        res.json(ejecutar(db, req, suc));
      } catch (e) { res.status(e.status || 500).json({ error: e.status ? e.message : 'No se pudo procesar el resurtido.' }); }
    });
  }
  ruta('get', '/api/resurtido', 'ver_resurtido', (db, req, suc) => {
    const resultado = listar(db, { ...req.query,
      sucursal_id: suc ?? (req.query.sucursal_id === 'todas' ? undefined : req.query.sucursal_id) });
    for (const fila of resultado.filas) if (fila.ajuste) {
      fila.ajuste.nombre_actor = nombreDeUsuario(fila.ajuste.actor) || `usuario #${fila.ajuste.actor}`;
    }
    return resultado;
  });
  // Solo lectura: arma la lista para copiar; nada se guarda ni se manda al proveedor.
  ruta('get', '/api/resurtido/sugerido', 'ver_resurtido', (db, req, suc) => listaProveedor(db, { marca: req.query.marca,
    sucursal_id: suc ?? (req.query.sucursal_id === 'todas' ? undefined : req.query.sucursal_id) }));
  ruta('get', '/api/resurtido/explicacion', 'ver_resurtido', (db, req, suc) =>
    explicar(db, suc ?? req.query.sucursal_id, req.query.clave));
  for (const [metodo, accion] of [['put', ponerAjuste], ['delete', quitarAjuste]]) {
    ruta(metodo, '/api/resurtido/ajuste', 'corregir_minimos_resurtido', (db, req, suc) =>
      accion(db, { ...req.body, sucursal_id: suc ?? req.body?.sucursal_id }, String(req.usuarioToken.id)));
  }
  const verConfig = db => ({ valores: leerConfig(db), iniciales: VALORES_INICIALES,
    historial: db.prepare('SELECT * FROM resurtido_config_historial ORDER BY id DESC LIMIT 200').all() });
  ruta('get', '/api/resurtido/config', 'configurar_resurtido', db => verConfig(db), { conTienda: false });
  ruta('put', '/api/resurtido/config', 'configurar_resurtido', (db, req) => {
    // La pausa de pedidos la quita solo quien aprueba pedidos (POST /api/resurtido/pedidos/reactivar).
    if (req.body && typeof req.body === 'object' && Object.hasOwn(req.body, 'pedidos_pausados')) {
      throw error(403, 'Reactivar los pedidos le toca a quien los aprueba.');
    }
    cambiarConfig(db, req.body, String(req.usuarioToken.id));
    return verConfig(db);
  }, { conTienda: false });
  registrarRutasPedido(ruta, id => nombreDeUsuario(id) || `usuario #${id}`);
}

module.exports = { registrarRutasResurtido };
