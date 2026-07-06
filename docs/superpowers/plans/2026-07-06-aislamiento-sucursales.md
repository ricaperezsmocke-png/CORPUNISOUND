# Aislamiento de datos por sucursal — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que cada sucursal (1 Ocosingo, 2 Yajalón, 3 San Cristóbal, 4 Palenque) vea solo sus propios datos según el usuario logueado, con un permiso `ver_todas_las_sucursales` que habilita vista global.

**Architecture:** La sucursal del usuario viaja dentro del token JWT (firmado). Un único helper `alcanceSucursal(req, permisos)` resuelve qué puede ver cada request; toda ruta de datos por sucursal lo usa para filtrar lecturas y estampar escrituras. El frontend muestra un selector (usuario global) o una etiqueta fija (usuario amarrado).

**Tech Stack:** Node.js + Express (backend, datos en memoria), React + Vite (frontend), JWT (`jsonwebtoken`), pruebas con el runner integrado de Node (`node --test`, sin dependencias nuevas).

## Global Constraints

- **Datos en memoria:** no hay BD; los datos viven en el objeto `DB` de `backend/server.js` y se pierden al reiniciar. NO se agrega persistencia en este plan.
- **Convención de permisos (regla de oro Unisound):** todo permiso nuevo pasa por `permisosCatalogo.js` + `requierePermiso` en la ruta + gating en frontend. El guardia `validarPermisos.js` DEBE seguir pasando al arrancar.
- **Sin dependencias nuevas:** pruebas con `node --test` (integrado). No agregar supertest, jest, etc.
- **El backend nunca confía en `sucursal_id` del navegador** salvo para usuarios con `ver_todas_las_sucursales`.
- **Sucursales fijas:** 1=Ocosingo, 2=Yajalón, 3=San Cristóbal, 4=Palenque (`backend/server.js:77-82`).
- **Cliente id 0 ("Público en General")** es compartido: visible en todas las sucursales, nunca se filtra.
- **Idioma:** todo el código, comentarios y mensajes en español, siguiendo el estilo de los archivos existentes.

---

### Task 1: Infraestructura de pruebas y fixture de DB

**Files:**
- Modify: `backend/package.json:6-8` (agregar script `test`)
- Create: `backend/testHelpers.js`
- Create: `backend/testHelpers.test.js`

**Interfaces:**
- Produces: `construirDBPrueba()` → objeto `DB` con la misma forma que el de `server.js`, con roles sembrados y datos mínimos en las 4 sucursales. Lo consumen todas las tareas de prueba siguientes.

- [ ] **Step 1: Agregar el script de pruebas**

En `backend/package.json`, dentro de `"scripts"`:

```json
  "scripts": {
    "start": "node server.js",
    "test": "node --test"
  },
```

- [ ] **Step 2: Escribir el fixture de DB de prueba**

Crear `backend/testHelpers.js`:

```js
/**
 * testHelpers.js — Construye un DB de prueba con la misma forma que el de
 * server.js, para poder probar las funciones de datos en aislamiento sin
 * levantar el servidor. Datos mínimos repartidos en las 4 sucursales.
 */

const { sembrarRolesIniciales } = require("./roles");

function construirDBPrueba() {
  const DB = {
    pos: {
      ventas: [
        { id: 1, fecha: "2026-05-10", fecha_hora: "2026-05-10T10:00:00.000Z", sucursal_id: 1, vendedor_id: 1, cliente_id: 1, total: 1200, metodo_pago: "efectivo", estatus: "cerrada", motivo_cancelacion: null },
        { id: 2, fecha: "2026-05-20", fecha_hora: "2026-05-20T10:00:00.000Z", sucursal_id: 2, vendedor_id: 3, cliente_id: 2, total: 800, metodo_pago: "tarjeta", estatus: "cerrada", motivo_cancelacion: null },
        { id: 3, fecha: "2026-06-05", fecha_hora: "2026-06-05T10:00:00.000Z", sucursal_id: 3, vendedor_id: 4, cliente_id: 0, total: 2100, metodo_pago: "efectivo", estatus: "cerrada", motivo_cancelacion: null },
      ],
      venta_detalle: [
        { id: 1, venta_id: 1, producto_id: 1, cantidad: 20, precio_unitario: 25, descuento: 0, subtotal: 500 },
        { id: 2, venta_id: 2, producto_id: 2, cantidad: 40, precio_unitario: 16, descuento: 0, subtotal: 640 },
        { id: 3, venta_id: 3, producto_id: 3, cantidad: 25, precio_unitario: 32, descuento: 0, subtotal: 800 },
      ],
      vendedores: [
        { id: 1, nombre: "Ana López", sucursal_id: 1, meta_mensual: 50000 },
        { id: 3, nombre: "María R.", sucursal_id: 2, meta_mensual: 50000 },
        { id: 4, nombre: "Pedro L.", sucursal_id: 3, meta_mensual: 50000 },
      ],
      sucursales: [
        { id: 1, nombre: "Ocosingo", ciudad: "Chiapas" },
        { id: 2, nombre: "Yajalón", ciudad: "Chiapas" },
        { id: 3, nombre: "San Cristóbal", ciudad: "Chiapas" },
        { id: 4, nombre: "Palenque", ciudad: "Chiapas" },
      ],
      condiciones_pago: [],
      configuracion: null,
      cortes_caja: [],
    },
    crm: {
      clientes: [
        { id: 0, clave: "", nombre: "Público en General", tipo: "menudeo", sucursal_id: 1, estado: "compro", ultimo_contacto: null, limite_credito: 0, saldo: 0, vendedor_asignado_id: null },
        { id: 1, clave: "CLI001", nombre: "Abarrotes Mary", tipo: "mayoreo", sucursal_id: 1, estado: "compro", ultimo_contacto: "2026-06-05", limite_credito: 5000, saldo: 0, vendedor_asignado_id: 1 },
        { id: 2, clave: "CLI002", nombre: "Juan Pérez", tipo: "menudeo", sucursal_id: 2, estado: "compro", ultimo_contacto: "2026-06-25", limite_credito: 0, saldo: 0, vendedor_asignado_id: 3 },
      ],
      contactos_cliente: [],
      oportunidades: [],
    },
    inventario: {
      existencias: [
        { producto_id: 1, sucursal_id: 1, cantidad_actual: 120, cantidad_minima: 30, cantidad_maxima: 300 },
        { producto_id: 2, sucursal_id: 2, cantidad_actual: 80, cantidad_minima: 20, cantidad_maxima: 200 },
        { producto_id: 3, sucursal_id: 3, cantidad_actual: 60, cantidad_minima: 20, cantidad_maxima: 150 },
      ],
      movimientos_inventario: [],
      compras: [],
      compra_detalle: [],
    },
    "catalogo-productos": {
      productos: [
        { id: 1, sku: "AB-001", nombre: "Arroz 1kg", categoria_id: 1, precio_venta: 25, activo: true },
        { id: 2, sku: "BE-001", nombre: "Refresco 600ml", categoria_id: 2, precio_venta: 16, activo: true },
        { id: 3, sku: "LI-001", nombre: "Detergente 1L", categoria_id: 3, precio_venta: 32, activo: true },
      ],
      categorias: [
        { id: 1, nombre: "Abarrotes", categoria_padre_id: null },
        { id: 2, nombre: "Bebidas", categoria_padre_id: null },
        { id: 3, nombre: "Limpieza", categoria_padre_id: null },
      ],
      proveedores: [],
      producto_proveedor: [],
    },
    admin: { roles: [], usuarios: [] },
  };
  sembrarRolesIniciales(DB);
  return DB;
}

module.exports = { construirDBPrueba };
```

- [ ] **Step 3: Escribir una prueba que valida el fixture**

Crear `backend/testHelpers.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");

test("el fixture tiene ventas en varias sucursales y roles sembrados", () => {
  const DB = construirDBPrueba();
  const sucursales = new Set(DB.pos.ventas.map((v) => v.sucursal_id));
  assert.ok(sucursales.size >= 3, "debe haber ventas en al menos 3 sucursales");
  assert.ok(DB.admin.roles.length >= 3, "roles deben estar sembrados");
  assert.ok(DB.crm.clientes.some((c) => c.id === 0), "debe existir Público en General");
});
```

- [ ] **Step 4: Correr la prueba y verificar que pasa**

Run: `cd backend && npm test`
Expected: PASS — 1 test passing (más los que existan). Salida incluye `# pass 1` o similar.

- [ ] **Step 5: Commit**

```bash
git add backend/package.json backend/testHelpers.js backend/testHelpers.test.js
git commit -m "test: infraestructura de pruebas con node:test y fixture de DB multi-sucursal"
```

---

### Task 2: Helper `alcanceSucursal` y `filtrarPorSucursal`

**Files:**
- Modify: `backend/auth.js` (agregar dos funciones y exportarlas)
- Create: `backend/alcanceSucursal.test.js`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `alcanceSucursal(req, permisos)` → `{ verTodas: boolean, sucursalId: number|null }`
    - `permisos` es un array de claves de permiso (strings).
    - Si `permisos` incluye `"ver_todas_las_sucursales"`:
      - con `req.query.sucursal_id` numérico y distinto de `"todas"` → `{ verTodas: false, sucursalId: Number(...) }`
      - si no → `{ verTodas: true, sucursalId: null }`
    - Si NO incluye el permiso → `{ verTodas: false, sucursalId: req.usuarioToken?.sucursal_id ?? null }` (ignora el query).
  - `filtrarPorSucursal(lista, alcance)` → array: si `alcance.verTodas` devuelve copia completa; si no, filtra por `x.sucursal_id === alcance.sucursalId`.

- [ ] **Step 1: Escribir las pruebas (fallan primero)**

Crear `backend/alcanceSucursal.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { alcanceSucursal, filtrarPorSucursal } = require("./auth");

const GLOBAL = ["ver_todas_las_sucursales"];

test("usuario global sin query ve todas", () => {
  const req = { query: {}, usuarioToken: { sucursal_id: 1 } };
  assert.deepStrictEqual(alcanceSucursal(req, GLOBAL), { verTodas: true, sucursalId: null });
});

test("usuario global con sucursal_id filtra a esa sucursal", () => {
  const req = { query: { sucursal_id: "3" }, usuarioToken: { sucursal_id: 1 } };
  assert.deepStrictEqual(alcanceSucursal(req, GLOBAL), { verTodas: false, sucursalId: 3 });
});

test("usuario global con 'todas' ve todas", () => {
  const req = { query: { sucursal_id: "todas" }, usuarioToken: { sucursal_id: 1 } };
  assert.deepStrictEqual(alcanceSucursal(req, GLOBAL), { verTodas: true, sucursalId: null });
});

test("usuario amarrado ignora el query y usa su sucursal del token", () => {
  const req = { query: { sucursal_id: "3" }, usuarioToken: { sucursal_id: 2 } };
  assert.deepStrictEqual(alcanceSucursal(req, []), { verTodas: false, sucursalId: 2 });
});

test("filtrarPorSucursal deja pasar todo cuando verTodas", () => {
  const lista = [{ sucursal_id: 1 }, { sucursal_id: 2 }];
  assert.strictEqual(filtrarPorSucursal(lista, { verTodas: true, sucursalId: null }).length, 2);
});

test("filtrarPorSucursal filtra por la sucursal indicada", () => {
  const lista = [{ sucursal_id: 1 }, { sucursal_id: 2 }, { sucursal_id: 2 }];
  const r = filtrarPorSucursal(lista, { verTodas: false, sucursalId: 2 });
  assert.strictEqual(r.length, 2);
  assert.ok(r.every((x) => x.sucursal_id === 2));
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd backend && node --test alcanceSucursal.test.js`
Expected: FAIL — `alcanceSucursal is not a function` (aún no existe).

- [ ] **Step 3: Implementar los helpers en `auth.js`**

En `backend/auth.js`, antes de `module.exports`, agregar:

```js
/**
 * Resuelve qué sucursal(es) puede ver este request.
 * - Con permiso "ver_todas_las_sucursales": respeta ?sucursal_id= si viene
 *   (para filtrar a una tienda) o devuelve verTodas si no.
 * - Sin ese permiso: se ignora el query y se fuerza la sucursal del token.
 */
function alcanceSucursal(req, permisos) {
  const puedeVerTodas = Array.isArray(permisos) && permisos.includes("ver_todas_las_sucursales");
  const solicitada = req.query ? req.query.sucursal_id : undefined;

  if (puedeVerTodas) {
    if (solicitada !== undefined && solicitada !== "" && solicitada !== "todas" && !Number.isNaN(Number(solicitada))) {
      return { verTodas: false, sucursalId: Number(solicitada) };
    }
    return { verTodas: true, sucursalId: null };
  }
  const sucursalToken = req.usuarioToken && req.usuarioToken.sucursal_id != null ? Number(req.usuarioToken.sucursal_id) : null;
  return { verTodas: false, sucursalId: sucursalToken };
}

/** Filtra un arreglo (que tenga campo sucursal_id) según el alcance resuelto. */
function filtrarPorSucursal(lista, alcance) {
  if (alcance.verTodas) return [...lista];
  return lista.filter((x) => Number(x.sucursal_id) === alcance.sucursalId);
}
```

Y en el `module.exports` (`backend/auth.js:69`), agregar las dos funciones:

```js
module.exports = { hashearPassword, verificarPassword, firmarToken, verificarToken, requiereLogin, requierePermiso, alcanceSucursal, filtrarPorSucursal };
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `cd backend && node --test alcanceSucursal.test.js`
Expected: PASS — 6 tests passing.

- [ ] **Step 5: Commit**

```bash
git add backend/auth.js backend/alcanceSucursal.test.js
git commit -m "feat: helper alcanceSucursal/filtrarPorSucursal para aislamiento por sucursal"
```

---

### Task 3: El token JWT lleva `sucursal_id`

**Files:**
- Modify: `backend/auth.js:28-34` (`firmarToken`)
- Create: `backend/firmarToken.test.js`

**Interfaces:**
- Consumes: `verificarToken` (ya existe).
- Produces: `firmarToken(usuario)` ahora incluye `sucursal_id` en el payload. El objeto `usuario` que recibe ya trae `sucursal_id` (ver `usuarios.js:29`).

- [ ] **Step 1: Escribir la prueba (falla primero)**

Crear `backend/firmarToken.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { firmarToken, verificarToken } = require("./auth");

test("el token incluye sucursal_id del usuario", () => {
  const token = firmarToken({ id: 5, nombre: "Cajera Yajalón", rol_id: 3, sucursal_id: 2 });
  const payload = verificarToken(token);
  assert.strictEqual(payload.sucursal_id, 2);
  assert.strictEqual(payload.id, 5);
  assert.strictEqual(payload.rol_id, 3);
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd backend && node --test firmarToken.test.js`
Expected: FAIL — `payload.sucursal_id` es `undefined` (assert falla con `undefined !== 2`).

- [ ] **Step 3: Modificar `firmarToken`**

En `backend/auth.js`, reemplazar la función `firmarToken` (líneas 28-34):

```js
function firmarToken(usuario) {
  return jwt.sign(
    { id: usuario.id, nombre: usuario.nombre, rol_id: usuario.rol_id, sucursal_id: usuario.sucursal_id },
    JWT_SECRET,
    { expiresIn: EXPIRA_EN }
  );
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `cd backend && node --test firmarToken.test.js`
Expected: PASS — 1 test passing.

- [ ] **Step 5: Commit**

```bash
git add backend/auth.js backend/firmarToken.test.js
git commit -m "feat: el token JWT ahora incluye sucursal_id"
```

---

### Task 4: Nuevo permiso `ver_todas_las_sucursales`

**Files:**
- Modify: `backend/permisosCatalogo.js:78-82` (agregar el permiso al módulo admin)
- Modify: `backend/roles.js:63-83` (el rol Administrador ya usa todas las claves; verificar Gerente/Cajero NO lo tienen)
- Create: `backend/permisoSucursales.test.js`

**Interfaces:**
- Consumes: `listarPermisos`, `sembrarRolesIniciales`, `permisosDeRol` (ya existen).
- Produces: clave de permiso `"ver_todas_las_sucursales"` en el catálogo, módulo `"admin"`. El rol "Administrador" la incluye (porque siembra todas las claves); "Gerente de sucursal" y "Cajero" NO.

- [ ] **Step 1: Escribir la prueba (falla primero)**

Crear `backend/permisoSucursales.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { listarPermisos } = require("./permisosCatalogo");
const { construirDBPrueba } = require("./testHelpers");
const { permisosDeRol } = require("./roles");

test("existe el permiso ver_todas_las_sucursales en modulo admin", () => {
  const p = listarPermisos().find((x) => x.clave === "ver_todas_las_sucursales");
  assert.ok(p, "el permiso debe existir en el catálogo");
  assert.strictEqual(p.modulo, "admin");
  assert.strictEqual(p.implementado, true);
});

test("Administrador tiene el permiso; Cajero y Gerente no", () => {
  const DB = construirDBPrueba();
  const admin = DB.admin.roles.find((r) => r.nombre === "Administrador");
  const gerente = DB.admin.roles.find((r) => r.nombre === "Gerente de sucursal");
  const cajero = DB.admin.roles.find((r) => r.nombre === "Cajero");
  assert.ok(permisosDeRol(DB, admin.id).includes("ver_todas_las_sucursales"));
  assert.ok(!permisosDeRol(DB, gerente.id).includes("ver_todas_las_sucursales"));
  assert.ok(!permisosDeRol(DB, cajero.id).includes("ver_todas_las_sucursales"));
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd backend && node --test permisoSucursales.test.js`
Expected: FAIL — el permiso no existe todavía (`p` es `undefined`).

- [ ] **Step 3: Agregar el permiso al catálogo**

En `backend/permisosCatalogo.js`, en la sección `// ---- Administración ----` (después de la línea 81, `usar_asistente_ia`):

```js
  { clave: "ver_todas_las_sucursales", etiqueta: "Ver Todas las Sucursales", modulo: "admin", implementado: true },
```

El rol "Administrador" (`roles.js:67`) siembra `todasLasClaves`, así que ya lo incluye. "Gerente de sucursal" (`roles.js:68-72`) filtra explícitamente algunas claves — agregar `"ver_todas_las_sucursales"` a ese filtro para que NO lo tenga:

```js
  crearRol(DB, {
    nombre: "Gerente de sucursal",
    permisos: todasLasClaves.filter((c) => c !== "eliminar_producto" && c !== "administrar_roles" && c !== "dar_alta_personal" && c !== "ver_todas_las_sucursales"),
    modulos: ["pos", "corte", "inventario", "crm"],
  });
```

"Cajero" (`roles.js:73-83`) tiene lista explícita que no incluye la clave — no se toca.

- [ ] **Step 4: Correr y verificar que pasa (y que el guardia de arranque sigue OK)**

Run: `cd backend && node --test permisoSucursales.test.js`
Expected: PASS — 2 tests passing.

Run: `cd backend && node -e "require('./validarPermisos').validarSistemaDePermisos()"`
Expected: imprime `✓ Sistema de permisos validado: 5 módulos, 56 permisos, ...` (56 = 55 previos + 1 nuevo) y sale sin error.

- [ ] **Step 5: Commit**

```bash
git add backend/permisosCatalogo.js backend/roles.js backend/permisoSucursales.test.js
git commit -m "feat: permiso ver_todas_las_sucursales (solo Administrador por defecto)"
```

---

### Task 5: Filtrado por sucursal en las funciones de datos (clientes y CRM)

**Files:**
- Modify: `backend/clientes.js:14-19` (`listarClientes`)
- Modify: `backend/crm.js:68-78` (`listarClientesCRM`)
- Create: `backend/filtradoDatos.test.js`

**Interfaces:**
- Consumes: `filtrarPorSucursal` (Task 2), `alcanceSucursal` (Task 2).
- Produces:
  - `listarClientes(DB, alcance)` — filtra por `alcance` PERO **siempre incluye el cliente id 0** (Público en General). Si `alcance` es `undefined`, se comporta como `verTodas` (compatibilidad).
  - `listarClientesCRM(DB, alcance)` — filtra por `alcance` (id 0 ya se excluye por lógica de CRM). Si `alcance` es `undefined`, `verTodas`.
- Nota: `listarVentas` (ya filtra por `filtros.sucursal_id`, `ventas.js:97`) y `listarCortes` (ya filtra por `sucursal_id`, `cortes.js:111-113`) NO cambian de firma; se controlan desde la ruta (Task 6).

- [ ] **Step 1: Escribir las pruebas (fallan primero)**

Crear `backend/filtradoDatos.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { listarClientes } = require("./clientes");
const { listarClientesCRM } = require("./crm");

const ALCANCE_YAJALON = { verTodas: false, sucursalId: 2 };
const ALCANCE_TODAS = { verTodas: true, sucursalId: null };

test("listarClientes filtra por sucursal pero mantiene a Público en General", () => {
  const DB = construirDBPrueba();
  const r = listarClientes(DB, ALCANCE_YAJALON);
  // Debe traer el cliente de Yajalón (id 2) y SIEMPRE el Público en General (id 0)
  assert.ok(r.some((c) => c.id === 2), "cliente de Yajalón presente");
  assert.ok(r.some((c) => c.id === 0), "Público en General siempre presente");
  assert.ok(!r.some((c) => c.id === 1), "cliente de Ocosingo NO debe aparecer");
});

test("listarClientes con verTodas trae todos", () => {
  const DB = construirDBPrueba();
  assert.strictEqual(listarClientes(DB, ALCANCE_TODAS).length, DB.crm.clientes.length);
});

test("listarClientesCRM filtra por sucursal", () => {
  const DB = construirDBPrueba();
  const r = listarClientesCRM(DB, ALCANCE_YAJALON);
  assert.ok(r.every((c) => c.sucursal_id === 2), "solo clientes de Yajalón");
  assert.ok(!r.some((c) => c.id === 0), "id 0 nunca en CRM");
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd backend && node --test filtradoDatos.test.js`
Expected: FAIL — `listarClientes` ignora el segundo argumento hoy, así que trae todos (falla el assert de que Ocosingo no aparece).

- [ ] **Step 3: Modificar `listarClientes` en `clientes.js`**

Reemplazar `listarClientes` (`backend/clientes.js:14-19`):

```js
function listarClientes(DB, alcance) {
  const conCredito = DB.crm.clientes.map((c) => ({
    ...c,
    credito_disponible: Math.max(0, (c.limite_credito || 0) - (c.saldo || 0)),
  }));
  if (!alcance || alcance.verTodas) return conCredito;
  // Público en General (id 0) es compartido: visible en toda sucursal.
  return conCredito.filter((c) => c.id === 0 || Number(c.sucursal_id) === alcance.sucursalId);
}
```

- [ ] **Step 4: Modificar `listarClientesCRM` en `crm.js`**

Reemplazar `listarClientesCRM` (`backend/crm.js:68-78`):

```js
function listarClientesCRM(DB, alcance) {
  return DB.crm.clientes
    .filter((c) => c.id !== 0)
    .filter((c) => !alcance || alcance.verTodas || Number(c.sucursal_id) === alcance.sucursalId)
    .map((c) => {
      const compras = comprasDeCliente(DB, c.id);
      const score = calcularScore(compras);
      const segmento = calcularSegmento(compras);
      const alertas = calcularAlertas(c, segmento);
      return { ...c, compras, score, segmento, alertas };
    });
}
```

- [ ] **Step 5: Correr y verificar que pasa**

Run: `cd backend && node --test filtradoDatos.test.js`
Expected: PASS — 3 tests passing.

- [ ] **Step 6: Commit**

```bash
git add backend/clientes.js backend/crm.js backend/filtradoDatos.test.js
git commit -m "feat: listarClientes/listarClientesCRM filtran por sucursal (id 0 compartido)"
```

---

### Task 6: Cablear rutas de LECTURA con login + alcance

**Files:**
- Modify: `backend/server.js` — rutas de ventas, clientes, CRM, cortes.

**Interfaces:**
- Consumes: `alcanceSucursal` (Task 2), `resolverPermisosDeRol` (ya existe, `server.js:267`), `listarClientes(DB, alcance)` (Task 5), `listarClientesCRM(DB, alcance)` (Task 5).
- Produces: rutas GET que exigen login y aplican el alcance del usuario.

- [ ] **Step 1: Importar `alcanceSucursal` en server.js**

En `backend/server.js:37`, agregar `alcanceSucursal` a la importación de `./auth`:

```js
const { requiereLogin, requierePermiso, firmarToken, alcanceSucursal } = require("./auth");
```

- [ ] **Step 2: Cablear `/api/clientes` (GET lista)**

Reemplazar la ruta (`backend/server.js:379`):

```js
app.get("/api/clientes", requiereLogin, (req, res) => {
  const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
  res.json(listarClientes(DB, alcance));
});
```

- [ ] **Step 3: Cablear `/api/crm/clientes` (GET lista)**

Reemplazar la ruta (`backend/server.js:398`):

```js
app.get("/api/crm/clientes", requiereLogin, (req, res) => {
  const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
  res.json(listarClientesCRM(DB, alcance));
});
```

- [ ] **Step 4: Cablear `/api/ventas` (GET lista)**

Reemplazar la ruta (`backend/server.js:420`). Se inyecta el `sucursal_id` del alcance en los filtros que ya entiende `listarVentas`; para usuario amarrado esto ignora cualquier `sucursal_id` del query porque se sobrescribe:

```js
app.get("/api/ventas", requiereLogin, (req, res) => {
  const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
  const filtros = { ...req.query };
  if (alcance.verTodas) delete filtros.sucursal_id;
  else filtros.sucursal_id = alcance.sucursalId;
  res.json(listarVentas(DB, filtros));
});
```

- [ ] **Step 5: Cablear `/api/cortes` y `/api/cortes/en-curso`**

Reemplazar ambas rutas (`backend/server.js:442-448`):

```js
app.get("/api/cortes/en-curso", requiereLogin, (req, res) => {
  const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
  // El corte en curso es siempre de UNA sucursal concreta. Global sin elegir → default a la 1.
  const sucursal_id = alcance.verTodas ? (Number(req.query.sucursal_id) || 1) : alcance.sucursalId;
  res.json(calcularCorteEnCurso(DB, sucursal_id));
});
app.get("/api/cortes", requiereLogin, requierePermiso("ver_historial_cortes", resolverPermisosDeRol), (req, res) => {
  const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
  res.json(listarCortes(DB, alcance.verTodas ? undefined : alcance.sucursalId));
});
```

- [ ] **Step 6: Verificación manual end-to-end**

Levantar el backend: `cd backend && npm start` (en otra terminal).

Crear usuarios y probar aislamiento con `curl` (o el asistente `!` del prompt):

```bash
# 1. Setup inicial (admin)
curl -s -X POST http://localhost:4000/api/auth/setup-inicial -H "Content-Type: application/json" -d '{"nombre":"Admin","usuario":"admin","password":"admin123"}'
# 2. Login admin -> copiar token
curl -s -X POST http://localhost:4000/api/auth/login -H "Content-Type: application/json" -d '{"usuario":"admin","password":"admin123"}'
# 3. GET /api/ventas con token admin -> debe traer ventas de TODAS las sucursales
curl -s http://localhost:4000/api/ventas -H "Authorization: Bearer <TOKEN_ADMIN>"
```

Expected:
- Sin token → `401 {"error":"No autenticado"}`.
- Con token admin (tiene `ver_todas_las_sucursales`) → ventas de varias sucursales.
- Con `?sucursal_id=2` y token admin → solo ventas de sucursal 2.

(La verificación de usuario amarrado se completa en Task 9 cuando haya datos repartidos y usuarios por sucursal; por ahora basta confirmar el 401 y el filtrado por query del admin.)

- [ ] **Step 7: Commit**

```bash
git add backend/server.js
git commit -m "feat: rutas de lectura exigen login y aplican alcance por sucursal"
```

---

### Task 6B: Aislar los endpoints agregados/derivados de CRM y predicciones

**Files:**
- Modify: `backend/crm.js:126-176` (`obtenerSeguimientosPostventaPendientes`, `resumenPorSucursal`, `rankingVendedores` aceptan alcance)
- Modify: `backend/server.js:412-417` (rutas CRM agregadas) y `271-279` (`/api/predicciones`)
- Create: `backend/crmAgregados.test.js`

**Interfaces:**
- Consumes: `alcanceSucursal` (Task 2), `listarClientesCRM(DB, alcance)` (Task 5).
- Produces:
  - `resumenPorSucursal(DB, alcance)` — para amarrado, solo su sucursal en el arreglo.
  - `rankingVendedores(DB, alcance)` — para amarrado, solo vendedores de su sucursal.
  - `obtenerSeguimientosPostventaPendientes(DB, diasConfigurados, alcance)` — para amarrado, solo ventas de su sucursal.
  - `/api/predicciones` exige login y, para amarrado, solo considera ventas de su sucursal (vía filtro previo).

- [ ] **Step 1: Escribir las pruebas (fallan primero)**

Crear `backend/crmAgregados.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { resumenPorSucursal, rankingVendedores } = require("./crm");

const YAJALON = { verTodas: false, sucursalId: 2 };
const TODAS = { verTodas: true, sucursalId: null };

test("resumenPorSucursal amarrado solo devuelve su sucursal", () => {
  const DB = construirDBPrueba();
  const r = resumenPorSucursal(DB, YAJALON);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].sucursal_id, 2);
});

test("resumenPorSucursal global devuelve las 4", () => {
  const DB = construirDBPrueba();
  assert.strictEqual(resumenPorSucursal(DB, TODAS).length, 4);
});

test("rankingVendedores amarrado solo trae vendedores de su sucursal", () => {
  const DB = construirDBPrueba();
  const r = rankingVendedores(DB, YAJALON);
  assert.ok(r.every((v) => DB.pos.vendedores.find((x) => x.id === v.vendedor_id)?.sucursal_id === 2));
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd backend && node --test crmAgregados.test.js`
Expected: FAIL — hoy `resumenPorSucursal` ignora el alcance y devuelve las 4 sucursales.

- [ ] **Step 3: Modificar `resumenPorSucursal` en `crm.js`**

Reemplazar `resumenPorSucursal` (`backend/crm.js:159-166`):

```js
function resumenPorSucursal(DB, alcance) {
  const clientes = listarClientesCRM(DB, alcance);
  const sucursales = !alcance || alcance.verTodas
    ? DB.pos.sucursales
    : DB.pos.sucursales.filter((s) => s.id === alcance.sucursalId);
  return sucursales.map((s) => {
    const cs = clientes.filter((c) => c.sucursal_id === s.id);
    const ventas = cs.reduce((a, c) => a + c.compras.reduce((b, p) => b + p.monto, 0), 0);
    return { sucursal_id: s.id, nombre: s.nombre, clientes: cs.length, ventas, convertidos: cs.filter((c) => c.estado === "compro").length };
  });
}
```

- [ ] **Step 4: Modificar `rankingVendedores` en `crm.js`**

Reemplazar `rankingVendedores` (`backend/crm.js:169-176`):

```js
function rankingVendedores(DB, alcance) {
  const clientes = listarClientesCRM(DB, alcance);
  const vendedores = !alcance || alcance.verTodas
    ? DB.pos.vendedores
    : DB.pos.vendedores.filter((v) => Number(v.sucursal_id) === alcance.sucursalId);
  return vendedores.map((v) => {
    const cs = clientes.filter((c) => c.vendedor_asignado_id === v.id);
    const ventas = cs.reduce((a, c) => a + c.compras.reduce((b, p) => b + p.monto, 0), 0);
    return { vendedor_id: v.id, nombre: v.nombre, clientes: cs.length, ventas, convertidos: cs.filter((c) => c.estado === "compro").length };
  }).sort((a, b) => b.ventas - a.ventas);
}
```

- [ ] **Step 5: Modificar `obtenerSeguimientosPostventaPendientes` en `crm.js`**

Reemplazar la línea del filtro inicial de ventas (`backend/crm.js:132-135`) para aceptar alcance. Cambiar la firma (`crm.js:126`) a `function obtenerSeguimientosPostventaPendientes(DB, diasConfigurados, alcance) {` y el filtro:

```js
  return DB.pos.ventas
    .filter((v) => v.estatus === "cerrada" && v.cliente_id !== 0)
    .filter((v) => !alcance || alcance.verTodas || Number(v.sucursal_id) === alcance.sucursalId)
    .filter((v) => diasDesde(v.fecha) >= dias)
    .filter((v) => !DB.crm.contactos_cliente.some((c) => c.venta_id === v.id && c.tipo === "postventa"))
```

- [ ] **Step 6: Cablear las rutas CRM agregadas y predicciones en `server.js`**

Reemplazar las rutas (`backend/server.js:412-417`):

```js
app.get("/api/crm/resumen-sucursales", requiereLogin, (req, res) => {
  const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
  res.json(resumenPorSucursal(DB, alcance));
});
app.get("/api/crm/postventa-pendientes", requiereLogin, (req, res) => {
  const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
  const config = obtenerConfiguracion(DB);
  res.json(obtenerSeguimientosPostventaPendientes(DB, config.dias_seguimiento_postventa, alcance));
});
app.get("/api/crm/ranking-vendedores", requiereLogin, (req, res) => {
  const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
  res.json(rankingVendedores(DB, alcance));
});
```

Reemplazar `/api/predicciones` (`backend/server.js:271-279`) para exigir login y limitar las ventas por alcance antes de predecir:

```js
app.get("/api/predicciones", requiereLogin, (req, res) => {
  const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
  const { producto_id, categoria_id, meses_adelante } = req.query;
  // Para el amarrado, se predice solo sobre las ventas de su sucursal.
  const DBScope = alcance.verTodas
    ? DB
    : { ...DB, pos: { ...DB.pos, ventas: DB.pos.ventas.filter((v) => Number(v.sucursal_id) === alcance.sucursalId) } };
  const resultado = predecirDemanda(DBScope, {
    producto_id: producto_id ? Number(producto_id) : undefined,
    categoria_id: categoria_id ? Number(categoria_id) : undefined,
    meses_adelante: meses_adelante ? Number(meses_adelante) : undefined
  });
  res.json(resultado);
});
```

- [ ] **Step 7: Correr pruebas y verificar que pasan**

Run: `cd backend && node --test crmAgregados.test.js`
Expected: PASS — 3 tests passing.

Run: `cd backend && npm test`
Expected: PASS — todas las suites en verde.

- [ ] **Step 8: Commit**

```bash
git add backend/crm.js backend/server.js backend/crmAgregados.test.js
git commit -m "feat: endpoints agregados de CRM y predicciones respetan el alcance por sucursal"
```

---

### Task 7: Estampar sucursal desde el token en las ESCRITURAS + inventario por sucursal

**Files:**
- Modify: `backend/productos.js:13-28` (`listarProductos` muestra existencia por sucursal) y `146-166` (`ajustarExistencia` acepta `sucursal_id`)
- Modify: `backend/ventas.js:81-88` (`crearVenta` descuenta de la sucursal correcta)
- Modify: `backend/server.js` — rutas POST de ventas y clientes estampan sucursal del token; GET `/api/productos` muestra existencia de la sucursal en alcance
- Create: `backend/escrituraSucursal.test.js`

**Interfaces:**
- Consumes: `ajustarExistencia`, `crearVenta`, `crearCliente`, `alcanceSucursal`, `listarProductos`.
- Produces:
  - `listarProductos(DB, sucursalId)` — muestra `existencia` de esa sucursal (default 1). Si `sucursalId` es `null` (global "todas"), suma existencias de todas las sucursales.
  - `ajustarExistencia(DB, id, { cantidad, motivo, sucursal_id })` — usa `sucursal_id` (default 1) en vez de hardcodear 1.
  - `crearVenta(DB, datos)` — al descontar inventario pasa `sucursal_id: venta.sucursal_id` a `ajustarExistencia`.
  - Ruta POST `/api/ventas` y `/api/clientes` estampan `sucursal_id` según el usuario (token para amarrado, body/selección para global). GET `/api/productos` exige login y muestra existencia por sucursal.

- [ ] **Step 1: Escribir la prueba (falla primero)**

Crear `backend/escrituraSucursal.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { ajustarExistencia } = require("./productos");
const { crearVenta } = require("./ventas");
const { obtenerConfiguracion } = require("./configuracion");

test("ajustarExistencia afecta la existencia de la sucursal indicada", () => {
  const DB = construirDBPrueba();
  // producto 2 tiene existencia en sucursal 2 (cantidad 80)
  ajustarExistencia(DB, 2, { cantidad: -5, motivo: "prueba", sucursal_id: 2 });
  const exist = DB.inventario.existencias.find((e) => e.producto_id === 2 && e.sucursal_id === 2);
  assert.strictEqual(exist.cantidad_actual, 75);
});

test("crearVenta descuenta inventario de su propia sucursal", () => {
  const DB = construirDBPrueba();
  obtenerConfiguracion(DB); // inicializa config
  DB.pos.configuracion.permitir_ventas_sin_existencia = true; // no bloquear por stock en la prueba
  crearVenta(DB, { sucursal_id: 2, cliente_id: 0, lineas: [{ producto_id: 2, cantidad: 10, precio_unitario: 16 }], total: 160 });
  const exist = DB.inventario.existencias.find((e) => e.producto_id === 2 && e.sucursal_id === 2);
  assert.strictEqual(exist.cantidad_actual, 70, "se descontó de la sucursal 2");
});

test("listarProductos muestra la existencia de la sucursal pedida", () => {
  const { listarProductos } = require("./productos");
  const DB = construirDBPrueba();
  // producto 2 tiene 80 en sucursal 2 y 0 en sucursal 1 (fixture)
  const enSuc2 = listarProductos(DB, 2).find((p) => p.id === 2);
  const enSuc1 = listarProductos(DB, 1).find((p) => p.id === 2);
  assert.strictEqual(enSuc2.existencia, 80);
  assert.strictEqual(enSuc1.existencia, 0);
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd backend && node --test escrituraSucursal.test.js`
Expected: FAIL — `ajustarExistencia` busca `sucursal_id === 1` y no encuentra existencia del producto 2 en sucursal 1, lanza `"Este producto no tiene registro de existencia"`.

- [ ] **Step 3: Generalizar `listarProductos` por sucursal**

Reemplazar `listarProductos` (`backend/productos.js:13-28`):

```js
function listarProductos(DB, sucursalId) {
  return DB["catalogo-productos"].productos.map((p) => {
    // Global "todas" (sucursalId null): suma la existencia de todas las sucursales.
    // Sucursal concreta (o default 1): existencia de esa sucursal.
    const existenciasProducto = DB.inventario.existencias.filter((e) => e.producto_id === p.id);
    let exist;
    if (sucursalId == null) {
      const total = existenciasProducto.reduce((a, e) => a + (e.cantidad_actual || 0), 0);
      exist = existenciasProducto.length ? { cantidad_actual: total, cantidad_minima: 0, cantidad_maxima: 0 } : null;
    } else {
      exist = existenciasProducto.find((e) => e.sucursal_id === Number(sucursalId)) || null;
    }
    const categoria = DB["catalogo-productos"].categorias.find((c) => c.id === p.categoria_id);
    return {
      ...p,
      codigo: p.clave_alterna || p.sku,
      ubicacion: p.ubicacion || "-",
      promocion: !!p.promocion,
      existencia: exist ? exist.cantidad_actual : 0,
      existencia_minima: exist ? exist.cantidad_minima : 0,
      existencia_maxima: exist ? exist.cantidad_maxima : 0,
      categoria_nombre: categoria ? categoria.nombre : "Sin definir",
    };
  });
}
```

Nota: el default de sucursal lo aplica la ruta (Step 6), no la firma. Si algún llamador interno la usa sin argumento, `sucursalId` será `undefined` → `== null` es verdadero → suma total. Hoy el único llamador es la ruta `/api/productos`.

- [ ] **Step 4: Generalizar `ajustarExistencia`**

Reemplazar `ajustarExistencia` (`backend/productos.js:146-166`):

```js
function ajustarExistencia(DB, id, { cantidad, motivo, sucursal_id }) {
  const suc = Number(sucursal_id) || 1;
  const exist = DB.inventario.existencias.find((e) => e.producto_id === Number(id) && e.sucursal_id === suc);
  if (!exist) throw new Error("Este producto no tiene registro de existencia en esta sucursal");
  const delta = Number(cantidad) || 0;
  exist.cantidad_actual = exist.cantidad_actual + delta;
  DB.inventario.movimientos_inventario.push({
    id: siguienteId(DB.inventario.movimientos_inventario.length ? DB.inventario.movimientos_inventario : [{ id: 0 }]),
    producto_id: Number(id),
    sucursal_id: suc,
    fecha: new Date().toISOString(),
    tipo: delta >= 0 ? "entrada" : "salida",
    cantidad: delta,
    referencia_documento: motivo || "Ajuste manual",
  });
  return exist;
}
```

- [ ] **Step 5: `crearVenta` pasa la sucursal al descontar y al reintegrar**

En `backend/ventas.js`, dentro de `crearVenta`, la llamada a `ajustarExistencia` (línea 83) pasa la sucursal:

```js
      try {
        ajustarExistencia(DB, l.producto_id, { cantidad: -cantidad, motivo: `Venta — folio ${nuevoId}`, sucursal_id: venta.sucursal_id });
      } catch (e) {
        // Si el producto no tiene registro de existencia en esta sucursal, no se detiene la venta
      }
```

Y en `cancelarVenta` (línea 155), el reintegro también:

```js
          ajustarExistencia(DB, l.producto_id, { cantidad: Number(l.cantidad), motivo: `Cancelación de venta — folio ${venta.id}`, sucursal_id: venta.sucursal_id });
```

- [ ] **Step 6: Estampar sucursal en escrituras y cablear GET `/api/productos`**

En `backend/server.js`, reemplazar GET `/api/productos` (`backend/server.js:282`) para que exija login y muestre existencia de la sucursal en alcance:

```js
app.get("/api/productos", requiereLogin, (req, res) => {
  const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
  // Amarrado o global-con-sucursal: existencia de esa sucursal. Global "todas": suma (null).
  const sucursalId = alcance.verTodas ? null : alcance.sucursalId;
  res.json(listarProductos(DB, sucursalId));
});
```

Reemplazar POST `/api/ventas` (`backend/server.js:425-428`):

```js
app.post("/api/ventas", requiereLogin, requierePermiso("cerrar_venta", resolverPermisosDeRol), (req, res) => {
  try {
    const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
    // Amarrado: su sucursal del token, sin importar el body. Global: la que venga en el body (o 1).
    const sucursal_id = alcance.verTodas ? (Number(req.body.sucursal_id) || 1) : alcance.sucursalId;
    res.json(crearVenta(DB, { ...req.body, sucursal_id }));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
```

Reemplazar POST `/api/clientes` (`backend/server.js:384-387`):

```js
app.post("/api/clientes", requiereLogin, requierePermiso("crear_cliente", resolverPermisosDeRol), (req, res) => {
  try {
    const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
    const sucursal_id = alcance.verTodas ? (Number(req.body.sucursal_id) || 1) : alcance.sucursalId;
    res.json(crearCliente(DB, { ...req.body, sucursal_id }));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
```

El POST `/api/cortes` (`backend/server.js:449`) ya recibe `sucursal_id` en el body; agregar el mismo estampado:

```js
app.post("/api/cortes", requiereLogin, requierePermiso("realizar_corte_caja", resolverPermisosDeRol), (req, res) => {
  try {
    const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
    const sucursal_id = alcance.verTodas ? (Number(req.body.sucursal_id) || 1) : alcance.sucursalId;
    res.json(crearCorte(DB, {
      ...req.body,
      sucursal_id,
      usuario_id: req.usuarioToken?.id ?? null,
      usuario_nombre: req.usuarioToken?.nombre || req.body.usuario_nombre || "—",
    }));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
```

- [ ] **Step 7: Correr pruebas y verificar que pasan**

Run: `cd backend && node --test escrituraSucursal.test.js`
Expected: PASS — 3 tests passing.

Run: `cd backend && npm test`
Expected: PASS — todas las suites (Tasks 1-7) en verde.

- [ ] **Step 8: Commit**

```bash
git add backend/productos.js backend/ventas.js backend/server.js backend/escrituraSucursal.test.js
git commit -m "feat: escrituras estampan sucursal del token; inventario por sucursal"
```

---

### Task 8: Asistente de IA con conciencia de sucursal

**Files:**
- Modify: `backend/server.js:179-185` (`consultarModulo` acepta alcance) y `223-261` (`construirSystemPrompt`) y `470-525` (ruta `/api/chat`)
- Create: `backend/consultarModuloSucursal.test.js`

**Interfaces:**
- Consumes: `alcanceSucursal`, la estructura `DB`.
- Produces:
  - `consultarModulo(input, alcance, DB)` — cuando `alcance` NO es verTodas, fuerza el `sucursal_id` en los filtros de tablas que lo tengan; para `venta_detalle` (sin `sucursal_id`) filtra cruzando contra `ventas` de la sucursal.
  - El system prompt incluye el alcance del usuario y el catálogo de sucursales.

- [ ] **Step 1: Escribir la prueba (falla primero)**

Crear `backend/consultarModuloSucursal.test.js`. Como `consultarModulo` está definido dentro de `server.js` (no exportado), esta tarea primero lo extrae a un módulo propio testeable.

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { consultarModulo } = require("./consultarModulo");

const YAJALON = { verTodas: false, sucursalId: 2 };
const TODAS = { verTodas: true, sucursalId: null };

test("consultarModulo fuerza la sucursal del usuario amarrado en ventas", () => {
  const DB = construirDBPrueba();
  const r = consultarModulo({ modulo: "pos", tabla: "ventas" }, YAJALON, DB);
  assert.ok(r.every((v) => v.sucursal_id === 2), "solo ventas de Yajalón");
});

test("consultarModulo ignora un sucursal_id ajeno pedido por un amarrado", () => {
  const DB = construirDBPrueba();
  const r = consultarModulo({ modulo: "pos", tabla: "ventas", filtros: { sucursal_id: 1 } }, YAJALON, DB);
  assert.ok(r.every((v) => v.sucursal_id === 2), "no puede espiar la sucursal 1");
});

test("consultarModulo filtra venta_detalle cruzando por ventas de la sucursal", () => {
  const DB = construirDBPrueba();
  const r = consultarModulo({ modulo: "pos", tabla: "venta_detalle" }, YAJALON, DB);
  const ventasYajalon = DB.pos.ventas.filter((v) => v.sucursal_id === 2).map((v) => v.id);
  assert.ok(r.every((d) => ventasYajalon.includes(d.venta_id)), "solo detalle de ventas de Yajalón");
});

test("usuario global ve todo", () => {
  const DB = construirDBPrueba();
  const r = consultarModulo({ modulo: "pos", tabla: "ventas" }, TODAS, DB);
  assert.strictEqual(r.length, DB.pos.ventas.length);
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd backend && node --test consultarModuloSucursal.test.js`
Expected: FAIL — `Cannot find module './consultarModulo'`.

- [ ] **Step 3: Extraer `consultarModulo` a su propio módulo con alcance**

Crear `backend/consultarModulo.js` (mueve la lógica de `server.js:155-185` y le agrega el alcance):

```js
/**
 * consultarModulo.js — Herramienta de consulta que usa el Asistente de IA.
 * Aplica el alcance por sucursal: un usuario amarrado nunca obtiene datos de
 * otra tienda, aunque los pida en los filtros.
 */

const CAMPO_SUMA = { ventas: "total", venta_detalle: "subtotal", existencias: "cantidad_actual" };

// Tablas que tienen sucursal_id propio y por tanto se filtran directo.
const TABLAS_CON_SUCURSAL = ["ventas", "existencias", "vendedores", "cortes_caja", "clientes"];

function aplicarFiltros(datos, filtros) {
  let resultado = [...datos];
  Object.keys(filtros || {}).forEach((clave) => {
    const valor = filtros[clave];
    if (clave === "fecha_inicio") resultado = resultado.filter((d) => d.fecha && d.fecha >= valor);
    else if (clave === "fecha_fin") resultado = resultado.filter((d) => d.fecha && d.fecha <= valor);
    else if (resultado.length && resultado[0][clave] !== undefined) resultado = resultado.filter((d) => String(d[clave]) === String(valor));
  });
  return resultado;
}

function agruparYSumar(datos, campoAgrupar, campoSumar) {
  const grupos = {};
  datos.forEach((d) => {
    let clave = d[campoAgrupar];
    if (campoAgrupar === "mes" && d.fecha) clave = d.fecha.slice(0, 7);
    if (clave === undefined) return;
    grupos[clave] = (grupos[clave] || 0) + (Number(d[campoSumar]) || 0);
  });
  return Object.entries(grupos).map(([clave, total]) => ({ [campoAgrupar]: clave, [campoSumar]: total }));
}

function consultarModulo({ modulo, tabla, filtros, agrupar_por }, alcance, DB) {
  if (!DB[modulo]) throw new Error(`Módulo "${modulo}" no existe. Disponibles: ${Object.keys(DB).join(", ")}`);
  if (!DB[modulo][tabla]) throw new Error(`Tabla "${tabla}" no existe en "${modulo}". Disponibles: ${Object.keys(DB[modulo]).join(", ")}`);

  const filtrosEfectivos = { ...(filtros || {}) };
  const amarrado = alcance && !alcance.verTodas;

  // Amarrado: se fuerza su sucursal en tablas que la tengan, ignorando lo que pida.
  if (amarrado && TABLAS_CON_SUCURSAL.includes(tabla)) {
    filtrosEfectivos.sucursal_id = alcance.sucursalId;
  }

  let resultado = aplicarFiltros(DB[modulo][tabla], filtrosEfectivos);

  // venta_detalle no tiene sucursal_id: se cruza contra las ventas visibles.
  if (amarrado && tabla === "venta_detalle") {
    const ventasVisibles = new Set(
      DB.pos.ventas.filter((v) => Number(v.sucursal_id) === alcance.sucursalId).map((v) => v.id)
    );
    resultado = resultado.filter((d) => ventasVisibles.has(d.venta_id));
  }

  if (agrupar_por) resultado = agruparYSumar(resultado, agrupar_por, CAMPO_SUMA[tabla] || "total");
  return resultado;
}

module.exports = { consultarModulo };
```

- [ ] **Step 4: Usar el módulo extraído en `server.js`**

En `backend/server.js`, agregar la importación cerca de las otras (después de `server.js:39`):

```js
const { consultarModulo } = require("./consultarModulo");
```

Borrar de `server.js` las funciones locales `aplicarFiltros`, `agruparYSumar` y `consultarModulo` (líneas 155-185) y la constante `CAMPO_SUMA` (línea 155). Dejar `listarModulosYTablas` (línea 187) como está.

En la ruta `/api/chat`, calcular el alcance una vez (después de `server.js:476`, donde se lee `mensajes`):

```js
    const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
```

Y en la llamada dentro del `map` de herramientas (`server.js:507`), pasar alcance y DB:

```js
          } else {
            resultado = consultarModulo(bloque.input, alcance, DB);
          }
```

- [ ] **Step 5: Inyectar el alcance en el system prompt**

Reemplazar la firma y el final de `construirSystemPrompt` (`server.js:223`) para que reciba el alcance y las sucursales:

```js
function construirSystemPrompt(alcance, DB) {
  const hoy = new Date();
  const fechaISO = hoy.toISOString().slice(0, 10);
  const diaSemana = hoy.toLocaleDateString("es-MX", { weekday: "long" });

  const sucursales = DB.pos.sucursales.map((s) => `${s.id}=${s.nombre}`).join(", ");
  const alcanceTexto = alcance.verTodas
    ? `Este usuario puede ver TODAS las sucursales (${sucursales}). Cuando le pidan comparar o desglosar por tienda, usa el filtro sucursal_id. Sucursales: ${sucursales}.`
    : `Este usuario SOLO puede ver la sucursal ${alcance.sucursalId} (${DB.pos.sucursales.find((s) => s.id === alcance.sucursalId)?.nombre || "—"}). Aunque pregunte por otra sucursal, tus datos ya vienen limitados a la suya; no inventes datos de otras tiendas y acláralo si insiste.`;

  return `Eres el asistente de inteligencia de negocio del dashboard principal del sistema.

ALCANCE DE SUCURSAL DEL USUARIO: ${alcanceTexto}

FECHA ACTUAL DEL SISTEMA: ${fechaISO} (${diaSemana}). Usa siempre esta fecha real para
interpretar "hoy", "ayer", "esta semana", "este mes", etc. — nunca inventes ni asumas
qué fecha es hoy; si necesitas calcular un rango, hazlo a partir de este valor exacto.

Antes de responder preguntas sobre ventas, inventario, clientes o proveedores, usa la
herramienta consultar_modulo para obtener datos reales; nunca inventes cifras.
Cuando pregunten por pronósticos, estacionalidad, o qué conviene tener en stock, usa la
herramienta predecir_demanda.
Si preguntan por tendencias, agrupa por mes. Desglosa por proveedor, categoría o
vendedor si el usuario no especifica.

Responde en español, breve y claro, con las cifras en pesos cuando aplique.
Módulos y tablas disponibles: ${JSON.stringify(listarModulosYTablas())}`;
}
```

Y en la llamada a Claude (`server.js:487`), pasar el alcance:

```js
        system: construirSystemPrompt(alcance, DB),
```

- [ ] **Step 6: Correr pruebas**

Run: `cd backend && node --test consultarModuloSucursal.test.js`
Expected: PASS — 4 tests passing.

Run: `cd backend && npm test`
Expected: PASS — todas las suites en verde.

- [ ] **Step 7: Verificación manual del chat (opcional, requiere ANTHROPIC_API_KEY)**

Con el backend levantado y un token de usuario amarrado a sucursal 2, hacer POST a `/api/chat` con `{"mensajes":[{"role":"user","content":"¿cuánto vendimos en total?"}]}` y confirmar que la respuesta refleja solo la sucursal 2. (Si no hay API key, este paso se omite; las pruebas unitarias del Step 6 ya cubren la lógica de aislamiento.)

- [ ] **Step 8: Commit**

```bash
git add backend/server.js backend/consultarModulo.js backend/consultarModuloSucursal.test.js
git commit -m "feat: el Asistente de IA respeta el alcance por sucursal del usuario"
```

---

### Task 9: Repartir datos de prueba entre las 4 sucursales

**Files:**
- Modify: `backend/server.js:50-151` (el objeto `DB`)

**Interfaces:**
- Consumes: nada.
- Produces: datos semilla repartidos: ventas, existencias, clientes y vendedores en las 4 sucursales, para poder demostrar el aislamiento.

- [ ] **Step 1: Repartir ventas entre las 4 sucursales**

En `backend/server.js`, en `DB.pos.ventas` (líneas 52-58), cambiar los `sucursal_id` y `vendedor_id` para cubrir las 4 tiendas (dejar montos y fechas):

```js
    ventas: [
      { id: 1, fecha: "2026-05-10", sucursal_id: 1, vendedor_id: 1, cliente_id: 1, total: 1200, metodo_pago: "efectivo", estatus: "cerrada" },
      { id: 2, fecha: "2026-05-20", sucursal_id: 2, vendedor_id: 3, cliente_id: 2, total: 800, metodo_pago: "tarjeta", estatus: "cerrada" },
      { id: 3, fecha: "2026-06-05", sucursal_id: 3, vendedor_id: 4, cliente_id: 0, total: 2100, metodo_pago: "efectivo", estatus: "cerrada" },
      { id: 4, fecha: "2026-06-18", sucursal_id: 4, vendedor_id: 5, cliente_id: 0, total: 950, metodo_pago: "efectivo", estatus: "cerrada" },
      { id: 5, fecha: "2026-06-25", sucursal_id: 1, vendedor_id: 1, cliente_id: 1, total: 1750, metodo_pago: "tarjeta", estatus: "cerrada" }
    ],
```

- [ ] **Step 2: Repartir existencias entre las 4 sucursales**

En `DB.inventario.existencias` (líneas 118-122), dar existencia a cada producto en las 4 sucursales (así ninguna venta se bloquea por falta de stock):

```js
    existencias: [
      { producto_id: 1, sucursal_id: 1, cantidad_actual: 120, cantidad_minima: 30, cantidad_maxima: 300 },
      { producto_id: 2, sucursal_id: 1, cantidad_actual: 15, cantidad_minima: 40, cantidad_maxima: 400 },
      { producto_id: 3, sucursal_id: 1, cantidad_actual: 60, cantidad_minima: 20, cantidad_maxima: 150 },
      { producto_id: 4, sucursal_id: 1, cantidad_actual: 200, cantidad_minima: 50, cantidad_maxima: 500 },
      { producto_id: 1, sucursal_id: 2, cantidad_actual: 90, cantidad_minima: 30, cantidad_maxima: 300 },
      { producto_id: 2, sucursal_id: 2, cantidad_actual: 110, cantidad_minima: 40, cantidad_maxima: 400 },
      { producto_id: 3, sucursal_id: 3, cantidad_actual: 45, cantidad_minima: 20, cantidad_maxima: 150 },
      { producto_id: 4, sucursal_id: 4, cantidad_actual: 300, cantidad_minima: 50, cantidad_maxima: 500 }
    ],
```

- [ ] **Step 3: Repartir clientes entre sucursales**

En `DB.crm.clientes`, cambiar `sucursal_id` del cliente id 2 a `2` (Yajalón) y el id 1 se queda en `1` (Ocosingo). El id 0 (Público en General) se queda en 1 pero es compartido por lógica:

```js
        // ... cliente id 2 (Juan Pérez): cambiar sucursal_id de 1 a 2
        fecha_alta: "2025-06-15", vendedor_asignado_id: 3, sucursal_id: 2,
```

- [ ] **Step 4: Verificación manual del aislamiento completo**

Levantar backend (`npm start`) y crear un usuario amarrado a Yajalón:

```bash
# Con token de admin, crear un cajero de Yajalón (rol Cajero id=3, sucursal_id=2)
curl -s -X POST http://localhost:4000/api/usuarios -H "Authorization: Bearer <TOKEN_ADMIN>" -H "Content-Type: application/json" -d '{"nombre":"Cajera Yajalon","usuario":"yaj","password":"yaj123","rol_id":3,"sucursal_id":2}'
# Login como ese cajero -> token
curl -s -X POST http://localhost:4000/api/auth/login -H "Content-Type: application/json" -d '{"usuario":"yaj","password":"yaj123"}'
# GET /api/ventas con su token -> SOLO ventas de sucursal 2
curl -s "http://localhost:4000/api/ventas" -H "Authorization: Bearer <TOKEN_YAJALON>"
# Intentar espiar Ocosingo -> IGNORADO, sigue devolviendo solo sucursal 2
curl -s "http://localhost:4000/api/ventas?sucursal_id=1" -H "Authorization: Bearer <TOKEN_YAJALON>"
```

Expected: ambas llamadas del cajero devuelven únicamente ventas con `sucursal_id: 2`. El admin sí ve todas y puede filtrar con `?sucursal_id=`.

- [ ] **Step 5: Commit**

```bash
git add backend/server.js
git commit -m "test: datos semilla repartidos entre las 4 sucursales para demostrar aislamiento"
```

---

### Task 10: Login y `/api/auth/yo` devuelven la sucursal

**Files:**
- Modify: `backend/server.js:332-349` (rutas `/api/auth/login` y `/api/auth/yo`)
- Create: `backend/authSucursal.test.js`

**Interfaces:**
- Consumes: `obtenerRol`, `permisosDeRol`.
- Produces: la respuesta de login y de `/api/auth/yo` incluye `sucursal_id`, `sucursal_nombre` y `ver_todas` (booleano derivado de los permisos del rol).

- [ ] **Step 1: Escribir la prueba de la forma de la respuesta**

Crear `backend/authSucursal.test.js` (prueba pura de un helper que arma el payload de sesión, para no depender de HTTP):

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { armarSesion } = require("./sesion");

test("armarSesion incluye sucursal y ver_todas para admin", () => {
  const DB = construirDBPrueba();
  const admin = DB.admin.roles.find((r) => r.nombre === "Administrador");
  const usuario = { id: 1, nombre: "Admin", rol_id: admin.id, sucursal_id: 1 };
  const s = armarSesion(DB, usuario);
  assert.strictEqual(s.sucursal_id, 1);
  assert.strictEqual(s.sucursal_nombre, "Ocosingo");
  assert.strictEqual(s.ver_todas, true);
});

test("armarSesion marca ver_todas=false para cajero", () => {
  const DB = construirDBPrueba();
  const cajero = DB.admin.roles.find((r) => r.nombre === "Cajero");
  const usuario = { id: 2, nombre: "Cajera", rol_id: cajero.id, sucursal_id: 2 };
  const s = armarSesion(DB, usuario);
  assert.strictEqual(s.sucursal_id, 2);
  assert.strictEqual(s.sucursal_nombre, "Yajalón");
  assert.strictEqual(s.ver_todas, false);
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd backend && node --test authSucursal.test.js`
Expected: FAIL — `Cannot find module './sesion'`.

- [ ] **Step 3: Crear el helper `sesion.js`**

Crear `backend/sesion.js`:

```js
/**
 * sesion.js — Arma el objeto de sesión que se devuelve al frontend en el
 * login y en /api/auth/yo, incluyendo la sucursal del usuario y si tiene
 * vista global.
 */

const { obtenerRol, permisosDeRol } = require("./roles");

function armarSesion(DB, usuario) {
  const rol = obtenerRol(DB, usuario.rol_id);
  const permisos = permisosDeRol(DB, usuario.rol_id);
  const sucursal = DB.pos.sucursales.find((s) => s.id === Number(usuario.sucursal_id));
  return {
    id: usuario.id,
    nombre: usuario.nombre,
    rol: rol.nombre,
    rol_id: rol.id,
    permisos: rol.permisos,
    modulos: rol.modulos,
    sucursal_id: usuario.sucursal_id,
    sucursal_nombre: sucursal ? sucursal.nombre : "—",
    ver_todas: permisos.includes("ver_todas_las_sucursales"),
  };
}

module.exports = { armarSesion };
```

- [ ] **Step 4: Usar `armarSesion` en las rutas de auth**

En `backend/server.js`, agregar la importación (después de `server.js:39`):

```js
const { armarSesion } = require("./sesion");
```

Reemplazar `/api/auth/login` (`server.js:332-340`):

```js
app.post("/api/auth/login", async (req, res) => {
  try {
    const { usuario, password } = req.body;
    const encontrado = await iniciarSesion(DB, usuario, password);
    const token = firmarToken(encontrado);
    res.json({ token, usuario: armarSesion(DB, encontrado) });
  } catch (e) { res.status(401).json({ error: e.message }); }
});
```

Reemplazar `/api/auth/yo` (`server.js:342-349`):

```js
app.get("/api/auth/yo", requiereLogin, (req, res) => {
  try {
    const usuario = DB.admin.usuarios.find((u) => u.id === req.usuarioToken.id);
    if (!usuario) return res.status(404).json({ error: "Usuario no encontrado" });
    res.json(armarSesion(DB, usuario));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
```

- [ ] **Step 5: Correr pruebas**

Run: `cd backend && node --test authSucursal.test.js`
Expected: PASS — 2 tests passing.

Run: `cd backend && npm test`
Expected: PASS — todas las suites en verde.

- [ ] **Step 6: Commit**

```bash
git add backend/server.js backend/sesion.js backend/authSucursal.test.js
git commit -m "feat: login y /auth/yo devuelven sucursal y bandera ver_todas"
```

---

### Task 11: Frontend — selector de sucursal, etiqueta fija y envío del filtro

**Files:**
- Modify: `src/api.js` (agregar el `sucursal_id` seleccionado a cada request)
- Modify: `src/App.jsx` (guardar sesión con sucursal; montar el selector/etiqueta)
- Create: `src/SelectorSucursal.jsx`

**Interfaces:**
- Consumes: la respuesta de login (`usuario.sucursal_id`, `usuario.sucursal_nombre`, `usuario.ver_todas`) de Task 10; `apiFetch` (existe).
- Produces:
  - `localStorage` guarda `sucursal_activa` (id seleccionado, o `"todas"`).
  - `apiFetch` agrega `?sucursal_id=<sucursal_activa>` a las llamadas cuando aplica.
  - `<SelectorSucursal>` visible solo si `ver_todas`; si no, muestra etiqueta fija.

- [ ] **Step 1: Que `apiFetch` agregue la sucursal activa**

Reemplazar `src/api.js`:

```js
/**
 * api.js — Envoltura de fetch que agrega el token de sesión (JWT) y la
 * sucursal activa a cada llamada, para no repetir esta lógica en cada
 * componente. El backend ignora la sucursal para usuarios amarrados; solo
 * la respeta para quien tiene "ver_todas_las_sucursales".
 */

export const API = "http://localhost:4000/api";

export async function apiFetch(ruta, opciones = {}) {
  const token = localStorage.getItem("token");
  const sucursalActiva = localStorage.getItem("sucursal_activa"); // id numérico o "todas"

  // Agregar sucursal_id como query param (salvo que ya venga en la ruta o sea "todas").
  let rutaFinal = ruta;
  if (sucursalActiva && sucursalActiva !== "todas" && !ruta.includes("sucursal_id=")) {
    rutaFinal += (ruta.includes("?") ? "&" : "?") + "sucursal_id=" + encodeURIComponent(sucursalActiva);
  }

  const headers = { "Content-Type": "application/json", ...(opciones.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${rutaFinal}`, { ...opciones, headers });
  if (res.status === 401) {
    localStorage.removeItem("token");
    localStorage.removeItem("usuario");
    localStorage.removeItem("sucursal_activa");
    window.location.reload();
  }
  return res;
}
```

- [ ] **Step 2: Crear el componente `SelectorSucursal`**

Crear `src/SelectorSucursal.jsx`:

```jsx
import { useEffect, useState } from "react";
import { apiFetch } from "./api";

/**
 * Selector de sucursal para usuarios con vista global (ver_todas).
 * Para usuarios amarrados, muestra una etiqueta fija con su sucursal.
 *
 * Props:
 *  - usuario: objeto de sesión ({ ver_todas, sucursal_id, sucursal_nombre }).
 *  - onCambio: callback(sucursalId | "todas") cuando cambia la selección.
 */
export default function SelectorSucursal({ usuario, onCambio }) {
  const [sucursales, setSucursales] = useState([]);
  const [valor, setValor] = useState(localStorage.getItem("sucursal_activa") || "todas");

  useEffect(() => {
    if (!usuario?.ver_todas) return;
    apiFetch("/sucursales")
      .then((r) => r.json())
      .then(setSucursales)
      .catch(() => setSucursales([]));
  }, [usuario]);

  if (!usuario?.ver_todas) {
    return (
      <span className="text-sm text-gray-600 px-3 py-1 rounded bg-gray-100">
        Sucursal: <strong>{usuario?.sucursal_nombre || "—"}</strong>
      </span>
    );
  }

  function cambiar(e) {
    const v = e.target.value;
    setValor(v);
    localStorage.setItem("sucursal_activa", v);
    onCambio?.(v);
  }

  return (
    <select value={valor} onChange={cambiar} className="text-sm border rounded px-2 py-1">
      <option value="todas">Todas las sucursales</option>
      {sucursales.map((s) => (
        <option key={s.id} value={s.id}>{s.nombre}</option>
      ))}
    </select>
  );
}
```

- [ ] **Step 3: Inicializar `sucursal_activa` al hacer login y montar el selector**

En `src/App.jsx`, tras un login exitoso (donde se guarda `usuario` en localStorage), inicializar la sucursal activa. Buscar el punto donde se procesa la respuesta del login y agregar:

```jsx
// Al recibir la sesión del login (objeto `usuario` con ver_todas y sucursal_id):
localStorage.setItem("usuario", JSON.stringify(usuario));
localStorage.setItem("sucursal_activa", usuario.ver_todas ? "todas" : String(usuario.sucursal_id));
```

En el encabezado/topbar del layout principal (donde se muestra el nombre del usuario), montar el selector. Al cambiar, recargar los datos de la vista actual (la forma más simple y segura: `window.location.reload()`):

```jsx
import SelectorSucursal from "./SelectorSucursal";

// Dentro del render del topbar, junto al nombre del usuario:
<SelectorSucursal usuario={usuario} onCambio={() => window.location.reload()} />
```

- [ ] **Step 4: Verificación manual en el navegador**

Levantar frontend (`npm run dev` en la raíz) y backend (`cd backend && npm start`).

1. Login como **admin** (tiene `ver_todas`): aparece el **selector** arriba con "Todas / Ocosingo / Yajalón / San Cristóbal / Palenque". Elegir "Yajalón" → las Consultas de Ventas muestran solo ventas de Yajalón. Volver a "Todas" → se ven las 4.
2. Login como **cajero de Yajalón** (`yaj`/`yaj123`, creado en Task 9): NO aparece selector, sino la etiqueta **"Sucursal: Yajalón"**. Consultas de Ventas muestra solo Yajalón. El asistente de IA, al preguntar "¿cuánto vendimos?", responde solo con datos de Yajalón.

Expected: el aislamiento se observa en Dashboard, Consultas de Ventas, Corte de Caja y CRM.

- [ ] **Step 5: Commit**

```bash
git add src/api.js src/SelectorSucursal.jsx src/App.jsx
git commit -m "feat: selector de sucursal (global) y etiqueta fija (amarrado) en el frontend"
```

---

## Notas de cierre

- **Tokens viejos sin `sucursal_id`:** tras desplegar Task 3, las sesiones firmadas antes del cambio no traen `sucursal_id`; `alcanceSucursal` devuelve `sucursalId: null` para ellas, así que un usuario amarrado con token viejo no vería datos hasta re-loguearse. Como los datos son en memoria y el servidor se reinicia (invalidando sesiones), en la práctica esto se resuelve solo al volver a entrar. No requiere código extra.
- **Persistencia:** fuera de alcance (los datos siguen en memoria). Es la dependencia futura ya conocida.
- **Otras vistas del frontend** (Dashboard, CorteCaja, CRM, ConsultasVentas) heredan el filtro automáticamente porque todas pasan por `apiFetch`; no requieren cambios individuales salvo que alguna arme URLs sin `apiFetch` (verificar en el Step 4 de Task 11).
