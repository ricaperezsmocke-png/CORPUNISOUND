const { test } = require('node:test');
const assert = require('node:assert/strict');

const UUID = 'ABCDEF12-3456-7890-ABCD-EF1234567890';

function xmlDe({ uuid = UUID, tipo = 'I', total = '16217.997', rfc = 'DINX800101ABC', moneda, tipoCambio } = {}) {
  const extra = (moneda === undefined ? '' : ` Moneda="${moneda}"`) + (tipoCambio === undefined ? '' : ` TipoCambio="${tipoCambio}"`);
  const timbre = uuid === null ? '' : `<cfdi:Complemento><tfd:TimbreFiscalDigital UUID="${uuid}" /></cfdi:Complemento>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital"
  Version="4.0" Fecha="2026-07-01T12:00:00" Total="${total}" TipoDeComprobante="${tipo}"${extra}>
  <cfdi:Emisor Rfc="${rfc}" Nombre="Distribuidora del Norte SA de CV" />
  <cfdi:Conceptos><cfdi:Concepto ClaveProdServ="52161547" NoIdentificacion="P1" Cantidad="2" Descripcion="AMPLIFICADOR"
    ValorUnitario="100" Importe="200" /></cfdi:Conceptos>
  ${timbre}
</cfdi:Comprobante>`;
}

function preparar() {
  const Database = require('better-sqlite3');
  const sqlite = new Database(':memory:');
  require('./sicarRepositorio').crearRepositorioSicar(sqlite);
  const DB = { inventario: { compras: [] } };
  const modulo = require('./facturasPorLlegar').crearFacturasPorLlegar({ sqlite, DB });
  return { sqlite, DB, modulo };
}

function fallo(fn) {
  try { fn(); } catch (e) { return e; }
  return assert.fail('debia fallar');
}

test('cfdi: agrega total y tipoComprobante sin tocar lo demas', () => {
  const { parsearFacturaXML } = require('./cfdi');
  const r = parsearFacturaXML(xmlDe());
  assert.equal(r.total, '16217.997');
  assert.equal(r.tipoComprobante, 'I');
  assert.deepEqual(Object.keys(r).sort(), ['conceptos', 'emisor', 'fecha', 'folioFiscal', 'moneda', 'tipoCambio', 'tipoComprobante', 'total']);
});

test('registrar: factura de Ingreso entra por_llegar con total en centavos y uuid normalizado', () => {
  const { sqlite, modulo } = preparar();
  const f = modulo.registrar(xmlDe({ uuid: ` ${UUID.toLowerCase()} ` }), '7');
  assert.equal(f.estado, 'por_llegar');
  assert.equal(f.uuid, UUID);
  assert.equal(f.total_centavos, 1621800);
  assert.equal(f.rfc_emisor, 'DINX800101ABC');
  assert.equal(f.creada_por, '7');
  assert.equal(f.conceptos.length, 1);
  const h = sqlite.prepare('SELECT accion, actor FROM facturas_por_llegar_historial').all();
  assert.deepEqual(h, [{ accion: 'registrar', actor: '7' }]);
});

test('registrar: tipo E, P o N, sin uuid y XML ilegible dan 400', () => {
  const { modulo } = preparar();
  for (const tipo of ['E', 'P', 'N']) assert.equal(fallo(() => modulo.registrar(xmlDe({ tipo }), '7')).status, 400, tipo);
  assert.equal(fallo(() => modulo.registrar(xmlDe({ uuid: null }), '7')).status, 400);
  assert.equal(fallo(() => modulo.registrar('esto no es xml', '7')).status, 400);
  assert.equal(fallo(() => modulo.registrar(undefined, '7')).status, 400);
  assert.equal(fallo(() => modulo.registrar(xmlDe({ total: 'abc' }), '7')).status, 400);
});

test('registrar: uuid repetido con otra capitalizacion da 409', () => {
  const { modulo } = preparar();
  modulo.registrar(xmlDe(), '7');
  assert.equal(fallo(() => modulo.registrar(xmlDe({ uuid: UUID.toLowerCase() }), '7')).status, 409);
});

test('registrar: si la compra ya fue recibida con ese uuid queda llego por recepcion', () => {
  const { sqlite, DB, modulo } = preparar();
  DB.inventario.compras.push({ id: 1, uuid_cfdi: UUID.toLowerCase() });
  const f = modulo.registrar(xmlDe(), '7');
  assert.equal(f.estado, 'llego');
  assert.equal(f.llego_por, 'recepcion');
  assert.deepEqual(sqlite.prepare('SELECT accion FROM facturas_por_llegar_historial ORDER BY id').all().map(h => h.accion),
    ['registrar', 'llego']);
});

test('listar: llego automatico cuando la compra aparece despues, dias de espera y aviso a los 15', () => {
  const { sqlite, DB, modulo } = preparar();
  const a = modulo.registrar(xmlDe(), '7');
  const b = modulo.registrar(xmlDe({ uuid: '11111111-1111-1111-1111-111111111111' }), '7');
  const vieja = new Date(Date.now() - 16 * 86400000).toISOString();
  sqlite.prepare('UPDATE facturas_por_llegar SET creada_en = ? WHERE id = ?').run(vieja, b.id);
  let r = modulo.listar({});
  assert.equal(r.facturas.find(f => f.id === b.id).dias_espera, 16);
  assert.equal(r.facturas.find(f => f.id === b.id).aviso, true);
  assert.equal(r.facturas.find(f => f.id === a.id).aviso, false);
  assert.equal(r.vencidas, 1);
  DB.inventario.compras.push({ id: 2, uuid_cfdi: UUID });
  r = modulo.listar({ estado: 'por_llegar' });
  assert.deepEqual(r.facturas.map(f => f.id), [b.id]);
  assert.equal(modulo.listar({ estado: 'llego' }).facturas[0].llego_por, 'recepcion');
  assert.equal(fallo(() => modulo.listar({ estado: 'otra' })).status, 400);
});

test('llego a mano y cancelar con motivo: historial de cada accion', () => {
  const { sqlite, modulo } = preparar();
  const a = modulo.registrar(xmlDe(), '7');
  const b = modulo.registrar(xmlDe({ uuid: '22222222-2222-2222-2222-222222222222' }), '7');
  const ll = modulo.marcarLlego(a.id, '8');
  assert.equal(ll.estado, 'llego');
  assert.equal(ll.llego_por, '8');
  assert.ok(ll.llego_en);
  assert.equal(fallo(() => modulo.marcarLlego(a.id, '8')).status, 409);
  assert.equal(fallo(() => modulo.marcarLlego(999, '8')).status, 404);
  assert.equal(fallo(() => modulo.cancelar(b.id, 'ab', '8')).status, 400);
  assert.equal(fallo(() => modulo.cancelar(b.id, 'x'.repeat(201), '8')).status, 400);
  assert.equal(fallo(() => modulo.cancelar(b.id, undefined, '8')).status, 400);
  const c = modulo.cancelar(b.id, '  Proveedor la repuso  ', '9');
  assert.equal(c.estado, 'cancelada');
  assert.equal(c.motivo, 'Proveedor la repuso');
  assert.equal(fallo(() => modulo.cancelar(b.id, 'otro motivo', '9')).status, 409);
  assert.equal(fallo(() => modulo.marcarLlego(b.id, '9')).status, 409);
  const h = sqlite.prepare('SELECT factura_id, accion, actor FROM facturas_por_llegar_historial ORDER BY id').all();
  assert.deepEqual(h.map(x => [x.factura_id, x.accion, x.actor]),
    [[a.id, 'registrar', '7'], [b.id, 'registrar', '7'], [a.id, 'llego', '8'], [b.id, 'cancelar', '9']]);
});

test('rutas: permisos separados con roles vecinos', async t => {
  process.env.DB_PATH = ':memory:';
  process.env.SENTRY_ENABLED = 'false';
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'facturas-por-llegar-desechable';
  const app = require('./server');
  const { obtenerConexionSqlite } = require('./persistencia');
  const { firmarToken } = require('./auth');
  const sqlite = obtenerConexionSqlite();
  t.after(() => sqlite.close());
  const vecinos = ['recibir_compra', 'ver_existencias_sicar'];
  const roles = {
    981: [...vecinos, 'ver_facturas_por_llegar'],
    982: [...vecinos, 'registrar_facturas_por_llegar'],
    983: [...vecinos],
  };
  for (const [id, permisos] of Object.entries(roles)) {
    app.DB.admin.roles.push({ id: Number(id), nombre: `Facturas ${id}`, permisos, modulos: ['inventario'] });
    app.DB.admin.usuarios.push({ id: Number(id), nombre: `Prueba ${id}`, usuario: `fac${id}`, rol_id: Number(id), sucursal_id: 1, activo: true });
  }
  const servidor = app.listen(0, '127.0.0.1');
  await new Promise(resolve => servidor.once('listening', resolve));
  t.after(async () => { servidor.closeAllConnections(); await new Promise(resolve => servidor.close(resolve)); });
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const pedir = (ruta, id, metodo = 'GET', body) => fetch(base + ruta, { method: metodo, body: body && JSON.stringify(body),
    headers: { Authorization: `Bearer ${firmarToken({ id, rol_id: id, sucursal_id: 1 })}`, 'Content-Type': 'application/json' } })
    .then(async r => ({ status: r.status, datos: await r.json() }));

  assert.equal((await pedir('/api/facturas-por-llegar', 983)).status, 403);
  assert.equal((await pedir('/api/facturas-por-llegar', 982)).status, 403, 'registrar no da para ver');
  assert.equal((await pedir('/api/facturas-por-llegar', 981, 'POST', { xml: xmlDe() })).status, 403, 'ver no da para registrar');
  const ok = await pedir('/api/facturas-por-llegar', 982, 'POST', { xml: xmlDe() });
  assert.equal(ok.status, 201);
  assert.equal(ok.datos.creada_por, '982');
  assert.equal((await pedir('/api/facturas-por-llegar', 982, 'POST', { xml: xmlDe() })).status, 409);
  assert.equal((await pedir('/api/facturas-por-llegar', 982, 'POST', { xml: xmlDe({ tipo: 'E', uuid: 'X' }) })).status, 400);
  assert.equal((await pedir('/api/facturas-por-llegar', 981)).datos.facturas.length, 1);
  assert.equal((await pedir(`/api/facturas-por-llegar/${ok.datos.id}/llego`, 981, 'POST')).status, 403);
  assert.equal((await pedir(`/api/facturas-por-llegar/${ok.datos.id}/cancelar`, 982, 'POST', { motivo: 'no' })).status, 400);
  assert.equal((await pedir(`/api/facturas-por-llegar/${ok.datos.id}/cancelar`, 982, 'POST', { motivo: 'Se repuso' })).datos.estado, 'cancelada');
  assert.equal((await pedir('/api/facturas-por-llegar/999/llego', 982, 'POST')).status, 404);
});

test('permisos nuevos en el catalogo, modulo inventario', () => {
  const { PERMISOS } = require('./permisosCatalogo');
  for (const clave of ['ver_facturas_por_llegar', 'registrar_facturas_por_llegar']) {
    const p = PERMISOS.find(x => x.clave === clave);
    assert.ok(p, clave);
    assert.equal(p.modulo, 'inventario');
    assert.equal(p.implementado, true);
  }
});

test('cfdi: lee Moneda y TipoCambio tal cual, y null si no vienen', () => {
  const { parsearFacturaXML } = require('./cfdi');
  const usd = parsearFacturaXML(xmlDe({ moneda: 'USD', tipoCambio: '17.2540' }));
  assert.equal(usd.moneda, 'USD');
  assert.equal(usd.tipoCambio, '17.2540');
  const sin = parsearFacturaXML(xmlDe());
  assert.equal(sin.moneda, null);
  assert.equal(sin.tipoCambio, null);
});

test('registrar: factura en USD queda con su moneda, marcada prohibida y con nota en el historial', () => {
  const { sqlite, modulo } = preparar();
  const f = modulo.registrar(xmlDe({ total: '1000.00', moneda: ' usd ', tipoCambio: '17.2540' }), '7');
  assert.equal(f.moneda, 'USD');
  assert.equal(f.tipo_cambio, '17.2540');
  assert.equal(f.total_centavos, 100000);
  const h = sqlite.prepare('SELECT accion, detalle FROM facturas_por_llegar_historial').all();
  assert.deepEqual(h, [{ accion: 'registrar', detalle: 'moneda USD (prohibida)' }]);
  const lista = modulo.listar().facturas;
  assert.equal(lista[0].moneda_prohibida, true);
  assert.equal(lista[0].moneda, 'USD');
  assert.equal(modulo.listar().prohibidas, 1);
});

test('registrar: sin Moneda queda MXN y MXN no se marca', () => {
  const { sqlite, modulo } = preparar();
  const a = modulo.registrar(xmlDe(), '7');
  const b = modulo.registrar(xmlDe({ uuid: 'AAAAAAAA-0000-0000-0000-000000000001', moneda: 'MXN', tipoCambio: '1' }), '7');
  assert.equal(a.moneda, 'MXN');
  assert.equal(a.tipo_cambio, null);
  assert.equal(b.moneda, 'MXN');
  const lista = modulo.listar();
  assert.deepEqual(lista.facturas.map(f => f.moneda_prohibida), [false, false]);
  assert.equal(lista.prohibidas, 0);
  assert.deepEqual(sqlite.prepare('SELECT detalle FROM facturas_por_llegar_historial').all(), [{ detalle: null }, { detalle: null }]);
});

test('registrar: Moneda XXX no se rechaza y se marca prohibida', () => {
  const { modulo } = preparar();
  const f = modulo.registrar(xmlDe({ moneda: 'XXX' }), '7');
  assert.equal(f.moneda, 'XXX');
  assert.equal(modulo.listar().facturas[0].moneda_prohibida, true);
});
