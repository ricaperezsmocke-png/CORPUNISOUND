# Expedientes de Personal en Google Drive — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let anyone with the new `gestionar_expedientes` permission upload, view, and delete each employee's curriculum, birth certificate, proof of address, INE, and contract (multiple files per category) from the "Personal" tab in Roles y Personal — stored in Victor's personal Google Drive under `Expedientes de Personal/{Nombre} ({usuario})/`, with only link metadata kept in the app's own database.

**Architecture:** New backend module `backend/drive.js` talks to the Google Drive REST API v3 directly via `fetch` (OAuth token exchange/refresh, folder search/create, multipart upload, delete) — mirrors the existing `backend/mercadolibre.js` pattern exactly. New backend module `backend/documentosPersonal.js` validates uploads (category, MIME type, 10 MB size cap) and manages the `DB.admin.documentos_personal` metadata array, calling into `drive.js` for the actual Drive operations. `server.js` wires 6 new routes. The frontend (`src/AdminRoles.jsx`) gets a Drive-connection status bar and a "Documentos" tab inside the existing edit-personal modal.

**Tech Stack:** Node.js/Express backend (no new dependencies — raw `fetch` + `Buffer`), `node --test` (Node's built-in test runner) with `t.mock.method` for mocking `fetch` in tests, React 18 frontend (no new dependencies), same base64-over-JSON file transfer pattern already used by Migración de Datos.

## Global Constraints

- No new npm dependencies (no `googleapis`, no `multer`) — Drive REST calls use native `fetch`; files travel from browser to backend as base64 inside JSON, same as `MigracionDatos.jsx`/`ArticuloCompra.jsx`.
- Allowed file types: `application/pdf`, `image/jpeg`, `image/png`. Max size: 10 MB (`10 * 1024 * 1024` bytes) — enforced in both frontend and backend.
- Fixed document categories (no others): `curriculum`, `acta_nacimiento`, `comprobante_domicilio`, `ine`, `contrato`. Multiple files allowed per category.
- Google OAuth scope: `https://www.googleapis.com/auth/drive.file` (the app only ever sees files/folders it creates itself, never Victor's whole Drive).
- New permissions (`conectar_cuenta_drive`, `gestionar_expedientes`) both belong to the **existing** `admin` module in `permisosCatalogo.js` — this is NOT a new module, so `MODULOS_SISTEMA` / `MODULOS_QUE_REQUIEREN_PERMISOS` (`backend/validarPermisos.js`) do **not** need new entries.
- `backend/roles.js` → `reconciliarRoles(DB)` already runs on every server boot and grants every catalog permission to the "Administrador" role automatically — no manual role-seed migration needed for the two new permissions (per `CONVENCION-PERMISOS.md`, item 2 of the checklist is already satisfied by this existing mechanism).
- Project rule: "el frontend oculta, el backend niega" — every new route must carry its own `requierePermiso("clave", resolverPermisosDeRol)`, never borrow another route's permission.
- Employees do not have any self-service screen — only someone with `gestionar_expedientes` uploads on their behalf.
- No proactive sync-check for files/folders deleted or renamed directly in Drive — a stale link simply errors when opened.
- Backend tests run with: `cd backend && npm test` (runs `node --test`, picks up every `*.test.js` file).

---

### Task 1: Register permissions and extend the DB schema

**Files:**
- Modify: `backend/permisosCatalogo.js`
- Modify: `backend/server.js` (DB initial object, ~line 189-199)
- Modify: `backend/testHelpers.js` (~line 75)
- Test: `backend/permisoExpedientesDrive.test.js` (new)

**Interfaces:**
- Produces: two new catalog entries with claves `conectar_cuenta_drive` and `gestionar_expedientes` (both `modulo: "admin"`, `implementado: true`); `DB.drive = { cuenta: null }` (top-level, sibling of `DB.ml`); `DB.admin.documentos_personal = []`.
- Consumes: `listarPermisos()` / `validarSistemaDePermisos()` from the existing `permisosCatalogo.js` / `validarPermisos.js`.

- [ ] **Step 1: Write the failing test**

Create `backend/permisoExpedientesDrive.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { listarPermisos } = require("./permisosCatalogo");
const { validarSistemaDePermisos } = require("./validarPermisos");

test("existe el permiso conectar_cuenta_drive en modulo admin", () => {
  const p = listarPermisos().find((x) => x.clave === "conectar_cuenta_drive");
  assert.ok(p, "el permiso debe existir en el catálogo");
  assert.strictEqual(p.modulo, "admin");
  assert.strictEqual(p.implementado, true);
});

test("existe el permiso gestionar_expedientes en modulo admin", () => {
  const p = listarPermisos().find((x) => x.clave === "gestionar_expedientes");
  assert.ok(p, "el permiso debe existir en el catálogo");
  assert.strictEqual(p.modulo, "admin");
  assert.strictEqual(p.implementado, true);
});

test("el guardia de arranque sigue pasando con los permisos nuevos", () => {
  assert.doesNotThrow(() => validarSistemaDePermisos());
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && node --test permisoExpedientesDrive.test.js`
Expected: FAIL — the first two assertions fail with "el permiso debe existir en el catálogo" (`p` is `undefined`).

- [ ] **Step 3: Add the two permissions to the catalog**

In `backend/permisosCatalogo.js`, inside the `PERMISOS` array, right after the existing `"---- Administración ----"` block (after the `ver_todas_las_sucursales` line, before the `"---- MercadoLibre ----"` comment):

```js
  { clave: "conectar_cuenta_drive", etiqueta: "Conectar / Desconectar Google Drive", modulo: "admin", implementado: true },
  { clave: "gestionar_expedientes", etiqueta: "Gestionar Expedientes de Personal (Google Drive)", modulo: "admin", implementado: true },
```

- [ ] **Step 4: Run the test again to verify the permission checks pass**

Run: `cd backend && node --test permisoExpedientesDrive.test.js`
Expected: PASS (all 3 tests).

- [ ] **Step 5: Extend the DB schema in `server.js`**

In `backend/server.js`, find the `DB` object literal (the one with `admin: { roles: [], usuarios: [], intentos_bloqueados_ubicacion: [] }` followed by `ml: { cuenta: null, ... }`). Change it to:

```js
  admin: {
    roles: [],
    usuarios: [],
    intentos_bloqueados_ubicacion: [],
    documentos_personal: [],
  },
  ml: {
    cuenta: null,
    publicaciones: [],
    ordenes_importadas: [],
  },
  drive: {
    cuenta: null,
  },
```

(Only the `admin` object gains the `documentos_personal: []` field, and a new `drive: { cuenta: null }` top-level key is added right after `ml`. Nothing else in that object changes.)

- [ ] **Step 6: Mirror the same shape in `testHelpers.js`**

In `backend/testHelpers.js`, find the line `admin: { roles: [], usuarios: [] },` inside `construirDBPrueba()` and change it to:

```js
    admin: { roles: [], usuarios: [], documentos_personal: [] },
    drive: { cuenta: null },
```

(Add `drive: { cuenta: null }` as a new top-level key in the returned `DB` object, alongside `admin`.)

- [ ] **Step 7: Run the full backend test suite to confirm nothing broke**

Run: `cd backend && npm test`
Expected: All existing tests still PASS (the schema addition is purely additive — no existing code reads or depends on the absence of these fields).

- [ ] **Step 8: Commit**

```bash
git add backend/permisosCatalogo.js backend/server.js backend/testHelpers.js backend/permisoExpedientesDrive.test.js
git commit -m "feat: register conectar_cuenta_drive and gestionar_expedientes permissions"
```

---

### Task 2: `backend/drive.js` — Google Drive OAuth + folder + upload/delete helpers

**Files:**
- Create: `backend/drive.js`
- Test: `backend/drive.test.js`

**Interfaces:**
- Consumes: `DB.drive.cuenta` / `DB.drive.carpeta_raiz_id` (from Task 1), `process.env.GOOGLE_CLIENT_ID`, `process.env.GOOGLE_CLIENT_SECRET`, global `fetch`.
- Produces (used by Task 3 and Task 4):
  - `intercambiarCodigo(DB, codigo, redirectUri) → Promise<{access_token, refresh_token, expires_at, conectado_en}>`
  - `urlAutorizacion(redirectUri) → string`
  - `tokenActivo(DB) → Promise<string>` (access token, refreshed if needed)
  - `asegurarCarpetaRaiz(DB) → Promise<string>` (folder id)
  - `asegurarCarpetaEmpleado(DB, usuarioObj) → Promise<string>` (folder id; also sets `usuarioObj.drive_folder_id` as a side effect)
  - `subirArchivoADrive(DB, { nombre, mimeType, contenidoBuffer, carpetaId }) → Promise<{id, webViewLink}>`
  - `eliminarArchivoDeDrive(DB, fileId) → Promise<void>` (does not throw on 404 — already-gone is treated as success)

- [ ] **Step 1: Write the failing test for OAuth token exchange**

Create `backend/drive.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test drive.test.js`
Expected: FAIL with `Cannot find module './drive'`.

- [ ] **Step 3: Implement OAuth token exchange, refresh and the authorization URL**

Create `backend/drive.js`:

```js
/**
 * drive.js — Integración con la Google Drive API v3 para los expedientes
 * de Personal. Sigue el mismo patrón que mercadolibre.js: llamadas REST
 * directas con fetch, sin la librería googleapis.
 *
 * Variables de entorno requeridas:
 *   GOOGLE_CLIENT_ID     — Client ID de tu app en Google Cloud Console
 *   GOOGLE_CLIENT_SECRET — Client Secret de tu app
 *   GOOGLE_REDIRECT_URI  — (opcional) URL de callback; si no se define,
 *                          se calcula a partir del host de la petición.
 *
 * El scope usado (drive.file) solo da acceso a los archivos/carpetas que
 * este sistema crea — nunca a todo el Drive de la cuenta conectada.
 */

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_AUTH_URL  = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_SCOPE     = "https://www.googleapis.com/auth/drive.file";
const DRIVE_API        = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/files";

const CARPETA_RAIZ_NOMBRE = "Expedientes de Personal";

async function intercambiarCodigo(DB, codigo, redirectUri) {
  const params = new URLSearchParams({
    grant_type:    "authorization_code",
    client_id:     process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    code:          codigo,
    redirect_uri:  redirectUri,
  });
  const r = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  if (!r.ok) throw new Error("Google OAuth error: " + (await r.text()));
  const d = await r.json();
  DB.drive.cuenta = {
    access_token:  d.access_token,
    refresh_token: d.refresh_token,
    expires_at:    Date.now() + d.expires_in * 1000,
    conectado_en:  new Date().toISOString(),
  };
  return DB.drive.cuenta;
}

async function refrescarToken(DB) {
  if (!DB.drive.cuenta?.refresh_token) throw new Error("Sin cuenta de Google Drive conectada");
  const params = new URLSearchParams({
    grant_type:    "refresh_token",
    client_id:     process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: DB.drive.cuenta.refresh_token,
  });
  const r = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  if (!r.ok) throw new Error("Error al refrescar el token de Google Drive — reconéctalo en Roles y Personal");
  const d = await r.json();
  DB.drive.cuenta.access_token = d.access_token;
  DB.drive.cuenta.expires_at   = Date.now() + d.expires_in * 1000;
  if (d.refresh_token) DB.drive.cuenta.refresh_token = d.refresh_token;
  return DB.drive.cuenta.access_token;
}

async function tokenActivo(DB) {
  if (!DB.drive?.cuenta?.access_token) throw new Error("No hay cuenta de Google Drive conectada");
  if (Date.now() > DB.drive.cuenta.expires_at - 120_000) await refrescarToken(DB);
  return DB.drive.cuenta.access_token;
}

function urlAutorizacion(redirectUri) {
  if (!process.env.GOOGLE_CLIENT_ID) throw new Error("GOOGLE_CLIENT_ID no configurado en variables de entorno");
  const params = new URLSearchParams({
    response_type: "code",
    client_id:     process.env.GOOGLE_CLIENT_ID,
    redirect_uri:  redirectUri,
    scope:         GOOGLE_SCOPE,
    access_type:   "offline",
    prompt:        "consent",
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

module.exports = {
  intercambiarCodigo, urlAutorizacion, tokenActivo,
  CARPETA_RAIZ_NOMBRE,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --test drive.test.js`
Expected: PASS (both OAuth tests).

- [ ] **Step 5: Commit**

```bash
git add backend/drive.js backend/drive.test.js
git commit -m "feat: add Google Drive OAuth token exchange and refresh"
```

- [ ] **Step 6: Write the failing test for token auto-refresh**

Add to `backend/drive.test.js`:

```js
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
```

- [ ] **Step 7: Run tests to verify they pass (refresh logic is already implemented in Step 3)**

Run: `cd backend && node --test drive.test.js`
Expected: PASS (all tests so far).

- [ ] **Step 8: Commit**

```bash
git add backend/drive.test.js
git commit -m "test: cover Google Drive token auto-refresh"
```

- [ ] **Step 9: Write the failing tests for folder search/create helpers**

Add to `backend/drive.test.js`:

```js
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
```

- [ ] **Step 10: Run tests to verify they fail**

Run: `cd backend && node --test drive.test.js`
Expected: FAIL — `asegurarCarpetaRaiz is not a function` / `asegurarCarpetaEmpleado is not a function`.

- [ ] **Step 11: Implement folder search/create helpers**

In `backend/drive.js`, add before `module.exports`:

```js
function driveHeaders(token, extra = {}) {
  return { Authorization: `Bearer ${token}`, ...extra };
}

async function buscarCarpeta(DB, nombre, carpetaPadreId) {
  const token = await tokenActivo(DB);
  const nombreEscapado = nombre.replace(/'/g, "\\'");
  let q = `name='${nombreEscapado}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  if (carpetaPadreId) q += ` and '${carpetaPadreId}' in parents`;
  const r = await fetch(`${DRIVE_API}?q=${encodeURIComponent(q)}&fields=files(id,name)`, {
    headers: driveHeaders(token),
  });
  if (!r.ok) throw new Error("Error al buscar carpeta en Google Drive: " + (await r.text()));
  const data = await r.json();
  return data.files?.[0]?.id || null;
}

async function crearCarpeta(DB, nombre, carpetaPadreId) {
  const token = await tokenActivo(DB);
  const metadata = { name: nombre, mimeType: "application/vnd.google-apps.folder" };
  if (carpetaPadreId) metadata.parents = [carpetaPadreId];
  const r = await fetch(`${DRIVE_API}?fields=id`, {
    method: "POST",
    headers: driveHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify(metadata),
  });
  if (!r.ok) throw new Error("Error al crear carpeta en Google Drive: " + (await r.text()));
  const data = await r.json();
  return data.id;
}

async function asegurarCarpetaRaiz(DB) {
  if (DB.drive.carpeta_raiz_id) return DB.drive.carpeta_raiz_id;
  let id = await buscarCarpeta(DB, CARPETA_RAIZ_NOMBRE, null);
  if (!id) id = await crearCarpeta(DB, CARPETA_RAIZ_NOMBRE, null);
  DB.drive.carpeta_raiz_id = id;
  return id;
}

async function asegurarCarpetaEmpleado(DB, usuarioObj) {
  if (usuarioObj.drive_folder_id) return usuarioObj.drive_folder_id;
  const raizId = await asegurarCarpetaRaiz(DB);
  const nombreCarpeta = `${usuarioObj.nombre} (${usuarioObj.usuario})`;
  let id = await buscarCarpeta(DB, nombreCarpeta, raizId);
  if (!id) id = await crearCarpeta(DB, nombreCarpeta, raizId);
  usuarioObj.drive_folder_id = id;
  return id;
}
```

And update `module.exports` to include `asegurarCarpetaRaiz, asegurarCarpetaEmpleado`.

- [ ] **Step 12: Run tests to verify they pass**

Run: `cd backend && node --test drive.test.js`
Expected: PASS (all tests so far).

- [ ] **Step 13: Commit**

```bash
git add backend/drive.js backend/drive.test.js
git commit -m "feat: add Google Drive folder search/create helpers with caching"
```

- [ ] **Step 14: Write the failing tests for upload and delete**

Add to `backend/drive.test.js`:

```js
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
```

- [ ] **Step 15: Run tests to verify they fail**

Run: `cd backend && node --test drive.test.js`
Expected: FAIL — `subirArchivoADrive is not a function` / `eliminarArchivoDeDrive is not a function`.

- [ ] **Step 16: Implement multipart upload and delete**

In `backend/drive.js`, add before `module.exports`:

```js
async function subirArchivoADrive(DB, { nombre, mimeType, contenidoBuffer, carpetaId }) {
  const token = await tokenActivo(DB);
  const boundary = `unisound_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const metadata = { name: nombre, parents: [carpetaId] };
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelim = `\r\n--${boundary}--`;
  const parteMetadata = delimiter + "Content-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify(metadata);
  const encabezadoMedia = delimiter + `Content-Type: ${mimeType}\r\n\r\n`;
  const body = Buffer.concat([
    Buffer.from(parteMetadata, "utf8"),
    Buffer.from(encabezadoMedia, "utf8"),
    contenidoBuffer,
    Buffer.from(closeDelim, "utf8"),
  ]);

  const r = await fetch(`${DRIVE_UPLOAD_API}?uploadType=multipart&fields=id,webViewLink`, {
    method: "POST",
    headers: driveHeaders(token, { "Content-Type": `multipart/related; boundary=${boundary}` }),
    body,
  });
  if (!r.ok) throw new Error("Error al subir archivo a Google Drive: " + (await r.text()));
  return await r.json();
}

async function eliminarArchivoDeDrive(DB, fileId) {
  const token = await tokenActivo(DB);
  const r = await fetch(`${DRIVE_API}/${fileId}`, {
    method: "DELETE",
    headers: driveHeaders(token),
  });
  if (!r.ok && r.status !== 404) {
    throw new Error("Error al borrar archivo en Google Drive: " + (await r.text()));
  }
}
```

And update `module.exports`:

```js
module.exports = {
  intercambiarCodigo, urlAutorizacion, tokenActivo,
  asegurarCarpetaRaiz, asegurarCarpetaEmpleado,
  subirArchivoADrive, eliminarArchivoDeDrive,
  CARPETA_RAIZ_NOMBRE,
};
```

- [ ] **Step 17: Run tests to verify they pass**

Run: `cd backend && node --test drive.test.js`
Expected: PASS (all tests in the file).

- [ ] **Step 18: Commit**

```bash
git add backend/drive.js backend/drive.test.js
git commit -m "feat: add Google Drive multipart upload and delete helpers"
```

---

### Task 3: `backend/documentosPersonal.js` — validation and metadata orchestration

**Files:**
- Create: `backend/documentosPersonal.js`
- Test: `backend/documentosPersonal.test.js`

**Interfaces:**
- Consumes: `DB.admin.usuarios`, `DB.admin.documentos_personal` (from Task 1); a `drive`-shaped object with async methods `asegurarCarpetaEmpleado(DB, usuarioObj)`, `subirArchivoADrive(DB, {...})`, `eliminarArchivoDeDrive(DB, fileId)` (the real one is `backend/drive.js` from Task 2, but tests pass a fake object — this is why every function here takes `drive` as an explicit parameter instead of `require`-ing `./drive` directly).
- Produces (used by Task 4):
  - `subirDocumento(DB, usuarioId, datos, subidoPorId, drive) → Promise<registro>` where `datos = { categoria, nombre_archivo, tipo_mime, contenido_base64 }`
  - `listarDocumentos(DB, usuarioId) → registro[]`
  - `eliminarDocumento(DB, usuarioId, documentoId, drive) → Promise<{ok: true}>`
  - Exported constants: `CATEGORIAS_VALIDAS`, `ETIQUETAS_CATEGORIA`, `MIME_VALIDOS`, `TAMANO_MAXIMO_BYTES`

- [ ] **Step 1: Write the failing tests**

Create `backend/documentosPersonal.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { subirDocumento, listarDocumentos, eliminarDocumento } = require("./documentosPersonal");

function sembrarEmpleado(DB, overrides = {}) {
  DB.admin.usuarios.push({ id: 10, nombre: "Juan Pérez", usuario: "juanp", rol_id: 1, sucursal_id: 1, activo: true, ...overrides });
}

function driveFalso(overrides = {}) {
  return {
    asegurarCarpetaEmpleado: async () => "carpeta-falsa-1",
    subirArchivoADrive: async () => ({ id: "archivo-falso-1", webViewLink: "https://drive.google.com/file/d/archivo-falso-1/view" }),
    eliminarArchivoDeDrive: async () => {},
    ...overrides,
  };
}

test("subirDocumento rechaza una categoría inválida", async () => {
  const DB = construirDBPrueba();
  sembrarEmpleado(DB);
  await assert.rejects(
    () => subirDocumento(DB, 10, { categoria: "no_existe", nombre_archivo: "x.pdf", tipo_mime: "application/pdf", contenido_base64: "eA==" }, 1, driveFalso()),
    /Categoría de documento inválida/
  );
});

test("subirDocumento rechaza un tipo MIME no permitido", async () => {
  const DB = construirDBPrueba();
  sembrarEmpleado(DB);
  await assert.rejects(
    () => subirDocumento(DB, 10, { categoria: "ine", nombre_archivo: "x.docx", tipo_mime: "application/msword", contenido_base64: "eA==" }, 1, driveFalso()),
    /Tipo de archivo no permitido/
  );
});

test("subirDocumento rechaza un archivo de más de 10 MB", async () => {
  const DB = construirDBPrueba();
  sembrarEmpleado(DB);
  const contenidoGrande = Buffer.alloc(11 * 1024 * 1024, "a").toString("base64");
  await assert.rejects(
    () => subirDocumento(DB, 10, { categoria: "ine", nombre_archivo: "grande.pdf", tipo_mime: "application/pdf", contenido_base64: contenidoGrande }, 1, driveFalso()),
    /no puede pesar más de 10 MB/
  );
});

test("subirDocumento rechaza si el empleado no existe", async () => {
  const DB = construirDBPrueba();
  await assert.rejects(
    () => subirDocumento(DB, 999, { categoria: "ine", nombre_archivo: "x.pdf", tipo_mime: "application/pdf", contenido_base64: "eA==" }, 1, driveFalso()),
    /Empleado no encontrado/
  );
});

test("subirDocumento crea el registro de metadata cuando todo es válido", async () => {
  const DB = construirDBPrueba();
  sembrarEmpleado(DB);

  const registro = await subirDocumento(
    DB, 10,
    { categoria: "ine", nombre_archivo: "ine_frente.jpg", tipo_mime: "image/jpeg", contenido_base64: "eA==" },
    99,
    driveFalso()
  );

  assert.strictEqual(registro.usuario_id, 10);
  assert.strictEqual(registro.categoria, "ine");
  assert.strictEqual(registro.nombre_archivo, "ine_frente.jpg");
  assert.strictEqual(registro.drive_file_id, "archivo-falso-1");
  assert.strictEqual(registro.drive_link, "https://drive.google.com/file/d/archivo-falso-1/view");
  assert.strictEqual(registro.subido_por, 99);
  assert.strictEqual(DB.admin.documentos_personal.length, 1);
});

test("subirDocumento NO crea metadata si la subida a Drive falla", async () => {
  const DB = construirDBPrueba();
  sembrarEmpleado(DB);
  const driveQueFalla = driveFalso({ subirArchivoADrive: async () => { throw new Error("Google Drive no responde"); } });

  await assert.rejects(
    () => subirDocumento(DB, 10, { categoria: "contrato", nombre_archivo: "c.pdf", tipo_mime: "application/pdf", contenido_base64: "eA==" }, 1, driveQueFalla),
    /Google Drive no responde/
  );
  assert.strictEqual(DB.admin.documentos_personal.length, 0, "no debe quedar metadata huérfana");
});

test("listarDocumentos regresa solo los documentos de ese empleado", async () => {
  const DB = construirDBPrueba();
  sembrarEmpleado(DB, { id: 10 });
  sembrarEmpleado(DB, { id: 11, usuario: "otro" });
  await subirDocumento(DB, 10, { categoria: "ine", nombre_archivo: "a.jpg", tipo_mime: "image/jpeg", contenido_base64: "eA==" }, 1, driveFalso());
  await subirDocumento(DB, 11, { categoria: "ine", nombre_archivo: "b.jpg", tipo_mime: "image/jpeg", contenido_base64: "eA==" }, 1, driveFalso());

  const docs = listarDocumentos(DB, 10);

  assert.strictEqual(docs.length, 1);
  assert.strictEqual(docs[0].nombre_archivo, "a.jpg");
});

test("eliminarDocumento borra el registro y llama a drive.eliminarArchivoDeDrive", async () => {
  const DB = construirDBPrueba();
  sembrarEmpleado(DB);
  const registro = await subirDocumento(DB, 10, { categoria: "curriculum", nombre_archivo: "cv.pdf", tipo_mime: "application/pdf", contenido_base64: "eA==" }, 1, driveFalso());
  let llamadoCon = null;
  const drive = driveFalso({ eliminarArchivoDeDrive: async (_DB, fileId) => { llamadoCon = fileId; } });

  const resultado = await eliminarDocumento(DB, 10, registro.id, drive);

  assert.deepStrictEqual(resultado, { ok: true });
  assert.strictEqual(llamadoCon, "archivo-falso-1");
  assert.strictEqual(DB.admin.documentos_personal.length, 0);
});

test("eliminarDocumento lanza error si el documento no existe para ese empleado", async () => {
  const DB = construirDBPrueba();
  sembrarEmpleado(DB);
  await assert.rejects(() => eliminarDocumento(DB, 10, 999, driveFalso()), /Documento no encontrado/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && node --test documentosPersonal.test.js`
Expected: FAIL with `Cannot find module './documentosPersonal'`.

- [ ] **Step 3: Implement `backend/documentosPersonal.js`**

```js
/**
 * documentosPersonal.js — Expedientes de Personal (curriculum, acta de
 * nacimiento, comprobante de domicilio, INE, contrato) guardados en
 * Google Drive. Este módulo solo valida y orquesta; las llamadas reales
 * a Drive se reciben como parámetro `drive` (ver backend/drive.js) para
 * poder probar esta lógica sin llamar a la API real de Google.
 */

const CATEGORIAS_VALIDAS = ["curriculum", "acta_nacimiento", "comprobante_domicilio", "ine", "contrato"];

const ETIQUETAS_CATEGORIA = {
  curriculum: "Curriculum",
  acta_nacimiento: "Acta de Nacimiento",
  comprobante_domicilio: "Comprobante de Domicilio",
  ine: "INE",
  contrato: "Contrato",
};

const MIME_VALIDOS = ["application/pdf", "image/jpeg", "image/png"];
const TAMANO_MAXIMO_BYTES = 10 * 1024 * 1024;

function siguienteId(lista) {
  return lista.length ? Math.max(...lista.map((x) => x.id)) + 1 : 1;
}

async function subirDocumento(DB, usuarioId, datos, subidoPorId, drive) {
  const { categoria, nombre_archivo, tipo_mime, contenido_base64 } = datos;

  if (!CATEGORIAS_VALIDAS.includes(categoria)) throw new Error("Categoría de documento inválida");
  if (!MIME_VALIDOS.includes(tipo_mime)) throw new Error("Tipo de archivo no permitido — solo PDF, JPG o PNG");

  const buffer = Buffer.from(contenido_base64, "base64");
  if (buffer.length > TAMANO_MAXIMO_BYTES) throw new Error("El archivo no puede pesar más de 10 MB");

  const usuario = DB.admin.usuarios.find((u) => u.id === Number(usuarioId));
  if (!usuario) throw new Error("Empleado no encontrado");

  const carpetaId = await drive.asegurarCarpetaEmpleado(DB, usuario);
  const nombreEnDrive = `${ETIQUETAS_CATEGORIA[categoria]} - ${nombre_archivo}`;
  const subido = await drive.subirArchivoADrive(DB, { nombre: nombreEnDrive, mimeType: tipo_mime, contenidoBuffer: buffer, carpetaId });

  const registro = {
    id: siguienteId(DB.admin.documentos_personal),
    usuario_id: Number(usuarioId),
    categoria,
    nombre_archivo,
    drive_file_id: subido.id,
    drive_link: subido.webViewLink,
    subido_por: subidoPorId,
    fecha: new Date().toISOString(),
  };
  DB.admin.documentos_personal.push(registro);
  return registro;
}

function listarDocumentos(DB, usuarioId) {
  return DB.admin.documentos_personal.filter((d) => d.usuario_id === Number(usuarioId));
}

async function eliminarDocumento(DB, usuarioId, documentoId, drive) {
  const idx = DB.admin.documentos_personal.findIndex(
    (d) => d.id === Number(documentoId) && d.usuario_id === Number(usuarioId)
  );
  if (idx === -1) throw new Error("Documento no encontrado");
  const doc = DB.admin.documentos_personal[idx];
  await drive.eliminarArchivoDeDrive(DB, doc.drive_file_id);
  DB.admin.documentos_personal.splice(idx, 1);
  return { ok: true };
}

module.exports = {
  subirDocumento, listarDocumentos, eliminarDocumento,
  CATEGORIAS_VALIDAS, ETIQUETAS_CATEGORIA, MIME_VALIDOS, TAMANO_MAXIMO_BYTES,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && node --test documentosPersonal.test.js`
Expected: PASS (all tests).

- [ ] **Step 5: Run the full backend test suite**

Run: `cd backend && npm test`
Expected: All tests PASS (Task 1 + Task 2 + Task 3 combined).

- [ ] **Step 6: Commit**

```bash
git add backend/documentosPersonal.js backend/documentosPersonal.test.js
git commit -m "feat: add documentosPersonal validation and metadata orchestration"
```

---

### Task 4: Wire the routes into `server.js`

**Files:**
- Modify: `backend/server.js` (requires block ~line 16-56, routes ~line 658-666)

**Interfaces:**
- Consumes: `drive` module (Task 2, imported as a namespace object), `subirDocumento`/`listarDocumentos`/`eliminarDocumento` (Task 3), existing `requiereLogin`, `requierePermiso`, `resolverPermisosDeRol`, `guardar`, `DB`.
- Produces: `GET /api/drive/estado`, `GET /api/drive/auth-url`, `GET /api/drive/callback`, `POST /api/usuarios/:id/documentos`, `GET /api/usuarios/:id/documentos`, `DELETE /api/usuarios/:id/documentos/:documentoId`.

- [ ] **Step 1: Add the requires**

In `backend/server.js`, right after the existing block that ends with:

```js
const {
  intercambiarCodigo, urlAutorizacion, listarPublicaciones,
  publicarProducto, actualizarStockML, actualizarPublicacion,
  listarOrdenes, importarOrdenComoVenta,
} = require("./mercadolibre");
```

add:

```js
const drive = require("./drive");
const { subirDocumento, listarDocumentos, eliminarDocumento } = require("./documentosPersonal");
```

- [ ] **Step 2: Add the routes**

In `backend/server.js`, find the end of the "Usuarios / personal" section — right after this existing block:

```js
app.delete("/api/usuarios/:id", requiereLogin, requierePermiso("administrar_roles", resolverPermisosDeRol), (req, res) => {
  try {
    if (esAccionSobreSiMismo(req.params.id, req.usuarioToken.id)) {
      throw new Error("No puedes eliminarte a ti mismo mientras tienes la sesión abierta");
    }
    res.json(eliminarUsuario(DB, req.params.id));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
```

and right before the `// ---------- Clientes ----------` comment, insert:

```js
// ---------- Expedientes de Personal (Google Drive) ----------

app.get("/api/drive/estado", requiereLogin, (req, res) => {
  const c = DB.drive.cuenta;
  res.json({
    conectado:    !!c?.access_token,
    configurado:  !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    conectado_en: c?.conectado_en || null,
  });
});

app.get("/api/drive/auth-url", requiereLogin, requierePermiso("conectar_cuenta_drive", resolverPermisosDeRol), (req, res) => {
  try {
    const redirect = process.env.GOOGLE_REDIRECT_URI ||
      `${req.protocol}://${req.get("host")}/api/drive/callback`;
    res.json({ url: drive.urlAutorizacion(redirect) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get("/api/drive/callback", async (req, res) => {
  const { code } = req.query;
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
  if (!code) return res.redirect(`${frontendUrl}?drive=error&msg=sin_codigo`);
  const redirect = process.env.GOOGLE_REDIRECT_URI ||
    `${req.protocol}://${req.get("host")}/api/drive/callback`;
  try {
    await drive.intercambiarCodigo(DB, code, redirect);
    guardar(DB);
    res.redirect(`${frontendUrl}?drive=conectado`);
  } catch (e) {
    res.redirect(`${frontendUrl}?drive=error&msg=${encodeURIComponent(e.message)}`);
  }
});

app.post("/api/usuarios/:id/documentos", requiereLogin, requierePermiso("gestionar_expedientes", resolverPermisosDeRol), async (req, res) => {
  try {
    if (!DB.drive.cuenta) throw new Error("Conecta Google Drive primero");
    res.json(await subirDocumento(DB, req.params.id, req.body, req.usuarioToken.id, drive));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get("/api/usuarios/:id/documentos", requiereLogin, requierePermiso("gestionar_expedientes", resolverPermisosDeRol), (req, res) => {
  res.json(listarDocumentos(DB, req.params.id));
});

app.delete("/api/usuarios/:id/documentos/:documentoId", requiereLogin, requierePermiso("gestionar_expedientes", resolverPermisosDeRol), async (req, res) => {
  try {
    if (!DB.drive.cuenta) throw new Error("Conecta Google Drive primero");
    res.json(await eliminarDocumento(DB, req.params.id, req.params.documentoId, drive));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
```

- [ ] **Step 3: Run the full backend test suite**

Run: `cd backend && npm test`
Expected: All tests PASS (route wiring doesn't have its own test file in this codebase — no route ever does, per existing convention — but this confirms nothing else broke).

- [ ] **Step 4: Start the server locally to confirm the permissions guard boots cleanly**

Run: `cd backend && node server.js` (with a valid `.env` — `ANTHROPIC_API_KEY` and `JWT_SECRET` at minimum; `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` can be left unset for now)
Expected: Console prints `✓ Sistema de permisos validado: ...` and the server starts listening — no "ARRANQUE BLOQUEADO" error. Stop the server with Ctrl+C once confirmed.

- [ ] **Step 5: Commit**

```bash
git add backend/server.js
git commit -m "feat: wire Google Drive OAuth and expediente document routes"
```

---

### Task 5: Frontend — Google Drive connection status in `AdminRoles.jsx`

**Files:**
- Modify: `src/AdminRoles.jsx`

**Interfaces:**
- Consumes: `GET /api/drive/estado`, `GET /api/drive/auth-url` (Task 4), existing `apiFetch` from `./api`, existing `puede()` helper, existing `mostrarAviso()`.
- Produces: `estadoDrive` state (read by Task 6 to gate the Documentos tab content).

- [ ] **Step 1: Add new icon imports**

In `src/AdminRoles.jsx`, change the top import:

```js
import {
  Plus, Edit3, RefreshCw, Trash2, Copy, Share2, Download,
  Search, ShieldCheck, UserPlus, X, Check, MapPin, ShieldAlert
} from "lucide-react";
```

to:

```js
import {
  Plus, Edit3, RefreshCw, Trash2, Copy, Share2, Download,
  Search, ShieldCheck, UserPlus, X, Check, MapPin, ShieldAlert,
  Link, CheckCircle, AlertTriangle, Upload, FileText
} from "lucide-react";
```

- [ ] **Step 2: Add `estadoDrive` state**

Right after the line `const [sucursales, setSucursales] = useState([]);` (inside `AdminRoles`), add:

```js
  const [estadoDrive, setEstadoDrive] = useState(null);
```

- [ ] **Step 3: Load Drive status inside `cargarTodo`**

Change `cargarTodo` from:

```js
  const cargarTodo = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const [rRoles, rCatalogo, rUsuarios, rSucursales] = await Promise.all([
        apiFetch("/roles"),
        apiFetch("/permisos-catalogo"),
        apiFetch("/usuarios"),
        apiFetch("/sucursales"),
      ]);
      if (!rRoles.ok) throw new Error("No se pudieron cargar los roles");
      const roles = await rRoles.json();
      setRoles(roles);
      setRolActivoId((prev) => prev ?? roles[0]?.id ?? null);
      if (rCatalogo.ok) setCatalogo(await rCatalogo.json());
      if (rUsuarios.ok) setUsuarios(await rUsuarios.json());
      if (rSucursales.ok) setSucursales(await rSucursales.json());
    } catch (e) {
      setError("No se pudo conectar con el backend, o tu usuario no tiene permiso para administrar roles.");
    } finally {
      setCargando(false);
    }
  }, []);
```

to:

```js
  const cargarTodo = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const [rRoles, rCatalogo, rUsuarios, rSucursales, rDrive] = await Promise.all([
        apiFetch("/roles"),
        apiFetch("/permisos-catalogo"),
        apiFetch("/usuarios"),
        apiFetch("/sucursales"),
        apiFetch("/drive/estado"),
      ]);
      if (!rRoles.ok) throw new Error("No se pudieron cargar los roles");
      const roles = await rRoles.json();
      setRoles(roles);
      setRolActivoId((prev) => prev ?? roles[0]?.id ?? null);
      if (rCatalogo.ok) setCatalogo(await rCatalogo.json());
      if (rUsuarios.ok) setUsuarios(await rUsuarios.json());
      if (rSucursales.ok) setSucursales(await rSucursales.json());
      if (rDrive.ok) setEstadoDrive(await rDrive.json());
    } catch (e) {
      setError("No se pudo conectar con el backend, o tu usuario no tiene permiso para administrar roles.");
    } finally {
      setCargando(false);
    }
  }, []);
```

- [ ] **Step 4: Detect `?drive=conectado`/`?drive=error` on return from OAuth**

Right after the `useEffect(() => { cargarTodo(); }, [cargarTodo]);` line, add:

```js
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("drive") === "conectado") {
      mostrarAviso("✅ Google Drive conectado correctamente");
      window.history.replaceState({}, "", window.location.pathname);
      cargarTodo();
    } else if (params.get("drive") === "error") {
      mostrarAviso("❌ Error al conectar Google Drive: " + (params.get("msg") || "desconocido"));
      window.history.replaceState({}, "", window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

- [ ] **Step 5: Add the `conectarDrive` function**

Right after the `eliminarPersonal` function definition (before the `return (`), add:

```js
  const conectarDrive = async () => {
    const r = await apiFetch("/drive/auth-url");
    if (!r.ok) { const d = await r.json(); return mostrarAviso("❌ " + d.error); }
    const { url } = await r.json();
    window.location.href = url;
  };
```

- [ ] **Step 6: Render the Drive status bar**

In the JSX, right after the toolbar `<div className="bg-white border-b border-slate-100 flex overflow-x-auto shrink-0">...</div>` block that contains the `BotonBarra` buttons and the "Dar de alta personal" button (it closes right before the line `{error && <div className="bg-red-50 ...`), insert:

```jsx
          {puede("conectar_cuenta_drive") && (
            <div className="bg-white border-b border-slate-100 flex items-center gap-2 px-4 py-2 shrink-0">
              <span className="text-xs text-slate-500">Google Drive (expedientes de personal):</span>
              {estadoDrive?.conectado ? (
                <span className="flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1">
                  <CheckCircle size={12} /> Conectado
                </span>
              ) : !estadoDrive?.configurado ? (
                <span className="flex items-center gap-1.5 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                  <AlertTriangle size={12} /> GOOGLE_CLIENT_ID no configurado en el backend
                </span>
              ) : (
                <button onClick={conectarDrive} className="flex items-center gap-1.5 text-xs bg-blue-700 hover:bg-blue-800 text-white rounded px-3 py-1.5 font-medium">
                  <Link size={12} /> Conectar Google Drive
                </button>
              )}
            </div>
          )}
```

(This sits inside the `{vistaAdmin === "roles" && (<>...</>)}` block, as a sibling right after the toolbar `<div>` and before `{error && ...}`.)

- [ ] **Step 7: Manual verification (no real Google credentials needed for this step)**

Run the backend (`cd backend && node server.js`, without `GOOGLE_CLIENT_ID` set) and the frontend (`npm run dev` from the repo root). Log in, go to Roles y Personal.
Expected: with a role that has `conectar_cuenta_drive`, the bar shows "GOOGLE_CLIENT_ID no configurado en el backend" (amber). Now set `GOOGLE_CLIENT_ID=cualquier-valor` and `GOOGLE_CLIENT_SECRET=cualquier-valor` in `backend/.env`, restart the backend, reload the page: the bar now shows a blue "Conectar Google Drive" button instead (clicking it will redirect to Google and fail without real credentials — that's expected at this step; full real-account verification happens in Task 7).

- [ ] **Step 8: Commit**

```bash
git add src/AdminRoles.jsx
git commit -m "feat: add Google Drive connection status bar to Roles y Personal"
```

---

### Task 6: Frontend — "Documentos" tab in the edit-personal modal

**Files:**
- Modify: `src/AdminRoles.jsx`

**Interfaces:**
- Consumes: `GET/POST/DELETE /api/usuarios/:id/documentos(/:documentoId)` (Task 4), `estadoDrive` (Task 5), `puede("gestionar_expedientes")`.

- [ ] **Step 1: Add the fixed categories constant and the base64 file reader helper**

Right after the `MOTIVO_TEXTO` constant near the top of the file, add:

```js
const CATEGORIAS_DOCUMENTO = [
  { id: "curriculum", etiqueta: "Curriculum" },
  { id: "acta_nacimiento", etiqueta: "Acta de Nacimiento" },
  { id: "comprobante_domicilio", etiqueta: "Comprobante de Domicilio" },
  { id: "ine", etiqueta: "INE" },
  { id: "contrato", etiqueta: "Contrato" },
];
const TIPOS_ARCHIVO_PERMITIDOS = ["application/pdf", "image/jpeg", "image/png"];
const TAMANO_MAXIMO_BYTES = 10 * 1024 * 1024;

function leerArchivoComoBase64(archivo) {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(String(lector.result).split(",")[1]);
    lector.onerror = reject;
    lector.readAsDataURL(archivo);
  });
}
```

- [ ] **Step 2: Add new state for the Documentos tab**

Right after `const [formEditarPersonal, setFormEditarPersonal] = useState(...)`, add:

```js
  const [tabPersonaEditando, setTabPersonaEditando] = useState("datos"); // "datos" | "documentos"
  const [documentosPersona, setDocumentosPersona] = useState([]);
  const [cargandoDocumentos, setCargandoDocumentos] = useState(false);
```

- [ ] **Step 3: Reset the new state when opening the edit modal**

Change `abrirEditarPersonal` from:

```js
  const abrirEditarPersonal = (u) => {
    setPersonaEditando(u);
    setFormEditarPersonal({ nombre: u.nombre, rol_id: u.rol_id, password: "", sucursal_id: u.sucursal_id });
  };
```

to:

```js
  const abrirEditarPersonal = (u) => {
    setPersonaEditando(u);
    setFormEditarPersonal({ nombre: u.nombre, rol_id: u.rol_id, password: "", sucursal_id: u.sucursal_id });
    setTabPersonaEditando("datos");
    setDocumentosPersona([]);
  };
```

- [ ] **Step 4: Add the document loading/upload/delete functions**

Right after `eliminarPersonal` (and before `conectarDrive`, added in Task 5), add:

```js
  const cargarDocumentosPersona = useCallback(async (usuarioId) => {
    setCargandoDocumentos(true);
    try {
      const r = await apiFetch(`/usuarios/${usuarioId}/documentos`);
      if (r.ok) setDocumentosPersona(await r.json());
    } catch { /* silencioso */ }
    finally { setCargandoDocumentos(false); }
  }, []);

  const subirDocumentoPersona = async (categoria, archivo) => {
    if (!TIPOS_ARCHIVO_PERMITIDOS.includes(archivo.type)) {
      return mostrarAviso("❌ Solo se permiten archivos PDF, JPG o PNG");
    }
    if (archivo.size > TAMANO_MAXIMO_BYTES) {
      return mostrarAviso("❌ El archivo no puede pesar más de 10 MB");
    }
    try {
      const contenido_base64 = await leerArchivoComoBase64(archivo);
      const r = await apiFetch(`/usuarios/${personaEditando.id}/documentos`, {
        method: "POST",
        body: JSON.stringify({ categoria, nombre_archivo: archivo.name, tipo_mime: archivo.type, contenido_base64 }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      mostrarAviso("Documento subido");
      await cargarDocumentosPersona(personaEditando.id);
    } catch (e) { mostrarAviso("❌ " + e.message); }
  };

  const eliminarDocumentoPersona = async (documentoId) => {
    if (!confirm("¿Eliminar este documento? También se borra de Google Drive.")) return;
    try {
      const r = await apiFetch(`/usuarios/${personaEditando.id}/documentos/${documentoId}`, { method: "DELETE" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      mostrarAviso("Documento eliminado");
      await cargarDocumentosPersona(personaEditando.id);
    } catch (e) { mostrarAviso("❌ " + e.message); }
  };
```

- [ ] **Step 5: Load documents when the Documentos tab is opened**

Right after the `useEffect(() => { cargarTodo(); }, [cargarTodo]);` line (and its sibling added in Task 5 Step 4), add:

```js
  useEffect(() => {
    if (personaEditando && tabPersonaEditando === "documentos") {
      cargarDocumentosPersona(personaEditando.id);
    }
  }, [personaEditando, tabPersonaEditando, cargarDocumentosPersona]);
```

- [ ] **Step 6: Restructure the edit-personal modal with tabs and a scrolling body**

Replace the entire `{personaEditando && (...)}` block (the modal that currently has `max-w-sm` and directly renders the Datos form) with:

```jsx
      {personaEditando && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[92vh] flex flex-col overflow-hidden">
            <div className="border-b border-slate-100 px-4 py-3 flex items-center justify-between shrink-0">
              <h3 className="font-semibold text-sm text-slate-700">Editar personal — {personaEditando.nombre}</h3>
              <button onClick={() => setPersonaEditando(null)} className="hover:bg-slate-100 rounded-lg p-1.5 text-slate-400 transition-colors"><X size={16} /></button>
            </div>

            <div className="flex border-b border-slate-100 shrink-0">
              <button
                onClick={() => setTabPersonaEditando("datos")}
                className={`px-4 py-2 text-xs font-medium border-b-2 ${tabPersonaEditando === "datos" ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500"}`}
              >
                Datos
              </button>
              {puede("gestionar_expedientes") && (
                <button
                  onClick={() => setTabPersonaEditando("documentos")}
                  className={`px-4 py-2 text-xs font-medium border-b-2 ${tabPersonaEditando === "documentos" ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500"}`}
                >
                  Documentos
                </button>
              )}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-4">
              {tabPersonaEditando === "datos" ? (
                <div className="flex flex-col gap-3">
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">Nombre completo</label>
                    <input className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm" value={formEditarPersonal.nombre} onChange={(e) => setFormEditarPersonal({ ...formEditarPersonal, nombre: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">Rol</label>
                    <select className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm" value={formEditarPersonal.rol_id} onChange={(e) => setFormEditarPersonal({ ...formEditarPersonal, rol_id: e.target.value })}>
                      {roles.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">Sucursal</label>
                    <select className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm" value={formEditarPersonal.sucursal_id} onChange={(e) => setFormEditarPersonal({ ...formEditarPersonal, sucursal_id: e.target.value })}>
                      {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">Nueva contraseña (opcional — déjalo en blanco para no cambiarla)</label>
                    <input type="password" className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm" value={formEditarPersonal.password} onChange={(e) => setFormEditarPersonal({ ...formEditarPersonal, password: e.target.value })} placeholder="Mínimo 6 caracteres" />
                  </div>
                  <button onClick={guardarEdicionPersonal} className="bg-[#1a7fe8] hover:bg-[#1262b8] text-white py-2 rounded-lg font-semibold flex items-center justify-center gap-1.5 transition-colors">
                    <Check size={15} /> Guardar cambios
                  </button>
                  {usuario?.id !== personaEditando.id && (
                    <div className="flex gap-2">
                      <button onClick={alternarActivoPersonal} className="flex-1 border border-slate-300 hover:bg-slate-50 text-slate-700 py-2 rounded-lg font-semibold text-sm transition-colors">
                        {personaEditando.activo ? "Desactivar" : "Activar"}
                      </button>
                      <button onClick={eliminarPersonal} className="flex-1 border border-red-300 hover:bg-red-50 text-red-600 py-2 rounded-lg font-semibold text-sm transition-colors">
                        Eliminar
                      </button>
                    </div>
                  )}
                  {usuario?.id === personaEditando.id && (
                    <p className="text-[11px] text-slate-400 text-center">No puedes desactivarte o eliminarte a ti mismo mientras tienes la sesión abierta.</p>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  {!estadoDrive?.conectado ? (
                    <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                      Conecta Google Drive en la parte de arriba de Roles y Personal para poder subir documentos.
                    </p>
                  ) : cargandoDocumentos ? (
                    <p className="text-center text-slate-400 py-8 text-sm">Cargando...</p>
                  ) : (
                    CATEGORIAS_DOCUMENTO.map((cat) => {
                      const archivos = documentosPersona.filter((d) => d.categoria === cat.id);
                      return (
                        <div key={cat.id} className="border border-slate-200 rounded-lg p-3">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-semibold text-slate-600">{cat.etiqueta}</span>
                            <label className="flex items-center gap-1 text-xs text-blue-700 hover:text-blue-800 cursor-pointer font-medium">
                              <Upload size={13} /> Subir
                              <input
                                type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden"
                                onChange={(e) => { if (e.target.files[0]) subirDocumentoPersona(cat.id, e.target.files[0]); e.target.value = ""; }}
                              />
                            </label>
                          </div>
                          {archivos.length === 0 ? (
                            <p className="text-[11px] text-slate-400">Sin archivos subidos</p>
                          ) : (
                            <ul className="flex flex-col gap-1">
                              {archivos.map((d) => (
                                <li key={d.id} className="flex items-center justify-between text-xs bg-slate-50 rounded px-2 py-1.5">
                                  <a href={d.drive_link} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-blue-700 hover:underline truncate">
                                    <FileText size={12} /> {d.nombre_archivo}
                                  </a>
                                  <button onClick={() => eliminarDocumentoPersona(d.id)} className="text-slate-400 hover:text-red-600 shrink-0 ml-2">
                                    <Trash2 size={13} />
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 7: Manual verification**

With the backend and frontend running (`GOOGLE_CLIENT_ID`/`SECRET` can still be dummy values at this step), log in with a role that has both `administrar_roles` and `gestionar_expedientes`, go to Roles y Personal → Personal, click any employee row.
Expected: the modal opens at `max-w-lg`, shows "Datos"/"Documentos" tabs, the modal never overflows the viewport (scrolls internally if content is tall), and switching to "Documentos" shows the amber "Conecta Google Drive..." message (since Drive isn't really connected without real credentials) instead of the 5 upload blocks. With a role that lacks `gestionar_expedientes`, the "Documentos" tab button must not appear at all.

- [ ] **Step 8: Commit**

```bash
git add src/AdminRoles.jsx
git commit -m "feat: add Documentos tab (upload/list/delete) to the edit-personal modal"
```

---

### Task 7: Real Google Cloud setup, Render env vars, and end-to-end verification

This task has no code changes — it is the manual setup Victor must do once, plus the one verification that can only happen with his real Google account (per the spec's Testing section: "no hay forma de probar el OAuth real de Google en un entorno automatizado").

- [ ] **Step 1: Create the Google Cloud OAuth credentials**

In [Google Cloud Console](https://console.cloud.google.com/): create (or reuse) a project → enable the "Google Drive API" → configure the OAuth consent screen (External, or Internal if using Workspace) → create an OAuth 2.0 Client ID of type "Web application" → add authorized redirect URI `https://punto-de-venta-backend.onrender.com/api/drive/callback`.

- [ ] **Step 2: Add the env vars in Render**

In the Render dashboard, on the `punto-de-venta-backend` service, add environment variables `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` with the values from Step 1 (same manual process already used for `ML_CLIENT_ID`/`ML_CLIENT_SECRET` — these are not declared in `render.yaml`, consistent with how the MercadoLibre credentials are handled today). Redeploy/restart the service so it picks up the new env vars.

- [ ] **Step 3: Connect the real account and verify the full flow**

With Victor logged in as a role with `conectar_cuenta_drive`, go to Roles y Personal, click "Conectar Google Drive", complete Google's consent screen with Victor's real account, confirm redirect back shows "✅ Google Drive conectado correctamente" and the status bar now shows "Conectado".

- [ ] **Step 4: Verify uploads for all 5 categories**

Open any employee's edit modal → Documentos tab. For each of the 5 categories (Curriculum, Acta de Nacimiento, Comprobante de Domicilio, INE, Contrato), upload one small test file (a PDF or a phone photo). Confirm each appears in the list with its file name, and that opening `Expedientes de Personal` in Victor's actual Google Drive shows the subfolder `{Nombre} ({usuario})` containing all 5 files correctly named `{Categoría} - {nombre original}`.

- [ ] **Step 5: Verify delete and invalid-file rejection**

Delete one uploaded document from the list — confirm it disappears from both the app and Victor's Drive. Attempt to upload a `.docx` file and a file larger than 10 MB — confirm both are rejected with a clear message before anything is sent to Drive.

- [ ] **Step 6: Verify permission gating with a limited role**

Using (or temporarily creating) a role without `gestionar_expedientes`, confirm the "Documentos" tab does not appear in the edit-personal modal. Using a role without `conectar_cuenta_drive`, confirm the Google Drive status bar does not appear at all in Roles y Personal.
