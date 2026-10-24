# Cortes de caja desde SICAR (E2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El agente manda cada corte de caja de SICAR (importes, desglose por forma de pago, quién lo cerró y quién
cobró en el turno) y CORPUNISOUND lo muestra en "Cortes SICAR" con la regla de atribución del spec, más una pantalla
para ponerle nombre a cada usuario de SICAR.

**Architecture:** Colección opcional nueva `cortes` en el lote SICAR, mismo camino que `existencias` (E1, plan
`2026-10-23-sicar-existencias.md`, que va antes en esta misma rama). El agente lee por cursor `cor_id` y arma cada fila
con sumas hechas en el agente (la guarda de SQL no permite `SUM`). El servidor guarda tres tablas y calcula la
atribución al consultar.

**Tech Stack:** Node (agente `mysql2`; servidor Express + better-sqlite3), React + Vite, `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-23-sicar-existencias-cortes-design.md` (secciones 2, 4, 5, 6).

## Global Constraints

- Mismas reglas de repo que E1: sin dependencias, líneas ≤ 200 en `src/`/`backend/`, staging explícito, commits sin
  acentos, sin push/merge/rebase, `node --test`, eslint 0 errores, suites en 0 fallas.
- Solo observar; SICAR solo lectura por `validarSQL` (sin `SUM`, sin comillas: los textos como `'CorteCaja'` y
  `'Venta'` van como parámetro `?`).
- **El agente no lee la tabla `usuario`** ni manda ningún nombre: solo `usu_id`.
- Interruptor `"cortes"` en `config.json`, booleano, apagado si no es `true`.
- `diferencia = contado − calculado` (positiva = sobrante, negativa = faltante); se muestra tal cual la guardó SICAR.
- Importes del contrato: texto `^-?\d{1,16}\.\d{2}$` con |valor sin punto| ≤ `Number.MAX_SAFE_INTEGER`; otra cosa →
  422 `IMPORTE_INVALIDO`. En el servidor, centavos enteros con signo (BigInt sobre el texto, nunca `parseFloat`).
- `cortes`: hasta 100 por lote, sin `cor_id` repetido, recibo `aceptados.cortes`.
- El `usu_id` del corte es quien lo **cerró**. Una diferencia solo se atribuye a una persona si fue la **única** que
  cobró en el turno; si no, es "compartida"; nunca se le carga a quien cerró.
- Contadores del resumen: solo diferencias de **$1.00 o más** (|diferencia| ≥ 100 centavos), umbral visible.
- Resumen agrupado por (tienda, `usu_id`), nunca por nombre.
- Permisos nuevos módulo `admin`: `ver_cortes_sicar` y `asignar_cajeros_sicar`. Alcance: con
  `ver_todas_las_sucursales` todas; sin él solo la `sucursal_id` del token; nunca del encabezado ni de `?sucursal_id=`.
- Nombre asignado: 2–80 caracteres, sin controles ni U+FFFD; cada cambio en historial con actor y fecha.
- Rótulo fijo en pantalla: "Cifras según SICAR".

## Review Focus

1. Un corte cuyo renglón de `historial` aún no existe (llega hasta 22 s tarde): con menos de 10 min el cursor se
   detiene **antes** de él y no se pierde; con más, va con `usu_id: null` y `CORTE_SIN_CAJERO` → prueba en Task 3.
2. Turno con ventas de dos personas, o con ventas sin alta en `historial` (`usu_id` null): la diferencia sale
   "compartida", no se atribuye a nadie → prueba en Task 4.
3. Diferencias de centavos (−0.33, +0.50) no cuentan como faltante/sobrante; −1.00 y +1.00 sí → prueba en Task 4.
4. Un usuario sin `ver_todas_las_sucursales` que pide `?sucursal_id=` de otra tienda en cortes, o hace `PUT` del
   nombre de un `usu_id` de otra tienda → no ve nada de esa tienda / 403 → prueba en Task 4.
5. Reasignar un nombre conserva el anterior en el historial y los cortes viejos salen con el nombre nuevo, siempre con
   el número de SICAR al lado → prueba en Tasks 4 y 5.

---

### Task 1: Contrato y recepción de `cortes`

**Files:** `backend/sicarIngesta.js`, `backend/sicarRepositorio.js`, `docs/sicar-contrato-v1.md`; pruebas en
`backend/sicarIngesta.test.js`, `backend/sicarRepositorio.test.js`, `backend/sicarContrato.test.js`,
`agente-sicar/contrato.test.js` (molde: lo que E1 Task 1 hizo para `existencias`).

**Interfaces:**
- Fila: `{ cor_id, caj_id, fecha_local, usu_id, contado, calculado, diferencia, retiro, pagos, cobros }`.
  `cor_id`, `caj_id`: id texto. `usu_id`: id texto o `null`. `fecha_local`: mismo formato que `ventas`
  (`YYYY-MM-DDTHH:MM:SS`). Importes: patrón de Global Constraints. `pagos`: arreglo ≤ 8, sin `tpa_id` repetido, cada
  uno exactamente `{ tpa_id, contado, calculado, diferencia, retiro }`. `cobros`: arreglo ≤ 50, sin `usu_id`
  repetido (incluido `null` una sola vez), cada uno exactamente `{ usu_id, ventas, total, canceladas,
  total_canceladas }` con `ventas`/`canceladas` enteros JSON 0–100000 y totales con el patrón de importe.
- Tablas: `sicar_cortes (sucursal_id, cor_id TEXT, caj_id TEXT, fecha_local TEXT, usu_id TEXT NULL,
  contado_centavos, calculado_centavos, diferencia_centavos, retiro_centavos INTEGER, actualizado_en TEXT,
  PRIMARY KEY (sucursal_id, cor_id))`; `sicar_cortes_pagos (sucursal_id, cor_id, tpa_id TEXT, <4 importes>
  INTEGER, PRIMARY KEY (sucursal_id, cor_id, tpa_id))`; `sicar_cortes_cobros (sucursal_id, cor_id, usu_id TEXT
  NOT NULL DEFAULT '', ventas, total_centavos, canceladas, total_canceladas_centavos, PRIMARY KEY (sucursal_id,
  cor_id, usu_id))` (`''` = ventas sin alta en historial). Importes con `CHECK (typeof(x) = 'integer')`. FKs a
  `sicar_tiendas` y de hijos a `sicar_cortes`.
- Upsert del corte; reenviarlo **reemplaza** sus pagos y cobros (DELETE + INSERT en la misma transacción).

- [ ] **Step 1:** Pruebas rojas de validación (válida completa; `diferencia: '-0.33'` pasa; `'1.5'`, `1.50` número,
  `'+1.00'` → `IMPORTE_INVALIDO`; `tpa_id` repetido y `usu_id` repetido en cobros → `ID_DUPLICADO`; 101 cortes →
  `LIMITE_ENTIDADES`; propiedad extra en fila, pago o cobro → 400 `PROPIEDAD_NO_DECLARADA`; `ventas: -1` o `1.5` →
  422 `DATOS_INVALIDOS`; lote con solo `cortes` pasa).
- [ ] **Step 2:** Correr → FAIL. **Step 3:** Implementar validación.
- [ ] **Step 4:** Pruebas rojas de repositorio: guarda centavos con signo (`'-0.33'` → −33); reenvío con un pago y un
  cobro menos los borra; `usu_id: null` en cobro → `''`; misma `cor_id` en dos tiendas = dos cortes; recibo
  `aceptados.cortes`.
- [ ] **Step 5:** Implementar repositorio y `listarCortes()` simple para pruebas.
- [ ] **Step 6:** Párrafo del contrato + pruebas espejo. Suites completas → 0 fallas.
- [ ] **Step 7: Commit** `feat(sicar): coleccion opcional cortes con pagos y cobros por turno`

### Task 2: Respaldo con las tres tablas

**Files:** `backend/sicarRespaldo.js`, `backend/sicarRespaldo.test.js`, `backend/leadsRespaldo.test.js`.

**Interfaces:** `TABLAS` agrega al final, en este orden, `'sicar_cortes'`, `'sicar_cortes_pagos'`,
`'sicar_cortes_cobros'` (después de `sicar_existencias` de E1). `GENERACIONES` conserva todas las formas existentes
(incluidas las de E1) y agrega las dos nuevas (20 tablas y 20 + bandeja).

- [ ] **Step 1:** Pruebas rojas: un respaldo de la generación de E1 (17 tablas, con y sin bandeja) se restaura y deja
  las tres tablas vacías; uno nuevo con cortes, pagos y cobros los conserva; uno con `sicar_cortes_pagos` sin
  `sicar_cortes` se rechaza.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar. **Step 4:** suite backend → 0 fallas.
- [ ] **Step 5: Commit** `feat(sicar): cortes en el respaldo con generaciones anteriores restaurables`

### Task 3: Agente — leer y mandar cortes

**Files:** `agente-sicar/mapeo.js`, `formato.js`, `estado.js`, `corrida.js`, `configuracion.js`, `index.js`,
`config.ejemplo.json`, `LEEME.md`; pruebas en los `.test.js` correspondientes.

**Interfaces:**
- `COLUMNAS_CORTES = { cortecaja: ['cor_id', 'fecha', 'contado', 'calculado', 'diferencia', 'retiro', 'caj_id'],
  cortetipopago: ['cor_id', 'tpa_id', 'contado', 'calculado', 'diferencia', 'retiro'], resumencortecaja: ['rcc_id',
  'cor_id'], historial: ['tabla', 'movimiento', 'id', 'usu_id'], venta: ['ven_id', 'rcc_id', 'total', 'status'] }`.
- `fuente.cortesDisponibles: boolean`; `fuente.cortes(cursor, limite) → { cortes, pagos, cajeros, ventas }` en una
  sola `lector.pagina`:
  - `SELECT c.cor_id, c.fecha, c.contado, c.calculado, c.diferencia, c.retiro, c.caj_id FROM cortecaja c WHERE
    c.cor_id > ? ORDER BY c.cor_id LIMIT ?` (límite `Math.min(limite, 100)`);
  - para esos ids: `cortetipopago` por `cor_id IN (...)`; cajeros `SELECT h.id, h.usu_id FROM historial h WHERE
    h.tabla = ? AND h.movimiento = 0 AND h.id IN (...)` con `'CorteCaja'` como parámetro; ventas `SELECT r.cor_id,
    v.ven_id, v.total, v.status, h.usu_id FROM resumencortecaja r JOIN venta v ON v.rcc_id = r.rcc_id LEFT JOIN
    historial h ON h.id = v.ven_id AND h.tabla = ? AND h.movimiento = 0 WHERE r.cor_id IN (...)` con `'Venta'`.
  - (Los nombres de columna van con comillas invertidas como el resto de `mapeo.js`.)
- `verificar().cortes = { columnas, faltantes, total }`.
- `corteSeguro({ corte, pagos, cajeros, ventas }) → { corte: <fila del contrato> | null, omitido }`: importes con
  signo a 2 decimales; `pagos` solo los renglones con algún importe ≠ 0; `cobros` agrupando ventas por `usu_id`
  (`null` si la venta no tiene alta) con sumas en centavos BigInt (`status 1` → ventas/total, `-1` →
  canceladas/total_canceladas); `usu_id` del corte = el `usu_id` de su único renglón CorteCaja, `null` si hay 0 o
  más de 1.
- Estado: `cortes_cursor: string` (`'0'` inicial). Eventos: `CORTE_OMITIDO`, `CORTE_SIN_CAJERO` (con `cor_id`),
  `CORTES_NO_DISPONIBLES`. `cor_id` agregado a los detalles permitidos del registro.

- [ ] **Step 1:** Pruebas rojas de mapeo (consultas exactas que pasan `validarSQL`; sin `cortetipopago.tpa_id` queda
  apagado y no consulta nada de cortes; parámetros `'CorteCaja'` y `'Venta'`).
- [ ] **Step 2:** Pruebas rojas de formato: corte real de Ocosingo (cor 8006: contado = calculado = retiro =
  `18242.59`, diferencia `0.00`, efectivo `12486.85` y tarjeta `5755.74`, los otros 5 tpa en 0) → `pagos` con 2
  renglones; ventas de usu 52 (3 vigentes de `100.00`) y usu 7 (1 cancelada de `50.50`) → cobros `[{ '52', 3,
  '300.00', 0, '0.00' }, { '7', 0, '0.00', 1, '50.50' }]`; venta sin alta → cobro con `usu_id: null`; dos renglones
  CorteCaja → `usu_id: null`; `diferencia '-0.33'` se conserva.
- [ ] **Step 3:** Pruebas rojas de corrida (interruptor en `true`): manda en lotes de ≤ 100 y avanza `cortes_cursor`
  solo al confirmar; corte sin cajero con `fecha` de hace 3 min (reloj del agente, hora local de la tienda) → el lote
  lleva solo los cortes anteriores y el cursor queda en el anterior a él; la siguiente corrida 15 min después lo manda
  con `usu_id: null` y registra `CORTE_SIN_CAJERO cor_id=…`; fallo de envío → el cursor no se mueve; interruptor
  apagado → no consulta cortes; el paso va después de existencias en `ejecutar`.
- [ ] **Step 4:** FAIL. **Step 5:** Implementar (estado inicial y `cargar` con `cortes_cursor` validado como en
  las listas; `--verificar` imprime "Cortes en SICAR: N" o "Cortes APAGADOS, faltan columnas: …"; interruptor;
  `config.ejemplo.json` `"cortes": false`; sección en `LEEME.md` con eventos y cómo prender).
- [ ] **Step 6:** `cd agente-sicar && node --test` → 0 fallas.
- [ ] **Step 7: Commit** `feat(agente-sicar): cortes de caja con pagos y quien cobro en cada turno`

### Task 4: Consultas, atribución, nombres y permisos

**Files:** Create `backend/sicarCortes.js`; modify `backend/permisosCatalogo.js`, `backend/sicarRutas.js`,
`backend/sicarRepositorio.js` (tablas `sicar_cajeros`, `sicar_cajeros_historial` y su entrada en el respaldo: van al
final de `TABLAS` después de las de Task 2, con su generación, en esta misma tarea); test
`backend/sicarCortes.test.js` (+ respaldo).

**Interfaces:**
- Tablas: `sicar_cajeros (sucursal_id, usu_id TEXT, nombre TEXT NOT NULL, asignado_por TEXT, asignado_en TEXT,
  PRIMARY KEY (sucursal_id, usu_id))`; `sicar_cajeros_historial (id INTEGER PRIMARY KEY, sucursal_id, usu_id,
  nombre_anterior TEXT NULL, nombre_nuevo TEXT, actor TEXT, fecha TEXT)`.
- `consultarCortesSicar(sqlite, { desde, hasta, sucursal_id, caj_id, usu_id }, alcance) → { cortes: [{ sucursal_id,
  cor_id, caj_id, fecha_local, cerro: Persona, contado, calculado, diferencia, retiro (texto 2 dec), pagos,
  cobraron: [Persona & { ventas, total, canceladas, total_canceladas }], atribucion: 'propia' | 'compartida' |
  'sin_ventas', atribuida_a: Persona | null }], resumen: [{ persona: Persona, turnos_cobro, ventas, total,
  turnos_cerro, diferencia_propia, faltantes_propios, sobrantes_propios, diferencia_compartida }], umbral: '1.00' }`.
  `Persona = { sucursal_id, usu_id, nombre | null }` (`usu_id ''` → "ventas sin usuario registrado").
  Defaults: últimos 30 días por `fecha_local`. `atribucion = 'propia'` solo si hay exactamente un cobro con
  `ventas > 0` y su `usu_id ≠ ''`; `'sin_ventas'` si ninguno; si no `'compartida'`.
  `faltantes_propios`/`sobrantes_propios`: cortes `propia` con `diferencia ≤ −100` / `≥ 100` centavos.
  `diferencia_compartida`: suma de diferencias de los cortes `compartida` en que la persona cobró.
- `listarPersonalSicar(sqlite, alcance) → [{ sucursal_id, usu_id, nombre, turnos, ultimo, historial: [...] }]`
  (usu_id vistos en cortes o cobros, sin `''`).
- `asignarNombreSicar(sqlite, { sucursal_id, usu_id, nombre }, actor, alcance)`: valida nombre (2–80, recorta,
  sin controles/U+FFFD), `Number()` en `sucursal_id`, exige que el `usu_id` exista en esa tienda, 403 fuera de
  alcance, escribe historial en la misma transacción.
- Rutas: `GET /api/sicar/cortes` (`ver_cortes_sicar`), `GET /api/sicar/personal` (`ver_cortes_sicar`),
  `PUT /api/sicar/personal/:sucursal_id/:usu_id` (`asignar_cajeros_sicar`). Alcance con `resolverAlcanceAutorizado`
  existente; el filtro `sucursal_id` del query se interseca con el alcance.

- [ ] **Step 1:** Pruebas rojas (sembrando por el repositorio): cor 8006 con un solo cobro de 52 → `propia` de 52;
  corte con cobros 52 y 7 → `compartida`, ambos con `diferencia_compartida`, nadie con faltante; corte con cobro
  `''` + 52 → `compartida`; corte sin ventas → `sin_ventas`; `-0.33` propia no cuenta faltante y `-1.00` sí; cerró
  14 pero cobró solo 52 → la diferencia es de 52, no de 14; dos usu_id distintos con el mismo nombre no se suman;
  alcance (Review Focus 4); `PUT` sin `asignar_cajeros_sicar` → 403 aunque tenga `ver_cortes_sicar`; `PUT` con
  `sucursal_id` texto `'1'` funciona; nombre `'a'` o con `\u0000` → 400; reasignar deja historial con anterior y
  nuevo; respaldo con las dos tablas nuevas (generación nueva, anteriores restaurables).
- [ ] **Step 2:** FAIL. **Step 3:** Implementar. **Step 4:** suite backend → 0 fallas (guard de permisos incluido).
- [ ] **Step 5: Commit** `feat(sicar): cortes SICAR con atribucion por turno y nombres del personal`

### Task 5: Pantallas "Cortes SICAR" y "Personal de SICAR"

**Files:** Create `src/sicar/CortesSicar.jsx`, `src/sicar/PersonalSicar.jsx`, `src/sicar/cortesSicar.js` (puras);
modify `src/menuCategorias.js` (ADMINISTRACIÓN: `{ id: "cortes_sicar", nombre: "Cortes SICAR", modulo: "admin",
permiso: ["ver_cortes_sicar", "asignar_cajeros_sicar"] }`), `src/App.jsx`, `src/BarraLateral.jsx`; tests
`src/sicar/cortesSicar.test.js`, `src/menuCategorias.test.js`.

- [ ] **Step 1:** Pruebas rojas puras: `textoPersona({ usu_id: '52', nombre: null })` → "Usuario SICAR 52 — sin
  nombre"; con nombre "Fulana (SICAR 52)"; `usu_id ''` → "Ventas sin usuario registrado"; `claseDiferencia('-0.33')`
  ámbar tenue, `'-1.00'` ámbar, `'0.50'` azul tenue, `'0.00'` normal; `textoAtribucion` de los tres casos; menú visible
  con cualquiera de los dos permisos.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar según spec 4.5: filtros tienda/desde/hasta (30 días)/caja/persona;
  tabla por corte con cerró, cobraron, importes, desglose desplegable por forma de pago (1 Efectivo, 2 Cheque,
  3 Crédito, 4 Transferencia, 5 Vales, 6 Tarjeta, 7 Anticipo, 8 SICAR Pagos); resumen por persona; rótulo "Cifras
  según SICAR" y "Contadores: diferencias de $1.00 o más"; pestaña "Personal de SICAR" (solo con
  `asignar_cajeros_sicar` muestra el botón de asignar; historial visible). Clases largas en constantes.
- [ ] **Step 4:** pruebas src, eslint 0 errores, `npx vite build` OK.
- [ ] **Step 5: Prueba en navegador** con base temporal: cortes sembrados con los casos de Task 4; usuario con solo
  `ver_cortes_sicar` (no ve botón de asignar), otro con ambos (asigna nombre, ve historial, el corte viejo sale con el
  nombre nuevo y el número); tienda ajena invisible para quien no tiene `ver_todas_las_sucursales`.
- [ ] **Step 6: Commit** `feat(sicar): pantallas Cortes SICAR y Personal de SICAR`
