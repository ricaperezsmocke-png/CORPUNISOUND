const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { crearRepositorioSicar } = require('../sicarRepositorio');
const { sembrarManual } = require('./manual');
const { asegurar } = require('./juntas');
const M = require('../metasPersonalizadas');
const { listarPlanes } = require('../planIACrear');
const { proponerPlan, reconciliarPlanesPendientes, LIMITE_DIARIO } = require('../planIA');
const { proponerPlanMes, validarPlanMes: validarPlanMesReal, descartarPlanMes, listarBorradoresMes, validarPropuestaMes } = require('./planMes');

const HOY = '2026-10-26';
const MES = '2026-10';
const USUARIO = { id: 70, nombre: 'Victor' };
const sumar = (dia, dias) => {
  const d = new Date(`${dia}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};

let siguiente = 0;
function preparar(t) {
  const sqlite = new Database(':memory:');
  t.after(() => sqlite.close());
  crearRepositorioSicar(sqlite);
  sqlite.prepare('INSERT INTO sicar_tiendas(sucursal_id) VALUES (1)').run();
  const DB = { pos: { cinco_caminos: { categorias: [] }, sucursales: [{ id: 1, nombre: 'Ocosingo' }], vendedores: [{ id: 1, nombre: 'Marisol Gordillo' }],
    metas_personalizadas: [], meta_sellos: [], okrs: [], planes_ia: [] }, radar_demanda: { registros: [] }, admin: { usuarios: [] } };
  sembrarManual(DB);
  for (let i = 1; i <= 8; i++) {
    const lunes = sumar(HOY, -7 * i);
    for (let j = 0; j < 30; j++) {
      sqlite.prepare(`INSERT INTO sicar_ventas_mostrador (sucursal_id, ven_id, fecha_local, estado, total_centavos, actualizado_en)
        VALUES (1, ?, ?, 'vigente', 10000, 'x')`).run(String(++siguiente), `${sumar(lunes, j % 7)}T10:00:00`);
    }
    for (let j = 0; j < 40; j++) {
      const cli = `c${++siguiente}`;
      sqlite.prepare('INSERT INTO sicar_clientes(sucursal_id, cli_id, nombre) VALUES (1, ?, ?)').run(cli, cli);
      sqlite.prepare(`INSERT INTO sicar_ventas (sucursal_id, ven_id, cli_id, fecha_local, estado, total_centavos, revision, hash)
        VALUES (1, ?, ?, ?, 'vigente', 10000, '1', 'h')`).run(String(++siguiente), cli, `${sumar(lunes, j % 7)}T12:00:00`);
    }
  }
  return { sqlite, DB };
}

// Cliente falso: lee el manual que se le manda y responde con dos tacticas de ese manual.
function clienteFalso(cambios = {}, registro = []) {
  return { messages: { create: async (cuerpo, opciones) => {
    registro.push({ cuerpo, opciones });
    if (cambios instanceof Error) throw cambios;
    const { datos } = JSON.parse(cuerpo.messages[0].content);
    const [a, b] = datos.manual.map(x => x.id);
    const propuesta = { camino: 'prospectos', por_que_camino: 'Faltan clientes nuevos', tacticas: [{ id: a, por_que: 'Es sencilla' }, { id: b, por_que: 'Ya se probó' }],
      metas: [{ numero: 'ticket_promedio_centavos', valor: 110, responsable_rol: 'gerente', por_que: 'Subir el ticket' },
        { numero: 'pct_con_cliente', valor: 62, responsable_rol: 'vendedores', por_que: 'Más ventas con cliente' }], ...cambios };
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(propuesta) }], usage: { input_tokens: 10, output_tokens: 5 } };
  } } };
}
const validarPlanMes = (DB, id, cuerpo, usuario) => validarPlanMesReal(DB, id, cuerpo, usuario, { hoy: HOY });
const proponer = (sqlite, DB, cliente = clienteFalso(), entrada = { sucursal_id: 1, mes: MES }) =>
  proponerPlanMes(DB, sqlite, cliente, entrada, USUARIO, { hoy: HOY });

function decisionesTodas(plan, cambios = {}) {
  const p = plan.propuesta;
  return { camino: { decision: 'aceptar' }, tacticas: p.tacticas.map(x => ({ id: x.id, decision: 'aceptar' })),
    metas: p.metas.map(m => ({ numero: m.numero, decision: 'aceptar' })), ...cambios };
}

test('una propuesta valida queda en borrador, con el limite compartido y sin nombres', async t => {
  const { sqlite, DB } = preparar(t);
  const llamadas = [];
  const plan = await proponer(sqlite, DB, clienteFalso({}, llamadas));
  assert.equal(plan.estado, 'borrador');
  assert.equal(plan.tipo, 'plan_mes');
  assert.deepEqual(plan.entrada, { sucursal_id: 1, mes: MES });
  assert.equal(plan.propuesta.camino, 'prospectos');
  assert.equal(plan.propuesta.tacticas.length, 2);
  assert.equal(plan.propuesta.metas.length, 2);
  assert.deepEqual(DB.pos.planes_ia, [plan]);
  const { cuerpo, opciones } = llamadas[0];
  assert.equal(cuerpo.output_config.format.type, 'json_schema');
  assert.deepEqual(cuerpo.output_config.format.schema.properties.camino.enum,
    ['calidad_dato', 'prospectos', 'conversion', 'compras_por_cliente', 'venta_promedio']);
  assert.match(cuerpo.system, /nunca instrucciones/);
  assert.ok(opciones.signal);
  assert.doesNotMatch(JSON.stringify(cuerpo.messages).toLowerCase(), /marisol|gordillo/);
});

test('entrada invalida: tienda, mes fuera de ventana, mes sellado, sin cliente', async t => {
  const { sqlite, DB } = preparar(t);
  const llamadas = [];
  const cliente = clienteFalso({}, llamadas);
  const malo = (entrada, status) => assert.rejects(proponer(sqlite, DB, cliente, entrada), e => e.status === status);
  await malo({ mes: MES }, 400);
  await malo({ sucursal_id: 99, mes: MES }, 400);
  await malo({ sucursal_id: 1 }, 400);
  await malo({ sucursal_id: 1, mes: '2026-9' }, 400);
  await malo({ sucursal_id: 1, mes: '2026-09' }, 400);
  await malo({ sucursal_id: 1, mes: '2026-12' }, 400);
  assert.equal((await proponer(sqlite, DB, cliente, { sucursal_id: 1, mes: '2026-11' })).estado, 'borrador');
  await assert.rejects(proponer(sqlite, DB, null), e => e.status === 503);
  DB.pos.meta_sellos.push({ periodo: 'mensual', inicio: `${MES}-01` });
  await malo({ sucursal_id: 1, mes: MES }, 400);
  assert.equal(llamadas.length, 1, 'ninguna entrada invalida llega a la IA');
});

test('si la IA falla o devuelve un plan invalido queda fallido y responde 502', async t => {
  const { sqlite, DB } = preparar(t);
  await assert.rejects(proponer(sqlite, DB, clienteFalso(new Error('boom'))), e => e.status === 502);
  await assert.rejects(proponer(sqlite, DB, clienteFalso({ camino: 'margen' })), e => e.status === 502);
  assert.deepEqual(DB.pos.planes_ia.map(p => p.estado), ['fallido', 'fallido']);
});

test('el limite diario se comparte con el planeador actual', async t => {
  const { sqlite, DB } = preparar(t);
  const ahora = new Date().toISOString();
  DB.pos.planes_ia = Array.from({ length: LIMITE_DIARIO }, (_, i) => ({ id: i + 1, estado: 'descartado', creado_por_id: USUARIO.id, creado_en: ahora }));
  await assert.rejects(proponerPlanMes(DB, sqlite, clienteFalso(), { sucursal_id: 1, mes: MES }, USUARIO, { hoy: HOY }), e => e.status === 429);
  // Y al reves: los planes del mes cuentan para el planeador de metas.
  const { sqlite: s2, DB: DB2 } = preparar(t);
  DB2.pos.planes_ia = Array.from({ length: LIMITE_DIARIO }, (_, i) => ({ id: i + 1, tipo: 'plan_mes', estado: 'borrador', creado_por_id: USUARIO.id, creado_en: ahora }));
  void s2;
  await assert.rejects(proponerPlan(DB2, clienteFalso(), { objetivo_texto: 'x', sucursal_id: 1, periodo: 'mensual', inicio: '2026-11-01' }, USUARIO, { hoy: HOY }),
    e => e.status === 429);
});

test('un plan pendiente queda fallido al reiniciar', () => {
  const DB = { pos: { planes_ia: [{ id: 1, tipo: 'plan_mes', estado: 'pendiente' }] } };
  reconciliarPlanesPendientes(DB);
  assert.equal(DB.pos.planes_ia[0].estado, 'fallido');
});

test('el planeador actual no ve ni valida los planes del mes', async t => {
  const { sqlite, DB } = preparar(t);
  const plan = await proponer(sqlite, DB);
  assert.deepEqual(listarPlanes(DB), []);
  const { validarPlan, descartarPlan } = require('../planIACrear');
  assert.throws(() => validarPlan(DB, plan.id, {}, USUARIO));
  assert.throws(() => descartarPlan(DB, plan.id, USUARIO));
  assert.equal(plan.estado, 'borrador');
});

test('validar crea las metas cinco_caminos y el plan del mes', async t => {
  const { sqlite, DB } = preparar(t);
  const plan = await proponer(sqlite, DB);
  const hecho = validarPlanMes(DB, plan.id, decisionesTodas(plan), USUARIO);
  assert.equal(hecho.estado, 'validado');
  const metas = DB.pos.metas_personalizadas;
  assert.equal(metas.length, 2);
  const ticket = metas.find(m => m.fuente === 'cinco_caminos:ticket_promedio_centavos');
  assert.equal(ticket.alcance, 'tienda');
  assert.equal(ticket.sucursal_id, 1);
  assert.equal(ticket.periodo, 'mensual');
  assert.equal(ticket.inicio, '2026-10-01');
  assert.equal(ticket.valor_meta, 11000);
  assert.equal(ticket.nombre, 'Ticket promedio: llegar a $110.00');
  assert.match(ticket.descripcion, /gerente/);
  assert.equal(metas.find(m => m.fuente === 'cinco_caminos:pct_con_cliente').valor_meta, 620);
  const [mes] = DB.pos.cinco_caminos.planes_mes;
  assert.equal(mes.sucursal_id, 1);
  assert.equal(mes.mes, MES);
  assert.equal(mes.camino, 'prospectos');
  assert.equal(mes.tacticas.length, 2);
  assert.deepEqual(mes.metas, metas.map(m => m.clave));
  assert.equal(mes.plan_ia_id, plan.id);
  assert.equal(mes.aprobado_por_id, USUARIO.id);
  assert.ok(mes.aprobado_en);
  assert.equal(plan.validado_por_nombre, 'Victor');
});

test('si algo falla a medias no se crea nada', async t => {
  const { sqlite, DB } = preparar(t);
  const plan = await proponer(sqlite, DB);
  const original = M.crearMeta;
  let llamadas = 0;
  M.crearMeta = (...args) => { if (++llamadas === 2) throw new Error('falla a la segunda'); return original(...args); };
  t.after(() => { M.crearMeta = original; });
  assert.throws(() => validarPlanMes(DB, plan.id, decisionesTodas(plan), USUARIO), /falla a la segunda/);
  assert.equal(llamadas, 2);
  assert.equal(DB.pos.metas_personalizadas.length, 0);
  assert.deepEqual(DB.pos.cinco_caminos.planes_mes || [], []);
  assert.equal(plan.estado, 'borrador');
});

test('un segundo plan aprobado del mismo mes y tienda da 409', async t => {
  const { sqlite, DB } = preparar(t);
  const a = await proponer(sqlite, DB);
  const b = await proponer(sqlite, DB);
  validarPlanMes(DB, a.id, decisionesTodas(a), USUARIO);
  assert.throws(() => validarPlanMes(DB, b.id, decisionesTodas(b), USUARIO), e => e.status === 409);
  await assert.rejects(proponer(sqlite, DB), e => e.status === 409);
  assert.equal(DB.pos.cinco_caminos.planes_mes.length, 1);
  assert.equal(DB.pos.metas_personalizadas.length, 2);
});

test('el gerente cambia camino, tactica y cifra; la cifra fuera del rango da 400', async t => {
  const { sqlite, DB } = preparar(t);
  const plan = await proponer(sqlite, DB);
  const libre = plan.propuesta.tacticas.map(x => x.id);
  const otra = DB.pos.cinco_caminos.tacticas.find(x => x.activa && x.como_se_mide !== 'fase_2' && x.como_se_mide !== 'fase_3' && !libre.includes(x.id));
  const con = (metas, extra = {}) => decisionesTodas(plan, { metas, ...extra });
  const ok = [{ numero: 'ticket_promedio_centavos', decision: 'cambiar', valor: 105 }, { numero: 'pct_con_cliente', decision: 'rechazar' }];
  const fuera = valor => () => validarPlanMes(DB, plan.id, con([{ numero: 'ticket_promedio_centavos', decision: 'cambiar', valor },
    { numero: 'pct_con_cliente', decision: 'rechazar' }]), USUARIO);
  for (const valor of [104, 116, 'x', null]) assert.throws(fuera(valor), e => e.status === 400, String(valor));
  assert.equal(DB.pos.metas_personalizadas.length, 0);
  const hecho = validarPlanMes(DB, plan.id, con(ok, { camino: { decision: 'cambiar', camino: 'venta_promedio' },
    tacticas: [{ id: libre[0], decision: 'cambiar', nuevo_id: otra.id }, { id: libre[1], decision: 'rechazar' }] }), USUARIO);
  assert.equal(hecho.estado, 'validado');
  assert.equal(DB.pos.metas_personalizadas.length, 1);
  assert.equal(DB.pos.metas_personalizadas[0].valor_meta, 10500);
  const [mes] = DB.pos.cinco_caminos.planes_mes;
  assert.equal(mes.camino, 'venta_promedio');
  assert.deepEqual(mes.tacticas, [otra.id]);
});

test('minimos y decisiones incompletas dan 400 y no crean nada', async t => {
  const { sqlite, DB } = preparar(t);
  const plan = await proponer(sqlite, DB);
  const p = plan.propuesta;
  const malo = cuerpo => assert.throws(() => validarPlanMes(DB, plan.id, cuerpo, USUARIO), e => e.status === 400);
  malo(decisionesTodas(plan, { tacticas: p.tacticas.map(x => ({ id: x.id, decision: 'rechazar' })) }));
  malo(decisionesTodas(plan, { metas: p.metas.map(m => ({ numero: m.numero, decision: 'rechazar' })) }));
  malo(decisionesTodas(plan, { metas: [{ numero: p.metas[0].numero, decision: 'aceptar' }] }));
  malo(decisionesTodas(plan, { camino: { decision: 'cambiar', camino: 'margen' } }));
  malo(decisionesTodas(plan, { camino: undefined }));
  malo(decisionesTodas(plan, { tacticas: [{ id: p.tacticas[0].id, decision: 'cambiar', nuevo_id: 99999 }, { id: p.tacticas[1].id, decision: 'aceptar' }] }));
  malo(decisionesTodas(plan, { tacticas: [{ id: p.tacticas[0].id, decision: 'cambiar', nuevo_id: p.tacticas[1].id }, { id: p.tacticas[1].id, decision: 'aceptar' }] }));
  malo(null);
  assert.equal(DB.pos.metas_personalizadas.length, 0);
  assert.equal(plan.estado, 'borrador');
});

test('no se acepta una tactica de descuento con el camino conversion', async t => {
  const { sqlite, DB } = preparar(t);
  const plan = await proponer(sqlite, DB, clienteFalso({ camino: 'conversion' }));
  const p = plan.propuesta;
  const sana = p.tacticas[0].id;
  const desc = DB.pos.cinco_caminos.tacticas.find(x => x.activa && x.como_se_mide !== 'fase_2' && x.como_se_mide !== 'fase_3'
    && !p.tacticas.some(y => y.id === x.id));
  desc.nombre = 'Descuento para quien compre hoy';
  assert.throws(() => validarPlanMes(DB, plan.id, decisionesTodas(plan, {
    tacticas: [{ id: sana, decision: 'aceptar' }, { id: p.tacticas[1].id, decision: 'cambiar', nuevo_id: desc.id }] }), USUARIO), e => e.status === 400);
  assert.equal(DB.pos.metas_personalizadas.length, 0);
});

test('una meta de ese numero ya creada para la tienda y el mes da 409', async t => {
  const { sqlite, DB } = preparar(t);
  const plan = await proponer(sqlite, DB);
  M.crearMeta(DB, { nombre: 'Ticket', fuente: 'cinco_caminos:ticket_promedio_centavos', prueba: 'ninguna', valor_meta: 11000, periodo: 'mensual',
    inicio: '2026-10-01', alcance: 'tienda', sucursal_id: 1 }, USUARIO);
  assert.throws(() => validarPlanMes(DB, plan.id, decisionesTodas(plan), USUARIO), e => e.status === 409);
  assert.equal(DB.pos.metas_personalizadas.length, 1);
});

test('descartar pide motivo y el borrador ya no se puede validar', async t => {
  const { sqlite, DB } = preparar(t);
  const plan = await proponer(sqlite, DB);
  assert.throws(() => descartarPlanMes(DB, plan.id, '  ', USUARIO), e => e.status === 400);
  assert.throws(() => descartarPlanMes(DB, 999, 'No', USUARIO), e => e.status === 404);
  descartarPlanMes(DB, plan.id, 'No aplica este mes', USUARIO);
  assert.equal(plan.estado, 'descartado');
  assert.equal(plan.motivo, 'No aplica este mes');
  assert.equal(plan.descartado_por_nombre, 'Victor');
  assert.throws(() => validarPlanMes(DB, plan.id, decisionesTodas(plan), USUARIO), e => e.status === 400);
  assert.deepEqual(listarBorradoresMes(DB, {}), []);
});

test('listarBorradoresMes filtra por tienda y mes', async t => {
  const { sqlite, DB } = preparar(t);
  const a = await proponer(sqlite, DB);
  await proponer(sqlite, DB, clienteFalso(), { sucursal_id: 1, mes: '2026-11' });
  assert.equal(listarBorradoresMes(DB, {}).length, 2);
  assert.deepEqual(listarBorradoresMes(DB, { sucursal_id: 1, mes: MES }).map(p => p.id), [a.id]);
  assert.deepEqual(listarBorradoresMes(DB, { sucursal_id: 2 }), []);
});

test('asegurar deja planes_mes como arreglo sin pisar el que hay', () => {
  const DB = { pos: { cinco_caminos: {} } };
  assert.deepEqual(asegurar(DB).planes_mes, []);
  DB.pos.cinco_caminos.planes_mes.push({ id: 1 });
  assert.equal(asegurar(DB).planes_mes.length, 1);
});

test('una base de cero descarta la meta (no se puede subir 5 a 15 % de nada)', () => {
  const t = (id, nombre) => ({ id, nombre, camino: 'prospectos' });
  const ctx = { datos: { manual: [t(1, 'a'), t(2, 'b')] }, bases: { pct_con_cliente: { promedio_8: 0, mismo_mes: null }, conversion: { promedio_8: 200, mismo_mes: null } },
    calidad_primero: false, cifrasPermitidas: [] };
  const r = validarPropuestaMes({ camino: 'prospectos', por_que_camino: 'x', tacticas: [{ id: 1, por_que: 'a' }, { id: 2, por_que: 'b' }],
    metas: [{ numero: 'pct_con_cliente', valor: 5, responsable_rol: 'gerente', por_que: 'c' },
      { numero: 'conversion', valor: 21, responsable_rol: 'gerente', por_que: 'c' }] }, ctx);
  assert.deepEqual(r.metas.map(m => m.numero), ['conversion']);
  assert.deepEqual(r.descartadas.map(m => m.numero), ['pct_con_cliente']);
});

// ---- Correcciones de la revision de la Task 1 ----
const { TEXTO_POR_QUE: TEXTO_FIJO, armarDatosPlanMes } = require('./planMes');

const tac = (id, nombre) => ({ id, nombre, camino: 'prospectos' });
function ctxMin(bases, extra = {}) {
  return { datos: { manual: [tac(1, 'a'), tac(2, 'b')] }, bases, calidad_primero: false, cifrasPermitidas: [], ...extra };
}
const prop = (metas, extra = {}) => ({ camino: 'prospectos', por_que_camino: 'x', tacticas: [{ id: 1, por_que: 'a' }, { id: 2, por_que: 'b' }], metas, ...extra });
const meta = (numero, valor) => ({ numero, valor, responsable_rol: 'gerente', por_que: 'c' });

test('base del mismo mes en 0: se usa el promedio de 8 semanas; si tambien es 0 se descarta con "base en 0"', () => {
  const bases = { conversion: { promedio_8: 200, mismo_mes: 0 }, pct_con_cliente: { promedio_8: 0, mismo_mes: 0 }, recompra_90: { promedio_8: null, mismo_mes: 0 } };
  const r = validarPropuestaMes(prop([meta('conversion', 21), meta('pct_con_cliente', 5), meta('recompra_90', 5)]), ctxMin(bases));
  assert.equal(r.metas.length, 1);
  assert.equal(r.metas[0].numero, 'conversion');
  assert.equal(r.metas[0].base, 20);
  assert.deepEqual(r.descartadas.map(d => [d.numero, d.motivo]), [['pct_con_cliente', 'base en 0'], ['recompra_90', 'base en 0']]);
});

test('bases chicas: el minimo es base + 1 unidad de la escala y el maximo no baja de ese minimo', () => {
  const bases = { clientes_nuevos: { promedio_8: null, mismo_mes: 3 }, conversion: { promedio_8: 5, mismo_mes: null },
    ticket_promedio_centavos: { promedio_8: 4, mismo_mes: null }, articulos_por_ticket: { promedio_8: 9, mismo_mes: null } };
  const r1 = validarPropuestaMes(prop([meta('clientes_nuevos', 3), meta('conversion', 0.5), meta('ticket_promedio_centavos', 0.04)]), ctxMin(bases));
  const r2 = validarPropuestaMes(prop([meta('articulos_por_ticket', 0.09)]), ctxMin(bases));
  const r = { metas: [...r1.metas, ...r2.metas] };
  const por = n => r.metas.find(m => m.numero === n);
  assert.equal(por('clientes_nuevos').valor_entero, 4);
  assert.equal(por('clientes_nuevos').ajustada, true);
  assert.equal(por('conversion').valor_entero, 6);
  assert.equal(por('ticket_promedio_centavos').valor_entero, 5);
  assert.equal(por('articulos_por_ticket').valor_entero, 10);
});

test('con base grande el rango calculado no cambia', () => {
  const r = validarPropuestaMes(prop([meta('clientes_nuevos', 100)]), ctxMin({ clientes_nuevos: { promedio_8: 40, mismo_mes: null } }));
  assert.equal(r.metas[0].valor_entero, 46);
  assert.deepEqual(r.metas[0].rango, { minimo: 42, maximo: 46 });
});

test('una base en el tope de 100 % se descarta con "ya esta en el maximo"; una base de 99.9 % queda en 100', () => {
  const bases = { pct_con_cliente: { promedio_8: 1000, mismo_mes: null }, recompra_90: { promedio_8: 999, mismo_mes: null },
    conversion: { promedio_8: 400, mismo_mes: null } };
  const r = validarPropuestaMes(prop([meta('pct_con_cliente', 100), meta('recompra_90', 100), meta('conversion', 42)]), ctxMin(bases));
  assert.deepEqual(r.descartadas.map(d => [d.numero, d.motivo]), [['pct_con_cliente', 'ya está en el máximo']]);
  assert.equal(r.metas.find(m => m.numero === 'recompra_90').valor_entero, 1000);
});

test('pct_con_cliente sin dato fuerza calidad_dato igual que menos de 50', t => {
  const { sqlite, DB } = preparar(t);
  sqlite.prepare('DELETE FROM sicar_ventas').run();
  sqlite.prepare('DELETE FROM sicar_ventas_mostrador').run();
  const ctx = armarDatosPlanMes(sqlite, DB, { sucursal_id: 1, mes: MES, hoy: HOY });
  assert.equal(ctx.bases.pct_con_cliente.promedio_8, null);
  assert.equal(ctx.calidad_primero, true);
  const r = validarPropuestaMes(prop([meta('ticket_promedio_centavos', 110)]), ctxMin({ ticket_promedio_centavos: { promedio_8: 10000, mismo_mes: null } },
    { calidad_primero: ctx.calidad_primero }));
  assert.equal(r.camino, 'calidad_dato');
  assert.equal(r.camino_forzado, true);
});

test('descuento: se evalua sobre el por_que crudo y con mas palabras', () => {
  const ctx = ctxMin({ clientes_nuevos: { promedio_8: 40, mismo_mes: null } });
  const con = por_que => validarPropuestaMes(prop([meta('clientes_nuevos', 44)], { camino: 'conversion', tacticas: [{ id: 1, por_que }, { id: 2, por_que: 'b' }] }), ctx);
  assert.equal(con('20 % de descuento a quien compre').tacticas[0].rechazada, true, 'numero inventado y descuento');
  for (const palabra of ['una oferta', 'promoción de temporada', 'un 2x1', 'el 3x2', 'precio especial', 'una rebaja']) {
    assert.equal(con(`Dar ${palabra}`).tacticas[0].rechazada, true, palabra);
  }
  assert.equal(con('Pedir el correo').tacticas[0].rechazada, undefined);
  const nombre = { ...ctx, datos: { manual: [tac(1, 'Oferta del mes'), tac(2, 'b')] } };
  assert.equal(validarPropuestaMes(prop([meta('clientes_nuevos', 44)], { camino: 'conversion' }), nombre).tacticas[0].rechazada, true);
});

test('numeros escritos con letra en el por que se reemplazan por el texto fijo', () => {
  const ctx = ctxMin({ clientes_nuevos: { promedio_8: 40, mismo_mes: null } });
  const porQueDe = texto => validarPropuestaMes(prop([meta('clientes_nuevos', 44)], { por_que_camino: texto }), ctx).por_que_camino;
  for (const texto of ['Vendimos el doble', 'Subio el triple', 'La mitad de clientes', 'Un diez por ciento mas', 'Bajo cuarenta', 'Son cincuenta', 'Casi cien', 'Mil piezas']) {
    assert.equal(porQueDe(texto), TEXTO_FIJO, texto);
  }
  assert.equal(porQueDe('Faltan clientes nuevos'), 'Faltan clientes nuevos');
});

test('el gerente ve el nombre real de la tactica; a la IA se le manda el saneado', t => {
  const { sqlite, DB } = preparar(t);
  const { crearTactica } = require('./manual');
  const nueva = crearTactica(DB, { nombre: 'Llamar a Marisol cada semana', camino: 'prospectos', numero_que_mueve: 'clientes_nuevos',
    quien: ['vendedor'], como_se_mide: 'sistema' }, 1);
  DB.pos.cinco_caminos.tacticas.find(x => x.id === nueva.id).etiquetas = { 1: { estado: 'probada', mes: '2026-09', resultado: 'Marisol Gordillo lo logro' } };
  const ctx = armarDatosPlanMes(sqlite, DB, { sucursal_id: 1, mes: MES, hoy: HOY });
  const enviada = ctx.datos.manual.find(x => x.id === nueva.id);
  assert.match(enviada.nombre, /\[persona\]/);
  assert.match(enviada.etiqueta_tienda.resultado, /\[persona\]/);
  assert.doesNotMatch(JSON.stringify(ctx.datos), /marisol|gordillo/i);
  const otra = ctx.datos.manual.find(x => x.id !== nueva.id).id;
  const r = validarPropuestaMes(prop([meta('ticket_promedio_centavos', 110)], { tacticas: [{ id: nueva.id, por_que: 'a' }, { id: otra, por_que: 'b' }] }),
    { ...ctx, bases: { ticket_promedio_centavos: { promedio_8: 10000, mismo_mes: null } }, calidad_primero: false });
  assert.equal(r.tacticas[0].nombre, 'Llamar a Marisol cada semana');
});

test('constancia en el plan del mes cuando el servidor forzo el camino y el gerente lo cambio', async t => {
  const { sqlite, DB } = preparar(t);
  const forzado = await proponer(sqlite, DB);
  forzado.propuesta.camino_forzado = true;
  const h = validarPlanMes(DB, forzado.id, decisionesTodas(forzado, { camino: { decision: 'cambiar', camino: 'venta_promedio' } }), USUARIO);
  assert.equal(h.estado, 'validado');
  const [mes] = DB.pos.cinco_caminos.planes_mes;
  assert.equal(mes.camino_forzado_por_servidor, true);
  assert.equal(mes.camino_cambiado_por_gerente, true);
  const { sqlite: s2, DB: DB2 } = preparar(t);
  const normal = await proponer(s2, DB2);
  validarPlanMes(DB2, normal.id, decisionesTodas(normal), USUARIO);
  const [m2] = DB2.pos.cinco_caminos.planes_mes;
  assert.equal(m2.camino_forzado_por_servidor, false);
  assert.equal(m2.camino_cambiado_por_gerente, false);
});

// ---- Correcciones de la revision de la Task 2 ----
test('un descuento rechazado por el servidor no se puede aceptar ni cambiar de vuelta (camino conversion)', async t => {
  const { sqlite, DB } = preparar(t);
  const plan = await proponer(sqlite, DB, clienteFalso({ camino: 'conversion' }));
  const [a, b] = plan.propuesta.tacticas;
  // Aceptar la que el servidor marco como descuento.
  a.rechazada = true;
  a.habla_de_descuento = true;
  assert.throws(() => validarPlanMes(DB, plan.id, decisionesTodas(plan), USUARIO), e => e.status === 400 && /descuento/i.test(e.message));
  // Cambiar a otra tactica cuyo nombre real habla de descuento.
  const otra = DB.pos.cinco_caminos.tacticas.find(x => x.activa && x.como_se_mide !== 'fase_2' && x.como_se_mide !== 'fase_3'
    && x.id !== a.id && x.id !== b.id);
  otra.nombre = 'Rebaja para quien compre hoy';
  assert.throws(() => validarPlanMes(DB, plan.id, decisionesTodas(plan, {
    tacticas: [{ id: a.id, decision: 'rechazar' }, { id: b.id, decision: 'cambiar', nuevo_id: otra.id }] }), USUARIO), e => e.status === 400);
  assert.equal(DB.pos.metas_personalizadas.length, 0);
  // Rechazar la marcada y quedarse con la otra si pasa.
  const hecho = validarPlanMes(DB, plan.id, decisionesTodas(plan, { tacticas: [{ id: a.id, decision: 'rechazar' }, { id: b.id, decision: 'aceptar' }] }), USUARIO);
  assert.equal(hecho.estado, 'validado');
});

test('la marca habla_de_descuento se guarda al proponer, aunque el camino no sea conversion, y cambiar a conversion la revisa', async t => {
  const { sqlite, DB } = preparar(t);
  const cliente = clienteFalso();
  const base = await proponer(sqlite, DB, cliente);
  assert.equal(base.propuesta.tacticas.every(x => x.habla_de_descuento === false), true);
  const idA = base.propuesta.tacticas[0].id;
  const plan = await proponer(sqlite, DB, { messages: { create: async cuerpo => {
    const r = await cliente.messages.create(cuerpo);
    const texto = JSON.parse(r.content[0].text);
    texto.tacticas[0].por_que = 'Dar 777 % de descuento';
    return { ...r, content: [{ type: 'text', text: JSON.stringify(texto) }] };
  } } }, { sucursal_id: 1, mes: '2026-11' });
  assert.equal(plan.propuesta.camino, 'prospectos');
  assert.equal(plan.propuesta.tacticas[0].habla_de_descuento, true);
  assert.equal(plan.propuesta.tacticas[0].rechazada, undefined);
  assert.equal(plan.propuesta.tacticas[0].por_que, 'Propuesta basada en los números de la tienda');
  void idA;
  assert.throws(() => validarPlanMes(DB, plan.id, decisionesTodas(plan, { camino: { decision: 'cambiar', camino: 'conversion' } }), USUARIO),
    e => e.status === 400);
  assert.equal(validarPlanMes(DB, plan.id, decisionesTodas(plan), USUARIO).estado, 'validado');
});

test('"sin descuento" no cuenta como descuento (tactica 18 de la semilla)', async t => {
  const { sqlite, DB } = preparar(t);
  const t18 = DB.pos.cinco_caminos.tacticas.find(x => x.id === 18);
  assert.match(t18.nombre, /sin descuento/);
  const { crearTactica } = require('./manual');
  void crearTactica;
  const ctx = armarDatosPlanMes(sqlite, DB, { sucursal_id: 1, mes: MES, hoy: HOY });
  const r = validarPropuestaMes(prop([meta('ticket_promedio_centavos', 110)], { camino: 'conversion',
    tacticas: [{ id: 18, por_que: 'Avisar sin descuentos' }, { id: ctx.datos.manual.find(x => x.id !== 18).id, por_que: 'b' }] }),
  { ...ctx, bases: { ticket_promedio_centavos: { promedio_8: 10000, mismo_mes: null } }, calidad_primero: false });
  assert.equal(r.tacticas[0].rechazada, undefined);
  assert.equal(r.tacticas[0].habla_de_descuento, false);
});

test('un mes sellado entre proponer y validar da 400 claro y no crea nada', async t => {
  const { sqlite, DB } = preparar(t);
  const plan = await proponer(sqlite, DB);
  DB.pos.meta_sellos.push({ periodo: 'mensual', inicio: `${MES}-01` });
  assert.throws(() => validarPlanMes(DB, plan.id, decisionesTodas(plan), USUARIO), e => e.status === 400 && /sellado/.test(e.message));
  assert.equal(DB.pos.metas_personalizadas.length, 0);
  assert.equal(plan.estado, 'borrador');
});

test('numeros con letra: se aceptan si la cifra esta en los datos; "cinco caminos" y "dos tacticas" siempre', () => {
  const ctx = ctxMin({ clientes_nuevos: { promedio_8: 40, mismo_mes: null } }, { cifrasPermitidas: [10] });
  const porQueDe = texto => validarPropuestaMes(prop([meta('clientes_nuevos', 44)], { por_que_camino: texto }), ctx).por_que_camino;
  assert.equal(porQueDe('Cada diez tickets falta un registro'), 'Cada diez tickets falta un registro');
  assert.equal(porQueDe('Los cinco caminos del mes'), 'Los cinco caminos del mes');
  assert.equal(porQueDe('Las dos tácticas sirven'), 'Las dos tácticas sirven');
  assert.equal(porQueDe('Cada once tickets'), TEXTO_FIJO);
  assert.equal(porQueDe('Vendimos el doble'), TEXTO_FIJO);
});

test('aprobado_por_nombre sale al leer y no se guarda', async t => {
  const { sqlite, DB } = preparar(t);
  DB.admin.usuarios.push({ id: USUARIO.id, nombre: 'Victor Real' });
  DB.pos.meta_capturas = [];
  const plan = await proponer(sqlite, DB);
  validarPlanMes(DB, plan.id, decisionesTodas(plan), USUARIO);
  const { verPlanMes } = require('./planMes');
  const visor = { vendedor_id: null, usuario_id: 1, jefatura: false, verTodas: true, sucursalId: 1 };
  const vista = verPlanMes(DB, { sucursal_id: 1, mes: MES, visor, hoy: HOY });
  assert.equal(vista.plan.aprobado_por_nombre, 'Victor Real');
  assert.equal('aprobado_por_nombre' in DB.pos.cinco_caminos.planes_mes[0], false);
});
