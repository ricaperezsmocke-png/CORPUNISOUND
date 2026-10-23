const { test } = require("node:test");
const assert = require("node:assert/strict");
const M = require("./metasPersonalizadas");
const { capturarMeta, anularCaptura, capturaParaRespuesta, marcarRevisada } = require("./metasCapturas");

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
  }, admin: { usuarios: [{ id: 80, nombre: "Sofía", usuario: "sofia", activo: true }, { id: 82, nombre: "Otro", activo: true }] } };
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

test("fase3: la misma publicación copiada de otra forma no cuenta dos veces", async () => {
  const DB = DBPrueba();
  const meta = metaTienda(DB);
  await capturar(DB, meta.clave, { fecha: "2026-09-14", link: "https://www.facebook.com/unisound/videos/777" });
  await assert.rejects(capturar(DB, meta.clave, { fecha: "2026-09-14", link: "https://m.facebook.com/watch/?v=777&mibextid=a" }, 2),
    /ya se usó/);
  assert.equal(DB.pos.meta_capturas.length, 1);
});

test("fase3: reintento con la misma operación no duplica; otra operación sí cuenta", async () => {
  const DB = DBPrueba();
  const meta = metaTienda(DB, "ninguna");
  const primera = await capturar(DB, meta.clave, { fecha: "2026-09-14", cantidad: 3, operacion_id: "op-1234abcd" });
  const reintento = await capturar(DB, meta.clave, { fecha: "2026-09-14", cantidad: 3, operacion_id: "op-1234abcd" });
  assert.equal(reintento.id, primera.id);
  assert.equal(DB.pos.meta_capturas.length, 1);
  await capturar(DB, meta.clave, { fecha: "2026-09-14", cantidad: 3, operacion_id: "op-9999zzzz" });
  await capturar(DB, meta.clave, { fecha: "2026-09-14", cantidad: 3 }); // sin operación: como antes
  assert.equal(DB.pos.meta_capturas.length, 3);
});

test("fase3: la operación es de quien captura; otra persona o meta con el mismo id se rechaza", async () => {
  const DB = DBPrueba();
  const meta = metaTienda(DB, "ninguna");
  const otra = M.crearMeta(DB, { nombre: "Llamadas", unidad: "llamadas", prueba: "ninguna", valor_meta: 5, ...MES,
    alcance: "tienda", sucursal_id: 4 }, VICTOR);
  await capturar(DB, meta.clave, { fecha: "2026-09-14", cantidad: 2, operacion_id: "op-1234abcd" });
  const deLuis = await capturar(DB, meta.clave, { fecha: "2026-09-14", cantidad: 2, operacion_id: "op-1234abcd" }, 2);
  assert.equal(deLuis.vendedor_id, 2); // la operación de Ana no le tapa la captura a Luis
  await assert.rejects(capturar(DB, otra.clave, { fecha: "2026-09-14", cantidad: 1, operacion_id: "op-1234abcd" }), /operación/);
  await assert.rejects(capturar(DB, meta.clave, { fecha: "2026-09-14", cantidad: 1, operacion_id: "x" }), /operación/);
  await assert.rejects(capturar(DB, meta.clave, { fecha: "2026-09-14", cantidad: 1, operacion_id: 12345678 }), /operación/);
});

test("fase3: un reintento de foto mientras la primera sube no deja dos capturas ni fotos huérfanas", async () => {
  const DB = DBPrueba();
  const meta = metaTienda(DB, "foto");
  const archivos = new Set();
  let n = 0;
  let soltar;
  const espera = new Promise((listo) => { soltar = listo; });
  const drive = { ...driveFalso, subirArchivoADrive: async () => {
    const id = `archivo-${++n}`;
    archivos.add(id);
    if (n === 1) await espera;
    return { id, webViewLink: `https://drive.google.com/file/d/${id}/view` };
  }, eliminarArchivoDeDrive: async (db, id) => { archivos.delete(id); } };
  const datos = { fecha: "2026-09-14", operacion_id: "op-foto-0001",
    archivo: { contenido_base64: "/9j/2Q==", tipo_mime: "image/jpeg", nombre_archivo: "foto.jpg" } };
  const primera = capturar(DB, meta.clave, datos, 1, { drive });
  await new Promise((listo) => setImmediate(listo));
  const segunda = capturar(DB, meta.clave, datos, 1, { drive }).catch((e) => e);
  soltar();
  const [a, b] = [await primera, await segunda];
  assert.equal(DB.pos.meta_capturas.length, 1);
  assert.ok(b instanceof Error ? /subiendo|ya se usó/.test(b.message) : b.id === a.id, String(b?.message || b?.id));
  assert.equal(archivos.size, 1);
});

test("revisión: reintento sobre una captura ya quitada avisa en vez de decir que se guardó", async () => {
  const DB = DBPrueba();
  const meta = metaTienda(DB, "ninguna");
  const c = await capturar(DB, meta.clave, { fecha: "2026-09-14", cantidad: 3, operacion_id: "op-1234abcd" });
  c.anulada = { por_nombre: "Supervisora", en: "2026-09-14T20:00:00Z", motivo: "duplicada" };
  await assert.rejects(capturar(DB, meta.clave, { fecha: "2026-09-14", cantidad: 3, operacion_id: "op-1234abcd" }), /quitada/);
  assert.equal(DB.pos.meta_capturas.length, 1);
});

test("revisión: reintento de foto que llega cuando la primera ya quedó devuelve la primera, sin foto huérfana", async () => {
  const DB = DBPrueba();
  const meta = metaTienda(DB, "foto");
  const archivos = new Set();
  const datos = { fecha: "2026-09-14", operacion_id: "op-foto-0002",
    archivo: { contenido_base64: "/9j/2Q==", tipo_mime: "image/jpeg", nombre_archivo: "foto.jpg" } };
  const huella = require("node:crypto").createHash("sha256").update(Buffer.from(datos.archivo.contenido_base64, "base64")).digest("hex");
  const primera = { id: 1, meta_clave: meta.clave, meta_id: meta.id, vendedor_id: 1, sucursal_id: 4, fecha: "2026-09-14", cantidad: 1,
    operacion_id: "op-foto-0002", evidencia: { tipo: "foto", huella, drive_file_id: "archivo-1" }, anulada: null };
  const drive = { ...driveFalso, subirArchivoADrive: async () => {
    archivos.add("archivo-2");
    DB.pos.meta_capturas.push(primera); // la primera petición termina de guardarse mientras el reintento sube
    return { id: "archivo-2", webViewLink: "https://drive.google.com/file/d/archivo-2/view" };
  }, eliminarArchivoDeDrive: async (db, id) => { archivos.delete(id); } };
  const segunda = await capturar(DB, meta.clave, datos, 1, { drive });
  assert.equal(segunda.id, primera.id);
  assert.equal(DB.pos.meta_capturas.length, 1);
  assert.equal(archivos.size, 0, "la foto del reintento se borró");
});

const SOFIA = { id: 80, nombre: "Sofía" };
const metaCorp = (DB, extra = {}) => M.crearMeta(DB, { nombre: "Visitas proveedores", unidad: "visitas", prueba: "ninguna", valor_meta: 4,
  ...MES, alcance: "corporativo", usuario_id: 80, ...extra }, VICTOR);
const comoSofia = (extra = {}) => ({ usuario: SOFIA, vendedor_id: null, drive: driveFalso, hoy: HOY, ...extra });

test("corporativo manual: captura la duena sin vendedor ni plantilla", async () => {
  const DB = DBPrueba();
  const meta = metaCorp(DB);
  const c = await capturarMeta(DB, meta.clave, { fecha: "2026-09-10", cantidad: 2 }, comoSofia());
  assert.equal(c.usuario_id, 80);
  assert.equal(c.vendedor_id, null);
  assert.equal(c.sucursal_id, null);
  assert.equal(c.revisada, null);
});

test("corporativo manual: otra cuenta o un vendedor no capturan", async () => {
  const DB = DBPrueba();
  const meta = metaCorp(DB);
  await assert.rejects(capturarMeta(DB, meta.clave, { fecha: "2026-09-10", cantidad: 1 },
    comoSofia({ usuario: { id: 82, nombre: "Otro" } })), /no es tuya/);
  await assert.rejects(capturarMeta(DB, meta.clave, { fecha: "2026-09-10", cantidad: 1 },
    { usuario: ANA, vendedor_id: 1, drive: driveFalso, hoy: HOY }), /no es tuya/);
});

test("corporativo: reintento de la misma operacion no cuenta dos veces", async () => {
  const DB = DBPrueba();
  const meta = metaCorp(DB);
  const datos = { fecha: "2026-09-10", cantidad: 1, operacion_id: "operacion-corp-1" };
  const a = await capturarMeta(DB, meta.clave, datos, comoSofia());
  const b = await capturarMeta(DB, meta.clave, datos, comoSofia());
  assert.equal(a.id, b.id);
  assert.equal(DB.pos.meta_capturas.length, 1);
});

test("corporativo: la cuenta desactivada ya no captura", async () => {
  const DB = DBPrueba();
  const meta = metaCorp(DB);
  DB.admin.usuarios.find((u) => u.id === 80).activo = false;
  await assert.rejects(capturarMeta(DB, meta.clave, { fecha: "2026-09-10", cantidad: 1 }, comoSofia()), /cuenta no está activa/);
});

test("meta automatica rechaza toda captura", async () => {
  const DB = DBPrueba();
  const meta = metaCorp(DB, { fuente: "crm_cambios_estado" });
  await assert.rejects(capturarMeta(DB, meta.clave, { fecha: "2026-09-10", cantidad: 1 }, comoSofia()),
    { message: "Esta meta se cuenta sola" });
});

test("corporativo con foto y sin tienda sube a la carpeta Corporativo, nunca a la de Recursos Humanos", async () => {
  const DB = DBPrueba();
  const meta = metaCorp(DB, { prueba: "foto" });
  const usadas = [];
  const drive = { ...driveFalso,
    asegurarCarpetaCorporativo: async () => { usadas.push("corporativo"); return "carpeta-corporativo"; },
    asegurarCarpetaEmpleado: async () => { usadas.push("empleado"); return "carpeta-rh"; },
    subirArchivoADrive: async (db, datos) => { usadas.push(datos.carpetaId); return driveFalso.subirArchivoADrive(); } };
  const archivo = { contenido_base64: "/9j/2Q==", tipo_mime: "image/jpeg", nombre_archivo: "f.jpg" };
  await capturarMeta(DB, meta.clave, { fecha: "2026-09-10", archivo }, comoSofia({ drive }));
  assert.deepEqual(usadas, ["corporativo", "carpeta-corporativo"]);
});

test("marcarRevisada: una sola vez, guarda quien y no cambia la cantidad", async () => {
  const DB = DBPrueba();
  const meta = metaTienda(DB, "ninguna");
  const c = await capturar(DB, meta.clave, { fecha: "2026-09-14", cantidad: 3 });
  const r = marcarRevisada(DB, c.id, VICTOR);
  assert.equal(r.revisada.por_id, 1);
  assert.equal(r.cantidad, 3);
  assert.throws(() => marcarRevisada(DB, c.id, VICTOR), /ya está revisada/);
  const otra = await capturar(DB, meta.clave, { fecha: "2026-09-14", cantidad: 1 });
  anularCaptura(DB, otra.id, "No vale", VICTOR);
  assert.throws(() => marcarRevisada(DB, otra.id, VICTOR), /anulada/);
});

test("I3: nadie marca revisada su propia captura", async () => {
  const DB = DBPrueba();
  const meta = metaTienda(DB, "ninguna");
  const c = await capturar(DB, meta.clave, { fecha: "2026-09-14", cantidad: 1 });
  assert.throws(() => marcarRevisada(DB, c.id, ANA), /propia/);
});
