const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validarPeriodo, finDePeriodo, inicioDePeriodo, ritmoEsperado } = require("./metasPeriodos");

test("la semana va de lunes a domingo", () => {
  assert.equal(finDePeriodo("semanal", "2026-10-05"), "2026-10-11");
  assert.equal(inicioDePeriodo("semanal", "2026-10-11"), "2026-10-05");
  assert.equal(inicioDePeriodo("semanal", "2026-10-05"), "2026-10-05");
  assert.throws(() => validarPeriodo("semanal", "2026-10-06"), /lunes/);
});

test("mes y trimestre de calendario, incluido febrero bisiesto y fin de año", () => {
  assert.equal(finDePeriodo("mensual", "2028-02-01"), "2028-02-29");
  assert.equal(finDePeriodo("trimestral", "2026-10-01"), "2026-12-31");
  assert.equal(inicioDePeriodo("trimestral", "2026-08-15"), "2026-07-01");
  assert.equal(inicioDePeriodo("mensual", "2026-08-15"), "2026-08-01");
  assert.throws(() => validarPeriodo("mensual", "2026-10-02"), /día 1/);
  assert.throws(() => validarPeriodo("trimestral", "2026-02-01"), /enero, abril, julio u octubre/);
});

test("periodo o fecha inválidos se rechazan", () => {
  assert.throws(() => validarPeriodo("anual", "2026-01-01"), /semanal, mensual o trimestral/);
  assert.throws(() => validarPeriodo("mensual", "2026-02-30"), /fecha/);
  assert.throws(() => validarPeriodo("mensual", 20261001), /fecha/);
});

test("ritmo esperado: 0 antes, proporcional durante, 1 al terminar", () => {
  assert.equal(ritmoEsperado("semanal", "2026-10-05", "2026-10-04"), 0);
  assert.equal(ritmoEsperado("semanal", "2026-10-05", "2026-10-05"), 1 / 7);
  assert.equal(ritmoEsperado("semanal", "2026-10-05", "2026-10-11"), 1);
  assert.equal(ritmoEsperado("semanal", "2026-10-05", "2026-11-01"), 1);
});
