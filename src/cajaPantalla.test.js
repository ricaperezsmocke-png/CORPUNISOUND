import { test } from "node:test";
import assert from "node:assert/strict";
import { puedeCambiarCaja, nombreCajaActiva, formatoImporteCaja } from "./cajaPantalla.js";

test("un ticket con renglones impide cambiar de caja; uno vacío permite cambiar", () => {
  assert.equal(puedeCambiarCaja("1"), false);
  assert.equal(puedeCambiarCaja(null), true);
  assert.equal(puedeCambiarCaja(""), true);
});

test("el nombre de la caja activa viene del catálogo, normalizando el id", () => {
  const cajas = [{ id: 8, nombre: "Administrativa" }, { id: 9, nombre: "Fiscal" }];
  assert.equal(nombreCajaActiva(cajas, "9"), "Fiscal");
  assert.equal(nombreCajaActiva(cajas, 8), "Administrativa");
  assert.equal(nombreCajaActiva(cajas, null), "Sin caja");
  assert.equal(nombreCajaActiva(cajas, 99), "Sin caja");
  assert.equal(nombreCajaActiva([], 9), "Sin caja");
});

test("los importes llevan miles, dos decimales y el signo antes del peso", () => {
  for (const [importe, esperado] of [
    [4122.8, "$ 4,122.80"], [-2150, "-$ 2,150.00"], [0, "$ 0.00"],
    [null, "$ 0.00"], ["1234567.89", "$ 1,234,567.89"], [12.5, "$ 12.50"],
  ]) assert.equal(formatoImporteCaja(importe), esperado);
});
