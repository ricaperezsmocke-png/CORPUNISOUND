/**
 * radarPedidoMarcadoRutas.test.js — Las dos rutas de "ya lo pedí", con su
 * permiso propio y su alcance.
 *
 * Marcar una fila no mueve dinero ni inventario, pero sí cambia lo que el
 * sistema le recomienda comprar a Victor: quien puede callar una compra
 * pendiente necesita su propio permiso, no uno prestado, y solo puede hacerlo
 * en las tiendas que le corresponden.
 */

const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BASE_DESECHABLE = path.join(os.tmpdir(), `corpunisound-pedido-marcado-${process.pid}.sqlite`);
process.env.DB_PATH = BASE_DESECHABLE;
process.env.JWT_SECRET = "secreto-pedido-marcado";
process.env.NODE_ENV = "test";

const app = require("./server");
const { firmarToken } = require("./auth");

const IDS = { rolGlobal: 961, rolLocal: 962, rolSinPermiso: 963, uGlobal: 961, uLocal: 962, uSinPermiso: 963 };

let servidor;
let base;
let tokenGlobal;
let tokenLocal;
let tokenSinPermiso;

// Permisos vecinos del mismo módulo: así la prueba comprueba el permiso NUEVO
// y no que al rol le falte todo.
const permisosVecinos = ["ver_radar_demanda", "ver_resumen_demanda", "registrar_demanda", "cerrar_demanda"];

function agregarSiFalta(lista, item) {
  if (!lista.some((existente) => existente.id === item.id)) lista.push(item);
}

before(async () => {
  agregarSiFalta(app.DB.admin.roles, {
    id: IDS.rolGlobal, nombre: "Compras todas",
    permisos: [...permisosVecinos, "marcar_pedido_proveedor", "ver_todas_las_sucursales"],
    modulos: ["radar_demanda"],
  });
  agregarSiFalta(app.DB.admin.roles, {
    id: IDS.rolLocal, nombre: "Compras una tienda",
    permisos: [...permisosVecinos, "marcar_pedido_proveedor"], modulos: ["radar_demanda"],
  });
  agregarSiFalta(app.DB.admin.roles, {
    id: IDS.rolSinPermiso, nombre: "Radar sin marcar",
    permisos: permisosVecinos, modulos: ["radar_demanda"],
  });
  agregarSiFalta(app.DB.admin.usuarios, {
    id: IDS.uGlobal, nombre: "Victor prueba", usuario: "pedido.global",
    rol_id: IDS.rolGlobal, sucursal_id: 1, vendedor_id: null, activo: true,
  });
  agregarSiFalta(app.DB.admin.usuarios, {
    id: IDS.uLocal, nombre: "Encargada Ocosingo", usuario: "pedido.local",
    rol_id: IDS.rolLocal, sucursal_id: 1, vendedor_id: null, activo: true,
  });
  agregarSiFalta(app.DB.admin.usuarios, {
    id: IDS.uSinPermiso, nombre: "Vendedora", usuario: "pedido.sin",
    rol_id: IDS.rolSinPermiso, sucursal_id: 1, vendedor_id: null, activo: true,
  });

  tokenGlobal = firmarToken({ id: IDS.uGlobal, nombre: "Victor prueba", rol_id: IDS.rolGlobal, sucursal_id: 1 });
  tokenLocal = firmarToken({ id: IDS.uLocal, nombre: "Encargada Ocosingo", rol_id: IDS.rolLocal, sucursal_id: 1 });
  tokenSinPermiso = firmarToken({ id: IDS.uSinPermiso, nombre: "Vendedora", rol_id: IDS.rolSinPermiso, sucursal_id: 1 });

  await new Promise((resolve) => { servidor = app.listen(0, resolve); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});

beforeEach(() => {
  app.DB.radar_demanda.pedidos_marcados = [];
});

after(async () => {
  if (servidor) await new Promise((resolve) => servidor.close(resolve));
  for (const sufijo of ["", "-wal", "-shm"]) {
    try { fs.unlinkSync(BASE_DESECHABLE + sufijo); } catch { /* no existe */ }
  }
});

async function pedir(ruta, { token, method = "GET", body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const respuesta = await fetch(base + ruta, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: respuesta.status, cuerpo: await respuesta.json() };
}

const RUTA = "/api/radar-demanda/pedidos-marcados";
const unProducto = () => Number(app.DB["catalogo-productos"].productos[0].id);

test("marcar exige sesión", async () => {
  assert.equal((await pedir(RUTA, { method: "POST", body: {} })).status, 401);
});

test("marcar exige SU permiso, no basta con los vecinos del módulo", async () => {
  const r = await pedir(RUTA, {
    token: tokenSinPermiso, method: "POST",
    body: { producto_id: unProducto(), sucursal_id: 1 },
  });
  assert.equal(r.status, 403);
});

test("con el permiso se marca, y queda quién lo hizo", async () => {
  const r = await pedir(RUTA, {
    token: tokenGlobal, method: "POST", body: { producto_id: unProducto(), sucursal_id: 1 },
  });
  assert.equal(r.status, 200);
  assert.equal(r.cuerpo.marcado_por, "Victor prueba");
  assert.equal(r.cuerpo.producto_id, unProducto());
  assert.ok(r.cuerpo.vence > r.cuerpo.fecha_marca, "el silencio tiene fecha de caducidad");
});

test("una encargada no puede marcar en una tienda que no es la suya", async () => {
  const r = await pedir(RUTA, {
    token: tokenLocal, method: "POST", body: { producto_id: unProducto(), sucursal_id: 2 },
  });
  assert.equal(r.status, 404);
  assert.equal(app.DB.radar_demanda.pedidos_marcados.length, 0, "no quedó nada escrito");
});

test("quitar la marca también exige el permiso y respeta la tienda", async () => {
  await pedir(RUTA, { token: tokenGlobal, method: "POST", body: { producto_id: unProducto(), sucursal_id: 2 } });
  const ajena = await pedir(`${RUTA}?producto_id=${unProducto()}&sucursal_id=2`, {
    token: tokenLocal, method: "DELETE",
  });
  assert.equal(ajena.status, 404);
  assert.equal(app.DB.radar_demanda.pedidos_marcados.length, 1, "la marca de Palenque sigue ahí");

  const propia = await pedir(`${RUTA}?producto_id=${unProducto()}&sucursal_id=2`, {
    token: tokenGlobal, method: "DELETE",
  });
  assert.equal(propia.status, 200);
  assert.equal(app.DB.radar_demanda.pedidos_marcados.length, 0);
});

test("un producto inventado se rechaza sin escribir nada", async () => {
  const r = await pedir(RUTA, {
    token: tokenGlobal, method: "POST", body: { producto_id: 999999, sucursal_id: 1 },
  });
  assert.equal(r.status, 400);
  assert.equal(app.DB.radar_demanda.pedidos_marcados.length, 0);
});

test("la lista de marcas se consulta con el permiso de ver el resumen", async () => {
  await pedir(RUTA, { token: tokenGlobal, method: "POST", body: { producto_id: unProducto(), sucursal_id: 1 } });
  const r = await pedir(RUTA, { token: tokenSinPermiso });
  assert.equal(r.status, 200, "verlas no requiere poder marcarlas");
  assert.equal(r.cuerpo.length, 1);
});
