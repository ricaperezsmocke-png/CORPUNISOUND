const { test } = require("node:test");
const assert = require("node:assert");
const { listarPermisos, listarModulosSistema } = require("./permisosCatalogo");
const { validarSistemaDePermisos } = require("./validarPermisos");

test("existe el permiso ver_reportes en modulo reportes", () => {
  const p = listarPermisos().find((x) => x.clave === "ver_reportes");
  assert.ok(p, "el permiso debe existir en el catálogo");
  assert.strictEqual(p.modulo, "reportes");
  assert.strictEqual(p.implementado, true);
});

test("el modulo reportes esta registrado en MODULOS_SISTEMA", () => {
  const m = listarModulosSistema().find((x) => x.id === "reportes");
  assert.ok(m, "el módulo reportes debe existir en MODULOS_SISTEMA");
});

test("el guardia de arranque sigue pasando con el modulo y permiso nuevos", () => {
  assert.doesNotThrow(() => validarSistemaDePermisos());
});
