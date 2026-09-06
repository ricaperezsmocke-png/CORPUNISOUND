const { test } = require("node:test");
const assert = require("node:assert");

const { construirDBPrueba } = require("./testHelpers");
const { sembrarCajas } = require("./cajas");
const { crearVenta } = require("./ventas");

function prepararDB() {
  const DB = construirDBPrueba();
  DB.pos.ventas = [];
  DB.pos.venta_detalle = [];
  DB.pos.cajas = [];
  sembrarCajas(DB);
  DB.pos.configuracion = { permitir_ventas_sin_existencia: true };
  return DB;
}

const CON_DESCUENTO = { permisos: ["aplicar_descuentos_articulos_venta"] };

/**
 * EL SERVIDOR RECALCULA. Lo que manda el navegador es una propuesta, no un
 * hecho: quien manda la peticion a mano se salta cualquier limite de la
 * pantalla. Un articulo de $25 se registraba en $1 y en los reportes se veia
 * como una venta barata legitima, sin ninguna senal de fraude.
 */
test("el precio de un producto del catalogo no lo decide el navegador", () => {
  const DB = prepararDB();
  const producto = DB["catalogo-productos"].productos[0]; // precio_venta 25

  const venta = crearVenta(DB, {
    sucursal_id: 4,
    lineas: [{ producto_id: producto.id, cantidad: 1, precio_unitario: 1 }],
    subtotal: 1, descuento: 0, total: 1,
  });

  assert.strictEqual(venta.total, producto.precio_venta);
  const [detalle] = DB.pos.venta_detalle;
  assert.strictEqual(detalle.precio_unitario, producto.precio_venta);
});

test("el total de la venta se calcula, no se copia", () => {
  const DB = prepararDB();
  const producto = DB["catalogo-productos"].productos[0]; // 25

  const venta = crearVenta(DB, {
    sucursal_id: 4,
    lineas: [{ producto_id: producto.id, cantidad: 3 }],
    total: 99999,
  });

  assert.strictEqual(venta.total, 75);
  assert.strictEqual(venta.subtotal, 75);
});

/**
 * Los productos rapidos / piezas especiales no tienen catalogo contra el cual
 * recalcular: su precio lo pone quien vende, y asi tiene que seguir siendo.
 */
test("un producto rapido sin catalogo conserva el precio que se le puso", () => {
  const DB = prepararDB();

  const venta = crearVenta(DB, {
    sucursal_id: 4,
    lineas: [{ descripcion: "Reparacion de bajo", cantidad: 1, precio_unitario: 450 }],
  });

  assert.strictEqual(venta.total, 450);
});

/**
 * El limite del descuento vivia SOLO en la pantalla: la ruta pedia unicamente
 * `cerrar_venta`, asi que un descuento del 99.99% entraba por peticion directa.
 * El permiso ya existia en el catalogo y nadie lo comprobaba en el servidor.
 */
test("un descuento sin el permiso se rechaza", () => {
  const DB = prepararDB();
  const producto = DB["catalogo-productos"].productos[0];

  assert.throws(
    () => crearVenta(DB, {
      sucursal_id: 4,
      lineas: [{ producto_id: producto.id, cantidad: 1, descuento_pct: 99.99 }],
    }),
    /descuento/i
  );
  assert.strictEqual(DB.pos.ventas.length, 0, "no se guarda nada");
});

test("con el permiso, el descuento se aplica y se refleja en el total", () => {
  const DB = prepararDB();
  const producto = DB["catalogo-productos"].productos[0]; // 25

  const venta = crearVenta(DB, {
    sucursal_id: 4,
    lineas: [{ producto_id: producto.id, cantidad: 2, descuento_pct: 10 }],
  }, CON_DESCUENTO);

  assert.strictEqual(venta.subtotal, 50);
  assert.strictEqual(venta.descuento, 5);
  assert.strictEqual(venta.total, 45);
});

test("un descuento fuera de rango se rechaza aun con el permiso", () => {
  const DB = prepararDB();
  const producto = DB["catalogo-productos"].productos[0];

  for (const pct of [-5, 100.01, 150]) {
    assert.throws(
      () => crearVenta(DB, {
        sucursal_id: 4,
        lineas: [{ producto_id: producto.id, cantidad: 1, descuento_pct: pct }],
      }, CON_DESCUENTO),
      /descuento/i,
      `dejo pasar ${pct}`
    );
  }
});

/** La red: una venta normal de varias lineas sigue dando lo mismo que siempre. */
test("una venta normal de varias lineas da el mismo total de siempre", () => {
  const DB = prepararDB();
  const [uno, dos] = DB["catalogo-productos"].productos; // 25 y 16

  const venta = crearVenta(DB, {
    sucursal_id: 4,
    lineas: [
      { producto_id: uno.id, cantidad: 2 },
      { producto_id: dos.id, cantidad: 3 },
    ],
  });

  assert.strictEqual(venta.total, 25 * 2 + 16 * 3);
});

/**
 * SALIO PROBANDO CONTRA LA BASE REAL, no con pruebas: dos productos del
 * catalogo de desarrollo tenian `precio_venta: 0`, y al tomar el precio del
 * catalogo en vez del que manda la pantalla, la venta se registro en $0 sin un
 * solo error. Antes de este cambio el navegador ponia el precio y eso lo tapaba.
 *
 * Un producto sin precio no se regala en silencio: se dice cual es y no se
 * vende hasta que alguien le ponga precio.
 */
test("un producto del catalogo sin precio no se vende en cero", () => {
  const DB = prepararDB();
  const producto = DB["catalogo-productos"].productos[0];
  producto.precio_venta = 0;

  assert.throws(
    () => crearVenta(DB, { sucursal_id: 4, lineas: [{ producto_id: producto.id, cantidad: 1, precio_unitario: 999 }] }),
    new RegExp(producto.nombre)
  );
  assert.strictEqual(DB.pos.ventas.length, 0, "no se guarda nada");
});
