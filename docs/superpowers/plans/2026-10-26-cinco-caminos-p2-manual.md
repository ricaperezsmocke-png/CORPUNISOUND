# Cinco Caminos P2: manual de tácticas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un catálogo de tácticas dentro del sistema, cargado con las 30 del manual v1, que el gerente de ventas puede
corregir. Cada táctica guarda su historial de cambios y tiene una etiqueta de prueba por tienda que nadie edita a mano.

**Architecture:** Vive en el JSON principal, en `DB.pos.cinco_caminos.tacticas`, junto a `categorias`. Así ya entra
al respaldo de Drive sin tocar `sicarRespaldo.js`. La siembra v1 corre al arrancar solo si la lista no existe todavía;
es idempotente y nunca pisa lo que el gerente ya corrigió. Las rutas van en `backend/cincoCaminos/`, con el molde de
`rutas.js`. La pantalla es una pestaña "Manual de tácticas" dentro de Cinco Caminos.

**Tech Stack:** Node + Express (JSON DB), React + Vite, `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-24-cinco-caminos-design.md` (secciones 5, 7, 9).
**Contenido de la siembra:** `docs/superpowers/specs/2026-10-24-manual-tacticas-v1.md`, las 30 tácticas TAL CUAL.
Victor y el gerente las corrigen después dentro del sistema.
**Fuera de este plan:** metas automáticas, planeador, cierre del mes y el cálculo de etiquetas (P3–P5). Aquí la etiqueta
existe, se muestra y nace `por_probar`; quien la escribirá es el cierre del mes (P5).

## Global Constraints

- Sin dependencias nuevas.
- Líneas de 200 caracteres o menos en los `.js/.jsx` de `src/` y `backend/`.
- Staging explícito. Commits sin acentos. Sin push, merge ni rebase.
- Suites en 0 fallas y `npx eslint src backend` en 0 errores.
- Corre en comandos SEPARADOS: suite backend, pruebas de src, build y eslint. El equipo tiene 8 GB.
- Permisos (ya existen en `permisosCatalogo.js`, módulo `pos`):
  - Ver el manual: `ver_cinco_caminos`.
  - Crear, editar o retirar tácticas: `administrar_manual_tacticas`.
  - NO agregar permisos nuevos.
- **La etiqueta de prueba no se edita por ninguna ruta.** Ningún cuerpo de petición puede escribir `etiquetas`. Solo
  la escribirá el cierre del mes (P5), con una función interna exportada que aquí se crea y se prueba, pero que no tiene
  ruta.
- **Historial:** todo alta, cambio o retiro agrega una entrada inmutable con `fecha_hora` ISO UTC, `usuario_id`
  (del token), `accion` (`alta|cambio|retiro|reactivacion`), `antes` y `despues` (solo los campos que cambiaron). Las
  tácticas nunca se borran: se retiran con motivo de 3 a 200 caracteres.
- **Validación con lista de lo permitido** (regla 2 de CLAUDE.md). Un campo desconocido, un tipo raro o una lista de
  valores fuera de catálogo rechaza la petición entera con 400 y no cambia nada.
- **Alcance de la etiqueta** (regla 5): el GET devuelve las etiquetas de TODAS las tiendas solo con
  `ver_todas_las_sucursales`; sin ese permiso, solo la etiqueta de la tienda del token, más el conteo general
  `probada en N tiendas`, que no revela cuáles son. `?sucursal_id=` nunca amplía el alcance.

## Modelo

Táctica:
```
{ id: entero (consecutivo, nunca se reusa), numero_v1: 1..30 | null, nombre: texto 3-120,
  descripcion: texto 0-600, camino: 'calidad_dato'|'prospectos'|'conversion'|'compras_por_cliente'|'venta_promedio'|'margen',
  numero_que_mueve: una clave de NUMEROS (abajo), candado: clave de NUMEROS | null,
  quien: subconjunto no vacío de ['cajera','vendedor','encargado','gerente','compras'],
  como_se_mide: 'sistema'|'evidencia'|'sistema_y_evidencia'|'fase_2'|'fase_3',
  referencia_pdf: texto 0-60, activa: boolean, motivo_retiro: texto|null,
  etiquetas: { [sucursal_id]: { estado: 'por_probar'|'probada'|'no_funciono'|'sin_dato', mes: 'AAAA-MM'|null,
    resultado: texto|null } },
  historial: [ ... ], creada_en, actualizada_en }
```
`NUMEROS` = las claves del tablero (`backend/cincoCaminos/tablero.js`): `pct_con_cliente`, `clientes_nuevos`,
`conversion`, `registros_por_10_tickets`, `recompra_90`, `ticket_promedio_centavos`, `articulos_por_ticket`,
`pct_instrumento_con_accesorio`, más `margen` y `descuento_promedio` (fase 3, sin cálculo todavía). Si el tablero
nombra alguna distinta, usa la del tablero y anótalo en el reporte.

**Del manual v1 al modelo:**
- La columna "Mide" se traduce así: S → `sistema`; E → `evidencia`; "E + S" o "S parcial" → `sistema_y_evidencia`;
  F3 → `fase_3`.
- "Número que mueve" va a la clave del tablero: "Registros por cada 10 tickets" → `registros_por_10_tickets`;
  "Conversión del Radar" → `conversion`; "Margen" → `margen`; "Descuento promedio" → `descuento_promedio`.
- El candado sale de la tabla 4.1 del spec según el número. Si no tiene, va `null`.
- Las "Excluidas a propósito" NO se siembran como tácticas. Van como texto fijo en la pantalla.

---

### Task 1: Módulo y siembra del manual

**Files:** Create `backend/cincoCaminos/manual.js`, `backend/cincoCaminos/manualSemilla.js` (las 30 tácticas) y
`backend/cincoCaminos/manual.test.js`. Modify `server.js` solo para llamar a la siembra al arrancar, junto a donde se
registran las rutas de cinco caminos.

**Interfaces:**
- `sembrarManual(DB)`: si `DB.pos.cinco_caminos.tacticas` no es un arreglo, lo crea con las 30 tácticas: ids 1..30,
  `numero_v1` igual, `activa: true` y etiquetas vacías. Deja una entrada de historial `alta` con `usuario_id: null` y
  `origen: 'semilla_v1'`. Si ya existe, aunque sea vacío, NO hace nada. Devuelve cuántas sembró.
- `validarTactica(body, { parcial })` devuelve el objeto limpio o `null`.
- `crearTactica(DB, body, usuarioId)`, `cambiarTactica(DB, id, body, usuarioId)`, `retirarTactica(DB, id, motivo, usuarioId)`
  y `reactivarTactica(DB, id, usuarioId)`. Las cuatro lanzan error con `status` 400, 404 o 409.
- `fijarEtiqueta(DB, id, sucursalId, { estado, mes, resultado })`: interna, SIN ruta. La usará P5. Valida estado y mes,
  y deja historial `etiqueta`.
- `vistaManual(DB, { verTodas, sucursalId })`: devuelve la lista con `etiqueta_tienda` y `probada_en`, recortada por
  alcance. Ver Global Constraints.

- [ ] Pruebas rojas:
  - La siembra crea exactamente 30 tácticas, con los nombres del manual v1. Correrla dos veces no duplica nada.
  - Una lista vacía no se vuelve a sembrar.
  - Validación: campo desconocido → 400; `camino` fuera de catálogo → 400; `quien` vacío → 400; nombre de 2
    caracteres → 400; un cuerpo que trae `etiquetas` → 400.
  - Cambio parcial: el historial guarda solo lo que cambió.
  - Retiro sin motivo → 400. Retirar una táctica ya retirada → 409.
  - `fijarEtiqueta` con estado raro → error.
  - Alcance de `vistaManual`: sin ver todas, solo su etiqueta, y `probada_en` cuenta bien.
  - Los ids nunca se reusan después de un retiro.
- [ ] Implementar → GREEN → suite backend → **Commit** `feat(cinco-caminos): manual de tacticas con siembra v1 e historial`

### Task 2: Rutas

**Files:** Modify `backend/cincoCaminos/rutas.js` y `backend/cincoCaminos/rutas.test.js`.

**Interfaces:**
- `GET /api/cinco-caminos/manual` (`ver_cinco_caminos`) → `{ tacticas, excluidas_texto }`. Las retiradas van incluidas
  con `activa: false`. La pantalla las oculta por defecto.
- `POST /api/cinco-caminos/manual` (`administrar_manual_tacticas`) → crea.
- `PUT /api/cinco-caminos/manual/:id` → cambia.
- `POST /api/cinco-caminos/manual/:id/retirar` `{ motivo }`.
- `POST /api/cinco-caminos/manual/:id/reactivar`.
- `GET /api/cinco-caminos/manual/:id/historial` (`ver_cinco_caminos`).
- Mismo `ejecutar` y `Cache-Control: no-store` que las rutas existentes. Las escrituras quedan bloqueadas en
  mantenimiento por el middleware global, como el resto.

- [ ] Pruebas rojas, con servidor real como `rutas.test.js`:
  - Roles vecinos: uno con `ver_cinco_caminos` sin administrar no puede escribir (403); uno con otros permisos `pos` no
    puede ni leer (403).
  - `?sucursal_id=` no amplía el alcance de las etiquetas.
  - Un PUT con `etiquetas` → 400 y no cambia nada.
  - Un `:id` de texto como `"3"` funciona; `"3abc"` → 404. Regla 4: normalizar con `Number` y comprobar
    `Number.isInteger`.
- [ ] Implementar → GREEN → **Commit** `feat(cinco-caminos): rutas del manual de tacticas`

### Task 3: Pantalla "Manual de tácticas"

**Files:** Create `src/metas/ManualTacticas.jsx`, `src/metas/manualTacticas.js` y `src/metas/manualTacticas.test.js`.
Modify `src/metas/CincoCaminos.jsx` para agregar la pestaña junto al tablero y a Categorías, siguiendo el patrón de
pestañas existente.

**Pantalla:**
- **Lista agrupada por camino**, en el orden del spec. En cada táctica: nombre, descripción, quién, número que mueve con
  su nombre legible (el mismo texto del tablero), candado, cómo se mide y referencia PDF.
- **Etiqueta de la tienda:** "Por probar", "Probada (mes, resultado)", "No funcionó (mes)" o "Sin dato". Junto a ella,
  "Probada en N tiendas".
- **Filtros:**
  - Por camino.
  - "Mostrar retiradas", apagado por defecto.
- **Si tiene `administrar_manual_tacticas`:**
  - Botones "Nueva táctica", "Editar", "Retirar" (pide motivo) y "Reactivar".
  - Formularios en modal con scroll y botones `type="submit"`, como pide CLAUDE.md.
  - Selects con los valores permitidos: no hay texto libre en camino, número ni medición.
- **Historial:** un botón "Historial" muestra quién cambió qué y cuándo. El nombre de la persona sale del catálogo de
  usuarios que ya usa la app; si no está, va su número.
- **Excluidas a propósito:** la nota fija al final, con el texto del manual v1.
- La etiqueta NO tiene control de edición, con ningún permiso.

- [ ] Pruebas puras: agrupar por camino, texto de la etiqueta, filtro de retiradas y armado del cuerpo del PUT (solo
  los campos que cambiaron y nunca `etiquetas`).
- [ ] eslint, build y pruebas de src → **Commit** `feat(cinco-caminos): pantalla del manual de tacticas`
- [ ] Prueba en navegador (la hace el controlador) a 1280 px y 390 px, con dos usuarios:
  - Uno con administrar: crear, editar, retirar y reactivar, y ver el historial.
  - Otro solo con ver: no ve ningún botón, y si intenta escribir por la API recibe 403.

## Review Focus

1. Nadie puede escribir etiquetas por la API: ni en el alta, ni en el cambio, ni con un campo anidado.
2. La siembra no pisa un manual ya corregido (lista existente, vacía o modificada) → Task 1.
3. El historial guarda quién y qué cambió, y no se puede borrar ni editar por ninguna ruta → Tasks 1 y 2.
4. Alcance de etiquetas por token; `?sucursal_id=` no amplía → Task 2.
5. Los textos de la siembra coinciden con el manual v1 sin mojibake (acentos y "ñ" correctos) → Task 1.
