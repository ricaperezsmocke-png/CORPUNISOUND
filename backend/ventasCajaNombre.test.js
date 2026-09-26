const { test } = require("node:test");
const assert = require("node:assert/strict");
const { listarVentas } = require("./ventas");
const { construirDBPrueba } = require("./testHelpers");

function prepararDB() {
  const DB = construirDBPrueba();
  DB.pos.cajas = [
    { id: 1, sucursal_id: 1, nombre: "Administrativa", predeterminada: true },
    { id: 2, sucursal_id: 1, nombre: "Fiscal", predeterminada: false },
    { id: 3, sucursal_id: 2, nombre: "Administrativa segunda", predeterminada: true },
    { id: 4, sucursal_id: 2, nombre: "Fiscal segunda", predeterminada: false },
  ];
  DB.pos.ventas = [
    { id: 1, sucursal_id: 1, caja_id: null },
    { id: 2, sucursal_id: 1, caja_id: "2" },
    { id: 3, sucursal_id: 2, caja_id: null },
    { id: 4, sucursal_id: 2, caja_id: 4 },
    { id: 5, sucursal_id: 1, caja_id: 1 },
  ].map((v) => ({ ...v, fecha: "2026-09-01", estatus: "cerrada", total: 100 }));
  return DB;
}

test("la lista nombra ambas cajas y asigna las históricas a la predeterminada de su sucursal", () => {
  const DB = prepararDB();
  const antes = structuredClone(DB);
  assert.deepEqual(listarVentas(DB).map((v) => [v.id, v.caja_nombre]), [
    [5, "Administrativa"], [4, "Fiscal segunda"], [3, "Administrativa segunda"],
    [2, "Fiscal"], [1, "Administrativa"],
  ]);
  assert.deepEqual(DB, antes);
});

test("el dato de lectura conserva los filtros de sucursal y caja", () => {
  const DB = prepararDB();
  assert.deepEqual(listarVentas(DB, { sucursal_id: "1", caja_id: "1" }).map((v) => v.id), [5, 1]);
  assert.deepEqual(listarVentas(DB, { sucursal_id: "2", caja_id: "4" }).map((v) => v.id), [4]);
});

test("sin catálogo no inventa un nombre ni oculta ventas", () => {
  const DB = prepararDB();
  DB.pos.cajas = [];
  const ventas = listarVentas(DB);
  assert.equal(ventas.length, 5);
  assert.ok(ventas.every((v) => v.caja_nombre === null));
});
