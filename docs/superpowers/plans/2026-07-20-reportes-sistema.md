# Módulo de Reportes de Sistema — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir un módulo nuevo "Reportes" con 7 reportes (Ventas, Utilidad, Compras, Cortes de Caja, Existencias, Estado de Cuenta de Clientes, Movimientos de Caja), replicando y mejorando el módulo Reportes de SICAR, usando solo datos que el sistema ya captura.

**Architecture:** Backend nuevo `backend/reportes.js` con una función de agregación de solo lectura por reporte (reciben `DB`, `filtros`, `alcance` — mismo patrón de `alcanceSucursal`/`filtrarPorSucursal` que ya usa `compras.js`), expuestas en `server.js` bajo `/api/reportes/*` protegidas por el permiso nuevo `ver_reportes`. Frontend nuevo: `src/Reportes.jsx` (pantalla de aterrizaje con cuadrícula de 7 iconos) + un componente por reporte en `src/reportes/`, compartiendo `FiltroReporte.jsx` (fecha/sucursal), `BarraAccionesReporte.jsx` (Consultar/Excel/Imprimir) y `exportarCSV.js`.

**Tech Stack:** Node.js/Express (backend ya existente), `node:test` para pruebas de backend, React 18 + Tailwind (frontend ya existente), sin dependencias nuevas.

## Global Constraints

- Ningún reporte crea tablas nuevas — todos leen de `DB.pos.ventas`, `DB.pos.venta_detalle`, `DB.pos.cortes_caja`, `DB.inventario.existencias`, `DB.inventario.compras`, `DB.inventario.compra_detalle`, `DB.crm.clientes`, `DB["catalogo-productos"].productos/departamentos/proveedores`.
- Utilidad se calcula con el costo **actual** del producto (`producto.costo`), no hay costo histórico por venta.
- Ningún reporte incluye: Devoluciones a Proveedor, Notas de Crédito, Créditos/Abonos a Proveedores o Clientes por periodo, Corte de Caja por denominación (Monedas/Extendido), ni los verticales de SICAR ajenos a este negocio (Farmacias, Restaurant, Vacaciones, Monedero, Contador, Cotización).
- Exportar es: CSV (etiquetado "Excel", mismo mecanismo que `ConsultasVentas.exportarCSV`) + `window.print()` con CSS `.no-imprimir` (sin librería de PDF nueva).
- Todo endpoint de reportes exige el permiso `ver_reportes` vía `requierePermiso("ver_reportes", resolverPermisosDeRol)`.
- Todo reporte respeta el alcance de sucursal (`alcanceSucursal`/`filtrarPorSucursal` de `backend/auth.js`) — un usuario amarrado a una sucursal solo ve datos de la suya.
- El backend tiene 275 pruebas pasando en `master` antes de este plan — no deben romperse.

---

### Task 1: Infraestructura del módulo — permiso, navegación y componentes compartidos

**Files:**
- Modify: `backend/permisosCatalogo.js`
- Modify: `backend/validarPermisos.js`
- Create: `backend/permisoVerReportes.test.js`
- Create: `backend/reportes.js`
- Create: `src/reportes/exportarCSV.js`
- Create: `src/reportes/FiltroReporte.jsx`
- Create: `src/reportes/BarraAccionesReporte.jsx`
- Create: `src/reportes/ReporteVentas.jsx` (stub — reemplazado en Task 2)
- Create: `src/reportes/ReporteUtilidad.jsx` (stub — reemplazado en Task 3)
- Create: `src/reportes/ReporteCompras.jsx` (stub — reemplazado en Task 4)
- Create: `src/reportes/ReporteCortesCaja.jsx` (stub — reemplazado en Task 5)
- Create: `src/reportes/ReporteExistencias.jsx` (stub — reemplazado en Task 6)
- Create: `src/reportes/ReporteEstadoCuentaClientes.jsx` (stub — reemplazado en Task 7)
- Create: `src/reportes/ReporteMovimientosCaja.jsx` (stub — reemplazado en Task 8)
- Create: `src/Reportes.jsx`
- Modify: `src/Dashboard.jsx`
- Modify: `src/App.jsx`
- Modify: `src/EncabezadoModulo.jsx`
- Modify: `src/index.css`

**Interfaces:**
- Produces: permiso `ver_reportes` (módulo `reportes`) disponible para `requierePermiso` en `server.js`.
- Produces: `descargarCSV(nombreArchivo, encabezados, filas)` en `src/reportes/exportarCSV.js` — usado por los 7 componentes de reporte.
- Produces: `<FiltroReporte fechaInicial fechaFinal onCambiarFechaInicial onCambiarFechaFinal sucursales sucursalId onCambiarSucursal mostrarFechas hijos />` — componente controlado, sin estado propio.
- Produces: `<BarraAccionesReporte onConsultar onExportarExcel />` — botones Consultar/Excel/Imprimir.
- Produces: vista `"reportes"` navegable desde `Dashboard` (`onEntrarModulo("reportes")` → `setVista("reportes")` en `App.jsx`).

- [ ] **Step 1: Registrar el permiso y el módulo en el catálogo**

En `backend/permisosCatalogo.js`, agregar al final del arreglo `PERMISOS` (antes del `];` que lo cierra, después del bloque `// ---- MercadoLibre ----`):

```js
  // ---- Reportes ----
  { clave: "ver_reportes", etiqueta: "Ver Reportes de Sistema", modulo: "reportes", implementado: true },
];
```

Y en `MODULOS_SISTEMA`, agregar una entrada nueva:

```js
const MODULOS_SISTEMA = [
  { id: "pos",       nombre: "Punto de Venta" },
  { id: "corte",     nombre: "Corte de Caja" },
  { id: "inventario", nombre: "Inventario y Productos" },
  { id: "crm",       nombre: "Clientes" },
  { id: "admin",     nombre: "Roles y Personal" },
  { id: "ml",        nombre: "MercadoLibre" },
  { id: "reportes",  nombre: "Reportes" },
];
```

- [ ] **Step 2: Registrar el módulo en el guardia de arranque**

En `backend/validarPermisos.js`, agregar `"reportes"` a `MODULOS_QUE_REQUIEREN_PERMISOS`:

```js
const MODULOS_QUE_REQUIEREN_PERMISOS = [
  "pos",
  "corte",
  "inventario",
  "crm",
  "admin",
  "ml",
  "reportes",
];
```

- [ ] **Step 3: Escribir la prueba del permiso nuevo**

Crear `backend/permisoVerReportes.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { listarPermisos, listarModulosSistema } = require("./permisosCatalogo");
const { validarSistemaDePermisos } = require("./validarPermisos");

test("existe el permiso ver_reportes en modulo reportes", () => {
  const p = listarPermisos().find((x) => x.clave === "ver_reportes");
  assert.ok(p, "el permiso debe existir en el catálogo");
  assert.strictEqual(p.modulo, "reportes");
  assert.strictEqual(p.implementado, true);
});

test("el modulo reportes esta registrado en MODULOS_SISTEMA", () => {
  const m = listarModulosSistema().find((x) => x.id === "reportes");
  assert.ok(m, "el módulo reportes debe existir en MODULOS_SISTEMA");
});

test("el guardia de arranque sigue pasando con el modulo y permiso nuevos", () => {
  assert.doesNotThrow(() => validarSistemaDePermisos());
});
```

- [ ] **Step 4: Correr la prueba**

Run: `cd backend && npx node --test permisoVerReportes.test.js`
Expected: 3 pruebas, todas PASS.

- [ ] **Step 5: Crear el scaffold de `backend/reportes.js`**

```js
/**
 * reportes.js — Agregaciones de solo lectura para el módulo Reportes.
 *
 * Cada función recibe (DB, filtros, alcance) y filtra primero por sucursal
 * con filtrarPorSucursal (mismo patrón que ya usa compras.listarRecepciones)
 * antes de agregar — así ningún reporte se puede usar para ver datos fuera
 * del alcance de un usuario amarrado a una sucursal.
 */

const { filtrarPorSucursal } = require("./auth");

function redondear(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function enRango(fecha, desde, hasta) {
  if (desde && fecha < desde) return false;
  if (hasta && fecha > hasta) return false;
  return true;
}

module.exports = { redondear, enRango };
```

- [ ] **Step 6: Crear el helper de exportación a Excel/CSV**

Crear `src/reportes/exportarCSV.js`:

```js
/**
 * exportarCSV.js — Descarga un archivo delimitado por comas que abre
 * directo en Excel. Mismo mecanismo que ya usa ConsultasVentas.exportarCSV,
 * extraído aquí para reutilizarse en los 7 reportes.
 */
export function descargarCSV(nombreArchivo, encabezados, filas) {
  const csv = [encabezados, ...filas].map((f) => f.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombreArchivo;
  a.click();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 7: Crear el componente de filtros compartido**

Crear `src/reportes/FiltroReporte.jsx`:

```jsx
import React from "react";

export default function FiltroReporte({
  fechaInicial, fechaFinal, onCambiarFechaInicial, onCambiarFechaFinal,
  sucursales = [], sucursalId, onCambiarSucursal,
  mostrarFechas = true, hijos,
}) {
  return (
    <div className="bg-white border-b border-slate-200 px-4 py-3 flex flex-wrap gap-3 items-end no-imprimir">
      {mostrarFechas && (
        <>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Fecha Inicial</label>
            <input
              type="date" value={fechaInicial}
              onChange={(e) => onCambiarFechaInicial(e.target.value)}
              className="border border-slate-300 rounded px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Fecha Final</label>
            <input
              type="date" value={fechaFinal}
              onChange={(e) => onCambiarFechaFinal(e.target.value)}
              className="border border-slate-300 rounded px-2 py-1.5 text-sm"
            />
          </div>
        </>
      )}
      {onCambiarSucursal && (
        <div>
          <label className="text-xs text-slate-500 block mb-1">Sucursal</label>
          <select
            value={sucursalId} onChange={(e) => onCambiarSucursal(e.target.value)}
            className="border border-slate-300 rounded px-2 py-1.5 text-sm"
          >
            <option value="">Todas</option>
            {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </div>
      )}
      {hijos}
    </div>
  );
}
```

- [ ] **Step 8: Crear la barra de acciones compartida**

Crear `src/reportes/BarraAccionesReporte.jsx`:

```jsx
import React from "react";
import { Eye, Download, Printer } from "lucide-react";

function BotonBarra({ icono: Icono, etiqueta, onClick, tono = "slate" }) {
  const tonos = { slate: "text-[#1a7fe8]", verde: "text-emerald-600" };
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center justify-center gap-1 px-3 py-2 min-w-[74px] border-r border-slate-100 hover:bg-blue-50 transition-colors"
    >
      <Icono size={18} className={tonos[tono]} />
      <span className="text-[10px] font-medium text-slate-500 whitespace-nowrap">{etiqueta}</span>
    </button>
  );
}

export default function BarraAccionesReporte({ onConsultar, onExportarExcel }) {
  return (
    <div className="bg-white border-b border-slate-100 flex overflow-x-auto shrink-0 no-imprimir">
      <BotonBarra icono={Eye} etiqueta="Consultar" tono="verde" onClick={onConsultar} />
      <BotonBarra icono={Download} etiqueta="Excel" onClick={onExportarExcel} />
      <BotonBarra icono={Printer} etiqueta="Imprimir" onClick={() => window.print()} />
    </div>
  );
}
```

- [ ] **Step 9: Agregar la regla de impresión al CSS global**

En `src/index.css`, agregar dentro del bloque `@layer utilities` (después de la regla `@media (prefers-reduced-motion: reduce)`):

```css
  @media print {
    .no-imprimir {
      display: none !important;
    }
  }
```

- [ ] **Step 10: Crear los 7 stubs de reporte**

Crear `src/reportes/ReporteVentas.jsx`:

```jsx
import React from "react";
import { ChevronLeft } from "lucide-react";

export default function ReporteVentas({ onVolver }) {
  return (
    <div className="w-full h-full flex flex-col bg-slate-50">
      <div className="bg-white border-b border-slate-100 px-4 py-2 flex items-center gap-2">
        <button onClick={onVolver} className="flex items-center gap-1 text-sm text-[#1a7fe8] hover:underline">
          <ChevronLeft size={16} /> Reportes
        </button>
      </div>
      <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
        Reporte de Ventas — en construcción
      </div>
    </div>
  );
}
```

Crear `src/reportes/ReporteUtilidad.jsx`:

```jsx
import React from "react";
import { ChevronLeft } from "lucide-react";

export default function ReporteUtilidad({ onVolver }) {
  return (
    <div className="w-full h-full flex flex-col bg-slate-50">
      <div className="bg-white border-b border-slate-100 px-4 py-2 flex items-center gap-2">
        <button onClick={onVolver} className="flex items-center gap-1 text-sm text-[#1a7fe8] hover:underline">
          <ChevronLeft size={16} /> Reportes
        </button>
      </div>
      <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
        Reporte de Utilidad / Ganancia — en construcción
      </div>
    </div>
  );
}
```

Crear `src/reportes/ReporteCompras.jsx`:

```jsx
import React from "react";
import { ChevronLeft } from "lucide-react";

export default function ReporteCompras({ onVolver }) {
  return (
    <div className="w-full h-full flex flex-col bg-slate-50">
      <div className="bg-white border-b border-slate-100 px-4 py-2 flex items-center gap-2">
        <button onClick={onVolver} className="flex items-center gap-1 text-sm text-[#1a7fe8] hover:underline">
          <ChevronLeft size={16} /> Reportes
        </button>
      </div>
      <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
        Reporte de Compras — en construcción
      </div>
    </div>
  );
}
```

Crear `src/reportes/ReporteCortesCaja.jsx`:

```jsx
import React from "react";
import { ChevronLeft } from "lucide-react";

export default function ReporteCortesCaja({ onVolver }) {
  return (
    <div className="w-full h-full flex flex-col bg-slate-50">
      <div className="bg-white border-b border-slate-100 px-4 py-2 flex items-center gap-2">
        <button onClick={onVolver} className="flex items-center gap-1 text-sm text-[#1a7fe8] hover:underline">
          <ChevronLeft size={16} /> Reportes
        </button>
      </div>
      <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
        Reporte de Cortes de Caja — en construcción
      </div>
    </div>
  );
}
```

Crear `src/reportes/ReporteExistencias.jsx`:

```jsx
import React from "react";
import { ChevronLeft } from "lucide-react";

export default function ReporteExistencias({ onVolver }) {
  return (
    <div className="w-full h-full flex flex-col bg-slate-50">
      <div className="bg-white border-b border-slate-100 px-4 py-2 flex items-center gap-2">
        <button onClick={onVolver} className="flex items-center gap-1 text-sm text-[#1a7fe8] hover:underline">
          <ChevronLeft size={16} /> Reportes
        </button>
      </div>
      <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
        Reporte de Existencias / Inventario — en construcción
      </div>
    </div>
  );
}
```

Crear `src/reportes/ReporteEstadoCuentaClientes.jsx`:

```jsx
import React from "react";
import { ChevronLeft } from "lucide-react";

export default function ReporteEstadoCuentaClientes({ onVolver }) {
  return (
    <div className="w-full h-full flex flex-col bg-slate-50">
      <div className="bg-white border-b border-slate-100 px-4 py-2 flex items-center gap-2">
        <button onClick={onVolver} className="flex items-center gap-1 text-sm text-[#1a7fe8] hover:underline">
          <ChevronLeft size={16} /> Reportes
        </button>
      </div>
      <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
        Estado de Cuenta de Clientes — en construcción
      </div>
    </div>
  );
}
```

Crear `src/reportes/ReporteMovimientosCaja.jsx`:

```jsx
import React from "react";
import { ChevronLeft } from "lucide-react";

export default function ReporteMovimientosCaja({ onVolver }) {
  return (
    <div className="w-full h-full flex flex-col bg-slate-50">
      <div className="bg-white border-b border-slate-100 px-4 py-2 flex items-center gap-2">
        <button onClick={onVolver} className="flex items-center gap-1 text-sm text-[#1a7fe8] hover:underline">
          <ChevronLeft size={16} /> Reportes
        </button>
      </div>
      <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
        Reporte de Movimientos de Caja — en construcción
      </div>
    </div>
  );
}
```

- [ ] **Step 11: Crear la pantalla de aterrizaje `src/Reportes.jsx`**

```jsx
import React, { useState } from "react";
import { Receipt, TrendingUp, Truck, Landmark, Boxes, Users, ArrowLeftRight } from "lucide-react";
import ReporteVentas from "./reportes/ReporteVentas.jsx";
import ReporteUtilidad from "./reportes/ReporteUtilidad.jsx";
import ReporteCompras from "./reportes/ReporteCompras.jsx";
import ReporteCortesCaja from "./reportes/ReporteCortesCaja.jsx";
import ReporteExistencias from "./reportes/ReporteExistencias.jsx";
import ReporteEstadoCuentaClientes from "./reportes/ReporteEstadoCuentaClientes.jsx";
import ReporteMovimientosCaja from "./reportes/ReporteMovimientosCaja.jsx";

const REPORTES = [
  { id: "ventas", nombre: "Ventas", icono: Receipt, Componente: ReporteVentas },
  { id: "utilidad", nombre: "Utilidad / Ganancia", icono: TrendingUp, Componente: ReporteUtilidad },
  { id: "compras", nombre: "Compras", icono: Truck, Componente: ReporteCompras },
  { id: "cortes", nombre: "Cortes de Caja", icono: Landmark, Componente: ReporteCortesCaja },
  { id: "existencias", nombre: "Existencias / Inventario", icono: Boxes, Componente: ReporteExistencias },
  { id: "clientes", nombre: "Estado de Cuenta de Clientes", icono: Users, Componente: ReporteEstadoCuentaClientes },
  { id: "movimientos", nombre: "Movimientos de Caja", icono: ArrowLeftRight, Componente: ReporteMovimientosCaja },
];

export default function Reportes() {
  const [activo, setActivo] = useState(null);
  const reporte = REPORTES.find((r) => r.id === activo);

  if (reporte) {
    const { Componente } = reporte;
    return <Componente onVolver={() => setActivo(null)} />;
  }

  return (
    <div className="w-full h-full bg-slate-50 p-6 overflow-y-auto">
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 max-w-3xl">
        {REPORTES.map(({ id, nombre, icono: Icono }) => (
          <button
            key={id}
            onClick={() => setActivo(id)}
            className="flex flex-col items-center gap-2 bg-white border border-slate-200 rounded-xl p-4 hover:border-[#1a7fe8] hover:shadow-md transition-all"
          >
            <Icono size={28} className="text-[#1a7fe8]" />
            <span className="text-xs font-medium text-slate-700 text-center">{nombre}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 12: Agregar el tile "Reportes" al Dashboard**

En `src/Dashboard.jsx`, agregar el import de `FileBarChart` a la línea 2 y una entrada al arreglo `MODULOS`:

```jsx
import { ShoppingCart, Users, Boxes, Lock, ShieldCheck, LogOut, Landmark, Store, ArrowRightLeft, FileBarChart } from "lucide-react";
```

```jsx
const MODULOS = [
  { id: "pos",        nombre: "Punto de Venta",        icono: ShoppingCart, disponible: true, modulo: "pos" },
  { id: "corte",      nombre: "Corte de Caja",          icono: Landmark,     disponible: true, modulo: "corte",     permiso: "realizar_corte_caja" },
  { id: "inventario", nombre: "Inventario y Productos",  icono: Boxes,        disponible: true, modulo: "inventario" },
  { id: "traspasos",  nombre: "Traspasos entre Sucursales", icono: ArrowRightLeft, disponible: true, modulo: "inventario", permiso: "realizar_traspasos" },
  { id: "roles",      nombre: "Roles y Personal",        icono: ShieldCheck,  disponible: true, modulo: "admin" },
  { id: "crm",        nombre: "CRM",                     icono: Users,        disponible: true, modulo: "crm" },
  { id: "ml",         nombre: "MercadoLibre",             icono: Store,        disponible: true, modulo: "ml" },
  { id: "reportes",   nombre: "Reportes",                 icono: FileBarChart, disponible: true, modulo: "reportes", permiso: "ver_reportes" },
];
```

- [ ] **Step 13: Enrutar la vista "reportes" en `src/App.jsx`**

Agregar el import y la entrada en `MODULOS`:

```jsx
import Reportes from "./Reportes.jsx";
```

```jsx
const MODULOS = ["pos", "inventario", "roles", "crm", "corte", "ml", "traspasos", "reportes"];
```

Y agregar el bloque de renderizado (después del bloque `{vista === "ml" && (...)}`):

```jsx
        {vista === "reportes" && (
          <Reportes onVolver={() => setVista("dashboard")} permisos={usuario.permisos} usuario={usuario} />
        )}
```

- [ ] **Step 14: Agregar el título en `src/EncabezadoModulo.jsx`**

```jsx
const TITULOS = {
  pos:        "Punto de Venta",
  inventario: "Inventario y Productos",
  traspasos:  "Traspasos entre Sucursales",
  roles:      "Roles y Personal",
  crm:        "CRM",
  corte:      "Corte de Caja",
  ml:         "MercadoLibre",
  reportes:   "Reportes",
};
```

- [ ] **Step 15: Verificar que el frontend compila**

Run: `npm run build`
Expected: build exitoso, sin errores (los 7 stubs y `Reportes.jsx` compilan).

- [ ] **Step 16: Correr toda la suite de backend**

Run: `cd backend && npm test`
Expected: 278/278 pruebas PASS (las 275 previas + las 3 nuevas de `permisoVerReportes.test.js`).

- [ ] **Step 17: Commit**

```bash
git add backend/permisosCatalogo.js backend/validarPermisos.js backend/permisoVerReportes.test.js backend/reportes.js src/reportes/ src/Reportes.jsx src/Dashboard.jsx src/App.jsx src/EncabezadoModulo.jsx src/index.css
git commit -m "feat: scaffold Reportes module (permission, navigation, shared components)"
```

---

### Task 2: Reporte de Ventas

**Files:**
- Modify: `backend/reportes.js`
- Create: `backend/reportes.test.js`
- Modify: `backend/server.js`
- Modify: `src/reportes/ReporteVentas.jsx`

**Interfaces:**
- Consumes: `redondear`, `enRango` de `backend/reportes.js` (Task 1); `filtrarPorSucursal` de `backend/auth.js`; `descargarCSV` (Task 1); `FiltroReporte`, `BarraAccionesReporte` (Task 1); `apiFetch` de `src/api.js`.
- Produces: `reporteVentas(DB, { fecha_inicio, fecha_fin, vendedor_id, cliente_id, tipo_documento }, alcance) → { general, canceladas, porArticulo, porVendedor, totales: { numero_ventas, total_vigente, total_cancelado } }`. Ruta `GET /api/reportes/ventas`.

- [ ] **Step 1: Escribir la prueba de `reporteVentas`**

Crear `backend/reportes.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { reporteVentas } = require("./reportes");

const ALCANCE_TODAS = { verTodas: true, sucursalId: null };

test("reporteVentas: agrupa ventas vigentes y calcula totales", () => {
  const DB = construirDBPrueba();
  const r = reporteVentas(DB, { fecha_inicio: "2026-05-01", fecha_fin: "2026-06-30" }, ALCANCE_TODAS);

  assert.strictEqual(r.general.length, 3, "las 3 ventas semilla caen en el rango");
  assert.strictEqual(r.totales.numero_ventas, 3);
  assert.strictEqual(r.totales.total_vigente, 1200 + 800 + 2100);
  assert.strictEqual(r.totales.total_cancelado, 0);
});

test("reporteVentas: respeta el rango de fechas", () => {
  const DB = construirDBPrueba();
  const r = reporteVentas(DB, { fecha_inicio: "2026-06-01", fecha_fin: "2026-06-30" }, ALCANCE_TODAS);
  assert.strictEqual(r.general.length, 1, "solo la venta 3 (2026-06-05) cae en junio");
  assert.strictEqual(r.totales.total_vigente, 2100);
});

test("reporteVentas: separa canceladas y no las suma al total vigente", () => {
  const DB = construirDBPrueba();
  DB.pos.ventas[0].estatus = "cancelada";
  const r = reporteVentas(DB, { fecha_inicio: "2026-05-01", fecha_fin: "2026-06-30" }, ALCANCE_TODAS);
  assert.strictEqual(r.canceladas.length, 1);
  assert.strictEqual(r.totales.total_cancelado, 1200);
  assert.strictEqual(r.totales.total_vigente, 800 + 2100);
});

test("reporteVentas: agrupa por artículo sumando cantidad e importe", () => {
  const DB = construirDBPrueba();
  const r = reporteVentas(DB, { fecha_inicio: "2026-05-01", fecha_fin: "2026-06-30" }, ALCANCE_TODAS);
  const arroz = r.porArticulo.find((f) => f.producto === "Arroz 1kg");
  assert.ok(arroz, "debe aparecer Arroz 1kg (vendido en la venta 1)");
  assert.strictEqual(arroz.cantidad, 20);
  assert.strictEqual(arroz.importe, 500);
});

test("reporteVentas: agrupa por vendedor", () => {
  const DB = construirDBPrueba();
  const r = reporteVentas(DB, { fecha_inicio: "2026-05-01", fecha_fin: "2026-06-30" }, ALCANCE_TODAS);
  const ana = r.porVendedor.find((f) => f.vendedor === "Ana López");
  assert.ok(ana);
  assert.strictEqual(ana.numero_ventas, 1);
  assert.strictEqual(ana.total, 1200);
});

test("reporteVentas: respeta el alcance de sucursal", () => {
  const DB = construirDBPrueba();
  const alcanceSucursal1 = { verTodas: false, sucursalId: 1 };
  const r = reporteVentas(DB, { fecha_inicio: "2026-05-01", fecha_fin: "2026-06-30" }, alcanceSucursal1);
  assert.strictEqual(r.general.length, 1, "solo la venta de la sucursal 1");
  assert.strictEqual(r.general[0].id, 1);
});

test("reporteVentas: filtra por vendedor_id", () => {
  const DB = construirDBPrueba();
  const r = reporteVentas(DB, { fecha_inicio: "2026-05-01", fecha_fin: "2026-06-30", vendedor_id: 3 }, ALCANCE_TODAS);
  assert.strictEqual(r.general.length, 1);
  assert.strictEqual(r.general[0].vendedor_nombre, "María R.");
});
```

- [ ] **Step 2: Correr la prueba para verificar que falla**

Run: `cd backend && npx node --test reportes.test.js`
Expected: FAIL — `reporteVentas is not a function`.

- [ ] **Step 3: Implementar `reporteVentas` en `backend/reportes.js`**

```js
function reporteVentas(DB, filtros, alcance) {
  const { fecha_inicio, fecha_fin, vendedor_id, cliente_id, tipo_documento } = filtros;
  let ventas = filtrarPorSucursal(DB.pos.ventas, alcance)
    .filter((v) => enRango(v.fecha, fecha_inicio, fecha_fin));
  if (vendedor_id) ventas = ventas.filter((v) => v.vendedor_id === Number(vendedor_id));
  if (cliente_id) ventas = ventas.filter((v) => v.cliente_id === Number(cliente_id));
  if (tipo_documento) ventas = ventas.filter((v) => (v.tipo_documento || "Ticket") === tipo_documento);

  const nombreCliente = (id) => (DB.crm.clientes.find((c) => c.id === id) || {}).nombre || "Público en General";
  const nombreVendedor = (id) => (DB.pos.vendedores.find((v) => v.id === id) || {}).nombre || "—";
  const nombreSucursal = (id) => (DB.pos.sucursales.find((s) => s.id === id) || {}).nombre || "—";

  const general = ventas.map((v) => ({
    id: v.id, fecha: v.fecha, sucursal_nombre: nombreSucursal(v.sucursal_id),
    cliente_nombre: nombreCliente(v.cliente_id), vendedor_nombre: nombreVendedor(v.vendedor_id),
    tipo_documento: v.tipo_documento || "Ticket", estatus: v.estatus, total: v.total,
  })).sort((a, b) => a.fecha.localeCompare(b.fecha));

  const vigentes = general.filter((f) => f.estatus !== "cancelada");
  const canceladas = general.filter((f) => f.estatus === "cancelada");

  const idsVigentes = new Set(vigentes.map((f) => f.id));
  const detalle = DB.pos.venta_detalle.filter((d) => idsVigentes.has(d.venta_id));

  const porArticuloMapa = new Map();
  detalle.forEach((d) => {
    const producto = DB["catalogo-productos"].productos.find((p) => p.id === d.producto_id);
    const nombre = d.descripcion || (producto ? producto.nombre : "Producto");
    const actual = porArticuloMapa.get(nombre) || { producto: nombre, cantidad: 0, importe: 0 };
    actual.cantidad += d.cantidad;
    actual.importe += d.subtotal;
    porArticuloMapa.set(nombre, actual);
  });
  const porArticulo = [...porArticuloMapa.values()]
    .map((f) => ({ ...f, importe: redondear(f.importe) }))
    .sort((a, b) => b.importe - a.importe);

  const porVendedorMapa = new Map();
  vigentes.forEach((f) => {
    const actual = porVendedorMapa.get(f.vendedor_nombre) || { vendedor: f.vendedor_nombre, numero_ventas: 0, total: 0 };
    actual.numero_ventas += 1;
    actual.total += f.total;
    porVendedorMapa.set(f.vendedor_nombre, actual);
  });
  const porVendedor = [...porVendedorMapa.values()]
    .map((f) => ({ ...f, total: redondear(f.total) }))
    .sort((a, b) => b.total - a.total);

  return {
    general, canceladas, porArticulo, porVendedor,
    totales: {
      numero_ventas: vigentes.length,
      total_vigente: redondear(vigentes.reduce((a, f) => a + f.total, 0)),
      total_cancelado: redondear(canceladas.reduce((a, f) => a + f.total, 0)),
    },
  };
}
```

Y actualizar el `module.exports` al final del archivo:

```js
module.exports = { redondear, enRango, reporteVentas };
```

- [ ] **Step 4: Correr la prueba para verificar que pasa**

Run: `cd backend && npx node --test reportes.test.js`
Expected: 7 pruebas, todas PASS.

- [ ] **Step 5: Exponer la ruta en `server.js`**

Agregar el import (junto a los demás requires de módulos backend, después de la línea de `documentosPersonal`):

```js
const { reporteVentas } = require("./reportes");
```

Agregar la ruta (después de la última ruta de `/api/ml/...`, o en cualquier punto junto a las demás rutas `app.get`):

```js
app.get("/api/reportes/ventas", requiereLogin, requierePermiso("ver_reportes", resolverPermisosDeRol), (req, res) => {
  const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
  const { fecha_inicio, fecha_fin, vendedor_id, cliente_id, tipo_documento } = req.query;
  res.json(reporteVentas(DB, { fecha_inicio, fecha_fin, vendedor_id, cliente_id, tipo_documento }, alcance));
});
```

- [ ] **Step 6: Implementar `src/reportes/ReporteVentas.jsx`**

Reemplazar el contenido completo del archivo (el stub del Task 1) por:

```jsx
import React, { useState, useEffect, useCallback } from "react";
import { ChevronLeft } from "lucide-react";
import { apiFetch } from "../api";
import FiltroReporte from "./FiltroReporte.jsx";
import BarraAccionesReporte from "./BarraAccionesReporte.jsx";
import { descargarCSV } from "./exportarCSV.js";

const hoyFmt = () => new Date().toISOString().slice(0, 10);
const hace30 = () => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10); };

const TABS = [
  { id: "general", etiqueta: "General" },
  { id: "porArticulo", etiqueta: "Por Artículo" },
  { id: "porVendedor", etiqueta: "Por Vendedor" },
  { id: "canceladas", etiqueta: "Canceladas" },
];

export default function ReporteVentas({ onVolver }) {
  const [fechaInicial, setFechaInicial] = useState(hace30());
  const [fechaFinal, setFechaFinal] = useState(hoyFmt());
  const [sucursalId, setSucursalId] = useState("");
  const [vendedorId, setVendedorId] = useState("");
  const [sucursales, setSucursales] = useState([]);
  const [vendedores, setVendedores] = useState([]);
  const [tab, setTab] = useState("general");
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    apiFetch("/sucursales").then((r) => r.ok && r.json()).then((d) => d && setSucursales(d));
    apiFetch("/vendedores").then((r) => r.ok && r.json()).then((d) => d && setVendedores(d));
  }, []);

  const consultar = useCallback(async () => {
    setCargando(true);
    const params = new URLSearchParams();
    if (fechaInicial) params.set("fecha_inicio", fechaInicial);
    if (fechaFinal) params.set("fecha_fin", fechaFinal);
    if (sucursalId) params.set("sucursal_id", sucursalId);
    if (vendedorId) params.set("vendedor_id", vendedorId);
    const r = await apiFetch(`/reportes/ventas?${params.toString()}`);
    if (r.ok) setDatos(await r.json());
    setCargando(false);
  }, [fechaInicial, fechaFinal, sucursalId, vendedorId]);

  useEffect(() => { consultar(); }, [consultar]);

  const exportarExcel = () => {
    if (!datos) return;
    if (tab === "general") {
      descargarCSV(`ventas_general_${fechaInicial}_a_${fechaFinal}.csv`,
        ["Fecha", "Folio", "Sucursal", "Documento", "Cliente", "Vendedor", "Estado", "Total"],
        datos.general.map((f) => [f.fecha, f.id, f.sucursal_nombre, f.tipo_documento, f.cliente_nombre, f.vendedor_nombre, f.estatus, f.total]));
    } else if (tab === "porArticulo") {
      descargarCSV(`ventas_por_articulo_${fechaInicial}_a_${fechaFinal}.csv`,
        ["Producto", "Cantidad", "Importe"], datos.porArticulo.map((f) => [f.producto, f.cantidad, f.importe]));
    } else if (tab === "porVendedor") {
      descargarCSV(`ventas_por_vendedor_${fechaInicial}_a_${fechaFinal}.csv`,
        ["Vendedor", "No. Ventas", "Total"], datos.porVendedor.map((f) => [f.vendedor, f.numero_ventas, f.total]));
    } else {
      descargarCSV(`ventas_canceladas_${fechaInicial}_a_${fechaFinal}.csv`,
        ["Fecha", "Folio", "Sucursal", "Cliente", "Vendedor", "Total"],
        datos.canceladas.map((f) => [f.fecha, f.id, f.sucursal_nombre, f.cliente_nombre, f.vendedor_nombre, f.total]));
    }
  };

  return (
    <div className="w-full h-full flex flex-col bg-slate-50 text-slate-800 text-sm">
      <div className="bg-white border-b border-slate-100 px-4 py-2 flex items-center gap-2 no-imprimir">
        <button onClick={onVolver} className="flex items-center gap-1 text-sm text-[#1a7fe8] hover:underline">
          <ChevronLeft size={16} /> Reportes
        </button>
        <h2 className="font-semibold text-slate-700 ml-2">Reporte de Ventas</h2>
      </div>

      <BarraAccionesReporte onConsultar={consultar} onExportarExcel={exportarExcel} />

      <FiltroReporte
        fechaInicial={fechaInicial} fechaFinal={fechaFinal}
        onCambiarFechaInicial={setFechaInicial} onCambiarFechaFinal={setFechaFinal}
        sucursales={sucursales} sucursalId={sucursalId} onCambiarSucursal={setSucursalId}
        hijos={
          <div>
            <label className="text-xs text-slate-500 block mb-1">Vendedor</label>
            <select value={vendedorId} onChange={(e) => setVendedorId(e.target.value)} className="border border-slate-300 rounded px-2 py-1.5 text-sm">
              <option value="">Todos</option>
              {vendedores.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
            </select>
          </div>
        }
      />

      <div className="bg-white border-b border-slate-200 flex no-imprimir">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm border-b-2 ${tab === t.id ? "border-[#1a7fe8] text-[#1a7fe8] font-medium" : "border-transparent text-slate-500"}`}>
            {t.etiqueta}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {cargando ? (
          <p className="text-center text-slate-400 py-16">Consultando...</p>
        ) : !datos ? (
          <p className="text-center text-slate-400 py-16">Sin datos</p>
        ) : tab === "general" ? (
          <table className="w-full text-sm">
            <thead className="bg-[#1a7fe8] text-white sticky top-0">
              <tr>
                <th className="py-2 px-3 text-left font-medium">Fecha</th>
                <th className="py-2 px-3 text-left font-medium">Folio</th>
                <th className="py-2 px-3 text-left font-medium">Sucursal</th>
                <th className="py-2 px-3 text-left font-medium">Documento</th>
                <th className="py-2 px-3 text-left font-medium">Cliente</th>
                <th className="py-2 px-3 text-left font-medium">Vendedor</th>
                <th className="py-2 px-3 text-center font-medium">Estado</th>
                <th className="py-2 px-3 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {datos.general.length === 0 && <tr><td colSpan={8} className="text-center text-slate-400 py-16">Sin resultados</td></tr>}
              {datos.general.map((f) => (
                <tr key={f.id} className={`border-b border-slate-100 ${f.estatus === "cancelada" ? "opacity-50" : ""}`}>
                  <td className="py-2 px-3">{f.fecha}</td>
                  <td className="py-2 px-3 font-medium">{f.id}</td>
                  <td className="py-2 px-3">{f.sucursal_nombre}</td>
                  <td className="py-2 px-3">{f.tipo_documento}</td>
                  <td className="py-2 px-3">{f.cliente_nombre}</td>
                  <td className="py-2 px-3">{f.vendedor_nombre}</td>
                  <td className="py-2 px-3 text-center">{f.estatus === "cancelada" ? "Cancelada" : "Cerrada"}</td>
                  <td className="py-2 px-3 text-right font-medium">${Number(f.total).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : tab === "porArticulo" ? (
          <table className="w-full text-sm">
            <thead className="bg-[#1a7fe8] text-white sticky top-0">
              <tr><th className="py-2 px-3 text-left font-medium">Producto</th><th className="py-2 px-3 text-right font-medium">Cantidad</th><th className="py-2 px-3 text-right font-medium">Importe</th></tr>
            </thead>
            <tbody>
              {datos.porArticulo.length === 0 && <tr><td colSpan={3} className="text-center text-slate-400 py-16">Sin resultados</td></tr>}
              {datos.porArticulo.map((f, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="py-2 px-3">{f.producto}</td>
                  <td className="py-2 px-3 text-right">{f.cantidad}</td>
                  <td className="py-2 px-3 text-right font-medium">${f.importe.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : tab === "porVendedor" ? (
          <table className="w-full text-sm">
            <thead className="bg-[#1a7fe8] text-white sticky top-0">
              <tr><th className="py-2 px-3 text-left font-medium">Vendedor</th><th className="py-2 px-3 text-right font-medium">No. Ventas</th><th className="py-2 px-3 text-right font-medium">Total</th></tr>
            </thead>
            <tbody>
              {datos.porVendedor.length === 0 && <tr><td colSpan={3} className="text-center text-slate-400 py-16">Sin resultados</td></tr>}
              {datos.porVendedor.map((f, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="py-2 px-3">{f.vendedor}</td>
                  <td className="py-2 px-3 text-right">{f.numero_ventas}</td>
                  <td className="py-2 px-3 text-right font-medium">${f.total.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[#1a7fe8] text-white sticky top-0">
              <tr><th className="py-2 px-3 text-left font-medium">Fecha</th><th className="py-2 px-3 text-left font-medium">Folio</th><th className="py-2 px-3 text-left font-medium">Sucursal</th><th className="py-2 px-3 text-left font-medium">Cliente</th><th className="py-2 px-3 text-left font-medium">Vendedor</th><th className="py-2 px-3 text-right font-medium">Total</th></tr>
            </thead>
            <tbody>
              {datos.canceladas.length === 0 && <tr><td colSpan={6} className="text-center text-slate-400 py-16">Sin canceladas</td></tr>}
              {datos.canceladas.map((f) => (
                <tr key={f.id} className="border-b border-slate-100">
                  <td className="py-2 px-3">{f.fecha}</td>
                  <td className="py-2 px-3 font-medium">{f.id}</td>
                  <td className="py-2 px-3">{f.sucursal_nombre}</td>
                  <td className="py-2 px-3">{f.cliente_nombre}</td>
                  <td className="py-2 px-3">{f.vendedor_nombre}</td>
                  <td className="py-2 px-3 text-right font-medium">${Number(f.total).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {datos && (
        <div className="bg-slate-800 text-white px-4 py-2 flex items-center justify-between text-xs shrink-0 no-imprimir">
          <span>{datos.totales.numero_ventas} venta(s) vigente(s)</span>
          <span>Total vigente: <b>${datos.totales.total_vigente.toFixed(2)}</b> — Cancelado: ${datos.totales.total_cancelado.toFixed(2)}</span>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Verificar el build del frontend**

Run: `npm run build`
Expected: build exitoso.

- [ ] **Step 8: Commit**

```bash
git add backend/reportes.js backend/reportes.test.js backend/server.js src/reportes/ReporteVentas.jsx
git commit -m "feat: add Reporte de Ventas"
```

---

### Task 3: Reporte de Utilidad / Ganancia

**Files:**
- Modify: `backend/reportes.js`
- Modify: `backend/reportes.test.js`
- Modify: `backend/server.js`
- Modify: `src/reportes/ReporteUtilidad.jsx`

**Interfaces:**
- Consumes: `redondear`, `enRango`, `filtrarPorSucursal` (igual que Task 2).
- Produces: `reporteUtilidad(DB, { fecha_inicio, fecha_fin, vendedor_id }, alcance) → { porArticulo, porDepartamento, totales: { venta, costo, utilidad, margen_pct } }`. Ruta `GET /api/reportes/utilidad`.

- [ ] **Step 1: Escribir la prueba de `reporteUtilidad`**

Agregar a `backend/reportes.test.js`:

```js
const { reporteUtilidad } = require("./reportes");

test("reporteUtilidad: calcula venta, costo y utilidad con el costo actual del producto", () => {
  const DB = construirDBPrueba();
  // producto 1: costo 20, la venta 1 vendió 20 unidades en $500 (venta_detalle id 1)
  const r = reporteUtilidad(DB, { fecha_inicio: "2026-05-01", fecha_fin: "2026-06-30" }, ALCANCE_TODAS);
  const arroz = r.porArticulo.find((f) => f.producto === "Arroz 1kg");
  assert.ok(arroz);
  assert.strictEqual(arroz.venta, 500);
  assert.strictEqual(arroz.costo, 20 * 20, "costo actual (20) por cantidad (20)");
  assert.strictEqual(arroz.utilidad, 500 - 400);
});

test("reporteUtilidad: agrupa por departamento, usa 'Sin departamento' si el producto no tiene uno", () => {
  const DB = construirDBPrueba();
  const r = reporteUtilidad(DB, { fecha_inicio: "2026-05-01", fecha_fin: "2026-06-30" }, ALCANCE_TODAS);
  const sinDepto = r.porDepartamento.find((f) => f.departamento === "Sin departamento");
  assert.ok(sinDepto, "los productos semilla no tienen departamento_id");
});

test("reporteUtilidad: agrupa por el departamento real cuando el producto lo tiene", () => {
  const DB = construirDBPrueba();
  DB["catalogo-productos"].departamentos.push({ id: 1, nombre: "Abarrotes" });
  DB["catalogo-productos"].productos.find((p) => p.id === 1).departamento_id = 1;
  const r = reporteUtilidad(DB, { fecha_inicio: "2026-05-01", fecha_fin: "2026-06-30" }, ALCANCE_TODAS);
  const abarrotes = r.porDepartamento.find((f) => f.departamento === "Abarrotes");
  assert.ok(abarrotes);
  assert.strictEqual(abarrotes.venta, 500);
});

test("reporteUtilidad: no incluye ventas canceladas", () => {
  const DB = construirDBPrueba();
  DB.pos.ventas[0].estatus = "cancelada";
  const r = reporteUtilidad(DB, { fecha_inicio: "2026-05-01", fecha_fin: "2026-06-30" }, ALCANCE_TODAS);
  const arroz = r.porArticulo.find((f) => f.producto === "Arroz 1kg");
  assert.strictEqual(arroz, undefined, "la única venta de arroz estaba cancelada");
});

test("reporteUtilidad: calcula el margen porcentual del total", () => {
  const DB = construirDBPrueba();
  const r = reporteUtilidad(DB, { fecha_inicio: "2026-05-01", fecha_fin: "2026-06-30" }, ALCANCE_TODAS);
  assert.strictEqual(r.totales.venta, 500 + 640 + 800);
  assert.strictEqual(r.totales.costo, 20 * 20 + 12 * 40 + 20 * 25);
  assert.ok(r.totales.margen_pct > 0);
});
```

- [ ] **Step 2: Correr la prueba para verificar que falla**

Run: `cd backend && npx node --test reportes.test.js`
Expected: FAIL — `reporteUtilidad is not a function`.

- [ ] **Step 3: Implementar `reporteUtilidad` en `backend/reportes.js`**

```js
function reporteUtilidad(DB, filtros, alcance) {
  const { fecha_inicio, fecha_fin, vendedor_id } = filtros;
  let ventas = filtrarPorSucursal(DB.pos.ventas, alcance)
    .filter((v) => v.estatus !== "cancelada")
    .filter((v) => enRango(v.fecha, fecha_inicio, fecha_fin));
  if (vendedor_id) ventas = ventas.filter((v) => v.vendedor_id === Number(vendedor_id));

  const idsVentas = new Set(ventas.map((v) => v.id));
  const detalle = DB.pos.venta_detalle.filter((d) => idsVentas.has(d.venta_id));

  let ventaTotal = 0, costoTotal = 0;
  const porArticuloMapa = new Map();
  const porDepartamentoMapa = new Map();

  detalle.forEach((d) => {
    const producto = DB["catalogo-productos"].productos.find((p) => p.id === d.producto_id);
    const costoUnitario = producto ? Number(producto.costo) || 0 : 0;
    const costoLinea = costoUnitario * d.cantidad;
    const ventaLinea = d.subtotal;
    ventaTotal += ventaLinea;
    costoTotal += costoLinea;

    const nombreArticulo = d.descripcion || (producto ? producto.nombre : "Producto");
    const filaArt = porArticuloMapa.get(nombreArticulo) || { producto: nombreArticulo, venta: 0, costo: 0 };
    filaArt.venta += ventaLinea; filaArt.costo += costoLinea;
    porArticuloMapa.set(nombreArticulo, filaArt);

    const departamento = producto && producto.departamento_id
      ? (DB["catalogo-productos"].departamentos.find((dep) => dep.id === producto.departamento_id) || {}).nombre
      : null;
    const nombreDepto = departamento || "Sin departamento";
    const filaDepto = porDepartamentoMapa.get(nombreDepto) || { departamento: nombreDepto, venta: 0, costo: 0 };
    filaDepto.venta += ventaLinea; filaDepto.costo += costoLinea;
    porDepartamentoMapa.set(nombreDepto, filaDepto);
  });

  const conUtilidad = (f) => ({ ...f, venta: redondear(f.venta), costo: redondear(f.costo), utilidad: redondear(f.venta - f.costo) });

  return {
    porArticulo: [...porArticuloMapa.values()].map(conUtilidad).sort((a, b) => b.utilidad - a.utilidad),
    porDepartamento: [...porDepartamentoMapa.values()].map(conUtilidad).sort((a, b) => b.utilidad - a.utilidad),
    totales: {
      venta: redondear(ventaTotal), costo: redondear(costoTotal), utilidad: redondear(ventaTotal - costoTotal),
      margen_pct: ventaTotal > 0 ? redondear(((ventaTotal - costoTotal) / ventaTotal) * 100) : 0,
    },
  };
}
```

Actualizar `module.exports`:

```js
module.exports = { redondear, enRango, reporteVentas, reporteUtilidad };
```

- [ ] **Step 4: Correr la prueba para verificar que pasa**

Run: `cd backend && npx node --test reportes.test.js`
Expected: 12 pruebas, todas PASS.

- [ ] **Step 5: Exponer la ruta en `server.js`**

```js
const { reporteVentas, reporteUtilidad } = require("./reportes");
```

```js
app.get("/api/reportes/utilidad", requiereLogin, requierePermiso("ver_reportes", resolverPermisosDeRol), (req, res) => {
  const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
  const { fecha_inicio, fecha_fin, vendedor_id } = req.query;
  res.json(reporteUtilidad(DB, { fecha_inicio, fecha_fin, vendedor_id }, alcance));
});
```

- [ ] **Step 6: Implementar `src/reportes/ReporteUtilidad.jsx`**

Reemplazar el contenido completo del archivo:

```jsx
import React, { useState, useEffect, useCallback } from "react";
import { ChevronLeft } from "lucide-react";
import { apiFetch } from "../api";
import FiltroReporte from "./FiltroReporte.jsx";
import BarraAccionesReporte from "./BarraAccionesReporte.jsx";
import { descargarCSV } from "./exportarCSV.js";

const hoyFmt = () => new Date().toISOString().slice(0, 10);
const hace30 = () => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10); };

const TABS = [
  { id: "porArticulo", etiqueta: "Por Artículo" },
  { id: "porDepartamento", etiqueta: "Por Departamento" },
];

export default function ReporteUtilidad({ onVolver }) {
  const [fechaInicial, setFechaInicial] = useState(hace30());
  const [fechaFinal, setFechaFinal] = useState(hoyFmt());
  const [sucursalId, setSucursalId] = useState("");
  const [vendedorId, setVendedorId] = useState("");
  const [sucursales, setSucursales] = useState([]);
  const [vendedores, setVendedores] = useState([]);
  const [tab, setTab] = useState("porArticulo");
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    apiFetch("/sucursales").then((r) => r.ok && r.json()).then((d) => d && setSucursales(d));
    apiFetch("/vendedores").then((r) => r.ok && r.json()).then((d) => d && setVendedores(d));
  }, []);

  const consultar = useCallback(async () => {
    setCargando(true);
    const params = new URLSearchParams();
    if (fechaInicial) params.set("fecha_inicio", fechaInicial);
    if (fechaFinal) params.set("fecha_fin", fechaFinal);
    if (sucursalId) params.set("sucursal_id", sucursalId);
    if (vendedorId) params.set("vendedor_id", vendedorId);
    const r = await apiFetch(`/reportes/utilidad?${params.toString()}`);
    if (r.ok) setDatos(await r.json());
    setCargando(false);
  }, [fechaInicial, fechaFinal, sucursalId, vendedorId]);

  useEffect(() => { consultar(); }, [consultar]);

  const exportarExcel = () => {
    if (!datos) return;
    if (tab === "porArticulo") {
      descargarCSV(`utilidad_por_articulo_${fechaInicial}_a_${fechaFinal}.csv`,
        ["Producto", "Venta", "Costo", "Utilidad"],
        datos.porArticulo.map((f) => [f.producto, f.venta, f.costo, f.utilidad]));
    } else {
      descargarCSV(`utilidad_por_departamento_${fechaInicial}_a_${fechaFinal}.csv`,
        ["Departamento", "Venta", "Costo", "Utilidad"],
        datos.porDepartamento.map((f) => [f.departamento, f.venta, f.costo, f.utilidad]));
    }
  };

  const filas = datos ? (tab === "porArticulo" ? datos.porArticulo : datos.porDepartamento) : [];

  return (
    <div className="w-full h-full flex flex-col bg-slate-50 text-slate-800 text-sm">
      <div className="bg-white border-b border-slate-100 px-4 py-2 flex items-center gap-2 no-imprimir">
        <button onClick={onVolver} className="flex items-center gap-1 text-sm text-[#1a7fe8] hover:underline">
          <ChevronLeft size={16} /> Reportes
        </button>
        <h2 className="font-semibold text-slate-700 ml-2">Reporte de Utilidad / Ganancia</h2>
      </div>

      <BarraAccionesReporte onConsultar={consultar} onExportarExcel={exportarExcel} />

      <FiltroReporte
        fechaInicial={fechaInicial} fechaFinal={fechaFinal}
        onCambiarFechaInicial={setFechaInicial} onCambiarFechaFinal={setFechaFinal}
        sucursales={sucursales} sucursalId={sucursalId} onCambiarSucursal={setSucursalId}
        hijos={
          <div>
            <label className="text-xs text-slate-500 block mb-1">Vendedor</label>
            <select value={vendedorId} onChange={(e) => setVendedorId(e.target.value)} className="border border-slate-300 rounded px-2 py-1.5 text-sm">
              <option value="">Todos</option>
              {vendedores.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
            </select>
          </div>
        }
      />

      <div className="bg-white border-b border-slate-200 flex no-imprimir">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm border-b-2 ${tab === t.id ? "border-[#1a7fe8] text-[#1a7fe8] font-medium" : "border-transparent text-slate-500"}`}>
            {t.etiqueta}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {cargando ? (
          <p className="text-center text-slate-400 py-16">Consultando...</p>
        ) : !datos ? (
          <p className="text-center text-slate-400 py-16">Sin datos</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[#1a7fe8] text-white sticky top-0">
              <tr>
                <th className="py-2 px-3 text-left font-medium">{tab === "porArticulo" ? "Producto" : "Departamento"}</th>
                <th className="py-2 px-3 text-right font-medium">Venta</th>
                <th className="py-2 px-3 text-right font-medium">Costo</th>
                <th className="py-2 px-3 text-right font-medium">Utilidad</th>
              </tr>
            </thead>
            <tbody>
              {filas.length === 0 && <tr><td colSpan={4} className="text-center text-slate-400 py-16">Sin resultados</td></tr>}
              {filas.map((f, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="py-2 px-3">{f.producto || f.departamento}</td>
                  <td className="py-2 px-3 text-right">${f.venta.toFixed(2)}</td>
                  <td className="py-2 px-3 text-right">${f.costo.toFixed(2)}</td>
                  <td className={`py-2 px-3 text-right font-medium ${f.utilidad < 0 ? "text-red-600" : "text-emerald-700"}`}>${f.utilidad.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {datos && (
        <div className="bg-slate-800 text-white px-4 py-2 flex items-center justify-between text-xs shrink-0 no-imprimir">
          <span>Venta: ${datos.totales.venta.toFixed(2)} — Costo: ${datos.totales.costo.toFixed(2)}</span>
          <span>Utilidad: <b>${datos.totales.utilidad.toFixed(2)}</b> ({datos.totales.margen_pct.toFixed(1)}% margen)</span>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Verificar el build del frontend**

Run: `npm run build`
Expected: build exitoso.

- [ ] **Step 8: Commit**

```bash
git add backend/reportes.js backend/reportes.test.js backend/server.js src/reportes/ReporteUtilidad.jsx
git commit -m "feat: add Reporte de Utilidad / Ganancia"
```

---

### Task 4: Reporte de Compras

**Files:**
- Modify: `backend/reportes.js`
- Modify: `backend/reportes.test.js`
- Modify: `backend/server.js`
- Modify: `src/reportes/ReporteCompras.jsx`

**Interfaces:**
- Consumes: `redondear`, `enRango`, `filtrarPorSucursal` (igual que tasks anteriores).
- Produces: `reporteCompras(DB, { fecha_inicio, fecha_fin, proveedor_id }, alcance) → { general, porProveedor, porArticulo, totales: { numero_compras, total } }`. Ruta `GET /api/reportes/compras`.

- [ ] **Step 1: Escribir la prueba de `reporteCompras`**

Agregar a `backend/reportes.test.js`:

```js
const { reporteCompras } = require("./reportes");

function seedCompra(DB) {
  DB["catalogo-productos"].proveedores.push({ id: 1, nombre: "Proveedor Uno", rfc: "" });
  DB.inventario.compras.push({ id: 1, proveedor_id: 1, factura: "F-001", sucursal_id: 1, fecha: "2026-06-01T10:00:00.000Z" });
  DB.inventario.compra_detalle.push({ id: 1, compra_id: 1, producto_id: 1, cantidad: 10, costo: 18 });
}

test("reporteCompras: agrupa por proveedor y por artículo, con total", () => {
  const DB = construirDBPrueba();
  seedCompra(DB);
  const r = reporteCompras(DB, { fecha_inicio: "2026-05-01", fecha_fin: "2026-06-30" }, ALCANCE_TODAS);

  assert.strictEqual(r.general.length, 1);
  assert.strictEqual(r.general[0].total, 180);
  assert.strictEqual(r.porProveedor[0].proveedor, "Proveedor Uno");
  assert.strictEqual(r.porProveedor[0].total, 180);
  assert.strictEqual(r.porArticulo[0].producto, "Arroz 1kg");
  assert.strictEqual(r.porArticulo[0].cantidad, 10);
  assert.strictEqual(r.totales.total, 180);
  assert.strictEqual(r.totales.numero_compras, 1);
});

test("reporteCompras: filtra por proveedor_id", () => {
  const DB = construirDBPrueba();
  seedCompra(DB);
  DB["catalogo-productos"].proveedores.push({ id: 2, nombre: "Proveedor Dos", rfc: "" });
  DB.inventario.compras.push({ id: 2, proveedor_id: 2, factura: "F-002", sucursal_id: 1, fecha: "2026-06-02T10:00:00.000Z" });
  DB.inventario.compra_detalle.push({ id: 2, compra_id: 2, producto_id: 2, cantidad: 5, costo: 10 });

  const r = reporteCompras(DB, { fecha_inicio: "2026-05-01", fecha_fin: "2026-06-30", proveedor_id: 2 }, ALCANCE_TODAS);
  assert.strictEqual(r.general.length, 1);
  assert.strictEqual(r.general[0].proveedor_nombre, "Proveedor Dos");
});

test("reporteCompras: respeta el alcance de sucursal", () => {
  const DB = construirDBPrueba();
  seedCompra(DB);
  DB.inventario.compras.push({ id: 2, proveedor_id: 1, factura: "F-003", sucursal_id: 2, fecha: "2026-06-03T10:00:00.000Z" });
  DB.inventario.compra_detalle.push({ id: 2, compra_id: 2, producto_id: 1, cantidad: 3, costo: 18 });

  const r = reporteCompras(DB, { fecha_inicio: "2026-05-01", fecha_fin: "2026-06-30" }, { verTodas: false, sucursalId: 1 });
  assert.strictEqual(r.general.length, 1, "solo la compra de la sucursal 1");
});
```

- [ ] **Step 2: Correr la prueba para verificar que falla**

Run: `cd backend && npx node --test reportes.test.js`
Expected: FAIL — `reporteCompras is not a function`.

- [ ] **Step 3: Implementar `reporteCompras` en `backend/reportes.js`**

```js
function reporteCompras(DB, filtros, alcance) {
  const { fecha_inicio, fecha_fin, proveedor_id } = filtros;
  let compras = filtrarPorSucursal(DB.inventario.compras, alcance)
    .filter((c) => enRango(c.fecha.slice(0, 10), fecha_inicio, fecha_fin));
  if (proveedor_id) compras = compras.filter((c) => c.proveedor_id === Number(proveedor_id));

  const idsCompras = new Set(compras.map((c) => c.id));
  const detalle = DB.inventario.compra_detalle.filter((d) => idsCompras.has(d.compra_id));

  const nombreProveedor = (id) => (DB["catalogo-productos"].proveedores.find((p) => p.id === id) || {}).nombre || "—";
  const totalDeCompra = (compraId) => DB.inventario.compra_detalle
    .filter((d) => d.compra_id === compraId)
    .reduce((a, d) => a + d.costo * d.cantidad, 0);

  const general = compras.map((c) => ({
    id: c.id, fecha: c.fecha.slice(0, 10), proveedor_nombre: nombreProveedor(c.proveedor_id),
    factura: c.factura || "", total: redondear(totalDeCompra(c.id)),
  })).sort((a, b) => a.fecha.localeCompare(b.fecha));

  const porProveedorMapa = new Map();
  general.forEach((f) => {
    const actual = porProveedorMapa.get(f.proveedor_nombre) || { proveedor: f.proveedor_nombre, numero_compras: 0, total: 0 };
    actual.numero_compras += 1; actual.total += f.total;
    porProveedorMapa.set(f.proveedor_nombre, actual);
  });

  const porArticuloMapa = new Map();
  detalle.forEach((d) => {
    const producto = DB["catalogo-productos"].productos.find((p) => p.id === d.producto_id);
    const nombre = producto ? producto.nombre : "Producto";
    const actual = porArticuloMapa.get(nombre) || { producto: nombre, cantidad: 0, importe: 0 };
    actual.cantidad += d.cantidad; actual.importe += d.costo * d.cantidad;
    porArticuloMapa.set(nombre, actual);
  });

  return {
    general,
    porProveedor: [...porProveedorMapa.values()].map((f) => ({ ...f, total: redondear(f.total) })).sort((a, b) => b.total - a.total),
    porArticulo: [...porArticuloMapa.values()].map((f) => ({ ...f, importe: redondear(f.importe) })).sort((a, b) => b.importe - a.importe),
    totales: { numero_compras: general.length, total: redondear(general.reduce((a, f) => a + f.total, 0)) },
  };
}
```

Actualizar `module.exports`:

```js
module.exports = { redondear, enRango, reporteVentas, reporteUtilidad, reporteCompras };
```

- [ ] **Step 4: Correr la prueba para verificar que pasa**

Run: `cd backend && npx node --test reportes.test.js`
Expected: 15 pruebas, todas PASS.

- [ ] **Step 5: Exponer la ruta en `server.js`**

```js
const { reporteVentas, reporteUtilidad, reporteCompras } = require("./reportes");
```

```js
app.get("/api/reportes/compras", requiereLogin, requierePermiso("ver_reportes", resolverPermisosDeRol), (req, res) => {
  const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
  const { fecha_inicio, fecha_fin, proveedor_id } = req.query;
  res.json(reporteCompras(DB, { fecha_inicio, fecha_fin, proveedor_id }, alcance));
});
```

- [ ] **Step 6: Implementar `src/reportes/ReporteCompras.jsx`**

Reemplazar el contenido completo del archivo:

```jsx
import React, { useState, useEffect, useCallback } from "react";
import { ChevronLeft } from "lucide-react";
import { apiFetch } from "../api";
import FiltroReporte from "./FiltroReporte.jsx";
import BarraAccionesReporte from "./BarraAccionesReporte.jsx";
import { descargarCSV } from "./exportarCSV.js";

const hoyFmt = () => new Date().toISOString().slice(0, 10);
const hace30 = () => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10); };

const TABS = [
  { id: "general", etiqueta: "General" },
  { id: "porProveedor", etiqueta: "Por Proveedor" },
  { id: "porArticulo", etiqueta: "Por Artículo" },
];

export default function ReporteCompras({ onVolver }) {
  const [fechaInicial, setFechaInicial] = useState(hace30());
  const [fechaFinal, setFechaFinal] = useState(hoyFmt());
  const [sucursalId, setSucursalId] = useState("");
  const [proveedorId, setProveedorId] = useState("");
  const [sucursales, setSucursales] = useState([]);
  const [proveedores, setProveedores] = useState([]);
  const [tab, setTab] = useState("general");
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    apiFetch("/sucursales").then((r) => r.ok && r.json()).then((d) => d && setSucursales(d));
    apiFetch("/proveedores").then((r) => r.ok && r.json()).then((d) => d && setProveedores(d));
  }, []);

  const consultar = useCallback(async () => {
    setCargando(true);
    const params = new URLSearchParams();
    if (fechaInicial) params.set("fecha_inicio", fechaInicial);
    if (fechaFinal) params.set("fecha_fin", fechaFinal);
    if (sucursalId) params.set("sucursal_id", sucursalId);
    if (proveedorId) params.set("proveedor_id", proveedorId);
    const r = await apiFetch(`/reportes/compras?${params.toString()}`);
    if (r.ok) setDatos(await r.json());
    setCargando(false);
  }, [fechaInicial, fechaFinal, sucursalId, proveedorId]);

  useEffect(() => { consultar(); }, [consultar]);

  const exportarExcel = () => {
    if (!datos) return;
    if (tab === "general") {
      descargarCSV(`compras_general_${fechaInicial}_a_${fechaFinal}.csv`,
        ["Fecha", "Folio", "Proveedor", "Factura", "Total"],
        datos.general.map((f) => [f.fecha, f.id, f.proveedor_nombre, f.factura, f.total]));
    } else if (tab === "porProveedor") {
      descargarCSV(`compras_por_proveedor_${fechaInicial}_a_${fechaFinal}.csv`,
        ["Proveedor", "No. Compras", "Total"], datos.porProveedor.map((f) => [f.proveedor, f.numero_compras, f.total]));
    } else {
      descargarCSV(`compras_por_articulo_${fechaInicial}_a_${fechaFinal}.csv`,
        ["Producto", "Cantidad", "Importe"], datos.porArticulo.map((f) => [f.producto, f.cantidad, f.importe]));
    }
  };

  return (
    <div className="w-full h-full flex flex-col bg-slate-50 text-slate-800 text-sm">
      <div className="bg-white border-b border-slate-100 px-4 py-2 flex items-center gap-2 no-imprimir">
        <button onClick={onVolver} className="flex items-center gap-1 text-sm text-[#1a7fe8] hover:underline">
          <ChevronLeft size={16} /> Reportes
        </button>
        <h2 className="font-semibold text-slate-700 ml-2">Reporte de Compras</h2>
      </div>

      <BarraAccionesReporte onConsultar={consultar} onExportarExcel={exportarExcel} />

      <FiltroReporte
        fechaInicial={fechaInicial} fechaFinal={fechaFinal}
        onCambiarFechaInicial={setFechaInicial} onCambiarFechaFinal={setFechaFinal}
        sucursales={sucursales} sucursalId={sucursalId} onCambiarSucursal={setSucursalId}
        hijos={
          <div>
            <label className="text-xs text-slate-500 block mb-1">Proveedor</label>
            <select value={proveedorId} onChange={(e) => setProveedorId(e.target.value)} className="border border-slate-300 rounded px-2 py-1.5 text-sm">
              <option value="">Todos</option>
              {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </div>
        }
      />

      <div className="bg-white border-b border-slate-200 flex no-imprimir">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm border-b-2 ${tab === t.id ? "border-[#1a7fe8] text-[#1a7fe8] font-medium" : "border-transparent text-slate-500"}`}>
            {t.etiqueta}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {cargando ? (
          <p className="text-center text-slate-400 py-16">Consultando...</p>
        ) : !datos ? (
          <p className="text-center text-slate-400 py-16">Sin datos</p>
        ) : tab === "general" ? (
          <table className="w-full text-sm">
            <thead className="bg-[#1a7fe8] text-white sticky top-0">
              <tr><th className="py-2 px-3 text-left font-medium">Fecha</th><th className="py-2 px-3 text-left font-medium">Folio</th><th className="py-2 px-3 text-left font-medium">Proveedor</th><th className="py-2 px-3 text-left font-medium">Factura</th><th className="py-2 px-3 text-right font-medium">Total</th></tr>
            </thead>
            <tbody>
              {datos.general.length === 0 && <tr><td colSpan={5} className="text-center text-slate-400 py-16">Sin resultados</td></tr>}
              {datos.general.map((f) => (
                <tr key={f.id} className="border-b border-slate-100">
                  <td className="py-2 px-3">{f.fecha}</td>
                  <td className="py-2 px-3 font-medium">{f.id}</td>
                  <td className="py-2 px-3">{f.proveedor_nombre}</td>
                  <td className="py-2 px-3">{f.factura}</td>
                  <td className="py-2 px-3 text-right font-medium">${f.total.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : tab === "porProveedor" ? (
          <table className="w-full text-sm">
            <thead className="bg-[#1a7fe8] text-white sticky top-0">
              <tr><th className="py-2 px-3 text-left font-medium">Proveedor</th><th className="py-2 px-3 text-right font-medium">No. Compras</th><th className="py-2 px-3 text-right font-medium">Total</th></tr>
            </thead>
            <tbody>
              {datos.porProveedor.length === 0 && <tr><td colSpan={3} className="text-center text-slate-400 py-16">Sin resultados</td></tr>}
              {datos.porProveedor.map((f, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="py-2 px-3">{f.proveedor}</td>
                  <td className="py-2 px-3 text-right">{f.numero_compras}</td>
                  <td className="py-2 px-3 text-right font-medium">${f.total.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[#1a7fe8] text-white sticky top-0">
              <tr><th className="py-2 px-3 text-left font-medium">Producto</th><th className="py-2 px-3 text-right font-medium">Cantidad</th><th className="py-2 px-3 text-right font-medium">Importe</th></tr>
            </thead>
            <tbody>
              {datos.porArticulo.length === 0 && <tr><td colSpan={3} className="text-center text-slate-400 py-16">Sin resultados</td></tr>}
              {datos.porArticulo.map((f, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="py-2 px-3">{f.producto}</td>
                  <td className="py-2 px-3 text-right">{f.cantidad}</td>
                  <td className="py-2 px-3 text-right font-medium">${f.importe.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {datos && (
        <div className="bg-slate-800 text-white px-4 py-2 flex items-center justify-between text-xs shrink-0 no-imprimir">
          <span>{datos.totales.numero_compras} recepción(es)</span>
          <span>Total: <b>${datos.totales.total.toFixed(2)}</b></span>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Verificar el build del frontend**

Run: `npm run build`
Expected: build exitoso.

- [ ] **Step 8: Commit**

```bash
git add backend/reportes.js backend/reportes.test.js backend/server.js src/reportes/ReporteCompras.jsx
git commit -m "feat: add Reporte de Compras"
```

---

### Task 5: Reporte de Cortes de Caja

**Files:**
- Modify: `backend/reportes.js`
- Modify: `backend/reportes.test.js`
- Modify: `backend/server.js`
- Modify: `src/reportes/ReporteCortesCaja.jsx`

**Interfaces:**
- Consumes: `redondear`, `enRango`, `filtrarPorSucursal` (igual que tasks anteriores).
- Produces: `reporteCortesCaja(DB, { fecha_inicio, fecha_fin }, alcance) → { filas, totales: { numero_cortes, total_calculado, total_contado, total_diferencia, total_retiro } }`. Ruta `GET /api/reportes/cortes-caja`.

- [ ] **Step 1: Escribir la prueba de `reporteCortesCaja`**

Agregar a `backend/reportes.test.js`:

```js
const { reporteCortesCaja } = require("./reportes");

function seedCorte(DB) {
  DB.pos.cortes_caja.push({
    id: 1, sucursal_id: 1, usuario_nombre: "Ana López", fecha: "2026-06-10",
    total_calculado: 1000, total_contado: 980, total_diferencia: -20, total_retiro: 900,
  });
}

test("reporteCortesCaja: lista cortes en el rango y suma totales", () => {
  const DB = construirDBPrueba();
  seedCorte(DB);
  const r = reporteCortesCaja(DB, { fecha_inicio: "2026-06-01", fecha_fin: "2026-06-30" }, ALCANCE_TODAS);

  assert.strictEqual(r.filas.length, 1);
  assert.strictEqual(r.filas[0].sucursal_nombre, "Ocosingo");
  assert.strictEqual(r.totales.numero_cortes, 1);
  assert.strictEqual(r.totales.total_calculado, 1000);
  assert.strictEqual(r.totales.total_contado, 980);
  assert.strictEqual(r.totales.total_diferencia, -20);
  assert.strictEqual(r.totales.total_retiro, 900);
});

test("reporteCortesCaja: respeta el rango de fechas y el alcance de sucursal", () => {
  const DB = construirDBPrueba();
  seedCorte(DB);
  DB.pos.cortes_caja.push({
    id: 2, sucursal_id: 2, usuario_nombre: "María R.", fecha: "2026-06-15",
    total_calculado: 500, total_contado: 500, total_diferencia: 0, total_retiro: 400,
  });

  const fueraDeRango = reporteCortesCaja(DB, { fecha_inicio: "2026-07-01", fecha_fin: "2026-07-31" }, ALCANCE_TODAS);
  assert.strictEqual(fueraDeRango.filas.length, 0);

  const soloSucursal1 = reporteCortesCaja(DB, { fecha_inicio: "2026-06-01", fecha_fin: "2026-06-30" }, { verTodas: false, sucursalId: 1 });
  assert.strictEqual(soloSucursal1.filas.length, 1);
  assert.strictEqual(soloSucursal1.filas[0].sucursal_nombre, "Ocosingo");
});
```

- [ ] **Step 2: Correr la prueba para verificar que falla**

Run: `cd backend && npx node --test reportes.test.js`
Expected: FAIL — `reporteCortesCaja is not a function`.

- [ ] **Step 3: Implementar `reporteCortesCaja` en `backend/reportes.js`**

```js
function reporteCortesCaja(DB, filtros, alcance) {
  const { fecha_inicio, fecha_fin } = filtros;
  const cortes = filtrarPorSucursal(DB.pos.cortes_caja, alcance)
    .filter((c) => enRango(c.fecha, fecha_inicio, fecha_fin));

  const nombreSucursal = (id) => (DB.pos.sucursales.find((s) => s.id === id) || {}).nombre || "—";

  const filas = cortes.map((c) => ({
    id: c.id, fecha: c.fecha, sucursal_nombre: nombreSucursal(c.sucursal_id), usuario_nombre: c.usuario_nombre,
    total_calculado: c.total_calculado, total_contado: c.total_contado, total_diferencia: c.total_diferencia,
    total_retiro: c.total_retiro,
  })).sort((a, b) => a.fecha.localeCompare(b.fecha));

  return {
    filas,
    totales: {
      numero_cortes: filas.length,
      total_calculado: redondear(filas.reduce((a, f) => a + f.total_calculado, 0)),
      total_contado: redondear(filas.reduce((a, f) => a + f.total_contado, 0)),
      total_diferencia: redondear(filas.reduce((a, f) => a + f.total_diferencia, 0)),
      total_retiro: redondear(filas.reduce((a, f) => a + f.total_retiro, 0)),
    },
  };
}
```

Actualizar `module.exports`:

```js
module.exports = { redondear, enRango, reporteVentas, reporteUtilidad, reporteCompras, reporteCortesCaja };
```

- [ ] **Step 4: Correr la prueba para verificar que pasa**

Run: `cd backend && npx node --test reportes.test.js`
Expected: 17 pruebas, todas PASS.

- [ ] **Step 5: Exponer la ruta en `server.js`**

```js
const { reporteVentas, reporteUtilidad, reporteCompras, reporteCortesCaja } = require("./reportes");
```

```js
app.get("/api/reportes/cortes-caja", requiereLogin, requierePermiso("ver_reportes", resolverPermisosDeRol), (req, res) => {
  const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
  const { fecha_inicio, fecha_fin } = req.query;
  res.json(reporteCortesCaja(DB, { fecha_inicio, fecha_fin }, alcance));
});
```

- [ ] **Step 6: Implementar `src/reportes/ReporteCortesCaja.jsx`**

Reemplazar el contenido completo del archivo:

```jsx
import React, { useState, useEffect, useCallback } from "react";
import { ChevronLeft } from "lucide-react";
import { apiFetch } from "../api";
import FiltroReporte from "./FiltroReporte.jsx";
import BarraAccionesReporte from "./BarraAccionesReporte.jsx";
import { descargarCSV } from "./exportarCSV.js";

const hoyFmt = () => new Date().toISOString().slice(0, 10);
const hace30 = () => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10); };

export default function ReporteCortesCaja({ onVolver }) {
  const [fechaInicial, setFechaInicial] = useState(hace30());
  const [fechaFinal, setFechaFinal] = useState(hoyFmt());
  const [sucursalId, setSucursalId] = useState("");
  const [sucursales, setSucursales] = useState([]);
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    apiFetch("/sucursales").then((r) => r.ok && r.json()).then((d) => d && setSucursales(d));
  }, []);

  const consultar = useCallback(async () => {
    setCargando(true);
    const params = new URLSearchParams();
    if (fechaInicial) params.set("fecha_inicio", fechaInicial);
    if (fechaFinal) params.set("fecha_fin", fechaFinal);
    if (sucursalId) params.set("sucursal_id", sucursalId);
    const r = await apiFetch(`/reportes/cortes-caja?${params.toString()}`);
    if (r.ok) setDatos(await r.json());
    setCargando(false);
  }, [fechaInicial, fechaFinal, sucursalId]);

  useEffect(() => { consultar(); }, [consultar]);

  const exportarExcel = () => {
    if (!datos) return;
    descargarCSV(`cortes_de_caja_${fechaInicial}_a_${fechaFinal}.csv`,
      ["Fecha", "Folio", "Sucursal", "Usuario", "Calculado", "Contado", "Diferencia", "Retiro"],
      datos.filas.map((f) => [f.fecha, f.id, f.sucursal_nombre, f.usuario_nombre, f.total_calculado, f.total_contado, f.total_diferencia, f.total_retiro]));
  };

  return (
    <div className="w-full h-full flex flex-col bg-slate-50 text-slate-800 text-sm">
      <div className="bg-white border-b border-slate-100 px-4 py-2 flex items-center gap-2 no-imprimir">
        <button onClick={onVolver} className="flex items-center gap-1 text-sm text-[#1a7fe8] hover:underline">
          <ChevronLeft size={16} /> Reportes
        </button>
        <h2 className="font-semibold text-slate-700 ml-2">Reporte de Cortes de Caja</h2>
      </div>

      <BarraAccionesReporte onConsultar={consultar} onExportarExcel={exportarExcel} />

      <FiltroReporte
        fechaInicial={fechaInicial} fechaFinal={fechaFinal}
        onCambiarFechaInicial={setFechaInicial} onCambiarFechaFinal={setFechaFinal}
        sucursales={sucursales} sucursalId={sucursalId} onCambiarSucursal={setSucursalId}
      />

      <div className="flex-1 overflow-y-auto">
        {cargando ? (
          <p className="text-center text-slate-400 py-16">Consultando...</p>
        ) : !datos ? (
          <p className="text-center text-slate-400 py-16">Sin datos</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[#1a7fe8] text-white sticky top-0">
              <tr>
                <th className="py-2 px-3 text-left font-medium">Fecha</th>
                <th className="py-2 px-3 text-left font-medium">Folio</th>
                <th className="py-2 px-3 text-left font-medium">Sucursal</th>
                <th className="py-2 px-3 text-left font-medium">Usuario</th>
                <th className="py-2 px-3 text-right font-medium">Calculado</th>
                <th className="py-2 px-3 text-right font-medium">Contado</th>
                <th className="py-2 px-3 text-right font-medium">Diferencia</th>
                <th className="py-2 px-3 text-right font-medium">Retiro</th>
              </tr>
            </thead>
            <tbody>
              {datos.filas.length === 0 && <tr><td colSpan={8} className="text-center text-slate-400 py-16">Sin resultados</td></tr>}
              {datos.filas.map((f) => (
                <tr key={f.id} className="border-b border-slate-100">
                  <td className="py-2 px-3">{f.fecha}</td>
                  <td className="py-2 px-3 font-medium">{f.id}</td>
                  <td className="py-2 px-3">{f.sucursal_nombre}</td>
                  <td className="py-2 px-3">{f.usuario_nombre}</td>
                  <td className="py-2 px-3 text-right">${f.total_calculado.toFixed(2)}</td>
                  <td className="py-2 px-3 text-right">${f.total_contado.toFixed(2)}</td>
                  <td className={`py-2 px-3 text-right ${f.total_diferencia < 0 ? "text-red-600" : "text-emerald-700"}`}>${f.total_diferencia.toFixed(2)}</td>
                  <td className="py-2 px-3 text-right font-medium">${f.total_retiro.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {datos && (
        <div className="bg-slate-800 text-white px-4 py-2 flex items-center justify-between text-xs shrink-0 no-imprimir">
          <span>{datos.totales.numero_cortes} corte(s)</span>
          <span>Calculado: ${datos.totales.total_calculado.toFixed(2)} — Contado: ${datos.totales.total_contado.toFixed(2)} — Retiro: <b>${datos.totales.total_retiro.toFixed(2)}</b></span>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Verificar el build del frontend**

Run: `npm run build`
Expected: build exitoso.

- [ ] **Step 8: Commit**

```bash
git add backend/reportes.js backend/reportes.test.js backend/server.js src/reportes/ReporteCortesCaja.jsx
git commit -m "feat: add Reporte de Cortes de Caja"
```

---

### Task 6: Reporte de Existencias / Inventario

**Files:**
- Modify: `backend/reportes.js`
- Modify: `backend/reportes.test.js`
- Modify: `backend/server.js`
- Modify: `src/reportes/ReporteExistencias.jsx`

**Interfaces:**
- Consumes: `redondear` (igual que tasks anteriores). No usa `enRango`/fechas — es una fotografía del inventario actual, no un reporte por periodo.
- Produces: `reporteExistencias(DB, { departamento_id, estado }, alcance) → { filas, sinMovimiento, totales: { numero_articulos, valor_a_costo, valor_a_precio_venta } }`. Ruta `GET /api/reportes/existencias`.

- [ ] **Step 1: Escribir la prueba de `reporteExistencias`**

Agregar a `backend/reportes.test.js`:

```js
const { reporteExistencias } = require("./reportes");

test("reporteExistencias: calcula valor de inventario a costo y a precio de venta", () => {
  const DB = construirDBPrueba();
  const r = reporteExistencias(DB, {}, ALCANCE_TODAS);
  const arroz = r.filas.find((f) => f.nombre === "Arroz 1kg");
  assert.ok(arroz);
  assert.strictEqual(arroz.cantidad, 120, "existencia semilla del producto 1 en sucursal 1");
  assert.strictEqual(arroz.valor_a_costo, 120 * 20);
  assert.strictEqual(arroz.valor_a_precio_venta, 120 * 25);
});

test("reporteExistencias: filtra por estado 'bajo_minimo'", () => {
  const DB = construirDBPrueba();
  DB.inventario.existencias.push({ producto_id: 1, sucursal_id: 4, cantidad_actual: 5, cantidad_minima: 30, cantidad_maxima: 300 });
  const r = reporteExistencias(DB, { estado: "bajo_minimo" }, { verTodas: false, sucursalId: 4 });
  assert.strictEqual(r.filas.length, 1);
  assert.strictEqual(r.filas[0].nombre, "Arroz 1kg");
});

test("reporteExistencias: filtra por estado 'sin_existencia'", () => {
  const DB = construirDBPrueba();
  const r = reporteExistencias(DB, { estado: "sin_existencia" }, { verTodas: false, sucursalId: 1 });
  // producto 2 y 3 no tienen registro de existencia en sucursal 1 en el DB de prueba
  const nombres = r.filas.map((f) => f.nombre);
  assert.ok(nombres.includes("Refresco 600ml"));
});

test("reporteExistencias: marca productos sin ninguna línea de venta como sin movimiento", () => {
  const DB = construirDBPrueba();
  // producto 1 sí tiene venta_detalle (id 1); producto 2 y 3 tienen otras ventas.
  // Ninguno de los 3 productos semilla queda sin movimiento; se agrega un 4to sin ventas.
  DB["catalogo-productos"].productos.push({ id: 4, sku: "X-1", nombre: "Sin Ventas", costo: 5, precio_venta: 8, precios: [], activo: true });
  DB.inventario.existencias.push({ producto_id: 4, sucursal_id: 1, cantidad_actual: 10, cantidad_minima: 0, cantidad_maxima: 0 });

  const r = reporteExistencias(DB, {}, ALCANCE_TODAS);
  const sinMovimientoNombres = r.sinMovimiento.map((f) => f.nombre);
  assert.ok(sinMovimientoNombres.includes("Sin Ventas"));
  assert.ok(!sinMovimientoNombres.includes("Arroz 1kg"), "Arroz sí tiene venta_detalle");
});

test("reporteExistencias: filtra por departamento_id", () => {
  const DB = construirDBPrueba();
  DB["catalogo-productos"].departamentos.push({ id: 1, nombre: "Abarrotes" });
  DB["catalogo-productos"].productos.find((p) => p.id === 1).departamento_id = 1;
  const r = reporteExistencias(DB, { departamento_id: 1 }, ALCANCE_TODAS);
  assert.strictEqual(r.filas.length, 1);
  assert.strictEqual(r.filas[0].nombre, "Arroz 1kg");
});
```

- [ ] **Step 2: Correr la prueba para verificar que falla**

Run: `cd backend && npx node --test reportes.test.js`
Expected: FAIL — `reporteExistencias is not a function`.

- [ ] **Step 3: Implementar `reporteExistencias` en `backend/reportes.js`**

```js
function reporteExistencias(DB, filtros, alcance) {
  const { departamento_id, estado } = filtros;
  const sucursalesVisibles = alcance.verTodas
    ? DB.pos.sucursales.map((s) => s.id)
    : [alcance.sucursalId];

  const filas = DB["catalogo-productos"].productos
    .filter((p) => !departamento_id || p.departamento_id === Number(departamento_id))
    .map((p) => {
      const existenciasProducto = DB.inventario.existencias.filter(
        (e) => e.producto_id === p.id && sucursalesVisibles.includes(e.sucursal_id)
      );
      const cantidad = existenciasProducto.reduce((a, e) => a + (e.cantidad_actual || 0), 0);
      const minima = existenciasProducto.reduce((a, e) => a + (e.cantidad_minima || 0), 0);
      const maxima = existenciasProducto.reduce((a, e) => a + (e.cantidad_maxima || 0), 0);
      const departamento = DB["catalogo-productos"].departamentos.find((d) => d.id === p.departamento_id);
      const costo = Number(p.costo) || 0;
      const precioVenta = Number(p.precio_venta) || 0;
      return {
        producto_id: p.id, nombre: p.nombre, sku: p.sku,
        departamento_nombre: departamento ? departamento.nombre : "Sin departamento",
        cantidad, minima, maxima, costo, precio_venta: precioVenta,
        valor_a_costo: redondear(cantidad * costo),
        valor_a_precio_venta: redondear(cantidad * precioVenta),
      };
    })
    .filter((f) => {
      if (estado === "con_existencia") return f.cantidad > 0;
      if (estado === "sin_existencia") return f.cantidad <= 0;
      if (estado === "sobre_maximo") return f.maxima > 0 && f.cantidad > f.maxima;
      if (estado === "bajo_minimo") return f.minima > 0 && f.cantidad < f.minima;
      return true;
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre));

  const idsConMovimiento = new Set(DB.pos.venta_detalle.map((d) => d.producto_id));
  const sinMovimiento = filas.filter((f) => !idsConMovimiento.has(f.producto_id));

  return {
    filas, sinMovimiento,
    totales: {
      numero_articulos: filas.length,
      valor_a_costo: redondear(filas.reduce((a, f) => a + f.valor_a_costo, 0)),
      valor_a_precio_venta: redondear(filas.reduce((a, f) => a + f.valor_a_precio_venta, 0)),
    },
  };
}
```

Actualizar `module.exports`:

```js
module.exports = { redondear, enRango, reporteVentas, reporteUtilidad, reporteCompras, reporteCortesCaja, reporteExistencias };
```

- [ ] **Step 4: Correr la prueba para verificar que pasa**

Run: `cd backend && npx node --test reportes.test.js`
Expected: 22 pruebas, todas PASS.

- [ ] **Step 5: Exponer la ruta en `server.js`**

```js
const { reporteVentas, reporteUtilidad, reporteCompras, reporteCortesCaja, reporteExistencias } = require("./reportes");
```

```js
app.get("/api/reportes/existencias", requiereLogin, requierePermiso("ver_reportes", resolverPermisosDeRol), (req, res) => {
  const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
  const { departamento_id, estado } = req.query;
  res.json(reporteExistencias(DB, { departamento_id, estado }, alcance));
});
```

- [ ] **Step 6: Implementar `src/reportes/ReporteExistencias.jsx`**

Reemplazar el contenido completo del archivo:

```jsx
import React, { useState, useEffect, useCallback } from "react";
import { ChevronLeft } from "lucide-react";
import { apiFetch } from "../api";
import BarraAccionesReporte from "./BarraAccionesReporte.jsx";
import { descargarCSV } from "./exportarCSV.js";

const ESTADOS = [
  { id: "", etiqueta: "Todos" },
  { id: "con_existencia", etiqueta: "Con existencia" },
  { id: "sin_existencia", etiqueta: "Sin existencia" },
  { id: "sobre_maximo", etiqueta: "Sobre máximo" },
  { id: "bajo_minimo", etiqueta: "Bajo mínimo" },
];

export default function ReporteExistencias({ onVolver }) {
  const [departamentoId, setDepartamentoId] = useState("");
  const [estado, setEstado] = useState("");
  const [departamentos, setDepartamentos] = useState([]);
  const [tab, setTab] = useState("existencias");
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    apiFetch("/departamentos").then((r) => r.ok && r.json()).then((d) => d && setDepartamentos(d));
  }, []);

  const consultar = useCallback(async () => {
    setCargando(true);
    const params = new URLSearchParams();
    if (departamentoId) params.set("departamento_id", departamentoId);
    if (estado) params.set("estado", estado);
    const r = await apiFetch(`/reportes/existencias?${params.toString()}`);
    if (r.ok) setDatos(await r.json());
    setCargando(false);
  }, [departamentoId, estado]);

  useEffect(() => { consultar(); }, [consultar]);

  const exportarExcel = () => {
    if (!datos) return;
    if (tab === "existencias") {
      descargarCSV("existencias.csv",
        ["Producto", "SKU", "Departamento", "Existencia", "Mínima", "Máxima", "Valor a Costo", "Valor a Precio de Venta"],
        datos.filas.map((f) => [f.nombre, f.sku, f.departamento_nombre, f.cantidad, f.minima, f.maxima, f.valor_a_costo, f.valor_a_precio_venta]));
    } else {
      descargarCSV("articulos_sin_movimiento.csv",
        ["Producto", "SKU", "Departamento", "Existencia"],
        datos.sinMovimiento.map((f) => [f.nombre, f.sku, f.departamento_nombre, f.cantidad]));
    }
  };

  const filas = datos ? (tab === "existencias" ? datos.filas : datos.sinMovimiento) : [];

  return (
    <div className="w-full h-full flex flex-col bg-slate-50 text-slate-800 text-sm">
      <div className="bg-white border-b border-slate-100 px-4 py-2 flex items-center gap-2 no-imprimir">
        <button onClick={onVolver} className="flex items-center gap-1 text-sm text-[#1a7fe8] hover:underline">
          <ChevronLeft size={16} /> Reportes
        </button>
        <h2 className="font-semibold text-slate-700 ml-2">Reporte de Existencias / Inventario</h2>
      </div>

      <BarraAccionesReporte onConsultar={consultar} onExportarExcel={exportarExcel} />

      <div className="bg-white border-b border-slate-200 px-4 py-3 flex flex-wrap gap-3 items-end no-imprimir">
        <div>
          <label className="text-xs text-slate-500 block mb-1">Departamento</label>
          <select value={departamentoId} onChange={(e) => setDepartamentoId(e.target.value)} className="border border-slate-300 rounded px-2 py-1.5 text-sm">
            <option value="">Todos</option>
            {departamentos.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-500 block mb-1">Estado</label>
          <select value={estado} onChange={(e) => setEstado(e.target.value)} className="border border-slate-300 rounded px-2 py-1.5 text-sm">
            {ESTADOS.map((e) => <option key={e.id} value={e.id}>{e.etiqueta}</option>)}
          </select>
        </div>
      </div>

      <div className="bg-white border-b border-slate-200 flex no-imprimir">
        <button onClick={() => setTab("existencias")}
          className={`px-4 py-2 text-sm border-b-2 ${tab === "existencias" ? "border-[#1a7fe8] text-[#1a7fe8] font-medium" : "border-transparent text-slate-500"}`}>
          Existencias
        </button>
        <button onClick={() => setTab("sinMovimiento")}
          className={`px-4 py-2 text-sm border-b-2 ${tab === "sinMovimiento" ? "border-[#1a7fe8] text-[#1a7fe8] font-medium" : "border-transparent text-slate-500"}`}>
          Sin Movimiento
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {cargando ? (
          <p className="text-center text-slate-400 py-16">Consultando...</p>
        ) : !datos ? (
          <p className="text-center text-slate-400 py-16">Sin datos</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[#1a7fe8] text-white sticky top-0">
              <tr>
                <th className="py-2 px-3 text-left font-medium">Producto</th>
                <th className="py-2 px-3 text-left font-medium">SKU</th>
                <th className="py-2 px-3 text-left font-medium">Departamento</th>
                <th className="py-2 px-3 text-right font-medium">Existencia</th>
                {tab === "existencias" && <th className="py-2 px-3 text-right font-medium">Valor a Costo</th>}
                {tab === "existencias" && <th className="py-2 px-3 text-right font-medium">Valor a Precio de Venta</th>}
              </tr>
            </thead>
            <tbody>
              {filas.length === 0 && <tr><td colSpan={6} className="text-center text-slate-400 py-16">Sin resultados</td></tr>}
              {filas.map((f) => (
                <tr key={f.producto_id} className="border-b border-slate-100">
                  <td className="py-2 px-3">{f.nombre}</td>
                  <td className="py-2 px-3">{f.sku}</td>
                  <td className="py-2 px-3">{f.departamento_nombre}</td>
                  <td className="py-2 px-3 text-right">{f.cantidad}</td>
                  {tab === "existencias" && <td className="py-2 px-3 text-right">${f.valor_a_costo.toFixed(2)}</td>}
                  {tab === "existencias" && <td className="py-2 px-3 text-right font-medium">${f.valor_a_precio_venta.toFixed(2)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {datos && tab === "existencias" && (
        <div className="bg-slate-800 text-white px-4 py-2 flex items-center justify-between text-xs shrink-0 no-imprimir">
          <span>{datos.totales.numero_articulos} artículo(s)</span>
          <span>Valor a costo: ${datos.totales.valor_a_costo.toFixed(2)} — Valor a precio de venta: <b>${datos.totales.valor_a_precio_venta.toFixed(2)}</b></span>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Verificar el build del frontend**

Run: `npm run build`
Expected: build exitoso.

- [ ] **Step 8: Commit**

```bash
git add backend/reportes.js backend/reportes.test.js backend/server.js src/reportes/ReporteExistencias.jsx
git commit -m "feat: add Reporte de Existencias / Inventario"
```

---

### Task 7: Estado de Cuenta de Clientes

**Files:**
- Modify: `backend/reportes.js`
- Modify: `backend/reportes.test.js`
- Modify: `backend/server.js`
- Modify: `src/reportes/ReporteEstadoCuentaClientes.jsx`

**Interfaces:**
- Consumes: `redondear`, `filtrarPorSucursal` (igual que tasks anteriores).
- Produces: `reporteEstadoCuentaClientes(DB, { cliente_id }, alcance) → { filas, detalleCliente: { cliente_id, ventas_credito } | null, totales: { numero_clientes, saldo_total, limite_total } }`. Ruta `GET /api/reportes/clientes`.

- [ ] **Step 1: Escribir la prueba de `reporteEstadoCuentaClientes`**

Agregar a `backend/reportes.test.js`:

```js
const { reporteEstadoCuentaClientes } = require("./reportes");

test("reporteEstadoCuentaClientes: calcula credito_disponible y excluye a Público en General", () => {
  const DB = construirDBPrueba();
  DB.crm.clientes.find((c) => c.id === 1).saldo = 1200;
  const r = reporteEstadoCuentaClientes(DB, {}, ALCANCE_TODAS);

  assert.ok(!r.filas.some((f) => f.id === 0), "Público en General no debe aparecer");
  const mary = r.filas.find((f) => f.id === 1);
  assert.strictEqual(mary.limite_credito, 5000);
  assert.strictEqual(mary.saldo, 1200);
  assert.strictEqual(mary.credito_disponible, 3800);
  assert.strictEqual(r.totales.numero_clientes, 2);
});

test("reporteEstadoCuentaClientes: con cliente_id trae el detalle de sus ventas a crédito", () => {
  const DB = construirDBPrueba();
  DB.pos.ventas.push({ id: 99, fecha: "2026-06-20", fecha_hora: "2026-06-20T10:00:00.000Z", sucursal_id: 1, vendedor_id: 1, cliente_id: 1, total: 300, metodo_pago: "CRÉDITO", estatus: "cerrada", motivo_cancelacion: null });
  const r = reporteEstadoCuentaClientes(DB, { cliente_id: 1 }, ALCANCE_TODAS);

  assert.ok(r.detalleCliente);
  assert.strictEqual(r.detalleCliente.cliente_id, 1);
  assert.strictEqual(r.detalleCliente.ventas_credito.length, 1);
  assert.strictEqual(r.detalleCliente.ventas_credito[0].total, 300);
});

test("reporteEstadoCuentaClientes: sin cliente_id no trae detalle", () => {
  const DB = construirDBPrueba();
  const r = reporteEstadoCuentaClientes(DB, {}, ALCANCE_TODAS);
  assert.strictEqual(r.detalleCliente, null);
});

test("reporteEstadoCuentaClientes: respeta el alcance de sucursal", () => {
  const DB = construirDBPrueba();
  const r = reporteEstadoCuentaClientes(DB, {}, { verTodas: false, sucursalId: 2 });
  assert.strictEqual(r.filas.length, 1);
  assert.strictEqual(r.filas[0].nombre, "Juan Pérez");
});
```

- [ ] **Step 2: Correr la prueba para verificar que falla**

Run: `cd backend && npx node --test reportes.test.js`
Expected: FAIL — `reporteEstadoCuentaClientes is not a function`.

- [ ] **Step 3: Implementar `reporteEstadoCuentaClientes` en `backend/reportes.js`**

```js
function reporteEstadoCuentaClientes(DB, filtros, alcance) {
  const { cliente_id } = filtros;
  const clientes = filtrarPorSucursal(DB.crm.clientes.filter((c) => c.id !== 0), alcance);

  const filas = clientes.map((c) => ({
    id: c.id, clave: c.clave || "", nombre: c.nombre,
    limite_credito: Number(c.limite_credito) || 0, saldo: Number(c.saldo) || 0,
    credito_disponible: Math.max(0, (Number(c.limite_credito) || 0) - (Number(c.saldo) || 0)),
  })).sort((a, b) => a.nombre.localeCompare(b.nombre));

  let detalleCliente = null;
  if (cliente_id) {
    const ventasCredito = DB.pos.ventas
      .filter((v) => v.cliente_id === Number(cliente_id) && v.estatus !== "cancelada")
      .filter((v) => (v.metodo_pago || "").toUpperCase().startsWith("CR"))
      .map((v) => ({ id: v.id, fecha: v.fecha, total: v.total }))
      .sort((a, b) => a.fecha.localeCompare(b.fecha));
    detalleCliente = { cliente_id: Number(cliente_id), ventas_credito: ventasCredito };
  }

  return {
    filas, detalleCliente,
    totales: {
      numero_clientes: filas.length,
      saldo_total: redondear(filas.reduce((a, f) => a + f.saldo, 0)),
      limite_total: redondear(filas.reduce((a, f) => a + f.limite_credito, 0)),
    },
  };
}
```

Actualizar `module.exports`:

```js
module.exports = {
  redondear, enRango, reporteVentas, reporteUtilidad, reporteCompras,
  reporteCortesCaja, reporteExistencias, reporteEstadoCuentaClientes,
};
```

- [ ] **Step 4: Correr la prueba para verificar que pasa**

Run: `cd backend && npx node --test reportes.test.js`
Expected: 26 pruebas, todas PASS.

- [ ] **Step 5: Exponer la ruta en `server.js`**

```js
const { reporteVentas, reporteUtilidad, reporteCompras, reporteCortesCaja, reporteExistencias, reporteEstadoCuentaClientes } = require("./reportes");
```

```js
app.get("/api/reportes/clientes", requiereLogin, requierePermiso("ver_reportes", resolverPermisosDeRol), (req, res) => {
  const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
  const { cliente_id } = req.query;
  res.json(reporteEstadoCuentaClientes(DB, { cliente_id }, alcance));
});
```

**Nota:** esta ruta usa el prefijo `/api/reportes/clientes`, distinto de `/api/clientes` (que ya existe para el catálogo de CRM) — no hay colisión de rutas.

- [ ] **Step 6: Implementar `src/reportes/ReporteEstadoCuentaClientes.jsx`**

Reemplazar el contenido completo del archivo:

```jsx
import React, { useState, useEffect, useCallback } from "react";
import { ChevronLeft } from "lucide-react";
import { apiFetch } from "../api";
import BarraAccionesReporte from "./BarraAccionesReporte.jsx";
import { descargarCSV } from "./exportarCSV.js";

export default function ReporteEstadoCuentaClientes({ onVolver }) {
  const [clienteId, setClienteId] = useState("");
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);

  const consultar = useCallback(async () => {
    setCargando(true);
    const params = new URLSearchParams();
    if (clienteId) params.set("cliente_id", clienteId);
    const r = await apiFetch(`/reportes/clientes?${params.toString()}`);
    if (r.ok) setDatos(await r.json());
    setCargando(false);
  }, [clienteId]);

  useEffect(() => { consultar(); }, [consultar]);

  const exportarExcel = () => {
    if (!datos) return;
    descargarCSV("estado_de_cuenta_clientes.csv",
      ["Clave", "Nombre", "Límite de Crédito", "Saldo", "Crédito Disponible"],
      datos.filas.map((f) => [f.clave, f.nombre, f.limite_credito, f.saldo, f.credito_disponible]));
  };

  return (
    <div className="w-full h-full flex flex-col bg-slate-50 text-slate-800 text-sm">
      <div className="bg-white border-b border-slate-100 px-4 py-2 flex items-center gap-2 no-imprimir">
        <button onClick={onVolver} className="flex items-center gap-1 text-sm text-[#1a7fe8] hover:underline">
          <ChevronLeft size={16} /> Reportes
        </button>
        <h2 className="font-semibold text-slate-700 ml-2">Estado de Cuenta de Clientes</h2>
      </div>

      <BarraAccionesReporte onConsultar={consultar} onExportarExcel={exportarExcel} />

      <div className="flex-1 overflow-y-auto flex flex-col md:flex-row">
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#1a7fe8] text-white sticky top-0">
              <tr>
                <th className="py-2 px-3 text-left font-medium">Clave</th>
                <th className="py-2 px-3 text-left font-medium">Nombre</th>
                <th className="py-2 px-3 text-right font-medium">Límite</th>
                <th className="py-2 px-3 text-right font-medium">Saldo</th>
                <th className="py-2 px-3 text-right font-medium">Disponible</th>
              </tr>
            </thead>
            <tbody>
              {cargando && <tr><td colSpan={5} className="text-center text-slate-400 py-16">Consultando...</td></tr>}
              {!cargando && datos && datos.filas.length === 0 && <tr><td colSpan={5} className="text-center text-slate-400 py-16">Sin clientes</td></tr>}
              {datos && datos.filas.map((f) => (
                <tr key={f.id} onClick={() => setClienteId(String(f.id))}
                  className={`border-b border-slate-100 cursor-pointer ${String(f.id) === clienteId ? "bg-blue-50" : "hover:bg-slate-50"}`}>
                  <td className="py-2 px-3">{f.clave}</td>
                  <td className="py-2 px-3">{f.nombre}</td>
                  <td className="py-2 px-3 text-right">${f.limite_credito.toFixed(2)}</td>
                  <td className="py-2 px-3 text-right">${f.saldo.toFixed(2)}</td>
                  <td className="py-2 px-3 text-right font-medium">${f.credito_disponible.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {datos && datos.detalleCliente && (
          <div className="w-full md:w-80 border-t md:border-t-0 md:border-l border-slate-200 bg-white p-4 no-imprimir">
            <h3 className="text-sm font-semibold text-slate-700 mb-2">Ventas a crédito</h3>
            {datos.detalleCliente.ventas_credito.length === 0 ? (
              <p className="text-xs text-slate-400">Sin ventas a crédito registradas</p>
            ) : (
              <table className="w-full text-xs">
                <thead><tr className="text-slate-500 border-b border-slate-200"><th className="text-left py-1">Fecha</th><th className="text-left py-1">Folio</th><th className="text-right py-1">Total</th></tr></thead>
                <tbody>
                  {datos.detalleCliente.ventas_credito.map((v) => (
                    <tr key={v.id} className="border-b border-slate-100">
                      <td className="py-1">{v.fecha}</td>
                      <td className="py-1">{v.id}</td>
                      <td className="py-1 text-right">${Number(v.total).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {datos && (
        <div className="bg-slate-800 text-white px-4 py-2 flex items-center justify-between text-xs shrink-0 no-imprimir">
          <span>{datos.totales.numero_clientes} cliente(s)</span>
          <span>Saldo total: <b>${datos.totales.saldo_total.toFixed(2)}</b> — Límite total: ${datos.totales.limite_total.toFixed(2)}</span>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Verificar el build del frontend**

Run: `npm run build`
Expected: build exitoso.

- [ ] **Step 8: Commit**

```bash
git add backend/reportes.js backend/reportes.test.js backend/server.js src/reportes/ReporteEstadoCuentaClientes.jsx
git commit -m "feat: add Estado de Cuenta de Clientes"
```

---

### Task 8: Reporte de Movimientos de Caja

**Files:**
- Modify: `backend/reportes.js`
- Modify: `backend/reportes.test.js`
- Modify: `backend/server.js`
- Modify: `src/reportes/ReporteMovimientosCaja.jsx`

**Interfaces:**
- Consumes: `redondear`, `enRango`, `filtrarPorSucursal` (igual que tasks anteriores).
- Produces: `reporteMovimientosCaja(DB, { fecha_inicio, fecha_fin }, alcance) → { entradas, salidas, totales: { total_entradas, total_salidas } }`. Ruta `GET /api/reportes/movimientos-caja`.

- [ ] **Step 1: Escribir la prueba de `reporteMovimientosCaja`**

Agregar a `backend/reportes.test.js`:

```js
const { reporteMovimientosCaja } = require("./reportes");

test("reporteMovimientosCaja: agrupa entradas (ventas) por forma de pago", () => {
  const DB = construirDBPrueba();
  const r = reporteMovimientosCaja(DB, { fecha_inicio: "2026-05-01", fecha_fin: "2026-06-30" }, ALCANCE_TODAS);

  const efectivo = r.entradas.find((f) => f.forma_pago === "EFECTIVO");
  const tarjeta = r.entradas.find((f) => f.forma_pago === "TARJETA");
  assert.strictEqual(efectivo.total, 1200 + 2100, "ventas 1 y 3 son en efectivo");
  assert.strictEqual(tarjeta.total, 800, "venta 2 es con tarjeta");
  assert.strictEqual(r.totales.total_entradas, 1200 + 800 + 2100);
});

test("reporteMovimientosCaja: no cuenta ventas canceladas como entrada", () => {
  const DB = construirDBPrueba();
  DB.pos.ventas[0].estatus = "cancelada";
  const r = reporteMovimientosCaja(DB, { fecha_inicio: "2026-05-01", fecha_fin: "2026-06-30" }, ALCANCE_TODAS);
  assert.strictEqual(r.totales.total_entradas, 800 + 2100);
});

test("reporteMovimientosCaja: lista los retiros de cada corte como salida", () => {
  const DB = construirDBPrueba();
  DB.pos.cortes_caja.push({
    id: 1, sucursal_id: 1, usuario_nombre: "Ana López", fecha: "2026-06-10",
    total_calculado: 1000, total_contado: 1000, total_diferencia: 0, total_retiro: 900,
  });
  const r = reporteMovimientosCaja(DB, { fecha_inicio: "2026-06-01", fecha_fin: "2026-06-30" }, ALCANCE_TODAS);
  assert.strictEqual(r.salidas.length, 1);
  assert.strictEqual(r.salidas[0].total_retiro, 900);
  assert.strictEqual(r.totales.total_salidas, 900);
});

test("reporteMovimientosCaja: ignora cortes sin retiro", () => {
  const DB = construirDBPrueba();
  DB.pos.cortes_caja.push({
    id: 1, sucursal_id: 1, usuario_nombre: "Ana López", fecha: "2026-06-10",
    total_calculado: 500, total_contado: 500, total_diferencia: 0, total_retiro: 0,
  });
  const r = reporteMovimientosCaja(DB, { fecha_inicio: "2026-06-01", fecha_fin: "2026-06-30" }, ALCANCE_TODAS);
  assert.strictEqual(r.salidas.length, 0);
});
```

- [ ] **Step 2: Correr la prueba para verificar que falla**

Run: `cd backend && npx node --test reportes.test.js`
Expected: FAIL — `reporteMovimientosCaja is not a function`.

- [ ] **Step 3: Implementar `reporteMovimientosCaja` en `backend/reportes.js`**

```js
function reporteMovimientosCaja(DB, filtros, alcance) {
  const { fecha_inicio, fecha_fin } = filtros;
  const ventas = filtrarPorSucursal(DB.pos.ventas, alcance)
    .filter((v) => v.estatus !== "cancelada")
    .filter((v) => enRango(v.fecha, fecha_inicio, fecha_fin));

  const entradasMapa = new Map();
  ventas.forEach((v) => {
    const forma = (v.metodo_pago || "EFECTIVO").toUpperCase();
    const actual = entradasMapa.get(forma) || { forma_pago: forma, total: 0 };
    actual.total += v.total;
    entradasMapa.set(forma, actual);
  });
  const entradas = [...entradasMapa.values()]
    .map((f) => ({ ...f, total: redondear(f.total) }))
    .sort((a, b) => b.total - a.total);

  const nombreSucursal = (id) => (DB.pos.sucursales.find((s) => s.id === id) || {}).nombre || "—";
  const cortes = filtrarPorSucursal(DB.pos.cortes_caja, alcance)
    .filter((c) => enRango(c.fecha, fecha_inicio, fecha_fin));
  const salidas = cortes
    .filter((c) => Number(c.total_retiro) > 0)
    .map((c) => ({
      id: c.id, fecha: c.fecha, sucursal_nombre: nombreSucursal(c.sucursal_id),
      usuario_nombre: c.usuario_nombre, total_retiro: c.total_retiro,
    }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));

  return {
    entradas, salidas,
    totales: {
      total_entradas: redondear(entradas.reduce((a, f) => a + f.total, 0)),
      total_salidas: redondear(salidas.reduce((a, f) => a + f.total_retiro, 0)),
    },
  };
}
```

Actualizar `module.exports`:

```js
module.exports = {
  redondear, enRango, reporteVentas, reporteUtilidad, reporteCompras,
  reporteCortesCaja, reporteExistencias, reporteEstadoCuentaClientes, reporteMovimientosCaja,
};
```

- [ ] **Step 4: Correr la prueba para verificar que pasa**

Run: `cd backend && npx node --test reportes.test.js`
Expected: 30 pruebas, todas PASS.

- [ ] **Step 5: Exponer la ruta en `server.js`**

```js
const {
  reporteVentas, reporteUtilidad, reporteCompras, reporteCortesCaja,
  reporteExistencias, reporteEstadoCuentaClientes, reporteMovimientosCaja,
} = require("./reportes");
```

```js
app.get("/api/reportes/movimientos-caja", requiereLogin, requierePermiso("ver_reportes", resolverPermisosDeRol), (req, res) => {
  const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
  const { fecha_inicio, fecha_fin } = req.query;
  res.json(reporteMovimientosCaja(DB, { fecha_inicio, fecha_fin }, alcance));
});
```

- [ ] **Step 6: Implementar `src/reportes/ReporteMovimientosCaja.jsx`**

Reemplazar el contenido completo del archivo:

```jsx
import React, { useState, useEffect, useCallback } from "react";
import { ChevronLeft } from "lucide-react";
import { apiFetch } from "../api";
import FiltroReporte from "./FiltroReporte.jsx";
import BarraAccionesReporte from "./BarraAccionesReporte.jsx";
import { descargarCSV } from "./exportarCSV.js";

const hoyFmt = () => new Date().toISOString().slice(0, 10);
const hace30 = () => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10); };

export default function ReporteMovimientosCaja({ onVolver }) {
  const [fechaInicial, setFechaInicial] = useState(hace30());
  const [fechaFinal, setFechaFinal] = useState(hoyFmt());
  const [sucursalId, setSucursalId] = useState("");
  const [sucursales, setSucursales] = useState([]);
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    apiFetch("/sucursales").then((r) => r.ok && r.json()).then((d) => d && setSucursales(d));
  }, []);

  const consultar = useCallback(async () => {
    setCargando(true);
    const params = new URLSearchParams();
    if (fechaInicial) params.set("fecha_inicio", fechaInicial);
    if (fechaFinal) params.set("fecha_fin", fechaFinal);
    if (sucursalId) params.set("sucursal_id", sucursalId);
    const r = await apiFetch(`/reportes/movimientos-caja?${params.toString()}`);
    if (r.ok) setDatos(await r.json());
    setCargando(false);
  }, [fechaInicial, fechaFinal, sucursalId]);

  useEffect(() => { consultar(); }, [consultar]);

  const exportarExcel = () => {
    if (!datos) return;
    descargarCSV(`movimientos_de_caja_${fechaInicial}_a_${fechaFinal}.csv`,
      ["Tipo", "Detalle", "Total"],
      [
        ...datos.entradas.map((f) => ["Entrada", f.forma_pago, f.total]),
        ...datos.salidas.map((f) => ["Salida", `Retiro corte #${f.id} — ${f.sucursal_nombre} — ${f.usuario_nombre}`, f.total_retiro]),
      ]);
  };

  return (
    <div className="w-full h-full flex flex-col bg-slate-50 text-slate-800 text-sm">
      <div className="bg-white border-b border-slate-100 px-4 py-2 flex items-center gap-2 no-imprimir">
        <button onClick={onVolver} className="flex items-center gap-1 text-sm text-[#1a7fe8] hover:underline">
          <ChevronLeft size={16} /> Reportes
        </button>
        <h2 className="font-semibold text-slate-700 ml-2">Reporte de Movimientos de Caja</h2>
      </div>

      <BarraAccionesReporte onConsultar={consultar} onExportarExcel={exportarExcel} />

      <FiltroReporte
        fechaInicial={fechaInicial} fechaFinal={fechaFinal}
        onCambiarFechaInicial={setFechaInicial} onCambiarFechaFinal={setFechaFinal}
        sucursales={sucursales} sucursalId={sucursalId} onCambiarSucursal={setSucursalId}
      />

      <div className="flex-1 overflow-y-auto p-4 flex flex-col md:flex-row gap-4">
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-slate-700 mb-2">Entradas (ventas por forma de pago)</h3>
          <table className="w-full text-sm bg-white rounded border border-slate-200">
            <thead className="bg-emerald-600 text-white">
              <tr><th className="py-2 px-3 text-left font-medium">Forma de Pago</th><th className="py-2 px-3 text-right font-medium">Total</th></tr>
            </thead>
            <tbody>
              {cargando && <tr><td colSpan={2} className="text-center text-slate-400 py-10">Consultando...</td></tr>}
              {!cargando && datos && datos.entradas.length === 0 && <tr><td colSpan={2} className="text-center text-slate-400 py-10">Sin entradas</td></tr>}
              {datos && datos.entradas.map((f, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="py-2 px-3">{f.forma_pago}</td>
                  <td className="py-2 px-3 text-right font-medium">${f.total.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex-1">
          <h3 className="text-sm font-semibold text-slate-700 mb-2">Salidas (retiros de corte de caja)</h3>
          <table className="w-full text-sm bg-white rounded border border-slate-200">
            <thead className="bg-red-500 text-white">
              <tr><th className="py-2 px-3 text-left font-medium">Fecha</th><th className="py-2 px-3 text-left font-medium">Sucursal</th><th className="py-2 px-3 text-left font-medium">Usuario</th><th className="py-2 px-3 text-right font-medium">Retiro</th></tr>
            </thead>
            <tbody>
              {cargando && <tr><td colSpan={4} className="text-center text-slate-400 py-10">Consultando...</td></tr>}
              {!cargando && datos && datos.salidas.length === 0 && <tr><td colSpan={4} className="text-center text-slate-400 py-10">Sin salidas</td></tr>}
              {datos && datos.salidas.map((f) => (
                <tr key={f.id} className="border-b border-slate-100">
                  <td className="py-2 px-3">{f.fecha}</td>
                  <td className="py-2 px-3">{f.sucursal_nombre}</td>
                  <td className="py-2 px-3">{f.usuario_nombre}</td>
                  <td className="py-2 px-3 text-right font-medium">${f.total_retiro.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {datos && (
        <div className="bg-slate-800 text-white px-4 py-2 flex items-center justify-between text-xs shrink-0 no-imprimir">
          <span>Entradas: <b>${datos.totales.total_entradas.toFixed(2)}</b></span>
          <span>Salidas: <b>${datos.totales.total_salidas.toFixed(2)}</b></span>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Verificar el build del frontend**

Run: `npm run build`
Expected: build exitoso.

- [ ] **Step 8: Commit**

```bash
git add backend/reportes.js backend/reportes.test.js backend/server.js src/reportes/ReporteMovimientosCaja.jsx
git commit -m "feat: add Reporte de Movimientos de Caja"
```

---

### Task 9: Verificación final y revisión manual

**Files:** ninguno (solo verificación — no se esperan cambios de código; si algo falla, se corrige aquí antes de cerrar el plan).

**Interfaces:** ninguna nueva — consume el módulo completo de los Tasks 1-8.

- [ ] **Step 1: Correr toda la suite de backend**

Run: `cd backend && npm test`
Expected: 305/305 pruebas PASS (275 previas + 30 de `reportes.test.js`).

- [ ] **Step 2: Verificar el build de frontend**

Run: `npm run build`
Expected: build exitoso, sin errores ni warnings nuevos.

- [ ] **Step 3: Levantar la app localmente**

Run: `cd backend && npm start` (en una terminal) y `npm run dev` (en otra, desde la raíz del repo).
Expected: backend en `http://localhost:4000`, frontend en `http://localhost:5173` (o el puerto que asigne Vite), sin errores en consola de arranque.

- [ ] **Step 4: Verificación manual en navegador (Playwright/Chrome)**

Iniciar sesión como `victor` / `Unisound2026`. Verificar:
1. El tile "Reportes" aparece en el Dashboard.
2. Al entrar, se ve la cuadrícula de 7 iconos.
3. Cada uno de los 7 reportes carga datos reales (no "en construcción") y el botón "← Reportes" regresa a la cuadrícula.
4. En Ventas: cambiar entre las 4 pestañas (General/Por Artículo/Por Vendedor/Canceladas) y confirmar que los totales del pie cuadran con lo mostrado.
5. En Utilidad: confirmar que la utilidad de al menos un artículo = venta − costo mostrados en la misma fila.
6. En al menos 2 reportes: hacer clic en "Excel" y confirmar que descarga un `.csv` que abre en Excel/LibreOffice con las columnas esperadas.
7. En al menos 1 reporte: hacer clic en "Imprimir" y confirmar que la vista previa de impresión oculta los filtros/barra de acciones y solo muestra título + tabla + totales.
8. Cambiar la sucursal activa (selector del encabezado) y confirmar que los reportes reflejan solo esa sucursal.

- [ ] **Step 5: Reportar hallazgos a Victor**

Si todo pasa: confirmar que el módulo de Reportes está listo, mencionar explícitamente las 3 limitaciones conocidas (utilidad con costo actual, cortes sin desglose de billetes, clientes sin historial de abonos) para que las tenga presentes al usar los reportes.
Si algo falla: documentar el hallazgo concreto (qué reporte, qué filtro, qué se esperaba vs. qué pasó) antes de marcar el task como completo.

---

## Self-Review

**Cobertura de la spec:** Los 7 reportes del spec (`docs/superpowers/specs/2026-07-20-reportes-sistema-design.md`) están cubiertos uno a uno (Tasks 2-8). La infraestructura compartida (permiso, navegación, `FiltroReporte`, `BarraAccionesReporte`, `exportarCSV`, CSS de impresión) está en Task 1. Las limitaciones conocidas (costo actual, sin denominaciones, sin abonos) están reflejadas en los comentarios de `reportes.js` y en el reporte final a Victor (Task 9, Step 5).

**Placeholders:** ninguno — cada step tiene código completo, cada test tiene aserciones concretas contra el DB de prueba real (`construirDBPrueba`).

**Consistencia de tipos:** `alcance` siempre `{ verTodas, sucursalId }` (mismo shape que `auth.alcanceSucursal` ya devuelve). `redondear`/`enRango` se definen una vez en Task 1 y se reutilizan sin redefinirse en ningún task posterior. `module.exports` de `backend/reportes.js` se actualiza de forma acumulativa en cada task (Task 2 exporta 3 símbolos, Task 8 exporta los 9) — verificado que cada task copia el `module.exports` completo del task anterior más su función nueva, no solo la nueva.
