const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { inicial, guardar, cargar } = require('./estado');
const { ejecutar } = require('./corrida');
const { sobre } = require('./formato');
const c = { cli_id: '42', nombre: 'José' };
const v = { ven_id: '9', cli_id: '42', fecha: '2015-01-01 10:00:00', status: -1, total: '10' };
const d = { ven_id: '9', art_id: '8', descripcion: 'Cuerda', clave: null, cantidad: '1',
  precioCon: '10', precioSin: '8.6207', importeCon: '10', descTotal: '0' };
const vacia = () => ({ filas: [], clientes: [], detalles: [] });
async function preparar(t, estado = inicial()) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sicar-ciclo-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const archivo = path.join(dir, 'estado.json');
  await guardar(archivo, estado);
  const lotes = [], mensajes = [], pausas = [];
  const fuente = { tamano: 100, validar: async () => {}, tope: async () => '9',
    clientes: async cursor => cursor === '0' ? [c] : [], ventas: async () => vacia(),
    historial: async () => [], clientesIds: async () => [c], porIds: async () => vacia() };
  const deps = { fuente, reloj: () => Date.parse('2026-10-15T03:00:00Z'), esperar: async ms => pausas.push(ms),
    log: m => mensajes.push(m), fetch: async (_, { body }) => {
      const lote = JSON.parse(body);
      lotes.push(lote);
      return { status: 200, json: async () => ({ next_sequence: String(BigInt(lote.sequence) + 1n) }) };
    } };
  return { archivo, fuente, deps, lotes, mensajes, pausas };
}
test('histórica envía clientes sin compras antes de ventas y respeta tope inicial', async t => {
  const p = await preparar(t);
  let primera = true;
  p.fuente.ventas = async (cursor, tope) => {
    assert.equal(tope, '9');
    if (!primera) return vacia();
    primera = false;
    assert.equal(cursor, '0');
    return { filas: [v], clientes: [c], detalles: [d] };
  };
  await ejecutar(p.archivo, {}, p.deps);
  assert.equal(p.lotes[0].clientes[0].nombre, 'José');
  assert.equal(p.lotes[0].ventas.length, 0);
  assert.equal(p.lotes.find(l => l.ventas.length).ventas[0].estado, 'cancelada');
  assert.equal((await cargar(p.archivo)).fase, 'incremental');
  assert.equal((await cargar(p.archivo)).ven_id, '9');
  assert.ok(p.pausas.includes(1000));
});
test('de día no lee histórica ni transmite su lote pendiente', async t => {
  const p = await preparar(t);
  p.deps.reloj = () => Date.parse('2026-10-15T18:00:00Z');
  p.fuente.clientes = async () => assert.fail('No debe consultar');
  await ejecutar(p.archivo, {}, p.deps);
  assert.equal(p.lotes.length, 0);
  assert.equal((await cargar(p.archivo)).cli_id, '0');
  assert.ok(p.mensajes.includes('FUERA_DE_HORARIO'));
});
test('historial desactivado avisa y conserva su cursor mientras procesa ventas nuevas', async t => {
  const estado = { ...inicial(), fase: 'incremental', his_id: '70' };
  const p = await preparar(t, estado);
  p.fuente.historial = async () => assert.fail('Historial apagado');
  p.fuente.ventas = async cursor => cursor === '0' ? { filas: [v], clientes: [c], detalles: [d] } : vacia();
  await ejecutar(p.archivo, {}, p.deps);
  assert.equal((await cargar(p.archivo)).his_id, '70');
  assert.equal((await cargar(p.archivo)).ven_id, '9');
  assert.ok(p.mensajes.includes('HISTORIAL_SIN_CONFIGURAR'));
});
test('historial configurado envía cancelación de 2015 y confirma his_id con 200', async t => {
  const p = await preparar(t, { ...inicial(), fase: 'incremental', ven_id: '9', his_id: '70' });
  p.fuente.historial = async cursor => cursor === '70'
    ? [{ his_id: '80', tabla: 'Venta', movimiento: 2, referencia: '9' }] : [];
  p.fuente.porIds = async ids => {
    assert.deepEqual(ids, ['9']);
    return { filas: [v], clientes: [c], detalles: [d] };
  };
  await ejecutar(p.archivo, { historial: { columna_referencia: 'referencia_real' } }, p.deps);
  assert.equal(p.lotes[0].ventas[0].estado, 'cancelada');
  assert.equal((await cargar(p.archivo)).his_id, '80');
});
test('relee 48 horas por ids y excluye venta enviada que pasó a público', async t => {
  const estado = { ...inicial(), fase: 'incremental', ven_id: '9', enviadas: { '9': true },
    ventana: { '9': '2026-10-14T10:00:00', '8': '2015-01-01T10:00:00' } };
  const p = await preparar(t, estado);
  p.fuente.porIds = async ids => {
    assert.deepEqual(ids, ['9']);
    return { filas: [{ ...v, cli_id: '1' }], clientes: [{ cli_id: '1', nombre: 'PÚBLICO EN GENERAL' }], detalles: [] };
  };
  await ejecutar(p.archivo, {}, p.deps);
  assert.deepEqual(p.lotes[0].ventas, [{ ven_id: '9', estado: 'excluida' }]);
  assert.deepEqual(p.lotes[0].clientes, []);
});
test('divide por 1000 renglones sin perder cursor ni artículos repetidos', async t => {
  const p = await preparar(t, { ...inicial(), fase: 'incremental' });
  const filas = ['7', '8', '9'].map(ven_id => ({ ...v, ven_id }));
  p.fuente.ventas = async cursor => cursor === '0'
    ? { filas, clientes: [c], detalles: filas.flatMap(f => Array.from({ length: 400 }, () => ({ ...d, ven_id: f.ven_id }))) } : vacia();
  await ejecutar(p.archivo, {}, p.deps);
  assert.deepEqual(p.lotes.map(l => l.ventas.length), [2, 1]);
  assert.equal(p.lotes[0].ventas[0].detalle.length, 400);
  assert.equal((await cargar(p.archivo)).ven_id, '9');
});
test('columna faltante al arrancar bloquea incluso el reenvío pendiente', async t => {
  const estado = { ...inicial(), fase: 'incremental', pendiente: {
    bytes: JSON.stringify(sobre('1', 'incremental', new Date('2026-10-15T03:00:00Z'))), cambios: { ven_id: '9' },
  } };
  const p = await preparar(t, estado);
  p.fuente.validar = async () => { throw new Error('Falta columna detallev.precioSin'); };
  await assert.rejects(ejecutar(p.archivo, {}, p.deps), /Falta columna/);
  assert.equal(p.lotes.length, 0);
  assert.equal((await cargar(p.archivo)).ven_id, '0');
});

function conArticulos(p, filas) {
  p.fuente.articulosDisponibles = true;
  const leidos = [];
  p.fuente.articulos = async (cursor, limite) => { leidos.push(cursor); return filas.filter(a => BigInt(a.art_id) > BigInt(cursor)).slice(0, limite); };
  return leidos;
}
const articulo = n => ({ art_id: String(n), clave: `C-${n}`, descripcion: `Articulo ${n}`, categoria: 'Bafles', departamento: 'Audio' });
test('articulos: de noche manda la lista completa en lotes aparte y marca el dia', async t => {
  const p = await preparar(t, { ...inicial(), fase: 'incremental' });
  p.fuente.tamano = 2;
  conArticulos(p, [articulo(1), articulo(2), articulo(3)]);
  await ejecutar(p.archivo, { articulos: true }, p.deps);
  const lotes = p.lotes.filter(l => l.articulos);
  assert.deepEqual(lotes.map(l => l.articulos.map(a => a.art_id)), [['1', '2', '3']], 'hasta 500 por lote aunque la pagina normal sea chica');
  assert.ok(lotes.every(l => !l.clientes.length && !l.ventas.length));
  const estado = await cargar(p.archivo);
  assert.equal(estado.articulos_dia, '2026-10-14');
  assert.equal(estado.articulos_cursor, '0');
  p.lotes.length = 0;
  await ejecutar(p.archivo, { articulos: true }, p.deps);
  assert.equal(p.lotes.length, 0, 'el mismo dia no se repite');
});
test('articulos: de dia no se mandan salvo con articulosAhora', async t => {
  const p = await preparar(t, { ...inicial(), fase: 'incremental' });
  p.deps.reloj = () => Date.parse('2026-10-15T18:00:00Z');
  conArticulos(p, [articulo(1)]);
  await ejecutar(p.archivo, { articulos: true }, p.deps);
  assert.equal(p.lotes.length, 0);
  await ejecutar(p.archivo, { articulos: true }, { ...p.deps, articulosAhora: true });
  assert.deepEqual(p.lotes.map(l => l.articulos?.length), [1]);
});
test('articulos: no se mandan mientras la carga historica no termina', async t => {
  const p = await preparar(t);
  const leidos = conArticulos(p, [articulo(1)]);
  await ejecutar(p.archivo, { articulos: true }, p.deps);
  assert.equal(leidos.length, 0);
  assert.ok(p.lotes.every(l => !l.articulos));
});
test('articulos: sin columnas avisa y las ventas se siguen mandando', async t => {
  const p = await preparar(t, { ...inicial(), fase: 'incremental' });
  p.fuente.articulosDisponibles = false;
  p.fuente.articulos = async () => assert.fail('No debe consultar');
  p.fuente.ventas = async cursor => cursor === '0' ? { filas: [v], clientes: [c], detalles: [d] } : vacia();
  await ejecutar(p.archivo, { articulos: true }, p.deps);
  assert.ok(p.mensajes.includes('ARTICULOS_NO_DISPONIBLES'));
  assert.equal(p.lotes.filter(l => l.ventas.length).length, 1);
  assert.equal((await cargar(p.archivo)).articulos_dia, null);
});
test('articulos: uno raro se omite con su id y el resto se manda; cursor solo avanza con 200', async t => {
  const p = await preparar(t, { ...inicial(), fase: 'incremental' });
  conArticulos(p, [articulo(1), { ...articulo(2), descripcion: ' ' }, articulo(3)]);
  const fetch = p.deps.fetch;
  p.deps.fetch = async (...args) => JSON.parse(args[1].body).articulos ? { status: 503, json: async () => ({}) } : fetch(...args);
  await ejecutar(p.archivo, { articulos: true }, { ...p.deps, intentos: 1 });
  const atorado = await cargar(p.archivo);
  assert.equal(atorado.articulos_cursor, '0');
  assert.ok(atorado.pendiente);
  p.deps.fetch = fetch;
  await ejecutar(p.archivo, { articulos: true }, p.deps);
  assert.ok(p.mensajes.includes('ARTICULO_OMITIDO'));
  assert.deepEqual(p.lotes.filter(l => l.articulos).at(-1).articulos.map(a => a.art_id), ['1', '3']);
  const estado = await cargar(p.archivo);
  assert.equal(estado.articulos_dia, '2026-10-14');
  assert.equal(estado.pendiente, null);
});test('articulos: sin el interruptor en config no se leen ni se mandan, y los lotes no llevan la llave articulos', async t => {
  const p = await preparar(t, { ...inicial(), fase: 'incremental' });
  const leidos = conArticulos(p, [articulo(1)]);
  p.fuente.ventas = async cursor => cursor === '0' ? { filas: [v], clientes: [c], detalles: [d] } : vacia();
  await ejecutar(p.archivo, {}, { ...p.deps, articulosAhora: true });
  assert.equal(leidos.length, 0);
  assert.ok(p.lotes.length > 0);
  assert.ok(p.lotes.every(l => !Object.hasOwn(l, 'articulos')), 'un servidor viejo rechazaria la llave');
  assert.equal(p.mensajes.includes('ARTICULOS_NO_DISPONIBLES'), false);
});

function conProveedores(p, filas) {
  p.fuente.proveedoresDisponibles = true;
  const leidos = [];
  p.fuente.proveedores = async (cursor, limite) => { leidos.push(cursor); return filas.filter(x => BigInt(x.prv_id) > BigInt(cursor)).slice(0, limite); };
  return leidos;
}
const proveedor = n => ({ prv_id: String(n), nombre: `Proveedor ${n}` });
test('proveedores: de noche manda la lista completa en lotes aparte y marca el dia', async t => {
  const p = await preparar(t, { ...inicial(), fase: 'incremental' });
  p.fuente.tamano = 2;
  conProveedores(p, [proveedor(1), proveedor(2), proveedor(3)]);
  await ejecutar(p.archivo, { proveedores: true }, p.deps);
  const lotes = p.lotes.filter(l => l.proveedores);
  assert.deepEqual(lotes.map(l => l.proveedores.map(x => x.prv_id)), [['1', '2', '3']]);
  assert.ok(lotes.every(l => !l.clientes.length && !l.ventas.length && !Object.hasOwn(l, 'articulos')));
  const estado = await cargar(p.archivo);
  assert.equal(estado.proveedores_dia, '2026-10-14');
  assert.equal(estado.proveedores_cursor, '0');
  p.lotes.length = 0;
  await ejecutar(p.archivo, { proveedores: true }, p.deps);
  assert.equal(p.lotes.length, 0, 'el mismo dia no se repite');
});
test('proveedores: de dia no se mandan salvo con proveedoresAhora', async t => {
  const p = await preparar(t, { ...inicial(), fase: 'incremental' });
  p.deps.reloj = () => Date.parse('2026-10-15T18:00:00Z');
  conProveedores(p, [proveedor(1)]);
  await ejecutar(p.archivo, { proveedores: true }, p.deps);
  assert.equal(p.lotes.length, 0);
  await ejecutar(p.archivo, { proveedores: true }, { ...p.deps, articulosAhora: true });
  assert.equal(p.lotes.length, 0, 'la bandera de articulos no prende proveedores');
  await ejecutar(p.archivo, { proveedores: true }, { ...p.deps, proveedoresAhora: true });
  assert.deepEqual(p.lotes.map(l => l.proveedores?.length), [1]);
});
test('proveedores: se mandan aunque los articulos esten apagados o sin columnas, y despues de ellos', async t => {
  const p = await preparar(t, { ...inicial(), fase: 'incremental' });
  conArticulos(p, [articulo(1)]);
  conProveedores(p, [proveedor(4)]);
  await ejecutar(p.archivo, { articulos: true, proveedores: true }, p.deps);
  assert.deepEqual(p.lotes.map(l => l.articulos ? 'articulos' : l.proveedores ? 'proveedores' : 'otro'), ['articulos', 'proveedores']);
  const q = await preparar(t, { ...inicial(), fase: 'incremental' });
  q.fuente.articulosDisponibles = false;
  conProveedores(q, [proveedor(4)]);
  await ejecutar(q.archivo, { articulos: true, proveedores: true }, q.deps);
  assert.ok(q.mensajes.includes('ARTICULOS_NO_DISPONIBLES'));
  assert.deepEqual(q.lotes.map(l => l.proveedores?.length), [1]);
});
test('proveedores: sin columnas avisa y las ventas se siguen mandando', async t => {
  const p = await preparar(t, { ...inicial(), fase: 'incremental' });
  p.fuente.proveedoresDisponibles = false;
  p.fuente.proveedores = async () => assert.fail('No debe consultar');
  p.fuente.ventas = async cursor => cursor === '0' ? { filas: [v], clientes: [c], detalles: [d] } : vacia();
  await ejecutar(p.archivo, { proveedores: true }, p.deps);
  assert.ok(p.mensajes.includes('PROVEEDORES_NO_DISPONIBLES'));
  assert.equal(p.lotes.filter(l => l.ventas.length).length, 1);
  assert.equal((await cargar(p.archivo)).proveedores_dia, null);
});
test('proveedores: uno raro se omite con su id y el resto se manda', async t => {
  const p = await preparar(t, { ...inicial(), fase: 'incremental' });
  conProveedores(p, [proveedor(1), { prv_id: '2', nombre: '   ' }, proveedor(3)]);
  await ejecutar(p.archivo, { proveedores: true }, p.deps);
  assert.ok(p.mensajes.includes('PROVEEDOR_OMITIDO'));
  assert.deepEqual(p.lotes.filter(l => l.proveedores).at(-1).proveedores.map(x => x.prv_id), ['1', '3']);
});
test('proveedores: un id repetido en la pagina se manda una sola vez (el primero) y no detiene el agente', async t => {
  const p = await preparar(t, { ...inicial(), fase: 'incremental' });
  p.fuente.proveedores = async cursor => (cursor === '0'
    ? [proveedor(1), { prv_id: 2, nombre: 'Primero' }, { prv_id: '2', nombre: 'Repetido' }, proveedor(3)] : []);
  p.fuente.proveedoresDisponibles = true;
  await ejecutar(p.archivo, { proveedores: true }, p.deps);
  const mandados = p.lotes.filter(l => l.proveedores).flatMap(l => l.proveedores);
  assert.deepEqual(mandados.map(x => [x.prv_id, x.nombre]), [['1', 'Proveedor 1'], ['2', 'Primero'], ['3', 'Proveedor 3']]);
  const estado = await cargar(p.archivo);
  assert.equal(estado.detenido, null);
  assert.equal(estado.proveedores_dia, '2026-10-14');
});
test('proveedores: sin el interruptor en config no se leen ni se mandan, y los lotes no llevan la llave', async t => {
  const p = await preparar(t, { ...inicial(), fase: 'incremental' });
  const leidos = conProveedores(p, [proveedor(1)]);
  p.fuente.ventas = async cursor => cursor === '0' ? { filas: [v], clientes: [c], detalles: [d] } : vacia();
  await ejecutar(p.archivo, { articulos: false }, { ...p.deps, proveedoresAhora: true });
  assert.equal(leidos.length, 0);
  assert.ok(p.lotes.length > 0);
  assert.ok(p.lotes.every(l => !Object.hasOwn(l, 'proveedores')), 'un servidor viejo rechazaria la llave');
  assert.equal(p.mensajes.includes('PROVEEDORES_NO_DISPONIBLES'), false);
});
test('proveedores: --proveedores-ahora vuelve a mandar la lista aunque hoy ya se haya mandado (tras restaurar un respaldo)', async t => {
  const p = await preparar(t, { ...inicial(), fase: 'incremental' });
  p.deps.reloj = () => Date.parse('2026-10-15T18:00:00Z');
  conProveedores(p, [proveedor(1)]);
  await ejecutar(p.archivo, { proveedores: true }, { ...p.deps, proveedoresAhora: true });
  assert.deepEqual(p.lotes.map(l => l.proveedores?.length), [1]);
  p.lotes.length = 0;
  await ejecutar(p.archivo, { proveedores: true }, p.deps);
  assert.equal(p.lotes.length, 0, 'sin la bandera no se repite el mismo dia');
  await ejecutar(p.archivo, { proveedores: true }, { ...p.deps, proveedoresAhora: true });
  assert.deepEqual(p.lotes.map(l => l.proveedores?.length), [1], 'con la bandera a mano si se repite');
});
