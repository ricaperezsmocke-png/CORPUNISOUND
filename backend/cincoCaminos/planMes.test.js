const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { crearRepositorioSicar } = require('../sicarRepositorio');
const { sembrarManual, crearTactica, retirarTactica } = require('./manual');
const { armarDatosPlanMes, validarPropuestaMes, TEXTO_POR_QUE } = require('./planMes');

const HOY = '2026-10-26';
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
  const DB = { pos: { cinco_caminos: { categorias: [] }, sucursales: [{ id: 1, nombre: 'Ocosingo' }],
    vendedores: [{ id: 1, nombre: 'Marisol Gordillo' }], metas_personalizadas: [] }, radar_demanda: { registros: [] }, admin: { usuarios: [] } };
  sembrarManual(DB);
  // Semana con 30 ventas de mostrador y `k` con cliente: pct_con_cliente = k / (30 + k).
  const semana = (lunes, k) => {
    for (let i = 0; i < 30; i++) {
      sqlite.prepare(`INSERT INTO sicar_ventas_mostrador (sucursal_id, ven_id, fecha_local, estado, total_centavos, actualizado_en)
        VALUES (1, ?, ?, 'vigente', 10000, 'x')`).run(String(++siguiente), `${sumar(lunes, i % 7)}T10:00:00`);
    }
    for (let i = 0; i < k; i++) {
      const cli = `c${++siguiente}`;
      sqlite.prepare('INSERT INTO sicar_clientes(sucursal_id, cli_id, nombre) VALUES (1, ?, ?)').run(cli, cli);
      sqlite.prepare(`INSERT INTO sicar_ventas (sucursal_id, ven_id, cli_id, fecha_local, estado, total_centavos, revision, hash)
        VALUES (1, ?, ?, ?, 'vigente', 10000, '1', 'h')`).run(String(++siguiente), cli, `${sumar(lunes, i % 7)}T12:00:00`);
    }
  };
  // Las 8 semanas cerradas antes de HOY y las 4 semanas de octubre de 2025.
  const llenar = (kActual, k2025) => {
    for (let i = 1; i <= 8; i++) semana(sumar(HOY, -7 * i), kActual);
    for (const lunes of ['2025-10-06', '2025-10-13', '2025-10-20', '2025-10-27']) semana(lunes, k2025);
  };
  return { sqlite, DB, llenar };
}
const armar = (sqlite, DB) => armarDatosPlanMes(sqlite, DB, { sucursal_id: 1, mes: '2026-10', hoy: HOY });

test('los datos no traen nombres de persona y traen los 7 numeros legibles', t => {
  const { sqlite, DB, llenar } = preparar(t);
  crearTactica(DB, { nombre: 'Llamar a Marisol cada semana', camino: 'prospectos', numero_que_mueve: 'clientes_nuevos',
    quien: ['vendedor'], como_se_mide: 'sistema' }, 1);
  llenar(13, 30);
  const r = armar(sqlite, DB);
  assert.doesNotMatch(JSON.stringify(r.datos).toLowerCase(), /marisol|gordillo/);
  assert.match(JSON.stringify(r.datos), /\[persona\]/);
  assert.equal(Object.keys(r.datos.numeros).length, 7);
  assert.equal(r.datos.numeros.pct_con_cliente.promedio_8_semanas, 30.2);
  assert.equal(r.datos.numeros.pct_con_cliente.mismo_mes_2025, 50);
  assert.equal(r.datos.numeros.ticket_promedio_centavos.promedio_8_semanas, 100);
  assert.equal(r.datos.fecha_hoy, HOY);
  assert.ok('registros_por_10_tickets' in r.datos);
  assert.ok(!('registros_por_10_tickets' in r.datos.numeros));
});

test('las tacticas de fase 2 y 3 y las retiradas no se envian', t => {
  const { sqlite, DB, llenar } = preparar(t);
  llenar(13, 30);
  const todas = DB.pos.cinco_caminos.tacticas;
  const fase = todas.filter(x => x.como_se_mide === 'fase_3' || x.como_se_mide === 'fase_2');
  assert.ok(fase.length > 0);
  const activa = todas.find(x => x.activa && !fase.includes(x));
  retirarTactica(DB, activa.id, 'ya no aplica', 1);
  const manual = armar(sqlite, DB).datos.manual;
  const ids = manual.map(x => x.id);
  for (const x of fase) assert.ok(!ids.includes(x.id));
  assert.ok(!ids.includes(activa.id));
  assert.ok(ids.length > 0);
  assert.deepEqual(Object.keys(manual[0]).sort(),
    ['camino', 'candado', 'como_se_mide', 'etiqueta_tienda', 'id', 'nombre', 'numero_que_mueve', 'probada_en', 'quien', 'resultados_otras_tiendas']);
});

test('con pct_con_cliente de 30 el camino queda forzado a calidad_dato', t => {
  const { sqlite, DB, llenar } = preparar(t);
  llenar(13, 30);
  const ctx = armar(sqlite, DB);
  const [a, b] = ctx.datos.manual.map(x => x.id);
  const r = validarPropuestaMes({ camino: 'conversion', por_que_camino: 'Va mal', tacticas: [{ id: a, por_que: 'x' }, { id: b, por_que: 'y' }],
    metas: [{ numero: 'ticket_promedio_centavos', valor: 110, responsable_rol: 'gerente', por_que: 'z' }] }, ctx);
  assert.equal(r.camino, 'calidad_dato');
  assert.equal(r.camino_forzado, true);
  assert.equal(r.camino_ia, 'conversion');
  assert.equal(r.metas[0].fuera_de_camino, true);
});

test('con pct_con_cliente de 50 o mas el camino de la IA se respeta', t => {
  const { sqlite, DB, llenar } = preparar(t);
  llenar(60, 60);
  const ctx = armar(sqlite, DB);
  const [a, b] = ctx.datos.manual.map(x => x.id);
  const r = validarPropuestaMes({ camino: 'prospectos', por_que_camino: 'Va mal', tacticas: [{ id: a, por_que: 'x' }, { id: b, por_que: 'y' }],
    metas: [{ numero: 'ticket_promedio_centavos', valor: 110, responsable_rol: 'vendedores', por_que: 'z' }] }, ctx);
  assert.equal(r.camino, 'prospectos');
  assert.equal(r.camino_forzado, false);
  assert.equal(r.metas[0].fuera_de_camino, undefined);
});

// Contexto a mano para las reglas de validacion.
function contexto(sobre = {}) {
  const t = (id, nombre, camino = 'prospectos') => ({ id, nombre, camino, numero_que_mueve: 'clientes_nuevos', candado: null, quien: ['vendedor'],
    como_se_mide: 'sistema', probada_en: 0, etiqueta_tienda: { estado: 'por_probar', mes: null, resultado: null } });
  const bases = { pct_con_cliente: { promedio_8: 600, mismo_mes: null }, ticket_promedio_centavos: { promedio_8: 100000, mismo_mes: 120000 },
    clientes_nuevos: { promedio_8: null, mismo_mes: null }, conversion: { promedio_8: 200, mismo_mes: 250 } };
  const datos = { numeros: { pct_con_cliente: { promedio_8_semanas: 60 } }, manual: [t(1, 'Pedir correo'), t(2, 'Rifa'), t(3, 'Regalo de descuento', 'conversion')] };
  return { datos, bases, calidad_primero: false, cifrasPermitidas: [60, 1, 2, 3, 8, 1200], ...sobre };
}
const propuesta = (cambios = {}) => ({ camino: 'conversion', por_que_camino: 'Baja', tacticas: [{ id: 1, por_que: 'a' }, { id: 2, por_que: 'b' }],
  metas: [{ numero: 'ticket_promedio_centavos', valor: 1300, responsable_rol: 'gerente', por_que: 'c' }], ...cambios });

test('una cifra 40% arriba de la base se ajusta a +15%', () => {
  const r = validarPropuestaMes(propuesta({ metas: [{ numero: 'ticket_promedio_centavos', valor: 1680, responsable_rol: 'gerente', por_que: 'c' }] }),
    contexto());
  assert.equal(r.metas[0].valor, 1380);
  assert.equal(r.metas[0].ajustada, true);
  assert.equal(r.metas[0].propuesta_ia, 1680);
});

test('la base es el mismo mes de 2025 y si falta, el promedio de 8 semanas', () => {
  const r = validarPropuestaMes(propuesta({ metas: [{ numero: 'pct_con_cliente', valor: 60.1, responsable_rol: 'encargado', por_que: 'c' },
    { numero: 'ticket_promedio_centavos', valor: 1000, responsable_rol: 'gerente', por_que: 'c' }] }), contexto());
  assert.equal(r.metas[0].valor, 63);
  assert.equal(r.metas[0].ajustada, true);
  assert.equal(r.metas[1].valor, 1260);
});

test('una cifra dentro del rango no se ajusta y se redondea a la escala', () => {
  const r = validarPropuestaMes(propuesta({ metas: [{ numero: 'pct_con_cliente', valor: 66.04, responsable_rol: 'encargado', por_que: 'c' }] }),
    contexto());
  assert.equal(r.metas[0].valor, 66);
  assert.equal(r.metas[0].ajustada, undefined);
});

test('el porcentaje nunca pasa de 100', () => {
  const ctx = contexto();
  ctx.bases.pct_con_cliente.promedio_8 = 950;
  const r = validarPropuestaMes(propuesta({ metas: [{ numero: 'pct_con_cliente', valor: 120, responsable_rol: 'encargado', por_que: 'c' }] }), ctx);
  assert.equal(r.metas[0].valor, 100);
});

test('una base null descarta la meta', () => {
  const r = validarPropuestaMes(propuesta({ metas: [{ numero: 'clientes_nuevos', valor: 5, responsable_rol: 'vendedores', por_que: 'c' },
    { numero: 'conversion', valor: 27, responsable_rol: 'vendedores', por_que: 'c' }] }), contexto());
  assert.deepEqual(r.metas.map(m => m.numero), ['conversion']);
  assert.deepEqual(r.descartadas.map(m => m.numero), ['clientes_nuevos']);
});

test('si todas las metas se descartan la propuesta es invalida', () => {
  assert.throws(() => validarPropuestaMes(propuesta({ metas: [{ numero: 'clientes_nuevos', valor: 5, responsable_rol: 'vendedores', por_que: 'c' }] }),
    contexto()), { planInvalido: true });
});

test('una tactica inexistente, repetida o en numero distinto de 2 invalida la propuesta', () => {
  const mala = tacticas => () => validarPropuestaMes(propuesta({ tacticas }), contexto());
  assert.throws(mala([{ id: 1, por_que: 'a' }, { id: 99, por_que: 'b' }]), { planInvalido: true });
  assert.throws(mala([{ id: 1, por_que: 'a' }, { id: 1, por_que: 'b' }]), { planInvalido: true });
  assert.throws(mala([{ id: 1, por_que: 'a' }]), { planInvalido: true });
  assert.throws(mala([{ id: 1, por_que: 'a' }, { id: 2, por_que: 'b' }, { id: 3, por_que: 'c' }]), { planInvalido: true });
  assert.doesNotThrow(mala([{ id: '1', por_que: 'a' }, { id: 2, por_que: 'b' }]));
});

test('un numero inventado en el por que se reemplaza por texto fijo', () => {
  const r = validarPropuestaMes(propuesta({ por_que_camino: 'Vendimos 777 piezas menos',
    tacticas: [{ id: 1, por_que: 'Subio 60 %' }, { id: 2, por_que: 'Dejo 4242' }],
    metas: [{ numero: 'ticket_promedio_centavos', valor: 1300, responsable_rol: 'gerente', por_que: 'Meta de 9999' }] }), contexto());
  assert.equal(r.por_que_camino, TEXTO_POR_QUE);
  assert.equal(r.tacticas[0].por_que, 'Subio 60 %');
  assert.equal(r.tacticas[1].por_que, TEXTO_POR_QUE);
  assert.equal(r.metas[0].por_que, TEXTO_POR_QUE);
});

test('una tactica de descuento con camino conversion se rechaza', () => {
  const r = validarPropuestaMes(propuesta({ tacticas: [{ id: 3, por_que: 'a' }, { id: 2, por_que: 'Dar una rebaja al cliente' }] }), contexto());
  assert.equal(r.tacticas[0].rechazada, true);
  assert.equal(r.tacticas[1].rechazada, true);
  const otro = validarPropuestaMes(propuesta({ camino: 'prospectos', tacticas: [{ id: 3, por_que: 'a' }, { id: 2, por_que: 'b' }] }), contexto());
  assert.equal(otro.tacticas[0].rechazada, undefined);
});

test('registros_por_10_tickets como meta invalida la propuesta', () => {
  assert.throws(() => validarPropuestaMes(propuesta({ metas: [{ numero: 'registros_por_10_tickets', valor: 5, responsable_rol: 'gerente', por_que: 'c' }] }),
    contexto()), { planInvalido: true });
});

test('forma invalida: camino margen, responsable ajeno, sin metas, mas de 3 metas, numero repetido', () => {
  const m = n => ({ numero: n, valor: 1300, responsable_rol: 'gerente', por_que: 'c' });
  const invalida = cambios => () => validarPropuestaMes(propuesta(cambios), contexto());
  assert.throws(invalida({ camino: 'margen' }), { planInvalido: true });
  assert.throws(invalida({ metas: [{ ...m('conversion'), responsable_rol: 'Juan' }] }), { planInvalido: true });
  assert.throws(invalida({ metas: [] }), { planInvalido: true });
  assert.throws(invalida({ metas: [m('conversion'), m('conversion')] }), { planInvalido: true });
  assert.throws(invalida({ metas: [m('conversion'), m('pct_con_cliente'), m('ticket_promedio_centavos'), m('clientes_nuevos')] }), { planInvalido: true });
  assert.throws(() => validarPropuestaMes(null, contexto()), { planInvalido: true });
});

// ---- P5, Task 4: la IA ve lo probado en otras tiendas, sin saber cuales ----
const cierre = (sucursal_id, mes, tacticas) => ({ id: `${sucursal_id}-${mes}`, sucursal_id, mes, plan_mes_id: 1, cerrado_en: `${mes}-28T12:00:00.000Z`, tacticas });
const resultado = (id, res, cambio, candado = null) => ({ id, como_se_mide: 'sistema', numero: 'pct_con_cliente', valor: 600, base: 500,
  base_tipo: 'promedio_8', cambio_pct: cambio, candado: null, candado_valor: null, candado_base: null, candado_cambio_pct: candado,
  evidencia: null, resultado: res, en_conjunto_con: null, texto: 'x' });

test('un cierre probada de otra tienda llega a la IA sin id ni nombre de esa tienda', t => {
  const { sqlite, DB, llenar } = preparar(t);
  DB.pos.sucursales.push({ id: 2, nombre: 'Yajalón' });
  llenar(30, 30);
  DB.pos.cinco_caminos.cierres = [cierre(2, '2026-09', [resultado(1, 'probada', 12.3, -2.1), resultado(2, 'no_funciono', 1.2)])];
  const r = armar(sqlite, DB);
  const t1 = r.datos.manual.find(x => x.id === 1);
  assert.deepEqual(t1.resultados_otras_tiendas, [{ mes: '2026-09', numero: 'pct_con_cliente', cambio_pct: 12.3, candado_cambio_pct: -2.1 }]);
  assert.deepEqual(r.datos.manual.find(x => x.id === 2).resultados_otras_tiendas, [], 'no_funciono no se replica');
  const texto = JSON.stringify(r.datos.manual);
  assert.doesNotMatch(texto, /Yajal|sucursal|tienda_id|"2-2026/);
  assert.ok(r.cifrasPermitidas.includes(12.3));
});

test('los cierres de la propia tienda no se repiten en resultados_otras_tiendas', t => {
  const { sqlite, DB, llenar } = preparar(t);
  llenar(30, 30);
  DB.pos.cinco_caminos.cierres = [cierre(1, '2026-09', [resultado(1, 'probada', 12.3)])];
  assert.deepEqual(armar(sqlite, DB).datos.manual.find(x => x.id === 1).resultados_otras_tiendas, []);
});

test('maximo 3 resultados de otras tiendas, los mas recientes primero', t => {
  const { sqlite, DB, llenar } = preparar(t);
  llenar(30, 30);
  DB.pos.cinco_caminos.cierres = ['2026-05', '2026-08', '2026-06', '2026-09', '2026-07'].map((mes, i) => cierre(2 + (i % 2), mes, [resultado(1, 'probada', 10 + i)]));
  const lista = armar(sqlite, DB).datos.manual.find(x => x.id === 1).resultados_otras_tiendas;
  assert.deepEqual(lista.map(x => x.mes), ['2026-09', '2026-08', '2026-07']);
});

test('un por que que cita la cifra de otra tienda se queda; uno con una cifra inventada se reemplaza', t => {
  const { sqlite, DB, llenar } = preparar(t);
  llenar(30, 30);
  DB.pos.cinco_caminos.cierres = [cierre(2, '2026-09', [resultado(1, 'probada', 12.3, -2.1)])];
  const ctx = armar(sqlite, DB);
  const otra = ctx.datos.manual.find(x => x.id !== 1).id;
  const proponer = porQue => validarPropuestaMes({ camino: 'calidad_dato', por_que_camino: 'x', tacticas: [{ id: 1, por_que: porQue }, { id: otra, por_que: 'b' }],
    metas: [{ numero: 'ticket_promedio_centavos', valor: 110, responsable_rol: 'gerente', por_que: 'c' }] }, ctx).tacticas[0].por_que;
  assert.equal(proponer('En otra tienda subió 12.3 % y su candado bajó 2.1 %'), 'En otra tienda subió 12.3 % y su candado bajó 2.1 %');
  assert.equal(proponer('En otra tienda subió 17.8 %'), TEXTO_POR_QUE);
});

test('las instrucciones piden proponer primero lo probado en otras tiendas', () => {
  const { INSTRUCCIONES_MES } = require('./planMes');
  assert.match(INSTRUCCIONES_MES, /Si una táctica del camino más débil tiene resultados en otras tiendas, propónla primero y cita su cifra/);
});
