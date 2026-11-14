# Despacho: Seguimiento de Facturas — Fase 3 "Salud del cálculo a la vista"

**Rama:** `feature/seguimiento-salud` — **worktree:**
`C:\Users\Victor\Desktop\CORPUNISOUND\.claude\worktrees\seguimiento-mejoras` — **commit base:** `7f4e4cb` (master).
Un solo responsable de escritura: tú. Lee primero `CLAUDE.md` de la raíz y, del plan
`docs/superpowers/plans/2026-11-13-seguimiento-facturas-mejoras.md`, el **hallazgo 7** y la **Fase 3**.

**Pruebas (obligatorio con estas banderas):**
`cd backend && node --preserve-symlinks --preserve-symlinks-main --test seguimientoFactura/servicio.test.js
seguimientoFactura/consultas.test.js seguimientoFactura/rutas.test.js seguimientoFactura/respaldo.test.js
sicarRepositorio.test.js sicarRespaldo.test.js sicarTraspasos.test.js ../src/seguimiento/seguimiento.test.js`
`integracion.test.js` y parte de los de respaldo pueden fallar en tu sandbox con EPERM al crear temporales: si pasa,
escribe/ajusta la prueba igual y reporta cuáles no pudiste correr; las corre Claude. NO corras la suite completa.
Al final `npx eslint src backend --quiet`: 0 errores. No puedes hacer `git add`/`commit`: deja los cambios en el árbol.

## Contexto de negocio

El seguimiento recalcula cada artículo ("clave") cuando llegan datos nuevos de SICAR. Hoy, si una clave truena al
recalcularse, se manda al final de la fila y se reintenta **cada segundo, para siempre**, y el error se tira sin
escribirse en ningún lado (`servicio.js` `procesarPendientes` y `rutas.js` `iniciarCiclosSeguimiento`). Las facturas
de esa clave se quedan con el cálculo viejo y **nadie se entera**: la pantalla enseña "Datos al" (cuándo mandó SICAR),
no cuándo se calculó. Para el dueño eso es una factura que cuenta una historia vieja sin avisar.

## Qué construir (TDD: cada prueba se ve ROJA antes de implementar)

1. **Contar los intentos y escribir el error.** En `seguimiento_pendientes` tres columnas nuevas:
   `intentos INTEGER NOT NULL DEFAULT 0`, `ultimo_error TEXT`, `ultimo_intento TEXT`. En `sicarRepositorio.js`: en el
   `CREATE TABLE` y con migración `pragma table_info` + `ALTER TABLE ... ADD COLUMN`, mismo patrón que ya usan
   `seguimiento_avisos` y `sicar_sucursales_mapa`. **Respaldo** (`sicarRespaldo.js`, mismo bloque donde se rellenan
   `baja`/`nombre` del mapa): una copia vieja no trae esas claves; al restaurar quedan `0`/`NULL`/`NULL`. Sin cambiar
   la lista de tablas ni la generación del respaldo.
   En `procesarPendientes`, cuando una clave falla: `intentos = intentos + 1`, `ultimo_error` = mensaje del error
   recortado a 300 caracteres (solo `e.message`, nunca la pila), `ultimo_intento = ahora`, y sigue pasando al final de
   la fila (`desde = ahora`) como hoy.
2. **Dejar de reintentar.** Constante `INTENTOS_MAXIMOS = 5` (exportada, en `servicio.js`). Una clave con
   `intentos >= 5` está **atorada**: `procesarPendientes` no la toma, y `quedan` cuenta **solo** las no atoradas (así
   el ciclo de `rutas.js` deja de reprogramarse cada segundo por ella). El resultado agrega `atoradas` (cuántas hay).
   Las demás claves siguen avanzando aunque haya atoradas.
3. **Segunda oportunidad cuando cambian los datos.** Una atorada vuelve a `intentos = 0` (conservando `ultimo_error`
   hasta que se recalcule bien) cuando: (a) `marcarPendientes` (`pendientes.js`) vuelve a marcar esa clave porque
   llegó un lote que la toca; (b) la vuelta diaria `vueltaCompleta` la vuelve a marcar; (c) alguien aprieta
   "Reintentar" (punto 5). En (a) y (b) hoy hay `ON CONFLICT(clave) DO NOTHING`: cámbialo a un `DO UPDATE` que
   **solo** ponga `intentos = 0` y **no** toque `desde` (el `desde` más viejo se conserva, como hoy). Cuando una clave
   se recalcula bien, su fila se borra como hoy (`servicio.js:114`).
4. **Ruta de salud:** `GET /api/seguimiento-facturas/salud`, permiso de **ver** el módulo, registrada **antes** de la
   ruta `/:sucursal_id/:com_id`. Devuelve:
   `{ ultimo_calculo, en_fila, mas_vieja_desde, atoradas: [{ clave, intentos, ultimo_error, ultimo_intento,
   facturas: [{ sucursal_id, com_id, folio, proveedor }] }], intentos_maximos }`.
   `ultimo_calculo` = `max(calculado_en)` de `seguimiento_resultado` (o `null`); `en_fila` = pendientes no atoradas;
   `mas_vieja_desde` = el `desde` más viejo de las no atoradas (o `null`); `facturas` = las compras que tienen
   resultado guardado de esa clave (son las que se quedaron con el cálculo viejo), máximo 20 por clave. `atoradas`
   ordenadas por `ultimo_intento` descendente, máximo 100. La lógica va en `consultas.js`. El alcance es el del
   módulo (igual que las demás rutas de ver); **no** leas `?sucursal_id=`.
5. **Reintentar a mano:** `POST /api/seguimiento-facturas/salud/reintentar`, permiso de **gestionar** el módulo.
   Cuerpo `{ clave }` (texto no vacío; cualquier otra cosa → 400) o `{ todas: true }` (booleano estricto). Pone
   `intentos = 0` en esa(s) clave(s) atoradas y responde `{ reintentadas: n }`. **No** recalcula dentro de la petición:
   las toma el ciclo. Clave que no está en la fila → 404. Deja rastro: `console.error`/`console.log` no basta; como
   no hay tabla de historial para esto, escribe el actor y la fecha en dos columnas más de la misma fila
   (`reintento_por TEXT`, `reintento_en TEXT`, misma migración y mismo relleno al restaurar) y devuélvelas en la
   ruta de salud. Si esto te obliga a algo más grande, detente y reporta.
6. **El ciclo no tira los errores.** En `iniciarCiclosSeguimiento` (`rutas.js`), cuando `procesarPendientes` devuelve
   errores, un solo `console.error('SEGUIMIENTO_CLAVES_CON_ERROR', n)` por tramo (sin el detalle; el detalle ya está
   en la tabla). No cambies tiempos ni el presupuesto de 200 ms.
7. **Pantalla** (`src/seguimiento/SeguimientoFacturas.jsx`, textos y formato en `seguimiento.js` con prueba):
   - Renglón de salud arriba (debajo de los avisos, encima de las pestañas), siempre visible, discreto (gris):
     "Último cálculo: 14/11/2026 10:32 · En fila: 0 · Con error: 0". Si no hay cálculo todavía: "Sin cálculos todavía".
   - Si hay claves con error, el renglón pasa a ámbar (no rojo) y se puede abrir un bloque: por cada clave, sus
     facturas afectadas, intentos, cuándo fue el último y el texto del error; arriba el texto fijo:
     "Estas claves no se pudieron recalcular. Sus facturas muestran el cálculo anterior hasta que se resuelva."
     Con permiso de gestionar: botón "Reintentar" por clave y "Reintentar todas" (`type="button"`), que recargan la
     salud al terminar. Sin permiso de gestionar no se pintan los botones (y el servidor igual lo rechaza).
   - En el detalle de una factura (el que abre "Ver"), junto a "Datos al", mostrar "Calculado el <fecha y hora
     local>" tomando `calculado_en` del resultado (si la consulta de detalle no lo devuelve, agrégalo en
     `consultas.js`: el más viejo de los renglones de esa factura, que es el que manda).
   - Usa `fechaHoraLocal` que ya existe en `seguimiento.js`.

## Archivos autorizados

`backend/seguimientoFactura/{servicio,pendientes,consultas,rutas}.js` y sus `.test.js` (incluidos
`integracion.test.js` y `respaldo.test.js`); `backend/sicarRepositorio.js` (solo las columnas y su migración) y
`backend/sicarRespaldo.js` (solo el relleno al restaurar), con `sicarRepositorio.test.js` y `sicarRespaldo.test.js`;
`backend/sicarTraspasos.test.js` solo si una siembra suya inserta en `seguimiento_pendientes` sin nombrar columnas;
`src/seguimiento/SeguimientoFacturas.jsx`, `src/seguimiento/seguimiento.js`, `src/seguimiento/seguimiento.test.js`.
**Prohibido** todo lo demás: `server.js`, `permisosCatalogo.js` (no hay permisos nuevos), `motor.js`, `lector.js`,
`sicarRutas.js`, `sicarTraspasos.js`, `render.yaml`.

## Aviso importante sobre pruebas existentes (ya nos mordió hoy)

Hay pruebas que insertan en `seguimiento_pendientes` **sin nombrar columnas** (`INSERT INTO seguimiento_pendientes
VALUES (?, ?)`: `servicio.test.js` ~328, 341, 384; `seguimientoFactura/respaldo.test.js` ~46) y pruebas que comparan
la lista exacta de columnas de tablas. Con columnas nuevas esas fallan por la prueba, no por el sistema. **Está
autorizado** corregirlas nombrando las columnas (`(clave, desde)`) o agregando las columnas nuevas a la lista
esperada. Búscalas con grep en todo `backend/` antes de entregar y lístalas en el reporte.

## Reglas

- Sin dependencias nuevas. Ninguna línea de más de 200 caracteres. Acentos en UTF-8 real (sin `Ã³` ni `�`).
- Validación en el servidor y fallando cerrando. `todas` solo booleano; `clave` solo texto.
- El texto del error que se guarda y se muestra es solo `e.message` recortado: nunca rutas de archivos ni la pila.
- Nada de esto cambia cifras: el cálculo de piezas y dinero no se toca.
- Si mutas código para ver una prueba roja, revierte en el mismo paso.

## Pruebas mínimas

- Una clave que siempre falla: tras 5 corridas tiene `intentos` 5, `ultimo_error` y `ultimo_intento`; la sexta corrida
  no la toca; `quedan` es 0 y `atoradas` 1; otra clave sana en la misma fila sí se procesa en cada corrida.
- `marcarPendientes` sobre una atorada la deja con `intentos` 0 y el mismo `desde`; sobre una pendiente normal no
  cambia nada. `vueltaCompleta` igual.
- Clave atorada que por fin se recalcula bien: su fila desaparece y ya no sale en la salud.
- Ruta de salud: sin sesión 401; sin permiso de ver 403 (rol con permisos vecinos, nunca `permisos: []`); con
  permiso, los cinco campos con datos sembrados; `?sucursal_id=` no cambia la respuesta (con contenido real).
- Reintentar: sin permiso de gestionar 403 (teniendo el de ver); `{ todas: "true" }` 400; clave inexistente 404;
  correcto deja `intentos` 0, `reintento_por` y `reintento_en`, y no recalcula en la petición.
- Respaldo viejo sin las columnas restaura con 0/NULL.
- Textos del renglón de salud en `seguimiento.test.js` (con cálculo, sin cálculo, con errores).

## Detente y reporta (no improvises) si

- Hace falta tocar un archivo prohibido o cambiar la lista/generación de tablas del respaldo.
- Una prueba existente cambia de expectativa por algo distinto a (a) nombrar columnas en un `INSERT` de siembra,
  (b) agregar las columnas nuevas a una lista de columnas, o (c) agregar `atoradas` a una comparación de objeto
  completo del resultado de `procesarPendientes`. Esos tres están autorizados: lístalos.

## Entrega

Conteo de pruebas por archivo, evidencia rojo→verde, eslint, `git status --short`, pruebas que no pudiste correr,
pruebas existentes que ajustaste y por qué, decisiones no cubiertas y qué hay que probar en el navegador.
