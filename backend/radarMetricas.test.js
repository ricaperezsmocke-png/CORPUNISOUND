const test = require("node:test");
const assert = require("node:assert/strict");

const { calcularMetricas } = require("./radar/metricas");

const registro = (estado, cantidad = 1) => ({ estado, cantidad });

test("la conversión solo mira cierres decididos", () => {
  const m = calcularMetricas([
    registro("CONVERTIDA"), registro("NO_CONVERTIDA"), registro("REGISTRADA"),
  ]);
  assert.equal(m.tasa_conversion, 50);
  assert.deepEqual(m.conversion_detalle, { numerador: 1, denominador: 2 });
});

test("la recuperación sí cuenta los pendientes", () => {
  const m = calcularMetricas([
    registro("CONVERTIDA"), registro("NO_CONVERTIDA"), registro("REGISTRADA"),
  ]);
  assert.equal(m.tasa_recuperacion, 33.33);
  assert.deepEqual(m.recuperacion_detalle, { numerador: 1, denominador: 3 });
});

test("las canceladas no entran en ninguna tasa", () => {
  const m = calcularMetricas([registro("CONVERTIDA"), registro("CANCELADA")]);
  assert.equal(m.tasa_conversion, 100);
  assert.equal(m.tasa_recuperacion, 100);
  assert.equal(m.canceladas, 1);
});

test("sin denominador devuelve cero, nunca NaN", () => {
  const m = calcularMetricas([registro("CANCELADA")]);
  assert.equal(m.tasa_conversion, 0);
  assert.equal(m.tasa_recuperacion, 0);
});

test("una lista vacía no rompe nada", () => {
  const m = calcularMetricas([]);
  assert.equal(m.total, 0);
  assert.equal(m.tasa_conversion, 0);
  assert.equal(m.cantidad_solicitada, 0);
});
