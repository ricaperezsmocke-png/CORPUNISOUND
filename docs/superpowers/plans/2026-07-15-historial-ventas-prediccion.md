# Historial de Ventas para Predicciones — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Importar el reporte de ventas histórico de SICAR (CSV, por sucursal) al motor de predicción de demanda ya existente, agregando cantidades por producto y mes sin guardar tickets individuales ni tocar `DB.pos.ventas`/`venta_detalle`.

**Architecture:** Backend nuevo `backend/historialVentas.js` (parser del reporte SICAR + previsualización + aplicación a una colección nueva `DB.pos.historial_ventas_mensual`) + extensión de `backend/predicciones.js` (`obtenerVentasMensuales` suma ese historial) + 2 rutas nuevas en `server.js` (mismo permiso `ver_predicciones` ya existente) + sección nueva "Importar historial" dentro de `src/PrediccionesDemanda.jsx`.

**Tech Stack:** Node.js/Express, parser CSV manual (sin librería nueva — es texto plano), `node --test` para pruebas backend, React 18 (frontend).

## Global Constraints (del spec `docs/superpowers/specs/2026-07-15-historial-ventas-prediccion-design.md`)

- Formato CSV únicamente, un archivo por sucursal.
- Se agrega por `(clave, mes)` al parsear — **nunca se guardan tickets ni renglones individuales**.
- El resultado se guarda en `DB.pos.historial_ventas_mensual` (forma `{ producto_id, sucursal_id, periodo, cantidad }`), colección **separada por completo** de `DB.pos.ventas`/`DB.pos.venta_detalle` — esta feature nunca lee ni escribe esas dos.
- Confirmación en bloque (resumen + un solo botón "Aplicar"), no renglón por renglón.
- Claves de producto que no coinciden con el catálogo actual (`sku`/`clave_alterna`) se ignoran silenciosamente, solo se cuentan.
- Reimportar el mismo archivo (o uno más reciente) **reemplaza** el valor de cada combinación producto+sucursal+mes, nunca lo suma encima (para que reimportar no duplique).
- Mismo permiso `ver_predicciones` ya existente — no se crea un permiso nuevo.
- `backend/predicciones.js` sí se modifica esta vez (a diferencia del plan original de Predicciones) para que `obtenerVentasMensuales` sume el historial importado junto con las ventas reales.
- Estructura real del reporte SICAR (confirmada contra un archivo real de Ocosingo, 184,722 líneas): 5 líneas de encabezado/filtros descartables, luego se repite un renglón de ticket (columna 0 = `"Ticket"` o `"Nota de Venta"`, columna 3 = fecha `DD/MM/AAAA`) seguido de renglones de producto (columna 1 = cantidad, alguna columna posterior con el patrón `[CLAVE] DESCRIPCIÓN` entre corchetes — buscar el patrón en vez de asumir una posición fija, para tolerar variación menor entre sucursales).
- Las pruebas automatizadas usan CSV sintético que replica esa estructura — **nunca el archivo real** (son datos reales del negocio, no deben quedar en el repositorio).

---

## File Structure

- **Create:** `backend/historialVentas.js` — parser del reporte SICAR, previsualización, aplicación.
- **Create:** `backend/historialVentas.test.js` — pruebas del archivo anterior.
- **Create:** `backend/predicciones.test.js` — primera cobertura de pruebas de `predicciones.js` (no tenía ninguna), enfocada en la nueva integración con el historial.
- **Modify:** `backend/predicciones.js` — `obtenerVentasMensuales` suma `DB.pos.historial_ventas_mensual`.
- **Modify:** `backend/server.js` — 2 rutas nuevas, sube el límite de `express.json`, extiende el `DBScope` de `GET /api/predicciones` para filtrar también el historial por sucursal.
- **Modify:** `backend/testHelpers.js` — agrega `historial_ventas_mensual: []` a la sección `pos` del fixture de pruebas.
- **Modify:** `src/PrediccionesDemanda.jsx` — sección nueva "Importar historial".

---

### Task 1: `backend/historialVentas.js` — parser del reporte SICAR

**Files:**
- Create: `backend/historialVentas.js`
- Create: `backend/historialVentas.test.js`

**Interfaces:**
- Produces: `parsearReporteVentasSicar(csvTexto)` → `{ agregados: [{ clave, periodo, cantidad }], resumen: { tickets_leidos, renglones_leidos, fecha_min, fecha_max } }`. `periodo` en formato `"AAAA-MM"`. `fecha_min`/`fecha_max` en formato `"AAAA-MM-DD"`. Lanza `Error` con mensaje claro si el texto no tiene ningún ticket reconocible.

- [ ] **Step 1: Escribir los tests que fallan**

Crear `backend/historialVentas.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { parsearReporteVentasSicar } = require("./historialVentas");

// Fragmento sintético que replica la estructura real confirmada del
// "Reporte General de Ventas" de SICAR (5 líneas de encabezado/filtros,
// luego renglones de Ticket/Nota de Venta seguidos de sus renglones de
// producto). NO son datos reales del negocio.
function reporteSicarSintetico(lineasDeDatos) {
  const encabezado = [
    "Reporte General de Ventas,,,,,,,,,,,Periodo:,,,01/01/2018 0:00,,,,,,-,,,15/07/2026 23:59,,,",
    "Documento:,, Todos,,,,,,,,,,,,,,,,,Detalle:,,,,,,, Si",
    "Cliente:,, Todos,,,,,,,,Estado:,, Vigente,,,,,,,Orden:,,,,,,, Fecha",
    "Vendedor:,, Todos,,,,,,,,Usuario:,, Todos,,,,,,,Caja:,,,,, Todas,,",
    "Documento,,,Fecha,,Folio,Cliente,,,Caja,,,,Usuario,,,,,Folio F.,,,Est,,,,Total   ,",
  ];
  return [...encabezado, ...lineasDeDatos].join("\n");
}

test("parsearReporteVentasSicar agrega un ticket con una linea de producto", () => {
  const csv = reporteSicarSintetico([
    "Ticket,,,03/01/2018,,32228,PUBLICO EN GENERAL,,,Caja 1 FISC,,,,SEBAS,,,,,331,,,V,,,,$ 785.58,",
    "PZA,2.0000,,,[2X18BICO] CABLE BICOLOR PARA BOCINA,,,,,,,,,,,$ 15.02,,,,,,,$ 30.04,,,,",
  ]);
  const { agregados, resumen } = parsearReporteVentasSicar(csv);
  assert.strictEqual(resumen.tickets_leidos, 1);
  assert.strictEqual(resumen.renglones_leidos, 1);
  assert.strictEqual(resumen.fecha_min, "2018-01-03");
  assert.strictEqual(resumen.fecha_max, "2018-01-03");
  assert.strictEqual(agregados.length, 1);
  assert.strictEqual(agregados[0].clave, "2X18BICO");
  assert.strictEqual(agregados[0].periodo, "2018-01");
  assert.strictEqual(agregados[0].cantidad, 2);
});

test("parsearReporteVentasSicar suma varias lineas de la misma clave en el mismo mes", () => {
  const csv = reporteSicarSintetico([
    "Ticket,,,03/01/2018,,32228,PUBLICO EN GENERAL,,,Caja 1 FISC,,,,SEBAS,,,,,331,,,V,,,,$ 30.04,",
    "PZA,2.0000,,,[2X18BICO] CABLE BICOLOR PARA BOCINA,,,,,,,,,,,$ 15.02,,,,,,,$ 30.04,,,,",
    "Ticket,,,15/01/2018,,32240,PUBLICO EN GENERAL,,,Caja 1 FISC,,,,TOÑO,,,,,331,,,V,,,,$ 45.06,",
    "PZA,3.0000,,,[2X18BICO] CABLE BICOLOR PARA BOCINA,,,,,,,,,,,$ 15.02,,,,,,,$ 45.06,,,,",
  ]);
  const { agregados, resumen } = parsearReporteVentasSicar(csv);
  assert.strictEqual(resumen.tickets_leidos, 2);
  assert.strictEqual(agregados.length, 1, "misma clave y mismo mes debe quedar en un solo renglon agregado");
  assert.strictEqual(agregados[0].cantidad, 5);
});

test("parsearReporteVentasSicar separa la misma clave en meses distintos", () => {
  const csv = reporteSicarSintetico([
    "Ticket,,,03/01/2018,,32228,PUBLICO EN GENERAL,,,Caja 1 FISC,,,,SEBAS,,,,,331,,,V,,,,$ 15.02,",
    "PZA,1.0000,,,[2X18BICO] CABLE BICOLOR PARA BOCINA,,,,,,,,,,,$ 15.02,,,,,,,$ 15.02,,,,",
    "Ticket,,,10/02/2018,,32300,PUBLICO EN GENERAL,,,Caja 1 FISC,,,,TOÑO,,,,,331,,,V,,,,$ 15.02,",
    "PZA,1.0000,,,[2X18BICO] CABLE BICOLOR PARA BOCINA,,,,,,,,,,,$ 15.02,,,,,,,$ 15.02,,,,",
  ]);
  const { agregados } = parsearReporteVentasSicar(csv);
  assert.strictEqual(agregados.length, 2);
  const periodos = agregados.map((a) => a.periodo).sort();
  assert.deepStrictEqual(periodos, ["2018-01", "2018-02"]);
});

test("parsearReporteVentasSicar reconoce Nota de Venta igual que Ticket", () => {
  const csv = reporteSicarSintetico([
    'Nota de Venta,,,03/01/2018,,770,PUBLICO EN GENERAL,,,Caja 1 FISC,,,,YADY,,,,,,,,V,,,,"$ 5,813.89",',
    "PZA,1.0000,,,[QX1622USB] MEZCLADORA BEHRINGER DE 12 CH,,,,,,,,,,,\"$ 5,483.29\",,,,,,,\"$ 5,483.29\",,,,",
  ]);
  const { agregados, resumen } = parsearReporteVentasSicar(csv);
  assert.strictEqual(resumen.tickets_leidos, 1);
  assert.strictEqual(agregados[0].clave, "QX1622USB");
});

test("parsearReporteVentasSicar reconoce unidades distintas a PZA", () => {
  const csv = reporteSicarSintetico([
    "Ticket,,,03/01/2018,,1,PUBLICO EN GENERAL,,,Caja 1,,,,X,,,,,1,,,V,,,,$ 100.00,",
    "METRO,5.0000,,,[CABLE-M] CABLE POR METRO,,,,,,,,,,,$ 20.00,,,,,,,$ 100.00,,,,",
  ]);
  const { agregados } = parsearReporteVentasSicar(csv);
  assert.strictEqual(agregados.length, 1);
  assert.strictEqual(agregados[0].clave, "CABLE-M");
  assert.strictEqual(agregados[0].cantidad, 5);
});

test("parsearReporteVentasSicar ignora renglones fuera de un ticket (encabezado del reporte)", () => {
  const csv = reporteSicarSintetico([]); // solo las 5 lineas de encabezado, sin ningun ticket
  const { agregados, resumen } = parsearReporteVentasSicar(csv);
  assert.strictEqual(agregados.length, 0);
  assert.strictEqual(resumen.tickets_leidos, 0);
});

test("parsearReporteVentasSicar truena con mensaje claro si no hay ningun ticket en todo el archivo", () => {
  assert.throws(
    () => parsearReporteVentasSicar("esto,no,es,un,reporte,de,sicar"),
    /no se pudo leer como reporte de ventas de SICAR/
  );
});

test("parsearReporteVentasSicar ignora una linea de producto con cantidad no numerica sin tronar", () => {
  const csv = reporteSicarSintetico([
    "Ticket,,,03/01/2018,,1,PUBLICO EN GENERAL,,,Caja 1,,,,X,,,,,1,,,V,,,,$ 0.00,",
    "PZA,N/A,,,[ABC123] PRODUCTO CON CANTIDAD RARA,,,,,,,,,,,$ 0.00,,,,,,,$ 0.00,,,,",
  ]);
  const { agregados, resumen } = parsearReporteVentasSicar(csv);
  assert.strictEqual(agregados.length, 0);
  assert.strictEqual(resumen.tickets_leidos, 1);
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd backend && node --test historialVentas.test.js`
Expected: FAIL — "Cannot find module './historialVentas'".

- [ ] **Step 3: Implementar `backend/historialVentas.js` (parser)**

```js
/**
 * historialVentas.js — Importa el "Reporte General de Ventas" de SICAR
 * (CSV, exportado por sucursal) para alimentar el motor de predicción de
 * demanda (backend/predicciones.js) con años de historial real.
 *
 * El reporte NO es una tabla plana: es un reporte jerárquico exportado
 * tal cual se vería impreso. Se repite un renglón de "ticket" (columna 0
 * = "Ticket" o "Nota de Venta", columna 3 = fecha) seguido de uno o más
 * renglones de "producto" (alguna columna con el patrón [CLAVE]
 * DESCRIPCION entre corchetes, columna 1 = cantidad).
 *
 * Este módulo agrega cantidades por (clave, mes) al leer el archivo y
 * NUNCA guarda tickets ni renglones individuales — ver
 * docs/superpowers/specs/2026-07-15-historial-ventas-prediccion-design.md.
 * El resultado agregado se guarda en DB.pos.historial_ventas_mensual,
 * una colección separada por completo de DB.pos.ventas/venta_detalle.
 */

const TIPOS_TICKET = new Set(["Ticket", "Nota de Venta"]);

function parsearLineaCsv(linea) {
  const campos = [];
  let actual = "";
  let enComillas = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (c === '"') { enComillas = !enComillas; continue; }
    if (c === "," && !enComillas) { campos.push(actual); actual = ""; continue; }
    actual += c;
  }
  campos.push(actual);
  return campos;
}

function parsearReporteVentasSicar(csvTexto) {
  const lineas = csvTexto.split(/\r?\n/);
  const mapaAgregado = new Map();
  let ticketsLeidos = 0;
  let renglonesLeidos = 0;
  let fechaActual = null;
  let fechaMin = null;
  let fechaMax = null;

  for (const linea of lineas) {
    if (!linea.trim()) continue;
    const campos = parsearLineaCsv(linea);
    const primera = (campos[0] || "").trim();

    if (TIPOS_TICKET.has(primera)) {
      const fechaTexto = (campos[3] || "").trim();
      const m = fechaTexto.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
      if (m) {
        fechaActual = `${m[3]}-${m[2]}`;
        const fechaOrdenable = `${m[3]}-${m[2]}-${m[1]}`;
        if (!fechaMin || fechaOrdenable < fechaMin) fechaMin = fechaOrdenable;
        if (!fechaMax || fechaOrdenable > fechaMax) fechaMax = fechaOrdenable;
      } else {
        fechaActual = null;
      }
      ticketsLeidos++;
      continue;
    }

    if (!fechaActual) continue;

    let claveEncontrada = null;
    for (const campo of campos) {
      const m = campo.match(/^\s*\[([^\]]+)\]/);
      if (m) { claveEncontrada = m[1].trim(); break; }
    }
    if (!claveEncontrada) continue;

    const cantidad = Number((campos[1] || "").trim());
    if (!Number.isFinite(cantidad) || cantidad <= 0) continue;

    renglonesLeidos++;
    const key = `${claveEncontrada}|${fechaActual}`;
    if (!mapaAgregado.has(key)) mapaAgregado.set(key, { clave: claveEncontrada, periodo: fechaActual, cantidad: 0 });
    mapaAgregado.get(key).cantidad += cantidad;
  }

  if (ticketsLeidos === 0) {
    throw new Error("El archivo no se pudo leer como reporte de ventas de SICAR (no se encontró ningún renglón de Ticket o Nota de Venta)");
  }

  return {
    agregados: [...mapaAgregado.values()],
    resumen: { tickets_leidos: ticketsLeidos, renglones_leidos: renglonesLeidos, fecha_min: fechaMin, fecha_max: fechaMax },
  };
}

module.exports = { parsearReporteVentasSicar };
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `cd backend && node --test historialVentas.test.js`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/historialVentas.js backend/historialVentas.test.js
git commit -m "feat: parser del reporte de ventas de SICAR (agrega por clave y mes)"
```

---

### Task 2: `previsualizarHistorialVentas` y `aplicarHistorialVentas`

**Files:**
- Modify: `backend/historialVentas.js`
- Modify: `backend/historialVentas.test.js`
- Modify: `backend/testHelpers.js`

**Interfaces:**
- Consumes: `construirDBPrueba` de `./testHelpers` (para tests).
- Produces: `previsualizarHistorialVentas(DB, agregados)` → `{ claves_reconocidas, claves_ignoradas, total_renglones_agregados }`. `aplicarHistorialVentas(DB, agregados, sucursal_id)` → `{ producto_id_actualizados, renglones_aplicados }`. Escribe en `DB.pos.historial_ventas_mensual` (forma `{ producto_id, sucursal_id, periodo, cantidad }`), reemplazando el valor existente para la misma combinación producto+sucursal+mes en vez de sumarlo.

- [ ] **Step 1: Agregar `historial_ventas_mensual: []` al fixture de pruebas**

En `backend/testHelpers.js`, dentro de la sección `pos: { ... }` de `construirDBPrueba()`, después de `venta_detalle`:

```js
      historial_ventas_mensual: [],
```

- [ ] **Step 2: Escribir los tests que fallan**

Agregar a `backend/historialVentas.test.js`:

```js
const { construirDBPrueba } = require("./testHelpers");
const { previsualizarHistorialVentas, aplicarHistorialVentas } = require("./historialVentas");

test("previsualizarHistorialVentas cuenta claves reconocidas y no reconocidas", () => {
  const DB = construirDBPrueba(); // AB-001, BE-001, LI-001 existen
  const agregados = [
    { clave: "AB-001", periodo: "2020-01", cantidad: 10 },
    { clave: "NO-EXISTE-YA", periodo: "2020-01", cantidad: 5 },
  ];
  const resultado = previsualizarHistorialVentas(DB, agregados);
  assert.strictEqual(resultado.claves_reconocidas, 1);
  assert.strictEqual(resultado.claves_ignoradas, 1);
  assert.strictEqual(resultado.total_renglones_agregados, 2);
});

test("aplicarHistorialVentas crea renglones nuevos en DB.pos.historial_ventas_mensual", () => {
  const DB = construirDBPrueba();
  const agregados = [{ clave: "AB-001", periodo: "2020-01", cantidad: 25 }];
  const resultado = aplicarHistorialVentas(DB, agregados, 1);
  assert.strictEqual(resultado.producto_id_actualizados, 1);
  assert.strictEqual(resultado.renglones_aplicados, 1);
  assert.strictEqual(DB.pos.historial_ventas_mensual.length, 1);
  assert.deepStrictEqual(DB.pos.historial_ventas_mensual[0], { producto_id: 1, sucursal_id: 1, periodo: "2020-01", cantidad: 25 });
});

test("aplicarHistorialVentas ignora claves que no coinciden con ningun producto, sin tronar", () => {
  const DB = construirDBPrueba();
  const agregados = [{ clave: "NO-EXISTE-YA", periodo: "2020-01", cantidad: 5 }];
  const resultado = aplicarHistorialVentas(DB, agregados, 1);
  assert.strictEqual(resultado.renglones_aplicados, 0);
  assert.strictEqual(DB.pos.historial_ventas_mensual.length, 0);
});

test("aplicarHistorialVentas reimportado reemplaza el valor, no lo suma encima", () => {
  const DB = construirDBPrueba();
  aplicarHistorialVentas(DB, [{ clave: "AB-001", periodo: "2020-01", cantidad: 25 }], 1);
  aplicarHistorialVentas(DB, [{ clave: "AB-001", periodo: "2020-01", cantidad: 40 }], 1);
  assert.strictEqual(DB.pos.historial_ventas_mensual.length, 1, "no debe crear un segundo renglon para la misma combinacion");
  assert.strictEqual(DB.pos.historial_ventas_mensual[0].cantidad, 40);
});

test("aplicarHistorialVentas distingue la misma clave y mes en sucursales distintas", () => {
  const DB = construirDBPrueba();
  aplicarHistorialVentas(DB, [{ clave: "AB-001", periodo: "2020-01", cantidad: 25 }], 1);
  aplicarHistorialVentas(DB, [{ clave: "AB-001", periodo: "2020-01", cantidad: 60 }], 2);
  assert.strictEqual(DB.pos.historial_ventas_mensual.length, 2);
});

test("aplicarHistorialVentas nunca toca DB.pos.ventas ni DB.pos.venta_detalle", () => {
  const DB = construirDBPrueba();
  const ventasAntes = JSON.stringify(DB.pos.ventas);
  const detalleAntes = JSON.stringify(DB.pos.venta_detalle);
  aplicarHistorialVentas(DB, [{ clave: "AB-001", periodo: "2020-01", cantidad: 25 }], 1);
  assert.strictEqual(JSON.stringify(DB.pos.ventas), ventasAntes);
  assert.strictEqual(JSON.stringify(DB.pos.venta_detalle), detalleAntes);
});
```

- [ ] **Step 3: Correr los tests y verificar que fallan**

Run: `cd backend && node --test historialVentas.test.js`
Expected: FAIL — "previsualizarHistorialVentas is not a function".

- [ ] **Step 4: Implementar ambas funciones**

Agregar a `backend/historialVentas.js`, antes de `module.exports`:

```js
function buscarProductoPorClave(DB, clave) {
  return DB["catalogo-productos"].productos.find((p) => p.sku === clave || p.clave_alterna === clave) || null;
}

function previsualizarHistorialVentas(DB, agregados) {
  const clavesReconocidas = new Set();
  const clavesIgnoradas = new Set();
  for (const a of agregados) {
    const producto = buscarProductoPorClave(DB, a.clave);
    (producto ? clavesReconocidas : clavesIgnoradas).add(a.clave);
  }
  return {
    claves_reconocidas: clavesReconocidas.size,
    claves_ignoradas: clavesIgnoradas.size,
    total_renglones_agregados: agregados.length,
  };
}

function aplicarHistorialVentas(DB, agregados, sucursal_id) {
  if (!Array.isArray(DB.pos.historial_ventas_mensual)) DB.pos.historial_ventas_mensual = [];
  const productosActualizados = new Set();
  let renglonesAplicados = 0;

  for (const a of agregados) {
    const producto = buscarProductoPorClave(DB, a.clave);
    if (!producto) continue;

    const existente = DB.pos.historial_ventas_mensual.find(
      (h) => h.producto_id === producto.id && h.sucursal_id === Number(sucursal_id) && h.periodo === a.periodo
    );
    if (existente) {
      existente.cantidad = a.cantidad;
    } else {
      DB.pos.historial_ventas_mensual.push({
        producto_id: producto.id,
        sucursal_id: Number(sucursal_id),
        periodo: a.periodo,
        cantidad: a.cantidad,
      });
    }
    productosActualizados.add(producto.id);
    renglonesAplicados++;
  }

  return { producto_id_actualizados: productosActualizados.size, renglones_aplicados: renglonesAplicados };
}
```

Actualizar `module.exports`:

```js
module.exports = { parsearReporteVentasSicar, previsualizarHistorialVentas, aplicarHistorialVentas };
```

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `cd backend && node --test historialVentas.test.js`
Expected: PASS (14 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/historialVentas.js backend/historialVentas.test.js backend/testHelpers.js
git commit -m "feat: previsualizar y aplicar historial de ventas (reemplaza en reimportacion, nunca toca ventas reales)"
```

---

### Task 3: `predicciones.js` suma el historial importado

**Files:**
- Modify: `backend/predicciones.js`
- Create: `backend/predicciones.test.js`

**Interfaces:**
- Consumes: `DB.pos.historial_ventas_mensual` (forma `{ producto_id, sucursal_id, periodo, cantidad }`, Task 2).
- Produces: `obtenerVentasMensuales`/`predecirDemanda` sin cambio de firma — el historial se suma de forma transparente al llamador.

- [ ] **Step 1: Escribir los tests que fallan**

Crear `backend/predicciones.test.js` (primera cobertura de este archivo — no tenía pruebas):

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { predecirDemanda } = require("./predicciones");

test("predecirDemanda sin historial importado usa solo las ventas reales (comportamiento previo sin cambios)", () => {
  const DB = construirDBPrueba();
  const resultado = predecirDemanda(DB, { producto_id: 1 });
  assert.ok(!resultado.error);
  assert.ok(resultado.historico.length > 0);
});

test("predecirDemanda suma el historial importado a las ventas reales del mismo mes", () => {
  const DB = construirDBPrueba();
  const antes = predecirDemanda(DB, { producto_id: 1 });
  const mesConVentaReal = antes.historico[0].periodo;
  const cantidadAntes = antes.historico[0].cantidad;

  DB.pos.historial_ventas_mensual.push({ producto_id: 1, sucursal_id: 1, periodo: mesConVentaReal, cantidad: 100 });

  const despues = predecirDemanda(DB, { producto_id: 1 });
  const mesEncontrado = despues.historico.find((h) => h.periodo === mesConVentaReal);
  assert.strictEqual(mesEncontrado.cantidad, cantidadAntes + 100);
});

test("predecirDemanda incluye un mes que SOLO tiene historial importado (sin ninguna venta real en ese mes)", () => {
  const DB = construirDBPrueba();
  DB.pos.historial_ventas_mensual.push({ producto_id: 1, sucursal_id: 1, periodo: "2015-06", cantidad: 50 });

  const resultado = predecirDemanda(DB, { producto_id: 1 });
  const mesHistorico = resultado.historico.find((h) => h.periodo === "2015-06");
  assert.ok(mesHistorico, "el mes 2015-06 debe aparecer en el historico aunque no haya venta real ahi");
  assert.strictEqual(mesHistorico.cantidad, 50);
});

test("predecirDemanda respeta el filtro de categoria_id tambien sobre el historial importado", () => {
  const DB = construirDBPrueba();
  // producto 1 = categoria_id 1 (ver testHelpers) - agregar historial de un producto de OTRA categoria
  const productoOtraCategoria = DB["catalogo-productos"].productos.find((p) => p.categoria_id !== 1);
  DB.pos.historial_ventas_mensual.push({ producto_id: productoOtraCategoria.id, sucursal_id: 1, periodo: "2015-06", cantidad: 999 });
  DB.pos.historial_ventas_mensual.push({ producto_id: 1, sucursal_id: 1, periodo: "2015-06", cantidad: 7 });

  const resultado = predecirDemanda(DB, { categoria_id: 1, meses_adelante: 1 });
  const mesHistorico = resultado.historico.find((h) => h.periodo === "2015-06");
  assert.strictEqual(mesHistorico.cantidad, 7, "no debe incluir la cantidad del producto de otra categoria");
});

test("predecirDemanda ignora historial de un producto_id que ya no existe en el catalogo, sin tronar", () => {
  const DB = construirDBPrueba();
  DB.pos.historial_ventas_mensual.push({ producto_id: 999999, sucursal_id: 1, periodo: "2015-06", cantidad: 10 });
  assert.doesNotThrow(() => predecirDemanda(DB, { producto_id: 1 }));
});
```

- [ ] **Step 2: Correr los tests y verificar el estado (algunos ya pasan, los que dependen del historial fallan)**

Run: `cd backend && node --test predicciones.test.js`
Expected: FAIL en los tests que agregan a `DB.pos.historial_ventas_mensual` y esperan que se sume (`obtenerVentasMensuales` todavía no lo lee) — PASS en el primero (comportamiento previo sin cambios).

- [ ] **Step 3: Extender `obtenerVentasMensuales`**

En `backend/predicciones.js`, reemplazar la función completa:

```js
function obtenerVentasMensuales(DB, { producto_id, categoria_id } = {}) {
  const ventas = DB.pos.ventas;
  const detalle = DB.pos.venta_detalle;
  const productos = DB["catalogo-productos"].productos;
  const historial = DB.pos.historial_ventas_mensual || [];

  const fechaPorVenta = {};
  ventas.forEach((v) => { fechaPorVenta[v.id] = v.fecha; });

  const infoPorProducto = {};
  productos.forEach((p) => { infoPorProducto[p.id] = p; });

  const porMes = {};
  detalle.forEach((d) => {
    const fecha = fechaPorVenta[d.venta_id];
    const prod = infoPorProducto[d.producto_id];
    if (!fecha || !prod) return;
    if (producto_id && prod.id !== Number(producto_id)) return;
    if (categoria_id && prod.categoria_id !== Number(categoria_id)) return;
    const mes = fecha.slice(0, 7); // "YYYY-MM"
    porMes[mes] = (porMes[mes] || 0) + Number(d.cantidad);
  });

  // Historial importado de SICAR (backend/historialVentas.js) - ya viene
  // agregado por mes, se suma directamente sin pasar por venta_detalle.
  // Nunca toca DB.pos.ventas/venta_detalle - ver spec 2026-07-15.
  historial.forEach((h) => {
    const prod = infoPorProducto[h.producto_id];
    if (!prod) return;
    if (producto_id && prod.id !== Number(producto_id)) return;
    if (categoria_id && prod.categoria_id !== Number(categoria_id)) return;
    porMes[h.periodo] = (porMes[h.periodo] || 0) + Number(h.cantidad);
  });

  return porMes;
}
```

(El resto del archivo — `regresionLineal`, `predecirDemanda`, `module.exports` — no cambia.)

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `cd backend && node --test predicciones.test.js`
Expected: PASS (5 tests).

Run: `cd backend && node --test` (suite completa)
Expected: PASS en todo lo demás también — las 4 fallas preexistentes y no relacionadas de `clavesSat.test.js` pueden seguir apareciendo.

- [ ] **Step 5: Commit**

```bash
git add backend/predicciones.js backend/predicciones.test.js
git commit -m "feat: predicciones.js suma el historial de ventas importado a las ventas reales"
```

---

### Task 4: Rutas en `server.js`

**Files:**
- Modify: `backend/server.js`

**Interfaces:**
- Consumes: `parsearReporteVentasSicar`, `previsualizarHistorialVentas`, `aplicarHistorialVentas` (Tasks 1-2); `requiereLogin`, `requierePermiso`, `alcanceSucursal` (ya existentes en `auth.js`).
- Produces: `POST /api/predicciones/historial/previsualizar`, `POST /api/predicciones/historial/aplicar`.

- [ ] **Step 1: Requires y límite de `express.json`**

En `backend/server.js`, cerca del require de `predecirDemanda`:

```js
const { predecirDemanda } = require("./predicciones");
const { parsearReporteVentasSicar, previsualizarHistorialVentas, aplicarHistorialVentas } = require("./historialVentas");
```

Cambiar el límite de `express.json` (compartido por toda la app, ya en 15mb desde Migración de Datos) a 50mb — el reporte real de una sucursal puede pesar 16.5MB+ en crudo, ~22MB+ en base64 dentro del body JSON:

```js
// Límite subido a 50mb: el reporte de ventas histórico de una sucursal
// (años de tickets) puede pesar varios MB en crudo, más al viajar en
// base64 dentro del body JSON — misma filosofía que Migración de Datos.
app.use(express.json({ limit: "50mb" }));
```

- [ ] **Step 2: Extender el `DBScope` de la ruta existente `GET /api/predicciones`**

Localizar la ruta ya existente y reemplazar el bloque de `DBScope`:

```js
app.get("/api/predicciones", requiereLogin, requierePermiso("ver_predicciones", resolverPermisosDeRol), (req, res) => {
  const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
  const { producto_id, categoria_id, meses_adelante } = req.query;
  // Para el amarrado, se predice solo sobre las ventas (y el historial
  // importado) de su sucursal.
  const DBScope = alcance.verTodas
    ? DB
    : {
        ...DB,
        pos: {
          ...DB.pos,
          ventas: DB.pos.ventas.filter((v) => Number(v.sucursal_id) === alcance.sucursalId),
          historial_ventas_mensual: (DB.pos.historial_ventas_mensual || []).filter((h) => Number(h.sucursal_id) === alcance.sucursalId),
        },
      };
  const resultado = predecirDemanda(DBScope, {
    producto_id: producto_id ? Number(producto_id) : undefined,
    categoria_id: categoria_id ? Number(categoria_id) : undefined,
    meses_adelante: meses_adelante ? Number(meses_adelante) : undefined
  });
  res.json(resultado);
});
```

- [ ] **Step 3: Agregar las 2 rutas nuevas**

Agregar justo después de la ruta anterior:

```js
app.post("/api/predicciones/historial/previsualizar", requiereLogin, requierePermiso("ver_predicciones", resolverPermisosDeRol), (req, res) => {
  try {
    const { archivo_base64 } = req.body;
    const csvTexto = Buffer.from(archivo_base64, "base64").toString("utf8");
    const { agregados, resumen } = parsearReporteVentasSicar(csvTexto);
    const previsualizacion = previsualizarHistorialVentas(DB, agregados);
    res.json({ ...resumen, ...previsualizacion, agregados });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/api/predicciones/historial/aplicar", requiereLogin, requierePermiso("ver_predicciones", resolverPermisosDeRol), (req, res) => {
  try {
    const { agregados } = req.body;
    if (!Array.isArray(agregados) || agregados.length === 0) {
      return res.status(400).json({ error: "No hay datos previsualizados para aplicar" });
    }
    const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
    const sucursal_id = alcance.verTodas ? Number(req.body.sucursal_id) : alcance.sucursalId;
    if (!sucursal_id) return res.status(400).json({ error: "Selecciona la sucursal de origen del archivo" });
    const resultado = aplicarHistorialVentas(DB, agregados, sucursal_id);
    res.json(resultado);
  } catch (e) { res.status(400).json({ error: e.message }); }
});
```

- [ ] **Step 4: Verificar que el backend arranca y los tests siguen pasando**

Run: `cd backend && node --test`
Expected: PASS (todos, incluidos los de Tasks 1-3). Las 4 fallas preexistentes de `clavesSat.test.js` pueden seguir apareciendo.

Run: `cd backend && node server.js` (y detenerlo tras confirmar)
Expected: arranca sin errores, línea `✓ Sistema de permisos validado: ...` se imprime.

- [ ] **Step 5: Commit**

```bash
git add backend/server.js
git commit -m "feat: rutas de historial de ventas (previsualizar/aplicar) y limite de body a 50mb"
```

---

### Task 5: Frontend — sección "Importar historial" en `src/PrediccionesDemanda.jsx`

**Files:**
- Modify: `src/PrediccionesDemanda.jsx`

**Interfaces:**
- Consumes: `apiFetch` (ya importado); rutas de Task 4.

- [ ] **Step 1: Agregar el estado y las funciones**

En `src/PrediccionesDemanda.jsx`, dentro del componente `PrediccionesDemanda`, agregar junto a los demás `useState`:

```jsx
  const [mostrarImportar, setMostrarImportar] = useState(false);
  const [sucursalImportar, setSucursalImportar] = useState("");
  const [previsualizacionHistorial, setPrevisualizacionHistorial] = useState(null);
  const [cargandoHistorial, setCargandoHistorial] = useState(false);
  const inputHistorialRef = React.useRef(null);
```

Agregar las funciones (junto a `calcular`):

```jsx
  const leerArchivoComoBase64 = (archivo) =>
    new Promise((resolve, reject) => {
      const lector = new FileReader();
      lector.onload = () => resolve(String(lector.result).split(",")[1]);
      lector.onerror = reject;
      lector.readAsDataURL(archivo);
    });

  const subirHistorial = async (archivo) => {
    if (usuario?.ver_todas && !sucursalImportar) {
      return mostrarAviso("Selecciona la sucursal de origen del archivo primero");
    }
    setCargandoHistorial(true);
    setPrevisualizacionHistorial(null);
    try {
      const archivo_base64 = await leerArchivoComoBase64(archivo);
      const r = await apiFetch("/predicciones/historial/previsualizar", { method: "POST", body: JSON.stringify({ archivo_base64 }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setPrevisualizacionHistorial(data);
    } catch (e) {
      mostrarAviso("❌ " + e.message);
    } finally {
      setCargandoHistorial(false);
      if (inputHistorialRef.current) inputHistorialRef.current.value = "";
    }
  };

  const aplicarHistorial = async () => {
    setCargandoHistorial(true);
    try {
      const r = await apiFetch("/predicciones/historial/aplicar", {
        method: "POST",
        body: JSON.stringify({ agregados: previsualizacionHistorial.agregados, sucursal_id: sucursalImportar || undefined }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      mostrarAviso(`Historial aplicado: ${data.renglones_aplicados} renglones, ${data.producto_id_actualizados} productos actualizados`);
      setPrevisualizacionHistorial(null);
      setMostrarImportar(false);
    } catch (e) {
      mostrarAviso("❌ " + e.message);
    } finally {
      setCargandoHistorial(false);
    }
  };
```

- [ ] **Step 2: Agregar la sección visual**

Dentro del `return`, como sección adicional después del bloque de resultado de predicción existente (antes del cierre del `<div className="p-5 ...">`):

```jsx
        <div className="bg-white border border-slate-200 rounded-lg p-4 max-w-xl">
          <button onClick={() => setMostrarImportar((v) => !v)} className="text-sm font-semibold text-blue-700 hover:text-blue-800">
            {mostrarImportar ? "▾" : "▸"} Importar historial de ventas (SICAR)
          </button>
          {mostrarImportar && (
            <div className="mt-3 flex flex-col gap-3">
              <p className="text-xs text-slate-500">
                Sube el reporte de ventas de SICAR (CSV, "Reporte General de Ventas") de una sucursal para mejorar la confianza de las predicciones con historial real.
              </p>
              {usuario?.ver_todas && (
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Sucursal de origen del archivo</label>
                  <select className={inputCls} value={sucursalImportar} onChange={(e) => setSucursalImportar(e.target.value)}>
                    <option value="">Selecciona...</option>
                    {sucursales.length === 0 ? null : null}
                  </select>
                </div>
              )}
              <input ref={inputHistorialRef} type="file" accept=".csv" disabled={cargandoHistorial}
                onChange={(e) => e.target.files[0] && subirHistorial(e.target.files[0])} />

              {cargandoHistorial && <p className="text-slate-400 text-center py-2">Procesando...</p>}

              {previsualizacionHistorial && (
                <div className="bg-slate-50 border border-slate-200 rounded p-3 flex flex-col gap-2 text-xs">
                  <p><b>{previsualizacionHistorial.tickets_leidos}</b> tickets leídos, <b>{previsualizacionHistorial.renglones_leidos}</b> renglones de producto.</p>
                  <p>Periodo: {previsualizacionHistorial.fecha_min} a {previsualizacionHistorial.fecha_max}</p>
                  <p className="text-emerald-700"><b>{previsualizacionHistorial.claves_reconocidas}</b> claves de producto reconocidas</p>
                  <p className="text-amber-700"><b>{previsualizacionHistorial.claves_ignoradas}</b> claves no reconocidas (se ignoran)</p>
                  <button onClick={aplicarHistorial} disabled={cargandoHistorial} className="bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white py-2 rounded font-semibold mt-1">
                    Aplicar
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
```

**Nota para quien implemente este step:** el `<select>` de sucursal de arriba está incompleto a propósito — este componente no tiene todavía una lista de `sucursales` cargada (a diferencia de `MigracionDatos.jsx`, que sí la carga). Antes de terminar este step, agregar un `useEffect` que cargue `apiFetch("/sucursales")` en un estado `sucursales` nuevo (mismo patrón que `MigracionDatos.jsx`), y completar el `<option>` con `sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)`. Verificar con `npm run build` que no queda ninguna variable sin usar ni ningún `<select>` vacío.

- [ ] **Step 3: Verificar que el frontend compila**

Run: `npm run build`
Expected: build limpio, sin errores de sintaxis ni de imports.

- [ ] **Step 4: Commit**

```bash
git add src/PrediccionesDemanda.jsx
git commit -m "feat: seccion Importar historial de ventas en la pantalla de Predicciones"
```

---

### Task 6: Verificación manual en navegador con el archivo real de Ocosingo

**Files:** ninguno (solo verificación).

**Interfaces:** ninguna nueva — ejercita todo lo construido en Tasks 1-5.

**Nota:** este task requiere una sesión con capacidad de manejar un navegador real (Playwright con Chrome del sistema, mismo patrón usado en sesiones anteriores de este proyecto). Si quien ejecuta este plan no tiene esa capacidad, dejarlo marcado como pendiente y decírselo explícitamente a Victor.

**Advertencia de privacidad:** el archivo real
`C:\Users\Victor\Desktop\CARTELES EN TIENDA UNISOUND\REPORTE DE VENTA OCOSINGO CSV.csv`
contiene datos reales del negocio (nombres de clientes, folios, montos).
Al hacer esta prueba: no imprimir ni guardar en ningún archivo del
repositorio ni en reportes el contenido de renglones individuales — solo
conteos y rangos de fecha, igual que se hizo al verificar los archivos
reales de Artículos/Clientes/Proveedores en la feature de Migración de
Datos.

- [ ] **Step 1: Levantar backend y frontend con una base de datos temporal**

Aislar de los datos reales de Victor: `DB_PATH` apuntando a un archivo temporal fuera del repo.

- [ ] **Step 2: Iniciar sesión como Administrador, entrar a Predicciones**

Confirmar que la sección "Importar historial de ventas (SICAR)" aparece (colapsada por defecto).

- [ ] **Step 3: Subir el archivo real de Ocosingo**

Seleccionar la sucursal correspondiente (si aplica), subir el archivo real
(`REPORTE DE VENTA OCOSINGO CSV.csv`, 16.5MB). **Medir cuánto tarda en
procesarse** (el spec documenta el riesgo de que archivos grandes tarden
varios segundos de forma síncrona) — reportar el tiempo real observado a
Victor.

- [ ] **Step 4: Verificar el resumen de previsualización**

Confirmar que el resumen muestra aproximadamente 56,083 tickets leídos,
~99,508 renglones de producto, rango de fechas 2018-01-03 a 2026-07-15 (o
cercano), y una cantidad razonable de claves reconocidas vs. ignoradas
contra el catálogo de productos sembrado en la base de prueba (es
esperable que casi todas salgan como "no reconocidas" si la base de
prueba no tiene los productos reales de Unisound cargados — esto es
correcto y esperado en un ambiente de prueba, no un bug; confirmar que el
comportamiento en sí —contar y no tronar— es correcto, no que el número
de reconocidas sea alto).

- [ ] **Step 5: Aplicar y confirmar en `predicciones.js`**

Hacer clic en "Aplicar", confirmar que el aviso de éxito muestra números
razonables. Si al menos una clave del archivo real coincide con algún
producto sembrado en la base de prueba, calcular una predicción de ese
producto y confirmar que el historial importado aparece en la gráfica/
tabla con meses anteriores a los de la base de prueba.

- [ ] **Step 6: Si el parser tuvo problemas con el archivo real**

Si el resumen sale claramente mal (ej. 0 tickets leídos, o un rango de
fechas que no tiene sentido), es señal de que la estructura real del CSV
no coincide exactamente con lo asumido en el Task 1 — ajustar el parser
contra el archivo real en este mismo task (no es necesario un nuevo
ciclo de spec/plan para un ajuste de este tipo, ya está documentado como
riesgo abierto).

- [ ] **Step 7: Limpiar**

Detener ambos servidores, borrar la base de datos temporal. Confirmar
que `backend/datos.sqlite` real de Victor no fue tocado.

- [ ] **Step 8: Reportar a Victor**

Confirmar explícitamente: tiempo real de procesamiento del archivo de
Ocosingo, resumen de tickets/renglones/fechas obtenido, y si el parser
necesitó algún ajuste contra el archivo real.

---

## Self-Review (hecho al escribir este plan)

**Cobertura del spec:** Objetivo/alcance → Tasks 1-5. CSV por sucursal → Task 4/5. Agregación por clave+mes sin guardar tickets → Task 1. Colección separada de ventas/venta_detalle → Task 2 (test explícito "nunca toca..."), Task 3. Confirmación en bloque (resumen + un botón) → Task 5. Claves no reconocidas se ignoran → Task 2. Reimportar reemplaza, no duplica → Task 2 (test explícito). Mismo permiso `ver_predicciones` → Task 4. `predicciones.js` sí se modifica → Task 3. Estructura real del reporte → Task 1 (tests con fragmentos sintéticos fieles a la estructura real). Verificación con archivo real → Task 6.

**Placeholders:** ninguno en el código de los steps — el `<select>` de sucursal en Task 5 Step 2 queda deliberadamente marcado como incompleto con una nota explícita de qué falta y cómo completarlo (mismo patrón ya usado en planes anteriores de este proyecto para pasos que requieren un ajuste menor dependiente del propio archivo que se está escribiendo), no es un placeholder genérico tipo "TODO".

**Consistencia de tipos:** `parsearReporteVentasSicar(csvTexto)` → Task 1, consumido en Task 4. `previsualizarHistorialVentas(DB, agregados)` y `aplicarHistorialVentas(DB, agregados, sucursal_id)` → Task 2, mismas firmas usadas en Task 4. Forma de `DB.pos.historial_ventas_mensual` (`{ producto_id, sucursal_id, periodo, cantidad }`) consistente entre Task 2 (donde se escribe) y Task 3 (donde se lee).
