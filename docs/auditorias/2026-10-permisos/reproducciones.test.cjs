/**
 * Reproducciones de la auditoria de permisos 2026-10.
 *
 * Cada prueba PASA cuando el hueco EXISTE: afirma el comportamiento que el
 * informe reporta, contra la app real (server.js) en un puerto efimero y con
 * una base desechable. Cuando se cierre un hallazgo, su prueba se pone roja:
 * en ese momento se invierte la afirmacion y se mueve a backend/.
 *
 * Correr desde backend/:
 *   node --test ../docs/auditorias/2026-10-permisos/reproducciones.test.cjs
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const BACKEND = path.join(__dirname, "..", "..", "..", "backend");
const BASE_DESECHABLE = path.join(os.tmpdir(), `auditoria-permisos-${process.pid}.sqlite`);
process.env.DB_PATH = BASE_DESECHABLE;
process.env.JWT_SECRET = process.env.JWT_SECRET || "secreto-solo-para-pruebas";

const app = require(path.join(BACKEND, "server"));
const { sembrarCuentas } = require(path.join(BACKEND, "testHelpers"));
const { firmarToken, hashearPassword } = require(path.join(BACKEND, "auth"));

const DB = app.DB;
let servidor = null;
let base = "";

// Roles sembrados por roles.js: 1 Administrador, 2 Gerente de sucursal, 3 Cajero.
const ROL_SOLO_ALTA = 90;
const ROL_SOLO_MIGRAR = 91;
const ROL_SOLO_VER_PREDICCIONES = 92;

before(async () => {
  DB.admin.roles.push({ id: ROL_SOLO_ALTA, nombre: "Encargado de altas", permisos: ["dar_alta_personal"], modulos: ["admin"] });
  // Roles con UN permiso y sus vecinos de modulo que no autorizan la accion probada.
  DB.admin.roles.push({ id: ROL_SOLO_MIGRAR, nombre: "Capturista", permisos: ["migrar_datos", "crear_producto"], modulos: ["inventario"] });
  DB.admin.roles.push({ id: ROL_SOLO_VER_PREDICCIONES, nombre: "Consulta", permisos: ["ver_predicciones"], modulos: ["inventario"] });
  sembrarCuentas(app, [
    { id: 1, rol_id: 1, sucursal_id: 1 },
    { id: 2, rol_id: 2, sucursal_id: 1, nombre: "Gerente Ocosingo" },
    { id: 3, rol_id: 3, sucursal_id: 1, nombre: "Cajera Ocosingo" },
    { id: 4, rol_id: 2, sucursal_id: 2, nombre: "Gerente Yajalon" },
    { id: 5, rol_id: ROL_SOLO_ALTA, sucursal_id: 2, nombre: "Encargado altas Yajalon" },
    { id: 6, rol_id: ROL_SOLO_MIGRAR, sucursal_id: 1, nombre: "Capturista Ocosingo" },
    { id: 7, rol_id: ROL_SOLO_VER_PREDICCIONES, sucursal_id: 1, nombre: "Consulta Ocosingo" },
  ]);
  // Cuenta del dueno con contrasena real, para las pruebas de contrasena.
  DB.admin.usuarios.push({
    id: 50, nombre: "Victor", usuario: "victor", password_hash: await hashearPassword("ClaveReal2026"),
    rol_id: 1, sucursal_id: 1, vendedor_id: null, activo: true,
  });
  await new Promise((listo) => { servidor = app.listen(0, listo); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(async () => {
  if (servidor) await new Promise((listo) => servidor.close(listo));
  try { fs.unlinkSync(BASE_DESECHABLE); } catch { /* ya no estaba */ }
});

const token = (id) => {
  const u = DB.admin.usuarios.find((x) => x.id === id);
  return firmarToken({ id: u.id, nombre: u.nombre, rol_id: u.rol_id, sucursal_id: u.sucursal_id });
};

async function pedir(metodo, ruta, { tk, body } = {}) {
  const r = await fetch(base + ruta, {
    method: metodo,
    redirect: "manual",
    headers: { "Content-Type": "application/json", ...(tk ? { Authorization: `Bearer ${tk}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const texto = await r.text();
  let json = null;
  try { json = JSON.parse(texto); } catch { /* redireccion o texto */ }
  return { status: r.status, json, headers: r.headers };
}

test("H1: con solo dar_alta_personal y sin alcance global se crea una cuenta Administrador y se entra con ella", async () => {
  const alta = await pedir("POST", "/api/usuarios", {
    tk: token(5),
    body: { nombre: "Cuenta nueva", usuario: "intruso", password: "secreta1", rol_id: 1, sucursal_id: 2 },
  });
  assert.strictEqual(alta.status, 200, JSON.stringify(alta.json));
  assert.strictEqual(alta.json.rol_id, 1);
  // No queda quien la creo.
  const creada = DB.admin.usuarios.find((u) => u.usuario === "intruso");
  assert.ok(!("creado_por" in creada) && !("creada_por" in creada));

  const login = await pedir("POST", "/api/auth/login", { body: { usuario: "intruso", password: "secreta1" } });
  assert.strictEqual(login.status, 200, JSON.stringify(login.json));
  assert.strictEqual(login.json.usuario.ver_todas, true);
  const roles = await pedir("GET", "/api/roles", { tk: login.json.token });
  assert.strictEqual(roles.status, 200);
  // Y con esa cuenta ya puede cambiarle el rol a cualquiera, incluida la suya original.
  const subir = await pedir("PUT", "/api/usuarios/5", { tk: login.json.token, body: { rol_id: 1 } });
  assert.strictEqual(subir.status, 200);
  DB.admin.usuarios.find((u) => u.id === 5).rol_id = ROL_SOLO_ALTA;
});

test("H2: el callback de Google Drive no pide sesion ni state: cualquiera reemplaza la cuenta del negocio", async () => {
  DB.drive.cuenta = { access_token: "token-del-negocio", refresh_token: "r", expires_at: Date.now() + 3600e3 };
  const original = global.fetch;
  global.fetch = async (url, opciones) => {
    if (String(url).startsWith("https://oauth2.googleapis.com")) {
      return new Response(JSON.stringify({ access_token: "token-del-intruso", refresh_token: "r2", expires_in: 3600 }));
    }
    return original(url, opciones);
  };
  try {
    const r = await pedir("GET", "/api/drive/callback?code=codigo-de-otra-cuenta");
    assert.strictEqual(r.status, 302);
    assert.match(r.headers.get("location"), /drive=conectado/);
  } finally { global.fetch = original; }
  assert.strictEqual(DB.drive.cuenta.access_token, "token-del-intruso");
  assert.ok(!("conectado_por" in DB.drive.cuenta));
});

test("H2b: igual con MercadoLibre", async () => {
  DB.ml.cuenta = { access_token: "ml-del-negocio", user_id: 111 };
  const original = global.fetch;
  global.fetch = async (url, opciones) => {
    if (String(url).includes("/oauth/token")) {
      return new Response(JSON.stringify({ access_token: "ml-del-intruso", refresh_token: "x", user_id: 999, expires_in: 3600 }));
    }
    return original(url, opciones);
  };
  try {
    const r = await pedir("GET", "/api/ml/callback?code=codigo-ajeno");
    assert.strictEqual(r.status, 302);
  } finally { global.fetch = original; }
  assert.strictEqual(DB.ml.cuenta.user_id, 999);
});

test("H3: una cajera de Ocosingo cobra con el monedero de un cliente de Yajalon, y la venta no dice quien la cobro", async () => {
  const cliente = DB.crm.clientes.find((c) => c.id === 2);
  assert.strictEqual(cliente.sucursal_id, 2);
  cliente.monedero = 3000;
  const r = await pedir("POST", "/api/ventas", {
    tk: token(3),
    body: {
      cliente_id: "2", monedero_aplicado: 3000, metodo_pago: "Efectivo", vendedor_id: 1,
      lineas: [{ producto_id: 1, descripcion: "Arroz 1kg", cantidad: 4, precio_unitario: 25 }],
    },
  });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  const venta = DB.pos.ventas.find((v) => v.id === r.json.id);
  assert.strictEqual(venta.sucursal_id, 1);
  assert.strictEqual(venta.monedero_aplicado, venta.total); // el cajon no espera un peso
  assert.strictEqual(cliente.monedero, 3000 - venta.total);
  const camposDeQuien = Object.keys(venta).filter((k) => /usuario|cajer|cobr|creado/i.test(k));
  assert.deepStrictEqual(camposDeQuien, []);
});

test("H4: el campo del autorizador de cancelaciones prueba contrasenas sin el freno del login", async () => {
  const intentos = [];
  for (let i = 0; i < 8; i++) {
    const r = await pedir("PUT", "/api/ventas/999999/cancelar", {
      tk: token(2), body: { motivo: "x", autorizador: { usuario: "victor", password: `mala${i}` } },
    });
    intentos.push(r.status);
  }
  assert.deepStrictEqual(intentos, Array(8).fill(403));
  const acierto = await pedir("PUT", "/api/ventas/999999/cancelar", {
    tk: token(2), body: { motivo: "x", autorizador: { usuario: "victor", password: "ClaveReal2026" } },
  });
  // Respuesta distinta al acertar: es un oraculo de contrasena.
  assert.strictEqual(acierto.status, 400);
  // Y tras 8 fallos el login de Victor NO quedo bloqueado.
  const login = await pedir("POST", "/api/auth/login", { body: { usuario: "victor", password: "ClaveReal2026" } });
  assert.strictEqual(login.status, 200);
});

test("H5: el gerente de Yajalon cambia el precio que cobran las 6 tiendas y no queda quien lo cambio", async () => {
  const r = await pedir("PUT", "/api/productos/1", { tk: token(4), body: { precios: [{ precioVenta: 1 }] } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  const p = DB["catalogo-productos"].productos.find((x) => x.id === 1);
  assert.strictEqual(p.precio_venta, 1);
  // El producto se vende en Ocosingo: el cambio de alguien de Yajalon pega en otra tienda.
  assert.ok(DB.inventario.existencias.some((e) => e.producto_id === 1 && e.sucursal_id === 1 && e.cantidad_actual > 0));
  assert.deepStrictEqual(Object.keys(p).filter((k) => /usuario|modificado|editado|historial/i.test(k)), []);
  p.precio_venta = 25; p.precios = [{ precioVenta: 25 }];
});

test("H6: con migrar_datos (sin ajustar_existencia) se pone en cero una existencia y el movimiento no dice quien", async () => {
  const antes = DB.inventario.existencias.find((e) => e.producto_id === 4 && e.sucursal_id === 1).cantidad_actual;
  assert.ok(antes > 0);
  const r = await pedir("POST", "/api/migracion/aplicar", {
    tk: token(6),
    body: { tipo: "articulos", sucursal_id: 1, filas: [{ numero_fila: 1, clave: "BE-002", descripcion: "Agua 1L", existencia: 0 }] },
  });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.strictEqual(r.json.actualizados, 1, JSON.stringify(r.json));
  assert.strictEqual(DB.inventario.existencias.find((e) => e.producto_id === 4 && e.sucursal_id === 1).cantidad_actual, 0);
  const mov = DB.inventario.movimientos_inventario.filter((m) => m.producto_id === 4).at(-1);
  assert.strictEqual(mov.usuario, "Importación SICAR");
  assert.ok(!DB.admin.roles.find((x) => x.id === ROL_SOLO_MIGRAR).permisos.includes("ajustar_existencia"));
});

test("H7: el token conserva la sucursal vieja hasta 12 h despues de mover a la persona de tienda", async () => {
  const tk = token(3); // cajera de Ocosingo (1)
  DB.admin.usuarios.find((u) => u.id === 3).sucursal_id = 4; // la mueven a Palenque
  const r = await pedir("GET", "/api/ventas", { tk });
  assert.strictEqual(r.status, 200);
  assert.ok(r.json.length > 0);
  assert.ok(r.json.every((v) => v.sucursal_id === 1));
  DB.admin.usuarios.find((u) => u.id === 3).sucursal_id = 1;
});

test("H8: las coordenadas del GPS las manda el navegador: se entra desde cualquier lado con las de la tienda", async () => {
  const s1 = DB.pos.sucursales.find((s) => s.id === 1);
  s1.lat = 16.9068; s1.lng = -92.0941;
  DB.admin.usuarios.push({
    id: 60, nombre: "Cajera GPS", usuario: "cajeragps", password_hash: await hashearPassword("cajera123"),
    rol_id: 3, sucursal_id: 1, vendedor_id: null, activo: true,
  });
  const lejos = await pedir("POST", "/api/auth/login", { body: { usuario: "cajeragps", password: "cajera123", sucursal_id_seleccionada: 1 } });
  assert.strictEqual(lejos.status, 401); // sin coordenadas, no entra
  const fingida = await pedir("POST", "/api/auth/login", {
    body: { usuario: "cajeragps", password: "cajera123", sucursal_id_seleccionada: 1, lat: 16.9068, lng: -92.0941 },
  });
  assert.strictEqual(fingida.status, 200);
});

test("H9: regla 5 — rutas por :id que todavia leen el selector: el Administrador recibe 404 de lo que ve en la lista", async () => {
  const lista = await pedir("GET", "/api/ventas", { tk: token(1) });
  const deOcosingo = lista.json.find((v) => v.sucursal_id === 1);
  const conSelector = await pedir("GET", `/api/ventas/${deOcosingo.id}?sucursal_id=2`, { tk: token(1) });
  assert.strictEqual(conSelector.status, 404);
  const cliente = await pedir("GET", "/api/clientes/1?sucursal_id=2", { tk: token(1) });
  assert.strictEqual(cliente.status, 404);
});

test("H10: el gerente de una tienda cambia la configuracion de todas y no queda rastro", async () => {
  const r = await pedir("PUT", "/api/configuracion", { tk: token(4), body: { permitir_ventas_sin_existencia: false, campo_inventado: 1 } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(DB.pos.configuracion.permitir_ventas_sin_existencia, false);
  assert.strictEqual(DB.pos.configuracion.campo_inventado, 1); // acepta cualquier llave
  DB.pos.configuracion.permitir_ventas_sin_existencia = true;
  delete DB.pos.configuracion.campo_inventado;
});

test("H11: con ver_predicciones (un permiso de VER) se escribe el historial de ventas que alimenta predicciones", async () => {
  const r = await pedir("POST", "/api/predicciones/historial/aplicar", {
    tk: token(7),
    body: { sucursal_id: 1, agregados: [{ clave: "AB-001", periodo: "2026-01", cantidad: 9999 }] },
  });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  const renglon = DB.pos.historial_ventas_mensual.find((h) => h.producto_id === 1 && h.periodo === "2026-01" && h.sucursal_id === 1);
  assert.strictEqual(renglon.cantidad, 9999);
  assert.deepStrictEqual(Object.keys(renglon).filter((k) => /usuario/i.test(k)), []);
});

test("H12: cambiarle el rol a una persona no deja quien lo hizo", async () => {
  const r = await pedir("PUT", "/api/usuarios/3", { tk: token(1), body: { rol_id: 2 } });
  assert.strictEqual(r.status, 200);
  const u = DB.admin.usuarios.find((x) => x.id === 3);
  assert.deepStrictEqual(Object.keys(u).filter((k) => /historial|modificado|cambiado/i.test(k)), []);
  u.rol_id = 3;
});
