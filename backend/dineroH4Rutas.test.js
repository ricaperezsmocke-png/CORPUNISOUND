const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
process.env.DB_PATH = ":memory:";
process.env.JWT_SECRET = "dinero-pruebas-sin-datos-reales";
const app = require("./server");
const { construirDBPrueba } = require("./testHelpers");
const { firmarToken, hashearPassword } = require("./auth");
const { crearVenta, cancelarVenta } = require("./ventas");
const { crearApartado } = require("./apartados");
const { calcularCorteEnCurso } = require("./cortes");
const { sembrarCajas } = require("./cajas");
const { listarPermisos } = require("./permisosCatalogo");
let servidor, base, hash, token, venta;
const PASSWORD = "clave-solo-de-prueba";
const motivo = "  Devolución del cliente  ";
const autorizador = { usuario: "supervisora", password: PASSWORD };

before(async () => {
  hash = await hashearPassword(PASSWORD);
  await new Promise((resolve) => { servidor = app.listen(0, resolve); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(async () => { if (servidor) await new Promise((resolve) => servidor.close(resolve)); });
beforeEach(() => {
  Object.assign(app.DB, construirDBPrueba());
  app.DB.pos.ventas = [];
  app.DB.pos.venta_detalle = [];
  app.DB.pos.cajas = [];
  app.DB.pos.configuracion = { descuentos_pago_habilitado: false };
  sembrarCajas(app.DB);
  app.DB.admin.roles = [
    { id: 90, permisos: ["cancelar_ventas", "cerrar_venta", "autorizar_cancelaciones"] },
    { id: 91, permisos: ["autorizar_cancelaciones"] },
    { id: 92, permisos: ["cancelar_ventas", "cerrar_venta"] },
    { id: 93, permisos: ["autorizar_cancelaciones", "ver_todas_las_sucursales", "cancelar_ventas"] },
  ];
  app.DB.admin.usuarios = [
    { id: 50, nombre: "Cajera", usuario: "cajera", rol_id: 90, sucursal_id: 1, activo: true, password_hash: hash },
    { id: "51", nombre: "Supervisora", usuario: "supervisora", rol_id: 91, sucursal_id: "1", activo: true, password_hash: hash },
  ];
  token = firmarToken({ ...app.DB.admin.usuarios[0], id: "50" });
  venta = crearVenta(app.DB, {
    sucursal_id: 1, lineas: [{ producto_id: 1, cantidad: 1, precio_unitario: 25 }],
  });
});
async function pedir(body, query = "?sucursal_id=2&caja_id=999") {
  const r = await fetch(`${base}/api/ventas/${venta.id}/cancelar${query}`, {
    method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}
function corte() { return calcularCorteEnCurso(app.DB, 1, venta.caja_id).calculado.EFECTIVO; }

for (const valor of [undefined, null, "", " \t\n", 123, {}]) {
  test(`H4 HTTP: motivo inválido ${JSON.stringify(valor)} da 400 sin cancelar`, async () => {
    const antes = structuredClone(app.DB);
    assert.deepEqual(await pedir({ motivo: valor, autorizador }), {
      status: 400, body: { error: "Escribe el motivo de la cancelación" },
    });
    assert.deepEqual(app.DB, antes);
    assert.equal(corte(), 25);
  });
}
const rechazos = [
  ["sin autorizador", undefined],
  ["sin usuario", { password: PASSWORD }],
  ["sin contraseña", { usuario: "supervisora" }],
  ["contraseña incorrecta", { usuario: "supervisora", password: "incorrecta" }],
  ["usuario inexistente", { usuario: "nadie", password: PASSWORD }],
  ["misma persona con id de texto", { usuario: "cajera", password: PASSWORD }],
  ["inactiva", autorizador, (u) => { u.activo = false; }],
  ["sin permiso con permisos vecinos", autorizador, (u) => { u.rol_id = 92; }],
  ["otra sucursal", autorizador, (u) => { u.sucursal_id = "2"; }],
  ["sucursal ausente", autorizador, (u) => { u.sucursal_id = null; }],
  ["credenciales mal formadas", { usuario: {}, password: [] }],
];
for (const [nombre, credenciales, preparar] of rechazos) {
  test(`H4 HTTP: ${nombre} da 403 genérico y conserva venta, inventario y corte`, async () => {
    preparar?.(app.DB.admin.usuarios[1]);
    const antes = structuredClone(app.DB);
    assert.deepEqual(await pedir({ motivo, autorizador: credenciales }), {
      status: 403, body: { error: "La autorización no es válida" },
    });
    assert.deepEqual(app.DB, antes);
    assert.equal(venta.estatus, "cerrada");
    assert.equal(corte(), 25);
  });
}
for (const global of [false, true]) {
  test(`H4 HTTP: segunda persona válida ${global ? "global" : "local"} deja rastro sin contraseña`, async () => {
    if (global) Object.assign(app.DB.admin.usuarios[1], { rol_id: 93, sucursal_id: 2 });
    const r = await pedir({ motivo, autorizador });
    assert.equal(r.status, 200);
    assert.equal(venta.estatus, "cancelada");
    assert.equal(venta.motivo_cancelacion, "Devolución del cliente");
    assert.deepEqual(venta.cancelacion_autorizada_por, { id: 51, nombre: "Supervisora" });
    assert.equal(venta.cancelada_por, "Cajera");
    assert.ok(venta.fecha_hora_cancelacion);
    assert.equal(app.DB.inventario.existencias[0].cantidad_actual, 120);
    assert.equal(corte(), 0);
    assert.ok(!JSON.stringify(app.DB).includes(PASSWORD));
    assert.ok(!JSON.stringify(venta).includes("password"));
    assert.equal((await pedir({ motivo, autorizador })).status, 400);
    assert.equal(app.DB.inventario.existencias[0].cantidad_actual, 120);
  });
}
test("H4 HTTP: alcance global de quien cancela ignora el selector del encabezado", async () => {
  app.DB.admin.usuarios[0].rol_id = 93;
  assert.equal((await pedir({ motivo, autorizador })).status, 200);
});
test("H4 HTTP: una cajera local no cancela otra sucursal aunque cambie el selector", async () => {
  venta.sucursal_id = 2;
  const antes = structuredClone(app.DB);
  assert.equal((await pedir({ motivo, autorizador })).status, 404);
  assert.deepEqual(app.DB, antes);
});
test("H4: cancelarVenta exige motivo sin depender de HTTP", () => {
  for (const valor of [undefined, null, "", "  ", 123]) {
    const antes = structuredClone(app.DB);
    assert.throws(() => cancelarVenta(app.DB, venta.id, valor, { id: 50 }, { id: 51, nombre: "Supervisora" }), /motivo/i);
    assert.deepEqual(app.DB, antes);
  }
});
test("H4: cancelarVenta exige identidad del autorizador y solo copia id y nombre", () => {
  assert.throws(() => cancelarVenta(app.DB, venta.id, motivo, { id: 50 }), /autoriz/i);
  cancelarVenta(app.DB, venta.id, motivo, { id: 50 }, { id: "51", nombre: "Supervisora", password: PASSWORD });
  assert.deepEqual(venta.cancelacion_autorizada_por, { id: 51, nombre: "Supervisora" });
  assert.ok(!JSON.stringify(venta).includes(PASSWORD));
});
test("H4: permiso nuevo está disponible en POS y Administrador lo recibe", () => {
  const permiso = listarPermisos().find((p) => p.clave === "autorizar_cancelaciones");
  assert.equal(permiso?.modulo, "pos");
  assert.equal(permiso?.implementado, true);
  const DB = construirDBPrueba();
  assert.ok(DB.admin.roles.find((r) => r.id === 1).permisos.includes("autorizar_cancelaciones"));
});
test("H4 HTTP: cancelar apartados conserva el flujo sin segunda persona", async () => {
  venta = crearApartado(app.DB, {
    cliente_id: 1, anticipo_monto: 5, anticipo_forma_pago: "EFECTIVO",
    lineas: [{ producto_id: 1, cantidad: 1, precio_unitario: 25 }],
  }, 1);
  const r = await pedir({ motivo: "Cambio del cliente" }, "?sucursal_id=1");
  assert.equal(r.status, 200);
  assert.equal(venta.estatus, "cancelada");
  assert.equal(app.DB.crm.clientes.find((c) => c.id === 1).monedero, 5);
});
