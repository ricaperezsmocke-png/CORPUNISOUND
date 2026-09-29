const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const BASE = path.join(os.tmpdir(), `corpunisound-ubicacion-${process.pid}-${Date.now()}.sqlite`);
process.env.DB_PATH = BASE;
process.env.JWT_SECRET = "secreto-solo-para-pruebas-ubicacion";
const app = require("./server");
const { sembrarCuentas } = require("./testHelpers");
const { firmarToken, validarUbicacionLogin } = require("./auth");
const { crearUsuario, actualizarUsuario } = require("./usuarios");
const { cargar } = require("./persistencia");
const Database = require("better-sqlite3");
const cuenta = { id: 901, nombre: "Victor prueba", rol_id: 1, sucursal_id: 1 };
const admin = firmarToken(cuenta);
const personal = { id: 902, rol_id: 902, sucursal_id: 1 };
let servidor;
let base;
let original;
let sqlite;
before(async () => {
  sembrarCuentas(app, [cuenta, personal]);
  app.DB.admin.roles.push({ id: 902, nombre: "Personal", permisos: ["ver_productos"], modulos: ["pos"] });
  original = structuredClone(app.DB);
  sqlite = new Database(BASE);
  await new Promise((resolve) => { servidor = app.listen(0, resolve); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});
beforeEach(() => {
  Object.assign(app.DB, structuredClone(original));
  Object.assign(app.DB.pos.sucursales[0], { lat: 16.9, lng: -92.1 });
});
after(async () => {
  if (servidor) await new Promise((resolve) => servidor.close(resolve));
  sqlite?.close();
  try { fs.unlinkSync(BASE); } catch { /* SQLite sigue abierto en Windows. */ }
});
async function peticion(ruta, method, cuerpo, token = admin) {
  const respuesta = await fetch(`${base}/api/${ruta}`, {
    method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(cuerpo === undefined ? {} : { body: JSON.stringify(cuerpo) }),
  });
  return { status: respuesta.status, datos: await respuesta.json() };
}
for (const cuerpo of [
  { lat: "abc", lng: 0 }, { lat: "", lng: "" }, { lat: 1 }, { lng: 1 },
  { lat: [1], lng: 0 }, { lat: {}, lng: 0 }, { lat: true, lng: 0 },
  { lat: "Infinity", lng: 0 }, { lat: 91, lng: 0 }, { lat: 0, lng: -181 },
  { lat: "", lng: 0 }, {}, { lat: null, lng: null },
]) {
  test(`PUT rechaza ${JSON.stringify(cuerpo)} sin mutar`, async () => {
    const antes = structuredClone(app.DB);
    const resultado = await peticion("sucursales/1/ubicacion", "PUT", cuerpo);
    assert.equal(resultado.status, 400);
    assert.deepEqual(app.DB, antes);
  });
}
test("GPS existente no se puede borrar y devuelve motivo explícito", async () => {
  const resultado = await peticion("sucursales/1/ubicacion", "PUT", { lat: " ", lng: "" });
  assert.equal(resultado.status, 400);
  assert.equal(resultado.datos.error, "Esta tienda ya tiene ubicación GPS: no se puede dejar en blanco, solo cambiarla");
});
test("configura tienda sin GPS y cada cambio guarda autor, hora y coordenadas anteriores", async () => {
  Object.assign(app.DB.pos.sucursales[0], { lat: null, lng: null });
  const inicio = Date.now();
  for (const cuerpo of [{ lat: "16.9", lng: "-92.1" }, { lat: 0, lng: 0 }]) {
    assert.equal((await peticion("sucursales/1/ubicacion", "PUT", cuerpo)).status, 200);
  }
  const tienda = app.DB.pos.sucursales[0];
  assert.equal(tienda.ubicacion_historial.length, 2);
  const valores = tienda.ubicacion_historial.map(({ fecha_hora, ...resto }) => {
    assert.ok(Date.parse(fecha_hora) >= inicio && Date.parse(fecha_hora) <= Date.now());
    assert.equal(new Date(fecha_hora).toISOString(), fecha_hora);
    return resto;
  });
  assert.deepEqual(valores, [
    { usuario_id: 901, usuario_nombre: "Victor prueba", lat_anterior: null, lng_anterior: null, lat: 16.9, lng: -92.1 },
    { usuario_id: 901, usuario_nombre: "Victor prueba", lat_anterior: 16.9, lng_anterior: -92.1, lat: 0, lng: 0 },
  ]);
  assert.deepEqual(cargar().pos.sucursales[0], tienda);
});
test("GET solo expone historial a administrar_roles", async () => {
  app.DB.pos.sucursales[0].ubicacion_historial = [{ usuario_id: 901, lat: 16.9 }];
  for (const token of [null, firmarToken(personal)]) {
    const resultado = await peticion("sucursales", "GET", undefined, token);
    for (const campo of ["lat", "lng", "fecha_alta", "creada_por", "ubicacion_historial"]) {
      assert.equal(campo in resultado.datos[0], false);
    }
  }
  const resultado = await peticion("sucursales", "GET");
  assert.deepEqual(resultado.datos[0].ubicacion_historial, [{ usuario_id: 901, lat: 16.9 }]);
});
test("tiendas sin_ubicacion siguen rechazadas", async () => {
  const antes = structuredClone(app.DB);
  assert.equal((await peticion("sucursales/5/ubicacion", "PUT", { lat: 1, lng: 1 })).status, 400);
  assert.deepEqual(app.DB, antes);
});
test("login rechaza cuenta con tienda inexistente", () => {
  assert.deepEqual(validarUbicacionLogin({ ...personal, sucursal_id: 99 }, 99, 0, 0, app.DB), {
    ok: false, motivo: "sucursal_no_coincide",
  });
});
test("cuenta con alcance global entra aunque su tienda no exista (no se deja fuera al dueño)", () => {
  // Decisión de Claude al revisar, 2026-09-28: el alcance global no depende de una tienda,
  // y bloquearlo podría dejar sin acceso a la administración. El hueco era el personal amarrado.
  assert.deepEqual(validarUbicacionLogin({ ...cuenta, sucursal_id: 99 }, 99, 0, 0, app.DB), { ok: true });
});
test("dato viejo NaN se trata explícitamente como sin configurar, incluso sin GPS del personal", () => {
  app.DB.pos.sucursales[0].lat = NaN;
  // Decisión de Victor: no bloquear tiendas pendientes de configuración. No calcular distancia con NaN.
  assert.deepEqual(validarUbicacionLogin(personal, 1, null, null, app.DB), { ok: true });
  assert.deepEqual(validarUbicacionLogin(personal, 2, 0, 0, app.DB), { ok: false, motivo: "sucursal_no_coincide" });
});
test("GPS finito sigue rechazando ubicación lejana o ausente", () => {
  assert.equal(validarUbicacionLogin(personal, 1, 0, 0, app.DB).motivo, "ubicacion_no_coincide");
  assert.equal(validarUbicacionLogin(personal, 1, null, null, app.DB).motivo, "sin_permiso_ubicacion");
});
test("alta y edición de personal rechazan sucursal 99 sin mutar", async () => {
  const antes = structuredClone(app.DB);
  const datos = { nombre: "Prueba", usuario: "prueba99", password: "prueba123", rol_id: 902, sucursal_id: "99" };
  await assert.rejects(() => crearUsuario(app.DB, datos), { message: "La sucursal asignada no existe" });
  await assert.rejects(() => actualizarUsuario(app.DB, 902, { sucursal_id: "99" }), {
    message: "La sucursal asignada no existe",
  });
  assert.deepEqual(app.DB, antes);
});
test("HTTP alta y edición de personal devuelven 400 para sucursal 99", async () => {
  const datos = { nombre: "Prueba", usuario: "prueba99", password: "prueba123", rol_id: 902, sucursal_id: "99" };
  const antes = structuredClone(app.DB);
  for (const [ruta, metodo, cuerpo] of [["usuarios", "POST", datos], ["usuarios/902", "PUT", { sucursal_id: "99" }]]) {
    const resultado = await peticion(ruta, metodo, cuerpo);
    assert.equal(resultado.status, 400);
    assert.equal(resultado.datos.error, "La sucursal asignada no existe");
  }
  assert.deepEqual(app.DB, antes);
});
test("alta de personal conserva sucursal predeterminada 1", async () => {
  const nueva = await crearUsuario(app.DB, { nombre: "Default", usuario: "default", password: "prueba123", rol_id: 902 });
  assert.equal(nueva.sucursal_id, 1);
});
for (const [ruta, metodo, cuerpo] of [
  ["sucursales", "POST", { nombre: "Innotec", ciudad: "Ocosingo", lat: 16.9, lng: -92.1 }],
  ["sucursales/1/ubicacion", "PUT", { lat: 0, lng: 0 }],
]) {
  test(`${metodo} no confirma ni deja cambios si falla SQLite`, async () => {
    const antes = structuredClone(app.DB);
    const discoAntes = cargar();
    sqlite.exec("CREATE TRIGGER fallo_guardado BEFORE UPDATE ON estado BEGIN SELECT RAISE(ABORT, 'fallo simulado'); END");
    try {
      const resultado = await peticion(ruta, metodo, cuerpo);
      assert.ok(resultado.status >= 400);
      assert.deepEqual(app.DB, antes);
      assert.deepEqual(cargar(), discoAntes);
    } finally {
      sqlite.exec("DROP TRIGGER fallo_guardado");
    }
  });
}
