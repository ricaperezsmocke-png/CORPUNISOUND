# Dashboard de Personal en Roles y Personal — Design

## Contexto

En `src/AdminRoles.jsx` (pantalla "Roles y Personal"), el personal ya se carga completo en el frontend (`GET /api/usuarios`, guardado en el estado `usuarios`), pero hoy solo se usa para mostrar un conteo ("N persona(s) con este rol") junto al selector de rol activo. No existe ninguna vista que liste a todo el personal, ni forma de editar a alguien ya dado de alta (solo existe "Dar de alta personal" para crear).

El backend ya tiene una ruta `PUT /api/usuarios/:id` (`administrar_roles`) conectada a `actualizarUsuario(DB, id, datos)` en `backend/usuarios.js`, que hoy soporta actualizar `nombre`, `rol_id` y `activo` — pero **ninguna pantalla la usa todavía**. `actualizarUsuario` ignora cualquier campo `password` en el body (no hashea ni actualiza `password_hash`). No existe ninguna ruta `DELETE /api/usuarios/:id`.

Se confirmó por revisión de código que es seguro permitir un borrado real (no solo desactivación): tanto `backend/cortes.js` (`crearCorte`) como `backend/compras.js` (`crearRecepcion`) guardan `usuario_id` **junto con** `usuario_nombre` como una copia fija tomada al momento de crear el registro — no hacen una búsqueda en vivo contra la lista de usuarios. `src/CorteCaja.jsx` efectivamente muestra `usuario_nombre` (la copia fija) en su historial. `src/RecepcionCompras.jsx` no muestra actualmente quién registró cada recepción, así que tampoco hay ningún riesgo de regresión ahí. Por lo tanto, borrar un `usuario` no rompe ni deja huecos en ningún historial existente.

## Objetivo

Agregar una sub-pestaña "Personal" dentro de la pantalla "Roles y Personal" que muestre una tabla con todo el personal dado de alta (Nombre, Usuario, Rol, Sucursal, Estado), donde cada fila se pueda abrir para editar nombre/rol/contraseña, activar/desactivar, o eliminar permanentemente a esa persona.

## Arquitectura

**Frontend (`src/AdminRoles.jsx`):**
- Nuevo estado local `vistaRoles` ("roles" | "personal") que alterna entre la vista actual (selector de rol + permisos) y la nueva tabla de personal, dentro del `vistaAdmin === "roles"` existente (no toca las pestañas de nivel superior "Ubicaciones de Tiendas" / "Intentos Bloqueados").
- Nueva sub-barra de dos botones tipo pestaña ("Roles" / "Personal") justo debajo de la barra de herramientas existente (F3 Agregar, F4 Editar, etc. — esos botones siguen aplicando solo a roles y solo se muestran en la sub-vista "Roles").
- Tabla de Personal: columnas Nombre, Usuario, Rol (nombre resuelto vía `roles.find`), Sucursal (nombre resuelto vía una lista de sucursales que se carga igual que en otras pantallas — `GET /api/sucursales`), Estado (badge verde "Activo" / gris "Inactivo"). Fila completa clickeable (`onClick`) para abrir el modal de edición, siguiendo el mismo patrón visual de tabla que `InventarioProductos.jsx`/`Traspasos.jsx`.
- Modal de edición (reutiliza el patrón de `Modal`/`modalPersonal` ya existente, extendido con un modo "editar" análogo a como `InventarioProductos.jsx` distingue `modoForm: "crear" | "editar"`):
  - Campo Nombre (texto, precargado).
  - Campo Rol (select, precargado con `rol_id` actual).
  - Campo "Nueva contraseña (opcional)" (texto, vacío por default — si se deja vacío, no se cambia la contraseña).
  - Botón "Guardar cambios" → `PUT /api/usuarios/:id` con `{ nombre, rol_id, password? }` (password solo si no está vacío).
  - Botón "Activar"/"Desactivar" (según `activo` actual) → `PUT /api/usuarios/:id` con `{ activo: !activoActual }`.
  - Botón "Eliminar" (rojo) → confirmación nativa `confirm()` (mismo patrón que `eliminarRolActivo`/`eliminarSeleccionado` en otras pantallas) con texto explícito de que es irreversible → `DELETE /api/usuarios/:id`.
  - Todos los botones de acción deshabilitados/ocultos si la persona que se está editando es el usuario actualmente logueado (ver "Protección de autoservicio" abajo).

**Backend (`backend/usuarios.js` + `backend/server.js`):**
- `actualizarUsuario(DB, id, datos)` se extiende: si `datos.password` viene definido y no vacío, valida longitud mínima (mismas reglas que `crearUsuario`: al menos 6 caracteres) y actualiza `password_hash` vía `hashearPassword`. Si no viene, no toca la contraseña actual.
- Nueva función `eliminarUsuario(DB, id)` en `usuarios.js`: encuentra y remueve el usuario del arreglo `DB.admin.usuarios`. Lanza error si no existe.
- Nueva ruta `DELETE /api/usuarios/:id` (permiso `administrar_roles`, mismo que editar) en `server.js`, llamando a `eliminarUsuario`.
- **Protección de autoservicio (nueva, en ambas rutas PUT y DELETE):** si `req.params.id == req.usuarioToken.id` y la operación es una desactivación (`datos.activo === false`) o un borrado, la ruta responde `400` con un mensaje claro ("No puedes desactivarte/eliminarte a ti mismo mientras tienes la sesión abierta"). Esto vive en el backend (no solo ocultando el botón en frontend) siguiendo la convención ya establecida de este proyecto ("el frontend oculta, el backend igual deniega").

## Flujo de datos

1. Al entrar a la sub-pestaña "Personal", se reutilizan `usuarios`, `roles` y `sucursales` — los tres ya están cargados en el estado del componente (`sucursales` ya se carga hoy para la vista "Ubicaciones de Tiendas", vía `GET /api/sucursales` en la línea ~35 de `AdminRoles.jsx`). No se necesita ninguna llamada nueva a la API solo para mostrar la tabla.
2. Guardar cambios / activar-desactivar / eliminar → llamada a la API correspondiente → en éxito, `mostrarAviso(...)` + `cargarTodo()` para refrescar la tabla (mismo patrón que el resto de la pantalla) → cierra el modal.
3. En error (validación del backend, intento de autoservicio, etc.) → `mostrarAviso("❌ " + e.message)`, el modal se queda abierto para corregir.

## Manejo de errores

- Nombre vacío, rol no seleccionado: mismas validaciones que "Dar de alta personal" (reutilizar mensajes).
- Contraseña nueva con menos de 6 caracteres (si se intentó cambiar): rechazada por el backend con mensaje claro.
- Intento de autoservicio (desactivarse/eliminarse a uno mismo): bloqueado en backend con mensaje claro; en frontend, los botones correspondientes se ocultan directamente si `personaEditada.id === usuario.id` para evitar el error en primer lugar (pero el backend es la protección real).
- Eliminar a alguien con rol ya eliminado o rol inexistente (caso raro, dato corrupto): la tabla debe mostrar "Rol desconocido" en vez de tronar, igual que otros lugares del sistema resuelven nombres con fallback (`nombreSucursal`/`nombreProducto` en `Traspasos.jsx` ya usan este patrón).

## Testing

- Backend: `backend/usuarios.test.js` no existe todavía (confirmado) — se crea nuevo, cubriendo:
  - `actualizarUsuario` cambia la contraseña cuando se manda una nueva válida.
  - `actualizarUsuario` NO cambia la contraseña cuando no se manda (o se manda vacía).
  - `actualizarUsuario` rechaza una contraseña nueva de menos de 6 caracteres.
  - `eliminarUsuario` remueve al usuario correctamente.
  - `eliminarUsuario` lanza error si el id no existe.
  - Ruta `PUT /api/usuarios/:id` rechaza desactivar/nada raro cuando `id` es el del usuario logueado (test de integración a nivel ruta, o test directo de la función de protección si se extrae como helper).
  - Ruta `DELETE /api/usuarios/:id` rechaza eliminar al usuario logueado.
  - Confirmar que borrar un usuario NO afecta el `usuario_nombre` ya guardado en un corte de caja existente (test de regresión directa sobre el escenario que motivó esta decisión de diseño).
- Frontend: sin harness automatizado (no existe en este proyecto) — verificación manual en navegador real (Playwright + Chrome del sistema) contra una base de datos aislada temporal, cubriendo: ver la lista, editar nombre/rol, cambiar contraseña y confirmar que el login viejo ya no sirve pero el nuevo sí, activar/desactivar, eliminar, e intentar (y confirmar que se bloquea) la autodesactivación/autoeliminación.

## Fuera de alcance

- No se agrega búsqueda/filtro a la tabla de Personal (la cantidad de personal esperada para 5 tiendas es pequeña; se puede agregar después si hace falta).
- No se modifica el campo `usuario` (nombre de login) desde este modal — cambiarlo tiene implicaciones de unicidad no cubiertas por este diseño; si Victor lo necesita, es una extensión futura.
- No se modifica `sucursal_id` desde este modal (reasignar a alguien de sucursal no se pidió explícitamente); queda para una extensión futura si se necesita.
