const { aDiezmilesimas } = require('../cantidades');
const { momentoLocal } = require('../fechas');
const { NO_INTERNA } = require('../sicarVentaReal');
const { leerConfig } = require('./config');

const comparar = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const mitadArriba = numerador => (numerador + 5000n) / 10000n;
const prioridad = { foto: 0, compra: 1, salida: 2, recepcion: 2, venta: 3 };

function corteLocal(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) throw new Error('Corte de seguimiento inválido.');
  const { fecha, hhmm } = momentoLocal(d);
  // El helper aporta día/hora de México; segundos y milisegundos no cambian por la zona.
  return `${fecha}T${hhmm}:${String(d.getUTCSeconds()).padStart(2, '0')}.${String(d.getUTCMilliseconds()).padStart(3, '0')}`;
}

function contexto(sqlite, clave, ahora) {
  const instante = new Date(ahora).getTime();
  if (!Number.isFinite(instante)) throw new Error('Ahora debe ser una fecha válida.');
  const tiendas = new Map(sqlite.prepare(`SELECT t.sucursal_id, t.corte, s.ultima_recepcion
    FROM seguimiento_tiendas t LEFT JOIN sicar_tiendas s USING (sucursal_id) ORDER BY t.sucursal_id`).all()
    .map(t => [t.sucursal_id, { ...t, local: corteLocal(t.corte) }]));
  const problemas = sqlite.prepare(`SELECT p.* FROM seguimiento_foto_problemas p
    JOIN seguimiento_tiendas t USING (sucursal_id) WHERE p.clave=? ORDER BY p.sucursal_id, p.motivo`).all(clave);
  const repetidas = sqlite.prepare(`SELECT a.sucursal_id FROM sicar_articulos a
    JOIN seguimiento_tiendas t USING (sucursal_id) WHERE a.clave=? GROUP BY a.sucursal_id HAVING count(*)>1`).all(clave);
  for (const { sucursal_id } of repetidas) problemas.push({ sucursal_id, clave, motivo: 'clave_repetida' });
  const claveConProblema = problemas.length > 0;
  const limite = leerConfig(sqlite).dias_datos_atrasados * 86400000;
  const atrasadas = [...tiendas.values()].filter(t => !Number.isFinite(Date.parse(t.ultima_recepcion))
    || instante - Date.parse(t.ultima_recepcion) > limite).map(t => t.sucursal_id);
  const fuentes = [], ordenados = [];
  const tiendasUsadas = new Set();
  function fuente(fecha) { fuentes.push(fecha); }
  function agregar(m, fechaOrden = m.fecha) {
    if (!tiendasUsadas.has(m.sucursal_id)) {
      const t = tiendas.get(m.sucursal_id);
      // El corte es un punto fijo del pasado (la foto de arranque): no mide qué tan frescos están los datos.
      fuente(t.ultima_recepcion);
      tiendasUsadas.add(m.sucursal_id);
    }
    if (claveConProblema) {
      if (m.por_aclarar) problemas.push({ sucursal_id: m.sucursal_id, clave, motivo: m.por_aclarar });
      m.por_aclarar = 'clave_con_problema';
      delete m.piezas_por_aclarar; // La incertidumbre ahora abarca el movimiento completo.
    }
    if (m.por_aclarar) problemas.push({ sucursal_id: m.sucursal_id, clave, motivo: m.por_aclarar });
    ordenados.push({ m, fechaOrden });
  }
  return { sqlite, clave, tiendas, problemas, atrasadas, fuentes, fuente, agregar, ordenados };
}

function leerFotos(ctx) {
  const { sqlite, clave, tiendas, fuente, agregar } = ctx;
  for (const f of sqlite.prepare(`SELECT f.* FROM seguimiento_foto f
    JOIN seguimiento_tiendas t USING (sucursal_id) WHERE f.clave=?`).all(clave)) {
    const t = tiendas.get(f.sucursal_id);
    agregar({ tipo: 'foto', fecha: t.local, sucursal_id: f.sucursal_id, piezas: BigInt(f.piezas_diezmilesimas) });
  }
}

function leerCompras(ctx) {
  const { sqlite, clave, tiendas, fuente, agregar } = ctx;
  const cedis = tiendas.get(6);
  if (!cedis) return;
  const filas = sqlite.prepare(`SELECT c.com_id, c.fecha, c.actualizado_en, d.renglon, d.cantidad,
    CAST(d.factor_diezmilesimas AS TEXT) factor, CAST(d.precio_sin_centavos AS TEXT) precio,
    CAST(d.precio_con_centavos AS TEXT) precio_con, a.actualizado_en catalogo_al FROM sicar_compras c
    JOIN sicar_compras_detalle d ON d.sucursal_id=c.sucursal_id AND d.com_id=c.com_id
    JOIN sicar_articulos a ON a.sucursal_id=d.sucursal_id AND a.art_id=d.art_id
    WHERE c.sucursal_id=6 AND c.estado='vigente' AND c.fecha > ? AND a.clave=?`).all(cedis.local, clave);
  for (const f of filas) {
    fuente(f.actualizado_en);
    fuente(f.catalogo_al);
    const cantidad = aDiezmilesimas(f.cantidad), producto = cantidad * BigInt(f.factor);
    const m = { tipo: 'compra', fecha: f.fecha, sucursal_id: 6, piezas: mitadArriba(producto),
      valor_centavos: mitadArriba(BigInt(f.precio) * cantidad),
      // Con IVA solo si SICAR lo trae: nunca se inventa multiplicando por 1.16.
      valor_con_iva_centavos: f.precio_con === null ? null : mitadArriba(BigInt(f.precio_con) * cantidad),
      lote: { sucursal_id: 6, com_id: f.com_id, renglon: f.renglon } };
    if (producto % 10000n !== 0n) m.por_aclarar = 'cantidad_fraccionaria';
    agregar(m);
  }
}

function leerVentas(ctx) {
  const { sqlite, clave, tiendas, fuente, agregar } = ctx;
  for (const mostrador of [false, true]) {
    const detalles = mostrador ? 'sicar_detalles_mostrador' : 'sicar_detalles';
    const ventas = mostrador ? 'sicar_ventas_mostrador' : 'sicar_ventas';
    const actualizacion = mostrador ? 'v.actualizado_en' : 'e.fecha';
    // revision es la secuencia de ingesta, NO una fecha. El envío conserva la fecha de esa revisión.
    const envio = mostrador ? '' : `LEFT JOIN sicar_envios e
      ON e.sucursal_id=v.sucursal_id AND e.secuencia=v.revision AND e.hash=v.hash`;
    // Las ventas a cuentas internas sí sacan mercancía de la tienda: se leen, pero quedan por aclarar (no vendidas).
    const interna = mostrador ? '0' : `NOT (${NO_INTERNA('v')})`;
    const filas = sqlite.prepare(`SELECT v.sucursal_id, v.ven_id, v.fecha_local, d.renglon, d.cantidad, ${interna} interna,
      a.actualizado_en catalogo_al, ${actualizacion} actualizado_en FROM ${ventas} v
      JOIN seguimiento_tiendas t ON t.sucursal_id=v.sucursal_id
      JOIN ${detalles} d ON d.sucursal_id=v.sucursal_id AND d.ven_id=v.ven_id
      JOIN sicar_articulos a ON a.sucursal_id=d.sucursal_id AND a.art_id=d.art_id
      ${envio} WHERE v.estado='vigente' AND a.clave=?`).all(clave);
    for (const f of filas) {
      if (f.fecha_local <= tiendas.get(f.sucursal_id).local) continue;
      fuente(f.actualizado_en);
      fuente(f.catalogo_al);
      agregar({ tipo: 'venta', fecha: f.fecha_local, sucursal_id: f.sucursal_id, piezas: aDiezmilesimas(f.cantidad),
        ven_id: f.ven_id, renglon: f.renglon, fuente: mostrador ? 'mostrador' : 'cliente',
        ...(f.interna ? { por_aclarar: 'cuenta_interna' } : {}) });
    }
  }
}

function gruposTraspasos({ sqlite, clave }) {
  // Seleccionar por la clave de cualquiera de las puntas, luego recuperar AMBAS, incluso si su catálogo falta.
  const filas = sqlite.prepare(`WITH claves AS (
    SELECT DISTINCT t.folio, t.suc_origen, t.suc_destino FROM sicar_traspasos t
    JOIN sicar_traspasos_detalle d ON d.sucursal_id=t.sucursal_id AND d.tra_id=t.tra_id
    JOIN sicar_articulos a ON a.sucursal_id=d.sucursal_id AND a.art_id=d.art_id WHERE a.clave=?
  ) SELECT t.*, d.art_id, d.cantidad, a.clave, a.actualizado_en catalogo_al FROM claves k
    JOIN sicar_traspasos t ON t.folio=k.folio AND t.suc_origen=k.suc_origen AND t.suc_destino=k.suc_destino
    LEFT JOIN sicar_traspasos_detalle d ON d.sucursal_id=t.sucursal_id AND d.tra_id=t.tra_id
    LEFT JOIN sicar_articulos a ON a.sucursal_id=d.sucursal_id AND a.art_id=d.art_id
    ORDER BY t.folio, t.suc_origen, t.suc_destino, t.sucursal_id, t.tra_id, d.art_id`).all(clave);
  const grupos = new Map();
  for (const f of filas) {
    const llave = JSON.stringify([f.folio, f.suc_origen, f.suc_destino]);
    if (!grupos.has(llave)) grupos.set(llave, new Map());
    const grupo = grupos.get(llave), id = JSON.stringify([f.sucursal_id, f.tra_id]);
    if (!grupo.has(id)) grupo.set(id, { ...f, piezas: 0n, sinCatalogo: false, fuentes: [f.actualizado_en] });
    const punta = grupo.get(id);
    if (!f.clave?.trim()) punta.sinCatalogo = true;
    if (f.clave === clave) punta.piezas += aDiezmilesimas(f.cantidad);
    if (f.catalogo_al) punta.fuentes.push(f.catalogo_al);
  }
  return [...grupos.values()].map(g => [...g.values()]);
}

function leerTraspasos(ctx) {
  const { sqlite } = ctx;
  const mapa = new Map(sqlite.prepare('SELECT sicar_sucursal, sucursal_id FROM sicar_sucursales_mapa').all()
    .map(f => [f.sicar_sucursal, f.sucursal_id]));
  const repetidos = new Set([...mapa.values()].filter((id, i, ids) => id != null && ids.indexOf(id) !== i));
  for (const grupo of gruposTraspasos(ctx)) {
    const f = grupo[0], origen = mapa.get(f.suc_origen) ?? null, destino = mapa.get(f.suc_destino) ?? null;
    const traspaso = { origen, destino, folio: f.folio, suc_origen: f.suc_origen, suc_destino: f.suc_destino };
    const salidas = grupo.filter(p => p.sucursal_id === origen), entradas = grupo.filter(p => p.sucursal_id === destino);
    let motivo;
    if (origen === null || destino === null) motivo = 'sin_mapa';
    else if (origen === destino || repetidos.has(origen) || repetidos.has(destino)
      || grupo.some(p => p.sucursal_id !== origen && p.sucursal_id !== destino)) motivo = 'mapa_contradictorio';
    else if (salidas.length > 1 || entradas.length > 1) motivo = 'folio_ambiguo';
    if (motivo) {
      agregarObservaciones(ctx, grupo, traspaso, motivo);
      continue;
    }
    procesarPuntas(ctx, salidas[0], entradas[0], traspaso);
  }
}

function agregarObservaciones(ctx, grupo, traspaso, motivo) {
  const { tiendas, fuente, agregar } = ctx;
  // No elegir una coincidencia: estas observaciones no autorizan al motor a mover piezas.
  for (const p of grupo) {
    const t = tiendas.get(p.sucursal_id);
    const tipo = p.sucursal_id === traspaso.destino && traspaso.destino !== traspaso.origen ? 'recepcion' : 'salida';
    const fecha = tipo === 'recepcion' ? p.fecha_aplicado : p.fecha;
    if (!t || (fecha && fecha < t.local.slice(0, 10))) continue;
    p.fuentes.forEach(fuente);
    agregar({ tipo, fecha, sucursal_id: p.sucursal_id, piezas: p.piezas, estado: p.estado,
      tra_id: p.tra_id, traspaso, por_aclarar: motivo, solo_observacion: true }, fecha || p.fecha);
  }
}

function alcancePuntas(tiendas, salida, entrada, traspaso) {
  const ti = tiendas.get(traspaso.origen), td = tiendas.get(traspaso.destino);
  const corteOrigen = ti?.local.slice(0, 10), corteDestino = td?.local.slice(0, 10);
  const fechaEnvio = salida?.fecha ?? entrada.fecha;
  const recibida = entrada?.estado === 'recibido';
  const gris = !!salida && (!td || salida.fecha < corteDestino);
  const usarSalida = !!salida && !!ti && salida.fecha >= corteOrigen;
  const usarEntrada = recibida && !!td && !gris && (!entrada.fecha_aplicado || entrada.fecha_aplicado >= corteDestino);
  return { ti, corteOrigen, corteDestino, fechaEnvio, recibida, gris, usarSalida, usarEntrada };
}

function problemaEstado(salida, entrada, recibida) {
  if (salida?.sinCatalogo || entrada?.sinCatalogo) return 'catalogo_incompleto';
  if (salida?.estado === 'cancelado' && recibida) return 'origen_cancelado_destino_recibido';
  if (entrada?.estado === 'cancelado' && salida?.estado !== 'cancelado') return 'estados_contradictorios';
}

function problemaFechas(salida, entrada, alcance) {
  const { ti, corteOrigen, corteDestino, fechaEnvio, recibida, usarSalida, usarEntrada } = alcance;
  if (recibida && !entrada.fecha_aplicado) return 'sin_fecha_aplicado';
  if (fechaEnvio === corteOrigen || fechaEnvio === corteDestino) return 'dia_del_corte';
  if (recibida && entrada.fecha_aplicado === corteDestino) return 'dia_del_corte';
  if (recibida && entrada.fecha_aplicado < fechaEnvio) return 'recepcion_anterior_salida';
  if (!usarEntrada) return;
  // Origen sin agente/no incorporado primero: su SICAR no manda la salida, así que tampoco hay punta de origen.
  // También si el envío es anterior al corte del origen: entonces el origen aún no estaba en el seguimiento
  // (su foto ya no tenía esas piezas). Así incorporar el origen después no borra una devolución histórica.
  if (!ti || fechaEnvio < corteOrigen) return 'origen_no_incorporado';
  if (!salida) return 'sin_punta_origen';
  if (!usarSalida) return 'salida_anterior_corte';
}

function marcarDiferencia(salida, recepcion) {
  if (salida.piezas === recepcion.piezas) return;
  // Solo la diferencia es incierta; conservar las cantidades observadas sin inventar recepciones.
  const menor = recepcion.piezas < salida.piezas, afectado = menor ? salida : recepcion;
  afectado.por_aclarar = menor ? 'recepcion_menor' : 'recepcion_mayor';
  afectado.piezas_por_aclarar = menor ? salida.piezas - recepcion.piezas : recepcion.piezas - salida.piezas;
}

function procesarPuntas(ctx, salida, entrada, traspaso) {
  const { tiendas, fuente, agregar } = ctx;
  const alcance = alcancePuntas(tiendas, salida, entrada, traspaso);
  const { gris, usarSalida, usarEntrada, recibida, fechaEnvio } = alcance;
  if (!usarSalida && !usarEntrada) return;
  // Cancelado en el origen y nadie lo recibió: la mercancía nunca salió. No va a tránsito ni a gris.
  if (salida?.estado === 'cancelado' && !recibida) return;
  for (const p of [salida, entrada].filter(Boolean)) p.fuentes.forEach(fuente);
  const motivo = problemaEstado(salida, entrada, recibida) || problemaFechas(salida, entrada, alcance);
  const movimiento = (p, tipo, fecha) => ({ tipo, fecha, sucursal_id: p.sucursal_id, piezas: p.piezas,
    estado: p.estado, tra_id: p.tra_id, traspaso, ...(motivo ? { por_aclarar: motivo } : {}) });
  const ms = usarSalida ? movimiento(salida, 'salida', salida.fecha) : null;
  const me = usarEntrada ? movimiento(entrada, 'recepcion', entrada.fecha_aplicado) : null;
  if (ms) ms.sin_agente = gris;
  if (!motivo && !gris && ms && me) marcarDiferencia(ms, me);
  if (ms) agregar(ms);
  if (me) agregar(me, me.fecha || fechaEnvio);
}

function camposOrden({ m, fechaOrden }) {
  return [fechaOrden.slice(0, 10), prioridad[m.tipo], fechaOrden, m.traspaso ? JSON.stringify(m.traspaso) : '',
    m.tipo === 'recepcion' ? 1 : 0, m.sucursal_id, m.lote?.com_id ?? m.ven_id ?? m.tra_id ?? '', m.lote?.renglon ?? m.renglon ?? 0];
}

function compararOrden(a, b) {
  for (let i = 0; i < a.orden.length; i++) {
    const diferencia = comparar(a.orden[i], b.orden[i]);
    if (diferencia) return diferencia;
  }
  return 0;
}

function terminar(ctx) {
  const { ordenados, fuentes, problemas, atrasadas } = ctx;
  for (const o of ordenados) o.orden = camposOrden(o);
  ordenados.sort(compararOrden);
  const validas = fuentes.filter(f => Number.isFinite(Date.parse(f)));
  if (validas.length !== fuentes.length) problemas.push({ motivo: 'fuente_sin_fecha', clave: ctx.clave });
  const datos_al = validas.length && validas.length === fuentes.length
    ? validas.reduce((a, b) => Date.parse(a) <= Date.parse(b) ? a : b) : null;
  const resultado = { movimientos: ordenados.map(o => o.m), calidad: {
    datos_al, atrasadas, problemas: [...new Map(problemas.map(p => [JSON.stringify(p), p])).values()],
  } };
  // BigInt en memoria; JSON.stringify(resultado) convierte piezas y centavos a texto, sin tocar BigInt.prototype.
  Object.defineProperty(resultado, 'toJSON', { value() {
    return JSON.parse(JSON.stringify({ movimientos: this.movimientos, calidad: this.calidad },
      (_clave, valor) => typeof valor === 'bigint' ? valor.toString() : valor));
  } });
  return resultado;
}

/** Solo lectura y una instantánea consistente. Piezas y valor_centavos son BigInt; en JSON son strings. */
function movimientosPorClave(sqlite, clave, { ahora = new Date().toISOString() } = {}) {
  return sqlite.transaction(() => {
    const ctx = contexto(sqlite, clave, ahora);
    leerFotos(ctx);
    leerCompras(ctx);
    leerTraspasos(ctx);
    leerVentas(ctx);
    return terminar(ctx);
  })();
}

module.exports = { movimientosPorClave, corteLocal };
