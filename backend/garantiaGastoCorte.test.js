/**
 * Un gasto de garantía que ya contó un corte no puede desaparecer: el corte
 * conserva el dinero que descontó y nadie podría explicar de dónde salió.
 *
 * El borrado espera a Drive para quitar el comprobante. Si la revisión del
 * sello y el borrado del registro quedan separados por esa espera, un corte
 * puede cerrarse en medio y sellar un gasto que un instante después se borra.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { construirDBPrueba } = require("./testHelpers");
const { sembrarCajas } = require("./cajas");
const { crearGarantia } = require("./garantias");
const { agregarGasto, eliminarGasto } = require("./garantiasGastos");
const { crearCorte } = require("./cortes");

const USUARIO = { id: 1, nombre: "Ana" };
const TODAS = { verTodas: true, sucursalId: null };
const PDF = { nombre_archivo: "flete.pdf", tipo_mime: "application/pdf", contenido_base64: Buffer.from("pdf").toString("base64") };

function prepararDB() {
  const DB = construirDBPrueba();
  DB.pos.ventas = [];
  DB.pos.venta_detalle = [];
  DB.pos.cortes_caja = [];
  DB.pos.apartado_abonos = [];
  DB.pos.cajas = [];
  DB.pos.corte_epoca = "2026-01-01T00:00:00.000Z";
  sembrarCajas(DB);
  return DB;
}

// Drive que no contesta hasta que la prueba lo libera: así se puede cerrar un
// corte justo mientras el borrado espera.
function driveEnEspera() {
  let n = 0;
  const pendientes = [];
  return {
    asegurarCarpetaGarantia: async () => "carpeta-1",
    subirArchivoADrive: async () => { n += 1; return { id: `file-${n}`, webViewLink: `https://drive/file-${n}` }; },
    eliminarArchivoDeDrive: () => new Promise((resolve) => pendientes.push(resolve)),
    liberar: () => pendientes.splice(0).forEach((resolve) => resolve()),
  };
}

async function gastoConComprobante(DB, garantia, drive, monto = 300) {
  return agregarGasto(DB, garantia.id, { tipo: "traslado", monto, forma_pago: "EFECTIVO", archivo: PDF }, USUARIO, TODAS, drive);
}

test("un corte que se cierra mientras se borra el gasto no se queda sin su respaldo", async () => {
  const DB = prepararDB();
  const drive = driveEnEspera();
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
  const gasto = await gastoConComprobante(DB, g, drive);

  const borrado = eliminarGasto(DB, g.id, gasto.id, USUARIO, TODAS, drive).catch((e) => e);
  const corte = crearCorte(DB, { sucursal_id: 1 });
  drive.liberar();
  await borrado;

  const respaldados = DB.inventario.garantia_gastos
    .filter((x) => x.corte_id === corte.id && x.forma_pago === "EFECTIVO")
    .reduce((s, x) => s + Number(x.monto), 0);
  assert.equal(respaldados, corte.garantias_gastos_efectivo,
    "todo peso de gasto que el corte descontó tiene que seguir registrado");
});

test("dos borrados al mismo tiempo quitan cada uno su gasto y no otro", async () => {
  const DB = prepararDB();
  const drive = driveEnEspera();
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
  const primero = await gastoConComprobante(DB, g, drive, 100);
  const segundo = await gastoConComprobante(DB, g, drive, 200);
  const tercero = await gastoConComprobante(DB, g, drive, 300);

  const a = eliminarGasto(DB, g.id, primero.id, USUARIO, TODAS, drive);
  const b = eliminarGasto(DB, g.id, segundo.id, USUARIO, TODAS, drive);
  drive.liberar();
  await Promise.all([a, b]);

  assert.deepEqual(DB.inventario.garantia_gastos.map((x) => x.id), [tercero.id]);
});

test("un gasto sin sellar se sigue pudiendo borrar", async () => {
  const DB = prepararDB();
  const drive = driveEnEspera();
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
  const gasto = await gastoConComprobante(DB, g, drive);

  const borrado = eliminarGasto(DB, g.id, gasto.id, USUARIO, TODAS, drive);
  drive.liberar();
  assert.deepEqual(await borrado, { ok: true });
  assert.equal(DB.inventario.garantia_gastos.length, 0);
});

test("un gasto de la era sin sello que ya contó un corte de su caja no se borra", async () => {
  const DB = prepararDB();
  const drive = driveEnEspera();
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
  const gasto = await gastoConComprobante(DB, g, drive);
  gasto.fecha = "2025-12-01T10:00:00.000Z";
  DB.pos.cortes_caja.push({ id: 1, sucursal_id: 1, caja_id: gasto.caja_id, fecha_hora: "2025-12-01T20:00:00.000Z" });

  await assert.rejects(() => eliminarGasto(DB, g.id, gasto.id, USUARIO, TODAS, {
    eliminarArchivoDeDrive: async () => { assert.fail("No debe borrar el comprobante"); },
  }), /corte/i);
  assert.equal(DB.inventario.garantia_gastos.length, 1);
});

test("un gasto viejo sin datos de dinero se sigue pudiendo borrar aunque haya cortes después", async () => {
  // Nunca entró a ningún corte (no declaraba forma de pago): bloquearlo solo le
  // quitaría la herramienta a quien lo capturó mal.
  const DB = prepararDB();
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
  DB.inventario.garantia_gastos.push({ id: 1, garantia_id: g.id, tipo: "traslado", monto: 300, fecha: "2025-12-01T10:00:00.000Z" });
  DB.pos.cortes_caja.push({ id: 1, sucursal_id: 1, caja_id: null, fecha_hora: "2025-12-01T20:00:00.000Z" });

  assert.deepEqual(await eliminarGasto(DB, g.id, 1, USUARIO, TODAS, {}), { ok: true });
  assert.equal(DB.inventario.garantia_gastos.length, 0);
});

test("si Drive falla, el gasto se borra igual y la bitácora dice que el comprobante quedó en Drive", async () => {
  const DB = prepararDB();
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
  const gasto = await gastoConComprobante(DB, g, driveEnEspera());

  const r = await eliminarGasto(DB, g.id, gasto.id, USUARIO, TODAS, {
    eliminarArchivoDeDrive: async () => { throw new Error("Google Drive no responde"); },
  });
  assert.equal(r.ok, true);
  assert.equal(DB.inventario.garantia_gastos.length, 0);
  const bitacora = JSON.stringify(DB.inventario.garantia_movimientos.filter((m) => m.garantia_id === g.id));
  assert.match(bitacora, /flete\.pdf/);
  assert.match(bitacora, /Drive/);
});
