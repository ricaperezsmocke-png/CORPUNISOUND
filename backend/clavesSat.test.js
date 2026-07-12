const { test } = require("node:test");
const assert = require("node:assert");
const { buscarClavesSat, contarClavesSat, necesitaImportarClavesSat, UMBRAL_MINIMO_CLAVES_SAT } = require("./clavesSat");

test("buscarClavesSat encuentra resultados por texto en la descripción", () => {
  const { resultados, total } = buscarClavesSat("amplificador", 1);
  assert.ok(total > 0, "debe haber al menos una clave que mencione 'amplificador'");
  assert.ok(resultados.length > 0);
  assert.ok(resultados.every((r) => typeof r.clave === "string" && typeof r.descripcion === "string"));
});

test("buscarClavesSat con texto vacío devuelve resultados paginados", () => {
  const { resultados, total } = buscarClavesSat("", 1);
  assert.ok(total > 10000, "el catálogo completo debe tener decenas de miles de claves");
  assert.ok(resultados.length > 0 && resultados.length <= 20);
});

test("buscarClavesSat pagina correctamente (página 2 trae resultados distintos a la 1)", () => {
  const pagina1 = buscarClavesSat("", 1).resultados;
  const pagina2 = buscarClavesSat("", 2).resultados;
  assert.notDeepStrictEqual(pagina1, pagina2);
});

test("contarClavesSat devuelve el total de claves cuando la tabla existe", () => {
  assert.ok(contarClavesSat() > 10000, "el catálogo real ya importado debe tener decenas de miles de filas");
});

test("necesitaImportarClavesSat: true si el total es 0 (tabla ausente o vacía)", () => {
  assert.strictEqual(necesitaImportarClavesSat(0), true);
});

test("necesitaImportarClavesSat: true si el total está por debajo del umbral esperado", () => {
  assert.strictEqual(necesitaImportarClavesSat(UMBRAL_MINIMO_CLAVES_SAT - 1), true);
});

test("necesitaImportarClavesSat: false si el total ya alcanza el umbral esperado", () => {
  assert.strictEqual(necesitaImportarClavesSat(UMBRAL_MINIMO_CLAVES_SAT), false);
});
