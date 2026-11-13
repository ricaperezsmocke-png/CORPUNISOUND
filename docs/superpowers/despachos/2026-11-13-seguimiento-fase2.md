# Despacho: Seguimiento de Facturas — Fase 2 "En el camino y por aclarar, con folio, días y dinero"

**Rama:** `feature/seguimiento-mejoras` — **worktree:**
`C:\Users\Victor\Desktop\CORPUNISOUND\.claude\worktrees\seguimiento-mejoras` — **commit base:** `aebb77d` (master, con
la Fase 1 ya en producción). Un solo responsable de escritura: tú.

Lee primero `CLAUDE.md` de la raíz y, del plan `docs/superpowers/plans/2026-11-13-seguimiento-facturas-mejoras.md`,
los **hallazgos 1 y 3** y la **Fase 2**. Solo se implementa la Fase 2.

**Pruebas (obligatorio con estas banderas):**
`cd backend && node --preserve-symlinks --preserve-symlinks-main --test seguimientoFactura/ ../src/seguimiento/seguimiento.test.js`
más los `.test.js` de `sicarTraspasos`/`sicarRutas` si los tocas. Línea base del directorio: 150/150.
NO corras la suite completa (PC de 8 GB); la corre Claude. Al final `npx eslint src backend`: 0 errores.
No puedes hacer `git add`/`commit` (tu sandbox no escribe en `.git`): deja los cambios en el árbol y repórtalo.

## Contexto de negocio (hechos de producción, verificados por Claude el 2026-11-13)

- Todas las facturas entran por CEDIS. La mercancía viaja CEDIS → tienda y también tienda → tienda. El motor ya sigue
  ambos saltos (`motor.test.js`: "traslado entre tiendas conserva la factura y su antigüedad") **solo si** origen y
  destino están en el mapa de sucursales SICAR.
- Mapa actual: SICAR 1 = San Cristóbal, 2 = Ocosingo, 4 = Yajalón, 6 = CEDIS, 8 = Palenque. **Sin asignar: 3, 5 y 7.**
  En 2026 hay ~254 traspasos con SICAR 5 (≈ $790 mil enviados hacia ella, casi todos desde Ocosingo). Esas piezas hoy
  aparecen como "Queda" en el origen: el seguimiento cuenta una historia distinta a la real y nadie lo ve en la lista.
- Hay envíos de 2024 y 2025 hacia SICAR 3 y 7 que nunca se recibieron y tampoco generan aviso.

## Decisiones de Victor (ya tomadas)

- Un traspaso **en tránsito más de 7 días** es alarma. Configurable: `dias_transito_alarma: 7` (rango 1–365).
- Lo "por aclarar" debe verse con folio, fecha, tiendas, días y dinero. **Nunca** se presenta como faltante de una
  tienda ni de una persona: el texto es "por aclarar", no "faltante" (regla del dueño: el sistema no le inventa
  faltantes a nadie).

## Qué construir (TDD: cada prueba se ve ROJA antes de implementar)

1. **Guardar el origen de cada pieza en tránsito o por aclarar.** En el resultado por renglón (`servicio.js`, subir
   `VERSION` de resultados) agregar una lista `movimientos_abiertos` con, por cada grupo:
   `{ tramo: 'transito'|'por_aclarar', motivo, folio, fecha_envio, origen, destino, piezas, centavos }`
   (piezas en diezmilésimas y dinero en centavos como texto, igual que el resto; origen/destino = `sucursal_id` de
   CORPUNISOUND o `null` con `sicar_origen`/`sicar_destino` cuando no hay mapa). El motor/lector ya tienen el traspaso
   (`m.traspaso`); solo hay que conservarlo hasta el resultado. La suma de tramos por renglón **debe seguir cuadrando
   exactamente** (la prueba existente de cuadre no cambia) y `sum(movimientos_abiertos.piezas por tramo)` = tramo.
   Si para algún motivo no hay traspaso identificable, el grupo va con `folio: null` (no se inventa).
2. **Traspasos que no se entienden marcan la factura.** Hoy `sin_mapa`, `mapa_contradictorio` y `folio_ambiguo` solo
   dejan observación y no mueven piezas (`lector.js`, `motor.js`). No cambies eso (no se mueven piezas a ciegas), pero
   el resultado debe llevar `traspasos_sin_entender: [{ motivo, folio, fecha, sicar_origen, sicar_destino, piezas }]`
   y la consulta de lista (`consultas.js`) debe exponer por factura `sin_entender: true|false`.
3. **Pestaña nueva "En el camino y por aclarar"** (ruta `GET` nueva bajo el mismo `base`, permiso de ver el módulo):
   una fila por grupo de `movimientos_abiertos` y por `traspasos_sin_entender` de todas las facturas con saldo, con
   proveedor, folio de factura, clave, folio de traspaso, origen → destino (nombre de tienda o "SICAR n"), días desde
   el envío, piezas y dinero (con y sin IVA como el resto). Orden: dinero desc, luego días desc. Paginada en el
   servidor como la lista actual. Totales arriba: dinero en tránsito, dinero por aclarar, dinero sin entender.
   Alcance: igual que las rutas actuales del módulo (no inventes un alcance nuevo; **no** leas `?sucursal_id=` del
   encabezado para decidir alcance).
4. **Alarma de tránsito viejo:** en esa pestaña, las filas de tránsito con más de `dias_transito_alarma` días van
   marcadas "Más de N días en camino" y hay un filtro "Solo alarmas". En la lista de facturas, "Siguiente acción"
   (`src/seguimiento/seguimiento.js`) antepone "Revisar traspasos" cuando la factura tiene tránsito en alarma, piezas
   por aclarar o `sin_entender`.
5. **Aviso fijo de sucursales SICAR sin asignar:** arriba de la pantalla del módulo, mientras el mapa tenga números
   sin asignar con traspasos: "Hay sucursales de SICAR sin asignar (3, 5, 7): sus traspasos no se están siguiendo."
   con cuántos traspasos y cuánto dinero (suma de `total` no cancelados) tiene cada una. Usa los datos que ya expone
   el módulo de traspasos SICAR (`sicarTraspasos.js`); si necesitas una consulta nueva, va en una ruta del
   seguimiento, solo lectura.
6. **Recalcular al cambiar el mapa:** cuando se asigna o cambia el mapa (`asignarMapaSicar` en `sicarTraspasos.js` /
   ruta en `sicarRutas.js`), marcar como pendientes las claves de los artículos de los traspasos que tocan ese número
   SICAR (usa `marcarPendientes` del servicio; no recalcules dentro de la petición).

## Archivos autorizados

`backend/seguimientoFactura/{motor,lector,servicio,consultas,rutas,config}.js` y sus `.test.js`
(incluidos `integracion.test.js`, `incorporar.test.js`, `respaldo.test.js` si cambian expectativas por la versión);
`backend/sicarTraspasos.js` y `backend/sicarRutas.js` **solo** para el punto 6 (y sus pruebas);
`src/seguimiento/SeguimientoFacturas.jsx`, `src/seguimiento/seguimiento.js`, `src/seguimiento/seguimiento.test.js`.
**Prohibido** todo lo demás: `server.js`, `permisosCatalogo.js`, `sicarRepositorio.js` (sin columnas ni tablas
nuevas: todo va dentro de `datos_json` del resultado), `sicarRespaldo.js`, `render.yaml`.

## Reglas

- Sin dependencias nuevas. Ninguna línea de más de 200 caracteres. Acentos en UTF-8 real (sin `Ã³` ni `�`).
- Aritmética de piezas y dinero en BigInt/texto como el módulo; nada de float. El cuadre al centavo no se toca.
- Toda validación en el servidor; ids del cuerpo/params con `Number()` antes de comparar.
- `SeguimientoFacturas.jsx` ya es grande: la pestaña nueva va en un componente propio dentro del mismo archivo o,
  si pasa de ~150 líneas, repórtalo y propone archivo nuevo en vez de crearlo.
- Si mutas código para ver una prueba roja, revierte en el mismo paso.

## Pruebas mínimas

- Envío 20 / recepción 18: las 2 por aclarar conservan folio, fecha, origen y destino; el cuadre sigue exacto.
- Envío sin recibir de 8 días: aparece en la pestaña con alarma; de 6 días, sin alarma; config a 3 → alarma.
- Traspaso tienda → tienda (1 → 2) en tránsito: fila con origen Ocosingo y destino Yajalón y la factura de CEDIS.
- Traspaso a SICAR sin mapa: no mueve piezas, la factura sale `sin_entender`, aparece en la pestaña y en el aviso fijo.
- Asignar el mapa deja pendientes las claves afectadas y, al recalcular, las piezas se mueven y `sin_entender` se apaga.
- Resultados guardados con la versión anterior se recalculan solos (comportamiento actual de `VERSION`).
- La ruta nueva exige sesión y permiso (rol de prueba con permisos vecinos, nunca `permisos: []`).

## Detente y reporta (no improvises) si

- Conservar el traspaso hasta el resultado exige cambiar la forma en que el motor reparte piezas (el FIFO no se toca).
- Necesitas tabla/columna nueva, o tocar un archivo prohibido.
- Una prueba existente cambia de expectativa por algo distinto a (a) la versión del resultado o (b) agregar las
  claves nuevas (`dias_transito_alarma`, `movimientos_abiertos`, `traspasos_sin_entender`, `sin_entender`) a
  comparaciones de objeto completo — esos dos casos están AUTORIZADOS (p. ej. `incorporar.test.js:22` con la
  configuración inicial): actualízalas, lístalas en el reporte y sigue. Cualquier otro cambio de expectativa: detente.
- El tamaño de `datos_json` crece de forma que afecte el respaldo (mide un renglón típico antes y después y repórtalo).

## Entrega

Conteo de pruebas, eslint, `git status --short`, decisiones no cubiertas, medición de `datos_json`, y la lista de lo
que hay que probar en el navegador.
