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

test("el precio sale del catalogo, no del cuerpo de la peticion", () => {
  const DB = prepararDB();
  const catalogo = DB["catalogo-productos"].productos.find((p) => p.id === 3).precio_venta;
  const a = crearApartado(DB, { cliente_id: 1, anticipo_monto: 1, anticipo_forma_pago: "EFECTIVO",
    lineas: [{ producto_id: 3, cantidad: 1, precio_unitario: 1 }] }, 1, { nombre: "Ana" });
  assert.equal(a.total, catalogo, "el $1 que mando el navegador se ignora");
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
  assert.throws(() => crearApartado(DB, { cliente_id: 1, anticipo_monto: 9999,
    anticipo_forma_pago: "EFECTIVO", lineas: [{ producto_id: 3, cantidad: 1, precio_unitario: 9999 }] },
    1, { nombre: "Ana" }), /anticipo/i);
});
