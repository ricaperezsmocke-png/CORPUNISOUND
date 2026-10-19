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

// Única forma de cambiar el estado de un cliente nativo con rastro. usuario_id null = el sistema.
function cambiarEstadoNativo(DB, clienteId, nuevo, { usuario_id = null, motivo = null, fecha_hora = new Date().toISOString() } = {}) {
  const cliente = clienteDe(DB, clienteId);
  const anterior = cliente.estado || null;
  DB.crm.estados_historial ??= [];
  const historial = DB.crm.estados_historial;
  const id = historial.reduce((n, h) => Math.max(n, Number(h.id) || 0), 0) + 1;
  const cambio = { id, cliente_id: Number(cliente.id), anterior, nuevo, usuario_id, motivo, fecha_hora };
  historial.push(cambio);
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
  const porCliente = (lista, campoFecha, filtro) => {
    const mapa = new Map();
    for (const item of lista || []) {
      if (item.cliente_id == null || !filtro(item)) continue;
      const ms = instante(item[campoFecha]);
      const id = Number(item.cliente_id);
      if (ms !== null && ms > (mapa.get(id) ?? -Infinity)) mapa.set(id, ms);
    }
    return mapa;
  };
  const compras = porCliente(DB.pos?.ventas, "fecha", v => v.estatus === "cerrada");
  const apartados = porCliente(DB.pos?.ventas, "fecha", v => v.estatus === "apartado");
  const radar = porCliente(DB.radar_demanda?.registros, "fecha_registro", () => true);
  const contactos = porCliente(DB.crm?.contactos_cliente, "fecha", () => true);
  const cambios = [];
  for (const cliente of DB.crm.clientes || []) {
    const id = Number(cliente.id);
    if (id === 0 || cliente.cuenta_interna) continue;
    // Un hecho cuenta si ocurrió el mismo día o después del último cambio (o de la activación).
    const corte = Math.max(desde, ultimoCambio.get(id) ?? -Infinity);
    const diaCorte = instante(fechaLocal(new Date(corte)));
    const despues = ms => ms !== null && ms !== undefined && ms >= diaCorte;
    const sicar = instante(ultimaCompraSicar(id));
    const hechos = [["compra", compras.get(id)], ["compra_sicar", sicar], ["apartado", apartados.get(id)], ["radar", radar.get(id)]];
    let cambio = null;
    for (const [hecho, ms] of hechos) {
      if (!despues(ms)) continue;
      cambio = aplicarHechoNativo(DB, id, hecho, ahora);
      if (cambio) break;
    }
    if (!cambio && PERDIBLES.has(cliente.estado)) {
      const actividad = maximo([corte, contactos.get(id) ?? null, instante(ultimaEntrada(id)), compras.get(id) ?? null, sicar]);
      if (ahoraMs - actividad >= DIAS_PARA_PERDIDO * DIA_MS) {
        cambio = cambiarEstadoNativo(DB, id, "perdido", { motivo: `${DIAS_PARA_PERDIDO} días sin respuesta ni compra`, fecha_hora: ahora });
      }
    }
    if (cambio) cambios.push(cambio);
  }
  return cambios;
}

module.exports = { DIAS_PARA_PERDIDO, cambiarEstadoNativo, aplicarHechoNativo, revisarEstadosAutomaticos };
