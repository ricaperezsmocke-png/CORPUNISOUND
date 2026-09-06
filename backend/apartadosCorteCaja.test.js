const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { calcularCorteEnCurso } = require("./cortes");
const { crearApartado, registrarAbono } = require("./apartados");
const { sembrarCajas } = require("./cajas");

function prepararDBConCajas() {
  const DB = construirDBPrueba();
  DB.pos.ventas = [];
  DB.pos.venta_detalle = [];
  DB.pos.apartado_abonos = [];
  DB.pos.cortes_caja = [];
  DB.pos.cajas = [];
  DB.pos.corte_epoca = "2026-09-01T00:00:00.000Z";
  sembrarCajas(DB);
  return DB;
}

function cajasDe(DB, sucursalId = 4) {
  return {
    administrativa: DB.pos.cajas.find((c) => c.sucursal_id === sucursalId && c.nombre === "Administrativa"),
    fiscal: DB.pos.cajas.find((c) => c.sucursal_id === sucursalId && c.nombre === "Fiscal"),
  };
}

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

test("el anticipo y los abonos posteriores guardan la caja donde se cobraron", () => {
  const DB = prepararDBConCajas();
  const { administrativa, fiscal } = cajasDe(DB);
  const venta = crearApartado(DB, {
    cliente_id: 1,
    lineas: [{ producto_id: 1, cantidad: 2, precio_unitario: 25, descuento_pct: 0 }],
    anticipo_monto: 20,
    anticipo_forma_pago: "EFECTIVO",
  }, 4, { nombre: "Ana" }, fiscal.id);

  registrarAbono(DB, venta.id, { monto: 10, forma_pago: "EFECTIVO" }, { nombre: "Ana" }, administrativa.id);

  assert.deepStrictEqual(DB.pos.apartado_abonos.map((a) => a.caja_id), [fiscal.id, administrativa.id]);
});

test("un abono cobrado en Fiscal entra solo en el corte de Fiscal", () => {
  const DB = prepararDBConCajas();
  const { administrativa, fiscal } = cajasDe(DB);
  crearApartado(DB, {
    cliente_id: 1,
    lineas: [{ producto_id: 1, cantidad: 2, precio_unitario: 2500, descuento_pct: 0 }],
    anticipo_monto: 5000,
    anticipo_forma_pago: "EFECTIVO",
  }, 4, { nombre: "Ana" }, fiscal.id);

  assert.strictEqual(calcularCorteEnCurso(DB, 4, fiscal.id).calculado.EFECTIVO, 5000);
  assert.strictEqual(calcularCorteEnCurso(DB, 4, administrativa.id).calculado.EFECTIVO, 0);
});

test("un abono posterior sin caja lo absorbe solo la Administrativa", () => {
  const DB = prepararDBConCajas();
  const { administrativa, fiscal } = cajasDe(DB);
  DB.pos.apartado_abonos.push({
    id: 1, venta_id: 90, sucursal_id: 4, caja_id: null, monto: 700,
    forma_pago: "EFECTIVO", fecha_hora: "2026-09-01T10:00:00.000Z", corte_id: null,
  });

  assert.strictEqual(calcularCorteEnCurso(DB, 4, administrativa.id).calculado.EFECTIVO, 700);
  assert.strictEqual(calcularCorteEnCurso(DB, 4, fiscal.id).calculado.EFECTIVO, 0);
});

test("un abono anterior a la epoca conserva la ventana historica", () => {
  const DB = prepararDBConCajas();
  const { administrativa } = cajasDe(DB);
  DB.pos.cortes_caja.push({
    id: 10, sucursal_id: 4, caja_id: administrativa.id, fecha_hora: "2026-08-31T08:00:00.000Z",
  });
  DB.pos.apartado_abonos.push(
    { id: 1, venta_id: 90, sucursal_id: 4, caja_id: null, monto: 100, forma_pago: "EFECTIVO", fecha_hora: "2026-08-31T07:00:00.000Z", corte_id: null },
    { id: 2, venta_id: 90, sucursal_id: 4, caja_id: null, monto: 200, forma_pago: "EFECTIVO", fecha_hora: "2026-08-31T09:00:00.000Z", corte_id: null }
  );

  assert.strictEqual(calcularCorteEnCurso(DB, 4, administrativa.id).calculado.EFECTIVO, 200);
});

test("registrar un abono rechaza una caja de otra sucursal", () => {
  const DB = prepararDBConCajas();
  const { administrativa } = cajasDe(DB);
  const fiscalAjena = cajasDe(DB, 1).fiscal;
  const venta = crearApartado(DB, {
    cliente_id: 1,
    lineas: [{ producto_id: 1, cantidad: 2, precio_unitario: 25, descuento_pct: 0 }],
    anticipo_monto: 20,
    anticipo_forma_pago: "EFECTIVO",
  }, 4, { nombre: "Ana" }, administrativa.id);

  assert.throws(
    () => registrarAbono(DB, venta.id, { monto: 10, forma_pago: "EFECTIVO" }, { nombre: "Ana" }, fiscalAjena.id),
    /caja.*sucursal/i
  );
  assert.strictEqual(DB.pos.apartado_abonos.length, 1);
});

test("crear un apartado rechaza una caja de otra sucursal antes de guardar el anticipo", () => {
  const DB = prepararDBConCajas();
  const fiscalAjena = cajasDe(DB, 1).fiscal;

  assert.throws(() => crearApartado(DB, {
    cliente_id: 1,
    lineas: [{ producto_id: 1, cantidad: 2, precio_unitario: 25, descuento_pct: 0 }],
    anticipo_monto: 20,
    anticipo_forma_pago: "EFECTIVO",
  }, 4, { nombre: "Ana" }, fiscalAjena.id), /caja.*sucursal/i);
  assert.strictEqual(DB.pos.ventas.length, 0);
  assert.strictEqual(DB.pos.apartado_abonos.length, 0);
});

test("sin catalogo de cajas los abonos se guardan sin caja y el corte los conserva", () => {
  const DB = construirDBPrueba();
  delete DB.pos.cajas;
  const venta = crearApartado(DB, {
    cliente_id: 1,
    lineas: [{ producto_id: 1, cantidad: 2, precio_unitario: 25, descuento_pct: 0 }],
    anticipo_monto: 20,
    anticipo_forma_pago: "EFECTIVO",
  }, 4, { nombre: "Ana" });
  registrarAbono(DB, venta.id, { monto: 10, forma_pago: "EFECTIVO" }, { nombre: "Ana" });

  assert.deepStrictEqual(DB.pos.apartado_abonos.slice(-2).map((a) => a.caja_id), [null, null]);
  assert.strictEqual(calcularCorteEnCurso(DB, 4).calculado.EFECTIVO, 30);
});
