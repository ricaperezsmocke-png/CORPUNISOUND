const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { listarDepartamentos, crearDepartamento, crearProveedor } = require("./productos");

test("listarDepartamentos arranca vacío y crearDepartamento agrega uno nuevo", () => {
  const DB = construirDBPrueba();
  assert.strictEqual(listarDepartamentos(DB).length, 0);
  const nuevo = crearDepartamento(DB, "Cuerdas y Accesorios");
  assert.strictEqual(nuevo.nombre, "Cuerdas y Accesorios");
  assert.ok(nuevo.id);
  assert.strictEqual(listarDepartamentos(DB).length, 1);
});

test("crearDepartamento rechaza nombre vacío", () => {
  const DB = construirDBPrueba();
  assert.throws(() => crearDepartamento(DB, ""), /nombre del departamento/);
  assert.throws(() => crearDepartamento(DB, "   "), /nombre del departamento/);
});

test("crearProveedor crea con nombre y campos secundarios por defecto", () => {
  const DB = construirDBPrueba();
  const nuevo = crearProveedor(DB, "Distribuidora Nueva");
  assert.strictEqual(nuevo.nombre, "Distribuidora Nueva");
  assert.strictEqual(nuevo.contacto, "");
  assert.strictEqual(nuevo.tiempo_entrega_dias, 0);
  assert.strictEqual(nuevo.condiciones_pago, "");
  assert.ok(DB["catalogo-productos"].proveedores.some((p) => p.id === nuevo.id));
});

test("crearProveedor rechaza nombre vacío", () => {
  const DB = construirDBPrueba();
  assert.throws(() => crearProveedor(DB, ""), /nombre del proveedor/);
});
