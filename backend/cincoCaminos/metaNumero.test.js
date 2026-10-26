const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { crearRepositorioSicar } = require('../sicarRepositorio');
const { valorDelPeriodo, NUMEROS_META } = require('./metaNumero');
const { contarFuente, configurarFuentes } = require('../metasFuentes');
const { tablero } = require('../metasAvance');
const M = require('../metasPersonalizadas');

const OCT = { periodo: 'mensual', inicio: '2026-10-01' };
const sumar = (dia, dias) => {
  const d = new Date(`${dia}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};

let siguiente = 0;
function preparar(t) {
  const sqlite = new Database(':memory:');
  t.after(() => { configurarFuentes({ sqlite: null }); sqlite.close(); });
  crearRepositorioSicar(sqlite);
  configurarFuentes({ sqlite });
  sqlite.prepare('INSERT INTO sicar_tiendas(sucursal_id) VALUES (1)').run();
  const DB = { pos: { cinco_caminos: { categorias: [] }, sucursales: [{ id: 1 }], vendedores: [], okrs: [], metas_personalizadas: [],
    meta_capturas: [], meta_sellos: [] }, radar_demanda: { registros: [] }, admin: { usuarios: [] } };
  const mostrador = (lunes, n) => {
    for (let i = 0; i < n; i++) {
      sqlite.prepare(`INSERT INTO sicar_ventas_mostrador (sucursal_id, ven_id, fecha_local, estado, total_centavos, actualizado_en)
        VALUES (1, ?, ?, 'vigente', 10000, 'x')`).run(String(++siguiente), `${sumar(lunes, i % 7)}T1${i % 10}:00:00`);
    }
  };
  const conCliente = (lunes, n) => {
    for (let i = 0; i < n; i++) {
      const cli = `c${++siguiente}`;
      sqlite.prepare('INSERT INTO sicar_clientes(sucursal_id, cli_id, nombre) VALUES (1, ?, ?)').run(cli, cli);
      sqlite.prepare(`INSERT INTO sicar_ventas (sucursal_id, ven_id, cli_id, fecha_local, estado, total_centavos, revision, hash)
        VALUES (1, ?, ?, ?, 'vigente', 10000, '1', 'h')`).run(String(++siguiente), cli, `${sumar(lunes, i % 7)}T12:00:00`);
    }
  };
  // Semana con 30 ventas de mostrador y `k` con cliente: pct_con_cliente = k / (30 + k).
  const semana = (lunes, k) => { mostrador(lunes, 30); conCliente(lunes, k); };
  return { sqlite, DB, semana, mostrador };
}
const valor = (sqlite, DB, numero, hoy, extra = OCT) => valorDelPeriodo(sqlite, DB, { sucursal_id: 1, numero, hoy, ...extra });

test('mes con 4 semanas validas: promedio correcto en decimas', t => {
  const { sqlite, DB, semana } = preparar(t);
  // 25.0, 50.0, 75.0 y 50.0 por ciento: promedio 50.0 = 500 decimas.
  semana('2026-10-05', 10); semana('2026-10-12', 30); semana('2026-10-19', 90); semana('2026-10-26', 30);
  const r = valor(sqlite, DB, 'pct_con_cliente', '2026-11-05');
  assert.equal(r.valor, 500);
  assert.equal(r.sin_dato, false);
  assert.deepEqual(r.semanas.map(s => [s.lunes, s.valor]), [['2026-10-05', 250], ['2026-10-12', 500], ['2026-10-19', 750], ['2026-10-26', 500]]);
});

test('una semana sin dato se salta y no baja el promedio', t => {
  const { sqlite, DB, semana, mostrador } = preparar(t);
  semana('2026-10-05', 10); // 25.0
  mostrador('2026-10-12', 29); // pocas ventas: sin dato
  semana('2026-10-19', 90); // 75.0
  const r = valor(sqlite, DB, 'pct_con_cliente', '2026-11-05');
  assert.equal(r.valor, 500);
  assert.equal(r.semanas.length, 2);
});

test('mes sin ninguna semana valida: sin dato (null), no cero', t => {
  const { sqlite, DB } = preparar(t);
  const r = valor(sqlite, DB, 'pct_con_cliente', '2026-11-05');
  assert.deepEqual(r, { valor: null, semanas: [], sin_dato: true });
});

test('la semana en curso (domingo todavia no pasa) no cuenta', t => {
  const { sqlite, DB, semana } = preparar(t);
  semana('2026-10-12', 30); // domingo 18: 50.0
  semana('2026-10-19', 90); // domingo 25: 75.0
  assert.equal(valor(sqlite, DB, 'pct_con_cliente', '2026-10-24').valor, 500); // la del 19 sigue abierta
  assert.equal(valor(sqlite, DB, 'pct_con_cliente', '2026-10-25').valor, 500); // el domingo mismo todavia no termina
  assert.equal(valor(sqlite, DB, 'pct_con_cliente', '2026-10-26').valor, 625);
  assert.equal(valor(sqlite, DB, 'pct_con_cliente', '2026-10-18', { periodo: 'semanal', inicio: '2026-10-12' }).valor, null);
});

test('un lunes fuera del periodo no cuenta', t => {
  const { sqlite, DB, semana } = preparar(t);
  semana('2026-09-28', 90); // lunes de septiembre: fuera de octubre
  semana('2026-10-05', 30);
  assert.equal(valor(sqlite, DB, 'pct_con_cliente', '2026-11-05').valor, 500);
});

test('conversion no confiable se salta; confiable cuenta', t => {
  const { sqlite, DB, mostrador } = preparar(t);
  const LUNES = '2026-10-12';
  let id = 0;
  const registrar = (lunes, cuantos) => {
    for (let i = 0; i < cuantos; i++) {
      DB.radar_demanda.registros.push({ id: ++id, sucursal_id: 1, estado: 'CONVERTIDA', fecha_registro: `${sumar(lunes, i % 7)}T18:00:00.000Z` });
    }
  };
  for (let k = 1; k <= 8; k++) { mostrador(sumar(LUNES, -7 * k), 40); registrar(sumar(LUNES, -7 * k), 10); }
  mostrador(LUNES, 40);
  registrar(LUNES, 6); // 1.5 por cada 10 tickets contra 2.5 de base: caida de 40%
  const semanal = { periodo: 'semanal', inicio: LUNES };
  assert.equal(valor(sqlite, DB, 'conversion', '2026-10-26', semanal).valor, null);
  registrar(LUNES, 2); // 2.0 contra 2.5: confiable; todo lo del Radar en la ventana esta convertido
  assert.equal(valor(sqlite, DB, 'conversion', '2026-10-26', semanal).valor, 1000);
});

test('escalas: ticket en centavos, clientes nuevos enteros, articulos por ticket en centesimas', t => {
  const { sqlite, DB, mostrador } = preparar(t);
  mostrador('2026-10-12', 30); // 30 ventas de 10,000 centavos
  const semanal = { periodo: 'semanal', inicio: '2026-10-12' };
  assert.equal(valor(sqlite, DB, 'ticket_promedio_centavos', '2026-10-26', semanal).valor, 10000);
  assert.equal(valor(sqlite, DB, 'clientes_nuevos', '2026-10-26', semanal).valor, 0);
  assert.equal(valor(sqlite, DB, 'articulos_por_ticket', '2026-10-26', semanal).valor, 0);
  assert.equal(valor(sqlite, DB, 'pct_instrumento_con_accesorio', '2026-10-26', semanal).valor, null); // sin configurar: sin dato
  assert.equal(NUMEROS_META.registros_por_10_tickets, undefined);
});

test('contarFuente despacha cinco_caminos y avisa si no hay conexion', t => {
  const { DB, semana } = preparar(t);
  semana('2026-10-12', 30);
  const meta = { fuente: 'cinco_caminos:pct_con_cliente', sucursal_id: 1, periodo: 'semanal', inicio: '2026-10-12' };
  assert.equal(contarFuente(DB, meta, '2026-10-26').valor, 500);
  configurarFuentes({ sqlite: null });
  const sin = contarFuente(DB, meta, '2026-10-26');
  assert.equal(sin.valor, null);
  assert.match(sin.aviso, /SICAR/);
});

test('crearMeta: solo tienda y sin prueba; numero no permitido o persona se rechazan; unidad la pone el servidor', () => {
  const DB = { pos: { sucursales: [{ id: 1 }], vendedores: [{ id: 1, sucursal_id: 1 }], okrs: [], metas_personalizadas: [],
    meta_capturas: [], meta_sellos: [] } };
  const base = { nombre: 'Ventas con cliente', unidad: 'lo que sea', prueba: 'ninguna', valor_meta: 450, ...OCT, alcance: 'tienda',
    sucursal_id: 1, fuente: 'cinco_caminos:pct_con_cliente' };
  const m = M.crearMeta(DB, base, { id: 1, nombre: 'Victor' });
  assert.equal(m.unidad, '%');
  assert.equal(m.fuente, 'cinco_caminos:pct_con_cliente');
  assert.throws(() => M.crearMeta(DB, { ...base, fuente: 'cinco_caminos:registros_por_10_tickets' }, null), /fuente/);
  assert.throws(() => M.crearMeta(DB, { ...base, alcance: 'persona', vendedor_id: 1 }, null), /tienda/);
  assert.throws(() => M.crearMeta(DB, { ...base, prueba: 'foto' }, null), /cuenta sola/);
  assert.throws(() => M.crearMeta(DB, { ...base, valor_meta: 1001 }, null), /no puede pasar/);
  assert.throws(() => M.editarMeta(DB, m.clave, { unidad: 'otra', motivo: 'x' }, null), /unidad/);
});

test('avance: sin dato no tiene porcentaje ni semaforo; con dato compara contra la cifra meta', t => {
  const { DB, semana } = preparar(t);
  M.crearMeta(DB, { nombre: 'Con cliente', prueba: 'ninguna', valor_meta: 400, periodo: 'semanal', inicio: '2026-10-12',
    alcance: 'tienda', sucursal_id: 1, fuente: 'cinco_caminos:pct_con_cliente' }, { id: 1, nombre: 'Victor' });
  const visor = { jefatura: true, verTodas: true, sucursalId: 1, vendedor_id: null, usuario_id: 1 };
  const ver = hoy => tablero(DB, visor, { periodo: 'semanal', inicio: '2026-10-12' }, hoy).sueltas[0];
  let a = ver('2026-10-26');
  assert.equal(a.sin_dato, true);
  assert.equal(a.resultado, null);
  assert.equal(a.porcentaje, null);
  assert.equal(a.semaforo, null);
  semana('2026-10-12', 30); // 50.0 % = 500 contra 400
  a = ver('2026-10-26');
  assert.equal(a.resultado, 500);
  assert.equal(a.porcentaje, 100);
  assert.equal(a.sin_dato, false);
});
