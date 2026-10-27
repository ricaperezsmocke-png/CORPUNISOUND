// AUDITORIA 2026-10 (hallazgo D1). FALLA en master a proposito: describe lo que deberia pasar. No arregla nada.
// Correr desde backend/: node --preserve-symlinks --preserve-symlinks-main --test auditoria/sicarRestauracionLlaves.auditoria.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { crearRepositorioSicar } = require('../sicarRepositorio');
const s = require('../sicarRespaldo');
const LLAVE = Buffer.alloc(32, 7);

function driveFalso() {
  const archivos = new Map();
  let n = 0;
  return {
    asegurarCarpetaRespaldos: async () => 'carpeta',
    async subirArchivoADrive(_DB, args) { const id = `archivo-${++n}`; archivos.set(id, Buffer.from(args.contenidoBuffer)); return { id }; },
    async descargarArchivoDeDriveLimitado(_DB, id) { return archivos.get(id); },
    async eliminarArchivoDeDrive(_DB, id) { archivos.delete(id); },
  };
}

test('D1: restaurar no debe borrar la llave ACTIVA que una tienda recibio despues de la foto', async t => {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'auditoria-respaldo-'));
  const sqlite = new Database(path.join(carpeta, 'prueba.sqlite'));
  t.after(() => { sqlite.close(); fs.rmSync(carpeta, { recursive: true, force: true }); });
  sqlite.pragma('journal_mode = WAL');
  const repo = crearRepositorioSicar(sqlite);
  const drive = driveFalso();
  // Ocosingo tenia la llave "vieja" cuando se tomo la foto.
  repo.guardarLlave({ key_id: 'vieja', sucursal_id: 1, secreto_hash: 'a'.repeat(64), creada: '2026-10-13', actor: '1' });
  const foto = await s.crearSnapshotSicar(repo, drive, { DB: {}, llave: LLAVE });
  // Despues de la foto: se sospecha que la vieja se filtro, se revoca y se instala una nueva en la PC de la tienda.
  repo.revocarLlave('vieja');
  repo.guardarLlave({ key_id: 'nueva', sucursal_id: 1, secreto_hash: 'b'.repeat(64), creada: '2026-10-20', actor: '1' });
  const preparada = await s.prepararRestauracionSicar(repo, drive, foto);
  preparada.aplicar(); preparada.liberar();
  assert.ok(repo.obtenerLlave('vieja').revocada, 'la vieja sigue revocada (esto si funciona)');
  // Hoy: la "nueva" desaparece. Ocosingo se queda sin ninguna llave valida y su agente se detiene con HTTP_401.
  const nueva = repo.obtenerLlave('nueva');
  assert.ok(nueva && !nueva.revocada, 'la llave activa creada despues de la foto se borro al restaurar');
  assert.equal(repo.tieneAgenteActivo(1), true, 'Ocosingo quedo sin agente activo');
});
