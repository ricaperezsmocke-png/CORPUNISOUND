/**
 * gastosRutaCaja.test.js — El CABLEADO de POST /api/gastos con respecto a la
 * caja de la que salió el dinero.
 *
 * Estas pruebas no se pueden escribir contra `crearGasto` a secas: el defecto
 * que cierran vive en la RUTA, en de dónde saca la caja. Antes la leía de
 * `?caja_id=`, que `apiFetch` (src/api.js) inyecta desde el selector del
 * encabezado del navegador, mientras la sucursal salía del token. Dos fuentes
 * para una sola decisión, con dos consecuencias verificadas en producción:
 * el gasto rebotaba cuando el encabezado apuntaba a otra tienda, y dentro de
 * la propia tienda se cargaba en silencio a la caja que hubiera arriba.
 *
 * Le pega a las rutas REALES vía require("./server"), igual que
 * respaldosRutas.test.js y cajasRuta.test.js.
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

// ⚠️ ANTES de requerir server.js: sin esto la prueba ensucia la base real.
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "gastos-caja-")), "datos.sqlite");
process.env.JWT_SECRET = process.env.JWT_SECRET || "secreto-de-pruebas";

const app = require("./server");
const { sembrarCuentas } = require("./testHelpers");
const { firmarToken } = require("./auth");
const { listarCategorias } = require("./gastosCategorias");
// Mismo módulo que usa server.js (require cachea por ruta resuelta): mutar sus
// funciones aquí cambia lo que ven las rutas reales, sin tocar Google Drive de
// verdad. Patrón tomado de respaldosRutas.test.js.
const drive = require("./drive");

// Rol 1 = "Administrador": tiene registrar_gastos y ver_gastos. Su sucursal es
// la 1 (Ocosingo) — la forma que emite el login de verdad, nunca null.
const TOKEN = firmarToken({ id: 91, nombre: "Gerente de prueba", rol_id: 1, sucursal_id: 1 });

const ARCHIVO_OK = {
  nombre_archivo: "ticket.jpg",
  tipo_mime: "image/jpeg",
  contenido_base64: Buffer.from("foto falsa").toString("base64"),
};

let servidor = null;
let base = "";
let carpetaOriginal = null;
let subirOriginal = null;

before(async () => {
  sembrarCuentas(app, [{ id: 91, rol_id: 1, sucursal_id: 1 }]);
  carpetaOriginal = drive.asegurarCarpetaGastosSucursal;
  subirOriginal = drive.subirArchivoADrive;
  drive.asegurarCarpetaGastosSucursal = async () => "carpeta-1";
  drive.subirArchivoADrive = async () => ({
    id: "file-1",
    webViewLink: "https://drive.google.com/file/d/file-1/view",
  });
  await new Promise((listo) => { servidor = app.listen(0, listo); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(async () => {
  drive.asegurarCarpetaGastosSucursal = carpetaOriginal;
  drive.subirArchivoADrive = subirOriginal;
  if (servidor) await new Promise((listo) => servidor.close(listo));
});

function cajasDeSucursal(sucursalId) {
  const cajas = app.DB.pos.cajas.filter((c) => c.sucursal_id === sucursalId);
  return {
    administrativa: cajas.find((c) => c.nombre === "Administrativa"),
    fiscal: cajas.find((c) => c.nombre === "Fiscal"),
  };
}

function cuerpoGasto(extra = {}) {
  return {
    categoria_id: listarCategorias(app.DB, {}).find((c) => c.nombre === "Combustible").id,
    concepto: "Gasolina de la camioneta",
    monto: 800,
    forma_pago: "EFECTIVO",
    archivo: ARCHIVO_OK,
    ...extra,
  };
}

async function registrarGasto(cuerpo, query = "") {
  const respuesta = await fetch(`${base}/api/gastos${query}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
  return { estado: respuesta.status, cuerpo: await respuesta.json() };
}

/**
 * El caso que le cuesta dinero a una cajera: se cambia a Fiscal para cobrar
 * algo, captura después los $800 de gasolina que salieron de la Administrativa,
 * y al cortar la Administrativa el sistema le pide $800 de más.
 */
test("la caja del gasto sale del CUERPO, no del selector del encabezado", async () => {
  const { administrativa, fiscal } = cajasDeSucursal(1);

  // El encabezado dice Fiscal (lo que inyecta apiFetch); el formulario declara
  // Administrativa. Manda lo que declaró quien capturó.
  const { estado, cuerpo } = await registrarGasto(
    cuerpoGasto({ caja_id: administrativa.id }),
    `?caja_id=${fiscal.id}`
  );

  assert.strictEqual(estado, 200, JSON.stringify(cuerpo));
  assert.strictEqual(cuerpo.caja_id, administrativa.id);
});

/**
 * El bloqueo que Victor está viviendo: con el encabezado en otra tienda, la
 * caja del query no pertenece a la sucursal del token y el gasto rebota con
 * "La caja indicada no pertenece a la sucursal de la sesión", sin nada que
 * hacer desde la pantalla.
 */
test("con el encabezado en otra tienda el gasto SE GUARDA, ya no rebota", async () => {
  const { fiscal } = cajasDeSucursal(1);
  const ajena = cajasDeSucursal(2).fiscal;

  const { estado, cuerpo } = await registrarGasto(
    cuerpoGasto({ caja_id: fiscal.id, concepto: "Gasolina con el encabezado en Yajalon" }),
    `?caja_id=${ajena.id}`
  );

  assert.strictEqual(estado, 200, JSON.stringify(cuerpo));
  assert.strictEqual(cuerpo.sucursal_id, 1, "el gasto se registra en la sucursal del token");
  assert.strictEqual(cuerpo.caja_id, fiscal.id);
});

/** La guarda de sucursal sigue viva: la caja declarada se valida contra el token. */
test("declarar una caja de OTRA sucursal se rechaza", async () => {
  const ajena = cajasDeSucursal(2).fiscal;

  const { estado, cuerpo } = await registrarGasto(cuerpoGasto({ caja_id: ajena.id }));

  assert.strictEqual(estado, 400);
  assert.match(cuerpo.error, /no pertenece a la sucursal/i);
});

test("sin caja declarada el gasto cae en la predeterminada de la sucursal del token", async () => {
  const { administrativa } = cajasDeSucursal(1);

  const { estado, cuerpo } = await registrarGasto(cuerpoGasto({ concepto: "Gasolina sin caja declarada" }));

  assert.strictEqual(estado, 200, JSON.stringify(cuerpo));
  assert.strictEqual(cuerpo.caja_id, administrativa.id);
});

/** La lista tiene que contar la misma historia que el corte. */
test("GET /api/gastos dice de que caja salio cada gasto", async () => {
  const { fiscal } = cajasDeSucursal(1);
  const concepto = "Gasolina que se ve en la lista";
  await registrarGasto(cuerpoGasto({ caja_id: fiscal.id, concepto }));

  const respuesta = await fetch(`${base}/api/gastos`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const lista = await respuesta.json();
  const fila = lista.find((g) => g.concepto === concepto);

  assert.ok(fila, "el gasto recien capturado tiene que estar en la lista");
  assert.strictEqual(fila.caja_nombre, "Fiscal");
});
