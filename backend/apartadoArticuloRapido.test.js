/**
 * apartadoArticuloRapido.test.js — Un "artículo rápido" es una línea SIN
 * `producto_id`: un servicio o una pieza especial que no está en el catálogo.
 * Como no hay catálogo contra el cual recalcular, el precio lo pone quien
 * atiende — y eso deja una puerta abierta: mandar mercancía real como artículo
 * rápido a $1 se salta el recálculo de precio entero, Y ADEMÁS no descuenta
 * existencia (sin `producto_id` nunca corre `ajustarExistencia`). La guitarra
 * sale de la tienda y en los reportes se ve como un apartado barato legítimo.
 *
 * `crearVenta` (backend/ventas.js) cerró exactamente esta puerta el 2026-09-06
 * exigiendo el permiso `agregar_articulo_rapido`. Apartados quedó abierto.
 * Es el mismo riesgo por otra ruta, así que debe dar el mismo error.
 *
 * Sin permisos declarados (llamadas internas, pruebas viejas) se asume que NO
 * hay permiso: una guarda de dinero falla CERRANDO.
 */

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

function existenciaDe(DB, productoId, sucursalId) {
  const e = DB.inventario.existencias.find((x) => x.producto_id === productoId && x.sucursal_id === sucursalId);
  return e ? e.cantidad_actual : null;
}

// Nada a medias: ni el documento, ni sus renglones, ni el dinero del anticipo.
function assertNadaQuedoEscrito(DB) {
  assert.equal(DB.pos.ventas.length, 0, "no se creó ninguna venta/apartado");
  assert.equal(DB.pos.venta_detalle.length, 0, "no quedó ningún renglón suelto");
  assert.equal(DB.pos.apartado_abonos.length, 0, "no se registró ningún abono ni movimiento de caja");
}

test("SIN permiso, un apartado con artículo rápido se rechaza y no deja basura", () => {
  const DB = prepararDB();
  assert.throws(() => crearApartado(DB, {
    cliente_id: 1,
    anticipo_monto: 1,
    anticipo_forma_pago: "EFECTIVO",
    lineas: [{ producto_id: null, descripcion: "Guitarra electroacústica", cantidad: 1, precio_unitario: 1 }],
  }, 1, { nombre: "Ana" }, null, { permisos: [] }), /permiso/i);
  assertNadaQuedoEscrito(DB);
});

test("CON permiso, el artículo rápido se acepta y conserva el precio que se mandó", () => {
  const DB = prepararDB();
  const a = crearApartado(DB, {
    cliente_id: 1,
    anticipo_monto: 100,
    anticipo_forma_pago: "EFECTIVO",
    lineas: [{ producto_id: null, descripcion: "Servicio de afinación", cantidad: 1, precio_unitario: 777 }],
  }, 1, { nombre: "Ana" }, null, { permisos: ["agregar_articulo_rapido"] });

  assert.equal(a.total, 777, "los artículos rápidos legítimos siguen funcionando");
  assert.equal(DB.pos.ventas.length, 1);
  const detalle = DB.pos.venta_detalle.filter((d) => d.venta_id === a.id);
  assert.equal(detalle.length, 1);
  assert.equal(detalle[0].producto_id, null);
  assert.equal(detalle[0].precio_unitario, 777);
});

test("un apartado normal del catálogo SIGUE funcionando sin ese permiso", () => {
  const DB = prepararDB();
  const catalogo = DB["catalogo-productos"].productos.find((p) => p.id === 1).precio_venta;
  const a = crearApartado(DB, {
    cliente_id: 1,
    anticipo_monto: 5,
    anticipo_forma_pago: "EFECTIVO",
    lineas: [{ producto_id: 1, cantidad: 2 }],
  }, 1, { nombre: "Ana" }, null, { permisos: [] });

  assert.equal(a.total, catalogo * 2);
  assert.equal(existenciaDe(DB, 1, 1), 118, "la existencia sí baja en un apartado normal");
});

test("apartado MIXTO sin permiso: se rechaza ENTERO y la existencia del producto NO baja", () => {
  const DB = prepararDB();
  const antes = existenciaDe(DB, 1, 1);

  assert.throws(() => crearApartado(DB, {
    cliente_id: 1,
    anticipo_monto: 10,
    anticipo_forma_pago: "EFECTIVO",
    lineas: [
      { producto_id: 1, cantidad: 3 },
      { producto_id: null, descripcion: "Guitarra electroacústica", cantidad: 1, precio_unitario: 1 },
    ],
  }, 1, { nombre: "Ana" }, null, { permisos: [] }), /permiso/i);

  assert.equal(existenciaDe(DB, 1, 1), antes, "no se descontó inventario antes de fallar");
  assert.equal(DB.inventario.movimientos_inventario.length, 0, "ni un movimiento de inventario a medias");
  assertNadaQuedoEscrito(DB);
});

test("permisos ausentes o de un tipo raro se tratan como SIN permiso, sin reventar", () => {
  const lineas = [{ producto_id: null, descripcion: "Guitarra electroacústica", cantidad: 1, precio_unitario: 1 }];
  const datos = { cliente_id: 1, anticipo_monto: 1, anticipo_forma_pago: "EFECTIVO", lineas };

  for (const opciones of [undefined, {}, { permisos: undefined }, { permisos: null },
    { permisos: "agregar_articulo_rapido" }, { permisos: 7 }]) {
    const DB = prepararDB();
    assert.throws(
      () => crearApartado(DB, datos, 1, { nombre: "Ana" }, null, opciones),
      /permiso/i,
      `con opciones ${JSON.stringify(opciones)} debe rechazar, no pasar`,
    );
    assertNadaQuedoEscrito(DB);
  }
});
