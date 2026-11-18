# Despacho a Codex: Resurtido — Entrega 1 (Tasks 1 a 8)

## Qué se te pide

Implementar con TDD las **Tasks 1 a 8** del plan `docs/superpowers/plans/2026-11-18-resurtido-minmax-claude.md`
(sección "Entrega 1"). Lee el plan completo, **incluidas "Decisiones finales", "Aportes de Codex incorporados",
"Global Constraints" y "Review Focus"**, y el diseño `docs/superpowers/specs/2026-11-18-resurtido-minmax-design.md`.
Las decisiones están tomadas por Victor: no las reabras. Nada de las Entregas 2, 3 y 4.

## Dónde

- Worktree: `C:\Users\Victor\Desktop\CORPUNISOUND\.claude\worktrees\resurtido-e1`
- Rama: `feature/resurtido-e1`, base `2863d0f`. Confirma con `git status` y `git log -1` antes de empezar.
- El entorno ya está puesto (node_modules, backend/node_modules, backend/.env, backend/datos.sqlite copiados).

## Cómo correr pruebas (obligatorio)

Desde `backend/`: `node --preserve-symlinks --preserve-symlinks-main --test <archivo>.test.js` (archivos explícitos).
Sin esas dos banderas el sandbox da EPERM: no es un fallo del código, no intentes "arreglar" el entorno.
**No corras la suite completa** ni intentes commitear: el sandbox no puede crear `index.lock`. **La suite completa y
los commits los hace Claude.** Deja los cambios sin commitear, ordenados por task.

Pruebas de `src/`: `node --preserve-symlinks --preserve-symlinks-main --test src/resurtido/resurtido.test.js` desde la
raíz del worktree. ESLint: `npx eslint <archivos que tocaste> --quiet` (0 errores).

## Reglas (CLAUDE.md del repo)

- Prueba **roja primero** por conducta ausente (no por error de importación); luego lo mínimo para verde.
- Ninguna dependencia nueva. Ninguna línea de más de 200 caracteres en `.js`/`.jsx`.
- Acentos correctos en código e interfaz (UTF-8 sin mojibake: revisa que "ó", "í", "ñ" se vean bien en el archivo).
- Permisos en `backend/permisosCatalogo.js`; el guard de arranque tumba el backend si falta algo.
- Alcance de tienda **solo del token** (`ver_todas_las_sucursales` o `sucursal_id` del usuario); nunca de
  `?sucursal_id=` ni del cuerpo.
- Respaldo SICAR: tablas nuevas **al final** de `TABLAS` en `backend/sicarRespaldo.js` y una generación nueva que deja
  legibles todas las copias viejas.
- Patrón de pruebas: `prepararDB()` local en cada archivo (ver `backend/cajas.test.js` y los tests de
  `backend/seguimientoFactura/`). No inventes helpers que no existen.
- Prohibido: `render.yaml`, `agente-sicar/`, producción, push, merge.

## Cuándo detenerte y reportar en vez de improvisar

- Si el plan contradice el código (una firma, una tabla, un archivo que no existe como dice): para, cita archivo:línea y
  propón la corrección mínima.
- Si para la observación de existencias (Task 4) tocar la ingesta en `backend/sicarRepositorio.js` pone en riesgo la
  ingesta actual (más de ~30 líneas o cambios a sentencias existentes): para y describe la alternativa.
- Si una prueba existente se pone roja por tu cambio y no ves por qué.
- Si necesitas una dependencia.

## Informe final (en español)

Por task: archivos tocados, pruebas nuevas (cuántas, cuántas estuvieron rojas antes), salida del comando de prueba de
esa task, y desviaciones del plan con su razón. Al final: lo que no hiciste, riesgos que viste y cualquier cosa del
Review Focus que no quedó cubierta por una prueba.

## Aclaración (2026-11-18, tras la primera detención)

La referencia a `crearTablas` en la Task 3 era un error de nombre del plan; ya está corregida a
`crearRepositorioSicar(sqlite)`. Para diferencias de **nombre o firma** con una corrección obvia que no cambia la
conducta pedida (como esa), **corrige, anótalo en el informe y sigue**. Detente solo cuando la diferencia cambie lo que
se construye, ponga en riesgo la ingesta, o no tenga una corrección evidente.

## Decisión de Claude sobre la detención en Task 4 (2026-11-18)

Se adopta la propuesta mínima de Codex: `resurtido_existencia_diaria.piezas_diezmilesimas` es **el menor valor
observado durante el día** (observaciones de ingesta y foto nocturna). Una observación posterior más alta no lo
reemplaza; la foto nocturna tampoco lo sube. `origen` queda `'foto'` si hubo alguna observación real ese día. La
existencia actual se sigue leyendo de `sicar_existencias`. Sin columnas nuevas. Tasks 1–3 ya están commiteadas por
Claude (`da6c904`, `7aeafd1`, `53dee1e`); continúa con Tasks 4 a 8.
