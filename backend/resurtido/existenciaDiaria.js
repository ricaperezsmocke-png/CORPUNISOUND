const { fechaLocal } = require('../fechas');
const { TIENDAS } = require('./config');
const { existenciaActual } = require('./lector');
const { movimientos, deltaInverso } = require('./movimientos');

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

function reconstruir(sqlite, sucursal_id, desde, hasta) {
  const { porClave } = existenciaActual(sqlite, sucursal_id);
  const cambios = movimientos(sqlite, sucursal_id, desde, hasta);
  const guardar = sqlite.prepare(`INSERT INTO resurtido_existencia_diaria VALUES (?,?,?,?,'reconstruida')
    ON CONFLICT(sucursal_id,clave,dia) DO UPDATE SET piezas_diezmilesimas=excluded.piezas_diezmilesimas
    WHERE resurtido_existencia_diaria.origen='reconstruida'`);
  return sqlite.transaction(() => {
    let filas = 0; const raras = new Set();
    for (const [clave, actual] of porClave) {
      let valor = actual;
      for (let ms = Date.parse(`${hasta}T00:00:00Z`); ms >= Date.parse(`${desde}T00:00:00Z`); ms -= 86400000) {
        const dia = new Date(ms).toISOString().slice(0, 10);
        // Valor aproximado al deshacer los movimientos del día, como el ejemplo 5 + 3 - 10 del plan.
        valor += deltaInverso(cambios.get(clave)?.get(dia));
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
