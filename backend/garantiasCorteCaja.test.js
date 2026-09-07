const { test } = require("node:test");
const assert = require("node:assert/strict");
const { construirDBPrueba } = require("./testHelpers");
const { sembrarCajas } = require("./cajas");
const { crearGarantia } = require("./garantias");
const { agregarGasto, crearCobroGarantia, eliminarGasto } = require("./garantiasGastos");
const { calcularCorteEnCurso, crearCorte, filtrarCorteEnCursoPorPermiso } = require("./cortes");
const USUARIO = { id: 1, nombre: "Ana" };
const TODAS = { verTodas: true, sucursalId: null };
const DRIVE = {
  asegurarCarpetaGarantia: async () => "carpeta-1",
  subirArchivoADrive: async () => ({ id: "file-1", webViewLink: "https://drive.google.com/file/d/file-1/view" }),
};

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

test("cobro efectivo sube 300 y gasto de flete baja 300 en su caja", async () => {
  const DB = prepararDB();
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
  crearCobroGarantia(DB, g.id, { monto: 300, forma_pago: "EFECTIVO" }, USUARIO, TODAS);
  assert.equal(calcularCorteEnCurso(DB, 1).calculado.EFECTIVO, 300);
  await agregarGasto(DB, g.id, { tipo: "traslado", monto: 300, forma_pago: "EFECTIVO" }, USUARIO, TODAS, DRIVE);
  const corte = calcularCorteEnCurso(DB, 1);
  assert.equal(corte.calculado.EFECTIVO, 0);
  assert.equal(corte.garantias_cobros_efectivo, 300);
  assert.equal(corte.garantias_gastos_efectivo, 300);
});

test("el gasto por sí solo baja el cajón", async () => {
  const DB = prepararDB();
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
  await agregarGasto(DB, g.id, { tipo: "traslado", monto: 300, forma_pago: "EFECTIVO" }, USUARIO, TODAS, DRIVE);
  assert.equal(calcularCorteEnCurso(DB, 1).calculado.EFECTIVO, -300);
});

for (const forma_pago of ["TRANSFERENCIA", "TARJETA"]) {
  test(`${forma_pago} no altera efectivo y ambos movimientos se sellan`, async () => {
    const DB = prepararDB();
    const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
    const cobro = crearCobroGarantia(DB, g.id, { monto: 300, forma_pago }, USUARIO, TODAS);
    const gasto = await agregarGasto(DB, g.id, { tipo: "traslado", monto: 200, forma_pago }, USUARIO, TODAS, DRIVE);
    const corte = crearCorte(DB, { sucursal_id: 1 });
    assert.equal(corte.calculado.EFECTIVO, 0);
    assert.equal(forma_pago === "TARJETA" ? corte.calculado.TARJETA : corte.transferencias, 300);
    assert.equal(cobro.corte_id, corte.id);
    assert.equal(gasto.corte_id, corte.id);
    const siguiente = calcularCorteEnCurso(DB, 1);
    assert.equal(siguiente.total_calculado, 0);
    assert.equal(siguiente.transferencias, 0);
  });
}

test("otra caja y otra sucursal no cuentan ni sellan estos movimientos", async () => {
  const DB = prepararDB();
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
  const fiscal = DB.pos.cajas.find((c) => c.sucursal_id === 1 && !c.predeterminada);
  const cobro = crearCobroGarantia(DB, g.id, { monto: 300, forma_pago: "EFECTIVO", caja_id: fiscal.id }, USUARIO, TODAS);
  const gasto = await agregarGasto(DB, g.id, { tipo: "traslado", monto: 100, forma_pago: "EFECTIVO", caja_id: fiscal.id }, USUARIO, TODAS, DRIVE);
  cobro.caja_id = String(cobro.caja_id);
  gasto.caja_id = String(gasto.caja_id);
  assert.equal(crearCorte(DB, { sucursal_id: 1 }).calculado.EFECTIVO, 0);
  assert.equal(crearCorte(DB, { sucursal_id: 2 }).calculado.EFECTIVO, 0);
  assert.equal(cobro.corte_id, null);
  assert.equal(gasto.corte_id, null);
  const corte = crearCorte(DB, { sucursal_id: 1, caja_id: fiscal.id });
  assert.equal(corte.calculado.EFECTIVO, 200);
  assert.equal(cobro.corte_id, corte.id);
  assert.equal(gasto.corte_id, corte.id);
});

test("movimientos con datos financieros y caja null pertenecen solo a predeterminada", async () => {
  const DB = prepararDB();
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
  const cobro = crearCobroGarantia(DB, g.id, { monto: 300, forma_pago: "EFECTIVO" }, USUARIO, TODAS);
  const gasto = await agregarGasto(DB, g.id, { tipo: "otro", monto: 100, forma_pago: "EFECTIVO" }, USUARIO, TODAS, DRIVE);
  cobro.caja_id = null;
  gasto.caja_id = null;
  const fiscal = DB.pos.cajas.find((c) => c.sucursal_id === 1 && !c.predeterminada);
  assert.equal(calcularCorteEnCurso(DB, 1, fiscal.id).calculado.EFECTIVO, 0);
  assert.equal(calcularCorteEnCurso(DB, 1).calculado.EFECTIVO, 200);
});

test("gastos históricos sin datos de dinero no alteran cortes ni se reescriben", () => {
  const DB = prepararDB();
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
  const viejo = { id: 1, garantia_id: g.id, tipo: "traslado", monto: 300, fecha: new Date().toISOString() };
  DB.inventario.garantia_gastos.push(viejo);
  const antes = JSON.stringify(viejo);
  assert.equal(crearCorte(DB, { sucursal_id: 1 }).calculado.EFECTIVO, 0);
  assert.equal(JSON.stringify(viejo), antes);
});

test("cobrar hoy y pagar después: dos cortes independientes sin repetir dinero", async () => {
  const DB = prepararDB();
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
  const cobro = crearCobroGarantia(DB, g.id, { monto: 300, forma_pago: "EFECTIVO" }, USUARIO, TODAS);
  const primero = crearCorte(DB, { sucursal_id: 1, contado: { EFECTIVO: 300 } });
  assert.equal(primero.calculado.EFECTIVO, 300);
  assert.equal(primero.diferencia.EFECTIVO, 0);
  assert.equal(cobro.corte_id, primero.id);
  const foto = JSON.stringify(primero);
  const gasto = await agregarGasto(DB, g.id, { tipo: "traslado", monto: 300, forma_pago: "EFECTIVO" }, USUARIO, TODAS, DRIVE);
  // Un reloj anterior al último corte no puede esconder dinero de la era sellada.
  gasto.fecha = DB.pos.corte_epoca;
  const segundo = crearCorte(DB, { sucursal_id: 1 });
  assert.equal(segundo.calculado.EFECTIVO, -300);
  assert.equal(gasto.corte_id, segundo.id);
  assert.equal(JSON.stringify(primero), foto);
  assert.equal(calcularCorteEnCurso(DB, 1).calculado.EFECTIVO, 0);
});

test("un gasto sellado no puede borrarse ni eliminar su comprobante", async () => {
  const DB = prepararDB();
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
  const gasto = await agregarGasto(DB, g.id, { tipo: "otro", monto: 300, forma_pago: "EFECTIVO" }, USUARIO, TODAS, DRIVE);
  gasto.corte_id = 7;
  gasto.drive_file_id = "file-1";
  const antes = JSON.stringify(DB.inventario);
  await assert.rejects(() => eliminarGasto(DB, g.id, gasto.id, USUARIO, TODAS, {
    eliminarArchivoDeDrive: async () => { assert.fail("No debe borrar Drive"); },
  }), /corte/i);
  assert.equal(JSON.stringify(DB.inventario), antes);
});

test("corte a ciegas no revela importes de garantías", () => {
  const DB = prepararDB();
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
  crearCobroGarantia(DB, g.id, { monto: 300, forma_pago: "EFECTIVO" }, USUARIO, TODAS);
  const oculto = filtrarCorteEnCursoPorPermiso(calcularCorteEnCurso(DB, 1), []);
  assert.equal(oculto.calculado.EFECTIVO, 0);
  assert.equal(oculto.garantias_cobros_efectivo, undefined);
});
