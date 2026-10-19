const { obtenerAsignacionActual, asignarLead, reasignarLead } = require("../centroLeads/asignaciones");

function error(status, mensaje) {
  return Object.assign(new Error(mensaje), { status });
}

/**
 * El responsable de un cliente es `cliente.vendedor_asignado_id` (lo que ya usa todo el CRM). Toda forma de cambiarlo
 * pasa por aquí y deja asignación con motivo y usuario en el expediente del cliente (spec 2026-10-18 §4.2-4.3).
 */
function crearResponsables(ctx) {
  const { DB, sqlite } = ctx;

  function vendedorValido(vendedorId, cliente) {
    const id = Number(vendedorId);
    const vendedor = (DB.pos.vendedores || []).find(v => Number(v.id) === id);
    if (!Number.isSafeInteger(id) || id <= 0 || !vendedor) throw error(400, "Vendedor no válido.");
    if (vendedor.activo === false) throw error(400, "El vendedor está dado de baja.");
    if (Number(vendedor.sucursal_id) !== Number(cliente.sucursal_id)) throw error(400, "El vendedor debe ser de la tienda del cliente.");
    return id;
  }

  function motivoValido(valor) {
    const motivo = typeof valor === "string" ? valor.trim() : "";
    if (motivo.length < 3 || motivo.length > 200) throw error(400, "El motivo debe tener de 3 a 200 caracteres.");
    return motivo;
  }

  // Destino de una asignación: el vendedor, o la tienda del cliente cuando se queda sin responsable.
  const destinoDe = (vendedorId, cliente) => (vendedorId === null
    ? { vendedor_id: null, sucursal_id: Number(cliente.sucursal_id) } : { vendedor_id: vendedorId });

  // Dentro de una operación: escribe la asignación y mueve el cliente. Una asignación vieja sin registro se anota primero.
  function mover(cliente, vendedorId, motivo, usuarioId) {
    const leadId = ctx.expediente(cliente);
    const contexto = { usuario_id: Number(usuarioId) || null, ocurrido_en: new Date().toISOString() };
    const actual = obtenerAsignacionActual(sqlite, leadId);
    const anterior = cliente.vendedor_asignado_id ?? null;
    if (!actual || actual.id === null) {
      if (actual) sqlite.prepare("UPDATE leads SET vendedor_asignado_id = NULL, sucursal_asignada_id = NULL WHERE id = ?").run(leadId);
      if (anterior !== null) {
        asignarLead(sqlite, leadId, { vendedor_id: anterior, regla: "previa", motivo: "Asignación previa" }, contexto);
        reasignarLead(sqlite, leadId, { ...destinoDe(vendedorId, cliente), regla: "manual", motivo }, contexto);
      } else {
        asignarLead(sqlite, leadId, { ...destinoDe(vendedorId, cliente), regla: "manual", motivo }, contexto);
      }
    } else {
      reasignarLead(sqlite, leadId, { ...destinoDe(vendedorId, cliente), regla: "manual", motivo }, contexto);
    }
    cliente.vendedor_asignado_id = vendedorId;
  }

  /**
   * Un cambio de responsable hecho por otra vía (la edición de la ficha) también deja asignación. Se llama dentro
   * de la misma transacción de la edición, con el cliente ya cambiado.
   */
  function registrarCambioExterno(cliente, anteriorId, motivo, usuarioId) {
    const nuevo = cliente.vendedor_asignado_id ?? null;
    const anterior = anteriorId ?? null;
    if (Number(nuevo) === Number(anterior) && (nuevo === null) === (anterior === null)) return;
    cliente.vendedor_asignado_id = anterior;
    mover(cliente, nuevo === null ? null : Number(nuevo), motivo, usuarioId);
  }

  function tomar(clienteId, { vendedor_id, usuario_id }) {
    const cliente = ctx.clienteActivo(clienteId);
    const actual = (DB.pos.vendedores || []).find(v => Number(v.id) === Number(cliente.vendedor_asignado_id));
    if (cliente.vendedor_asignado_id != null && actual && actual.activo !== false) throw error(409, "Este cliente ya tiene responsable.");
    const vendedorId = vendedorValido(vendedor_id, cliente);
    return ctx.operacion(() => {
      mover(cliente, vendedorId, "Tomó la conversación", usuario_id);
      return { cliente_id: Number(cliente.id), vendedor_asignado_id: vendedorId };
    });
  }

  function reasignar(clienteId, { vendedor_id, motivo, usuario_id }) {
    const texto = motivoValido(motivo);
    const cliente = ctx.clienteActivo(clienteId);
    const vendedorId = vendedorValido(vendedor_id, cliente);
    if (Number(cliente.vendedor_asignado_id) === vendedorId) throw error(409, "Ese vendedor ya es el responsable.");
    return ctx.operacion(() => {
      mover(cliente, vendedorId, texto, usuario_id);
      return { cliente_id: Number(cliente.id), vendedor_asignado_id: vendedorId };
    });
  }

  function traspasarCartera({ de_vendedor_id, a_vendedor_id, motivo, usuario_id }) {
    const texto = motivoValido(motivo);
    const de = Number(de_vendedor_id);
    const origen = (DB.pos.vendedores || []).find(v => Number(v.id) === de);
    if (!origen) throw error(404, "Vendedor no encontrado.");
    const destino = vendedorValido(a_vendedor_id, { sucursal_id: origen.sucursal_id });
    if (destino === de) throw error(400, "Elige a otro vendedor.");
    const cartera = (DB.crm.clientes || []).filter(c => Number(c.id) > 0 && Number(c.vendedor_asignado_id) === de);
    return ctx.operacion(() => {
      for (const cliente of cartera) mover(cliente, destino, texto, usuario_id);
      return { movidos: cartera.length, de_vendedor_id: de, a_vendedor_id: destino };
    });
  }

  return { tomar, reasignar, traspasarCartera, registrarCambioExterno };
}

module.exports = { crearResponsables };
