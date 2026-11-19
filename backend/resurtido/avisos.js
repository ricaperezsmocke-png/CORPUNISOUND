// Avisos entre pedidos (Entrega 3): una tienda que cae abajo de su mínimo recibe dos propuestas, pasar de otra tienda
// (solo lo que la donante tiene arriba de su máximo) o pedir extra. El sistema no crea traspasos en SICAR: propone, una
// persona decide, y el traspaso se hace en SICAR como hoy. La reserva evita que dos tiendas tomen el mismo sobrante.
const { fechaLocal } = require('../fechas');
const { MARCAS } = require('./config');
const { armar } = require('./consultas');
const { reservasVivas, calcularSobrantes, NOMBRES, PIEZA } = require('./sobrantes');
const { insertarPedido, historial } = require('./pedido');
const { momento, momentoSicar } = require('./llegadas');
const DIAS_RESERVA = 3;
const DECISIONES = ['pasar', 'pedir', 'esperar'];
const error = (status, mensaje) => Object.assign(new Error(mensaje), { status });
const piezasArriba = valor => Math.max(0, Math.ceil(valor / PIEZA) * PIEZA);

function situacion(sqlite, ahora) {
  const { filas, tiendas_atrasadas } = armar(sqlite, null, ahora);
  const sobras = calcularSobrantes(filas, tiendas_atrasadas, reservasVivas(sqlite, ahora));
  const porLlave = new Map(filas.map(f => [`${f.sucursal_id}|${f.clave}`, f]));
  return { filas, tiendas_atrasadas, sobras, porLlave };
}

// Tienda de la marca, al día y con mínimo: aplica el aviso. Lo que hay más lo que viene se compara con el mínimo.
const vigilada = (f, atrasadas) => MARCAS.includes(f.marca) && !atrasadas.includes(f.sucursal_id)
  && !f.ya_no_la_maneja && !f.ya_no_es_marca && f.minimo > 0;
const hay = f => Math.max(f.existencia, 0) + f.en_camino;

function proponer(f, sobras) {
  const falta = piezasArriba(f.minimo - hay(f));
  let resto = falta;
  const pasar = [];
  for (const s of sobras.get(f.clave) || []) {
    if (resto <= 0) break;
    if (s.sucursal_id === f.sucursal_id) continue;
    const piezas = Math.min(resto, s.piezas);
    pasar.push({ sucursal_id: s.sucursal_id, nombre: NOMBRES[s.sucursal_id], clave: f.clave, piezas });
    resto -= piezas;
  }
  return { falta, pasar, pedir: piezasArriba(f.maximo - hay(f)) };
}

function cerrarReservas(sqlite, ahora) {
  sqlite.prepare("UPDATE resurtido_reservas SET estado='vencida', cerrada_en=? WHERE estado='viva' AND vence<=?").run(ahora, ahora);
  const traspaso = sqlite.prepare(`SELECT t.fecha FROM sicar_traspasos t
    JOIN sicar_sucursales_mapa o ON o.sicar_sucursal=t.suc_origen JOIN sicar_sucursales_mapa de ON de.sicar_sucursal=t.suc_destino
    JOIN sicar_traspasos_detalle d ON d.sucursal_id=t.sucursal_id AND d.tra_id=t.tra_id
    JOIN sicar_articulos a ON a.sucursal_id=d.sucursal_id AND a.art_id=d.art_id
    WHERE o.sucursal_id=? AND de.sucursal_id=? AND a.clave=? AND t.estado<>'cancelado'`);
  for (const r of sqlite.prepare("SELECT * FROM resurtido_reservas WHERE estado='viva'").all()) {
    const desde = momento(r.creada);
    if (traspaso.all(r.donante, r.receptora, r.clave).some(t => momentoSicar(t.fecha) >= desde)) {
      sqlite.prepare("UPDATE resurtido_reservas SET estado='consumida', cerrada_en=? WHERE id=?").run(ahora, r.id);
    }
  }
}

// Diario y tras cada recálculo: abre avisos nuevos, actualiza la propuesta de los abiertos y cierra los que ya volvieron
// a su mínimo. Un solo aviso abierto por tienda y clave. Las tiendas atrasadas no se tocan.
function revisarAvisos(sqlite, ahora = new Date().toISOString()) {
  return sqlite.transaction(() => {
    cerrarReservas(sqlite, ahora);
    const { filas, tiendas_atrasadas, sobras, porLlave } = situacion(sqlite, ahora);
    const abiertos = new Map(sqlite.prepare("SELECT * FROM resurtido_avisos WHERE estado='abierto'").all()
      .map(a => [`${a.sucursal_id}|${a.clave}`, a]));
    let abiertos_nuevos = 0, resueltos = 0;
    for (const f of filas) {
      if (!vigilada(f, tiendas_atrasadas) || abiertos.has(`${f.sucursal_id}|${f.clave}`) || hay(f) >= f.minimo) continue;
      sqlite.prepare(`INSERT INTO resurtido_avisos(sucursal_id, clave, marca, creado_en, estado, propuesta_json)
        VALUES (?,?,?,?,'abierto',?)`).run(f.sucursal_id, f.clave, f.marca, ahora, JSON.stringify(proponer(f, sobras)));
      abiertos_nuevos++;
    }
    for (const [llave, a] of abiertos) {
      if (tiendas_atrasadas.includes(a.sucursal_id)) continue;
      const f = porLlave.get(llave);
      if (f && vigilada(f, tiendas_atrasadas) && Math.max(f.existencia, 0) < f.minimo) {
        sqlite.prepare('UPDATE resurtido_avisos SET propuesta_json=? WHERE id=?').run(JSON.stringify(proponer(f, sobras)), a.id);
        continue;
      }
      // Volvió a su mínimo (o la clave dejó de aplicar): se cierra solo y libera lo que tenía apartado.
      sqlite.prepare("UPDATE resurtido_avisos SET estado='resuelto', cerrado_en=? WHERE id=?").run(ahora, a.id);
      sqlite.prepare("UPDATE resurtido_reservas SET estado='vencida', cerrada_en=? WHERE aviso_id=? AND estado='viva'").run(ahora, a.id);
      resueltos++;
    }
    return { abiertos: abiertos_nuevos, resueltos };
  }).immediate();
}

const MENSAJE_PASAR = 'Apartado en el sistema por 3 días. El sistema no aparta nada dentro de SICAR: revisa la existencia en SICAR '
  + 'antes de hacer el traspaso.';

// La tienda escoge: pasar (aparta el sobrante), pedir (pedido extra con el mismo visto bueno) o esperar.
function decidirAviso(sqlite, aviso_id, datos, actor, suc, ahora = new Date().toISOString()) {
  const decision = datos?.decision, motivo = typeof datos?.motivo === 'string' ? datos.motivo.trim() : '';
  if (!DECISIONES.includes(decision)) throw error(400, 'Decisión inválida: pasar, pedir o esperar.');
  if (motivo.length > 200) throw error(400, 'El motivo no puede pasar de 200 caracteres.');
  return sqlite.transaction(() => {
    const id = Number(aviso_id);
    const a = Number.isSafeInteger(id) ? sqlite.prepare('SELECT * FROM resurtido_avisos WHERE id=?').get(id) : null;
    if (!a) throw error(404, 'Aviso no encontrado.');
    if (suc !== null && a.sucursal_id !== Number(suc)) throw error(403, 'Ese aviso es de otra tienda.');
    if (a.estado !== 'abierto') throw error(409, 'El aviso ya se cerró.');
    // Se puede volver a decidir cuando ya no quedan reservas vivas sin vencer.
    const apartado = sqlite.prepare("SELECT 1 FROM resurtido_reservas WHERE aviso_id=? AND estado='viva' AND vence>?").get(a.id, ahora);
    if (a.decision === 'pedir' || (a.decision === 'pasar' && apartado)) throw error(409, 'Este aviso ya tiene decisión.');
    const { porLlave, sobras } = situacion(sqlite, ahora);
    const f = porLlave.get(`${a.sucursal_id}|${a.clave}`);
    if (!f) throw error(409, 'La clave ya no está en el cálculo de esta tienda.');
    const propuesta = proponer(f, sobras), resultado = { ok: true, decision };
    if (decision === 'pasar') {
      if (!propuesta.pasar.length) throw error(409, 'Ya no hay sobrante disponible en otra tienda. Puedes pedir extra.');
      const vence = new Date(Date.parse(ahora) + DIAS_RESERVA * 86400000).toISOString();
      for (const p of propuesta.pasar) {
        sqlite.prepare(`INSERT INTO resurtido_reservas(aviso_id, donante, receptora, clave, piezas, creada, vence, estado)
          VALUES (?,?,?,?,?,?,?,'viva')`).run(a.id, p.sucursal_id, a.sucursal_id, a.clave, p.piezas, ahora, vence);
      }
      Object.assign(resultado, { pasar: propuesta.pasar, mensaje: MENSAJE_PASAR });
    }
    if (decision === 'pedir') {
      if (!(propuesta.pedir > 0)) throw error(409, 'Con lo que hay y lo que viene ya llega a su máximo.');
      const empaque = sqlite.prepare(`SELECT tamano_diezmilesimas tamano FROM resurtido_empaques
        WHERE clave=? AND confirmado_por IS NOT NULL`).get(a.clave);
      const cantidad = empaque ? Math.ceil(propuesta.pedir / empaque.tamano) * empaque.tamano : propuesta.pedir;
      const periodo = fechaLocal(ahora).slice(0, 7), llave = `${a.marca}:${periodo}:extra:${a.id}`;
      const existente = sqlite.prepare('SELECT id FROM resurtido_pedidos WHERE llave=?').get(llave);
      resultado.pedido_id = existente?.id ?? insertarPedido(sqlite, { marca: a.marca, tipo: 'extra', periodo, llave, actor, ahora,
        aviso_id: a.id }, [{ sucursal_id: a.sucursal_id, clave: a.clave, descripcion: f.descripcion, sugerido: propuesta.pedir,
        pedido: cantidad }]);
      if (!existente) historial(sqlite, { pedido_id: resultado.pedido_id, sucursal_id: a.sucursal_id, clave: a.clave, accion: 'aviso',
        despues: cantidad, motivo: motivo || null, actor, fecha: ahora });
    }
    sqlite.prepare(`INSERT INTO resurtido_avisos_historial(aviso_id, decision, motivo, actor, fecha, propuesta_json)
      VALUES (?,?,?,?,?,?)`).run(a.id, decision, motivo || null, String(actor), ahora, JSON.stringify(propuesta));
    sqlite.prepare(`UPDATE resurtido_avisos SET decision=?, motivo=?, actor=?, decidido_en=?, propuesta_json=?,
      pedido_id=COALESCE(?, pedido_id) WHERE id=?`)
      .run(decision, motivo || null, String(actor), ahora, JSON.stringify(propuesta), resultado.pedido_id ?? null, a.id);
    return resultado;
  }).immediate();
}

// Avisos de la tienda (o de todas) con la propuesta al momento, y lo que otras tiendas le apartaron a ella como donante.
// La receptora ve de la donante solo nombre, clave y piezas.
function listarAvisos(sqlite, suc = null, ahora = new Date().toISOString()) {
  revisarAvisos(sqlite, ahora);
  const { porLlave, sobras } = situacion(sqlite, ahora);
  const limite = new Date(Date.parse(ahora) - 30 * 86400000).toISOString();
  const avisos = sqlite.prepare(`SELECT * FROM resurtido_avisos WHERE (? IS NULL OR sucursal_id=?) AND (estado='abierto' OR cerrado_en>=?)
    ORDER BY estado='abierto' DESC, creado_en DESC LIMIT 300`).all(suc, suc, limite).map(a => {
    const f = porLlave.get(`${a.sucursal_id}|${a.clave}`);
    const propuesta = a.estado === 'abierto' && f ? proponer(f, sobras) : JSON.parse(a.propuesta_json);
    const { propuesta_json: _omitido, ...resto } = a;
    return { ...resto, descripcion: f?.descripcion || a.clave, existencia: f?.existencia ?? null, minimo: f?.minimo ?? null,
      maximo: f?.maximo ?? null, en_camino: f?.en_camino ?? null, propuesta,
      reservas: sqlite.prepare("SELECT donante, piezas, vence, estado FROM resurtido_reservas WHERE aviso_id=? ORDER BY id").all(a.id)
        .map(r => ({ ...r, nombre_donante: NOMBRES[r.donante] })) };
  });
  const apartados = sqlite.prepare(`SELECT donante, receptora, clave, piezas, creada, vence FROM resurtido_reservas
    WHERE (? IS NULL OR donante=?) AND estado='viva' AND vence>? ORDER BY vence`).all(suc, suc, ahora)
    .map(r => ({ ...r, nombre_donante: NOMBRES[r.donante], nombre_receptora: NOMBRES[r.receptora] }));
  return { avisos, apartados };
}

module.exports = { revisarAvisos, decidirAviso, listarAvisos, DIAS_RESERVA };
