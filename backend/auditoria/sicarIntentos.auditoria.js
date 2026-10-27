// AUDITORIA 2026-10 (hallazgos A1 y A2). Estas pruebas FALLAN en master a proposito: describen lo que deberia pasar.
// No arreglan nada. Correr desde backend/: node --preserve-symlinks --preserve-symlinks-main --test auditoria/sicarIntentos.auditoria.js
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
process.env.DB_PATH = ':memory:';
process.env.SENTRY_ENABLED = 'false';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'auditoria-sicar-desechable';
const app = require('../server');
const { obtenerConexionSqlite } = require('../persistencia');
const { firmarToken } = require('../auth');
const sqlite = obtenerConexionSqlite();
let servidor, base, admin;

before(async () => {
  app.DB.admin.roles.push({ id: 981, nombre: 'Auditoria', permisos: ['administrar_llaves_sicar', 'ver_sincronizacion_sicar',
    'ver_todas_las_sucursales'], modulos: ['sicar'] });
  app.DB.admin.usuarios.push({ id: 981, nombre: 'Auditoria', usuario: 'auditoria981', rol_id: 981, sucursal_id: 1, activo: true });
  admin = firmarToken({ id: 981, rol_id: 981, sucursal_id: 1 });
  await new Promise(resolve => { servidor = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(async () => {
  servidor?.closeAllConnections();
  if (servidor) await new Promise(resolve => servidor.close(resolve));
  sqlite.close();
});

const intentos = () => sqlite.prepare('SELECT count(*) n FROM sicar_intentos').get().n;
async function enviarLote(authorization) {
  const res = await fetch(`${base}/api/integraciones/sicar/v1/lotes`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(authorization ? { Authorization: authorization } : {}) },
    body: '{}',
  });
  await res.text();
  return res.status;
}

test('A1: un desconocido sin llave no puede escribir filas sin tope en sicar_intentos (disco de 1 GB de Render)', async () => {
  const antes = intentos();
  const codigos = [];
  for (let i = 0; i < 40; i++) codigos.push(await enviarLote(null));
  const escritas = intentos() - antes;
  // Hoy: 40 peticiones anonimas = 40 filas, incluidas las que ya se frenaron con 429 (el freno no frena la escritura).
  assert.ok(codigos.includes(429), 'el freno de ritmo si se activa');
  assert.ok(escritas <= 12, `40 peticiones anonimas dejaron ${escritas} filas permanentes en sicar_intentos (sin tope ni limpieza)`);
});

test('A2: una llave real con secreto falso no debe quedar registrada como intento de esa tienda', async () => {
  const r = await fetch(`${base}/api/sicar/llaves`, { method: 'POST',
    headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ sucursal_id: 2 }) });
  assert.equal(r.status, 201);
  const { key_id } = await r.json();
  const status = await enviarLote(`Bearer ${key_id}.${'0'.repeat(64)}`);
  assert.ok([401, 429].includes(status));
  const fila = sqlite.prepare('SELECT sucursal_id, key_id, codigo FROM sicar_intentos ORDER BY id DESC LIMIT 1').get();
  // Hoy: el intento falso se apunta a la tienda 2 y a su llave; en "Envios SICAR" parece que el agente de Yajalon fallo.
  assert.equal(fila.sucursal_id, null, `el intento con secreto falso quedo a nombre de la tienda ${fila.sucursal_id}`);
});
