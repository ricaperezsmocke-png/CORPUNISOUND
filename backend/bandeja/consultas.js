const { obtenerHistorialLead } = require("../centroLeads/historial");

const FILTROS = Object.freeze(["mias", "sin_responsable", "todas", "por_identificar"]);

/**
 * Qué conversación puede ver quién (spec 2026-10-18 §2 y §4.8). El alcance de tienda sale del token, nunca de la
 * petición. Sin `ver_todas_conversaciones` el vendedor ve las de sus clientes y las sin responsable de su tienda.
 */
function crearConsultasBandeja(ctx) {
  const { sqlite, DB } = ctx;
  const nombreVendedor = id => (DB.pos.vendedores || []).find(v => Number(v.id) === Number(id))?.nombre || null;

  function filas() {
    return sqlite.prepare(`SELECT c.id, c.canal, f.nombre AS canal_nombre, f.sucursal_responsable_id AS sucursal_id,
        c.identidad_externa_id AS identidad_id, i.cliente_id, i.nombre_mostrado, i.telefono_normalizado AS telefono, c.ultima_interaccion_en,
        (SELECT texto FROM lead_interacciones x WHERE x.conversacion_id = c.id ORDER BY x.ocurrida_en DESC, x.id DESC LIMIT 1) AS ultimo_texto,
        (SELECT direccion FROM lead_interacciones x WHERE x.conversacion_id = c.id ORDER BY x.ocurrida_en DESC, x.id DESC LIMIT 1) AS ultima_direccion
      FROM lead_conversaciones c JOIN lead_fuentes f ON f.id = c.fuente_id
      LEFT JOIN lead_identidades_externas i ON i.id = c.identidad_externa_id
      ORDER BY c.ultima_interaccion_en DESC, c.id DESC`).all();
  }

  function enriquecer(fila) {
    const cliente = fila.cliente_id ? (DB.crm.clientes || []).find(c => Number(c.id) === Number(fila.cliente_id)) : null;
    // Un responsable dado de baja no cuenta: sus clientes quedan visibles y se pueden tomar en su tienda.
    const asignado = cliente?.vendedor_asignado_id ?? null;
    const activo = asignado !== null && (DB.pos.vendedores || []).some(v => Number(v.id) === Number(asignado) && v.activo !== false);
    const responsable = activo ? asignado : null;
    return { ...fila, cliente_id: cliente ? Number(cliente.id) : null, cliente_nombre: cliente?.nombre || fila.nombre_mostrado || null,
      cliente_sucursal_id: cliente ? Number(cliente.sucursal_id) : null, estado: cliente?.estado || null,
      responsable_id: responsable, responsable_nombre: responsable ? nombreVendedor(responsable) : null };
  }

  // Una conversación es de la tienda de su cliente; sin cliente, de la tienda del canal.
  const tiendaDe = c => c.cliente_sucursal_id ?? Number(c.sucursal_id);

  function puedeVer(c, permiso) {
    const { alcance, verTodasConversaciones, vendedorId } = permiso;
    if (!alcance.verTodas && tiendaDe(c) !== Number(alcance.sucursalId)) return false;
    if (verTodasConversaciones) return true;
    return c.responsable_id === null || (vendedorId !== null && Number(c.responsable_id) === Number(vendedorId));
  }

  function listar(permiso, filtro = "mias") {
    if (!FILTROS.includes(filtro)) throw Object.assign(new Error("Filtro no válido."), { status: 400 });
    if (filtro === "todas" && !permiso.verTodasConversaciones) throw Object.assign(new Error("Sin permiso para ver todas."), { status: 403 });
    return filas().map(enriquecer).filter(c => puedeVer(c, permiso)).filter(c => {
      if (filtro === "mias") return permiso.vendedorId !== null && Number(c.responsable_id) === Number(permiso.vendedorId);
      if (filtro === "sin_responsable") return c.cliente_id !== null && c.responsable_id === null;
      if (filtro === "por_identificar") return c.cliente_id === null;
      return true;
    }).slice(0, 200);
  }

  // 404 (no 403) fuera de alcance: no se confirma que exista.
  function ver(conversacionId, permiso) {
    const c = enriquecer(ctx.conversacion(conversacionId));
    if (!puedeVer(c, permiso)) throw Object.assign(new Error("Conversación no encontrada."), { status: 404 });
    return { ...c, mensajes: ctx.hilo(c.id) };
  }

  function historialCliente(clienteId) {
    const lead = sqlite.prepare("SELECT id FROM leads WHERE cliente_id = ?").get(Number(clienteId));
    const conversaciones = sqlite.prepare(`SELECT c.id, c.canal, c.ultima_interaccion_en FROM lead_conversaciones c
      JOIN lead_identidades_externas i ON i.id = c.identidad_externa_id WHERE i.cliente_id = ? ORDER BY c.ultima_interaccion_en DESC`)
      .all(Number(clienteId));
    const responsables = lead ? sqlite.prepare(`SELECT vendedor_asignado_id, motivo, asignada_por_usuario_id, asignada_en, finalizada_en
      FROM lead_asignaciones WHERE lead_id = ? ORDER BY asignada_en DESC, id DESC`).all(lead.id)
      .map(a => ({ ...a, vendedor_nombre: nombreVendedor(a.vendedor_asignado_id) })) : [];
    const estados = (DB.crm.estados_historial || []).filter(h => Number(h.cliente_id) === Number(clienteId))
      .sort((a, b) => String(b.fecha_hora).localeCompare(String(a.fecha_hora)) || b.id - a.id).slice(0, 50);
    return { conversaciones, responsables, estados, eventos: lead ? obtenerHistorialLead(sqlite, lead.id).slice(-50) : [] };
  }

  return { listar, ver, historialCliente, puedeVer, enriquecer };
}

module.exports = { crearConsultasBandeja, FILTROS };
