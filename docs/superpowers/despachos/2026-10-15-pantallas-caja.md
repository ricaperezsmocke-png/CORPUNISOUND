# Despacho: Entrega 2 — Interruptores de pantallas de caja (Codex)

- Rama `feature/pantallas-caja`, worktree `.claude/worktrees/pantallas-caja`, commit base `1c924e6` (spec).
- Spec: `docs/superpowers/specs/2026-10-15-pantallas-caja-design.md`. Toca dinero: aplica las 5 reglas de dinero de
  `CLAUDE.md` (servidor manda, falla cerrando, `esDeEstaCaja` única definición, ids como texto, alcance del token).
- Otra rama (`feature/crm-seguimiento`) trabaja EN PARALELO sobre `backend/crmFuentes.js`, `backend/sicarRepositorio.js`,
  `backend/sicarRespaldo.js`, `src/CRMListaClientes.jsx` y agrega hasta 3 líneas en `backend/server.js` junto a las rutas
  `/api/crm/v2`. No toques esos archivos ni esa zona de `server.js`.

## Archivos

- Autorizados: `backend/server.js` (middleware y rutas de la tabla del spec), `backend/configuracion.js`,
  `backend/permisosCatalogo.js` (solo el permiso nuevo), un módulo nuevo `backend/pantallasCaja.js` para la lógica y las
  reglas, `src/BarraLateral.jsx`, `src/Dashboard.jsx`, `src/App.jsx`, `src/Garantias.jsx`, la pantalla de configuración
  que ya existe y archivos nuevos de pantalla bajo `src/`, y sus pruebas.
- Prohibidos: los de la otra rama, `backend/cajas.js` (úsalo, no lo cambies), `backend/ventas.js`, `backend/apartados.js`,
  `backend/gastos.js`, `backend/depositos.js` y `backend/garantias*.js` (el bloqueo va en las rutas, no en las funciones),
  todo lo demás.

## Parada anterior resuelta

Un intento anterior se detuvo por la importación de MercadoLibre. Victor ya decidió: sección 3b del spec. El plan a
medio hacer quedó en `docs/superpowers/plans/2026-10-15-pantallas-caja.md` (sin commitear); complétalo con esa decisión.

## Antes de codificar

Enumera en el plan **cada** ruta de escritura que crea o cambia un movimiento que un corte cobra (búscalas por uso de
`corte_id`, `caja_id`, `esDeEstaCaja` y por las rutas listadas en el spec), con archivo:línea y a qué interruptor
pertenece. Si alguna no encaja en un interruptor, detente y reporta antes de implementar.
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
