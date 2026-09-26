import { before, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";

let ayuda;
before(() => {
  const archivo = new URL("./Ayuda.jsx", import.meta.url);
  assert.ok(existsSync(archivo), "Falta implementar Ayuda.jsx con las funciones de persistencia");
  const codigo = transformSync(readFileSync(archivo, "utf8"), { loader: "jsx", format: "cjs", jsx: "automatic" }).code;
  const modulo = { exports: {} };
  runInNewContext(codigo, { module: modulo, exports: modulo.exports, require: createRequire(import.meta.url) });
  ayuda = modulo.exports;
});

function almacenamiento(inicial = {}) {
  const valores = new Map(Object.entries(inicial));
  return {
    getItem: (clave) => valores.get(clave) ?? null,
    setItem: (clave, valor) => valores.set(clave, String(valor)),
    removeItem: (clave) => valores.delete(clave),
  };
}

test("leer muestra la franja sin marca y solo reconoce cerrada", () => {
  const storage = almacenamiento({ ayuda_objetivos_otro: "abierta", ayuda_objetivos_cierre: "cerrada" });
  assert.equal(ayuda.franjaCerrada(storage, "mi-venta"), false);
  assert.equal(ayuda.franjaCerrada(storage, "otro"), false);
  assert.equal(ayuda.franjaCerrada(storage, "cierre"), true);
});

test("cerrar persiste la marca exacta y permite leerla de nuevo", () => {
  const storage = almacenamiento();
  assert.equal(ayuda.cerrarFranja(storage, "mi-venta"), true);
  assert.equal(storage.getItem("ayuda_objetivos_mi-venta"), "cerrada");
  assert.equal(ayuda.franjaCerrada(storage, "mi-venta"), true);
  assert.equal(ayuda.franjaCerrada(storage, "mi-avance"), false);
});

test("abrir elimina solo la marca de esa pestaña", () => {
  const storage = almacenamiento({ ayuda_objetivos_cierre: "cerrada", ayuda_objetivos_otro: "cerrada", sesion: "vigente" });
  assert.equal(ayuda.abrirFranja(storage, "cierre"), false);
  assert.equal(storage.getItem("ayuda_objetivos_cierre"), null);
  assert.equal(ayuda.franjaCerrada(storage, "cierre"), false);
  assert.equal(storage.getItem("ayuda_objetivos_otro"), "cerrada");
  assert.equal(storage.getItem("sesion"), "vigente");
});

for (const [operacion, metodo] of [["franjaCerrada", "getItem"], ["cerrarFranja", "setItem"], ["abrirFranja", "removeItem"]]) {
  test(`${operacion} mantiene visible la franja si storage lanza`, () => {
    const storage = { [metodo]() { throw new Error("Almacenamiento bloqueado"); } };
    assert.equal(ayuda[operacion](storage, "mi-venta"), false);
  });
}

test("sin almacenamiento las tres operaciones mantienen visible la franja", () => {
  for (const storage of [undefined, null]) {
    assert.equal(ayuda.franjaCerrada(storage, "cierre"), false);
    assert.equal(ayuda.cerrarFranja(storage, "cierre"), false);
    assert.equal(ayuda.abrirFranja(storage, "cierre"), false);
  }
});
