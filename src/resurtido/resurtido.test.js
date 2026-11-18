import { test } from 'node:test';
import assert from 'node:assert/strict';
import { piezas, textoEstado, textoCalidad } from './resurtido.js';
import { CATEGORIAS, moduloVisible } from '../menuCategorias.js';

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
