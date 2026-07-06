# Fase 3 — Aislamiento de datos por sucursal

**Fecha:** 2026-07-06
**Proyecto:** punto-de-venta (Unisound)
**Estado:** Diseño aprobado — listo para plan de implementación

## Objetivo

Que cada una de las 4 sucursales (1 Ocosingo, 2 Yajalón, 3 San Cristóbal,
4 Palenque) vea **solo sus propios datos**, según el usuario que inicia sesión.
Un usuario con permiso especial (`ver_todas_las_sucursales`) puede ver todas
las tiendas o filtrar a una sola.

**Fuera de alcance (dependencias futuras, NO se resuelven aquí):**
- Persistencia en archivo/BD (hoy los datos viven en memoria y se pierden al
  reiniciar). La Fase 3 solo aísla; no persiste.
- Revisión de seguridad completa para exponer el backend a internet (Fase 4).

## Principio rector

> La sucursal del usuario se define al hacer login y viaja **dentro del token
> JWT** (firmado, no falsificable). El backend **nunca** confía en el
> `sucursal_id` que manda el navegador, salvo para quien tenga el permiso
> `ver_todas_las_sucursales`.

Esto cierra el hueco actual: hoy endpoints como `/api/cortes` y
`/api/condiciones-pago` leen `?sucursal_id=` del query param y confían en él,
así que cualquiera podría pedir la sucursal que quiera.

## Decisiones de diseño (acordadas)

1. **Visibilidad por permiso, no por rol.** Nuevo permiso
   `ver_todas_las_sucursales`, administrable desde Roles y Personal (respeta la
   convención de permisos del proyecto: `permisosCatalogo` + `requierePermiso` +
   gating frontend). Quien lo tiene ve global; quien no, solo su sucursal.

2. **Datos propios de cada sucursal (se filtran):**
   - Ventas y cortes de caja
   - Inventario / existencias
   - Clientes y CRM

   **Datos compartidos entre las 4 (sin filtro):**
   - Catálogo de productos, categorías y proveedores
   - Cliente "Público en General" (id 0) — cliente de mostrador, visible en todas

3. **La IA respeta el aislamiento.** El asistente ve exactamente lo que el
   usuario puede ver. Usuario global → puede preguntar por todas o por una tienda.
   Usuario amarrado → la IA solo consulta su sucursal.

4. **Vista global con selector.** El usuario global ve un selector arriba
   (*Todas / Ocosingo / Yajalón / San Cristóbal / Palenque*) que filtra toda la
   pantalla. El usuario amarrado no ve selector, solo una etiqueta fija con el
   nombre de su sucursal.

5. **Datos de prueba repartidos** entre las 4 sucursales para poder demostrar el
   aislamiento (hoy todo está en la sucursal 1).

## Arquitectura

### Componente central: `alcanceSucursal(req, permisos)`

Un solo helper (nuevo, en `auth.js` o módulo propio) que toda ruta usa para
resolver qué puede ver el usuario. Interfaz:

- **Entrada:** el request (que ya trae `req.usuarioToken` con `sucursal_id`) y
  la lista de permisos del rol.
- **Salida:** un objeto tipo
  `{ verTodas: boolean, sucursalId: number | null }`
  - Si el usuario tiene `ver_todas_las_sucursales`:
    - Con `?sucursal_id=N` válido → `{ verTodas: false, sucursalId: N }`
    - Sin query o con "todas" → `{ verTodas: true, sucursalId: null }`
  - Si NO tiene el permiso → **siempre** `{ verTodas: false, sucursalId:
    <sucursal del token> }`, ignorando cualquier query param.

Un helper acompañante `filtrarPorSucursal(lista, alcance)` aplica el filtro a
cualquier arreglo que tenga campo `sucursal_id` (respetando `verTodas`).

**Por qué un solo helper:** centraliza la regla. Si cambia, se cambia en un
lugar. Cada endpoint solo llama al helper y filtra; no reimplementa la lógica.

### Cambios en backend

**`auth.js`**
- `firmarToken(usuario)` incluye `sucursal_id` en el payload (hoy solo
  `id, nombre, rol_id`).
- Nuevo helper `alcanceSucursal` + `filtrarPorSucursal`.

**`permisosCatalogo.js`**
- Nuevo permiso `ver_todas_las_sucursales` en el módulo `admin`.
- El guardia de arranque (`validarPermisos.js`) seguirá pasando porque apunta a
  un módulo existente.

**`server.js` — lectura** (`/api/ventas`, `/api/cortes`, `/api/crm/*`,
existencias/inventario, `/api/clientes`):
- Pasan a exigir `requiereLogin` (⚠️ hoy varios GET no piden login; es un
  cambio necesario para poder leer la sucursal del token).
- Filtran resultados con `alcanceSucursal` + `filtrarPorSucursal`.

**`server.js` — escritura** (`/api/ventas`, `/api/cortes`, `/api/clientes`):
- Al crear, se **estampa `sucursal_id` desde el token**, no desde el body.
  Un cajero de Palenque no puede registrar datos "a nombre de" Ocosingo.

**Compartido sin filtro:** `/api/productos`, `/api/categorias`,
`/api/proveedores` no cambian su alcance de datos.

### Cambios en el Asistente de IA (`/api/chat`)

1. **System prompt** informa a la IA:
   - El alcance del usuario (global o sucursal N).
   - Los nombres de las sucursales (1=Ocosingo, 2=Yajalón, 3=San Cristóbal,
     4=Palenque), para que entienda cuando el usuario dice "Palenque" y pueda
     desglosar por tienda.
2. **`consultarModulo`** aplica `alcanceSucursal`:
   - Usuario global → puede filtrar por la sucursal pedida o traer todas.
   - Usuario amarrado → se le fuerza su sucursal; aunque pregunte por otra, la
     herramienta solo devuelve la suya.
3. **`venta_detalle`** no tiene `sucursal_id` propio (se relaciona por
   `venta_id`). Para el usuario amarrado, se filtra cruzando contra las ventas
   visibles de su sucursal.

### Cambios en frontend

**Respuesta de login y `/api/auth/yo`:** agregar `sucursal_id`, nombre de la
sucursal, y si el usuario tiene vista global (ya devuelven `permisos` y
`modulos`).

**Selector de sucursal** (`src/`, componente nuevo o en el layout principal):
- Visible solo si el usuario tiene `ver_todas_las_sucursales`.
- Opciones: *Todas / Ocosingo / Yajalón / San Cristóbal / Palenque*.
- Su valor filtra Dashboard, Consultas de Ventas, Corte de Caja, CRM,
  Inventario, y lo que se manda a la IA.

**Etiqueta fija** para el usuario amarrado: muestra "Sucursal: <nombre>" sin
posibilidad de cambio.

**`src/api.js`:** agrega el `sucursal_id` seleccionado a las peticiones. Para el
usuario amarrado el backend lo ignora (usa el token); para el global es lo que
indica qué tienda quiere ver.

## Casos borde

1. **Público en General (cliente id 0):** compartido, nunca se filtra por
   sucursal — es el cliente de mostrador de todas las tiendas.
2. **Datos actuales todos en sucursal 1:** se repartirán los datos de prueba
   (ventas, existencias, clientes, cortes) entre las 4 sucursales para poder
   demostrar el aislamiento. Como son datos en memoria, no hay migración real.
3. **Tablas hijas sin `sucursal_id`** (`venta_detalle`): se filtran cruzando por
   la tabla padre (`ventas`).
4. **Token viejo sin `sucursal_id`:** tras el cambio, sesiones anteriores no
   traen `sucursal_id`. Se maneja como usuario sin sucursal → forzar re-login o
   default seguro (definir en implementación).

## Estrategia de pruebas

- **Unitarias del helper `alcanceSucursal`:** usuario global con/sin query,
  usuario amarrado ignorando query, token sin sucursal.
- **Integración de endpoints:** login como cajero de Yajalón y verificar que
  `/api/ventas`, `/api/cortes`, `/api/clientes` solo devuelven Yajalón; que un
  POST estampa la sucursal del token aunque el body diga otra.
- **IA:** usuario amarrado no obtiene datos de otra sucursal por el chat;
  usuario global sí puede desglosar por tienda.
- **Frontend:** selector visible solo con el permiso; etiqueta fija para el
  amarrado; el filtro se propaga a todas las pantallas.
- **Datos repartidos:** confirmar que cada sucursal muestra su subconjunto y que
  Público en General aparece en todas.
