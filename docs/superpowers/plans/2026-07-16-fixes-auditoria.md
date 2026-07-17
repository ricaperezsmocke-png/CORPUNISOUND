# Fixes de la Auditoría de Botones — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 4 bugs found by the whole-app functional audit (2026-07-16): quotation-save always fails, F4-edit can silently zero a product's sale price, the "Propina" button in Corte de Caja does nothing, and the Productos list doesn't refresh after a Migración de Datos import.

**Architecture:** Four independent, surgical fixes in existing files. No new files, no new dependencies, no schema changes. Each fix targets the exact root cause already confirmed by direct code reading (see task descriptions) — no further debugging/design work needed.

**Tech Stack:** React 18 (frontend), Node.js/Express + in-memory `DB` (backend), Node's built-in `node:test` + `assert` (existing test convention in this repo — see `backend/*.test.js`).

## Global Constraints

- Every touched route/component already exists — do not introduce new permissions, new API routes, or new DB collections.
- Follow the existing code style in each file exactly (no semicolon changes, no reformatting unrelated lines).
- Each task must be independently testable and independently committable — these 4 bugs are unrelated to each other.
- Backend logic changes must have a `node:test` covering the specific bug (reproduce-then-fix). Frontend-only changes (Tasks 1, 3) do not have an existing frontend test harness in this repo — verify those manually via Playwright + real Chrome against an isolated `DB_PATH`, per this project's established convention, and describe the manual verification steps taken in the commit/report instead of writing a new test file.
- Never touch `backend/datos.sqlite` (the real production DB) — all manual verification must use an isolated/temporary `DB_PATH`.

---

### Task 1: Fix — Guardar cotización siempre falla ("El efectivo recibido es menor al total")

**Files:**
- Modify: `src/PuntoDeVenta.jsx:374-376`

**Interfaces:**
- Consumes: existing local vars `esCotizacion`, `mostrarCampoEfectivo`, `efectivoRecibido`, `totalConCondicion`, `mostrarAviso` — no signature changes.
- Produces: nothing consumed by other tasks.

**Root cause (confirmed by reading the code):** `confirmarCobro` (line 369) checks `mostrarCampoEfectivo && Number(efectivoRecibido) < totalConCondicion` unconditionally, even when `esCotizacion` is `true`. But the quotation-save modal never renders a cash-received field, so `efectivoRecibido` stays `""` (`Number("") === 0`), and the check almost always fails, blocking every quotation save.

- [ ] **Step 1: Apply the fix**

In `src/PuntoDeVenta.jsx`, find this exact block (currently lines 374-376):

```js
    if (mostrarCampoEfectivo && Number(efectivoRecibido) < totalConCondicion) {
      return mostrarAviso("El efectivo recibido es menor al total");
    }
```

Replace it with:

```js
    if (!esCotizacion && mostrarCampoEfectivo && Number(efectivoRecibido) < totalConCondicion) {
      return mostrarAviso("El efectivo recibido es menor al total");
    }
```

- [ ] **Step 2: Manual verification (no automated frontend test harness in this repo)**

Run the app against an isolated temp `DB_PATH` (never the real `backend/datos.sqlite`):

```bash
cd backend && DB_PATH=<temp-file> PORT=<free-port> node server.js
# separate terminal, from repo root:
VITE_API_URL=http://localhost:<free-port>/api npm run dev -- --port <free-port-2>
```

Using Playwright + real Chrome (`channel: 'chrome'`) or manually in a browser:
1. Log in, go to Punto de Venta, add a product to the cart.
2. Activate modo cotización (Alt+T or "Cotiz." button) — the red "COTIZACIÓN" label appears.
3. Press F10/F12 (or "Importe"/"Check") to open the quotation modal.
4. Click "Guardar cotización".
5. **Expected after fix:** aviso "Cotización guardada — Folio N", the ticket clears. **Before the fix**, this showed "El efectivo recibido es menor al total" and did nothing.
6. Also re-confirm a REAL sale (not cotización) still requires correct cash: activate a normal (non-quotation) sale, enter cash less than the total, confirm the "efectivo recibido es menor al total" aviso still appears correctly (this check must remain active for real sales — only quotations are exempt).

Stop both servers and delete the temp DB file when done.

- [ ] **Step 3: Commit**

```bash
git add src/PuntoDeVenta.jsx
git commit -m "fix: allow saving cotizaciones without a cash-received check"
```

---

### Task 2: Fix — Editar artículo (F4) puede borrar el precio de venta a $0.00

**Files:**
- Modify: `src/InventarioProductos.jsx:123-139` (function `abrirEditar`)
- Test: `backend/productos.test.js` (new file — this repo has no existing test file for `backend/productos.js`; create one following the `node:test` + `assert` convention used throughout `backend/*.test.js`, e.g. `backend/costoRecalculo.test.js`)

**Interfaces:**
- Consumes: `seleccionado` (a product object from `productos` state, same shape as returned by `GET /api/productos` — see `backend/productos.js` `listarProductos`), `FORM_VACIO.precios` (existing constant, `src/InventarioProductos.jsx:47`).
- Produces: nothing consumed by other tasks.

**Root cause (confirmed by reading the code, both frontend and backend):**
1. `src/InventarioProductos.jsx:132`: `abrirEditar` sets `precios: seleccionado.precios?.length === 4 ? seleccionado.precios : FORM_VACIO.precios`. Any product without a `precios` array of exactly length 4 — which includes every product in this app's dev/seed data (`backend/server.js:171-174`, only `costo`/`precio_venta`, no `precios` field) and very plausibly real legacy/migrated products in production — falls back to `FORM_VACIO.precios`, i.e. 4 blank tiers (`utilidad: ""`, `precioVenta: 0`).
2. `backend/productos.js:130`: `actualizarProducto` always recomputes `precio_venta` from `precios[0]?.precioVenta || 0` and `backend/productos.js:124` always accepts whatever `precios` array the frontend sent (`Array.isArray(datos.precios) ? datos.precios : actual.precios` — the frontend always sends an array, so this never falls back to `actual.precios` in practice).
3. Net effect: editing a legacy product without retyping "% Utilidad" saves `precio_venta = 0`, silently, with no warning, even though only the description/image/etc. was meant to change.

**The fix:** when opening the edit form and the product has no valid `precios` array, derive tier 1 (`precios[0]`) from the product's **existing** `costo`/`precio_venta` instead of blanking it, so the current price is preserved unless the user deliberately changes it. Tiers 2-4 have no equivalent existing data for legacy products, so they stay blank/0 (matches current behavior — those tiers were never populated for these products either).

- [ ] **Step 1: Write the failing test (backend)**

Create `backend/productos.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { actualizarProducto } = require("./productos");

test("actualizarProducto: conserva el precio_venta si el frontend manda un precios[0] derivado del precio/costo existentes", () => {
  const DB = construirDBPrueba();
  // Simula un producto legacy SIN array `precios` (como los del seed de server.js)
  DB["catalogo-productos"].productos.push({
    id: 99, sku: "LEGACY-01", nombre: "Producto legacy", categoria_id: null,
    departamento_id: null, proveedor_id: null, unidad_compra: "PZA", unidad_venta: "PZA",
    factor: 1, iva: true, costo: 18, neto: true, unidad_medida: "pza",
    unidades_por_mayoreo: 0, ubicacion: "-", clave_sat: "", localizacion: "",
    promocion: false, imagen_url: "", activo: true, precio_venta: 25,
  });

  // Simula exactamente lo que el frontend corregido debe mandar: precios[0] derivado
  // del costo/precio_venta existentes (utilidad = (25-18)/18*100 ≈ 38.89), no en blanco.
  const datos = {
    descripcion: "Producto legacy (renombrado)",
    precio_compra: 18,
    precios: [
      { utilidad: 38.89, precioVenta: 25 },
      { utilidad: 0, precioVenta: 0 },
      { utilidad: 0, precioVenta: 0 },
      { utilidad: 0, precioVenta: 0 },
    ],
  };

  const actualizado = actualizarProducto(DB, 99, datos, 1);

  assert.strictEqual(actualizado.precio_venta, 25, "el precio de venta debe conservarse, no irse a 0");
  assert.strictEqual(actualizado.nombre, "Producto legacy (renombrado)", "el cambio solicitado sí debe aplicarse");
});

test("actualizarProducto: sigue permitiendo bajar el precio a 0 si el usuario lo hace a propósito", () => {
  const DB = construirDBPrueba();
  DB["catalogo-productos"].productos.push({
    id: 100, sku: "LEGACY-02", nombre: "Producto legacy 2", categoria_id: null,
    departamento_id: null, proveedor_id: null, unidad_compra: "PZA", unidad_venta: "PZA",
    factor: 1, iva: true, costo: 18, neto: true, unidad_medida: "pza",
    unidades_por_mayoreo: 0, ubicacion: "-", clave_sat: "", localizacion: "",
    promocion: false, imagen_url: "", activo: true, precio_venta: 25,
  });

  const datos = {
    descripcion: "Producto legacy 2",
    precio_compra: 18,
    precios: [
      { utilidad: 0, precioVenta: 0 },
      { utilidad: 0, precioVenta: 0 },
      { utilidad: 0, precioVenta: 0 },
      { utilidad: 0, precioVenta: 0 },
    ],
  };

  const actualizado = actualizarProducto(DB, 100, datos, 1);
  assert.strictEqual(actualizado.precio_venta, 0, "si el usuario manda 0 explícitamente, debe respetarse (no es el bug de este fix)");
});
```

Run: `cd backend && node --test productos.test.js`
Expected: both tests **PASS** already (this test file only calls the existing, unmodified backend function — it documents the CONTRACT the frontend fix in Step 3 must uphold; the backend itself is not buggy, the frontend was sending the wrong `precios` payload). This is a characterization test, not a reproduction of a backend bug — the actual bug is in the frontend's `abrirEditar`.

- [ ] **Step 2: Run it to confirm it passes as-is**

Run: `cd backend && node --test productos.test.js`
Expected: `# pass 2`, `# fail 0`.

- [ ] **Step 3: Fix the frontend root cause**

In `src/InventarioProductos.jsx`, find `abrirEditar` (currently lines 123-139):

```js
  const abrirEditar = () => {
    if (!seleccionado) return mostrarAviso("Selecciona un producto primero");
    setForm({
      clave: seleccionado.sku, clave_alterna: seleccionado.clave_alterna || "",
      servicio: seleccionado.servicio, descripcion: seleccionado.nombre,
      categoria_id: seleccionado.categoria_id || "", departamento_id: seleccionado.departamento_id || "",
      proveedor_id: seleccionado.proveedor_id || "",
      unidad_compra: seleccionado.unidad_compra, unidad_venta: seleccionado.unidad_venta, factor: seleccionado.factor,
      iva: seleccionado.iva, precio_compra: seleccionado.costo, neto: seleccionado.neto,
      precios: seleccionado.precios?.length === 4 ? seleccionado.precios : FORM_VACIO.precios,
      unidades_por_mayoreo: seleccionado.unidades_por_mayoreo || 0,
      existencia_inicial: seleccionado.existencia, existencia_minima: seleccionado.existencia_minima, existencia_maxima: seleccionado.existencia_maxima,
      imagen_url: seleccionado.imagen_url || "",
    });
    setModoForm("editar");
    setModal("form");
  };
```

Replace the `precios:` line with a call to a new helper that derives tier 1 from the product's existing costo/precio_venta when `precios` is missing/invalid. Add the helper function directly above `abrirEditar` (still inside the component, same scope as `FORM_VACIO` usage):

```js
  const precioTiersParaEditar = (p) => {
    if (p.precios?.length === 4) return p.precios;
    const costo = Number(p.costo) || 0;
    const precioVenta = Number(p.precio_venta) || 0;
    const utilidad = costo > 0 ? Math.round(((precioVenta - costo) / costo) * 10000) / 100 : 0;
    return [
      { utilidad, precioVenta },
      { utilidad: 0, precioVenta: 0 },
      { utilidad: 0, precioVenta: 0 },
      { utilidad: 0, precioVenta: 0 },
    ];
  };

  const abrirEditar = () => {
    if (!seleccionado) return mostrarAviso("Selecciona un producto primero");
    setForm({
      clave: seleccionado.sku, clave_alterna: seleccionado.clave_alterna || "",
      servicio: seleccionado.servicio, descripcion: seleccionado.nombre,
      categoria_id: seleccionado.categoria_id || "", departamento_id: seleccionado.departamento_id || "",
      proveedor_id: seleccionado.proveedor_id || "",
      unidad_compra: seleccionado.unidad_compra, unidad_venta: seleccionado.unidad_venta, factor: seleccionado.factor,
      iva: seleccionado.iva, precio_compra: seleccionado.costo, neto: seleccionado.neto,
      precios: precioTiersParaEditar(seleccionado),
      unidades_por_mayoreo: seleccionado.unidades_por_mayoreo || 0,
      existencia_inicial: seleccionado.existencia, existencia_minima: seleccionado.existencia_minima, existencia_maxima: seleccionado.existencia_maxima,
      imagen_url: seleccionado.imagen_url || "",
    });
    setModoForm("editar");
    setModal("form");
  };
```

- [ ] **Step 4: Manual verification (no automated frontend test harness in this repo)**

Run against an isolated temp `DB_PATH` (never the real `backend/datos.sqlite`), same setup pattern as Task 1 Step 2, on different ports.

Using Playwright + real Chrome or manually:
1. Log in, go to Inventario y Productos → Productos.
2. Select the seeded product "Arroz 1kg" (clave `AB-001`, costo $18, precio $25 — has no `precios` array in the seed data, reproducing the exact bug scenario).
3. Press F4 to open "Editar artículo". **Before the fix**, the "% Utilidad" fields showed empty and "Precio venta" showed $0.00 for all 4 tiers. **After the fix**, tier 1 should show "% Utilidad" ≈ 38.89 and "Precio venta" $25.00 (auto-derived from the existing costo/precio_venta).
4. Change only the Descripción (don't touch any price field) and save.
5. **Expected after fix:** the product list still shows Precio $25.00 for this product. **Before the fix**, this went to $0.00.
6. Also verify editing a product that already has a full `precios` array (e.g. one created via F3 during this same test session) still works exactly as before — its existing tiers should show correctly, unaffected by this change.

Stop both servers and delete the temp DB file when done.

- [ ] **Step 5: Run the backend test suite to confirm nothing else broke**

Run: `cd backend && node --test`
Expected: all tests pass, including the two new ones from Step 1.

- [ ] **Step 6: Commit**

```bash
git add src/InventarioProductos.jsx backend/productos.test.js
git commit -m "fix: preserve existing sale price when editing a product without a precios array"
```

---

### Task 3: Fix — Botón "Propina" en Corte de Caja no hace nada

**Files:**
- Modify: `src/CorteCaja.jsx:204-209`

**Interfaces:**
- Consumes: existing local `mostrarAviso` function (`src/CorteCaja.jsx:126`) — no signature changes.
- Produces: nothing consumed by other tasks.

**Root cause (confirmed by reading the code):** the button has no `onClick` at all. Every other not-yet-implemented action in this codebase (e.g. "Carga masiva", "Nota de crédito" in `PuntoDeVenta.jsx`) shows a `mostrarAviso("... — próximamente")` notice instead of silently doing nothing — this button is the one inconsistency.

- [ ] **Step 1: Apply the fix**

In `src/CorteCaja.jsx`, find this exact block (currently lines 204-209):

```jsx
        {puede("registrar_propina") && (
          <button className="flex flex-col items-center justify-center gap-1 px-3 py-2 min-w-[74px] border-r border-slate-100 hover:bg-blue-50">
            <CircleDollarSign size={18} className="text-amber-500" />
            <span className="text-[10px] font-medium text-slate-500">Propina</span>
          </button>
        )}
```

Replace it with:

```jsx
        {puede("registrar_propina") && (
          <button onClick={() => mostrarAviso("Registro de propina — próximamente")} className="flex flex-col items-center justify-center gap-1 px-3 py-2 min-w-[74px] border-r border-slate-100 hover:bg-blue-50">
            <CircleDollarSign size={18} className="text-amber-500" />
            <span className="text-[10px] font-medium text-slate-500">Propina</span>
          </button>
        )}
```

- [ ] **Step 2: Manual verification (no automated frontend test harness in this repo)**

Run against an isolated temp `DB_PATH`, same setup pattern as Task 1 Step 2.

1. Log in, go to Punto de Venta → Corte de Caja (or wherever this toolbar renders).
2. Click "Propina".
3. **Expected after fix:** aviso "Registro de propina — próximamente" appears. **Before the fix**, nothing happened.

Stop both servers and delete the temp DB file when done.

- [ ] **Step 3: Commit**

```bash
git add src/CorteCaja.jsx
git commit -m "fix: show a not-implemented notice for the Propina button instead of doing nothing"
```

---

### Task 4: Fix — Lista de Productos no se refresca tras Migración de Datos

**Files:**
- Modify: `src/InventarioProductos.jsx:613` (the `tab === "migracion"` render line) and the `cargarTodo` callback wiring
- Modify: `src/MigracionDatos.jsx:21` (component signature) and the `aplicar` function (currently lines 61-78)

**Interfaces:**
- Consumes: `InventarioProductos`'s existing `cargarTodo` (`src/InventarioProductos.jsx:82`, already a `useCallback` with no args, returns `Promise<void>`).
- Produces: a new optional prop `onImportado` on `MigracionDatos`, called with no arguments after a successful apply.

**Root cause (confirmed by reading the code):** `InventarioProductos`'s `productos` state (line 63) is loaded once by `cargarTodo` and only reloaded by specific actions within the Productos tab itself (create/edit/delete/clone/adjust/F5 — see lines 189, 204, 215, 237, 284). `MigracionDatos` (rendered at `src/InventarioProductos.jsx:613`, conditionally via `tab === "migracion" && <MigracionDatos ... />`) has no reference to `cargarTodo` and never triggers a reload of the parent's product list after a successful import, so newly-imported/updated products don't show up in the Productos tab until something else happens to trigger a reload.

- [ ] **Step 1: Wire the callback prop in `InventarioProductos.jsx`**

Find this line (currently line 613):

```jsx
      {tab === "migracion" && <MigracionDatos onVolver={onVolver} permisos={permisos} usuario={usuario} />}
```

Replace it with:

```jsx
      {tab === "migracion" && <MigracionDatos onVolver={onVolver} permisos={permisos} usuario={usuario} onImportado={cargarTodo} />}
```

- [ ] **Step 2: Accept and call the new prop in `MigracionDatos.jsx`**

Find the component signature (currently line 21):

```js
export default function MigracionDatos({ onVolver, permisos, usuario }) {
```

Replace it with:

```js
export default function MigracionDatos({ onVolver, permisos, usuario, onImportado }) {
```

Find the `aplicar` function (currently lines 61-78):

```js
  const aplicar = async () => {
    const filas = previsualizacion.filas.filter((f) => f.valida && confirmados[f.numero_fila]).map((f) => f.datos);
    if (filas.length === 0) return mostrarAviso("Confirma al menos un renglón antes de aplicar");
    setCargando(true);
    try {
      const r = await apiFetch("/migracion/aplicar", {
        method: "POST",
        body: JSON.stringify({ tipo: tab, filas, sucursal_id: sucursalId || undefined, defaults, nombre_archivo: nombreArchivoRef.current }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setResumen(data);
      setPrevisualizacion(null);
      setConfirmados({});
      mostrarAviso(`${data.nuevos} nuevos, ${data.actualizados} actualizados${data.errores.length ? `, ${data.errores.length} con error` : ""}`);
    } catch (e) { mostrarAviso("❌ " + e.message); }
    finally { setCargando(false); }
  };
```

Replace the `mostrarAviso(...)` line inside the `try` block with two lines — the same `mostrarAviso` call plus a call to `onImportado` guarded for the "Artículos" import type only (`tab === "articulos"`, since Clientes/Proveedores imports don't affect the Productos list this bug is about):

```js
      mostrarAviso(`${data.nuevos} nuevos, ${data.actualizados} actualizados${data.errores.length ? `, ${data.errores.length} con error` : ""}`);
      if (tab === "articulos" && onImportado) onImportado();
```

(Check the exact tab-id string used for the Artículos sub-tab in this file — grep `const \[tab` or the sub-tab definitions near the top of `MigracionDatos.jsx` before writing this line, and use whatever id actually gates the Artículos flow; it is very likely `"articulos"` but confirm against the file instead of assuming.)

- [ ] **Step 3: Manual verification (no automated frontend test harness in this repo)**

Run against an isolated temp `DB_PATH`, same setup pattern as Task 1 Step 2.

1. Log in, go to Inventario y Productos → Migración de Datos → Artículos.
2. Prepare a small synthetic `.xlsx` with one new row (a brand-new `Clave` not in the seed catalog) using the exact column aliases from `backend/migracion.js` (`Clave`, `Descripción`, `Categoría`, `Departamento`, `Costo`, `Precio 1`, `Existencia`, `Unidad`).
3. Upload it, confirm the row in the previsualización, click "Aplicar importación".
4. **Without switching tabs**, go directly to the Productos tab and search for the new clave.
5. **Expected after fix:** the new product appears immediately. **Before the fix**, it showed "Sin productos" until switching to another sub-tab and back.

Stop both servers and delete the temp DB file and the synthetic `.xlsx` when done.

- [ ] **Step 4: Commit**

```bash
git add src/InventarioProductos.jsx src/MigracionDatos.jsx
git commit -m "fix: refresh Productos list after a successful Migración de Datos import"
```

---

## Self-Review Notes

- Spec coverage: all 4 bugs from the 2026-07-16 audit report are covered, one task each.
- No placeholders: every step has exact file paths, exact current code to find, and exact replacement code.
- Type consistency: `onImportado` prop name and no-arg `cargarTodo`/`onImportado()` signature match between `InventarioProductos.jsx` (producer) and `MigracionDatos.jsx` (consumer) in Task 4.
- Tasks 1-4 are fully independent — no ordering constraints, can be implemented and reviewed in any order or in parallel by separate subagents (but per subagent-driven-development's rule against parallel implementers, dispatch them one at a time regardless).
