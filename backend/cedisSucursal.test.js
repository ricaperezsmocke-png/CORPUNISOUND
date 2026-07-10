const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");

// Replica la misma condición que usa la ruta PUT /api/sucursales/:id/ubicacion
// en server.js: una sucursal con sin_ubicacion=true rechaza que se le configuren
// coordenadas.
function puedeConfigurarUbicacion(sucursal) {
  return !sucursal.sin_ubicacion;
}

test("CEDIS (sucursal 6) existe en la fixture, sin ciudad Online, con sin_ubicacion true", () => {
  const DB = construirDBPrueba();
  const cedis = DB.pos.sucursales.find((s) => s.id === 6);
  assert.ok(cedis, "debe existir la sucursal 6");
  assert.strictEqual(cedis.nombre, "CEDIS");
  assert.notStrictEqual(cedis.ciudad, "Online", "CEDIS es un lugar físico, no debe fingir ser Online");
  assert.strictEqual(cedis.sin_ubicacion, true);
});

test("MercadoLibre (sucursal 5) también tiene sin_ubicacion true", () => {
  const DB = construirDBPrueba();
  const ml = DB.pos.sucursales.find((s) => s.id === 5);
  assert.ok(ml, "debe existir la sucursal 5");
  assert.strictEqual(ml.sin_ubicacion, true);
});

test("las 4 sucursales físicas SÍ pueden configurar ubicación", () => {
  const DB = construirDBPrueba();
  for (const id of [1, 2, 3, 4]) {
    const s = DB.pos.sucursales.find((x) => x.id === id);
    assert.ok(puedeConfigurarUbicacion(s), `sucursal ${id} debería poder configurar ubicación`);
  }
});

test("CEDIS y MercadoLibre NO pueden configurar ubicación", () => {
  const DB = construirDBPrueba();
  for (const id of [5, 6]) {
    const s = DB.pos.sucursales.find((x) => x.id === id);
    assert.ok(!puedeConfigurarUbicacion(s), `sucursal ${id} no debería poder configurar ubicación`);
  }
});
