/** Rutas del planeador con IA: permiso, validacion completa exigida en el servidor y todo o nada. */
const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "plan-ia-rutas-")), "datos.sqlite");
process.env.JWT_SECRET = process.env.JWT_SECRET || "secreto-de-pruebas";
const app = require("./server");
const { sembrarCuentas } = require("./testHelpers");
const { firmarToken } = require("./auth");
const { crearRol } = require("./roles");
const { inicioDePeriodo } = require("./metasPeriodos");
const { fechaLocal } = require("./fechas");

const INICIO = inicioDePeriodo("mensual", fechaLocal(new Date()));
const ENTRADA = { objetivo_texto: "Vender más acústicas", sucursal_id: 1, periodo: "mensual", inicio: INICIO };
const PROPUESTA = { okr: { titulo: "Más acústicas" }, metas: [
  { accion: "nueva", nombre: "Clínica", unidad: "clínica", prueba: "foto", valor_meta: 1, por_que: "" },
  { accion: "nueva", nombre: "Video", unidad: "videos", prueba: "liga", valor_meta: 2, por_que: "" },
  { accion: "actividad:volanteo", nombre: "Volanteo", unidad: "jornadas", prueba: "foto", valor_meta: 2, por_que: "" }] };
const clienteFalso = { messages: { create: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(PROPUESTA) }] }) } };
let servidor, base, admin, gerente;

before(async () => {
  const rolGerente = crearRol(app.DB, { nombre: "Gerencia plan ia", modulos: ["pos"],
    permisos: ["usar_gerente_ventas", "anular_capturas_metas"] });
  const cuentas = [{ id: 80, nombre: "Admin plan", rol_id: 1, sucursal_id: 1 }, { id: 81, nombre: "Gerente plan", rol_id: rolGerente.id, sucursal_id: 1 }];
  sembrarCuentas(app, cuentas);
  [admin, gerente] = cuentas.map(firmarToken);
  await new Promise((listo) => { servidor = app.listen(0, listo); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});

beforeEach(() => {
  for (const coleccion of ["okrs", "metas_personalizadas", "meta_sellos", "planes_ia"]) app.DB.pos[coleccion] = [];
  app.locals.clienteIA = clienteFalso;
});

after(async () => {
  delete app.locals.clienteIA;
  if (servidor) await new Promise((listo) => servidor.close(listo));
});

async function pedir(metodo, ruta, token, datos) {
  const r = await fetch(base + ruta, {
    method: metodo,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(datos === undefined ? {} : { body: JSON.stringify(datos) }),
  });
  let cuerpo = null;
  try { cuerpo = await r.json(); } catch (_) { /* sin cuerpo */ }
  return { status: r.status, cuerpo };
}
const todo = (decision) => ({ okr: { decision }, metas: [0, 1, 2].map((indice) => ({ indice, decision })) });

test("sin permiso de administrar: 403 en las cuatro rutas y nada creado", async () => {
  assert.equal((await pedir("GET", "/api/metas/plan-ia", gerente)).status, 403);
  assert.equal((await pedir("POST", "/api/metas/plan-ia", gerente, ENTRADA)).status, 403);
  const plan = (await pedir("POST", "/api/metas/plan-ia", admin, ENTRADA)).cuerpo;
  assert.equal((await pedir("POST", `/api/metas/plan-ia/${plan.id}/validar`, gerente, todo("aceptar"))).status, 403);
  assert.equal((await pedir("POST", `/api/metas/plan-ia/${plan.id}/descartar`, gerente)).status, 403);
  assert.equal(app.DB.pos.metas_personalizadas.length, 0);
});

test("flujo completo: proponer no crea nada; validar crea lo aceptado con origen visible en el historial", async () => {
  const r = await pedir("POST", "/api/metas/plan-ia", admin, ENTRADA);
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(r.cuerpo.estado, "borrador");
  assert.equal(app.DB.pos.okrs.length + app.DB.pos.metas_personalizadas.length, 0);
  const v = await pedir("POST", `/api/metas/plan-ia/${r.cuerpo.id}/validar`, admin, todo("aceptar"));
  assert.equal(v.status, 200, JSON.stringify(v));
  assert.equal(app.DB.pos.metas_personalizadas.length, 3);
  const historial = await pedir("GET", `/api/metas/${v.cuerpo.creados.metas_claves[0]}/historial`, admin);
  assert.equal(historial.cuerpo[0].origen.validado_por_nombre, "Admin plan");
  const lista = await pedir("GET", "/api/metas/plan-ia", admin);
  assert.equal(lista.cuerpo.configurado, true);
  assert.equal(lista.cuerpo.planes[0].estado, "validado");
});

test("validar incompleto o dos veces: 400 y nada de mas", async () => {
  const plan = (await pedir("POST", "/api/metas/plan-ia", admin, ENTRADA)).cuerpo;
  const incompleto = { okr: { decision: "aceptar" }, metas: [{ indice: 0, decision: "aceptar" }] };
  assert.equal((await pedir("POST", `/api/metas/plan-ia/${plan.id}/validar`, admin, incompleto)).status, 400);
  assert.equal(app.DB.pos.metas_personalizadas.length, 0);
  assert.equal((await pedir("POST", `/api/metas/plan-ia/${plan.id}/validar`, admin, todo("aceptar"))).status, 200);
  assert.equal((await pedir("POST", `/api/metas/plan-ia/${plan.id}/validar`, admin, todo("aceptar"))).status, 400);
  assert.equal(app.DB.pos.metas_personalizadas.length, 3);
});

test("sin IA configurada: GET dice configurado false y POST responde 503", async () => {
  app.locals.clienteIA = null;
  assert.equal((await pedir("GET", "/api/metas/plan-ia", admin)).cuerpo.configurado, false);
  assert.equal((await pedir("POST", "/api/metas/plan-ia", admin, ENTRADA)).status, 503);
});

test("falla de la IA: 502 con el mensaje para la pantalla", async () => {
  app.locals.clienteIA = { messages: { create: async () => { throw new Error("caida"); } } };
  const r = await pedir("POST", "/api/metas/plan-ia", admin, ENTRADA);
  assert.equal(r.status, 502);
  assert.match(r.cuerpo.error, /dar de alta las metas a mano/);
});
