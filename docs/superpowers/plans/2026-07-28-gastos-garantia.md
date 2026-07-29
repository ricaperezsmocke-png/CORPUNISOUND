# Gastos de Garantía — Plan de Implementación (Fase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir registrar gastos (traslado/reparación/otro) por garantía, cada uno con monto y comprobante opcional subido a Google Drive, con total por garantía; y quitar el campo viejo de costo de reparación del paso de Resolución.

**Architecture:** Nueva colección `DB.inventario.garantia_gastos` y módulo `backend/garantiasGastos.js` (funciones planas que reciben `DB` + un `drive` inyectado, igual que `documentosPersonal.js`). Reutiliza el guard de alcance y la bitácora de `garantias.js`, y las subidas/borrados de `drive.js` (con carpetas nuevas para garantías). Frontend: modal de "Gastos" en `src/Garantias.jsx`.

**Tech Stack:** Node.js/Express, `node --test`, React 18 + Tailwind + lucide-react. Sin dependencias nuevas.

## Global Constraints

- El comprobante es OPCIONAL; el monto es OBLIGATORIO y debe ser número > 0.
- Toda función mutadora/listado valida `dentroDeAlcance(garantia.sucursal_origen_id, alcance)` vía `buscarConGuardia`; fuera de alcance lanza `"Garantía no encontrada"`.
- Permiso `gestionar_garantias` (módulo `inventario`) para todas las rutas de gastos.
- Tipos de archivo permitidos: `application/pdf`, `image/jpeg`, `image/png`. Tamaño máximo: 10 MB.
- Tipos de gasto: `traslado`, `reparacion`, `otro`.
- Sin dependencias nuevas. La suite `node --test` del backend debe quedar completa en verde tras cada tarea.
- Frontend sin pruebas automáticas: verificación manual en navegador.

---

### Task 1: Modelo de datos + módulo `garantiasGastos.js`

**Files:**
- Modify: `backend/server.js` (seed de `DB.inventario`)
- Modify: `backend/testHelpers.js` (seed de `DB.inventario`)
- Modify: `backend/garantias.js` (exportar `buscarConGuardia` y `pushMovimiento`; enriquecer `listarGarantias` con `total_gastos`)
- Create: `backend/garantiasGastos.js`
- Create: `backend/garantiasGastos.test.js`

**Interfaces:**
- Consumes: `buscarConGuardia`, `pushMovimiento` de `./garantias`.
- Produces (exportados de `backend/garantiasGastos.js`):
  - `agregarGasto(DB, garantiaId, datos, usuario, alcance, drive)` → gasto (async)
  - `listarGastos(DB, garantiaId, alcance)` → arreglo de gastos
  - `totalGastos(DB, garantiaId)` → number
  - `eliminarGasto(DB, garantiaId, gastoId, usuario, alcance, drive)` → `{ ok: true }` (async)
  - Constantes: `TIPOS_GASTO`, `ETIQUETA_TIPO`, `MIME_VALIDOS`, `TAMANO_MAXIMO_BYTES`
  - `datos = { tipo, monto, descripcion?, archivo? }`, con `archivo = { nombre_archivo, tipo_mime, contenido_base64 }` opcional.

- [ ] **Step 1: Agregar `garantia_gastos: []` al seed de `DB.inventario`**

En `backend/server.js`, dentro de `DB.inventario` (el bloque que ahora termina con `garantia_movimientos: [],`), dejarlo así:

```js
    garantias: [],
    garantia_movimientos: [],
    garantia_gastos: [],
  },
```

En `backend/testHelpers.js`, dentro del `inventario` del DB de prueba (bloque que termina con `garantia_movimientos: [],`), dejarlo así:

```js
      garantias: [],
      garantia_movimientos: [],
      garantia_gastos: [],
    },
```

- [ ] **Step 2: Exportar `buscarConGuardia` y `pushMovimiento` desde `garantias.js`**

En `backend/garantias.js`, en el `module.exports` (que hoy exporta `crearGarantia, marcarEnviada, ...`), agregar las dos funciones internas para reutilizarlas:

```js
module.exports = {
  crearGarantia, marcarEnviada, actualizarUbicacion, registrarResolucion,
  recibirEnTienda, entregarACliente, listarGarantias,
  buscarConGuardia, pushMovimiento,
};
```

- [ ] **Step 3: Enriquecer `listarGarantias` con `total_gastos`**

En `backend/garantias.js`, dentro del `.map((g) => {...})` de `listarGarantias`, en el objeto que se retorna (junto a `dias_sin_movimiento`, `atrasada`, `movimientos`), agregar:

```js
        total_gastos: (DB.inventario.garantia_gastos || [])
          .filter((x) => x.garantia_id === g.id)
          .reduce((s, x) => s + Number(x.monto || 0), 0),
```

(Se usa `|| []` para tolerar DBs persistidas viejas sin la colección.)

- [ ] **Step 4: Escribir las pruebas de `garantiasGastos.js`**

Crear `backend/garantiasGastos.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { crearGarantia } = require("./garantias");
const {
  agregarGasto, listarGastos, totalGastos, eliminarGasto,
} = require("./garantiasGastos");

const ALCANCE_TODAS = { verTodas: true, sucursalId: null };
const USUARIO = { id: 1, nombre: "Ana" };

// Stub de Drive: registra llamadas sin tocar la API real.
function crearDriveStub() {
  const llamadas = { subidas: [], borrados: [] };
  return {
    asegurarCarpetaGarantia: async (DB, garantia) => "carpeta_" + garantia.folio,
    subirArchivoADrive: async (DB, { nombre }) => {
      llamadas.subidas.push(nombre);
      return { id: "file_" + llamadas.subidas.length, webViewLink: "https://drive/" + nombre };
    },
    eliminarArchivoDeDrive: async (DB, id) => { llamadas.borrados.push(id); },
    _llamadas: llamadas,
  };
}

const PDF_BASE64 = Buffer.from("contenido-pdf-de-prueba").toString("base64");

test("agregarGasto sin archivo: guarda monto/tipo, sin comprobante, suma al total y deja movimiento", async () => {
  const DB = construirDBPrueba();
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
  const drive = crearDriveStub();

  const gasto = await agregarGasto(DB, g.id, { tipo: "traslado", monto: 150 }, USUARIO, ALCANCE_TODAS, drive);

  assert.strictEqual(gasto.tipo, "traslado");
  assert.strictEqual(gasto.monto, 150);
  assert.strictEqual(gasto.drive_file_id, null);
  assert.strictEqual(gasto.nombre_archivo, null);
  assert.strictEqual(drive._llamadas.subidas.length, 0, "sin archivo => Drive no se llama");
  assert.strictEqual(totalGastos(DB, g.id), 150);

  const movs = DB.inventario.garantia_movimientos.filter((m) => m.garantia_id === g.id);
  assert.strictEqual(movs[movs.length - 1].tipo, "gasto");
});

test("agregarGasto con archivo: sube a Drive y guarda drive_file_id/link/nombre", async () => {
  const DB = construirDBPrueba();
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
  const drive = crearDriveStub();

  const gasto = await agregarGasto(DB, g.id, {
    tipo: "reparacion", monto: 350, descripcion: "cambio de etapa",
    archivo: { nombre_archivo: "factura.pdf", tipo_mime: "application/pdf", contenido_base64: PDF_BASE64 },
  }, USUARIO, ALCANCE_TODAS, drive);

  assert.strictEqual(drive._llamadas.subidas.length, 1);
  assert.strictEqual(gasto.nombre_archivo, "factura.pdf");
  assert.strictEqual(gasto.drive_file_id, "file_1");
  assert.match(gasto.drive_link, /drive/);
});

test("agregarGasto rechaza tipo inválido", async () => {
  const DB = construirDBPrueba();
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
  await assert.rejects(
    () => agregarGasto(DB, g.id, { tipo: "viaje_a_la_luna", monto: 10 }, USUARIO, ALCANCE_TODAS, crearDriveStub()),
    /tipo de gasto/i
  );
});

test("agregarGasto rechaza monto <= 0 o no numérico", async () => {
  const DB = construirDBPrueba();
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
  const drive = crearDriveStub();
  await assert.rejects(() => agregarGasto(DB, g.id, { tipo: "otro", monto: 0 }, USUARIO, ALCANCE_TODAS, drive), /monto/i);
  await assert.rejects(() => agregarGasto(DB, g.id, { tipo: "otro", monto: -5 }, USUARIO, ALCANCE_TODAS, drive), /monto/i);
  await assert.rejects(() => agregarGasto(DB, g.id, { tipo: "otro", monto: "abc" }, USUARIO, ALCANCE_TODAS, drive), /monto/i);
});

test("agregarGasto rechaza MIME no permitido", async () => {
  const DB = construirDBPrueba();
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
  await assert.rejects(
    () => agregarGasto(DB, g.id, {
      tipo: "traslado", monto: 10,
      archivo: { nombre_archivo: "malo.exe", tipo_mime: "application/octet-stream", contenido_base64: PDF_BASE64 },
    }, USUARIO, ALCANCE_TODAS, crearDriveStub()),
    /no permitido/i
  );
});

test("agregarGasto rechaza archivo mayor a 10MB", async () => {
  const DB = construirDBPrueba();
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
  const grande = Buffer.alloc(10 * 1024 * 1024 + 1).toString("base64");
  await assert.rejects(
    () => agregarGasto(DB, g.id, {
      tipo: "traslado", monto: 10,
      archivo: { nombre_archivo: "grande.pdf", tipo_mime: "application/pdf", contenido_base64: grande },
    }, USUARIO, ALCANCE_TODAS, crearDriveStub()),
    /10 MB/i
  );
});

test("agregarGasto respeta el guard de alcance", async () => {
  const DB = construirDBPrueba();
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO); // sucursal 1
  const alcanceOtra = { verTodas: false, sucursalId: 2 };
  await assert.rejects(
    () => agregarGasto(DB, g.id, { tipo: "otro", monto: 10 }, USUARIO, alcanceOtra, crearDriveStub()),
    /no encontrada/i
  );
});

test("listarGastos respeta el alcance y devuelve solo los de esa garantía", async () => {
  const DB = construirDBPrueba();
  const g1 = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
  const g2 = crearGarantia(DB, { producto_id: 1 }, 2, USUARIO);
  const drive = crearDriveStub();
  await agregarGasto(DB, g1.id, { tipo: "traslado", monto: 100 }, USUARIO, ALCANCE_TODAS, drive);
  await agregarGasto(DB, g2.id, { tipo: "traslado", monto: 200 }, USUARIO, ALCANCE_TODAS, drive);

  const lista = listarGastos(DB, g1.id, ALCANCE_TODAS);
  assert.strictEqual(lista.length, 1);
  assert.strictEqual(lista[0].monto, 100);

  await assert.rejects(() => listarGastos(DB, g1.id, { verTodas: false, sucursalId: 2 }), /no encontrada/i);
});

test("eliminarGasto borra el archivo de Drive y el registro, y deja movimiento", async () => {
  const DB = construirDBPrueba();
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
  const drive = crearDriveStub();
  const gasto = await agregarGasto(DB, g.id, {
    tipo: "reparacion", monto: 350,
    archivo: { nombre_archivo: "f.pdf", tipo_mime: "application/pdf", contenido_base64: PDF_BASE64 },
  }, USUARIO, ALCANCE_TODAS, drive);

  const r = await eliminarGasto(DB, g.id, gasto.id, USUARIO, ALCANCE_TODAS, drive);

  assert.deepStrictEqual(r, { ok: true });
  assert.strictEqual(drive._llamadas.borrados.length, 1);
  assert.strictEqual(listarGastos(DB, g.id, ALCANCE_TODAS).length, 0);
  const movs = DB.inventario.garantia_movimientos.filter((m) => m.garantia_id === g.id);
  assert.strictEqual(movs[movs.length - 1].tipo, "gasto_eliminado");
});

test("eliminarGasto respeta el guard de alcance", async () => {
  const DB = construirDBPrueba();
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
  const drive = crearDriveStub();
  const gasto = await agregarGasto(DB, g.id, { tipo: "otro", monto: 10 }, USUARIO, ALCANCE_TODAS, drive);
  await assert.rejects(
    () => eliminarGasto(DB, g.id, gasto.id, USUARIO, { verTodas: false, sucursalId: 2 }, drive),
    /no encontrada/i
  );
});

test("listarGarantias incluye total_gastos", async () => {
  const { listarGarantias } = require("./garantias");
  const DB = construirDBPrueba();
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
  const drive = crearDriveStub();
  await agregarGasto(DB, g.id, { tipo: "traslado", monto: 100 }, USUARIO, ALCANCE_TODAS, drive);
  await agregarGasto(DB, g.id, { tipo: "reparacion", monto: 350 }, USUARIO, ALCANCE_TODAS, drive);

  const fila = listarGarantias(DB, ALCANCE_TODAS).find((x) => x.id === g.id);
  assert.strictEqual(fila.total_gastos, 450);
});
```

- [ ] **Step 5: Correr las pruebas para verificar que fallan**

Run: `cd backend && npx node --test garantiasGastos.test.js`
Expected: FAIL — `Cannot find module './garantiasGastos'`.

- [ ] **Step 6: Implementar `backend/garantiasGastos.js`**

```js
/**
 * garantiasGastos.js — Gastos asociados a una garantía (traslado, reparación
 * u otro), cada uno con monto y un comprobante OPCIONAL (PDF/JPG/PNG) que se
 * guarda en Google Drive. Mismo patrón que documentosPersonal.js: recibe el
 * módulo `drive` como parámetro para poder probar sin la API real.
 *
 * Reutiliza el guard de alcance y la bitácora de garantias.js.
 */

const { buscarConGuardia, pushMovimiento } = require("./garantias");

const TIPOS_GASTO = ["traslado", "reparacion", "otro"];
const ETIQUETA_TIPO = { traslado: "Traslado", reparacion: "Reparación", otro: "Otro" };
const MIME_VALIDOS = ["application/pdf", "image/jpeg", "image/png"];
const TAMANO_MAXIMO_BYTES = 10 * 1024 * 1024;

function siguienteId(lista) {
  return lista.length ? Math.max(...lista.map((x) => x.id)) + 1 : 1;
}

async function agregarGasto(DB, garantiaId, datos, usuario, alcance, drive) {
  const garantia = buscarConGuardia(DB, garantiaId, alcance);

  const tipo = datos.tipo;
  if (!TIPOS_GASTO.includes(tipo)) throw new Error("Tipo de gasto inválido");
  const monto = Number(datos.monto);
  if (!Number.isFinite(monto) || monto <= 0) throw new Error("El monto debe ser un número mayor que cero");

  let nombre_archivo = null, drive_file_id = null, drive_link = null;
  if (datos.archivo && datos.archivo.contenido_base64) {
    const { nombre_archivo: nom, tipo_mime, contenido_base64 } = datos.archivo;
    if (!MIME_VALIDOS.includes(tipo_mime)) throw new Error("Tipo de archivo no permitido — solo PDF, JPG o PNG");
    const buffer = Buffer.from(contenido_base64, "base64");
    if (buffer.length > TAMANO_MAXIMO_BYTES) throw new Error("El archivo no puede pesar más de 10 MB");
    const carpetaId = await drive.asegurarCarpetaGarantia(DB, garantia);
    const subido = await drive.subirArchivoADrive(DB, {
      nombre: `${garantia.folio} - ${ETIQUETA_TIPO[tipo]} - ${nom}`,
      mimeType: tipo_mime,
      contenidoBuffer: buffer,
      carpetaId,
    });
    nombre_archivo = nom;
    drive_file_id = subido.id;
    drive_link = subido.webViewLink;
  }

  const gasto = {
    id: siguienteId(DB.inventario.garantia_gastos),
    garantia_id: garantia.id,
    tipo,
    monto,
    descripcion: datos.descripcion || "",
    nombre_archivo,
    drive_file_id,
    drive_link,
    usuario: usuario?.nombre || "—",
    fecha: new Date().toISOString(),
  };
  DB.inventario.garantia_gastos.push(gasto);

  const compTxt = nombre_archivo ? ` (comprobante: ${nombre_archivo})` : "";
  const descTxt = datos.descripcion ? ` — ${datos.descripcion}` : "";
  pushMovimiento(DB, garantia, "gasto",
    `Gasto de ${ETIQUETA_TIPO[tipo].toLowerCase()}: $${monto.toFixed(2)}${descTxt}${compTxt}`, usuario);
  return gasto;
}

function listarGastos(DB, garantiaId, alcance) {
  const garantia = buscarConGuardia(DB, garantiaId, alcance);
  return DB.inventario.garantia_gastos.filter((g) => g.garantia_id === garantia.id);
}

function totalGastos(DB, garantiaId) {
  return DB.inventario.garantia_gastos
    .filter((g) => g.garantia_id === Number(garantiaId))
    .reduce((s, g) => s + Number(g.monto || 0), 0);
}

async function eliminarGasto(DB, garantiaId, gastoId, usuario, alcance, drive) {
  const garantia = buscarConGuardia(DB, garantiaId, alcance);
  const idx = DB.inventario.garantia_gastos.findIndex(
    (g) => g.id === Number(gastoId) && g.garantia_id === garantia.id
  );
  if (idx === -1) throw new Error("Gasto no encontrado");
  const gasto = DB.inventario.garantia_gastos[idx];
  if (gasto.drive_file_id) await drive.eliminarArchivoDeDrive(DB, gasto.drive_file_id);
  DB.inventario.garantia_gastos.splice(idx, 1);
  pushMovimiento(DB, garantia, "gasto_eliminado",
    `Gasto eliminado: ${ETIQUETA_TIPO[gasto.tipo]} $${Number(gasto.monto).toFixed(2)}`, usuario);
  return { ok: true };
}

module.exports = {
  agregarGasto, listarGastos, totalGastos, eliminarGasto,
  TIPOS_GASTO, ETIQUETA_TIPO, MIME_VALIDOS, TAMANO_MAXIMO_BYTES,
};
```

- [ ] **Step 7: Correr las pruebas del módulo (deben pasar)**

Run: `cd backend && npx node --test garantiasGastos.test.js`
Expected: todas PASS (12 pruebas).

- [ ] **Step 8: Correr toda la suite de backend (regresión)**

Run: `cd backend && npm test`
Expected: toda la suite previa PASS + las nuevas. (Nota: los tests de `garantias.test.js` que verifican `costo_resolucion` se ajustan en la Task 3; en esta tarea todavía pasan porque no se ha tocado esa lógica.)

- [ ] **Step 9: Commit**

```bash
git add backend/server.js backend/testHelpers.js backend/garantias.js backend/garantiasGastos.js backend/garantiasGastos.test.js
git commit -m "feat: módulo de gastos de garantía (agregar/listar/eliminar, comprobante opcional en Drive)"
```

---

### Task 2: Carpetas de Drive para garantías (`drive.js`)

**Files:**
- Modify: `backend/drive.js`
- Modify: `backend/drive.test.js`

**Interfaces:**
- Produces (exportadas de `backend/drive.js`): `asegurarCarpetaGarantia(DB, garantia)` → id de carpeta (async), y constante `CARPETA_GARANTIAS_NOMBRE`.
- Consumes: helpers internos existentes `buscarCarpeta`, `crearCarpeta`.

- [ ] **Step 1: Escribir las pruebas nuevas en `drive.test.js`**

Al final de `backend/drive.test.js`, agregar el import de las funciones nuevas (ampliar el `require` de la parte superior para incluirlas) y estas pruebas:

En el `require` de arriba (líneas 3-7), agregar `asegurarCarpetaGarantia`:

```js
const {
  intercambiarCodigo, urlAutorizacion, tokenActivo,
  asegurarCarpetaRaiz, asegurarCarpetaEmpleado,
  subirArchivoADrive, eliminarArchivoDeDrive,
  asegurarCarpetaGarantia,
} = require("./drive");
```

Al final del archivo:

```js
test("asegurarCarpetaGarantia crea la subcarpeta con el folio y la cachea en la garantía", async (t) => {
  let llamada = 0;
  t.mock.method(globalThis, "fetch", async () => {
    llamada++;
    // 1: busca raíz (no existe) -> 2: crea raíz -> 3: busca subcarpeta (no existe) -> 4: crea subcarpeta
    if (llamada === 1 || llamada === 3) return { ok: true, json: async () => ({ files: [] }) };
    return { ok: true, json: async () => ({ id: `folder-${llamada}` }) };
  });
  const DB = { drive: { cuenta: { access_token: "AT1", refresh_token: "RT1", expires_at: Date.now() + 3_600_000 } } };
  const garantia = { id: 1, folio: "G-0001" };

  const id = await asegurarCarpetaGarantia(DB, garantia);

  assert.ok(id, "debe regresar un id de carpeta");
  assert.strictEqual(garantia.drive_folder_id, id, "cachea el id en la garantía");
});

test("asegurarCarpetaGarantia reusa drive_folder_id si ya está en la garantía", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => { throw new Error("no debería llamarse"); });
  const DB = { drive: { cuenta: { access_token: "AT1", refresh_token: "RT1", expires_at: Date.now() + 3_600_000 } } };
  const garantia = { id: 1, folio: "G-0001", drive_folder_id: "folder-cacheado" };

  const id = await asegurarCarpetaGarantia(DB, garantia);

  assert.strictEqual(id, "folder-cacheado");
  assert.strictEqual(fetchMock.mock.calls.length, 0);
});
```

- [ ] **Step 2: Correr las pruebas para verificar que fallan**

Run: `cd backend && npx node --test drive.test.js`
Expected: FAIL — `asegurarCarpetaGarantia is not a function`.

- [ ] **Step 3: Implementar las carpetas de garantías en `drive.js`**

En `backend/drive.js`, junto a la constante `CARPETA_RAIZ_NOMBRE` (línea 21), agregar:

```js
const CARPETA_GARANTIAS_NOMBRE = "Comprobantes de Garantías";
```

Después de `asegurarCarpetaEmpleado` (línea ~134), agregar:

```js
async function asegurarCarpetaGarantiasRaiz(DB) {
  if (DB.drive.carpeta_garantias_id) return DB.drive.carpeta_garantias_id;
  let id = await buscarCarpeta(DB, CARPETA_GARANTIAS_NOMBRE, null);
  if (!id) id = await crearCarpeta(DB, CARPETA_GARANTIAS_NOMBRE, null);
  DB.drive.carpeta_garantias_id = id;
  return id;
}

async function asegurarCarpetaGarantia(DB, garantia) {
  if (garantia.drive_folder_id) return garantia.drive_folder_id;
  const raizId = await asegurarCarpetaGarantiasRaiz(DB);
  let id = await buscarCarpeta(DB, garantia.folio, raizId);
  if (!id) id = await crearCarpeta(DB, garantia.folio, raizId);
  garantia.drive_folder_id = id;
  return id;
}
```

En el `module.exports` de `drive.js`, agregar `asegurarCarpetaGarantia` y `CARPETA_GARANTIAS_NOMBRE`:

```js
module.exports = {
  intercambiarCodigo, urlAutorizacion, tokenActivo,
  asegurarCarpetaRaiz, asegurarCarpetaEmpleado,
  asegurarCarpetaGarantia,
  subirArchivoADrive, eliminarArchivoDeDrive,
  CARPETA_RAIZ_NOMBRE, CARPETA_GARANTIAS_NOMBRE,
};
```

- [ ] **Step 4: Correr las pruebas (deben pasar)**

Run: `cd backend && npx node --test drive.test.js`
Expected: todas PASS (las viejas + 2 nuevas).

- [ ] **Step 5: Commit**

```bash
git add backend/drive.js backend/drive.test.js
git commit -m "feat: carpetas de Drive para comprobantes de garantías"
```

---

### Task 3: Quitar `costo_resolucion` del paso de Resolución

**Files:**
- Modify: `backend/garantias.js` (función `registrarResolucion`)
- Modify: `backend/garantias.test.js` (ajustar las pruebas que verifican `costo_resolucion`)

**Interfaces:**
- Cambia: `registrarResolucion(DB, id, { tipo_resolucion, notas }, usuario, alcance)` — ya NO acepta ni guarda `costo_resolucion`.

- [ ] **Step 1: Ajustar las pruebas de `garantias.test.js`**

En `backend/garantias.test.js`, editar las pruebas de resolución para que ya no esperen `costo_resolucion`:

En la prueba `"registrarResolucion (reparado): pasa a 'resuelta' y guarda el costo"`, cambiar su cuerpo para no pasar ni verificar costo, y renombrar el título:

```js
test("registrarResolucion (reparado): pasa a 'resuelta'", () => {
  const DB = construirDBPrueba();
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
  marcarEnviada(DB, g.id, { destino_tipo: "proveedor", destino_nombre: "Proveedor XYZ" }, USUARIO, ALCANCE_TODAS);

  const r = registrarResolucion(DB, g.id, { tipo_resolucion: "reparado", notas: "Cambió pastilla" }, USUARIO, ALCANCE_TODAS);

  assert.strictEqual(r.estado, "resuelta");
  assert.strictEqual(r.tipo_resolucion, "reparado");
  const movs = DB.inventario.garantia_movimientos.filter((m) => m.garantia_id === g.id);
  assert.strictEqual(movs[movs.length - 1].tipo, "resolucion");
});
```

En la prueba `"registrarResolucion (rechazada): cierra directo sin pasar por 'resuelta' y con costo null"`, quitar la aserción de `costo_resolucion` y el `costo_resolucion: 999` del input; dejar:

```js
test("registrarResolucion (rechazada): cierra directo sin pasar por 'resuelta'", () => {
  const DB = construirDBPrueba();
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
  marcarEnviada(DB, g.id, { destino_tipo: "proveedor", destino_nombre: "Proveedor XYZ" }, USUARIO, ALCANCE_TODAS);

  const r = registrarResolucion(DB, g.id, { tipo_resolucion: "rechazada", notas: "Mal uso" }, USUARIO, ALCANCE_TODAS);

  assert.strictEqual(r.estado, "cerrada");
});
```

(Las demás pruebas de resolución — `nota_credito`, tipo inválido, recibir, etc. — no pasan `costo_resolucion`, así que no requieren cambios.)

- [ ] **Step 2: Correr las pruebas para verificar el estado actual**

Run: `cd backend && npx node --test garantias.test.js`
Expected: las dos pruebas editadas aún PASAN (el código todavía acepta el costo pero ya no lo verificamos). Esto confirma que los tests quedaron consistentes antes de tocar el código.

- [ ] **Step 3: Quitar `costo_resolucion` de `registrarResolucion`**

En `backend/garantias.js`, en `registrarResolucion`, reemplazar el bloque que setea `costo_resolucion` y arma `costoTxt`:

Reemplazar:

```js
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
```

Por:

```js
  garantia.tipo_resolucion = tipo;
  garantia.notas_resolucion = datos.notas || null;

  if (TIPOS_CON_PRODUCTO.includes(tipo)) {
    garantia.estado = "resuelta";
  } else {
    // rechazada / nota_credito: no hay producto físico de vuelta — cierra directo
    garantia.estado = "cerrada";
  }

  pushMovimiento(DB, garantia, "resolucion", `Resuelta: ${tipo}`, usuario);
```

También quitar la inicialización de `costo_resolucion` en `crearGarantia` (la línea `costo_resolucion: null,` dentro del objeto `garantia`), ya que el campo deja de existir.

- [ ] **Step 4: Correr toda la suite de backend**

Run: `cd backend && npm test`
Expected: toda la suite PASS (incluye garantias.test.js y garantiasGastos.test.js).

- [ ] **Step 5: Commit**

```bash
git add backend/garantias.js backend/garantias.test.js
git commit -m "refactor: el costo de reparación deja de vivir en la Resolución (pasa a Gastos)"
```

---

### Task 4: Rutas Express de gastos (`server.js`)

**Files:**
- Modify: `backend/server.js`

**Interfaces:**
- Consumes: `agregarGasto`, `listarGastos`, `eliminarGasto` de `./garantiasGastos`; el módulo `drive` (`require("./drive")`); `requiereLogin`, `requierePermiso`, `resolverAlcance`, `resolverPermisosDeRol` (ya existentes).
- Produces: `GET/POST /api/garantias/:id/gastos`, `DELETE /api/garantias/:id/gastos/:gastoId`.

- [ ] **Step 1: Importar el módulo de gastos y el de drive**

En `backend/server.js`, junto al import de `./garantias` (líneas ~37-40), agregar:

```js
const { agregarGasto, listarGastos, eliminarGasto } = require("./garantiasGastos");
const drive = require("./drive");
```

(Si `drive` ya está importado en `server.js` para los expedientes de personal, reutilizar ese import y no duplicarlo. Verificar con: `grep -n "require(\"./drive\")" backend/server.js` — si ya existe, omitir esta línea del import de drive.)

- [ ] **Step 2: Agregar las 3 rutas**

En `backend/server.js`, justo después del bloque de rutas `// ---------- Garantías ----------` (después de `PUT /api/garantias/:id/entregar-cliente`), agregar:

```js
// ---------- Gastos de Garantía ----------
app.get("/api/garantias/:id/gastos", requiereLogin, requierePermiso("gestionar_garantias", resolverPermisosDeRol), (req, res) => {
  try {
    const alcance = resolverAlcance(req);
    res.json(listarGastos(DB, req.params.id, alcance));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/api/garantias/:id/gastos", requiereLogin, requierePermiso("gestionar_garantias", resolverPermisosDeRol), async (req, res) => {
  try {
    const alcance = resolverAlcance(req);
    const usuario = { id: req.usuarioToken.id, nombre: req.usuarioToken.nombre };
    const { tipo, monto, descripcion, nombre_archivo, tipo_mime, contenido_base64 } = req.body;
    const archivo = contenido_base64 ? { nombre_archivo, tipo_mime, contenido_base64 } : undefined;
    res.json(await agregarGasto(DB, req.params.id, { tipo, monto, descripcion, archivo }, usuario, alcance, drive));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.delete("/api/garantias/:id/gastos/:gastoId", requiereLogin, requierePermiso("gestionar_garantias", resolverPermisosDeRol), async (req, res) => {
  try {
    const alcance = resolverAlcance(req);
    const usuario = { id: req.usuarioToken.id, nombre: req.usuarioToken.nombre };
    res.json(await eliminarGasto(DB, req.params.id, req.params.gastoId, usuario, alcance, drive));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
```

- [ ] **Step 3: Verificar sintaxis y regresión**

Run: `cd backend && node --check server.js && npm test`
Expected: `node --check` sin errores; suite completa PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/server.js
git commit -m "feat: rutas REST de gastos de garantía (listar/agregar/eliminar)"
```

---

### Task 5: Frontend — modal de Gastos + quitar costo de Resolución (`src/Garantias.jsx`)

**Files:**
- Modify: `src/Garantias.jsx`

**Interfaces:**
- Consumes: rutas de Task 4 (`/garantias/:id/gastos`); `apiFetch` de `./api`; campo `total_gastos` en cada garantía (Task 1).

- [ ] **Step 1: Agregar el helper de base64, iconos, estado y constantes**

En `src/Garantias.jsx`, agregar al import de `lucide-react` los iconos `DollarSign`, `Upload`, `Trash2`, `FileText` (junto a los que ya se importan).

Después de las constantes de arriba (junto a `TIPOS_RESOLUCION`), agregar:

```jsx
const TIPOS_GASTO = [
  { valor: "traslado", etiqueta: "Traslado" },
  { valor: "reparacion", etiqueta: "Reparación" },
  { valor: "otro", etiqueta: "Otro" },
];
const ETIQUETA_TIPO_GASTO = { traslado: "Traslado", reparacion: "Reparación", otro: "Otro" };
const MIME_GASTO_OK = ["application/pdf", "image/jpeg", "image/png"];
const TAM_MAX_GASTO = 10 * 1024 * 1024;

function leerArchivoBase64(archivo) {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(String(lector.result).split(",")[1]);
    lector.onerror = reject;
    lector.readAsDataURL(archivo);
  });
}
const FORM_GASTO = { tipo: "traslado", monto: "", descripcion: "" };
```

Dentro del componente `Garantias`, junto a los otros `useState`, agregar:

```jsx
  const [modalGastos, setModalGastos] = useState(null); // garantía o null
  const [gastos, setGastos] = useState([]);
  const [formGasto, setFormGasto] = useState(FORM_GASTO);
  const [archivoGasto, setArchivoGasto] = useState(null); // File | null
```

- [ ] **Step 2: Agregar las funciones de carga/creación/borrado de gastos**

Dentro del componente, junto a las otras acciones, agregar:

```jsx
  const abrirGastos = async (g) => {
    setModalGastos(g);
    setFormGasto(FORM_GASTO);
    setArchivoGasto(null);
    try {
      const r = await apiFetch(`/garantias/${g.id}/gastos?sucursal_id=todas`);
      setGastos(await r.json());
    } catch { setGastos([]); mostrarAviso("❌ No se pudieron cargar los gastos"); }
  };

  const totalGastosModal = gastos.reduce((s, x) => s + Number(x.monto || 0), 0);

  const agregarGastoUI = async () => {
    const monto = Number(formGasto.monto);
    if (!Number.isFinite(monto) || monto <= 0) return mostrarAviso("El monto debe ser mayor que cero");
    let archivoPayload = {};
    if (archivoGasto) {
      if (!MIME_GASTO_OK.includes(archivoGasto.type)) return mostrarAviso("❌ Solo PDF, JPG o PNG");
      if (archivoGasto.size > TAM_MAX_GASTO) return mostrarAviso("❌ El archivo no puede pesar más de 10 MB");
      const contenido_base64 = await leerArchivoBase64(archivoGasto);
      archivoPayload = { nombre_archivo: archivoGasto.name, tipo_mime: archivoGasto.type, contenido_base64 };
    }
    try {
      const r = await apiFetch(`/garantias/${modalGastos.id}/gastos?sucursal_id=todas`, {
        method: "POST",
        body: JSON.stringify({ tipo: formGasto.tipo, monto, descripcion: formGasto.descripcion, ...archivoPayload }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      mostrarAviso("Gasto agregado");
      setFormGasto(FORM_GASTO);
      setArchivoGasto(null);
      const rl = await apiFetch(`/garantias/${modalGastos.id}/gastos?sucursal_id=todas`);
      setGastos(await rl.json());
      await cargarGarantias();
    } catch (e) { mostrarAviso("❌ " + e.message); }
  };

  const eliminarGastoUI = async (gastoId) => {
    try {
      const r = await apiFetch(`/garantias/${modalGastos.id}/gastos/${gastoId}?sucursal_id=todas`, { method: "DELETE" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      mostrarAviso("Gasto eliminado");
      const rl = await apiFetch(`/garantias/${modalGastos.id}/gastos?sucursal_id=todas`);
      setGastos(await rl.json());
      await cargarGarantias();
    } catch (e) { mostrarAviso("❌ " + e.message); }
  };
```

- [ ] **Step 3: Agregar el botón "Gastos" en cada fila**

En la celda de Acciones de la tabla (donde está el botón de "Historial"), agregar antes del de Historial, gateado por permiso:

```jsx
                      {puede("gestionar_garantias") && (
                        <button onClick={() => abrirGastos(g)} className="text-emerald-700 hover:text-emerald-900 text-xs px-2 py-1 rounded flex items-center gap-1"><DollarSign size={12} /> Gastos{g.total_gastos > 0 ? ` ($${Number(g.total_gastos).toFixed(2)})` : ""}</button>
                      )}
```

- [ ] **Step 4: Agregar el modal de Gastos**

Junto a los otros modales (p. ej. después del modal de Historial), agregar:

```jsx
      {modalGastos && (
        <Modal titulo={`Gastos — ${modalGastos.folio}`} onCerrar={() => setModalGastos(null)} ancho="max-w-2xl">
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between bg-slate-50 rounded px-3 py-2">
              <span className="text-sm text-slate-500">Total de gastos</span>
              <span className="text-lg font-semibold text-slate-800">${totalGastosModal.toFixed(2)}</span>
            </div>

            <div className="border border-slate-200 rounded divide-y divide-slate-100 max-h-56 overflow-y-auto">
              {gastos.length === 0 && <p className="text-slate-400 text-sm text-center py-6">Sin gastos registrados</p>}
              {gastos.map((x) => (
                <div key={x.id} className="flex items-center justify-between px-3 py-2 text-sm">
                  <div>
                    <span className="font-medium">{ETIQUETA_TIPO_GASTO[x.tipo] || x.tipo}</span>
                    <span className="text-slate-500"> — ${Number(x.monto).toFixed(2)}</span>
                    {x.descripcion ? <span className="text-slate-400"> · {x.descripcion}</span> : null}
                    {x.drive_link ? <a href={x.drive_link} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline ml-2 inline-flex items-center gap-1"><FileText size={11} /> Ver</a> : null}
                  </div>
                  <button onClick={() => eliminarGastoUI(x.id)} className="text-red-500 hover:text-red-700 p-1"><Trash2 size={14} /></button>
                </div>
              ))}
            </div>

            <div className="border-t border-slate-100 pt-3 flex flex-col gap-2">
              <div className="grid grid-cols-2 gap-2">
                <Campo label="Tipo">
                  <select className={inputCls} value={formGasto.tipo} onChange={(e) => setFormGasto({ ...formGasto, tipo: e.target.value })}>
                    {TIPOS_GASTO.map((t) => <option key={t.valor} value={t.valor}>{t.etiqueta}</option>)}
                  </select>
                </Campo>
                <Campo label="Monto">
                  <input type="number" min="0" step="0.01" className={inputCls} value={formGasto.monto} onChange={(e) => setFormGasto({ ...formGasto, monto: e.target.value })} placeholder="0.00" />
                </Campo>
              </div>
              <Campo label="Descripción (opcional)">
                <input className={inputCls} value={formGasto.descripcion} onChange={(e) => setFormGasto({ ...formGasto, descripcion: e.target.value })} placeholder="ej: flete de ida a Sensey" />
              </Campo>
              <Campo label="Comprobante (opcional — PDF/JPG/PNG, máx 10MB)">
                <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer border border-slate-300 rounded px-2.5 py-1.5 hover:bg-slate-50">
                  <Upload size={14} /> {archivoGasto ? archivoGasto.name : "Elegir archivo..."}
                  <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={(e) => setArchivoGasto(e.target.files?.[0] || null)} />
                </label>
              </Campo>
              <button onClick={agregarGastoUI} className="bg-emerald-600 hover:bg-emerald-700 text-white py-2 rounded font-semibold mt-1">Agregar gasto</button>
            </div>
          </div>
        </Modal>
      )}
```

- [ ] **Step 5: Quitar el campo de costo del modal de Resolución**

En el modal de "Registrar resolución", eliminar el bloque `{tipoResSeleccionado?.conProducto && ( <Campo label="Costo de la resolución...">...</Campo> )}` completo (el input de `costo_resolucion`). Dejar el selector de tipo, las notas y el botón. En la función `registrarResolucion` del frontend, quitar la línea que arma/borra `payload.costo_resolucion` (ya no se manda). El objeto `FORM_RESOLUCION` pierde la propiedad `costo_resolucion`.

- [ ] **Step 6: Verificar el build**

Run: `npm run build`
Expected: build exitoso (exit 0), sin errores.

- [ ] **Step 7: Commit**

```bash
git add src/Garantias.jsx
git commit -m "feat: modal de Gastos en Garantías y quitar el costo del paso de Resolución"
```

- [ ] **Step 8: Verificación manual en navegador (producción, tras desplegar)**

Con la app abierta y sesión iniciada: abrir una garantía → "Gastos" → agregar un gasto de traslado con monto y sin comprobante (ver que suma al total), agregar uno de reparación con un PDF (ver el link "Ver" al comprobante en Drive), borrar un gasto, y confirmar que el paso de "Resolución" ya no pide costo. Verificar que el total aparece junto al botón "Gastos" en la fila.

---

## Notas de cierre

- La Fase 2 (reporte "Gastos de Garantías") va en un plan aparte.
- Tras terminar esta fase: revisión de rama (whole-branch review) antes de mergear a master, según la regla del proyecto.
