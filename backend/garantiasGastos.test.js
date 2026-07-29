const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { crearGarantia } = require("./garantias");
const {
  agregarGasto, listarGastos, totalGastos, eliminarGasto,
} = require("./garantiasGastos");

const ALCANCE_TODAS = { verTodas: true, sucursalId: null };
const USUARIO = { id: 1, nombre: "Ana" };

// Stub de Drive: registra llamadas sin tocar la API real.
function crearDriveStub() {
  const llamadas = { subidas: [], borrados: [] };
  return {
    asegurarCarpetaGarantia: async (DB, garantia) => "carpeta_" + garantia.folio,
    subirArchivoADrive: async (DB, { nombre }) => {
      llamadas.subidas.push(nombre);
      return { id: "file_" + llamadas.subidas.length, webViewLink: "https://drive/" + nombre };
    },
    eliminarArchivoDeDrive: async (DB, id) => { llamadas.borrados.push(id); },
    _llamadas: llamadas,
  };
}

const PDF_BASE64 = Buffer.from("contenido-pdf-de-prueba").toString("base64");

test("agregarGasto sin archivo: guarda monto/tipo, sin comprobante, suma al total y deja movimiento", async () => {
  const DB = construirDBPrueba();
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
  const drive = crearDriveStub();

  const gasto = await agregarGasto(DB, g.id, { tipo: "traslado", monto: 150 }, USUARIO, ALCANCE_TODAS, drive);

  assert.strictEqual(gasto.tipo, "traslado");
  assert.strictEqual(gasto.monto, 150);
  assert.strictEqual(gasto.drive_file_id, null);
  assert.strictEqual(gasto.nombre_archivo, null);
  assert.strictEqual(drive._llamadas.subidas.length, 0, "sin archivo => Drive no se llama");
  assert.strictEqual(totalGastos(DB, g.id), 150);

  const movs = DB.inventario.garantia_movimientos.filter((m) => m.garantia_id === g.id);
  assert.strictEqual(movs[movs.length - 1].tipo, "gasto");
});

test("agregarGasto con archivo: sube a Drive y guarda drive_file_id/link/nombre", async () => {
  const DB = construirDBPrueba();
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
  const drive = crearDriveStub();

  const gasto = await agregarGasto(DB, g.id, {
    tipo: "reparacion", monto: 350, descripcion: "cambio de etapa",
    archivo: { nombre_archivo: "factura.pdf", tipo_mime: "application/pdf", contenido_base64: PDF_BASE64 },
  }, USUARIO, ALCANCE_TODAS, drive);

  assert.strictEqual(drive._llamadas.subidas.length, 1);
  assert.strictEqual(gasto.nombre_archivo, "factura.pdf");
  assert.strictEqual(gasto.drive_file_id, "file_1");
  assert.match(gasto.drive_link, /drive/);
});

test("agregarGasto rechaza tipo inválido", async () => {
  const DB = construirDBPrueba();
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
  await assert.rejects(
    () => agregarGasto(DB, g.id, { tipo: "viaje_a_la_luna", monto: 10 }, USUARIO, ALCANCE_TODAS, crearDriveStub()),
    /tipo de gasto/i
  );
});

test("agregarGasto rechaza monto <= 0 o no numérico", async () => {
  const DB = construirDBPrueba();
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
  const drive = crearDriveStub();
  await assert.rejects(() => agregarGasto(DB, g.id, { tipo: "otro", monto: 0 }, USUARIO, ALCANCE_TODAS, drive), /monto/i);
  await assert.rejects(() => agregarGasto(DB, g.id, { tipo: "otro", monto: -5 }, USUARIO, ALCANCE_TODAS, drive), /monto/i);
  await assert.rejects(() => agregarGasto(DB, g.id, { tipo: "otro", monto: "abc" }, USUARIO, ALCANCE_TODAS, drive), /monto/i);
});

test("agregarGasto rechaza MIME no permitido", async () => {
  const DB = construirDBPrueba();
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
  await assert.rejects(
    () => agregarGasto(DB, g.id, {
      tipo: "traslado", monto: 10,
      archivo: { nombre_archivo: "malo.exe", tipo_mime: "application/octet-stream", contenido_base64: PDF_BASE64 },
    }, USUARIO, ALCANCE_TODAS, crearDriveStub()),
    /no permitido/i
  );
});

test("agregarGasto rechaza archivo mayor a 10MB", async () => {
  const DB = construirDBPrueba();
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
  const grande = Buffer.alloc(10 * 1024 * 1024 + 1).toString("base64");
  await assert.rejects(
    () => agregarGasto(DB, g.id, {
      tipo: "traslado", monto: 10,
      archivo: { nombre_archivo: "grande.pdf", tipo_mime: "application/pdf", contenido_base64: grande },
    }, USUARIO, ALCANCE_TODAS, crearDriveStub()),
    /10 MB/i
  );
});

test("agregarGasto respeta el guard de alcance", async () => {
  const DB = construirDBPrueba();
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO); // sucursal 1
  const alcanceOtra = { verTodas: false, sucursalId: 2 };
  await assert.rejects(
    () => agregarGasto(DB, g.id, { tipo: "otro", monto: 10 }, USUARIO, alcanceOtra, crearDriveStub()),
    /no encontrada/i
  );
});

test("listarGastos respeta el alcance y devuelve solo los de esa garantía", async () => {
  const DB = construirDBPrueba();
  const g1 = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
  const g2 = crearGarantia(DB, { producto_id: 1 }, 2, USUARIO);
  const drive = crearDriveStub();
  await agregarGasto(DB, g1.id, { tipo: "traslado", monto: 100 }, USUARIO, ALCANCE_TODAS, drive);
  await agregarGasto(DB, g2.id, { tipo: "traslado", monto: 200 }, USUARIO, ALCANCE_TODAS, drive);

  const lista = listarGastos(DB, g1.id, ALCANCE_TODAS);
  assert.strictEqual(lista.length, 1);
  assert.strictEqual(lista[0].monto, 100);

  await assert.rejects(async () => listarGastos(DB, g1.id, { verTodas: false, sucursalId: 2 }), /no encontrada/i);
});

test("eliminarGasto borra el archivo de Drive y el registro, y deja movimiento", async () => {
  const DB = construirDBPrueba();
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
  const drive = crearDriveStub();
  const gasto = await agregarGasto(DB, g.id, {
    tipo: "reparacion", monto: 350,
    archivo: { nombre_archivo: "f.pdf", tipo_mime: "application/pdf", contenido_base64: PDF_BASE64 },
  }, USUARIO, ALCANCE_TODAS, drive);

  const r = await eliminarGasto(DB, g.id, gasto.id, USUARIO, ALCANCE_TODAS, drive);

  assert.deepStrictEqual(r, { ok: true });
  assert.strictEqual(drive._llamadas.borrados.length, 1);
  assert.strictEqual(listarGastos(DB, g.id, ALCANCE_TODAS).length, 0);
  const movs = DB.inventario.garantia_movimientos.filter((m) => m.garantia_id === g.id);
  assert.strictEqual(movs[movs.length - 1].tipo, "gasto_eliminado");
});

test("eliminarGasto respeta el guard de alcance", async () => {
  const DB = construirDBPrueba();
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
  const drive = crearDriveStub();
  const gasto = await agregarGasto(DB, g.id, { tipo: "otro", monto: 10 }, USUARIO, ALCANCE_TODAS, drive);
  await assert.rejects(
    () => eliminarGasto(DB, g.id, gasto.id, USUARIO, { verTodas: false, sucursalId: 2 }, drive),
    /no encontrada/i
  );
});

test("listarGarantias incluye total_gastos", async () => {
  const { listarGarantias } = require("./garantias");
  const DB = construirDBPrueba();
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
  const drive = crearDriveStub();
  await agregarGasto(DB, g.id, { tipo: "traslado", monto: 100 }, USUARIO, ALCANCE_TODAS, drive);
  await agregarGasto(DB, g.id, { tipo: "reparacion", monto: 350 }, USUARIO, ALCANCE_TODAS, drive);

  const fila = listarGarantias(DB, ALCANCE_TODAS).find((x) => x.id === g.id);
  assert.strictEqual(fila.total_gastos, 450);
});
