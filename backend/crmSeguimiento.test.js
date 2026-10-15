const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { crearRepositorioSicar } = require('./sicarRepositorio');
const { crearConsultasCRM } = require('./crmFuentes');
const ctx = { alcance: { verTodas: true }, verSicar: true, hoyLocal: '2026-10-15' };

function preparar(t) {
  const sqlite = new Database(':memory:');
  t.after(() => sqlite.close());
  const repo = crearRepositorioSicar(sqlite);
  const DB = { crm: { clientes: [{ id: 10, nombre: 'Nativo', sucursal_id: 1 }] }, pos: { ventas: [] } };
  sqlite.exec(`INSERT INTO sicar_tiendas(sucursal_id) VALUES (1), (2);
    INSERT INTO sicar_clientes(sucursal_id, cli_id, nombre) VALUES (1,'123','Ana'), (2,'456','Beto');`);
  repo.guardarEstadoCliente({ sucursal_id: 1, cli_id: '123', estado: 'contactado', usuario_id: 9, fecha_hora: '2026-10-15T20:00:00Z' });
  repo.guardarEstadoCliente({ sucursal_id: 2, cli_id: '456', estado: 'interesado', usuario_id: 9, fecha_hora: '2026-10-15T21:00:00Z' });
  return { sqlite, repo, DB, consultas: crearConsultasCRM(DB, repo) };
}

test('SICAR muestra estado en ficha y listado', t => {
  const { consultas } = preparar(t);
  assert.equal(consultas.ficha(ctx, 'sicar:1:123').estado, 'contactado');
  assert.equal(consultas.listar(ctx).items.find(p => p.ref === 'sicar:2:456').estado, 'interesado');
});

test('unido usa nativo y si falta toma estado SICAR mas reciente visible', t => {
  const { sqlite, DB, consultas } = preparar(t);
  sqlite.exec(`INSERT INTO sicar_vinculos(sucursal_id, cli_id, cliente_id, estado, creada, actualizada)
    VALUES (1,'123',10,'confirmado','hoy','hoy'), (2,'456',10,'confirmado','hoy','hoy');`);
  assert.equal(consultas.ficha(ctx, 'crm:10').estado, 'interesado');
  assert.equal(consultas.ficha({ ...ctx, alcance: { verTodas: false, sucursalId: 1 } }, 'crm:10').estado, 'contactado');
  assert.equal(consultas.ficha({ ...ctx, verSicar: false }, 'crm:10').estado, null);
  DB.crm.clientes[0].estado = 'perdido';
  assert.equal(consultas.ficha(ctx, 'crm:10').estado, 'perdido');
});

function compras(t) {
  const f = preparar(t);
  f.DB.crm.clientes.push({ id: 20, nombre: 'Al final', sucursal_id: 1 }, { id: 30, nombre: 'Mismo dia', sucursal_id: 1 });
  f.DB.pos.ventas = [
    { cliente_id: 10, fecha: '2026-10-14', total: 10, estatus: 'cerrada' },
    { cliente_id: 30, fecha: '2026-10-14', total: 10, estatus: 'cerrada' },
  ];
  f.sqlite.exec(`INSERT INTO sicar_ventas(sucursal_id, ven_id, cli_id, fecha_local, estado, total_centavos, revision, hash)
    VALUES (1,'1','123','2026-10-15T12:00:00','vigente',2000,'1','h'),
      (1,'2','123','2026-10-16T12:00:00','cancelada',9000,'1','h');`);
  return f.consultas;
}
test('orden reciente por defecto, sin compras por nombre y desempate por ref sin saltos', t => {
  const consulta = compras(t);
  const esperado = ['sicar:1:123', 'crm:10', 'crm:30', 'crm:20', 'sicar:2:456'];
  assert.deepEqual(consulta.listar(ctx).items.map(p => p.ref), esperado);
  const paginas = [0, 2, 4].flatMap(cursor => consulta.listar(ctx, { cursor, limit: 2 }).items.map(p => p.ref));
  assert.deepEqual(paginas, esperado);
  assert.deepEqual(consulta.listar(ctx, { orden: 'nombre' }).items.map(p => p.ref),
    ['crm:20', 'sicar:1:123', 'sicar:2:456', 'crm:30', 'crm:10']);
  assert.deepEqual(consulta.listar(ctx, { orden: 'monto' }).items.map(p => p.ref),
    ['sicar:1:123', 'crm:10', 'crm:30', 'crm:20', 'sicar:2:456']);
});
test('fechas incluyen limites, excluyen sin compras y calculan totales filtrados', t => {
  const consulta = compras(t);
  const r = consulta.listar(ctx, { desde: '2026-10-15', hasta: '2026-10-15' });
  assert.deepEqual(r.items.map(p => p.ref), ['sicar:1:123']);
  assert.equal(r.totales.clientes, 1);
  assert.equal(r.totales.compradores, 1);
  assert.equal(r.totales.monto_centavos, 2000);
  assert.equal(r.totales.monto_pos_centavos, 0);
  assert.equal(r.totales.monto_sicar_centavos, 2000);
  assert.equal(consulta.listar(ctx, { hasta: '2026-10-14' }).totales.clientes, 2);
  assert.equal(consulta.listar(ctx, { desde: '2026-10-14' }).totales.clientes, 3);
});
test('estado y sin_estado filtran antes de totales y pagina', t => {
  const consulta = compras(t);
  assert.deepEqual(consulta.listar(ctx, { estado: 'interesado' }).items.map(p => p.ref), ['sicar:2:456']);
  assert.equal(consulta.listar(ctx, { estado: 'sin_estado', limit: 1 }).totales.clientes, 3);
  assert.equal(consulta.listar(ctx, { estado: 'compro' }).totales.clientes, 0);
});
test('filtros invalidos fallan cerrando con 400', t => {
  const consulta = compras(t);
  for (const filtros of [{ orden: 'otro' }, { estado: 'otro' }, { desde: '2026-02-30' }, { hasta: '2026-13-01' },
    { desde: '2026-2-01' }, { desde: '2026-10-16', hasta: '2026-10-15' }, { orden: ['reciente'] }, { estado: ['interesado'] },
    { desde: ['2026-10-15'] }, { desde: '2026-10-15T00:00:00Z' }]) {
    assert.throws(() => consulta.listar(ctx, filtros), { status: 400 }, JSON.stringify(filtros));
  }
});
