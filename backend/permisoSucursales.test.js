const { test } = require("node:test");
const assert = require("node:assert");
const { listarPermisos } = require("./permisosCatalogo");
const { construirDBPrueba } = require("./testHelpers");
const { permisosDeRol } = require("./roles");

test("existe el permiso ver_todas_las_sucursales en modulo admin", () => {
  const p = listarPermisos().find((x) => x.clave === "ver_todas_las_sucursales");
  assert.ok(p, "el permiso debe existir en el catálogo");
  assert.strictEqual(p.modulo, "admin");
  assert.strictEqual(p.implementado, true);
});

test("Administrador tiene el permiso; Cajero y Gerente no", () => {
  const DB = construirDBPrueba();
  const admin = DB.admin.roles.find((r) => r.nombre === "Administrador");
  const gerente = DB.admin.roles.find((r) => r.nombre === "Gerente de sucursal");
  const cajero = DB.admin.roles.find((r) => r.nombre === "Cajero");
  assert.ok(permisosDeRol(DB, admin.id).includes("ver_todas_las_sucursales"));
  assert.ok(!permisosDeRol(DB, gerente.id).includes("ver_todas_las_sucursales"));
  assert.ok(!permisosDeRol(DB, cajero.id).includes("ver_todas_las_sucursales"));
});
