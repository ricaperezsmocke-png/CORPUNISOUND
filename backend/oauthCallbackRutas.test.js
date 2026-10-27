/**
 * oauthCallbackRutas.test.js — Google Drive y MercadoLibre solo se conectan con
 * el `state` de quien apretó "Conectar" (auditoría de permisos 2026-10, A2).
 *
 * La reproducción H2/H2b mostraba que `GET /api/drive/callback?code=...` y
 * `GET /api/ml/callback?code=...` no pedían sesión ni `state`: cualquiera en
 * internet reemplazaba la cuenta del negocio. Aquí se exige lo contrario,
 * contra las rutas REALES, simulando solo la respuesta de Google y de ML.
 */

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "oauth-state-")), "datos.sqlite");
process.env.JWT_SECRET = process.env.JWT_SECRET || "secreto-de-pruebas";
process.env.GOOGLE_CLIENT_ID = "google-id-de-prueba";
process.env.GOOGLE_CLIENT_SECRET = "google-secreto";
process.env.ML_CLIENT_ID = "ml-id-de-prueba";
process.env.ML_CLIENT_SECRET = "ml-secreto";

const app = require("./server");
const { sembrarCuentas } = require("./testHelpers");
const { firmarToken } = require("./auth");
const { crearRol } = require("./roles");

const DB = app.DB;
let servidor = null, base = "", fetchOriginal = null;
let TK_ADMIN = "", TK_GERENTE = "";

before(async () => {
  // Un gerente con los permisos de conectar y sus vecinos del módulo, pero
  // amarrado a una tienda: sin `ver_todas_las_sucursales`.
  const rol = crearRol(DB, {
    nombre: "Gerente que conecta",
    permisos: ["conectar_cuenta_drive", "conectar_cuenta_ml", "importar_ordenes_ml", "gestionar_publicaciones_ml"],
    modulos: ["admin", "ml"],
  });
  sembrarCuentas(app, [
    { id: 81, rol_id: 1, sucursal_id: 1, nombre: "Victor" },
    { id: 82, rol_id: rol.id, sucursal_id: 2, nombre: "Gerente Yajalón" },
  ]);
  TK_ADMIN = firmarToken({ id: 81, nombre: "Victor", rol_id: 1, sucursal_id: 1 });
  TK_GERENTE = firmarToken({ id: 82, nombre: "Gerente Yajalón", rol_id: rol.id, sucursal_id: 2 });

  fetchOriginal = global.fetch;
  global.fetch = async (url, opciones) => {
    const u = String(url);
    if (u.startsWith("https://oauth2.googleapis.com")) {
      return new Response(JSON.stringify({ access_token: "token-nuevo", refresh_token: "r2", expires_in: 3600 }));
    }
    if (u.includes("api.mercadolibre.com/oauth/token")) {
      return new Response(JSON.stringify({ access_token: "ml-nuevo", refresh_token: "x", user_id: 999, expires_in: 3600 }));
    }
    return fetchOriginal(url, opciones);
  };
  await new Promise((listo) => { servidor = app.listen(0, listo); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(async () => {
  global.fetch = fetchOriginal;
  if (servidor) await new Promise((listo) => servidor.close(listo));
});

beforeEach(() => {
  DB.drive.cuenta = { access_token: "token-del-negocio", refresh_token: "r", expires_at: Date.now() + 3600e3 };
  DB.ml.cuenta = { access_token: "ml-del-negocio", user_id: 111, expires_at: Date.now() + 3600e3 };
});

async function pedir(metodo, ruta, tk) {
  const r = await fetchOriginal(base + ruta, {
    method: metodo,
    redirect: "manual",
    headers: tk ? { Authorization: `Bearer ${tk}` } : {},
  });
  const texto = await r.text();
  let json = null;
  try { json = JSON.parse(texto); } catch { /* redirección */ }
  return { status: r.status, json, location: r.headers.get("location") || "" };
}

async function stateDe(proveedor, tk = TK_ADMIN) {
  const r = await pedir("GET", `/api/${proveedor}/auth-url`, tk);
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  const state = new URL(r.json.url).searchParams.get("state");
  assert.ok(state, "la URL de autorización lleva state");
  return state;
}

test("Drive: callback sin state no cambia la cuenta (H2 invertida)", async () => {
  const r = await pedir("GET", "/api/drive/callback?code=codigo-de-otra-cuenta");
  assert.strictEqual(r.status, 302);
  assert.match(r.location, /drive=error&msg=estado_invalido/);
  assert.strictEqual(DB.drive.cuenta.access_token, "token-del-negocio");
});

test("ML: callback sin state no cambia la cuenta (H2b invertida)", async () => {
  const r = await pedir("GET", "/api/ml/callback?code=codigo-ajeno");
  assert.strictEqual(r.status, 302);
  assert.match(r.location, /ml=error&msg=estado_invalido/);
  assert.strictEqual(DB.ml.cuenta.user_id, 111);
});

test("Drive: state inventado se rechaza", async () => {
  const r = await pedir("GET", `/api/drive/callback?code=c&state=${"a".repeat(64)}`);
  assert.match(r.location, /drive=error&msg=estado_invalido/);
  assert.strictEqual(DB.drive.cuenta.access_token, "token-del-negocio");
});

test("Drive: con state válido se conecta y queda quién conectó", async () => {
  const state = await stateDe("drive");
  const r = await pedir("GET", `/api/drive/callback?code=bueno&state=${state}`);
  assert.match(r.location, /drive=conectado/);
  assert.strictEqual(DB.drive.cuenta.access_token, "token-nuevo");
  assert.strictEqual(DB.drive.cuenta.conectado_por_id, 81);
  assert.strictEqual(DB.drive.cuenta.conectado_por_nombre, "Victor");
  assert.ok(DB.drive.cuenta.conectado_en);
});

test("Drive: el state es de un solo uso", async () => {
  const state = await stateDe("drive");
  await pedir("GET", `/api/drive/callback?code=bueno&state=${state}`);
  DB.drive.cuenta = { access_token: "token-del-negocio", refresh_token: "r", expires_at: Date.now() + 3600e3 };
  const r = await pedir("GET", `/api/drive/callback?code=otra&state=${state}`);
  assert.match(r.location, /drive=error&msg=estado_invalido/);
  assert.strictEqual(DB.drive.cuenta.access_token, "token-del-negocio");
});

test("un state de Drive no sirve para MercadoLibre", async () => {
  const state = await stateDe("drive");
  const r = await pedir("GET", `/api/ml/callback?code=c&state=${state}`);
  assert.match(r.location, /ml=error&msg=estado_invalido/);
  assert.strictEqual(DB.ml.cuenta.user_id, 111);
});

test("ML: con state válido se conecta y queda quién conectó", async () => {
  const state = await stateDe("ml");
  const r = await pedir("GET", `/api/ml/callback?code=bueno&state=${state}`);
  assert.match(r.location, /ml=conectado/);
  assert.strictEqual(DB.ml.cuenta.user_id, 999);
  assert.strictEqual(DB.ml.cuenta.conectado_por_id, 81);
  assert.strictEqual(DB.ml.cuenta.conectado_por_nombre, "Victor");
});

test("Drive: state vencido se rechaza", async (t) => {
  const state = await stateDe("drive");
  const ahoraReal = Date.now;
  t.after(() => { Date.now = ahoraReal; });
  Date.now = () => ahoraReal() + 11 * 60 * 1000;
  const r = await pedir("GET", `/api/drive/callback?code=bueno&state=${state}`);
  Date.now = ahoraReal;
  assert.match(r.location, /drive=error&msg=estado_invalido/);
  assert.strictEqual(DB.drive.cuenta.access_token, "token-del-negocio");
});

test("auth-url sin alcance global → 403 (Drive y ML)", async () => {
  assert.strictEqual((await pedir("GET", "/api/drive/auth-url", TK_GERENTE)).status, 403);
  assert.strictEqual((await pedir("GET", "/api/ml/auth-url", TK_GERENTE)).status, 403);
});

test("desconectar ML sin alcance global → 403 y la cuenta sigue", async () => {
  const r = await pedir("DELETE", "/api/ml/desconectar", TK_GERENTE);
  assert.strictEqual(r.status, 403);
  assert.strictEqual(DB.ml.cuenta.user_id, 111);
});

test("desconectar ML con alcance global guarda quién desconectó", async () => {
  const r = await pedir("DELETE", "/api/ml/desconectar", TK_ADMIN);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(DB.ml.cuenta, null);
  assert.strictEqual(DB.ml.ultima_desconexion.por_id, 81);
  assert.strictEqual(DB.ml.ultima_desconexion.por_nombre, "Victor");
});
