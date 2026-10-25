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

// Existencias: la fuente falsa lee de un arreglo que la prueba puede cambiar entre corridas.
function conExistencias(p, filas) {
  p.fuente.existenciasDisponibles = true;
  const leidos = [];
  p.fuente.existencias = async (cursor, limite) => {
    leidos.push(cursor);
    return filas.filter(x => BigInt(x.art_id) > BigInt(cursor)).slice(0, Math.min(limite, 500));
  };
  return leidos;
}
const existencia = (n, valor = '3.0000') => ({ art_id: String(n), existencia: valor });
const DE_DIA = () => Date.parse('2026-10-15T18:00:00Z');
const mandadas = p => p.lotes.filter(l => l.existencias).map(l => l.existencias);
test('existencias: la primera corrida de dia manda todas las vigentes y el mapa queda igual a lo leido', async t => {
  const p = await preparar(t, { ...inicial(), fase: 'incremental' });
  p.deps.reloj = DE_DIA;
  conExistencias(p, [existencia(1), existencia(2, '-1.0000'), existencia(3, '0')]);
  await ejecutar(p.archivo, { existencias: true }, p.deps);
  assert.deepEqual(mandadas(p), [[{ art_id: '1', existencia: '3.0000' }, { art_id: '2', existencia: '-1.0000' },
    { art_id: '3', existencia: '0.0000' }]]);
  assert.ok(p.lotes.filter(l => l.existencias).every(l => l.mode === 'incremental' && !l.clientes.length && !l.ventas.length));
  const estado = await cargar(p.archivo);
  assert.deepEqual(estado.existencias, { 1: '3.0000', 2: '-1.0000', 3: '0.0000' });
  assert.equal(estado.pendiente, null);
});
test('existencias: sin cambios no manda nada; un cambio y un no vigente mandan exactamente esos dos', async t => {
  const p = await preparar(t, { ...inicial(), fase: 'incremental' });
  p.deps.reloj = DE_DIA;
  const filas = [existencia(1), existencia(2), existencia(3)];
  conExistencias(p, filas);
  await ejecutar(p.archivo, { existencias: true }, p.deps);
  p.lotes.length = 0;
  await ejecutar(p.archivo, { existencias: true }, p.deps);
  assert.equal(p.lotes.length, 0, 'sin cambios no gasta envio');
  filas[0] = existencia(1, '5.0000');
  filas.splice(1, 1);
  await ejecutar(p.archivo, { existencias: true }, p.deps);
  assert.deepEqual(mandadas(p), [[{ art_id: '1', existencia: '5.0000' }, { art_id: '2', existencia: null }]]);
  assert.deepEqual((await cargar(p.archivo)).existencias, { 1: '5.0000', 3: '3.0000' });
});
test('existencias: si el envio falla el mapa no cambia y la siguiente corrida reenvia lo mismo', async t => {
  const p = await preparar(t, { ...inicial(), fase: 'incremental', existencias_dia: '2026-10-15',
    existencias: { 1: '3.0000', 2: '3.0000' } });
  p.deps.reloj = DE_DIA;
  const filas = [existencia(1, '4.0000'), existencia(2)];
  conExistencias(p, filas);
  const fetch = p.deps.fetch;
  p.deps.fetch = async (...args) => JSON.parse(args[1].body).existencias ? { status: 503, json: async () => ({}) } : fetch(...args);
  await ejecutar(p.archivo, { existencias: true }, { ...p.deps, intentos: 1 });
  const atorado = await cargar(p.archivo);
  assert.deepEqual(atorado.existencias, { 1: '3.0000', 2: '3.0000' });
  assert.deepEqual(JSON.parse(atorado.pendiente.bytes).existencias, [{ art_id: '1', existencia: '4.0000' }]);
  p.deps.fetch = fetch;
  await ejecutar(p.archivo, { existencias: true }, p.deps);
  assert.deepEqual(mandadas(p), [[{ art_id: '1', existencia: '4.0000' }]], 'el mismo lote, una sola vez');
  const estado = await cargar(p.archivo);
  assert.deepEqual(estado.existencias, { 1: '4.0000', 2: '3.0000' });
  assert.equal(estado.pendiente, null);
});
test('existencias: de noche una vez al dia, o a mano con existenciasAhora, manda todas aunque no cambiaran', async t => {
  const p = await preparar(t, { ...inicial(), fase: 'incremental', existencias: { 1: '3.0000', 2: '3.0000', 9: '1.0000' } });
  conExistencias(p, [existencia(1), existencia(2)]);
  await ejecutar(p.archivo, { existencias: true }, p.deps);
  assert.deepEqual(mandadas(p), [[existencia(1), existencia(2), { art_id: '9', existencia: null }]]);
  let estado = await cargar(p.archivo);
  assert.equal(estado.existencias_dia, '2026-10-14');
  assert.deepEqual(estado.existencias, { 1: '3.0000', 2: '3.0000' });
  p.lotes.length = 0;
  await ejecutar(p.archivo, { existencias: true }, p.deps);
  assert.equal(p.lotes.length, 0, 'la misma noche no se repite');
  p.deps.reloj = DE_DIA;
  await ejecutar(p.archivo, { existencias: true }, p.deps);
  assert.equal(p.lotes.length, 0, 'de dia solo cambios');
  await ejecutar(p.archivo, { existencias: true }, { ...p.deps, articulosAhora: true, proveedoresAhora: true });
  assert.equal(p.lotes.length, 0, 'las banderas de otras listas no prenden la vuelta completa');
  await ejecutar(p.archivo, { existencias: true }, { ...p.deps, existenciasAhora: true });
  assert.deepEqual(mandadas(p), [[existencia(1), existencia(2)]]);
  estado = await cargar(p.archivo);
  assert.equal(estado.existencias_dia, '2026-10-15');
});
test('existencias: interruptor apagado no las lee y los lotes no llevan la llave; ventas igual', async t => {
  for (const config of [{}, { existencias: false }, { existencias: 'true' }, { existencias: 1 }]) {
    const p = await preparar(t, { ...inicial(), fase: 'incremental' });
    const leidos = conExistencias(p, [existencia(1)]);
    p.fuente.ventas = async cursor => cursor === '0' ? { filas: [v], clientes: [c], detalles: [d] } : vacia();
    await ejecutar(p.archivo, config, { ...p.deps, existenciasAhora: true });
    assert.equal(leidos.length, 0);
    assert.equal(p.lotes.filter(l => l.ventas.length).length, 1);
    assert.ok(p.lotes.every(l => !Object.hasOwn(l, 'existencias')), 'un servidor viejo rechazaria la llave');
    assert.equal(p.mensajes.includes('EXISTENCIAS_NO_DISPONIBLES'), false);
    assert.deepEqual((await cargar(p.archivo)).existencias, {});
  }
});
test('existencias: sin columnas avisa, no las lee y las ventas se siguen mandando', async t => {
  const p = await preparar(t, { ...inicial(), fase: 'incremental' });
  p.fuente.existenciasDisponibles = false;
  p.fuente.existencias = async () => assert.fail('No debe consultar');
  p.fuente.ventas = async cursor => cursor === '0' ? { filas: [v], clientes: [c], detalles: [d] } : vacia();
  await ejecutar(p.archivo, { existencias: true }, p.deps);
  assert.ok(p.mensajes.includes('EXISTENCIAS_NO_DISPONIBLES'));
  assert.equal(p.lotes.filter(l => l.ventas.length).length, 1);
  assert.equal((await cargar(p.archivo)).existencias_dia, null);
});
test('existencias: 1,200 vigentes van en 3 lotes y cada lote confirmado actualiza el mapa con sus filas', async t => {
  const p = await preparar(t, { ...inicial(), fase: 'incremental' });
  conExistencias(p, Array.from({ length: 1200 }, (_, i) => existencia(i + 1)));
  const fetch = p.deps.fetch, mapaAlEnviar = [];
  p.deps.fetch = async (...args) => {
    if (JSON.parse(args[1].body).existencias) mapaAlEnviar.push(Object.keys((await cargar(p.archivo)).existencias).length);
    return fetch(...args);
  };
  await ejecutar(p.archivo, { existencias: true }, p.deps);
  assert.deepEqual(mandadas(p).map(l => l.length), [500, 500, 200]);
  assert.deepEqual(mandadas(p).flat().map(x => x.art_id), Array.from({ length: 1200 }, (_, i) => String(i + 1)));
  assert.deepEqual(mapaAlEnviar, [0, 500, 1000]);
  const estado = await cargar(p.archivo);
  assert.equal(Object.keys(estado.existencias).length, 1200);
  assert.equal(estado.existencias_dia, '2026-10-14');
});
test('existencias: una rara se omite con su id, no se manda ni se borra, y lo demas sigue', async t => {
  const p = await preparar(t, { ...inicial(), fase: 'incremental', existencias: { 2: '1.0000' } });
  p.deps.reloj = DE_DIA;
  conExistencias(p, [existencia(1), existencia(2, '1.12345'), existencia(3, 4)]);
  await ejecutar(p.archivo, { existencias: true }, p.deps);
  assert.ok(p.mensajes.includes('EXISTENCIA_OMITIDA'));
  assert.deepEqual(mandadas(p), [[existencia(1)]]);
  assert.deepEqual((await cargar(p.archivo)).existencias, { 1: '3.0000', 2: '1.0000' }, 'la rara conserva lo ultimo confirmado');
});
test('existencias: van despues de articulos y proveedores, y no antes de terminar la carga historica', async t => {
  const p = await preparar(t, { ...inicial(), fase: 'incremental' });
  conArticulos(p, [articulo(1)]);
  conProveedores(p, [proveedor(4)]);
  conExistencias(p, [existencia(1)]);
  await ejecutar(p.archivo, { articulos: true, proveedores: true, existencias: true }, p.deps);
  assert.deepEqual(p.lotes.map(l => l.articulos ? 'articulos' : l.proveedores ? 'proveedores' : l.existencias ? 'existencias' : 'otro'),
    ['articulos', 'proveedores', 'existencias']);
  const q = await preparar(t);
  const leidos = conExistencias(q, [existencia(1)]);
  await ejecutar(q.archivo, { existencias: true }, { ...q.deps, existenciasAhora: true });
  assert.equal(leidos.length, 0);
});
// Un lote de solo existencias atorado por 5xx o red no frena las ventas: se descarta y la corrida sigue.
function pendienteDe(contenido) {
  const lote = { ...sobre('1', 'incremental', new Date('2026-10-15T18:00:00Z')), ...contenido };
  return { bytes: JSON.stringify(lote), cambios: { enviadas: {}, existencias: { 1: '9.0000' } } };
}
test('existencias: pendiente de solo existencias con 503 persistente se descarta y las ventas nuevas se mandan', async t => {
  const p = await preparar(t, { ...inicial(), fase: 'incremental', existencias: { 1: '3.0000' },
    pendiente: pendienteDe({ existencias: [{ art_id: '1', existencia: '9.0000' }] }) });
  p.deps.reloj = DE_DIA;
  p.fuente.ventas = async cursor => cursor === '0' ? { filas: [v], clientes: [c], detalles: [d] } : vacia();
  const fetch = p.deps.fetch;
  p.deps.fetch = async (...args) => JSON.parse(args[1].body).existencias ? { status: 503, json: async () => ({}) } : fetch(...args);
  await ejecutar(p.archivo, {}, p.deps);
  assert.ok(p.mensajes.includes('EXISTENCIAS_DESCARTADAS'));
  const conVentas = p.lotes.filter(l => l.ventas.length);
  assert.equal(conVentas.length, 1, 'las ventas salen en la misma corrida');
  assert.equal(conVentas[0].sequence, '1', 'el servidor no lo acepto: se reutiliza el numero');
  const estado = await cargar(p.archivo);
  assert.deepEqual(estado.existencias, { 1: '?' }, 'los cambios no se aplican y el articulo que traia valor queda marcado para reenviarse');
  assert.equal(estado.pendiente, null);
  assert.equal(estado.ven_id, '9');
  assert.equal(estado.siguiente_secuencia, '2');
  assert.equal(estado.detenido, null);
});
test('existencias: pendiente que trae otra coleccion ademas de existencias no se descarta con 503', async t => {
  for (const otra of [{ ventas: [{ ven_id: '5', estado: 'excluida' }] }, { clientes: [{ cli_id: '42', nombre: 'José' }] },
    { articulos: [{ art_id: '1' }] }, { proveedores: [{ prv_id: '4' }] }]) {
    const pendiente = pendienteDe({ existencias: [{ art_id: '1', existencia: '9.0000' }], ...otra });
    const p = await preparar(t, { ...inicial(), fase: 'incremental', existencias: { 1: '3.0000' }, pendiente });
    p.deps.reloj = DE_DIA;
    p.fuente.ventas = async () => assert.fail('No debe leer ventas con un lote atorado');
    p.deps.fetch = async () => ({ status: 503, json: async () => ({}) });
    await ejecutar(p.archivo, {}, p.deps);
    assert.ok(!p.mensajes.includes('EXISTENCIAS_DESCARTADAS'));
    const estado = await cargar(p.archivo);
    assert.deepEqual(estado.pendiente, pendiente);
    assert.deepEqual(estado.existencias, { 1: '3.0000' });
  }
});
test('existencias: si el servidor si acepto el lote descartado, el 409 del siguiente lote se resuelve renumerando', async t => {
  const p = await preparar(t, { ...inicial(), fase: 'incremental', existencias: { 1: '3.0000' },
    pendiente: pendienteDe({ existencias: [{ art_id: '1', existencia: '9.0000' }] }) });
  p.deps.reloj = DE_DIA;
  p.fuente.ventas = async cursor => cursor === '0' ? { filas: [v], clientes: [c], detalles: [d] } : vacia();
  let servidor = 1n;
  const aceptados = [];
  p.deps.fetch = async (_, { body }) => {
    const lote = JSON.parse(body);
    if (lote.existencias) {
      // Lo acepta, pero la respuesta se pierde en el camino.
      if (BigInt(lote.sequence) === servidor) servidor++;
      throw new Error('socket hang up');
    }
    if (BigInt(lote.sequence) !== servidor) {
      return { status: 409, json: async () => ({ codigo: 'SECUENCIA_INCORRECTA', siguiente_secuencia: String(servidor) }) };
    }
    aceptados.push(lote);
    servidor++;
    return { status: 200, json: async () => ({ next_sequence: String(servidor) }) };
  };
  await ejecutar(p.archivo, {}, p.deps);
  assert.ok(p.mensajes.includes('EXISTENCIAS_DESCARTADAS'));
  assert.equal(aceptados.length, 1);
  assert.equal(aceptados[0].sequence, '2');
  assert.equal(aceptados[0].ventas.length, 1);
  const estado = await cargar(p.archivo);
  assert.equal(estado.siguiente_secuencia, '3');
  assert.equal(estado.detenido, null);
  assert.equal(estado.pendiente, null);
  assert.deepEqual(estado.existencias, { 1: '?' });
});
// Al descartar, los articulos que el lote traia con valor se olvidan del mapa: si el servidor si lo habia aceptado y
// SICAR regresa al valor viejo, la siguiente corrida lo vuelve a mandar. Las bajas (null) se quedan para recalcularse.
test('existencias: lote descartado que el servidor si acepto; SICAR regresa al valor viejo y se reenvia', async t => {
  const p = await preparar(t, { ...inicial(), fase: 'incremental', existencias_dia: '2026-10-15', existencias: { 1: '3.0000', 2: '3.0000' },
    pendiente: pendienteDe({ existencias: [{ art_id: '1', existencia: '9.0000' }] }) });
  p.deps.reloj = DE_DIA;
  // Mientras tanto, en SICAR el articulo 1 regreso a 3.
  conExistencias(p, [existencia(1, '3.0000'), existencia(2)]);
  let servidor = 1n;
  const servidorVe = {};
  p.deps.fetch = async (_, { body }) => {
    const lote = JSON.parse(body);
    if (BigInt(lote.sequence) !== servidor) {
      return { status: 409, json: async () => ({ codigo: 'SECUENCIA_INCORRECTA', siguiente_secuencia: String(servidor) }) };
    }
    for (const e of lote.existencias || []) servidorVe[e.art_id] = e.existencia;
    servidor++;
    // El servidor acepta el 9, pero la respuesta se pierde en el camino.
    if (lote.existencias?.[0]?.existencia === '9.0000') throw new Error('socket hang up');
    return { status: 200, json: async () => ({ next_sequence: String(servidor) }) };
  };
  await ejecutar(p.archivo, { existencias: true }, p.deps);
  assert.ok(p.mensajes.includes('EXISTENCIAS_DESCARTADAS'));
  assert.equal(servidorVe[1], '3.0000', 'el valor viejo se vuelve a mandar');
  const estado = await cargar(p.archivo);
  assert.deepEqual(estado.existencias, { 1: '3.0000', 2: '3.0000' });
  assert.equal(estado.pendiente, null);
  assert.equal(estado.detenido, null);
});
test('existencias: una baja descartada se vuelve a mandar como null', async t => {
  const pendiente = pendienteDe({ existencias: [{ art_id: '1', existencia: '9.0000' }, { art_id: '7', existencia: null }] });
  const p = await preparar(t, { ...inicial(), fase: 'incremental', existencias_dia: '2026-10-15',
    existencias: { 1: '3.0000', 7: '2.0000' }, pendiente });
  p.deps.reloj = DE_DIA;
  conExistencias(p, [existencia(1, '9.0000')]);
  const fetch = p.deps.fetch;
  let caido = true;
  p.deps.fetch = async (...args) => caido ? { status: 503, json: async () => ({}) } : fetch(...args);
  await ejecutar(p.archivo, {}, { ...p.deps, intentos: 1 });
  assert.ok(p.mensajes.includes('EXISTENCIAS_DESCARTADAS'));
  assert.deepEqual((await cargar(p.archivo)).existencias, { 1: '?', 7: '2.0000' }, 'la baja se queda para recalcularse');
  caido = false;
  await ejecutar(p.archivo, { existencias: true }, p.deps);
  assert.deepEqual(mandadas(p), [[{ art_id: '1', existencia: '9.0000' }, { art_id: '7', existencia: null }]]);
  assert.deepEqual((await cargar(p.archivo)).existencias, { 1: '9.0000' });
});
// El articulo descartado queda marcado con '?', que nunca coincide con un valor real: si sigue vigente se reenvia su valor
// y si dejo de ser vigente se manda su baja.
async function descartarYCorrer(t, vigentes) {
  const pendiente = pendienteDe({ existencias: [{ art_id: '1', existencia: '9.0000' }] });
  const p = await preparar(t, { ...inicial(), fase: 'incremental', existencias_dia: '2026-10-15', existencias: { 1: '3.0000' }, pendiente });
  p.deps.reloj = DE_DIA;
  conExistencias(p, vigentes);
  const fetch = p.deps.fetch;
  let caido = true;
  p.deps.fetch = async (...args) => caido ? { status: 503, json: async () => ({}) } : fetch(...args);
  await ejecutar(p.archivo, {}, { ...p.deps, intentos: 1 });
  assert.ok(p.mensajes.includes('EXISTENCIAS_DESCARTADAS'));
  assert.deepEqual((await cargar(p.archivo)).existencias, { 1: '?' });
  caido = false;
  await ejecutar(p.archivo, { existencias: true }, p.deps);
  return p;
}
test('existencias: descartado y el articulo deja de ser vigente: se manda su baja', async t => {
  const p = await descartarYCorrer(t, []);
  assert.deepEqual(mandadas(p), [[{ art_id: '1', existencia: null }]]);
  assert.deepEqual((await cargar(p.archivo)).existencias, {});
});
test('existencias: descartado y el articulo sigue con el mismo valor: se reenvia', async t => {
  const p = await descartarYCorrer(t, [existencia(1, '9.0000')]);
  assert.deepEqual(mandadas(p), [[{ art_id: '1', existencia: '9.0000' }]]);
  assert.deepEqual((await cargar(p.archivo)).existencias, { 1: '9.0000' });
});
// Tiendas que apagan la PC de noche: de día también toca la vuelta completa si la última fue antes de ayer.
test('existencias: de dia con la ultima vuelta completa de anteayer manda todas y marca hoy', async t => {
  for (const dia of ['2026-10-13', null]) {
    const p = await preparar(t, { ...inicial(), fase: 'incremental', existencias_dia: dia,
      existencias: { 1: '3.0000', 2: '3.0000', 9: '1.0000' } });
    p.deps.reloj = DE_DIA;
    conExistencias(p, [existencia(1), existencia(2)]);
    await ejecutar(p.archivo, { existencias: true }, p.deps);
    assert.deepEqual(mandadas(p), [[existencia(1), existencia(2), { art_id: '9', existencia: null }]]);
    const estado = await cargar(p.archivo);
    assert.equal(estado.existencias_dia, '2026-10-15');
    assert.deepEqual(estado.existencias, { 1: '3.0000', 2: '3.0000' });
  }
});
test('existencias: de dia con la ultima vuelta completa de ayer manda solo cambios', async t => {
  const p = await preparar(t, { ...inicial(), fase: 'incremental', existencias_dia: '2026-10-14',
    existencias: { 1: '3.0000', 2: '3.0000' } });
  p.deps.reloj = DE_DIA;
  conExistencias(p, [existencia(1, '4.0000'), existencia(2)]);
  await ejecutar(p.archivo, { existencias: true }, p.deps);
  assert.deepEqual(mandadas(p), [[existencia(1, '4.0000')]]);
  assert.equal((await cargar(p.archivo)).existencias_dia, '2026-10-14');
});

// Cortes de caja: la fuente falsa lee de arreglos que la prueba puede cambiar entre corridas.
function conCortes(p, datos) {
  p.fuente.cortesDisponibles = true;
  const leidos = [];
  p.fuente.cortes = async (cursor, limite) => {
    leidos.push(cursor);
    const cortes = datos.cortes.filter(x => BigInt(x.cor_id) > BigInt(cursor)).slice(0, Math.min(limite, 100));
    const ids = new Set(cortes.map(x => x.cor_id));
    // Sin lista de resumenes, cada corte tiene el suyo (el caso normal).
    const resumenes = datos.resumenes || datos.cortes.map(x => ({ cor_id: x.cor_id, rcc_id: x.cor_id }));
    return { cortes, pagos: (datos.pagos || []).filter(x => ids.has(x.cor_id)), cajeros: datos.cajeros.filter(x => ids.has(x.id)),
      resumenes: resumenes.filter(x => ids.has(x.cor_id)), ventas: (datos.ventas || []).filter(x => ids.has(x.cor_id)) };
  };
  return leidos;
}
const corteDe = (n, fecha = '2026-10-14 09:00:00') => ({ cor_id: String(n), fecha, contado: '10.00', calculado: '10.00',
  diferencia: '0.00', retiro: '10.00', caj_id: '1' });
const cerroDe = (n, usu_id = '7') => ({ id: String(n), usu_id });
const cortesMandados = p => p.lotes.filter(l => l.cortes).map(l => l.cortes);
test('cortes: van en lotes de hasta 100 y el cursor avanza solo con cada lote confirmado', async t => {
  const p = await preparar(t, { ...inicial(), fase: 'incremental' });
  p.deps.reloj = DE_DIA;
  const n = Array.from({ length: 250 }, (_, i) => i + 1);
  conCortes(p, { cortes: n.map(i => corteDe(i)), cajeros: n.map(i => cerroDe(i)),
    ventas: [{ cor_id: '1', ven_id: '5', total: '10.00', status: '1', usu_id: '52' }] });
  const fetch = p.deps.fetch, cursorAlEnviar = [];
  p.deps.fetch = async (...args) => {
    if (JSON.parse(args[1].body).cortes) cursorAlEnviar.push((await cargar(p.archivo)).cortes_cursor);
    return fetch(...args);
  };
  await ejecutar(p.archivo, { cortes: true }, p.deps);
  assert.deepEqual(cortesMandados(p).map(l => l.length), [100, 100, 50]);
  assert.deepEqual(cursorAlEnviar, ['0', '100', '200']);
  assert.ok(p.lotes.filter(l => l.cortes).every(l => l.mode === 'incremental' && !l.clientes.length && !l.ventas.length));
  assert.deepEqual(cortesMandados(p)[0][0], { cor_id: '1', caj_id: '1', fecha_local: '2026-10-14T09:00:00', usu_id: '7',
    contado: '10.00', calculado: '10.00', diferencia: '0.00', retiro: '10.00', pagos: [],
    cobros: [{ usu_id: '52', ventas: 1, total: '10.00', canceladas: 0, total_canceladas: '0.00' }] });
  const estado = await cargar(p.archivo);
  assert.equal(estado.cortes_cursor, '250');
  assert.equal(estado.pendiente, null);
  p.lotes.length = 0;
  await ejecutar(p.archivo, { cortes: true }, p.deps);
  assert.equal(p.lotes.length, 0, 'sin cortes nuevos no gasta envio');
});
test('cortes: uno sin cajero de hace 3 minutos espera; 15 minutos despues sale con usu_id null y queda en el registro', async t => {
  const p = await preparar(t, { ...inicial(), fase: 'incremental' });
  p.deps.reloj = DE_DIA; // 12:00:00 en la tienda
  const registro = [];
  p.deps.log = (evento, datos) => registro.push(require('./estado').registrar(x => x)(evento, datos));
  conCortes(p, { cortes: [corteDe(1), corteDe(2), corteDe(3, '2026-10-15 11:57:00'), corteDe(4, '2026-10-15 11:58:00')],
    cajeros: [cerroDe(1), cerroDe(2), cerroDe(4)] });
  await ejecutar(p.archivo, { cortes: true }, p.deps);
  assert.deepEqual(cortesMandados(p).map(l => l.map(x => x.cor_id)), [['1', '2']]);
  assert.equal((await cargar(p.archivo)).cortes_cursor, '2', 'queda en el anterior al que espera');
  assert.equal(registro.some(r => r.startsWith('CORTE_SIN_CAJERO')), false);
  p.lotes.length = 0;
  p.deps.reloj = () => DE_DIA() + 15 * 60000;
  await ejecutar(p.archivo, { cortes: true }, p.deps);
  assert.deepEqual(cortesMandados(p).map(l => l.map(x => [x.cor_id, x.usu_id])), [[['3', null], ['4', '7']]]);
  assert.ok(registro.includes('CORTE_SIN_CAJERO cor_id=3'));
  assert.equal((await cargar(p.archivo)).cortes_cursor, '4');
});
test('cortes: lote de solo cortes con 503 persistente se descarta, salen las ventas, el cursor no se mueve y se reenvian despues', async t => {
  const p = await preparar(t, { ...inicial(), fase: 'incremental' });
  p.deps.reloj = DE_DIA;
  conCortes(p, { cortes: [corteDe(1)], cajeros: [cerroDe(1)] });
  const fetch = p.deps.fetch;
  p.deps.fetch = async (...args) => JSON.parse(args[1].body).cortes ? { status: 503, json: async () => ({}) } : fetch(...args);
  await ejecutar(p.archivo, { cortes: true }, { ...p.deps, intentos: 1 });
  let estado = await cargar(p.archivo);
  assert.equal(estado.cortes_cursor, '0');
  assert.deepEqual(JSON.parse(estado.pendiente.bytes).cortes.map(x => x.cor_id), ['1']);
  p.fuente.ventas = async cursor => cursor === '0' ? { filas: [v], clientes: [c], detalles: [d] } : vacia();
  await ejecutar(p.archivo, { cortes: true }, { ...p.deps, intentos: 1 });
  assert.ok(p.mensajes.includes('CORTES_DESCARTADOS'));
  assert.ok(!p.mensajes.includes('EXISTENCIAS_DESCARTADAS'), 'no traia existencias');
  const conVentas = p.lotes.filter(l => l.ventas.length);
  assert.equal(conVentas.length, 1, 'las ventas salen en la misma corrida');
  estado = await cargar(p.archivo);
  assert.equal(estado.ven_id, '9');
  assert.equal(estado.cortes_cursor, '0', 'los cambios del lote descartado no se aplican');
  assert.deepEqual(estado.cortes_enviados, []);
  assert.deepEqual(JSON.parse(estado.pendiente.bytes).cortes.map(x => x.cor_id), ['1'], 'se volvio a leer y a intentar');
  assert.equal(estado.detenido, null);
  p.deps.fetch = fetch;
  p.lotes.length = 0;
  await ejecutar(p.archivo, { cortes: true }, p.deps);
  estado = await cargar(p.archivo);
  assert.deepEqual(cortesMandados(p).map(l => l.map(x => x.cor_id)), [['1']]);
  assert.equal(estado.cortes_cursor, '1');
  assert.deepEqual(estado.cortes_enviados, ['1']);
  assert.equal(estado.pendiente, null);
});
test('cortes: pendiente con cortes y existencias juntos tambien se descarta con 503 y avisa ambos', async t => {
  const pendiente = pendienteDe({ existencias: [{ art_id: '1', existencia: '9.0000' }], cortes: [{ cor_id: '1' }] });
  pendiente.cambios.cortes_cursor = '1';
  pendiente.cambios.cortes_enviados = ['1'];
  const p = await preparar(t, { ...inicial(), fase: 'incremental', existencias: { 1: '3.0000', 2: '3.0000' }, pendiente });
  p.deps.reloj = DE_DIA;
  p.fuente.ventas = async cursor => cursor === '0' ? { filas: [v], clientes: [c], detalles: [d] } : vacia();
  const fetch = p.deps.fetch;
  p.deps.fetch = async (...args) => JSON.parse(args[1].body).ventas.length ? fetch(...args) : { status: 503, json: async () => ({}) };
  await ejecutar(p.archivo, {}, p.deps);
  assert.ok(p.mensajes.includes('EXISTENCIAS_DESCARTADAS'));
  assert.ok(p.mensajes.includes('CORTES_DESCARTADOS'));
  assert.equal(p.lotes.filter(l => l.ventas.length).length, 1);
  const estado = await cargar(p.archivo);
  assert.equal(estado.pendiente, null);
  assert.equal(estado.cortes_cursor, '0');
  assert.deepEqual(estado.cortes_enviados, []);
  assert.deepEqual(estado.existencias, { 1: '?', 2: '3.0000' });
});
test('cortes: pendiente con cortes y ventas, clientes, articulos o proveedores no se descarta con 503', async t => {
  for (const otra of [{ ventas: [{ ven_id: '5', estado: 'excluida' }] }, { clientes: [{ cli_id: '42', nombre: 'José' }] },
    { articulos: [{ art_id: '1' }] }, { proveedores: [{ prv_id: '4' }] }]) {
    const pendiente = pendienteDe({ cortes: [{ cor_id: '1' }], ...otra });
    const p = await preparar(t, { ...inicial(), fase: 'incremental', pendiente });
    p.deps.reloj = DE_DIA;
    p.fuente.ventas = async () => assert.fail('No debe leer ventas con un lote atorado');
    p.deps.fetch = async () => ({ status: 503, json: async () => ({}) });
    await ejecutar(p.archivo, {}, p.deps);
    assert.ok(!p.mensajes.includes('CORTES_DESCARTADOS'));
    assert.deepEqual((await cargar(p.archivo)).pendiente, pendiente);
  }
});
test('cortes: interruptor apagado no los lee y los lotes no llevan la llave; ventas igual', async t => {
  for (const config of [{}, { cortes: false }, { cortes: 'true' }, { cortes: 1 }]) {
    const p = await preparar(t, { ...inicial(), fase: 'incremental' });
    const leidos = conCortes(p, { cortes: [corteDe(1)], cajeros: [cerroDe(1)] });
    p.fuente.ventas = async cursor => cursor === '0' ? { filas: [v], clientes: [c], detalles: [d] } : vacia();
    await ejecutar(p.archivo, config, p.deps);
    assert.equal(leidos.length, 0);
    assert.equal(p.lotes.filter(l => l.ventas.length).length, 1);
    assert.ok(p.lotes.every(l => !Object.hasOwn(l, 'cortes')), 'un servidor viejo rechazaria la llave');
    assert.equal(p.mensajes.includes('CORTES_NO_DISPONIBLES'), false);
    assert.equal((await cargar(p.archivo)).cortes_cursor, '0');
  }
});
test('cortes: sin columnas avisa, no los lee y las ventas se siguen mandando', async t => {
  const p = await preparar(t, { ...inicial(), fase: 'incremental' });
  p.fuente.cortesDisponibles = false;
  p.fuente.cortes = async () => assert.fail('No debe consultar');
  p.fuente.ventas = async cursor => cursor === '0' ? { filas: [v], clientes: [c], detalles: [d] } : vacia();
  await ejecutar(p.archivo, { cortes: true }, p.deps);
  assert.ok(p.mensajes.includes('CORTES_NO_DISPONIBLES'));
  assert.equal(p.lotes.filter(l => l.ventas.length).length, 1);
});
test('cortes: van despues de existencias, tambien con existencias apagadas o sin cambios, y no antes de la carga historica', async t => {
  const p = await preparar(t, { ...inicial(), fase: 'incremental' });
  conExistencias(p, [existencia(1)]);
  conCortes(p, { cortes: [corteDe(1)], cajeros: [cerroDe(1)] });
  await ejecutar(p.archivo, { existencias: true, cortes: true }, p.deps);
  assert.deepEqual(p.lotes.map(l => l.existencias ? 'existencias' : l.cortes ? 'cortes' : 'otro'), ['existencias', 'cortes']);
  for (const config of [{ cortes: true }, { existencias: true, cortes: true }]) {
    const q = await preparar(t, { ...inicial(), fase: 'incremental', existencias: { 1: '3.0000' }, existencias_dia: '2026-10-15' });
    q.deps.reloj = DE_DIA;
    conExistencias(q, [existencia(1)]);
    conCortes(q, { cortes: [corteDe(1)], cajeros: [cerroDe(1)] });
    await ejecutar(q.archivo, config, q.deps);
    assert.deepEqual(cortesMandados(q).map(l => l.length), [1]);
  }
  const h = await preparar(t);
  const leidos = conCortes(h, { cortes: [corteDe(1)], cajeros: [cerroDe(1)] });
  await ejecutar(h.archivo, { cortes: true }, h.deps);
  assert.equal(leidos.length, 0);
});
test('cortes: uno raro se omite con su cor_id, el cursor lo pasa y los demas se mandan', async t => {
  const p = await preparar(t, { ...inicial(), fase: 'incremental' });
  p.deps.reloj = DE_DIA;
  const registro = [];
  p.deps.log = (evento, datos) => registro.push(require('./estado').registrar(x => x)(evento, datos));
  conCortes(p, { cortes: [corteDe(1), { ...corteDe(2), contado: '1.001' }, corteDe(3)], cajeros: [cerroDe(1), cerroDe(2), cerroDe(3)] });
  await ejecutar(p.archivo, { cortes: true }, p.deps);
  assert.ok(registro.includes('CORTE_OMITIDO cor_id=2 codigo=PRECISION_NO_PACTADA'));
  assert.deepEqual(cortesMandados(p).map(l => l.map(x => x.cor_id)), [['1', '3']]);
  assert.equal((await cargar(p.archivo)).cortes_cursor, '3');
});
// Fix round 1: usu_id raro, fecha adelantada y cortes confirmados tarde (margen como MARGEN_VENTAS).
function registroDe(p) {
  const registro = [];
  p.deps.log = (evento, datos) => registro.push(require('./estado').registrar(x => x)(evento, datos));
  return registro;
}
test('cortes: quien cerro con usu_id raro se manda con null y CORTE_SIN_CAJERO; no se omite', async t => {
  const p = await preparar(t, { ...inicial(), fase: 'incremental' });
  p.deps.reloj = DE_DIA;
  const registro = registroDe(p);
  conCortes(p, { cortes: [corteDe(1), corteDe(2)], cajeros: [cerroDe(1, '0'), cerroDe(2)] });
  await ejecutar(p.archivo, { cortes: true }, p.deps);
  assert.deepEqual(cortesMandados(p).map(l => l.map(x => [x.cor_id, x.usu_id])), [[['1', null], ['2', '7']]]);
  assert.ok(registro.includes('CORTE_SIN_CAJERO cor_id=1'));
  assert.equal(registro.some(r => r.startsWith('CORTE_OMITIDO')), false);
});
test('cortes: uno sin cajero con fecha mas de 10 minutos adelantada no congela los siguientes', async t => {
  const p = await preparar(t, { ...inicial(), fase: 'incremental' });
  p.deps.reloj = DE_DIA; // 12:00:00 en la tienda
  const registro = registroDe(p);
  conCortes(p, { cortes: [corteDe(1, '2099-01-01 00:00:00'), corteDe(2, '2026-10-15 12:11:00'), corteDe(3)],
    cajeros: [cerroDe(2), cerroDe(3)] });
  await ejecutar(p.archivo, { cortes: true }, p.deps);
  assert.deepEqual(cortesMandados(p).map(l => l.map(x => [x.cor_id, x.usu_id])), [[['1', null], ['2', '7'], ['3', '7']]]);
  assert.ok(registro.includes('CORTE_FECHA_FUTURA cor_id=1'));
  assert.equal((await cargar(p.archivo)).cortes_cursor, '3');
  const q = await preparar(t, { ...inicial(), fase: 'incremental' });
  q.deps.reloj = DE_DIA;
  conCortes(q, { cortes: [corteDe(1, '2026-10-15 12:09:00'), corteDe(2)], cajeros: [cerroDe(2)] });
  await ejecutar(q.archivo, { cortes: true }, q.deps);
  assert.equal(q.lotes.length, 0, 'adelantado 9 minutos todavia se espera');
});
test('cortes: uno de numero menor que aparece despues de que el cursor lo paso se manda en la siguiente corrida, sin reenviar', async t => {
  const p = await preparar(t, { ...inicial(), fase: 'incremental' });
  p.deps.reloj = DE_DIA;
  const datos = { cortes: [corteDe(1), corteDe(2), corteDe(4)], cajeros: [cerroDe(1), cerroDe(2), cerroDe(3), cerroDe(4)] };
  conCortes(p, datos);
  await ejecutar(p.archivo, { cortes: true }, p.deps);
  let estado = await cargar(p.archivo);
  assert.equal(estado.cortes_cursor, '4');
  assert.deepEqual(estado.cortes_enviados, ['1', '2', '4']);
  datos.cortes.splice(2, 0, corteDe(3));
  p.lotes.length = 0;
  await ejecutar(p.archivo, { cortes: true }, p.deps);
  assert.deepEqual(cortesMandados(p).map(l => l.map(x => x.cor_id)), [['3']]);
  estado = await cargar(p.archivo);
  assert.equal(estado.cortes_cursor, '4');
  assert.deepEqual(estado.cortes_enviados, ['1', '2', '3', '4']);
  p.lotes.length = 0;
  await ejecutar(p.archivo, { cortes: true }, p.deps);
  assert.equal(p.lotes.length, 0, 'los confirmados no se reenvian');
});
test('cortes: el tardio solo queda como enviado cuando el servidor confirma', async t => {
  const p = await preparar(t, { ...inicial(), fase: 'incremental', cortes_cursor: '4', cortes_enviados: ['1', '2', '4'] });
  p.deps.reloj = DE_DIA;
  conCortes(p, { cortes: [corteDe(1), corteDe(2), corteDe(3), corteDe(4)], cajeros: [1, 2, 3, 4].map(n => cerroDe(n)) });
  const fetch = p.deps.fetch;
  p.deps.fetch = async () => ({ status: 503, json: async () => ({}) });
  await ejecutar(p.archivo, { cortes: true }, { ...p.deps, intentos: 1 });
  assert.deepEqual((await cargar(p.archivo)).cortes_enviados, ['1', '2', '4']);
  p.deps.fetch = fetch;
  await ejecutar(p.archivo, { cortes: true }, p.deps);
  assert.deepEqual((await cargar(p.archivo)).cortes_enviados, ['1', '2', '3', '4']);
});
test('cortes: uno omitido no se vuelve a leer como tardio ni a registrar', async t => {
  const p = await preparar(t, { ...inicial(), fase: 'incremental' });
  p.deps.reloj = DE_DIA;
  const registro = registroDe(p);
  conCortes(p, { cortes: [corteDe(1), { ...corteDe(2), contado: '1.001' }], cajeros: [cerroDe(1), cerroDe(2)] });
  await ejecutar(p.archivo, { cortes: true }, p.deps);
  assert.equal(registro.filter(r => r.startsWith('CORTE_OMITIDO')).length, 1);
  p.lotes.length = 0;
  await ejecutar(p.archivo, { cortes: true }, p.deps);
  assert.equal(registro.filter(r => r.startsWith('CORTE_OMITIDO')).length, 1);
  assert.equal(p.lotes.length, 0);
});
test('cortes: se recuerdan solo los 50 mas altos y la relectura empieza 50 abajo del cursor', async t => {
  const p = await preparar(t, { ...inicial(), fase: 'incremental' });
  p.deps.reloj = DE_DIA;
  const n = Array.from({ length: 120 }, (_, i) => i + 1);
  const leidos = conCortes(p, { cortes: n.map(i => corteDe(i)), cajeros: n.map(i => cerroDe(i)) });
  await ejecutar(p.archivo, { cortes: true }, p.deps);
  const estado = await cargar(p.archivo);
  assert.deepEqual(estado.cortes_enviados, n.slice(70).map(String));
  leidos.length = 0;
  await ejecutar(p.archivo, { cortes: true }, p.deps);
  assert.equal(leidos[0], '70');
});
// Item 6: SICAR escribe el renglón CorteCaja de historial y enseguida el resumen; un corte de segundos puede estar a medias.
test('cortes: ninguno de menos de 2 minutos se manda aunque ya tenga cajero y resumen; sale en la siguiente corrida', async t => {
  const p = await preparar(t, { ...inicial(), fase: 'incremental' });
  p.deps.reloj = DE_DIA; // 12:00:00 en la tienda
  conCortes(p, { cortes: [corteDe(1), corteDe(2, '2026-10-15 11:59:00'), corteDe(3)], cajeros: [1, 2, 3].map(n => cerroDe(n)) });
  await ejecutar(p.archivo, { cortes: true }, p.deps);
  assert.deepEqual(cortesMandados(p).map(l => l.map(x => x.cor_id)), [['1']]);
  assert.equal((await cargar(p.archivo)).cortes_cursor, '1');
  p.lotes.length = 0;
  p.deps.reloj = () => DE_DIA() + 5 * 60000;
  await ejecutar(p.archivo, { cortes: true }, p.deps);
  assert.deepEqual(cortesMandados(p).map(l => l.map(x => x.cor_id)), [['2', '3']]);
});
test('cortes: sin resumen y de menos de 10 minutos se espera; pasado eso sale con cobros vacios y CORTE_SIN_RESUMEN', async t => {
  const p = await preparar(t, { ...inicial(), fase: 'incremental' });
  p.deps.reloj = DE_DIA;
  const registro = registroDe(p);
  conCortes(p, { cortes: [corteDe(1), corteDe(2, '2026-10-15 11:55:00'), corteDe(3)], cajeros: [1, 2, 3].map(n => cerroDe(n)),
    resumenes: [{ cor_id: '1', rcc_id: '10' }, { cor_id: '3', rcc_id: '30' }],
    ventas: [{ cor_id: '1', ven_id: '5', total: '10.00', status: '1', usu_id: '52' }] });
  await ejecutar(p.archivo, { cortes: true }, p.deps);
  assert.deepEqual(cortesMandados(p).map(l => l.map(x => x.cor_id)), [['1']]);
  assert.equal(registro.some(r => r.startsWith('CORTE_SIN_RESUMEN')), false);
  p.lotes.length = 0;
  p.deps.reloj = () => DE_DIA() + 15 * 60000;
  await ejecutar(p.archivo, { cortes: true }, p.deps);
  const [lote] = cortesMandados(p);
  assert.deepEqual(lote.map(x => [x.cor_id, x.cobros]), [['2', []], ['3', []]]);
  assert.ok(registro.includes('CORTE_SIN_RESUMEN cor_id=2'));
  assert.equal(registro.includes('CORTE_SIN_RESUMEN cor_id=3'), false, 'con resumen y sin ventas no es falta de resumen');
});
test('cortes: fechado mas de 10 minutos en el futuro no se espera ni por la regla de 2 minutos ni por falta de resumen', async t => {
  const p = await preparar(t, { ...inicial(), fase: 'incremental' });
  p.deps.reloj = DE_DIA;
  const registro = registroDe(p);
  conCortes(p, { cortes: [corteDe(1, '2026-10-15 12:30:00'), corteDe(2)], cajeros: [cerroDe(1), cerroDe(2)],
    resumenes: [{ cor_id: '2', rcc_id: '20' }] });
  await ejecutar(p.archivo, { cortes: true }, p.deps);
  assert.deepEqual(cortesMandados(p).map(l => l.map(x => x.cor_id)), [['1', '2']]);
  assert.ok(registro.includes('CORTE_FECHA_FUTURA cor_id=1'));
  assert.ok(registro.includes('CORTE_SIN_RESUMEN cor_id=1'));
});

// Ventas de público en general como mostrador (Cinco Caminos P1).
const PUBLICO = { cli_id: '1', nombre: 'PÚBLICO EN GENERAL' };
const ventaDe = (n, publico, extra = {}) => ({ ven_id: String(n), cli_id: publico ? '1' : '42', fecha: '2025-02-01 10:00:00', status: 1,
  total: '10', ...extra });
const renglonDe = n => ({ ...d, ven_id: String(n), clave: 'CLV', descripcion: 'Cuerda' });
// Ventas de SICAR por rango (cursor, tope], como la consulta real; anota cada lectura.
function conVentas(p, filas) {
  const leidas = [];
  p.fuente.ventas = async (cursor, tope, limite) => {
    leidas.push([cursor, tope]);
    const elegidas = filas.filter(f => BigInt(f.ven_id) > BigInt(cursor) && BigInt(f.ven_id) <= BigInt(tope)).slice(0, limite);
    return { filas: elegidas, clientes: [c, PUBLICO], detalles: elegidas.map(f => renglonDe(f.ven_id)) };
  };
  p.fuente.porIds = async ids => {
    const elegidas = filas.filter(f => ids.includes(f.ven_id));
    return { filas: elegidas, clientes: [c, PUBLICO], detalles: elegidas.map(f => renglonDe(f.ven_id)) };
  };
  return leidas;
}
test('mostrador: con el interruptor apagado ningun lote trae mostrador y las ventas salen como hoy', async t => {
  for (const config of [{}, { mostrador: 'true' }, { mostrador: 1 }]) {
    const p = await preparar(t, { ...inicial(), fase: 'incremental', ven_id: '0' });
    p.fuente.tope = async () => '11';
    conVentas(p, [ventaDe(10, true), ventaDe(11, false)]);
    p.fuente.mostradorDesde = async () => assert.fail('Sin interruptor no hay carga desde 2025');
    await ejecutar(p.archivo, config, p.deps);
    assert.ok(p.lotes.length);
    assert.ok(p.lotes.every(l => !('mostrador' in l)));
    assert.deepEqual(p.lotes.flatMap(l => l.ventas.map(x => x.ven_id)), ['11']);
    assert.deepEqual((await cargar(p.archivo)).mostrador_enviadas, {});
  }
});
test('mostrador: prendido, una pagina mezclada manda ventas y mostrador en el mismo lote', async t => {
  const p = await preparar(t, { ...inicial(), fase: 'incremental', ven_id: '0', mostrador_terminado: true });
  p.fuente.tope = async () => '12';
  conVentas(p, [ventaDe(10, true), ventaDe(11, false), ventaDe(12, true, { status: -1 })]);
  await ejecutar(p.archivo, { mostrador: true }, p.deps);
  const lote = p.lotes[0];
  assert.deepEqual(lote.ventas.map(x => x.ven_id), ['11']);
  assert.deepEqual(lote.mostrador.map(m => [m.ven_id, m.estado]), [['10', 'vigente'], ['12', 'cancelada']]);
  assert.deepEqual(lote.clientes.map(x => x.cli_id), ['42'], 'el publico nunca va como cliente');
  assert.doesNotMatch(JSON.stringify(lote.mostrador), /cli_id|nombre|descripcion|clave|precio_/);
  assert.doesNotThrow(() => require('../backend/sicarIngesta').validarLoteSicar(lote), 'el servidor acepta el lote tal cual');
  const estado = await cargar(p.archivo);
  assert.deepEqual(estado.mostrador_enviadas, { 10: true, 12: true });
  assert.equal(estado.enviadas['10'], undefined, 'enviadas solo decide la tumba excluida de ventas');
  assert.equal(estado.ven_id, '12');
});
test('mostrador: venta de publico cancelada dentro de 48 h se manda cancelada', async t => {
  const p = await preparar(t, { ...inicial(), fase: 'incremental', ven_id: '20', mostrador_terminado: true,
    mostrador_enviadas: { 20: true }, ventana: { 20: '2026-10-14T10:00:00' } });
  p.fuente.tope = async () => '20';
  conVentas(p, [ventaDe(20, true, { status: -1, fecha: '2026-10-14 10:00:00' })]);
  await ejecutar(p.archivo, { mostrador: true }, p.deps);
  const mandadas = p.lotes.flatMap(l => l.mostrador || []);
  assert.ok(mandadas.length);
  assert.ok(mandadas.every(m => m.ven_id === '20' && m.estado === 'cancelada'));
});
test('mostrador: cancelada de publico sin renglones ya enviada (historial) sale como cancelacion corta', async t => {
  const p = await preparar(t, { ...inicial(), fase: 'incremental', ven_id: '9', his_id: '70', mostrador_terminado: true,
    mostrador_enviadas: { 9: true } });
  p.fuente.historial = async cursor => (cursor === '70' ? [{ his_id: '80', tabla: 'Venta', movimiento: 2, referencia: '9' }] : []);
  p.fuente.porIds = async () => ({ filas: [{ ...v, cli_id: '1' }], clientes: [PUBLICO], detalles: [] });
  await ejecutar(p.archivo, { mostrador: true, historial: { columna_referencia: 'ref' } }, p.deps);
  assert.deepEqual(p.lotes[0].mostrador, [{ ven_id: '9', estado: 'cancelada' }]);
  assert.deepEqual(p.lotes[0].ventas, []);
  assert.equal((await cargar(p.archivo)).his_id, '80');
});
test('mostrador: venta de cliente que pasa a publico va excluida y como mostrador en el mismo lote; la inversa va como venta', async t => {
  const p = await preparar(t, { ...inicial(), fase: 'incremental', ven_id: '31', mostrador_terminado: true,
    enviadas: { 30: true }, mostrador_enviadas: { 31: true },
    ventana: { 30: '2026-10-14T10:00:00', 31: '2026-10-14T11:00:00' } });
  p.fuente.tope = async () => '31';
  conVentas(p, [ventaDe(30, true, { fecha: '2026-10-14 10:00:00' }), ventaDe(31, false, { fecha: '2026-10-14 11:00:00' })]);
  await ejecutar(p.archivo, { mostrador: true }, p.deps);
  const lote = p.lotes.find(l => l.mostrador);
  assert.deepEqual(lote.ventas.map(x => [x.ven_id, x.estado, x.cli_id]), [['30', 'excluida', undefined], ['31', 'vigente', '42']]);
  assert.deepEqual(lote.mostrador.map(m => m.ven_id), ['30']);
  assert.doesNotThrow(() => require('../backend/sicarIngesta').validarLoteSicar(lote));
});
test('mostrador: un lote de existencias que trae mostrador nunca se descarta', async t => {
  const p = await preparar(t, { ...inicial(), fase: 'incremental', mostrador_terminado: true,
    pendiente: pendienteDe({ existencias: [{ art_id: '1', existencia: '9.0000' }],
      mostrador: [{ ven_id: '5', estado: 'cancelada' }] }) });
  p.deps.reloj = DE_DIA;
  p.deps.fetch = async () => ({ status: 503, json: async () => ({}) });
  await ejecutar(p.archivo, { mostrador: true }, p.deps);
  assert.equal(p.mensajes.includes('EXISTENCIAS_DESCARTADAS'), false);
  assert.ok((await cargar(p.archivo)).pendiente, 'se queda para reenviarse');
});
// Carga desde 2025: ventas 10..60 (las pares de publico) con el cursor de ventas en 300 (la relectura de 200 lee desde 100).
const historia = () => Array.from({ length: 51 }, (_, i) => ventaDe(10 + i, (10 + i) % 2 === 0));
async function prepararCarga(t, estado = {}) {
  const p = await preparar(t, { ...inicial(), fase: 'incremental', ven_id: '300', ...estado });
  p.fuente.tope = async () => '300';
  const leidas = conVentas(p, historia());
  const desdes = [];
  p.fuente.mostradorDesde = async fecha => { desdes.push(fecha); return '20'; };
  return { p, leidas, desdes };
}
test('mostrador: carga desde 2025 de noche, al final de todo, solo publico, y no vuelve a correr', async t => {
  const { p, leidas, desdes } = await prepararCarga(t);
  p.fuente.tamano = 10;
  conCortes(p, { cortes: [corteDe(1)], cajeros: [cerroDe(1)] });
  await ejecutar(p.archivo, { mostrador: true, cortes: true }, p.deps);
  assert.deepEqual(desdes, ['2025-01-01 00:00:00']);
  const orden = p.lotes.map(l => (l.cortes ? 'cortes' : l.mostrador ? 'mostrador' : 'otro'));
  assert.equal(orden.indexOf('cortes'), 0, 'la carga va despues de los cortes');
  assert.ok(orden.slice(1).every(x => x === 'mostrador'));
  const mandadas = p.lotes.flatMap(l => l.mostrador || []).map(m => Number(m.ven_id));
  assert.deepEqual(mandadas, Array.from({ length: 21 }, (_, i) => 20 + 2 * i), 'desde la primera de 2025 (20), solo las de publico');
  assert.ok(p.lotes.every(l => !l.ventas.length && !l.clientes.length), 'las de cliente no se reenvian');
  const cargas = leidas.filter(([cursor, tope]) => tope === '300' && cursor !== '100');
  assert.equal(cargas[0][0], '19', 'empieza en desde - 1');
  const estado = await cargar(p.archivo);
  assert.equal(estado.mostrador_desde_ven_id, '20');
  assert.equal(estado.mostrador_terminado, true);
  assert.equal(estado.mostrador_cursor, '60');
  assert.equal(Object.keys(estado.mostrador_enviadas).length, 21);
  assert.deepEqual(estado.ventana, {}, 'la carga no llena la relectura de 48 h');
  p.lotes.length = 0;
  leidas.length = 0;
  await ejecutar(p.archivo, { mostrador: true }, p.deps);
  assert.equal(p.lotes.length, 0);
  assert.deepEqual(leidas.filter(([cursor]) => cursor === '19' || cursor === '60'), [], 'terminada no se vuelve a leer');
});
test('mostrador: carga de dia solo con mostradorAhora; retoma de max(cursor, desde - 1)', async t => {
  const { p, desdes } = await prepararCarga(t, { mostrador_cursor: '40', mostrador_desde_ven_id: '20' });
  p.deps.reloj = DE_DIA;
  await ejecutar(p.archivo, { mostrador: true }, p.deps);
  assert.equal(p.lotes.length, 0);
  assert.deepEqual(desdes, []);
  await ejecutar(p.archivo, { mostrador: true }, { ...p.deps, mostradorAhora: true });
  assert.deepEqual(desdes, [], 'el desde ya guardado no se vuelve a consultar');
  assert.deepEqual(p.lotes.flatMap(l => l.mostrador).map(m => m.ven_id), ['42', '44', '46', '48', '50', '52', '54', '56', '58', '60']);
});
test('mostrador: venta de 2025 que ya se habia mandado con cliente y hoy es publico sale excluida junto con su mostrador', async t => {
  const { p } = await prepararCarga(t, { mostrador_cursor: '55', mostrador_desde_ven_id: '20', enviadas: { 56: true } });
  await ejecutar(p.archivo, { mostrador: true }, p.deps);
  assert.deepEqual(p.lotes[0].ventas, [{ ven_id: '56', estado: 'excluida' }]);
  assert.deepEqual(p.lotes[0].mostrador.map(m => m.ven_id), ['56', '58', '60']);
});
test('mostrador: un fallo de envio no mueve el cursor de la carga', async t => {
  const { p } = await prepararCarga(t, { mostrador_desde_ven_id: '20' });
  p.deps.fetch = async () => ({ status: 503, json: async () => ({}) });
  await ejecutar(p.archivo, { mostrador: true }, p.deps);
  const estado = await cargar(p.archivo);
  assert.equal(estado.mostrador_cursor, '0');
  assert.equal(estado.mostrador_terminado, false);
  assert.deepEqual(estado.mostrador_enviadas, {});
});
test('mostrador: la carga avanza a lo mas 10 paginas por corrida para no alentar las ventas', async t => {
  const { p, leidas } = await prepararCarga(t, { mostrador_desde_ven_id: '1' });
  p.fuente.tamano = 2;
  await ejecutar(p.archivo, { mostrador: true }, p.deps);
  assert.equal(leidas.filter(([cursor, tope]) => tope === '300' && cursor !== '100').length, 10, 'sin contar la relectura de 200');
  const estado = await cargar(p.archivo);
  assert.equal(estado.mostrador_cursor, '29');
  assert.equal(estado.mostrador_terminado, false);
});
test('mostrador: sin ventas desde 2025 la carga termina sin mandar nada', async t => {
  const { p } = await prepararCarga(t);
  p.fuente.mostradorDesde = async () => null;
  await ejecutar(p.archivo, { mostrador: true }, p.deps);
  assert.equal(p.lotes.length, 0);
  assert.equal((await cargar(p.archivo)).mostrador_terminado, true);
});
