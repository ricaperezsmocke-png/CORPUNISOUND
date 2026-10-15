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
