const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { crearRepositorioSicar } = require('../sicarRepositorio');
const { recalcular } = require('./servicio');
const { explicar } = require('./explicacion');
const { calcularMinMax } = require('./calculo');
const { VALORES_INICIALES, INDICES_SICAR } = require('./config');
const SICAR = { JR: [0.9, 1, 1.1, 1, 1, 1.1, 0.9, 0.9, 1.1, 1, 1, 1],
  SOLCOR: [0.9, 0.9, 1.1, 0.8, 0.6, 1.2, 1.1, 0.9, 1.1, 1.3, 1.2, 1] };

function prepararDB(t, ahora, claves = 5) {
  const db = new Database(':memory:'); crearRepositorioSicar(db); t.after(() => db.close());
  db.exec('INSERT INTO sicar_tiendas(sucursal_id) VALUES (3)');
  for (const marca of ['JR', 'SOLCOR']) for (let i = 0; i < claves; i++) {
    const clave = `${marca}${i}`;
    db.prepare('INSERT INTO sicar_articulos VALUES (3,?,?,?,NULL,?,?)').run(clave, clave, clave, marca, ahora);
    db.prepare('INSERT INTO sicar_existencias VALUES (3,?,100000,?)').run(clave, ahora);
    for (const anio of [2025, 2026]) for (let mes = 1; mes <= 12; mes++) {
      const id = `${clave}-${anio}-${mes}`, fecha = `${anio}-${String(mes).padStart(2, '0')}-01T12:00:00`;
      if (fecha >= ahora) continue;
      db.prepare("INSERT INTO sicar_ventas_mostrador VALUES (3,?,?,'vigente',0,'hoy')").run(id, fecha);
      db.prepare('INSERT INTO sicar_detalles_mostrador VALUES (3,?,0,?,?,0,0)').run(id, clave, mes === 1 ? '3' : '1');
    }
  }
  return db;
}

test('constantes SICAR contienen los 24 valores congelados', () => {
  assert.deepEqual(INDICES_SICAR, SICAR);
  assert.ok(Object.isFrozen(INDICES_SICAR));
  assert.ok(Object.values(INDICES_SICAR).every(Object.isFrozen));
});

test('solo 2025 completo aplica SICAR: noviembre JR 1.0 y SOLCOR 1.1 en explicación y cálculo', t => {
  const ahora = '2026-11-18T18:00:00Z', db = prepararDB(t, ahora);
  recalcular(db, ahora);
  for (const marca of ['JR', 'SOLCOR']) {
    const r = explicar(db, 3, `${marca}0`, ahora);
    assert.equal(r.temporada_origen, 'sicar');
    assert.deepEqual(r.indices, SICAR[marca]);
    assert.equal(r.factor, marca === 'JR' ? 1 : 1.1);
    const ventasPorDia = new Map([['2025-12-01', 10000],
      ...Array.from({ length: 11 }, (_, i) => [`2026-${String(i + 1).padStart(2, '0')}-01`, i === 0 ? 20000 : 10000])]);
    const esperado = calcularMinMax({ ventasPorDia, diasEnCero: new Set(), desde: r.desde, hasta: r.hasta,
      indices: SICAR[marca], mesCalculo: 11, config: VALORES_INICIALES });
    const guardado = db.prepare('SELECT * FROM resurtido_minmax WHERE clave=?').get(`${marca}0`);
    assert.equal(guardado.minimo, esperado.minimo);
    assert.equal(guardado.maximo, esperado.maximo);
    assert.equal(guardado.venta_diaria_diezmilesimas, esperado.venta_diaria);
  }
});

test('enero 2027 usa 2025 y 2026 completos y cambia automáticamente a índices calculados', t => {
  const ahora = '2027-01-01T18:00:00Z', db = prepararDB(t, ahora);
  recalcular(db, ahora);
  const r = explicar(db, 3, 'JR0', ahora);
  assert.equal(r.temporada_origen, 'calculada');
  assert.equal(r.temporada_motivo, null);
  assert.deepEqual(r.indices, [1.5, ...Array(11).fill(0.9)]);
  const esperado = calcularMinMax({ ventasPorDia: new Map(Array.from({ length: 12 }, (_, i) =>
    [`2026-${String(i + 1).padStart(2, '0')}-01`, i === 0 ? 20000 : 10000])),
  diasEnCero: new Set(), desde: r.desde, hasta: r.hasta, indices: [1.5, ...Array(11).fill(6 / 7)],
  mesCalculo: 1, config: VALORES_INICIALES });
  assert.equal(db.prepare("SELECT minimo FROM resurtido_minmax WHERE clave='JR0'").get().minimo, esperado.minimo);
});

test('dos años completos con menos de cinco claves mantienen respaldo SICAR', t => {
  const ahora = '2027-01-01T18:00:00Z', db = prepararDB(t, ahora, 4);
  const r = explicar(db, 3, 'SOLCOR0', ahora);
  assert.equal(r.temporada_origen, 'sicar');
  assert.equal(r.temporada_motivo, 'menos_de_cinco_claves');
  assert.deepEqual(r.indices, SICAR.SOLCOR);
});
