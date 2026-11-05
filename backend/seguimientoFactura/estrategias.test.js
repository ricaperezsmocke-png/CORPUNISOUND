const test = require('node:test');
const assert = require('node:assert/strict');
const { VALORES_INICIALES: C } = require('./config');
const { etapa, velocidades, sugerirTraslados, textoMargen, avisoArticuloCompartido } = require('./estrategias');

const P = n => BigInt(n) * 10000n;
const T = n => String(P(n));
// Semanas de la más vieja a la más reciente; la última es la semana completa más reciente.
const semanas = (...n) => n.map(P);

test('etapas en sus límites exactos', () => {
  assert.equal(etapa(44, C), null);
  assert.equal(etapa(45, C), 'traslado');
  assert.equal(etapa(59, C), 'traslado');
  assert.equal(etapa(60, C), 'margen_75');
  assert.equal(etapa(89, C), 'margen_75');
  assert.equal(etapa(90, C), 'margen_50');
  assert.equal(etapa(119, C), 'margen_50');
  assert.equal(etapa(120, C), 'liquidar');
  assert.equal(etapa(NaN, C), null);
  assert.equal(etapa(-1, C), null);
});

test('velocidades de 8 y 4 semanas y semanas con venta', () => {
  const v = velocidades({ 1: semanas(0, 0, 0, 0, 0, 0, 1, 1), 3: semanas(0, 0, 4, 0, 4, 4, 4, 0) }, C);
  assert.deepEqual(v[1], { suma8: P(2), suma4: P(2), v8: '2500', v4: '5000', semanas_con_venta: 2 });
  assert.deepEqual(v[3], { suma8: P(16), suma4: P(12), v8: '20000', v4: '30000', semanas_con_venta: 4 });
});

test('solo cuentan las últimas 8 semanas aunque lleguen más', () => {
  const v = velocidades({ 1: semanas(50, 50, 1, 0, 0, 0, 0, 0, 0, 1) }, C);
  assert.equal(v[1].suma8, P(2));
  assert.equal(v[1].semanas_con_venta, 2);
});

// Ocosingo (1) vendió 2 en 8 semanas; San Cristóbal (3) vendió 16 y tiene 6.
const base = () => ({
  saldoViejo: { 1: P(10) },
  velocidades: velocidades({ 1: semanas(0, 0, 0, 0, 0, 0, 1, 1), 3: semanas(0, 0, 4, 0, 4, 4, 4, 0) }, C),
  existencias: { 1: P(10), 3: P(6) },
  transito: {},
  atrasadas: [],
  config: C,
});

test('cantidad = mínimo de saldo viejo, sobrante del origen y faltante del destino', () => {
  // Destino: 4 semanas × 2/sem = 8, tiene 6 → le faltan 2. Origen: deja 2 × 0.25 = 0.5 → sobran 9 (redondeo a favor
  // del origen). Saldo viejo 10. Mínimo = 2.
  assert.deepEqual(sugerirTraslados(base()), [{ de: 1, a: 3, piezas: T(2), razon: 'destino_vende_mas' }]);
  const conTransito = { ...base(), transito: { 3: P(1) } };
  assert.deepEqual(sugerirTraslados(conTransito), [{ de: 1, a: 3, piezas: T(1), razon: 'destino_vende_mas' }]);
  const pocoSaldo = { ...base(), existencias: { 1: P(10), 3: P(0) }, saldoViejo: { 1: P(3) } };
  assert.deepEqual(sugerirTraslados(pocoSaldo), [{ de: 1, a: 3, piezas: T(3), razon: 'destino_vende_mas' }]);
  const origenJusto = { ...base(), existencias: { 1: P(1), 3: P(0) } };
  assert.deepEqual(sugerirTraslados(origenJusto), []); // 1 − reserva 0.5 → sobra 0 pieza entera
});

test('destino necesita al menos el doble de velocidad, 2 semanas con venta y cobertura menor a 4 semanas', () => {
  // Destino vacío: solo la regla del doble puede descartarlo.
  const lento = { ...base(), existencias: { 1: P(10), 3: P(0) },
    velocidades: velocidades({ 1: semanas(0, 0, 0, 0, 1, 1, 1, 1), 3: semanas(0, 0, 0, 0, 2, 2, 1, 2) }, C) };
  assert.deepEqual(sugerirTraslados(lento), []); // 7 < 2 × 4
  const justoDoble = { ...lento, velocidades: velocidades({ 1: semanas(0, 0, 0, 0, 1, 1, 1, 1), 3: semanas(0, 0, 0, 0, 2, 2, 2, 2) }, C) };
  // Destino 8 = 2 × 4 sí califica: le faltan 4 semanas × 1/sem = 4; origen deja 2 × 0.5 = 1 → sobran 9.
  assert.deepEqual(sugerirTraslados(justoDoble), [{ de: 1, a: 3, piezas: T(4), razon: 'destino_vende_mas' }]);
  const unaSemana = { ...base(), velocidades: velocidades({ 1: semanas(0, 0, 0, 0, 0, 0, 0, 0), 3: semanas(0, 0, 0, 0, 0, 0, 0, 16) }, C) };
  assert.deepEqual(sugerirTraslados(unaSemana), []);
  const cubierto = { ...base(), existencias: { 1: P(10), 3: P(8) } }; // 8 piezas / 2 por semana = 4 semanas
  assert.deepEqual(sugerirTraslados(cubierto), []);
});

test('dos destinos no se reparten la misma pieza dos veces', () => {
  const s = {
    saldoViejo: { 1: P(3) },
    velocidades: velocidades({ 1: semanas(0, 0, 0, 0, 0, 0, 0, 0), 2: semanas(0, 0, 0, 0, 0, 0, 4, 4),
      3: semanas(0, 0, 0, 0, 4, 4, 4, 4) }, C),
    existencias: { 1: P(20), 2: P(0), 3: P(0) },
    transito: {}, atrasadas: [], config: C,
  };
  const r = sugerirTraslados(s);
  // Primero el que más vende (3 necesita 8), y solo hay 3 piezas viejas.
  assert.deepEqual(r, [{ de: 1, a: 3, piezas: T(3), razon: 'destino_vende_mas' }]);
});

test('dos facturas viejas en dos orígenes no llenan dos veces al mismo destino', () => {
  const s = {
    saldoViejo: { 1: P(5), 2: P(5) },
    velocidades: velocidades({ 1: semanas(0, 0, 0, 0, 0, 0, 0, 0), 2: semanas(0, 0, 0, 0, 0, 0, 0, 0),
      3: semanas(0, 0, 0, 0, 1, 1, 1, 1) }, C),
    existencias: { 1: P(5), 2: P(5), 3: P(0) },
    transito: {}, atrasadas: [], config: C,
  };
  // 3 vende 0.5/sem → para 4 semanas le faltan 2 en total.
  assert.deepEqual(sugerirTraslados(s), [{ de: 1, a: 3, piezas: T(2), razon: 'destino_vende_mas' }]);
});

test('tienda atrasada o sin datos nunca es candidata; origen sin datos → información insuficiente', () => {
  assert.deepEqual(sugerirTraslados({ ...base(), atrasadas: [3] }),
    [{ de: 1, a: null, piezas: null, razon: 'informacion_insuficiente' }]);
  assert.deepEqual(sugerirTraslados({ ...base(), atrasadas: [1] }),
    [{ de: 1, a: null, piezas: null, razon: 'informacion_insuficiente' }]);
  const sinVelocidadOrigen = { ...base(), saldoViejo: { 4: P(5) } };
  assert.deepEqual(sugerirTraslados(sinVelocidadOrigen), [{ de: 4, a: null, piezas: null, razon: 'informacion_insuficiente' }]);
  const destinoSinExistencia = { ...base(), existencias: { 1: P(10) } };
  assert.deepEqual(sugerirTraslados(destinoSinExistencia), [{ de: 1, a: null, piezas: null, razon: 'informacion_insuficiente' }]);
});

test('texto de margen 75/50/0 con último precio como referencia y nunca abajo del costo', () => {
  const r75 = textoMargen({ costo_pieza_centavos: 10000n, ultimo_precio_centavos: 20000n, etapa: 'margen_75', config: C });
  assert.equal(r75.precio_referencia_centavos, '17500');
  assert.match(r75.texto, /75 %/);
  assert.match(r75.texto, /\$100\.00/);
  assert.match(r75.texto, /referencia/);
  assert.match(r75.texto, /\$175\.00/);
  const r50 = textoMargen({ costo_pieza_centavos: 10001n, ultimo_precio_centavos: 20000n, etapa: 'margen_50', config: C });
  assert.equal(r50.precio_referencia_centavos, '15001'); // 10001 + ⌈9999 × 0.5⌉
  const r0 = textoMargen({ costo_pieza_centavos: 123456n, etapa: 'liquidar', config: C });
  assert.equal(r0.precio_referencia_centavos, null);
  assert.match(r0.texto, /\$1,234\.56/);
  const sinPrecio = textoMargen({ costo_pieza_centavos: 10000n, etapa: 'margen_75', config: C });
  assert.equal(sinPrecio.precio_referencia_centavos, null);
  assert.match(sinPrecio.texto, /costo \+ 75 % de la ganancia actual/);
  const sinGanancia = textoMargen({ costo_pieza_centavos: 10000n, ultimo_precio_centavos: 9000n, etapa: 'margen_75', config: C });
  assert.equal(sinGanancia.precio_referencia_centavos, null);
  assert.match(sinGanancia.texto, /no deja ganancia/);
  assert.equal(textoMargen({ costo_pieza_centavos: 10000n, etapa: 'traslado', config: C }), null);
});

test('aviso de artículo compartido con compras recientes', () => {
  assert.equal(avisoArticuloCompartido([]), null);
  assert.match(avisoArticuloCompartido([{ piezas: P(4), dias: 10 }]), /4 piezas compradas hace 10 días/);
  assert.match(avisoArticuloCompartido([{ piezas: P(1), dias: 3 }]), /1 pieza comprada hace 3 días/);
  assert.match(avisoArticuloCompartido([{ piezas: P(4), dias: 10 }, { piezas: P(2), dias: 20 }]),
    /6 piezas compradas hace entre 10 y 20 días/);
  assert.match(avisoArticuloCompartido([{ piezas: P(1), dias: 3 }]), /por artículo/);
});
