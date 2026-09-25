/** Avance por HTTP real: cifras propias, porcentajes de tienda y alcance. */
const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

// Antes de cargar el servidor: jamás usar la base del worktree.
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "avance-rutas-")), "datos.sqlite");
process.env.JWT_SECRET = process.env.JWT_SECRET || "secreto-de-pruebas";
const app = require("./server");
const { sembrarCuentas } = require("./testHelpers");
const { firmarToken } = require("./auth");
const { crearRol } = require("./roles");
const { fijarObjetivo, registrarEnPlantilla } = require("./objetivos");
const { altaElemento } = require("./objetivosCatalogos");
const { capturarDia } = require("./objetivosCaptura");

const MES = "2026-08";
const RAIZ = `/api/objetivos/${MES}/1/avance`;
let servidor, base, vendedora, ajena, sinLigar, gerente, gerenteAjeno, global, globalSinEditar, trasladado, soloEditar;

before(async () => {
  const rol = (nombre, permisos) => crearRol(app.DB, { nombre, modulos: ["pos"], permisos }).id;
  const jefatura = rol("Jefatura avance", ["usar_gerente_ventas", "editar_objetivos_venta"]);
  const usoGlobal = rol("Lectura global avance", ["usar_gerente_ventas", "ver_todas_las_sucursales"]);
  const editar = rol("Solo editar avance", ["editar_objetivos_venta"]);
  const cuentas = [
    { id: 50, nombre: "Ana López", rol_id: 3, sucursal_id: "1", vendedor_id: "1" },
    { id: 51, nombre: "Vendedora ajena", rol_id: 3, sucursal_id: 2, vendedor_id: 3 },
    { id: 52, nombre: "Sin ligar", rol_id: 3, sucursal_id: 1 },
    { id: 60, nombre: "Gerente", rol_id: jefatura, sucursal_id: 1 },
    { id: 61, nombre: "Gerente ajeno", rol_id: jefatura, sucursal_id: 2 },
    { id: 1, nombre: "Victor", rol_id: 1, sucursal_id: 1 },
    { id: 65, nombre: "Global sin editar", rol_id: usoGlobal, sucursal_id: 1, vendedor_id: 1 },
    { id: 66, nombre: "Gerente trasladado", rol_id: jefatura, sucursal_id: 2, vendedor_id: 1 },
    { id: 67, nombre: "Solo editar", rol_id: editar, sucursal_id: 1 },
  ];
  sembrarCuentas(app, cuentas);
  [vendedora, ajena, sinLigar, gerente, gerenteAjeno, global, globalSinEditar, trasladado, soloEditar] = cuentas.map(firmarToken);
  await new Promise((listo) => { servidor = app.listen(0, listo); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});

beforeEach(() => {
  for (const coleccion of [
    "objetivos", "objetivo_plantilla", "objetivo_capturas", "objetivo_cierres", "objetivo_actividades",
    "objetivo_marcas", "objetivo_productos", "objetivo_creditos",
  ]) app.DB.pos[coleccion] = [];
  altaElemento(app.DB, "marcas", { nombre: "Córdoba" }, { nombre: "Fixture" });
  altaElemento(app.DB, "productos", { nombre: "Guitarrón" }, { nombre: "Fixture" });
  for (const [sucursal_id, personas] of [[1, [1, 2]], [2, [3]]]) {
    const periodo = { mes: MES, sucursal_id };
    fijarObjetivo(app.DB, { ...periodo, vendedor_id: null, tipo: "venta", monto: 10000 }, { nombre: "Fixture" });
    for (const vendedor_id of personas) {
      registrarEnPlantilla(app.DB, { ...periodo, vendedor_id });
      fijarObjetivo(app.DB, { ...periodo, vendedor_id, tipo: "venta", monto: 4000 }, { nombre: "Fixture" });
      capturarDia(app.DB, {
        ...periodo, vendedor_id, tipo: "venta", fecha: `${MES}-01`, monto: vendedor_id === 1 ? 1200.25 : 2345.67,
      }, { nombre: "Fixture" });
    }
  }
  for (const referencia of [
    { tipo: "marca", marca_id: 1 }, { tipo: "producto", producto_meta_id: 1 },
    { tipo: "credito", financiera: "atrato" }, { tipo: "actividad", actividad: "grupos" },
  ]) {
    for (const [vendedor_id, monto] of [[null, 20], [1, 8], [2, 12]]) {
      fijarObjetivo(app.DB, { mes: MES, sucursal_id: 1, vendedor_id, ...referencia, monto }, { nombre: "Fixture" });
    }
  }
});

after(async () => {
  if (servidor) await new Promise((listo) => servidor.close(listo));
});

async function pedir(token, ruta = RAIZ) {
  const r = await fetch(base + ruta, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const crudo = await r.text();
  let cuerpo = null;
  try { cuerpo = JSON.parse(crudo); } catch {}
  return { status: r.status, cuerpo, crudo };
}

function estado(r, esperado) {
  assert.equal(r.status, esperado, r.crudo);
  assert.ok(r.cuerpo, "la respuesta debe ser JSON de la ruta");
  if (esperado >= 400) assert.equal(typeof r.cuerpo.error, "string");
  if (esperado === 404) assert.match(r.cuerpo.error, /no encontrad/i);
}

function sinCifras(valor) {
  if (valor === null || typeof valor !== "object") return;
  for (const [clave, contenido] of Object.entries(valor)) {
    assert.ok(!["meta", "capturado", "registrados", "declaradas", "serie", "vendedor_id"].includes(clave), clave);
    if (clave === "porcentaje" || clave === "venta") assert.ok(contenido === null || Number.isInteger(contenido));
    sinCifras(contenido);
  }
}

function soloPropio(r) {
  estado(r, 200);
  assert.deepEqual(Object.keys(r.cuerpo).sort(), ["propio", "tienda_porcentajes"]);
  assert.deepEqual(r.cuerpo.propio.venta, { meta: 4000, capturado: 1200.25, porcentaje: 30 });
  assert.deepEqual(r.cuerpo.propio.serie, [{ fecha: `${MES}-01`, monto: 1200.25 }]);
  assert.equal(r.cuerpo.tienda_porcentajes.venta, 35);
  assert.equal(r.cuerpo.tienda_porcentajes.marcas[0].nombre, "Córdoba");
  assert.equal(r.cuerpo.tienda_porcentajes.productos[0].nombre, "Guitarrón");
  for (const grupo of ["marcas", "productos", "creditos", "actividades"]) {
    assert.equal(r.cuerpo.tienda_porcentajes[grupo][0].porcentaje, 0);
  }
  sinCifras(r.cuerpo.tienda_porcentajes);
  for (const monto of ["2345.67", "3545.92", "10000"]) assert.ok(!r.crudo.includes(monto), `filtración de ${monto}`);
}

test("vendedora con IDs texto recibe solo cifras propias y porcentajes enteros de su tienda", async () => {
  const antes = structuredClone(app.DB.pos);
  soloPropio(await pedir(vendedora));
  assert.deepEqual(app.DB.pos, antes);
});

test("gerente con alcance recibe tienda y personas; sin vínculo propio devuelve null", async () => {
  const antes = structuredClone(app.DB.pos);
  const r = await pedir(gerente);
  estado(r, 200);
  assert.equal(r.cuerpo.propio, null);
  assert.deepEqual(r.cuerpo.tienda.venta, { meta: 10000, capturado: 3545.92, porcentaje: 35 });
  assert.deepEqual(r.cuerpo.tienda.serie, [{ fecha: `${MES}-01`, monto: 3545.92 }]);
  assert.deepEqual(r.cuerpo.por_persona.map((p) => [p.vendedor_id, p.venta.capturado]), [[1, 1200.25], [2, 2345.67]]);
  assert.ok(r.cuerpo.por_persona.every((p) => !Object.hasOwn(p, "serie")));
  sinCifras(r.cuerpo.tienda_porcentajes);
  assert.deepEqual(app.DB.pos, antes);
});

test("gerente y vendedora ajenos reciben 404 JSON, sin que el selector conceda alcance", async () => {
  for (const token of [gerenteAjeno, ajena, sinLigar]) {
    for (const selector of ["1", "2", "todas"]) estado(await pedir(token, `${RAIZ}?sucursal_id=${selector}`), 404);
  }
});

test("selector de otra tienda no cambia la respuesta de vendedora ni gerente", async () => {
  for (const token of [vendedora, gerente]) {
    const original = await pedir(token);
    estado(original, 200);
    const filtrada = await pedir(token, `${RAIZ}?sucursal_id=2`);
    estado(filtrada, 200);
    assert.deepEqual(filtrada.cuerpo, original.cuerpo);
  }
});

test("alcance global sin editar y editar sin alcance normal nunca revelan cifras de tienda", async () => {
  for (const token of [globalSinEditar, trasladado]) soloPropio(await pedir(token));
  app.DB.pos.objetivo_plantilla = app.DB.pos.objetivo_plantilla.filter((p) => p.vendedor_id !== 1);
  estado(await pedir(trasladado), 404);
});

test("jefatura global lee otra tienda, pero su propio es null si no estuvo en esa plantilla", async () => {
  const r = await pedir(global, `/api/objetivos/${MES}/2/avance?sucursal_id=1`);
  estado(r, 200);
  assert.equal(r.cuerpo.propio, null);
  assert.deepEqual(r.cuerpo.tienda.venta, { meta: 10000, capturado: 2345.67, porcentaje: 23 });
  assert.deepEqual(r.cuerpo.por_persona.map((p) => p.vendedor_id), [3]);
  const ligado = await pedir(globalSinEditar, `/api/objetivos/${MES}/2/avance`);
  estado(ligado, 200);
  assert.equal(ligado.cuerpo.propio, null);
  assert.deepEqual(Object.keys(ligado.cuerpo).sort(), ["propio", "tienda_porcentajes"]);
});

test("persona ligada sin plantilla en su tienda recibe propio null", async () => {
  app.DB.pos.objetivo_plantilla = app.DB.pos.objetivo_plantilla.filter((p) => p.vendedor_id !== 1);
  const r = await pedir(vendedora);
  estado(r, 200);
  assert.equal(r.cuerpo.propio, null);
  assert.deepEqual(Object.keys(r.cuerpo).sort(), ["propio", "tienda_porcentajes"]);
});

test("jefatura ligada con alcance normal recibe también su avance propio", async () => {
  app.DB.admin.usuarios.find((u) => u.id === 60).vendedor_id = "1";
  try {
    const r = await pedir(gerente);
    estado(r, 200);
    assert.equal(r.cuerpo.propio.venta.capturado, 1200.25);
    assert.equal(r.cuerpo.tienda.venta.capturado, 3545.92);
    assert.equal(r.cuerpo.por_persona.length, 2);
  } finally {
    delete app.DB.admin.usuarios.find((u) => u.id === 60).vendedor_id;
  }
});

test("avance exige sesión y usar_gerente_ventas aunque se tenga editar_objetivos_venta", async () => {
  estado(await pedir(null), 401);
  estado(await pedir(soloEditar), 403);
});

test("mes e identificadores inválidos responden 400 JSON", async () => {
  for (const mes of ["2026-13", "2026-00", "2026-8", "invalido"]) {
    estado(await pedir(global, `/api/objetivos/${mes}/1/avance`), 400);
  }
  for (const id of ["abc", "0", "-1", "1.5"]) estado(await pedir(global, `/api/objetivos/${MES}/${id}/avance`), 400);
});
