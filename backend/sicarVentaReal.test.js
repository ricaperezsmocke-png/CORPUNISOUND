const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { crearRepositorioSicar } = require('./sicarRepositorio');
const { NO_INTERNA, ventaSicarTienda, rangoDelMes } = require('./sicarVentaReal');

const RANGO = { sucursal_id: 1, desde: '2026-10-01', hasta: '2026-11-01' };

function prepararDB(t) {
  const sqlite = new Database(':memory:');
  t.after(() => sqlite.close());
  crearRepositorioSicar(sqlite);
  let siguiente = 0;
  const s = {
    tienda: suc => sqlite.prepare('INSERT OR IGNORE INTO sicar_tiendas(sucursal_id) VALUES (?)').run(suc),
    interna: (suc, cli) => sqlite.prepare(`INSERT INTO sicar_internas
      (sucursal_id, cli_id, motivo, usuario_id, fecha_hora) VALUES (?, ?, 'traspaso', 1, 'x')`).run(suc, cli),
    venta(suc, { cli = null, fecha = '2026-10-15T12:00:00', estado = 'vigente', centavos = 10000 } = {}) {
      const ven = String(++siguiente);
      if (cli) {
        sqlite.prepare('INSERT OR IGNORE INTO sicar_clientes(sucursal_id, cli_id, nombre) VALUES (?, ?, ?)')
          .run(suc, cli, `Cliente ${cli}`);
        sqlite.prepare(`INSERT INTO sicar_ventas (sucursal_id, ven_id, cli_id, fecha_local, estado, total_centavos, revision, hash)
          VALUES (?, ?, ?, ?, ?, ?, '1', 'h')`).run(suc, ven, cli, fecha, estado, centavos);
      } else {
        sqlite.prepare(`INSERT INTO sicar_ventas_mostrador (sucursal_id, ven_id, fecha_local, estado, total_centavos, actualizado_en)
          VALUES (?, ?, ?, ?, ?, 'x')`).run(suc, ven, fecha, estado, centavos);
      }
      return ven;
    },
  };
  return { sqlite, s };
}

test('suma cliente no interno + mostrador vigentes y separa internas', t => {
  const { sqlite, s } = prepararDB(t);
  s.tienda(1);
  s.venta(1, { cli: '7', centavos: 10000 });
  s.venta(1, { cli: '9', centavos: 50000 });
  s.interna(1, '9');
  s.venta(1, { centavos: 2500 });
  s.venta(1, { cli: '7', estado: 'cancelada', centavos: 999 });
  assert.deepEqual(ventaSicarTienda(sqlite, RANGO), {
    venta_centavos: 12500, ventas: 2, cliente_centavos: 10000,
    mostrador_centavos: 2500, internas_centavos: 50000, sin_dato: false, motivo: null,
  });
});

test('interna cancelada no aparece en internas; tampoco la excluida', t => {
  const { sqlite, s } = prepararDB(t);
  s.tienda(1);
  s.venta(1, { cli: '9', estado: 'cancelada', centavos: 50000 });
  s.interna(1, '9');
  s.venta(1, { cli: '9', estado: 'excluida', centavos: 50000 });
  s.venta(1, { cli: '7', estado: 'excluida', centavos: 999 });
  assert.deepEqual(ventaSicarTienda(sqlite, RANGO), {
    venta_centavos: 0, ventas: 0, cliente_centavos: 0,
    mostrador_centavos: 0, internas_centavos: 0, sin_dato: true, motivo: 'sin_mostrador',
  });
});

test('bordes del mes para cliente, mostrador e internas', t => {
  const { sqlite, s } = prepararDB(t);
  s.tienda(1);
  assert.deepEqual(rangoDelMes('2026-10'), { desde: '2026-10-01', hasta: '2026-11-01' });
  assert.equal(rangoDelMes('2026-12').hasta, '2027-01-01');
  for (const cli of ['7', '9', null]) {
    s.venta(1, { cli, fecha: '2026-09-30T23:59:59', centavos: 999 });
    s.venta(1, { cli, fecha: '2026-10-01T00:00:00', centavos: 101 });
    s.venta(1, { cli, fecha: '2026-10-31T23:59:59', centavos: 202 });
    s.venta(1, { cli, fecha: '2026-11-01T00:00:00', centavos: 999 });
  }
  s.interna(1, '9');
  assert.deepEqual(ventaSicarTienda(sqlite, { sucursal_id: 1, ...rangoDelMes('2026-10') }), {
    venta_centavos: 606, ventas: 4, cliente_centavos: 303,
    mostrador_centavos: 303, internas_centavos: 303, sin_dato: false, motivo: null,
  });
});

test('mes invalido lanza Error', () => {
  for (const mes of ['2026-13', '2026-00', '2026-1', '26-10', '2026-10-01', '2026-10\n', '', null, 202610]) {
    assert.throws(() => rangoDelMes(mes), Error);
  }
});

test('sin agente gana a sin mostrador', t => {
  const { sqlite } = prepararDB(t);
  assert.deepEqual(ventaSicarTienda(sqlite, { ...RANGO, sucursal_id: 2 }), {
    venta_centavos: 0, ventas: 0, cliente_centavos: 0,
    mostrador_centavos: 0, internas_centavos: 0, sin_dato: true, motivo: 'sin_agente',
  });
});

test('sin mostrador: solo cancelado en el rango conserva los numeros de cliente', t => {
  const { sqlite, s } = prepararDB(t);
  s.tienda(1);
  s.venta(1, { cli: '7', centavos: 10000 });
  s.venta(1, { estado: 'cancelada', centavos: 2500 });
  s.venta(1, { fecha: '2026-11-01T00:00:00' });
  assert.deepEqual(ventaSicarTienda(sqlite, RANGO), {
    venta_centavos: 10000, ventas: 1, cliente_centavos: 10000,
    mostrador_centavos: 0, internas_centavos: 0, sin_dato: true, motivo: 'sin_mostrador',
  });
});

test('sin integracion devuelve ceros y sin_dato', () => {
  assert.deepEqual(ventaSicarTienda(null, RANGO), {
    venta_centavos: 0, ventas: 0, cliente_centavos: 0,
    mostrador_centavos: 0, internas_centavos: 0, sin_dato: true, motivo: 'sin_integracion',
  });
});

test('alias invalido lanza y alias valido produce el fragmento pactado', () => {
  for (const alias of ['v; DROP', '', 'v.x', '1v', 'v\n', null, 7]) {
    assert.throws(() => NO_INTERNA(alias), Error);
  }
  for (const alias of ['v', 'sicar_ventas', '_V2']) {
    assert.equal(NO_INTERNA(alias).replace(/\s+/g, ' '),
      `NOT EXISTS (SELECT 1 FROM sicar_internas _si WHERE _si.sucursal_id = ${alias}.sucursal_id AND _si.cli_id = ${alias}.cli_id)`);
  }
});

test('NO_INTERNA conserva ventas reales con cualquier alias del llamador', t => {
  const { sqlite, s } = prepararDB(t);
  s.tienda(1);
  s.tienda(2);
  s.venta(1, { cli: 'real' });
  s.venta(1, { cli: 'interna' });
  s.interna(1, 'interna');
  s.venta(2, { cli: 'interna' });
  for (const alias of ['i', 'v', '_si', '_SI']) {
    const filas = sqlite.prepare(`SELECT ${alias}.sucursal_id, ${alias}.cli_id
      FROM sicar_ventas ${alias} WHERE ${NO_INTERNA(alias)} ORDER BY ${alias}.sucursal_id`).all();
    assert.deepEqual(filas, [{ sucursal_id: 1, cli_id: 'real' }, { sucursal_id: 2, cli_id: 'interna' }], alias);
  }
});

test('ventas e internas se delimitan por tienda; mostrador de cero sigue siendo vigente', t => {
  const { sqlite, s } = prepararDB(t);
  s.tienda(1);
  s.tienda(2);
  s.venta(1, { cli: '9', centavos: 101 });
  s.venta(1, { centavos: 0 });
  s.venta(2, { cli: '9', centavos: 50000 });
  s.interna(2, '9');
  s.venta(2, { centavos: 2500 });
  assert.deepEqual(ventaSicarTienda(sqlite, RANGO), {
    venta_centavos: 101, ventas: 2, cliente_centavos: 101,
    mostrador_centavos: 0, internas_centavos: 0, sin_dato: false, motivo: null,
  });
});
