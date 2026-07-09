# Inventario por tienda + Traspasos entre sucursales — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un producto nuevo aparezca en el inventario de las 5 sucursales desde que se crea (con existencia inicial en la sucursal de quien lo dio de alta y 0 en las demás), y agregar un módulo de Traspasos para mover existencia de una tienda a otra con estado "en tránsito" hasta confirmar recepción.

**Architecture:** Se mantiene el modelo de datos actual (una sola fuente de datos en memoria, `sucursal_id` en cada fila de existencia). `crearProducto` pasa a sembrar una fila de existencia por cada sucursal registrada en `DB.pos.sucursales`. Un módulo nuevo `traspasos.js` gestiona el ciclo de vida `en_transito` → `recibido`, reutilizando `ajustarExistencia` (ya existente) para mover cantidades. Nuevo permiso `realizar_traspasos` sigue la convención de permisos del proyecto.

**Tech Stack:** Node.js + Express (backend, datos en memoria), React + Vite (frontend), pruebas con el runner integrado de Node (`node --test`, sin dependencias nuevas).

## Global Constraints

- **Datos en memoria + SQLite:** no se cambia el modelo de persistencia en este plan.
- **Convención de permisos (regla de oro Unisound):** todo permiso nuevo pasa por `permisosCatalogo.js`. El guardia `validarPermisos.js` DEBE seguir pasando al arrancar. `realizar_traspasos` usa el módulo `inventario` ya existente — no requiere tocar `validarPermisos.js` ni `MODULOS_SISTEMA`.
- **Sin dependencias nuevas:** pruebas con `node --test` (integrado).
- **El backend nunca confía en `sucursal_id` del navegador** salvo para usuarios con `ver_todas_las_sucursales` — mismo principio que el aislamiento por sucursal ya implementado (`backend/auth.js`: `alcanceSucursal`).
- **5 sucursales:** 1=Ocosingo, 2=Yajalón, 3=San Cristóbal, 4=Palenque, 5=MercadoLibre (virtual) — `backend/server.js:95-101`.
- **Se recibe siempre exactamente la cantidad enviada** (no hay recepción parcial); los problemas se anotan como comentario libre, no como ajuste de cantidad.
- **Idioma:** todo el código, comentarios y mensajes en español, siguiendo el estilo de los archivos existentes.
- **Nota post-deploy (no es parte de este plan):** como `sembrarRolesIniciales` solo siembra permisos en una base de datos vacía, el permiso `realizar_traspasos` NO se agrega automáticamente a los roles ya existentes en producción. Victor deberá habilitarlo manualmente desde Roles y Personal para Administrador/Gerente después de este deploy (mismo patrón que pasó con los permisos de MercadoLibre).

---

### Task 1: `crearProducto` siembra existencia en todas las sucursales

**Files:**
- Modify: `backend/productos.js:47-125` (`crearProducto`, `actualizarProducto`)
- Modify: `backend/productos.js:134-155` (`clonarProducto`)
- Modify: `backend/productos.js:191-201` (`module.exports` — sin cambios de nombres, solo referencia)
- Create: `backend/productosSucursales.test.js`

**Interfaces:**
- Consumes: nada nuevo.
- Produces:
  - `crearProducto(DB, datos, sucursalId)` — siembra una fila de existencia por cada sucursal en `DB.pos.sucursales`. La sucursal `sucursalId` (default `1` si es `undefined`/falsy) recibe `existencia_inicial`/`existencia_minima`/`existencia_maxima` de `datos`; las demás quedan en `0`.
  - `actualizarProducto(DB, id, datos, sucursalId)` — el ajuste de `existencia_minima`/`existencia_maxima` ahora aplica a la fila de `sucursalId` (default `1`), no siempre a la sucursal 1.
  - `clonarProducto(DB, id, sucursalId)` — pasa `sucursalId` a `crearProducto` internamente.

- [ ] **Step 1: Escribir las pruebas (fallan primero)**

Crear `backend/productosSucursales.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { crearProducto, actualizarProducto, clonarProducto } = require("./productos");

test("crearProducto siembra existencia en todas las sucursales de DB.pos.sucursales", () => {
  const DB = construirDBPrueba();
  const nuevoId = crearProducto(DB, { descripcion: "Cuerdas de guitarra", existencia_inicial: 20, existencia_minima: 5, existencia_maxima: 50 }, 2).id;
  const filas = DB.inventario.existencias.filter((e) => e.producto_id === nuevoId);
  assert.strictEqual(filas.length, DB.pos.sucursales.length, "debe haber una fila por sucursal");
  const enOrigen = filas.find((e) => e.sucursal_id === 2);
  assert.strictEqual(enOrigen.cantidad_actual, 20);
  assert.strictEqual(enOrigen.cantidad_minima, 5);
  assert.strictEqual(enOrigen.cantidad_maxima, 50);
  const enOtra = filas.find((e) => e.sucursal_id === 1);
  assert.strictEqual(enOtra.cantidad_actual, 0);
  assert.strictEqual(enOtra.cantidad_minima, 0);
});

test("crearProducto sin sucursalId usa la sucursal 1 por defecto (compatibilidad)", () => {
  const DB = construirDBPrueba();
  const nuevoId = crearProducto(DB, { descripcion: "Púas", existencia_inicial: 100 }).id;
  const enSuc1 = DB.inventario.existencias.find((e) => e.producto_id === nuevoId && e.sucursal_id === 1);
  assert.strictEqual(enSuc1.cantidad_actual, 100);
});

test("actualizarProducto ajusta existencia_minima/maxima de la sucursal indicada", () => {
  const DB = construirDBPrueba();
  const nuevoId = crearProducto(DB, { descripcion: "Cuerdas", existencia_inicial: 10 }, 2).id;
  actualizarProducto(DB, nuevoId, { existencia_minima: 3, existencia_maxima: 30 }, 2);
  const fila = DB.inventario.existencias.find((e) => e.producto_id === nuevoId && e.sucursal_id === 2);
  assert.strictEqual(fila.cantidad_minima, 3);
  assert.strictEqual(fila.cantidad_maxima, 30);
  const filaOtraSucursal = DB.inventario.existencias.find((e) => e.producto_id === nuevoId && e.sucursal_id === 1);
  assert.strictEqual(filaOtraSucursal.cantidad_minima, 0, "no debe tocar la sucursal 1");
});

test("clonarProducto siembra la existencia inicial en la sucursal indicada", () => {
  const DB = construirDBPrueba();
  const originalId = crearProducto(DB, { descripcion: "Original", existencia_inicial: 5 }, 1).id;
  const clon = clonarProducto(DB, originalId, 3);
  const filaClonEnSuc3 = DB.inventario.existencias.find((e) => e.producto_id === clon.id && e.sucursal_id === 3);
  assert.strictEqual(filaClonEnSuc3.cantidad_actual, 0, "clonar siempre arranca en 0, aunque sea en la sucursal del que clona");
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd backend && node --test productosSucursales.test.js`
Expected: FAIL — hoy `crearProducto` solo siembra `sucursal_id: 1` (una sola fila), así que `filas.length` no coincide con `DB.pos.sucursales.length` y `actualizarProducto` siempre toca la sucursal 1.

- [ ] **Step 3: Modificar `crearProducto`**

Reemplazar el bloque final de `crearProducto` (`backend/productos.js:79-87`, desde `DB["catalogo-productos"].productos.push(producto);` hasta el `return producto;`):

```js
  DB["catalogo-productos"].productos.push(producto);

  const sucursalOrigen = Number(sucursalId) || 1;
  DB.pos.sucursales.forEach((s) => {
    const esOrigen = s.id === sucursalOrigen;
    DB.inventario.existencias.push({
      producto_id: nuevoId,
      sucursal_id: s.id,
      cantidad_actual: esOrigen ? (Number(datos.existencia_inicial) || 0) : 0,
      cantidad_minima: esOrigen ? (Number(datos.existencia_minima) || 0) : 0,
      cantidad_maxima: esOrigen ? (Number(datos.existencia_maxima) || 0) : 0,
    });
  });
  return producto;
}
```

Y cambiar la firma de la función (`backend/productos.js:47`):

```js
function crearProducto(DB, datos, sucursalId) {
```

- [ ] **Step 4: Modificar `actualizarProducto`**

Cambiar la firma (`backend/productos.js:90`):

```js
function actualizarProducto(DB, id, datos, sucursalId) {
```

Y el bloque de existencia mínima/máxima (`backend/productos.js:117-123`):

```js
  if (datos.existencia_minima !== undefined || datos.existencia_maxima !== undefined) {
    const sucursalObjetivo = Number(sucursalId) || 1;
    const exist = DB.inventario.existencias.find((e) => e.producto_id === Number(id) && e.sucursal_id === sucursalObjetivo);
    if (exist) {
      if (datos.existencia_minima !== undefined) exist.cantidad_minima = Number(datos.existencia_minima);
      if (datos.existencia_maxima !== undefined) exist.cantidad_maxima = Number(datos.existencia_maxima);
    }
  }
  return actualizado;
}
```

- [ ] **Step 5: Modificar `clonarProducto`**

Cambiar la firma y el `return` (`backend/productos.js:134-155`):

```js
function clonarProducto(DB, id, sucursalId) {
  const original = DB["catalogo-productos"].productos.find((p) => p.id === Number(id));
  if (!original) throw new Error("Producto no encontrado");
  return crearProducto(DB, {
    clave: generarClave(),
    clave_alterna: "",
    servicio: original.servicio,
    descripcion: original.nombre + " (copia)",
    categoria_id: original.categoria_id,
    departamento: original.departamento,
    proveedor_id: original.proveedor_id,
    unidad_compra: original.unidad_compra,
    unidad_venta: original.unidad_venta,
    factor: original.factor,
    iva: original.iva,
    precio_compra: original.costo,
    neto: original.neto,
    precios: original.precios,
    unidades_por_mayoreo: original.unidades_por_mayoreo,
    existencia_inicial: 0,
  }, sucursalId);
}
```

- [ ] **Step 6: Correr y verificar que pasa**

Run: `cd backend && node --test productosSucursales.test.js`
Expected: PASS — 4 tests passing.

Run: `cd backend && npm test`
Expected: PASS — todas las suites existentes siguen en verde (nada más depende de la firma vieja de estas 3 funciones salvo `server.js`, que se actualiza en Task 4).

- [ ] **Step 7: Commit**

```bash
git add backend/productos.js backend/productosSucursales.test.js
git commit -m "feat: crearProducto siembra existencia en todas las sucursales, no solo en la 1"
```

---

### Task 2: Permiso `realizar_traspasos`

**Files:**
- Modify: `backend/permisosCatalogo.js:65-70` (sección "Inventario y Productos")
- Create: `backend/permisoTraspasos.test.js`

**Interfaces:**
- Consumes: `listarPermisos` (ya existe).
- Produces: clave de permiso `"realizar_traspasos"` en el catálogo, módulo `"inventario"`, `implementado: true`.

- [ ] **Step 1: Escribir la prueba (falla primero)**

Crear `backend/permisoTraspasos.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { listarPermisos } = require("./permisosCatalogo");
const { validarSistemaDePermisos } = require("./validarPermisos");

test("existe el permiso realizar_traspasos en modulo inventario", () => {
  const p = listarPermisos().find((x) => x.clave === "realizar_traspasos");
  assert.ok(p, "el permiso debe existir en el catálogo");
  assert.strictEqual(p.modulo, "inventario");
  assert.strictEqual(p.implementado, true);
});

test("el guardia de arranque sigue pasando con el permiso nuevo", () => {
  assert.doesNotThrow(() => validarSistemaDePermisos());
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd backend && node --test permisoTraspasos.test.js`
Expected: FAIL — el permiso no existe todavía (`p` es `undefined`).

- [ ] **Step 3: Agregar el permiso al catálogo**

En `backend/permisosCatalogo.js`, en la sección `// ---- Inventario y Productos ----`, después de la línea de `ajustar_existencia` (línea 70):

```js
  { clave: "ajustar_existencia", etiqueta: "Ajustar Inventario", modulo: "inventario", implementado: true },
  { clave: "realizar_traspasos", etiqueta: "Realizar Traspasos entre Sucursales", modulo: "inventario", implementado: true },
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `cd backend && node --test permisoTraspasos.test.js`
Expected: PASS — 2 tests passing.

- [ ] **Step 5: Commit**

```bash
git add backend/permisosCatalogo.js backend/permisoTraspasos.test.js
git commit -m "feat: permiso realizar_traspasos en el catálogo (módulo inventario)"
```

---

### Task 3: Módulo `traspasos.js` — crear, recibir y listar

**Files:**
- Modify: `backend/testHelpers.js` (agregar `traspasos: []` al fixture)
- Create: `backend/traspasos.js`
- Create: `backend/traspasos.test.js`

**Interfaces:**
- Consumes: `ajustarExistencia(DB, id, { cantidad, motivo, sucursal_id })` (de `./productos`, ya existe).
- Produces:
  - `crearTraspaso(DB, { producto_id, cantidad, sucursal_destino_id, comentario }, sucursalOrigenId, usuario)` → el traspaso creado. Descuenta de inmediato la existencia de `sucursalOrigenId`; valida existencia suficiente; estatus inicial `"en_transito"`.
  - `recibirTraspaso(DB, id, { comentario }, sucursalUsuarioId, usuario)` → el traspaso actualizado. Solo si `sucursalUsuarioId === traspaso.sucursal_destino_id` y el traspaso está `"en_transito"`. Abona la cantidad exacta a destino (crea la fila de existencia si no existía), guarda `comentario` como `comentario_recepcion`, marca `"recibido"`.
  - `listarTraspasos(DB, alcance, filtroEstatus)` → array ordenado por fecha de envío descendente. Con `alcance.verTodas` trae todos; si no, solo donde la sucursal del usuario es origen o destino. `filtroEstatus` opcional (`"en_transito"` | `"recibido"`).

- [ ] **Step 1: Agregar `traspasos: []` al fixture de pruebas**

En `backend/testHelpers.js`, dentro de `DB.inventario`, agregar la clave `traspasos`:

```js
    inventario: {
      existencias: [
        { producto_id: 1, sucursal_id: 1, cantidad_actual: 120, cantidad_minima: 30, cantidad_maxima: 300 },
        { producto_id: 2, sucursal_id: 2, cantidad_actual: 80, cantidad_minima: 20, cantidad_maxima: 200 },
        { producto_id: 3, sucursal_id: 3, cantidad_actual: 60, cantidad_minima: 20, cantidad_maxima: 150 },
      ],
      movimientos_inventario: [],
      compras: [],
      compra_detalle: [],
      traspasos: [],
    },
```

- [ ] **Step 2: Escribir las pruebas (fallan primero)**

Crear `backend/traspasos.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { crearTraspaso, recibirTraspaso, listarTraspasos } = require("./traspasos");

const USUARIO_OCOSINGO = { id: 1, nombre: "Gerente Ocosingo" };
const USUARIO_YAJALON = { id: 3, nombre: "Gerente Yajalón" };

test("crearTraspaso descuenta de inmediato la existencia de origen y queda en_transito", () => {
  const DB = construirDBPrueba();
  // producto 1 tiene 120 en sucursal 1 (fixture)
  const t = crearTraspaso(DB, { producto_id: 1, cantidad: 20, sucursal_destino_id: 2, comentario: "Reabasto" }, 1, USUARIO_OCOSINGO);
  assert.strictEqual(t.estatus, "en_transito");
  assert.strictEqual(t.sucursal_origen_id, 1);
  assert.strictEqual(t.sucursal_destino_id, 2);
  assert.strictEqual(t.cantidad, 20);
  const existOrigen = DB.inventario.existencias.find((e) => e.producto_id === 1 && e.sucursal_id === 1);
  assert.strictEqual(existOrigen.cantidad_actual, 100, "se descontó de inmediato");
  const existDestino = DB.inventario.existencias.find((e) => e.producto_id === 1 && e.sucursal_id === 2);
  assert.ok(!existDestino || existDestino.cantidad_actual === 0, "destino NO recibe nada todavía");
});

test("crearTraspaso rechaza si no hay existencia suficiente en origen", () => {
  const DB = construirDBPrueba();
  assert.throws(
    () => crearTraspaso(DB, { producto_id: 1, cantidad: 999, sucursal_destino_id: 2 }, 1, USUARIO_OCOSINGO),
    /No hay existencia suficiente/
  );
});

test("crearTraspaso rechaza origen y destino iguales", () => {
  const DB = construirDBPrueba();
  assert.throws(() => crearTraspaso(DB, { producto_id: 1, cantidad: 5, sucursal_destino_id: 1 }, 1, USUARIO_OCOSINGO));
});

test("recibirTraspaso abona exactamente la cantidad enviada y guarda el comentario", () => {
  const DB = construirDBPrueba();
  const t = crearTraspaso(DB, { producto_id: 1, cantidad: 20, sucursal_destino_id: 2 }, 1, USUARIO_OCOSINGO);
  const recibido = recibirTraspaso(DB, t.id, { comentario: "Llegaron 2 piezas con la caja dañada" }, 2, USUARIO_YAJALON);
  assert.strictEqual(recibido.estatus, "recibido");
  assert.strictEqual(recibido.comentario_recepcion, "Llegaron 2 piezas con la caja dañada");
  const existDestino = DB.inventario.existencias.find((e) => e.producto_id === 1 && e.sucursal_id === 2);
  assert.strictEqual(existDestino.cantidad_actual, 20, "se abona exactamente lo enviado, sin importar el comentario");
});

test("recibirTraspaso crea la fila de existencia en destino si el producto no tenía registro ahí", () => {
  const DB = construirDBPrueba();
  // producto 3 solo tiene existencia en sucursal 3 (fixture); lo mandamos a la 4
  const t = crearTraspaso(DB, { producto_id: 3, cantidad: 10, sucursal_destino_id: 4 }, 3, USUARIO_OCOSINGO);
  recibirTraspaso(DB, t.id, {}, 4, USUARIO_YAJALON);
  const existDestino = DB.inventario.existencias.find((e) => e.producto_id === 3 && e.sucursal_id === 4);
  assert.ok(existDestino, "debe crear la fila de existencia en destino");
  assert.strictEqual(existDestino.cantidad_actual, 10);
});

test("recibirTraspaso rechaza si lo confirma alguien de otra sucursal", () => {
  const DB = construirDBPrueba();
  const t = crearTraspaso(DB, { producto_id: 1, cantidad: 20, sucursal_destino_id: 2 }, 1, USUARIO_OCOSINGO);
  assert.throws(() => recibirTraspaso(DB, t.id, {}, 3, USUARIO_YAJALON), /no es para tu sucursal/);
});

test("recibirTraspaso rechaza un traspaso ya recibido", () => {
  const DB = construirDBPrueba();
  const t = crearTraspaso(DB, { producto_id: 1, cantidad: 20, sucursal_destino_id: 2 }, 1, USUARIO_OCOSINGO);
  recibirTraspaso(DB, t.id, {}, 2, USUARIO_YAJALON);
  assert.throws(() => recibirTraspaso(DB, t.id, {}, 2, USUARIO_YAJALON), /ya fue recibido/);
});

test("listarTraspasos: usuario amarrado ve los que son origen O destino de su sucursal", () => {
  const DB = construirDBPrueba();
  crearTraspaso(DB, { producto_id: 1, cantidad: 10, sucursal_destino_id: 2 }, 1, USUARIO_OCOSINGO); // 1 -> 2
  crearTraspaso(DB, { producto_id: 3, cantidad: 5, sucursal_destino_id: 4 }, 3, USUARIO_OCOSINGO);   // 3 -> 4, no toca a 2
  const paraSucursal2 = listarTraspasos(DB, { verTodas: false, sucursalId: 2 });
  assert.strictEqual(paraSucursal2.length, 1);
  assert.strictEqual(paraSucursal2[0].sucursal_destino_id, 2);
});

test("listarTraspasos: usuario global ve todos y puede filtrar por estatus", () => {
  const DB = construirDBPrueba();
  const t1 = crearTraspaso(DB, { producto_id: 1, cantidad: 10, sucursal_destino_id: 2 }, 1, USUARIO_OCOSINGO);
  crearTraspaso(DB, { producto_id: 3, cantidad: 5, sucursal_destino_id: 4 }, 3, USUARIO_OCOSINGO);
  recibirTraspaso(DB, t1.id, {}, 2, USUARIO_YAJALON);
  const todos = listarTraspasos(DB, { verTodas: true, sucursalId: null });
  assert.strictEqual(todos.length, 2);
  const pendientes = listarTraspasos(DB, { verTodas: true, sucursalId: null }, "en_transito");
  assert.strictEqual(pendientes.length, 1);
});
```

- [ ] **Step 3: Correr y verificar que falla**

Run: `cd backend && node --test traspasos.test.js`
Expected: FAIL — `Cannot find module './traspasos'`.

- [ ] **Step 4: Crear `backend/traspasos.js`**

```js
/**
 * traspasos.js — Traspasos de inventario entre sucursales.
 *
 * Un traspaso queda "en_transito" al crearse: se descuenta de inmediato la
 * existencia de la sucursal origen, pero la sucursal destino no recibe nada
 * todavía. Solo al confirmar recepción se abona a destino — siempre la
 * cantidad exacta que se envió; cualquier problema (mercancía dañada, etc.)
 * se anota como comentario libre, no como ajuste de cantidad.
 */

const { ajustarExistencia } = require("./productos");

function siguienteId(lista) {
  return lista.length ? Math.max(...lista.map((x) => x.id)) + 1 : 1;
}

function crearTraspaso(DB, datos, sucursalOrigenId, usuario) {
  const producto_id = Number(datos.producto_id);
  const cantidad = Number(datos.cantidad);
  const sucursal_destino_id = Number(datos.sucursal_destino_id);
  const sucursal_origen_id = Number(sucursalOrigenId);

  if (!producto_id) throw new Error("Selecciona un producto");
  if (!cantidad || cantidad <= 0) throw new Error("La cantidad debe ser mayor a cero");
  if (!sucursal_destino_id) throw new Error("Selecciona la sucursal destino");
  if (sucursal_destino_id === sucursal_origen_id) throw new Error("La sucursal destino debe ser distinta a la de origen");

  const existOrigen = DB.inventario.existencias.find((e) => e.producto_id === producto_id && e.sucursal_id === sucursal_origen_id);
  const disponible = existOrigen ? existOrigen.cantidad_actual : 0;
  if (disponible < cantidad) {
    const producto = DB["catalogo-productos"].productos.find((p) => p.id === producto_id);
    throw new Error(`No hay existencia suficiente de "${producto?.nombre || "producto"}" en tu sucursal (disponible: ${disponible}, solicitado: ${cantidad})`);
  }

  const nuevo = {
    id: siguienteId(DB.inventario.traspasos),
    producto_id,
    cantidad,
    sucursal_origen_id,
    sucursal_destino_id,
    estatus: "en_transito",
    comentario_envio: datos.comentario || "",
    comentario_recepcion: null,
    usuario_envio_id: usuario?.id ?? null,
    usuario_envio_nombre: usuario?.nombre || "—",
    usuario_recibe_id: null,
    usuario_recibe_nombre: null,
    fecha_envio: new Date().toISOString(),
    fecha_recepcion: null,
  };

  ajustarExistencia(DB, producto_id, {
    cantidad: -cantidad,
    motivo: `Traspaso #${nuevo.id} — envío a sucursal ${sucursal_destino_id}`,
    sucursal_id: sucursal_origen_id,
  });

  DB.inventario.traspasos.push(nuevo);
  return nuevo;
}

function recibirTraspaso(DB, id, datos, sucursalUsuarioId, usuario) {
  const traspaso = DB.inventario.traspasos.find((t) => t.id === Number(id));
  if (!traspaso) throw new Error("Traspaso no encontrado");
  if (traspaso.estatus !== "en_transito") throw new Error("Este traspaso ya fue recibido");
  if (traspaso.sucursal_destino_id !== Number(sucursalUsuarioId)) {
    throw new Error("Este traspaso no es para tu sucursal");
  }

  const existeDestino = DB.inventario.existencias.some((e) => e.producto_id === traspaso.producto_id && e.sucursal_id === traspaso.sucursal_destino_id);
  if (!existeDestino) {
    DB.inventario.existencias.push({
      producto_id: traspaso.producto_id,
      sucursal_id: traspaso.sucursal_destino_id,
      cantidad_actual: 0,
      cantidad_minima: 0,
      cantidad_maxima: 0,
    });
  }

  ajustarExistencia(DB, traspaso.producto_id, {
    cantidad: traspaso.cantidad,
    motivo: `Traspaso #${traspaso.id} — recepción de sucursal ${traspaso.sucursal_origen_id}`,
    sucursal_id: traspaso.sucursal_destino_id,
  });

  traspaso.estatus = "recibido";
  traspaso.comentario_recepcion = datos.comentario || null;
  traspaso.usuario_recibe_id = usuario?.id ?? null;
  traspaso.usuario_recibe_nombre = usuario?.nombre || "—";
  traspaso.fecha_recepcion = new Date().toISOString();
  return traspaso;
}

function listarTraspasos(DB, alcance, filtroEstatus) {
  let lista = [...DB.inventario.traspasos];
  if (alcance && !alcance.verTodas) {
    lista = lista.filter((t) => t.sucursal_origen_id === alcance.sucursalId || t.sucursal_destino_id === alcance.sucursalId);
  }
  if (filtroEstatus) {
    lista = lista.filter((t) => t.estatus === filtroEstatus);
  }
  return lista.sort((a, b) => new Date(b.fecha_envio) - new Date(a.fecha_envio));
}

module.exports = { crearTraspaso, recibirTraspaso, listarTraspasos };
```

- [ ] **Step 5: Correr y verificar que pasa**

Run: `cd backend && node --test traspasos.test.js`
Expected: PASS — 9 tests passing.

Run: `cd backend && npm test`
Expected: PASS — todas las suites (Tasks 1-3) en verde.

- [ ] **Step 6: Commit**

```bash
git add backend/testHelpers.js backend/traspasos.js backend/traspasos.test.js
git commit -m "feat: módulo traspasos.js — crear, recibir y listar traspasos entre sucursales"
```

---

### Task 4: Rutas HTTP — `/api/traspasos` y actualizar rutas de productos

**Files:**
- Modify: `backend/server.js:20-23` (import de `./productos` — sin cambios de nombres)
- Modify: `backend/server.js` (nuevo import de `./traspasos`)
- Modify: `backend/server.js:328-346` (rutas POST/PUT/clonar de productos)
- Modify: `backend/server.js` (nuevas rutas de traspasos, después del bloque de productos)

**Interfaces:**
- Consumes: `crearProducto(DB, datos, sucursalId)`, `actualizarProducto(DB, id, datos, sucursalId)`, `clonarProducto(DB, id, sucursalId)` (Task 1); `crearTraspaso`, `recibirTraspaso`, `listarTraspasos` (Task 3); `alcanceSucursal`, `requiereLogin`, `requierePermiso`, `resolverPermisosDeRol` (ya existen).
- Produces: rutas HTTP funcionales, probadas manualmente end-to-end en este task.

- [ ] **Step 1: Importar el módulo de traspasos**

En `backend/server.js`, después de la línea del import de `./roles` (línea 39), agregar:

```js
const { crearTraspaso, recibirTraspaso, listarTraspasos } = require("./traspasos");
```

- [ ] **Step 2: Actualizar las rutas de productos para pasar la sucursal**

Reemplazar las tres rutas (`backend/server.js:328-346`):

```js
app.post("/api/productos", requiereLogin, requierePermiso("crear_producto", resolverPermisosDeRol), (req, res) => {
  try {
    const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
    const sucursal_id = alcance.verTodas ? (Number(req.body.sucursal_id) || 1) : alcance.sucursalId;
    res.json(crearProducto(DB, req.body, sucursal_id));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.put("/api/productos/:id", requiereLogin, requierePermiso("editar_producto", resolverPermisosDeRol), (req, res) => {
  try {
    const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
    const sucursal_id = alcance.verTodas ? (Number(req.body.sucursal_id) || 1) : alcance.sucursalId;
    res.json(actualizarProducto(DB, req.params.id, req.body, sucursal_id));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.delete("/api/productos/:id", requiereLogin, requierePermiso("eliminar_producto", resolverPermisosDeRol), (req, res) => {
  try { eliminarProducto(DB, req.params.id); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/api/productos/:id/clonar", requiereLogin, requierePermiso("clonar_producto", resolverPermisosDeRol), (req, res) => {
  try {
    const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
    const sucursal_id = alcance.verTodas ? (Number(req.body.sucursal_id) || 1) : alcance.sucursalId;
    res.json(clonarProducto(DB, req.params.id, sucursal_id));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
```

(La ruta `DELETE` no cambia — se repite tal cual para que el bloque quede completo y no haya que adivinar dónde termina cada una.)

- [ ] **Step 3: Agregar las rutas de traspasos**

Justo después de la línea `app.get("/api/productos/generar-clave", ...)` (`backend/server.js:357`), agregar:

```js

// ---------- Traspasos entre sucursales ----------
app.get("/api/traspasos", requiereLogin, requierePermiso("realizar_traspasos", resolverPermisosDeRol), (req, res) => {
  const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
  res.json(listarTraspasos(DB, alcance, req.query.estatus));
});

app.post("/api/traspasos", requiereLogin, requierePermiso("realizar_traspasos", resolverPermisosDeRol), (req, res) => {
  try {
    const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
    const sucursal_origen_id = alcance.verTodas ? (Number(req.body.sucursal_origen_id) || 1) : alcance.sucursalId;
    res.json(crearTraspaso(DB, req.body, sucursal_origen_id, req.usuarioToken));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/api/traspasos/:id/recibir", requiereLogin, requierePermiso("realizar_traspasos", resolverPermisosDeRol), (req, res) => {
  try {
    const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
    const traspaso = DB.inventario.traspasos.find((t) => t.id === Number(req.params.id));
    // Usuario global: confirma en nombre de la sucursal destino real del traspaso (no necesita elegirla).
    const sucursal_id = alcance.verTodas ? (traspaso ? traspaso.sucursal_destino_id : null) : alcance.sucursalId;
    res.json(recibirTraspaso(DB, req.params.id, req.body, sucursal_id, req.usuarioToken));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
```

- [ ] **Step 4: Correr toda la suite de backend**

Run: `cd backend && npm test`
Expected: PASS — todas las suites en verde (esto no agrega pruebas nuevas de rutas HTTP; las rutas se validan manualmente en el siguiente paso, siguiendo el mismo patrón que usó el plan de aislamiento por sucursal).

- [ ] **Step 5: Verificación manual end-to-end**

Levantar el backend en una base de datos temporal (para no tocar `datos.sqlite` real):

```bash
cd backend
DB_PATH=/tmp/verify_traspasos.sqlite PORT=4322 JWT_SECRET=verify-secret node server.js
```

En otra terminal:

```bash
BASE=http://localhost:4322
# 1. Setup inicial (queda como Administrador, ver_todas_las_sucursales)
curl -s -X POST $BASE/api/auth/setup-inicial -H "Content-Type: application/json" -d '{"nombre":"Admin","usuario":"admin","password":"Admin1234"}'
TOKEN=$(curl -s -X POST $BASE/api/auth/login -H "Content-Type: application/json" -d '{"usuario":"admin","password":"Admin1234"}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).token))")

# 2. Crear un producto en sucursal 1
curl -s -X POST $BASE/api/productos -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"descripcion":"Guitarra acústica","existencia_inicial":5,"sucursal_id":1}'

# 3. Confirmar que aparece con existencia 5 en sucursal 1 y 0 en sucursal 2
curl -s "$BASE/api/productos?sucursal_id=1" -H "Authorization: Bearer $TOKEN"
curl -s "$BASE/api/productos?sucursal_id=2" -H "Authorization: Bearer $TOKEN"

# 4. Traspasar 2 unidades de sucursal 1 a sucursal 2
curl -s -X POST $BASE/api/traspasos -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"producto_id":1,"cantidad":2,"sucursal_destino_id":2,"sucursal_origen_id":1,"comentario":"Prueba manual"}'

# 5. Confirmar: sucursal 1 bajó a 3, el traspaso está en_transito, sucursal 2 sigue en 0
curl -s "$BASE/api/productos?sucursal_id=1" -H "Authorization: Bearer $TOKEN"
curl -s "$BASE/api/traspasos" -H "Authorization: Bearer $TOKEN"

# 6. Recibir el traspaso (id 1) con un comentario de mercancía dañada
curl -s -X POST $BASE/api/traspasos/1/recibir -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"comentario":"Llegó una pieza con rayón"}'

# 7. Confirmar: sucursal 2 ahora tiene 2, el traspaso quedó recibido con el comentario
curl -s "$BASE/api/productos?sucursal_id=2" -H "Authorization: Bearer $TOKEN"
curl -s "$BASE/api/traspasos" -H "Authorization: Bearer $TOKEN"
```

Expected:
- Paso 3: sucursal 1 muestra `existencia: 5`, sucursal 2 muestra `existencia: 0` para el mismo producto.
- Paso 5: sucursal 1 baja a `existencia: 3`; el traspaso tiene `"estatus":"en_transito"`.
- Paso 7: sucursal 2 sube a `existencia: 2`; el traspaso tiene `"estatus":"recibido"` y `"comentario_recepcion":"Llegó una pieza con rayón"`.

Detener el servidor (`Ctrl+C`) y borrar `/tmp/verify_traspasos.sqlite` al terminar.

- [ ] **Step 6: Commit**

```bash
git add backend/server.js
git commit -m "feat: rutas HTTP de traspasos entre sucursales + productos pasan la sucursal del token"
```

---

### Task 5: Frontend — módulo `Traspasos.jsx`

**Files:**
- Create: `src/Traspasos.jsx`
- Modify: `src/App.jsx:5,13,75-77` (import, `MODULOS`, rama de `vista`)
- Modify: `src/Dashboard.jsx:8-14` (tile nuevo)
- Modify: `src/EncabezadoModulo.jsx:7-13` (título)

**Interfaces:**
- Consumes: `apiFetch` (de `./api`), endpoints `GET/POST /api/traspasos`, `POST /api/traspasos/:id/recibir`, `GET /api/productos`, `GET /api/sucursales` (ya existe, `backend/server.js:462`).
- Produces: pantalla completa gateada por `puede("realizar_traspasos")`, montada en la vista `"traspasos"`.

- [ ] **Step 1: Crear `src/Traspasos.jsx`**

```jsx
import React, { useState, useEffect, useCallback } from "react";
import { ArrowRightLeft, Send, PackageCheck, X } from "lucide-react";
import { apiFetch } from "./api";

function Campo({ label, children }) {
  return (
    <div>
      <label className="text-xs text-slate-500 block mb-1">{label}</label>
      {children}
    </div>
  );
}

const inputCls = "w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:border-blue-500";

const FORM_VACIO = { producto_id: "", cantidad: "", sucursal_destino_id: "", sucursal_origen_id: "", comentario: "" };

export default function Traspasos({ onVolver, permisos }) {
  const puede = (clave) => !permisos || permisos.includes(clave);
  const [productos, setProductos] = useState([]);
  const [sucursales, setSucursales] = useState([]);
  const [traspasos, setTraspasos] = useState([]);
  const [tab, setTab] = useState("enviar"); // "enviar" | "pendientes" | "historial"
  const [cargando, setCargando] = useState(true);
  const [aviso, setAviso] = useState(null);
  const [form, setForm] = useState(FORM_VACIO);
  const [modalRecibir, setModalRecibir] = useState(null); // traspaso seleccionado o null
  const [comentarioRecepcion, setComentarioRecepcion] = useState("");

  const mostrarAviso = (t) => { setAviso(t); setTimeout(() => setAviso(null), 2500); };

  const nombreSucursal = (id) => sucursales.find((s) => s.id === id)?.nombre || `Sucursal ${id}`;
  const nombreProducto = (id) => productos.find((p) => p.id === id)?.nombre || `Producto ${id}`;

  const cargarTodo = useCallback(async () => {
    setCargando(true);
    try {
      const [rProd, rSuc, rTras] = await Promise.all([
        apiFetch(`/productos?sucursal_id=todas`), apiFetch(`/sucursales`), apiFetch(`/traspasos`)
      ]);
      setProductos(await rProd.json());
      setSucursales(await rSuc.json());
      setTraspasos(await rTras.json());
    } catch (e) {
      mostrarAviso("❌ No se pudo conectar con el backend");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargarTodo(); }, [cargarTodo]);

  const enviarTraspaso = async () => {
    if (!form.producto_id) return mostrarAviso("Selecciona un producto");
    if (!form.cantidad || Number(form.cantidad) <= 0) return mostrarAviso("Escribe una cantidad válida");
    if (!form.sucursal_destino_id) return mostrarAviso("Selecciona la sucursal destino");
    try {
      const r = await apiFetch(`/traspasos`, { method: "POST", body: JSON.stringify(form) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      mostrarAviso("Traspaso enviado — queda en tránsito hasta que destino confirme");
      setForm(FORM_VACIO);
      await cargarTodo();
      setTab("pendientes");
    } catch (e) {
      mostrarAviso("❌ " + e.message);
    }
  };

  const abrirRecibir = (t) => { setModalRecibir(t); setComentarioRecepcion(""); };

  const confirmarRecepcion = async () => {
    try {
      const r = await apiFetch(`/traspasos/${modalRecibir.id}/recibir`, {
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
              <select className={inputCls} value={form.producto_id} onChange={(e) => setForm({ ...form, producto_id: e.target.value })}>
                <option value="">Selecciona...</option>
                {productos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
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
                      <button onClick={() => abrirRecibir(t)} className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-3 py-1.5 rounded">Confirmar recepción</button>
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
    </div>
  );
}
```

- [ ] **Step 2: Montar el módulo en `src/App.jsx`**

Agregar el import (después de la línea 5, import de `InventarioProductos`):

```js
import Traspasos from "./Traspasos.jsx";
```

Agregar `"traspasos"` a `MODULOS` (línea 13):

```js
const MODULOS = ["pos", "inventario", "roles", "crm", "corte", "ml", "traspasos"];
```

Agregar la rama de `vista` (después del bloque `vista === "inventario"`, `backend` no — es frontend, línea ~75-77):

```jsx
        {vista === "traspasos" && (
          <Traspasos onVolver={() => setVista("dashboard")} permisos={usuario.permisos} />
        )}
```

- [ ] **Step 3: Agregar el tile en `src/Dashboard.jsx`**

Reemplazar la línea del import de íconos (`src/Dashboard.jsx:2`):

```js
import { ShoppingCart, Users, Boxes, Lock, ShieldCheck, LogOut, Landmark, Store, ArrowRightLeft } from "lucide-react";
```

En el arreglo `MODULOS` (`src/Dashboard.jsx:8-14`), agregar después de la entrada de `inventario`:

```js
  { id: "traspasos", nombre: "Traspasos entre Sucursales", icono: ArrowRightLeft, disponible: true, modulo: "inventario", permiso: "realizar_traspasos" },
```

- [ ] **Step 4: Agregar el título en `src/EncabezadoModulo.jsx`**

En `TITULOS` (`src/EncabezadoModulo.jsx:7-13`), agregar:

```js
  traspasos:  "Traspasos entre Sucursales",
```

- [ ] **Step 5: Verificación manual en el navegador**

```bash
cd backend && npm start
```

En otra terminal:

```bash
npm run dev
```

En el navegador (`http://localhost:5173` o el puerto que indique Vite):
1. Iniciar sesión como Administrador.
2. Ir a "Roles y Personal" y habilitar el permiso "Realizar Traspasos entre Sucursales" para el rol que se vaya a usar en la prueba (recordar que un rol ya sembrado no lo trae automáticamente — ver nota en Global Constraints).
3. Entrar al tile nuevo "Traspasos entre Sucursales" desde el Dashboard.
4. Pestaña "Enviar traspaso": elegir un producto, cantidad, sucursal destino, comentario opcional, enviar.
5. Confirmar que aparece en "Pendientes de recibir".
6. Dar clic en "Confirmar recepción", escribir un comentario (ej. "llegó una pieza dañada"), confirmar.
7. Confirmar que pasa a "Historial" con el comentario visible, y que en Inventario la existencia se movió correctamente entre las dos sucursales (usar el selector de sucursal si se está logueado como Administrador).

Expected: el flujo completo funciona sin errores en consola del navegador ni del backend.

- [ ] **Step 6: Commit**

```bash
git add src/Traspasos.jsx src/App.jsx src/Dashboard.jsx src/EncabezadoModulo.jsx
git commit -m "feat: módulo Traspasos entre Sucursales en el frontend"
```
