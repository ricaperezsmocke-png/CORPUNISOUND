const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "datos.sqlite");
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
