const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
process.env.DB_PATH = ":memory:";
process.env.JWT_SECRET = "bandeja-rutas-prueba";
process.env.NODE_ENV = "test";
process.env.SENTRY_ENABLED = "false";
const app = require("./server");
const { obtenerConexionSqlite } = require("./persistencia");
const { firmarToken } = require("./auth");
const sqlite = obtenerConexionSqlite();
const tokens = {};
let servidor, base;
const TODOS = ["ver_bandeja", "responder_mensajes", "ver_todas_conversaciones", "reasignar_conversaciones", "traspasar_cartera",
  "ligar_identidades", "conectar_canales_mensajes"];

before(async () => {
  for (const [id, permisos, sucursal, vendedor] of [
    [981, ["ver_bandeja", "responder_mensajes"], 1, 1], [982, ["ver_bandeja", "responder_mensajes"], 1, 2],
    [983, TODOS, 1, null], [984, ["cambiar_estado_cliente", "marcar_cuenta_interna", "registrar_contacto_cliente"], 1, 1],
    [985, ["ver_bandeja", "responder_mensajes"], 2, 3], [986, [...TODOS, "ver_todas_las_sucursales"], 1, null]]) {
    app.DB.admin.roles.push({ id, nombre: `Prueba ${id}`, permisos, modulos: ["crm"] });
    app.DB.admin.usuarios.push({ id, usuario: `bandeja${id}`, nombre: `Actor ${id}`, rol_id: id, sucursal_id: sucursal, activo: true,
      vendedor_id: vendedor });
    tokens[id] = firmarToken({ id: String(id), rol_id: id, sucursal_id: sucursal });
  }
  await new Promise(resolve => { servidor = app.listen(0, "127.0.0.1", resolve); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});
beforeEach(() => {
  for (const tabla of ["lead_interacciones", "lead_historial", "lead_asignaciones", "leads", "lead_conversaciones",
    "lead_identidades_externas", "lead_eventos_externos", "lead_fuentes"]) sqlite.exec(`DELETE FROM ${tabla}`);
  app.DB.pos.vendedores = [{ id: 1, nombre: "Vero", sucursal_id: 1, activo: true }, { id: 2, nombre: "Luis", sucursal_id: 1, activo: true },
    { id: 3, nombre: "Ruth", sucursal_id: 2, activo: true }];
  app.DB.crm.clientes = [{ id: 0, nombre: "Público en General", sucursal_id: 1 },
    { id: 10, nombre: "Ana", celular: "9191112233", sucursal_id: 1, vendedor_asignado_id: 1, estado: null },
    { id: 11, nombre: "Beto", celular: "9192223344", sucursal_id: 1, vendedor_asignado_id: null, estado: null },
    { id: 20, nombre: "Otra tienda", celular: "9193334455", sucursal_id: 2, vendedor_asignado_id: 3, estado: null }];
  app.DB.crm.contactos_cliente = [];
  app.DB.crm.estados_historial = [];
});
after(async () => {
  servidor?.closeAllConnections();
  if (servidor) await new Promise(resolve => servidor.close(resolve));
  sqlite.close();
});
async function pedir(metodo, ruta, id, cuerpo) {
  const res = await fetch(`${base}/api/mensajes/${ruta}`, { method: metodo,
    headers: { "Content-Type": "application/json", ...(id ? { Authorization: `Bearer ${tokens[id]}` } : {}) },
    ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}) });
  const texto = await res.text();
  return { status: res.status, datos: /^[[{]/.test(texto) ? JSON.parse(texto) : texto };
}
const simular = (numero, texto = "Hola", sucursal_id = 1, canal = "whatsapp") =>
  pedir("POST", "simulado/entrante", 983, { sucursal_id, canal, remitente: { id_externo: numero, nombre: "Prueba" }, texto });

test("permisos propios: vecinos del CRM reciben 403 y sin sesión 401", async () => {
  assert.equal((await pedir("GET", "conversaciones", 984)).status, 403);
  assert.equal((await pedir("GET", "conversaciones", null)).status, 401);
  assert.equal((await pedir("POST", "traspasos", 981, { de_vendedor_id: 1, a_vendedor_id: 2, motivo: "prueba" })).status, 403);
});

test("el vendedor ve las suyas y las sin responsable de su tienda, no las de otro vendedor", async () => {
  const deAna = (await simular("529191112233")).datos;
  const deBeto = (await simular("529192223344")).datos;
  const mias = (await pedir("GET", "conversaciones?filtro=mias", 981)).datos.map(c => c.id);
  assert.deepEqual(mias, [deAna.conversacion_id]);
  const libres = (await pedir("GET", "conversaciones?filtro=sin_responsable", 982)).datos.map(c => c.id);
  assert.deepEqual(libres, [deBeto.conversacion_id]);
  assert.equal((await pedir("GET", `conversaciones/${deAna.conversacion_id}`, 982)).status, 404);
  assert.equal((await pedir("GET", "conversaciones?filtro=todas", 981)).status, 403);
  assert.equal((await pedir("GET", "conversaciones?filtro=todas", 983)).datos.length, 2);
  assert.equal((await pedir("GET", "conversaciones?filtro=raro", 983)).status, 400);
});

test("otra tienda: 404 aunque tenga permiso de ver todas, salvo alcance global", async () => {
  const otra = (await pedir("POST", "simulado/entrante", 986, { sucursal_id: 2, remitente: { id_externo: "529193334455" }, texto: "hola" })).datos;
  assert.equal((await pedir("GET", `conversaciones/${otra.conversacion_id}`, 983)).status, 404);
  assert.equal((await pedir("GET", `conversaciones/${otra.conversacion_id}`, 986)).status, 200);
  assert.equal((await pedir("POST", "simulado/entrante", 983, { sucursal_id: 2, remitente: { id_externo: "5291" }, texto: "x" })).status, 404);
  assert.equal((await pedir("GET", "clientes/20/historial", 983)).status, 404);
});

test("tomar, responder y el estado cambia solo; responder sin tomar es 409", async () => {
  const r = (await simular("529192223344", "¿Precio de la guitarra?")).datos;
  assert.equal(app.DB.crm.clientes.find(c => c.id === 11).estado, "interesado");
  assert.equal((await pedir("POST", `conversaciones/${r.conversacion_id}/mensajes`, 982, { texto: "Hola" })).status, 409);
  assert.equal((await pedir("POST", `conversaciones/${r.conversacion_id}/tomar`, 982)).status, 200);
  assert.equal(app.DB.crm.clientes.find(c => c.id === 11).vendedor_asignado_id, 2);
  assert.equal((await pedir("POST", `conversaciones/${r.conversacion_id}/tomar`, 981)).status, 404);
  const envio = await pedir("POST", `conversaciones/${r.conversacion_id}/mensajes`, 982, { texto: "Cuesta $2,500" });
  assert.equal(envio.status, 200);
  assert.equal(envio.datos.usuario_id, 982);
  const hilo = (await pedir("GET", `conversaciones/${r.conversacion_id}`, 982)).datos.mensajes;
  assert.deepEqual(hilo.map(m => m.direccion), ["entrante", "saliente"]);
});

test("reasignar y traspasar quedan en el historial del cliente; desactivar con cartera se niega", async () => {
  await simular("529191112233");
  assert.equal((await pedir("PUT", "clientes/10/responsable", 983, { vendedor_id: 2, motivo: "" })).status, 400);
  assert.equal((await pedir("PUT", "clientes/10/responsable", 983, { vendedor_id: "2", motivo: "Vero de vacaciones" })).status, 200);
  const historial = (await pedir("GET", "clientes/10/historial", 983)).datos;
  assert.equal(historial.responsables[0].vendedor_nombre, "Luis");
  assert.equal(historial.responsables[0].motivo, "Vero de vacaciones");
  assert.equal(historial.estados[0].nuevo, "interesado");
  const t = await pedir("POST", "traspasos", 983, { de_vendedor_id: 2, a_vendedor_id: 1, motivo: "Luis dejó la empresa" });
  assert.equal(t.status, 200);
  assert.equal(t.datos.movidos, 1);
  assert.equal((await pedir("POST", "traspasos", 983, { de_vendedor_id: 3, a_vendedor_id: 3, motivo: "otra tienda" })).status, 404);
});

test("Messenger por identificar se liga a mano con permiso", async () => {
  const r = (await simular("psid-55", "hola", 1, "messenger")).datos;
  assert.equal(r.cliente_id, null);
  const lista = (await pedir("GET", "conversaciones?filtro=por_identificar", 981)).datos;
  assert.equal(lista.length, 1);
  const identidad = sqlite.prepare("SELECT id FROM lead_identidades_externas").get().id;
  assert.equal((await pedir("POST", `identidades/${identidad}/ligar`, 981, { cliente_id: 11 })).status, 403);
  assert.equal((await pedir("POST", `identidades/${identidad}/ligar`, 983, { cliente_id: 20 })).status, 404);
  assert.equal((await pedir("POST", `identidades/${identidad}/ligar`, 983, { cliente_id: "11" })).status, 200);
  assert.equal((await pedir("GET", `conversaciones/${r.conversacion_id}`, 983)).datos.cliente_id, 11);
});

test("el estado manual también queda en el historial con el usuario", async () => {
  app.DB.admin.roles.find(r => r.id === 983).permisos.push("cambiar_estado_cliente");
  const res = await fetch(`${base}/api/crm/v2/clientes/crm%3A11/estado`, { method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokens[983]}` }, body: JSON.stringify({ estado: "visito_tienda" }) });
  assert.equal(res.status, 200);
  const ultimo = app.DB.crm.estados_historial.at(-1);
  assert.deepEqual([ultimo.cliente_id, ultimo.nuevo, ultimo.usuario_id, ultimo.motivo], [11, "visito_tienda", 983, "Cambio manual"]);
});
