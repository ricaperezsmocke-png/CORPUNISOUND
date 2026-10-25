const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { crearRepositorioSicar } = require('../sicarRepositorio');
const { numerosSemana, tableroTienda } = require('./tablero');

// Semana bajo prueba: lunes 2026-10-12 a domingo 2026-10-18.
const LUNES = '2026-10-12';
const CATEGORIAS = [
  { departamento: 'GUITARRAS', categoria: null, tipo: 'instrumento' },
  { departamento: 'ACCESORIOS', categoria: null, tipo: 'accesorio' },
  // La regla de categoría gana a la del departamento entero.
  { departamento: 'ACCESORIOS', categoria: 'AFINADORES', tipo: 'instrumento' },
];

let siguiente = 0;
function prepararDB(t) {
  const sqlite = new Database(':memory:');
  t.after(() => sqlite.close());
  crearRepositorioSicar(sqlite);
  const DB = { pos: { cinco_caminos: { categorias: [] } }, radar_demanda: { registros: [] } };
  const s = {
    tienda: suc => sqlite.prepare('INSERT OR IGNORE INTO sicar_tiendas(sucursal_id) VALUES (?)').run(suc),
    articulo: (suc, art_id, departamento, categoria) => sqlite.prepare(`INSERT INTO sicar_articulos
      (sucursal_id, art_id, clave, descripcion, categoria, departamento, actualizado_en) VALUES (?, ?, ?, ?, ?, ?, 'x')`)
      .run(suc, art_id, `C${art_id}`, `Artículo ${art_id}`, categoria, departamento),
    venta(suc, { cli = null, fecha, estado = 'vigente', centavos = 10000, detalle = [] }) {
      const ven = String(++siguiente);
      if (cli) {
        sqlite.prepare('INSERT OR IGNORE INTO sicar_clientes(sucursal_id, cli_id, nombre) VALUES (?, ?, ?)').run(suc, cli, `Cliente ${cli}`);
        sqlite.prepare(`INSERT INTO sicar_ventas (sucursal_id, ven_id, cli_id, fecha_local, estado, total_centavos, revision, hash)
          VALUES (?, ?, ?, ?, ?, ?, '1', 'h')`).run(suc, ven, cli, fecha, estado, centavos);
        detalle.forEach(([art, cantidad], i) => sqlite.prepare(`INSERT INTO sicar_detalles (sucursal_id, ven_id, art_id, renglon,
          clave, descripcion, cantidad, precio_con, precio_sin, importe_centavos, descuento_centavos)
          VALUES (?, ?, ?, ?, NULL, 'd', ?, '1.0000', '1.0000', 100, 0)`).run(suc, ven, art, i + 1, cantidad));
      } else {
        sqlite.prepare(`INSERT INTO sicar_ventas_mostrador (sucursal_id, ven_id, fecha_local, estado, total_centavos, actualizado_en)
          VALUES (?, ?, ?, ?, ?, 'x')`).run(suc, ven, fecha, estado, centavos);
        detalle.forEach(([art, cantidad], i) => sqlite.prepare(`INSERT INTO sicar_detalles_mostrador (sucursal_id, ven_id, renglon,
          art_id, cantidad, importe_centavos, descuento_centavos) VALUES (?, ?, ?, ?, ?, 100, 0)`).run(suc, ven, i + 1, art, cantidad));
      }
      return ven;
    },
    // n ventas de mostrador repartidas en la semana que empieza en `lunes`.
    mostrador(suc, lunes, n, centavos = 10000) {
      for (let i = 0; i < n; i++) s.venta(suc, { fecha: `${sumar(lunes, i % 7)}T1${i % 10}:00:00`, centavos });
    },
  };
  return { sqlite, DB, s };
}
function sumar(dia, dias) {
  const d = new Date(`${dia}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
const n = (sqlite, DB, extra = {}) => numerosSemana(sqlite, DB, { sucursal_id: 1, lunes: LUNES, ...extra });

test('20 con cliente y 20 de mostrador: 50% con cliente y ticket = total/40; cancelada y excluida no cuentan', t => {
  const { sqlite, DB, s } = prepararDB(t);
  s.tienda(1);
  for (let i = 0; i < 20; i++) s.venta(1, { cli: `c${i}`, fecha: `${sumar(LUNES, i % 7)}T12:00:00`, centavos: 100000 });
  s.mostrador(1, LUNES, 20, 50000);
  s.venta(1, { cli: 'c0', fecha: `${LUNES}T09:00:00`, estado: 'cancelada', centavos: 999999 });
  s.venta(1, { fecha: `${LUNES}T09:00:00`, estado: 'cancelada', centavos: 999999 });
  sqlite.prepare(`INSERT INTO sicar_ventas (sucursal_id, ven_id, cli_id, fecha_local, estado, total_centavos, revision, hash)
    VALUES (1, 'ex', NULL, '${LUNES}T09:00:00', 'excluida', 777777, '1', 'h')`).run();
  // Fuera de la semana: el domingo anterior a las 23:59 y el lunes siguiente a las 00:00.
  s.venta(1, { fecha: '2026-10-11T23:59:59', centavos: 5 });
  s.venta(1, { fecha: '2026-10-19T00:00:00', centavos: 5 });
  // Otra tienda en la misma semana no se mezcla.
  s.tienda(2);
  s.mostrador(2, LUNES, 50, 1);
  const r = n(sqlite, DB);
  assert.equal(r.sucursal_id, 1);
  assert.equal(r.lunes, LUNES);
  assert.equal(r.domingo, '2026-10-18');
  assert.equal(r.sin_dato, false);
  assert.equal(r.ventas, 40);
  assert.equal(r.venta_centavos, 20 * 100000 + 20 * 50000);
  assert.ok(Number.isInteger(r.venta_centavos));
  assert.equal(r.pct_con_cliente, 50.0);
  assert.equal(r.ticket_promedio_centavos, 75000);
  assert.ok(Number.isInteger(r.ticket_promedio_centavos));
});

test('29 ventas es "sin dato"; 30 ya califica; tienda sin agente es "sin dato"', t => {
  const { sqlite, DB, s } = prepararDB(t);
  s.tienda(1);
  s.mostrador(1, LUNES, 29);
  assert.equal(n(sqlite, DB).sin_dato, true);
  s.mostrador(1, LUNES, 1);
  assert.equal(n(sqlite, DB).sin_dato, false);
  // Tienda 3 sin renglón en sicar_tiendas: no tiene agente.
  const sinAgente = n(sqlite, DB, { sucursal_id: 3 });
  assert.equal(sinAgente.sin_dato, true);
  assert.equal(sinAgente.ventas, 0);
  assert.equal(sinAgente.pct_con_cliente, null);
  assert.equal(sinAgente.ticket_promedio_centavos, null);
});

test('clientes nuevos y recompra a 90 días', t => {
  const { sqlite, DB, s } = prepararDB(t);
  s.tienda(1);
  s.mostrador(1, LUNES, 30);
  s.venta(1, { cli: 'A', fecha: `${LUNES}T10:00:00` }); // primera compra en la semana: nuevo
  s.venta(1, { cli: 'A', fecha: '2026-10-14T10:00:00' }); // dos veces en la semana: un solo cliente
  s.venta(1, { cli: 'B', fecha: '2026-10-15T10:00:00' });
  s.venta(1, { cli: 'B', fecha: `${sumar(LUNES, -40)}T10:00:00` }); // compró hace 40 días: recompra, no nuevo
  s.venta(1, { cli: 'C', fecha: '2026-10-16T10:00:00' });
  s.venta(1, { cli: 'C', fecha: `${sumar(LUNES, -200)}T10:00:00` }); // hace 200 días: ni nuevo ni recompra
  s.venta(1, { cli: 'D', fecha: '2026-10-17T10:00:00' });
  s.venta(1, { cli: 'D', fecha: `${sumar(LUNES, -10)}T10:00:00`, estado: 'cancelada' }); // la cancelada no cuenta: nuevo
  s.venta(1, { cli: 'E', fecha: `${sumar(LUNES, -5)}T10:00:00` }); // sin venta en la semana: no entra
  // El mismo cli_id en otra tienda es otro cliente.
  s.tienda(2);
  s.venta(2, { cli: 'A', fecha: `${sumar(LUNES, -3)}T10:00:00` });
  const r = n(sqlite, DB);
  assert.equal(r.clientes_nuevos, 2);
  assert.equal(r.recompra_90, 25.0);
});

test('instrumento con accesorio: 3 de 4 ventas con instrumento = 75.0; artículos por ticket', t => {
  const { sqlite, DB, s } = prepararDB(t);
  s.tienda(1);
  s.articulo(1, 'g1', 'GUITARRAS', 'ACUSTICAS');
  s.articulo(1, 'g2', 'GUITARRAS', 'ELECTRICAS');
  s.articulo(1, 'cu', 'ACCESORIOS', 'CUERDAS');
  s.articulo(1, 'af', 'ACCESORIOS', 'AFINADORES');
  s.articulo(1, 'pu', 'OTROS', 'PUAS');
  DB.pos.cinco_caminos.categorias = CATEGORIAS;
  const dia = `${LUNES}T10:00:00`;
  s.venta(1, { cli: 'A', fecha: dia, detalle: [['g1', '1.0000'], ['cu', '2.0000']] });
  s.venta(1, { fecha: dia, detalle: [['g2', '1.0000'], ['cu', '1.0000']] }); // mostrador
  s.venta(1, { fecha: dia, detalle: [['af', '1.0000'], ['cu', '1.0000']] }); // afinador cuenta como instrumento
  s.venta(1, { cli: 'B', fecha: dia, detalle: [['g1', '1.0000'], ['pu', '3.0000']] }); // púas (OTROS): sin regla
  s.venta(1, { fecha: dia, detalle: [['cu', '1.0000']] }); // solo accesorio: no entra al denominador
  s.venta(1, { cli: 'C', fecha: dia, estado: 'cancelada', detalle: [['g1', '1.0000']] }); // cancelada: no cuenta
  s.mostrador(1, LUNES, 25); // sin detalle
  const r = n(sqlite, DB);
  assert.equal(r.ventas, 30);
  assert.equal(r.pct_instrumento_con_accesorio, 75.0);
  // 3 + 2 + 2 + 4 + 1 = 12 piezas entre 30 ventas.
  assert.equal(r.articulos_por_ticket, 0.4);
});

test('sin categorías marcadas el número sale "sin_configurar"', t => {
  const { sqlite, DB, s } = prepararDB(t);
  s.tienda(1);
  s.mostrador(1, LUNES, 30);
  assert.equal(n(sqlite, DB).pct_instrumento_con_accesorio, 'sin_configurar');
  // Solo instrumentos, sin ningún accesorio marcado: tampoco está configurado.
  DB.pos.cinco_caminos.categorias = [{ departamento: 'GUITARRAS', categoria: null, tipo: 'instrumento' }];
  assert.equal(n(sqlite, DB).pct_instrumento_con_accesorio, 'sin_configurar');
  DB.pos.cinco_caminos.categorias = CATEGORIAS;
  assert.equal(n(sqlite, DB).pct_instrumento_con_accesorio, null, 'configurado pero sin ventas con instrumento');
});

const registro = (id, dias, estado, extra = {}) => ({
  id, sucursal_id: 1, estado, fecha_registro: `${sumar('2026-10-18', -dias)}T18:00:00.000Z`, ...extra,
});

test('Radar: cuenta lo registrado entre 60 y 30 días antes del domingo, con la clasificación existente', t => {
  const { sqlite, DB, s } = prepararDB(t);
  s.tienda(1);
  s.mostrador(1, LUNES, 40);
  DB.radar_demanda.registros = [
    registro(1, 45, 'CONVERTIDA'),
    registro(2, 50, 'NO_CONVERTIDA'),
    registro(3, 10, 'CONVERTIDA'), // demasiado reciente
    registro(4, 70, 'CONVERTIDA'), // demasiado viejo
    registro(5, 40, 'EN_SEGUIMIENTO'), // pendiente: fuera del cálculo
    registro(6, 40, 'CANCELADA'),
    registro(7, 45, 'CONVERTIDA', { sucursal_id: '2' }), // otra tienda
    registro(8, 30, 'NO_CONVERTIDA'), // borde: domingo − 30
    registro(9, 60, 'CONVERTIDA'), // borde: domingo − 60
  ];
  const r = n(sqlite, DB);
  assert.equal(r.radar.conversion, 50.0);
  assert.deepEqual(r.radar.conversion_detalle, { numerador: 2, denominador: 4 });
});

test('Radar: registros por cada 10 tickets; si caen 40% contra su promedio de 8 semanas, no confiable', t => {
  const { sqlite, DB, s } = prepararDB(t);
  s.tienda(1);
  const lunesBase = [1, 2, 3, 4, 5, 6, 7, 8].map(k => sumar(LUNES, -7 * k));
  let id = 0;
  const registrar = (lunes, cuantos) => {
    for (let i = 0; i < cuantos; i++) {
      DB.radar_demanda.registros.push({ id: ++id, sucursal_id: 1, estado: 'REGISTRADA',
        fecha_registro: `${sumar(lunes, i % 7)}T18:00:00.000Z` });
    }
  };
  for (const l of lunesBase) { s.mostrador(1, l, 40); registrar(l, 10); }
  s.mostrador(1, LUNES, 40);
  registrar(LUNES, 6);
  let r = n(sqlite, DB);
  assert.equal(r.radar.registros_por_10_tickets, 1.5);
  assert.equal(r.radar.no_confiable, true);
  // Con 8 registros (caída de 20%) sigue siendo confiable.
  registrar(LUNES, 2);
  r = n(sqlite, DB);
  assert.equal(r.radar.registros_por_10_tickets, 2.0);
  assert.equal(r.radar.no_confiable, false);
});

test('tableroTienda: semana anterior, misma de 2025 y promedio de 8 semanas', t => {
  const { sqlite, DB, s } = prepararDB(t);
  s.tienda(1);
  for (let k = 1; k <= 8; k++) s.mostrador(1, sumar(LUNES, -7 * k), 30 + k, 1000 * k); // promedio de 8 semanas
  s.mostrador(1, LUNES, 40, 2000);
  s.mostrador(1, '2025-10-13', 35, 3000); // lunes − 364 días
  const r = tableroTienda(sqlite, DB, { sucursal_id: 1, lunes: LUNES });
  assert.equal(r.actual.ventas, 40);
  assert.equal(r.anterior.lunes, '2026-10-05');
  assert.equal(r.anterior.ventas, 31);
  assert.equal(r.mismo_2025.lunes, '2025-10-13');
  assert.equal(r.mismo_2025.ventas, 35);
  assert.equal(r.mismo_2025.ticket_promedio_centavos, 3000);
  // Ventas 31..38 → 34.5; ticket promedio 1000..8000 → 4500.
  assert.equal(r.promedio_8.ventas, 34.5);
  assert.equal(r.promedio_8.ticket_promedio_centavos, 4500);
  assert.ok(Number.isInteger(r.promedio_8.venta_centavos));
  assert.equal(r.promedio_8.pct_con_cliente, 0.0);
  assert.equal(r.promedio_8.pct_instrumento_con_accesorio, 'sin_configurar');
});

test('acepta la tienda como texto sin abrir el alcance', t => {
  const { sqlite, DB, s } = prepararDB(t);
  s.tienda(1);
  s.mostrador(1, LUNES, 30);
  assert.equal(numerosSemana(sqlite, DB, { sucursal_id: '1', lunes: LUNES }).ventas, 30);
  assert.throws(() => numerosSemana(sqlite, DB, { sucursal_id: 'x', lunes: LUNES }), e => e.status === 400);
  assert.throws(() => numerosSemana(sqlite, DB, { sucursal_id: 1, lunes: '2026-10-13' }), e => e.status === 400, 'no es lunes');
});

test('cuentas internas: no cuentan como con cliente, ni como nuevas, ni en recompra', t => {
  const { sqlite, DB, s } = prepararDB(t);
  s.tienda(1);
  s.mostrador(1, LUNES, 30);
  s.venta(1, { cli: 'X', fecha: `${LUNES}T10:00:00` }); // cuenta interna con compra en la semana
  s.venta(1, { cli: 'X', fecha: `${sumar(LUNES, -20)}T10:00:00` });
  s.venta(1, { cli: 'Z', fecha: `${LUNES}T11:00:00` }); // interna sin historia: tampoco es nueva
  s.venta(1, { cli: 'Y', fecha: `${LUNES}T12:00:00` }); // cliente normal, primera compra
  const interna = sqlite.prepare(`INSERT INTO sicar_internas (sucursal_id, cli_id, motivo, usuario_id, fecha_hora)
    VALUES (?, ?, 'Cuenta de la tienda', 1, 'x')`);
  interna.run(1, 'X');
  interna.run(1, 'Z');
  // La misma clave interna en OTRA tienda no excluye al cliente de esta.
  s.tienda(2);
  sqlite.prepare("INSERT INTO sicar_clientes(sucursal_id, cli_id, nombre) VALUES (2, 'Y', 'Otro')").run();
  interna.run(2, 'Y');
  const r = n(sqlite, DB);
  assert.equal(r.ventas, 33, 'la venta de la cuenta interna sigue siendo venta');
  assert.equal(r.pct_con_cliente, 3.0); // 1 de 33
  assert.equal(r.clientes_nuevos, 1);
  assert.equal(r.recompra_90, 0.0);
});

test('una venta vigente con cli_id nulo cuenta como sin cliente', t => {
  const { sqlite, DB, s } = prepararDB(t);
  s.tienda(1);
  s.mostrador(1, LUNES, 29);
  // El esquema lo impide hoy; se fuerza para que el cálculo no dependa solo de esa restricción.
  sqlite.pragma('ignore_check_constraints = ON');
  sqlite.prepare(`INSERT INTO sicar_ventas (sucursal_id, ven_id, cli_id, fecha_local, estado, total_centavos, revision, hash)
    VALUES (1, 'nulo', NULL, '${LUNES}T09:00:00', 'vigente', 100, '1', 'h')`).run();
  sqlite.pragma('ignore_check_constraints = OFF');
  const r = n(sqlite, DB);
  assert.equal(r.ventas, 30);
  assert.equal(r.pct_con_cliente, 0.0);
  assert.equal(r.clientes_nuevos, 0);
  assert.equal(r.recompra_90, null);
});

test('Radar: los registros cancelados no cuentan en registros por cada 10 tickets (semana ni base)', t => {
  const { sqlite, DB, s } = prepararDB(t);
  s.tienda(1);
  let id = 0;
  const registrar = (lunes, cuantos, estado) => {
    for (let i = 0; i < cuantos; i++) {
      DB.radar_demanda.registros.push({ id: ++id, sucursal_id: 1, estado, fecha_registro: `${sumar(lunes, i % 7)}T18:00:00.000Z` });
    }
  };
  for (let k = 1; k <= 8; k++) {
    const l = sumar(LUNES, -7 * k);
    s.mostrador(1, l, 40);
    registrar(l, 10, 'REGISTRADA');
  }
  s.mostrador(1, LUNES, 40);
  registrar(LUNES, 6, 'CONVERTIDA');
  registrar(LUNES, 20, 'CANCELADA'); // inflar con cancelados no tapa la caída
  let r = n(sqlite, DB);
  assert.equal(r.radar.registros_por_10_tickets, 1.5);
  assert.equal(r.radar.no_confiable, true);
  // Y en la base: cancelados de las 8 semanas previas no suben la vara.
  for (let k = 1; k <= 8; k++) registrar(sumar(LUNES, -7 * k), 30, 'CANCELADA');
  registrar(LUNES, 2, 'NO_CONVERTIDA');
  r = n(sqlite, DB);
  assert.equal(r.radar.registros_por_10_tickets, 2.0);
  assert.equal(r.radar.no_confiable, false);
});

test('Radar: sin semanas base no se sabe si es confiable (null, no false)', t => {
  const { sqlite, DB, s } = prepararDB(t);
  s.tienda(1);
  s.mostrador(1, LUNES, 40);
  DB.radar_demanda.registros = [{ id: 1, sucursal_id: 1, estado: 'REGISTRADA', fecha_registro: `${LUNES}T18:00:00.000Z` }];
  assert.equal(n(sqlite, DB).radar.no_confiable, null);
});
