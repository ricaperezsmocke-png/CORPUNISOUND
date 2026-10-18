/**
 * crmFuentes.js — Consulta del CRM que combina compras del Punto de Venta con compras de SICAR.
 *
 * Solo LEE: no escribe en el JSON del negocio ni en las tablas sicar_*. Nunca toca caja, cortes,
 * utilidad ni metas. Las compras SICAR se suman en centavos y solo las vigentes cuentan.
 *
 * Alcance: primero se decide qué tiendas puede ver quien pregunta (token), y solo después se
 * calculan montos. Un vínculo con un cliente de otra tienda no abre esa ficha ni suma esas compras.
 * El filtro del encabezado (`filtroSucursal`) solo recorta listas y resumen, nunca una ficha por ref.
 */
const { segmentoPorUltimaCompra, ESTADOS_MANUALES } = require('./crm');
const { esPublicoSicar } = require('./sicarVinculos');
const { consultarQueCompra } = require('./crmQueCompra');
const { datosCuentaInterna } = require('./crmCuentasInternas');

const UNION_ACTIVA = new Set(['pendiente', 'confirmado']);
const LIMITE_MAXIMO = 100;
const VIP_MINIMO_CENTAVOS = 2_000_000;
const inicioVentana = hoy => new Date(Date.parse(hoy) - 365 * 86400000).toISOString().slice(0, 10);

function errorConsulta(status, mensaje) {
  const error = new Error(mensaje);
  error.status = status;
  return error;
}
const noEncontrado = () => errorConsulta(404, 'Cliente o compra no encontrado.');

const soloDia = fecha => (fecha ? String(fecha).slice(0, 10) : null);
const centavosPos = total => Math.round(Number(total || 0) * 100);
const masReciente = (a, b) => (!a ? b : !b ? a : (a > b ? a : b));

function diasEntre(fecha, hoyLocal) {
  return Math.floor((new Date(hoyLocal) - new Date(fecha)) / 86400000);
}

// Misma fórmula que crm.js calcularScore, con el monto en centavos.
function scoreDe(montoCentavos, compras, ultima, hoyLocal) {
  const recencia = ultima ? Math.max(0, 100 - diasEntre(ultima, hoyLocal)) : 0;
  return Math.round(Math.min(100, Math.min(40, montoCentavos / 50000) + Math.min(30, compras * 10) + recencia * 0.3));
}

function paginar(lista, { cursor = 0, limit = 50 } = {}) {
  const inicio = Number(cursor);
  const tamano = Math.min(LIMITE_MAXIMO, Number(limit) || 50);
  if (!Number.isSafeInteger(inicio) || inicio < 0 || !Number.isSafeInteger(tamano) || tamano < 1) {
    throw errorConsulta(400, 'Página inválida.');
  }
  const items = lista.slice(inicio, inicio + tamano);
  return { items, siguiente: inicio + tamano < lista.length ? inicio + tamano : null };
}

const normalizar = texto => String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function validarFiltros({ orden = 'reciente', desde, hasta, estado, vip }) {
  if (vip !== undefined && vip !== '1') throw errorConsulta(400, 'Filtro VIP inválido.');
  if (!['reciente', 'nombre', 'monto'].includes(orden)) throw errorConsulta(400, 'Orden inválido.');
  if (estado !== undefined && ![...ESTADOS_MANUALES, 'compro', 'sin_estado'].includes(estado)) {
    throw errorConsulta(400, 'Estado inválido.');
  }
  for (const fecha of [desde, hasta]) {
    if (fecha === undefined) continue;
    if (typeof fecha !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)
      || !Number.isFinite(Date.parse(fecha)) || new Date(fecha).toISOString().slice(0, 10) !== fecha) {
      throw errorConsulta(400, 'Fecha inválida.');
    }
  }
  if (desde && hasta && desde > hasta) throw errorConsulta(400, 'Desde no puede ser posterior a hasta.');
  return orden;
}

function compararPersonas(orden, a, b) {
  let diferencia = 0;
  if (orden === 'monto') diferencia = b.monto_centavos - a.monto_centavos;
  else if (orden === 'nombre' || (!a.ultima_compra && !b.ultima_compra)) {
    diferencia = normalizar(a.nombre).localeCompare(normalizar(b.nombre));
  } else diferencia = (b.ultima_compra || '').localeCompare(a.ultima_compra || '');
  return diferencia || a.ref.localeCompare(b.ref);
}

function crearConsultasCRM(DB, repo) {
  const sqlite = repo?.conexionParaVinculos?.() || null;
  const ve = (ctx, sucursalId) => ctx.alcance.verTodas || Number(sucursalId) === Number(ctx.alcance.sucursalId);
  const hoyDe = ctx => ctx.hoyLocal || require('./fechas').fechaLocal();

  function nativosVisibles(ctx) {
    return (DB.crm?.clientes || []).filter(c => Number(c.id) !== 0 && ve(ctx, c.sucursal_id));
  }

  // Identidades SICAR de las tiendas visibles con sus totales vigentes (una consulta agregada).
  function identidadesSicar(ctx) {
    if (!ctx.verSicar || !sqlite) return [];
    const tienda = ctx.alcance.verTodas ? null : Number(ctx.alcance.sucursalId);
    return sqlite.prepare(`SELECT c.sucursal_id, c.cli_id, c.nombre, c.telefono, c.celular,
        v.cliente_id, v.estado AS vinculo, e.estado AS estado_seguimiento, e.fecha_hora AS estado_fecha,
        i.motivo AS interna_motivo, i.usuario_id AS interna_usuario, i.fecha_hora AS interna_fecha,
        COALESCE(SUM(CASE WHEN s.estado='vigente' AND s.fecha_local >= ? THEN s.total_centavos END), 0) AS monto_12m,
        COALESCE(SUM(CASE WHEN s.estado='vigente' THEN s.total_centavos END), 0) AS monto,
        COALESCE(SUM(CASE WHEN s.estado='vigente' THEN 1 END), 0) AS compras,
        MAX(CASE WHEN s.estado='vigente' THEN s.fecha_local END) AS ultima
      FROM sicar_clientes c
      LEFT JOIN sicar_vinculos v ON v.sucursal_id=c.sucursal_id AND v.cli_id=c.cli_id
      LEFT JOIN sicar_estados e ON e.sucursal_id=c.sucursal_id AND e.cli_id=c.cli_id
      LEFT JOIN sicar_internas i ON i.sucursal_id=c.sucursal_id AND i.cli_id=c.cli_id
      LEFT JOIN sicar_ventas s ON s.sucursal_id=c.sucursal_id AND s.cli_id=c.cli_id
      WHERE (? IS NULL OR c.sucursal_id=?)
      GROUP BY c.sucursal_id, c.cli_id`).all(inicioVentana(hoyDe(ctx)), tienda, tienda).filter(f => !esPublicoSicar(f));
  }

  // Todas las personas que quien pregunta puede ver, con sus métricas ya combinadas.
  function personas(ctx, filtroSucursal = null) {
    const hoyLocal = hoyDe(ctx);
    const desde = inicioVentana(hoyLocal);
    const nativos = nativosVisibles(ctx);
    const porId = new Map(nativos.map(c => [Number(c.id), {
      ref: `crm:${c.id}`, fuente: 'crm', cliente_id: Number(c.id), nombre: c.nombre, telefono: c.telefono || null,
      sucursal_id: Number(c.sucursal_id), vendedor_asignado_id: c.vendedor_asignado_id ?? null, estado: c.estado || null,
      monto_pos_centavos: 0, monto_sicar_centavos: 0, compras: 0, ultima: null, identidades: [], aviso_vinculo: null,
      monto_12m_centavos: 0, cuenta_interna: c.cuenta_interna || null,
    }]));
    for (const v of DB.pos?.ventas || []) {
      const p = porId.get(Number(v.cliente_id));
      if (!p || v.estatus !== 'cerrada') continue;
      if (filtroSucursal != null && p.sucursal_id !== Number(filtroSucursal)) continue;
      p.monto_pos_centavos += centavosPos(v.total);
      if (soloDia(v.fecha) >= desde) p.monto_12m_centavos += centavosPos(v.total);
      p.compras += 1;
      p.ultima = masReciente(p.ultima, soloDia(v.fecha));
    }
    const externas = [];
    const estadosSicar = new Map();
    for (const f of identidadesSicar(ctx)) {
      if (filtroSucursal != null && f.sucursal_id !== Number(filtroSucursal)) continue;
      const unida = UNION_ACTIVA.has(f.vinculo) && f.cliente_id != null;
      const nativo = unida ? porId.get(Number(f.cliente_id)) : null;
      if (nativo) {
        const anterior = estadosSicar.get(nativo.ref);
        if (f.estado_seguimiento && (!anterior || f.estado_fecha > anterior.fecha)) {
          estadosSicar.set(nativo.ref, { estado: f.estado_seguimiento, fecha: f.estado_fecha });
        }
        nativo.monto_sicar_centavos += f.monto;
        nativo.monto_12m_centavos += f.monto_12m;
        nativo.compras += f.compras;
        nativo.ultima = masReciente(nativo.ultima, soloDia(f.ultima));
        nativo.identidades.push({ sucursal_id: f.sucursal_id, cli_id: f.cli_id });
        if (f.vinculo === 'pendiente') nativo.aviso_vinculo = 'Unión SICAR pendiente de revisión.';
        continue;
      }
      // Si quien pregunta ve todas las tiendas, una unión activa siempre cae en su nativo (arriba).
      externas.push({
        ref: `sicar:${f.sucursal_id}:${f.cli_id}`, fuente: 'sicar', cliente_id: null, nombre: f.nombre,
        telefono: f.telefono || f.celular || null, sucursal_id: f.sucursal_id, vendedor_asignado_id: null, estado: f.estado_seguimiento || null,
        monto_pos_centavos: 0, monto_sicar_centavos: f.monto, compras: f.compras, ultima: soloDia(f.ultima),
        monto_12m_centavos: f.monto_12m,
        cuenta_interna: unida
          ? (DB.crm?.clientes || []).find(c => Number(c.id) === Number(f.cliente_id))?.cuenta_interna || null
          : f.interna_motivo ? { motivo: f.interna_motivo, usuario_id: f.interna_usuario, fecha_hora: f.interna_fecha } : null,
        identidades: [{ sucursal_id: f.sucursal_id, cli_id: f.cli_id }],
        aviso_vinculo: unida ? 'Vinculado con un cliente de otra tienda.' : null,
      });
    }
    return [...porId.values(), ...externas].map(p => {
      const monto = p.monto_pos_centavos + p.monto_sicar_centavos;
      return { ...p, estado: p.estado || estadosSicar.get(p.ref)?.estado || null,
        vip: !p.cuenta_interna && p.monto_12m_centavos >= VIP_MINIMO_CENTAVOS,
        monto_centavos: monto, numero_compras: p.compras, ultima_compra: p.ultima, ya_compro: p.compras > 0,
        score: scoreDe(monto, p.compras, p.ultima, hoyLocal), segmento: segmentoPorUltimaCompra(p.ultima, hoyLocal) };
    });
  }

  const publica = ({ identidades, compras, ultima, ...resto }) => resto;

  function buscarPersona(ctx, ref) {
    if (typeof ref !== 'string' || !/^(crm:\d+|sicar:\d+:[^:]{1,40})$/.test(ref)) throw noEncontrado();
    const persona = personas(ctx).find(p => p.ref === ref);
    if (!persona) throw noEncontrado();
    return persona;
  }

  function listar(ctx, filtros = {}) {
    const orden = validarFiltros(filtros);
    const termino = normalizar(filtros.buscar).trim();
    const lista = personas(ctx, ctx.filtroSucursal)
      .filter(p => ctx.filtroSucursal == null || p.sucursal_id === Number(ctx.filtroSucursal) || p.numero_compras > 0)
      .filter(p => !termino || normalizar(p.nombre).includes(termino) || String(p.telefono || '').includes(termino))
      .filter(p => !filtros.desde || (p.ultima_compra && p.ultima_compra >= filtros.desde))
      .filter(p => !filtros.hasta || (p.ultima_compra && p.ultima_compra <= filtros.hasta))
      .filter(p => !filtros.estado || (filtros.estado === 'sin_estado' ? !p.estado : p.estado === filtros.estado))
      .filter(p => filtros.vip !== '1' || p.vip)
      .sort((a, b) => compararPersonas(orden, a, b));
    const contables = lista.filter(p => !p.cuenta_interna);
    const totales = {
      clientes: contables.length, compradores: contables.filter(p => p.ya_compro).length,
      monto_centavos: contables.reduce((s, p) => s + p.monto_centavos, 0),
      monto_pos_centavos: contables.reduce((s, p) => s + p.monto_pos_centavos, 0),
      monto_sicar_centavos: contables.reduce((s, p) => s + p.monto_sicar_centavos, 0),
    };
    const pagina = paginar(lista, filtros);
    return { items: pagina.items.map(publica), siguiente: pagina.siguiente, totales };
  }

  function ficha(ctx, ref) {
    const persona = buscarPersona(ctx, ref);
    return { ...publica(persona), ...datosCuentaInterna(DB, sqlite, persona) };
  }

  function compras(ctx, ref, filtros = {}) {
    const persona = buscarPersona(ctx, ref);
    const lista = [];
    if (persona.cliente_id != null) {
      for (const v of DB.pos?.ventas || []) {
        if (Number(v.cliente_id) !== persona.cliente_id || v.estatus !== 'cerrada') continue;
        lista.push({ ref: `pos:${v.id}`, fuente: 'pos', fecha: soloDia(v.fecha), sucursal_id: Number(v.sucursal_id),
          monto_centavos: centavosPos(v.total), estado: 'vigente', suma_al_total: true });
      }
    }
    if (ctx.verSicar && sqlite) {
      const consulta = sqlite.prepare(`SELECT sucursal_id, ven_id, fecha_local, estado, total_centavos FROM sicar_ventas
        WHERE sucursal_id=? AND cli_id=? AND estado IN ('vigente','cancelada')`);
      for (const id of persona.identidades) {
        for (const s of consulta.all(id.sucursal_id, id.cli_id)) {
          lista.push({ ref: `sicar:${s.sucursal_id}:${s.ven_id}`, fuente: 'sicar', fecha: soloDia(s.fecha_local),
            sucursal_id: s.sucursal_id, monto_centavos: s.total_centavos, estado: s.estado, suma_al_total: s.estado === 'vigente' });
        }
      }
    }
    lista.sort((a, b) => b.fecha.localeCompare(a.fecha) || a.fuente.localeCompare(b.fuente)
      || a.sucursal_id - b.sucursal_id || a.ref.localeCompare(b.ref));
    return paginar(lista, filtros);
  }

  function detalle(ctx, ref) {
    const pos = /^pos:(\d+)$/.exec(String(ref));
    if (pos) {
      const v = (DB.pos?.ventas || []).find(x => Number(x.id) === Number(pos[1]) && x.estatus === 'cerrada');
      if (!v || !personas(ctx).some(p => p.cliente_id === Number(v.cliente_id))) throw noEncontrado();
      const productos = DB['catalogo-productos']?.productos || [];
      const lineas = (DB.pos.venta_detalle || []).filter(d => d.venta_id === v.id).map(d => ({
        descripcion: productos.find(p => p.id === d.producto_id)?.nombre || d.descripcion || 'Artículo sin descripción',
        cantidad: d.cantidad, importe_centavos: centavosPos(d.subtotal ?? d.cantidad * d.precio_unitario),
      }));
      return { ref, fuente: 'pos', fecha: soloDia(v.fecha), sucursal_id: Number(v.sucursal_id),
        monto_centavos: centavosPos(v.total), estado: 'vigente', lineas };
    }
    const sicar = /^sicar:(\d+):([^:]{1,40})$/.exec(String(ref));
    if (!sicar || !ctx.verSicar || !sqlite || !ve(ctx, sicar[1])) throw noEncontrado();
    const s = sqlite.prepare(`SELECT s.*, c.nombre FROM sicar_ventas s JOIN sicar_clientes c
      ON c.sucursal_id=s.sucursal_id AND c.cli_id=s.cli_id WHERE s.sucursal_id=? AND s.ven_id=?`).get(Number(sicar[1]), sicar[2]);
    if (!s || s.estado === 'excluida' || esPublicoSicar(s)) throw noEncontrado();
    const lineas = sqlite.prepare(`SELECT descripcion, cantidad, importe_centavos, descuento_centavos FROM sicar_detalles
      WHERE sucursal_id=? AND ven_id=? ORDER BY renglon`).all(s.sucursal_id, s.ven_id);
    return { ref, fuente: 'sicar', fecha: soloDia(s.fecha_local), sucursal_id: s.sucursal_id, monto_centavos: s.total_centavos,
      estado: s.estado, suma_al_total: s.estado === 'vigente', lineas };
  }

  // SICAR se reparte por la tienda donde se compró (Q3); POS conserva la regla de crm.js (tienda del cliente).
  function resumen(ctx) {
    const lista = personas(ctx).filter(p => !p.cuenta_interna);
    const sucursales = (DB.pos?.sucursales || []).filter(s => ve(ctx, s.id)
      && (ctx.filtroSucursal == null || Number(s.id) === Number(ctx.filtroSucursal)));
    const sicarPorTienda = new Map();
    if (ctx.verSicar && sqlite) {
      const vistas = new Set(lista.flatMap(p => p.identidades.map(i => `${i.sucursal_id}:${i.cli_id}`)));
      const filas = sqlite.prepare(`SELECT sucursal_id, cli_id, SUM(total_centavos) AS monto FROM sicar_ventas
        WHERE estado='vigente' GROUP BY sucursal_id, cli_id`).all();
      for (const f of filas) {
        if (!vistas.has(`${f.sucursal_id}:${f.cli_id}`)) continue;
        sicarPorTienda.set(f.sucursal_id, (sicarPorTienda.get(f.sucursal_id) || 0) + f.monto);
      }
    }
    return {
      sucursales: sucursales.map(s => {
        const deTienda = lista.filter(p => p.sucursal_id === Number(s.id));
        return { sucursal_id: Number(s.id), nombre: s.nombre, clientes: deTienda.length,
          convertidos: deTienda.filter(p => p.ya_compro).length,
          monto_pos_centavos: deTienda.reduce((t, p) => t + p.monto_pos_centavos, 0),
          monto_sicar_centavos: sicarPorTienda.get(Number(s.id)) || 0 };
      }),
    };
  }

  // Para Gerencia: última compra combinada (POS + SICAR unido) de clientes nativos visibles.
  function ultimasCompras(ctx, clienteIds) {
    const pedidos = new Set((clienteIds || []).map(Number));
    const resultado = new Map();
    for (const p of personas(ctx)) {
      if (p.cliente_id != null && pedidos.has(p.cliente_id) && p.ultima_compra) resultado.set(p.cliente_id, p.ultima_compra);
    }
    return resultado;
  }

  const queCompra = (ctx, ref) => consultarQueCompra(DB, sqlite, buscarPersona(ctx, ref));
  return { listar, ficha, compras, detalle, resumen, ultimasCompras, queCompra };
}

module.exports = { crearConsultasCRM, VIP_MINIMO_CENTAVOS };
