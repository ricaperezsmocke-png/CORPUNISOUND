const { test } = require("node:test");
const assert = require("node:assert");
const { listarPermisos } = require("./permisosCatalogo");
const { validarSistemaDePermisos } = require("./validarPermisos");

test("existe el permiso realizar_traspasos en modulo inventario", () => {
  const p = listarPermisos().find((x) => x.clave === "realizar_traspasos");
  assert.ok(p, "el permiso debe existir en el catálogo");
  assert.strictEqual(p.modulo, "inventario");
  assert.strictEqual(p.implementado, true);
});

test("el guardia de arranque sigue pasando con el permiso nuevo", () => {
  assert.doesNotThrow(() => validarSistemaDePermisos());
});
