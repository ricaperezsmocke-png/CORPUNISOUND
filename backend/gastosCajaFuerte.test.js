const { test } = require("node:test");
const assert = require("node:assert/strict");
const { construirDBPrueba } = require("./testHelpers");
const { sembrarCajas } = require("./cajas");
const { listarCategorias } = require("./gastosCategorias");
const { crearGasto, gastosEfectivoDelTurno } = require("./gastos");
const { calcularCorteEnCurso } = require("./cortes");

const USUARIO = { id: 1, nombre: "Victor" };
const DRIVE = {
  asegurarCarpetaGastosSucursal: async () => "carpeta-1",
  subirArchivoADrive: async () => ({ id: "file-1", webViewLink: "https://drive.google.com/file/d/file-1/view" }),
};

// Patrón local de cajas.test.js: sembrarCajas muta DB, no devuelve la lista.
function prepararDB() {
  const DB = construirDBPrueba();
  DB.pos.ventas = [];
  DB.pos.venta_detalle = [];
  DB.pos.cortes_caja = [];
  DB.pos.apartado_abonos = [];
  DB.pos.cajas = [];
  sembrarCajas(DB);
  return DB;
}

function datosBase(DB, extra = {}) {
  return {
    categoria_id: listarCategorias(DB, {}).find((c) => c.nombre === "Combustible").id,
    concepto: "Gasolina de la camioneta",
    monto: 800,
    forma_pago: "EFECTIVO",
    archivo: {
      nombre_archivo: "ticket.jpg", tipo_mime: "image/jpeg",
      contenido_base64: Buffer.from("foto falsa").toString("base64"),
    },
    ...extra,
  };
}

test("un gasto de caja fuerte no resta ni se cuenta en el corte del cajón", async () => {
  const DB = prepararDB();
  const caja = DB.pos.cajas.find((c) => c.sucursal_id === 1 && c.predeterminada);
  const antes = calcularCorteEnCurso(DB, 1, caja.id);
  const gasto = await crearGasto(DB, datosBase(DB, { origen: "CAJA_FUERTE" }), 1, USUARIO, DRIVE, caja.id);

  assert.equal(gastosEfectivoDelTurno(DB, 1, null, caja), 0);
  const despues = calcularCorteEnCurso(DB, 1, caja.id);
  assert.equal(despues.calculado.EFECTIVO, antes.calculado.EFECTIVO);
  assert.equal(despues.gastos_incluidos, 0);
  assert.equal(gasto.origen, "CAJA_FUERTE");
});

test("un gasto del cajón conserva su origen y descuenta los 800 pesos", async () => {
  const DB = prepararDB();
  const caja = DB.pos.cajas.find((c) => c.sucursal_id === 1 && c.predeterminada);
  const gasto = await crearGasto(DB, datosBase(DB, { origen: "CAJON" }), 1, USUARIO, DRIVE, caja.id);
  assert.equal(gasto.origen, "CAJON");
  assert.equal(gastosEfectivoDelTurno(DB, 1, null, caja), 800);
  assert.equal(calcularCorteEnCurso(DB, 1, caja.id).calculado.EFECTIVO, -800);
});

for (const origen of [undefined, null]) {
  test(`origen ${origen}: la captura nueva declara cajón y los históricos siguen descontando`, async () => {
    const DB = prepararDB();
    const caja = DB.pos.cajas.find((c) => c.sucursal_id === 1 && c.predeterminada);
    const gasto = await crearGasto(DB, datosBase(DB, { origen }), 1, USUARIO, DRIVE, caja.id);
    assert.equal(gasto.origen, "CAJON");
    // Simula el registro antiguo, sin reescribir datos al consultarlo.
    if (origen === undefined) delete gasto.origen;
    else gasto.origen = null;
    assert.equal(gastosEfectivoDelTurno(DB, 1, null, caja), 800);
    assert.equal(gasto.origen, origen);
  });
}

test("la caja fuerte Fiscal conserva su caja y no toca ninguno de los dos cortes", async () => {
  const DB = prepararDB();
  const cajas = DB.pos.cajas.filter((c) => c.sucursal_id === 1);
  const fiscal = cajas.find((c) => !c.predeterminada);
  const gasto = await crearGasto(DB, datosBase(DB, { origen: "CAJA_FUERTE" }), 1, USUARIO, DRIVE, String(fiscal.id));
  for (const caja of cajas) assert.equal(gastosEfectivoDelTurno(DB, 1, null, caja), 0);
  assert.equal(gasto.caja_id, fiscal.id);
  assert.equal(gasto.origen, "CAJA_FUERTE");
});

for (const origen of ["TOMBOLA", "", false, 0, {}, ["CAJA_FUERTE"]]) {
  test(`rechaza origen inválido ${JSON.stringify(origen)} sin guardar gasto ni bitácora`, async () => {
    const DB = prepararDB();
    await assert.rejects(() => crearGasto(DB, datosBase(DB, { origen }), 1, USUARIO, DRIVE), /origen/i);
    assert.equal(DB.gastos.gastos.length, 0);
    assert.equal(DB.gastos.gasto_movimientos.length, 0);
  });
}

test("normaliza a mayúsculas un origen válido", async () => {
  const DB = prepararDB();
  const gasto = await crearGasto(DB, datosBase(DB, { origen: "caja_fuerte" }), 1, USUARIO, DRIVE);
  assert.equal(gasto.origen, "CAJA_FUERTE");
});

/**
 * CORREGIR UN GASTO MAL CAPTURADO, mientras no se haya cortado.
 *
 * Sin esto, un gasto marcado con el origen equivocado es un faltante permanente
 * a nombre de alguien: la cajera cuenta su cajón, el corte le pide $800 de más
 * por una nómina que salió del resguardo, y no hay forma de arreglarlo.
 *
 * Mismo trato que reciben las ventas con `cambiar_caja_venta`, y por la misma
 * razón: después de un corte cerrado no se toca, porque cambiaría un corte que
 * alguien ya firmó.
 */
test("un gasto pendiente se corrige y queda en la bitacora", async () => {
  const { corregirOrigenGasto } = require("./gastos");
  const DB = prepararDB();
  const caja = DB.pos.cajas.find((c) => c.sucursal_id === 1 && c.predeterminada);
  const gasto = await crearGasto(DB, datosBase(DB), 1, USUARIO, DRIVE, caja.id);

  assert.equal(gastosEfectivoDelTurno(DB, 1, null, caja), 800, "antes le resta al cajon");

  corregirOrigenGasto(DB, gasto.id, { origen: "CAJA_FUERTE" }, { nombre: "Gerente" });

  assert.equal(gastosEfectivoDelTurno(DB, 1, null, caja), 0, "despues ya no");
  const bitacora = DB.gastos.gasto_movimientos.filter((m) => m.gasto_id === gasto.id);
  assert.ok(bitacora.some((m) => /origen/i.test(m.descripcion)), "la correccion deja rastro");
  assert.ok(bitacora.some((m) => m.usuario === "Gerente"), "y dice quien la hizo");
});

test("un gasto ya sellado por un corte no se puede corregir", async () => {
  const { corregirOrigenGasto } = require("./gastos");
  const DB = prepararDB();
  const caja = DB.pos.cajas.find((c) => c.sucursal_id === 1 && c.predeterminada);
  const gasto = await crearGasto(DB, datosBase(DB), 1, USUARIO, DRIVE, caja.id);
  gasto.corte_id = 7; // lo conto el corte 7

  assert.throws(
    () => corregirOrigenGasto(DB, gasto.id, { origen: "CAJA_FUERTE" }, USUARIO),
    /cort/i
  );
  assert.equal(gasto.origen, "CAJON", "no se movio");
});

test("un gasto cancelado ya no se corrige", async () => {
  const { corregirOrigenGasto } = require("./gastos");
  const DB = prepararDB();
  const caja = DB.pos.cajas.find((c) => c.sucursal_id === 1 && c.predeterminada);
  const gasto = await crearGasto(DB, datosBase(DB), 1, USUARIO, DRIVE, caja.id);
  gasto.estatus = "cancelado";

  assert.throws(() => corregirOrigenGasto(DB, gasto.id, { origen: "CAJA_FUERTE" }, USUARIO), /cancelado/i);
});

test("un origen invalido se rechaza tambien al corregir", async () => {
  const { corregirOrigenGasto } = require("./gastos");
  const DB = prepararDB();
  const caja = DB.pos.cajas.find((c) => c.sucursal_id === 1 && c.predeterminada);
  const gasto = await crearGasto(DB, datosBase(DB), 1, USUARIO, DRIVE, caja.id);

  assert.throws(() => corregirOrigenGasto(DB, gasto.id, { origen: "TOMBOLA" }, USUARIO), /origen/i);
  assert.equal(gasto.origen, "CAJON");
});
