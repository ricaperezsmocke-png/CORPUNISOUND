/** Rutas HTTP reales: listas, metas, capturas y créditos con alcance individual. */
const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "marcas-rutas-")), "datos.sqlite");
process.env.JWT_SECRET = process.env.JWT_SECRET || "secreto-de-pruebas";
const { guardar } = require("./persistencia");
const plantillaGuardada = [{ id: 99, mes: "2025-01", sucursal_id: 1, vendedor_id: 1, desde: "2025-01-01", hasta: null }];
guardar({ pos: { objetivo_plantilla: plantillaGuardada } });
const app = require("./server");
const alArrancar = {
  plantilla: structuredClone(app.DB.pos.objetivo_plantilla),
  marcas: app.DB.pos.objetivo_marcas, productos: app.DB.pos.objetivo_productos, creditos: app.DB.pos.objetivo_creditos,
};
const { sembrarCuentas } = require("./testHelpers");
const { firmarToken } = require("./auth");
const { crearRol } = require("./roles");
const { fijarObjetivo, registrarEnPlantilla } = require("./objetivos");
const { altaElemento, desactivarElemento } = require("./objetivosCatalogos");
const { capturarDia } = require("./objetivosCaptura");
const { registrarCredito } = require("./objetivosCreditos");
const { cerrarMes } = require("./objetivosCierre");

const MES = "2026-08";
const RAIZ = `/api/objetivos/${MES}/1`;
const DIA = { mes: MES, fecha: `${MES}-01`, sucursal_id: "1", vendedor_id: "1" };
const CREDITO = { ...DIA, financiera: "coppel_pay", folio: " cp-123 ", monto: 100 };
const TIPOS = [
  { tipo: "marca", marca_id: "1" },
  { tipo: "producto", producto_meta_id: "1" },
  { tipo: "credito", financiera: "coppel_pay" },
];
let servidor, base, vendedor, companero, sinLigar, gerente, gerenteAjeno, global, soloCierre;
let soloEditar, globalSinEditar, gerenteTrasladado;

before(async () => {
  const rol = (nombre, permisos) => crearRol(app.DB, { nombre, modulos: ["pos"], permisos }).id;
  const jefatura = rol("Metas marcas", ["usar_gerente_ventas", "editar_objetivos_venta"]);
  const cierre = rol("Cierre marcas", ["cerrar_mes_objetivos"]);
  const editar = rol("Editar marcas", ["editar_objetivos_venta"]);
  const usoGlobal = rol("Uso global marcas", ["usar_gerente_ventas", "ver_todas_las_sucursales"]);
  const cuentas = [
    { id: 50, nombre: "Ana López", rol_id: 3, sucursal_id: 1, vendedor_id: 1 },
    { id: 51, nombre: "Carlos Ruiz", rol_id: 3, sucursal_id: 1, vendedor_id: 2 },
    { id: 52, nombre: "Sin ligar", rol_id: 3, sucursal_id: 1 },
    { id: 60, nombre: "Gerente", rol_id: jefatura, sucursal_id: 1 },
    { id: 61, nombre: "Gerente ajeno", rol_id: jefatura, sucursal_id: 2 },
    { id: 1, nombre: "Victor", rol_id: 1, sucursal_id: 1 },
    { id: 63, nombre: "Administradora", rol_id: cierre, sucursal_id: 1, vendedor_id: 1 },
    { id: 64, nombre: "Solo editar", rol_id: editar, sucursal_id: 1 },
    { id: 65, nombre: "Global sin editar", rol_id: usoGlobal, sucursal_id: 1, vendedor_id: 1 },
    { id: 66, nombre: "Gerente trasladado", rol_id: jefatura, sucursal_id: 2, vendedor_id: 1 },
  ];
  sembrarCuentas(app, cuentas);
  [vendedor, companero, sinLigar, gerente, gerenteAjeno, global, soloCierre,
    soloEditar, globalSinEditar, gerenteTrasladado] = cuentas.map(firmarToken);
  await new Promise((listo) => { servidor = app.listen(0, listo); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});

beforeEach(() => {
  app.DB.pos.vendedores.find((v) => v.id === 1).sucursal_id = 1;
  app.DB.admin.usuarios.find((u) => u.id === 50).sucursal_id = 1;
  for (const coleccion of [
    "objetivos", "objetivo_plantilla", "objetivo_capturas", "objetivo_cierres", "objetivo_actividades",
    "objetivo_marcas", "objetivo_productos", "objetivo_creditos",
  ]) app.DB.pos[coleccion] = [];
  for (const [sucursal_id, personas] of [[1, [1, 2]], [2, [3]]]) {
    fijarObjetivo(app.DB, { mes: MES, sucursal_id, vendedor_id: null, tipo: "venta", monto: 1000 }, { nombre: "Fixture" });
    for (const vendedor_id of personas) registrarEnPlantilla(app.DB, { mes: MES, sucursal_id, vendedor_id });
  }
  for (const nombre of ["Yamaha", "Casio", "Sin meta"]) altaElemento(app.DB, "marcas", { nombre }, { nombre: "Fixture" });
  altaElemento(app.DB, "productos", { nombre: "Teclados" }, { nombre: "Fixture" });
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
  try { cuerpo = await r.json(); } catch {}
  return { status: r.status, cuerpo };
}

function estado(r, esperado) {
  assert.equal(r.status, esperado, JSON.stringify(r));
  if (esperado >= 400) assert.equal(typeof r.cuerpo?.error, "string", "el rechazo debe ser JSON de la ruta");
  if (esperado === 404) assert.match(r.cuerpo.error, /no encontrad/i);
}

function credito(extra = {}, nombre = "Fixture") {
  return registrarCredito(app.DB, { ...CREDITO, ...extra }, { nombre });
}

function captura(extra = {}) {
  return capturarDia(app.DB, { ...DIA, tipo: "venta", monto: 100, ...extra }, { nombre: "Fixture" });
}

function meta(llave, extra = {}) {
  return { mes: MES, sucursal_id: "1", vendedor_id: null, ...llave, monto: 9, ...extra };
}

function sellar() {
  return cerrarMes(app.DB, {
    mes: MES, sucursal_id: 1, reales: [1, 2].map((vendedor_id) => ({ vendedor_id, real_sicar: 100 })),
  }, { nombre: "Fixture" });
}

test("base guardada sin las tres colecciones nuevas conserva plantilla y arranca con listas vacías", () => {
  assert.deepEqual(alArrancar, { plantilla: plantillaGuardada, marcas: [], productos: [], creditos: [] });
});

test("catálogos y financieras responden antes de la ruta dinámica y exigen sus permisos", async () => {
  for (const lista of ["marcas", "productos"]) {
    const ruta = `/api/objetivos/catalogo/${lista}`;
    for (const token of [vendedor, gerente, soloEditar]) {
      const r = await pedir("GET", ruta, token);
      estado(r, 200);
      assert.equal(r.cuerpo[0].nombre, lista === "marcas" ? "Yamaha" : "Teclados");
    }
    estado(await pedir("GET", ruta, null), 401);
    estado(await pedir("GET", ruta, soloCierre), 403);
  }
  const r = await pedir("GET", "/api/objetivos/financieras", vendedor);
  estado(r, 200);
  assert.deepEqual(r.cuerpo, [{ clave: "coppel_pay", etiqueta: "Coppel Pay" }, { clave: "atrato", etiqueta: "Atrato" }]);
  estado(await pedir("GET", "/api/objetivos/financieras", null), 401);
  estado(await pedir("GET", "/api/objetivos/financieras", soloCierre), 403);
});

test("solo editar con alcance global permite alta y desactivación; el selector no concede alcance", async () => {
  const antes = structuredClone(app.DB.pos);
  for (const lista of ["marcas", "productos"]) {
    for (const selector of ["1", "2", "todas"]) {
      for (const [ruta, datos] of [
        [`/api/objetivos/catalogo/${lista}`, { nombre: "Nueva" }],
        [`/api/objetivos/catalogo/${lista}/1/desactivar`, { motivo: "Error" }],
      ]) {
        for (const token of [gerente, soloEditar]) estado(await pedir("POST", `${ruta}?sucursal_id=${selector}`, token, datos), 404);
        for (const token of [vendedor, globalSinEditar]) estado(await pedir("POST", ruta, token, datos), 403);
        estado(await pedir("POST", ruta, null, datos), 401);
      }
    }
  }
  assert.deepEqual(app.DB.pos, antes);
  for (const lista of ["marcas", "productos"]) {
    const ruta = `/api/objetivos/catalogo/${lista}`;
    const alta = await pedir("POST", ruta, global, { nombre: "  Guitarras eléctricas  ", creado_por: "Intruso" });
    estado(alta, 200);
    assert.equal(alta.cuerpo.nombre, "Guitarras eléctricas");
    assert.equal(alta.cuerpo.creado_por, "Victor");
    const baja = await pedir("POST", `${ruta}/${alta.cuerpo.id}/desactivar`, global, { motivo: "  Error  ", desactivado_por: "Intruso" });
    estado(baja, 200);
    assert.equal(baja.cuerpo.activo, false);
    assert.equal(baja.cuerpo.desactivado_por, "Victor");
    assert.equal(baja.cuerpo.motivo_desactivacion, "Error");
  }
});

test("inactivos se ignora sin ambos permisos y las lecturas no modifican las listas", async () => {
  for (const lista of ["marcas", "productos"]) desactivarElemento(app.DB, lista, 1, { motivo: "Error" }, { nombre: "Fixture" });
  const antes = structuredClone(app.DB.pos);
  for (const lista of ["marcas", "productos"]) {
    const ruta = `/api/objetivos/catalogo/${lista}`;
    for (const token of [vendedor, gerente, soloEditar, globalSinEditar, global]) {
      const r = await pedir("GET", `${ruta}?inactivos=1`, token);
      estado(r, 200);
      assert.equal(r.cuerpo.some((item) => item.id === 1), token === global);
    }
    const activos = await pedir("GET", ruta, global);
    estado(activos, 200);
    assert.ok(activos.cuerpo.every((item) => item.activo));
  }
  assert.deepEqual(app.DB.pos, antes);
});

test("catálogo rechaza lista inválida, duplicados y desactivación sin motivo como 400", async () => {
  const antes = structuredClone(app.DB.pos);
  for (const [metodo, ruta, datos] of [
    ["GET", "/api/objetivos/catalogo/otra"],
    ["POST", "/api/objetivos/catalogo/otra", { nombre: "Nueva" }],
    ["POST", "/api/objetivos/catalogo/otra/1/desactivar", { motivo: "Error" }],
    ["POST", "/api/objetivos/catalogo/marcas", { nombre: "YAMAHA" }],
    ["POST", "/api/objetivos/catalogo/marcas/1/desactivar", {}],
    ["POST", "/api/objetivos/catalogo/marcas/abc/desactivar", { motivo: "Error" }],
  ]) estado(await pedir(metodo, ruta, global, datos), 400);
  assert.deepEqual(app.DB.pos, antes);
});

test("metas nuevas: IDs texto, reparto, motivo e historial distinguen cada referencia", async () => {
  for (const llave of [...TIPOS, { tipo: "marca", marca_id: "2" }, { tipo: "credito", financiera: "atrato" }]) {
    const alta = await pedir("POST", "/api/objetivos", gerente, meta(llave));
    estado(alta, 200);
    assert.equal(alta.cuerpo.sucursal_id, 1);
    if (llave.marca_id) assert.equal(alta.cuerpo.marca_id, Number(llave.marca_id));
    if (llave.producto_meta_id) assert.equal(alta.cuerpo.producto_meta_id, 1);
    const antes = structuredClone(app.DB.pos);
    estado(await pedir("POST", "/api/objetivos", gerente, meta(llave, { monto: 12 })), 400);
    assert.deepEqual(app.DB.pos, antes);
    estado(await pedir("POST", "/api/objetivos", gerente, meta(llave, { monto: 12, motivo: "Ajuste" })), 200);
    const query = new URLSearchParams(llave);
    const historial = await pedir("GET", `${RAIZ}/historial/tienda?${query}`, gerente);
    estado(historial, 200);
    assert.deepEqual(historial.cuerpo.map((item) => [item.version, item.monto, item.vigente]), [[1, 9, false], [2, 12, true]]);
    assert.ok(historial.cuerpo.every((item) => item.tipo === llave.tipo));
    const sugerencia = await pedir("GET", `${RAIZ}/sugerencia?${query}`, gerente);
    estado(sugerencia, 200);
    assert.deepEqual(sugerencia.cuerpo, [{ vendedor_id: 1, monto: 6 }, { vendedor_id: 2, monto: 6 }]);
  }
});

test("consultas validan referencias cruzadas y permisos sin usar el selector como alcance", async () => {
  for (const sufijo of ["sugerencia", "historial/tienda"]) {
    for (const query of [
      "tipo=marca", "tipo=marca&marca_id=abc", "tipo=producto&producto_meta_id=0", "tipo=credito&financiera=otra",
      "tipo=venta&marca_id=1", "tipo=marca&marca_id=1&financiera=atrato", "tipo=producto&producto_meta_id=1&actividad=grupos",
    ]) estado(await pedir("GET", `${RAIZ}/${sufijo}?${query}`, gerente), 400);
    for (const selector of ["1", "2", "todas"]) {
      const ruta = `${RAIZ}/${sufijo}?tipo=marca&marca_id=1&sucursal_id=${selector}`;
      estado(await pedir("GET", ruta, gerenteAjeno), 404);
      estado(await pedir("GET", ruta, vendedor), 403);
      estado(await pedir("GET", ruta, gerente), 200);
      estado(await pedir("GET", ruta, global), 200);
    }
  }
});

test("resumen muestra solo elementos con metas vigentes y oculta reparto y totales ajenos", async () => {
  for (const llave of TIPOS) {
    for (const [vendedor_id, monto] of [[null, 9], ["1", 4], ["2", 3]]) {
      estado(await pedir("POST", "/api/objetivos", gerente, meta(llave, { vendedor_id, monto })), 200);
    }
  }
  fijarObjetivo(app.DB, meta({ tipo: "marca", marca_id: "2" }, { vendedor_id: "1", monto: 2 }), { nombre: "Fixture" });
  desactivarElemento(app.DB, "marcas", 1, { motivo: "Fuera de lista" }, { nombre: "Fixture" });
  const caducada = fijarObjetivo(app.DB, meta({ tipo: "marca", marca_id: "3" }), { nombre: "Fixture" });
  caducada.vigente = false;
  const antes = structuredClone(app.DB.pos);
  for (const selector of ["1", "2", "todas"]) {
    const r = await pedir("GET", `${RAIZ}?sucursal_id=${selector}`, gerente);
    estado(r, 200);
    assert.deepEqual(r.cuerpo.marcas.map((item) => item.marca_id), [1, 2]);
    assert.equal(r.cuerpo.marcas[0].nombre, "Yamaha");
    assert.deepEqual(r.cuerpo.productos.map((item) => item.producto_meta_id), [1]);
    assert.deepEqual(r.cuerpo.creditos.map((item) => item.financiera), ["coppel_pay"]);
    for (const grupo of ["marcas", "productos", "creditos"]) {
      const { meta_tienda, asignado, sin_asignar, lineas } = r.cuerpo[grupo][0];
      assert.deepEqual({ meta_tienda, asignado, sin_asignar, lineas }, {
        meta_tienda: 9, asignado: 7, sin_asignar: 2, lineas: [{ vendedor_id: 1, monto: 4 }, { vendedor_id: 2, monto: 3 }],
      });
    }
    for (const token of [vendedor, gerenteTrasladado, globalSinEditar]) {
      const propia = await pedir("GET", `${RAIZ}?sucursal_id=${selector}`, token);
      estado(propia, 200);
      for (const grupo of ["marcas", "productos", "creditos"]) {
        assert.equal(propia.cuerpo[grupo][0].lineas[0].monto, 4);
        for (const item of propia.cuerpo[grupo]) {
          assert.deepEqual(item.lineas.map((linea) => linea.vendedor_id), [1]);
          assert.ok(["meta_tienda", "asignado", "sin_asignar"].every((campo) => !Object.hasOwn(item, campo)));
        }
      }
    }
    estado(await pedir("GET", `${RAIZ}?sucursal_id=${selector}`, gerenteAjeno), 404);
    estado(await pedir("GET", `${RAIZ}?sucursal_id=${selector}`, sinLigar), 404);
  }
  assert.deepEqual(app.DB.pos, antes);
});

test("capturas nuevas se corrigen con identidad original y totalizan solo vigentes por referencia", async () => {
  // Registro viejo de venta, sin campos nuevos.
  captura();
  const marca = await pedir("POST", "/api/objetivos/captura", vendedor, { ...DIA, ...TIPOS[0], monto: 40, capturado_por: "Intruso" });
  estado(marca, 200);
  assert.equal(marca.cuerpo.marca_id, 1);
  assert.equal(marca.cuerpo.capturado_por, "Ana López");
  for (const [llave, monto, fecha] of [
    [{ tipo: "marca", marca_id: "2" }, 10, DIA.fecha], [TIPOS[1], 3, `${MES}-02`],
  ]) estado(await pedir("POST", "/api/objetivos/captura", vendedor, { ...DIA, ...llave, monto, fecha }), 200);
  const correccion = await pedir("POST", `/api/objetivos/captura/${marca.cuerpo.id}/corregir`, vendedor, {
    monto: 30, motivo: "Error", tipo: "producto", marca_id: "2", vendedor_id: "2", sucursal_id: "2", mes: "2026-07",
  });
  estado(correccion, 200);
  assert.equal(correccion.cuerpo.tipo, "marca");
  assert.equal(correccion.cuerpo.marca_id, 1);
  assert.equal(correccion.cuerpo.sucursal_id, 1);
  assert.equal(correccion.cuerpo.vendedor_id, 1);
  captura({ vendedor_id: 2 });
  captura({ vendedor_id: 2, tipo: "marca", marca_id: 1, monto: 99 });
  desactivarElemento(app.DB, "marcas", 1, { motivo: "Fuera de lista" }, { nombre: "Fixture" });
  const r = await pedir("GET", `${RAIZ}/capturas/1`, vendedor);
  estado(r, 200);
  assert.equal(r.cuerpo.total_capturado, 100);
  assert.deepEqual(r.cuerpo.total_por_marca, [{ marca_id: 1, total_capturado: 30 }, { marca_id: 2, total_capturado: 10 }]);
  assert.deepEqual(r.cuerpo.total_por_producto, [{ producto_meta_id: 1, total_capturado: 3 }]);
  assert.equal(r.cuerpo.capturas.length, 5);
  assert.ok(r.cuerpo.capturas.every((item) => item.vendedor_id === 1));
  assert.equal(r.cuerpo.dias_sin_capturar.length, 30);
  assert.equal(r.cuerpo.dias_sin_capturar[0], `${MES}-02`, "producto no cubre la venta pendiente");
  estado(await pedir("GET", `${RAIZ}/capturas/2?sucursal_id=1`, vendedor), 404);
});

test("crédito registra IDs texto y autor del token; anular conserva registro y libera folio", async () => {
  const r = await pedir("POST", "/api/objetivos/credito", vendedor, { ...CREDITO, registrado_por: "Intruso" });
  estado(r, 200);
  assert.equal(r.cuerpo.folio, "CP123");
  assert.equal(r.cuerpo.registrado_por, "Ana López");
  assert.equal(r.cuerpo.vendedor_id, 1);
  assert.equal(r.cuerpo.sucursal_id, 1);
  const anulada = await pedir("POST", `/api/objetivos/credito/${r.cuerpo.id}/anular?sucursal_id=2`, vendedor, {
    motivo: "  Equivocado  ", vendedor_id: "2", sucursal_id: "2", mes: "2026-07", anulado_por: "Intruso",
  });
  estado(anulada, 200);
  assert.equal(anulada.cuerpo.vigente, false);
  assert.equal(anulada.cuerpo.anulado_por, "Ana López");
  assert.equal(anulada.cuerpo.motivo_anulacion, "Equivocado");
  assert.equal(anulada.cuerpo.sucursal_id, 1);
  assert.equal(anulada.cuerpo.mes, MES);
  estado(await pedir("POST", "/api/objetivos/credito", vendedor, CREDITO), 200);
  const lista = await pedir("GET", `${RAIZ}/creditos/1`, vendedor);
  estado(lista, 200);
  assert.deepEqual(lista.cuerpo.registros.map((item) => item.vigente), [false, true]);
  assert.deepEqual(lista.cuerpo.resumen.map((item) => item.registrados), [1, 0]);
});

test("folios duplicados: misma tienda informa autor y fecha, otra tienda no los revela", async () => {
  credito({ vendedor_id: 2 }, "Carlos Ruiz");
  const antes = structuredClone(app.DB.pos);
  const local = await pedir("POST", "/api/objetivos/credito", vendedor, CREDITO);
  estado(local, 400);
  assert.match(local.cuerpo.error, /Carlos Ruiz/);
  assert.match(local.cuerpo.error, /2026-08-01/);
  assert.deepEqual(app.DB.pos, antes);
  credito({ sucursal_id: 2, vendedor_id: 3, folio: "AJENO" }, "Nombre confidencial");
  const otra = await pedir("POST", "/api/objetivos/credito", vendedor, { ...CREDITO, folio: "AJENO" });
  estado(otra, 400);
  assert.equal(otra.cuerpo.error, "ya registrado en otra tienda");
});

test("solo la propia persona registra y anula créditos; cuerpo y selector no suplantan identidad", async () => {
  const ajeno = credito({ vendedor_id: 2 });
  const antes = structuredClone(app.DB.pos);
  for (const selector of ["1", "2", "todas"]) {
    for (const token of [vendedor, sinLigar, gerente, global]) {
      estado(await pedir("POST", `/api/objetivos/credito?sucursal_id=${selector}`, token, { ...CREDITO, vendedor_id: "2" }), 404);
      estado(await pedir("POST", `/api/objetivos/credito/${ajeno.id}/anular?sucursal_id=${selector}`, token, {
        motivo: "Error", vendedor_id: "1", sucursal_id: "1", mes: "2026-07",
      }), 404);
    }
    estado(await pedir("POST", `/api/objetivos/credito?sucursal_id=${selector}`, vendedor, { ...CREDITO, sucursal_id: "2" }), 404);
  }
  assert.deepEqual(app.DB.pos, antes);
  estado(await pedir("POST", `/api/objetivos/credito/${ajeno.id}/anular`, companero, { motivo: "Error" }), 200);
});

test("créditos personales exigen sesión y uso; listas de tienda solo jefatura o cierre con alcance", async () => {
  const propio = credito();
  credito({ vendedor_id: 2, folio: "CP456" });
  credito({ sucursal_id: 2, vendedor_id: 3, folio: "CP789" });
  const antes = structuredClone(app.DB.pos);
  for (const [metodo, ruta, datos] of [
    ["POST", "/api/objetivos/credito", CREDITO],
    ["POST", `/api/objetivos/credito/${propio.id}/anular`, { motivo: "Error" }],
    ["GET", `${RAIZ}/creditos/1`],
  ]) {
    estado(await pedir(metodo, ruta, null, datos), 401);
    estado(await pedir(metodo, ruta, soloCierre, datos), 403);
  }
  estado(await pedir("GET", `${RAIZ}/creditos`, null), 401);
  for (const selector of ["1", "2", "todas"]) {
    const query = `?sucursal_id=${selector}`;
    for (const token of [vendedor, sinLigar, gerenteAjeno, globalSinEditar]) {
      estado(await pedir("GET", `${RAIZ}/creditos${query}`, token), 404);
    }
    for (const token of [vendedor, sinLigar, gerenteAjeno, globalSinEditar]) {
      estado(await pedir("GET", `${RAIZ}/creditos/2${query}`, token), 404);
    }
    for (const token of [gerente, global, soloCierre]) {
      const r = await pedir("GET", `${RAIZ}/creditos${query}`, token);
      estado(r, 200);
      assert.deepEqual(r.cuerpo.registros.map((item) => item.vendedor_id), [1, 2]);
      assert.deepEqual(r.cuerpo.resumen_tienda.map((item) => item.registrados), [2, 0]);
      assert.deepEqual(r.cuerpo.resumen_por_persona.map((item) => item.vendedor_id), [1, 2]);
    }
    const r = await pedir("GET", `${RAIZ}/creditos/1${query}`, vendedor);
    estado(r, 200);
    assert.deepEqual(r.cuerpo.registros, [propio]);
    estado(await pedir("GET", `/api/objetivos/${MES}/2/creditos${query}`, soloCierre), 404);
    estado(await pedir("GET", `/api/objetivos/${MES}/2/creditos${query}`, global), 200);
  }
  assert.deepEqual(app.DB.pos, antes);
});

test("créditos validan IDs, mes, dominio y anulación sin motivo sin mutar nada", async () => {
  const registro = credito();
  const antes = structuredClone(app.DB.pos);
  for (const campo of ["sucursal_id", "vendedor_id"]) {
    for (const valor of [null, true, [], {}, "", "abc", "0", "1.5"]) {
      estado(await pedir("POST", "/api/objetivos/credito", vendedor, { ...CREDITO, [campo]: valor }), 400);
    }
  }
  for (const id of ["abc", "0", "-1", "1.5"]) {
    estado(await pedir("GET", `${RAIZ}/creditos/${id}`, gerente), 400);
    estado(await pedir("GET", `/api/objetivos/${MES}/${id}/creditos`, gerente), 400);
    estado(await pedir("POST", `/api/objetivos/credito/${id}/anular`, vendedor, { motivo: "Error" }), 400);
  }
  for (const sufijo of ["/creditos", "/creditos/1"]) {
    estado(await pedir("GET", `/api/objetivos/2026-13/1${sufijo}`, gerente), 400);
  }
  for (const extra of [{ monto: 0 }, { financiera: "otra" }, { folio: "" }, { fecha: "2099-01-01" }]) {
    estado(await pedir("POST", "/api/objetivos/credito", vendedor, { ...CREDITO, ...extra }), 400);
  }
  estado(await pedir("POST", `/api/objetivos/credito/${registro.id}/anular`, vendedor, {}), 400);
  estado(await pedir("POST", "/api/objetivos/credito/999/anular", vendedor, { motivo: "Error" }), 404);
  assert.deepEqual(app.DB.pos, antes);
});

test("mes cerrado impide metas, capturas, correcciones, créditos y anulaciones incluso con cuerpo falso", async () => {
  const venta = captura();
  const marca = captura({ ...TIPOS[0], monto: 30 });
  const producto = captura({ ...TIPOS[1], monto: 2 });
  const registro = credito();
  sellar();
  const antes = structuredClone(app.DB.pos);
  const rutas = [
    ...TIPOS.map((llave) => ["/api/objetivos", gerente, meta(llave)]),
    ...TIPOS.slice(0, 2).map((llave) => ["/api/objetivos/captura", vendedor, { ...DIA, ...llave, monto: 1 }]),
    ...[venta, marca, producto].map((item) => [`/api/objetivos/captura/${item.id}/corregir`, vendedor, {
      monto: 10, motivo: "Error", mes: "2026-07", sucursal_id: "2",
    }]),
    ["/api/objetivos/credito", vendedor, { ...CREDITO, folio: "NUEVO" }],
    [`/api/objetivos/credito/${registro.id}/anular`, vendedor, { motivo: "Error", mes: "2026-07", sucursal_id: "2" }],
  ];
  for (const [ruta, token, datos] of rutas) {
    const r = await pedir("POST", ruta, token, datos);
    estado(r, 400);
    assert.match(r.cuerpo.error, /cerrado/i);
  }
  assert.deepEqual(app.DB.pos, antes);
});

test("traslado conserva créditos propios históricos y consulta de jefatura sin acceso a compañeros", async () => {
  app.DB.pos.objetivo_plantilla.find((item) => item.vendedor_id === 1).hasta = `${MES}-15`;
  app.DB.pos.vendedores.find((item) => item.id === 1).sucursal_id = 2;
  registrarEnPlantilla(app.DB, { mes: MES, sucursal_id: 2, vendedor_id: 1, desde: `${MES}-16` });
  const cuenta = app.DB.admin.usuarios.find((item) => item.id === 50);
  cuenta.sucursal_id = 2;
  const trasladada = firmarToken(cuenta);
  const r = await pedir("POST", "/api/objetivos/credito?sucursal_id=2", trasladada, CREDITO);
  estado(r, 200);
  estado(await pedir("GET", `${RAIZ}/creditos/1`, trasladada), 200);
  estado(await pedir("GET", `${RAIZ}/creditos/1`, gerente), 200);
  estado(await pedir("GET", `${RAIZ}/creditos/2`, trasladada), 404);
  estado(await pedir("GET", `${RAIZ}/creditos`, gerenteTrasladado), 404);
  estado(await pedir("GET", `/api/objetivos/${MES}/3/creditos/1?sucursal_id=1`, trasladada), 404);
  estado(await pedir("POST", "/api/objetivos/credito", gerente, CREDITO), 404);
  const antes = structuredClone(app.DB.pos);
  estado(await pedir("POST", "/api/objetivos/credito", trasladada, { ...CREDITO, fecha: `${MES}-16`, folio: "OTRO" }), 400);
  assert.deepEqual(app.DB.pos, antes);
  estado(await pedir("POST", `/api/objetivos/credito/${r.cuerpo.id}/anular`, trasladada, { motivo: "Error" }), 200);
});
