# Login con selección de sucursal + validación por ubicación (GPS)

**Fecha:** 2026-07-08
**Proyecto:** CORPUNISOUND (Unisound)
**Estado:** Diseño aprobado — listo para plan de implementación

## Objetivo

Reducir el riesgo de que una contraseña robada se use para entrar al sistema
desde un lugar distinto a la tienda del usuario. Al iniciar sesión, además de
usuario/contraseña, la persona selecciona su sucursal y el navegador
verifica su ubicación GPS contra la ubicación real de esa tienda — si no
coincide, se bloquea el login.

**Fuera de alcance:**
- Ubicación por IP (descartada: muy imprecisa en México/Chiapas y fácil de
  evadir con VPN).
- Bloqueo de cuenta tras varios intentos fallidos (solo se registra el
  intento; no hay lockout automático en este alcance).
- Geocercas dinámicas o soporte para tiendas móviles/temporales.

## Decisiones de diseño (acordadas)

1. **Ubicación vía GPS del navegador** (`navigator.geolocation`), no por IP.
   Requiere HTTPS (ya cumplido en Render) y permiso explícito del usuario en
   cada intento de login.
2. **Radio de tolerancia: 300 metros** alrededor de la coordenada configurada
   de cada tienda — suficiente para el margen de error típico del GPS en
   interiores sin ser tan amplio que alguien fuera de la tienda pase la
   validación.
3. **Selector de sucursal en el login**, junto a usuario/contraseña. La
   sucursal seleccionada debe coincidir con la sucursal real de la cuenta del
   usuario (la que ya trae su registro en `DB.admin.usuarios`) — si no
   coincide, bloqueado, sin llegar siquiera a checar el GPS.
4. **Si el navegador no puede obtener la ubicación** (el usuario rechaza el
   permiso, o el dispositivo no soporta geolocalización): login bloqueado.
   Sin ubicación no hay forma de validar, así que no se arriesga a dejar
   pasar a alguien sin verificar.
5. **Si la sucursal aún no tiene coordenadas configuradas:** se omite la
   validación de GPS y el login procede normal (para no dejar a una tienda
   sin acceso mientras Victor captura las 4 ubicaciones). En cuanto se
   configuran las coordenadas de esa tienda, la validación se activa sola.
6. **Administrador exento.** Sigue entrando con usuario/contraseña como hoy,
   sin selector obligatorio de sucursal ni validación de GPS — mantiene
   acceso a todas las tiendas igual que ahora (`ver_todas_las_sucursales`).
7. **Intentos bloqueados quedan registrados**, visibles solo para
   Administrador: usuario, sucursal que dijo ser, coordenadas detectadas,
   distancia a la tienda real, fecha/hora.
8. **Pantalla de configuración de ubicaciones** (solo Administrador), nueva,
   donde se captura o edita latitud/longitud de cada una de las 4 tiendas
   físicas (no aplica a MercadoLibre, que es virtual).

## Arquitectura

### Modelo de datos

**`DB.pos.sucursales`** — cada sucursal física gana campos opcionales:
```js
{ id: 1, nombre: "Ocosingo", ciudad: "Chiapas", lat: null, lng: null }
```
`lat`/`lng` en `null` = sucursal sin configurar → login sin validar GPS para
esa tienda (regla 5).

**Nueva colección `DB.admin.intentos_bloqueados_ubicacion`:**
```js
{
  id: 1,
  usuario: "cajero2",
  sucursal_dijo_id: 1,       // la que seleccionó en el login
  sucursal_dijo_nombre: "Ocosingo",
  sucursal_real_id: 2,       // la de su cuenta, para contraste
  lat_detectada: 17.9583,
  lng_detectada: -92.9128,
  distancia_metros: 187340,  // null si el motivo fue "sucursal no coincide" o "sin permiso GPS"
  motivo: "ubicacion_no_coincide", // | "sucursal_no_coincide" | "sin_permiso_ubicacion"
  fecha: "2026-07-08T10:00:00.000Z",
}
```

### Backend

**`backend/auth.js`**
- Nuevo helper `distanciaMetros(lat1, lng1, lat2, lng2)` — fórmula de
  Haversine, sin dependencias nuevas.
- Nuevo helper `validarUbicacionLogin(usuario, sucursalSeleccionadaId, lat, lng, DB)`
  → `{ ok: boolean, motivo?: string }`. Aplica las reglas 3–5: si el rol del
  usuario tiene `ver_todas_las_sucursales`, siempre `ok: true` (regla 6) sin
  pedir estos datos.

**`backend/server.js` — `POST /api/auth/login`**
- Recibe además `sucursal_id_seleccionada`, `lat`, `lng` (opcionales si el
  usuario es Administrador).
- Tras verificar usuario/contraseña: si el rol NO tiene
  `ver_todas_las_sucursales`, corre `validarUbicacionLogin`. Si falla,
  responde `401` con el motivo, y registra el intento en
  `intentos_bloqueados_ubicacion` (excepto cuando el motivo es "sucursal
  no configurada", porque ahí no hubo bloqueo).

**`backend/server.js` — nuevas rutas de configuración** (solo Administrador,
permiso `administrar_roles` reutilizado — no amerita permiso nuevo):
- `PUT /api/sucursales/:id/ubicacion` — captura/edita `lat`/`lng`.
- `GET /api/intentos-bloqueados` — lista para revisión del admin.

### Frontend

**`src/Login.jsx` (o donde viva el formulario de login)**
- Agrega selector de sucursal (4 tiendas físicas) visible siempre que se
  intente iniciar sesión (no sabemos de antemano si el usuario es admin
  hasta validar credenciales, así que el selector se muestra siempre; el
  backend simplemente lo ignora si el usuario resulta ser Administrador).
- Al enviar el formulario: pide `navigator.geolocation.getCurrentPosition`
  antes de mandar el POST a `/api/auth/login`. Si el usuario rechaza el
  permiso o el navegador no lo soporta, se manda igual el login sin
  `lat`/`lng` (el backend decide bloquear según la regla 4, salvo que sea
  Administrador).
- Mensajes de error específicos por motivo (`sucursal_no_coincide`,
  `ubicacion_no_coincide`, `sin_permiso_ubicacion`) traducidos a texto claro
  para el usuario, sin revelar la sucursal real de la cuenta (para no dar
  pistas a quien robó la contraseña).

**Pantalla nueva de Configuración → Ubicaciones de tiendas** (dentro de
Roles y Personal o Configuración, gateada por `administrar_roles`):
- Lista las 4 sucursales físicas con botón "Usar mi ubicación actual" (toma
  el GPS del navegador del admin, asumiendo que está parado en la tienda) y
  campos manuales de lat/lng como respaldo.

**Pantalla nueva de intentos bloqueados** (misma sección, mismo permiso):
tabla de solo lectura con los registros de `intentos_bloqueados_ubicacion`.

## Casos borde

1. **Usuario amarrado sin sucursal en su cuenta (no debería pasar, pero por
   robustez):** si `usuario.sucursal_id` es `null`/`undefined`, se trata como
   "sucursal no coincide" siempre — bloqueado.
2. **GPS con `null` lat/lng pero el usuario resulta Administrador:** login
   procede normal (regla 6), el helper ni siquiera evalúa la ubicación.
3. **Radio de 300 m ajustable a futuro:** se deja como constante en
   `auth.js` (no configurable desde la UI en este alcance) para poder
   afinarlo sin tocar el frontend si en la práctica resulta muy estricto o
   muy laxo en alguna tienda.
4. **Reintento tras bloqueo:** no hay lockout ni tiempo de espera — el
   usuario puede reintentar de inmediato (por ejemplo, si de verdad estaba
   fuera de rango por error de GPS, moverse y reintentar).

## Estrategia de pruebas

- `distanciaMetros` con coordenadas conocidas (verificar contra un cálculo
  de referencia).
- `validarUbicacionLogin`: usuario global siempre `ok`; usuario amarrado con
  sucursal seleccionada distinta a la real → `sucursal_no_coincide`; con
  sucursal correcta pero fuera del radio → `ubicacion_no_coincide`; con
  sucursal sin coordenadas configuradas → `ok` (regla 5); sin lat/lng →
  `sin_permiso_ubicacion`.
- Integración: `POST /api/auth/login` de un cajero real, dentro y fuera del
  radio de su tienda, y verificar que el intento fallido queda en
  `intentos_bloqueados_ubicacion`.
- Login de Administrador sin `sucursal_id_seleccionada` ni `lat`/`lng` sigue
  funcionando exactamente igual que hoy.
