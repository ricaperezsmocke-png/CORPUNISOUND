const { test } = require('node:test');
const assert = require('node:assert/strict');
const J = require('./juntas');

const HOY = '2026-10-28'; // miercoles; su lunes es 2026-10-26
const LUNES = '2026-10-26';
const nuevaDB = () => ({ pos: { cinco_caminos: {} } });
const ctx = (extra = {}) => ({ usuarioId: 7, usuarioNombre: 'Ana', sucursalId: 1, hoy: HOY, ...extra });
const cuerpo = (extra = {}) => ({ texto: 'Pedir el telefono en cada venta', responsable: 'Cajera', fecha_compromiso: '2026-10-30', ...extra });

test('asegurar crea los dos arreglos y no pisa lo que ya hay', () => {
  const db = nuevaDB();
  J.asegurar(db);
  assert.deepEqual(db.pos.cinco_caminos.compromisos, []);
  assert.deepEqual(db.pos.cinco_caminos.juntas, []);
  db.pos.cinco_caminos.juntas.push({ x: 1 });
  J.asegurar(db);
  assert.equal(db.pos.cinco_caminos.juntas.length, 1);
});

test('crear compromiso: guarda usuario del token y tienda del contexto, ids consecutivos', () => {
  const db = nuevaDB();
  const c = J.crearCompromiso(db, cuerpo(), ctx());
  assert.equal(c.id, 1);
  assert.equal(c.sucursal_id, 1);
  assert.equal(c.lunes, LUNES);
  assert.equal(c.creado_por_id, 7);
  assert.equal(c.hecho, null);
  assert.equal(c.cancelado, null);
  assert.equal(J.crearCompromiso(db, cuerpo(), ctx()).id, 2);
});

test('crear compromiso: valida con lista de lo permitido', () => {
  const malos = [
    cuerpo({ texto: 'ab' }), cuerpo({ texto: 'x'.repeat(201) }), cuerpo({ responsable: 'ab' }), cuerpo({ responsable: 5 }),
    cuerpo({ fecha_compromiso: '2026-10-25' }), cuerpo({ fecha_compromiso: '2026-11-09' }), cuerpo({ fecha_compromiso: '2026-02-30' }),
    cuerpo({ sucursal_id: 2 }), cuerpo({ hecho: true }), cuerpo({ lunes: '2026-10-27' }), cuerpo({ lunes: '2026-11-02' }),
    cuerpo({ texto: 'con\u0007control' }), null, [], 'texto',
  ];
  for (const m of malos) {
    const db = nuevaDB();
    assert.throws(() => J.crearCompromiso(db, m, ctx()), e => e.status === 400, JSON.stringify(m));
    assert.equal((db.pos.cinco_caminos.compromisos || []).length, 0);
  }
  // Ultimo dia de la semana siguiente: permitido.
  assert.doesNotThrow(() => J.crearCompromiso(nuevaDB(), cuerpo({ fecha_compromiso: '2026-11-08' }), ctx()));
});

test('hecho: guarda quien y cuando; dos veces o cancelado dan 409; id inexistente o de otra tienda 404', () => {
  const db = nuevaDB();
  const c = J.crearCompromiso(db, cuerpo(), ctx());
  const h = J.marcarHecho(db, String(c.id), ctx());
  assert.equal(h.hecho.por_id, 7);
  assert.equal(h.hecho.por_nombre, 'Ana');
  assert.match(h.hecho.en, /^\d{4}-\d{2}-\d{2}T/);
  assert.throws(() => J.marcarHecho(db, c.id, ctx()), e => e.status === 409);
  const c2 = J.crearCompromiso(db, cuerpo(), ctx());
  J.cancelarCompromiso(db, c2.id, 'Ya no aplica', ctx());
  assert.throws(() => J.marcarHecho(db, c2.id, ctx()), e => e.status === 409);
  assert.throws(() => J.marcarHecho(db, 99, ctx()), e => e.status === 404);
  assert.throws(() => J.marcarHecho(db, 'abc', ctx()), e => e.status === 404);
  assert.throws(() => J.marcarHecho(db, c.id, ctx({ sucursalId: 2 })), e => e.status === 404);
});

test('cancelar: pide motivo de 3 a 200, guarda quien, y no se borra nada', () => {
  const db = nuevaDB();
  const c = J.crearCompromiso(db, cuerpo(), ctx());
  for (const m of [undefined, '', '  ', 'ab', 'x'.repeat(201), 5]) {
    assert.throws(() => J.cancelarCompromiso(db, c.id, m, ctx()), e => e.status === 400);
  }
  const r = J.cancelarCompromiso(db, c.id, 'Se cambio de plan', ctx());
  assert.equal(r.cancelado.por_id, 7);
  assert.equal(r.cancelado.motivo, 'Se cambio de plan');
  assert.equal(db.pos.cinco_caminos.compromisos.length, 1);
  assert.throws(() => J.cancelarCompromiso(db, c.id, 'otra vez', ctx()), e => e.status === 409);
  const h = J.crearCompromiso(db, cuerpo(), ctx());
  J.marcarHecho(db, h.id, ctx());
  assert.throws(() => J.cancelarCompromiso(db, h.id, 'ya estaba hecho', ctx()), e => e.status === 409);
});

test('junta hecha: exige compromiso vigente, no se repite, solo lunes valido y no futuro', () => {
  const db = nuevaDB();
  assert.throws(() => J.marcarJunta(db, LUNES, ctx()), e => e.status === 400);
  const c = J.crearCompromiso(db, cuerpo(), ctx());
  J.cancelarCompromiso(db, c.id, 'No va', ctx());
  assert.throws(() => J.marcarJunta(db, LUNES, ctx()), e => e.status === 400, 'cancelado no cuenta');
  // Un compromiso vigente de OTRA tienda tampoco cuenta.
  J.crearCompromiso(db, cuerpo(), ctx({ sucursalId: 2 }));
  assert.throws(() => J.marcarJunta(db, LUNES, ctx()), e => e.status === 400);
  J.crearCompromiso(db, cuerpo(), ctx());
  const j = J.marcarJunta(db, LUNES, ctx());
  assert.deepEqual({ ...j, en: undefined }, { sucursal_id: 1, lunes: LUNES, por_id: 7, en: undefined });
  assert.throws(() => J.marcarJunta(db, LUNES, ctx()), e => e.status === 409);
  for (const l of ['2026-10-27', '2026-11-02', 'basura', undefined, 20261026]) {
    assert.throws(() => J.marcarJunta(db, l, ctx()), e => e.status === 400, String(l));
  }
});

test('indicador: cuenta las 8 semanas previas completas, con huecos, de esa tienda', () => {
  const db = nuevaDB();
  J.asegurar(db);
  // Semanas completas previas a HOY: lunes 10-19, 10-12, 10-05, 09-28, 09-21, 09-14, 09-07, 08-31.
  const hechas = ['2026-10-19', '2026-10-05', '2026-09-21', '2026-08-31', '2026-08-24', '2026-10-26'];
  for (const lunes of hechas) db.pos.cinco_caminos.juntas.push({ sucursal_id: 1, lunes, por_id: 1, en: 'x' });
  db.pos.cinco_caminos.juntas.push({ sucursal_id: 2, lunes: '2026-10-12', por_id: 1, en: 'x' });
  const ind = J.indicador(db, 1, HOY);
  assert.deepEqual(ind, { semanas: 8, con_junta: 4, pct: 50 });
  assert.deepEqual(J.indicador(db, 3, HOY), { semanas: 8, con_junta: 0, pct: 0 });
});

test('vista: compromisos de la semana de esa tienda y su junta', () => {
  const db = nuevaDB();
  J.crearCompromiso(db, cuerpo(), ctx());
  J.crearCompromiso(db, cuerpo(), ctx({ sucursalId: 2 }));
  const v = J.vista(db, 1, LUNES, HOY);
  assert.equal(v.compromisos.length, 1);
  assert.equal(v.junta, null);
  assert.equal(v.indicador.semanas, 8);
});
