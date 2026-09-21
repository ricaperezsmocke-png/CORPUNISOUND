/**
 * radarAlcanceAutorizado.test.js — El filtro de tienda del encabezado se
 * estaba usando como si fuera el permiso del usuario.
 *
 * EL DEFECTO: `src/api.js` inyecta `sucursal_id` —el selector del encabezado—
 * en TODA petición que no lo traiga. Las rutas del Radar resuelven su alcance
 * con `resolverAlcance(req)`, que lee justamente ese `?sucursal_id=`. Para las
 * LISTAS eso está bien: es un filtro. Para una ruta de registro individual
 * (`/:id`) no, porque ahí decide si tienes derecho a verlo.
 *
 * QUÉ LE CUESTA A VICTOR: él puede ver todas las tiendas, pero si deja el
 * encabezado filtrado en Palenque y abre una demanda de Ocosingo, el sistema
 * le contesta "Demanda no encontrada". No es que no exista: es que el filtro
 * de una lista le está negando algo que sí tiene permiso de ver. Es la regla 5
 * de CLAUDE.md, la que ya ha mordido cuatro veces en este sistema.
 *
 * LA REGLA: en una ruta por `:id`, el alcance sale de QUIEN PREGUNTA —su
 * permiso `ver_todas_las_sucursales` y la `sucursal_id` de su token—, nunca
 * del filtro de la pantalla. El filtro sigue recortando listas, que es para lo
 * que existe.
 *
 * LO QUE NO CAMBIA: un usuario amarrado a su tienda sigue sin poder abrir un
 * registro de otra, ponga lo que ponga en la petición. Esto no amplía el
 * acceso de nadie: se lo devuelve a quien ya lo tenía.
 */

const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BASE_DESECHABLE = path.join(os.tmpdir(), `corpunisound-radar-alcance-${process.pid}.sqlite`);
process.env.DB_PATH = BASE_DESECHABLE;
process.env.JWT_SECRET = "secreto-radar-alcance";
process.env.NODE_ENV = "test";

const app = require("./server");
const { firmarToken } = require("./auth");

const IDS = { rolGlobal: 951, rolLocal: 952, usuarioGlobal: 951, usuarioLocal: 952 };

let servidor;
let base;
let tokenGlobal;
let tokenLocal;

const permisosRadar = [
  "ver_radar_demanda", "registrar_demanda", "dar_seguimiento_demanda",
  "cerrar_demanda", "ver_resumen_demanda",
];

function agregarSiFalta(lista, item) {
  if (!lista.some((existente) => existente.id === item.id)) lista.push(item);
}

before(async () => {
  agregarSiFalta(app.DB.admin.roles, {
    id: IDS.rolGlobal, nombre: "Radar todas las tiendas",
    permisos: [...permisosRadar, "ver_todas_las_sucursales"], modulos: ["radar_demanda"],
  });
  agregarSiFalta(app.DB.admin.roles, {
    id: IDS.rolLocal, nombre: "Radar una tienda",
    permisos: permisosRadar, modulos: ["radar_demanda"],
  });
  agregarSiFalta(app.DB.admin.usuarios, {
    id: IDS.usuarioGlobal, nombre: "Victor prueba", usuario: "radar.global",
    rol_id: IDS.rolGlobal, sucursal_id: 1, vendedor_id: null, activo: true,
  });
  agregarSiFalta(app.DB.admin.usuarios, {
    id: IDS.usuarioLocal, nombre: "Vendedora Ocosingo", usuario: "radar.local",
    rol_id: IDS.rolLocal, sucursal_id: 1, vendedor_id: null, activo: true,
  });

  tokenGlobal = firmarToken({ id: IDS.usuarioGlobal, nombre: "Victor prueba", rol_id: IDS.rolGlobal, sucursal_id: 1 });
  tokenLocal = firmarToken({ id: IDS.usuarioLocal, nombre: "Vendedora Ocosingo", rol_id: IDS.rolLocal, sucursal_id: 1 });

  await new Promise((resolve) => { servidor = app.listen(0, resolve); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});

beforeEach(() => {
  app.DB.radar_demanda = {
    registros: [{
      id: 5001, sucursal_id: 2, usuario_id: IDS.usuarioGlobal, cliente_id: null,
      producto_id: null, producto_buscado: "Guitarra de Palenque", cantidad: 1,
      motivo_no_venta: "NO_MANEJAMOS", estado: "REGISTRADA",
      fecha_registro: new Date().toISOString(), fecha_actualizacion: new Date().toISOString(),
      venta_recuperada_id: null, requiere_seguimiento: false, notas: "",
    }],
    seguimientos: [], ultimo_id: 5001, ultimo_seguimiento_id: 0,
  };
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

test("quien ve todas abre una demanda de otra tienda AUNQUE el encabezado esté filtrado", async () => {
  const sinFiltro = await pedir("/api/radar-demanda/5001", { token: tokenGlobal });
  assert.equal(sinFiltro.status, 200, "sin filtro siempre funcionó");

  const conFiltro = await pedir("/api/radar-demanda/5001?sucursal_id=1", { token: tokenGlobal });
  assert.equal(conFiltro.status, 200, "el filtro de una lista no puede negarle lo que sí puede ver");
  assert.equal(conFiltro.cuerpo.id, 5001);
});

test("el historial de esa demanda tampoco se le esconde por el filtro", async () => {
  const r = await pedir("/api/radar-demanda/5001/historial?sucursal_id=1", { token: tokenGlobal });
  assert.equal(r.status, 200);
});

test("las ventas candidatas de esa demanda tampoco", async () => {
  const r = await pedir("/api/radar-demanda/5001/ventas-candidatas?sucursal_id=1", { token: tokenGlobal });
  assert.equal(r.status, 200);
});

test("puede darle seguimiento con el encabezado en otra tienda", async () => {
  const r = await pedir("/api/radar-demanda/5001/seguimientos?sucursal_id=1", {
    token: tokenGlobal, method: "POST", body: { nota: "Llamada al proveedor" },
  });
  assert.equal(r.status, 200);
});

test("y puede editarla: el filtro no bloquea una escritura autorizada", async () => {
  const r = await pedir("/api/radar-demanda/5001?sucursal_id=1", {
    token: tokenGlobal, method: "PATCH", body: { notas: "Revisado por Victor" },
  });
  assert.equal(r.status, 200);
  assert.equal(r.cuerpo.notas, "Revisado por Victor");
});

test("un usuario amarrado a su tienda SIGUE sin poder abrir la de otra", async () => {
  const r = await pedir("/api/radar-demanda/5001", { token: tokenLocal });
  assert.equal(r.status, 404, "esto no debe cambiar: el arreglo no amplía el acceso de nadie");
});

test("y tampoco pidiendo a mano la sucursal ajena en la petición", async () => {
  const r = await pedir("/api/radar-demanda/5001?sucursal_id=2", { token: tokenLocal });
  assert.equal(r.status, 404, "el filtro nunca puede conceder alcance, solo recortarlo");
});

test("la LISTA sigue respetando el filtro del encabezado: para eso existe", async () => {
  const todas = await pedir("/api/radar-demanda", { token: tokenGlobal });
  assert.ok(todas.cuerpo.some((d) => d.id === 5001), "sin filtro se ve la de Palenque");

  const filtrada = await pedir("/api/radar-demanda?sucursal_id=1", { token: tokenGlobal });
  assert.ok(!filtrada.cuerpo.some((d) => d.id === 5001), "filtrando a Ocosingo ya no aparece");
});
