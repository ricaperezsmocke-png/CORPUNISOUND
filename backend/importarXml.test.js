const { test } = require("node:test");
const assert = require("node:assert");
const { parsearFacturaXML } = require("./cfdi");

// La ruta HTTP en sí solo envuelve parsearFacturaXML sin lógica adicional;
// se prueba aquí que un error de parseo se puede distinguir para responder 400.
test("un XML inválido lanza un error con mensaje claro (para responder 400 en la ruta)", () => {
  assert.throws(() => parsearFacturaXML("no es xml"), /no se pudo leer como XML/);
});
