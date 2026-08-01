# Módulo de Gastos (Fase 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Registrar, clasificar y respaldar cada salida de dinero que no sea mercancía, y descontarla del efectivo esperado del Corte de Caja cuando se paga con efectivo de la tienda.

**Architecture:** Módulo nuevo `gastos` con colección propia `DB.gastos` (gastos + categorías de dos niveles + bitácora). Funciones planas que reciben `DB`, con el guard de alcance por sucursal DENTRO del módulo (patrón de `garantias.js`), y `drive` inyectado como parámetro para poder probar sin la API real (patrón de `garantiasGastos.js`). El enganche crítico es `calcularCorteEnCurso`, que resta del efectivo esperado los gastos en efectivo del turno.

**Tech Stack:** Node.js + Express (backend), `node --test`, React 18 + Vite + Tailwind (frontend). **Sin dependencias nuevas.**

## Global Constraints

- **Sin dependencias nuevas** (ni backend ni frontend). Todo se resuelve con lo que ya existe.
- **Módulo nuevo ⇒ registro obligatorio de permisos.** Del spec y de la regla del proyecto: hay un guardia de arranque (`validarSistemaDePermisos`) que **bloquea el backend** si un módulo no está registrado. Hay que agregar `gastos` a `MODULOS_SISTEMA` (`backend/permisosCatalogo.js`) y a `MODULOS_QUE_REQUIEREN_PERMISOS` (`backend/validarPermisos.js`), y crear permisos propios con `modulo: "gastos"`. Las rutas usan esos permisos propios, nunca prestados de otro módulo.
- **Permisos exactos:** `ver_gastos`, `registrar_gastos`, `cancelar_gastos`, `administrar_categorias_gastos`. El reporte usa el permiso existente `ver_reportes`.
- **Guard de alcance DENTRO del módulo.** Cada función que lee o muta un gasto existente valida `dentroDeAlcance(gasto.sucursal_id, alcance)` antes de actuar, con mensaje `"Gasto no encontrado"` tanto si no existe como si está fuera de alcance (no revela que existe en otra tienda). Es la lección de Apartados, donde el guard vivía en las rutas, se olvidó en dos y se tuvo que parchar en auditoría.
- **Al crear, `sucursal_id` sale del token del usuario, NUNCA del cuerpo de la petición.**
- **Comprobante OBLIGATORIO.** No se puede crear un gasto sin archivo. Si la subida a Drive falla, **el gasto no se crea** — no puede quedar un gasto sin comprobante ni un registro a medias.
- **Nada se borra.** Los gastos se cancelan con motivo obligatorio y quedan en la lista y en la bitácora. Las categorías se desactivan, no se borran.
- **Reglas del descuento al Corte de Caja** (cada una con prueba propia): solo restan los gastos **activos**, solo los de forma de pago **EFECTIVO**, solo los de **esa sucursal**, y solo los del **turno en curso** (`fecha_hora > desde`). Un corte ya guardado queda **congelado**.
- **Modales del proyecto:** contenedor `max-h-[92vh] flex flex-col overflow-hidden`, cuerpo `flex-1 min-h-0 overflow-y-auto`, header y footer `shrink-0`. Los botones de formulario llevan `type="submit"` explícito (`@base-ui/react/button` usa `type="button"` por defecto).
- **Suite del backend en verde después de cada tarea.** Estado al empezar: **402 pruebas pasando, 0 fallando.**
- Frontend sin arnés de pruebas automáticas (convención del repo): se verifica con `npm run build` desde la raíz y a mano en navegador.
- **Google Drive está caído en producción** (token expirado el 2026-07-28) y se reconectará DESPUÉS de este módulo. Por eso todas las pruebas usan un `drive` simulado inyectado, y la verificación real de la subida queda pendiente. **No declarar "probado en producción".**
- Todos los comandos del backend se corren desde `backend/`. `npm run build` desde la raíz.
- Código, comentarios y textos de interfaz **en español**.

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `backend/gastosCategorias.js` (crear) | Catálogo de dos niveles: sembrar, listar, crear, renombrar, desactivar. Separado de `gastos.js` porque es un catálogo con su propio ciclo de vida. |
| `backend/gastos.js` (crear) | Los gastos: crear (con comprobante), cancelar, listar, bitácora, y `gastosEfectivoDelTurno` para el corte. |
| `backend/cortes.js` (modificar) | Restar del efectivo esperado los gastos en efectivo del turno. |
| `backend/drive.js` (modificar) | Carpeta raíz "Comprobantes de Gastos" y subcarpeta por sucursal. |
| `backend/permisosCatalogo.js` / `backend/validarPermisos.js` (modificar) | Registro del módulo y sus 4 permisos. |
| `backend/server.js` (modificar) | Seed de `DB.gastos` + rutas REST + ruta del reporte. |
| `backend/testHelpers.js` (modificar) | Seed de `DB.gastos` para las pruebas. |
| `backend/reportes.js` (modificar) | `reporteGastos` — agregación del reporte. |
| `src/Gastos.jsx` (crear) | Pantalla con dos pestañas (Gastos / Categorías), tabla, modal de captura y botón "?". |
| `src/Dashboard.jsx` (modificar) | Tile del módulo. |
| `src/CorteCaja.jsx` (modificar) | Renglón "Gastos del turno". |
| `src/reportes/ReporteGastos.jsx` (crear) + `src/Reportes.jsx` (modificar) | Noveno reporte. |

---

### Task 1: Permisos del módulo y catálogo de categorías

**Files:**
- Modify: `backend/permisosCatalogo.js` (arreglo `PERMISOS`; `MODULOS_SISTEMA` en la línea 102)
- Modify: `backend/validarPermisos.js` (`MODULOS_QUE_REQUIEREN_PERMISOS`, línea 25)
- Create: `backend/gastosCategorias.js`
- Modify: `backend/server.js` (seed de `DB`, después del bloque `drive:` que cierra en la línea 220)
- Modify: `backend/testHelpers.js` (mismo seed)
- Create: `backend/gastosCategorias.test.js`

**Interfaces:**
- Produces (exportadas de `backend/gastosCategorias.js`): `sembrarCategoriasGastos(DB)`, `listarCategorias(DB, opciones)`, `crearCategoria(DB, datos)`, `renombrarCategoria(DB, id, nombre)`, `desactivarCategoria(DB, id)`, `buscarHojaActiva(DB, id)`.
- Produces: `DB.gastos = { gastos: [], categorias: [...sembradas], gasto_movimientos: [] }`.

- [ ] **Step 1: Escribir las pruebas del catálogo**

Crear `backend/gastosCategorias.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const {
  listarCategorias, crearCategoria, renombrarCategoria, desactivarCategoria, buscarHojaActiva,
} = require("./gastosCategorias");
const { listarPermisos, listarModulosSistema } = require("./permisosCatalogo");
const { validarSistemaDePermisos } = require("./validarPermisos");

test("el módulo gastos y sus 4 permisos están en el catálogo", () => {
  const modulo = listarModulosSistema().find((m) => m.id === "gastos");
  assert.ok(modulo, "el módulo gastos debe existir en MODULOS_SISTEMA");

  const claves = ["ver_gastos", "registrar_gastos", "cancelar_gastos", "administrar_categorias_gastos"];
  for (const clave of claves) {
    const p = listarPermisos().find((x) => x.clave === clave);
    assert.ok(p, `debe existir el permiso ${clave}`);
    assert.strictEqual(p.modulo, "gastos", `${clave} debe pertenecer al módulo gastos`);
    assert.strictEqual(p.implementado, true);
  }
});

test("el guardia de arranque sigue pasando con el módulo nuevo", () => {
  assert.doesNotThrow(() => validarSistemaDePermisos());
});

test("el catálogo viene sembrado con grupos y subcategorías", () => {
  const DB = construirDBPrueba();
  const todas = listarCategorias(DB, {});
  const grupos = todas.filter((c) => c.categoria_padre_id === null);
  const hojas = todas.filter((c) => c.categoria_padre_id !== null);

  assert.strictEqual(grupos.length, 7, "7 grupos sembrados");
  assert.ok(hojas.length >= 25, "al menos 25 subcategorías sembradas");
  assert.ok(grupos.some((g) => g.nombre === "Servicios"));
  assert.ok(hojas.some((h) => h.nombre === "Combustible"));
  assert.ok(todas.every((c) => c.activa === true), "todo nace activo");
});

test("crearCategoria: agrega un grupo y una subcategoría", () => {
  const DB = construirDBPrueba();
  const grupo = crearCategoria(DB, { nombre: "Fletes", categoria_padre_id: null });
  assert.strictEqual(grupo.categoria_padre_id, null);
  assert.strictEqual(grupo.activa, true);

  const hoja = crearCategoria(DB, { nombre: "Paquetería", categoria_padre_id: grupo.id });
  assert.strictEqual(hoja.categoria_padre_id, grupo.id);
});

test("crearCategoria: rechaza nombre vacío y padre inexistente", () => {
  const DB = construirDBPrueba();
  assert.throws(() => crearCategoria(DB, { nombre: "   ", categoria_padre_id: null }), /nombre/i);
  assert.throws(() => crearCategoria(DB, { nombre: "X", categoria_padre_id: 9999 }), /no encontrad/i);
});

test("crearCategoria: no permite anidar una subcategoría dentro de otra subcategoría", () => {
  const DB = construirDBPrueba();
  const hoja = listarCategorias(DB, {}).find((c) => c.categoria_padre_id !== null);
  assert.throws(
    () => crearCategoria(DB, { nombre: "Nieta", categoria_padre_id: hoja.id }),
    /solo dos niveles/i
  );
});

test("renombrarCategoria cambia el nombre sin tocar nada más", () => {
  const DB = construirDBPrueba();
  const hoja = listarCategorias(DB, {}).find((c) => c.nombre === "Combustible");
  const r = renombrarCategoria(DB, hoja.id, "Gasolina");
  assert.strictEqual(r.nombre, "Gasolina");
  assert.strictEqual(r.categoria_padre_id, hoja.categoria_padre_id);
});

test("desactivarCategoria: la quita de las activas pero NO la borra", () => {
  const DB = construirDBPrueba();
  const antes = listarCategorias(DB, {}).length;
  const hoja = listarCategorias(DB, {}).find((c) => c.nombre === "Multas");

  desactivarCategoria(DB, hoja.id);

  assert.strictEqual(listarCategorias(DB, {}).length, antes, "sigue existiendo el registro");
  assert.ok(!listarCategorias(DB, { soloActivas: true }).some((c) => c.id === hoja.id));
});

test("desactivarCategoria: no deja desactivar un grupo con subcategorías activas", () => {
  const DB = construirDBPrueba();
  const grupo = listarCategorias(DB, {}).find((c) => c.nombre === "Servicios");
  assert.throws(() => desactivarCategoria(DB, grupo.id), /subcategorías activas/i);
});

test("buscarHojaActiva: acepta una hoja activa y rechaza grupo, inactiva e inexistente", () => {
  const DB = construirDBPrueba();
  const hoja = listarCategorias(DB, {}).find((c) => c.nombre === "Luz");
  const grupo = listarCategorias(DB, {}).find((c) => c.nombre === "Servicios");

  assert.strictEqual(buscarHojaActiva(DB, hoja.id).id, hoja.id);
  assert.throws(() => buscarHojaActiva(DB, grupo.id), /subcategoría/i);
  assert.throws(() => buscarHojaActiva(DB, 9999), /no encontrad/i);

  desactivarCategoria(DB, hoja.id);
  assert.throws(() => buscarHojaActiva(DB, hoja.id), /desactivada/i);
});
```

- [ ] **Step 2: Correr las pruebas para verificar que fallan**

```bash
cd backend && node --test gastosCategorias.test.js
```

Expected: FAIL — `Cannot find module './gastosCategorias'`.

- [ ] **Step 3: Registrar el módulo y sus permisos**

En `backend/permisosCatalogo.js`, agregar al final del arreglo `PERMISOS` (justo antes del `];` que lo cierra):

```js
  // ---- Gastos ----
  { clave: "ver_gastos", etiqueta: "Ver Gastos", modulo: "gastos", implementado: true },
  { clave: "registrar_gastos", etiqueta: "Registrar Gasto", modulo: "gastos", implementado: true },
  { clave: "cancelar_gastos", etiqueta: "Cancelar Gastos", modulo: "gastos", implementado: true },
  { clave: "administrar_categorias_gastos", etiqueta: "Administrar Categorías de Gastos", modulo: "gastos", implementado: true },
```

En el mismo archivo, agregar a `MODULOS_SISTEMA` (línea 102) el renglón final:

```js
  { id: "gastos",    nombre: "Gastos" },
```

En `backend/validarPermisos.js`, agregar `"gastos",` al final de `MODULOS_QUE_REQUIEREN_PERMISOS` (línea 25).

- [ ] **Step 4: Crear `backend/gastosCategorias.js`**

```js
/**
 * gastosCategorias.js — Catálogo de categorías de gastos, de DOS niveles:
 * un grupo (categoria_padre_id === null) contiene subcategorías. Un gasto
 * apunta SIEMPRE a una subcategoría (hoja); el grupo se deriva del padre.
 *
 * Mismo patrón de dos niveles que DB["catalogo-productos"].categorias.
 *
 * Las categorías NUNCA se borran: se desactivan. Si se borraran, los gastos
 * históricos que ya apuntan a ellas quedarían huérfanos y el reporte de meses
 * pasados cambiaría solo.
 */

/** Semilla: lo que de verdad se gasta en las tiendas. Corto a propósito —
 *  un menú con 70 opciones se captura mal y ensucia el reporte. Victor puede
 *  agregar las que le falten desde la pantalla. */
const SEMILLA = [
  ["Servicios", ["Luz", "Agua", "Internet", "Teléfono", "Software y licencias"]],
  ["Rentas", ["Renta de local", "Renta de bodega"]],
  ["Operación", ["Papelería", "Limpieza", "Combustible", "Mensajería y paquetería",
    "Mantenimiento y reparaciones", "Viáticos", "Alimentos", "Uniformes", "Herramientas"]],
  ["Nómina", ["Sueldos", "Comisiones", "Bonos"]],
  ["Marketing", ["Publicidad digital", "Impresos y lonas", "Perifoneo"]],
  ["Bancarios", ["Comisiones bancarias", "Intereses", "Terminal / TPV"]],
  ["Otros", ["Imprevistos", "Multas"]],
];

function siguienteId(lista) {
  return lista.length ? Math.max(...lista.map((x) => x.id)) + 1 : 1;
}

/** Siembra el catálogo si está vacío. Idempotente: si ya hay categorías
 *  (porque se restauraron de SQLite) no vuelve a sembrar ni duplica. */
function sembrarCategoriasGastos(DB) {
  if (DB.gastos.categorias.length > 0) return DB.gastos.categorias;
  SEMILLA.forEach(([grupo, hojas]) => {
    const idGrupo = siguienteId(DB.gastos.categorias);
    DB.gastos.categorias.push({ id: idGrupo, nombre: grupo, categoria_padre_id: null, activa: true });
    hojas.forEach((hoja) => {
      DB.gastos.categorias.push({
        id: siguienteId(DB.gastos.categorias),
        nombre: hoja,
        categoria_padre_id: idGrupo,
        activa: true,
      });
    });
  });
  return DB.gastos.categorias;
}

function listarCategorias(DB, { soloActivas } = {}) {
  const lista = DB.gastos.categorias;
  return soloActivas ? lista.filter((c) => c.activa) : [...lista];
}

function crearCategoria(DB, datos) {
  const nombre = (datos.nombre || "").trim();
  if (!nombre) throw new Error("Escribe el nombre de la categoría");

  const padreId = datos.categoria_padre_id == null || datos.categoria_padre_id === ""
    ? null
    : Number(datos.categoria_padre_id);

  if (padreId !== null) {
    const padre = DB.gastos.categorias.find((c) => c.id === padreId);
    if (!padre) throw new Error("Categoría padre no encontrada");
    if (padre.categoria_padre_id !== null) {
      throw new Error("El catálogo es solo dos niveles: una subcategoría no puede contener otra");
    }
  }

  const categoria = {
    id: siguienteId(DB.gastos.categorias),
    nombre,
    categoria_padre_id: padreId,
    activa: true,
  };
  DB.gastos.categorias.push(categoria);
  return categoria;
}

function renombrarCategoria(DB, id, nombre) {
  const categoria = DB.gastos.categorias.find((c) => c.id === Number(id));
  if (!categoria) throw new Error("Categoría no encontrada");
  const limpio = (nombre || "").trim();
  if (!limpio) throw new Error("Escribe el nombre de la categoría");
  categoria.nombre = limpio;
  return categoria;
}

function desactivarCategoria(DB, id) {
  const categoria = DB.gastos.categorias.find((c) => c.id === Number(id));
  if (!categoria) throw new Error("Categoría no encontrada");

  if (categoria.categoria_padre_id === null) {
    const hijasActivas = DB.gastos.categorias.filter(
      (c) => c.categoria_padre_id === categoria.id && c.activa
    );
    if (hijasActivas.length > 0) {
      throw new Error("Desactiva primero sus subcategorías activas");
    }
  }

  categoria.activa = false;
  return categoria;
}

/** Valida que el id sea una subcategoría (hoja) ACTIVA — lo único a lo que
 *  se puede apuntar un gasto nuevo. */
function buscarHojaActiva(DB, id) {
  const categoria = DB.gastos.categorias.find((c) => c.id === Number(id));
  if (!categoria) throw new Error("Categoría no encontrada");
  if (categoria.categoria_padre_id === null) {
    throw new Error("Elige una subcategoría, no un grupo");
  }
  if (!categoria.activa) throw new Error("Esa categoría está desactivada");
  return categoria;
}

module.exports = {
  sembrarCategoriasGastos, listarCategorias, crearCategoria,
  renombrarCategoria, desactivarCategoria, buscarHojaActiva,
};
```

- [ ] **Step 5: Agregar `DB.gastos` al seed de `server.js`**

En `backend/server.js`, dentro del objeto `DB`, después del bloque `drive: { cuenta: null, },` (que cierra en la línea 220) y antes del `};` que cierra `DB`:

```js
  gastos: {
    gastos: [],
    categorias: [],
    gasto_movimientos: [],
  },
```

Y después de la línea `sembrarRolesIniciales(DB);` y **después** del bloque de restauración desde SQLite (para que no duplique cuando ya hay categorías guardadas), agregar:

```js
const { sembrarCategoriasGastos } = require("./gastosCategorias");
sembrarCategoriasGastos(DB);
```

(El `require` va arriba con los demás; aquí se muestra junto a la llamada solo para dejar claro el orden. `sembrarCategoriasGastos` es idempotente: si SQLite ya trajo categorías, no hace nada.)

- [ ] **Step 6: Agregar `DB.gastos` al seed de `testHelpers.js`**

En `backend/testHelpers.js`, dentro del objeto `DB`, después del bloque `drive: { cuenta: null },`:

```js
    gastos: { gastos: [], categorias: [], gasto_movimientos: [] },
```

Y en la misma función, junto a `sembrarRolesIniciales(DB);` (antes del `return DB;`):

```js
  sembrarCategoriasGastos(DB);
```

con su `require` arriba del archivo:

```js
const { sembrarCategoriasGastos } = require("./gastosCategorias");
```

- [ ] **Step 7: Correr las pruebas del catálogo**

```bash
cd backend && node --test gastosCategorias.test.js
```

Expected: PASS — 10 pruebas en verde.

- [ ] **Step 8: Correr toda la suite y verificar que el servidor arranca**

```bash
cd backend && node --test
```

Expected: PASS. 402 previas + 10 nuevas = **412 en verde, 0 fallando**.

```bash
cd backend && node -e "require('./server'); console.log('SERVER OK'); process.exit(0)"
```

Expected: imprime `SERVER OK` y el log `✓ Sistema de permisos validado: 8 módulos, 73 permisos...` (un módulo y 4 permisos más que antes). Si truena con un error del guardia de permisos, revisar los Steps 3.

- [ ] **Step 9: Commit**

```bash
git add backend/permisosCatalogo.js backend/validarPermisos.js backend/gastosCategorias.js backend/gastosCategorias.test.js backend/server.js backend/testHelpers.js
git commit -m "feat: módulo de gastos — permisos y catálogo de categorías de dos niveles"
```

---

### Task 2: Carpetas de Drive para comprobantes de gastos

**Files:**
- Modify: `backend/drive.js` (constantes arriba; funciones junto a `asegurarCarpetaGarantia`, líneas 137-152; `module.exports`, línea 189)
- Modify: `backend/drive.test.js`

**Interfaces:**
- Consumes: helpers internos existentes `buscarCarpeta(DB, nombre, carpetaPadreId)` y `crearCarpeta(DB, nombre, carpetaPadreId)`.
- Produces (exportadas de `backend/drive.js`): `asegurarCarpetaGastosSucursal(DB, sucursal)` → id de carpeta (async), y la constante `CARPETA_GASTOS_NOMBRE = "Comprobantes de Gastos"`.

- [ ] **Step 1: Escribir las pruebas nuevas**

En `backend/drive.test.js`, ampliar el `require` de la parte superior para incluir `asegurarCarpetaGastosSucursal`, y agregar al final del archivo:

```js
test("asegurarCarpetaGastosSucursal crea la subcarpeta de la sucursal y la cachea", async (t) => {
  let llamada = 0;
  t.mock.method(globalThis, "fetch", async () => {
    llamada++;
    // 1: busca raíz (no existe) -> 2: crea raíz -> 3: busca subcarpeta -> 4: la crea
    if (llamada === 1 || llamada === 3) return { ok: true, json: async () => ({ files: [] }) };
    return { ok: true, json: async () => ({ id: `folder-${llamada}` }) };
  });
  const DB = { drive: { cuenta: { access_token: "AT1", refresh_token: "RT1", expires_at: Date.now() + 3_600_000 } } };
  const sucursal = { id: 1, nombre: "Ocosingo" };

  const id = await asegurarCarpetaGastosSucursal(DB, sucursal);

  assert.ok(id, "debe regresar un id de carpeta");
  assert.strictEqual(sucursal.drive_folder_gastos_id, id, "cachea el id en la sucursal");
  assert.ok(DB.drive.carpeta_gastos_id, "cachea también la carpeta raíz");
});

test("asegurarCarpetaGastosSucursal reusa el id cacheado sin llamar a Drive", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("no debería llamarse"); });
  const DB = { drive: { cuenta: { access_token: "AT1", refresh_token: "RT1", expires_at: Date.now() + 3_600_000 } } };
  const sucursal = { id: 1, nombre: "Ocosingo", drive_folder_gastos_id: "folder-cacheado" };

  const id = await asegurarCarpetaGastosSucursal(DB, sucursal);

  assert.strictEqual(id, "folder-cacheado");
});
```

- [ ] **Step 2: Correr las pruebas para verificar que fallan**

```bash
cd backend && node --test drive.test.js
```

Expected: FAIL — `asegurarCarpetaGastosSucursal is not a function`.

- [ ] **Step 3: Implementar en `backend/drive.js`**

Junto a las otras constantes de nombre de carpeta (arriba del archivo, donde está `CARPETA_GARANTIAS_NOMBRE`):

```js
const CARPETA_GASTOS_NOMBRE = "Comprobantes de Gastos";
```

Después de `asegurarCarpetaGarantia` (que termina en la línea 152):

```js
async function asegurarCarpetaGastosRaiz(DB) {
  if (DB.drive.carpeta_gastos_id) return DB.drive.carpeta_gastos_id;
  let id = await buscarCarpeta(DB, CARPETA_GASTOS_NOMBRE, null);
  if (!id) id = await crearCarpeta(DB, CARPETA_GASTOS_NOMBRE, null);
  DB.drive.carpeta_gastos_id = id;
  return id;
}

/** Subcarpeta por sucursal dentro de "Comprobantes de Gastos". Se agrupa por
 *  tienda (y no por mes o por gasto) porque es como Victor va a buscar un
 *  comprobante cuando lo necesite. */
async function asegurarCarpetaGastosSucursal(DB, sucursal) {
  if (sucursal.drive_folder_gastos_id) return sucursal.drive_folder_gastos_id;
  const raizId = await asegurarCarpetaGastosRaiz(DB);
  const nombre = sucursal.nombre || `Sucursal ${sucursal.id}`;
  let id = await buscarCarpeta(DB, nombre, raizId);
  if (!id) id = await crearCarpeta(DB, nombre, raizId);
  sucursal.drive_folder_gastos_id = id;
  return id;
}
```

Y agregar `CARPETA_GASTOS_NOMBRE, asegurarCarpetaGastosRaiz, asegurarCarpetaGastosSucursal` al `module.exports`.

- [ ] **Step 4: Correr las pruebas de drive**

```bash
cd backend && node --test drive.test.js
```

Expected: PASS, incluidas las 2 nuevas.

- [ ] **Step 5: Correr toda la suite**

```bash
cd backend && node --test
```

Expected: PASS, **414 en verde** (412 + 2).

- [ ] **Step 6: Commit**

```bash
git add backend/drive.js backend/drive.test.js
git commit -m "feat: carpetas de Drive para comprobantes de gastos (raíz + subcarpeta por sucursal)"
```

---

### Task 3: Registrar y cancelar gastos (`backend/gastos.js`)

**Files:**
- Create: `backend/gastos.js`
- Create: `backend/gastos.test.js`

**Interfaces:**
- Consumes: `buscarHojaActiva(DB, id)` de `backend/gastosCategorias.js` (Task 1); `asegurarCarpetaGastosSucursal(DB, sucursal)` y `subirArchivoADrive(DB, { nombre, mimeType, contenidoBuffer, carpetaId })` de `backend/drive.js` (Task 2); `dentroDeAlcance(sucursalId, alcance)` de `backend/auth.js`.
- Produces (exportadas de `backend/gastos.js`):
  - `crearGasto(DB, datos, sucursalId, usuario, drive)` → gasto (async)
  - `cancelarGasto(DB, id, motivo, usuario, alcance)` → gasto
  - `listarGastos(DB, filtros, alcance)` → arreglo enriquecido
  - `movimientosDeGasto(DB, id, alcance)` → arreglo de la bitácora
  - `gastosEfectivoDelTurno(DB, sucursal_id, desde)` → number (lo consume Task 4)
  - constantes `FORMAS_PAGO_GASTO`, `MIME_VALIDOS`, `TAMANO_MAXIMO_BYTES`

- [ ] **Step 1: Escribir las pruebas**

Crear `backend/gastos.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { listarCategorias, desactivarCategoria } = require("./gastosCategorias");
const { crearGasto, cancelarGasto, listarGastos, movimientosDeGasto } = require("./gastos");

const ALCANCE_TODAS = { verTodas: true, sucursalId: null };
const USUARIO = { nombre: "Victor" };

/** Drive simulado: registra lo que se le pidió, sin tocar la API real. */
function driveFalso() {
  const subidas = [];
  return {
    subidas,
    asegurarCarpetaGastosSucursal: async () => "carpeta-1",
    subirArchivoADrive: async (DB, args) => {
      subidas.push(args);
      return { id: `file-${subidas.length}`, webViewLink: `https://drive.google.com/file/d/file-${subidas.length}/view` };
    },
  };
}

function idHoja(DB, nombre) {
  return listarCategorias(DB, {}).find((c) => c.nombre === nombre).id;
}

const ARCHIVO_OK = {
  nombre_archivo: "ticket.jpg",
  tipo_mime: "image/jpeg",
  contenido_base64: Buffer.from("foto falsa").toString("base64"),
};

function datosBase(DB, extra = {}) {
  return {
    categoria_id: idHoja(DB, "Combustible"),
    concepto: "Gasolina de la camioneta",
    monto: 500,
    forma_pago: "EFECTIVO",
    archivo: ARCHIVO_OK,
    ...extra,
  };
}

test("crearGasto: guarda el gasto con folio, comprobante y bitácora", async () => {
  const DB = construirDBPrueba();
  const drive = driveFalso();

  const g = await crearGasto(DB, datosBase(DB), 1, USUARIO, drive);

  assert.strictEqual(g.folio, "GA-0001");
  assert.strictEqual(g.sucursal_id, 1);
  assert.strictEqual(g.monto, 500);
  assert.strictEqual(g.estatus, "activo");
  assert.strictEqual(g.usuario, "Victor");
  assert.strictEqual(g.drive_file_id, "file-1");
  assert.ok(g.drive_link.includes("file-1"));
  assert.strictEqual(g.nombre_archivo, "ticket.jpg");
  assert.strictEqual(drive.subidas.length, 1);

  const movs = DB.gastos.gasto_movimientos.filter((m) => m.gasto_id === g.id);
  assert.strictEqual(movs.length, 1);
  assert.strictEqual(movs[0].tipo, "creacion");
});

test("crearGasto: la sucursal sale del TOKEN, nunca del cuerpo de la petición", async () => {
  const DB = construirDBPrueba();
  // El body intenta colar la sucursal 3; el token dice 2. Gana el token.
  const g = await crearGasto(DB, datosBase(DB, { sucursal_id: 3 }), 2, USUARIO, driveFalso());
  assert.strictEqual(g.sucursal_id, 2);
});

test("crearGasto: SIN archivo lo rechaza (el comprobante es obligatorio)", async () => {
  const DB = construirDBPrueba();
  await assert.rejects(
    () => crearGasto(DB, datosBase(DB, { archivo: undefined }), 1, USUARIO, driveFalso()),
    /comprobante/i
  );
  assert.strictEqual(DB.gastos.gastos.length, 0, "no debe quedar ningún gasto");
});

test("crearGasto: si la subida a Drive falla, NO queda un gasto a medias", async () => {
  const DB = construirDBPrueba();
  const driveRoto = {
    asegurarCarpetaGastosSucursal: async () => "carpeta-1",
    subirArchivoADrive: async () => { throw new Error("Error al refrescar el token de Google Drive"); },
  };

  await assert.rejects(() => crearGasto(DB, datosBase(DB), 1, USUARIO, driveRoto), /Drive/i);

  assert.strictEqual(DB.gastos.gastos.length, 0, "no puede existir un gasto sin comprobante");
  assert.strictEqual(DB.gastos.gasto_movimientos.length, 0, "ni un renglón de bitácora huérfano");
});

test("crearGasto: valida categoría, concepto, monto y forma de pago", async () => {
  const DB = construirDBPrueba();
  const drive = driveFalso();
  const grupoId = listarCategorias(DB, {}).find((c) => c.categoria_padre_id === null).id;

  await assert.rejects(() => crearGasto(DB, datosBase(DB, { categoria_id: grupoId }), 1, USUARIO, drive), /subcategoría/i);
  await assert.rejects(() => crearGasto(DB, datosBase(DB, { categoria_id: 9999 }), 1, USUARIO, drive), /no encontrad/i);
  await assert.rejects(() => crearGasto(DB, datosBase(DB, { concepto: "   " }), 1, USUARIO, drive), /concepto/i);
  await assert.rejects(() => crearGasto(DB, datosBase(DB, { monto: 0 }), 1, USUARIO, drive), /mayor que cero/i);
  await assert.rejects(() => crearGasto(DB, datosBase(DB, { monto: "abc" }), 1, USUARIO, drive), /mayor que cero/i);
  await assert.rejects(() => crearGasto(DB, datosBase(DB, { forma_pago: "BITCOIN" }), 1, USUARIO, drive), /forma de pago/i);

  assert.strictEqual(DB.gastos.gastos.length, 0);
});

test("crearGasto: rechaza una categoría desactivada", async () => {
  const DB = construirDBPrueba();
  const id = idHoja(DB, "Multas");
  desactivarCategoria(DB, id);
  await assert.rejects(
    () => crearGasto(DB, datosBase(DB, { categoria_id: id }), 1, USUARIO, driveFalso()),
    /desactivada/i
  );
});

test("crearGasto: valida el tipo y el tamaño del comprobante", async () => {
  const DB = construirDBPrueba();
  const drive = driveFalso();

  await assert.rejects(
    () => crearGasto(DB, datosBase(DB, { archivo: { ...ARCHIVO_OK, tipo_mime: "application/zip" } }), 1, USUARIO, drive),
    /PDF, JPG o PNG/i
  );

  const enorme = Buffer.alloc(10 * 1024 * 1024 + 1).toString("base64");
  await assert.rejects(
    () => crearGasto(DB, datosBase(DB, { archivo: { ...ARCHIVO_OK, contenido_base64: enorme } }), 1, USUARIO, drive),
    /10 MB/i
  );
});

test("cancelarGasto: exige motivo, NO borra, y queda en la bitácora", async () => {
  const DB = construirDBPrueba();
  const g = await crearGasto(DB, datosBase(DB), 1, USUARIO, driveFalso());

  assert.throws(() => cancelarGasto(DB, g.id, "   ", USUARIO, ALCANCE_TODAS), /motivo/i);

  const r = cancelarGasto(DB, g.id, "Se capturó dos veces", USUARIO, ALCANCE_TODAS);

  assert.strictEqual(r.estatus, "cancelado");
  assert.strictEqual(r.motivo_cancelacion, "Se capturó dos veces");
  assert.strictEqual(DB.gastos.gastos.length, 1, "el registro sigue existiendo");
  assert.strictEqual(r.drive_file_id, "file-1", "el comprobante en Drive no se borra");

  const movs = DB.gastos.gasto_movimientos.filter((m) => m.gasto_id === g.id);
  assert.strictEqual(movs[movs.length - 1].tipo, "cancelacion");
});

test("cancelarGasto: no se puede cancelar dos veces", async () => {
  const DB = construirDBPrueba();
  const g = await crearGasto(DB, datosBase(DB), 1, USUARIO, driveFalso());
  cancelarGasto(DB, g.id, "Duplicado", USUARIO, ALCANCE_TODAS);
  assert.throws(() => cancelarGasto(DB, g.id, "Otra vez", USUARIO, ALCANCE_TODAS), /ya está cancelado/i);
});

test("cancelarGasto: un usuario de OTRA sucursal no puede cancelarlo ni por folio", async () => {
  const DB = construirDBPrueba();
  const g = await crearGasto(DB, datosBase(DB), 1, USUARIO, driveFalso());

  assert.throws(
    () => cancelarGasto(DB, g.id, "Intento", USUARIO, { verTodas: false, sucursalId: 2 }),
    /Gasto no encontrado/,
    "no revela que existe en otra tienda"
  );
  assert.strictEqual(DB.gastos.gastos[0].estatus, "activo", "sigue intacto");
});

test("listarGastos: respeta el alcance y enriquece con nombres", async () => {
  const DB = construirDBPrueba();
  await crearGasto(DB, datosBase(DB), 1, USUARIO, driveFalso());
  await crearGasto(DB, datosBase(DB, { concepto: "Luz del mes", categoria_id: idHoja(DB, "Luz") }), 2, USUARIO, driveFalso());

  const todas = listarGastos(DB, {}, ALCANCE_TODAS);
  assert.strictEqual(todas.length, 2);
  const gasolina = todas.find((g) => g.concepto === "Gasolina de la camioneta");
  assert.strictEqual(gasolina.categoria_nombre, "Combustible");
  assert.strictEqual(gasolina.grupo_nombre, "Operación");
  assert.strictEqual(gasolina.sucursal_nombre, "Ocosingo");

  const soloYajalon = listarGastos(DB, {}, { verTodas: false, sucursalId: 2 });
  assert.deepStrictEqual(soloYajalon.map((g) => g.concepto), ["Luz del mes"]);
});

test("movimientosDeGasto: respeta el alcance", async () => {
  const DB = construirDBPrueba();
  const g = await crearGasto(DB, datosBase(DB), 1, USUARIO, driveFalso());

  assert.strictEqual(movimientosDeGasto(DB, g.id, ALCANCE_TODAS).length, 1);
  assert.throws(() => movimientosDeGasto(DB, g.id, { verTodas: false, sucursalId: 2 }), /Gasto no encontrado/);
});
```

- [ ] **Step 2: Correr las pruebas para verificar que fallan**

```bash
cd backend && node --test gastos.test.js
```

Expected: FAIL — `Cannot find module './gastos'`.

- [ ] **Step 3: Crear `backend/gastos.js`**

```js
/**
 * gastos.js — Salidas de dinero que NO son mercancía (la mercancía vive en
 * Recepción de Compras). Cada gasto se clasifica en una subcategoría, se
 * respalda con un comprobante OBLIGATORIO en Drive, y si se pagó con efectivo
 * de la caja de la tienda se descuenta del Corte de Caja (ver cortes.js).
 *
 * Mismo patrón que garantias.js: funciones planas que reciben DB, con
 * bitácora (gasto_movimientos) y el guard de alcance por sucursal DENTRO del
 * módulo — no en la capa de rutas, que es donde se olvidó en Apartados.
 *
 * `drive` se recibe como parámetro (patrón de garantiasGastos.js) para poder
 * probar sin llamar a la API real de Google.
 */

const { dentroDeAlcance } = require("./auth");
const { buscarHojaActiva, listarCategorias } = require("./gastosCategorias");

const FORMAS_PAGO_GASTO = ["EFECTIVO", "TRANSFERENCIA", "TARJETA"];
const MIME_VALIDOS = ["application/pdf", "image/jpeg", "image/png"];
const TAMANO_MAXIMO_BYTES = 10 * 1024 * 1024;

function siguienteId(lista) {
  return lista.length ? Math.max(...lista.map((x) => x.id)) + 1 : 1;
}

function redondear(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function pushMovimiento(DB, gasto, tipo, descripcion, usuario) {
  DB.gastos.gasto_movimientos.push({
    id: siguienteId(DB.gastos.gasto_movimientos),
    gasto_id: gasto.id,
    fecha: new Date().toISOString(),
    usuario: usuario?.nombre || "—",
    tipo,
    descripcion: descripcion || "",
  });
}

/** Busca el gasto y aplica el guard de alcance. Lanza "Gasto no encontrado"
 *  tanto si no existe como si es de otra sucursal — no revela su existencia. */
function buscarConGuardia(DB, id, alcance) {
  const gasto = DB.gastos.gastos.find((g) => g.id === Number(id));
  if (!gasto) throw new Error("Gasto no encontrado");
  if (!dentroDeAlcance(gasto.sucursal_id, alcance)) throw new Error("Gasto no encontrado");
  return gasto;
}

/**
 * Crea un gasto. El comprobante es OBLIGATORIO: se sube a Drive ANTES de
 * tocar DB, para que una falla de Drive no deje un gasto sin respaldo ni un
 * renglón de bitácora huérfano.
 *
 * `sucursalId` viene del token del usuario — nunca del cuerpo de la petición.
 */
async function crearGasto(DB, datos, sucursalId, usuario, drive) {
  const categoria = buscarHojaActiva(DB, datos.categoria_id);

  const concepto = (datos.concepto || "").trim();
  if (!concepto) throw new Error("Escribe el concepto del gasto");

  const monto = Number(datos.monto);
  if (!Number.isFinite(monto) || monto <= 0) throw new Error("El monto debe ser un número mayor que cero");

  const forma_pago = (datos.forma_pago || "").toUpperCase();
  if (!FORMAS_PAGO_GASTO.includes(forma_pago)) throw new Error("Elige una forma de pago válida");

  const archivo = datos.archivo;
  if (!archivo || !archivo.contenido_base64) {
    throw new Error("El comprobante es obligatorio — adjunta la foto del ticket o la factura");
  }
  if (!MIME_VALIDOS.includes(archivo.tipo_mime)) {
    throw new Error("Tipo de archivo no permitido — solo PDF, JPG o PNG");
  }
  const buffer = Buffer.from(archivo.contenido_base64, "base64");
  if (buffer.length > TAMANO_MAXIMO_BYTES) throw new Error("El archivo no puede pesar más de 10 MB");

  const sucursal_id = Number(sucursalId) || 1;
  const sucursal = DB.pos.sucursales.find((s) => s.id === sucursal_id) || { id: sucursal_id };

  // Se sube ANTES de crear el registro: si Drive falla, no queda nada a medias.
  const carpetaId = await drive.asegurarCarpetaGastosSucursal(DB, sucursal);
  const nuevoId = siguienteId(DB.gastos.gastos);
  const folio = `GA-${String(nuevoId).padStart(4, "0")}`;
  const subido = await drive.subirArchivoADrive(DB, {
    nombre: `${folio} - ${concepto} - ${archivo.nombre_archivo}`,
    mimeType: archivo.tipo_mime,
    contenidoBuffer: buffer,
    carpetaId,
  });

  const ahora = new Date().toISOString();
  const gasto = {
    id: nuevoId,
    folio,
    fecha: ahora.slice(0, 10),
    fecha_hora: ahora,
    sucursal_id,
    categoria_id: categoria.id,
    concepto,
    descripcion: (datos.descripcion || "").trim(),
    monto: redondear(monto),
    forma_pago,
    proveedor_id: datos.proveedor_id != null && datos.proveedor_id !== "" ? Number(datos.proveedor_id) : null,
    numero_factura: (datos.numero_factura || "").trim(),
    nombre_archivo: archivo.nombre_archivo,
    drive_file_id: subido.id,
    drive_link: subido.webViewLink,
    usuario: usuario?.nombre || "—",
    estatus: "activo",
    motivo_cancelacion: null,
  };
  DB.gastos.gastos.push(gasto);

  pushMovimiento(DB, gasto, "creacion",
    `Registrado: ${categoria.nombre} — $${gasto.monto.toFixed(2)} (${forma_pago})`, usuario);
  return gasto;
}

/** Cancela SIN borrar: el registro y su comprobante en Drive se conservan. */
function cancelarGasto(DB, id, motivo, usuario, alcance) {
  const gasto = buscarConGuardia(DB, id, alcance);
  if (gasto.estatus === "cancelado") throw new Error("Ese gasto ya está cancelado");

  const limpio = (motivo || "").trim();
  if (!limpio) throw new Error("Escribe el motivo de la cancelación");

  gasto.estatus = "cancelado";
  gasto.motivo_cancelacion = limpio;
  pushMovimiento(DB, gasto, "cancelacion", `Cancelado: ${limpio}`, usuario);
  return gasto;
}

function enRango(fecha, desde, hasta) {
  if (desde && fecha < desde) return false;
  if (hasta && fecha > hasta) return false;
  return true;
}

function listarGastos(DB, filtros, alcance) {
  const { fecha_inicio, fecha_fin, categoria_id, forma_pago, estatus } = filtros || {};
  const categorias = listarCategorias(DB, {});
  const nombreCategoria = (id) => categorias.find((c) => c.id === id) || null;
  const nombreSucursal = (id) => (DB.pos.sucursales.find((s) => s.id === id) || {}).nombre || "—";
  const nombreProveedor = (id) =>
    id == null ? null : (DB["catalogo-productos"].proveedores.find((p) => p.id === id) || {}).nombre || null;

  let lista = DB.gastos.gastos.filter((g) => dentroDeAlcance(g.sucursal_id, alcance));
  lista = lista.filter((g) => enRango(g.fecha, fecha_inicio, fecha_fin));
  if (categoria_id) lista = lista.filter((g) => g.categoria_id === Number(categoria_id));
  if (forma_pago) lista = lista.filter((g) => g.forma_pago === String(forma_pago).toUpperCase());
  if (estatus) lista = lista.filter((g) => g.estatus === estatus);

  return lista
    .map((g) => {
      const categoria = nombreCategoria(g.categoria_id);
      const grupo = categoria ? nombreCategoria(categoria.categoria_padre_id) : null;
      return {
        ...g,
        categoria_nombre: categoria ? categoria.nombre : "—",
        grupo_nombre: grupo ? grupo.nombre : "—",
        sucursal_nombre: nombreSucursal(g.sucursal_id),
        proveedor_nombre: nombreProveedor(g.proveedor_id),
      };
    })
    .sort((a, b) => b.fecha_hora.localeCompare(a.fecha_hora));
}

function movimientosDeGasto(DB, id, alcance) {
  const gasto = buscarConGuardia(DB, id, alcance);
  return DB.gastos.gasto_movimientos
    .filter((m) => m.gasto_id === gasto.id)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
}

/**
 * Suma de los gastos que SALIERON DE LA CAJA en el turno en curso. Es lo que
 * el Corte de Caja resta del efectivo esperado.
 *
 * Las cuatro condiciones son deliberadas y cada una tiene prueba propia:
 *   - estatus activo  : un gasto cancelado no salió de la caja
 *   - EFECTIVO        : una transferencia o tarjeta no toca la caja de la tienda
 *   - misma sucursal  : el gasto de otra tienda no descuadra ésta
 *   - fecha_hora > desde : lo anterior al último corte pertenece a un turno YA cerrado
 */
function gastosEfectivoDelTurno(DB, sucursal_id, desde) {
  return redondear(
    DB.gastos.gastos
      .filter((g) => g.estatus === "activo")
      .filter((g) => g.forma_pago === "EFECTIVO")
      .filter((g) => g.sucursal_id === Number(sucursal_id))
      .filter((g) => !desde || g.fecha_hora > desde)
      .reduce((suma, g) => suma + Number(g.monto || 0), 0)
  );
}

module.exports = {
  crearGasto, cancelarGasto, listarGastos, movimientosDeGasto, gastosEfectivoDelTurno,
  buscarConGuardia, FORMAS_PAGO_GASTO, MIME_VALIDOS, TAMANO_MAXIMO_BYTES,
};
```

- [ ] **Step 4: Correr las pruebas de gastos**

```bash
cd backend && node --test gastos.test.js
```

Expected: PASS — 12 pruebas en verde.

- [ ] **Step 5: Correr toda la suite**

```bash
cd backend && node --test
```

Expected: PASS, **426 en verde** (414 + 12).

- [ ] **Step 6: Commit**

```bash
git add backend/gastos.js backend/gastos.test.js
git commit -m "feat: registrar y cancelar gastos con comprobante obligatorio y guard de alcance"
```

---

### Task 4: Descontar los gastos en efectivo del Corte de Caja

**Files:**
- Modify: `backend/cortes.js` (`calcularCorteEnCurso`, líneas 69-100; `crearCorte`, líneas 103-142)
- Create: `backend/gastosCorteCaja.test.js`

**Interfaces:**
- Consumes: `gastosEfectivoDelTurno(DB, sucursal_id, desde)` de `backend/gastos.js` (Task 3); `crearGasto` para armar los escenarios de prueba.
- Produces: `calcularCorteEnCurso` devuelve además `gastos_efectivo` (number) y `gastos_incluidos` (number). El corte guardado (`crearCorte`) incluye `gastos_efectivo`.

- [ ] **Step 1: Escribir las pruebas — las cinco reglas del descuento**

Crear `backend/gastosCorteCaja.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { listarCategorias } = require("./gastosCategorias");
const { crearGasto, cancelarGasto } = require("./gastos");
const { calcularCorteEnCurso, crearCorte } = require("./cortes");

const ALCANCE_TODAS = { verTodas: true, sucursalId: null };
const USUARIO = { nombre: "Victor" };

function driveFalso() {
  return {
    asegurarCarpetaGastosSucursal: async () => "carpeta-1",
    subirArchivoADrive: async () => ({ id: "file-1", webViewLink: "https://drive.google.com/x" }),
  };
}

function idHoja(DB, nombre) {
  return listarCategorias(DB, {}).find((c) => c.nombre === nombre).id;
}

async function gasto(DB, { sucursal = 1, monto = 500, forma_pago = "EFECTIVO" } = {}) {
  return crearGasto(DB, {
    categoria_id: idHoja(DB, "Combustible"),
    concepto: "Gasolina",
    monto,
    forma_pago,
    archivo: { nombre_archivo: "t.jpg", tipo_mime: "image/jpeg", contenido_base64: Buffer.from("x").toString("base64") },
  }, sucursal, USUARIO, driveFalso());
}

/** Venta de contado en la sucursal 1, para que haya efectivo esperado. */
function ventaEfectivo(DB, { sucursal = 1, total = 2000 } = {}) {
  const id = DB.pos.ventas.length + 100;
  DB.pos.ventas.push({
    id, fecha: new Date().toISOString().slice(0, 10), fecha_hora: new Date().toISOString(),
    sucursal_id: sucursal, vendedor_id: 1, cliente_id: 0, total,
    metodo_pago: "efectivo", estatus: "cerrada", motivo_cancelacion: null,
  });
}

test("un gasto en EFECTIVO baja el efectivo esperado del turno", async () => {
  const DB = construirDBPrueba();
  ventaEfectivo(DB, { total: 2000 });
  const antes = calcularCorteEnCurso(DB, 1);
  assert.strictEqual(antes.calculado.EFECTIVO, 2000);
  assert.strictEqual(antes.gastos_efectivo, 0);

  await gasto(DB, { monto: 500 });

  const despues = calcularCorteEnCurso(DB, 1);
  assert.strictEqual(despues.gastos_efectivo, 500);
  assert.strictEqual(despues.gastos_incluidos, 1);
  assert.strictEqual(despues.calculado.EFECTIVO, 1500, "2000 de venta menos 500 de gasto");
  assert.strictEqual(despues.total_calculado, 1500);
});

test("un gasto por TRANSFERENCIA o TARJETA no toca la caja de la tienda", async () => {
  const DB = construirDBPrueba();
  ventaEfectivo(DB, { total: 2000 });
  await gasto(DB, { monto: 700, forma_pago: "TRANSFERENCIA" });
  await gasto(DB, { monto: 300, forma_pago: "TARJETA" });

  const r = calcularCorteEnCurso(DB, 1);
  assert.strictEqual(r.gastos_efectivo, 0);
  assert.strictEqual(r.calculado.EFECTIVO, 2000);
});

test("un gasto CANCELADO deja de descontar", async () => {
  const DB = construirDBPrueba();
  ventaEfectivo(DB, { total: 2000 });
  const g = await gasto(DB, { monto: 500 });
  assert.strictEqual(calcularCorteEnCurso(DB, 1).calculado.EFECTIVO, 1500);

  cancelarGasto(DB, g.id, "Se capturó dos veces", USUARIO, ALCANCE_TODAS);

  assert.strictEqual(calcularCorteEnCurso(DB, 1).calculado.EFECTIVO, 2000, "vuelve a los 2000");
  assert.strictEqual(calcularCorteEnCurso(DB, 1).gastos_efectivo, 0);
});

test("el gasto de OTRA sucursal no descuadra esta caja", async () => {
  const DB = construirDBPrueba();
  ventaEfectivo(DB, { sucursal: 1, total: 2000 });
  await gasto(DB, { sucursal: 2, monto: 900 });

  const r = calcularCorteEnCurso(DB, 1);
  assert.strictEqual(r.gastos_efectivo, 0);
  assert.strictEqual(r.calculado.EFECTIVO, 2000);
});

test("un gasto ANTERIOR al último corte pertenece a un turno ya cerrado y no vuelve a restar", async () => {
  const DB = construirDBPrueba();
  ventaEfectivo(DB, { total: 2000 });
  await gasto(DB, { monto: 500 });

  // Se cierra el turno: el corte congela lo de arriba.
  crearCorte(DB, { sucursal_id: 1, usuario_id: 1, usuario_nombre: "Ana", contado: { EFECTIVO: 1500 }, retiro: {} });

  const r = calcularCorteEnCurso(DB, 1);
  assert.strictEqual(r.gastos_efectivo, 0, "el gasto del turno anterior ya no cuenta");
  assert.strictEqual(r.calculado.EFECTIVO, 0, "turno nuevo, sin ventas ni gastos");
});

test("el corte guardado conserva los gastos del turno y NO cambia si después se cancela uno", async () => {
  const DB = construirDBPrueba();
  ventaEfectivo(DB, { total: 2000 });
  const g = await gasto(DB, { monto: 500 });

  const corte = crearCorte(DB, {
    sucursal_id: 1, usuario_id: 1, usuario_nombre: "Ana",
    contado: { EFECTIVO: 1500 }, retiro: {},
  });

  assert.strictEqual(corte.gastos_efectivo, 500, "queda registrado por qué el calculado fue 1500");
  assert.strictEqual(corte.total_calculado, 1500);
  assert.strictEqual(corte.total_diferencia, 0, "la caja cuadra: el gasto ya no se ve como faltante");

  cancelarGasto(DB, g.id, "Error de captura", USUARIO, ALCANCE_TODAS);

  const guardado = DB.pos.cortes_caja.find((c) => c.id === corte.id);
  assert.strictEqual(guardado.total_calculado, 1500, "el corte cerrado queda congelado");
  assert.strictEqual(guardado.gastos_efectivo, 500);
});

test("sin gastos, el corte se comporta exactamente igual que antes", async () => {
  const DB = construirDBPrueba();
  ventaEfectivo(DB, { total: 2000 });
  const r = calcularCorteEnCurso(DB, 1);
  assert.strictEqual(r.gastos_efectivo, 0);
  assert.strictEqual(r.gastos_incluidos, 0);
  assert.strictEqual(r.calculado.EFECTIVO, 2000);
});
```

- [ ] **Step 2: Correr las pruebas para verificar que fallan**

```bash
cd backend && node --test gastosCorteCaja.test.js
```

Expected: FAIL — `gastos_efectivo` es `undefined` (todavía no se calcula).

- [ ] **Step 3: Enganchar los gastos en `calcularCorteEnCurso`**

En `backend/cortes.js`, agregar arriba, junto a los demás `require` (si el archivo no tiene ninguno, ponerlo como primera línea de código tras el comentario de cabecera):

```js
const { gastosEfectivoDelTurno } = require("./gastos");
```

Dentro de `calcularCorteEnCurso`, después de la línea `FORMAS_CORTE.forEach((f) => (calculado[f] = redondear(calculado[f])));` y antes del `return`:

```js
  // Los gastos pagados con efectivo de la caja SALIERON de la caja: si no se
  // restan aquí, al contar el dinero aparecen como faltante y se ven igual
  // que un robo. Solo restan los activos, en EFECTIVO, de esta sucursal y de
  // este turno (ver gastosEfectivoDelTurno).
  const gastosEfectivo = gastosEfectivoDelTurno(DB, sucursal_id, desde);
  const gastosIncluidos = DB.gastos.gastos.filter(
    (g) => g.estatus === "activo" && g.forma_pago === "EFECTIVO" &&
      g.sucursal_id === Number(sucursal_id) && (!desde || g.fecha_hora > desde)
  ).length;
  calculado.EFECTIVO = redondear(calculado.EFECTIVO - gastosEfectivo);
```

Y en el objeto que devuelve, agregar dos campos:

```js
    gastos_efectivo: gastosEfectivo,
    gastos_incluidos: gastosIncluidos,
```

(`total_calculado` ya se calcula sumando `calculado`, así que hereda el descuento solo.)

- [ ] **Step 4: Guardar los gastos dentro del corte**

En `crearCorte` (`backend/cortes.js`), dentro del objeto `corte` que se arma, agregar junto a `total_calculado`:

```js
    gastos_efectivo: enCurso.gastos_efectivo,
```

- [ ] **Step 5: Correr las pruebas del corte**

```bash
cd backend && node --test gastosCorteCaja.test.js
```

Expected: PASS — 7 pruebas en verde.

- [ ] **Step 6: Correr toda la suite (aquí es donde saldría una regresión del corte)**

```bash
cd backend && node --test
```

Expected: PASS, **433 en verde** (426 + 7). Las pruebas existentes de `cortes` y `apartadosCorteCaja` deben seguir pasando: sin gastos, `gastosEfectivoDelTurno` devuelve 0 y el comportamiento es idéntico al anterior. Si alguna falla, revisar que `DB.gastos` exista en `testHelpers.js` (Task 1).

- [ ] **Step 7: Commit**

```bash
git add backend/cortes.js backend/gastosCorteCaja.test.js
git commit -m "feat: el corte de caja descuenta los gastos en efectivo del turno

Antes, cada gasto pagado con efectivo de la caja aparecía como diferencia
negativa — indistinguible de un faltante o un robo."
```

---

### Task 5: Rutas REST de gastos y categorías

**Files:**
- Modify: `backend/server.js` (`require`s arriba; rutas junto a las de corte)

**Interfaces:**
- Consumes: todo lo de `backend/gastos.js` (Task 3) y `backend/gastosCategorias.js` (Task 1); los middlewares existentes `requiereLogin`, `requierePermiso(clave, resolverPermisosDeRol)` y el helper `alcanceSucursal(req, permisos)`; el módulo `drive` ya importado en `server.js`.
- Produces (para las tareas de frontend): los 7 endpoints de la tabla de abajo.

- [ ] **Step 1: Agregar los `require`**

En `backend/server.js`, junto a los demás `require` de módulos:

```js
const { crearGasto, cancelarGasto, listarGastos, movimientosDeGasto } = require("./gastos");
const { listarCategorias: listarCategoriasGasto, crearCategoria: crearCategoriaGasto,
        renombrarCategoria: renombrarCategoriaGasto, desactivarCategoria: desactivarCategoriaGasto,
      } = require("./gastosCategorias");
```

- [ ] **Step 2: Agregar las rutas**

En `backend/server.js`, después de las rutas de corte de caja y antes del bloque de rutas de reportes:

```js
// ─────────────────────────── Gastos ───────────────────────────

app.get("/api/gastos", requiereLogin, requierePermiso("ver_gastos", resolverPermisosDeRol), (req, res) => {
  const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
  const { fecha_inicio, fecha_fin, categoria_id, forma_pago, estatus } = req.query;
  res.json(listarGastos(DB, { fecha_inicio, fecha_fin, categoria_id, forma_pago, estatus }, alcance));
});

app.post("/api/gastos", requiereLogin, requierePermiso("registrar_gastos", resolverPermisosDeRol), async (req, res) => {
  try {
    // La sucursal sale del TOKEN, nunca del body: si viniera del cliente,
    // cualquiera podría cargarle un gasto a otra tienda.
    const gasto = await crearGasto(DB, req.body, req.usuarioToken.sucursal_id, req.usuarioToken, drive);
    res.json(gasto);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put("/api/gastos/:id/cancelar", requiereLogin, requierePermiso("cancelar_gastos", resolverPermisosDeRol), (req, res) => {
  try {
    const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
    res.json(cancelarGasto(DB, req.params.id, req.body.motivo, req.usuarioToken, alcance));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/gastos/categorias", requiereLogin, requierePermiso("ver_gastos", resolverPermisosDeRol), (req, res) => {
  res.json(listarCategoriasGasto(DB, { soloActivas: req.query.solo_activas === "1" }));
});

app.post("/api/gastos/categorias", requiereLogin, requierePermiso("administrar_categorias_gastos", resolverPermisosDeRol), (req, res) => {
  try { res.json(crearCategoriaGasto(DB, req.body)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.put("/api/gastos/categorias/:id", requiereLogin, requierePermiso("administrar_categorias_gastos", resolverPermisosDeRol), (req, res) => {
  try {
    if (req.body.activa === false) return res.json(desactivarCategoriaGasto(DB, req.params.id));
    res.json(renombrarCategoriaGasto(DB, req.params.id, req.body.nombre));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get("/api/gastos/:id/movimientos", requiereLogin, requierePermiso("ver_gastos", resolverPermisosDeRol), (req, res) => {
  try {
    const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
    res.json(movimientosDeGasto(DB, req.params.id, alcance));
  } catch (e) { res.status(404).json({ error: e.message }); }
});
```

**Importante sobre el orden:** `/api/gastos/categorias` debe quedar **ANTES** de `/api/gastos/:id/movimientos` en el archivo. Express resuelve por orden de registro, y si `:id` se registrara primero, una petición a `/api/gastos/categorias` entraría por la ruta de `:id` con `id="categorias"`.

Ninguna ruta lee `sucursal_id` del query por su cuenta: lo resuelve `alcanceSucursal`, que ya lo ignora para usuarios amarrados a una sucursal.

- [ ] **Step 3: Verificar que el servidor arranca y las rutas quedaron registradas**

```bash
cd backend && node -e "require('./server'); console.log('SERVER OK'); process.exit(0)"
```

Expected: `SERVER OK`.

```bash
cd backend && grep -n "api/gastos" server.js
```

Expected: 7 rutas, y `/api/gastos/categorias` aparece con un número de línea **menor** que `/api/gastos/:id/movimientos`.

- [ ] **Step 4: Correr toda la suite**

```bash
cd backend && node --test
```

Expected: PASS, 433 en verde (el repo no tiene pruebas a nivel HTTP, así que esta tarea no agrega pruebas).

- [ ] **Step 5: Commit**

```bash
git add backend/server.js
git commit -m "feat: rutas REST de gastos y de su catálogo de categorías"
```

---

### Task 6: Pantalla de Gastos — tabla, modal de captura y botón "?"

**Files:**
- Create: `src/Gastos.jsx`
- Modify: `src/Dashboard.jsx` (import de iconos línea 2; arreglo `MODULOS` líneas 8-19)
- Modify: `src/App.jsx` (import arriba; bloque de vistas junto a `{vista === "garantias" && ...}`, línea 84)

**Interfaces:**
- Consumes: los endpoints de Task 5; `apiFetch` de `src/api.js`.
- Produces: componente `Gastos` exportado por defecto con la firma **`Gastos({ onVolver, permisos, usuario })`** — exactamente la misma que usan `Garantias`, `Traspasos` y `AdminRoles`. El helper de permisos se define dentro del componente: `const puede = (clave) => !permisos || permisos.includes(clave);` (calcado de `src/Garantias.jsx:74`). **No existe ninguna prop `puede`** en este repo.

**Costura que hay que preservar (requisito del spec):** el comprobante vive en un solo estado, `archivo`, que se llena desde `elegirArchivo`. El módulo siguiente (subir la foto escaneando un QR desde el celular) va a llenar **ese mismo estado** desde otra fuente. No acoplar la lógica de guardado al `<input type="file">`: todo lo que decide si se puede guardar debe mirar `archivo`, nunca el input. Así el QR se enchufa después sin rediseñar el formulario.

- [ ] **Step 1: Crear `src/Gastos.jsx`**

```jsx
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Plus, X, HelpCircle, History, Ban, FileText, Upload, ChevronLeft } from "lucide-react";
import { apiFetch } from "./api";

const inputCls = "w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:border-blue-500";
const FORMAS_PAGO = ["EFECTIVO", "TRANSFERENCIA", "TARJETA"];
const MIME_OK = ["application/pdf", "image/jpeg", "image/png"];
const TAM_MAX = 10 * 1024 * 1024;

const hoyFmt = () => new Date().toISOString().slice(0, 10);
const hace30 = () => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10); };

function leerArchivoComoBase64(archivo) {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(String(lector.result).split(",")[1]);
    lector.onerror = reject;
    lector.readAsDataURL(archivo);
  });
}

/** Chuleta de categorías: muestra cada grupo con sus subcategorías, leyendo
 *  del catálogo en vivo (nunca de un texto escrito a mano), para que quien
 *  captura entienda dónde va cada gasto. Al hacer clic en una subcategoría
 *  queda elegida — además de explicar, acelera la captura. */
function AyudaCategorias({ arbol, onElegir, onCerrar }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onCerrar}>
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between shrink-0">
          <h3 className="font-semibold text-slate-700">¿En qué categoría va cada gasto?</h3>
          <button onClick={onCerrar} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-4 grid sm:grid-cols-2 gap-4">
          {arbol.map((grupo) => (
            <div key={grupo.id}>
              <p className="text-xs font-semibold text-slate-500 uppercase mb-1">{grupo.nombre}</p>
              <div className="flex flex-wrap gap-1.5">
                {grupo.hijas.map((h) => (
                  <button
                    key={h.id} type="button" onClick={() => onElegir(h.id)}
                    className="text-sm px-2 py-1 rounded border border-slate-200 hover:border-[#1a7fe8] hover:bg-blue-50 text-slate-700"
                  >
                    {h.nombre}
                  </button>
                ))}
                {grupo.hijas.length === 0 && <span className="text-xs text-slate-400">Sin subcategorías</span>}
              </div>
            </div>
          ))}
        </div>
        <div className="px-4 py-3 border-t border-slate-200 shrink-0 text-xs text-slate-500">
          Haz clic en una subcategoría para elegirla.
        </div>
      </div>
    </div>
  );
}

export default function Gastos({ onVolver, permisos, usuario }) {
  const puede = (clave) => !permisos || permisos.includes(clave);

  const [tab, setTab] = useState("gastos");
  const [categorias, setCategorias] = useState([]);
  const [gastos, setGastos] = useState([]);
  const [proveedores, setProveedores] = useState([]);
  const [fechaInicial, setFechaInicial] = useState(hace30());
  const [fechaFinal, setFechaFinal] = useState(hoyFmt());
  const [filtroEstatus, setFiltroEstatus] = useState("activo");
  const [modal, setModal] = useState(null);      // null | "nuevo" | "cancelar" | "historial"
  const [seleccionado, setSeleccionado] = useState(null);
  const [ayudaAbierta, setAyudaAbierta] = useState(false);
  const [aviso, setAviso] = useState(null);
  const [guardando, setGuardando] = useState(false);

  const [form, setForm] = useState({
    categoria_id: "", concepto: "", descripcion: "", monto: "",
    forma_pago: "EFECTIVO", proveedor_id: "", numero_factura: "",
  });
  const [archivo, setArchivo] = useState(null);
  const [motivo, setMotivo] = useState("");
  const [historial, setHistorial] = useState([]);

  const mostrarAviso = (t) => { setAviso(t); setTimeout(() => setAviso(null), 4000); };

  const cargarCategorias = useCallback(async () => {
    const r = await apiFetch("/gastos/categorias?solo_activas=1");
    if (r.ok) setCategorias(await r.json());
  }, []);

  const cargarGastos = useCallback(async () => {
    const params = new URLSearchParams();
    if (fechaInicial) params.set("fecha_inicio", fechaInicial);
    if (fechaFinal) params.set("fecha_fin", fechaFinal);
    if (filtroEstatus) params.set("estatus", filtroEstatus);
    const r = await apiFetch(`/gastos?${params.toString()}`);
    if (r.ok) setGastos(await r.json());
  }, [fechaInicial, fechaFinal, filtroEstatus]);

  useEffect(() => { cargarCategorias(); }, [cargarCategorias]);
  useEffect(() => { cargarGastos(); }, [cargarGastos]);
  useEffect(() => {
    apiFetch("/proveedores").then((r) => r.ok && r.json()).then((d) => d && setProveedores(d));
  }, []);

  /** Grupos con sus subcategorías — lo consume el select y la chuleta "?". */
  const arbol = useMemo(() => {
    const grupos = categorias.filter((c) => c.categoria_padre_id === null);
    return grupos.map((g) => ({ ...g, hijas: categorias.filter((c) => c.categoria_padre_id === g.id) }));
  }, [categorias]);

  const totalPeriodo = useMemo(
    () => gastos.filter((g) => g.estatus === "activo").reduce((a, g) => a + g.monto, 0),
    [gastos]
  );

  const abrirNuevo = () => {
    setForm({ categoria_id: "", concepto: "", descripcion: "", monto: "", forma_pago: "EFECTIVO", proveedor_id: "", numero_factura: "" });
    setArchivo(null);
    setModal("nuevo");
  };

  const elegirArchivo = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!MIME_OK.includes(f.type)) return mostrarAviso("❌ Solo se acepta PDF, JPG o PNG");
    if (f.size > TAM_MAX) return mostrarAviso("❌ El archivo no puede pesar más de 10 MB");
    setArchivo(f);
  };

  const guardar = async (e) => {
    e.preventDefault();
    if (!archivo) return mostrarAviso("❌ El comprobante es obligatorio");
    setGuardando(true);
    try {
      const contenido_base64 = await leerArchivoComoBase64(archivo);
      const r = await apiFetch("/gastos", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          archivo: { nombre_archivo: archivo.name, tipo_mime: archivo.type, contenido_base64 },
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      mostrarAviso(`✅ Gasto ${data.folio} registrado`);
      setModal(null);
      cargarGastos();
    } catch (err) {
      mostrarAviso("❌ " + err.message);
    } finally {
      setGuardando(false);
    }
  };

  const cancelar = async (e) => {
    e.preventDefault();
    try {
      const r = await apiFetch(`/gastos/${seleccionado.id}/cancelar`, {
        method: "PUT", body: JSON.stringify({ motivo }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      mostrarAviso(`✅ Gasto ${seleccionado.folio} cancelado`);
      setModal(null); setMotivo("");
      cargarGastos();
    } catch (err) { mostrarAviso("❌ " + err.message); }
  };

  const abrirHistorial = async (g) => {
    setSeleccionado(g);
    const r = await apiFetch(`/gastos/${g.id}/movimientos`);
    setHistorial(r.ok ? await r.json() : []);
    setModal("historial");
  };

  return (
    <div className="w-full h-full flex flex-col bg-slate-50 text-slate-800 text-sm">
      <div className="bg-white border-b border-slate-100 px-4 py-2 flex items-center gap-2 shrink-0">
        <button onClick={onVolver} className="flex items-center gap-1 text-sm text-[#1a7fe8] hover:underline">
          <ChevronLeft size={16} /> Dashboard
        </button>
        <h2 className="font-semibold text-slate-700 ml-2">Gastos</h2>
      </div>

      {aviso && <div className="bg-slate-800 text-white text-xs px-4 py-2 shrink-0">{aviso}</div>}

      <div className="bg-white border-b border-slate-200 flex shrink-0">
        <button onClick={() => setTab("gastos")}
          className={`px-4 py-2 border-b-2 ${tab === "gastos" ? "border-[#1a7fe8] text-[#1a7fe8] font-medium" : "border-transparent text-slate-500"}`}>
          Gastos
        </button>
        {puede("administrar_categorias_gastos") && (
          <button onClick={() => setTab("categorias")}
            className={`px-4 py-2 border-b-2 ${tab === "categorias" ? "border-[#1a7fe8] text-[#1a7fe8] font-medium" : "border-transparent text-slate-500"}`}>
            Categorías
          </button>
        )}
      </div>

      {tab === "gastos" ? (
        <>
          <div className="bg-white border-b border-slate-200 px-4 py-3 flex flex-wrap gap-3 items-end shrink-0">
            <div>
              <label className="text-xs text-slate-500 block mb-1">Del</label>
              <input type="date" value={fechaInicial} onChange={(e) => setFechaInicial(e.target.value)} className="border border-slate-300 rounded px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Al</label>
              <input type="date" value={fechaFinal} onChange={(e) => setFechaFinal(e.target.value)} className="border border-slate-300 rounded px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Estatus</label>
              <select value={filtroEstatus} onChange={(e) => setFiltroEstatus(e.target.value)} className="border border-slate-300 rounded px-2 py-1.5 text-sm">
                <option value="activo">Activos</option>
                <option value="cancelado">Cancelados</option>
                <option value="">Todos</option>
              </select>
            </div>
            {puede("registrar_gastos") && (
              <button onClick={abrirNuevo} className="ml-auto flex items-center gap-1.5 bg-[#1a7fe8] text-white rounded px-3 py-1.5 text-sm hover:bg-blue-700">
                <Plus size={16} /> Registrar gasto
              </button>
            )}
          </div>

          <div className="flex-1 overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#1a7fe8] text-white sticky top-0">
                <tr>
                  <th className="py-2 px-3 text-left font-medium">Folio</th>
                  <th className="py-2 px-3 text-left font-medium">Fecha</th>
                  <th className="py-2 px-3 text-left font-medium">Sucursal</th>
                  <th className="py-2 px-3 text-left font-medium">Grupo</th>
                  <th className="py-2 px-3 text-left font-medium">Categoría</th>
                  <th className="py-2 px-3 text-left font-medium">Concepto</th>
                  <th className="py-2 px-3 text-left font-medium">Forma de pago</th>
                  <th className="py-2 px-3 text-center font-medium">Comprobante</th>
                  <th className="py-2 px-3 text-right font-medium">Monto</th>
                  <th className="py-2 px-3 text-center font-medium">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {gastos.length === 0 && <tr><td colSpan={10} className="text-center text-slate-400 py-16">Sin gastos en el periodo</td></tr>}
                {gastos.map((g) => (
                  <tr key={g.id} className="border-b border-slate-100">
                    <td className="py-2 px-3 font-medium">
                      {g.folio}
                      {g.estatus === "cancelado" && (
                        <span className="ml-1.5 text-[10px] bg-slate-200 text-slate-600 rounded px-1.5 py-0.5">Cancelado</span>
                      )}
                    </td>
                    <td className="py-2 px-3">{g.fecha}</td>
                    <td className="py-2 px-3">{g.sucursal_nombre}</td>
                    <td className="py-2 px-3 text-slate-500">{g.grupo_nombre}</td>
                    <td className="py-2 px-3">{g.categoria_nombre}</td>
                    <td className="py-2 px-3">{g.concepto}</td>
                    <td className="py-2 px-3">{g.forma_pago}</td>
                    <td className="py-2 px-3 text-center">
                      <a href={g.drive_link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[#1a7fe8] hover:underline" title={g.nombre_archivo}>
                        <FileText size={14} /> Ver
                      </a>
                    </td>
                    <td className={`py-2 px-3 text-right font-medium ${g.estatus === "cancelado" ? "text-slate-400 line-through" : ""}`}>
                      ${g.monto.toFixed(2)}
                    </td>
                    <td className="py-2 px-3 text-center whitespace-nowrap">
                      <button onClick={() => abrirHistorial(g)} className="text-slate-500 hover:text-[#1a7fe8] px-1" title="Historial"><History size={15} /></button>
                      {g.estatus === "activo" && puede("cancelar_gastos") && (
                        <button onClick={() => { setSeleccionado(g); setMotivo(""); setModal("cancelar"); }}
                          className="text-slate-500 hover:text-red-600 px-1" title="Cancelar"><Ban size={15} /></button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bg-slate-800 text-white px-4 py-2 flex items-center justify-between text-xs shrink-0">
            <span>{gastos.length} gasto(s) en el periodo</span>
            <span>Total activo: <b>${totalPeriodo.toFixed(2)}</b></span>
          </div>
        </>
      ) : (
        <CategoriasGastos arbol={arbol} onCambio={cargarCategorias} mostrarAviso={mostrarAviso} />
      )}

      {modal === "nuevo" && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-40 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[92vh] flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between shrink-0">
              <h3 className="font-semibold text-slate-700">Registrar gasto</h3>
              <button onClick={() => setModal(null)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>

            <form id="form-gasto" onSubmit={guardar} className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
              <div>
                <label className="text-xs text-slate-500 flex items-center gap-1.5 mb-1">
                  Categoría *
                  <button type="button" onClick={() => setAyudaAbierta(true)}
                    className="text-[#1a7fe8] hover:text-blue-700" title="¿En qué categoría va cada gasto?">
                    <HelpCircle size={14} />
                  </button>
                </label>
                <select required value={form.categoria_id} onChange={(e) => setForm({ ...form, categoria_id: e.target.value })} className={inputCls}>
                  <option value="">Elige una categoría</option>
                  {arbol.map((g) => (
                    <optgroup key={g.id} label={g.nombre}>
                      {g.hijas.map((h) => <option key={h.id} value={h.id}>{h.nombre}</option>)}
                    </optgroup>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs text-slate-500 block mb-1">Concepto *</label>
                <input required value={form.concepto} onChange={(e) => setForm({ ...form, concepto: e.target.value })} className={inputCls} placeholder="Garrafón de agua" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Monto *</label>
                  <input required type="number" step="0.01" min="0.01" value={form.monto} onChange={(e) => setForm({ ...form, monto: e.target.value })} className={inputCls} />
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Forma de pago *</label>
                  <select value={form.forma_pago} onChange={(e) => setForm({ ...form, forma_pago: e.target.value })} className={inputCls}>
                    {FORMAS_PAGO.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
              </div>

              {form.forma_pago === "EFECTIVO" && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                  Este gasto se descontará del efectivo esperado en el corte de caja de tu turno.
                </p>
              )}

              <div>
                <label className="text-xs text-slate-500 block mb-1">Descripción</label>
                <textarea rows={2} value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} className={inputCls} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Proveedor</label>
                  <select value={form.proveedor_id} onChange={(e) => setForm({ ...form, proveedor_id: e.target.value })} className={inputCls}>
                    <option value="">Sin proveedor</option>
                    {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">No. de factura</label>
                  <input value={form.numero_factura} onChange={(e) => setForm({ ...form, numero_factura: e.target.value })} className={inputCls} />
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-500 block mb-1">Comprobante * (PDF, JPG o PNG, máx. 10 MB)</label>
                <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={elegirArchivo} className="text-sm" />
                {archivo && (
                  <p className="text-xs text-emerald-700 mt-1 flex items-center gap-1"><Upload size={12} /> {archivo.name}</p>
                )}
              </div>
            </form>

            <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-end gap-2 shrink-0">
              {!archivo && <span className="text-xs text-slate-500 mr-auto">Adjunta el comprobante para poder guardar</span>}
              <button type="button" onClick={() => setModal(null)} className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded">Cancelar</button>
              <button type="submit" form="form-gasto" disabled={!archivo || guardando}
                className="px-4 py-1.5 text-sm bg-[#1a7fe8] text-white rounded hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed">
                {guardando ? "Guardando..." : "Guardar gasto"}
              </button>
            </div>
          </div>
        </div>
      )}

      {modal === "cancelar" && seleccionado && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-40 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[92vh] flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 shrink-0">
              <h3 className="font-semibold text-slate-700">Cancelar gasto {seleccionado.folio}</h3>
            </div>
            <form id="form-cancelar-gasto" onSubmit={cancelar} className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2">
              <p className="text-xs text-slate-500">
                El gasto no se borra: queda marcado como cancelado, deja de contar en los totales y en el corte del turno en curso, y su comprobante se conserva.
              </p>
              <label className="text-xs text-slate-500 block">Motivo *</label>
              <textarea required rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} className={inputCls} />
            </form>
            <div className="px-4 py-3 border-t border-slate-200 flex justify-end gap-2 shrink-0">
              <button type="button" onClick={() => setModal(null)} className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded">Volver</button>
              <button type="submit" form="form-cancelar-gasto" className="px-4 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700">Cancelar gasto</button>
            </div>
          </div>
        </div>
      )}

      {modal === "historial" && seleccionado && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-40 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[92vh] flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between shrink-0">
              <h3 className="font-semibold text-slate-700">Historial de {seleccionado.folio}</h3>
              <button onClick={() => setModal(null)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2">
              {historial.map((m) => (
                <div key={m.id} className="border-b border-slate-100 pb-2">
                  <p className="text-sm">{m.descripcion}</p>
                  <p className="text-xs text-slate-400">{m.fecha.slice(0, 16).replace("T", " ")} — {m.usuario}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {ayudaAbierta && (
        <AyudaCategorias
          arbol={arbol}
          onElegir={(id) => { setForm((f) => ({ ...f, categoria_id: String(id) })); setAyudaAbierta(false); }}
          onCerrar={() => setAyudaAbierta(false)}
        />
      )}
    </div>
  );
}

/** Pestaña de administración del catálogo. Se define aquí, junto a su único
 *  consumidor, en vez de en un archivo aparte. */
function CategoriasGastos({ arbol, onCambio, mostrarAviso }) {
  const [nuevoGrupo, setNuevoGrupo] = useState("");
  const [nuevaHija, setNuevaHija] = useState({});

  const crear = async (nombre, padreId) => {
    const r = await apiFetch("/gastos/categorias", {
      method: "POST",
      body: JSON.stringify({ nombre, categoria_padre_id: padreId }),
    });
    const data = await r.json();
    if (!r.ok) return mostrarAviso("❌ " + data.error);
    mostrarAviso("✅ Categoría agregada");
    onCambio();
  };

  const desactivar = async (id, nombre) => {
    if (!window.confirm(`¿Desactivar "${nombre}"? Los gastos que ya la usan la conservan.`)) return;
    const r = await apiFetch(`/gastos/categorias/${id}`, { method: "PUT", body: JSON.stringify({ activa: false }) });
    const data = await r.json();
    if (!r.ok) return mostrarAviso("❌ " + data.error);
    mostrarAviso("✅ Categoría desactivada");
    onCambio();
  };

  const renombrar = async (id, actual) => {
    const nombre = window.prompt("Nuevo nombre:", actual);
    if (!nombre || nombre === actual) return;
    const r = await apiFetch(`/gastos/categorias/${id}`, { method: "PUT", body: JSON.stringify({ nombre }) });
    const data = await r.json();
    if (!r.ok) return mostrarAviso("❌ " + data.error);
    onCambio();
  };

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="flex gap-2 mb-4 max-w-md">
        <input value={nuevoGrupo} onChange={(e) => setNuevoGrupo(e.target.value)} placeholder="Nuevo grupo" className={inputCls} />
        <button onClick={() => { if (nuevoGrupo.trim()) { crear(nuevoGrupo.trim(), null); setNuevoGrupo(""); } }}
          className="bg-[#1a7fe8] text-white rounded px-3 py-1.5 text-sm whitespace-nowrap">Agregar grupo</button>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        {arbol.map((g) => (
          <div key={g.id} className="bg-white border border-slate-200 rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="font-medium text-slate-700">{g.nombre}</p>
              <div className="flex gap-2 text-xs">
                <button onClick={() => renombrar(g.id, g.nombre)} className="text-[#1a7fe8] hover:underline">Renombrar</button>
                <button onClick={() => desactivar(g.id, g.nombre)} className="text-red-600 hover:underline">Desactivar</button>
              </div>
            </div>
            <ul className="space-y-1 mb-2">
              {g.hijas.map((h) => (
                <li key={h.id} className="flex items-center justify-between text-sm">
                  <span>{h.nombre}</span>
                  <div className="flex gap-2 text-xs">
                    <button onClick={() => renombrar(h.id, h.nombre)} className="text-[#1a7fe8] hover:underline">Renombrar</button>
                    <button onClick={() => desactivar(h.id, h.nombre)} className="text-red-600 hover:underline">Desactivar</button>
                  </div>
                </li>
              ))}
            </ul>
            <div className="flex gap-1.5">
              <input
                value={nuevaHija[g.id] || ""}
                onChange={(e) => setNuevaHija({ ...nuevaHija, [g.id]: e.target.value })}
                placeholder="Nueva subcategoría" className={inputCls}
              />
              <button
                onClick={() => {
                  const nombre = (nuevaHija[g.id] || "").trim();
                  if (nombre) { crear(nombre, g.id); setNuevaHija({ ...nuevaHija, [g.id]: "" }); }
                }}
                className="bg-slate-100 text-slate-700 rounded px-2 text-sm whitespace-nowrap"
              >
                Agregar
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Agregar el tile en el Dashboard**

En `src/Dashboard.jsx`, agregar `Wallet` al import de `lucide-react` (línea 2), y agregar al arreglo `MODULOS` justo **después** del renglón de `corte`:

```jsx
  { id: "gastos",     nombre: "Gastos",                 icono: Wallet,       disponible: true, modulo: "gastos",    permiso: "ver_gastos" },
```

- [ ] **Step 3: Montar la pantalla en `App.jsx`**

El Dashboard solo dibuja los tiles; quien decide qué pantalla se renderiza es `src/App.jsx`. Agregar el import junto a los demás:

```jsx
import Gastos from "./Gastos.jsx";
```

Y el bloque de vista, justo después del de `garantias` (línea 84):

```jsx
        {vista === "gastos" && (
          <Gastos onVolver={() => setVista("dashboard")} permisos={usuario.permisos} usuario={usuario} />
        )}
```

- [ ] **Step 4: Verificar que compila**

```bash
npm run build
```

Expected: build exitoso, sin errores nuevos (el único warning aceptable es el de chunk > 500 kB, preexistente).

- [ ] **Step 5: Correr la suite del backend como red de seguridad**

```bash
cd backend && node --test
```

Expected: PASS, 433 en verde (esta tarea no toca backend).

- [ ] **Step 6: Commit**

```bash
git add src/Gastos.jsx src/Dashboard.jsx src/App.jsx
git commit -m "feat: pantalla de Gastos con captura, catálogo editable y ayuda de categorías"
```

---

### Task 7: Renglón "Gastos del turno" en el Corte de Caja

**Files:**
- Modify: `src/CorteCaja.jsx`

**Interfaces:**
- Consumes: los campos `gastos_efectivo` y `gastos_incluidos` que ahora devuelve `GET` del corte en curso (Task 4).

- [ ] **Step 1: Mostrar el renglón**

La variable de estado del corte en curso se llama **`enCurso`** (`src/CorteCaja.jsx:119`), y el bloque que muestra el calculado está alrededor de la línea 241 (`{$fmt(enCurso.total_calculado)}`). Agregar **debajo** de ese bloque del total calculado un renglón que solo aparece cuando hubo gastos:

```jsx
{enCurso?.gastos_efectivo > 0 && (
  <div className="flex items-center justify-between text-sm px-3 py-2 bg-amber-50 border border-amber-200 rounded mt-2">
    <span className="text-amber-800">
      Gastos del turno ({enCurso.gastos_incluidos})
      <span className="block text-xs text-amber-700">Ya descontados del efectivo esperado</span>
    </span>
    <span className="font-medium text-amber-800">− {$fmt(enCurso.gastos_efectivo)}</span>
  </div>
)}
```

Se usa el helper `$fmt` que el archivo ya tiene para dar formato a los montos, no `toFixed` a mano.

- [ ] **Step 2: Verificar que compila**

```bash
npm run build
```

Expected: build exitoso.

- [ ] **Step 3: Commit**

```bash
git add src/CorteCaja.jsx
git commit -m "feat: el corte de caja muestra los gastos del turno ya descontados"
```

---

### Task 8: Reporte de Gastos

**Files:**
- Modify: `backend/reportes.js` (agregar función y exportarla)
- Modify: `backend/server.js` (ruta del reporte)
- Create: `backend/reporteGastos.test.js`
- Create: `src/reportes/ReporteGastos.jsx`
- Modify: `src/Reportes.jsx`

**Interfaces:**
- Consumes: `listarGastos(DB, filtros, alcance)` de `backend/gastos.js` (Task 3); los helpers internos `redondear` y `enRango` de `backend/reportes.js`.
- Produces: `reporteGastos(DB, filtros, alcance)` con `filtros = { fecha_inicio, fecha_fin, categoria_id, forma_pago, proveedor_id, estatus }`, devolviendo:

```js
{
  general: [...],       // renglón por gasto, ya enriquecido por listarGastos
  porCategoria:  [{ categoria, grupo, numero_gastos, total }],
  porSucursal:   [{ sucursal, numero_gastos, total }],
  porFormaPago:  [{ forma_pago, numero_gastos, total }],
  totales: { numero_gastos, total, numero_cancelados, total_cancelado },
}
```

- [ ] **Step 1: Escribir las pruebas**

Crear `backend/reporteGastos.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { listarCategorias } = require("./gastosCategorias");
const { crearGasto, cancelarGasto } = require("./gastos");
const { reporteGastos } = require("./reportes");

const ALCANCE_TODAS = { verTodas: true, sucursalId: null };
const USUARIO = { nombre: "Victor" };

function driveFalso() {
  return {
    asegurarCarpetaGastosSucursal: async () => "carpeta-1",
    subirArchivoADrive: async () => ({ id: "file-1", webViewLink: "https://drive.google.com/x" }),
  };
}

function idHoja(DB, nombre) {
  return listarCategorias(DB, {}).find((c) => c.nombre === nombre).id;
}

async function gasto(DB, { sucursal = 1, categoria = "Combustible", monto = 100, forma_pago = "EFECTIVO" } = {}) {
  return crearGasto(DB, {
    categoria_id: idHoja(DB, categoria), concepto: categoria, monto, forma_pago,
    archivo: { nombre_archivo: "t.jpg", tipo_mime: "image/jpeg", contenido_base64: Buffer.from("x").toString("base64") },
  }, sucursal, USUARIO, driveFalso());
}

async function escenario() {
  const DB = construirDBPrueba();
  await gasto(DB, { sucursal: 1, categoria: "Combustible", monto: 300 });
  await gasto(DB, { sucursal: 1, categoria: "Luz", monto: 1200, forma_pago: "TRANSFERENCIA" });
  await gasto(DB, { sucursal: 2, categoria: "Combustible", monto: 200 });
  return DB;
}

test("reporteGastos: totales y agrupaciones", async () => {
  const DB = await escenario();
  const r = reporteGastos(DB, {}, ALCANCE_TODAS);

  assert.strictEqual(r.totales.numero_gastos, 3);
  assert.strictEqual(r.totales.total, 1700);

  const combustible = r.porCategoria.find((f) => f.categoria === "Combustible");
  assert.strictEqual(combustible.total, 500);
  assert.strictEqual(combustible.numero_gastos, 2);
  assert.strictEqual(combustible.grupo, "Operación");

  assert.deepStrictEqual(r.porSucursal.map((f) => f.sucursal), ["Ocosingo", "Yajalón"]);
  assert.strictEqual(r.porSucursal[0].total, 1500);

  const efectivo = r.porFormaPago.find((f) => f.forma_pago === "EFECTIVO");
  assert.strictEqual(efectivo.total, 500);
});

test("reporteGastos: por defecto solo cuenta los activos, y reporta el cancelado aparte", async () => {
  const DB = await escenario();
  cancelarGasto(DB, 1, "Duplicado", USUARIO, ALCANCE_TODAS);

  const r = reporteGastos(DB, {}, ALCANCE_TODAS);

  assert.strictEqual(r.totales.numero_gastos, 2, "el cancelado sale del conteo vigente");
  assert.strictEqual(r.totales.total, 1400, "1700 menos los 300 cancelados");
  assert.strictEqual(r.totales.numero_cancelados, 1);
  assert.strictEqual(r.totales.total_cancelado, 300, "nunca sumado al total vigente");
  assert.ok(!r.general.some((g) => g.estatus === "cancelado"), "no aparecen en la lista por defecto");
});

test("reporteGastos: estatus 'todos' incluye los cancelados en la lista", async () => {
  const DB = await escenario();
  cancelarGasto(DB, 1, "Duplicado", USUARIO, ALCANCE_TODAS);

  const r = reporteGastos(DB, { estatus: "todos" }, ALCANCE_TODAS);
  assert.strictEqual(r.general.length, 3);
  assert.strictEqual(r.totales.total, 1400, "el total vigente NO cambia aunque se muestren");
});

test("reporteGastos: filtra por categoría y por forma de pago", async () => {
  const DB = await escenario();

  const porCat = reporteGastos(DB, { categoria_id: idHoja(DB, "Luz") }, ALCANCE_TODAS);
  assert.strictEqual(porCat.totales.total, 1200);

  const porForma = reporteGastos(DB, { forma_pago: "EFECTIVO" }, ALCANCE_TODAS);
  assert.strictEqual(porForma.totales.total, 500);
});

test("reporteGastos: un usuario amarrado solo ve su sucursal", async () => {
  const DB = await escenario();
  const r = reporteGastos(DB, {}, { verTodas: false, sucursalId: 2 });

  assert.strictEqual(r.totales.total, 200);
  assert.deepStrictEqual(r.porSucursal.map((f) => f.sucursal), ["Yajalón"]);
});

test("reporteGastos: sin gastos regresa estructura vacía en ceros", () => {
  const DB = construirDBPrueba();
  const r = reporteGastos(DB, {}, ALCANCE_TODAS);
  assert.deepStrictEqual(r.general, []);
  assert.deepStrictEqual(r.porCategoria, []);
  assert.strictEqual(r.totales.total, 0);
  assert.strictEqual(r.totales.total_cancelado, 0);
});
```

- [ ] **Step 2: Correr para verificar que fallan**

```bash
cd backend && node --test reporteGastos.test.js
```

Expected: FAIL — `reporteGastos is not a function`.

- [ ] **Step 3: Implementar `reporteGastos` en `backend/reportes.js`**

Agregar el `require` arriba, junto a los demás:

```js
const { listarGastos } = require("./gastos");
```

Y la función, antes del `module.exports`:

```js
/**
 * Gastos del periodo. Reutiliza listarGastos (que ya aplica el guard de
 * alcance y enriquece con nombres) y solo agrega las agregaciones.
 *
 * Los cancelados NUNCA se suman al total vigente — mismo criterio que ya usa
 * reporteVentas con las ventas canceladas. Por defecto ni siquiera aparecen
 * en la lista; con estatus "todos" se muestran, pero el total no cambia.
 */
function reporteGastos(DB, filtros, alcance) {
  const { fecha_inicio, fecha_fin, categoria_id, forma_pago, proveedor_id, estatus } = filtros || {};

  let todos = listarGastos(DB, { fecha_inicio, fecha_fin, categoria_id, forma_pago }, alcance);
  if (proveedor_id) todos = todos.filter((g) => g.proveedor_id === Number(proveedor_id));

  const vigentes = todos.filter((g) => g.estatus === "activo");
  const cancelados = todos.filter((g) => g.estatus === "cancelado");
  const general = estatus === "todos" ? todos : vigentes;

  const agrupar = (filas, clave, construir) => {
    const mapa = new Map();
    filas.forEach((f) => {
      const k = clave(f);
      const actual = mapa.get(k) || construir(f);
      actual.numero_gastos += 1;
      actual.total += f.monto;
      mapa.set(k, actual);
    });
    return [...mapa.values()]
      .map((f) => ({ ...f, total: redondear(f.total) }))
      .sort((a, b) => b.total - a.total);
  };

  return {
    general,
    porCategoria: agrupar(vigentes, (f) => f.categoria_nombre,
      (f) => ({ categoria: f.categoria_nombre, grupo: f.grupo_nombre, numero_gastos: 0, total: 0 })),
    porSucursal: agrupar(vigentes, (f) => f.sucursal_nombre,
      (f) => ({ sucursal: f.sucursal_nombre, numero_gastos: 0, total: 0 })),
    porFormaPago: agrupar(vigentes, (f) => f.forma_pago,
      (f) => ({ forma_pago: f.forma_pago, numero_gastos: 0, total: 0 })),
    totales: {
      numero_gastos: vigentes.length,
      total: redondear(vigentes.reduce((a, f) => a + f.monto, 0)),
      numero_cancelados: cancelados.length,
      total_cancelado: redondear(cancelados.reduce((a, f) => a + f.monto, 0)),
    },
  };
}
```

Agregar `reporteGastos` al `module.exports` de `backend/reportes.js`.

- [ ] **Step 4: Agregar la ruta**

En `backend/server.js`, agregar `reporteGastos` al destructuring de `require("./reportes")`, y la ruta junto a las demás de reportes:

```js
app.get("/api/reportes/gastos", requiereLogin, requierePermiso("ver_reportes", resolverPermisosDeRol), (req, res) => {
  const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
  const { fecha_inicio, fecha_fin, categoria_id, forma_pago, proveedor_id, estatus } = req.query;
  res.json(reporteGastos(DB, { fecha_inicio, fecha_fin, categoria_id, forma_pago, proveedor_id, estatus }, alcance));
});
```

- [ ] **Step 5: Correr las pruebas del reporte y toda la suite**

```bash
cd backend && node --test reporteGastos.test.js && node --test
```

Expected: 6 nuevas en verde y **439 en total** (433 + 6).

- [ ] **Step 6: Crear la pantalla del reporte**

Crear `src/reportes/ReporteGastos.jsx` calcando la estructura de `src/reportes/ReporteGastosGarantias.jsx` (que ya tiene 4 pestañas, filtros y export), con estas diferencias:

- Endpoint: `/reportes/gastos`.
- Título: "Reporte de Gastos".
- Filtros: fechas, sucursal (vía `FiltroReporte`), y como `hijos` tres selects: **Categoría** (poblado desde `/gastos/categorias?solo_activas=1`, con `<optgroup>` por grupo), **Forma de pago** (EFECTIVO / TRANSFERENCIA / TARJETA) y **Estatus** (`""` = solo activos, `"todos"` = incluir cancelados).
- Pestañas: `general`, `porCategoria`, `porSucursal`, `porFormaPago`.
- Tabla General: Folio, Fecha, Sucursal, Grupo, Categoría, Concepto, Proveedor, Forma de pago, Comprobante (link "Ver" a `drive_link`), Monto. Un renglón con `estatus === "cancelado"` lleva el monto en `text-slate-400 line-through` y una etiqueta "Cancelado" junto al folio.
- Las 3 pestañas de agrupación reutilizan el mismo patrón de tabla de tres columnas (nombre / No. Gastos / Total).
- Pie: `{totales.numero_gastos} gasto(s)`, y si `totales.numero_cancelados > 0`, un `<span className="text-slate-400">` con `Cancelados: ${totales.total_cancelado}` — nunca sumado al total.
- Export a Excel con `descargarCSV`, con las columnas de la pestaña activa.

- [ ] **Step 7: Registrar el reporte**

En `src/Reportes.jsx`: agregar `Wallet` al import de `lucide-react`, importar `ReporteGastos from "./reportes/ReporteGastos.jsx"`, y agregar al final del arreglo `REPORTES`:

```jsx
  { id: "gastos", nombre: "Gastos", icono: Wallet, Componente: ReporteGastos },
```

- [ ] **Step 8: Verificar que compila**

```bash
npm run build
```

Expected: build exitoso.

- [ ] **Step 9: Commit**

```bash
git add backend/reportes.js backend/server.js backend/reporteGastos.test.js src/reportes/ReporteGastos.jsx src/Reportes.jsx
git commit -m "feat: reporte de Gastos (general, por categoría, por sucursal, por forma de pago)"
```

---

## Verificación manual en navegador (después de las 8 tareas)

El frontend no tiene arnés automático. Con backend y frontend corriendo, entrar como `victor`:

1. **Roles y Personal** muestra la sección "Gastos" con sus 4 permisos, y el rol Administrador los tiene marcados.
2. Registrar un gasto en EFECTIVO: el select de categoría agrupa por grupo; el botón **"?"** abre la chuleta con las subcategorías; al hacer clic en una queda elegida y el panel se cierra.
3. El botón "Guardar gasto" está **deshabilitado hasta adjuntar un archivo**, con el texto explicando por qué.
4. **Corte de Caja:** el efectivo esperado bajó exactamente por el monto del gasto, y aparece el renglón ámbar "Gastos del turno".
5. Cancelar el gasto con motivo: sigue en la lista marcado como Cancelado, con el monto tachado, y el efectivo esperado del corte vuelve a subir.
6. Registrar un gasto por TRANSFERENCIA: **no** cambia el efectivo esperado.
7. **Pestaña Categorías:** agregar una subcategoría nueva y confirmar que aparece de inmediato en el select y en la chuleta "?". Desactivar un grupo con hijas activas debe rechazarse con mensaje claro.
8. **Reporte de Gastos:** los totales cuadran con la pantalla; el filtro de estatus "todos" muestra los cancelados sin cambiar el total vigente; el export a Excel abre bien.

**Pendiente hasta reconectar Drive:** la subida real del comprobante y el link "Ver". Con Drive caído, el paso 2 fallará con el error de token — es lo esperado y no es un bug del módulo.

## Fuera de alcance (YAGNI)

Flujo de autorización · presupuestos y alertas · caja chica · servicios recurrentes · bancos y conciliación · KPIs financieros y gráficas · IA financiera · estado de cuenta entre sucursales · subida por QR desde el celular (módulo siguiente, con su propio diseño y revisión de seguridad) · editar un gasto ya registrado (se cancela y se captura de nuevo).
