const { test } = require('node:test');
const assert = require('node:assert/strict');
const { evaluarTactica, evaluarPlan, textoResultado } = require('./cierreMes');

const MES = '2026-10';
// Táctica por sistema que mueve el ticket promedio con candado artículos por ticket. Las cifras son enteros como en el tablero.
function tactica(cambios = {}) {
  return { id: 24, como_se_mide: 'sistema', mes: MES, numero: 'ticket_promedio_centavos', valor: 10500, base: 10000, base_tipo: 'mismo_mes',
    candado: 'articulos_por_ticket', candado_valor: 150, candado_base: 150, evidencia: null, ...cambios };
}
const captura = (id, fecha, extra = {}) => ({ id, meta_clave: 9, fecha, cantidad: 1, evidencia: { tipo: 'foto' }, anulada: null, ...extra });
const evidencia = (capturas, requeridas = 3) => ({ meta_clave: 9, requeridas, capturas });

test('+5.0 % exacto es probada; +4.9 % es no_funciono', () => {
  assert.equal(evaluarTactica(tactica({ valor: 10500 })).resultado, 'probada');
  assert.equal(evaluarTactica(tactica({ valor: 10490 })).resultado, 'no_funciono');
  assert.equal(evaluarTactica(tactica({ numero: 'pct_con_cliente', candado: null, valor: 630, base: 600 })).resultado, 'probada');
  assert.equal(evaluarTactica(tactica({ numero: 'pct_con_cliente', candado: null, valor: 629, base: 600 })).resultado, 'no_funciono');
  const r = evaluarTactica(tactica({ valor: 11230 }));
  assert.equal(r.cambio_pct, 12.3);
});

test('candado que cae 5.1 % no funciona; 4.9 % si', () => {
  assert.equal(evaluarTactica(tactica({ valor: 12000, candado_valor: 949, candado_base: 1000 })).resultado, 'no_funciono');
  const bien = evaluarTactica(tactica({ valor: 12000, candado_valor: 951, candado_base: 1000 }));
  assert.equal(bien.resultado, 'probada');
  assert.equal(bien.candado_cambio_pct, -4.9);
  assert.equal(evaluarTactica(tactica({ valor: 12000, candado_valor: 950, candado_base: 1000 })).resultado, 'probada', '-5.0 % exacto no cae');
});

test('candado de registros del Radar: cae 29 % bien, 31 % no funciona', () => {
  const radar = c => tactica({ numero: 'conversion', valor: 300, base: 250, candado: 'registros_por_10_tickets', candado_base: 400, ...c });
  assert.equal(evaluarTactica(radar({ candado_valor: 284 })).resultado, 'probada');
  assert.equal(evaluarTactica(radar({ candado_valor: 276 })).resultado, 'no_funciono');
  assert.equal(evaluarTactica(radar({ candado_valor: 280 })).resultado, 'probada', '-30 % exacto no cae');
});

test('base del mismo mes null: se usa la de 8 semanas y el texto lo dice', () => {
  const mismo = evaluarTactica(tactica({ valor: 11000 }));
  assert.match(mismo.texto, /contra mismo mes 2025/);
  const ocho = evaluarTactica(tactica({ valor: 11000, base_tipo: 'promedio_8' }));
  assert.equal(ocho.resultado, 'probada');
  assert.equal(ocho.base_tipo, 'promedio_8');
  assert.match(ocho.texto, /contra 8 semanas previas/);
  assert.equal(ocho.texto, 'Ticket promedio: $100.00 → $110.00 (+10.0 %) contra 8 semanas previas; candado Artículos por ticket bien');
});

test('numero, base, base 0 y valor del candado sin dato dan sin_dato', () => {
  const hecha = evidencia([captura(1, '2026-10-05')], 1);
  assert.equal(evaluarTactica(tactica({ como_se_mide: 'evidencia', evidencia: hecha, valor: null })).resultado, 'sin_dato');
  assert.equal(evaluarTactica(tactica({ base: null, base_tipo: null })).resultado, 'sin_dato');
  assert.equal(evaluarTactica(tactica({ base: 0 })).resultado, 'sin_dato');
  assert.equal(evaluarTactica(tactica({ base: -5 })).resultado, 'sin_dato');
  assert.equal(evaluarTactica(tactica({ valor: 12000, candado_valor: null })).resultado, 'sin_dato');
  assert.equal(evaluarTactica(tactica({ valor: 12000, candado_base: null })).resultado, 'sin_dato');
  assert.equal(evaluarTactica(tactica({ valor: 12000, candado_base: 0 })).resultado, 'sin_dato');
  // Sin candado no cae nunca.
  assert.equal(evaluarTactica(tactica({ valor: 12000, candado: null, candado_valor: null, candado_base: null })).resultado, 'probada');
  // Las de fase 2 o 3 no se califican.
  assert.equal(evaluarTactica(tactica({ como_se_mide: 'fase_3' })).resultado, 'sin_dato');
  // Por sistema, sin valor del mes no se hizo.
  assert.equal(evaluarTactica(tactica({ valor: null })).resultado, 'no_se_hizo');
});

test('evidencia: 2 de 3 no se hizo; una anulada o fuera del mes no cuenta', () => {
  const ev = c => evaluarTactica(tactica({ como_se_mide: 'evidencia', valor: 11000, evidencia: evidencia(c) }));
  const dos = ev([captura(1, '2026-10-02'), captura(2, '2026-10-20')]);
  assert.equal(dos.resultado, 'no_se_hizo');
  assert.deepEqual(dos.evidencia, { meta_clave: 9, requeridas: 3, capturas_contadas: [1, 2] });
  assert.match(dos.texto, /2 de 3/);
  const tres = ev([captura(1, '2026-10-02'), captura(2, '2026-10-20'), captura(3, '2026-10-31')]);
  assert.equal(tres.resultado, 'probada');
  assert.deepEqual(tres.evidencia.capturas_contadas, [1, 2, 3]);
  const anulada = ev([captura(1, '2026-10-02'), captura(2, '2026-10-20'), captura(3, '2026-10-21', { anulada: { motivo: 'basura' } })]);
  assert.equal(anulada.resultado, 'no_se_hizo');
  assert.deepEqual(anulada.evidencia.capturas_contadas, [1, 2]);
  const fuera = ev([captura(1, '2026-10-02'), captura(2, '2026-10-20'), captura(3, '2026-11-01'), captura(4, '2026-09-30')]);
  assert.equal(fuera.resultado, 'no_se_hizo');
  // Sin meta ligada (plan aprobado antes de P5): no se hizo.
  assert.equal(evaluarTactica(tactica({ como_se_mide: 'evidencia', valor: 11000, evidencia: null })).resultado, 'no_se_hizo');
});

test('sistema_y_evidencia con numero pero sin evidencia no se hizo', () => {
  const sin = evaluarTactica(tactica({ como_se_mide: 'sistema_y_evidencia', valor: 11000, evidencia: evidencia([], 1) }));
  assert.equal(sin.resultado, 'no_se_hizo');
  const con = evaluarTactica(tactica({ como_se_mide: 'sistema_y_evidencia', valor: 11000, evidencia: evidencia([captura(1, '2026-10-02')], 1) }));
  assert.equal(con.resultado, 'probada');
  const sinNumero = evaluarTactica(tactica({ como_se_mide: 'sistema_y_evidencia', valor: null, evidencia: evidencia([captura(1, '2026-10-02')], 1) }));
  assert.equal(sinNumero.resultado, 'no_se_hizo');
});

test('dos probada del mismo numero quedan en conjunto, cruzadas', () => {
  const [a, b] = evaluarPlan([tactica({ id: 24, valor: 11000 }), tactica({ id: 25, valor: 11000 })]);
  assert.equal(a.resultado, 'probada');
  assert.equal(a.en_conjunto_con, 25);
  assert.equal(b.en_conjunto_con, 24);
  assert.match(a.texto, /en conjunto con otra táctica/);
  const [c, d] = evaluarPlan([tactica({ id: 24, valor: 11000 }), tactica({ id: 25, valor: 10000 })]);
  assert.equal(c.en_conjunto_con, null);
  assert.equal(d.en_conjunto_con, null);
  const [e, f] = evaluarPlan([tactica({ id: 24, valor: 11000 }), tactica({ id: 22, numero: 'articulos_por_ticket', candado: null, valor: 200, base: 150 })]);
  assert.equal(e.en_conjunto_con, null);
  assert.equal(f.en_conjunto_con, null);
});

test('el texto no pasa de 300 caracteres y usa las unidades legibles', () => {
  const r = evaluarTactica(tactica({ valor: 99999999, base: 1, candado_valor: 1, candado_base: 99999999 }));
  assert.ok(r.texto.length <= 300);
  const radar = evaluarTactica(tactica({ numero: 'registros_por_10_tickets', candado: null, valor: 250, base: 200, base_tipo: 'promedio_8' }));
  assert.equal(radar.texto, 'Registros del Radar por cada 10 tickets: 2.00 → 2.50 (+25.0 %) contra 8 semanas previas');
  const cayo = evaluarTactica(tactica({ valor: 11000, candado_valor: 929, candado_base: 1000 }));
  assert.equal(cayo.texto, 'Ticket promedio: $100.00 → $110.00 (+10.0 %) contra mismo mes 2025; candado Artículos por ticket cayó -7.1 %');
  for (const extra of [{ evidencia: null, como_se_mide: 'evidencia' }, { base: null }, { como_se_mide: 'fase_2' }]) {
    const t = evaluarTactica(tactica(extra)).texto;
    assert.ok(typeof t === 'string' && t.length > 0 && t.length <= 300, JSON.stringify(extra));
  }
  assert.equal(textoResultado(cayo, MES), cayo.texto);
});

test('el registro trae los campos del contrato', () => {
  const r = evaluarTactica(tactica({ valor: 11000 }));
  assert.deepEqual(Object.keys(r).sort(), ['base', 'base_tipo', 'cambio_pct', 'candado', 'candado_base', 'candado_cambio_pct', 'candado_valor',
    'como_se_mide', 'en_conjunto_con', 'evidencia', 'id', 'numero', 'resultado', 'texto', 'valor'].sort());
  assert.equal(r.evidencia, null);
});

// ---- Task 3: cierre idempotente sobre una SQLite en memoria, como planMesFlujo.test.js ----
const Database = require('better-sqlite3');
const { crearRepositorioSicar } = require('../sicarRepositorio');
const manual = require('./manual');
const { cerrarMesesPendientes, avanceEvidencias } = require('./cierreMes');
const { reconciliarTrasRestaurar, cerrarTrasRestaurar } = require('../reconciliarRestauracion');

const SEPT = '2026-09';
const GRACIA = '2026-10-08'; // ultimo lunes de septiembre 28 -> se puede sellar el 5 de octubre -> mas 3 dias
const sumar = (dia, dias) => {
  const d = new Date(`${dia}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};

let folio = 0;
// Ocho semanas base (13 jul a 31 ago): 30 de mostrador y 30 con cliente nuevo = 50 % con cliente, 30 nuevos por semana.
// Septiembre: 15 de mostrador y 30 con cliente = 66.7 % con cliente (+33 %) y los mismos 30 nuevos (0 %).
function sembrarTienda(sqlite, suc) {
  sqlite.prepare('INSERT INTO sicar_tiendas(sucursal_id) VALUES (?)').run(suc);
  for (let lunes = '2026-07-13'; lunes <= '2026-09-28'; lunes = sumar(lunes, 7)) {
    const mostrador = lunes >= '2026-09-07' ? 15 : 30;
    for (let j = 0; j < mostrador; j++) {
      sqlite.prepare(`INSERT INTO sicar_ventas_mostrador (sucursal_id, ven_id, fecha_local, estado, total_centavos, actualizado_en)
        VALUES (?, ?, ?, 'vigente', 10000, 'x')`).run(suc, String(++folio), `${sumar(lunes, j % 7)}T10:00:00`);
    }
    for (let j = 0; j < 30; j++) {
      const cli = `c${++folio}`;
      sqlite.prepare('INSERT INTO sicar_clientes(sucursal_id, cli_id, nombre) VALUES (?, ?, ?)').run(suc, cli, cli);
      sqlite.prepare(`INSERT INTO sicar_ventas (sucursal_id, ven_id, cli_id, fecha_local, estado, total_centavos, revision, hash)
        VALUES (?, ?, ?, ?, 'vigente', 10000, '1', 'h')`).run(suc, String(++folio), cli, `${sumar(lunes, j % 7)}T12:00:00`);
    }
  }
}

function prepararCierre(t, tiendas = [1]) {
  const sqlite = new Database(':memory:');
  t.after(() => sqlite.close());
  crearRepositorioSicar(sqlite);
  tiendas.forEach(s => sembrarTienda(sqlite, s));
  const DB = { pos: { cinco_caminos: { categorias: [], planes_mes: [] }, sucursales: tiendas.map(id => ({ id, nombre: `Tienda ${id}` })), vendedores: [],
    metas_personalizadas: [], meta_capturas: [], meta_sellos: [], okrs: [], planes_ia: [] }, radar_demanda: { registros: [] }, admin: { usuarios: [] } };
  manual.sembrarManual(DB);
  return { sqlite, DB };
}
// Tacticas 1 y 2: por sistema, mueven % con cliente sin candado. Tactica 4: evidencia, mueve clientes nuevos con candado % con cliente.
function plan(DB, { sucursal_id = 1, mes = SEPT, tacticas = [1, 2], evidencias = [] } = {}) {
  const p = { id: DB.pos.cinco_caminos.planes_mes.length + 1, sucursal_id, mes, camino: 'calidad_dato', tacticas, metas: [], evidencias };
  DB.pos.cinco_caminos.planes_mes.push(p);
  return p;
}
function metaEvidencia(DB, { clave = 500, veces = 1, sucursal_id = 1, fechas = [] } = {}) {
  DB.pos.metas_personalizadas.push({ id: clave, clave, version: 1, vigente: true, fuente: 'manual', prueba: 'foto', valor_meta: veces,
    periodo: 'mensual', inicio: `${SEPT}-01`, alcance: 'tienda', sucursal_id });
  fechas.forEach((fecha, i) => DB.pos.meta_capturas.push({ id: clave * 10 + i, meta_clave: clave, fecha, cantidad: 1, evidencia: { tipo: 'foto' },
    anulada: null }));
  return clave;
}
const tacticaDe = (DB, id) => DB.pos.cinco_caminos.tacticas.find(x => x.id === id);
const etiquetasDe = (DB, id) => tacticaDe(DB, id).historial.filter(h => h.accion === 'etiqueta');

test('antes de la gracia no cierra; el dia de la gracia si', t => {
  const { sqlite, DB } = prepararCierre(t);
  plan(DB);
  assert.deepEqual(cerrarMesesPendientes(sqlite, DB, { hoy: sumar(GRACIA, -1) }), []);
  assert.deepEqual(DB.pos.cinco_caminos.cierres || [], []);
  assert.equal(tacticaDe(DB, 1).etiquetas['1'], undefined);
  const hechos = cerrarMesesPendientes(sqlite, DB, { hoy: GRACIA });
  assert.equal(hechos.length, 1);
  const [cierre] = DB.pos.cinco_caminos.cierres;
  assert.equal(cierre.sucursal_id, 1);
  assert.equal(cierre.mes, SEPT);
  assert.equal(cierre.plan_mes_id, 1);
  assert.ok(cierre.cerrado_en);
  assert.deepEqual(cierre.tacticas.map(x => [x.id, x.resultado, x.base_tipo]), [[1, 'probada', 'promedio_8'], [2, 'probada', 'promedio_8']]);
  assert.equal(cierre.tacticas[0].valor, 667);
  assert.equal(cierre.tacticas[0].base, 500);
  assert.equal(cierre.tacticas[0].en_conjunto_con, 2);
});

test('correrlo dos veces deja un solo cierre y una sola entrada etiqueta por tactica', t => {
  const { sqlite, DB } = prepararCierre(t);
  plan(DB);
  cerrarMesesPendientes(sqlite, DB, { hoy: GRACIA });
  const antes = JSON.stringify(DB.pos.cinco_caminos);
  assert.deepEqual(cerrarMesesPendientes(sqlite, DB, { hoy: sumar(GRACIA, 30) }), []);
  assert.equal(JSON.stringify(DB.pos.cinco_caminos), antes);
  assert.equal(DB.pos.cinco_caminos.cierres.length, 1);
  assert.equal(etiquetasDe(DB, 1).length, 1);
  assert.equal(etiquetasDe(DB, 2).length, 1);
});

test('probada escribe la etiqueta con mes y resultado, y probada_en sube a 1', t => {
  const { sqlite, DB } = prepararCierre(t);
  plan(DB);
  cerrarMesesPendientes(sqlite, DB, { hoy: GRACIA });
  const etiqueta = tacticaDe(DB, 1).etiquetas['1'];
  assert.equal(etiqueta.estado, 'probada');
  assert.equal(etiqueta.mes, SEPT);
  assert.equal(etiqueta.resultado, 'Ventas con cliente identificado: 50.0 % → 66.7 % (+33.4 %) contra 8 semanas previas; en conjunto con otra táctica del mes');
  assert.equal(etiquetasDe(DB, 1)[0].usuario_id, null, 'la escribe el sistema');
  const vista = manual.vistaManual(DB, { sucursalId: 2 }).find(x => x.id === 1);
  assert.equal(vista.probada_en, 1);
  assert.equal(vista.etiqueta_tienda.estado, 'por_probar');
});

test('no_se_hizo sobre una tactica ya probada no toca su etiqueta, pero queda en el cierre; sobre por_probar deja sin_dato', t => {
  const { sqlite, DB } = prepararCierre(t);
  const previa = { estado: 'probada', mes: '2026-08', resultado: 'Agosto bien' };
  tacticaDe(DB, 4).etiquetas['1'] = { ...previa };
  // La 4 sin capturas y la 6 (tambien por evidencia, sin etiqueta) sin meta ligada.
  plan(DB, { tacticas: [4, 6], evidencias: [{ tactica_id: 4, meta_clave: metaEvidencia(DB, { veces: 2, fechas: ['2026-09-10'] }) }] });
  cerrarMesesPendientes(sqlite, DB, { hoy: GRACIA });
  const [cierre] = DB.pos.cinco_caminos.cierres;
  assert.deepEqual(cierre.tacticas.map(x => x.resultado), ['no_se_hizo', 'no_se_hizo']);
  assert.deepEqual(cierre.tacticas[0].evidencia, { meta_clave: 500, requeridas: 2, capturas_contadas: [5000] });
  assert.equal(cierre.tacticas[1].evidencia, null);
  assert.deepEqual(tacticaDe(DB, 4).etiquetas['1'], previa);
  assert.equal(etiquetasDe(DB, 4).length, 0);
  assert.deepEqual(tacticaDe(DB, 6).etiquetas['1'], { estado: 'sin_dato', mes: SEPT, resultado: 'No se hizo: sin meta de evidencia' });
});

test('no_funciono del mes nuevo sustituye un probada de un mes anterior', t => {
  const { sqlite, DB } = prepararCierre(t);
  tacticaDe(DB, 4).etiquetas['1'] = { estado: 'probada', mes: '2026-08', resultado: 'Agosto bien' };
  plan(DB, { tacticas: [4, 1], evidencias: [{ tactica_id: 4, meta_clave: metaEvidencia(DB, { fechas: ['2026-09-10'] }) }] });
  cerrarMesesPendientes(sqlite, DB, { hoy: GRACIA });
  const etiqueta = tacticaDe(DB, 4).etiquetas['1'];
  assert.equal(etiqueta.estado, 'no_funciono');
  assert.equal(etiqueta.mes, SEPT);
  assert.match(etiqueta.resultado, /^Clientes nuevos por semana: 30 → 30 \(\+0\.0 %\) contra 8 semanas previas; candado Ventas con cliente identificado bien$/);
});

test('sin sqlite no cierra nada y no truena', t => {
  const { DB } = prepararCierre(t);
  plan(DB);
  assert.deepEqual(cerrarMesesPendientes(null, DB, { hoy: GRACIA }), []);
  assert.deepEqual(DB.pos.cinco_caminos.cierres || [], []);
  assert.equal(etiquetasDe(DB, 1).length, 0);
});

test('una tienda que truena no impide cerrar la otra, y la que trono no deja etiquetas a medias', t => {
  const { sqlite, DB } = prepararCierre(t, [1, 2]);
  plan(DB, { sucursal_id: 1 });
  plan(DB, { sucursal_id: 2 });
  const original = manual.fijarEtiqueta;
  let llamadasTienda1 = 0;
  manual.fijarEtiqueta = (DBx, id, suc, datos) => {
    if (Number(suc) === 1 && ++llamadasTienda1 === 2) throw new Error('falla a la segunda etiqueta');
    return original(DBx, id, suc, datos);
  };
  t.after(() => { manual.fijarEtiqueta = original; });
  const avisos = [];
  const warn = console.warn;
  console.warn = (...args) => avisos.push(args.join(' '));
  t.after(() => { console.warn = warn; });
  const hechos = cerrarMesesPendientes(sqlite, DB, { hoy: GRACIA });
  console.warn = warn;
  assert.deepEqual(hechos.map(c => c.sucursal_id), [2]);
  assert.deepEqual(DB.pos.cinco_caminos.cierres.map(c => c.sucursal_id), [2]);
  assert.equal(llamadasTienda1, 2);
  assert.equal(tacticaDe(DB, 1).etiquetas['1'], undefined, 'la primera etiqueta de la tienda 1 se deshizo');
  assert.equal(tacticaDe(DB, 1).historial.filter(h => h.accion === 'etiqueta' && h.despues.sucursal_id === 1).length, 0);
  assert.equal(tacticaDe(DB, 1).etiquetas['2'].estado, 'probada');
  assert.ok(avisos.some(a => /falla a la segunda etiqueta/.test(a)));
  // En la siguiente vuelta, ya sin falla, se cierra la tienda 1.
  manual.fijarEtiqueta = original;
  assert.deepEqual(cerrarMesesPendientes(sqlite, DB, { hoy: GRACIA }).map(c => c.sucursal_id), [1]);
});

test('una tactica retirada del manual despues de aprobar el plan se evalua igual', t => {
  const { sqlite, DB } = prepararCierre(t);
  plan(DB);
  manual.retirarTactica(DB, 1, 'Ya no se usa', 70);
  cerrarMesesPendientes(sqlite, DB, { hoy: GRACIA });
  assert.equal(DB.pos.cinco_caminos.cierres[0].tacticas[0].id, 1);
  assert.equal(tacticaDe(DB, 1).etiquetas['1'].estado, 'probada');
});

test('el mismo mes del año anterior es la base cuando tiene dato', t => {
  const { sqlite, DB } = prepararCierre(t);
  // Septiembre 2025 con 60 % de ventas con cliente: 20 de mostrador y 30 con cliente por semana.
  for (let lunes = '2025-09-01'; lunes <= '2025-09-29'; lunes = sumar(lunes, 7)) {
    for (let j = 0; j < 20; j++) {
      sqlite.prepare(`INSERT INTO sicar_ventas_mostrador (sucursal_id, ven_id, fecha_local, estado, total_centavos, actualizado_en)
        VALUES (1, ?, ?, 'vigente', 10000, 'x')`).run(String(++folio), `${sumar(lunes, j % 7)}T10:00:00`);
    }
    for (let j = 0; j < 30; j++) {
      const cli = `v${++folio}`;
      sqlite.prepare('INSERT INTO sicar_clientes(sucursal_id, cli_id, nombre) VALUES (1, ?, ?)').run(cli, cli);
      sqlite.prepare(`INSERT INTO sicar_ventas (sucursal_id, ven_id, cli_id, fecha_local, estado, total_centavos, revision, hash)
        VALUES (1, ?, ?, ?, 'vigente', 10000, '1', 'h')`).run(String(++folio), cli, `${sumar(lunes, j % 7)}T12:00:00`);
    }
  }
  plan(DB);
  cerrarMesesPendientes(sqlite, DB, { hoy: GRACIA });
  const [a] = DB.pos.cinco_caminos.cierres[0].tacticas;
  assert.equal(a.base_tipo, 'mismo_mes');
  assert.equal(a.base, 600);
  assert.match(tacticaDe(DB, 1).etiquetas['1'].resultado, /60\.0 % → 66\.7 % \(\+11\.2 %\) contra mismo mes 2025/);
});

test('restaurar: cierres arranca como arreglo sin pisar el que hay, y tras restaurar se cierra lo pendiente', t => {
  const { sqlite, DB } = prepararCierre(t);
  delete DB.pos.cinco_caminos.cierres;
  const foto = { pos: { sucursales: [], cinco_caminos: {} }, admin: { roles: [], usuarios: [] }, crm: {} };
  assert.deepEqual(reconciliarTrasRestaurar(foto).db.pos.cinco_caminos.cierres, []);
  const conCierres = { pos: { sucursales: [], cinco_caminos: { cierres: [{ id: 1 }] } }, admin: { roles: [], usuarios: [] }, crm: {} };
  assert.deepEqual(reconciliarTrasRestaurar(conCierres).db.pos.cinco_caminos.cierres, [{ id: 1 }]);
  plan(DB);
  assert.equal(cerrarTrasRestaurar(DB, sqlite, { hoy: GRACIA }).length, 1);
  assert.equal(DB.pos.cinco_caminos.cierres.length, 1);
  assert.deepEqual(cerrarTrasRestaurar(DB, null, { hoy: GRACIA }), []);
});

test('una sola vuelta cierra todas las tiendas pendientes', t => {
  const { sqlite, DB } = prepararCierre(t, [1, 2]);
  plan(DB, { sucursal_id: 2 });
  plan(DB, { sucursal_id: 1 });
  assert.deepEqual(cerrarMesesPendientes(sqlite, DB, { hoy: GRACIA }).map(c => c.sucursal_id), [1, 2]);
  assert.equal(manual.vistaManual(DB, {}).find(x => x.id === 1).probada_en, 2);
});

test('un mes que se cierra tarde no pisa la etiqueta de un mes mas nuevo', t => {
  const { sqlite, DB } = prepararCierre(t);
  const nueva = { estado: 'no_funciono', mes: '2026-10', resultado: 'Octubre no' };
  tacticaDe(DB, 1).etiquetas['1'] = { ...nueva };
  plan(DB);
  cerrarMesesPendientes(sqlite, DB, { hoy: GRACIA });
  assert.equal(DB.pos.cinco_caminos.cierres[0].tacticas[0].resultado, 'probada');
  assert.deepEqual(tacticaDe(DB, 1).etiquetas['1'], nueva);
});

// ---- Revision H1: la tactica se califica tal como se aprobo (snapshot en el plan), no como quedo en el manual ----
const snapshotDe = (DB, ids) => ids.map(id => {
  const t = tacticaDe(DB, id);
  return { id, como_se_mide: t.como_se_mide, numero_que_mueve: t.numero_que_mueve, candado: t.candado };
});

test('editar la tactica entre aprobar y cerrar no cambia el resultado: se usa el snapshot del plan', t => {
  const control = prepararCierre(t);
  const ev = metaEvidencia(control.DB);
  plan(control.DB, { tacticas: [4, 1], evidencias: [{ tactica_id: 4, meta_clave: ev }] }).tacticas_aprobadas = snapshotDe(control.DB, [4, 1]);
  cerrarMesesPendientes(control.sqlite, control.DB, { hoy: GRACIA });
  const esperado = DB => DB.pos.cinco_caminos.cierres[0].tacticas;
  assert.deepEqual(esperado(control.DB).map(r => [r.id, r.resultado, r.numero]), [[4, 'no_se_hizo', 'clientes_nuevos'], [1, 'probada', 'pct_con_cliente']]);

  const { sqlite, DB } = prepararCierre(t);
  const ev2 = metaEvidencia(DB);
  plan(DB, { tacticas: [4, 1], evidencias: [{ tactica_id: 4, meta_clave: ev2 }] }).tacticas_aprobadas = snapshotDe(DB, [4, 1]);
  manual.cambiarTactica(DB, 4, { como_se_mide: 'sistema', numero_que_mueve: 'pct_con_cliente', candado: null }, 1);
  manual.cambiarTactica(DB, 1, { numero_que_mueve: 'clientes_nuevos', candado: 'pct_con_cliente' }, 1);
  cerrarMesesPendientes(sqlite, DB, { hoy: GRACIA });
  assert.deepEqual(esperado(DB), esperado(control.DB));
  assert.equal(tacticaDe(DB, 4).etiquetas['1'].estado, 'sin_dato', 'la 4 no se hizo: no queda probada');
});

test('un plan viejo sin snapshot se califica con el manual', t => {
  const { sqlite, DB } = prepararCierre(t);
  plan(DB, { tacticas: [1] });
  manual.cambiarTactica(DB, 1, { numero_que_mueve: 'clientes_nuevos' }, 1);
  cerrarMesesPendientes(sqlite, DB, { hoy: GRACIA });
  assert.equal(DB.pos.cinco_caminos.cierres[0].tacticas[0].numero, 'clientes_nuevos');
});

// ---- Revision H2 y H5: la evidencia se califica como se aprobo, 1 por captura y solo con prueba ----
const M = require('../metasPersonalizadas');
const VICTOR = { id: 1, nombre: 'Victor' };
const FOTO = { tipo: 'foto', huella: 'h' };
function metaReal(DB, veces) {
  return M.crearMeta(DB, { nombre: 'Táctica: prueba', descripcion: 'Comprueba con foto que se hizo.', unidad: 'veces', fuente: 'manual',
    prueba: 'foto', valor_meta: veces, periodo: 'mensual', inicio: `${SEPT}-01`, alcance: 'tienda', sucursal_id: 1 }, VICTOR,
  { origen: { tipo: 'plan_mes', plan_id: 1 } }).clave;
}
const capturar = (DB, clave, fecha, extra = {}) => DB.pos.meta_capturas.push({ id: DB.pos.meta_capturas.length + 1, meta_clave: clave, fecha,
  cantidad: 1, evidencia: FOTO, anulada: null, ...extra });

test('una captura sin evidencia no cuenta y la cantidad no pesa: cada captura con prueba vale 1', () => {
  const ev = (capturas, requeridas) => evaluarTactica(tactica({ como_se_mide: 'evidencia', valor: 11000, evidencia: { meta_clave: 9, requeridas, capturas } }));
  const sinFoto = ev([{ id: 1, meta_clave: 9, fecha: '2026-10-10', cantidad: 31, evidencia: null, anulada: null }], 31);
  assert.equal(sinFoto.resultado, 'no_se_hizo');
  assert.deepEqual(sinFoto.evidencia.capturas_contadas, []);
  assert.equal(sinFoto.texto, 'No se hizo: evidencia 0 de 31');
  const tres = ev([{ id: 1, meta_clave: 9, fecha: '2026-10-10', cantidad: 3, evidencia: FOTO, anulada: null }], 3);
  assert.equal(tres.resultado, 'no_se_hizo', 'una captura con cantidad 3 cuenta 1');
  assert.equal(tres.texto, 'No se hizo: evidencia 1 de 3');
});

test('bajar valor_meta de la meta de evidencia despues de aprobar no cambia lo requerido', t => {
  const { sqlite, DB } = prepararCierre(t);
  const clave = metaReal(DB, 4);
  plan(DB, { tacticas: [4], evidencias: [{ tactica_id: 4, meta_clave: clave, prueba: 'foto', requeridas: 4 }] });
  capturar(DB, clave, '2026-09-10');
  M.editarMeta(DB, clave, { valor_meta: 1, motivo: 'Ajuste' }, VICTOR);
  cerrarMesesPendientes(sqlite, DB, { hoy: GRACIA });
  const [r] = DB.pos.cinco_caminos.cierres[0].tacticas;
  assert.deepEqual(r.evidencia, { meta_clave: clave, requeridas: 4, capturas_contadas: [1] });
  assert.equal(r.resultado, 'no_se_hizo');
});

test('cambiar la prueba a ninguna y capturar cantidad 31 sin foto da no_se_hizo', t => {
  const { sqlite, DB } = prepararCierre(t);
  const clave = metaReal(DB, 31);
  plan(DB, { tacticas: [4], evidencias: [{ tactica_id: 4, meta_clave: clave, prueba: 'foto', requeridas: 31 }] });
  M.editarMeta(DB, clave, { prueba: 'ninguna', motivo: 'Sin foto' }, VICTOR);
  capturar(DB, clave, '2026-09-10', { cantidad: 31, evidencia: null });
  cerrarMesesPendientes(sqlite, DB, { hoy: GRACIA });
  const [r] = DB.pos.cinco_caminos.cierres[0].tacticas;
  assert.equal(r.resultado, 'no_se_hizo');
  assert.equal(r.texto, 'No se hizo: evidencia 0 de 31');
});

test('plan viejo sin requeridas: vale el valor_meta de la PRIMERA version y se exige evidencia', t => {
  const { sqlite, DB } = prepararCierre(t);
  const clave = metaReal(DB, 2);
  plan(DB, { tacticas: [4], evidencias: [{ tactica_id: 4, meta_clave: clave }] });
  capturar(DB, clave, '2026-09-10');
  capturar(DB, clave, '2026-09-11', { evidencia: null, cantidad: 5 });
  M.editarMeta(DB, clave, { valor_meta: 1, motivo: 'Ajuste' }, VICTOR);
  cerrarMesesPendientes(sqlite, DB, { hoy: GRACIA });
  const [r] = DB.pos.cinco_caminos.cierres[0].tacticas;
  assert.deepEqual(r.evidencia, { meta_clave: clave, requeridas: 2, capturas_contadas: [1] });
  assert.equal(r.resultado, 'no_se_hizo');
});

test('Evidencia: x de y de la pantalla cuenta igual que el cierre', () => {
  const DB = { pos: { metas_personalizadas: [{ id: 9, clave: 9, version: 1, prueba: 'foto', valor_meta: 4 }, { id: 10, clave: 9, version: 2, prueba: 'ninguna',
    valor_meta: 1 }], meta_capturas: [{ id: 1, meta_clave: 9, fecha: '2026-09-10', cantidad: 3, evidencia: null, anulada: null },
    { id: 2, meta_clave: 9, fecha: '2026-09-11', cantidad: 1, evidencia: FOTO, anulada: null }] } };
  const viejo = { mes: SEPT, evidencias: [{ tactica_id: 4, meta_clave: 9 }] };
  assert.deepEqual(avanceEvidencias(DB, viejo), [{ tactica_id: 4, meta_clave: 9, prueba: 'foto', requeridas: 4, hechas: 1 }]);
  const nuevo = { mes: SEPT, evidencias: [{ tactica_id: 4, meta_clave: 9, prueba: 'liga', requeridas: 3 }] };
  assert.deepEqual(avanceEvidencias(DB, nuevo), [{ tactica_id: 4, meta_clave: 9, prueba: 'liga', requeridas: 3, hechas: 1 }]);
});
