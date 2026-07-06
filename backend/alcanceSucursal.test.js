const { test } = require("node:test");
const assert = require("node:assert");
const { alcanceSucursal, filtrarPorSucursal } = require("./auth");

const GLOBAL = ["ver_todas_las_sucursales"];

test("usuario global sin query ve todas", () => {
  const req = { query: {}, usuarioToken: { sucursal_id: 1 } };
  assert.deepStrictEqual(alcanceSucursal(req, GLOBAL), { verTodas: true, sucursalId: null });
});

test("usuario global con sucursal_id filtra a esa sucursal", () => {
  const req = { query: { sucursal_id: "3" }, usuarioToken: { sucursal_id: 1 } };
  assert.deepStrictEqual(alcanceSucursal(req, GLOBAL), { verTodas: false, sucursalId: 3 });
});

test("usuario global con 'todas' ve todas", () => {
  const req = { query: { sucursal_id: "todas" }, usuarioToken: { sucursal_id: 1 } };
  assert.deepStrictEqual(alcanceSucursal(req, GLOBAL), { verTodas: true, sucursalId: null });
});

test("usuario amarrado ignora el query y usa su sucursal del token", () => {
  const req = { query: { sucursal_id: "3" }, usuarioToken: { sucursal_id: 2 } };
  assert.deepStrictEqual(alcanceSucursal(req, []), { verTodas: false, sucursalId: 2 });
});

test("filtrarPorSucursal deja pasar todo cuando verTodas", () => {
  const lista = [{ sucursal_id: 1 }, { sucursal_id: 2 }];
  assert.strictEqual(filtrarPorSucursal(lista, { verTodas: true, sucursalId: null }).length, 2);
});

test("filtrarPorSucursal filtra por la sucursal indicada", () => {
  const lista = [{ sucursal_id: 1 }, { sucursal_id: 2 }, { sucursal_id: 2 }];
  const r = filtrarPorSucursal(lista, { verTodas: false, sucursalId: 2 });
  assert.strictEqual(r.length, 2);
  assert.ok(r.every((x) => x.sucursal_id === 2));
});
