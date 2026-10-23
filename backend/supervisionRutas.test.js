/** Rutas de supervisión de tiendas (spec 2026-10-22 F2): permisos, alcance y fotos a Drive. */
const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "supervision-rutas-"));
process.env.DB_PATH = path.join(DIR, "datos.sqlite");
process.env.JWT_SECRET = process.env.JWT_SECRET || "secreto-de-pruebas";
const app = require("./server");
const { sembrarCuentas } = require("./testHelpers");
const { firmarToken } = require("./auth");
const { crearRol } = require("./roles");
const drive = require("./drive");

const JPG = { contenido_base64: "/9j/2Q==", tipo_mime: "image/jpeg", nombre_archivo: "falla.jpg" };
const PNG_FALSO = { contenido_base64: Buffer.from("no soy png").toString("base64"), tipo_mime: "image/png", nombre_archivo: "x.png" };
let servidor, base, supervisor, supAmarrado, encargada, otraEncargada, gerenteAjeno, sinPermiso, originales, subidas, borradas;

before(async () => {
  const rolSup = crearRol(app.DB, { nombre: "Supervisor visitas", modulos: ["supervision"],
    permisos: ["realizar_visitas_tienda", "ver_supervision", "ver_todas_las_sucursales"] });
  const rolSupLocal = crearRol(app.DB, { nombre: "Supervisor local", modulos: ["supervision"], permisos: ["realizar_visitas_tienda"] });
  const rolEncargada = crearRol(app.DB, { nombre: "Encargada visitas", modulos: ["supervision"], permisos: ["atender_fallas_visita"] });
  const rolGerente = crearRol(app.DB, { nombre: "Gerente visitas", modulos: ["supervision"], permisos: ["ver_supervision", "atender_fallas_visita"] });
  const rolNada = crearRol(app.DB, { nombre: "Sin supervision", modulos: ["supervision"], permisos: ["administrar_checklist_visitas"] });
  const cuentas = [
    { id: 280, nombre: "Supervisor", rol_id: rolSup.id, sucursal_id: 1 },
    { id: 281, nombre: "Supervisor Yajalón", rol_id: rolSupLocal.id, sucursal_id: 2 },
    { id: 290, nombre: "Encargada Ocosingo", rol_id: rolEncargada.id, sucursal_id: 1 },
    { id: 291, nombre: "Encargada Yajalón", rol_id: rolEncargada.id, sucursal_id: 2 },
    { id: 292, nombre: "Gerente Yajalón", rol_id: rolGerente.id, sucursal_id: 2 },
    { id: 293, nombre: "Sin permiso", rol_id: rolNada.id, sucursal_id: 1 },
  ];
  sembrarCuentas(app, cuentas);
  [supervisor, supAmarrado, encargada, otraEncargada, gerenteAjeno, sinPermiso] = cuentas.map(firmarToken);
  originales = { carpeta: drive.asegurarCarpetaActividadesSucursal, subir: drive.subirArchivoADrive, borrar: drive.eliminarArchivoDeDrive };
  drive.asegurarCarpetaActividadesSucursal = async () => "carpeta";
  drive.subirArchivoADrive = async (db, datos) => {
    assert.ok(Buffer.isBuffer(datos.contenidoBuffer));
    subidas.push(datos.nombre);
    return { id: `archivo-${subidas.length}`, webViewLink: `https://drive.google.com/file/d/${subidas.length}/view` };
  };
  drive.eliminarArchivoDeDrive = async (db, id) => { borradas.push(id); };
  const ocosingo = app.DB.pos.sucursales.find((s) => s.id === 1);
  Object.assign(ocosingo, { lat: 16.9, lng: -92.1 });
  await new Promise((listo) => { servidor = app.listen(0, listo); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});

beforeEach(() => {
  app.DB.supervision.visitas = [];
  app.DB.supervision.fallas = [];
  subidas = [];
  borradas = [];
});

after(async () => {
  drive.asegurarCarpetaActividadesSucursal = originales.carpeta;
  drive.subirArchivoADrive = originales.subir;
  drive.eliminarArchivoDeDrive = originales.borrar;
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
const activos = () => app.DB.supervision.checklist.filter((p) => p.activo);

async function visitaConFalla() {
  const v = await pedir("POST", "/api/supervision/visitas", supervisor, { sucursal_id: 1, lat: 16.9001, lng: -92.1 });
  estado(v, 200);
  assert.equal(v.cuerpo.ubicacion.comprobada, true);
  const [primero, ...resto] = activos();
  estado(await pedir("POST", `/api/supervision/visitas/${v.cuerpo.id}/puntos`, supervisor,
    { checklist_id: primero.id, resultado: "falla", nota: "Impresora sin tinta", responsable_id: 290, pasos: ["Cambiar cartucho"], archivo: JPG }), 200);
  for (const p of resto) estado(await pedir("POST", `/api/supervision/visitas/${v.cuerpo.id}/puntos`, supervisor, { checklist_id: p.id, resultado: "bien" }), 200);
  const t = await pedir("POST", `/api/supervision/visitas/${v.cuerpo.id}/terminar`, supervisor, {});
  estado(t, 200);
  return t.cuerpo;
}

test("sin sesion 401; sin permiso 403", async () => {
  estado(await pedir("POST", "/api/supervision/visitas", null, {}), 401);
  estado(await pedir("POST", "/api/supervision/visitas", sinPermiso, { sucursal_id: 1, lat: 16.9, lng: -92.1 }), 403);
  estado(await pedir("GET", "/api/supervision/mis-fallas", supervisor), 403);
});

test("supervisor amarrado a otra tienda recibe 404 al visitar Ocosingo", async () => {
  estado(await pedir("POST", "/api/supervision/visitas", supAmarrado, { sucursal_id: 1, lat: 16.9, lng: -92.1 }), 404);
  estado(await pedir("GET", "/api/supervision/responsables?sucursal_id=1", supAmarrado), 404);
});

test("recorrido completo: falla con foto a Drive, la encargada marca el paso y resuelve con foto", async () => {
  const { fallas } = await visitaConFalla();
  assert.equal(subidas.length, 1);
  assert.equal(fallas[0].foto.drive_id, "archivo-1");
  const mias = await pedir("GET", "/api/supervision/mis-fallas", encargada);
  assert.equal(mias.cuerpo.length, 1);
  assert.equal(mias.cuerpo[0].atrasada, false);
  estado(await pedir("POST", `/api/supervision/fallas/${fallas[0].id}/pasos/0`, encargada, {}), 200);
  const ajena = await pedir("POST", `/api/supervision/fallas/${fallas[0].id}/resolver`, otraEncargada, { nota: "x", archivo: JPG });
  assert.notEqual(ajena.status, 200);
  assert.equal(subidas.length, 1);
  const r = await pedir("POST", `/api/supervision/fallas/${fallas[0].id}/resolver`, encargada, { nota: "Cartucho nuevo", archivo: JPG });
  estado(r, 200);
  assert.equal(r.cuerpo.estado, "resuelta");
  assert.equal(subidas.length, 2);
});

test("foto falsa se rechaza antes de subir; falla sin foto no sube nada", async () => {
  const v = await pedir("POST", "/api/supervision/visitas", supervisor, { sucursal_id: 1, lat: 16.9, lng: -92.1 });
  const punto = activos()[0].id;
  const falsa = await pedir("POST", `/api/supervision/visitas/${v.cuerpo.id}/puntos`, supervisor,
    { checklist_id: punto, resultado: "falla", nota: "x", responsable_id: 290, pasos: ["a"], archivo: PNG_FALSO });
  estado(falsa, 400);
  assert.match(falsa.cuerpo.error, /no es una foto JPG o PNG válida/);
  const sinFoto = await pedir("POST", `/api/supervision/visitas/${v.cuerpo.id}/puntos`, supervisor,
    { checklist_id: punto, resultado: "falla", nota: "x", responsable_id: 290, pasos: ["a"] });
  estado(sinFoto, 400);
  assert.equal(subidas.length, 0);
});

test("si la falla no se guarda despues de subir, la foto se borra de Drive", async () => {
  const v = await pedir("POST", "/api/supervision/visitas", supervisor, { sucursal_id: 1, lat: 16.9, lng: -92.1 });
  const r = await pedir("POST", `/api/supervision/visitas/${v.cuerpo.id}/puntos`, supervisor,
    { checklist_id: activos()[0].id, resultado: "falla", nota: "x", responsable_id: 291, pasos: ["a"], archivo: JPG });
  estado(r, 400);
  assert.deepEqual(borradas, ["archivo-1"]);
});

test("gerente de otra tienda no ve ni reasigna las fallas de Ocosingo", async () => {
  const { fallas } = await visitaConFalla();
  const lista = await pedir("GET", "/api/supervision/fallas", gerenteAjeno);
  estado(lista, 200);
  assert.equal(lista.cuerpo.length, 0);
  estado(await pedir("POST", `/api/supervision/fallas/${fallas[0].id}/cancelar`, gerenteAjeno, { motivo: "x" }), 404);
  const global = await pedir("GET", "/api/supervision/fallas?estado=abierta", supervisor);
  assert.equal(global.cuerpo.length, 1);
  estado(await pedir("POST", `/api/supervision/fallas/${fallas[0].id}/cancelar`, supervisor, { motivo: "Duplicada" }), 200);
});

test("responsables: cuentas activas de la tienda y el sugerido", async () => {
  await visitaConFalla();
  const r = await pedir("GET", "/api/supervision/responsables?sucursal_id=1", supervisor);
  estado(r, 200);
  assert.equal(r.cuerpo.sugerido, 290);
  assert.ok(r.cuerpo.cuentas.some((c) => c.id === 290));
  assert.ok(!r.cuerpo.cuentas.some((c) => c.id === 291));
});

test("la visita terminada cuenta en la fuente visitas_tienda", async () => {
  const { contarFuente } = require("./metasFuentes");
  await visitaConFalla();
  const mes = app.DB.supervision.visitas[0].mes;
  const r = contarFuente(app.DB, { fuente: "visitas_tienda", usuario_id: 280, sucursal_id: null, periodo: "mensual", inicio: `${mes}-01` });
  assert.equal(r.valor, 1);
});
