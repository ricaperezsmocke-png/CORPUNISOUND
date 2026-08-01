# Fecha local de la tienda + compresión del comprobante — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que las fechas del sistema correspondan al día real de la tienda en Chiapas (hoy, todo lo capturado después de las 6:00 pm queda con la fecha del día siguiente), y que la foto del comprobante se comprima en el navegador antes de subirse, sin perder legibilidad.

**Architecture:** Un helper nuevo por lado (`backend/fechas.js` y `src/fechas.js`) que convierte un instante a la fecha local de `America/Mexico_City` usando `Intl.DateTimeFormat` con locale `en-CA` (que produce `YYYY-MM-DD` directo). Todos los sitios que hoy hacen `new Date().toISOString().slice(0, 10)` pasan a usarlo. **Las marcas de tiempo completas (`fecha_hora` y demás ISO) NO se tocan**: siguen en UTC porque son instantes y toda la lógica de turnos del corte los compara entre sí. Aparte, un helper de frontend que reescala y recomprime la imagen con canvas antes de mandarla.

**Tech Stack:** Node.js + Express, `node --test`, React 18 + Vite. **Sin dependencias nuevas** — `Intl` y `canvas` son del runtime.

## Global Constraints

- **Sin dependencias nuevas** (ni backend ni frontend).
- **Zona horaria: `America/Mexico_City`.** No usar un desfase fijo de −6 escrito a mano: México eliminó el horario de verano en 2022, pero si eso vuelve a cambiar la zona IANA se ajusta sola y un `-6` no. Verificado que el runtime la soporta: `Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", ... }).format(new Date("2026-08-01T02:00:00Z"))` devuelve `"2026-07-31"`.
- **Solo cambian los campos de FECHA SOLA** (`YYYY-MM-DD`). Las marcas de tiempo completas (`fecha_hora`, `fecha` de compras/movimientos/bitácoras, `conectado_en`, `sincronizado`) **siguen siendo ISO en UTC**. Motivo: son instantes y son correctos; además `gastosEfectivoDelTurnoLista` y `ventasDelTurno` comparan `fecha_hora > desde` contra la marca del último corte, y mezclar marcos rompería el corte de caja.
- **Donde un reporte deriva una fecha de una marca de tiempo**, debe convertir el instante a fecha local, no recortar el texto con `.slice(0, 10)`.
- **Los datos ya guardados NO se migran** (decisión de Victor). De aquí en adelante las fechas quedan bien; lo ya registrado conserva su fecha corrida. No se reescribe historial de ventas ni de cortes.
- **Compresión: lado largo máximo 1600 px, calidad JPEG 0.8** (decisión de Victor: "balanceada"). Los **PDF no se tocan**. Nunca se agranda una imagen que ya sea más chica que el límite, y si el resultado pesara más que el original se conserva el original.
- **Orientación EXIF:** las fotos de celular traen rotación en EXIF. Hay que decodificar con `createImageBitmap(archivo, { imageOrientation: "from-image" })` o el comprobante puede terminar acostado.
- La suite del backend queda en verde. Estado al empezar: **452 pruebas pasando, 0 fallando.**
- Frontend sin arnés de pruebas (convención del repo): se verifica con `npm run build` desde la raíz y a mano en navegador.
- Código, comentarios y textos de interfaz **en español**.
- Comandos del backend desde `backend/`; `npm run build` desde la raíz.

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `backend/fechas.js` (crear) | `fechaLocal(instante?)` y `ahora()`. Única fuente de verdad de "qué día es en la tienda". |
| `backend/fechas.test.js` (crear) | Pruebas del helper, incluida la frontera de las 6:00 pm. |
| `backend/ventas.js`, `cortes.js`, `apartados.js`, `clientes.js`, `crm.js`, `garantias.js`, `gastos.js`, `mercadolibre.js`, `server.js` (modificar) | Usar `fechaLocal()` donde hoy calculan una fecha sola. |
| `backend/reportes.js` (modificar) | Derivar la fecha de una marca de tiempo con `fechaLocal(...)` en vez de `.slice(0, 10)`. |
| `src/fechas.js` (crear) | `hoyLocal()` y `haceDiasLocal(n)` para los filtros de las pantallas. |
| Los 10 archivos de `src/` con helpers de fecha (modificar) | Usar los helpers compartidos. |
| `src/comprimirImagen.js` (crear) | Reescalar y recomprimir la foto antes de subirla. |
| `src/Gastos.jsx` (modificar) | Comprimir al elegir el archivo y mostrar el peso resultante. |

---

### Task 1: El helper de fecha local y su uso en el backend

**Files:**
- Create: `backend/fechas.js`
- Create: `backend/fechas.test.js`
- Modify: `backend/ventas.js:48`, `backend/cortes.js:134`, `backend/apartados.js:26` y `:105`, `backend/clientes.js:53`, `backend/crm.js:12`, `backend/garantias.js:56` y `:83`, `backend/gastos.js:130`, `backend/mercadolibre.js:282,285,291,301`, `backend/server.js:315`

**Interfaces:**
- Produces (exportadas de `backend/fechas.js`): `fechaLocal(instante?)` → `"YYYY-MM-DD"` en hora de la tienda (acepta `Date`, string ISO, o nada = ahora); `ahora()` → string ISO en UTC; constante `ZONA_TIENDA`.

- [ ] **Step 1: Escribir las pruebas**

Crear `backend/fechas.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { fechaLocal, ahora, ZONA_TIENDA } = require("./fechas");

test("la zona de la tienda es la de México, no un desfase escrito a mano", () => {
  assert.strictEqual(ZONA_TIENDA, "America/Mexico_City");
});

test("fechaLocal: un instante de la NOCHE pertenece al día que la tienda vivió", () => {
  // Chiapas es UTC-6. Las 8 de la noche del 31 de julio son las 02:00 UTC del
  // 1 de agosto. Antes de este arreglo, el sistema guardaba "2026-08-01" y el
  // gasto se contaba en el mes equivocado.
  assert.strictEqual(fechaLocal("2026-08-01T02:00:00.000Z"), "2026-07-31");
  assert.strictEqual(fechaLocal("2026-08-01T05:59:00.000Z"), "2026-07-31");
});

test("fechaLocal: la frontera real del día son las 06:00 UTC", () => {
  assert.strictEqual(fechaLocal("2026-08-01T05:59:59.000Z"), "2026-07-31");
  assert.strictEqual(fechaLocal("2026-08-01T06:00:00.000Z"), "2026-08-01");
});

test("fechaLocal: un instante de la mañana no se mueve", () => {
  assert.strictEqual(fechaLocal("2026-07-31T15:00:00.000Z"), "2026-07-31");
});

test("fechaLocal: acepta Date, string ISO, y sin argumento devuelve hoy", () => {
  assert.strictEqual(fechaLocal(new Date("2026-08-01T02:00:00.000Z")), "2026-07-31");
  assert.match(fechaLocal(), /^\d{4}-\d{2}-\d{2}$/);
});

test("fechaLocal: siempre devuelve el formato YYYY-MM-DD, con ceros a la izquierda", () => {
  assert.strictEqual(fechaLocal("2026-03-05T18:00:00.000Z"), "2026-03-05");
  assert.strictEqual(fechaLocal("2026-01-01T06:00:00.000Z"), "2026-01-01");
});

test("las fechas locales se pueden ordenar y comparar como texto", () => {
  // De esto dependen todos los filtros de rango de los reportes (enRango).
  assert.ok(fechaLocal("2026-07-31T18:00:00.000Z") < fechaLocal("2026-08-02T18:00:00.000Z"));
});

test("ahora() sigue devolviendo un instante ISO en UTC", () => {
  // Las marcas de tiempo NO se localizan: la lógica de turnos del corte las
  // compara entre sí y mezclar marcos la rompería.
  const t = ahora();
  assert.match(t, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});
```

- [ ] **Step 2: Correr para verificar que fallan**

```bash
cd backend && node --test fechas.test.js
```

Expected: FAIL — `Cannot find module './fechas'`.

- [ ] **Step 3: Crear `backend/fechas.js`**

```js
/**
 * fechas.js — Única fuente de verdad de "qué día es en la tienda".
 *
 * El sistema corre en Render, cuyo reloj está en UTC, pero las tiendas están
 * en Chiapas (UTC-6). Calcular la fecha con `new Date().toISOString()` hacía
 * que TODO lo capturado a partir de las 6:00 pm quedara con la fecha del día
 * siguiente: un gasto del 31 de julio a las 8 de la noche se contaba en
 * agosto. Como la regla de operación es capturar los gastos al cerrar el
 * corte —de noche—, eso afectaba a la mayoría de los registros.
 *
 * Se usa la zona IANA y no un "-6" escrito a mano: México quitó el horario de
 * verano en 2022, pero si eso vuelve a cambiar la zona se ajusta sola.
 *
 * OJO: aquí solo se resuelven las fechas SOLAS (YYYY-MM-DD). Las marcas de
 * tiempo completas siguen en UTC a propósito — son instantes, son correctas, y
 * el corte de caja compara `fecha_hora > desde` entre ellas.
 */

const ZONA_TIENDA = "America/Mexico_City";

// "en-CA" produce YYYY-MM-DD directo, que es justo el formato que el sistema
// guarda y compara como texto.
const formateador = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONA_TIENDA,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Fecha del día en la tienda, en formato YYYY-MM-DD.
 *  Acepta un Date, un string ISO, o nada (= ahora). */
function fechaLocal(instante) {
  const d = instante ? new Date(instante) : new Date();
  return formateador.format(d);
}

/** Marca de tiempo completa, en UTC. Se mantiene tal cual a propósito. */
function ahora() {
  return new Date().toISOString();
}

module.exports = { fechaLocal, ahora, ZONA_TIENDA };
```

- [ ] **Step 4: Correr las pruebas del helper**

```bash
cd backend && node --test fechas.test.js
```

Expected: PASS — 8 pruebas en verde.

- [ ] **Step 5: Usarlo en los módulos que crean una fecha sola**

En cada archivo, agregar el `require` (`const { fechaLocal } = require("./fechas");`) y hacer el reemplazo. **Solo estos sitios** — no toques ningún `fecha_hora` ni ninguna otra marca de tiempo:

| Archivo | Antes | Después |
|---|---|---|
| `backend/ventas.js:48` | `fecha: new Date().toISOString().slice(0, 10),` | `fecha: fechaLocal(),` |
| `backend/cortes.js:134` | `fecha: new Date().toISOString().slice(0, 10),` | `fecha: fechaLocal(),` |
| `backend/apartados.js:26` (cuerpo de `hoy()`) | `return new Date().toISOString().slice(0, 10);` | `return fechaLocal();` |
| `backend/apartados.js:105` | `fecha_limite: fechaLimiteObj.toISOString().slice(0, 10),` | `fecha_limite: fechaLocal(fechaLimiteObj),` |
| `backend/clientes.js:53` | `fecha_alta: new Date().toISOString().slice(0, 10),` | `fecha_alta: fechaLocal(),` |
| `backend/crm.js:12` (cuerpo de la función) | `return new Date().toISOString().slice(0, 10);` | `return fechaLocal();` |
| `backend/garantias.js:56` (cuerpo de `hoy()`) | `return new Date().toISOString().slice(0, 10);` | `return fechaLocal();` |
| `backend/garantias.js:83` | `garantia.fecha_ultimo_movimiento = fecha.slice(0, 10);` | `garantia.fecha_ultimo_movimiento = fechaLocal(fecha);` |
| `backend/gastos.js:130` | `fecha: ahora.slice(0, 10),` | `fecha: fechaLocal(ahora),` |
| `backend/mercadolibre.js:282` | `fecha_alta: new Date().toISOString().slice(0, 10),` | `fecha_alta: fechaLocal(),` |
| `backend/mercadolibre.js:285` y `:291` | `... \|\| new Date().toISOString().slice(0, 10)` | `... \|\| fechaLocal()` |
| `backend/mercadolibre.js:301` | `... \|\| new Date().toISOString().slice(0, 10),` | `... \|\| fechaLocal(),` |
| `backend/server.js:315` | `const fechaISO = hoy.toISOString().slice(0, 10);` | `const fechaISO = fechaLocal(hoy);` |

**Cuidado en `backend/gastos.js`:** ese archivo ya tiene una variable local llamada `ahora` (el string ISO). No la renombres ni la quites — solo cambia cómo se deriva `fecha` de ella. Y **no** importes el `ahora()` de `fechas.js` ahí, para no chocar con la variable local.

**Cuidado en `backend/server.js:316`:** la línea siguiente calcula `diaSemana` con `hoy.toLocaleDateString("es-MX", { weekday: "long" })`. Agrégale la zona para que el día de la semana concuerde con la fecha: `hoy.toLocaleDateString("es-MX", { weekday: "long", timeZone: "America/Mexico_City" })`.

- [ ] **Step 6: Correr toda la suite**

```bash
cd backend && node --test
```

Expected: PASS. 452 previas + 8 nuevas = **460 en verde, 0 fallando**.

Si alguna prueba existente falla, léela antes de "arreglarla": puede estar afirmando la fecha vieja (corrida) como si fuera la correcta. En ese caso lo que hay que corregir es la aserción, no el código — pero documenta cuál y por qué en tu reporte.

- [ ] **Step 7: Verificar que el servidor arranca**

```bash
cd backend && node -e "require('./server'); console.log('SERVER OK'); process.exit(0)"
```

Expected: `SERVER OK`.

- [ ] **Step 8: Commit**

```bash
git add backend/fechas.js backend/fechas.test.js backend/ventas.js backend/cortes.js backend/apartados.js backend/clientes.js backend/crm.js backend/garantias.js backend/gastos.js backend/mercadolibre.js backend/server.js
git commit -m "fix: las fechas del sistema son las del día real de la tienda, no las de UTC"
```

---

### Task 2: Fechas derivadas de marcas de tiempo en los reportes

**Files:**
- Modify: `backend/reportes.js` (líneas 165, 177, 379, 401)
- Modify: `backend/reportes.test.js` o el archivo de pruebas correspondiente, si alguna aserción depende de la fecha vieja

**Interfaces:**
- Consumes: `fechaLocal(instante)` de `backend/fechas.js` (Task 1).

- [ ] **Step 1: Escribir la prueba que lo fija**

Agregar al final de `backend/reporteGastos.test.js`:

```js
const { fechaLocal } = require("./fechas");

test("los reportes que derivan la fecha de una marca de tiempo usan el día de la tienda", async () => {
  const DB = await escenario();
  // Un gasto capturado a las 8 de la noche del 31 de julio (02:00 UTC del 1
  // de agosto): debe reportarse el 31, no el 1.
  DB.gastos.gastos[0].fecha_hora = "2026-08-01T02:00:00.000Z";
  DB.gastos.gastos[0].fecha = fechaLocal("2026-08-01T02:00:00.000Z");

  const r = reporteGastos(DB, { fecha_inicio: "2026-07-31", fecha_fin: "2026-07-31" }, ALCANCE_TODAS);
  assert.strictEqual(r.general.length, 1, "el gasto de la noche del 31 cae en el 31");
  assert.strictEqual(r.general[0].fecha, "2026-07-31");
});
```

Y agregar al final de `backend/reportes.test.js`:

```js
const { reporteCompras } = require("./reportes");
const { fechaLocal } = require("./fechas");

test("reporteCompras: una recepción de la noche cae en el día que la tienda vivió", () => {
  const DB = construirDBPrueba();
  DB.inventario.compras.push({
    id: 1, sucursal_id: 1, proveedor_id: null, factura: "F-1",
    fecha: "2026-08-01T02:00:00.000Z", // 8 pm del 31 de julio en Chiapas
  });
  DB.inventario.compra_detalle.push({ id: 1, compra_id: 1, producto_id: 1, cantidad: 1, costo: 100 });

  const r = reporteCompras(DB, { fecha_inicio: "2026-07-31", fecha_fin: "2026-07-31" }, ALCANCE_TODAS);

  assert.strictEqual(r.general.length, 1, "debe caer en el 31, no en el 1 de agosto");
  assert.strictEqual(r.general[0].fecha, "2026-07-31");
});
```

- [ ] **Step 2: Correr para verificar que fallan**

```bash
cd backend && node --test reporteGastos.test.js reportes.test.js
```

Expected: FAIL — las dos pruebas nuevas fallan porque el recorte de texto todavía devuelve `2026-08-01`.

- [ ] **Step 3: Reemplazar los recortes por conversión a fecha local**

En `backend/reportes.js`, agregar el `require` arriba (`const { fechaLocal } = require("./fechas");`) y cambiar estas cuatro líneas:

| Línea | Antes | Después |
|---|---|---|
| 165 | `.filter((c) => enRango(c.fecha.slice(0, 10), fecha_inicio, fecha_fin));` | `.filter((c) => enRango(fechaLocal(c.fecha), fecha_inicio, fecha_fin));` |
| 177 | `id: c.id, fecha: c.fecha.slice(0, 10), proveedor_nombre: ...` | `id: c.id, fecha: fechaLocal(c.fecha), proveedor_nombre: ...` |
| 379 | `.filter((x) => enRango(String(x.fecha).slice(0, 10), fecha_inicio, fecha_fin));` | `.filter((x) => enRango(fechaLocal(x.fecha), fecha_inicio, fecha_fin));` |
| 401 | `fecha: String(x.fecha).slice(0, 10),` | `fecha: fechaLocal(x.fecha),` |

- [ ] **Step 4: Correr las pruebas y toda la suite**

```bash
cd backend && node --test
```

Expected: PASS, **462 en verde** (460 + 2).

- [ ] **Step 5: Commit**

```bash
git add backend/reportes.js backend/reportes.test.js backend/reporteGastos.test.js
git commit -m "fix: los reportes derivan la fecha del día de la tienda, no del texto UTC"
```

---

### Task 3: Los filtros de las pantallas usan la fecha de la tienda

**Files:**
- Create: `src/fechas.js`
- Modify: `src/Gastos.jsx`, `src/ConsultasVentas.jsx`, `src/PrediccionesDemanda.jsx`, `src/reportes/ReporteCompras.jsx`, `src/reportes/ReporteCortesCaja.jsx`, `src/reportes/ReporteGastos.jsx`, `src/reportes/ReporteGastosGarantias.jsx`, `src/reportes/ReporteMovimientosCaja.jsx`, `src/reportes/ReporteUtilidad.jsx`, `src/reportes/ReporteVentas.jsx`

**Interfaces:**
- Produces (exportadas de `src/fechas.js`): `hoyLocal()` → `"YYYY-MM-DD"`; `haceDiasLocal(n)` → `"YYYY-MM-DD"` de hace `n` días.

- [ ] **Step 1: Crear `src/fechas.js`**

```js
/**
 * fechas.js — La fecha del día en la tienda (Chiapas), para los filtros de
 * las pantallas.
 *
 * Sin esto, los filtros usaban `new Date().toISOString()`, que da la fecha en
 * UTC: después de las 6:00 pm hora local, "hoy" ya era mañana. El backend
 * ahora guarda las fechas en hora de la tienda (backend/fechas.js), así que
 * los filtros tienen que hablar el mismo idioma o dejarían fuera lo que se
 * acaba de capturar.
 *
 * Se fija la zona a propósito, en vez de usar la del navegador: así el
 * sistema se comporta igual desde cualquier computadora.
 */

export const ZONA_TIENDA = "America/Mexico_City";

// "en-CA" produce YYYY-MM-DD directo.
const formateador = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONA_TIENDA,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Fecha de hoy en la tienda, en formato YYYY-MM-DD. */
export function hoyLocal() {
  return formateador.format(new Date());
}

/** Fecha de hace n días en la tienda, en formato YYYY-MM-DD. */
export function haceDiasLocal(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return formateador.format(d);
}
```

- [ ] **Step 2: Reemplazar los helpers locales en las 10 pantallas**

En cada uno de los 10 archivos listados arriba, **borrar** las definiciones locales que se vean así:

```jsx
const hoyFmt = () => new Date().toISOString().slice(0, 10);
const hace30 = () => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10); };
```

y en su lugar importar los compartidos:

```jsx
import { hoyLocal, haceDiasLocal } from "../fechas";   // desde src/reportes/*
import { hoyLocal, haceDiasLocal } from "./fechas";    // desde src/*
```

Después sustituir los usos: `hoyFmt()` → `hoyLocal()`, `hace30()` → `haceDiasLocal(30)`, `hace90()` → `haceDiasLocal(90)`.

**Cuidados:**
- Cada archivo puede tener su propia ventana por defecto (30 o 90 días). **Respeta el número que ya tenía cada pantalla** — no uniformes nada.
- `src/PrediccionesDemanda.jsx` puede usar el helper para otra cosa (un calendario, no un filtro de rango). Léelo antes de tocarlo y, si su uso no es "hoy" ni "hace N días", **déjalo como está** y anótalo en tu reporte.
- No quedes con imports sin usar: si un archivo solo usaba uno de los dos helpers, importa solo ese.

- [ ] **Step 3: Verificar que compila**

```bash
npm run build
```

Expected: build exitoso, sin errores nuevos (el único warning aceptable es el de chunk > 500 kB, preexistente).

- [ ] **Step 4: Verificar que no quedó ningún helper viejo**

```bash
grep -rn "toISOString().slice(0, 10)" src --include=*.jsx
```

Expected: sin resultados. Si queda alguno, revísalo: o se te pasó, o es un caso que decidiste dejar (entonces explícalo en el reporte).

- [ ] **Step 5: Correr la suite del backend como red de seguridad**

```bash
cd backend && node --test
```

Expected: PASS, 462 en verde (esta tarea no toca backend).

- [ ] **Step 6: Commit**

```bash
git add src/fechas.js src/Gastos.jsx src/ConsultasVentas.jsx src/PrediccionesDemanda.jsx src/reportes/
git commit -m "fix: los filtros de las pantallas usan la fecha de la tienda, no la de UTC"
```

---

### Task 4: Comprimir la foto del comprobante antes de subirla

**Files:**
- Create: `src/comprimirImagen.js`
- Modify: `src/Gastos.jsx` (el manejador `elegirArchivo` y el texto que muestra el archivo elegido)

**Interfaces:**
- Produces (exportada de `src/comprimirImagen.js`): `comprimirImagen(archivo, opciones?)` → `Promise<File>`. Devuelve el archivo original sin tocar si es PDF, si no es una imagen soportada, o si comprimir no lo hiciera más chico.

- [ ] **Step 1: Crear `src/comprimirImagen.js`**

```js
/**
 * comprimirImagen.js — Reduce la foto del comprobante ANTES de subirla.
 *
 * Una foto de celular moderno pesa varios MB. Sobre el internet de una tienda
 * eso son decenas de segundos por gasto, con la cajera esperando. Reescalar a
 * 1600 px de lado largo y recomprimir a JPEG al 80% deja un ticket térmico o
 * una factura perfectamente legibles y baja el archivo a unos cientos de KB.
 *
 * Decisiones deliberadas:
 * - Los PDF NO se tocan: ya vienen comprimidos y recomprimirlos los degrada.
 * - Nunca se AGRANDA una imagen que ya sea más chica que el límite.
 * - Si el resultado pesara más que el original (pasa con capturas de pantalla
 *   y con PNG de pocos colores), se conserva el original.
 * - Se decodifica con `imageOrientation: "from-image"` porque las fotos de
 *   celular traen la rotación en los metadatos EXIF; sin eso el comprobante
 *   se sube acostado.
 */

const LADO_MAXIMO = 1600;
const CALIDAD = 0.8;
const COMPRIMIBLES = ["image/jpeg", "image/png"];

/** Cambia la extensión del nombre a .jpg, conservando el resto. */
function nombreComoJpg(nombre) {
  return nombre.replace(/\.[^.]+$/, "") + ".jpg";
}

export async function comprimirImagen(archivo, opciones = {}) {
  const ladoMaximo = opciones.ladoMaximo || LADO_MAXIMO;
  const calidad = opciones.calidad || CALIDAD;

  if (!archivo || !COMPRIMIBLES.includes(archivo.type)) return archivo;

  let bitmap;
  try {
    bitmap = await createImageBitmap(archivo, { imageOrientation: "from-image" });
  } catch {
    return archivo; // si el navegador no puede decodificarla, se sube tal cual
  }

  const escala = Math.min(1, ladoMaximo / Math.max(bitmap.width, bitmap.height));
  const ancho = Math.round(bitmap.width * escala);
  const alto = Math.round(bitmap.height * escala);

  const lienzo = document.createElement("canvas");
  lienzo.width = ancho;
  lienzo.height = alto;
  const ctx = lienzo.getContext("2d");
  // Fondo blanco: un PNG con transparencia quedaría negro al pasar a JPEG.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, ancho, alto);
  ctx.drawImage(bitmap, 0, 0, ancho, alto);
  bitmap.close?.();

  const blob = await new Promise((resolve) =>
    lienzo.toBlob(resolve, "image/jpeg", calidad)
  );
  if (!blob || blob.size >= archivo.size) return archivo;

  return new File([blob], nombreComoJpg(archivo.name), {
    type: "image/jpeg",
    lastModified: Date.now(),
  });
}
```

- [ ] **Step 2: Usarla en `src/Gastos.jsx`**

Agregar el import junto a los demás:

```jsx
import { comprimirImagen } from "./comprimirImagen";
```

Reemplazar el manejador `elegirArchivo` por esta versión, que comprime antes de validar el tamaño (así el límite de 10 MB se mide sobre lo que de verdad se va a subir) y guarda cuánto se ahorró:

```jsx
const elegirArchivo = async (e) => {
  const original = e.target.files?.[0];
  if (!original) return;
  if (!MIME_OK.includes(original.type)) return mostrarAviso("❌ Solo se acepta PDF, JPG o PNG");

  setComprimiendo(true);
  try {
    const listo = await comprimirImagen(original);
    if (listo.size > TAM_MAX) return mostrarAviso("❌ El archivo no puede pesar más de 10 MB");
    setArchivo(listo);
    setPesoOriginal(listo.size < original.size ? original.size : null);
  } catch (err) {
    mostrarAviso("❌ No se pudo preparar la imagen: " + err.message);
  } finally {
    setComprimiendo(false);
  }
};
```

Agregar los dos estados nuevos junto a `const [archivo, setArchivo] = useState(null);`:

```jsx
const [comprimiendo, setComprimiendo] = useState(false);
const [pesoOriginal, setPesoOriginal] = useState(null);
```

Y reemplazar el texto que hoy muestra el archivo elegido por uno que informe el peso, para que quien captura vea que la foto sí se subió y que quedó ligera:

```jsx
{comprimiendo && <p className="text-xs text-slate-500 mt-1">Preparando la imagen...</p>}
{archivo && !comprimiendo && (
  <p className="text-xs text-emerald-700 mt-1 flex items-center gap-1">
    <Upload size={12} /> {archivo.name} ({(archivo.size / 1024).toFixed(0)} KB
    {pesoOriginal ? ` — comprimida desde ${(pesoOriginal / 1024 / 1024).toFixed(1)} MB` : ""})
  </p>
)}
```

En `abrirNuevo`, limpiar también los estados nuevos: junto a `setArchivo(null);` agregar `setPesoOriginal(null);`.

**Cuida** que el botón de guardar siga mirando **solo el estado `archivo`** (la costura que el módulo del QR va a reutilizar), y agrégale `|| comprimiendo` al `disabled` para que nadie guarde mientras la imagen se está preparando.

- [ ] **Step 3: Verificar que compila**

```bash
npm run build
```

Expected: build exitoso, sin errores nuevos.

- [ ] **Step 4: Verificar la lógica de compresión fuera del navegador**

`canvas` y `createImageBitmap` no existen en Node, así que la función no se puede probar con `node --test`. Verifica al menos que las **decisiones** son las correctas leyendo el código y confirmando estos cuatro casos, y anótalos en tu reporte:

1. Un PDF se devuelve tal cual (no entra al canvas).
2. Una imagen de 800×600 no se agranda (la escala se topa en 1).
3. Si el JPEG resultante pesa más que el original, se devuelve el original.
4. Un PNG con transparencia queda sobre fondo blanco, no negro.

- [ ] **Step 5: Correr la suite del backend como red de seguridad**

```bash
cd backend && node --test
```

Expected: PASS, 462 en verde.

- [ ] **Step 6: Commit**

```bash
git add src/comprimirImagen.js src/Gastos.jsx
git commit -m "feat: comprimir la foto del comprobante en el navegador antes de subirla"
```

---

## Verificación manual en navegador (después de las 4 tareas)

1. **La fecha.** Registrar un gasto y confirmar que la fecha que muestra la lista es la del día que se está viviendo en la tienda. La prueba dura de verdad es **después de las 6:00 pm hora de Chiapas**: antes del arreglo aparecería con la fecha del día siguiente.
2. **El filtro del mismo día.** Poner "Del" y "Al" en el día de hoy y confirmar que el gasto recién capturado aparece.
3. **La compresión.** Elegir una foto de celular de varios MB y confirmar que el texto dice algo como "ticket.jpg (380 KB — comprimida desde 4.2 MB)", que el botón de guardar se habilita al terminar, y que **el comprobante se ve derecho y legible** al abrirlo en Drive (no acostado — eso es lo que verifica el manejo de la orientación EXIF).
4. **Un PDF** se sube tal cual, sin pasar por la compresión.
5. **El corte de caja** sigue descontando bien los gastos en efectivo del turno (esta es la parte que NO debía cambiar).

## Fuera de alcance (YAGNI)

- **No se migran los datos ya guardados** (decisión de Victor): las ventas, cortes y gastos ya registrados conservan su fecha corrida.
- No se cambia ninguna marca de tiempo completa (`fecha_hora` y demás ISO) — siguen en UTC a propósito.
- No se hace configurable la zona horaria por sucursal: las 6 tiendas están en Chiapas.
- No se comprime del lado del servidor ni se generan miniaturas.
