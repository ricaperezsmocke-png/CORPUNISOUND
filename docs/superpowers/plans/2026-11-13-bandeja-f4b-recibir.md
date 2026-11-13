# Bandeja F4b (recibir y ver) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Procesar los eventos crudos de Gupshup (Meta v3) guardados por el receptor F4a y mostrarlos en la Bandeja del CRM, sin enviar nada.

**Architecture:** Un traductor puro (`gupshupFormato.js`) convierte un crudo en mensajes/contactos normalizados. Un procesador
(`gupshupProcesador.js`) los inserta por trozos en las tablas `lead_*` existentes (sin esquema nuevo; origen en
`lead_interacciones.tipo`), creando clientes faltantes en lote. Un ciclo en `server.js` lo corre cada 60 s. Ajustes en
`mensajes.js`, `consultas.js`, `bandejaRutas.js`, `server.js` y el hilo de la Bandeja.

**Tech Stack:** Node, better-sqlite3, Express, React; pruebas con `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-12-bandeja-f4b-recibir-design.md` (commit 374526e). Léelo entero: las Reglas 1-13 son
obligatorias y este plan no las repite todas.

## Global Constraints

- Rama `feature/bandeja-f4b`, worktree `C:\Users\Victor\Desktop\CORPUNISOUND\.claude\worktrees\bandeja-f4b`, base 374526e.
- Sin dependencias nuevas. Sin cambios de esquema (ni tablas, ni columnas, ni versión de la bandeja, ni `sicarRespaldo.js`).
- Líneas ≤ 200 caracteres en `.js`/`.jsx`. `cd backend && node --test` 0 fallas; `npx eslint src backend` 0 errores.
- Commits sin acentos, `git add` por rutas explícitas (nunca `git add .`). No push, no merge.
- No tocar `agente-sicar/`, `render.yaml`. El receptor (`gupshupReceptor.js`) solo para el tope cacheado (Regla 12).
- Secretos, URLs externas y texto de respuestas externas nunca en logs, `error_procesamiento` ni respuestas HTTP.
- Fechas completas en ISO UTC. `timestamp` de Meta = segundos Unix en texto.
- Pruebas: patrón `prepararBandeja` de `backend/bandejaTestHelpers.js`; verificar que cada prueba nueva falla antes de implementar.
- Si un campo de Meta/Gupshup no es como dice el spec, o una regla choca con el código: **detenerse y reportar**, no improvisar.
- El worktree necesita, para correr la suite: copiar `node_modules`, `backend/node_modules`, `backend/.env`, `backend/datos.sqlite`
  desde `C:\Users\Victor\Desktop\CORPUNISOUND` (robocopy). Si la sandbox no deja commitear (`index.lock`), dejar los cambios sin
  commitear y reportarlo.

## Review Focus

- Mismo `wamid` en vivo y en historial (o reintento) → un solo mensaje; placeholder de historial seguido del contenido → se actualiza, no se duplica.
- Historial con miles de mensajes y cientos de números nuevos → sin tramo síncrono > ~200 ms y un solo alta de clientes por trozo.
- Mensajes del historial no cambian estados, `leads.ultima_interaccion_en`, ni lo que lee `cicloEstadosCRM`.
- Crudo malformado o con un carácter de control → solo ese crudo (o ningún) en error; los demás siguen.
- Envío desde el CRM en conversación de canal gupshup → 409 en el servidor, no solo en pantalla.

---

### Task 1: Traductor de payloads Meta v3

**Files:**
- Create: `backend/bandeja/gupshupFormato.js`
- Test: `backend/bandejaGupshupFormato.test.js`

**Interfaces:**
- Produces: `extraerDeCrudo(payloadTexto: string) -> { avisos: Aviso[] }`, donde cada `Aviso` es uno de:
  - `{ clase: 'mensajes', phoneNumberId: string, mensajes: Msg[] }`
  - `{ clase: 'contactos', phoneNumberId: string, contactos: { wa_id: string, nombre: string|null, accion: 'add'|'remove' }[] }`
  - `{ clase: 'ignorado', motivo: string }` (statuses, account_update, security, fase/progreso de historial, historial rechazado 2593109 con motivo `historial_rechazado`)
  - `Msg = { wamid, wa_id, direccion: 'entrante'|'saliente', origen: 'vivo'|'telefono'|'historial', ocurrido_en: ISO, texto, nombre: string|null, placeholder: boolean }`
  - JSON inválido, `timestamp` inválido o forma desconocida dentro de un campo conocido → lanza `Error` con `codigo` corto (`json_invalido`, `fecha_invalida`, `forma_desconocida`).
- Produces: `limpiarTexto(valor: string) -> string` (quita controles salvo `\n\t`, quita U+FFFD, recorta a 4096, `"[Mensaje vacío]"` si queda vacío).

- [ ] **Step 1: Pruebas que fallan** — fixtures en el propio test, uno por caso, con la forma de Meta v3 (`entry[].changes[].{field,value}`):
  - `messages` texto: `wa_id='5219190000001'`, `timestamp:'1775627842'` → `ocurrido_en === new Date(1775627842000).toISOString()`, `origen:'vivo'`, `direccion:'entrante'`, `nombre` del `contacts[].profile.name`.
  - `messages` imagen con caption `"precio?"` → `texto === '[Foto] precio?'`; documento `filename:'cot.pdf'` → `'[Documento: cot.pdf]'`; `reaction` → no produce Msg; `errors` → `'[Mensaje no soportado]'`.
  - `smb_message_echoes` → `origen:'telefono'`, `direccion:'saliente'`, `wa_id` = `to`.
  - `history` con 2 hilos; `history_context.from_me:true` → saliente, ausente y `from` = hilo → entrante; `origen:'historial'`; `media_placeholder` → `placeholder:true`, texto `'[Archivo del historial]'`.
  - `history` solo con metadata de fase → `ignorado`; con error 2593109 → `ignorado` motivo `historial_rechazado`.
  - `smb_app_state_sync` contacto add/remove → `contactos`.
  - `statuses` → `ignorado`. `timestamp:'abc'` → lanza `fecha_invalida`. Texto con `\u0007` y `\uFFFD` → limpiado.
- [ ] **Step 2:** `cd backend && node --test bandejaGupshupFormato.test.js` → FAIL (módulo no existe).
- [ ] **Step 3:** Implementar. Confirmar nombres de campo contra https://partner-docs.gupshup.io/docs/coexistence-events; si difieren del spec, detener y reportar.
- [ ] **Step 4:** Mismo comando → PASS.
- [ ] **Step 5:** Commit `feat(bandeja): traductor de eventos Meta v3 de Gupshup`.

### Task 2: Origen del mensaje, envío apagado y estados sin historial

**Files:**
- Modify: `backend/bandeja/mensajes.js` (`registrarInteraccion` ~:122-132, `hilo` ~:174, `conversacion` ~:164, `enviarSaliente` ~:180)
- Modify: `backend/bandeja/consultas.js` (`filas` ~:13: devolver `f.proveedor` y `ultimo_tipo`)
- Modify: `backend/server.js` (`cicloEstadosCRM` ~:2042: `AND x.tipo <> 'mensaje_historial'`)
- Modify: `src/CRMBandejaHilo.jsx`, `src/CRMBandeja.jsx`
- Test: `backend/bandejaMensajes.test.js`, `backend/bandejaRutas.test.js`, `backend/bandejaEstados.test.js` (o el que ya cubra `cicloEstadosCRM`; si no es exportable, extraer la consulta a una función exportada en `bandeja/estados.js` y probarla ahí)

**Interfaces:**
- Produces: `registrarInteraccion({ ..., tipo = 'mensaje' })` (nuevo parámetro; el resto igual) — exportarla en el objeto que devuelve `crearContextoBandeja` para la Tarea 3. `leads.ultima_interaccion_en` solo se actualiza si `tipo !== 'mensaje_historial'` y la fecha es más nueva.
- Produces: `hilo()` devuelve también `tipo`; `conversacion()` devuelve `proveedor`.
- Produces: `enviarSaliente` lanza `status 409` con mensaje exacto `"Por ahora contesta desde el teléfono de la tienda."` si `conversacion(id).proveedor === 'gupshup'`.

- [ ] **Step 1: Pruebas que fallan:** (a) interacción `mensaje_historial` con fecha vieja no cambia `leads.ultima_interaccion_en`; una `mensaje` más vieja que la guardada tampoco la retrocede; (b) `hilo` trae `tipo`; (c) `POST /api/mensajes/conversaciones/:id/mensajes` en canal `proveedor:'gupshup'` → 409 con el texto exacto, y en canal `simulado` sigue 200; (d) la consulta de últimas entradas ignora `mensaje_historial`.
- [ ] **Step 2:** Correr los archivos → FAIL.
- [ ] **Step 3:** Implementar. Pantalla: en el hilo, `tipo==='mensaje_telefono'` muestra debajo de la burbuja "Desde el teléfono de la tienda"; `mensaje_historial` una marca gris "historial"; si `proveedor==='gupshup'` la caja de texto se reemplaza por el aviso del 409. En la lista, "Tú: " solo si `ultima_direccion==='saliente'` y `ultimo_tipo` no es `mensaje_telefono`/`mensaje_historial`. Clases largas a constantes.
- [ ] **Step 4:** PASS + suite de bandeja (`node --test bandeja*.test.js`).
- [ ] **Step 5:** Commit `feat(bandeja): origen del mensaje, envio apagado en gupshup, historial fuera de estados`.

### Task 3: Procesador por trozos

**Files:**
- Create: `backend/bandeja/gupshupProcesador.js`
- Test: `backend/bandejaGupshupProcesador.test.js`

**Interfaces:**
- Consumes: `extraerDeCrudo`, `limpiarTexto` (Tarea 1); `ctx.registrarInteraccion`, `telefonoWhatsApp`, reglas de cliente de `mensajes.js` (Tarea 2); `crearNativoConVinculos(repo, DB, guardar, crear)` de `sicarVinculos.js`; `crearCliente(DB, datos)`; `registrarContacto`, `aplicarHechoNativo`.
- Produces: `crearProcesadorGupshup({ sqlite, DB, repo, guardar, ctx, mantenimiento, ahora = () => new Date(), trozo = 200 })` → `{ procesarPendientes({ maxMs = 20000 }) : Promise<{ procesados, errores, sin_canal }>, recalcularPendientes() : number }`.

- [ ] **Step 1: Pruebas que fallan** (insertar crudos con el mismo `INSERT` del receptor, `identificador_evento_externo='sha256:<n>'`):
  - Vivo de número desconocido → cliente nuevo en la sucursal del canal, conversación, interacción `tipo:'mensaje'` con fecha del timestamp; crudo `procesado_en` puesto; hijo `wamid:<id>` procesado y ligado.
  - Mismo wamid otra vez (otro crudo) → sigue 1 interacción. Placeholder de historial y luego el contenido con mismo wamid → 1 interacción con el texto real.
  - Eco → `tipo:'mensaje_telefono'`, `direccion:'saliente'`, `usuario_id` NULL.
  - Historial → `tipo:'mensaje_historial'`, sin llamadas a `registrarContacto`/`aplicarHechoNativo` (comprobar `DB.crm.contactos_cliente` y `estados_historial` sin cambios).
  - Crudo de `phone_number_id` sin canal → sigue pendiente (`procesado_en` y `error_procesamiento` NULL); tras dar de alta el canal, entra.
  - Canal con `activa=0` → pendiente.
  - Crudo con JSON roto → `error_procesamiento='json_invalido'`; el siguiente crudo sí entra. Error con `throw new Error('https://x?key=SECRETO')` simulado dentro → `error_procesamiento` no contiene `http` ni `SECRETO`.
  - Contactos add → `nombre_mostrado` actualizado; cliente creado por la bandeja con "WhatsApp 0001" toma el nombre; cliente con nombre manual no cambia.
  - Rendimiento: historial de 5,000 mensajes / 300 números nuevos → `procesarPendientes` termina, mide el tramo síncrono más largo (envolver cada trozo con `performance.now()`) y el test falla si > 200 ms; **una** llamada de alta de clientes por trozo (contar `guardar`).
  - Mantenimiento activo → no procesa nada.
- [ ] **Step 2:** `node --test bandejaGupshupProcesador.test.js` → FAIL.
- [ ] **Step 3:** Implementar según spec Reglas 2-8: por crudo → `extraerDeCrudo`; por trozo de `trozo` mensajes: alta de clientes faltantes en una `crearNativoConVinculos` con `crear` que da de alta todos (sin `repo` → directo); luego una `sqlite.transaction` con identidades/conversaciones/hijos/interacciones; vivos con cliente → `registrarContacto`/`aplicarHechoNativo` y un `guardar(DB)` por trozo (con respaldo de `DB.crm` por trozo, no por mensaje); `await new Promise(setImmediate)` entre trozos; revisar `mantenimiento.estaActivo()` entre crudos. Mensajes de error guardados = `codigo` corto o `'error_interno'`.
- [ ] **Step 4:** PASS + `node --test bandeja*.test.js`.
- [ ] **Step 5:** Commit `feat(bandeja): procesador de eventos de Gupshup por trozos`.

### Task 4: Conexión en el servidor, canales, resumen y tope cacheado

**Files:**
- Modify: `backend/server.js` (ciclo junto a `cicloEstadosCRM`), `backend/bandejaRutas.js` (canales, resumen ~:41), `backend/bandeja/gupshupReceptor.js` (tope)
- Test: `backend/bandejaRutas.test.js`, `backend/gupshupReceptor.test.js` (o el archivo de pruebas existente del receptor)

**Interfaces:**
- Consumes: `crearProcesadorGupshup` (Tarea 3).
- Produces: `GET /api/mensajes/canales` → `[{ id, canal, proveedor, identificador_externo, nombre, sucursal_id, activa }]`; `POST /api/mensajes/canales` body `{ proveedor:'gupshup', identificador_externo, nombre, sucursal_id }` → 201 con el canal; ambos con permiso `conectar_canales_mensajes`; alcance por token (`ver_todas_las_sucursales` o su `sucursal_id`), nunca por query. Sucursal inexistente → 400; número ya ligado a otra sucursal → 409; mismo número misma sucursal → 200 con el existente.
- Produces: receptor acepta `pendientes: () => number` (opcional; sin él, conserva la suma actual) y suma lo que inserta al valor cacheado.
- Produces: resumen agrega `{ procesados, con_error, errores_recientes: [{ id, motivo, recibido_en }] (5), pendientes_sin_canal, interacciones_por_tipo, medios: { total, con_url, claves: string[] } }`, contando solo `identificador_evento_externo LIKE 'sha256:%'`.

- [ ] **Step 1: Pruebas que fallan:** rutas de canales (permiso con rol que tiene permisos vecinos de la bandeja pero no `conectar_canales_mensajes` → 403; sucursal ajena → 403; casos 400/409/200/201); resumen no cuenta hijos `wamid:` y trae los campos nuevos; diagnóstico de medios cuenta `url` y lista claves sin valores; receptor con `pendientes` por encima del tope → 503 sin ejecutar la suma SQL.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementar. En `server.js`: crear el procesador si `bandeja` existe; `setInterval(() => procesador.procesarPendientes(...), 60000).unref()` y `setTimeout(..., 30000).unref()` dentro de `if (require.main === module)`, sin solaparse (bandera "corriendo"); errores al log sin datos externos.
- [ ] **Step 4:** PASS; suite completa `cd backend && node --test` 0 fallas; `npx eslint src backend` 0 errores.
- [ ] **Step 5:** Commit `feat(bandeja): ciclo del procesador, alta de canales y resumen ampliado`.

## Al terminar

Reportar: commits, suite (pasan/fallan), eslint, el tramo síncrono más largo medido, campos de Meta que no coincidieron con
el spec, y cualquier punto donde se detuvo.
