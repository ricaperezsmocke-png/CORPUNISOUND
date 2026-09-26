const { test } = require("node:test");
const assert = require("node:assert/strict");
const { construirDBPrueba } = require("./testHelpers");
const { crearApartado } = require("./apartados");
const { sembrarCajas } = require("./cajas");

function prepararDB() {
  const DB = construirDBPrueba();
  DB.pos.ventas = [];
  DB.pos.venta_detalle = [];
  DB.pos.apartado_abonos = [];
  DB.pos.cortes_caja = [];
  DB.pos.cajas = [];
  DB.pos.corte_epoca = "2026-01-01T00:00:00.000Z";
  sembrarCajas(DB);
  return DB;
}

test("rechaza que el navegador baje el precio de catálogo sin crear apartado, abono ni reserva", () => {
  const DB = prepararDB();
  const inventarioAntes = structuredClone(DB.inventario);
  const clientesAntes = structuredClone(DB.crm.clientes);
  assert.throws(() => crearApartado(DB, { cliente_id: 1, anticipo_monto: 1, anticipo_forma_pago: "EFECTIVO",
    lineas: [{ producto_id: 3, cantidad: 1, precio_unitario: 1 }] }, 1, { nombre: "Ana" }),
  /precio.*no coincide con el catálogo.*Recarga/i);
  assert.deepEqual(DB.pos.ventas, []);
  assert.deepEqual(DB.pos.venta_detalle, []);
  assert.deepEqual(DB.pos.apartado_abonos, []);
  assert.deepEqual(DB.inventario, inventarioAntes);
  assert.deepEqual(DB.crm.clientes, clientesAntes);
});

test("sin permiso de descuento, el descuento que llega se ignora", () => {
  const DB = prepararDB();
  const catalogo = DB["catalogo-productos"].productos.find((p) => p.id === 3).precio_venta;
  const a = crearApartado(DB, { cliente_id: 1, anticipo_monto: 1, anticipo_forma_pago: "EFECTIVO",
    lineas: [{ producto_id: 3, cantidad: 1, precio_unitario: catalogo, descuento_pct: 90 }] },
    1, { nombre: "Ana" }, null, { permisos: [] });
  assert.equal(a.total, catalogo);
});

test("CON permiso de descuento si se aplica: no se le quita la herramienta a quien la tiene", () => {
  const DB = prepararDB();
  const catalogo = DB["catalogo-productos"].productos.find((p) => p.id === 3).precio_venta;
  const a = crearApartado(DB, { cliente_id: 1, anticipo_monto: 1, anticipo_forma_pago: "EFECTIVO",
    lineas: [{ producto_id: 3, cantidad: 1, precio_unitario: catalogo, descuento_pct: 50 }] },
    1, { nombre: "Ana" }, null, { permisos: ["aplicar_descuentos_articulos_venta"] });
  assert.equal(a.total, catalogo / 2);
});

test("una cantidad negativa en un apartado tambien se rechaza", () => {
  const DB = prepararDB();
  assert.throws(() => crearApartado(DB, { cliente_id: 1, anticipo_monto: 1,
    anticipo_forma_pago: "EFECTIVO", lineas: [{ producto_id: 3, cantidad: -5 }] },
    1, { nombre: "Ana" }), /cantidad/i);
});

test("el anticipo sigue sin poder superar el total recalculado", () => {
  const DB = prepararDB();
  const catalogo = DB["catalogo-productos"].productos.find((p) => p.id === 3).precio_venta;
  const inventarioAntes = structuredClone(DB.inventario);
  assert.throws(() => crearApartado(DB, { cliente_id: 1, anticipo_monto: 9999,
    anticipo_forma_pago: "EFECTIVO", lineas: [{ producto_id: 3, cantidad: 1, precio_unitario: catalogo }] },
    1, { nombre: "Ana" }), /anticipo/i);
  assert.deepEqual(DB.pos.ventas, []);
  assert.deepEqual(DB.pos.venta_detalle, []);
  assert.deepEqual(DB.pos.apartado_abonos, []);
  assert.deepEqual(DB.inventario, inventarioAntes);
});
