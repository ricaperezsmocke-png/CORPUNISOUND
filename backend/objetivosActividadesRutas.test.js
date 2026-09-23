/** Rutas reales de actividades: identidad, alcance, evidencia y mes cerrado. */
const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

// Mismo arranque que objetivosRutas.test.js, siempre sobre SQLite temporal.
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "actividades-rutas-")), "datos.sqlite");
process.env.JWT_SECRET = process.env.JWT_SECRET || "secreto-de-pruebas";
const { guardar } = require("./persistencia");
const plantillaGuardada = [{ id: 99, mes: "2025-01", sucursal_id: 1, vendedor_id: 1, desde: "2025-01-01", hasta: null }];
guardar({ pos: { objetivo_plantilla: plantillaGuardada } });
const app = require("./server");
const actividadesAlArrancar = app.DB.pos.objetivo_actividades;
const plantillaAlArrancar = structuredClone(app.DB.pos.objetivo_plantilla);
const { sembrarCuentas } = require("./testHelpers");
const { firmarToken } = require("./auth");
const { crearRol } = require("./roles");
const { fijarObjetivo, registrarEnPlantilla } = require("./objetivos");
const { registrarActividad } = require("./objetivosActividades");
const { cerrarMes } = require("./objetivosCierre");
const drive = require("./drive");

const MES = "2026-08";
const RAIZ = `/api/objetivos/${MES}/1`;
const DATOS = {
  mes: MES, fecha: `${MES}-01`, sucursal_id: "1", vendedor_id: "1",
  actividad: "grupos", link: "https://Facebook.com/publicacion/#foto",
};
const META = { mes: MES, sucursal_id: "1", vendedor_id: null, tipo: "actividad", actividad: "grupos", monto: 9 };
const ARCHIVO = { nombre_archivo: "iglesia.jpg", tipo_mime: "image/jpeg", contenido_base64: Buffer.from("foto de prueba").toString("base64") };
const RESULTADO = { contactos: 3, cotizaciones: 1, nota: "Seguimiento" };
let servidor, base, vendedor, companero, sinLigar, gerente, gerenteAjeno, global, soloCierre;
let sinUso, gerenteTrasladado, carpetaOriginal, subirOriginal;

before(async () => {
  const rolGerente = crearRol(app.DB, {
    nombre: "Gerencia de actividades", modulos: ["pos"], permisos: ["usar_gerente_ventas", "editar_objetivos_venta"],
  });
  const rolGlobal = crearRol(app.DB, {
    nombre: "Gerencia global de actividades", modulos: ["pos"], permisos: [...rolGerente.permisos, "ver_todas_las_sucursales"],
  });
  const rolCierre = crearRol(app.DB, { nombre: "Solo cierre actividades", modulos: ["pos"], permisos: ["cerrar_mes_objetivos"] });
  const cuentas = [
    { id: 50, nombre: "Ana López", rol_id: 3, sucursal_id: 1, vendedor_id: 1 },
    { id: 51, nombre: "Carlos Ruiz", rol_id: 3, sucursal_id: 1, vendedor_id: 2 },
    { id: 52, nombre: "Sin ligar", rol_id: 3, sucursal_id: 1 },
    { id: 60, nombre: "Gerente", rol_id: rolGerente.id, sucursal_id: 1 },
    { id: 61, nombre: "Gerente ajeno", rol_id: rolGerente.id, sucursal_id: 2 },
    { id: 62, nombre: "Global", rol_id: rolGlobal.id, sucursal_id: 1 },
    { id: 63, nombre: "Administradora", rol_id: rolCierre.id, sucursal_id: 1 },
    { id: 64, nombre: "Sin uso", rol_id: rolCierre.id, sucursal_id: 1, vendedor_id: 1 },
    { id: 65, nombre: "Gerente trasladado", rol_id: rolGerente.id, sucursal_id: 2, vendedor_id: 1 },
  ];
  sembrarCuentas(app, cuentas);
  [vendedor, companero, sinLigar, gerente, gerenteAjeno, global, soloCierre, sinUso, gerenteTrasladado] = cuentas.map(firmarToken);
  carpetaOriginal = drive.asegurarCarpetaActividadesSucursal;
  subirOriginal = drive.subirArchivoADrive;
  await new Promise((listo) => { servidor = app.listen(0, listo); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});

beforeEach(() => {
  app.DB.pos.vendedores.find((v) => v.id === 1).sucursal_id = 1;
  app.DB.admin.usuarios.find((u) => u.id === 50).sucursal_id = 1;
  for (const coleccion of ["objetivos", "objetivo_plantilla", "objetivo_capturas", "objetivo_cierres", "objetivo_actividades"]) {
    app.DB.pos[coleccion] = [];
  }
  for (const [sucursal_id, vendedores] of [[1, [1, 2]], [2, [3]]]) {
    fijarObjetivo(app.DB, { mes: MES, sucursal_id, vendedor_id: null, tipo: "venta", monto: 1000 }, { nombre: "Fixture" });
    for (const vendedor_id of vendedores) registrarEnPlantilla(app.DB, { mes: MES, sucursal_id, vendedor_id });
  }
  drive.asegurarCarpetaActividadesSucursal = async () => "carpeta-actividades";
  drive.subirArchivoADrive = async () => ({ id: "archivo-privado", webViewLink: "https://drive.google.com/file/d/archivo-privado/view" });
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
  try { cuerpo = await r.json(); } catch (_) {}
  return { status: r.status, cuerpo };
}

function estado(r, esperado) {
  assert.equal(r.status, esperado, JSON.stringify(r));
  if (esperado === 404) {
    assert.ok(r.cuerpo && typeof r.cuerpo.error === "string", "el 404 debe venir del control de acceso, no de una ruta ausente");
    assert.match(r.cuerpo.error, /no encontrad/i);
  }
  if (esperado === 400) assert.equal(typeof r.cuerpo?.error, "string");
  assert.ok(!JSON.stringify(r.cuerpo).includes('"drive_file_id"'), "ninguna respuesta expone drive_file_id");
}

function fixture(extra = {}) {
  return registrarActividad(app.DB, { ...DATOS, sucursal_id: 1, vendedor_id: 1, ...extra }, { nombre: "Fixture" }, drive);
}

function sellar() {
  return cerrarMes(app.DB, {
    mes: MES, sucursal_id: 1, reales: [1, 2].map((vendedor_id) => ({ vendedor_id, real_sicar: 0 })),
  }, { nombre: "Fixture" });
}

test("una base guardada sin objetivo_actividades restaura sus datos y arranca con lista vacía", async () => {
  assert.deepEqual(plantillaAlArrancar, plantillaGuardada);
  assert.deepEqual(actividadesAlArrancar, []);
  const r = await pedir("GET", `${RAIZ}/actividades/1`, vendedor);
  estado(r, 200);
  assert.deepEqual(r.cuerpo.registros, []);
  assert.deepEqual(r.cuerpo.resumen.map((linea) => linea.declaradas), [0, 0, 0, 0]);
});

test("el catálogo responde sus cuatro clases con permiso de uso", async () => {
  const r = await pedir("GET", "/api/objetivos/catalogo-actividades", vendedor);
  estado(r, 200);
  assert.deepEqual(r.cuerpo.map(({ clave, evidencia }) => ({ clave, evidencia })), [
    { clave: "grupos", evidencia: "link" }, { clave: "marketplace", evidencia: "link" },
    { clave: "iglesia", evidencia: "foto" }, { clave: "volanteo", evidencia: "foto" },
  ]);
  assert.equal(r.cuerpo[0].etiqueta, "Publicación en grupos");
  estado(await pedir("GET", "/api/objetivos/catalogo-actividades", sinUso), 403);
});

test("las rutas nuevas exigen sesión y las personales exigen usar_gerente_ventas", async () => {
  const registro = await fixture();
  const rutas = [
    ["GET", "/api/objetivos/catalogo-actividades"],
    ["GET", `${RAIZ}/actividades/1`],
    ["POST", "/api/objetivos/actividad", DATOS],
    ["POST", `/api/objetivos/actividad/${registro.id}/anular`, { motivo: "Error" }],
    ["POST", `/api/objetivos/actividad/${registro.id}/resultado`, RESULTADO],
  ];
  const antes = structuredClone(app.DB.pos);
  for (const [metodo, ruta, datos] of rutas) {
    estado(await pedir(metodo, ruta, null, datos), 401);
    estado(await pedir(metodo, ruta, sinUso, datos), 403);
  }
  estado(await pedir("GET", `${RAIZ}/actividades`, null), 401);
  assert.deepEqual(app.DB.pos, antes);
});

test("el vendedor registra link normalizado, con autor del token, y lo consulta", async () => {
  const r = await pedir("POST", "/api/objetivos/actividad", vendedor, { ...DATOS, registrado_por: "Intruso", nota: "  Publicación  " });
  estado(r, 200);
  assert.equal(r.cuerpo.vendedor_id, 1);
  assert.equal(r.cuerpo.sucursal_id, 1);
  assert.equal(r.cuerpo.registrado_por, "Ana López");
  assert.equal(r.cuerpo.nota, "Publicación");
  assert.deepEqual(r.cuerpo.evidencia, { tipo: "link", link: "https://facebook.com/publicacion" });
  const lista = await pedir("GET", `${RAIZ}/actividades/1`, vendedor);
  estado(lista, 200);
  assert.deepEqual(lista.cuerpo.registros, [r.cuerpo]);
  assert.equal(lista.cuerpo.resumen[0].declaradas, 1);
});

test("solo la propia persona registra y consulta; gerente no captura por ella", async () => {
  await fixture({ vendedor_id: 2 });
  const antes = structuredClone(app.DB.pos);
  for (const token of [vendedor, sinLigar]) estado(await pedir("GET", `${RAIZ}/actividades/2`, token), 404);
  for (const [token, vendedor_id] of [[vendedor, "2"], [sinLigar, "1"], [gerente, "1"], [global, "1"]]) {
    estado(await pedir("POST", "/api/objetivos/actividad", token, { ...DATOS, vendedor_id }), 404);
  }
  estado(await pedir("GET", `${RAIZ}/actividades/1`, sinLigar), 404);
  assert.deepEqual(app.DB.pos, antes);
});

test("lista de tienda: jefatura o cierre con alcance; selector no amplía ni reduce permisos", async () => {
  await fixture();
  await fixture({ vendedor_id: 2, conjunta: true });
  await fixture({ sucursal_id: 2, vendedor_id: 3, link: "https://ejemplo.com/otra-tienda" });
  const antes = structuredClone(app.DB.pos);
  for (const selector of ["1", "2", "todas"]) {
    const query = `?sucursal_id=${selector}`;
    for (const token of [vendedor, sinLigar, gerenteAjeno]) estado(await pedir("GET", `${RAIZ}/actividades${query}`, token), 404);
    estado(await pedir("GET", `${RAIZ}/actividades/2${query}`, vendedor), 404);
    estado(await pedir("GET", `${RAIZ}/actividades/1${query}`, gerenteAjeno), 404);
    estado(await pedir("GET", `/api/objetivos/${MES}/2/actividades${query}`, soloCierre), 404);
    for (const token of [gerente, soloCierre, global]) {
      const r = await pedir("GET", `${RAIZ}/actividades${query}`, token);
      estado(r, 200);
      assert.deepEqual(r.cuerpo.registros.map((item) => item.vendedor_id), [1, 2]);
      assert.equal(r.cuerpo.resumen_tienda[0].declaradas, 1);
      assert.deepEqual(r.cuerpo.resumen_por_persona.map((item) => [item.vendedor_id, item.resumen[0].declaradas]), [[1, 1], [2, 1]]);
    }
    estado(await pedir("GET", `/api/objetivos/${MES}/2/actividades${query}`, global), 200);
    estado(await pedir("GET", `${RAIZ}/actividades/1${query}`, vendedor), 200);
  }
  assert.deepEqual(app.DB.pos, antes);
});

test("anular y resultado usan identidad, tienda y mes originales aunque el cuerpo mienta", async () => {
  const registro = await fixture({ vendedor_id: 2 });
  const antes = structuredClone(app.DB.pos);
  for (const selector of ["1", "2", "todas"]) {
    for (const token of [vendedor, sinLigar, gerente, global]) {
      for (const accion of ["anular", "resultado"]) {
        estado(await pedir("POST", `/api/objetivos/actividad/${registro.id}/${accion}?sucursal_id=${selector}`, token, {
          ...RESULTADO, motivo: "Error", vendedor_id: "1", sucursal_id: "1", mes: "2026-07",
        }), 404);
      }
    }
    estado(await pedir("POST", `/api/objetivos/actividad?sucursal_id=${selector}`, vendedor, {
      ...DATOS, sucursal_id: "2", vendedor_id: "1",
    }), 404);
  }
  assert.deepEqual(app.DB.pos, antes);
  const r = await pedir("POST", `/api/objetivos/actividad/${registro.id}/resultado?sucursal_id=2`, companero, {
    ...RESULTADO, vendedor_id: "1", sucursal_id: "2", registrado_por: "Intruso",
  });
  estado(r, 200);
  assert.equal(r.cuerpo.vendedor_id, 2);
  assert.equal(r.cuerpo.sucursal_id, 1);
  assert.equal(r.cuerpo.resultados[0].registrado_por, "Carlos Ruiz");
});

test("mes cerrado rechaza registro, anulación, resultado y meta de actividad sin modificar nada", async () => {
  const registro = await fixture();
  sellar();
  const antes = structuredClone(app.DB.pos);
  for (const [ruta, token, datos] of [
    ["/api/objetivos/actividad", vendedor, { ...DATOS, link: "https://ejemplo.com/nueva" }],
    [`/api/objetivos/actividad/${registro.id}/anular`, vendedor, { motivo: "Error", mes: "2026-07", sucursal_id: "2" }],
    [`/api/objetivos/actividad/${registro.id}/resultado`, vendedor, { ...RESULTADO, mes: "2026-07", sucursal_id: "2" }],
    ["/api/objetivos", gerente, META],
  ]) {
    const r = await pedir("POST", ruta, token, datos);
    estado(r, 400);
    assert.match(r.cuerpo.error, /cerrado/i);
  }
  assert.deepEqual(app.DB.pos, antes);
});

test("foto: conserva id en DB, expone solo link en altas, resultados, anulación y listas", async () => {
  const r = await pedir("POST", "/api/objetivos/actividad", vendedor, { ...DATOS, actividad: "iglesia", link: undefined, archivo: ARCHIVO });
  estado(r, 200);
  const id = r.cuerpo.id;
  assert.equal(r.cuerpo.evidencia.drive_link, "https://drive.google.com/file/d/archivo-privado/view");
  assert.equal(app.DB.pos.objetivo_actividades[0].evidencia.drive_file_id, "archivo-privado");
  for (let i = 0; i < 2; i++) {
    const resultado = await pedir("POST", `/api/objetivos/actividad/${id}/resultado`, vendedor, RESULTADO);
    estado(resultado, 200);
    assert.equal(resultado.cuerpo.resultados.length, i + 1);
  }
  const anulado = await pedir("POST", `/api/objetivos/actividad/${id}/anular`, vendedor, { motivo: "  Foto equivocada  " });
  estado(anulado, 200);
  assert.equal(anulado.cuerpo.vigente, false);
  assert.equal(anulado.cuerpo.motivo_anulacion, "Foto equivocada");
  assert.equal(anulado.cuerpo.anulado_por, "Ana López");
  for (const [ruta, token] of [[`${RAIZ}/actividades/1`, vendedor], [`${RAIZ}/actividades`, gerente], [RAIZ, gerente]]) {
    const lista = await pedir("GET", ruta, token);
    estado(lista, 200);
    if (lista.cuerpo.registros) assert.equal(lista.cuerpo.registros[0].vigente, false);
  }
  assert.equal(app.DB.pos.objetivo_actividades[0].evidencia.drive_file_id, "archivo-privado", "serializar no borra el id guardado");
});

test("Drive falla: respuesta 400 con error y ningún registro guardado", async () => {
  drive.subirArchivoADrive = async () => { throw new Error("Drive no disponible"); };
  const antes = structuredClone(app.DB.pos.objetivo_actividades);
  const r = await pedir("POST", "/api/objetivos/actividad", vendedor, { ...DATOS, actividad: "iglesia", link: undefined, archivo: ARCHIVO });
  estado(r, 400);
  assert.match(r.cuerpo.error, /Drive no disponible/);
  assert.deepEqual(app.DB.pos.objetivo_actividades, antes);
});

test("errores del dominio llegan como 400 JSON sin mutar actividades", async () => {
  const registro = await fixture();
  const antes = structuredClone(app.DB.pos);
  for (const [ruta, datos] of [
    ["/api/objetivos/actividad", { ...DATOS, link: "javascript:alert(1)" }],
    ["/api/objetivos/actividad", { ...DATOS, actividad: "tiktok" }],
    ["/api/objetivos/actividad", DATOS],
    [`/api/objetivos/actividad/${registro.id}/anular`, { motivo: " " }],
    [`/api/objetivos/actividad/${registro.id}/resultado`, { contactos: -1, cotizaciones: 0 }],
    [`/api/objetivos/actividad/${registro.id}/resultado`, {}],
  ]) estado(await pedir("POST", ruta, vendedor, datos), 400);
  assert.deepEqual(app.DB.pos, antes);
});

test("IDs y meses inválidos responden 400; registro inexistente responde 404 JSON", async () => {
  for (const id of ["abc", "0", "-1", "1.5"]) {
    estado(await pedir("GET", `${RAIZ}/actividades/${id}`, gerente), 400);
    estado(await pedir("GET", `/api/objetivos/${MES}/${id}/actividades`, gerente), 400);
    for (const accion of ["anular", "resultado"]) {
      estado(await pedir("POST", `/api/objetivos/actividad/${id}/${accion}`, vendedor, RESULTADO), 400);
    }
  }
  for (const campo of ["sucursal_id", "vendedor_id"]) {
    for (const valor of [null, true, [], {}, "", "abc", "0", "1.5"]) {
      estado(await pedir("POST", "/api/objetivos/actividad", vendedor, { ...DATOS, [campo]: valor }), 400);
    }
  }
  for (const sufijo of ["/actividades", "/actividades/1"]) {
    estado(await pedir("GET", `/api/objetivos/2026-13/1${sufijo}`, gerente), 400);
  }
  for (const accion of ["anular", "resultado"]) {
    estado(await pedir("POST", `/api/objetivos/actividad/999/${accion}`, vendedor, RESULTADO), 404);
  }
  assert.deepEqual(app.DB.pos.objetivo_actividades, []);
});

test("metas de actividad se fijan y reparten sin alterar venta ni filtrar totales a vendedores", async () => {
  for (const datos of [META, { ...META, vendedor_id: "1", monto: 4 }, { ...META, vendedor_id: "2", monto: 3 }]) {
    estado(await pedir("POST", "/api/objetivos", gerente, datos), 200);
  }
  const tienda = await pedir("GET", RAIZ, gerente);
  estado(tienda, 200);
  assert.equal(tienda.cuerpo.meta_tienda, 1000);
  assert.deepEqual(tienda.cuerpo.actividades[0], {
    actividad: "grupos", etiqueta: "Publicación en grupos", meta_tienda: 9, asignado: 7, sin_asignar: 2,
    lineas: [{ vendedor_id: 1, monto: 4 }, { vendedor_id: 2, monto: 3 }],
  });
  assert.deepEqual(tienda.cuerpo.actividades.map((item) => item.actividad), ["grupos", "marketplace", "iglesia", "volanteo"]);
  for (const token of [vendedor, gerenteTrasladado]) {
    const propia = await pedir("GET", RAIZ, token);
    estado(propia, 200);
    assert.equal(propia.cuerpo.actividades[0].lineas[0].monto, 4);
    for (const actividad of propia.cuerpo.actividades) {
      assert.deepEqual(actividad.lineas.map((linea) => linea.vendedor_id), [1]);
      for (const campo of ["meta_tienda", "asignado", "sin_asignar"]) assert.equal(Object.hasOwn(actividad, campo), false);
    }
  }
});

test("cambiar meta de actividad exige motivo y el historial distingue actividad de venta", async () => {
  estado(await pedir("POST", "/api/objetivos", gerente, META), 200);
  const antes = structuredClone(app.DB.pos);
  for (const motivo of [undefined, null, "", " ", 123, true, {}]) {
    const r = await pedir("POST", "/api/objetivos", gerente, { ...META, monto: 12, motivo });
    estado(r, 400);
    assert.match(r.cuerpo.error, /motivo/i);
  }
  assert.deepEqual(app.DB.pos, antes);
  estado(await pedir("POST", "/api/objetivos", gerente, { ...META, monto: 12, motivo: "Más publicaciones" }), 200);
  const historial = await pedir("GET", `${RAIZ}/historial/tienda?tipo=actividad&actividad=grupos`, gerente);
  estado(historial, 200);
  assert.deepEqual(historial.cuerpo.map((item) => [item.version, item.monto, item.vigente]), [[1, 9, false], [2, 12, true]]);
  const venta = await pedir("GET", `${RAIZ}/historial/tienda`, gerente);
  estado(venta, 200);
  assert.deepEqual(venta.cuerpo.map((item) => [item.tipo, item.monto]), [["venta", 1000]]);
  const otra = await pedir("GET", `${RAIZ}/historial/tienda?tipo=actividad&actividad=iglesia`, gerente);
  estado(otra, 200);
  assert.deepEqual(otra.cuerpo, []);
});

test("sugerencia e historial validan tipo y clase; sin query conservan venta", async () => {
  estado(await pedir("POST", "/api/objetivos", gerente, META), 200);
  const r = await pedir("GET", `${RAIZ}/sugerencia?tipo=actividad&actividad=grupos`, gerente);
  estado(r, 200);
  assert.deepEqual(r.cuerpo, [{ vendedor_id: 1, monto: 4 }, { vendedor_id: 2, monto: 5 }]);
  const venta = await pedir("GET", `${RAIZ}/sugerencia`, gerente);
  estado(venta, 200);
  assert.deepEqual(venta.cuerpo, [{ vendedor_id: 1, monto: 500 }, { vendedor_id: 2, monto: 500 }]);
  for (const sufijo of ["sugerencia", "historial/tienda"]) {
    for (const query of ["tipo=actividad", "tipo=actividad&actividad=tiktok", "tipo=otro", "tipo=venta&actividad=grupos"]) {
      estado(await pedir("GET", `${RAIZ}/${sufijo}?${query}`, gerente), 400);
    }
    estado(await pedir("GET", `${RAIZ}/${sufijo}?tipo=actividad&actividad=grupos&sucursal_id=2`, gerenteAjeno), 404);
    estado(await pedir("GET", `${RAIZ}/${sufijo}?tipo=actividad&actividad=grupos`, vendedor), 403);
  }
});

test("traslado: la persona conserva su alcance histórico, la jefatura consulta pero no escribe por ella", async () => {
  app.DB.pos.objetivo_plantilla.find((item) => item.vendedor_id === 1).hasta = `${MES}-15`;
  app.DB.pos.vendedores.find((item) => item.id === 1).sucursal_id = 2;
  registrarEnPlantilla(app.DB, { mes: MES, sucursal_id: 2, vendedor_id: 1, desde: `${MES}-16` });
  const cuenta = app.DB.admin.usuarios.find((item) => item.id === 50);
  cuenta.sucursal_id = 2;
  const trasladada = firmarToken(cuenta);
  const r = await pedir("POST", "/api/objetivos/actividad?sucursal_id=2", trasladada, DATOS);
  estado(r, 200);
  estado(await pedir("GET", `${RAIZ}/actividades/1`, trasladada), 200);
  estado(await pedir("GET", `${RAIZ}/actividades/1`, gerente), 200);
  estado(await pedir("GET", `${RAIZ}/actividades/2`, trasladada), 404);
  estado(await pedir("GET", `${RAIZ}/actividades`, gerenteTrasladado), 404);
  estado(await pedir("GET", `/api/objetivos/${MES}/3/actividades/1?sucursal_id=1`, trasladada), 404);
  estado(await pedir("POST", "/api/objetivos/actividad", gerente, DATOS), 404);
  const antes = structuredClone(app.DB.pos.objetivo_actividades);
  estado(await pedir("POST", "/api/objetivos/actividad", trasladada, {
    ...DATOS, fecha: `${MES}-16`, link: "https://ejemplo.com/fuera-de-plantilla",
  }), 400);
  assert.deepEqual(app.DB.pos.objetivo_actividades, antes);
  estado(await pedir("POST", `/api/objetivos/actividad/${r.cuerpo.id}/resultado`, trasladada, RESULTADO), 200);
  estado(await pedir("POST", `/api/objetivos/actividad/${r.cuerpo.id}/anular`, trasladada, { motivo: "Error" }), 200);
});

test("el cierre sellado y el previo no exponen el drive_file_id de las fotos", async () => {
  await registrarActividad(app.DB, { ...DATOS, sucursal_id: 1, vendedor_id: 1, actividad: "iglesia", link: undefined, archivo: ARCHIVO },
    { nombre: "Fixture" }, drive);
  estado(await pedir("GET", `${RAIZ}/previo-cierre`, soloCierre), 200);
  const cerrado = await pedir("POST", "/api/objetivos/cierre", soloCierre, {
    mes: MES, sucursal_id: 1, reales: [1, 2].map((vendedor_id) => ({ vendedor_id, real_sicar: 0 })),
  });
  estado(cerrado, 200);
  assert.equal(cerrado.cuerpo.foto.actividades[0].evidencia.drive_link, "https://drive.google.com/file/d/archivo-privado/view");
  estado(await pedir("GET", `${RAIZ}/cierre`, soloCierre), 200);
  const sellado = app.DB.pos.objetivo_cierres[0];
  assert.equal(sellado.foto.actividades[0].evidencia.drive_file_id, "archivo-privado", "el sello conserva el id");
});

test("HTTP: si el mes se sella mientras la foto sube a Drive, el alta responde 400 y no guarda nada", async () => {
  drive.subirArchivoADrive = async () => {
    sellar(); // la administradora cierra el mes justo durante la subida
    return { id: "archivo-privado", webViewLink: "https://drive.google.com/file/d/archivo-privado/view" };
  };
  const r = await pedir("POST", "/api/objetivos/actividad", vendedor, { ...DATOS, actividad: "iglesia", link: undefined, archivo: ARCHIVO });
  estado(r, 400);
  assert.match(r.cuerpo.error, /cerrado/i);
  assert.deepEqual(app.DB.pos.objetivo_actividades, []);
});
