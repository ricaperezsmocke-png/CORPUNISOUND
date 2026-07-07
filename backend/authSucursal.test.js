const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { armarSesion } = require("./sesion");

test("armarSesion incluye sucursal y ver_todas para admin", () => {
  const DB = construirDBPrueba();
  const admin = DB.admin.roles.find((r) => r.nombre === "Administrador");
  const usuario = { id: 1, nombre: "Admin", rol_id: admin.id, sucursal_id: 1 };
  const s = armarSesion(DB, usuario);
  assert.strictEqual(s.sucursal_id, 1);
  assert.strictEqual(s.sucursal_nombre, "Ocosingo");
  assert.strictEqual(s.ver_todas, true);
});

test("armarSesion marca ver_todas=false para cajero", () => {
  const DB = construirDBPrueba();
  const cajero = DB.admin.roles.find((r) => r.nombre === "Cajero");
  const usuario = { id: 2, nombre: "Cajera", rol_id: cajero.id, sucursal_id: 2 };
  const s = armarSesion(DB, usuario);
  assert.strictEqual(s.sucursal_id, 2);
  assert.strictEqual(s.sucursal_nombre, "Yajalón");
  assert.strictEqual(s.ver_todas, false);
});
