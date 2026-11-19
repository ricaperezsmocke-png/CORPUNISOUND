const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { crearRepositorioSicar } = require('../sicarRepositorio');
const { leerConfig, cambiarConfig } = require('./config');
const { listarPermisos } = require('../permisosCatalogo');

function prepararDB(t) {
  const db = new Database(':memory:');
  crearRepositorioSicar(db);
  t.after(() => db.close());
  return db;
}

test('base nueva devuelve parámetros iniciales de resurtido', t => {
  assert.deepEqual(leerConfig(prepararDB(t)), {
    plazo_dias: 20, ciclo_dias: 30, z_servicio_centesimas: 165, dias_historia: 365,
    dias_validos_minimos: 30, proporcion_cero_sin_historia: 80, dias_datos_atrasados: 2,
    dia_corte: 1, dias_visto_bueno: 3, pedidos_pausados: 0, proveedor_jr: 0, proveedor_solcor: 0,
  });
});

test('valores del pedido: día de corte 1 a 28, pausa 0 o 1, proveedor 0 o id', t => {
  const db = prepararDB(t);
  for (const cambio of [{ dia_corte: 0 }, { dia_corte: 29 }, { pedidos_pausados: 2 }, { dias_visto_bueno: 0 }, { proveedor_jr: -1 }]) {
    assert.throws(() => cambiarConfig(db, cambio, 'Victor', 'hoy'), { status: 400 });
  }
  const r = cambiarConfig(db, { dia_corte: 28, pedidos_pausados: 1, proveedor_jr: 0, proveedor_solcor: 12 }, 'Victor', 'hoy');
  assert.deepEqual([r.dia_corte, r.pedidos_pausados, r.proveedor_solcor], [28, 1, 12]);
});

test('configuración rechaza plazo cero sin escribir', t => {
  assert.throws(() => cambiarConfig(prepararDB(t), { plazo_dias: 0 }, 'Victor', 'hoy'), { status: 400 });
});

test('cambio persiste autor, fecha y valor anterior; repetir no duplica historial', t => {
  const db = prepararDB(t);
  assert.equal(cambiarConfig(db, { plazo_dias: 25 }, 'Victor', '2026-11-18').plazo_dias, 25);
  cambiarConfig(db, { plazo_dias: 25 }, 'Victor', '2026-11-18');
  assert.deepEqual(db.prepare('SELECT clave, anterior, nuevo, actor, fecha FROM resurtido_config_historial').all(), [
    { clave: 'plazo_dias', anterior: '20', nuevo: '25', actor: 'Victor', fecha: '2026-11-18' },
  ]);
  assert.equal(leerConfig(db).plazo_dias, 25);
});

test('parámetros mal formados se rechazan juntos, sin cambios parciales', t => {
  const db = prepararDB(t);
  for (const cambio of [null, [], {}, { desconocido: 1 }, { plazo_dias: '25' },
    { plazo_dias: 1.5 }, { plazo_dias: 25, proporcion_cero_sin_historia: 101 }]) {
    assert.throws(() => cambiarConfig(db, cambio, 'Victor', 'hoy'), { status: 400 });
  }
  assert.equal(leerConfig(db).plazo_dias, 20);
});

test('permisos propios de inventario, con visto bueno y aprobación ya implementados', () => {
  for (const [clave, implementado] of [
    ['ver_resurtido', true], ['corregir_minimos_resurtido', true], ['configurar_resurtido', true],
    ['dar_visto_bueno_resurtido', true], ['aprobar_pedido_resurtido', true],
  ]) {
    const permiso = listarPermisos().find(p => p.clave === clave);
    assert.equal(permiso?.modulo, 'inventario');
    assert.equal(permiso.implementado, implementado);
  }
});
