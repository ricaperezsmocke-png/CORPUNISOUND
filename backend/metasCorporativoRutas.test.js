/** Rutas de metas del corporativo (spec 2026-10-22 F1): dueña, alcance, automáticas y marca revisada. */
const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "metas-corp-")), "datos.sqlite");
process.env.JWT_SECRET = process.env.JWT_SECRET || "secreto-de-pruebas";
const app = require("./server");
const { sembrarCuentas } = require("./testHelpers");
const { firmarToken } = require("./auth");
const { crearRol } = require("./roles");
const { fechaLocal } = require("./fechas");

const HOY = fechaLocal(new Date());
const MES = { periodo: "mensual", inicio: `${HOY.slice(0, 7)}-01` };
const consulta = `periodo=mensual&inicio=${MES.inicio}`;
let servidor, base, admin, supervisor, gerente;

before(async () => {
  const rolSupervisor = crearRol(app.DB, { nombre: "Supervisor corp", modulos: ["pos"], permisos: ["usar_gerente_ventas"] });
  const rolGerente = crearRol(app.DB, { nombre: "Gerente corp", modulos: ["pos"],
    permisos: ["usar_gerente_ventas", "editar_objetivos_venta", "anular_capturas_metas"] });
  const cuentas = [
    { id: 170, nombre: "Admin corp", rol_id: 1, sucursal_id: 1 },
    { id: 180, nombre: "Supervisor corp", rol_id: rolSupervisor.id, sucursal_id: 1 },
    { id: 171, nombre: "Gerente corp", rol_id: rolGerente.id, sucursal_id: 1 },
  ];
  sembrarCuentas(app, cuentas);
  [admin, supervisor, gerente] = cuentas.map(firmarToken);
  await new Promise((listo) => { servidor = app.listen(0, listo); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});

beforeEach(() => {
  for (const coleccion of ["okrs", "metas_personalizadas", "meta_capturas", "meta_sellos"]) app.DB.pos[coleccion] = [];
  app.DB.crm.estados_historial = [];
});

after(async () => { if (servidor) await new Promise((listo) => servidor.close(listo)); });

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
const estado = (r, esperado) => assert.equal(r.status, esperado, JSON.stringify(r));
const META = { ...MES, nombre: "Llamadas a proveedores", unidad: "llamadas", prueba: "ninguna", valor_meta: 10, alcance: "corporativo", usuario_id: 180 };

test("admin crea meta corporativa; la duena la ve y captura; el gerente de tienda ni la ve ni la captura", async () => {
  const meta = (await pedir("POST", "/api/metas", admin, { ...META, sucursal_id: 1 })).cuerpo;
  assert.equal(meta.usuario_id, 180);
  const suyo = await pedir("GET", `/api/metas/tablero?${consulta}`, supervisor);
  estado(suyo, 200);
  assert.equal(suyo.cuerpo.sueltas.length, 1);
  assert.equal(suyo.cuerpo.sueltas[0].puede_capturar, true);
  estado(await pedir("POST", `/api/metas/${meta.clave}/captura`, supervisor, { fecha: HOY, cantidad: 2 }), 200);
  const ajeno = await pedir("POST", `/api/metas/${meta.clave}/captura`, gerente, { fecha: HOY, cantidad: 1 });
  estado(ajeno, 400);
  assert.match(ajeno.cuerpo.error, /no está ligada|no es tuya/);
  assert.equal((await pedir("GET", `/api/metas/tablero?${consulta}`, gerente)).cuerpo.sueltas.length, 0);
  const global = await pedir("GET", `/api/metas/tablero?${consulta}&usuario_id=180`, admin);
  assert.equal(global.cuerpo.sueltas[0].resultado, 2);
});

test("meta automatica: avanza sola con los cambios de estado de la cuenta y no acepta captura", async () => {
  const meta = (await pedir("POST", "/api/metas", admin, { ...META, nombre: "Clientes movidos", fuente: "crm_cambios_estado" })).cuerpo;
  app.DB.crm.estados_historial.push({ id: 1, cliente_id: 0, usuario_id: 180, anterior: null, nuevo: "interesado",
    fecha_hora: new Date().toISOString() });
  const t = await pedir("GET", `/api/metas/tablero?${consulta}`, supervisor);
  assert.equal(t.cuerpo.sueltas[0].resultado, 1);
  assert.equal(t.cuerpo.sueltas[0].detalle.length, 1);
  const r = await pedir("POST", `/api/metas/${meta.clave}/captura`, supervisor, { fecha: HOY, cantidad: 1 });
  estado(r, 400);
  assert.equal(r.cuerpo.error, "Esta meta se cuenta sola");
});

test("revisada: el gerente marca las de su tienda; las de otra tienda dan 404", async () => {
  app.DB.pos.meta_capturas.push(
    { id: 1, meta_clave: 99, ...MES, sucursal_id: 1, cantidad: 1, anulada: null, revisada: null },
    { id: 2, meta_clave: 99, ...MES, sucursal_id: 2, cantidad: 1, anulada: null, revisada: null });
  app.DB.pos.metas_personalizadas.push({ clave: 99, alcance: "tienda", sucursal_id: 1 });
  const r = await pedir("POST", "/api/metas/captura/1/revisada", gerente, {});
  estado(r, 200);
  assert.equal(r.cuerpo.revisada.por_id, 171);
  estado(await pedir("POST", "/api/metas/captura/2/revisada", gerente, {}), 404);
  estado(await pedir("POST", "/api/metas/captura/1/revisada", supervisor, {}), 403);
});

test("personas y fuentes: solo el administrador, sin contrasenas", async () => {
  const r = await pedir("GET", "/api/metas/personas-corporativo", admin);
  estado(r, 200);
  assert.ok(r.cuerpo.some((p) => p.id === 180 && p.rol === "Supervisor corp"));
  assert.ok(r.cuerpo.every((p) => !("password_hash" in p)));
  estado(await pedir("GET", "/api/metas/personas-corporativo", gerente), 403);
  const f = await pedir("GET", "/api/metas/fuentes", admin);
  assert.ok(f.cuerpo.some((x) => x.clave === "crm_cambios_estado" && x.descripcion));
});
