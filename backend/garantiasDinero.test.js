const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { construirDBPrueba } = require("./testHelpers");
const { sembrarCajas } = require("./cajas");
const { crearGarantia } = require("./garantias");
const { agregarGasto, crearCobroGarantia, listarCobros } = require("./garantiasGastos");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "garantias-dinero-")), "datos.sqlite");
process.env.JWT_SECRET = process.env.JWT_SECRET || "secreto-de-pruebas";
const app = require("./server");
const { sembrarCuentas } = require("./testHelpers");
const { firmarToken } = require("./auth");
const { crearRol } = require("./roles");
const { spawnSync } = require("node:child_process");
let servidor, base, token;
before(async () => {
  sembrarCuentas(app, [{ id: 91, rol_id: 1, sucursal_id: 1 }]);
  token = firmarToken({ id: 91, nombre: "Ana", rol_id: 1, sucursal_id: 1 });
  await new Promise((listo) => { servidor = app.listen(0, listo); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(async () => {
  if (servidor) await new Promise((listo) => servidor.close(listo));
});

test("ruta de gasto usa cuerpo y caso aunque el encabezado filtre otra tienda", async () => {
  const g = crearGarantia(app.DB, { producto_id: 1 }, 1, USUARIO);
  const caja = app.DB.pos.cajas.find((c) => c.sucursal_id === 1 && !c.predeterminada);
  const r = await fetch(`${base}/api/garantias/${g.id}/gastos?sucursal_id=2&caja_id=99999`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ tipo: "traslado", monto: 300, forma_pago: "EFECTIVO", caja_id: String(caja.id) }),
  });
  const gasto = await r.json();
  assert.equal(r.status, 200, JSON.stringify(gasto));
  assert.equal(gasto.caja_id, caja.id);
  assert.equal(gasto.sucursal_id, 1);
  assert.equal(gasto.forma_pago, "EFECTIVO");
});

const USUARIO = { id: 1, nombre: "Ana" };
const TODAS = { verTodas: true, sucursalId: null };
const DRIVE = {
  asegurarCarpetaGarantia: async () => "carpeta-1",
  subirArchivoADrive: async () => ({ id: "file-1", webViewLink: "https://drive.google.com/file/d/file-1/view" }),
};

function prepararDB() {
  const DB = construirDBPrueba();
  DB.pos.cajas = [];
  sembrarCajas(DB);
  return DB;
}

for (const forma_pago of ["EFECTIVO", "TARJETA", "TRANSFERENCIA"]) {
  test(`el gasto ${forma_pago} guarda caja declarada en texto y sucursal del caso`, async () => {
    const DB = prepararDB();
    const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
    const caja = DB.pos.cajas.find((c) => c.sucursal_id === 1 && !c.predeterminada);
    const gasto = await agregarGasto(DB, g.id, {
      tipo: "traslado", monto: 300, forma_pago, caja_id: String(caja.id), sucursal_id: 2,
    }, USUARIO, TODAS, DRIVE);
    assert.equal(gasto.forma_pago, forma_pago);
    assert.equal(gasto.caja_id, caja.id);
    assert.equal(gasto.sucursal_id, 1);
    assert.equal(gasto.corte_id, null);
  });
}

test("el gasto sin caja usa la predeterminada del caso", async () => {
  const DB = prepararDB();
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
  const gasto = await agregarGasto(DB, g.id, { tipo: "otro", monto: 300, forma_pago: "EFECTIVO" }, USUARIO, TODAS, DRIVE);
  assert.equal(gasto.caja_id, DB.pos.cajas.find((c) => c.sucursal_id === 1 && c.predeterminada).id);
});

for (const forma_pago of [undefined, null, "", "PAGARE", "CR�DITO", false, 0, {}, ["EFECTIVO"]]) {
  test(`rechaza forma de pago inválida ${JSON.stringify(forma_pago)} sin mutar`, async () => {
    const DB = prepararDB();
    const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
    const antes = JSON.stringify(DB.inventario);
    await assert.rejects(() => agregarGasto(DB, g.id, { tipo: "otro", monto: 300, forma_pago }, USUARIO, TODAS, DRIVE), /forma de pago/i);
    assert.equal(JSON.stringify(DB.inventario), antes);
  });
}

test("rechaza caja ajena e inexistente antes de subir el comprobante", async () => {
  const DB = prepararDB();
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
  for (const caja_id of [99999, DB.pos.cajas.find((c) => c.sucursal_id === 2).id]) {
    const antes = JSON.stringify(DB.inventario);
    await assert.rejects(() => agregarGasto(DB, g.id, {
      tipo: "otro", monto: 300, forma_pago: "EFECTIVO", caja_id,
      archivo: { nombre_archivo: "f.pdf", tipo_mime: "application/pdf", contenido_base64: Buffer.from("prueba").toString("base64") },
    }, USUARIO, TODAS, {
      asegurarCarpetaGarantia: async () => { assert.fail("No debe tocar Drive"); },
    }), /caja/i);
    assert.equal(JSON.stringify(DB.inventario), antes);
  }
});

for (const forma_pago of ["EFECTIVO", "TARJETA", "TRANSFERENCIA"]) {
  test(`cobro ${forma_pago}: conserva dinero, responsable, caja y bitácora`, () => {
    assert.equal(typeof crearCobroGarantia, "function");
    const DB = prepararDB();
    const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
    const caja = DB.pos.cajas.find((c) => c.sucursal_id === 1 && !c.predeterminada);
    const cobro = crearCobroGarantia(DB, g.id, {
      monto: "300.50", forma_pago, caja_id: String(caja.id), sucursal_id: 2, descripcion: "Flete de ida",
    }, USUARIO, TODAS);
    assert.equal(cobro.garantia_id, g.id);
    assert.equal(cobro.monto, 300.5);
    assert.equal(cobro.forma_pago, forma_pago);
    assert.equal(cobro.caja_id, caja.id);
    assert.equal(cobro.sucursal_id, 1);
    assert.equal(cobro.corte_id, null);
    assert.equal(cobro.usuario, "Ana");
    assert.equal(cobro.descripcion, "Flete de ida");
    assert.ok(Number.isFinite(Date.parse(cobro.fecha)));
    assert.deepEqual(DB.inventario.garantia_cobros, [cobro]);
    const mov = DB.inventario.garantia_movimientos.at(-1);
    assert.equal(mov.garantia_id, g.id);
    assert.equal(mov.tipo, "cobro");
    assert.equal(mov.usuario, "Ana");
    assert.match(mov.descripcion, /300\.50.*Flete de ida/);
  });
}

test("cobros: caja predeterminada, ids únicos y listado del caso con alcance", () => {
  assert.equal(typeof crearCobroGarantia, "function");
  const DB = prepararDB();
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
  const otra = crearGarantia(DB, { producto_id: 1 }, 2, USUARIO);
  const datos = { monto: 300, forma_pago: "EFECTIVO" };
  const cobro = crearCobroGarantia(DB, g.id, datos, USUARIO, TODAS);
  const segundo = crearCobroGarantia(DB, otra.id, datos, USUARIO, TODAS);
  assert.notEqual(cobro.id, segundo.id);
  assert.equal(cobro.caja_id, DB.pos.cajas.find((c) => c.sucursal_id === 1 && c.predeterminada).id);
  assert.deepEqual(listarCobros(DB, String(g.id), TODAS), [cobro]);
  const antes = JSON.stringify(DB.inventario);
  const ajeno = { verTodas: false, sucursalId: 2 };
  assert.throws(() => crearCobroGarantia(DB, g.id, datos, USUARIO, ajeno), /no encontrada/i);
  assert.throws(() => listarCobros(DB, g.id, ajeno), /no encontrada/i);
  assert.throws(() => crearCobroGarantia(DB, 99999, datos, USUARIO, TODAS), /no encontrada/i);
  assert.equal(JSON.stringify(DB.inventario), antes);
});

for (const monto of [0, -1, "abc", null, undefined, Infinity, true, [300], {}]) {
  test(`cobro rechaza monto ${String(monto)} sin guardar dinero ni bitácora`, () => {
    assert.equal(typeof crearCobroGarantia, "function");
    const DB = prepararDB();
    const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
    const antes = JSON.stringify(DB.inventario);
    assert.throws(() => crearCobroGarantia(DB, g.id, { monto, forma_pago: "EFECTIVO" }, USUARIO, TODAS), /monto/i);
    assert.equal(JSON.stringify(DB.inventario), antes);
  });
}

test("cobro rechaza formas inválidas y cajas ajenas o inexistentes", () => {
  assert.equal(typeof crearCobroGarantia, "function");
  const DB = prepararDB();
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
  const antes = JSON.stringify(DB.inventario);
  for (const forma_pago of [undefined, "PAGARE", "CR�DITO", ["EFECTIVO"]]) {
    assert.throws(() => crearCobroGarantia(DB, g.id, { monto: 300, forma_pago }, USUARIO, TODAS), /forma de pago/i);
  }
  for (const caja_id of [99999, String(DB.pos.cajas.find((c) => c.sucursal_id === 2).id)]) {
    assert.throws(() => crearCobroGarantia(DB, g.id, { monto: 300, forma_pago: "EFECTIVO", caja_id }, USUARIO, TODAS), /caja/i);
  }
  assert.equal(JSON.stringify(DB.inventario), antes);
});

test("rutas de cobro: mismo permiso, caja del cuerpo, usuario del token y consulta persistida", async () => {
  const vecinos = ["crear_producto", "realizar_traspasos", "recibir_compra"];
  const { PERMISOS } = require("./permisosCatalogo");
  for (const clave of vecinos) assert.ok(PERMISOS.some((p) => p.clave === clave && p.modulo === "inventario"));
  const rol = crearRol(app.DB, { nombre: "Inventario sin garantías", permisos: vecinos, modulos: ["inventario"] });
  sembrarCuentas(app, [{ id: 92, rol_id: rol.id, sucursal_id: 1 }]);
  const sinPermiso = firmarToken({ id: 92, nombre: "Consulta", rol_id: rol.id, sucursal_id: 1 });
  const g = crearGarantia(app.DB, { producto_id: 1 }, 1, USUARIO);
  const caja = app.DB.pos.cajas.find((c) => c.sucursal_id === 1 && !c.predeterminada);
  const url = `${base}/api/garantias/${g.id}/cobros?sucursal_id=2&caja_id=99999`;
  const payload = { monto: 300, forma_pago: "EFECTIVO", caja_id: String(caja.id), usuario: "Falso" };
  const denegado = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${sinPermiso}` }, body: JSON.stringify(payload) });
  assert.equal(denegado.status, 403);
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(payload) });
  assert.equal(r.status, 200);
  const cobro = await r.json();
  assert.equal(cobro.caja_id, caja.id);
  assert.equal(cobro.usuario, "Ana");
  const listado = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(listado.status, 200);
  assert.deepEqual(await listado.json(), [cobro]);
  const { cargar } = require("./persistencia");
  assert.ok(cargar().inventario.garantia_cobros.some((c) => c.id === cobro.id && c.garantia_id === g.id));
});

test("el servidor recupera los cobros al reiniciar desde SQLite", () => {
  const g = crearGarantia(app.DB, { producto_id: 1 }, 1, USUARIO);
  const cobro = crearCobroGarantia(app.DB, g.id, { monto: 345.67, forma_pago: "EFECTIVO" }, USUARIO, TODAS);
  require("./persistencia").guardar(app.DB);
  const reinicio = spawnSync(process.execPath, ["--preserve-symlinks", "--preserve-symlinks-main", "-e", `
    const app = require('./server');
    console.log('COBROS_RESTAURADOS=' + JSON.stringify(app.DB.inventario.garantia_cobros || []));
    process.exit(0);
  `], { cwd: __dirname, env: { ...process.env }, encoding: "utf8", timeout: 30000 });
  assert.equal(reinicio.status, 0, reinicio.stderr);
  const linea = reinicio.stdout.split(/\r?\n/).find((l) => l.startsWith("COBROS_RESTAURADOS="));
  assert.ok(linea, reinicio.stdout);
  const restaurados = JSON.parse(linea.slice("COBROS_RESTAURADOS=".length));
  assert.deepEqual(restaurados.find((c) => c.id === cobro.id), cobro);
});
