const { test } = require("node:test");
const assert = require("node:assert");
const { buscarClavesSat } = require("./clavesSat");

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
