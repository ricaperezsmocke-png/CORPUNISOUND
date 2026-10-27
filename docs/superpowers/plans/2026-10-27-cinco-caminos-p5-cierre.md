# Cinco Caminos P5: cierre del mes, etiquetas y réplica — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cuando termina un mes, el sistema califica solo cada táctica del plan del mes de cada tienda:
- **¿se hizo?** (por número o por evidencia),
- **¿se movió su número?** sin que cayera su candado.

El resultado (`probada`, `no_funciono`, `no_se_hizo`, `sin_dato`) queda en la etiqueta de la táctica para esa tienda.
Después, el diagnóstico de la IA en otras tiendas ve lo probado con su cifra y lo propone primero. Nadie edita una
etiqueta a mano.

**Architecture:**
- Módulo nuevo `backend/cincoCaminos/cierreMes.js`: evaluación pura y cierre idempotente.
- Las tácticas por evidencia generan, al aprobar el plan, una **meta manual de tienda con prueba** (`foto` o `liga`).
  Se reutilizan las capturas de `metasCapturas.js` tal cual: foto a Drive, foto o liga que no cuenta dos veces, anulación
  con motivo por la jefatura.
- Los cierres van en `DB.pos.cinco_caminos.cierres`. Viajan en el respaldo de `pos`.
- El cierre corre solo: al arrancar el servidor, tras restaurar y cada hora (patrón de `cicloEstadosCRM` en
  `server.js`). No hay ruta para cerrar ni para reabrir.

**Spec:** `docs/superpowers/specs/2026-10-24-cinco-caminos-design.md`, secciones 5, 6.5, 6.6 y 9.
**Fuera de este plan:** vendedor y costo (P6); margen y descuento promedio (fase 3).

## Decisiones ya tomadas (Victor, 2026-10-27)

1. **Evidencia:** al aprobar el plan del mes, cada táctica con `como_se_mide` = `evidencia` o `sistema_y_evidencia` crea
   una meta con prueba. Sin evidencia suficiente al cierre, la táctica sale `no_se_hizo` y no cuenta ni a favor ni en
   contra.
2. **Cierre automático**, sin botón. La etiqueta no se edita a mano.

## Decisiones de Claude (informadas a Victor)

- **Gracia de 3 días:** un mes se cierra cuando `hoy >= primerDiaParaSellar('mensual', '<mes>-01') + 3 días`. Así la
  jefatura tiene 3 días para anular evidencia basura antes de que cuente.
- **Qué etiqueta se sobrescribe:** `probada` y `no_funciono` sustituyen la etiqueta anterior (gana el mes más reciente).
  `no_se_hizo` y `sin_dato` **no tocan** una etiqueta `probada` o `no_funciono`; solo se escriben sobre `por_probar` o
  `sin_dato` (y `no_se_hizo` se guarda como `sin_dato` en la etiqueta, porque `ESTADOS_ETIQUETA` no lo trae). El
  detalle completo queda siempre en el cierre.
- **Base 0 o negativa:** no se puede medir un porcentaje → `sin_dato`.

## Global Constraints

- Sin dependencias nuevas.
- Líneas de 200 caracteres o menos.
- Staging explícito y commits sin acentos.
- Sin push, merge ni rebase.
- Suites en 0 fallas y eslint en 0 errores.
- Corre en comandos SEPARADOS la suite backend, src, el build y eslint (8 GB de RAM).
- Las pruebas no llaman a la API real ni a Drive real; usan dobles, como `planMesFlujo.test.js` y las pruebas de
  `metasCapturas`.
- Las pruebas no dependen del reloj real: `hoy` siempre entra como parámetro (ya hubo una prueba que falló un día
  después; ver commit `test(cinco-caminos): limite diario con hora fija`).
- `fijarEtiqueta` (manual.js) es la ÚNICA forma de escribir una etiqueta. No se agrega ninguna ruta que la llame.

## Reglas del cierre (contrato)

Para cada `plan_mes` `{ sucursal_id, mes, tacticas, evidencias? }` cuyo mes ya pasó la gracia y que no tenga cierre:

1. **Valor del mes** de un número `n`: promedio de las semanas cuyo lunes cae en el mes, como `valorDelPeriodo`.
   `registros_por_10_tickets` no está en `NUMEROS_META`: agrega un lector propio en `cierreMes.js`
   (`s => s.radar.registros_por_10_tickets`, factor 100, sin tocar `NUMEROS_META` porque no puede ser meta).
   La conversión con `no_confiable` ya da `null`.
2. **Base** de cada número (cada uno por separado): el mismo mes del año anterior; si es `null`, el promedio de las 8
   semanas cerradas antes del primer lunes del mes (`tableroTienda(...).promedio_8` con ese lunes). La conversión y los
   registros del Radar usan siempre el promedio de 8 (el Radar no tiene año anterior).
3. **¿Se hizo?**
   - `sistema`: se hizo si el valor del mes del número no es `null`.
   - `evidencia`: se hizo si la meta de evidencia ligada tiene, dentro del mes, capturas no anuladas cuya suma de
     cantidad ≥ `valor_meta`. Sin meta ligada (planes aprobados antes de P5) → `no_se_hizo`.
   - `sistema_y_evidencia`: las dos condiciones.
   - `fase_2`, `fase_3`: `sin_dato` (el planeador ya no las ofrece; esto es defensa).
4. **¿Se movió?** valor del mes ≥ base × 1.05.
5. **¿Cayó el candado?** valor del candado < base del candado × 0.95. Si el candado es `registros_por_10_tickets`:
   < base × 0.70. Sin candado (`null`): no cae nunca. Candado con valor o base `null` → la táctica sale `sin_dato`.
6. **Resultado:** no se hizo → `no_se_hizo`; número o base `null` (o base ≤ 0) → `sin_dato`; se movió y el candado no
   cayó → `probada`; si no → `no_funciono`.
7. **En conjunto:** si dos tácticas del mismo plan mueven el mismo número y las dos salen `probada`, las dos quedan
   `probada` con `en_conjunto_con: <id de la otra>` y su texto de resultado lo dice.
8. **Texto del resultado** (`resultado` de la etiqueta, ≤ 300 caracteres, armado por el servidor, sin nombres de
   persona): `"<Número>: <base legible> → <valor legible> (+12.3 %) contra <mismo mes 2025 | 8 semanas previas>; candado
   <Número candado> <bien | cayó -7.1 %>"`. Usa `formatearValor`; para los registros del Radar, el valor con dos
   decimales.
9. **Registro del cierre** en `cierres`: `{ id, sucursal_id, mes, plan_mes_id, cerrado_en, tacticas: [{ id, como_se_mide,
   numero, valor, base, base_tipo, cambio_pct, candado, candado_valor, candado_base, candado_cambio_pct, evidencia:
   { meta_clave, requeridas, capturas_contadas: [ids] } | null, resultado, en_conjunto_con }] }`. Un cierre por
   `(sucursal_id, mes)`; nunca se recalcula ni se borra.
10. **Sin SICAR** (`sqlite` no disponible): no se cierra nada y se reintenta en la siguiente vuelta. Un error en una
    tienda no detiene a las demás; se registra con `console.warn`.
11. **Todo o nada por tienda y mes:** si algo falla a la mitad, no queda ni el cierre ni ninguna etiqueta de ese mes.

## Evidencia al aprobar el plan (cambio a `validarPlanMes`)

- Cuerpo nuevo, opcional por táctica aceptada o cambiada: `{ prueba: 'foto' | 'liga', veces: 1..31 }`. Valores por
  omisión: `foto` y 1. Se ignora si la táctica es `sistema`.
- Para cada táctica final con evidencia se crea con `M.crearMeta`, dentro del mismo todo o nada:
  `{ nombre: 'Táctica: <nombre real>' (≤ 120), descripcion: 'Comprueba con <foto|liga> que se hizo. <descripción>'
  (≤ 500), unidad: 'veces', fuente: 'manual', prueba, valor_meta: veces, periodo: 'mensual', inicio, alcance: 'tienda',
  sucursal_id }` con el mismo `origen` del plan.
- `planes_mes` guarda `evidencias: [{ tactica_id, meta_clave }]`. Los planes viejos sin ese campo se leen como `[]`.
- Si la meta de evidencia se retira después, el cierre usa la clave guardada y cuenta las capturas de cualquier versión
  de esa clave; una meta retirada sin capturas suficientes da `no_se_hizo`.

## Réplica (cambio a `armarDatosPlanMes` e `INSTRUCCIONES_MES`)

- Cada táctica de `datos.manual` agrega `resultados_otras_tiendas`: lista de hasta 3 cierres `probada` de OTRAS
  tiendas, los más recientes, `{ mes, numero, cambio_pct, candado_cambio_pct }`. Sin ids ni nombres de tienda.
- Las instrucciones dicen: "Si una táctica del camino más débil tiene resultados en otras tiendas, propónla primero y
  cita su cifra". Como las cifras van en `datos`, `numerosDe(datos)` ya las permite en el "por qué".
- El servidor no obliga a elegir la táctica probada: el gerente decide.

---

### Task 1: Evaluación pura

**Files:** Create `backend/cincoCaminos/cierreMes.js` (`evaluarTactica`, `evaluarPlan`, `textoResultado`) y su test.

- [ ] **Pruebas rojas** con números de entrada fijos (sin SQLite). Cubre al menos:
  - +5.0 % exacto es `probada`; +4.9 % es `no_funciono`;
  - candado que cae 5.1 % → `no_funciono`; cae 4.9 % → `probada`;
  - candado de registros del Radar: cae 29 % → bien; cae 31 % → `no_funciono`;
  - base del mismo mes `null` → usa 8 semanas y lo dice en el texto;
  - número `null`, base `null`, base 0, candado `null` → `sin_dato`;
  - evidencia: 2 de 3 capturas → `no_se_hizo`; una anulada no cuenta; una fuera del mes no cuenta;
  - `sistema_y_evidencia` con número pero sin evidencia → `no_se_hizo`;
  - dos `probada` del mismo número → `en_conjunto_con` cruzado;
  - el texto no pasa de 300 caracteres.
- [ ] Implementar → GREEN → **Commit** `feat(cinco-caminos): evaluacion de tacticas al cierre del mes`

### Task 2: Evidencia al aprobar

**Files:** Modify `backend/cincoCaminos/planMes.js` (`decidirTacticas`, `validarPlanMes`) y `planMesFlujo.test.js`.

- [ ] **Pruebas rojas:**
  - aprobar con una táctica `evidencia` crea su meta `manual` con prueba `foto`, `valor_meta` 1, tienda y mes del plan;
  - `prueba: 'liga', veces: 4` se respeta; `veces: 0`, `32`, `1.5` o una prueba inválida → 400 y no crea nada;
  - una táctica `sistema` no crea meta de evidencia aunque mande `prueba`;
  - si falla la meta de evidencia, no queda ninguna meta ni el `plan_mes` (todo o nada);
  - `evidencias` queda en el `plan_mes`;
  - una vendedora de la tienda puede capturar "Hecho" con foto en esa meta (flujo existente de `metasCapturas`).
- [ ] Implementar → GREEN → **Commit** `feat(cinco-caminos): tactica por evidencia crea su meta con prueba al aprobar`

### Task 3: Cierre idempotente, ciclo y restauración

**Files:**
- Modify `backend/cincoCaminos/cierreMes.js` (`cerrarMesesPendientes(sqlite, DB, { hoy })`) y su test.
- Modify `backend/server.js` (al arrancar y `setInterval` cada hora con `.unref()`, como `cicloEstadosCRM`; guarda la DB
  si cerró algo, con el mismo mecanismo de guardado que ya usan esos ciclos).
- Modify `backend/reconciliarRestauracion.js`: `cierres` arranca como arreglo si falta; tras restaurar se corre
  `cerrarMesesPendientes`.

- [ ] **Pruebas rojas** con una SQLite en memoria como `planMesFlujo.test.js`:
  - antes de la gracia no cierra; el día de la gracia sí;
  - correrlo dos veces deja un solo cierre y una sola entrada `etiqueta` por táctica en el historial;
  - `probada` escribe la etiqueta con `mes` y `resultado`; `vistaManual(...).probada_en` sube a 1;
  - `no_se_hizo` sobre una táctica ya `probada` no toca su etiqueta, pero sí queda en el cierre;
  - `no_funciono` de noviembre sustituye un `probada` de octubre;
  - sin `sqlite` no cierra nada y no truena;
  - una tienda que truena no impide cerrar la otra, y la que tronó no deja etiquetas a medias;
  - una táctica retirada del manual después de aprobar el plan se evalúa igual (se busca por id aunque esté inactiva).
- [ ] Implementar → GREEN → **Commit** `feat(cinco-caminos): cierre automatico del mes con etiquetas`

### Task 4: Réplica en el diagnóstico

**Files:** Modify `backend/cincoCaminos/planMes.js` (`manualParaIA`, `INSTRUCCIONES_MES`) y `planMes.test.js`.

- [ ] **Pruebas rojas:**
  - un cierre `probada` de la tienda 2 aparece en `resultados_otras_tiendas` al armar los datos de la tienda 1, sin id ni
    nombre de la tienda 2;
  - los cierres de la propia tienda no aparecen ahí (ya van en `etiqueta_tienda`);
  - máximo 3, los más recientes;
  - un "por qué" que cita ese `cambio_pct` no se reemplaza; uno con una cifra inventada sí.
- [ ] Implementar → GREEN → **Commit** `feat(cinco-caminos): el diagnostico propone primero lo probado en otras tiendas`

### Task 5: Pantalla

**Files:** Modify `src/metas/PlanMes.jsx`, `src/metas/planMes.js` + test; `backend/cincoCaminos/planMes.js`
(`verPlanMes` agrega `cierre` y `evidencias` con su avance); el manual en pantalla si no muestra ya la etiqueta.

- Al aprobar: bajo cada táctica con evidencia, "Cómo se comprueba: foto | liga" y "Cuántas veces en el mes" (1 a 31).
- Plan aprobado, mes abierto: cada táctica con evidencia muestra "Evidencia: 1 de 3" (del avance de su meta).
- Mes cerrado: "Resultado del mes" con cada táctica: se hizo sí/no, el texto del resultado y la etiqueta en color
  (probada verde, no funcionó rojo, no se hizo y sin dato gris). Y la leyenda "Calificado por el sistema el <fecha>.
  No se edita a mano."
- Mes terminado sin cerrar todavía: "Se califica el <fecha de gracia>".
- Modales con scroll, botones `type="submit"` y funciona a 390 px.

- [ ] **Pruebas puras:** cuerpo de "validar" con `prueba` y `veces`, texto del resultado y colores.
- [ ] eslint, build y src → **Commit** `feat(cinco-caminos): pantalla del cierre del mes`
- [ ] **Prueba en navegador** (controlador, no el implementador): con datos sembrados de un mes ya pasado, aprobar un
  plan con una táctica por evidencia, capturar la foto como vendedora, correr el cierre con `hoy` fijo y ver el
  resultado, la etiqueta en el manual y el dato en la propuesta de otra tienda (cliente de IA falso).

## Review Focus

1. Nadie puede escribir una etiqueta: no hay ruta, y `fijarEtiqueta` solo la llama el cierre.
2. Una táctica no sale `probada` sin haberse hecho: la evidencia exige capturas no anuladas dentro del mes.
3. Umbrales exactos: +5 %, candado -5 %, Radar -30 %, 3 días de gracia.
4. Idempotente y todo o nada por tienda y mes; correrlo dos veces no cambia nada.
5. A la IA no le llega ni el nombre ni el id de otra tienda.
6. El plan del mes de P4 y el planeador viejo siguen igual: sus pruebas pasan sin tocarse, salvo las nuevas de
   evidencia.
