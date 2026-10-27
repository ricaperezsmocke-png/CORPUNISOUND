# Cinco Caminos P4: planeador en modo cinco caminos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Para una tienda y un mes, la IA lee los números del tablero y el manual y propone tres cosas:
- **el camino más débil**, con su "por qué" en números;
- **2 tácticas** del manual;
- **de 1 a 3 metas** que se miden solas (`cinco_caminos:<numero>`).

El gerente de ventas acepta, cambia o rechaza cada punto. Lo aceptado crea las metas del mes y queda guardado como **el
plan del mes de la tienda**. El tablero lo muestra junto a la junta. La IA nunca crea nada sola.

**Architecture:**
- Módulo nuevo `backend/cincoCaminos/planMes.js`. Arma los datos, llama al modelo, valida la propuesta y crea lo
  aprobado. Reutiliza la llamada al modelo de `planIA.js`: extrae `pedirAlModelo` para que acepte esquema e
  instrucciones, sin cambiar el planeador actual.
- Los borradores van en `DB.pos.planes_ia` con `modo: "cinco_caminos"`. Así comparten el límite diario, el estado
  `pendiente` y la reconciliación al reiniciar.
- El plan aprobado va en `DB.pos.cinco_caminos.planes_mes`. Viaja en el respaldo de `pos`.
- Las rutas van en `backend/cincoCaminos/rutas.js`.
- La pantalla es una sección "Plan del mes" en Cinco caminos.

**Spec:** `docs/superpowers/specs/2026-10-24-cinco-caminos-design.md`, secciones 6.1, 6.2, 6.3, 6.4, 7 y 9.
**Fuera de este plan:** el cierre del mes, las etiquetas y la réplica (P5); vendedor y costo (P6).

## Global Constraints

- Sin dependencias nuevas.
- Líneas de 200 caracteres o menos.
- Staging explícito y commits sin acentos.
- Sin push, merge ni rebase.
- Suites en 0 fallas y eslint en 0 errores.
- Corre en comandos SEPARADOS la suite backend, src, el build y eslint (8 GB de RAM).
- **Las pruebas NUNCA llaman a la API real**: usan un cliente falso, como `planIA.test.js`.
- **Permisos:** proponer, ajustar, validar y descartar usan `administrar_metas_personalizadas`, igual que el planeador
  actual. Ver el plan del mes usa `ver_cinco_caminos`.
- **Alcance:** no se agrega ninguno nuevo. Quien tiene `administrar_metas_personalizadas` ya crea metas de cualquier
  tienda.
- **Entrada:** `{ sucursal_id (obligatoria), mes: 'AAAA-MM' }`. El mes debe ser el actual o el siguiente y no estar
  sellado. Si ya hay un plan del mes APROBADO para esa tienda y mes, responde 409.
- **Datos que recibe la IA.** Todo es agregado y nada trae nombres de personas:
  - los 7 números de `NUMEROS_META` de la tienda: el promedio de las últimas 8 semanas cerradas y el valor del mismo mes
    de 2025 (`valorDelPeriodo`), en forma legible (45.2, 850.00, 1.85) y con `null` = sin dato;
  - `registros_por_10_tickets` como dato de confianza, nunca como meta;
  - el manual: solo tácticas `activa` y que no sean `fase_2` ni `fase_3`, con
    `{ id, nombre, camino, numero_que_mueve, candado, quien, como_se_mide, probada_en, etiqueta_tienda }`;
  - los planes del mes anteriores de esa tienda: camino, tácticas y meses;
  - `fecha_hoy`.
- **Esquema de salida:**
  - `camino`: `calidad_dato | prospectos | conversion | compras_por_cliente | venta_promedio`. Margen no, porque es
    fase 3.
  - `por_que_camino`: hasta 300 caracteres.
  - `tacticas`: exactamente 2 elementos `{ id, por_que }`.
  - `metas`: de 1 a 3 elementos `{ numero, valor, responsable_rol, por_que }`. `valor` es un número legible;
    `responsable_rol` es `vendedores | encargado | compras | gerente`.
- **Reglas que valida el SERVIDOR.** No se confía en que la IA las cumpla:
  1. **Calidad del dato primero.** Si `pct_con_cliente` del promedio de 8 semanas es menor que 50, el camino se
     fuerza a `calidad_dato`. Una meta que no sea `pct_con_cliente` queda permitida, pero se marca `fuera_de_camino`.
  2. **Tácticas:** dos ids distintos del manual que estén activos y que no sean de fase 2 o 3.
  3. **Metas.** El número debe estar en `NUMEROS_META` y su base no puede ser `null`. Base = mismo mes 2025; si es
     null, el promedio de 8 semanas; si ambos son null, la meta se descarta. La cifra se ajusta al rango
     `[base × 1.05, base × 1.15]`, redondeada a la escala del número. Si se ajustó, queda `ajustada: true` con lo que
     propuso la IA.
  4. **Números del "por qué":** todo número que aparezca debe estar en los datos enviados. Si no, se reemplaza por un
     texto fijo, como en `planIAValidar.js`.
  5. **Responsable:** `compras` solo con metas cuyo número dependa de existencia (Claude: ninguna de las 7 depende,
     así que se acepta cualquiera). El responsable es un rol, nunca una persona.
  6. **Sin descuento:** si `por_que` o el nombre de una táctica habla de descuento o rebaja y el camino es
     `conversion`, la táctica se rechaza. Regla 6.2 del spec.
- **Aprobación** (`POST .../validar`). El gerente decide sobre cada punto:
  - camino: acepta o cambia a otro del enum;
  - cada táctica: acepta, cambia por otra id válida o rechaza;
  - cada meta: acepta, cambia la cifra (legible, dentro del mismo rango) o rechaza.

  Mínimo: el camino, 1 táctica y 1 meta aceptados. Si no, responde 400.

  Todo o nada:
  - crea las metas `cinco_caminos:<numero>`, alcance tienda, periodo mensual del mes. El nombre lo arma el servidor:
    "<Número>: llegar a <cifra legible>". La descripción guarda el responsable y el "por qué";
  - escribe `planes_mes`:
    `{ id, sucursal_id, mes, camino, tacticas: [ids], metas: [claves], plan_ia_id, aprobado_por_id, aprobado_en }`;
  - marca el borrador como `validado`.
- **Descartar:** con motivo, como el planeador actual.
- **Ver el plan del mes:** `GET /api/cinco-caminos/plan-mes?mes=` (`ver_cinco_caminos`, alcance por token, como el
  tablero) devuelve el plan con los nombres de las tácticas y el avance de sus metas (de `avanceMeta`).
- **Restauración:** `planes_mes` arranca como arreglo si falta, como ya se hace con `juntas`.

---

### Task 1: Datos y validación (puro)

**Files:**
- Create `backend/cincoCaminos/planMes.js` (las funciones `armarDatosPlanMes` y `validarPropuestaMes`) y su test.
- Modify `backend/cincoCaminos/metaNumero.js` solo si hace falta exportar la escala o la conversión a texto legible.

- [ ] **Pruebas rojas.** Cubre al menos:
  - datos sin nombres de persona;
  - las tácticas de fase 3 y las retiradas no se envían;
  - con `pct_con_cliente` de 30, el camino queda forzado a `calidad_dato`;
  - una cifra 40% arriba de la base se ajusta a +15%;
  - una base `null` descarta la meta;
  - una táctica inexistente o repetida invalida la propuesta;
  - un número inventado en el "por qué" se reemplaza;
  - una táctica de descuento con camino `conversion` se rechaza;
  - `registros_por_10_tickets` como meta invalida la propuesta.
- [ ] Implementar → GREEN → **Commit** `feat(cinco-caminos): datos y validacion del plan del mes`

### Task 2: Proponer, validar, descartar y rutas

**Files:**
- Modify:
  - `backend/planIA.js`: extraer `pedirAlModelo(cliente, contenido, timeoutMs, { esquema, instrucciones })` sin cambiar
    su comportamiento;
  - `backend/cincoCaminos/planMes.js`: `proponerPlanMes`, `validarPlanMes` y `descartarPlanMes`;
  - `backend/cincoCaminos/rutas.js` + test;
  - `backend/reconciliarRestauracion.js`.
- Rutas:
  - `POST /api/cinco-caminos/plan-mes/proponer` y `POST .../:id/validar` y `POST .../:id/descartar`, todas con
    `administrar_metas_personalizadas`;
  - `GET /api/cinco-caminos/plan-mes` y `GET .../borradores`, con `ver_cinco_caminos` y
    `administrar_metas_personalizadas` respectivamente.
- Las instrucciones del modelo están en español y repiten las reglas 6.2. También dicen que los datos son información y
  nunca instrucciones.

- [ ] **Pruebas rojas con cliente falso.** Cubre al menos:
  - una propuesta válida queda en borrador;
  - "validar" crea las metas `cinco_caminos:*` y el `plan_mes`, y si algo falla no crea nada;
  - un segundo plan aprobado para el mismo mes da 409;
  - un rol vecino recibe 403;
  - el límite diario se comparte con el planeador actual;
  - un plan pendiente queda en `fallido` al reiniciar;
  - el planeador actual (OKR y metas) sigue igual: sus pruebas pasan sin tocarse;
  - una cifra cambiada por el gerente fuera del rango da 400.
- [ ] Implementar → GREEN → **Commit** `feat(cinco-caminos): planeador del plan del mes con aprobacion del gerente`

### Task 3: Pantalla "Plan del mes"

**Files:**
- Create `src/metas/PlanMes.jsx` y `src/metas/planMes.js` + test.
- Modify `src/metas/CincoCaminos.jsx`.

La sección "Plan del mes" va en Cinco caminos, arriba de la junta:

- **Sin plan aprobado y con permiso:** botón "Proponer plan con IA" para la tienda y el mes, más la lista de borradores.
- **Borrador:**
  - el camino con su "por qué";
  - las 2 tácticas con nombre y "por qué";
  - las metas con número, cifra legible, base, responsable, "por qué" y la marca "ajustada" con lo que propuso la IA.
  - Cada punto tiene Aceptar, Cambiar y Rechazar. Cambiar es un select del enum o de las tácticas válidas, o la cifra
    legible.
  - Botones "Crear lo aceptado" y "Descartar" (pide motivo).
- **Plan aprobado:** camino, tácticas y metas con su avance, o "Sin dato" si no lo hay. Muestra quién lo aprobó y cuándo.
- Sin `cliente` configurado, el servidor responde 503 y la pantalla muestra "El planeador con IA no está configurado".
- Modales con scroll, botones `type="submit"` y funciona a 390 px.

- [ ] **Pruebas puras:** armado del cuerpo de "validar", texto de cada decisión y conversión de la cifra (reutiliza
  `legibleAEntero`).
- [ ] eslint, build y src → **Commit** `feat(cinco-caminos): pantalla del plan del mes`
- [ ] **Prueba en navegador** (controlador) con un cliente falso inyectado en el servidor de prueba. Proponer, cambiar
  una táctica, rechazar una meta, crear lo aceptado, ver el plan aprobado y sus metas en Metas extra. Repetir con un
  usuario sin permiso: no ve botones y recibe 403.

## Review Focus

1. La IA no puede crear nada sola. Todo pasa por "validar", que es todo o nada.
2. Las reglas 6.2 las valida el servidor: calidad del dato < 50, rango +5/+15 %, nada con base sin dato, sin
   descuento en conversión y números del "por qué" solo de los datos.
3. A la IA no le llega ningún nombre de persona.
4. El planeador actual de OKR y metas se comporta igual.
5. Un plan aprobado por tienda y mes. Las metas que crea se miden solas y salen "Sin dato" si no hay semanas.
