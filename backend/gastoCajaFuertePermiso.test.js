/**
 * gastoCajaFuertePermiso.test.js — El CONTROL sobre quién puede marcar un gasto
 * como pagado desde la caja fuerte.
 *
 * Sin esto, la Tarea 1 no protege nada: cualquiera con `registrar_gastos` podría
 * mandar `origen: "CAJA_FUERTE"` a mano y bajar el saldo del dinero resguardado
 * SIN descuadrar el corte de nadie — precisamente porque ese gasto ya no le
 * resta a ninguna cajera. Con un comprobante falso es la forma más limpia de
 * sacar dinero del resguardo sin dejar señal contable.
 *
 * Le pega a las rutas REALES, igual que gastosRutaCaja.test.js: el control vive
 * en la ruta, no en `crearGasto`.
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "gasto-cf-")), "datos.sqlite");
process.env.JWT_SECRET = process.env.JWT_SECRET || "secreto-de-pruebas";

const app = require("./server");
const { sembrarCuentas } = require("./testHelpers");
const { firmarToken } = require("./auth");
const { listarCategorias } = require("./gastosCategorias");
const { crearRol } = require("./roles");
const drive = require("./drive");

const ARCHIVO_OK = {
  nombre_archivo: "ticket.jpg",
  tipo_mime: "image/jpeg",
  contenido_base64: Buffer.from("foto falsa").toString("base64"),
};

let servidor = null, base = "", carpetaOriginal = null, subirOriginal = null;
let TOKEN_ADMIN = "", TOKEN_SIN_PERMISO = "";

before(async () => {
  // Un rol que SÍ puede registrar gastos pero NO marcar el origen: es el caso
  // que importa. Un rol sin ningún permiso recibiría 403 por cualquier motivo y
  // la prueba no probaría nada.
  const rolCajera = crearRol(app.DB, {
    nombre: "Cajera de prueba",
    permisos: ["registrar_gastos", "ver_gastos"],
    modulos: ["gastos"],
  });
  sembrarCuentas(app, [
    { id: 91, rol_id: 1, sucursal_id: 1 },
    { id: 92, rol_id: rolCajera.id, sucursal_id: 1 },
  ]);
  TOKEN_ADMIN = firmarToken({ id: 91, nombre: "Victor", rol_id: 1, sucursal_id: 1 });
  TOKEN_SIN_PERMISO = firmarToken({ id: 92, nombre: "Cajera", rol_id: rolCajera.id, sucursal_id: 1 });

  carpetaOriginal = drive.asegurarCarpetaGastosSucursal;
  subirOriginal = drive.subirArchivoADrive;
  drive.asegurarCarpetaGastosSucursal = async () => "carpeta-1";
  drive.subirArchivoADrive = async () => ({ id: "file-1", webViewLink: "https://drive.google.com/file/d/file-1/view" });
  await new Promise((listo) => { servidor = app.listen(0, listo); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(async () => {
  drive.asegurarCarpetaGastosSucursal = carpetaOriginal;
  drive.subirArchivoADrive = subirOriginal;
  if (servidor) await new Promise((listo) => servidor.close(listo));
});

function cuerpoGasto(extra = {}) {
  return {
    categoria_id: listarCategorias(app.DB, {}).find((c) => c.nombre === "Combustible").id,
    concepto: "Nomina de la semana",
    monto: 800,
    forma_pago: "EFECTIVO",
    archivo: ARCHIVO_OK,
    ...extra,
  };
}

async function registrar(token, cuerpo) {
  const r = await fetch(`${base}/api/gastos?sucursal_id=1`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(cuerpo),
  });
  return { estado: r.status, cuerpo: await r.json() };
}

test("sin el permiso, un origen de caja fuerte mandado a mano se RECHAZA", async () => {
  const antes = app.DB.gastos.gastos.length;

  const { estado, cuerpo } = await registrar(TOKEN_SIN_PERMISO, cuerpoGasto({ origen: "CAJA_FUERTE" }));

  assert.strictEqual(estado, 403);
  assert.match(cuerpo.error, /caja fuerte/i);
  assert.strictEqual(app.DB.gastos.gastos.length, antes, "no se guarda nada");
});

/**
 * Se rechaza, NO se degrada a "CAJON" en silencio. Guardar algo distinto de lo
 * que declaró quien captura es peor que negarse: el gasto quedaría restándole a
 * una cajera que no lo pagó, y quien lo capturó creería que hizo lo correcto.
 */
test("el rechazo no guarda el gasto como si fuera del cajon", async () => {
  const antes = app.DB.gastos.gastos.length;

  await registrar(TOKEN_SIN_PERMISO, cuerpoGasto({ origen: "CAJA_FUERTE" }));

  assert.strictEqual(app.DB.gastos.gastos.length, antes);
});

test("con el permiso, el gasto de caja fuerte se registra", async () => {
  const { estado, cuerpo } = await registrar(TOKEN_ADMIN, cuerpoGasto({ origen: "CAJA_FUERTE" }));

  assert.strictEqual(estado, 200);
  assert.strictEqual(cuerpo.origen, "CAJA_FUERTE");
});

test("un gasto normal del cajon sigue necesitando solo registrar_gastos", async () => {
  const { estado, cuerpo } = await registrar(TOKEN_SIN_PERMISO, cuerpoGasto());

  assert.strictEqual(estado, 200);
  assert.strictEqual(cuerpo.origen, "CAJON");
});

test("el permiso esta dado de alta en el catalogo, en su modulo", () => {
  const { PERMISOS } = require("./permisosCatalogo");
  const permiso = PERMISOS.find((p) => p.clave === "registrar_gasto_caja_fuerte");

  assert.ok(permiso, "sin registrar, el guard de arranque tumba el backend");
  assert.strictEqual(permiso.modulo, "gastos");
});
