const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validarSQL, opcionesConexion, crearLector } = require('./seguridad');

for (const sql of [
  'UPDATE cliente SET nombre = 1', 'DELETE FROM venta', 'SELECT 1; SELECT 2',
  "SELECT nombre INTO OUTFILE '/tmp/x' FROM cliente", "SELECT 1 INTO DUMPFILE '/tmp/x'",
  "SELECT LOAD_FILE('/tmp/x')", 'SELECT ven_id FROM venta FOR UPDATE',
  'SELECT ven_id FROM venta LOCK IN SHARE MODE', '/*!50000 DELETE FROM venta */ SELECT 1',
  'SELECT * FROM cliente', 'SELECT huella FROM cliente', 'SELECT muestra FROM cliente', 'SELECT foto FROM cliente',
]) {
  test(`rechaza SQL inseguro: ${sql}`, () => assert.throws(() => validarSQL(sql)));
}
test('acepta punto y coma final; rechaza cualquier comentario (no se intenta entenderlos)', () => {
  assert.equal(validarSQL(' SELECT cli_id FROM cliente;'), ' SELECT cli_id FROM cliente;');
  assert.throws(() => validarSQL(' /* lectura */ SELECT cli_id FROM cliente;'), /SQL_NO_PERMITIDO/);
  assert.throws(() => validarSQL('-- lectura\nSHOW GRANTS'), /SQL_NO_PERMITIDO/);
});
test('solo acepta localhost y fija opciones seguras pese a opciones externas', () => {
  for (const host of ['192.168.1.1', 'localhost.evil', '::1', '']) {
    assert.throws(() => opcionesConexion({ host }));
  }
  const o = opcionesConexion({ host: '127.0.0.1', multipleStatements: true, decimalNumbers: true });
  assert.equal(o.multipleStatements, false);
  assert.equal(o.decimalNumbers, false);
  assert.equal(o.charset, 'utf8mb4');
  assert.equal(o.dateStrings, true);
  assert.equal(o.bigNumberStrings, true);
});
test('cada página usa una transacción de solo lectura; rechazo no llega a MySQL', async () => {
  const consultas = [];
  const conexion = { query: async (sql) => { consultas.push(sql.sql || sql); return [[{ cli_id: '7' }]]; } };
  const lector = await crearLector(conexion);
  const filas = await lector.pagina(async leer => leer('SELECT cli_id FROM cliente'));
  assert.deepEqual(filas, [{ cli_id: '7' }]);
  await assert.rejects(lector.pagina(async leer => leer('DELETE FROM cliente')));
  assert.deepEqual(consultas, [
    'SET SESSION TRANSACTION READ ONLY', 'SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ', 'START TRANSACTION READ ONLY',
    'SELECT cli_id FROM cliente', 'COMMIT', 'START TRANSACTION READ ONLY', 'ROLLBACK',
  ]);
});
test('consultas repetidamente lentas reducen página y avisan', async () => {
  let tiempo = 0;
  const avisos = [];
  const lector = await crearLector({ query: async q => {
    if (typeof q === 'object') tiempo += 1100;
    return [[]];
  } }, { reloj: () => tiempo, avisar: x => avisos.push(x) });
  assert.equal(lector.tamano, 100);
  await lector.pagina(async leer => { await leer('SELECT cli_id FROM cliente'); await leer('SELECT cli_id FROM cliente'); });
  assert.equal(lector.tamano, 50);
  assert.deepEqual(avisos, ['CONSULTAS_LENTAS_PAGINA_REDUCIDA']);
});
