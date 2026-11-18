const { fechaLocal } = require('../fechas');
const { TIENDAS } = require('./config');
const { existenciaActual, ventasDiarias } = require('./lector');

const SQL_OBSERVAR = `INSERT INTO resurtido_existencia_diaria
  (sucursal_id,clave,dia,piezas_diezmilesimas,origen) VALUES (?,?,?,?,'foto')
  ON CONFLICT(sucursal_id,clave,dia) DO UPDATE SET piezas_diezmilesimas=
    CASE WHEN origen='foto' THEN MIN(piezas_diezmilesimas,excluded.piezas_diezmilesimas)
    ELSE excluded.piezas_diezmilesimas END, origen='foto'`;

function tomarFoto(sqlite, dia, ahora, tiendas = TIENDAS) {
  const guardar = sqlite.prepare(SQL_OBSERVAR);
  return sqlite.transaction(() => {
    let filas = 0, observadas = 0;
    for (const suc of tiendas.filter(id => TIENDAS.includes(id))) {
      const { porClave } = existenciaActual(sqlite, suc);
      if (porClave.size) observadas++;
      for (const [clave, piezas] of porClave) { guardar.run(suc, clave, dia, piezas); filas++; }
    }
    return { tiendas: observadas, filas };
  })();
}

// Se llama dentro de la transacción de ingesta. El savepoint aísla fallas de observación.
function observarExistencias(sqlite, sucursal_id, existencias, ahora) {
  if (!TIENDAS.includes(Number(sucursal_id)) || !existencias?.length) return;
  try {
    sqlite.transaction(() => {
      const buscar = sqlite.prepare(`SELECT clave FROM sicar_articulos WHERE sucursal_id=? AND art_id=?
        AND UPPER(TRIM(departamento)) IN ('JR','SOLCOR') AND TRIM(clave)<>''`);
      const sumar = sqlite.prepare(`SELECT SUM(e.existencia_diezmilesimas) piezas FROM sicar_existencias e
        JOIN sicar_articulos a ON a.sucursal_id=e.sucursal_id AND a.art_id=e.art_id
        WHERE a.sucursal_id=? AND a.clave=? AND UPPER(TRIM(a.departamento)) IN ('JR','SOLCOR')`);
      const claves = new Set(existencias.filter(e => e.existencia !== null)
        .map(e => buscar.get(sucursal_id, e.art_id)?.clave).filter(Boolean));
      const guardar = sqlite.prepare(SQL_OBSERVAR), dia = fechaLocal(ahora);
      for (const clave of claves) {
        const { piezas } = sumar.get(sucursal_id, clave);
        if (piezas !== null) guardar.run(sucursal_id, clave, dia, piezas);
      }
    })();
  } catch (e) { console.warn('RESURTIDO_OBSERVACION_FALLO', e.message); }
}

function movimientosTraspaso(sqlite, sucursal_id, desde, hasta) {
  const filas = sqlite.prepare(`WITH puntas AS (
    SELECT t.*, o.sucursal_id origen, de.sucursal_id destino,
      ROW_NUMBER() OVER (PARTITION BY t.folio,t.suc_origen,t.suc_destino
        ORDER BY CASE WHEN t.sucursal_id=de.sucursal_id THEN 0 ELSE 1 END,t.sucursal_id,t.tra_id) orden
    FROM sicar_traspasos t JOIN sicar_sucursales_mapa o ON o.sicar_sucursal=t.suc_origen
    JOIN sicar_sucursales_mapa de ON de.sicar_sucursal=t.suc_destino
    WHERE t.estado='aplicado' AND (o.sucursal_id=? OR de.sucursal_id=?)
  ) SELECT a.clave, SUBSTR(COALESCE(p.fecha_aplicado,p.fecha),1,10) dia,
    SUM(CAST(ROUND(CAST(d.cantidad AS REAL)*10000) AS INTEGER) *
      (CASE WHEN p.origen=? THEN 1 ELSE 0 END - CASE WHEN p.destino=? THEN 1 ELSE 0 END)) delta
    FROM puntas p JOIN sicar_traspasos_detalle d ON d.sucursal_id=p.sucursal_id AND d.tra_id=p.tra_id
    JOIN sicar_articulos a ON a.sucursal_id=d.sucursal_id AND a.art_id=d.art_id
    WHERE p.orden=1 AND SUBSTR(COALESCE(p.fecha_aplicado,p.fecha),1,10) BETWEEN ? AND ?
    GROUP BY a.clave,dia`).all(sucursal_id, sucursal_id, sucursal_id, sucursal_id, desde, hasta);
  const resultado = new Map();
  for (const f of filas) {
    if (!resultado.has(f.clave)) resultado.set(f.clave, new Map());
    resultado.get(f.clave).set(f.dia, f.delta);
  }
  return resultado;
}

function reconstruir(sqlite, sucursal_id, desde, hasta) {
  const { porClave } = existenciaActual(sqlite, sucursal_id);
  const ventas = ventasDiarias(sqlite, sucursal_id, desde);
  const traspasos = movimientosTraspaso(sqlite, sucursal_id, desde, hasta);
  const guardar = sqlite.prepare(`INSERT OR IGNORE INTO resurtido_existencia_diaria VALUES (?,?,?,?,'reconstruida')`);
  return sqlite.transaction(() => {
    let filas = 0; const raras = new Set();
    for (const [clave, actual] of porClave) {
      let valor = actual;
      for (let ms = Date.parse(`${hasta}T00:00:00Z`); ms >= Date.parse(`${desde}T00:00:00Z`); ms -= 86400000) {
        const dia = new Date(ms).toISOString().slice(0, 10);
        // Valor aproximado al deshacer los movimientos del día, como el ejemplo 5 + 3 - 10 del plan.
        valor += (ventas.get(clave)?.get(dia) || 0) + (traspasos.get(clave)?.get(dia) || 0);
        if (valor < -20000) raras.add(clave);
        filas += guardar.run(sucursal_id, clave, dia, Math.max(0, valor)).changes;
      }
    }
    return { filas, rara: raras.size };
  })();
}

function diasEnCero(sqlite, sucursal_id, clave, desde, hasta) {
  return new Set(sqlite.prepare(`SELECT dia FROM resurtido_existencia_diaria
    WHERE sucursal_id=? AND clave=? AND dia BETWEEN ? AND ? AND piezas_diezmilesimas<=0 ORDER BY dia`)
    .all(sucursal_id, clave, desde, hasta).map(f => f.dia));
}
module.exports = { tomarFoto, reconstruir, diasEnCero, observarExistencias };
