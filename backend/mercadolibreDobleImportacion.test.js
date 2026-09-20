const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { importarOrdenComoVenta } = require("./mercadolibre");

function prepararDB() {
  const DB = construirDBPrueba();
  DB.pos.ventas = [];
  DB.pos.venta_detalle = [];
  DB.pos.cajas = [];
  DB.inventario.existencias.push({ producto_id: 1, sucursal_id: 5, cantidad_actual: 3 });
  DB.ml = {
    cuenta: {
      access_token: "token-de-prueba",
      expires_at: Date.now() + 300_000,
      user_id: 123,
    },
    publicaciones: [],
    ordenes_importadas: [],
  };
  return DB;
}

function ordenDePrueba(id, status = "paid") {
  return {
    id,
    status,
    date_created: "2026-09-12T12:00:00.000-06:00",
    total_amount: 12000,
    buyer: null,
    order_items: [
      {
        item: { id: "MLM-GUITARRA", seller_sku: "AB-001", title: "Guitarra" },
        quantity: 1,
        unit_price: 12000,
      },
    ],
  };
}

function responderOrden(t, obtenerOrden, { retrasar = false } = {}) {
  const fetchOriginal = global.fetch;
  let llamadas = 0;
  let respuestasLeidas = 0;
  let liberarRespuestas;
  const respuestasSolapadas = new Promise((resolve) => {
    liberarRespuestas = resolve;
  });

  global.fetch = async () => {
    llamadas += 1;
    const numeroDeLlamada = llamadas;
    await Promise.resolve();
    return {
      ok: true,
      json: async () => {
        if (retrasar) {
          respuestasLeidas += 1;
          if (respuestasLeidas === 2) liberarRespuestas();
          await Promise.race([
            respuestasSolapadas,
            new Promise((resolve) => setTimeout(resolve, 20)),
          ]);
        }
        return obtenerOrden(numeroDeLlamada);
      },
    };
  };
  t.after(() => {
    global.fetch = fetchOriginal;
  });
}

test("dos importaciones simultáneas de la misma orden crean una sola venta", async (t) => {
  const DB = prepararDB();
  responderOrden(t, () => ordenDePrueba(8101), { retrasar: true });

  const resultados = await Promise.allSettled([
    importarOrdenComoVenta(DB, "8101"),
    importarOrdenComoVenta(DB, "8101"),
  ]);

  assert.strictEqual(DB.pos.ventas.length, 1, `se crearon ${DB.pos.ventas.length} ventas`);
  assert.strictEqual(resultados.filter((r) => r.status === "fulfilled").length, 1);
  assert.strictEqual(resultados.filter((r) => r.status === "rejected").length, 1);
  assert.strictEqual(
    resultados.find((r) => r.status === "rejected").reason.message,
    "Esta orden ya fue importada"
  );
  assert.strictEqual(DB.inventario.existencias.find((e) => e.producto_id === 1 && e.sucursal_id === 5).cantidad_actual, 2);
  assert.deepStrictEqual(DB.ml.ordenes_importadas, ["8101"]);
});

test("un intento posterior a una importación exitosa sigue rechazado", async (t) => {
  const DB = prepararDB();
  responderOrden(t, () => ordenDePrueba(8102));

  await importarOrdenComoVenta(DB, "8102");
  await assert.rejects(importarOrdenComoVenta(DB, "8102"), /ya fue importada/);

  assert.strictEqual(DB.pos.ventas.length, 1);
  assert.strictEqual(DB.inventario.existencias.find((e) => e.producto_id === 1 && e.sucursal_id === 5).cantidad_actual, 2);
  assert.deepStrictEqual(DB.ml.ordenes_importadas, ["8102"]);
});

test("una importación fallida libera la orden para reintentarla", async (t) => {
  const DB = prepararDB();
  let estado = "pending";
  responderOrden(t, () => ordenDePrueba(8103, estado));

  await assert.rejects(importarOrdenComoVenta(DB, "8103"), /no está pagada/);
  estado = "paid";
  const venta = await importarOrdenComoVenta(DB, "8103");

  assert.strictEqual(venta.referencia, "ML-8103");
  assert.strictEqual(DB.pos.ventas.length, 1);
  assert.strictEqual(DB.inventario.existencias.find((e) => e.producto_id === 1 && e.sucursal_id === 5).cantidad_actual, 2);
  assert.deepStrictEqual(DB.ml.ordenes_importadas, ["8103"]);
});
