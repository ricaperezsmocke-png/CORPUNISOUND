const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pantallas-caja-")), "datos.sqlite");
process.env.JWT_SECRET = process.env.JWT_SECRET || "secreto-de-pruebas";

const app = require("./server");
const { sembrarCuentas } = require("./testHelpers");
const { firmarToken } = require("./auth");
const { crearRol } = require("./roles");

let servidor = null;
let base = "";
let ADMIN = "";
let SIN_PERMISO = "";

// Cada ruta de escritura que mueve dinero, con el interruptor que la apaga.
const RUTAS = [
  ["POST", "/api/ventas", "punto_venta"],
  ["PUT", "/api/ventas/1/cancelar", "punto_venta"],
  ["PUT", "/api/ventas/1/caja", "punto_venta"],
  ["POST", "/api/apartados", "punto_venta"],
  ["POST", "/api/apartados/1/abonos", "punto_venta"],
  ["PUT", "/api/apartados/1/cancelar", "punto_venta"],
  ["POST", "/api/garantias/1/gastos", "dinero_garantias_caja"],
  ["DELETE", "/api/garantias/1/gastos/1", "dinero_garantias_caja"],
  ["POST", "/api/garantias/1/cobros", "dinero_garantias_caja"],
  ["POST", "/api/gastos", "gastos_caja"],
  ["PUT", "/api/gastos/1/origen", "gastos_caja"],
  ["PUT", "/api/gastos/1/cancelar", "gastos_caja"],
  ["POST", "/api/gastos/categorias", "gastos_caja"],
  ["PUT", "/api/gastos/categorias/1", "gastos_caja"],
  ["POST", "/api/depositos", "depositos"],
  ["POST", "/api/depositos/1/comprobante", "depositos"],
  ["PUT", "/api/depositos/1/cancelar", "depositos"],
];

async function pedir(metodo, ruta, token, cuerpo) {
  const r = await fetch(`${base}${ruta}`, { method: metodo,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: metodo === "GET" ? undefined : JSON.stringify(cuerpo || {}) });
  let datos = null;
  try { datos = await r.json(); } catch { datos = null; }
  return { status: r.status, datos };
}

function poner(estado) {
  app.DB.pos.pantallas_caja = { estado: { ...estado }, historial: [] };
}

before(async () => {
  const admin = app.DB.admin.roles.find((r) => r.nombre === "Administrador");
  // Permisos vecinos del mismo módulo (admin) y el de configuración del POS, pero NO el nuevo.
  const vecino = crearRol(app.DB, { nombre: "Gerente sin interruptores",
    permisos: ["administrar_roles", "administrar_sucursales", "dar_alta_personal", "editar_configuracion_pos"],
    modulos: ["admin", "pos"] });
  sembrarCuentas(app, [{ id: 801, rol_id: admin.id, sucursal_id: 1 }, { id: 802, rol_id: vecino.id, sucursal_id: 1 }]);
  ADMIN = firmarToken({ id: 801, nombre: "Admin Pruebas", rol_id: admin.id, sucursal_id: 1 });
  SIN_PERMISO = firmarToken({ id: 802, nombre: "Gerente", rol_id: vecino.id, sucursal_id: 1 });
  await new Promise((listo) => { servidor = app.listen(0, listo); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(async () => { if (servidor) await new Promise((listo) => servidor.close(listo)); });
beforeEach(() => { delete app.DB.pos.pantallas_caja; });

test("con la pantalla apagada cada ruta de dinero responde 409 PANTALLA_APAGADA; encendida no", async () => {
  for (const [metodo, ruta, pantalla] of RUTAS) {
    poner({ [pantalla]: false });
    const apagada = await pedir(metodo, ruta, ADMIN);
    assert.equal(apagada.status, 409, `${metodo} ${ruta}`);
    assert.equal(apagada.datos.codigo, "PANTALLA_APAGADA");
    assert.equal(apagada.datos.pantalla, pantalla);
    poner({});
    const encendida = await pedir(metodo, ruta, ADMIN);
    assert.notEqual(encendida.datos?.codigo, "PANTALLA_APAGADA", `${metodo} ${ruta} encendida`);
  }
});

test("las consultas siguen funcionando con todo apagado", async () => {
  poner({ punto_venta: false, corte_caja: false, gastos_caja: false, dinero_garantias_caja: false, depositos: false });
  for (const ruta of ["/api/ventas?sucursal_id=todas", "/api/cortes", "/api/gastos", "/api/apartados?sucursal_id=todas"]) {
    const r = await pedir("GET", ruta, ADMIN);
    assert.equal(r.status, 200, ruta);
  }
});

test("con el corte apagado se puede cortar MercadoLibre pero no una tienda física", async () => {
  poner({ punto_venta: false, corte_caja: false, gastos_caja: false, dinero_garantias_caja: false, depositos: false });
  const tienda = await pedir("POST", "/api/cortes", ADMIN, { sucursal_id: 1 });
  assert.equal(tienda.status, 409);
  assert.equal(tienda.datos.codigo, "PANTALLA_APAGADA");
  const ml = await pedir("POST", "/api/cortes", ADMIN, { sucursal_id: 5 });
  assert.notEqual(ml.datos?.codigo, "PANTALLA_APAGADA");
  const mlTexto = await pedir("POST", "/api/cortes", ADMIN, { sucursal_id: "5" });
  assert.notEqual(mlTexto.datos?.codigo, "PANTALLA_APAGADA", "el id como texto también es MercadoLibre");
  const importar = await pedir("POST", "/api/ml/ordenes/123/importar", ADMIN);
  assert.notEqual(importar.datos?.codigo, "PANTALLA_APAGADA", "importar órdenes de ML no se bloquea");
});

test("cambiar interruptores exige el permiso nuevo; consultarlos no", async () => {
  const sin = await pedir("PUT", "/api/configuracion/pantallas", SIN_PERMISO, { pantalla: "punto_venta", activa: false });
  assert.equal(sin.status, 403);
  const ver = await pedir("GET", "/api/configuracion/pantallas", SIN_PERMISO);
  assert.equal(ver.status, 200);
  assert.equal(ver.datos.pantallas.punto_venta, true);
  assert.equal(ver.datos.historial, undefined, "el historial solo lo ve quien tiene el permiso");
  const con = await pedir("PUT", "/api/configuracion/pantallas", ADMIN, { pantalla: "punto_venta", activa: false });
  assert.equal(con.status, 200);
  assert.equal(con.datos.pantallas.punto_venta, false);
  assert.equal(con.datos.historial.at(-1).usuario_id, 801);
  const invalido = await pedir("PUT", "/api/configuracion/pantallas", ADMIN, { pantalla: "punto_venta", activa: "si" });
  assert.equal(invalido.status, 400);
  const regla = await pedir("PUT", "/api/configuracion/pantallas", ADMIN, { pantalla: "corte_caja", activa: false });
  assert.equal(regla.status, 409);
  assert.ok(regla.datos.error);
});

test("la configuración general no permite mover interruptores por la puerta de atrás", async () => {
  for (const clave of ["pantallas", "pantallas_historial", "pantallas_caja"]) {
    const r = await pedir("PUT", "/api/configuracion", ADMIN, { [clave]: { punto_venta: false } });
    assert.equal(r.status, 400, clave);
  }
  assert.equal(app.DB.pos.pantallas_caja, undefined);
  const normal = await pedir("PUT", "/api/configuracion", ADMIN, { dias_alerta_garantias: 20 });
  assert.equal(normal.status, 200);
});
