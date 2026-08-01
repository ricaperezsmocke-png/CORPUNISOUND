const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { listarCategorias } = require("./gastosCategorias");
const { crearGasto, cancelarGasto } = require("./gastos");
const { calcularCorteEnCurso, crearCorte } = require("./cortes");

const ALCANCE_TODAS = { verTodas: true, sucursalId: null };
const USUARIO = { nombre: "Victor" };

function driveFalso() {
  return {
    asegurarCarpetaGastosSucursal: async () => "carpeta-1",
    subirArchivoADrive: async () => ({ id: "file-1", webViewLink: "https://drive.google.com/x" }),
  };
}

function idHoja(DB, nombre) {
  return listarCategorias(DB, {}).find((c) => c.nombre === nombre).id;
}

// Sucursal 4 (Palenque): construirDBPrueba() no le siembra ventas, a
// diferencia de 1/2/3 — mismo criterio que ya usa apartadosCorteCaja.test.js
// para no contaminar las aserciones de estos escenarios.
async function gasto(DB, { sucursal = 4, monto = 500, forma_pago = "EFECTIVO" } = {}) {
  return crearGasto(DB, {
    categoria_id: idHoja(DB, "Combustible"),
    concepto: "Gasolina",
    monto,
    forma_pago,
    archivo: { nombre_archivo: "t.jpg", tipo_mime: "image/jpeg", contenido_base64: Buffer.from("x").toString("base64") },
  }, sucursal, USUARIO, driveFalso());
}

/** Venta de contado en la sucursal 4, para que haya efectivo esperado. */
function ventaEfectivo(DB, { sucursal = 4, total = 2000 } = {}) {
  const id = DB.pos.ventas.length + 100;
  DB.pos.ventas.push({
    id, fecha: new Date().toISOString().slice(0, 10), fecha_hora: new Date().toISOString(),
    sucursal_id: sucursal, vendedor_id: 1, cliente_id: 0, total,
    metodo_pago: "efectivo", estatus: "cerrada", motivo_cancelacion: null,
  });
}

test("un gasto en EFECTIVO baja el efectivo esperado del turno", async () => {
  const DB = construirDBPrueba();
  ventaEfectivo(DB, { total: 2000 });
  const antes = calcularCorteEnCurso(DB, 4);
  assert.strictEqual(antes.calculado.EFECTIVO, 2000);
  assert.strictEqual(antes.gastos_efectivo, 0);

  await gasto(DB, { monto: 500 });

  const despues = calcularCorteEnCurso(DB, 4);
  assert.strictEqual(despues.gastos_efectivo, 500);
  assert.strictEqual(despues.gastos_incluidos, 1);
  assert.strictEqual(despues.calculado.EFECTIVO, 1500, "2000 de venta menos 500 de gasto");
  assert.strictEqual(despues.total_calculado, 1500);
});

test("un gasto por TRANSFERENCIA o TARJETA no toca la caja de la tienda", async () => {
  const DB = construirDBPrueba();
  ventaEfectivo(DB, { total: 2000 });
  await gasto(DB, { monto: 700, forma_pago: "TRANSFERENCIA" });
  await gasto(DB, { monto: 300, forma_pago: "TARJETA" });

  const r = calcularCorteEnCurso(DB, 4);
  assert.strictEqual(r.gastos_efectivo, 0);
  assert.strictEqual(r.calculado.EFECTIVO, 2000);
});

test("un gasto CANCELADO deja de descontar", async () => {
  const DB = construirDBPrueba();
  ventaEfectivo(DB, { total: 2000 });
  const g = await gasto(DB, { monto: 500 });
  assert.strictEqual(calcularCorteEnCurso(DB, 4).calculado.EFECTIVO, 1500);

  cancelarGasto(DB, g.id, "Se capturó dos veces", USUARIO, ALCANCE_TODAS);

  assert.strictEqual(calcularCorteEnCurso(DB, 4).calculado.EFECTIVO, 2000, "vuelve a los 2000");
  assert.strictEqual(calcularCorteEnCurso(DB, 4).gastos_efectivo, 0);
});

test("el gasto de OTRA sucursal no descuadra esta caja", async () => {
  const DB = construirDBPrueba();
  ventaEfectivo(DB, { sucursal: 4, total: 2000 });
  await gasto(DB, { sucursal: 5, monto: 900 });

  const r = calcularCorteEnCurso(DB, 4);
  assert.strictEqual(r.gastos_efectivo, 0);
  assert.strictEqual(r.calculado.EFECTIVO, 2000);
});

test("un gasto ANTERIOR al último corte pertenece a un turno ya cerrado y no vuelve a restar", async () => {
  const DB = construirDBPrueba();
  ventaEfectivo(DB, { total: 2000 });
  await gasto(DB, { monto: 500 });

  // Se cierra el turno: el corte congela lo de arriba.
  crearCorte(DB, { sucursal_id: 4, usuario_id: 1, usuario_nombre: "Ana", contado: { EFECTIVO: 1500 }, retiro: {} });

  const r = calcularCorteEnCurso(DB, 4);
  assert.strictEqual(r.gastos_efectivo, 0, "el gasto del turno anterior ya no cuenta");
  assert.strictEqual(r.calculado.EFECTIVO, 0, "turno nuevo, sin ventas ni gastos");
});

test("el corte guardado conserva los gastos del turno y NO cambia si después se cancela uno", async () => {
  const DB = construirDBPrueba();
  ventaEfectivo(DB, { total: 2000 });
  const g = await gasto(DB, { monto: 500 });

  const corte = crearCorte(DB, {
    sucursal_id: 4, usuario_id: 1, usuario_nombre: "Ana",
    contado: { EFECTIVO: 1500 }, retiro: {},
  });

  assert.strictEqual(corte.gastos_efectivo, 500, "queda registrado por qué el calculado fue 1500");
  assert.strictEqual(corte.total_calculado, 1500);
  assert.strictEqual(corte.total_diferencia, 0, "la caja cuadra: el gasto ya no se ve como faltante");

  cancelarGasto(DB, g.id, "Error de captura", USUARIO, ALCANCE_TODAS);

  const guardado = DB.pos.cortes_caja.find((c) => c.id === corte.id);
  assert.strictEqual(guardado.total_calculado, 1500, "el corte cerrado queda congelado");
  assert.strictEqual(guardado.gastos_efectivo, 500);
});

test("sin gastos, el corte se comporta exactamente igual que antes", async () => {
  const DB = construirDBPrueba();
  ventaEfectivo(DB, { total: 2000 });
  const r = calcularCorteEnCurso(DB, 4);
  assert.strictEqual(r.gastos_efectivo, 0);
  assert.strictEqual(r.gastos_incluidos, 0);
  assert.strictEqual(r.calculado.EFECTIVO, 2000);
});
