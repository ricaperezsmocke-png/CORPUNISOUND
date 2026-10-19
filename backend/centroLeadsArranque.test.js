const { test } = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { iniciarCentroLeadsSeguro } = require("./centroLeads/arranque");

test("una migración de Centro de Leads que falla no tumba el arranque: queda apagado y avisa", () => {
  const sqlite = new Database(":memory:");
  const avisos = [];
  const estado = iniciarCentroLeadsSeguro(sqlite, {
    inicializar: () => { throw new Error("tabla rota"); },
    avisar: (...m) => avisos.push(m.join(" ")),
  });
  assert.deepEqual(estado, { disponible: false, version: null, error: "tabla rota" });
  assert.match(avisos[0], /Centro de Leads apagado/);
  // La conexión sigue sirviendo al resto del sistema.
  sqlite.exec("CREATE TABLE estado (id INTEGER PRIMARY KEY)");
  sqlite.close();
});

test("con la migración real queda disponible con su versión", () => {
  const sqlite = new Database(":memory:");
  const estado = iniciarCentroLeadsSeguro(sqlite, { avisar: () => assert.fail("no debe avisar") });
  assert.equal(estado.disponible, true);
  assert.equal(estado.version, 4);
  assert.equal(estado.error, null);
  sqlite.close();
});
