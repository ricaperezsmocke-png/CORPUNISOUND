import { test } from 'node:test';
import assert from 'node:assert/strict';
import { piezas, textoEstado, textoCalidad } from './resurtido.js';
import { CATEGORIAS, moduloVisible } from '../menuCategorias.js';
import * as resurtido from './resurtido.js';

test('origen de temporada distingue SICAR y cálculo con las cuatro tiendas', () => {
  assert.equal(resurtido.textoTemporada({ temporada_origen: 'sicar' }), 'Temporada medida en SICAR de San Cristóbal (2022–2025)');
  assert.equal(resurtido.textoTemporada({ temporada_origen: 'calculada' }), 'Temporada calculada con las ventas de las cuatro tiendas');
});

test('estado sin pedir se muestra como No se pide', () => {
  assert.equal(textoEstado({ estado: 'sin_pedir' }), 'No se pide');
});

test('aviso de pedido especial aparece únicamente con excedente positivo', () => {
  assert.equal(resurtido.textoPedidoEspecial({ piezas_pedido_especial: 51 }),
    '51 piezas vendidas en tickets grandes se tomaron como pedido especial y no suben el mínimo.');
  assert.equal(resurtido.textoPedidoEspecial({ piezas_pedido_especial: 0 }), '');
});

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

test('texto para WhatsApp: total por clave y reparto solo de tiendas con pedido', () => {
  const datos = { marca: 'JR', renglones: [
    { clave: 'CUE1A', descripcion: 'CUERDAS D ACERO 1as', total: 240000,
      por_tienda: [{ sucursal_id: 1, sugerido: 60000 }, { sucursal_id: 3, sugerido: 180000 }] },
    { clave: 'F5JR', descripcion: 'FUNDA 5', total: 10000, por_tienda: [{ sucursal_id: 4, sugerido: 10000 }] },
  ] };
  assert.equal(resurtido.textoWhatsApp(datos, '19/11/2026'),
    'Pedido JR — 19/11/2026\nCUE1A CUERDAS D ACERO 1as — 24 (Oco 6, SC 18)\nF5JR FUNDA 5 — 1 (Pal 1)');
  assert.equal(resurtido.textoWhatsApp({ marca: 'SOLCOR', renglones: [] }, '19/11/2026'),
    'Pedido SOLCOR — 19/11/2026\nNo hay nada que pedir.');
});

test('frase del sugerido en la explicación', () => {
  assert.equal(resurtido.textoSugerido({ sugerido: 7, maximo: 20, existencia: 5, en_camino: 8 }),
    'Se sugiere pedir 7 (máximo 20 − hay 5 − en camino 8).');
  assert.equal(resurtido.textoSugerido({ sugerido: 0, maximo: 0, existencia: 0, en_camino: 0 }), 'No se sugiere pedir.');
  assert.equal(resurtido.textoSugerido({ sugerido: null }), 'Datos atrasados: no se sugiere.');
  assert.equal(resurtido.textoSugerido({ sugerido: 2, maximo: 2, existencia: -1, en_camino: 0 }),
    'Se sugiere pedir 2 (máximo 2 − hay 0 − en camino 0).');
});

test('texto para WhatsApp avisa las tiendas con datos atrasados que quedaron fuera', () => {
  const datos = { marca: 'JR', tiendas_atrasadas: [2, 4], renglones: [
    { clave: 'CUE1A', descripcion: 'CUERDAS', total: 10000, por_tienda: [{ sucursal_id: 1, sugerido: 10000 }] }] };
  assert.equal(resurtido.textoWhatsApp(datos, '19/11/2026'),
    'Pedido JR — 19/11/2026\nCUE1A CUERDAS — 1 (Oco 1)\nSin datos al día, NO incluidas: Yajalón, Palenque');
});

test('frase del sugerido explica redondeo y por qué no se pide', () => {
  assert.equal(resurtido.textoSugerido({ sugerido: 3, maximo: 5, existencia: 2.5, en_camino: 0 }),
    'Se sugiere pedir 3 (máximo 5 − hay 2.5 − en camino 0, redondeado a pieza entera).');
  assert.equal(resurtido.textoSugerido({ sugerido: 0, lista: 'sin_movimiento', maximo: 0, existencia: 0, en_camino: 0 }),
    'No se sugiere pedir: no se ha vendido en el año. Corrige el máximo a mano si quieres pedirlo.');
});

test('sin pedido porque ya llega a su máximo lo dice con números', () => {
  assert.equal(resurtido.textoSugerido({ sugerido: 0, lista: 'calculado', maximo: 24, existencia: 18, en_camino: 6 }),
    'No se sugiere pedir: con lo que hay (18) y lo que viene en camino (6) llega a su máximo (24).');
  assert.equal(resurtido.textoSugerido({ sugerido: 0, lista: 'calculado', maximo: 24, existencia: 30, en_camino: 0 }),
    'No se sugiere pedir: con lo que hay (30) llega a su máximo (24).');
});
