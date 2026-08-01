const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

/**
 * Dónde vive la base de datos.
 *
 * En Render, DB_PATH apunta al disco persistente montado (/var/data/...).
 * Sin esa variable cae al directorio del backend, que en Render es EFÍMERO:
 * ahí los datos se borran en cada reinicio o redespliegue. Por eso el arranque
 * dice en voz alta cuál de los dos casos es — perder ventas, gastos y
 * garantías en silencio es el peor final posible para este sistema.
 */
const RUTA_POR_DEFECTO = path.join(__dirname, "datos.sqlite");
const DB_PATH = process.env.DB_PATH || RUTA_POR_DEFECTO;
const carpeta = path.dirname(DB_PATH);

// Si la carpeta no existía y DB_PATH venía de la variable de entorno, lo más
// probable es que el disco NO se haya montado: se crea igual para que el
// backend arranque (una tienda que no puede vender es peor), pero se avisa.
const carpetaExistia = fs.existsSync(carpeta);
if (!carpetaExistia) fs.mkdirSync(carpeta, { recursive: true });

if (!process.env.DB_PATH) {
  console.warn(
    "⚠️  DB_PATH no está configurada: la base de datos se guarda en " +
    `${RUTA_POR_DEFECTO}. En Render eso es almacenamiento EFÍMERO y los datos ` +
    "se perderán al reiniciar. Configura DB_PATH apuntando al disco persistente."
  );
} else if (!carpetaExistia) {
  console.warn(
    `⚠️  DB_PATH apunta a ${DB_PATH} pero la carpeta ${carpeta} no existía y se ` +
    "tuvo que crear. Si esperabas un disco persistente, probablemente NO está " +
    "montado y los datos se perderán al reiniciar. Revisa el disco en Render."
  );
} else {
  console.log(`✅ Persistencia en ${DB_PATH}`);
}

const sqlite = new Database(DB_PATH);

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS estado (
    id   INTEGER PRIMARY KEY CHECK (id = 1),
    datos TEXT NOT NULL,
    actualizado TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

const _leer    = sqlite.prepare("SELECT datos FROM estado WHERE id = 1");
const _guardar = sqlite.prepare(`
  INSERT INTO estado (id, datos) VALUES (1, ?)
  ON CONFLICT(id) DO UPDATE
    SET datos = excluded.datos,
        actualizado = CURRENT_TIMESTAMP
`);

function cargar() {
  const fila = _leer.get();
  return fila ? JSON.parse(fila.datos) : null;
}

function guardar(db) {
  _guardar.run(JSON.stringify(db));
}

module.exports = { cargar, guardar };
