# Despacho: Entrega 3 — CRM qué compra, VIP y cuentas internas (Codex)

- Rama `feature/crm-que-compra`, worktree `.claude/worktrees/crm-que-compra`, commit base `598333d` (spec, sobre master
  `c7e28bc`). Nadie más escribe en esta rama.
- Spec aprobado por Victor: `docs/superpowers/specs/2026-10-15-crm-que-compra-vip-design.md`. Lo que marca como
  decidido (sección 3) no se reabre.
- El worktree ya tiene copiados `node_modules`, `backend/node_modules`, `backend/.env` y `backend/datos.sqlite`.

## Archivos

- Autorizados: `backend/crmFuentes.js`, `backend/sicarRepositorio.js`, `backend/sicarRespaldo.js`,
  `backend/permisosCatalogo.js` (solo el permiso nuevo), módulos nuevos de backend que necesites (p. ej.
  `backend/crmQueCompra.js`, `backend/crmCuentasInternas.js`), `src/CRMListaClientes.jsx`, `src/CRMFichaCliente.jsx`,
  componentes nuevos bajo `src/`, y sus pruebas.
- `backend/server.js`: **solo** (a) registrar las rutas nuevas junto a las de `/api/crm/v2` (líneas 1888-1893) y
  (b) agregar `cuentas_internas_historial: []` a la semilla `DB.crm`. Nada más.
- Prohibidos: todo lo demás. En especial `src/CRM.jsx`, `backend/crm.js`, `backend/respaldos.js`, `render.yaml`,
  y cualquier archivo de caja, ventas o inventario.
- Ojo Windows: no crees un archivo cuyo nombre solo difiera en mayúsculas de otro existente (ya rompió la pantalla en
  la Entrega 1: `crmSeguimiento.js` contra `CRMSeguimiento.jsx`).

## Reglas

- Lee `AGENTS.md`, `CLAUDE.md` y el spec completo antes de empezar.
- **Primero escribe el plan** en `docs/superpowers/plans/2026-10-15-crm-que-compra.md`: tareas chicas, cada una con
  prueba que se ve ROJA antes de implementar, archivos que toca y criterio de terminado. Commitea el plan solo y
  después implementa tarea por tarea con TDD, un commit por tarea.
- Si mutas código para ver una prueba roja, revierte en el mismo turno.
- Pruebas desde `backend/` siempre con `node --preserve-symlinks --preserve-symlinks-main --test ...`. Línea base en
  `c7e28bc`: suite backend 2949 pasan / 0 fallan / 2 TODO del Radar.
- Pruebas de permisos con permisos vecinos del módulo `crm`, nunca con `permisos: []` (CLAUDE.md).
- Ids del cuerpo HTTP pueden venir como texto: normaliza con `Number(...)`. Booleanos estrictos donde el spec lo pide.
- `npx eslint src backend` sin errores. Líneas de máximo 200 caracteres en `src/` y `backend/`. Acentos en código e
  interfaz bien codificados (UTF-8, sin mojibake).
- Sin dependencias nuevas. Staging por rutas explícitas, nunca `git add .`. Commits sin acentos.
- Push, merge, rebase: NO. Si el sandbox no te deja commitear (index.lock), deja el trabajo en el árbol y dilo.
- Detente y reporta (no improvises) si: hace falta un archivo prohibido, una dependencia, una regla de negocio no
  escrita, o el spec contradice el código (p. ej. si `sicar_detalles.importe_centavos` no es el importe neto que
  supone el spec, o si la compatibilidad de respaldos de dos generaciones exige tocar `respaldos.js`).
- Entrega: lista de commits, archivos tocados, salida de pruebas (nuevas y suite completa), eslint, `git status` final
  y lo que no pudiste hacer o probar. La prueba en navegador la hace Claude, no tú.
