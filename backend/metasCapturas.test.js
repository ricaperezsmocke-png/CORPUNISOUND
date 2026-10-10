const { test } = require("node:test");
const assert = require("node:assert/strict");
const M = require("./metasPersonalizadas");
const { capturarMeta, anularCaptura, capturaParaRespuesta } = require("./metasCapturas");

// Fechas ya pasadas a propósito: la plantilla de la tienda compara contra el día real.
const VICTOR = { id: 1, nombre: "Victor" };
const ANA = { id: 10, nombre: "Ana" };
const HOY = "2026-09-15";
const MES = { periodo: "mensual", inicio: "2026-09-01" };

test("fase1: retiro durante Drive rechaza captura y borra la foto subida", async () => {
  const DB = DBPrueba();
  const meta = metaTienda(DB, "foto");
  const archivos = new Set();
  const drive = { ...driveFalso, subirArchivoADrive: async () => {
    archivos.add("archivo-privado");
    M.retirarMeta(DB, meta.clave, "No aplica", VICTOR);
    return driveFalso.subirArchivoADrive();
  }, eliminarArchivoDeDrive: async (db, id) => { assert.equal(db, DB); archivos.delete(id); } };
  const archivo = { contenido_base64: "/9j/2Q==", tipo_mime: "image/jpeg", nombre_archivo: "foto.jpg" };
  await assert.rejects(capturar(DB, meta.clave, { fecha: "2026-09-14", archivo }, 1, { drive }),
    { message: "La meta fue eliminada mientras se subía la foto; no se registró" });
  assert.equal(DB.pos.meta_capturas.length, 0);
  assert.equal(archivos.size, 0);
});

test("fase1: captura usa versión vigente después de antesDeGuardar", async () => {
  const DB = DBPrueba();
  const meta = metaTienda(DB, "foto");
  const archivo = { contenido_base64: "/9j/2Q==", tipo_mime: "image/jpeg", nombre_archivo: "foto.jpg" };
  let nueva;
  const c = await capturar(DB, meta.clave, { fecha: "2026-09-14", archivo }, 1, {
    antesDeGuardar: () => { nueva = M.editarMeta(DB, meta.clave, { valor_meta: 15, motivo: "Ajuste" }, VICTOR); },
  });
  assert.equal(c.meta_id, nueva.id);
  assert.notEqual(c.meta_id, meta.id);
});
const driveFalso = {
  eliminarArchivoDeDrive: async () => {},
  asegurarCarpetaActividadesSucursal: async () => "carpeta",
  subirArchivoADrive: async () => ({ id: "archivo-privado", webViewLink: "https://drive.google.com/file/d/x/view" }),
};
function DBPrueba() {
  return { pos: {
    sucursales: [{ id: 1, nombre: "Ocosingo" }, { id: 4, nombre: "Palenque" }],
    vendedores: [{ id: 1, nombre: "Ana", sucursal_id: 4 }, { id: 2, nombre: "Luis", sucursal_id: 4 }, { id: 3, nombre: "Eva", sucursal_id: 1 }],
    objetivo_plantilla: [], objetivo_actividades: [], objetivo_inventarios: [],
    okrs: [], metas_personalizadas: [], meta_capturas: [], meta_sellos: [],
  } };
}
const metaTienda = (DB, prueba = "liga") => M.crearMeta(DB, { nombre: "Videos", unidad: "videos", prueba, valor_meta: 12,
  ...MES, alcance: "tienda", sucursal_id: 4 }, VICTOR);
const capturar = (DB, clave, datos, vendedor_id = 1, extra = {}) =>
  capturarMeta(DB, clave, datos, { usuario: ANA, vendedor_id, drive: driveFalso, hoy: HOY, ...extra });

for (const causa of ["plantilla", "periodo", "sello", "duplicada", "confirmación", "antesDeGuardar"]) {
  test(`fase1: limpia Drive cuando falla después de subir por ${causa}`, async () => {
    const DB = DBPrueba();
    const meta = metaTienda(DB, "foto");
    const archivos = new Set();
    const archivo = { contenido_base64: "/9j/2Q==", tipo_mime: "image/jpeg", nombre_archivo: "foto.jpg" };
    const drive = { ...driveFalso, subirArchivoADrive: async () => {
      archivos.add("archivo-privado");
      if (causa === "plantilla") DB.pos.vendedores[0].sucursal_id = 1;
      if (causa === "periodo") meta.inicio = "2026-10-01";
      if (causa === "sello") DB.pos.meta_sellos.push({ id: 1, ...MES });
      if (causa === "duplicada") DB.pos.objetivo_actividades.push({ vigente: true, evidencia: {
        tipo: "foto", huella: require("node:crypto").createHash("sha256").update(Buffer.from(archivo.contenido_base64, "base64")).digest("hex"),
      } });
      return causa === "confirmación" ? { id: "archivo-privado" } : driveFalso.subirArchivoADrive();
    }, eliminarArchivoDeDrive: async (db, id) => { assert.equal(db, DB); archivos.delete(id); } };
    const errores = { plantilla: /sucursal|plantilla/, periodo: /periodo/, sello: /sellado/, duplicada: /ya se usó/,
      confirmación: /no confirmó/, antesDeGuardar: /eliminada mientras/ };
    const antesDeGuardar = () => { if (causa === "antesDeGuardar") M.retirarMeta(DB, meta.clave, "Error", VICTOR); };
    await assert.rejects(capturar(DB, meta.clave, { fecha: "2026-09-14", archivo }, 1, { drive, antesDeGuardar }), errores[causa]);
    assert.equal(DB.pos.meta_capturas.length, 0);
    assert.equal(archivos.size, 0);
  });
}

test("fase1: fallo al borrar foto no tapa el rechazo original", async (t) => {
  const DB = DBPrueba();
  const meta = metaTienda(DB, "foto");
  const errores = [];
  t.mock.method(console, "error", (...args) => errores.push(args));
  const drive = { ...driveFalso, eliminarArchivoDeDrive: async () => { throw new Error("Drive caído"); } };
  const archivo = { contenido_base64: "/9j/2Q==", tipo_mime: "image/jpeg", nombre_archivo: "foto.jpg" };
  await assert.rejects(capturar(DB, meta.clave, { fecha: "2026-09-14", archivo }, 1, {
    drive, antesDeGuardar: () => M.retirarMeta(DB, meta.clave, "Error", VICTOR),
  }), /eliminada mientras/);
  assert.equal(DB.pos.meta_capturas.length, 0);
  assert.equal(errores.length, 1);
  assert.equal(errores[0][1].message, "Drive caído");
});

test("Hecho con liga cuenta 1 y guarda la liga normalizada", async () => {
  const DB = DBPrueba();
  const meta = metaTienda(DB);
  const c = await capturar(DB, meta.clave, { fecha: "2026-09-14", link: "https://www.TikTok.com/@unisound/video/1?utm_source=x" });
  assert.equal(c.cantidad, 1);
  assert.equal(c.evidencia.link, "https://tiktok.com/@unisound/video/1");
  assert.equal(c.sucursal_id, 4);
  assert.equal(c.vendedor_id, 1);
  assert.equal(c.meta_clave, meta.clave);
});

test("la misma liga no cuenta dos veces, ni con otra persona ni si ya fue actividad", async () => {
  const DB = DBPrueba();
  const meta = metaTienda(DB);
  await capturar(DB, meta.clave, { fecha: "2026-09-14", link: "https://tiktok.com/@u/video/1" });
  await assert.rejects(capturar(DB, meta.clave, { fecha: "2026-09-14", link: "https://m.tiktok.com/@u/video/1/?fbclid=z" }, 2), /ya se usó/);
  DB.pos.objetivo_actividades.push({ vigente: true, evidencia: { tipo: "link", link: "https://facebook.com/p/9" } });
  await assert.rejects(capturar(DB, meta.clave, { fecha: "2026-09-14", link: "https://www.facebook.com/p/9" }), /ya se usó/);
});

test("prueba equivocada, fecha fuera del periodo o futura, y meta sin prueba con cantidad", async () => {
  const DB = DBPrueba();
  const meta = metaTienda(DB);
  await assert.rejects(capturar(DB, meta.clave, { fecha: "2026-09-14" }), /link/);
  await assert.rejects(capturar(DB, meta.clave, { fecha: "2026-08-31", link: "https://x.com/1" }), /periodo/);
  await assert.rejects(capturar(DB, meta.clave, { fecha: "2026-09-16", link: "https://x.com/1" }), /futura/);
  await assert.rejects(capturar(DB, meta.clave, { fecha: "2026-09-14", link: "https://x.com/1", cantidad: 3 }), /cantidad/);
  const llamadas = metaTienda(DB, "ninguna");
  const c = await capturar(DB, llamadas.clave, { fecha: "2026-09-14", cantidad: 7 });
  assert.equal(c.cantidad, 7);
  assert.equal(c.evidencia, null);
  await assert.rejects(capturar(DB, llamadas.clave, { fecha: "2026-09-14", cantidad: 0 }), /cantidad/);
  await assert.rejects(capturar(DB, llamadas.clave, { fecha: "2026-09-14", cantidad: 1, link: "https://x.com/2" }), /no lleva prueba/);
});

test("quién puede capturar: persona, tienda y empresa", async () => {
  const DB = DBPrueba();
  const persona = M.crearMeta(DB, { nombre: "Mis videos", unidad: "videos", prueba: "ninguna", valor_meta: 4,
    ...MES, alcance: "persona", vendedor_id: 2 }, VICTOR);
  await assert.rejects(capturar(DB, persona.clave, { fecha: "2026-09-14", cantidad: 1 }, 1), /no es tuya/);
  const tienda = metaTienda(DB, "ninguna");
  await assert.rejects(capturar(DB, tienda.clave, { fecha: "2026-09-14", cantidad: 1 }, 3), /sucursal|plantilla/);
  const empresa = M.crearMeta(DB, { nombre: "Talleres", unidad: "talleres", prueba: "ninguna", valor_meta: 2,
    ...MES, alcance: "empresa", participantes: [3] }, VICTOR);
  await assert.rejects(capturar(DB, empresa.clave, { fecha: "2026-09-14", cantidad: 1 }, 1), /no participas/i);
  const c = await capturar(DB, empresa.clave, { fecha: "2026-09-14", cantidad: 1 }, 3);
  assert.equal(c.sucursal_id, 1);
  await assert.rejects(capturar(DB, tienda.clave, { fecha: "2026-09-14", cantidad: 1 }, null), /ligada/);
});

test("foto: sube a Drive, la misma foto no cuenta dos veces y la respuesta no expone drive_file_id", async () => {
  const DB = DBPrueba();
  const meta = metaTienda(DB, "foto");
  const archivo = { contenido_base64: "/9j/2Q==", tipo_mime: "image/jpeg", nombre_archivo: "a.jpg" };
  const c = await capturar(DB, meta.clave, { fecha: "2026-09-14", archivo });
  assert.equal(c.evidencia.tipo, "foto");
  assert.ok(!JSON.stringify(capturaParaRespuesta(c)).includes("drive_file_id"));
  await assert.rejects(capturar(DB, meta.clave, { fecha: "2026-09-14", archivo }, 2), /ya se usó/);
});

test("si el periodo se sella mientras sube la foto, no se guarda", async () => {
  const DB = DBPrueba();
  const meta = metaTienda(DB, "foto");
  const archivo = { contenido_base64: "iVBORw0KGgo=", tipo_mime: "image/png", nombre_archivo: "b.png" };
  const drive = { ...driveFalso, subirArchivoADrive: async () => {
    DB.pos.meta_sellos.push({ id: 2, ...MES });
    return driveFalso.subirArchivoADrive();
  } };
  await assert.rejects(capturar(DB, meta.clave, { fecha: "2026-09-14", archivo }, 1, { drive }), /sellado/);
  assert.equal(DB.pos.meta_capturas.length, 0);
});

test("anular con motivo; no dos veces; no en periodo sellado; la liga anulada se puede volver a usar", async () => {
  const DB = DBPrueba();
  const meta = metaTienda(DB);
  const c = await capturar(DB, meta.clave, { fecha: "2026-09-14", link: "https://x.com/v/1" });
  assert.throws(() => anularCaptura(DB, c.id, "  ", VICTOR), /motivo/);
  const anulada = anularCaptura(DB, c.id, "Liga de otro video", VICTOR);
  assert.equal(anulada.anulada.por_nombre, "Victor");
  assert.throws(() => anularCaptura(DB, c.id, "otra", VICTOR), /ya está anulada/);
  const nueva = await capturar(DB, meta.clave, { fecha: "2026-09-14", link: "https://x.com/v/1" });
  DB.pos.meta_sellos.push({ id: 1, ...MES });
  assert.throws(() => anularCaptura(DB, nueva.id, "x", VICTOR), /sellado/);
  await assert.rejects(capturar(DB, meta.clave, { fecha: "2026-09-14", link: "https://x.com/v/2" }), /sellado/);
});
