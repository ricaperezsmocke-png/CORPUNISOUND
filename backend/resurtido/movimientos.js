// Lectura de movimientos físicos: las cuentas internas también sacan existencia.
const { ventasDiarias } = require('./lector');

function movimientos(sqlite, sucursal_id, desde, hasta) {
  const resultado = new Map();
  function sumar(clave, dia, campo, cantidad) {
    if (dia < desde || dia > hasta) return;
    if (!resultado.has(clave)) resultado.set(clave, new Map());
    const dias = resultado.get(clave);
    if (!dias.has(dia)) dias.set(dia, { ventas: 0, entradas_traspaso: 0, entradas_compra: 0, salidas_traspaso: 0 });
    dias.get(dia)[campo] += cantidad;
  }
  for (const [clave, dias] of ventasDiarias(sqlite, sucursal_id, desde, true)) {
    for (const [dia, cantidad] of dias) sumar(clave, dia, 'ventas', cantidad);
  }
  const traspasos = sqlite.prepare(`WITH puntas AS (
    SELECT t.*, o.sucursal_id origen, de.sucursal_id destino,
      ROW_NUMBER() OVER (PARTITION BY t.folio,t.suc_origen,t.suc_destino
        ORDER BY CASE WHEN t.sucursal_id=? THEN 0 ELSE 1 END,t.sucursal_id,t.tra_id) orden
    FROM sicar_traspasos t LEFT JOIN sicar_sucursales_mapa o ON o.sicar_sucursal=t.suc_origen
    LEFT JOIN sicar_sucursales_mapa de ON de.sicar_sucursal=t.suc_destino
    WHERE o.sucursal_id=? OR de.sucursal_id=?
  ) SELECT p.*,a.clave,CAST(ROUND(CAST(d.cantidad AS REAL)*10000) AS INTEGER) cantidad
    FROM puntas p JOIN sicar_traspasos_detalle d ON d.sucursal_id=p.sucursal_id AND d.tra_id=p.tra_id
    JOIN sicar_articulos a ON a.sucursal_id=d.sucursal_id AND a.art_id=d.art_id
    WHERE p.orden=1 AND p.estado IN ('enviado','recibido')`).all(sucursal_id, sucursal_id, sucursal_id);
  for (const f of traspasos) {
    if (f.origen === sucursal_id) sumar(f.clave, f.fecha.slice(0, 10), 'salidas_traspaso', f.cantidad);
    if (f.destino === sucursal_id && f.estado === 'recibido') {
      sumar(f.clave, (f.fecha_aplicado || f.fecha).slice(0, 10), 'entradas_traspaso', f.cantidad);
    }
  }
  const compras = sqlite.prepare(`SELECT a.clave,SUBSTR(c.fecha,1,10) dia,
    SUM(CAST(ROUND(CAST(d.cantidad AS REAL)*d.factor_diezmilesimas) AS INTEGER)) cantidad
    FROM sicar_compras c JOIN sicar_compras_detalle d ON d.sucursal_id=c.sucursal_id AND d.com_id=c.com_id
    JOIN sicar_articulos a ON a.sucursal_id=d.sucursal_id AND a.art_id=d.art_id
    WHERE c.sucursal_id=? AND c.estado='vigente' AND SUBSTR(c.fecha,1,10) BETWEEN ? AND ?
    GROUP BY a.clave,dia`).all(sucursal_id, desde, hasta);
  for (const f of compras) sumar(f.clave, f.dia, 'entradas_compra', f.cantidad);
  return resultado;
}

function deltaInverso(m) {
  return m ? m.ventas + m.salidas_traspaso - m.entradas_traspaso - m.entradas_compra : 0;
}
module.exports = { movimientos, deltaInverso };
