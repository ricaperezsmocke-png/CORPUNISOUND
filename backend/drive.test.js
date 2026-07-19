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

test("asegurarCarpetaRaiz crea la carpeta si no existe y cachea el id", async (t) => {
  let llamada = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    llamada++;
    if (String(url).includes("q=")) {
      // Búsqueda: no la encuentra
      return { ok: true, json: async () => ({ files: [] }) };
    }
    // Creación
    return { ok: true, json: async () => ({ id: "carpeta-raiz-123" }) };
  });
  const DB = { drive: { cuenta: { access_token: "AT1", refresh_token: "RT1", expires_at: Date.now() + 3_600_000 } } };

  const id1 = await asegurarCarpetaRaiz(DB);
  assert.strictEqual(id1, "carpeta-raiz-123");
  assert.strictEqual(DB.drive.carpeta_raiz_id, "carpeta-raiz-123");
  assert.strictEqual(llamada, 2, "debe buscar y luego crear");

  const id2 = await asegurarCarpetaRaiz(DB);
  assert.strictEqual(id2, "carpeta-raiz-123");
  assert.strictEqual(llamada, 2, "la segunda llamada debe reusar el id cacheado, sin llamar a fetch de nuevo");
});

test("asegurarCarpetaRaiz reusa la carpeta si ya existe en Drive", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => {
    assert.ok(String(url).includes("q="), "debe ser una búsqueda, no una creación");
    return { ok: true, json: async () => ({ files: [{ id: "ya-existia-456", name: "Expedientes de Personal" }] }) };
  });
  const DB = { drive: { cuenta: { access_token: "AT1", refresh_token: "RT1", expires_at: Date.now() + 3_600_000 } } };

  const id = await asegurarCarpetaRaiz(DB);
  assert.strictEqual(id, "ya-existia-456");
});

test("asegurarCarpetaEmpleado crea la subcarpeta 'Nombre (usuario)' y la cachea en el objeto usuario", async (t) => {
  let llamada = 0;
  t.mock.method(globalThis, "fetch", async () => {
    llamada++;
    return { ok: true, json: async () => (llamada <= 2 ? { files: [] } : { id: `folder-${llamada}` }) };
  });
  const DB = { drive: { cuenta: { access_token: "AT1", refresh_token: "RT1", expires_at: Date.now() + 3_600_000 } } };
  const usuarioObj = { id: 10, nombre: "Juan Pérez", usuario: "juanp" };

  const id = await asegurarCarpetaEmpleado(DB, usuarioObj);

  assert.ok(id, "debe regresar un id de carpeta");
  assert.strictEqual(usuarioObj.drive_folder_id, id, "debe cachear el id en el propio objeto usuario");
});

test("asegurarCarpetaEmpleado reusa drive_folder_id si ya está en el usuario", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => { throw new Error("no debería llamarse"); });
  const DB = { drive: { cuenta: { access_token: "AT1", refresh_token: "RT1", expires_at: Date.now() + 3_600_000 } } };
  const usuarioObj = { id: 10, nombre: "Juan Pérez", usuario: "juanp", drive_folder_id: "folder-ya-cacheado" };

  const id = await asegurarCarpetaEmpleado(DB, usuarioObj);

  assert.strictEqual(id, "folder-ya-cacheado");
  assert.strictEqual(fetchMock.mock.calls.length, 0);
});

test("subirArchivoADrive sube el archivo con multipart y regresa id + webViewLink", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async (url, opciones) => {
    assert.ok(String(url).includes("uploadType=multipart"));
    assert.strictEqual(opciones.method, "POST");
    assert.ok(opciones.headers["Content-Type"].startsWith("multipart/related; boundary="));
    return { ok: true, json: async () => ({ id: "archivo-789", webViewLink: "https://drive.google.com/file/d/archivo-789/view" }) };
  });
  const DB = { drive: { cuenta: { access_token: "AT1", refresh_token: "RT1", expires_at: Date.now() + 3_600_000 } } };

  const resultado = await subirArchivoADrive(DB, {
    nombre: "INE - ine_frente.jpg",
    mimeType: "image/jpeg",
    contenidoBuffer: Buffer.from("contenido-de-prueba"),
    carpetaId: "carpeta-empleado-1",
  });

  assert.strictEqual(resultado.id, "archivo-789");
  assert.strictEqual(resultado.webViewLink, "https://drive.google.com/file/d/archivo-789/view");
  assert.strictEqual(fetchMock.mock.calls.length, 1);
});

test("subirArchivoADrive lanza error si Drive responde con error", async (t) => {
  t.mock.method(globalThis, "fetch", async () => ({ ok: false, text: async () => "quota exceeded" }));
  const DB = { drive: { cuenta: { access_token: "AT1", refresh_token: "RT1", expires_at: Date.now() + 3_600_000 } } };

  await assert.rejects(
    () => subirArchivoADrive(DB, { nombre: "x.pdf", mimeType: "application/pdf", contenidoBuffer: Buffer.from("x"), carpetaId: "c1" }),
    /Error al subir archivo a Google Drive/
  );
});

test("eliminarArchivoDeDrive borra el archivo sin lanzar error", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async (url, opciones) => {
    assert.ok(String(url).endsWith("/archivo-789"));
    assert.strictEqual(opciones.method, "DELETE");
    return { ok: true };
  });
  const DB = { drive: { cuenta: { access_token: "AT1", refresh_token: "RT1", expires_at: Date.now() + 3_600_000 } } };

  await eliminarArchivoDeDrive(DB, "archivo-789");
  assert.strictEqual(fetchMock.mock.calls.length, 1);
});

test("eliminarArchivoDeDrive NO lanza error si el archivo ya no existe (404)", async (t) => {
  t.mock.method(globalThis, "fetch", async () => ({ ok: false, status: 404, text: async () => "File not found" }));
  const DB = { drive: { cuenta: { access_token: "AT1", refresh_token: "RT1", expires_at: Date.now() + 3_600_000 } } };

  await assert.doesNotReject(() => eliminarArchivoDeDrive(DB, "archivo-que-ya-no-existe"));
});

test("eliminarArchivoDeDrive SÍ lanza error si Drive responde otro código de error", async (t) => {
  t.mock.method(globalThis, "fetch", async () => ({ ok: false, status: 500, text: async () => "server error" }));
  const DB = { drive: { cuenta: { access_token: "AT1", refresh_token: "RT1", expires_at: Date.now() + 3_600_000 } } };

  await assert.rejects(() => eliminarArchivoDeDrive(DB, "archivo-1"), /Error al borrar archivo en Google Drive/);
});
