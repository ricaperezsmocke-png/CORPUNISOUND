// Empaques (rollos de cable) por clave Solcor. SICAR no trae la unidad de venta: el sistema solo SUGIERE rollo de 100 a
// las claves cuya descripción empieza con CABLE, y nada redondea el pedido hasta que una persona lo confirma.
const PIEZA = 10000, ROLLO_SUGERIDO = 100 * PIEZA;
const error = (status, mensaje) => Object.assign(new Error(mensaje), { status });

function listarEmpaques(sqlite) {
  const claves = sqlite.prepare(`SELECT a.clave, MIN(a.descripcion) descripcion, e.tamano_diezmilesimas, e.confirmado_por, e.confirmado_en
    FROM sicar_articulos a LEFT JOIN resurtido_empaques e ON e.clave=a.clave
    WHERE UPPER(TRIM(a.departamento))='SOLCOR' AND a.clave IS NOT NULL AND TRIM(a.clave)<>''
    GROUP BY a.clave ORDER BY a.clave`).all().map(f => ({
    clave: f.clave, descripcion: f.descripcion.trim(),
    sugerido: f.descripcion.trim().toUpperCase().startsWith('CABLE') ? ROLLO_SUGERIDO : null,
    confirmado: f.confirmado_por ? { tamano: f.tamano_diezmilesimas, por: f.confirmado_por, en: f.confirmado_en } : null,
  }));
  const historial = sqlite.prepare('SELECT * FROM resurtido_empaques_historial ORDER BY id DESC LIMIT 200').all();
  return { claves, historial };
}

const esSolcor = (sqlite, clave) => !!sqlite.prepare(`SELECT 1 FROM sicar_articulos
  WHERE clave=? AND UPPER(TRIM(departamento))='SOLCOR'`).get(clave);
const registrar = (sqlite, clave, accion, anterior, nuevo, actor, ahora) => sqlite.prepare(`INSERT INTO resurtido_empaques_historial
  (clave, accion, anterior, nuevo, actor, fecha) VALUES (?,?,?,?,?,?)`).run(clave, accion, anterior, nuevo, String(actor), ahora);

// Confirma o cambia el tamaño: cualquier entero de piezas mayor a 1 (100, 200...).
function confirmarEmpaque(sqlite, datos, actor, ahora = new Date().toISOString()) {
  const clave = typeof datos?.clave === 'string' ? datos.clave.trim() : '';
  const piezas = datos?.piezas;
  if (!clave || !Number.isSafeInteger(piezas) || piezas < 2 || piezas > 100000) {
    throw error(400, 'El empaque debe ser un número entero de piezas mayor a 1.');
  }
  return sqlite.transaction(() => {
    if (!esSolcor(sqlite, clave)) throw error(404, 'Esa clave no es de Solcor.');
    const anterior = sqlite.prepare('SELECT tamano_diezmilesimas t FROM resurtido_empaques WHERE clave=?').get(clave)?.t ?? null;
    sqlite.prepare(`INSERT INTO resurtido_empaques(clave, tamano_diezmilesimas, confirmado_por, confirmado_en) VALUES (?,?,?,?)
      ON CONFLICT(clave) DO UPDATE SET tamano_diezmilesimas=excluded.tamano_diezmilesimas, confirmado_por=excluded.confirmado_por,
        confirmado_en=excluded.confirmado_en`).run(clave, piezas * PIEZA, String(actor), ahora);
    registrar(sqlite, clave, 'confirmar', anterior, piezas * PIEZA, actor, ahora);
    return { ok: true };
  }).immediate();
}

function quitarEmpaque(sqlite, datos, actor, ahora = new Date().toISOString()) {
  const clave = typeof datos?.clave === 'string' ? datos.clave.trim() : '';
  return sqlite.transaction(() => {
    const anterior = sqlite.prepare('SELECT tamano_diezmilesimas t FROM resurtido_empaques WHERE clave=?').get(clave);
    if (!anterior) throw error(404, 'Esa clave no tiene empaque confirmado.');
    sqlite.prepare('DELETE FROM resurtido_empaques WHERE clave=?').run(clave);
    registrar(sqlite, clave, 'quitar', anterior.t, null, actor, ahora);
    return { ok: true };
  }).immediate();
}

module.exports = { listarEmpaques, confirmarEmpaque, quitarEmpaque, ROLLO_SUGERIDO };
