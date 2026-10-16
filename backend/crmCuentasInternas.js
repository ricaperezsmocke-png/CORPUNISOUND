const error = (status, mensaje) => Object.assign(new Error(mensaje), { status });
const nombreUsuario = (DB, id) => (DB.admin?.usuarios || []).find(u => Number(u.id) === Number(id))?.nombre || 'Usuario no disponible';

function datosCuentaInterna(DB, sqlite, persona) {
  const marca = persona.cuenta_interna;
  let historial;
  if (persona.cliente_id != null) {
    historial = (DB.crm?.cuentas_internas_historial || []).filter(h => Number(h.cliente_id) === persona.cliente_id)
      .slice().sort((a, b) => b.id - a.id).slice(0, 20);
  } else {
    const [, sucursal, cli] = persona.ref.split(':');
    historial = sqlite ? sqlite.prepare(`SELECT * FROM sicar_internas_historial
      WHERE sucursal_id=? AND cli_id=? ORDER BY id DESC LIMIT 20`).all(Number(sucursal), cli)
      .map(h => ({ ...h, anterior: h.accion === 'desmarcar', nuevo: h.accion === 'marcar' })) : [];
  }
  return {
    cuenta_interna: marca ? { motivo: marca.motivo, fecha_hora: marca.fecha_hora, usuario_nombre: nombreUsuario(DB, marca.usuario_id) } : null,
    historial_interna: historial.map(h => ({ ...h, usuario_nombre: nombreUsuario(DB, h.usuario_id) })),
  };
}

function cambiarCuentaInterna({ DB, repo, consultas, guardar }, ctx, ref, cuerpo, usuarioId) {
  const persona = consultas.ficha(ctx, ref);
  const interna = cuerpo?.interna;
  const motivo = typeof cuerpo?.motivo === 'string' ? cuerpo.motivo.trim() : '';
  if (typeof interna !== 'boolean') throw error(400, 'La marca interna debe ser true o false.');
  if (motivo.length < 3 || motivo.length > 200) throw error(400, 'El motivo debe tener entre 3 y 200 caracteres.');
  const usuario_id = Number(usuarioId);
  const fecha_hora = new Date().toISOString();
  if (persona.cliente_id != null) {
    const cliente = DB.crm.clientes.find(c => Number(c.id) === persona.cliente_id);
    const anterior = !!cliente.cuenta_interna;
    if (anterior === interna) throw error(409, 'La cuenta ya tiene esa marca.');
    const historial = DB.crm.cuentas_internas_historial || [];
    const id = historial.reduce((n, h) => Math.max(n, Number(h.id) || 0), 0) + 1;
    const nuevoCliente = { ...cliente, cuenta_interna: interna ? { motivo, usuario_id, fecha_hora } : null };
    const crm = { ...DB.crm, clientes: DB.crm.clientes.map(c => c === cliente ? nuevoCliente : c),
      cuentas_internas_historial: [...historial, { id, cliente_id: persona.cliente_id, anterior, nuevo: interna, motivo, usuario_id, fecha_hora }] };
    guardar({ ...DB, crm });
    DB.crm = crm;
  } else {
    const [, sucursal, cli_id] = persona.ref.split(':');
    const sucursal_id = Number(sucursal);
    const vinculada = repo.conexionParaVinculos().prepare(`SELECT 1 FROM sicar_vinculos
      WHERE sucursal_id=? AND cli_id=? AND cliente_id IS NOT NULL AND estado IN ('pendiente','confirmado')`).get(sucursal_id, cli_id);
    // Una identidad unida se cambia únicamente por su persona nativa visible.
    if (vinculada) throw error(404, 'Cliente no encontrado.');
    repo.guardarCuentaInterna({ sucursal_id, cli_id, interna, motivo, usuario_id, fecha_hora });
  }
  return consultas.ficha(ctx, ref);
}
module.exports = { datosCuentaInterna, cambiarCuentaInterna };
