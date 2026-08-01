const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { listarCategorias, desactivarCategoria } = require("./gastosCategorias");
const { crearGasto, cancelarGasto, listarGastos, movimientosDeGasto } = require("./gastos");

const ALCANCE_TODAS = { verTodas: true, sucursalId: null };
const USUARIO = { nombre: "Victor" };

/** Drive simulado: registra lo que se le pidió, sin tocar la API real. */
function driveFalso() {
  const subidas = [];
  return {
    subidas,
    asegurarCarpetaGastosSucursal: async () => "carpeta-1",
    subirArchivoADrive: async (DB, args) => {
      subidas.push(args);
      return { id: `file-${subidas.length}`, webViewLink: `https://drive.google.com/file/d/file-${subidas.length}/view` };
    },
  };
}

function idHoja(DB, nombre) {
  return listarCategorias(DB, {}).find((c) => c.nombre === nombre).id;
}

const ARCHIVO_OK = {
  nombre_archivo: "ticket.jpg",
  tipo_mime: "image/jpeg",
  contenido_base64: Buffer.from("foto falsa").toString("base64"),
};

function datosBase(DB, extra = {}) {
  return {
    categoria_id: idHoja(DB, "Combustible"),
    concepto: "Gasolina de la camioneta",
    monto: 500,
    forma_pago: "EFECTIVO",
    archivo: ARCHIVO_OK,
    ...extra,
  };
}

test("crearGasto: guarda el gasto con folio, comprobante y bitácora", async () => {
  const DB = construirDBPrueba();
  const drive = driveFalso();

  const g = await crearGasto(DB, datosBase(DB), 1, USUARIO, drive);

  assert.strictEqual(g.folio, "GA-0001");
  assert.strictEqual(g.sucursal_id, 1);
  assert.strictEqual(g.monto, 500);
  assert.strictEqual(g.estatus, "activo");
  assert.strictEqual(g.usuario, "Victor");
  assert.strictEqual(g.drive_file_id, "file-1");
  assert.ok(g.drive_link.includes("file-1"));
  assert.strictEqual(g.nombre_archivo, "ticket.jpg");
  assert.strictEqual(drive.subidas.length, 1);

  const movs = DB.gastos.gasto_movimientos.filter((m) => m.gasto_id === g.id);
  assert.strictEqual(movs.length, 1);
  assert.strictEqual(movs[0].tipo, "creacion");
});

test("crearGasto: la sucursal sale del TOKEN, nunca del cuerpo de la petición", async () => {
  const DB = construirDBPrueba();
  // El body intenta colar la sucursal 3; el token dice 2. Gana el token.
  const g = await crearGasto(DB, datosBase(DB, { sucursal_id: 3 }), 2, USUARIO, driveFalso());
  assert.strictEqual(g.sucursal_id, 2);
});

test("crearGasto: SIN archivo lo rechaza (el comprobante es obligatorio)", async () => {
  const DB = construirDBPrueba();
  await assert.rejects(
    () => crearGasto(DB, datosBase(DB, { archivo: undefined }), 1, USUARIO, driveFalso()),
    /comprobante/i
  );
  assert.strictEqual(DB.gastos.gastos.length, 0, "no debe quedar ningún gasto");
});

test("crearGasto: si la subida a Drive falla, NO queda un gasto a medias", async () => {
  const DB = construirDBPrueba();
  const driveRoto = {
    asegurarCarpetaGastosSucursal: async () => "carpeta-1",
    subirArchivoADrive: async () => { throw new Error("Error al refrescar el token de Google Drive"); },
  };

  await assert.rejects(() => crearGasto(DB, datosBase(DB), 1, USUARIO, driveRoto), /Drive/i);

  assert.strictEqual(DB.gastos.gastos.length, 0, "no puede existir un gasto sin comprobante");
  assert.strictEqual(DB.gastos.gasto_movimientos.length, 0, "ni un renglón de bitácora huérfano");
});

test("crearGasto: valida categoría, concepto, monto y forma de pago", async () => {
  const DB = construirDBPrueba();
  const drive = driveFalso();
  const grupoId = listarCategorias(DB, {}).find((c) => c.categoria_padre_id === null).id;

  await assert.rejects(() => crearGasto(DB, datosBase(DB, { categoria_id: grupoId }), 1, USUARIO, drive), /subcategoría/i);
  await assert.rejects(() => crearGasto(DB, datosBase(DB, { categoria_id: 9999 }), 1, USUARIO, drive), /no encontrad/i);
  await assert.rejects(() => crearGasto(DB, datosBase(DB, { concepto: "   " }), 1, USUARIO, drive), /concepto/i);
  await assert.rejects(() => crearGasto(DB, datosBase(DB, { monto: 0 }), 1, USUARIO, drive), /mayor que cero/i);
  await assert.rejects(() => crearGasto(DB, datosBase(DB, { monto: "abc" }), 1, USUARIO, drive), /mayor que cero/i);
  await assert.rejects(() => crearGasto(DB, datosBase(DB, { forma_pago: "BITCOIN" }), 1, USUARIO, drive), /forma de pago/i);

  assert.strictEqual(DB.gastos.gastos.length, 0);
});

test("crearGasto: rechaza una categoría desactivada", async () => {
  const DB = construirDBPrueba();
  const id = idHoja(DB, "Multas");
  desactivarCategoria(DB, id);
  await assert.rejects(
    () => crearGasto(DB, datosBase(DB, { categoria_id: id }), 1, USUARIO, driveFalso()),
    /desactivada/i
  );
});

test("crearGasto: valida el tipo y el tamaño del comprobante", async () => {
  const DB = construirDBPrueba();
  const drive = driveFalso();

  await assert.rejects(
    () => crearGasto(DB, datosBase(DB, { archivo: { ...ARCHIVO_OK, tipo_mime: "application/zip" } }), 1, USUARIO, drive),
    /PDF, JPG o PNG/i
  );

  const enorme = Buffer.alloc(10 * 1024 * 1024 + 1).toString("base64");
  await assert.rejects(
    () => crearGasto(DB, datosBase(DB, { archivo: { ...ARCHIVO_OK, contenido_base64: enorme } }), 1, USUARIO, drive),
    /10 MB/i
  );
});

test("cancelarGasto: exige motivo, NO borra, y queda en la bitácora", async () => {
  const DB = construirDBPrueba();
  const g = await crearGasto(DB, datosBase(DB), 1, USUARIO, driveFalso());

  assert.throws(() => cancelarGasto(DB, g.id, "   ", USUARIO, ALCANCE_TODAS), /motivo/i);

  const r = cancelarGasto(DB, g.id, "Se capturó dos veces", USUARIO, ALCANCE_TODAS);

  assert.strictEqual(r.estatus, "cancelado");
  assert.strictEqual(r.motivo_cancelacion, "Se capturó dos veces");
  assert.strictEqual(DB.gastos.gastos.length, 1, "el registro sigue existiendo");
  assert.strictEqual(r.drive_file_id, "file-1", "el comprobante en Drive no se borra");

  const movs = DB.gastos.gasto_movimientos.filter((m) => m.gasto_id === g.id);
  assert.strictEqual(movs[movs.length - 1].tipo, "cancelacion");
});

test("cancelarGasto: no se puede cancelar dos veces", async () => {
  const DB = construirDBPrueba();
  const g = await crearGasto(DB, datosBase(DB), 1, USUARIO, driveFalso());
  cancelarGasto(DB, g.id, "Duplicado", USUARIO, ALCANCE_TODAS);
  assert.throws(() => cancelarGasto(DB, g.id, "Otra vez", USUARIO, ALCANCE_TODAS), /ya está cancelado/i);
});

test("cancelarGasto: un usuario de OTRA sucursal no puede cancelarlo ni por folio", async () => {
  const DB = construirDBPrueba();
  const g = await crearGasto(DB, datosBase(DB), 1, USUARIO, driveFalso());

  assert.throws(
    () => cancelarGasto(DB, g.id, "Intento", USUARIO, { verTodas: false, sucursalId: 2 }),
    /Gasto no encontrado/,
    "no revela que existe en otra tienda"
  );
  assert.strictEqual(DB.gastos.gastos[0].estatus, "activo", "sigue intacto");
});

test("listarGastos: respeta el alcance y enriquece con nombres", async () => {
  const DB = construirDBPrueba();
  await crearGasto(DB, datosBase(DB), 1, USUARIO, driveFalso());
  await crearGasto(DB, datosBase(DB, { concepto: "Luz del mes", categoria_id: idHoja(DB, "Luz") }), 2, USUARIO, driveFalso());

  const todas = listarGastos(DB, {}, ALCANCE_TODAS);
  assert.strictEqual(todas.length, 2);
  const gasolina = todas.find((g) => g.concepto === "Gasolina de la camioneta");
  assert.strictEqual(gasolina.categoria_nombre, "Combustible");
  assert.strictEqual(gasolina.grupo_nombre, "Operación");
  assert.strictEqual(gasolina.sucursal_nombre, "Ocosingo");

  const soloYajalon = listarGastos(DB, {}, { verTodas: false, sucursalId: 2 });
  assert.deepStrictEqual(soloYajalon.map((g) => g.concepto), ["Luz del mes"]);
});

test("movimientosDeGasto: respeta el alcance", async () => {
  const DB = construirDBPrueba();
  const g = await crearGasto(DB, datosBase(DB), 1, USUARIO, driveFalso());

  assert.strictEqual(movimientosDeGasto(DB, g.id, ALCANCE_TODAS).length, 1);
  assert.throws(() => movimientosDeGasto(DB, g.id, { verTodas: false, sucursalId: 2 }), /Gasto no encontrado/);
});
