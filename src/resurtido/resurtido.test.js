import { test } from 'node:test';
import assert from 'node:assert/strict';
import { piezas, textoEstado, textoCalidad } from './resurtido.js';
import { CATEGORIAS, moduloVisible } from '../menuCategorias.js';
import * as resurtido from './resurtido.js';

test('explicación habla en piezas y respeta ventanas configuradas sin cálculo', () => {
  const d = { piezas_vendidas: 73, dias_historia: 365, venta_mensual_simple: 6, dias_en_cero: 116,
    mes_calculo: 11, factor: 1.2, minimo: 10, maximo: 19 };
  assert.equal(resurtido.textoExplicacion(d),
    'Vendió 73 piezas en los últimos 12 meses (6 al mes). Estuvo 116 días en cero. Por temporada de noviembre se ajusta ×1.2. Mínimo 10, máximo 19.');
  const texto = resurtido.textoExplicacion({ ...d, dias_historia: 30, minimo: null, maximo: null });
  assert.ok(texto.includes('últimos 30 días')); assert.ok(texto.includes('Sin cálculo de mínimo y máximo'));
});

test('diezmilésimas se muestran como piezas, incluidos negativos', () => {
  assert.equal(piezas(30000), 3); assert.equal(piezas(-30000), -3); assert.equal(piezas(25000), 2.5);
});
test('estados se muestran en español', () => {
  for (const [estado, texto] of [['agotado', 'Agotado'], ['bajo_minimo', 'Bajo mínimo'], ['bien', 'Bien'], ['sobre_maximo', 'Sobre máximo']]) {
    assert.equal(textoEstado({ estado }), texto);
  }
});
test('calidad aproximada tiene advertencia y observada no se confunde con estimación', () => {
  assert.equal(textoCalidad({ calidad: 'aproximada' }), 'Aproximado: algunos días en cero se calcularon hacia atrás');
  assert.equal(textoCalidad({ calidad: 'observada' }), 'Observado: todos los días tienen registros reales');
});
test('menú Resurtido requiere permiso propio de inventario', () => {
  const modulo = CATEGORIAS.flatMap(c => c.modulos).find(m => m.id === 'resurtido');
  assert.ok(modulo);
  assert.equal(moduloVisible(modulo, { modulos: ['inventario'], permisos: ['ver_existencias_sicar'] }), false);
  assert.equal(moduloVisible(modulo, { modulos: ['inventario'], permisos: ['ver_resurtido'] }), true);
});
