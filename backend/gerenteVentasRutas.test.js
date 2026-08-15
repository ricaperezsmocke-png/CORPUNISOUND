/**
 * gerenteVentasRutas.test.js — El CABLEADO de Gerencia de Ventas.
 *
 * Le pega a las rutas REALES vía require("./server"), igual que
 * respaldosRutas.test.js y rutasEscrituraSucursal.test.js.
 *
 * Lo que más importa aquí: que una vendedora NO pueda ver ni tocar el tablero
 * de otra. Es el mismo tipo de hueco que tuvo Apartados en julio (actuar sobre
 * el registro de alguien más pasando su id), y este módulo mide el desempeño de
 * personas — ver el de la compañera es información sensible entre ellas.
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

// ⚠️ ANTES de requerir server.js, o la prueba ensucia la base real.
const DB_TEMPORAL = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "gventas-")), "datos.sqlite");
process.env.DB_PATH = DB_TEMPORAL;
process.env.JWT_SECRET = process.env.JWT_SECRET || "secreto-de-pruebas";

const app = require("./server");
const { firmarToken } = require("./auth");
const { listarPermisos } = require("./permisosCatalogo");

// Tokens con la forma que emite el login DE VERDAD (sucursal_id numérica).
// Ver la lección de respaldosRutas.test.js: firmar tokens con una forma que el
// sistema no puede producir esconde bugs enteros.
const TOKEN_ADMIN = firmarToken({ id: 1, nombre: "Victor", rol_id: 1, sucursal_id: 1 });
const TOKEN_CAJERA = firmarToken({ id: 50, nombre: "Ana López", rol_id: 3, sucursal_id: 1 });
const TOKEN_OTRA_CAJERA = firmarToken({ id: 51, nombre: "Carlos Ruiz", rol_id: 3, sucursal_id: 1 });

let servidor = null;
let base = "";

before(async () => {
  await new Promise((listo) => { servidor = app.listen(0, listo); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(async () => {
  if (servidor) await new Promise((listo) => servidor.close(listo));
});

async function pedir(ruta, opciones = {}) {
  const r = await fetch(base + ruta, {
    ...opciones,
    headers: { "Content-Type": "application/json", ...(opciones.headers || {}) },
  });
  let cuerpo = null;
  try { cuerpo = await r.json(); } catch (_) {}
  return { status: r.status, cuerpo };
}

test("los dos permisos nuevos están en el catálogo, en el módulo pos", () => {
  const permisos = listarPermisos();
  const usar = permisos.find((p) => p.clave === "usar_gerente_ventas");
  const editar = permisos.find((p) => p.clave === "editar_objetivos_venta");
  assert.ok(usar, "falta usar_gerente_ventas");
  assert.ok(editar, "falta editar_objetivos_venta");
  assert.strictEqual(usar.modulo, "pos");
  assert.strictEqual(editar.modulo, "pos");
});

test("sin sesión no se ve ningún tablero", async () => {
  assert.strictEqual((await pedir("/api/gerente-ventas/1")).status, 401);
});

// ---------- Preparación: se ligan dos cuentas a dos vendedores ----------

test("preparación: liga cuentas de prueba con vendedores", async () => {
  // Se hace por la ruta real de personal, no tocando el DB a mano: así también
  // se prueba que el campo vendedor_id viaja de verdad por la API.
  const ana = await pedir("/api/usuarios", {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN_ADMIN}` },
    body: JSON.stringify({
      nombre: "Ana López", usuario: "ana.prueba", password: "secreto123",
      rol_id: 3, sucursal_id: 1, vendedor_id: 1,
    }),
  });
  assert.strictEqual(ana.status, 200, JSON.stringify(ana.cuerpo));
  assert.strictEqual(ana.cuerpo.vendedor_id, 1, "el campo debe persistir");

  const carlos = await pedir("/api/usuarios", {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN_ADMIN}` },
    body: JSON.stringify({
      nombre: "Carlos Ruiz", usuario: "carlos.prueba", password: "secreto123",
      rol_id: 3, sucursal_id: 1, vendedor_id: 2,
    }),
  });
  assert.strictEqual(carlos.status, 200);

  // Los tokens de arriba usan ids fijos (50 y 51); se realinean a los reales.
  ANA_ID = ana.cuerpo.id;
  CARLOS_ID = carlos.cuerpo.id;
});

let ANA_ID = null;
let CARLOS_ID = null;
const tokenDe = (id, nombre) => firmarToken({ id, nombre, rol_id: 3, sucursal_id: 1 });

test("una cuenta ligada ve SU tablero", async () => {
  const r = await pedir("/api/gerente-ventas/1", {
    headers: { Authorization: `Bearer ${tokenDe(ANA_ID, "Ana López")}` },
  });
  assert.strictEqual(r.status, 200, JSON.stringify(r.cuerpo));
  assert.strictEqual(r.cuerpo.vendedor_id, 1);
  assert.ok("vendido_mes" in r.cuerpo);
  assert.ok(Array.isArray(r.cuerpo.tareas));
});

test("una vendedora NO puede ver el tablero de otra", async () => {
  // El caso que importa: Ana pidiendo el tablero de Carlos por su id.
  const r = await pedir("/api/gerente-ventas/2", {
    headers: { Authorization: `Bearer ${tokenDe(ANA_ID, "Ana López")}` },
  });
  assert.strictEqual(r.status, 404, "no debe poder ver el desempeño de su compañero");
  // 404 y no 403: tampoco se le confirma que ese tablero exista.
  assert.match(r.cuerpo.error, /no encontrado/i);
});

test("una cuenta SIN vendedor ligado no ve ningún tablero", async () => {
  // El administrador de este token (id 1) no está ligado a ningún vendedor.
  // Como tampoco tiene el permiso de jefatura en este escenario, no ve nada.
  const sinLigar = await pedir("/api/usuarios", {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN_ADMIN}` },
    body: JSON.stringify({
      nombre: "Sin Vendedor", usuario: "sinvendedor.prueba", password: "secreto123",
      rol_id: 3, sucursal_id: 1,
    }),
  });
  assert.strictEqual(sinLigar.status, 200);
  assert.strictEqual(sinLigar.cuerpo.vendedor_id, null);

  const r = await pedir("/api/gerente-ventas/1", {
    headers: { Authorization: `Bearer ${tokenDe(sinLigar.cuerpo.id, "Sin Vendedor")}` },
  });
  assert.strictEqual(r.status, 404);
});

test("/mi/vendedor dice con qué vendedor está ligada mi cuenta", async () => {
  const r = await pedir("/api/gerente-ventas/mi/vendedor", {
    headers: { Authorization: `Bearer ${tokenDe(ANA_ID, "Ana López")}` },
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.cuerpo.vendedor_id, 1);
});

// ---------- Tareas ----------

test("una vendedora NO puede cerrar una tarea del tablero de otra", async () => {
  // Primero se generan tareas en el tablero de Carlos (vendedor 2).
  const tableroCarlos = await pedir("/api/gerente-ventas/2", {
    headers: { Authorization: `Bearer ${tokenDe(CARLOS_ID, "Carlos Ruiz")}` },
  });
  assert.strictEqual(tableroCarlos.status, 200);

  // Ana intenta cerrar una tarea del tablero de Carlos.
  const r = await pedir("/api/gerente-ventas/2/tareas/1", {
    method: "PUT",
    headers: { Authorization: `Bearer ${tokenDe(ANA_ID, "Ana López")}` },
    body: JSON.stringify({ estado: "hecha" }),
  });
  assert.strictEqual(r.status, 404);
});

// ---------- Metas: solo jefatura ----------

test("una cajera NO puede fijarse su propia meta", async () => {
  // Si pudiera, el objetivo dejaría de significar nada: se pondría la meta que
  // ya alcanzó. La medición la fija quien manda, no quien es medido.
  const r = await pedir("/api/gerente-ventas/1/meta", {
    method: "PUT",
    headers: { Authorization: `Bearer ${tokenDe(ANA_ID, "Ana López")}` },
    body: JSON.stringify({ meta: 1 }),
  });
  assert.strictEqual(r.status, 403);
});

test("el administrador SÍ puede fijar la meta de un vendedor", async () => {
  const r = await pedir("/api/gerente-ventas/1/meta", {
    method: "PUT",
    headers: { Authorization: `Bearer ${TOKEN_ADMIN}` },
    body: JSON.stringify({ meta: 80000 }),
  });
  assert.strictEqual(r.status, 200, JSON.stringify(r.cuerpo));
  assert.strictEqual(r.cuerpo.meta_mensual, 80000);
});

test("una meta inválida se rechaza con mensaje claro", async () => {
  const r = await pedir("/api/gerente-ventas/1/meta", {
    method: "PUT",
    headers: { Authorization: `Bearer ${TOKEN_ADMIN}` },
    body: JSON.stringify({ meta: -5 }),
  });
  assert.strictEqual(r.status, 400);
  assert.match(r.cuerpo.error, /mayor o igual a cero/);
});

test("la lista de jefatura trae a los vendedores con su progreso", async () => {
  const r = await pedir("/api/gerente-ventas", {
    headers: { Authorization: `Bearer ${TOKEN_ADMIN}` },
  });
  assert.strictEqual(r.status, 200);
  assert.ok(Array.isArray(r.cuerpo));
  assert.ok(r.cuerpo.length > 0);
  assert.ok("meta" in r.cuerpo[0] && "vendido_mes" in r.cuerpo[0]);
});

test("una cajera no puede ver la lista de desempeño de todo el personal", async () => {
  const r = await pedir("/api/gerente-ventas", {
    headers: { Authorization: `Bearer ${tokenDe(ANA_ID, "Ana López")}` },
  });
  assert.strictEqual(r.status, 403);
});
