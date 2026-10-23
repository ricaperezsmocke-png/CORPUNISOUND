const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { leerConfiguracion } = require('./configuracion');
const { main } = require('./index');
async function preparar(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sicar-config-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const archivo = path.join(dir, 'config.json');
  const config = { mysql: { host: 'localhost', database: 'sicar', password: 'MYSQL-ABC-SECRET' },
    llave: 'TIENDA-XYZ-SECRET', estado: path.join(dir, 'estado.json') };
  await fs.writeFile(archivo, JSON.stringify(config));
  return { archivo, config };
}
test('exige configuración externa; rechaza rutas dentro de repo y estado dentro de repo', async t => {
  const { archivo, config } = await preparar(t);
  assert.equal((await leerConfiguracion(archivo)).llave, 'TIENDA-XYZ-SECRET');
  await assert.rejects(leerConfiguracion(undefined));
  await assert.rejects(leerConfiguracion(path.join(__dirname, 'package.json')));
  config.estado = path.join(__dirname, 'estado.json');
  await fs.writeFile(archivo, JSON.stringify(config));
  await assert.rejects(leerConfiguracion(archivo));
});
test('--verificar cuenta por páginas, muestra historial solo local y no llama HTTP', async t => {
  const { archivo } = await preparar(t);
  const salida = [], registros = [];
  let conexiones = 0, cierres = 0;
  const fuente = { tamano: 100, validar: async () => {}, tope: async () => '9',
    clientes: async cursor => cursor === '0' ? [{ cli_id: '42', nombre: 'José' }, { cli_id: '1', nombre: 'Público' }] : [],
    ventas: async cursor => cursor === '0' ? { filas: [{ ven_id: '9', cli_id: '42' }],
      clientes: [{ cli_id: '42', nombre: 'José' }], detalles: [] } : { filas: [], clientes: [], detalles: [] },
    verificar: async () => ({ grants: [{ grant: 'FILE WITH GRANT OPTION' }], columnas: [{ Field: 'referencia_real' }],
      ventas: [{ his_id: '10', referencia_real: '9' }], clientes: [{ his_id: '11', referencia_real: '42' }] }) };
  await main(['--verificar'], { configPath: archivo, conectar: async () => {
    conexiones++; return { end: async () => { cierres++; } };
  }, crearFuente: async () => fuente, imprimir: x => salida.push(x), log: x => registros.push(x),
  esperar: async () => {}, fetch: async () => assert.fail('No debe enviar HTTP') });
  assert.equal(conexiones, 1);
  assert.equal(cierres, 1);
  assert.ok(registros.includes('PRIVILEGIOS_AMPLIOS'));
  assert.match(salida.join('\n'), /referencia_real/);
  assert.match(salida.join('\n'), /Clientes con nombre: 1/);
  assert.match(salida.join('\n'), /Ventas con nombre: 1/);
  for (const secreto of ['MYSQL', 'ABC', 'TIENDA', 'XYZ', 'SECRET']) {
    assert.equal(salida.join('\n').includes(secreto), false);
  }
});
test('el interruptor proveedores solo acepta true o false', async t => {
  const { archivo, config } = await preparar(t);
  assert.equal((await leerConfiguracion(archivo)).proveedores, undefined);
  for (const [valor, acepta] of [[true, true], [false, true], ['si', false], [1, false]]) {
    await fs.writeFile(archivo, JSON.stringify({ ...config, proveedores: valor }));
    if (acepta) assert.equal((await leerConfiguracion(archivo)).proveedores, valor);
    else await assert.rejects(leerConfiguracion(archivo), /CONFIGURACION_INVALIDA/);
  }
});
test('--verificar dice que columnas de proveedor encontro y cuantos hay, o que estan apagados', async t => {
  const { archivo } = await preparar(t);
  const base = { tamano: 100, validar: async () => {}, tope: async () => '0', clientes: async () => [],
    ventas: async () => ({ filas: [], clientes: [], detalles: [] }) };
  const info = proveedores => async () => ({ grants: [], columnas: [], ventas: [], clientes: [], proveedores });
  for (const [proveedores, esperado, aviso] of [
    [{ columnas: ['proveedor.prv_id', 'proveedor.nombre'], faltantes: [], total: '42' }, /Proveedores en SICAR: 42/, false],
    [{ columnas: ['proveedor.prv_id'], faltantes: ['proveedor.nombre'], total: null }, /Proveedores APAGADOS, faltan columnas: \["proveedor.nombre"\]/, true],
  ]) {
    const salida = [], registros = [];
    await main(['--verificar'], { configPath: archivo, conectar: async () => ({ end: async () => {} }),
      crearFuente: async () => ({ ...base, verificar: info(proveedores) }), imprimir: x => salida.push(x), log: x => registros.push(x),
      esperar: async () => {}, fetch: async () => assert.fail('No debe enviar HTTP') });
    assert.match(salida.join('\n'), /Columnas de proveedor: \["proveedor.prv_id"/);
    assert.match(salida.join('\n'), esperado);
    assert.equal(registros.includes('PROVEEDORES_NO_DISPONIBLES'), aviso);
  }
});
