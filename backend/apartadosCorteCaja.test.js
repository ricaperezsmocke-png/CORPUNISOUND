const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { calcularCorteEnCurso } = require("./cortes");
const { crearApartado, registrarAbono } = require("./apartados");

test("calcularCorteEnCurso: los abonos de un apartado se suman al calculado por su propia forma de pago", () => {
  const DB = construirDBPrueba();
  crearApartado(DB, {
    cliente_id: 1,
    lineas: [{ producto_id: 1, cantidad: 1, precio_unitario: 25, descuento_pct: 0 }],
    anticipo_monto: 20,
    anticipo_forma_pago: "EFECTIVO",
  }, 4, { nombre: "Ana" });

  const corte = calcularCorteEnCurso(DB, 4);
  assert.strictEqual(corte.calculado.EFECTIVO, 20);
});

test("calcularCorteEnCurso: NO duplica dinero cuando un apartado se liquida en el mismo turno", () => {
  const DB = construirDBPrueba();
  const venta = crearApartado(DB, {
    cliente_id: 1,
    lineas: [{ producto_id: 1, cantidad: 2, precio_unitario: 25, descuento_pct: 0 }],
    anticipo_monto: 20,
    anticipo_forma_pago: "EFECTIVO",
  }, 4, { nombre: "Ana" });
  registrarAbono(DB, venta.id, { monto: 30, forma_pago: "TARJETA" }, { nombre: "Ana" }); // liquida (total $50)

  const corte = calcularCorteEnCurso(DB, 4);
  // Solo deben contarse los DOS abonos (20 + 30) — nunca el venta.total ($50) por separado.
  assert.strictEqual(corte.calculado.EFECTIVO, 20);
  assert.strictEqual(corte.calculado.TARJETA, 30);
  assert.strictEqual(corte.total_calculado, 50);
});

test("calcularCorteEnCurso: un abono en TRANSFERENCIA se suma a transferencias, no a calculado", () => {
  const DB = construirDBPrueba();
  crearApartado(DB, {
    cliente_id: 1,
    lineas: [{ producto_id: 1, cantidad: 1, precio_unitario: 25, descuento_pct: 0 }],
    anticipo_monto: 15,
    anticipo_forma_pago: "TRANSFERENCIA",
  }, 4, { nombre: "Ana" });

  const corte = calcularCorteEnCurso(DB, 4);
  assert.strictEqual(corte.transferencias, 15);
  assert.strictEqual(corte.calculado.EFECTIVO, 0);
});

test("calcularCorteEnCurso: respeta la sucursal — no mezcla abonos de otra sucursal", () => {
  const DB = construirDBPrueba();
  crearApartado(DB, {
    cliente_id: 1,
    lineas: [{ producto_id: 2, cantidad: 1, precio_unitario: 16, descuento_pct: 0 }],
    anticipo_monto: 10,
    anticipo_forma_pago: "EFECTIVO",
  }, 4, { nombre: "Ana" });

  // Sucursal 5 (MercadoLibre) no tiene ventas ni apartados sembrados en
  // construirDBPrueba() — sucursal 3 sí tiene una venta preexistente, por
  // eso no se usa aquí para no contaminar la aserción de $0.
  const corte = calcularCorteEnCurso(DB, 5);
  assert.strictEqual(corte.calculado.EFECTIVO, 0);
});
