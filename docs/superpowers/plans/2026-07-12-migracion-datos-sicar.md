# Migración de Datos SICAR → CORPUNISOUND — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir la pantalla "Migración de Datos" (dentro del módulo Inventario) que importa Excel de SICAR (Artículos/Clientes/Proveedores) con previsualización y confirmación por renglón, y exporta un respaldo `.xlsx` propio de CORPUNISOUND releíble por el mismo importador.

**Architecture:** Backend nuevo `backend/migracion.js` (parseo con `xlsx`, matching por clave/RFC, validación, aplicación fila-por-fila sin mutar hasta validar todo, exportación) + 3 rutas nuevas en `server.js` gateadas por el permiso `migrar_datos` (vive dentro del módulo `inventario` existente) + pantalla nueva `src/MigracionDatos.jsx` con el mismo lenguaje visual que `RecepcionCompras.jsx`.

**Tech Stack:** Node.js/Express, `xlsx` (SheetJS, nueva dependencia), `better-sqlite3` (persistencia ya existente), React 18 + Vite, `node --test` para pruebas backend.

## Global Constraints (del spec `docs/superpowers/specs/2026-07-12-migracion-datos-sicar-design.md`)

- Solo tres tipos de dato: Artículos, Clientes, Proveedores. Nada de Formato Tickets/Impuestos/Insumos.
- Matching por clave (Artículos: `sku` o `clave_alterna`; Clientes: `clave`; Proveedores: `rfc`) — nunca por nombre.
- Sucursal obligatoria para Artículos y Clientes (si el usuario tiene `ver_todas_las_sucursales`); Proveedores NO llevan sucursal.
- Confirmación explícita por renglón antes de aplicar cualquier cambio (checkbox), igual que el importador XML de `RecepcionCompras.jsx`.
- Detección de columnas por nombre de encabezado (alias tolerantes), no por posición — los alias exactos de SICAR son un riesgo abierto sin confirmar.
- Aplicación fila por fila, revalidando todo ANTES de mutar nada; un fallo en una fila no bloquea ni corrompe las demás (lección del bug real de `precios[0]` sobre `undefined`).
- Vive dentro del módulo `inventario` existente — permiso nuevo `migrar_datos`, sin tocar `MODULOS_SISTEMA` ni `MODULOS_QUE_REQUIEREN_PERMISOS`.
- El respaldo exportado NO necesita ser compatible con SICAR, solo con el propio importador de CORPUNISOUND.

---

## File Structure

- **Create:** `backend/migracion.js` — alias, parseo Excel, matching, validación, aplicación, exportación.
- **Create:** `backend/migracion.test.js` — pruebas del módulo anterior.
- **Create:** `backend/permisoMigrarDatos.test.js` — prueba del guardia de permisos (mismo patrón que `permisoRecibirCompra.test.js`).
- **Modify:** `backend/permisosCatalogo.js` — agrega el permiso `migrar_datos`.
- **Modify:** `backend/package.json` — agrega dependencia `xlsx`.
- **Modify:** `backend/server.js` — requiere `migracion.js`, sube el límite de `express.json`, agrega 3 rutas.
- **Create:** `src/MigracionDatos.jsx` — pantalla nueva.
- **Modify:** `src/Dashboard.jsx` — nuevo tile.
- **Modify:** `src/EncabezadoModulo.jsx` — nuevo título.
- **Modify:** `src/App.jsx` — nueva vista.

---

### Task 1: Dependencia `xlsx` + permiso `migrar_datos`

**Files:**
- Modify: `backend/package.json`
- Modify: `backend/permisosCatalogo.js`
- Test: `backend/permisoMigrarDatos.test.js`

**Interfaces:**
- Produces: permiso `migrar_datos` disponible en `listarPermisos()`, con `modulo: "inventario"`.

- [ ] **Step 1: Instalar la dependencia**

Run: `cd backend && npm install xlsx`
Expected: se agrega `"xlsx": "^0.18.x"` (o similar) a `backend/package.json` bajo `dependencies`.

- [ ] **Step 2: Escribir el test que falla (guardia de permisos)**

Crear `backend/permisoMigrarDatos.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { listarPermisos } = require("./permisosCatalogo");
const { validarSistemaDePermisos } = require("./validarPermisos");

test("existe el permiso migrar_datos en modulo inventario", () => {
  const p = listarPermisos().find((x) => x.clave === "migrar_datos");
  assert.ok(p, "el permiso debe existir en el catálogo");
  assert.strictEqual(p.modulo, "inventario");
  assert.strictEqual(p.implementado, true);
});

test("el guardia de arranque sigue pasando con el permiso nuevo", () => {
  assert.doesNotThrow(() => validarSistemaDePermisos());
});
```

- [ ] **Step 3: Correr el test y verificar que falla**

Run: `cd backend && node --test permisoMigrarDatos.test.js`
Expected: FAIL — "el permiso debe existir en el catálogo" (assert.ok con `p` undefined).

- [ ] **Step 4: Agregar el permiso al catálogo**

En `backend/permisosCatalogo.js`, dentro de la sección `// ---- Inventario y Productos ----`, después de la línea de `recibir_compra`:

```js
  { clave: "recibir_compra", etiqueta: "Recibir Compras a Proveedor", modulo: "inventario", implementado: true },
  { clave: "migrar_datos", etiqueta: "Migrar Datos (Importar/Exportar)", modulo: "inventario", implementado: true },
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `cd backend && node --test permisoMigrarDatos.test.js`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/permisosCatalogo.js backend/permisoMigrarDatos.test.js
git commit -m "feat: agregar permiso migrar_datos y dependencia xlsx para migracion de datos"
```

---

### Task 2: `backend/migracion.js` — alias de columnas y `parsearExcel`

**Files:**
- Create: `backend/migracion.js`
- Create: `backend/migracion.test.js`

**Interfaces:**
- Produces: `parsearExcel(archivoBase64, tipo)` → `{ filas, columnas_reconocidas, columnas_no_reconocidas }`. Cada fila es `{ numero_fila, ...camposInternosDelTipo }`. Lanza `Error` con mensaje claro si el archivo no es legible, no tiene filas, o le faltan columnas mínimas.
- Produces: `normalizarTexto(texto)` (exportada para reusarse en matching de categorías/departamentos en Task 4).
- Consumes: librería `xlsx` (Task 1).

- [ ] **Step 1: Escribir los tests que fallan**

Crear `backend/migracion.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const XLSX = require("xlsx");
const { parsearExcel } = require("./migracion");

function construirExcelBase64(filas) {
  const hoja = XLSX.utils.json_to_sheet(filas);
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, "Datos");
  return XLSX.write(libro, { type: "base64", bookType: "xlsx" });
}

test("parsearExcel lee articulos con encabezados estandar", () => {
  const base64 = construirExcelBase64([
    { "Clave": "AB-001", "Descripción": "Arroz 1kg", "Costo": 20, "Existencia": 100 },
    { "Clave": "AB-002", "Descripción": "Frijol 1kg", "Costo": 18, "Existencia": 50 },
  ]);
  const { filas, columnas_reconocidas } = parsearExcel(base64, "articulos");
  assert.strictEqual(filas.length, 2);
  assert.strictEqual(filas[0].clave, "AB-001");
  assert.strictEqual(filas[0].descripcion, "Arroz 1kg");
  assert.strictEqual(filas[0].costo, 20);
  assert.strictEqual(filas[0].numero_fila, 2);
  assert.ok(columnas_reconocidas.includes("Clave"));
});

test("parsearExcel reconoce alias con acentos/mayusculas distintos", () => {
  const base64 = construirExcelBase64([
    { "codigo": "AB-001", "nombre": "Arroz 1kg" },
  ]);
  const { filas } = parsearExcel(base64, "articulos");
  assert.strictEqual(filas[0].clave, "AB-001");
  assert.strictEqual(filas[0].descripcion, "Arroz 1kg");
});

test("parsearExcel de articulos truena con mensaje claro si falta la clave", () => {
  const base64 = construirExcelBase64([{ "Descripción": "Arroz 1kg" }]);
  assert.throws(() => parsearExcel(base64, "articulos"), /Faltan columnas obligatorias.*clave/);
});

test("parsearExcel reporta columnas no reconocidas sin tronar", () => {
  const base64 = construirExcelBase64([
    { "Clave": "AB-001", "Descripción": "Arroz 1kg", "Columna Rara": "x" },
  ]);
  const { columnas_no_reconocidas } = parsearExcel(base64, "articulos");
  assert.ok(columnas_no_reconocidas.includes("Columna Rara"));
});

test("parsearExcel de clientes exige clave y nombre", () => {
  const base64 = construirExcelBase64([{ "Clave": "CLI001", "Nombre": "Abarrotes Mary", "RFC": "XAXX010101000" }]);
  const { filas } = parsearExcel(base64, "clientes");
  assert.strictEqual(filas[0].clave, "CLI001");
  assert.strictEqual(filas[0].nombre, "Abarrotes Mary");
});

test("parsearExcel de proveedores exige rfc y nombre", () => {
  const base64 = construirExcelBase64([{ "RFC": "DINX800101ABC", "Nombre": "Distribuidora del Norte" }]);
  const { filas } = parsearExcel(base64, "proveedores");
  assert.strictEqual(filas[0].rfc, "DINX800101ABC");
  assert.strictEqual(filas[0].nombre, "Distribuidora del Norte");
});

test("parsearExcel truena con mensaje claro si el archivo no es un Excel valido", () => {
  const basura = Buffer.from("esto no es un excel").toString("base64");
  assert.throws(() => parsearExcel(basura, "articulos"), /no se pudo leer como Excel/);
});

test("parsearExcel truena si el tipo es desconocido", () => {
  const base64 = construirExcelBase64([{ "Clave": "AB-001", "Descripción": "x" }]);
  assert.throws(() => parsearExcel(base64, "insumos"), /Tipo de importación desconocido/);
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd backend && node --test migracion.test.js`
Expected: FAIL — "Cannot find module './migracion'".

- [ ] **Step 3: Implementar `backend/migracion.js` (primera parte: alias y `parsearExcel`)**

```js
/**
 * migracion.js — Importar/exportar Artículos, Clientes y Proveedores desde
 * el Excel que exporta SICAR (Procesos > Exportar), y exportar un respaldo
 * propio de CORPUNISOUND releíble por este mismo importador.
 *
 * Cada instalación de SICAR corresponde a UNA sucursal — por eso Artículos
 * y Clientes piden sucursal al importar/exportar; Proveedores no, son
 * globales. El matching contra lo ya existente es SIEMPRE por clave/RFC,
 * nunca por nombre (ver spec 2026-07-12-migracion-datos-sicar-design.md).
 *
 * No hay todavía un archivo real de SICAR para confirmar los alias de
 * columna exactos — están concentrados en TABLAS_ALIAS para que ajustar
 * un nombre sea un cambio de una línea cuando llegue un archivo real.
 */

const XLSX = require("xlsx");
const { crearProducto, actualizarProducto, ajustarExistencia, crearCategoria, crearDepartamento } = require("./productos");
const { crearCliente, actualizarCliente } = require("./clientes");
const { crearProveedor } = require("./productos");

const TABLAS_ALIAS = {
  articulos: {
    clave: ["Clave", "Código", "Clave Artículo"],
    clave_alterna: ["Clave Alterna", "Código de Barras"],
    descripcion: ["Descripción", "Nombre", "Artículo"],
    categoria: ["Categoría"],
    departamento: ["Departamento"],
    costo: ["Costo", "Precio Compra", "Precio de Compra"],
    precio1: ["Precio 1", "Precio Público"],
    precio2: ["Precio 2"],
    precio3: ["Precio 3"],
    precio4: ["Precio 4"],
    existencia: ["Existencia", "Exist.", "Inventario"],
    unidad: ["Unidad", "Unidad Venta", "Unidad de Venta"],
    iva: ["IVA", "Impuesto", "Impuestos"],
    ubicacion: ["Ubicación", "Localización"],
  },
  clientes: {
    clave: ["Clave", "Código"],
    nombre: ["Nombre", "Cliente", "Razón Social"],
    rfc: ["RFC"],
    telefono: ["Teléfono"],
    celular: ["Celular"],
    email: ["eMail", "Correo", "Email"],
    limite_credito: ["Límite de Crédito", "Límite Crédito"],
    dias_credito: ["Días de Crédito"],
  },
  proveedores: {
    rfc: ["RFC"],
    nombre: ["Nombre", "Proveedor", "Razón Social"],
    contacto: ["Contacto", "Teléfono"],
  },
};

const COLUMNAS_MINIMAS = {
  articulos: ["clave", "descripcion"],
  clientes: ["clave", "nombre"],
  proveedores: ["rfc", "nombre"],
};

function normalizarTexto(texto) {
  return String(texto == null ? "" : texto)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .trim().toLowerCase();
}

function mapearEncabezados(encabezados, tabla) {
  const mapa = {};
  const reconocidas = new Set();
  for (const [campo, alias] of Object.entries(tabla)) {
    const aliasNorm = alias.map(normalizarTexto);
    const encontrado = encabezados.find((e) => aliasNorm.includes(normalizarTexto(e)));
    if (encontrado) { mapa[campo] = encontrado; reconocidas.add(encontrado); }
  }
  return { mapa, reconocidas };
}

function parsearExcel(archivoBase64, tipo) {
  const tabla = TABLAS_ALIAS[tipo];
  if (!tabla) throw new Error(`Tipo de importación desconocido: ${tipo}`);

  let libro;
  try {
    libro = XLSX.read(archivoBase64, { type: "base64" });
    if (!libro.SheetNames.length) throw new Error("sin hojas");
  } catch (e) {
    throw new Error("El archivo no se pudo leer como Excel (.xls/.xlsx válido)");
  }

  const hoja = libro.Sheets[libro.SheetNames[0]];
  const filasCrudas = XLSX.utils.sheet_to_json(hoja, { defval: "" });
  if (filasCrudas.length === 0) throw new Error("El archivo no tiene filas de datos");

  const encabezados = Object.keys(filasCrudas[0]);
  const { mapa, reconocidas } = mapearEncabezados(encabezados, tabla);

  const faltantes = COLUMNAS_MINIMAS[tipo].filter((campo) => !mapa[campo]);
  if (faltantes.length > 0) {
    throw new Error(
      `Faltan columnas obligatorias (${faltantes.join(", ")}). ` +
      `Columnas encontradas en el archivo: ${encabezados.join(", ")}`
    );
  }

  const columnas_no_reconocidas = encabezados.filter((e) => !reconocidas.has(e));

  const filas = filasCrudas.map((filaCruda, i) => {
    const fila = { numero_fila: i + 2 };
    for (const campo of Object.keys(tabla)) {
      const encabezado = mapa[campo];
      fila[campo] = encabezado ? filaCruda[encabezado] : undefined;
    }
    return fila;
  });

  return { filas, columnas_reconocidas: [...reconocidas], columnas_no_reconocidas };
}

module.exports = { parsearExcel, normalizarTexto, TABLAS_ALIAS };
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `cd backend && node --test migracion.test.js`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/migracion.js backend/migracion.test.js
git commit -m "feat: parsearExcel para migracion de datos (deteccion de columnas por alias)"
```

---

### Task 3: `previsualizarImportacion` — matching y validación

**Files:**
- Modify: `backend/migracion.js`
- Modify: `backend/migracion.test.js`

**Interfaces:**
- Consumes: `normalizarTexto` (Task 2), `construirDBPrueba` de `./testHelpers` (para tests).
- Produces: `previsualizarImportacion(DB, tipo, filas)` → `{ filas: [{ numero_fila, datos, accion: "alta"|"actualizacion"|null, id_existente, valida, errores }], resumen: { total, altas, actualizaciones, invalidas } }`.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `backend/migracion.test.js`:

```js
const { construirDBPrueba } = require("./testHelpers");
const { previsualizarImportacion } = require("./migracion");

test("previsualizarImportacion marca actualizacion si la clave del articulo ya existe", () => {
  const DB = construirDBPrueba();
  const filas = [{ numero_fila: 2, clave: "AB-001", descripcion: "Arroz 1kg editado", costo: 22 }];
  const { filas: resultado, resumen } = previsualizarImportacion(DB, "articulos", filas);
  assert.strictEqual(resultado[0].accion, "actualizacion");
  assert.strictEqual(resultado[0].id_existente, 1);
  assert.strictEqual(resumen.actualizaciones, 1);
  assert.strictEqual(resumen.altas, 0);
});

test("previsualizarImportacion marca alta si la clave del articulo no existe", () => {
  const DB = construirDBPrueba();
  const filas = [{ numero_fila: 2, clave: "NUEVO-001", descripcion: "Guitarra acústica" }];
  const { filas: resultado, resumen } = previsualizarImportacion(DB, "articulos", filas);
  assert.strictEqual(resultado[0].accion, "alta");
  assert.strictEqual(resultado[0].id_existente, null);
  assert.strictEqual(resumen.altas, 1);
});

test("previsualizarImportacion marca invalida una fila sin clave, sin tumbar las demas", () => {
  const DB = construirDBPrueba();
  const filas = [
    { numero_fila: 2, clave: "", descripcion: "Sin clave" },
    { numero_fila: 3, clave: "NUEVO-002", descripcion: "Otra" },
  ];
  const { filas: resultado, resumen } = previsualizarImportacion(DB, "articulos", filas);
  assert.strictEqual(resultado[0].valida, false);
  assert.ok(resultado[0].errores.length > 0);
  assert.strictEqual(resultado[1].valida, true);
  assert.strictEqual(resumen.invalidas, 1);
});

test("previsualizarImportacion marca invalida un costo no numerico", () => {
  const DB = construirDBPrueba();
  const filas = [{ numero_fila: 2, clave: "AB-001", descripcion: "Arroz", costo: "no-es-numero" }];
  const { filas: resultado } = previsualizarImportacion(DB, "articulos", filas);
  assert.strictEqual(resultado[0].valida, false);
});

test("previsualizarImportacion de clientes hace match por clave", () => {
  const DB = construirDBPrueba();
  const filas = [{ numero_fila: 2, clave: "CLI001", nombre: "Abarrotes Mary S.A." }];
  const { filas: resultado } = previsualizarImportacion(DB, "clientes", filas);
  assert.strictEqual(resultado[0].accion, "actualizacion");
  assert.strictEqual(resultado[0].id_existente, 1);
});

test("previsualizarImportacion de proveedores hace match por rfc", () => {
  const DB = construirDBPrueba();
  const filas = [{ numero_fila: 2, rfc: "PROV-RFC-YA-EXISTE", nombre: "Cualquiera" }];
  DB["catalogo-productos"].proveedores.push({ id: 9, nombre: "Viejo", rfc: "PROV-RFC-YA-EXISTE", contacto: "" });
  const { filas: resultado } = previsualizarImportacion(DB, "proveedores", filas);
  assert.strictEqual(resultado[0].accion, "actualizacion");
  assert.strictEqual(resultado[0].id_existente, 9);
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd backend && node --test migracion.test.js`
Expected: FAIL — "previsualizarImportacion is not a function".

- [ ] **Step 3: Implementar `previsualizarImportacion`**

Agregar a `backend/migracion.js` (antes de `module.exports`):

```js
function validarFilaArticulo(fila) {
  const errores = [];
  if (!fila.clave || !String(fila.clave).trim()) errores.push("Falta la clave");
  if (!fila.descripcion || !String(fila.descripcion).trim()) errores.push("Falta la descripción");
  for (const campo of ["costo", "precio1", "precio2", "precio3", "precio4", "existencia"]) {
    const v = fila[campo];
    if (v !== undefined && v !== "" && !Number.isFinite(Number(v))) errores.push(`"${campo}" no es un número válido`);
  }
  return errores;
}

function validarFilaCliente(fila) {
  const errores = [];
  if (!fila.clave || !String(fila.clave).trim()) errores.push("Falta la clave");
  if (!fila.nombre || !String(fila.nombre).trim()) errores.push("Falta el nombre");
  for (const campo of ["limite_credito", "dias_credito"]) {
    const v = fila[campo];
    if (v !== undefined && v !== "" && !Number.isFinite(Number(v))) errores.push(`"${campo}" no es un número válido`);
  }
  return errores;
}

function validarFilaProveedor(fila) {
  const errores = [];
  if (!fila.rfc || !String(fila.rfc).trim()) errores.push("Falta el RFC");
  if (!fila.nombre || !String(fila.nombre).trim()) errores.push("Falta el nombre");
  return errores;
}

const VALIDADORES = { articulos: validarFilaArticulo, clientes: validarFilaCliente, proveedores: validarFilaProveedor };

function buscarArticuloExistente(DB, fila) {
  return DB["catalogo-productos"].productos.find((p) => p.sku === fila.clave || (fila.clave && p.clave_alterna === fila.clave)) || null;
}
function buscarClienteExistente(DB, fila) {
  return DB.crm.clientes.find((c) => c.clave === fila.clave) || null;
}
function buscarProveedorExistente(DB, fila) {
  return DB["catalogo-productos"].proveedores.find((p) => p.rfc === fila.rfc) || null;
}

const BUSCADORES = { articulos: buscarArticuloExistente, clientes: buscarClienteExistente, proveedores: buscarProveedorExistente };

function previsualizarImportacion(DB, tipo, filas) {
  const validar = VALIDADORES[tipo];
  const buscar = BUSCADORES[tipo];
  if (!validar || !buscar) throw new Error(`Tipo de importación desconocido: ${tipo}`);

  const resultado = filas.map((fila) => {
    const errores = validar(fila);
    if (errores.length > 0) {
      return { numero_fila: fila.numero_fila, datos: fila, accion: null, id_existente: null, valida: false, errores };
    }
    const existente = buscar(DB, fila);
    return {
      numero_fila: fila.numero_fila,
      datos: fila,
      accion: existente ? "actualizacion" : "alta",
      id_existente: existente ? existente.id : null,
      valida: true,
      errores: [],
    };
  });

  const resumen = {
    total: resultado.length,
    altas: resultado.filter((r) => r.valida && r.accion === "alta").length,
    actualizaciones: resultado.filter((r) => r.valida && r.accion === "actualizacion").length,
    invalidas: resultado.filter((r) => !r.valida).length,
  };

  return { filas: resultado, resumen };
}
```

Actualizar `module.exports`:

```js
module.exports = { parsearExcel, previsualizarImportacion, normalizarTexto, TABLAS_ALIAS, VALIDADORES, BUSCADORES };
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `cd backend && node --test migracion.test.js`
Expected: PASS (14 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/migracion.js backend/migracion.test.js
git commit -m "feat: previsualizarImportacion con matching por clave/rfc y validacion de filas"
```

---

### Task 4: `aplicarImportacion` — Artículos

**Files:**
- Modify: `backend/migracion.js`
- Modify: `backend/migracion.test.js`

**Interfaces:**
- Consumes: `VALIDADORES`, `BUSCADORES` (Task 3); `crearProducto`, `actualizarProducto`, `ajustarExistencia`, `crearCategoria`, `crearDepartamento` de `./productos`.
- Produces: `aplicarImportacion(DB, tipo, filasConfirmadas, sucursal_id, defaults, nombreArchivo)` → `{ actualizados: N, nuevos: M, errores: [{ numero_fila, clave, motivo }] }`. `filasConfirmadas` son objetos `fila` (la misma forma que produce `parsearExcel`/aparece en `datos` de la previsualización). `defaults` es `{ categoria, departamento, unidad, iva }` (todos opcionales, strings salvo `iva` boolean).

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `backend/migracion.test.js`:

```js
const { aplicarImportacion } = require("./migracion");

test("aplicarImportacion de articulos: alta nueva usa los defaults si el archivo no trae categoria/departamento/unidad", () => {
  const DB = construirDBPrueba();
  const filas = [{ numero_fila: 2, clave: "GTR-001", descripcion: "Guitarra acústica", costo: 1000, existencia: 5 }];
  const resumen = aplicarImportacion(DB, "articulos", filas, 1, { categoria: "Instrumentos", departamento: "Cuerdas", unidad: "PZA" }, "test.xlsx");
  assert.strictEqual(resumen.nuevos, 1);
  assert.strictEqual(resumen.errores.length, 0);
  const nuevo = DB["catalogo-productos"].productos.find((p) => p.sku === "GTR-001");
  assert.ok(nuevo, "el producto debe haberse creado");
  const categoria = DB["catalogo-productos"].categorias.find((c) => c.id === nuevo.categoria_id);
  assert.strictEqual(categoria.nombre, "Instrumentos");
});

test("aplicarImportacion de articulos: alta nueva sin defaults ni datos en el archivo se reporta como error, no truena", () => {
  const DB = construirDBPrueba();
  const filas = [{ numero_fila: 2, clave: "GTR-002", descripcion: "Guitarra sin categoria" }];
  const resumen = aplicarImportacion(DB, "articulos", filas, 1, {}, "test.xlsx");
  assert.strictEqual(resumen.nuevos, 0);
  assert.strictEqual(resumen.errores.length, 1);
  assert.strictEqual(resumen.errores[0].numero_fila, 2);
});

test("aplicarImportacion de articulos: actualizacion solo cambia los campos presentes en el archivo", () => {
  const DB = construirDBPrueba();
  const antes = DB["catalogo-productos"].productos.find((p) => p.sku === "AB-001");
  const nombreAntes = antes.nombre;
  const filas = [{ numero_fila: 2, clave: "AB-001", descripcion: undefined, costo: 25 }];
  aplicarImportacion(DB, "articulos", filas, 1, {}, "test.xlsx");
  const despues = DB["catalogo-productos"].productos.find((p) => p.sku === "AB-001");
  assert.strictEqual(despues.nombre, nombreAntes, "la descripcion no debia cambiar (no vino en el archivo)");
  assert.strictEqual(despues.costo, 25);
});

test("aplicarImportacion de articulos: ajusta la existencia al VALOR del archivo, no la suma", () => {
  const DB = construirDBPrueba();
  const existAntes = DB.inventario.existencias.find((e) => e.producto_id === 1 && e.sucursal_id === 1).cantidad_actual;
  const filas = [{ numero_fila: 2, clave: "AB-001", existencia: existAntes + 7 }];
  aplicarImportacion(DB, "articulos", filas, 1, {}, "test.xlsx");
  const existDespues = DB.inventario.existencias.find((e) => e.producto_id === 1 && e.sucursal_id === 1).cantidad_actual;
  assert.strictEqual(existDespues, existAntes + 7);
});

test("aplicarImportacion de articulos: una fila con error no bloquea las demas", () => {
  const DB = construirDBPrueba();
  const filas = [
    { numero_fila: 2, clave: "GTR-003", descripcion: "Sin categoria, debe fallar" },
    { numero_fila: 3, clave: "AB-001", costo: 30 },
  ];
  const resumen = aplicarImportacion(DB, "articulos", filas, 1, {}, "test.xlsx");
  assert.strictEqual(resumen.errores.length, 1);
  assert.strictEqual(resumen.actualizados, 1);
  const actualizado = DB["catalogo-productos"].productos.find((p) => p.sku === "AB-001");
  assert.strictEqual(actualizado.costo, 30);
});

test("aplicarImportacion de articulos: si el archivo trae precios, la utilidad se recalcula hacia atras desde el costo", () => {
  const DB = construirDBPrueba();
  const filas = [{ numero_fila: 2, clave: "AB-001", costo: 20, precio1: 30 }];
  aplicarImportacion(DB, "articulos", filas, 1, {}, "test.xlsx");
  const actualizado = DB["catalogo-productos"].productos.find((p) => p.sku === "AB-001");
  assert.strictEqual(actualizado.precios[0].precioVenta, 30);
  assert.strictEqual(actualizado.precios[0].utilidad, 50);
});

test("aplicarImportacion de articulos: reimportar el mismo archivo no duplica (segunda pasada es actualizacion)", () => {
  const DB = construirDBPrueba();
  const filas = [{ numero_fila: 2, clave: "NUEVO-XYZ", descripcion: "Pandereta" }];
  const defaults = { categoria: "Percusiones", departamento: "Percusiones", unidad: "PZA" };
  aplicarImportacion(DB, "articulos", filas, 1, defaults, "test.xlsx");
  const totalTrasPrimera = DB["catalogo-productos"].productos.length;
  aplicarImportacion(DB, "articulos", filas, 1, defaults, "test.xlsx");
  assert.strictEqual(DB["catalogo-productos"].productos.length, totalTrasPrimera, "no debe haber creado un segundo producto");
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd backend && node --test migracion.test.js`
Expected: FAIL — "aplicarImportacion is not a function".

- [ ] **Step 3: Implementar `aplicarImportacion` (Artículos) en `backend/migracion.js`**

```js
function interpretarIva(valor) {
  const norm = normalizarTexto(valor);
  if (!norm) return false;
  if (["no", "0", "false"].includes(norm)) return false;
  return true;
}

function resolverCategoriaPorNombre(DB, nombre) {
  if (!nombre || !String(nombre).trim()) return undefined;
  const norm = normalizarTexto(nombre);
  const existente = DB["catalogo-productos"].categorias.find((c) => normalizarTexto(c.nombre) === norm);
  return existente ? existente.id : crearCategoria(DB, String(nombre).trim()).id;
}

function resolverDepartamentoPorNombre(DB, nombre) {
  if (!nombre || !String(nombre).trim()) return undefined;
  const norm = normalizarTexto(nombre);
  const existente = DB["catalogo-productos"].departamentos.find((d) => normalizarTexto(d.nombre) === norm);
  return existente ? existente.id : crearDepartamento(DB, String(nombre).trim()).id;
}

function construirPrecios(fila, existente, costoNuevo) {
  const niveles = [fila.precio1, fila.precio2, fila.precio3, fila.precio4];
  const algunoTraePrecio = niveles.some((v) => v !== undefined && v !== "" && Number.isFinite(Number(v)));
  if (!algunoTraePrecio) return undefined;
  const preciosActuales = Array.isArray(existente?.precios)
    ? existente.precios
    : [{ utilidad: 0, precioVenta: 0 }, { utilidad: 0, precioVenta: 0 }, { utilidad: 0, precioVenta: 0 }, { utilidad: 0, precioVenta: 0 }];
  return niveles.map((v, i) => {
    if (v === undefined || v === "" || !Number.isFinite(Number(v))) return preciosActuales[i];
    const precioVenta = Math.round(Number(v) * 100) / 100;
    const utilidad = costoNuevo > 0 ? Math.round(((precioVenta / costoNuevo) - 1) * 10000) / 100 : 0;
    return { utilidad, precioVenta };
  });
}

function prepararDatosArticulo(DB, fila, existente, defaults) {
  const errores = [];
  const categoriaNombre = fila.categoria || defaults?.categoria;
  const departamentoNombre = fila.departamento || defaults?.departamento;
  const unidad = fila.unidad || defaults?.unidad;

  if (!existente) {
    if (!categoriaNombre) errores.push("Falta categoría (ni en el archivo ni en los datos por defecto)");
    if (!departamentoNombre) errores.push("Falta departamento (ni en el archivo ni en los datos por defecto)");
    if (!unidad) errores.push("Falta unidad (ni en el archivo ni en los datos por defecto)");
  }
  if (errores.length > 0) return { errores };

  const costoNuevo = fila.costo !== undefined && fila.costo !== "" ? Number(fila.costo) : (existente ? existente.costo : 0);
  const datos = {
    descripcion: fila.descripcion,
    clave: fila.clave,
    clave_alterna: fila.clave_alterna || undefined,
    categoria_id: resolverCategoriaPorNombre(DB, categoriaNombre),
    departamento_id: resolverDepartamentoPorNombre(DB, departamentoNombre),
    unidad_venta: unidad,
    unidad_compra: unidad,
    precio_compra: fila.costo !== undefined && fila.costo !== "" ? costoNuevo : undefined,
    iva: fila.iva !== undefined && fila.iva !== "" ? interpretarIva(fila.iva) : (defaults?.iva !== undefined ? !!defaults.iva : undefined),
    ubicacion: fila.ubicacion || undefined,
  };
  const precios = construirPrecios(fila, existente, costoNuevo);
  if (precios) datos.precios = precios;

  return { datos, errores: [] };
}

function aplicarFilaArticulo(DB, fila, existente, sucursal_id, defaults, nombreArchivo) {
  const { datos, errores } = prepararDatosArticulo(DB, fila, existente, defaults);
  if (errores.length > 0) throw new Error(errores.join("; "));

  if (existente) {
    const actualizado = actualizarProducto(DB, existente.id, datos, sucursal_id);
    if (fila.existencia !== undefined && fila.existencia !== "") {
      const exist = DB.inventario.existencias.find((e) => e.producto_id === existente.id && e.sucursal_id === Number(sucursal_id));
      const actual = exist ? exist.cantidad_actual : 0;
      const delta = Number(fila.existencia) - actual;
      if (delta !== 0) ajustarExistencia(DB, existente.id, { cantidad: delta, motivo: `Importación SICAR — ${nombreArchivo || "archivo"}`, sucursal_id });
    }
    return actualizado;
  }
  return crearProducto(DB, { ...datos, existencia_inicial: fila.existencia !== undefined && fila.existencia !== "" ? Number(fila.existencia) : 0 }, sucursal_id);
}

const APLICADORES = { articulos: aplicarFilaArticulo };

function aplicarImportacion(DB, tipo, filasConfirmadas, sucursal_id, defaults, nombreArchivo) {
  const validar = VALIDADORES[tipo];
  const buscar = BUSCADORES[tipo];
  const aplicar = APLICADORES[tipo];
  if (!validar || !buscar || !aplicar) throw new Error(`Tipo de importación desconocido: ${tipo}`);

  const preparadas = filasConfirmadas.map((fila) => ({
    fila,
    erroresValidacion: validar(fila),
    existente: buscar(DB, fila),
  }));

  let actualizados = 0;
  let nuevos = 0;
  const errores = [];

  for (const { fila, erroresValidacion, existente } of preparadas) {
    if (erroresValidacion.length > 0) {
      errores.push({ numero_fila: fila.numero_fila, clave: fila.clave || fila.rfc, motivo: erroresValidacion.join("; ") });
      continue;
    }
    try {
      aplicar(DB, fila, existente, sucursal_id, defaults, nombreArchivo);
      if (existente) actualizados++; else nuevos++;
    } catch (e) {
      errores.push({ numero_fila: fila.numero_fila, clave: fila.clave || fila.rfc, motivo: e.message });
    }
  }

  return { actualizados, nuevos, errores };
}
```

Actualizar `module.exports`:

```js
module.exports = {
  parsearExcel, previsualizarImportacion, aplicarImportacion,
  normalizarTexto, TABLAS_ALIAS, VALIDADORES, BUSCADORES,
};
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `cd backend && node --test migracion.test.js`
Expected: PASS (21 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/migracion.js backend/migracion.test.js
git commit -m "feat: aplicarImportacion de articulos (altas, actualizaciones, existencia, precios)"
```

---

### Task 5: `aplicarImportacion` — Clientes y Proveedores

**Files:**
- Modify: `backend/migracion.js`
- Modify: `backend/migracion.test.js`

**Interfaces:**
- Consumes: `crearCliente`, `actualizarCliente` de `./clientes`; `crearProveedor` de `./productos` (ya requeridos en Task 2).
- Produces: `APLICADORES.clientes`, `APLICADORES.proveedores` (misma forma que `APLICADORES.articulos` de Task 4).

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `backend/migracion.test.js`:

```js
test("aplicarImportacion de clientes: alta nueva usa la sucursal seleccionada", () => {
  const DB = construirDBPrueba();
  const filas = [{ numero_fila: 2, clave: "CLI999", nombre: "Cliente Nuevo SICAR", rfc: "XAXX010101000" }];
  const resumen = aplicarImportacion(DB, "clientes", filas, 2, {}, "test.xlsx");
  assert.strictEqual(resumen.nuevos, 1);
  const nuevo = DB.crm.clientes.find((c) => c.clave === "CLI999");
  assert.strictEqual(nuevo.sucursal_id, 2);
});

test("aplicarImportacion de clientes: actualizacion no borra campos que no vienen en el archivo", () => {
  const DB = construirDBPrueba();
  const antes = DB.crm.clientes.find((c) => c.clave === "CLI001");
  const limiteAntes = antes.limite_credito;
  const filas = [{ numero_fila: 2, clave: "CLI001", nombre: "Abarrotes Mary", telefono: "9191234567" }];
  aplicarImportacion(DB, "clientes", filas, 1, {}, "test.xlsx");
  const despues = DB.crm.clientes.find((c) => c.clave === "CLI001");
  assert.strictEqual(despues.telefono, "9191234567");
  assert.strictEqual(despues.limite_credito, limiteAntes, "no debia perderse el limite de credito existente");
});

test("aplicarImportacion de clientes: no cambia la sucursal de un cliente ya existente", () => {
  const DB = construirDBPrueba();
  const filas = [{ numero_fila: 2, clave: "CLI001", nombre: "Abarrotes Mary" }];
  aplicarImportacion(DB, "clientes", filas, 3, {}, "test.xlsx");
  const cliente = DB.crm.clientes.find((c) => c.clave === "CLI001");
  assert.strictEqual(cliente.sucursal_id, 1, "el sucursal_id original no debe tocarse en una actualizacion");
});

test("aplicarImportacion de proveedores: alta nueva y actualizacion por rfc", () => {
  const DB = construirDBPrueba();
  const altas = [{ numero_fila: 2, rfc: "NUEVO-RFC-001", nombre: "Proveedor Nuevo", contacto: "9191112233" }];
  const resumenAlta = aplicarImportacion(DB, "proveedores", altas, null, {}, "test.xlsx");
  assert.strictEqual(resumenAlta.nuevos, 1);

  const actualizaciones = [{ numero_fila: 2, rfc: "NUEVO-RFC-001", nombre: "Proveedor Nuevo Renombrado", contacto: "9199998877" }];
  const resumenUpdate = aplicarImportacion(DB, "proveedores", actualizaciones, null, {}, "test.xlsx");
  assert.strictEqual(resumenUpdate.actualizados, 1);
  const proveedor = DB["catalogo-productos"].proveedores.find((p) => p.rfc === "NUEVO-RFC-001");
  assert.strictEqual(proveedor.nombre, "Proveedor Nuevo Renombrado");
  assert.strictEqual(proveedor.contacto, "9199998877");
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd backend && node --test migracion.test.js`
Expected: FAIL — `TypeError: aplicar is not a function` (tipo "clientes"/"proveedores" no tienen `APLICADORES` registrado).

- [ ] **Step 3: Implementar los aplicadores de Clientes y Proveedores**

Agregar a `backend/migracion.js`, antes de la definición de `APLICADORES`:

```js
function aplicarFilaCliente(DB, fila, existente, sucursal_id) {
  const datosCrudos = {
    clave: fila.clave,
    nombre: fila.nombre,
    rfc: fila.rfc || undefined,
    telefono: fila.telefono || undefined,
    celular: fila.celular || undefined,
    email: fila.email || undefined,
    limite_credito: fila.limite_credito !== undefined && fila.limite_credito !== "" ? Number(fila.limite_credito) : undefined,
    dias_credito: fila.dias_credito !== undefined && fila.dias_credito !== "" ? Number(fila.dias_credito) : undefined,
  };
  if (existente) {
    // actualizarCliente hace un spread plano — NUNCA mandarle valores
    // undefined, o sobrescribiría campos existentes con undefined.
    const datosLimpios = Object.fromEntries(Object.entries(datosCrudos).filter(([, v]) => v !== undefined));
    return actualizarCliente(DB, existente.id, datosLimpios);
  }
  return crearCliente(DB, { ...datosCrudos, sucursal_id });
}

function aplicarFilaProveedor(DB, fila, existente) {
  if (existente) {
    if (fila.nombre) existente.nombre = fila.nombre;
    if (fila.contacto) existente.contacto = fila.contacto;
    return existente;
  }
  const nuevo = crearProveedor(DB, fila.nombre, fila.rfc);
  if (fila.contacto) nuevo.contacto = fila.contacto;
  return nuevo;
}
```

Actualizar la tabla `APLICADORES`:

```js
const APLICADORES = {
  articulos: aplicarFilaArticulo,
  clientes: aplicarFilaCliente,
  proveedores: aplicarFilaProveedor,
};
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `cd backend && node --test migracion.test.js`
Expected: PASS (25 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/migracion.js backend/migracion.test.js
git commit -m "feat: aplicarImportacion de clientes y proveedores"
```

---

### Task 6: `exportarRespaldo` y ciclo completo exportar → importar

**Files:**
- Modify: `backend/migracion.js`
- Modify: `backend/migracion.test.js`

**Interfaces:**
- Produces: `exportarRespaldo(DB, tipo, sucursal_id)` → string base64 de un `.xlsx` (una hoja llamada "Datos") releíble por `parsearExcel`.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `backend/migracion.test.js`:

```js
const { exportarRespaldo } = require("./migracion");

test("exportarRespaldo de articulos genera un xlsx que el mismo parser vuelve a leer (ciclo completo)", () => {
  const DB = construirDBPrueba();
  const base64 = exportarRespaldo(DB, "articulos", 1);
  const { filas } = parsearExcel(base64, "articulos");
  const arroz = filas.find((f) => f.clave === "AB-001");
  assert.ok(arroz, "el articulo exportado debe volver a reconocerse al reimportar");
  assert.strictEqual(Number(arroz.costo), DB["catalogo-productos"].productos.find((p) => p.sku === "AB-001").costo);
});

test("exportarRespaldo de clientes excluye a Publico en General (id 0)", () => {
  const DB = construirDBPrueba();
  const base64 = exportarRespaldo(DB, "clientes", 1);
  const { filas } = parsearExcel(base64, "clientes");
  assert.ok(!filas.some((f) => f.nombre === "Público en General"));
});

test("exportarRespaldo de proveedores no depende de sucursal", () => {
  const DB = construirDBPrueba();
  const base64 = exportarRespaldo(DB, "proveedores", null);
  const { filas } = parsearExcel(base64, "proveedores");
  assert.strictEqual(filas.length, DB["catalogo-productos"].proveedores.length);
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd backend && node --test migracion.test.js`
Expected: FAIL — "exportarRespaldo is not a function".

- [ ] **Step 3: Implementar `exportarRespaldo`**

Agregar a `backend/migracion.js`, antes de `module.exports`:

```js
function primerAlias(tipo, campo) {
  return TABLAS_ALIAS[tipo][campo][0];
}

function exportarFilasArticulos(DB, sucursal_id) {
  const T = (campo) => primerAlias("articulos", campo);
  return DB["catalogo-productos"].productos.map((p) => {
    const exist = DB.inventario.existencias.find((e) => e.producto_id === p.id && e.sucursal_id === Number(sucursal_id));
    const categoria = DB["catalogo-productos"].categorias.find((c) => c.id === p.categoria_id);
    const departamento = DB["catalogo-productos"].departamentos.find((d) => d.id === p.departamento_id);
    const precios = Array.isArray(p.precios) ? p.precios : [];
    return {
      [T("clave")]: p.sku,
      [T("clave_alterna")]: p.clave_alterna || "",
      [T("descripcion")]: p.nombre,
      [T("categoria")]: categoria ? categoria.nombre : "",
      [T("departamento")]: departamento ? departamento.nombre : "",
      [T("costo")]: p.costo || 0,
      [T("precio1")]: precios[0]?.precioVenta || 0,
      [T("precio2")]: precios[1]?.precioVenta || 0,
      [T("precio3")]: precios[2]?.precioVenta || 0,
      [T("precio4")]: precios[3]?.precioVenta || 0,
      [T("existencia")]: exist ? exist.cantidad_actual : 0,
      [T("unidad")]: p.unidad_venta || "",
      [T("iva")]: p.iva ? "SI" : "NO",
      [T("ubicacion")]: p.ubicacion || "",
    };
  });
}

function exportarFilasClientes(DB, sucursal_id) {
  const T = (campo) => primerAlias("clientes", campo);
  return DB.crm.clientes
    .filter((c) => c.id !== 0 && (sucursal_id == null || c.sucursal_id === Number(sucursal_id)))
    .map((c) => ({
      [T("clave")]: c.clave || "",
      [T("nombre")]: c.nombre,
      [T("rfc")]: c.rfc || "",
      [T("telefono")]: c.telefono || "",
      [T("celular")]: c.celular || "",
      [T("email")]: c.email || "",
      [T("limite_credito")]: c.limite_credito || 0,
      [T("dias_credito")]: c.dias_credito || 0,
    }));
}

function exportarFilasProveedores(DB) {
  const T = (campo) => primerAlias("proveedores", campo);
  return DB["catalogo-productos"].proveedores.map((p) => ({
    [T("rfc")]: p.rfc || "",
    [T("nombre")]: p.nombre,
    [T("contacto")]: p.contacto || "",
  }));
}

const CONSTRUCTORES_EXPORT = {
  articulos: exportarFilasArticulos,
  clientes: exportarFilasClientes,
  proveedores: (DB) => exportarFilasProveedores(DB),
};

function exportarRespaldo(DB, tipo, sucursal_id) {
  const construir = CONSTRUCTORES_EXPORT[tipo];
  if (!construir) throw new Error(`Tipo de exportación desconocido: ${tipo}`);
  const filas = construir(DB, sucursal_id);
  const hoja = XLSX.utils.json_to_sheet(filas);
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, "Datos");
  return XLSX.write(libro, { type: "base64", bookType: "xlsx" });
}
```

Actualizar `module.exports`:

```js
module.exports = {
  parsearExcel, previsualizarImportacion, aplicarImportacion, exportarRespaldo,
  normalizarTexto, TABLAS_ALIAS, VALIDADORES, BUSCADORES,
};
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `cd backend && node --test migracion.test.js`
Expected: PASS (28 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/migracion.js backend/migracion.test.js
git commit -m "feat: exportarRespaldo de articulos/clientes/proveedores con ciclo exportar-importar"
```

---

### Task 7: Rutas en `server.js`

**Files:**
- Modify: `backend/server.js`

**Interfaces:**
- Consumes: `parsearExcel`, `previsualizarImportacion`, `aplicarImportacion`, `exportarRespaldo` (Tasks 2-6); `requiereLogin`, `requierePermiso`, `alcanceSucursal` (ya existentes en `auth.js`).
- Produces: `POST /api/migracion/previsualizar`, `POST /api/migracion/aplicar`, `GET /api/migracion/exportar`.

**Nota sobre pruebas de esta tarea:** no hay precedente en el proyecto de tests HTTP de integración (`permisoTraspasos.test.js` / `permisoRecibirCompra.test.js` solo verifican el catálogo de permisos, no levantan servidor). Esa cobertura ya se hizo en Task 1 (`permisoMigrarDatos.test.js`). No se crea ningún archivo de test nuevo en esta tarea — la verificación de que las rutas exigen el permiso `migrar_datos` de verdad se hace manualmente en Task 10 (verificación en navegador).

- [ ] **Step 1: Subir el límite de `express.json` y agregar los requires**

En `backend/server.js`, cerca del inicio (después del require de `importarClavesSat`):

```js
const { contarClavesSat, necesitaImportarClavesSat } = require("./clavesSat");
const { importarClavesSat } = require("./scripts/importarClavesSat");
const { parsearExcel, previsualizarImportacion, aplicarImportacion, exportarRespaldo } = require("./migracion");
```

Y cambiar la línea `app.use(express.json());` por:

```js
// Límite subido de 100kb (default) a 15mb: el catálogo completo de un
// respaldo/importación viaja como Excel en base64 dentro del body JSON,
// igual filosofía que ya usa el importador de factura XML CFDI.
app.use(express.json({ limit: "15mb" }));
```

- [ ] **Step 2: Agregar las 3 rutas**

Agregar después del bloque de rutas de `/api/compras` (después de la ruta `/api/compras/importar-xml`):

```js
app.post("/api/migracion/previsualizar", requiereLogin, requierePermiso("migrar_datos", resolverPermisosDeRol), (req, res) => {
  try {
    const { tipo, archivo_base64 } = req.body;
    const { filas, columnas_reconocidas, columnas_no_reconocidas } = parsearExcel(archivo_base64, tipo);
    const previsualizacion = previsualizarImportacion(DB, tipo, filas);
    res.json({ ...previsualizacion, columnas_reconocidas, columnas_no_reconocidas });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/api/migracion/aplicar", requiereLogin, requierePermiso("migrar_datos", resolverPermisosDeRol), (req, res) => {
  try {
    const { tipo, filas, defaults, nombre_archivo } = req.body;
    const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
    let sucursal_id = null;
    if (tipo === "articulos" || tipo === "clientes") {
      sucursal_id = alcance.verTodas ? (Number(req.body.sucursal_id) || null) : alcance.sucursalId;
      if (!sucursal_id) return res.status(400).json({ error: "Selecciona la sucursal de origen del archivo" });
    }
    const resumen = aplicarImportacion(DB, tipo, filas, sucursal_id, defaults, nombre_archivo);
    res.json(resumen);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get("/api/migracion/exportar", requiereLogin, requierePermiso("migrar_datos", resolverPermisosDeRol), (req, res) => {
  try {
    const { tipo } = req.query;
    const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
    let sucursal_id = null;
    if (tipo === "articulos" || tipo === "clientes") {
      sucursal_id = alcance.verTodas ? (Number(req.query.sucursal_id) || null) : alcance.sucursalId;
      if (!sucursal_id) return res.status(400).json({ error: "Selecciona la sucursal a exportar" });
    }
    const base64 = exportarRespaldo(DB, tipo, sucursal_id);
    res.setHeader("Content-Disposition", `attachment; filename="respaldo-${tipo}.xlsx"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.send(Buffer.from(base64, "base64"));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
```

- [ ] **Step 3: Verificar que el backend arranca y los tests existentes siguen pasando**

Run: `cd backend && node --test`
Expected: PASS (todos los tests, incluidos los ~28 nuevos de `migracion.test.js` y los 2 de `permisoMigrarDatos.test.js`).

Run: `cd backend && node server.js` (y detenerlo tras confirmar, con Ctrl+C o matando el proceso)
Expected: arranca sin errores, línea `✓ Sistema de permisos validado: ...` se imprime.

- [ ] **Step 4: Commit**

```bash
git add backend/server.js
git commit -m "feat: rutas de migracion de datos (previsualizar/aplicar/exportar) y limite de body a 15mb"
```

---

### Task 8: Frontend — `src/MigracionDatos.jsx`

**Files:**
- Create: `src/MigracionDatos.jsx`

**Interfaces:**
- Consumes: `apiFetch` de `./api` (mismo patrón que `RecepcionCompras.jsx`); endpoints de Task 7.
- Produces: componente `MigracionDatos({ onVolver, permisos, usuario })`, usado en Task 9.

- [ ] **Step 1: Crear la pantalla**

```jsx
import React, { useState, useEffect, useRef } from "react";
import { FileSpreadsheet, Download, Upload, ChevronLeft } from "lucide-react";
import { apiFetch } from "./api";

const inputCls = "w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:border-blue-500";
const TIPOS = [
  { id: "articulos", etiqueta: "Artículos", pideSucursal: true },
  { id: "clientes", etiqueta: "Clientes", pideSucursal: true },
  { id: "proveedores", etiqueta: "Proveedores", pideSucursal: false },
];

function leerArchivoComoBase64(archivo) {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(String(lector.result).split(",")[1]);
    lector.onerror = reject;
    lector.readAsDataURL(archivo);
  });
}

export default function MigracionDatos({ onVolver, permisos, usuario }) {
  const [tab, setTab] = useState("articulos");
  const [sucursales, setSucursales] = useState([]);
  const [sucursalId, setSucursalId] = useState("");
  const [previsualizacion, setPrevisualizacion] = useState(null);
  const [confirmados, setConfirmados] = useState({});
  const [defaults, setDefaults] = useState({ categoria: "", departamento: "", unidad: "" });
  const [resumen, setResumen] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [aviso, setAviso] = useState(null);
  const nombreArchivoRef = useRef("");
  const inputArchivoRef = useRef(null);

  const tipoActual = TIPOS.find((t) => t.id === tab);
  const mostrarAviso = (t) => { setAviso(t); setTimeout(() => setAviso(null), 3000); };

  useEffect(() => { apiFetch("/sucursales").then((r) => r.json()).then(setSucursales).catch(() => {}); }, []);
  useEffect(() => { setPrevisualizacion(null); setConfirmados({}); setResumen(null); setSucursalId(""); }, [tab]);

  const necesitaSucursal = tipoActual.pideSucursal && (!usuario?.ver_todas || true) && usuario?.ver_todas;

  const subirArchivo = async (archivo) => {
    if (tipoActual.pideSucursal && usuario?.ver_todas && !sucursalId) {
      return mostrarAviso("Selecciona la sucursal de origen del archivo primero");
    }
    setCargando(true);
    nombreArchivoRef.current = archivo.name;
    try {
      const archivo_base64 = await leerArchivoComoBase64(archivo);
      const r = await apiFetch("/migracion/previsualizar", { method: "POST", body: JSON.stringify({ tipo: tab, archivo_base64 }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setPrevisualizacion(data);
      const confirmadosIniciales = {};
      data.filas.forEach((f) => { if (f.valida) confirmadosIniciales[f.numero_fila] = true; });
      setConfirmados(confirmadosIniciales);
      setResumen(null);
    } catch (e) { mostrarAviso("❌ " + e.message); }
    finally { setCargando(false); if (inputArchivoRef.current) inputArchivoRef.current.value = ""; }
  };

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

  const exportarRespaldo = async () => {
    if (tipoActual.pideSucursal && usuario?.ver_todas && !sucursalId) {
      return mostrarAviso("Selecciona la sucursal a exportar primero");
    }
    const params = new URLSearchParams({ tipo: tab });
    if (sucursalId) params.set("sucursal_id", sucursalId);
    const r = await apiFetch(`/migracion/exportar?${params.toString()}`);
    if (!r.ok) { const data = await r.json().catch(() => ({})); return mostrarAviso("❌ " + (data.error || "No se pudo exportar")); }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `respaldo-${tab}.xlsx`; a.click();
    URL.revokeObjectURL(url);
  };

  const hayAltasSinDefaults = previsualizacion?.filas.some(
    (f) => f.valida && confirmados[f.numero_fila] && f.accion === "alta" && tab === "articulos" && (!f.datos.categoria || !f.datos.departamento || !f.datos.unidad)
  );

  return (
    <div className="w-full h-full flex flex-col bg-slate-50 text-slate-800 font-sans text-sm">
      <div className="bg-white border-b border-slate-100 flex items-center px-2">
        {TIPOS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`px-4 py-2.5 text-xs font-medium border-b-2 ${tab === t.id ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500"}`}>
            <FileSpreadsheet size={14} className="inline mr-1.5 -mt-0.5" /> {t.etiqueta}
          </button>
        ))}
      </div>

      <div className="p-4 flex flex-col gap-3 flex-1 overflow-y-auto">
        {tipoActual.pideSucursal && usuario?.ver_todas && (
          <div className="max-w-xs">
            <label className="text-xs text-slate-500 block mb-1">Sucursal de origen del archivo</label>
            <select className={inputCls} value={sucursalId} onChange={(e) => setSucursalId(e.target.value)}>
              <option value="">Selecciona...</option>
              {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>
        )}

        <div className="flex gap-2 items-center">
          <input ref={inputArchivoRef} type="file" accept=".xls,.xlsx" disabled={cargando}
            onChange={(e) => e.target.files[0] && subirArchivo(e.target.files[0])} />
          <button onClick={exportarRespaldo} className="ml-auto flex items-center gap-1.5 border border-slate-300 rounded px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50">
            <Download size={14} /> Exportar respaldo
          </button>
        </div>

        {cargando && <p className="text-slate-400 text-center py-4">Procesando...</p>}

        {previsualizacion && (
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex gap-4 text-xs text-slate-600 mb-2">
              <span>Total: {previsualizacion.resumen.total}</span>
              <span className="text-emerald-600">Altas: {previsualizacion.resumen.altas}</span>
              <span className="text-blue-600">Actualizaciones: {previsualizacion.resumen.actualizaciones}</span>
              <span className="text-red-600">Inválidas: {previsualizacion.resumen.invalidas}</span>
            </div>
            <div className="flex-1 overflow-y-auto border border-slate-200 rounded">
              <table className="w-full text-xs">
                <thead className="bg-[#1a7fe8] text-white sticky top-0">
                  <tr>
                    <th className="py-2 px-2 text-left">Fila</th>
                    <th className="py-2 px-2 text-left">Clave/RFC</th>
                    <th className="py-2 px-2 text-left">Nombre</th>
                    <th className="py-2 px-2 text-center">Acción</th>
                    <th className="py-2 px-2 text-center">Confirmar</th>
                  </tr>
                </thead>
                <tbody>
                  {previsualizacion.filas.map((f) => (
                    <tr key={f.numero_fila} className="border-b border-slate-100">
                      <td className="py-1.5 px-2">{f.numero_fila}</td>
                      <td className="py-1.5 px-2">{f.datos.clave || f.datos.rfc}</td>
                      <td className="py-1.5 px-2">{f.datos.descripcion || f.datos.nombre}</td>
                      <td className="py-1.5 px-2 text-center">
                        {!f.valida
                          ? <span className="text-red-600" title={f.errores.join("; ")}>Inválida</span>
                          : f.accion === "alta" ? <span className="text-emerald-600">Alta nueva</span> : <span className="text-blue-600">Actualización</span>}
                      </td>
                      <td className="py-1.5 px-2 text-center">
                        <input type="checkbox" disabled={!f.valida} checked={!!confirmados[f.numero_fila]}
                          onChange={(e) => setConfirmados((prev) => ({ ...prev, [f.numero_fila]: e.target.checked }))} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {hayAltasSinDefaults && tab === "articulos" && (
              <div className="mt-3 grid grid-cols-3 gap-2 bg-white border border-slate-200 rounded p-3">
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Categoría por defecto</label>
                  <input className={inputCls} value={defaults.categoria} onChange={(e) => setDefaults((d) => ({ ...d, categoria: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Departamento por defecto</label>
                  <input className={inputCls} value={defaults.departamento} onChange={(e) => setDefaults((d) => ({ ...d, departamento: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Unidad por defecto</label>
                  <input className={inputCls} value={defaults.unidad} onChange={(e) => setDefaults((d) => ({ ...d, unidad: e.target.value }))} />
                </div>
              </div>
            )}

            <button onClick={aplicar} className="mt-3 bg-blue-700 hover:bg-blue-800 text-white py-2 rounded font-semibold flex items-center justify-center gap-2">
              <Upload size={15} /> Aplicar importación
            </button>
          </div>
        )}

        {resumen && (
          <div className="bg-white border border-slate-200 rounded p-3 text-sm">
            <p><b>{resumen.nuevos}</b> nuevos, <b>{resumen.actualizados}</b> actualizados, <b>{resumen.errores.length}</b> con error.</p>
            {resumen.errores.length > 0 && (
              <table className="w-full text-xs mt-2">
                <thead><tr className="text-left text-slate-500"><th>Fila</th><th>Clave</th><th>Motivo</th></tr></thead>
                <tbody>
                  {resumen.errores.map((e, i) => (
                    <tr key={i} className="border-t border-slate-100"><td>{e.numero_fila}</td><td>{e.clave}</td><td>{e.motivo}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {aviso && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-sm px-4 py-2 rounded-full shadow-lg z-[60]">{aviso}</div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verificar que el frontend compila**

Run: `npm run build`
Expected: build limpio, sin errores de sintaxis ni de imports.

- [ ] **Step 3: Commit**

```bash
git add src/MigracionDatos.jsx
git commit -m "feat: pantalla Migracion de Datos (previsualizacion, confirmacion por renglon, exportar respaldo)"
```

---

### Task 9: Cableado en Dashboard, EncabezadoModulo y App

**Files:**
- Modify: `src/Dashboard.jsx`
- Modify: `src/EncabezadoModulo.jsx`
- Modify: `src/App.jsx`

**Interfaces:**
- Consumes: `MigracionDatos` (Task 8).

- [ ] **Step 1: Agregar el tile en el Dashboard**

En `src/Dashboard.jsx`, agregar el ícono al import:

```jsx
import { ShoppingCart, Users, Boxes, Lock, ShieldCheck, LogOut, Landmark, Store, ArrowRightLeft, Truck, FileSpreadsheet } from "lucide-react";
```

Y agregar la entrada al array `MODULOS`, después de `compras`:

```js
  { id: "compras",    nombre: "Recepción de Compras",   icono: Truck,          disponible: true, modulo: "inventario", permiso: "recibir_compra" },
  { id: "migracion",  nombre: "Migración de Datos",     icono: FileSpreadsheet, disponible: true, modulo: "inventario", permiso: "migrar_datos" },
```

- [ ] **Step 2: Agregar el título en EncabezadoModulo**

En `src/EncabezadoModulo.jsx`, agregar al objeto `TITULOS`:

```js
const TITULOS = {
  pos:        "Punto de Venta",
  inventario: "Inventario y Productos",
  traspasos:  "Traspasos entre Sucursales",
  compras:    "Recepción de Compras",
  migracion:  "Migración de Datos",
  roles:      "Roles y Personal",
  crm:        "CRM",
  corte:      "Corte de Caja",
  ml:         "MercadoLibre",
};
```

- [ ] **Step 3: Cablear la vista en App.jsx**

En `src/App.jsx`, agregar el import:

```jsx
import MigracionDatos from "./MigracionDatos.jsx";
```

Agregar `"migracion"` al array `MODULOS`:

```js
const MODULOS = ["pos", "inventario", "roles", "crm", "corte", "ml", "traspasos", "compras", "migracion"];
```

Y agregar la rama de render, después de la de `compras`:

```jsx
        {vista === "compras" && (
          <RecepcionCompras onVolver={() => setVista("dashboard")} permisos={usuario.permisos} usuario={usuario} />
        )}
        {vista === "migracion" && (
          <MigracionDatos onVolver={() => setVista("dashboard")} permisos={usuario.permisos} usuario={usuario} />
        )}
```

- [ ] **Step 4: Verificar que el frontend compila**

Run: `npm run build`
Expected: build limpio.

- [ ] **Step 5: Commit**

```bash
git add src/Dashboard.jsx src/EncabezadoModulo.jsx src/App.jsx
git commit -m "feat: cablear Migracion de Datos en Dashboard, encabezado y App"
```

---

### Task 10: Verificación manual en navegador (smoke test end-to-end)

**Files:** ninguno (solo verificación).

**Interfaces:** ninguna nueva — ejercita todo lo construido en Tasks 1-9.

**Nota:** este task requiere una sesión con capacidad de manejar un navegador real (ver cómo se hizo la verificación del importador XML de facturas en la sesión anterior: Playwright con Chrome del sistema). Si quien ejecuta este plan no tiene esa capacidad, dejarlo marcado como pendiente y decírselo explícitamente a Victor — no dar el módulo por probado sin haberlo visto funcionar.

- [ ] **Step 1: Levantar backend y frontend**

Run: `cd backend && node server.js` (en segundo plano)
Run: `npm run dev` (en segundo plano)

- [ ] **Step 2: Armar un Excel de prueba de Artículos**

Con un script Node ad-hoc (usando `xlsx`), generar un archivo con 2-3 filas: una que coincida con la clave de un producto ya sembrado (`AB-001`) y otra con una clave nueva, para ejercitar tanto "actualización" como "alta nueva".

- [ ] **Step 3: Iniciar sesión como Administrador, entrar a Migración de Datos**

Confirmar que el tile aparece en el Dashboard bajo el permiso `migrar_datos`, y que un rol sin ese permiso NO lo ve (crear temporalmente un usuario con un rol limitado para esta prueba, o quitarle el permiso al Administrador de prueba y confirmar que el tile desaparece y la ruta responde 403).

- [ ] **Step 4: Subir el archivo, confirmar renglones, aplicar**

Verificar visualmente: la previsualización muestra alta/actualización correctamente, el checkbox de confirmación funciona, el resumen final muestra los conteos correctos, y los datos realmente cambiaron (ej. `GET /api/productos`).

- [ ] **Step 5: Probar "Exportar respaldo" y reimportarlo**

Descargar el respaldo, subirlo de nuevo en la misma pantalla, y confirmar que todo sale como "Actualización" (no duplica nada).

- [ ] **Step 6: Limpiar cualquier dato de prueba**

Igual que se hizo en la sesión anterior tras probar el importador XML: si la prueba deja productos/clientes/proveedores sintéticos en el `datos.sqlite` local de Victor, revertirlos (o usar `DB_PATH` apuntando a un archivo temporal para toda esta verificación, evitando ensuciar los datos reales desde el principio — más simple y más seguro).

- [ ] **Step 7: Reportar a Victor**

Confirmar explícitamente qué se probó y qué no (por ejemplo, si no se probó con un archivo real de SICAR, decirlo — ver "Riesgo abierto" del spec).

---

## Self-Review (hecho al escribir este plan)

**Cobertura del spec:** Objetivo/alcance → Tasks 1-9. Matching por clave/RFC → Tasks 3-5. Sucursal obligatoria para Artículos/Clientes → Tasks 4, 5, 7, 8. Confirmación explícita por renglón → Task 8. Alias tolerantes → Task 2. Aplicación fila-por-fila sin mutar hasta validar → Tasks 4-6. Permiso `migrar_datos` dentro de "inventario" → Task 1. Exportación de respaldo releíble → Task 6. Pruebas → todas las tasks de backend. Riesgo abierto de columnas → documentado en el header del módulo (Task 2) y repetido en Task 10.

**Placeholders:** ninguno — todo el código de cada step está completo y es el real a escribir.

**Consistencia de tipos:** `parsearExcel(archivoBase64, tipo)` → Task 2, usado igual en Tasks 3, 6, 7, 9. `previsualizarImportacion(DB, tipo, filas)` → Task 3, usado igual en Task 7. `aplicarImportacion(DB, tipo, filasConfirmadas, sucursal_id, defaults, nombreArchivo)` → Task 4, mismo orden de argumentos en Tasks 5, 6 (no, Task 6 no lo usa), 7. `exportarRespaldo(DB, tipo, sucursal_id)` → Task 6, usado igual en Task 7. Nombres de campo (`clave`, `descripcion`, `costo`, `existencia`, `precio1..4`, `rfc`, `nombre`, `contacto`, `limite_credito`, `dias_credito`) consistentes entre `TABLAS_ALIAS` (Task 2), validadores/buscadores (Task 3), aplicadores (Tasks 4-5) y exportadores (Task 6).
