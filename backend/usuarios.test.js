const test = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { actualizarUsuario, esAccionSobreSiMismo } = require("./usuarios");

function sembrarUsuarioDePrueba(DB, overrides = {}) {
  DB.admin.usuarios.push({
    id: 50, nombre: "Empleado Prueba", usuario: "empleado.prueba",
    password_hash: "$2b$10$hashViejoDePrueba", rol_id: 1, sucursal_id: 1, activo: true,
    ...overrides,
  });
}

test("actualizarUsuario: cambia la contraseña cuando se manda una nueva válida", async () => {
  const DB = construirDBPrueba();
  sembrarUsuarioDePrueba(DB);
  const hashAntes = DB.admin.usuarios.find((u) => u.id === 50).password_hash;

  await actualizarUsuario(DB, 50, { password: "nuevaClave123" });

  const hashDespues = DB.admin.usuarios.find((u) => u.id === 50).password_hash;
  assert.notStrictEqual(hashDespues, hashAntes, "el hash debe cambiar");
});

test("actualizarUsuario: NO cambia la contraseña cuando no se manda", async () => {
  const DB = construirDBPrueba();
  sembrarUsuarioDePrueba(DB);
  const hashAntes = DB.admin.usuarios.find((u) => u.id === 50).password_hash;

  await actualizarUsuario(DB, 50, { nombre: "Empleado Renombrado" });

  const usuario = DB.admin.usuarios.find((u) => u.id === 50);
  assert.strictEqual(usuario.password_hash, hashAntes, "el hash no debe tocarse");
  assert.strictEqual(usuario.nombre, "Empleado Renombrado", "el cambio de nombre sí debe aplicarse");
});

test("actualizarUsuario: NO cambia la contraseña cuando se manda vacía", async () => {
  const DB = construirDBPrueba();
  sembrarUsuarioDePrueba(DB);
  const hashAntes = DB.admin.usuarios.find((u) => u.id === 50).password_hash;

  await actualizarUsuario(DB, 50, { password: "" });

  assert.strictEqual(DB.admin.usuarios.find((u) => u.id === 50).password_hash, hashAntes);
});

test("actualizarUsuario: rechaza una contraseña nueva de menos de 6 caracteres", async () => {
  const DB = construirDBPrueba();
  sembrarUsuarioDePrueba(DB);

  await assert.rejects(
    () => actualizarUsuario(DB, 50, { password: "abc12" }),
    /al menos 6 caracteres/
  );
});

test("esAccionSobreSiMismo: true cuando el id objetivo es el mismo que el solicitante", () => {
  assert.strictEqual(esAccionSobreSiMismo(50, 50), true);
  assert.strictEqual(esAccionSobreSiMismo("50", 50), true, "debe comparar como número, no como string");
});

test("esAccionSobreSiMismo: false cuando son distintos", () => {
  assert.strictEqual(esAccionSobreSiMismo(50, 51), false);
});
