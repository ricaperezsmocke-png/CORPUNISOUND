const { test } = require("node:test");
const assert = require("node:assert/strict");
const { prepararBandeja, canalWhatsApp, entrante } = require("./bandejaTestHelpers");
const { crearResponsables } = require("./bandeja/responsable");
const { desactivarVendedor } = require("./vendedores");

const cliente = (id, extra = {}) => ({ id, nombre: `Cliente ${id}`, celular: `91911100${String(id).padStart(2, "0")}`,
  sucursal_id: 1, vendedor_asignado_id: null, estado: null, ...extra });

function preparar(t, clientes) {
  const b = prepararBandeja(t, { clientes });
  return { ...b, resp: crearResponsables(b.ctx) };
}
const asignaciones = (sqlite, clienteId) => sqlite.prepare(`SELECT a.vendedor_asignado_id, a.motivo, a.asignada_por_usuario_id
  FROM lead_asignaciones a JOIN leads l ON l.id = a.lead_id WHERE l.cliente_id = ? ORDER BY a.id`).all(clienteId);

test("tomar un cliente sin responsable lo deja con el vendedor y con asignación registrada", t => {
  const { resp, DB, sqlite } = preparar(t, [cliente(5)]);
  resp.tomar(5, { vendedor_id: 1, usuario_id: 9 });
  assert.equal(DB.crm.clientes.find(c => c.id === 5).vendedor_asignado_id, 1);
  assert.deepEqual(asignaciones(sqlite, 5), [{ vendedor_asignado_id: 1, motivo: "Tomó la conversación", asignada_por_usuario_id: 9 }]);
  assert.throws(() => resp.tomar(5, { vendedor_id: 2, usuario_id: 9 }), { status: 409 });
});

test("reasignar exige motivo y un vendedor activo de la misma tienda", t => {
  const { resp, DB, sqlite } = preparar(t, [cliente(5, { vendedor_asignado_id: 1 })]);
  assert.throws(() => resp.reasignar(5, { vendedor_id: 2, motivo: " ", usuario_id: 9 }), { status: 400 });
  assert.throws(() => resp.reasignar(5, { vendedor_id: 3, motivo: "otra tienda", usuario_id: 9 }), { status: 400 });
  DB.pos.vendedores.find(v => v.id === 2).activo = false;
  assert.throws(() => resp.reasignar(5, { vendedor_id: 2, motivo: "cubre", usuario_id: 9 }), { status: 400 });
  DB.pos.vendedores.find(v => v.id === 2).activo = true;
  resp.reasignar(5, { vendedor_id: "2", motivo: "Vero de vacaciones", usuario_id: 9 });
  assert.equal(DB.crm.clientes.find(c => c.id === 5).vendedor_asignado_id, 2);
  assert.deepEqual(asignaciones(sqlite, 5).map(a => [a.vendedor_asignado_id, a.motivo]), [[1, "Asignación previa"], [2, "Vero de vacaciones"]]);
});

test("traspaso de cartera mueve a todos los clientes del vendedor con su motivo, también a los sin conversación", t => {
  const { resp, DB, ctx, sqlite } = preparar(t, [cliente(5, { vendedor_asignado_id: 1 }), cliente(6, { vendedor_asignado_id: 1 }),
    cliente(7, { vendedor_asignado_id: 2 })]);
  ctx.recibirEntrante(entrante(canalWhatsApp(ctx), { id_externo: "529191110005" }));
  const r = resp.traspasarCartera({ de_vendedor_id: 1, a_vendedor_id: 2, motivo: "Vero dejó la empresa", usuario_id: 9 });
  assert.equal(r.movidos, 2);
  assert.deepEqual(DB.crm.clientes.filter(c => c.id > 0).map(c => c.vendedor_asignado_id), [2, 2, 2]);
  assert.equal(asignaciones(sqlite, 6).at(-1).motivo, "Vero dejó la empresa");
  assert.throws(() => resp.traspasarCartera({ de_vendedor_id: 1, a_vendedor_id: 3, motivo: "otra tienda", usuario_id: 9 }), { status: 400 });
  assert.throws(() => resp.traspasarCartera({ de_vendedor_id: 2, a_vendedor_id: 2, motivo: "mismo vendedor", usuario_id: 9 }), { status: 400 });
});

test("si guardar falla, ni el JSON ni SQLite quedan a medias", t => {
  const { DB, sqlite, ctx } = prepararBandeja(t, { clientes: [cliente(5, { vendedor_asignado_id: 1 })] });
  const { crearContextoBandeja } = require("./bandeja/mensajes");
  const roto = crearContextoBandeja({ sqlite: ctx.sqlite, DB, guardar: () => { throw new Error("disco lleno"); } });
  assert.throws(() => crearResponsables(roto).reasignar(5, { vendedor_id: 2, motivo: "cubre turno", usuario_id: 9 }), /disco lleno/);
  assert.equal(DB.crm.clientes.find(c => c.id === 5).vendedor_asignado_id, 1);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM lead_asignaciones").get().n, 0);
});

test("no se puede desactivar un vendedor que todavía tiene clientes", t => {
  const { DB } = prepararBandeja(t, { clientes: [cliente(5, { vendedor_asignado_id: 1 }), cliente(6, { vendedor_asignado_id: 1 })] });
  assert.throws(() => desactivarVendedor(DB, 1, { verTodas: true }), /2 clientes/);
  DB.crm.clientes.forEach(c => { if (c.vendedor_asignado_id === 1) c.vendedor_asignado_id = 2; });
  assert.equal(desactivarVendedor(DB, 1, { verTodas: true }).activo, false);
});
