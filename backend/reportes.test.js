const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { reporteVentas } = require("./reportes");

const ALCANCE_TODAS = { verTodas: true, sucursalId: null };

test("reporteVentas: agrupa ventas vigentes y calcula totales", () => {
  const DB = construirDBPrueba();
  const r = reporteVentas(DB, { fecha_inicio: "2026-05-01", fecha_fin: "2026-06-30" }, ALCANCE_TODAS);

  assert.strictEqual(r.general.length, 3, "las 3 ventas semilla caen en el rango");
  assert.strictEqual(r.totales.numero_ventas, 3);
  assert.strictEqual(r.totales.total_vigente, 1200 + 800 + 2100);
  assert.strictEqual(r.totales.total_cancelado, 0);
});

test("reporteVentas: respeta el rango de fechas", () => {
  const DB = construirDBPrueba();
  const r = reporteVentas(DB, { fecha_inicio: "2026-06-01", fecha_fin: "2026-06-30" }, ALCANCE_TODAS);
  assert.strictEqual(r.general.length, 1, "solo la venta 3 (2026-06-05) cae en junio");
  assert.strictEqual(r.totales.total_vigente, 2100);
});

test("reporteVentas: separa canceladas y no las suma al total vigente", () => {
  const DB = construirDBPrueba();
  DB.pos.ventas[0].estatus = "cancelada";
  const r = reporteVentas(DB, { fecha_inicio: "2026-05-01", fecha_fin: "2026-06-30" }, ALCANCE_TODAS);
  assert.strictEqual(r.canceladas.length, 1);
  assert.strictEqual(r.totales.total_cancelado, 1200);
  assert.strictEqual(r.totales.total_vigente, 800 + 2100);
});

test("reporteVentas: agrupa por artículo sumando cantidad e importe", () => {
  const DB = construirDBPrueba();
  const r = reporteVentas(DB, { fecha_inicio: "2026-05-01", fecha_fin: "2026-06-30" }, ALCANCE_TODAS);
  const arroz = r.porArticulo.find((f) => f.producto === "Arroz 1kg");
  assert.ok(arroz, "debe aparecer Arroz 1kg (vendido en la venta 1)");
  assert.strictEqual(arroz.cantidad, 20);
  assert.strictEqual(arroz.importe, 500);
});

test("reporteVentas: agrupa por vendedor", () => {
  const DB = construirDBPrueba();
  const r = reporteVentas(DB, { fecha_inicio: "2026-05-01", fecha_fin: "2026-06-30" }, ALCANCE_TODAS);
  const ana = r.porVendedor.find((f) => f.vendedor === "Ana López");
  assert.ok(ana);
  assert.strictEqual(ana.numero_ventas, 1);
  assert.strictEqual(ana.total, 1200);
});

test("reporteVentas: respeta el alcance de sucursal", () => {
  const DB = construirDBPrueba();
  const alcanceSucursal1 = { verTodas: false, sucursalId: 1 };
  const r = reporteVentas(DB, { fecha_inicio: "2026-05-01", fecha_fin: "2026-06-30" }, alcanceSucursal1);
  assert.strictEqual(r.general.length, 1, "solo la venta de la sucursal 1");
  assert.strictEqual(r.general[0].id, 1);
});

test("reporteVentas: filtra por vendedor_id", () => {
  const DB = construirDBPrueba();
  const r = reporteVentas(DB, { fecha_inicio: "2026-05-01", fecha_fin: "2026-06-30", vendedor_id: 3 }, ALCANCE_TODAS);
  assert.strictEqual(r.general.length, 1);
  assert.strictEqual(r.general[0].vendedor_nombre, "María R.");
});

const { reporteUtilidad } = require("./reportes");

test("reporteUtilidad: calcula venta, costo y utilidad con el costo actual del producto", () => {
  const DB = construirDBPrueba();
  // producto 1: costo 20, la venta 1 vendió 20 unidades en $500 (venta_detalle id 1)
  const r = reporteUtilidad(DB, { fecha_inicio: "2026-05-01", fecha_fin: "2026-06-30" }, ALCANCE_TODAS);
  const arroz = r.porArticulo.find((f) => f.producto === "Arroz 1kg");
  assert.ok(arroz);
  assert.strictEqual(arroz.venta, 500);
  assert.strictEqual(arroz.costo, 20 * 20, "costo actual (20) por cantidad (20)");
  assert.strictEqual(arroz.utilidad, 500 - 400);
});

test("reporteUtilidad: agrupa por departamento, usa 'Sin departamento' si el producto no tiene uno", () => {
  const DB = construirDBPrueba();
  const r = reporteUtilidad(DB, { fecha_inicio: "2026-05-01", fecha_fin: "2026-06-30" }, ALCANCE_TODAS);
  const sinDepto = r.porDepartamento.find((f) => f.departamento === "Sin departamento");
  assert.ok(sinDepto, "los productos semilla no tienen departamento_id");
});

test("reporteUtilidad: agrupa por el departamento real cuando el producto lo tiene", () => {
  const DB = construirDBPrueba();
  DB["catalogo-productos"].departamentos.push({ id: 1, nombre: "Abarrotes" });
  DB["catalogo-productos"].productos.find((p) => p.id === 1).departamento_id = 1;
  const r = reporteUtilidad(DB, { fecha_inicio: "2026-05-01", fecha_fin: "2026-06-30" }, ALCANCE_TODAS);
  const abarrotes = r.porDepartamento.find((f) => f.departamento === "Abarrotes");
  assert.ok(abarrotes);
  assert.strictEqual(abarrotes.venta, 500);
});

test("reporteUtilidad: no incluye ventas canceladas", () => {
  const DB = construirDBPrueba();
  DB.pos.ventas[0].estatus = "cancelada";
  const r = reporteUtilidad(DB, { fecha_inicio: "2026-05-01", fecha_fin: "2026-06-30" }, ALCANCE_TODAS);
  const arroz = r.porArticulo.find((f) => f.producto === "Arroz 1kg");
  assert.strictEqual(arroz, undefined, "la única venta de arroz estaba cancelada");
});

test("reporteUtilidad: calcula el margen porcentual del total", () => {
  const DB = construirDBPrueba();
  const r = reporteUtilidad(DB, { fecha_inicio: "2026-05-01", fecha_fin: "2026-06-30" }, ALCANCE_TODAS);
  assert.strictEqual(r.totales.venta, 500 + 640 + 800);
  assert.strictEqual(r.totales.costo, 20 * 20 + 12 * 40 + 20 * 25);
  assert.ok(r.totales.margen_pct > 0);
});

const { reporteCompras } = require("./reportes");

function seedCompra(DB) {
  DB["catalogo-productos"].proveedores.push({ id: 1, nombre: "Proveedor Uno", rfc: "" });
  DB.inventario.compras.push({ id: 1, proveedor_id: 1, factura: "F-001", sucursal_id: 1, fecha: "2026-06-01T10:00:00.000Z" });
  DB.inventario.compra_detalle.push({ id: 1, compra_id: 1, producto_id: 1, cantidad: 10, costo: 18 });
}

test("reporteCompras: agrupa por proveedor y por artículo, con total", () => {
  const DB = construirDBPrueba();
  seedCompra(DB);
  const r = reporteCompras(DB, { fecha_inicio: "2026-05-01", fecha_fin: "2026-06-30" }, ALCANCE_TODAS);

  assert.strictEqual(r.general.length, 1);
  assert.strictEqual(r.general[0].total, 180);
  assert.strictEqual(r.porProveedor[0].proveedor, "Proveedor Uno");
  assert.strictEqual(r.porProveedor[0].total, 180);
  assert.strictEqual(r.porArticulo[0].producto, "Arroz 1kg");
  assert.strictEqual(r.porArticulo[0].cantidad, 10);
  assert.strictEqual(r.totales.total, 180);
  assert.strictEqual(r.totales.numero_compras, 1);
});

test("reporteCompras: filtra por proveedor_id", () => {
  const DB = construirDBPrueba();
  seedCompra(DB);
  DB["catalogo-productos"].proveedores.push({ id: 2, nombre: "Proveedor Dos", rfc: "" });
  DB.inventario.compras.push({ id: 2, proveedor_id: 2, factura: "F-002", sucursal_id: 1, fecha: "2026-06-02T10:00:00.000Z" });
  DB.inventario.compra_detalle.push({ id: 2, compra_id: 2, producto_id: 2, cantidad: 5, costo: 10 });

  const r = reporteCompras(DB, { fecha_inicio: "2026-05-01", fecha_fin: "2026-06-30", proveedor_id: 2 }, ALCANCE_TODAS);
  assert.strictEqual(r.general.length, 1);
  assert.strictEqual(r.general[0].proveedor_nombre, "Proveedor Dos");
});

test("reporteCompras: respeta el alcance de sucursal", () => {
  const DB = construirDBPrueba();
  seedCompra(DB);
  DB.inventario.compras.push({ id: 2, proveedor_id: 1, factura: "F-003", sucursal_id: 2, fecha: "2026-06-03T10:00:00.000Z" });
  DB.inventario.compra_detalle.push({ id: 2, compra_id: 2, producto_id: 1, cantidad: 3, costo: 18 });

  const r = reporteCompras(DB, { fecha_inicio: "2026-05-01", fecha_fin: "2026-06-30" }, { verTodas: false, sucursalId: 1 });
  assert.strictEqual(r.general.length, 1, "solo la compra de la sucursal 1");
});

const { reporteCortesCaja } = require("./reportes");

function seedCorte(DB) {
  DB.pos.cortes_caja.push({
    id: 1, sucursal_id: 1, usuario_nombre: "Ana López", fecha: "2026-06-10",
    total_calculado: 1000, total_contado: 980, total_diferencia: -20, total_retiro: 900,
  });
}

test("reporteCortesCaja: lista cortes en el rango y suma totales", () => {
  const DB = construirDBPrueba();
  seedCorte(DB);
  const r = reporteCortesCaja(DB, { fecha_inicio: "2026-06-01", fecha_fin: "2026-06-30" }, ALCANCE_TODAS);

  assert.strictEqual(r.filas.length, 1);
  assert.strictEqual(r.filas[0].sucursal_nombre, "Ocosingo");
  assert.strictEqual(r.totales.numero_cortes, 1);
  assert.strictEqual(r.totales.total_calculado, 1000);
  assert.strictEqual(r.totales.total_contado, 980);
  assert.strictEqual(r.totales.total_diferencia, -20);
  assert.strictEqual(r.totales.total_retiro, 900);
});

test("reporteCortesCaja: respeta el rango de fechas y el alcance de sucursal", () => {
  const DB = construirDBPrueba();
  seedCorte(DB);
  DB.pos.cortes_caja.push({
    id: 2, sucursal_id: 2, usuario_nombre: "María R.", fecha: "2026-06-15",
    total_calculado: 500, total_contado: 500, total_diferencia: 0, total_retiro: 400,
  });

  const fueraDeRango = reporteCortesCaja(DB, { fecha_inicio: "2026-07-01", fecha_fin: "2026-07-31" }, ALCANCE_TODAS);
  assert.strictEqual(fueraDeRango.filas.length, 0);

  const soloSucursal1 = reporteCortesCaja(DB, { fecha_inicio: "2026-06-01", fecha_fin: "2026-06-30" }, { verTodas: false, sucursalId: 1 });
  assert.strictEqual(soloSucursal1.filas.length, 1);
  assert.strictEqual(soloSucursal1.filas[0].sucursal_nombre, "Ocosingo");
});
