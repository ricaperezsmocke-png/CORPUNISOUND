const { test } = require("node:test");
const assert = require("node:assert");
const { listarPermisos } = require("./permisosCatalogo");
const { permisosDeRol } = require("./roles");
const { construirDBPrueba } = require("./testHelpers");
const { filtrarCorteEnCursoPorPermiso } = require("./cortes");

test("existe el permiso ver_montos_corte en modulo corte", () => {
  const p = listarPermisos().find((x) => x.clave === "ver_montos_corte");
  assert.ok(p, "el permiso debe existir en el catálogo");
  assert.strictEqual(p.modulo, "corte");
  assert.strictEqual(p.implementado, true);
});

test("Administrador y Gerente tienen el permiso; Cajero no", () => {
  const DB = construirDBPrueba();
  const admin = DB.admin.roles.find((r) => r.nombre === "Administrador");
  const gerente = DB.admin.roles.find((r) => r.nombre === "Gerente de sucursal");
  const cajero = DB.admin.roles.find((r) => r.nombre === "Cajero");
  assert.ok(permisosDeRol(DB, admin.id).includes("ver_montos_corte"), "Administrador debe tener el permiso");
  assert.ok(permisosDeRol(DB, gerente.id).includes("ver_montos_corte"), "Gerente debe tener el permiso");
  assert.ok(!permisosDeRol(DB, cajero.id).includes("ver_montos_corte"), "Cajero NO debe tener el permiso");
});

test("filtrarCorteEnCursoPorPermiso pone los montos y conteos en 0 sin el permiso", () => {
  const resultado = {
    desde: "2026-07-01T10:00:00.000Z",
    ventas_incluidas: 3,
    calculado: { EFECTIVO: 100, CHEQUE: 10, VALES: 5, TARJETA: 20 },
    total_calculado: 135,
    transferencias: 50,
    credito: 25,
  };
  const r = filtrarCorteEnCursoPorPermiso(resultado, ["realizar_corte_caja"]);
  assert.deepStrictEqual(r, {
    desde: "2026-07-01T10:00:00.000Z",
    ventas_incluidas: 0,
    abonos_incluidos: 0,
    calculado: { EFECTIVO: 0, CHEQUE: 0, VALES: 0, TARJETA: 0 },
    total_calculado: 0,
    transferencias: 0,
    credito: 0,
  });
});

test("filtrarCorteEnCursoPorPermiso muestra todo con el permiso", () => {
  const resultado = {
    desde: "2026-07-01T10:00:00.000Z",
    ventas_incluidas: 3,
    calculado: { EFECTIVO: 100, CHEQUE: 10, VALES: 5, TARJETA: 20 },
    total_calculado: 135,
    transferencias: 50,
    credito: 25,
  };
  const r = filtrarCorteEnCursoPorPermiso(resultado, ["ver_montos_corte"]);
  assert.deepStrictEqual(r, resultado);
});
