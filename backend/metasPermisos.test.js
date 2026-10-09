const { test } = require("node:test");
const assert = require("node:assert/strict");
const { PERMISOS } = require("./permisosCatalogo");
const { sembrarRolesIniciales } = require("./roles");

test("los dos permisos nuevos existen en el módulo pos", () => {
  for (const clave of ["administrar_metas_personalizadas", "anular_capturas_metas"]) {
    const permiso = PERMISOS.find((p) => p.clave === clave);
    assert.ok(permiso, clave);
    assert.equal(permiso.modulo, "pos");
    assert.equal(permiso.implementado, true);
  }
});

test("administrar metas es solo del Administrador; anular capturas también del Gerente; el Cajero ninguno", () => {
  const DB = { admin: { roles: [] } };
  sembrarRolesIniciales(DB);
  const rol = (nombre) => DB.admin.roles.find((r) => r.nombre === nombre).permisos;
  assert.ok(rol("Administrador").includes("administrar_metas_personalizadas"));
  assert.ok(!rol("Gerente de sucursal").includes("administrar_metas_personalizadas"));
  assert.ok(rol("Gerente de sucursal").includes("anular_capturas_metas"));
  assert.ok(!rol("Cajero").includes("administrar_metas_personalizadas"));
  assert.ok(!rol("Cajero").includes("anular_capturas_metas"));
});
