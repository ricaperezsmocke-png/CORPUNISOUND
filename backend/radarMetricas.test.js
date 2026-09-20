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

const { clasificarEstadoDemanda, seleccionarUniversoDemanda } = require("./radar/metricas");

for (const [estado, esperado] of [
  ["REGISTRADA", "PENDIENTE"], ["EN_SEGUIMIENTO", "PENDIENTE"],
  ["PRODUCTO_DISPONIBLE", "PENDIENTE"], ["CLIENTE_CONTACTADO", "PENDIENTE"],
  ["CONVERTIDA", "CONVERTIDA"], ["NO_CONVERTIDA", "NO_CONVERTIDA"],
  ["CANCELADA", "DESCARTADA"], ["", "NO_CLASIFICABLE"],
  [undefined, "NO_CLASIFICABLE"], [null, "NO_CLASIFICABLE"],
  ["INVENTADO", "NO_CLASIFICABLE"],
]) {
  test(`clasifica el estado ${String(estado)} como ${esperado}`, () => {
    assert.equal(clasificarEstadoDemanda(estado), esperado);
  });
}

test("HISTORICA contiene PENDIENTE, convertidas y no convertidas", () => {
  const registros = ["REGISTRADA", "CONVERTIDA", "NO_CONVERTIDA", "CANCELADA", ""].map(registro);
  assert.deepEqual(seleccionarUniversoDemanda(registros, "PENDIENTE").registros, registros.slice(0, 1));
  const historica = seleccionarUniversoDemanda(registros, "HISTORICA");
  assert.deepEqual(historica.registros, registros.slice(0, 3));
  assert.equal(historica.diagnosticos.length, 1);
  assert.equal(historica.diagnosticos[0].motivo, "ESTADO_NO_CLASIFICABLE");
});

test("canceladas nunca alteran la selección ni sus diagnósticos", () => {
  const registros = [registro("REGISTRADA", 2), registro("NO_CONVERTIDA", 3), registro("INVALIDO")];
  for (const universo of ["PENDIENTE", "HISTORICA"]) {
    const esperado = seleccionarUniversoDemanda(registros, universo);
    for (const cantidad of [1, 7, 100]) {
      const canceladas = Array.from({ length: cantidad }, () => registro("CANCELADA", 999));
      assert.deepEqual(seleccionarUniversoDemanda([...registros, ...canceladas], universo), esperado);
    }
  }
});

test("seleccionar demanda no redefine las métricas operativas ni muta entradas", () => {
  const registros = [registro("REGISTRADA", 2), registro("CONVERTIDA", 3), registro("CANCELADA", 9)];
  const antes = structuredClone(registros);
  const metricas = calcularMetricas(registros);
  seleccionarUniversoDemanda(registros, "HISTORICA");
  assert.deepEqual(registros, antes);
  assert.deepEqual(calcularMetricas(registros), metricas);
  assert.equal(metricas.total, 3);
  assert.equal(metricas.cantidad_solicitada, 14);
});

test("registros dañados se diagnostican y el universo debe ser explícito", () => {
  const resultado = seleccionarUniversoDemanda([null, 42, { estado: {} }], "PENDIENTE");
  assert.deepEqual(resultado.registros, []);
  assert.equal(resultado.diagnosticos.length, 3);
  assert.throws(() => seleccionarUniversoDemanda([], "DESCARTADA"), /universo/i);
});
