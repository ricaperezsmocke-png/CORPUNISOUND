const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { crearRepositorioSicar } = require('./sicarRepositorio');
const { crearConsultasCRM } = require('./crmFuentes');

const HOY = '2026-10-14';
let sqlite, repo, DB;

function prepararDB() {
  return {
    crm: { clientes: [
      { id: 0, nombre: 'Público en General', sucursal_id: 1 },
      { id: 10, nombre: 'Ana Ocosingo', telefono: '9191234567', sucursal_id: 1, vendedor_asignado_id: 5 },
      { id: 20, nombre: 'Beto Yajalón', telefono: '9197654321', sucursal_id: 2, vendedor_asignado_id: null },
    ] },
    pos: {
      ventas: [{ id: 900, cliente_id: 10, sucursal_id: 1, fecha: HOY, total: 100, estatus: 'cerrada' }],
      venta_detalle: [{ id: 1, venta_id: 900, producto_id: 7, cantidad: 1, precio_unitario: 100, subtotal: 100 }],
      sucursales: [{ id: 1, nombre: 'Ocosingo' }, { id: 2, nombre: 'Yajalón' }],
    },
    'catalogo-productos': { productos: [{ id: 7, nombre: 'Cuerdas' }] },
  };
}

function cliente(sucursal, cli, nombre, telefono = null) {
  sqlite.prepare('INSERT OR IGNORE INTO sicar_tiendas(sucursal_id) VALUES (?)').run(sucursal);
  sqlite.prepare('INSERT INTO sicar_clientes(sucursal_id, cli_id, nombre, telefono) VALUES (?,?,?,?)').run(sucursal, cli, nombre, telefono);
}
function venta(sucursal, ven, cli, fecha, centavos, estado = 'vigente', descripcion = 'Guitarra') {
  sqlite.prepare(`INSERT INTO sicar_ventas(sucursal_id, ven_id, cli_id, fecha_local, estado, total_centavos, revision, hash)
    VALUES (?,?,?,?,?,?, '1', 'h')`).run(sucursal, ven, cli, `${fecha}T12:00:00`, estado, centavos);
  sqlite.prepare(`INSERT INTO sicar_detalles(sucursal_id, ven_id, art_id, descripcion, cantidad, precio_con, precio_sin,
    importe_centavos, descuento_centavos) VALUES (?,?, '1', ?, '1.0000', '0', '0', ?, 0)`).run(sucursal, ven, descripcion, centavos);
}
function vincular(sucursal, cli, clienteId, estado = 'pendiente') {
  sqlite.prepare(`INSERT INTO sicar_vinculos(sucursal_id, cli_id, cliente_id, estado, creada, actualizada)
    VALUES (?,?,?,?, '2026-10-01', '2026-10-01')`).run(sucursal, cli, clienteId, estado);
}
const global = { alcance: { verTodas: true, sucursalId: null }, verSicar: true, hoyLocal: HOY };
const ocosingo = { alcance: { verTodas: false, sucursalId: 1 }, verSicar: true, hoyLocal: HOY };
const consultas = () => crearConsultasCRM(DB, repo);

beforeEach(() => {
  sqlite = new Database(':memory:');
  repo = crearRepositorioSicar(sqlite);
  DB = prepararDB();
});

test('$100 POS + $200 SICAR vigente + $90 SICAR cancelada suman $300 y 2 compras', () => {
  cliente(1, '500', 'Ana SICAR', '9191234567');
  venta(1, '900', '500', HOY, 20000);
  venta(1, '901', '500', HOY, 9000, 'cancelada');
  vincular(1, '500', 10);
  const ficha = consultas().ficha(global, 'crm:10');
  assert.equal(ficha.monto_centavos, 30000);
  assert.equal(ficha.monto_pos_centavos, 10000);
  assert.equal(ficha.monto_sicar_centavos, 20000);
  assert.equal(ficha.numero_compras, 2);
  assert.equal(ficha.aviso_vinculo, 'Unión SICAR pendiente de revisión.');
  const compras = consultas().compras(global, 'crm:10').items;
  assert.deepEqual(compras.map(c => c.ref).sort(), ['pos:900', 'sicar:1:900', 'sicar:1:901']);
  const cancelada = compras.find(c => c.ref === 'sicar:1:901');
  assert.equal(cancelada.estado, 'cancelada');
  assert.equal(cancelada.suma_al_total, false);
  const detalle = consultas().detalle(global, 'sicar:1:900');
  assert.equal(detalle.lineas[0].descripcion, 'Guitarra');
  assert.equal(consultas().detalle(global, 'pos:900').lineas[0].descripcion, 'Cuerdas');
});

test('score 40 por $100 hoy y fronteras de segmento 30/31/90/91 días', () => {
  assert.equal(consultas().ficha(global, 'crm:10').score, 40);
  assert.equal(consultas().ficha(global, 'crm:10').segmento, 'activo');
  const casos = [['2026-09-14', 'activo'], ['2026-09-13', 'en_riesgo'], ['2026-07-16', 'en_riesgo'], ['2026-07-15', 'inactivo']];
  for (const [fecha, segmento] of casos) {
    DB.pos.ventas[0].fecha = fecha;
    assert.equal(consultas().ficha(global, 'crm:10').segmento, segmento, fecha);
  }
});

test('cancelar la última compra retrocede la fecha; sin compras es inactivo con score 0', () => {
  DB.pos.ventas = [];
  cliente(1, '500', 'Ana SICAR');
  venta(1, '1', '500', '2026-08-01', 10000);
  venta(1, '2', '500', HOY, 10000);
  vincular(1, '500', 10);
  assert.equal(consultas().ficha(global, 'crm:10').ultima_compra, HOY);
  sqlite.prepare("UPDATE sicar_ventas SET estado='cancelada' WHERE ven_id='2'").run();
  const ficha = consultas().ficha(global, 'crm:10');
  assert.equal(ficha.ultima_compra, '2026-08-01');
  assert.equal(ficha.segmento, 'en_riesgo');
  sqlite.prepare("UPDATE sicar_ventas SET estado='cancelada'").run();
  const vacia = consultas().ficha(global, 'crm:10');
  assert.deepEqual([vacia.monto_centavos, vacia.numero_compras, vacia.ultima_compra, vacia.score, vacia.segmento],
    [0, 0, null, 0, 'inactivo']);
});

test('paginar 101 clientes no repite ni pierde, y los totales son de todo el conjunto', () => {
  DB.pos.ventas = [];
  for (let i = 0; i < 101; i++) cliente(1, String(1000 + i), `Cliente ${String(i).padStart(3, '0')}`);
  venta(1, '1', '1000', HOY, 5000);
  const vistos = new Set();
  let cursor = 0, totales;
  while (cursor !== null) {
    const pagina = consultas().listar(ocosingo, { cursor, limit: 50 });
    for (const item of pagina.items) { assert.ok(!vistos.has(item.ref)); vistos.add(item.ref); }
    totales = totales || pagina.totales;
    assert.deepEqual(pagina.totales, totales);
    cursor = pagina.siguiente;
  }
  assert.equal(vistos.size, 102);
  assert.equal(totales.clientes, 102);
  assert.equal(totales.monto_centavos, 5000);
});

test('una tienda sin alcance global no ve clientes ni compras de otra tienda', () => {
  cliente(2, '700', 'Carlos Yajalón');
  venta(2, '1', '700', HOY, 50000);
  const refs = consultas().listar(ocosingo, {}).items.map(i => i.ref);
  assert.ok(!refs.includes('crm:20') && !refs.includes('sicar:2:700'));
  for (const ref of ['crm:20', 'sicar:2:700']) assert.throws(() => consultas().ficha(ocosingo, ref), { status: 404 });
  assert.throws(() => consultas().detalle(ocosingo, 'sicar:2:1'), { status: 404 });
  assert.equal(consultas().ficha(global, 'sicar:2:700').monto_centavos, 50000);
});

test('el filtro de tienda recorta la lista pero no la ficha de quien ve todas', () => {
  const filtrado = { ...global, filtroSucursal: 2 };
  assert.deepEqual(consultas().listar(filtrado, {}).items.map(i => i.ref), ['crm:20']);
  assert.equal(consultas().ficha(filtrado, 'crm:10').nombre, 'Ana Ocosingo');
});

test('vínculo con cliente de otra tienda no revela su nombre ni mezcla sus montos', () => {
  cliente(1, '500', 'Beto en SICAR Ocosingo');
  venta(1, '1', '500', HOY, 20000);
  vincular(1, '500', 20);
  const externa = consultas().ficha(ocosingo, 'sicar:1:500');
  assert.equal(externa.monto_centavos, 20000);
  assert.ok(!JSON.stringify(externa).includes('Beto Yajalón'));
  assert.equal(externa.aviso_vinculo, 'Vinculado con un cliente de otra tienda.');
  assert.equal(consultas().ficha(global, 'crm:20').monto_sicar_centavos, 20000);
  assert.throws(() => consultas().ficha(global, 'sicar:1:500'), { status: 404 });
});

test('sin permiso SICAR no aparece ninguna compra ni ficha SICAR', () => {
  cliente(1, '500', 'Ana SICAR');
  venta(1, '1', '500', HOY, 20000);
  vincular(1, '500', 10);
  cliente(1, '501', 'Solo SICAR');
  const sinPermiso = { ...ocosingo, verSicar: false };
  assert.equal(consultas().ficha(sinPermiso, 'crm:10').monto_centavos, 10000);
  assert.deepEqual(consultas().listar(sinPermiso, {}).items.map(i => i.ref), ['crm:10']);
  assert.throws(() => consultas().detalle(sinPermiso, 'sicar:1:1'), { status: 404 });
});

test('público en general de SICAR y el id 0 nativo nunca aparecen', () => {
  cliente(1, '1', 'PUBLICO EN GENERAL');
  cliente(1, '13', 'Mostrador');
  const refs = consultas().listar(global, {}).items.map(i => i.ref);
  assert.ok(!refs.includes('crm:0') && !refs.includes('sicar:1:1') && !refs.includes('sicar:1:13'));
});

test('el resumen reparte SICAR por la tienda donde se compró y POS como hoy', () => {
  cliente(2, '700', 'Carlos');
  venta(2, '1', '700', HOY, 50000);
  const resumen = consultas().resumen(global, {});
  const oco = resumen.sucursales.find(s => s.sucursal_id === 1);
  const yaj = resumen.sucursales.find(s => s.sucursal_id === 2);
  assert.deepEqual([oco.monto_pos_centavos, oco.monto_sicar_centavos], [10000, 0]);
  assert.deepEqual([yaj.monto_pos_centavos, yaj.monto_sicar_centavos, yaj.clientes], [0, 50000, 2]);
});

test('última compra combinada para Gerencia solo de clientes nativos visibles', () => {
  cliente(1, '500', 'Ana SICAR');
  venta(1, '1', '500', '2026-10-20', 1000);
  vincular(1, '500', 10, 'confirmado');
  const ultimas = consultas().ultimasCompras(ocosingo, [10, 20]);
  assert.equal(ultimas.get(10), '2026-10-20');
  assert.equal(ultimas.has(20), false);
});

test('referencias mal formadas responden 404 sin error interno', () => {
  for (const ref of ['crm:abc', 'sicar:1', 'otra:1', '', 'pos:-1']) {
    assert.throws(() => consultas().ficha(global, ref), { status: 404 });
  }
  assert.throws(() => consultas().listar(global, { cursor: -5 }), { status: 400 });
});

test('la búsqueda se hace en servidor sobre todo el conjunto, sin acentos ni mayúsculas', () => {
  cliente(1, '500', 'José Pérez', '9615550000');
  assert.deepEqual(consultas().listar(global, { buscar: 'jose PEREZ' }).items.map(i => i.ref), ['sicar:1:500']);
  assert.deepEqual(consultas().listar(global, { buscar: '961555' }).items.map(i => i.ref), ['sicar:1:500']);
  assert.equal(consultas().listar(global, { buscar: 'jose' }).totales.clientes, 1);
});
