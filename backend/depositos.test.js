const { test } = require("node:test");
const assert = require("node:assert");
const { crearDeposito, cancelarDeposito, listarDepositos } = require("./depositos");

const ALCANCE_TODAS = { verTodas: true, sucursalId: null };
const driveFalso = {
  asegurarCarpetaDepositosSucursal: async () => "carpeta-1",
  subirArchivoADrive: async () => ({ id: "file-1", webViewLink: "https://drive/file-1" }),
};

function nuevoDB() {
  return {
    pos: { sucursales: [{ id: 1, nombre: "Ocosingo" }, { id: 2, nombre: "Yajalón" }] },
    cuenta_comun: { depositos: [], deposito_movimientos: [], ultimo_id: 0 },
  };
}

test("crearDeposito exige monto > 0", async () => {
  await assert.rejects(() => crearDeposito(nuevoDB(), { monto: 0, forma_pago: "EFECTIVO" }, 1, { nombre: "Ana" }, driveFalso), /mayor que cero/);
});

test("crearDeposito usa la sucursal del token, no del body", async () => {
  const DB = nuevoDB();
  const d = await crearDeposito(DB, { monto: 5000, forma_pago: "EFECTIVO", sucursal_id: 999 }, 1, { nombre: "Ana" }, driveFalso);
  assert.strictEqual(d.sucursal_id, 1);
  assert.strictEqual(d.folio, "DEP-0001");
  assert.strictEqual(d.estatus, "activo");
});

test("crearDeposito sin comprobante queda registrado sin bloquear", async () => {
  const DB = nuevoDB();
  const d = await crearDeposito(DB, { monto: 1000, forma_pago: "TRANSFERENCIA" }, 1, { nombre: "Ana" }, driveFalso);
  assert.strictEqual(d.drive_link, null);
  assert.strictEqual(DB.cuenta_comun.depositos.length, 1);
});

test("crearDeposito con comprobante adjunta el link de Drive", async () => {
  const DB = nuevoDB();
  const d = await crearDeposito(DB, {
    monto: 1000, forma_pago: "EFECTIVO",
    archivo: { contenido_base64: Buffer.from("x").toString("base64"), tipo_mime: "image/jpeg", nombre_archivo: "ficha.jpg" },
  }, 1, { nombre: "Ana" }, driveFalso);
  assert.strictEqual(d.drive_link, "https://drive/file-1");
});

test("si Drive falla, el depósito igual queda registrado (comprobante opcional)", async () => {
  const DB = nuevoDB();
  const driveCaido = { asegurarCarpetaDepositosSucursal: async () => { throw new Error("Drive caído"); }, subirArchivoADrive: async () => ({}) };
  const d = await crearDeposito(DB, {
    monto: 1000, forma_pago: "EFECTIVO",
    archivo: { contenido_base64: Buffer.from("x").toString("base64"), tipo_mime: "image/jpeg", nombre_archivo: "f.jpg" },
  }, 1, { nombre: "Ana" }, driveCaido);
  assert.strictEqual(d.drive_link, null, "sin comprobante, pero el depósito existe");
  assert.strictEqual(DB.cuenta_comun.depositos.length, 1);
});

test("crearDeposito rechaza un archivo con MIME inválido y NO crea nada", async () => {
  const DB = nuevoDB();
  await assert.rejects(() => crearDeposito(DB, {
    monto: 100, forma_pago: "EFECTIVO",
    archivo: { contenido_base64: Buffer.from("x").toString("base64"), tipo_mime: "text/plain", nombre_archivo: "x.txt" },
  }, 1, { nombre: "Ana" }, driveFalso), /permitido/);
  assert.strictEqual(DB.cuenta_comun.depositos.length, 0, "no debe crear el depósito");
});

test("crearDeposito rechaza un archivo mayor a 10 MB y NO crea nada", async () => {
  const DB = nuevoDB();
  await assert.rejects(() => crearDeposito(DB, {
    monto: 100, forma_pago: "EFECTIVO",
    archivo: { contenido_base64: Buffer.alloc(10 * 1024 * 1024 + 1).toString("base64"), tipo_mime: "image/jpeg", nombre_archivo: "grande.jpg" },
  }, 1, { nombre: "Ana" }, driveFalso), /10 MB/);
  assert.strictEqual(DB.cuenta_comun.depositos.length, 0, "no debe crear el depósito");
});

test("folios únicos bajo capturas concurrentes (id síncrono)", async () => {
  const DB = nuevoDB();
  // Con archivo + subida async que en verdad cede el control (setTimeout), las
  // 12 capturas se intercalan de verdad en el `await` de Drive: si la reserva
  // de folio no fuera síncrona, aquí colisionarían.
  const driveLento = {
    asegurarCarpetaDepositosSucursal: async () => "c1",
    subirArchivoADrive: async () => { await new Promise((r) => setTimeout(r, 0)); return { id: "f", webViewLink: "https://drive/f" }; },
  };
  const ds = await Promise.all(Array.from({ length: 12 }, () =>
    crearDeposito(DB, {
      monto: 100, forma_pago: "EFECTIVO",
      archivo: { contenido_base64: Buffer.from("x").toString("base64"), tipo_mime: "image/jpeg", nombre_archivo: "f.jpg" },
    }, 1, { nombre: "Ana" }, driveLento)));
  const folios = new Set(ds.map((d) => d.folio));
  assert.strictEqual(folios.size, 12, "12 folios distintos");
});

test("cancelarDeposito no borra, exige motivo, y respeta el alcance", async () => {
  const DB = nuevoDB();
  const d = await crearDeposito(DB, { monto: 100, forma_pago: "EFECTIVO" }, 1, { nombre: "Ana" }, driveFalso);
  assert.throws(() => cancelarDeposito(DB, d.id, "  ", { nombre: "Ana" }, ALCANCE_TODAS), /motivo/);
  // una cajera de la sucursal 2 no puede cancelar un depósito de la 1
  const alcanceS2 = { verTodas: false, sucursalId: 2 };
  assert.throws(() => cancelarDeposito(DB, d.id, "error", { nombre: "Otra" }, alcanceS2), /no encontrado/);
  const c = cancelarDeposito(DB, d.id, "duplicado", { nombre: "Ana" }, ALCANCE_TODAS);
  assert.strictEqual(c.estatus, "cancelado");
});

test("listarDepositos respeta el alcance de sucursal", async () => {
  const DB = nuevoDB();
  await crearDeposito(DB, { monto: 100, forma_pago: "EFECTIVO" }, 1, { nombre: "Ana" }, driveFalso);
  await crearDeposito(DB, { monto: 200, forma_pago: "EFECTIVO" }, 2, { nombre: "Beto" }, driveFalso);
  const soloS1 = listarDepositos(DB, {}, { verTodas: false, sucursalId: 1 });
  assert.strictEqual(soloS1.length, 1);
  assert.strictEqual(soloS1[0].sucursal_id, 1);
});
