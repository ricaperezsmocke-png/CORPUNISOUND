const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { exigirCantidad, exigirPiezasEnteras } = require("./importes");
const { crearVenta } = require("./ventas");
const { crearApartado } = require("./apartados");
const { crearTraspaso } = require("./traspasos");
const { crearRecepcion } = require("./compras");
const { crearProducto } = require("./productos");

// Decisión de Victor (2026-09-25): todo se vende y se mueve en PIEZAS ENTERAS.
// Un 0.5 tecleado en un bafle cobraba medio bafle y dejaba 2.5 piezas en
// existencia: una cuenta que ninguna bodega puede cuadrar.

const USUARIO = { id: 1, nombre: "Gerente Ocosingo" };
const existencia = (DB, productoId, sucursalId) =>
  DB.inventario.existencias.find((e) => e.producto_id === productoId && e.sucursal_id === sucursalId)?.cantidad_actual;

test("exigirCantidad rechaza fracciones y acepta enteros (también como texto)", () => {
  for (const malo of [1.5, 0.5, "2.25", 2.0000001]) {
    assert.throws(() => exigirCantidad(malo, "Bafle"), /piezas enteras/, `aceptó ${malo}`);
  }
  assert.strictEqual(exigirCantidad(2, "Bafle"), 2);
  assert.strictEqual(exigirCantidad("3", "Bafle"), 3);
  assert.strictEqual(exigirCantidad("4.0", "Bafle"), 4);
});

test("exigirPiezasEnteras acepta negativos enteros solo si se permite (ajuste manual)", () => {
  assert.strictEqual(exigirPiezasEnteras(-3, "Bafle", { permitirNegativo: true }), -3);
  assert.throws(() => exigirPiezasEnteras(-1.5, "Bafle", { permitirNegativo: true }), /piezas enteras/);
  assert.throws(() => exigirPiezasEnteras(0, "Bafle", { permitirNegativo: true }), /distinta de cero/);
  assert.throws(() => exigirPiezasEnteras(-3, "Bafle"), /mayor que cero/);
  assert.throws(() => exigirPiezasEnteras("abc", "Bafle", { permitirNegativo: true }));
});

test("una venta de 1.5 piezas se rechaza y no mueve la existencia", () => {
  const DB = construirDBPrueba();
  const antes = existencia(DB, 1, 1);
  assert.throws(() => crearVenta(DB, {
    sucursal_id: 1, metodo_pago: "EFECTIVO",
    lineas: [{ producto_id: 1, cantidad: 1.5, precio_unitario: 25 }],
  }), /piezas enteras/);
  assert.strictEqual(existencia(DB, 1, 1), antes);
});

test("un artículo rápido de 0.5 piezas también se rechaza", () => {
  const DB = construirDBPrueba();
  assert.throws(() => crearVenta(DB, {
    sucursal_id: 1, metodo_pago: "EFECTIVO",
    lineas: [{ descripcion: "Pieza suelta", cantidad: 0.5, precio_unitario: 100 }],
  }, { permisos: ["agregar_articulo_rapido"], usuario: USUARIO }), /piezas enteras/);
});

test("un apartado de 1.5 piezas se rechaza", () => {
  const DB = construirDBPrueba();
  assert.throws(() => crearApartado(DB, {
    cliente_id: 1, anticipo_monto: 10, anticipo_forma_pago: "EFECTIVO",
    lineas: [{ producto_id: 1, cantidad: 1.5, precio_unitario: 25, descuento_pct: 0 }],
  }, 1, { nombre: "Ana" }), /piezas enteras/);
});

test("un traspaso de 0.5 piezas se rechaza y no descuenta del origen", () => {
  const DB = construirDBPrueba();
  const antes = existencia(DB, 1, 1);
  assert.throws(() => crearTraspaso(DB, { producto_id: 1, cantidad: 0.5, sucursal_destino_id: 2 }, 1, USUARIO), /piezas enteras/);
  assert.strictEqual(existencia(DB, 1, 1), antes);
});

test("una recepción de compra con 2.5 piezas se rechaza", () => {
  const DB = construirDBPrueba();
  assert.throws(() => crearRecepcion(DB, {
    proveedor_id: 1, factura: "A-101",
    renglones: [{ producto_id: 1, cantidad: 2.5, costo: 50 }],
  }, 6, USUARIO), /piezas enteras/);
});

test("dar de alta un producto con existencia inicial de 1.5 se rechaza", () => {
  const DB = construirDBPrueba();
  const productos = DB["catalogo-productos"].productos.length;
  assert.throws(() => crearProducto(DB, { descripcion: "Bafle 15", existencia_inicial: 1.5 }, 1, USUARIO), /piezas enteras/);
  assert.strictEqual(DB["catalogo-productos"].productos.length, productos, "no debe quedar un producto a medias");
});

test("las cantidades enteras siguen funcionando igual", () => {
  const DB = construirDBPrueba();
  const antes = existencia(DB, 1, 1);
  crearVenta(DB, { sucursal_id: 1, metodo_pago: "EFECTIVO", lineas: [{ producto_id: 1, cantidad: 2, precio_unitario: 25 }] });
  crearTraspaso(DB, { producto_id: 1, cantidad: 3, sucursal_destino_id: 2 }, 1, USUARIO);
  assert.strictEqual(existencia(DB, 1, 1), antes - 5);
});

test("el ajuste manual acepta restar piezas enteras y rechaza medias piezas", () => {
  const { ajusteManualExistencia } = require("./productos");
  const DB = construirDBPrueba();
  const antes = existencia(DB, 1, 1);
  assert.throws(() => ajusteManualExistencia(DB, 1, { cantidad: -0.5, sucursal_id: 1, usuario: USUARIO }), /piezas enteras/);
  assert.throws(() => ajusteManualExistencia(DB, 1, { cantidad: "1.5", sucursal_id: 1, usuario: USUARIO }), /piezas enteras/);
  assert.strictEqual(existencia(DB, 1, 1), antes);
  ajusteManualExistencia(DB, 1, { cantidad: -2, sucursal_id: 1, usuario: USUARIO });
  assert.strictEqual(existencia(DB, 1, 1), antes - 2);
});

test("la importación de SICAR no mete existencia fraccionaria a un producto que ya existe", () => {
  const { aplicarImportacion } = require("./migracion");
  const DB = construirDBPrueba();
  const antes = existencia(DB, 1, 1);
  const defaults = { categoria: "Abarrotes", departamento: "General", unidad: "PZA" };
  const r = aplicarImportacion(DB, "articulos", [{ clave: "AB-001", existencia: "120.5" }], 1, defaults, "sicar.xlsx");
  assert.strictEqual(existencia(DB, 1, 1), antes, "la existencia no debe quedar en fracción");
  assert.match(JSON.stringify(r.errores), /piezas enteras/);
});
