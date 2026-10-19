# Bandeja de clientes — F1 (servidor) y F2 (pantalla con canal de prueba)

Fecha: 2026-10-18. Rama `feature/bandeja-base` (worktree `.claude/worktrees/bandeja-base`), sobre master `bd4e61c` +
merge de `feature/centro-leads` (`d73cfa1`) + arranque aislado (`0cbeb80`). Plan general aprobado:
`docs/superpowers/plans/2026-10-18-bandeja-clientes.md`. Reglas del núcleo heredado (no se relajan):
`docs/superpowers/specs/2026-08-22-centro-leads-design.md`.

## 1. Para qué

Que **los clientes sean de Unisound y no del vendedor**. Cada mensaje de WhatsApp, Messenger o Instagram queda en el
sistema pegado a la ficha del cliente; cada cliente tiene un responsable; cuando un vendedor se va, su cartera pasa a
otro con un clic y con todo el historial. Además, el **estado del CRM cambia solo** por hechos que el sistema ve, sin
esperar al vendedor.

F1 y F2 se construyen y prueban **sin proveedor real**: un canal simulado hace llegar y salir mensajes. La conexión
real (F4) se monta después sobre la misma entrada.

## 2. Decisiones tomadas (no reabrir)

1. Un número de WhatsApp por tienda (los actuales), Messenger de Unisound y de cada tienda, Instagram. Cada uno es un
   **canal** con su tienda.
2. Reparto: la conversación es del **responsable del cliente**; el vendedor ve las suyas y las sin responsable de su
   tienda; gerente y Victor ven todas.
3. Estados automáticos, todo junto con la bandeja; **Perdido a los 30 días** sin respuesta ni compra.
4. Proveedor intermedio en F4 (fuera de este spec).

## 3. Lo que ya existe y se reutiliza

- Núcleo `backend/centroLeads/*`: `lead_fuentes`, `lead_identidades_externas`, `lead_conversaciones`,
  `lead_interacciones` (texto, `direccion` entrante/saliente/sistema), `lead_eventos_externos` (único por proveedor +
  id de evento), `leads`, `lead_asignaciones` (`asignarLead`/`reasignarLead`, motivo obligatorio), `lead_historial`.
- Clientes del CRM: `crearCliente`/`actualizarCliente` (`backend/clientes.js`), `validarContactoCliente`,
  `crearNativoConVinculos`/`editarNativoConVinculos` (unión con SICAR por teléfono), `vendedor_asignado_id`.
- Estados: `ESTADOS_MANUALES` y `cambiarEstadoCliente` (`backend/crm.js:120`), `repo.guardarEstadoCliente`
  (`backend/sicarRepositorio.js`), ruta unificada `PUT /api/crm/v2/clientes/:ref/estado`.
- Contactos: `registrarContacto` (`backend/crm.js:140`).
- Alcance y permisos: `alcanceSucursal`, `dentroDeAlcance`, `requierePermiso` (`backend/auth.js`),
  `backend/permisosCatalogo.js`.

## 4. Diseño

### 4.1 Un cliente, no "lead" y "cliente"

- Cada **canal** es una fila de `lead_fuentes` con `proveedor` (`simulado` en F1/F2), identificador externo del canal
  (número o id de página) y su `sucursal_id` (en la metadata, nunca credenciales).
- Cada persona que escribe es una `lead_identidades_externas` (`proveedor` + id externo: número E.164 en WhatsApp, id
  de la persona en Messenger/Instagram). Su `cliente_id` apunta **siempre a un cliente nativo del CRM**.
- **Ligado al llegar el primer mensaje:**
  - WhatsApp trae teléfono: se normaliza con la regla estricta de `telefonos()` (`backend/sicarVinculos.js:12-28`).
    Un cliente nativo con ese teléfono → se liga. Ninguno → se crea cliente nativo en la tienda del canal
    (`crearNativoConVinculos`, que a su vez lo une con su identidad SICAR si existe, con el aviso de siempre).
    Varios o ambiguo → identidad **sin ligar**, a la cola "Por identificar" de la tienda.
  - Messenger/Instagram no traen teléfono: identidad sin ligar hasta que alguien la ligue a mano (buscar cliente o
    crear uno). Ligar/desligar a mano exige permiso, queda en historial.
- Cada cliente con conversaciones tiene **un solo expediente** (`leads`, `cliente_id` único) que guarda el historial de
  responsables (`lead_asignaciones`). El estado del embudo del núcleo (`NUEVO`…`GANADO`) **no se muestra ni se usa**:
  el estado visible es el del CRM (4.4).

### 4.2 Responsable

- Fuente de verdad: `cliente.vendedor_asignado_id` (lo que ya usa todo el CRM).
- Toda forma de cambiarlo pasa por **una sola función** que, en este orden: valida (vendedor activo de la misma tienda,
  `validarVendedorDelCliente`), escribe la asignación en `lead_asignaciones` con motivo y usuario, y actualiza el
  cliente en el JSON con el mismo patrón transaccional que `crearNativoConVinculos` (si el JSON no se puede guardar, se
  deshace la parte SQLite).
- Formas: **tomar** una conversación sin responsable (el vendedor se la asigna a sí mismo; motivo automático "tomó la
  conversación"), **reasignar** (permiso, motivo obligatorio), **traspaso de cartera** (4.3). La edición normal del
  cliente que cambie `vendedor_asignado_id` también deja asignación.

### 4.3 Traspaso de cartera

- `POST /api/mensajes/traspasos` `{ de_vendedor_id, a_vendedor_id, motivo }`, permiso `traspasar_cartera`. Mismo
  alcance de tienda que el vendedor de origen; destino activo y de la misma tienda.
- Pasa **todos** los clientes del vendedor (con o sin conversaciones) al otro, cada uno con su asignación y motivo, en
  una sola operación; responde cuántos se movieron.
- `desactivarVendedor` (`backend/vendedores.js:202`) **se niega** si el vendedor aún tiene clientes, y el error dice
  cuántos y que primero se traspasen. Así nadie se va dejando clientes huérfanos.

### 4.4 Estados automáticos

Escala: `contactado` < `interesado` < `visito_tienda` < `compro`; `perdido` aparte. Aplica igual a clientes nativos
(`cliente.estado`) y a identidades SICAR sin unir (`sicar_estados`), por la ruta y funciones que ya existen.

| Hecho | Cambio automático |
|---|---|
| Sale un mensaje de la tienda al cliente | sin estado → `contactado` |
| Entra un mensaje del cliente | sin estado, `contactado` o `perdido` → `interesado` |
| Cotización, apartado o registro del Radar de Demanda del cliente en tienda | por debajo de `visito_tienda` o `perdido` → `visito_tienda` |
| Venta cerrada en POS o compra vigente de SICAR | cualquiera → `compro` (hoy solo MercadoLibre lo marca: `mercadolibre.js:467-483`; POS y SICAR son nuevos) |
| 30 días sin mensaje entrante, sin contacto y sin compra, estando en `contactado`, `interesado` o `visito_tienda` | → `perdido` |

- **Nunca baja** de forma automática salvo a `perdido` por tiempo. Un `compro` no pasa a `perdido` por tiempo.
- Cada cambio automático queda en el historial con actor `sistema` y motivo legible ("Interesado: el cliente escribió
  el 18/10"). El vendedor puede corregir a mano como hoy; queda quién y cuándo.
- Los 30 días son una constante del servidor (`DIAS_PARA_PERDIDO = 30`). La revisión corre una vez al día y al
  arrancar, con un temporizador como el de los respaldos (`server.js:527`); la venta POS marca `compro` al cerrarse
  sin tocar el cálculo de la venta (solo el estado del cliente, después de guardada).
- Las cuentas internas no cambian de estado automáticamente.

### 4.5 Entrada y salida de mensajes

- **Entrada** (una sola función, la que usará el webhook en F4): recibe evento del canal; si `(proveedor, id de
  evento)` ya existe en `lead_eventos_externos`, no hace nada (idempotente); si no, en una transacción: evento,
  identidad (4.1), conversación, interacción `entrante`, estado automático, contacto en `contactos_cliente`.
- **Salida**: `POST /api/mensajes/conversaciones/:id/mensajes` `{ texto }`, permiso `responder_mensajes`, solo si la
  conversación está en su alcance y (vendedor) es suya o la acaba de tomar. Se guarda como `saliente` con el usuario;
  el canal simulado la "entrega" al instante. Texto 1–4096 caracteres, UTF-8 estricto.
- **Canal simulado**: `POST /api/mensajes/simulado/entrante` solo con `NODE_ENV !== 'production'` y permiso
  `conectar_canales_mensajes`; en producción la ruta no existe.

### 4.6 Permisos (módulo nuevo `mensajes`, en `permisosCatalogo.js`)

`ver_bandeja`, `responder_mensajes`, `ver_todas_conversaciones` (gerente), `reasignar_conversaciones`,
`traspasar_cartera`, `ligar_identidades`, `conectar_canales_mensajes`, y `corregir_atribucion_lead` (pendiente del
núcleo). El Administrador los recibe solo; los demás roles, a mano en Roles y Personal.

### 4.7 Respaldo (condición para F4)

Las tablas `leads`/`lead_*` entran al respaldo antes de que exista un solo mensaje real. Se hace con el mismo
mecanismo del respaldo SICAR (trozos cifrados a Drive, verificación, retención, restauración preparada), convertido
en una pieza común para "un grupo de tablas"; **el respaldo SICAR debe seguir pasando todas sus pruebas sin cambiarlas**.
Respaldos actuales (sin tablas de leads) siguen restaurando.

### 4.8 Pantalla (F2)

- Pestaña **Bandeja** en el CRM: filtros Mías / Sin responsable de mi tienda / Todas (solo con
  `ver_todas_conversaciones`) / Por identificar; lista con canal, cliente, último mensaje y hora.
- Hilo de la conversación, caja para responder, botones Tomar y Reasignar (con motivo), enlace a la ficha.
- En la ficha del cliente: sus conversaciones y el historial de responsables y de estados.
- Roles y Personal: traspaso de cartera al desactivar un vendedor.
- La pantalla solo refleja; todo se valida en el servidor.

## 5. Abuso y rastro

- **El vendedor ya no es dueño del canal**: los números y páginas son de la tienda; el sistema guarda cada mensaje.
- **Esconder clientes**: reasignar exige permiso y motivo; todo queda en `lead_asignaciones` y `lead_historial`.
- **Inflar estados**: lo automático sale de hechos (mensajes, cotizaciones, ventas); lo manual queda con nombre.
- **Llevarse el número**: el vendedor ve el teléfono completo (decisión de Victor, sección 6) y puede copiarlo; el
  riesgo aceptado se compensa con que las conversaciones viven en canales de Unisound.
- Nada de esto mueve dinero, caja ni inventario.

## 5b. Decisiones tras la revisión independiente (2026-10-18, Victor delegó: "lo más adecuado a como trabajamos")

- Un **apartado vigente** (sin liquidar, sin cancelar y dentro de su fecha límite) **frena el Perdido**; al liquidarse
  cuenta como compra en su fecha de liquidación.
- Los 30 días para Perdido **cuentan desde la activación**: nadie cambia de estado el primer día. Consecuencia
  aceptada: los clientes viejos sin actividad pasan a Perdido juntos el día 30; se avisa a Victor antes.
- "En tienda" sale de apartados y del Radar (el sistema no tiene cotizaciones).
- Los permisos van en el módulo `crm` (la bandeja es una pestaña del CRM), no en un módulo nuevo.

## 6. Teléfono visible (decidido)

Victor aprobó el spec el 2026-10-18 y decidió **no enmascarar** el teléfono: el vendedor lo sigue viendo completo en
la bandeja y en la ficha, como hoy. El control está en que el canal y el historial son de Unisound.

## 7. Pruebas (TDD)

- Ligado: un cliente con el teléfono → se liga; ninguno → cliente nuevo en la tienda del canal (y su unión SICAR);
  varios → Por identificar; Messenger sin teléfono → Por identificar; ligar a mano sin permiso → 403.
- Idempotencia: el mismo evento dos veces = un solo mensaje.
- Alcance: conversación de otra tienda → 404; vendedor no ve conversaciones de otro vendedor; permisos con vecinos.
- Responsable: tomar, reasignar sin motivo → 400, reasignar a vendedor de otra tienda o inactivo → 400; asignación e
  historial escritos; JSON y SQLite no quedan a medias si falla el guardado.
- Traspaso: mueve todos, cada uno con su asignación; desactivar con cartera → rechazado con el número.
- Estados: cada fila de la tabla 4.4; nunca baja; compro no pasa a perdido; día 29 sigue, día 30 pasa; cuenta interna
  no cambia; historial con actor `sistema`.
- Respaldo: con tablas de leads restaura; respaldos anteriores restauran; SICAR sin cambios en sus pruebas.
- Simulado: la ruta no existe con `NODE_ENV=production`.
- Suite completa, eslint 0 errores, líneas ≤ 200.
- Navegador (F2): mensaje simulado → Sin responsable → vendedor toma → responde → estado pasa solo a Interesado →
  aparece en la ficha → desactivar vendedor pide traspaso → traspaso → el nuevo ve todo; vendedora sin permiso no ve
  conversaciones ajenas.

## 8. Fuera de alcance

Proveedor real y webhook firmado (F4), plantillas y campañas, medios (fotos/audios a Drive llegan con F4),
`campanas-marketing`, enlaces rastreados en publicaciones, reportes de tiempos de respuesta.
