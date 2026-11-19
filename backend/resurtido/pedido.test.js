const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { crearRepositorioSicar } = require('../sicarRepositorio');
const { armarBorrador, repartirEmpaque } = require('./pedido');
const { enCamino } = require('./sugerido');
const { tareasDiarias } = require('./servicio');
const AHORA = '2026-11-19T18:00:00Z';

// Cuatro tiendas con la clave A (JR) y la clave C (cable SOLCOR); máximo 20 piezas, existencia 5.
function prepararDB(t) {
  const db = new Database(':memory:'); crearRepositorioSicar(db); t.after(() => db.close());
  for (const suc of [1, 2, 3, 4, 6]) {
    db.prepare('INSERT INTO sicar_sucursales_mapa(sicar_sucursal,sucursal_id) VALUES (?,?)').run(String(suc), suc);
  }
  for (const suc of [1, 2, 3, 4]) {
    db.prepare('INSERT INTO sicar_tiendas(sucursal_id) VALUES (?)').run(suc);
    db.prepare("INSERT INTO sicar_articulos VALUES (?, 'a','A','Cuerda 1a',NULL,'JR',?)").run(suc, AHORA);
    db.prepare("INSERT INTO sicar_articulos VALUES (?, 'c','C','CABLE USO RUDO 2X14',NULL,'SOLCOR',?)").run(suc, AHORA);
    for (const art of ['a', 'c']) db.prepare('INSERT INTO sicar_existencias VALUES (?,?,50000,?)').run(suc, art, AHORA);
    for (const [clave, marca] of [['A', 'JR'], ['C', 'SOLCOR']]) {
      db.prepare("INSERT INTO resurtido_minmax VALUES (?,?,?,100000,200000,?,300,0,'calculado','aproximada',?)")
        .run(suc, clave, marca, suc * 1000, AHORA);
    }
  }
  return db;
}
const renglones = (db, id, clave = 'A') => db.prepare(`SELECT sucursal_id, sugerido, pedido FROM resurtido_pedido_renglones
  WHERE pedido_id=? AND clave=? ORDER BY sucursal_id`).all(id, clave);
let folio = 0;
function traspaso(db, { suc = 3, origen = '6', destino = '3', estado = 'enviado', fecha = '2026-11-10 10:00:00', aplicado = null,
  cantidad = '8.0000', art = 'a' } = {}) {
  const id = `t${++folio}`;
  db.prepare('INSERT INTO sicar_traspasos VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?)')
    .run(suc, id, `F${folio}`, origen, destino, fecha, estado, aplicado, AHORA);
  db.prepare('INSERT INTO sicar_traspasos_detalle VALUES (?, ?, ?, ?, 0, 0)').run(suc, id, art, cantidad);
}

test('borrador: existencia negativa cuenta como cero y tienda atrasada no entra', t => {
  const db = prepararDB(t);
  db.exec("UPDATE sicar_existencias SET existencia_diezmilesimas=-20000 WHERE sucursal_id=3 AND art_id='a'");
  db.exec("UPDATE sicar_existencias SET actualizado_en='2026-11-01T00:00:00Z' WHERE sucursal_id=1");
  const { pedido_id, creado } = armarBorrador(db, 'JR', AHORA);
  assert.equal(creado, true);
  assert.deepEqual(renglones(db, pedido_id), [
    { sucursal_id: 2, sugerido: 150000, pedido: 150000 },
    { sucursal_id: 3, sugerido: 200000, pedido: 200000 },
    { sucursal_id: 4, sugerido: 150000, pedido: 150000 },
  ]);
  const p = db.prepare('SELECT * FROM resurtido_pedidos WHERE id=?').get(pedido_id);
  assert.deepEqual([p.marca, p.tipo, p.periodo, p.estado, JSON.parse(p.tiendas_atrasadas)], ['JR', 'mensual', '2026-11', 'borrador', [1]]);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM resurtido_pedido_historial WHERE accion='crear'").get().n, 1);
});

test('reparto del rollo: sobrante a la que más vende hasta su máximo, luego a la siguiente', () => {
  const tiendas = [{ sucursal_id: 1, pedido: 300000, holgura: 900000, venta: 5 },
    { sucursal_id: 2, pedido: 250000, holgura: 900000, venta: 9 }, { sucursal_id: 3, pedido: 200000, holgura: 900000, venta: 1 }];
  const r = repartirEmpaque(tiendas, 1000000);
  assert.deepEqual(r.map(x => x.pedido), [300000, 500000, 200000]);
  const tope = repartirEmpaque(tiendas.map(x => x.sucursal_id === 2 ? { ...x, holgura: 100000 } : x), 1000000);
  assert.deepEqual(tope.map(x => x.pedido), [450000, 350000, 200000]);
  const llenas = repartirEmpaque(tiendas.map(x => ({ ...x, holgura: 0 })), 1000000);
  assert.deepEqual(llenas.map(x => x.pedido), [300000, 500000, 200000]);
  assert.deepEqual(repartirEmpaque(tiendas, null).map(x => x.pedido), [300000, 250000, 200000]);
});

test('cable: empaque sugerido sin confirmar no redondea; confirmado sí, y el sobrante va a la que más vende', t => {
  const db = prepararDB(t);
  db.exec("INSERT INTO resurtido_empaques VALUES ('C', 1000000, NULL, NULL)");
  let id = armarBorrador(db, 'SOLCOR', AHORA).pedido_id;
  assert.equal(renglones(db, id, 'C').reduce((n, r) => n + r.pedido, 0), 600000);
  db.exec('DELETE FROM resurtido_pedido_renglones; DELETE FROM resurtido_pedido_historial; DELETE FROM resurtido_pedidos');
  db.exec("UPDATE resurtido_empaques SET confirmado_por='9', confirmado_en='hoy'");
  id = armarBorrador(db, 'SOLCOR', AHORA).pedido_id;
  assert.deepEqual(renglones(db, id, 'C'), [
    { sucursal_id: 1, sugerido: 150000, pedido: 150000 }, { sucursal_id: 2, sugerido: 150000, pedido: 150000 },
    { sucursal_id: 3, sugerido: 150000, pedido: 150000 }, { sucursal_id: 4, sugerido: 150000, pedido: 550000 },
  ]);
});

test('traspaso enviado sin aplicar reduce el borrador', t => {
  const db = prepararDB(t);
  traspaso(db);
  const id = armarBorrador(db, 'JR', AHORA).pedido_id;
  assert.equal(renglones(db, id).find(r => r.sucursal_id === 3).pedido, 70000);
});

test('segundo disparo y borrador a mano del mismo periodo no crean otro; con pedidos pausados no se crea', t => {
  const db = prepararDB(t);
  const primero = armarBorrador(db, 'JR', AHORA);
  const segundo = armarBorrador(db, 'JR', '2026-11-25T18:00:00Z', { actor: '984', manual: true });
  assert.deepEqual([segundo.pedido_id, segundo.creado], [primero.pedido_id, false]);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM resurtido_pedidos').get().n, 1);
  db.exec("INSERT INTO resurtido_config VALUES ('pedidos_pausados','1','restauracion','hoy')");
  assert.equal(armarBorrador(db, 'SOLCOR', AHORA), null);
  assert.throws(() => armarBorrador(db, 'SOLCOR', AHORA, { actor: '984', manual: true }), { status: 409 });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM resurtido_pedidos').get().n, 1);
});

test('ciclo diario crea el borrador de cada marca desde el día de corte, una sola vez', t => {
  const db = prepararDB(t);
  db.exec("INSERT INTO resurtido_config VALUES ('dia_corte','20','1','hoy')");
  tareasDiarias(db, AHORA);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM resurtido_pedidos').get().n, 0);
  tareasDiarias(db, '2026-11-21T08:00:00Z'); tareasDiarias(db, '2026-11-22T08:00:00Z');
  assert.deepEqual(db.prepare('SELECT marca, creado_por FROM resurtido_pedidos ORDER BY marca').all(),
    [{ marca: 'JR', creado_por: 'sistema' }, { marca: 'SOLCOR', creado_por: 'sistema' }]);
});

test('en camino suma lo pedido y aprobado que no ha llegado, sin contar dos veces lo que ya viene de CEDIS', t => {
  const db = prepararDB(t);
  db.exec(`INSERT INTO resurtido_pedidos(id,marca,tipo,periodo,llave,estado,creado_en,creado_por,aprobado_por,aprobado_en)
      VALUES (1,'JR','mensual','2026-11','JR:2026-11:mensual','aprobado','2026-11-02T18:00:00Z','sistema','9','2026-11-05T18:00:00Z');
    INSERT INTO resurtido_pedido_renglones(pedido_id,sucursal_id,clave,descripcion,sugerido,pedido) VALUES (1,3,'A','Cuerda',150000,150000)`);
  assert.equal(enCamino(db, 3, AHORA).porClave.get('A'), 150000);
  traspaso(db, { cantidad: '6.0000' });
  assert.equal(enCamino(db, 3, AHORA).porClave.get('A'), 150000);
  db.exec("UPDATE sicar_traspasos SET estado='recibido', fecha_aplicado='2026-11-11 09:00:00'");
  assert.equal(enCamino(db, 3, AHORA).porClave.get('A'), 90000);
  db.exec("UPDATE resurtido_pedidos SET aprobado_en='2026-09-20T18:00:00Z'");
  assert.equal(enCamino(db, 3, AHORA).porClave.get('A') || 0, 0, 'más de 45 días no descuenta');
});

// ---- Task 10: visto bueno por tienda, aprobación y salida al proveedor ----
const pedido10 = require('./pedido');

for (const metodo of ['cambiarRenglones', 'vistoBuenoTienda']) test(`claves repetidas: ${metodo} rechaza sin escribir cambios ni historial`, t => {
  const db = conPedido(t);
  pedido10.vistoBuenoTienda(db, 1, 3, [], '33', AHORA);
  const antes = renglon(db, 3);
  const historia = db.prepare('SELECT * FROM resurtido_pedido_historial ORDER BY id').all();
  assert.throws(() => pedido10[metodo](db, 1, 3, [{ clave: 'A', pedido: 5 }, { clave: 'A', pedido: 6 }], '33', AHORA), { status: 400 });
  assert.deepEqual(renglon(db, 3), antes);
  assert.deepEqual(db.prepare('SELECT * FROM resurtido_pedido_historial ORDER BY id').all(), historia);
});

for (const fuera of [false, true]) test(`rollos: valida el total activo al aprobar, fuera de plazo=${fuera}`, t => {
  const db = prepararDB(t);
  db.exec("INSERT INTO resurtido_empaques VALUES ('C',1000000,'9','hoy')");
  const id = armarBorrador(db, 'SOLCOR', AHORA).pedido_id;
  for (const suc of [1, 2, 3, 4]) {
    if (fuera && suc === 1) continue;
    pedido10.vistoBuenoTienda(db, id, suc, suc === 1 ? [{ clave: 'C', pedido: 14 }] : [], '9', AHORA);
  }
  const fecha = fuera ? '2026-11-23T18:00:00Z' : AHORA;
  assert.throws(() => pedido10.aprobar(db, id, '9', fecha), e => e.status === 409 && /C/.test(e.message) && /100/.test(e.message));
  assert.equal(db.prepare('SELECT estado FROM resurtido_pedidos WHERE id=?').get(id).estado, 'en_revision');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM resurtido_pedido_renglones WHERE estado<>'activo'").get().n, 0);
  db.exec('UPDATE resurtido_empaques SET confirmado_por=NULL');
  assert.equal(pedido10.aprobar(db, id, '9', fecha).ok, true);
});
function conPedido(t, { creado = '2026-11-19T15:00:00Z' } = {}) {
  const db = prepararDB(t);
  db.prepare(`INSERT INTO resurtido_pedidos(id,marca,tipo,periodo,llave,estado,creado_en,creado_por,tiendas_atrasadas)
    VALUES (1,'JR','mensual','2026-11','JR:2026-11:mensual','borrador',?,'sistema','[4]')`).run(creado);
  for (const [suc, clave, sugerido] of [[1, 'A', 30000], [1, 'B', 10000], [2, 'A', 40000], [3, 'A', 40000]]) {
    db.prepare(`INSERT INTO resurtido_pedido_renglones(pedido_id,sucursal_id,clave,descripcion,sugerido,pedido)
      VALUES (1,?,?,?,?,?)`).run(suc, clave, clave === 'A' ? 'Cuerda 1a' : 'Funda', sugerido, sugerido);
  }
  return db;
}
const renglon = (db, suc, clave = 'A') => db.prepare('SELECT * FROM resurtido_pedido_renglones WHERE sucursal_id=? AND clave=?').get(suc, clave);

test('subir más de 2× lo sugerido exige motivo y queda marcado; todo cambio va al historial', t => {
  const db = conPedido(t);
  assert.throws(() => pedido10.cambiarRenglones(db, 1, 3, [{ clave: 'A', pedido: 20 }], '33', AHORA), { status: 400 });
  assert.equal(renglon(db, 3).pedido, 40000);
  pedido10.cambiarRenglones(db, 1, 3, [{ clave: 'A', pedido: 20, motivo: 'Escuela pidió 12' }], '33', AHORA);
  assert.deepEqual([renglon(db, 3).pedido, renglon(db, 3).marcado, renglon(db, 3).motivo_cambio], [200000, 1, 'Escuela pidió 12']);
  pedido10.cambiarRenglones(db, 1, 3, [{ clave: 'A', pedido: 6 }], '33', AHORA);
  assert.deepEqual([renglon(db, 3).pedido, renglon(db, 3).marcado], [60000, 0]);
  assert.deepEqual(db.prepare("SELECT antes, despues, actor FROM resurtido_pedido_historial WHERE accion='cambiar' ORDER BY id").all(),
    [{ antes: 40000, despues: 200000, actor: '33' }, { antes: 200000, despues: 60000, actor: '33' }]);
  for (const malo of [[{ clave: 'A', pedido: -1 }], [{ clave: 'A', pedido: 1.5 }], [{ clave: 'A', pedido: '3' }], [{ clave: 'ZZ', pedido: 1 }], 'x']) {
    assert.throws(() => pedido10.cambiarRenglones(db, 1, 3, malo, '33', AHORA), { status: 400 });
  }
});

test('visto bueno por tienda; cambiar después lo anula; aprobar exige todos los vistos buenos', t => {
  const db = conPedido(t);
  pedido10.vistoBuenoTienda(db, 1, 1, [], '11', AHORA);
  pedido10.vistoBuenoTienda(db, 1, 2, [{ clave: 'A', pedido: 3 }], '22', AHORA);
  assert.equal(renglon(db, 2).visto_bueno_por, '22'); assert.equal(renglon(db, 1, 'B').visto_bueno_por, '11');
  assert.equal(db.prepare('SELECT estado FROM resurtido_pedidos').get().estado, 'en_revision');
  assert.throws(() => pedido10.aprobar(db, 1, '9', AHORA), { status: 409 });
  pedido10.vistoBuenoTienda(db, 1, 3, [], '33', AHORA);
  pedido10.cambiarRenglones(db, 1, 2, [{ clave: 'A', pedido: 2 }], '22', AHORA);
  assert.equal(renglon(db, 2).visto_bueno_por, null, 'cambiar después del visto bueno lo anula');
  assert.throws(() => pedido10.aprobar(db, 1, '9', AHORA), { status: 409 });
  assert.throws(() => pedido10.vistoBuenoTienda(db, 1, 4, [], '44', AHORA), { status: 404 });
  pedido10.vistoBuenoTienda(db, 1, 2, [], '22', AHORA);
  const r = pedido10.aprobar(db, 1, '9', AHORA);
  assert.deepEqual(r.fuera_de_tiempo, []);
  const p = db.prepare('SELECT * FROM resurtido_pedidos').get();
  assert.deepEqual([p.estado, p.aprobado_por, p.aprobado_en], ['aprobado', '9', AHORA]);
  assert.throws(() => pedido10.cambiarRenglones(db, 1, 3, [{ clave: 'A', pedido: 1 }], '33', AHORA), { status: 409 });
  assert.throws(() => pedido10.vistoBuenoTienda(db, 1, 3, [], '33', AHORA), { status: 409 });
  assert.throws(() => pedido10.aprobar(db, 1, '9', AHORA), { status: 409 });
});

test('pasado el plazo se aprueba con las tiendas listas y las demás quedan fuera de tiempo', t => {
  const db = conPedido(t, { creado: '2026-11-15T15:00:00Z' });
  pedido10.vistoBuenoTienda(db, 1, 3, [], '33', AHORA);
  const r = pedido10.aprobar(db, 1, '9', AHORA);
  assert.deepEqual(r.fuera_de_tiempo, [1, 2]);
  assert.deepEqual(db.prepare('SELECT sucursal_id, estado FROM resurtido_pedido_renglones ORDER BY sucursal_id, clave').all().map(x => x.estado),
    ['fuera_de_tiempo', 'fuera_de_tiempo', 'fuera_de_tiempo', 'activo']);
  const lista = pedido10.listaProveedor(db, 1);
  assert.deepEqual(lista.renglones, [{ clave: 'A', descripcion: 'Cuerda 1a', total: 40000, empaque: null,
    por_tienda: [{ sucursal_id: 3, pedido: 40000 }] }]);
  assert.deepEqual([lista.marca, lista.tiendas_atrasadas, lista.tiendas_fuera_de_tiempo], ['JR', [4], [1, 2]]);
});

test('lista al proveedor agrupa por clave y omite ceros; envío solo lo registra una persona, después de aprobar', t => {
  const db = conPedido(t);
  assert.throws(() => pedido10.registrarEnvio(db, 1, { referencia: 'WhatsApp' }, '9', AHORA), { status: 409 });
  pedido10.vistoBuenoTienda(db, 1, 1, [{ clave: 'B', pedido: 0 }], '11', AHORA);
  for (const suc of [2, 3]) pedido10.vistoBuenoTienda(db, 1, suc, [], String(suc), AHORA);
  pedido10.aprobar(db, 1, '9', AHORA);
  const lista = pedido10.listaProveedor(db, 1);
  assert.deepEqual(lista.renglones.map(r => [r.clave, r.total, r.por_tienda.map(x => x.sucursal_id)]), [['A', 110000, [1, 2, 3]]]);
  assert.deepEqual(pedido10.hojaReparto(db, 1, 2), [{ sucursal_id: 2, renglones: [{ clave: 'A', descripcion: 'Cuerda 1a', pedido: 40000, llegado: 0 }] }]);
  assert.equal(pedido10.hojaReparto(db, 1, null).length, 3);
  assert.throws(() => pedido10.registrarEnvio(db, 1, { referencia: 'x'.repeat(201) }, '9', AHORA), { status: 400 });
  pedido10.registrarEnvio(db, 1, { referencia: 'WhatsApp a Juan' }, '9', AHORA);
  const p = db.prepare('SELECT * FROM resurtido_pedidos').get();
  assert.deepEqual([p.estado, p.enviado_por, p.referencia_envio], ['enviado', '9', 'WhatsApp a Juan']);
  assert.throws(() => pedido10.registrarEnvio(db, 1, {}, '9', AHORA), { status: 409 });
});

// ---- Task 11: cierre por llegadas y compra candidata ----
function aprobado(t, { aprobado_en = '2026-11-05T18:00:00Z', enviado_en = '2026-11-06T18:00:00Z' } = {}) {
  const db = prepararDB(t);
  db.prepare(`INSERT INTO resurtido_pedidos(id,marca,tipo,periodo,llave,estado,creado_en,creado_por,aprobado_por,aprobado_en,enviado_por,enviado_en)
    VALUES (1,'JR','mensual','2026-11','JR:2026-11:mensual','enviado','2026-11-02T18:00:00Z','sistema','9',?,'9',?)`).run(aprobado_en, enviado_en);
  db.exec(`INSERT INTO resurtido_pedido_renglones(pedido_id,sucursal_id,clave,descripcion,sugerido,pedido) VALUES
    (1,3,'A','Cuerda 1a',150000,150000),(1,1,'A','Cuerda 1a',50000,50000)`);
  return db;
}
const llegado = db => db.prepare('SELECT sucursal_id, llegado FROM resurtido_pedido_renglones WHERE pedido_id=1 ORDER BY sucursal_id').all();

test('llegada parcial deja diferencia; cancelado y anterior a la aprobación no cuentan', t => {
  const db = aprobado(t);
  traspaso(db, { estado: 'recibido', aplicado: '2026-11-10 12:00:00', cantidad: '6.0000' });
  traspaso(db, { estado: 'cancelado', fecha: '2026-11-11 10:00:00', cantidad: '9.0000' });
  traspaso(db, { estado: 'recibido', fecha: '2026-11-04 10:00:00', aplicado: '2026-11-04 12:00:00', cantidad: '4.0000' });
  traspaso(db, { origen: '1', estado: 'recibido', aplicado: '2026-11-10 12:00:00', cantidad: '3.0000' });
  pedido10.revisarLlegadas(db, AHORA);
  assert.deepEqual(llegado(db), [{ sucursal_id: 1, llegado: 0 }, { sucursal_id: 3, llegado: 60000 }]);
  assert.equal(db.prepare('SELECT estado FROM resurtido_pedidos').get().estado, 'enviado');
});

test('todo llegado pasa a surtido sin contar de más; dos pedidos de la misma clave se llenan en orden', t => {
  const db = aprobado(t);
  db.exec(`INSERT INTO resurtido_pedidos(id,marca,tipo,periodo,llave,estado,creado_en,creado_por,aprobado_por,aprobado_en)
      VALUES (2,'JR','extra','2026-11','JR:2026-11:extra:7','aprobado','2026-11-08T18:00:00Z','33','9','2026-11-08T18:00:00Z');
    INSERT INTO resurtido_pedido_renglones(pedido_id,sucursal_id,clave,descripcion,sugerido,pedido) VALUES (2,3,'A','Cuerda 1a',30000,30000)`);
  traspaso(db, { estado: 'recibido', aplicado: '2026-11-10 12:00:00', cantidad: '17.0000' });
  traspaso(db, { destino: '1', suc: 1, estado: 'recibido', aplicado: '2026-11-10 12:00:00', cantidad: '5.0000' });
  pedido10.revisarLlegadas(db, AHORA);
  assert.deepEqual(llegado(db), [{ sucursal_id: 1, llegado: 50000 }, { sucursal_id: 3, llegado: 150000 }]);
  assert.equal(db.prepare('SELECT llegado FROM resurtido_pedido_renglones WHERE pedido_id=2').get().llegado, 20000);
  assert.deepEqual(db.prepare('SELECT id, estado FROM resurtido_pedidos ORDER BY id').all(),
    [{ id: 1, estado: 'surtido' }, { id: 2, estado: 'aprobado' }]);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM resurtido_pedido_historial WHERE accion='surtido'").get().n, 1);
});

test('a los 45 días el pedido se cierra con el faltante a la vista', t => {
  const db = aprobado(t, { aprobado_en: '2026-10-01T18:00:00Z', enviado_en: '2026-10-02T18:00:00Z' });
  traspaso(db, { estado: 'recibido', fecha: '2026-10-10 10:00:00', aplicado: '2026-10-10 12:00:00', cantidad: '5.0000' });
  pedido10.revisarLlegadas(db, AHORA);
  const p = db.prepare('SELECT estado, cerrado_en FROM resurtido_pedidos').get();
  assert.deepEqual([p.estado, p.cerrado_en], ['surtido', AHORA]);
  assert.deepEqual(llegado(db), [{ sucursal_id: 1, llegado: 0 }, { sucursal_id: 3, llegado: 50000 }]);
  traspaso(db, { estado: 'recibido', fecha: '2026-11-19 10:00:00', aplicado: '2026-11-19 13:00:00', cantidad: '5.0000' });
  pedido10.revisarLlegadas(db, '2026-11-20T18:00:00Z');
  assert.deepEqual(llegado(db), [{ sucursal_id: 1, llegado: 0 }, { sucursal_id: 3, llegado: 50000 }], 'cerrado no recibe más');
});

test('compra de CEDIS: solo se propone la del proveedor de la marca posterior al envío y una persona la confirma', t => {
  const db = aprobado(t);
  db.prepare('INSERT INTO sicar_tiendas(sucursal_id) VALUES (6)').run();
  db.exec(`INSERT INTO sicar_articulos VALUES (6,'a6','A','Cuerda 1a',NULL,'JR','hoy'), (6,'z6','Z','Cuerda sustituta',NULL,'JR','hoy')`);
  const compra = (com_id, pro_id, fecha) => {
    db.prepare("INSERT INTO sicar_compras VALUES (6,?,?,?,?,'','vigente',NULL,1000,'hoy','hoy')")
      .run(com_id, fecha, pro_id, `C${com_id}`);
    db.prepare("INSERT INTO sicar_compras_detalle VALUES (6,?,0,'a6','10.0000',10000,0,0,0)").run(com_id);
    db.prepare("INSERT INTO sicar_compras_detalle VALUES (6,?,1,'z6','2.0000',10000,0,0,0)").run(com_id);
  };
  compra('10', '55', '2026-11-08 10:00:00'); compra('11', '77', '2026-11-08 10:00:00'); compra('12', '55', '2026-11-01 10:00:00');
  assert.deepEqual(pedido10.candidatasCompra(db, 1).candidatas, []);
  db.exec("INSERT INTO resurtido_config VALUES ('proveedor_jr','55','1','hoy')");
  const r = pedido10.candidatasCompra(db, 1);
  assert.deepEqual(r.candidatas.map(c => [c.com_id, c.claves_del_pedido, c.por_aclarar]), [['10', ['A'], ['Z']]]);
  assert.throws(() => pedido10.confirmarCompra(db, 1, '11', '9', AHORA), { status: 409 });
  pedido10.confirmarCompra(db, 1, '10', '9', AHORA);
  const p = db.prepare('SELECT compra_com_id, compra_confirmada_por FROM resurtido_pedidos').get();
  assert.deepEqual([p.compra_com_id, p.compra_confirmada_por], ['10', '9']);
  assert.throws(() => pedido10.confirmarCompra(db, 1, '10', '9', AHORA), { status: 409 });
});

test('el ciclo diario también revisa lo que llegó', t => {
  const db = aprobado(t);
  traspaso(db, { estado: 'recibido', aplicado: '2026-11-10 12:00:00', cantidad: '6.0000' });
  tareasDiarias(db, AHORA);
  assert.deepEqual(llegado(db), [{ sucursal_id: 1, llegado: 0 }, { sucursal_id: 3, llegado: 60000 }]);
});
