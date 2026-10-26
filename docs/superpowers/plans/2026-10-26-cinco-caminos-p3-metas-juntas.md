# Cinco Caminos P3: metas que se miden solas y junta del lunes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que una meta de tienda pueda ser "llevar el % de tickets con cliente a 45%" y se mida sola con los números del
tablero. Y que el tablero tenga la junta del lunes: compromisos con responsable y fecha que se tachan, y la marca
"junta hecha", de la que sale el indicador "juntas hechas".

**Architecture:** En `metasFuentes.js` entra una familia nueva de fuentes `cinco_caminos:<numero>`. Su "conteo" no es
un conteo: es el **valor del número en el periodo**, que es el promedio de las semanas completas del periodo calculado
con `numerosSemana` del tablero. Esa fuente solo vale para alcance `tienda`. La cifra meta se guarda como entero
escalado (por ejemplo, décimas de punto) para no romper `validarCifra`. La junta vive en
`DB.pos.cinco_caminos.juntas`. Va en el JSON principal, así que entra al respaldo de `pos` y a la reconciliación sin
tocar el respaldo SICAR. Las rutas van en `backend/cincoCaminos/`.

**Tech Stack:** Node + Express (JSON DB + better-sqlite3 de solo lectura para el tablero), React + Vite, `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-24-cinco-caminos-design.md`, secciones 3, 6.4, 7 y 9.
**Fuera de este plan:** el planeador IA en modo cinco caminos (P4), el cierre del mes y las etiquetas (P5), y
vendedor y costo (P6). En P3 el administrador de metas crea a mano estas metas, en la pantalla de metas existente.

## Global Constraints

- Sin dependencias nuevas.
- Líneas de 200 caracteres o menos en `.js/.jsx` de `src/` y `backend/`.
- Staging explícito. Commits sin acentos. Sin push, merge ni rebase.
- Suites en 0 fallas y eslint en 0 errores. Suite de backend, pruebas de src, build y eslint en comandos SEPARADOS:
  el equipo tiene 8 GB.
- **Escala de la cifra meta.** `valor_meta` sigue siendo un entero entre 1 y 1,000,000:

  | Número | Unidad guardada | Ejemplo |
  |---|---|---|
  | `pct_con_cliente`, `recompra_90`, `pct_instrumento_con_accesorio`, `conversion` | décimas de punto, 0–1000 | 452 = 45.2 % |
  | `ticket_promedio_centavos` | centavos | 85000 = $850.00 |
  | `clientes_nuevos` | entero por semana | 12 |
  | `articulos_por_ticket` | centésimas | 185 = 1.85 |

  La unidad la pone el servidor, no el usuario.
- **Números permitidos como fuente:** los siete de la tabla. `registros_por_10_tickets` NO, porque es un candado y no
  una meta (spec §9). Tampoco margen ni descuento (fase 3).
- **Valor del periodo:** el promedio de las semanas cuyo lunes cae dentro del periodo y cuyo domingo ya pasó (en
  `America/Mexico_City`), con el `promedio` del tablero y saltando las semanas `sin_dato`.
  - `conversion` toma `radar.conversion` de cada semana y salta las marcadas `no_confiable`.
  - Si el periodo no tiene ninguna semana válida, el resultado es **"sin dato"**: ni 0, ni porcentaje, ni semáforo
    rojo. Regla: no inventarle un fracaso a nadie.
- **Avance:** resultado ≥ cifra meta es cumplida. El porcentaje de avance es resultado ÷ meta con tope de 100. Todos
  los números permitidos son "más es mejor".
- **Solo alcance `tienda`** y `prueba: "ninguna"`. Cualquier otra combinación se rechaza con 400.
- **Junta del lunes:**
  - Compromiso: `{ id, sucursal_id, lunes, texto 3-200, responsable 3-80 (texto libre: nombre o rol),
    fecha_compromiso AAAA-MM-DD dentro de esa semana o la siguiente, hecho: null | {por_id, por_nombre, en},
    cancelado: null | {por_id, motivo 3-200, en}, creado_por_id, creado_en }`.
  - Junta: `{ sucursal_id, lunes, por_id, en }`.
  - Los compromisos nunca se borran; se cancelan con motivo. "Junta hecha" exige al menos un compromiso vigente de esa
    semana y no se puede desmarcar.
  - Todo guarda el usuario del token.
- **Permiso nuevo** `marcar_junta_cinco_caminos`, módulo `pos`, alta en `permisosCatalogo.js`.
  - Ver las juntas pide `ver_cinco_caminos`.
  - Crear, marcar hecho, cancelar y "junta hecha" piden `marcar_junta_cinco_caminos`.
  - Crear metas `cinco_caminos:*` pide el permiso actual de metas personalizadas (`administrar_metas_personalizadas`).
- **Alcance por token (regla 5):** sin `ver_todas_las_sucursales`, solo la tienda del token, sin importar
  `?sucursal_id=` ni el cuerpo.
- **Fechas:** días con `fechaLocal()`; marcas completas en ISO UTC.

---

### Task 1: La fuente `cinco_caminos:<numero>`

**Files:**
- Modify: `backend/metasFuentes.js`, `backend/metasPersonalizadas.js` y `backend/metasAvance.js` (solo si hace falta,
  para "sin dato").
- Create: `backend/cincoCaminos/metaNumero.js` + test.
- Modify: `backend/metasFuentes.test.js` y `backend/metasPersonalizadas.test.js`.

**Interfaces:**
- `metaNumero.js`:
  - `NUMEROS_META`: mapa número → `{ escala, unidad, leer(semana) }`.
  - `valorDelPeriodo(sqlite, DB, { sucursal_id, periodo, inicio, hoy })` → `{ valor: entero escalado | null, semanas:
    [{lunes, valor}], sin_dato: bool }`.
- `FUENTES` agrega las 7 claves `cinco_caminos:<numero>`, y `DESCRIPCION_FUENTES` les da un texto legible.
- `contarFuente` despacha estas fuentes a `valorDelPeriodo`. Usa la conexión ya configurada. Sin conexión SICAR,
  devuelve `valor: null` con aviso.
- `crearMeta`:
  - Una fuente `cinco_caminos:*` exige alcance `tienda` y prueba `ninguna`, y pone sola la `unidad` legible.
  - Las otras fuentes automáticas siguen exigiendo alcance corporativo. No cambia nada de lo existente.
- El avance:
  - Con `valor: null` muestra "sin dato": sin porcentaje y sin semáforo.
  - Con valor, compara el entero escalado contra `valor_meta`.

- [ ] **Pruebas rojas:**
  - Mes con 4 semanas válidas → promedio correcto en décimas.
  - Semana sin dato → se salta.
  - Mes sin ninguna semana válida → `sin_dato` y avance sin porcentaje.
  - Semana en curso (domingo futuro) → no cuenta.
  - Conversión `no_confiable` → se salta.
  - `registros_por_10_tickets` como fuente → 400.
  - Fuente cinco caminos con alcance persona → 400.
  - Las metas existentes no cambian.
- [ ] Implementar → GREEN → suite backend → **Commit** `feat(metas): metas de tienda que se miden con los cinco caminos`

### Task 2: Junta del lunes — servidor

**Files:**
- Create: `backend/cincoCaminos/juntas.js` + test.
- Modify: `backend/cincoCaminos/rutas.js` + test, `backend/permisosCatalogo.js` y `backend/reconciliarRestauracion.js`.
  En este último, `juntas` arranca como arreglo si falta, como ya se hace con otras colecciones.

**Interfaces:**
- `GET /api/cinco-caminos/junta?lunes=` (`ver_cinco_caminos`) → `{ compromisos, junta, indicador }`.
  - `indicador`: `{ semanas: 8, con_junta: N, pct }` sobre las 8 semanas previas completas.
- `POST /api/cinco-caminos/junta/compromisos` → crea.
- `POST /api/cinco-caminos/junta/compromisos/:id/hecho` → marca hecho.
- `POST /api/cinco-caminos/junta/compromisos/:id/cancelar` `{ motivo }` → cancela.
- `POST /api/cinco-caminos/junta/hecha` `{ lunes }` → marca la junta.
  - Responde 409 si ya estaba marcada.
  - Responde 400 si no hay ningún compromiso vigente.
- `lunes` debe ser un lunes válido y no futuro. Los ids siguen la regla 4.
- Alcance por token. El cuerpo nunca elige la tienda.

- [ ] **Pruebas rojas, con servidor real y roles vecinos:**
  - Un rol que solo ve no puede escribir.
  - `?sucursal_id=` no amplía el alcance.
  - Junta sin compromisos → 400.
  - Junta dos veces → 409.
  - Cancelar sin motivo → 400.
  - Marcar como hecho un compromiso cancelado → 409.
  - El indicador cuenta bien con huecos.
  - Restaurar una foto sin `juntas` deja un arreglo.
  - Nadie edita el texto de un compromiso ya creado: no hay ruta.
- [ ] Implementar → GREEN → **Commit** `feat(cinco-caminos): junta del lunes con compromisos`

### Task 3: Pantallas

**Files:**
- Create: `src/metas/JuntaLunes.jsx`, `src/metas/juntaLunes.js` + test.
- Modify:
  - `src/metas/CincoCaminos.jsx`: la sección de junta debajo del tablero de la semana elegida, y "Juntas hechas: N de
    8 semanas" junto a los números.
  - `src/metas/AdministrarMetas.jsx`: al elegir la fuente "Cinco caminos: …", el alcance queda en tienda, la prueba se
    oculta y la cifra se captura en la unidad legible (45.2 %, $850.00, 1.85). La conversión a entero escalado va en
    una función pura probada.
  - Donde hoy se muestra el avance de una meta automática, mostrar "sin dato" cuando corresponda.

**Pantalla de la junta:**
- Lista de compromisos de la semana con texto, responsable, fecha y estado (pendiente, hecho por X el día Y, o
  cancelado con su motivo).
- Con `marcar_junta_cinco_caminos`: "Agregar compromiso", "Hecho", "Cancelar" (pide motivo) y "Marcar junta hecha".
  Este último se deshabilita sin compromisos y, una vez marcada, muestra quién y cuándo.
- Modales con scroll y botones `type="submit"`. Funciona a 390 px.

- [ ] **Pruebas puras:**
  - Conversión de cifra legible a entero escalado y de vuelta, con 45.2, 45, 45.25 (se rechaza) y $850.5.
  - Texto de estado de un compromiso.
  - Texto del indicador.
  - Armado de cuerpos: nunca mandan `sucursal_id` ni usuario.
- [ ] eslint, build y pruebas de src → **Commit** `feat(cinco-caminos): pantallas de junta del lunes y metas por numero`
- [ ] **Prueba en navegador** (la hace el controlador), a 1280 y 390 px:
  - Crear una meta "% tickets con cliente 45.2 %" en Ocosingo y ver su avance o "sin dato".
  - Junta: agregar 2 compromisos, marcar uno hecho, cancelar otro con motivo y marcar junta hecha.
  - Un usuario que solo ve: no ve botones y la API le responde 403.

## Review Focus

1. Una meta cinco caminos sin semanas válidas sale "sin dato", nunca 0 % ni rojo → Tasks 1 y 3.
2. La escala de la cifra es la misma en la pantalla, el servidor y el avance (45.2 % = 452 en los tres) → Tasks 1 y 3.
3. Ninguna ruta de la junta deja elegir la tienda por cuerpo o query si no se ven todas → Task 2.
4. Los compromisos no se borran ni se editan. "Junta hecha" no se desmarca y exige compromisos → Task 2.
5. Las metas automáticas existentes (corporativo) se comportan igual → Task 1.
