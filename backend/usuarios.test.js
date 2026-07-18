const test = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { actualizarUsuario, esAccionSobreSiMismo } = require("./usuarios");
const { crearCorte } = require("./cortes");

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

test("eliminarUsuario: remueve al usuario correctamente", () => {
  const DB = construirDBPrueba();
  sembrarUsuarioDePrueba(DB);

  const { eliminarUsuario } = require("./usuarios");
  const resultado = eliminarUsuario(DB, 50);

  assert.deepStrictEqual(resultado, { ok: true });
  assert.strictEqual(DB.admin.usuarios.find((u) => u.id === 50), undefined, "el usuario ya no debe existir en la lista");
});

test("eliminarUsuario: lanza error si el id no existe", () => {
  const DB = construirDBPrueba();
  const { eliminarUsuario } = require("./usuarios");

  assert.throws(() => eliminarUsuario(DB, 999), /Usuario no encontrado/);
});

test("eliminarUsuario: no afecta el usuario_nombre ya guardado en un corte de caja existente", () => {
  const DB = construirDBPrueba();
  sembrarUsuarioDePrueba(DB, { nombre: "Cajero Que Se Va" });

  const corte = crearCorte(DB, {
    sucursal_id: 1,
    usuario_id: 50,
    usuario_nombre: "Cajero Que Se Va",
    contado: { efectivo: 100 },
    retiro: {},
  });

  const { eliminarUsuario } = require("./usuarios");
  eliminarUsuario(DB, 50);

  const corteGuardado = DB.pos.cortes_caja.find((c) => c.id === corte.id);
  assert.strictEqual(corteGuardado.usuario_nombre, "Cajero Que Se Va", "el nombre congelado en el corte no debe cambiar ni desaparecer al borrar el usuario");
});
