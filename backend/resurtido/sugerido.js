// Sugerido de pedido (revisión periódica hasta el máximo). Solo lectura: no guarda pedidos ni manda nada.
const { fechaLocal } = require('../fechas');
const { pendientePedidos } = require('./llegadas');
const DIA = 86400000;
const DIAS_EN_CAMINO = 45;
const NO_SE_PIDEN = ['no_se_mueve', 'sin_movimiento'];

// Traspasos hacia la tienda que ya salieron y no se han recibido. Misma deduplicación de puntas que movimientos.js:
// un traspaso visto por el agente de origen y por el de destino cuenta una vez. Más de 45 días sin recibir se reporta
// aparte (perdido o mal capturado) y no descuenta del pedido.
function enCamino(sqlite, sucursal_id, ahora = new Date().toISOString()) {
  const suc = Number(sucursal_id), hoy = fechaLocal(ahora);
  const limite = new Date(Date.parse(`${hoy}T00:00:00Z`) - DIAS_EN_CAMINO * DIA).toISOString().slice(0, 10);
  const filas = sqlite.prepare(`WITH puntas AS (
    SELECT t.*, o.sucursal_id origen, de.sucursal_id destino,
      ROW_NUMBER() OVER (PARTITION BY t.folio,t.suc_origen,t.suc_destino
        ORDER BY CASE WHEN t.sucursal_id=? THEN 0 ELSE 1 END,t.sucursal_id,t.tra_id) orden
    FROM sicar_traspasos t LEFT JOIN sicar_sucursales_mapa o ON o.sicar_sucursal=t.suc_origen
    LEFT JOIN sicar_sucursales_mapa de ON de.sicar_sucursal=t.suc_destino
    WHERE de.sucursal_id=?
  ) SELECT a.clave, SUBSTR(p.fecha,1,10) >= ? reciente,
    SUM(CAST(ROUND(CAST(d.cantidad AS REAL)*10000) AS INTEGER)) cantidad
    FROM puntas p JOIN sicar_traspasos_detalle d ON d.sucursal_id=p.sucursal_id AND d.tra_id=p.tra_id
    JOIN sicar_articulos a ON a.sucursal_id=d.sucursal_id AND a.art_id=d.art_id
    WHERE p.orden=1 AND p.estado='enviado' GROUP BY a.clave, reciente`).all(suc, suc, limite);
  const porClave = new Map(), viejo = new Map();
  for (const f of filas) (f.reciente ? porClave : viejo).set(f.clave, f.cantidad);
  // Pedidos aprobados o enviados al proveedor que todavía no llegan a la tienda (mismo tope de 45 días).
  for (const [clave, falta] of pendientePedidos(sqlite, suc, limite)) {
    if (falta > 0) porClave.set(clave, (porClave.get(clave) || 0) + falta);
  }
  return { porClave, viejo };
}

// Diezmilésimas, redondeado hacia arriba a pieza entera; null si la tienda tiene datos atrasados.
function calcularSugerido(fila, camino, atrasada) {
  if (atrasada) return null;
  if (fila.ya_no_la_maneja || fila.ya_no_es_marca) return 0;
  if (NO_SE_PIDEN.includes(fila.lista) && !(fila.ajuste?.maximo > 0)) return 0;
  const falta = fila.maximo - Math.max(fila.existencia, 0) - (camino || 0);
  return falta > 0 ? Math.ceil(falta / 10000) * 10000 : 0;
}

module.exports = { enCamino, calcularSugerido, DIAS_EN_CAMINO };
