/**
 * autorizador.test.js — La verificación única del autorizador y su freno
 * (auditoría de permisos 2026-10, M1).
 *
 * La reproducción H4 mostraba 8 contraseñas malas seguidas desde el campo del
 * autorizador de la cancelación, sin freno, y una novena que acertaba con una
 * respuesta distinta (oráculo). Aquí se exige lo contrario.
 */

const { test, before } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "autorizador-")), "datos.sqlite");
process.env.JWT_SECRET = process.env.JWT_SECRET || "secreto-de-pruebas";

const app = require("./server");
const { construirDBPrueba } = require("./testHelpers");
const { firmarToken, hashearPassword } = require("./auth");
const { verificarAutorizador, crearRegistroAutorizador } = require("./autorizador");

const CLAVE = "ClaveReal2026";
let HASH = "";

before(async () => { HASH = await hashearPassword(CLAVE); });

function prepararDB() {
  const DB = construirDBPrueba();
  DB.admin.roles = [
    { id: 1, permisos: ["autorizar_cancelaciones", "ver_todas_las_sucursales"] },
    { id: 2, permisos: ["autorizar_cancelaciones", "cancelar_ventas"] },
    { id: 3, permisos: ["cancelar_ventas", "cerrar_venta"] },
  ];
  DB.admin.usuarios = [
    { id: 1, nombre: "Victor", usuario: "victor", rol_id: 1, sucursal_id: 1, activo: true, password_hash: HASH },
    { id: 2, nombre: "Supervisora", usuario: "super", rol_id: 2, sucursal_id: 1, activo: true, password_hash: HASH },
    { id: 3, nombre: "Gerente", usuario: "gerente", rol_id: 3, sucursal_id: 1, activo: true, password_hash: HASH },
  ];
  return DB;
}

function opciones(DB, registro, extra = {}) {
  return {
    solicitante: { id: 3 }, permiso: "autorizar_cancelaciones", sucursalId: 1, registro,
    resolverPermisosDeRol: (rolId) => DB.admin.roles.find((r) => r.id === Number(rolId))?.permisos || [],
    ...extra,
  };
}

test("credenciales correctas devuelven solo id y nombre", async () => {
  const DB = prepararDB();
  const r = await verificarAutorizador(DB, { usuario: " Super ", password: CLAVE }, opciones(DB, crearRegistroAutorizador()));
  assert.deepStrictEqual(r, { id: 2, nombre: "Supervisora" });
});

test("las reglas de siempre rechazan con el 403 genérico", async () => {
  const DB = prepararDB();
  const casos = [
    [{ usuario: "super", password: "mala" }, {}],
    [{ usuario: "nadie", password: CLAVE }, {}],
    [{ usuario: "gerente", password: CLAVE }, {}],                       // sin el permiso
    [{ usuario: "super", password: CLAVE }, { solicitante: { id: "2" } }], // ella misma, id de texto
    [{ usuario: "super", password: CLAVE }, { sucursalId: 2 }],           // otra sucursal
    [{ usuario: "super", password: CLAVE }, { sucursalId: null }],
    [{ usuario: {}, password: [] }, {}],
    [undefined, {}],
  ];
  for (const [cred, extra] of casos) {
    await assert.rejects(verificarAutorizador(DB, cred, opciones(DB, crearRegistroAutorizador(), extra)),
      (e) => e.status === 403 && e.message === "La autorización no es válida", JSON.stringify(cred));
  }
});

test("un autorizador global sirve para cualquier sucursal", async () => {
  const DB = prepararDB();
  const r = await verificarAutorizador(DB, { usuario: "victor", password: CLAVE }, opciones(DB, crearRegistroAutorizador(), { sucursalId: 4 }));
  assert.strictEqual(r.id, 1);
});

test("una cuenta creada por quien pide no le autoriza, y el rechazo no cuenta como adivinanza (R1)", async () => {
  const DB = prepararDB();
  DB.admin.usuarios.push({ id: 4, nombre: "Títere", usuario: "titere", rol_id: 2, sucursal_id: 1, activo: true,
    password_hash: HASH, creado_por_id: 3 });
  const reg = crearRegistroAutorizador();
  // Id de quien pide como texto y creado_por_id como texto: igual se rechaza.
  for (const solicitante of [{ id: 3 }, { id: "3" }]) {
    for (let i = 0; i < 6; i++) {
      await assert.rejects(verificarAutorizador(DB, { usuario: "titere", password: CLAVE }, opciones(DB, reg, { solicitante })),
        (e) => e.status === 403 && e.message === "La autorización no es válida");
    }
  }
  DB.admin.usuarios[3].creado_por_id = "3";
  await assert.rejects(verificarAutorizador(DB, { usuario: "titere", password: CLAVE }, opciones(DB, reg)));
  // 13 rechazos sin contar: ni quien pide ni la títere quedaron bloqueados.
  assert.strictEqual((await verificarAutorizador(DB, { usuario: "super", password: CLAVE }, opciones(DB, reg))).id, 2);
  const otro = opciones(DB, reg, { solicitante: { id: 1 } });
  assert.strictEqual((await verificarAutorizador(DB, { usuario: "titere", password: CLAVE }, otro)).id, 4);
});

test("cuentas viejas sin creado_por_id (null o ausente) autorizan como siempre", async () => {
  const DB = prepararDB();
  DB.admin.usuarios[1].creado_por_id = null;
  const reg = crearRegistroAutorizador();
  assert.strictEqual((await verificarAutorizador(DB, { usuario: "super", password: CLAVE }, opciones(DB, reg))).id, 2);
  // Number(null) es 0: un solicitante con id 0 o ausente tampoco debe "coincidir".
  const sinId = opciones(DB, reg, { solicitante: { id: 0 } });
  assert.strictEqual((await verificarAutorizador(DB, { usuario: "super", password: CLAVE }, sinId)).id, 2);
});

test("5 contraseñas malas bloquean: la sexta, aun buena, se rechaza", async () => {
  const DB = prepararDB();
  const reg = crearRegistroAutorizador();
  for (let i = 0; i < 5; i++) {
    await assert.rejects(verificarAutorizador(DB, { usuario: "victor", password: `mala${i}` }, opciones(DB, reg)));
  }
  await assert.rejects(verificarAutorizador(DB, { usuario: "victor", password: CLAVE }, opciones(DB, reg)),
    (e) => e.status === 403 && e.message === "La autorización no es válida");
});

test("el bloqueo sigue al autorizador aunque lo intente otra persona", async () => {
  const DB = prepararDB();
  const reg = crearRegistroAutorizador();
  for (let i = 0; i < 5; i++) {
    await assert.rejects(verificarAutorizador(DB, { usuario: "victor", password: "x" }, opciones(DB, reg, { solicitante: { id: 100 + i } })));
  }
  await assert.rejects(verificarAutorizador(DB, { usuario: "victor", password: CLAVE }, opciones(DB, reg)));
});

test("el bloqueo sigue a quien pide aunque cambie de autorizador", async () => {
  const DB = prepararDB();
  const reg = crearRegistroAutorizador();
  for (let i = 0; i < 5; i++) {
    await assert.rejects(verificarAutorizador(DB, { usuario: `inventado${i}`, password: "x" }, opciones(DB, reg)));
  }
  await assert.rejects(verificarAutorizador(DB, { usuario: "super", password: CLAVE }, opciones(DB, reg)));
});

test("el bloqueo vence a los 15 minutos", async (t) => {
  const DB = prepararDB();
  const reg = crearRegistroAutorizador();
  for (let i = 0; i < 5; i++) {
    await assert.rejects(verificarAutorizador(DB, { usuario: "victor", password: "x" }, opciones(DB, reg)));
  }
  const ahoraReal = Date.now;
  t.after(() => { Date.now = ahoraReal; });
  Date.now = () => ahoraReal() + 15 * 60 * 1000 + 1;
  const r = await verificarAutorizador(DB, { usuario: "victor", password: CLAVE }, opciones(DB, reg));
  assert.strictEqual(r.id, 1);
});

test("por la ruta de cancelación: 6 malas seguidas y la séptima, buena, también se rechaza (H4 invertida)", async () => {
  Object.assign(app.DB, construirDBPrueba());
  app.DB.admin.roles.push({ id: 95, nombre: "Cancela", permisos: ["cancelar_ventas", "cerrar_venta"], modulos: ["pos"] });
  app.DB.admin.usuarios.push(
    { id: 60, nombre: "Victor", usuario: "victor-ruta", rol_id: 1, sucursal_id: 1, activo: true, password_hash: HASH },
    { id: 61, nombre: "Gerente", usuario: "gerente-ruta", rol_id: 95, sucursal_id: 1, activo: true, password_hash: HASH },
  );
  const tk = firmarToken({ id: 61, nombre: "Gerente", rol_id: 95, sucursal_id: 1 });
  let servidor = null;
  await new Promise((listo) => { servidor = app.listen(0, listo); });
  try {
    const base = `http://127.0.0.1:${servidor.address().port}`;
    const cancelar = async (password) => {
      const r = await fetch(`${base}/api/ventas/999999/cancelar`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tk}` },
        body: JSON.stringify({ motivo: "x", autorizador: { usuario: "victor-ruta", password } }),
      });
      return { status: r.status, body: await r.json() };
    };
    for (let i = 0; i < 6; i++) assert.strictEqual((await cancelar(`mala${i}`)).status, 403);
    assert.deepStrictEqual(await cancelar(CLAVE), { status: 403, body: { error: "La autorización no es válida" } });
  } finally {
    await new Promise((listo) => servidor.close(listo));
  }
});
