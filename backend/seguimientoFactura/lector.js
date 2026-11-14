const { aDiezmilesimas } = require('../cantidades');
const { momentoLocal } = require('../fechas');
const { NO_INTERNA } = require('../sicarVentaReal');
const { leerConfig } = require('./config');

const comparar = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const mitadArriba = numerador => (numerador + 5000n) / 10000n;
// El control del rescate se ordena con las ventas por su hora exacta: después de lo de su instante y antes de lo posterior.
const prioridad = { foto: 0, compra: 1, salida: 2, recepcion: 2, venta: 3, control: 3 };
// Foto tomada antes de esta hora local (tienda cerrada): todo lo que SICAR fecha ese día es posterior a la foto.
const HORA_LIMITE_MADRUGADA = '07:00';
const CEDIS = 6;
// Por aclarar que el rescate sí admite en la ventana: salen o entran piezas ciertas, solo sin factura o sin venta.
const ADMITIDOS_EN_VENTANA = ['cuenta_interna', 'origen_no_incorporado'];

function corteLocal(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) throw new Error('Corte de seguimiento inválido.');
  const { fecha, hhmm } = momentoLocal(d);
  // El helper aporta día/hora de México; segundos y milisegundos no cambian por la zona.
  return `${fecha}T${hhmm}:${String(d.getUTCSeconds()).padStart(2, '0')}.${String(d.getUTCMilliseconds()).padStart(3, '0')}`;
}

/** Lo que no depende del corte efectivo; las consultas de cada lector se guardan en `cache` para no repetirlas. */
function leerDatos(sqlite, clave, ahora) {
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
  const limite = leerConfig(sqlite).dias_datos_atrasados * 86400000;
  const atrasadas = [...tiendas.values()].filter(t => !Number.isFinite(Date.parse(t.ultima_recepcion))
    || instante - Date.parse(t.ultima_recepcion) > limite).map(t => t.sucursal_id);
  return { sqlite, clave, tiendas, problemas, atrasadas, cache: {} };
}

/**
 * Una pasada de lectura. `rebajadas` son las tiendas cuyo corte efectivo es el inicio del sistema (rescate); las demás
 * usan su corte real. Sin rebajadas el resultado es exactamente el de siempre.
 */
function contexto(datos, rebajadas = new Set(), inicio = null) {
  const { sqlite, clave, atrasadas, cache } = datos;
  const tiendas = new Map([...datos.tiendas].map(([id, t]) => [id, { ...t, efectivo: rebajadas.has(id) ? inicio : t.local }]));
  const problemas = [...datos.problemas];
  const claveConProblema = problemas.length > 0;
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
  // envios: fecha de envío (sin hora) de cada movimiento de traspaso, para juzgar la ventana sin cambiar su salida.
  return { sqlite, clave, tiendas, problemas, atrasadas, fuentes, fuente, agregar, ordenados, cache,
    rescate: rebajadas.size ? { inicio, rebajadas } : null, envios: new Map(), dudosas: new Set(), horasRecepcion: new Map(),
    sinEntender: [] };
}

function fotosDe(ctx) {
  ctx.cache.fotos ??= ctx.sqlite.prepare(`SELECT f.* FROM seguimiento_foto f
    JOIN seguimiento_tiendas t USING (sucursal_id) WHERE f.clave=?`).all(ctx.clave);
  return ctx.cache.fotos;
}

function leerFotos(ctx) {
  const { tiendas, agregar } = ctx;
  for (const f of fotosDe(ctx)) {
    const t = tiendas.get(f.sucursal_id);
    agregar({ tipo: 'foto', fecha: t.efectivo, sucursal_id: f.sucursal_id, piezas: BigInt(f.piezas_diezmilesimas) });
  }
}

function leerCompras(ctx) {
  const { sqlite, clave, tiendas, fuente, agregar } = ctx;
  const cedis = tiendas.get(CEDIS);
  if (!cedis) return;
  ctx.cache.compras ??= sqlite.prepare(`SELECT c.com_id, c.fecha, c.actualizado_en, d.renglon, d.cantidad,
    CAST(d.factor_diezmilesimas AS TEXT) factor, CAST(d.precio_sin_centavos AS TEXT) precio,
    CAST(d.precio_con_centavos AS TEXT) precio_con, CAST(d.importe_con_centavos AS TEXT) importe_con,
    a.actualizado_en catalogo_al FROM sicar_compras c
    JOIN sicar_compras_detalle d ON d.sucursal_id=c.sucursal_id AND d.com_id=c.com_id
    JOIN sicar_articulos a ON a.sucursal_id=d.sucursal_id AND a.art_id=d.art_id
    WHERE c.sucursal_id=6 AND c.estado='vigente' AND c.fecha > ? AND a.clave=?`).all(cedis.local, clave);
  for (const f of ctx.cache.compras) {
    fuente(f.actualizado_en);
    fuente(f.catalogo_al);
    const cantidad = aDiezmilesimas(f.cantidad), producto = cantidad * BigInt(f.factor);
    const importeCon = f.importe_con == null ? null : BigInt(f.importe_con);
    const m = { tipo: 'compra', fecha: f.fecha, sucursal_id: 6, piezas: mitadArriba(producto),
      valor_centavos: mitadArriba(BigInt(f.precio) * cantidad),
      // Preferir el importe exacto de SICAR; sin él, conservar el cálculo por precio y cantidad.
      valor_con_iva_centavos: importeCon > 0n ? importeCon
        : f.precio_con === null ? null : mitadArriba(BigInt(f.precio_con) * cantidad),
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
    const llave = mostrador ? 'mostrador' : 'cliente';
    ctx.cache[llave] ??= sqlite.prepare(`SELECT v.sucursal_id, v.ven_id, v.fecha_local, d.renglon, d.cantidad, ${interna} interna,
      a.actualizado_en catalogo_al, ${actualizacion} actualizado_en FROM ${ventas} v
      JOIN seguimiento_tiendas t ON t.sucursal_id=v.sucursal_id
      JOIN ${detalles} d ON d.sucursal_id=v.sucursal_id AND d.ven_id=v.ven_id
      JOIN sicar_articulos a ON a.sucursal_id=d.sucursal_id AND a.art_id=d.art_id
      ${envio} WHERE v.estado='vigente' AND a.clave=?`).all(clave);
    for (const f of ctx.cache[llave]) {
      if (f.fecha_local <= tiendas.get(f.sucursal_id).efectivo) continue;
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
  ) SELECT t.*, d.art_id, d.cantidad, CAST(d.precio_sin_centavos AS TEXT) precio_sin,
    CAST(d.precio_con_centavos AS TEXT) precio_con, a.clave, a.actualizado_en catalogo_al FROM claves k
    JOIN sicar_traspasos t ON t.folio=k.folio AND t.suc_origen=k.suc_origen AND t.suc_destino=k.suc_destino
    LEFT JOIN sicar_traspasos_detalle d ON d.sucursal_id=t.sucursal_id AND d.tra_id=t.tra_id
    LEFT JOIN sicar_articulos a ON a.sucursal_id=d.sucursal_id AND a.art_id=d.art_id
    ORDER BY t.folio, t.suc_origen, t.suc_destino, t.sucursal_id, t.tra_id, d.art_id`).all(clave);
  const grupos = new Map();
  for (const f of filas) {
    const llave = JSON.stringify([f.folio, f.suc_origen, f.suc_destino]);
    if (!grupos.has(llave)) grupos.set(llave, new Map());
    const grupo = grupos.get(llave), id = JSON.stringify([f.sucursal_id, f.tra_id]);
    if (!grupo.has(id)) grupo.set(id, { ...f, piezas: 0n, valorSin: 0n, valorCon: 0n, sinCatalogo: false, fuentes: [f.actualizado_en] });
    const punta = grupo.get(id);
    if (!f.clave?.trim()) punta.sinCatalogo = true;
    if (f.clave === clave) {
      const cantidad = aDiezmilesimas(f.cantidad);
      punta.piezas += cantidad;
      // Valor que el propio traspaso de SICAR da a esta clave (precio × cantidad): referencia, no costo de factura.
      punta.valorSin += mitadArriba(BigInt(f.precio_sin ?? 0) * cantidad);
      punta.valorCon += mitadArriba(BigInt(f.precio_con ?? 0) * cantidad);
    }
    if (f.catalogo_al) punta.fuentes.push(f.catalogo_al);
  }
  return [...grupos.values()].map(g => [...g.values()]);
}

function leerTraspasos(ctx) {
  const { sqlite, cache } = ctx;
  cache.mapa ??= new Map(sqlite.prepare('SELECT sicar_sucursal, sucursal_id FROM sicar_sucursales_mapa').all()
    .map(f => [f.sicar_sucursal, f.sucursal_id]));
  cache.grupos ??= gruposTraspasos(ctx);
  const mapa = cache.mapa;
  const repetidos = new Set([...mapa.values()].filter((id, i, ids) => id != null && ids.indexOf(id) !== i));
  for (const grupo of cache.grupos) {
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
  const vistas = [];
  for (const p of grupo) {
    const t = tiendas.get(p.sucursal_id);
    const tipo = p.sucursal_id === traspaso.destino && traspaso.destino !== traspaso.origen ? 'recepcion' : 'salida';
    const fecha = tipo === 'recepcion' ? p.fecha_aplicado : p.fecha;
    if (!t || (fecha && fecha < t.efectivo.slice(0, 10))) continue;
    p.fuentes.forEach(fuente);
    const m = { tipo, fecha, sucursal_id: p.sucursal_id, piezas: p.piezas, estado: p.estado,
      tra_id: p.tra_id, traspaso, por_aclarar: motivo, solo_observacion: true };
    ctx.envios.set(m, p.fecha);
    agregar(m, fecha || p.fecha);
    // Un traspaso cancelado nunca sacó mercancía: se anota la observación de siempre, pero no hay piezas que aclarar.
    if (p.estado !== 'cancelado' && p.piezas > 0n) vistas.push({ tipo, p });
  }
  anotarSinEntender(ctx, traspaso, motivo, vistas);
}

/**
 * Un traspaso que no se entiende, una sola vez por clave y tal como lo dice SICAR: no se atribuye a ninguna factura.
 * Cuentan las puntas de salida; si el origen no manda datos, las de recepción. El valor es el del propio traspaso.
 */
function anotarSinEntender(ctx, traspaso, motivo, vistas) {
  const salidas = vistas.filter(v => v.tipo === 'salida');
  const puntas = (salidas.length ? salidas : vistas).map(v => v.p);
  if (!puntas.length) return;
  const total = campo => puntas.reduce((a, p) => a + p[campo], 0n);
  ctx.sinEntender.push({ motivo, folio: traspaso.folio, fecha: puntas.map(p => p.fecha).sort()[0],
    sicar_origen: traspaso.suc_origen, sicar_destino: traspaso.suc_destino, piezas: total('piezas'),
    valor_sicar_centavos: total('valorSin'), valor_sicar_con_iva_centavos: total('valorCon') });
}

// SICAR fecha los traspasos sin hora: el día del corte solo es dudoso si la foto no fue de madrugada.
function diaDudosoDe(local) {
  if (!local || local.slice(11, 16) < HORA_LIMITE_MADRUGADA) return null;
  return local.slice(0, 10);
}
const diaDudoso = t => diaDudosoDe(t?.efectivo);

function alcancePuntas(tiendas, salida, entrada, traspaso) {
  const ti = tiendas.get(traspaso.origen), td = tiendas.get(traspaso.destino);
  const corteOrigen = ti?.efectivo.slice(0, 10), corteDestino = td?.efectivo.slice(0, 10);
  const fechaEnvio = salida?.fecha ?? entrada.fecha;
  const recibida = entrada?.estado === 'recibido';
  const gris = !!salida && (!td || salida.fecha < corteDestino);
  const usarSalida = !!salida && !!ti && salida.fecha >= corteOrigen;
  const usarEntrada = recibida && !!td && !gris && (!entrada.fecha_aplicado || entrada.fecha_aplicado >= corteDestino);
  const dudosoOrigen = diaDudoso(ti), dudosoDestino = diaDudoso(td);
  return { ti, td, corteOrigen, corteDestino, dudosoOrigen, dudosoDestino, fechaEnvio, recibida, gris, usarSalida, usarEntrada };
}

function problemaEstado(salida, entrada, recibida) {
  if (salida?.sinCatalogo || entrada?.sinCatalogo) return 'catalogo_incompleto';
  if (salida?.estado === 'cancelado' && recibida) return 'origen_cancelado_destino_recibido';
  if (entrada?.estado === 'cancelado' && salida?.estado !== 'cancelado') return 'estados_contradictorios';
}

function problemaFechas(salida, entrada, alcance) {
  const { ti, corteOrigen, dudosoOrigen, dudosoDestino, fechaEnvio, recibida, usarSalida, usarEntrada } = alcance;
  if (recibida && !entrada.fecha_aplicado) return 'sin_fecha_aplicado';
  const esDudoso = (fecha, dudoso) => dudoso !== null && fecha === dudoso;
  if (esDudoso(fechaEnvio, dudosoOrigen) || esDudoso(fechaEnvio, dudosoDestino)) return 'dia_del_corte';
  if (recibida && esDudoso(entrada.fecha_aplicado, dudosoDestino)) return 'dia_del_corte';
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
  if (!usarSalida && !usarEntrada) {
    recepcionAnterior(ctx, salida, entrada, traspaso, alcance);
    return;
  }
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
  for (const m of [ms, me]) if (m) ctx.envios.set(m, fechaEnvio);
  // La punta destino prueba que el envío ya había ocurrido, incluso si esa tienda aún no estaba incorporada.
  if (ms && recibida && salida.fecha.length === 10 && entrada.fecha_aplicado?.length > 10
    && entrada.fecha_aplicado.slice(0, 10) === salida.fecha) {
    ctx.horasRecepcion.set(ms, entrada.fecha_aplicado);
  }
  if (ms) agregar(ms);
  if (me) agregar(me, me.fecha || fechaEnvio);
}

/**
 * Solo con rescate: mercancía que salió ANTES del inicio del sistema (su salida no se sigue) y que la tienda rescatada
 * recibió dentro de su ventana. No es de ninguna factura seguida: entra como anterior, y la foto reconstruida la descuenta.
 */
function recepcionAnterior(ctx, salida, entrada, traspaso, alcance) {
  const { td, gris, recibida, fechaEnvio } = alcance;
  if (!ctx.rescate?.rebajadas.has(traspaso.destino) || !gris || !recibida || !entrada.fecha_aplicado) return;
  if (salida?.estado === 'cancelado' && !recibida) return;
  const lugar = lugarEnVentana(ctx.rescate.inicio, td, entrada.fecha_aplicado);
  if (lugar === 'dudosa') ctx.dudosas.add(td.sucursal_id);
  if (lugar !== 'dentro') return;
  for (const p of [salida, entrada].filter(Boolean)) p.fuentes.forEach(ctx.fuente);
  const motivo = problemaEstado(salida, entrada, recibida);
  const m = { tipo: 'recepcion', fecha: entrada.fecha_aplicado, sucursal_id: entrada.sucursal_id, piezas: entrada.piezas,
    estado: entrada.estado, tra_id: entrada.tra_id, traspaso, anterior: true, ...(motivo ? { por_aclarar: motivo } : {}) };
  ctx.envios.set(m, fechaEnvio);
  ctx.agregar(m);
}

/**
 * Dónde cae una fecha respecto a la ventana (inicio del sistema, corte real de la tienda]. Con hora se compara exacta;
 * sin hora, el día del corte (o del inicio) solo es seguro si esa foto fue de madrugada; si no, es 'dudosa'.
 */
function lugarEnVentana(inicio, t, fecha) {
  if (!fecha) return null;
  if (fecha.length > 10) return fecha <= inicio ? 'antes' : fecha <= t.local ? 'dentro' : 'despues';
  const diaInicio = inicio.slice(0, 10), diaCorte = t.local.slice(0, 10);
  if (fecha < diaInicio) return 'antes';
  if (fecha === diaInicio && diaDudosoDe(inicio)) return 'dudosa';
  if (fecha < diaCorte) return 'dentro';
  if (fecha === diaCorte) return diaDudosoDe(t.local) ? 'dudosa' : 'despues';
  return 'despues';
}

/** Tiendas que pueden rescatarse: incorporadas después del inicio y con mostrador cargado más allá de su corte. */
function tiendasElegibles(datos, inicio) {
  const mostrador = datos.sqlite.prepare(`SELECT 1 FROM sicar_ventas_mostrador
    WHERE sucursal_id=? AND estado IN ('vigente', 'cancelada') AND fecha_local > ? LIMIT 1`);
  return [...datos.tiendas.values()].filter(t => t.sucursal_id !== CEDIS && t.local > inicio
    && mostrador.get(t.sucursal_id, t.local)).map(t => t.sucursal_id);
}

/**
 * Un movimiento frente a la ventana de la tienda s: null si no la toca; si la toca, si falla el rescate y si el motor lo
 * aplica en s antes del control (entonces entra a la foto reconstruida).
 */
function juzgar(ctx, inicio, m, s) {
  const propio = m.sucursal_id === s;
  if (!propio && m.traspaso?.origen !== s && m.traspaso?.destino !== s) return null;
  const t = ctx.tiendas.get(s), lugar = lugarEnVentana(inicio, t, m.fecha);
  const lugares = [lugar, lugarEnVentana(inicio, t, ctx.envios.get(m))];
  if (lugares.includes('dudosa')) return { falla: 'fecha_dudosa_en_ventana', aplica: false };
  const aplica = propio && (lugar === 'dentro' || lugar === 'antes');
  if (!aplica && !lugares.includes('dentro')) return null;
  const falla = m.por_aclarar && !ADMITIDOS_EN_VENTANA.includes(m.por_aclarar) ? 'movimiento_por_aclarar_en_ventana' : null;
  return { falla, aplica: aplica && !m.solo_observacion };
}

/**
 * Revisa cada tienda rebajada: qué movimientos le tocan en su ventana, si alguno es dudoso o por aclarar, y la foto
 * reconstruida = foto real − recepciones + salidas + ventas que el motor aplicará antes del control.
 */
function evaluarRescate(ctx) {
  const { inicio, rebajadas } = ctx.rescate;
  const relevantes = new Set(), fallas = new Map(), ajuste = new Map([...rebajadas].map(s => [s, 0n]));
  const fallar = (s, motivo) => { if (!fallas.has(s)) fallas.set(s, motivo); };
  for (const s of ctx.dudosas) { relevantes.add(s); fallar(s, 'fecha_dudosa_en_ventana'); }
  for (const { m } of ctx.ordenados) {
    if (m.tipo === 'foto') continue;
    for (const s of rebajadas) {
      const juicio = juzgar(ctx, inicio, m, s);
      if (!juicio) continue;
      relevantes.add(s);
      if (juicio.falla) fallar(s, juicio.falla);
      if (juicio.aplica) ajuste.set(s, ajuste.get(s) + (m.tipo === 'recepcion' ? -m.piezas : m.piezas));
    }
  }
  const fotos = new Map(fotosDe(ctx).map(f => [f.sucursal_id, BigInt(f.piezas_diezmilesimas)]));
  const reconstruida = new Map();
  for (const s of rebajadas) {
    const piezas = (fotos.get(s) ?? 0n) + ajuste.get(s);
    if (piezas < 0n) fallar(s, 'foto_negativa');
    reconstruida.set(s, { real: fotos.get(s) ?? 0n, piezas });
  }
  return { relevantes, fallas, reconstruida };
}

/** Cambia la foto de cada tienda rescatada por la reconstruida y agrega su control al corte real. */
function aplicarRescate(ctx, { reconstruida }) {
  const { inicio } = ctx.rescate;
  for (const [s, { real, piezas }] of reconstruida) {
    const foto = ctx.ordenados.find(o => o.m.tipo === 'foto' && o.m.sucursal_id === s);
    if (foto) Object.assign(foto.m, { piezas, reconstruida: true });
    else if (piezas > 0n) ctx.ordenados.push({ m: { tipo: 'foto', fecha: inicio, sucursal_id: s, piezas, reconstruida: true }, fechaOrden: inicio });
    const local = ctx.tiendas.get(s).local;
    ctx.ordenados.push({ m: { tipo: 'control', fecha: local, sucursal_id: s, piezas: real }, fechaOrden: local });
  }
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

/** Adelantar solo las salidas recibidas antes de una compra del mismo día; conservar las fechas y el resto del orden. */
function adelantarSalidas(lista, ctx) {
  const compras = lista.filter(o => o.m.tipo === 'compra');
  const antes = new Map(), movidas = new Set();
  for (const o of lista) {
    const hora = ctx.horasRecepcion.get(o.m);
    if (!hora) continue;
    const compra = compras.find(c => c.m.fecha.slice(0, 10) === o.m.fecha && c.m.fecha > hora);
    if (!compra) continue;
    if (!antes.has(compra)) antes.set(compra, []);
    antes.get(compra).push(o);
    movidas.add(o);
  }
  // La recepción conserva su lugar: adelantar la salida nunca la pone después de su propia recepción.
  return lista.flatMap(o => movidas.has(o) ? [] : [...(antes.get(o) ?? []), o]);
}

/**
 * El orden de siempre va por día y luego por tipo, no por hora. El control del rescate necesita la hora exacta: lo de la
 * tienda posterior a su foto en el mismo día (recepciones con hora, ventas) se mueve detrás del control, sin cambiar su
 * orden entre sí ni el de nada más. Lo sin hora de ese día ya hizo la clave dudosa, así que no llega aquí.
 */
function colocarControles(lista, ctx) {
  const { inicio } = ctx.rescate;
  for (const control of lista.filter(o => o.m.tipo === 'control')) {
    const s = control.m.sucursal_id, t = ctx.tiendas.get(s), dia = control.orden[0];
    const posterior = o => o !== control && o.orden[0] === dia && o.m.sucursal_id === s
      && lugarEnVentana(inicio, t, o.m.fecha) === 'despues';
    const tras = lista.filter(posterior), resto = lista.filter(o => o !== control && !posterior(o));
    const i = resto.findIndex(o => o.orden[0] > dia);
    resto.splice(i < 0 ? resto.length : i, 0, control, ...tras);
    lista = resto;
  }
  return lista;
}

function terminar(ctx, rescate = null) {
  const { fuentes, problemas, atrasadas } = ctx;
  let { ordenados } = ctx;
  for (const o of ordenados) o.orden = camposOrden(o);
  ordenados.sort(compararOrden);
  ordenados = adelantarSalidas(ordenados, ctx);
  if (rescate?.tiendas) ordenados = colocarControles(ordenados, ctx);
  const validas = fuentes.filter(f => Number.isFinite(Date.parse(f)));
  if (validas.length !== fuentes.length) problemas.push({ motivo: 'fuente_sin_fecha', clave: ctx.clave });
  const datos_al = validas.length && validas.length === fuentes.length
    ? validas.reduce((a, b) => Date.parse(a) <= Date.parse(b) ? a : b) : null;
  const resultado = { movimientos: ordenados.map(o => o.m), calidad: {
    datos_al, atrasadas, problemas: [...new Map(problemas.map(p => [JSON.stringify(p), p])).values()],
  }, rescate };
  // Traspasos sin entender: aparte de los movimientos (no mueven piezas) y fuera del JSON de la lectura.
  const llaveSinEntender = s => JSON.stringify([s.fecha, s.folio, s.sicar_origen, s.sicar_destino]);
  Object.defineProperty(resultado, 'sin_entender', {
    value: [...ctx.sinEntender].sort((a, b) => comparar(llaveSinEntender(a), llaveSinEntender(b))) });
  // BigInt en memoria; JSON.stringify(resultado) convierte piezas y centavos a texto, sin tocar BigInt.prototype.
  Object.defineProperty(resultado, 'toJSON', { value() {
    return JSON.parse(JSON.stringify({ movimientos: this.movimientos, calidad: this.calidad, rescate: this.rescate },
      (_clave, valor) => typeof valor === 'bigint' ? valor.toString() : valor));
  } });
  return resultado;
}

function pasada(datos, rebajadas, inicio) {
  const ctx = contexto(datos, rebajadas, inicio);
  leerFotos(ctx);
  leerCompras(ctx);
  leerTraspasos(ctx);
  leerVentas(ctx);
  return ctx;
}

/**
 * Rescate de la ventana de incorporación, todo o nada por clave. Primero rebaja el corte de todas las elegibles para ver
 * cuáles tienen algo en su ventana; luego lee de nuevo rebajando solo esas. Ante cualquier duda: los movimientos de hoy.
 */
function conRescate(datos) {
  const normal = rescate => terminar(pasada(datos), rescate);
  const inicio = datos.tiendas.get(CEDIS)?.local;
  const elegibles = inicio ? tiendasElegibles(datos, inicio) : [];
  if (!elegibles.length) return normal(null);
  let ctx = pasada(datos, new Set(elegibles), inicio);
  let revision = evaluarRescate(ctx);
  if (!revision.relevantes.size) return normal(null);
  if (revision.relevantes.size !== elegibles.length) {
    ctx = pasada(datos, revision.relevantes, inicio);
    revision = evaluarRescate(ctx);
  }
  const [falla] = [...revision.fallas].sort((a, b) => a[0] - b[0]);
  if (falla) return normal({ imposible: falla[1], sucursal_id: falla[0] });
  aplicarRescate(ctx, revision);
  const resultado = terminar(ctx, { desde: inicio, tiendas: [...ctx.rescate.rebajadas].sort((a, b) => a - b) });
  // Si el motor rechaza el rescate, los movimientos de hoy salen de los mismos datos ya leídos (misma instantánea, sin SQL).
  Object.defineProperty(resultado, 'sinRescate', { value: () => normal(null) });
  return resultado;
}

/**
 * Solo lectura y una instantánea consistente. Piezas y valor_centavos son BigInt; en JSON son strings.
 * Con `rescate: true` intenta el rescate de la ventana (ver conRescate); `rescate` del resultado dice qué pasó.
 */
function movimientosPorClave(sqlite, clave, { ahora = new Date().toISOString(), rescate = false } = {}) {
  return sqlite.transaction(() => {
    const datos = leerDatos(sqlite, clave, ahora);
    return rescate ? conRescate(datos) : terminar(pasada(datos), null);
  })();
}

module.exports = { movimientosPorClave, corteLocal };
