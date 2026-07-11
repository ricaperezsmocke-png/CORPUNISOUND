/**
 * clavesSat.js — Búsqueda de solo-lectura sobre la tabla `claves_sat`
 * (importada una sola vez por scripts/importarClavesSat.js). Se consulta
 * siempre con SQL directo — nunca se carga al objeto DB en memoria.
 */

const path = require("path");
const Database = require("better-sqlite3");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "datos.sqlite");
const RESULTADOS_POR_PAGINA = 20;

let _conexion = null;
function conexion() {
  if (!_conexion) _conexion = new Database(DB_PATH, { readonly: true, fileMustExist: false });
  return _conexion;
}

function buscarClavesSat(texto, pagina) {
  const db = conexion();
  const tablaExiste = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='claves_sat'").get();
  if (!tablaExiste) return { resultados: [], total: 0 };

  const like = `%${(texto || "").trim()}%`;
  const paginaNum = Math.max(1, Number(pagina) || 1);

  const total = db.prepare("SELECT COUNT(*) AS n FROM claves_sat WHERE clave LIKE ? OR descripcion LIKE ?").get(like, like).n;
  const resultados = db.prepare(
    "SELECT clave, descripcion FROM claves_sat WHERE clave LIKE ? OR descripcion LIKE ? ORDER BY descripcion LIMIT ? OFFSET ?"
  ).all(like, like, RESULTADOS_POR_PAGINA, (paginaNum - 1) * RESULTADOS_POR_PAGINA);

  return { resultados, total };
}

module.exports = { buscarClavesSat };
