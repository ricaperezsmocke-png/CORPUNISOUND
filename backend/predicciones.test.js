const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { predecirDemanda } = require("./predicciones");

test("predecirDemanda sin historial importado usa solo las ventas reales (comportamiento previo sin cambios)", () => {
  const DB = construirDBPrueba();
  const resultado = predecirDemanda(DB, { producto_id: 1 });
  assert.ok(!resultado.error);
  assert.ok(resultado.historico.length > 0);
});

test("predecirDemanda suma el historial importado a las ventas reales del mismo mes", () => {
  const DB = construirDBPrueba();
  const antes = predecirDemanda(DB, { producto_id: 1 });
  const mesConVentaReal = antes.historico[0].periodo;
  const cantidadAntes = antes.historico[0].cantidad;

  DB.pos.historial_ventas_mensual.push({ producto_id: 1, sucursal_id: 1, periodo: mesConVentaReal, cantidad: 100 });

  const despues = predecirDemanda(DB, { producto_id: 1 });
  const mesEncontrado = despues.historico.find((h) => h.periodo === mesConVentaReal);
  assert.strictEqual(mesEncontrado.cantidad, cantidadAntes + 100);
});

test("predecirDemanda incluye un mes que SOLO tiene historial importado (sin ninguna venta real en ese mes)", () => {
  const DB = construirDBPrueba();
  DB.pos.historial_ventas_mensual.push({ producto_id: 1, sucursal_id: 1, periodo: "2015-06", cantidad: 50 });

  const resultado = predecirDemanda(DB, { producto_id: 1 });
  const mesHistorico = resultado.historico.find((h) => h.periodo === "2015-06");
  assert.ok(mesHistorico, "el mes 2015-06 debe aparecer en el historico aunque no haya venta real ahi");
  assert.strictEqual(mesHistorico.cantidad, 50);
});

test("predecirDemanda respeta el filtro de categoria_id tambien sobre el historial importado", () => {
  const DB = construirDBPrueba();
  // producto 1 = categoria_id 1 (ver testHelpers) - agregar historial de un producto de OTRA categoria
  const productoOtraCategoria = DB["catalogo-productos"].productos.find((p) => p.categoria_id !== 1);
  DB.pos.historial_ventas_mensual.push({ producto_id: productoOtraCategoria.id, sucursal_id: 1, periodo: "2015-06", cantidad: 999 });
  DB.pos.historial_ventas_mensual.push({ producto_id: 1, sucursal_id: 1, periodo: "2015-06", cantidad: 7 });

  const resultado = predecirDemanda(DB, { categoria_id: 1, meses_adelante: 1 });
  const mesHistorico = resultado.historico.find((h) => h.periodo === "2015-06");
  assert.strictEqual(mesHistorico.cantidad, 7, "no debe incluir la cantidad del producto de otra categoria");
});

test("predecirDemanda ignora historial de un producto_id que ya no existe en el catalogo, sin tronar", () => {
  const DB = construirDBPrueba();
  DB.pos.historial_ventas_mensual.push({ producto_id: 999999, sucursal_id: 1, periodo: "2015-06", cantidad: 10 });
  assert.doesNotThrow(() => predecirDemanda(DB, { producto_id: 1 }));
});
