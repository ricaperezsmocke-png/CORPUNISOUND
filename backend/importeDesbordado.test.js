/**
 * importeDesbordado.test.js — La cantidad y el precio se validan por separado,
 * pero NUNCA su producto. `1e308` es un número FINITO y positivo, así que pasa
 * limpio por la guarda de cantidad (`ventas.js`) — y al multiplicarlo por el
 * precio, el importe se desborda a `Infinity`.
 *
 * REPRODUCIDO EJECUTANDO EL CÓDIGO REAL (2026-09-20), sin permisos especiales,
 * solo con `cerrar_venta`:
 *
 *   VENTA con `cantidad: 1e308`  -> total = Infinity, existencia = -1e+308
 *   APARTADO con `cantidad: 1e308` -> total = NaN, existencia = -1e+308,
 *                                     y el apartado NO aparece en su pantalla
 *
 * POR QUÉ IMPORTA, en el orden en que le duele al negocio:
 *
 * 1. El corte de esa caja queda en `Infinity` mientras la venta exista. Quien
 *    cuente el cajón esa tarde no puede cerrar su turno, y el faltante que el
 *    sistema le reclama no es un faltante: es una cifra que no es un número.
 * 2. La existencia del producto queda en `-1e+308`. Ese producto deja de ser
 *    contable para siempre hasta que alguien lo corrija a mano.
 * 3. En apartados es peor: el total sale `NaN` porque el descuento resulta de
 *    `Infinity * 0`. Y con el total en `NaN`, la guarda que impide que el
 *    anticipo supere al total (`anticipo > total`) evalúa `10 > NaN` = false y
 *    SE SALTA SOLA. Es el patrón que este proyecto llama "la guarda que falla
 *    abriendo". El apartado además queda invisible en su propia lista.
 *
 * LA REGLA: un importe —de línea o de documento— tiene que ser un número
 * finito y dentro del rango que el sistema puede representar en centavos sin
 * perder exactitud. `redondear()` multiplica por 100, así que el techo es
 * `Number.MAX_SAFE_INTEGER / 100`. Lo que se pase de ahí se rechaza ANTES de
 * escribir nada, igual que las demás guardas de estos dos módulos.
 *
 * Lo que NO cambia: la cortesía de $0 sigue siendo válida, y una venta o un
 * apartado normales siguen funcionando igual.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { construirDBPrueba } = require("./testHelpers");
const { sembrarCajas } = require("./cajas");
const { crearVenta } = require("./ventas");
const { crearApartado, listarApartados } = require("./apartados");
const { mapearLineasDeOrden } = require("./mercadolibre");
const { listarCondiciones, actualizarCondicion } = require("./condicionesPago");
const { TOPE_IMPORTE, exigirImporte } = require("./importes");

const RAPIDO = { permisos: ["agregar_articulo_rapido"] };

function prepararDBVentas() {
  const DB = construirDBPrueba();
  DB.pos.ventas = [];
  DB.pos.venta_detalle = [];
  DB.pos.cajas = [];
  sembrarCajas(DB);
  DB.pos.configuracion = { permitir_ventas_sin_existencia: true };
  return DB;
}

function prepararDBApartados() {
  const DB = prepararDBVentas();
  DB.pos.apartado_abonos = [];
  return DB;
}

function existenciaDe(DB, productoId, sucursalId) {
  const e = DB.inventario.existencias.find((x) => x.producto_id === productoId && x.sucursal_id === sucursalId);
  return e ? e.cantidad_actual : null;
}

function assertNadaEscrito(DB) {
  assert.equal(DB.pos.ventas.length, 0, "no se creó ningún documento");
  assert.equal(DB.pos.venta_detalle.length, 0, "no quedó ningún renglón suelto");
  assert.equal(DB.inventario.movimientos_inventario.length, 0, "ni un movimiento de inventario a medias");
}

// ---------------------------------------------------------------------------
// VENTAS
// ---------------------------------------------------------------------------

test("VENTAS: una cantidad descomunal se rechaza, no deja el total en Infinity", () => {
  const DB = prepararDBVentas();
  const antes = existenciaDe(DB, 3, 3);
  assert.throws(
    () => crearVenta(DB, {
      sucursal_id: 3,
      metodo_pago: "TARJETA",
      lineas: [{ producto_id: 3, cantidad: 1e308 }],
    }, {}),
    /cantidad|importe/i
  );
  assertNadaEscrito(DB);
  assert.equal(existenciaDe(DB, 3, 3), antes, "la existencia no se movió");
});

test("VENTAS: cantidad y precio finitos cuyo PRODUCTO se desborda también se rechazan", () => {
  const DB = prepararDBVentas();
  assert.throws(
    () => crearVenta(DB, {
      sucursal_id: 3,
      metodo_pago: "TARJETA",
      // 10 millones x 10 millones = 1e14, por encima del techo, pero cada
      // factor por separado lo pasa: esto es lo que prueba el PRODUCTO. Con
      // 1e200 la guarda de cantidad rechazaba antes de multiplicar, y la
      // prueba pasaba aunque se quitara la validación del importe.
      lineas: [{ descripcion: "Servicio", cantidad: 1e7, precio_unitario: 1e7 }],
    }, RAPIDO),
    /cantidad|precio|importe/i
  );
  assertNadaEscrito(DB);
});

test("VENTAS: un precio de artículo rápido mandado como texto vacío se rechaza, no pasa como $0", () => {
  const DB = prepararDBVentas();
  assert.throws(
    () => crearVenta(DB, {
      sucursal_id: 3,
      metodo_pago: "TARJETA",
      lineas: [{ descripcion: "Servicio", cantidad: 1, precio_unitario: "" }],
    }, RAPIDO),
    /precio/i
  );
  assertNadaEscrito(DB);
});

test("VENTAS: una venta normal sigue funcionando igual", () => {
  const DB = prepararDBVentas();
  const venta = crearVenta(DB, {
    sucursal_id: 3,
    metodo_pago: "TARJETA",
    lineas: [{ producto_id: 3, cantidad: 2 }],
  }, {});
  assert.ok(Number.isFinite(venta.total), "el total es un número de verdad");
  assert.ok(venta.total > 0);
  assert.equal(DB.pos.ventas.length, 1);
});

test("VENTAS: la cortesía de $0 se sigue aceptando", () => {
  const DB = prepararDBVentas();
  const venta = crearVenta(DB, {
    sucursal_id: 3,
    metodo_pago: "TARJETA",
    lineas: [{ descripcion: "Cortesía", cantidad: 1, precio_unitario: 0 }],
  }, RAPIDO);
  assert.equal(venta.total, 0);
});

// ---------------------------------------------------------------------------
// APARTADOS
// ---------------------------------------------------------------------------

test("APARTADOS: una cantidad descomunal se rechaza, no deja el total en NaN", () => {
  const DB = prepararDBApartados();
  const antes = existenciaDe(DB, 1, 1);
  assert.throws(
    () => crearApartado(DB, {
      cliente_id: 1,
      anticipo_monto: 10,
      anticipo_forma_pago: "EFECTIVO",
      lineas: [{ producto_id: 1, cantidad: 1e308 }],
    }, 1, { nombre: "Ana" }, null, {}),
    /cantidad|importe/i
  );
  assertNadaEscrito(DB);
  assert.equal(existenciaDe(DB, 1, 1), antes, "la existencia no se movió");
  assert.equal(listarApartados(DB, {}).length, 0, "no quedó ningún apartado invisible");
});

test("APARTADOS: con el total en NaN la guarda del anticipo fallaba ABRIENDO; ya no se llega ahí", () => {
  const DB = prepararDBApartados();
  // El anticipo (10) es ridículo frente a lo que se está apartando, y aun así
  // el sistema lo aceptaba porque `10 > NaN` es false. Ahora se rechaza antes.
  assert.throws(
    () => crearApartado(DB, {
      cliente_id: 1,
      anticipo_monto: 10,
      anticipo_forma_pago: "EFECTIVO",
      lineas: [{ producto_id: 1, cantidad: 1e308 }],
    }, 1, { nombre: "Ana" }, null, {}),
    /cantidad|importe/i
  );
  assert.equal(DB.pos.apartado_abonos.length, 0, "ni el abono del anticipo quedó escrito");
});

test("APARTADOS: un apartado normal sigue funcionando igual", () => {
  const DB = prepararDBApartados();
  const a = crearApartado(DB, {
    cliente_id: 1,
    anticipo_monto: 5,
    anticipo_forma_pago: "EFECTIVO",
    lineas: [{ producto_id: 1, cantidad: 1 }],
  }, 1, { nombre: "Ana" }, null, {});
  assert.ok(Number.isFinite(a.total), "el total es un número de verdad");
  assert.equal(a.total, 25);
});

// ---------------------------------------------------------------------------
// MERCADOLIBRE
// ---------------------------------------------------------------------------

test("MERCADOLIBRE: una orden con cantidad descomunal se rechaza al mapearla", () => {
  const DB = prepararDBVentas();
  const orden = {
    status: "paid",
    order_items: [{ item: { id: "MLM1", title: "Guitarra", seller_sku: "SKU-X" }, quantity: 1e308, unit_price: 100 }],
  };
  assert.throws(() => mapearLineasDeOrden(DB, orden), /cantidad|importe/i);
});

test("MERCADOLIBRE: un precio vacío o no numérico se rechaza, no pasa como $0", () => {
  const DB = prepararDBVentas();
  for (const unit_price of ["", null, "abc", Infinity, -5]) {
    const orden = {
      status: "paid",
      order_items: [{ item: { id: "MLM1", title: "Guitarra", seller_sku: "SKU-X" }, quantity: 1, unit_price }],
    };
    assert.throws(() => mapearLineasDeOrden(DB, orden), /precio/i, `pasó con precio: ${String(unit_price)}`);
  }
});

test("MERCADOLIBRE: una orden normal se sigue mapeando igual", () => {
  const DB = prepararDBVentas();
  const orden = {
    status: "paid",
    order_items: [{ item: { id: "MLM1", title: "Guitarra", seller_sku: "SKU-X" }, quantity: 2, unit_price: 125 }],
  };
  const { lineas } = mapearLineasDeOrden(DB, orden);
  assert.equal(lineas.length, 1);
  assert.equal(lineas[0].cantidad, 2);
  assert.equal(lineas[0].precio_unitario, 125);
  assert.equal(lineas[0].subtotal, 250);
});

test("APARTADOS: la cortesía de $0 se sigue aceptando", () => {
  const DB = prepararDBApartados();
  const a = crearApartado(DB, {
    cliente_id: 1,
    anticipo_monto: 1,
    anticipo_forma_pago: "EFECTIVO",
    lineas: [
      { producto_id: 1, cantidad: 1 },
      { producto_id: null, descripcion: "Cortesía", cantidad: 1, precio_unitario: 0 },
    ],
  }, 1, { nombre: "Ana" }, null, RAPIDO);
  assert.equal(a.total, 25);
});

// ---------------------------------------------------------------------------
// LO QUE ENCONTRÓ LA REVISIÓN INDEPENDIENTE
// ---------------------------------------------------------------------------
// Validar cada línea no basta. El total de un documento no siempre sale de sus
// líneas: en MercadoLibre lo manda el canal, y en una venta normal lo puede
// mover un descuento por forma de pago. Los tres casos de abajo dejaban otra
// vez el corte con una cifra que no es un número, y los tres se reprodujeron
// ejecutando antes de escribir el arreglo.

test("VENTAS: muchas líneas legítimas que SUMADAS se pasan del techo se rechazan", () => {
  const DB = prepararDBVentas();
  const lineas = Array.from({ length: 200 }, () => ({
    descripcion: "Servicio", cantidad: 1, precio_unitario: TOPE_IMPORTE,
  }));
  // Cada línea cabe; la suma no. Antes se aceptaba y el total guardado perdía
  // $100 por precisión: el ticket y el corte decían cosas distintas.
  assert.throws(() => crearVenta(DB, { sucursal_id: 3, metodo_pago: "TARJETA", lineas }, RAPIDO), /importe/i);
  assertNadaEscrito(DB);
});

test("VENTAS: un descuento por forma de pago disparatado no deja el total en Infinity", () => {
  const DB = prepararDBVentas();
  DB.pos.configuracion = { permitir_ventas_sin_existencia: true, descuentos_pago_habilitado: true };
  const condiciones = listarCondiciones(DB, 3);
  const condicion = condiciones.find((c) => /TARJETA/i.test(c.nombre)) || condiciones[0];
  // Lo pone quien tiene `editar_configuracion_pos`, pero lo sufre la cajera que
  // cobra normalmente: su corte queda sin cifra para esa forma de pago.
  actualizarCondicion(DB, condicion.id, { descuento_pct: -1e308 }, { verTodas: true });
  assert.throws(
    () => crearVenta(DB, {
      sucursal_id: 3, metodo_pago: condicion.nombre,
      lineas: [{ producto_id: 3, cantidad: 1 }],
    }, {}),
    /descuento|importe/i
  );
  assertNadaEscrito(DB);
});

test("APARTADOS: el SUBTOTAL también tiene techo, no solo el total tras el descuento", () => {
  const DB = prepararDBApartados();
  const permisos = { permisos: ["agregar_articulo_rapido", "aplicar_descuentos_articulos_venta"] };
  // Dos líneas al techo con 75% de descuento dejaban el total por debajo y el
  // subtotal por encima: el documento guardaba una cifra que no se sostiene.
  assert.throws(
    () => crearApartado(DB, {
      cliente_id: 1, anticipo_monto: 1, anticipo_forma_pago: "EFECTIVO",
      lineas: [
        { descripcion: "A", cantidad: 1, precio_unitario: TOPE_IMPORTE, descuento_pct: 75 },
        { descripcion: "B", cantidad: 1, precio_unitario: TOPE_IMPORTE, descuento_pct: 75 },
      ],
    }, 1, { nombre: "Ana" }, null, permisos),
    /importe/i
  );
  assertNadaEscrito(DB);
});

test("MERCADOLIBRE: el total que manda el canal también se valida", () => {
  // Es el que va al corte de la sucursal 5: no sale de las líneas, lo copia la
  // orden. Con un total disparatado, la venta se guardaba, la orden quedaba
  // marcada como importada -irrecuperable- y el corte de ML en Infinity.
  assert.throws(() => exigirImporte(1e308, "la orden de MercadoLibre"), /importe/i);
  assert.equal(exigirImporte(375, "la orden de MercadoLibre"), 375, "una orden normal pasa igual");
});
