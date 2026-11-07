# Huecos graves de las auditorías de octubre 2026 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar los cinco huecos más graves de las auditorías del 2026-10-27, todos REPRODUCIDOS (sus pruebas corrieron
en la máquina de Victor):

| # | Hueco | Auditoría (rama `auditoria/...-2026-10`) |
|---|---|---|
| 1 | Cualquiera en internet reemplaza la cuenta de Google Drive y la de MercadoLibre | permisos A2 |
| 2 | Una cajera cobra con el monedero de cualquier cliente, de cualquier tienda | permisos C1 |
| 3 | Las ventas no guardan quién las cobró | permisos A3 |
| 4 | Con "Dar de alta personal" se crea un Administrador; crear roles no pide alcance global | permisos A1 |
| 5 | Un desconocido llena el disco de Render con intentos SICAR | sicar-crm A1 |

Más el freno de contraseñas del autorizador (permisos M1), porque el arreglo 2 agrega un segundo lugar donde se teclea
una contraseña ajena.

**Antes de empezar, lee** el hallazgo completo de cada uno en su rama (`git show origin/auditoria/permisos-2026-10:docs/auditorias/2026-10-permisos.md`,
`git show origin/auditoria/sicar-crm-2026-10:docs/auditorias/2026-10-sicar-crm.md`) y sus pruebas de reproducción
(`docs/auditorias/2026-10-permisos/reproducciones.test.cjs` en la rama de permisos; `backend/auditoria/sicarIntentos.auditoria.js`
en la de sicar-crm). **Cada Task convierte la reproducción correspondiente en una prueba normal de la suite que exige
lo contrario** (la reproducción pasaba porque el hueco existía; la prueba nueva debe estar ROJA en master y verde al
final).

## Decisiones de Victor (2026-10-27)

- **Monedero = permiso nuevo + autorización de otra persona**, como las cancelaciones. Una cajera sola no puede gastar el
  saldo de nadie.
- Lo demás se cierra como lo indica cada auditoría (decisiones de Claude, abajo).

## Global Constraints

- Sin dependencias nuevas. Líneas de 200 caracteres o menos. Staging por rutas explícitas. Commits sin acentos,
  terminando con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Sin push a master, merge ni rebase.
- Toda guarda en el SERVIDOR y fallando CERRANDO (lista de lo permitido). Ids del cuerpo normalizados con `Number(...)`
  cuidando `Number(null) === 0`. El alcance sale del token, nunca del selector ni del cuerpo (CLAUDE.md, reglas 1, 2, 4 y 5).
- Permisos nuevos se dan de alta en `backend/permisosCatalogo.js` con su módulo; el Administrador los recibe solo al
  arrancar (`reconciliarRoles`). Los demás roles NO: Victor los asigna a mano.
- Suite backend, `node --test src/`, `npx vite build` y `npx eslint src backend` en 0 fallas / 0 errores (fallas
  ambientales conocidas aparte, ver el encargo).
- No tocar `render.yaml`, `package.json`, `package-lock.json`, `agente-sicar/`, Cinco Caminos.

---

### Task 1: Google Drive y MercadoLibre solo se conectan con `state` de quien lo pidió

**Files:** `backend/server.js` (rutas `/api/drive/auth-url`, `/api/drive/callback`, `/api/ml/auth-url`,
`/api/ml/callback`, y las de desconectar si existen), `backend/drive.js`, `backend/mercadolibre.js` (solo si la URL de
autorización se arma ahí), un módulo chico nuevo `backend/oauthEstado.js` + su test.

- `auth-url` (ya con login y permiso) además exige **alcance global** (`requiereAlcanceGlobal`). Genera un `state`
  aleatorio (`crypto.randomBytes(32).toString('hex')`) y lo guarda **en memoria** con `{ proveedor, usuario_id,
  usuario_nombre, vence: ahora + 10 min }`. La URL de autorización lleva ese `state`.
- `callback`: sin `state`, con `state` desconocido, vencido o de otro proveedor → no toca nada y redirige con
  `?drive=error&msg=estado_invalido` (o `ml=`). El `state` es de un solo uso: se borra al usarlo, sirva o no.
- Al conectar se guarda en la cuenta `conectado_por_id`, `conectado_por_nombre` y `conectado_en` (el usuario del
  `state`). Si hay ruta de desconectar, pide el mismo permiso + alcance global y guarda quién desconectó.
- Comparación del `state` con `crypto.timingSafeEqual` (o búsqueda por llave exacta en un `Map`).
- Un reinicio del servidor borra los `state` pendientes: quien estaba conectando vuelve a apretar el botón. Aceptado.

- [ ] **Pruebas rojas:** callback sin `state` no cambia la cuenta (H2 y H2b de la reproducción, invertidas); `state`
  vencido, reutilizado y de otro proveedor se rechazan; con `state` válido se conecta y queda quién; `auth-url` sin
  alcance global → 403 (rol con `conectar_cuenta_drive` amarrado a una tienda, permisos vecinos).
- [ ] Implementar → GREEN → **Commit** `fix(seguridad): drive y mercadolibre solo se conectan con state de quien lo pidio`

### Task 2: Las ventas guardan quién las cobró

**Files:** `backend/ventas.js` (`crearVenta`), `backend/server.js` (ruta `POST /api/ventas`), `backend/mercadolibre.js`
(importar orden) + tests.

- La venta guarda `cobrada_por_id` y `cobrada_por_nombre` **del token** (`req.usuarioToken`), nunca del cuerpo. Si el
  cuerpo trae esos campos, se ignoran.
- Las importadas de MercadoLibre guardan el usuario que apretó "Importar". Si hay una importación automática sin
  usuario, `cobrada_por_id: null` y `cobrada_por_nombre: 'MercadoLibre (automático)'`.
- `crearVenta(DB, datos)` hoy tiene DOS argumentos y muchas pruebas lo llaman así: agrega el usuario como dato aparte sin
  romper esas llamadas (por ejemplo, tercer argumento opcional), y que la RUTA siempre lo mande. Una venta creada sin
  usuario desde la ruta es un error de programación: la prueba de la ruta lo cubre.
- Las ventas viejas se quedan sin el campo; la pantalla de consulta muestra "Sin dato" para ellas. Muestra "Cobró:
  <nombre>" en el detalle de la venta (busca dónde se muestran `cancelada_por` y el vendedor).

- [ ] **Pruebas rojas:** por la ruta, la venta queda con el usuario del token aunque el cuerpo mande otro; importar de
  ML guarda quién importó.
- [ ] Implementar → GREEN → **Commit** `fix(ventas): cada venta guarda quien la cobro`

### Task 3: Freno y función única para el autorizador

**Files:** `backend/server.js` (cancelar venta, ~líneas 2046-2066), nuevo `backend/autorizador.js` + test, y
`backend/intentosLogin.js` solo si se reutiliza su contador.

- Extrae la verificación del autorizador de la cancelación a `verificarAutorizador(DB, credenciales, { solicitante,
  permiso, sucursalId, resolverPermisosDeRol, registro })` que devuelve `{ id, nombre }` o lanza el error genérico
  "La autorización no es válida" (403). Mismas reglas de hoy: usuario activo, contraseña correcta, distinto de quien
  pide, con el permiso pedido, y de la misma sucursal salvo `ver_todas_las_sucursales`.
- **Freno:** cada fallo cuenta contra el usuario autorizador tecleado Y contra quien lo pide; tras 5 fallos en
  15 minutos, ese par queda bloqueado 15 minutos y responde el mismo 403 genérico (sin decir que es bloqueo, para no
  dar pistas). Reusa `crearRegistroIntentos` de `intentosLogin.js` si encaja; si no, uno igual en memoria.
- La cancelación pasa a usar esta función sin cambiar su comportamiento visible.

- [ ] **Pruebas rojas:** 6 contraseñas malas seguidas → la sexta, aun con la contraseña buena, se rechaza (M1 de la
  reproducción, invertida); las pruebas actuales de cancelación siguen verdes sin tocarse.
- [ ] Implementar → GREEN → **Commit** `fix(seguridad): freno al autorizador y una sola verificacion`

### Task 4: Monedero con permiso propio y autorización de otra persona

**Files:** `backend/permisosCatalogo.js`, `backend/ventas.js`, `backend/server.js` (`POST /api/ventas`),
`src/PuntoDeVenta.jsx` (o el componente del botón "Aplicar monedero") + tests.

- Permisos nuevos, módulo `pos`: `aplicar_monedero` ("Aplicar monedero de un cliente") y `autorizar_monedero`
  ("Autorizar uso de monedero"). Ninguno se agrega a los roles sembrados salvo Administrador (por reconciliación).
- Con `monedero_aplicado > 0`, la RUTA exige, antes de llamar a `crearVenta` y antes de tocar el saldo:
  1. que quien cobra tenga `aplicar_monedero`; si no → 403 "No tienes permiso para aplicar monedero";
  2. que el cliente esté **dentro del alcance de quien cobra** (`dentroDeAlcance(cliente.sucursal_id, alcance del token)`;
     usa el campo de sucursal real del cliente; un cliente sin sucursal solo lo usa quien tiene alcance global);
     fuera de alcance → 404 "Cliente no encontrado";
  3. `autorizador: { usuario, password }` válido con `verificarAutorizador(..., { permiso: 'autorizar_monedero',
     sucursalId: <sucursal de la venta> })` → si no, el 403 genérico.
- La venta guarda `monedero_autorizado_por_id` y `monedero_autorizado_por_nombre`.
- Todo o nada: si la autorización falla, el saldo del cliente NO cambia y no se crea la venta.
- Pantalla: el botón "Aplicar monedero" solo aparece con `aplicar_monedero`; al cobrar con monedero pide usuario y
  contraseña de quien autoriza (copia el patrón de la ventana de autorización de cancelación). Modales con scroll,
  `type="submit"`, funciona a 390 px. No guardar la contraseña en estado más allá del envío.

- [ ] **Pruebas rojas** (H3 de la reproducción invertida, más):
  - cajera sin `aplicar_monedero` → 403 y el saldo no baja;
  - con el permiso, cliente de otra tienda → 404 y el saldo no baja;
  - sin autorizador, autorizador = ella misma, sin `autorizar_monedero`, de otra sucursal o contraseña mala → 403 y el
    saldo no baja;
  - con todo correcto: el saldo baja, la venta guarda quién autorizó y quién cobró, y el corte sigue cobrando
    `total - monedero_aplicado` (las pruebas de corte con monedero siguen verdes);
  - `cliente_id` como texto ("7") se trata igual que 7.
- [ ] Implementar → GREEN → **Commit** `fix(monedero): permiso propio y autorizacion de otra persona`

### Task 5: Alta de personal y roles sin escalada

**Files:** `backend/server.js` (`POST /api/usuarios` ~1508, `POST /api/roles` ~1489), `backend/usuarios.js`
(`crearUsuario`) + tests.

- `POST /api/roles` exige alcance global, igual que editar, borrar y clonar.
- `POST /api/usuarios`:
  - quien tiene alcance global: como hoy;
  - quien NO: solo puede dar de alta en **su** sucursal (la del token; si el cuerpo trae otra → 403), y solo con un rol
    cuyos permisos sean un subconjunto de los suyos y que no incluya `ver_todas_las_sucursales` ni
    `administrar_roles`. Si no → 403 "No puedes dar de alta con ese rol". El `rol_id` se normaliza con `Number`.
- El usuario nuevo guarda `creado_por_id`, `creado_por_nombre` y `creado_en` del token.
- La pantalla de alta, para quien no tiene alcance global, solo ofrece los roles permitidos y su sucursal (que el
  servidor ya decide; la pantalla solo deja de ofrecer lo que se rechazaría).

- [ ] **Pruebas rojas:** H1 de la reproducción invertida (rol 1 desde un gerente amarrado → 403 y no se crea); rol con
  un permiso que el creador no tiene → 403; otra sucursal → 403; `rol_id` "1" como texto → 403; un alta válida guarda
  quién la hizo; `POST /api/roles` sin alcance global → 403.
- [ ] Implementar → GREEN → **Commit** `fix(personal): alta de usuarios y roles sin escalada y con autor`

### Task 6: Intentos SICAR sin llenar el disco

**Files:** `backend/sicarRutas.js` (`responder`, ~19-53), `backend/sicarRepositorio.js` (`registrarIntento` ~606) + tests.

- **No se escribe fila** para respuestas 429 (freno) ni para 401 **sin llave reconocida** (petición anónima o llave que
  no existe). Esos casos solo suben un contador en memoria por minuto (`{ minuto, anonimos_401, frenados_429 }`, los
  últimos 60 minutos) que la pantalla de "Envíos SICAR" puede mostrar si ya lee intentos; si no, basta con
  `console.warn` una vez por minuto cuando el contador pasa de 100.
- Los intentos de una llave **reconocida** se siguen registrando como hoy (son los que sirven para diagnosticar a una
  tienda), pero con **retención**: al insertar, si la tienda tiene más de 5,000 filas, se borran las más viejas hasta
  quedar en 5,000. Y al arrancar se borran las de más de 30 días.
- Sin cambiar el contrato del agente (`docs/sicar-contrato-v1.md`): mismas respuestas y códigos.

- [ ] **Pruebas rojas:** A1 de `sicarIntentos.auditoria.js` invertida (40 anónimas → 0 filas nuevas); 429 no escribe;
  una llave real con 5,010 intentos queda en 5,000; los de más de 30 días se borran al arrancar; las pruebas actuales de
  `sicarRutas*.test.js` siguen verdes.
- [ ] Implementar → GREEN → **Commit** `fix(sicar): intentos anonimos sin fila y retencion por tienda`

## Review Focus

1. Ninguna guarda depende de la pantalla; todas fallan cerrando y con ids normalizados.
2. Monedero: con cualquier falla, el saldo del cliente queda intacto.
3. El `state` es aleatorio, de un solo uso, con vencimiento y ligado a proveedor y usuario.
4. Nadie puede crear una cuenta o un rol con más poder que el suyo.
5. El agente SICAR de Ocosingo sigue funcionando igual (mismo contrato).
6. Lo que necesita Victor después del merge: dar `aplicar_monedero` y `autorizar_monedero` a quien corresponda, y volver
   a conectar Drive y MercadoLibre solo si la conexión se perdió (no debería: el cambio es en el próximo conectar).
