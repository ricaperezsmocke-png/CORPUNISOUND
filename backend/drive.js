/**
 * drive.js — Integración con la Google Drive API v3 para los expedientes
 * de Personal. Sigue el mismo patrón que mercadolibre.js: llamadas REST
 * directas con fetch, sin la librería googleapis.
 *
 * Variables de entorno requeridas:
 *   GOOGLE_CLIENT_ID     — Client ID de tu app en Google Cloud Console
 *   GOOGLE_CLIENT_SECRET — Client Secret de tu app
 *   GOOGLE_REDIRECT_URI  — URL de callback que se pasa a urlAutorizacion().
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

module.exports = {
  intercambiarCodigo, urlAutorizacion, tokenActivo,
  asegurarCarpetaRaiz, asegurarCarpetaEmpleado,
  subirArchivoADrive, eliminarArchivoDeDrive,
  CARPETA_RAIZ_NOMBRE,
};
