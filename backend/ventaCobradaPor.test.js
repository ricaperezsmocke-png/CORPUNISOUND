/**
 * ventaCobradaPor.test.js — Cada venta guarda QUIÉN la cobró (auditoría de
 * permisos 2026-10, A3).
 *
 * Antes la venta tenía sucursal, caja, vendedor y cliente, pero ningún
 * usuario: ante un faltante o un uso de monedero, "¿quién la cobró?" no tenía
 * respuesta. El vendedor es un dato de comisión que la cajera elige, no quién
 * tocó la caja. Ahora sale del TOKEN, nunca del cuerpo.
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "venta-cobro-")), "datos.sqlite");
process.env.JWT_SECRET = process.env.JWT_SECRET || "secreto-de-pruebas";

const app = require("./server");
const { sembrarCuentas, construirDBPrueba } = require("./testHelpers");
const { firmarToken } = require("./auth");
const { importarOrdenComoVenta } = require("./mercadolibre");

const DB = app.DB;
let servidor = null, base = "", fetchOriginal = null;
let TK_CAJERA = "", TK_ADMIN = "";

before(async () => {
  sembrarCuentas(app, [
    { id: 71, rol_id: 1, sucursal_id: 1, nombre: "Victor" },
    { id: 73, rol_id: 3, sucursal_id: 1, nombre: "Cajera Ocosingo" },
  ]);
  TK_ADMIN = firmarToken({ id: 71, nombre: "Victor", rol_id: 1, sucursal_id: 1 });
  TK_CAJERA = firmarToken({ id: 73, nombre: "Cajera Ocosingo", rol_id: 3, sucursal_id: 1 });
  fetchOriginal = global.fetch;
  await new Promise((listo) => { servidor = app.listen(0, listo); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(async () => {
  global.fetch = fetchOriginal;
  if (servidor) await new Promise((listo) => servidor.close(listo));
});

async function pedir(metodo, ruta, { tk, body } = {}) {
  const r = await fetchOriginal(base + ruta, {
    method: metodo,
    headers: { "Content-Type": "application/json", ...(tk ? { Authorization: `Bearer ${tk}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const texto = await r.text();
  let json = null;
  try { json = JSON.parse(texto); } catch { /* texto */ }
  return { status: r.status, json };
}

test("por la ruta, la venta queda con el usuario del token aunque el cuerpo mande otro", async () => {
  const r = await pedir("POST", "/api/ventas", {
    tk: TK_CAJERA,
    body: {
      metodo_pago: "Efectivo", vendedor_id: 1,
      cobrada_por_id: 999, cobrada_por_nombre: "Otra persona",
      lineas: [{ producto_id: 1, descripcion: "Arroz 1kg", cantidad: 1, precio_unitario: 25 }],
    },
  });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  const venta = DB.pos.ventas.find((v) => v.id === r.json.id);
  assert.strictEqual(venta.cobrada_por_id, 73);
  assert.strictEqual(venta.cobrada_por_nombre, "Cajera Ocosingo");
});

test("importar una orden de ML por la ruta guarda quién la importó", async (t) => {
  DB.ml.cuenta = { access_token: "ml", user_id: 1, expires_at: Date.now() + 3600e3 };
  DB.inventario.existencias.push({ producto_id: 1, sucursal_id: 5, cantidad_actual: 5 });
  global.fetch = async (url, opciones) => {
    if (String(url).includes("api.mercadolibre.com/orders/")) {
      return new Response(JSON.stringify({
        id: 55001, status: "paid", date_created: "2026-10-20T10:00:00.000-06:00", total_amount: 25, buyer: null,
        order_items: [{ item: { id: "MLM-1", seller_sku: "AB-001", title: "Arroz 1kg" }, quantity: 1, unit_price: 25 }],
      }));
    }
    return fetchOriginal(url, opciones);
  };
  t.after(() => { global.fetch = fetchOriginal; });
  const r = await pedir("POST", "/api/ml/ordenes/55001/importar", { tk: TK_ADMIN });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  const venta = DB.pos.ventas.find((v) => v.id === r.json.id);
  assert.strictEqual(venta.cobrada_por_id, 71);
  assert.strictEqual(venta.cobrada_por_nombre, "Victor");
});

test("una importación de ML sin usuario se firma como automática", async (t) => {
  const DBp = construirDBPrueba();
  DBp.ml = { cuenta: { access_token: "x", user_id: 1, expires_at: Date.now() + 3600e3 }, publicaciones: [], ordenes_importadas: [] };
  DBp.inventario.existencias.push({ producto_id: 1, sucursal_id: 5, cantidad_actual: 5 });
  const original = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      id: 55002, status: "paid", total_amount: 25, buyer: null,
      order_items: [{ item: { id: "MLM-1", seller_sku: "AB-001", title: "Arroz" }, quantity: 1, unit_price: 25 }],
    }),
  });
  t.after(() => { global.fetch = original; });
  const venta = await importarOrdenComoVenta(DBp, 55002);
  assert.strictEqual(venta.cobrada_por_id, null);
  assert.strictEqual(venta.cobrada_por_nombre, "MercadoLibre (automático)");
});
