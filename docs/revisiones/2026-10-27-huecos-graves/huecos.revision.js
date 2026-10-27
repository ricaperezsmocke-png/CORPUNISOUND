/**
 * Revision independiente de fix/huecos-graves-2026-10 — pruebas contra el
 * servidor real (server.js) en un puerto efimero, con base desechable.
 *
 * Convencion (la misma de las reproducciones de la auditoria):
 * - Las pruebas "DEFECTO" PASAN mientras el defecto existe. Cuando se cierre,
 *   se ponen rojas.
 * - Las pruebas "CONTROL" PASAN si el arreglo se porta bien (lo revisado que
 *   esta bien). Si se ponen rojas, algo se rompio.
 *
 * Fuera de la suite a proposito (no es *.test.js). Correr desde backend/:
 *   node --test ../docs/revisiones/2026-10-27-huecos-graves/huecos.revision.js
 */

import { createRequire } from "node:module";
import { test, before, after } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.join(AQUI, "..", "..", "..", "backend");
const BASE_DESECHABLE = path.join(os.tmpdir(), `revision-huecos-${process.pid}.sqlite`);
process.env.DB_PATH = BASE_DESECHABLE;
process.env.JWT_SECRET = process.env.JWT_SECRET || "secreto-solo-para-revision";

const app = require(path.join(BACKEND, "server"));
const { sembrarCuentas } = require(path.join(BACKEND, "testHelpers"));
const { firmarToken, hashearPassword } = require(path.join(BACKEND, "auth"));

const DB = app.DB;
let servidor = null;
let base = "";

// Un gerente "normal" al que Victor le dio altas y le permite autorizar monedero:
// es justo el escenario que la auditoria A1 describe como probable.
const ROL_GERENTE_ALTAS = 95;
const ROL_CAJERA_MONEDERO = 96;
const ROL_SIN_AUTORIZAR = 97;
const PERMISOS_GERENTE = [
  "cerrar_venta", "dar_alta_personal", "aplicar_monedero", "autorizar_monedero",
  "cancelar_ventas", "autorizar_cancelaciones",
];

async function cuenta(id, usuario, password, rol_id, sucursal_id, nombre) {
  DB.admin.usuarios.push({
    id, nombre, usuario, password_hash: await hashearPassword(password),
    rol_id, sucursal_id, vendedor_id: null, activo: true,
  });
}

before(async () => {
  DB.admin.roles.push({ id: ROL_GERENTE_ALTAS, nombre: "Gerente con altas", permisos: PERMISOS_GERENTE, modulos: ["pos", "admin"] });
  DB.admin.roles.push({ id: ROL_CAJERA_MONEDERO, nombre: "Cajera monedero", permisos: ["cerrar_venta", "aplicar_monedero",
    "cancelar_ventas"], modulos: ["pos"] });
  // Vecino del mismo modulo, sin autorizar_monedero ni autorizar_cancelaciones.
  DB.admin.roles.push({ id: ROL_SIN_AUTORIZAR, nombre: "Cajera sin autorizar", permisos: ["cerrar_venta", "aplicar_monedero"],
    modulos: ["pos"] });
  sembrarCuentas(app, [{ id: 1, rol_id: 1, sucursal_id: 1 }, { id: 3, rol_id: 3, sucursal_id: 1, nombre: "Cajero sembrado" }]);
  await cuenta(60, "gerente.oco", "Gerente2026", ROL_GERENTE_ALTAS, 1, "Gerente Ocosingo");
  await cuenta(61, "cajera.oco", "Cajera2026", ROL_CAJERA_MONEDERO, 1, "Cajera Ocosingo");
  await cuenta(62, "supervisora", "Supervisa2026", ROL_GERENTE_ALTAS, 1, "Supervisora Ocosingo");
  await cuenta(63, "otra.cajera", "OtraCajera2026", ROL_SIN_AUTORIZAR, 1, "Otra cajera");
  await cuenta(64, "victor", "ClaveReal2026", 1, 1, "Victor");
  await cuenta(65, "sup.yajalon", "Yajalon2026", ROL_GERENTE_ALTAS, 2, "Supervisora Yajalon");
  await new Promise((listo) => { servidor = app.listen(0, listo); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(async () => {
  if (servidor) await new Promise((listo) => servidor.close(listo));
  try { fs.unlinkSync(BASE_DESECHABLE); } catch { /* ya no estaba */ }
});

const token = (id) => {
  const u = DB.admin.usuarios.find((x) => x.id === id);
  return firmarToken({ id: u.id, nombre: u.nombre, rol_id: u.rol_id, sucursal_id: u.sucursal_id });
};

async function pedir(metodo, ruta, { tk, body } = {}) {
  const t0 = performance.now();
  const r = await fetch(base + ruta, {
    method: metodo,
    redirect: "manual",
    headers: { "Content-Type": "application/json", ...(tk ? { Authorization: `Bearer ${tk}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const texto = await r.text();
  let json = null;
  try { json = JSON.parse(texto); } catch { /* redireccion o texto */ }
  return { status: r.status, json, ms: performance.now() - t0 };
}

// Cliente 1 es de Ocosingo en la base sembrada; se le pone saldo en cada prueba.
function clienteOcosingo(saldo) {
  const c = DB.crm.clientes.find((x) => Number(x.sucursal_id) === 1 && Number(x.id) > 0);
  c.monedero = saldo;
  return c;
}

const ventaConMonedero = (clienteId, autorizador, extra = {}) => ({
  cliente_id: clienteId, monedero_aplicado: 50, metodo_pago: "Efectivo", vendedor_id: 1,
  lineas: [{ producto_id: 1, descripcion: "Arroz 1kg", cantidad: 4, precio_unitario: 25 }], autorizador, ...extra,
});

test("DEFECTO R1: un gerente con altas crea una cuenta titere y con ella se autoriza su propio monedero", async () => {
  const cliente = clienteOcosingo(500);
  const alta = await pedir("POST", "/api/usuarios", {
    tk: token(60),
    body: { nombre: "Titere", usuario: "titere", password: "Titere2026", rol_id: ROL_GERENTE_ALTAS, sucursal_id: 1 },
  });
  // El rol es identico al suyo: "subconjunto de lo que tiene" -> se acepta.
  assert.strictEqual(alta.status, 200, JSON.stringify(alta.json));
  const venta = await pedir("POST", "/api/ventas", {
    tk: token(60), body: ventaConMonedero(cliente.id, { usuario: "titere", password: "Titere2026" }),
  });
  assert.strictEqual(venta.status, 200, JSON.stringify(venta.json));
  assert.strictEqual(cliente.monedero, 450);
  const v = DB.pos.ventas.find((x) => x.id === venta.json.id);
  assert.strictEqual(v.cobrada_por_nombre, "Gerente Ocosingo");
  assert.strictEqual(v.monedero_autorizado_por_nombre, "Titere");
  // Lo unico que lo delata: la cuenta titere dice quien la creo.
  const titere = DB.admin.usuarios.find((u) => u.usuario === "titere");
  assert.strictEqual(titere.creado_por_id, 60);
  // Lo mismo sirve para cancelaciones: la titere trae autorizar_cancelaciones.
  assert.ok(DB.admin.roles.find((r) => r.id === titere.rol_id).permisos.includes("autorizar_cancelaciones"));
});

test("CONTROL R2: con cualquier falla del monedero el saldo queda intacto y no se crea venta", async () => {
  const cliente = clienteOcosingo(300);
  const yajalon = DB.crm.clientes.find((x) => Number(x.sucursal_id) === 2);
  yajalon.monedero = 300;
  const ventasAntes = DB.pos.ventas.length;
  const casos = [
    ["sin aplicar_monedero (Cajero sembrado)", 3, ventaConMonedero(cliente.id, { usuario: "supervisora", password: "Supervisa2026" })],
    ["cliente de otra tienda", 61, ventaConMonedero(yajalon.id, { usuario: "supervisora", password: "Supervisa2026" })],
    ["cliente de otra tienda, id como texto", 61, ventaConMonedero(String(yajalon.id), { usuario: "supervisora",
      password: "Supervisa2026" })],
    ["sin autorizador", 61, ventaConMonedero(cliente.id, undefined)],
    ["autorizador sin autorizar_monedero", 61, ventaConMonedero(cliente.id, { usuario: "otra.cajera", password: "OtraCajera2026" })],
    ["autorizador de otra tienda", 61, ventaConMonedero(cliente.id, { usuario: "sup.yajalon", password: "Yajalon2026" })],
    ["se autoriza a si misma (mayusculas y espacios)", 62, ventaConMonedero(cliente.id, { usuario: "  SUPERVISORA ",
      password: "Supervisa2026" })],
    ["monedero basura", 61, ventaConMonedero(cliente.id, undefined, { monedero_aplicado: "abc" })],
    // Autorizacion VALIDA pero la venta falla despues (caja inexistente): crearVenta valida la caja antes de tocar saldo.
    ["autorizada pero caja invalida", 61, ventaConMonedero(cliente.id, { usuario: "supervisora", password: "Supervisa2026" },
      { caja_id: 999999 })],
    ["autorizada pero linea invalida", 61, ventaConMonedero(cliente.id, { usuario: "supervisora", password: "Supervisa2026" },
      { lineas: [{ producto_id: 1, descripcion: "Arroz 1kg", cantidad: -1, precio_unitario: 25 }] })],
  ];
  const resultados = [];
  for (const [nombre, quien, body] of casos) {
    const r = await pedir("POST", "/api/ventas", { tk: token(quien), body });
    resultados.push(`${nombre}: ${r.status}`);
    assert.notStrictEqual(r.status, 200, `${nombre} entro: ${JSON.stringify(r.json)}`);
    assert.strictEqual(cliente.monedero, 300, `${nombre} movio el saldo`);
    assert.strictEqual(yajalon.monedero, 300, `${nombre} movio el saldo de Yajalon`);
  }
  assert.strictEqual(DB.pos.ventas.length, ventasAntes);
  console.log(resultados.join("\n"));
});

// El corte con monedero lo cubren monederoCorte.test.js y movimientosCajaMonedero.test.js (verdes en la suite);
// aqui solo se comprueba que la venta autorizada guarda lo que el corte lee.
test("CONTROL R3: con todo correcto la venta guarda monedero_aplicado topado, quien cobro y quien autorizo", async () => {
  const cliente = clienteOcosingo(80);
  const r = await pedir("POST", "/api/ventas", {
    tk: token(61), body: ventaConMonedero(cliente.id, { usuario: "Supervisora", password: "Supervisa2026" },
      { monedero_aplicado: 9999 }),
  });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  const v = DB.pos.ventas.find((x) => x.id === r.json.id);
  assert.strictEqual(v.monedero_aplicado, 80, "el servidor topa al saldo");
  assert.strictEqual(cliente.monedero, 0);
  assert.strictEqual(v.cobrada_por_id, 61);
  assert.strictEqual(v.monedero_autorizado_por_id, 62);
});

test("CONTROL R4: el freno es compartido entre cancelar y monedero, y no se esquiva con mayusculas", async () => {
  const variantes = ["victor", "VICTOR", " Victor ", "victor\t", "ViCtOr"];
  for (const u of variantes) {
    const r = await pedir("PUT", "/api/ventas/999999/cancelar", {
      tk: token(61), body: { motivo: "x", autorizador: { usuario: u, password: "mala" } },
    });
    assert.strictEqual(r.status, 403);
  }
  // Ya con la buena, desde OTRA persona (el gerente, contador limpio) y por la ruta del monedero: bloqueado.
  const cliente = clienteOcosingo(100);
  const r = await pedir("POST", "/api/ventas", {
    tk: token(60), body: ventaConMonedero(cliente.id, { usuario: "victor", password: "ClaveReal2026" }),
  });
  assert.strictEqual(r.status, 403);
  assert.strictEqual(cliente.monedero, 100);
});

test("DEFECTO R5 (desviacion 1): adivinar la contrasena de una cuenta SIN permiso de autorizar deja ver si acerto", async () => {
  // Objetivo: la contrasena de "otra.cajera" (no autoriza nada). Atacante: cajera.oco (id 61).
  // 4 intentos malos, luego una "adivinanza" y una sonda. Si la adivinanza era la buena no cuenta,
  // y la sonda todavia corre bcrypt (lenta). Si era mala, el quinto fallo bloquea y la sonda es instantanea.
  async function ronda(adivinanza) {
    const sol = 66 + Math.floor(Math.random() * 1000000); // atacante distinto por ronda para no mezclar contadores
    DB.admin.usuarios.push({ id: sol, nombre: "Atacante", usuario: `atk${sol}`, password_hash: "x", rol_id: ROL_CAJERA_MONEDERO,
      sucursal_id: 1, activo: true });
    const objetivo = `obj${sol}`;
    DB.admin.usuarios.push({ id: sol + 1, nombre: "Objetivo", usuario: objetivo,
      password_hash: await hashearPassword("SecretoObjetivo"), rol_id: ROL_SIN_AUTORIZAR, sucursal_id: 1, activo: true });
    const intento = (pw) => pedir("PUT", "/api/ventas/999999/cancelar", {
      tk: token(sol), body: { motivo: "x", autorizador: { usuario: objetivo, password: pw } } });
    for (let i = 0; i < 4; i++) await intento(`mala${i}`);
    const g = await intento(adivinanza);
    const sonda = await intento("cualquiera");
    return { status: g.status, sondaMs: sonda.ms };
  }
  const mediana = (xs) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const aciertos = [], fallos = [];
  for (let i = 0; i < 5; i++) {
    const a = await ronda("SecretoObjetivo");
    const f = await ronda("NoEsLaClave");
    assert.strictEqual(a.status, 403);
    assert.strictEqual(f.status, 403); // la respuesta es la misma...
    aciertos.push(a.sondaMs); fallos.push(f.sondaMs);
  }
  const ma = mediana(aciertos), mf = mediana(fallos);
  console.log(`sonda tras acierto: mediana ${ma.toFixed(1)} ms; tras fallo: mediana ${mf.toFixed(1)} ms`);
  assert.ok(ma - mf > 20, "...pero el tiempo de la sonda distingue el acierto (corre bcrypt solo si no hay bloqueo)");
});

test("DEFECTO R6: usuario inexistente responde sin bcrypt (enumerar cuentas por tiempo)", async () => {
  const medir = async (u) => {
    const xs = [];
    for (let i = 0; i < 7; i++) {
      const sol = 2000000 + Math.floor(Math.random() * 1000000);
      DB.admin.usuarios.push({ id: sol, nombre: "Atk", usuario: `t${sol}`, password_hash: "x", rol_id: ROL_CAJERA_MONEDERO,
        sucursal_id: 1, activo: true });
      const r = await pedir("PUT", "/api/ventas/999999/cancelar", {
        tk: token(sol), body: { motivo: "x", autorizador: { usuario: u, password: "mala" } } });
      xs.push(r.ms);
    }
    return xs.sort((a, b) => a - b)[3];
  };
  const existe = await medir("supervisora");
  const noExiste = await medir("nadie-se-llama-asi");
  console.log(`existe: mediana ${existe.toFixed(1)} ms; no existe: mediana ${noExiste.toFixed(1)} ms`);
  assert.ok(existe - noExiste > 20);
});

test("CONTROL R7: alta sin alcance global — rol 1 como texto, otra sucursal, rol inexistente: 403 y no se crea", async () => {
  const n = DB.admin.usuarios.length;
  const intentos = [
    { rol_id: "1", sucursal_id: 1 },
    { rol_id: " 1 ", sucursal_id: 1 },
    { rol_id: ROL_CAJERA_MONEDERO, sucursal_id: 2 },
    { rol_id: ROL_CAJERA_MONEDERO, sucursal_id: "2" },
    { rol_id: ROL_CAJERA_MONEDERO, sucursal_id: "abc" },
    { rol_id: 424242, sucursal_id: 1 },
  ];
  for (const [i, extra] of intentos.entries()) {
    const r = await pedir("POST", "/api/usuarios", {
      tk: token(60), body: { nombre: `X${i}`, usuario: `x${i}`, password: "Clave2026", ...extra } });
    assert.strictEqual(r.status, 403, `${JSON.stringify(extra)} -> ${r.status} ${JSON.stringify(r.json)}`);
  }
  assert.strictEqual(DB.admin.usuarios.length, n);
  // Crear rol y clonar sin alcance global: 403.
  const rol = await pedir("POST", "/api/roles", { tk: token(60), body: { nombre: "R", permisos: ["ver_todas_las_sucursales"] } });
  assert.strictEqual(rol.status, 403);
});

test("CONTROL R8: OAuth — auth-url sin alcance global es 403; callback sin state o con state inventado no toca la cuenta", async () => {
  DB.admin.roles.push({ id: 98, nombre: "Conector", permisos: ["conectar_cuenta_drive", "conectar_cuenta_ml"], modulos: ["admin"] });
  sembrarCuentas(app, [{ id: 70, rol_id: 98, sucursal_id: 1 }]);
  process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "cliente-de-prueba";
  assert.strictEqual((await pedir("GET", "/api/drive/auth-url", { tk: token(70) })).status, 403);
  assert.strictEqual((await pedir("GET", "/api/ml/auth-url", { tk: token(70) })).status, 403);
  const antes = JSON.stringify(DB.drive?.cuenta ?? null);
  for (const q of ["code=x", "code=x&state=", "code=x&state=" + "a".repeat(64), "code=x&state[]=a", "code=x&state=a&state=b"]) {
    const r = await pedir("GET", `/api/drive/callback?${q}`);
    assert.strictEqual(r.status, 302);
    assert.strictEqual(JSON.stringify(DB.drive?.cuenta ?? null), antes, q);
  }
  // state de Drive no sirve para ML (de otro proveedor), y se quema al intentarlo.
  const url = (await pedir("GET", "/api/drive/auth-url", { tk: token(1) })).json.url;
  const state = new URL(url).searchParams.get("state");
  assert.match(state, /^[0-9a-f]{64}$/);
  const r = await fetch(`${base}/api/ml/callback?code=x&state=${state}`, { redirect: "manual" });
  assert.match(r.headers.get("location"), /estado_invalido/);
  const r2 = await fetch(`${base}/api/drive/callback?code=x&state=${state}`, { redirect: "manual" });
  assert.match(r2.headers.get("location"), /estado_invalido/, "un state probado contra otro proveedor ya no sirve");
});
