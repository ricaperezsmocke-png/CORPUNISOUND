const { test } = require("node:test");
const assert = require("node:assert/strict");
const { prepararBandeja, canalWhatsApp, entrante } = require("./bandejaTestHelpers");

const ana = { id: 5, nombre: "Ana", celular: "9191112233", sucursal_id: 1, vendedor_asignado_id: 1, estado: "contactado" };

test("WhatsApp de un cliente conocido se pega a su ficha, cambia su estado y deja contacto", t => {
  const { ctx, DB } = prepararBandeja(t, { clientes: [ana] });
  const canal = canalWhatsApp(ctx);
  const r = ctx.recibirEntrante(entrante(canal, { id_externo: "5219191112233", nombre: "Ana P" }));
  assert.equal(r.duplicado, false);
  assert.equal(r.cliente_id, 5);
  assert.equal(DB.crm.clientes.find(c => c.id === 5).estado, "interesado");
  assert.equal(DB.crm.contactos_cliente.length, 1);
  assert.equal(DB.crm.contactos_cliente[0].tipo, "whatsapp");
  const hilo = ctx.hilo(r.conversacion_id);
  assert.deepEqual(hilo.map(m => [m.direccion, m.texto]), [["entrante", "Hola, ¿tienen guitarras?"]]);
});

test("el mismo evento dos veces es un solo mensaje", t => {
  const { ctx, sqlite } = prepararBandeja(t, { clientes: [ana] });
  const canal = canalWhatsApp(ctx);
  const evento = entrante(canal, { id_externo: "529191112233" });
  ctx.recibirEntrante(evento);
  assert.equal(ctx.recibirEntrante(evento).duplicado, true);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM lead_interacciones").get().n, 1);
});

test("número desconocido crea el cliente en la tienda del canal sin responsable", t => {
  const { ctx, DB } = prepararBandeja(t);
  const canal = canalWhatsApp(ctx, 2, "529190000002");
  const r = ctx.recibirEntrante(entrante(canal, { id_externo: "529197776655", nombre: "Pedro" }));
  const nuevo = DB.crm.clientes.find(c => c.id === r.cliente_id);
  assert.equal(nuevo.nombre, "Pedro");
  assert.equal(nuevo.celular, "9197776655");
  assert.equal(nuevo.sucursal_id, 2);
  assert.equal(nuevo.vendedor_asignado_id, null);
  assert.equal(nuevo.origen, "whatsapp");
  assert.equal(nuevo.estado, "interesado");
});

test("sin nombre usa uno legible con los últimos dígitos", t => {
  const { ctx, DB } = prepararBandeja(t);
  const r = ctx.recibirEntrante(entrante(canalWhatsApp(ctx), { id_externo: "529197776655" }));
  assert.equal(DB.crm.clientes.find(c => c.id === r.cliente_id).nombre, "WhatsApp 6655");
});

test("dos clientes con el mismo teléfono: queda por identificar, sin crear otro", t => {
  const { ctx, DB } = prepararBandeja(t, { clientes: [ana, { ...ana, id: 6, nombre: "Ana bis" }] });
  const r = ctx.recibirEntrante(entrante(canalWhatsApp(ctx), { id_externo: "529191112233" }));
  assert.equal(r.cliente_id, null);
  assert.equal(DB.crm.clientes.length, 3);
  assert.equal(ctx.porIdentificar({ verTodas: true }).length, 1);
});

test("Messenger sin teléfono queda por identificar", t => {
  const { ctx } = prepararBandeja(t);
  const canal = ctx.registrarCanal({ canal: "messenger", proveedor: "simulado", identificador_externo: "pagina-unisound",
    nombre: "Página Unisound", sucursal_id: 1 });
  const r = ctx.recibirEntrante(entrante(canal, { id_externo: "psid-77", nombre: "Mario" }));
  assert.equal(r.cliente_id, null);
});

test("el segundo mensaje del mismo número usa la misma conversación y el mismo cliente", t => {
  const { ctx, DB } = prepararBandeja(t);
  const canal = canalWhatsApp(ctx);
  const a = ctx.recibirEntrante(entrante(canal, { id_externo: "529197776655" }));
  const b = ctx.recibirEntrante(entrante(canal, { id_externo: "529197776655" }, "¿Y precio?"));
  assert.equal(a.conversacion_id, b.conversacion_id);
  assert.equal(DB.crm.clientes.length, 2);
  assert.equal(ctx.hilo(a.conversacion_id).length, 2);
});

test("texto inválido o canal inexistente se rechaza sin escribir nada", t => {
  const { ctx, sqlite } = prepararBandeja(t);
  const canal = canalWhatsApp(ctx);
  assert.throws(() => ctx.recibirEntrante(entrante(canal, { id_externo: "529197776655" }, "a�b")), { status: 400 });
  assert.throws(() => ctx.recibirEntrante(entrante(canal, { id_externo: "529197776655" }, "x".repeat(4097))), { status: 400 });
  assert.throws(() => ctx.recibirEntrante(entrante({ id: 999 }, { id_externo: "529197776655" })), { status: 404 });
  assert.equal(sqlite.prepare("SELECT count(*) n FROM lead_interacciones").get().n, 0);
});

test("responder: guarda el mensaje saliente con su usuario y marca contactado al cliente sin estado", t => {
  const { ctx, DB } = prepararBandeja(t, { clientes: [{ ...ana, estado: null }] });
  const canal = canalWhatsApp(ctx);
  const r = ctx.recibirEntrante(entrante(canal, { id_externo: "529191112233" }));
  DB.crm.clientes.find(c => c.id === 5).estado = null;
  const salida = ctx.enviarSaliente(r.conversacion_id, "Sí, tenemos", { usuario_id: 9 });
  assert.equal(salida.direccion, "saliente");
  assert.equal(salida.usuario_id, 9);
  assert.equal(DB.crm.clientes.find(c => c.id === 5).estado, "contactado");
  assert.throws(() => ctx.enviarSaliente(r.conversacion_id, "   ", { usuario_id: 9 }), { status: 400 });
});

test("ligar a mano una identidad por identificar la pega al cliente y le pasa sus conversaciones", t => {
  const { ctx } = prepararBandeja(t, { clientes: [ana] });
  const canal = ctx.registrarCanal({ canal: "messenger", proveedor: "simulado", identificador_externo: "pagina", nombre: "Página", sucursal_id: 1 });
  const r = ctx.recibirEntrante(entrante(canal, { id_externo: "psid-1" }));
  const [pendiente] = ctx.porIdentificar({ verTodas: true });
  ctx.ligarIdentidad(pendiente.identidad_id, 5, { usuario_id: 9 });
  assert.equal(ctx.conversacion(r.conversacion_id).cliente_id, 5);
  assert.equal(ctx.porIdentificar({ verTodas: true }).length, 0);
});

test("si el cliente ligado ya no existe, el mensaje entra igual sin cliente", t => {
  const { ctx, DB } = prepararBandeja(t, { clientes: [ana] });
  const canal = canalWhatsApp(ctx);
  ctx.recibirEntrante(entrante(canal, { id_externo: "529191112233" }));
  DB.crm.clientes = DB.crm.clientes.filter(c => c.id !== 5);
  const r = ctx.recibirEntrante(entrante(canal, { id_externo: "529191112233" }, "sigo aquí"));
  assert.equal(r.cliente_id, null);
  assert.equal(ctx.hilo(r.conversacion_id).length, 2);
});
