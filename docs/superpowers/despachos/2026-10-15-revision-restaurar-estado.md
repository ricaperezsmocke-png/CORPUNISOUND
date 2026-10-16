# Despacho: revision independiente de fix/restaurar-estado-completo (Codex)

- Rama `fix/restaurar-estado-completo`, worktree `.claude/worktrees/restaurar-estado`. Base `23dac99` (master).
- Lo implemento Claude (Codex no tenia cuota). Por eso la revision va a Codex. **Solo revisas: no modifiques codigo.**
- Contexto y alcance: `docs/superpowers/despachos/2026-10-15-restaurar-estado-completo.md` (mismo directorio).
- Pruebas: desde `backend/`, `node --preserve-symlinks --preserve-symlinks-main --test <archivo>`.

## Que cambio

- `backend/restaurarEstado.js` (nuevo): `restaurarEstado(semilla, guardado)` devuelve semilla + todo lo guardado encima,
  incluidas claves y modulos que la semilla no conoce. Ignora modulos guardados que no sean objeto y valores `undefined`.
- `backend/server.js`: el bucle de restauracion que solo recorria claves de la semilla se reemplazo por esa funcion,
  aplicada sobre el mismo objeto `DB` (`Object.assign` por modulo) porque `configurarSicar` lo registra por referencia
  en un WeakMap (`respaldos.js:27`). Orden del arranque sin cambios.
- Pruebas nuevas: `restaurarEstado.test.js` (7 unitarias) y `restaurarEstadoReinicio.test.js` (dos reinicios reales).

## Barrido que hizo Claude (verificalo, no lo des por bueno)

Claves asignadas en backend fuera de la semilla: `drive.carpeta_{raiz,garantias,gastos,depositos,actividades}_id`
(`drive.js:153-230`), `pos.historial_ventas_mensual` (`historialVentas.js:133`), `radar_demanda.pedidos_marcados`
(`radar/pedidosMarcados.js:48`). Ninguna es candado, cache ni token temporal. `objetivosCatalogos.js:38` usa
claves dinamicas pero ambas (`objetivo_marcas`, `objetivo_productos`) estan en la semilla.

## Que revisar

1. Que ninguna clave que ahora sobrevive sea estado temporal que deberia morir con el reinicio (busca tambien alias,
   p. ej. `const x = DB.pos; x.algo = ...`, que el barrido por regex no ve).
2. Que el resultado sea identico al anterior para las claves de la semilla.
3. Interaccion con `normalizarRadarDemanda`, `reconciliar*` y demas pasos posteriores al restaurar, y con
   `respaldos.restaurar` / `contarRegistros` / `armarFoto` si ahora ven claves nuevas.
4. Riesgo de que una base guardada vieja reviva algo que rompa el arranque.

## Informe

Hallazgos con archivo:linea, gravedad (bloqueante / medio / menor) y escenario concreto. Separa lo que comprobaste
corriendo algo de lo que solo leiste. Si no encuentras nada, dilo asi.
