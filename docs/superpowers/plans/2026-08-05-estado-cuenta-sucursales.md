# Estado de Cuenta entre Sucursales — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capturar los depósitos de cada tienda a la cuenta común y mostrar, por tienda, el saldo = depósitos − valor (a costo) de la mercancía recibida del CEDIS.

**Architecture:** Módulo nuevo `cuenta_comun`. Backend: `depositos.js` (captura, patrón de `gastos.js`) + `estadoCuenta.js` (cálculo al vuelo desde depósitos y traspasos, como los reportes) + foto de `costo` en cada traspaso. Frontend: tile "Estado de Cuenta" con captura para la cajera (su sucursal) y tabla resumen/filtro para administración. El alcance por sucursal reusa `alcanceSucursal`/`dentroDeAlcance`.

**Tech Stack:** Node.js + Express, `node --test`, React 18 + Vite. Sin dependencias nuevas.

## Global Constraints

- Sin dependencias nuevas (backend ni frontend).
- Código, comentarios y textos de interfaz **en español**.
- **Regla de permisos (obligatoria):** todo botón con acción = su propio permiso, registrado en `permisosCatalogo.js` y `validarPermisos.js`. El backend NO arranca si un módulo/permiso queda sin registrar.
- **Fechas:** los campos de FECHA SOLA usan `fechaLocal()` (backend) / `hoyLocal()`,`haceDiasLocal()` (frontend). Las marcas de tiempo completas siguen en UTC.
- **Folios:** reservar id/folio de forma SÍNCRONA, sin ningún `await` entre leer y escribir el contador, y hacer el `push` antes de cualquier `await` (lección del bug CRITICAL de Gastos).
- **Alcance por sucursal DENTRO del módulo** (`dentroDeAlcance`), no solo en la capa de rutas (lección de Apartados).
- La sucursal de un depósito viene del TOKEN del usuario, nunca del body.
- La suite del backend queda en verde. Estado al empezar: **484 pruebas pasando, 0 fallando.** Comandos del backend desde `backend/`; `npm run build` desde la raíz.

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `backend/traspasos.js` (modificar) | Guardar `costo` (foto del costo del producto) al crear el traspaso. |
| `backend/drive.js` (modificar) | `asegurarCarpetaDepositosSucursal` (carpeta "Comprobantes de Depósitos" / subcarpeta por sucursal). |
| `backend/depositos.js` (crear) | `crearDeposito` / `listarDepositos` / `cancelarDeposito`. Captura, folio síncrono, alcance, comprobante opcional. |
| `backend/estadoCuenta.js` (crear) | `estadoCuenta(DB, filtros, alcance)` — resumen por sucursal + detalle. |
| `backend/permisosCatalogo.js` (modificar) | Módulo `cuenta_comun` + 3 permisos. |
| `backend/validarPermisos.js` (modificar) | `cuenta_comun` en `MODULOS_QUE_REQUIEREN_PERMISOS`. |
| `backend/server.js` (modificar) | Seed `DB.cuenta_comun` + 4 rutas REST. |
| `src/Dashboard.jsx` (modificar) | Tile "Estado de Cuenta". |
| `src/EstadoCuenta.jsx` (crear) | Pantalla: captura (cajera) + resumen/filtro (administración). |
| `src/App.jsx` (modificar) | Enrutar el tile a la pantalla. |
| Tests: `backend/traspasos.test.js`, `backend/depositos.test.js`, `backend/estadoCuenta.test.js`, `backend/drive.test.js`, `backend/permisoEstadoCuenta.test.js` | |

---

### Task 1: Traspasos guardan la foto del costo

**Files:**
- Modify: `backend/traspasos.js` (función `crearTraspaso`)
- Test: `backend/traspasos.test.js`

**Interfaces:**
- Produces: cada traspaso nuevo tiene `costo` (number) = `producto.costo` al momento de enviarse.

- [ ] **Step 1: Escribir la prueba**

Agregar en `backend/traspasos.test.js` (reusa el helper de DB de prueba que ya use ese archivo; si arma la DB inline, seguir el mismo estilo). El producto de prueba debe tener `costo`:

```js
test("crearTraspaso guarda una foto del costo del producto", () => {
  const DB = construirDBConProducto({ id: 1, costo: 40 }); // helper local del archivo
  DB.inventario.existencias.push({ producto_id: 1, sucursal_id: 6, cantidad_actual: 10 });
  const t = crearTraspaso(DB, { producto_id: 1, cantidad: 3, sucursal_destino_id: 1 }, 6, { id: 9, nombre: "Admin" });
  assert.strictEqual(t.costo, 40, "el traspaso guarda el costo del producto al enviarse");
});
```

Si `traspasos.test.js` no tiene un helper de DB, copiar el patrón de armado de DB que ya use el archivo (mirar sus otras pruebas) y darle al producto un `costo`.

- [ ] **Step 2: Correr para ver que falla**

```bash
cd backend && node --test traspasos.test.js
```

Expected: FAIL — `t.costo` es `undefined`.

- [ ] **Step 3: Implementar**

En `backend/traspasos.js`, dentro de `crearTraspaso`, obtener el producto (ya se busca en el camino de error; ahora se busca siempre) y agregar `costo` al objeto `nuevo`:

```js
  const producto = DB["catalogo-productos"].productos.find((p) => p.id === producto_id);
  const disponible = existOrigen ? existOrigen.cantidad_actual : 0;
  if (disponible < cantidad) {
    throw new Error(`No hay existencia suficiente de "${producto?.nombre || "producto"}" en tu sucursal (disponible: ${disponible}, solicitado: ${cantidad})`);
  }

  const nuevo = {
    id: siguienteId(DB.inventario.traspasos),
    producto_id,
    cantidad,
    // Foto del costo al enviar: el estado de cuenta valúa la mercancía
    // recibida a costo, y el costo del producto puede cambiar después.
    costo: producto ? Number(producto.costo) || 0 : 0,
    sucursal_origen_id,
    sucursal_destino_id,
    estatus: "en_transito",
    // ...resto igual...
```

(Quitar la búsqueda de `producto` que estaba dentro del `if` de error y dejar la de arriba, para no buscarlo dos veces.)

- [ ] **Step 4: Correr las pruebas**

```bash
cd backend && node --test traspasos.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/traspasos.js backend/traspasos.test.js
git commit -m "feat(traspasos): guarda la foto del costo del producto al enviarse"
```

---

### Task 2: Backend de depósitos (captura)

**Files:**
- Modify: `backend/drive.js` (agregar `asegurarCarpetaDepositosSucursal` + export + constante)
- Create: `backend/depositos.js`
- Create: `backend/depositos.test.js`
- Modify: `backend/server.js` (seed `DB.cuenta_comun`)
- Test: `backend/drive.test.js` (prueba de la carpeta nueva)

**Interfaces:**
- Consumes: `drive.asegurarCarpetaDepositosSucursal(DB, sucursal)`, `drive.subirArchivoADrive`, `dentroDeAlcance`, `fechaLocal`.
- Produces: `crearDeposito(DB, datos, sucursalId, usuario, drive) -> Promise<deposito>`; `listarDepositos(DB, filtros, alcance) -> deposito[]`; `cancelarDeposito(DB, id, motivo, usuario, alcance) -> deposito`; `buscarConGuardia(DB, id, alcance)`. Colección `DB.cuenta_comun = { depositos, deposito_movimientos, ultimo_id }`.

- [ ] **Step 1: Carpeta de Drive — prueba**

En `backend/drive.test.js`, agregar (patrón de `asegurarCarpetaGastosSucursal`):

```js
const { asegurarCarpetaDepositosSucursal } = require("./drive");

test("asegurarCarpetaDepositosSucursal crea la subcarpeta de la sucursal y la cachea", async (t) => {
  let llamada = 0;
  t.mock.method(globalThis, "fetch", async () => {
    llamada++;
    if (llamada === 1 || llamada === 3) return { ok: true, json: async () => ({ files: [] }) };
    return { ok: true, json: async () => ({ id: `folder-${llamada}` }) };
  });
  const DB = { drive: { cuenta: { access_token: "AT1", refresh_token: "RT1", expires_at: Date.now() + 3_600_000 } } };
  const sucursal = { id: 1, nombre: "Ocosingo" };
  const id = await asegurarCarpetaDepositosSucursal(DB, sucursal);
  assert.ok(id);
  assert.strictEqual(sucursal.drive_folder_depositos_id, id);
  assert.ok(DB.drive.carpeta_depositos_id, "cachea también la carpeta raíz");
});
```

Correr: `cd backend && node --test drive.test.js` → FAIL (no existe la función).

- [ ] **Step 2: Carpeta de Drive — implementar**

En `backend/drive.js`, junto a las otras carpetas:

```js
const CARPETA_DEPOSITOS_NOMBRE = "Comprobantes de Depósitos";

async function asegurarCarpetaDepositosRaiz(DB) {
  if (DB.drive.carpeta_depositos_id) return DB.drive.carpeta_depositos_id;
  let id = await buscarCarpeta(DB, CARPETA_DEPOSITOS_NOMBRE, null);
  if (!id) id = await crearCarpeta(DB, CARPETA_DEPOSITOS_NOMBRE, null);
  DB.drive.carpeta_depositos_id = id;
  return id;
}

async function asegurarCarpetaDepositosSucursal(DB, sucursal) {
  if (sucursal.drive_folder_depositos_id) return sucursal.drive_folder_depositos_id;
  const raizId = await asegurarCarpetaDepositosRaiz(DB);
  const nombre = sucursal.nombre || `Sucursal ${sucursal.id}`;
  let id = await buscarCarpeta(DB, nombre, raizId);
  if (!id) id = await crearCarpeta(DB, nombre, raizId);
  sucursal.drive_folder_depositos_id = id;
  return id;
}
```

Agregar `asegurarCarpetaDepositosSucursal` y `CARPETA_DEPOSITOS_NOMBRE` al `module.exports`. Correr `node --test drive.test.js` → PASS.

- [ ] **Step 3: Depósitos — escribir las pruebas**

Crear `backend/depositos.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { crearDeposito, cancelarDeposito, listarDepositos } = require("./depositos");

const ALCANCE_TODAS = { verTodas: true, sucursalId: null };
const driveFalso = {
  asegurarCarpetaDepositosSucursal: async () => "carpeta-1",
  subirArchivoADrive: async () => ({ id: "file-1", webViewLink: "https://drive/file-1" }),
};

function nuevoDB() {
  return {
    pos: { sucursales: [{ id: 1, nombre: "Ocosingo" }, { id: 2, nombre: "Yajalón" }] },
    cuenta_comun: { depositos: [], deposito_movimientos: [], ultimo_id: 0 },
  };
}

test("crearDeposito exige monto > 0", async () => {
  await assert.rejects(() => crearDeposito(nuevoDB(), { monto: 0, forma_pago: "EFECTIVO" }, 1, { nombre: "Ana" }, driveFalso), /mayor que cero/);
});

test("crearDeposito usa la sucursal del token, no del body", async () => {
  const DB = nuevoDB();
  const d = await crearDeposito(DB, { monto: 5000, forma_pago: "EFECTIVO", sucursal_id: 999 }, 1, { nombre: "Ana" }, driveFalso);
  assert.strictEqual(d.sucursal_id, 1);
  assert.strictEqual(d.folio, "DEP-0001");
  assert.strictEqual(d.estatus, "activo");
});

test("crearDeposito sin comprobante queda registrado sin bloquear", async () => {
  const DB = nuevoDB();
  const d = await crearDeposito(DB, { monto: 1000, forma_pago: "TRANSFERENCIA" }, 1, { nombre: "Ana" }, driveFalso);
  assert.strictEqual(d.drive_link, null);
  assert.strictEqual(DB.cuenta_comun.depositos.length, 1);
});

test("crearDeposito con comprobante adjunta el link de Drive", async () => {
  const DB = nuevoDB();
  const d = await crearDeposito(DB, {
    monto: 1000, forma_pago: "EFECTIVO",
    archivo: { contenido_base64: Buffer.from("x").toString("base64"), tipo_mime: "image/jpeg", nombre_archivo: "ficha.jpg" },
  }, 1, { nombre: "Ana" }, driveFalso);
  assert.strictEqual(d.drive_link, "https://drive/file-1");
});

test("si Drive falla, el depósito igual queda registrado (comprobante opcional)", async () => {
  const DB = nuevoDB();
  const driveCaido = { asegurarCarpetaDepositosSucursal: async () => { throw new Error("Drive caído"); }, subirArchivoADrive: async () => ({}) };
  const d = await crearDeposito(DB, {
    monto: 1000, forma_pago: "EFECTIVO",
    archivo: { contenido_base64: Buffer.from("x").toString("base64"), tipo_mime: "image/jpeg", nombre_archivo: "f.jpg" },
  }, 1, { nombre: "Ana" }, driveCaido);
  assert.strictEqual(d.drive_link, null, "sin comprobante, pero el depósito existe");
  assert.strictEqual(DB.cuenta_comun.depositos.length, 1);
});

test("folios únicos bajo capturas concurrentes (id síncrono)", async () => {
  const DB = nuevoDB();
  const ds = await Promise.all(Array.from({ length: 12 }, () =>
    crearDeposito(DB, { monto: 100, forma_pago: "EFECTIVO" }, 1, { nombre: "Ana" }, driveFalso)));
  const folios = new Set(ds.map((d) => d.folio));
  assert.strictEqual(folios.size, 12, "12 folios distintos");
});

test("cancelarDeposito no borra, exige motivo, y respeta el alcance", async () => {
  const DB = nuevoDB();
  const d = await crearDeposito(DB, { monto: 100, forma_pago: "EFECTIVO" }, 1, { nombre: "Ana" }, driveFalso);
  assert.throws(() => cancelarDeposito(DB, d.id, "  ", { nombre: "Ana" }, ALCANCE_TODAS), /motivo/);
  // una cajera de la sucursal 2 no puede cancelar un depósito de la 1
  const alcanceS2 = { verTodas: false, sucursalId: 2 };
  assert.throws(() => cancelarDeposito(DB, d.id, "error", { nombre: "Otra" }, alcanceS2), /no encontrado/);
  const c = cancelarDeposito(DB, d.id, "duplicado", { nombre: "Ana" }, ALCANCE_TODAS);
  assert.strictEqual(c.estatus, "cancelado");
});

test("listarDepositos respeta el alcance de sucursal", async () => {
  const DB = nuevoDB();
  await crearDeposito(DB, { monto: 100, forma_pago: "EFECTIVO" }, 1, { nombre: "Ana" }, driveFalso);
  await crearDeposito(DB, { monto: 200, forma_pago: "EFECTIVO" }, 2, { nombre: "Beto" }, driveFalso);
  const soloS1 = listarDepositos(DB, {}, { verTodas: false, sucursalId: 1 });
  assert.strictEqual(soloS1.length, 1);
  assert.strictEqual(soloS1[0].sucursal_id, 1);
});
```

Correr: `cd backend && node --test depositos.test.js` → FAIL (no existe el módulo).

- [ ] **Step 4: Depósitos — implementar**

Crear `backend/depositos.js`:

```js
/**
 * depositos.js — Depósitos de cada tienda a la cuenta común (el CEDIS compra y
 * reparte). Mismo patrón que gastos.js: funciones planas, bitácora, guard de
 * alcance DENTRO del módulo, folio SÍNCRONO. El comprobante es OPCIONAL: el
 * depósito se registra ANTES de tocar Drive, así que una falla de Drive no
 * bloquea el registro (el monto es lo importante).
 */

const { dentroDeAlcance } = require("./auth");
const { fechaLocal } = require("./fechas");

const FORMAS_PAGO_DEPOSITO = ["EFECTIVO", "TRANSFERENCIA"];
const MIME_VALIDOS = ["application/pdf", "image/jpeg", "image/png"];
const TAMANO_MAXIMO_BYTES = 10 * 1024 * 1024;

function siguienteId(lista) {
  return lista.length ? Math.max(...lista.map((x) => x.id)) + 1 : 1;
}
function reservarSiguienteId(DB) {
  const maxExistente = DB.cuenta_comun.depositos.reduce((m, d) => Math.max(m, d.id), 0);
  DB.cuenta_comun.ultimo_id = Math.max(DB.cuenta_comun.ultimo_id || 0, maxExistente) + 1;
  return DB.cuenta_comun.ultimo_id;
}
function redondear(n) { return Math.round((Number(n) || 0) * 100) / 100; }

function pushMovimiento(DB, deposito, tipo, descripcion, usuario) {
  DB.cuenta_comun.deposito_movimientos.push({
    id: siguienteId(DB.cuenta_comun.deposito_movimientos),
    deposito_id: deposito.id,
    fecha: new Date().toISOString(),
    usuario: usuario?.nombre || "—",
    tipo, descripcion: descripcion || "",
  });
}

function buscarConGuardia(DB, id, alcance) {
  const d = DB.cuenta_comun.depositos.find((x) => x.id === Number(id));
  if (!d) throw new Error("Depósito no encontrado");
  if (!dentroDeAlcance(d.sucursal_id, alcance)) throw new Error("Depósito no encontrado");
  return d;
}

async function crearDeposito(DB, datos, sucursalId, usuario, drive) {
  const monto = Number(datos.monto);
  if (!Number.isFinite(monto) || monto <= 0) throw new Error("El monto debe ser un número mayor que cero");

  const forma_pago = (datos.forma_pago || "").toUpperCase();
  if (!FORMAS_PAGO_DEPOSITO.includes(forma_pago)) throw new Error("Elige una forma de pago válida");

  const sucursal_id = Number(sucursalId);
  if (!Number.isFinite(sucursal_id) || sucursal_id <= 0) {
    throw new Error("No se pudo determinar tu sucursal — vuelve a iniciar sesión antes de registrar el depósito");
  }
  const sucursal = DB.pos.sucursales.find((s) => s.id === sucursal_id) || { id: sucursal_id };

  // Validación SÍNCRONA del archivo (si viene), ANTES de crear nada: un archivo
  // inválido rechaza todo limpio. La subida (red) sí se deja fallar sin bloquear.
  const archivo = datos.archivo;
  let buffer = null;
  if (archivo && archivo.contenido_base64) {
    if (!MIME_VALIDOS.includes(archivo.tipo_mime)) throw new Error("Tipo de archivo no permitido — solo PDF, JPG o PNG");
    buffer = Buffer.from(archivo.contenido_base64, "base64");
    if (buffer.length > TAMANO_MAXIMO_BYTES) throw new Error("El archivo no puede pesar más de 10 MB");
  }

  // Folio SÍNCRONO + push ANTES de cualquier await (ver Global Constraints).
  const nuevoId = reservarSiguienteId(DB);
  const folio = `DEP-${String(nuevoId).padStart(4, "0")}`;
  const ahora = new Date().toISOString();
  const deposito = {
    id: nuevoId, folio,
    fecha: fechaLocal(ahora), fecha_hora: ahora,
    sucursal_id, monto: redondear(monto), forma_pago,
    referencia: (datos.referencia || "").trim(),
    nota: (datos.nota || "").trim(),
    nombre_archivo: null, drive_file_id: null, drive_link: null,
    usuario_id: usuario?.id ?? null, usuario_nombre: usuario?.nombre || "—",
    estatus: "activo", motivo_cancelacion: null,
  };
  DB.cuenta_comun.depositos.push(deposito);
  pushMovimiento(DB, deposito, "creacion", `Depósito: $${deposito.monto.toFixed(2)} (${forma_pago})`, usuario);

  // Comprobante OPCIONAL: si Drive falla, el depósito ya quedó registrado.
  if (buffer) {
    try {
      const carpetaId = await drive.asegurarCarpetaDepositosSucursal(DB, sucursal);
      const subido = await drive.subirArchivoADrive(DB, {
        nombre: `${folio} - ${archivo.nombre_archivo}`,
        mimeType: archivo.tipo_mime, contenidoBuffer: buffer, carpetaId,
      });
      if (subido && subido.id && subido.webViewLink) {
        deposito.nombre_archivo = archivo.nombre_archivo;
        deposito.drive_file_id = subido.id;
        deposito.drive_link = subido.webViewLink;
      }
    } catch (_) {
      // Drive caído: se conserva el depósito sin comprobante. No se bloquea.
    }
  }
  return deposito;
}

/** Cancela SIN borrar. Se conserva el comprobante en Drive a propósito: la
 *  cancelación nunca debe fallar por que Drive esté caído, y el comprobante es
 *  evidencia de lo que se canceló. (Deliberadamente distinto de la nota del
 *  spec: robustez sobre limpieza.) */
function cancelarDeposito(DB, id, motivo, usuario, alcance) {
  const d = buscarConGuardia(DB, id, alcance);
  if (d.estatus === "cancelado") throw new Error("Ese depósito ya está cancelado");
  const limpio = (motivo || "").trim();
  if (!limpio) throw new Error("Escribe el motivo de la cancelación");
  d.estatus = "cancelado";
  d.motivo_cancelacion = limpio;
  pushMovimiento(DB, d, "cancelacion", `Cancelado: ${limpio}`, usuario);
  return d;
}

function enRango(fecha, desde, hasta) {
  if (desde && fecha < desde) return false;
  if (hasta && fecha > hasta) return false;
  return true;
}

function listarDepositos(DB, filtros, alcance) {
  const { fecha_inicio, fecha_fin, estatus } = filtros || {};
  const nombreSucursal = (id) => (DB.pos.sucursales.find((s) => s.id === id) || {}).nombre || "—";
  let lista = DB.cuenta_comun.depositos.filter((d) => dentroDeAlcance(d.sucursal_id, alcance));
  lista = lista.filter((d) => enRango(d.fecha, fecha_inicio, fecha_fin));
  if (estatus) lista = lista.filter((d) => d.estatus === estatus);
  return lista
    .map((d) => ({ ...d, sucursal_nombre: nombreSucursal(d.sucursal_id) }))
    .sort((a, b) => b.fecha_hora.localeCompare(a.fecha_hora));
}

module.exports = {
  crearDeposito, cancelarDeposito, listarDepositos, buscarConGuardia,
  FORMAS_PAGO_DEPOSITO, MIME_VALIDOS, TAMANO_MAXIMO_BYTES,
};
```

- [ ] **Step 5: Seed de `DB.cuenta_comun` en server.js**

En `backend/server.js`, en el objeto de estado inicial de la DB, junto a `gastos: { ... }`, agregar:

```js
  cuenta_comun: {
    depositos: [],
    deposito_movimientos: [],
    ultimo_id: 0,
  },
```

- [ ] **Step 6: Correr las pruebas**

```bash
cd backend && node --test depositos.test.js drive.test.js
```

Expected: PASS (todas).

- [ ] **Step 7: Commit**

```bash
git add backend/drive.js backend/drive.test.js backend/depositos.js backend/depositos.test.js backend/server.js
git commit -m "feat(cuenta-comun): backend de depósitos (captura con comprobante opcional)"
```

---

### Task 3: Cálculo del estado de cuenta

**Files:**
- Create: `backend/estadoCuenta.js`
- Create: `backend/estadoCuenta.test.js`

**Interfaces:**
- Consumes: `dentroDeAlcance`, `fechaLocal`, `DB.cuenta_comun.depositos`, `DB.inventario.traspasos`, `DB["catalogo-productos"].productos`.
- Produces: `estadoCuenta(DB, { fecha_inicio, fecha_fin, sucursal_id }, alcance) -> { resumen, movimientos, totales }`.

- [ ] **Step 1: Escribir las pruebas**

Crear `backend/estadoCuenta.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { estadoCuenta } = require("./estadoCuenta");

const TODAS = { verTodas: true, sucursalId: null };

function DBbase() {
  return {
    pos: { sucursales: [{ id: 1, nombre: "Ocosingo" }, { id: 2, nombre: "Yajalón" }, { id: 6, nombre: "CEDIS" }] },
    "catalogo-productos": { productos: [{ id: 1, nombre: "Cable", costo: 40 }] },
    cuenta_comun: { depositos: [
      { id: 1, sucursal_id: 1, monto: 10000, fecha: "2026-08-03", estatus: "activo", forma_pago: "EFECTIVO", folio: "DEP-0001" },
    ], deposito_movimientos: [], ultimo_id: 1 },
    inventario: { traspasos: [
      // recibido por sucursal 1: 100 piezas × costo 50 (foto) = 5000
      { id: 1, producto_id: 1, cantidad: 100, costo: 50, sucursal_origen_id: 6, sucursal_destino_id: 1, estatus: "recibido", fecha_recepcion: "2026-08-03T20:00:00.000Z" },
      // en tránsito: NO debe contar
      { id: 2, producto_id: 1, cantidad: 10, costo: 50, sucursal_origen_id: 6, sucursal_destino_id: 1, estatus: "en_transito", fecha_recepcion: null },
    ] },
  };
}

test("saldo = depositado − mercancía recibida (a costo)", () => {
  const r = estadoCuenta(DBbase(), {}, TODAS);
  const s1 = r.resumen.find((x) => x.sucursal_id === 1);
  assert.strictEqual(s1.depositado, 10000);
  assert.strictEqual(s1.recibido, 5000, "100 × 50 (foto del costo), el en_transito no cuenta");
  assert.strictEqual(s1.saldo, 5000, "puso de más / a favor");
});

test("un traspaso en_transito NO cuenta como recibido", () => {
  const DB = DBbase();
  DB.inventario.traspasos = DB.inventario.traspasos.filter((t) => t.estatus === "en_transito");
  const r = estadoCuenta(DB, {}, TODAS);
  const s1 = r.resumen.find((x) => x.sucursal_id === 1);
  assert.strictEqual((s1?.recibido) || 0, 0);
});

test("sin foto de costo, usa el costo actual del producto", () => {
  const DB = DBbase();
  delete DB.inventario.traspasos[0].costo; // traspaso viejo
  const r = estadoCuenta(DB, {}, TODAS);
  const s1 = r.resumen.find((x) => x.sucursal_id === 1);
  assert.strictEqual(s1.recibido, 4000, "100 × 40 (costo actual del producto)");
});

test("el alcance oculta las tiendas de otras sucursales", () => {
  const DB = DBbase();
  DB.cuenta_comun.depositos.push({ id: 2, sucursal_id: 2, monto: 999, fecha: "2026-08-03", estatus: "activo", forma_pago: "EFECTIVO", folio: "DEP-0002" });
  const soloS1 = estadoCuenta(DB, {}, { verTodas: false, sucursalId: 1 });
  assert.ok(!soloS1.resumen.some((x) => x.sucursal_id === 2), "una cajera de la 1 no ve la 2");
});

test("el filtro usa la fecha LOCAL de la tienda (un traspaso de las 8pm cae en el día correcto)", () => {
  // fecha_recepcion 2026-08-03T20:00Z = 2pm local; usar rango de un día
  const r = estadoCuenta(DBbase(), { fecha_inicio: "2026-08-03", fecha_fin: "2026-08-03" }, TODAS);
  const s1 = r.resumen.find((x) => x.sucursal_id === 1);
  assert.strictEqual(s1.recibido, 5000, "el traspaso del 3 cae dentro del rango del 3");
});

test("pedir una sola sucursal devuelve el detalle de movimientos", () => {
  const r = estadoCuenta(DBbase(), { sucursal_id: 1 }, TODAS);
  assert.ok(Array.isArray(r.movimientos));
  assert.strictEqual(r.movimientos.length, 2, "1 depósito + 1 traspaso recibido");
});

test("CEDIS no aparece como deudor (es el origen, no destino)", () => {
  const r = estadoCuenta(DBbase(), {}, TODAS);
  assert.ok(!r.resumen.some((x) => x.sucursal_id === 6));
});
```

- [ ] **Step 2: Correr para ver que falla**

```bash
cd backend && node --test estadoCuenta.test.js
```

Expected: FAIL — no existe el módulo.

- [ ] **Step 3: Implementar**

Crear `backend/estadoCuenta.js`:

```js
/**
 * estadoCuenta.js — Estado de cuenta entre sucursales y la cuenta común.
 *
 * Se calcula al vuelo (como los reportes): NO se guarda ningún saldo que pueda
 * desincronizarse. Por tienda: depósitos activos − valor a costo de la
 * mercancía RECIBIDA del CEDIS = saldo. Positivo = puso de más; negativo = debe.
 */

const { dentroDeAlcance } = require("./auth");
const { fechaLocal } = require("./fechas");

function redondear(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function enRango(fecha, desde, hasta) {
  if (desde && fecha < desde) return false;
  if (hasta && fecha > hasta) return false;
  return true;
}
function costoActual(DB, producto_id) {
  const p = DB["catalogo-productos"].productos.find((x) => x.id === producto_id);
  return p ? Number(p.costo) || 0 : 0;
}
function valorTraspaso(DB, t) {
  const costo = t.costo != null ? Number(t.costo) || 0 : costoActual(DB, t.producto_id);
  return (Number(t.cantidad) || 0) * costo;
}

function estadoCuenta(DB, filtros, alcance) {
  const { fecha_inicio, fecha_fin, sucursal_id } = filtros || {};
  const nombreSucursal = (id) => (DB.pos.sucursales.find((s) => s.id === id) || {}).nombre || "—";
  const soloUna = sucursal_id ? Number(sucursal_id) : null;

  const depositos = (DB.cuenta_comun?.depositos || [])
    .filter((d) => d.estatus === "activo")
    .filter((d) => dentroDeAlcance(d.sucursal_id, alcance))
    .filter((d) => enRango(d.fecha, fecha_inicio, fecha_fin))
    .filter((d) => !soloUna || d.sucursal_id === soloUna);

  const recibidos = (DB.inventario.traspasos || [])
    .filter((t) => t.estatus === "recibido")
    .filter((t) => dentroDeAlcance(t.sucursal_destino_id, alcance))
    .filter((t) => enRango(fechaLocal(t.fecha_recepcion), fecha_inicio, fecha_fin))
    .filter((t) => !soloUna || t.sucursal_destino_id === soloUna);

  const porSucursal = new Map();
  const bucket = (id) => {
    if (!porSucursal.has(id)) porSucursal.set(id, { sucursal_id: id, sucursal_nombre: nombreSucursal(id), depositado: 0, recibido: 0 });
    return porSucursal.get(id);
  };
  for (const d of depositos) bucket(d.sucursal_id).depositado += Number(d.monto) || 0;
  for (const t of recibidos) bucket(t.sucursal_destino_id).recibido += valorTraspaso(DB, t);

  const resumen = [...porSucursal.values()]
    .map((r) => ({ ...r, depositado: redondear(r.depositado), recibido: redondear(r.recibido), saldo: redondear(r.depositado - r.recibido) }))
    .sort((a, b) => a.sucursal_nombre.localeCompare(b.sucursal_nombre));

  let movimientos = null;
  if (soloUna) {
    movimientos = [
      ...depositos.map((d) => ({ tipo: "deposito", fecha: d.fecha, folio: d.folio, concepto: `Depósito (${d.forma_pago})`, cargo: 0, abono: redondear(d.monto) })),
      ...recibidos.map((t) => {
        const p = DB["catalogo-productos"].productos.find((x) => x.id === t.producto_id);
        return { tipo: "mercancia", fecha: fechaLocal(t.fecha_recepcion), folio: `T-${t.id}`, concepto: `Mercancía: ${t.cantidad} × ${p?.nombre || "producto"}`, cargo: redondear(valorTraspaso(DB, t)), abono: 0, aproximado: t.costo == null };
      }),
    ].sort((a, b) => a.fecha.localeCompare(b.fecha));
  }

  const totales = resumen.reduce((a, r) => ({ depositado: a.depositado + r.depositado, recibido: a.recibido + r.recibido, saldo: a.saldo + r.saldo }), { depositado: 0, recibido: 0, saldo: 0 });
  return { resumen, movimientos, totales: { depositado: redondear(totales.depositado), recibido: redondear(totales.recibido), saldo: redondear(totales.saldo) } };
}

module.exports = { estadoCuenta };
```

- [ ] **Step 4: Correr las pruebas**

```bash
cd backend && node --test estadoCuenta.test.js
```

Expected: PASS (7 pruebas).

- [ ] **Step 5: Commit**

```bash
git add backend/estadoCuenta.js backend/estadoCuenta.test.js
git commit -m "feat(cuenta-comun): cálculo del estado de cuenta (depósitos − mercancía a costo)"
```

---

### Task 4: Permisos del módulo `cuenta_comun`

**Files:**
- Modify: `backend/permisosCatalogo.js`
- Modify: `backend/validarPermisos.js`
- Test: `backend/permisoEstadoCuenta.test.js` (crear)

**Interfaces:**
- Produces: permisos `ver_estado_cuenta`, `registrar_depositos`, `cancelar_depositos` (modulo `cuenta_comun`); módulo `cuenta_comun` en `MODULOS_SISTEMA` y en `MODULOS_QUE_REQUIEREN_PERMISOS`.

- [ ] **Step 1: Prueba**

Crear `backend/permisoEstadoCuenta.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { listarPermisos, listarModulosSistema } = require("./permisosCatalogo");
const { validarSistemaDePermisos } = require("./validarPermisos");

test("el módulo cuenta_comun existe con sus 3 permisos", () => {
  const modulos = listarModulosSistema();
  assert.ok(modulos.some((m) => m.id === "cuenta_comun"), "cuenta_comun en MODULOS_SISTEMA");
  const claves = listarPermisos().filter((p) => p.modulo === "cuenta_comun").map((p) => p.clave);
  for (const c of ["ver_estado_cuenta", "registrar_depositos", "cancelar_depositos"]) {
    assert.ok(claves.includes(c), `falta el permiso ${c}`);
  }
});

test("el guardia de arranque pasa con el módulo nuevo registrado", () => {
  assert.doesNotThrow(() => validarSistemaDePermisos());
});
```

Correr: `cd backend && node --test permisoEstadoCuenta.test.js` → FAIL.

- [ ] **Step 2: Registrar el módulo y los permisos**

En `backend/permisosCatalogo.js`, agregar al arreglo `PERMISOS` (después del bloque de Gastos):

```js
  // ---- Estado de Cuenta (cuenta común entre sucursales) ----
  { clave: "ver_estado_cuenta", etiqueta: "Ver Estado de Cuenta", modulo: "cuenta_comun", implementado: true },
  { clave: "registrar_depositos", etiqueta: "Registrar Depósito", modulo: "cuenta_comun", implementado: true },
  { clave: "cancelar_depositos", etiqueta: "Cancelar Depósito", modulo: "cuenta_comun", implementado: true },
```

y a `MODULOS_SISTEMA`:

```js
  { id: "cuenta_comun", nombre: "Estado de Cuenta" },
```

En `backend/validarPermisos.js`, agregar `"cuenta_comun"` al arreglo `MODULOS_QUE_REQUIEREN_PERMISOS`.

- [ ] **Step 3: Correr las pruebas + toda la suite (el guardia de arranque toca todo)**

```bash
cd backend && node --test
```

Expected: PASS. `reconciliarRoles` agregará los permisos nuevos al rol Administrador en el arranque automáticamente.

- [ ] **Step 4: Commit**

```bash
git add backend/permisosCatalogo.js backend/validarPermisos.js backend/permisoEstadoCuenta.test.js
git commit -m "feat(cuenta-comun): registra el módulo y sus 3 permisos en Roles y Personal"
```

---

### Task 5: Rutas REST

**Files:**
- Modify: `backend/server.js` (requires + 4 rutas)
- Test: `backend/permisoEstadoCuenta.test.js` (ampliar con una verificación de que las rutas existen si el archivo prueba rutas; si no, basta la verificación de arranque)

**Interfaces:**
- Consumes: `crearDeposito`, `listarDepositos`, `cancelarDeposito` de `depositos.js`; `estadoCuenta` de `estadoCuenta.js`; `alcanceSucursal`, `resolverPermisosDeRol`, `requierePermiso`, `drive`, `guardar`.

- [ ] **Step 1: Requires**

En `backend/server.js`, junto a los otros requires de módulos:

```js
const { crearDeposito, listarDepositos, cancelarDeposito } = require("./depositos");
const { estadoCuenta } = require("./estadoCuenta");
```

- [ ] **Step 2: Rutas**

Agregar (junto a las rutas de gastos, mismo estilo — cada una con su permiso propio):

```js
// ---------- Estado de Cuenta (cuenta común entre sucursales) ----------
app.get("/api/estado-cuenta", requiereLogin, requierePermiso("ver_estado_cuenta", resolverPermisosDeRol), (req, res) => {
  const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
  res.json(estadoCuenta(DB, req.query, alcance));
});

app.get("/api/depositos", requiereLogin, requierePermiso("ver_estado_cuenta", resolverPermisosDeRol), (req, res) => {
  const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
  res.json(listarDepositos(DB, req.query, alcance));
});

app.post("/api/depositos", requiereLogin, requierePermiso("registrar_depositos", resolverPermisosDeRol), async (req, res) => {
  try {
    // La sucursal sale del TOKEN, nunca del body.
    const d = await crearDeposito(DB, req.body, req.usuarioToken.sucursal_id, req.usuarioToken, drive);
    res.json(d);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.put("/api/depositos/:id/cancelar", requiereLogin, requierePermiso("cancelar_depositos", resolverPermisosDeRol), (req, res) => {
  try {
    const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
    res.json(cancelarDeposito(DB, req.params.id, req.body.motivo, req.usuarioToken, alcance));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
```

(El middleware global ya llama `guardar(DB)` cuando `res.statusCode < 400` — ver server.js:378 — así que no hay que persistir a mano.)

- [ ] **Step 3: Verificar arranque + toda la suite**

```bash
cd backend && node --test
cd backend && node -e "require('./server'); console.log('SERVER OK'); process.exit(0)"
```

Expected: PASS y `SERVER OK`.

- [ ] **Step 4: Commit**

```bash
git add backend/server.js
git commit -m "feat(cuenta-comun): rutas REST de depósitos y estado de cuenta"
```

---

### Task 6: Frontend — pantalla y tile

**Files:**
- Modify: `src/Dashboard.jsx` (tile) e importar un ícono
- Modify: `src/App.jsx` (enrutar el tile a la pantalla — seguir el patrón de cómo `Gastos` se enruta)
- Create: `src/EstadoCuenta.jsx`

**Interfaces:**
- Consumes: `apiFetch` (`./api`), `comprimirImagen` (`./comprimirImagen`), `hoyLocal`/`haceDiasLocal` (`./fechas`), `descargarCSV` (`./reportes/exportarCSV.js`).
- Endpoints: `GET /api/estado-cuenta?fecha_inicio&fecha_fin&sucursal_id`, `GET /api/depositos`, `POST /api/depositos`, `PUT /api/depositos/:id/cancelar`.

- [ ] **Step 1: Tile en el Dashboard**

En `src/Dashboard.jsx`: importar un ícono (p. ej. `Scale` o `Wallet` de lucide-react — usar uno no repetido) y agregar al arreglo `MODULOS`:

```jsx
  { id: "estado_cuenta", nombre: "Estado de Cuenta", icono: Scale, disponible: true, modulo: "cuenta_comun", permiso: "ver_estado_cuenta" },
```

- [ ] **Step 2: Enrutar el tile**

En `src/App.jsx`, localizar cómo el tile `gastos` abre `<Gastos ... />` y replicarlo para `estado_cuenta` → `<EstadoCuenta usuario={...} onVolver={...} />`, pasando `permisos` y `usuario` igual que a `Gastos`.

- [ ] **Step 3: Crear `src/EstadoCuenta.jsx`**

Componente con dos zonas, gobernadas por los permisos que ya trae `usuario.permisos` y por si el usuario ve todas las sucursales:

- `puede(clave) = !permisos || permisos.includes(clave)`.
- **Captura de depósito** (solo si `puede("registrar_depositos")`): botón "Registrar depósito" → modal con: monto (requerido, > 0), forma de pago (EFECTIVO/TRANSFERENCIA), referencia (opcional), nota (opcional), comprobante (opcional, `<input type="file" accept=".pdf,.jpg,.jpeg,.png">` pasado por `comprimirImagen` como en `Gastos.jsx`). Enviar por `POST /api/depositos` (base64 en `archivo`, igual que Gastos: `{ nombre_archivo, tipo_mime, contenido_base64 }`).
- **Resumen** (si `puede("ver_estado_cuenta")`): llamar `GET /api/estado-cuenta` con filtro de fechas (por defecto `haceDiasLocal(30)` a `hoyLocal()`) y, para quien ve todas las sucursales, un selector de sucursal. Mostrar tabla: Sucursal · Depositado · Recibido · **Saldo** (verde si ≥ 0, rojo si < 0) + fila de totales. Al elegir una sucursal, pedir `?sucursal_id=` y mostrar el detalle `movimientos` (Fecha · Folio · Concepto · Cargo · Abono), marcando con un aviso las filas `aproximado: true` ("costo aproximado").
- **Depósitos de mi tienda:** lista desde `GET /api/depositos` con botón "Cancelar" por fila (solo si `puede("cancelar_depositos")`) → pide motivo → `PUT /api/depositos/:id/cancelar`.
- **Export CSV** del resumen con `descargarCSV` (helper endurecido ya existente).

Notas de implementación (copiar patrones existentes):
- El manejo de archivo/compresión: copiar `elegirArchivo` de `src/Gastos.jsx` (con `comprimirImagen`, estados `comprimiendo`/`pesoOriginal`, y `e.target.value=""` al final).
- La lectura base64: copiar `leerArchivoComoBase64` de `src/Gastos.jsx`.
- Modal con scroll y footer fijo: seguir la estructura de los modales de `Gastos.jsx` (`max-h-[92vh] flex flex-col`, body `flex-1 min-h-0 overflow-y-auto`, footer `shrink-0`, botón `type="submit"` con `form="..."`).

- [ ] **Step 4: Verificar que compila**

```bash
npm run build
```

Expected: build exitoso, sin errores nuevos (el warning de chunk > 500 kB es preexistente).

- [ ] **Step 5: Correr la suite del backend como red de seguridad**

```bash
cd backend && node --test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/Dashboard.jsx src/App.jsx src/EstadoCuenta.jsx
git commit -m "feat(cuenta-comun): pantalla Estado de Cuenta (captura por cajera + resumen para administración)"
```

---

## Verificación manual en navegador (después de las 6 tareas)

1. Con un usuario amarrado a una sucursal y permiso `registrar_depositos`: registrar un depósito (con y sin ficha) y ver que aparece en su lista y en su saldo. Con Drive caído, el depósito sin ficha debe registrarse igual.
2. Con un usuario Administrador (ve todas): ver la tabla resumen de todas las tiendas, filtrar por una, ver el detalle, y que el saldo = depositado − recibido cuadre con un traspaso recibido conocido.
3. Confirmar que una cajera de una sucursal NO ve ni cancela depósitos de otra.
4. Export CSV abre bien en Excel (acentos y comas correctos — helper endurecido).

## Fuera de alcance (YAGNI)

- Cierre por periodo, préstamos directos tienda-a-tienda, depósitos etiquetados para otra tienda.
- Reintento de subida del comprobante si Drive falló (el depósito queda sin ficha; se puede cancelar y recapturar).
- Que administración registre depósitos por otra tienda.

## Notas de auto-revisión (plan vs spec)

- **Cobertura:** captura de depósitos (T2), valuación a costo con foto (T1+T3), saldo corriente con filtro de fechas (T3), comprobante opcional (T2), permisos por botón (T4), captura por cajera + vista central (T5+T6). Todo el spec tiene tarea.
- **Desviación deliberada del spec:** el spec decía "al cancelar borra el comprobante de Drive"; el plan **conserva** el comprobante y hace la cancelación síncrona, para que cancelar nunca falle por Drive caído (más robusto). Documentado en `depositos.js`.
- **Ambigüedad resuelta:** la fecha para el filtro de mercancía recibida es `traspaso.fecha_recepcion` (existe en el modelo), convertida con `fechaLocal()`.
