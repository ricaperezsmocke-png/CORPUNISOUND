const { test } = require("node:test");
const assert = require("node:assert/strict");
const { restaurarEstado } = require("./restaurarEstado");

function semilla() {
  return { pos: { ventas: [{ id: 1 }], configuracion: { iva: 16 } }, drive: { cuenta: null } };
}

test("una clave guardada que la semilla no conoce sobrevive dentro de su módulo", () => {
  const r = restaurarEstado(semilla(), { pos: { historial_ventas_mensual: [{ mes: "2026-01" }] }, drive: { carpeta_raiz_id: "abc" } });
  assert.deepEqual(r.pos.historial_ventas_mensual, [{ mes: "2026-01" }]);
  assert.equal(r.drive.carpeta_raiz_id, "abc");
});

test("un módulo guardado que la semilla no conoce se restaura completo", () => {
  const r = restaurarEstado(semilla(), { modulo_nuevo: { registros: [1, 2] } });
  assert.deepEqual(r.modulo_nuevo, { registros: [1, 2] });
});

test("una clave de la semilla que no viene en lo guardado conserva el valor de la semilla", () => {
  const r = restaurarEstado(semilla(), { pos: { ventas: [] } });
  assert.deepEqual(r.pos.configuracion, { iva: 16 });
  assert.deepEqual(r.drive, { cuenta: null });
});

test("lo guardado gana sobre la semilla", () => {
  const r = restaurarEstado(semilla(), { pos: { ventas: [{ id: 9 }] }, drive: { cuenta: { email: "x" } } });
  assert.deepEqual(r.pos.ventas, [{ id: 9 }]);
  assert.deepEqual(r.drive.cuenta, { email: "x" });
});

test("sin estado guardado, o con módulos que no son objeto, queda la semilla intacta", () => {
  for (const guardado of [null, undefined, {}, { pos: null, drive: [] }, { raro: "texto", otro: [1] }]) {
    const r = restaurarEstado(semilla(), guardado);
    assert.deepEqual(r, semilla());
  }
});

test("una clave guardada como undefined deja el valor de la semilla, igual que antes", () => {
  const r = restaurarEstado(semilla(), { pos: { ventas: undefined } });
  assert.deepEqual(r.pos.ventas, [{ id: 1 }]);
});

test("un módulo o clave llamado __proto__, constructor o prototype no contamina los objetos del proceso", () => {
  const guardado = JSON.parse('{"__proto__":{"contaminado":1},"constructor":{"x":1},"prototype":{"y":1},'
    + '"pos":{"__proto__":{"contaminado":2}}}');
  const r = restaurarEstado(semilla(), guardado);
  assert.equal({}.contaminado, undefined);
  assert.equal(r.pos.contaminado, undefined);
  assert.equal(Object.hasOwn(r, "constructor"), false);
  assert.equal(Object.hasOwn(r, "prototype"), false);
});

test("la semilla no se modifica: un segundo uso parte de la misma semilla", () => {
  const s = semilla();
  restaurarEstado(s, { pos: { extra: 1, ventas: [] }, nuevo: { a: 1 } });
  assert.deepEqual(s, semilla());
  const r = restaurarEstado(s, {});
  assert.equal(r.pos.extra, undefined);
  assert.equal(r.nuevo, undefined);
});
