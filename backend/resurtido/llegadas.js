// Lo que ya llegó de cada pedido: traspasos CEDIS → tienda aplicados (recibidos) después de la aprobación.
// Se calcula siempre desde SICAR para que el sugerido y el cierre cuenten la misma historia.
const { momentoLocal } = require('../fechas');

const momento = iso => { const m = momentoLocal(iso); return `${m.fecha} ${m.hhmm}`; };
const momentoSicar = texto => String(texto || '').replace('T', ' ').slice(0, 16);

// Traspasos de CEDIS (sucursal 6) hacia la tienda, con la misma deduplicación de puntas que movimientos.js.
function traspasosCedis(sqlite, suc, estado) {
  return sqlite.prepare(`WITH puntas AS (
    SELECT t.*, o.sucursal_id origen,
      ROW_NUMBER() OVER (PARTITION BY t.folio,t.suc_origen,t.suc_destino
        ORDER BY CASE WHEN t.sucursal_id=? THEN 0 ELSE 1 END,t.sucursal_id,t.tra_id) orden
    FROM sicar_traspasos t LEFT JOIN sicar_sucursales_mapa o ON o.sicar_sucursal=t.suc_origen
    LEFT JOIN sicar_sucursales_mapa de ON de.sicar_sucursal=t.suc_destino
    WHERE de.sucursal_id=?
  ) SELECT a.clave, COALESCE(p.fecha_aplicado,p.fecha) fecha_aplicado, p.fecha,
    SUM(CAST(ROUND(CAST(d.cantidad AS REAL)*10000) AS INTEGER)) cantidad
    FROM puntas p JOIN sicar_traspasos_detalle d ON d.sucursal_id=p.sucursal_id AND d.tra_id=p.tra_id
    JOIN sicar_articulos a ON a.sucursal_id=d.sucursal_id AND a.art_id=d.art_id
    WHERE p.orden=1 AND p.origen=6 AND p.estado=? GROUP BY p.sucursal_id,p.tra_id,a.clave`).all(suc, suc, estado);
}

// Reparte cada llegada al pedido aprobado más viejo de esa tienda y clave que todavía no se completa.
// Un pedido surtido solo recibe lo que llegó antes de cerrarse. Devuelve Map `${pedido_id}|${clave}` → diezmilésimas.
function asignarLlegadas(sqlite, suc) {
  const renglones = sqlite.prepare(`SELECT r.pedido_id, r.clave, r.pedido, p.aprobado_en, p.cerrado_en, p.estado
    FROM resurtido_pedido_renglones r JOIN resurtido_pedidos p ON p.id=r.pedido_id
    WHERE r.sucursal_id=? AND r.estado='activo' AND p.estado IN ('aprobado','enviado','surtido') AND p.aprobado_en IS NOT NULL
    ORDER BY p.aprobado_en, p.id`).all(suc).map(r => ({ ...r, desde: momento(r.aprobado_en),
    hasta: r.estado === 'surtido' && r.cerrado_en ? momento(r.cerrado_en) : null, llegado: 0 }));
  const llegadas = traspasosCedis(sqlite, suc, 'recibido').map(l => ({ ...l, cuando: momentoSicar(l.fecha_aplicado) }))
    .sort((a, b) => a.cuando.localeCompare(b.cuando));
  for (const l of llegadas) {
    let resto = l.cantidad;
    for (const r of renglones) {
      if (resto <= 0) break;
      if (r.clave !== l.clave || l.cuando < r.desde || (r.hasta && l.cuando > r.hasta)) continue;
      const toma = Math.min(resto, r.pedido - r.llegado);
      if (toma > 0) { r.llegado += toma; resto -= toma; }
    }
  }
  return new Map(renglones.map(r => [`${r.pedido_id}|${r.clave}`, r.llegado]));
}

// Lo pedido y aprobado (hasta 45 días) que todavía no llega, por clave, sin lo que CEDIS ya mandó y viene en camino:
// ese traspaso ya lo cuenta enCamino.
function pendientePedidos(sqlite, suc, limite) {
  const llegado = asignarLlegadas(sqlite, suc), porClave = new Map();
  const renglones = sqlite.prepare(`SELECT r.pedido_id, r.clave, r.pedido, p.aprobado_en
    FROM resurtido_pedido_renglones r JOIN resurtido_pedidos p ON p.id=r.pedido_id
    WHERE r.sucursal_id=? AND r.estado='activo' AND p.estado IN ('aprobado','enviado') AND p.aprobado_en IS NOT NULL`).all(suc);
  for (const r of renglones) {
    const desde = momento(r.aprobado_en);
    if (desde.slice(0, 10) < limite) continue;
    const falta = r.pedido - (llegado.get(`${r.pedido_id}|${r.clave}`) || 0);
    if (falta <= 0) continue;
    const actual = porClave.get(r.clave) || { falta: 0, desde };
    porClave.set(r.clave, { falta: actual.falta + falta, desde: desde < actual.desde ? desde : actual.desde });
  }
  const transito = new Map();
  for (const t of traspasosCedis(sqlite, suc, 'enviado')) {
    const p = porClave.get(t.clave);
    if (p && momentoSicar(t.fecha) >= p.desde) transito.set(t.clave, (transito.get(t.clave) || 0) + t.cantidad);
  }
  return new Map([...porClave].map(([clave, p]) => [clave, Math.max(0, p.falta - (transito.get(clave) || 0))]));
}

module.exports = { asignarLlegadas, pendientePedidos, momento, momentoSicar };
