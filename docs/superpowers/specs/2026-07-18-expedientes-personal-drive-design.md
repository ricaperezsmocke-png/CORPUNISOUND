# Expedientes de Personal en Google Drive — Design

## Contexto

En "Roles y Personal" (`src/AdminRoles.jsx`) ya existe una sub-pestaña "Personal" con una tabla de todo el personal dado de alta y un modal de edición (nombre, rol, sucursal, contraseña, activar/desactivar, eliminar — ver `docs/superpowers/specs/2026-07-17-dashboard-personal-design.md`). Victor quiere poder subir ahí, por empleado, sus documentos de expediente: currículum, acta de nacimiento, comprobante de domicilio, INE y contrato — con posibilidad de varios archivos por categoría (ej. INE frente/reverso, contratos por renovación).

El sistema no tiene hoy ninguna forma de guardar archivos binarios de forma persistente: SQLite (`better-sqlite3`, ver `backend/persistencia.js`) guarda el objeto `DB` completo, y en Render free tier no hay disco persistente — guardar PDFs/fotos ahí los perdería cada vez que el dyno duerme. Por eso los archivos se van a guardar en **Google Drive de la cuenta personal de Victor**, y el sistema solo guarda metadata (nombre, categoría, link) para listarlos/enlazarlos/borrarlos.

Ya existe un precedente idéntico para conectar una cuenta externa vía OAuth: la integración con MercadoLibre (`backend/mercadolibre.js`, rutas `/api/ml/auth-url` y `/api/ml/callback`, tokens guardados en `DB.ml.cuenta` con refresco automático). Este diseño sigue el mismo patrón para Google Drive, usando llamadas REST directas con `fetch` (sin agregar la librería `googleapis`), por consistencia con el código existente y porque el caso de uso (subir archivos pequeños vía multipart, sin necesidad de subida resumible) no lo justifica.

## Objetivo

Permitir que quien tenga el permiso `gestionar_expedientes` suba, vea y borre los documentos de expediente de cualquier empleado (currículum, acta de nacimiento, comprobante de domicilio, INE, contrato — varios archivos por categoría), guardados en la cuenta personal de Google Drive de Victor, organizados en `Expedientes de Personal/{Nombre del empleado} ({usuario})/`. Los empleados no suben sus propios documentos; solo quien tenga el permiso lo hace por ellos.

## Arquitectura

### Conexión con Google Drive (nuevo `backend/drive.js`, calcado de `backend/mercadolibre.js`)

- **Variables de entorno nuevas en Render:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (se crean en Google Cloud Console habilitando la Drive API v3 y configurando la pantalla de consentimiento OAuth con el scope `drive.file`, que solo da acceso a los archivos/carpetas que el propio sistema crea, no a todo el Drive de Victor).
- **Nuevos permisos** en `backend/permisosCatalogo.js`, módulo `admin`:
  - `conectar_cuenta_drive` — "Conectar / Desconectar Google Drive" (implementado: true).
  - `gestionar_expedientes` — "Gestionar Expedientes de Personal" (implementado: true).
- **Estado en memoria/SQLite:** nuevo objeto top-level `DB.drive = { cuenta: null }`, mismo shape que `DB.ml.cuenta` (`access_token`, `refresh_token`, `expires_at`).
- **Flujo OAuth:**
  - `GET /api/drive/estado` (sin permiso especial, solo login) — devuelve `{ configurado: !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET), conectado: !!DB.drive.cuenta }`.
  - `GET /api/drive/auth-url` (permiso `conectar_cuenta_drive`) — arma la URL de autorización de Google con `redirect_uri` = `{host}/api/drive/callback`.
  - `GET /api/drive/callback` (sin permiso, la llama Google directo) — intercambia el `code` por tokens, los guarda en `DB.drive.cuenta`, redirige de vuelta a la pantalla de Roles y Personal con un aviso de éxito.
  - `obtenerAccessTokenValido(DB)` — antes de cualquier llamada a la API de Drive, revisa si `Date.now() > expires_at - 120_000` y si sí, refresca con `refresh_token` (idéntico a `refrescarToken` de `mercadolibre.js`).
- **Carpeta raíz:** `asegurarCarpetaRaiz(DB)` busca (por nombre, vía `files.list` con query `name='Expedientes de Personal' and mimeType='application/vnd.google-apps.folder' and trashed=false`) o crea la carpeta "Expedientes de Personal" en la raíz del Drive conectado, y cachea su `id` en `DB.drive.carpeta_raiz_id` para no repetir la búsqueda en cada subida.
- **Carpeta por empleado:** `asegurarCarpetaEmpleado(DB, usuario)` busca o crea, dentro de la carpeta raíz, la subcarpeta `{nombre} ({usuario})` (ej. `Juan Pérez (juanp)`) y cachea su `id` en el propio registro de `DB.admin.usuarios` (campo nuevo `drive_folder_id`, opcional/undefined hasta la primera subida).

### Documentos por empleado (nuevo `backend/documentosPersonal.js`)

- **Categorías fijas:** `curriculum`, `acta_nacimiento`, `comprobante_domicilio`, `ine`, `contrato`.
- **Nueva colección** `DB.admin.documentos_personal`, cada registro: `{ id, usuario_id, categoria, nombre_archivo, drive_file_id, drive_link, subido_por, fecha }`. El archivo en sí vive solo en Drive — no se guarda ninguna copia en el servidor ni en SQLite.
- **Subida (`POST /api/usuarios/:id/documentos`, permiso `gestionar_expedientes`):** recibe `{ categoria, nombre_archivo, tipo_mime, contenido_base64 }` (mismo patrón que `MigracionDatos.jsx`/`leerArchivoComoBase64`). Valida: `categoria` es una de las 5 válidas, `tipo_mime` es `application/pdf`, `image/jpeg` o `image/png`, y el tamaño decodificado no excede 10 MB. Si todo es válido: asegura la carpeta del empleado, sube el archivo a Drive vía `POST https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart` con nombre `{etiqueta categoría} - {nombre_archivo}` (ej. `INE - ine_frente.jpg`), y solo si Drive confirma éxito crea el registro de metadata (todo o nada — si la subida a Drive falla, no queda metadata huérfana).
- **Listado (`GET /api/usuarios/:id/documentos`, permiso `gestionar_expedientes`):** devuelve los registros de `documentos_personal` para ese `usuario_id`, agrupados por categoría, cada uno con su `drive_link` para abrir en una pestaña nueva.
- **Borrado (`DELETE /api/usuarios/:id/documentos/:documentoId`, permiso `gestionar_expedientes`):** llama a `files.delete` en Drive y borra el registro de metadata. Si Drive responde que el archivo ya no existe (404), se borra igual el registro local (no se deja un registro atorado por un archivo que ya no está) y se avisa al frontend.
- **Fuera de alcance de este diseño:** no se verifica proactivamente si un archivo fue borrado o renombrado por fuera del sistema (directo en Drive) — si eso pasa, el enlace simplemente fallará al abrirse. Es un caso raro (nadie más debería tocar esa carpeta a mano) y no justifica la complejidad de sincronizar en ambas direcciones.

## Interfaz

- **`src/AdminRoles.jsx`, pantalla "Roles y Personal":**
  - Aviso de conexión (visible para quien tenga `conectar_cuenta_drive`): si `!configurado`, instrucciones para dar de alta las credenciales en Google Cloud Console y ponerlas en Render (mismo layout que el bloque equivalente de `MercadoLibre.jsx` cuando `!estado.configurado`); si `configurado && !conectado`, botón "Conectar Google Drive" que llama a `/api/drive/auth-url` y redirige.
  - Modal de editar empleado (ya existente): nueva sección/pestaña "Documentos", visible solo si el usuario logueado tiene `gestionar_expedientes`. Si Drive no está conectado, se muestra "Conecta Google Drive en Roles y Personal para poder subir documentos" en vez de los controles de subida.
  - Dentro de "Documentos": 5 bloques fijos, uno por categoría, cada uno con:
    - Botón "Subir archivo" → selector de archivo (`accept=".pdf,.jpg,.jpeg,.png"`), valida tipo y tamaño (≤10 MB) en el cliente antes de codificar a base64 y mandar.
    - Lista de archivos ya subidos en esa categoría: nombre, fecha, enlace "Abrir en Drive" (`target="_blank"`), botón eliminar (con `confirm()` nativo, mismo patrón que el resto del sistema).

## Flujo de datos

1. Al abrir la pestaña "Documentos" de un empleado, se llama `GET /api/usuarios/:id/documentos` y se pinta la lista agrupada por categoría.
2. Subir archivo → `leerArchivoComoBase64` → `POST /api/usuarios/:id/documentos` → en éxito, refresca la lista de esa categoría y muestra aviso; en error, muestra el mensaje del backend sin cerrar el modal.
3. Eliminar archivo → confirmación → `DELETE /api/usuarios/:id/documentos/:documentoId` → en éxito, quita el archivo de la lista local y avisa.
4. Conectar Google Drive → `GET /api/drive/auth-url` → redirección a Google → `GET /api/drive/callback` → guarda tokens → redirige de vuelta con aviso de éxito, refrescando el estado de conexión en la pantalla.

## Manejo de errores

- Archivo de tipo o tamaño inválido: rechazado en el navegador con aviso claro, nunca llega a mandarse al backend.
- Backend valida tipo/tamaño de nuevo (nunca confiar solo en la validación del cliente) y rechaza con `400` y mensaje claro si no pasa.
- Google Drive no conectado: los endpoints de documentos responden `400` con "Conecta Google Drive primero" si se llaman sin `DB.drive.cuenta`.
- Token de Drive revocado/inválido (el refresh falla): el error de Google se traduce a "Reconecta Google Drive en Roles y Personal".
- Falla de red al subir a Drive: no se crea el registro de metadata; se avisa el error al frontend.
- Falla al borrar en Drive (404, ya no existe): se borra igual el registro de metadata local, se avisa.

## Testing

- Backend (siguiendo el patrón de `usuarios.test.js`/`compras.test.js`, con las llamadas a Google mockeadas vía `fetch` inyectado o `nock`):
  - `backend/drive.test.js`: intercambio de código por tokens, refresco de token cuando expiró, `asegurarCarpetaRaiz`/`asegurarCarpetaEmpleado` reutilizan el id cacheado en vez de volver a buscar/crear.
  - `backend/documentosPersonal.test.js`: sube un documento válido y crea el registro de metadata; rechaza tipo MIME no permitido; rechaza archivo >10 MB; no crea metadata si la subida a Drive falla; lista documentos agrupados por categoría; borra un documento y su metadata; borra la metadata igual si Drive responde 404 al borrar.
  - Rutas: los 5 endpoints nuevos (`estado`, `auth-url`, `callback`, `POST/GET/DELETE documentos`) rechazan sin el permiso correspondiente.
- Frontend: sin harness automatizado en este proyecto — verificación manual en navegador real (Playwright + Chrome del sistema, con la cuenta real de Google de Victor) cubriendo: conectar Drive, subir un archivo por cada una de las 5 categorías, ver la lista, abrir un archivo en Drive, eliminar un archivo, e intentar subir un archivo de tipo/tamaño inválido.

## Fuera de alcance

- Los empleados no tienen ninguna pantalla de autoservicio para subir sus propios documentos — solo quien tenga `gestionar_expedientes` lo hace.
- No se agrega descarga directa del archivo a través del sistema — abrir siempre es vía enlace a Google Drive en pestaña nueva.
- No se sincroniza proactivamente si un archivo/carpeta fue borrado o renombrado por fuera del sistema, directo en Drive.
- No se usa Google Workspace ni cuenta de servicio — todo vive bajo la cuenta personal de Google de Victor, conectada una sola vez vía OAuth.
