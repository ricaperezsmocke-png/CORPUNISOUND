import test from "node:test";
import assert from "node:assert/strict";
import { validarTienda } from "./tiendasAlta.js";
import * as altas from "./tiendasAlta.js";

const valida = { nombre: " Innotec ", ciudad: " Ocosingo ", lat: "16.9", lng: "-92.1" };

for (const [nombre, existente] of [
  ["SanCristobal", "San Cristóbal"], ["san  cristóbal", "SanCristobal"],
  ["Palenque\u200B", "Palenque"], ["Mercado Libre", "MercadoLibre"], ["ＭｅｒｃａｄｏLibre", "MercadoLibre"],
]) {
  test(`pantalla rechaza duplicado ${nombre}`, () => {
    assert.throws(() => validarTienda({ ...valida, nombre }, [{ nombre: existente }]), /Ya existe una tienda/);
  });
}
for (const campo of ["nombre", "ciudad"]) {
  for (const valor of ["\u200B", "---", "\u200C\u200D\u2060\uFEFF", "\uFEFF", "\u0085"]) {
    test(`pantalla rechaza ${campo} sin letras: ${valor}`, () => {
      assert.throws(() => validarTienda({ ...valida, [campo]: valor }), /debe tener letras o números/);
    });
  }
}
test("pantalla limpia invisibles y espacios Unicode antes del límite", () => {
  const resultado = validarTienda({
    ...valida, nombre: `\u200B${"x".repeat(60)}\u200D`, ciudad: " San\u00A0 \u3000Cristóbal\u2060 ",
  });
  assert.equal(resultado.nombre, "x".repeat(60));
  assert.equal(resultado.ciudad, "San Cristóbal");
});
test("pantalla colapsa y compara también el espacio Unicode NEXT LINE", () => {
  assert.throws(() => validarTienda({ ...valida, nombre: "Mercado\u0085Libre" }, [{ nombre: "MercadoLibre" }]), /Ya existe/);
  assert.equal(validarTienda({ ...valida, ciudad: "San\u0085 Cristóbal" }).ciudad, "San Cristóbal");
});
test("respuesta 502 HTML muestra error comprensible", async () => {
  await assert.rejects(() => altas.leerRespuestaAlta(new Response("<html>502</html>", { status: 502 })), {
    message: "No se pudo crear la tienda",
  });
});
test("respuesta de alta conserva errores de validación y el resultado exitoso", async () => {
  await assert.rejects(() => altas.leerRespuestaAlta(Response.json({ error: "Nombre duplicado" }, { status: 400 })), {
    message: "Nombre duplicado",
  });
  assert.deepEqual(await altas.leerRespuestaAlta(Response.json({ id: 7 })), { id: 7 });
});

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
