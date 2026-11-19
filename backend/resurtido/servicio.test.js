const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { crearRepositorioSicar } = require('../sicarRepositorio');
const { recalcular, iniciarCicloResurtido, completarMeses, demoraHastaLasDos } = require('./servicio');
const AHORA = '2026-11-18T18:00:00Z';
test('recálculo limita demanda del ticket sin recortar la existencia reconstruida', t => {
  const db = prepararDB(t);
  db.exec(`INSERT INTO sicar_ventas_mostrador VALUES (3,'v','2026-11-17T12:00:00','vigente',0,'hoy');
    INSERT INTO sicar_detalles_mostrador VALUES (3,'v',0,'0','73',0,0)`);
  recalcular(db, AHORA);
  const r = db.prepare('SELECT * FROM resurtido_minmax WHERE sucursal_id=3').get();
  const indices = [0.9, 1, 1.1, 1, 1, 1.1, 0.9, 0.9, 1.1, 1, 1, 1];
  const suma = Array.from({ length: 365 }, (_, i) => new Date(Date.UTC(2025, 10, 18) + i * 86400000))
    .reduce((total, dia) => total + indices[dia.getUTCMonth()], 0);
  assert.equal(r.venta_diaria_diezmilesimas, Math.round(60000 / suma));
  assert.equal(db.prepare("SELECT piezas_diezmilesimas n FROM resurtido_existencia_diaria WHERE sucursal_id=3 AND dia='2026-11-17'").get().n, 830000);
});

function prepararDB(t, claves = 1, tiendas = [1, 3, 6, 7]) {
  const db = new Database(':memory:'); crearRepositorioSicar(db); t.after(() => db.close());
  const articulo = db.prepare("INSERT INTO sicar_articulos VALUES (?, ?, ?, 'Cable', NULL, 'JR', ?)");
  const existencia = db.prepare('INSERT INTO sicar_existencias VALUES (?,?,100000,?)');
  db.transaction(() => {
    for (const suc of tiendas) {
      db.prepare('INSERT INTO sicar_tiendas(sucursal_id,ultima_recepcion) VALUES (?,?)').run(suc, AHORA);
      for (let i = 0; i < claves; i++) { articulo.run(suc, String(i), `A${i}`, AHORA); existencia.run(suc, String(i), AHORA); }
    }
  })();
  return db;
}

test('ciclo procesa cuatro tiendas en cuatro turnos sin solapar vueltas y guarda lo mismo que recalcular', t => {
  const db = prepararDB(t, 2, [1, 2, 3, 4]), referencia = prepararDB(t, 2, [1, 2, 3, 4]);
  for (const base of [db, referencia]) base.exec(`
    INSERT INTO sicar_ventas_mostrador VALUES (3,'v','2026-11-17T12:00:00','vigente',0,'hoy');
    INSERT INTO sicar_detalles_mostrador VALUES (3,'v',0,'0','73',0,0)`);
  recalcular(referencia, new Date(AHORA).toISOString());
  const timers = [], turnos = [];
  const detener = iniciarCicloResurtido(db, { reloj: () => new Date(AHORA),
    programar: (fn, ms) => { timers.push({ fn, ms }); return { unref() {} }; }, cancelar() {},
    ceder: fn => { turnos.push(fn); return { unref() {} }; }, cancelarTurno() {} });
  t.after(detener);
  timers[0].fn();
  for (let tienda = 1; tienda <= 4; tienda++) {
    assert.deepEqual(db.prepare('SELECT DISTINCT sucursal_id FROM resurtido_minmax ORDER BY sucursal_id').all(),
      Array.from({ length: tienda }, (_, i) => ({ sucursal_id: i + 1 })));
    if (tienda < 4) {
      assert.equal(timers.length, 1);
      timers[0].fn(); // Un disparo repetido no debe iniciar otra vuelta.
      assert.equal(turnos.length, 1);
      turnos.shift()();
    }
  }
  assert.equal(turnos.length, 0); assert.equal(timers.length, 2);
  for (const tabla of ['resurtido_minmax', 'resurtido_existencia_diaria']) {
    assert.deepEqual(db.prepare(`SELECT * FROM ${tabla} ORDER BY 1,2,3`).all(),
      referencia.prepare(`SELECT * FROM ${tabla} ORDER BY 1,2,3`).all());
  }
});

test('detener a media vuelta cancela el turno pendiente y no calcula ni programa más tiendas', t => {
  const db = prepararDB(t, 1, [1, 2, 3, 4]), timers = [], turnos = []; let cancelados = 0;
  const detener = iniciarCicloResurtido(db, { reloj: () => new Date(AHORA),
    programar: fn => { timers.push(fn); return { unref() {} }; }, cancelar() {},
    ceder: fn => { turnos.push(fn); return { unref() {} }; }, cancelarTurno() { cancelados++; } });
  t.after(detener);
  timers[0](); detener();
  assert.equal(db.prepare('SELECT COUNT(*) n FROM resurtido_minmax').get().n, 1);
  assert.equal(cancelados, 1);
  turnos[0](); timers[0](); // Incluso si ya estaba encolado, no debe escribir.
  assert.equal(db.prepare('SELECT COUNT(*) n FROM resurtido_minmax').get().n, 1);
  assert.equal(timers.length, 1); assert.equal(turnos.length, 1);
});

test('recalcula dos tiendas, guarda calidad aproximada y excluye CEDIS/Innotec', t => {
  const db = prepararDB(t), r = recalcular(db, AHORA);
  assert.deepEqual(r.tiendas.filter(s => !s.atrasada).map(s => s.sucursal_id), [1, 3]);
  assert.deepEqual(db.prepare('SELECT sucursal_id,calidad FROM resurtido_minmax ORDER BY sucursal_id').all(), [
    { sucursal_id: 1, calidad: 'aproximada' }, { sucursal_id: 3, calidad: 'aproximada' },
  ]);
  const n = db.prepare('SELECT COUNT(*) n FROM resurtido_existencia_diaria').get().n;
  recalcular(db, AHORA); assert.equal(db.prepare('SELECT COUNT(*) n FROM resurtido_existencia_diaria').get().n, n);
});

test('recálculo borra mínimos de claves sin existencia y conserva sus ajustes', t => {
  const db = prepararDB(t, 2);
  recalcular(db, AHORA);
  db.exec("DELETE FROM sicar_existencias WHERE sucursal_id=3 AND art_id='0'");
  db.prepare('INSERT INTO resurtido_ajustes VALUES (3,?,?,?,?,?,?)').run('A0', 10000, 20000, 'Exhibición', '1', AHORA);
  recalcular(db, AHORA);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM resurtido_minmax WHERE sucursal_id=3 AND clave='A0'").get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM resurtido_ajustes').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM resurtido_minmax WHERE sucursal_id=1').get().n, 2);
});

test('existencias atrasadas no recalculan aunque ultima_recepcion esté al día', t => {
  const db = prepararDB(t); recalcular(db, AHORA);
  db.exec("UPDATE sicar_existencias SET actualizado_en='2026-11-01T18:00:00Z' WHERE sucursal_id=3");
  const r = recalcular(db, '2026-11-19T18:00:00Z');
  assert.equal(r.tiendas.find(s => s.sucursal_id === 3)?.atrasada, true);
  assert.equal(db.prepare('SELECT calculado_en FROM resurtido_minmax WHERE sucursal_id=3').get().calculado_en, AHORA);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM resurtido_existencia_diaria WHERE sucursal_id=3 AND dia='2026-11-19'").get().n, 0);
});

test('ventana enteramente fotografiada se marca observada', t => {
  const db = prepararDB(t);
  db.exec("INSERT INTO resurtido_config VALUES ('dias_historia','2','1','hoy')");
  for (const dia of ['2026-11-16', '2026-11-17']) {
    db.prepare("INSERT INTO resurtido_existencia_diaria VALUES (3,'A0',?,100000,'foto')").run(dia);
  }
  recalcular(db, AHORA);
  assert.equal(db.prepare('SELECT calidad FROM resurtido_minmax WHERE sucursal_id=3').get()?.calidad, 'observada');
});

test('cancelación posterior cambia venta diaria en el recálculo', t => {
  const db = prepararDB(t);
  db.exec(`INSERT INTO sicar_ventas_mostrador VALUES (3,'v','2026-11-17T12:00:00','vigente',0,'hoy');
    INSERT INTO sicar_detalles_mostrador VALUES (3,'v',0,'0','73.0000',0,0)`);
  recalcular(db, AHORA);
  assert.ok(db.prepare('SELECT venta_diaria_diezmilesimas n FROM resurtido_minmax WHERE sucursal_id=3').get()?.n > 0);
  db.exec("UPDATE sicar_ventas_mostrador SET estado='cancelada'"); recalcular(db, AHORA);
  assert.equal(db.prepare('SELECT venta_diaria_diezmilesimas n FROM resurtido_minmax WHERE sucursal_id=3').get().n, 0);
});

test('completa meses sin venta sin inventar años previos al primer mes conocido', () => {
  const r = completarMeses(new Map([['A', new Map([['2024-07', 10], ['2025-10', 20]])]]), '2026-11');
  assert.equal(r.get('A').get('2025-01'), 0);
  assert.equal(r.get('A').has('2024-01'), false);
  assert.equal(r.get('A').has('2026-11'), false);
});

test('ciclo único por conexión espera un minuto al arrancar, programa hora local y libera timer', t => {
  const db = prepararDB(t), pendientes = [], turnos = []; let libres = 0, cancelados = 0;
  const opciones = { reloj: () => new Date('2026-11-18T07:00:00Z'),
    programar: (fn, ms) => { pendientes.push({ fn, ms }); return { unref() { libres++; } }; },
    cancelar: () => { cancelados++; }, ceder: fn => { turnos.push(fn); }, cancelarTurno() {} };
  const detener = iniciarCicloResurtido(db, opciones);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM resurtido_minmax').get().n, 0);
  assert.equal(iniciarCicloResurtido(db, opciones), detener);
  assert.equal(pendientes.length, 1); assert.equal(pendientes[0].ms, 60000);
  pendientes[0].fn();
  while (turnos.length) turnos.shift()();
  assert.ok(db.prepare('SELECT COUNT(*) n FROM resurtido_minmax').get().n > 0);
  assert.equal(pendientes.length, 2); assert.equal(pendientes[1].ms, 3600000); assert.equal(libres, 2);
  detener(); assert.equal(cancelados, 1);
  assert.equal(demoraHastaLasDos(new Date('2026-11-18T08:00:00Z')), 86400000);
});

test('500 claves × 4 tiendas × 365 días se recalculan en menos de diez segundos', t => {
  const db = prepararDB(t, 500, [1, 2, 3, 4]);
  const r = recalcular(db, AHORA);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM resurtido_minmax').get().n, 2000);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM resurtido_existencia_diaria WHERE origen='reconstruida'").get().n, 730000);
  assert.ok(r.ms < 10000, `Duración ${r.ms} ms`); t.diagnostic(`2000 claves/730000 días: ${r.ms} ms`);
});
