const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { crearProducto, actualizarProducto, crearProveedor } = require("./productos");

test("crearProducto guarda clave_sat y localizacion", () => {
  const DB = construirDBPrueba();
  const p = crearProducto(DB, { descripcion: "Amplificador", clave_sat: "52161547", localizacion: "Pasillo 3" }, 1);
  assert.strictEqual(p.clave_sat, "52161547");
  assert.strictEqual(p.localizacion, "Pasillo 3");
});

test("crearProducto usa cadena vacía si no se manda clave_sat/localizacion", () => {
  const DB = construirDBPrueba();
  const p = crearProducto(DB, { descripcion: "Amplificador" }, 1);
  assert.strictEqual(p.clave_sat, "");
  assert.strictEqual(p.localizacion, "");
});

test("actualizarProducto actualiza clave_sat y localizacion", () => {
  const DB = construirDBPrueba();
  const p = crearProducto(DB, { descripcion: "Amplificador" }, 1);
  const actualizado = actualizarProducto(DB, p.id, { clave_sat: "52161547", localizacion: "Pasillo 3, Anaquel B" }, 1);
  assert.strictEqual(actualizado.clave_sat, "52161547");
  assert.strictEqual(actualizado.localizacion, "Pasillo 3, Anaquel B");
});

test("actualizarProducto conserva clave_sat/localizacion si no se mandan", () => {
  const DB = construirDBPrueba();
  const p = crearProducto(DB, { descripcion: "Amplificador", clave_sat: "52161547", localizacion: "Pasillo 3" }, 1);
  const actualizado = actualizarProducto(DB, p.id, { descripcion: "Amplificador 2" }, 1);
  assert.strictEqual(actualizado.clave_sat, "52161547");
  assert.strictEqual(actualizado.localizacion, "Pasillo 3");
});

test("crearProveedor guarda rfc", () => {
  const DB = construirDBPrueba();
  const prov = crearProveedor(DB, "Distribuidora Norte", "DINX800101ABC");
  assert.strictEqual(prov.rfc, "DINX800101ABC");
});

test("crearProveedor usa cadena vacía si no se manda rfc", () => {
  const DB = construirDBPrueba();
  const prov = crearProveedor(DB, "Distribuidora Norte");
  assert.strictEqual(prov.rfc, "");
});
