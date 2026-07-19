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
