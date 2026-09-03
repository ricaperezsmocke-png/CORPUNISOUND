const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { sembrarCajas } = require("./cajas");
const { calcularCorteEnCurso } = require("./cortes");
const { fechaLocal } = require("./fechas");
const { importarOrdenComoVenta } = require("./mercadolibre");

function prepararDB({ conCajas = true } = {}) {
  const DB = construirDBPrueba();
  DB.pos.ventas = [];
  DB.pos.venta_detalle = [];
  DB.pos.cortes_caja = [];
  DB.pos.apartado_abonos = [];
  DB.pos.cajas = [];
  DB.gastos.gastos = [];
  DB.ml = {
    cuenta: {
      access_token: "token-de-prueba",
      expires_at: Date.now() + 300_000,
      user_id: 123,
    },
    publicaciones: [],
    ordenes_importadas: [],
  };
  if (conCajas) sembrarCajas(DB);
  return DB;
}

function ordenDePrueba(id, dateCreated) {
  return {
    id,
    date_created: dateCreated,
    total_amount: 375,
    buyer: null,
    order_items: [
      {
        item: { id: "MLM-1", seller_sku: "AB-001", title: "Arroz 1kg" },
        quantity: 3,
        unit_price: 125,
      },
    ],
  };
}

function responderOrden(t, orden) {
  const fetchOriginal = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => orden });
  t.after(() => {
    global.fetch = fetchOriginal;
  });
}

test("una venta importada entra al turno abierto de la caja ML como transferencia", async (t) => {
  const DB = prepararDB();
  const caja = DB.pos.cajas.find((c) => c.sucursal_id === 5 && c.predeterminada);
  const fechaOrden = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const frontera = new Date(Date.now() - 60_000).toISOString();
  DB.pos.corte_epoca = frontera;
  DB.pos.cortes_caja.push({
    id: 90,
    sucursal_id: 5,
    caja_id: caja.id,
    fecha_hora: frontera,
  });
  responderOrden(t, ordenDePrueba(7001, fechaOrden));

  const antesDeImportar = new Date().toISOString();
  const venta = await importarOrdenComoVenta(DB, 7001);
  const despuesDeImportar = new Date().toISOString();
  const corte = calcularCorteEnCurso(DB, 5, caja.id);

  assert.strictEqual(venta.fecha, fechaLocal(fechaOrden));
  assert.notStrictEqual(venta.fecha, fechaLocal());
  assert.ok(venta.fecha_hora >= antesDeImportar && venta.fecha_hora <= despuesDeImportar);
  assert.strictEqual(venta.caja_id, caja.id);
  // "Ticket" y no un valor propio: los tipos de documento son una lista cerrada
  // que las pantallas usan para filtrar, y un valor fuera de ella dejaria estas
  // ventas invisibles en todos los filtros salvo "Todos". Lo unico que no puede
  // ser es "Apartado", que en el corte excluye el total para contar solo abonos.
  assert.strictEqual(venta.tipo_documento, "Ticket");
  assert.strictEqual(corte.ventas_incluidas, 1);
  assert.strictEqual(corte.calculado.EFECTIVO, 0);
  assert.strictEqual(corte.total_calculado, 0);
  assert.strictEqual(corte.transferencias, 375);
});

test("una importacion sin catalogo de cajas no se impide y guarda caja_id null", async (t) => {
  const DB = prepararDB({ conCajas: false });
  responderOrden(t, ordenDePrueba(7002, "2026-08-29T18:00:00.000-06:00"));

  const venta = await importarOrdenComoVenta(DB, 7002);

  assert.strictEqual(venta.caja_id, null);
});

test("una forma de pago desconocida sigue cayendo a efectivo", () => {
  const DB = prepararDB();
  const caja = DB.pos.cajas.find((c) => c.sucursal_id === 5 && c.predeterminada);
  DB.pos.ventas.push({
    id: 1,
    fecha: fechaLocal(),
    fecha_hora: new Date().toISOString(),
    sucursal_id: 5,
    caja_id: caja.id,
    cliente_id: 0,
    tipo_documento: "Ticket",
    metodo_pago: "forma-no-analizada",
    total: 85,
    estatus: "cerrada",
  });

  const corte = calcularCorteEnCurso(DB, 5, caja.id);

  assert.strictEqual(corte.calculado.EFECTIVO, 85);
  assert.strictEqual(corte.transferencias, 0);
});
