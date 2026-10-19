const { test } = require("node:test");
const assert = require("node:assert/strict");
const { aplicarHechoNativo, revisarEstadosAutomaticos, cambiarEstadoNativo, DIAS_PARA_PERDIDO } = require("./bandeja/estados");

function base(estado = null, extra = {}) {
  return {
    crm: { clientes: [{ id: 0, nombre: "Público" }, { id: 5, nombre: "Ana", sucursal_id: 1, estado, ...extra }],
      contactos_cliente: [], estados_historial: [] },
    pos: { ventas: [] },
    radar_demanda: { registros: [] },
  };
}
const cliente = DB => DB.crm.clientes.find(c => c.id === 5);
const ISO = "2026-10-18T18:00:00.000Z";

test("mensaje saliente: sin estado pasa a contactado; un estado mayor no baja", () => {
  const DB = base();
  assert.equal(aplicarHechoNativo(DB, 5, "saliente", ISO).nuevo, "contactado");
  for (const estado of ["interesado", "visito_tienda", "compro", "perdido"]) {
    const otra = base(estado);
    assert.equal(aplicarHechoNativo(otra, 5, "saliente", ISO), null, estado);
    assert.equal(cliente(otra).estado, estado);
  }
});

test("mensaje entrante: sin estado, contactado o perdido pasan a interesado; los mayores se quedan", () => {
  for (const estado of [null, "contactado", "perdido"]) assert.equal(aplicarHechoNativo(base(estado), 5, "entrante", ISO).nuevo, "interesado");
  for (const estado of ["interesado", "visito_tienda", "compro"]) assert.equal(aplicarHechoNativo(base(estado), 5, "entrante", ISO), null);
});

test("cada cambio automático queda en el historial con actor sistema y motivo legible", () => {
  const DB = base("contactado");
  aplicarHechoNativo(DB, 5, "entrante", ISO);
  assert.deepEqual(DB.crm.estados_historial, [{ id: 1, cliente_id: 5, anterior: "contactado", nuevo: "interesado",
    usuario_id: null, motivo: "El cliente escribió", fecha_hora: ISO }]);
});

test("una cuenta interna nunca cambia sola", () => {
  const DB = base(null, { cuenta_interna: { motivo: "tienda" } });
  assert.equal(aplicarHechoNativo(DB, 5, "entrante", ISO), null);
  assert.equal(cliente(DB).estado, null);
});

test("revisión: venta cerrada desde el último cambio marca compró; apartado y Radar marcan en tienda", () => {
  const DB = base("interesado");
  DB.crm.estados_automaticos = { desde: "2026-10-01T00:00:00.000Z" };
  DB.pos.ventas.push({ id: 1, cliente_id: 5, estatus: "apartado", fecha: "2026-10-10" });
  revisarEstadosAutomaticos({ DB, ahora: ISO });
  assert.equal(cliente(DB).estado, "visito_tienda");
  DB.pos.ventas.push({ id: 2, cliente_id: 5, estatus: "cerrada", fecha: "2026-10-18" });
  revisarEstadosAutomaticos({ DB, ahora: ISO });
  assert.equal(cliente(DB).estado, "compro");
  assert.deepEqual(DB.crm.estados_historial.map(h => h.motivo), ["Apartado en tienda", "Compró en tienda"]);
  const radar = base("contactado");
  radar.crm.estados_automaticos = { desde: "2026-10-01T00:00:00.000Z" };
  radar.radar_demanda.registros.push({ id: 1, cliente_id: 5, fecha_registro: "2026-10-11T15:00:00.000Z" });
  revisarEstadosAutomaticos({ DB: radar, ahora: ISO });
  assert.equal(cliente(radar).estado, "visito_tienda");
});

test("revisión: compras anteriores a la activación no cuentan y la primera corrida anota la fecha", () => {
  const DB = base("interesado");
  DB.pos.ventas.push({ id: 1, cliente_id: 5, estatus: "cerrada", fecha: "2026-09-01" });
  revisarEstadosAutomaticos({ DB, ahora: ISO });
  assert.equal(DB.crm.estados_automaticos.desde, ISO);
  assert.equal(cliente(DB).estado, "interesado");
});

test("revisión: 30 días sin respuesta ni compra pasa a perdido; el día 29 sigue; compró nunca se pierde", () => {
  assert.equal(DIAS_PARA_PERDIDO, 30);
  const DB = base("interesado");
  DB.crm.estados_automaticos = { desde: "2026-01-01T00:00:00.000Z" };
  cambiarEstadoNativo(DB, 5, "interesado", { usuario_id: 3, motivo: "manual", fecha_hora: "2026-09-18T18:00:00.000Z" });
  revisarEstadosAutomaticos({ DB, ahora: "2026-10-17T18:00:00.000Z" });
  assert.equal(cliente(DB).estado, "interesado", "día 29");
  revisarEstadosAutomaticos({ DB, ahora: "2026-10-18T18:00:00.000Z" });
  assert.equal(cliente(DB).estado, "perdido", "día 30");
  assert.equal(DB.crm.estados_historial.at(-1).motivo, "30 días sin respuesta ni compra");
  const compro = base("compro");
  compro.crm.estados_automaticos = { desde: "2026-01-01T00:00:00.000Z" };
  revisarEstadosAutomaticos({ DB: compro, ahora: "2027-01-01T00:00:00.000Z" });
  assert.equal(cliente(compro).estado, "compro");
});

test("revisión: un contacto o mensaje entrante reciente reinicia los 30 días", () => {
  const DB = base("contactado");
  DB.crm.estados_automaticos = { desde: "2026-01-01T00:00:00.000Z" };
  cambiarEstadoNativo(DB, 5, "contactado", { usuario_id: 3, motivo: "manual", fecha_hora: "2026-08-01T18:00:00.000Z" });
  DB.crm.contactos_cliente.push({ id: 1, cliente_id: 5, fecha: "2026-10-10", tipo: "llamada" });
  revisarEstadosAutomaticos({ DB, ahora: ISO });
  assert.equal(cliente(DB).estado, "contactado");
  const otro = base("interesado");
  otro.crm.estados_automaticos = { desde: "2026-01-01T00:00:00.000Z" };
  cambiarEstadoNativo(otro, 5, "interesado", { usuario_id: 3, motivo: "manual", fecha_hora: "2026-08-01T18:00:00.000Z" });
  revisarEstadosAutomaticos({ DB: otro, ahora: ISO, ultimaEntrada: () => "2026-10-15T10:00:00.000Z" });
  assert.equal(cliente(otro).estado, "interesado");
});

test("revisión: los 30 días empiezan a contar desde la activación, no desde antes", () => {
  const DB = base("interesado");
  revisarEstadosAutomaticos({ DB, ahora: ISO });
  revisarEstadosAutomaticos({ DB, ahora: "2026-11-16T18:00:00.000Z" });
  assert.equal(cliente(DB).estado, "interesado");
  revisarEstadosAutomaticos({ DB, ahora: "2026-11-17T18:00:00.000Z" });
  assert.equal(cliente(DB).estado, "perdido");
});

test("cambio manual queda en el historial con su usuario", () => {
  const DB = base();
  cambiarEstadoNativo(DB, 5, "interesado", { usuario_id: 3, motivo: null, fecha_hora: ISO });
  assert.equal(cliente(DB).estado, "interesado");
  assert.equal(DB.crm.estados_historial[0].usuario_id, 3);
});

test("apartado vigente frena el perdido; al liquidarse cuenta como compra en su fecha de liquidación", () => {
  const DB = base("interesado");
  DB.crm.estados_automaticos = { desde: "2026-10-01T00:00:00.000Z" };
  DB.pos.ventas.push({ id: 1, cliente_id: 5, estatus: "apartado", fecha: "2026-10-02" });
  revisarEstadosAutomaticos({ DB, ahora: "2026-10-02T20:00:00.000Z" });
  assert.equal(cliente(DB).estado, "visito_tienda");
  revisarEstadosAutomaticos({ DB, ahora: "2026-11-05T20:00:00.000Z" });
  assert.equal(cliente(DB).estado, "visito_tienda", "pagando su apartado no está perdido");
  Object.assign(DB.pos.ventas[0], { estatus: "cerrada", fecha_liquidacion: "2026-11-10" });
  revisarEstadosAutomaticos({ DB, ahora: "2026-11-10T20:00:00.000Z" });
  assert.equal(cliente(DB).estado, "compro");
});

test("un registro del Radar en la mañana del mismo día del último cambio sí cuenta", () => {
  const DB = base("interesado");
  DB.crm.estados_automaticos = { desde: "2026-10-18T14:00:00.000Z" };
  DB.radar_demanda.registros.push({ id: 1, cliente_id: 5, fecha_registro: "2026-10-18T16:00:00.000Z" });
  revisarEstadosAutomaticos({ DB, ahora: "2026-10-18T22:00:00.000Z" });
  assert.equal(cliente(DB).estado, "visito_tienda");
});
