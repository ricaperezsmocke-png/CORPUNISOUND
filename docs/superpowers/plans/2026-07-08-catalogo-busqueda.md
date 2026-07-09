# Buscador de productos + catálogos de Proveedores y Departamentos — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Traspasos y Punto de Venta ganan un buscador de productos idéntico visualmente (texto + filtros de categoría/departamento/proveedor + paginación), y en Inventario y Productos se puede dar de alta un Proveedor o Departamento nuevo al vuelo, igual que ya funciona Categoría.

**Architecture:** Departamento pasa de texto libre a catálogo real (`{ id, nombre }`, igual que categorías), con `departamento_id` en el producto y resolución con caída al texto legado para no romper datos existentes. Proveedor gana alta rápida reutilizando el catálogo que ya existía (solo le faltaba el `POST`). El buscador de Traspasos reutiliza el mismo patrón visual/funcional que ya existe en Punto de Venta (componente `Modal` local + filtros + tabla paginada), adaptado para mostrar la existencia de la sucursal origen del traspaso.

**Tech Stack:** Node.js + Express (backend, datos en memoria), React + Vite (frontend), pruebas con el runner integrado de Node (`node --test`) para el backend. El frontend no tiene runner de pruebas automatizadas en este repo (ya era así antes de este plan) — su verificación es `npm run build` + revisión de cableado, igual que se hizo en el plan de Traspasos.

## Global Constraints

- **Sin migración forzosa de `departamento`:** los productos que ya existen con el string legado `departamento` siguen mostrando ese texto (vía `departamento_nombre` resuelto en `listarProductos`); no se crea una entrada de catálogo automáticamente por cada texto distinto que haya en datos existentes.
- **Alta rápida de Proveedor/Departamento usa el permiso `crear_producto` ya existente** — no se crean permisos nuevos.
- **Sin dependencias nuevas.**
- **Idioma:** todo el código, comentarios y mensajes en español, siguiendo el estilo de los archivos existentes.
- **Buscador de Traspasos usa la existencia de la sucursal ORIGEN**, no una suma global — se vuelve a pedir el catálogo de productos cada vez que cambia la sucursal origen efectiva.

---

### Task 1: Backend — catálogo de Departamentos + alta de Proveedores

**Files:**
- Modify: `backend/productos.js` (nuevas funciones, `module.exports`)
- Modify: `backend/testHelpers.js` (agregar `departamentos: []` al fixture)
- Create: `backend/catalogosProveedorDepartamento.test.js`

**Interfaces:**
- Consumes: `siguienteId` (helper local ya existente en `productos.js`).
- Produces:
  - `listarDepartamentos(DB)` → `DB["catalogo-productos"].departamentos`.
  - `crearDepartamento(DB, nombre)` → `{ id, nombre }`, rechaza nombre vacío.
  - `crearProveedor(DB, nombre)` → `{ id, nombre, contacto: "", tiempo_entrega_dias: 0, condiciones_pago: "" }`, rechaza nombre vacío.

- [ ] **Step 1: Agregar `departamentos: []` al fixture de pruebas**

En `backend/testHelpers.js:57-70`, dentro de `"catalogo-productos"`, agregar la clave `departamentos` justo antes de `proveedores`:

```js
    "catalogo-productos": {
      productos: [
        { id: 1, sku: "AB-001", nombre: "Arroz 1kg", categoria_id: 1, precio_venta: 25, activo: true },
        { id: 2, sku: "BE-001", nombre: "Refresco 600ml", categoria_id: 2, precio_venta: 16, activo: true },
        { id: 3, sku: "LI-001", nombre: "Detergente 1L", categoria_id: 3, precio_venta: 32, activo: true },
      ],
      categorias: [
        { id: 1, nombre: "Abarrotes", categoria_padre_id: null },
        { id: 2, nombre: "Bebidas", categoria_padre_id: null },
        { id: 3, nombre: "Limpieza", categoria_padre_id: null },
      ],
      departamentos: [],
      proveedores: [],
      producto_proveedor: [],
    },
```

- [ ] **Step 2: Escribir las pruebas (fallan primero)**

Crear `backend/catalogosProveedorDepartamento.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { listarDepartamentos, crearDepartamento, crearProveedor } = require("./productos");

test("listarDepartamentos arranca vacío y crearDepartamento agrega uno nuevo", () => {
  const DB = construirDBPrueba();
  assert.strictEqual(listarDepartamentos(DB).length, 0);
  const nuevo = crearDepartamento(DB, "Cuerdas y Accesorios");
  assert.strictEqual(nuevo.nombre, "Cuerdas y Accesorios");
  assert.ok(nuevo.id);
  assert.strictEqual(listarDepartamentos(DB).length, 1);
});

test("crearDepartamento rechaza nombre vacío", () => {
  const DB = construirDBPrueba();
  assert.throws(() => crearDepartamento(DB, ""), /nombre del departamento/);
  assert.throws(() => crearDepartamento(DB, "   "), /nombre del departamento/);
});

test("crearProveedor crea con nombre y campos secundarios por defecto", () => {
  const DB = construirDBPrueba();
  const nuevo = crearProveedor(DB, "Distribuidora Nueva");
  assert.strictEqual(nuevo.nombre, "Distribuidora Nueva");
  assert.strictEqual(nuevo.contacto, "");
  assert.strictEqual(nuevo.tiempo_entrega_dias, 0);
  assert.strictEqual(nuevo.condiciones_pago, "");
  assert.ok(DB["catalogo-productos"].proveedores.some((p) => p.id === nuevo.id));
});

test("crearProveedor rechaza nombre vacío", () => {
  const DB = construirDBPrueba();
  assert.throws(() => crearProveedor(DB, ""), /nombre del proveedor/);
});
```

- [ ] **Step 3: Correr y verificar que falla**

Run: `cd backend && node --test catalogosProveedorDepartamento.test.js`
Expected: FAIL — `listarDepartamentos is not a function` (no existe todavía).

- [ ] **Step 4: Implementar en `backend/productos.js`**

Agregar, después de `crearCategoria` (antes de `module.exports`):

```js
function listarDepartamentos(DB) {
  return DB["catalogo-productos"].departamentos;
}

function crearDepartamento(DB, nombre) {
  if (!nombre || !nombre.trim()) throw new Error("El nombre del departamento es obligatorio");
  const nuevo = { id: siguienteId(DB["catalogo-productos"].departamentos), nombre: nombre.trim() };
  DB["catalogo-productos"].departamentos.push(nuevo);
  return nuevo;
}

function crearProveedor(DB, nombre) {
  if (!nombre || !nombre.trim()) throw new Error("El nombre del proveedor es obligatorio");
  const nuevo = { id: siguienteId(DB["catalogo-productos"].proveedores), nombre: nombre.trim(), contacto: "", tiempo_entrega_dias: 0, condiciones_pago: "" };
  DB["catalogo-productos"].proveedores.push(nuevo);
  return nuevo;
}
```

Y actualizar `module.exports` para incluir las tres funciones nuevas:

```js
module.exports = {
  listarProductos,
  crearProducto,
  actualizarProducto,
  eliminarProducto,
  clonarProducto,
  ajustarExistencia,
  listarCategorias,
  crearCategoria,
  listarDepartamentos,
  crearDepartamento,
  crearProveedor,
  generarClave,
};
```

- [ ] **Step 5: Correr y verificar que pasa**

Run: `cd backend && node --test catalogosProveedorDepartamento.test.js`
Expected: PASS — 4 tests passing.

Run: `cd backend && npm test`
Expected: PASS — todas las suites existentes siguen en verde (el fixture ganó una clave nueva, `departamentos: []`, que no debería afectar pruebas que no la usan).

- [ ] **Step 6: Commit**

```bash
git add backend/productos.js backend/testHelpers.js backend/catalogosProveedorDepartamento.test.js
git commit -m "feat: catálogo de departamentos + alta de proveedores"
```

---

### Task 2: Backend — productos usan `departamento_id` (con caída al texto legado)

**Files:**
- Modify: `backend/productos.js` (`crearProducto`, `actualizarProducto`, `clonarProducto`, `listarProductos`)
- Create: `backend/departamentoProducto.test.js`

**Interfaces:**
- Consumes: `listarDepartamentos`/`crearDepartamento` (Task 1).
- Produces:
  - `crearProducto(DB, datos, sucursalId)`: `datos.departamento_id` (en vez de `datos.departamento` de texto) se guarda como `departamento_id` (`Number(...)` o `null`).
  - `actualizarProducto(DB, id, datos, sucursalId)`: igual, actualiza `departamento_id`.
  - `clonarProducto`: propaga `departamento_id` del original.
  - `listarProductos(DB, sucursalId)`: cada producto trae `departamento_nombre` — resuelto del catálogo si tiene `departamento_id`; si no, cae al string legado `departamento` (dato viejo, sin tocar); si tampoco hay nada, `"Sin definir"`.

- [ ] **Step 1: Escribir las pruebas (fallan primero)**

Crear `backend/departamentoProducto.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { crearProducto, actualizarProducto, clonarProducto, listarProductos, crearDepartamento } = require("./productos");

test("crearProducto con departamento_id resuelve el nombre desde el catálogo", () => {
  const DB = construirDBPrueba();
  const depto = crearDepartamento(DB, "Cuerdas y Accesorios");
  const nuevoId = crearProducto(DB, { descripcion: "Cuerdas de guitarra", departamento_id: depto.id }, 1).id;
  const producto = listarProductos(DB, 1).find((p) => p.id === nuevoId);
  assert.strictEqual(producto.departamento_id, depto.id);
  assert.strictEqual(producto.departamento_nombre, "Cuerdas y Accesorios");
});

test("crearProducto sin departamento_id queda en null y muestra 'Sin definir'", () => {
  const DB = construirDBPrueba();
  const nuevoId = crearProducto(DB, { descripcion: "Producto sin depto" }, 1).id;
  const producto = listarProductos(DB, 1).find((p) => p.id === nuevoId);
  assert.strictEqual(producto.departamento_id, null);
  assert.strictEqual(producto.departamento_nombre, "Sin definir");
});

test("listarProductos cae al texto legado en productos ya existentes sin departamento_id", () => {
  const DB = construirDBPrueba();
  // Simula un producto creado ANTES de este cambio: solo tiene el string `departamento`.
  DB["catalogo-productos"].productos.push({
    id: 999, sku: "LEGADO-1", nombre: "Producto legado", categoria_id: null,
    departamento: "Ferretería", proveedor_id: null, precio_venta: 10, costo: 5,
    precios: [], activo: true,
  });
  const producto = listarProductos(DB, 1).find((p) => p.id === 999);
  assert.strictEqual(producto.departamento_nombre, "Ferretería");
});

test("actualizarProducto cambia departamento_id", () => {
  const DB = construirDBPrueba();
  const depto = crearDepartamento(DB, "Percusiones");
  const nuevoId = crearProducto(DB, { descripcion: "Batería", departamento_id: null }, 1).id;
  actualizarProducto(DB, nuevoId, { departamento_id: depto.id }, 1);
  const producto = listarProductos(DB, 1).find((p) => p.id === nuevoId);
  assert.strictEqual(producto.departamento_nombre, "Percusiones");
});

test("clonarProducto propaga el departamento_id del original", () => {
  const DB = construirDBPrueba();
  const depto = crearDepartamento(DB, "Vientos");
  const originalId = crearProducto(DB, { descripcion: "Trompeta", departamento_id: depto.id }, 1).id;
  const clon = clonarProducto(DB, originalId, 1);
  assert.strictEqual(clon.departamento_id, depto.id);
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd backend && node --test departamentoProducto.test.js`
Expected: FAIL — hoy `crearProducto` guarda `departamento` de texto, no `departamento_id`, así que `producto.departamento_nombre` no existe (`undefined !== "Cuerdas y Accesorios"`).

- [ ] **Step 3: Modificar `crearProducto`**

En `backend/productos.js`, reemplazar la línea del campo `departamento` dentro del objeto `producto`:

```js
    departamento_id: datos.departamento_id ? Number(datos.departamento_id) : null,
```

(reemplaza la línea `departamento: datos.departamento || "Sin definir",`)

- [ ] **Step 4: Modificar `actualizarProducto`**

Reemplazar la línea correspondiente dentro del objeto `actualizado`:

```js
    departamento_id: datos.departamento_id !== undefined ? (Number(datos.departamento_id) || null) : actual.departamento_id,
```

(reemplaza la línea `departamento: datos.departamento ?? actual.departamento,`)

- [ ] **Step 5: Modificar `clonarProducto`**

Reemplazar la línea correspondiente dentro del objeto que se pasa a `crearProducto`:

```js
    departamento_id: original.departamento_id,
```

(reemplaza la línea `departamento: original.departamento,`)

- [ ] **Step 6: Modificar `listarProductos`**

Agregar la resolución de departamento justo después de la línea de `categoria` y agregar `departamento_nombre` al objeto de retorno:

```js
    const categoria = DB["catalogo-productos"].categorias.find((c) => c.id === p.categoria_id);
    const departamento = DB["catalogo-productos"].departamentos.find((d) => d.id === p.departamento_id);
    return {
      ...p,
      codigo: p.clave_alterna || p.sku,
      ubicacion: p.ubicacion || "-",
      promocion: !!p.promocion,
      existencia: exist ? exist.cantidad_actual : 0,
      existencia_minima: exist ? exist.cantidad_minima : 0,
      existencia_maxima: exist ? exist.cantidad_maxima : 0,
      categoria_nombre: categoria ? categoria.nombre : "Sin definir",
      departamento_nombre: departamento ? departamento.nombre : (p.departamento || "Sin definir"),
    };
```

- [ ] **Step 7: Correr y verificar que pasa**

Run: `cd backend && node --test departamentoProducto.test.js`
Expected: PASS — 5 tests passing.

Run: `cd backend && npm test`
Expected: PASS — todas las suites (Task 1 y Task 2) en verde.

- [ ] **Step 8: Commit**

```bash
git add backend/productos.js backend/departamentoProducto.test.js
git commit -m "feat: productos usan departamento_id, con caída al texto legado en listarProductos"
```

---

### Task 3: Backend — rutas HTTP de Departamentos y Proveedores

**Files:**
- Modify: `backend/server.js`

**Interfaces:**
- Consumes: `listarDepartamentos`, `crearDepartamento`, `crearProveedor` (Task 1).
- Produces: `GET/POST /api/departamentos`, `POST /api/proveedores` (el `GET` ya existía).

- [ ] **Step 1: Importar las funciones nuevas**

En `backend/server.js`, en el import de `./productos` (línea ~20-23), agregar `listarDepartamentos, crearDepartamento, crearProveedor` a la lista desestructurada:

```js
const {
  listarProductos, crearProducto, actualizarProducto, eliminarProducto,
  clonarProducto, ajustarExistencia, listarCategorias, crearCategoria,
  listarDepartamentos, crearDepartamento, crearProveedor, generarClave
} = require("./productos");
```

- [ ] **Step 2: Agregar `departamentos: []` al seed de `catalogo-productos`**

En el `DB` hardcodeado de `server.js`, dentro de `"catalogo-productos"`, agregar la clave `departamentos: []` (mismo nivel que `categorias`/`proveedores`/`producto_proveedor`):

```js
    proveedores: [
      { id: 1, nombre: "Distribuidora del Norte", contacto: "555-111", tiempo_entrega_dias: 5, condiciones_pago: "30 días" },
      { id: 2, nombre: "Importadora Sureste", contacto: "555-222", tiempo_entrega_dias: 10, condiciones_pago: "Contado" },
      { id: 3, nombre: "Proveedor Local Chiapas", contacto: "555-333", tiempo_entrega_dias: 2, condiciones_pago: "15 días" }
    ],
    departamentos: [],
    producto_proveedor: []
  },
```

- [ ] **Step 3: Agregar las rutas**

Justo después de `app.get("/api/proveedores", ...)`, agregar:

```js
app.post("/api/proveedores", requiereLogin, requierePermiso("crear_producto", resolverPermisosDeRol), (req, res) => {
  try { res.json(crearProveedor(DB, req.body.nombre)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.get("/api/departamentos", (req, res) => res.json(listarDepartamentos(DB)));
app.post("/api/departamentos", requiereLogin, requierePermiso("crear_producto", resolverPermisosDeRol), (req, res) => {
  try { res.json(crearDepartamento(DB, req.body.nombre)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
```

- [ ] **Step 4: Correr toda la suite de backend**

Run: `cd backend && npm test`
Expected: PASS — todas las suites en verde.

- [ ] **Step 5: Verificación manual end-to-end**

Levantar el backend en una base de datos temporal:

```bash
cd backend
DB_PATH=/tmp/verify_catalogos.sqlite PORT=4323 JWT_SECRET=verify-secret node server.js
```

En otra terminal:

```bash
BASE=http://localhost:4323
curl -s -X POST $BASE/api/auth/setup-inicial -H "Content-Type: application/json" -d '{"nombre":"Admin","usuario":"admin","password":"Admin1234"}'
TOKEN=$(curl -s -X POST $BASE/api/auth/login -H "Content-Type: application/json" -d '{"usuario":"admin","password":"Admin1234"}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).token))")

curl -s $BASE/api/departamentos
curl -s -X POST $BASE/api/departamentos -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"nombre":"Cuerdas y Accesorios"}'
curl -s $BASE/api/departamentos

curl -s -X POST $BASE/api/proveedores -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"nombre":"Nuevo Proveedor Test"}'
curl -s $BASE/api/proveedores
```

Expected:
- `GET /api/departamentos` antes de crear: `[]`.
- `POST /api/departamentos` devuelve `{"id":1,"nombre":"Cuerdas y Accesorios"}`.
- `GET /api/departamentos` después: incluye el nuevo.
- `POST /api/proveedores` devuelve el proveedor nuevo con `contacto:"", tiempo_entrega_dias:0, condiciones_pago:""`.
- `GET /api/proveedores` después: incluye los 3 originales + el nuevo.

Detener el servidor (`Ctrl+C`) y borrar `/tmp/verify_catalogos.sqlite`.

- [ ] **Step 6: Commit**

```bash
git add backend/server.js
git commit -m "feat: rutas HTTP de departamentos (catálogo) y alta de proveedores"
```

---

### Task 4: Frontend — Inventario y Productos: alta rápida de Proveedor y Departamento

**Files:**
- Modify: `src/InventarioProductos.jsx`

**Interfaces:**
- Consumes: `GET/POST /api/departamentos`, `POST /api/proveedores` (Task 3); `producto.departamento_id` (Task 2).

- [ ] **Step 1: Cambiar `FORM_VACIO`**

Reemplazar `FORM_VACIO` (`src/InventarioProductos.jsx:37-46`):

```js
const FORM_VACIO = {
  clave: "", clave_alterna: "", servicio: false, descripcion: "",
  categoria_id: "", departamento_id: "", proveedor_id: "",
  unidad_compra: "PZA", unidad_venta: "PZA", factor: 1,
  iva: false, precio_compra: "", neto: true,
  precios: [{ utilidad: "", precioVenta: 0 }, { utilidad: "", precioVenta: 0 }, { utilidad: "", precioVenta: 0 }, { utilidad: "", precioVenta: 0 }],
  unidades_por_mayoreo: 0,
  existencia_inicial: 0, existencia_minima: 0, existencia_maxima: 0,
  imagen_url: "",
};
```

- [ ] **Step 2: Nuevo estado `departamentos`**

Después de `const [proveedores, setProveedores] = useState([]);` (línea 52), agregar:

```js
  const [departamentos, setDepartamentos] = useState([]);
```

- [ ] **Step 3: `cargarTodo` carga también departamentos**

Reemplazar `cargarTodo` (líneas 68-84):

```js
  const cargarTodo = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const [rProd, rCat, rProv, rDep] = await Promise.all([
        apiFetch(`/productos`), apiFetch(`/categorias`), apiFetch(`/proveedores`), apiFetch(`/departamentos`)
      ]);
      if (!rProd.ok || !rCat.ok || !rProv.ok || !rDep.ok) throw new Error("El backend respondió con error");
      setProductos(await rProd.json());
      setCategorias(await rCat.json());
      setProveedores(await rProv.json());
      setDepartamentos(await rDep.json());
    } catch (e) {
      setError("No se pudo conectar con el backend (http://localhost:4000). ¿Está corriendo `npm start` dentro de /backend?");
    } finally {
      setCargando(false);
    }
  }, []);
```

- [ ] **Step 4: `abrirEditar` precarga `departamento_id`**

En `abrirEditar` (línea 113), reemplazar:

```js
      categoria_id: seleccionado.categoria_id || "", departamento_id: seleccionado.departamento_id || "",
```

(reemplaza `categoria_id: seleccionado.categoria_id || "", departamento: seleccionado.departamento || "",`)

- [ ] **Step 5: `guardarProducto` manda `departamento_id`**

Reemplazar la línea del `payload` dentro de `guardarProducto` (línea 166):

```js
      const payload = { ...form, categoria_id: form.categoria_id || null, proveedor_id: form.proveedor_id || null, departamento_id: form.departamento_id || null };
```

- [ ] **Step 6: Agregar `crearProveedorRapido` y `crearDepartamentoRapido`**

Justo después de `crearCategoriaRapida` (después de la línea 236), agregar:

```js
  const crearProveedorRapido = async () => {
    const nombre = prompt("Nombre del nuevo proveedor:");
    if (!nombre) return;
    try {
      const r = await apiFetch(`/proveedores`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nombre }) });
      const nuevo = await r.json();
      if (!r.ok) throw new Error(nuevo.error);
      setProveedores((prev) => [...prev, nuevo]);
      setForm((f) => ({ ...f, proveedor_id: nuevo.id }));
    } catch (e) { mostrarAviso("❌ " + e.message); }
  };

  const crearDepartamentoRapido = async () => {
    const nombre = prompt("Nombre del nuevo departamento:");
    if (!nombre) return;
    try {
      const r = await apiFetch(`/departamentos`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nombre }) });
      const nuevo = await r.json();
      if (!r.ok) throw new Error(nuevo.error);
      setDepartamentos((prev) => [...prev, nuevo]);
      setForm((f) => ({ ...f, departamento_id: nuevo.id }));
    } catch (e) { mostrarAviso("❌ " + e.message); }
  };
```

- [ ] **Step 7: Actualizar los campos del formulario (Categoría / Proveedor / Departamento)**

Reemplazar el bloque (líneas 408-427):

```jsx
              <div className="grid grid-cols-3 gap-3">
                <Campo label="Categoría">
                  <div className="flex gap-1">
                    <select className={inputCls} value={form.categoria_id} onChange={(e) => setForm({ ...form, categoria_id: e.target.value })}>
                      <option value="">Sin definir</option>
                      {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                    </select>
                    <button onClick={crearCategoriaRapida} className="bg-emerald-600 hover:bg-emerald-700 text-white rounded px-2" title="Nueva categoría"><Plus size={14} /></button>
                  </div>
                </Campo>
                <Campo label="Proveedor">
                  <div className="flex gap-1">
                    <select className={inputCls} value={form.proveedor_id} onChange={(e) => setForm({ ...form, proveedor_id: e.target.value })}>
                      <option value="">Sin definir</option>
                      {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                    </select>
                    <button onClick={crearProveedorRapido} className="bg-emerald-600 hover:bg-emerald-700 text-white rounded px-2" title="Nuevo proveedor"><Plus size={14} /></button>
                  </div>
                </Campo>
                <Campo label="Departamento">
                  <div className="flex gap-1">
                    <select className={inputCls} value={form.departamento_id} onChange={(e) => setForm({ ...form, departamento_id: e.target.value })}>
                      <option value="">Sin definir</option>
                      {departamentos.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
                    </select>
                    <button onClick={crearDepartamentoRapido} className="bg-emerald-600 hover:bg-emerald-700 text-white rounded px-2" title="Nuevo departamento"><Plus size={14} /></button>
                  </div>
                </Campo>
              </div>
```

- [ ] **Step 8: Verificación manual**

Run: `npm run build` desde la raíz del repo.
Expected: build limpio, sin errores relacionados a `InventarioProductos.jsx`.

Revisión de cableado (sin navegador disponible en este entorno): confirmar que `departamentos`/`proveedores` se leen del estado en el JSX (no de una lista hardcodeada), que `crearProveedorRapido`/`crearDepartamentoRapido` siguen exactamente el mismo patrón que `crearCategoriaRapida` (mismo manejo de error, mismo `setForm` para autoseleccionar lo recién creado).

- [ ] **Step 9: Commit**

```bash
git add src/InventarioProductos.jsx
git commit -m "feat: alta rápida de Proveedor y Departamento en Inventario y Productos"
```

---

### Task 5: Frontend — Punto de Venta: filtro de departamento por catálogo + filtro de proveedor

**Files:**
- Modify: `src/PuntoDeVenta.jsx`

**Interfaces:**
- Consumes: `GET /api/departamentos`, `GET /api/proveedores` (Task 3); `producto.departamento_id`/`producto.proveedor_id` (ya existente/Task 2).

- [ ] **Step 1: Nuevo estado para departamentos (catálogo) y proveedores**

Reemplazar la línea 100 (`const [categorias, setCategorias] = useState([]);`):

```js
  const [categorias, setCategorias] = useState([]);
  const [departamentos, setDepartamentos] = useState([]);
  const [proveedores, setProveedores] = useState([]);
```

Y agregar el filtro de proveedor junto a los demás filtros (línea 117, después de `filtroCategoria`):

```js
  const [filtroDepartamento, setFiltroDepartamento] = useState("");
  const [filtroCategoria, setFiltroCategoria] = useState("");
  const [filtroProveedor, setFiltroProveedor] = useState("");
```

- [ ] **Step 2: Cargar departamentos y proveedores del backend**

Después de `cargarCategorias` (línea 167-172), agregar:

```js
  const cargarDepartamentos = useCallback(async () => {
    try {
      const r = await apiFetch(`/departamentos`);
      if (r.ok) setDepartamentos(await r.json());
    } catch { /* silencioso */ }
  }, []);

  const cargarProveedores = useCallback(async () => {
    try {
      const r = await apiFetch(`/proveedores`);
      if (r.ok) setProveedores(await r.json());
    } catch { /* silencioso */ }
  }, []);
```

Y actualizar el `useEffect` de carga inicial (línea 201):

```js
  useEffect(() => { cargarProductos(); cargarClientes(); cargarCategorias(); cargarDepartamentos(); cargarProveedores(); cargarCondicionesPago(); cargarConfiguracion(); }, [cargarProductos, cargarClientes, cargarCategorias, cargarDepartamentos, cargarProveedores, cargarCondicionesPago, cargarConfiguracion]);
```

- [ ] **Step 3: Eliminar el `useMemo` de departamentos derivados por texto**

Eliminar por completo este bloque (líneas 460-463) — ya no hace falta, los departamentos vienen del catálogo real cargado en el Step 2:

```js
  const departamentos = useMemo(
    () => [...new Set(productos.map((p) => p.departamento).filter(Boolean))],
    [productos]
  );
```

- [ ] **Step 4: Filtrar por `departamento_id` y agregar filtro de proveedor**

Reemplazar `productosFiltrados` (líneas 465-477):

```js
  const productosFiltrados = useMemo(() => {
    let lista = productos.filter(
      (p) =>
        p.nombre.toLowerCase().includes(busquedaTexto.toLowerCase()) ||
        p.sku.toLowerCase().includes(busquedaTexto.toLowerCase()) ||
        (p.codigo || "").includes(busquedaTexto)
    );
    if (filtroDepartamento) lista = lista.filter((p) => String(p.departamento_id) === filtroDepartamento);
    if (filtroCategoria) lista = lista.filter((p) => String(p.categoria_id) === filtroCategoria);
    if (filtroProveedor) lista = lista.filter((p) => String(p.proveedor_id) === filtroProveedor);
    if (soloPromos) lista = lista.filter((p) => p.promocion);
    if (sinUtilidad) lista = lista.filter((p) => Number(p.precio_venta) <= Number(p.costo));
    return lista;
  }, [productos, busquedaTexto, filtroDepartamento, filtroCategoria, filtroProveedor, soloPromos, sinUtilidad]);
```

- [ ] **Step 5: Actualizar los `<select>` del modal "Buscar Artículo"**

Reemplazar el bloque de selects (líneas 747-754):

```jsx
            <select value={filtroDepartamento} onChange={(e) => { setFiltroDepartamento(e.target.value); setPaginaBusqueda(1); }} className="border border-slate-300 rounded px-2 py-1 text-xs">
              <option value="">Todos los departamentos</option>
              {departamentos.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
            </select>
            <select value={filtroCategoria} onChange={(e) => { setFiltroCategoria(e.target.value); setPaginaBusqueda(1); }} className="border border-slate-300 rounded px-2 py-1 text-xs">
              <option value="">Todas las categorías</option>
              {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
            <select value={filtroProveedor} onChange={(e) => { setFiltroProveedor(e.target.value); setPaginaBusqueda(1); }} className="border border-slate-300 rounded px-2 py-1 text-xs">
              <option value="">Todos los proveedores</option>
              {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
```

- [ ] **Step 6: Verificación manual**

Run: `npm run build` desde la raíz del repo.
Expected: build limpio, sin errores relacionados a `PuntoDeVenta.jsx`.

Revisión de cableado: confirmar que ya no queda ninguna referencia a la variable `departamentos` derivada por `useMemo` de texto (debe haber sido reemplazada enteramente por el estado cargado del backend), y que el filtro de departamento compara por `departamento_id` (número), no por el string de antes.

- [ ] **Step 7: Commit**

```bash
git add src/PuntoDeVenta.jsx
git commit -m "feat: Punto de Venta filtra departamento por catálogo real + nuevo filtro de proveedor"
```

---

### Task 6: Frontend — Traspasos: buscador de productos idéntico al de Punto de Venta

**Files:**
- Modify: `src/Traspasos.jsx`

**Interfaces:**
- Consumes: `GET /api/categorias`, `GET /api/departamentos`, `GET /api/proveedores` (Task 3); `GET /api/productos?sucursal_id=<id|todas>` (ya existente) — se vuelve a pedir cada vez que cambia la sucursal origen efectiva.

- [ ] **Step 1: Reemplazar todo el archivo**

`src/Traspasos.jsx` cambia lo suficiente (nuevo componente `Modal` local, nuevos estados de búsqueda, la carga de productos se separa de la carga del resto y se vuelve reactiva a la sucursal origen) que se reemplaza el archivo completo:

```jsx
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { ArrowRightLeft, Send, PackageCheck, X, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { apiFetch } from "./api";

function Campo({ label, children }) {
  return (
    <div>
      <label className="text-xs text-slate-500 block mb-1">{label}</label>
      {children}
    </div>
  );
}

function Modal({ titulo, onCerrar, children, ancho = "max-w-md" }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className={`bg-white rounded-xl shadow-2xl w-full ${ancho} max-h-[92vh] overflow-y-auto`}>
        <div className="border-b border-slate-100 px-4 py-3 flex items-center justify-between sticky top-0 bg-white rounded-t-xl">
          <h3 className="font-semibold text-sm text-slate-700">{titulo}</h3>
          <button onClick={onCerrar} className="hover:bg-slate-100 rounded-lg p-1.5 text-slate-400 hover:text-slate-600 transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

const inputCls = "w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:border-blue-500";

const FORM_VACIO = { producto_id: "", cantidad: "", sucursal_destino_id: "", sucursal_origen_id: "", comentario: "" };
const RESULTADOS_POR_PAGINA = 8;

export default function Traspasos({ onVolver, permisos, usuario }) {
  const puede = (clave) => !permisos || permisos.includes(clave);
  const [productos, setProductos] = useState([]);
  const [sucursales, setSucursales] = useState([]);
  const [traspasos, setTraspasos] = useState([]);
  const [categorias, setCategorias] = useState([]);
  const [departamentos, setDepartamentos] = useState([]);
  const [proveedores, setProveedores] = useState([]);
  const [tab, setTab] = useState("enviar"); // "enviar" | "pendientes" | "historial"
  const [cargando, setCargando] = useState(true);
  const [aviso, setAviso] = useState(null);
  const [form, setForm] = useState(FORM_VACIO);
  const [modalRecibir, setModalRecibir] = useState(null); // traspaso seleccionado o null

  const [modalBuscar, setModalBuscar] = useState(false);
  const [busquedaTexto, setBusquedaTexto] = useState("");
  const [filtroCategoria, setFiltroCategoria] = useState("");
  const [filtroDepartamento, setFiltroDepartamento] = useState("");
  const [filtroProveedor, setFiltroProveedor] = useState("");
  const [paginaBusqueda, setPaginaBusqueda] = useState(1);
  const [comentarioRecepcion, setComentarioRecepcion] = useState("");

  const mostrarAviso = (t) => { setAviso(t); setTimeout(() => setAviso(null), 2500); };

  const nombreSucursal = (id) => sucursales.find((s) => s.id === id)?.nombre || `Sucursal ${id}`;
  const nombreProducto = (id) => productos.find((p) => p.id === id)?.nombre || `Producto ${id}`;

  // Sucursal origen efectiva: la propia (usuario amarrado) o la elegida en el
  // formulario (usuario global). La existencia mostrada en el buscador debe
  // ser siempre la de ESTA sucursal, no una suma global.
  const origenEfectivo = usuario?.ver_todas ? (form.sucursal_origen_id || "todas") : usuario?.sucursal_id;

  const cargarProductos = useCallback(async (origen) => {
    try {
      const r = await apiFetch(`/productos?sucursal_id=${origen || "todas"}`);
      setProductos(await r.json());
    } catch { /* silencioso */ }
  }, []);

  const cargarTodo = useCallback(async () => {
    setCargando(true);
    try {
      const [rSuc, rTras, rCat, rDep, rProv] = await Promise.all([
        apiFetch(`/sucursales`), apiFetch(`/traspasos`), apiFetch(`/categorias`), apiFetch(`/departamentos`), apiFetch(`/proveedores`)
      ]);
      setSucursales(await rSuc.json());
      setTraspasos(await rTras.json());
      setCategorias(await rCat.json());
      setDepartamentos(await rDep.json());
      setProveedores(await rProv.json());
    } catch (e) {
      mostrarAviso("❌ No se pudo conectar con el backend");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargarTodo(); }, [cargarTodo]);
  useEffect(() => { cargarProductos(origenEfectivo); }, [origenEfectivo, cargarProductos]);

  const enviarTraspaso = async () => {
    if (!form.producto_id) return mostrarAviso("Selecciona un producto");
    if (!form.cantidad || Number(form.cantidad) <= 0) return mostrarAviso("Escribe una cantidad válida");
    if (!form.sucursal_destino_id) return mostrarAviso("Selecciona la sucursal destino");
    try {
      // sucursal_id=todas explícito: evita que apiFetch pise la sucursal_origen_id elegida
      // en el formulario con la sucursal_activa ambiental del selector global.
      const r = await apiFetch(`/traspasos?sucursal_id=todas`, { method: "POST", body: JSON.stringify(form) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      mostrarAviso("Traspaso enviado — queda en tránsito hasta que destino confirme");
      setForm(FORM_VACIO);
      await Promise.all([cargarTodo(), cargarProductos(origenEfectivo)]);
      setTab("pendientes");
    } catch (e) {
      mostrarAviso("❌ " + e.message);
    }
  };

  const abrirRecibir = (t) => { setModalRecibir(t); setComentarioRecepcion(""); };

  const confirmarRecepcion = async () => {
    try {
      // sucursal_id=todas explícito: evita que apiFetch pise el destino real del traspaso
      // (resuelto server-side) con la sucursal_activa ambiental del selector global.
      const r = await apiFetch(`/traspasos/${modalRecibir.id}/recibir?sucursal_id=todas`, {
        method: "POST", body: JSON.stringify({ comentario: comentarioRecepcion }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      mostrarAviso("Traspaso recibido");
      setModalRecibir(null);
      await cargarTodo();
    } catch (e) {
      mostrarAviso("❌ " + e.message);
    }
  };

  const pendientes = traspasos.filter((t) => t.estatus === "en_transito");
  const historial = traspasos.filter((t) => t.estatus === "recibido");

  // Un traspaso pendiente solo se puede recibir si el usuario es global (puede recibir
  // en nombre de cualquier sucursal) o si su propia sucursal es el destino real.
  const puedeRecibir = (t) => !!usuario?.ver_todas || t.sucursal_destino_id === usuario?.sucursal_id;

  // ---------- Buscador de producto (idéntico visualmente al de Punto de Venta) ----------
  const productosFiltrados = useMemo(() => {
    let lista = productos.filter(
      (p) =>
        p.nombre.toLowerCase().includes(busquedaTexto.toLowerCase()) ||
        p.sku.toLowerCase().includes(busquedaTexto.toLowerCase()) ||
        (p.codigo || "").includes(busquedaTexto)
    );
    if (filtroCategoria) lista = lista.filter((p) => String(p.categoria_id) === filtroCategoria);
    if (filtroDepartamento) lista = lista.filter((p) => String(p.departamento_id) === filtroDepartamento);
    if (filtroProveedor) lista = lista.filter((p) => String(p.proveedor_id) === filtroProveedor);
    return lista;
  }, [productos, busquedaTexto, filtroCategoria, filtroDepartamento, filtroProveedor]);

  const totalPaginas = Math.max(1, Math.ceil(productosFiltrados.length / RESULTADOS_POR_PAGINA));
  const productosPagina = productosFiltrados.slice((paginaBusqueda - 1) * RESULTADOS_POR_PAGINA, paginaBusqueda * RESULTADOS_POR_PAGINA);

  const productoSeleccionado = productos.find((p) => p.id === Number(form.producto_id)) || null;

  const abrirBuscarProducto = () => {
    setBusquedaTexto(""); setFiltroCategoria(""); setFiltroDepartamento(""); setFiltroProveedor(""); setPaginaBusqueda(1);
    setModalBuscar(true);
  };

  const elegirProducto = (p) => {
    setForm((f) => ({ ...f, producto_id: p.id }));
    setModalBuscar(false);
  };

  return (
    <div className="w-full h-full flex flex-col bg-slate-50 text-slate-800 font-sans text-sm">
      <div className="bg-white border-b border-slate-100 flex overflow-x-auto shrink-0">
        <button onClick={() => setTab("enviar")} className={`px-4 py-3 text-sm font-medium border-b-2 ${tab === "enviar" ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500"}`}>
          <Send size={14} className="inline mr-1.5 -mt-0.5" /> Enviar traspaso
        </button>
        <button onClick={() => setTab("pendientes")} className={`px-4 py-3 text-sm font-medium border-b-2 ${tab === "pendientes" ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500"}`}>
          <PackageCheck size={14} className="inline mr-1.5 -mt-0.5" /> Pendientes de recibir ({pendientes.length})
        </button>
        <button onClick={() => setTab("historial")} className={`px-4 py-3 text-sm font-medium border-b-2 ${tab === "historial" ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500"}`}>
          <ArrowRightLeft size={14} className="inline mr-1.5 -mt-0.5" /> Historial
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {cargando ? (
          <p className="text-center text-slate-400 py-16">Cargando...</p>
        ) : tab === "enviar" ? (
          <div className="max-w-md bg-white border border-slate-200 rounded-lg p-5 flex flex-col gap-3">
            <Campo label="Producto">
              <button type="button" onClick={abrirBuscarProducto} className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm text-left hover:bg-slate-50 flex items-center justify-between">
                <span className={productoSeleccionado ? "text-slate-800" : "text-slate-400"}>
                  {productoSeleccionado ? productoSeleccionado.nombre : "Buscar producto..."}
                </span>
                <Search size={14} className="text-slate-400 shrink-0" />
              </button>
              {productoSeleccionado && (
                <p className="text-[11px] text-slate-500 mt-1">Existencia en origen: <b>{productoSeleccionado.existencia}</b></p>
              )}
            </Campo>
            <Campo label="Cantidad">
              <input type="number" className={inputCls} value={form.cantidad} onChange={(e) => setForm({ ...form, cantidad: e.target.value })} />
            </Campo>
            {puede("ver_todas_las_sucursales") && (
              <Campo label="Sucursal origen">
                <select className={inputCls} value={form.sucursal_origen_id} onChange={(e) => setForm({ ...form, sucursal_origen_id: e.target.value })}>
                  <option value="">Selecciona...</option>
                  {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                </select>
              </Campo>
            )}
            <Campo label="Sucursal destino">
              <select className={inputCls} value={form.sucursal_destino_id} onChange={(e) => setForm({ ...form, sucursal_destino_id: e.target.value })}>
                <option value="">Selecciona...</option>
                {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            </Campo>
            <Campo label="Comentario (opcional)">
              <input className={inputCls} value={form.comentario} onChange={(e) => setForm({ ...form, comentario: e.target.value })} placeholder="ej: reabasto de fin de mes" />
            </Campo>
            <button onClick={enviarTraspaso} className="bg-blue-700 hover:bg-blue-800 text-white py-2 rounded font-semibold mt-2">Enviar traspaso</button>
          </div>
        ) : (
          <table className="w-full text-sm bg-white border border-slate-200 rounded-lg overflow-hidden">
            <thead className="bg-[#1a7fe8] text-white">
              <tr>
                <th className="py-2 px-3 text-left font-medium">Producto</th>
                <th className="py-2 px-3 text-center font-medium">Cantidad</th>
                <th className="py-2 px-3 text-left font-medium">Origen → Destino</th>
                <th className="py-2 px-3 text-left font-medium">Fecha</th>
                {tab === "pendientes" && <th className="py-2 px-3"></th>}
                {tab === "historial" && <th className="py-2 px-3 text-left font-medium">Comentario recepción</th>}
              </tr>
            </thead>
            <tbody>
              {(tab === "pendientes" ? pendientes : historial).length === 0 && (
                <tr><td colSpan={5} className="text-center text-slate-400 py-10">Sin traspasos {tab === "pendientes" ? "pendientes" : "en el historial"}</td></tr>
              )}
              {(tab === "pendientes" ? pendientes : historial).map((t) => (
                <tr key={t.id} className="border-b border-slate-100">
                  <td className="py-2 px-3">{nombreProducto(t.producto_id)}</td>
                  <td className="py-2 px-3 text-center">{t.cantidad}</td>
                  <td className="py-2 px-3">{nombreSucursal(t.sucursal_origen_id)} → {nombreSucursal(t.sucursal_destino_id)}</td>
                  <td className="py-2 px-3 text-slate-500">{new Date(t.fecha_envio).toLocaleString()}</td>
                  {tab === "pendientes" && (
                    <td className="py-2 px-3 text-right">
                      {puedeRecibir(t) ? (
                        <button onClick={() => abrirRecibir(t)} className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-3 py-1.5 rounded">Confirmar recepción</button>
                      ) : (
                        <span className="text-xs text-slate-400">Enviado, en tránsito</span>
                      )}
                    </td>
                  )}
                  {tab === "historial" && <td className="py-2 px-3 text-slate-500">{t.comentario_recepcion || "—"}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {aviso && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-sm px-4 py-2 rounded-full shadow-lg z-[60]">{aviso}</div>
      )}

      {modalRecibir && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm overflow-hidden">
            <div className="bg-blue-700 text-white px-4 py-3 flex items-center justify-between">
              <h3 className="font-semibold text-sm">Confirmar recepción</h3>
              <button onClick={() => setModalRecibir(null)} className="hover:bg-slate-100 rounded-lg p-1.5 text-slate-400 transition-colors"><X size={16} /></button>
            </div>
            <div className="p-4 flex flex-col gap-3">
              <p className="text-sm text-slate-600">
                {nombreProducto(modalRecibir.producto_id)} — cantidad: <b>{modalRecibir.cantidad}</b><br />
                De {nombreSucursal(modalRecibir.sucursal_origen_id)} a {nombreSucursal(modalRecibir.sucursal_destino_id)}
              </p>
              <Campo label="Comentario (opcional — ej: mercancía dañada, faltante evidente)">
                <input autoFocus className={inputCls} value={comentarioRecepcion} onChange={(e) => setComentarioRecepcion(e.target.value)} placeholder="Se recibe siempre la cantidad enviada" />
              </Campo>
              <button onClick={confirmarRecepcion} className="bg-emerald-600 hover:bg-emerald-700 text-white py-2 rounded font-semibold">Confirmar recepción</button>
            </div>
          </div>
        </div>
      )}

      {modalBuscar && (
        <Modal titulo="Buscar producto" onCerrar={() => setModalBuscar(false)} ancho="max-w-3xl">
          <input
            autoFocus
            value={busquedaTexto}
            onChange={(e) => { setBusquedaTexto(e.target.value); setPaginaBusqueda(1); }}
            placeholder="Clave, descripción o código de barras..."
            className="w-full border border-slate-300 rounded px-3 py-2 mb-3 focus:outline-none focus:border-blue-500"
          />
          <div className="flex flex-wrap gap-4 mb-3 text-sm">
            <select value={filtroDepartamento} onChange={(e) => { setFiltroDepartamento(e.target.value); setPaginaBusqueda(1); }} className="border border-slate-300 rounded px-2 py-1 text-xs">
              <option value="">Todos los departamentos</option>
              {departamentos.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
            </select>
            <select value={filtroCategoria} onChange={(e) => { setFiltroCategoria(e.target.value); setPaginaBusqueda(1); }} className="border border-slate-300 rounded px-2 py-1 text-xs">
              <option value="">Todas las categorías</option>
              {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
            <select value={filtroProveedor} onChange={(e) => { setFiltroProveedor(e.target.value); setPaginaBusqueda(1); }} className="border border-slate-300 rounded px-2 py-1 text-xs">
              <option value="">Todos los proveedores</option>
              {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </div>

          <div className="max-h-96 overflow-y-auto border border-slate-200 rounded">
            <table className="w-full text-sm">
              <thead className="bg-[#1a7fe8] text-white sticky top-0">
                <tr>
                  <th className="py-2 px-3 text-left font-medium">Clave / Descripción</th>
                  <th className="py-2 px-3 text-center font-medium w-20">Exist.</th>
                  <th className="py-2 px-3 text-right font-medium w-24">Precio</th>
                </tr>
              </thead>
              <tbody>
                {productosPagina.length === 0 && (
                  <tr><td colSpan={3} className="text-center text-slate-400 py-10">Sin resultados</td></tr>
                )}
                {productosPagina.map((p) => (
                  <tr key={p.id} onClick={() => elegirProducto(p)} className="border-b border-slate-100 hover:bg-blue-50 cursor-pointer">
                    <td className="py-2 px-3">
                      <div className="text-[11px] text-slate-400">{p.sku}</div>
                      <div className="font-medium">{p.nombre}</div>
                    </td>
                    <td className={`py-2 px-3 text-center ${p.existencia < p.existencia_minima ? "text-red-600 font-semibold" : "text-slate-600"}`}>{p.existencia}</td>
                    <td className="py-2 px-3 text-right font-semibold text-blue-700">${Number(p.precio_venta).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-center gap-3 mt-3">
            <button disabled={paginaBusqueda <= 1} onClick={() => setPaginaBusqueda((p) => p - 1)} className="p-1.5 rounded border border-slate-300 disabled:opacity-30"><ChevronLeft size={16} /></button>
            <span className="text-xs text-slate-500">Página {paginaBusqueda} de {totalPaginas}</span>
            <button disabled={paginaBusqueda >= totalPaginas} onClick={() => setPaginaBusqueda((p) => p + 1)} className="p-1.5 rounded border border-slate-300 disabled:opacity-30"><ChevronRight size={16} /></button>
          </div>
        </Modal>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verificación manual**

Run: `npm run build` desde la raíz del repo.
Expected: build limpio, sin errores relacionados a `Traspasos.jsx`.

Revisión de cableado (sin navegador disponible en este entorno):
- Confirmar que `cargarProductos` se llama con `origenEfectivo` tanto al montar como cada vez que `form.sucursal_origen_id` cambia (para un usuario global) — y que para un usuario amarrado usa siempre `usuario.sucursal_id`.
- Confirmar que el botón "Producto" abre `modalBuscar`, que las tres selects de filtro (categoría/departamento/proveedor) están presentes con la MISMA estructura de clases que las de `PuntoDeVenta.jsx` (comparar ambos archivos lado a lado), y que al hacer clic en una fila se guarda `form.producto_id` y se cierra el modal.
- Confirmar que `enviarTraspaso` sigue mandando `?sucursal_id=todas` explícito (no se perdió con el reemplazo del archivo).

- [ ] **Step 3: Commit**

```bash
git add src/Traspasos.jsx
git commit -m "feat: buscador de productos en Traspasos idéntico visualmente al de Punto de Venta"
```
