/** Rutas reales de metas personalizadas: permisos, identidad, alcance, privacidad y sello. */
const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "metas-rutas-")), "datos.sqlite");
process.env.JWT_SECRET = process.env.JWT_SECRET || "secreto-de-pruebas";
const app = require("./server");
const { sembrarCuentas } = require("./testHelpers");
const { firmarToken } = require("./auth");
const { crearRol } = require("./roles");
const { inicioDePeriodo, finDePeriodo } = require("./metasPeriodos");
const { fechaLocal } = require("./fechas");
const drive = require("./drive");

// Una semana ya terminada: se puede capturar dentro de ella y sellarla.
const lunesDeEstaSemana = inicioDePeriodo("semanal", fechaLocal(new Date()));
const INICIO = new Date(Date.parse(`${lunesDeEstaSemana}T00:00:00Z`) - 21 * 86400000).toISOString().slice(0, 10);
const SEMANA = { periodo: "semanal", inicio: INICIO };
const FECHA = finDePeriodo("semanal", INICIO);
const META = { ...SEMANA, nombre: "Videos de tips", unidad: "videos", prueba: "liga", valor_meta: 10, alcance: "tienda", sucursal_id: 1 };
let servidor, base, admin, gerente, gerenteAjeno, ana, carlos, maria, carpetaOriginal, subirOriginal;

before(async () => {
  const rolGerente = crearRol(app.DB, { nombre: "Gerencia metas", modulos: ["pos"],
    permisos: ["usar_gerente_ventas", "editar_objetivos_venta", "anular_capturas_metas"] });
  const rolVendedora = crearRol(app.DB, { nombre: "Vendedora metas", modulos: ["pos"], permisos: ["usar_gerente_ventas", "editar_objetivos_venta"] });
  const cuentas = [
    { id: 70, nombre: "Admin metas", rol_id: 1, sucursal_id: 1 },
    { id: 71, nombre: "Gerente metas", rol_id: rolGerente.id, sucursal_id: 1 },
    { id: 72, nombre: "Gerente ajeno metas", rol_id: rolGerente.id, sucursal_id: 2 },
    { id: 73, nombre: "Ana metas", rol_id: rolVendedora.id, sucursal_id: 1, vendedor_id: 1 },
    { id: 74, nombre: "Carlos metas", rol_id: rolVendedora.id, sucursal_id: 1, vendedor_id: 2 },
    { id: 75, nombre: "María metas", rol_id: rolVendedora.id, sucursal_id: 2, vendedor_id: 3 },
  ];
  sembrarCuentas(app, cuentas);
  [admin, gerente, gerenteAjeno, ana, carlos, maria] = cuentas.map(firmarToken);
  carpetaOriginal = drive.asegurarCarpetaActividadesSucursal;
  subirOriginal = drive.subirArchivoADrive;
  drive.asegurarCarpetaActividadesSucursal = async () => "carpeta";
  drive.subirArchivoADrive = async () => ({ id: "archivo-privado", webViewLink: "https://drive.google.com/file/d/x/view" });
  await new Promise((listo) => { servidor = app.listen(0, listo); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});

beforeEach(() => {
  for (const coleccion of ["okrs", "metas_personalizadas", "meta_capturas", "meta_sellos", "objetivo_plantilla", "objetivo_actividades"]) {
    app.DB.pos[coleccion] = [];
  }
});

after(async () => {
  drive.asegurarCarpetaActividadesSucursal = carpetaOriginal;
  drive.subirArchivoADrive = subirOriginal;
  if (servidor) await new Promise((listo) => servidor.close(listo));
});

async function pedir(metodo, ruta, token, datos) {
  const r = await fetch(base + ruta, {
    method: metodo,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(datos === undefined ? {} : { body: JSON.stringify(datos) }),
  });
  let cuerpo = null;
  try { cuerpo = await r.json(); } catch (_) { /* sin cuerpo */ }
  return { status: r.status, cuerpo };
}
const estado = (r, esperado) => assert.equal(r.status, esperado, JSON.stringify(r));
const consulta = `periodo=semanal&inicio=${INICIO}`;
async function crearMeta(datos = META) {
  const r = await pedir("POST", "/api/metas", admin, datos);
  estado(r, 200);
  return r.cuerpo;
}

test("las colecciones existen al arrancar", () => {
  for (const c of ["okrs", "metas_personalizadas", "meta_capturas", "meta_sellos"]) assert.ok(Array.isArray(app.DB.pos[c]), c);
});

test("sin sesión, todas las rutas responden 401", async () => {
  const rutas = [
    ["GET", `/api/metas/tablero?${consulta}`], ["GET", `/api/metas/admin?${consulta}`], ["POST", "/api/metas/okr"],
    ["POST", "/api/metas/okr/1/editar"], ["POST", "/api/metas/okr/1/retirar"], ["POST", "/api/metas"], ["POST", "/api/metas/1/editar"],
    ["POST", "/api/metas/1/retirar"], ["GET", "/api/metas/1/historial"], ["POST", "/api/metas/1/captura"],
    ["POST", "/api/metas/captura/1/anular"], ["GET", `/api/metas/revision?${consulta}`], ["GET", `/api/metas/sello/previo?${consulta}`],
    ["POST", "/api/metas/sello"], ["POST", "/api/metas/sello/1/rectificar"],
  ];
  for (const [metodo, ruta] of rutas) estado(await pedir(metodo, ruta, null, metodo === "POST" ? {} : undefined), 401);
});

test("solo el administrador crea metas", async () => {
  estado(await pedir("POST", "/api/metas", gerente, META), 403);
  estado(await pedir("POST", "/api/metas", ana, META), 403);
  estado(await pedir("POST", "/api/metas/okr", gerente, { ...SEMANA, titulo: "x", alcance: "tienda", sucursal_id: 1 }), 403);
  const meta = await crearMeta();
  assert.equal(meta.creado_por_id, 70);
});

test("la vendedora captura a su nombre aunque mande otro vendedor, y la liga no se repite", async () => {
  const meta = await crearMeta();
  const r = await pedir("POST", `/api/metas/${meta.clave}/captura`, ana,
    { fecha: FECHA, link: "https://www.tiktok.com/@u/video/7?utm_source=w", vendedor_id: 2 });
  estado(r, 200);
  assert.equal(r.cuerpo.vendedor_id, 1);
  const repetida = await pedir("POST", `/api/metas/${meta.clave}/captura`, carlos, { fecha: FECHA, link: "https://tiktok.com/@u/video/7" });
  estado(repetida, 400);
  assert.match(repetida.cuerpo.error, /ya se usó/);
  estado(await pedir("POST", `/api/metas/${meta.clave}/captura`, maria, { fecha: FECHA, link: "https://tiktok.com/@u/video/8" }), 400);
});

test("la foto no expone drive_file_id", async () => {
  const meta = await crearMeta({ ...META, prueba: "foto" });
  const archivo = { nombre_archivo: "a.jpg", tipo_mime: "image/jpeg", contenido_base64: Buffer.from("foto-rutas").toString("base64") };
  const r = await pedir("POST", `/api/metas/${meta.clave}/captura`, ana, { fecha: FECHA, archivo });
  estado(r, 200);
  assert.ok(!JSON.stringify(r.cuerpo).includes("drive_file_id"));
  assert.equal(app.DB.pos.meta_capturas[0].evidencia.drive_file_id, "archivo-privado", "se guarda en la base, no se expone");
});

test("POST y GET del sello ocultan drive_file_id sin alterar la foto guardada", async () => {
  const meta = await crearMeta({ ...META, prueba: "foto" });
  const archivo = { nombre_archivo: "sello.jpg", tipo_mime: "image/jpeg", contenido_base64: Buffer.from("foto-sello").toString("base64") };
  estado(await pedir("POST", `/api/metas/${meta.clave}/captura`, ana, { fecha: FECHA, archivo }), 200);
  const post = await pedir("POST", "/api/metas/sello", admin, SEMANA);
  estado(post, 200);
  assert.equal(post.cuerpo.foto.capturas.length, 1);
  assert.equal(JSON.stringify(post.cuerpo).includes("drive_file_id"), false);
  assert.equal(post.cuerpo.foto.capturas[0].evidencia.drive_link, "https://drive.google.com/file/d/x/view");
  const get = await pedir("GET", `/api/metas/sello?${consulta}`, admin);
  estado(get, 200);
  assert.deepEqual(get.cuerpo, post.cuerpo);
  assert.equal(app.DB.pos.meta_sellos[0].foto.capturas[0].evidencia.drive_file_id, "archivo-privado");
});

test("tablero: la vendedora no ve desglose ni capturas ajenas; la gerente sí ve el desglose", async () => {
  const meta = await crearMeta({ ...META, prueba: "ninguna" });
  estado(await pedir("POST", `/api/metas/${meta.clave}/captura`, ana, { fecha: FECHA, cantidad: 2 }), 200);
  estado(await pedir("POST", `/api/metas/${meta.clave}/captura`, carlos, { fecha: FECHA, cantidad: 3 }), 200);
  const deAna = await pedir("GET", `/api/metas/tablero?${consulta}`, ana);
  estado(deAna, 200);
  const suya = deAna.cuerpo.sueltas[0];
  assert.equal(suya.resultado, 5);
  assert.equal(suya.por_persona, undefined);
  assert.deepEqual(suya.mis_capturas.map((c) => c.vendedor_id), [1]);
  const deGerente = await pedir("GET", `/api/metas/tablero?${consulta}`, gerente);
  assert.deepEqual(deGerente.cuerpo.sueltas[0].por_persona.map((p) => p.resultado), [2, 3]);
  const ajena = await pedir("GET", `/api/metas/tablero?${consulta}`, gerenteAjeno);
  assert.equal(ajena.cuerpo.sueltas.length, 0);
});

test("anular: la compañera no puede, la gerente de la tienda sí, la de otra tienda no; la propia sí", async () => {
  const meta = await crearMeta({ ...META, prueba: "ninguna" });
  const c1 = (await pedir("POST", `/api/metas/${meta.clave}/captura`, ana, { fecha: FECHA, cantidad: 1 })).cuerpo;
  const c2 = (await pedir("POST", `/api/metas/${meta.clave}/captura`, ana, { fecha: FECHA, cantidad: 1 })).cuerpo;
  estado(await pedir("POST", `/api/metas/captura/${c1.id}/anular`, carlos, { motivo: "x" }), 404);
  estado(await pedir("POST", `/api/metas/captura/${c1.id}/anular`, gerenteAjeno, { motivo: "x" }), 404);
  const anulada = await pedir("POST", `/api/metas/captura/${c1.id}/anular`, gerente, { motivo: "Video de otra tienda" });
  estado(anulada, 200);
  assert.equal(anulada.cuerpo.anulada.por_nombre, "Gerente metas");
  estado(await pedir("POST", `/api/metas/captura/${c2.id}/anular`, ana, { motivo: "Me equivoqué" }), 200);
  const revision = await pedir("GET", `/api/metas/revision?${consulta}`, gerente);
  estado(revision, 200);
  assert.deepEqual(revision.cuerpo.map((c) => [c.vendedor_nombre, c.meta_nombre]), [["Ana López", "Videos de tips"], ["Ana López", "Videos de tips"]]);
  estado(await pedir("GET", `/api/metas/revision?${consulta}`, ana), 403);
});

test("sellado: nada cambia después y solo se rectifica el resultado", async () => {
  const meta = await crearMeta({ ...META, prueba: "ninguna" });
  const c = (await pedir("POST", `/api/metas/${meta.clave}/captura`, ana, { fecha: FECHA, cantidad: 2 })).cuerpo;
  estado(await pedir("GET", `/api/metas/sello/previo?${consulta}`, admin), 200);
  estado(await pedir("POST", "/api/metas/sello", gerente, SEMANA), 403);
  const sello = await pedir("POST", "/api/metas/sello", admin, SEMANA);
  estado(sello, 200);
  for (const [ruta, token, datos] of [
    [`/api/metas/${meta.clave}/captura`, ana, { fecha: FECHA, cantidad: 1 }],
    [`/api/metas/captura/${c.id}/anular`, gerente, { motivo: "x" }],
    [`/api/metas/${meta.clave}/editar`, admin, { valor_meta: 3, motivo: "x" }],
    [`/api/metas/${meta.clave}/retirar`, admin, { motivo: "x" }],
  ]) {
    const r = await pedir("POST", ruta, token, datos);
    estado(r, 400);
    assert.match(r.cuerpo.error, /sellado/);
  }
  estado(await pedir("POST", `/api/metas/sello/${sello.cuerpo.id}/rectificar`, admin,
    { meta_clave: meta.clave, campo: "valor_meta", valor_nuevo: 1, motivo: "x" }), 400);
  const rect = await pedir("POST", `/api/metas/sello/${sello.cuerpo.id}/rectificar`, admin,
    { meta_clave: meta.clave, valor_nuevo: 3, motivo: "Faltó uno" });
  estado(rect, 200);
  assert.equal(rect.cuerpo.valor_anterior, 2);
});

test("historial y retiro de la meta solo para el administrador", async () => {
  const meta = await crearMeta();
  estado(await pedir("POST", `/api/metas/${meta.clave}/editar`, admin, { valor_meta: 12, motivo: "Ajuste" }), 200);
  estado(await pedir("POST", `/api/metas/${meta.clave}/retirar`, gerente, { motivo: "x" }), 403);
  estado(await pedir("POST", `/api/metas/${meta.clave}/retirar`, admin, { motivo: "Ya no aplica" }), 200);
  const historial = await pedir("GET", `/api/metas/${meta.clave}/historial`, admin);
  estado(historial, 200);
  assert.deepEqual(historial.cuerpo.map((v) => [v.version, v.vigente, v.retirada?.motivo ?? null]), [[1, false, null], [2, false, "Ya no aplica"]]);
  estado(await pedir("GET", `/api/metas/${meta.clave}/historial`, gerente), 403);
});

test("ver el sello de un periodo: 404 si no existe, completo si existe; solo admin", async () => {
  estado(await pedir("GET", `/api/metas/sello?${consulta}`, admin), 404);
  const meta = await crearMeta({ ...META, prueba: "ninguna" });
  estado(await pedir("POST", `/api/metas/${meta.clave}/retirar`, admin, { motivo: "No aplica" }), 200);
  estado(await pedir("POST", "/api/metas/sello", admin, SEMANA), 200);
  const r = await pedir("GET", `/api/metas/sello?${consulta}`, admin);
  estado(r, 200);
  assert.deepEqual(r.cuerpo.foto.retiradas.map((m) => m.retirada.motivo), ["No aplica"]);
  estado(await pedir("GET", `/api/metas/sello?${consulta}`, gerente), 403);
});
