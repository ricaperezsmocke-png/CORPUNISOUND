/**
 * Conformidad del contrato SICAR v1 de punta a punta: lo que manda el agente de la tienda,
 * lo que responde el servidor y lo que termina viendo el CRM. Los envíos son los ejemplos
 * de docs/sicar-contrato-v1.md; si uno cambia, el otro también.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'sicar-contrato-prueba';
process.env.NODE_ENV = 'test';
process.env.SENTRY_ENABLED = 'false';
const app = require('./server');
const { obtenerConexionSqlite } = require('./persistencia');
const { firmarToken } = require('./auth');
const { crearRepositorioSicar } = require('./sicarRepositorio');
const { crearLlaveSicar } = require('./sicarIngesta');
const sqlite = obtenerConexionSqlite();
const repo = crearRepositorioSicar(sqlite);
let servidor, base, llave, admin;

const SOBRE = { schema_version: 1, mapping_version: 'ocosingo-f0-v1', captured_at: '2026-10-14T03:00:00Z',
  mode: 'incremental', window: { from: '2026-10-12T00:00:00-06:00', to: '2026-10-14T00:00:00-06:00' } };
const linea = (art_id, descripcion, importe) => ({ art_id, clave: null, descripcion, cantidad: '1.0000',
  precio_con: `${importe}00`, precio_sin: '0.0000', importe_con: importe, descuento_total: '0.00' });
const venta = (ven_id, cli_id, total, detalle, estado = 'vigente') => ({ ven_id, cli_id, fecha_local: '2026-10-13T11:30:00',
  timezone: 'America/Mexico_City', estado, moneda: 'MXN', total, detalle });
const lote = (batch_id, sequence, clientes, ventas) => JSON.stringify({ ...SOBRE, batch_id, sequence, clientes, ventas });

// Lote 1: José con una compra de dos artículos; el público en general (cli_id 1) también llega y nunca debe verse.
const LOTE_1 = lote('6f1c2a90-0000-4000-8000-000000000001', '1',
  [{ cli_id: '4501', nombre: 'José Peña', telefono: '919 111 2233' }, { cli_id: '1', nombre: 'PUBLICO EN GENERAL' },
    { cli_id: '4502', nombre: 'Lucía Gómez', celular: '9192223344' }],
  [venta('88001', '4501', '1500.00', [linea('10', 'Guitarra clásica', '1350.00'), linea('11', 'Funda', '150.00')]),
    venta('88002', '1', '50.00', [linea('12', 'Cuerdas', '50.00')])]);

before(async () => {
  app.DB.admin.roles.push({ id: 961, nombre: 'Contrato', permisos: ['ver_clientes_sicar', 'ver_todas_las_sucursales'], modulos: ['crm'] });
  app.DB.admin.usuarios.push({ id: 961, nombre: 'Contrato', usuario: 'contrato961', rol_id: 961, sucursal_id: 1, activo: true });
  admin = firmarToken({ id: 961, rol_id: 961, sucursal_id: 1 });
  app.DB.crm.clientes = [];
  llave = crearLlaveSicar(repo, 1, 961).llave;
  await new Promise(resolve => { servidor = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(async () => {
  servidor?.closeAllConnections();
  if (servidor) await new Promise(resolve => servidor.close(resolve));
  sqlite.close();
});

async function enviar(cuerpo) {
  const res = await fetch(`${base}/api/integraciones/sicar/v1/lotes`, {
    method: 'POST', headers: { Authorization: `Bearer ${llave}`, 'Content-Type': 'application/json' }, body: cuerpo });
  return { status: res.status, datos: await res.json() };
}
async function crm(ruta) {
  const res = await fetch(`${base}/api/crm/v2/${ruta}`, { headers: { Authorization: `Bearer ${admin}` } });
  return res.json();
}
const ventasGuardadas = () => sqlite.prepare('SELECT count(*) n FROM sicar_ventas').get().n;
const cambiar = (cuerpo, fn) => { const d = JSON.parse(cuerpo); fn(d); return JSON.stringify(d); };

test('1. el lote válido devuelve el recibo previsto y el CRM ve a José sin el público', async () => {
  const r = await enviar(LOTE_1);
  assert.equal(r.status, 200, JSON.stringify(r.datos));
  assert.equal(r.datos.sequence, '1');
  assert.equal(r.datos.next_sequence, '2');
  assert.deepEqual(r.datos.aceptados, { clientes: 2, ventas: 1 });
  assert.deepEqual(r.datos.descartados, { clientes: 1, ventas: 1, renglones: 1 });
  assert.equal(sqlite.prepare("SELECT count(*) n FROM sicar_clientes WHERE cli_id='1'").get().n, 0);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM sicar_ventas WHERE ven_id='88002'").get().n, 0);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM sicar_detalles WHERE ven_id='88002'").get().n, 0);
  const jose = await crm('clientes/sicar%3A1%3A4501');
  assert.equal(jose.monto_centavos, 150000);
  assert.equal((await crm('compras/sicar%3A1%3A88001')).lineas.length, 2);
  const refs = (await crm('clientes')).items.map(i => i.ref);
  assert.ok(!refs.includes('sicar:1:1'));
});

test('2. reenviar los mismos bytes (se perdió el ACK) devuelve el mismo recibo y no duplica', async () => {
  const antes = ventasGuardadas();
  const r = await enviar(LOTE_1);
  assert.equal(r.status, 200);
  assert.equal(r.datos.next_sequence, '2');
  assert.equal(ventasGuardadas(), antes);
});

test('3. el mismo batch_id con contenido distinto es conflicto y no escribe', async () => {
  const r = await enviar(cambiar(LOTE_1, d => { d.ventas[0].total = '1600.00'; }));
  assert.equal(r.status, 409);
  assert.equal(r.datos.codigo, 'CONFLICTO_BATCH');
  assert.equal((await crm('clientes/sicar%3A1%3A4501')).monto_centavos, 150000);
});

test('4. versión, moneda, estado o importe incorrectos se rechazan sin avanzar la secuencia', async () => {
  const nuevo = (fn) => cambiar(lote('6f1c2a90-0000-4000-8000-0000000000e1', '2', [],
    [venta('88010', '4502', '10.00', [linea('1', 'Púas', '10.00')])]), fn);
  const casos = [
    [d => { d.schema_version = 2; }, 400, 'VERSION_NO_SOPORTADA'],
    [d => { d.ventas[0].moneda = 'USD'; }, 422, 'MONEDA_ZONA_INVALIDA'],
    [d => { d.ventas[0].estado = 'pagada'; }, 422, 'ESTADO_INVALIDO'],
    [d => { d.ventas[0].total = '10'; }, 422, 'IMPORTE_INVALIDO'],
    [d => { d.ventas[0].fecha_local = '2026-10-13 11:30'; }, 422, 'FECHA_INVALIDA'],
  ];
  for (const [fn, status, codigo] of casos) {
    const r = await enviar(nuevo(fn));
    assert.deepEqual([r.status, r.datos.codigo], [status, codigo]);
  }
  assert.equal(repo.estado(1).siguiente_secuencia, '2');
  assert.equal(sqlite.prepare("SELECT count(*) n FROM sicar_ventas WHERE ven_id='88010'").get().n, 0);
});

test('5. saltarse una secuencia responde cuál sigue', async () => {
  const r = await enviar(lote('6f1c2a90-0000-4000-8000-000000000005', '5', [], []));
  assert.equal(r.status, 409);
  assert.deepEqual(r.datos, { codigo: 'SECUENCIA_INCORRECTA', siguiente_secuencia: '2' });
});

test('6. una cancelación de un ticket viejo saca la compra del total sin borrarla', async () => {
  const cancelada = { ...venta('88001', '4501', '1500.00', [linea('10', 'Guitarra clásica', '1350.00'),
    linea('11', 'Funda', '150.00')], 'cancelada') };
  const r = await enviar(lote('6f1c2a90-0000-4000-8000-000000000002', '2', [], [cancelada]));
  assert.equal(r.status, 200, JSON.stringify(r.datos));
  const jose = await crm('clientes/sicar%3A1%3A4501');
  assert.deepEqual([jose.monto_centavos, jose.numero_compras, jose.ultima_compra], [0, 0, null]);
  const compras = (await crm('clientes/sicar%3A1%3A4501/compras')).items;
  assert.deepEqual(compras.map(c => [c.ref, c.estado, c.suma_al_total]), [['sicar:1:88001', 'cancelada', false]]);
});

test('7. una compra corregida a otro cliente se mueve una sola vez', async () => {
  const r1 = await enviar(lote('6f1c2a90-0000-4000-8000-000000000003', '3', [],
    [venta('88003', '4501', '300.00', [linea('13', 'Afinador', '300.00')])]));
  assert.equal(r1.status, 200);
  const r2 = await enviar(lote('6f1c2a90-0000-4000-8000-000000000004', '4', [],
    [venta('88003', '4502', '300.00', [linea('13', 'Afinador', '300.00')])]));
  assert.equal(r2.status, 200);
  assert.equal((await crm('clientes/sicar%3A1%3A4501')).monto_centavos, 0);
  assert.equal((await crm('clientes/sicar%3A1%3A4502')).monto_centavos, 30000);
});

test('8. más de 12 envíos por minuto con la misma llave reciben 429; la venta excluida desaparece del CRM', async () => {
  const excluida = lote('6f1c2a90-0000-4000-8000-000000000006', '5', [], [{ ven_id: '88003', estado: 'excluida' }]);
  const limitado = await enviar(excluida);
  assert.deepEqual([limitado.status, limitado.datos.codigo], [429, 'RITMO_EXCEDIDO']);
  assert.equal(repo.estado(1).siguiente_secuencia, '5');
  llave = crearLlaveSicar(repo, 1, 961).llave; // en la tienda: esperar un minuto y reenviar el mismo lote
  const r = await enviar(lote('6f1c2a90-0000-4000-8000-000000000006', '5', [], [{ ven_id: '88003', estado: 'excluida' }]));
  assert.equal(r.status, 200, JSON.stringify(r.datos));
  assert.equal((await crm('clientes/sicar%3A1%3A4502')).monto_centavos, 0);
  assert.equal((await crm('compras/sicar%3A1%3A88003')).error, 'Cliente o compra no encontrado.');
});

test('9. una llave revocada ya no puede enviar', async () => {
  for (const { key_id } of repo.listarLlaves()) repo.revocarLlave(key_id);
  const r = await enviar(lote('6f1c2a90-0000-4000-8000-000000000007', '6', [], []));
  assert.equal(r.status, 401);
});

test('10. conserva artículos repetidos en orden de ticket y el reenvío no duplica', async () => {
  llave = crearLlaveSicar(repo, 1, 961).llave;
  const detalles = [linea('20', 'Primero', '20.00'), linea('10', 'Segundo', '10.00'), linea('20', 'Tercero', '30.00')];
  const cuerpo = lote('6f1c2a90-0000-4000-8000-000000000010', '6', [], [venta('88020', '4502', '60.00', detalles)]);
  const r = await enviar(cuerpo);
  assert.equal(r.status, 200, JSON.stringify(r.datos));
  const filas = sqlite.prepare("SELECT renglon, art_id, importe_centavos FROM sicar_detalles WHERE ven_id='88020' ORDER BY renglon").all();
  assert.deepEqual(filas, [
    { renglon: 0, art_id: '20', importe_centavos: 2000 },
    { renglon: 1, art_id: '10', importe_centavos: 1000 },
    { renglon: 2, art_id: '20', importe_centavos: 3000 },
  ]);
  assert.equal(sqlite.prepare("SELECT cuadra FROM sicar_ventas WHERE ven_id='88020'").get().cuadra, 1);
  assert.deepEqual((await crm('compras/sicar%3A1%3A88020')).lineas.map(d => d.descripcion), ['Primero', 'Segundo', 'Tercero']);
  assert.deepEqual(await enviar(cuerpo), r);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM sicar_detalles WHERE ven_id='88020'").get().n, 3);
});

test('11. un lote solo de articulos avanza la secuencia y clasifica por departamento las compras ya guardadas', async () => {
  const articulos = [{ art_id: '20', clave: 'JLX215P', descripcion: 'BAFLE JLX', categoria: 'Bafles', departamento: 'Audio' },
    { art_id: '10', clave: null, descripcion: 'Funda', categoria: null, departamento: 'Accesorios' }];
  const cuerpo = JSON.stringify({ ...SOBRE, batch_id: '6f1c2a90-0000-4000-8000-000000000011', sequence: '7', clientes: [], ventas: [], articulos });
  const r = await enviar(cuerpo);
  assert.equal(r.status, 200, JSON.stringify(r.datos));
  assert.deepEqual(r.datos.aceptados, { clientes: 0, ventas: 0, articulos: 2 });
  assert.equal(r.datos.next_sequence, '8');
  assert.deepEqual(await enviar(cuerpo), r);
  const q = await crm('clientes/sicar%3A1%3A4502/que-compra');
  const audio = q.departamentos.find(d => d.nombre === 'Audio');
  assert.deepEqual(audio.categorias, [{ nombre: 'Bafles', monto_centavos: 5000, piezas: 2 }]);
  assert.deepEqual(q.departamentos.find(d => d.nombre === 'Accesorios').categorias.map(c => c.nombre), ['Sin categoría']);
  assert.equal(q.departamentos.reduce((n, d) => n + d.monto_centavos, q.ajustes_centavos), q.total_centavos);
});

test('12. un lote solo de proveedores avanza la secuencia, se guarda por tienda y el reenvio no duplica', async () => {
  const proveedores = [{ prv_id: '7', nombre: 'Casa Veerkamp' }, { prv_id: '9', nombre: 'Fender México' }];
  const cuerpo = JSON.stringify({ ...SOBRE, batch_id: '6f1c2a90-0000-4000-8000-000000000012', sequence: '8', clientes: [], ventas: [], proveedores });
  const r = await enviar(cuerpo);
  assert.equal(r.status, 200, JSON.stringify(r.datos));
  assert.deepEqual(r.datos.aceptados, { clientes: 0, ventas: 0, proveedores: 2 });
  assert.equal(r.datos.next_sequence, '9');
  assert.deepEqual(await enviar(cuerpo), r);
  assert.deepEqual(sqlite.prepare('SELECT sucursal_id, prv_id, nombre FROM sicar_proveedores ORDER BY prv_id').all(),
    proveedores.map(p => ({ sucursal_id: 1, ...p })));
  const malo = JSON.stringify({ ...SOBRE, batch_id: '6f1c2a90-0000-4000-8000-000000000013', sequence: '9', clientes: [], ventas: [],
    proveedores: [{ prv_id: '10', nombre: '' }] });
  assert.equal((await enviar(malo)).status, 422);
});

test('13. un lote solo de existencias avanza la secuencia, se guarda por tienda y el reenvio no duplica', async () => {
  const existencias = [{ art_id: '7', existencia: '-1.0000' }, { art_id: '9', existencia: null }];
  const cuerpo = JSON.stringify({ ...SOBRE, batch_id: '6f1c2a90-0000-4000-8000-000000000014', sequence: '9', clientes: [], ventas: [], existencias });
  const r = await enviar(cuerpo);
  assert.equal(r.status, 200, JSON.stringify(r.datos));
  assert.deepEqual(r.datos.aceptados, { clientes: 0, ventas: 0, existencias: 2 });
  assert.equal(r.datos.next_sequence, '10');
  assert.deepEqual(await enviar(cuerpo), r);
  assert.deepEqual(sqlite.prepare('SELECT sucursal_id, art_id, existencia_diezmilesimas FROM sicar_existencias').all(),
    [{ sucursal_id: 1, art_id: '7', existencia_diezmilesimas: -10000 }]);
  const malo = JSON.stringify({ ...SOBRE, batch_id: '6f1c2a90-0000-4000-8000-000000000015', sequence: '10', clientes: [], ventas: [],
    existencias: [{ art_id: '10', existencia: '3' }] });
  assert.equal((await enviar(malo)).status, 422);
});
