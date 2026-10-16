# Despacho: el arranque restaura TODO lo guardado, no solo lo que trae la semilla (Codex)

- Rama `fix/restaurar-estado-completo`, worktree `.claude/worktrees/restaurar-estado`, commit base `23dac99` (master).
- Carril B (tarea acotada). Decisión de Victor 2026-10-15: **opción A, arreglo de raíz** (no agregar claves sueltas a
  la semilla).
- El worktree ya tiene `node_modules`, `backend/node_modules`, `backend/.env` y `backend/datos.sqlite` copiados.
  Corre las pruebas SIEMPRE con: `node --preserve-symlinks --preserve-symlinks-main --test <archivo>.test.js`
  (desde `backend/`). Sin esas banderas el sandbox falla con EPERM y no es culpa del código.

## El defecto (verificado por Claude en el código)

`backend/server.js:351-363` restaura el estado guardado recorriendo **las claves de la semilla** (`DB`, líneas
175-346): `for modulo of Object.keys(DB)` → `for tabla of Object.keys(DB[modulo])`. Toda clave que el código crea
sobre la marcha y que no está en la semilla se guarda en SQLite, pero **al reiniciar se ignora**, y el siguiente
`guardar(DB)` la borra para siempre. Hoy se pierden en cada despliegue de Render:

| Clave | Dónde se crea | Qué pierde el negocio |
|---|---|---|
| `pos.historial_ventas_mensual` | `historialVentas.js:133` | Historial aplicado en Predicciones |
| `radar_demanda.pedidos_marcados` | `radar/pedidosMarcados.js:48` | Pedidos marcados en el Radar |
| `drive.carpeta_raiz_id`, `carpeta_garantias_id`, `carpeta_gastos_id`, `carpeta_depositos_id`, `carpeta_actividades_id` | `drive.js:150-250` | Ids de carpetas (se re-buscan por nombre; cuesta llamadas a Drive) |

Un módulo entero guardado que no esté en la semilla también se pierde.

## Lo que hay que hacer

1. Al arrancar, para cada módulo del estado guardado: si existe en la semilla, el resultado es
   **semilla + todo lo guardado encima** (lo guardado gana en cada clave que traiga, incluidas las que la semilla no
   conoce); si no existe en la semilla y es un objeto, se restaura completo. La semilla solo rellena lo que falte.
   Mismo resultado que hoy para las claves que ya se restauraban (incluido `undefined` = se queda la semilla).
2. Extrae la lógica a una función pura y probada (p. ej. `restaurarEstado(semilla, guardado)` en un módulo nuevo
   `backend/restaurarEstado.js`) y úsala en `server.js` en lugar del bucle actual. No cambies el orden del arranque:
   `configurarSicar` y `sembrarRolesIniciales` siguen antes, y todas las reconciliaciones siguen después.
3. **Antes de codificar, barrido obligatorio:** enumera en tu informe CADA asignación `DB.<modulo>.<clave> = ...` o
   `DB[...]` del backend (sin pruebas) cuya clave no esté en la semilla, con archivo:línea. Para cada una di si es dato
   que debe sobrevivir. **Si alguna parece estado temporal que NO debería sobrevivir un reinicio** (candado, bandera de
   "en proceso", caché, token de un solo uso), detente y repórtala antes de implementar: decidir eso es de Victor.
4. Revisa qué hace `configurarSicar(DB, ...)` sobre `DB` antes de la restauración y confirma que el cambio no pisa
   nada de lo que deja; si lo pisaría, detente y reporta.

## Pruebas (TDD: cada una se ve ROJA antes de implementar)

- Unitarias de la función: clave desconocida dentro de un módulo conocido sobrevive; módulo desconocido sobrevive;
  clave de la semilla ausente en lo guardado conserva el valor de la semilla; clave guardada gana sobre la semilla;
  guardado `null`/vacío = semilla intacta; la semilla no se muta por referencia de forma que un segundo uso cambie.
- **Prueba de reinicio real**, con procesos separados sobre la misma base, siguiendo el patrón de
  `backend/pantallasCajaReinicio.test.js`: guardar `pedidos_marcados`, `historial_ventas_mensual` y
  `drive.carpeta_raiz_id`, reiniciar, y comprobar que siguen; y que tras un segundo reinicio también.
- Suite completa del backend y `npx eslint` sobre los archivos tocados: sin regresiones. Reporta números exactos.

## Archivos

- Autorizados: `backend/server.js` (solo el bloque de restauración 350-363 y el `require` nuevo),
  `backend/restaurarEstado.js` (nuevo), y sus pruebas nuevas.
- Prohibidos: todo lo demás. En particular `backend/persistencia.js`, `backend/respaldos.js`, la semilla misma,
  y los módulos que crean las claves. Ninguna dependencia nueva.

## Reglas

- Lee `AGENTS.md` y `CLAUDE.md` antes de empezar.
- Commits pequeños, mensajes **sin acentos**, staging por rutas explícitas (nunca `git add .`). Si el sandbox no te
  deja commitear (index.lock), deja los cambios sin commitear y dilo: Claude commitea.
- Si mutas código para ver una prueba roja, revierte en el mismo turno.
- Detente y reporta en vez de improvisar ante: archivo no autorizado, decisión de negocio no escrita, regresión,
  dependencia nueva o cambios ajenos en el worktree.
- Informe final: barrido del punto 3, archivos tocados, pruebas nuevas, números de la suite, y lo que no pudiste
  verificar.
