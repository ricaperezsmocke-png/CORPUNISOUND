const Database = require('better-sqlite3');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { empaquetar, desempaquetar } = require('./respaldoCifrado');

// Orden de dependencias: permite validar también las claves foráneas en preparación.
const TABLAS = Object.freeze(['sicar_esquema', 'sicar_tiendas', 'sicar_llaves', 'sicar_clientes',
  'sicar_vinculos', 'sicar_decisiones', 'sicar_ventas', 'sicar_detalles', 'sicar_envios', 'sicar_intentos']);
const MAX_TROZO = 2 * 1024 * 1024;
// Margen para cabecera, gzip y cifrado, incluso con datos que no comprimen.
const MAX_FILAS_BYTES = MAX_TROZO - 65536;
const MAX_TROZOS = 4096;
const PREFIJO = 'preparacion_';
const contextos = new WeakMap();
const preparando = new WeakSet();
const fotografiando = new WeakSet();
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function configurarContexto(repo, contexto) { contextos.set(repo, contexto); }

function tieneDatosSicar(repo) {
  const sqlite = repo.conexionParaRespaldo();
  return TABLAS.slice(1).some(tabla => !!sqlite.prepare(`SELECT 1 FROM ${tabla} LIMIT 1`).get());
}

function columnas(sqlite, tabla) {
  return sqlite.prepare(`PRAGMA table_info(${tabla})`).all().map(c => c.name);
}

function tamano(ruta) {
  try { return fs.statSync(ruta).size; }
  catch (e) { if (e.code === 'ENOENT') return 0; throw e; }
}

function comprobarDisco(sqlite, adicional = 0) {
  if (sqlite.memory) throw new Error('El respaldo SICAR requiere SQLite persistente para una lectura independiente.');
  const espacio = fs.statfsSync(sqlite.name);
  const usados = tamano(sqlite.name) + tamano(`${sqlite.name}-wal`);
  if (espacio.bavail * espacio.bsize - adicional < 250 * 1024 * 1024 || usados + adicional > 750 * 1024 * 1024) {
    throw new Error('No hay reserva de espacio en disco suficiente para el respaldo o la restauración SICAR.');
  }
}

function validarManifiesto(m) {
  if (!m || m.estado !== 'completo' || m.version_esquema !== 2 || m.version !== 1) {
    throw new Error('El respaldo SICAR está incompleto o tiene una versión de esquema incompatible.');
  }
  if (typeof m.snapshot_id !== 'string' || !/^[a-f0-9-]{36}$/.test(m.snapshot_id)
    || !Array.isArray(m.trozos) || m.trozos.length > MAX_TROZOS || !m.conteos
    || Object.keys(m.conteos).length !== TABLAS.length) throw new Error('El manifiesto SICAR es inválido.');
  const conteos = Object.fromEntries(TABLAS.map(t => [t, 0]));
  let anterior = -1;
  const ids = new Set();
  for (const [i, c] of m.trozos.entries()) {
    const orden = TABLAS.indexOf(c.tabla);
    if (orden < 0 || orden < anterior || c.orden !== i || !Number.isSafeInteger(c.filas) || c.filas <= 0
      || !Number.isSafeInteger(c.bytes) || c.bytes <= 0 || c.bytes > MAX_TROZO
      || !Number.isSafeInteger(c.bytes_json) || c.bytes_json <= 0 || c.bytes_json > MAX_TROZO
      || typeof c.drive_file_id !== 'string' || !c.drive_file_id || ids.has(c.drive_file_id)
      || typeof c.hash !== 'string' || !/^[a-f0-9]{64}$/.test(c.hash)) throw new Error('Un trozo SICAR es inválido o está fuera de orden.');
    anterior = orden;
    ids.add(c.drive_file_id);
    conteos[c.tabla] += c.filas;
  }
  for (const tabla of TABLAS) {
    if (!Number.isSafeInteger(m.conteos[tabla]) || m.conteos[tabla] < 0 || m.conteos[tabla] !== conteos[tabla]) {
      throw new Error(`El respaldo SICAR está incompleto: conteo de ${tabla}.`);
    }
  }
  if (m.conteos.sicar_esquema !== 2) throw new Error('El historial de esquema SICAR está incompleto.');
}

async function leerTrozo(drive, contexto, m, c) {
  const bytes = await drive.descargarArchivoDeDriveLimitado(contexto.DB, c.drive_file_id, c.bytes);
  if (bytes.length !== c.bytes || hash(bytes) !== c.hash) throw new Error('El hash o tamaño del trozo SICAR no coincide.');
  // El hash autentica exactamente los bytes que generamos con tamaño JSON acotado.
  const datos = desempaquetar(bytes, contexto.llave);
  if (Buffer.byteLength(JSON.stringify(datos)) !== c.bytes_json || datos.snapshot_id !== m.snapshot_id
    || datos.tabla !== c.tabla || datos.orden !== c.orden || !Array.isArray(datos.filas) || datos.filas.length !== c.filas) {
    throw new Error('El contenido del trozo SICAR no coincide con el manifiesto.');
  }
  return datos.filas;
}

async function verificarSnapshotSicar(repo, drive, manifiesto) {
  validarManifiesto(manifiesto);
  const contexto = contextos.get(repo);
  if (!contexto?.llave) throw new Error('Falta configurar la llave del respaldo SICAR.');
  for (const c of manifiesto.trozos) await leerTrozo(drive, contexto, manifiesto, c);
}

async function crearSnapshotSicar(repo, drive, contexto) {
  configurarContexto(repo, contexto);
  const sqlite = repo.conexionParaRespaldo();
  if (fotografiando.has(sqlite)) throw new Error('Ya hay un respaldo SICAR en curso.');
  comprobarDisco(sqlite);
  if (sqlite.pragma('journal_mode', { simple: true }) !== 'wal') {
    throw new Error('La lectura consistente SICAR requiere el modo WAL verificado.');
  }
  fotografiando.add(sqlite);
  let lector, vigilancia, fallo, terminado = false;
  const m = { version: 1, version_esquema: 2, snapshot_id: crypto.randomUUID(),
    estado: 'completo', generado_en: new Date().toISOString(), conteos: {}, trozos: [] };
  const inicio = Date.now(), walInicial = tamano(`${sqlite.name}-wal`);
  let rechazar;
  const vencimiento = new Promise((_, reject) => { rechazar = reject; });
  const comprobar = () => {
    if (fallo) throw fallo;
    if (Date.now() - inicio >= 60000 || tamano(`${sqlite.name}-wal`) - walInicial > 32 * 1024 * 1024) {
      throw new Error('El snapshot SICAR superó el límite de 60 segundos o 32 MiB de WAL.');
    }
  };
  const esperar = promesa => Promise.race([promesa, vencimiento]);
  const cerrar = () => { if (lector?.open) { lector.exec('ROLLBACK'); lector.close(); } };
  try {
    lector = new Database(sqlite.name, { readonly: true, fileMustExist: true });
    lector.pragma('cache_size = -8192');
    lector.exec('BEGIN');
    // Fija la foto antes del primer await, incluso si Drive tarda en obtener la carpeta.
    if (lector.prepare('SELECT max(version) v FROM sicar_esquema').get().v !== 2) throw new Error('Versión SICAR incompatible.');
    vigilancia = setInterval(() => {
      try { comprobar(); } catch (e) { fallo = e; cerrar(); rechazar(e); }
    }, 100);
    const carpetaId = await esperar(drive.asegurarCarpetaRespaldos(contexto.DB));
    async function subir(tabla, filas) {
      comprobar();
      if (m.trozos.length >= MAX_TROZOS) throw new Error('El manifiesto SICAR excede el límite de trozos.');
      const datos = { snapshot_id: m.snapshot_id, tabla, orden: m.trozos.length, filas };
      const bytes_json = Buffer.byteLength(JSON.stringify(datos));
      const bytes = empaquetar(datos, contexto.llave);
      if (bytes.length > MAX_TROZO || bytes_json > MAX_TROZO) throw new Error('El trozo SICAR excede el límite de memoria.');
      const subida = drive.subirArchivoADrive(contexto.DB, { nombre: `sicar-${m.snapshot_id}-${datos.orden}.respaldo`,
        mimeType: 'application/octet-stream', contenidoBuffer: bytes, carpetaId }).then(async archivo => {
        if (!archivo?.id) throw new Error('Drive no confirmó el trozo SICAR.');
        contexto.registrarArchivo?.(archivo.id);
        if (terminado) {
          try { await drive.eliminarArchivoDeDrive(contexto.DB, archivo.id); } catch { /* El índice permite reintentar. */ }
        }
        return archivo;
      });
      const archivo = await esperar(subida);
      const c = { tabla, orden: datos.orden, filas: filas.length, bytes: bytes.length, bytes_json,
        hash: hash(bytes), drive_file_id: archivo.id };
      m.trozos.push(c);
      await esperar(leerTrozo(drive, contexto, m, c));
    }
    for (const tabla of TABLAS) {
      comprobar();
      m.conteos[tabla] = lector.prepare(`SELECT count(*) n FROM ${tabla}`).get().n;
      const campos = columnas(lector, tabla);
      const json = `json_object(${campos.map(c => `'${c}', "${c}"`).join(',')})`;
      const longitud = lector.prepare(`SELECT rowid id, length(CAST(${json} AS BLOB)) n FROM ${tabla} WHERE rowid > ? ORDER BY rowid LIMIT 1`);
      const fila = lector.prepare(`SELECT ${json} dato FROM ${tabla} WHERE rowid = ?`);
      let cursor = -1, filas = [], peso = 0;
      while (true) {
        comprobar();
        const siguiente = longitud.get(cursor);
        if (!siguiente) break;
        if (siguiente.n > MAX_FILAS_BYTES) throw new Error('Una fila SICAR excede el tamaño permitido por trozo.');
        if (peso + siguiente.n + 1 > MAX_FILAS_BYTES) { await subir(tabla, filas); filas = []; peso = 0; }
        filas.push(JSON.parse(fila.get(siguiente.id).dato));
        peso += siguiente.n + 1;
        cursor = siguiente.id;
      }
      if (filas.length) await subir(tabla, filas);
    }
    comprobar();
    validarManifiesto(m);
    m.verificado_en = new Date().toISOString();
    return m;
  } catch (e) {
    cerrar();
    // Limpieza sin esperar: un Drive colgado no puede detener el respaldo del negocio.
    // Los ids quedan en copia.sicar_archivos y la retención los vuelve a intentar.
    for (const c of m.trozos) {
      Promise.resolve().then(() => drive.eliminarArchivoDeDrive(contexto.DB, c.drive_file_id)).catch(() => {});
    }
    throw e;
  } finally {
    terminado = true;
    clearInterval(vigilancia);
    cerrar();
    fotografiando.delete(sqlite);
  }
}

function limpiarPreparacion(sqlite) {
  sqlite.transaction(() => {
    for (const tabla of [...TABLAS].reverse()) sqlite.exec(`DROP TABLE IF EXISTS ${PREFIJO}${tabla}`);
  })();
}

async function prepararRestauracionSicar(repo, drive, manifiesto) {
  validarManifiesto(manifiesto);
  const contexto = contextos.get(repo);
  if (!contexto?.llave) throw new Error('Falta configurar la llave del respaldo SICAR.');
  const sqlite = repo.conexionParaRespaldo();
  if (preparando.has(sqlite)) throw new Error('Ya hay una restauración SICAR preparada.');
  // Reserva conservadora: preparación con índices, reemplazo y journal; no depende de la compresión.
  const reserva = manifiesto.trozos.reduce((n, c) => n + c.bytes_json, 0) * 6 + tamano(sqlite.name) * 2;
  comprobarDisco(sqlite, reserva);
  preparando.add(sqlite);
  let liberada = false;
  const liberar = () => {
    if (liberada) return;
    limpiarPreparacion(sqlite);
    preparando.delete(sqlite);
    liberada = true;
  };
  try {
    limpiarPreparacion(sqlite);
    sqlite.transaction(() => {
      for (const tabla of TABLAS) {
        const original = sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(tabla).sql;
        const preparado = original.replace(/\bsicar_[a-z]+\b/g, nombre => TABLAS.includes(nombre) ? PREFIJO + nombre : nombre);
        sqlite.exec(preparado);
      }
    })();
    const renglonesAntiguos = new Map();
    for (const c of manifiesto.trozos) {
      comprobarDisco(sqlite);
      const filas = await leerTrozo(drive, contexto, manifiesto, c);
      const campos = columnas(sqlite, c.tabla);
      const sentencia = sqlite.prepare(`INSERT INTO ${PREFIJO}${c.tabla} (${campos.join(',')}) VALUES (${campos.map(() => '?').join(',')})`);
      sqlite.transaction(() => {
        for (const fila of filas) {
          if (c.tabla === 'sicar_detalles' && fila && !Object.hasOwn(fila, 'renglon')) {
            // El snapshot antiguo conserva el orden de rowid, incluso entre trozos.
            const identidad = JSON.stringify([fila.sucursal_id, fila.ven_id]);
            fila.renglon = renglonesAntiguos.get(identidad) ?? 0;
            renglonesAntiguos.set(identidad, fila.renglon + 1);
          }
          if (!fila || Object.keys(fila).length !== campos.length || campos.some(k => !Object.hasOwn(fila, k))) {
            throw new Error('Una fila del respaldo SICAR tiene columnas incompatibles.');
          }
          sentencia.run(...campos.map(k => fila[k]));
        }
      })();
    }
    const versiones = sqlite.prepare(`SELECT version FROM ${PREFIJO}sicar_esquema ORDER BY version`).all();
    if (JSON.stringify(versiones) !== '[{"version":1},{"version":2}]') throw new Error('Historial de esquema SICAR incompatible.');
    let aplicada = false;
    return {
      liberar,
      aplicar(guardarEstado = () => {}) {
        if (liberada || aplicada) throw new Error('La preparación SICAR ya fue utilizada o liberada.');
        sqlite.transaction(() => {
          // Conserva las revocaciones también para llaves que aún no existían en la foto.
          sqlite.prepare(`UPDATE ${PREFIJO}sicar_llaves SET revocada=?
            WHERE key_id NOT IN (SELECT key_id FROM sicar_llaves)`).run(new Date().toISOString());
          sqlite.exec(`INSERT OR IGNORE INTO ${PREFIJO}sicar_tiendas(sucursal_id)
            SELECT sucursal_id FROM sicar_llaves WHERE revocada IS NOT NULL;
            INSERT INTO ${PREFIJO}sicar_llaves
            SELECT * FROM sicar_llaves WHERE revocada IS NOT NULL
            ON CONFLICT(key_id) DO UPDATE SET revocada=excluded.revocada`);
          for (const tabla of [...TABLAS].reverse()) sqlite.exec(`DELETE FROM ${tabla}`);
          for (const tabla of TABLAS) sqlite.exec(`INSERT INTO ${tabla} SELECT * FROM ${PREFIJO}${tabla}`);
          const resultado = guardarEstado();
          if (resultado?.then) throw new Error('El guardado de estado debe ser síncrono dentro de la transacción SICAR.');
        }).immediate();
        aplicada = true;
      },
    };
  } catch (e) { liberar(); throw e; }
}

module.exports = { crearSnapshotSicar, prepararRestauracionSicar, verificarSnapshotSicar, configurarContexto, tieneDatosSicar, TABLAS, MAX_TROZO };
