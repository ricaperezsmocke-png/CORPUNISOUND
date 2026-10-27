// AUDITORIA 2026-10 (hallazgo C1). FALLA en master a proposito: describe lo que deberia pasar. No arregla nada.
// Correr desde agente-sicar/: node --preserve-symlinks --preserve-symlinks-main --test auditoria/privilegios.auditoria.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { main } = require('../index');

async function preparar(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'auditoria-sicar-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const archivo = path.join(dir, 'config.json');
  await fs.writeFile(archivo, JSON.stringify({ mysql: { host: 'localhost', database: 'sicar', password: 'x' },
    llave: 'llave', estado: path.join(dir, 'estado.json') }));
  return archivo;
}

// Lo que MySQL contesta a SHOW GRANTS para un usuario que SI puede escribir en SICAR.
const PERMISOS_DE_ESCRITURA = [
  'GRANT ALL PRIVILEGES ON *.* TO `consultas`@`%`',
  'GRANT SELECT, INSERT, UPDATE, DELETE ON `sicar`.* TO `consultas`@`localhost`',
  'GRANT SELECT, DROP, ALTER ON *.* TO `consultas`@`localhost`',
];

for (const grant of PERMISOS_DE_ESCRITURA) {
  test(`C1: --verificar avisa PRIVILEGIOS_AMPLIOS con "${grant}"`, async t => {
    const archivo = await preparar(t);
    const registros = [];
    const fuente = { tamano: 100, validar: async () => {}, tope: async () => '0', clientes: async () => [],
      ventas: async () => ({ filas: [], clientes: [], detalles: [] }),
      verificar: async () => ({ grants: [{ [`Grants for consultas@localhost`]: grant }], columnas: [], ventas: [], clientes: [] }) };
    await main(['--verificar'], { configPath: archivo, conectar: async () => ({ end: async () => {} }),
      crearFuente: async () => fuente, imprimir: () => {}, log: x => registros.push(x), esperar: async () => {} });
    // Hoy solo se busca FILE o GRANT OPTION: un usuario que puede borrar o cambiar ventas pasa sin aviso.
    assert.ok(registros.includes('PRIVILEGIOS_AMPLIOS'), `sin aviso para: ${grant}`);
  });
}
