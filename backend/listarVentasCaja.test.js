const { test } = require("node:test");
const assert = require("node:assert");

const { listarVentas } = require("./ventas");
const { construirDBPrueba } = require("./testHelpers");
const { sembrarCajas } = require("./cajas");

test("listarVentas limita los resultados a la caja solicitada", () => {
  const DB = construirDBPrueba();
  DB.pos.cajas = sembrarCajas(DB);
  const unaCaja = DB.pos.cajas.find((c) => c.sucursal_id === 1 && !c.predeterminada);
  const otraCaja = DB.pos.cajas.find((c) => c.sucursal_id === 2 && !c.predeterminada);

  DB.pos.ventas = [
    { id: 10, fecha: "2026-09-01", sucursal_id: 1, caja_id: unaCaja.id, cliente_id: 0, vendedor_id: 1, estatus: "cerrada", total: 100 },
    { id: 11, fecha: "2026-09-01", sucursal_id: 1, caja_id: DB.pos.cajas.find((c) => c.sucursal_id === 1 && c.predeterminada).id, cliente_id: 0, vendedor_id: 1, estatus: "cerrada", total: 200 },
    { id: 12, fecha: "2026-09-01", sucursal_id: 2, caja_id: otraCaja.id, cliente_id: 0, vendedor_id: 1, estatus: "cerrada", total: 300 },
  ];

  const ventas = listarVentas(DB, { sucursal_id: 1, caja_id: unaCaja.id });

  assert.deepStrictEqual(ventas.map((venta) => venta.id), [10]);
});

/**
 * Una venta anterior a que existieran las cajas (`caja_id: null`) SI entra en el
 * corte de la Administrativa: esa es la regla de `esDeEstaCaja`, y es la que
 * mueve el dinero. Consultas de Ventas tiene que decir lo mismo.
 *
 * Si no, la cajera que investiga un faltante en la Administrativa filtra por
 * Administrativa, no ve NINGUNA de las ventas que el corte si le esta cobrando,
 * y concluye que el sistema le invento el faltante.
 */
test("una venta historica sin caja aparece bajo la caja predeterminada", () => {
  const DB = construirDBPrueba();
  DB.pos.cajas = sembrarCajas(DB);
  const administrativa = DB.pos.cajas.find((c) => c.sucursal_id === 1 && c.predeterminada);
  const fiscal = DB.pos.cajas.find((c) => c.sucursal_id === 1 && !c.predeterminada);

  DB.pos.ventas = [
    { id: 20, fecha: "2026-09-01", sucursal_id: 1, caja_id: null, cliente_id: 0, vendedor_id: 1, estatus: "cerrada", total: 100 },
    { id: 21, fecha: "2026-09-01", sucursal_id: 1, caja_id: fiscal.id, cliente_id: 0, vendedor_id: 1, estatus: "cerrada", total: 200 },
    { id: 22, fecha: "2026-09-01", sucursal_id: 1, caja_id: administrativa.id, cliente_id: 0, vendedor_id: 1, estatus: "cerrada", total: 300 },
  ];

  const enAdministrativa = listarVentas(DB, { sucursal_id: 1, caja_id: administrativa.id });
  assert.deepStrictEqual(enAdministrativa.map((v) => v.id).sort(), [20, 22]);

  const enFiscal = listarVentas(DB, { sucursal_id: 1, caja_id: fiscal.id });
  assert.deepStrictEqual(enFiscal.map((v) => v.id), [21]);
});
