/**
 * articuloRapidoPrecioNegativo.test.js — El precio de una línea de "artículo
 * rápido" (una línea SIN `producto_id`) no tenía piso: `Number(l.precio_unitario)
 * || 0` aceptaba cualquier cosa, incluido un número NEGATIVO.
 *
 * LA FUGA: se mete al carrito un producto de catálogo a su precio correcto, y
 * además una línea rápida con precio NEGATIVO que lo compensa. El total se
 * desploma a lo que el atacante quiera. Reproducido de verdad: producto de
 * catálogo de $32 + línea rápida a -22 = venta/apartado con total $10. En un
 * apartado, como el anticipo cubre el total fabricado, el apartado se liquida
 * SOLO: la mercancía sale marcada como pagada y el inventario sí baja. Con una
 * guitarra de $12,000 el mecanismo es idéntico y no tiene techo.
 *
 * DECISIÓN DE NEGOCIO (Victor, 2026-09-12): una línea de artículo rápido NUNCA
 * puede tener precio negativo, en ninguno de los dos módulos. Para rebajar el
 * importe de una venta ya existe `descuento_pct`, con su propio permiso
 * (`aplicar_descuentos_articulos_venta`) y sus propios topes de 0 a 100. Una
 * línea negativa es un descuento sin permiso, sin tope y sin rastro.
 *
 * Precio CERO SÍ se permite (cortesía / accesorio de regalo — ya funciona, no
 * se le rompe a nadie). El piso es "no negativo", no "mayor que cero".
 *
 * Además el precio debe ser un número FINITO: `Number(x) || 0` traga NaN,
 * texto basura y `null` convirtiéndolos en 0 en silencio, y NO atrapa
 * `Infinity` porque `Infinity || 0` es `Infinity` (Infinity es verdadero). Se
 * rechaza cualquier valor que no sea un número finito, en vez de tragárselo.
 *
 * La guarda va ANTES de escribir nada en la base — igual que la guarda del
 * permiso `agregar_articulo_rapido` (commit b4adfd7): si el precio se rechaza,
 * no debe quedar venta, ni renglones, ni abono, ni movimiento de inventario, y
 * la existencia del producto de catálogo que viajaba en el mismo carrito NO
 * debe bajar.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { construirDBPrueba } = require("./testHelpers");
const { sembrarCajas } = require("./cajas");
const { crearVenta } = require("./ventas");
const { crearApartado } = require("./apartados");

const RAPIDO = { permisos: ["agregar_articulo_rapido"] };

// ---------------------------------------------------------------------------
// VENTAS
// ---------------------------------------------------------------------------

function prepararDBVentas() {
  const DB = construirDBPrueba();
  DB.pos.ventas = [];
  DB.pos.venta_detalle = [];
  DB.pos.cajas = [];
  sembrarCajas(DB);
  DB.pos.configuracion = { permitir_ventas_sin_existencia: true };
  return DB;
}

function existenciaDe(DB, productoId, sucursalId) {
  const e = DB.inventario.existencias.find((x) => x.producto_id === productoId && x.sucursal_id === sucursalId);
  return e ? e.cantidad_actual : null;
}

function assertNadaEscritoVenta(DB) {
  assert.equal(DB.pos.ventas.length, 0, "no se creó ninguna venta");
  assert.equal(DB.pos.venta_detalle.length, 0, "no quedó ningún renglón suelto");
  assert.equal(DB.inventario.movimientos_inventario.length, 0, "ni un movimiento de inventario a medias");
}

test("VENTAS: articulo rapido con precio NEGATIVO, con permiso, se rechaza y no deja nada escrito", () => {
  const DB = prepararDBVentas();
  assert.throws(
    () => crearVenta(DB, {
      sucursal_id: 3,
      metodo_pago: "TARJETA",
      lineas: [{ descripcion: "Ajuste", cantidad: 1, precio_unitario: -22 }],
    }, RAPIDO),
    /negativ/i,
  );
  assertNadaEscritoVenta(DB);
});

test("VENTAS: EL CASO REPRODUCIDO — catalogo $32 + rapido -22 se rechaza ENTERO y la existencia del catalogo NO baja", () => {
  const DB = prepararDBVentas();
  const producto = DB["catalogo-productos"].productos.find((p) => p.id === 3); // Detergente 1L, $32
  const antes = existenciaDe(DB, 3, 3);

  assert.throws(
    () => crearVenta(DB, {
      sucursal_id: 3,
      metodo_pago: "TARJETA",
      lineas: [
        { producto_id: 3, cantidad: 1 },
        { descripcion: "Ajuste", cantidad: 1, precio_unitario: -22 },
      ],
    }, RAPIDO),
    /negativ/i,
  );

  assert.equal(existenciaDe(DB, 3, 3), antes, `la existencia de "${producto.nombre}" no debe bajar`);
  assertNadaEscritoVenta(DB);
});

test("VENTAS: articulo rapido a precio CERO se acepta (cortesia legitima, no se rompe)", () => {
  const DB = prepararDBVentas();
  const venta = crearVenta(DB, {
    sucursal_id: 3,
    metodo_pago: "TARJETA",
    lineas: [{ descripcion: "Cortesia", cantidad: 1, precio_unitario: 0 }],
  }, RAPIDO);
  assert.equal(venta.total, 0);
  assert.equal(DB.pos.ventas.length, 1);
});

test("VENTAS: articulo rapido con precio NO finito se rechaza, no se traga como 0", () => {
  for (const precioMalo of [NaN, "abc", null, Infinity]) {
    const DB = prepararDBVentas();
    assert.throws(
      () => crearVenta(DB, {
        sucursal_id: 3,
        metodo_pago: "TARJETA",
        lineas: [{ descripcion: "Ajuste", cantidad: 1, precio_unitario: precioMalo }],
      }, RAPIDO),
      /precio/i,
      `debio rechazar precio_unitario = ${JSON.stringify(precioMalo)}`,
    );
    assertNadaEscritoVenta(DB);
  }
});

test("VENTAS: articulo rapido normal a precio positivo, con permiso, sigue funcionando", () => {
  const DB = prepararDBVentas();
  const venta = crearVenta(DB, {
    sucursal_id: 3,
    metodo_pago: "TARJETA",
    lineas: [{ descripcion: "Reparacion de bajo", cantidad: 1, precio_unitario: 450 }],
  }, RAPIDO);
  assert.equal(venta.total, 450);
});

// ---------------------------------------------------------------------------
// APARTADOS
// ---------------------------------------------------------------------------

function prepararDBApartados() {
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

function assertNadaEscritoApartado(DB) {
  assert.equal(DB.pos.ventas.length, 0, "no se creó ningún apartado");
  assert.equal(DB.pos.venta_detalle.length, 0, "no quedó ningún renglón suelto");
  assert.equal(DB.pos.apartado_abonos.length, 0, "no se registró ningún abono ni movimiento de caja");
  assert.equal(DB.inventario.movimientos_inventario.length, 0, "ni un movimiento de inventario a medias");
}

test("APARTADOS: articulo rapido con precio NEGATIVO, con permiso, se rechaza y no deja nada escrito", () => {
  const DB = prepararDBApartados();
  assert.throws(
    () => crearApartado(DB, {
      cliente_id: 1,
      anticipo_monto: 1,
      anticipo_forma_pago: "EFECTIVO",
      lineas: [{ producto_id: null, descripcion: "Ajuste", cantidad: 1, precio_unitario: -22 }],
    }, 3, { nombre: "Ana" }, null, RAPIDO),
    /negativ/i,
  );
  assertNadaEscritoApartado(DB);
});

test("APARTADOS: EL CASO REPRODUCIDO — catalogo $32 + rapido -22 se rechaza ENTERO, la existencia NO baja y no queda liquidado", () => {
  const DB = prepararDBApartados();
  const producto = DB["catalogo-productos"].productos.find((p) => p.id === 3); // Detergente 1L, $32
  const antes = existenciaDe(DB, 3, 3);

  assert.throws(
    () => crearApartado(DB, {
      cliente_id: 1,
      anticipo_monto: 10, // cubriria justo el total fabricado ($32 - $22 = $10): si el bug existiera, se liquidaria solo
      anticipo_forma_pago: "EFECTIVO",
      lineas: [
        { producto_id: 3, cantidad: 1 },
        { producto_id: null, descripcion: "Ajuste", cantidad: 1, precio_unitario: -22 },
      ],
    }, 3, { nombre: "Ana" }, null, RAPIDO),
    /negativ/i,
  );

  assert.equal(existenciaDe(DB, 3, 3), antes, `la existencia de "${producto.nombre}" no debe bajar`);
  assertNadaEscritoApartado(DB);
  assert.equal(DB.pos.ventas.filter((v) => v.estatus === "cerrada").length, 0, "no debe quedar ningun apartado liquidado");
});

test("APARTADOS: articulo rapido a precio CERO se acepta (cortesia legitima, no se rompe)", () => {
  const DB = prepararDBApartados();
  const a = crearApartado(DB, {
    cliente_id: 1,
    anticipo_monto: 1,
    anticipo_forma_pago: "EFECTIVO",
    lineas: [
      { producto_id: 1, cantidad: 1 },
      { producto_id: null, descripcion: "Cortesia", cantidad: 1, precio_unitario: 0 },
    ],
  }, 1, { nombre: "Ana" }, null, RAPIDO);
  assert.equal(a.total, 25); // solo el producto de catalogo; la cortesia suma $0
  assert.equal(DB.pos.ventas.length, 1);
});

test("APARTADOS: articulo rapido con precio NO finito se rechaza, no se traga como 0", () => {
  for (const precioMalo of [NaN, "abc", null, Infinity]) {
    const DB = prepararDBApartados();
    assert.throws(
      () => crearApartado(DB, {
        cliente_id: 1,
        anticipo_monto: 1,
        anticipo_forma_pago: "EFECTIVO",
        lineas: [{ producto_id: null, descripcion: "Ajuste", cantidad: 1, precio_unitario: precioMalo }],
      }, 3, { nombre: "Ana" }, null, RAPIDO),
      /precio/i,
      `debio rechazar precio_unitario = ${JSON.stringify(precioMalo)}`,
    );
    assertNadaEscritoApartado(DB);
  }
});

test("APARTADOS: articulo rapido normal a precio positivo, con permiso, sigue funcionando", () => {
  const DB = prepararDBApartados();
  const a = crearApartado(DB, {
    cliente_id: 1,
    anticipo_monto: 100,
    anticipo_forma_pago: "EFECTIVO",
    lineas: [{ producto_id: null, descripcion: "Servicio de afinacion", cantidad: 1, precio_unitario: 777 }],
  }, 1, { nombre: "Ana" }, null, RAPIDO);
  assert.equal(a.total, 777);
});
