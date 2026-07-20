# Escaneo de Factura con IA (Recepción de Compras) — Design

## Contexto

Recepción de Compras (`src/RecepcionCompras.jsx`) ya tiene un flujo de "Imp. XML" (F8): sube un CFDI 4.0, `backend/cfdi.js` lo parsea, y una tabla de confirmación (líneas 703-748) muestra descripción/cantidad/costo por concepto, con un selector para vincular cada uno a un producto del catálogo y una casilla "Confirmar" — nada se agrega a la recepción sin esa confirmación explícita por renglón. `confirmarImportacionXml` (línea 168) construye los renglones finales solo con los conceptos marcados y vinculados.

No todos los proveedores mandan CFDI. Victor quiere poder subir una **foto o PDF** de una factura/nota de remisión en papel y que una IA (Claude, ya integrado en el proyecto vía `@anthropic-ai/sdk` para el Asistente de Negocio en `backend/server.js`) extraiga las líneas automáticamente — cantidad, descripción, costo de compra e IVA — dejando los **márgenes/precios de venta intactos** (se siguen calculando como siempre a partir del % de utilidad ya configurado por producto; la IA nunca los toca, por ser una decisión de negocio volátil que no está en el papel de la factura).

## Objetivo

Agregar un botón "Escanear Factura (IA)" en Recepción de Compras que, dada una foto o PDF, extraiga las líneas de la factura vía Claude y las muestre en la misma tabla de confirmación que ya usa "Imp. XML" — con un control de calidad previo que bloquea por completo la extracción (sin mostrar ninguna tabla) si el documento no se puede leer con confianza razonable.

## Arquitectura

### Backend — nuevo `backend/facturaIA.js`

- `analizarFacturaImagen(archivoBase64, tipoMime)`:
  - Llama a `anthropic.messages.create` con el documento adjunto como bloque de contenido (`type: "image"` para JPG/PNG, `type: "document"` para PDF) y usa **tool use** (mismo mecanismo que ya usa `/api/chat` en `server.js` para forzar salida estructurada) con una herramienta `extraer_factura` cuyo schema exige: `{ legible: boolean, motivo_no_legible: string|null, conceptos: [{ descripcion, cantidad, costo_unitario, aplica_iva }] }`.
  - Si `legible` es `false`, la función lanza un error con `motivo_no_legible` como mensaje — el backend nunca intenta construir una tabla de conceptos en ese caso.
  - Si `legible` es `true`, regresa `{ conceptos }` en la misma forma que ya produce `parsearFacturaXML` para los campos compartidos (`descripcion`, `cantidad`, `costo_unitario` como equivalente a `valor_unitario`, `aplica_iva`), para que el frontend pueda reusar la tabla de confirmación existente sin cambios de forma.
  - **Nota de implementación a verificar primero:** confirmar si `@anthropic-ai/sdk@^0.32.0` (ya instalado) soporta bloques `type: "document"` (PDF) nativamente o si hace falta actualizar la versión del SDK — no se agrega ninguna dependencia nueva, pero puede requerir un bump de versión de una ya existente.

### Backend — nueva ruta en `server.js`

- `POST /api/compras/importar-ia` (permiso `recibir_compra`, el mismo que ya protege toda la pantalla y la ruta de importar XML — no se crea un permiso nuevo).
- Recibe `{ archivo_base64, tipo_mime }` (acepta `application/pdf`, `image/jpeg`, `image/png` — mismo límite de 10 MB que ya se usa en otras subidas del proyecto, ej. expedientes de personal).
- Llama a `analizarFacturaImagen` y responde `{ conceptos }`, o `400` con el `motivo_no_legible` si no es legible.

### Frontend — `src/RecepcionCompras.jsx`

- Nuevo botón de barra "Escanear Factura (IA)" junto a "Imp. XML" (F8) — atajo propio, ej. F9 si está libre (verificar durante la implementación qué atajos ya están tomados en esta pantalla).
- Nuevo modal (mismo patrón que el de Imp. XML): un `<input type="file" accept=".pdf,.jpg,.jpeg,.png">`, lee el archivo como base64 (mismo helper `leerArchivoComoBase64` que ya usan otras pantallas), llama a `/api/compras/importar-ia`.
- Si la respuesta es `400` (no legible): muestra el mensaje de error tal cual (`motivo_no_legible`) en el modal — sin tabla, sin nada que confirmar. El usuario cierra el modal e intenta con otra foto/PDF.
- Si es legible: reusa el **mismo componente/JSX de tabla de confirmación** que ya existe para XML (descripción, cantidad, costo, selector de producto del catálogo, casilla "Confirmar" por renglón) — generalizando el estado (`xmlParseado`/`matchesXml`/`confirmadosXml`/`sugeridosXml`) para que sirva a ambas fuentes (XML e IA), en vez de duplicar la tabla. El campo "Aplica IVA" leído se guarda igual que en el flujo de XML (`aplicaIva: concepto.aplica_iva`).
- Igual que hoy: nada se agrega a la recepción sin que el usuario marque "Confirmar" en cada renglón. Los productos sin match se muestran como "Sin vincular — se ignora" (mismo comportamiento que XML hoy, sin alta automática de producto nuevo).
- Los márgenes/precios de venta de cada producto (`producto.precios`) nunca se leen ni modifican por este flujo — se recalculan como siempre a partir del costo, igual que en cualquier alta manual.

## Flujo de datos

1. Usuario abre "Escanear Factura (IA)" → sube foto/PDF → frontend lo convierte a base64 → `POST /api/compras/importar-ia`.
2. Backend manda el documento a Claude con la herramienta `extraer_factura`.
3. Si `legible: false` → `400` con el motivo → frontend muestra el aviso, sin tabla.
4. Si `legible: true` → frontend recibe `conceptos` → los muestra en la tabla de confirmación compartida con XML → usuario vincula productos y marca "Confirmar" por renglón → "Agregar a la recepción" empuja los renglones confirmados a la tabla principal de la recepción (mismo camino que ya usa `confirmarImportacionXml`).
5. De ahí en adelante, el flujo es idéntico al existente: el usuario puede seguir editando cualquier renglón (botón Editar → modal de Artículo) antes de registrar la recepción final.

## Manejo de errores

- Documento no legible: bloqueo total, mensaje claro, sin tabla parcial (decisión explícita de Victor — todo o nada, no mostrar solo lo que sí se leyó).
- Archivo de tipo/tamaño inválido: rechazado en el navegador antes de mandarlo, mismo patrón que otras subidas del proyecto (PDF/JPG/PNG, tope 10 MB).
- Falla de red o de la API de Anthropic: mensaje de error claro en el modal, el usuario puede reintentar.
- `ANTHROPIC_API_KEY` no configurada: mismo mensaje ya usado en `/api/chat` ("Falta configurar ANTHROPIC_API_KEY...").

## Testing

- Backend: tests de `facturaIA.js` mockeando la respuesta de `anthropic.messages.create` (igual que se mockea `fetch` en otros módulos del proyecto) — casos: documento legible con conceptos correctos, documento no legible (debe lanzar con el motivo), respuesta de Claude sin el tool_use esperado (error claro, no un crash).
- Backend: ruta nueva rechaza sin permiso `recibir_compra` (mismo patrón de test de catálogo de permisos ya usado en el proyecto).
- Frontend: sin harness automatizado (convención ya establecida en este proyecto) — verificación manual en navegador real con una foto real de una factura o nota de remisión, cubriendo: documento legible con varias líneas, documento deliberadamente borroso/ilegible (debe bloquear), producto sin match en catálogo, y confirmar que los precios de venta no cambian.

## Fuera de alcance

- No se da de alta un producto nuevo automáticamente cuando la IA no encuentra match — igual que hoy con XML, la línea queda "sin vincular" y Victor decide manualmente.
- No se automatizan los márgenes/precios de venta — siempre se calculan del % de utilidad ya configurado por producto, nunca de lo que diga la factura.
- No se guarda ninguna copia del archivo subido (imagen/PDF) — se usa solo para la extracción y se descarta, igual que las facturas XML no se archivan hoy.
