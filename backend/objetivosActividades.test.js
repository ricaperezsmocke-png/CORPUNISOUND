const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizarLink, registrarActividad, anularActividad, agregarResultado,
  actividadesDelMes, resumenActividades,
} = require("./objetivosActividades");
const driveReal = require("./drive");

const USUARIO = { id: 7, nombre: "María" };
const DATOS = {
  mes: "2026-09", fecha: "2026-09-03", sucursal_id: 1, vendedor_id: 1,
  actividad: "grupos", link: "https://Facebook.com/x/",
};
const ARCHIVO = { nombre_archivo: "salida.jpg", tipo_mime: "image/jpeg", contenido_base64: "YWJj" };
const FOTO = { ...DATOS, actividad: "iglesia", link: undefined, archivo: ARCHIVO };
const FILTRO = { mes: "2026-09", sucursal_id: 1 };

function prepararDB() {
  return {
    pos: {
      sucursales: [{ id: 1, nombre: "Ocosingo" }, { id: 2, nombre: "Yajalón" }],
      vendedores: [
        { id: 1, nombre: "Juan", sucursal_id: 1, activo: true },
        { id: 2, nombre: "María", sucursal_id: 1, activo: true },
        { id: 3, nombre: "José", sucursal_id: 1, activo: true },
        { id: 9, nombre: "Ana", sucursal_id: 2, activo: true },
      ],
      objetivo_plantilla: [], objetivo_actividades: [], objetivo_cierres: [],
    },
  };
}

function driveFalso() {
  const llamadas = [];
  return {
    llamadas,
    async asegurarCarpetaActividadesSucursal(DB, sucursal) {
      llamadas.push({ operacion: "carpeta", DB, sucursal });
      return "carpeta-1";
    },
    async subirArchivoADrive(DB, datos) {
      llamadas.push({ operacion: "subir", DB, datos });
      return { id: "foto-1", webViewLink: "https://drive/foto-1" };
    },
  };
}

async function conRelojEn(instante, trabajo) {
  const DateReal = Date;
  global.Date = class extends DateReal {
    constructor(...args) { super(...(args.length ? args : [instante])); }
    static now() { return new DateReal(instante).getTime(); }
  };
  try { return await trabajo(); } finally { global.Date = DateReal; }
}

test("normaliza host, espacios, fragmento y barra final conservando la query", () => {
  assert.equal(normalizarLink("  https://Facebook.com/x/?id=2#foto  "), "https://facebook.com/x?id=2");
  assert.equal(normalizarLink("http://Facebook.com/"), "http://facebook.com");
  assert.equal(normalizarLink("https://example.com/a/b?x=/"), "https://example.com/a/b?x=/");
  const limite = "https://example.com/" + "x".repeat(480);
  assert.equal(normalizarLink(limite).length, 500);
  assert.throws(() => normalizarLink(limite + "x"), /500/);
});

test("rechaza protocolos y links sin esquema", () => {
  for (const link of ["javascript:alert(1)", "ftp://example.com/a", "facebook.com/x", "", null, {}, "https://"]) {
    assert.throws(() => normalizarLink(link), /El link debe empezar con http:\/\/ o https:\/\//);
  }
});

test("registra un link con auditoría y nota recortada sin llamar a Drive", async () => {
  const DB = prepararDB();
  const drive = driveFalso();
  const registro = await conRelojEn("2026-09-22T02:00:00.000Z", () =>
    registrarActividad(DB, { ...DATOS, nota: "  Publicación de hoy  " }, USUARIO, drive)
  );
  assert.deepEqual(registro, {
    id: 1, mes: "2026-09", fecha: "2026-09-03", sucursal_id: 1, vendedor_id: 1, actividad: "grupos",
    evidencia: { tipo: "link", link: "https://facebook.com/x" }, nota: "Publicación de hoy", conjunta_con: null,
    registrado_por: "María", registrado_en: "2026-09-22T02:00:00.000Z", vigente: true,
    anulado_por: null, anulado_en: null, motivo_anulacion: null, resultados: [],
  });
  assert.deepEqual(DB.pos.objetivo_actividades, [registro]);
  assert.equal(drive.llamadas.length, 0);
});

test("JPG y PNG suben los bytes a la carpeta de tienda y guardan la huella", async () => {
  for (const tipo_mime of ["image/jpeg", "image/png"]) {
    const DB = prepararDB();
    const drive = driveFalso();
    const registro = await registrarActividad(DB, { ...FOTO, archivo: { ...ARCHIVO, tipo_mime } }, USUARIO, drive);
    assert.deepEqual(registro.evidencia, {
      tipo: "foto", nombre_archivo: "salida.jpg", drive_file_id: "foto-1", drive_link: "https://drive/foto-1",
      huella: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    });
    assert.equal(registro.nota, null);
    assert.equal(drive.llamadas[0].sucursal, DB.pos.sucursales[0]);
    assert.equal(drive.llamadas[1].DB, DB);
    assert.deepEqual(drive.llamadas[1].datos, {
      nombre: "2026-09-03 - Juan - iglesia - salida.jpg",
      mimeType: tipo_mime, contenidoBuffer: Buffer.from("abc"), carpetaId: "carpeta-1",
    });
  }
});

test("valida evidencia, clase y nota antes de cualquier llamada a Drive", async () => {
  const casos = [
    [{ ...FOTO, archivo: { ...ARCHIVO, tipo_mime: "application/pdf" } }, /JPG|PNG/],
    [{ ...FOTO, archivo: { ...ARCHIVO, contenido_base64: Buffer.alloc(11 * 1024 * 1024).toString("base64") } }, /10 MB/],
    [{ ...DATOS, archivo: ARCHIVO }, /archivo|link/],
    [{ ...FOTO, link: "https://example.com" }, /link|foto/],
    [{ ...DATOS, link: undefined }, /link/i],
    [{ ...FOTO, archivo: undefined }, /foto|archivo/i],
    [{ ...FOTO, archivo: { ...ARCHIVO, contenido_base64: "" } }, /foto|archivo/i],
    [{ ...DATOS, actividad: "tiktok" }, /actividad|clase/i],
    [{ ...FOTO, nota: "a".repeat(301) }, /300/],
    [{ ...FOTO, nota: {} }, /nota/i],
  ];
  for (const [datos, error] of casos) {
    const DB = prepararDB();
    const drive = driveFalso();
    const antes = structuredClone(DB.pos.objetivo_actividades);
    await assert.rejects(() => registrarActividad(DB, datos, USUARIO, drive), error);
    assert.deepEqual(DB.pos.objetivo_actividades, antes);
    assert.equal(drive.llamadas.length, 0);
  }
});

test("acepta exactamente 10 MB y notas de 300 caracteres después de recortar", async () => {
  const registro = await registrarActividad(prepararDB(), {
    ...FOTO, archivo: { ...ARCHIVO, contenido_base64: Buffer.alloc(10 * 1024 * 1024).toString("base64") },
    nota: `  ${"a".repeat(300)}  `,
  }, USUARIO, driveFalso());
  assert.equal(registro.nota.length, 300);
  assert.equal(registro.evidencia.tipo, "foto");
});

test("rechaza mes, fecha, sucursal y vendedor inválidos sin subir", async () => {
  for (const cambio of [
    { mes: "2026-13" }, { fecha: "2026-02-30", mes: "2026-02" }, { fecha: "2026-08-31" },
    { fecha: "03/09/2026" }, { sucursal_id: 0 }, { vendedor_id: 88 }, { vendedor_id: 9 },
  ]) {
    const DB = prepararDB();
    const drive = driveFalso();
    await assert.rejects(() => registrarActividad(DB, { ...FOTO, ...cambio }, USUARIO, drive), /mes|fecha|sucursal|vendedor/i);
    assert.equal(DB.pos.objetivo_actividades.length, 0);
    assert.equal(drive.llamadas.length, 0);
  }
});

test("rechaza mañana con la fecha de Chiapas aunque UTC ya sea mañana", async () => {
  await conRelojEn("2026-09-15T02:00:00.000Z", async () => {
    const DB = prepararDB();
    const drive = driveFalso();
    await assert.rejects(() => registrarActividad(DB, { ...FOTO, fecha: "2026-09-15" }, USUARIO, drive), /futura/);
    assert.equal(drive.llamadas.length, 0);
    const registro = await registrarActividad(DB, { ...DATOS, fecha: "2026-09-14" }, USUARIO, drive);
    assert.equal(registro.fecha, "2026-09-14");
  });
});

test("la plantilla histórica decide la tienda y rechaza días fuera del periodo", async () => {
  const DB = prepararDB();
  DB.pos.vendedores[0].sucursal_id = 2;
  DB.pos.objetivo_plantilla.push(
    { mes: "2026-09", vendedor_id: 1, sucursal_id: 1, desde: "2026-09-02", hasta: "2026-09-10" },
    { mes: "2026-09", vendedor_id: 1, sucursal_id: 2, desde: "2026-09-12", hasta: null }
  );
  const drive = driveFalso();
  for (const cambio of [{ fecha: "2026-09-01" }, { fecha: "2026-09-11" }, { sucursal_id: 2 }]) {
    await assert.rejects(() => registrarActividad(DB, { ...FOTO, ...cambio }, USUARIO, drive), /plantilla/);
  }
  assert.equal(drive.llamadas.length, 0);
  assert.equal((await registrarActividad(DB, DATOS, USUARIO, drive)).sucursal_id, 1);
  const otro = await registrarActividad(DB, { ...DATOS, fecha: "2026-09-12", sucursal_id: 2, link: "https://example.com" }, USUARIO);
  assert.equal(otro.sucursal_id, 2);
});

test("la misma persona no repite link normalizado ni en otro mes ni con conjunta", async () => {
  const DB = prepararDB();
  await registrarActividad(DB, { ...DATOS, mes: "2026-08", fecha: "2026-08-02" }, USUARIO);
  for (const conjunta of [undefined, true]) {
    await assert.rejects(() => registrarActividad(DB, {
      ...DATOS, link: "https://facebook.com/x#foto", conjunta,
    }, USUARIO), /Ya presentaste esta evidencia el 2026-08-02/);
  }
  assert.equal(DB.pos.objetivo_actividades.length, 1);
});

test("otra persona debe confirmar conjunta con booleano true; el aviso dice quién y cuándo", async () => {
  const DB = prepararDB();
  await registrarActividad(DB, DATOS, USUARIO);
  for (const conjunta of [undefined, false, "true", 1]) {
    await assert.rejects(() => registrarActividad(DB, { ...DATOS, vendedor_id: 2, conjunta }, USUARIO),
      /Esta evidencia ya la presentó Juan el 2026-09-03. Si fue una actividad conjunta, confírmalo\./);
  }
  assert.equal(DB.pos.objetivo_actividades.length, 1);
});

test("todas las conjuntas apuntan al original, incluso después de anularlo", async () => {
  const DB = prepararDB();
  const original = await registrarActividad(DB, DATOS, USUARIO);
  const segunda = await registrarActividad(DB, { ...DATOS, vendedor_id: 2, conjunta: true }, USUARIO);
  anularActividad(DB, original.id, "Me equivoqué", USUARIO);
  const tercera = await registrarActividad(DB, { ...DATOS, vendedor_id: 3, conjunta: true }, USUARIO);
  assert.equal(segunda.conjunta_con, original.id);
  assert.equal(tercera.conjunta_con, original.id);
});

test("otra tienda no puede repetir evidencia aunque confirme conjunta", async () => {
  const DB = prepararDB();
  await registrarActividad(DB, DATOS, USUARIO);
  await assert.rejects(() => registrarActividad(DB, {
    ...DATOS, vendedor_id: 9, sucursal_id: 2, conjunta: true,
  }, USUARIO), /otra tienda|otra sucursal/i);
  assert.equal(DB.pos.objetivo_actividades.length, 1);
});

test("la repetición de foto depende de los bytes, no del nombre ni de la clase", async () => {
  const DB = prepararDB();
  const drive = driveFalso();
  const original = await registrarActividad(DB, FOTO, USUARIO, drive);
  await assert.rejects(() => registrarActividad(DB, {
    ...FOTO, actividad: "volanteo", archivo: { ...ARCHIVO, nombre_archivo: "otra.jpg" },
  }, USUARIO, drive), /Ya presentaste/);
  await assert.rejects(() => registrarActividad(DB, { ...FOTO, vendedor_id: 2 }, USUARIO, drive), /Juan/);
  assert.equal(drive.llamadas.length, 2);
  const conjunta = await registrarActividad(DB, { ...FOTO, vendedor_id: 2, conjunta: true }, USUARIO, drive);
  assert.equal(conjunta.conjunta_con, original.id);
});

test("evidencia anulada puede presentarse otra vez y los ids no se reutilizan", async () => {
  const DB = prepararDB();
  const original = await registrarActividad(DB, DATOS, USUARIO);
  anularActividad(DB, original.id, "Error", USUARIO);
  const nueva = await registrarActividad(DB, DATOS, USUARIO);
  assert.equal(nueva.id, 2);
  assert.equal(nueva.conjunta_con, null);
  assert.equal(DB.pos.objetivo_actividades.length, 2);
});

test("fallos de carpeta, subida y respuesta incompleta no escriben y liberan la huella", async () => {
  const variantes = [
    { asegurarCarpetaActividadesSucursal: async () => { throw new Error("Drive caído"); } },
    { subirArchivoADrive: async () => { throw new Error("Drive caído"); } },
    ...[{}, null, { id: "f" }, { webViewLink: "https://drive/f" }].map((salida) => ({ subirArchivoADrive: async () => salida })),
  ];
  for (const variante of variantes) {
    const DB = prepararDB();
    await registrarActividad(DB, DATOS, USUARIO);
    const antes = structuredClone(DB.pos.objetivo_actividades);
    await assert.rejects(() => registrarActividad(DB, FOTO, USUARIO, { ...driveFalso(), ...variante }), /Drive/);
    assert.deepEqual(DB.pos.objetivo_actividades, antes);
    assert.equal((await registrarActividad(DB, FOTO, USUARIO, driveFalso())).id, 2);
  }
});

test("dos registros simultáneos de la misma foto solo suben y guardan una vez", async () => {
  const DB = prepararDB();
  const drive = driveFalso();
  const resultados = await Promise.allSettled([
    registrarActividad(DB, FOTO, USUARIO, drive),
    registrarActividad(DB, FOTO, USUARIO, drive),
  ]);
  assert.deepEqual(resultados.map((r) => r.status), ["fulfilled", "rejected"]);
  assert.match(resultados[1].reason.message, /subiendo|curso/);
  assert.equal(DB.pos.objetivo_actividades.length, 1);
  assert.equal(drive.llamadas.filter((c) => c.operacion === "subir").length, 1);
});

test("subidas de fotos distintas reciben ids únicos al terminar", async () => {
  const DB = prepararDB();
  const registros = await Promise.all([
    registrarActividad(DB, FOTO, USUARIO, driveFalso()),
    registrarActividad(DB, { ...FOTO, archivo: { ...ARCHIVO, contenido_base64: "eHl6" } }, USUARIO, driveFalso()),
  ]);
  assert.deepEqual(registros.map((r) => r.id).sort(), [1, 2]);
});

test("revalida repetición después de Drive y conserva solo el registro que entró durante la espera", async () => {
  const DB = prepararDB();
  let entrante;
  const drive = {
    ...driveFalso(),
    async subirArchivoADrive() {
      entrante = {
        ...DATOS, id: 7, vigente: true, conjunta_con: null,
        evidencia: { tipo: "foto", huella: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" },
      };
      DB.pos.objetivo_actividades.push(entrante);
      return { id: "huerfano", webViewLink: "https://drive/huerfano" };
    },
  };
  await assert.rejects(() => registrarActividad(DB, FOTO, USUARIO, drive), /Ya presentaste/);
  assert.deepEqual(DB.pos.objetivo_actividades, [entrante]);
  anularActividad(DB, entrante.id, "Error", USUARIO);
  assert.equal((await registrarActividad(DB, FOTO, USUARIO, driveFalso())).id, 8);
});

test("anular exige registro vigente y motivo sin alterar ni borrar la evidencia", async () => {
  const DB = prepararDB();
  const registro = await registrarActividad(DB, FOTO, USUARIO, driveFalso());
  const antes = structuredClone(registro);
  for (const motivo of [undefined, null, "", "   ", {}, 123]) {
    assert.throws(() => anularActividad(DB, registro.id, motivo, USUARIO), /motivo/i);
    assert.deepEqual(registro, antes);
  }
  assert.throws(() => anularActividad(DB, 99, "Error", USUARIO), /existe|encontr/i);
  await conRelojEn("2026-09-22T18:00:00.000Z", () => anularActividad(DB, registro.id, "  Error de foto  ", USUARIO));
  assert.equal(registro.vigente, false);
  assert.equal(registro.anulado_por, "María");
  assert.equal(registro.anulado_en, "2026-09-22T18:00:00.000Z");
  assert.equal(registro.motivo_anulacion, "Error de foto");
  assert.deepEqual(registro.evidencia, antes.evidencia);
  assert.equal(DB.pos.objetivo_actividades.length, 1);
  assert.throws(() => anularActividad(DB, registro.id, "Otra vez", USUARIO), /anulad|vigente/i);
});

test("resultados se apilan con auditoría y permiten cero", async () => {
  const DB = prepararDB();
  const registro = await registrarActividad(DB, DATOS, USUARIO);
  await conRelojEn("2026-09-22T18:00:00.000Z", () => {
    agregarResultado(DB, registro.id, { contactos: 0, cotizaciones: 0 }, USUARIO);
    agregarResultado(DB, registro.id, { contactos: 5, cotizaciones: 2, nota: "  Seguimiento  " }, USUARIO);
  });
  assert.deepEqual(registro.resultados, [
    { contactos: 0, cotizaciones: 0, nota: null, registrado_por: "María", registrado_en: "2026-09-22T18:00:00.000Z" },
    { contactos: 5, cotizaciones: 2, nota: "Seguimiento", registrado_por: "María", registrado_en: "2026-09-22T18:00:00.000Z" },
  ]);
});

test("resultados rechazan cantidades ausentes o no enteras, nota inválida y registros anulados", async () => {
  const DB = prepararDB();
  const registro = await registrarActividad(DB, DATOS, USUARIO);
  for (const campo of ["contactos", "cotizaciones"]) {
    for (const valor of [undefined, null, -1, 1.5, "2", NaN, Infinity, true]) {
      assert.throws(() => agregarResultado(DB, registro.id, { contactos: 0, cotizaciones: 0, [campo]: valor }, USUARIO), /entero/);
      assert.deepEqual(registro.resultados, []);
    }
  }
  assert.throws(() => agregarResultado(DB, registro.id, { contactos: 0, cotizaciones: 0, nota: "a".repeat(301) }, USUARIO), /300/);
  assert.throws(() => agregarResultado(DB, 99, { contactos: 0, cotizaciones: 0 }, USUARIO), /existe|encontr/i);
  anularActividad(DB, registro.id, "Error", USUARIO);
  assert.throws(() => agregarResultado(DB, registro.id, { contactos: 1, cotizaciones: 0 }, USUARIO), /anulad|vigente/i);
  assert.deepEqual(registro.resultados, []);
});

test("lista por fecha vigentes y anuladas, filtrando mes, tienda y persona", async () => {
  const DB = prepararDB();
  const primera = await registrarActividad(DB, { ...DATOS, fecha: "2026-09-05" }, USUARIO);
  const segunda = await registrarActividad(DB, { ...DATOS, vendedor_id: 2, link: "https://example.com/2" }, USUARIO);
  anularActividad(DB, segunda.id, "Error", USUARIO);
  await registrarActividad(DB, { ...DATOS, mes: "2026-08", fecha: "2026-08-01", link: "https://example.com/3" }, USUARIO);
  await registrarActividad(DB, { ...DATOS, sucursal_id: 2, vendedor_id: 9, link: "https://example.com/4" }, USUARIO);
  assert.deepEqual(actividadesDelMes(DB, FILTRO).map((r) => r.id), [segunda.id, primera.id]);
  assert.deepEqual(actividadesDelMes(DB, { ...FILTRO, vendedor_id: 1 }).map((r) => r.id), [primera.id]);
  assert.equal(DB.pos.objetivo_actividades[0], primera, "listar no reordena la colección original");
});

test("resumen cuenta una conjunta por tienda y una por cada persona", async () => {
  const DB = prepararDB();
  await registrarActividad(DB, DATOS, USUARIO);
  await registrarActividad(DB, { ...DATOS, vendedor_id: 2, conjunta: true }, USUARIO);
  assert.deepEqual(resumenActividades(DB, FILTRO), [
    { actividad: "grupos", etiqueta: "Publicación en grupos", declaradas: 1, conjuntas: 1 },
    { actividad: "marketplace", etiqueta: "Publicación en Marketplace", declaradas: 0, conjuntas: 0 },
    { actividad: "iglesia", etiqueta: "Salida a iglesia", declaradas: 0, conjuntas: 0 },
    { actividad: "volanteo", etiqueta: "Jornada de volanteo", declaradas: 0, conjuntas: 0 },
  ]);
  for (const vendedor_id of [1, 2]) {
    const [fila] = resumenActividades(DB, { ...FILTRO, vendedor_id });
    assert.equal(fila.declaradas, 1);
    assert.equal(fila.conjuntas, 1);
  }
});

test("anular original deja contar solo a la conjunta más antigua y luego a la siguiente", async () => {
  const DB = prepararDB();
  const original = await registrarActividad(DB, DATOS, USUARIO);
  const segunda = await registrarActividad(DB, { ...DATOS, vendedor_id: 2, conjunta: true }, USUARIO);
  const tercera = await registrarActividad(DB, { ...DATOS, vendedor_id: 3, conjunta: true }, USUARIO);
  anularActividad(DB, original.id, "Error", USUARIO);
  assert.equal(resumenActividades(DB, FILTRO)[0].declaradas, 1);
  assert.equal(resumenActividades(DB, { ...FILTRO, vendedor_id: 1 })[0].declaradas, 0);
  anularActividad(DB, segunda.id, "Error", USUARIO);
  assert.equal(resumenActividades(DB, FILTRO)[0].declaradas, 1);
  anularActividad(DB, tercera.id, "Error", USUARIO);
  assert.equal(resumenActividades(DB, FILTRO)[0].declaradas, 0);
});

test("conjuntas en otro mes no duplican la tienda y el relevo usa antigüedad de registro", async () => {
  const DB = prepararDB();
  const original = await registrarActividad(DB, { ...DATOS, mes: "2026-08", fecha: "2026-08-03" }, USUARIO);
  await conRelojEn("2026-09-10T18:00:00.000Z", () => registrarActividad(DB, {
    ...DATOS, fecha: "2026-09-09", vendedor_id: 2, conjunta: true,
  }, USUARIO));
  await conRelojEn("2026-09-11T18:00:00.000Z", () => registrarActividad(DB, {
    ...DATOS, mes: "2026-08", fecha: "2026-08-01", vendedor_id: 3, conjunta: true,
  }, USUARIO));
  assert.equal(resumenActividades(DB, FILTRO)[0].declaradas, 0);
  anularActividad(DB, original.id, "Error", USUARIO);
  assert.equal(resumenActividades(DB, FILTRO)[0].declaradas, 1);
  assert.equal(resumenActividades(DB, { ...FILTRO, mes: "2026-08" })[0].declaradas, 0);
});

test("Drive crea y cachea raíz y sucursal de actividades sin mezclar carpetas de depósitos", async (t) => {
  const creaciones = [];
  const DB = { drive: { cuenta: { access_token: "AT", expires_at: Date.now() + 3600000 } } };
  const sucursal = { id: 1, nombre: "Ocosingo", drive_folder_depositos_id: "depositos" };
  const fetch = t.mock.method(globalThis, "fetch", async (url, opciones) => {
    if (opciones?.method === "POST") {
      creaciones.push(JSON.parse(opciones.body));
      return { ok: true, json: async () => ({ id: `carpeta-${creaciones.length}` }) };
    }
    return { ok: true, json: async () => ({ files: [] }) };
  });
  assert.equal(await driveReal.asegurarCarpetaActividadesSucursal(DB, sucursal), "carpeta-2");
  assert.deepEqual(creaciones, [
    { name: "Evidencias de Actividades", mimeType: "application/vnd.google-apps.folder" },
    { name: "Ocosingo", mimeType: "application/vnd.google-apps.folder", parents: ["carpeta-1"] },
  ]);
  assert.equal(DB.drive.carpeta_actividades_id, "carpeta-1");
  assert.equal(sucursal.drive_folder_actividades_id, "carpeta-2");
  assert.equal(await driveReal.asegurarCarpetaActividadesRaiz(DB), "carpeta-1");
  assert.equal(await driveReal.asegurarCarpetaActividadesSucursal(DB, sucursal), "carpeta-2");
  assert.equal(fetch.mock.calls.length, 4);
});

test("Drive reutiliza carpetas existentes y usa el id de sucursal cuando no tiene nombre", async (t) => {
  const consultas = [];
  const DB = { drive: { cuenta: { access_token: "AT", expires_at: Date.now() + 3600000 } } };
  t.mock.method(globalThis, "fetch", async (url, opciones) => {
    assert.notEqual(opciones?.method, "POST");
    consultas.push(new URL(url).searchParams.get("q"));
    return { ok: true, json: async () => ({ files: [{ id: `existente-${consultas.length}` }] }) };
  });
  const sucursal = { id: 2 };
  assert.equal(await driveReal.asegurarCarpetaActividadesSucursal(DB, sucursal), "existente-2");
  assert.match(consultas[0], /Evidencias de Actividades/);
  assert.match(consultas[1], /Sucursal 2/);
  assert.match(consultas[1], /existente-1.*parents/);
});

test("si el mes se cierra mientras la foto sube a Drive, no se guarda nada", async () => {
  const DB = prepararDB();
  const drive = driveFalso();
  let cerrado = false;
  const subirOriginal = drive.subirArchivoADrive;
  // El cierre del mes llega justo durante la subida.
  drive.subirArchivoADrive = async (...args) => { cerrado = true; return subirOriginal(...args); };
  const antesDeGuardar = () => { if (cerrado) throw new Error("El mes ya está cerrado para esta sucursal"); };
  await assert.rejects(registrarActividad(DB, FOTO, USUARIO, drive, { antesDeGuardar }), /cerrado/);
  assert.deepEqual(DB.pos.objetivo_actividades, []);
});
