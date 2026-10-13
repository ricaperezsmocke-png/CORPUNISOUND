const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
process.env.DB_PATH = ':memory:';
process.env.SENTRY_ENABLED = 'false';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'sicar-aislamiento-desechable';
const { construirDBPrueba } = require('./testHelpers');
const { sembrarCajas, esDeEstaCaja } = require('./cajas');
const { calcularCorteEnCurso } = require('./cortes');
const { reporteUtilidad } = require('./reportes');
const { fechaLocal } = require('./fechas');

function prepararDB() {
  const DB = construirDBPrueba();
  DB.pos.ventas = [];
  DB.pos.venta_detalle = [];
  DB.pos.cortes_caja = [];
  DB.pos.apartado_abonos = [];
  DB.pos.cajas = [];
  sembrarCajas(DB);
  return DB;
}

test('ingesta, cancelación y reintento HTTP dejan idénticos cortes, utilidad, POS, inventario y monederos', async t => {
  const app = require('./server');
  const sqlite = require('./persistencia').obtenerConexionSqlite();
  const { firmarToken } = require('./auth');
  const DB = app.DB;
  const fixture = prepararDB();
  DB.pos = fixture.pos;
  DB.inventario = fixture.inventario;
  DB.crm = fixture.crm;
  const cajas = DB.pos.cajas.filter(c => c.sucursal_id === 1);
  const administrativa = cajas.find(c => c.nombre === 'Administrativa');
  const fiscal = cajas.find(c => c.nombre === 'Fiscal');
  DB.pos.cortes_caja.push({ id: 900, sucursal_id: 1, caja_id: administrativa.id,
    fecha_hora: '2020-01-01T00:00:00.000Z', fecha: '2020-01-01', efectivo_contado: 100 });
  for (const [id, caja_id, total, monedero] of [[901, undefined, 100, 30], [902, fiscal.id, 200, 0]]) {
    DB.pos.ventas.push({ id, sucursal_id: 1, caja_id, cliente_id: 1, fecha: fechaLocal(),
      fecha_hora: new Date().toISOString(), tipo_documento: 'Ticket', metodo_pago: 'EFECTIVO',
      total, monedero_aplicado: monedero, estatus: 'cerrada' });
    DB.pos.venta_detalle.push({ id, venta_id: id, descripcion: 'Instrumento nativo', cantidad: 1,
      precio_unitario: total, subtotal: total, costo_unitario: 20 });
  }
  DB.crm.clientes.find(c => c.id === 1).saldo = 123;
  DB.crm.clientes.find(c => c.id === 1).monedero = 70;
  assert.equal(esDeEstaCaja(DB.pos.ventas[0], administrativa), true);
  const foto = () => structuredClone({
    cortes: cajas.map(c => ({ caja_id: c.id, ...calcularCorteEnCurso(DB, 1, c.id) })),
    utilidad: reporteUtilidad(DB, {}, { verTodas: true, sucursalId: null }),
    pos: DB.pos, inventario: DB.inventario, clientes: DB.crm.clientes,
  });
  DB.admin.roles.push({ id: 999, nombre: 'SICAR prueba', permisos: ['administrar_llaves_sicar'], modulos: ['sicar'] });
  DB.admin.usuarios.push({ id: 999, nombre: 'Prueba', usuario: 'aislamiento', rol_id: 999, sucursal_id: 1, activo: true });
  const token = firmarToken({ id: 999, rol_id: 999, sucursal_id: 1 });
  const servidor = app.listen(0, '127.0.0.1');
  await new Promise(resolve => servidor.once('listening', resolve));
  t.after(async () => { servidor.closeAllConnections(); await new Promise(resolve => servidor.close(resolve)); sqlite.close(); });
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const post = async (ruta, credencial, body) => {
    const r = await fetch(base + ruta, { method: 'POST', headers: {
      Authorization: `Bearer ${credencial}`, 'Content-Type': 'application/json',
    }, body: JSON.stringify(body) });
    assert.ok([200, 201].includes(r.status), `HTTP ${r.status}: ${await r.clone().text()}`);
    return r.json();
  };
  const k = await post('/api/sicar/llaves', token, { sucursal_id: '1' });
  const antes = foto();
  assert.equal(antes.cortes.find(c => c.caja_id === administrativa.id).calculado.EFECTIVO, 70);
  assert.equal(antes.cortes.find(c => c.caja_id === fiscal.id).calculado.EFECTIVO, 200);
  assert.equal(antes.utilidad.totales.venta, 300);
  const jsonAntes = sqlite.prepare('SELECT * FROM estado').all();
  const body = { schema_version: 1, mapping_version: 'ocosingo-f0-v1', batch_id: randomUUID(), sequence: '1',
    captured_at: '2026-10-13T18:00:00.000Z', mode: 'incremental',
    window: { from: '2026-10-11T12:00:00-06:00', to: '2026-10-13T12:00:00-06:00' },
    clientes: [{ cli_id: '123', nombre: 'Cliente externo' }],
    ventas: [{ ven_id: '4501', cli_id: '123', fecha_local: '2026-10-12T16:30:00',
      timezone: 'America/Mexico_City', moneda: 'MXN', estado: 'vigente', total: '99999.00',
      detalle: [{ art_id: '81', descripcion: 'Compra externa', cantidad: '1.0000', precio_con: '99999.0000',
        precio_sin: '86206.0345', importe_con: '99999.00', descuento_total: '0.00' }] }] };
  const ruta = '/api/integraciones/sicar/v1/lotes';
  await post(ruta, k.llave, body);
  assert.deepEqual(foto(), antes);
  const cancelacion = { ...body, batch_id: randomUUID(), sequence: '2', clientes: [], ventas: [{ ven_id: '4501', estado: 'cancelada' }] };
  const recibo = await post(ruta, k.llave, cancelacion);
  assert.deepEqual(await post(ruta, k.llave, cancelacion), recibo);
  assert.equal(sqlite.prepare('SELECT estado FROM sicar_ventas').get().estado, 'cancelada');
  assert.deepEqual(foto(), antes);
  assert.deepEqual(sqlite.prepare('SELECT * FROM estado').all(), jsonAntes);
  assert.equal(Object.keys(DB).some(k => k.startsWith('sicar')), false);
});
