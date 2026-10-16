const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { crearRepositorioSicar } = require('./sicarRepositorio');

function preparar(t) {
  const sqlite = new Database(':memory:');
  t.after(() => sqlite.close());
  const repo = crearRepositorioSicar(sqlite);
  sqlite.exec(`INSERT INTO sicar_tiendas(sucursal_id) VALUES (1);
    INSERT INTO sicar_clientes(sucursal_id, cli_id, nombre) VALUES (1, '123', 'Ana');`);
  return { sqlite, repo };
}
const cambio = { sucursal_id: 1, cli_id: '123', estado: 'contactado', usuario_id: 9, fecha_hora: '2026-10-15T20:00:00.000Z' };

test('seguimiento migra idempotente y conserva estado e historial con actor y fecha', t => {
  const { sqlite, repo } = preparar(t);
  assert.equal(typeof repo.guardarEstadoCliente, 'function');
  repo.guardarEstadoCliente(cambio);
  crearRepositorioSicar(sqlite);
  repo.guardarEstadoCliente({ ...cambio, estado: 'interesado', usuario_id: 10, fecha_hora: '2026-10-15T21:00:00.000Z' });
  assert.deepEqual(sqlite.prepare('SELECT * FROM sicar_estados').get(),
    { ...cambio, estado: 'interesado', usuario_id: 10, fecha_hora: '2026-10-15T21:00:00.000Z' });
  assert.deepEqual(sqlite.prepare('SELECT anterior, nuevo, usuario_id, fecha_hora FROM sicar_estados_historial ORDER BY id').all(), [
    { anterior: null, nuevo: 'contactado', usuario_id: 9, fecha_hora: cambio.fecha_hora },
    { anterior: 'contactado', nuevo: 'interesado', usuario_id: 10, fecha_hora: '2026-10-15T21:00:00.000Z' },
  ]);
});

test('fallo de historial revierte el cambio de estado', t => {
  const { sqlite, repo } = preparar(t);
  assert.equal(typeof repo.guardarEstadoCliente, 'function');
  repo.guardarEstadoCliente(cambio);
  sqlite.exec(`CREATE TRIGGER impedir_historial BEFORE INSERT ON sicar_estados_historial
    BEGIN SELECT RAISE(ABORT, 'fallo de prueba'); END;`);
  assert.throws(() => repo.guardarEstadoCliente({ ...cambio, estado: 'perdido' }), /fallo de prueba/);
  assert.equal(sqlite.prepare('SELECT estado FROM sicar_estados').get().estado, 'contactado');
  assert.equal(sqlite.prepare('SELECT count(*) n FROM sicar_estados_historial').get().n, 1);
});
