const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { listarCategorias } = require("./gastosCategorias");
const { crearGasto, cancelarGasto } = require("./gastos");
const { reporteGastos } = require("./reportes");

const ALCANCE_TODAS = { verTodas: true, sucursalId: null };
const USUARIO = { nombre: "Victor" };

function driveFalso() {
  return {
    asegurarCarpetaGastosSucursal: async () => "carpeta-1",
    subirArchivoADrive: async () => ({ id: "file-1", webViewLink: "https://drive.google.com/x" }),
  };
}

function idHoja(DB, nombre) {
  return listarCategorias(DB, {}).find((c) => c.nombre === nombre).id;
}

async function gasto(DB, { sucursal = 1, categoria = "Combustible", monto = 100, forma_pago = "EFECTIVO" } = {}) {
  return crearGasto(DB, {
    categoria_id: idHoja(DB, categoria), concepto: categoria, monto, forma_pago,
    archivo: { nombre_archivo: "t.jpg", tipo_mime: "image/jpeg", contenido_base64: Buffer.from("x").toString("base64") },
  }, sucursal, USUARIO, driveFalso());
}

async function escenario() {
  const DB = construirDBPrueba();
  await gasto(DB, { sucursal: 1, categoria: "Combustible", monto: 300 });
  await gasto(DB, { sucursal: 1, categoria: "Luz", monto: 1200, forma_pago: "TRANSFERENCIA" });
  await gasto(DB, { sucursal: 2, categoria: "Combustible", monto: 200 });
  return DB;
}

test("reporteGastos: totales y agrupaciones", async () => {
  const DB = await escenario();
  const r = reporteGastos(DB, {}, ALCANCE_TODAS);

  assert.strictEqual(r.totales.numero_gastos, 3);
  assert.strictEqual(r.totales.total, 1700);

  const combustible = r.porCategoria.find((f) => f.categoria === "Combustible");
  assert.strictEqual(combustible.total, 500);
  assert.strictEqual(combustible.numero_gastos, 2);
  assert.strictEqual(combustible.grupo, "Operación");

  assert.deepStrictEqual(r.porSucursal.map((f) => f.sucursal), ["Ocosingo", "Yajalón"]);
  assert.strictEqual(r.porSucursal[0].total, 1500);

  const efectivo = r.porFormaPago.find((f) => f.forma_pago === "EFECTIVO");
  assert.strictEqual(efectivo.total, 500);
});

test("reporteGastos: por defecto solo cuenta los activos, y reporta el cancelado aparte", async () => {
  const DB = await escenario();
  cancelarGasto(DB, 1, "Duplicado", USUARIO, ALCANCE_TODAS);

  const r = reporteGastos(DB, {}, ALCANCE_TODAS);

  assert.strictEqual(r.totales.numero_gastos, 2, "el cancelado sale del conteo vigente");
  assert.strictEqual(r.totales.total, 1400, "1700 menos los 300 cancelados");
  assert.strictEqual(r.totales.numero_cancelados, 1);
  assert.strictEqual(r.totales.total_cancelado, 300, "nunca sumado al total vigente");
  assert.ok(!r.general.some((g) => g.estatus === "cancelado"), "no aparecen en la lista por defecto");
});

test("reporteGastos: estatus 'todos' incluye los cancelados en la lista", async () => {
  const DB = await escenario();
  cancelarGasto(DB, 1, "Duplicado", USUARIO, ALCANCE_TODAS);

  const r = reporteGastos(DB, { estatus: "todos" }, ALCANCE_TODAS);
  assert.strictEqual(r.general.length, 3);
  assert.strictEqual(r.totales.total, 1400, "el total vigente NO cambia aunque se muestren");
});

test("reporteGastos: filtra por categoría y por forma de pago", async () => {
  const DB = await escenario();

  const porCat = reporteGastos(DB, { categoria_id: idHoja(DB, "Luz") }, ALCANCE_TODAS);
  assert.strictEqual(porCat.totales.total, 1200);

  const porForma = reporteGastos(DB, { forma_pago: "EFECTIVO" }, ALCANCE_TODAS);
  assert.strictEqual(porForma.totales.total, 500);
});

test("reporteGastos: un usuario amarrado solo ve su sucursal", async () => {
  const DB = await escenario();
  const r = reporteGastos(DB, {}, { verTodas: false, sucursalId: 2 });

  assert.strictEqual(r.totales.total, 200);
  assert.deepStrictEqual(r.porSucursal.map((f) => f.sucursal), ["Yajalón"]);
});

test("reporteGastos: sin gastos regresa estructura vacía en ceros", () => {
  const DB = construirDBPrueba();
  const r = reporteGastos(DB, {}, ALCANCE_TODAS);
  assert.deepStrictEqual(r.general, []);
  assert.deepStrictEqual(r.porCategoria, []);
  assert.strictEqual(r.totales.total, 0);
  assert.strictEqual(r.totales.total_cancelado, 0);
});
