# Pantalla "Artículo" en Recepción de Compras Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rehacer Recepción de Compras para que cada producto agregado pase por una pantalla completa tipo SICAR ("Artículo": clave SAT, localización, costo, descuento, IVA informativo, márgenes/precios), con la pantalla completa rediseñada al estilo de Punto de Venta (barra lateral, atajos F2-F8, tabla tipo ticket), y agregar importación de facturas CFDI 4.0 en XML.

**Architecture:** Cambios de datos y cálculo en el backend (`productos.js`, `compras.js`), un catálogo de Claves SAT importado una sola vez a SQLite y consultado por búsqueda, un parser de CFDI 4.0 (`cfdi.js`), y en el frontend un nuevo componente modal (`ArticuloCompra.jsx`) montado desde una `RecepcionCompras.jsx` rediseñada con el mismo esqueleto visual que `PuntoDeVenta.jsx`.

**Tech Stack:** Node.js + Express + better-sqlite3 (backend), React 18 + Vite + Tailwind (frontend), `node:test` para pruebas de backend, `fast-xml-parser` y `unbzip2-stream` como dependencias nuevas del backend.

## Global Constraints

- Costo se captura siempre **neto** (sin IVA); el IVA (16%, único impuesto del negocio) es puramente informativo y nunca se resta de nada guardado.
- Descuento por renglón: `costo_final = (costo − desc_$) × (1 − desc_%/100)`, redondeado a 2 decimales — ese es el valor que se guarda como costo del producto.
- El catálogo de Claves SAT (`claves_sat`) vive en el mismo `datos.sqlite` que ya usa `backend/persistencia.js`, pero **nunca** se carga al objeto `DB` en memoria ni pasa por `cargar()`/`guardar()` — se consulta siempre con SQL directo.
- El emparejamiento factura XML → producto **siempre requiere confirmación manual por renglón** — nunca se agrega/actualiza inventario sin revisión humana.
- Botones "Doc", "Pedido", "Dev Pro" son solo visuales (fidelidad con SICAR) y muestran aviso "próximamente" — sin función real.
- Sigue el patrón visual ya establecido en `src/PuntoDeVenta.jsx` (componentes `BotonBarra`/`BotonLateral`/`Modal` definidos localmente en cada archivo, no compartidos).
- Todas las rutas nuevas del backend requieren `requiereLogin` + `requierePermiso("recibir_compra", resolverPermisosDeRol)` salvo que se indique lo contrario.
- Spec completo: `docs/superpowers/specs/2026-07-10-compras-pantalla-articulo-design.md`.

---

## Task 1: Campos nuevos en producto y proveedor

**Files:**
- Modify: `backend/productos.js` (`crearProducto` ~línea 49, `actualizarProducto` ~línea 97, `crearProveedor` ~línea 210)
- Modify: `backend/server.js` (ruta `POST /api/proveedores`, ~línea 425)
- Test: `backend/productoClaveSatLocalizacion.test.js` (nuevo)

**Interfaces:**
- Produces: `producto.clave_sat` (string), `producto.localizacion` (string), `proveedor.rfc` (string) — usados por Task 3 (historial), Task 7 (modal Artículo) y Task 9 (importar XML).

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/productoClaveSatLocalizacion.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { crearProducto, actualizarProducto, crearProveedor } = require("./productos");

test("crearProducto guarda clave_sat y localizacion", () => {
  const DB = construirDBPrueba();
  const p = crearProducto(DB, { descripcion: "Amplificador", clave_sat: "52161547", localizacion: "Pasillo 3" }, 1);
  assert.strictEqual(p.clave_sat, "52161547");
  assert.strictEqual(p.localizacion, "Pasillo 3");
});

test("crearProducto usa cadena vacía si no se manda clave_sat/localizacion", () => {
  const DB = construirDBPrueba();
  const p = crearProducto(DB, { descripcion: "Amplificador" }, 1);
  assert.strictEqual(p.clave_sat, "");
  assert.strictEqual(p.localizacion, "");
});

test("actualizarProducto actualiza clave_sat y localizacion", () => {
  const DB = construirDBPrueba();
  const p = crearProducto(DB, { descripcion: "Amplificador" }, 1);
  const actualizado = actualizarProducto(DB, p.id, { clave_sat: "52161547", localizacion: "Pasillo 3, Anaquel B" }, 1);
  assert.strictEqual(actualizado.clave_sat, "52161547");
  assert.strictEqual(actualizado.localizacion, "Pasillo 3, Anaquel B");
});

test("actualizarProducto conserva clave_sat/localizacion si no se mandan", () => {
  const DB = construirDBPrueba();
  const p = crearProducto(DB, { descripcion: "Amplificador", clave_sat: "52161547", localizacion: "Pasillo 3" }, 1);
  const actualizado = actualizarProducto(DB, p.id, { descripcion: "Amplificador 2" }, 1);
  assert.strictEqual(actualizado.clave_sat, "52161547");
  assert.strictEqual(actualizado.localizacion, "Pasillo 3");
});

test("crearProveedor guarda rfc", () => {
  const DB = construirDBPrueba();
  const prov = crearProveedor(DB, "Distribuidora Norte", "DINX800101ABC");
  assert.strictEqual(prov.rfc, "DINX800101ABC");
});

test("crearProveedor usa cadena vacía si no se manda rfc", () => {
  const DB = construirDBPrueba();
  const prov = crearProveedor(DB, "Distribuidora Norte");
  assert.strictEqual(prov.rfc, "");
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `cd backend && node --test productoClaveSatLocalizacion.test.js`
Expected: FAIL — `clave_sat`/`localizacion`/`rfc` son `undefined`.

- [ ] **Step 3: Implementar en `backend/productos.js`**

En `crearProducto` (agregar dos líneas dentro del objeto `producto`, junto a `ubicacion`):

```js
    ubicacion: datos.ubicacion || "-",
    clave_sat: datos.clave_sat || "",
    localizacion: datos.localizacion || "",
    promocion: !!datos.promocion,
```

En `actualizarProducto` (agregar dentro del objeto `actualizado`, junto a `imagen_url`):

```js
    imagen_url: datos.imagen_url !== undefined ? datos.imagen_url : (actual.imagen_url || ""),
    clave_sat: datos.clave_sat !== undefined ? datos.clave_sat : (actual.clave_sat || ""),
    localizacion: datos.localizacion !== undefined ? datos.localizacion : (actual.localizacion || ""),
```

`crearProveedor` — cambiar firma y cuerpo:

```js
function crearProveedor(DB, nombre, rfc) {
  if (!nombre || !nombre.trim()) throw new Error("El nombre del proveedor es obligatorio");
  const nuevo = { id: siguienteId(DB["catalogo-productos"].proveedores), nombre: nombre.trim(), contacto: "", tiempo_entrega_dias: 0, condiciones_pago: "", rfc: rfc || "" };
  DB["catalogo-productos"].proveedores.push(nuevo);
  return nuevo;
}
```

- [ ] **Step 4: Actualizar la ruta en `backend/server.js`**

Buscar la ruta `POST /api/proveedores` (cerca de la línea 425) y cambiar la llamada a `crearProveedor` para pasar el RFC:

```js
app.post("/api/proveedores", requiereLogin, requierePermiso("crear_producto", resolverPermisosDeRol), (req, res) => {
  try { res.json(crearProveedor(DB, req.body.nombre, req.body.rfc)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
```

- [ ] **Step 5: Correr el test para verificar que pasa**

Run: `cd backend && node --test productoClaveSatLocalizacion.test.js`
Expected: PASS (6 tests)

- [ ] **Step 6: Correr toda la suite para verificar que no se rompió nada**

Run: `cd backend && node --test`
Expected: PASS (todos, incluyendo los ~112 anteriores)

- [ ] **Step 7: Commit**

```bash
git add backend/productos.js backend/server.js backend/productoClaveSatLocalizacion.test.js
git commit -m "feat: clave SAT y localizacion en productos, RFC en proveedores"
```

---

## Task 2: Descuento por renglón y costo neto final en Recepción de Compras

**Files:**
- Modify: `backend/compras.js` (`crearRecepcion`)
- Test: `backend/compras.test.js` (agregar casos)

**Interfaces:**
- Consumes: `actualizarProducto(DB, id, datos, sucursalId)` de `backend/productos.js` (ya existe desde Task 1).
- Produces: cada renglón de `datos.renglones` ahora acepta `descuento_pesos`, `descuento_porcentaje` (opcionales, default 0), y opcionalmente `clave_sat`, `localizacion`, `aplicaIva`, `neto`, `precios` (los datos que la pantalla Artículo deja capturados/editados a mano — Task 7); `DB.inventario.compra_detalle[].costo` pasa a ser el costo YA con descuento aplicado. Cuando el renglón trae `precios` explícito, ese arreglo **sobrescribe** lo que `actualizarCostoDesdeCompra` hubiera recalculado — así un margen o precio editado a mano en la pantalla Artículo no se pierde.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar al final de `backend/compras.test.js` (antes del `module.exports` si lo hubiera; el archivo no tiene exports, solo agregar al final):

```js
test("crearRecepcion aplica descuento en pesos antes de recalcular costo", () => {
  const DB = conProveedor(construirDBPrueba());
  const producto = DB["catalogo-productos"].productos.find((p) => p.id === 1);
  producto.costo = 20;
  producto.precios = [{ utilidad: 25, precioVenta: 25 }, { utilidad: 0, precioVenta: 0 }, { utilidad: 0, precioVenta: 0 }, { utilidad: 0, precioVenta: 0 }];

  crearRecepcion(DB, {
    proveedor_id: 1, factura: "A-100",
    renglones: [{ producto_id: 1, cantidad: 5, costo: 50, descuento_pesos: 10 }],
  }, 6, USUARIO_CEDIS);

  assert.strictEqual(producto.costo, 40, "50 - 10 de descuento");
  const detalle = DB.inventario.compra_detalle.find((d) => d.producto_id === 1);
  assert.strictEqual(detalle.costo, 40);
  assert.strictEqual(detalle.descuento_pesos, 10);
});

test("crearRecepcion aplica descuento en porcentaje antes de recalcular costo", () => {
  const DB = conProveedor(construirDBPrueba());
  const producto = DB["catalogo-productos"].productos.find((p) => p.id === 1);
  producto.costo = 20;

  crearRecepcion(DB, {
    proveedor_id: 1, factura: "A-100",
    renglones: [{ producto_id: 1, cantidad: 5, costo: 100, descuento_porcentaje: 10 }],
  }, 6, USUARIO_CEDIS);

  assert.strictEqual(producto.costo, 90, "100 * (1 - 10%) = 90");
});

test("crearRecepcion combina descuento en pesos y porcentaje: pesos primero, luego porcentaje", () => {
  const DB = conProveedor(construirDBPrueba());
  const producto = DB["catalogo-productos"].productos.find((p) => p.id === 1);
  producto.costo = 20;

  crearRecepcion(DB, {
    proveedor_id: 1, factura: "A-100",
    renglones: [{ producto_id: 1, cantidad: 5, costo: 100, descuento_pesos: 10, descuento_porcentaje: 10 }],
  }, 6, USUARIO_CEDIS);

  assert.strictEqual(producto.costo, 81, "(100 - 10) * (1 - 10%) = 81");
});

test("crearRecepcion sin descuento se comporta igual que antes (compatibilidad)", () => {
  const DB = conProveedor(construirDBPrueba());
  const producto = DB["catalogo-productos"].productos.find((p) => p.id === 1);
  producto.costo = 20;

  crearRecepcion(DB, {
    proveedor_id: 1, factura: "A-100",
    renglones: [{ producto_id: 1, cantidad: 5, costo: 40 }],
  }, 6, USUARIO_CEDIS);

  assert.strictEqual(producto.costo, 40);
});

test("crearRecepcion guarda clave_sat y localizacion cuando el renglón los trae", () => {
  const DB = conProveedor(construirDBPrueba());
  crearRecepcion(DB, {
    proveedor_id: 1, factura: "A-100",
    renglones: [{ producto_id: 1, cantidad: 5, costo: 40, clave_sat: "52161547", localizacion: "Pasillo 3" }],
  }, 6, USUARIO_CEDIS);

  const producto = DB["catalogo-productos"].productos.find((p) => p.id === 1);
  assert.strictEqual(producto.clave_sat, "52161547");
  assert.strictEqual(producto.localizacion, "Pasillo 3");
});

test("crearRecepcion respeta precios editados a mano en el renglón, sin dejar que actualizarCostoDesdeCompra los recalcule encima", () => {
  const DB = conProveedor(construirDBPrueba());
  const producto = DB["catalogo-productos"].productos.find((p) => p.id === 1);
  producto.costo = 20;
  producto.precios = [{ utilidad: 25, precioVenta: 25 }, { utilidad: 0, precioVenta: 0 }, { utilidad: 0, precioVenta: 0 }, { utilidad: 0, precioVenta: 0 }];

  // Con la fórmula normal, costo 40 * 1.25 = 50 — pero el renglón trae un
  // precio editado a mano (60) que debe prevalecer.
  const preciosEditados = [{ utilidad: 50, precioVenta: 60 }, { utilidad: 0, precioVenta: 0 }, { utilidad: 0, precioVenta: 0 }, { utilidad: 0, precioVenta: 0 }];
  crearRecepcion(DB, {
    proveedor_id: 1, factura: "A-100",
    renglones: [{ producto_id: 1, cantidad: 5, costo: 40, precios: preciosEditados }],
  }, 6, USUARIO_CEDIS);

  assert.strictEqual(producto.costo, 40);
  assert.strictEqual(producto.precios[0].precioVenta, 60, "debe prevalecer el precio editado a mano, no el recalculado (50)");
});

test("crearRecepcion sin precios explícito en el renglón sigue recalculando con la fórmula normal", () => {
  const DB = conProveedor(construirDBPrueba());
  const producto = DB["catalogo-productos"].productos.find((p) => p.id === 1);
  producto.costo = 20;
  producto.precios = [{ utilidad: 25, precioVenta: 25 }, { utilidad: 0, precioVenta: 0 }, { utilidad: 0, precioVenta: 0 }, { utilidad: 0, precioVenta: 0 }];

  crearRecepcion(DB, {
    proveedor_id: 1, factura: "A-100",
    renglones: [{ producto_id: 1, cantidad: 5, costo: 40 }],
  }, 6, USUARIO_CEDIS);

  assert.strictEqual(producto.precios[0].precioVenta, 50, "40 * 1.25, formula normal preservando el % de utilidad");
});
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `cd backend && node --test compras.test.js`
Expected: los 6 tests nuevos FAIL (el costo no baja con el descuento; clave_sat/localizacion no se guardan; los precios editados a mano se pierden).

- [ ] **Step 3: Implementar en `backend/compras.js`**

Actualizar el `require` al inicio del archivo:

```js
const { ajustarExistencia, actualizarCostoDesdeCompra, actualizarProducto } = require("./productos");
```

Reemplazar el cuerpo de `crearRecepcion` (la parte de `renglonesValidados` y el `forEach`):

```js
  let siguienteDetalleId = siguienteId(DB.inventario.compra_detalle);
  const renglonesValidados = datos.renglones.map((r) => {
    const producto_id = Number(r.producto_id);
    const cantidad = Number(r.cantidad);
    if (!producto_id) throw new Error("Cada renglón necesita un producto");
    if (!cantidad || cantidad <= 0) throw new Error("La cantidad debe ser mayor a cero");
    const existeProducto = DB["catalogo-productos"].productos.some((p) => p.id === producto_id);
    if (!existeProducto) throw new Error("Producto no encontrado");
    const costo = Number(r.costo);
    const descuento_pesos = Number(r.descuento_pesos) || 0;
    const descuento_porcentaje = Number(r.descuento_porcentaje) || 0;
    const costoFinal = Math.round((costo - descuento_pesos) * (1 - descuento_porcentaje / 100) * 100) / 100;
    return {
      producto_id, cantidad, descuento_pesos, descuento_porcentaje, costoFinal,
      clave_sat: r.clave_sat, localizacion: r.localizacion, aplicaIva: r.aplicaIva, neto: r.neto, precios: r.precios,
    };
  });

  DB.inventario.compras.push(compra);

  renglonesValidados.forEach(({ producto_id, cantidad, descuento_pesos, descuento_porcentaje, costoFinal, clave_sat, localizacion, aplicaIva, neto, precios }) => {
    DB.inventario.compra_detalle.push({
      id: siguienteDetalleId++,
      compra_id: nuevoId,
      producto_id,
      cantidad,
      costo: costoFinal,
      descuento_pesos,
      descuento_porcentaje,
    });

    const existe = DB.inventario.existencias.some((e) => e.producto_id === producto_id && e.sucursal_id === sucursal_id);
    if (!existe) {
      DB.inventario.existencias.push({ producto_id, sucursal_id, cantidad_actual: 0, cantidad_minima: 0, cantidad_maxima: 0 });
    }

    ajustarExistencia(DB, producto_id, {
      cantidad,
      motivo: `Compra #${nuevoId} — factura ${compra.factura || "s/n"}`,
      sucursal_id,
    });

    if (Number.isFinite(costoFinal) && costoFinal > 0) {
      actualizarCostoDesdeCompra(DB, producto_id, costoFinal);
    }

    // La pantalla Artículo (frontend) puede traer clave SAT, localización,
    // IVA, neto y precios ya editados/confirmados a mano — esto se aplica
    // DESPUÉS de actualizarCostoDesdeCompra para que un precio editado a
    // mano no se pierda bajo el recálculo automático por % de utilidad.
    if (clave_sat !== undefined || localizacion !== undefined || aplicaIva !== undefined || neto !== undefined || precios !== undefined) {
      actualizarProducto(DB, producto_id, {
        clave_sat, localizacion,
        iva: aplicaIva !== undefined ? aplicaIva : undefined,
        neto: neto !== undefined ? neto : undefined,
        precios: Array.isArray(precios) ? precios : undefined,
      }, sucursal_id);
    }
  });

  return compra;
```

(El resto de la función — validaciones iniciales, creación de `compra` — no cambia.)

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `cd backend && node --test compras.test.js`
Expected: PASS (todos, los originales + los 6 nuevos)

- [ ] **Step 5: Correr toda la suite**

Run: `cd backend && node --test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/compras.js backend/compras.test.js
git commit -m "feat: descuento por renglon (pesos y porcentaje) en Recepcion de Compras"
```

---

## Task 3: Histórico de precio de compra + IVA informativo

**Files:**
- Modify: `backend/productos.js` (constante `TASA_IVA`, helper `costoConIva`)
- Modify: `backend/compras.js` (`historialCostoProducto`)
- Modify: `backend/server.js` (nueva ruta)
- Test: `backend/historialCostoProducto.test.js` (nuevo)

**Interfaces:**
- Produces: `TASA_IVA` (0.16) y `costoConIva(costoNeto)` exportados de `productos.js`; `historialCostoProducto(DB, productoId)` exportado de `compras.js`, devuelve `{ ultimo: {neto, conIva} | null, promedio: {neto, conIva} | null }` — usado por Task 7 (pantalla Artículo).

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/historialCostoProducto.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { crearRecepcion, historialCostoProducto } = require("./compras");

function conProveedor(DB) {
  DB["catalogo-productos"].proveedores.push({ id: 1, nombre: "Proveedor Uno", contacto: "", tiempo_entrega_dias: 0, condiciones_pago: "", rfc: "" });
  return DB;
}

test("historialCostoProducto sin compras previas devuelve null en ambos", () => {
  const DB = construirDBPrueba();
  const historial = historialCostoProducto(DB, 1);
  assert.strictEqual(historial.ultimo, null);
  assert.strictEqual(historial.promedio, null);
});

test("historialCostoProducto con una compra: ultimo y promedio son el mismo costo, con y sin IVA", () => {
  const DB = conProveedor(construirDBPrueba());
  crearRecepcion(DB, { proveedor_id: 1, renglones: [{ producto_id: 1, cantidad: 5, costo: 100 }] }, 6, { id: 1, nombre: "T" });

  const historial = historialCostoProducto(DB, 1);
  assert.strictEqual(historial.ultimo.neto, 100);
  assert.strictEqual(historial.ultimo.conIva, 116);
  assert.strictEqual(historial.promedio.neto, 100);
  assert.strictEqual(historial.promedio.conIva, 116);
});

test("historialCostoProducto con varias compras: ultimo es la mas reciente, promedio es el promedio simple", () => {
  const DB = conProveedor(construirDBPrueba());
  crearRecepcion(DB, { proveedor_id: 1, renglones: [{ producto_id: 1, cantidad: 5, costo: 100 }] }, 6, { id: 1, nombre: "T" });
  crearRecepcion(DB, { proveedor_id: 1, renglones: [{ producto_id: 1, cantidad: 5, costo: 200 }] }, 6, { id: 1, nombre: "T" });

  const historial = historialCostoProducto(DB, 1);
  assert.strictEqual(historial.ultimo.neto, 200, "la compra mas reciente");
  assert.strictEqual(historial.promedio.neto, 150, "(100 + 200) / 2");
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `cd backend && node --test historialCostoProducto.test.js`
Expected: FAIL — `historialCostoProducto` no existe todavía.

- [ ] **Step 3: Implementar `TASA_IVA` y `costoConIva` en `backend/productos.js`**

Agregar cerca del inicio del archivo (después de los comentarios de cabecera, antes de `function listarProductos`):

```js
const TASA_IVA = 0.16;

function costoConIva(costoNeto) {
  return Math.round(Number(costoNeto) * (1 + TASA_IVA) * 100) / 100;
}
```

Y agregar ambos al `module.exports` al final del archivo (junto a los demás):

```js
module.exports = {
  listarProductos,
  crearProducto,
  actualizarProducto,
  eliminarProducto,
  clonarProducto,
  ajustarExistencia,
  actualizarCostoDesdeCompra,
  listarCategorias,
  crearCategoria,
  listarDepartamentos,
  crearDepartamento,
  crearProveedor,
  generarClave,
  TASA_IVA,
  costoConIva,
};
```

(Ajustar según la lista real de exports existente — solo agregar `TASA_IVA` y `costoConIva` sin quitar nada.)

- [ ] **Step 4: Implementar `historialCostoProducto` en `backend/compras.js`**

La Task 2 ya dejó esta línea al inicio del archivo:
`const { ajustarExistencia, actualizarCostoDesdeCompra, actualizarProducto } = require("./productos");`
Actualizarla para agregar `costoConIva` (sin quitar `actualizarProducto`):

```js
const { ajustarExistencia, actualizarCostoDesdeCompra, actualizarProducto, costoConIva } = require("./productos");
```

Agregar la función (antes de `module.exports`):

```js
function historialCostoProducto(DB, productoId) {
  const id = Number(productoId);
  const historial = DB.inventario.compra_detalle
    .filter((d) => d.producto_id === id)
    .map((d) => {
      const compra = DB.inventario.compras.find((c) => c.id === d.compra_id);
      return compra ? { costo: d.costo, fecha: compra.fecha } : null;
    })
    .filter(Boolean)
    .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

  if (historial.length === 0) return { ultimo: null, promedio: null };

  const ultimoNeto = historial[historial.length - 1].costo;
  const promedioNeto = Math.round((historial.reduce((acc, h) => acc + h.costo, 0) / historial.length) * 100) / 100;

  return {
    ultimo: { neto: ultimoNeto, conIva: costoConIva(ultimoNeto) },
    promedio: { neto: promedioNeto, conIva: costoConIva(promedioNeto) },
  };
}
```

Actualizar `module.exports` de `backend/compras.js`:

```js
module.exports = { crearRecepcion, listarRecepciones, historialCostoProducto };
```

- [ ] **Step 5: Agregar la ruta en `backend/server.js`**

Actualizar el `require` de `compras.js` (buscar la línea existente):

```js
const { crearRecepcion, listarRecepciones, historialCostoProducto } = require("./compras");
```

Agregar la ruta justo después de las rutas existentes de `/api/compras` (después de la línea que registra `POST /api/compras`):

```js
app.get("/api/productos/:id/historial-costo", requiereLogin, requierePermiso("recibir_compra", resolverPermisosDeRol), (req, res) => {
  res.json(historialCostoProducto(DB, req.params.id));
});
```

- [ ] **Step 6: Correr el test para verificar que pasa**

Run: `cd backend && node --test historialCostoProducto.test.js`
Expected: PASS (3 tests)

- [ ] **Step 7: Correr toda la suite**

Run: `cd backend && node --test`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add backend/productos.js backend/compras.js backend/server.js backend/historialCostoProducto.test.js
git commit -m "feat: historial de costo de compra (ultimo/promedio, neto y con IVA)"
```

---

## Task 4: Catálogo de Claves SAT (importación + búsqueda)

**Files:**
- Modify: `backend/package.json` (dependencia `unbzip2-stream`)
- Create: `backend/scripts/importarClavesSat.js`
- Create: `backend/clavesSat.js`
- Modify: `backend/server.js` (nueva ruta)
- Test: `backend/clavesSat.test.js` (nuevo)

**Interfaces:**
- Produces: `buscarClavesSat(texto, pagina)` exportado de `backend/clavesSat.js`, devuelve `{ resultados: [{clave, descripcion}], total }` — usado por Task 7 (buscador de Clave SAT en la pantalla Artículo).

- [ ] **Step 1: Agregar la dependencia**

Run: `cd backend && npm install unbzip2-stream`
Expected: se agrega `"unbzip2-stream"` a `backend/package.json` bajo `dependencies`.

- [ ] **Step 2: Escribir el script de importación**

Crear `backend/scripts/importarClavesSat.js`:

```js
/**
 * importarClavesSat.js — Importa el catálogo oficial de Claves de Productos
 * y Servicios del SAT (c_ClaveProdServ, ~55,000 registros) a una tabla
 * de solo-lectura `claves_sat` dentro de datos.sqlite.
 *
 * Se corre UNA SOLA VEZ (o cuando el catálogo del SAT se actualice) — no es
 * parte del arranque normal del backend. La fuente es el paquete compilado
 * de phpcfdi/resources-sat-catalogs, que empaqueta los catálogos oficiales
 * del SAT en una base SQLite ya lista, actualizada automáticamente por ese
 * proyecto open-source.
 *
 * Uso: node backend/scripts/importarClavesSat.js
 */

const https = require("https");
const fs = require("fs");
const path = require("path");
const unbzip2 = require("unbzip2-stream");
const Database = require("better-sqlite3");

const URL_CATALOGO = "https://github.com/phpcfdi/resources-sat-catalogs/releases/latest/download/catalogs.db.bz2";
const ARCHIVO_TEMPORAL = path.join(__dirname, "catalogs.db");
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "datos.sqlite");
const TABLA_ORIGEN = "cfdi_40_productos_servicios";
const MINIMO_FILAS_ESPERADAS = 10000;

function descargarYDescomprimir(url, destino) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return descargarYDescomprimir(res.headers.location, destino).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`Descarga falló: HTTP ${res.statusCode} en ${url}`));
      }
      const salida = fs.createWriteStream(destino);
      res.pipe(unbzip2()).pipe(salida);
      salida.on("finish", resolve);
      salida.on("error", reject);
    }).on("error", reject);
  });
}

function encontrarColumna(db, tabla, candidatos) {
  const columnas = db.prepare(`PRAGMA table_info(${tabla})`).all().map((c) => c.name);
  for (const candidato of candidatos) {
    const encontrada = columnas.find((c) => c.toLowerCase() === candidato.toLowerCase());
    if (encontrada) return encontrada;
  }
  throw new Error(
    `No se encontró ninguna columna de [${candidatos.join(", ")}] en ${tabla}. ` +
    `Columnas reales: ${columnas.join(", ")}. Ajusta la lista de candidatos en este script.`
  );
}

async function main() {
  console.log("Descargando catálogo SAT (catalogs.db.bz2)...");
  await descargarYDescomprimir(URL_CATALOGO, ARCHIVO_TEMPORAL);
  console.log("Descarga y descompresión completas.");

  const catalogosDb = new Database(ARCHIVO_TEMPORAL, { readonly: true });
  const colClave = encontrarColumna(catalogosDb, TABLA_ORIGEN, ["c_clave_prod_serv", "clave_prod_serv", "clave"]);
  const colDescripcion = encontrarColumna(catalogosDb, TABLA_ORIGEN, ["descripcion", "descripción"]);
  console.log(`Usando columnas: clave="${colClave}", descripcion="${colDescripcion}"`);

  const filas = catalogosDb.prepare(`SELECT "${colClave}" AS clave, "${colDescripcion}" AS descripcion FROM ${TABLA_ORIGEN}`).all();
  catalogosDb.close();
  fs.unlinkSync(ARCHIVO_TEMPORAL);

  if (filas.length < MINIMO_FILAS_ESPERADAS) {
    throw new Error(`Solo se encontraron ${filas.length} claves — se esperaban al menos ${MINIMO_FILAS_ESPERADAS}. Revisa la fuente antes de continuar.`);
  }

  const db = new Database(DB_PATH);
  db.exec(`
    DROP TABLE IF EXISTS claves_sat;
    CREATE TABLE claves_sat (clave TEXT PRIMARY KEY, descripcion TEXT NOT NULL);
    CREATE INDEX idx_claves_sat_descripcion ON claves_sat (descripcion);
  `);
  const insertar = db.prepare("INSERT OR REPLACE INTO claves_sat (clave, descripcion) VALUES (?, ?)");
  const transaccion = db.transaction((lista) => { for (const f of lista) insertar.run(f.clave, f.descripcion); });
  transaccion(filas);
  db.close();

  console.log(`Listo: ${filas.length} claves SAT importadas a ${DB_PATH}`);
}

main().catch((e) => {
  console.error("Error al importar el catálogo de Claves SAT:", e.message);
  process.exit(1);
});
```

- [ ] **Step 3: Correr el script y verificar el resultado**

Run: `cd backend && node scripts/importarClavesSat.js`
Expected: imprime `Listo: <N> claves SAT importadas a .../datos.sqlite`, con N mayor a 10,000. Si el script falla en `encontrarColumna` con un error listando las columnas reales, ajustar la lista de `candidatos` en el script con el nombre real que aparezca en el mensaje de error, y volver a correr.

Verificar directamente:
Run: `cd backend && node -e "const db = new (require('better-sqlite3'))('datos.sqlite'); console.log(db.prepare('SELECT COUNT(*) AS n FROM claves_sat').get());"`
Expected: `{ n: <número mayor a 10000> }`

- [ ] **Step 4: Escribir el test que falla (de `buscarClavesSat`, aún no implementado)**

Crear `backend/clavesSat.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { buscarClavesSat } = require("./clavesSat");

test("buscarClavesSat encuentra resultados por texto en la descripción", () => {
  const { resultados, total } = buscarClavesSat("amplificador", 1);
  assert.ok(total > 0, "debe haber al menos una clave que mencione 'amplificador'");
  assert.ok(resultados.length > 0);
  assert.ok(resultados.every((r) => typeof r.clave === "string" && typeof r.descripcion === "string"));
});

test("buscarClavesSat con texto vacío devuelve resultados paginados", () => {
  const { resultados, total } = buscarClavesSat("", 1);
  assert.ok(total > 10000, "el catálogo completo debe tener decenas de miles de claves");
  assert.ok(resultados.length > 0 && resultados.length <= 20);
});

test("buscarClavesSat pagina correctamente (página 2 trae resultados distintos a la 1)", () => {
  const pagina1 = buscarClavesSat("", 1).resultados;
  const pagina2 = buscarClavesSat("", 2).resultados;
  assert.notDeepStrictEqual(pagina1, pagina2);
});
```

- [ ] **Step 5: Correr el test para verificar que falla**

Run: `cd backend && node --test clavesSat.test.js`
Expected: FAIL — `backend/clavesSat.js` no existe todavía.

- [ ] **Step 6: Implementar `backend/clavesSat.js`**

```js
/**
 * clavesSat.js — Búsqueda de solo-lectura sobre la tabla `claves_sat`
 * (importada una sola vez por scripts/importarClavesSat.js). Se consulta
 * siempre con SQL directo — nunca se carga al objeto DB en memoria.
 */

const path = require("path");
const Database = require("better-sqlite3");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "datos.sqlite");
const RESULTADOS_POR_PAGINA = 20;

let _conexion = null;
function conexion() {
  if (!_conexion) _conexion = new Database(DB_PATH, { readonly: true, fileMustExist: false });
  return _conexion;
}

function buscarClavesSat(texto, pagina) {
  const db = conexion();
  const tablaExiste = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='claves_sat'").get();
  if (!tablaExiste) return { resultados: [], total: 0 };

  const like = `%${(texto || "").trim()}%`;
  const paginaNum = Math.max(1, Number(pagina) || 1);

  const total = db.prepare("SELECT COUNT(*) AS n FROM claves_sat WHERE clave LIKE ? OR descripcion LIKE ?").get(like, like).n;
  const resultados = db.prepare(
    "SELECT clave, descripcion FROM claves_sat WHERE clave LIKE ? OR descripcion LIKE ? ORDER BY descripcion LIMIT ? OFFSET ?"
  ).all(like, like, RESULTADOS_POR_PAGINA, (paginaNum - 1) * RESULTADOS_POR_PAGINA);

  return { resultados, total };
}

module.exports = { buscarClavesSat };
```

- [ ] **Step 7: Correr el test para verificar que pasa**

Run: `cd backend && node --test clavesSat.test.js`
Expected: PASS (3 tests) — requiere haber corrido Step 3 antes en esta misma máquina/entorno.

- [ ] **Step 8: Agregar la ruta en `backend/server.js`**

Agregar el `require`:

```js
const { buscarClavesSat } = require("./clavesSat");
```

Agregar la ruta (junto a las demás rutas de catálogos, ej. cerca de `/api/categorias`):

```js
app.get("/api/sat/claves", requiereLogin, (req, res) => {
  res.json(buscarClavesSat(req.query.q, req.query.pagina));
});
```

- [ ] **Step 9: Correr toda la suite**

Run: `cd backend && node --test`
Expected: PASS

- [ ] **Step 10: Commit**

Nota: `datos.sqlite` normalmente no se versiona (datos de runtime); confirmar si `.gitignore` ya lo excluye antes de este commit — si es así, el commit solo versiona el código, y **quien despliegue a Render deberá correr `node backend/scripts/importarClavesSat.js` una vez en el servidor** (o incluir el paso en el build) para poblar la tabla ahí también.

```bash
git add backend/clavesSat.js backend/clavesSat.test.js backend/scripts/importarClavesSat.js backend/package.json backend/package-lock.json
git commit -m "feat: catalogo de Claves SAT importado a SQLite, con busqueda"
```

---

## Task 5: Parser de facturas CFDI 4.0 (XML)

**Files:**
- Modify: `backend/package.json` (dependencia `fast-xml-parser`)
- Create: `backend/cfdi.js`
- Test: `backend/cfdi.test.js` (nuevo)

**Interfaces:**
- Produces: `parsearFacturaXML(xmlTexto)` exportado de `backend/cfdi.js`, devuelve `{ emisor: {rfc, nombre}, folioFiscal, fecha, conceptos: [{clave_sat, no_identificacion, descripcion, cantidad, valor_unitario, importe, aplica_iva, tasa_iva}] }` — usado por Task 6 (endpoint de importación).

- [ ] **Step 1: Agregar la dependencia**

Run: `cd backend && npm install fast-xml-parser`

- [ ] **Step 2: Escribir el test que falla, con un CFDI 4.0 de muestra**

Crear `backend/cfdi.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { parsearFacturaXML } = require("./cfdi");

const CFDI_MUESTRA = `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital"
  Version="4.0" Fecha="2026-07-01T12:00:00" SubTotal="13981.032" Total="16217.997" Moneda="MXN" TipoDeComprobante="I">
  <cfdi:Emisor Rfc="DINX800101ABC" Nombre="Distribuidora del Norte SA de CV" RegimenFiscal="601" />
  <cfdi:Receptor Rfc="UNI010101XXX" Nombre="Unisound" DomicilioFiscalReceptor="29000" RegimenFiscalReceptor="601" UsoCFDI="G01" />
  <cfdi:Conceptos>
    <cfdi:Concepto ClaveProdServ="52161547" NoIdentificacion="PROV-AMP-40" Cantidad="1" ClaveUnidad="H87" Unidad="Pieza"
      Descripcion="HCF-PRO-40 AMPLIFICADOR DE POTENCIA 4000W RMS" ValorUnitario="13981.032" Importe="13981.032" ObjetoImp="02">
      <cfdi:Impuestos>
        <cfdi:Traslados>
          <cfdi:Traslado Base="13981.032" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="2236.965" />
        </cfdi:Traslados>
      </cfdi:Impuestos>
    </cfdi:Concepto>
  </cfdi:Conceptos>
  <cfdi:Complemento>
    <tfd:TimbreFiscalDigital Version="1.1" UUID="ABCDEF12-3456-7890-ABCD-EF1234567890" FechaTimbrado="2026-07-01T12:05:00" />
  </cfdi:Complemento>
</cfdi:Comprobante>`;

test("parsearFacturaXML extrae el emisor correctamente", () => {
  const resultado = parsearFacturaXML(CFDI_MUESTRA);
  assert.strictEqual(resultado.emisor.rfc, "DINX800101ABC");
  assert.strictEqual(resultado.emisor.nombre, "Distribuidora del Norte SA de CV");
});

test("parsearFacturaXML extrae el folio fiscal (UUID) del timbre", () => {
  const resultado = parsearFacturaXML(CFDI_MUESTRA);
  assert.strictEqual(resultado.folioFiscal, "ABCDEF12-3456-7890-ABCD-EF1234567890");
});

test("parsearFacturaXML extrae un concepto con su IVA", () => {
  const resultado = parsearFacturaXML(CFDI_MUESTRA);
  assert.strictEqual(resultado.conceptos.length, 1);
  const c = resultado.conceptos[0];
  assert.strictEqual(c.clave_sat, "52161547");
  assert.strictEqual(c.no_identificacion, "PROV-AMP-40");
  assert.strictEqual(c.descripcion, "HCF-PRO-40 AMPLIFICADOR DE POTENCIA 4000W RMS");
  assert.strictEqual(c.cantidad, 1);
  assert.strictEqual(c.valor_unitario, 13981.032);
  assert.strictEqual(c.aplica_iva, true);
  assert.strictEqual(c.tasa_iva, 0.16);
});

test("parsearFacturaXML con múltiples conceptos los devuelve todos como arreglo", () => {
  const conDosConceptos = CFDI_MUESTRA.replace(
    "</cfdi:Conceptos>",
    `<cfdi:Concepto ClaveProdServ="52161548" NoIdentificacion="PROV-CAB-1" Cantidad="2" ClaveUnidad="H87" Unidad="Pieza"
      Descripcion="Cable de audio 6m" ValorUnitario="150.00" Importe="300.00" ObjetoImp="02">
      <cfdi:Impuestos><cfdi:Traslados><cfdi:Traslado Base="300.00" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="48.00" /></cfdi:Traslados></cfdi:Impuestos>
    </cfdi:Concepto></cfdi:Conceptos>`
  );
  const resultado = parsearFacturaXML(conDosConceptos);
  assert.strictEqual(resultado.conceptos.length, 2);
  assert.strictEqual(resultado.conceptos[1].descripcion, "Cable de audio 6m");
});

test("parsearFacturaXML rechaza un XML que no es un CFDI", () => {
  assert.throws(() => parsearFacturaXML("<algo>no es factura</algo>"), /no es un CFDI válido/);
});

test("parsearFacturaXML rechaza texto que no es XML", () => {
  assert.throws(() => parsearFacturaXML("esto no es xml para nada {}"), /no se pudo leer como XML/);
});
```

- [ ] **Step 2b: Correr el test para verificar que falla**

Run: `cd backend && node --test cfdi.test.js`
Expected: FAIL — `backend/cfdi.js` no existe.

- [ ] **Step 3: Implementar `backend/cfdi.js`**

```js
/**
 * cfdi.js — Lee facturas CFDI 4.0 (XML) de proveedores y extrae emisor,
 * folio fiscal y conceptos, para precargar una Recepción de Compras.
 * No escribe nada en la base de datos — solo parsea y devuelve datos.
 */

const { XMLParser } = require("fast-xml-parser");

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" });

function comoLista(valor) {
  if (valor === undefined || valor === null) return [];
  return Array.isArray(valor) ? valor : [valor];
}

function parsearFacturaXML(xmlTexto) {
  let doc;
  try {
    doc = parser.parse(xmlTexto);
  } catch (e) {
    throw new Error("El archivo no se pudo leer como XML: " + e.message);
  }

  const comprobante = doc["cfdi:Comprobante"];
  if (!comprobante) throw new Error("El archivo no es un CFDI válido (falta cfdi:Comprobante)");

  const emisorNodo = comprobante["cfdi:Emisor"];
  if (!emisorNodo) throw new Error("El CFDI no tiene información del emisor (cfdi:Emisor)");
  const emisor = { rfc: emisorNodo.Rfc || "", nombre: emisorNodo.Nombre || "" };

  const timbre = comprobante["cfdi:Complemento"]?.["tfd:TimbreFiscalDigital"];
  const folioFiscal = timbre ? timbre.UUID : null;

  const conceptosNodo = comprobante["cfdi:Conceptos"]?.["cfdi:Concepto"];
  const conceptos = comoLista(conceptosNodo).map((c) => {
    const traslados = comoLista(c["cfdi:Impuestos"]?.["cfdi:Traslados"]?.["cfdi:Traslado"]);
    const trasladoIva = traslados.find((t) => t.Impuesto === "002");
    return {
      clave_sat: c.ClaveProdServ || "",
      no_identificacion: c.NoIdentificacion || "",
      descripcion: c.Descripcion || "",
      cantidad: Number(c.Cantidad) || 0,
      valor_unitario: Number(c.ValorUnitario) || 0,
      importe: Number(c.Importe) || 0,
      aplica_iva: !!trasladoIva,
      tasa_iva: trasladoIva ? Number(trasladoIva.TasaOCuota) : 0,
    };
  });

  return {
    emisor,
    folioFiscal,
    fecha: comprobante.Fecha || null,
    conceptos,
  };
}

module.exports = { parsearFacturaXML };
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `cd backend && node --test cfdi.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Correr toda la suite**

Run: `cd backend && node --test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/cfdi.js backend/cfdi.test.js backend/package.json backend/package-lock.json
git commit -m "feat: parser de facturas CFDI 4.0 en XML"
```

---

## Task 6: Endpoint de importación XML + protección contra duplicados

**Files:**
- Modify: `backend/compras.js` (dedupe por `uuid_cfdi` en `crearRecepcion`)
- Modify: `backend/server.js` (nueva ruta)
- Test: `backend/compras.test.js` (agregar caso), `backend/importarXml.test.js` (nuevo, para la ruta)

**Interfaces:**
- Consumes: `parsearFacturaXML` (Task 5).
- Produces: `crearRecepcion` acepta `datos.uuid_cfdi` opcional y rechaza duplicados; `POST /api/compras/importar-xml` devuelve el resultado de `parsearFacturaXML` — usado por Task 9 (pantalla de revisión en el frontend).

- [ ] **Step 1: Escribir el test que falla (dedupe)**

Agregar a `backend/compras.test.js`:

```js
test("crearRecepcion rechaza una factura ya registrada (mismo uuid_cfdi)", () => {
  const DB = conProveedor(construirDBPrueba());
  crearRecepcion(DB, {
    proveedor_id: 1, factura: "A-100", uuid_cfdi: "ABCDEF12-3456-7890-ABCD-EF1234567890",
    renglones: [{ producto_id: 1, cantidad: 5, costo: 40 }],
  }, 6, USUARIO_CEDIS);

  assert.throws(
    () => crearRecepcion(DB, {
      proveedor_id: 1, factura: "A-101", uuid_cfdi: "ABCDEF12-3456-7890-ABCD-EF1234567890",
      renglones: [{ producto_id: 2, cantidad: 1, costo: 10 }],
    }, 6, USUARIO_CEDIS),
    /ya fue registrada/
  );
});

test("crearRecepcion sin uuid_cfdi nunca choca con otras (no exige unicidad si no viene)", () => {
  const DB = conProveedor(construirDBPrueba());
  crearRecepcion(DB, { proveedor_id: 1, renglones: [{ producto_id: 1, cantidad: 5, costo: 40 }] }, 6, USUARIO_CEDIS);
  assert.doesNotThrow(() =>
    crearRecepcion(DB, { proveedor_id: 1, renglones: [{ producto_id: 2, cantidad: 1, costo: 10 }] }, 6, USUARIO_CEDIS)
  );
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `cd backend && node --test compras.test.js`
Expected: el primer test nuevo FAIL (no rechaza el duplicado todavía).

- [ ] **Step 3: Implementar el dedupe en `backend/compras.js`**

Al inicio de `crearRecepcion` (después de validar `proveedor_id` y `renglones`, antes de crear `nuevoId`):

```js
  if (datos.uuid_cfdi) {
    const yaRegistrada = DB.inventario.compras.some((c) => c.uuid_cfdi === datos.uuid_cfdi);
    if (yaRegistrada) throw new Error("Esta factura ya fue registrada anteriormente (folio fiscal duplicado)");
  }
```

Y en la construcción del objeto `compra`, agregar el campo:

```js
  const compra = {
    id: nuevoId,
    proveedor_id,
    factura: datos.factura || "",
    comentario: datos.comentario || "",
    sucursal_id,
    usuario_id: usuario?.id ?? null,
    usuario_nombre: usuario?.nombre || "—",
    fecha: new Date().toISOString(),
    uuid_cfdi: datos.uuid_cfdi || null,
  };
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `cd backend && node --test compras.test.js`
Expected: PASS

- [ ] **Step 5: Escribir el test de la ruta de importación**

Crear `backend/importarXml.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { parsearFacturaXML } = require("./cfdi");

// La ruta HTTP en sí solo envuelve parsearFacturaXML sin lógica adicional;
// se prueba aquí que un error de parseo se puede distinguir para responder 400.
test("un XML inválido lanza un error con mensaje claro (para responder 400 en la ruta)", () => {
  assert.throws(() => parsearFacturaXML("no es xml"), /no se pudo leer como XML/);
});
```

- [ ] **Step 6: Agregar la ruta en `backend/server.js`**

Agregar el `require`:

```js
const { parsearFacturaXML } = require("./cfdi");
```

Agregar la ruta (cerca de las rutas de `/api/compras`):

```js
app.post("/api/compras/importar-xml", requiereLogin, requierePermiso("recibir_compra", resolverPermisosDeRol), (req, res) => {
  try {
    res.json(parsearFacturaXML(req.body.xml));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
```

- [ ] **Step 7: Correr toda la suite**

Run: `cd backend && node --test`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add backend/compras.js backend/compras.test.js backend/importarXml.test.js backend/server.js
git commit -m "feat: importar factura XML (CFDI) y proteger contra duplicados por folio fiscal"
```

---

## Task 7: Pantalla "Artículo" (modal de frontend)

**Files:**
- Create: `src/ArticuloCompra.jsx`

**Interfaces:**
- Consumes: `GET /api/productos/:id/historial-costo` (Task 3), `GET /api/sat/claves?q=&pagina=` (Task 4), `apiFetch` de `src/api.js`.
- Produces: componente `ArticuloCompra({ producto, onCancelar, onAceptar })` donde `onAceptar(renglon)` recibe
  `{ producto_id, cantidad, costo, descuento_pesos, descuento_porcentaje, clave_sat, localizacion, aplicaIva, precios }`
  — usado por Task 8 (`RecepcionCompras.jsx`).

- [ ] **Step 1: Crear el componente**

Crear `src/ArticuloCompra.jsx`:

```jsx
import React, { useState, useEffect, useMemo } from "react";
import { X, Search, Package } from "lucide-react";
import { apiFetch } from "./api";

const inputCls = "w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:border-blue-500";

function Campo({ label, children, className = "" }) {
  return (
    <div className={className}>
      <label className="text-xs text-slate-500 block mb-1">{label}</label>
      {children}
    </div>
  );
}

function calcularTiers(costoNeto, tiers) {
  return tiers.map((t) => ({
    utilidad: t.utilidad,
    precioVenta: Math.round(Number(costoNeto) * (1 + (Number(t.utilidad) || 0) / 100) * 100) / 100,
  }));
}

export default function ArticuloCompra({ producto, renglonExistente, onCancelar, onAceptar }) {
  const [historial, setHistorial] = useState({ ultimo: null, promedio: null });
  const [clave_sat, setClaveSat] = useState(renglonExistente?.clave_sat ?? producto.clave_sat ?? "");
  const [localizacion, setLocalizacion] = useState(renglonExistente?.localizacion ?? producto.localizacion ?? "");
  const [aplicaIva, setAplicaIva] = useState(renglonExistente?.aplicaIva ?? !!producto.iva);
  const [cantidad, setCantidad] = useState(renglonExistente?.cantidad ?? "1");
  const [costo, setCosto] = useState(String(renglonExistente?.costo ?? producto.costo ?? 0));
  const [neto, setNeto] = useState(renglonExistente?.neto ?? !!producto.neto);
  const [descuentoPesos, setDescuentoPesos] = useState(String(renglonExistente?.descuento_pesos ?? 0));
  const [descuentoPorcentaje, setDescuentoPorcentaje] = useState(String(renglonExistente?.descuento_porcentaje ?? 0));
  const [precios, setPrecios] = useState(
    renglonExistente?.precios ?? (Array.isArray(producto.precios) && producto.precios.length === 4
      ? producto.precios
      : [{ utilidad: 0, precioVenta: 0 }, { utilidad: 0, precioVenta: 0 }, { utilidad: 0, precioVenta: 0 }, { utilidad: 0, precioVenta: 0 }])
  );

  const [modalSat, setModalSat] = useState(false);
  const [busquedaSat, setBusquedaSat] = useState("");
  const [resultadosSat, setResultadosSat] = useState([]);
  const [paginaSat, setPaginaSat] = useState(1);
  const [totalSat, setTotalSat] = useState(0);

  useEffect(() => {
    apiFetch(`/productos/${producto.id}/historial-costo`)
      .then((r) => r.json())
      .then(setHistorial)
      .catch(() => {});
  }, [producto.id]);

  useEffect(() => {
    if (!modalSat) return;
    apiFetch(`/sat/claves?q=${encodeURIComponent(busquedaSat)}&pagina=${paginaSat}`)
      .then((r) => r.json())
      .then((d) => { setResultadosSat(d.resultados || []); setTotalSat(d.total || 0); })
      .catch(() => {});
  }, [modalSat, busquedaSat, paginaSat]);

  const costoNumero = Number(costo) || 0;
  const descPesosNumero = Number(descuentoPesos) || 0;
  const descPorcentajeNumero = Number(descuentoPorcentaje) || 0;
  const costoFinal = useMemo(() => {
    return Math.round((costoNumero - descPesosNumero) * (1 - descPorcentajeNumero / 100) * 100) / 100;
  }, [costoNumero, descPesosNumero, descPorcentajeNumero]);
  const costoFinalConIva = Math.round(costoFinal * 1.16 * 100) / 100;
  const cantidadNumero = Number(cantidad) || 0;

  const actualizarTier = (idx, valor) => {
    setPrecios((prev) => {
      const copia = [...prev];
      copia[idx] = { utilidad: valor, precioVenta: Math.round(costoFinal * (1 + (Number(valor) || 0) / 100) * 100) / 100 };
      return copia;
    });
  };

  const actualizarPrecioVenta = (idx, valor) => {
    setPrecios((prev) => {
      const copia = [...prev];
      const precioVenta = Number(valor) || 0;
      const utilidad = costoFinal > 0 ? Math.round(((precioVenta / costoFinal) - 1) * 100 * 1000000) / 1000000 : 0;
      copia[idx] = { utilidad, precioVenta };
      return copia;
    });
  };

  const restaurarMargenesAnteriores = () => {
    const tiersAnteriores = Array.isArray(producto.precios) && producto.precios.length === 4 ? producto.precios : precios;
    setPrecios(calcularTiers(costoFinal, tiersAnteriores));
  };

  const restaurarPreciosAnteriores = () => {
    if (Array.isArray(producto.precios) && producto.precios.length === 4) {
      setPrecios(producto.precios.map((t) => ({ ...t })));
    }
  };

  const aceptar = () => {
    if (!cantidadNumero || cantidadNumero <= 0) return;
    onAceptar({
      producto_id: producto.id,
      cantidad: cantidadNumero,
      costo: costoNumero,
      descuento_pesos: descPesosNumero,
      descuento_porcentaje: descPorcentajeNumero,
      clave_sat,
      localizacion,
      aplicaIva,
      neto,
      precios,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto">
        <div className="border-b border-slate-100 px-4 py-3 flex items-center justify-between sticky top-0 bg-white">
          <h3 className="font-semibold text-sm text-slate-700 flex items-center gap-2"><Package size={16} /> Artículo</h3>
          <button onClick={onCancelar} className="hover:bg-slate-100 rounded-lg p-1.5 text-slate-400"><X size={16} /></button>
        </div>

        <div className="p-5 flex flex-col gap-4">
          <div>
            <div className="text-xs font-semibold text-slate-500 mb-2">Información del Artículo</div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <Campo label="Clave"><div className="text-sm font-medium">{producto.sku}</div></Campo>
              <Campo label="Clave SAT">
                <div className="flex gap-1.5">
                  <input className={inputCls} value={clave_sat} onChange={(e) => setClaveSat(e.target.value)} />
                  <button onClick={() => { setBusquedaSat(""); setPaginaSat(1); setModalSat(true); }} className="bg-emerald-600 hover:bg-emerald-700 text-white rounded px-2" title="Buscar en catálogo SAT">
                    <Search size={14} />
                  </button>
                </div>
              </Campo>
            </div>
            <Campo label="Descripción" className="mb-3"><div className="text-sm">{producto.nombre}</div></Campo>
            <div className="grid grid-cols-3 gap-3">
              <Campo label="Existencia"><div className="text-sm">{producto.existencia ?? 0}</div></Campo>
              <Campo label="Factor"><div className="text-sm">{producto.factor ?? 1}</div></Campo>
              <Campo label="Localización">
                <input className={inputCls} value={localizacion} onChange={(e) => setLocalizacion(e.target.value)} placeholder="ej: Pasillo 3, Anaquel B" />
              </Campo>
            </div>
          </div>

          <div className="border-t border-slate-200 pt-3">
            <div className="text-xs font-semibold text-slate-500 mb-2">Precios (antes de esta compra)</div>
            <div className="grid grid-cols-2 gap-3 text-sm mb-2">
              <div>Último precio de compra: <b>{historial.ultimo ? `$${historial.ultimo.neto.toFixed(2)}` : "—"}</b>
                {historial.ultimo && <span className="text-slate-400"> (${historial.ultimo.conIva.toFixed(2)} con IVA)</span>}
              </div>
              <div>Promedio de compra: <b>{historial.promedio ? `$${historial.promedio.neto.toFixed(2)}` : "—"}</b>
                {historial.promedio && <span className="text-slate-400"> (${historial.promedio.conIva.toFixed(2)} con IVA)</span>}
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2 text-xs">
              {(Array.isArray(producto.precios) ? producto.precios : []).map((t, idx) => (
                <div key={idx} className="border border-slate-200 rounded p-2">
                  <div className="text-slate-400">Margen {idx + 1}: {Number(t.utilidad).toFixed(2)}%</div>
                  <div className="font-semibold">${Number(t.precioVenta).toFixed(2)}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-slate-200 pt-3">
            <div className="text-xs font-semibold text-slate-500 mb-2">Detalle de la Compra</div>
            <label className="flex items-center gap-2 text-sm mb-3">
              <input type="checkbox" checked={aplicaIva} onChange={(e) => setAplicaIva(e.target.checked)} /> Aplica IVA (16%)
            </label>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <Campo label="Cantidad"><input type="number" className={inputCls} value={cantidad} onChange={(e) => setCantidad(e.target.value)} /></Campo>
              <Campo label="Costo (neto)"><input type="number" className={inputCls} value={costo} onChange={(e) => setCosto(e.target.value)} /></Campo>
              <Campo label=" ">
                <label className="flex items-center gap-2 text-sm mt-2">
                  <input type="checkbox" checked={neto} onChange={(e) => setNeto(e.target.checked)} /> Neto
                </label>
              </Campo>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <Campo label="Desc $"><input type="number" className={inputCls} value={descuentoPesos} onChange={(e) => setDescuentoPesos(e.target.value)} /></Campo>
              <Campo label="Desc %"><input type="number" className={inputCls} value={descuentoPorcentaje} onChange={(e) => setDescuentoPorcentaje(e.target.value)} /></Campo>
            </div>
            <div className="text-xs text-slate-500 bg-slate-50 rounded p-2 flex justify-between">
              <span>Precio sin impuestos — unitario: <b>${costoFinal.toFixed(2)}</b> · total línea: <b>${(costoFinal * cantidadNumero).toFixed(2)}</b></span>
              {aplicaIva && <span>Con IVA (unitario): <b>${costoFinalConIva.toFixed(2)}</b></span>}
            </div>
          </div>

          <div className="border-t border-slate-200 pt-3">
            <div className="text-xs font-semibold text-slate-500 mb-2">Precios de Venta (después de esta compra)</div>
            <div className="grid grid-cols-4 gap-3">
              {precios.map((t, idx) => (
                <div key={idx} className="border border-slate-200 rounded-lg p-2.5">
                  <div className="text-[11px] font-semibold text-slate-500 mb-1.5">Precio {idx + 1}</div>
                  <Campo label="% Utilidad"><input type="number" className={inputCls} value={t.utilidad} onChange={(e) => actualizarTier(idx, e.target.value)} /></Campo>
                  <Campo label="Precio venta" className="mt-2"><input type="number" className={inputCls} value={t.precioVenta} onChange={(e) => actualizarPrecioVenta(idx, e.target.value)} /></Campo>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <button onClick={restaurarMargenesAnteriores} className="flex-1 border border-slate-300 text-slate-600 py-2 rounded text-sm font-medium hover:bg-slate-50">−% Márgenes Anteriores</button>
            <button onClick={restaurarPreciosAnteriores} className="flex-1 border border-slate-300 text-slate-600 py-2 rounded text-sm font-medium hover:bg-slate-50">$ Precios Anteriores</button>
          </div>
          <div className="flex gap-2">
            <button onClick={onCancelar} className="flex-1 border border-slate-300 text-slate-600 py-2 rounded font-medium hover:bg-slate-50">Cancelar</button>
            <button onClick={aceptar} className="flex-1 bg-blue-700 hover:bg-blue-800 text-white py-2 rounded font-semibold">Aceptar</button>
          </div>
        </div>

        {modalSat && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4" onClick={() => setModalSat(false)}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="border-b border-slate-100 px-4 py-3 flex items-center justify-between sticky top-0 bg-white">
                <h4 className="font-semibold text-sm text-slate-700">Buscar Clave SAT</h4>
                <button onClick={() => setModalSat(false)} className="hover:bg-slate-100 rounded-lg p-1.5 text-slate-400"><X size={16} /></button>
              </div>
              <div className="p-4">
                <input
                  autoFocus value={busquedaSat}
                  onChange={(e) => { setBusquedaSat(e.target.value); setPaginaSat(1); }}
                  placeholder="Escribe una palabra clave, ej: amplificador"
                  className="w-full border border-slate-300 rounded px-3 py-2 mb-3 focus:outline-none focus:border-blue-500"
                />
                <div className="max-h-80 overflow-y-auto border border-slate-200 rounded">
                  <table className="w-full text-sm">
                    <thead className="bg-[#1a7fe8] text-white sticky top-0">
                      <tr><th className="py-2 px-3 text-left font-medium w-28">Clave</th><th className="py-2 px-3 text-left font-medium">Descripción</th></tr>
                    </thead>
                    <tbody>
                      {resultadosSat.length === 0 && <tr><td colSpan={2} className="text-center text-slate-400 py-8">Sin resultados</td></tr>}
                      {resultadosSat.map((r) => (
                        <tr key={r.clave} onClick={() => { setClaveSat(r.clave); setModalSat(false); }} className="border-b border-slate-100 hover:bg-blue-50 cursor-pointer">
                          <td className="py-2 px-3 font-mono text-xs">{r.clave}</td>
                          <td className="py-2 px-3">{r.descripcion}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="text-center text-xs text-slate-400 mt-2">{totalSat} resultado(s) — página {paginaSat}</div>
                <div className="flex items-center justify-center gap-3 mt-2">
                  <button disabled={paginaSat <= 1} onClick={() => setPaginaSat((p) => p - 1)} className="px-2 py-1 rounded border border-slate-300 disabled:opacity-30 text-xs">Anterior</button>
                  <button disabled={resultadosSat.length < 20} onClick={() => setPaginaSat((p) => p + 1)} className="px-2 py-1 rounded border border-slate-300 disabled:opacity-30 text-xs">Siguiente</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verificar que el frontend compila**

Run: `npm run build`
Expected: `✓ built` sin errores (el componente aún no se usa desde ningún lado, pero debe compilar de forma aislada — Vite solo falla si hay error de sintaxis/import roto).

- [ ] **Step 3: Commit**

```bash
git add src/ArticuloCompra.jsx
git commit -m "feat: pantalla Articulo (modal) para revisar costo/IVA/margenes al comprar"
```

---

## Task 8: Rediseño de `RecepcionCompras.jsx` al estilo POS

**Files:**
- Modify: `src/RecepcionCompras.jsx` (reescritura completa)

**Interfaces:**
- Consumes: `ArticuloCompra` (Task 7), `POST /api/compras` (ya existente, ahora acepta renglones con descuento — Task 2).

- [ ] **Step 1: Reescribir `src/RecepcionCompras.jsx`**

Reemplazar el archivo completo:

```jsx
import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Search, Edit3, Hash, Ban, Percent, FileCode, ClipboardList,
  X, Plus, Minus, Package, Truck, Users, FileMinus, Clock, RotateCcw,
  History, ChevronLeft, ChevronRight
} from "lucide-react";
import { apiFetch } from "./api";
import ArticuloCompra from "./ArticuloCompra";

function BotonBarra({ icono: Icono, etiqueta, atajo, onClick }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center justify-center gap-1 px-3 py-2 min-w-[74px] border-r border-slate-100 hover:bg-blue-50 transition-colors">
      <Icono size={18} className="text-[#1a7fe8]" />
      <span className="text-[10px] font-medium text-slate-500 whitespace-nowrap">{etiqueta}</span>
    </button>
  );
}

function BotonLateral({ icono: Icono, etiqueta, atajo, onClick, color }) {
  return (
    <button onClick={onClick} className="w-full flex flex-col items-center gap-1 py-3 hover:bg-slate-100 border-b border-slate-200 transition-colors">
      <Icono size={22} className={color || "text-slate-600"} />
      <span className="text-[10px] leading-tight text-slate-600 text-center">{etiqueta}<br />({atajo})</span>
    </button>
  );
}

function Modal({ titulo, onCerrar, children, ancho = "max-w-md" }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className={`bg-white rounded-xl shadow-2xl w-full ${ancho} max-h-[92vh] overflow-y-auto`}>
        <div className="border-b border-slate-100 px-4 py-3 flex items-center justify-between sticky top-0 bg-white rounded-t-xl">
          <h3 className="font-semibold text-sm text-slate-700">{titulo}</h3>
          <button onClick={onCerrar} className="hover:bg-slate-100 rounded-lg p-1.5 text-slate-400 hover:text-slate-600 transition-colors"><X size={16} /></button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

const inputCls = "w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:border-blue-500";
const RESULTADOS_POR_PAGINA = 8;

export default function RecepcionCompras({ onVolver, permisos, usuario }) {
  const puede = (clave) => !permisos || permisos.includes(clave);
  const [productos, setProductos] = useState([]);
  const [sucursales, setSucursales] = useState([]);
  const [proveedores, setProveedores] = useState([]);
  const [categorias, setCategorias] = useState([]);
  const [departamentos, setDepartamentos] = useState([]);
  const [recepciones, setRecepciones] = useState([]);
  const [tab, setTab] = useState("nueva"); // "nueva" | "historial"
  const [cargando, setCargando] = useState(true);
  const [aviso, setAviso] = useState(null);

  const [proveedorId, setProveedorId] = useState("");
  const [sucursalOrigenId, setSucursalOrigenId] = useState("");
  const [factura, setFactura] = useState("");
  const [comentario, setComentario] = useState("");
  const [renglones, setRenglones] = useState([]);
  const [filaSeleccionada, setFilaSeleccionada] = useState(null);

  const [codigoInput, setCodigoInput] = useState("");
  const codigoRef = useRef(null);

  // "buscar" | "articulo" | "cantidad" | "descuento" | "espera" | "importarXml"
  const [modal, setModal] = useState(null);
  const [busquedaTexto, setBusquedaTexto] = useState("");
  const [filtroCategoria, setFiltroCategoria] = useState("");
  const [filtroDepartamento, setFiltroDepartamento] = useState("");
  const [paginaBusqueda, setPaginaBusqueda] = useState(1);
  const [productoParaArticulo, setProductoParaArticulo] = useState(null);
  const [valorTemporal, setValorTemporal] = useState("");
  const [enEspera, setEnEspera] = useState([]);

  const mostrarAviso = (t) => { setAviso(t); setTimeout(() => setAviso(null), 2500); };

  const nombreProveedor = (id) => proveedores.find((p) => p.id === id)?.nombre || `Proveedor ${id}`;
  const nombreSucursal = (id) => sucursales.find((s) => s.id === id)?.nombre || `Sucursal ${id}`;
  const productoDe = (id) => productos.find((p) => p.id === id);

  const origenEfectivo = usuario?.ver_todas ? (sucursalOrigenId || "todas") : usuario?.sucursal_id;

  const cargarProductos = useCallback(async (origen) => {
    try {
      const r = await apiFetch(`/productos?sucursal_id=${origen || "todas"}`);
      setProductos(await r.json());
    } catch { /* silencioso */ }
  }, []);

  const cargarTodo = useCallback(async () => {
    setCargando(true);
    try {
      const [rSuc, rProv, rCat, rDep, rComp] = await Promise.all([
        apiFetch(`/sucursales`), apiFetch(`/proveedores`), apiFetch(`/categorias`), apiFetch(`/departamentos`), apiFetch(`/compras`)
      ]);
      setSucursales(await rSuc.json());
      setProveedores(await rProv.json());
      setCategorias(await rCat.json());
      setDepartamentos(await rDep.json());
      setRecepciones(await rComp.json());
    } catch (e) {
      mostrarAviso("❌ No se pudo conectar con el backend");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargarTodo(); }, [cargarTodo]);
  useEffect(() => { cargarProductos(origenEfectivo); }, [origenEfectivo, cargarProductos]);
  useEffect(() => { codigoRef.current?.focus(); }, [modal]);

  const crearProveedorRapido = async () => {
    const nombre = prompt("Nombre del nuevo proveedor:");
    if (!nombre || !nombre.trim()) return;
    const rfc = prompt("RFC (opcional):") || "";
    try {
      const r = await apiFetch(`/proveedores`, { method: "POST", body: JSON.stringify({ nombre, rfc }) });
      const nuevo = await r.json();
      if (!r.ok) throw new Error(nuevo.error);
      setProveedores((prev) => [...prev, nuevo]);
      setProveedorId(nuevo.id);
    } catch (e) { mostrarAviso("❌ " + e.message); }
  };

  const abrirArticuloParaProducto = (producto) => {
    const existente = renglones.find((r) => r.producto_id === producto.id);
    setProductoParaArticulo({ producto, existente });
    setModal("articulo");
    setBusquedaTexto("");
  };

  const aceptarArticulo = (renglon) => {
    setRenglones((prev) => {
      const idx = prev.findIndex((r) => r.producto_id === renglon.producto_id);
      if (idx >= 0) {
        const copia = [...prev];
        copia[idx] = renglon;
        return copia;
      }
      return [...prev, renglon];
    });
    setModal(null);
    setProductoParaArticulo(null);
  };

  const buscarPorCodigo = () => {
    const texto = codigoInput.trim();
    if (!texto) return;
    const encontrado = productos.find((p) => p.sku.toLowerCase() === texto.toLowerCase() || (p.codigo || "") === texto);
    if (encontrado) {
      abrirArticuloParaProducto(encontrado);
      setCodigoInput("");
    } else {
      setBusquedaTexto(texto);
      setModal("buscar");
    }
  };

  const quitarRenglon = (producto_id) => {
    setRenglones((prev) => prev.filter((r) => r.producto_id !== producto_id));
    setFilaSeleccionada(null);
  };

  const actualizarCantidadRapida = (producto_id, delta) => {
    setRenglones((prev) => prev.map((r) => r.producto_id === producto_id ? { ...r, cantidad: Math.max(1, Number(r.cantidad) + delta) } : r));
  };

  const limpiarFormulario = () => {
    setProveedorId(""); setSucursalOrigenId(""); setFactura(""); setComentario(""); setRenglones([]); setFilaSeleccionada(null);
  };

  const registrarRecepcion = async () => {
    if (usuario?.ver_todas && !sucursalOrigenId) return mostrarAviso("Selecciona la sucursal que recibe");
    if (!proveedorId) return mostrarAviso("Selecciona un proveedor");
    if (renglones.length === 0) return mostrarAviso("Agrega al menos un producto");
    try {
      const payload = {
        proveedor_id: proveedorId,
        factura,
        comentario,
        sucursal_id: sucursalOrigenId,
        renglones: renglones.map((r) => ({
          producto_id: r.producto_id, cantidad: r.cantidad, costo: r.costo,
          descuento_pesos: r.descuento_pesos, descuento_porcentaje: r.descuento_porcentaje,
          clave_sat: r.clave_sat, localizacion: r.localizacion,
          aplicaIva: r.aplicaIva, neto: r.neto, precios: r.precios,
        })),
      };
      const r = await apiFetch(`/compras?sucursal_id=todas`, { method: "POST", body: JSON.stringify(payload) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      mostrarAviso("Recepción registrada");
      limpiarFormulario();
      await Promise.all([cargarTodo(), cargarProductos(origenEfectivo)]);
      setTab("historial");
    } catch (e) {
      mostrarAviso("❌ " + e.message);
    }
  };

  const ponerEnEspera = () => {
    if (renglones.length === 0) return mostrarAviso("No hay nada que poner en espera");
    setEnEspera((prev) => [...prev, { id: Date.now(), proveedorId, factura, comentario, renglones }]);
    limpiarFormulario();
    mostrarAviso("Recepción puesta en espera");
  };

  const recuperarEspera = (item) => {
    setProveedorId(item.proveedorId); setFactura(item.factura); setComentario(item.comentario); setRenglones(item.renglones);
    setEnEspera((prev) => prev.filter((e) => e.id !== item.id));
    setModal(null);
  };

  // ---------- Atajos de teclado ----------
  useEffect(() => {
    const manejador = (e) => {
      const dentroDeModal = modal !== null;
      if (e.key === "F2" && !dentroDeModal) { e.preventDefault(); setBusquedaTexto(""); setModal("buscar"); }
      else if (e.key === "F4" && !dentroDeModal && filaSeleccionada !== null) {
        e.preventDefault();
        const r = renglones[filaSeleccionada];
        const producto = productoDe(r.producto_id);
        if (producto) abrirArticuloParaProducto(producto);
      }
      else if (e.key === "F5" && !dentroDeModal && filaSeleccionada !== null) {
        e.preventDefault();
        setValorTemporal(String(renglones[filaSeleccionada].cantidad)); setModal("cantidad");
      }
      else if (e.key === "F6" && !dentroDeModal && filaSeleccionada !== null) {
        e.preventDefault(); quitarRenglon(renglones[filaSeleccionada].producto_id);
      }
      else if (e.key === "F7" && !dentroDeModal && filaSeleccionada !== null) {
        e.preventDefault();
        setValorTemporal(String(renglones[filaSeleccionada].descuento_porcentaje || 0)); setModal("descuento");
      }
      else if (e.key === "F8" && !dentroDeModal) { e.preventDefault(); setModal("importarXml"); }
      else if (e.key === "F10") { e.preventDefault(); mostrarAviso("Pedido — próximamente"); }
      else if (e.key === "Escape") { if (dentroDeModal) setModal(null); else registrarRecepcion(); }
      else if (e.altKey && !dentroDeModal) {
        const k = e.key.toLowerCase();
        if (k === "d") { e.preventDefault(); mostrarAviso("Tipo de documento — próximamente"); }
        else if (k === "p") { e.preventDefault(); document.getElementById("select-proveedor")?.focus(); }
        else if (k === "n") { e.preventDefault(); mostrarAviso("Devolución a proveedor — próximamente"); }
        else if (k === "e") { e.preventDefault(); ponerEnEspera(); }
        else if (k === "r") { e.preventDefault(); setModal("espera"); }
      }
    };
    window.addEventListener("keydown", manejador);
    return () => window.removeEventListener("keydown", manejador);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modal, filaSeleccionada, renglones, productos]);

  const productosFiltrados = useMemo(() => {
    let lista = productos.filter(
      (p) => p.nombre.toLowerCase().includes(busquedaTexto.toLowerCase()) ||
        p.sku.toLowerCase().includes(busquedaTexto.toLowerCase()) ||
        (p.codigo || "").includes(busquedaTexto)
    );
    if (filtroCategoria) lista = lista.filter((p) => String(p.categoria_id) === filtroCategoria);
    if (filtroDepartamento) lista = lista.filter((p) => String(p.departamento_id) === filtroDepartamento);
    return lista;
  }, [productos, busquedaTexto, filtroCategoria, filtroDepartamento]);

  const totalPaginas = Math.max(1, Math.ceil(productosFiltrados.length / RESULTADOS_POR_PAGINA));
  const productosPagina = productosFiltrados.slice((paginaBusqueda - 1) * RESULTADOS_POR_PAGINA, paginaBusqueda * RESULTADOS_POR_PAGINA);

  const totalDescuento = renglones.reduce((acc, r) => acc + (Number(r.descuento_pesos) || 0) * r.cantidad + (r.costo * r.cantidad * (Number(r.descuento_porcentaje) || 0) / 100), 0);
  const totalImporte = renglones.reduce((acc, r) => {
    const costoFinal = Math.round((r.costo - (r.descuento_pesos || 0)) * (1 - (r.descuento_porcentaje || 0) / 100) * 100) / 100;
    return acc + costoFinal * r.cantidad;
  }, 0);

  return (
    <div className="w-full h-full flex flex-col bg-slate-50 text-slate-800 font-sans text-sm select-none">
      <div className="bg-white border-b border-slate-100 flex items-center justify-between shrink-0 px-2">
        <div className="flex">
          <button onClick={() => setTab("nueva")} className={`px-4 py-2.5 text-xs font-medium border-b-2 ${tab === "nueva" ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500"}`}>
            <Truck size={14} className="inline mr-1.5 -mt-0.5" /> Compras (F1)
          </button>
          <button onClick={() => setTab("historial")} className={`px-4 py-2.5 text-xs font-medium border-b-2 ${tab === "historial" ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500"}`}>
            <History size={14} className="inline mr-1.5 -mt-0.5" /> Historial ({recepciones.length})
          </button>
        </div>
      </div>

      {tab === "nueva" ? (
        <>
          <div className="bg-white border-b border-slate-100 flex overflow-x-auto shrink-0">
            <BotonBarra icono={Search} etiqueta="Buscar" atajo="F2" onClick={() => { setBusquedaTexto(""); setModal("buscar"); }} />
            <BotonBarra icono={Edit3} etiqueta="Editar" atajo="F4" onClick={() => {
              if (filaSeleccionada === null) return mostrarAviso("Selecciona una fila primero");
              const producto = productoDe(renglones[filaSeleccionada].producto_id);
              if (producto) abrirArticuloParaProducto(producto);
            }} />
            <BotonBarra icono={Hash} etiqueta="Cantidad" atajo="F5" onClick={() => {
              if (filaSeleccionada === null) return mostrarAviso("Selecciona una fila primero");
              setValorTemporal(String(renglones[filaSeleccionada].cantidad)); setModal("cantidad");
            }} />
            <BotonBarra icono={Ban} etiqueta="Remover" atajo="F6" onClick={() => {
              if (filaSeleccionada === null) return mostrarAviso("Selecciona una fila primero");
              quitarRenglon(renglones[filaSeleccionada].producto_id);
            }} />
            <BotonBarra icono={Percent} etiqueta="Desc." atajo="F7" onClick={() => {
              if (filaSeleccionada === null) return mostrarAviso("Selecciona una fila primero");
              setValorTemporal(String(renglones[filaSeleccionada].descuento_porcentaje || 0)); setModal("descuento");
            }} />
            <BotonBarra icono={FileCode} etiqueta="Imp. XML" atajo="F8" onClick={() => setModal("importarXml")} />
            <BotonBarra icono={ClipboardList} etiqueta="Pedido" atajo="F10" onClick={() => mostrarAviso("Pedido — próximamente")} />
          </div>

          <div className="flex flex-1 min-h-0">
            <div className="w-24 bg-white border-r border-slate-300 flex flex-col shrink-0 overflow-y-auto">
              <button onClick={registrarRecepcion} className="flex flex-col items-center gap-1 py-4 border-b border-slate-200 hover:bg-emerald-50">
                <div className="bg-emerald-600 text-white rounded-full w-9 h-9 flex items-center justify-center font-bold text-xs">OK</div>
                <span className="text-[10px] text-slate-600">Cerrar<br />(ESC)</span>
              </button>
              <BotonLateral icono={Users} etiqueta="Prov." atajo="Alt+P" color="text-blue-600" onClick={() => document.getElementById("select-proveedor")?.focus()} />
              <BotonLateral icono={Package} etiqueta="Doc" atajo="Alt+D" color="text-slate-400" onClick={() => mostrarAviso("Tipo de documento — próximamente")} />
              <BotonLateral icono={FileMinus} etiqueta="Dev Pro" atajo="Alt+N" color="text-red-400" onClick={() => mostrarAviso("Devolución a proveedor — próximamente")} />
              <BotonLateral icono={Clock} etiqueta="Espera" atajo="Alt+E" color="text-slate-500" onClick={ponerEnEspera} />
              <BotonLateral icono={RotateCcw} etiqueta="Rec." atajo="Alt+R" color="text-blue-500" onClick={() => setModal("espera")} />
            </div>

            <div className="flex-1 flex flex-col min-w-0">
              <div className="p-3 border-b border-slate-200 bg-white">
                <div className="flex gap-2 items-center mb-2">
                  <Hash size={16} className="text-slate-400" />
                  <input
                    ref={codigoRef} value={codigoInput} onChange={(e) => setCodigoInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && buscarPorCodigo()}
                    placeholder="Escanea o escribe una clave y presiona Enter"
                    className="flex-1 border border-slate-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
                  />
                  <label className="text-xs text-slate-500 flex items-center gap-1.5 border border-slate-300 rounded px-2 py-1.5">Neto <input type="checkbox" disabled className="opacity-50" /></label>
                  <span className="text-xs text-slate-500 border border-slate-300 rounded px-2 py-1.5 bg-slate-50">MXN</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Campo label="Proveedor">
                    <div className="flex gap-1.5">
                      <select id="select-proveedor" className={inputCls} value={proveedorId} onChange={(e) => setProveedorId(e.target.value)}>
                        <option value="">Selecciona...</option>
                        {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                      </select>
                      <button onClick={crearProveedorRapido} className="bg-emerald-600 hover:bg-emerald-700 text-white rounded px-2" title="Nuevo proveedor"><Plus size={14} /></button>
                    </div>
                  </Campo>
                  <Campo label="Factura / remisión">
                    <input className={inputCls} value={factura} onChange={(e) => setFactura(e.target.value)} placeholder="ej: A-1024" />
                  </Campo>
                </div>
                {puede("ver_todas_las_sucursales") && (
                  <div className="mt-2">
                    <Campo label="Sucursal que recibe">
                      <select className={inputCls} value={sucursalOrigenId} onChange={(e) => setSucursalOrigenId(e.target.value)}>
                        <option value="">Selecciona...</option>
                        {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                      </select>
                    </Campo>
                  </div>
                )}
              </div>

              <div className="flex-1 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[#1a7fe8] text-white sticky top-0">
                    <tr>
                      <th className="py-2 px-2 text-left font-medium">Cant</th>
                      <th className="py-2 px-2 text-left font-medium">Descripción</th>
                      <th className="py-2 px-2 text-center font-medium w-16">Factor</th>
                      <th className="py-2 px-2 text-center font-medium w-16">Exist.</th>
                      <th className="py-2 px-2 text-right font-medium w-24">$ Desc</th>
                      <th className="py-2 px-2 text-right font-medium w-24">Precio U.</th>
                      <th className="py-2 px-2 text-right font-medium w-28">Importe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {renglones.length === 0 && (
                      <tr><td colSpan={7} className="text-center text-slate-400 py-16">Sin productos — presiona F2 o escanea un código para agregar</td></tr>
                    )}
                    {renglones.map((r, idx) => {
                      const producto = productoDe(r.producto_id);
                      const costoFinal = Math.round((r.costo - (r.descuento_pesos || 0)) * (1 - (r.descuento_porcentaje || 0) / 100) * 100) / 100;
                      const importe = costoFinal * r.cantidad;
                      const seleccionada = filaSeleccionada === idx;
                      return (
                        <tr key={r.producto_id} onClick={() => setFilaSeleccionada(idx)} className={`border-b border-slate-100 cursor-pointer ${seleccionada ? "bg-blue-50" : "hover:bg-slate-50"}`}>
                          <td className="py-2 px-2">
                            <div className="flex items-center gap-1">
                              <button onClick={(e) => { e.stopPropagation(); actualizarCantidadRapida(r.producto_id, -1); }} className="text-slate-400 hover:text-slate-700"><Minus size={13} /></button>
                              <span className="w-8 text-center">{r.cantidad}</span>
                              <button onClick={(e) => { e.stopPropagation(); actualizarCantidadRapida(r.producto_id, 1); }} className="text-slate-400 hover:text-slate-700"><Plus size={13} /></button>
                            </div>
                          </td>
                          <td className="py-2 px-2">{producto ? producto.nombre : `Producto ${r.producto_id}`}</td>
                          <td className="py-2 px-2 text-center text-slate-500">{producto?.factor ?? 1}</td>
                          <td className="py-2 px-2 text-center text-slate-500">{producto?.existencia ?? "—"}</td>
                          <td className="py-2 px-2 text-right text-slate-500">{r.descuento_pesos ? `$${Number(r.descuento_pesos).toFixed(2)}` : r.descuento_porcentaje ? `${r.descuento_porcentaje}%` : "-"}</td>
                          <td className="py-2 px-2 text-right">${costoFinal.toFixed(2)}</td>
                          <td className="py-2 px-2 text-right font-medium">${importe.toFixed(2)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="bg-slate-50 border-t border-slate-100 px-4 py-2 flex items-center justify-between text-xs shrink-0 text-slate-600">
                <span className="text-red-400">Devoluciones Pro: <b>$0.00</b></span>
                <span className="text-red-400">Descuento: <b>${totalDescuento.toFixed(2)}</b></span>
              </div>
              <div className="px-4 py-3 flex items-center justify-end gap-3 shrink-0 border-t border-slate-100" style={{ background: "linear-gradient(90deg, #1262b8 0%, #1a7fe8 100%)" }}>
                <span className="text-sm text-blue-100">Total:</span>
                <span className="text-2xl font-bold text-white">${totalImporte.toFixed(2)} MXN</span>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="flex-1 overflow-y-auto p-5">
          <table className="w-full text-sm bg-white border border-slate-200 rounded-lg overflow-hidden">
            <thead className="bg-[#1a7fe8] text-white">
              <tr>
                <th className="py-2 px-3 text-left font-medium">Proveedor</th>
                <th className="py-2 px-3 text-left font-medium">Factura</th>
                <th className="py-2 px-3 text-left font-medium">Sucursal</th>
                <th className="py-2 px-3 text-center font-medium">Productos</th>
                <th className="py-2 px-3 text-left font-medium">Fecha</th>
              </tr>
            </thead>
            <tbody>
              {recepciones.length === 0 && (
                <tr><td colSpan={5} className="text-center text-slate-400 py-10">Sin recepciones registradas</td></tr>
              )}
              {recepciones.map((c) => (
                <tr key={c.id} className="border-b border-slate-100">
                  <td className="py-2 px-3">{nombreProveedor(c.proveedor_id)}</td>
                  <td className="py-2 px-3">{c.factura || "—"}</td>
                  <td className="py-2 px-3">{nombreSucursal(c.sucursal_id)}</td>
                  <td className="py-2 px-3 text-center">{c.renglones.length}</td>
                  <td className="py-2 px-3 text-slate-500">{new Date(c.fecha).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {aviso && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-sm px-4 py-2 rounded-full shadow-lg z-[60]">{aviso}</div>
      )}

      {modal === "buscar" && (
        <Modal titulo="Buscar producto (F2)" onCerrar={() => setModal(null)} ancho="max-w-3xl">
          <input
            autoFocus value={busquedaTexto}
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
          </div>
          <div className="max-h-96 overflow-y-auto border border-slate-200 rounded">
            <table className="w-full text-sm">
              <thead className="bg-[#1a7fe8] text-white sticky top-0">
                <tr>
                  <th className="py-2 px-3 text-left font-medium">Clave / Descripción</th>
                  <th className="py-2 px-3 text-center font-medium w-20">Exist.</th>
                  <th className="py-2 px-3 text-right font-medium w-24">Costo</th>
                </tr>
              </thead>
              <tbody>
                {productosPagina.length === 0 && (
                  <tr><td colSpan={3} className="text-center text-slate-400 py-10">Sin resultados</td></tr>
                )}
                {productosPagina.map((p) => (
                  <tr key={p.id} onClick={() => abrirArticuloParaProducto(p)} className="border-b border-slate-100 hover:bg-blue-50 cursor-pointer">
                    <td className="py-2 px-3">
                      <div className="text-[11px] text-slate-400">{p.sku}</div>
                      <div className="font-medium">{p.nombre}</div>
                    </td>
                    <td className="py-2 px-3 text-center text-slate-600">{p.existencia}</td>
                    <td className="py-2 px-3 text-right font-semibold text-blue-700">${Number(p.costo || 0).toFixed(2)}</td>
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

      {modal === "articulo" && productoParaArticulo && (
        <ArticuloCompra
          producto={productoParaArticulo.producto}
          renglonExistente={productoParaArticulo.existente}
          onCancelar={() => { setModal(null); setProductoParaArticulo(null); }}
          onAceptar={aceptarArticulo}
        />
      )}

      {modal === "cantidad" && filaSeleccionada !== null && (
        <Modal titulo="Cambiar cantidad (F5)" onCerrar={() => setModal(null)}>
          <input
            autoFocus type="number" value={valorTemporal} onChange={(e) => setValorTemporal(e.target.value)}
            className="w-full border border-slate-300 rounded px-3 py-2 text-lg text-right mb-4 focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={() => {
              const producto_id = renglones[filaSeleccionada].producto_id;
              const nueva = Number(valorTemporal) || 1;
              setRenglones((prev) => prev.map((r) => r.producto_id === producto_id ? { ...r, cantidad: Math.max(1, nueva) } : r));
              setModal(null);
            }}
            className="w-full bg-[#1a7fe8] hover:bg-[#1262b8] text-white py-2 rounded-lg font-medium"
          >Aplicar</button>
        </Modal>
      )}

      {modal === "descuento" && filaSeleccionada !== null && (
        <Modal titulo="Cambiar descuento % (F7)" onCerrar={() => setModal(null)}>
          <div className="flex items-center gap-2 mb-4">
            <input autoFocus type="number" value={valorTemporal} onChange={(e) => setValorTemporal(e.target.value)} className="flex-1 border border-slate-300 rounded px-3 py-2 text-lg text-right focus:outline-none focus:border-blue-500" />
            <span className="text-lg text-slate-500">%</span>
          </div>
          <button
            onClick={() => {
              const producto_id = renglones[filaSeleccionada].producto_id;
              const nuevo = Math.min(100, Math.max(0, Number(valorTemporal) || 0));
              setRenglones((prev) => prev.map((r) => r.producto_id === producto_id ? { ...r, descuento_porcentaje: nuevo } : r));
              setModal(null);
            }}
            className="w-full bg-[#1a7fe8] hover:bg-[#1262b8] text-white py-2 rounded-lg font-medium"
          >Aplicar</button>
        </Modal>
      )}

      {modal === "espera" && (
        <Modal titulo="Recepciones en espera (Alt+R)" onCerrar={() => setModal(null)}>
          {enEspera.length === 0 && <p className="text-slate-400 text-center py-8">No hay recepciones en espera</p>}
          <div className="divide-y divide-slate-100">
            {enEspera.map((item) => (
              <button key={item.id} onClick={() => recuperarEspera(item)} className="w-full text-left py-2.5 px-2 hover:bg-slate-50 flex justify-between items-center">
                <div>
                  <div className="font-medium">{nombreProveedor(item.proveedorId) || "Sin proveedor"} — {item.factura || "s/factura"}</div>
                  <div className="text-xs text-slate-400">{item.renglones.length} productos</div>
                </div>
              </button>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

function Campo({ label, children }) {
  return (
    <div>
      <label className="text-xs text-slate-500 block mb-1">{label}</label>
      {children}
    </div>
  );
}
```

(La pantalla de importar XML (`modal === "importarXml"`) se agrega en la Task 9 — este archivo, tal cual queda aquí, ya compila y funciona sin ella; el botón F8 abre el modal pero no muestra nada todavía hasta la Task 9.)

- [ ] **Step 2: Verificar que compila**

Run: `npm run build`
Expected: `✓ built` sin errores.

- [ ] **Step 3: Verificación manual en navegador**

Usar el skill `/run` o levantar manualmente backend (`cd backend && npm start`) y frontend (`npm run dev`), iniciar sesión, entrar a Recepción de Compras, y verificar:
- El código de barras/clave agrega directo si el producto existe.
- F2 abre el buscador; al elegir un producto se abre la pantalla Artículo.
- Aceptar en Artículo agrega la fila a la tabla con el costo ya con descuento aplicado.
- F4/F5/F6/F7 funcionan sobre la fila seleccionada.
- "Cerrar (ESC)" registra la recepción.

- [ ] **Step 4: Commit**

```bash
git add src/RecepcionCompras.jsx
git commit -m "feat: rediseno de Recepcion de Compras al estilo POS (barra F2-F10, sidebar, ticket)"
```

---

## Task 9: Importar factura XML — pantalla de revisión

**Files:**
- Modify: `src/RecepcionCompras.jsx` (agregar el modal `importarXml`)

**Interfaces:**
- Consumes: `POST /api/compras/importar-xml` (Task 6).

- [ ] **Step 1: Agregar el estado y las funciones de importación**

En `src/RecepcionCompras.jsx`, agregar cerca de los demás `useState` (después de `enEspera`):

```jsx
  const [xmlParseado, setXmlParseado] = useState(null); // resultado de importar-xml
  const [matchesXml, setMatchesXml] = useState({}); // { [indiceConcepto]: producto_id | null }
  const [cargandoXml, setCargandoXml] = useState(false);
```

Agregar la función de carga de archivo (junto a `crearProveedorRapido`):

```jsx
  const leerArchivoXml = (archivo) => {
    setCargandoXml(true);
    const lector = new FileReader();
    lector.onload = async (e) => {
      try {
        const r = await apiFetch(`/compras/importar-xml`, { method: "POST", body: JSON.stringify({ xml: e.target.result }) });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        setXmlParseado(data);
        const sugeridos = {};
        data.conceptos.forEach((c, idx) => {
          const match = productos.find((p) => p.clave_sat && c.clave_sat && p.clave_sat === c.clave_sat);
          sugeridos[idx] = match ? match.id : null;
        });
        setMatchesXml(sugeridos);
        const proveedorExistente = proveedores.find((p) => p.rfc && p.rfc === data.emisor.rfc);
        if (proveedorExistente) setProveedorId(proveedorExistente.id);
      } catch (err) {
        mostrarAviso("❌ " + err.message);
        setModal(null);
      } finally {
        setCargandoXml(false);
      }
    };
    lector.readAsText(archivo);
  };

  const confirmarImportacionXml = () => {
    const nuevos = xmlParseado.conceptos
      .map((c, idx) => ({ concepto: c, producto_id: matchesXml[idx] }))
      .filter((x) => x.producto_id);
    if (nuevos.length === 0) return mostrarAviso("Vincula al menos un producto antes de continuar");

    setRenglones((prev) => {
      const copia = [...prev];
      nuevos.forEach(({ concepto, producto_id }) => {
        const idx = copia.findIndex((r) => r.producto_id === producto_id);
        const renglon = {
          producto_id,
          cantidad: concepto.cantidad,
          costo: concepto.valor_unitario,
          descuento_pesos: 0,
          descuento_porcentaje: 0,
          clave_sat: concepto.clave_sat,
          localizacion: productoDe(producto_id)?.localizacion || "",
          aplicaIva: concepto.aplica_iva,
          neto: true,
          precios: productoDe(producto_id)?.precios,
        };
        if (idx >= 0) copia[idx] = renglon; else copia.push(renglon);
      });
      return copia;
    });
    mostrarAviso(`${nuevos.length} producto(s) agregado(s) desde la factura`);
    setXmlParseado(null);
    setMatchesXml({});
    setModal(null);
  };
```

- [ ] **Step 2: Agregar el modal de importación**

Agregar, justo antes del modal `espera` (o después, el orden no importa), dentro del JSX de `RecepcionCompras`:

```jsx
      {modal === "importarXml" && (
        <Modal titulo="Importar factura XML (F8)" onCerrar={() => { setModal(null); setXmlParseado(null); }} ancho="max-w-3xl">
          {!xmlParseado ? (
            <div className="text-center py-10">
              <input
                type="file" accept=".xml"
                onChange={(e) => e.target.files[0] && leerArchivoXml(e.target.files[0])}
                className="mb-3"
              />
              {cargandoXml && <p className="text-slate-400 text-sm">Leyendo factura...</p>}
              <p className="text-xs text-slate-400 mt-2">Selecciona el archivo XML (CFDI 4.0) que te mandó tu proveedor.</p>
            </div>
          ) : (
            <div>
              <div className="bg-slate-50 rounded p-3 mb-3 text-sm">
                <div><b>Proveedor (RFC):</b> {xmlParseado.emisor.rfc} — {xmlParseado.emisor.nombre}</div>
                {!proveedores.some((p) => p.rfc === xmlParseado.emisor.rfc) && (
                  <button onClick={async () => {
                    const r = await apiFetch(`/proveedores`, { method: "POST", body: JSON.stringify({ nombre: xmlParseado.emisor.nombre, rfc: xmlParseado.emisor.rfc }) });
                    const nuevo = await r.json();
                    setProveedores((prev) => [...prev, nuevo]);
                    setProveedorId(nuevo.id);
                  }} className="text-xs text-blue-700 hover:underline mt-1">
                    + Dar de alta este proveedor
                  </button>
                )}
              </div>
              <table className="w-full text-sm border border-slate-200 rounded overflow-hidden mb-3">
                <thead className="bg-[#1a7fe8] text-white">
                  <tr>
                    <th className="py-2 px-2 text-left font-medium">Descripción (factura)</th>
                    <th className="py-2 px-2 text-center font-medium w-16">Cant.</th>
                    <th className="py-2 px-2 text-right font-medium w-24">Costo</th>
                    <th className="py-2 px-2 text-left font-medium">Producto en tu catálogo</th>
                  </tr>
                </thead>
                <tbody>
                  {xmlParseado.conceptos.map((c, idx) => (
                    <tr key={idx} className="border-b border-slate-100">
                      <td className="py-2 px-2">{c.descripcion}<div className="text-[10px] text-slate-400">Clave SAT: {c.clave_sat}</div></td>
                      <td className="py-2 px-2 text-center">{c.cantidad}</td>
                      <td className="py-2 px-2 text-right">${c.valor_unitario.toFixed(2)}</td>
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
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex gap-2">
                <button onClick={() => { setXmlParseado(null); setMatchesXml({}); }} className="flex-1 border border-slate-300 text-slate-600 py-2 rounded font-medium hover:bg-slate-50">Cancelar</button>
                <button onClick={confirmarImportacionXml} className="flex-1 bg-blue-700 hover:bg-blue-800 text-white py-2 rounded font-semibold">Agregar a la recepción</button>
              </div>
            </div>
          )}
        </Modal>
      )}
```

- [ ] **Step 3: Verificar que compila**

Run: `npm run build`
Expected: `✓ built` sin errores.

- [ ] **Step 4: Verificación manual en navegador**

Crear un archivo `.xml` de prueba con el contenido de `CFDI_MUESTRA` del test de Task 5 (guardarlo como `prueba.xml`), y en Recepción de Compras:
- F8 → seleccionar `prueba.xml` → debe mostrar el concepto "HCF-PRO-40 AMPLIFICADOR..." con cantidad 1 y costo $13,981.03.
- Vincular a un producto existente del catálogo de prueba.
- "Agregar a la recepción" → debe aparecer como fila en la tabla.
- Intentar importar el mismo XML dos veces tras registrar la recepción → debe rechazar con "ya fue registrada" (verificar en Network/consola que la respuesta de `/api/compras` sea 400 con ese mensaje, ya que el UUID viaja solo si se conecta `uuid_cfdi` al payload — ver nota abajo).

**Nota para quien implemente:** el payload de `registrarRecepcion` (Task 8) no incluye todavía `uuid_cfdi`; agregar `uuid_cfdi: xmlParseado?.folioFiscal` al payload de `POST /api/compras` cuando la recepción actual provino de una importación XML (guardar `xmlParseado.folioFiscal` en un estado que sobreviva hasta el registro, o agregarlo directamente al objeto de la recepción al confirmar la importación). Implementación sugerida: agregar `const [uuidCfdiActual, setUuidCfdiActual] = useState(null);`, asignarlo en `confirmarImportacionXml` (`setUuidCfdiActual(xmlParseado.folioFiscal)`), incluirlo en el payload de `registrarRecepcion` (`uuid_cfdi: uuidCfdiActual`), y limpiarlo en `limpiarFormulario` (`setUuidCfdiActual(null)`).

- [ ] **Step 5: Implementar la nota anterior (uuid_cfdi de punta a punta)**

Agregar el estado (junto a `xmlParseado`):

```jsx
  const [uuidCfdiActual, setUuidCfdiActual] = useState(null);
```

En `confirmarImportacionXml`, después de `setRenglones(...)`:

```jsx
    setUuidCfdiActual(xmlParseado.folioFiscal);
```

En `registrarRecepcion`, agregar al `payload`:

```jsx
      const payload = {
        proveedor_id: proveedorId,
        factura,
        comentario,
        sucursal_id: sucursalOrigenId,
        uuid_cfdi: uuidCfdiActual,
        renglones: renglones.map((r) => ({
          producto_id: r.producto_id, cantidad: r.cantidad, costo: r.costo,
          descuento_pesos: r.descuento_pesos, descuento_porcentaje: r.descuento_porcentaje,
          clave_sat: r.clave_sat, localizacion: r.localizacion,
          aplicaIva: r.aplicaIva, neto: r.neto, precios: r.precios,
        })),
      };
```

En `limpiarFormulario`, agregar:

```jsx
  const limpiarFormulario = () => {
    setProveedorId(""); setSucursalOrigenId(""); setFactura(""); setComentario(""); setRenglones([]); setFilaSeleccionada(null);
    setUuidCfdiActual(null);
  };
```

- [ ] **Step 6: Repetir la verificación manual del Step 4**

Confirmar que ahora sí, al intentar registrar dos recepciones con el mismo XML importado, la segunda es rechazada con el mensaje "Esta factura ya fue registrada anteriormente".

- [ ] **Step 7: Commit**

```bash
git add src/RecepcionCompras.jsx
git commit -m "feat: pantalla de revision para importar factura XML en Recepcion de Compras"
```

---

## Verificación final de todo el conjunto

- [ ] **Correr toda la suite de backend**

Run: `cd backend && node --test`
Expected: PASS (todos los tests, sin regresiones)

- [ ] **Build de frontend**

Run: `npm run build`
Expected: `✓ built` sin errores ni warnings nuevos.

- [ ] **Guardia de arranque de permisos**

Run: `cd backend && node -e "require('./validarPermisos').validarSistemaDePermisos()"`
Expected: imprime `✓ Sistema de permisos validado...` sin lanzar error (esta feature no agrega módulos/permisos nuevos).

- [ ] **Verificación manual completa en navegador** (usar el skill `/verify` o `/run` si está disponible)

Flujo: Recepción de Compras → agregar producto (código o F2) → pantalla Artículo (revisar clave SAT con buscador, costo, descuento, márgenes) → Aceptar → tabla tipo ticket → F4/F5/F6/F7 sobre una fila → Registrar recepción (ESC) → aparece en Historial. Y por separado: F8 → importar un XML de prueba → vincular productos → agregar a la recepción → registrar.
