const { test } = require('node:test');
const assert = require('node:assert/strict');
const { evaluarTactica, evaluarPlan, textoResultado } = require('./cierreMes');

const MES = '2026-10';
// Táctica por sistema que mueve el ticket promedio con candado artículos por ticket. Las cifras son enteros como en el tablero.
function tactica(cambios = {}) {
  return { id: 24, como_se_mide: 'sistema', mes: MES, numero: 'ticket_promedio_centavos', valor: 10500, base: 10000, base_tipo: 'mismo_mes',
    candado: 'articulos_por_ticket', candado_valor: 150, candado_base: 150, evidencia: null, ...cambios };
}
const captura = (id, fecha, extra = {}) => ({ id, meta_clave: 9, fecha, cantidad: 1, anulada: null, ...extra });
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
