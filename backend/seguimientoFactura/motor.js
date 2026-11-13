// Motor FIFO del seguimiento por factura de CEDIS (spec §4 y §12.3). Puro: sin base de datos ni reloj.
// Entrada: movimientos de lector.js, YA ordenados; piezas y centavos en BigInt (piezas en diezmilésimas).
// Las piezas que salen de "anterior" (la foto) nunca se vuelven factura: siguen siendo anterior donde lleguen.

const ANTERIOR = -1;
const TRAMOS = ['vendido', 'queda', 'transito', 'gris', 'por_aclarar'];

function crearEstado() {
  // anomalias: tiendas donde algo no entró o no salió completo (faltante, recepción incompleta); controles: rescate.
  return { lotes: [], existencias: new Map(), transitos: new Map(), incierto: [], huboAnterior: new Set(),
    anomalias: new Set(), controles: 0, fallas: [] };
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

function aTramo(estado, partes, tramo, sucursal, movimiento) {
  for (const { indice, piezas } of partes) {
    if (indice === ANTERIOR) continue;
    const lote = estado.lotes[indice];
    lote[tramo] += piezas;
    if (tramo === 'por_aclarar') lote.abiertos.push({ piezas, movimiento });
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
  estado.lotes.push({ lote: m.lote, comprado: m.piezas, valor_centavos: m.valor_centavos,
    valor_con_iva_centavos: m.valor_con_iva_centavos ?? null, vendido: 0n, transito: 0n,
    sin_agente: 0n, por_aclarar: 0n, motivos: m.por_aclarar ? [m.por_aclarar] : [], vendidoPorSucursal: new Map(),
    recibidoPorSucursal: new Map(), abiertos: [] });
  sumar(existencia(estado, m.sucursal_id), indice, m.piezas);
  anotarIncierto(estado, m.por_aclarar);
}

function salida(estado, m) {
  const { partes, faltante } = consumir(estado, m.sucursal_id, m.piezas);
  if (faltante > 0n) {
    anotarIncierto(estado, 'salida_sin_existencia');
    estado.anomalias.add(m.sucursal_id);
  }
  // recepcion_menor marca la salida pero el envío es real: va a tránsito y la diferencia se resuelve al recibir.
  const dudosa = m.por_aclarar && m.por_aclarar !== 'recepcion_menor';
  if (dudosa) {
    anotarIncierto(estado, m.por_aclarar);
    marcarLotes(estado, partes, m.por_aclarar);
    aTramo(estado, partes, 'por_aclarar', undefined, m);
  } else if (m.sin_agente) {
    aTramo(estado, partes, 'sin_agente');
  } else {
    if (m.por_aclarar) anotarIncierto(estado, m.por_aclarar);
    aTramo(estado, partes, 'transito');
    const llave = llaveTraspaso(m.traspaso);
    const previo = estado.transitos.get(llave);
    const enviadas = partes.map(p => ({ ...p, movimiento: m }));
    estado.transitos.set(llave, { destino: m.traspaso.destino, partes: [...(previo?.partes ?? []), ...enviadas] });
  }
}

function recepcion(estado, m) {
  if (m.anterior && !m.por_aclarar) {
    // Rescate: salió antes del inicio del sistema y llegó en la ventana. Es mercancía cierta, sin factura seguida.
    sumarEn(estado, m.sucursal_id, ANTERIOR, m.piezas);
    return;
  }
  if (m.anterior || (m.por_aclarar && !['recepcion_mayor', 'origen_no_incorporado'].includes(m.por_aclarar))) {
    anotarIncierto(estado, m.por_aclarar); // Su salida ya mandó las piezas a por aclarar.
    estado.anomalias.add(m.sucursal_id);
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
    estado.anomalias.add(m.sucursal_id);
    return;
  }
  estado.transitos.delete(llave);
  const sobrantes = [];
  let resta = m.piezas;
  // Llega primero lo más viejo; lo que no llegó queda por aclarar (nunca como faltante de la tienda).
  for (const parte of [...enCamino.partes].sort((a, b) => a.indice - b.indice)) {
    const llega = parte.piezas < resta ? parte.piezas : resta;
    resta -= llega;
    if (parte.indice !== ANTERIOR) {
      const lote = estado.lotes[parte.indice];
      lote.transito -= parte.piezas;
      lote.recibidoPorSucursal.set(m.sucursal_id, (lote.recibidoPorSucursal.get(m.sucursal_id) ?? 0n) + llega);
    }
    sumarEn(estado, m.sucursal_id, parte.indice, llega);
    if (parte.piezas > llega) sobrantes.push({ ...parte, piezas: parte.piezas - llega });
  }
  if (sobrantes.length) {
    anotarIncierto(estado, 'recepcion_menor');
    marcarLotes(estado, sobrantes, 'recepcion_menor');
    for (const parte of sobrantes) {
      aTramo(estado, [parte], 'por_aclarar', undefined, { ...parte.movimiento, por_aclarar: 'recepcion_menor' });
    }
  }
  if (resta > 0n) {
    anotarIncierto(estado, 'recepcion_mayor');
    estado.anomalias.add(m.sucursal_id);
  }
}

function venta(estado, m) {
  const { partes, faltante } = consumir(estado, m.sucursal_id, m.piezas);
  if (faltante > 0n) {
    anotarIncierto(estado, 'venta_sin_existencia');
    estado.anomalias.add(m.sucursal_id);
  }
  if (m.por_aclarar) {
    anotarIncierto(estado, m.por_aclarar);
    marcarLotes(estado, partes, m.por_aclarar);
    aTramo(estado, partes, 'por_aclarar', undefined, m);
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

/** Conserva procedencia sin intervenir en consumir, en las recepciones ni en el reparto de tramos. */
function movimientosAbiertos(estado, indice, dinero, conIva) {
  const grupos = new Map();
  const agregar = (tramo, { piezas, movimiento: m }) => {
    const t = m?.traspaso;
    const datos = { tramo, motivo: tramo === 'transito' ? null : m?.por_aclarar ?? null,
      folio: t?.folio ?? null, fecha_envio: m?.fecha_envio ?? m?.fecha ?? null,
      origen: t?.origen ?? m?.sucursal_id ?? null, destino: t?.destino ?? null,
      sicar_origen: t?.suc_origen ?? null, sicar_destino: t?.suc_destino ?? null };
    const llave = JSON.stringify(datos), previo = grupos.get(llave);
    grupos.set(llave, { ...datos, piezas: String(BigInt(previo?.piezas ?? '0') + piezas) });
  };
  for (const p of estado.lotes[indice].abiertos) agregar('por_aclarar', p);
  for (const t of estado.transitos.values()) {
    for (const p of t.partes) if (p.indice === indice) agregar('transito', p);
  }
  const resultado = [...grupos.values()];
  for (const tramo of ['transito', 'por_aclarar']) {
    const filas = resultado.filter(m => m.tramo === tramo);
    const total = filas.reduce((s, m) => s + BigInt(m.piezas), 0n);
    for (const [campo, valores] of [['centavos', dinero], ['centavos_con_iva', conIva]]) {
      let usado = 0n;
      for (const m of filas) {
        const valor = valores ? BigInt(valores[tramo]) * BigInt(m.piezas) / total : null;
        m[campo] = valor === null ? null : String(valor);
        usado += valor ?? 0n;
      }
      // Reparte únicamente los centavos del tramo ya calculado; nunca cambia ese total.
      if (valores) for (let i = 0; usado < BigInt(valores[tramo]); i++, usado++) {
        const m = filas[i % filas.length];
        m[campo] = String(BigInt(m[campo]) + 1n);
      }
    }
  }
  return resultado;
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
  const dinero = repartir(l.valor_centavos, l.comprado, piezas), con = l.valor_con_iva_centavos > 0n ? l.valor_con_iva_centavos : null;
  const dineroConIva = dinero && con !== null ? repartir(con, l.comprado, piezas) : null;
  return { lote: l.lote, comprado: String(l.comprado), valor_centavos: String(l.valor_centavos), vendido: String(l.vendido),
    queda: String(queda), por_sucursal, transito: String(l.transito), sin_agente: String(l.sin_agente),
    por_aclarar: String(l.por_aclarar), motivos: [...l.motivos], dinero,
    movimientos_abiertos: movimientosAbiertos(estado, indice, dinero, dineroConIva),
    // Mismo reparto sobre el valor con IVA. Sin dinero sin IVA, o con IVA en cero o ausente, no hay con IVA.
    valor_con_iva_centavos: con === null ? null : String(con), dinero_con_iva: dineroConIva };
}

function fallar(estado, sucursal_id, motivo) {
  if (!estado.fallas.some(f => f.sucursal_id === sucursal_id && f.motivo === motivo)) estado.fallas.push({ sucursal_id, motivo });
}

/**
 * Control del rescate al corte real de la tienda: no mueve piezas. Lo calculado en la tienda debe ser exactamente su foto
 * real, sin faltantes ni recepciones incompletas en el camino, y ninguna factura puede tener ahí más de lo que recibió.
 */
function control(estado, m) {
  estado.controles++;
  const mapa = existencia(estado, m.sucursal_id);
  const total = [...mapa.values()].reduce((a, v) => a + v, 0n);
  if (total !== m.piezas || estado.anomalias.has(m.sucursal_id)) fallar(estado, m.sucursal_id, 'control_no_cuadra');
  for (const [indice, piezas] of mapa) {
    if (indice === ANTERIOR) continue;
    if (piezas > (estado.lotes[indice].recibidoPorSucursal.get(m.sucursal_id) ?? 0n)) {
      fallar(estado, m.sucursal_id, 'factura_excede_recibido');
    }
  }
}

/** Con rescate, cada lote debe repartir exactamente lo comprado entre tiendas, tránsito, vendido, gris y por aclarar. */
function revisarSumas(estado, lotes) {
  if (!estado.controles) return;
  for (const l of lotes) {
    const suma = [l.vendido, l.queda, l.transito, l.sin_agente, l.por_aclarar].reduce((a, v) => a + BigInt(v), 0n);
    if (suma !== BigInt(l.comprado)) fallar(estado, null, 'suma_no_cuadra');
  }
}

const ACCIONES = { compra, salida, recepcion, venta, control };

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
  const lotes = estado.lotes.map((_l, i) => resultadoLote(estado, i));
  revisarSumas(estado, lotes);
  return { lotes, anterior, incierto: [...estado.incierto], rescate_ok: estado.fallas.length === 0, rescate_fallas: estado.fallas };
}

module.exports = { calcular };
