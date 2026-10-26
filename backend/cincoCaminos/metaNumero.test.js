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

test('esFuenteNumero no acepta nombres heredados de Object.prototype', () => {
  const { esFuenteNumero } = require('./metaNumero');
  for (const n of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) assert.equal(esFuenteNumero(`cinco_caminos:${n}`), false, n);
  assert.equal(esFuenteNumero('cinco_caminos:pct_con_cliente'), true);
});

test('el hoy del tablero llega hasta la fuente: semana sin terminar es sin dato aunque el reloj real diga otra cosa', t => {
  const { DB, semana } = preparar(t);
  semana('2026-10-12', 30);
  M.crearMeta(DB, { nombre: 'Con cliente', prueba: 'ninguna', valor_meta: 400, periodo: 'semanal', inicio: '2026-10-12',
    alcance: 'tienda', sucursal_id: 1, fuente: 'cinco_caminos:pct_con_cliente' }, { id: 1, nombre: 'Victor' });
  const visor = { jefatura: true, verTodas: true, sucursalId: 1, vendedor_id: null, usuario_id: 1 };
  const ver = hoy => tablero(DB, visor, { periodo: 'semanal', inicio: '2026-10-12' }, hoy).sueltas[0];
  assert.equal(ver('2026-10-15').resultado, null, 'el domingo de esa semana todavia no pasa');
  assert.equal(ver('2026-10-26').resultado, 500);
});

test('sellar con una meta cinco caminos sin dato guarda resultado null (no 0) y el OKR no la cuenta', t => {
  const { previoSello, sellarPeriodo } = require('../metasSellos');
  const { DB, semana } = preparar(t);
  semana('2026-10-12', 30);
  const SEM = { periodo: 'semanal', inicio: '2026-10-12' };
  const usuario = { id: 1, nombre: 'Victor' };
  const okr = M.crearOkr(DB, { titulo: 'Objetivo', ...SEM, alcance: 'tienda', sucursal_id: 1 }, usuario);
  const base = { okr_clave: okr.clave, prueba: 'ninguna', alcance: 'tienda', sucursal_id: 1 };
  M.crearMeta(DB, { ...base, nombre: 'Con cliente', valor_meta: 400, fuente: 'cinco_caminos:pct_con_cliente' }, usuario);
  M.crearMeta(DB, { ...base, nombre: 'Accesorio', valor_meta: 5, fuente: 'cinco_caminos:pct_instrumento_con_accesorio' }, usuario);
  const previo = previoSello(DB, SEM, '2026-10-20');
  const sello = sellarPeriodo(DB, { ...SEM, huella: previo.huella }, usuario, '2026-10-20');
  const sinDato = sello.foto.resultados.find(r => r.valor_meta === 5);
  assert.strictEqual(sinDato.resultado, null);
  assert.strictEqual(sinDato.porcentaje, null);
  const visor = { jefatura: true, verTodas: true, sucursalId: 1, vendedor_id: null, usuario_id: 1 };
  const o = tablero(DB, visor, SEM, '2026-10-20').okrs[0];
  assert.equal(o.porcentaje, 100, 'promedio solo de la meta con dato');
});

test('semaforo: el dia 15 con 25 % contra una meta de 45.2 % NO sale verde (un promedio no se acumula con los dias)', t => {
  const { DB, semana } = preparar(t);
  semana('2026-10-05', 10); // 25.0 % = 250
  M.crearMeta(DB, { nombre: 'Con cliente', prueba: 'ninguna', valor_meta: 452, ...OCT, alcance: 'tienda', sucursal_id: 1,
    fuente: 'cinco_caminos:pct_con_cliente' }, { id: 1, nombre: 'Victor' });
  const visor = { jefatura: true, verTodas: true, sucursalId: 1, vendedor_id: null, usuario_id: 1 };
  const a = tablero(DB, visor, OCT, '2026-10-15').sueltas[0];
  assert.equal(a.resultado, 250);
  assert.notEqual(a.semaforo, 'verde');
  assert.equal(a.semaforo, 'rojo');
});

test('detalle de lo que conto: cada semana sale en su unidad legible, no en el entero escalado', t => {
  const { DB, semana, mostrador } = preparar(t);
  const meta = numero => ({ fuente: `cinco_caminos:${numero}`, sucursal_id: 1, ...OCT });
  semana('2026-10-05', 10); // 25.0 %
  const textos = numero => contarFuente(DB, meta(numero), '2026-10-20').detalle.map(d => d.texto);
  assert.deepEqual(textos('pct_con_cliente'), ['Semana del 2026-10-05: 25.0 %']);
  assert.deepEqual(textos('ticket_promedio_centavos'), ['Semana del 2026-10-05: $100.00']);
  assert.deepEqual(textos('clientes_nuevos'), ['Semana del 2026-10-05: 10']);
  assert.deepEqual(textos('articulos_por_ticket'), ['Semana del 2026-10-05: 0.00']);
  mostrador('2026-10-12', 0);
  const { formatearValor } = require('./metaNumero');
  assert.equal(formatearValor('pct_con_cliente', 452), '45.2 %');
  assert.equal(formatearValor('ticket_promedio_centavos', 85000), '$850.00');
  assert.equal(formatearValor('ticket_promedio_centavos', 123456), '$1,234.56');
  assert.equal(formatearValor('articulos_por_ticket', 185), '1.85');
  assert.equal(formatearValor('clientes_nuevos', 12), '12');
});

test('sello: se niega mientras la ultima semana de una meta cinco caminos siga abierta, y deja pasar a las manuales', t => {
  const { previoSello, sellarPeriodo } = require('../metasSellos');
  const { DB, semana } = preparar(t);
  const usuario = { id: 1, nombre: 'Victor' };
  semana('2026-10-26', 30);
  M.crearMeta(DB, { nombre: 'Con cliente', prueba: 'ninguna', valor_meta: 400, ...OCT, alcance: 'tienda', sucursal_id: 1,
    fuente: 'cinco_caminos:pct_con_cliente' }, usuario);
  // Octubre termina el sabado 31; su ultima semana (lunes 26) cierra el domingo 1 de noviembre.
  const msg = /última semana todavía abierta; se puede sellar a partir del 2026-11-02/;
  assert.throws(() => previoSello(DB, OCT, '2026-11-01'), msg);
  assert.throws(() => sellarPeriodo(DB, { ...OCT, huella: 'x' }, usuario, '2026-11-01'), msg);
  const previo = previoSello(DB, OCT, '2026-11-02');
  const sello = sellarPeriodo(DB, { ...OCT, huella: previo.huella }, usuario, '2026-11-02');
  assert.equal(sello.foto.resultados[0].resultado, 500);
  // Una meta manual no cambia: el mes se sella desde el dia siguiente a su fin.
  const DB2 = { pos: { sucursales: [{ id: 1 }], vendedores: [], okrs: [], metas_personalizadas: [], meta_capturas: [], meta_sellos: [] } };
  M.crearMeta(DB2, { nombre: 'Videos', unidad: 'videos', prueba: 'ninguna', valor_meta: 4, ...OCT, alcance: 'tienda', sucursal_id: 1 }, usuario);
  assert.doesNotThrow(() => previoSello(DB2, OCT, '2026-11-01'));
});

test('sello: una meta cinco caminos sin dato guarda resultado null, no 0', t => {
  const { previoSello, sellarPeriodo } = require('../metasSellos');
  const { DB } = preparar(t);
  const usuario = { id: 1, nombre: 'Victor' };
  M.crearMeta(DB, { nombre: 'Con cliente', prueba: 'ninguna', valor_meta: 400, ...OCT, alcance: 'tienda', sucursal_id: 1,
    fuente: 'cinco_caminos:pct_con_cliente' }, usuario);
  const previo = previoSello(DB, OCT, '2026-11-02');
  assert.strictEqual(previo.resultados[0].resultado, null);
  const sello = sellarPeriodo(DB, { ...OCT, huella: previo.huella }, usuario, '2026-11-02');
  assert.strictEqual(sello.foto.resultados[0].resultado, null);
  assert.strictEqual(sello.foto.resultados[0].porcentaje, null);
});

test('rectificar una meta cinco caminos aplica el tope de su escala', t => {
  const { previoSello, sellarPeriodo, rectificarSello } = require('../metasSellos');
  const { DB } = preparar(t);
  const usuario = { id: 1, nombre: 'Victor' };
  M.crearMeta(DB, { nombre: 'Con cliente', prueba: 'ninguna', valor_meta: 400, ...OCT, alcance: 'tienda', sucursal_id: 1,
    fuente: 'cinco_caminos:pct_con_cliente' }, usuario);
  const previo = previoSello(DB, OCT, '2026-11-02');
  const sello = sellarPeriodo(DB, { ...OCT, huella: previo.huella }, usuario, '2026-11-02');
  const clave = sello.foto.resultados[0].clave;
  assert.throws(() => rectificarSello(DB, sello.id, { meta_clave: clave, valor_nuevo: 1001, motivo: 'Correccion' }, usuario), /no puede pasar de 1000/);
  assert.equal(sello.rectificaciones.length, 0);
  assert.doesNotThrow(() => rectificarSello(DB, sello.id, { meta_clave: clave, valor_nuevo: 452, motivo: 'Correccion' }, usuario));
});
