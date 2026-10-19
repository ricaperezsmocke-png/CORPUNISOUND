# Plan: Bandeja de clientes de Unisound (WhatsApp, Messenger, Instagram) sobre el CRM, rescatando `feature/centro-leads`

## Contexto

Victor quiere que **los clientes sean de Unisound, no de los vendedores**: hoy cada vendedor atiende por una mezcla
de su celular personal y el número de la tienda, y si se va se lleva a sus clientes. Objetivo: todas las
conversaciones de WhatsApp, Messenger e Instagram llegan a una bandeja dentro del CRM, pegadas a la ficha del
cliente (con sus compras POS y SICAR), con un vendedor responsable por conversación, historial completo, y un
traspaso de cartera con un clic cuando un vendedor se va.

Decisiones de Victor (2026-10-18):
- Un número de WhatsApp **por tienda**, **los que ya tienen** (coexistence de Meta: siguen en el celular y se copian al sistema).
- Messenger de la página de Unisound **y** de las páginas por tienda, **más Instagram**.
- Reparto: **asignado a un vendedor**; el vendedor ve las suyas y las sin asignar de su tienda; gerente y Victor ven todas.
- Conexión con Meta mediante **proveedor intermedio** (se comparan 2-3 antes de contratar; Victor decide).
- `campanas-marketing` **queda fuera por ahora** (no manda mensajes: es un checklist del personal).

Rama encontrada: `feature/centro-leads` (Codex, 2026-08-21/22, worktree `Documents\Codex\worktrees\CORPUNISOUND-centro-leads`,
base `a3f7f2a`). Núcleo de servidor sin rutas ni pantallas: leads, asignación con motivo e historial, atribución
(mérito separado de quién atiende), enlaces rastreados, tablas preparadas para identidades externas, conversaciones
y eventos externos con índices únicos anti-duplicado. `git merge-tree` contra master `bd4e61c`: **sin conflictos**
(todo archivo nuevo + 6 líneas en `backend/persistencia.js`). Spec congelado: `docs/superpowers/specs/2026-08-22-centro-leads-design.md`.

## Principios (de CLAUDE.md, aplican a todas las fases)

- Cada fase: su rama + worktree desde master, spec/plan escrito, TDD, revisión independiente (si implementa Claude,
  revisa un agente Code Reviewer; si implementa Codex, no revisa Codex), prueba en navegador, **Victor mergea**.
- Alcance siempre del token (`alcanceSucursal`, `dentroDeAlcance` de `backend/auth.js`), 404 fuera de alcance.
- Permisos nuevos en `backend/permisosCatalogo.js` (módulo nuevo `mensajes`).
- Archivos (fotos, audios, documentos de clientes) **a Drive** con `subirArchivoADrive` (`backend/drive.js:262`), nunca al disco de Render.
- Sin dependencias nuevas sin autorización; secretos del proveedor en variables de entorno de Render (las pone Victor).
- Nada de esto toca caja, ventas ni inventario.

## Fases

### F0 — Rescatar `feature/centro-leads` en master (sin nada visible)
Rama `feature/bandeja-base` desde master; merge de `feature/centro-leads`.
- Correr sus 4 suites (67 pruebas) + suite completa.
- **Respaldo:** las tablas `leads`/`lead_*` hoy no se respaldan. Agregar respaldo propio siguiendo el molde de
  `backend/sicarRespaldo.js` (trozos cifrados a Drive, generaciones) y llamarlo desde `backend/respaldos.js` como SICAR.
- **Arranque:** hoy un fallo de su migración tumbaría el POS (`persistencia.js` → `server.js:131-140`). Aislarlo:
  si falla, el módulo de mensajes queda apagado con aviso y el POS sigue.
- Cerrar lo que su spec deja pendiente (sección 10): permiso `corregir_atribucion_lead` en catálogo.
- Archivos: `backend/centroLeads/*`, `backend/persistencia.js`, nuevo `backend/leadsRespaldo.js`, `backend/respaldos.js`, `backend/permisosCatalogo.js`.

### F1 — Conversaciones pegadas al cliente del CRM (servidor)
- Verificar qué cubren `lead_conversaciones`, `lead_interacciones`, `lead_identidades_externas`, `lead_eventos_externos`;
  si no guardan texto/medios por mensaje, migración V4 con `lead_mensajes`.
- **Un solo cliente, no "lead" y "cliente" por separado:** la identidad externa (número de WhatsApp, id de
  Messenger/Instagram) se liga a la persona del CRM por su ref (`crm:<id>` o `sicar:<suc>:<cli>`, `backend/crmFuentes.js`).
  Por teléfono se usa la regla estricta de `telefonos()` (`backend/sicarVinculos.js:12-28`): un candidato → liga con
  aviso; ambiguo → cola de revisión (mismo patrón que la unión SICAR). Sin coincidencia → cliente nuevo del CRM en la
  tienda del canal, respetando `validarContactoCliente` (`backend/clientes.js:182`).
- **Responsable:** el `vendedor_asignado_id` del cliente (`clientes.js`); conversación sin responsable = de la tienda.
  Cambios de responsable con `asignarLead`/`reasignarLead` (motivo obligatorio, historial).
- **Traspaso de cartera:** operación nueva "pasar los clientes y conversaciones de X a Y" con permiso propio, motivo e
  historial. `desactivarVendedor` (`backend/vendedores.js:202`) avisa si deja cartera sin traspasar.
- Registro de contacto automático en `DB.crm.contactos_cliente` (`backend/crm.js:140`) por cada conversación.
- Permisos (módulo `mensajes`): `ver_bandeja`, `responder_mensajes`, `ver_todas_conversaciones`,
  `reasignar_conversaciones`, `traspasar_cartera`, `conectar_canales_mensajes`.
- Rutas bajo `/api/mensajes/*` registradas en `backend/server.js` junto a CRM v2.

### F2 — La bandeja en pantalla, con un canal de prueba
- Pantallas nuevas (`src/Bandeja*.jsx`) y pestaña en el CRM: lista de conversaciones (mías / sin asignar de mi tienda /
  todas), hilo de mensajes, responder, tomar/reasignar, enlace a la ficha del cliente; en la ficha, sus conversaciones.
- Un **canal simulado** (adaptador de prueba) para probar todo en el navegador sin proveedor ni costo.
- Decisión de Victor pendiente para esta fase: ¿el vendedor ve el número completo del cliente o enmascarado? (si lo ve,
  puede copiarlo a su celular).

### F3 — Elegir proveedor (decisión de Victor, sin código)
- Comparar 2-3 proveedores autorizados por Meta (p. ej. Twilio, 360dialog, otro con coexistence): mensualidad, costo por
  mensaje en México, soporte de **coexistence** para conservar los números de tienda, Messenger e Instagram en la misma
  conexión, webhooks con firma. Documento con recomendación; Victor contrata y hace la verificación de negocio en Meta.

### F4 — Conectar el proveedor
- Webhook público montado antes de `express.json` (molde `registrarAgenteSicar`, `backend/sicarRutas.js:10-60`):
  cuerpo crudo, **firma del proveedor verificada con `timingSafeEqual`**, ritmo limitado, idempotencia por id externo
  (índice `ux_lead_interaccion_evento_externo`), registro de intentos.
- Envío saliente: texto dentro de la ventana de 24 h; fuera de ella solo plantillas aprobadas. Estados entregado/leído.
- Medios descargados y subidos a Drive (carpeta "Conversaciones" por tienda, molde `asegurarCarpeta*` de `drive.js`).
- Si Render se cae o reinicia: el proveedor reintenta; además reconciliación periódica de mensajes perdidos.
- Credenciales: variables de entorno en Render (Victor). Nunca en el JSON de estado (`validarMetadataNoSensible` ya lo protege).

### F5 — Piloto y despliegue por canal
1. WhatsApp de **Ocosingo** (coexistence), 1-2 semanas.
2. WhatsApp de las demás tiendas.
3. Messenger de la página de Unisound y las de tienda.
4. Instagram.
- Regla de negocio de Victor (fuera del código): los vendedores atienden solo por la bandeja.

### Después (fuera de este plan)
Campañas por WhatsApp con plantillas y consentimiento; rescate de `campanas-marketing`; enlaces rastreados en
publicaciones para el mérito de cada vendedor.

## Verificación por fase

- F0: 67 pruebas de centro-leads + suite completa backend 0 fallas; respaldo con tablas `lead_*` restaura y respaldos
  anteriores siguen restaurando; forzar fallo de migración y comprobar que el POS arranca.
- F1: pruebas de alcance (otra tienda → 404), permisos con permisos vecinos (no `permisos: []`), liga por teléfono
  (único / ambiguo / nuevo), traspaso de cartera con historial, idempotencia de eventos.
- F2: navegador con base de prueba: llega mensaje simulado → aparece sin asignar → vendedor lo toma → responde →
  queda en la ficha → se desactiva al vendedor → traspaso → el nuevo ve todo el historial; vendedora sin permiso no ve
  conversaciones ajenas.
- F4/F5: mensaje real de prueba al número de Ocosingo con el proveedor en modo prueba; firma inválida rechazada;
  mismo evento dos veces = un solo mensaje; foto llega a Drive.
