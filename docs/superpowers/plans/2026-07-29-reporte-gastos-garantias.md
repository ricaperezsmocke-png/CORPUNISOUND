# Reporte "Gastos de Garantías" (Fase 2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar un octavo reporte, "Gastos de Garantías", que muestre cuánto se ha gastado en garantías por periodo, con desglose por tipo (traslado/reparación/otro) y por sucursal, y la lista de gastos con link a su comprobante en Drive.

**Architecture:** Solo lectura, sin datos nuevos. La Fase 1 ya guarda cada gasto en `DB.inventario.garantia_gastos`. Este plan agrega una función de agregación `reporteGastosGarantias` en `backend/reportes.js` (mismo patrón que las 7 existentes: recibe `(DB, filtros, alcance)` y filtra por alcance ANTES de agregar), una ruta `GET /api/reportes/gastos-garantias` con el permiso ya existente `ver_reportes`, y una pantalla `src/reportes/ReporteGastosGarantias.jsx` registrada en `src/Reportes.jsx`.

**Tech Stack:** Node.js + Express (backend, sin dependencias nuevas), `node --test` para pruebas, React 18 + Tailwind (frontend, sin dependencias nuevas).

## Global Constraints

- **No se agregan dependencias nuevas** (ni backend ni frontend). Copiado del spec: "No se agregan dependencias nuevas (ni backend ni frontend)."
- **Permiso:** se reutiliza el permiso existente `ver_reportes` (módulo `reportes`). NO se crea ningún permiso ni módulo nuevo — por lo tanto **no** se toca `permisosCatalogo.js` ni `validarPermisos.js`.
- **Alcance de sucursal:** `DB.inventario.garantia_gastos` **NO tiene campo `sucursal_id`**, así que `filtrarPorSucursal` **no se puede usar sobre los gastos**. La sucursal de un gasto es la `sucursal_origen_id` de su garantía. El alcance se aplica filtrando primero las **garantías visibles** con `dentroDeAlcance(garantia.sucursal_origen_id, alcance)` y luego quedándose solo con los gastos de esas garantías. Del spec: "Backend: función en `backend/reportes.js` que recorre `DB.inventario.garantia_gastos` cruzando con las garantías (para sucursal/producto) y aplica el alcance."
- **El filtro de sucursal del frontend no se lee en la función del reporte.** `alcanceSucursal(req, permisos)` (en `backend/auth.js:76`) ya convierte `?sucursal_id=N` en `{ verTodas: false, sucursalId: N }` **solo si** el usuario tiene `ver_todas_las_sucursales`; un usuario amarrado a una sucursal ignora el query y usa la sucursal de su token. No agregar ninguna lectura de `req.query.sucursal_id` propia — eso reabriría el agujero.
- **Fechas:** `gasto.fecha` es un ISO completo (`new Date().toISOString()`, p. ej. `"2026-07-29T15:04:05.123Z"`), mientras que `fecha_inicio`/`fecha_fin` llegan como `"YYYY-MM-DD"`. `enRango` compara strings, así que **hay que recortar con `.slice(0, 10)` antes de comparar** o los gastos del último día del rango se quedarían fuera. Mismo tratamiento que ya hace `reporteCompras` con `c.fecha.slice(0, 10)` (`backend/reportes.js:153`).
- El backend mantiene su suite `node --test` completa en verde después de cada tarea (380 pruebas en verde antes de empezar).
- Frontend sin arnés de pruebas automáticas (convención del repo): verificación manual en navegador.
- Todos los comandos se corren desde `C:\Users\Victor\Desktop\CORPUNISOUND`. Los del backend, desde `backend/`.

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `backend/reportes.js` (modificar) | Agregar `reporteGastosGarantias(DB, filtros, alcance)` y exportarla. Las 7 funciones existentes no se tocan. |
| `backend/reportesGastosGarantias.test.js` (crear) | Pruebas de la función nueva. Archivo aparte para no engordar `reportes.test.js` (que ya cubre los otros reportes) y para que el reviewer vea de un golpe todo lo que se probó de esta feature. |
| `backend/server.js` (modificar) | Agregar `reporteGastosGarantias` al `require("./reportes")` y la ruta `GET /api/reportes/gastos-garantias`. |
| `src/reportes/ReporteGastosGarantias.jsx` (crear) | Pantalla del reporte: filtros, 3 pestañas (General / Por Tipo / Por Sucursal), exportar CSV, totales al pie. Reutiliza `FiltroReporte`, `BarraAccionesReporte` y `descargarCSV`. |
| `src/Reportes.jsx` (modificar) | Registrar el reporte nuevo en el arreglo `REPORTES` (tile en la cuadrícula). |

---

### Task 1: Función de agregación `reporteGastosGarantias`

**Files:**
- Modify: `backend/reportes.js` (agregar función al final, antes del `module.exports` de la línea 345; y el `require` de la línea 10)
- Create: `backend/reportesGastosGarantias.test.js`

**Interfaces:**
- Consumes: `construirDBPrueba()` de `backend/testHelpers.js`; `crearGarantia(DB, datos, sucursalId, usuario)` de `backend/garantias.js`; `dentroDeAlcance(sucursalId, alcance)` de `backend/auth.js`; `ETIQUETA_TIPO` de `backend/garantiasGastos.js` (`{ traslado: "Traslado", reparacion: "Reparación", otro: "Otro" }`); los helpers internos `redondear(n)` y `enRango(fecha, desde, hasta)` que ya viven en `backend/reportes.js`.
- Produces (exportada de `backend/reportes.js`): `reporteGastosGarantias(DB, filtros, alcance)` donde `filtros = { fecha_inicio, fecha_fin, tipo }` y el valor de regreso es:

```js
{
  general: [{
    id, fecha,               // fecha en "YYYY-MM-DD"
    garantia_id, folio,      // p. ej. 1, "G-0001"
    sucursal_nombre, producto_nombre,
    tipo,                    // "traslado" | "reparacion" | "otro"
    tipo_etiqueta,           // "Traslado" | "Reparación" | "Otro"
    monto, descripcion,
    nombre_archivo,          // string | null
    drive_link,              // string | null
    usuario,
  }],
  porTipo:     [{ tipo, tipo_etiqueta, numero_gastos, total }],
  porSucursal: [{ sucursal, numero_gastos, total }],
  totales: { numero_gastos, numero_garantias, total, numero_sin_comprobante },
}
```

- [ ] **Step 1: Escribir las pruebas (fallan)**

Crear `backend/reportesGastosGarantias.test.js` con este contenido completo:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { crearGarantia } = require("./garantias");
const { reporteGastosGarantias } = require("./reportes");

const ALCANCE_TODAS = { verTodas: true, sucursalId: null };
const USUARIO = { nombre: "Victor" };

/**
 * Siembra gastos con fecha controlada (no usa agregarGasto, que estampa
 * new Date()) para que las pruebas de rango de fechas sean deterministas.
 */
function sembrarGasto(DB, garantiaId, { tipo, monto, fecha, descripcion = "", archivo = false }) {
  const id = DB.inventario.garantia_gastos.length + 1;
  DB.inventario.garantia_gastos.push({
    id,
    garantia_id: garantiaId,
    tipo,
    monto,
    descripcion,
    nombre_archivo: archivo ? "factura.pdf" : null,
    drive_file_id: archivo ? `file-${id}` : null,
    drive_link: archivo ? `https://drive.google.com/file/d/file-${id}/view` : null,
    usuario: "Victor",
    fecha,
  });
}

/** Dos garantías en sucursales distintas (1 Ocosingo, 2 Yajalón) con gastos. */
function escenario() {
  const DB = construirDBPrueba();
  const g1 = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO); // Ocosingo, Arroz 1kg
  const g2 = crearGarantia(DB, { producto_id: 2 }, 2, USUARIO); // Yajalón, Refresco 600ml
  sembrarGasto(DB, g1.id, { tipo: "traslado", monto: 150, fecha: "2026-07-10T12:00:00.000Z" });
  sembrarGasto(DB, g1.id, { tipo: "reparacion", monto: 500, fecha: "2026-07-15T12:00:00.000Z", descripcion: "Cambio de pastilla", archivo: true });
  sembrarGasto(DB, g2.id, { tipo: "traslado", monto: 200, fecha: "2026-07-20T12:00:00.000Z" });
  sembrarGasto(DB, g2.id, { tipo: "otro", monto: 75.5, fecha: "2026-08-02T12:00:00.000Z" });
  return { DB, g1, g2 };
}

test("reporteGastosGarantias: lista todos los gastos y suma el total", () => {
  const { DB } = escenario();
  const r = reporteGastosGarantias(DB, { fecha_inicio: "2026-07-01", fecha_fin: "2026-08-31" }, ALCANCE_TODAS);

  assert.strictEqual(r.general.length, 4);
  assert.strictEqual(r.totales.numero_gastos, 4);
  assert.strictEqual(r.totales.total, 150 + 500 + 200 + 75.5);
  assert.strictEqual(r.totales.numero_garantias, 2, "los 4 gastos vienen de 2 garantías distintas");
  assert.strictEqual(r.totales.numero_sin_comprobante, 3, "solo uno de los 4 trae comprobante");
});

test("reporteGastosGarantias: enriquece cada renglón con folio, sucursal, producto y etiqueta", () => {
  const { DB } = escenario();
  const r = reporteGastosGarantias(DB, {}, ALCANCE_TODAS);

  const reparacion = r.general.find((f) => f.tipo === "reparacion");
  assert.strictEqual(reparacion.folio, "G-0001");
  assert.strictEqual(reparacion.sucursal_nombre, "Ocosingo");
  assert.strictEqual(reparacion.producto_nombre, "Arroz 1kg");
  assert.strictEqual(reparacion.tipo_etiqueta, "Reparación");
  assert.strictEqual(reparacion.descripcion, "Cambio de pastilla");
  assert.ok(reparacion.drive_link, "el gasto con comprobante conserva su link de Drive");
  assert.strictEqual(reparacion.fecha, "2026-07-15", "la fecha se recorta a YYYY-MM-DD");

  const traslado = r.general.find((f) => f.sucursal_nombre === "Yajalón");
  assert.strictEqual(traslado.folio, "G-0002");
  assert.strictEqual(traslado.producto_nombre, "Refresco 600ml");
  assert.strictEqual(traslado.drive_link, null, "sin comprobante ⇒ link null");
});

test("reporteGastosGarantias: el general viene ordenado por fecha ascendente", () => {
  const { DB } = escenario();
  const r = reporteGastosGarantias(DB, {}, ALCANCE_TODAS);
  const fechas = r.general.map((f) => f.fecha);
  assert.deepStrictEqual(fechas, [...fechas].sort((a, b) => a.localeCompare(b)));
});

test("reporteGastosGarantias: respeta el rango de fechas", () => {
  const { DB } = escenario();
  const r = reporteGastosGarantias(DB, { fecha_inicio: "2026-07-01", fecha_fin: "2026-07-31" }, ALCANCE_TODAS);
  assert.strictEqual(r.general.length, 3, "el gasto de agosto queda fuera");
  assert.strictEqual(r.totales.total, 150 + 500 + 200);
});

test("reporteGastosGarantias: incluye los gastos del último día del rango (fecha ISO recortada)", () => {
  const { DB } = escenario();
  // El gasto de reparación es 2026-07-15T12:00:00.000Z. Sin recortar la hora,
  // "2026-07-15T12:00..." > "2026-07-15" y el renglón se perdería.
  const r = reporteGastosGarantias(DB, { fecha_inicio: "2026-07-15", fecha_fin: "2026-07-15" }, ALCANCE_TODAS);
  assert.strictEqual(r.general.length, 1);
  assert.strictEqual(r.general[0].monto, 500);
});

test("reporteGastosGarantias: filtra por tipo", () => {
  const { DB } = escenario();
  const r = reporteGastosGarantias(DB, { tipo: "traslado" }, ALCANCE_TODAS);
  assert.strictEqual(r.general.length, 2);
  assert.strictEqual(r.totales.total, 150 + 200);
  assert.ok(r.general.every((f) => f.tipo === "traslado"));
});

test("reporteGastosGarantias: agrupa por tipo ordenado por total descendente", () => {
  const { DB } = escenario();
  const r = reporteGastosGarantias(DB, {}, ALCANCE_TODAS);

  assert.deepStrictEqual(r.porTipo.map((f) => f.tipo), ["reparacion", "traslado", "otro"]);
  const traslado = r.porTipo.find((f) => f.tipo === "traslado");
  assert.strictEqual(traslado.numero_gastos, 2);
  assert.strictEqual(traslado.total, 350);
  assert.strictEqual(traslado.tipo_etiqueta, "Traslado");
});

test("reporteGastosGarantias: agrupa por sucursal ordenado por total descendente", () => {
  const { DB } = escenario();
  const r = reporteGastosGarantias(DB, {}, ALCANCE_TODAS);

  assert.deepStrictEqual(r.porSucursal.map((f) => f.sucursal), ["Ocosingo", "Yajalón"]);
  assert.strictEqual(r.porSucursal[0].total, 650);
  assert.strictEqual(r.porSucursal[0].numero_gastos, 2);
  assert.strictEqual(r.porSucursal[1].total, 275.5);
});

test("reporteGastosGarantias: un usuario amarrado solo ve los gastos de SU sucursal", () => {
  const { DB } = escenario();
  const r = reporteGastosGarantias(DB, {}, { verTodas: false, sucursalId: 2 });

  assert.strictEqual(r.general.length, 2, "solo los 2 gastos de la garantía de Yajalón");
  assert.strictEqual(r.totales.total, 275.5);
  assert.ok(r.general.every((f) => f.sucursal_nombre === "Yajalón"));
  assert.deepStrictEqual(r.porSucursal.map((f) => f.sucursal), ["Yajalón"]);
});

test("reporteGastosGarantias: un gasto huérfano (sin garantía existente) nunca se cuela", () => {
  const { DB } = escenario();
  sembrarGasto(DB, 999, { tipo: "otro", monto: 10000, fecha: "2026-07-11T12:00:00.000Z" });

  const r = reporteGastosGarantias(DB, {}, ALCANCE_TODAS);
  assert.strictEqual(r.general.length, 4, "el gasto huérfano se ignora");
  assert.strictEqual(r.totales.total, 150 + 500 + 200 + 75.5);
});

test("reporteGastosGarantias: sin gastos regresa estructura vacía en ceros", () => {
  const DB = construirDBPrueba();
  const r = reporteGastosGarantias(DB, {}, ALCANCE_TODAS);

  assert.deepStrictEqual(r.general, []);
  assert.deepStrictEqual(r.porTipo, []);
  assert.deepStrictEqual(r.porSucursal, []);
  assert.strictEqual(r.totales.numero_gastos, 0);
  assert.strictEqual(r.totales.numero_garantias, 0);
  assert.strictEqual(r.totales.total, 0);
  assert.strictEqual(r.totales.numero_sin_comprobante, 0);
});
```

- [ ] **Step 2: Correr las pruebas nuevas para verificar que fallan**

```bash
cd backend && node --test reportesGastosGarantias.test.js
```

Expected: FAIL. Todas las pruebas truenan con `TypeError: reporteGastosGarantias is not a function` (aún no existe ni se exporta).

- [ ] **Step 3: Ampliar el `require` de `auth` y traer las etiquetas de tipo**

En `backend/reportes.js`, reemplazar la línea 10:

```js
const { filtrarPorSucursal } = require("./auth");
```

por:

```js
const { filtrarPorSucursal, dentroDeAlcance } = require("./auth");
const { ETIQUETA_TIPO } = require("./garantiasGastos");
```

- [ ] **Step 4: Escribir la función**

En `backend/reportes.js`, insertar esta función **después** de `reporteMovimientosCaja` (que termina en la línea 343) y **antes** del `module.exports`:

```js
/**
 * Gastos de garantías (traslado / reparación / otro) en un periodo.
 *
 * OJO con el alcance: garantia_gastos NO tiene sucursal_id, así que
 * filtrarPorSucursal no aplica aquí. La sucursal de un gasto es la
 * sucursal_origen_id de SU garantía — el dato que nunca se pierde. Por eso se
 * filtran primero las garantías visibles y de ahí salen los gastos: un gasto
 * cuya garantía no está en el alcance no existe para este reporte.
 */
function reporteGastosGarantias(DB, filtros, alcance) {
  const { fecha_inicio, fecha_fin, tipo } = filtros || {};

  const garantiasVisibles = (DB.inventario.garantias || [])
    .filter((g) => dentroDeAlcance(g.sucursal_origen_id, alcance));
  const porId = new Map(garantiasVisibles.map((g) => [g.id, g]));

  let gastos = (DB.inventario.garantia_gastos || [])
    .filter((x) => porId.has(x.garantia_id))
    .filter((x) => enRango(String(x.fecha).slice(0, 10), fecha_inicio, fecha_fin));
  if (tipo) gastos = gastos.filter((x) => x.tipo === tipo);

  const nombreProducto = (id) =>
    (DB["catalogo-productos"].productos.find((p) => p.id === id) || {}).nombre || `Producto ${id}`;
  const nombreSucursal = (id) =>
    (DB.pos.sucursales.find((s) => s.id === Number(id)) || {}).nombre || "—";

  const general = gastos
    .map((x) => {
      const garantia = porId.get(x.garantia_id);
      return {
        id: x.id,
        fecha: String(x.fecha).slice(0, 10),
        garantia_id: garantia.id,
        folio: garantia.folio,
        sucursal_nombre: nombreSucursal(garantia.sucursal_origen_id),
        producto_nombre: nombreProducto(garantia.producto_id),
        tipo: x.tipo,
        tipo_etiqueta: ETIQUETA_TIPO[x.tipo] || x.tipo,
        monto: redondear(x.monto),
        descripcion: x.descripcion || "",
        nombre_archivo: x.nombre_archivo || null,
        drive_link: x.drive_link || null,
        usuario: x.usuario || "—",
      };
    })
    .sort((a, b) => a.fecha.localeCompare(b.fecha));

  const porTipoMapa = new Map();
  general.forEach((f) => {
    const actual = porTipoMapa.get(f.tipo)
      || { tipo: f.tipo, tipo_etiqueta: f.tipo_etiqueta, numero_gastos: 0, total: 0 };
    actual.numero_gastos += 1;
    actual.total += f.monto;
    porTipoMapa.set(f.tipo, actual);
  });

  const porSucursalMapa = new Map();
  general.forEach((f) => {
    const actual = porSucursalMapa.get(f.sucursal_nombre)
      || { sucursal: f.sucursal_nombre, numero_gastos: 0, total: 0 };
    actual.numero_gastos += 1;
    actual.total += f.monto;
    porSucursalMapa.set(f.sucursal_nombre, actual);
  });

  const porTotalDesc = (a, b) => b.total - a.total;

  return {
    general,
    porTipo: [...porTipoMapa.values()].map((f) => ({ ...f, total: redondear(f.total) })).sort(porTotalDesc),
    porSucursal: [...porSucursalMapa.values()].map((f) => ({ ...f, total: redondear(f.total) })).sort(porTotalDesc),
    totales: {
      numero_gastos: general.length,
      numero_garantias: new Set(general.map((f) => f.garantia_id)).size,
      total: redondear(general.reduce((a, f) => a + f.monto, 0)),
      numero_sin_comprobante: general.filter((f) => !f.drive_link).length,
    },
  };
}
```

- [ ] **Step 5: Exportarla**

En `backend/reportes.js`, en el `module.exports` (última línea del archivo), agregar `reporteGastosGarantias` al final de la lista:

```js
module.exports = { redondear, enRango, reporteVentas, reporteUtilidad, reporteCompras, reporteCortesCaja, reporteExistencias, reporteEstadoCuentaClientes, reporteMovimientosCaja, reporteGastosGarantias };
```

- [ ] **Step 6: Correr las pruebas nuevas**

```bash
cd backend && node --test reportesGastosGarantias.test.js
```

Expected: PASS — 11 pruebas en verde.

- [ ] **Step 7: Correr TODA la suite del backend**

```bash
cd backend && node --test
```

Expected: PASS. 380 pruebas previas + 11 nuevas = **391 en verde, 0 fallando**. Si algo previo se rompió, el culpable más probable es el `require("./garantiasGastos")` nuevo en `reportes.js` — verificar que no haya quedado un ciclo de requires (`garantiasGastos` → `garantias` → `productos`/`configuracion`/`auth`, ninguno de los cuales requiere `reportes`, así que no debería haberlo).

- [ ] **Step 8: Commit**

```bash
git add backend/reportes.js backend/reportesGastosGarantias.test.js
git commit -m "feat: agregación del reporte de Gastos de Garantías (por tipo, por sucursal, con alcance)"
```

---

### Task 2: Ruta `GET /api/reportes/gastos-garantias`

**Files:**
- Modify: `backend/server.js` (línea 70, el `require("./reportes")`; y agregar la ruta después de la de `movimientos-caja`, que termina en la línea 1283)

**Interfaces:**
- Consumes: `reporteGastosGarantias(DB, { fecha_inicio, fecha_fin, tipo }, alcance)` de Task 1; los middlewares existentes `requiereLogin`, `requierePermiso(clave, resolverPermisosDeRol)` y el helper `alcanceSucursal(req, permisos)`.
- Produces (para Task 3): endpoint `GET /api/reportes/gastos-garantias` que acepta los query params `fecha_inicio`, `fecha_fin`, `sucursal_id`, `tipo` y responde con el objeto descrito en Task 1.

- [ ] **Step 1: Agregar la función al `require` de reportes**

En `backend/server.js`, reemplazar la línea 70:

```js
const { reporteVentas, reporteUtilidad, reporteCompras, reporteCortesCaja, reporteExistencias, reporteEstadoCuentaClientes, reporteMovimientosCaja } = require("./reportes");
```

por:

```js
const { reporteVentas, reporteUtilidad, reporteCompras, reporteCortesCaja, reporteExistencias, reporteEstadoCuentaClientes, reporteMovimientosCaja, reporteGastosGarantias } = require("./reportes");
```

- [ ] **Step 2: Agregar la ruta**

En `backend/server.js`, justo **después** de la ruta `app.get("/api/reportes/movimientos-caja", ...)` (que cierra en la línea 1284 con `});`) y **antes** del comentario separador `// ────...`, insertar:

```js
app.get("/api/reportes/gastos-garantias", requiereLogin, requierePermiso("ver_reportes", resolverPermisosDeRol), (req, res) => {
  const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
  const { fecha_inicio, fecha_fin, tipo } = req.query;
  res.json(reporteGastosGarantias(DB, { fecha_inicio, fecha_fin, tipo }, alcance));
});
```

**No** leer `req.query.sucursal_id` aquí: `alcanceSucursal` ya lo interpreta y lo ignora para usuarios amarrados a una sucursal (ver Global Constraints).

- [ ] **Step 3: Verificar que el servidor arranca sin reventar**

```bash
cd backend && node -e "require('./server'); console.log('SERVER OK'); process.exit(0)"
```

Expected: imprime `SERVER OK` (además de los logs de arranque del backend). Si truena con `reporteGastosGarantias is not defined` o un error de sintaxis, revisar los Steps 1 y 2.

- [ ] **Step 4: Verificar que la ruta quedó registrada con su permiso**

```bash
cd backend && grep -n "reportes/gastos-garantias" -A 4 server.js
```

Expected: la ruta aparece una sola vez, con `requiereLogin` y `requierePermiso("ver_reportes", resolverPermisosDeRol)` en la misma línea del `app.get`, y sin ninguna lectura de `sucursal_id` en su cuerpo.

- [ ] **Step 5: Correr toda la suite del backend**

```bash
cd backend && node --test
```

Expected: PASS, 391 pruebas en verde (la ruta no cambia ninguna prueba existente; el repo no tiene pruebas a nivel HTTP).

- [ ] **Step 6: Commit**

```bash
git add backend/server.js
git commit -m "feat: ruta GET /api/reportes/gastos-garantias (permiso ver_reportes)"
```

---

### Task 3: Pantalla del reporte y registro en Reportes

**Files:**
- Create: `src/reportes/ReporteGastosGarantias.jsx`
- Modify: `src/Reportes.jsx` (líneas 1-19: imports y arreglo `REPORTES`)

**Interfaces:**
- Consumes: el endpoint `GET /api/reportes/gastos-garantias` de Task 2; `apiFetch` de `src/api.js`; `FiltroReporte` (props `fechaInicial`, `fechaFinal`, `onCambiarFechaInicial`, `onCambiarFechaFinal`, `sucursales`, `sucursalId`, `onCambiarSucursal`, `hijos`); `BarraAccionesReporte` (props `onConsultar`, `onExportarExcel`); `descargarCSV(nombreArchivo, encabezados, filas)` de `src/reportes/exportarCSV.js`.
- Produces: componente `ReporteGastosGarantias({ onVolver })` — misma firma que los otros 7 reportes, para que `Reportes.jsx` lo renderice igual.

**Nota sobre permisos en el frontend:** `src/Reportes.jsx` **no** gatea reporte por reporte. El módulo completo ya está gateado en `src/Dashboard.jsx:17` (`permiso: "ver_reportes"`). No agregar ninguna verificación de permiso dentro de la pantalla nueva.

- [ ] **Step 1: Crear la pantalla**

Crear `src/reportes/ReporteGastosGarantias.jsx` con este contenido completo:

```jsx
import React, { useState, useEffect, useCallback } from "react";
import { ChevronLeft, FileText } from "lucide-react";
import { apiFetch } from "../api";
import FiltroReporte from "./FiltroReporte.jsx";
import BarraAccionesReporte from "./BarraAccionesReporte.jsx";
import { descargarCSV } from "./exportarCSV.js";

const hoyFmt = () => new Date().toISOString().slice(0, 10);
const hace30 = () => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10); };

const TABS = [
  { id: "general", etiqueta: "General" },
  { id: "porTipo", etiqueta: "Por Tipo" },
  { id: "porSucursal", etiqueta: "Por Sucursal" },
];

const TIPOS = [
  { valor: "traslado", etiqueta: "Traslado" },
  { valor: "reparacion", etiqueta: "Reparación" },
  { valor: "otro", etiqueta: "Otro" },
];

export default function ReporteGastosGarantias({ onVolver }) {
  const [fechaInicial, setFechaInicial] = useState(hace30());
  const [fechaFinal, setFechaFinal] = useState(hoyFmt());
  const [sucursalId, setSucursalId] = useState("");
  const [tipo, setTipo] = useState("");
  const [sucursales, setSucursales] = useState([]);
  const [tab, setTab] = useState("general");
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    apiFetch("/sucursales").then((r) => r.ok && r.json()).then((d) => d && setSucursales(d));
  }, []);

  const consultar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (fechaInicial) params.set("fecha_inicio", fechaInicial);
      if (fechaFinal) params.set("fecha_fin", fechaFinal);
      if (sucursalId) params.set("sucursal_id", sucursalId);
      if (tipo) params.set("tipo", tipo);
      const r = await apiFetch(`/reportes/gastos-garantias?${params.toString()}`);
      if (!r.ok) throw new Error("El backend respondió con error");
      setDatos(await r.json());
    } catch (e) {
      setError("No se pudo conectar con el backend.");
    } finally {
      setCargando(false);
    }
  }, [fechaInicial, fechaFinal, sucursalId, tipo]);

  useEffect(() => { consultar(); }, [consultar]);

  const exportarExcel = () => {
    if (!datos) return;
    if (tab === "general") {
      descargarCSV(`gastos_garantias_${fechaInicial}_a_${fechaFinal}.csv`,
        ["Fecha", "Folio", "Sucursal", "Producto", "Tipo", "Descripcion", "Comprobante", "Monto"],
        datos.general.map((f) => [f.fecha, f.folio, f.sucursal_nombre, f.producto_nombre, f.tipo_etiqueta, f.descripcion, f.nombre_archivo || "Sin comprobante", f.monto]));
    } else if (tab === "porTipo") {
      descargarCSV(`gastos_garantias_por_tipo_${fechaInicial}_a_${fechaFinal}.csv`,
        ["Tipo", "No. Gastos", "Total"],
        datos.porTipo.map((f) => [f.tipo_etiqueta, f.numero_gastos, f.total]));
    } else {
      descargarCSV(`gastos_garantias_por_sucursal_${fechaInicial}_a_${fechaFinal}.csv`,
        ["Sucursal", "No. Gastos", "Total"],
        datos.porSucursal.map((f) => [f.sucursal, f.numero_gastos, f.total]));
    }
  };

  return (
    <div className="w-full h-full flex flex-col bg-slate-50 text-slate-800 text-sm">
      <div className="bg-white border-b border-slate-100 px-4 py-2 flex items-center gap-2">
        <button onClick={onVolver} className="flex items-center gap-1 text-sm text-[#1a7fe8] hover:underline no-imprimir">
          <ChevronLeft size={16} /> Reportes
        </button>
        <h2 className="font-semibold text-slate-700 ml-2">Reporte de Gastos de Garantías</h2>
      </div>

      {error && <div className="bg-red-50 border-b border-red-200 text-red-700 text-xs px-4 py-2 shrink-0">{error}</div>}

      <BarraAccionesReporte onConsultar={consultar} onExportarExcel={exportarExcel} />

      <FiltroReporte
        fechaInicial={fechaInicial} fechaFinal={fechaFinal}
        onCambiarFechaInicial={setFechaInicial} onCambiarFechaFinal={setFechaFinal}
        sucursales={sucursales} sucursalId={sucursalId} onCambiarSucursal={setSucursalId}
        hijos={
          <div>
            <label className="text-xs text-slate-500 block mb-1">Tipo de gasto</label>
            <select value={tipo} onChange={(e) => setTipo(e.target.value)} className="border border-slate-300 rounded px-2 py-1.5 text-sm">
              <option value="">Todos</option>
              {TIPOS.map((t) => <option key={t.valor} value={t.valor}>{t.etiqueta}</option>)}
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
                <th className="py-2 px-3 text-left font-medium">Producto</th>
                <th className="py-2 px-3 text-left font-medium">Tipo</th>
                <th className="py-2 px-3 text-left font-medium">Descripción</th>
                <th className="py-2 px-3 text-center font-medium">Comprobante</th>
                <th className="py-2 px-3 text-right font-medium">Monto</th>
              </tr>
            </thead>
            <tbody>
              {datos.general.length === 0 && <tr><td colSpan={8} className="text-center text-slate-400 py-16">Sin resultados</td></tr>}
              {datos.general.map((f) => (
                <tr key={f.id} className="border-b border-slate-100">
                  <td className="py-2 px-3">{f.fecha}</td>
                  <td className="py-2 px-3 font-medium">{f.folio}</td>
                  <td className="py-2 px-3">{f.sucursal_nombre}</td>
                  <td className="py-2 px-3">{f.producto_nombre}</td>
                  <td className="py-2 px-3">{f.tipo_etiqueta}</td>
                  <td className="py-2 px-3 text-slate-500">{f.descripcion || "—"}</td>
                  <td className="py-2 px-3 text-center">
                    {f.drive_link ? (
                      <a href={f.drive_link} target="_blank" rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[#1a7fe8] hover:underline" title={f.nombre_archivo || "Comprobante"}>
                        <FileText size={14} /> Ver
                      </a>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-right font-medium">${f.monto.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : tab === "porTipo" ? (
          <table className="w-full text-sm">
            <thead className="bg-[#1a7fe8] text-white sticky top-0">
              <tr>
                <th className="py-2 px-3 text-left font-medium">Tipo</th>
                <th className="py-2 px-3 text-right font-medium">No. Gastos</th>
                <th className="py-2 px-3 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {datos.porTipo.length === 0 && <tr><td colSpan={3} className="text-center text-slate-400 py-16">Sin resultados</td></tr>}
              {datos.porTipo.map((f) => (
                <tr key={f.tipo} className="border-b border-slate-100">
                  <td className="py-2 px-3">{f.tipo_etiqueta}</td>
                  <td className="py-2 px-3 text-right">{f.numero_gastos}</td>
                  <td className="py-2 px-3 text-right font-medium">${f.total.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[#1a7fe8] text-white sticky top-0">
              <tr>
                <th className="py-2 px-3 text-left font-medium">Sucursal</th>
                <th className="py-2 px-3 text-right font-medium">No. Gastos</th>
                <th className="py-2 px-3 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {datos.porSucursal.length === 0 && <tr><td colSpan={3} className="text-center text-slate-400 py-16">Sin resultados</td></tr>}
              {datos.porSucursal.map((f) => (
                <tr key={f.sucursal} className="border-b border-slate-100">
                  <td className="py-2 px-3">{f.sucursal}</td>
                  <td className="py-2 px-3 text-right">{f.numero_gastos}</td>
                  <td className="py-2 px-3 text-right font-medium">${f.total.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {datos && (
        <div className="bg-slate-800 text-white px-4 py-2 flex items-center justify-between text-xs shrink-0">
          <span>
            {datos.totales.numero_gastos} gasto(s) en {datos.totales.numero_garantias} garantía(s)
            {datos.totales.numero_sin_comprobante > 0 && ` — ${datos.totales.numero_sin_comprobante} sin comprobante`}
          </span>
          <span>Total: <b>${datos.totales.total.toFixed(2)}</b></span>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Registrar el reporte en `src/Reportes.jsx`**

Reemplazar la línea 2 (los iconos) para agregar `ShieldAlert`:

```jsx
import { Receipt, TrendingUp, Truck, Landmark, Boxes, Users, ArrowLeftRight, ShieldAlert } from "lucide-react";
```

Agregar el import del componente después de la línea 9:

```jsx
import ReporteGastosGarantias from "./reportes/ReporteGastosGarantias.jsx";
```

Y agregar el renglón nuevo al final del arreglo `REPORTES` (después de `movimientos`, línea 18):

```jsx
  { id: "gastos-garantias", nombre: "Gastos de Garantías", icono: ShieldAlert, Componente: ReporteGastosGarantias },
```

(`ShieldAlert` es el mismo icono que el tile de Garantías en el Dashboard — así el reporte se lee de inmediato como parte de ese módulo.)

- [ ] **Step 3: Verificar que el frontend compila**

```bash
npm run build
```

Expected: build exitoso, sin errores ni warnings nuevos. Si truena con `"ShieldAlert" is not exported by lucide-react`, revisar el Step 2.

- [ ] **Step 4: Verificar que el reporte quedó registrado**

```bash
grep -n "ShieldAlert\|ReporteGastosGarantias" src/Reportes.jsx
```

Expected: 3 apariciones — el import del icono, el import del componente, y el renglón del arreglo `REPORTES`.

- [ ] **Step 5: Correr la suite del backend una última vez**

```bash
cd backend && node --test
```

Expected: PASS, 391 pruebas en verde (esta tarea no toca backend, es una red de seguridad antes del commit).

- [ ] **Step 6: Commit**

```bash
git add src/reportes/ReporteGastosGarantias.jsx src/Reportes.jsx
git commit -m "feat: pantalla del reporte de Gastos de Garantías (general, por tipo, por sucursal)"
```

---

## Verificación manual en navegador (después de las 3 tareas)

El frontend no tiene arnés de pruebas automáticas (convención del repo). Con el backend y el frontend corriendo, entrar como `victor`:

1. Registrar una garantía en Garantías y agregarle 2 gastos (uno con comprobante, uno sin) desde el modal "Gastos" que ya existe de la Fase 1.
2. Abrir **Reportes → Gastos de Garantías**. Con el rango de fechas por defecto (últimos 30 días), los 2 gastos deben aparecer en la pestaña General, con folio, sucursal, producto y monto correctos.
3. El gasto con comprobante muestra el link "Ver" y abre el archivo en Drive en pestaña nueva; el que no lo tiene muestra "—".
4. Las pestañas **Por Tipo** y **Por Sucursal** suman lo mismo que el total del pie.
5. El filtro **Tipo de gasto** recorta la lista; el filtro **Sucursal** también (solo tiene efecto para un usuario con `ver_todas_las_sucursales`).
6. El botón **Excel** descarga un CSV con las columnas de la pestaña activa.
7. Un rango de fechas que empiece y termine en el mismo día en que se registró un gasto debe incluirlo (es la trampa de la fecha ISO — ver Global Constraints).

## Fuera de alcance (YAGNI)

- Gráficas del reporte (los otros 7 reportes son tablas; este también).
- Cruzar los gastos con el Corte de Caja (el spec de la Fase 1 ya lo declaró fuera de alcance: "los gastos de garantía no son movimientos de caja").
- Filtro por proveedor o por estado de la garantía (nadie lo pidió; el spec pide rango de fechas, sucursal y desglose por tipo).
- Editar un gasto desde el reporte (el reporte es de solo lectura; se edita desde el modal de Garantías).
