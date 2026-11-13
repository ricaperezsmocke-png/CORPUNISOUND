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

test('envio simulado sigue habilitado y gupshup devuelve 409; listado expone proveedor y origen', async () => {
  const { conversacion_id: id } = (await simular('529191112233')).datos;
  assert.equal((await pedir('POST', `conversaciones/${id}/mensajes`, 981, { texto: 'Hola' })).status, 200);
  sqlite.prepare("UPDATE lead_fuentes SET proveedor = 'gupshup'").run();
  sqlite.prepare("UPDATE lead_interacciones SET tipo = 'mensaje_telefono' WHERE direccion = 'saliente'").run();
  const r = await pedir('POST', `conversaciones/${id}/mensajes`, 981, { texto: 'Otra' });
  assert.equal(r.status, 409);
  assert.equal(r.datos.error, 'Por ahora contesta desde el teléfono de la tienda.');
  const lista = (await pedir('GET', 'conversaciones?filtro=todas', 983)).datos;
  assert.equal(lista[0].proveedor, 'gupshup');
  assert.equal(lista[0].ultimo_tipo, 'mensaje_telefono');
  const hilo = (await pedir('GET', `conversaciones/${id}`, 981)).datos;
  assert.equal(hilo.proveedor, 'gupshup');
  assert.equal(hilo.mensajes.at(-1).tipo, 'mensaje_telefono');
});

test('resumen cuenta por tipo y no trae contenido ni eventos antiguos o de otro proveedor', async () => {
  const ahora = Date.now();
  const texto = 'MARCADOR_PRIVADO 9191234567';
  const insertar = sqlite.prepare(`INSERT INTO lead_eventos_externos
    (proveedor, identificador_evento_externo, tipo, recibido_en, payload_json, procesado_en) VALUES (?, ?, ?, ?, ?, ?)`);
  const fechas = [3, 2, 1, 8, 0].map(d => new Date(ahora - d * 86400000).toISOString());
  for (let i = 0; i < 5; i++) {
    insertar.run(i === 4 ? 'otro' : 'gupshup', `sha256:${i}`, i === 2 ? 'history' : 'messages', fechas[i], texto, i === 1 ? fechas[i] : null);
  }
  const r = await pedir('GET', 'gupshup/resumen', 983);
  assert.equal(r.status, 200);
  assert.deepEqual(r.datos.por_tipo, [{ tipo: 'history', eventos: 1 }, { tipo: 'messages', eventos: 2 }]);
  assert.equal(r.datos.primera, fechas[0]);
  assert.equal(r.datos.ultima, fechas[2]);
  assert.equal(r.datos.sin_procesar, 2);
  assert.equal(r.datos.bytes, texto.length * 3);
  assert.ok(Math.abs(Date.parse(r.datos.desde) - (ahora - 7 * 86400000)) < 5000);
  assert.equal(r.datos.procesados, 1);
  assert.equal(r.datos.con_error, 0);
  assert.deepEqual(r.datos.errores_recientes, []);
  assert.ok(!JSON.stringify(r.datos).includes('MARCADOR_PRIVADO'));
  assert.ok(!JSON.stringify(r.datos).includes('9191234567'));
});

const datosCanal = (sucursal_id = 1, identificador_externo = '1345802228620291') =>
  ({ proveedor: 'gupshup', identificador_externo, nombre: 'Tienda', sucursal_id });

test('canales exigen permiso propio y alcance del token; 400, 403, 409, 201 y 200', async () => {
  assert.equal((await pedir('GET', 'canales', 981)).status, 403);
  assert.equal((await pedir('POST', 'canales', 981, datosCanal())).status, 403);
  assert.equal((await pedir('GET', 'canales', null)).status, 401);
  assert.equal((await pedir('POST', 'canales', 983, datosCanal(999999))).status, 400);
  assert.equal((await pedir('POST', 'canales?sucursal_id=2', 983, datosCanal('2'))).status, 403);
  const nuevo = await pedir('POST', 'canales?sucursal_id=2', 983, datosCanal('1'));
  assert.equal(nuevo.status, 201);
  assert.equal(nuevo.datos.sucursal_id, 1);
  assert.equal(nuevo.datos.proveedor, 'gupshup');
  const repetido = await pedir('POST', 'canales', 983, datosCanal(1));
  assert.equal(repetido.status, 200);
  assert.equal(repetido.datos.id, nuevo.datos.id);
  assert.equal((await pedir('POST', 'canales', 986, datosCanal(2))).status, 409);
  assert.equal((await pedir('POST', 'canales', 986, datosCanal(2, 'otro'))).status, 201);
  assert.equal((await pedir('GET', 'canales?sucursal_id=2', 983)).datos.length, 1);
  assert.equal((await pedir('GET', 'canales?sucursal_id=2', 986)).datos.length, 2);
  for (const invalido of [{ ...datosCanal(), proveedor: 'simulado' }, { ...datosCanal(), identificador_externo: '' },
    { ...datosCanal(), sucursal_id: null }, { ...datosCanal(), nombre: '' }]) {
    assert.equal((await pedir('POST', 'canales', 983, invalido)).status, 400);
  }
});

test('resumen cuenta crudos, errores seguros, sin canal, origen y claves de medios sin valores', async () => {
  const { crearContextoBandeja } = require('./bandeja/mensajes');
  const { crearProcesadorGupshup } = require('./bandeja/gupshupProcesador');
  const ctx = crearContextoBandeja({ sqlite, DB: app.DB });
  const procesador = crearProcesadorGupshup({ sqlite, DB: app.DB, ctx, guardar: () => {}, mantenimiento: { estaActivo: () => false } });
  await pedir('POST', 'canales', 983, datosCanal());
  const insertar = sqlite.prepare(`INSERT INTO lead_eventos_externos
    (proveedor, identificador_evento_externo, tipo, recibido_en, payload_json, error_procesamiento) VALUES ('gupshup', ?, ?, ?, ?, ?)`);
  const fecha = new Date().toISOString();
  const medio = { id: 'ARCHIVO_PRIVADO', url: 'https://externo?key=SECRETO', mime_type: 'image/jpeg', caption: 'TEXTO_PRIVADO' };
  const mensaje = { id: 'foto', from: '529191112233', timestamp: '1775627842', type: 'image', image: medio };
  const cuerpo = (field, value, numero = datosCanal().identificador_externo) => JSON.stringify({ entry: [{ changes: [
    { field, value: { metadata: { phone_number_id: numero }, ...value } },
  ] }] });
  insertar.run('sha256:foto', 'messages', fecha, cuerpo('messages', { messages: [mensaje] }), null);
  insertar.run('sha256:eco', 'smb_message_echoes', fecha,
    cuerpo('smb_message_echoes', { message_echoes: [{ ...mensaje, id: 'eco', from: 'tienda', to: '529191112233', image: { id: 'otro' } }] }), null);
  insertar.run('sha256:historia', 'history', fecha,
    cuerpo('history', { history: [{ threads: [{ id: '529191112233', messages: [{ ...mensaje, id: 'historia' }] }] }] }), null);
  insertar.run('sha256:sin-canal', 'messages', fecha, cuerpo('messages', { messages: [mensaje] }, 'ausente'), null);
  insertar.run('sha256:rechazado', 'history', fecha, cuerpo('history', { history: [{ errors: [{ code: 2593109 }] }] }), null);
  for (let n = 0; n < 6; n++) insertar.run(`sha256:error${n}`, 'no_json', fecha, '{', n === 5 ? 'https://x?key=SECRETO' : 'json_invalido');
  await procesador.procesarPendientes();
  const r = (await pedir('GET', 'gupshup/resumen', 983)).datos;
  assert.equal(r.procesados, 4);
  assert.equal(r.con_error, 6);
  assert.equal(r.errores_recientes.length, 5);
  assert.equal(r.errores_recientes[0].motivo, 'error_interno');
  assert.equal(r.pendientes_sin_canal, 1);
  assert.equal(r.historial_rechazado, 1);
  assert.deepEqual(r.interacciones_por_tipo, [
    { tipo: 'mensaje', mensajes: 1 }, { tipo: 'mensaje_historial', mensajes: 1 }, { tipo: 'mensaje_telefono', mensajes: 1 },
  ]);
  assert.equal(r.por_tipo.reduce((n, fila) => n + fila.eventos, 0), 11, 'no cuenta hijos wamid');
  assert.deepEqual(r.medios, { total: 4, con_url: 3, claves: ['caption', 'id', 'mime_type', 'url'] });
  for (const privado of ['SECRETO', 'https:', 'ARCHIVO_PRIVADO', 'TEXTO_PRIVADO']) assert.ok(!JSON.stringify(r).includes(privado));
});

test('resumen exige conectar_canales_mensajes y sin sesion devuelve 401', async () => {
  assert.equal((await pedir('GET', 'gupshup/resumen', 981)).status, 403);
  assert.equal((await pedir('GET', 'gupshup/resumen', null)).status, 401);
  const r = await pedir('GET', 'gupshup/resumen', 983);
  assert.equal(r.status, 200);
  assert.deepEqual(r.datos.por_tipo, []);
  assert.equal(r.datos.primera, null);
  assert.equal(r.datos.ultima, null);
  assert.equal(r.datos.sin_procesar, 0);
  assert.equal(r.datos.bytes, 0);
});

test('resumen con bandeja no disponible responde 503', async t => {
  const express = require('express');
  const { registrarRutasBandeja } = require('./bandejaRutas');
  const local = express();
  registrarRutasBandeja(local, { DB: {}, bandeja: null, disponible: () => false,
    requiereLogin: (_req, _res, next) => next(), requierePermiso: () => (_req, _res, next) => next() });
  const s = await new Promise(resolve => { const server = local.listen(0, '127.0.0.1', () => resolve(server)); });
  t.after(async () => { s.closeAllConnections(); await new Promise(resolve => s.close(resolve)); });
  const r = await fetch(`http://127.0.0.1:${s.address().port}/api/mensajes/gupshup/resumen`);
  assert.equal(r.status, 503);
});

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

test("la pantalla Clientes deja rastro: estado viejo y edición de responsable", async () => {
  const rol = app.DB.admin.roles.find(r => r.id === 983);
  rol.permisos.push("cambiar_estado_cliente", "editar_cliente");
  const h = { "Content-Type": "application/json", Authorization: `Bearer ${tokens[983]}` };
  let res = await fetch(`${base}/api/crm/clientes/11/estado`, { method: "PUT", headers: h, body: JSON.stringify({ estado: "interesado" }) });
  assert.equal(res.status, 200);
  assert.deepEqual(app.DB.crm.estados_historial.map(e => [e.cliente_id, e.nuevo, e.usuario_id]), [[11, "interesado", 983]]);
  res = await fetch(`${base}/api/clientes/11`, { method: "PUT", headers: h, body: JSON.stringify({ vendedor_asignado_id: 2 }) });
  assert.equal(res.status, 200);
  const historial = (await pedir("GET", "clientes/11/historial", 983)).datos;
  assert.equal(historial.responsables[0].vendedor_nombre, "Luis");
  assert.equal(historial.responsables[0].motivo, "Cambio en la ficha del cliente");
});
