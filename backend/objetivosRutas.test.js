/** Cableado HTTP real: identidad, permisos, sucursal y tipos del borde. */
const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

// Antes de cargar el servidor: jamás usar la base del worktree.
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "objetivos-rutas-")), "datos.sqlite");
process.env.JWT_SECRET = process.env.JWT_SECRET || "secreto-de-pruebas";
const app = require("./server");
const { sembrarCuentas } = require("./testHelpers");
const { firmarToken } = require("./auth");
const { crearRol } = require("./roles");
const { listarPermisos } = require("./permisosCatalogo");
const { fijarObjetivo, registrarEnPlantilla } = require("./objetivos");
const { capturarDia } = require("./objetivosCaptura");
const { cerrarMes } = require("./objetivosCierre");

const MES = "2026-08";
const PERIODO = { mes: MES, sucursal_id: "1" };
const CAPTURA = { ...PERIODO, vendedor_id: "1", tipo: "venta", fecha: "2026-08-01", monto: 100 };
const META = { ...PERIODO, vendedor_id: null, tipo: "venta", monto: 1000 };
const RECTIFICACION = { vendedor_id: "1", campo: "real_sicar", valor_nuevo: 80, motivo: "Devolución" };
const RUTAS = [
  ["GET", `/api/objetivos/${MES}/1`],
  ["POST", "/api/objetivos", META],
  ["GET", `/api/objetivos/${MES}/1/sugerencia`],
  ["POST", "/api/objetivos/plantilla", { ...PERIODO, vendedor_id: "1" }],
  ["POST", "/api/objetivos/captura", CAPTURA],
  ["POST", "/api/objetivos/captura/1/corregir", { monto: 80 }],
  ["GET", `/api/objetivos/${MES}/1/previo-cierre`],
  ["POST", "/api/objetivos/cierre", { ...PERIODO, reales: [] }],
  ["POST", "/api/objetivos/cierre/1/rectificar", RECTIFICACION],
];
let servidor, base, admin, vendedor, companero, sinLigar, gerente, gerenteCierre, global, soloCierre;

before(async () => {
  // Roles explícitos: editar y cerrar son facultades independientes.
  const rolGerente = crearRol(app.DB, { nombre: "Metas de prueba", modulos: ["pos"], permisos: ["usar_gerente_ventas", "editar_objetivos_venta"] });
  const rolCierre = crearRol(app.DB, { nombre: "Metas y cierre de prueba", modulos: ["pos"], permisos: [...rolGerente.permisos, "cerrar_mes_objetivos"] });
  const rolGlobal = crearRol(app.DB, { nombre: "Global de prueba", modulos: ["pos"], permisos: [...rolCierre.permisos, "ver_todas_las_sucursales"] });
  const rolSoloCierre = crearRol(app.DB, { nombre: "Solo cierre de prueba", modulos: ["pos"], permisos: ["cerrar_mes_objetivos"] });
  const cuentas = [
    { id: 1, nombre: "Victor", rol_id: 1, sucursal_id: 1 },
    { id: 50, nombre: "Ana López", rol_id: 3, sucursal_id: 1, vendedor_id: 1 },
    { id: 51, nombre: "Carlos Ruiz", rol_id: 3, sucursal_id: 1, vendedor_id: 2 },
    { id: 52, nombre: "Sin ligar", rol_id: 3, sucursal_id: 1 },
    { id: 60, nombre: "Gerente", rol_id: rolGerente.id, sucursal_id: 1 },
    { id: 61, nombre: "Gerente con cierre", rol_id: rolCierre.id, sucursal_id: 1 },
    { id: 62, nombre: "Global", rol_id: rolGlobal.id, sucursal_id: 1 },
    { id: 63, nombre: "Administradora", rol_id: rolSoloCierre.id, sucursal_id: 1 },
  ];
  sembrarCuentas(app, cuentas);
  [admin, vendedor, companero, sinLigar, gerente, gerenteCierre, global, soloCierre] = cuentas.map(firmarToken);
  await new Promise((listo) => { servidor = app.listen(0, listo); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});

beforeEach(() => {
  for (const coleccion of ["objetivos", "objetivo_capturas", "objetivo_cierres", "objetivo_plantilla"]) app.DB.pos[coleccion] = [];
  // Fixtures con el motor real; cada prueba empieza con dos tiendas con datos.
  for (const [sucursal_id, vendedores] of [[1, [1, 2]], [2, [3]]]) {
    fijarObjetivo(app.DB, { mes: MES, sucursal_id, vendedor_id: null, tipo: "venta", monto: 1000 }, { nombre: "Victor" });
    for (const vendedor_id of vendedores) {
      registrarEnPlantilla(app.DB, { mes: MES, sucursal_id, vendedor_id });
      fijarObjetivo(app.DB, { mes: MES, sucursal_id, vendedor_id, tipo: "venta", monto: 400 }, { nombre: "Victor" });
      capturarDia(app.DB, { ...CAPTURA, sucursal_id, vendedor_id }, { nombre: "Fixture" });
    }
  }
});

after(async () => {
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
    assert.ok(r.cuerpo && typeof r.cuerpo.error === "string", "debe responder el rechazo JSON de la ruta, no un 404 de ruta inexistente");
    assert.match(r.cuerpo.error, /no encontrad/i);
  }
}

function sellarFixture(sucursal_id = 1) {
  return cerrarMes(app.DB, { mes: MES, sucursal_id, reales: (sucursal_id === 1 ? [1, 2] : [3]).map((vendedor_id) => ({ vendedor_id, real_sicar: 100 })) }, { nombre: "Fixture" });
}

test("sin sesión, todas las rutas responden 401", async () => {
  const antes = structuredClone(app.DB.pos);
  for (const [metodo, ruta, datos] of RUTAS) estado(await pedir(metodo, ruta, null, datos), 401);
  assert.deepEqual(app.DB.pos, antes);
});

test("un vendedor NO puede fijar metas (le falta editar_objetivos_venta)", async () => {
  const antes = structuredClone(app.DB.pos);
  for (const indice of [1, 2, 3]) {
    const [metodo, ruta, datos] = RUTAS[indice];
    estado(await pedir(metodo, ruta, vendedor, datos), 403);
  }
  assert.deepEqual(app.DB.pos, antes);
  const propia = await pedir("GET", `/api/objetivos/${MES}/1`, vendedor);
  estado(propia, 200);
  assert.deepEqual(propia.cuerpo.lineas, [{ vendedor_id: 1, monto: 400 }]);
  assert.deepEqual(propia.cuerpo.plantilla.map((p) => p.vendedor_id), [1]);
  assert.equal(propia.cuerpo.asignado, undefined, "el total de sus compañeros tampoco se filtra");
  estado(await pedir("GET", `/api/objetivos/${MES}/1`, sinLigar), 404);
});

test("un vendedor solo captura LO SUYO: capturar para otro se rechaza", async () => {
  const antes = structuredClone(app.DB.pos.objetivo_capturas);
  estado(await pedir("POST", "/api/objetivos/captura", vendedor, { ...CAPTURA, vendedor_id: "2" }), 404);
  estado(await pedir("POST", "/api/objetivos/captura", sinLigar, CAPTURA), 404);
  // Aunque el cuerpo mienta, la corrección se autoriza por el registro original.
  estado(await pedir("POST", "/api/objetivos/captura/2/corregir", vendedor, { monto: 1, vendedor_id: "1", sucursal_id: "1" }), 404);
  assert.deepEqual(app.DB.pos.objetivo_capturas, antes);
  const alta = await pedir("POST", "/api/objetivos/captura", vendedor, { ...CAPTURA, capturado_por: "Victor" });
  estado(alta, 200);
  assert.equal(alta.cuerpo.vendedor_id, 1);
  assert.equal(alta.cuerpo.sucursal_id, 1);
  assert.equal(alta.cuerpo.capturado_por, "Ana López");
  const corregida = await pedir("POST", `/api/objetivos/captura/${alta.cuerpo.id}/corregir`, vendedor, { monto: 80, motivo: "Error" });
  estado(corregida, 200);
  assert.equal(corregida.cuerpo.corrige_a, alta.cuerpo.id);
  assert.equal(corregida.cuerpo.vendedor_id, 1);
  assert.equal(corregida.cuerpo.monto, 80);
  assert.equal(app.DB.pos.objetivo_capturas.find((c) => c.id === alta.cuerpo.id).vigente, false);
  const otro = await pedir("POST", "/api/objetivos/captura/2/corregir", companero, { monto: 90 });
  estado(otro, 200);
  assert.equal(otro.cuerpo.vendedor_id, 2);
});

test("un gerente de la sucursal 1 no ve ni cierra la sucursal 2", async () => {
  const cierreAjeno = sellarFixture(2);
  const antes = structuredClone(app.DB.pos);
  for (const sufijo of ["", "/sugerencia", "/previo-cierre"]) estado(await pedir("GET", `/api/objetivos/${MES}/2${sufijo}`, gerenteCierre), 404);
  for (const [ruta, datos] of [
    ["/api/objetivos", { ...META, sucursal_id: "2" }],
    ["/api/objetivos/plantilla", { mes: "2026-07", sucursal_id: "2", vendedor_id: "3" }],
    ["/api/objetivos/captura", { ...CAPTURA, sucursal_id: "2", vendedor_id: "3" }],
    ["/api/objetivos/captura/3/corregir", { monto: 1, sucursal_id: "1" }],
    ["/api/objetivos/cierre", { mes: "2026-07", sucursal_id: "2", reales: [] }],
    [`/api/objetivos/cierre/${cierreAjeno.id}/rectificar`, { ...RECTIFICACION, vendedor_id: "3", sucursal_id: "1" }],
  ]) estado(await pedir("POST", ruta, gerenteCierre, datos), 404);
  assert.deepEqual(app.DB.pos, antes);
  const propio = await pedir("GET", `/api/objetivos/${MES}/1`, gerente);
  estado(propio, 200);
  assert.equal(propio.cuerpo.meta_tienda, 1000);
  assert.equal(propio.cuerpo.asignado, 800);
  assert.equal(propio.cuerpo.sin_asignar, 200);
  assert.equal(propio.cuerpo.plantilla.length, 2);
});

test("solo con ver_todas_las_sucursales se alcanza otra tienda", async () => {
  const meta = await pedir("POST", "/api/objetivos", global, { ...META, sucursal_id: "2", vendedor_id: "3", monto: 600, motivo: "Ajuste de reparto" });
  estado(meta, 200);
  assert.equal(meta.cuerpo.vendedor_id, 3);
  assert.equal(meta.cuerpo.sucursal_id, 2);
  const plantilla = await pedir("POST", "/api/objetivos/plantilla", global, { mes: "2026-07", sucursal_id: "2", vendedor_id: "3" });
  estado(plantilla, 200);
  assert.equal(plantilla.cuerpo.vendedor_id, 3);
  const sugerencia = await pedir("GET", `/api/objetivos/${MES}/2/sugerencia`, global);
  estado(sugerencia, 200);
  assert.deepEqual(sugerencia.cuerpo, [{ vendedor_id: 3, monto: 1000 }]);
  estado(await pedir("POST", "/api/objetivos/captura", global, { ...CAPTURA, sucursal_id: "2", vendedor_id: "3" }), 200);
  estado(await pedir("POST", "/api/objetivos/captura/3/corregir", global, { monto: 70 }), 200);
  const previo = await pedir("GET", `/api/objetivos/${MES}/2/previo-cierre`, global);
  estado(previo, 200);
  assert.deepEqual(previo.cuerpo.map(({ vendedor_id, meta, capturado }) => ({ vendedor_id, meta, capturado })), [{ vendedor_id: 3, meta: 600, capturado: 170 }]);
  // IDs inválidos: no se convierten silenciosamente en una consulta vacía.
  for (const invalido of ["abc", "0", "-1", "1.5", "", null, true, [], {}]) {
    const antes = structuredClone(app.DB.pos);
    for (const ruta of ["/api/objetivos", "/api/objetivos/plantilla", "/api/objetivos/captura"]) {
      estado(await pedir("POST", ruta, global, { ...CAPTURA, sucursal_id: invalido }), 400);
      estado(await pedir("POST", ruta, global, { ...CAPTURA, vendedor_id: invalido === null && ruta === "/api/objetivos" ? "abc" : invalido }), 400);
    }
    estado(await pedir("POST", "/api/objetivos/cierre", global, { ...PERIODO, sucursal_id: invalido, reales: [] }), 400);
    estado(await pedir("POST", "/api/objetivos/cierre", global, { ...PERIODO, reales: [{ vendedor_id: invalido, real_sicar: 1 }] }), 400);
    assert.deepEqual(app.DB.pos, antes);
  }
  for (const id of ["abc", "0", "-1", "1.5"]) {
    for (const sufijo of ["", "/sugerencia", "/previo-cierre"]) estado(await pedir("GET", `/api/objetivos/${MES}/${id}${sufijo}`, global), 400);
    estado(await pedir("POST", `/api/objetivos/captura/${id}/corregir`, global, { monto: 10 }), 400);
    estado(await pedir("POST", `/api/objetivos/cierre/${id}/rectificar`, global, RECTIFICACION), 400);
  }
  const cierre = await pedir("POST", "/api/objetivos/cierre", global, { mes: MES, sucursal_id: "2", reales: [{ vendedor_id: "3", real_sicar: 150 }], cerrado_por: "Intruso" });
  estado(cierre, 200);
  assert.equal(cierre.cuerpo.cerrado_por, "Global");
  assert.ok(cierre.cuerpo.cerrado_en);
  assert.equal(cierre.cuerpo.lineas[0].vendedor_id, 3);
  assert.equal(cierre.cuerpo.lineas[0].diferencia, 20);
  const foto = structuredClone(cierre.cuerpo.foto);
  estado(await pedir("POST", `/api/objetivos/cierre/${cierre.cuerpo.id}/rectificar`, global, { ...RECTIFICACION, vendedor_id: "abc" }), 400);
  const rectificada = await pedir("POST", `/api/objetivos/cierre/${cierre.cuerpo.id}/rectificar`, global, { ...RECTIFICACION, vendedor_id: "3" });
  estado(rectificada, 200);
  assert.equal(rectificada.cuerpo.vendedor_id, 3);
  assert.equal(rectificada.cuerpo.rectificado_por, "Global");
  assert.deepEqual(app.DB.pos.objetivo_cierres[0].foto, foto);
  // Un mes sellado solo admite rectificaciones; se mantiene el motor intacto.
  const antes = structuredClone(app.DB.pos);
  for (const [ruta, datos] of [
    ["/api/objetivos", { ...META, sucursal_id: "2" }],
    ["/api/objetivos/plantilla", { mes: MES, sucursal_id: "2", vendedor_id: "3" }],
    ["/api/objetivos/captura", { ...CAPTURA, sucursal_id: "2", vendedor_id: "3" }],
    ["/api/objetivos/captura/4/corregir", { monto: 5 }],
  ]) {
    const r = await pedir("POST", ruta, global, datos);
    estado(r, 400);
    assert.match(r.cuerpo.error, /cerrado/i);
  }
  assert.deepEqual(app.DB.pos, antes);
});

test("sin cerrar_mes_objetivos no se llega al previo ni al cierre", async () => {
  const permiso = listarPermisos().find((p) => p.clave === "cerrar_mes_objetivos");
  assert.ok(permiso, "falta cerrar_mes_objetivos");
  assert.equal(permiso.modulo, "pos");
  assert.equal(permiso.implementado, true);
  const cierre = sellarFixture();
  const antes = structuredClone(app.DB.pos);
  for (const token of [vendedor, gerente]) {
    estado(await pedir("GET", `/api/objetivos/${MES}/1/previo-cierre`, token), 403);
    estado(await pedir("POST", "/api/objetivos/cierre", token, { ...PERIODO, reales: [] }), 403);
    estado(await pedir("POST", `/api/objetivos/cierre/${cierre.id}/rectificar`, token, RECTIFICACION), 403);
  }
  assert.deepEqual(app.DB.pos, antes);
  estado(await pedir("GET", `/api/objetivos/${MES}/1/previo-cierre`, soloCierre), 200);
  estado(await pedir("POST", "/api/objetivos", soloCierre, META), 403);
  const sellado = await pedir("POST", "/api/objetivos/cierre", soloCierre, { mes: "2026-07", sucursal_id: "1", reales: [] });
  estado(sellado, 200);
  assert.equal(sellado.cuerpo.cerrado_por, "Administradora");
  estado(await pedir("POST", `/api/objetivos/cierre/${cierre.id}/rectificar`, soloCierre, RECTIFICACION), 200);
  estado(await pedir("GET", `/api/objetivos/${MES}/2/previo-cierre`, admin), 200);
});

test("el selector de sucursal del encabezado NO amplía el alcance", async () => {
  const cierreAjeno = sellarFixture(2);
  for (const selector of ["1", "2", "todas"]) {
    const query = `?sucursal_id=${selector}`;
    const antes = structuredClone(app.DB.pos);
    estado(await pedir("GET", `/api/objetivos/${MES}/2${query}`, gerenteCierre), 404);
    estado(await pedir("POST", `/api/objetivos/captura${query}`, vendedor, { ...CAPTURA, sucursal_id: "2", vendedor_id: "3" }), 404);
    estado(await pedir("POST", `/api/objetivos/captura/3/corregir${query}`, gerenteCierre, { monto: 1, sucursal_id: "1" }), 404);
    estado(await pedir("POST", `/api/objetivos/cierre${query}`, gerenteCierre, { mes: "2026-07", sucursal_id: "2", reales: [] }), 404);
    estado(await pedir("POST", `/api/objetivos/cierre/${cierreAjeno.id}/rectificar${query}`, gerenteCierre, { ...RECTIFICACION, vendedor_id: "3", sucursal_id: "1" }), 404);
    assert.deepEqual(app.DB.pos, antes);
    const propios = await pedir("GET", `/api/objetivos/${MES}/1${query}`, gerenteCierre);
    estado(propios, 200);
    assert.deepEqual(propios.cuerpo.lineas.map((l) => l.vendedor_id), [1, 2]);
    estado(await pedir("POST", `/api/objetivos/captura${query}`, vendedor, CAPTURA), 200);
    const ajenos = await pedir("GET", `/api/objetivos/${MES}/2${query}`, global);
    estado(ajenos, 200);
    assert.deepEqual(ajenos.cuerpo.lineas, [{ vendedor_id: 3, monto: 400 }]);
  }
});

test("un vendedor lee sus capturas y no obtiene las de otro ni con el selector", async () => {
  const antes = structuredClone(app.DB.pos);
  const propia = await pedir("GET", `/api/objetivos/${MES}/1/capturas/1`, vendedor);
  estado(propia, 200);
  assert.deepEqual(propia.cuerpo.capturas.map((c) => c.vendedor_id), [1]);
  assert.equal(propia.cuerpo.total_capturado, 100);
  for (const selector of ["1", "2", "todas"]) {
    const ajena = await pedir("GET", `/api/objetivos/${MES}/1/capturas/2?sucursal_id=${selector}`, vendedor);
    estado(ajena, 404);
    assert.equal(ajena.cuerpo.capturas, undefined);
    estado(await pedir("GET", `/api/objetivos/${MES}/2/capturas/3?sucursal_id=${selector}`, vendedor), 404);
  }
  estado(await pedir("GET", `/api/objetivos/${MES}/1/capturas/1`, sinLigar), 404);
  assert.deepEqual(app.DB.pos, antes);
});

test("las capturas incluyen las corregidas, se ordenan por fecha y solo suman las vigentes", async () => {
  estado(await pedir("POST", "/api/objetivos/captura", vendedor, { ...CAPTURA, fecha: "2026-08-03", monto: 50 }), 200);
  estado(await pedir("POST", "/api/objetivos/captura/1/corregir", vendedor, { monto: 80, motivo: "Error de captura" }), 200);
  estado(await pedir("POST", "/api/objetivos/captura", vendedor, { ...CAPTURA, fecha: "2026-08-02", monto: 0 }), 200);
  capturarDia(app.DB, { ...CAPTURA, mes: "2026-07", fecha: "2026-07-01", sucursal_id: 1, vendedor_id: 1, monto: 999 }, { nombre: "Fixture" });
  const antes = structuredClone(app.DB.pos);
  const r = await pedir("GET", `/api/objetivos/${MES}/1/capturas/1`, vendedor);
  estado(r, 200);
  assert.deepEqual(r.cuerpo.capturas.map(({ fecha, monto, vigente, corrige_a }) => ({ fecha, monto, vigente, corrige_a })), [
    { fecha: "2026-08-01", monto: 100, vigente: false, corrige_a: null },
    { fecha: "2026-08-01", monto: 80, vigente: true, corrige_a: 1 },
    { fecha: "2026-08-02", monto: 0, vigente: true, corrige_a: null },
    { fecha: "2026-08-03", monto: 50, vigente: true, corrige_a: null },
  ]);
  assert.equal(r.cuerpo.total_capturado, 130);
  assert.deepEqual(r.cuerpo.dias_sin_capturar, Array.from({ length: 28 }, (_, i) => `2026-08-${String(i + 4).padStart(2, "0")}`));
  assert.deepEqual(app.DB.pos, antes);
});

test("los días pendientes llegan hasta hoy en Chiapas y no existen en meses futuros", async (t) => {
  // En UTC ya es día 15; en Chiapas aún es el 14.
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-15T02:00:00Z") });
  const token = firmarToken(app.DB.admin.usuarios.find((u) => u.id === 50));
  const actual = await pedir("GET", "/api/objetivos/2026-09/1/capturas/1", token);
  estado(actual, 200);
  assert.deepEqual(actual.cuerpo.capturas, []);
  assert.equal(actual.cuerpo.total_capturado, 0);
  assert.deepEqual(actual.cuerpo.dias_sin_capturar, Array.from({ length: 14 }, (_, i) => `2026-09-${String(i + 1).padStart(2, "0")}`));
  const futuro = await pedir("GET", "/api/objetivos/2026-10/1/capturas/1", token);
  estado(futuro, 200);
  assert.deepEqual(futuro.cuerpo.dias_sin_capturar, []);
});

test("el gerente lee capturas de su equipo; solo el permiso global permite otra tienda", async () => {
  for (const id of [1, 2]) {
    const r = await pedir("GET", `/api/objetivos/${MES}/1/capturas/${id}`, gerente);
    estado(r, 200);
    assert.deepEqual(r.cuerpo.capturas.map((c) => c.vendedor_id), [id]);
  }
  estado(await pedir("GET", `/api/objetivos/${MES}/2/capturas/3`, gerente), 404);
  const ajena = await pedir("GET", `/api/objetivos/${MES}/2/capturas/3`, global);
  estado(ajena, 200);
  assert.deepEqual(ajena.cuerpo.capturas.map((c) => c.vendedor_id), [3]);
});

test("el gerente no lee historial ni cierre de otra sucursal aunque cambie el selector", async () => {
  sellarFixture(2);
  const antes = structuredClone(app.DB.pos);
  for (const sufijo of ["historial/3", "historial/tienda", "cierre"]) {
    for (const selector of ["1", "2", "todas"]) {
      estado(await pedir("GET", `/api/objetivos/${MES}/2/${sufijo}?sucursal_id=${selector}`, gerenteCierre), 404);
    }
    const r = await pedir("GET", `/api/objetivos/${MES}/2/${sufijo}`, global);
    estado(r, 200);
    if (sufijo === "cierre") assert.equal(r.cuerpo.sucursal_id, 2);
    else assert.deepEqual(r.cuerpo.map((o) => o.sucursal_id), [2]);
  }
  assert.deepEqual(app.DB.pos, antes);
});

test("historial/tienda usa vendedor nulo y el historial personal conserva versiones y motivo", async () => {
  for (const vendedor_id of [null, 1]) {
    fijarObjetivo(app.DB, { ...META, sucursal_id: 1, vendedor_id, monto: 700, motivo: "Ajuste del día 28" }, { nombre: "Gerente" });
    const r = await pedir("GET", `/api/objetivos/${MES}/1/historial/${vendedor_id ?? "tienda"}`, gerente);
    estado(r, 200);
    assert.deepEqual(r.cuerpo.map((o) => o.vendedor_id), [vendedor_id, vendedor_id]);
    assert.deepEqual(r.cuerpo.map((o) => o.version), [1, 2]);
    assert.deepEqual(r.cuerpo.map((o) => o.vigente), [false, true]);
    assert.equal(r.cuerpo[1].reemplaza_a, r.cuerpo[0].id);
    assert.equal(r.cuerpo[1].motivo, "Ajuste del día 28");
    assert.equal(r.cuerpo[1].creado_por, "Gerente");
  }
});

test("el cierre sellado se lee completo con sus rectificaciones sin modificar la foto", async () => {
  const cierre = sellarFixture();
  const foto = structuredClone(cierre.foto);
  estado(await pedir("POST", `/api/objetivos/cierre/${cierre.id}/rectificar`, soloCierre, RECTIFICACION), 200);
  const antes = structuredClone(app.DB.pos);
  const r = await pedir("GET", `/api/objetivos/${MES}/1/cierre`, soloCierre);
  estado(r, 200);
  assert.deepEqual(r.cuerpo, cierre);
  assert.equal(r.cuerpo.cerrado_por, "Fixture");
  assert.ok(r.cuerpo.cerrado_en);
  assert.equal(r.cuerpo.rectificaciones[0].valor_nuevo, 80);
  assert.equal(r.cuerpo.lineas[0].real_sicar, 100);
  assert.deepEqual(r.cuerpo.foto, foto);
  assert.deepEqual(app.DB.pos, antes);
});

test("un mes sin cerrar devuelve 404 con explicación", async () => {
  sellarFixture(2);
  const r = await pedir("GET", `/api/objetivos/${MES}/1/cierre`, soloCierre);
  estado(r, 404);
  assert.match(r.cuerpo.error, /no está cerrado/i);
});

test("las nuevas lecturas exigen sesión y su permiso específico", async () => {
  const rutas = ["capturas/1", "historial/1", "historial/tienda", "cierre"];
  for (const sufijo of rutas) estado(await pedir("GET", `/api/objetivos/${MES}/1/${sufijo}`, null), 401);
  estado(await pedir("GET", `/api/objetivos/${MES}/1/capturas/1`, soloCierre), 403);
  for (const sufijo of ["historial/1", "historial/tienda"]) {
    for (const token of [vendedor, soloCierre]) estado(await pedir("GET", `/api/objetivos/${MES}/1/${sufijo}`, token), 403);
  }
  for (const token of [vendedor, gerente]) estado(await pedir("GET", `/api/objetivos/${MES}/1/cierre`, token), 403);
});

test("las nuevas lecturas rechazan meses e identificadores inválidos", async () => {
  for (const sufijo of ["capturas/1", "historial/1", "cierre"]) {
    estado(await pedir("GET", `/api/objetivos/2026-13/1/${sufijo}`, global), 400);
    for (const id of ["abc", "0", "-1", "1.5"]) {
      estado(await pedir("GET", `/api/objetivos/${MES}/${id}/${sufijo}`, global), 400);
    }
  }
  for (const id of ["abc", "0", "-1", "1.5", "null"]) {
    for (const lectura of ["capturas", "historial"]) estado(await pedir("GET", `/api/objetivos/${MES}/1/${lectura}/${id}`, global), 400);
  }
});

test("cambiar una meta vigente exige motivo de texto y no modifica datos al rechazar", async () => {
  for (const vendedor_id of [null, "1"]) {
    for (const motivo of [undefined, null, "", "   \t\n", 123, true, {}]) {
      const antes = structuredClone(app.DB.pos);
      const r = await pedir("POST", "/api/objetivos", gerente, { ...META, vendedor_id, monto: 700, motivo });
      estado(r, 400);
      assert.match(r.cuerpo.error, /motivo/i);
      assert.deepEqual(app.DB.pos, antes);
    }
    const r = await pedir("POST", "/api/objetivos", gerente, { ...META, vendedor_id, monto: 700, motivo: "Ajuste del reparto" });
    estado(r, 200);
    assert.equal(r.cuerpo.version, 2);
    assert.equal(r.cuerpo.motivo, "Ajuste del reparto");
  }
});

test("fijar una meta por primera vez no exige motivo", async () => {
  for (const vendedor_id of [null, "1"]) {
    const r = await pedir("POST", "/api/objetivos", gerente, { ...META, mes: "2026-09", vendedor_id });
    estado(r, 200);
    assert.equal(r.cuerpo.version, 1);
    assert.equal(r.cuerpo.motivo, null);
  }
});
