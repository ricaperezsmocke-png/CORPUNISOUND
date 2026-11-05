const { aDiezmilesimas } = require('../cantidades');
const { leerConfig } = require('./config');

const error = (status, mensaje) => Object.assign(new Error(mensaje), { status });

function leerFoto(sqlite, sucursalId, ahora) {
  const corte = sqlite.prepare('SELECT max(actualizado_en) corte FROM sicar_existencias WHERE sucursal_id=?')
    .get(sucursalId).corte;
  const repetidas = new Set(sqlite.prepare(`SELECT clave FROM sicar_articulos
    WHERE sucursal_id=? AND clave IS NOT NULL GROUP BY clave HAVING count(*) > 1`).all(sucursalId).map(a => a.clave));
  // CAST evita convertir INTEGER de SQLite a un Number que perdería piezas por encima de 2^53.
  const existencias = sqlite.prepare(`SELECT a.clave, CAST(e.existencia_diezmilesimas AS TEXT) piezas
    FROM sicar_existencias e LEFT JOIN sicar_articulos a ON a.sucursal_id=e.sucursal_id AND a.art_id=e.art_id
    WHERE e.sucursal_id=? ORDER BY a.clave, e.art_id`).all(sucursalId);
  const claves = [], problemas = [];
  for (const { clave, piezas } of existencias) {
    // La fuente ya está en diezmilésimas: deshacer la escala del conversor mantiene el entero exacto.
    const cantidad = aDiezmilesimas(piezas) / 10000n;
    const motivos = [];
    if (!clave?.trim()) motivos.push('sin_clave');
    else if (repetidas.has(clave)) motivos.push('clave_repetida');
    if (cantidad < 0n) motivos.push('existencia_negativa');
    if (motivos.length) problemas.push(...motivos.map(motivo => ({ clave, motivo })));
    else claves.push({ clave, piezas_diezmilesimas: cantidad.toString() });
  }
  const instante = new Date(ahora).getTime();
  const limite = leerConfig(sqlite).horas_foto_vieja * 3600000;
  const vieja = !corte || !Number.isFinite(Date.parse(corte)) || !Number.isFinite(instante)
    || !Number.isFinite(limite) || instante - Date.parse(corte) > limite;
  return { corte, claves, problemas, vieja };
}

// claves contiene filas { clave, piezas_diezmilesimas }; su longitud sirve para la vista previa.
function revisarFoto(sqlite, sucursal_id, ahora = new Date().toISOString()) {
  return sqlite.transaction(() => leerFoto(sqlite, Number(sucursal_id), ahora))();
}

function incorporar(sqlite, { sucursal_id, actor, ahora = new Date().toISOString() }) {
  const sucursalId = Number(sucursal_id);
  return sqlite.transaction(() => {
    if (!Number.isSafeInteger(sucursalId) || !sqlite.prepare('SELECT 1 FROM sicar_tiendas WHERE sucursal_id=?').get(sucursalId)) {
      throw error(400, 'La tienda no tiene agente SICAR.');
    }
    if (sqlite.prepare('SELECT 1 FROM seguimiento_tiendas WHERE sucursal_id=?').get(sucursalId)) {
      throw error(409, 'La tienda ya está incorporada al seguimiento.');
    }
    const foto = leerFoto(sqlite, sucursalId, ahora);
    if (foto.vieja) throw error(409, 'La foto de existencias es vieja o no tiene un corte válido.');
    sqlite.prepare('INSERT INTO seguimiento_tiendas(sucursal_id, corte, actor, fecha) VALUES (?, ?, ?, ?)')
      .run(sucursalId, foto.corte, actor, new Date(ahora).toISOString());
    const guardarFoto = sqlite.prepare('INSERT INTO seguimiento_foto(sucursal_id, clave, piezas_diezmilesimas) VALUES (?, ?, ?)');
    const guardarProblema = sqlite.prepare('INSERT INTO seguimiento_foto_problemas(sucursal_id, clave, motivo) VALUES (?, ?, ?)');
    for (const fila of foto.claves) guardarFoto.run(sucursalId, fila.clave, fila.piezas_diezmilesimas);
    for (const problema of foto.problemas) guardarProblema.run(sucursalId, problema.clave, problema.motivo);
    return foto;
  }).immediate();
}

module.exports = { revisarFoto, incorporar };
