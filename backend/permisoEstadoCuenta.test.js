const { test } = require("node:test");
const assert = require("node:assert");
const { listarPermisos, listarModulosSistema } = require("./permisosCatalogo");
const { validarSistemaDePermisos } = require("./validarPermisos");

test("el módulo cuenta_comun existe con sus 3 permisos", () => {
  const modulos = listarModulosSistema();
  assert.ok(modulos.some((m) => m.id === "cuenta_comun"), "cuenta_comun en MODULOS_SISTEMA");
  const claves = listarPermisos().filter((p) => p.modulo === "cuenta_comun").map((p) => p.clave);
  for (const c of ["ver_estado_cuenta", "registrar_depositos", "cancelar_depositos"]) {
    assert.ok(claves.includes(c), `falta el permiso ${c}`);
  }
});

test("el guardia de arranque pasa con el módulo nuevo registrado", () => {
  assert.doesNotThrow(() => validarSistemaDePermisos());
});
