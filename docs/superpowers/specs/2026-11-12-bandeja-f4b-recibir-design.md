# Bandeja F4b — Ver en el CRM los WhatsApp que ya llegan (solo recibir)

Fecha: 2026-11-12. Rama `feature/bandeja-f4b` (worktree `.claude/worktrees/bandeja-f4b`), base `0281897` (master).
Alcance de Victor (2026-11-12): "por ahora solo probaremos que lleguen los mensajes … los vendedores de innotec
contestarán desde el teléfono, estamos en fase de prueba". "Ese número es de solo clientes."

## Por qué

Desde el 2026-11-12 el WhatsApp de **INNOTEC** (sucursal id 7 en producción, número 52 919 270 2651,
`phone_number_id` `1345802228620291`) está conectado a Gupshup en coexistencia. El receptor F4a
(`backend/bandeja/gupshupReceptor.js`) guarda cada aviso **crudo** en `lead_eventos_externos`
(`proveedor='gupshup'`, `identificador_evento_externo='sha256:…'`, `procesado_en IS NULL`, `payload_json` = cuerpo,
formato Meta v3). Producción al 2026-11-12 22:51 UTC: 92 `history`, 7 `messages`, 1 `smb_message_echoes`,
1 `smb_app_state_sync`, 12 de cuenta/seguridad; 609 KB. Nadie los lee: la Bandeja (`src/CRMBandeja*.jsx`, rutas
`/api/mensajes/*` en `backend/bandejaRutas.js`, lógica `backend/bandeja/mensajes.js`, `consultas.js`) solo la alimenta
el canal simulado.

## Metas

- Cada mensaje de cliente al WhatsApp de Innotec aparece en la Bandeja, en la conversación de ese cliente, ~1-2 min
  después de llegar.
- Lo que la tienda contesta **desde el teléfono** (`smb_message_echoes`) aparece como saliente marcado "Desde el
  teléfono de la tienda" (no "Tú").
- El historial (`history`) entra con su fecha real, sin cambiar estados ni contar como contacto.
- La sincronización de contactos pone el nombre guardado en el teléfono.
- Fotos/audios/videos/documentos/stickers se ven como etiqueta ("[Foto]" + pie de foto).
- Desde el CRM no se manda nada en conversaciones reales.

## No metas

- Enviar por la API, plantillas, ventana de 24 h, Customer Access Tokens.
- **Bajar archivos a Drive** (fase siguiente, cuando se sepa con payloads reales cómo se descargan; ver Regla 10).
- **Cambios de esquema** (para no dejar inservibles los respaldos actuales de la bandeja: `sicarRespaldo.js:306`
  rechaza copias con otra `version_leads`). Todo cabe en columnas existentes.
- Messenger, Instagram, otras tiendas (debe servir para otra tienda con solo dar de alta su canal).
- Avisos de entregado/leído (`statuses`).

## Anti-metas

- Un mensaje duplicado (mismo `wamid` en vivo + historial, o reintento de Gupshup).
- Un mensaje perdido en silencio: todo crudo termina procesado o con `error_procesamiento` visible; el crudo no se borra.
- Historial que cambie estados o el "último contacto" (incluido el ciclo horario `cicloEstadosCRM`, `server.js:~2042`,
  que hoy toma `max(ocurrida_en)` de entrantes).
- Que el procesamiento congele el punto de venta.
- Que el CRM aparente mandar un mensaje que nunca salió.
- Fechas de mensajes que quedan como "hoy" por mal convertidas.

## Reglas (decisiones tomadas)

1. **Canal por número.** Fila de `lead_fuentes`: `canal='whatsapp'`, `proveedor='gupshup'`, `identificador_externo` =
   `phone_number_id`, `sucursal_responsable_id`. Rutas nuevas `POST /api/mensajes/canales` y `GET /api/mensajes/canales`
   con permiso `conectar_canales_mensajes` (existe). El POST valida que la sucursal exista y que quien llama tenga
   `ver_todas_las_sucursales` o sea su sucursal; si ya existe canal con ese número en **otra** sucursal → 409 (hoy
   `crearFuente` devuelve el existente en silencio, `centroLeads/fuentes.js:47`). Sin pantalla.
   Crudos de un `phone_number_id` sin canal → se quedan pendientes (no error). Canal apagado (`activa=0`) → igual,
   pendientes.
2. **Procesador** `backend/bandeja/gupshupProcesador.js`. Ciclo cada 60 s (primero a los 30 s del arranque), se salta en
   mantenimiento y re-revisa mantenimiento entre crudos. Lee crudos `proveedor='gupshup' AND identificador_evento_externo
   LIKE 'sha256:%' AND procesado_en IS NULL AND error_procesamiento IS NULL` por `id`. Cede el hilo entre trozos
   (`setImmediate`); ningún tramo síncrono > ~200 ms. Un crudo se marca `procesado_en` cuando todo su contenido entró;
   si truena, `error_procesamiento` = motivo corto **sin URLs, claves ni texto de respuestas externas**, y sigue. Los
   crudos con error no se reintentan solos; el resumen los muestra.
3. **Costo por mensaje (obligatorio).** No llamar `recibirEntrante`/`operacion` por mensaje: hoy cada `operacion`
   clona `DB.crm` y hace `guardar(DB)` (JSON completo) y cada cliente nuevo pasa por `crearNativoConVinculos`
   (`sicarVinculos.js:189`). Por trozo: (a) crear **juntos** los clientes que falten en una sola llamada de alta (la de
   `sicarVinculos` admite varios), (b) insertar identidades, conversaciones, eventos hijo e interacciones en una
   transacción SQLite simple sin clonar ni `guardar`. Solo los mensajes vivos con cliente llaman `registrarContacto` /
   `aplicarHechoNativo` (tocan `DB.crm`), agrupados por trozo con un solo `guardar`.
4. **Idempotencia por `wamid`.** Evento hijo en `lead_eventos_externos` con `identificador_evento_externo =
   'wamid:' + id`, ya procesado, ligado a la interacción (el índice único `(proveedor, identificador_evento_externo)` y
   el de `lead_interacciones.evento_externo_id` lo garantizan). Ya existe → no se inserta otra vez, **salvo** que la
   guardada sea un marcador de medio de historial (`media_placeholder`) y llegue el contenido real: entonces se
   actualiza el texto de esa interacción.
5. **Fechas.** `timestamp` de Meta = segundos Unix en texto → `new Date(Number(ts) * 1000).toISOString()`. Sin
   timestamp válido → error del crudo (no "ahora").
6. **Qué evento es qué** (`entry[].changes[].field`, `value`; número de la tienda en `value.metadata.phone_number_id`):
   - `messages` → `value.messages[]` entrantes (`from`), nombre en `value.contacts[].profile.name`; `value.statuses`
     se ignora.
   - `smb_message_echoes` → `value.message_echoes[]` salientes desde el teléfono, cliente = `to`.
   - `history` → `value.history[].threads[]` (hilo = wa_id del cliente); dirección por
     `messages[].history_context.from_me` (si falta, `from` ≠ cliente). Fase/progreso sin mensajes → procesado. Error de
     historial rechazado (código 2593109) → procesado con nota en el resumen.
   - `smb_app_state_sync` → `value.state_sync[]` contacto (`contact.phone_number`, nombre, `action add|remove`):
     `add` actualiza `nombre_mostrado` de la identidad y el nombre del cliente **solo** si lo creó la bandeja y sigue
     con el automático "WhatsApp NNNN"; `remove` no borra nada.
   - Otros campos (`account_update`, `account-event`, `security`, …) → procesados, ignorados.
   Los nombres exactos se confirman contra la doc de Gupshup "Coexistence Events" y Meta; si algo no cuadra con un crudo
   real en producción, el procesador lo marca `error_procesamiento` (no adivina) y el resumen lo muestra.
7. **Texto por tipo.** `text.body`; `image` "[Foto]", `video` "[Video]", `audio` "[Audio]", `document`
   "[Documento: nombre]", `sticker` "[Sticker]" + `caption` si trae; `location` "[Ubicación]"; `contacts`
   "[Contacto compartido]"; `media_placeholder` "[Archivo del historial]"; `errors`/desconocido
   "[Mensaje no soportado]"; `reaction` se ignora. Antes de guardar: quitar caracteres de control y U+FFFD, recortar a
   4096; si queda vacío, "[Mensaje vacío]". Un carácter raro nunca tumba un trozo.
8. **Clientes.** Misma regla de `mensajes.js` (`telefonoWhatsApp`, candidatos por teléfono, `posibles` → Por
   identificar, si no hay → se crea en la sucursal del canal). Nombre: perfil de WhatsApp, luego contacto sincronizado,
   luego "WhatsApp NNNN".
9. **Origen en la columna `tipo`** de `lead_interacciones` (existe, sin CHECK): `mensaje` (vivo), `mensaje_telefono`
   (eco), `mensaje_historial`. Ajustes:
   - `cicloEstadosCRM` y cualquier cálculo de "última actividad"/estado ignoran `mensaje_historial`.
   - `registrarInteraccion` no debe mover `leads.ultima_interaccion_en` hacia atrás (`mensajes.js:130`: agregar
     condición "solo si es más nueva"); el historial no lo actualiza.
   - `hilo()` y `consultas` devuelven `tipo` y `f.proveedor`; el hilo muestra "Desde el teléfono de la tienda" en
     `mensaje_telefono` y una marca discreta "historial" en `mensaje_historial`; la lista no pone "Tú:" a ecos.
10. **Medios: diagnóstico, no descarga.** El resumen cuenta cuántos mensajes con medio traen un campo `url` (y cuáles
    claves trae el objeto del medio, sin valores). Con eso se diseña la fase de Drive. Riesgo aceptado en prueba: fotos
    que lleguen antes de esa fase pueden vencer (Meta: 7 días).
11. **Envío apagado** en canal `gupshup`: `enviarSaliente` (no solo la ruta) responde 409 "Por ahora contesta desde el
    teléfono de la tienda."; en el hilo la caja de texto se reemplaza por ese aviso. Simulado sigue igual.
12. **Tope de pendientes** (deuda F4a): el receptor deja de sumar `payload_json` en cada petición; usa un valor
    cacheado que recalcula el procesador en cada ciclo (y el receptor suma lo que inserta).
13. **Resumen** (`GET /api/mensajes/gupshup/resumen`): contar solo crudos (`LIKE 'sha256:%'`); agregar procesados,
    con error (5 motivos más recientes), pendientes sin canal, mensajes por tipo de interacción, diagnóstico de medios.

## Restricciones

- Sin dependencias nuevas; sin cambios de esquema; líneas ≤ 200; `node --test` 0 fallas; eslint 0 errores; commits sin
  acentos, staging por rutas.
- No tocar `agente-sicar/`; el receptor solo por la Regla 12.
- Secretos y URLs externas nunca en logs, errores guardados ni respuestas.

## Verificación

- Pruebas con crudos de ejemplo por tipo, incluyendo: mismo `wamid` vivo + historial = 1 mensaje; placeholder luego
  contenido = 1 mensaje actualizado; crudo sin canal pendiente y entra al dar de alta; crudo roto → error y el
  siguiente entra; timestamp en segundos queda con la fecha correcta; historial no cambia estado ni
  `ultima_interaccion_en` ni lo que lee `cicloEstadosCRM`; carácter de control no tumba el trozo; historial de 5,000
  mensajes con 300 clientes nuevos sin tramo síncrono > ~200 ms (medir e informar); POST canales con sucursal ajena →
  403/409.
- Enviar en canal gupshup → 409; simulado sigue.
- Producción (Claude, tras merge autorizado por Victor): dar de alta el canal de Innotec, ver en el navegador la
  Bandeja con mensajes de hoy, historial y el eco; revisar el diagnóstico de medios.

## Lo que queda al implementador

Estructura interna del procesador, tamaño de trozo, cómo reusar piezas de `mensajes.js` sin su `operacion` por
mensaje, dónde se cachea el tope.
