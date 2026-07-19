const { test } = require("node:test");
const assert = require("node:assert");
const { listarPermisos } = require("./permisosCatalogo");
const { validarSistemaDePermisos } = require("./validarPermisos");

test("existe el permiso conectar_cuenta_drive en modulo admin", () => {
  const p = listarPermisos().find((x) => x.clave === "conectar_cuenta_drive");
  assert.ok(p, "el permiso debe existir en el catálogo");
  assert.strictEqual(p.modulo, "admin");
  assert.strictEqual(p.implementado, true);
});

test("existe el permiso gestionar_expedientes en modulo admin", () => {
  const p = listarPermisos().find((x) => x.clave === "gestionar_expedientes");
  assert.ok(p, "el permiso debe existir en el catálogo");
  assert.strictEqual(p.modulo, "admin");
  assert.strictEqual(p.implementado, true);
});

test("el guardia de arranque sigue pasando con los permisos nuevos", () => {
  assert.doesNotThrow(() => validarSistemaDePermisos());
});
