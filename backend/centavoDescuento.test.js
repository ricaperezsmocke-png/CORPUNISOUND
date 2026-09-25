const { test } = require("node:test");
const assert = require("node:assert/strict");
const { construirDBPrueba } = require("./testHelpers");
const { sembrarCajas } = require("./cajas");
const { listarCondiciones } = require("./condicionesPago");
const { crearVenta } = require("./ventas");

const calculo = import("../src/calcularTotalesVenta.js");
const permisos = ["agregar_articulo_rapido", "aplicar_descuentos_articulos_venta"];

function prepararDB() {
  const DB = construirDBPrueba();
  DB.pos.ventas = [];
  DB.pos.venta_detalle = [];
  DB.pos.cajas = [];
  sembrarCajas(DB);
  DB.pos.configuracion = { permitir_ventas_sin_existencia: true };
  listarCondiciones(DB, 4);
  return DB;
}

// El oraculo ejecuta el servidor real: no reproduce su formula en la prueba.
function calcularServidor(DB, carrito, descuentoPago = 0) {
  DB.pos.ventas = [];
  DB.pos.venta_detalle = [];
  const condicion = DB.pos.condiciones_pago.find((c) => c.sucursal_id === 4 && c.nombre === "EFECTIVO");
  condicion.activo = true;
  condicion.descuento_pct = descuentoPago;
  const venta = crearVenta(DB, {
    sucursal_id: 4,
    metodo_pago: "EFECTIVO",
    lineas: carrito.map((f) => ({
      descripcion: "Prueba de centavos",
      cantidad: f.cantidad,
      precio_unitario: f.precioUnitario,
      descuento_pct: f.descuentoPct,
    })),
  }, { permisos });
  return { venta, importes: DB.pos.venta_detalle.map((l) => l.subtotal) };
}

// Solo referencia historica para detectar cambios en importes que ya coincidian.
// El sujeto de TODAS las comparaciones es la funcion importada desde src/.
function totalAnterior(carrito, descuentoPago) {
  const subtotal = carrito.reduce((s, f) => s + f.cantidad * f.precioUnitario, 0);
  const descuento = carrito.reduce((s, f) => s + f.cantidad * f.precioUnitario * f.descuentoPct / 100, 0);
  const total = subtotal - descuento;
  return {
    total: Number(total.toFixed(2)),
    totalConCondicion: Math.round(total * (1 - descuentoPago / 100) * 100) / 100,
  };
}

for (const [cantidad, descuentoPct, esperado] of [[3, 10, 53.87], [2, 5, 37.90], [1, 10, 17.95], [2, 10, 35.91]]) {
  test(`${cantidad} x 19.95 al ${descuentoPct}% coincide con el servidor: ${esperado}`, async () => {
    const { calcularTotalesVenta } = await calculo;
    const carrito = [{ cantidad, precioUnitario: 19.95, descuentoPct }];
    const { venta, importes } = calcularServidor(prepararDB(), carrito);
    assert.equal(venta.total, esperado);
    const pantalla = calcularTotalesVenta(carrito);
    assert.equal(Number(pantalla.total.toFixed(2)), esperado);
    assert.equal(pantalla.totalConCondicion, esperado);
    assert.deepEqual(pantalla.importes, importes);
  });
}

function* carritosDelBarrido() {
  for (let pesos = 1; pesos <= 200; pesos++) {
    for (const centavos of [0, 50, 95, 99]) {
      for (const descuentoPct of [3, 5, 6, 8, 10, 12, 15, 20, 30]) {
        for (let cantidad = 1; cantidad <= 6; cantidad++) {
          yield [{ cantidad, precioUnitario: pesos + centavos / 100, descuentoPct }];
        }
      }
    }
  }
}

test("barrido de 43,200 carritos y cuatro descuentos de pago contra crearVenta", async (t) => {
  const { calcularTotalesVenta } = await calculo;
  const DB = prepararDB();
  let combinaciones = 0;
  let diferencias = 0;
  let coincidenciasAnteriores = 0;
  let coincidenciasMovidas = 0;
  let primerDescuadre;
  for (const carrito of carritosDelBarrido()) {
    const sinPago = calcularServidor(DB, carrito).venta.total;
    for (const descuentoPago of [0, 3, 6, 10]) {
      const { venta, importes } = calcularServidor(DB, carrito, descuentoPago);
      const pantalla = calcularTotalesVenta(carrito, descuentoPago);
      const anterior = totalAnterior(carrito, descuentoPago);
      combinaciones++;
      const difiere = pantalla.totalConCondicion !== venta.total
        || Number(pantalla.total.toFixed(2)) !== sinPago
        || Number(pantalla.subtotal.toFixed(2)) !== venta.subtotal
        || pantalla.importes.some((importe, i) => Number(importe.toFixed(2)) !== importes[i]);
      if (difiere) {
        diferencias++;
        primerDescuadre ??= { carrito, descuentoPago, pantalla, servidor: venta.total };
      }
      for (const [campo, esperado] of [["total", sinPago], ["totalConCondicion", venta.total]]) {
        if (anterior[campo] !== esperado) continue;
        coincidenciasAnteriores++;
        if (Number(pantalla[campo].toFixed(2)) !== esperado) coincidenciasMovidas++;
      }
    }
  }
  t.diagnostic(`Combinaciones: ${combinaciones}; diferencias: ${diferencias}`);
  t.diagnostic(`Totales que ya coincidian: ${coincidenciasAnteriores}; movidos: ${coincidenciasMovidas}`);
  assert.equal(coincidenciasMovidas, 0, "Se movio un total que ya coincidia");
  assert.equal(diferencias, 0, JSON.stringify(primerDescuadre));
});

// Desde 2026-09-25 solo se venden piezas enteras: las cantidades de 1.25 y 2.5 se cambiaron
// por enteras que tambien obligan a redondear (7 x 19.95 con 10% y 3 x 7.99 con 3%).
test("varias lineas, cantidades enteras y descuentos de 0 a 100%", async () => {
  const { calcularTotalesVenta } = await calculo;
  const DB = prepararDB();
  const carritos = [
    [{ cantidad: 3, precioUnitario: 19.95, descuentoPct: 10 }, { cantidad: 2, precioUnitario: 19.95, descuentoPct: 5 }],
    [{ cantidad: 7, precioUnitario: 19.95, descuentoPct: 10 }, { cantidad: 3, precioUnitario: 7.99, descuentoPct: 3 }],
    [{ cantidad: 3, precioUnitario: 1.005, descuentoPct: 0 }, { cantidad: 1, precioUnitario: 19.95, descuentoPct: 100 }],
    [{ cantidad: "3", precioUnitario: "19.95", descuentoPct: "10" }, { cantidad: 1, precioUnitario: 0 }],
  ];
  for (const carrito of carritos) {
    const sinPago = calcularServidor(DB, carrito).venta;
    for (const descuentoPago of [0, 6, 10, 100]) {
      const { venta, importes } = calcularServidor(DB, carrito, descuentoPago);
      const pantalla = calcularTotalesVenta(carrito, descuentoPago);
      assert.equal(pantalla.subtotal, venta.subtotal);
      assert.equal(pantalla.total, sinPago.total);
      assert.equal(pantalla.descuentoTotal, sinPago.descuento);
      assert.equal(pantalla.totalConCondicion, venta.total);
      assert.deepEqual(pantalla.importes, importes);
    }
  }
  assert.deepEqual(calcularTotalesVenta([]), {
    subtotal: 0, descuentoTotal: 0, total: 0, totalConCondicion: 0, importes: [],
  });
});
