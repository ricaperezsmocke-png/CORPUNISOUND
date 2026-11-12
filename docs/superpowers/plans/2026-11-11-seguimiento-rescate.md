# Rescate de la ventana de incorporación — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la mercancía de facturas de CEDIS enviada a una tienda entre el inicio del sistema (foto de CEDIS) y la foto de esa tienda se siga como de esa factura, sin contar nada dos veces.

**Architecture:** `lector.js` acepta `{ rescate: true }`: para cada tienda elegible usa el inicio del sistema como corte efectivo, una foto reconstruida como "anterior" y agrega un movimiento `control` al corte real. `motor.js` aplica los `control` y reporta si alguno no cuadra. `servicio.recalcularClave` calcula con rescate y, si no es posible o falla cualquier comprobación, recalcula esa clave sin rescate (todo o nada por clave). La pantalla marca las tiendas reconstruidas.

**Tech Stack:** Node, better-sqlite3, BigInt, `node --test`, React (pantalla).

**Spec:** `docs/superpowers/specs/2026-11-11-seguimiento-rescate-ventana-design.md` (leer completo, incluida la sección "Decisiones del diseñador"; Victor aprobó aplicarlo a TODAS las tiendas).

## Global Constraints

- Rama `feature/seguimiento-rescate`, worktree `C:\Users\Victor\Desktop\CORPUNISOUND\.claude\worktrees\seguimiento-rescate`, base `4169f37` (o el commit del plan).
- Sin dependencias nuevas, sin cambios de esquema, sin tocar `agente-sicar/`. Líneas ≤ 200 caracteres. Suite 0 fallas, eslint 0 errores. Commits sin acentos, staging por rutas explícitas.
- Inicio del sistema = `seguimiento_tiendas.corte` de la sucursal 6 (CEDIS). Sin CEDIS incorporado: sin rescate.
- Tienda elegible = incorporada, distinta de CEDIS, con corte posterior al inicio, y con al menos una venta de mostrador guardada (`sicar_ventas_mostrador`) con `fecha_local` posterior a su corte local.
- Todo o nada por clave: si la clave no se puede rescatar en una tienda elegible, se calcula exactamente como hoy (sin rescate) en todas.
- Las claves sin rescate y todo lo que no toca una ventana deben dar resultados idénticos a hoy: las pruebas existentes de `backend/seguimientoFactura/` no se modifican.
- Bump `VERSION` de `servicio.js` a 2 (los resultados guardados cambian de forma).

## Review Focus

- Clave con traspaso de CEDIS a T recibido el día del inicio (foto CEDIS de madrugada): debe rescatarse (no es dudoso).
- Venta de T en la ventana de una clave sin ninguna factura en la ventana: la foto reconstruida absorbe la venta; resultado de facturas igual a hoy y control cuadra.
- Traspaso entre dos tiendas elegibles dentro de sus ventanas (Ocosingo → Yajalón): las dos puntas se usan; la factura se mueve entre tiendas.
- Devolución de T a CEDIS dentro de la ventana: devuelve piezas de factura (no "anterior") y no se duplica.
- Venta a cuenta interna de T en la ventana: entra a la reconstrucción y en el motor sigue como por aclarar.

---

### Task 1: Lector con rescate

**Files:**
- Modify: `backend/seguimientoFactura/lector.js`
- Test: `backend/seguimientoFactura/lector.test.js`

**Interfaces:**
- Produces: `movimientosPorClave(sqlite, clave, { ahora, rescate = false })` → igual que hoy más `rescate`:
  - `rescate: null` cuando no se pidió, no hay tiendas elegibles con movimientos en ventana para la clave, o no es posible (y entonces `movimientos` son los de hoy, idénticos);
  - `rescate: { desde: <corte local de CEDIS>, tiendas: [sucursal_id...] }` cuando sí; en ese caso `movimientos` usan corte efectivo = inicio para esas tiendas, la foto de cada una es la reconstruida (tipo `foto`, `fecha` = inicio local, `reconstruida: true`) y hay un movimiento `{ tipo: 'control', fecha: <corte local real de T>, sucursal_id, piezas: <foto real BigInt> }` por tienda rescatada.
  - `rescate: { imposible: '<motivo>' }` con movimientos de hoy cuando se pidió y la clave no se puede rescatar; motivos: `foto_negativa`, `movimiento_por_aclarar_en_ventana`, `fecha_dudosa_en_ventana`.

- [ ] **Step 1: Pruebas que fallan** (helper de siembra del propio archivo; CEDIS corte `2026-11-06T06:05:00Z` = 00:05 local; T=1 con corte `2026-11-06T16:53:00Z` = 10:53; Y=2 con corte `2026-11-11T18:40:00Z` = 12:40):
  - `sin rescate pedido los movimientos son identicos a hoy` (deepEqual contra la llamada sin opción).
  - `rescate reconstruye la foto`: compra CEDIS 11-06 12:00 de 10 pzas (clave X); traspaso CEDIS→Y fecha 11-06 recibido 11-06 13:00 de 10; Y vende 3 el 11-08; foto real de Y en X = 7 + 2 (anterior) = 9. Esperado: `rescate.tiendas` incluye 2; foto de Y reconstruida = 9 − 10 + 3 = 2; movimiento `control` de Y con 9 a `2026-11-11T12:40…`; la recepción y la venta de Y se incluyen (no descartadas por el corte real).
  - `foto reconstruida negativa no rescata`: igual pero foto real 5 → 5 − 10 + 3 < 0 → `rescate.imposible === 'foto_negativa'` y movimientos idénticos a sin rescate.
  - `movimiento por aclarar en la ventana no rescata` (recepción con `recepcion_mayor` en la ventana de Y).
  - `traspaso con fecha sin hora el dia del corte de la tienda no rescata` (salida CEDIS→Y con fecha 11-11, foto de Y 12:40) → `fecha_dudosa_en_ventana`.
  - `tienda sin mostrador despues de su corte no es elegible` (sin ventas de mostrador posteriores al corte → `rescate: null` para esa tienda).
  - `envio de CEDIS antes del inicio recibido en la ventana entra como anterior` (sale 11-05, recibido 11-06 en T): sin factura, sin `foto_negativa`.
  - `venta a cuenta interna en la ventana entra a la reconstruccion`.

- [ ] **Step 2: Correr y ver que fallan** — `cd backend && node --test seguimientoFactura/lector.test.js` → FAIL.

- [ ] **Step 3: Implementar.** En `contexto`, con `rescate`, calcular el inicio y las tiendas elegibles; dar a cada tienda un `efectivo` (corte local efectivo) y usarlo en TODAS las comparaciones contra el corte (ventas `:107`, observaciones `:171`, `alcancePuntas` `:186-193`, `problemaFechas` `:203-216`, `diaDudoso`), conservando `local` real para el `control`. Reconstrucción por tienda rescatada: `foto_real − recepciones_en_ventana + salidas_en_ventana + ventas_en_ventana` (incluye internas; las recepciones de envíos anteriores al inicio cuentan como recepciones). Ventana = (inicio, corte real]; para movimientos con hora (recepción `fecha_aplicado`, ventas) comparar con la hora; un traspaso con solo fecha igual al día del corte real de la tienda → `fecha_dudosa_en_ventana`. Si cualquier tienda falla, devolver los movimientos de hoy con `rescate.imposible`. El `control` ordena después de todo lo de su instante (prioridad mayor que `venta`).

- [ ] **Step 4: Correr** — archivo PASS; `cd backend && node --test seguimientoFactura/` PASS sin modificar pruebas existentes.

- [ ] **Step 5: Commit** — `git add backend/seguimientoFactura/lector.js backend/seguimientoFactura/lector.test.js` / `git commit -m "feat(seguimiento): lector con rescate de la ventana de incorporacion"`

### Task 2: Motor con controles y comprobaciones

**Files:**
- Modify: `backend/seguimientoFactura/motor.js`
- Test: `backend/seguimientoFactura/motor.test.js`

**Interfaces:**
- Consumes: movimientos de Task 1 (`tipo: 'control'`, `foto` con `reconstruida`).
- Produces: `calcular(movimientos)` devuelve además `rescate_ok: boolean` (true si no hay controles) y `rescate_fallas: [{ sucursal_id, motivo }]` con motivos `control_no_cuadra` (existencia total de la tienda al `control` ≠ piezas), `factura_excede_recibido` (piezas de un lote en la tienda > piezas de ese lote recibidas por la tienda hasta el control), `suma_no_cuadra` (por lote: queda en todas + tránsito + vendido + gris + por_aclarar ≠ comprado). `control` no mueve piezas.

- [ ] **Step 1: Pruebas que fallan**: control que cuadra → `rescate_ok` true; control con 1 pieza de diferencia → false con `control_no_cuadra`; lote con más piezas en la tienda que recibidas → `factura_excede_recibido`; sin controles → `rescate_ok` true y resultados idénticos a hoy.
- [ ] **Step 2: Correr y ver que fallan** — `cd backend && node --test seguimientoFactura/motor.test.js`.
- [ ] **Step 3: Implementar** `control` en `ACCIONES` (comparar `existencia(estado, s)` sumada contra `m.piezas`), llevar por lote lo recibido por sucursal, y la suma por lote al final.
- [ ] **Step 4: Correr** — PASS, carpeta completa PASS.
- [ ] **Step 5: Commit** — `git add backend/seguimientoFactura/motor.js backend/seguimientoFactura/motor.test.js` / `git commit -m "feat(seguimiento): controles del rescate en el motor"`

### Task 3: Servicio todo-o-nada, versión y pantalla

**Files:**
- Modify: `backend/seguimientoFactura/servicio.js`, `backend/seguimientoFactura/consultas.js`, `src/seguimiento/seguimiento.js`, `src/seguimiento/SeguimientoFacturas.jsx`
- Test: `backend/seguimientoFactura/servicio.test.js`, `backend/seguimientoFactura/integracion.test.js`, `src/seguimiento/seguimiento.test.js`

**Interfaces:**
- Consumes: Task 1 y Task 2.
- Produces: en `recalcularClave`: llamar `movimientosPorClave(..., { rescate: true })`; si `rescate` es null o `imposible`, o `calcular` da `rescate_ok === false`, recalcular con `{ rescate: false }` y agregar a `calidad.problemas` `{ clave, motivo: 'rescate_inconsistente', detalle }` cuando hubo intento fallido. `datos.rescate = { desde, tiendas }` solo si se aplicó. `VERSION = 2`. Consultas: el detalle de factura expone `rescate` por renglón; el listado no cambia de forma.
- Pantalla: en el detalle, si algún renglón trae `rescate`, nota: "Reconstruido desde el {fecha local de desde} con las ventas de SICAR en: {nombres de tiendas}".

- [ ] **Step 1: Pruebas que fallan**:
  - servicio: clave rescatable guarda `rescate`; clave con control que no cuadra guarda el resultado SIN rescate idéntico a hoy y el problema `rescate_inconsistente`.
  - integración: escenario C 32194 (compra CEDIS 11-06 16:16 de 48 pzas clave 52BPAQ, traspaso CEDIS→Yajalón 11-06 recibido 11-06, ventas en Yajalón en la ventana, foto real de Yajalón 11-11) → la factura muestra piezas en Yajalón (queda/vendido) en vez de gris, y la suma por lote cuadra; tiempo de recálculo de la prueba de 30k ventas existente ≤ 2× el de hoy (medir antes y después, reportar números).
  - pantalla: texto de la nota con fecha y nombres.
- [ ] **Step 2: Correr y ver que fallan.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Correr** — carpeta `seguimientoFactura/` y `src/seguimiento` PASS; suite completa `cd backend && node --test` 0 fallas; `npx eslint src backend` 0 errores; `npm run build` compila.
- [ ] **Step 5: Commit** — rutas explícitas de los archivos tocados / `git commit -m "feat(seguimiento): rescate todo o nada por clave y nota en pantalla"`

## Al terminar (no lo hace el implementador)

Revisión independiente (Claude si implementó Codex; Codex si implementó Claude), comparación contra producción del caso C 32194 (solo lectura), merge y push por Victor. El efecto se ve tras la siguiente vuelta diaria (o un recálculo manual).
