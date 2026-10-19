# Despacho: departamento y categoría desde SICAR (Codex)

- Rama `feature/crm-categorias-sicar`, worktree `.claude/worktrees/crm-categorias-sicar`, commit base `325cb19`
  (spec, sobre master `6ae15bb`). Nadie más escribe en esta rama.
- Spec aprobado por Victor: `docs/superpowers/specs/2026-10-18-crm-categorias-sicar-design.md`. La sección 3 está
  decidida; no se reabre.
- El worktree ya tiene copiados `node_modules`, `backend/node_modules`, `agente-sicar/node_modules`, `backend/.env` y
  `backend/datos.sqlite`.

## Archivos

- Autorizados: `backend/sicarIngesta.js`, `backend/sicarRepositorio.js`, `backend/sicarRespaldo.js`,
  `backend/crmQueCompra.js`, `src/CRMPerfilCompras.jsx`, `docs/sicar-contrato-v1.md`, todo `agente-sicar/` salvo
  `package.json` y `package-lock.json`, módulos nuevos de backend o `src/` que necesites, y las pruebas de todo lo
  anterior (incluidas `backend/sicarContrato.test.js`, `backend/crmQueCompra.test.js`, `backend/crmPerfilPantalla.test.js`
  y las de respaldo).
- Prohibidos: todo lo demás. En especial `backend/server.js`, `backend/respaldos.js`, `backend/crmFuentes.js`,
  `src/CRMFichaCliente.jsx`, `render.yaml`, `agente-sicar/package*.json`, `agente-sicar/seguridad.js` (no se afloja
  la guardia: si la consulta nueva no pasa, detente) y cualquier archivo de caja, ventas, catálogo o inventario.
- Ojo Windows: ningún archivo nuevo cuyo nombre solo difiera en mayúsculas de otro existente.

## Reglas

- Lee `AGENTS.md`, `CLAUDE.md` y el spec completo antes de empezar.
- **Primero el plan** en `docs/superpowers/plans/2026-10-18-crm-categorias-sicar.md`: tareas chicas, cada una con su
  prueba ROJA antes de implementar, archivos y criterio de terminado. Después implementa tarea por tarea con TDD.
- Si mutas código para ver una prueba roja, revierte en el mismo turno.
- Pruebas siempre con `node --preserve-symlinks --preserve-symlinks-main --test <archivos>`: las del servidor desde
  `backend/`, las del agente desde `agente-sicar/`. **Corre solo los archivos de cada tarea; la suite completa la corre
  Claude.** Línea base: backend 2983 pasan / 0 fallan / 2 TODO; agente 76/76.
- El agente no se conecta a ningún MySQL real: usa los lectores falsos que ya existen en sus pruebas.
- Ids del cuerpo como texto; normaliza con `Number(...)` donde compares. Valida contra lo permitido (fallar cerrando).
- `npx eslint src backend agente-sicar` sin errores. Líneas de máximo 200 caracteres. Acentos en UTF-8, sin mojibake.
- Sin dependencias nuevas. Staging por rutas explícitas, nunca `git add .`. Commits sin acentos, uno por tarea.
- Push, merge, rebase: NO. Si el sandbox no te deja commitear (index.lock), deja el trabajo en el árbol y dilo:
  Claude commitea.
- Detente y reporta (no improvises) si: hace falta un archivo prohibido o una dependencia; la consulta de artículos no
  pasa `seguridad.js`; el contrato actual impide un lote solo de artículos sin cambiar `schema_version`; la
  compatibilidad de respaldos exige tocar `respaldos.js`; o el spec contradice el código.
- Entrega: commits (o archivos en el árbol), archivos tocados, salida de las pruebas de cada tarea, eslint,
  `git status` final y lo que no pudiste hacer o probar. Navegador y suite completa: Claude.
