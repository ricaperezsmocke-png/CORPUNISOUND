/**
 * altaUsuarioConcurrente.test.js — Dos altas simultáneas no crean dos cuentas.
 *
 * El defecto: `crearUsuario` comprobaba "ese usuario ya existe", y DESPUÉS
 * calculaba el hash de la contraseña. bcrypt tarda ~100 ms a propósito, y ese
 * `await` cedía el hilo justo entre la comprobación y el guardado. Dos altas a
 * la vez —un doble clic en "Guardar" basta— pasaban las DOS el chequeo,
 * calculaban el MISMO `siguienteId`, y quedaban dos cuentas con el mismo id y
 * el mismo nombre de usuario.
 *
 * Y la segunda era un fantasma:
 *  - el login busca por nombre normalizado y se queda SIEMPRE con la primera,
 *    así que la segunda nunca podía entrar;
 *  - el token lleva el `id`, y todo lo que resuelve por id —editar, desactivar,
 *    eliminar— tocaba solo la primera. Indesactivable e inborrable desde la
 *    interfaz.
 *
 * Lo encontró una auditoría externa apuntando a la ruta de configuración
 * inicial; el mismo defecto estaba en la ruta que se usa a diario.
 */

const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const { crearUsuario } = require("./usuarios");
const { sembrarRolesIniciales } = require("./roles");

function nuevoDB() {
  const DB = {
    admin: { roles: [], usuarios: [] },
    pos: { vendedores: [], sucursales: [{ id: 1, nombre: "Ocosingo" }] },
  };
  sembrarRolesIniciales(DB);
  return DB;
}

const alta = (usuario, password) => ({
  nombre: "Ana López", usuario, password, rol_id: 3, sucursal_id: 1,
});

test("dos altas SIMULTÁNEAS del mismo usuario dejan una sola cuenta", async () => {
  const DB = nuevoDB();
  // Simultáneas de verdad: se lanzan las dos y se espera después. Lanzarlas en
  // secuencia con `await` una tras otra NO reproduce el defecto.
  const resultados = await Promise.allSettled([
    crearUsuario(DB, alta("ana", "clave-uno-1")),
    crearUsuario(DB, alta("ana", "clave-dos-2")),
  ]);

  assert.strictEqual(DB.admin.usuarios.length, 1, "solo debe quedar UNA cuenta");
  const exitosas = resultados.filter((r) => r.status === "fulfilled");
  assert.strictEqual(exitosas.length, 1, "solo una debe haber tenido éxito");
  const fallida = resultados.find((r) => r.status === "rejected");
  assert.match(fallida.reason.message, /ya existe/i, "la otra debe decir por qué");
});

test("dos altas simultáneas de usuarios DISTINTOS no comparten id", async () => {
  // El otro síntoma de la misma carrera: `siguienteId` se calculaba dos veces
  // sobre el mismo arreglo y devolvía el mismo número.
  const DB = nuevoDB();
  await Promise.all([
    crearUsuario(DB, alta("ana", "clave-uno-1")),
    crearUsuario(DB, alta("beto", "clave-dos-2")),
  ]);

  assert.strictEqual(DB.admin.usuarios.length, 2);
  const ids = DB.admin.usuarios.map((u) => u.id);
  assert.strictEqual(new Set(ids).size, 2, `ids repetidos: ${ids.join(", ")}`);
});

test("cinco altas simultáneas del mismo usuario siguen dejando una", async () => {
  const DB = nuevoDB();
  const resultados = await Promise.allSettled(
    Array.from({ length: 5 }, (_, i) => crearUsuario(DB, alta("ana", `clave-${i}-xx`)))
  );
  assert.strictEqual(DB.admin.usuarios.length, 1);
  assert.strictEqual(resultados.filter((r) => r.status === "fulfilled").length, 1);
});

test("la cuenta que queda es utilizable: su contraseña es la que se guardó", async () => {
  // Que quede UNA no basta si es la fantasma. Se comprueba que el hash guardado
  // corresponda a la contraseña del alta que tuvo éxito.
  const { verificarPassword } = require("./auth");
  const DB = nuevoDB();
  const resultados = await Promise.allSettled([
    crearUsuario(DB, alta("ana", "clave-uno-1")),
    crearUsuario(DB, alta("ana", "clave-dos-2")),
  ]);
  const cual = resultados.findIndex((r) => r.status === "fulfilled");
  const esperada = cual === 0 ? "clave-uno-1" : "clave-dos-2";

  const guardada = DB.admin.usuarios[0].password_hash;
  assert.ok(await verificarPassword(esperada, guardada), "debe poder entrar con su contraseña");
});

test("las altas en secuencia siguen funcionando como siempre", async () => {
  // Un candado que rompe el caso normal no sirve de nada.
  const DB = nuevoDB();
  const uno = await crearUsuario(DB, alta("ana", "clave-uno-1"));
  const dos = await crearUsuario(DB, alta("beto", "clave-dos-2"));
  assert.strictEqual(DB.admin.usuarios.length, 2);
  assert.notStrictEqual(uno.id, dos.id);
  assert.strictEqual(uno.password_hash, undefined, "el hash nunca sale de la función");
});

test("las validaciones se siguen aplicando antes de gastar el hash", async () => {
  const DB = nuevoDB();
  await assert.rejects(() => crearUsuario(DB, { ...alta("x", "corta"), password: "123" }), /6 caracteres/i);
  await assert.rejects(() => crearUsuario(DB, { ...alta("", "clave-larga") }), /usuario/i);
  await assert.rejects(() => crearUsuario(DB, { ...alta("y", "clave-larga"), rol_id: null }), /rol/i);
  assert.strictEqual(DB.admin.usuarios.length, 0, "ninguna debió crearse");
});
