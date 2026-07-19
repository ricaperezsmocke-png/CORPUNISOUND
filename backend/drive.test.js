const { test } = require("node:test");
const assert = require("node:assert");
const {
  intercambiarCodigo, urlAutorizacion, tokenActivo,
  asegurarCarpetaRaiz, asegurarCarpetaEmpleado,
  subirArchivoADrive, eliminarArchivoDeDrive,
} = require("./drive");

test("intercambiarCodigo guarda los tokens en DB.drive.cuenta", async (t) => {
  process.env.GOOGLE_CLIENT_ID = "cid-de-prueba";
  process.env.GOOGLE_CLIENT_SECRET = "secret-de-prueba";
  t.mock.method(globalThis, "fetch", async () => ({
    ok: true,
    json: async () => ({ access_token: "AT1", refresh_token: "RT1", expires_in: 3600 }),
  }));

  const DB = { drive: { cuenta: null } };
  const cuenta = await intercambiarCodigo(DB, "codigo123", "http://localhost/api/drive/callback");

  assert.strictEqual(cuenta.access_token, "AT1");
  assert.strictEqual(cuenta.refresh_token, "RT1");
  assert.ok(cuenta.expires_at > Date.now(), "expires_at debe ser un timestamp futuro");
  assert.strictEqual(DB.drive.cuenta, cuenta);
});

test("intercambiarCodigo lanza error si Google responde con error", async (t) => {
  t.mock.method(globalThis, "fetch", async () => ({
    ok: false,
    text: async () => "invalid_grant",
  }));
  const DB = { drive: { cuenta: null } };
  await assert.rejects(() => intercambiarCodigo(DB, "codigo-malo", "http://localhost/callback"), /Google OAuth error/);
});

test("tokenActivo refresca el token cuando ya expiró", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => ({
    ok: true,
    json: async () => ({ access_token: "AT2", expires_in: 3600 }),
  }));
  const DB = { drive: { cuenta: { access_token: "AT_VIEJO", refresh_token: "RT1", expires_at: Date.now() - 1000 } } };

  const token = await tokenActivo(DB);

  assert.strictEqual(token, "AT2");
  assert.strictEqual(DB.drive.cuenta.access_token, "AT2");
  assert.strictEqual(fetchMock.mock.calls.length, 1, "debe haber llamado a refrescar una vez");
});

test("tokenActivo NO refresca si el token sigue vigente", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => { throw new Error("no debería llamarse"); });
  const DB = { drive: { cuenta: { access_token: "AT_VIGENTE", refresh_token: "RT1", expires_at: Date.now() + 3_600_000 } } };

  const token = await tokenActivo(DB);

  assert.strictEqual(token, "AT_VIGENTE");
  assert.strictEqual(fetchMock.mock.calls.length, 0);
});

test("tokenActivo lanza error si no hay cuenta conectada", async () => {
  await assert.rejects(() => tokenActivo({ drive: { cuenta: null } }), /No hay cuenta de Google Drive conectada/);
});
