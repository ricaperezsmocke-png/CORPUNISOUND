# Gastos de Garantía — Diseño

**Fecha:** 2026-07-28
**Estado:** Aprobado por Victor, listo para plan de implementación.

## Objetivo

Permitir registrar los **gastos** asociados a una garantía (costo de traslado/envío, costo de reparación, u otros), cada uno con su **monto** y un **comprobante opcional** (PDF/JPG/PNG) que se guarda en Google Drive — igual que los Expedientes de Personal. Ver el total por garantía y, en una segunda fase, un reporte de gastos de garantías por periodo/sucursal/tipo.

## Contexto

- El módulo de Garantías (`backend/garantias.js`, `src/Garantias.jsx`) ya existe y está en producción. Máquina de estados: `registrada → enviada → resuelta → en_tienda_pendiente_entrega → cerrada`. Cada garantía guarda `sucursal_origen_id` (el dato que nunca se pierde) y una bitácora `DB.inventario.garantia_movimientos`.
- Hoy el único costo que se captura es `costo_resolucion` (un monto en el paso de Resolución, solo para reparado/reemplazo/cambio_componente). **Este campo se elimina** (ver abajo); el costo de reparación pasa a ser un gasto tipo "Reparación".
- La subida de archivos a Google Drive ya funciona en producción para los Expedientes de Personal: `backend/drive.js` (OAuth `drive.file`, carpeta raíz + subcarpeta por empleado) + `backend/documentosPersonal.js` (valida MIME y tamaño, orquesta). El frontend sube en base64 (`src/AdminRoles.jsx`: `leerArchivoComoBase64`, `type="file"` accept `.pdf,.jpg,.png`, 10MB máx). **Victor confirmó que ya conectó la cuenta de Google y sube documentos sin error en producción** — la conexión persiste en `DB.drive.cuenta` (SQLite).

## Requisito previo

Google Drive debe estar conectado (misma conexión que los Expedientes de Personal). Ya está satisfecho en producción. En local, sin `GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI` ni cuenta conectada, la subida de comprobante fallará con un error claro, pero registrar un gasto **sin** comprobante debe seguir funcionando (el comprobante es opcional).

## Restricciones globales

- El comprobante es **opcional**: se puede registrar un gasto solo con monto, y adjuntar el papel después (como otro gasto, o dejándolo sin comprobante). El monto es **obligatorio** y debe ser un número > 0.
- Toda operación sobre gastos valida `dentroDeAlcance(garantia.sucursal_origen_id, alcance)` **antes de actuar** (mismo guard `buscarConGuardia` que ya usa `garantias.js`) — un usuario amarrado a una sucursal no puede ver ni tocar gastos de garantías de otra tienda.
- Permiso: se reutiliza `gestionar_garantias` (módulo `inventario`) para agregar/borrar/listar gastos. El reporte usa el permiso existente `ver_reportes`.
- No se agregan dependencias nuevas (ni backend ni frontend). La subida reutiliza `drive.js` y el patrón base64 del frontend.
- El backend mantiene su suite `node --test` completa en verde después de cada tarea.
- Frontend sin arnés de pruebas automáticas (convención del repo): verificación manual en navegador.

## Modelo de datos

Nueva colección `DB.inventario.garantia_gastos` (paralela a `garantia_movimientos`). Cada registro:

```js
{
  id,                 // autoincremental
  garantia_id,        // FK a la garantía
  tipo,               // "traslado" | "reparacion" | "otro"
  monto,              // number > 0
  descripcion,        // texto opcional ("" si no)
  // Comprobante en Drive (los tres null si no se adjuntó archivo):
  nombre_archivo,     // p. ej. "factura-sensey.pdf" | null
  drive_file_id,      // id del archivo en Drive | null
  drive_link,         // webViewLink | null
  usuario,            // nombre de quien lo registró
  fecha,              // ISO
}
```

Se agrega `garantia_gastos: []` al seed de `DB.inventario` en `backend/server.js` y en `backend/testHelpers.js` (mismo lugar donde se agregaron `garantias`/`garantia_movimientos`).

Opcional para la carpeta de Drive: la garantía puede ganar `drive_folder_id` (cacheado, como `usuario.drive_folder_id` en Expedientes).

## Backend

### Nuevo módulo `backend/garantiasGastos.js`

Funciones planas que reciben `DB` (mismo patrón que `garantias.js`/`apartados.js`). Reciben `drive` como parámetro (como `documentosPersonal.js`) para poder probar sin llamar a la API real.

- `agregarGasto(DB, garantiaId, datos, usuario, alcance, drive)` → gasto creado.
  - `datos = { tipo, monto, descripcion?, archivo? }` donde `archivo = { nombre_archivo, tipo_mime, contenido_base64 }` (opcional).
  - Valida: garantía existe y en alcance (`buscarConGuardia`), `tipo` ∈ {traslado, reparacion, otro}, `monto` numérico > 0.
  - Si viene `archivo`: valida MIME (PDF/JPG/PNG) y tamaño (≤10MB), asegura la carpeta de la garantía en Drive y sube el archivo; guarda `drive_file_id`/`drive_link`/`nombre_archivo`. Si no viene archivo, esos tres quedan `null`.
  - Empuja un movimiento a la bitácora (`tipo: "gasto"`, descripción tipo `"Gasto de traslado: $150.00 — <descripción>"`) y actualiza `fecha_ultimo_movimiento` de la garantía.
- `listarGastos(DB, garantiaId, alcance)` → arreglo de gastos de esa garantía (con guard de alcance).
- `eliminarGasto(DB, garantiaId, gastoId, usuario, alcance, drive)` → `{ ok: true }`.
  - Guard de alcance. Si el gasto tiene `drive_file_id`, borra el archivo de Drive (tolerando 404). Quita el registro. Empuja un movimiento `"gasto_eliminado"` a la bitácora.
- `totalGastos(DB, garantiaId)` → suma de `monto` de los gastos de la garantía (helper para enriquecer el listado).

`listarGarantias` (en `garantias.js`) se enriquece para incluir `total_gastos` por garantía (suma de `garantia_gastos`).

### Carpeta de Drive para garantías

En `backend/drive.js` se generaliza el manejo de carpetas para no acoplarlo a "Expedientes de Personal":
- Nueva constante `CARPETA_GARANTIAS_NOMBRE = "Comprobantes de Garantías"`.
- `asegurarCarpetaGarantias(DB)` → asegura la carpeta raíz de garantías (busca/crea, cachea `DB.drive.carpeta_garantias_id`).
- `asegurarCarpetaGarantia(DB, garantia)` → asegura la subcarpeta de la garantía (nombre = `folio`, p. ej. "G-0001"), cachea `garantia.drive_folder_id`.
- Se reutilizan `subirArchivoADrive` y `eliminarArchivoDeDrive` tal cual.

### Eliminación de `costo_resolucion`

- En `registrarResolucion` (`garantias.js`) se deja de leer/escribir `costo_resolucion`; el modal de Resolución ya no pide costo. El campo se retira del objeto garantía (los datos actuales son solo la garantía de prueba G-0001, así que no hay migración real; se ajustan los tests que lo referenciaban). La bitácora de resolución ya no incluye el texto de costo.
- El costo de reparación se captura ahora como un gasto tipo "reparacion".

### Rutas Express nuevas (`server.js`), todas con `requierePermiso("gestionar_garantias", ...)`

- `GET  /api/garantias/:id/gastos` → `listarGastos`.
- `POST /api/garantias/:id/gastos` → `agregarGasto` (recibe `tipo`, `monto`, `descripcion`, y opcionalmente `nombre_archivo`/`tipo_mime`/`contenido_base64`). Se le pasa el módulo `drive`.
- `DELETE /api/garantias/:id/gastos/:gastoId` → `eliminarGasto`.

## Frontend (`src/Garantias.jsx`)

- Botón nuevo **"Gastos"** por fila (junto a "Historial"), visible con permiso `gestionar_garantias`.
- Modal **"Gastos — G-XXXX"**:
  - Encabezado con el **total** de gastos.
  - Lista de gastos: tipo (etiqueta), monto, descripción, y el comprobante (link "Ver" que abre `drive_link` en pestaña nueva si existe), con botón de borrar por renglón.
  - Formulario "Agregar gasto": `<select>` de tipo (Traslado / Reparación / Otro), input de monto, input de descripción (opcional), e input de archivo (`type="file"` accept `.pdf,.jpg,.png`, opcional). Al enviar, si hay archivo se lee a base64 (mismo helper que `AdminRoles.jsx`) y se manda en el POST.
  - Mismas reglas de modal del proyecto (max-h + scroll interno + footer visible).
- El modal de **Resolución** pierde el campo de costo y su nota asociada.
- La columna/acción de "Gastos" no cambia la máquina de estados; se puede registrar un gasto en cualquier estado de la garantía.

## Reporte (Fase 2)

Reporte **"Gastos de Garantías"** en la pantalla de Reportes (`src/reportes/`), con el permiso existente `ver_reportes`:
- Filtros: rango de fechas y sucursal (respetando el alcance del usuario).
- Muestra el total gastado y el desglose por **tipo** (traslado/reparación/otro) y por **sucursal**, con la lista de gastos (folio de garantía, producto, tipo, monto, fecha, link al comprobante).
- Backend: función en `backend/reportes.js` que recorre `DB.inventario.garantia_gastos` cruzando con las garantías (para sucursal/producto) y aplica el alcance.

## Seguridad

- Todas las rutas de gastos exigen login + `gestionar_garantias`.
- El guard `dentroDeAlcance(garantia.sucursal_origen_id, alcance)` se aplica en cada función mutadora y en el listado (mismo criterio 404 que el resto de garantías: si está fuera de alcance, "Garantía no encontrada", sin revelar que existe en otra sucursal).
- MIME y tamaño de archivo validados en el backend (no confiar solo en el `accept` del frontend). Scope de Drive `drive.file` (solo toca lo que el sistema crea).

## Pruebas

- Backend (`backend/garantiasGastos.test.js`, `node --test`), con un `drive` de prueba (stub) inyectado:
  - Agregar gasto sin archivo (monto obligatorio, tipo válido, aparece en la bitácora, suma al total).
  - Agregar gasto con archivo (llama al stub de Drive, guarda `drive_file_id`/`link`).
  - Rechazos: tipo inválido, monto ≤ 0 o no numérico, MIME no permitido, archivo > 10MB, garantía fuera de alcance.
  - Listar respeta el alcance; total correcto.
  - Eliminar borra el archivo de Drive (stub) y el registro; guard de alcance.
  - Ajustar los tests de `garantias.test.js` que referenciaban `costo_resolucion`.
- Frontend: verificación manual en navegador (registrar gasto con y sin comprobante, ver total, borrar, y confirmar que Resolución ya no pide costo).

## Orden de construcción

- **Fase 1:** modelo + `garantiasGastos.js` + carpeta de Drive + rutas + quitar `costo_resolucion` + modal de Gastos en el frontend. Entregable usable de punta a punta.
- **Fase 2:** el reporte de Gastos de Garantías.

## Fuera de alcance (YAGNI)

- Editar un gasto ya registrado (se borra y se vuelve a agregar).
- Categorías de gasto configurables (los tres tipos son fijos).
- Conversión de la garantía de prueba existente (no hay datos reales de `costo_resolucion` que migrar).
- Integración de los gastos con el Corte de Caja (los gastos de garantía no son movimientos de caja).
