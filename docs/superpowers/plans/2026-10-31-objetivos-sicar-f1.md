# Objetivos desde SICAR — F1: venta de la tienda Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que Objetivos muestre y selle la venta real del mes de cada tienda tomada de SICAR, sin contar traspasos a
tiendas propias, y que Cinco Caminos deje de contarlos también.

**Architecture:** Un módulo nuevo `backend/sicarVentaReal.js` es la ÚNICA definición de "venta SICAR real de una tienda
en un rango" (con cliente vigente sin cuentas internas + mostrador vigente). Cinco Caminos y Objetivos lo usan. Objetivos
recibe la conexión SQLite (`conexionSqlite` de `server.js`) como parámetro opcional; sin ella responde "sin datos de
SICAR". Nada del agente cambia.

**Tech Stack:** Node 20+, `better-sqlite3` (ya instalado), `node --test`, React (Vite).

**Spec:** `docs/superpowers/specs/2026-10-31-objetivos-desde-sicar-design.md` (sección F1 y "Reglas que aplican a todas
las fases").

## Global Constraints

- Ninguna dependencia nueva. Pruebas con `node --test`.
- Ninguna línea de más de 200 caracteres en `.js`/`.jsx` de `src/` o `backend/`.
- Dinero en **centavos enteros** (`total_centavos`); total del ticket con IVA y ya con descuento (decisión 3).
- Fechas: `fecha_local` de SICAR tal cual. Mes `AAAA-MM` = `fecha_local >= 'AAAA-MM-01'` y `< primer día del mes
  siguiente` (comparación de texto, como `tablero.js`).
- Cuentas internas (`sicar_internas`) **nunca** cuentan como venta, en ningún número (decisión 2).
- Sin agente (`sicar_tiendas` sin la tienda) → `sin_dato: true, motivo: 'sin_agente'`. Agente sin mostrador vigente en el
  rango → `sin_dato: true, motivo: 'sin_mostrador'` (decisión 6). Sin conexión SQLite → `motivo: 'sin_integracion'`.
  Con `sin_dato`, la pantalla muestra "sin datos de SICAR", **nunca** el número ni un 0%.
- La leyenda "sin restar devoluciones" acompaña siempre a la venta SICAR en F1.
- La vendedora NO ve el monto SICAR de la tienda: solo jefatura (`esJefatura && alcanceNormal` en
  `server.js:2733-2747`). *(Decisión del diseñador del plan: el monto de tienda junto a su venta propia le dejaría
  despejar lo de sus compañeras; ver `objetivosAvance.js:119-127`.)*
- Commits sin acentos, staging por rutas explícitas, sin push ni merge.
- Línea base: `cd backend && node --test` 0 fallas; `npx eslint src backend` 0 errores.

## Review Focus

1. Venta a cuenta interna **cancelada** o **excluida**: no suma, y tampoco aparece en `internas_centavos` (solo vigentes).
2. Tienda con agente pero cuyo mostrador solo tiene canceladas en el mes → `sin_mostrador`, no un número.
3. Ventas en el último segundo del mes (`'2026-10-31T23:59:59'`) y en el primero del siguiente (`'2026-11-01T00:00:00'`):
   la primera cuenta en octubre, la segunda no.
4. Marcar o desmarcar una cuenta interna después de revisar el previo del cierre cambia la huella → el sello responde 409.
5. Petición `GET /api/objetivos/:mes/:sucursal/avance` de una vendedora: la respuesta no trae `tienda.sicar` ni ningún
   monto SICAR.

---

### Task 1: Definición única de venta SICAR real

**Files:**
- Create: `backend/sicarVentaReal.js`
- Test: `backend/sicarVentaReal.test.js`

**Interfaces:**
- Produces:
  - `NO_INTERNA(alias: string) -> string`: fragmento SQL `NOT EXISTS (SELECT 1 FROM sicar_internas i WHERE
    i.sucursal_id = <alias>.sucursal_id AND i.cli_id = <alias>.cli_id)`. `alias` solo puede ser un identificador
    `/^[a-z_][a-z0-9_]*$/i` (lanza si no).
  - `ventaSicarTienda(sqlite, { sucursal_id, desde, hasta }) -> { venta_centavos, ventas, cliente_centavos,
    mostrador_centavos, internas_centavos, sin_dato, motivo }`. `desde`/`hasta` en `'AAAA-MM-DD'`, `hasta` exclusivo.
    `sqlite` nulo → todo en 0 y `motivo: 'sin_integracion'`. `ventas` = tickets vigentes (cliente no interno + mostrador).
    `internas_centavos` = vigentes a cuentas internas (informativo, no suma). `motivo`: `null`, `'sin_agente'`,
    `'sin_mostrador'`, `'sin_integracion'`.
  - `rangoDelMes(mes: 'AAAA-MM') -> { desde, hasta }`; lanza `Error` con mes inválido.

- [ ] **Step 1: Write the failing tests** en `backend/sicarVentaReal.test.js` (copiar `prepararDB` de
  `backend/cincoCaminos/tablero.test.js:16-45`, con `crearRepositorioSicar` sobre `:memory:`, y agregar
  `interna(suc, cli)` que inserte en `sicar_internas` con `motivo 'traspaso', usuario_id 1, fecha_hora 'x'`):
  - `suma cliente no interno + mostrador vigentes y separa internas`: tienda 1, cliente `7` 10000, cliente interno `9`
    50000, mostrador 2500, cancelada cliente 999 → `venta_centavos 12500, ventas 2, cliente_centavos 10000,
    mostrador_centavos 2500, internas_centavos 50000, sin_dato false, motivo null`.
  - `interna cancelada no aparece en internas`: interna `9` cancelada 50000 → `internas_centavos 0`.
  - `bordes del mes`: `rangoDelMes('2026-10')` = `{ desde: '2026-10-01', hasta: '2026-11-01' }`; venta
    `'2026-10-31T23:59:59'` cuenta, `'2026-11-01T00:00:00'` no; `rangoDelMes('2026-12').hasta === '2027-01-01'`;
    `rangoDelMes('2026-13')` lanza.
  - `sin agente`: tienda 2 sin fila en `sicar_tiendas` → `sin_dato true, motivo 'sin_agente'`.
  - `sin mostrador`: tienda con cliente vigente y mostrador solo cancelado → `motivo 'sin_mostrador'`, números igual.
  - `sin integracion`: `ventaSicarTienda(null, …)` → `motivo 'sin_integracion'`, `venta_centavos 0`.
  - `alias invalido`: `NO_INTERNA('v; DROP')` lanza.
- [ ] **Step 2: Run** `cd backend && node --test sicarVentaReal.test.js` → FAIL (módulo no existe).
- [ ] **Step 3: Implement** `backend/sicarVentaReal.js`: una consulta `SELECT` con subconsultas como
  `tablero.js:52-58`, usando `NO_INTERNA('sicar_ventas')`; `sin_agente` gana a `sin_mostrador`.
- [ ] **Step 4: Run** el mismo comando → PASS.
- [ ] **Step 5: Commit** `git add backend/sicarVentaReal.js backend/sicarVentaReal.test.js` /
  `git commit -m "feat(sicar): definicion unica de venta real de tienda sin cuentas internas"`.

### Task 2: Cinco Caminos sin cuentas internas

**Files:**
- Modify: `backend/cincoCaminos/tablero.js:42-99` (`VIGENTES_CLIENTE`, `CON_CLIENTE`, `SQL_DETALLE`,
  `SQL_TICKETS_BASE`)
- Test: `backend/cincoCaminos/tablero.test.js`

**Interfaces:**
- Consumes: `NO_INTERNA` de Task 1.
- Produces: `numerosSemana` / `tableroTienda` con la misma forma de respuesta; solo cambian los números.

Regla: la venta a cuenta interna **desaparece por completo** de Cinco Caminos: no suma a `venta_centavos`, no cuenta en
`ventas` (ni en `MINIMO_VENTAS`, ni en ticket promedio, ni en el denominador de `pct_con_cliente`), sus renglones no
entran a `SQL_DETALLE` y no cuenta en las semanas base del Radar (`SQL_TICKETS_BASE` sobre `sicar_ventas`).
`CON_CLIENTE` queda en `cli_id IS NOT NULL`. Actualizar el comentario de `tablero.js:47-48` y el de cabecera.

- [ ] **Step 1: Write the failing test** `cuenta interna no es venta en ningun numero`: semana con 30 ventas de mostrador
  de 10000, 1 venta a cliente normal de 20000 con 1 renglón, 1 venta a cuenta interna de 5000000 con 3 renglones →
  `venta_centavos 320000`, `ventas 31`, `ticket_promedio_centavos Math.round(320000/31)`, `pct_con_cliente
  Math.round(1*1000/31)/10`, `articulos_por_ticket` sin los 3 renglones de la interna.
- [ ] **Step 2: Run** `cd backend && node --test cincoCaminos/tablero.test.js` → la nueva FAIL; anotar qué pruebas
  existentes dependían de sumar internas.
- [ ] **Step 3: Implement** con `NO_INTERNA('sicar_ventas')` / `NO_INTERNA('v')` en cada consulta sobre `sicar_ventas`.
  Ajustar las pruebas existentes que esperaban internas sumadas, con un comentario que cite la decisión 2 del spec.
- [ ] **Step 4: Run** `cd backend && node --test cincoCaminos/ metasFuentes.test.js` → PASS.
- [ ] **Step 5: Commit** `git add backend/cincoCaminos/tablero.js backend/cincoCaminos/tablero.test.js` (+ las pruebas
  ajustadas) / `git commit -m "fix(cinco-caminos): las cuentas internas no cuentan como venta"`.

### Task 3: Venta SICAR del mes en el avance de tienda (solo jefatura)

**Files:**
- Modify: `backend/objetivosAvance.js` (nueva exportación)
- Modify: `backend/server.js:2733-2747` (ruta de avance)
- Test: `backend/objetivosAvance.test.js`, `backend/objetivosAvanceRutas.test.js`

**Interfaces:**
- Consumes: `ventaSicarTienda`, `rangoDelMes` de Task 1.
- Produces: `ventaSicarDelMes(sqlite, { mes, sucursal_id }) -> { ...ventaSicarTienda, leyenda: 'sin restar
  devoluciones' }`. En la ruta: `respuesta.tienda.sicar = ventaSicarDelMes(conexionSqlite, datos)` **solo** dentro de
  `if (esJefatura && alcanceNormal)`.

- [ ] **Step 1: Write the failing tests**:
  - `objetivosAvance.test.js`: `ventaSicarDelMes trae la leyenda y el rango del mes` (una venta de octubre y una de
    noviembre; solo cuenta la de octubre; `leyenda === 'sin restar devoluciones'`).
  - `objetivosAvanceRutas.test.js` (sembrar `sicar_tiendas` y ventas con `obtenerConexionSqlite()` como en
    `cincoCaminos/rutas.test.js:14-22`): `jefatura ve tienda.sicar con venta_centavos` y
    `vendedora no recibe tienda.sicar ni montos SICAR` (`JSON.stringify(respuesta)` no contiene `venta_centavos` ni
    `sicar`).
- [ ] **Step 2: Run** `cd backend && node --test objetivosAvance.test.js objetivosAvanceRutas.test.js` → FAIL.
- [ ] **Step 3: Implement** `ventaSicarDelMes` y la línea en la ruta. Si `ventaSicarTienda` lanza (disco roto), la ruta
  responde el avance con `tienda.sicar = { sin_dato: true, motivo: 'error_sicar' }`, registra con `capturarError`, y no
  tumba el avance manual.
- [ ] **Step 4: Run** el mismo comando → PASS.
- [ ] **Step 5: Commit** `git add backend/objetivosAvance.js backend/server.js backend/objetivosAvance.test.js
  backend/objetivosAvanceRutas.test.js` / `git commit -m "feat(objetivos): venta SICAR del mes en el avance de tienda"`.

### Task 4: Línea de tienda SICAR en el cierre

**Files:**
- Modify: `backend/objetivosCierre.js` (`previoCierre`, `cerrarMes`)
- Modify: `backend/server.js:3104-3131` (pasar `conexionSqlite`) y `cierreParaRespuesta` (`server.js:2663`)
- Test: `backend/objetivosCierre.test.js`, `backend/objetivosRutas.test.js`

**Interfaces:**
- Consumes: `ventaSicarDelMes` de Task 3.
- Produces:
  - `previoCierre(DB, { mes, sucursal_id }, { sqlite } = {}) -> { lineas, huella, tienda_sicar }`. `tienda_sicar` =
    `ventaSicarDelMes(sqlite, …)` y **entra en el contenido de la huella**.
  - `cerrarMes(DB, datos, usuario, hoy, { sqlite } = {})`: el cierre guardado lleva `tienda_sicar` (copia del previo,
    calculada por el servidor; el cuerpo de la petición no la puede mandar ni cambiar).
  - `cierreParaRespuesta(cierre, sqlite)`: si el cierre tiene `tienda_sicar`, agrega `tienda_sicar_actual` (recalculado
    hoy) y `tienda_sicar_diferencia_centavos = actual.venta_centavos - sellado.venta_centavos` (0 si alguno es
    `sin_dato`). Cierres viejos sin `tienda_sicar` salen igual que hoy.
  - El cuarto parámetro de `cerrarMes` (`hoy`) se conserva en su lugar; las llamadas existentes no cambian.

- [ ] **Step 1: Write the failing tests** en `objetivosCierre.test.js`:
  - `el previo trae la venta SICAR de la tienda y la sella` (sqlite en memoria con venta de 10000 → previo
    `tienda_sicar.venta_centavos 10000`; `cerrarMes` guarda lo mismo).
  - `marcar una cuenta interna despues del previo cambia la huella y el sello da 409`.
  - `el cuerpo no puede mandar tienda_sicar` (`cerrarMes` con `datos.tienda_sicar = { venta_centavos: 1 }` sella el
    calculado, no el mandado).
  - `sin sqlite el previo dice sin_integracion y el cierre funciona como hoy`.
  - `cierre sellado muestra la diferencia si SICAR cambio despues` (cancelar la venta tras sellar →
    `tienda_sicar_diferencia_centavos === -10000`; `cierre.tienda_sicar` no cambia).
- [ ] **Step 2: Run** `cd backend && node --test objetivosCierre.test.js` → FAIL.
- [ ] **Step 3: Implement**; pasar `{ sqlite: conexionSqlite }` en las rutas `previo-cierre`, `cierre` (POST) y en las
  respuestas de cierre de `server.js`.
- [ ] **Step 4: Run** `cd backend && node --test objetivosCierre.test.js objetivosRutas.test.js` → PASS; luego la suite
  completa `cd backend && node --test` → 0 fallas.
- [ ] **Step 5: Commit** `git add backend/objetivosCierre.js backend/server.js backend/objetivosCierre.test.js` (+ prueba
  de rutas) / `git commit -m "feat(objetivos): venta SICAR de la tienda en el previo y el sello del cierre"`.

### Task 5: Pantallas

**Files:**
- Modify: `src/objetivos/avance.js` (función pura) y su prueba `src/objetivos/avance.test.js`
- Modify: `src/objetivos/AvanceTienda.jsx`, `src/CierreObjetivos.jsx`

**Interfaces:**
- Consumes: `tienda.sicar` (Task 3), `tienda_sicar`, `tienda_sicar_actual`, `tienda_sicar_diferencia_centavos` (Task 4).
- Produces: `textoVentaSicar(sicar) -> { titulo, monto, detalle }` en `src/objetivos/avance.js`.

Textos exactos:
- Con dato: `titulo 'Venta según SICAR'`, `monto` en pesos con formato de la app, `detalle 'Sin traspasos a tiendas
  propias · sin restar devoluciones'`; si `internas_centavos > 0`, agregar `' · traspasos excluidos: $X'`.
- `sin_agente`: `'Sin datos de SICAR: esta tienda no tiene agente.'`; `sin_mostrador`: `'Sin datos de SICAR: falta
  prender las ventas de público en general.'`; `sin_integracion` / `error_sicar`: `'Sin datos de SICAR por ahora.'`.
  En los cuatro, `monto: null`.
- Cierre: renglón "Venta de la tienda según SICAR" en el previo; en un cierre sellado con diferencia ≠ 0:
  `'SICAR cambió después del cierre: ahora $X (diferencia $Y). Rectifica con motivo si corresponde.'`.

- [ ] **Step 1: Write the failing test** `textoVentaSicar` en `src/objetivos/avance.test.js`: los 5 casos de arriba
  (con dato con y sin internas, y los 3 `sin_dato`), comprobando que con `sin_dato` `monto === null`.
- [ ] **Step 2: Run** `node --test src/objetivos/avance.test.js` → FAIL.
- [ ] **Step 3: Implement** `textoVentaSicar` y las tarjetas. Nada de `className` de más de 200 caracteres: extraer a
  constante.
- [ ] **Step 4: Run** la prueba → PASS; `npx eslint src backend` → 0 errores; `npm run build` → OK.
- [ ] **Step 5: Prueba en navegador** (backend `cd backend && node server.js`, frontend `npx vite --port 5173`; datos
  sembrados en la SQLite local de prueba: tienda 1 con mostrador, una cuenta interna con venta): como gerente ver el
  avance de tienda con "Venta según SICAR" y la línea de traspasos excluidos; tienda sin agente con su leyenda; previo
  del cierre con el renglón; como vendedora confirmar que no aparece. Capturas en el reporte.
- [ ] **Step 6: Commit** `git add src/objetivos/avance.js src/objetivos/avance.test.js src/objetivos/AvanceTienda.jsx
  src/CierreObjetivos.jsx` / `git commit -m "feat(objetivos): pantalla de venta SICAR de la tienda y del cierre"`.
