const { fechaLocal } = require("../fechas");

// Spec 2026-10-18 §4.4. El estado del embudo cambia solo por hechos que el sistema ve; nunca baja solo, salvo a
// "perdido" por tiempo, y quien compró no se pierde.
const DIAS_PARA_PERDIDO = 30;
const RANGO = Object.freeze({ contactado: 1, interesado: 2, visito_tienda: 3, compro: 4 });
const PERDIBLES = new Set(["contactado", "interesado", "visito_tienda"]);
const DIA_MS = 86400000;

const REGLAS = Object.freeze({
  saliente: { nuevo: "contactado", motivo: "La tienda le escribió", aplica: e => !e },
  entrante: { nuevo: "interesado", motivo: "El cliente escribió", aplica: e => !e || e === "contactado" || e === "perdido" },
  apartado: { nuevo: "visito_tienda", motivo: "Apartado en tienda", aplica: e => !e || e === "perdido" || RANGO[e] < 3 },
  radar: { nuevo: "visito_tienda", motivo: "Registro en el Radar de Demanda", aplica: e => !e || e === "perdido" || RANGO[e] < 3 },
  compra: { nuevo: "compro", motivo: "Compró en tienda", aplica: e => e !== "compro" },
  compra_sicar: { nuevo: "compro", motivo: "Compra registrada en SICAR", aplica: e => e !== "compro" },
});

function clienteDe(DB, clienteId) {
  const cliente = (DB.crm?.clientes || []).find(c => Number(c.id) === Number(clienteId));
  if (!cliente) throw Object.assign(new Error("Cliente no encontrado"), { status: 404 });
  return cliente;
}

// Renglón del historial de estados de un cliente nativo. usuario_id null = el sistema.
function anotarEstado(DB, { cliente_id, anterior, nuevo, usuario_id = null, motivo = null, fecha_hora }) {
  DB.crm.estados_historial ??= [];
  const historial = DB.crm.estados_historial;
  const id = historial.reduce((n, h) => Math.max(n, Number(h.id) || 0), 0) + 1;
  const cambio = { id, cliente_id: Number(cliente_id), anterior, nuevo, usuario_id, motivo, fecha_hora };
  historial.push(cambio);
  return cambio;
}

// Única forma de cambiar el estado de un cliente nativo con rastro.
function cambiarEstadoNativo(DB, clienteId, nuevo, { usuario_id = null, motivo = null, fecha_hora = new Date().toISOString() } = {}) {
  const cliente = clienteDe(DB, clienteId);
  const cambio = anotarEstado(DB, { cliente_id: cliente.id, anterior: cliente.estado || null, nuevo, usuario_id, motivo, fecha_hora });
  cliente.estado = nuevo;
  return cambio;
}

function aplicarHechoNativo(DB, clienteId, hecho, fecha_hora) {
  const regla = REGLAS[hecho];
  if (!regla) throw new Error(`Hecho desconocido: ${hecho}`);
  const cliente = clienteDe(DB, clienteId);
  if (Number(cliente.id) === 0 || cliente.cuenta_interna) return null;
  if (!regla.aplica(cliente.estado || null)) return null;
  return cambiarEstadoNativo(DB, cliente.id, regla.nuevo, { motivo: regla.motivo, fecha_hora });
}

const instante = valor => {
  if (!valor) return null;
  // Una fecha sola es un día de la tienda: cuenta desde su mediodía, lejos de cualquier borde de zona horaria.
  const ms = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(valor) ? `${valor}T18:00:00.000Z` : valor);
  return Number.isFinite(ms) ? ms : null;
};
// Los hechos se comparan por día de la tienda: un registro de las 10 am cuenta el mismo día que un cambio de las 8 am.
const dia = valor => {
  const ms = instante(valor);
  return ms === null ? null : instante(fechaLocal(new Date(ms)));
};
const maximo = valores => valores.reduce((m, v) => (v !== null && (m === null || v > m) ? v : m), null);

/**
 * Revisión periódica (al arrancar y cada hora): compras, apartados y Radar desde el último cambio mueven el estado;
 * 30 días sin actividad lo pasan a perdido. La primera corrida anota desde cuándo cuenta: nada anterior a esa fecha
 * mueve estados, para que encender esto no reacomode de golpe a todos los clientes.
 * Dependencias opcionales: ultimaEntrada(clienteId) e ultimaCompraSicar(clienteId) devuelven ISO o null.
 */
function revisarEstadosAutomaticos({ DB, ahora = new Date().toISOString(), ultimaEntrada = () => null, ultimaCompraSicar = () => null }) {
  DB.crm.estados_automaticos ??= { desde: ahora };
  const desde = instante(DB.crm.estados_automaticos.desde);
  const ahoraMs = instante(ahora);
  const ultimoCambio = new Map();
  for (const h of DB.crm.estados_historial || []) {
    const ms = instante(h.fecha_hora);
    if (ms !== null && ms > (ultimoCambio.get(Number(h.cliente_id)) ?? -Infinity)) ultimoCambio.set(Number(h.cliente_id), ms);
  }
  const porCliente = (lista, fechaDe, filtro) => {
    const mapa = new Map();
    for (const item of lista || []) {
      if (item.cliente_id == null || !filtro(item)) continue;
      const ms = dia(fechaDe(item));
      const id = Number(item.cliente_id);
      if (ms !== null && ms > (mapa.get(id) ?? -Infinity)) mapa.set(id, ms);
    }
    return mapa;
  };
  // Un apartado liquidado es compra el día que se liquidó, no el día que se apartó.
  const compras = porCliente(DB.pos?.ventas, v => v.fecha_liquidacion || v.fecha, v => v.estatus === "cerrada");
  const apartados = porCliente(DB.pos?.ventas, v => v.fecha, v => v.estatus === "apartado");
  const radar = porCliente(DB.radar_demanda?.registros, r => r.fecha_registro, () => true);
  const contactos = porCliente(DB.crm?.contactos_cliente, c => c.fecha, () => true);
  // Quien está pagando un apartado vigente no está perdido.
  // Vigente = sin liquidar ni cancelar y sin pasar su fecha límite (un vencido que nadie canceló ya no protege).
  const hoyLocal = fechaLocal(new Date(ahora));
  const conApartadoVigente = new Set((DB.pos?.ventas || []).filter(v => v.estatus === "apartado" && v.cliente_id != null
    && (!v.fecha_limite || String(v.fecha_limite) >= hoyLocal)).map(v => Number(v.cliente_id)));
  const cambios = [];
  for (const cliente of DB.crm.clientes || []) {
    const id = Number(cliente.id);
    if (id === 0 || cliente.cuenta_interna) continue;
    // Un hecho cuenta si ocurrió el mismo día o después del último cambio (o de la activación).
    const corte = Math.max(desde, ultimoCambio.get(id) ?? -Infinity);
    const diaCorte = instante(fechaLocal(new Date(corte)));
    const despues = ms => ms !== null && ms !== undefined && ms >= diaCorte;
    const sicar = dia(ultimaCompraSicar(id));
    const hechos = [["compra", compras.get(id)], ["compra_sicar", sicar], ["apartado", apartados.get(id)], ["radar", radar.get(id)]];
    let cambio = null;
    for (const [hecho, ms] of hechos) {
      if (!despues(ms)) continue;
      cambio = aplicarHechoNativo(DB, id, hecho, ahora);
      if (cambio) break;
    }
    if (!cambio && PERDIBLES.has(cliente.estado) && !conApartadoVigente.has(id)) {
      const actividad = maximo([corte, contactos.get(id) ?? null, instante(ultimaEntrada(id)), compras.get(id) ?? null, sicar]);
      if (ahoraMs - actividad >= DIAS_PARA_PERDIDO * DIA_MS) {
        cambio = cambiarEstadoNativo(DB, id, "perdido", { motivo: `${DIAS_PARA_PERDIDO} días sin respuesta ni compra`, fecha_hora: ahora });
      }
    }
    if (cambio) cambios.push(cambio);
  }
  return cambios;
}

module.exports = { DIAS_PARA_PERDIDO, anotarEstado, cambiarEstadoNativo, aplicarHechoNativo, revisarEstadosAutomaticos };
