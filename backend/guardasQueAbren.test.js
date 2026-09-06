const { test } = require("node:test");
const assert = require("node:assert");

const { construirDBPrueba } = require("./testHelpers");
const { sembrarCajas } = require("./cajas");
const { crearVenta } = require("./ventas");
const { crearApartado, registrarAbono } = require("./apartados");

function prepararDB() {
  const DB = construirDBPrueba();
  DB.pos.ventas = [];
  DB.pos.venta_detalle = [];
  DB.pos.apartado_abonos = [];
  DB.pos.cajas = [];
  sembrarCajas(DB);
  DB.pos.configuracion = { permitir_ventas_sin_existencia: true };
  return DB;
}

const LINEAS = [{ producto_id: 1, cantidad: 1, precio_unitario: 25, descuento_pct: 0 }];

/**
 * MISMO DEFECTO QUE YA SE CERRO EN LAS VENTAS, EN EL ARCHIVO DE AL LADO.
 *
 * `crearApartado` y `registrarAbono` comparaban EXACTAMENTE contra "CRÉDITO"
 * con acento. En el repo conviven las dos escrituras, asi que mandar "CREDITO"
 * sin acento se colaba y el apartado se pagaba a credito — con el credito
 * apagado en todo el sistema desde el 2026-09-05.
 *
 * Se detecto en la auditoria del codigo ya desplegado.
 */
test("un apartado no se paga a credito, se escriba como se escriba", () => {
  for (const forma of ["CRÉDITO", "CREDITO", "credito", "Crédito", "  credito  "]) {
    const DB = prepararDB();
    assert.throws(
      () => crearApartado(DB, { cliente_id: 1, lineas: LINEAS, anticipo_monto: 10, anticipo_forma_pago: forma }, 1, { nombre: "Ana" }),
      /cr[eé]dito/i,
      `dejo pasar ${JSON.stringify(forma)}`
    );
  }
});

test("un abono no se paga a credito, se escriba como se escriba", () => {
  const DB = prepararDB();
  const apartado = crearApartado(DB, { cliente_id: 1, lineas: LINEAS, anticipo_monto: 10, anticipo_forma_pago: "EFECTIVO" }, 1, { nombre: "Ana" });

  for (const forma of ["CRÉDITO", "CREDITO", "credito", "  Credito "]) {
    assert.throws(
      () => registrarAbono(DB, apartado.id, { monto: 5, forma_pago: forma }, { nombre: "Ana" }),
      /cr[eé]dito/i,
      `dejo pasar ${JSON.stringify(forma)}`
    );
  }
});

/** La red: las formas de pago normales siguen funcionando en apartados. */
test("un apartado en efectivo sigue funcionando", () => {
  const DB = prepararDB();
  const apartado = crearApartado(DB, { cliente_id: 1, lineas: LINEAS, anticipo_monto: 10, anticipo_forma_pago: "EFECTIVO" }, 1, { nombre: "Ana" });
  assert.strictEqual(apartado.estatus, "apartado");
});

/**
 * EL RECALCULO DE PRECIOS SE PODIA ESQUIVAR OMITIENDO `producto_id`.
 *
 * Una linea sin producto es un "articulo rapido": no tiene catalogo contra el
 * cual recalcular, asi que conserva el precio que le pongan — por diseno, para
 * servicios y piezas especiales. Pero eso deja una puerta: mandar la mercancia
 * real como articulo rapido a $1 se salta el recalculo entero.
 *
 * El permiso `agregar_articulo_rapido` YA EXISTIA en el catalogo y solo se
 * comprobaba en la pantalla, igual que pasaba con los descuentos.
 */
test("un articulo rapido sin el permiso se rechaza", () => {
  const DB = prepararDB();

  assert.throws(
    () => crearVenta(DB, {
      sucursal_id: 4, metodo_pago: "TARJETA",
      lineas: [{ descripcion: "Servicio", cantidad: 1, precio_unitario: 1 }],
    }),
    /r[aá]pido/i
  );
  assert.strictEqual(DB.pos.ventas.length, 0, "no se guarda nada");
});

test("con el permiso, el articulo rapido conserva su precio", () => {
  const DB = prepararDB();

  const venta = crearVenta(DB, {
    sucursal_id: 4, metodo_pago: "TARJETA",
    lineas: [{ descripcion: "Reparacion de bajo", cantidad: 1, precio_unitario: 450 }],
  }, { permisos: ["agregar_articulo_rapido"] });

  assert.strictEqual(venta.total, 450);
});

/** Una venta de catalogo no necesita ese permiso: no es un articulo rapido. */
test("una venta normal de catalogo no exige el permiso de articulo rapido", () => {
  const DB = prepararDB();
  const producto = DB["catalogo-productos"].productos[0];

  const venta = crearVenta(DB, { sucursal_id: 4, metodo_pago: "TARJETA", lineas: [{ producto_id: producto.id, cantidad: 1 }] });

  assert.strictEqual(venta.total, producto.precio_venta);
});
