const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

function prepararDB(t, conexion) {
  const sqlite = conexion || new Database(':memory:');
  require('./sicarRepositorio').crearRepositorioSicar(sqlite);
  if (!conexion) t.after(() => sqlite.close());
  const modulo = require('./facturasCompras').crearFacturasCompras({ sqlite });
  function factura(extra = {}) {
    const f = { uuid: String(Math.random()), rfc: 'ABC010101XY9', fecha: '2026-01-01T12:00:00',
      total: 10000, serie: 'A', folio: '123', moneda: 'MXN', ...extra };
    return Number(sqlite.prepare(`INSERT INTO facturas_por_llegar
      (uuid,rfc_emisor,fecha_emision,total_centavos,serie,folio,moneda,conceptos_json,estado,creada_por,creada_en)
      VALUES (@uuid,@rfc,@fecha,@total,@serie,@folio,@moneda,'[]','por_llegar','7','2026-01-01T12:00:00Z')`).run(f).lastInsertRowid);
  }
  function compra(extra = {}) {
    const c = { sucursal: 6, id: '1', fecha: '2026-01-02T12:00:00', total: 10000, folio: 'A-000123',
      rfc: 'ABC010101XY9', primera: '2026-01-01T12:00:00Z', ...extra };
    sqlite.prepare('INSERT OR IGNORE INTO sicar_tiendas(sucursal_id) VALUES (?)').run(c.sucursal);
    sqlite.prepare(`INSERT OR REPLACE INTO sicar_proveedores(sucursal_id,prv_id,nombre,rfc,actualizado_en)
      VALUES (?,'1','Proveedor',?,'2026-01-01')`).run(c.sucursal, c.rfc);
    sqlite.prepare(`INSERT INTO sicar_compras
      (sucursal_id,com_id,fecha,pro_id,folio,comentario,estado,total_centavos,primera_vez,actualizado_en)
      VALUES (@sucursal,@id,@fecha,'1',@folio,'COMPRA CEDIS','vigente',@total,@primera,@primera)`).run(c);
    return { sucursal_id: c.sucursal, com_id: c.id };
  }
  const obtener = id => sqlite.prepare('SELECT * FROM facturas_por_llegar WHERE id=?').get(id);
  return { sqlite, modulo, factura, compra, obtener };
}

test('1. RFC, total exacto, folio y fecha unen sola', t => {
  const { modulo, factura, compra, obtener, sqlite } = prepararDB(t);
  const id = factura(); compra(); modulo.revisar(); modulo.revisar(); modulo.alGuardarCompras(6, ['1']);
  assert.equal(obtener(id).llego_por, 'sicar');
  assert.equal(obtener(id).llego_en, '2026-01-02T12:00:00');
  assert.equal(sqlite.prepare('SELECT modo FROM facturas_compras').get().modo, 'automatica');
  assert.equal(sqlite.prepare("SELECT count(*) n FROM facturas_por_llegar_historial WHERE accion='unir'").get().n, 1);
});
test('2. Margen de 100 centavos incluido y 101 excluido', t => {
  for (const delta of [-101, -100, 100, 101]) {
    const { modulo, factura, compra, obtener } = prepararDB(t);
    const id = factura(); compra({ total: 10000 + delta });
    assert.equal(modulo.candidatas(id).length, Math.abs(delta) <= 100 ? 1 : 0);
    modulo.revisar(); assert.equal(obtener(id).estado, Math.abs(delta) <= 100 ? 'llego' : 'por_llegar');
  }
});
test('3. Fecha anterior y día 61 excluidos; día 60 incluido', t => {
  for (const [fecha, n] of [['2025-12-31', 0], ['2026-01-01', 1], ['2026-03-02', 1], ['2026-03-03', 0]]) {
    const { modulo, factura, compra } = prepararDB(t);
    const id = factura(); compra({ fecha: fecha + 'T00:00:00' }); assert.equal(modulo.candidatas(id).length, n);
  }
});
test('4. RFC normalizado une', t => {
  const { modulo, factura, compra, obtener } = prepararDB(t);
  const id = factura(); compra({ rfc: 'abc-010101 xy9' }); modulo.revisar(); assert.equal(obtener(id).estado, 'llego');
});
test('5. Serie y ceros coinciden; folio vacío queda Por confirmar', t => {
  for (const folio of ['A-000123', '000123', '']) {
    const { modulo, factura, compra, obtener } = prepararDB(t);
    const id = factura(); compra({ folio }); modulo.revisar();
    assert.equal(obtener(id).estado, folio ? 'llego' : 'por_llegar');
    assert.equal(modulo.resumen().por_confirmar.length, folio ? 0 : 1);
  }
});
test('6. Dos facturas y una compra no se unen solas', t => {
  const { modulo, factura, compra, obtener } = prepararDB(t);
  const ids = [factura(), factura()]; compra(); modulo.revisar();
  assert.ok(ids.every(id => obtener(id).estado === 'por_llegar'));
  assert.equal(modulo.resumen().por_confirmar.length, 2);
});
test('7. Cancelación desune e historial y aviso persisten sin duplicarse', t => {
  const { modulo, factura, compra, obtener, sqlite } = prepararDB(t);
  const id = factura(); compra(); modulo.revisar();
  sqlite.prepare("UPDATE sicar_compras SET estado='cancelada'").run();
  modulo.alGuardarCompras(6, ['1']); modulo.alGuardarCompras(6, ['1']);
  assert.equal(obtener(id).estado, 'por_llegar');
  assert.equal(sqlite.prepare('SELECT count(*) n FROM facturas_compras').get().n, 0);
  assert.equal(sqlite.prepare("SELECT actor FROM facturas_por_llegar_historial WHERE accion='desunir_cancelada'").get().actor, 'sicar');
  assert.equal(modulo.resumen().canceladas_despues.length, 1);
});
test('8. Cambio de total conserva unión y muestra antes y después', t => {
  const { modulo, factura, compra, obtener, sqlite } = prepararDB(t);
  const id = factura(); compra(); modulo.revisar();
  sqlite.prepare('UPDATE sicar_compras SET total_centavos=15000').run(); modulo.alGuardarCompras(6, ['1']);
  assert.equal(obtener(id).estado, 'llego');
  const aviso = modulo.resumen().cambiaron[0];
  assert.equal(aviso.total_al_unir_centavos, 10000); assert.equal(aviso.total_centavos, 15000);
});
test('9. Confirmación valida candidata y registra actor manual', t => {
  const { modulo, factura, compra, sqlite } = prepararDB(t);
  const id = factura(); const c = compra({ folio: '' });
  assert.throws(() => modulo.confirmar(id, { ...c, com_id: 'otra' }, '9'), { status: 409 });
  modulo.confirmar(String(id), { ...c, sucursal_id: '6' }, '9');
  assert.deepEqual(sqlite.prepare('SELECT modo,actor FROM facturas_compras').get(), { modo: 'manual', actor: '9' });
  assert.throws(() => modulo.confirmar(id, c, '9'), { status: 409 });
});
test('10. Proveedor sin RFC excluido y contado', t => {
  const { modulo, factura, compra } = prepararDB(t);
  const id = factura(); compra({ rfc: null });
  assert.equal(modulo.candidatas(id).length, 0);
  assert.equal(modulo.resumen().proveedores_sin_rfc[0].compras, 1);
});
test('11. USD nunca candidata', t => {
  const { modulo, factura, compra } = prepararDB(t);
  const id = factura({ moneda: 'USD' }); compra(); assert.equal(modulo.candidatas(id).length, 0);
});
test('12. Rutas exigen conciliar aunque el rol pueda ver y registrar', async t => {
  process.env.DB_PATH = ':memory:'; process.env.NODE_ENV = 'test'; process.env.SENTRY_ENABLED = 'false';
  process.env.JWT_SECRET = 'facturas-compras-prueba';
  const app = require('./server');
  const sqlite = require('./persistencia').obtenerConexionSqlite();
  t.after(() => sqlite.close());
  const { factura, compra } = prepararDB(t, sqlite);
  const id = factura(); const c = compra({ folio: '' });
  for (const rol of [991, 992]) {
    const permisos = ['ver_facturas_por_llegar', 'registrar_facturas_por_llegar'];
    if (rol === 992) permisos.push('conciliar_facturas');
    app.DB.admin.roles.push({ id: rol, nombre: String(rol), permisos, modulos: ['inventario'] });
    app.DB.admin.usuarios.push({ id: rol, usuario: String(rol), rol_id: rol, sucursal_id: 1, activo: true });
  }
  const servidor = app.listen(0, '127.0.0.1');
  await new Promise(resolve => servidor.once('listening', resolve));
  t.after(async () => { servidor.closeAllConnections(); await new Promise(resolve => servidor.close(resolve)); });
  const pedir = (accion, rol, body, metodo = 'POST') => fetch(
    `http://127.0.0.1:${servidor.address().port}/api/facturas-por-llegar/${id}/${accion}`, {
      method: metodo, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' +
        require('./auth').firmarToken({ id: rol, rol_id: rol, sucursal_id: 1 }) }, body: body && JSON.stringify(body),
    });
  for (const accion of ['confirmar', 'ninguna', 'desunir']) assert.equal((await pedir(accion, 991, c)).status, 403);
  assert.equal((await pedir('candidatas', 991, undefined, 'GET')).status, 200);
  const r = await pedir('confirmar', 992, { ...c, sucursal_id: '6', actor: 'falso' });
  assert.equal(r.status, 200);
  assert.equal(sqlite.prepare('SELECT actor FROM facturas_compras').get().actor, '992');
});
test('13. Carga inicial excluida; compra recibida 20 días después incluida', t => {
  const { modulo, compra } = prepararDB(t);
  compra(); compra({ id: '2', primera: '2026-01-21T12:00:00Z' });
  const r = modulo.resumen();
  assert.deepEqual(r.compras_sin_factura_15.map(c => c.com_id), ['2']);
  assert.equal(r.compras_viejas_sin_factura, 1);
});
test('14. Dos sucursales con mismo RFC total y folio son dos candidatas', t => {
  const { modulo, factura, compra, obtener, sqlite } = prepararDB(t);
  const id = factura(); compra(); compra({ sucursal: 42 }); modulo.revisar();
  assert.equal(modulo.candidatas(id).length, 2); assert.equal(obtener(id).estado, 'por_llegar');
  assert.equal(modulo.resumen().por_confirmar.length, 1);
  sqlite.prepare("UPDATE sicar_proveedores SET rfc='OTRO' WHERE sucursal_id=42").run();
  assert.deepEqual(modulo.candidatas(id).map(c => c.sucursal_id), [6]);
});
test('Ninguna suprime la lista; una candidata nueva vuelve a proponer; desunir exige motivo', t => {
  const { modulo, factura, compra, obtener } = prepararDB(t);
  const id = factura(); const c = compra({ folio: '' });
  assert.throws(() => modulo.ninguna(id, '', '8'), { status: 400 });
  modulo.ninguna(id, 'No corresponde', '8'); modulo.revisar();
  assert.equal(modulo.resumen().por_confirmar.length, 0);
  compra({ id: '2' }); modulo.revisar(); assert.equal(modulo.resumen().por_confirmar.length, 1);
  modulo.confirmar(id, c, '8');
  assert.throws(() => modulo.desunir(id, '', '8'), { status: 400 });
  modulo.desunir(id, 'Corrección', '8'); assert.equal(obtener(id).estado, 'por_llegar');
});

test('Hook real después del commit une, relee y desune una cancelación', t => {
  const { sqlite, modulo, factura, obtener } = prepararDB(t);
  const id = factura();
  const repo = require('./sicarRepositorio').crearRepositorioSicar(sqlite, { alGuardarCompras: modulo.alGuardarCompras });
  const c = { com_id: '9007199254740993', fecha: '2026-01-02T10:00:00', pro_id: '7', folio: 'A123', comentario: '',
    estado: 'vigente', cancelada_en: null, total_con: '100.00', detalle: [
      { art_id: '81', cantidad: '1.0000', precio_sin: '86.21', precio_con: '100.00', importe_con: '100.00' },
    ] };
  function enviar(sequence, compra) {
    return repo.aplicarLote({ sucursalId: 42, hash: `h-${sequence}`, lote: {
      schema_version: 1, mapping_version: 'ocosingo-f0-v1', batch_id: `b-${sequence}`, sequence,
      clientes: [], ventas: [], proveedores: [{ prv_id: '7', nombre: 'Proveedor', rfc: 'ABC010101XY9' }], compras: [compra],
    } });
  }
  enviar('1', c); enviar('2', c);
  assert.equal(obtener(id).estado, 'llego');
  assert.equal(sqlite.prepare('SELECT com_id FROM facturas_compras').get().com_id, c.com_id);
  enviar('3', { ...c, estado: 'cancelada', cancelada_en: '2026-01-03T12:00:00' });
  assert.equal(obtener(id).estado, 'por_llegar');
  assert.equal(modulo.resumen().canceladas_despues.length, 1);
});

test('Migración conserva facturas antiguas y sin folio solo permite confirmar manualmente', t => {
  const { sqlite, modulo, factura, compra, obtener } = prepararDB(t);
  const id = factura(); const c = compra();
  sqlite.exec('ALTER TABLE facturas_por_llegar DROP COLUMN serie; ALTER TABLE facturas_por_llegar DROP COLUMN folio');
  require('./sicarRepositorio').crearRepositorioSicar(sqlite);
  require('./sicarRepositorio').crearRepositorioSicar(sqlite);
  assert.equal(obtener(id).serie, null); assert.equal(obtener(id).folio, null);
  modulo.revisar(); assert.equal(obtener(id).estado, 'por_llegar');
  modulo.confirmar(id, c, '9'); assert.equal(obtener(id).estado, 'llego');
});

test('Fallo de historial revierte unión completa y el hook no lanza', t => {
  const { sqlite, modulo, factura, compra, obtener } = prepararDB(t);
  const id = factura(); const c = compra();
  sqlite.exec(`CREATE TRIGGER fallar_historial BEFORE INSERT ON facturas_por_llegar_historial
    BEGIN SELECT RAISE(ABORT, 'fallo de prueba'); END`);
  assert.throws(() => modulo.confirmar(id, c, '9'), /fallo de prueba/);
  const mensajes = [];
  t.mock.method(console, 'error', (...args) => mensajes.push(args));
  assert.doesNotThrow(() => modulo.alGuardarCompras(6, ['1']));
  assert.equal(obtener(id).estado, 'por_llegar');
  assert.equal(sqlite.prepare('SELECT count(*) n FROM facturas_compras').get().n, 0);
  assert.equal(mensajes.length, 1);
});

test('Ninguna impide la unión automática de la misma lista aunque el folio se corrija', t => {
  const { sqlite, modulo, factura, compra, obtener } = prepararDB(t);
  const id = factura(); compra({ folio: '' }); modulo.ninguna(id, 'No corresponde', '8');
  sqlite.prepare("UPDATE sicar_compras SET folio='A123'").run();
  modulo.alGuardarCompras(6, ['1']); modulo.revisar();
  assert.equal(obtener(id).estado, 'por_llegar'); assert.equal(modulo.resumen().por_confirmar.length, 0);
});
