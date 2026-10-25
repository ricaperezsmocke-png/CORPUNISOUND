# Pulido de pendientes (existencias, cortes, mostrador y tablero) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar los detalles menores que las revisiones de E1 (existencias), E2 (cortes) y P1 (Cinco Caminos) dejaron
anotados y que siguen abiertos, más la prueba intermitente del CRM.

**Architecture:** Cambios chicos y aislados sobre lo ya construido; ninguno cambia el contrato SICAR ni el respaldo.
Rama nueva `fix/pulido-pendientes-sicar` desde `master` **después** de mergear Cinco Caminos P1.

**Tech Stack:** Node (agente y servidor), React, `node --test`.

**Fuente:** ledgers de revisión `.superpowers/sdd/2026-10-23-sicar-existencias/`, `2026-10-23-sicar-cortes/`,
`2026-10-24-pulido/` y `2026-10-24-cinco-caminos-p1-mostrador-tablero/` (los ya corregidos no se repiten aquí).

## Global Constraints
- Mismas reglas del repo: sin dependencias, líneas ≤ 200 en `src/`/`backend/`, staging explícito, commits sin acentos,
  sin push/merge/rebase, suites en 0 fallas, eslint 0 errores.
- Nada de esto puede frenar el envío de ventas del agente ni cambiar el formato de los lotes.

## Review Focus
1. Reenviar un corte incompleto no debe duplicarlo ni mover el cursor hacia atrás → Task 1.
2. Podar mapas del estado no debe olvidar ventas dentro de la ventana de 48 h ni del margen → Task 1.
3. El tope de rango de cortes no debe esconder datos sin avisar → Task 2.

---

### Task 1: Agente — robustez y ruido
**Files:** `agente-sicar/corrida.js`, `estado.js`, `index.js`, `mapeo.js`, `LEEME.md` y sus pruebas.
- [ ] **Cortes incompletos:** un corte mandado sin cajero o sin resumen **no** entra a `cortes_enviados`; el margen de
  50 lo relee y lo reenvía cuando SICAR ya tenga los datos (el servidor lo reescribe, no duplica). Prueba: corte sin
  resumen a los 11 min se manda con `cobros: []`; cuando aparece el resumen se reenvía completo una sola vez.
- [ ] **Ruido del registro:** `EXISTENCIA_OMITIDA`, `EXISTENCIAS_NO_DISPONIBLES` y `CORTE_OMITIDO` se registran una
  vez por día por id (o por evento), no en cada corrida. Prueba con reloj falso.
- [ ] **Prueba faltante:** página de existencias cuyo cursor no avanza → `ID_INVALIDO` (sin cambiar código).
- [ ] **Podar `enviadas` y `mostrador_enviadas`:** quitar los ids con más de 90 días que ya no están en la `ventana`
  ni dentro del margen de 200 ventas. Prueba: los recientes se conservan; una cancelación de una venta de hace 1 día
  sigue saliendo.
- [ ] **`--verificar`:** explicar en pantalla que la cifra de público por SQL y la de nombre pueden diferir y por qué.
- [ ] **Commit** `fix(agente-sicar): cortes incompletos se reenvian, menos ruido en el registro y estado podado`

### Task 2: Servidor — cortes y mantenimiento
**Files:** `backend/sicarCortes.js`, `backend/sicarRutas.js` y pruebas.
- [ ] **Tope de rango en `GET /api/sicar/cortes`:** máximo 366 días; más → 400 con mensaje claro. Prueba.
- [ ] **Mantenimiento:** dejar pasar `HEAD` igual que `GET`; agregar la prueba de que un `PUT` de personal durante
  mantenimiento devuelve 503.
- [ ] **Commit** `fix(sicar): tope de rango en cortes y prueba del bloqueo en mantenimiento`

### Task 3: Pantalla de existencias
**Files:** `src/sicar/ExistenciasSicar.jsx`, `src/sicar/existenciasSicar.js` (+ prueba).
- [ ] "Última confirmación de existencias" como "hoy 10:42" / "ayer 18:04" / "el 21/10 18:04" (hora de Chiapas).
  Prueba pura con instantes fijos.
- [ ] **Commit** `fix(sicar): fechas de existencias en hora de Chiapas y formato hoy/ayer`

### Task 4: Higiene de pruebas (un solo despacho, sin cambiar comportamiento)
- [ ] Re-indentar la prueba 14 de `sicarContrato.test.js`; ordenar los `require` de `agente-sicar/contrato.test.js`;
  corregir el título "catorce tablas" de `sicarRepositorio.test.js`; aserción `/inv/i` → mensaje exacto en
  `sicarRespaldo.test.js`; quitar el `TABLAS_15` local duplicado; renombrar `sinExistencias` a lo que hace hoy;
  constante con nombre para el sufijo `'￿'` de `sicarExistencias.js`; quitar la variable intermedia de
  `diezmilesimas`; congelar con `Object.freeze` las generaciones 10/12/14 de `sicarRespaldo.js`.
- [ ] Suites completas en 0 fallas. **Commit** `test: limpieza de pruebas de sicar sin cambio de comportamiento`

### Task 5: Prueba intermitente del CRM
- [ ] Reproducir `centroLeadsAtribucion.test.js` ("ENLACE_RASTREADO y CAMPAÑA…") corriendo la suite completa 3 veces
  con la máquina ocupada; si la causa es el borrado de la carpeta temporal en Windows, usar
  `fs.rmSync(carpeta, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })` en los 15 `conBase`/helpers
  equivalentes. Si no se reproduce, dejar registrado el intento y no tocar nada.
- [ ] **Commit** `test: limpieza de carpetas temporales tolerante a Windows ocupado`

### Task 6: Operación (la hace Victor, con su autorización)
- [ ] Restaurar un respaldo REAL de Drive en un entorno de prueba (no producción) para confirmar que las generaciones
  viejas abren con las tablas nuevas vacías, antes de necesitarlo de verdad.
- [ ] Revisar la hora de las PCs de SICAR de cada tienda (afecta las esperas de cortes).
