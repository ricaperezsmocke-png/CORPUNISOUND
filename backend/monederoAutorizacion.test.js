/**
 * monederoAutorizacion.test.js — Gastar el monedero de un cliente exige permiso
 * propio y la autorización de OTRA persona (auditoría de permisos 2026-10, C1;
 * decisión de Victor 2026-10-27).
 *
 * La reproducción H3 mostraba a una cajera de Ocosingo, con solo `cerrar_venta`,
 * pagando mercancía con el monedero de un cliente de Yajalón: su cajón cuadraba
 * y el dinero que faltaba era del cliente. Aquí se exige lo contrario, contra la
 * ruta REAL, y en cada rechazo el saldo del cliente queda intacto.
 */

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "monedero-aut-")), "datos.sqlite");
process.env.JWT_SECRET = process.env.JWT_SECRET || "secreto-de-pruebas";

const app = require("./server");
const { firmarToken, hashearPassword } = require("./auth");
const { crearRol, sembrarRolesIniciales } = require("./roles");
const { calcularCorteEnCurso } = require("./cortes");
const { listarPermisos } = require("./permisosCatalogo");
const { construirDBPrueba } = require("./testHelpers");

const DB = app.DB;
const CLAVE = "clave-de-prueba-monedero";
let servidor = null, base = "";
const TK = {};

before(async () => {
  const hash = await hashearPassword(CLAVE);
  // Cada rol lleva permisos VECINOS del módulo, para que un 403 no pase por
  // cualquier clave (CLAUDE.md, cómo escribir pruebas).
  const cajera = crearRol(DB, { nombre: "Cajera monedero", permisos: ["cerrar_venta", "aplicar_monedero", "cambiar_cliente"], modulos: ["pos"] });
  const cajeraSin = crearRol(DB, { nombre: "Cajera sin monedero", permisos: ["cerrar_venta", "autorizar_monedero", "cambiar_cliente"], modulos: ["pos"] });
  const autoriza = crearRol(DB, { nombre: "Autoriza monedero", permisos: ["autorizar_monedero", "cerrar_venta"], modulos: ["pos"] });
  const noAutoriza = crearRol(DB, { nombre: "No autoriza", permisos: ["aplicar_monedero", "autorizar_cancelaciones"], modulos: ["pos"] });
  const cuentas = [
    { id: 201, nombre: "Cajera Ocosingo", usuario: "cajera-m", rol_id: cajera.id, sucursal_id: 1 },
    { id: 202, nombre: "Cajera sin permiso", usuario: "cajera-s", rol_id: cajeraSin.id, sucursal_id: 1 },
    { id: 203, nombre: "Supervisora", usuario: "super-m", rol_id: autoriza.id, sucursal_id: 1 },
    { id: 204, nombre: "Sin permiso de autorizar", usuario: "otra-m", rol_id: noAutoriza.id, sucursal_id: 1 },
    { id: 205, nombre: "Supervisora Yajalón", usuario: "super-y", rol_id: autoriza.id, sucursal_id: 2 },
    { id: 206, nombre: "Victor", usuario: "victor-m", rol_id: 1, sucursal_id: 1 },
  ];
  for (const c of cuentas) {
    DB.admin.usuarios.push({ ...c, password_hash: hash, vendedor_id: null, activo: true });
    TK[c.id] = firmarToken(c);
  }
  // La cajera con permiso también es autorizadora en potencia de sí misma:
  // se le da autorizar_monedero a un clon para probar "ella misma".
  const cajeraYAutoriza = crearRol(DB, { nombre: "Cajera que autoriza", permisos: ["cerrar_venta", "aplicar_monedero", "autorizar_monedero"], modulos: ["pos"] });
  DB.admin.usuarios.push({
    id: 207, nombre: "Cajera que autoriza", usuario: "cajera-a", rol_id: cajeraYAutoriza.id, sucursal_id: 1,
    password_hash: hash, vendedor_id: null, activo: true,
  });
  TK[207] = firmarToken({ id: 207, nombre: "Cajera que autoriza", rol_id: cajeraYAutoriza.id, sucursal_id: 1 });
  await new Promise((listo) => { servidor = app.listen(0, listo); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(async () => {
  if (servidor) await new Promise((listo) => servidor.close(listo));
});

beforeEach(() => {
  DB.crm.clientes.find((c) => c.id === 1).monedero = 500;
  DB.crm.clientes.find((c) => c.id === 2).monedero = 3000;
});

const saldo = (id) => DB.crm.clientes.find((c) => c.id === id).monedero;

async function vender(tk, extra = {}) {
  const r = await fetch(`${base}/api/ventas`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${tk}` },
    body: JSON.stringify({
      cliente_id: 1, monedero_aplicado: 25, metodo_pago: "Efectivo", vendedor_id: 1,
      lineas: [{ producto_id: 1, descripcion: "Arroz 1kg", cantidad: 1, precio_unitario: 25 }],
      autorizador: { usuario: "super-m", password: CLAVE },
      ...extra,
    }),
  });
  return { status: r.status, body: await r.json() };
}

test("cajera sin aplicar_monedero → 403 y el saldo no baja", async () => {
  const antes = DB.pos.ventas.length;
  const r = await vender(TK[202]);
  assert.deepStrictEqual(r, { status: 403, body: { error: "No tienes permiso para aplicar monedero" } });
  assert.strictEqual(saldo(1), 500);
  assert.strictEqual(DB.pos.ventas.length, antes);
});

test("con el permiso, cliente de otra tienda → 404 y el saldo no baja (H3 invertida)", async () => {
  const antes = DB.pos.ventas.length;
  const r = await vender(TK[201], { cliente_id: "2", monedero_aplicado: 3000 });
  assert.deepStrictEqual(r, { status: 404, body: { error: "Cliente no encontrado" } });
  assert.strictEqual(saldo(2), 3000);
  assert.strictEqual(DB.pos.ventas.length, antes);
});

test("un cliente sin sucursal solo lo usa quien tiene alcance global", async () => {
  const cliente = DB.crm.clientes.find((c) => c.id === 1);
  cliente.sucursal_id = null;
  try {
    const r = await vender(TK[201]);
    assert.strictEqual(r.status, 404);
    assert.strictEqual(saldo(1), 500);
  } finally { cliente.sucursal_id = 1; }
});

const rechazosAutorizador = [
  ["sin autorizador", { autorizador: undefined }],
  ["autorizador = ella misma", { autorizador: { usuario: "cajera-a", password: CLAVE } }, 207],
  ["autorizador sin autorizar_monedero", { autorizador: { usuario: "otra-m", password: CLAVE } }],
  ["autorizador de otra sucursal", { autorizador: { usuario: "super-y", password: CLAVE } }],
  ["contraseña mala", { autorizador: { usuario: "super-m", password: "mala" } }],
];
for (const [nombre, extra, quien = 201] of rechazosAutorizador) {
  test(`${nombre} → 403 genérico y el saldo no baja`, async () => {
    const antes = DB.pos.ventas.length;
    const r = await vender(TK[quien], extra);
    assert.deepStrictEqual(r, { status: 403, body: { error: "La autorización no es válida" } });
    assert.strictEqual(saldo(1), 500);
    assert.strictEqual(DB.pos.ventas.length, antes);
  });
}

test("con todo correcto: el saldo baja, la venta guarda quién autorizó y quién cobró, y el corte cobra total - monedero", async () => {
  const caja = DB.pos.cajas.find((c) => c.sucursal_id === 1 && c.predeterminada);
  const efectivoAntes = calcularCorteEnCurso(DB, 1, caja.id).calculado.EFECTIVO;
  const r = await vender(TK[201], {
    cliente_id: "1", monedero_aplicado: 10, caja_id: caja.id,
    monedero_autorizado_por_id: 999, cobrada_por_id: 999,
  });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const venta = DB.pos.ventas.find((v) => v.id === r.body.id);
  assert.strictEqual(saldo(1), 490);
  assert.strictEqual(venta.monedero_aplicado, 10);
  assert.strictEqual(venta.monedero_autorizado_por_id, 203);
  assert.strictEqual(venta.monedero_autorizado_por_nombre, "Supervisora");
  assert.strictEqual(venta.cobrada_por_id, 201);
  assert.ok(!JSON.stringify(venta).includes(CLAVE));
  // El corte cobra solo lo que entró en efectivo: total - monedero_aplicado.
  const esperado = Math.round((efectivoAntes + venta.total - venta.monedero_aplicado) * 100) / 100;
  assert.strictEqual(calcularCorteEnCurso(DB, 1, caja.id).calculado.EFECTIVO, esperado);
});

test("una venta sin monedero no pide autorizador ni permiso", async () => {
  const r = await vender(TK[202], { monedero_aplicado: 0, autorizador: undefined });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.monedero_autorizado_por_id, null);
  assert.strictEqual(saldo(1), 500);
});

test("un monedero_aplicado que no es número también exige el permiso (falla cerrando)", async () => {
  const r = await vender(TK[202], { monedero_aplicado: "abc" });
  assert.strictEqual(r.status, 403);
  assert.strictEqual(saldo(1), 500);
});

test("los permisos nuevos están en el catálogo, módulo pos, y no llegan al Gerente ni al Cajero sembrados", () => {
  const claves = listarPermisos().filter((p) => p.modulo === "pos").map((p) => p.clave);
  assert.ok(claves.includes("aplicar_monedero"));
  assert.ok(claves.includes("autorizar_monedero"));
  const DBp = construirDBPrueba();
  DBp.admin.roles = [];
  sembrarRolesIniciales(DBp);
  const [admin, gerente, cajero] = DBp.admin.roles;
  assert.ok(admin.permisos.includes("aplicar_monedero") && admin.permisos.includes("autorizar_monedero"));
  for (const rol of [gerente, cajero]) {
    assert.ok(!rol.permisos.includes("aplicar_monedero"), rol.nombre);
    assert.ok(!rol.permisos.includes("autorizar_monedero"), rol.nombre);
  }
});
