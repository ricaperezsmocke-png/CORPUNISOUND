# Predicciones de Demanda — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exponer la predicción de demanda ya existente en el backend (`backend/predicciones.js`) como una pantalla nueva dentro de Inventario, con gráfica y tabla, búsqueda por producto o categoría, horizonte ajustable por calendario, y permiso propio.

**Architecture:** Backend: un permiso nuevo (`ver_predicciones`, módulo `inventario`) que protege la ruta ya existente `GET /api/predicciones` (hoy sin gate específico). Frontend: pantalla nueva `src/PrediccionesDemanda.jsx` (mismo lenguaje visual que `Traspasos.jsx`/`MigracionDatos.jsx`, reutiliza el patrón local de buscador de producto), agregada como 4ª pestaña dentro de `InventarioProductos.jsx` junto a Productos/Recepción de Compras/Migración de Datos. Nueva dependencia frontend: `recharts` para la gráfica.

**Tech Stack:** Node.js/Express (backend, sin cambios de lógica), React 18 + Recharts (frontend, dependencia nueva), `node --test` para pruebas backend.

## Global Constraints (del spec `docs/superpowers/specs/2026-07-14-predicciones-demanda-design.md`)

- `backend/predicciones.js` NO se modifica — el modelo estadístico ya funciona.
- La pantalla deja elegir entre Producto individual O Categoría completa (ambas, no solo una).
- Visualización: gráfica (Recharts, decisión explícita de Victor) Y tabla, no solo una de las dos.
- Horizonte de predicción ajustable por el usuario vía un `<input type="date">` ("predecir hasta"), no un dropdown fijo — se calcula `meses_adelante` desde hoy hasta esa fecha, con tope de 24 meses.
- Permiso nuevo `ver_predicciones`, módulo `inventario` — mismo patrón que `migrar_datos`/`recibir_compra` (el Administrador lo recibe automático vía `reconciliarRoles()`, otros roles se habilitan a mano).
- Vive como 4ª pestaña dentro de `InventarioProductos.jsx` — no es un módulo nuevo del Dashboard, no se toca `MODULOS_SISTEMA` ni `MODULOS_QUE_REQUIEREN_PERMISOS`.
- Si no hay historial de ventas, la API regresa `{ error: "..." }` — se muestra tal cual, sin gráfica/tabla vacía.
- Regla de oro de `CONVENCION-PERMISOS.md`: el frontend oculta (pestaña no aparece sin el permiso), el backend niega (403 si se llama la ruta directo sin permiso).

---

## File Structure

- **Modify:** `backend/permisosCatalogo.js` — agrega el permiso `ver_predicciones`.
- **Modify:** `backend/server.js` — agrega `requierePermiso("ver_predicciones", ...)` a la ruta `GET /api/predicciones` ya existente.
- **Create:** `backend/permisoVerPredicciones.test.js` — prueba del permiso nuevo (mismo patrón que `permisoMigrarDatos.test.js`).
- **Modify:** `package.json` (raíz) — agrega dependencia `recharts`.
- **Create:** `src/PrediccionesDemanda.jsx` — pantalla nueva.
- **Modify:** `src/InventarioProductos.jsx` — agrega la 4ª pestaña.

---

### Task 1: Permiso `ver_predicciones` + proteger la ruta existente

**Files:**
- Modify: `backend/permisosCatalogo.js`
- Modify: `backend/server.js`
- Test: `backend/permisoVerPredicciones.test.js`

**Interfaces:**
- Produces: permiso `ver_predicciones` disponible en `listarPermisos()`, con `modulo: "inventario"`. La ruta `GET /api/predicciones` ahora exige ese permiso (además de `requiereLogin`, que ya tenía).

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/permisoVerPredicciones.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { listarPermisos } = require("./permisosCatalogo");
const { validarSistemaDePermisos } = require("./validarPermisos");

test("existe el permiso ver_predicciones en modulo inventario", () => {
  const p = listarPermisos().find((x) => x.clave === "ver_predicciones");
  assert.ok(p, "el permiso debe existir en el catálogo");
  assert.strictEqual(p.modulo, "inventario");
  assert.strictEqual(p.implementado, true);
});

test("el guardia de arranque sigue pasando con el permiso nuevo", () => {
  assert.doesNotThrow(() => validarSistemaDePermisos());
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd backend && node --test permisoVerPredicciones.test.js`
Expected: FAIL — "el permiso debe existir en el catálogo" (assert.ok con `p` undefined).

- [ ] **Step 3: Agregar el permiso al catálogo**

En `backend/permisosCatalogo.js`, en la sección `// ---- Inventario y Productos ----`, después de la línea de `migrar_datos` (línea 73: `{ clave: "migrar_datos", etiqueta: "Migrar Datos (Importar/Exportar)", modulo: "inventario", implementado: true },`):

```js
  { clave: "ver_predicciones", etiqueta: "Ver Predicciones de Demanda", modulo: "inventario", implementado: true },
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `cd backend && node --test permisoVerPredicciones.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Proteger la ruta existente**

En `backend/server.js`, localizar la ruta ya existente:

```js
app.get("/api/predicciones", requiereLogin, (req, res) => {
```

Cambiarla por:

```js
app.get("/api/predicciones", requiereLogin, requierePermiso("ver_predicciones", resolverPermisosDeRol), (req, res) => {
```

El resto del cuerpo de la ruta (cálculo de `alcance`, `DBScope`, llamada a `predecirDemanda`) no cambia.

- [ ] **Step 6: Verificar que el backend arranca y los tests existentes siguen pasando**

Run: `cd backend && node --test`
Expected: PASS (todos los tests, incluidos los 2 nuevos de `permisoVerPredicciones.test.js`). Las 4 fallas preexistentes y no relacionadas de `clavesSat.test.js` (catálogo SAT local faltante) pueden seguir apareciendo — no son de este cambio.

Run: `cd backend && node server.js` (y detenerlo tras confirmar, con Ctrl+C o matando el proceso)
Expected: arranca sin errores, línea `✓ Sistema de permisos validado: ...` se imprime.

- [ ] **Step 7: Commit**

```bash
git add backend/permisosCatalogo.js backend/server.js backend/permisoVerPredicciones.test.js
git commit -m "feat: permiso ver_predicciones y proteger ruta /api/predicciones"
```

---

### Task 2: Dependencia `recharts`

**Files:**
- Modify: `package.json` (raíz)
- Modify: `package-lock.json` (raíz, generado por npm)

**Interfaces:**
- Produces: paquete `recharts` disponible para importar en `src/PrediccionesDemanda.jsx` (Task 3): `import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";`

- [ ] **Step 1: Instalar la dependencia**

Run: `npm install recharts` (desde la raíz del proyecto, NO desde `backend/`)
Expected: se agrega `"recharts": "^2.x.x"` (la versión que resuelva npm) a `package.json` bajo `dependencies`, y `package-lock.json` se actualiza.

- [ ] **Step 2: Verificar que el build sigue limpio**

Run: `npm run build`
Expected: build limpio, sin errores (todavía no se usa `recharts` en ningún componente, así que esto solo confirma que la instalación no rompió nada).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: agregar dependencia recharts para grafica de predicciones"
```

---

### Task 3: Frontend — `src/PrediccionesDemanda.jsx`

**Files:**
- Create: `src/PrediccionesDemanda.jsx`

**Interfaces:**
- Consumes: `apiFetch` de `./api` (mismo patrón que `Traspasos.jsx`/`MigracionDatos.jsx`); endpoints `GET /api/productos`, `GET /api/categorias`, `GET /api/predicciones` (ya existentes, este último ahora gateado por `ver_predicciones` desde Task 1).
- Produces: componente `PrediccionesDemanda({ onVolver, permisos, usuario })`, usado en Task 4.

- [ ] **Step 1: Crear la pantalla**

```jsx
import React, { useState, useEffect, useMemo } from "react";
import { Search, X, ChevronLeft, ChevronRight, TrendingUp } from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { apiFetch } from "./api";

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
const RESULTADOS_POR_PAGINA = 8;

function fechaMinima() {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
}

// Meses entre hoy y la fecha elegida, con tope de 24 (más allá de eso una
// regresión lineal simple pierde sentido estadístico - ver spec, sección
// "Riesgo abierto").
function calcularMesesAdelante(fechaLimiteStr) {
  if (!fechaLimiteStr) return 3;
  const hoy = new Date();
  const limite = new Date(fechaLimiteStr + "T00:00:00");
  const meses = (limite.getFullYear() - hoy.getFullYear()) * 12 + (limite.getMonth() - hoy.getMonth());
  return Math.min(24, Math.max(1, meses));
}

const CONFIANZA_ESTILO = {
  alta: "bg-emerald-100 text-emerald-700",
  media: "bg-amber-100 text-amber-700",
  baja: "bg-red-100 text-red-700",
};

export default function PrediccionesDemanda({ onVolver, permisos, usuario }) {
  const [modo, setModo] = useState("producto"); // "producto" | "categoria"
  const [productos, setProductos] = useState([]);
  const [categorias, setCategorias] = useState([]);
  const [productoId, setProductoId] = useState("");
  const [categoriaId, setCategoriaId] = useState("");
  const [fechaLimite, setFechaLimite] = useState("");
  const [resultado, setResultado] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [aviso, setAviso] = useState(null);

  const [modalBuscar, setModalBuscar] = useState(false);
  const [busquedaTexto, setBusquedaTexto] = useState("");
  const [filtroCategoria, setFiltroCategoria] = useState("");
  const [paginaBusqueda, setPaginaBusqueda] = useState(1);

  const mostrarAviso = (t) => { setAviso(t); setTimeout(() => setAviso(null), 3000); };

  useEffect(() => {
    apiFetch("/productos").then((r) => r.json()).then(setProductos).catch(() => {});
    apiFetch("/categorias").then((r) => r.json()).then(setCategorias).catch(() => {});
  }, []);

  useEffect(() => { setResultado(null); }, [modo, productoId, categoriaId]);

  const productoSeleccionado = productos.find((p) => p.id === Number(productoId)) || null;

  const productosFiltrados = useMemo(() => {
    let lista = productos.filter(
      (p) =>
        p.nombre.toLowerCase().includes(busquedaTexto.toLowerCase()) ||
        p.sku.toLowerCase().includes(busquedaTexto.toLowerCase())
    );
    if (filtroCategoria) lista = lista.filter((p) => String(p.categoria_id) === filtroCategoria);
    return lista;
  }, [productos, busquedaTexto, filtroCategoria]);

  const totalPaginas = Math.max(1, Math.ceil(productosFiltrados.length / RESULTADOS_POR_PAGINA));
  const productosPagina = productosFiltrados.slice((paginaBusqueda - 1) * RESULTADOS_POR_PAGINA, paginaBusqueda * RESULTADOS_POR_PAGINA);

  const abrirBuscarProducto = () => {
    setBusquedaTexto(""); setFiltroCategoria(""); setPaginaBusqueda(1);
    setModalBuscar(true);
  };

  const elegirProducto = (p) => {
    setProductoId(String(p.id));
    setModalBuscar(false);
  };

  const calcular = async () => {
    if (modo === "producto" && !productoId) return mostrarAviso("Selecciona un producto");
    if (modo === "categoria" && !categoriaId) return mostrarAviso("Selecciona una categoría");
    if (!fechaLimite) return mostrarAviso("Elige hasta qué fecha quieres predecir");
    const meses_adelante = calcularMesesAdelante(fechaLimite);
    setCargando(true);
    setResultado(null);
    try {
      const params = new URLSearchParams({ meses_adelante: String(meses_adelante) });
      if (modo === "producto") params.set("producto_id", productoId);
      else params.set("categoria_id", categoriaId);
      const r = await apiFetch(`/predicciones?${params.toString()}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "No se pudo calcular la predicción");
      setResultado(data);
    } catch (e) {
      mostrarAviso("❌ " + e.message);
    } finally {
      setCargando(false);
    }
  };

  // Combina historico + prediccion en un solo arreglo por periodo, para que
  // Recharts dibuje ambas series sobre el mismo eje de tiempo compartido.
  const datosGrafica = useMemo(() => {
    if (!resultado || resultado.error) return [];
    const filas = {};
    (resultado.historico || []).forEach((h) => { filas[h.periodo] = { periodo: h.periodo, historico: h.cantidad }; });
    (resultado.prediccion || []).forEach((p) => {
      filas[p.periodo] = { ...(filas[p.periodo] || { periodo: p.periodo }), prediccion: p.cantidad_estimada };
    });
    return Object.values(filas).sort((a, b) => a.periodo.localeCompare(b.periodo));
  }, [resultado]);

  return (
    <div className="w-full h-full flex flex-col bg-slate-50 text-slate-800 font-sans text-sm">
      <div className="p-5 flex flex-col gap-4 flex-1 overflow-y-auto">
        <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col gap-3 max-w-xl">
          <div className="flex gap-2">
            <button
              onClick={() => setModo("producto")}
              className={`flex-1 py-2 rounded text-xs font-medium border ${modo === "producto" ? "bg-blue-700 text-white border-blue-700" : "border-slate-300 text-slate-600"}`}
            >
              Producto
            </button>
            <button
              onClick={() => setModo("categoria")}
              className={`flex-1 py-2 rounded text-xs font-medium border ${modo === "categoria" ? "bg-blue-700 text-white border-blue-700" : "border-slate-300 text-slate-600"}`}
            >
              Categoría
            </button>
          </div>

          {modo === "producto" ? (
            <div>
              <label className="text-xs text-slate-500 block mb-1">Producto</label>
              <button type="button" onClick={abrirBuscarProducto} className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm text-left hover:bg-slate-50 flex items-center justify-between">
                <span className={productoSeleccionado ? "text-slate-800" : "text-slate-400"}>
                  {productoSeleccionado ? productoSeleccionado.nombre : "Buscar producto..."}
                </span>
                <Search size={14} className="text-slate-400 shrink-0" />
              </button>
            </div>
          ) : (
            <div>
              <label className="text-xs text-slate-500 block mb-1">Categoría</label>
              <select className={inputCls} value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}>
                <option value="">Selecciona...</option>
                {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </div>
          )}

          <div>
            <label className="text-xs text-slate-500 block mb-1">Predecir hasta</label>
            <input type="date" className={inputCls} min={fechaMinima()} value={fechaLimite} onChange={(e) => setFechaLimite(e.target.value)} />
          </div>

          <button onClick={calcular} disabled={cargando} className="bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white py-2 rounded font-semibold flex items-center justify-center gap-2">
            <TrendingUp size={15} /> {cargando ? "Calculando..." : "Calcular predicción"}
          </button>
        </div>

        {resultado?.error && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg p-4 max-w-xl">
            {resultado.error}
          </div>
        )}

        {resultado && !resultado.error && (
          <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col gap-4">
            <div className="flex items-center gap-3 flex-wrap">
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${CONFIANZA_ESTILO[resultado.confianza] || "bg-slate-100 text-slate-600"}`}>
                Confianza {resultado.confianza}
              </span>
              <span className="text-xs text-slate-500">{resultado.meses_de_historial} mes(es) de historial real</span>
            </div>
            {resultado.nota && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">{resultado.nota}</p>
            )}

            <div style={{ width: "100%", height: 300 }}>
              <ResponsiveContainer>
                <LineChart data={datosGrafica}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="periodo" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="historico" name="Histórico" stroke="#1a7fe8" strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
                  <Line type="monotone" dataKey="prediccion" name="Predicción" stroke="#1a7fe8" strokeWidth={2} strokeDasharray="6 4" dot={{ r: 3 }} connectNulls={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <table className="w-full text-xs">
              <thead className="bg-[#1a7fe8] text-white">
                <tr>
                  <th className="py-2 px-3 text-left font-medium">Periodo</th>
                  <th className="py-2 px-3 text-right font-medium">Cantidad</th>
                  <th className="py-2 px-3 text-left font-medium">Tipo</th>
                </tr>
              </thead>
              <tbody>
                {(resultado.historico || []).map((h) => (
                  <tr key={"h-" + h.periodo} className="border-b border-slate-100">
                    <td className="py-1.5 px-3">{h.periodo}</td>
                    <td className="py-1.5 px-3 text-right">{h.cantidad}</td>
                    <td className="py-1.5 px-3 text-slate-500">Histórico</td>
                  </tr>
                ))}
                {(resultado.prediccion || []).map((p) => (
                  <tr key={"p-" + p.periodo} className="border-b border-slate-100">
                    <td className="py-1.5 px-3">{p.periodo}</td>
                    <td className="py-1.5 px-3 text-right">{p.cantidad_estimada}</td>
                    <td className="py-1.5 px-3 text-blue-700">Proyectado</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {aviso && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-sm px-4 py-2 rounded-full shadow-lg z-[60]">{aviso}</div>
      )}

      {modalBuscar && (
        <Modal titulo="Buscar producto" onCerrar={() => setModalBuscar(false)} ancho="max-w-2xl">
          <input
            autoFocus
            value={busquedaTexto}
            onChange={(e) => { setBusquedaTexto(e.target.value); setPaginaBusqueda(1); }}
            placeholder="Clave o descripción..."
            className="w-full border border-slate-300 rounded px-3 py-2 mb-3 focus:outline-none focus:border-blue-500"
          />
          <div className="flex flex-wrap gap-4 mb-3 text-sm">
            <select value={filtroCategoria} onChange={(e) => { setFiltroCategoria(e.target.value); setPaginaBusqueda(1); }} className="border border-slate-300 rounded px-2 py-1 text-xs">
              <option value="">Todas las categorías</option>
              {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>

          <div className="max-h-96 overflow-y-auto border border-slate-200 rounded">
            <table className="w-full text-sm">
              <thead className="bg-[#1a7fe8] text-white sticky top-0">
                <tr>
                  <th className="py-2 px-3 text-left font-medium">Clave / Descripción</th>
                </tr>
              </thead>
              <tbody>
                {productosPagina.length === 0 && (
                  <tr><td className="text-center text-slate-400 py-10">Sin resultados</td></tr>
                )}
                {productosPagina.map((p) => (
                  <tr key={p.id} onClick={() => elegirProducto(p)} className="border-b border-slate-100 hover:bg-blue-50 cursor-pointer">
                    <td className="py-2 px-3">
                      <div className="text-[11px] text-slate-400">{p.sku}</div>
                      <div className="font-medium">{p.nombre}</div>
                    </td>
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

- [ ] **Step 2: Verificar que el frontend compila**

Run: `npm run build`
Expected: build limpio, sin errores de sintaxis ni de imports (`recharts` ya está instalado desde Task 2).

- [ ] **Step 3: Commit**

```bash
git add src/PrediccionesDemanda.jsx
git commit -m "feat: pantalla Predicciones de Demanda (grafica + tabla, producto/categoria, horizonte por calendario)"
```

---

### Task 4: Cablear la 4ª pestaña en `InventarioProductos.jsx`

**Files:**
- Modify: `src/InventarioProductos.jsx`

**Interfaces:**
- Consumes: `PrediccionesDemanda` (Task 3).

- [ ] **Step 1: Agregar el import**

En `src/InventarioProductos.jsx`, junto a los imports existentes de `RecepcionCompras`/`MigracionDatos`:

```jsx
import PrediccionesDemanda from "./PrediccionesDemanda.jsx";
```

- [ ] **Step 2: Agregar la entrada al arreglo `TABS`**

Localizar el arreglo `TABS` ya existente (de la feature de Migración de Datos) y agregar una cuarta entrada:

```js
const TABS = [
  { id: "productos", etiqueta: "Productos" },
  { id: "compras", etiqueta: "Recepción de Compras", permiso: "recibir_compra" },
  { id: "migracion", etiqueta: "Migración de Datos", permiso: "migrar_datos" },
  { id: "predicciones", etiqueta: "Predicciones", permiso: "ver_predicciones" },
];
```

(Los primeros tres elementos ya existen — solo se agrega la línea de `predicciones`. El filtro de visibilidad por permiso ya existente `TABS.filter((t) => !t.permiso || puede(t.permiso))` no necesita cambios, aplica igual a la nueva entrada.)

- [ ] **Step 3: Agregar el render condicional**

Junto a los renders ya existentes `{tab === "compras" && ...}` / `{tab === "migracion" && ...}`:

```jsx
{tab === "predicciones" && <PrediccionesDemanda onVolver={onVolver} permisos={permisos} usuario={usuario} />}
```

- [ ] **Step 4: Verificar que el frontend compila**

Run: `npm run build`
Expected: build limpio.

- [ ] **Step 5: Commit**

```bash
git add src/InventarioProductos.jsx
git commit -m "feat: cablear pestana Predicciones de Demanda en Inventario"
```

---

### Task 5: Verificación manual en navegador (smoke test end-to-end)

**Files:** ninguno (solo verificación).

**Interfaces:** ninguna nueva — ejercita todo lo construido en Tasks 1-4.

**Nota:** este task requiere una sesión con capacidad de manejar un navegador real (Playwright con Chrome del sistema — mismo patrón usado en sesiones anteriores de este proyecto, ver Task 10 del plan de Migración de Datos). Si quien ejecuta este plan no tiene esa capacidad, dejarlo marcado como pendiente y decírselo explícitamente a Victor — no dar la pantalla por probada sin haberla visto funcionar.

- [ ] **Step 1: Levantar backend y frontend con una base de datos temporal**

Aislar de los datos reales de Victor: usar `DB_PATH` apuntando a un archivo temporal fuera del repo (no `backend/datos.sqlite`).

Run: `cd backend && DB_PATH=<ruta temporal> node server.js` (en segundo plano)
Run: `npm run dev` (en segundo plano)

- [ ] **Step 2: Iniciar sesión como Administrador**

Si la base es nueva, seguir la pantalla de "Crear la primera cuenta de Administrador".

- [ ] **Step 3: Confirmar que la pestaña "Predicciones" aparece en Inventario**

Entrar a Inventario y Productos. Confirmar que las 4 pestañas están: Productos, Recepción de Compras, Migración de Datos, Predicciones. El Administrador debe verla automáticamente (permiso reconciliado al arranque).

- [ ] **Step 4: Probar el flujo de Producto**

Elegir modo "Producto", buscar y seleccionar un producto sembrado (ej. `AB-001`), elegir una fecha futura, hacer clic en "Calcular predicción". Si el producto sembrado no tiene historial de ventas, confirmar que se muestra el mensaje de error correcto (no una gráfica vacía). Si es necesario, registrar una venta de prueba primero para tener historial real y confirmar que la gráfica y tabla se llenan correctamente.

- [ ] **Step 5: Probar el flujo de Categoría**

Elegir modo "Categoría", seleccionar una categoría existente, elegir fecha, calcular. Confirmar que funciona igual que el modo Producto.

- [ ] **Step 6: Probar el caso sin permiso**

Crear temporalmente un usuario con un rol sin `ver_predicciones` (o quitarle el permiso al Administrador de prueba) y confirmar que la pestaña desaparece, y que llamar `GET /api/predicciones` directo sin el permiso responde 403.

- [ ] **Step 7: Limpiar cualquier dato de prueba**

Detener ambos servidores, borrar la base de datos temporal. Confirmar que `backend/datos.sqlite` real de Victor no fue tocado (verificar que su fecha de modificación no cambió).

- [ ] **Step 8: Reportar a Victor**

Confirmar explícitamente qué se probó y qué no. Si no se pudo generar historial de ventas real para ver la gráfica llena (solo el caso de "sin historial"), decirlo explícitamente.

---

## Self-Review (hecho al escribir este plan)

**Cobertura del spec:** Objetivo/alcance → Tasks 1-4. Producto y categoría (ambas) → Task 3. Gráfica + tabla → Task 3. Horizonte ajustable por calendario → Task 3 (`calcularMesesAdelante`, tope 24). Permiso propio `ver_predicciones` → Task 1. `predicciones.js` sin modificar → confirmado, ningún task lo toca. Vive dentro de Inventario como pestaña → Task 4. Manejo de errores (sin historial, fecha inválida, sin permiso) → Task 3 (validaciones en `calcular()`, `min` del date input) y Task 1 (gate de permiso). Pruebas → Task 1 (backend) y Task 5 (manual, frontend).

**Placeholders:** ninguno — todo el código de cada step está completo y es el real a escribir.

**Consistencia de tipos:** `PrediccionesDemanda({ onVolver, permisos, usuario })` → Task 3, usado igual en Task 4. Permiso `ver_predicciones` → mismo nombre literal en Task 1 (catálogo + ruta) y Task 4 (filtro de pestaña). Campos de la respuesta de `/api/predicciones` (`historico`, `prediccion`, `confianza`, `meses_de_historial`, `nota`, `error`) usados en Task 3 coinciden exactamente con lo que ya regresa `predecirDemanda` en `backend/predicciones.js` (sin cambios a ese archivo).
