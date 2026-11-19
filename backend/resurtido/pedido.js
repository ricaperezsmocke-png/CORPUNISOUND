// Pedido al proveedor con visto bueno por tienda y aprobación. El sistema no manda nada al proveedor ni escribe en SICAR,
// y no mueve inventario ni dinero en CORPUNISOUND: lo que llega se lee de los traspasos de SICAR.
const { fechaLocal } = require('../fechas');
const { MARCAS, leerConfig } = require('./config');
const { armar, sobrantesActuales } = require('./consultas');
const { asignarLlegadas } = require('./llegadas');
const { DIAS_EN_CAMINO } = require('./sugerido');
const error = (status, mensaje) => Object.assign(new Error(mensaje), { status });
const PIEZA = 10000;

// Redondea el total de una clave hacia arriba al empaque confirmado. El sobrante va a la tienda que más vende hasta su
// máximo (holgura), luego a la siguiente; si todas llegaron a su máximo, el resto a la que más vende (CEDIS no guarda).
function repartirEmpaque(tiendas, empaque) {
  const r = tiendas.map(t => ({ ...t }));
  if (!(empaque > 0) || !r.length) return r;
  const total = r.reduce((n, t) => n + t.pedido, 0);
  let sobrante = Math.ceil(total / empaque) * empaque - total;
  const orden = [...r].sort((a, b) => b.venta - a.venta || a.sucursal_id - b.sucursal_id);
  for (const t of orden) {
    if (sobrante <= 0) break;
    const toma = Math.min(sobrante, Math.max(0, Math.floor(t.holgura / PIEZA) * PIEZA));
    t.pedido += toma; sobrante -= toma;
  }
  if (sobrante > 0) orden[0].pedido += sobrante;
  return r;
}

// Solo un empaque confirmado por una persona redondea; una sugerencia sin confirmar no.
function empaquesConfirmados(sqlite) {
  return new Map(sqlite.prepare('SELECT clave, tamano_diezmilesimas FROM resurtido_empaques WHERE confirmado_por IS NOT NULL')
    .all().map(e => [e.clave, e.tamano_diezmilesimas]));
}

const historial = (sqlite, datos) => sqlite.prepare(`INSERT INTO resurtido_pedido_historial
  (pedido_id, sucursal_id, clave, accion, antes, despues, motivo, actor, fecha) VALUES (?,?,?,?,?,?,?,?,?)`)
  .run(datos.pedido_id, datos.sucursal_id ?? null, datos.clave ?? null, datos.accion, datos.antes ?? null,
    datos.despues ?? null, datos.motivo ?? null, String(datos.actor), datos.fecha);

// Renglones por tienda y clave con las mismas reglas que el sugerido de solo lectura (armar/calcularSugerido).
function renglonesSugeridos(sqlite, marca, ahora) {
  const { filas, tiendas_atrasadas } = armar(sqlite, null, ahora);
  const empaques = empaquesConfirmados(sqlite), porClave = new Map();
  for (const f of filas) {
    if (f.marca !== marca || !(f.sugerido > 0)) continue;
    if (!porClave.has(f.clave)) porClave.set(f.clave, []);
    porClave.get(f.clave).push({ sucursal_id: f.sucursal_id, clave: f.clave, descripcion: f.descripcion, sugerido: f.sugerido,
      pedido: f.sugerido, venta: f.venta_mes, holgura: f.maximo - Math.max(f.existencia, 0) - f.en_camino - f.sugerido });
  }
  const renglones = [...porClave].flatMap(([clave, tiendas]) => repartirEmpaque(tiendas, empaques.get(clave)));
  return { renglones, tiendas_atrasadas };
}

function insertarPedido(sqlite, { marca, tipo, periodo, llave, actor, ahora, tiendas_atrasadas = [], aviso_id = null }, renglones) {
  const { lastInsertRowid } = sqlite.prepare(`INSERT INTO resurtido_pedidos
    (marca, tipo, periodo, llave, estado, creado_en, creado_por, tiendas_atrasadas, aviso_id) VALUES (?,?,?,?,'borrador',?,?,?,?)`)
    .run(marca, tipo, periodo, llave, ahora, String(actor), JSON.stringify(tiendas_atrasadas), aviso_id);
  const pedido_id = Number(lastInsertRowid);
  const insertar = sqlite.prepare(`INSERT INTO resurtido_pedido_renglones (pedido_id, sucursal_id, clave, descripcion, sugerido, pedido)
    VALUES (?,?,?,?,?,?)`);
  for (const r of renglones) insertar.run(pedido_id, r.sucursal_id, r.clave, r.descripcion, r.sugerido, r.pedido);
  historial(sqlite, { pedido_id, accion: 'crear', despues: renglones.length, actor, fecha: ahora,
    motivo: tipo === 'extra' ? `Pedido extra del aviso ${aviso_id}` : null });
  return pedido_id;
}

// Borrador mensual por marca. Llave única marca+periodo+tipo: el ciclo y el botón "Armar borrador ahora" no duplican.
// Con pedidos pausados (tras restaurar un respaldo) el ciclo no crea nada y el botón responde 409.
function armarBorrador(sqlite, marca, ahora = new Date().toISOString(), { actor = 'sistema', manual = false } = {}) {
  if (!MARCAS.includes(marca)) throw error(400, 'Elige la marca: JR o SOLCOR.');
  const periodo = fechaLocal(ahora).slice(0, 7), llave = `${marca}:${periodo}:mensual`;
  return sqlite.transaction(() => {
    const existente = sqlite.prepare('SELECT id FROM resurtido_pedidos WHERE llave=?').get(llave);
    if (existente) return { pedido_id: existente.id, creado: false };
    if (leerConfig(sqlite).pedidos_pausados) {
      if (manual) throw error(409, 'Los pedidos están pausados porque se restauró un respaldo. Reactívalos primero.');
      return null;
    }
    const { renglones, tiendas_atrasadas } = renglonesSugeridos(sqlite, marca, ahora);
    const pedido_id = insertarPedido(sqlite, { marca, tipo: 'mensual', periodo, llave, actor, ahora, tiendas_atrasadas }, renglones);
    return { pedido_id, creado: true };
  }).immediate();
}

const EDITABLES = ['borrador', 'en_revision'];
function leerPedido(sqlite, pedido_id) {
  const id = Number(pedido_id);
  const p = Number.isSafeInteger(id) ? sqlite.prepare('SELECT * FROM resurtido_pedidos WHERE id=?').get(id) : null;
  if (!p) throw error(404, 'Pedido no encontrado.');
  return p;
}
function editable(sqlite, pedido_id) {
  const p = leerPedido(sqlite, pedido_id);
  if (!EDITABLES.includes(p.estado)) throw error(409, 'El pedido ya fue aprobado: no se puede cambiar.');
  return p;
}
const renglonesTienda = (sqlite, pedido_id, suc) => sqlite.prepare(`SELECT * FROM resurtido_pedido_renglones
  WHERE pedido_id=? AND sucursal_id=? AND estado='activo'`).all(pedido_id, suc);

function validarCambios(cambios, renglones) {
  if (!Array.isArray(cambios)) throw error(400, 'Cambios inválidos.');
  const porClave = new Map(renglones.map(r => [r.clave, r]));
  const vistas = new Set();
  return cambios.map(c => {
    const r = porClave.get(c?.clave);
    if (!r) throw error(400, 'Ese producto no está en el pedido de tu tienda.');
    if (vistas.has(c.clave)) throw error(400, `La clave ${c.clave} está repetida.`);
    vistas.add(c.clave);
    if (!Number.isSafeInteger(c.pedido) || c.pedido < 0 || !Number.isSafeInteger(c.pedido * PIEZA)) {
      throw error(400, 'La cantidad debe ser de piezas enteras, cero o más.');
    }
    const motivo = typeof c.motivo === 'string' ? c.motivo.trim() : '';
    if (motivo.length > 200) throw error(400, 'El motivo no puede pasar de 200 caracteres.');
    const nuevo = c.pedido * PIEZA, marcado = nuevo > 2 * r.sugerido;
    // Contra abuso: subir más del doble de lo sugerido exige explicar por qué, y quien aprueba lo ve marcado.
    if (marcado && nuevo > r.pedido && motivo.length < 3) {
      throw error(400, `Para pedir más del doble de lo sugerido de ${r.clave} escribe el motivo (3 caracteres o más).`);
    }
    return { r, nuevo, motivo, marcado };
  });
}

function aplicarCambios(sqlite, p, suc, cambios, actor, ahora) {
  const renglones = renglonesTienda(sqlite, p.id, suc);
  if (!renglones.length) throw error(404, 'Tu tienda no tiene renglones en este pedido.');
  const validos = validarCambios(cambios, renglones);
  let cambio = false;
  for (const { r, nuevo, motivo, marcado } of validos) {
    if (nuevo === r.pedido) continue;
    cambio = true;
    sqlite.prepare(`UPDATE resurtido_pedido_renglones SET pedido=?, marcado=?, motivo_cambio=?
      WHERE pedido_id=? AND sucursal_id=? AND clave=?`)
      .run(nuevo, marcado ? 1 : 0, motivo || (marcado ? r.motivo_cambio : null), p.id, suc, r.clave);
    historial(sqlite, { pedido_id: p.id, sucursal_id: suc, clave: r.clave, accion: 'cambiar', antes: r.pedido, despues: nuevo,
      motivo: motivo || null, actor, fecha: ahora });
  }
  // Cambiar después del visto bueno lo anula: la tienda tiene que volver a darlo.
  if (cambio && renglones.some(r => r.visto_bueno_por)) {
    sqlite.prepare(`UPDATE resurtido_pedido_renglones SET visto_bueno_por=NULL, visto_bueno_en=NULL
      WHERE pedido_id=? AND sucursal_id=?`).run(p.id, suc);
    historial(sqlite, { pedido_id: p.id, sucursal_id: suc, accion: 'anular_visto_bueno', actor, fecha: ahora });
  }
  return cambio;
}

function cambiarRenglones(sqlite, pedido_id, sucursal_id, cambios, actor, ahora = new Date().toISOString()) {
  return sqlite.transaction(() => {
    const p = editable(sqlite, pedido_id);
    return { ok: true, cambio: aplicarCambios(sqlite, p, Number(sucursal_id), cambios, actor, ahora) };
  }).immediate();
}

function vistoBuenoTienda(sqlite, pedido_id, sucursal_id, cambios = [], actor, ahora = new Date().toISOString()) {
  return sqlite.transaction(() => {
    const p = editable(sqlite, pedido_id), suc = Number(sucursal_id);
    aplicarCambios(sqlite, p, suc, cambios, actor, ahora);
    sqlite.prepare(`UPDATE resurtido_pedido_renglones SET visto_bueno_por=?, visto_bueno_en=?
      WHERE pedido_id=? AND sucursal_id=? AND estado='activo'`).run(String(actor), ahora, p.id, suc);
    sqlite.prepare("UPDATE resurtido_pedidos SET estado='en_revision' WHERE id=?").run(p.id);
    historial(sqlite, { pedido_id: p.id, sucursal_id: suc, accion: 'visto_bueno', actor, fecha: ahora });
    return { ok: true };
  }).immediate();
}

// Exige el visto bueno de todas las tiendas con renglones. Pasado el plazo (dias_visto_bueno desde que se armó), aprueba
// con las tiendas listas y las demás salen de este pedido como fuera de tiempo (pueden ir en un pedido extra).
function aprobar(sqlite, pedido_id, actor, ahora = new Date().toISOString()) {
  return sqlite.transaction(() => {
    const p = editable(sqlite, pedido_id);
    const tiendas = sqlite.prepare(`SELECT sucursal_id, MIN(visto_bueno_por IS NOT NULL) listo FROM resurtido_pedido_renglones
      WHERE pedido_id=? AND estado='activo' GROUP BY sucursal_id ORDER BY sucursal_id`).all(p.id);
    const faltan = tiendas.filter(x => !x.listo).map(x => x.sucursal_id);
    if (!tiendas.some(x => x.listo)) throw error(409, 'Ninguna tienda ha dado su visto bueno.');
    const plazo = Date.parse(p.creado_en) + leerConfig(sqlite).dias_visto_bueno * 86400000;
    if (faltan.length && Date.parse(ahora) < plazo) {
      throw error(409, `Faltan vistos buenos de ${faltan.length} tienda(s). Vence el plazo el ${new Date(plazo).toISOString()}.`);
    }
    for (const suc of faltan) {
      sqlite.prepare("UPDATE resurtido_pedido_renglones SET estado='fuera_de_tiempo' WHERE pedido_id=? AND sucursal_id=?").run(p.id, suc);
      historial(sqlite, { pedido_id: p.id, sucursal_id: suc, accion: 'fuera_de_tiempo', actor, fecha: ahora });
    }
    const empaques = empaquesConfirmados(sqlite);
    const totales = sqlite.prepare(`SELECT clave, SUM(pedido) total FROM resurtido_pedido_renglones
      WHERE pedido_id=? AND estado='activo' GROUP BY clave`).all(p.id);
    for (const { clave, total } of totales) {
      const rollo = empaques.get(clave);
      if (rollo && total % rollo !== 0) throw error(409, `La clave ${clave} requiere rollos completos de ${rollo / PIEZA}.`);
    }
    sqlite.prepare("UPDATE resurtido_pedidos SET estado='aprobado', aprobado_por=?, aprobado_en=? WHERE id=?").run(String(actor), ahora, p.id);
    const marcados = sqlite.prepare("SELECT COUNT(*) n FROM resurtido_pedido_renglones WHERE pedido_id=? AND estado='activo' AND marcado=1")
      .get(p.id).n;
    historial(sqlite, { pedido_id: p.id, accion: 'aprobar', despues: marcados, actor, fecha: ahora });
    return { ok: true, fuera_de_tiempo: faltan, marcados };
  }).immediate();
}

// El sistema no manda nada: solo registra que una persona ya mandó el pedido al proveedor.
function registrarEnvio(sqlite, pedido_id, datos = {}, actor, ahora = new Date().toISOString()) {
  const referencia = typeof datos?.referencia === 'string' ? datos.referencia.trim() : '';
  if (referencia.length > 200) throw error(400, 'La referencia no puede pasar de 200 caracteres.');
  return sqlite.transaction(() => {
    const p = leerPedido(sqlite, pedido_id);
    if (p.estado !== 'aprobado') throw error(409, 'Solo un pedido aprobado y no enviado se puede marcar como enviado.');
    sqlite.prepare("UPDATE resurtido_pedidos SET estado='enviado', enviado_por=?, enviado_en=?, referencia_envio=? WHERE id=?")
      .run(String(actor), ahora, referencia || null, p.id);
    historial(sqlite, { pedido_id: p.id, accion: 'enviar', motivo: referencia || null, actor, fecha: ahora });
    return { ok: true };
  }).immediate();
}

const activos = (sqlite, pedido_id, suc = null) => sqlite.prepare(`SELECT * FROM resurtido_pedido_renglones
  WHERE pedido_id=? AND estado='activo' AND pedido>0 AND (? IS NULL OR sucursal_id=?) ORDER BY clave, sucursal_id`)
  .all(pedido_id, suc, suc);

// Mismo formato que la lista del sugerido (src/resurtido/resurtido.js textoWhatsApp), con lo que quedó fuera.
function listaProveedor(sqlite, pedido_id) {
  const p = leerPedido(sqlite, pedido_id), empaques = empaquesConfirmados(sqlite), porClave = new Map();
  for (const r of activos(sqlite, p.id)) {
    if (!porClave.has(r.clave)) {
      porClave.set(r.clave, { clave: r.clave, descripcion: r.descripcion, total: 0, empaque: empaques.get(r.clave) ?? null, por_tienda: [] });
    }
    const g = porClave.get(r.clave);
    g.total += r.pedido; g.por_tienda.push({ sucursal_id: r.sucursal_id, pedido: r.pedido });
  }
  const fuera = sqlite.prepare(`SELECT DISTINCT sucursal_id FROM resurtido_pedido_renglones
    WHERE pedido_id=? AND estado='fuera_de_tiempo' ORDER BY sucursal_id`).all(p.id).map(x => x.sucursal_id);
  return { pedido_id: p.id, marca: p.marca, tipo: p.tipo, periodo: p.periodo, estado: p.estado, renglones: [...porClave.values()],
    tiendas_atrasadas: JSON.parse(p.tiendas_atrasadas || '[]'), tiendas_fuera_de_tiempo: fuera };
}

// Lo que le toca a cada tienda cuando llega la mercancía a CEDIS, con lo que ya le llegó.
function hojaReparto(sqlite, pedido_id, suc = null) {
  const p = leerPedido(sqlite, pedido_id), porTienda = new Map();
  for (const r of activos(sqlite, p.id, suc)) {
    if (!porTienda.has(r.sucursal_id)) porTienda.set(r.sucursal_id, { sucursal_id: r.sucursal_id, renglones: [] });
    porTienda.get(r.sucursal_id).renglones.push({ clave: r.clave, descripcion: r.descripcion, pedido: r.pedido, llegado: r.llegado });
  }
  return [...porTienda.values()].sort((a, b) => a.sucursal_id - b.sucursal_id);
}

// Lo que llegó se lee de SICAR: traspasos CEDIS → tienda aplicados después de aprobar (sin pasar de lo pedido).
// Surtido cuando todo llegó o a los 45 días desde la aprobación; la diferencia queda a la vista en cada renglón.
function revisarLlegadas(sqlite, ahora = new Date().toISOString()) {
  return sqlite.transaction(() => {
    const abiertos = sqlite.prepare("SELECT * FROM resurtido_pedidos WHERE estado IN ('aprobado','enviado')").all();
    if (!abiertos.length) return { surtidos: 0 };
    const renglones = sqlite.prepare(`SELECT * FROM resurtido_pedido_renglones WHERE estado='activo' AND pedido_id IN
      (SELECT id FROM resurtido_pedidos WHERE estado IN ('aprobado','enviado'))`).all();
    const porTienda = new Map();
    for (const r of renglones) {
      if (!porTienda.has(r.sucursal_id)) porTienda.set(r.sucursal_id, asignarLlegadas(sqlite, r.sucursal_id));
      const nuevo = porTienda.get(r.sucursal_id).get(`${r.pedido_id}|${r.clave}`) || 0;
      if (nuevo === r.llegado) continue;
      sqlite.prepare('UPDATE resurtido_pedido_renglones SET llegado=? WHERE pedido_id=? AND sucursal_id=? AND clave=?')
        .run(nuevo, r.pedido_id, r.sucursal_id, r.clave);
      historial(sqlite, { pedido_id: r.pedido_id, sucursal_id: r.sucursal_id, clave: r.clave, accion: 'llegada', antes: r.llegado,
        despues: nuevo, actor: 'sistema', fecha: ahora });
      r.llegado = nuevo;
    }
    let surtidos = 0;
    for (const p of abiertos) {
      const propios = renglones.filter(r => r.pedido_id === p.id);
      const completo = propios.every(r => r.llegado >= r.pedido);
      const vencido = Date.parse(ahora) - Date.parse(p.aprobado_en) >= DIAS_EN_CAMINO * 86400000;
      if (!completo && !vencido) continue;
      sqlite.prepare("UPDATE resurtido_pedidos SET estado='surtido', cerrado_en=? WHERE id=?").run(ahora, p.id);
      historial(sqlite, { pedido_id: p.id, accion: 'surtido', actor: 'sistema', fecha: ahora,
        motivo: completo ? 'Llegó todo lo pedido.' : `Cerrado a los ${DIAS_EN_CAMINO} días con faltante.` });
      surtidos++;
    }
    return { surtidos };
  }).immediate();
}

// La compra de CEDIS al proveedor solo se PROPONE: proveedor configurado de la marca, posterior al envío y con claves del
// pedido. Nunca se liga sola por texto, fecha o importe. Las claves de la compra que no están en el pedido (sustitutas)
// no cierran nada: se muestran como "por aclarar".
function candidatasCompra(sqlite, pedido_id) {
  const p = leerPedido(sqlite, pedido_id);
  if (!p.enviado_en) return { candidatas: [], motivo: 'El pedido todavía no se marca como enviado.' };
  const proveedor = leerConfig(sqlite)[`proveedor_${p.marca.toLowerCase()}`];
  if (!proveedor) return { candidatas: [], motivo: `Falta configurar el proveedor de SICAR de ${p.marca}.` };
  const delPedido = new Set(activos(sqlite, p.id).map(r => r.clave));
  const claves = sqlite.prepare(`SELECT DISTINCT a.clave FROM sicar_compras_detalle d
    JOIN sicar_articulos a ON a.sucursal_id=d.sucursal_id AND a.art_id=d.art_id WHERE d.sucursal_id=6 AND d.com_id=? ORDER BY a.clave`);
  const candidatas = sqlite.prepare(`SELECT com_id, folio, fecha, total_centavos FROM sicar_compras
    WHERE sucursal_id=6 AND estado='vigente' AND pro_id=? AND SUBSTR(fecha,1,10) >= ?
      AND com_id NOT IN (SELECT compra_com_id FROM resurtido_pedidos WHERE compra_com_id IS NOT NULL AND id<>?)
    ORDER BY fecha, com_id`).all(String(proveedor), fechaLocal(p.enviado_en), p.id).map(c => {
    const todas = claves.all(c.com_id).map(x => x.clave);
    return { ...c, claves_del_pedido: todas.filter(k => delPedido.has(k)), por_aclarar: todas.filter(k => !delPedido.has(k)) };
  }).filter(c => c.claves_del_pedido.length);
  return { candidatas, motivo: null };
}

function confirmarCompra(sqlite, pedido_id, com_id, actor, ahora = new Date().toISOString()) {
  return sqlite.transaction(() => {
    const p = leerPedido(sqlite, pedido_id);
    if (p.compra_com_id) throw error(409, 'Este pedido ya tiene su compra confirmada.');
    if (!candidatasCompra(sqlite, p.id).candidatas.some(c => c.com_id === String(com_id))) {
      throw error(409, 'Esa compra no es candidata para este pedido.');
    }
    sqlite.prepare('UPDATE resurtido_pedidos SET compra_com_id=?, compra_confirmada_por=?, compra_confirmada_en=? WHERE id=?')
      .run(String(com_id), String(actor), ahora, p.id);
    historial(sqlite, { pedido_id: p.id, accion: 'compra', motivo: `Compra ${com_id} de CEDIS`, actor, fecha: ahora });
    return { ok: true };
  }).immediate();
}

// Detalle del pedido con el alcance ya resuelto del token (suc null = todas las tiendas).
function verPedido(sqlite, pedido_id, suc = null, ahora = new Date().toISOString()) {
  const p = leerPedido(sqlite, pedido_id);
  const renglones = sqlite.prepare(`SELECT * FROM resurtido_pedido_renglones WHERE pedido_id=? AND (? IS NULL OR sucursal_id=?)
    ORDER BY clave, sucursal_id`).all(p.id, suc, suc);
  // Mientras se revisa: "Antes de comprar, otra tienda tiene de sobra" (solo aviso; no cambia números).
  if (EDITABLES.includes(p.estado) && renglones.length) {
    const sobras = sobrantesActuales(sqlite, ahora);
    for (const r of renglones) r.sobra = (sobras.get(r.clave) || []).filter(s => s.sucursal_id !== r.sucursal_id);
  }
  const historialPedido = sqlite.prepare(`SELECT * FROM resurtido_pedido_historial
    WHERE pedido_id=? AND (? IS NULL OR sucursal_id IS NULL OR sucursal_id=?) ORDER BY id DESC LIMIT 300`).all(p.id, suc, suc);
  const plazo = new Date(Date.parse(p.creado_en) + leerConfig(sqlite).dias_visto_bueno * 86400000).toISOString();
  return { pedido: { ...p, tiendas_atrasadas: JSON.parse(p.tiendas_atrasadas || '[]'), plazo_visto_bueno: plazo },
    renglones, historial: historialPedido };
}

function listarPedidos(sqlite, { marca, sucursal_id = null } = {}) {
  if (marca && !MARCAS.includes(marca)) throw error(400, 'Marca inválida.');
  const pedidos = sqlite.prepare(`SELECT id, marca, tipo, periodo, estado, creado_en, aprobado_en, enviado_en, cerrado_en, aviso_id
    FROM resurtido_pedidos p WHERE (? IS NULL OR marca=?) AND estado<>'cancelado'
    AND (? IS NULL OR EXISTS (SELECT 1 FROM resurtido_pedido_renglones r WHERE r.pedido_id=p.id AND r.sucursal_id=?))
    ORDER BY id DESC LIMIT 36`).all(marca || null, marca || null, sucursal_id, sucursal_id);
  return { pedidos, pausados: leerConfig(sqlite).pedidos_pausados === 1 };
}

module.exports = { armarBorrador, repartirEmpaque, insertarPedido, historial, error, PIEZA, leerPedido,
  cambiarRenglones, vistoBuenoTienda, aprobar, registrarEnvio, listaProveedor, hojaReparto, verPedido, listarPedidos,
  revisarLlegadas, candidatasCompra, confirmarCompra };
