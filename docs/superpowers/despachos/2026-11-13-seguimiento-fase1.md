# Despacho: Seguimiento de Facturas — Fase 1 "Avisos que no se callan solos"

**Rama:** `feature/seguimiento-mejoras` — **worktree:**
`C:\Users\Victor\Desktop\CORPUNISOUND\.claude\worktrees\seguimiento-mejoras` — **commit base:** `cef5cc0` (master).
Un solo responsable de escritura: tú. Lee primero `CLAUDE.md` de la raíz y, del plan
`docs/superpowers/plans/2026-11-13-seguimiento-facturas-mejoras.md`, el **hallazgo 2** y la **Fase 1**. Solo se
implementa la Fase 1; las demás fases NO.

**Pruebas (obligatorio con estas banderas, el sandbox lo exige):**
`cd backend && node --preserve-symlinks --preserve-symlinks-main --test seguimientoFactura/servicio.test.js
seguimientoFactura/rutas.test.js seguimientoFactura/consultas.test.js ../src/seguimiento/seguimiento.test.js`
Línea base: 65/65. Corre además `seguimientoFactura/respaldo.test.js` e `integracion.test.js` si tocas el esquema.
NO corras la suite completa (PC de 8 GB: la mata); la corre Claude. Al final `npx eslint src backend`: 0 errores.

## El problema (verificado en el código)

Quien tiene `gestionar_seguimiento_facturas` marca un aviso como "Revisado" con un motivo corto y el aviso no vuelve
nunca mientras la factura siga en la misma etapa; en la etapa de liquidar (la última) eso es para siempre, con el
saldo completo parado. "Posponer" solo exige fecha futura, sin máximo (`servicio.js`, cambio de estado; `rutas.js`).

## Decisiones de Victor (ya tomadas, no las cambies)

- **"Revisado" caduca a los 15 días** si el saldo de la factura **no bajó** desde que se marcó: vuelve a `nuevo`.
- **Posponer: máximo 30 días** desde hoy.
- Los dos números son configurables (mismos mecanismos que el resto de `config.js`).

## Qué construir (TDD: cada prueba se ve ROJA antes de implementar)

1. **Config:** `dias_revisado_caduca: 15` y `dias_posponer_maximo: 30` en `VALORES_INICIALES` de
   `backend/seguimientoFactura/config.js`. Si existe una ruta/pantalla que edita la configuración con lista blanca o
   validación de claves, agrégalas ahí con rango 1–365 enteros (validado en el SERVIDOR).
2. **Guardar el saldo al revisar:** al pasar un aviso a `revisado`, guardar el saldo de ese momento (mismo cálculo
   que usa `servicio.js` para decidir avisos: `queda + transito`, en las unidades BigInt/texto que ya usa el módulo;
   no conviertas a float) y la fecha. Columna(s) nueva(s) en `seguimiento_avisos` (`backend/sicarRepositorio.js`),
   con migración idempotente al estilo de las que ya hay en ese archivo (revisa cómo agregan columnas las demás).
   Avisos `revisado` anteriores a este cambio (sin saldo guardado): tratar la fecha de la revisión del historial
   como inicio y el saldo actual como referencia en la primera vuelta — es decir, empiezan a contar desde el
   despliegue, no reaparecen todos de golpe.
3. **Caducidad:** en el punto donde hoy se reevalúan los avisos (el que despierta posposiciones vencidas), un aviso
   `revisado` con `dias_revisado_caduca` días cumplidos y saldo actual **>=** saldo guardado vuelve a `nuevo`, con
   renglón en `seguimiento_avisos_historial` y motivo fijo `sin_movimiento_desde_revision` (sin usuario: lo hizo el
   sistema, igual que los cambios automáticos que ya existen). Si el saldo bajó: se queda `revisado`, y se actualiza
   la referencia (saldo y fecha) para volver a contar 15 días desde ahí. Aplica a todas las etapas, liquidar incluida.
4. **Tope de posponer en el servidor:** `pospuesto_hasta` > hoy + `dias_posponer_maximo` → 400 con mensaje claro en
   español ("No se puede posponer más de N días."). Usa `fechaLocal()` como ya hace el código. La pantalla
   (`src/seguimiento/SeguimientoFacturas.jsx`, `seguimiento.js`) debe limitar el selector de fecha al mismo tope y
   mostrar el mensaje del servidor si llega; el tope se lee de la config que ya recibe la pantalla (si no la recibe,
   exponlo en la respuesta que ya trae la configuración, no inventes una ruta nueva).
5. **Pantalla:** en el historial del aviso, el motivo `sin_movimiento_desde_revision` se muestra como
   "Volvió solo: sin movimiento desde la revisión". Nada más de interfaz.

## Pruebas mínimas

- Revisado + 15 días + saldo igual → `nuevo` con historial y motivo; a los 14 días no.
- Revisado + 15 días + saldo menor → sigue `revisado`; 15 días después sin moverse → `nuevo`.
- Etapa liquidar incluida. Aviso revisado viejo sin saldo guardado: no reaparece en la primera vuelta.
- Posponer a hoy+31 mandando la petición a mano → 400; a hoy+30 → acepta. Con config sobrescrita a 10: hoy+11 → 400.
- Prueba de permisos, si agregas alguna: rol con permisos vecinos del módulo, nunca `permisos: []`.
- El respaldo/restauración del módulo sigue pasando con la(s) columna(s) nueva(s).

## Archivos autorizados

`backend/seguimientoFactura/{servicio,rutas,config,consultas}.js` y sus `.test.js`;
`backend/sicarRepositorio.js` **solo** para la(s) columna(s) de `seguimiento_avisos` y su migración;
`src/seguimiento/SeguimientoFacturas.jsx`, `src/seguimiento/seguimiento.js`, `src/seguimiento/seguimiento.test.js`.
Si el respaldo necesita conocer la columna, el archivo de respaldo del módulo y `respaldo.test.js`.
**Prohibido** todo lo demás: `server.js`, `permisosCatalogo.js`, `motor.js`, `lector.js`, `render.yaml`, otras tablas.

## Reglas

- Sin dependencias nuevas. Ninguna línea de más de 200 caracteres en `.js`/`.jsx`. Acentos en código e interfaz en
  UTF-8 real (verifica que no quede mojibake tipo `Ã³` ni `�`). Mensajes de commit SIN acentos.
- Toda validación en el servidor. Ids del cuerpo HTTP pueden llegar como texto: `Number()` antes de comparar.
- Staging por rutas explícitas (nunca `git add .`). Commits en esta rama; no push, no merge, no rebase.
- Si mutas código para ver una prueba roja, revierte la mutación en el mismo paso.

## Detente y reporta (no improvises) si

- Necesitas un archivo fuera de la lista o cambiar otra tabla.
- La columna nueva obliga a subir la versión del formato de respaldo o invalida respaldos anteriores.
- Una prueba existente tiene que cambiar su expectativa (di cuál y por qué antes de cambiarla).
- El cálculo del saldo al revisar no se puede obtener sin tocar `motor.js`/`lector.js`.

## Entrega

Commits, conteo de las pruebas de arriba, resultado de eslint, `git status --short`, decisiones que tomaste que el
despacho no cubría, y qué debe probarse en el navegador.
