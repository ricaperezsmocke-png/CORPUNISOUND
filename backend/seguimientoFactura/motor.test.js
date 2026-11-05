const test = require('node:test');
const assert = require('node:assert/strict');
const { calcular } = require('./motor');

const P = n => BigInt(n) * 10000n; // piezas en diezmilésimas
const T = n => String(P(n));
let sec = 0;
const f = () => `2026-11-10T10:00:${String(sec++ % 60).padStart(2, '0')}`;

const foto = (suc, n) => ({ tipo: 'foto', fecha: f(), sucursal_id: suc, piezas: P(n) });
const compra = (id, n, centavos, extra = {}) => ({ tipo: 'compra', fecha: f(), sucursal_id: 6, piezas: P(n),
  valor_centavos: BigInt(centavos), lote: { sucursal_id: 6, com_id: id, renglon: 1 }, ...extra });
const venta = (suc, n, extra = {}) => ({ tipo: 'venta', fecha: f(), sucursal_id: suc, piezas: P(n), ...extra });
const tras = (origen, destino, folio = 'F') => ({ origen, destino, folio, suc_origen: `s${origen}`, suc_destino: `s${destino}` });
const salida = (origen, destino, n, extra = {}) => ({ tipo: 'salida', fecha: f(), sucursal_id: origen, piezas: P(n),
  traspaso: tras(origen, destino, extra.folio), sin_agente: false, estado: 'enviado', ...extra });
const recepcion = (origen, destino, n, extra = {}) => ({ tipo: 'recepcion', fecha: f(), sucursal_id: destino,
  piezas: P(n), traspaso: tras(origen, destino, extra.folio), estado: 'recibido', ...extra });

function conserva(r) {
  for (const l of r.lotes) {
    const queda = Object.values(l.por_sucursal).reduce((a, s) => a + BigInt(s.queda), 0n);
    assert.equal(queda, BigInt(l.queda), `queda por sucursal ${l.lote.com_id}`);
    const suma = BigInt(l.vendido) + queda + BigInt(l.transito) + BigInt(l.sin_agente) + BigInt(l.por_aclarar);
    assert.equal(suma, BigInt(l.comprado), `piezas conservadas en ${l.lote.com_id}`);
    if (l.dinero) {
      const d = l.dinero;
      const total = [d.vendido, d.queda, d.transito, d.gris, d.por_aclarar].reduce((a, v) => a + BigInt(v), 0n);
      assert.equal(total, BigInt(l.valor_centavos), `centavos conservados en ${l.lote.com_id}`);
    }
  }
  return r;
}
const lote = (r, id) => r.lotes.find(l => l.lote.com_id === id);

test('la foto (anterior) se vende antes que la factura nueva', () => {
  const r = conserva(calcular([foto(6, 5), compra('A', 10, 10000), venta(6, 7)]));
  assert.deepEqual(r.anterior, { 6: '0' });
  const a = lote(r, 'A');
  assert.equal(a.vendido, T(2));
  assert.deepEqual(a.por_sucursal, { 6: { queda: T(8), vendido: T(2) } });
  assert.deepEqual(r.incierto, []);
});

test('dos compras con costo distinto: FIFO y dinero de cada una', () => {
  const r = conserva(calcular([compra('A', 10, 10000), compra('B', 10, 20000), venta(6, 15)]));
  assert.equal(lote(r, 'A').vendido, T(10));
  assert.equal(lote(r, 'B').vendido, T(5));
  assert.deepEqual(lote(r, 'A').dinero, { vendido: '10000', queda: '0', transito: '0', gris: '0', por_aclarar: '0' });
  assert.deepEqual(lote(r, 'B').dinero, { vendido: '10000', queda: '10000', transito: '0', gris: '0', por_aclarar: '0' });
});

test('bolsa de $100 en 36 piezas: el centavo sobrante va en orden fijo y al final cuadra exacto', () => {
  const r1 = conserva(calcular([compra('A', 36, 10000), venta(6, 10)]));
  assert.deepEqual(lote(r1, 'A').dinero, { vendido: '2778', queda: '7222', transito: '0', gris: '0', por_aclarar: '0' });
  const r3 = conserva(calcular([compra('A', 36, 10000), venta(6, 10), venta(6, 10), venta(6, 16)]));
  assert.equal(lote(r3, 'A').dinero.vendido, '10000');
  assert.equal(lote(r3, 'A').queda, '0');
});

test('un tramo sin piezas nunca recibe un centavo sobrante', () => {
  const r = conserva(calcular([compra('A', 3, 100), salida(6, 2, 1, { sin_agente: true })]));
  // 100 × 2/3 = 66.66, 100 × 1/3 = 33.33; sobra 1 → vendido (0 piezas) se salta, va a queda.
  assert.deepEqual(lote(r, 'A').dinero, { vendido: '0', queda: '67', transito: '0', gris: '33', por_aclarar: '0' });
});

test('salida a tienda no incorporada va a gris', () => {
  const r = conserva(calcular([compra('A', 10, 1000), salida(6, 4, 4, { sin_agente: true })]));
  assert.equal(lote(r, 'A').sin_agente, T(4));
  assert.deepEqual(lote(r, 'A').por_sucursal, { 6: { queda: T(6), vendido: '0' } });
});

test('enviado sin recibir queda en tránsito; al recibir pasa al destino', () => {
  const ida = [compra('A', 10, 1000), salida(6, 1, 4)];
  const r = conserva(calcular(ida));
  assert.equal(lote(r, 'A').transito, T(4));
  const r2 = conserva(calcular([...ida, recepcion(6, 1, 4)]));
  assert.equal(lote(r2, 'A').transito, '0');
  assert.deepEqual(lote(r2, 'A').por_sucursal[1], { queda: T(4), vendido: '0' });
});

test('traslado entre tiendas conserva la factura y su antigüedad', () => {
  const r = conserva(calcular([
    compra('A', 5, 500), compra('B', 5, 1000),
    salida(6, 1, 5, { folio: '1' }), recepcion(6, 1, 5, { folio: '1' }), // A llega a Ocosingo
    salida(6, 1, 5, { folio: '2' }), recepcion(6, 1, 5, { folio: '2' }), // B llega a Ocosingo
    salida(1, 3, 6, { folio: '3' }), recepcion(1, 3, 6, { folio: '3' }), // 5 de A + 1 de B a San Cristóbal
    venta(3, 6),
  ]));
  assert.deepEqual(lote(r, 'A').por_sucursal, { 3: { queda: '0', vendido: T(5) } });
  assert.deepEqual(lote(r, 'B').por_sucursal, { 1: { queda: T(4), vendido: '0' }, 3: { queda: '0', vendido: T(1) } });
});

test('en una tienda se consume primero la factura más vieja aunque haya llegado después', () => {
  const r = conserva(calcular([
    compra('A', 2, 200), compra('B', 2, 200),
    salida(6, 1, 2, { folio: 'a' }), salida(6, 1, 2, { folio: 'b' }), // a lleva A, b lleva B
    recepcion(6, 1, 2, { folio: 'b' }), recepcion(6, 1, 2, { folio: 'a' }),
    venta(1, 1),
  ]));
  assert.equal(lote(r, 'A').vendido, T(1));
  assert.equal(lote(r, 'B').vendido, '0');
});

test('venta sin existencia: consume lo que hay y el resto es incierto', () => {
  const r = conserva(calcular([compra('A', 2, 200), venta(6, 3)]));
  assert.equal(lote(r, 'A').vendido, T(2));
  assert.deepEqual(r.incierto, ['venta_sin_existencia']);
});

test('nunca se vende una factura que todavía no llega', () => {
  const r = conserva(calcular([venta(6, 1), compra('A', 2, 200)]));
  assert.equal(lote(r, 'A').vendido, '0');
  assert.deepEqual(r.incierto, ['venta_sin_existencia']);
});

test('recepción menor: la diferencia queda por aclarar, no como faltante', () => {
  const r = conserva(calcular([compra('A', 10, 1000),
    salida(6, 1, 5, { por_aclarar: 'recepcion_menor', piezas_por_aclarar: P(2) }), recepcion(6, 1, 3)]));
  const a = lote(r, 'A');
  assert.equal(a.por_aclarar, T(2));
  assert.equal(a.transito, '0');
  assert.deepEqual(a.por_sucursal[1], { queda: T(3), vendido: '0' });
});

test('recepción mayor: no inventa piezas, el excedente es incierto', () => {
  const r = conserva(calcular([compra('A', 10, 1000), salida(6, 1, 3), recepcion(6, 1, 5, { por_aclarar: 'recepcion_mayor' })]));
  assert.deepEqual(lote(r, 'A').por_sucursal[1], { queda: T(3), vendido: '0' });
  assert.deepEqual(r.incierto, ['recepcion_mayor']);
});

test('salida dudosa sale del origen hacia por aclarar; su recepción no mueve nada', () => {
  const r = conserva(calcular([compra('A', 10, 1000),
    salida(6, 1, 4, { por_aclarar: 'dia_del_corte' }), recepcion(6, 1, 4, { por_aclarar: 'dia_del_corte' })]));
  const a = lote(r, 'A');
  assert.equal(a.por_aclarar, T(4));
  assert.equal(a.por_sucursal[1], undefined);
  assert.ok(a.motivos.includes('dia_del_corte'));
  assert.deepEqual(r.incierto, ['dia_del_corte']);
});

test('observaciones no mueven piezas', () => {
  const r = conserva(calcular([compra('A', 10, 1000),
    salida(6, 1, 4, { por_aclarar: 'folio_ambiguo', solo_observacion: true })]));
  assert.deepEqual(lote(r, 'A').por_sucursal, { 6: { queda: T(10), vendido: '0' } });
  assert.deepEqual(r.incierto, ['folio_ambiguo']);
});

test('venta con clave en problema cuenta como por aclarar, no como vendida', () => {
  const r = conserva(calcular([compra('A', 10, 1000, { por_aclarar: 'clave_con_problema' }),
    venta(6, 4, { por_aclarar: 'clave_con_problema' })]));
  const a = lote(r, 'A');
  assert.equal(a.vendido, '0');
  assert.equal(a.por_aclarar, T(4));
  assert.deepEqual(a.motivos, ['clave_con_problema']);
});

test('compra fraccionaria: el lote existe y queda marcado', () => {
  const r = conserva(calcular([compra('A', 1, 617, { por_aclarar: 'cantidad_fraccionaria' })]));
  assert.deepEqual(lote(r, 'A').motivos, ['cantidad_fraccionaria']);
  assert.equal(lote(r, 'A').por_aclarar, '0');
});

test('anterior trasladado sigue siendo anterior en el destino', () => {
  const r = conserva(calcular([foto(6, 3), salida(6, 1, 2), recepcion(6, 1, 2)]));
  assert.deepEqual(r.anterior, { 6: T(1), 1: T(2) });
  assert.deepEqual(r.lotes, []);
});

test('lote sin costo: dinero no calculable', () => {
  const r = conserva(calcular([compra('A', 2, 0)]));
  assert.equal(lote(r, 'A').dinero, null);
});

test('la salida es JSON segura y no muta la entrada', () => {
  const entrada = [compra('A', 2, 200), venta(6, 1)];
  const copia = JSON.stringify(entrada, (_k, v) => typeof v === 'bigint' ? v.toString() : v);
  const r = calcular(entrada);
  assert.doesNotThrow(() => JSON.stringify(r));
  assert.equal(JSON.stringify(entrada, (_k, v) => typeof v === 'bigint' ? v.toString() : v), copia);
});
