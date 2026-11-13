# Despacho: historial de Gupshup que no se lee + alta de canales solo global (Carril B)

**Rama:** `fix/bandeja-historial` — **worktree:** `C:\Users\Victor\Desktop\CORPUNISOUND\.claude\worktrees\bandeja-historial`
**Commit base:** `f3c93e0` (master, F4b ya en producción). Un solo responsable de escritura: tú.
**Pruebas (obligatorio con estas banderas, el sandbox lo exige):**
`cd backend && node --preserve-symlinks --preserve-symlinks-main --test <archivo>.test.js`
Línea base de los 5 archivos de abajo: 68/68. Al final también `npx eslint src backend` (0 errores).

## Qué pasa en producción (hecho verificado)

Innotec conectó WhatsApp el 2026-11-12. Llegaron 92 paquetes `history` (historial de chats). **4 se procesaron
(1,463 mensajes) y 88 quedaron con `error_procesamiento = 'forma_desconocida'`.** El parser
`backend/bandeja/gupshupFormato.js` lanza `fallo()` ante cualquier campo inesperado en **un solo** mensaje y eso tira
el paquete entero (cientos de mensajes). Además, un crudo con error ya nunca se vuelve a intentar (el procesador
filtra `error_procesamiento IS NULL`), y el resumen solo dice "forma_desconocida" sin decir **dónde**. No sabemos la
forma real que falla y no hay manera de verla: este arreglo debe permitir verla sin exponer datos de clientes.

## Qué construir (4 cosas, TDD: prueba roja primero en cada una)

1. **Ruta del fallo.** `fallo()` debe llevar la ruta del campo que falló, sin valores, p. ej.
   `history[].threads[].messages[].from` (usar `[]` en lugar de índices). Agrega `ruta` al error.
   Mantén `codigo` igual (`forma_desconocida` / `fecha_invalida` / `json_invalido`).

2. **Aislar por mensaje en `history`.** Si un mensaje (o un thread) del historial no se puede normalizar, **no** tira
   el paquete: se omite y se reporta. `traducir` devuelve para ese aviso
   `descartados: [{ ruta, codigo, forma }]` además de `mensajes`. `forma` = esqueleto del objeto que falló:
   solo nombres de claves y tipos (`{ id: 'string', timestamp: 'number', history_context: { status: 'string' } }`),
   profundidad máx. 3, **nunca valores**, y solo claves que cumplan `/^[a-z][a-z0-9_]{0,63}$/` (las demás → `'?'`),
   igual que hace `diagnosticarMedios` en `gupshupResumen.js`. Los campos `messages` y `smb_message_echoes`
   (mensajes en vivo) **se quedan como están**: ahí un fallo sigue marcando el crudo con error.
   Si un paquete de historial queda con **todos** sus mensajes descartados y ninguno válido, sí es error del crudo
   (no se marca procesado en silencio).

3. **Resumen con diagnóstico** (`gupshupResumen.js`, ya relee cada fila):
   - `errores_recientes[]` agrega `ruta` (re-parsear la fila y tomar `e.ruta`; si no hay, `null`).
   - Nuevo `descartados`: agrupado por `ruta`+`codigo` sobre las filas **procesadas**, con `veces` y **una** `forma`
     de ejemplo; máximo 10 grupos, ordenados por `veces` desc. Así se ve qué mensajes del historial se omitieron.
   - Nada de texto libre, teléfonos, nombres ni ids de mensaje en la salida. Prueba que lo demuestre con un payload
     que trae teléfono y texto en los campos rotos.

4. **Reintento y seguridad de canales** (`backend/bandejaRutas.js`):
   - `POST /api/mensajes/gupshup/reintentar` con `requiereLogin`, `permiso('conectar_canales_mensajes')` **y**
     `alcance.verTodas` (si no, 403). Pone `error_procesamiento = NULL` en crudos Gupshup (`FILTRO_CRUDOS`) con
     `procesado_en IS NULL` y error en (`forma_desconocida`, `fecha_invalida`, `error_interno`). Responde
     `{ reintentados: n }`. Es seguro reprocesar: la escritura ya es idempotente por `wamid` (`gupshupProcesador.js:59,113`).
   - `POST /api/mensajes/canales`: exigir `alcance.verTodas` (403 si no), aunque la sucursal sea la propia. Motivo:
     un gerente con el permiso podía ligar primero a su tienda un número ajeno.
   - `POST /api/mensajes/canales/:id/desactivar` (mismo permiso + `verTodas`): `activa = 0`. 404 si no existe.
     Id normalizado con `Number()` (ids pueden llegar como texto). **No** se implementa re-ligar a otra sucursal.

## Archivos autorizados

`backend/bandeja/gupshupFormato.js`, `backend/bandeja/gupshupProcesador.js`, `backend/bandeja/gupshupResumen.js`,
`backend/bandejaRutas.js` y sus pruebas: `backend/bandejaGupshupFormato.test.js`,
`backend/bandejaGupshupProcesador.test.js`, `backend/bandejaGupshupResumen.test.js`, `backend/bandejaRutas.test.js`.
**Prohibido** todo lo demás: `server.js`, `permisosCatalogo.js`, esquema/migraciones, `src/`, `render.yaml`.

## Reglas

- Sin dependencias nuevas. Ninguna línea de más de 200 caracteres. Acentos en código y textos: UTF-8 real
  (revisa que no quede mojibake tipo `Ã³`). Mensajes de commit **sin acentos**.
- Staging por rutas explícitas (nunca `git add .`). Un commit por punto o uno al final; no push, no merge.
- Pruebas de permisos: el rol de prueba debe tener permisos vecinos del módulo `crm`, no `permisos: []`.

## Detente y reporta (no improvises) si

- Necesitas tocar un archivo fuera de la lista, o cambiar el esquema de `lead_eventos_externos`.
- Aislar por mensaje exige cambiar cómo `escritura.mensajes` guarda (no debería).
- Alguna prueba existente tiene que cambiar su expectativa para pasar (dime cuál y por qué).

## Entrega

Lista de commits, conteo de pruebas de los 5 archivos y de eslint, y la salida de `git status --short`.
