# Bandeja F4a — Receptor crudo de Gupshup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recibir por HTTPS los eventos de WhatsApp que manda Gupshup y guardarlos tal cual en `lead_eventos_externos`, sin procesarlos, más un resumen sin contenido para verificar qué tipos llegaron.

**Architecture:** Un módulo nuevo `backend/bandeja/gupshupReceptor.js` monta `/api/integraciones/gupshup/:token` en `server.js` ANTES de `express.json` (lee el cuerpo crudo él mismo, molde `registrarAgenteSicar` en `backend/sicarRutas.js`). Guarda una fila por petición con id `sha256:<hash del cuerpo>`. El resumen es una ruta más en `backend/bandejaRutas.js` con el permiso existente `conectar_canales_mensajes`.

**Tech Stack:** Node, Express, better-sqlite3 (conexión `conexionSqlite` de `server.js`), `node:crypto`, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-11-bandeja-gupshup-receptor-design.md` (léelo completo antes de empezar).

## Global Constraints

- Rama `feature/bandeja-gupshup`, worktree `C:\Users\Victor\Desktop\CORPUNISOUND\.claude\worktrees\bandeja-gupshup`, base `3a0d7cc`.
- Sin dependencias nuevas. Sin cambios de esquema (usar columnas existentes de `lead_eventos_externos`).
- Ninguna línea de más de 200 caracteres en `.js`. `npx eslint src backend` con 0 errores. Suite backend 0 fallas.
- Mensajes de commit sin acentos. Staging por rutas explícitas (nunca `git add .`). Sin push, sin merge.
- No tocar `render.yaml`. Token desde `process.env.GUPSHUP_WEBHOOK_TOKEN`; mínimo 32 caracteres o la ruta queda apagada (404).
- Tope de lectura por petición: **1.5 MB = 1,572,864 bytes** (413). Tope de guardado: `Buffer.byteLength(JSON.stringify(texto))` debe ser <= **MAX_SERIALIZADO = 1,900,000**; si no, 413 sin fila. Razón (medida por Codex): el respaldo serializa la fila como JSON, las comillas y barras se duplican, y un JSON de 1,572,864 bytes llegó a 2,359,530 > límite del respaldo 2,031,616 (`backend/sicarRespaldo.js:54-56`). Tope de pendientes sin procesar: **200 MB = 209,715,200 bytes** (suma de `length(payload_json)` de `proveedor='gupshup' AND procesado_en IS NULL`).
- Nunca imprimir en consola el cuerpo, teléfonos ni nombres. El 401 y el 429 NO escriben fila (contador en memoria).
- Toda falla nuestra responde 503 (nunca 4xx). Éxito y duplicado: 200 con cuerpo vacío.

## Nota de entorno (Codex)

`centroLeadsPersistencia.test.js:289` falla SOLO dentro del sandbox de Codex (su proceso hijo arranca sin las banderas `--preserve-symlinks` y da EPERM). Claude la corrió fuera del sandbox el 2026-11-11: 0 fallas. No es regresión: repórtala como ambiental y sigue.

## Review Focus

- Cuerpo con BOM o en UTF-8 con acentos/emoji: se guarda exacto (texto decodificado UTF-8) y el hash es del buffer crudo.
- Petición con `Content-Type` distinto de JSON o sin él: el receptor igual lee el cuerpo crudo (no depende del parser).
- Token en la URL con caracteres extra o distinta longitud: 401 sin lanzar excepción (comparar hashes SHA-256, no los textos).
- Una ruta JSON normal del sistema (`/api/...` con `express.json`) sigue funcionando después de montar el receptor.
- Cliente que corta la conexión a mitad del cuerpo: no deja fila ni excepción sin capturar.

---

### Task 1: Receptor y guardado

**Files:**
- Create: `backend/bandeja/gupshupReceptor.js`
- Modify: `backend/server.js` (junto a la línea ~180, inmediatamente después de `registrarAgenteSicar` y antes de `app.use(express.json(...))`)
- Test: `backend/gupshupReceptor.test.js`

**Interfaces:**
- Produces:
  - `registrarReceptorGupshup(app, { sqlite, disponible, mantenimiento, token, ahora = () => new Date(), avisar = m => console.warn(m) })` — monta GET y POST en `/api/integraciones/gupshup/:token`. `disponible()` → boolean (en server.js: `() => bandejaDisponible()`, que se declara más abajo; el cierre solo se evalúa al llegar una petición). `mantenimiento.estaActivo()` → boolean.
  - `tipoDeEvento(texto: string) -> string` — exportada para pruebas.
  - Constantes exportadas `MAX_CUERPO = 1572864`, `MAX_SERIALIZADO = 1900000`, `MAX_PENDIENTES = 209715200`.

- [ ] **Step 1: Escribir las pruebas que fallan** en `backend/gupshupReceptor.test.js` (patrón: `express()` local + `app.listen(0)` + `fetch`; base SQLite en memoria creada con la migración de `backend/centroLeads/persistencia.js`, copiar cómo la arma `backend/bandejaMensajes.test.js`). Token de prueba de 40 caracteres. Pruebas:
  - `token correcto guarda una fila y responde 200 vacío`: POST cuerpo Meta con `entry[0].changes=[{field:'messages'},{field:'smb_message_echoes'}]` → status 200, texto `''`; una fila con `proveedor='gupshup'`, `identificador_evento_externo` = `'sha256:'+sha256hex(cuerpo)`, `tipo='messages,smb_message_echoes'`, `payload_json` igual al cuerpo, `fuente_id` NULL, `procesado_en` NULL, `recibido_en` ISO.
  - `token incorrecto responde 401 sin fila`; también con token de otra longitud.
  - `sin token configurado o con menos de 32 caracteres responde 404`.
  - `cuerpo identico dos veces guarda una sola fila y responde 200 las dos`.
  - `cuerpo de 1572865 bytes responde 413 sin fila`; `JSON valido de 1000000 bytes se guarda`; `JSON con muchas comillas cuyo JSON.stringify pasa de 1900000 bytes responde 413 sin fila` (aunque mida menos de 1572864).
  - `JSON invalido se guarda con tipo no_json`.
  - `formato v2 usa el type de nivel superior` (`{"app":"x","type":"message","payload":{}}` → `tipo='message'`); objeto sin `entry` ni `type` → `desconocido`; `tipo` se recorta a 200.
  - `mantenimiento activo responde 503 sin fila`; `disponible() false responde 503 sin fila`.
  - `pendientes sobre 200 MB responde 503 sin fila` (sembrar con `MAX_PENDIENTES` inyectable vía opción `maxPendientes` para no escribir 200 MB en la prueba).
  - `mas de N peticiones por minuto responde 429 sin fila` (N inyectable vía opción `limitePorMinuto`).
  - `GET con token correcto 200 vacio; GET con token incorrecto 401`.
  - `cuerpo UTF-8 con emoji y acentos se guarda exacto`.
  - `ruta JSON normal sigue funcionando`: montar receptor y luego `express.json()` + una ruta `POST /api/eco` que regresa `req.body`; un POST JSON a `/api/eco` regresa el objeto.
  - `conexion cortada a mitad del cuerpo no deja fila` (abrir `http.request`, escribir parte, `destroy()`; esperar y contar filas = 0).
  - `ningun aviso de consola contiene el cuerpo`: con `avisar` espía, forzar 503 por tope y 413; ninguna llamada contiene un texto marcador del cuerpo.

- [ ] **Step 2: Correr y ver que fallan**
  Run: `cd backend && node --test gupshupReceptor.test.js` — Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementar `backend/bandeja/gupshupReceptor.js`**
  Lectura de cuerpo crudo con tope (acumular `Buffer`s; al pasar `MAX_CUERPO` responder 413 y dejar de acumular). Autenticación: `timingSafeEqual(sha256(recibido), sha256(configurado))`; token configurado ausente o `< 32` → 404 sin leer cuerpo. Freno en memoria por minuto (ventana fija por minuto; opción `limitePorMinuto`, default 600). Orden: 404 → 401 → 429 → 503 (no disponible / mantenimiento) → leer cuerpo (413) → 413 si serializado > MAX_SERIALIZADO → 503 si pendientes > `maxPendientes` → `INSERT ... ON CONFLICT(proveedor, identificador_evento_externo) DO NOTHING` → 200. `tipoDeEvento`: si JSON con `entry` arreglo, `field` únicos ordenados de todos los `changes` unidos con coma; si no, `type` de nivel superior en texto; si nada, `desconocido`; texto no JSON → `no_json`; recortar a 200. Errores al guardar → 503 y `avisar` con un mensaje fijo sin datos. Contadores de 401/429/413 solo en memoria (puede reutilizar la idea de `crearContadorRechazosSicar`, sin importar el de SICAR).

- [ ] **Step 4: Montar en `backend/server.js`** después de la línea de `registrarAgenteSicar` y antes de `express.json`:
  `registrarReceptorGupshup(app, { sqlite: conexionSqlite, disponible: () => bandejaDisponible(), mantenimiento, token: process.env.GUPSHUP_WEBHOOK_TOKEN });` (si `conexionSqlite` es null, `disponible` devuelve false y responde 503).

- [ ] **Step 5: Correr pruebas del archivo y suite completa**
  Run: `cd backend && node --test gupshupReceptor.test.js` — Expected: PASS. Luego `cd backend && node --test` — Expected: 0 fallas. `npx eslint src backend` — 0 errores.

- [ ] **Step 6: Commit**
  `git add backend/bandeja/gupshupReceptor.js backend/gupshupReceptor.test.js backend/server.js`
  `git commit -m "feat(bandeja): receptor crudo de Gupshup (F4a)"`

### Task 2: Resumen sin contenido y respaldo

**Files:**
- Modify: `backend/bandejaRutas.js` (nueva ruta)
- Test: `backend/bandejaRutas.test.js` (agregar pruebas) y `backend/gupshupReceptor.test.js` (prueba de respaldo)

**Interfaces:**
- Consumes: filas de `lead_eventos_externos` con `proveedor='gupshup'` (Task 1).
- Produces: `GET /api/mensajes/gupshup/resumen` → `{ desde, por_tipo: [{ tipo, eventos }], primera, ultima, sin_procesar, bytes }` de los últimos 7 días (`recibido_en >= ahora - 7 días`). `bytes` = suma de `length(payload_json)`.

- [ ] **Step 1: Pruebas que fallan**
  - `resumen cuenta por tipo y no trae contenido`: sembrar 3 filas gupshup (dos `messages`, una `history`) con texto marcador y un teléfono en `payload_json`; respuesta 200 con `por_tipo` correcto y `JSON.stringify(respuesta)` no contiene el marcador ni el teléfono; una fila de 8 días atrás no cuenta.
  - `resumen exige conectar_canales_mensajes`: usuario con permisos vecinos del módulo (`ver_bandeja`, `responder_mensajes`) → 403; con `conectar_canales_mensajes` → 200.
  - `bandeja no disponible responde 503` (igual que las demás rutas del archivo).
  - En `gupshupReceptor.test.js`: `el evento mas grande aceptado no rompe el respaldo`: guardar un evento cuyo `JSON.stringify` mida justo <= 1900000 bytes (con comillas, el peor caso) y correr la generación del respaldo relacional de `backend/sicarRespaldo.js` como lo hacen sus pruebas existentes (buscar en `backend/*Respaldo*.test.js` el helper que arma la copia); debe terminar sin el error 'excede el tamaño permitido por trozo'.

- [ ] **Step 2: Correr y ver que fallan** — `cd backend && node --test bandejaRutas.test.js gupshupReceptor.test.js` — Expected: FAIL.

- [ ] **Step 3: Implementar la ruta** en `registrarRutasBandeja` con `requiereLogin, permiso("conectar_canales_mensajes")` y el mismo manejo de `disponible` que las demás rutas del archivo. Consulta SQL agregada, sin seleccionar `payload_json` más que dentro de `length(...)`.

- [ ] **Step 4: Correr** — archivos PASS; suite completa 0 fallas; eslint 0 errores.

- [ ] **Step 5: Commit**
  `git add backend/bandejaRutas.js backend/bandejaRutas.test.js backend/gupshupReceptor.test.js`
  `git commit -m "feat(bandeja): resumen sin contenido de eventos Gupshup"`

## Al terminar (no lo hace el implementador)

Revisión independiente por Claude (Codex implementa, no revisa), merge y push por Victor, `GUPSHUP_WEBHOOK_TOKEN` en Render por Victor, `curl` de verificación en producción.
