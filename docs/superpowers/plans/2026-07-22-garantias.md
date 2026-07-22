# Garantías Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar un módulo de Garantías con proveedor: registrar un producto defectuoso (con o sin cliente), trackear su envío (proveedor directo o vía CEDIS) sin perder de qué tienda salió, registrar la resolución del proveedor (reparado/reemplazo/cambio de componente/rechazada/nota de crédito), reintegrar a existencia cuando hay producto físico de vuelta, entregar al cliente si aplica, y alertar cuando una garantía lleva demasiados días sin movimiento.

**Architecture:** Dos colecciones nuevas bajo `DB.inventario` (`garantias` + `garantia_movimientos`, bitácora al estilo `apartado_abonos`). Backend `backend/garantias.js` con funciones planas que reciben `DB` y mutan objetos, misma forma que `apartados.js`. La máquina de estados es `registrada → enviada → resuelta → en_tienda_pendiente_entrega (solo si hay cliente) → cerrada`, con `rechazada`/`nota_credito` saltando de `enviada` directo a `cerrada`. Cada función mutadora sobre una garantía existente valida `dentroDeAlcance(garantia.sucursal_origen_id, alcance)` **desde el día uno** (el guard que faltó en Apartados y hubo que parchar después). El impacto de inventario usa `ajustarExistencia` (−1 al enviar, +1 al recibir), mismo mecanismo que Traspasos.

**Tech Stack:** Node.js/Express (backend ya existente), `node:test`, React 18 + Tailwind + lucide-react (frontend ya existente), sin dependencias nuevas.

## Global Constraints

- `sucursal_origen_id` es el dato que nunca se pierde: identifica de qué tienda salió el producto sin importar cuántos saltos dé el caso. Toda función mutadora por `:id` valida `dentroDeAlcance(garantia.sucursal_origen_id, alcance)` antes de actuar; si falla, lanza `Error("Garantía no encontrada")` (no revela que existe en otra sucursal, igual que el criterio 404 de `dentroDeAlcance`).
- `cliente_id`, `venta_id` y `proveedor_id` son opcionales (`null`). `cliente_id === null` significa stock propio dañado sin cliente de por medio.
- Un solo permiso `gestionar_garantias` (módulo `inventario`) cubre las 6 acciones del ciclo (registrar, enviar, actualizar ubicación, resolver, recibir, entregar).
- El folio se autogenera con el formato `G-####` (4 dígitos con ceros a la izquierda, ej. `G-0001`).
- El descuento/reintegro de existencia usa `ajustarExistencia(DB, producto_id, { cantidad, motivo, sucursal_id })`: `-1` al marcar enviada, `+1` al recibir en tienda. `rechazada`/`nota_credito` nunca reintegran (no hay producto físico de vuelta).
- `costo_resolucion` solo aplica a `reparado`/`reemplazo`/`cambio_componente` (`null` = gratis); en `rechazada`/`nota_credito` queda siempre `null` (el monto de un crédito, si hiciera falta, va como texto libre en `notas_resolucion` — estructurarlo queda fuera de alcance).
- El umbral de días sin movimiento es configurable: `config.dias_alerta_garantias` (default `15`). `atrasada = estado !== "cerrada" && dias_sin_movimiento > umbral`.
- Frontend sin arnés de pruebas automáticas (convención establecida del repo): la verificación del frontend es manual en navegador.
- El backend tiene una suite `node --test` que debe seguir pasando completa después de cada tarea de backend — no romper pruebas existentes.

---

### Task 1: Modelo de datos, permiso, configuración y `backend/garantias.js`

**Files:**
- Modify: `backend/permisosCatalogo.js`
- Modify: `backend/configuracion.js`
- Modify: `backend/server.js` (solo el seed de `DB.inventario`)
- Modify: `backend/testHelpers.js` (solo el seed de `DB.inventario`)
- Create: `backend/garantias.js`
- Create: `backend/garantias.test.js`

**Interfaces:**
- Produces (todos exportados de `backend/garantias.js`):
  - `crearGarantia(DB, datos, sucursalId, usuario)` → garantía creada (`estado: "registrada"`)
  - `marcarEnviada(DB, id, { destino_tipo, destino_nombre, proveedor_id }, usuario, alcance)` → garantía (`estado: "enviada"`)
  - `actualizarUbicacion(DB, id, { ubicacion_actual, notas }, usuario, alcance)` → garantía (sigue `enviada`)
  - `registrarResolucion(DB, id, { tipo_resolucion, costo_resolucion, notas }, usuario, alcance)` → garantía (`resuelta` o `cerrada`)
  - `recibirEnTienda(DB, id, usuario, alcance)` → garantía (`en_tienda_pendiente_entrega` o `cerrada`)
  - `entregarACliente(DB, id, usuario, alcance)` → garantía (`cerrada`)
  - `listarGarantias(DB, alcance)` → arreglo de garantías enriquecidas (`dias_sin_movimiento`, `atrasada`, nombres, `movimientos`)
- Consumes: `ajustarExistencia` de `./productos`; `obtenerConfiguracion` de `./configuracion`; `dentroDeAlcance` de `./auth` (todos ya existentes).

- [ ] **Step 1: Registrar el permiso `gestionar_garantias`**

En `backend/permisosCatalogo.js`, dentro del arreglo `PERMISOS`, en el bloque `// ---- Inventario y Productos ----` (después de la línea de `recibir_compra`), agregar:

```js
  { clave: "gestionar_garantias", etiqueta: "Gestionar Garantías", modulo: "inventario", implementado: true },
```

No hace falta tocar `MODULOS_SISTEMA` ni `validarPermisos.js` — el módulo `inventario` ya existe y ya tiene permisos registrados (`realizar_traspasos`, `recibir_compra`).

- [ ] **Step 2: Agregar el default `dias_alerta_garantias` a la configuración**

En `backend/configuracion.js`, dentro de `CONFIG_DEFAULT`, agregar la línea después de `dias_seguimiento_postventa: 7,`:

```js
const CONFIG_DEFAULT = {
  documento_por_defecto: "Ticket",
  cerrar_venta_con_enter: true,
  solicitar_vendedor_al_cerrar_venta: false,
  permitir_ventas_sin_existencia: true,
  permitir_cambio_en_todas_las_formas_de_pago: false,
  descuentos_pago_habilitado: true,
  dias_seguimiento_postventa: 7,
  dias_alerta_garantias: 15,
};
```

- [ ] **Step 3: Agregar `garantias` y `garantia_movimientos` al seed de `DB.inventario`**

En `backend/server.js`, dentro del objeto `DB.inventario` (el bloque que termina con `traspasos: []`), dejarlo así:

```js
    movimientos_inventario: [],
    compras: [],
    compra_detalle: [],
    traspasos: [],
    garantias: [],
    garantia_movimientos: [],
  },
```

En `backend/testHelpers.js`, dentro del `inventario` del DB de prueba (el bloque que termina con `traspasos: [],`), dejarlo así:

```js
      movimientos_inventario: [],
      compras: [],
      compra_detalle: [],
      traspasos: [],
      garantias: [],
      garantia_movimientos: [],
    },
```

- [ ] **Step 4: Escribir las pruebas de `backend/garantias.js`**

Crear `backend/garantias.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { obtenerConfiguracion } = require("./configuracion");
const {
  crearGarantia, marcarEnviada, actualizarUbicacion, registrarResolucion,
  recibirEnTienda, entregarACliente, listarGarantias,
} = require("./garantias");

const ALCANCE_TODAS = { verTodas: true, sucursalId: null };
const USUARIO = { id: 1, nombre: "Ana" };

// producto_id 1 / sucursal 1 tiene existencia 120 en el DB de prueba.
function existencia(DB, producto_id = 1, sucursal_id = 1) {
  const e = DB.inventario.existencias.find((x) => x.producto_id === producto_id && x.sucursal_id === sucursal_id);
  return e ? e.cantidad_actual : null;
}

test("crearGarantia: crea en estado 'registrada' con folio, ubicación en la sucursal y primer movimiento", () => {
  const DB = construirDBPrueba();
  const g = crearGarantia(DB, { producto_id: 1, notas_defecto: "No enciende" }, 1, USUARIO);

  assert.strictEqual(g.estado, "registrada");
  assert.strictEqual(g.folio, "G-0001");
  assert.strictEqual(g.sucursal_origen_id, 1);
  assert.strictEqual(g.producto_id, 1);
  assert.strictEqual(g.cliente_id, null, "sin cliente => null");
  assert.strictEqual(g.venta_id, null);
  assert.strictEqual(g.proveedor_id, null);
  assert.strictEqual(g.ubicacion_actual, "Ocosingo", "arranca en la tienda de origen");
  assert.strictEqual(g.usuario_creacion, "Ana");

  const movs = DB.inventario.garantia_movimientos.filter((m) => m.garantia_id === g.id);
  assert.strictEqual(movs.length, 1);
  assert.strictEqual(movs[0].tipo, "creacion");
});

test("crearGarantia: rechaza un producto inexistente", () => {
  const DB = construirDBPrueba();
  assert.throws(() => crearGarantia(DB, { producto_id: 9999 }, 1, USUARIO), /producto/i);
});

test("crearGarantia: guarda cliente_id, venta_id y proveedor_id cuando se pasan", () => {
  const DB = construirDBPrueba();
  const g = crearGarantia(DB, { producto_id: 1, cliente_id: 1, venta_id: 7, proveedor_id: 2 }, 1, USUARIO);
  assert.strictEqual(g.cliente_id, 1);
  assert.strictEqual(g.venta_id, 7);
  assert.strictEqual(g.proveedor_id, 2);
});

test("marcarEnviada: solo desde 'registrada'; descuenta 1 de existencia, cambia ubicación y guarda proveedor", () => {
  const DB = construirDBPrueba();
  const antes = existencia(DB);
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);

  const enviada = marcarEnviada(DB, g.id, { destino_tipo: "cedis", destino_nombre: "CEDIS", proveedor_id: 3 }, USUARIO, ALCANCE_TODAS);

  assert.strictEqual(enviada.estado, "enviada");
  assert.strictEqual(enviada.ubicacion_actual, "CEDIS");
  assert.strictEqual(enviada.proveedor_id, 3);
  assert.strictEqual(existencia(DB), antes - 1, "descuenta 1 pieza de la sucursal de origen");

  const movs = DB.inventario.garantia_movimientos.filter((m) => m.garantia_id === g.id);
  assert.strictEqual(movs[movs.length - 1].tipo, "envio");
});

test("marcarEnviada: rechaza si la garantía no está en 'registrada'", () => {
  const DB = construirDBPrueba();
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
  marcarEnviada(DB, g.id, { destino_tipo: "proveedor", destino_nombre: "Proveedor XYZ" }, USUARIO, ALCANCE_TODAS);
  assert.throws(
    () => marcarEnviada(DB, g.id, { destino_tipo: "proveedor", destino_nombre: "Otro" }, USUARIO, ALCANCE_TODAS),
    /registrada/i
  );
});

test("actualizarUbicacion: solo en 'enviada'; cambia ubicación y agrega movimiento sin cambiar de estado", () => {
  const DB = construirDBPrueba();
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
  marcarEnviada(DB, g.id, { destino_tipo: "cedis", destino_nombre: "CEDIS" }, USUARIO, ALCANCE_TODAS);

  const actualizada = actualizarUbicacion(DB, g.id, { ubicacion_actual: "Proveedor XYZ", notas: "CEDIS reenvía" }, USUARIO, ALCANCE_TODAS);

  assert.strictEqual(actualizada.estado, "enviada", "no cambia de estado");
  assert.strictEqual(actualizada.ubicacion_actual, "Proveedor XYZ");
  const movs = DB.inventario.garantia_movimientos.filter((m) => m.garantia_id === g.id);
  assert.strictEqual(movs[movs.length - 1].tipo, "actualizacion_ubicacion");
});

test("registrarResolucion (reparado): pasa a 'resuelta' y guarda el costo", () => {
  const DB = construirDBPrueba();
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
  marcarEnviada(DB, g.id, { destino_tipo: "proveedor", destino_nombre: "Proveedor XYZ" }, USUARIO, ALCANCE_TODAS);

  const r = registrarResolucion(DB, g.id, { tipo_resolucion: "reparado", costo_resolucion: 150, notas: "Cambió pastilla" }, USUARIO, ALCANCE_TODAS);

  assert.strictEqual(r.estado, "resuelta");
  assert.strictEqual(r.tipo_resolucion, "reparado");
  assert.strictEqual(r.costo_resolucion, 150);
  const movs = DB.inventario.garantia_movimientos.filter((m) => m.garantia_id === g.id);
  assert.strictEqual(movs[movs.length - 1].tipo, "resolucion");
});

test("registrarResolucion (rechazada): cierra directo sin pasar por 'resuelta' y con costo null", () => {
  const DB = construirDBPrueba();
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
  marcarEnviada(DB, g.id, { destino_tipo: "proveedor", destino_nombre: "Proveedor XYZ" }, USUARIO, ALCANCE_TODAS);

  const r = registrarResolucion(DB, g.id, { tipo_resolucion: "rechazada", costo_resolucion: 999, notas: "Mal uso" }, USUARIO, ALCANCE_TODAS);

  assert.strictEqual(r.estado, "cerrada");
  assert.strictEqual(r.costo_resolucion, null, "rechazada nunca lleva costo");
});

test("registrarResolucion (nota_credito): cierra directo", () => {
  const DB = construirDBPrueba();
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
  marcarEnviada(DB, g.id, { destino_tipo: "proveedor", destino_nombre: "Proveedor XYZ" }, USUARIO, ALCANCE_TODAS);

  const r = registrarResolucion(DB, g.id, { tipo_resolucion: "nota_credito", notas: "Crédito $500" }, USUARIO, ALCANCE_TODAS);
  assert.strictEqual(r.estado, "cerrada");
});

test("registrarResolucion: rechaza un tipo de resolución inválido", () => {
  const DB = construirDBPrueba();
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
  marcarEnviada(DB, g.id, { destino_tipo: "proveedor", destino_nombre: "Proveedor XYZ" }, USUARIO, ALCANCE_TODAS);
  assert.throws(
    () => registrarResolucion(DB, g.id, { tipo_resolucion: "explotó" }, USUARIO, ALCANCE_TODAS),
    /resoluci/i
  );
});

test("recibirEnTienda (con cliente): reintegra 1 a existencia y pasa a 'en_tienda_pendiente_entrega'", () => {
  const DB = construirDBPrueba();
  const antes = existencia(DB);
  const g = crearGarantia(DB, { producto_id: 1, cliente_id: 1 }, 1, USUARIO);
  marcarEnviada(DB, g.id, { destino_tipo: "proveedor", destino_nombre: "Proveedor XYZ" }, USUARIO, ALCANCE_TODAS); // -1
  registrarResolucion(DB, g.id, { tipo_resolucion: "reemplazo" }, USUARIO, ALCANCE_TODAS);

  const r = recibirEnTienda(DB, g.id, USUARIO, ALCANCE_TODAS); // +1

  assert.strictEqual(r.estado, "en_tienda_pendiente_entrega");
  assert.strictEqual(existencia(DB), antes, "neto 0: -1 al enviar, +1 al recibir");
  const movs = DB.inventario.garantia_movimientos.filter((m) => m.garantia_id === g.id);
  assert.strictEqual(movs[movs.length - 1].tipo, "recepcion");
});

test("recibirEnTienda (sin cliente): reintegra a existencia y cierra directo", () => {
  const DB = construirDBPrueba();
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO); // sin cliente
  marcarEnviada(DB, g.id, { destino_tipo: "proveedor", destino_nombre: "Proveedor XYZ" }, USUARIO, ALCANCE_TODAS);
  registrarResolucion(DB, g.id, { tipo_resolucion: "reparado" }, USUARIO, ALCANCE_TODAS);

  const r = recibirEnTienda(DB, g.id, USUARIO, ALCANCE_TODAS);
  assert.strictEqual(r.estado, "cerrada", "sin cliente reingresa a inventario y cierra");
});

test("recibirEnTienda: rechaza si la garantía no está en 'resuelta'", () => {
  const DB = construirDBPrueba();
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
  assert.throws(() => recibirEnTienda(DB, g.id, USUARIO, ALCANCE_TODAS), /resuelta/i);
});

test("entregarACliente: de 'en_tienda_pendiente_entrega' pasa a 'cerrada'", () => {
  const DB = construirDBPrueba();
  const g = crearGarantia(DB, { producto_id: 1, cliente_id: 1 }, 1, USUARIO);
  marcarEnviada(DB, g.id, { destino_tipo: "proveedor", destino_nombre: "Proveedor XYZ" }, USUARIO, ALCANCE_TODAS);
  registrarResolucion(DB, g.id, { tipo_resolucion: "reemplazo" }, USUARIO, ALCANCE_TODAS);
  recibirEnTienda(DB, g.id, USUARIO, ALCANCE_TODAS);

  const r = entregarACliente(DB, g.id, USUARIO, ALCANCE_TODAS);
  assert.strictEqual(r.estado, "cerrada");
  const movs = DB.inventario.garantia_movimientos.filter((m) => m.garantia_id === g.id);
  assert.strictEqual(movs[movs.length - 1].tipo, "entrega_cliente");
});

test("rechazada nunca reintegra existencia (queda descontada tras el envío)", () => {
  const DB = construirDBPrueba();
  const antes = existencia(DB);
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
  marcarEnviada(DB, g.id, { destino_tipo: "proveedor", destino_nombre: "Proveedor XYZ" }, USUARIO, ALCANCE_TODAS);
  registrarResolucion(DB, g.id, { tipo_resolucion: "rechazada" }, USUARIO, ALCANCE_TODAS);

  assert.strictEqual(existencia(DB), antes - 1, "el producto no volvió, la existencia sigue en -1");
});

test("guard de alcance: un usuario de otra sucursal no puede actuar sobre una garantía ajena", () => {
  const DB = construirDBPrueba();
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO); // sucursal 1
  const alcanceOtra = { verTodas: false, sucursalId: 2 };
  assert.throws(
    () => marcarEnviada(DB, g.id, { destino_tipo: "proveedor", destino_nombre: "X" }, USUARIO, alcanceOtra),
    /no encontrada/i
  );
});

test("listarGarantias: respeta el alcance de sucursal", () => {
  const DB = construirDBPrueba();
  crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
  crearGarantia(DB, { producto_id: 1 }, 2, USUARIO);

  const lista = listarGarantias(DB, { verTodas: false, sucursalId: 1 });
  assert.strictEqual(lista.length, 1);
  assert.strictEqual(lista[0].sucursal_origen_id, 1);
});

test("listarGarantias: calcula dias_sin_movimiento y atrasada contra el umbral configurable", () => {
  const DB = construirDBPrueba();
  obtenerConfiguracion(DB);
  DB.pos.configuracion.dias_alerta_garantias = 15;
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
  DB.inventario.garantias.find((x) => x.id === g.id).fecha_ultimo_movimiento = "2000-01-01"; // hace años

  const lista = listarGarantias(DB, ALCANCE_TODAS);
  const fila = lista.find((x) => x.id === g.id);
  assert.ok(fila.dias_sin_movimiento > 15);
  assert.strictEqual(fila.atrasada, true);
  assert.ok(Array.isArray(fila.movimientos));
  assert.strictEqual(fila.producto_nombre, "Arroz 1kg");
  assert.strictEqual(fila.sucursal_origen_nombre, "Ocosingo");
});
```

- [ ] **Step 5: Correr las pruebas para verificar que fallan**

Run: `cd backend && npx node --test garantias.test.js`
Expected: FAIL — `Cannot find module './garantias'`.

- [ ] **Step 6: Implementar `backend/garantias.js`**

```js
/**
 * garantias.js — Garantías con proveedor. Se registra un producto
 * defectuoso (con o sin cliente), se envía a resolver (proveedor directo o
 * vía CEDIS), se registra la resolución, y si vuelve producto físico se
 * reintegra a la existencia de la tienda de ORIGEN (el dato que nunca se
 * pierde, sin importar cuántos saltos dé el caso).
 *
 * Máquina de estados:
 *   registrada → enviada → resuelta → en_tienda_pendiente_entrega → cerrada
 * con rechazada/nota_credito saltando de 'enviada' directo a 'cerrada'
 * (no hay producto físico de vuelta, así que nunca reintegran existencia
 * ni pasan por recibirEnTienda).
 *
 * Mismo patrón que apartados.js: funciones planas que reciben DB y mutan
 * objetos, con una bitácora (garantia_movimientos, al estilo apartado_abonos).
 * CADA función mutadora sobre una garantía existente valida
 * dentroDeAlcance(garantia.sucursal_origen_id, alcance) ANTES de actuar —
 * el guard que faltó en Apartados y se tuvo que parchar en auditoría; aquí
 * se construye desde el día uno.
 */

const { ajustarExistencia } = require("./productos");
const { obtenerConfiguracion } = require("./configuracion");
const { dentroDeAlcance } = require("./auth");

const TIPOS_RESOLUCION = ["reparado", "reemplazo", "cambio_componente", "rechazada", "nota_credito"];
const TIPOS_CON_PRODUCTO = ["reparado", "reemplazo", "cambio_componente"];

function siguienteId(lista) {
  return lista.length ? Math.max(...lista.map((x) => x.id)) + 1 : 1;
}

function hoy() {
  return new Date().toISOString().slice(0, 10);
}

function ahora() {
  return new Date().toISOString();
}

function diasEntre(fechaA, fechaB) {
  return Math.floor((new Date(fechaB) - new Date(fechaA)) / 86400000);
}

function nombreSucursal(DB, id) {
  return DB.pos.sucursales.find((s) => s.id === Number(id))?.nombre || `Sucursal ${id}`;
}

/** Agrega un renglón a la bitácora y refresca fecha_ultimo_movimiento (base
 *  del cálculo de días sin seguimiento). */
function pushMovimiento(DB, garantia, tipo, descripcion, usuario) {
  const fecha = ahora();
  DB.inventario.garantia_movimientos.push({
    id: siguienteId(DB.inventario.garantia_movimientos),
    garantia_id: garantia.id,
    fecha,
    usuario: usuario?.nombre || "—",
    tipo,
    descripcion: descripcion || "",
  });
  garantia.fecha_ultimo_movimiento = fecha.slice(0, 10);
}

/** Busca la garantía y aplica el guard de alcance. Lanza "Garantía no
 *  encontrada" tanto si no existe como si está fuera del alcance (no revela
 *  que existe en otra sucursal). */
function buscarConGuardia(DB, id, alcance) {
  const garantia = DB.inventario.garantias.find((g) => g.id === Number(id));
  if (!garantia) throw new Error("Garantía no encontrada");
  if (!dentroDeAlcance(garantia.sucursal_origen_id, alcance)) {
    throw new Error("Garantía no encontrada");
  }
  return garantia;
}

function crearGarantia(DB, datos, sucursalId, usuario) {
  const sucursal_origen_id = Number(sucursalId) || Number(datos.sucursal_origen_id) || 1;
  const producto_id = Number(datos.producto_id);
  if (!producto_id) throw new Error("Selecciona un producto para la garantía");
  const producto = DB["catalogo-productos"].productos.find((p) => p.id === producto_id);
  if (!producto) throw new Error("Producto no encontrado");

  const nuevoId = siguienteId(DB.inventario.garantias);
  const fechaHoy = hoy();
  const garantia = {
    id: nuevoId,
    folio: `G-${String(nuevoId).padStart(4, "0")}`,
    sucursal_origen_id,
    producto_id,
    cliente_id: datos.cliente_id != null && datos.cliente_id !== "" ? Number(datos.cliente_id) : null,
    venta_id: datos.venta_id != null && datos.venta_id !== "" ? Number(datos.venta_id) : null,
    proveedor_id: datos.proveedor_id != null && datos.proveedor_id !== "" ? Number(datos.proveedor_id) : null,
    estado: "registrada",
    ubicacion_actual: nombreSucursal(DB, sucursal_origen_id),
    tipo_resolucion: null,
    costo_resolucion: null,
    notas_resolucion: null,
    fecha_creacion: fechaHoy,
    fecha_ultimo_movimiento: fechaHoy,
    usuario_creacion: usuario?.nombre || "—",
  };
  DB.inventario.garantias.push(garantia);

  const desc = datos.notas_defecto
    ? `Registrada — ${datos.notas_defecto}`
    : `Registrada en ${garantia.ubicacion_actual}`;
  pushMovimiento(DB, garantia, "creacion", desc, usuario);
  return garantia;
}

function marcarEnviada(DB, id, datos, usuario, alcance) {
  const garantia = buscarConGuardia(DB, id, alcance);
  if (garantia.estado !== "registrada") {
    throw new Error("Solo se puede enviar una garantía en estado 'registrada'");
  }
  const destino_nombre = (datos.destino_nombre || "").trim();
  if (!destino_nombre) throw new Error("Indica el destino del envío");

  if (datos.proveedor_id != null && datos.proveedor_id !== "") {
    garantia.proveedor_id = Number(datos.proveedor_id);
  }

  try {
    ajustarExistencia(DB, garantia.producto_id, {
      cantidad: -1,
      motivo: `Garantía ${garantia.folio} — enviada`,
      sucursal_id: garantia.sucursal_origen_id,
    });
  } catch (e) { /* sin registro de existencia en esta sucursal, no detiene el envío */ }

  garantia.estado = "enviada";
  garantia.ubicacion_actual = destino_nombre;
  const destinoTipo = datos.destino_tipo === "cedis" ? "CEDIS" : "Proveedor directo";
  pushMovimiento(DB, garantia, "envio", `Enviada a ${destino_nombre} (${destinoTipo})`, usuario);
  return garantia;
}

function actualizarUbicacion(DB, id, datos, usuario, alcance) {
  const garantia = buscarConGuardia(DB, id, alcance);
  if (garantia.estado !== "enviada") {
    throw new Error("Solo se puede actualizar la ubicación de una garantía 'enviada'");
  }
  const ubicacion = (datos.ubicacion_actual || "").trim();
  if (!ubicacion) throw new Error("Indica la nueva ubicación");

  garantia.ubicacion_actual = ubicacion;
  const desc = datos.notas ? `${ubicacion} — ${datos.notas}` : ubicacion;
  pushMovimiento(DB, garantia, "actualizacion_ubicacion", desc, usuario);
  return garantia;
}

function registrarResolucion(DB, id, datos, usuario, alcance) {
  const garantia = buscarConGuardia(DB, id, alcance);
  if (garantia.estado !== "enviada") {
    throw new Error("Solo se puede registrar la resolución de una garantía 'enviada'");
  }
  const tipo = datos.tipo_resolucion;
  if (!TIPOS_RESOLUCION.includes(tipo)) throw new Error("Tipo de resolución inválido");

  garantia.tipo_resolucion = tipo;
  garantia.notas_resolucion = datos.notas || null;

  if (TIPOS_CON_PRODUCTO.includes(tipo)) {
    garantia.costo_resolucion =
      datos.costo_resolucion != null && datos.costo_resolucion !== "" ? Number(datos.costo_resolucion) : null;
    garantia.estado = "resuelta";
  } else {
    // rechazada / nota_credito: no hay producto físico ni cargo — cierra directo
    garantia.costo_resolucion = null;
    garantia.estado = "cerrada";
  }

  const costoTxt = garantia.costo_resolucion != null ? `, costo $${garantia.costo_resolucion.toFixed(2)}` : "";
  pushMovimiento(DB, garantia, "resolucion", `Resuelta: ${tipo}${costoTxt}`, usuario);
  return garantia;
}

function recibirEnTienda(DB, id, usuario, alcance) {
  const garantia = buscarConGuardia(DB, id, alcance);
  if (garantia.estado !== "resuelta") {
    throw new Error("Solo se puede recibir una garantía 'resuelta'");
  }

  try {
    ajustarExistencia(DB, garantia.producto_id, {
      cantidad: 1,
      motivo: `Garantía ${garantia.folio} — recibida`,
      sucursal_id: garantia.sucursal_origen_id,
    });
  } catch (e) { /* sin registro de existencia en esta sucursal, no detiene la recepción */ }

  const sucursal = nombreSucursal(DB, garantia.sucursal_origen_id);
  garantia.ubicacion_actual = sucursal;

  if (garantia.cliente_id != null) {
    garantia.estado = "en_tienda_pendiente_entrega";
    pushMovimiento(DB, garantia, "recepcion", `Recibida en ${sucursal} — pendiente de entregar al cliente`, usuario);
  } else {
    garantia.estado = "cerrada";
    pushMovimiento(DB, garantia, "recepcion", `Recibida en ${sucursal} — reintegrada a inventario`, usuario);
  }
  return garantia;
}

function entregarACliente(DB, id, usuario, alcance) {
  const garantia = buscarConGuardia(DB, id, alcance);
  if (garantia.estado !== "en_tienda_pendiente_entrega") {
    throw new Error("Solo se puede entregar una garantía en 'en_tienda_pendiente_entrega'");
  }
  garantia.estado = "cerrada";
  pushMovimiento(DB, garantia, "entrega_cliente", "Entregada al cliente", usuario);
  return garantia;
}

function listarGarantias(DB, alcance) {
  const config = obtenerConfiguracion(DB);
  const umbral = Number(config.dias_alerta_garantias) || 15;

  let lista = DB.inventario.garantias;
  if (alcance && !alcance.verTodas) {
    lista = lista.filter((g) => g.sucursal_origen_id === alcance.sucursalId);
  }

  return lista
    .map((g) => {
      const cliente = g.cliente_id != null ? DB.crm.clientes.find((c) => c.id === g.cliente_id) : null;
      const producto = DB["catalogo-productos"].productos.find((p) => p.id === g.producto_id);
      const proveedor = g.proveedor_id != null
        ? DB["catalogo-productos"].proveedores.find((pr) => pr.id === g.proveedor_id)
        : null;
      const dias_sin_movimiento = diasEntre(g.fecha_ultimo_movimiento, hoy());
      return {
        ...g,
        cliente_nombre: cliente ? cliente.nombre : null,
        producto_nombre: producto ? producto.nombre : `Producto ${g.producto_id}`,
        sucursal_origen_nombre: nombreSucursal(DB, g.sucursal_origen_id),
        proveedor_nombre: proveedor ? proveedor.nombre : null,
        dias_sin_movimiento,
        atrasada: g.estado !== "cerrada" && dias_sin_movimiento > umbral,
        movimientos: DB.inventario.garantia_movimientos
          .filter((m) => m.garantia_id === g.id)
          .sort((a, b) => a.fecha.localeCompare(b.fecha)),
      };
    })
    .sort((a, b) => b.dias_sin_movimiento - a.dias_sin_movimiento);
}

module.exports = {
  crearGarantia, marcarEnviada, actualizarUbicacion, registrarResolucion,
  recibirEnTienda, entregarACliente, listarGarantias,
};
```

- [ ] **Step 7: Correr las pruebas para verificar que pasan**

Run: `cd backend && npx node --test garantias.test.js`
Expected: 19 pruebas, todas PASS.

- [ ] **Step 8: Correr toda la suite de backend**

Run: `cd backend && npm test`
Expected: toda la suite previa PASS + las 19 nuevas de `garantias.test.js`. Ninguna prueba existente se rompe.

- [ ] **Step 9: Commit**

```bash
git add backend/permisosCatalogo.js backend/configuracion.js backend/server.js backend/testHelpers.js backend/garantias.js backend/garantias.test.js
git commit -m "feat: add Garantías backend module (registrar/enviar/ubicacion/resolucion/recibir/entregar)"
```

---

### Task 2: Rutas Express en `server.js`

**Files:**
- Modify: `backend/server.js` (import del módulo + 7 rutas nuevas)

**Interfaces:**
- Consumes: `crearGarantia`, `marcarEnviada`, `actualizarUbicacion`, `registrarResolucion`, `recibirEnTienda`, `entregarACliente`, `listarGarantias` (Task 1); `requiereLogin`, `requierePermiso`, `resolverAlcance`, `resolverPermisosDeRol` (ya existentes en `server.js`).
- Produces: endpoints REST — `GET /api/garantias`, `POST /api/garantias`, `PUT /api/garantias/:id/enviar`, `PUT /api/garantias/:id/ubicacion`, `PUT /api/garantias/:id/resolucion`, `PUT /api/garantias/:id/recibir`, `PUT /api/garantias/:id/entregar-cliente`.

- [ ] **Step 1: Agregar el import del módulo**

En `backend/server.js`, junto al bloque de `require("./apartados")` (líneas ~30-36), agregar:

```js
const {
  crearGarantia, marcarEnviada, actualizarUbicacion, registrarResolucion,
  recibirEnTienda, entregarACliente, listarGarantias,
} = require("./garantias");
```

- [ ] **Step 2: Agregar las 7 rutas**

En `backend/server.js`, justo después del bloque de rutas `// ---------- Apartados ----------` (después de la ruta `PUT /api/apartados/:id/cancelar`, alrededor de la línea 956), agregar:

```js
// ---------- Garantías ----------
app.get("/api/garantias", requiereLogin, requierePermiso("gestionar_garantias", resolverPermisosDeRol), (req, res) => {
  const alcance = resolverAlcance(req);
  res.json(listarGarantias(DB, alcance));
});

app.post("/api/garantias", requiereLogin, requierePermiso("gestionar_garantias", resolverPermisosDeRol), (req, res) => {
  try {
    const alcance = resolverAlcance(req);
    const sucursal_origen_id = alcance.verTodas ? (Number(req.body.sucursal_origen_id) || 1) : alcance.sucursalId;
    const usuario = { id: req.usuarioToken.id, nombre: req.usuarioToken.nombre };
    res.json(crearGarantia(DB, req.body, sucursal_origen_id, usuario));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.put("/api/garantias/:id/enviar", requiereLogin, requierePermiso("gestionar_garantias", resolverPermisosDeRol), (req, res) => {
  try {
    const alcance = resolverAlcance(req);
    const usuario = { id: req.usuarioToken.id, nombre: req.usuarioToken.nombre };
    res.json(marcarEnviada(DB, req.params.id, req.body, usuario, alcance));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.put("/api/garantias/:id/ubicacion", requiereLogin, requierePermiso("gestionar_garantias", resolverPermisosDeRol), (req, res) => {
  try {
    const alcance = resolverAlcance(req);
    const usuario = { id: req.usuarioToken.id, nombre: req.usuarioToken.nombre };
    res.json(actualizarUbicacion(DB, req.params.id, req.body, usuario, alcance));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.put("/api/garantias/:id/resolucion", requiereLogin, requierePermiso("gestionar_garantias", resolverPermisosDeRol), (req, res) => {
  try {
    const alcance = resolverAlcance(req);
    const usuario = { id: req.usuarioToken.id, nombre: req.usuarioToken.nombre };
    res.json(registrarResolucion(DB, req.params.id, req.body, usuario, alcance));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.put("/api/garantias/:id/recibir", requiereLogin, requierePermiso("gestionar_garantias", resolverPermisosDeRol), (req, res) => {
  try {
    const alcance = resolverAlcance(req);
    const usuario = { id: req.usuarioToken.id, nombre: req.usuarioToken.nombre };
    res.json(recibirEnTienda(DB, req.params.id, usuario, alcance));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.put("/api/garantias/:id/entregar-cliente", requiereLogin, requierePermiso("gestionar_garantias", resolverPermisosDeRol), (req, res) => {
  try {
    const alcance = resolverAlcance(req);
    const usuario = { id: req.usuarioToken.id, nombre: req.usuarioToken.nombre };
    res.json(entregarACliente(DB, req.params.id, usuario, alcance));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
```

- [ ] **Step 3: Verificar que el servidor arranca sin errores de sintaxis**

Run: `cd backend && node -e "require('./server.js')" ` — o, si `server.js` levanta el puerto al requerirse, en su lugar: `cd backend && node --check server.js`
Expected: sin errores (exit 0). `node --check` valida la sintaxis sin ejecutar.

- [ ] **Step 4: Correr toda la suite de backend (regresión)**

Run: `cd backend && npm test`
Expected: toda la suite PASS (las rutas no tienen pruebas propias — el módulo ya está cubierto en Task 1; este paso confirma que el import y el archivo no rompieron nada).

- [ ] **Step 5: Commit**

```bash
git add backend/server.js
git commit -m "feat: expose Garantías REST routes (7 endpoints, gestionar_garantias)"
```

---

### Task 3: Plomería del frontend — tile del Dashboard, ruteo en App y campo de configuración

**Files:**
- Modify: `src/Dashboard.jsx`
- Modify: `src/App.jsx`
- Modify: `src/EncabezadoModulo.jsx`
- Modify: `src/Configuracion.jsx`

**Interfaces:**
- Consumes: componente `Garantias` (Task 4 — se importa aquí; el archivo se crea en la Task 4, así que esta tarea deja el import listo). Endpoint `GET/PUT /api/configuracion` (ya existente) con el nuevo campo `dias_alerta_garantias` (Task 1).
- Produces: la vista `"garantias"` navegable desde el Dashboard, con su título en el encabezado, y el control para editar `dias_alerta_garantias` en la pantalla de Configuración.

- [ ] **Step 1: Agregar el tile de Garantías al Dashboard**

En `src/Dashboard.jsx`, agregar `ShieldAlert` al import de `lucide-react` (línea 2):

```jsx
import { ShoppingCart, Users, Boxes, Lock, ShieldCheck, LogOut, Landmark, Store, ArrowRightLeft, FileBarChart, ShieldAlert } from "lucide-react";
```

Y agregar el tile al arreglo `MODULOS` (después del de `traspasos`):

```jsx
  { id: "garantias",  nombre: "Garantías",              icono: ShieldAlert,  disponible: true, modulo: "inventario", permiso: "gestionar_garantias" },
```

- [ ] **Step 2: Rutear la vista en `App.jsx`**

En `src/App.jsx`, agregar el import (después de `import Traspasos from "./Traspasos.jsx";`):

```jsx
import Garantias from "./Garantias.jsx";
```

Agregar `"garantias"` al arreglo `MODULOS` (línea 15):

```jsx
const MODULOS = ["pos", "inventario", "roles", "crm", "corte", "ml", "traspasos", "garantias", "reportes"];
```

Agregar el bloque de render (después del bloque `{vista === "traspasos" && (...)}`):

```jsx
        {vista === "garantias" && (
          <Garantias onVolver={() => setVista("dashboard")} permisos={usuario.permisos} usuario={usuario} />
        )}
```

- [ ] **Step 3: Agregar el título en el encabezado**

En `src/EncabezadoModulo.jsx`, dentro del objeto `TITULOS`, agregar (después de `traspasos:`):

```js
  garantias:  "Garantías",
```

- [ ] **Step 4: Agregar el campo `dias_alerta_garantias` a Configuración**

En `src/Configuracion.jsx`, dentro del bloque de la tarjeta "CRM / Postventa" (justo después del `</div>` que cierra el campo de "Días para seguimiento postventa", antes de la tarjeta siguiente), agregar una tarjeta nueva:

```jsx
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Garantías</h3>
            <div className="bg-white border border-slate-200 rounded-lg p-4 mb-6">
              <label className="text-xs text-slate-500 block mb-1">Días de alerta por garantía sin movimiento</label>
              <div className="flex items-center gap-2">
                <input
                  type="number" min="0" disabled={!puedeEditar}
                  value={config.dias_alerta_garantias}
                  onChange={(e) => guardarConfig({ dias_alerta_garantias: Number(e.target.value) || 0 })}
                  className="border border-slate-300 rounded px-3 py-1.5 text-sm w-24 disabled:bg-slate-100"
                />
                <span className="text-sm text-slate-500">días sin movimiento antes de marcarla como atrasada</span>
              </div>
              <p className="text-xs text-slate-400 mt-2">
                Cuando una garantía pasa estos días sin ningún movimiento en su bitácora, aparece marcada en rojo en la pantalla de Garantías para que nadie se pierda en el camino.
              </p>
            </div>
```

Nota: `config.dias_alerta_garantias` viene del backend porque `obtenerConfiguracion` fusiona con `CONFIG_DEFAULT` (Task 1, Step 2), así que siempre trae un valor.

- [ ] **Step 5: Verificar que el build de frontend no rompe**

Run: `npm run build`
Expected: build exitoso. (En este punto `Garantias.jsx` todavía no existe, así que el import de App.jsx fallará el build. Por eso: **no correr el build hasta después de la Task 4**, o crear un stub temporal. Para mantener cada tarea con un deliverable verificable, crear el stub mínimo ahora y reemplazarlo en la Task 4:)

Crear `src/Garantias.jsx` como stub temporal (se reemplaza completo en la Task 4):

```jsx
export default function Garantias() {
  return null;
}
```

Ahora sí:

Run: `npm run build`
Expected: build exitoso (exit 0), sin errores de importación.

- [ ] **Step 6: Commit**

```bash
git add src/Dashboard.jsx src/App.jsx src/EncabezadoModulo.jsx src/Configuracion.jsx src/Garantias.jsx
git commit -m "feat: wire Garantías into dashboard, routing, header and config screen"
```

---

### Task 4: Pantalla `src/Garantias.jsx`

**Files:**
- Modify: `src/Garantias.jsx` (reemplaza el stub de la Task 3 con la pantalla completa)

**Interfaces:**
- Consumes: endpoints de Task 2 (`/garantias`, `/garantias/:id/enviar`, `/ubicacion`, `/resolucion`, `/recibir`, `/entregar-cliente`); `/productos`, `/clientes`, `/proveedores`, `/sucursales` (ya existentes); helper `apiFetch` de `./api`. Props `{ onVolver, permisos, usuario }` (misma firma que `Traspasos`).
- Produces: pantalla con tabla de garantías (filtros "Solo atrasadas" y por estado), modal "Nueva garantía" (buscador de producto + selector de cliente opcional + folio de venta + notas del defecto) y modales de acción por fila según estado.

- [ ] **Step 1: Escribir la pantalla completa**

Reemplazar el contenido de `src/Garantias.jsx` con:

```jsx
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { ShieldAlert, Search, X, ChevronLeft, ChevronRight, Send, MapPin, ClipboardCheck, PackageCheck, UserCheck, History } from "lucide-react";
import { apiFetch } from "./api";

const inputCls = "w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:border-blue-500";
const RESULTADOS_POR_PAGINA = 8;

const ESTADOS = {
  registrada: "Registrada",
  enviada: "Enviada",
  resuelta: "Resuelta",
  en_tienda_pendiente_entrega: "En tienda (pend. entrega)",
  cerrada: "Cerrada",
};

const TIPOS_RESOLUCION = [
  { valor: "reparado", etiqueta: "Reparado", conProducto: true },
  { valor: "reemplazo", etiqueta: "Reemplazo", conProducto: true },
  { valor: "cambio_componente", etiqueta: "Cambio de componente", conProducto: true },
  { valor: "rechazada", etiqueta: "Rechazada (no procede)", conProducto: false },
  { valor: "nota_credito", etiqueta: "Nota de crédito / reembolso", conProducto: false },
];

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
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 animate-overlay-in">
      <div className={`bg-white rounded-xl shadow-2xl w-full ${ancho} max-h-[92vh] overflow-y-auto animate-panel-in`}>
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

const FORM_NUEVA = { producto_id: "", cliente_id: "", venta_id: "", notas_defecto: "", sucursal_origen_id: "" };
const FORM_ENVIAR = { destino_tipo: "proveedor", destino_nombre: "", proveedor_id: "" };
const FORM_UBICACION = { ubicacion_actual: "", notas: "" };
const FORM_RESOLUCION = { tipo_resolucion: "reparado", costo_resolucion: "", notas: "" };

export default function Garantias({ onVolver, permisos, usuario }) {
  const puede = (clave) => !permisos || permisos.includes(clave);

  const [garantias, setGarantias] = useState([]);
  const [productos, setProductos] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [proveedores, setProveedores] = useState([]);
  const [sucursales, setSucursales] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [aviso, setAviso] = useState(null);

  const [filtroEstado, setFiltroEstado] = useState("");
  const [soloAtrasadas, setSoloAtrasadas] = useState(false);

  const [modalNueva, setModalNueva] = useState(false);
  const [formNueva, setFormNueva] = useState(FORM_NUEVA);

  const [modalEnviar, setModalEnviar] = useState(null); // garantía o null
  const [formEnviar, setFormEnviar] = useState(FORM_ENVIAR);
  const [modalUbicacion, setModalUbicacion] = useState(null);
  const [formUbicacion, setFormUbicacion] = useState(FORM_UBICACION);
  const [modalResolucion, setModalResolucion] = useState(null);
  const [formResolucion, setFormResolucion] = useState(FORM_RESOLUCION);
  const [modalHistorial, setModalHistorial] = useState(null);

  // Buscador de producto (mismo patrón visual que Traspasos/POS)
  const [modalBuscarProd, setModalBuscarProd] = useState(false);
  const [busquedaProd, setBusquedaProd] = useState("");
  const [paginaProd, setPaginaProd] = useState(1);

  const mostrarAviso = (t) => { setAviso(t); setTimeout(() => setAviso(null), 2800); };

  const cargarGarantias = useCallback(async () => {
    try {
      const r = await apiFetch("/garantias");
      setGarantias(await r.json());
    } catch { mostrarAviso("❌ No se pudieron cargar las garantías"); }
  }, []);

  const cargarTodo = useCallback(async () => {
    setCargando(true);
    try {
      const [rProd, rCli, rProv, rSuc] = await Promise.all([
        apiFetch("/productos?sucursal_id=todas"), apiFetch("/clientes"), apiFetch("/proveedores"), apiFetch("/sucursales"),
      ]);
      setProductos(await rProd.json());
      setClientes(await rCli.json());
      setProveedores(await rProv.json());
      setSucursales(await rSuc.json());
      await cargarGarantias();
    } catch {
      mostrarAviso("❌ No se pudo conectar con el backend");
    } finally {
      setCargando(false);
    }
  }, [cargarGarantias]);

  useEffect(() => { cargarTodo(); }, [cargarTodo]);

  const nombreProducto = (id) => productos.find((p) => p.id === id)?.nombre || `Producto ${id}`;
  const productoSeleccionado = productos.find((p) => p.id === Number(formNueva.producto_id)) || null;

  // ---------- Crear ----------
  const abrirNueva = () => { setFormNueva(FORM_NUEVA); setModalNueva(true); };

  const crearGarantia = async () => {
    if (!formNueva.producto_id) return mostrarAviso("Selecciona un producto");
    try {
      const r = await apiFetch("/garantias?sucursal_id=todas", { method: "POST", body: JSON.stringify(formNueva) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      mostrarAviso("Garantía registrada");
      setModalNueva(false);
      await cargarGarantias();
    } catch (e) { mostrarAviso("❌ " + e.message); }
  };

  // ---------- Acciones por estado ----------
  const abrirEnviar = (g) => { setFormEnviar(FORM_ENVIAR); setModalEnviar(g); };
  const enviar = async () => {
    if (!formEnviar.destino_nombre.trim()) return mostrarAviso("Indica el destino del envío");
    try {
      const r = await apiFetch(`/garantias/${modalEnviar.id}/enviar?sucursal_id=todas`, { method: "PUT", body: JSON.stringify(formEnviar) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      mostrarAviso("Garantía enviada — 1 pieza descontada de existencia");
      setModalEnviar(null);
      await cargarGarantias();
    } catch (e) { mostrarAviso("❌ " + e.message); }
  };

  const abrirUbicacion = (g) => { setFormUbicacion(FORM_UBICACION); setModalUbicacion(g); };
  const actualizarUbicacion = async () => {
    if (!formUbicacion.ubicacion_actual.trim()) return mostrarAviso("Indica la nueva ubicación");
    try {
      const r = await apiFetch(`/garantias/${modalUbicacion.id}/ubicacion?sucursal_id=todas`, { method: "PUT", body: JSON.stringify(formUbicacion) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      mostrarAviso("Ubicación actualizada");
      setModalUbicacion(null);
      await cargarGarantias();
    } catch (e) { mostrarAviso("❌ " + e.message); }
  };

  const abrirResolucion = (g) => { setFormResolucion(FORM_RESOLUCION); setModalResolucion(g); };
  const tipoResSeleccionado = TIPOS_RESOLUCION.find((t) => t.valor === formResolucion.tipo_resolucion);
  const registrarResolucion = async () => {
    try {
      const payload = { ...formResolucion };
      if (!tipoResSeleccionado?.conProducto) payload.costo_resolucion = "";
      const r = await apiFetch(`/garantias/${modalResolucion.id}/resolucion?sucursal_id=todas`, { method: "PUT", body: JSON.stringify(payload) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      mostrarAviso("Resolución registrada");
      setModalResolucion(null);
      await cargarGarantias();
    } catch (e) { mostrarAviso("❌ " + e.message); }
  };

  const recibir = async (g) => {
    if (!confirm(`¿Recibir en tienda la garantía ${g.folio}? El producto se reintegra a la existencia de ${g.sucursal_origen_nombre}.`)) return;
    try {
      const r = await apiFetch(`/garantias/${g.id}/recibir?sucursal_id=todas`, { method: "PUT", body: JSON.stringify({}) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      mostrarAviso("Garantía recibida en tienda");
      await cargarGarantias();
    } catch (e) { mostrarAviso("❌ " + e.message); }
  };

  const entregar = async (g) => {
    if (!confirm(`¿Entregar al cliente la garantía ${g.folio}? Esto la cierra.`)) return;
    try {
      const r = await apiFetch(`/garantias/${g.id}/entregar-cliente?sucursal_id=todas`, { method: "PUT", body: JSON.stringify({}) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      mostrarAviso("Garantía entregada y cerrada");
      await cargarGarantias();
    } catch (e) { mostrarAviso("❌ " + e.message); }
  };

  // ---------- Filtros ----------
  const garantiasFiltradas = useMemo(() => {
    let lista = garantias;
    if (filtroEstado) lista = lista.filter((g) => g.estado === filtroEstado);
    if (soloAtrasadas) lista = lista.filter((g) => g.atrasada);
    return lista;
  }, [garantias, filtroEstado, soloAtrasadas]);

  // ---------- Buscador de producto ----------
  const productosFiltrados = useMemo(() => {
    const q = busquedaProd.toLowerCase();
    return productos.filter((p) => p.nombre.toLowerCase().includes(q) || (p.sku || "").toLowerCase().includes(q));
  }, [productos, busquedaProd]);
  const totalPaginasProd = Math.max(1, Math.ceil(productosFiltrados.length / RESULTADOS_POR_PAGINA));
  const productosPagina = productosFiltrados.slice((paginaProd - 1) * RESULTADOS_POR_PAGINA, paginaProd * RESULTADOS_POR_PAGINA);
  const abrirBuscarProd = () => { setBusquedaProd(""); setPaginaProd(1); setModalBuscarProd(true); };
  const elegirProducto = (p) => { setFormNueva((f) => ({ ...f, producto_id: p.id })); setModalBuscarProd(false); };

  return (
    <div className="w-full h-full flex flex-col bg-slate-50 text-slate-800 font-sans text-sm">
      {/* Barra de filtros + acción */}
      <div className="bg-white border-b border-slate-100 px-5 py-3 flex flex-wrap items-center gap-3 shrink-0">
        <select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)} className="border border-slate-300 rounded px-2 py-1 text-xs">
          <option value="">Todos los estados</option>
          {Object.entries(ESTADOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          <input type="checkbox" checked={soloAtrasadas} onChange={(e) => setSoloAtrasadas(e.target.checked)} />
          Solo atrasadas
        </label>
        <div className="flex-1" />
        {puede("gestionar_garantias") && (
          <button onClick={abrirNueva} className="bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold px-3 py-1.5 rounded flex items-center gap-1.5">
            <ShieldAlert size={14} /> Nueva garantía
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {cargando ? (
          <p className="text-center text-slate-400 py-16">Cargando...</p>
        ) : (
          <table className="w-full text-sm bg-white border border-slate-200 rounded-lg overflow-hidden">
            <thead className="bg-[#1a7fe8] text-white">
              <tr>
                <th className="py-2 px-3 text-left font-medium">Folio</th>
                <th className="py-2 px-3 text-left font-medium">Producto</th>
                <th className="py-2 px-3 text-left font-medium">Sucursal origen</th>
                <th className="py-2 px-3 text-left font-medium">Cliente</th>
                <th className="py-2 px-3 text-left font-medium">Estado</th>
                <th className="py-2 px-3 text-left font-medium">Ubicación</th>
                <th className="py-2 px-3 text-center font-medium">Días s/mov.</th>
                <th className="py-2 px-3 text-right font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {garantiasFiltradas.length === 0 && (
                <tr><td colSpan={8} className="text-center text-slate-400 py-10">Sin garantías</td></tr>
              )}
              {garantiasFiltradas.map((g) => (
                <tr key={g.id} className="border-b border-slate-100">
                  <td className="py-2 px-3 font-medium">{g.folio}</td>
                  <td className="py-2 px-3">{g.producto_nombre}</td>
                  <td className="py-2 px-3">{g.sucursal_origen_nombre}</td>
                  <td className="py-2 px-3 text-slate-500">{g.cliente_nombre || "—"}</td>
                  <td className="py-2 px-3">{ESTADOS[g.estado] || g.estado}</td>
                  <td className="py-2 px-3 text-slate-500">{g.ubicacion_actual}</td>
                  <td className="py-2 px-3 text-center">
                    {g.atrasada
                      ? <span className="inline-block bg-red-100 text-red-700 font-semibold px-2 py-0.5 rounded-full text-xs">{g.dias_sin_movimiento}</span>
                      : <span className="text-slate-500">{g.dias_sin_movimiento}</span>}
                  </td>
                  <td className="py-2 px-3">
                    <div className="flex items-center justify-end gap-1.5 flex-wrap">
                      {g.estado === "registrada" && puede("gestionar_garantias") && (
                        <button onClick={() => abrirEnviar(g)} className="bg-blue-600 hover:bg-blue-700 text-white text-xs px-2.5 py-1 rounded flex items-center gap-1"><Send size={12} /> Marcar enviada</button>
                      )}
                      {g.estado === "enviada" && puede("gestionar_garantias") && (
                        <>
                          <button onClick={() => abrirUbicacion(g)} className="bg-slate-600 hover:bg-slate-700 text-white text-xs px-2.5 py-1 rounded flex items-center gap-1"><MapPin size={12} /> Ubicación</button>
                          <button onClick={() => abrirResolucion(g)} className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs px-2.5 py-1 rounded flex items-center gap-1"><ClipboardCheck size={12} /> Resolución</button>
                        </>
                      )}
                      {g.estado === "resuelta" && puede("gestionar_garantias") && (
                        <button onClick={() => recibir(g)} className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs px-2.5 py-1 rounded flex items-center gap-1"><PackageCheck size={12} /> Recibir en tienda</button>
                      )}
                      {g.estado === "en_tienda_pendiente_entrega" && puede("gestionar_garantias") && (
                        <button onClick={() => entregar(g)} className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs px-2.5 py-1 rounded flex items-center gap-1"><UserCheck size={12} /> Entregar a cliente</button>
                      )}
                      <button onClick={() => setModalHistorial(g)} className="text-slate-500 hover:text-slate-700 text-xs px-2 py-1 rounded flex items-center gap-1"><History size={12} /> Historial</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {aviso && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-sm px-4 py-2 rounded-full shadow-lg z-[60] animate-toast-in">{aviso}</div>
      )}

      {/* Modal Nueva garantía */}
      {modalNueva && (
        <Modal titulo="Nueva garantía" onCerrar={() => setModalNueva(false)} ancho="max-w-md">
          <div className="flex flex-col gap-3">
            <Campo label="Producto">
              <button type="button" onClick={abrirBuscarProd} className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm text-left hover:bg-slate-50 flex items-center justify-between">
                <span className={productoSeleccionado ? "text-slate-800" : "text-slate-400"}>
                  {productoSeleccionado ? productoSeleccionado.nombre : "Buscar producto..."}
                </span>
                <Search size={14} className="text-slate-400 shrink-0" />
              </button>
            </Campo>
            {usuario?.ver_todas && (
              <Campo label="Sucursal de origen">
                <select className={inputCls} value={formNueva.sucursal_origen_id} onChange={(e) => setFormNueva({ ...formNueva, sucursal_origen_id: e.target.value })}>
                  <option value="">Selecciona...</option>
                  {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                </select>
              </Campo>
            )}
            <Campo label="Cliente (opcional — dejar en blanco si es stock propio)">
              <select className={inputCls} value={formNueva.cliente_id} onChange={(e) => setFormNueva({ ...formNueva, cliente_id: e.target.value })}>
                <option value="">Sin cliente (stock propio)</option>
                {clientes.filter((c) => c.id !== 0).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </Campo>
            <Campo label="Folio de venta (opcional)">
              <input className={inputCls} value={formNueva.venta_id} onChange={(e) => setFormNueva({ ...formNueva, venta_id: e.target.value })} placeholder="ej: 1024" />
            </Campo>
            <Campo label="Notas del defecto">
              <textarea className={inputCls} rows={2} value={formNueva.notas_defecto} onChange={(e) => setFormNueva({ ...formNueva, notas_defecto: e.target.value })} placeholder="ej: no enciende, viene con golpe..." />
            </Campo>
            <button onClick={crearGarantia} className="bg-blue-700 hover:bg-blue-800 text-white py-2 rounded font-semibold mt-1">Registrar garantía</button>
          </div>
        </Modal>
      )}

      {/* Modal Marcar enviada */}
      {modalEnviar && (
        <Modal titulo={`Marcar enviada — ${modalEnviar.folio}`} onCerrar={() => setModalEnviar(null)} ancho="max-w-md">
          <div className="flex flex-col gap-3">
            <Campo label="Destino">
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-1.5">
                  <input type="radio" name="destino_tipo" checked={formEnviar.destino_tipo === "proveedor"} onChange={() => setFormEnviar({ ...formEnviar, destino_tipo: "proveedor" })} /> Proveedor directo
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="radio" name="destino_tipo" checked={formEnviar.destino_tipo === "cedis"} onChange={() => setFormEnviar({ ...formEnviar, destino_tipo: "cedis" })} /> Vía CEDIS
                </label>
              </div>
            </Campo>
            <Campo label="Nombre del destino (a dónde se envía físicamente)">
              <input className={inputCls} value={formEnviar.destino_nombre} onChange={(e) => setFormEnviar({ ...formEnviar, destino_nombre: e.target.value })} placeholder={formEnviar.destino_tipo === "cedis" ? "ej: CEDIS" : "ej: Proveedor XYZ"} />
            </Campo>
            <Campo label="Proveedor (opcional)">
              <select className={inputCls} value={formEnviar.proveedor_id} onChange={(e) => setFormEnviar({ ...formEnviar, proveedor_id: e.target.value })}>
                <option value="">Sin definir aún</option>
                {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </Campo>
            <p className="text-xs text-slate-500">Al enviar se descuenta 1 pieza de la existencia de {modalEnviar.sucursal_origen_nombre}.</p>
            <button onClick={enviar} className="bg-blue-700 hover:bg-blue-800 text-white py-2 rounded font-semibold mt-1">Marcar enviada</button>
          </div>
        </Modal>
      )}

      {/* Modal Actualizar ubicación */}
      {modalUbicacion && (
        <Modal titulo={`Actualizar ubicación — ${modalUbicacion.folio}`} onCerrar={() => setModalUbicacion(null)} ancho="max-w-md">
          <div className="flex flex-col gap-3">
            <Campo label="Nueva ubicación">
              <input className={inputCls} value={formUbicacion.ubicacion_actual} onChange={(e) => setFormUbicacion({ ...formUbicacion, ubicacion_actual: e.target.value })} placeholder="ej: Proveedor XYZ (CEDIS reenvía)" />
            </Campo>
            <Campo label="Notas (opcional)">
              <input className={inputCls} value={formUbicacion.notas} onChange={(e) => setFormUbicacion({ ...formUbicacion, notas: e.target.value })} />
            </Campo>
            <button onClick={actualizarUbicacion} className="bg-slate-700 hover:bg-slate-800 text-white py-2 rounded font-semibold mt-1">Guardar ubicación</button>
          </div>
        </Modal>
      )}

      {/* Modal Registrar resolución */}
      {modalResolucion && (
        <Modal titulo={`Registrar resolución — ${modalResolucion.folio}`} onCerrar={() => setModalResolucion(null)} ancho="max-w-md">
          <div className="flex flex-col gap-3">
            <Campo label="Tipo de resolución">
              <select className={inputCls} value={formResolucion.tipo_resolucion} onChange={(e) => setFormResolucion({ ...formResolucion, tipo_resolucion: e.target.value })}>
                {TIPOS_RESOLUCION.map((t) => <option key={t.valor} value={t.valor}>{t.etiqueta}</option>)}
              </select>
            </Campo>
            {tipoResSeleccionado?.conProducto && (
              <Campo label="Costo de la resolución (opcional — en blanco = gratis)">
                <input type="number" min="0" step="0.01" className={inputCls} value={formResolucion.costo_resolucion} onChange={(e) => setFormResolucion({ ...formResolucion, costo_resolucion: e.target.value })} placeholder="0.00" />
              </Campo>
            )}
            <Campo label="Notas">
              <textarea className={inputCls} rows={2} value={formResolucion.notas} onChange={(e) => setFormResolucion({ ...formResolucion, notas: e.target.value })} placeholder={tipoResSeleccionado?.conProducto ? "detalle de la reparación/reemplazo" : "monto del crédito, motivo del rechazo, etc."} />
            </Campo>
            {!tipoResSeleccionado?.conProducto && (
              <p className="text-xs text-slate-500">Rechazada y nota de crédito cierran la garantía de inmediato (no hay producto físico de regreso).</p>
            )}
            <button onClick={registrarResolucion} className="bg-emerald-600 hover:bg-emerald-700 text-white py-2 rounded font-semibold mt-1">Registrar resolución</button>
          </div>
        </Modal>
      )}

      {/* Modal Historial */}
      {modalHistorial && (
        <Modal titulo={`Historial — ${modalHistorial.folio}`} onCerrar={() => setModalHistorial(null)} ancho="max-w-lg">
          <div className="flex flex-col gap-2">
            {(modalHistorial.movimientos || []).length === 0 && <p className="text-slate-400 text-sm">Sin movimientos.</p>}
            {(modalHistorial.movimientos || []).map((m) => (
              <div key={m.id} className="border-b border-slate-100 pb-2">
                <div className="text-xs text-slate-400">{new Date(m.fecha).toLocaleString()} — {m.usuario}</div>
                <div className="text-sm">{m.descripcion}</div>
              </div>
            ))}
          </div>
        </Modal>
      )}

      {/* Modal Buscar producto */}
      {modalBuscarProd && (
        <Modal titulo="Buscar producto" onCerrar={() => setModalBuscarProd(false)} ancho="max-w-3xl">
          <input
            autoFocus
            value={busquedaProd}
            onChange={(e) => { setBusquedaProd(e.target.value); setPaginaProd(1); }}
            placeholder="Clave o descripción..."
            className="w-full border border-slate-300 rounded px-3 py-2 mb-3 focus:outline-none focus:border-blue-500"
          />
          <div className="max-h-96 overflow-y-auto border border-slate-200 rounded">
            <table className="w-full text-sm">
              <thead className="bg-[#1a7fe8] text-white sticky top-0">
                <tr>
                  <th className="py-2 px-3 text-left font-medium">Clave / Descripción</th>
                  <th className="py-2 px-3 text-right font-medium w-24">Precio</th>
                </tr>
              </thead>
              <tbody>
                {productosPagina.length === 0 && (
                  <tr><td colSpan={2} className="text-center text-slate-400 py-10">Sin resultados</td></tr>
                )}
                {productosPagina.map((p) => (
                  <tr key={p.id} onClick={() => elegirProducto(p)} className="border-b border-slate-100 hover:bg-blue-50 cursor-pointer">
                    <td className="py-2 px-3">
                      <div className="text-[11px] text-slate-400">{p.sku}</div>
                      <div className="font-medium">{p.nombre}</div>
                    </td>
                    <td className="py-2 px-3 text-right font-semibold text-blue-700">${Number(p.precio_venta).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-center gap-3 mt-3">
            <button disabled={paginaProd <= 1} onClick={() => setPaginaProd((p) => p - 1)} className="p-1.5 rounded border border-slate-300 disabled:opacity-30"><ChevronLeft size={16} /></button>
            <span className="text-xs text-slate-500">Página {paginaProd} de {totalPaginasProd}</span>
            <button disabled={paginaProd >= totalPaginasProd} onClick={() => setPaginaProd((p) => p + 1)} className="p-1.5 rounded border border-slate-300 disabled:opacity-30"><ChevronRight size={16} /></button>
          </div>
        </Modal>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verificar que el build de frontend pasa**

Run: `npm run build`
Expected: build exitoso (exit 0), sin errores.

- [ ] **Step 3: Verificación manual en navegador (convención del repo: el frontend no tiene pruebas automáticas)**

Run: `npm run dev` (y el backend en otra terminal: `cd backend && npm start`)

Verificar el flujo completo, iniciando sesión con un usuario que tenga el permiso `gestionar_garantias`:
1. El tile "Garantías" aparece en el Dashboard.
2. Nueva garantía **sin cliente** (stock propio): se crea en estado "Registrada", ubicación = la sucursal.
3. Marcar enviada con destino **vía CEDIS**: estado pasa a "Enviada", ubicación = "CEDIS"; verificar en Inventario que la existencia del producto bajó 1.
4. Actualizar ubicación a "Proveedor XYZ": la ubicación cambia, el estado sigue "Enviada".
5. Registrar resolución **reparado** con costo: pasa a "Resuelta".
6. Recibir en tienda: como no hay cliente, pasa directo a "Cerrada"; verificar que la existencia volvió a subir 1.
7. Nueva garantía **con cliente** y destino **proveedor directo**: repetir hasta "Resuelta" → Recibir en tienda → pasa a "En tienda (pend. entrega)" → Entregar a cliente → "Cerrada".
8. Nueva garantía → enviar → registrar resolución **rechazada**: cierra de inmediato sin pasar por recibir, y la existencia NO se reintegra.
9. Nueva garantía → enviar → resolución **nota de crédito**: cierra de inmediato.
10. Filtro "Solo atrasadas" y filtro por estado funcionan. Para probar el badge rojo: bajar `dias_alerta_garantias` a 0 en Configuración y recargar — las garantías activas con ≥1 día sin movimiento aparecen en rojo.
11. Ver el "Historial" de una garantía cerrada: muestra toda la bitácora (creación → envío → ubicación → resolución → recepción → entrega).

- [ ] **Step 4: Commit**

```bash
git add src/Garantias.jsx
git commit -m "feat: add Garantías screen (table, filters, per-status action modals, history)"
```

---

## Self-Review

Revisión del plan contra el spec `2026-07-22-garantias-design.md`, con ojos frescos.

### 1. Spec coverage

- **Modelo de datos `DB.inventario.garantias`** (todos los campos: id, folio, sucursal_origen_id, producto_id, cliente_id, venta_id, proveedor_id, estado, ubicacion_actual, tipo_resolucion, costo_resolucion, notas_resolucion, fecha_creacion, fecha_ultimo_movimiento, usuario_creacion) → Task 1, Step 6 (`crearGarantia`). ✔
- **Bitácora `DB.inventario.garantia_movimientos`** (id, garantia_id, fecha, usuario, tipo, descripcion; tipos creacion/envio/actualizacion_ubicacion/resolucion/recepcion/entrega_cliente) → Task 1 `pushMovimiento` + cada función usa su tipo. ✔
- **Guard `dentroDeAlcance` desde el día uno en cada función mutadora** → Task 1 `buscarConGuardia`, usado por marcarEnviada/actualizarUbicacion/registrarResolucion/recibirEnTienda/entregarACliente; test dedicado. ✔
- **Máquina de estados completa** incl. rechazada/nota_credito saltando a cerrada, y en_tienda_pendiente_entrega solo si hay cliente → Task 1 registrarResolucion + recibirEnTienda; tests para ambos caminos. ✔
- **Impacto de existencia** (−1 en enviar, +1 en recibir, nunca en rechazada/nota_credito) → Task 1 marcarEnviada/recibirEnTienda; tests de neto 0 y de "rechazada no reintegra". ✔
- **`listarGarantias` con dias_sin_movimiento y atrasada vs umbral configurable + filtro por alcance** → Task 1; tests. ✔
- **Config `dias_alerta_garantias: 15`** → Task 1 Step 2 (backend) + Task 3 Step 4 (UI). ✔
- **Permiso `gestionar_garantias` (módulo inventario)** → Task 1 Step 1. ✔
- **Rutas Express (las 7 exactas del spec)** → Task 2. ✔
- **Dashboard tile con ShieldAlert** → Task 3 Step 1. ✔
- **Pantalla `src/Garantias.jsx`** (tabla con columnas del spec, filtro "Solo atrasadas" + por estado, modal Nueva Garantía con buscador de producto / cliente opcional / folio venta / notas, acciones por fila según estado, badge rojo si atrasada) → Task 4. ✔
- **Reutilizar buscador de producto y selector de cliente existentes** → Task 4 reusa el patrón del buscador de Traspasos y un `<select>` de `/clientes` (los clientes son pocos; mismo criterio que el resto del repo). ✔
- **Testing backend con node --test; frontend manual** → Task 1 (pruebas) + Task 4 Step 3 (checklist manual). ✔
- **Fuera de alcance** (aviso CRM, notificaciones al proveedor, fotos, permisos por paso, reporte dedicado) → correctamente NO incluidos en ninguna tarea. ✔

Sin huecos detectados.

### 2. Placeholder scan

Sin "TBD"/"TODO"/"implement later". Todos los pasos de código traen el código real y completo. Los comentarios `/* ... no detiene ... */` son manejo de error deliberado copiado del patrón de `apartados.js`/`ajustarExistencia` (no placeholders). No hay "similar a Task N": el buscador de producto se repite completo en Task 4 en vez de referenciarse.

### 3. Type consistency

- Firmas de funciones idénticas entre el bloque **Interfaces** de Task 1, la implementación (Step 6), las rutas de Task 2 y las llamadas del frontend de Task 4. `crearGarantia(DB, datos, sucursalId, usuario)` sin `alcance`; las 5 mutadoras por `:id` reciben `alcance` como último argumento; `listarGarantias(DB, alcance)`. ✔
- Nombres de estado consistentes en backend, `ESTADOS` del frontend y checklist manual: `registrada`/`enviada`/`resuelta`/`en_tienda_pendiente_entrega`/`cerrada`. ✔
- `tipo_resolucion` consistente: backend `TIPOS_RESOLUCION` = frontend `TIPOS_RESOLUCION` (reparado/reemplazo/cambio_componente/rechazada/nota_credito); `conProducto` del frontend equivale a `TIPOS_CON_PRODUCTO` del backend. ✔
- Payloads del frontend coinciden con lo que leen las funciones: enviar `{ destino_tipo, destino_nombre, proveedor_id }`, ubicación `{ ubicacion_actual, notas }`, resolución `{ tipo_resolucion, costo_resolucion, notas }`, crear `{ producto_id, cliente_id, venta_id, notas_defecto, sucursal_origen_id }`. ✔
- Campos enriquecidos que consume la tabla (`producto_nombre`, `sucursal_origen_nombre`, `cliente_nombre`, `dias_sin_movimiento`, `atrasada`, `movimientos`) son exactamente los que produce `listarGarantias`. ✔

Sin inconsistencias.
