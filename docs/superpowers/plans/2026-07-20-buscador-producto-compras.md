# Buscador de Producto por Fila + Sugerencia Automática — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the full-catalog `<select>` dropdown used to link a detected invoice line to a product (in both the "Escanear Factura IA" and "Importar XML" modals of `RecepcionCompras.jsx`) with a per-row search-as-you-type box, and auto-suggest a match by code or description so most rows arrive pre-filled.

**Architecture:** A pure JS helper (`src/sugerirProducto.js`) scores products against a detected line's code/description and is shared by both import flows. A new small React component (`BuscadorProductoFila`, defined inline in `RecepcionCompras.jsx` next to the file's other local components like `Modal`/`Campo`) replaces the `<select>` in both tables. `backend/facturaIA.js` gains an optional `codigo` field in its extraction schema so the AI-scan flow has something to feed the code-matching path — the XML flow already has `clave_sat` for the same purpose.

**Tech Stack:** Same as the rest of the project — Node's built-in `node --test` for backend, plain React state (no new libraries) for frontend. No new npm dependency.

## Global Constraints

- No new npm dependency, frontend or backend — all matching is plain JS string/array operations.
- The suggestion only pre-fills the row; the "Confirmar" checkbox per line stays manual — never auto-checked. This preserves the explicit-confirmation behavior the XML flow already has.
- Frontend has no automated test harness in this project (established convention) — the pure-JS suggestion helper is verified with a one-off manual script (not a permanent test file) before being wired into the UI; the UI itself is verified manually with a real document, per Task 5.
- Backend tests run with: `cd backend && npm test` (Node's built-in `node --test`). This worktree needs `npm install` run once in `backend/` before tests will work, and once at the repo root before `npm run build` will work — dependencies aren't committed to git.
- Follow the existing code style in `RecepcionCompras.jsx`: Spanish identifiers, `inputCls` for form control styling, small components defined inline in the same file (this file already does this for `BotonBarra`, `BotonLateral`, `Modal`, `Campo` — don't extract to a separate file).

---

### Task 1: `backend/facturaIA.js` — read an optional line code

**Files:**
- Modify: `backend/facturaIA.js`
- Modify: `backend/facturaIA.test.js`

**Interfaces:**
- Produces: `analizarFacturaImagen(...)` now resolves to `{ conceptos: [{ descripcion, codigo, cantidad, costo_unitario, aplica_iva }] }` — `codigo` is `string | null`, passed through unchanged from whatever Claude's tool call returns (no new processing logic in `analizarFacturaImagen` itself).

- [ ] **Step 0: Install backend dependencies**

Run: `cd backend && npm install`
Expected: installs cleanly (this worktree's `node_modules` isn't in git).

- [ ] **Step 1: Write the failing test**

Open `backend/facturaIA.test.js`. Add these two tests right after the existing `"analizarFacturaImagen manda un bloque type: document..."` test (i.e. right before the final `"TOOL_EXTRAER_FACTURA exige legible y conceptos..."` test):

```js
test("analizarFacturaImagen propaga el campo codigo de cada concepto cuando Claude lo incluye", async () => {
  const anthropic = anthropicFalso({
    legible: true,
    motivo_no_legible: null,
    conceptos: [
      { descripcion: "Cuerdas de guitarra acústica", codigo: "CG-100", cantidad: 10, costo_unitario: 45.5, aplica_iva: true },
      { descripcion: "Producto sin código en la factura", codigo: null, cantidad: 1, costo_unitario: 20, aplica_iva: false },
    ],
  });

  const resultado = await analizarFacturaImagen(anthropic, "ZmFrZS1iYXNlNjQ=", "image/jpeg");

  assert.strictEqual(resultado.conceptos[0].codigo, "CG-100");
  assert.strictEqual(resultado.conceptos[1].codigo, null);
});

test("TOOL_EXTRAER_FACTURA declara codigo como opcional en el schema de cada concepto", () => {
  const propiedadesConcepto = TOOL_EXTRAER_FACTURA.input_schema.properties.conceptos.items;
  assert.ok(propiedadesConcepto.properties.codigo, "el schema debe declarar la propiedad codigo");
  assert.ok(!propiedadesConcepto.required.includes("codigo"), "codigo no debe ser requerido");
});
```

- [ ] **Step 2: Run tests to verify the new schema test fails**

Run: `cd backend && node --test facturaIA.test.js`
Expected: the "propaga el campo codigo" test PASSES already (it's a plain passthrough, not gated by the schema), but "declara codigo como opcional" FAILS with something like `Cannot read properties of undefined (reading 'codigo')` or an assertion failure, because `codigo` isn't in the schema yet.

- [ ] **Step 3: Add `codigo` to the schema and update the prompt**

In `backend/facturaIA.js`, inside `TOOL_EXTRAER_FACTURA.input_schema.properties.conceptos.items.properties`, add `codigo` right after `descripcion`:

```js
          properties: {
            descripcion: { type: "string", description: "Descripción o nombre del producto tal como aparece en el documento." },
            codigo: { type: ["string", "null"], description: "Código, clave o SKU que aparezca impreso junto a esta línea en el documento, tal como está escrito. Usa null si el documento no muestra ningún código para esa línea — no inventes uno." },
            cantidad: { type: "number", description: "Cantidad de ese producto." },
            costo_unitario: { type: "number", description: "Precio de compra unitario. Si el documento desglosa el IVA por separado, usa el precio SIN IVA (neto) de esa línea, no el total con impuesto." },
            aplica_iva: { type: "boolean", description: "true si esa línea lleva IVA aplicado según el documento." },
          },
          required: ["descripcion", "cantidad", "costo_unitario", "aplica_iva"],
```

(`codigo` stays out of `required` — many delivery notes don't print one.)

Then update the instruction text sent to Claude — in the `messages[0].content` array, the `{ type: "text", text: "..." }` block — to mention the new field. Replace:

```js
          text: "Esta imagen o PDF es una factura o nota de remisión de un proveedor. Primero evalúa si se puede leer con confianza razonable (campo legible). Si NO es legible, explica por qué en motivo_no_legible y deja conceptos como un arreglo vacío — no adivines datos que no se puedan leer con confianza. Si SÍ es legible, extrae cada línea de producto: descripción, cantidad, costo unitario (precio de compra neto, sin IVA, si el documento permite distinguirlo) y si esa línea aplica IVA. No inventes ni redondees datos que no estén claramente en el documento.",
```

with:

```js
          text: "Esta imagen o PDF es una factura o nota de remisión de un proveedor. Primero evalúa si se puede leer con confianza razonable (campo legible). Si NO es legible, explica por qué en motivo_no_legible y deja conceptos como un arreglo vacío — no adivines datos que no se puedan leer con confianza. Si SÍ es legible, extrae cada línea de producto: descripción, código o clave si el documento la imprime junto a esa línea (usa null si no hay ninguna — no inventes uno), cantidad, costo unitario (precio de compra neto, sin IVA, si el documento permite distinguirlo) y si esa línea aplica IVA. No inventes ni redondees datos que no estén claramente en el documento.",
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && node --test facturaIA.test.js`
Expected: PASS (all 7 tests).

- [ ] **Step 5: Run the full backend test suite**

Run: `cd backend && npm test`
Expected: All tests PASS (273+ tests, no regression).

- [ ] **Step 6: Commit**

```bash
git add backend/facturaIA.js backend/facturaIA.test.js
git commit -m "feat: read an optional line code in AI invoice extraction"
```

---

### Task 2: `src/sugerirProducto.js` — shared product-suggestion helper

**Files:**
- Create: `src/sugerirProducto.js`

**Interfaces:**
- Produces (used by Tasks 3 and 4): `sugerirProducto({ codigo, descripcion }, productos, { incluirClaveSat } = {}) → { producto_id, porSugerencia: "codigo" | "descripcion" } | null`. `productos` is the same array shape already used throughout `RecepcionCompras.jsx` (`{ id, nombre, sku, codigo, clave_sat, ... }`).

- [ ] **Step 1: Write the module**

Create `src/sugerirProducto.js`:

```js
const LARGO_MINIMO_PALABRA = 3;

export function normalizarTexto(texto) {
  return String(texto == null ? "" : texto)
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .trim()
    .toLowerCase();
}

function palabrasSignificativas(texto) {
  return normalizarTexto(texto)
    .split(/\s+/)
    .filter((palabra) => palabra.length >= LARGO_MINIMO_PALABRA);
}

export function sugerirProducto({ codigo, descripcion }, productos, { incluirClaveSat = false } = {}) {
  if (codigo) {
    const codigoNorm = normalizarTexto(codigo);
    const porCodigo = productos.find((p) =>
      (p.sku && normalizarTexto(p.sku) === codigoNorm) ||
      (p.codigo && normalizarTexto(p.codigo) === codigoNorm) ||
      (incluirClaveSat && p.clave_sat && normalizarTexto(p.clave_sat) === codigoNorm)
    );
    if (porCodigo) return { producto_id: porCodigo.id, porSugerencia: "codigo" };
  }

  const palabrasDescripcion = palabrasSignificativas(descripcion);
  if (palabrasDescripcion.length === 0) return null;

  let mejorProducto = null;
  let mejorPuntaje = 0;
  for (const p of productos) {
    const palabrasNombre = palabrasSignificativas(p.nombre);
    if (palabrasNombre.length === 0) continue;
    const comunes = palabrasDescripcion.filter((palabra) => palabrasNombre.includes(palabra)).length;
    if (comunes === 0) continue;
    const puntaje = comunes / palabrasDescripcion.length;
    if (puntaje > mejorPuntaje) {
      mejorPuntaje = puntaje;
      mejorProducto = p;
    }
  }
  return mejorProducto ? { producto_id: mejorProducto.id, porSugerencia: "descripcion" } : null;
}
```

- [ ] **Step 2: Sanity-check it manually before wiring it into the UI**

This project has no frontend test runner (see Global Constraints), so verify with a throwaway command instead of a permanent test file. Run from the repo root:

```bash
node -e "
import('./src/sugerirProducto.js').then(({ sugerirProducto }) => {
  const productos = [
    { id: 1, nombre: 'Cuerdas de guitarra acustica', sku: 'CG-100', codigo: '750123456789', clave_sat: '60131500' },
    { id: 2, nombre: 'Baquetas 5A', sku: 'BQ-5A', codigo: '', clave_sat: '' },
  ];
  console.log('por codigo:', sugerirProducto({ codigo: 'CG-100', descripcion: 'algo irrelevante' }, productos));
  console.log('por clave_sat (solo XML):', sugerirProducto({ codigo: '60131500', descripcion: 'algo irrelevante' }, productos, { incluirClaveSat: true }));
  console.log('por clave_sat (IA, no debe matchear):', sugerirProducto({ codigo: '60131500', descripcion: 'algo irrelevante' }, productos));
  console.log('por descripcion:', sugerirProducto({ codigo: null, descripcion: 'Baquetas 5A modelo nuevo' }, productos));
  console.log('sin match:', sugerirProducto({ codigo: null, descripcion: 'Cosa sin relacion alguna con nada' }, productos));
});
"
```

Expected output (order may vary slightly but values must match):
```
por codigo: { producto_id: 1, porSugerencia: 'codigo' }
por clave_sat (solo XML): { producto_id: 1, porSugerencia: 'codigo' }
por clave_sat (IA, no debe matchear): null
por descripcion: { producto_id: 2, porSugerencia: 'descripcion' }
sin match: null
```

If any line doesn't match, fix `sugerirProducto` before continuing — this is the core matching logic both UI flows depend on.

- [ ] **Step 3: Commit**

```bash
git add src/sugerirProducto.js
git commit -m "feat: add shared product-suggestion helper (by code or description)"
```

---

### Task 3: Frontend — `BuscadorProductoFila` component, wired into the Escanear IA modal

**Files:**
- Modify: `src/RecepcionCompras.jsx`

**Interfaces:**
- Consumes: `sugerirProducto` (Task 2).
- Produces: `<BuscadorProductoFila productos={...} productoId={...} onSeleccionar={(id) => ...} />`, a reusable row-level combobox used by both this task and Task 4.

- [ ] **Step 1: Import the helper**

In `src/RecepcionCompras.jsx`, find:

```js
import { apiFetch } from "./api";
import ArticuloCompra from "./ArticuloCompra";
```

and add right after:

```js
import { sugerirProducto } from "./sugerirProducto";
```

- [ ] **Step 2: Add the `BuscadorProductoFila` component**

Find the `Campo` component near the bottom of the file:

```jsx
function Campo({ label, children }) {
  return (
    <div>
      <label className="text-xs text-slate-500 block mb-1">{label}</label>
      {children}
    </div>
  );
}
```

Add a new component right after it:

```jsx
function BuscadorProductoFila({ productos, productoId, onSeleccionar }) {
  const [texto, setTexto] = useState(() => productos.find((p) => p.id === productoId)?.nombre || "");
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    setTexto(productos.find((p) => p.id === productoId)?.nombre || "");
  }, [productoId, productos]);

  const coincidencias = useMemo(() => {
    const t = texto.trim().toLowerCase();
    if (!t) return [];
    return productos
      .filter((p) =>
        p.nombre.toLowerCase().includes(t) ||
        p.sku.toLowerCase().includes(t) ||
        (p.codigo || "").toLowerCase().includes(t)
      )
      .slice(0, 8);
  }, [texto, productos]);

  return (
    <div className="relative">
      <input
        className={inputCls}
        value={texto}
        onChange={(e) => {
          setTexto(e.target.value);
          setAbierto(true);
          if (!e.target.value) onSeleccionar(null);
        }}
        onFocus={() => setAbierto(true)}
        onBlur={() => setTimeout(() => setAbierto(false), 150)}
        placeholder="Clave, código o nombre..."
      />
      {abierto && coincidencias.length > 0 && (
        <div className="absolute z-10 mt-1 w-full max-h-48 overflow-y-auto bg-white border border-slate-200 rounded shadow-lg">
          {coincidencias.map((p) => (
            <div
              key={p.id}
              onMouseDown={() => { onSeleccionar(p.id); setTexto(p.nombre); setAbierto(false); }}
              className="px-2 py-1.5 text-sm hover:bg-blue-50 cursor-pointer"
            >
              <div className="text-[11px] text-slate-400">{p.sku}</div>
              <div>{p.nombre}</div>
            </div>
          ))}
        </div>
      )}
      {!texto && <div className="text-[11px] text-slate-400 mt-0.5">Sin vincular — se ignora</div>}
    </div>
  );
}
```

Note the option row uses `onMouseDown` (not `onClick`): the input's `onBlur` fires first on click and closes the dropdown before a plain `onClick` would register, so clicks would silently do nothing. `onMouseDown` fires before `onBlur`, so the selection registers correctly.

- [ ] **Step 3: Add `sugeridosIa` state**

Find:

```js
  const [confirmadosIa, setConfirmadosIa] = useState({}); // { [indiceConcepto]: true }
```

and add right after:

```js
  const [sugeridosIa, setSugeridosIa] = useState({}); // { [indiceConcepto]: true } — el match ORIGINAL fue auto-sugerido por código o descripción
```

- [ ] **Step 4: Compute suggestions when the AI result comes back**

In `leerArchivoFacturaImagen`, find:

```js
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        setIaParseado(data);
        setMatchesIa({});
        setConfirmadosIa({});
```

and replace with:

```js
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        setIaParseado(data);
        const sugeridos = {};
        const marcasSugeridos = {};
        data.conceptos.forEach((c, idx) => {
          const match = sugerirProducto({ codigo: c.codigo, descripcion: c.descripcion }, productos);
          if (match) { sugeridos[idx] = match.producto_id; marcasSugeridos[idx] = true; }
        });
        setMatchesIa(sugeridos);
        setSugeridosIa(marcasSugeridos);
        setConfirmadosIa({});
```

- [ ] **Step 5: Show the "Sugerido" badge and swap the `<select>` for the new component**

In the `modal === "importarIa"` block, find:

```jsx
                      <td className="py-2 px-2">
                        {c.descripcion}
                        {c.aplica_iva && <span className="ml-1.5 text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">IVA</span>}
                      </td>
                      <td className="py-2 px-2 text-center">{c.cantidad}</td>
                      <td className="py-2 px-2 text-right">${Number(c.costo_unitario).toFixed(2)}</td>
                      <td className="py-2 px-2">
                        <select
                          className={inputCls}
                          value={matchesIa[idx] ?? ""}
                          onChange={(e) => setMatchesIa((prev) => ({ ...prev, [idx]: e.target.value ? Number(e.target.value) : null }))}
                        >
                          <option value="">Sin vincular — se ignora</option>
                          {productos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                        </select>
                      </td>
```

and replace with:

```jsx
                      <td className="py-2 px-2">
                        {c.descripcion}
                        {sugeridosIa[idx] && (
                          <span className="ml-1.5 text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">Sugerido</span>
                        )}
                        {c.aplica_iva && <span className="ml-1.5 text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">IVA</span>}
                      </td>
                      <td className="py-2 px-2 text-center">{c.cantidad}</td>
                      <td className="py-2 px-2 text-right">${Number(c.costo_unitario).toFixed(2)}</td>
                      <td className="py-2 px-2">
                        <BuscadorProductoFila
                          productos={productos}
                          productoId={matchesIa[idx] ?? null}
                          onSeleccionar={(id) => setMatchesIa((prev) => ({ ...prev, [idx]: id }))}
                        />
                      </td>
```

- [ ] **Step 6: Reset `sugeridosIa` everywhere the other IA state already gets reset**

There are two other places that reset `matchesIa`/`confirmadosIa` together — add `setSugeridosIa({})` to both:

In the modal's `onCerrar`:
```jsx
        <Modal titulo="Escanear Factura con IA (F9)" onCerrar={() => { setModal(null); setIaParseado(null); setErrorLegibilidadIa(null); }} ancho="max-w-3xl">
```
No change needed here — this one doesn't reset `matchesIa`/`confirmadosIa` today either, so it stays consistent as-is.

In the "Cancelar" button:
```jsx
                <button onClick={() => { setIaParseado(null); setMatchesIa({}); setConfirmadosIa({}); }} className="flex-1 border border-slate-300 text-slate-600 py-2 rounded font-medium hover:bg-slate-50">Cancelar</button>
```
Replace with:
```jsx
                <button onClick={() => { setIaParseado(null); setMatchesIa({}); setConfirmadosIa({}); setSugeridosIa({}); }} className="flex-1 border border-slate-300 text-slate-600 py-2 rounded font-medium hover:bg-slate-50">Cancelar</button>
```

In `confirmarImportacionIa`, find:
```js
    mostrarAviso(`${nuevos.length} producto(s) agregado(s) desde el documento escaneado`);
    setIaParseado(null);
    setMatchesIa({});
    setConfirmadosIa({});
    setModal(null);
```
Replace with:
```js
    mostrarAviso(`${nuevos.length} producto(s) agregado(s) desde el documento escaneado`);
    setIaParseado(null);
    setMatchesIa({});
    setConfirmadosIa({});
    setSugeridosIa({});
    setModal(null);
```

- [ ] **Step 7: Verify the build**

Run: `npm install` (repo root, once) then `npm run build`
Expected: No syntax errors, `✓ built in ...`.

- [ ] **Step 8: Commit**

```bash
git add src/RecepcionCompras.jsx
git commit -m "feat: add row-level product search with auto-suggestion to Escanear IA"
```

---

### Task 4: Frontend — reuse the same search + suggestion in the Importar XML modal

**Files:**
- Modify: `src/RecepcionCompras.jsx`

**Interfaces:**
- Consumes: `sugerirProducto` (Task 2), `BuscadorProductoFila` (Task 3) — both already in this file after Task 3.

- [ ] **Step 1: Replace the inline clave_sat-only suggestion logic with the shared helper**

In `leerArchivoXml`, find:

```js
        setXmlParseado(data);
        const sugeridos = {};
        const marcasSugeridos = {};
        data.conceptos.forEach((c, idx) => {
          const match = productos.find((p) => p.clave_sat && c.clave_sat && p.clave_sat === c.clave_sat);
          sugeridos[idx] = match ? match.id : null;
          if (match) marcasSugeridos[idx] = true;
        });
        setMatchesXml(sugeridos);
        setSugeridosXml(marcasSugeridos);
```

and replace with:

```js
        setXmlParseado(data);
        const sugeridos = {};
        const marcasSugeridos = {};
        data.conceptos.forEach((c, idx) => {
          const match = sugerirProducto({ codigo: c.clave_sat, descripcion: c.descripcion }, productos, { incluirClaveSat: true });
          if (match) { sugeridos[idx] = match.producto_id; marcasSugeridos[idx] = true; }
        });
        setMatchesXml(sugeridos);
        setSugeridosXml(marcasSugeridos);
```

This keeps the exact-match-by-Clave-SAT behavior (via `incluirClaveSat: true`) and adds two more chances to suggest correctly: an exact SKU/barcode match, and — when neither code path hits — a description match against product names.

- [ ] **Step 2: Swap the `<select>` for `BuscadorProductoFila` in the XML table**

In the `modal === "importarXml"` block, find:

```jsx
                      <td className="py-2 px-2">
                        <select
                          className={inputCls}
                          value={matchesXml[idx] ?? ""}
                          onChange={(e) => setMatchesXml((prev) => ({ ...prev, [idx]: e.target.value ? Number(e.target.value) : null }))}
                        >
                          <option value="">Sin vincular — se ignora</option>
                          {productos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                        </select>
                      </td>
```

and replace with:

```jsx
                      <td className="py-2 px-2">
                        <BuscadorProductoFila
                          productos={productos}
                          productoId={matchesXml[idx] ?? null}
                          onSeleccionar={(id) => setMatchesXml((prev) => ({ ...prev, [idx]: id }))}
                        />
                      </td>
```

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: No syntax errors, `✓ built in ...`.

- [ ] **Step 4: Commit**

```bash
git add src/RecepcionCompras.jsx
git commit -m "feat: reuse row-level product search and suggestion in Importar XML"
```

---

### Task 5: Full verification and manual end-to-end check

This task has no new code beyond what verification turns up — it confirms Tasks 1-4 work together and gives Victor a real check before merging, same pattern as the manual-verification task in the Escaneo Factura IA plan.

- [ ] **Step 1: Run the full backend test suite one more time**

Run: `cd backend && npm test`
Expected: All tests PASS, no regression from Task 1's schema/prompt change.

- [ ] **Step 2: Run the app locally**

Start the backend (`cd backend && node server.js`, needs `ANTHROPIC_API_KEY` in `.env` for the IA path) and the frontend (`npm run dev` from the repo root). Log in and go to Inventario y Productos → Recepción de Compras.

- [ ] **Step 3: Test the Escanear IA flow**

Press F9, upload a real invoice/delivery note photo or PDF with several lines. Confirm:
- Lines whose description clearly matches a product in your catalog arrive pre-filled with the "Sugerido" badge.
- Typing in the product box for any row filters to matching products by clave, código de barras, or nombre — no more scrolling a long list.
- Clearing a row's box returns it to "Sin vincular — se ignora".

- [ ] **Step 4: Test the Importar XML flow**

Press F8, import a real CFDI XML. Confirm the same "Sugerido" badge and search-box behavior works there too, and that lines it used to auto-match by Clave SAT still do.

- [ ] **Step 5: Report findings to Victor**

Report what worked, what didn't, and any adjustment needed.
