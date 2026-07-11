/**
 * importarClavesSat.js — Importa el catálogo oficial de Claves de Productos
 * y Servicios del SAT (c_ClaveProdServ, ~55,000 registros) a una tabla
 * de solo-lectura `claves_sat` dentro de datos.sqlite.
 *
 * Se corre UNA SOLA VEZ (o cuando el catálogo del SAT se actualice) — no es
 * parte del arranque normal del backend. La fuente es el paquete compilado
 * de phpcfdi/resources-sat-catalogs, que empaqueta los catálogos oficiales
 * del SAT en una base SQLite ya lista, actualizada automáticamente por ese
 * proyecto open-source.
 *
 * Uso: node backend/scripts/importarClavesSat.js
 */

const https = require("https");
const fs = require("fs");
const path = require("path");
const unbzip2 = require("unbzip2-stream");
const Database = require("better-sqlite3");

const URL_CATALOGO = "https://github.com/phpcfdi/resources-sat-catalogs/releases/latest/download/catalogs.db.bz2";
const ARCHIVO_TEMPORAL = path.join(__dirname, "catalogs.db");
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "datos.sqlite");
const TABLA_ORIGEN = "cfdi_40_productos_servicios";
const MINIMO_FILAS_ESPERADAS = 10000;

function descargarYDescomprimir(url, destino) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return descargarYDescomprimir(res.headers.location, destino).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`Descarga falló: HTTP ${res.statusCode} en ${url}`));
      }
      const salida = fs.createWriteStream(destino);
      res.pipe(unbzip2()).pipe(salida);
      salida.on("finish", resolve);
      salida.on("error", reject);
    }).on("error", reject);
  });
}

function encontrarColumna(db, tabla, candidatos) {
  const columnas = db.prepare(`PRAGMA table_info(${tabla})`).all().map((c) => c.name);
  for (const candidato of candidatos) {
    const encontrada = columnas.find((c) => c.toLowerCase() === candidato.toLowerCase());
    if (encontrada) return encontrada;
  }
  throw new Error(
    `No se encontró ninguna columna de [${candidatos.join(", ")}] en ${tabla}. ` +
    `Columnas reales: ${columnas.join(", ")}. Ajusta la lista de candidatos en este script.`
  );
}

async function main() {
  console.log("Descargando catálogo SAT (catalogs.db.bz2)...");
  await descargarYDescomprimir(URL_CATALOGO, ARCHIVO_TEMPORAL);
  console.log("Descarga y descompresión completas.");

  const catalogosDb = new Database(ARCHIVO_TEMPORAL, { readonly: true });
  const colClave = encontrarColumna(catalogosDb, TABLA_ORIGEN, ["c_clave_prod_serv", "clave_prod_serv", "clave", "id"]);
  const colDescripcion = encontrarColumna(catalogosDb, TABLA_ORIGEN, ["descripcion", "descripción", "texto"]);
  console.log(`Usando columnas: clave="${colClave}", descripcion="${colDescripcion}"`);

  const filas = catalogosDb.prepare(`SELECT "${colClave}" AS clave, "${colDescripcion}" AS descripcion FROM ${TABLA_ORIGEN}`).all();
  catalogosDb.close();
  fs.unlinkSync(ARCHIVO_TEMPORAL);

  if (filas.length < MINIMO_FILAS_ESPERADAS) {
    throw new Error(`Solo se encontraron ${filas.length} claves — se esperaban al menos ${MINIMO_FILAS_ESPERADAS}. Revisa la fuente antes de continuar.`);
  }

  const db = new Database(DB_PATH);
  db.exec(`
    DROP TABLE IF EXISTS claves_sat;
    CREATE TABLE claves_sat (clave TEXT PRIMARY KEY, descripcion TEXT NOT NULL);
    CREATE INDEX idx_claves_sat_descripcion ON claves_sat (descripcion);
  `);
  const insertar = db.prepare("INSERT OR REPLACE INTO claves_sat (clave, descripcion) VALUES (?, ?)");
  const transaccion = db.transaction((lista) => { for (const f of lista) insertar.run(f.clave, f.descripcion); });
  transaccion(filas);
  db.close();

  console.log(`Listo: ${filas.length} claves SAT importadas a ${DB_PATH}`);
}

main().catch((e) => {
  console.error("Error al importar el catálogo de Claves SAT:", e.message);
  process.exit(1);
});
