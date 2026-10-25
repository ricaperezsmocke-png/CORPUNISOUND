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
test('el interruptor existencias solo acepta true o false', async t => {
  const { archivo, config } = await preparar(t);
  assert.equal((await leerConfiguracion(archivo)).existencias, undefined);
  for (const [valor, acepta] of [[true, true], [false, true], ['true', false], [1, false], [null, false], [{}, false]]) {
    await fs.writeFile(archivo, JSON.stringify({ ...config, existencias: valor }));
    if (acepta) assert.equal((await leerConfiguracion(archivo)).existencias, valor);
    else await assert.rejects(leerConfiguracion(archivo), /CONFIGURACION_INVALIDA/);
  }
});
test('--verificar dice cuantas existencias vigentes y cuanto tarda, o que estan apagadas', async t => {
  const { archivo } = await preparar(t);
  const base = { tamano: 100, validar: async () => {}, tope: async () => '0', clientes: async () => [],
    ventas: async () => ({ filas: [], clientes: [], detalles: [] }) };
  const info = existencias => async () => ({ grants: [], columnas: [], ventas: [], clientes: [], existencias });
  for (const [existencias, esperado, aviso] of [
    [{ columnas: ['articulo.art_id'], faltantes: [], total: '6420', ms: 11 }, /Existencias: 6420 artículos vigentes, lectura en 11 ms/, false],
    [{ columnas: ['articulo.art_id'], faltantes: ['articulo.servicio'], total: null, ms: null },
      /Existencias APAGADAS, faltan columnas: \["articulo.servicio"\]/, true],
    [undefined, /Existencias APAGADAS, faltan columnas/, true],
  ]) {
    const salida = [], registros = [];
    await main(['--verificar'], { configPath: archivo, conectar: async () => ({ end: async () => {} }),
      crearFuente: async () => ({ ...base, verificar: info(existencias) }), imprimir: x => salida.push(x), log: x => registros.push(x),
      esperar: async () => {}, fetch: async () => assert.fail('No debe enviar HTTP') });
    assert.match(salida.join('\n'), esperado);
    assert.equal(registros.includes('EXISTENCIAS_NO_DISPONIBLES'), aviso);
  }
});
test('--existencias-ahora se acepta, queda en el registro y llega a la corrida', async t => {
  const { archivo, config } = await preparar(t);
  await fs.writeFile(archivo, JSON.stringify({ ...config, existencias: true }));
  const registros = [];
  const lecturas = [];
  const fuente = { tamano: 100, validar: async () => {}, tope: async () => '0', clientes: async () => [],
    ventas: async () => ({ filas: [], clientes: [], detalles: [] }), historial: async () => [], porIds: async () => ({ filas: [], clientes: [], detalles: [] }),
    existenciasDisponibles: true, existencias: async cursor => { lecturas.push(cursor); return []; } };
  await fs.writeFile(config.estado, JSON.stringify({ ...require('./estado').inicial(), fase: 'incremental', existencias_dia: '2999-01-01' }));
  await main(['--existencias-ahora'], { configPath: archivo, conectar: async () => ({ end: async () => {} }),
    crearFuente: async () => fuente, log: x => registros.push(x), esperar: async () => {},
    reloj: () => Date.parse('2026-10-15T18:00:00Z'), fetch: async () => assert.fail('Nada que mandar') });
  assert.ok(registros.includes('EXISTENCIAS_AUTORIZADAS_DE_DIA'));
  assert.deepEqual(lecturas, ['0']);
  assert.equal(JSON.parse(await fs.readFile(config.estado, 'utf8')).existencias_dia, '2026-10-15');
});
test('--verificar dice que columnas de proveedor encontro y cuantos hay, o que estan apagados', async t => {
  const { archivo } = await preparar(t);
  const base = { tamano: 100, validar: async () => {}, tope: async () => '0', clientes: async () => [],
    ventas: async () => ({ filas: [], clientes: [], detalles: [] }) };
  const info = proveedores => async () => ({ grants: [], columnas: [], ventas: [], clientes: [], proveedores });
  for (const [proveedores, esperado, aviso] of [
    [{ columnas: ['proveedor.prv_id', 'proveedor.nombre'], faltantes: [], total: '42' }, /Proveedores vigentes en SICAR \(sin los borrados\): 42/, false],
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
test('el interruptor cortes solo acepta true o false', async t => {
  const { archivo, config } = await preparar(t);
  assert.equal((await leerConfiguracion(archivo)).cortes, undefined);
  for (const [valor, acepta] of [[true, true], [false, true], ['true', false], [1, false], [null, false], [{}, false]]) {
    await fs.writeFile(archivo, JSON.stringify({ ...config, cortes: valor }));
    if (acepta) assert.equal((await leerConfiguracion(archivo)).cortes, valor);
    else await assert.rejects(leerConfiguracion(archivo), /CONFIGURACION_INVALIDA/);
  }
});
test('el ejemplo de configuracion trae los cortes apagados', async () => {
  assert.equal(JSON.parse(await fs.readFile(path.join(__dirname, 'config.ejemplo.json'), 'utf8')).cortes, false);
});
test('--verificar dice cuantos cortes hay en SICAR o que estan apagados', async t => {
  const { archivo } = await preparar(t);
  const base = { tamano: 100, validar: async () => {}, tope: async () => '0', clientes: async () => [],
    ventas: async () => ({ filas: [], clientes: [], detalles: [] }) };
  const info = cortes => async () => ({ grants: [], columnas: [], ventas: [], clientes: [], cortes });
  for (const [cortes, esperado, aviso] of [
    [{ columnas: ['cortecaja.cor_id'], faltantes: [], total: '8006', ms: 42 },
      /Cortes en SICAR: 8006, lectura de ventas de 100 cortes en 42 ms/, false],
    [{ columnas: ['cortecaja.cor_id'], faltantes: ['cortetipopago.tpa_id'], total: null },
      /Cortes APAGADOS, faltan columnas: \["cortetipopago.tpa_id"\]/, true],
    [undefined, /Cortes APAGADOS, faltan columnas/, true],
  ]) {
    const salida = [], registros = [];
    await main(['--verificar'], { configPath: archivo, conectar: async () => ({ end: async () => {} }),
      crearFuente: async () => ({ ...base, verificar: info(cortes) }), imprimir: x => salida.push(x), log: x => registros.push(x),
      esperar: async () => {}, fetch: async () => assert.fail('No debe enviar HTTP') });
    assert.match(salida.join('\n'), esperado);
    assert.equal(registros.includes('CORTES_NO_DISPONIBLES'), aviso);
  }
});
test('el interruptor mostrador solo acepta true o false y el ejemplo lo trae apagado', async t => {
  const { archivo, config } = await preparar(t);
  assert.equal((await leerConfiguracion(archivo)).mostrador, undefined);
  for (const [valor, acepta] of [[true, true], [false, true], ['true', false], [1, false], [null, false], [{}, false]]) {
    await fs.writeFile(archivo, JSON.stringify({ ...config, mostrador: valor }));
    if (acepta) assert.equal((await leerConfiguracion(archivo)).mostrador, valor);
    else await assert.rejects(leerConfiguracion(archivo), /CONFIGURACION_INVALIDA/);
  }
  assert.equal(JSON.parse(await fs.readFile(path.join(__dirname, 'config.ejemplo.json'), 'utf8')).mostrador, false);
});
test('--verificar dice cuantas ventas de publico hay desde 2025, contando tambien por nombre', async t => {
  const { archivo } = await preparar(t);
  const pagina = { filas: [{ ven_id: '5', cli_id: '1', status: 1 }, { ven_id: '120', cli_id: '1', status: 1 },
    { ven_id: '121', cli_id: '900', status: 1 }, { ven_id: '122', cli_id: '42', status: 1 }],
  clientes: [{ cli_id: '1', nombre: 'PUBLICO' }, { cli_id: '900', nombre: 'PÚBLICO EN GENERAL 2' }, { cli_id: '42', nombre: 'José' }], detalles: [] };
  const base = { tamano: 100, validar: async () => {}, tope: async () => '122', clientes: async () => [],
    ventas: async cursor => (cursor === '0' ? pagina : { filas: [], clientes: [], detalles: [] }) };
  for (const [mostrador, esperado] of [
    [{ desde_ven_id: '120', total_publico_desde_2025: '1' }, /Ventas de público en general desde 2025: 1 por número de cliente, desde la venta 120/],
    [{ desde_ven_id: null, total_publico_desde_2025: '0' }, /Ventas de público en general desde 2025: 0 por número de cliente, desde la venta ninguna/],
    [undefined, /Ventas de público en general desde 2025: sin dato/],
  ]) {
    const salida = [];
    await main(['--verificar'], { configPath: archivo, conectar: async () => ({ end: async () => {} }),
      crearFuente: async () => ({ ...base, verificar: async () => ({ grants: [], columnas: [], ventas: [], clientes: [], mostrador }) }),
      imprimir: x => salida.push(x), log: () => {}, esperar: async () => {}, fetch: async () => assert.fail('No debe enviar HTTP') });
    assert.match(salida.join('\n'), esperado);
    if (mostrador?.desde_ven_id) assert.match(salida.join('\n'), /Ventas de público en general desde 2025 revisando también el nombre: 2/);
  }
});
test('--mostrador-ahora se acepta, queda en el registro y de dia corre la carga desde 2025', async t => {
  const { archivo, config } = await preparar(t);
  await fs.writeFile(archivo, JSON.stringify({ ...config, mostrador: true }));
  const registros = [], desdes = [];
  const vacia = { filas: [], clientes: [], detalles: [] };
  const fuente = { tamano: 100, validar: async () => {}, tope: async () => '0', clientes: async () => [], ventas: async () => vacia,
    historial: async () => [], porIds: async () => vacia, mostradorDesde: async fecha => { desdes.push(fecha); return null; } };
  await fs.writeFile(config.estado, JSON.stringify({ ...require('./estado').inicial(), fase: 'incremental', ven_id: '50' }));
  await main(['--mostrador-ahora'], { configPath: archivo, conectar: async () => ({ end: async () => {} }),
    crearFuente: async () => fuente, log: x => registros.push(x), esperar: async () => {},
    reloj: () => Date.parse('2026-10-15T18:00:00Z'), fetch: async () => assert.fail('Nada que mandar') });
  assert.ok(registros.includes('MOSTRADOR_AUTORIZADO_DE_DIA'));
  assert.deepEqual(desdes, ['2025-01-01 00:00:00']);
  assert.equal(JSON.parse(await fs.readFile(config.estado, 'utf8')).mostrador_terminado, true, 'sin ventas desde 2025 no hay nada que cargar');
});
test('el interruptor traspasos solo acepta true o false y el ejemplo lo trae apagado', async t => {
  const { archivo, config } = await preparar(t);
  assert.equal((await leerConfiguracion(archivo)).traspasos, undefined);
  for (const [valor, acepta] of [[true, true], [false, true], ['true', false], [1, false], [null, false], [{}, false]]) {
    await fs.writeFile(archivo, JSON.stringify({ ...config, traspasos: valor }));
    if (acepta) assert.equal((await leerConfiguracion(archivo)).traspasos, valor);
    else await assert.rejects(leerConfiguracion(archivo), /CONFIGURACION_INVALIDA/);
  }
  assert.equal(JSON.parse(await fs.readFile(path.join(__dirname, 'config.ejemplo.json'), 'utf8')).traspasos, false);
});
test('--verificar dice cuantos traspasos hay y cuantos siguen abiertos, o que estan apagados', async t => {
  const { archivo } = await preparar(t);
  const base = { tamano: 100, validar: async () => {}, tope: async () => '0', clientes: async () => [],
    ventas: async () => ({ filas: [], clientes: [], detalles: [] }) };
  const info = traspasos => async () => ({ grants: [], columnas: [], ventas: [], clientes: [], traspasos });
  for (const [traspasos, esperado, aviso] of [
    [{ columnas: ['traspaso.tra_id'], faltantes: [], total: '2500', abiertos: '12' },
      /Traspasos en SICAR: 2500, 12 enviados sin recibir/, false],
    [{ columnas: ['traspaso.tra_id'], faltantes: ['detallet.precioCon'], total: null, abiertos: null },
      /Traspasos APAGADOS, faltan columnas: \["detallet.precioCon"\]/, true],
    [undefined, /Traspasos APAGADOS, faltan columnas/, true],
  ]) {
    const salida = [], registros = [];
    await main(['--verificar'], { configPath: archivo, conectar: async () => ({ end: async () => {} }),
      crearFuente: async () => ({ ...base, verificar: info(traspasos) }), imprimir: x => salida.push(x), log: x => registros.push(x),
      esperar: async () => {}, fetch: async () => assert.fail('No debe enviar HTTP') });
    assert.match(salida.join('\n'), /Columnas de traspasos: /);
    assert.match(salida.join('\n'), esperado);
    assert.equal(registros.includes('TRASPASOS_NO_DISPONIBLES'), aviso);
  }
});
test('--traspasos-ahora se acepta, queda en el registro y de dia hace la vuelta completa de traspasos', async t => {
  const { archivo, config } = await preparar(t);
  await fs.writeFile(archivo, JSON.stringify({ ...config, traspasos: true }));
  const registros = [], leidos = [];
  const vacia = { filas: [], clientes: [], detalles: [] };
  const fuente = { tamano: 100, validar: async () => {}, tope: async () => '0', clientes: async () => [], ventas: async () => vacia,
    historial: async () => [], porIds: async () => vacia, traspasosDisponibles: true,
    traspasos: async (cursor, limite, desde) => { leidos.push([cursor, desde ?? null]); return { traspasos: [], detalles: [] }; } };
  await fs.writeFile(config.estado, JSON.stringify({ ...require('./estado').inicial(), fase: 'incremental' }));
  await main(['--traspasos-ahora'], { configPath: archivo, conectar: async () => ({ end: async () => {} }),
    crearFuente: async () => fuente, log: x => registros.push(x), esperar: async () => {},
    reloj: () => Date.parse('2026-10-15T18:00:00Z'), fetch: async () => assert.fail('Nada que mandar') });
  assert.ok(registros.includes('TRASPASOS_AUTORIZADOS_DE_DIA'));
  assert.deepEqual(leidos[0], ['0', null], 'vuelta completa desde el primero');
  assert.equal(JSON.parse(await fs.readFile(config.estado, 'utf8')).traspasos_semana, '2026-10-15');
});
