# Despacho: marcar una sucursal SICAR como "dada de baja"

**Rama:** `feature/sicar-sucursal-baja` — **worktree:**
`C:\Users\Victor\Desktop\CORPUNISOUND\.claude\worktrees\seguimiento-mejoras` — **commit base:** `4b232ae` (master, con
la Fase 2 del seguimiento en producción). Un solo responsable de escritura: tú. Lee primero `CLAUDE.md` de la raíz.

**Pruebas (obligatorio con estas banderas):**
`cd backend && node --preserve-symlinks --preserve-symlinks-main --test sicarTraspasos.test.js seguimientoFactura/lector.test.js
seguimientoFactura/consultas.test.js seguimientoFactura/rutas.test.js ../src/seguimiento/seguimiento.test.js`
más los `.test.js` que toques. `integracion.test.js` y los de respaldo fallan en tu sandbox con EPERM al crear
temporales: si necesitas tocar `seguimientoFactura/respaldo.test.js` o `sicarRespaldo.test.js`, escribe la prueba y
repórtame que no la pudiste correr; la corre Claude. NO corras la suite completa. Al final
`npx eslint src backend --quiet`: 0 errores. No puedes hacer `git add`/`commit`: deja los cambios en el árbol.

## Contexto de negocio

Hay números de sucursal SICAR que eran tiendas que Unisound ya cerró (hoy el 3 y el 7). Tienen traspasos viejos
(envíos de 2024 y 2025 que nunca se marcaron como recibidos, ≈ $48,800) y nunca van a corresponder a una tienda de
CORPUNISOUND. Hoy la única forma de callar el aviso rojo "Hay sucursales de SICAR sin asignar" es asignarlas a una
tienda, lo cual sería mentira. Victor aprobó (2026-11-14): poder marcarlas "dada de baja"; dejan de salir en el aviso
rojo y sus envíos sin recibir quedan en una lista aparte, con folio y monto, para que no se pierdan de vista.

Regla del dueño que aplica: nada de esto se presenta como faltante de una tienda ni de una persona. Y toda operación
deja quién la hizo y cuándo.

## Qué construir (TDD: cada prueba se ve ROJA antes de implementar)

1. **Guardar la baja.** En `sicar_sucursales_mapa` dos columnas nuevas: `baja INTEGER NOT NULL DEFAULT 0` y
   `nombre TEXT` (nombre libre opcional de la tienda cerrada, máx. 60 caracteres, recortado; vacío = NULL).
   Migración en `sicarRepositorio.js` con el mismo patrón que ya usa `seguimiento_avisos`
   (`pragma table_info` + `ALTER TABLE ... ADD COLUMN`, ver ~línea 483) y la columna también en el `CREATE TABLE`.
   **Respaldo:** una copia vieja no trae esas columnas; al restaurar deben quedar `baja = 0`, `nombre = NULL`
   (mismo patrón que `saldo_revision`/`fecha_revision` en `sicarRespaldo.js` ~línea 338). Sin cambiar la lista de
   tablas ni la generación del respaldo. Prueba: restaurar una fila de mapa sin esas claves no falla y queda en 0/NULL;
   una copia nueva conserva `baja = 1` y el nombre.
2. **Marcar y desmarcar** en `asignarMapaSicar` (`sicarTraspasos.js`), misma ruta `PUT /api/sicar/sucursales-mapa`,
   mismo permiso (`administrar_sucursales`) y misma exigencia de alcance total. El cuerpo acepta además
   `baja` (booleano estricto: solo `true`/`false`; cualquier otro tipo → 400) y `nombre`.
   - `baja: true` exige `sucursal_id: null` (o ausente); con tienda asignada → 400 "Una sucursal dada de baja no puede
     tener tienda asignada." Asignar una tienda a un número que está de baja la quita de baja (`baja = 0`) en el
     mismo movimiento.
   - Historial (`sicar_sucursales_mapa_historial`): la baja se escribe con `nuevo = 'baja'`; quitarla, con
     `anterior = 'baja'`. Siempre con `actor` y `fecha`. Si no cambia nada (misma baja y mismo nombre), no escribe
     historial ni marca pendientes (idempotente, como hoy).
   - Sigue llamando a `marcarClavesDelNumeroSicar` cuando cambia la baja (el motivo del traspaso cambia, punto 4).
   - `listarMapaSicar` devuelve `baja` (booleano) y `nombre`.
3. **El aviso rojo las ignora.** `listarSinAsignarSicar` (`sicarTraspasos.js`) y `sicarSinAsignar`
   (`seguimientoFactura/consultas.js`) excluyen los números con `baja = 1`.
4. **Lista aparte.** `sicarSinAsignar` devuelve además
   `bajas: [{ sicar_sucursal, nombre, envios: [{ folio, fecha, sicar_origen, sicar_destino, origen, destino,
   total_centavos, dias }], total_centavos }]`: por cada número de baja, los traspasos **no cancelados y no
   recibidos** que lo tocan, una fila por (folio, suc_origen, suc_destino) como ya agrupa esa función (dinero en
   texto, `max(total_centavos)` del grupo, igual que hoy). `origen`/`destino` = `sucursal_id` de CORPUNISOUND según el
   mapa o `null`. `dias` = días desde `fecha` con `fechaLocal`. Orden: número SICAR, luego fecha ascendente. Un número
   de baja sin envíos abiertos sale con `envios: []`.
   En `lector.js`, cuando un traspaso es `sin_mapa` y el número sin tienda está de baja, el motivo pasa a ser
   `sucursal_baja` (misma conducta: solo observación, **no** mueve piezas, sigue contando una sola vez en
   "sin entender"). No toques el motor ni el reparto de piezas.
5. **Pantalla del seguimiento** (`src/seguimiento/SeguimientoFacturas.jsx`, `seguimiento.js`): debajo de donde va el
   aviso rojo, si hay bajas, un bloque neutro (gris/ámbar, **no** rojo) plegado por defecto:
   "Sucursales SICAR dadas de baja: SICAR 3 (Nombre) · 2 envíos sin recibir · $41,315.00 según SICAR". Al abrirlo,
   tabla con folio, fecha, origen → destino (nombre de tienda, o "SICAR n", o el nombre de la baja), días y dinero.
   Texto fijo: "Mercancía que SICAR dice que se envió a una tienda que ya cerró y nadie marcó como recibida. Hay que
   aclararla; no es faltante de ninguna tienda ni de ninguna persona." El texto del motivo `sucursal_baja` en la
   pestaña "En el camino y por aclarar": "Sucursal SICAR dada de baja". La lógica de texto/formato va en
   `seguimiento.js` con prueba.
6. **Pantalla del mapa** (`src/sicar/TraspasosSicar.jsx`, formulario de ~línea 150): en el selector de tienda de cada
   número SICAR, una opción más "Dada de baja (tienda cerrada)"; al elegirla aparece un campo "Nombre de la tienda
   cerrada (opcional)". Guardar manda `{ sicar_sucursal, sucursal_id: null, baja: true, nombre }`. Los números de baja
   se muestran en la tabla del mapa con la etiqueta "Dada de baja" y su nombre, y ya no en la lista de sin asignar.
   `type="submit"` explícito en el botón.

## Archivos autorizados

`backend/sicarTraspasos.js`, `backend/sicarRepositorio.js` (solo las dos columnas y su migración),
`backend/sicarRespaldo.js` (solo el relleno de las dos claves al restaurar), `backend/seguimientoFactura/consultas.js`,
`backend/seguimientoFactura/lector.js`, sus `.test.js` (y `sicarRutas.test.js`, `sicarRespaldo*.test.js`,
`seguimientoFactura/respaldo.test.js` si hace falta); `src/seguimiento/SeguimientoFacturas.jsx`,
`src/seguimiento/seguimiento.js`, `src/seguimiento/seguimiento.test.js`, `src/sicar/TraspasosSicar.jsx`.
**Prohibido** todo lo demás: `server.js`, `sicarRutas.js` (la ruta ya pasa `req.body` completo), `permisosCatalogo.js`,
`motor.js`, `servicio.js`, `render.yaml`.

## Reglas

- Sin dependencias nuevas. Ninguna línea de más de 200 caracteres. Acentos en UTF-8 real (sin `Ã³` ni `�`).
- Validación en el servidor y fallando cerrando: `baja` solo booleano; `nombre` solo texto; ids con `Number()`.
- Dinero en BigInt/texto, nada de float.
- Si mutas código para ver una prueba roja, revierte en el mismo paso.

## Pruebas mínimas

- Marcar baja: fila con `baja` 1 y nombre, historial `nuevo='baja'` con actor; repetir igual no agrega historial.
- `baja: true` con `sucursal_id` → 400; `baja: "true"` → 400; nombre de 61+ caracteres se recorta o da 400 (elige
  400 y dilo); usuario sin alcance total → 403 (como hoy).
- Asignar tienda a un número de baja lo quita de baja y deja historial `anterior='baja'`.
- Número de baja no aparece en `listarSinAsignarSicar` ni en `sin_asignar`; sí en `bajas` con sus envíos abiertos;
  un envío recibido o cancelado no aparece; el total suma solo los abiertos.
- Lector: traspaso posterior al corte hacia número de baja → motivo `sucursal_baja`, no mueve piezas, cuenta una vez.
- Respaldo viejo sin las columnas restaura con 0/NULL.

## Detente y reporta (no improvises) si

- Hace falta tocar un archivo prohibido, el motor, o cambiar la lista/generación de tablas del respaldo.
- Una prueba existente cambia de expectativa por algo distinto a agregar las claves nuevas (`baja`, `nombre`,
  `bajas`) a comparaciones de objeto completo (eso está autorizado: actualízalas y lístalas).

## Entrega

Conteo de pruebas por archivo, evidencia rojo→verde, eslint, `git status --short`, pruebas que no pudiste correr,
decisiones no cubiertas y qué hay que probar en el navegador.
