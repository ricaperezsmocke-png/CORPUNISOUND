const { ahora, fechaLocal } = require('./fechas');

const DIA = 86400000;
const error = (status, mensaje) => Object.assign(new Error(mensaje), { status });
const clave = c => JSON.stringify([c.sucursal_id, c.com_id]);
const lista = compras => compras.map(clave).sort();

function normalizarRfc(texto) {
  return typeof texto === 'string' ? texto.replace(/[\s-]/g, '').toUpperCase() || null : null;
}

function folioCoincide(folioSicar, { serie, folio }) {
  const limpiar = valor => String(valor ?? '').replace(/[\s-]/g, '').toUpperCase();
  const numero = valor => valor.replace(/\d+/g, n => n.replace(/^0+(?=\d)/, ''));
  const sicar = limpiar(folioSicar);
  const xml = limpiar(folio);
  if (!sicar || !xml) return false;
  return numero(sicar) === numero(xml) || numero(sicar) === numero(limpiar(serie) + xml);
}

// Las fechas SICAR/CFDI son locales: comparar el día literal, sin desplazarlo por zona horaria.
function dia(valor) {
  const texto = typeof valor === 'string' ? valor.slice(0, 10) : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return NaN;
  const ms = Date.parse(texto + 'T00:00:00Z');
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === texto ? ms : NaN;
}

function crearFacturasCompras({ sqlite, usuarios = () => [] }) {
  const factura = id => {
    const numero = Number(id);
    if (!Number.isSafeInteger(numero) || numero <= 0) throw error(404, 'Factura no encontrada.');
    const f = sqlite.prepare('SELECT * FROM facturas_por_llegar WHERE id=?').get(numero);
    if (!f) throw error(404, 'Factura no encontrada.');
    return f;
  };
  const historial = (id, accion, actor, detalle) => sqlite.prepare(`INSERT INTO facturas_por_llegar_historial
    (factura_id,accion,actor,fecha,detalle) VALUES (?,?,?,?,?)`).run(id, accion, String(actor), ahora(), JSON.stringify(detalle));
  const pendientes = () => sqlite.prepare(`SELECT f.* FROM facturas_por_llegar f
    LEFT JOIN facturas_compras u ON u.factura_id=f.id WHERE f.estado='por_llegar' AND u.id IS NULL`).all();
  const libres = () => sqlite.prepare(`SELECT c.*,p.rfc,p.nombre AS proveedor FROM sicar_compras c
    JOIN sicar_proveedores p ON p.sucursal_id=c.sucursal_id AND p.prv_id=c.pro_id
    LEFT JOIN facturas_compras u ON u.sucursal_id=c.sucursal_id AND u.com_id=c.com_id
    LEFT JOIN compras_cerradas k ON k.sucursal_id=c.sucursal_id AND k.com_id=c.com_id
    WHERE c.estado='vigente' AND u.id IS NULL AND k.com_id IS NULL`).all();
  function coinciden(f, compras) {
    const rfc = normalizarRfc(f.rfc_emisor);
    if (f.estado !== 'por_llegar' || f.moneda !== 'MXN' || !rfc || !Number.isSafeInteger(f.total_centavos)) return [];
    const desde = dia(f.fecha_emision);
    return compras.filter(c => normalizarRfc(c.rfc) === rfc && Number.isSafeInteger(c.total_centavos)
      && Math.abs(c.total_centavos - f.total_centavos) <= 100 && dia(c.fecha) >= desde && dia(c.fecha) <= desde + 60 * DIA);
  }
  function candidatas(id) {
    const f = factura(id);
    if (sqlite.prepare('SELECT 1 FROM facturas_compras WHERE factura_id=?').get(f.id)) return [];
    return coinciden(f, libres());
  }
  function descartada(id, compras) {
    const h = sqlite.prepare(`SELECT detalle FROM facturas_por_llegar_historial
      WHERE factura_id=? AND accion='ninguna' ORDER BY id DESC LIMIT 1`).get(id);
    if (!h) return false;
    const marca = JSON.parse(h.detalle);
    return JSON.stringify(marca.candidatas) === JSON.stringify(lista(compras));
  }
  // Pareja separada a mano o porque la compra se canceló en SICAR: nunca se vuelve a unir sola, la confirma una persona.
  function separadaAMano(id, compra) {
    return sqlite.prepare(`SELECT detalle FROM facturas_por_llegar_historial
      WHERE factura_id=? AND accion IN ('desunir','desunir_cancelada')`).all(id).some(h => {
      const detalle = JSON.parse(h.detalle);
      const union = detalle.union || detalle.compra;
      return Number(union?.sucursal_id) === compra.sucursal_id && union?.com_id === compra.com_id;
    });
  }
  function unir(f, c, modo, actor, opciones) {
    sqlite.prepare(`INSERT INTO facturas_compras
      (factura_id,sucursal_id,com_id,modo,actor,fecha,total_al_unir_centavos) VALUES (?,?,?,?,?,?,?)`)
      .run(f.id, c.sucursal_id, c.com_id, modo, String(actor), ahora(), c.total_centavos);
    sqlite.prepare("UPDATE facturas_por_llegar SET estado='llego',llego_en=?,llego_por=? WHERE id=?")
      .run(c.fecha, modo === 'automatica' ? 'sicar' : String(actor), f.id);
    historial(f.id, 'unir', actor, { compra: c, modo, candidatas: opciones });
    return { ...factura(f.id), compra: { ...c, modo, actor: String(actor) } };
  }
  function revisarDentro() {
    const canceladas = sqlite.prepare(`SELECT u.*,c.estado,c.fecha AS fecha_compra,c.folio,c.total_centavos,
      c.comentario,p.nombre AS proveedor
      FROM facturas_compras u JOIN sicar_compras c ON c.sucursal_id=u.sucursal_id AND c.com_id=u.com_id
      LEFT JOIN sicar_proveedores p ON p.sucursal_id=c.sucursal_id AND p.prv_id=c.pro_id
      WHERE c.estado='cancelada'`).all();
    for (const u of canceladas) separar(u.factura_id, 'sicar', 'desunir_cancelada', { compra: u });
    const compras = libres();
    if (!compras.length) return;
    const porRfc = new Map();
    for (const c of compras) {
      const rfc = normalizarRfc(c.rfc);
      if (!rfc) continue;
      if (!porRfc.has(rfc)) porRfc.set(rfc, []);
      porRfc.get(rfc).push(c);
    }
    const filas = pendientes().map(f => ({ f, opciones: coinciden(f, porRfc.get(normalizarRfc(f.rfc_emisor)) || []) }));
    const usos = new Map();
    for (const { opciones } of filas) for (const c of opciones) usos.set(clave(c), (usos.get(clave(c)) || 0) + 1);
    // Decidir con la foto completa, antes de consumir compras: el orden no resuelve ambigüedades.
    for (const { f, opciones } of filas) {
      if (opciones.length !== 1) continue;
      const c = opciones[0];
      if (usos.get(clave(c)) === 1 && folioCoincide(c.folio, f) && !descartada(f.id, opciones) && !separadaAMano(f.id, c)) {
        unir(f, c, 'automatica', 'sicar', opciones);
      }
    }
  }
  const revisar = () => sqlite.transaction(revisarDentro).immediate();
  function confirmar(id, seleccion, actor) {
    return sqlite.transaction(() => {
      const f = factura(id);
      const opciones = candidatas(f.id);
      const sucursal = Number(seleccion?.sucursal_id);
      const comId = typeof seleccion?.com_id === 'string' ? seleccion.com_id : '';
      const c = Number.isSafeInteger(sucursal) && sucursal > 0
        ? opciones.find(c => c.sucursal_id === sucursal && c.com_id === comId) : null;
      if (!c) throw error(409, 'La compra ya no es candidata de esta factura.');
      return unir(f, c, 'manual', actor, opciones);
    }).immediate();
  }
  function motivoValido(motivo) {
    if (typeof motivo !== 'string' || !motivo.trim()) throw error(400, 'El motivo es obligatorio.');
    return motivo.trim();
  }
  function ninguna(id, motivo, actor) {
    const texto = motivoValido(motivo);
    return sqlite.transaction(() => {
      const f = factura(id);
      if (f.estado !== 'por_llegar') throw error(409, 'La factura ya no está por llegar.');
      historial(f.id, 'ninguna', actor, { motivo: texto, candidatas: lista(candidatas(f.id)) });
      return f;
    }).immediate();
  }
  function separar(id, actor, accion, detalle) {
    sqlite.prepare('DELETE FROM facturas_compras WHERE factura_id=?').run(id);
    sqlite.prepare("UPDATE facturas_por_llegar SET estado='por_llegar',llego_en=NULL,llego_por=NULL WHERE id=?").run(id);
    historial(id, accion, actor, detalle);
  }
  function desunir(id, motivo, actor) {
    const texto = motivoValido(motivo);
    return sqlite.transaction(() => {
      const f = factura(id);
      const union = sqlite.prepare('SELECT * FROM facturas_compras WHERE factura_id=?').get(f.id);
      if (!union) throw error(409, 'La factura no tiene una compra unida.');
      // union conserva sucursal_id y com_id: esta pareja no se volverá a unir automáticamente.
      separar(f.id, actor, 'desunir', { motivo: texto, union });
      return factura(f.id);
    }).immediate();
  }
  // Una compra vigente sin unión que nunca tendrá factura: una persona la cierra con motivo y deja su nombre.
  function cerrarCompra(seleccion, motivo, actor) {
    const texto = motivoValido(motivo);
    return sqlite.transaction(() => {
      const sucursal = Number(seleccion?.sucursal_id);
      const comId = typeof seleccion?.com_id === 'string' ? seleccion.com_id : '';
      const c = Number.isSafeInteger(sucursal) && sucursal > 0 && comId ? sqlite.prepare(`SELECT c.sucursal_id,c.com_id
        FROM sicar_compras c LEFT JOIN facturas_compras u ON u.sucursal_id=c.sucursal_id AND u.com_id=c.com_id
        LEFT JOIN compras_cerradas k ON k.sucursal_id=c.sucursal_id AND k.com_id=c.com_id
        WHERE c.sucursal_id=? AND c.com_id=? AND c.estado='vigente' AND u.id IS NULL AND k.com_id IS NULL`).get(sucursal, comId) : null;
      if (!c) throw error(409, 'La compra ya no está vigente sin factura.');
      sqlite.prepare('INSERT INTO compras_cerradas (sucursal_id,com_id,motivo,actor,fecha) VALUES (?,?,?,?,?)')
        .run(c.sucursal_id, c.com_id, texto, String(actor), ahora());
      return { ...c, motivo: texto, actor: String(actor) };
    }).immediate();
  }
  function alGuardarCompras() {
    try {
      // La misma revisión global repara cancelaciones que no alcanzaron a pasar por el hook.
      revisar();
    } catch (e) { console.error('FACTURAS_COMPRAS_HOOK_FALLO', e.message); }
  }
  function resumen() {
    const facturas = pendientes();
    const compras = libres();
    const porConfirmar = facturas.map(f => ({ ...f, candidatas: coinciden(f, compras) }))
      .filter(f => f.candidatas.length && !descartada(f.id, f.candidatas));
    const sinFactura = sqlite.prepare(`SELECT c.*,p.nombre AS proveedor FROM sicar_compras c
      LEFT JOIN sicar_proveedores p ON p.sucursal_id=c.sucursal_id AND p.prv_id=c.pro_id
      LEFT JOIN facturas_compras u ON u.sucursal_id=c.sucursal_id AND u.com_id=c.com_id
      LEFT JOIN compras_cerradas k ON k.sucursal_id=c.sucursal_id AND k.com_id=c.com_id
      WHERE c.estado='vigente' AND u.id IS NULL AND k.com_id IS NULL`).all();
    // Día de activación = día (hora de México) de la primera compra recibida de esa sucursal. Solo una compra hecha en
    // SICAR ese día o después puede salir en rojo: si la carga inicial se corta, lo viejo sigue contando como viejo.
    const activacion = new Map(sqlite.prepare(`SELECT sucursal_id,MIN(primera_vez) primera
      FROM sicar_compras GROUP BY sucursal_id`).all().map(c => [c.sucursal_id, dia(fechaLocal(c.primera))]));
    const nueva = c => dia(c.fecha) >= activacion.get(c.sucursal_id);
    const hoy = dia(fechaLocal());
    const cambiaron = sqlite.prepare(`SELECT u.*,c.total_centavos,c.fecha AS fecha_compra,c.folio,
      c.comentario,p.nombre AS proveedor
      FROM facturas_compras u JOIN sicar_compras c ON c.sucursal_id=u.sucursal_id AND c.com_id=u.com_id
      LEFT JOIN sicar_proveedores p ON p.sucursal_id=c.sucursal_id AND p.prv_id=c.pro_id
      WHERE ABS(c.total_centavos-u.total_al_unir_centavos)>100`).all();
    const canceladas = sqlite.prepare(`SELECT h.*,f.uuid FROM facturas_por_llegar_historial h
      JOIN facturas_por_llegar f ON f.id=h.factura_id
      LEFT JOIN facturas_compras u ON u.factura_id=f.id
      WHERE h.accion='desunir_cancelada' AND f.estado='por_llegar' AND u.id IS NULL ORDER BY h.id DESC`).all()
      .map(h => ({ ...h, detalle: JSON.parse(h.detalle) }));
    const proveedores = sqlite.prepare(`SELECT p.sucursal_id,p.prv_id,p.nombre,p.rfc,COUNT(c.com_id) compras
      FROM sicar_proveedores p JOIN sicar_compras c ON c.sucursal_id=p.sucursal_id AND c.pro_id=p.prv_id
      GROUP BY p.sucursal_id,p.prv_id`).all().filter(p => !normalizarRfc(p.rfc))
      .map(({ rfc, ...p }) => p);
    const nombres = new Map(usuarios().map(u => [String(u.id), u.nombre]));
    const cerradas = sqlite.prepare(`SELECT k.sucursal_id,k.com_id,c.folio,c.fecha,c.total_centavos,c.comentario,
      p.nombre AS proveedor,k.motivo,k.actor,k.fecha AS fecha_cierre
      FROM compras_cerradas k LEFT JOIN sicar_compras c ON c.sucursal_id=k.sucursal_id AND c.com_id=k.com_id
      LEFT JOIN sicar_proveedores p ON p.sucursal_id=c.sucursal_id AND p.prv_id=c.pro_id ORDER BY k.fecha DESC`).all()
      .map(({ fecha_cierre, ...k }) => ({ ...k, actor_nombre: nombres.get(k.actor) || `Usuario #${k.actor}`, fecha_cierre }));
    return { por_confirmar: porConfirmar, compras_cerradas: cerradas,
      facturas_sin_compra_15: facturas.filter(f => Date.now() - Date.parse(f.creada_en) > 15 * DIA),
      compras_sin_factura_15: sinFactura.filter(c => nueva(c) && hoy - dia(c.fecha) > 15 * DIA),
      compras_viejas_sin_factura: sinFactura.filter(c => !nueva(c)).length,
      canceladas_despues: canceladas, cambiaron, proveedores_sin_rfc: proveedores,
      compras_omitidas: sqlite.prepare(`SELECT sucursal_id,com_id,codigo,ultima_vez FROM sicar_compras_omitidas
        ORDER BY ultima_vez DESC,sucursal_id,com_id`).all() };
  }
  return { candidatas, revisar, confirmar, ninguna, desunir, cerrarCompra, alGuardarCompras, resumen };
}

module.exports = { crearFacturasCompras, normalizarRfc, folioCoincide };
