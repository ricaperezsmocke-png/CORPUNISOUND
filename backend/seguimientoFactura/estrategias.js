// Estrategias del seguimiento por factura (spec §5). Puro: sin base de datos ni reloj.
// Piezas en BigInt diezmilésimas (10000n = 1 pieza); dinero en centavos BigInt. En la salida, texto decimal.

const PIEZA = 10000n;

/** Etapa de una factura con saldo según sus días: null (sin aviso), traslado, margen_75, margen_50, liquidar. */
function etapa(dias, config) {
  if (!Number.isFinite(dias) || dias < 0) return null;
  if (dias >= config.dias_liquidacion) return 'liquidar';
  if (dias >= config.dias_margen_50) return 'margen_50';
  if (dias >= config.dias_margen_75) return 'margen_75';
  if (dias >= config.dias_traslado) return 'traslado';
  return null;
}

const sumaUltimas = (lista, n) => lista.slice(-n).reduce((a, v) => a + v, 0n);

/**
 * ventasPorSemana: { [sucursal_id]: [piezas BigInt por semana completa, de la más vieja a la más reciente] }.
 * Devuelve sumas exactas (BigInt, para comparar sin redondeos) y velocidades por semana como texto (piso).
 */
function velocidades(ventasPorSemana, config) {
  const n8 = config.semanas_ventas, n4 = config.semanas_informativas;
  return Object.fromEntries(Object.entries(ventasPorSemana).map(([sucursal, lista]) => {
    const suma8 = sumaUltimas(lista, n8), suma4 = sumaUltimas(lista, n4);
    return [sucursal, { suma8, suma4, v8: String(suma8 / BigInt(n8)), v4: String(suma4 / BigInt(n4)),
      semanas_con_venta: lista.slice(-n8).filter(v => v > 0n).length }];
  }));
}

const techo = (a, b) => (a + b - 1n) / b;
const piezasEnteras = d => d > 0n ? d / PIEZA * PIEZA : 0n;

/** Lo que el origen puede soltar dejando `semanas_reserva_origen` de su propia venta (reserva redondeada arriba). */
function sobranteOrigen(existencia, vel, config) {
  const reserva = techo(BigInt(config.semanas_reserva_origen) * vel.suma8, BigInt(config.semanas_ventas));
  return existencia - reserva;
}

/** Lo que le falta al destino para `semanas_cobertura_destino`, descontando existencia y tránsito (piso). */
function faltanteDestino(existencia, transito, vel, config) {
  const objetivo = BigInt(config.semanas_cobertura_destino) * vel.suma8 / BigInt(config.semanas_ventas);
  return objetivo - existencia - transito;
}

function esDestinoValido(vOrigen, vDestino, existencia, config) {
  const n = BigInt(config.semanas_ventas);
  return vDestino.suma8 > 0n
    && vDestino.suma8 >= BigInt(config.multiplicador_destino) * vOrigen.suma8
    && vDestino.semanas_con_venta >= config.semanas_con_ventas
    // cobertura = existencia / (suma8 / n) < semanas  ⇔  existencia × n < semanas × suma8
    && existencia * n < BigInt(config.semanas_cobertura_destino) * vDestino.suma8;
}

const insuficiente = de => ({ de, a: null, piezas: null, razon: 'informacion_insuficiente' });
const conDatos = (s, ctx) => ctx.velocidades[s] && ctx.existencias[s] !== undefined && !ctx.atrasadas.has(s);

/**
 * Sugerencias de traslado de UNA clave. saldoViejo: { [origen]: piezas de facturas en etapa de aviso }.
 * Cada pieza se sugiere una sola vez: se descuentan saldo y sobrante del origen y faltante del destino.
 * Solo son candidatas las tiendas con velocidad (incorporadas), existencia conocida y datos al día.
 */
function sugerirTraslados({ saldoViejo, velocidades: vel, existencias, transito = {}, atrasadas = [], config }) {
  const ctx = { velocidades: vel, existencias, atrasadas: new Set(atrasadas.map(Number)) };
  const ids = Object.keys(vel).map(Number);
  const faltaDatos = ids.some(s => !conDatos(s, ctx));
  const faltante = new Map();
  const destinos = ids.filter(s => conDatos(s, ctx))
    .sort((a, b) => (vel[b].suma8 > vel[a].suma8 ? 1 : vel[b].suma8 < vel[a].suma8 ? -1 : a - b));
  const sugerencias = [];
  for (const de of Object.keys(saldoViejo).map(Number).sort((a, b) => a - b)) {
    if (!conDatos(de, ctx)) {
      sugerencias.push(insuficiente(de));
      continue;
    }
    let disponible = [saldoViejo[de], sobranteOrigen(existencias[de], vel[de], config)].reduce((a, b) => a < b ? a : b);
    let propias = 0;
    for (const a of destinos) {
      if (a === de || !esDestinoValido(vel[de], vel[a], existencias[a], config)) continue;
      if (!faltante.has(a)) faltante.set(a, faltanteDestino(existencias[a], transito[a] ?? 0n, vel[a], config));
      const piezas = piezasEnteras([disponible, faltante.get(a)].reduce((x, y) => x < y ? x : y));
      if (piezas <= 0n) continue;
      sugerencias.push({ de, a, piezas: String(piezas), razon: 'destino_vende_mas' });
      disponible -= piezas;
      faltante.set(a, faltante.get(a) - piezas);
      propias++;
    }
    if (!propias && faltaDatos) sugerencias.push(insuficiente(de));
  }
  return sugerencias;
}

function pesos(centavos) {
  const c = BigInt(centavos), signo = c < 0n ? '-' : '', abs = c < 0n ? -c : c;
  const enteros = String(abs / 100n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${signo}$${enteros}.${String(abs % 100n).padStart(2, '0')}`;
}

const PORCENTAJE = { margen_75: 'ganancia_75_porcentaje', margen_50: 'ganancia_50_porcentaje',
  liquidar: 'ganancia_liquidacion_porcentaje' };

/**
 * Texto del aviso de margen. No inventa un precio vigente: el último precio vendido solo sirve de referencia,
 * y el precio de referencia nunca queda abajo del costo (la ganancia conservada se redondea hacia arriba).
 */
function textoMargen({ costo_pieza_centavos, ultimo_precio_centavos, etapa: e, config }) {
  const costo = BigInt(costo_pieza_centavos);
  if (e === 'liquidar' && !BigInt(config.ganancia_liquidacion_porcentaje ?? 0)) {
    return { texto: `Liquidar a costo: ${pesos(costo)} por pieza (sin IVA). No vender abajo de ese costo.`,
      precio_referencia_centavos: null };
  }
  if (!PORCENTAJE[e]) return null;
  const pct = BigInt(config[PORCENTAJE[e]]);
  const regla = `Bajar el precio para conservar el ${pct} % de la ganancia: costo ${pesos(costo)}; `
    + `precio sugerido = costo + ${pct} % de la ganancia actual.`;
  if (ultimo_precio_centavos === undefined || ultimo_precio_centavos === null) {
    return { texto: `${regla} El precio vigente no llega de SICAR: revísalo en SICAR.`, precio_referencia_centavos: null };
  }
  const ultimo = BigInt(ultimo_precio_centavos);
  if (ultimo <= costo) {
    return { texto: `${regla} El último precio vendido (${pesos(ultimo)}, referencia) ya no deja ganancia.`,
      precio_referencia_centavos: null };
  }
  const referencia = costo + techo(pct * (ultimo - costo), 100n);
  return { texto: `${regla} Con el último precio vendido como referencia (${pesos(ultimo)}), serían ${pesos(referencia)}.`,
    precio_referencia_centavos: String(referencia) };
}

/** SICAR cambia el precio por artículo: avisa cuántas piezas recientes del mismo artículo también bajarían. */
function avisoArticuloCompartido(piezasRecientes) {
  if (!piezasRecientes?.length) return null;
  const total = piezasRecientes.reduce((a, p) => a + p.piezas, 0n);
  const dias = piezasRecientes.map(p => p.dias);
  const min = Math.min(...dias), max = Math.max(...dias);
  const enteras = total % PIEZA === 0n ? String(total / PIEZA) : (Number(total) / 10000).toFixed(4);
  const una = total === PIEZA;
  const cuando = min === max ? `hace ${min} días` : `hace entre ${min} y ${max} días`;
  return `Ojo: SICAR cambia el precio por artículo, no por factura. También bajaría el precio de ${enteras} `
    + `${una ? 'pieza comprada' : 'piezas compradas'} ${cuando}.`;
}

module.exports = { etapa, velocidades, sugerirTraslados, textoMargen, avisoArticuloCompartido };
