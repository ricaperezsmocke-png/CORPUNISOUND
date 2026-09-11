const { test } = require("node:test");
const assert = require("node:assert/strict");
const { construirDBPrueba } = require("./testHelpers");
const { sembrarCajas } = require("./cajas");
const { corregirOrigenGasto } = require("./gastos");

function prepararDB() {
  const DB = construirDBPrueba();
  DB.pos.ventas = [];
  DB.pos.venta_detalle = [];
  DB.pos.cortes_caja = [];
  DB.pos.apartado_abonos = [];
  DB.pos.cajas = [];
  sembrarCajas(DB);
  DB.gastos.gastos = [];
  DB.gastos.gasto_movimientos = [];
  return DB;
}

let siguienteGasto = 1;
function crearGastoDePrueba(DB, extra = {}) {
  const gasto = {
    id: siguienteGasto++,
    sucursal_id: 1,
    caja_id: null,
    monto: 300,
    forma_pago: "EFECTIVO",
    origen: "CAJA_FUERTE",
    estatus: "activo",
    corte_id: null,
    fecha_hora: "2026-09-01T10:00:00.000Z",
    ...extra,
  };
  DB.gastos.gastos.push(gasto);
  return gasto;
}

test("no se puede corregir el origen de un gasto de otra sucursal", () => {
  const DB = prepararDB();
  const g = crearGastoDePrueba(DB, { sucursal_id: 2, origen: "CAJA_FUERTE" });
  assert.throws(() => corregirOrigenGasto(DB, g.id, { origen: "CAJON" },
    { id: 9, nombre: "Ana" }, { verTodas: false, sucursalId: 1 }), /no encontrado/i);
  assert.equal(DB.gastos.gastos.find((x) => x.id === g.id).origen, "CAJA_FUERTE",
    "y el gasto no se toco");
});

test("el administrador que ve todas SI puede corregirlo", () => {
  const DB = prepararDB();
  const g = crearGastoDePrueba(DB, { sucursal_id: 2, origen: "CAJA_FUERTE" });
  const r = corregirOrigenGasto(DB, g.id, { origen: "CAJON" }, { id: 1, nombre: "Victor" },
    { verTodas: true, sucursalId: null });
  assert.equal(r.origen, "CAJON");
});

test("sin alcance falla CERRANDO, no abriendo", () => {
  const DB = prepararDB();
  const g = crearGastoDePrueba(DB, { sucursal_id: 2, origen: "CAJA_FUERTE" });
  for (const alcance of [undefined, null, {}, { verTodas: false, sucursalId: null }]) {
    assert.throws(() => corregirOrigenGasto(DB, g.id, { origen: "CAJON" },
      { id: 9, nombre: "Ana" }, alcance), undefined, `paso con el alcance: ${JSON.stringify(alcance)}`);
  }
});

test("si la caja es invalida, el origen NO queda cambiado a medias", () => {
  const DB = prepararDB();
  const g = crearGastoDePrueba(DB, { sucursal_id: 1, origen: "CAJA_FUERTE" });
  assert.throws(() => corregirOrigenGasto(DB, g.id, { origen: "CAJON", caja_id: 99999 },
    { id: 1, nombre: "Victor" }, { verTodas: true, sucursalId: null }));
  assert.equal(DB.gastos.gastos.find((x) => x.id === g.id).origen, "CAJA_FUERTE",
    "el objeto vivo no puede quedar mutado tras un error");
});

test("un gasto anterior al ultimo corte no se corrige aunque no tenga sello", () => {
  const DB = prepararDB();
  const caja = DB.pos.cajas.find((c) => c.sucursal_id === 1);
  const g = crearGastoDePrueba(DB, { sucursal_id: 1, origen: "CAJA_FUERTE", caja_id: caja.id });
  g.corte_id = null;
  g.fecha_hora = "2026-01-01T10:00:00.000Z";
  DB.pos.cortes_caja.push({ id: 1, sucursal_id: 1, caja_id: caja.id,
    fecha_hora: "2026-02-01T10:00:00.000Z" });
  assert.throws(() => corregirOrigenGasto(DB, g.id, { origen: "CAJON" },
    { id: 1, nombre: "Victor" }, { verTodas: true, sucursalId: null }), /corte/i);
});

test("toda correccion deja bitacora con quien la hizo", () => {
  const DB = prepararDB();
  const g = crearGastoDePrueba(DB, { sucursal_id: 1, origen: "CAJA_FUERTE" });
  corregirOrigenGasto(DB, g.id, { origen: "CAJON" }, { id: 1, nombre: "Victor" },
    { verTodas: true, sucursalId: null });
  const movs = DB.gastos.gasto_movimientos.filter((m) => m.gasto_id === g.id);
  assert.ok(movs.some((m) => String(m.usuario).includes("Victor")),
    "una operacion de dinero sin nombre encima no se puede explicar despues");
});
