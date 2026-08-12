const { test } = require("node:test");
const assert = require("node:assert");
const { activar, desactivar, estaActivo, estado } = require("./mantenimiento");

test("arranca apagado", () => {
  desactivar();
  assert.strictEqual(estaActivo(), false);
  assert.strictEqual(estado().motivo, null);
});

test("activar prende el interruptor y guarda el motivo y la hora", () => {
  activar("Restaurando el respaldo del 2026-08-11 16:00");
  assert.strictEqual(estaActivo(), true);
  assert.match(estado().motivo, /Restaurando/);
  assert.ok(Date.parse(estado().desde) > 0);
  desactivar();
});

test("desactivar lo apaga y limpia el motivo", () => {
  activar("lo que sea");
  desactivar();
  assert.strictEqual(estaActivo(), false);
  assert.strictEqual(estado().motivo, null);
  assert.strictEqual(estado().desde, null);
});

test("activar dos veces seguidas no truena y conserva el primer 'desde'", () => {
  activar("uno");
  const primero = estado().desde;
  activar("dos");
  assert.strictEqual(estado().desde, primero, "no debe reiniciar el reloj");
  assert.match(estado().motivo, /dos/, "el motivo sí se actualiza");
  desactivar();
});
