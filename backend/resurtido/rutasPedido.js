// Rutas del pedido al proveedor (Entrega 2). Usan el mismo `ruta` de rutas.js: login, permiso propio y alcance de tienda
// solo del token. Nada de aquí manda algo al proveedor ni escribe en SICAR.
const { TIENDAS, cambiarConfig } = require('./config');
const pedido = require('./pedido');
const { listarEmpaques, confirmarEmpaque, quitarEmpaque } = require('./empaques');
const { listarAvisos, decidirAviso } = require('./avisos');
const error = (status, mensaje) => Object.assign(new Error(mensaje), { status });

function registrarRutasPedido(ruta, nombre) {
  const global = fn => (db, req, suc) => {
    if (suc !== null) throw error(403, 'Esta acción requiere ver todas las tiendas.');
    return fn(db, req);
  };
  const actor = req => String(req.usuarioToken.id);
  // Tienda sobre la que actúa quien da visto bueno: la del token; quien ve todas debe decir cuál en el cuerpo.
  function tienda(req, suc) {
    if (suc !== null) return suc;
    const id = Number(req.body?.sucursal_id);
    if (!TIENDAS.includes(id)) throw error(400, 'Indica la tienda.');
    return id;
  }
  const conNombres = detalle => {
    for (const r of detalle.renglones) r.nombre_visto_bueno = r.visto_bueno_por ? nombre(r.visto_bueno_por) : null;
    for (const h of detalle.historial) h.nombre_actor = nombre(h.actor);
    for (const campo of ['creado_por', 'aprobado_por', 'enviado_por', 'compra_confirmada_por']) {
      if (detalle.pedido[campo]) detalle.pedido[`nombre_${campo}`] = nombre(detalle.pedido[campo]);
    }
    return detalle;
  };

  ruta('get', '/api/resurtido/pedidos', 'ver_resurtido', (db, req, suc) =>
    pedido.listarPedidos(db, { marca: req.query.marca || null, sucursal_id: suc }));
  ruta('post', '/api/resurtido/pedidos', 'aprobar_pedido_resurtido', global((db, req) =>
    pedido.armarBorrador(db, req.body?.marca, new Date().toISOString(), { actor: actor(req), manual: true })));
  // Tras restaurar un respaldo los pedidos quedan pausados; solo quien aprueba los reactiva.
  ruta('post', '/api/resurtido/pedidos/reactivar', 'aprobar_pedido_resurtido', global((db, req) => {
    cambiarConfig(db, { pedidos_pausados: 0 }, actor(req));
    return { ok: true };
  }));
  ruta('get', '/api/resurtido/pedidos/:id', 'ver_resurtido', (db, req, suc) => conNombres(pedido.verPedido(db, req.params.id, suc)));
  ruta('get', '/api/resurtido/pedidos/:id/reparto', 'ver_resurtido', (db, req, suc) =>
    ({ tiendas: pedido.hojaReparto(db, req.params.id, suc) }));
  ruta('get', '/api/resurtido/pedidos/:id/proveedor', 'aprobar_pedido_resurtido', global((db, req) => pedido.listaProveedor(db, req.params.id)));
  ruta('put', '/api/resurtido/pedidos/:id/tienda', 'dar_visto_bueno_resurtido', (db, req, suc) =>
    pedido.cambiarRenglones(db, req.params.id, tienda(req, suc), req.body?.cambios, actor(req)));
  ruta('post', '/api/resurtido/pedidos/:id/visto-bueno', 'dar_visto_bueno_resurtido', (db, req, suc) =>
    pedido.vistoBuenoTienda(db, req.params.id, tienda(req, suc), req.body?.cambios ?? [], actor(req)));
  ruta('post', '/api/resurtido/pedidos/:id/aprobar', 'aprobar_pedido_resurtido', global((db, req) => pedido.aprobar(db, req.params.id, actor(req))));
  ruta('post', '/api/resurtido/pedidos/:id/envio', 'aprobar_pedido_resurtido', global((db, req) =>
    pedido.registrarEnvio(db, req.params.id, req.body, actor(req))));
  // La compra de CEDIS solo se propone; una persona con permiso de aprobar la confirma.
  ruta('get', '/api/resurtido/pedidos/:id/compras', 'aprobar_pedido_resurtido', global((db, req) => pedido.candidatasCompra(db, req.params.id)));
  ruta('post', '/api/resurtido/pedidos/:id/compra', 'aprobar_pedido_resurtido', global((db, req) =>
    pedido.confirmarCompra(db, req.params.id, req.body?.com_id, actor(req))));

  // Avisos entre pedidos: cada tienda ve y decide solo los suyos (alcance del token).
  ruta('get', '/api/resurtido/avisos', 'ver_resurtido', (db, req, suc) => {
    const filtro = suc ?? (req.query.sucursal_id && req.query.sucursal_id !== 'todas' ? Number(req.query.sucursal_id) : null);
    const r = listarAvisos(db, filtro);
    for (const a of r.avisos) if (a.actor) a.nombre_actor = nombre(a.actor);
    return r;
  });
  ruta('post', '/api/resurtido/avisos/:id/decision', 'dar_visto_bueno_resurtido', (db, req, suc) =>
    decidirAviso(db, req.params.id, req.body, actor(req), suc));

  // Empaques: los ve quien ve resurtido; los cambia configurar_resurtido de toda la empresa (son por clave, no por tienda).
  ruta('get', '/api/resurtido/empaques', 'ver_resurtido', db => {
    const r = listarEmpaques(db);
    for (const c of r.claves) if (c.confirmado) c.confirmado.nombre_por = nombre(c.confirmado.por);
    for (const h of r.historial) h.nombre_actor = nombre(h.actor);
    return r;
  });
  ruta('put', '/api/resurtido/empaques', 'configurar_resurtido', (db, req) => confirmarEmpaque(db, req.body, actor(req)), { conTienda: false });
  ruta('delete', '/api/resurtido/empaques', 'configurar_resurtido', (db, req) => quitarEmpaque(db, req.body, actor(req)), { conTienda: false });
}

module.exports = { registrarRutasPedido };
