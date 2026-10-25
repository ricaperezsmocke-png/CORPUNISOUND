const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { decimal, cliente, venta } = require('./formato');
const { bloquear, registrar, describirFallo, crearEscritor } = require('./estado');
const c = { cli_id: '42', nombre: 'José Peña' };
const d = { art_id: '8', clave: null, descripcion: 'Guitarra', cantidad: '1',
  precioCon: '1500', precioSin: '1293.1034', importeCon: '1500', descTotal: '0' };
const v = { ven_id: '9', cli_id: '42', fecha: '2026-10-14 10:00:00', status: 1, total: '1500' };
async function carpeta(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sicar-robustez-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test('precios con más de 4 decimales se redondean a la mitad hacia arriba; importes siguen estrictos', () => {
  assert.equal(decimal('1293.103448', 4, true), '1293.1034');
  assert.equal(decimal('0.00005', 4, true), '0.0001');
  assert.equal(decimal('9.99995', 4, true), '10.0000');
  assert.equal(decimal('12.5', 4, true), '12.5000');
  assert.throws(() => decimal('1.001', 2), /PRECISION_NO_PACTADA/);
  const salida = venta(v, c, [{ ...d, precioCon: '1500.000000', precioSin: '1293.103448' }], false);
  assert.equal(salida.detalle[0].precio_sin, '1293.1034');
  assert.equal(salida.detalle[0].precio_con, '1500.0000');
  assert.throws(() => venta(v, c, [{ ...d, importeCon: '1500.005' }], false), /PRECISION_NO_PACTADA/);
});

test('teléfono, celular, correo o RFC fuera de formato se omiten con aviso; no detienen la carga', () => {
  const avisos = [];
  const salida = cliente({ ...c, telefono: '9'.repeat(41), celular: 'ok\u0001', mail: 'a@b.mx', rfc: 'RFC CON ESPACIOS 123' },
    aviso => avisos.push(aviso));
  assert.deepEqual(salida, { cli_id: '42', nombre: 'José Peña', telefono: null, celular: null, email: 'a@b.mx', rfc: null });
  assert.deepEqual(avisos.map(a => a.campo).sort(), ['celular', 'rfc', 'telefono']);
  assert.ok(avisos.every(a => a.cli_id === '42'));
  assert.throws(() => cliente({ ...c, nombre: 'x'.repeat(251) }), /TEXTO_INVALIDO/);
});

test('un error de una venta dice cuál venta fue', () => {
  let error;
  try { venta({ ...v, status: 3 }, c, [d], false); } catch (e) { error = e; }
  assert.equal(error.message, 'ESTADO_VENTA_DESCONOCIDO');
  assert.equal(error.ven_id, '9');
  try { venta(v, c, [], false); } catch (e) { error = e; }
  assert.equal(error.ven_id, '9');
});

test('describirFallo solo deja pasar códigos conocidos e ids; nunca el mensaje crudo', () => {
  const conVenta = Object.assign(new Error('ESTADO_VENTA_DESCONOCIDO'), { ven_id: '9' });
  assert.equal(describirFallo(conVenta), 'FALLO ESTADO_VENTA_DESCONOCIDO ven_id=9');
  assert.equal(describirFallo(new Error('MYSQLSECRETO')), 'FALLO ERROR_NO_CLASIFICADO');
  assert.equal(describirFallo(Object.assign(new Error('x'), { ven_id: 'llave-secreta' })), 'FALLO ERROR_NO_CLASIFICADO');
  const mysql = Object.assign(new Error("Access denied for user 'consultas' (password: SECRETO)"), { code: 'ER_ACCESS_DENIED_ERROR' });
  assert.equal(describirFallo(mysql), 'FALLO MYSQL_ACCESO_DENEGADO');
  assert.equal(describirFallo(Object.assign(new Error('x'), { code: 'ECONNREFUSED' })), 'FALLO MYSQL_NO_DISPONIBLE');
  const columna = Object.assign(new Error('Falta columna detallev.precioSin'), { columna: 'detallev.precioSin' });
  assert.equal(describirFallo(columna), 'FALLO ESQUEMA_INVALIDO columna=detallev.precioSin');
});

test('aviso de campo omitido se registra con id y campo, sin el valor', () => {
  const salida = [];
  const log = registrar(linea => salida.push(linea));
  log('CAMPO_OMITIDO', { cli_id: '42', campo: 'telefono', valor: '9191234567' });
  log('CAMPO_OMITIDO', { cli_id: 'SECRETO', campo: 'telefono' });
  assert.equal(salida[0], 'CAMPO_OMITIDO cli_id=42 campo=telefono');
  assert.equal(salida[1], 'CAMPO_OMITIDO campo=telefono');
});

test('candado de una corrida que murió (luz, reinicio) se recupera; uno vivo y reciente se respeta', async t => {
  const dir = await carpeta(t);
  const archivo = path.join(dir, 'estado.json');
  await fs.writeFile(`${archivo}.lock`, JSON.stringify({ pid: 999999, inicio: new Date().toISOString() }));
  const liberar = await bloquear(archivo);
  assert.ok(liberar, 'el candado de un proceso muerto debe recuperarse');
  await liberar();
  await fs.writeFile(`${archivo}.lock`, JSON.stringify({ pid: process.pid, inicio: new Date().toISOString() }));
  assert.equal(await bloquear(archivo), null);
  const viejo = new Date(Date.now() - 7 * 3600000).toISOString();
  await fs.writeFile(`${archivo}.lock`, JSON.stringify({ pid: process.pid, inicio: viejo }));
  const otra = await bloquear(archivo);
  assert.ok(otra, 'un candado de más de 6 horas se considera abandonado');
  await otra();
  await fs.writeFile(`${archivo}.lock`, 'basura');
  const hace = new Date(Date.now() - 10 * 60000);
  await fs.utimes(`${archivo}.lock`, hace, hace);
  const ilegible = await bloquear(archivo);
  assert.ok(ilegible, 'un candado ilegible se recupera');
  await ilegible();
});

test('el registro se guarda en archivo con fecha y hora, y rota al pasar de 5 MB', async t => {
  const dir = await carpeta(t);
  const ruta = path.join(dir, 'agente-sicar.log');
  const escribir = crearEscritor(ruta, () => Date.parse('2026-10-15T03:00:00Z'), () => {});
  await escribir('LOTE_CONFIRMADO');
  assert.equal(await fs.readFile(ruta, 'utf8'), '2026-10-15T03:00:00.000Z LOTE_CONFIRMADO\n');
  await fs.writeFile(ruta, 'x'.repeat(5 * 1024 * 1024 + 1));
  await escribir('LOTE_CONFIRMADO');
  assert.equal((await fs.stat(`${ruta}.1`)).size, 5 * 1024 * 1024 + 1);
  assert.equal(await fs.readFile(ruta, 'utf8'), '2026-10-15T03:00:00.000Z LOTE_CONFIRMADO\n');
});

test('una corrida que falla deja en agente-sicar.log el código y la venta, sin secretos', async t => {
  const { main } = require('./index');
  const dir = await carpeta(t);
  const archivo = path.join(dir, 'config.json');
  await fs.writeFile(archivo, JSON.stringify({ mysql: { host: 'localhost', database: 'sicar', password: 'MYSQL-ABC-SECRET' },
    llave: 'TIENDA-XYZ-SECRET', estado: path.join(dir, 'estado.json') }));
  const fallo = Object.assign(new Error('ESTADO_VENTA_DESCONOCIDO'), { ven_id: '77' });
  await assert.rejects(main([], { configPath: archivo, eco: () => {}, conectar: async () => ({ end: async () => {} }),
    crearFuente: async () => ({ validar: async () => { throw fallo; } }) }));
  const registro = await fs.readFile(path.join(dir, 'agente-sicar.log'), 'utf8');
  assert.match(registro, /FALLO ESTADO_VENTA_DESCONOCIDO ven_id=77/);
  for (const secreto of ['MYSQL', 'ABC', 'TIENDA', 'XYZ', 'SECRET']) assert.equal(registro.includes(secreto), false);
  await assert.rejects(fs.stat(path.join(dir, 'estado.json.lock')), 'el candado se libera aunque falle');
});

async function ciclo(t, fuenteExtra = {}, estadoExtra = {}) {
  const { inicial, guardar } = require('./estado');
  const dir = await carpeta(t);
  const archivo = path.join(dir, 'estado.json');
  await guardar(archivo, { ...inicial(), ...estadoExtra });
  const lotes = [];
  const fuente = { tamano: 100, validar: async () => {}, tope: async () => '0', clientes: async () => [],
    ventas: async () => ({ filas: [], clientes: [], detalles: [] }), historial: async () => [],
    clientesIds: async () => [], porIds: async () => ({ filas: [], clientes: [], detalles: [] }), ...fuenteExtra };
  const deps = { fuente, reloj: () => Date.parse('2026-10-15T03:00:00Z'), esperar: async () => {}, log: () => {},
    fetch: async (_, { body }) => {
      const lote = JSON.parse(body);
      lotes.push(lote);
      return { status: 200, json: async () => ({ next_sequence: String(BigInt(lote.sequence) + 1n) }) };
    } };
  return { archivo, deps, lotes };
}

test('páginas sin nada que mandar avanzan el cursor sin gastar envíos', async t => {
  const { ejecutar } = require('./corrida');
  const { cargar } = require('./estado');
  const movimientos = Array.from({ length: 250 }, (_, i) => ({ his_id: String(i + 1), tabla: 'Articulo', movimiento: 1, referencia: '5' }));
  const { archivo, deps, lotes } = await ciclo(t, {
    historial: async cursor => movimientos.filter(m => BigInt(m.his_id) > BigInt(cursor)).slice(0, 100),
    clientes: async cursor => cursor === '0' ? [{ cli_id: '1', nombre: 'PÚBLICO EN GENERAL' }] : [],
  });
  const config = { llave: 'x', historial: { columna_referencia: 'ref' } };
  await ejecutar(archivo, config, deps);
  assert.equal(lotes.length, 0, 'ni la página de puro público ni el cambio de fase deben enviar paquetes vacíos');
  assert.equal((await cargar(archivo)).fase, 'incremental');
  await ejecutar(archivo, config, deps);
  const estado = await cargar(archivo);
  assert.equal(estado.his_id, '250');
  assert.equal(lotes.length, 0, 'el historial sin cancelaciones avanza sin enviar');
  assert.equal(estado.siguiente_secuencia, '1');
});

test('una corrida manda como máximo 300 paquetes y la siguiente continúa donde se quedó', async t => {
  const { ejecutar } = require('./corrida');
  const { cargar } = require('./estado');
  const clientes = Array.from({ length: 310 }, (_, i) => ({ cli_id: String(i + 100), nombre: `Cliente ${i}` }));
  const { archivo, deps, lotes } = await ciclo(t, {
    tamano: 1, clientes: async cursor => clientes.filter(c => BigInt(c.cli_id) > BigInt(cursor)).slice(0, 1),
  });
  await ejecutar(archivo, { llave: 'x' }, deps);
  assert.equal(lotes.length, 300);
  assert.equal((await cargar(archivo)).cli_id, '399');
  await ejecutar(archivo, { llave: 'x' }, deps);
  assert.equal(lotes.length, 310);
  assert.deepEqual(lotes.map(l => l.sequence), lotes.map((_, i) => String(i + 1)));
});

async function conPendiente(t, secuencia = '80') {
  const { inicial, guardar } = require('./estado');
  const { sobre } = require('./formato');
  const dir = await carpeta(t);
  const archivo = path.join(dir, 'estado.json');
  const estado = { ...inicial(), siguiente_secuencia: secuencia };
  estado.pendiente = { bytes: JSON.stringify(sobre(secuencia, 'incremental', new Date('2026-10-15T03:00:00Z'))), cambios: { ven_id: '9' } };
  await guardar(archivo, estado);
  return { archivo, estado };
}

test('500, 502 y 504 del servidor se reintentan con los mismos bytes; no detienen al agente', async t => {
  const { enviarPendiente } = require('./envio');
  for (const status of [500, 502, 504]) {
    const { archivo, estado } = await conPendiente(t);
    const cuerpos = [];
    let llamadas = 0;
    const fetch = async (_, { body }) => {
      cuerpos.push(body);
      return ++llamadas === 1 ? { status, json: async () => { throw new Error('html'); } }
        : { status: 200, json: async () => ({ next_sequence: '81' }) };
    };
    assert.equal(await enviarPendiente(archivo, estado, { llave: 'x' }, { fetch, esperar: async () => {}, reloj: () => 0 }), true);
    assert.equal(estado.detenido, null);
    assert.equal(cuerpos[0], cuerpos[1]);
    assert.equal(estado.siguiente_secuencia, '81');
  }
});

test('si el servidor pide una secuencia MENOR (restauró un respaldo), el agente se detiene y avisa', async t => {
  const { enviarPendiente } = require('./envio');
  const { cargar } = require('./estado');
  const { archivo, estado } = await conPendiente(t, '80');
  const fetch = async () => ({ status: 409, json: async () => ({ codigo: 'SECUENCIA_INCORRECTA', siguiente_secuencia: '50' }) });
  const avisos = [];
  await assert.rejects(enviarPendiente(archivo, estado, { llave: 'x' }, { fetch, esperar: async () => {}, reloj: () => 0,
    log: m => avisos.push(m) }), /SECUENCIA_RETROCEDIO/);
  assert.equal((await cargar(archivo)).detenido, 'SECUENCIA_RETROCEDIO');
  assert.ok(avisos.includes('SECUENCIA_RETROCEDIO'));
});

test('cada corrida relee las ventas recientes bajo el cursor y manda las que se confirmaron tarde', async t => {
  const { ejecutar } = require('./corrida');
  const c = { cli_id: '42', nombre: 'José' };
  const fila = ven_id => ({ ven_id, cli_id: '42', fecha: '2026-10-15 10:00:00', status: 1, total: '10' });
  const det = ven_id => ({ ven_id, art_id: '8', descripcion: 'Cuerda', clave: null, cantidad: '1',
    precioCon: '10', precioSin: '8.6207', importeCon: '10', descTotal: '0' });
  const visibles = new Set(['1002']);
  const { archivo, deps, lotes } = await ciclo(t, {
    tope: async () => '1002',
    ventas: async (desde, hasta) => {
      const ids = [...visibles].filter(x => BigInt(x) > BigInt(desde) && BigInt(x) <= BigInt(hasta)).sort();
      return { filas: ids.map(fila), clientes: [c], detalles: ids.map(det) };
    },
  }, { fase: 'incremental', ven_id: '1000' });
  await ejecutar(archivo, { llave: 'x' }, deps);
  assert.deepEqual(lotes.flatMap(l => l.ventas.map(v => v.ven_id)), ['1002']);
  visibles.add('1001');
  await ejecutar(archivo, { llave: 'x' }, deps);
  assert.deepEqual(lotes.flatMap(l => l.ventas.map(v => v.ven_id)), ['1002', '1001'], 'la 1001 llegó tarde y aun así se manda');
  await ejecutar(archivo, { llave: 'x' }, deps);
  assert.equal(lotes.length, 2, 'lo ya visto no se vuelve a mandar en cada corrida');
});

test('la guardia de SQL rechaza comillas, comentarios y bloqueos compartidos', () => {
  const { validarSQL } = require('./seguridad');
  for (const sql of ["SELECT '#' INTO OUTFILE 'C:/x.txt'", "SELECT '/*', 1 INTO OUTFILE 'C:/x.txt' -- */'",
    "SELECT 1--1 INTO OUTFILE 'C:/x.txt'", "SELECT nombre FROM cliente WHERE '--' = '' UNION SELECT LOAD_FILE('C:/x')",
    'SELECT nombre FROM cliente FOR SHARE', 'SELECT `nombre` FROM cliente # huella', 'SELECT "a"', '/* x */ SELECT 1']) {
    assert.throws(() => validarSQL(sql), /SQL_NO_PERMITIDO/, sql);
  }
  assert.equal(validarSQL('SELECT `cli_id` FROM `cliente` WHERE `cli_id` > ? LIMIT ?'), 'SELECT `cli_id` FROM `cliente` WHERE `cli_id` > ? LIMIT ?');
});

test('un candado vacío recién creado (otra corrida arrancando) no se da por abandonado', async t => {
  const dir = await carpeta(t);
  const archivo = path.join(dir, 'estado.json');
  await fs.writeFile(`${archivo}.lock`, '');
  assert.equal(await bloquear(archivo), null);
  const hace = new Date(Date.now() - 10 * 60000);
  await fs.utimes(`${archivo}.lock`, hace, hace);
  const liberar = await bloquear(archivo);
  assert.ok(liberar, 'vacío y viejo sí está abandonado');
  await liberar();
});

test('historial con muchas cancelaciones se lee por páginas del tamaño permitido', async t => {
  const { ejecutar } = require('./corrida');
  const pedidas = [];
  const movimientos = Array.from({ length: 100 }, (_, i) => ({ his_id: String(i + 1), tabla: 'Venta', movimiento: 2, referencia: String(i + 1) }));
  const fuente = { tamano: 50, historial: async cursor => movimientos.filter(m => BigInt(m.his_id) > BigInt(cursor)).slice(0, 100),
    porIds: async ids => { if (ids.length > 50) throw new Error('PAGINA_EXCESIVA'); pedidas.push(ids.length); return { filas: [], clientes: [], detalles: [] }; } };
  const { archivo, deps } = await ciclo(t, fuente, { fase: 'incremental' });
  await ejecutar(archivo, { llave: 'x', historial: { columna_referencia: 'ref' } }, deps);
  assert.deepEqual(pedidas, [50, 50]);
});

test('páginas sin nada que mandar también llevan pausa y cuentan para el tope de la corrida', async t => {
  const { ejecutar } = require('./corrida');
  const { cargar } = require('./estado');
  const movimientos = Array.from({ length: 2500 }, (_, i) => ({ his_id: String(i + 1), tabla: 'Articulo', movimiento: 1, referencia: '5' }));
  const pausas = [];
  const { archivo, deps } = await ciclo(t, { tamano: 1,
    historial: async cursor => movimientos.filter(m => BigInt(m.his_id) > BigInt(cursor)).slice(0, 1) }, { fase: 'incremental' });
  deps.esperar = async ms => pausas.push(ms);
  await ejecutar(archivo, { llave: 'x', historial: { columna_referencia: 'ref' } }, deps);
  assert.equal((await cargar(archivo)).his_id, '1000', 'máximo 1000 páginas por corrida');
  assert.ok(pausas.filter(ms => ms >= 200).length >= 1000);
});

test('una venta con un dato raro se salta, se anota y la carga sigue; una cancelada ya enviada manda su cancelación', async t => {
  const { ejecutar } = require('./corrida');
  const { cargar } = require('./estado');
  const c = { cli_id: '42', nombre: 'José' };
  const fila = (ven_id, extra = {}) => ({ ven_id, cli_id: '42', fecha: '2026-10-10 10:00:00', status: 1, total: '10', ...extra });
  const det = ven_id => ({ ven_id, art_id: '8', descripcion: 'Cuerda', clave: null, cantidad: '1',
    precioCon: '10', precioSin: '8.6207', importeCon: '10', descTotal: '0' });
  const filas = [fila('1'), fila('2', { total: '10.005' }), fila('3', { status: -1 }), fila('4', { status: 7 }), fila('5')];
  const registro = [];
  const { archivo, deps, lotes } = await ciclo(t, {
    tope: async () => '5',
    ventas: async desde => {
      const ids = filas.filter(v => BigInt(v.ven_id) > BigInt(desde));
      return { filas: ids, clientes: [c], detalles: ids.filter(v => v.ven_id !== '3').map(v => det(v.ven_id)) };
    },
  }, { fase: 'ventas', enviadas: { 3: true } });
  deps.log = (evento, datos) => registro.push([evento, datos]);
  await ejecutar(archivo, { llave: 'x' }, deps);
  const ventas = lotes.flatMap(l => l.ventas);
  assert.deepEqual(ventas.map(v => v.ven_id), ['1', '3', '5']);
  assert.deepEqual(ventas[1], { ven_id: '3', estado: 'cancelada' }, 'cancelada sin renglones ya enviada: solo la cancelación');
  const omitidas = registro.filter(([e]) => e === 'VENTA_OMITIDA').map(([, d]) => `${d.ven_id}:${d.codigo}`);
  assert.deepEqual(omitidas, ['2:PRECISION_NO_PACTADA', '4:ESTADO_VENTA_DESCONOCIDO']);
  assert.equal((await cargar(archivo)).ven_id, '5', 'el cursor pasa por encima de las omitidas');
  assert.equal((await cargar(archivo)).detenido, null);
});

test('un cliente con datos imposibles se salta y se anota; los demás llegan', async t => {
  const { ejecutar } = require('./corrida');
  const registro = [];
  const { archivo, deps, lotes } = await ciclo(t, {
    clientes: async cursor => cursor === '0' ? [{ cli_id: '10', nombre: 'Ana' }, { cli_id: '11', nombre: 'x'.repeat(300) },
      { cli_id: '12', nombre: 'Luis' }] : [],
  });
  deps.log = (evento, datos) => registro.push([evento, datos]);
  await ejecutar(archivo, { llave: 'x' }, deps);
  assert.deepEqual(lotes.flatMap(l => l.clientes.map(x => x.cli_id)), ['10', '12']);
  assert.deepEqual(registro.filter(([e]) => e === 'CLIENTE_OMITIDO').map(([, d]) => `${d.cli_id}:${d.codigo}`), ['11:TEXTO_INVALIDO']);
});

test('el registro de omitidas muestra id y motivo, nunca otra cosa', () => {
  const salida = [];
  const log = registrar(linea => salida.push(linea));
  log('VENTA_OMITIDA', { ven_id: '2', codigo: 'PRECISION_NO_PACTADA' });
  log('VENTA_OMITIDA', { ven_id: '2', codigo: 'texto libre con secreto' });
  assert.deepEqual(salida, ['VENTA_OMITIDA ven_id=2 codigo=PRECISION_NO_PACTADA', 'VENTA_OMITIDA ven_id=2']);
});

test('--verificar cuenta las ventas que se saltarían y muestra cuáles, sin mandar nada', async t => {
  const { main } = require('./index');
  const dir = await carpeta(t);
  const archivo = path.join(dir, 'config.json');
  await fs.writeFile(archivo, JSON.stringify({ mysql: { host: 'localhost', database: 'sicar', password: 'p' },
    llave: 'k', estado: path.join(dir, 'estado.json') }));
  const c = { cli_id: '42', nombre: 'José' };
  const det = { ven_id: '9', art_id: '8', descripcion: 'Cuerda', clave: null, cantidad: '1',
    precioCon: '10', precioSin: '8.6', importeCon: '10', descTotal: '0' };
  const fuente = { tamano: 100, validar: async () => {}, tope: async () => '9', clientes: async () => [],
    verificar: async () => ({ grants: [], columnas: [], ventas: [], clientes: [] }),
    ventas: async cursor => cursor === '0' ? { filas: [
      { ven_id: '8', cli_id: '42', fecha: '2026-10-10 10:00:00', status: 1, total: '-5' },
      { ven_id: '9', cli_id: '42', fecha: '2026-10-10 10:00:00', status: 1, total: '10' }],
    clientes: [c], detalles: [{ ...det, ven_id: '8' }, det] } : { filas: [], clientes: [], detalles: [] } };
  const salida = [];
  await main(['--verificar'], { configPath: archivo, eco: () => {}, conectar: async () => ({ end: async () => {} }),
    crearFuente: async () => fuente, imprimir: x => salida.push(x), esperar: async () => {},
    fetch: async () => assert.fail('No debe enviar') });
  const texto = salida.join('\n');
  assert.match(texto, /Ventas con nombre: 2/);
  assert.match(texto, /Ventas que se saltarían por datos raros: 1/);
  assert.match(texto, /ven_id=8 codigo=DECIMAL_INVALIDO/);
});

test('--verificar no se cae con un cliente raro: lo cuenta como cliente que se saltaría', async t => {
  const { main } = require('./index');
  const dir = await carpeta(t);
  const archivo = path.join(dir, 'config.json');
  await fs.writeFile(archivo, JSON.stringify({ mysql: { host: 'localhost', database: 'sicar', password: 'p' },
    llave: 'k', estado: path.join(dir, 'estado.json') }));
  const raro = { cli_id: '500', nombre: 'x'.repeat(251) };
  const fuente = { tamano: 100, validar: async () => {}, tope: async () => '9',
    clientes: async cursor => cursor === '0' ? [{ cli_id: '42', nombre: 'José' }, raro] : [],
    verificar: async () => ({ grants: [], columnas: [], ventas: [], clientes: [] }),
    ventas: async cursor => cursor === '0' ? { filas: [{ ven_id: '9', cli_id: '500', fecha: '2026-10-10 10:00:00', status: 1, total: '1' }],
      clientes: [raro], detalles: [] } : { filas: [], clientes: [], detalles: [] } };
  const salida = [];
  await main(['--verificar'], { configPath: archivo, eco: () => {}, conectar: async () => ({ end: async () => {} }),
    crearFuente: async () => fuente, imprimir: x => salida.push(x), esperar: async () => {} });
  const texto = salida.join('\n');
  assert.match(texto, /Clientes con nombre: 1/);
  assert.match(texto, /Clientes que se saltarían por datos raros: 1/);
  assert.match(texto, /cli_id=500 codigo=TEXTO_INVALIDO/);
});

test('una venta vigente ya enviada que se vuelve rara se saca del CRM (excluida) y se anota', () => {
  const { ventaSegura } = require('./formato');
  const v = { ven_id: '9', cli_id: '42', fecha: '2026-10-10 10:00:00', status: 1, total: '10.005' };
  const d = { ven_id: '9', art_id: '8', descripcion: 'Cuerda', clave: null, cantidad: '1',
    precioCon: '10', precioSin: '8.6', importeCon: '10', descTotal: '0' };
  assert.deepEqual(ventaSegura(v, c, [d], true), { venta: { ven_id: '9', estado: 'excluida' },
    omitida: { ven_id: '9', codigo: 'PRECISION_NO_PACTADA' } });
  assert.deepEqual(ventaSegura(v, c, [d], false).venta, null, 'si nunca se mandó, no hay nada que sacar');
});

test('la guardia rechaza funciones entre comillas invertidas y literales hexadecimales', () => {
  const { validarSQL } = require('./seguridad');
  for (const sql of ['SELECT `sleep`(5) FROM venta', 'SELECT 0x41', 'SELECT `COUNT` (1)', 'SELECT X\'41\'']) {
    assert.throws(() => validarSQL(sql), /SQL_NO_PERMITIDO/, sql);
  }
});

test('la carga histórica de día solo corre con --historico-ahora, y solo en esa corrida', async t => {
  const { main } = require('./index');
  const { cargar } = require('./estado');
  const dir = await carpeta(t);
  const archivo = path.join(dir, 'config.json');
  const estadoRuta = path.join(dir, 'estado.json');
  await fs.writeFile(archivo, JSON.stringify({ mysql: { host: 'localhost', database: 'sicar', password: 'p' },
    llave: 'k', estado: estadoRuta }));
  const lotes = [];
  const fuente = { tamano: 100, validar: async () => {}, tope: async () => '0',
    clientes: async cursor => cursor === '0' ? [{ cli_id: '42', nombre: 'José' }] : [],
    ventas: async () => ({ filas: [], clientes: [], detalles: [] }), historial: async () => [],
    porIds: async () => ({ filas: [], clientes: [], detalles: [] }) };
  const deps = { configPath: archivo, eco: () => {}, conectar: async () => ({ end: async () => {} }), crearFuente: async () => fuente,
    esperar: async () => {}, reloj: () => Date.parse('2026-10-15T19:00:00Z'), // 13:00 en la tienda
    fetch: async (_, { body }) => { const l = JSON.parse(body); lotes.push(l);
      return { status: 200, json: async () => ({ next_sequence: String(BigInt(l.sequence) + 1n) }) }; } };
  await main([], deps);
  assert.equal(lotes.length, 0, 'de día, sin la bandera, no manda');
  await main(['--historico-ahora'], deps);
  assert.equal(lotes.length, 1);
  assert.equal(lotes[0].mode, 'historico');
  assert.equal((await cargar(estadoRuta)).fase, 'incremental');
  await assert.rejects(main(['--historico-ahora', '--verificar'], deps), 'no se combina con --verificar');
});
test('--articulos-ahora manda la lista de dia solo con el interruptor articulos: true en config', async t => {
  const { main } = require('./index');
  const { inicial, guardar } = require('./estado');
  const dir = await carpeta(t);
  const archivo = path.join(dir, 'config.json');
  const estadoRuta = path.join(dir, 'estado.json');
  await guardar(estadoRuta, { ...inicial(), fase: 'incremental' });
  const config = { mysql: { host: 'localhost', database: 'sicar', password: 'p' }, llave: 'k', estado: estadoRuta };
  const lotes = [];
  const vacia = async () => ({ filas: [], clientes: [], detalles: [] });
  const fuente = { tamano: 100, articulosDisponibles: true, validar: async () => {}, tope: async () => '0', clientes: async () => [],
    ventas: vacia, historial: async () => [], porIds: vacia,
    articulos: async cursor => cursor === '0' ? [{ art_id: '5', clave: 'X', descripcion: 'Bafle', categoria: 'Bafles', departamento: 'Audio' }] : [] };
  const deps = { configPath: archivo, eco: () => {}, conectar: async () => ({ end: async () => {} }), crearFuente: async () => fuente,
    esperar: async () => {}, reloj: () => Date.parse('2026-10-15T19:00:00Z'), // 13:00 en la tienda
    fetch: async (_, { body }) => { const l = JSON.parse(body); lotes.push(l);
      return { status: 200, json: async () => ({ next_sequence: String(BigInt(l.sequence) + 1n) }) }; } };
  await fs.writeFile(archivo, JSON.stringify({ ...config, articulos: 'si' }));
  await assert.rejects(main(['--articulos-ahora'], deps), /CONFIGURACION_INVALIDA/);
  await fs.writeFile(archivo, JSON.stringify(config));
  await main(['--articulos-ahora'], deps);
  assert.equal(lotes.length, 0, 'sin interruptor no manda');
  await fs.writeFile(archivo, JSON.stringify({ ...config, articulos: true }));
  await main([], deps);
  assert.equal(lotes.length, 0, 'de dia, sin la bandera, no manda');
  await main(['--articulos-ahora'], deps);
  assert.deepEqual(lotes.map(l => l.articulos?.map(a => a.art_id)), [['5']]);
});
test('--proveedores-ahora manda la lista de dia solo con el interruptor proveedores: true en config', async t => {
  const { main } = require('./index');
  const { inicial, guardar } = require('./estado');
  const dir = await carpeta(t);
  const archivo = path.join(dir, 'config.json');
  const estadoRuta = path.join(dir, 'estado.json');
  await guardar(estadoRuta, { ...inicial(), fase: 'incremental' });
  const config = { mysql: { host: 'localhost', database: 'sicar', password: 'p' }, llave: 'k', estado: estadoRuta };
  const lotes = [];
  const vacia = async () => ({ filas: [], clientes: [], detalles: [] });
  const fuente = { tamano: 100, proveedoresDisponibles: true, validar: async () => {}, tope: async () => '0', clientes: async () => [],
    ventas: vacia, historial: async () => [], porIds: vacia,
    proveedores: async cursor => cursor === '0' ? [{ prv_id: '5', nombre: 'Casa Veerkamp' }] : [] };
  const deps = { configPath: archivo, eco: () => {}, conectar: async () => ({ end: async () => {} }), crearFuente: async () => fuente,
    esperar: async () => {}, reloj: () => Date.parse('2026-10-15T19:00:00Z'), // 13:00 en la tienda
    fetch: async (_, { body }) => { const l = JSON.parse(body); lotes.push(l);
      return { status: 200, json: async () => ({ next_sequence: String(BigInt(l.sequence) + 1n) }) }; } };
  await fs.writeFile(archivo, JSON.stringify(config));
  await main(['--proveedores-ahora'], deps);
  assert.equal(lotes.length, 0, 'sin interruptor no manda');
  await fs.writeFile(archivo, JSON.stringify({ ...config, proveedores: true }));
  await main([], deps);
  assert.equal(lotes.length, 0, 'de dia, sin la bandera, no manda');
  await main(['--proveedores-ahora'], deps);
  assert.deepEqual(lotes.map(l => l.proveedores?.map(x => x.prv_id)), [['5']]);
  await assert.rejects(main(['--proveedores-ahora', '--verificar'], deps), 'no se combina con --verificar');
});
test('--verificar explica por qué la cifra de público por número de cliente y la del nombre pueden diferir', async t => {
  const { main } = require('./index');
  const dir = await carpeta(t);
  const archivo = path.join(dir, 'config.json');
  await fs.writeFile(archivo, JSON.stringify({ mysql: { host: 'localhost', database: 'sicar', password: 'p' },
    llave: 'k', estado: path.join(dir, 'estado.json') }));
  const fuente = { tamano: 100, validar: async () => {}, tope: async () => '9', clientes: async () => [],
    verificar: async () => ({ grants: [], columnas: [], ventas: [], clientes: [],
      mostrador: { total_publico_desde_2025: '4', desde_ven_id: '1' } }),
    ventas: async () => ({ filas: [], clientes: [], detalles: [] }) };
  const salida = [];
  await main(['--verificar'], { configPath: archivo, eco: () => {}, conectar: async () => ({ end: async () => {} }),
    crearFuente: async () => fuente, imprimir: x => salida.push(x), esperar: async () => {},
    fetch: async () => assert.fail('No debe enviar') });
  const texto = salida.join('\n');
  assert.match(texto, /pueden diferir/);
  assert.match(texto, /sin nombre/);
  assert.match(texto, /PÚBLICO EN GENERAL/);
});
