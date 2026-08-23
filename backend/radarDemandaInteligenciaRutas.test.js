const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BASE_DESECHABLE = path.join(os.tmpdir(), `corpunisound-radar-inteligencia-rutas-${process.pid}.sqlite`);
process.env.DB_PATH = BASE_DESECHABLE;
process.env.JWT_SECRET = "secreto-radar-inteligencia-rutas";
process.env.NODE_ENV = "test";

const app = require("./server");
const { firmarToken } = require("./auth");

const IDS = {
  rolLimitado: 9601,
  rolLimitadoCostos: 9602,
  rolGlobal: 9603,
  rolGlobalCostos: 9604,
  rolSinPermiso: 9605,
  usuarioLimitado: 9601,
  usuarioLimitadoCostos: 9602,
  usuarioGlobal: 9603,
  usuarioGlobalCostos: 9604,
  usuarioSinPermiso: 9605,
  usuarioSucursal5: 9606,
};

let servidor;
let url;
let tokenLimitado;
let tokenLimitadoCostos;
let tokenGlobal;
let tokenGlobalCostos;
let tokenSinPermiso;
let tokenSucursal5;

function agregarSiFalta(lista, item) {
  if (!lista.some((x) => x.id === item.id)) lista.push(item);
}

before(async () => {
  const roles = [
    { id: IDS.rolLimitado, nombre: "Inteligencia limitada", permisos: ["ver_resumen_demanda"], modulos: ["radar_demanda"] },
    { id: IDS.rolLimitadoCostos, nombre: "Inteligencia limitada costos", permisos: ["ver_resumen_demanda", "ver_reportes"], modulos: ["radar_demanda", "reportes"] },
    { id: IDS.rolGlobal, nombre: "Inteligencia global", permisos: ["ver_resumen_demanda", "ver_todas_las_sucursales"], modulos: ["radar_demanda"] },
    { id: IDS.rolGlobalCostos, nombre: "Inteligencia global costos", permisos: ["ver_resumen_demanda", "ver_todas_las_sucursales", "ver_reportes"], modulos: ["radar_demanda", "reportes"] },
    { id: IDS.rolSinPermiso, nombre: "Sin inteligencia", permisos: [], modulos: [] },
  ];
  roles.forEach((rol) => agregarSiFalta(app.DB.admin.roles, rol));
  const usuarios = [
    { id: IDS.usuarioLimitado, nombre: "Limitado", rol_id: IDS.rolLimitado, sucursal_id: 1 },
    { id: IDS.usuarioLimitadoCostos, nombre: "Limitado costos", rol_id: IDS.rolLimitadoCostos, sucursal_id: 1 },
    { id: IDS.usuarioGlobal, nombre: "Global", rol_id: IDS.rolGlobal, sucursal_id: 1 },
    { id: IDS.usuarioGlobalCostos, nombre: "Global costos", rol_id: IDS.rolGlobalCostos, sucursal_id: 1 },
    { id: IDS.usuarioSinPermiso, nombre: "Sin permiso", rol_id: IDS.rolSinPermiso, sucursal_id: 1 },
    { id: IDS.usuarioSucursal5, nombre: "Sucursal cinco", rol_id: IDS.rolLimitado, sucursal_id: 5 },
  ];
  usuarios.forEach((u) => agregarSiFalta(app.DB.admin.usuarios, { ...u, usuario: `intel.${u.id}`, activo: true, vendedor_id: null }));
  tokenLimitado = firmarToken(usuarios[0]);
  tokenLimitadoCostos = firmarToken(usuarios[1]);
  tokenGlobal = firmarToken(usuarios[2]);
  tokenGlobalCostos = firmarToken(usuarios[3]);
  tokenSinPermiso = firmarToken(usuarios[4]);
  tokenSucursal5 = firmarToken(usuarios[5]);
  await new Promise((resolve) => { servidor = app.listen(0, resolve); });
  url = `http://127.0.0.1:${servidor.address().port}`;
});

after(async () => {
  if (servidor) await new Promise((resolve) => servidor.close(resolve));
  for (const sufijo of ["", "-wal", "-shm"]) {
    try { fs.unlinkSync(BASE_DESECHABLE + sufijo); } catch { /* no existe */ }
  }
});

function existencia(productoId, sucursalId, actual, minima = 5, maxima = 20) {
  return { producto_id: productoId, sucursal_id: sucursalId, cantidad_actual: actual, cantidad_minima: minima, cantidad_maxima: maxima };
}

function demanda(id, productoId, sucursalId, cambios = {}) {
  return {
    id, producto_id: productoId, sucursal_id: sucursalId, cantidad: 1,
    fecha_registro: "2026-08-20T12:00:00.000Z", cliente_id: id,
    telefono_contacto: "555-SECRETO", nombre_contacto: "CLIENTE SECRETO",
    motivo_no_venta: "PRECIO", producto_buscado: "", marca_solicitada: "",
    modelo_solicitado: "", variante_solicitada: "", categoria_solicitada: "",
    ...cambios,
  };
}

function sembrarDemandas(productoId, sucursalId, cantidad = 3, cambios = {}) {
  for (let i = 1; i <= cantidad; i += 1) {
    app.DB.radar_demanda.registros.push(demanda(sucursalId * 1000 + productoId * 10 + i, productoId, sucursalId, { cliente_id: i, ...cambios }));
  }
}

beforeEach(() => {
  app.DB.radar_demanda = { registros: [], seguimientos: [], ultimo_id: 0, ultimo_seguimiento_id: 0 };
  app.DB.inventario.existencias = [];
  app.DB.inventario.compras = [];
  app.DB.inventario.compra_detalle = [];
  app.DB.inventario.traspasos = [];
  app.DB.pos.ventas = [];
  app.DB.pos.venta_detalle = [];
  app.DB["catalogo-productos"].productos.forEach((p) => { p.activo = true; });
});

async function pedir(token, query = "") {
  const respuesta = await fetch(`${url}/api/radar-demanda/inteligencia${query}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return { status: respuesta.status, cuerpo: await respuesta.json() };
}

function prepararCompra(productoId = 1, sucursalId = 1) {
  app.DB.inventario.existencias.push(existencia(productoId, sucursalId, 0));
  sembrarDemandas(productoId, sucursalId);
}

test("requiere autenticación", async () => assert.equal((await pedir()).status, 401));
test("requiere ver_resumen_demanda", async () => assert.equal((await pedir(tokenSinPermiso)).status, 403));

test("usuario limitado recibe sólo su sucursal", async () => {
  prepararCompra(1, 1); prepararCompra(2, 2);
  const r = await pedir(tokenLimitado, "?fecha_fin=2026-08-20");
  assert.deepEqual(r.cuerpo.oportunidades.map((x) => x.sucursal.sucursal_id), [1]);
});

test("usuario global recibe todas las sucursales con demanda", async () => {
  prepararCompra(1, 1); prepararCompra(2, 2);
  const r = await pedir(tokenGlobal, "?fecha_fin=2026-08-20");
  assert.deepEqual(new Set(r.cuerpo.oportunidades.map((x) => x.sucursal.sucursal_id)), new Set([1, 2]));
});

test("usuario global puede seleccionar una sucursal concreta", async () => {
  prepararCompra(1, 1); prepararCompra(2, 2);
  const r = await pedir(tokenGlobal, "?sucursal_id=2&fecha_fin=2026-08-20");
  assert.deepEqual(r.cuerpo.oportunidades.map((x) => x.sucursal.sucursal_id), [2]);
});

test("query manipulada no amplía alcance limitado", async () => {
  prepararCompra(1, 1); prepararCompra(2, 2);
  const r = await pedir(tokenLimitado, "?sucursal_id=2&fecha_fin=2026-08-20");
  assert.deepEqual(r.cuerpo.oportunidades.map((x) => x.sucursal.sucursal_id), [1]);
});

test("acepta fecha_fin válida", async () => {
  prepararCompra();
  const r = await pedir(tokenLimitado, "?fecha_fin=2026-08-20");
  assert.deepEqual([r.status, r.cuerpo.periodo.fecha_fin], [200, "2026-08-20"]);
});

test("fecha_fin inválida responde 400", async () => {
  const r = await pedir(tokenLimitado, "?fecha_fin=2026-02-30");
  assert.equal(r.status, 400);
  assert.match(r.cuerpo.error, /fecha válida/);
});

test("contrato superior es exacto", async () => {
  prepararCompra();
  const r = await pedir(tokenLimitado, "?fecha_fin=2026-08-20");
  assert.deepEqual(Object.keys(r.cuerpo), ["periodo", "resumen", "oportunidades", "productos_no_manejados", "capacidades"]);
});

test("respuesta no contiene score, confidence, prioridad ni cantidad sugerida", async () => {
  prepararCompra();
  const texto = JSON.stringify((await pedir(tokenLimitado, "?fecha_fin=2026-08-20")).cuerpo);
  assert.doesNotMatch(texto, /score|confidence|prioridad|cantidad_sugerida/i);
});

test("devuelve clasificación y razones exactas", async () => {
  prepararCompra();
  const oportunidad = (await pedir(tokenLimitado, "?fecha_fin=2026-08-20")).cuerpo.oportunidades[0];
  assert.deepEqual([oportunidad.clasificacion, oportunidad.razones], ["REVISAR_COMPRA", ["STOCK_LOCAL_CERO", "DEMANDA_REPETIDA_30D"]]);
});

test("devuelve advertencias estructuradas", async () => {
  prepararCompra();
  const oportunidad = (await pedir(tokenLimitado, "?fecha_fin=2026-08-20")).cuerpo.oportunidades[0];
  assert.ok(oportunidad.advertencias.includes("PEDIDOS_PROVEEDOR_NO_DISPONIBLES"));
  assert.ok(oportunidad.advertencias.includes("SIN_HISTORIAL_COMPRAS"));
});

test("ordena REVISAR_TRASPASO antes de REVISAR_COMPRA", async () => {
  prepararCompra(1, 1); prepararCompra(2, 1);
  app.DB.inventario.existencias.push(existencia(1, 2, 10, 2));
  const oportunidades = (await pedir(tokenGlobal, "?fecha_fin=2026-08-20")).cuerpo.oportunidades;
  assert.deepEqual(oportunidades.map((x) => x.clasificacion), ["REVISAR_TRASPASO", "REVISAR_COMPRA"]);
});

test("orden interno pone stock cero antes que bajo mínimo", async () => {
  prepararCompra(1, 1); prepararCompra(2, 1);
  app.DB.inventario.existencias.find((e) => e.producto_id === 1).cantidad_actual = 2;
  const oportunidades = (await pedir(tokenLimitado, "?fecha_fin=2026-08-20")).cuerpo.oportunidades;
  assert.deepEqual(oportunidades.map((x) => x.producto.producto_id), [2, 1]);
});

test("orden interno usa solicitudes, contactos, ventas y fecha sin score", async () => {
  prepararCompra(1, 1); prepararCompra(2, 1);
  sembrarDemandas(1, 1, 1);
  const oportunidades = (await pedir(tokenLimitado, "?fecha_fin=2026-08-20")).cuerpo.oportunidades;
  assert.equal(oportunidades[0].producto.producto_id, 1);
});

test("usuario limitado no recibe otras sucursales", async () => {
  prepararCompra(); app.DB.inventario.existencias.push(existencia(1, 2, 10, 2));
  const oportunidad = (await pedir(tokenLimitado, "?fecha_fin=2026-08-20")).cuerpo.oportunidades[0];
  assert.deepEqual(oportunidad.otras_sucursales, []);
});

test("global recibe únicamente sucursales dentro del filtro de alcance", async () => {
  prepararCompra(1, 1);
  app.DB.inventario.existencias.push(existencia(1, 2, 10), existencia(1, 3, 12));
  const oportunidad = (await pedir(tokenGlobal, "?sucursal_id=1&fecha_fin=2026-08-20")).cuerpo.oportunidades[0];
  assert.deepEqual(oportunidad.otras_sucursales, []);
});

test("productos libres permanecen separados", async () => {
  for (let i = 1; i <= 3; i += 1) app.DB.radar_demanda.registros.push(demanda(i, null, 1, { producto_buscado: "Consola CQ18T", cliente_id: i }));
  const r = await pedir(tokenLimitado, "?fecha_fin=2026-08-20");
  assert.deepEqual([r.cuerpo.oportunidades.length, r.cuerpo.productos_no_manejados.length], [0, 1]);
  assert.equal(r.cuerpo.productos_no_manejados[0].clasificacion, "EVALUAR_INCORPORACION");
});

test("no expone nombres, teléfonos ni comentarios de clientes", async () => {
  prepararCompra();
  app.DB.radar_demanda.seguimientos.push({ id: 1, demanda_id: 1, comentario: "COMENTARIO SECRETO" });
  const texto = JSON.stringify((await pedir(tokenLimitado, "?fecha_fin=2026-08-20")).cuerpo);
  assert.doesNotMatch(texto, /CLIENTE SECRETO|555-SECRETO|COMENTARIO SECRETO/);
});

test("no expone ventas individuales ni formas de pago", async () => {
  prepararCompra();
  app.DB.pos.ventas.push({ id: 987654, fecha: "2026-08-20", sucursal_id: 1, estatus: "cerrada", metodo_pago: "PAGO-SECRETO" });
  app.DB.pos.venta_detalle.push({ id: 1, venta_id: 987654, producto_id: 1, cantidad: 2 });
  const texto = JSON.stringify((await pedir(tokenLimitado, "?fecha_fin=2026-08-20")).cuerpo);
  assert.doesNotMatch(texto, /987654|PAGO-SECRETO/);
});

function prepararCosto() {
  prepararCompra();
  app.DB.inventario.compras.push({ id: 77, proveedor_id: 1, sucursal_id: 1, fecha: "2026-08-10T12:00:00Z" });
  app.DB.inventario.compra_detalle.push({ id: 1, compra_id: 77, producto_id: 1, cantidad: 10, costo: 123.45 });
}

test("oculta costos sin ver_reportes", async () => {
  prepararCosto();
  const compras = (await pedir(tokenLimitado, "?fecha_fin=2026-08-20")).cuerpo.oportunidades[0].compras_historicas;
  assert.equal(Object.hasOwn(compras, "ultimo_costo"), false);
  assert.equal(Object.hasOwn(compras, "costo_promedio_historico_ponderado"), false);
});

test("muestra costos con ver_reportes", async () => {
  prepararCosto();
  const compras = (await pedir(tokenLimitadoCostos, "?fecha_fin=2026-08-20")).cuerpo.oportunidades[0].compras_historicas;
  assert.deepEqual([compras.ultimo_costo, compras.costo_promedio_historico_ponderado], [123.45, 123.45]);
});

test("resumen cuenta exactamente cada clasificación", async () => {
  prepararCompra(1, 1);
  app.DB.inventario.existencias.push(existencia(1, 2, 10, 2));
  prepararCompra(2, 1);
  app.DB.inventario.existencias.push(existencia(3, 1, 10));
  sembrarDemandas(3, 1, 3, { motivo_no_venta: "SIN_EXISTENCIA" });
  sembrarDemandas(4, 1, 3);
  for (let i = 1; i <= 3; i += 1) app.DB.radar_demanda.registros.push(demanda(8000 + i, null, 1, { producto_buscado: "Producto libre", cliente_id: i }));
  const resumen = (await pedir(tokenGlobal, "?fecha_fin=2026-08-20")).cuerpo.resumen;
  assert.deepEqual(resumen, { revisar_traspaso: 1, revisar_compra: 1, observar: 1, evidencia_insuficiente: 1, evaluar_incorporacion: 1 });
});

test("capacidad de pedidos a proveedor permanece falsa", async () => {
  assert.equal((await pedir(tokenLimitado, "?fecha_fin=2026-08-20")).cuerpo.capacidades.pedidos_proveedor_disponibles, false);
});

test("GET mantiene DB inmutable", async () => {
  prepararCosto();
  const antes = structuredClone({ radar: app.DB.radar_demanda, inventario: app.DB.inventario, ventas: app.DB.pos.ventas, detalle: app.DB.pos.venta_detalle });
  await pedir(tokenGlobalCostos, "?fecha_fin=2026-08-20");
  assert.deepStrictEqual({ radar: app.DB.radar_demanda, inventario: app.DB.inventario, ventas: app.DB.pos.ventas, detalle: app.DB.pos.venta_detalle }, antes);
});

test("GET no crea compras", async () => {
  prepararCompra(); const antes = app.DB.inventario.compras.length;
  await pedir(tokenLimitado, "?fecha_fin=2026-08-20");
  assert.equal(app.DB.inventario.compras.length, antes);
});

test("GET no crea traspasos", async () => {
  prepararCompra(); const antes = app.DB.inventario.traspasos.length;
  await pedir(tokenLimitado, "?fecha_fin=2026-08-20");
  assert.equal(app.DB.inventario.traspasos.length, antes);
});

test("GET no modifica inventario", async () => {
  prepararCompra(); const antes = structuredClone(app.DB.inventario.existencias);
  await pedir(tokenLimitado, "?fecha_fin=2026-08-20");
  assert.deepStrictEqual(app.DB.inventario.existencias, antes);
});

test("aislamiento entre cinco sucursales", async () => {
  for (let sucursalId = 1; sucursalId <= 5; sucursalId += 1) prepararCompra(1, sucursalId);
  const r = await pedir(tokenSucursal5, "?sucursal_id=1&fecha_fin=2026-08-20");
  assert.deepEqual(r.cuerpo.oportunidades.map((x) => x.sucursal.sucursal_id), [5]);
  assert.deepEqual(r.cuerpo.oportunidades[0].otras_sucursales, []);
});
