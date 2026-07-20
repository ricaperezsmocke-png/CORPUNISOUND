# Escaneo de Factura con IA — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let anyone with the `recibir_compra` permission upload a photo or PDF of a supplier invoice/delivery note in Recepción de Compras and have Claude extract line items (description, quantity, purchase cost, IVA) into the same confirmation-table pattern already used for CFDI XML imports — with a hard legibility gate that blocks the entire extraction (no partial results) when the document can't be read with reasonable confidence.

**Architecture:** New backend module `backend/facturaIA.js` calls Claude (`anthropic.messages.create`, dependency-injected client for testability) with the uploaded image/PDF as a content block plus a `tool_use` schema that forces structured output (`legible`, `motivo_no_legible`, `conceptos[]`). A new route in `server.js` wires this behind the existing `recibir_compra` permission — no new permission. The frontend adds a parallel set of state/modal in `RecepcionCompras.jsx` (mirroring the existing XML-import state/modal, not sharing it, to avoid touching the already-working XML flow) that reuses the same confirmation-table UX: per-line product matching + explicit "Confirmar" checkbox before anything is added.

**Tech Stack:** `@anthropic-ai/sdk` (already a dependency; this plan may bump its pinned version — see Task 1 Step 0), Node's built-in `node --test`, React 18 frontend, same base64-file-upload pattern already used elsewhere in this project (`leerArchivoComoBase64`).

## Global Constraints

- Reuse the existing `recibir_compra` permission for the new route — do NOT create a new permission (this feature lives entirely inside the screen that permission already gates).
- Allowed file types: `application/pdf`, `image/jpeg`, `image/png`. Max size: 10 MB (`10 * 1024 * 1024` bytes) — same convention as other file uploads in this project.
- Legibility gate is all-or-nothing: if Claude reports the document is not legible, the backend throws and the frontend shows the error message with **no partial table** — never render some rows and hide others.
- No new npm dependency for the AI call — this feature uses the `@anthropic-ai/sdk` client already installed and already used in `backend/server.js` for `/api/chat`. Task 1 Step 0 verifies (and if needed, bumps) the pinned version to get stable PDF/`document`-block support — this is a version bump of an existing dependency, not a new one.
- Sale-price margins (`producto.precios`, the 4 utility tiers) are never read from or written by this feature. Cost/quantity/IVA feed into the same renglon shape the manual/XML paths already use; margins keep being computed from each product's already-configured `% Utilidad`, unchanged.
- No automatic creation of new catalog products for lines Claude couldn't match — exactly like the existing XML import, an unmatched line stays "Sin vincular — se ignora" until a human picks a product from the dropdown or leaves it unlinked.
- No copy of the uploaded image/PDF is persisted anywhere (memory or disk) beyond the single request — it's used only to build the Claude API call and then discarded.
- Backend tests run with: `cd backend && npm test` (Node's built-in `node --test`).

---

### Task 1: `backend/facturaIA.js` — Claude vision extraction with a legibility gate

**Files:**
- Create: `backend/facturaIA.js`
- Test: `backend/facturaIA.test.js`
- Modify (maybe): `backend/package.json` / `backend/package-lock.json` — only if Step 0 finds PDF support requires a version bump.

**Interfaces:**
- Consumes: an Anthropic SDK client instance (dependency-injected, same pattern as `documentosPersonal.js`'s injected `drive` parameter — this is what makes the tests below possible without a real API key or network call).
- Produces (used by Task 2): `analizarFacturaImagen(anthropic, archivoBase64, tipoMime) → Promise<{ conceptos: [{descripcion, cantidad, costo_unitario, aplica_iva}] }>` — rejects with a plain `Error` whose `.message` is the user-facing reason (either `motivo_no_legible`, or a generic "Claude no devolvió un resultado estructurado — intenta de nuevo" if the tool wasn't invoked).
- Exported constant: `TOOL_EXTRAER_FACTURA` (the tool schema, exported so the test file can assert its shape doesn't drift).

- [ ] **Step 0: Verify PDF support in the installed Anthropic SDK version (spike, not a test)**

Run: `cd backend && npm ls @anthropic-ai/sdk` — confirm the installed version (expected `0.32.0` per `package.json`).

Check whether that version's stable (non-beta) `messages.create` type definitions support a `type: "document"` content block:

Run: `cd backend && grep -rn "DocumentBlockParam" node_modules/@anthropic-ai/sdk/resources/messages.d.ts`

- If this prints a match: stable PDF support exists in the installed version. Skip the version bump below and use `anthropic.messages.create(...)` directly with a `{ type: "document", source: { type: "base64", media_type: "application/pdf", data } }` content block in Step 3.
- If this prints nothing (as of writing this plan, it does print nothing — the installed `0.32.0` only has `DocumentBlockParam` under `resources/beta/messages/messages.d.ts`): bump the dependency.
  ```bash
  cd backend
  npm install @anthropic-ai/sdk@^0.60.0
  ```
  (Pick the latest `^0.x` release available at implementation time via `npm view @anthropic-ai/sdk version` if `0.60.0` is no longer current — the goal is any version where `grep -rn "DocumentBlockParam" node_modules/@anthropic-ai/sdk/resources/messages.d.ts` DOES print a match, meaning PDF support is in the stable, non-beta API.)
  After bumping, re-run the full backend test suite once (`npm test`) to confirm the version bump alone doesn't break anything already using `@anthropic-ai/sdk` (i.e. `/api/chat` in `server.js`) before writing any new code.

Record which case applied — it determines whether Step 3's code needs `anthropic.beta.messages.create` (only if you could not get stable support any other way) or the plain `anthropic.messages.create` (expected outcome after the bump). Prefer the plain, non-beta client if at all possible.

- [ ] **Step 1: Write the failing tests**

Create `backend/facturaIA.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { analizarFacturaImagen, TOOL_EXTRAER_FACTURA } = require("./facturaIA");

function anthropicFalso(respuestaTool) {
  return {
    messages: {
      create: async () => ({
        content: [{ type: "tool_use", name: "extraer_factura", input: respuestaTool }],
      }),
    },
  };
}

test("analizarFacturaImagen regresa los conceptos cuando el documento es legible", async () => {
  const anthropic = anthropicFalso({
    legible: true,
    motivo_no_legible: null,
    conceptos: [
      { descripcion: "Cuerdas de guitarra acústica", cantidad: 10, costo_unitario: 45.5, aplica_iva: true },
      { descripcion: "Baquetas 5A", cantidad: 6, costo_unitario: 60, aplica_iva: false },
    ],
  });

  const resultado = await analizarFacturaImagen(anthropic, "ZmFrZS1iYXNlNjQ=", "image/jpeg");

  assert.strictEqual(resultado.conceptos.length, 2);
  assert.strictEqual(resultado.conceptos[0].descripcion, "Cuerdas de guitarra acústica");
  assert.strictEqual(resultado.conceptos[0].cantidad, 10);
  assert.strictEqual(resultado.conceptos[0].costo_unitario, 45.5);
  assert.strictEqual(resultado.conceptos[0].aplica_iva, true);
  assert.strictEqual(resultado.conceptos[1].aplica_iva, false);
});

test("analizarFacturaImagen lanza error con el motivo cuando el documento no es legible", async () => {
  const anthropic = anthropicFalso({
    legible: false,
    motivo_no_legible: "La foto está muy borrosa para leer las cantidades y precios",
    conceptos: [],
  });

  await assert.rejects(
    () => analizarFacturaImagen(anthropic, "ZmFrZS1iYXNlNjQ=", "image/jpeg"),
    /La foto está muy borrosa/
  );
});

test("analizarFacturaImagen lanza un error claro si Claude no regresa un tool_use", async () => {
  const anthropic = {
    messages: {
      create: async () => ({ content: [{ type: "text", text: "No puedo ayudar con eso" }] }),
    },
  };

  await assert.rejects(
    () => analizarFacturaImagen(anthropic, "ZmFrZS1iYXNlNjQ=", "image/jpeg"),
    /Claude no devolvió un resultado estructurado/
  );
});

test("analizarFacturaImagen manda un bloque type: document para PDF y type: image para JPG/PNG", async () => {
  let contenidoEnviado = null;
  const anthropic = {
    messages: {
      create: async (params) => {
        contenidoEnviado = params.messages[0].content;
        return { content: [{ type: "tool_use", name: "extraer_factura", input: { legible: true, motivo_no_legible: null, conceptos: [] } }] };
      },
    },
  };

  await analizarFacturaImagen(anthropic, "ZmFrZS1wZGY=", "application/pdf");
  assert.strictEqual(contenidoEnviado[0].type, "document");
  assert.strictEqual(contenidoEnviado[0].source.media_type, "application/pdf");

  await analizarFacturaImagen(anthropic, "ZmFrZS1qcGc=", "image/jpeg");
  assert.strictEqual(contenidoEnviado[0].type, "image");
  assert.strictEqual(contenidoEnviado[0].source.media_type, "image/jpeg");
});

test("TOOL_EXTRAER_FACTURA exige legible y conceptos en su schema", () => {
  assert.strictEqual(TOOL_EXTRAER_FACTURA.name, "extraer_factura");
  assert.ok(TOOL_EXTRAER_FACTURA.input_schema.required.includes("legible"));
  assert.ok(TOOL_EXTRAER_FACTURA.input_schema.required.includes("conceptos"));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && node --test facturaIA.test.js`
Expected: FAIL with `Cannot find module './facturaIA'`.

- [ ] **Step 3: Implement `backend/facturaIA.js`**

```js
/**
 * facturaIA.js — Extrae líneas de una factura o nota de remisión a partir
 * de una foto o PDF usando Claude (visión), para proveedores que no mandan
 * CFDI XML (ver cfdi.js para el caso que sí lo hace).
 *
 * El cliente de Anthropic se recibe como parámetro (en vez de importarlo
 * directamente) para poder probar este módulo con un cliente falso, sin
 * llamar a la API real.
 */

const TOOL_EXTRAER_FACTURA = {
  name: "extraer_factura",
  description: "Registra el resultado de leer una factura o nota de remisión en imagen o PDF.",
  input_schema: {
    type: "object",
    properties: {
      legible: {
        type: "boolean",
        description: "true si el documento se puede leer con confianza razonable; false si está borroso, cortado, mal iluminado o de alguna otra forma no se puede confiar en lo que dice.",
      },
      motivo_no_legible: {
        type: ["string", "null"],
        description: "Si legible es false, una explicación breve y concreta de por qué (ej. 'la foto está muy borrosa para leer las cantidades'). Si legible es true, usar null.",
      },
      conceptos: {
        type: "array",
        description: "Un elemento por cada línea/renglón de producto en el documento. Vacío si legible es false.",
        items: {
          type: "object",
          properties: {
            descripcion: { type: "string", description: "Descripción o nombre del producto tal como aparece en el documento." },
            cantidad: { type: "number", description: "Cantidad de ese producto." },
            costo_unitario: { type: "number", description: "Precio de compra unitario. Si el documento desglosa el IVA por separado, usa el precio SIN IVA (neto) de esa línea, no el total con impuesto." },
            aplica_iva: { type: "boolean", description: "true si esa línea lleva IVA aplicado según el documento." },
          },
          required: ["descripcion", "cantidad", "costo_unitario", "aplica_iva"],
        },
      },
    },
    required: ["legible", "conceptos"],
  },
};

function construirBloqueDocumento(archivoBase64, tipoMime) {
  if (tipoMime === "application/pdf") {
    return { type: "document", source: { type: "base64", media_type: "application/pdf", data: archivoBase64 } };
  }
  return { type: "image", source: { type: "base64", media_type: tipoMime, data: archivoBase64 } };
}

async function analizarFacturaImagen(anthropic, archivoBase64, tipoMime) {
  const bloqueDocumento = construirBloqueDocumento(archivoBase64, tipoMime);

  const respuesta = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    tools: [TOOL_EXTRAER_FACTURA],
    tool_choice: { type: "tool", name: "extraer_factura" },
    messages: [{
      role: "user",
      content: [
        bloqueDocumento,
        {
          type: "text",
          text: "Esta imagen o PDF es una factura o nota de remisión de un proveedor. Primero evalúa si se puede leer con confianza razonable (campo legible). Si NO es legible, explica por qué en motivo_no_legible y deja conceptos como un arreglo vacío — no adivines datos que no se puedan leer con confianza. Si SÍ es legible, extrae cada línea de producto: descripción, cantidad, costo unitario (precio de compra neto, sin IVA, si el documento permite distinguirlo) y si esa línea aplica IVA. No inventes ni redondees datos que no estén claramente en el documento.",
        },
      ],
    }],
  });

  const bloqueHerramienta = respuesta.content.find((b) => b.type === "tool_use");
  if (!bloqueHerramienta) {
    throw new Error("Claude no devolvió un resultado estructurado — intenta de nuevo");
  }

  const resultado = bloqueHerramienta.input;
  if (!resultado.legible) {
    throw new Error(resultado.motivo_no_legible || "El documento no se pudo leer con confianza suficiente");
  }
  return { conceptos: resultado.conceptos || [] };
}

module.exports = { analizarFacturaImagen, TOOL_EXTRAER_FACTURA };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && node --test facturaIA.test.js`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Run the full backend test suite**

Run: `cd backend && npm test`
Expected: All tests PASS (confirms the Step 0 version bump, if it happened, didn't break anything else using `@anthropic-ai/sdk`).

- [ ] **Step 6: Commit**

```bash
git add backend/facturaIA.js backend/facturaIA.test.js backend/package.json backend/package-lock.json
git commit -m "feat: add Claude-based invoice/delivery-note extraction with legibility gate"
```

(Include `backend/package.json`/`package-lock.json` in the commit only if Step 0 actually changed them.)

---

### Task 2: Wire the route into `server.js`

**Files:**
- Modify: `backend/server.js` (requires block, routes near the existing `/api/compras/importar-xml` route)

**Interfaces:**
- Consumes: `analizarFacturaImagen` (Task 1), the existing `anthropic` client instance already constructed in `server.js` (`const anthropic = new Anthropic();`), existing `requiereLogin`/`requierePermiso`/`resolverPermisosDeRol`.
- Produces: `POST /api/compras/importar-ia`.

- [ ] **Step 1: Add the require**

In `backend/server.js`, find the line:

```js
const { parsearFacturaXML } = require("./cfdi");
```

and add right after it:

```js
const { analizarFacturaImagen } = require("./facturaIA");
```

- [ ] **Step 2: Add the route**

In `backend/server.js`, find the existing route:

```js
app.post("/api/compras/importar-xml", requiereLogin, requierePermiso("recibir_compra", resolverPermisosDeRol), (req, res) => {
  try {
    res.json(parsearFacturaXML(req.body.xml));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
```

and add right after it:

```js
app.post("/api/compras/importar-ia", requiereLogin, requierePermiso("recibir_compra", resolverPermisosDeRol), async (req, res) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: "Falta configurar ANTHROPIC_API_KEY en el archivo .env del backend" });
    }
    const { archivo_base64, tipo_mime } = req.body;
    if (!["application/pdf", "image/jpeg", "image/png"].includes(tipo_mime)) {
      throw new Error("Tipo de archivo no permitido — solo PDF, JPG o PNG");
    }
    const tamanoBytes = Buffer.from(archivo_base64, "base64").length;
    if (tamanoBytes > 10 * 1024 * 1024) throw new Error("El archivo no puede pesar más de 10 MB");
    const resultado = await analizarFacturaImagen(anthropic, archivo_base64, tipo_mime);
    res.json(resultado);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
```

- [ ] **Step 3: Run the full backend test suite**

Run: `cd backend && npm test`
Expected: All tests PASS (no test file exists for route wiring in this codebase — confirmed established convention, see Task 4 of the Google Drive expedientes plan for the same note).

- [ ] **Step 4: Start the server locally to confirm it boots cleanly**

Run: `cd backend && node server.js` (with the worktree's `.env`, which already has `ANTHROPIC_API_KEY` if copied from the main checkout)
Expected: No startup errors, no "ARRANQUE BLOQUEADO" (this route doesn't touch the permissions catalog, so this is just a basic smoke check). Stop with Ctrl+C.

- [ ] **Step 5: Commit**

```bash
git add backend/server.js
git commit -m "feat: wire the AI invoice-scan route into server.js"
```

---

### Task 3: Frontend — "Escanear Factura (IA)" button and confirmation modal

**Files:**
- Modify: `src/RecepcionCompras.jsx`

**Interfaces:**
- Consumes: `POST /api/compras/importar-ia` (Task 2), existing `apiFetch`, existing `productos` state, existing `renglones`/`setRenglones`.

- [ ] **Step 1: Add new state**

In `src/RecepcionCompras.jsx`, right after the existing line:

```js
  const [productoIdsDeXml, setProductoIdsDeXml] = useState([]); // producto_ids que vinieron de la última importación XML confirmada
```

add:

```js
  const [iaParseado, setIaParseado] = useState(null); // resultado de importar-ia: { conceptos: [...] }
  const [matchesIa, setMatchesIa] = useState({}); // { [indiceConcepto]: producto_id | null }
  const [confirmadosIa, setConfirmadosIa] = useState({}); // { [indiceConcepto]: true }
  const [cargandoIa, setCargandoIa] = useState(false);
  const [errorLegibilidadIa, setErrorLegibilidadIa] = useState(null); // mensaje si el documento no fue legible
```

- [ ] **Step 2: Add the base64 file reader and upload handler**

Right after the existing `leerArchivoXml` function (ends with the closing of its `FileReader` callback and `lector.readAsText(archivo);` call), add:

```js
  const leerArchivoFacturaImagen = (archivo) => {
    setCargandoIa(true);
    setErrorLegibilidadIa(null);
    const lector = new FileReader();
    lector.onload = async () => {
      try {
        const contenido_base64 = String(lector.result).split(",")[1];
        const r = await apiFetch(`/compras/importar-ia`, {
          method: "POST",
          body: JSON.stringify({ archivo_base64: contenido_base64, tipo_mime: archivo.type }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        setIaParseado(data);
        setMatchesIa({});
        setConfirmadosIa({});
      } catch (err) {
        setErrorLegibilidadIa(err.message);
      } finally {
        setCargandoIa(false);
      }
    };
    lector.readAsDataURL(archivo);
  };
```

- [ ] **Step 3: Add the confirmation handler**

Right after the existing `confirmarImportacionXml` function (ends with `setModal(null);` and its closing brace), add:

```js
  const confirmarImportacionIa = () => {
    const nuevos = iaParseado.conceptos
      .map((c, idx) => ({ concepto: c, producto_id: matchesIa[idx], idx }))
      .filter((x) => x.producto_id && confirmadosIa[x.idx] === true);
    if (nuevos.length === 0) return mostrarAviso("Confirma al menos un producto antes de continuar");

    setRenglones((prev) => {
      const copia = [...prev];
      nuevos.forEach(({ concepto, producto_id }) => {
        const idx = copia.findIndex((r) => r.producto_id === producto_id);
        const renglon = {
          producto_id,
          cantidad: concepto.cantidad,
          costo: concepto.costo_unitario,
          descuento_pesos: 0,
          descuento_porcentaje: 0,
          clave_sat: productoDe(producto_id)?.clave_sat || "",
          localizacion: productoDe(producto_id)?.localizacion || "",
          aplicaIva: concepto.aplica_iva,
          neto: true,
          precios: productoDe(producto_id)?.precios,
        };
        if (idx >= 0) copia[idx] = renglon; else copia.push(renglon);
      });
      return copia;
    });
    mostrarAviso(`${nuevos.length} producto(s) agregado(s) desde el documento escaneado`);
    setIaParseado(null);
    setMatchesIa({});
    setConfirmadosIa({});
    setModal(null);
  };
```

- [ ] **Step 4: Add the keyboard shortcut**

In `src/RecepcionCompras.jsx`, find:

```js
      else if (e.key === "F8" && !dentroDeModal) { e.preventDefault(); setModal("importarXml"); }
```

and add right after it:

```js
      else if (e.key === "F9" && !dentroDeModal) { e.preventDefault(); setModal("importarIa"); }
```

- [ ] **Step 5: Add the toolbar button**

In `src/RecepcionCompras.jsx`, find:

```jsx
            <BotonBarra icono={FileCode} etiqueta="Imp. XML" atajo="F8" onClick={() => setModal("importarXml")} />
            <BotonBarra icono={ClipboardList} etiqueta="Pedido" atajo="F10" onClick={() => mostrarAviso("Pedido — próximamente")} />
```

and change it to:

```jsx
            <BotonBarra icono={FileCode} etiqueta="Imp. XML" atajo="F8" onClick={() => setModal("importarXml")} />
            <BotonBarra icono={ScanLine} etiqueta="Escanear IA" atajo="F9" onClick={() => setModal("importarIa")} />
            <BotonBarra icono={ClipboardList} etiqueta="Pedido" atajo="F10" onClick={() => mostrarAviso("Pedido — próximamente")} />
```

Add `ScanLine` to the existing `lucide-react` import at the top of the file:

```js
import {
  Search, Edit3, Hash, Ban, Percent, FileCode, ClipboardList,
  X, Plus, Minus, Package, Truck, Users, FileMinus, Clock, RotateCcw,
  History, ChevronLeft, ChevronRight, ScanLine
} from "lucide-react";
```

- [ ] **Step 6: Add the modal**

In `src/RecepcionCompras.jsx`, find the closing of the existing XML modal block:

```jsx
      {modal === "importarXml" && (
        <Modal titulo="Importar factura XML (F8)" onCerrar={() => { setModal(null); setXmlParseado(null); }} ancho="max-w-3xl">
          ...
        </Modal>
      )}
```

and add right after its closing `)}`:

```jsx
      {modal === "importarIa" && (
        <Modal titulo="Escanear Factura con IA (F9)" onCerrar={() => { setModal(null); setIaParseado(null); setErrorLegibilidadIa(null); }} ancho="max-w-3xl">
          {!iaParseado ? (
            <div className="text-center py-10">
              <input
                type="file" accept=".pdf,.jpg,.jpeg,.png"
                onChange={(e) => e.target.files[0] && leerArchivoFacturaImagen(e.target.files[0])}
                className="mb-3"
              />
              {cargandoIa && <p className="text-slate-400 text-sm">Leyendo documento con IA...</p>}
              {errorLegibilidadIa && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3 mt-3 mx-auto max-w-md">
                  ❌ {errorLegibilidadIa}
                </p>
              )}
              <p className="text-xs text-slate-400 mt-2">Sube una foto o PDF de la factura o nota de remisión del proveedor.</p>
            </div>
          ) : (
            <div>
              <div className="bg-amber-50 border border-amber-200 rounded p-2 mb-3 text-xs text-amber-700">
                Estos datos los leyó una IA a partir de una imagen/PDF — revisa cada línea antes de confirmar, especialmente el costo.
              </div>
              <table className="w-full text-sm border border-slate-200 rounded overflow-hidden mb-3">
                <thead className="bg-[#1a7fe8] text-white">
                  <tr>
                    <th className="py-2 px-2 text-left font-medium">Descripción (leída por IA)</th>
                    <th className="py-2 px-2 text-center font-medium w-16">Cant.</th>
                    <th className="py-2 px-2 text-right font-medium w-24">Costo</th>
                    <th className="py-2 px-2 text-left font-medium">Producto en tu catálogo</th>
                    <th className="py-2 px-2 text-center font-medium w-24">Confirmar</th>
                  </tr>
                </thead>
                <tbody>
                  {iaParseado.conceptos.map((c, idx) => (
                    <tr key={idx} className="border-b border-slate-100">
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
                      <td className="py-2 px-2 text-center">
                        <label className="inline-flex items-center gap-1 text-xs text-slate-600">
                          <input
                            type="checkbox"
                            checked={!!confirmadosIa[idx]}
                            onChange={(e) => setConfirmadosIa((prev) => ({ ...prev, [idx]: e.target.checked }))}
                          />
                          Confirmar
                        </label>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex gap-2">
                <button onClick={() => { setIaParseado(null); setMatchesIa({}); setConfirmadosIa({}); }} className="flex-1 border border-slate-300 text-slate-600 py-2 rounded font-medium hover:bg-slate-50">Cancelar</button>
                <button onClick={confirmarImportacionIa} className="flex-1 bg-blue-700 hover:bg-blue-800 text-white py-2 rounded font-semibold">Agregar a la recepción</button>
              </div>
            </div>
          )}
        </Modal>
      )}
```

- [ ] **Step 7: Verify the build**

Run: `npm run build` from the repo root.
Expected: No syntax errors, `✓ built in ...`.

- [ ] **Step 8: Commit**

```bash
git add src/RecepcionCompras.jsx
git commit -m "feat: add Escanear Factura (IA) button and confirmation modal to Recepcion de Compras"
```

---

### Task 4: Manual end-to-end verification with a real document

This task has no code changes — Victor explicitly wants to test this with a real photo/PDF before anything else, per the spec's testing section (no automated frontend harness in this project).

- [ ] **Step 1: Run the app locally**

Start the backend (`cd backend && node server.js`, with a real `ANTHROPIC_API_KEY` in `.env`) and the frontend (`npm run dev` from the repo root). Log in and go to Inventario y Productos → Recepción de Compras.

- [ ] **Step 2: Test a legible document**

Take a real photo (or use a real PDF) of a supplier invoice or delivery note with several line items. Click "Escanear IA" (F9), upload it. Confirm:
- The table shows a row per product with a plausible description, quantity, and cost.
- Lines Claude matched confidently line up with real products in the description; lines with no obvious match show "Sin vincular".
- Checking "Confirmar" on a subset and clicking "Agregar a la recepción" adds only those rows to the main table, with the read cost as `Precio U.` and the sale-price tiers unchanged from whatever the matched product already had configured.

- [ ] **Step 3: Test a deliberately illegible document**

Take a very blurry photo, or a photo of an unrelated blank page, upload it via the same button. Confirm the modal shows a clear error message and **no table at all** — nothing to accidentally confirm.

- [ ] **Step 4: Confirm IVA detection**

Using a document where some lines clearly show tax and others don't (or a plain receipt with no IVA breakdown at all), confirm the "IVA" badge appears only on lines Claude judged as IVA-applicable, and that after adding those lines to the receipt, the existing IVA total (from the `worktree-fix-iva-compras` fix already merged) reflects them correctly in the receipt's grand total.

- [ ] **Step 5: Report findings to Victor**

Since this is the step Victor explicitly asked to reach quickly ("empecemos a realizar pruebas con eso"), report back plainly what worked, what didn't, and any adjustment needed — per his own framing, changes after this point are expected and fine.
