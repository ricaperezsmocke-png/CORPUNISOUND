const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { EventEmitter } = require('node:events');
const { createRequire } = require('node:module');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const backend = createRequire(path.resolve(__dirname, '../backend/package.json'));
const Database = backend('better-sqlite3');
const { crearRepositorioSicar } = require('../backend/sicarRepositorio');
const { crearLlaveSicar } = require('../backend/sicarIngesta');
const { registrarAgenteSicar } = require('../backend/sicarRutas');
const crypto = require('node:crypto');
const { enviarPendiente } = require('./envio');
const { ejecutar } = require('./corrida');
const { cargar, guardar, inicial } = require('./estado');

test('agente → ruta real → SQLite en memoria: repetidos, ACK perdido, cancelación y exclusión', async t => {
  const sqlite = new Database(':memory:');
  t.after(() => sqlite.close());
  const repo = crearRepositorioSicar(sqlite);
  const llave = crearLlaveSicar(repo, 1, 961).llave;
  let ruta;
  registrarAgenteSicar({ use: (prefijo, handler) => {
    assert.equal(prefijo, '/api/integraciones/sicar'); ruta = handler;
  } }, { repo, mantenimiento: { estaActivo: () => false } });
  // Solo el transporte es un doble: autentica, parsea y aplica la ruta REAL sin abrir red.
  function transportar(_, opciones) {
    return new Promise(resolve => {
      const req = Readable.from([Buffer.from(opciones.body, 'utf8')]);
      Object.assign(req, { method: 'POST', path: '/v1/lotes', socket: { remoteAddress: '127.0.0.1' },
        headers: { authorization: opciones.headers.Authorization, 'content-type': opciones.headers['Content-Type'] } });
      const res = new EventEmitter();
      res.set = () => res;
      res.status = status => { res.codigo = status; return res; };
      res.json = datos => { res.emit('close'); resolve({ status: res.codigo, json: async () => datos }); };
      ruta(req, res);
    });
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sicar-integracion-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const archivo = path.join(dir, 'estado.json');
  await guardar(archivo, { ...inicial(), fase: 'incremental' });
  let status = 1, publico = false;
  const pagina = () => ({ filas: [{ ven_id: '88020', cli_id: publico ? '1' : '4501', fecha: '2015-01-01 10:00:00', status, total: '30.00' }],
    clientes: [{ cli_id: publico ? '1' : '4501', nombre: publico ? 'PÚBLICO EN GENERAL' : 'José Peña' }],
    detalles: ['10', '20'].map((importe, i) => ({ ven_id: '88020', art_id: '8', clave: null,
      descripcion: i ? 'Segundo renglón' : 'Primer renglón', cantidad: '1', precioCon: importe,
      precioSin: '0', importeCon: importe, descTotal: '0' })) });
  const fuente = { tamano: 100, validar: async () => {}, tope: async () => '88020',
    ventas: async cursor => cursor === '0' ? pagina() : { filas: [], clientes: [], detalles: [] },
    porIds: async () => pagina(), historial: async () => [], clientesIds: async () => [] };
  const cuerpos = [];
  let perderACK = true;
  const deps = { fuente, esperar: async () => {}, reloj: () => Date.parse('2026-10-15T03:00:00Z'),
    fetch: async (url, opciones) => {
      cuerpos.push(opciones.body);
      const respuesta = await transportar(url, opciones);
      assert.equal(respuesta.status, 200, JSON.stringify(await respuesta.json()));
      if (perderACK) { perderACK = false; throw new Error('ACK perdido'); }
      return respuesta;
    } };
  await ejecutar(archivo, { llave }, deps);
  assert.equal(cuerpos[0], cuerpos[1]);
  assert.equal((await cargar(archivo)).ven_id, '88020');
  assert.equal(sqlite.prepare('SELECT nombre FROM sicar_clientes').get().nombre, 'José Peña');
  assert.equal(sqlite.prepare('SELECT count(*) n FROM sicar_ventas').get().n, 1);
  assert.deepEqual(sqlite.prepare('SELECT renglon, art_id, importe_centavos FROM sicar_detalles ORDER BY renglon').all(), [
    { renglon: 0, art_id: '8', importe_centavos: 1000 }, { renglon: 1, art_id: '8', importe_centavos: 2000 },
  ]);
  status = -1;
  fuente.historial = async cursor => cursor === '0' ? [{ his_id: '1', tabla: 'Venta', movimiento: 2, referencia: '88020' }] : [];
  const config = { llave, historial: { columna_referencia: 'referencia_real' } };
  await ejecutar(archivo, config, deps);
  assert.equal(sqlite.prepare('SELECT estado FROM sicar_ventas').get().estado, 'cancelada');
  publico = true;
  fuente.historial = async cursor => cursor === '1' ? [{ his_id: '2', tabla: 'Venta', movimiento: 2, referencia: '88020' }] : [];
  await ejecutar(archivo, config, deps);
  assert.equal(sqlite.prepare('SELECT estado FROM sicar_ventas').get().estado, 'excluida');
  assert.equal(sqlite.prepare('SELECT count(*) n FROM sicar_detalles').get().n, 0);
  assert.equal(cuerpos.some(c => c.includes('PÚBLICO')), false);
});

test('agente → ruta real: la lista de proveedores entra a sicar_proveedores y un nombre raro se salta', async t => {
  const sqlite = new Database(':memory:');
  t.after(() => sqlite.close());
  const repo = crearRepositorioSicar(sqlite);
  const llave = crearLlaveSicar(repo, 1, 961).llave;
  let ruta;
  registrarAgenteSicar({ use: (_, handler) => { ruta = handler; } }, { repo, mantenimiento: { estaActivo: () => false } });
  const transportar = (_, opciones) => new Promise(resolve => {
    const req = Readable.from([Buffer.from(opciones.body, 'utf8')]);
    Object.assign(req, { method: 'POST', path: '/v1/lotes', socket: { remoteAddress: '127.0.0.1' },
      headers: { authorization: opciones.headers.Authorization, 'content-type': opciones.headers['Content-Type'] } });
    const res = new EventEmitter();
    res.set = () => res;
    res.status = status => { res.codigo = status; return res; };
    res.json = datos => { res.emit('close'); resolve({ status: res.codigo, json: async () => datos }); };
    ruta(req, res);
  });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sicar-proveedores-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const archivo = path.join(dir, 'estado.json');
  await guardar(archivo, { ...inicial(), fase: 'incremental' });
  const vacia = async () => ({ filas: [], clientes: [], detalles: [] });
  const filas = [{ prv_id: '7', nombre: ' Casa Veerkamp ' }, { prv_id: '8', nombre: '  ' }, { prv_id: '9', nombre: 'Fender México' }];
  const fuente = { tamano: 100, proveedoresDisponibles: true, validar: async () => {}, tope: async () => '0',
    ventas: vacia, porIds: vacia, historial: async () => [], clientesIds: async () => [],
    proveedores: async cursor => filas.filter(p => BigInt(p.prv_id) > BigInt(cursor)) };
  const mensajes = [];
  await ejecutar(archivo, { llave, proveedores: true }, { fuente, esperar: async () => {}, log: m => mensajes.push(m),
    reloj: () => Date.parse('2026-10-15T03:00:00Z'), fetch: async (url, opciones) => {
      const respuesta = await transportar(url, opciones);
      assert.equal(respuesta.status, 200, JSON.stringify(await respuesta.json()));
      return respuesta;
    } });
  assert.ok(mensajes.includes('PROVEEDOR_OMITIDO'));
  assert.deepEqual(sqlite.prepare('SELECT sucursal_id, prv_id, nombre FROM sicar_proveedores ORDER BY prv_id').all(),
    [{ sucursal_id: 1, prv_id: '7', nombre: 'Casa Veerkamp' }, { sucursal_id: 1, prv_id: '9', nombre: 'Fender México' }]);
  assert.equal((await cargar(archivo)).proveedores_dia, '2026-10-14');
});

test('agente → ruta real: un lote de existencias entra a sicar_existencias en diezmilesimas y el null la borra', async t => {
  const sqlite = new Database(':memory:');
  t.after(() => sqlite.close());
  const repo = crearRepositorioSicar(sqlite);
  const llave = crearLlaveSicar(repo, 1, 961).llave;
  let ruta;
  registrarAgenteSicar({ use: (_, handler) => { ruta = handler; } }, { repo, mantenimiento: { estaActivo: () => false } });
  const transportar = (_, opciones) => new Promise(resolve => {
    const req = Readable.from([Buffer.from(opciones.body, 'utf8')]);
    Object.assign(req, { method: 'POST', path: '/v1/lotes', socket: { remoteAddress: '127.0.0.1' },
      headers: { authorization: opciones.headers.Authorization, 'content-type': opciones.headers['Content-Type'] } });
    const res = new EventEmitter();
    res.set = () => res;
    res.status = status => { res.codigo = status; return res; };
    res.json = datos => { res.emit('close'); resolve({ status: res.codigo, json: async () => datos }); };
    ruta(req, res);
  });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sicar-existencias-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const archivo = path.join(dir, 'estado.json');
  const enviar = async (sequence, existencias) => {
    const bytes = JSON.stringify({ schema_version: 1, mapping_version: 'ocosingo-f0-v1', batch_id: crypto.randomUUID(), sequence,
      captured_at: '2026-10-15T03:00:00Z', mode: 'incremental', window: { from: '2026-10-14T00:00:00-06:00', to: '2026-10-15T00:00:00-06:00' },
      clientes: [], ventas: [], existencias });
    const estado = { ...inicial(), fase: 'incremental', siguiente_secuencia: sequence, pendiente: { bytes, cambios: {} } };
    await guardar(archivo, estado);
    return enviarPendiente(archivo, estado, { llave }, { fetch: transportar, esperar: async () => {}, reloj: () => 1 });
  };
  assert.equal(await enviar('1', [{ art_id: '7', existencia: '-1.5000' }, { art_id: '8', existencia: '12.0000' }]), true);
  assert.deepEqual(repo.listarExistencias().map(f => [f.art_id, f.existencia_diezmilesimas]), [['7', -15000], ['8', 120000]]);
  assert.equal(await enviar('2', [{ art_id: '7', existencia: null }]), true);
  assert.deepEqual(repo.listarExistencias().map(f => f.art_id), ['8']);
});

test('agente → ruta real: un lote de cortes entra a sicar_cortes con sus pagos y cobros en centavos', async t => {
  const sqlite = new Database(':memory:');
  t.after(() => sqlite.close());
  const repo = crearRepositorioSicar(sqlite);
  const llave = crearLlaveSicar(repo, 1, 961).llave;
  let ruta;
  registrarAgenteSicar({ use: (_, handler) => { ruta = handler; } }, { repo, mantenimiento: { estaActivo: () => false } });
  const transportar = (_, opciones) => new Promise(resolve => {
    const req = Readable.from([Buffer.from(opciones.body, 'utf8')]);
    Object.assign(req, { method: 'POST', path: '/v1/lotes', socket: { remoteAddress: '127.0.0.1' },
      headers: { authorization: opciones.headers.Authorization, 'content-type': opciones.headers['Content-Type'] } });
    const res = new EventEmitter();
    res.set = () => res;
    res.status = status => { res.codigo = status; return res; };
    res.json = datos => { res.emit('close'); resolve({ status: res.codigo, json: async () => datos }); };
    ruta(req, res);
  });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sicar-cortes-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const archivo = path.join(dir, 'estado.json');
  const cortes = [{ cor_id: '5', caj_id: '2', fecha_local: '2026-10-22T20:15:00', usu_id: '3', contado: '100.00', calculado: '100.33',
    diferencia: '-0.33', retiro: '0.00', pagos: [{ tpa_id: '1', contado: '100.00', calculado: '100.33', diferencia: '-0.33', retiro: '0.00' }],
    cobros: [{ usu_id: '3', ventas: 2, total: '100.33', canceladas: 0, total_canceladas: '0.00' }] }];
  const bytes = JSON.stringify({ schema_version: 1, mapping_version: 'ocosingo-f0-v1', batch_id: crypto.randomUUID(), sequence: '1',
    captured_at: '2026-10-15T03:00:00Z', mode: 'incremental', window: { from: '2026-10-14T00:00:00-06:00', to: '2026-10-15T00:00:00-06:00' },
    clientes: [], ventas: [], cortes });
  const estado = { ...inicial(), fase: 'incremental', siguiente_secuencia: '1', pendiente: { bytes, cambios: {} } };
  await guardar(archivo, estado);
  assert.equal(await enviarPendiente(archivo, estado, { llave }, { fetch: transportar, esperar: async () => {}, reloj: () => 1 }), true);
  assert.deepEqual(repo.listarCortes().map(c => [c.cor_id, c.usu_id, c.diferencia_centavos]), [['5', '3', -33]]);
  assert.deepEqual(sqlite.prepare('SELECT tpa_id, calculado_centavos FROM sicar_cortes_pagos').all(), [{ tpa_id: '1', calculado_centavos: 10033 }]);
});
