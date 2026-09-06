const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { crearRecepcion } = require("./compras");

const USUARIO = { id: 9, nombre: "Encargado CEDIS" };

function conProveedor(DB) {
  DB["catalogo-productos"].proveedores.push({ id: 1, nombre: "Proveedor Uno", contacto: "", tiempo_entrega_dias: 0, condiciones_pago: "" });
  return DB;
}

/**
 * El costo de un renglon no se validaba. Un descuento mayor que el costo deja el
 * `costoFinal` en cero o en negativo, y `actualizarCostoDesdeCompra` solo
 * actualiza el producto si es mayor que cero — asi que el detalle de la compra
 * quedaba con un costo imposible mientras el producto conservaba otro.
 *
 * El resultado es un reporte de Utilidad que miente: la ganancia se calcula
 * contra un costo que nunca fue real.
 */
test("un renglon con costo cero se rechaza", () => {
  const DB = conProveedor(construirDBPrueba());

  assert.throws(
    () => crearRecepcion(DB, { proveedor_id: 1, factura: "A-1", renglones: [{ producto_id: 1, cantidad: 5, costo: 0 }] }, 6, USUARIO),
    /costo/i
  );
});

test("un renglon con costo negativo se rechaza", () => {
  const DB = conProveedor(construirDBPrueba());

  assert.throws(
    () => crearRecepcion(DB, { proveedor_id: 1, factura: "A-2", renglones: [{ producto_id: 1, cantidad: 5, costo: -10 }] }, 6, USUARIO),
    /costo/i
  );
});

/** Un descuento que se come el costo entero deja el mismo agujero. */
test("un descuento que deja el costo final en cero o menos se rechaza", () => {
  const DB = conProveedor(construirDBPrueba());

  assert.throws(
    () => crearRecepcion(DB, { proveedor_id: 1, factura: "A-3", renglones: [{ producto_id: 1, cantidad: 5, costo: 50, descuento_pesos: 50 }] }, 6, USUARIO),
    /costo/i
  );
  assert.throws(
    () => crearRecepcion(DB, { proveedor_id: 1, factura: "A-4", renglones: [{ producto_id: 1, cantidad: 5, costo: 50, descuento_porcentaje: 100 }] }, 6, USUARIO),
    /costo/i
  );
});

/**
 * Se rechaza ANTES de tocar nada: una recepcion invalida no puede dejar la
 * existencia a medias. La validacion ya corre antes de la primera mutacion y
 * esta prueba lo ancla.
 */
test("una recepcion rechazada no mueve existencia ni deja compra a medias", () => {
  const DB = conProveedor(construirDBPrueba());
  const comprasAntes = DB.inventario.compras.length;

  assert.throws(() => crearRecepcion(DB, {
    proveedor_id: 1, factura: "A-5",
    renglones: [{ producto_id: 1, cantidad: 5, costo: 50 }, { producto_id: 2, cantidad: 3, costo: 0 }],
  }, 6, USUARIO), /costo/i);

  assert.strictEqual(DB.inventario.compras.length, comprasAntes, "no queda compra a medias");
  const exist = DB.inventario.existencias.find((e) => e.producto_id === 1 && e.sucursal_id === 6);
  assert.ok(!exist || exist.cantidad_actual === 0, "no movio existencia");
});

/** La red: una recepcion normal sigue funcionando. */
test("una recepcion con costo valido sigue funcionando", () => {
  const DB = conProveedor(construirDBPrueba());

  const compra = crearRecepcion(DB, { proveedor_id: 1, factura: "A-6", renglones: [{ producto_id: 1, cantidad: 10, costo: 50 }] }, 6, USUARIO);

  assert.strictEqual(DB.inventario.existencias.find((e) => e.producto_id === 1 && e.sucursal_id === 6).cantidad_actual, 10);
  assert.ok(compra.id);
});
