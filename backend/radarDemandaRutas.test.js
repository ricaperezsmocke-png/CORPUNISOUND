const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BASE_DESECHABLE = path.join(os.tmpdir(), `corpunisound-radar-rutas-${process.pid}.sqlite`);
process.env.DB_PATH = BASE_DESECHABLE;
process.env.JWT_SECRET = "secreto-radar-integracion";
process.env.NODE_ENV = "test";

const app = require("./server");
const { firmarToken } = require("./auth");
const { cargar } = require("./persistencia");
const { normalizarRadarDemanda } = require("./radarDemanda");

const IDS = {
  rolCompleto: 901,
  rolRegistro: 902,
  rolSinPermiso: 903,
  usuarioS1: 901,
  usuarioS2: 902,
  usuarioSinPermiso: 903,
};

let servidor;
let base;
let tokenS1;
let tokenS2;
let tokenSinPermiso;
let tokenAdmin;

const permisosCompletos = [
  "ver_radar_demanda", "registrar_demanda", "dar_seguimiento_demanda",
  "cerrar_demanda", "ver_resumen_demanda",
];

function agregarSiFalta(lista, item) {
  if (!lista.some((existente) => existente.id === item.id)) lista.push(item);
}

before(async () => {
  agregarSiFalta(app.DB.admin.roles, {
    id: IDS.rolCompleto, nombre: "Radar completo prueba",
    permisos: permisosCompletos, modulos: ["radar_demanda"],
  });
  agregarSiFalta(app.DB.admin.roles, {
    id: IDS.rolRegistro, nombre: "Radar registro prueba",
    permisos: ["registrar_demanda"], modulos: ["radar_demanda"],
  });
  agregarSiFalta(app.DB.admin.roles, {
    id: IDS.rolSinPermiso, nombre: "Sin Radar prueba", permisos: [], modulos: [],
  });
  agregarSiFalta(app.DB.admin.usuarios, {
    id: IDS.usuarioS1, nombre: "Vendedora S1", usuario: "radar.s1",
    rol_id: IDS.rolCompleto, sucursal_id: 1, vendedor_id: 1, activo: true,
  });
  agregarSiFalta(app.DB.admin.usuarios, {
    id: IDS.usuarioS2, nombre: "Vendedora S2", usuario: "radar.s2",
    rol_id: IDS.rolCompleto, sucursal_id: 2, vendedor_id: 3, activo: true,
  });
  agregarSiFalta(app.DB.admin.usuarios, {
    id: IDS.usuarioSinPermiso, nombre: "Sin Radar", usuario: "sin.radar",
    rol_id: IDS.rolSinPermiso, sucursal_id: 1, vendedor_id: null, activo: true,
  });
  // El Administrador seed es id 1. Se respalda con una cuenta viva para que
  // requiereLogin acepte el token firmado en las pruebas.
  agregarSiFalta(app.DB.admin.usuarios, {
    id: 1, nombre: "Administrador Radar", usuario: "admin.radar",
    rol_id: 1, sucursal_id: 1, vendedor_id: null, activo: true,
  });

  tokenS1 = firmarToken({ id: IDS.usuarioS1, nombre: "Vendedora S1", rol_id: IDS.rolCompleto, sucursal_id: 1 });
  tokenS2 = firmarToken({ id: IDS.usuarioS2, nombre: "Vendedora S2", rol_id: IDS.rolCompleto, sucursal_id: 2 });
  tokenSinPermiso = firmarToken({ id: IDS.usuarioSinPermiso, nombre: "Sin Radar", rol_id: IDS.rolSinPermiso, sucursal_id: 1 });
  tokenAdmin = firmarToken({ id: 1, nombre: "Administrador Radar", rol_id: 1, sucursal_id: 1 });

  await new Promise((resolve) => { servidor = app.listen(0, resolve); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});

beforeEach(() => {
  app.DB.radar_demanda = { registros: [], seguimientos: [], ultimo_id: 0, ultimo_seguimiento_id: 0 };
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
  const cuerpo = await respuesta.json();
  return { status: respuesta.status, cuerpo };
}

function demandaValida(extra = {}) {
  return {
    producto_buscado: "Guitarra barítona",
    cantidad: 1,
    motivo_no_venta: "NO_MANEJAMOS",
    ...extra,
  };
}

async function crearEnSucursal2() {
  return pedir("/api/radar-demanda", { token: tokenS2, method: "POST", body: demandaValida() });
}

test("endpoint de lista requiere login", async () => {
  assert.equal((await pedir("/api/radar-demanda")).status, 401);
});

test("usuario sin permiso recibe 403", async () => {
  assert.equal((await pedir("/api/radar-demanda", { token: tokenSinPermiso })).status, 403);
});

test("crea demanda con usuario limitado en su sucursal", async () => {
  const r = await pedir("/api/radar-demanda", { token: tokenS1, method: "POST", body: demandaValida() });
  assert.equal(r.status, 200);
  assert.equal(r.cuerpo.usuario_id, IDS.usuarioS1);
  assert.equal(r.cuerpo.sucursal_id, 1);
});

test("vendedor se deriva de la cuenta viva", async () => {
  const r = await pedir("/api/radar-demanda", { token: tokenS1, method: "POST", body: demandaValida() });
  assert.equal(r.cuerpo.vendedor_id, 1);
});

test("body.usuario_id no suplanta al usuario autenticado", async () => {
  const r = await pedir("/api/radar-demanda", {
    token: tokenS1, method: "POST", body: demandaValida({ usuario_id: IDS.usuarioS2 }),
  });
  assert.equal(r.status, 200);
  assert.equal(r.cuerpo.usuario_id, IDS.usuarioS1);
});

test("body.vendedor_id no suplanta al vendedor derivado", async () => {
  const r = await pedir("/api/radar-demanda", {
    token: tokenS1, method: "POST", body: demandaValida({ vendedor_id: 999 }),
  });
  assert.equal(r.status, 200);
  assert.equal(r.cuerpo.vendedor_id, 1);
});

test("body.sucursal_id no cambia el alcance de un usuario limitado", async () => {
  const r = await pedir("/api/radar-demanda", {
    token: tokenS1, method: "POST", body: demandaValida({ sucursal_id: 2 }),
  });
  assert.equal(r.status, 200);
  assert.equal(r.cuerpo.sucursal_id, 1);
});

test("administrador con sucursal concreta puede crear", async () => {
  const r = await pedir("/api/radar-demanda?sucursal_id=2", {
    token: tokenAdmin, method: "POST", body: demandaValida(),
  });
  assert.equal(r.status, 200);
  assert.equal(r.cuerpo.sucursal_id, 2);
});

test("administrador en Todas no puede crear sin selección", async () => {
  const r = await pedir("/api/radar-demanda", {
    token: tokenAdmin, method: "POST", body: demandaValida({ sucursal_id: 2 }),
  });
  assert.equal(r.status, 400);
  assert.match(r.cuerpo.error, /^Elige una sucursal/);
});

test("listado respeta sucursal", async () => {
  await pedir("/api/radar-demanda", { token: tokenS1, method: "POST", body: demandaValida({ producto_buscado: "Uno" }) });
  await crearEnSucursal2();
  const r = await pedir("/api/radar-demanda", { token: tokenS1 });
  assert.equal(r.status, 200);
  assert.equal(r.cuerpo.length, 1);
  assert.ok(r.cuerpo.every((d) => d.sucursal_id === 1));
});

test("detalle de otra sucursal responde 404", async () => {
  const creada = await crearEnSucursal2();
  assert.equal((await pedir(`/api/radar-demanda/${creada.cuerpo.id}`, { token: tokenS1 })).status, 404);
});

test("PATCH de otra sucursal responde 404", async () => {
  const creada = await crearEnSucursal2();
  const r = await pedir(`/api/radar-demanda/${creada.cuerpo.id}`, {
    token: tokenS1, method: "PATCH", body: { notas: "No debe entrar" },
  });
  assert.equal(r.status, 404);
});

test("seguimiento de otra sucursal responde 404", async () => {
  const creada = await crearEnSucursal2();
  const r = await pedir(`/api/radar-demanda/${creada.cuerpo.id}/seguimientos`, {
    token: tokenS1, method: "POST", body: { comentario: "No debe entrar" },
  });
  assert.equal(r.status, 404);
});

test("resumen requiere ver_resumen_demanda", async () => {
  const tokenSoloRegistro = firmarToken({ id: IDS.usuarioS1, nombre: "Vendedora S1", rol_id: IDS.rolRegistro, sucursal_id: 1 });
  const rolOriginal = app.DB.admin.usuarios.find((u) => u.id === IDS.usuarioS1).rol_id;
  app.DB.admin.usuarios.find((u) => u.id === IDS.usuarioS1).rol_id = IDS.rolRegistro;
  const r = await pedir("/api/radar-demanda/resumen", { token: tokenSoloRegistro });
  app.DB.admin.usuarios.find((u) => u.id === IDS.usuarioS1).rol_id = rolOriginal;
  assert.equal(r.status, 403);
});

test("historial requiere autenticación", async () => {
  assert.equal((await pedir("/api/radar-demanda/1/historial")).status, 401);
});

test("base antigua sin radar_demanda se normaliza preservando datos", () => {
  const antigua = {};
  normalizarRadarDemanda(antigua);
  assert.deepEqual(antigua.radar_demanda, {
    registros: [], seguimientos: [], ultimo_id: 0, ultimo_seguimiento_id: 0,
  });

  const parcial = { radar_demanda: { registros: [{ id: 7, producto_buscado: "Viejo" }] } };
  normalizarRadarDemanda(parcial);
  assert.equal(parcial.radar_demanda.registros[0].producto_buscado, "Viejo");
  assert.equal(parcial.radar_demanda.registros[0].estado, "REGISTRADA");
  assert.equal(parcial.radar_demanda.ultimo_id, 7);
});

test("persistencia conserva registros después de una mutación HTTP", async () => {
  const creada = await pedir("/api/radar-demanda", { token: tokenS1, method: "POST", body: demandaValida() });
  assert.equal(creada.status, 200);
  const persistido = cargar();
  assert.ok(persistido.radar_demanda.registros.some((d) => d.id === creada.cuerpo.id));
});

test("crear demanda no modifica productos", async () => {
  const antes = JSON.stringify(app.DB["catalogo-productos"].productos);
  await pedir("/api/radar-demanda", { token: tokenS1, method: "POST", body: demandaValida() });
  assert.equal(JSON.stringify(app.DB["catalogo-productos"].productos), antes);
});

test("crear demanda no modifica inventario", async () => {
  const antes = JSON.stringify(app.DB.inventario);
  await pedir("/api/radar-demanda", { token: tokenS1, method: "POST", body: demandaValida() });
  assert.equal(JSON.stringify(app.DB.inventario), antes);
});

test("crear demanda no modifica clientes", async () => {
  const antes = JSON.stringify(app.DB.crm.clientes);
  await pedir("/api/radar-demanda", { token: tokenS1, method: "POST", body: demandaValida({ nombre_contacto: "María" }) });
  assert.equal(JSON.stringify(app.DB.crm.clientes), antes);
});

test("conversión solo guarda referencia y no modifica ventas", async () => {
  const venta = app.DB.pos.ventas.find((v) => v.sucursal_id === 1);
  assert.ok(venta, "el seed debe contener una venta de sucursal 1");
  const ventasAntes = JSON.stringify(app.DB.pos.ventas);
  const creada = await pedir("/api/radar-demanda", { token: tokenS1, method: "POST", body: demandaValida() });
  const convertida = await pedir(`/api/radar-demanda/${creada.cuerpo.id}`, {
    token: tokenS1, method: "PATCH",
    body: { estado: "CONVERTIDA", venta_recuperada_id: venta.id },
  });
  assert.equal(convertida.status, 200);
  assert.equal(convertida.cuerpo.venta_recuperada_id, venta.id);
  assert.equal(JSON.stringify(app.DB.pos.ventas), ventasAntes);
});

