// Motor FIFO del seguimiento por factura de CEDIS (spec §4 y §12.3). Puro: sin base de datos ni reloj.
// Entrada: movimientos de lector.js, YA ordenados; piezas y centavos en BigInt (piezas en diezmilésimas).
// Las piezas que salen de "anterior" (la foto) nunca se vuelven factura: siguen siendo anterior donde lleguen.

const ANTERIOR = -1;
const TRAMOS = ['vendido', 'queda', 'transito', 'gris', 'por_aclarar'];

function crearEstado() {
  return { lotes: [], existencias: new Map(), transitos: new Map(), incierto: [], huboAnterior: new Set() };
}

function anotarIncierto(estado, motivo) {
  if (motivo && !estado.incierto.includes(motivo)) estado.incierto.push(motivo);
}

function existencia(estado, sucursal) {
  if (!estado.existencias.has(sucursal)) estado.existencias.set(sucursal, new Map());
  return estado.existencias.get(sucursal);
}

function sumar(mapa, indice, piezas) {
  if (piezas > 0n) mapa.set(indice, (mapa.get(indice) ?? 0n) + piezas);
}

function sumarEn(estado, sucursal, indice, piezas) {
  if (indice === ANTERIOR) estado.huboAnterior.add(sucursal);
  sumar(existencia(estado, sucursal), indice, piezas);
}

/** Saca piezas de una tienda: primero anterior, luego la factura más vieja. Devuelve partes y faltante. */
function consumir(estado, sucursal, piezas) {
  const mapa = existencia(estado, sucursal), partes = [];
  let resta = piezas;
  for (const indice of [...mapa.keys()].sort((a, b) => a - b)) {
    if (resta === 0n) break;
    const disponible = mapa.get(indice), toma = disponible < resta ? disponible : resta;
    if (disponible === toma) mapa.delete(indice);
    else mapa.set(indice, disponible - toma);
    partes.push({ indice, piezas: toma });
    resta -= toma;
  }
  return { partes, faltante: resta };
}

function aTramo(estado, partes, tramo, sucursal) {
  for (const { indice, piezas } of partes) {
    if (indice === ANTERIOR) continue;
    const lote = estado.lotes[indice];
    lote[tramo] += piezas;
    if (tramo === 'vendido') {
      const s = lote.vendidoPorSucursal;
      s.set(sucursal, (s.get(sucursal) ?? 0n) + piezas);
    }
  }
}

function marcarLotes(estado, partes, motivo) {
  for (const { indice } of partes) {
    const lote = estado.lotes[indice];
    if (lote && !lote.motivos.includes(motivo)) lote.motivos.push(motivo);
  }
}

const llaveTraspaso = t => JSON.stringify([t.folio, t.suc_origen, t.suc_destino]);

function compra(estado, m) {
  const indice = estado.lotes.length;
  estado.lotes.push({ lote: m.lote, comprado: m.piezas, valor_centavos: m.valor_centavos, vendido: 0n, transito: 0n,
    sin_agente: 0n, por_aclarar: 0n, motivos: m.por_aclarar ? [m.por_aclarar] : [], vendidoPorSucursal: new Map() });
  sumar(existencia(estado, m.sucursal_id), indice, m.piezas);
  anotarIncierto(estado, m.por_aclarar);
}

function salida(estado, m) {
  const { partes, faltante } = consumir(estado, m.sucursal_id, m.piezas);
  if (faltante > 0n) anotarIncierto(estado, 'salida_sin_existencia');
  // recepcion_menor marca la salida pero el envío es real: va a tránsito y la diferencia se resuelve al recibir.
  const dudosa = m.por_aclarar && m.por_aclarar !== 'recepcion_menor';
  if (dudosa) {
    anotarIncierto(estado, m.por_aclarar);
    marcarLotes(estado, partes, m.por_aclarar);
    aTramo(estado, partes, 'por_aclarar');
  } else if (m.sin_agente) {
    aTramo(estado, partes, 'sin_agente');
  } else {
    if (m.por_aclarar) anotarIncierto(estado, m.por_aclarar);
    aTramo(estado, partes, 'transito');
    const llave = llaveTraspaso(m.traspaso);
    const previo = estado.transitos.get(llave);
    estado.transitos.set(llave, { destino: m.traspaso.destino, partes: [...(previo?.partes ?? []), ...partes] });
  }
}

function recepcion(estado, m) {
  if (m.por_aclarar && !['recepcion_mayor', 'origen_no_incorporado'].includes(m.por_aclarar)) {
    anotarIncierto(estado, m.por_aclarar); // Su salida ya mandó las piezas a por aclarar.
    return;
  }
  if (m.por_aclarar === 'origen_no_incorporado') {
    // Devolución de una tienda sin agente: la mercancía sí llegó, pero no se sabe de qué factura era.
    // Entra como anterior (sin factura) para que lo vendido después no se le cobre a otra factura.
    anotarIncierto(estado, m.por_aclarar);
    sumarEn(estado, m.sucursal_id, ANTERIOR, m.piezas);
    return;
  }
  const llave = llaveTraspaso(m.traspaso), enCamino = estado.transitos.get(llave);
  if (!enCamino) {
    anotarIncierto(estado, m.por_aclarar || 'recepcion_sin_salida');
    return;
  }
  estado.transitos.delete(llave);
  const sobrantes = [];
  let resta = m.piezas;
  // Llega primero lo más viejo; lo que no llegó queda por aclarar (nunca como faltante de la tienda).
  for (const parte of [...enCamino.partes].sort((a, b) => a.indice - b.indice)) {
    const llega = parte.piezas < resta ? parte.piezas : resta;
    resta -= llega;
    if (parte.indice !== ANTERIOR) estado.lotes[parte.indice].transito -= parte.piezas;
    sumarEn(estado, m.sucursal_id, parte.indice, llega);
    if (parte.piezas > llega) sobrantes.push({ indice: parte.indice, piezas: parte.piezas - llega });
  }
  if (sobrantes.length) {
    anotarIncierto(estado, 'recepcion_menor');
    marcarLotes(estado, sobrantes, 'recepcion_menor');
    aTramo(estado, sobrantes, 'por_aclarar');
  }
  if (resta > 0n) anotarIncierto(estado, 'recepcion_mayor');
}

function venta(estado, m) {
  const { partes, faltante } = consumir(estado, m.sucursal_id, m.piezas);
  if (faltante > 0n) anotarIncierto(estado, 'venta_sin_existencia');
  if (m.por_aclarar) {
    anotarIncierto(estado, m.por_aclarar);
    marcarLotes(estado, partes, m.por_aclarar);
    aTramo(estado, partes, 'por_aclarar');
  } else {
    aTramo(estado, partes, 'vendido', m.sucursal_id);
  }
}

/** Reparto proporcional; los centavos sobrantes van en orden fijo, saltando tramos sin piezas. */
function repartir(valor, comprado, piezas) {
  if (comprado <= 0n || !(valor > 0n)) return null;
  const dinero = {};
  let asignado = 0n;
  for (const t of TRAMOS) {
    dinero[t] = valor * piezas[t] / comprado;
    asignado += dinero[t];
  }
  const conPiezas = TRAMOS.filter(t => piezas[t] > 0n);
  for (let i = 0; asignado < valor; i++, asignado++) dinero[conPiezas[i % conPiezas.length]] += 1n;
  return Object.fromEntries(TRAMOS.map(t => [t, String(dinero[t])]));
}

function resultadoLote(estado, indice) {
  const l = estado.lotes[indice], quedaPorSucursal = new Map();
  for (const [sucursal, mapa] of estado.existencias) {
    if (mapa.get(indice)) quedaPorSucursal.set(sucursal, mapa.get(indice));
  }
  const sucursales = [...new Set([...quedaPorSucursal.keys(), ...l.vendidoPorSucursal.keys()])].sort((a, b) => a - b);
  const por_sucursal = Object.fromEntries(sucursales.map(s => [s, {
    queda: String(quedaPorSucursal.get(s) ?? 0n), vendido: String(l.vendidoPorSucursal.get(s) ?? 0n) }]));
  const queda = [...quedaPorSucursal.values()].reduce((a, v) => a + v, 0n);
  const piezas = { vendido: l.vendido, queda, transito: l.transito, gris: l.sin_agente, por_aclarar: l.por_aclarar };
  return { lote: l.lote, comprado: String(l.comprado), valor_centavos: String(l.valor_centavos), vendido: String(l.vendido),
    queda: String(queda), por_sucursal, transito: String(l.transito), sin_agente: String(l.sin_agente),
    por_aclarar: String(l.por_aclarar), motivos: [...l.motivos], dinero: repartir(l.valor_centavos, l.comprado, piezas) };
}

const ACCIONES = { compra, salida, recepcion, venta };

/** Recorre los movimientos en el orden recibido. Piezas y centavos de la salida van como texto decimal. */
function calcular(movimientos) {
  const estado = crearEstado();
  for (const m of movimientos) {
    if (m.solo_observacion) {
      anotarIncierto(estado, m.por_aclarar || 'observacion');
      continue;
    }
    if (m.tipo === 'foto') {
      sumarEn(estado, m.sucursal_id, ANTERIOR, m.piezas);
      anotarIncierto(estado, m.por_aclarar);
      continue;
    }
    const accion = ACCIONES[m.tipo];
    if (!accion) throw new Error(`Movimiento desconocido: ${m.tipo}`);
    accion(estado, m);
  }
  const anterior = {};
  for (const sucursal of [...estado.huboAnterior].sort((a, b) => a - b)) {
    anterior[sucursal] = String(existencia(estado, sucursal).get(ANTERIOR) ?? 0n);
  }
  return { lotes: estado.lotes.map((_l, i) => resultadoLote(estado, i)), anterior, incierto: [...estado.incierto] };
}

module.exports = { calcular };
