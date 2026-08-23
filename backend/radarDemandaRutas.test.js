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
const {
  normalizarRadarDemanda, MOTIVOS_DEMANDA, ESTADOS_DEMANDA, TRANSICIONES_PERMITIDAS,
} = require("./radarDemanda");

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
  "cerrar_demanda", "ver_resumen_demanda", "crear_cliente",
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

test("intención de compra crea y vincula un interesado del CRM", async () => {
  const telefono = `961${String(Date.now()).slice(-7)}`;
  const r = await pedir("/api/radar-demanda", {
    token: tokenS1,
    method: "POST",
    body: demandaValida({
      intencion_compra: true,
      consentimiento_aviso: true,
      nombre_contacto: "Prospecto Radar",
      telefono_contacto: telefono,
    }),
  });
  assert.equal(r.status, 200);
  const cliente = app.DB.crm.clientes.find((item) => item.id === r.cuerpo.cliente_id);
  assert.equal(cliente.nombre, "Prospecto Radar");
  assert.equal(cliente.celular, telefono);
  assert.equal(cliente.estado, "interesado");
  assert.equal(cliente.sucursal_id, 1);
  assert.equal(r.cuerpo.intencion_compra, true);
});

test("registrar demanda no permite crear prospecto sin crear_cliente", async () => {
  const cuenta = app.DB.admin.usuarios.find((u) => u.id === IDS.usuarioS1);
  const rolOriginal = cuenta.rol_id;
  cuenta.rol_id = IDS.rolRegistro;
  const tokenSoloRegistro = firmarToken({ id: IDS.usuarioS1, nombre: "Vendedora S1", rol_id: IDS.rolRegistro, sucursal_id: 1 });
  const r = await pedir("/api/radar-demanda", {
    token: tokenSoloRegistro,
    method: "POST",
    body: demandaValida({
      intencion_compra: true,
      consentimiento_aviso: true,
      nombre_contacto: "Sin permiso",
      telefono_contacto: "9615556677",
    }),
  });
  cuenta.rol_id = rolOriginal;
  assert.equal(r.status, 403);
  assert.match(r.cuerpo.error, /CRM/);
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

test("meta requiere login", async () => {
  assert.equal((await pedir("/api/radar-demanda/meta")).status, 401);
});

test("meta requiere ver_radar_demanda", async () => {
  assert.equal((await pedir("/api/radar-demanda/meta", { token: tokenSinPermiso })).status, 403);
});

test("meta expone exactamente estados, motivos y transiciones del dominio", async () => {
  const r = await pedir("/api/radar-demanda/meta", { token: tokenS1 });
  assert.equal(r.status, 200);
  assert.deepEqual(r.cuerpo.estados, ESTADOS_DEMANDA);
  assert.deepEqual(r.cuerpo.motivos, MOTIVOS_DEMANDA);
  assert.deepEqual(r.cuerpo.transiciones, TRANSICIONES_PERMITIDAS);
});

test("meta mantiene estados terminales sin transiciones", async () => {
  const r = await pedir("/api/radar-demanda/meta", { token: tokenS1 });
  for (const estado of ["CONVERTIDA", "NO_CONVERTIDA", "CANCELADA"]) {
    assert.deepEqual(r.cuerpo.transiciones[estado], []);
  }
});

test("meta entrega una serialización que no puede mutar las constantes del dominio", async () => {
  const r = await pedir("/api/radar-demanda/meta", { token: tokenS1 });
  r.cuerpo.estados.push("ALTERADO");
  r.cuerpo.motivos[0] = "ALTERADO";
  r.cuerpo.transiciones.REGISTRADA.push("ALTERADO");

  const siguiente = await pedir("/api/radar-demanda/meta", { token: tokenS1 });
  assert.deepEqual(siguiente.cuerpo.estados, ESTADOS_DEMANDA);
  assert.deepEqual(siguiente.cuerpo.motivos, MOTIVOS_DEMANDA);
  assert.deepEqual(siguiente.cuerpo.transiciones, TRANSICIONES_PERMITIDAS);
});

test("detalle enriquece únicamente nombres relacionados", async () => {
  const creada = await pedir("/api/radar-demanda", { token: tokenS1, method: "POST", body: demandaValida() });
  const r = await pedir(`/api/radar-demanda/${creada.cuerpo.id}`, { token: tokenS1 });
  assert.equal(r.status, 200);
  assert.equal(r.cuerpo.usuario_nombre, "Vendedora S1");
  assert.equal(r.cuerpo.vendedor_nombre, app.DB.pos.vendedores.find((v) => v.id === 1).nombre);
  assert.equal(r.cuerpo.sucursal_nombre, app.DB.pos.sucursales.find((s) => s.id === 1).nombre);
  const serializado = JSON.stringify(r.cuerpo);
  for (const secreto of ["password_hash", "token", "permisos", "usuarios"]) {
    assert.equal(serializado.includes(secreto), false);
  }
});

test("detalle maneja vendedor null sin abrir catálogo de usuarios", async () => {
  const creada = await pedir("/api/radar-demanda?sucursal_id=1", { token: tokenAdmin, method: "POST", body: demandaValida() });
  const r = await pedir(`/api/radar-demanda/${creada.cuerpo.id}?sucursal_id=1`, { token: tokenAdmin });
  assert.equal(r.status, 200);
  assert.equal(r.cuerpo.vendedor_nombre, null);
  assert.equal(r.cuerpo.usuario_nombre, "Administrador Radar");
  assert.equal(Object.prototype.hasOwnProperty.call(r.cuerpo, "usuario"), false);
});

test("historial incluye nombre legible del actor sin exponer su cuenta", async () => {
  const creada = await pedir("/api/radar-demanda", { token: tokenS1, method: "POST", body: demandaValida() });
  await pedir(`/api/radar-demanda/${creada.cuerpo.id}/seguimientos`, {
    token: tokenS1, method: "POST", body: { comentario: "Llamada de prueba" },
  });
  const r = await pedir(`/api/radar-demanda/${creada.cuerpo.id}/historial`, { token: tokenS1 });
  assert.equal(r.status, 200);
  assert.equal(r.cuerpo[0].usuario_nombre, "Vendedora S1");
  assert.deepEqual(Object.keys(r.cuerpo[0]).sort(), [
    "comentario", "demanda_id", "estado_anterior", "estado_nuevo", "fecha_hora",
    "id", "tipo", "usuario_id", "usuario_nombre",
  ].sort());
});

test("detalle enriquecido de otra sucursal sigue devolviendo 404", async () => {
  const creada = await crearEnSucursal2();
  assert.equal((await pedir(`/api/radar-demanda/${creada.cuerpo.id}`, { token: tokenS1 })).status, 404);
});

test("ventas candidatas requiere login y cerrar_demanda", async () => {
  const creada = await pedir("/api/radar-demanda", { token: tokenS1, method: "POST", body: demandaValida() });
  assert.equal((await pedir(`/api/radar-demanda/${creada.cuerpo.id}/ventas-candidatas`)).status, 401);
  assert.equal((await pedir(`/api/radar-demanda/${creada.cuerpo.id}/ventas-candidatas`, { token: tokenSinPermiso })).status, 403);
});

test("ventas candidatas responde 404 para demanda inexistente o fuera de alcance", async () => {
  assert.equal((await pedir("/api/radar-demanda/999999/ventas-candidatas", { token: tokenS1 })).status, 404);
  const creada = await crearEnSucursal2();
  assert.equal((await pedir(`/api/radar-demanda/${creada.cuerpo.id}/ventas-candidatas`, { token: tokenS1 })).status, 404);
});

test("ventas candidatas devuelve sólo proyección mínima de la misma sucursal", async () => {
  const creada = await pedir("/api/radar-demanda", { token: tokenS1, method: "POST", body: demandaValida() });
  const r = await pedir(`/api/radar-demanda/${creada.cuerpo.id}/ventas-candidatas`, { token: tokenS1 });
  assert.equal(r.status, 200);
  assert.ok(r.cuerpo.length > 0);
  const idsSucursal1 = new Set(app.DB.pos.ventas.filter((v) => v.sucursal_id === 1).map((v) => v.id));
  assert.ok(r.cuerpo.every((venta) => idsSucursal1.has(venta.id)));
  assert.ok(r.cuerpo.every((venta) => Object.keys(venta).sort().join(",") === [
    "cliente_id", "cliente_nombre", "fecha", "id", "total", "vendedor_id", "vendedor_nombre",
  ].sort().join(",")));
});

test("ventas candidatas no requiere ver_lista_ventas ni modifica ventas o inventario", async () => {
  assert.equal(permisosCompletos.includes("ver_lista_ventas"), false);
  const creada = await pedir("/api/radar-demanda", { token: tokenS1, method: "POST", body: demandaValida() });
  const ventasAntes = JSON.stringify(app.DB.pos.ventas);
  const inventarioAntes = JSON.stringify(app.DB.inventario);
  const r = await pedir(`/api/radar-demanda/${creada.cuerpo.id}/ventas-candidatas`, { token: tokenS1 });
  assert.equal(r.status, 200);
  assert.equal(JSON.stringify(app.DB.pos.ventas), ventasAntes);
  assert.equal(JSON.stringify(app.DB.inventario), inventarioAntes);
});

test("ventas candidatas aplica texto, fechas y límite máximo", async () => {
  const creada = await pedir("/api/radar-demanda", { token: tokenS1, method: "POST", body: demandaValida() });
  const r = await pedir(`/api/radar-demanda/${creada.cuerpo.id}/ventas-candidatas?texto=1&fecha_inicio=2026-01-01&fecha_fin=2026-12-31&limite=1`, { token: tokenS1 });
  assert.equal(r.status, 200);
  assert.ok(r.cuerpo.length <= 1);
  assert.ok(r.cuerpo.every((venta) => String(venta.id).includes("1") || venta.cliente_nombre.toLowerCase().includes("1")));
});

test("ventas candidatas normaliza límites no positivos y limita a cien", async () => {
  const creada = await pedir("/api/radar-demanda", { token: tokenS1, method: "POST", body: demandaValida() });
  const ventasOriginales = app.DB.pos.ventas;
  try {
    app.DB.pos.ventas = Array.from({ length: 120 }, (_, i) => ({
      id: 10000 + i, sucursal_id: 1, fecha: "2026-08-20", total: i + 1,
      cliente_id: null, vendedor_id: null,
    }));
    for (const limite of ["0", "-5"]) {
      const r = await pedir(`/api/radar-demanda/${creada.cuerpo.id}/ventas-candidatas?limite=${limite}`, { token: tokenS1 });
      assert.equal(r.status, 200);
      assert.equal(r.cuerpo.length, 50);
    }
    const maximo = await pedir(`/api/radar-demanda/${creada.cuerpo.id}/ventas-candidatas?limite=999`, { token: tokenS1 });
    assert.equal(maximo.status, 200);
    assert.equal(maximo.cuerpo.length, 100);
  } finally {
    app.DB.pos.ventas = ventasOriginales;
  }
});

test("ventas candidatas tolera texto vacío y nombres relacionados nulos", async () => {
  const creada = await pedir("/api/radar-demanda", { token: tokenS1, method: "POST", body: demandaValida() });
  const ventasOriginales = app.DB.pos.ventas;
  try {
    app.DB.pos.ventas = [{
      id: 20001, sucursal_id: 1, fecha: "2026-08-20", total: 10,
      cliente_id: null, vendedor_id: null,
    }];
    const r = await pedir(`/api/radar-demanda/${creada.cuerpo.id}/ventas-candidatas?texto=`, { token: tokenS1 });
    assert.equal(r.status, 200);
    assert.equal(r.cuerpo.length, 1);
    assert.equal(r.cuerpo[0].cliente_nombre, "Público en General");
    assert.equal(r.cuerpo[0].vendedor_nombre, null);
  } finally {
    app.DB.pos.ventas = ventasOriginales;
  }
});

test("ventas candidatas rechaza fechas inicial o final inválidas", async () => {
  const creada = await pedir("/api/radar-demanda", { token: tokenS1, method: "POST", body: demandaValida() });
  for (const query of ["fecha_inicio=no-es-fecha", "fecha_fin=2026-02-30"]) {
    const r = await pedir(`/api/radar-demanda/${creada.cuerpo.id}/ventas-candidatas?${query}`, { token: tokenS1 });
    assert.equal(r.status, 400);
    assert.match(r.cuerpo.error, /fecha válida.*YYYY-MM-DD/);
  }
});

test("conversión vuelve a rechazar venta inexistente o de otra sucursal", async () => {
  const creada = await pedir("/api/radar-demanda", { token: tokenS1, method: "POST", body: demandaValida() });
  const ventaOtraSucursal = app.DB.pos.ventas.find((venta) => venta.sucursal_id === 2);
  const otra = await pedir(`/api/radar-demanda/${creada.cuerpo.id}`, {
    token: tokenS1, method: "PATCH",
    body: { estado: "CONVERTIDA", venta_recuperada_id: ventaOtraSucursal.id },
  });
  assert.equal(otra.status, 400);

  const inexistente = await pedir(`/api/radar-demanda/${creada.cuerpo.id}`, {
    token: tokenS1, method: "PATCH",
    body: { estado: "CONVERTIDA", venta_recuperada_id: 999999 },
  });
  assert.equal(inexistente.status, 400);
  const detalle = await pedir(`/api/radar-demanda/${creada.cuerpo.id}`, { token: tokenS1 });
  assert.equal(detalle.cuerpo.estado, "REGISTRADA");
  assert.equal(detalle.cuerpo.venta_recuperada_id, null);
});

async function demandaContactada() {
  const creada = await pedir("/api/radar-demanda", { token: tokenS1, method: "POST", body: demandaValida() });
  const contactada = await pedir(`/api/radar-demanda/${creada.cuerpo.id}`, {
    token: tokenS1, method: "PATCH", body: { estado: "CLIENTE_CONTACTADO" },
  });
  assert.equal(contactada.status, 200);
  return creada.cuerpo.id;
}

async function comprobarConversionAtomica(ventaRecuperadaId) {
  const demandaId = await demandaContactada();
  const historialAntes = JSON.stringify(app.DB.radar_demanda.seguimientos);
  const ultimoSeguimientoAntes = app.DB.radar_demanda.ultimo_seguimiento_id;
  const r = await pedir(`/api/radar-demanda/${demandaId}`, {
    token: tokenS1, method: "PATCH",
    body: { estado: "CONVERTIDA", venta_recuperada_id: ventaRecuperadaId },
  });
  assert.equal(r.status, 400);
  const demanda = app.DB.radar_demanda.registros.find((item) => item.id === demandaId);
  assert.equal(demanda.estado, "CLIENTE_CONTACTADO");
  assert.equal(demanda.venta_recuperada_id, null);
  assert.equal(JSON.stringify(app.DB.radar_demanda.seguimientos), historialAntes);
  assert.equal(app.DB.radar_demanda.ultimo_seguimiento_id, ultimoSeguimientoAntes);
  assert.equal(app.DB.radar_demanda.seguimientos.some(
    (item) => item.demanda_id === demandaId && item.estado_nuevo === "CONVERTIDA"
  ), false);
}

test("conversión con venta inexistente es atómica desde CLIENTE_CONTACTADO", async () => {
  await comprobarConversionAtomica(999999);
});

test("conversión con venta de otra sucursal es atómica desde CLIENTE_CONTACTADO", async () => {
  const ventaOtraSucursal = app.DB.pos.ventas.find((venta) => venta.sucursal_id === 2);
  assert.ok(ventaOtraSucursal);
  await comprobarConversionAtomica(ventaOtraSucursal.id);
});

test('la cadena "false" no crea prospecto ni consentimiento', async () => {
  const clientesAntes = (await pedir("/api/crm/clientes", { token: tokenAdmin })).cuerpo.length;
  const r = await pedir("/api/radar-demanda", {
    token: tokenS1,
    method: "POST",
    body: demandaValida({
      intencion_compra: "false",
      consentimiento_aviso: "false",
      nombre_contacto: "Nadie",
      telefono_contacto: "9615550000",
    }),
  });
  assert.equal(r.status, 400);
  assert.match(r.cuerpo.error, /intencion_compra/);
  const clientesDespues = (await pedir("/api/crm/clientes", { token: tokenAdmin })).cuerpo.length;
  assert.equal(clientesDespues, clientesAntes, "el CRM no debió cambiar");
});

test("/resumen usa la fórmula aprobada y lo demuestra con su denominador", async () => {
  const r = await pedir("/api/radar-demanda/resumen", { token: tokenAdmin });
  assert.equal(r.status, 200);
  const esperado = (r.cuerpo.por_estado.CONVERTIDA || 0) + (r.cuerpo.por_estado.NO_CONVERTIDA || 0);
  assert.equal(
    r.cuerpo.conversion_detalle.denominador, esperado,
    "el denominador son los cierres decididos, no todos los registros"
  );
  assert.equal(r.cuerpo.conversion_detalle.numerador, r.cuerpo.por_estado.CONVERTIDA || 0);
});

test("la API rechaza cerrar como CONVERTIDA sin venta", async () => {
  const creada = await pedir("/api/radar-demanda", {
    token: tokenS1, method: "POST", body: demandaValida(),
  });
  const r = await pedir(`/api/radar-demanda/${creada.cuerpo.id}`, {
    token: tokenS1, method: "PATCH", body: { estado: "CONVERTIDA" },
  });
  assert.equal(r.status, 400);
  assert.match(r.cuerpo.error, /venta/i);
});
