/**
 * Un depósito sin ficha es dinero que salió de la tienda "al banco" sin nada
 * que pruebe que llegó. Registrarlo sin comprobante es legítimo y se queda así
 * (Drive puede estar caído, y la ficha suele llegar más tarde), pero el sistema
 * tiene que GRITARLO: el estado de cuenta cuenta esos depósitos como
 * "depositado" igual que los que sí tienen respaldo, y hasta hoy la única señal
 * era un guion gris en una lista de treinta renglones.
 *
 * Decisión de Victor (2026-09-07): que grite, pero que deje registrar.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { crearDeposito, cancelarDeposito, adjuntarComprobante } = require("./depositos");
const { estadoCuenta } = require("./estadoCuenta");

const ALCANCE_TODAS = { verTodas: true, sucursalId: null };
const driveFalso = {
  asegurarCarpetaDepositosSucursal: async () => "carpeta-1",
  subirArchivoADrive: async () => ({ id: "file-1", webViewLink: "https://drive/file-1" }),
};
const driveCaido = {
  asegurarCarpetaDepositosSucursal: async () => { throw new Error("Drive no responde"); },
  subirArchivoADrive: async () => { throw new Error("Drive no responde"); },
};
const fichaValida = {
  nombre_archivo: "ficha.pdf",
  tipo_mime: "application/pdf",
  contenido_base64: Buffer.from("ficha").toString("base64"),
};

function nuevoDB() {
  return {
    pos: { sucursales: [{ id: 1, nombre: "Ocosingo" }, { id: 2, nombre: "Yajalón" }] },
    cuenta_comun: { depositos: [], deposito_movimientos: [], ultimo_id: 0 },
    inventario: { traspasos: [] },
    "catalogo-productos": { productos: [] },
  };
}
const usuario = { id: 1, nombre: "Ana" };

test("el estado de cuenta delata cuántos depósitos van sin ficha y cuánto dinero es", async () => {
  const DB = nuevoDB();
  await crearDeposito(DB, { monto: 10000, forma_pago: "EFECTIVO" }, 1, usuario, driveFalso);
  await crearDeposito(DB, { monto: 5300, forma_pago: "EFECTIVO" }, 1, usuario, driveFalso);
  await crearDeposito(DB, { monto: 2000, forma_pago: "EFECTIVO", archivo: fichaValida }, 1, usuario, driveFalso);

  const ec = estadoCuenta(DB, {}, ALCANCE_TODAS);
  const ocosingo = ec.resumen.find((r) => r.sucursal_id === 1);
  assert.equal(ocosingo.sin_comprobante, 2, "dos depósitos quedaron sin ficha");
  assert.equal(ocosingo.monto_sin_comprobante, 15300, "y son $15,300 sin respaldo");
  assert.equal(ocosingo.depositado, 17300, "el depositado sigue contándolos: el dinero salió igual");
});

test("los totales suman el dinero sin respaldo de todas las tiendas", async () => {
  const DB = nuevoDB();
  await crearDeposito(DB, { monto: 10000, forma_pago: "EFECTIVO" }, 1, usuario, driveFalso);
  await crearDeposito(DB, { monto: 700, forma_pago: "TRANSFERENCIA" }, 2, usuario, driveFalso);
  await crearDeposito(DB, { monto: 2000, forma_pago: "EFECTIVO", archivo: fichaValida }, 2, usuario, driveFalso);

  const ec = estadoCuenta(DB, {}, ALCANCE_TODAS);
  assert.equal(ec.totales.sin_comprobante, 2);
  assert.equal(ec.totales.monto_sin_comprobante, 10700);
});

test("un depósito cancelado deja de contarse: ya no es dinero que falte justificar", async () => {
  const DB = nuevoDB();
  const d = await crearDeposito(DB, { monto: 10000, forma_pago: "EFECTIVO" }, 1, usuario, driveFalso);
  cancelarDeposito(DB, d.id, "capturado por error", usuario, ALCANCE_TODAS);

  const ec = estadoCuenta(DB, {}, ALCANCE_TODAS);
  assert.equal(ec.totales.sin_comprobante, 0);
  assert.equal(ec.totales.monto_sin_comprobante, 0);
});

test("adjuntar la ficha después lo saca de la lista de pendientes", async () => {
  const DB = nuevoDB();
  const d = await crearDeposito(DB, { monto: 10000, forma_pago: "EFECTIVO" }, 1, usuario, driveFalso);
  assert.equal(estadoCuenta(DB, {}, ALCANCE_TODAS).totales.sin_comprobante, 1);

  await adjuntarComprobante(DB, d.id, fichaValida, usuario, ALCANCE_TODAS, driveFalso);
  assert.equal(estadoCuenta(DB, {}, ALCANCE_TODAS).totales.sin_comprobante, 0, "ya tiene respaldo");
  assert.equal(estadoCuenta(DB, {}, ALCANCE_TODAS).totales.monto_sin_comprobante, 0);
});

test("si Drive se cae, el depósito se registra Y queda marcado como pendiente de ficha", async () => {
  const DB = nuevoDB();
  const d = await crearDeposito(DB, { monto: 8000, forma_pago: "EFECTIVO", archivo: fichaValida }, 1, usuario, driveCaido);
  assert.equal(d.estatus, "activo", "la caída de Drive no puede tumbar el registro del dinero");
  assert.equal(d.drive_link, null);

  const ec = estadoCuenta(DB, {}, ALCANCE_TODAS);
  assert.equal(ec.totales.sin_comprobante, 1, "quien quiso adjuntar y no pudo también sale en la lista");
  assert.equal(ec.totales.monto_sin_comprobante, 8000);
});

test("a quien solo ve su tienda no se le cuentan los pendientes de las otras", async () => {
  const DB = nuevoDB();
  await crearDeposito(DB, { monto: 10000, forma_pago: "EFECTIVO" }, 1, usuario, driveFalso);
  await crearDeposito(DB, { monto: 4000, forma_pago: "EFECTIVO" }, 2, usuario, driveFalso);

  const soloYajalon = estadoCuenta(DB, {}, { verTodas: false, sucursalId: 2 });
  assert.equal(soloYajalon.totales.sin_comprobante, 1);
  assert.equal(soloYajalon.totales.monto_sin_comprobante, 4000, "no ve los $10,000 de Ocosingo");
});

test("el periodo filtra los pendientes igual que el resto del estado de cuenta", async () => {
  const DB = nuevoDB();
  const viejo = await crearDeposito(DB, { monto: 9000, forma_pago: "EFECTIVO" }, 1, usuario, driveFalso);
  viejo.fecha = "2026-01-15";
  await crearDeposito(DB, { monto: 1500, forma_pago: "EFECTIVO" }, 1, usuario, driveFalso);

  const ec = estadoCuenta(DB, { fecha_inicio: "2026-06-01" }, ALCANCE_TODAS);
  assert.equal(ec.totales.sin_comprobante, 1, "el de enero queda fuera del periodo pedido");
  assert.equal(ec.totales.monto_sin_comprobante, 1500);
});
