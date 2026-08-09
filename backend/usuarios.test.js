const test = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { actualizarUsuario, esAccionSobreSiMismo, crearUsuario, iniciarSesion, normalizarUsuario, usuariosQueChocanAlNormalizar } = require("./usuarios");
const { hashearPassword } = require("./auth");
const { crearRegistroIntentos, registrarFallo, estaBloqueado, MAX_INTENTOS } = require("./intentosLogin");
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

test("actualizarUsuario: cambia la sucursal cuando se manda sucursal_id", async () => {
  const DB = construirDBPrueba();
  sembrarUsuarioDePrueba(DB, { sucursal_id: 1 });

  await actualizarUsuario(DB, 50, { sucursal_id: 3 });

  assert.strictEqual(DB.admin.usuarios.find((u) => u.id === 50).sucursal_id, 3);
});

test("actualizarUsuario: NO cambia la sucursal cuando no se manda", async () => {
  const DB = construirDBPrueba();
  sembrarUsuarioDePrueba(DB, { sucursal_id: 2 });

  await actualizarUsuario(DB, 50, { nombre: "Empleado Renombrado" });

  assert.strictEqual(DB.admin.usuarios.find((u) => u.id === 50).sucursal_id, 2, "la sucursal no debe tocarse si no viene en el body");
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

test("guard de autodesactivación: activo=0 (no estrictamente false) también debe bloquear la autodesactivación", () => {
  // Replica la condición exacta de la ruta PUT /api/usuarios/:id en server.js:
  // req.body.activo !== undefined && !req.body.activo && esAccionSobreSiMismo(...)
  const propioId = 50;
  const bodies = [{ activo: 0 }, { activo: null }, { activo: "" }, { activo: false }];
  for (const body of bodies) {
    const debeBloquear = body.activo !== undefined && !body.activo && esAccionSobreSiMismo(propioId, propioId);
    assert.strictEqual(debeBloquear, true, `activo=${JSON.stringify(body.activo)} debe bloquear la autodesactivación`);
  }
  // Un edit que no toca `activo` en absoluto NO debe bloquearse por este guard:
  const bodySinActivo = { nombre: "Nuevo nombre" };
  const debeBloquearSinActivo = bodySinActivo.activo !== undefined && !bodySinActivo.activo && esAccionSobreSiMismo(propioId, propioId);
  assert.strictEqual(debeBloquearSinActivo, false, "un edit que no toca activo no debe bloquearse por este guard");
});

// ---------- El nombre de usuario no distingue mayúsculas ni espacios ----------
// Victor escribió "Victor" en vez de "victor", falló 5 veces y el freno de
// fuerza bruta lo dejó 15 minutos fuera. El celular de las cajeras
// autocapitaliza la primera letra, así que es un tropiezo garantizado.

/** Siembra una cuenta con contraseña real (hasheada) para probar el login. */
async function sembrarCuentaConPassword(DB, usuario, password, overrides = {}) {
  DB.admin.usuarios.push({
    id: 60, nombre: "Cajera Prueba", usuario,
    password_hash: await hashearPassword(password),
    rol_id: 1, sucursal_id: 1, activo: true,
    ...overrides,
  });
}

test("normalizarUsuario: quita espacios de los extremos y baja a minúsculas", () => {
  assert.strictEqual(normalizarUsuario("  Victor "), "victor");
  assert.strictEqual(normalizarUsuario("MARIA"), "maria");
  assert.strictEqual(normalizarUsuario("victor"), "victor");
  // Datos ausentes o basura no deben reventar la comparación.
  assert.strictEqual(normalizarUsuario(undefined), "");
  assert.strictEqual(normalizarUsuario(null), "");
  assert.strictEqual(normalizarUsuario(123), "");
});

test("iniciarSesion: una cuenta YA guardada como 'Maria' entra escribiendo maria, MARIA o con espacios", async () => {
  // Los usuarios en producción conservan las mayúsculas con que se capturaron;
  // esto debe funcionar sin migrar la base.
  const DB = construirDBPrueba();
  await sembrarCuentaConPassword(DB, "Maria", "clave.Secreta1");

  for (const tecleado of ["maria", "MARIA", "Maria", "  maria  ", " MaRiA"]) {
    const encontrado = await iniciarSesion(DB, tecleado, "clave.Secreta1");
    assert.strictEqual(encontrado.id, 60, `debe entrar tecleando "${tecleado}"`);
    assert.strictEqual(encontrado.usuario, "Maria", "el nombre guardado no se toca, solo se compara normalizado");
  }
});

test("iniciarSesion: la CONTRASEÑA sigue distinguiendo mayúsculas", async () => {
  const DB = construirDBPrueba();
  await sembrarCuentaConPassword(DB, "Maria", "clave.Secreta1");

  await assert.rejects(
    () => iniciarSesion(DB, "maria", "CLAVE.SECRETA1"),
    /Usuario o contraseña incorrectos/,
    "aflojar el usuario no debe aflojar la contraseña"
  );
  await assert.rejects(
    () => iniciarSesion(DB, "maria", " clave.Secreta1 "),
    /Usuario o contraseña incorrectos/,
    "los espacios de la contraseña tampoco se recortan"
  );
});

test("iniciarSesion: una cuenta desactivada sigue sin poder entrar aunque el nombre coincida normalizado", async () => {
  const DB = construirDBPrueba();
  await sembrarCuentaConPassword(DB, "Maria", "clave.Secreta1", { activo: false });

  await assert.rejects(() => iniciarSesion(DB, "maria", "clave.Secreta1"), /Usuario o contraseña incorrectos/);
});

test("iniciarSesion: un usuario vacío o ausente no hace match con nadie", async () => {
  const DB = construirDBPrueba();
  await sembrarCuentaConPassword(DB, "Maria", "clave.Secreta1");
  // La cuenta con nombre en blanco es la que hace trabajar de verdad a esta
  // prueba: hoy no se puede crear desde la aplicación, pero si existiera en
  // datos viejos, sin la guarda de nombre vacío un login con el campo usuario
  // en blanco la encontraría (ambos lados normalizan a ""). Sin sembrarla, la
  // prueba pasaba aunque se quitara la guarda.
  await sembrarCuentaConPassword(DB, "   ", "clave.Secreta1");

  for (const vacio of ["", "   ", undefined, null]) {
    await assert.rejects(() => iniciarSesion(DB, vacio, "clave.Secreta1"), /Usuario o contraseña incorrectos/);
  }
});

test("crearUsuario: rechaza un nombre de usuario que solo difiere en mayúsculas o espacios", async () => {
  // Si se colara, las dos cuentas quedarían indistinguibles al entrar: el
  // login normalizado siempre se quedaría con la primera de la lista.
  const DB = construirDBPrueba();
  await sembrarCuentaConPassword(DB, "maria", "clave.Secreta1");
  const rol = DB.admin.roles[0];

  for (const choque of ["Maria", "MARIA", " maria", "maria  "]) {
    await assert.rejects(
      () => crearUsuario(DB, { nombre: "Otra Persona", usuario: choque, password: "otraClave1", rol_id: rol.id }),
      /Ese nombre de usuario ya existe/,
      `"${choque}" choca con la cuenta "maria" y debe rechazarse`
    );
  }
  assert.strictEqual(DB.admin.usuarios.length, 1, "ninguno de los intentos debe haberse guardado");
});

test("crearUsuario: sí acepta un nombre realmente distinto y lo guarda tal como se capturó", async () => {
  const DB = construirDBPrueba();
  await sembrarCuentaConPassword(DB, "maria", "clave.Secreta1");
  const rol = DB.admin.roles[0];

  const nuevo = await crearUsuario(DB, { nombre: "Ana López", usuario: " Ana.Lopez ", password: "otraClave1", rol_id: rol.id });

  assert.strictEqual(nuevo.usuario, "Ana.Lopez", "se recortan los espacios pero se respetan las mayúsculas capturadas");
  assert.strictEqual(DB.admin.usuarios.length, 2);
});

test("actualizarUsuario: ignora un 'usuario' mandado en el body (no se puede renombrar la cuenta por esa vía)", async () => {
  // Por eso la validación de choque vive solo en crearUsuario: editar no puede
  // producir dos cuentas indistinguibles. Si algún día se permite renombrar,
  // hay que llevarse la misma comparación normalizada a actualizarUsuario.
  const DB = construirDBPrueba();
  await sembrarCuentaConPassword(DB, "maria", "clave.Secreta1");
  const rol = DB.admin.roles[0];
  await crearUsuario(DB, { nombre: "Ana López", usuario: "ana", password: "otraClave1", rol_id: rol.id });
  const ana = DB.admin.usuarios.find((u) => u.usuario === "ana");

  await actualizarUsuario(DB, ana.id, { nombre: "Ana Renombrada", usuario: "MARIA" });

  assert.strictEqual(DB.admin.usuarios.find((u) => u.id === ana.id).usuario, "ana", "el nombre de usuario no debe cambiar");
});

// ---------- Red de seguridad: cuentas viejas que chocan al normalizar ----------
// Hoy no se pueden crear (crearUsuario las rechaza y actualizarUsuario no deja
// renombrar), pero una base anterior a esa validación podría traerlas: la
// segunda cuenta no puede entrar NUNCA y solo ve "Usuario o contraseña
// incorrectos". El arranque de server.js lo avisa con esta función.

test("usuariosQueChocanAlNormalizar: no reporta nada cuando los usuarios son realmente distintos", async () => {
  const DB = construirDBPrueba();
  await sembrarCuentaConPassword(DB, "maria", "clave.Secreta1");
  await sembrarCuentaConPassword(DB, "ana.lopez", "clave.Secreta1", { id: 61 });

  assert.deepStrictEqual(usuariosQueChocanAlNormalizar(DB), []);
});

test("usuariosQueChocanAlNormalizar: detecta 'Maria' y 'maria' ya guardadas y nombra las dos cuentas", async () => {
  const DB = construirDBPrueba();
  // Se meten directo al arreglo, como estarían en una base vieja: crearUsuario
  // ya no permitiría dar de alta la segunda.
  await sembrarCuentaConPassword(DB, "Maria", "clave.Secreta1");
  await sembrarCuentaConPassword(DB, " maria ", "otraClave1", { id: 61 });
  await sembrarCuentaConPassword(DB, "ana", "otraClave1", { id: 62 });

  const choques = usuariosQueChocanAlNormalizar(DB);

  assert.strictEqual(choques.length, 1, "solo el par Maria/maria choca");
  assert.strictEqual(choques[0].clave, "maria");
  assert.deepStrictEqual(choques[0].usuarios, ["Maria", " maria "], "el aviso debe poder nombrar las cuentas tal como están guardadas");
});

test("usuariosQueChocanAlNormalizar: ignora las cuentas con el nombre en blanco (esas ya no pueden entrar)", async () => {
  const DB = construirDBPrueba();
  await sembrarCuentaConPassword(DB, "   ", "clave.Secreta1");
  await sembrarCuentaConPassword(DB, "", "clave.Secreta1", { id: 61 });

  assert.deepStrictEqual(usuariosQueChocanAlNormalizar(DB), []);
});

test("usuariosQueChocanAlNormalizar: no revienta con un DB sin usuarios", () => {
  assert.deepStrictEqual(usuariosQueChocanAlNormalizar(construirDBPrueba()), []);
  assert.deepStrictEqual(usuariosQueChocanAlNormalizar({}), [], "el aviso de arranque nunca debe tumbar el arranque");
});

test("el freno de fuerza bruta cuenta bajo la MISMA clave que usa el login para buscar la cuenta", async () => {
  // Si intentosLogin.js y usuarios.js normalizaran distinto, alguien podría
  // esquivar el bloqueo alternando mayúsculas, o quedar bloqueado bajo una
  // clave que no corresponde a la cuenta que intentó abrir.
  const DB = construirDBPrueba();
  await sembrarCuentaConPassword(DB, "Victor", "clave.Secreta1");
  const store = crearRegistroIntentos();
  const variantes = ["victor", "Victor", "VICTOR", " victor ", "vIcToR"];

  // Cada variante encuentra la MISMA cuenta al iniciar sesión...
  for (const v of variantes) {
    assert.strictEqual((await iniciarSesion(DB, v, "clave.Secreta1")).id, 60);
  }
  // ...y los fallos con esas variantes se acumulan en un solo contador.
  for (let i = 0; i < MAX_INTENTOS; i++) registrarFallo(store, variantes[i % variantes.length]);

  for (const v of variantes) {
    assert.strictEqual(estaBloqueado(store, v).bloqueado, true, `el bloqueo debe aplicar también a "${v}"`);
  }
});
