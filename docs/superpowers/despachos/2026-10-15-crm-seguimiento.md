# Despacho: Entrega 1 — CRM seguimiento (Codex)

- Rama `feature/crm-seguimiento`, worktree `.claude/worktrees/crm-seguimiento`, commit base `fff29f4` (spec).
- Spec: `docs/superpowers/specs/2026-10-15-crm-seguimiento-design.md`.
- Otra rama (`feature/pantallas-caja`) trabaja EN PARALELO y es dueña de `backend/server.js`, `backend/configuracion.js`,
  `backend/permisosCatalogo.js`, `src/BarraLateral.jsx`, `src/Dashboard.jsx`, `src/App.jsx` y `src/Garantias.jsx`.

## Archivos

- Autorizados: `backend/crmFuentes.js`, `backend/sicarRepositorio.js`, `backend/sicarRespaldo.js`, `backend/crm.js`
  (solo para exportar/reusar `ESTADOS_MANUALES`), un módulo nuevo de rutas si lo necesitas (por ejemplo
  `backend/crmSeguimientoRutas.js`), `src/CRMListaClientes.jsx` y archivos nuevos de pantalla bajo `src/`, sus pruebas.
- `backend/server.js`: **solo** las líneas mínimas para registrar la ruta nueva junto a las de `/api/crm/v2` (máximo 3
  líneas). Nada más en ese archivo.
- Prohibidos: los de la otra rama (lista de arriba), `src/CRM.jsx` (si necesitas los colores de `ESTADOS`, cópialos a un
  módulo compartido nuevo sin cambiar `CRM.jsx`), todo lo demás.

## Reglas comunes (las dos entregas)

- Lee `AGENTS.md`, `CLAUDE.md` y el spec completo antes de empezar. Lo que el spec marca como decidido no se reabre.
- **Primero escribe el plan** en `docs/superpowers/plans/2026-10-15-<tema>.md`: tareas chicas, cada una con prueba que
  se ve ROJA antes de implementar, archivos que toca y criterio de terminado. Commitea el plan solo y después implementa
  tarea por tarea con TDD, un commit por tarea.
- Si mutas código para ver una prueba roja, revierte en el mismo turno.
- Pruebas siempre con `node --preserve-symlinks --preserve-symlinks-main --test ...`. Línea base en `e9372b2`: suite
  backend 2894 pasan / 0 fallan en la copia principal; en este worktree faltan `backend/.env` y `backend/datos.sqlite`,
  así que `clavesSat.test.js` y `arranquePersistencia.test.js` (5 pruebas) fallan por entorno: no las toques, repórtalas.
- `npx eslint src backend` sin errores nuevos. Líneas de máximo 200 caracteres en `src/` y `backend/`.
- Sin dependencias nuevas. Sin tocar `render.yaml`. Staging por rutas explícitas, nunca `git add .`. Commits sin acentos.
- Push, merge, rebase: NO. Si el sandbox no te deja commitear, deja el trabajo en el árbol y dilo.
- Detente y reporta (no improvises) si: hace falta un archivo prohibido, una dependencia, una regla de negocio no escrita,
  o el spec contradice el código.
- Entrega: lista de commits, archivos tocados, salida de pruebas (nuevas y suite completa), eslint, `git status` final y
  lo que no pudiste hacer o probar. La prueba en navegador la hace Claude, no tú.
