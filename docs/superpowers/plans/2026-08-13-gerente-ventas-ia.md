# Gerente de Ventas IA (v1: rol Cajero/Vendedor) — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que cada Cajero/Vendedor vea en su dashboard su meta de venta del mes, su progreso, y tareas concretas sugeridas (contactar clientes en riesgo, empujar el producto con demanda proyectada alta) — con un chat para pedir ajustes, acotado a dos acciones controladas.

**Architecture:** Motor determinista en JS puro (`backend/gerenteVentas.js`) que calcula progreso y arma tareas reutilizando `crm.js`/`predicciones.js` ya existentes — 100% probable con `node --test`. Una capa delgada sobre el mismo cliente Anthropic que ya usa `/api/chat` solo redacta ese resultado en lenguaje natural y atiende ajustes, con acceso de escritura limitado a dos herramientas (reemplazar/descartar tarea) — nunca decide qué asignar por su cuenta.

**Tech Stack:** Node.js/CommonJS en `backend/`, `node --test`, SDK `@anthropic-ai/sdk` ya instalado (sin dependencias nuevas), React 18 + Vite + Tailwind en `src/` (sin pruebas automatizadas de frontend — convención ya establecida en este repo).

**Spec:** `docs/superpowers/specs/2026-08-13-gerente-ventas-ia-design.md`

## Global Constraints

Estas reglas ya rigen todo el repo y aplican a cada tarea de este plan:

1. Backend es CommonJS (`require`/`module.exports`). Frontend es ESM. No mezclar.
2. Pruebas con `node --test` desde `backend/`: `const { test } = require("node:test"); const assert = require("node:assert");`. Archivo `backend/<nombre>.test.js`.
3. Sin dependencias nuevas — todo con lo que ya está instalado.
4. Guard de alcance/identidad DENTRO del módulo, nunca solo en la ruta: cada función que toca una tarea o un vendedor debe validar que pertenece a quien hace la petición, no confiar en que la ruta ya filtró.
5. `RESPALDO_LLAVE`, contraseñas, tokens: nunca en un prompt a Claude, en bitácora, ni en respuesta HTTP. El JSON que se le pasa a la IA solo trae progreso/tareas/nombres — nada de credenciales.
6. Fechas solas (`YYYY-MM-DD`) con `fechaLocal()` de `backend/fechas.js`.
7. La IA nunca decide qué tarea asignar por su cuenta — solo redacta datos que YA calculó el motor determinista, y sus únicas dos acciones de escritura (`reemplazar_tarea`, `descartar_tarea`) deben quedar verificadas por mutación: quitar la restricción de qué tareas puede tocar debe poner una prueba en rojo.

---

### Task 1: Infraestructura — permisos, rol, campo de personal, colección nueva

**Files:**
- Modify: `backend/permisosCatalogo.js`
- Modify: `backend/roles.js`
- Modify: `backend/usuarios.js`
- Modify: `backend/server.js` (seed inicial de `DB.pos`, línea ~145 donde vive `apartado_abonos: []`)
- Modify: `backend/testHelpers.js` (mismo seed, para que los tests de otros módulos no se rompan)
- Test: `backend/usuarios.test.js`, `backend/rolesReconciliacion.test.js` (agregar casos, no crear archivo nuevo)

**Interfaces:**
- Produces: permiso `usar_gerente_ventas` (módulo `pos`), permiso `editar_objetivos_venta` (módulo `pos`); `crearUsuario`/`actualizarUsuario` aceptan `vendedor_id` opcional; `DB.pos.tareas_venta` existe como `[]` en todo DB nuevo o restaurado.

- [ ] **Step 1: Agregar los dos permisos al catálogo**

En `backend/permisosCatalogo.js`, busca el bloque `// ---- Clientes (dentro de CRM / catálogo de clientes) ----` y agrega, justo antes de esa sección (o en cualquier punto dentro del arreglo `PERMISOS`, agrupado con los demás de `pos`):

```js
  { clave: "usar_gerente_ventas", etiqueta: "Usar el Gerente de Ventas IA (dashboard y chat propio)", modulo: "pos", implementado: true },
  { clave: "editar_objetivos_venta", etiqueta: "Fijar Objetivos de Venta del Personal", modulo: "pos", implementado: true },
```

- [ ] **Step 2: Dar el permiso nuevo al rol Cajero**

En `backend/roles.js`, dentro de `sembrarRolesIniciales`, localiza el `crearRol(DB, { nombre: "Cajero", ...})` y agrega `"usar_gerente_ventas"` a su lista de `permisos`, junto a `"usar_asistente_ia"`:

```js
      "ver_lista_ventas", "mostrar_detalle_venta", "usar_asistente_ia", "usar_gerente_ventas",
```//

(reemplaza la línea existente `"ver_lista_ventas", "mostrar_detalle_venta", "usar_asistente_ia",` por la de arriba, sin la doble barra al final — es solo para que ubiques la línea).

No se toca la lista del rol "Gerente de sucursal": ese rol ya recibe TODOS los permisos del catálogo salvo la lista explícita de exclusión (`eliminar_producto`, `administrar_roles`, `dar_alta_personal`, `ver_todas_las_sucursales`), así que `editar_objetivos_venta` y `usar_gerente_ventas` ya le llegan solos.

- [ ] **Step 3: Escribir la prueba que falla para el campo `vendedor_id` en usuarios**

Agrega a `backend/usuarios.test.js` (al final del archivo):

```js
test("crearUsuario: acepta vendedor_id opcional y lo guarda", async () => {
  const DB = require("./testHelpers").construirDBPrueba();
  const cajero = DB.admin.roles.find((r) => r.nombre === "Cajero");
  const u = await crearUsuario(DB, {
    nombre: "Ana López", usuario: "analopez", password: "123456",
    rol_id: cajero.id, sucursal_id: 1, vendedor_id: 1,
  });
  assert.strictEqual(u.vendedor_id, 1);
  assert.strictEqual(DB.admin.usuarios.find((x) => x.id === u.id).vendedor_id, 1);
});

test("crearUsuario: sin vendedor_id lo deja en null (no participa del Gerente de Ventas IA)", async () => {
  const DB = require("./testHelpers").construirDBPrueba();
  const cajero = DB.admin.roles.find((r) => r.nombre === "Cajero");
  const u = await crearUsuario(DB, {
    nombre: "Carlos Ruiz", usuario: "carlosruiz", password: "123456",
    rol_id: cajero.id, sucursal_id: 1,
  });
  assert.strictEqual(u.vendedor_id, null);
});

test("actualizarUsuario: puede ligar vendedor_id a una cuenta ya existente", async () => {
  const DB = require("./testHelpers").construirDBPrueba();
  const cajero = DB.admin.roles.find((r) => r.nombre === "Cajero");
  const u = await crearUsuario(DB, {
    nombre: "Pedro L.", usuario: "pedrol", password: "123456",
    rol_id: cajero.id, sucursal_id: 1,
  });
  const actualizado = await actualizarUsuario(DB, u.id, { vendedor_id: 4 });
  assert.strictEqual(actualizado.vendedor_id, 4);
});

test("actualizarUsuario: sin mandar vendedor_id, no lo borra", async () => {
  const DB = require("./testHelpers").construirDBPrueba();
  const cajero = DB.admin.roles.find((r) => r.nombre === "Cajero");
  const u = await crearUsuario(DB, {
    nombre: "María R.", usuario: "mariar", password: "123456",
    rol_id: cajero.id, sucursal_id: 1, vendedor_id: 3,
  });
  const actualizado = await actualizarUsuario(DB, u.id, { nombre: "María R. (editado)" });
  assert.strictEqual(actualizado.vendedor_id, 3);
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd backend && node --test usuarios.test.js`
Expected: FAIL — `u.vendedor_id` es `undefined`, no `1`/`null` (el campo no existe todavía).

- [ ] **Step 5: Implementar el campo `vendedor_id` en `usuarios.js`**

En `crearUsuario`, dentro del objeto `nuevo`, agrega el campo (después de `activo: true,`):

```js
    activo: true,
    vendedor_id: datos.vendedor_id !== undefined && datos.vendedor_id !== null ? Number(datos.vendedor_id) : null,
```

En `actualizarUsuario`, dentro del objeto que se reconstruye, agrega (después de `activo: ...`):

```js
    activo: datos.activo !== undefined ? !!datos.activo : DB.admin.usuarios[idx].activo,
    vendedor_id: datos.vendedor_id !== undefined ? (datos.vendedor_id === null ? null : Number(datos.vendedor_id)) : DB.admin.usuarios[idx].vendedor_id,
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd backend && node --test usuarios.test.js`
Expected: PASS, todas las pruebas del archivo (las nuevas y las que ya existían).

- [ ] **Step 7: Agregar `tareas_venta: []` a la forma del DB**

En `backend/server.js`, dentro del objeto `DB.pos` (busca `apartado_abonos: [],`), agrega justo después:

```js
    apartado_abonos: [],
    tareas_venta: [],
```

En `backend/testHelpers.js`, dentro de `DB.pos` de `construirDBPrueba()` (mismo lugar, busca `apartado_abonos: [],`), agrega igual:

```js
      apartado_abonos: [],
      tareas_venta: [],
```

Esto basta para que las bases de datos YA persistidas en producción reciban la colección nueva vacía en el próximo arranque: el merge de `server.js:246-257` solo sobreescribe `DB[modulo][tabla]` cuando `estadoGuardado[modulo][tabla] !== undefined`, así que una base vieja sin `tareas_venta` deja el `[]` recién sembrado tal cual, sin necesitar ninguna migración explícita.

- [ ] **Step 8: Correr toda la suite para confirmar que nada se rompió**

Run: `cd backend && node --test`
Expected: PASS, todas las pruebas (las nuevas de este task incluidas).

- [ ] **Step 9: Commit**

```bash
git add backend/permisosCatalogo.js backend/roles.js backend/usuarios.js backend/usuarios.test.js backend/server.js backend/testHelpers.js
git commit -m "feat(gerente-ventas): permisos, rol Cajero, campo vendedor_id y coleccion tareas_venta"
```

---

### Task 2: Motor determinista — progreso contra el objetivo

**Files:**
- Create: `backend/gerenteVentas.js`
- Test: `backend/gerenteVentas.test.js`

**Interfaces:**
- Consumes: `fechaLocal` (`backend/fechas.js`), `DB.pos.vendedores` / `DB.pos.ventas` (ya existen).
- Produces: `calcularProgreso(DB, vendedorId, ahoraMs = Date.now()) → { vendedor_id, meta, vendido_mes, porcentaje, faltante, sin_meta }` — usado por Task 3 y Task 4.

- [ ] **Step 1: Escribir las pruebas que fallan**

Crea `backend/gerenteVentas.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { calcularProgreso } = require("./gerenteVentas");
const { construirDBPrueba } = require("./testHelpers");

const AGOSTO = Date.parse("2026-08-13T18:00:00.000Z");

test("calcularProgreso: suma solo las ventas cerradas del vendedor en el mes en curso", () => {
  const DB = construirDBPrueba();
  DB.pos.ventas.push(
    { id: 100, fecha: "2026-08-01", sucursal_id: 1, vendedor_id: 1, cliente_id: 1, total: 1000, estatus: "cerrada" },
    { id: 101, fecha: "2026-08-10", sucursal_id: 1, vendedor_id: 1, cliente_id: 1, total: 2000, estatus: "cerrada" },
    { id: 102, fecha: "2026-08-11", sucursal_id: 1, vendedor_id: 1, cliente_id: 1, total: 500, estatus: "cancelada" }, // no cuenta
    { id: 103, fecha: "2026-07-30", sucursal_id: 1, vendedor_id: 1, cliente_id: 1, total: 9999, estatus: "cerrada" }, // mes anterior, no cuenta
    { id: 104, fecha: "2026-08-05", sucursal_id: 1, vendedor_id: 3, cliente_id: 1, total: 5000, estatus: "cerrada" }, // otro vendedor, no cuenta
  );
  const r = calcularProgreso(DB, 1, AGOSTO);
  assert.strictEqual(r.vendido_mes, 3000);
});

test("calcularProgreso: calcula porcentaje y faltante contra meta_mensual", () => {
  const DB = construirDBPrueba();
  DB.pos.vendedores.find((v) => v.id === 1).meta_mensual = 10000;
  DB.pos.ventas.push({ id: 100, fecha: "2026-08-01", sucursal_id: 1, vendedor_id: 1, cliente_id: 1, total: 4000, estatus: "cerrada" });
  const r = calcularProgreso(DB, 1, AGOSTO);
  assert.strictEqual(r.meta, 10000);
  assert.strictEqual(r.vendido_mes, 4000);
  assert.strictEqual(r.porcentaje, 40);
  assert.strictEqual(r.faltante, 6000);
  assert.strictEqual(r.sin_meta, false);
});

test("calcularProgreso: 0 ventas en el mes da porcentaje 0, faltante = meta completa", () => {
  const DB = construirDBPrueba();
  DB.pos.vendedores.find((v) => v.id === 1).meta_mensual = 5000;
  const r = calcularProgreso(DB, 1, AGOSTO);
  assert.strictEqual(r.vendido_mes, 0);
  assert.strictEqual(r.porcentaje, 0);
  assert.strictEqual(r.faltante, 5000);
});

test("calcularProgreso: meta en 0 marca sin_meta y no divide entre cero", () => {
  const DB = construirDBPrueba();
  DB.pos.vendedores.find((v) => v.id === 1).meta_mensual = 0;
  const r = calcularProgreso(DB, 1, AGOSTO);
  assert.strictEqual(r.sin_meta, true);
  assert.strictEqual(r.porcentaje, null);
  assert.strictEqual(r.faltante, null);
});

test("calcularProgreso: faltante nunca es negativo si ya se superó la meta", () => {
  const DB = construirDBPrueba();
  DB.pos.vendedores.find((v) => v.id === 1).meta_mensual = 1000;
  DB.pos.ventas.push({ id: 100, fecha: "2026-08-01", sucursal_id: 1, vendedor_id: 1, cliente_id: 1, total: 5000, estatus: "cerrada" });
  const r = calcularProgreso(DB, 1, AGOSTO);
  assert.strictEqual(r.faltante, 0);
  assert.strictEqual(r.porcentaje, 500);
});

test("calcularProgreso: lanza error si el vendedor no existe", () => {
  const DB = construirDBPrueba();
  assert.throws(() => calcularProgreso(DB, 999, AGOSTO), /Vendedor no encontrado/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test gerenteVentas.test.js`
Expected: FAIL — `Cannot find module './gerenteVentas'`.

- [ ] **Step 3: Implementar `calcularProgreso`**

Crea `backend/gerenteVentas.js`:

```js
/**
 * gerenteVentas.js — Motor determinista del "Gerente de Ventas IA".
 *
 * JS puro, sin llamadas a ningún modelo de lenguaje: calcula progreso contra
 * el objetivo y arma la lista de tareas sugeridas a partir de datos que YA
 * existen y ya están probados (crm.js, predicciones.js). La capa de IA
 * (server.js) solo redacta este resultado en lenguaje natural — nunca decide
 * qué tarea asignar. Ver docs/superpowers/specs/2026-08-13-gerente-ventas-ia-design.md.
 */

const { fechaLocal } = require("./fechas");

function mesDe(fechaISO) {
  return (fechaISO || "").slice(0, 7); // "YYYY-MM"
}

/** Progreso del vendedor contra su meta_mensual, en el mes en curso (hora de la tienda). */
function calcularProgreso(DB, vendedorId, ahoraMs = Date.now()) {
  const vendedor = DB.pos.vendedores.find((v) => v.id === Number(vendedorId));
  if (!vendedor) throw new Error("Vendedor no encontrado");

  const mesActual = mesDe(fechaLocal(ahoraMs));
  const vendido_mes = DB.pos.ventas
    .filter((v) => v.vendedor_id === vendedor.id && v.estatus === "cerrada" && mesDe(v.fecha) === mesActual)
    .reduce((total, v) => total + Number(v.total), 0);

  const meta = Number(vendedor.meta_mensual) || 0;
  const sinMeta = meta <= 0;

  return {
    vendedor_id: vendedor.id,
    meta,
    vendido_mes,
    porcentaje: sinMeta ? null : Math.round((vendido_mes / meta) * 1000) / 10,
    faltante: sinMeta ? null : Math.max(0, meta - vendido_mes),
    sin_meta: sinMeta,
  };
}

module.exports = { calcularProgreso };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --test gerenteVentas.test.js`
Expected: PASS, las 6 pruebas.

- [ ] **Step 5: Commit**

```bash
git add backend/gerenteVentas.js backend/gerenteVentas.test.js
git commit -m "feat(gerente-ventas): calcularProgreso — motor determinista de progreso vs meta"
```

---

### Task 3: Motor determinista — tareas sugeridas y su persistencia

**Files:**
- Modify: `backend/gerenteVentas.js`
- Modify: `backend/gerenteVentas.test.js`

**Interfaces:**
- Consumes: `listarClientesCRM(DB, alcance)` (`backend/crm.js`, ya devuelve `segmento` por cliente), `predecirDemanda(DB, {producto_id, meses_adelante})` (`backend/predicciones.js`), `calcularProgreso` (Task 2).
- Produces: `generarTareas(DB, vendedorId) → [{tipo, descripcion, cliente_id?, producto_id?}]`, `insertarTareasNuevas(DB, vendedorId, ahoraISO) → [tarea]` (persiste y regresa las pendientes), `marcarTarea(DB, tareaId, nuevoEstado, ahoraISO) → tarea`, `reemplazarTarea(DB, tareaId, nuevaDescripcion, ahoraISO) → tarea`, `descartarTarea(DB, tareaId, ahoraISO) → tarea`, `actualizarMetaVendedor(DB, vendedorId, nuevaMeta) → vendedor` — usados por Task 4 y Task 5.

- [ ] **Step 1: Escribir las pruebas que fallan**

Agrega a `backend/gerenteVentas.test.js`:

```js
const { generarTareas, insertarTareasNuevas, marcarTarea, reemplazarTarea, descartarTarea, actualizarMetaVendedor } = require("./gerenteVentas");

test("generarTareas: sugiere contactar a un cliente en_riesgo asignado al vendedor", () => {
  const DB = construirDBPrueba();
  // Cliente 1 ya está asignado a vendedor 1 en el fixture, con ultimo_contacto 2026-06-05
  // (más de 90 días antes del AGOSTO fijo de estas pruebas => segmento "inactivo").
  const tareas = generarTareas(DB, 1);
  const deCliente = tareas.find((t) => t.tipo === "contactar_cliente" && t.cliente_id === 1);
  assert.ok(deCliente, "debió sugerir contactar al cliente 1");
  assert.match(deCliente.descripcion, /Abarrotes Mary/);
});

test("generarTareas: NO sugiere un cliente activo (compró hace poco)", () => {
  const DB = construirDBPrueba();
  const cliente = DB.crm.clientes.find((c) => c.id === 1);
  cliente.ultimo_contacto = "2026-08-10";
  DB.pos.ventas.push({ id: 200, fecha: "2026-08-10", sucursal_id: 1, vendedor_id: 1, cliente_id: 1, total: 100, estatus: "cerrada" });
  const tareas = generarTareas(DB, 1);
  assert.ok(!tareas.some((t) => t.tipo === "contactar_cliente" && t.cliente_id === 1));
});

test("generarTareas: no repite una tarea de cliente ya pendiente", () => {
  const DB = construirDBPrueba();
  DB.pos.tareas_venta.push({
    id: 1, vendedor_id: 1, tipo: "contactar_cliente", cliente_id: 1, producto_id: null,
    descripcion: "ya existe", estado: "pendiente", origen: "motor", generada_en: "2026-08-01T00:00:00.000Z", completada_en: null,
  });
  const tareas = generarTareas(DB, 1);
  assert.ok(!tareas.some((t) => t.tipo === "contactar_cliente" && t.cliente_id === 1));
});

test("generarTareas: sí repite si la tarea anterior ya está hecha (no bloquea para siempre)", () => {
  const DB = construirDBPrueba();
  DB.pos.tareas_venta.push({
    id: 1, vendedor_id: 1, tipo: "contactar_cliente", cliente_id: 1, producto_id: null,
    descripcion: "ya existe", estado: "hecha", origen: "motor", generada_en: "2026-08-01T00:00:00.000Z", completada_en: "2026-08-02T00:00:00.000Z",
  });
  const tareas = generarTareas(DB, 1);
  assert.ok(tareas.some((t) => t.tipo === "contactar_cliente" && t.cliente_id === 1));
});

test("generarTareas: sugiere empujar el producto con demanda proyectada más alta, entre los que ya hay en existencia en su sucursal", () => {
  const DB = construirDBPrueba();
  // Historial real ya cargado por el fixture: producto 1 tiene ventas en varios meses.
  DB.pos.venta_detalle.push(
    { id: 100, venta_id: 1, producto_id: 1, cantidad: 30, precio_unitario: 25, descuento: 0, subtotal: 750 },
  );
  const tareas = generarTareas(DB, 1); // vendedor 1, sucursal 1 (existencias: productos 1)
  const deProducto = tareas.find((t) => t.tipo === "empujar_producto");
  assert.ok(deProducto, "debió sugerir un producto");
  assert.strictEqual(deProducto.producto_id, 1);
});

test("generarTareas: lanza error si el vendedor no existe", () => {
  const DB = construirDBPrueba();
  assert.throws(() => generarTareas(DB, 999), /Vendedor no encontrado/);
});

test("insertarTareasNuevas: persiste las candidatas en DB.pos.tareas_venta y regresa solo las pendientes del vendedor", () => {
  const DB = construirDBPrueba();
  const pendientes = insertarTareasNuevas(DB, 1, "2026-08-13T18:00:00.000Z");
  assert.ok(pendientes.length > 0);
  assert.ok(pendientes.every((t) => t.vendedor_id === 1 && t.estado === "pendiente"));
  assert.ok(DB.pos.tareas_venta.length > 0);
});

test("insertarTareasNuevas: llamarlo dos veces seguidas no duplica tareas", () => {
  const DB = construirDBPrueba();
  insertarTareasNuevas(DB, 1, "2026-08-13T18:00:00.000Z");
  const total1 = DB.pos.tareas_venta.length;
  insertarTareasNuevas(DB, 1, "2026-08-13T19:00:00.000Z");
  assert.strictEqual(DB.pos.tareas_venta.length, total1);
});

test("marcarTarea: cambia estado y fecha, rechaza una tarea que ya no está pendiente", () => {
  const DB = construirDBPrueba();
  DB.pos.tareas_venta.push({
    id: 1, vendedor_id: 1, tipo: "contactar_cliente", cliente_id: 1, producto_id: null,
    descripcion: "x", estado: "pendiente", origen: "motor", generada_en: "2026-08-01T00:00:00.000Z", completada_en: null,
  });
  const t = marcarTarea(DB, 1, "hecha", "2026-08-13T18:00:00.000Z");
  assert.strictEqual(t.estado, "hecha");
  assert.strictEqual(t.completada_en, "2026-08-13T18:00:00.000Z");
  assert.throws(() => marcarTarea(DB, 1, "hecha", "2026-08-13T19:00:00.000Z"), /ya no está pendiente/);
});

test("reemplazarTarea: descarta la vieja y crea una nueva pendiente con origen 'ajuste'", () => {
  const DB = construirDBPrueba();
  DB.pos.tareas_venta.push({
    id: 1, vendedor_id: 1, tipo: "contactar_cliente", cliente_id: 1, producto_id: null,
    descripcion: "vieja", estado: "pendiente", origen: "motor", generada_en: "2026-08-01T00:00:00.000Z", completada_en: null,
  });
  const nueva = reemplazarTarea(DB, 1, "nueva idea", "2026-08-13T18:00:00.000Z");
  assert.strictEqual(nueva.descripcion, "nueva idea");
  assert.strictEqual(nueva.origen, "ajuste");
  assert.strictEqual(nueva.estado, "pendiente");
  const vieja = DB.pos.tareas_venta.find((t) => t.id === 1);
  assert.strictEqual(vieja.estado, "descartada");
});

test("descartarTarea: la marca descartada sin crear ninguna nueva", () => {
  const DB = construirDBPrueba();
  DB.pos.tareas_venta.push({
    id: 1, vendedor_id: 1, tipo: "contactar_cliente", cliente_id: 1, producto_id: null,
    descripcion: "x", estado: "pendiente", origen: "motor", generada_en: "2026-08-01T00:00:00.000Z", completada_en: null,
  });
  descartarTarea(DB, 1, "2026-08-13T18:00:00.000Z");
  assert.strictEqual(DB.pos.tareas_venta.length, 1);
  assert.strictEqual(DB.pos.tareas_venta[0].estado, "descartada");
});

test("actualizarMetaVendedor: cambia meta_mensual", () => {
  const DB = construirDBPrueba();
  const v = actualizarMetaVendedor(DB, 1, 75000);
  assert.strictEqual(v.meta_mensual, 75000);
  assert.strictEqual(DB.pos.vendedores.find((x) => x.id === 1).meta_mensual, 75000);
});

test("actualizarMetaVendedor: acepta 0 (quitar el objetivo)", () => {
  const DB = construirDBPrueba();
  const v = actualizarMetaVendedor(DB, 1, 0);
  assert.strictEqual(v.meta_mensual, 0);
});

test("actualizarMetaVendedor: rechaza un valor negativo", () => {
  const DB = construirDBPrueba();
  assert.throws(() => actualizarMetaVendedor(DB, 1, -100), /mayor o igual a 0/);
});

test("actualizarMetaVendedor: rechaza un valor que no es número", () => {
  const DB = construirDBPrueba();
  assert.throws(() => actualizarMetaVendedor(DB, 1, "mucho"), /mayor o igual a 0/);
});

test("actualizarMetaVendedor: con alcance de una sola sucursal, rechaza un vendedor de otra", () => {
  const DB = construirDBPrueba(); // vendedor 1 vive en sucursal 1, vendedor 3 en sucursal 2
  assert.throws(
    () => actualizarMetaVendedor(DB, 3, 1000, { verTodas: false, sucursalId: 1 }),
    /no pertenece a tu sucursal/
  );
});

test("actualizarMetaVendedor: con alcance de la sucursal correcta, sí lo permite", () => {
  const DB = construirDBPrueba();
  const v = actualizarMetaVendedor(DB, 1, 1000, { verTodas: false, sucursalId: 1 });
  assert.strictEqual(v.meta_mensual, 1000);
});

test("actualizarMetaVendedor: con alcance verTodas, ignora la sucursal", () => {
  const DB = construirDBPrueba();
  const v = actualizarMetaVendedor(DB, 3, 1000, { verTodas: true, sucursalId: null });
  assert.strictEqual(v.meta_mensual, 1000);
});

test("actualizarMetaVendedor: lanza error si el vendedor no existe", () => {
  const DB = construirDBPrueba();
  assert.throws(() => actualizarMetaVendedor(DB, 999, 1000), /Vendedor no encontrado/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test gerenteVentas.test.js`
Expected: FAIL — `generarTareas`/`insertarTareasNuevas`/`marcarTarea`/`reemplazarTarea`/`descartarTarea` no existen.

- [ ] **Step 3: Implementar**

Agrega a `backend/gerenteVentas.js`, antes de `module.exports` (y agrega el `require` de `crm.js`/`predicciones.js` junto al de `fechas.js` que ya está arriba):

```js
const { listarClientesCRM } = require("./crm");
const { predecirDemanda } = require("./predicciones");
```

```js
function siguienteId(lista) {
  return lista.length ? Math.max(...lista.map((x) => x.id)) + 1 : 1;
}

/** Clientes en riesgo o inactivos asignados a este vendedor — reutiliza el
 *  mismo cálculo de segmento que ya usa el CRM, sin duplicar la lógica. */
function clientesEnRiesgoAsignados(DB, vendedorId) {
  return listarClientesCRM(DB, null)
    .filter((c) => c.vendedor_asignado_id === Number(vendedorId))
    .filter((c) => c.segmento === "en_riesgo" || c.segmento === "inactivo");
}

/**
 * Producto con mayor demanda proyectada para el próximo mes, entre los que
 * YA tienen existencia en la sucursal del vendedor (no tiene sentido empujar
 * algo que no hay). Usa predecirDemanda ya construido y probado — no inventa
 * un modelo nuevo. Acotado: solo mira los productos con existencia en esa
 * sucursal, nunca el catálogo completo.
 */
function obtenerProductoAEmpujar(DB, sucursalId) {
  const productosConExistencia = DB.inventario.existencias
    .filter((e) => Number(e.sucursal_id) === Number(sucursalId) && e.cantidad_actual > 0)
    .map((e) => e.producto_id);

  let mejor = null;
  for (const productoId of productosConExistencia) {
    const resultado = predecirDemanda(DB, { producto_id: productoId, meses_adelante: 1 });
    if (resultado.error || !resultado.prediccion || !resultado.prediccion[0]) continue;
    const cantidadEstimada = resultado.prediccion[0].cantidad_estimada;
    if (!mejor || cantidadEstimada > mejor.cantidadEstimada) mejor = { productoId, cantidadEstimada };
  }
  return mejor ? mejor.productoId : null;
}

/** Tareas candidatas para este vendedor — función pura, no persiste nada.
 *  No repite un cliente/producto que ya tiene una tarea "pendiente". */
function generarTareas(DB, vendedorId) {
  const vendedor = DB.pos.vendedores.find((v) => v.id === Number(vendedorId));
  if (!vendedor) throw new Error("Vendedor no encontrado");

  const pendientes = (DB.pos.tareas_venta || []).filter(
    (t) => t.vendedor_id === vendedor.id && t.estado === "pendiente"
  );
  const clientesYaConTarea = new Set(
    pendientes.filter((t) => t.tipo === "contactar_cliente").map((t) => t.cliente_id)
  );
  const productosYaConTarea = new Set(
    pendientes.filter((t) => t.tipo === "empujar_producto").map((t) => t.producto_id)
  );

  const candidatas = [];

  for (const cliente of clientesEnRiesgoAsignados(DB, vendedor.id)) {
    if (clientesYaConTarea.has(cliente.id)) continue;
    const razon = cliente.segmento === "inactivo" ? "no compra hace tiempo" : "está en riesgo de perderse";
    candidatas.push({
      tipo: "contactar_cliente",
      cliente_id: cliente.id,
      descripcion: `Contacta a ${cliente.nombre} — ${razon}.`,
    });
  }

  const productoId = obtenerProductoAEmpujar(DB, vendedor.sucursal_id);
  if (productoId && !productosYaConTarea.has(productoId)) {
    const producto = DB["catalogo-productos"].productos.find((p) => p.id === productoId);
    if (producto) {
      candidatas.push({
        tipo: "empujar_producto",
        producto_id: productoId,
        descripcion: `Empuja ${producto.nombre} — la demanda proyectada para el próximo mes es alta.`,
      });
    }
  }

  return candidatas;
}

/** Corre generarTareas, persiste las candidatas nuevas, y regresa TODAS las
 *  tareas pendientes del vendedor (viejas + nuevas). Idempotente: llamarlo
 *  varias veces seguidas no duplica nada, porque generarTareas ya excluye lo
 *  que sigue pendiente. */
function insertarTareasNuevas(DB, vendedorId, ahoraISO) {
  const candidatas = generarTareas(DB, vendedorId);
  for (const c of candidatas) {
    DB.pos.tareas_venta.push({
      id: siguienteId(DB.pos.tareas_venta),
      vendedor_id: Number(vendedorId),
      tipo: c.tipo,
      descripcion: c.descripcion,
      cliente_id: c.cliente_id ?? null,
      producto_id: c.producto_id ?? null,
      estado: "pendiente",
      origen: "motor",
      generada_en: ahoraISO,
      completada_en: null,
    });
  }
  return DB.pos.tareas_venta.filter((t) => t.vendedor_id === Number(vendedorId) && t.estado === "pendiente");
}

function marcarTarea(DB, tareaId, nuevoEstado, ahoraISO) {
  const tarea = DB.pos.tareas_venta.find((t) => t.id === Number(tareaId));
  if (!tarea) throw new Error("Tarea no encontrada");
  if (tarea.estado !== "pendiente") throw new Error("Esa tarea ya no está pendiente");
  tarea.estado = nuevoEstado;
  tarea.completada_en = ahoraISO;
  return tarea;
}

/** Descarta la tarea vieja y crea una nueva pendiente en su lugar, con
 *  origen "ajuste" — así queda claro en la bitácora/pruebas que no salió
 *  del motor sino de una conversación de ajuste. */
function reemplazarTarea(DB, tareaId, nuevaDescripcion, ahoraISO) {
  const vieja = marcarTarea(DB, tareaId, "descartada", ahoraISO);
  const nueva = {
    id: siguienteId(DB.pos.tareas_venta),
    vendedor_id: vieja.vendedor_id,
    tipo: vieja.tipo,
    descripcion: nuevaDescripcion,
    cliente_id: vieja.cliente_id,
    producto_id: vieja.producto_id,
    estado: "pendiente",
    origen: "ajuste",
    generada_en: ahoraISO,
    completada_en: null,
  };
  DB.pos.tareas_venta.push(nueva);
  return nueva;
}

function descartarTarea(DB, tareaId, ahoraISO) {
  return marcarTarea(DB, tareaId, "descartada", ahoraISO);
}

/**
 * Fija/cambia el objetivo de venta del mes de un vendedor. 0 es válido (lo
 * deja "sin objetivo" — calcularProgreso ya sabe leer eso). Negativos y
 * valores no numéricos se rechazan: una meta corrupta rompería el % de
 * progreso que ve el vendedor.
 *
 * `alcance` es opcional (las pruebas del motor lo omiten) pero la RUTA
 * siempre lo manda: un Gerente de sucursal no puede fijar la meta de un
 * vendedor de otra tienda, mismo criterio de alcance que ya usa el resto
 * del sistema (garantias.js, apartados.js). Guard DENTRO del módulo, no
 * solo en la ruta — constraint 4 de este plan.
 */
function actualizarMetaVendedor(DB, vendedorId, nuevaMeta, alcance) {
  const vendedor = DB.pos.vendedores.find((v) => v.id === Number(vendedorId));
  if (!vendedor) throw new Error("Vendedor no encontrado");
  if (alcance && !alcance.verTodas && Number(vendedor.sucursal_id) !== alcance.sucursalId) {
    throw new Error("Ese vendedor no pertenece a tu sucursal");
  }
  const meta = Number(nuevaMeta);
  if (!Number.isFinite(meta) || meta < 0) throw new Error("La meta debe ser un número mayor o igual a 0");
  vendedor.meta_mensual = meta;
  return vendedor;
}
```

Actualiza el `module.exports` al final del archivo:

```js
module.exports = {
  calcularProgreso, generarTareas, obtenerProductoAEmpujar,
  insertarTareasNuevas, marcarTarea, reemplazarTarea, descartarTarea,
  actualizarMetaVendedor,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --test gerenteVentas.test.js`
Expected: PASS, todas las pruebas del archivo (25 en total, Task 2 + Task 3).

- [ ] **Step 5: Correr toda la suite**

Run: `cd backend && node --test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/gerenteVentas.js backend/gerenteVentas.test.js
git commit -m "feat(gerente-ventas): generarTareas y persistencia de tareas_venta"
```

---

### Task 4: Ruta del dashboard — progreso + tareas + redacción con IA

**Files:**
- Modify: `backend/server.js`
- Test: `backend/gerenteVentasRuta.test.js`

**Interfaces:**
- Consumes: `calcularProgreso`, `insertarTareasNuevas`, `marcarTarea`, `actualizarMetaVendedor` (Task 2/3); patrón existente de `/api/chat` (cliente `anthropic`, `requiereLogin`, `requierePermiso`).
- Produces: `GET /api/gerente-ventas/mi-dashboard`, `PATCH /api/gerente-ventas/tareas/:id`, `PUT /api/vendedores/:id/meta` — usados por Task 6 (frontend) y por quien administre personal.

**Nota de seguridad (constraint 4 de este plan):** ninguna de estas rutas recibe el `vendedorId` como parámetro del cliente. Ambas lo resuelven SIEMPRE a partir de `DB.admin.usuarios.find(u => u.id === req.usuarioToken.id)?.vendedor_id` — el vendedor autenticado solo puede ver y tocar sus propias tareas, nunca las de otro por adivinanza de id.

- [ ] **Step 1: Escribir las pruebas que fallan**

Mismo patrón que `backend/rutasEscrituraSucursal.test.js`: servidor real en un puerto efímero, `DB_PATH` desechable, tokens firmados directo con `firmarToken` (sin pasar por `/api/login` — el JWT solo necesita `id`/`rol_id`/`sucursal_id` válidos, igual que ese archivo de referencia). El vendedor 1 del seed de producción (`DB.pos.vendedores` en `server.js`) tiene un cliente asignado (`Abarrotes Mary`, `ultimo_contacto: "2026-06-05"`) que a la fecha de estas pruebas ya cae en segmento `"en_riesgo"`/`"inactivo"` — por eso las pruebas que necesitan una tarea garantizada usan ese vendedor.

Crea `backend/gerenteVentasRuta.test.js`:

```js
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const BASE_DESECHABLE = path.join(os.tmpdir(), `corpunisound-prueba-gerente-ventas-${process.pid}.sqlite`);
process.env.DB_PATH = BASE_DESECHABLE;
process.env.JWT_SECRET = process.env.JWT_SECRET || "secreto-solo-para-pruebas";

const app = require("./server");
const { firmarToken } = require("./auth");

const TOKEN_ADMIN = firmarToken({ id: 1, nombre: "Administrador de prueba", rol_id: 1, sucursal_id: 1 });

let servidor = null;
let base = "";
let ROL_CAJERO_ID = null;

before(async () => {
  await new Promise((listo) => { servidor = app.listen(0, listo); });
  base = `http://127.0.0.1:${servidor.address().port}`;
  const roles = await (await fetch(`${base}/api/roles`)).json();
  ROL_CAJERO_ID = roles.find((r) => r.nombre === "Cajero").id;
});

after(async () => {
  if (servidor) await new Promise((listo) => servidor.close(listo));
  try { fs.unlinkSync(BASE_DESECHABLE); } catch { /* ya no estaba: da igual */ }
});

function pegar(token, { metodo, ruta, body }) {
  const opciones = { method: metodo, headers: { Authorization: `Bearer ${token}` } };
  if (body !== undefined) {
    opciones.headers["Content-Type"] = "application/json";
    opciones.body = JSON.stringify(body);
  }
  return fetch(`${base}${ruta}`, opciones);
}

/** Crea, vía la ruta real (como admin), una cuenta Cajero — opcionalmente
 *  ligada a un vendedor — y regresa un token firmado para esa cuenta. */
async function crearCuentaCajero(usuario, vendedor_id) {
  const res = await pegar(TOKEN_ADMIN, {
    metodo: "POST", ruta: "/api/usuarios",
    body: { nombre: usuario, usuario, password: "123456", rol_id: ROL_CAJERO_ID, sucursal_id: 1, vendedor_id },
  });
  const creado = await res.json();
  if (!res.ok) throw new Error(creado.error || "no se pudo crear la cuenta de prueba");
  return firmarToken({ id: creado.id, nombre: usuario, rol_id: ROL_CAJERO_ID, sucursal_id: 1 });
}

test("GET /api/gerente-ventas/mi-dashboard: sin vendedor_id ligado responde 404 claro", async () => {
  const token = await crearCuentaCajero("sinvendedor1", undefined);
  const res = await pegar(token, { metodo: "GET", ruta: "/api/gerente-ventas/mi-dashboard" });
  assert.strictEqual(res.status, 404);
  const data = await res.json();
  assert.match(data.error, /perfil de vendedor/);
});

test("GET /api/gerente-ventas/mi-dashboard: con vendedor_id ligado, regresa progreso y tareas", async () => {
  const token = await crearCuentaCajero("convendedor1", 1);
  const res = await pegar(token, { metodo: "GET", ruta: "/api/gerente-ventas/mi-dashboard" });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.progreso.vendedor_id, 1);
  assert.ok(Array.isArray(data.tareas));
  assert.ok(data.tareas.every((t) => t.vendedor_id === 1));
});

test("PATCH /api/gerente-ventas/tareas/:id: el vendedor puede marcar su propia tarea como hecha", async () => {
  const token = await crearCuentaCajero("convendedor2", 1);
  const dashboard = await (await pegar(token, { metodo: "GET", ruta: "/api/gerente-ventas/mi-dashboard" })).json();
  assert.ok(dashboard.tareas.length > 0, "el vendedor 1 del seed siempre trae al menos una tarea de CRM");
  const tarea = dashboard.tareas[0];
  const res = await pegar(token, { metodo: "PATCH", ruta: `/api/gerente-ventas/tareas/${tarea.id}`, body: { estado: "hecha" } });
  assert.strictEqual(res.status, 200);
  const actualizada = await res.json();
  assert.strictEqual(actualizada.estado, "hecha");
});

test("PATCH /api/gerente-ventas/tareas/:id: rechaza tocar una tarea de OTRO vendedor", async () => {
  const tokenA = await crearCuentaCajero("vendedora", 1);
  const tokenB = await crearCuentaCajero("vendedorb", 3);
  const dashboardA = await (await pegar(tokenA, { metodo: "GET", ruta: "/api/gerente-ventas/mi-dashboard" })).json();
  assert.ok(dashboardA.tareas.length > 0);
  const tareaDeA = dashboardA.tareas[0];

  const res = await pegar(tokenB, { metodo: "PATCH", ruta: `/api/gerente-ventas/tareas/${tareaDeA.id}`, body: { estado: "hecha" } });
  assert.strictEqual(res.status, 403);

  const dashboardADespues = await (await pegar(tokenA, { metodo: "GET", ruta: "/api/gerente-ventas/mi-dashboard" })).json();
  assert.ok(dashboardADespues.tareas.some((t) => t.id === tareaDeA.id && t.estado === "pendiente"));
});

test("PUT /api/vendedores/:id/meta: el Administrador puede fijar la meta de cualquier sucursal", async () => {
  const res = await pegar(TOKEN_ADMIN, { metodo: "PUT", ruta: "/api/vendedores/1/meta", body: { meta_mensual: 60000 } });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.meta_mensual, 60000);
});

test("PUT /api/vendedores/:id/meta: un Cajero sin editar_objetivos_venta recibe 403", async () => {
  const token = await crearCuentaCajero("sinpermisometa", undefined);
  const res = await pegar(token, { metodo: "PUT", ruta: "/api/vendedores/1/meta", body: { meta_mensual: 1000 } });
  assert.strictEqual(res.status, 403);
});
```

Nota para Task 5: este mismo archivo se extiende ahí con las pruebas del chat — el bloque `before`/`after`/`pegar`/`crearCuentaCajero` de arriba se reutiliza tal cual, no se duplica.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test gerenteVentasRuta.test.js`
Expected: FAIL — las rutas `/api/gerente-ventas/*` no existen (404 en vez del comportamiento esperado).

- [ ] **Step 3: Implementar las rutas**

En `backend/server.js`, junto al `require` de `gerenteVentas` (agrégalo cerca de donde ya se importan `crm`/`predicciones`):

```js
const { calcularProgreso, insertarTareasNuevas, marcarTarea, actualizarMetaVendedor } = require("./gerenteVentas");
```

Agrega las rutas cerca de `/api/chat` (mismo bloque temático):

```js
function vendedorIdDelToken(DB, req) {
  const usuario = DB.admin.usuarios.find((u) => u.id === req.usuarioToken.id);
  return usuario ? usuario.vendedor_id : null;
}

app.get("/api/gerente-ventas/mi-dashboard", requiereLogin, requierePermiso("usar_gerente_ventas", resolverPermisosDeRol), async (req, res) => {
  try {
    const vendedorId = vendedorIdDelToken(DB, req);
    if (!vendedorId) return res.status(404).json({ error: "Tu cuenta no tiene un perfil de vendedor asociado — pídele a tu administrador que te ligue uno." });

    const progreso = calcularProgreso(DB, vendedorId);
    const tareas = insertarTareasNuevas(DB, vendedorId, new Date().toISOString());

    let resumen = null;
    if (process.env.ANTHROPIC_API_KEY) {
      try {
        const respuesta = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 300,
          system: "Eres un gerente de ventas motivador y directo. Redacta en 2-3 frases un resumen del progreso y las tareas que se te dan, EN ESPAÑOL. No inventes cifras, clientes ni productos que no estén en el JSON que te paso — solo redacta lo que ya está ahí.",
          messages: [{ role: "user", content: JSON.stringify({ progreso, tareas: tareas.map((t) => t.descripcion) }) }],
        });
        resumen = respuesta.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
      } catch (_) {
        resumen = null; // las tareas y el progreso ya calculados se siguen mandando igual
      }
    }

    res.json({ progreso, tareas, resumen });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.patch("/api/gerente-ventas/tareas/:id", requiereLogin, requierePermiso("usar_gerente_ventas", resolverPermisosDeRol), (req, res) => {
  try {
    const vendedorId = vendedorIdDelToken(DB, req);
    if (!vendedorId) return res.status(404).json({ error: "Tu cuenta no tiene un perfil de vendedor asociado." });

    const tarea = DB.pos.tareas_venta.find((t) => t.id === Number(req.params.id));
    if (!tarea) return res.status(404).json({ error: "Tarea no encontrada" });
    if (tarea.vendedor_id !== vendedorId) return res.status(403).json({ error: "Esa tarea no es tuya" });

    const nuevoEstado = req.body.estado === "descartada" ? "descartada" : "hecha";
    res.json(marcarTarea(DB, tarea.id, nuevoEstado, new Date().toISOString()));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.put("/api/vendedores/:id/meta", requiereLogin, requierePermiso("editar_objetivos_venta", resolverPermisosDeRol), (req, res) => {
  try {
    const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
    res.json(actualizarMetaVendedor(DB, req.params.id, req.body.meta_mensual, alcance));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
```

(`alcanceSucursal` y `resolverPermisosDeRol` ya están importados/definidos en `server.js` — se usan igual en varias rutas existentes, por ejemplo `/api/depositos/:id/cancelar`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --test gerenteVentasRuta.test.js`
Expected: PASS, las 6 pruebas.

- [ ] **Step 5: Correr toda la suite**

Run: `cd backend && node --test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/server.js backend/gerenteVentasRuta.test.js
git commit -m "feat(gerente-ventas): ruta de dashboard y de marcar tarea, con guard de identidad"
```

---

### Task 5: Ruta de chat de ajuste — dos herramientas acotadas

**Files:**
- Modify: `backend/gerenteVentas.js`
- Modify: `backend/gerenteVentas.test.js`
- Modify: `backend/server.js`
- Modify: `backend/gerenteVentasRuta.test.js`

**Interfaces:**
- Consumes: `reemplazarTarea`, `descartarTarea` (Task 3); `vendedorIdDelToken` (Task 4).
- Produces: `ejecutarHerramientaDeAjuste(DB, vendedorId, nombreHerramienta, input, ahoraISO) → resultado | {error}` (el guard real, probado sin IA), `POST /api/gerente-ventas/chat` — usado por Task 6.

**Por qué el guard vive en una función aparte, probada sin IA:** depender de que el modelo real de Claude "decida" llamar la herramienta con un `tarea_id` ajeno para poder probar que el guard lo bloquea sería probar el modelo, no el guard — no determinista, y quedaría en verde o en rojo según el humor del LLM ese día, no según si el código protege algo. El guard se prueba aparte, con `node --test` puro, llamando la función directo con un input fabricado. El chat con Claude real solo se prueba como humo (Step 6), no como la verificación que realmente importa.

- [ ] **Step 1: Escribir la prueba determinista del guard (sin IA) que falla**

Agrega a `backend/gerenteVentas.test.js`:

```js
const { ejecutarHerramientaDeAjuste } = require("./gerenteVentas");

test("ejecutarHerramientaDeAjuste: reemplaza una tarea propia pendiente", () => {
  const DB = construirDBPrueba();
  DB.pos.tareas_venta.push({
    id: 1, vendedor_id: 1, tipo: "contactar_cliente", cliente_id: 1, producto_id: null,
    descripcion: "vieja", estado: "pendiente", origen: "motor", generada_en: "2026-08-01T00:00:00.000Z", completada_en: null,
  });
  const resultado = ejecutarHerramientaDeAjuste(DB, 1, "reemplazar_tarea", { tarea_id: 1, nueva_descripcion: "nueva" }, "2026-08-13T18:00:00.000Z");
  assert.strictEqual(resultado.descripcion, "nueva");
  assert.strictEqual(DB.pos.tareas_venta.find((t) => t.id === 1).estado, "descartada");
});

test("ejecutarHerramientaDeAjuste: descarta una tarea propia pendiente", () => {
  const DB = construirDBPrueba();
  DB.pos.tareas_venta.push({
    id: 1, vendedor_id: 1, tipo: "contactar_cliente", cliente_id: 1, producto_id: null,
    descripcion: "x", estado: "pendiente", origen: "motor", generada_en: "2026-08-01T00:00:00.000Z", completada_en: null,
  });
  const resultado = ejecutarHerramientaDeAjuste(DB, 1, "descartar_tarea", { tarea_id: 1 }, "2026-08-13T18:00:00.000Z");
  assert.strictEqual(resultado.estado, "descartada");
});

test("ejecutarHerramientaDeAjuste: NO toca una tarea de OTRO vendedor — la esencia del guard", () => {
  // ESTA es la prueba que le da dientes a la protección: la tarea existe de
  // verdad, pero pertenece al vendedor 3, y quien pide el ajuste es el
  // vendedor 1. Sin el guard, reemplazar_tarea la tocaría igual.
  const DB = construirDBPrueba();
  DB.pos.tareas_venta.push({
    id: 1, vendedor_id: 3, tipo: "contactar_cliente", cliente_id: 2, producto_id: null,
    descripcion: "de otro vendedor", estado: "pendiente", origen: "motor", generada_en: "2026-08-01T00:00:00.000Z", completada_en: null,
  });
  const resultado = ejecutarHerramientaDeAjuste(DB, 1, "reemplazar_tarea", { tarea_id: 1, nueva_descripcion: "hackeada" }, "2026-08-13T18:00:00.000Z");
  assert.ok(resultado.error, "debió regresar un error, no ejecutar el reemplazo");
  const tarea = DB.pos.tareas_venta.find((t) => t.id === 1);
  assert.strictEqual(tarea.estado, "pendiente");
  assert.strictEqual(tarea.descripcion, "de otro vendedor");
});

test("ejecutarHerramientaDeAjuste: NO hace nada si el tarea_id no existe", () => {
  const DB = construirDBPrueba();
  const resultado = ejecutarHerramientaDeAjuste(DB, 1, "descartar_tarea", { tarea_id: 999 }, "2026-08-13T18:00:00.000Z");
  assert.ok(resultado.error);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test gerenteVentas.test.js`
Expected: FAIL — `ejecutarHerramientaDeAjuste` no existe.

- [ ] **Step 3: Implementar el guard en `gerenteVentas.js`**

Agrega a `backend/gerenteVentas.js`, antes de `module.exports` (ya tienes `reemplazarTarea`/`descartarTarea` de Task 3 arriba en el mismo archivo):

```js
/**
 * Ejecuta una de las dos herramientas de ajuste del chat (reemplazar_tarea /
 * descartar_tarea), SIEMPRE validando primero que la tarea pertenece al
 * vendedor que la pidió. Esta es la única puerta de escritura que el chat
 * con IA tiene hacia la base de datos — ninguna otra tabla es alcanzable
 * desde esa conversación, y esta función es la que hay que probar con
 * mutación, no la ruta que la envuelve.
 */
function ejecutarHerramientaDeAjuste(DB, vendedorId, nombreHerramienta, input, ahoraISO) {
  const tarea = DB.pos.tareas_venta.find((t) => t.id === Number(input.tarea_id));
  if (!tarea || tarea.vendedor_id !== Number(vendedorId)) {
    return { error: "Esa tarea no existe o no es tuya" };
  }
  try {
    if (nombreHerramienta === "reemplazar_tarea") return reemplazarTarea(DB, tarea.id, input.nueva_descripcion, ahoraISO);
    if (nombreHerramienta === "descartar_tarea") return descartarTarea(DB, tarea.id, ahoraISO);
    return { error: "Herramienta desconocida" };
  } catch (e) {
    return { error: e.message };
  }
}
```

Actualiza el `module.exports`:

```js
module.exports = {
  calcularProgreso, generarTareas, obtenerProductoAEmpujar,
  insertarTareasNuevas, marcarTarea, reemplazarTarea, descartarTarea,
  actualizarMetaVendedor, ejecutarHerramientaDeAjuste,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --test gerenteVentas.test.js`
Expected: PASS, las 29 pruebas del archivo (25 de antes + 4 nuevas).

- [ ] **Step 5: Verificación por mutación del guard (constraint 7 de este plan)**

Comenta temporalmente la condición `!tarea || tarea.vendedor_id !== Number(vendedorId)` dejando solo `if (!tarea) {` (quita la comparación de dueño, deja solo la de existencia). Corre `node --test gerenteVentas.test.js`. Confirma que **exactamente** la prueba "NO toca una tarea de OTRO vendedor — la esencia del guard" se pone roja, y ninguna otra. Revierte y confirma verde de nuevo. Si no se pone roja, PARA y corrige la prueba — no está protegiendo nada.

- [ ] **Step 6: Conectar el guard a la ruta de chat, con pruebas de humo (requieren `ANTHROPIC_API_KEY`)**

La ruta en sí solo necesita conectar lo que Claude decide llamar con `ejecutarHerramientaDeAjuste` — el guard ya quedó probado sin depender de la IA. En `backend/server.js`, junto al `require` de `gerenteVentas` (Task 4):

```js
const { calcularProgreso, insertarTareasNuevas, marcarTarea, actualizarMetaVendedor, ejecutarHerramientaDeAjuste } = require("./gerenteVentas");
```

Y la ruta:

```js
const TOOL_REEMPLAZAR_TAREA = {
  name: "reemplazar_tarea",
  description: "Descarta una tarea pendiente del vendedor y la sustituye por una nueva con otra descripción. Úsalo cuando el vendedor pida explícitamente otra idea o un cambio a una tarea existente.",
  input_schema: {
    type: "object",
    properties: {
      tarea_id: { type: "number", description: "id de la tarea pendiente a reemplazar" },
      nueva_descripcion: { type: "string", description: "la nueva tarea, en español, en una frase" },
    },
    required: ["tarea_id", "nueva_descripcion"],
  },
};
const TOOL_DESCARTAR_TAREA = {
  name: "descartar_tarea",
  description: "Descarta una tarea pendiente del vendedor sin reemplazarla por otra. Úsalo cuando el vendedor pida quitar una tarea sin pedir una alternativa.",
  input_schema: {
    type: "object",
    properties: { tarea_id: { type: "number", description: "id de la tarea pendiente a descartar" } },
    required: ["tarea_id"],
  },
};

app.post("/api/gerente-ventas/chat", requiereLogin, requierePermiso("usar_gerente_ventas", resolverPermisosDeRol), async (req, res) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: "Falta configurar ANTHROPIC_API_KEY en el archivo .env del backend" });
    }
    const vendedorId = vendedorIdDelToken(DB, req);
    if (!vendedorId) return res.status(404).json({ error: "Tu cuenta no tiene un perfil de vendedor asociado." });

    const { mensajes } = req.body;
    let historial = (mensajes || []).map((m) => ({ role: m.role, content: m.content }));
    let respuestaFinal = null;
    let vueltas = 0;

    while (!respuestaFinal && vueltas < 5) {
      vueltas++;
      const respuesta = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 500,
        system: "Eres el asistente de ajuste del Gerente de Ventas IA. Solo puedes reemplazar o descartar tareas PENDIENTES de este vendedor usando las herramientas disponibles. Nunca inventes una tarea nueva desde cero sin que el vendedor la haya pedido.",
        tools: [TOOL_REEMPLAZAR_TAREA, TOOL_DESCARTAR_TAREA],
        messages: historial,
      });

      const bloquesHerramienta = respuesta.content.filter((b) => b.type === "tool_use");
      if (bloquesHerramienta.length === 0) {
        respuestaFinal = respuesta.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
        break;
      }

      const resultados = bloquesHerramienta.map((bloque) => ({
        type: "tool_result",
        tool_use_id: bloque.id,
        content: JSON.stringify(ejecutarHerramientaDeAjuste(DB, vendedorId, bloque.name, bloque.input, new Date().toISOString())),
      }));

      historial = [...historial, { role: "assistant", content: respuesta.content }, { role: "user", content: resultados }];
    }

    res.json({ respuesta: respuestaFinal || "No pude procesar tu solicitud, intenta de nuevo." });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
```

Agrega a `backend/gerenteVentasRuta.test.js` (reutiliza `TOKEN_ADMIN`, `pegar`, `crearCuentaCajero`, `base` ya definidos en Task 4 — no los repitas) las pruebas de humo: correr o no según haya `ANTHROPIC_API_KEY` en el entorno, porque dependen del modelo real y no son la verificación de seguridad (esa ya se hizo sin IA en el Step 1-5 de este task):

```js
const CORRE_PRUEBAS_DE_CHAT = !!process.env.ANTHROPIC_API_KEY;

test("POST /api/gerente-ventas/chat: puede reemplazar una tarea propia pendiente", { skip: !CORRE_PRUEBAS_DE_CHAT && "requiere ANTHROPIC_API_KEY en el entorno de pruebas" }, async () => {
  const token = await crearCuentaCajero("chatvendedor1", 1);
  const dashboard = await (await pegar(token, { metodo: "GET", ruta: "/api/gerente-ventas/mi-dashboard" })).json();
  assert.ok(dashboard.tareas.length > 0, "el vendedor 1 del seed siempre trae al menos una tarea de CRM");
  const tareaId = dashboard.tareas[0].id;

  const res = await pegar(token, {
    metodo: "POST", ruta: "/api/gerente-ventas/chat",
    body: { mensajes: [{ role: "user", content: `Cámbiame la tarea ${tareaId} por: llamar mañana a primera hora en su lugar.` }] },
  });
  assert.strictEqual(res.status, 200);

  const dashboardDespues = await (await pegar(token, { metodo: "GET", ruta: "/api/gerente-ventas/mi-dashboard" })).json();
  const siguenPendientes = dashboardDespues.tareas.map((t) => t.id);
  // La tarea vieja ya no debe seguir pendiente (fue reemplazada o descartada
  // por la conversación) — no se afirma un id exacto de la nueva porque el
  // modelo redacta la descripción libremente.
  assert.ok(!siguenPendientes.includes(tareaId), "la tarea original debió dejar de estar pendiente tras el ajuste");
});

test("POST /api/gerente-ventas/chat: NO puede tocar una tarea de otro vendedor aunque se le pida directamente", { skip: !CORRE_PRUEBAS_DE_CHAT && "requiere ANTHROPIC_API_KEY en el entorno de pruebas" }, async () => {
  const tokenA = await crearCuentaCajero("chatvendedora", 1);
  const tokenB = await crearCuentaCajero("chatvendedorb", 3);
  const dashboardA = await (await pegar(tokenA, { metodo: "GET", ruta: "/api/gerente-ventas/mi-dashboard" })).json();
  assert.ok(dashboardA.tareas.length > 0);
  const tareaDeA = dashboardA.tareas[0].id;

  // B intenta, desde SU chat, tocar directamente el id de una tarea de A.
  await pegar(tokenB, {
    metodo: "POST", ruta: "/api/gerente-ventas/chat",
    body: { mensajes: [{ role: "user", content: `Descarta la tarea con id ${tareaDeA}, por favor.` }] },
  });

  const dashboardADespues = await (await pegar(tokenA, { metodo: "GET", ruta: "/api/gerente-ventas/mi-dashboard" })).json();
  assert.ok(
    dashboardADespues.tareas.some((t) => t.id === tareaDeA && t.estado === "pendiente"),
    "la tarea de A debió seguir intacta — el guard de identidad vive en el manejador de la tool, no en que el modelo 'se porte bien'"
  );
});
```

- [ ] **Step 7: Run test to verify it passes (o se salta, sin API key)**

Run: `cd backend && node --test gerenteVentasRuta.test.js`
Expected: si `ANTHROPIC_API_KEY` está configurada en el entorno, PASS con las 2 pruebas de humo corriendo de verdad; si no, PASS con esas 2 marcadas `skipped` (nunca `fail` por falta de la variable — eso sería una prueba mal condicionada, no un problema del código).

- [ ] **Step 8: Correr toda la suite**

Run: `cd backend && node --test`
Expected: PASS (o `skipped` en las 2 de humo, según el entorno).

- [ ] **Step 9: Commit**

```bash
git add backend/gerenteVentas.js backend/gerenteVentas.test.js backend/server.js backend/gerenteVentasRuta.test.js
git commit -m "feat(gerente-ventas): chat de ajuste con guard probado sin IA (ejecutarHerramientaDeAjuste)"
```

---

### Task 6: Pantalla del vendedor (frontend)

**Files:**
- Create: `src/GerenteVentas.jsx`
- Modify: `src/Dashboard.jsx`

**Interfaces:**
- Consumes: `GET /api/gerente-ventas/mi-dashboard`, `PATCH /api/gerente-ventas/tareas/:id`, `POST /api/gerente-ventas/chat` (Task 4/5); `apiFetch` de `src/api.js` (mismo patrón que `AsistenteIA.jsx`).

**Nota:** este repo no tiene harness de pruebas automatizadas de frontend (convención ya establecida — ver `docs/superpowers/specs/2026-07-18-asistente-chat-ui-design.md`). La verificación de este task es manual, con el dev server local.

- [ ] **Step 1: Leer `src/AsistenteIA.jsx` completo**

Es la base visual a reutilizar (burbujas de chat, avatar, indicador de "escribiendo", `apiFetch`). No lo dupliques desde cero — copia su estructura y adáptala.

- [ ] **Step 2: Crear `src/GerenteVentas.jsx`**

```jsx
import React, { useState, useEffect, useRef } from "react";
import { Send, Bot, CheckCircle2, XCircle } from "lucide-react";
import { apiFetch } from "./api";

export default function GerenteVentas() {
  const [datos, setDatos] = useState(null); // { progreso, tareas, resumen }
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [historial, setHistorial] = useState([
    { role: "assistant", content: "Hola, soy tu Gerente de Ventas. Si quieres que ajuste alguna tarea, dímelo aquí." },
  ]);
  const [entrada, setEntrada] = useState("");
  const [enviando, setEnviando] = useState(false);
  const finRef = useRef(null);

  const cargarDashboard = async () => {
    setCargando(true);
    setError(null);
    try {
      const res = await apiFetch("/gerente-ventas/mi-dashboard");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
      setDatos(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => { cargarDashboard(); }, []);
  useEffect(() => { finRef.current?.scrollIntoView({ behavior: "smooth" }); }, [historial, enviando]);

  const marcarTarea = async (id, estado) => {
    try {
      await apiFetch(`/gerente-ventas/tareas/${id}`, { method: "PATCH", body: JSON.stringify({ estado }) });
      cargarDashboard();
    } catch (err) {
      setError(err.message);
    }
  };

  const enviarMensaje = async (texto) => {
    if (!texto.trim() || enviando) return;
    const nuevoHistorial = [...historial, { role: "user", content: texto }];
    setHistorial(nuevoHistorial);
    setEntrada("");
    setEnviando(true);
    try {
      const res = await apiFetch("/gerente-ventas/chat", {
        method: "POST",
        body: JSON.stringify({ mensajes: nuevoHistorial.map((m) => ({ role: m.role, content: m.content })) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
      setHistorial((prev) => [...prev, { role: "assistant", content: data.respuesta }]);
      cargarDashboard(); // por si el chat reemplazó/descartó una tarea
    } catch (err) {
      setHistorial((prev) => [...prev, { role: "assistant", content: `Ocurrió un error: ${err.message}` }]);
    } finally {
      setEnviando(false);
    }
  };

  if (cargando) return <div className="p-4 text-slate-500">Cargando tu Gerente de Ventas...</div>;
  if (error) return <div className="p-4 text-red-600">{error}</div>;
  if (!datos) return null;

  const { progreso, tareas, resumen } = datos;

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h2 className="text-lg font-semibold text-slate-800">Tu objetivo del mes</h2>
        {progreso.sin_meta ? (
          <p className="text-slate-500 mt-2">Todavía no tienes un objetivo asignado — pídele a tu gerente que te ponga uno.</p>
        ) : (
          <>
            <p className="text-sm text-slate-600 mt-1">${progreso.vendido_mes.toLocaleString()} de ${progreso.meta.toLocaleString()} ({progreso.porcentaje}%)</p>
            <div className="w-full bg-slate-100 rounded-full h-3 mt-2">
              <div className="bg-[#1a7fe8] h-3 rounded-full" style={{ width: `${Math.min(100, progreso.porcentaje)}%` }} />
            </div>
          </>
        )}
        {resumen && <p className="text-sm text-slate-700 mt-3 italic">{resumen}</p>}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h2 className="text-lg font-semibold text-slate-800 mb-2">Tus tareas</h2>
        {tareas.length === 0 && <p className="text-slate-500">No hay tareas pendientes ahora mismo.</p>}
        <ul className="flex flex-col gap-2">
          {tareas.map((t) => (
            <li key={t.id} className="flex items-center justify-between border border-slate-100 rounded-lg p-2">
              <span className="text-sm text-slate-700">{t.descripcion}</span>
              <div className="flex gap-2 shrink-0 ml-2">
                <button onClick={() => marcarTarea(t.id, "hecha")} title="Marcar hecha" className="text-emerald-600"><CheckCircle2 size={18} /></button>
                <button onClick={() => marcarTarea(t.id, "descartada")} title="Descartar" className="text-slate-400"><XCircle size={18} /></button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 flex flex-col h-80">
        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
          {historial.map((m, i) => (
            <div key={i} className={`flex items-end gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              {m.role === "assistant" && <Bot size={16} className="text-[#1a7fe8] shrink-0 mb-1" />}
              <div className={`px-3 py-2 rounded-lg text-sm max-w-[80%] ${m.role === "user" ? "bg-[#1a7fe8] text-white" : "bg-white border border-slate-200"}`}>
                {m.content}
              </div>
            </div>
          ))}
          <div ref={finRef} />
        </div>
        <form
          onSubmit={(e) => { e.preventDefault(); enviarMensaje(entrada); }}
          className="flex items-center gap-2 p-2 border-t border-slate-100"
        >
          <input
            value={entrada}
            onChange={(e) => setEntrada(e.target.value)}
            placeholder="Pide un ajuste a tu Gerente de Ventas..."
            className="flex-1 rounded-full border border-slate-200 px-4 py-2 text-sm outline-none"
            disabled={enviando}
          />
          <button type="submit" disabled={enviando} className="text-[#1a7fe8]"><Send size={20} /></button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Montar la pantalla en el Dashboard, gateada por permiso**

En `src/Dashboard.jsx`, agrega el import junto al de `AsistenteIA`:

```js
import GerenteVentas from "./GerenteVentas";
```

Y, siguiendo el mismo patrón condicional que ya usa el Asistente (`!usuario?.permisos || usuario.permisos.includes("usar_asistente_ia")`), agrega el bloque equivalente para este componente en el punto del layout donde tenga sentido mostrarlo (junto al Asistente, como otra sección del dashboard):

```jsx
{!usuario?.permisos || usuario.permisos.includes("usar_gerente_ventas") ? (
  <GerenteVentas />
) : null}
```

- [ ] **Step 4: Verificación manual**

1. Levanta el backend con un `DB_PATH` temporal aislado (nunca la base real) y `npm run dev` en la raíz.
2. Crea (vía la pantalla de Administrar Roles y Personal, o directo insertando en el DB de prueba) una cuenta con rol Cajero y `vendedor_id` ligado a uno de los vendedores sembrados.
3. Inicia sesión con esa cuenta. Confirma que aparece la sección "Tu objetivo del mes" con progreso, la lista de tareas, y el chat.
4. Marca una tarea como hecha — confirma que desaparece de la lista.
5. Escribe en el chat pidiendo un ajuste ("cámbiame esa tarea por otra") — confirma que responde y que, si aceptó el cambio, la lista de tareas se actualiza.
6. Inicia sesión con una cuenta SIN `vendedor_id` ligado — confirma que la sección no aparece (o muestra el mensaje de "no tienes un perfil de vendedor", según cómo se decida mostrar el 404 en el componente — ajusta `GerenteVentas.jsx` si hace falta un mensaje más amable que el actual, que hoy solo muestra `error` en rojo).
7. Captura screenshots (Playwright si la extensión Claude in Chrome no está disponible en el entorno) y confírmalas con Victor antes de dar el trabajo por terminado — mismo criterio que se siguió en el restyle del chat del Asistente.

- [ ] **Step 5: Commit**

```bash
git add src/GerenteVentas.jsx src/Dashboard.jsx
git commit -m "feat(gerente-ventas): pantalla del vendedor — objetivo, tareas y chat de ajuste"
```

---
