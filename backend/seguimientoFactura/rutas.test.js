const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'seguimiento-rutas-prueba';
process.env.NODE_ENV = 'test';
process.env.SENTRY_ENABLED = 'false';
const app = require('../server');
const { obtenerConexionSqlite } = require('../persistencia');
const { firmarToken } = require('../auth');
const { fechaLocal } = require('../fechas');
const servicio = require('./servicio');

const sqlite = obtenerConexionSqlite();
const tokens = {};
const COM_ID = '12345678901234567890'; // 20 dígitos: no cabe en un Number sin perder precisión
const DIA = 86400000;
let servidor, base;

before(async () => {
  // 981: permiso vecino del mismo módulo. 982: solo ver. 983: ver y gestionar.
  for (const [id, permisos] of [[981, ['ver_facturas_por_llegar', 'conciliar_facturas']],
    [982, ['ver_seguimiento_facturas', 'ver_facturas_por_llegar']],
    [983, ['ver_seguimiento_facturas', 'gestionar_seguimiento_facturas']]]) {
    app.DB.admin.roles.push({ id, nombre: `Prueba ${id}`, permisos, modulos: ['inventario'] });
    app.DB.admin.usuarios.push({ id, usuario: `seguimiento${id}`, nombre: `Actor ${id}`, rol_id: id, sucursal_id: 1, activo: true });
    tokens[id] = firmarToken({ id: String(id), rol_id: id, sucursal_id: 1 });
  }
  await new Promise(resolve => { servidor = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});

beforeEach(() => {
  for (const tabla of ['seguimiento_avisos_historial', 'seguimiento_avisos', 'seguimiento_resultado', 'seguimiento_pendientes',
    'seguimiento_foto_problemas', 'seguimiento_foto', 'seguimiento_tiendas', 'seguimiento_config', 'seguimiento_config_historial',
    'sicar_compras_detalle', 'sicar_compras', 'sicar_existencias', 'sicar_articulos', 'sicar_sucursales_mapa']) {
    sqlite.exec(`DELETE FROM ${tabla}`);
  }
  const ahora = new Date().toISOString();
  for (const suc of [1, 6]) {
    sqlite.prepare('INSERT OR REPLACE INTO sicar_tiendas(sucursal_id, ultima_recepcion) VALUES (?, ?)').run(suc, ahora);
    sqlite.prepare(`INSERT INTO sicar_articulos(sucursal_id, art_id, clave, descripcion, actualizado_en)
      VALUES (?, ?, 'A', 'Púas', ?)`).run(suc, `art-${suc}`, ahora);
    sqlite.prepare('INSERT INTO sicar_existencias VALUES (?, ?, ?, ?)').run(suc, `art-${suc}`, 0, ahora);
  }
});

after(async () => {
  servidor?.closeAllConnections();
  if (servidor) await new Promise(resolve => servidor.close(resolve));
  sqlite.close();
});

async function pedir(ruta, id = 983, { metodo = 'GET', cuerpo } = {}) {
  const res = await fetch(`${base}/api/seguimiento-facturas${ruta}`, {
    method: metodo, headers: { 'Content-Type': 'application/json', ...(id ? { Authorization: `Bearer ${tokens[id]}` } : {}) },
    ...(cuerpo === undefined ? {} : { body: JSON.stringify(cuerpo) }),
  });
  const texto = await res.text();
  return { status: res.status, datos: texto.startsWith('{') || texto.startsWith('[') ? JSON.parse(texto) : texto };
}

test('posponer por HTTP: máximo 30 días; configurar 10 limita a 10', async () => {
  const id = facturaEnAviso();
  const posponer = dias => pedir(`/avisos/${id}`, 983, { metodo: 'POST', cuerpo: {
    estado: 'pospuesto', motivo: 'Esperar venta', pospuesto_hasta: fechaLocal(Date.now() + dias * DIA),
  } });
  const rechazo = await posponer(31);
  assert.equal(rechazo.status, 400);
  assert.equal(rechazo.datos.error, 'No se puede posponer más de 30 días.');
  assert.equal(sqlite.prepare('SELECT estado FROM seguimiento_avisos').get().estado, 'nuevo');
  assert.equal((await posponer(30)).status, 200);
  assert.equal((await pedir('/config', 983, { metodo: 'PUT', cuerpo: { dias_posponer_maximo: 10 } })).status, 200);
  const configurable = await posponer(11);
  assert.equal(configurable.status, 400);
  assert.equal(configurable.datos.error, 'No se puede posponer más de 10 días.');
  assert.equal((await posponer(10)).status, 200);
});

test('config de caducidad y posponer: iniciales, enteros 1–365 e historial', async () => {
  const inicial = await pedir('/config');
  assert.equal(inicial.datos.valores.dias_revisado_caduca, 15);
  assert.equal(inicial.datos.valores.dias_posponer_maximo, 30);
  for (const clave of ['dias_revisado_caduca', 'dias_posponer_maximo']) {
    for (const valor of [0, 366, 1.5, '10', null]) {
      assert.equal((await pedir('/config', 983, { metodo: 'PUT', cuerpo: { [clave]: valor } })).status, 400);
    }
    for (const valor of [1, 365]) {
      const r = await pedir('/config', 983, { metodo: 'PUT', cuerpo: { [clave]: valor } });
      assert.equal(r.status, 200);
      assert.equal(r.datos.valores[clave], valor);
      assert.equal(r.datos.historial[0].actor, '983');
    }
  }
});

/** CEDIS incorporada hace 60 días, compra de hace 50 días con 10 piezas a $10: queda en etapa de traslado. */
function facturaEnAviso() {
  const corte = new Date(Date.now() - 60 * DIA).toISOString();
  sqlite.prepare('INSERT INTO seguimiento_tiendas(sucursal_id, corte) VALUES (6, ?)').run(corte);
  const fecha = `${fechaLocal(Date.now() - 50 * DIA)}T10:00:00`;
  sqlite.prepare(`INSERT INTO sicar_compras
    (sucursal_id, com_id, fecha, pro_id, folio, comentario, estado, total_centavos, primera_vez, actualizado_en)
    VALUES (6, ?, ?, '1', 'F-77', 'COMPRA OCOSINGO', 'vigente', 0, ?, ?)`).run(COM_ID, fecha, corte, new Date().toISOString());
  sqlite.prepare('INSERT INTO sicar_compras_detalle VALUES (6, ?, 0, ?, ?, 10000, 1000, 0, 0)').run(COM_ID, 'art-6', '10.0000');
  servicio.marcarPendientes(sqlite, 6, ['art-6']);
  servicio.procesarPendientes(sqlite, { limite: 10 });
  return sqlite.prepare('SELECT id FROM seguimiento_avisos').get().id;
}

test('permiso propio: vecino 403, sin sesión 401, solo-ver 200 pero 403 en todo lo que cambia', async () => {
  facturaEnAviso();
  for (const ruta of ['', '/tiendas', `/6/${COM_ID}`]) {
    assert.equal((await pedir(ruta, 981)).status, 403, ruta);
    assert.equal((await pedir(ruta, null)).status, 401, ruta);
    assert.equal((await pedir(ruta, 982)).status, 200, ruta);
  }
  const avisoId = sqlite.prepare('SELECT id FROM seguimiento_avisos').get().id;
  const cambios = [['/tiendas/1/incorporar', 'POST', {}], [`/avisos/${avisoId}`, 'POST', { estado: 'revisado', motivo: 'Visto' }],
    ['/config', 'GET', undefined], ['/config', 'PUT', { dias_traslado: 40 }]];
  for (const [ruta, metodo, cuerpo] of cambios) {
    assert.equal((await pedir(ruta, 982, { metodo, cuerpo })).status, 403, `${metodo} ${ruta}`);
    assert.equal((await pedir(ruta, 981, { metodo, cuerpo })).status, 403, `${metodo} ${ruta}`);
  }
  assert.equal(sqlite.prepare('SELECT estado FROM seguimiento_avisos').get().estado, 'nuevo');
  assert.equal(sqlite.prepare('SELECT count(*) n FROM seguimiento_config').get().n, 0);
});

test('lista y detalle: com_id de 20 dígitos llega intacto y la factura trae su aviso', async () => {
  facturaEnAviso();
  const lista = await pedir('?solo_aviso=1');
  assert.equal(lista.status, 200);
  assert.equal(lista.datos.total, 1);
  const [f] = lista.datos.facturas;
  assert.equal(f.com_id, COM_ID);
  assert.equal(f.folio, 'F-77');
  assert.equal(f.etapa, 'traslado');
  assert.equal(f.aviso.etapa, 'traslado');
  assert.equal(f.dinero.queda, '10000');
  const detalle = await pedir(`/6/${COM_ID}`);
  assert.equal(detalle.status, 200);
  assert.equal(detalle.datos.factura.com_id, COM_ID);
  assert.equal(detalle.datos.renglones[0].descripcion, 'Púas');
  assert.ok(detalle.datos.renglones[0].estrategias);
  assert.equal((await pedir('/6/99')).status, 404);
  assert.equal((await pedir(`/1/${COM_ID}`)).status, 404);
  assert.equal((await pedir('?etapa=inventada')).status, 400);
  assert.equal((await pedir('?desde=2026-13-45')).status, 400);
  assert.equal((await pedir('?folio=nada')).datos.total, 0);
});

test('gestionar aviso: motivo obligatorio, posponer con fecha futura, actor del token y retirado 409', async () => {
  const id = facturaEnAviso();
  const manana = fechaLocal(Date.now() + 2 * DIA);
  const aviso = cuerpo => pedir(`/avisos/${id}`, 983, { metodo: 'POST', cuerpo });
  assert.equal((await aviso({ estado: 'pospuesto', pospuesto_hasta: manana })).status, 400);
  assert.equal((await aviso({ estado: 'pospuesto', motivo: '  ', pospuesto_hasta: manana })).status, 400);
  assert.equal((await aviso({ estado: 'pospuesto', motivo: 'Esperando temporada' })).status, 400);
  assert.equal((await aviso({ estado: 'pospuesto', motivo: 'Esperando temporada', pospuesto_hasta: fechaLocal() })).status, 400);
  assert.equal((await aviso({ estado: 'retirado', motivo: 'Quiero borrarlo' })).status, 400);
  assert.equal((await aviso({ estado: 'nuevo', motivo: 'Reabrir' })).status, 400);
  const ok = await aviso({ estado: 'pospuesto', motivo: '  Esperando temporada  ', pospuesto_hasta: manana, actor: '1' });
  assert.equal(ok.status, 200);
  assert.equal(ok.datos.pospuesto_hasta, manana);
  const h = sqlite.prepare('SELECT estado, motivo, actor FROM seguimiento_avisos_historial ORDER BY id DESC').get();
  assert.deepEqual({ ...h }, { estado: 'pospuesto', motivo: 'Esperando temporada', actor: '983' });
  assert.equal((await pedir('/avisos/9999', 983, { metodo: 'POST', cuerpo: { estado: 'revisado', motivo: 'Visto' } })).status, 404);
  sqlite.prepare("UPDATE seguimiento_avisos SET estado='retirado'").run();
  assert.equal((await aviso({ estado: 'revisado', motivo: 'Visto' })).status, 409);
});

test('configuración: solo claves conocidas y valores válidos, con historial y actor del token', async () => {
  const put = cuerpo => pedir('/config', 983, { metodo: 'PUT', cuerpo });
  assert.equal((await put({ inventada: 3 })).status, 400);
  assert.equal((await put({ dias_traslado: '40' })).status, 400);
  assert.equal((await put({ dias_traslado: 40.5 })).status, 400);
  assert.equal((await put({ ganancia_75_porcentaje: 101 })).status, 400);
  assert.equal((await put({ dias_traslado: 70 })).status, 400); // 70 ≥ 60 rompe el orden de etapas
  assert.equal((await put({ ganancia_50_porcentaje: 80 })).status, 400);
  assert.equal((await put({})).status, 400);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM seguimiento_config').get().n, 0);
  const ok = await put({ dias_traslado: 40 });
  assert.equal(ok.status, 200);
  assert.equal(ok.datos.valores.dias_traslado, 40);
  assert.equal(ok.datos.iniciales.dias_traslado, 45);
  assert.deepEqual(ok.datos.historial.map(h => [h.clave, h.anterior, h.nuevo, h.actor]), [['dias_traslado', '45', '40', '983']]);
  assert.equal((await pedir('/config')).datos.valores.dias_traslado, 40);
});

test('tiendas e incorporar: muestra la foto de las pendientes e incorpora con gestionar', async () => {
  const antes = await pedir('/tiendas', 982);
  assert.equal(antes.status, 200);
  assert.deepEqual(antes.datos.incorporadas, []);
  assert.deepEqual(antes.datos.pendientes.map(t => [t.sucursal_id, t.claves, t.vieja]), [[1, 1, false], [6, 1, false]]);
  const r = await pedir('/tiendas/1/incorporar', 983, { metodo: 'POST', cuerpo: {} });
  assert.equal(r.status, 200);
  assert.equal(sqlite.prepare('SELECT actor FROM seguimiento_tiendas WHERE sucursal_id=1').get().actor, '983');
  assert.equal((await pedir('/tiendas/1/incorporar', 983, { metodo: 'POST', cuerpo: {} })).status, 409);
});

test('en camino y sucursales sin asignar: exigen sesión y el permiso de ver; no leen alcance del encabezado', async t => {
  facturaEnAviso();
  const ahora = new Date().toISOString();
  const corte = new Date(Date.now() - 60 * DIA).toISOString();
  for (const suc of [1, 2, 6]) {
    sqlite.prepare('INSERT INTO sicar_sucursales_mapa(sicar_sucursal, sucursal_id) VALUES (?, ?)').run(`s${suc}`, suc);
    if (suc !== 6) sqlite.prepare('INSERT INTO seguimiento_tiendas(sucursal_id, corte) VALUES (?, ?)').run(suc, corte);
  }
  const fecha = fechaLocal(Date.now() - 10 * DIA);
  const aplicada = fechaLocal(Date.now() - 9 * DIA);
  t.after(() => {
    sqlite.exec("DELETE FROM sicar_traspasos_detalle WHERE tra_id LIKE 'alcance-%'");
    sqlite.exec("DELETE FROM sicar_traspasos WHERE tra_id LIKE 'alcance-%'");
  });
  for (const [suc, id, folio, origen, destino, estado, recibida, cantidad] of [
    [6, 'alcance-envio', 'RECIBIDO', 's6', 's1', 'enviado', null, '6.0000'],
    [1, 'alcance-recibo', 'RECIBIDO', 's6', 's1', 'recibido', aplicada, '6.0000'],
    [1, 'alcance-tienda', 'TIENDA', 's1', 's2', 'enviado', null, '2.0000'],
    [6, 'alcance-cedis', 'CEDIS', 's6', 's2', 'enviado', null, '3.0000'],
  ]) {
    const envio = folio === 'RECIBIDO' ? fecha : fechaLocal(Date.now() - 8 * DIA);
    sqlite.prepare('INSERT INTO sicar_traspasos VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?)')
      .run(suc, id, folio, origen, destino, envio, estado, recibida, ahora);
    sqlite.prepare('INSERT INTO sicar_traspasos_detalle VALUES (?, ?, ?, ?, 1000, 1160)').run(suc, id, `art-${suc}`, cantidad);
  }
  servicio.marcarPendientes(sqlite, 6, ['art-6']);
  assert.deepEqual(servicio.procesarPendientes(sqlite), { procesadas: 1, errores: [], quedan: 0 });
  for (const ruta of ['/en-camino', '/sicar-sin-asignar', '/en-camino?sucursal_id=1&solo_alarmas=1']) {
    assert.equal((await pedir(ruta, 981)).status, 403, ruta);
    assert.equal((await pedir(ruta, null)).status, 401, ruta);
    assert.equal((await pedir(ruta, 982)).status, 200, ruta);
  }
  const r = await pedir('/en-camino', 982);
  const conSucursal = await pedir('/en-camino?sucursal_id=1', 982);
  assert.equal(r.status, 200);
  assert.equal(conSucursal.status, 200);
  assert.equal(r.datos.total, 2);
  assert.deepEqual(r.datos.filas.map(f => [f.folio, f.origen, f.destino, f.piezas, f.centavos]), [
    ['CEDIS', 6, 2, '30000', '3000'], ['TIENDA', 1, 2, '20000', '2000'],
  ]);
  assert.deepEqual(conSucursal.datos.filas, r.datos.filas);
  assert.deepEqual(conSucursal.datos.totales, r.datos.totales);
  assert.equal(conSucursal.datos.total, r.datos.total);
  assert.equal(r.datos.dias_transito_alarma, 7);
  assert.equal(r.datos.totales.transito.centavos, '5000');
  assert.deepEqual((await pedir('/sicar-sin-asignar')).datos, { sin_asignar: [] });
  assert.equal((await pedir('/en-camino?pagina=0')).status, 400);
});

test('config de la alarma de tránsito: inicial 7, enteros de 1 a 365 y solo quien gestiona', async () => {
  assert.equal((await pedir('/config')).datos.valores.dias_transito_alarma, 7);
  for (const valor of [0, 366, 1.5, '10', null]) {
    assert.equal((await pedir('/config', 983, { metodo: 'PUT', cuerpo: { dias_transito_alarma: valor } })).status, 400);
  }
  assert.equal((await pedir('/config', 982, { metodo: 'PUT', cuerpo: { dias_transito_alarma: 3 } })).status, 403);
  const ok = await pedir('/config', 983, { metodo: 'PUT', cuerpo: { dias_transito_alarma: 3 } });
  assert.equal(ok.status, 200);
  assert.equal(ok.datos.valores.dias_transito_alarma, 3);
  assert.equal((await pedir('/en-camino')).datos.dias_transito_alarma, 3);
});
