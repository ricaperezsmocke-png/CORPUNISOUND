const { crearResponsables } = require("./bandeja/responsable");
const { crearConsultasBandeja } = require("./bandeja/consultas");
const { CANALES } = require("./bandeja/mensajes");

/**
 * Rutas de la bandeja de clientes (spec 2026-10-18). Alcance de tienda siempre del token; fuera de alcance → 404.
 * Las operaciones ya guardan dentro de su transacción: se responde con send para no disparar otro guardado.
 */
function registrarRutasBandeja(app, { DB, bandeja, disponible, requiereLogin, requierePermiso, resolverPermisosDeRol, resolverAlcanceAutorizado }) {
  // Sin base para la bandeja, las rutas existen pero responden 503: nunca impiden que el resto del sistema arranque.
  const responsables = bandeja ? crearResponsables(bandeja) : null;
  const consultas = bandeja ? crearConsultasBandeja(bandeja) : null;
  const permiso = clave => requierePermiso(clave, resolverPermisosDeRol);

  function quien(req) {
    const permisos = resolverPermisosDeRol(req.usuarioToken.rol_id);
    const usuario = (DB.admin.usuarios || []).find(u => Number(u.id) === Number(req.usuarioToken.id));
    return { alcance: resolverAlcanceAutorizado(req), verTodasConversaciones: permisos.includes("ver_todas_conversaciones"),
      vendedorId: usuario?.vendedor_id != null ? Number(usuario.vendedor_id) : null, usuarioId: Number(req.usuarioToken.id) };
  }
  const noEncontrado = mensaje => Object.assign(new Error(mensaje), { status: 404 });
  function enAlcance(alcance, sucursalId, mensaje) {
    if (!alcance.verTodas && Number(sucursalId) !== Number(alcance.sucursalId)) throw noEncontrado(mensaje);
  }
  function clienteEnAlcance(req, clienteId) {
    const id = Number(clienteId);
    const cliente = (DB.crm.clientes || []).find(c => Number(c.id) === id && id > 0);
    if (!cliente) throw noEncontrado("Cliente no encontrado.");
    enAlcance(quien(req).alcance, cliente.sucursal_id, "Cliente no encontrado.");
    return cliente;
  }
  const ruta = fn => (req, res) => {
    if (!bandeja || !disponible()) return res.status(503).json({ error: "La bandeja no está disponible." });
    try { res.type("json").send(JSON.stringify(fn(req))); }
    catch (e) { res.status(e.status || 503).json({ error: e.status ? e.message : "No se pudo completar la operación de la bandeja." }); }
  };

  app.get("/api/mensajes/conversaciones", requiereLogin, permiso("ver_bandeja"),
    ruta(req => consultas.listar(quien(req), String(req.query.filtro || "mias"))));
  app.get("/api/mensajes/conversaciones/:id", requiereLogin, permiso("ver_bandeja"),
    ruta(req => consultas.ver(req.params.id, quien(req))));

  app.post("/api/mensajes/conversaciones/:id/mensajes", requiereLogin, permiso("responder_mensajes"), ruta(req => {
    const actor = quien(req);
    const c = consultas.ver(req.params.id, actor);
    const propia = c.responsable_id !== null && Number(c.responsable_id) === Number(actor.vendedorId);
    if (!actor.verTodasConversaciones && !propia && c.cliente_id !== null) {
      throw Object.assign(new Error("Toma la conversación antes de responder."), { status: 409 });
    }
    return bandeja.enviarSaliente(c.id, req.body?.texto, { usuario_id: actor.usuarioId });
  }));

  app.post("/api/mensajes/conversaciones/:id/tomar", requiereLogin, permiso("responder_mensajes"), ruta(req => {
    const actor = quien(req);
    const c = consultas.ver(req.params.id, actor);
    if (actor.vendedorId === null) throw Object.assign(new Error("Tu cuenta no está ligada a un vendedor."), { status: 400 });
    if (c.cliente_id === null) throw Object.assign(new Error("Primero identifica al cliente."), { status: 409 });
    return responsables.tomar(c.cliente_id, { vendedor_id: actor.vendedorId, usuario_id: actor.usuarioId });
  }));

  app.put("/api/mensajes/clientes/:id/responsable", requiereLogin, permiso("reasignar_conversaciones"), ruta(req => {
    const cliente = clienteEnAlcance(req, req.params.id);
    return responsables.reasignar(cliente.id, { vendedor_id: req.body?.vendedor_id, motivo: req.body?.motivo, usuario_id: quien(req).usuarioId });
  }));

  app.post("/api/mensajes/traspasos", requiereLogin, permiso("traspasar_cartera"), ruta(req => {
    const origen = (DB.pos.vendedores || []).find(v => Number(v.id) === Number(req.body?.de_vendedor_id));
    if (!origen) throw noEncontrado("Vendedor no encontrado.");
    enAlcance(quien(req).alcance, origen.sucursal_id, "Vendedor no encontrado.");
    return responsables.traspasarCartera({ ...req.body, usuario_id: quien(req).usuarioId });
  }));

  app.post("/api/mensajes/identidades/:id/ligar", requiereLogin, permiso("ligar_identidades"), ruta(req => {
    const actor = quien(req);
    const pendiente = bandeja.porIdentificar(actor.alcance).find(p => Number(p.identidad_id) === Number(req.params.id));
    if (!pendiente) throw noEncontrado("Contacto no encontrado.");
    const cliente = clienteEnAlcance(req, req.body?.cliente_id);
    return bandeja.ligarIdentidad(pendiente.identidad_id, cliente.id, { usuario_id: actor.usuarioId });
  }));

  app.get("/api/mensajes/clientes/:id/historial", requiereLogin, permiso("ver_bandeja"),
    ruta(req => consultas.historialCliente(clienteEnAlcance(req, req.params.id).id)));

  // Canal de prueba: solo fuera de producción. En producción la ruta ni existe.
  if (process.env.NODE_ENV !== "production") {
    app.post("/api/mensajes/simulado/entrante", requiereLogin, permiso("conectar_canales_mensajes"), ruta(req => {
      const { sucursal_id, canal = "whatsapp", remitente, texto } = req.body || {};
      if (!CANALES.includes(canal)) throw Object.assign(new Error("Canal no válido."), { status: 400 });
      enAlcance(quien(req).alcance, sucursal_id, "Tienda no encontrada.");
      const fuente = bandeja.registrarCanal({ canal, proveedor: "simulado", identificador_externo: `simulado-${canal}-${Number(sucursal_id)}`,
        nombre: `Prueba ${canal} tienda ${Number(sucursal_id)}`, sucursal_id: Number(sucursal_id) });
      return bandeja.recibirEntrante({ fuente_id: fuente.id, id_evento: `sim-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        remitente, texto, ocurrido_en: new Date().toISOString() });
    }));
  }
}

module.exports = { registrarRutasBandeja };
