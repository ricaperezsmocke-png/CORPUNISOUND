import test from "node:test";
import assert from "node:assert/strict";
import { validarTienda } from "./tiendasAlta.js";

const valida = { nombre: " Innotec ", ciudad: " Ocosingo ", lat: "16.9", lng: "-92.1" };

test("prepara solo los cuatro campos del alta y recorta el texto", () => {
  assert.deepEqual(validarTienda({ ...valida, id: 99, sin_ubicacion: true }), {
    nombre: "Innotec", ciudad: "Ocosingo", lat: 16.9, lng: -92.1,
  });
});

for (const campo of ["nombre", "ciudad"]) {
  for (const valor of [undefined, null, "", "   ", [], 23, "x".repeat(61)]) {
    test(`rechaza ${campo} inválido: ${JSON.stringify(valor)}`, () => {
      assert.throws(() => validarTienda({ ...valida, [campo]: valor }), new RegExp(campo));
    });
  }
}

test("acepta textos de 60 caracteres después de recortar", () => {
  assert.equal(validarTienda({ ...valida, nombre: ` ${"x".repeat(60)} ` }).nombre.length, 60);
});

for (const campo of ["lat", "lng"]) {
  for (const valor of [undefined, null, "", "  ", "abc", Infinity, NaN, true, [], {}]) {
    test(`rechaza ${campo} inválida: ${String(valor)}`, () => {
      assert.throws(() => validarTienda({ ...valida, [campo]: valor }), /GPS|número/);
    });
  }
}

test("acepta cero y los límites, pero rechaza coordenadas fuera de rango", () => {
  for (const [lat, lng] of [[0, 0], [-90, -180], [90, 180]]) {
    assert.deepEqual(validarTienda({ ...valida, lat, lng }), { nombre: "Innotec", ciudad: "Ocosingo", lat, lng });
  }
  for (const [lat, lng] of [[-90.01, 0], [90.01, 0], [0, -180.01], [0, 180.01]]) {
    assert.throws(() => validarTienda({ ...valida, lat, lng }), /número/);
  }
});

test("detecta duplicados sin distinguir acentos, mayúsculas ni espacios, incluso tiendas virtuales", () => {
  const existentes = [{ nombre: "  Yajalón   Centro ", sin_ubicacion: true }];
  assert.throws(() => validarTienda({ ...valida, nombre: "YAJALON centro" }, existentes), /Ya existe.*Yajalón/);
  assert.equal(validarTienda(valida, existentes).nombre, "Innotec");
});
