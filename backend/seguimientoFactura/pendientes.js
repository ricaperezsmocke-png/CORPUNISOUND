// Claves pendientes de recálculo. Sin dependencias del motor: lo usa sicarRepositorio dentro de su transacción.

const DETALLES = [
  ['sicar_detalles', 'ven_id', l => l.ventas],
  ['sicar_detalles_mostrador', 'ven_id', l => l.mostrador],
  ['sicar_traspasos_detalle', 'tra_id', l => l.traspasos],
  ['sicar_compras_detalle', 'com_id', l => l.compras],
];

const hayTiendas = sqlite => !!sqlite.prepare('SELECT 1 FROM seguimiento_tiendas LIMIT 1').get();

/**
 * art_id que un lote del agente puede afectar: los que trae (detalles, artículos, existencias) y los que ya
 * estaban guardados en los documentos que reemplaza (un renglón borrado también cambia el cálculo).
 */
function artIdsDelLote(sqlite, sucursalId, lote) {
  if (!hayTiendas(sqlite)) return [];
  const ids = new Set();
  for (const [tabla, campo, documentos] of DETALLES) {
    const docs = documentos(lote) || [];
    for (const d of docs) for (const r of d.detalle || []) if (r.art_id != null) ids.add(String(r.art_id));
    const llaves = docs.map(d => String(d[campo]));
    if (!llaves.length) continue;
    for (const { art_id } of sqlite.prepare(`SELECT DISTINCT art_id FROM ${tabla}
      WHERE sucursal_id=? AND ${campo} IN (SELECT value FROM json_each(?))`).all(sucursalId, JSON.stringify(llaves))) {
      ids.add(art_id);
    }
  }
  for (const a of lote.articulos || []) ids.add(String(a.art_id));
  for (const e of lote.existencias || []) ids.add(String(e.art_id));
  return [...ids];
}

/** Marca las claves actuales de esos art_id de esa tienda. Conserva el `desde` más viejo. */
function marcarPendientes(sqlite, sucursal_id, art_ids, ahora = new Date().toISOString()) {
  if (!art_ids?.length || !hayTiendas(sqlite)) return 0;
  return sqlite.prepare(`INSERT INTO seguimiento_pendientes(clave, desde)
    SELECT DISTINCT clave, ? FROM sicar_articulos WHERE sucursal_id=? AND clave IS NOT NULL AND trim(clave) <> ''
      AND art_id IN (SELECT value FROM json_each(?))
    ON CONFLICT(clave) DO NOTHING`).run(ahora, Number(sucursal_id), JSON.stringify(art_ids.map(String))).changes;
}

module.exports = { artIdsDelLote, marcarPendientes };
