const { test } = require("node:test");
const assert = require("node:assert");
const { reconciliarSucursalesCedis } = require("./sucursales");

function legacyCincoSucursales() {
  return [
    { id: 1, nombre: "Ocosingo", ciudad: "Chiapas", lat: 16.9, lng: -92.1 },
    { id: 2, nombre: "Yajalón", ciudad: "Chiapas", lat: null, lng: null },
    { id: 3, nombre: "San Cristóbal", ciudad: "Chiapas", lat: null, lng: null },
    { id: 4, nombre: "Palenque", ciudad: "Chiapas", lat: null, lng: null },
    { id: 5, nombre: "MercadoLibre", ciudad: "Online", lat: null, lng: null },
  ];
}

test("agrega CEDIS (id 6) con sin_ubicacion true cuando falta en un array legacy de 5", () => {
  const resultado = reconciliarSucursalesCedis(legacyCincoSucursales());
  const cedis = resultado.find((s) => s.id === 6);
  assert.ok(cedis, "debe agregar la sucursal 6");
  assert.strictEqual(cedis.nombre, "CEDIS");
  assert.strictEqual(cedis.sin_ubicacion, true);
});

test("la sucursal 5 (MercadoLibre) gana sin_ubicacion true aunque no lo tuviera antes", () => {
  const resultado = reconciliarSucursalesCedis(legacyCincoSucursales());
  const ml = resultado.find((s) => s.id === 5);
  assert.ok(ml);
  assert.strictEqual(ml.sin_ubicacion, true);
});

test("las sucursales 1-4 quedan exactamente iguales (incluyendo lat/lng ya configurados)", () => {
  const original = legacyCincoSucursales();
  const resultado = reconciliarSucursalesCedis(original);
  for (const id of [1, 2, 3, 4]) {
    const antes = original.find((s) => s.id === id);
    const despues = resultado.find((s) => s.id === id);
    assert.deepStrictEqual(despues, antes, `sucursal ${id} no debe cambiar`);
  }
});

test("es idempotente: llamarla dos veces da el mismo resultado que llamarla una vez", () => {
  const unaVez = reconciliarSucursalesCedis(legacyCincoSucursales());
  const dosVeces = reconciliarSucursalesCedis(reconciliarSucursalesCedis(legacyCincoSucursales()));
  assert.deepStrictEqual(dosVeces, unaVez);
  assert.strictEqual(dosVeces.filter((s) => s.id === 6).length, 1, "no debe duplicar CEDIS");
});

test("un seed fresco ya correcto (6 sucursales) se devuelve equivalente a sí mismo", () => {
  const fresco = [
    { id: 1, nombre: "Ocosingo", ciudad: "Chiapas", lat: null, lng: null },
    { id: 2, nombre: "Yajalón", ciudad: "Chiapas", lat: null, lng: null },
    { id: 3, nombre: "San Cristóbal", ciudad: "Chiapas", lat: null, lng: null },
    { id: 4, nombre: "Palenque", ciudad: "Chiapas", lat: null, lng: null },
    { id: 5, nombre: "MercadoLibre", ciudad: "Online", sin_ubicacion: true },
    { id: 6, nombre: "CEDIS", ciudad: "Chiapas", sin_ubicacion: true, lat: null, lng: null },
  ];
  const resultado = reconciliarSucursalesCedis(fresco);
  assert.deepStrictEqual(resultado, fresco);
});
