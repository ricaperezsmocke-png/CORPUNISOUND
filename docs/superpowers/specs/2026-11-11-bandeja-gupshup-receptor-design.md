# Bandeja F4a — Receptor crudo de Gupshup (WhatsApp)

Fecha: 2026-11-11. Rama `feature/bandeja-gupshup` (worktree `.claude/worktrees/bandeja-gupshup`), base `712d681`.
Plan padre: `docs/superpowers/plans/2026-10-18-bandeja-clientes.md` (F3 decidida: **Gupshup autoservicio**).

## Por qué

Victor eligió Gupshup (USD 0.001 por mensaje, sin mensualidad) para conectar los WhatsApp de las tiendas con
**coexistencia** (el celular de la tienda sigue funcionando y los mensajes también llegan al CRM).

Dos hechos de la documentación de Gupshup (`docs.gupshup.io/docs/coex`) obligan a separar esta pieza:

1. **El historial de chats llega una sola vez**: solo si se comparte al conectar, y la sincronización se dispara una
   vez dentro de las primeras 24 h. Si el CRM no lo guarda en ese momento, se pierde (recuperarlo exige desconectar el
   número y volver a darlo de alta). Por eso el receptor debe estar en producción **antes** de conectar Ocosingo.
2. **Meta reporta fallas** en `smb_message_echoes` (las respuestas que el vendedor manda desde el celular), en el
   historial y en contactos. Antes de programar la bandeja completa hay que **comprobar con datos reales** qué llega.

Este receptor solo **recibe y guarda tal cual**. No crea conversaciones, no toca clientes, no manda nada.

## Metas

- Recibir por HTTPS todo lo que mande Gupshup (formato v3 de Meta para coexistencia; también v2 si llega) y guardarlo
  sin pérdida, sin duplicados por reintento, y cubierto por el respaldo.
- Que Claude/Victor puedan **ver qué tipos de evento llegaron** (sin ver el contenido) para la prueba de echoes.

## No metas (van en F4b)

- Interpretar los eventos, crear identidades/conversaciones/mensajes en la bandeja, ligar a clientes.
- Enviar mensajes, plantillas, estados entregado/leído, descargar medios a Drive.
- Pantalla nueva en el navegador.

## Anti-metas (si pasa esto, falló aunque "funcione")

- Que un desconocido en internet pueda meter eventos falsos o llenar el disco de Render.
- Que el contenido de los mensajes de clientes salga en logs de consola o en una respuesta a quien no es administrador.
- Que un error del receptor tumbe o frene el punto de venta.
- Que se pierda el historial por responder error a Gupshup cuando el problema es nuestro.

## Diseño (decisiones tomadas)

**Ruta.** `POST /api/integraciones/gupshup/:token` montada **antes** de `express.json` (molde
`registrarAgenteSicar`, `backend/sicarRutas.js`), cuerpo crudo con tope de **1.5 MB**. Razón: el respaldo del negocio falla si una sola fila pasa de 2 MiB − 64 KiB
(`MAX_FILAS_BYTES`, `backend/sicarRespaldo.js:54-56` y el `throw` de la línea ~253); un evento más grande que eso
detendría los respaldos de todo el sistema. Meta parte el historial en varios envíos; si alguno pasara de 1.5 MB, se
responde 413, se cuenta en memoria y se avisa por consola **sin contenido** (falla visible en la prueba, no silenciosa).
Agregar una prueba que guarde un evento de 1.5 MB y compruebe que el respaldo completo termina.
`GET` a la misma ruta con token válido responde 200 vacío (Gupshup puede probar la URL al guardarla).

**Autenticación.** No encontramos en la documentación de Gupshup una firma de sus llamadas. Se usa un **token secreto en
la URL**: variable de entorno `GUPSHUP_WEBHOOK_TOKEN` en Render (la pone Victor; mínimo 32 caracteres). Comparación de
tiempo constante (`timingSafeEqual` sobre los SHA-256 del token recibido y el configurado). Sin variable configurada, o
con menos de 32 caracteres, la ruta responde **404** (apagada). Token incorrecto: **401 sin escribir fila**, solo un
contador en memoria (misma lección que la auditoría A1 de SICAR: lo anónimo no escribe en disco).
*Pendiente para F4b:* si Gupshup reenvía la cabecera `X-Hub-Signature-256` de Meta o documenta una firma, verificarla
además del token.

**Freno.** Límite en memoria de peticiones por minuto (p. ej. 600). Exceso: 429 sin fila.

**Guardado.** Una fila por petición válida en la tabla que **ya existe** `lead_eventos_externos`
(`backend/centroLeads/persistencia.js`), que ya está en el respaldo (`TABLAS_LEADS`, `backend/sicarRespaldo.js`):
- `proveedor = 'gupshup'`
- `identificador_evento_externo = 'sha256:' + hash del cuerpo crudo` → un reintento idéntico no duplica (UNIQUE
  `(proveedor, identificador_evento_externo)`); el duplicado responde 200.
- `tipo` = lista ordenada y sin repetir de los `field` de `entry[].changes[]` (formato Meta, p. ej.
  `history,smb_message_echoes`) o el `type` de nivel superior (formato v2 de Gupshup), o `desconocido`. Recortado a 200.
- `payload_json` = el cuerpo tal cual (texto UTF-8). Si no es JSON válido se guarda igual con `tipo = 'no_json'`.
- `fuente_id = NULL` (todavía no hay fuente dada de alta; F4b la asocia por `phone_number_id`).
- `recibido_en` = ISO UTC. `ocurrido_en`, `procesado_en`, `error_procesamiento` = NULL.
Responde **200 con cuerpo vacío** en cuanto la fila quedó escrita (lo que Gupshup pide).

**Tope de disco.** Si los `payload_json` de Gupshup **sin procesar** suman más de **200 MB**, responde **503** (Gupshup
reintenta; no se pierde en silencio) y avisa por consola una vez por minuto **sin contenido**. Es un freno de
emergencia, no un estado esperado.

**Mantenimiento / restauración.** Durante una restauración de respaldo (bandera `mantenimiento` existente) responde
**503** para que Gupshup reintente después.

**Errores nuestros** (base ocupada, excepción): 503, nunca 4xx. Nunca imprimir el cuerpo en consola.

**Resumen para verificar.** `GET /api/mensajes/gupshup/resumen`, con el permiso existente **`conectar_canales_mensajes`**
(módulo `crm`, `backend/bandejaRutas.js`; no se crea permiso nuevo). Devuelve, de los
últimos 7 días: conteo por `tipo`, primera y última hora de recepción, número de filas sin procesar y bytes totales.
**Nunca** contenido, teléfonos ni nombres.

## Restricciones

- Sin dependencias nuevas. `node:crypto` para hash y comparación.
- Líneas de 200 caracteres como máximo; pruebas con `node --test`; suite completa en 0 fallas; eslint 0 errores.
- No tocar `render.yaml`. La variable de entorno la pone Victor en Render.
- No cambia el esquema: usa columnas existentes.

## Verificación

- Pruebas: token correcto guarda una fila y responde 200 vacío; token incorrecto 401 sin fila; sin variable 404;
  cuerpo idéntico dos veces = una fila y dos 200; cuerpo de 1.5 MB + 1 rechazado (413) sin fila; JSON inválido se guarda
  como `no_json`; `tipo` correcto para un evento Meta con `messages` + `smb_message_echoes` y para uno v2; mantenimiento
  503 sin fila; tope de 200 MB responde 503; el resumen no contiene texto de mensajes ni teléfonos; el resumen exige el
  permiso (probar con permisos vecinos del módulo, no con `permisos: []`); la ruta no rompe el parser global (una ruta
  normal con JSON sigue funcionando).
- Respaldo: un evento guardado sobrevive respaldo + restauración (la tabla ya está en `TABLAS_LEADS`).
- Producción (después del merge de Victor): `curl` con token falso = 401; con token real y cuerpo de prueba = 200 y
  aparece en el resumen.

## Lo que queda al implementador

Nombres de funciones y archivos (sugerido `backend/bandeja/gupshupReceptor.js`), estructura de pruebas, valor exacto
del freno por minuto.

## Después de esto (no es parte de F4a)

1. Victor pone `GUPSHUP_WEBHOOK_TOKEN` en Render; la URL va en Gupshup > Webhooks con modo **Coexistence** activado.
2. Conectar el número de Ocosingo **compartiendo los chats**; disparar historial y `smb_app_state_sync` dentro de 24 h.
3. Prueba de echoes: el vendedor contesta desde el celular y se revisa en el resumen que llegó `smb_message_echoes`.
4. Con lo aprendido, spec de F4b (procesar a la bandeja y enviar).

## Decisiones del diseñador (revisión de constructor, Codex 2026-11-11)

- **Tope de 1.5 MB por evento** en vez de 5 MB: el respaldo no admite filas de más de 2 MiB − 64 KiB (verificado por
  Claude en `backend/sicarRespaldo.js:54-56` y ~253).
- **Tope de 200 MB sin procesar:** la recuperación es operativa, no automática. El volumen esperado de Ocosingo (texto,
  los medios llegan como id) es de pocos MB; si el resumen se acerca al tope, se prioriza F4b o se amplía el tope con
  decisión de Victor. No se documentó cuánto tiempo reintenta Gupshup: por eso el tope es un freno de emergencia.
- **Restaurar un respaldo anterior** borra los eventos recibidos después, igual que pasa hoy con ventas y todo lo demás
  del sistema. Se acepta: restaurar es una operación de emergencia. No se agrega reconciliación en F4a.
