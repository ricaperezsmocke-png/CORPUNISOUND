const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { crearRepositorioSicar } = require('../sicarRepositorio');
const AHORA = '2026-11-05T12:00:00.000Z';
const CORTE = '2026-11-05T11:00:00.000Z';

function prepararDB(t) {
  const sqlite = new Database(':memory:');
  crearRepositorioSicar(sqlite);
  sqlite.exec('INSERT INTO sicar_tiendas(sucursal_id) VALUES (1), (6)');
  t.after(() => sqlite.close());
  return sqlite;
}

function articulo(sqlite, id, clave, piezas, fecha = CORTE, tienda = 1) {
  sqlite.prepare(`INSERT INTO sicar_articulos(sucursal_id, art_id, clave, descripcion, actualizado_en)
    VALUES (?, ?, ?, 'Artículo', ?)`).run(tienda, id, clave, fecha);
  if (piezas !== null) sqlite.prepare('INSERT INTO sicar_existencias VALUES (?, ?, ?, ?)').run(tienda, id, piezas, fecha);
}

test('configuración inicial vive en código; las sobrescrituras no modifican los iniciales', t => {
  const sqlite = prepararDB(t);
  const { VALORES_INICIALES, leerConfig } = require('./config');
  const iniciales = {
    dias_revisado_caduca: 15, dias_posponer_maximo: 30, dias_transito_alarma: 7,
    dias_traslado: 45, dias_margen_75: 60, dias_margen_50: 90, dias_liquidacion: 120,
    ganancia_75_porcentaje: 75, ganancia_50_porcentaje: 50, ganancia_liquidacion_porcentaje: 0,
    semanas_ventas: 8, semanas_informativas: 4, multiplicador_destino: 2,
    semanas_con_ventas: 2, semanas_cobertura_destino: 4, semanas_reserva_origen: 2,
    dias_datos_atrasados: 2, horas_foto_vieja: 24,
  };
  assert.deepEqual(VALORES_INICIALES, iniciales);
  assert.deepEqual(sqlite.prepare('SELECT * FROM seguimiento_config').all(), []);
  assert.deepEqual(leerConfig(sqlite), iniciales);
  sqlite.exec("INSERT INTO seguimiento_config(clave, valor) VALUES ('dias_traslado', '46')");
  assert.deepEqual(leerConfig(sqlite), { ...iniciales, dias_traslado: 46 });
  assert.equal(VALORES_INICIALES.dias_traslado, 45);
  crearRepositorioSicar(sqlite);
  assert.equal(leerConfig(sqlite).dias_traslado, 46);
});

test('foto excluye claves repetidas, sin clave y negativas; une solo el catálogo de esa tienda', t => {
  const sqlite = prepararDB(t);
  articulo(sqlite, '1', 'A', 12500n);
  articulo(sqlite, '1', 'OTRA', 90000n, CORTE, 6);
  articulo(sqlite, '2', 'DUP', 10000n);
  articulo(sqlite, '3', 'DUP', null);
  articulo(sqlite, '4', null, 10000n);
  articulo(sqlite, '5', '', 10000n);
  articulo(sqlite, '6', 'NEG', -1n);
  articulo(sqlite, '7', 'CERO', 0n);
  articulo(sqlite, '123456789012345678901234567890', 'GRANDE', 9007199254740993n);
  sqlite.prepare('INSERT INTO sicar_existencias VALUES (1, ?, ?, ?)').run('sin-catalogo', 1n, CORTE);
  const { revisarFoto, incorporar } = require('./incorporar');
  const foto = revisarFoto(sqlite, '1', AHORA);
  assert.equal(foto.corte, CORTE);
  assert.equal(foto.vieja, false);
  assert.deepEqual(foto.claves, [
    { clave: 'A', piezas_diezmilesimas: '12500' },
    { clave: 'CERO', piezas_diezmilesimas: '0' },
    { clave: 'GRANDE', piezas_diezmilesimas: '9007199254740993' },
  ]);
  assert.equal(foto.problemas.filter(p => p.motivo === 'sin_clave').length, 3);
  assert.ok(foto.problemas.some(p => p.clave === 'DUP' && p.motivo === 'clave_repetida'));
  assert.ok(foto.problemas.some(p => p.clave === 'NEG' && p.motivo === 'existencia_negativa'));
  incorporar(sqlite, { sucursal_id: '1', actor: '9', ahora: AHORA });
  assert.deepEqual(sqlite.prepare('SELECT * FROM seguimiento_tiendas').all(), [
    { sucursal_id: 1, corte: CORTE, actor: '9', fecha: AHORA },
  ]);
  assert.deepEqual(sqlite.prepare('SELECT clave, piezas_diezmilesimas FROM seguimiento_foto ORDER BY clave').all(), foto.claves);
  assert.deepEqual(sqlite.prepare('SELECT clave, motivo FROM seguimiento_foto_problemas ORDER BY rowid').all(), foto.problemas);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM seguimiento_foto WHERE typeof(piezas_diezmilesimas) != 'text'").get().n, 0);
  assert.throws(() => incorporar(sqlite, { sucursal_id: 1, actor: '9', ahora: AHORA }), { status: 409 });
});

test('corte es el máximo recibido; 24 h se acepta, más de 24 h se rechaza sin escrituras', t => {
  const sqlite = prepararDB(t);
  const { revisarFoto, incorporar } = require('./incorporar');
  articulo(sqlite, '1', 'A', 10000n, '2026-11-04T11:00:00.000Z');
  assert.equal(revisarFoto(sqlite, 1, AHORA).vieja, true);
  assert.throws(() => incorporar(sqlite, { sucursal_id: 1, actor: '9', ahora: AHORA }), { status: 409 });
  assert.equal(sqlite.prepare('SELECT count(*) n FROM seguimiento_tiendas').get().n, 0);
  articulo(sqlite, '2', 'B', 10000n, '2026-11-04T12:00:00.000Z');
  assert.equal(revisarFoto(sqlite, 1, AHORA).vieja, false);
  incorporar(sqlite, { sucursal_id: 1, actor: '9', ahora: AHORA });
  assert.equal(sqlite.prepare('SELECT corte FROM seguimiento_tiendas').get().corte, '2026-11-04T12:00:00.000Z');
});

test('sin tienda con agente es 400; sin existencias no hay corte válido para incorporar', t => {
  const sqlite = prepararDB(t);
  const { incorporar } = require('./incorporar');
  assert.throws(() => incorporar(sqlite, { sucursal_id: 2, actor: '9', ahora: AHORA }), { status: 400 });
  assert.throws(() => incorporar(sqlite, { sucursal_id: 1, actor: '9', ahora: AHORA }), { status: 409 });
});

test('un fallo al guardar problemas revierte tienda y foto juntas', t => {
  const sqlite = prepararDB(t);
  articulo(sqlite, '1', 'A', 10000n);
  articulo(sqlite, '2', 'NEG', -1n);
  sqlite.exec(`CREATE TRIGGER fallo BEFORE INSERT ON seguimiento_foto_problemas
    BEGIN SELECT RAISE(ABORT, 'fallo simulado'); END`);
  const { incorporar } = require('./incorporar');
  assert.throws(() => incorporar(sqlite, { sucursal_id: 1, actor: '9', ahora: AHORA }), /fallo simulado/);
  for (const tabla of ['seguimiento_tiendas', 'seguimiento_foto', 'seguimiento_foto_problemas']) {
    assert.equal(sqlite.prepare(`SELECT count(*) n FROM ${tabla}`).get().n, 0);
  }
});
