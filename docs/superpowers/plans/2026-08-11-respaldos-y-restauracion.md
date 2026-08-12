# Respaldos y Punto de Restauración — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que CORPUNISOUND se respalde solo cada hora a Google Drive, cifrado, con 30 días de puntos de restauración para escoger, y que Victor pueda volver a cualquiera de ellos con una clave que solo él tiene.

**Architecture:** Un reloj dentro del backend que **no confía en el reloj sino en el registro** (se pregunta "¿cuánto hace que no respaldo?" cada 5 minutos, así un reinicio no deja huecos). El respaldo se arma → comprime → cifra → sube a Drive. La restauración exige permiso + alcance global + clave de Render + escribir `RESTAURAR`, y **se auto-respalda antes de tocar nada**. Módulo nuevo `respaldos`, el décimo del sistema.

**Tech Stack:** Node.js/CommonJS en `backend/`, `node --test` para pruebas, `crypto` y `zlib` nativos (sin dependencias nuevas), React 18 + Vite + Tailwind + shadcn en `src/`.

**Spec:** `docs/superpowers/specs/2026-08-11-respaldos-y-restauracion-design.md` (commit `2cff0a0`).

## Global Constraints

Estas reglas aplican a **todas** las tareas. Cada una salió de un bug real de este repo.

1. **Sin dependencias nuevas.** Todo con `crypto`, `zlib` y `fetch` nativos.
2. **Backend es CommonJS** (`require`/`module.exports`). El frontend es ESM. No mezclar.
3. **Pruebas con `node --test`** desde `backend/`: `const { test } = require("node:test"); const assert = require("node:assert");`. Archivo `backend/<nombre>.test.js`.
4. **Reservar identificadores SIEMPRE de forma síncrona**, sin ningún `await` entre leer y escribir el contador. Bug CRITICAL real del módulo de Gastos: dos capturas concurrentes recibieron el mismo folio porque el `push` ocurría después del `await` de Drive.
5. **Guard de alcance DENTRO del módulo**, nunca solo en la capa de rutas (patrón de `garantias.js`, mejor que el de `apartados.js`).
6. **Nunca resolver el alcance desde `?sucursal_id=`** para decidir a qué registro se tiene derecho. `apiFetch` (`src/api.js`) inyecta ese parámetro desde el selector del encabezado. Ya mordió tres veces. En este módulo **no hay alcance por sucursal**: los respaldos son globales y se protegen con `requiereAlcanceGlobal`.
7. **Fechas solas (`YYYY-MM-DD`) con `fechaLocal()`** de `backend/fechas.js`. Las marcas de tiempo completas siguen en UTC (`ahora()`).
8. **Todo módulo nuevo se registra en DOS archivos** o el backend no arranca: `MODULOS_SISTEMA` en `backend/permisosCatalogo.js` **y** `MODULOS_QUE_REQUIEREN_PERMISOS` en `backend/validarPermisos.js`. El guardia `validarSistemaDePermisos()` lo verifica.
9. **Cada botón con su permiso propio**, nunca prestado de otro módulo.
10. **`type="submit"` explícito** en botones de formulario (`@base-ui/react` mete `type="button"` por defecto).
11. **Modales con mucho contenido:** `max-h-[92vh] flex flex-col overflow-hidden` en el contenedor, `flex-1 min-h-0 overflow-y-auto` en el cuerpo, `shrink-0` en encabezado y pie.
12. **Ningún secreto** (`RESPALDO_LLAVE`, `CLAVE_RESTAURACION`, `TOKEN_DESCARGA_RESPALDOS`) se escribe en bitácora, log, respuesta HTTP ni Sentry. Nunca.
13. **Al probar una cifra derivada de una máquina de estados, el escenario debe cubrir TODOS los estados**, no solo los extremos.
14. **Verificación por mutación** en las pruebas de seguridad: quitar la protección debe poner la prueba en rojo. Si pasa con y sin la protección, no está probando nada.

### Forma del DB (verificada en `backend/server.js:107`)

```
DB.pos          → ventas, venta_detalle, vendedores, sucursales, condiciones_pago, cortes_caja, apartado_abonos
DB.crm          → clientes, contactos_cliente, oportunidades
DB.inventario   → existencias, movimientos_inventario, compras, compra_detalle, traspasos,
                  garantias, garantia_movimientos, garantia_gastos, productos, categorias,
                  proveedores, departamentos, producto_proveedor
DB.admin        → roles, usuarios, intentos_bloqueados_ubicacion, documentos_personal
DB.ml           → cuenta, publicaciones, ordenes_importadas
DB.drive        → cuenta
DB.gastos       → gastos, categorias, gasto_movimientos, ultimo_id
DB.cuenta_comun → depositos, deposito_movimientos, ultimo_id
```

**Los apartados NO son una colección**: son filas de `DB.pos.ventas` con `tipo_documento === "Apartado"`.

### Variables de entorno nuevas (Victor las configura en Render)

| Variable | Qué es | Si falta |
|---|---|---|
| `RESPALDO_LLAVE` | 64 caracteres hex (32 bytes) | **No se respalda nada** y se avisa en arranque y pantalla |
| `CLAVE_RESTAURACION` | Frase que Victor teclea para restaurar | **Restaurar queda apagado** (falla cerrado) |
| `TOKEN_DESCARGA_RESPALDOS` | Token largo para el script de la PC | La ruta de descarga responde 404 |

---

## Estructura de archivos

**Crear:**

| Archivo | Responsabilidad única |
|---|---|
| `backend/respaldoCifrado.js` | El formato del archivo: gzip + AES-256-GCM. No sabe de respaldos ni de Drive. |
| `backend/respaldoReloj.js` | `debeRespaldar()`: función pura que decide si toca respaldar y de qué tipo. |
| `backend/respaldos.js` | Orquesta: armar foto, crear, limpiar, verificar, restaurar. |
| `backend/respaldoCifrado.test.js` | |
| `backend/respaldoReloj.test.js` | |
| `backend/respaldos.test.js` | |
| `backend/respaldosRutas.test.js` | Le pega a las rutas REALES vía `require("./server")`. |
| `src/Respaldos.jsx` | La pantalla. |
| `scripts/respaldo-local.mjs` | El que corre en la PC de Victor. |
| `scripts/respaldo-local.cmd` | Envoltorio para la tarea programada de Windows. |
| `docs/RESPALDOS.md` | Instructivo para Victor. |

**Modificar:**

| Archivo | Qué cambia |
|---|---|
| `backend/fechas.js` | Agregar `momentoLocal()` |
| `backend/drive.js` | Agregar `asegurarCarpetaRespaldos`, `descargarArchivoDeDrive`, `listarArchivosEnCarpeta` |
| `backend/permisosCatalogo.js` | 2 permisos + módulo `respaldos` |
| `backend/validarPermisos.js` | `"respaldos"` en `MODULOS_QUE_REQUIEREN_PERMISOS` |
| `backend/server.js` | `DB.respaldos`, 6 rutas, arranque del reloj |
| `src/Dashboard.jsx` | Tile |
| `src/App.jsx` | Ruta de la vista |
| `src/EncabezadoModulo.jsx` | Título |

---

## Task 1: El formato del archivo de respaldo (cifrado)

**Files:**
- Create: `backend/respaldoCifrado.js`
- Test: `backend/respaldoCifrado.test.js`

**Interfaces:**
- Consumes: nada (módulo hoja, sin dependencias del proyecto)
- Produces:
  - `llaveDesdeEnv(env = process.env) → Buffer | null` — `null` si no está configurada; **lanza** si está mal formada
  - `empaquetar(objeto, llave) → Buffer` — JSON → gzip → AES-256-GCM
  - `desempaquetar(buffer, llave) → objeto`
  - `generarLlaveNueva() → string` (64 hex, para que Victor la genere)
  - `ALGORITMO`, `LARGO_IV`, `LARGO_TAG`

**Por qué GCM y no CBC:** GCM **autentica**. Si el archivo fue alterado o está corrupto, el descifrado **falla** en vez de devolver basura silenciosa. Ese es exactamente el desastre #3 del spec ("los datos se corrompen sin que nadie note").

- [ ] **Step 1: Escribir las pruebas que fallan**

Crear `backend/respaldoCifrado.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const {
  llaveDesdeEnv, empaquetar, desempaquetar, generarLlaveNueva, LARGO_IV, LARGO_TAG,
} = require("./respaldoCifrado");

const LLAVE = Buffer.from("a".repeat(64), "hex");
const OTRA_LLAVE = Buffer.from("b".repeat(64), "hex");

test("empaquetar y desempaquetar devuelve exactamente el mismo objeto", () => {
  const original = {
    pos: { ventas: [{ id: 1, total: 1234.56, cliente: "Ana Pérez" }] },
    crm: { clientes: [{ id: 1, nombre: "Café Yajalón", saldo: 0 }] },
    texto: "acentos: ñáéíóú — y símbolos $ % €",
    nulo: null, booleano: false, cero: 0,
  };
  const paquete = empaquetar(original, LLAVE);
  assert.ok(Buffer.isBuffer(paquete));
  assert.deepStrictEqual(desempaquetar(paquete, LLAVE), original);
});

test("el paquete NO contiene el texto en claro", () => {
  const paquete = empaquetar({ secreto: "CONTRASENA_DE_VICTOR" }, LLAVE);
  assert.ok(!paquete.toString("utf8").includes("CONTRASENA_DE_VICTOR"));
  assert.ok(!paquete.toString("latin1").includes("CONTRASENA_DE_VICTOR"));
});

test("con la llave equivocada FALLA — no devuelve basura", () => {
  const paquete = empaquetar({ a: 1 }, LLAVE);
  assert.throws(() => desempaquetar(paquete, OTRA_LLAVE), /no se pudo descifrar/);
});

test("un archivo alterado un solo byte FALLA (esto es lo que compra GCM)", () => {
  const paquete = empaquetar({ ventas: 100 }, LLAVE);
  const alterado = Buffer.from(paquete);
  alterado[alterado.length - 1] ^= 0x01;
  assert.throws(() => desempaquetar(alterado, LLAVE), /no se pudo descifrar/);
});

test("un archivo truncado FALLA con mensaje claro, no con un crash raro", () => {
  const paquete = empaquetar({ a: 1 }, LLAVE);
  assert.throws(() => desempaquetar(paquete.subarray(0, 10), LLAVE), /incompleto o dañado/);
});

test("dos paquetes del MISMO objeto son distintos (IV aleatorio por archivo)", () => {
  const a = empaquetar({ a: 1 }, LLAVE);
  const b = empaquetar({ a: 1 }, LLAVE);
  assert.notStrictEqual(a.toString("base64"), b.toString("base64"));
  assert.notStrictEqual(
    a.subarray(0, LARGO_IV).toString("hex"),
    b.subarray(0, LARGO_IV).toString("hex"),
  );
});

test("comprime: un objeto repetitivo pesa mucho menos que su JSON", () => {
  const grande = { filas: Array.from({ length: 2000 }, (_, i) => ({ id: i, nombre: "Producto de prueba", activo: true })) };
  const crudo = Buffer.byteLength(JSON.stringify(grande), "utf8");
  assert.ok(empaquetar(grande, LLAVE).length < crudo / 3, "debería comprimir al menos 3x");
});

test("llaveDesdeEnv devuelve null cuando no está configurada", () => {
  assert.strictEqual(llaveDesdeEnv({}), null);
  assert.strictEqual(llaveDesdeEnv({ RESPALDO_LLAVE: "" }), null);
});

test("llaveDesdeEnv LANZA si la llave está mal formada (no falla en silencio)", () => {
  assert.throws(() => llaveDesdeEnv({ RESPALDO_LLAVE: "corta" }), /64 caracteres hexadecimales/);
  assert.throws(() => llaveDesdeEnv({ RESPALDO_LLAVE: "z".repeat(64) }), /64 caracteres hexadecimales/);
});

test("llaveDesdeEnv acepta una llave válida y da 32 bytes", () => {
  const llave = llaveDesdeEnv({ RESPALDO_LLAVE: "a".repeat(64) });
  assert.strictEqual(llave.length, 32);
});

test("generarLlaveNueva produce 64 hex distintos cada vez", () => {
  const a = generarLlaveNueva();
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notStrictEqual(a, generarLlaveNueva());
});

test("una llave generada sirve para ida y vuelta", () => {
  const llave = llaveDesdeEnv({ RESPALDO_LLAVE: generarLlaveNueva() });
  assert.deepStrictEqual(desempaquetar(empaquetar({ ok: true }, llave), llave), { ok: true });
});
```

- [ ] **Step 2: Correr las pruebas y verificar que fallan**

Run: `cd backend && node --test respaldoCifrado.test.js`
Expected: FAIL — `Cannot find module './respaldoCifrado'`

- [ ] **Step 3: Escribir la implementación mínima**

Crear `backend/respaldoCifrado.js`:

```js
/**
 * respaldoCifrado.js — El FORMATO del archivo de respaldo, y nada más.
 *
 * No sabe qué se respalda, ni cuándo, ni a dónde se sube. Solo convierte un
 * objeto en un Buffer ilegible y de regreso.
 *
 * Orden: JSON -> gzip -> AES-256-GCM. Se comprime ANTES de cifrar porque lo
 * cifrado ya no se comprime (parece ruido).
 *
 * GCM y no CBC porque GCM AUTENTICA: si el archivo fue alterado o llegó
 * corrupto, descifrar FALLA en vez de devolver basura que parezca válida. Ese
 * es justo el desastre que se quiere atrapar — datos corrompidos sin que nadie
 * note. Un respaldo que se "restaura" con basura adentro es peor que no tener
 * respaldo.
 *
 * Formato del Buffer: [ IV (12 bytes) | tag de autenticación (16) | datos ]
 */

const crypto = require("crypto");
const zlib = require("zlib");

const ALGORITMO = "aes-256-gcm";
const LARGO_IV = 12;   // el recomendado para GCM
const LARGO_TAG = 16;
const LARGO_LLAVE_HEX = 64; // 32 bytes

/** Lee RESPALDO_LLAVE del entorno.
 *  - Ausente o vacía -> null (el sistema decide qué hacer y AVISA).
 *  - Presente pero mal formada -> LANZA. Una llave a medias es un error de
 *    configuración que hay que ver de inmediato: aceptarla en silencio dejaría
 *    respaldos ilegibles el día que se necesiten. */
function llaveDesdeEnv(env = process.env) {
  const hex = env.RESPALDO_LLAVE;
  if (!hex) return null;
  if (!new RegExp(`^[0-9a-fA-F]{${LARGO_LLAVE_HEX}}$`).test(hex)) {
    throw new Error(
      `RESPALDO_LLAVE debe ser ${LARGO_LLAVE_HEX} caracteres hexadecimales (32 bytes). ` +
      "Genera una nueva con: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
  return Buffer.from(hex, "hex");
}

function generarLlaveNueva() {
  return crypto.randomBytes(32).toString("hex");
}

function empaquetar(objeto, llave) {
  const comprimido = zlib.gzipSync(Buffer.from(JSON.stringify(objeto), "utf8"));
  const iv = crypto.randomBytes(LARGO_IV); // uno NUEVO por archivo, no reutilizable
  const cifrador = crypto.createCipheriv(ALGORITMO, llave, iv);
  const datos = Buffer.concat([cifrador.update(comprimido), cifrador.final()]);
  return Buffer.concat([iv, cifrador.getAuthTag(), datos]);
}

function desempaquetar(buffer, llave) {
  if (!Buffer.isBuffer(buffer) || buffer.length <= LARGO_IV + LARGO_TAG) {
    throw new Error("El archivo de respaldo está incompleto o dañado");
  }
  const iv = buffer.subarray(0, LARGO_IV);
  const tag = buffer.subarray(LARGO_IV, LARGO_IV + LARGO_TAG);
  const datos = buffer.subarray(LARGO_IV + LARGO_TAG);

  try {
    const descifrador = crypto.createDecipheriv(ALGORITMO, llave, iv);
    descifrador.setAuthTag(tag);
    const comprimido = Buffer.concat([descifrador.update(datos), descifrador.final()]);
    return JSON.parse(zlib.gunzipSync(comprimido).toString("utf8"));
  } catch (_) {
    // Se traga el error original A PROPÓSITO: su texto puede filtrar detalles
    // del criptosistema. Para quien lo lee, las tres causas se ven igual —
    // llave equivocada, archivo alterado, archivo corrupto — y la acción es la
    // misma: ese respaldo no sirve, usa otro.
    throw new Error("El respaldo no se pudo descifrar — llave incorrecta o archivo dañado");
  }
}

module.exports = {
  llaveDesdeEnv, generarLlaveNueva, empaquetar, desempaquetar,
  ALGORITMO, LARGO_IV, LARGO_TAG,
};
```

- [ ] **Step 4: Correr las pruebas y verificar que pasan**

Run: `cd backend && node --test respaldoCifrado.test.js`
Expected: PASS — 12 pruebas.

- [ ] **Step 5: Verificación por mutación del candado de GCM**

Cambiar temporalmente `ALGORITMO` a `"aes-256-cbc"` y quitar las dos líneas de tag. Correr las pruebas.
Expected: la prueba "un archivo alterado un solo byte FALLA" se pone **roja** (CBC no detecta la alteración).
**Revertir el cambio** y confirmar que vuelven a pasar las 12.

- [ ] **Step 6: Commit**

```bash
git add backend/respaldoCifrado.js backend/respaldoCifrado.test.js
git commit -m "feat(respaldos): formato de archivo cifrado y comprimido (gzip + AES-256-GCM)"
```

---

## Task 2: El reloj que confía en el registro, no en la hora

**Files:**
- Modify: `backend/fechas.js` (agregar `momentoLocal`)
- Create: `backend/respaldoReloj.js`
- Test: `backend/respaldoReloj.test.js`

**Interfaces:**
- Consumes: `ZONA_TIENDA` de `backend/fechas.js`
- Produces:
  - `momentoLocal(instante) → { fecha: "YYYY-MM-DD", hora: number, minuto: number, hhmm: "HH:MM" }` (exportada desde `fechas.js`)
  - `debeRespaldar(estadoRespaldos, ahoraMs = Date.now()) → { respaldar: boolean, tipo: "hora"|"dia"|null, motivo: string }`
  - `UNA_HORA_MS`, `HORAS_PUNTO_DIA` (`[16, 17]`), `INTERVALO_REVISION_MS` (5 min)

**El corazón del diseño.** No se programa "a las 3:00 en punto". Se pregunta *"¿cuánto hace que no respaldo?"*. Por eso un reinicio, un redespliegue o un servidor ocupado no dejan huecos: al volver, el proceso se da cuenta de que va atrasado y se pone al corriente solo. Es una **función pura** — se prueba entera sin tocar red, disco ni relojes reales.

- [ ] **Step 1: Escribir la prueba que falla para `momentoLocal`**

Agregar al final de `backend/fechas.test.js`:

```js
const { momentoLocal } = require("./fechas");

test("momentoLocal da la hora de Chiapas, no la de UTC", () => {
  // 2026-08-11 22:30 UTC = 2026-08-11 16:30 en Chiapas (UTC-6)
  const m = momentoLocal("2026-08-11T22:30:00.000Z");
  assert.strictEqual(m.fecha, "2026-08-11");
  assert.strictEqual(m.hora, 16);
  assert.strictEqual(m.minuto, 30);
  assert.strictEqual(m.hhmm, "16:30");
});

test("momentoLocal cruza bien el cambio de día", () => {
  // 2026-08-12 03:00 UTC = 2026-08-11 21:00 en Chiapas: sigue siendo día 11
  const m = momentoLocal("2026-08-12T03:00:00.000Z");
  assert.strictEqual(m.fecha, "2026-08-11");
  assert.strictEqual(m.hora, 21);
});

test("momentoLocal acepta milisegundos además de ISO", () => {
  const ms = Date.parse("2026-08-11T22:00:00.000Z");
  assert.strictEqual(momentoLocal(ms).hhmm, "16:00");
});

test("momentoLocal rellena la hora con cero a la izquierda", () => {
  // 2026-08-11 14:05 UTC = 08:05 en Chiapas
  assert.strictEqual(momentoLocal("2026-08-11T14:05:00.000Z").hhmm, "08:05");
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd backend && node --test fechas.test.js`
Expected: FAIL — `momentoLocal is not a function`

- [ ] **Step 3: Implementar `momentoLocal`**

En `backend/fechas.js`, agregar antes del `module.exports`:

```js
// Igual que `formateador` pero con hora y minuto. hourCycle "h23" evita el
// "24:00" que en-CA produce a medianoche con hour12:false.
const formateadorMomento = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONA_TIENDA,
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

/**
 * Fecha Y hora de la tienda, ya partidas. Lo usa el reloj de respaldos para
 * saber si son las 4 o las 5 de la tarde EN CHIAPAS — no en UTC, que es donde
 * corre Render. Sin esto, los "puntos del día" caerían a las 10 de la mañana.
 *
 * Acepta Date, string ISO, milisegundos, o nada (= ahora).
 */
function momentoLocal(instante) {
  const d = instante === undefined || instante === null ? new Date() : new Date(instante);
  const valido = isNaN(d.getTime()) ? new Date() : d;
  const partes = Object.fromEntries(
    formateadorMomento.formatToParts(valido).map((p) => [p.type, p.value])
  );
  const hora = Number(partes.hour);
  const minuto = Number(partes.minute);
  return {
    fecha: `${partes.year}-${partes.month}-${partes.day}`,
    hora, minuto,
    hhmm: `${partes.hour}:${partes.minute}`,
  };
}
```

Y cambiar el export a: `module.exports = { fechaLocal, ahora, momentoLocal, ZONA_TIENDA };`

- [ ] **Step 4: Correr y verificar que pasa**

Run: `cd backend && node --test fechas.test.js`
Expected: PASS

- [ ] **Step 5: Escribir las pruebas que fallan del reloj**

Crear `backend/respaldoReloj.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { debeRespaldar, UNA_HORA_MS, HORAS_PUNTO_DIA } = require("./respaldoReloj");

// 2026-08-11 19:00 UTC = 13:00 en Chiapas (hora normal, NO punto del día)
const T_13H = Date.parse("2026-08-11T19:00:00.000Z");
// 2026-08-11 22:00 UTC = 16:00 en Chiapas (punto del día)
const T_16H = Date.parse("2026-08-11T22:00:00.000Z");
// 2026-08-11 23:00 UTC = 17:00 en Chiapas (punto del día)
const T_17H = Date.parse("2026-08-11T23:00:00.000Z");

const vacio = { ultimo_exitoso: null, copias: [] };

test("sin respaldos previos, respalda", () => {
  const r = debeRespaldar(vacio, T_13H);
  assert.strictEqual(r.respaldar, true);
  assert.strictEqual(r.tipo, "hora");
});

test("a los 30 minutos del último, NO respalda", () => {
  const estado = { ultimo_exitoso: new Date(T_13H - 30 * 60_000).toISOString(), copias: [] };
  assert.strictEqual(debeRespaldar(estado, T_13H).respaldar, false);
});

test("a los 61 minutos, SÍ respalda", () => {
  const estado = { ultimo_exitoso: new Date(T_13H - 61 * 60_000).toISOString(), copias: [] };
  assert.strictEqual(debeRespaldar(estado, T_13H).respaldar, true);
});

test("exactamente a la hora, respalda (el borde cuenta)", () => {
  const estado = { ultimo_exitoso: new Date(T_13H - UNA_HORA_MS).toISOString(), copias: [] };
  assert.strictEqual(debeRespaldar(estado, T_13H).respaldar, true);
});

test("a las 4 pm de Chiapas el tipo es 'dia', no 'hora'", () => {
  assert.strictEqual(debeRespaldar(vacio, T_16H).tipo, "dia");
});

test("a las 5 pm de Chiapas el tipo también es 'dia'", () => {
  assert.strictEqual(debeRespaldar(vacio, T_17H).tipo, "dia");
});

test("a las 4 pm UTC (10 am en Chiapas) el tipo NO es 'dia'", () => {
  // La trampa de zona horaria que este repo ya pagó una vez con las fechas.
  const t = Date.parse("2026-08-11T16:00:00.000Z");
  assert.strictEqual(debeRespaldar(vacio, t).tipo, "hora");
});

test("el punto del día se toma aunque falten minutos para la hora completa", () => {
  // Reinició a las 15:59 y respaldó. A las 16:05 solo pasaron 6 minutos, pero
  // el punto de las 4 pm NO se puede perder: es de los que se guardan 30 días.
  const estado = { ultimo_exitoso: new Date(T_16H - 6 * 60_000).toISOString(), copias: [] };
  const r = debeRespaldar(estado, T_16H + 5 * 60_000);
  assert.strictEqual(r.respaldar, true);
  assert.strictEqual(r.tipo, "dia");
});

test("el punto del día NO se repite si ya existe el de esa hora", () => {
  const estado = {
    ultimo_exitoso: new Date(T_16H).toISOString(),
    copias: [{ tipo: "dia", fecha: "2026-08-11", hora_local: "16:00", estado: "ok" }],
  };
  const r = debeRespaldar(estado, T_16H + 20 * 60_000);
  assert.strictEqual(r.respaldar, false);
});

test("las 5 pm se toma aunque las 4 pm ya esté hecha (son dos puntos distintos)", () => {
  const estado = {
    ultimo_exitoso: new Date(T_16H).toISOString(),
    copias: [{ tipo: "dia", fecha: "2026-08-11", hora_local: "16:00", estado: "ok" }],
  };
  const r = debeRespaldar(estado, T_17H);
  assert.strictEqual(r.respaldar, true);
  assert.strictEqual(r.tipo, "dia");
});

test("una copia FALLIDA del punto del día no cuenta como hecha", () => {
  const estado = {
    ultimo_exitoso: new Date(T_16H - 5 * 60_000).toISOString(),
    copias: [{ tipo: "dia", fecha: "2026-08-11", hora_local: "16:00", estado: "fallido" }],
  };
  assert.strictEqual(debeRespaldar(estado, T_16H).respaldar, true);
});

test("el punto del día de AYER no bloquea el de hoy", () => {
  const estado = {
    ultimo_exitoso: new Date(T_16H - 3 * 60_000).toISOString(),
    copias: [{ tipo: "dia", fecha: "2026-08-10", hora_local: "16:00", estado: "ok" }],
  };
  assert.strictEqual(debeRespaldar(estado, T_16H).respaldar, true);
});

test("tres reinicios en el mismo minuto NO hacen tres respaldos", () => {
  const estado = { ultimo_exitoso: new Date(T_13H).toISOString(), copias: [] };
  assert.strictEqual(debeRespaldar(estado, T_13H + 1000).respaldar, false);
  assert.strictEqual(debeRespaldar(estado, T_13H + 2000).respaldar, false);
  assert.strictEqual(debeRespaldar(estado, T_13H + 3000).respaldar, false);
});

test("un ultimo_exitoso corrupto no paraliza los respaldos", () => {
  // Falla ABIERTO a propósito: ante una fecha basura, respaldar de más es
  // inofensivo; no respaldar es el desastre que este módulo existe para evitar.
  const estado = { ultimo_exitoso: "no-es-una-fecha", copias: [] };
  assert.strictEqual(debeRespaldar(estado, T_13H).respaldar, true);
});

test("un estado ausente no truena", () => {
  assert.strictEqual(debeRespaldar(undefined, T_13H).respaldar, true);
  assert.strictEqual(debeRespaldar(null, T_13H).respaldar, true);
});

test("HORAS_PUNTO_DIA son las 4 y 5 de la tarde que pidió Victor", () => {
  assert.deepStrictEqual(HORAS_PUNTO_DIA, [16, 17]);
});
```

- [ ] **Step 6: Correr y verificar que falla**

Run: `cd backend && node --test respaldoReloj.test.js`
Expected: FAIL — `Cannot find module './respaldoReloj'`

- [ ] **Step 7: Implementar el reloj**

Crear `backend/respaldoReloj.js`:

```js
/**
 * respaldoReloj.js — Decide CUÁNDO toca respaldar. Nada más.
 *
 * Función pura: recibe el estado guardado y la hora, devuelve un veredicto. No
 * toca red, ni disco, ni Date.now() por su cuenta. Por eso se prueba entera.
 *
 * LA IDEA CENTRAL: no confía en el reloj, confía en el REGISTRO. No se programa
 * "a las 3:00 en punto" — se pregunta "¿cuánto hace que no respaldo?". Con un
 * horario fijo, un redespliegue a las 2:59 se come el respaldo de las 3 y nadie
 * se entera hasta que hace falta. Preguntando por el atraso, el proceso se pone
 * al corriente solo en cuanto vuelve a estar vivo.
 */

const { momentoLocal } = require("./fechas");

const UNA_HORA_MS = 60 * 60 * 1000;
/** Las horas (de Chiapas) cuyo respaldo se marca como punto de restauración del
 *  día y se conserva 30 días. Las pidió Victor así. */
const HORAS_PUNTO_DIA = [16, 17];
/** Cada cuánto se hace la pregunta. Más fino que la hora a propósito: así el
 *  atraso tras un reinicio se corrige en minutos, no en una hora. */
const INTERVALO_REVISION_MS = 5 * 60 * 1000;

function yaExistePuntoDelDia(copias, fecha, hora) {
  return (copias || []).some(
    (c) =>
      c &&
      c.tipo === "dia" &&
      c.fecha === fecha &&
      c.estado === "ok" &&
      Number(String(c.hora_local).slice(0, 2)) === hora
  );
}

/**
 * @param {object} estado  DB.respaldos ({ ultimo_exitoso, copias })
 * @param {number} ahoraMs milisegundos
 * @returns {{respaldar: boolean, tipo: "hora"|"dia"|null, motivo: string}}
 */
function debeRespaldar(estado, ahoraMs = Date.now()) {
  const m = momentoLocal(ahoraMs);
  const esPuntoDia = HORAS_PUNTO_DIA.includes(m.hora);
  const tipo = esPuntoDia ? "dia" : "hora";
  const copias = estado?.copias || [];

  // 1) Un punto del día que todavía no existe se toma AUNQUE no haya pasado la
  //    hora completa. Si el proceso respaldó a las 15:59 por un reinicio, la
  //    regla general dejaría pasar las 4 pm — y ese es de los que se guardan 30
  //    días, no uno cualquiera.
  if (esPuntoDia && !yaExistePuntoDelDia(copias, m.fecha, m.hora)) {
    return { respaldar: true, tipo: "dia", motivo: `punto del día de las ${m.hhmm}` };
  }

  // 2) Regla general: ¿pasó una hora desde el último respaldo que SÍ subió?
  const ultimo = estado?.ultimo_exitoso ? Date.parse(estado.ultimo_exitoso) : NaN;
  if (!Number.isFinite(ultimo)) {
    // Sin registro válido (primer arranque, o dato corrupto) se respalda. Falla
    // ABIERTO a propósito: una copia de más no le hace daño a nadie; una de
    // menos es exactamente el desastre que este módulo existe para evitar.
    return { respaldar: true, tipo, motivo: "sin registro de respaldo previo" };
  }

  const transcurrido = ahoraMs - ultimo;
  if (transcurrido >= UNA_HORA_MS) {
    const minutos = Math.floor(transcurrido / 60000);
    return { respaldar: true, tipo, motivo: `${minutos} minutos desde el último respaldo` };
  }

  return { respaldar: false, tipo: null, motivo: "al corriente" };
}

module.exports = { debeRespaldar, UNA_HORA_MS, HORAS_PUNTO_DIA, INTERVALO_REVISION_MS };
```

- [ ] **Step 8: Correr y verificar que pasa**

Run: `cd backend && node --test respaldoReloj.test.js fechas.test.js`
Expected: PASS — 16 + 4 pruebas nuevas.

- [ ] **Step 9: Verificación por mutación de la regla del punto del día**

Borrar temporalmente el bloque `if (esPuntoDia && !yaExistePuntoDelDia(...))`. Correr.
Expected: **roja** la prueba "el punto del día se toma aunque falten minutos para la hora completa".
**Revertir** y confirmar verde.

- [ ] **Step 10: Commit**

```bash
git add backend/respaldoReloj.js backend/respaldoReloj.test.js backend/fechas.js backend/fechas.test.js
git commit -m "feat(respaldos): reloj que confia en el registro y no en la hora, con punto del dia 4pm/5pm"
```

---

## Task 3: Armar y subir el respaldo

**Files:**
- Modify: `backend/drive.js` (agregar `asegurarCarpetaRespaldos` y su constante)
- Create: `backend/respaldos.js`
- Test: `backend/respaldos.test.js`

**Interfaces:**
- Consumes: `empaquetar`, `llaveDesdeEnv` (Task 1); `debeRespaldar` (Task 2); `fechaLocal`, `ahora`, `momentoLocal` (`fechas.js`)
- Produces:
  - `COLECCIONES_RESPALDADAS: string[]` — `["pos","crm","inventario","admin","ml","drive","gastos","cuenta_comun"]`
  - `VERSION_FORMATO = 1`
  - `contarRegistros(DB) → objeto de conteos`
  - `armarFoto(DB, tipo) → objeto listo para empaquetar`
  - `crearRespaldo(DB, drive, { tipo, llave }) → registro de copia`
  - `estadoRespaldos(DB) → { conectado, ultimo_exitoso, minutos_desde_ultimo, alerta, copias }`
  - `nuevoEstadoRespaldos() → objeto para `DB.respaldos``
- Produces en `drive.js`: `asegurarCarpetaRespaldos(DB) → id`, `CARPETA_RESPALDOS_NOMBRE`

- [ ] **Step 1: Agregar la carpeta de Drive**

En `backend/drive.js`, junto a las otras constantes de carpeta (línea ~24):

```js
const CARPETA_RESPALDOS_NOMBRE = "Respaldos del Sistema";
```

Y junto a las otras funciones `asegurarCarpeta*`:

```js
/** Carpeta raíz de los respaldos automáticos. Aparte de los comprobantes a
 *  propósito: son cosas distintas y Victor las va a mirar por separado. */
async function asegurarCarpetaRespaldos(DB) {
  if (DB.respaldos?.carpeta_drive_id) return DB.respaldos.carpeta_drive_id;
  let id = await buscarCarpeta(DB, CARPETA_RESPALDOS_NOMBRE, null);
  if (!id) id = await crearCarpeta(DB, CARPETA_RESPALDOS_NOMBRE, null);
  if (DB.respaldos) DB.respaldos.carpeta_drive_id = id;
  return id;
}
```

Agregar a `module.exports`: `asegurarCarpetaRespaldos, CARPETA_RESPALDOS_NOMBRE,`

- [ ] **Step 2: Escribir las pruebas que fallan**

Crear `backend/respaldos.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const {
  crearRespaldo, armarFoto, contarRegistros, nuevoEstadoRespaldos,
  estadoRespaldos, COLECCIONES_RESPALDADAS, VERSION_FORMATO,
} = require("./respaldos");
const { desempaquetar } = require("./respaldoCifrado");

const LLAVE = Buffer.from("a".repeat(64), "hex");

function driveFalso() {
  const subidos = [];
  return {
    subidos,
    asegurarCarpetaRespaldos: async () => "carpeta-respaldos",
    subirArchivoADrive: async (_DB, args) => {
      subidos.push(args);
      return { id: `file-${subidos.length}`, webViewLink: `https://drive/f${subidos.length}` };
    },
    eliminarArchivoDeDrive: async () => {},
  };
}

function nuevoDB() {
  return {
    pos: {
      ventas: [
        { id: 1, total: 100, tipo_documento: "Ticket" },
        { id: 2, total: 200, tipo_documento: "Apartado" },
      ],
      venta_detalle: [], vendedores: [], sucursales: [{ id: 1, nombre: "Ocosingo" }],
      condiciones_pago: [], cortes_caja: [{ id: 1 }], apartado_abonos: [],
    },
    crm: { clientes: [{ id: 1, nombre: "Ana" }], contactos_cliente: [], oportunidades: [] },
    inventario: {
      existencias: [], movimientos_inventario: [], compras: [], compra_detalle: [],
      traspasos: [], garantias: [{ id: 1 }], garantia_movimientos: [], garantia_gastos: [],
      productos: [{ id: 1, nombre: "Guitarra" }], categorias: [], proveedores: [],
      departamentos: [], producto_proveedor: [],
    },
    admin: { roles: [], usuarios: [{ id: 1, usuario: "victor" }], intentos_bloqueados_ubicacion: [], documentos_personal: [] },
    ml: { cuenta: null, publicaciones: [], ordenes_importadas: [] },
    drive: { cuenta: null },
    gastos: { gastos: [{ id: 1 }], categorias: [], gasto_movimientos: [], ultimo_id: 1 },
    cuenta_comun: { depositos: [{ id: 1 }], deposito_movimientos: [], ultimo_id: 1 },
    respaldos: nuevoEstadoRespaldos(),
  };
}

test("contarRegistros cuenta apartados como ventas con tipo_documento Apartado", () => {
  const c = contarRegistros(nuevoDB());
  assert.strictEqual(c.ventas, 2);
  assert.strictEqual(c.apartados, 1);
  assert.strictEqual(c.productos, 1);
  assert.strictEqual(c.clientes, 1);
  assert.strictEqual(c.gastos, 1);
  assert.strictEqual(c.garantias, 1);
  assert.strictEqual(c.depositos, 1);
  assert.strictEqual(c.cortes, 1);
  assert.strictEqual(c.usuarios, 1);
});

test("contarRegistros no truena con un DB incompleto", () => {
  assert.strictEqual(contarRegistros({}).ventas, 0);
});

test("armarFoto incluye TODAS las colecciones de negocio", () => {
  const foto = armarFoto(nuevoDB(), "hora");
  for (const clave of COLECCIONES_RESPALDADAS) {
    assert.ok(foto.datos[clave] !== undefined, `falta la colección ${clave}`);
  }
  assert.strictEqual(foto.version_formato, VERSION_FORMATO);
});

test("armarFoto NO incluye DB.respaldos (el índice no se respalda a sí mismo)", () => {
  assert.strictEqual(armarFoto(nuevoDB(), "hora").datos.respaldos, undefined);
  assert.ok(!COLECCIONES_RESPALDADAS.includes("respaldos"));
});

test("crearRespaldo sube a Drive y registra la copia", async () => {
  const DB = nuevoDB();
  const drive = driveFalso();
  const copia = await crearRespaldo(DB, drive, { tipo: "hora", llave: LLAVE });

  assert.strictEqual(DB.respaldos.copias.length, 1);
  assert.strictEqual(copia.estado, "ok");
  assert.strictEqual(copia.tipo, "hora");
  assert.strictEqual(copia.drive_file_id, "file-1");
  assert.ok(copia.bytes > 0);
  assert.strictEqual(copia.conteos.ventas, 2);
  assert.match(copia.nombre_archivo, /^unisound-\d{4}-\d{2}-\d{2}-\d{4}\.respaldo$/);
  assert.strictEqual(DB.respaldos.ultimo_exitoso, copia.fecha_hora);
});

test("lo que se sube a Drive se puede descifrar y trae los datos reales", async () => {
  const DB = nuevoDB();
  const drive = driveFalso();
  await crearRespaldo(DB, drive, { tipo: "hora", llave: LLAVE });

  const foto = desempaquetar(drive.subidos[0].contenidoBuffer, LLAVE);
  assert.strictEqual(foto.datos.pos.ventas.length, 2);
  assert.strictEqual(foto.datos.crm.clientes[0].nombre, "Ana");
  assert.strictEqual(foto.version_formato, VERSION_FORMATO);
});

test("el nombre del archivo lleva la fecha y hora EN CLARO", async () => {
  const DB = nuevoDB();
  const drive = driveFalso();
  const copia = await crearRespaldo(DB, drive, { tipo: "dia", llave: LLAVE });
  assert.ok(drive.subidos[0].nombre.includes(copia.fecha.replace(/-/g, "-")));
});

test("cada respaldo se VERIFICA antes de subir: un empaquetado roto no sube", async () => {
  const DB = nuevoDB();
  const drive = driveFalso();
  // Llave de 31 bytes: crypto revienta al cifrar, antes de tocar Drive.
  await assert.rejects(
    () => crearRespaldo(DB, drive, { tipo: "hora", llave: Buffer.alloc(31) }),
  );
  assert.strictEqual(drive.subidos.length, 0, "no debió subir nada");
});

test("si Drive falla, la copia queda marcada como fallida y NO se mueve ultimo_exitoso", async () => {
  const DB = nuevoDB();
  const drive = driveFalso();
  drive.subirArchivoADrive = async () => { throw new Error("Drive caído"); };

  await assert.rejects(() => crearRespaldo(DB, drive, { tipo: "hora", llave: LLAVE }), /Drive caído/);
  assert.strictEqual(DB.respaldos.ultimo_exitoso, null);
  assert.strictEqual(DB.respaldos.copias.length, 1);
  assert.strictEqual(DB.respaldos.copias[0].estado, "fallido");
});

test("los ids son únicos aunque se creen 12 respaldos concurrentes", async () => {
  const DB = nuevoDB();
  const drive = driveFalso();
  const copias = await Promise.all(
    Array.from({ length: 12 }, () => crearRespaldo(DB, drive, { tipo: "hora", llave: LLAVE }))
  );
  const ids = copias.map((c) => c.id);
  assert.strictEqual(new Set(ids).size, 12, "hubo ids repetidos — carrera de folio");
  const nombres = copias.map((c) => c.nombre_archivo);
  assert.strictEqual(new Set(nombres).size, 12, "hubo nombres repetidos");
});

test("estadoRespaldos avisa en VERDE cuando está al corriente", () => {
  const DB = nuevoDB();
  DB.respaldos.ultimo_exitoso = new Date(Date.now() - 20 * 60_000).toISOString();
  const e = estadoRespaldos(DB);
  assert.strictEqual(e.alerta, false);
  assert.strictEqual(e.minutos_desde_ultimo, 20);
});

test("estadoRespaldos avisa en ROJO tras más de 2 horas sin respaldar", () => {
  const DB = nuevoDB();
  DB.respaldos.ultimo_exitoso = new Date(Date.now() - 4 * 60 * 60_000).toISOString();
  assert.strictEqual(estadoRespaldos(DB).alerta, true);
});

test("estadoRespaldos sin ningún respaldo está en ROJO, no en verde", () => {
  const e = estadoRespaldos(nuevoDB());
  assert.strictEqual(e.alerta, true);
  assert.strictEqual(e.ultimo_exitoso, null);
});
```

- [ ] **Step 3: Correr y verificar que falla**

Run: `cd backend && node --test respaldos.test.js`
Expected: FAIL — `Cannot find module './respaldos'`

- [ ] **Step 4: Implementar `backend/respaldos.js`**

```js
/**
 * respaldos.js — Foto completa del negocio, cifrada, en Google Drive.
 *
 * Patrón de gastos.js / depositos.js: funciones planas que reciben DB, bitácora
 * propia, contador SÍNCRONO. Aquí NO hay alcance por sucursal: un respaldo es de
 * toda la empresa. Lo que protege estas operaciones es requiereAlcanceGlobal en
 * la capa de rutas más la clave de restauración.
 *
 * Lo que se respalda es el JSON completo del DB (que es como ya vive en SQLite,
 * ver persistencia.js), MENOS DB.respaldos: el índice no se respalda a sí mismo.
 * Restaurar un índice viejo borraría de la vista los respaldos hechos después de
 * esa foto — incluido el pre_restauracion que acaba de salvar el pellejo.
 *
 * El catálogo del SAT NO entra: vive en su propia tabla de SQLite (claves_sat),
 * es público y se reimporta solo al arrancar. Meterlo multiplicaría por diez el
 * peso de cada archivo sin ganar nada.
 */

const { empaquetar } = require("./respaldoCifrado");
const { fechaLocal, ahora, momentoLocal } = require("./fechas");

const VERSION_FORMATO = 1;

/** Las llaves de primer nivel de DB que SÍ se respaldan. Ver server.js:107. */
const COLECCIONES_RESPALDADAS = [
  "pos", "crm", "inventario", "admin", "ml", "drive", "gastos", "cuenta_comun",
];

/** Sin respaldo en este tiempo, la pantalla se pone roja. Dos horas y no una:
 *  el ciclo es de una hora y un reintento no debe pintar alarma. */
const MINUTOS_PARA_ALERTA = 120;

function nuevoEstadoRespaldos() {
  return {
    copias: [], movimientos: [], ultimo_id: 0,
    ultimo_exitoso: null, ultimo_intento: null, carpeta_drive_id: null,
  };
}

function siguienteId(lista) {
  return lista.length ? Math.max(...lista.map((x) => x.id)) + 1 : 1;
}

/** Contador SÍNCRONO. Se reserva ANTES de cualquier await — la lección del bug
 *  CRITICAL de Gastos, donde dos capturas concurrentes recibieron el mismo folio
 *  porque el push ocurría después del await de Drive. */
function reservarSiguienteId(DB) {
  const maxExistente = DB.respaldos.copias.reduce((m, c) => Math.max(m, c.id), 0);
  DB.respaldos.ultimo_id = Math.max(DB.respaldos.ultimo_id || 0, maxExistente) + 1;
  return DB.respaldos.ultimo_id;
}

function pushMovimiento(DB, copiaId, tipo, descripcion, usuario) {
  DB.respaldos.movimientos.push({
    id: siguienteId(DB.respaldos.movimientos),
    respaldo_id: copiaId, fecha: ahora(),
    usuario: usuario?.nombre || "sistema",
    tipo, descripcion: descripcion || "",
  });
}

/** Los conteos que van en la etiqueta del archivo. Sirven para dos cosas
 *  concretas: detectar un archivo corrupto sin abrirlo entero, y decirle a
 *  Victor QUÉ va a restaurar antes de que apriete. */
function contarRegistros(DB) {
  const ventas = DB?.pos?.ventas || [];
  return {
    ventas: ventas.length,
    // Los apartados no son colección propia: son ventas marcadas.
    apartados: ventas.filter((v) => v && v.tipo_documento === "Apartado").length,
    cortes: DB?.pos?.cortes_caja?.length || 0,
    productos: DB?.inventario?.productos?.length || 0,
    garantias: DB?.inventario?.garantias?.length || 0,
    clientes: DB?.crm?.clientes?.length || 0,
    gastos: DB?.gastos?.gastos?.length || 0,
    depositos: DB?.cuenta_comun?.depositos?.length || 0,
    usuarios: DB?.admin?.usuarios?.length || 0,
  };
}

function armarFoto(DB, tipo) {
  const datos = {};
  for (const clave of COLECCIONES_RESPALDADAS) {
    if (DB[clave] !== undefined) datos[clave] = DB[clave];
  }
  const instante = ahora();
  return {
    version_formato: VERSION_FORMATO,
    generado_en: instante,
    fecha_local: fechaLocal(instante),
    tipo,
    conteos: contarRegistros(DB),
    datos,
  };
}

/**
 * Arma, cifra, VERIFICA, sube y registra. En ese orden.
 *
 * La copia se registra ANTES de subir (con estado "fallido") para que una caída
 * de Drive deje rastro visible en la pantalla en vez de desaparecer sin ruido.
 * Solo pasa a "ok" cuando Drive confirmó.
 */
async function crearRespaldo(DB, drive, { tipo = "hora", llave, usuario = null } = {}) {
  if (!llave) throw new Error("RESPALDO_LLAVE no está configurada — no se puede respaldar");

  const foto = armarFoto(DB, tipo);
  const paquete = empaquetar(foto, llave); // si esto revienta, no se toca Drive

  const m = momentoLocal(foto.generado_en);
  // Reserva SÍNCRONA, antes del primer await.
  const id = reservarSiguienteId(DB);
  const nombre_archivo = `unisound-${m.fecha}-${m.hhmm.replace(":", "")}-${id}.respaldo`;

  const copia = {
    id, tipo,
    fecha: m.fecha, fecha_hora: foto.generado_en, hora_local: m.hhmm,
    nombre_archivo, drive_file_id: null, drive_link: null,
    bytes: paquete.length, conteos: foto.conteos,
    verificado_en: null, estado: "fallido",
  };
  DB.respaldos.copias.push(copia);
  DB.respaldos.ultimo_intento = foto.generado_en;

  const carpetaId = await drive.asegurarCarpetaRespaldos(DB);
  const subido = await drive.subirArchivoADrive(DB, {
    nombre: nombre_archivo,
    mimeType: "application/octet-stream",
    contenidoBuffer: paquete,
    carpetaId,
  });
  if (!subido || !subido.id) throw new Error("Drive no confirmó la subida del respaldo");

  copia.drive_file_id = subido.id;
  copia.drive_link = subido.webViewLink || null;
  copia.estado = "ok";
  DB.respaldos.ultimo_exitoso = copia.fecha_hora;
  pushMovimiento(DB, id, "creacion", `Respaldo ${tipo} (${paquete.length} bytes)`, usuario);
  return copia;
}

/** Lo que ve la pantalla de vigilancia. */
function estadoRespaldos(DB, ahoraMs = Date.now()) {
  const r = DB.respaldos || nuevoEstadoRespaldos();
  const ultimoMs = r.ultimo_exitoso ? Date.parse(r.ultimo_exitoso) : NaN;
  const minutos = Number.isFinite(ultimoMs)
    ? Math.floor((ahoraMs - ultimoMs) / 60000)
    : null;
  return {
    ultimo_exitoso: r.ultimo_exitoso,
    ultimo_intento: r.ultimo_intento,
    minutos_desde_ultimo: minutos,
    // Sin ningún respaldo la alerta está ENCENDIDA. "Nunca he respaldado" es
    // el peor estado posible, no un estado neutro.
    alerta: minutos === null || minutos > MINUTOS_PARA_ALERTA,
    total_copias: r.copias.length,
  };
}

module.exports = {
  nuevoEstadoRespaldos, contarRegistros, armarFoto, crearRespaldo, estadoRespaldos,
  pushMovimiento, siguienteId,
  COLECCIONES_RESPALDADAS, VERSION_FORMATO, MINUTOS_PARA_ALERTA,
};
```

- [ ] **Step 5: Correr y verificar que pasa**

Run: `cd backend && node --test respaldos.test.js`
Expected: PASS — 13 pruebas.

- [ ] **Step 6: Verificación por mutación de la carrera de folio**

Mover `const id = reservarSiguienteId(DB);` a **después** del `await drive.asegurarCarpetaRespaldos(DB)`. Correr.
Expected: **roja** la prueba "los ids son únicos aunque se creen 12 respaldos concurrentes".
**Revertir** y confirmar verde.

- [ ] **Step 7: Commit**

```bash
git add backend/respaldos.js backend/respaldos.test.js backend/drive.js
git commit -m "feat(respaldos): armar, cifrar y subir la foto del negocio a Google Drive"
```

---

## Task 4: Retención — 30 días en rueda

**Files:**
- Modify: `backend/respaldos.js` (agregar `limpiarViejos`)
- Modify: `backend/respaldos.test.js`

**Interfaces:**
- Consumes: `pushMovimiento` (Task 3), `drive.eliminarArchivoDeDrive` (ya existe en `drive.js`)
- Produces: `limpiarViejos(DB, drive, ahoraMs) → { borradas: number, conservadas: number }`, `DIAS_RETENCION_DIA = 30`, `DIAS_RETENCION_HORA = 7`

- [ ] **Step 1: Escribir las pruebas que fallan**

Agregar a `backend/respaldos.test.js`:

```js
const { limpiarViejos, DIAS_RETENCION_DIA, DIAS_RETENCION_HORA } = require("./respaldos");

const DIA_MS = 24 * 60 * 60 * 1000;
const HOY = Date.parse("2026-08-11T22:00:00.000Z");

function copiaFalsa(DB, { tipo, diasAtras, id }) {
  const ms = HOY - diasAtras * DIA_MS;
  const c = {
    id, tipo,
    fecha: new Date(ms).toISOString().slice(0, 10),
    fecha_hora: new Date(ms).toISOString(),
    hora_local: "16:00",
    nombre_archivo: `respaldo-${id}.respaldo`,
    drive_file_id: `file-${id}`, drive_link: null,
    bytes: 100, conteos: {}, verificado_en: null, estado: "ok",
  };
  DB.respaldos.copias.push(c);
  return c;
}

test("la retención borra las copias por hora de más de 7 días", async () => {
  const DB = nuevoDB(); const drive = driveFalso();
  copiaFalsa(DB, { tipo: "hora", diasAtras: 2, id: 1 });
  copiaFalsa(DB, { tipo: "hora", diasAtras: 8, id: 2 });
  const r = await limpiarViejos(DB, drive, HOY);
  assert.strictEqual(r.borradas, 1);
  assert.deepStrictEqual(DB.respaldos.copias.map((c) => c.id), [1]);
});

test("la retención NO borra un punto del día de 8 días (esos viven 30)", async () => {
  const DB = nuevoDB(); const drive = driveFalso();
  copiaFalsa(DB, { tipo: "dia", diasAtras: 8, id: 1 });
  const r = await limpiarViejos(DB, drive, HOY);
  assert.strictEqual(r.borradas, 0);
});

test("la retención SÍ borra un punto del día de 31 días", async () => {
  const DB = nuevoDB(); const drive = driveFalso();
  copiaFalsa(DB, { tipo: "dia", diasAtras: 31, id: 1 });
  copiaFalsa(DB, { tipo: "dia", diasAtras: 29, id: 2 });
  const r = await limpiarViejos(DB, drive, HOY);
  assert.strictEqual(r.borradas, 1);
  assert.deepStrictEqual(DB.respaldos.copias.map((c) => c.id), [2]);
});

test("un pre_restauracion vive 30 días, como los del día", async () => {
  const DB = nuevoDB(); const drive = driveFalso();
  copiaFalsa(DB, { tipo: "pre_restauracion", diasAtras: 8, id: 1 });
  copiaFalsa(DB, { tipo: "pre_restauracion", diasAtras: 31, id: 2 });
  const r = await limpiarViejos(DB, drive, HOY);
  assert.strictEqual(r.borradas, 1);
  assert.deepStrictEqual(DB.respaldos.copias.map((c) => c.id), [1]);
});

test("NUNCA se borra la copia más reciente, aunque las reglas lo digan", async () => {
  // La última red: mejor un archivo de más que quedarse sin ninguno por un
  // error de fechas o un reloj mal puesto.
  const DB = nuevoDB(); const drive = driveFalso();
  copiaFalsa(DB, { tipo: "hora", diasAtras: 400, id: 1 });
  const r = await limpiarViejos(DB, drive, HOY);
  assert.strictEqual(r.borradas, 0);
  assert.strictEqual(DB.respaldos.copias.length, 1);
});

test("un intento FALLIDO reciente no le roba la protección al último respaldo bueno", async () => {
  // El bug que encontró la revisión de la Task 4 (2026-08-12). `crearRespaldo`
  // registra la copia con estado "fallido" ANTES de subir a Drive. Si la
  // protección mira solo la fecha, el fallido —que no es ni un byte en Drive— se
  // lleva el escudo, y el último respaldo REAL lo borra la retención por edad.
  // El índice quedaría con un renglón y la carpeta de Drive vacía.
  const DB = nuevoDB(); const drive = driveFalso();
  copiaFalsa(DB, { tipo: "hora", diasAtras: 10, id: 1, estado: "ok" });      // el único real, ya vencido
  copiaFalsa(DB, { tipo: "hora", diasAtras: 0, id: 2, estado: "fallido" });  // el más nuevo, y no existe en Drive
  await limpiarViejos(DB, drive, HOY);
  const vivosDeVerdad = DB.respaldos.copias.filter((c) => c.estado === "ok");
  assert.strictEqual(vivosDeVerdad.length, 1, "se borró el único respaldo que existía en Drive");
  assert.strictEqual(vivosDeVerdad[0].id, 1);
});

test("protege la más reciente aunque ELLA MISMA esté vencida (y borra las demás)", async () => {
  // ESTA es la prueba que le da dientes a la protección de `masReciente`.
  // La de arriba NO sirve para eso: con una sola copia, la guarda
  // `if (copias.length <= 1) return ...` regresa ANTES de que la línea de
  // `masReciente` se ejecute siquiera, así que quitar esa línea la deja
  // igual de verde. Hacen falta DOS copias, ambas vencidas, para que la
  // protección sea lo único que separa "borra una" de "vacía la carpeta".
  const DB = nuevoDB(); const drive = driveFalso();
  copiaFalsa(DB, { tipo: "hora", diasAtras: 10, id: 1 }); // vencida (>7d), pero es la más nueva
  copiaFalsa(DB, { tipo: "hora", diasAtras: 20, id: 2 }); // vencida y más vieja
  const r = await limpiarViejos(DB, drive, HOY);
  assert.strictEqual(r.borradas, 1);
  assert.deepStrictEqual(DB.respaldos.copias.map((c) => c.id), [1]);
});

test("la retención borra el archivo en Drive, no solo el renglón del índice", async () => {
  const DB = nuevoDB(); const drive = driveFalso();
  const borrados = [];
  drive.eliminarArchivoDeDrive = async (_DB, fileId) => { borrados.push(fileId); };
  copiaFalsa(DB, { tipo: "hora", diasAtras: 30, id: 1 });
  copiaFalsa(DB, { tipo: "hora", diasAtras: 0, id: 2 });
  await limpiarViejos(DB, drive, HOY);
  assert.deepStrictEqual(borrados, ["file-1"]);
});

test("si Drive falla al borrar, el renglón NO se quita del índice", async () => {
  // Quitarlo dejaría un archivo huérfano invisible que nadie volvería a borrar.
  const DB = nuevoDB(); const drive = driveFalso();
  drive.eliminarArchivoDeDrive = async () => { throw new Error("Drive caído"); };
  copiaFalsa(DB, { tipo: "hora", diasAtras: 30, id: 1 });
  copiaFalsa(DB, { tipo: "hora", diasAtras: 0, id: 2 });
  const r = await limpiarViejos(DB, drive, HOY);
  assert.strictEqual(r.borradas, 0);
  assert.strictEqual(DB.respaldos.copias.length, 2);
});

test("una copia fallida sin archivo en Drive se limpia sin llamar a Drive", async () => {
  const DB = nuevoDB(); const drive = driveFalso();
  let llamadas = 0;
  drive.eliminarArchivoDeDrive = async () => { llamadas++; };
  const c = copiaFalsa(DB, { tipo: "hora", diasAtras: 30, id: 1 });
  c.estado = "fallido"; c.drive_file_id = null;
  copiaFalsa(DB, { tipo: "hora", diasAtras: 0, id: 2 });
  const r = await limpiarViejos(DB, drive, HOY);
  assert.strictEqual(r.borradas, 1);
  assert.strictEqual(llamadas, 0);
});

test("las constantes de retención son las que pidió Victor", () => {
  assert.strictEqual(DIAS_RETENCION_DIA, 30);
  assert.strictEqual(DIAS_RETENCION_HORA, 7);
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd backend && node --test respaldos.test.js`
Expected: FAIL — `limpiarViejos is not a function`

- [ ] **Step 3: Implementar `limpiarViejos`**

Agregar a `backend/respaldos.js`, antes del `module.exports`:

```js
const DIAS_RETENCION_DIA = 30;   // los puntos del día y los pre_restauracion
const DIAS_RETENCION_HORA = 7;   // el detalle fino
const DIA_MS = 24 * 60 * 60 * 1000;

function diasDeVida(tipo) {
  return tipo === "hora" ? DIAS_RETENCION_HORA : DIAS_RETENCION_DIA;
}

/**
 * Rueda de retención: 30 días de puntos del día, 7 días de detalle por hora.
 *
 * Dos reglas que no se negocian:
 *  1) El respaldo UTILIZABLE más reciente nunca se borra, aunque su fecha diga
 *     que ya venció. Es la última red contra un reloj mal puesto o una fecha
 *     corrupta: mejor un archivo de más que quedarse sin ninguno.
 *     OJO — "utilizable" quiere decir `estado === "ok"`, y esa palabra costó un
 *     bug real (revisión de la Task 4, 2026-08-12): `crearRespaldo` mete el
 *     registro con estado "fallido" ANTES de subir a Drive. Si se elige el más
 *     reciente solo por fecha, un intento fallido — que no representa un solo
 *     byte en Drive — se lleva la protección, y el último respaldo bueno deja de
 *     ser el más nuevo, la pierde, y lo borra la retención por edad. El índice
 *     queda con un renglón vivo y la carpeta de Drive VACÍA.
 *  2) Si Drive falla al borrar, el renglón se CONSERVA en el índice. Quitarlo
 *     dejaría un archivo huérfano en Drive que nadie volvería a mirar; dejarlo
 *     hace que el siguiente ciclo lo reintente.
 */
async function limpiarViejos(DB, drive, ahoraMs = Date.now()) {
  const copias = DB.respaldos.copias;
  if (copias.length <= 1) return { borradas: 0, conservadas: copias.length };

  // El más nuevo de los que SÍ están en Drive. Si ninguno tuvo éxito nunca
  // (arranque, o Drive lleva horas caído), se cae al más nuevo a secas: proteger
  // algo es mejor que no proteger nada.
  const masNuevoDe = (lista) =>
    lista.reduce((a, b) => (Date.parse(a.fecha_hora) >= Date.parse(b.fecha_hora) ? a : b));
  const utilizables = copias.filter((c) => c.estado === "ok" && c.drive_file_id);
  const masReciente = masNuevoDe(utilizables.length ? utilizables : copias);

  const vencidas = copias.filter((c) => {
    if (c === masReciente) return false;
    const nacida = Date.parse(c.fecha_hora);
    if (!Number.isFinite(nacida)) return false; // fecha corrupta: no se toca
    return ahoraMs - nacida > diasDeVida(c.tipo) * DIA_MS;
  });

  let borradas = 0;
  for (const c of vencidas) {
    if (c.drive_file_id) {
      try {
        await drive.eliminarArchivoDeDrive(DB, c.drive_file_id);
      } catch (_) {
        continue; // se conserva el renglón; el próximo ciclo reintenta
      }
    }
    const i = DB.respaldos.copias.indexOf(c);
    if (i !== -1) DB.respaldos.copias.splice(i, 1);
    pushMovimiento(DB, c.id, "borrado", `Retención: ${c.nombre_archivo}`, null);
    borradas++;
  }
  return { borradas, conservadas: DB.respaldos.copias.length };
}
```

Agregar al `module.exports`: `limpiarViejos, DIAS_RETENCION_DIA, DIAS_RETENCION_HORA,`

- [ ] **Step 4: Correr y verificar que pasa**

Run: `cd backend && node --test respaldos.test.js`
Expected: PASS — 22 pruebas.

- [ ] **Step 5: Verificación por mutación de la red de seguridad**

Quitar la línea `if (c === masReciente) return false;`. Correr.
Expected: **roja** la prueba "protege la más reciente aunque ELLA MISMA esté vencida".

⚠️ **Corrección del escaneo previo (2026-08-12):** este paso decía que la roja
sería "NUNCA se borra la copia más reciente". **Es falso, y comprobarlo importa:**
esa prueba tiene una sola copia, y la guarda `if (copias.length <= 1) return ...`
regresa antes de llegar a la línea de `masReciente`, así que sigue verde con y sin
la protección. Ninguna de las otras pruebas de retención la cubría tampoco (en
todas, la copia más reciente no calificaba para borrarse de por sí). Sin la prueba
nueva de dos copias vencidas, un implementador podía borrar la protección entera y
las 22 pruebas quedaban en verde — hasta el día en que el reloj se atrase y haya
200 copias vencidas: se borrarían TODAS y la carpeta quedaría vacía. Es el mismo
defecto que costó dos rondas en la Task 1. **Si al mutar no se pone roja la prueba
que este paso nombra, PARA y repórtalo — no lo des por bueno.**
**Revertir** y confirmar verde.

- [ ] **Step 6: Commit**

```bash
git add backend/respaldos.js backend/respaldos.test.js
git commit -m "feat(respaldos): retencion en rueda de 30 dias, con detalle por hora de 7 dias"
```

---

## Task 5: Verificación — bajar de Drive y comprobar que sirve

**Files:**
- Modify: `backend/drive.js` (agregar `descargarArchivoDeDrive`)
- Modify: `backend/respaldos.js` (agregar `verificarRespaldo`, `leerRespaldo`)
- Modify: `backend/respaldos.test.js`

**Interfaces:**
- Produces en `drive.js`: `descargarArchivoDeDrive(DB, fileId) → Buffer`
- Produces en `respaldos.js`:
  - `leerRespaldo(DB, drive, copiaId, llave) → { copia, foto }` — baja, descifra y **valida**
  - `verificarRespaldo(DB, drive, copiaId, llave) → { ok, verificado_en, diferencias }`

**Un respaldo que nunca se probó no es un respaldo, es una esperanza.** Cifrar bien no garantiza que Drive haya guardado los bytes correctos.

- [ ] **Step 1: Agregar la descarga a `drive.js`**

Junto a `eliminarArchivoDeDrive`:

```js
/** Baja el contenido de un archivo de Drive como Buffer. `alt=media` pide el
 *  contenido y no los metadatos. */
async function descargarArchivoDeDrive(DB, fileId) {
  const token = await tokenActivo(DB);
  const r = await fetch(`${DRIVE_API}/${fileId}?alt=media`, { headers: driveHeaders(token) });
  if (!r.ok) throw new Error("Error al descargar archivo de Google Drive: " + (await r.text()));
  return Buffer.from(await r.arrayBuffer());
}
```

Agregar a `module.exports`: `descargarArchivoDeDrive,`

- [ ] **Step 2: Escribir las pruebas que fallan**

Agregar a `backend/respaldos.test.js`:

```js
const { verificarRespaldo, leerRespaldo } = require("./respaldos");

/** driveFalso que además DEVUELVE lo que se le subió, para poder bajarlo. */
function driveConMemoria() {
  const archivos = new Map();
  let n = 0;
  return {
    archivos,
    asegurarCarpetaRespaldos: async () => "carpeta-respaldos",
    subirArchivoADrive: async (_DB, args) => {
      const id = `file-${++n}`;
      archivos.set(id, args.contenidoBuffer);
      return { id, webViewLink: `https://drive/${id}` };
    },
    descargarArchivoDeDrive: async (_DB, id) => {
      if (!archivos.has(id)) throw new Error("404 en Drive");
      return archivos.get(id);
    },
    eliminarArchivoDeDrive: async (_DB, id) => { archivos.delete(id); },
  };
}

test("verificarRespaldo baja de Drive, descifra y confirma los conteos", async () => {
  const DB = nuevoDB(); const drive = driveConMemoria();
  const copia = await crearRespaldo(DB, drive, { tipo: "dia", llave: LLAVE });
  const r = await verificarRespaldo(DB, drive, copia.id, LLAVE);
  assert.strictEqual(r.ok, true);
  assert.ok(copia.verificado_en, "debió marcar verificado_en");
  assert.deepStrictEqual(r.diferencias, []);
});

test("verificarRespaldo detecta un archivo alterado en Drive", async () => {
  const DB = nuevoDB(); const drive = driveConMemoria();
  const copia = await crearRespaldo(DB, drive, { tipo: "dia", llave: LLAVE });
  const bytes = drive.archivos.get(copia.drive_file_id);
  bytes[bytes.length - 1] ^= 0xff; // un byte cambiado
  const r = await verificarRespaldo(DB, drive, copia.id, LLAVE);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(copia.verificado_en, null, "un respaldo roto NO queda marcado como verificado");
});

test("verificarRespaldo detecta que el archivo ya no está en Drive", async () => {
  const DB = nuevoDB(); const drive = driveConMemoria();
  const copia = await crearRespaldo(DB, drive, { tipo: "dia", llave: LLAVE });
  drive.archivos.delete(copia.drive_file_id);
  const r = await verificarRespaldo(DB, drive, copia.id, LLAVE);
  assert.strictEqual(r.ok, false);
});

test("verificarRespaldo detecta si los conteos de la etiqueta no cuadran", async () => {
  const DB = nuevoDB(); const drive = driveConMemoria();
  const copia = await crearRespaldo(DB, drive, { tipo: "dia", llave: LLAVE });
  copia.conteos = { ...copia.conteos, ventas: 999 }; // el índice miente
  const r = await verificarRespaldo(DB, drive, copia.id, LLAVE);
  assert.strictEqual(r.ok, false);
  assert.ok(r.diferencias.some((d) => d.includes("ventas")));
});

test("leerRespaldo rechaza una version_formato desconocida", async () => {
  const DB = nuevoDB(); const drive = driveConMemoria();
  const copia = await crearRespaldo(DB, drive, { tipo: "dia", llave: LLAVE });
  // Se re-sube una foto del futuro con el mismo id de archivo.
  const { empaquetar } = require("./respaldoCifrado");
  drive.archivos.set(copia.drive_file_id, empaquetar(
    { version_formato: 99, generado_en: "2026-08-11T22:00:00.000Z", conteos: {}, datos: { pos: {} } },
    LLAVE,
  ));
  await assert.rejects(() => leerRespaldo(DB, drive, copia.id, LLAVE), /versión/i);
});

test("leerRespaldo rechaza una foto a la que le falta una colección", async () => {
  const DB = nuevoDB(); const drive = driveConMemoria();
  const copia = await crearRespaldo(DB, drive, { tipo: "dia", llave: LLAVE });
  const { empaquetar } = require("./respaldoCifrado");
  drive.archivos.set(copia.drive_file_id, empaquetar(
    { version_formato: 1, generado_en: "2026-08-11T22:00:00.000Z", conteos: {}, datos: { pos: { ventas: [] } } },
    LLAVE,
  ));
  await assert.rejects(() => leerRespaldo(DB, drive, copia.id, LLAVE), /incompleto|falta/i);
});

test("leerRespaldo con un id que no existe da un mensaje claro", async () => {
  const DB = nuevoDB(); const drive = driveConMemoria();
  await assert.rejects(() => leerRespaldo(DB, drive, 999, LLAVE), /no encontrado/i);
});
```

- [ ] **Step 3: Correr y verificar que falla**

Run: `cd backend && node --test respaldos.test.js`
Expected: FAIL — `verificarRespaldo is not a function`

- [ ] **Step 4: Implementar**

Agregar a `backend/respaldos.js`, antes del `module.exports`:

```js
const { desempaquetar } = require("./respaldoCifrado");

function buscarCopia(DB, copiaId) {
  const c = DB.respaldos.copias.find((x) => x.id === Number(copiaId));
  if (!c) throw new Error("Respaldo no encontrado");
  return c;
}

/**
 * Baja el archivo de Drive, lo descifra y lo VALIDA ENTERO antes de devolverlo.
 *
 * Se valida todo antes de que nadie pueda usarlo: es el mismo principio que
 * salvó a la migración de SICAR de dejar datos a medias. Un archivo que no pasa
 * se rechaza completo, nunca se aprovecha "la parte buena".
 */
async function leerRespaldo(DB, drive, copiaId, llave) {
  if (!llave) throw new Error("RESPALDO_LLAVE no está configurada — no se puede leer el respaldo");
  const copia = buscarCopia(DB, copiaId);
  if (!copia.drive_file_id) throw new Error("Ese respaldo no llegó a subirse a Drive");

  const bytes = await drive.descargarArchivoDeDrive(DB, copia.drive_file_id);
  const foto = desempaquetar(bytes, llave); // lanza si está alterado o corrupto

  if (foto.version_formato !== VERSION_FORMATO) {
    throw new Error(
      `Ese respaldo usa la versión de formato ${foto.version_formato} y este sistema entiende la ${VERSION_FORMATO}. No se puede aplicar.`
    );
  }
  if (!foto.datos || typeof foto.datos !== "object") {
    throw new Error("El respaldo está incompleto: no trae datos");
  }
  const faltantes = COLECCIONES_RESPALDADAS.filter((k) => foto.datos[k] === undefined);
  if (faltantes.length) {
    throw new Error(`El respaldo está incompleto: le falta ${faltantes.join(", ")}`);
  }
  return { copia, foto };
}

/**
 * La verificación que de verdad cuenta: baja de Drive y comprueba que lo
 * guardado sirve. Cifrar bien no garantiza que Drive guardó los bytes correctos.
 * NUNCA lanza — un respaldo roto es un dato que reportar, no una excepción que
 * tumbe el ciclo.
 */
async function verificarRespaldo(DB, drive, copiaId, llave) {
  let copia = null;
  try {
    const leido = await leerRespaldo(DB, drive, copiaId, llave);
    copia = leido.copia;
    const reales = contarRegistros(leido.foto.datos);
    const diferencias = Object.keys(copia.conteos || {}).filter(
      (k) => Number(copia.conteos[k]) !== Number(reales[k])
    ).map((k) => `${k}: el índice dice ${copia.conteos[k]} y el archivo trae ${reales[k]}`);

    if (diferencias.length) {
      pushMovimiento(DB, copia.id, "verificacion_fallida", diferencias.join("; "), null);
      return { ok: false, verificado_en: null, diferencias };
    }
    copia.verificado_en = ahora();
    pushMovimiento(DB, copia.id, "verificacion", "Descargado de Drive y comprobado", null);
    return { ok: true, verificado_en: copia.verificado_en, diferencias: [] };
  } catch (e) {
    if (copia) pushMovimiento(DB, copia.id, "verificacion_fallida", e.message, null);
    return { ok: false, verificado_en: null, diferencias: [e.message] };
  }
}
```

Agregar al `module.exports`: `leerRespaldo, verificarRespaldo, buscarCopia,`

- [ ] **Step 5: Correr y verificar que pasa**

Run: `cd backend && node --test respaldos.test.js`
Expected: PASS — 29 pruebas.

- [ ] **Step 6: Commit**

```bash
git add backend/respaldos.js backend/respaldos.test.js backend/drive.js
git commit -m "feat(respaldos): verificacion real bajando el archivo de Drive y comprobando conteos"
```

---

## Task 6: Restaurar — los cuatro candados (y el modo mantenimiento)

**Files:**
- Create: `backend/mantenimiento.js`
- Test: `backend/mantenimiento.test.js`
- Modify: `backend/respaldos.js` (agregar `claveRestauracionConfigurada`, `claveCorrecta`, `compararConEstadoActual`, `restaurar`)
- Modify: `backend/respaldos.test.js`

**Interfaces:**
- Produces en `mantenimiento.js`:
  - `activar(motivo) → void`, `desactivar() → void`
  - `estaActivo() → boolean`
  - `estado() → { activo: boolean, motivo: string|null, desde: string|null }`
- Produces en `respaldos.js`:
  - `claveRestauracionConfigurada(env = process.env) → boolean`
  - `claveCorrecta(dada, env = process.env) → boolean` (tiempo constante)
  - `compararConEstadoActual(DB, copia) → { perdidas: {clave: n}, resumen: string }`
  - `restaurar(DB, drive, { copiaId, llave, clave, confirmacion, usuario, env }) → { copia, pre_restauracion, aplicado, comparacion }`
    (el `comparacion` lo produce el código del Step 3 y esta línea lo omitía — corregido por el escaneo previo del 2026-08-12)
  - `PALABRA_CONFIRMACION = "RESTAURAR"`

**La operación más destructiva del sistema.** Borra todo lo de hoy y lo reemplaza. Los cuatro candados del spec, en este orden: **clave → confirmación escrita → aviso de qué se pierde → auto-respaldo previo**.

> **Decisión de Victor (2026-08-12): el sistema se bloquea solo mientras restaura.**
> El diseño original dejaba esto como riesgo de procedimiento — la pantalla avisaba
> en rojo, pero nada impedía que una cajera estuviera cobrando justo en el momento
> del reemplazo. Victor pidió que se bloquee solo. De ahí salen el Step 0 y el
> Step 3bis de esta tarea, más el middleware de la Task 7.

- [ ] **Step 0: El interruptor de mantenimiento (módulo nuevo)**

Crear `backend/mantenimiento.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { activar, desactivar, estaActivo, estado } = require("./mantenimiento");

test("arranca apagado", () => {
  desactivar();
  assert.strictEqual(estaActivo(), false);
  assert.strictEqual(estado().motivo, null);
});

test("activar prende el interruptor y guarda el motivo y la hora", () => {
  activar("Restaurando el respaldo del 2026-08-11 16:00");
  assert.strictEqual(estaActivo(), true);
  assert.match(estado().motivo, /Restaurando/);
  assert.ok(Date.parse(estado().desde) > 0);
  desactivar();
});

test("desactivar lo apaga y limpia el motivo", () => {
  activar("lo que sea");
  desactivar();
  assert.strictEqual(estaActivo(), false);
  assert.strictEqual(estado().motivo, null);
  assert.strictEqual(estado().desde, null);
});

test("activar dos veces seguidas no truena y conserva el primer 'desde'", () => {
  activar("uno");
  const primero = estado().desde;
  activar("dos");
  assert.strictEqual(estado().desde, primero, "no debe reiniciar el reloj");
  assert.match(estado().motivo, /dos/, "el motivo sí se actualiza");
  desactivar();
});
```

Crear `backend/mantenimiento.js`:

```js
/**
 * mantenimiento.js — El interruptor que congela el sistema mientras se restaura.
 *
 * Restaurar reemplaza TODOS los datos del negocio. Si una cajera está cobrando en
 * ese momento, su venta se escribe sobre datos que están a punto de desaparecer, o
 * peor: se pierde sin que nadie se entere. Victor pidió que el sistema se bloquee
 * solo (2026-08-12) en vez de confiar en el aviso de la pantalla.
 *
 * El estado vive en una variable de módulo, NO en el objeto DB, y eso es a
 * propósito: `persistencia.js` serializa el DB entero a SQLite, y un interruptor
 * de mantenimiento persistido podría quedarse trabado en "prendido" tras un
 * reinicio a media restauración — dejando la tienda cerrada sin forma de abrirla
 * desde la interfaz. En memoria, un reinicio siempre despierta con el sistema
 * abierto: si la restauración quedó a medias, se vuelve a intentar; una tienda
 * trabada sería peor.
 */

let activo = false;
let motivo = null;
let desde = null;

/** Prende el bloqueo. Llamar dos veces NO reinicia el reloj: si ya estaba
 *  bloqueado, lo que importa es desde cuándo lo está. */
function activar(razon) {
  motivo = razon || "Mantenimiento en curso";
  if (!activo) {
    activo = true;
    desde = new Date().toISOString();
  }
}

function desactivar() {
  activo = false;
  motivo = null;
  desde = null;
}

function estaActivo() {
  return activo;
}

function estado() {
  return { activo, motivo, desde };
}

module.exports = { activar, desactivar, estaActivo, estado };
```

Run: `cd backend && node --test mantenimiento.test.js`
Expected: PASS — 4 pruebas.

- [ ] **Step 1: Escribir las pruebas que fallan**

Agregar a `backend/respaldos.test.js`:

```js
const {
  restaurar, claveRestauracionConfigurada, claveCorrecta,
  compararConEstadoActual, PALABRA_CONFIRMACION,
} = require("./respaldos");
const { estaActivo, desactivar } = require("./mantenimiento");

const ENV_OK = { CLAVE_RESTAURACION: "la-clave-secreta-de-victor" };
/** Una llave válida pero distinta: sirve para simular un respaldo ilegible. */
const OTRA_LLAVE = Buffer.from("b".repeat(64), "hex");

// El interruptor de mantenimiento es estado de MÓDULO, no del DB: vive entre
// pruebas. Se apaga antes de cada una para que el orden de ejecución no cambie
// el resultado — una prueba que depende de la anterior es una prueba que miente.
beforeEach(() => desactivar());
// ^ requiere ampliar el import de arriba del archivo a:
//   const { test, beforeEach } = require("node:test");

async function conRespaldoListo() {
  const DB = nuevoDB();
  const drive = driveConMemoria();
  const copia = await crearRespaldo(DB, drive, { tipo: "dia", llave: LLAVE });
  return { DB, drive, copia };
}

test("un usuario amarrado a una sucursal NO puede restaurar, aunque traiga la clave buena", async () => {
  // Candado 0, dentro del módulo. La ruta ya exige alcance global; esta prueba
  // vigila que el módulo NO dependa solo de la ruta (restricción global #5).
  const { DB, drive, copia } = await conRespaldoListo();
  const antes = JSON.stringify(DB.pos.ventas);
  await assert.rejects(
    () => restaurar(DB, drive, {
      copiaId: copia.id, llave: LLAVE, clave: ENV_OK.CLAVE_RESTAURACION,
      confirmacion: PALABRA_CONFIRMACION,
      usuario: { nombre: "Gerente de Ocosingo", sucursal_id: 1 }, env: ENV_OK,
    }),
    /alcance global/i,
  );
  assert.strictEqual(JSON.stringify(DB.pos.ventas), antes, "no debió tocar nada");
  // Y no debió dejar ni siquiera el respaldo pre_restauracion.
  assert.strictEqual(
    DB.respaldos.copias.filter((c) => c.tipo === "pre_restauracion").length, 0,
  );
});

test("sin CLAVE_RESTAURACION configurada, restaurar está APAGADO (falla cerrado)", async () => {
  const { DB, drive, copia } = await conRespaldoListo();
  assert.strictEqual(claveRestauracionConfigurada({}), false);
  await assert.rejects(
    () => restaurar(DB, drive, {
      copiaId: copia.id, llave: LLAVE, clave: "loquesea",
      confirmacion: PALABRA_CONFIRMACION, usuario: { nombre: "Victor" }, env: {},
    }),
    /no está habilitada|no está configurada/i,
  );
});

test("con la clave equivocada NO restaura y NO muta nada", async () => {
  const { DB, drive, copia } = await conRespaldoListo();
  DB.pos.ventas.push({ id: 3, total: 999, tipo_documento: "Ticket" });
  const antes = JSON.stringify(DB.pos.ventas);

  await assert.rejects(
    () => restaurar(DB, drive, {
      copiaId: copia.id, llave: LLAVE, clave: "clave-mala",
      confirmacion: PALABRA_CONFIRMACION, usuario: { nombre: "Victor" }, env: ENV_OK,
    }),
    /clave de restauración/i,
  );
  assert.strictEqual(JSON.stringify(DB.pos.ventas), antes);
});

test("sin escribir RESTAURAR no restaura", async () => {
  const { DB, drive, copia } = await conRespaldoListo();
  await assert.rejects(
    () => restaurar(DB, drive, {
      copiaId: copia.id, llave: LLAVE, clave: ENV_OK.CLAVE_RESTAURACION,
      confirmacion: "restaurar porfa", usuario: { nombre: "Victor" }, env: ENV_OK,
    }),
    /RESTAURAR/,
  );
});

test("restaurar deja la base exactamente igual a la foto", async () => {
  const { DB, drive, copia } = await conRespaldoListo();
  DB.pos.ventas.push({ id: 3, total: 999, tipo_documento: "Ticket" });
  DB.crm.clientes.push({ id: 2, nombre: "Cliente nuevo" });

  const r = await restaurar(DB, drive, {
    copiaId: copia.id, llave: LLAVE, clave: ENV_OK.CLAVE_RESTAURACION,
    confirmacion: PALABRA_CONFIRMACION, usuario: { nombre: "Victor" }, env: ENV_OK,
  });

  assert.strictEqual(r.aplicado, true);
  assert.strictEqual(DB.pos.ventas.length, 2);
  assert.strictEqual(DB.crm.clientes.length, 1);
  assert.strictEqual(DB.crm.clientes[0].nombre, "Ana");
});

test("ANTES de tocar nada se crea el respaldo pre_restauracion", async () => {
  const { DB, drive, copia } = await conRespaldoListo();
  DB.pos.ventas.push({ id: 3, total: 999, tipo_documento: "Ticket" });

  const r = await restaurar(DB, drive, {
    copiaId: copia.id, llave: LLAVE, clave: ENV_OK.CLAVE_RESTAURACION,
    confirmacion: PALABRA_CONFIRMACION, usuario: { nombre: "Victor" }, env: ENV_OK,
  });

  assert.strictEqual(r.pre_restauracion.tipo, "pre_restauracion");
  // Y trae el estado de ANTES: las 3 ventas, no las 2 restauradas.
  const foto = desempaquetar(drive.archivos.get(r.pre_restauracion.drive_file_id), LLAVE);
  assert.strictEqual(foto.datos.pos.ventas.length, 3);
});

test("si el respaldo previo FALLA, la restauración se cancela y no se muta nada", async () => {
  const { DB, drive, copia } = await conRespaldoListo();
  DB.pos.ventas.push({ id: 3, total: 999, tipo_documento: "Ticket" });
  const antes = JSON.stringify(DB.pos.ventas);

  const subirOriginal = drive.subirArchivoADrive;
  drive.subirArchivoADrive = async () => { throw new Error("Drive caído"); };

  await assert.rejects(
    () => restaurar(DB, drive, {
      copiaId: copia.id, llave: LLAVE, clave: ENV_OK.CLAVE_RESTAURACION,
      confirmacion: PALABRA_CONFIRMACION, usuario: { nombre: "Victor" }, env: ENV_OK,
    }),
    /respaldo de seguridad|no se pudo/i,
  );
  assert.strictEqual(JSON.stringify(DB.pos.ventas), antes, "la base se movió y no debía");
  drive.subirArchivoADrive = subirOriginal;
});

test("restaurar NO pisa DB.respaldos con el índice viejo", async () => {
  const { DB, drive, copia } = await conRespaldoListo();
  const copiasAntes = DB.respaldos.copias.length;

  await restaurar(DB, drive, {
    copiaId: copia.id, llave: LLAVE, clave: ENV_OK.CLAVE_RESTAURACION,
    confirmacion: PALABRA_CONFIRMACION, usuario: { nombre: "Victor" }, env: ENV_OK,
  });

  // El índice conserva la copia original MÁS el pre_restauracion.
  assert.strictEqual(DB.respaldos.copias.length, copiasAntes + 1);
  assert.ok(DB.respaldos.copias.some((c) => c.tipo === "pre_restauracion"));
});

test("un archivo corrupto se rechaza SIN mutación parcial", async () => {
  const { DB, drive, copia } = await conRespaldoListo();
  DB.pos.ventas.push({ id: 3, total: 999, tipo_documento: "Ticket" });
  const antes = JSON.stringify(DB.pos.ventas);
  const bytes = drive.archivos.get(copia.drive_file_id);
  bytes[bytes.length - 1] ^= 0xff;

  await assert.rejects(
    () => restaurar(DB, drive, {
      copiaId: copia.id, llave: LLAVE, clave: ENV_OK.CLAVE_RESTAURACION,
      confirmacion: PALABRA_CONFIRMACION, usuario: { nombre: "Victor" }, env: ENV_OK,
    }),
    /no se pudo descifrar/,
  );
  assert.strictEqual(JSON.stringify(DB.pos.ventas), antes);
});

test("la restauración queda en la bitácora con quién y qué", async () => {
  const { DB, drive, copia } = await conRespaldoListo();
  await restaurar(DB, drive, {
    copiaId: copia.id, llave: LLAVE, clave: ENV_OK.CLAVE_RESTAURACION,
    confirmacion: PALABRA_CONFIRMACION, usuario: { nombre: "Victor Pérez" }, env: ENV_OK,
  });
  const mov = DB.respaldos.movimientos.find((m) => m.tipo === "restauracion");
  assert.ok(mov);
  assert.strictEqual(mov.usuario, "Victor Pérez");
});

test("mientras restaura, el sistema está BLOQUEADO — y el bloqueo empieza ANTES del respaldo previo", async () => {
  // La ventana que este bloqueo cierra: una venta capturada entre el respaldo
  // previo y el reemplazo se perdería DOS veces (no está en los datos viejos que
  // se restauran, ni en el respaldo previo que se tomó antes de ella).
  const { DB, drive, copia } = await conRespaldoListo();
  let bloqueadoDuranteElPrevio = null;
  const subirOriginal = drive.subirArchivoADrive;
  drive.subirArchivoADrive = async (...args) => {
    bloqueadoDuranteElPrevio = estaActivo(); // esto corre DENTRO del respaldo previo
    return subirOriginal(...args);
  };

  await restaurar(DB, drive, {
    copiaId: copia.id, llave: LLAVE, clave: ENV_OK.CLAVE_RESTAURACION,
    confirmacion: PALABRA_CONFIRMACION, usuario: { nombre: "Victor" }, env: ENV_OK,
  });

  assert.strictEqual(bloqueadoDuranteElPrevio, true, "el bloqueo llegó tarde");
  assert.strictEqual(estaActivo(), false, "no se desbloqueó al terminar");
});

test("si la restauración TRUENA a media faena, el sistema se desbloquea igual", async () => {
  // Un negocio trabado en mantenimiento para siempre sería peor que la falla.
  const { DB, drive, copia } = await conRespaldoListo();
  drive.subirArchivoADrive = async () => { throw new Error("Drive caído"); };

  await assert.rejects(() => restaurar(DB, drive, {
    copiaId: copia.id, llave: LLAVE, clave: ENV_OK.CLAVE_RESTAURACION,
    confirmacion: PALABRA_CONFIRMACION, usuario: { nombre: "Victor" }, env: ENV_OK,
  }));
  assert.strictEqual(estaActivo(), false, "quedó trabado en mantenimiento");
});

test("una clave equivocada NO bloquea la tienda", async () => {
  // Cerrar la tienda porque alguien se equivocó al teclear sería un modo de
  // negación de servicio con tres letras mal escritas.
  const { DB, drive, copia } = await conRespaldoListo();
  await assert.rejects(() => restaurar(DB, drive, {
    copiaId: copia.id, llave: LLAVE, clave: "clave-mala",
    confirmacion: PALABRA_CONFIRMACION, usuario: { nombre: "Victor" }, env: ENV_OK,
  }));
  assert.strictEqual(estaActivo(), false);
});

test("un respaldo ilegible NO bloquea la tienda (se valida antes de bloquear)", async () => {
  const { DB, drive, copia } = await conRespaldoListo();
  await assert.rejects(() => restaurar(DB, drive, {
    copiaId: copia.id, llave: OTRA_LLAVE, clave: ENV_OK.CLAVE_RESTAURACION,
    confirmacion: PALABRA_CONFIRMACION, usuario: { nombre: "Victor" }, env: ENV_OK,
  }));
  assert.strictEqual(estaActivo(), false);
});

test("la clave NUNCA aparece en la bitácora", async () => {
  const { DB, drive, copia } = await conRespaldoListo();
  await restaurar(DB, drive, {
    copiaId: copia.id, llave: LLAVE, clave: ENV_OK.CLAVE_RESTAURACION,
    confirmacion: PALABRA_CONFIRMACION, usuario: { nombre: "Victor" }, env: ENV_OK,
  });
  const texto = JSON.stringify(DB.respaldos.movimientos);
  assert.ok(!texto.includes(ENV_OK.CLAVE_RESTAURACION), "la clave se filtró a la bitácora");
});

test("claveCorrecta no se deja engañar por una clave más larga con el mismo prefijo", () => {
  assert.strictEqual(claveCorrecta("la-clave-secreta-de-victor", ENV_OK), true);
  assert.strictEqual(claveCorrecta("la-clave-secreta-de-victorXX", ENV_OK), false);
  assert.strictEqual(claveCorrecta("la-clave", ENV_OK), false);
  assert.strictEqual(claveCorrecta("", ENV_OK), false);
  assert.strictEqual(claveCorrecta(null, ENV_OK), false);
});

test("compararConEstadoActual dice cuántos registros se van a perder", async () => {
  const { DB, copia } = await conRespaldoListo();
  DB.pos.ventas.push({ id: 3, total: 999, tipo_documento: "Ticket" });
  DB.pos.ventas.push({ id: 4, total: 50, tipo_documento: "Ticket" });
  DB.gastos.gastos.push({ id: 2 });

  const c = compararConEstadoActual(DB, copia);
  assert.strictEqual(c.perdidas.ventas, 2);
  assert.strictEqual(c.perdidas.gastos, 1);
  assert.ok(!("clientes" in c.perdidas), "no debe listar lo que no cambió");
});

test("compararConEstadoActual no reporta pérdidas negativas", async () => {
  const { DB, copia } = await conRespaldoListo();
  DB.pos.ventas.pop(); // hoy hay MENOS que en la foto
  const c = compararConEstadoActual(DB, copia);
  assert.ok(!("ventas" in c.perdidas));
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd backend && node --test respaldos.test.js`
Expected: FAIL — `restaurar is not a function`

- [ ] **Step 3: Implementar**

Agregar a `backend/respaldos.js`:

```js
const crypto = require("crypto");
const mantenimiento = require("./mantenimiento");

const PALABRA_CONFIRMACION = "RESTAURAR";

/** ¿Está puesta la clave en Render? Si no, restaurar NO EXISTE. Falla cerrado:
 *  mientras Victor no la ponga a propósito, nadie puede restaurar nada. */
function claveRestauracionConfigurada(env = process.env) {
  return typeof env.CLAVE_RESTAURACION === "string" && env.CLAVE_RESTAURACION.length > 0;
}

/** Comparación de TIEMPO CONSTANTE. Con `===` el tiempo de respuesta filtra
 *  cuántos caracteres iniciales acertaste, y la clave se adivina letra por
 *  letra. Se comparan hashes de largo fijo para que dos claves de distinto
 *  tamaño no revienten timingSafeEqual. */
function claveCorrecta(dada, env = process.env) {
  if (!claveRestauracionConfigurada(env)) return false;
  if (typeof dada !== "string" || dada.length === 0) return false;
  const a = crypto.createHash("sha256").update(dada, "utf8").digest();
  const b = crypto.createHash("sha256").update(env.CLAVE_RESTAURACION, "utf8").digest();
  return crypto.timingSafeEqual(a, b);
}

/** Qué se pierde al volver a esta foto. Es una ESTIMACIÓN POR CONTEO, no un
 *  listado — así se dice en la pantalla, para no prometer precisión que no da. */
function compararConEstadoActual(DB, copia) {
  const ahoraConteos = contarRegistros(DB);
  const perdidas = {};
  for (const clave of Object.keys(ahoraConteos)) {
    const diferencia = ahoraConteos[clave] - Number(copia.conteos?.[clave] ?? 0);
    if (diferencia > 0) perdidas[clave] = diferencia;
  }
  const ETIQUETAS = {
    ventas: "ventas", apartados: "apartados", cortes: "cortes de caja",
    productos: "productos", garantias: "garantías", clientes: "clientes",
    gastos: "gastos", depositos: "depósitos", usuarios: "usuarios",
  };
  const partes = Object.entries(perdidas).map(([k, n]) => `${n} ${ETIQUETAS[k] || k}`);
  return {
    perdidas,
    resumen: partes.length
      ? `Se perderán ${partes.join(", ")} capturados después de esa hora.`
      : "No se pierde ningún registro: la foto está al día.",
  };
}

/**
 * Restaurar. La operación más destructiva del sistema.
 *
 * ORDEN DE LOS CANDADOS, y el orden importa:
 *   1. ¿Está configurada la clave?      -> si no, esto no existe
 *   2. ¿La clave es correcta?           -> tiempo constante
 *   3. ¿Escribió RESTAURAR?             -> nadie lo aprieta por accidente
 *   4. Bajar y VALIDAR la foto ENTERA   -> antes de tocar un solo dato
 *   5. Respaldo pre_restauracion        -> si falla, se CANCELA
 *   6. Recién entonces, reemplazar
 *
 * El candado 5 es el más importante: vuelve reversible el peor error posible.
 * Si Victor restaura el día equivocado, se restaura de vuelta y no se perdió
 * nada.
 *
 * DB.respaldos NO se restaura: el índice viejo borraría de la vista los
 * respaldos hechos después de esa foto, incluido el pre_restauracion que acaba
 * de salvarle el pellejo.
 */
async function restaurar(DB, drive, {
  copiaId, llave, clave, confirmacion, usuario = null, env = process.env,
} = {}) {
  // Candado 0 — alcance, DENTRO del módulo (restricción global #5, agregado por
  // el escaneo previo del 2026-08-12). La ruta ya lleva `requiereAlcanceGlobal`,
  // y aun así este chequeo va aquí: exactamente eso era lo que hacía "segura" la
  // ruta de Apartados antes del bug de alcance de julio. Es la operación más
  // destructiva del sistema; si mañana alguien llama `restaurar()` desde un
  // script, una tarea programada, o reordena por accidente los middlewares, esto
  // es lo único que queda de pie. Un usuario amarrado a una sucursal trae
  // `sucursal_id` en su token; quien ve todas trae `null`.
  if (usuario && usuario.sucursal_id != null) {
    throw new Error("Restaurar requiere una cuenta con alcance global (todas las sucursales).");
  }

  if (!claveRestauracionConfigurada(env)) {
    throw new Error(
      "La restauración no está habilitada: falta configurar CLAVE_RESTAURACION en el servidor."
    );
  }
  if (!claveCorrecta(clave, env)) {
    throw new Error("La clave de restauración no es correcta.");
  }
  if (confirmacion !== PALABRA_CONFIRMACION) {
    throw new Error(`Escribe ${PALABRA_CONFIRMACION} para confirmar.`);
  }

  // Se baja y valida ENTERA antes de tocar nada. Si el archivo está corrupto,
  // incompleto o de otra versión, se rechaza aquí y la base ni se enteró.
  // Esto va ANTES de bloquear el sistema a propósito: un archivo dañado no debe
  // dejar la tienda cerrada ni un segundo.
  const { copia, foto } = await leerRespaldo(DB, drive, copiaId, llave);

  // A partir de aquí el sistema queda BLOQUEADO para escrituras, y no se
  // desbloquea pase lo que pase (el `finally` de más abajo).
  //
  // El bloqueo va ANTES del respaldo previo, no después, y esa diferencia es
  // justo el punto: una venta capturada ENTRE el respaldo previo y el reemplazo
  // se perdería dos veces — no estaría en los datos restaurados (son más viejos)
  // ni en el respaldo previo (se tomó antes de esa venta). Sería dinero cobrado
  // que no existe en ningún archivo. Con el bloqueo aquí, esa ventana no existe.
  mantenimiento.activar(
    `Restaurando el respaldo del ${copia.fecha} ${copia.hora_local}. ` +
    "El sistema vuelve solo en cuanto termine."
  );

  try {
    // La red de seguridad. Si esto falla, NO se restaura: mejor no restaurar que
    // restaurar sin poder deshacerlo.
    let pre;
    try {
      pre = await crearRespaldo(DB, drive, { tipo: "pre_restauracion", llave, usuario });
    } catch (e) {
      throw new Error(
        "No se pudo crear el respaldo de seguridad previo, así que la restauración se canceló " +
        "(no se tocó ningún dato). Revisa la conexión con Google Drive. Detalle: " + e.message
      );
    }

    const comparacion = compararConEstadoActual(DB, copia);

    // Recién ahora se muta. Colección por colección, solo las respaldadas.
    for (const nombre of COLECCIONES_RESPALDADAS) {
      if (foto.datos[nombre] !== undefined) DB[nombre] = foto.datos[nombre];
    }

    pushMovimiento(
      DB, copia.id, "restauracion",
      `Restaurado al estado del ${copia.fecha} ${copia.hora_local}. ${comparacion.resumen} ` +
      `Respaldo previo: ${pre.nombre_archivo}`,
      usuario
    );

    return { copia, pre_restauracion: pre, aplicado: true, comparacion };
  } finally {
    // SIEMPRE se desbloquea: si algo revienta a media restauración, la tienda no
    // se queda cerrada esperando a que alguien reinicie el servidor. Un `finally`
    // y no un `desactivar()` al final del camino feliz — ese es el error que deja
    // negocios parados.
    mantenimiento.desactivar();
  }
}
```

Agregar al `module.exports`: `restaurar, claveRestauracionConfigurada, claveCorrecta, compararConEstadoActual, PALABRA_CONFIRMACION,`

- [ ] **Step 4: Correr y verificar que pasa**

Run: `cd backend && node --test respaldos.test.js mantenimiento.test.js`
Expected: PASS. (El conteo lo da la corrida — el texto de este plan ya se equivocó una vez con un número de pruebas; no lo tomes como requisito.)

- [ ] **Step 5: Verificación por mutación de los candados críticos**

Una a la vez, revirtiendo entre cada una:

| Mutación | Prueba que debe ponerse roja |
|---|---|
| Borrar el bloque `try { pre = await crearRespaldo(...) }` y dejar la mutación | "si el respaldo previo FALLA, la restauración se cancela" |
| Cambiar `claveCorrecta(clave, env)` por `true` | "con la clave equivocada NO restaura y NO muta nada" |
| Borrar el `if (!claveRestauracionConfigurada(env))` | "sin CLAVE_RESTAURACION configurada, restaurar está APAGADO" |
| Borrar el `if (usuario && usuario.sucursal_id != null)` (candado 0, alcance) | "un usuario amarrado a una sucursal NO puede restaurar" |
| Mover `mantenimiento.activar(...)` a DESPUÉS del bloque del respaldo previo | "mientras restaura, el sistema está BLOQUEADO — y el bloqueo empieza ANTES del respaldo previo" |
| Cambiar el `finally { mantenimiento.desactivar(); }` por un `desactivar()` al final del camino feliz | "si la restauración TRUENA a media faena, el sistema se desbloquea igual" |

**Revertir las seis** y confirmar todas en verde (el conteo exacto lo da la corrida; no lo adivines).

> **Si alguna mutación NO pone roja la prueba que le toca, PARA y repórtalo como
> DONE_WITH_CONCERNS o BLOCKED.** En este mismo plan ya pasó tres veces que una
> verificación por mutación no comprobaba lo que prometía (Task 1 dos veces, Task 3
> una). Una mutación que no rompe nada significa que la prueba no está vigilando esa
> protección — no que la protección sea sólida. No lo des por bueno.

- [ ] **Step 6: Commit**

```bash
git add backend/mantenimiento.js backend/mantenimiento.test.js backend/respaldos.js backend/respaldos.test.js
git commit -m "feat(respaldos): restaurar con clave propia, confirmacion escrita, auto-respaldo previo y bloqueo del sistema"
```

---

## Task 7: Módulo, permisos, rutas y arranque del reloj

> **Dos avisos del escaneo previo (2026-08-12), para que no se asuman resueltos en otra tarea:**
>
> 1. **El "reintenta con espera creciente" del diseño NO está implementado en ninguna tarea.** El diseño promete, en su tabla de manejo de errores: *"Drive no responde → Reintenta con espera creciente"*. Ni `crearRespaldo` (Task 3), ni `subirArchivoADrive` (`drive.js`), ni el `cicloRespaldo` de esta tarea lo hacen. En la práctica el ciclo de 5 minutos funciona como reintento de facto y **eso es aceptable**, pero constrúyelo sabiéndolo: no agregues backoff por tu cuenta (sería ámbito nuevo), y no supongas que ya existe.
> 2. **`req.usuarioToken?.usuario` es SIEMPRE `undefined`.** `firmarToken()` (`backend/auth.js`) firma solo `{ id, nombre, rol_id, sucursal_id }` — nunca un campo `usuario`. La línea `const usuario = req.usuarioToken?.usuario || \`id:${req.usuarioToken?.id}\`` funciona (cae siempre a `id:N`, que es una clave estable por persona para el bloqueo de intentos), pero sugiere dos caminos donde solo hay uno. Déjala funcionando, y si la simplificas a `id:N` a secas, dilo en tu reporte.

**Files:**
- Modify: `backend/permisosCatalogo.js`
- Modify: `backend/validarPermisos.js`
- Modify: `backend/server.js`
- Create: `backend/respaldosRutas.test.js`

**Interfaces:**
- Consumes: todo lo de las tareas 1-6
- Produces: 6 rutas REST y el ciclo automático

### Rutas

| Método | Ruta | Protección |
|---|---|---|
| `GET` | `/api/respaldos` | `ver_respaldos` |
| `GET` | `/api/respaldos/estado` | `ver_respaldos` |
| `POST` | `/api/respaldos/ahora` | `ver_respaldos` + `requiereAlcanceGlobal` |
| `GET` | `/api/respaldos/:id/comparar` | `restaurar_respaldo` + `requiereAlcanceGlobal` |
| `POST` | `/api/respaldos/:id/restaurar` | `restaurar_respaldo` + `requiereAlcanceGlobal` + clave + bloqueo |
| `GET` | `/api/respaldos/:id/descargar` | `TOKEN_DESCARGA_RESPALDOS` (para el script de la PC) |

**Sobre la ruta de descarga:** no lleva sesión porque la corre una tarea programada de Windows sin nadie enfrente. Es segura porque (a) devuelve **solo bytes cifrados** — sin `RESPALDO_LLAVE` son ruido, (b) el token se compara en **tiempo constante**, (c) **sin la variable configurada responde 404**, no 401: no confirma siquiera que la ruta exista.

- [ ] **Step 1: Registrar los permisos y el módulo**

En `backend/permisosCatalogo.js`, dentro de `PERMISOS` (junto a los de `cuenta_comun`, línea ~110):

```js
  { clave: "ver_respaldos",      etiqueta: "Ver Respaldos",       modulo: "respaldos", implementado: true },
  { clave: "restaurar_respaldo", etiqueta: "Restaurar Respaldo",  modulo: "respaldos", implementado: true },
```

En `MODULOS_SISTEMA`, tras `cuenta_comun`:

```js
  { id: "respaldos", nombre: "Respaldos" },
```

En `backend/validarPermisos.js`, al final de `MODULOS_QUE_REQUIEREN_PERMISOS`:

```js
  "respaldos",
```

- [ ] **Step 2: Correr toda la suite para confirmar que el guardia de arranque acepta el módulo**

Run: `cd backend && node --test`
Expected: PASS. Si sale `validarSistemaDePermisos` en rojo, falta uno de los dos registros.

- [ ] **Step 3: Commit del registro**

```bash
git add backend/permisosCatalogo.js backend/validarPermisos.js
git commit -m "feat(respaldos): registra el modulo respaldos y sus dos permisos propios"
```

- [ ] **Step 4: Escribir las pruebas de rutas que fallan**

Crear `backend/respaldosRutas.test.js`. Sigue el patrón de `rutasEscrituraSucursal.test.js`: le pega a las rutas **reales** vía `require("./server")`.

```js
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

// ⚠️ ESTO VA ANTES DE REQUERIR server.js — sin esto la prueba lee y ENSUCIA la
// base real datos.sqlite del desarrollador. Requerir server.js abre SQLite y
// restaura el estado guardado. Copiado de rutasEscrituraSucursal.test.js, que
// ya resolvió exactamente este problema.
const DB_TEMPORAL = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "respaldos-")), "datos.sqlite");
process.env.DB_PATH = DB_TEMPORAL;
process.env.JWT_SECRET = process.env.JWT_SECRET || "secreto-de-pruebas";

const { PALABRA_CONFIRMACION } = require("./respaldos");
const app = require("./server");
const { firmarToken } = require("./auth");
const { listarPermisos } = require("./permisosCatalogo");

/** Levanta el servidor en un puerto libre y devuelve una función para pegarle. */
async function conServidor(fn) {
  const servidor = app.listen(0);
  await new Promise((r) => servidor.once("listening", r));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  try {
    await fn(async (ruta, opciones = {}) => {
      const r = await fetch(base + ruta, {
        ...opciones,
        headers: { "Content-Type": "application/json", ...(opciones.headers || {}) },
      });
      let cuerpo = null;
      try { cuerpo = await r.json(); } catch (_) {}
      return { status: r.status, cuerpo };
    });
  } finally {
    await new Promise((r) => servidor.close(r));
  }
}

test("los dos permisos nuevos están en el catálogo", () => {
  const claves = listarPermisos().map((p) => p.clave);
  assert.ok(claves.includes("ver_respaldos"));
  assert.ok(claves.includes("restaurar_respaldo"));
  const modulos = listarPermisos().filter((p) => p.modulo === "respaldos");
  assert.strictEqual(modulos.length, 2);
});

test("GET /api/respaldos sin sesión responde 401", async () => {
  await conServidor(async (pedir) => {
    assert.strictEqual((await pedir("/api/respaldos")).status, 401);
  });
});

test("GET /api/respaldos/:id/descargar sin TOKEN_DESCARGA_RESPALDOS responde 404", async () => {
  const guardado = process.env.TOKEN_DESCARGA_RESPALDOS;
  delete process.env.TOKEN_DESCARGA_RESPALDOS;
  await conServidor(async (pedir) => {
    assert.strictEqual((await pedir("/api/respaldos/1/descargar")).status, 404);
  });
  if (guardado !== undefined) process.env.TOKEN_DESCARGA_RESPALDOS = guardado;
});

test("GET /api/respaldos/:id/descargar con token equivocado responde 404", async () => {
  process.env.TOKEN_DESCARGA_RESPALDOS = "token-bueno";
  await conServidor(async (pedir) => {
    const r = await pedir("/api/respaldos/1/descargar", { headers: { "X-Token-Respaldo": "token-malo" } });
    assert.strictEqual(r.status, 404);
  });
  delete process.env.TOKEN_DESCARGA_RESPALDOS;
});

test("POST /api/respaldos/:id/restaurar sin CLAVE_RESTAURACION responde 400 y no muta", async () => {
  const guardado = process.env.CLAVE_RESTAURACION;
  delete process.env.CLAVE_RESTAURACION;
  await conServidor(async (pedir) => {
    const token = firmarToken({ id: 1, nombre: "Admin", rol_id: 1, sucursal_id: null });
    const r = await pedir("/api/respaldos/1/restaurar", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ clave: "x", confirmacion: PALABRA_CONFIRMACION }),
    });
    assert.ok([400, 403].includes(r.status));
  });
  if (guardado !== undefined) process.env.CLAVE_RESTAURACION = guardado;
});
```

> **Nota para quien implemente:** revisa cómo `rutasEscrituraSucursal.test.js` arma sus tokens y roles y **sigue ese patrón exacto** — la forma del token (`firmarToken`) y el rol de Administrador ya están resueltos ahí. Si `firmarToken` no está exportado con ese nombre, usa el que sí esté; no inventes uno.

- [ ] **Step 5: Correr y verificar que falla**

Run: `cd backend && node --test respaldosRutas.test.js`
Expected: FAIL — las rutas todavía no existen (404 donde se espera 401, etc.)

- [ ] **Step 6: Agregar `DB.respaldos` y el arranque en `server.js`**

En el literal `const DB = {` (línea ~107), tras `cuenta_comun`:

```js
  respaldos: {
    copias: [],
    movimientos: [],
    ultimo_id: 0,
    ultimo_exitoso: null,
    ultimo_intento: null,
    carpeta_drive_id: null,
  },
```

Junto a los otros `require` del backend:

```js
const {
  crearRespaldo, limpiarViejos, verificarRespaldo, restaurar, leerRespaldo,
  estadoRespaldos, compararConEstadoActual, claveRestauracionConfigurada,
  PALABRA_CONFIRMACION,
} = require("./respaldos");
const { llaveDesdeEnv } = require("./respaldoCifrado");
const { debeRespaldar, INTERVALO_REVISION_MS } = require("./respaldoReloj");
const {
  crearRegistroIntentos, estaBloqueado, registrarFallo, registrarExito, BLOQUEO_MS,
} = require("./intentosLogin");
```

Tras `reconciliarRoles(DB);`, el aviso de arranque:

```js
// Mismo espíritu que el aviso de DB_PATH en persistencia.js: si los respaldos
// NO están funcionando, hay que gritarlo. Creer que hay respaldos y que no los
// haya es el peor final posible.
let LLAVE_RESPALDO = null;
try {
  LLAVE_RESPALDO = llaveDesdeEnv();
} catch (e) {
  console.error("❌ " + e.message);
}
if (!LLAVE_RESPALDO) {
  console.warn("⚠️  RESPALDO_LLAVE no está configurada: EL SISTEMA NO SE ESTÁ RESPALDANDO.");
} else {
  console.log("✅ Respaldos automáticos activos (cada hora, cifrados)");
}
if (!claveRestauracionConfigurada()) {
  console.warn("⚠️  CLAVE_RESTAURACION no está configurada: restaurar está DESHABILITADO.");
}

/** Registro de intentos PROPIO para la clave de restauración: separado del que
 *  cuida el login, para que un ataque contra el botón de restaurar no deje a
 *  nadie fuera de su sesión, ni al revés. */
const intentosRestauracion = crearRegistroIntentos();
```

El ciclo, junto al bloque de `ESTE_PROCESO_ES_EL_SERVIDOR` (para que **requerir** `server.js` en las pruebas no arranque relojes):

```js
/**
 * El ciclo de respaldo. Revisa cada 5 minutos, respalda si va atrasado.
 *
 * `unref()` para que este temporizador NO impida que el proceso termine: sin
 * eso, Render se quedaría esperando en cada redespliegue.
 *
 * Todo va dentro de try/catch: un respaldo que falla NUNCA debe tumbar el
 * backend ni interrumpir una venta. La tienda siempre puede seguir vendiendo.
 */
async function cicloRespaldo() {
  if (!LLAVE_RESPALDO) return;
  // Mientras se restaura, el reloj se calla. Respaldar a media restauración
  // guardaría una foto de un estado que no es ni el viejo ni el nuevo.
  if (mantenimiento.estaActivo()) return;
  try {
    const veredicto = debeRespaldar(DB.respaldos, Date.now());
    if (veredicto.respaldar) {
      const copia = await crearRespaldo(DB, drive, { tipo: veredicto.tipo, llave: LLAVE_RESPALDO });
      console.log(`💾 Respaldo ${copia.tipo} ${copia.nombre_archivo} (${veredicto.motivo})`);
      await limpiarViejos(DB, drive, Date.now());
      // La verificación que de verdad cuenta: se baja de Drive el punto del día
      // y se comprueba. Solo en los "dia" para no duplicar tráfico cada hora.
      if (copia.tipo === "dia") {
        const v = await verificarRespaldo(DB, drive, copia.id, LLAVE_RESPALDO);
        if (!v.ok) console.error("⚠️  Respaldo NO verificado:", v.diferencias.join("; "));
      }
      guardar(DB);
    }
  } catch (e) {
    console.error("⚠️  Falló el ciclo de respaldo:", e.message);
    Sentry.captureException(e);
    try { guardar(DB); } catch (_) {} // conserva la copia marcada "fallido"
  }
}

if (ESTE_PROCESO_ES_EL_SERVIDOR) {
  const temporizador = setInterval(cicloRespaldo, INTERVALO_REVISION_MS);
  if (typeof temporizador.unref === "function") temporizador.unref();
  // Un primer intento al arrancar: si el proceso estuvo caído, se pone al
  // corriente ya, sin esperar los 5 minutos.
  setTimeout(cicloRespaldo, 10_000).unref();
}
```

> **Verificado:** `Sentry` ya está en el ámbito de `server.js` (`const Sentry = require("@sentry/node");`, línea 20). No hay que importarlo de nuevo.
>
> **Sí falta `crypto`:** `server.js` **no** lo requiere hoy. Agregar `const crypto = require("crypto");` junto a los demás requires — lo necesitan las dos rutas con token de la Task 7 y de la Task 9.

- [ ] **Step 6bis: El middleware que congela el sistema mientras se restaura**

**Decisión de Victor (2026-08-12).** El diseño original solo avisaba en rojo en la
pantalla y confiaba en que nadie estuviera cobrando. Victor pidió que el sistema se
bloquee solo. El interruptor ya existe (`backend/mantenimiento.js`, Task 6); esto es
lo que lo hace valer para todo el backend.

En `backend/server.js`, **antes de todas las rutas de la aplicación** (después de los
parsers de cuerpo y de CORS, junto a los otros middlewares globales):

```js
const mantenimiento = require("./mantenimiento");

/**
 * Mientras se restaura un respaldo, el sistema no acepta escrituras.
 *
 * Solo se frenan los métodos que MUTAN. Las lecturas siguen pasando a propósito:
 * la propia pantalla de Respaldos necesita consultar el estado para mostrar el
 * aviso, y una cajera que tiene la pantalla abierta debe poder ver por qué no la
 * dejan cobrar, en vez de encontrarse con un sistema que no responde.
 *
 * Esto también cierra el doble clic en "Restaurar": la segunda petición se topa
 * con el bloqueo que puso la primera.
 */
const METODOS_QUE_ESCRIBEN = new Set(["POST", "PUT", "PATCH", "DELETE"]);

app.use((req, res, next) => {
  if (!mantenimiento.estaActivo() || !METODOS_QUE_ESCRIBEN.has(req.method)) return next();
  const info = mantenimiento.estado();
  return res.status(503).json({
    error:
      info.motivo ||
      "El sistema está en mantenimiento. Espera un momento y vuelve a intentar.",
    mantenimiento: true,
  });
});
```

Y agregar a `backend/respaldosRutas.test.js` (le pega a las rutas REALES vía
`require("./server")`):

```js
const mantenimiento = require("./mantenimiento");

test("con el sistema en mantenimiento, una venta recibe 503 y NO se registra", async () => {
  const token = firmarToken({ id: 1, nombre: "Victor", rol_id: 1, sucursal_id: null });
  mantenimiento.activar("Restaurando el respaldo del 2026-08-11 16:00");
  try {
    const r = await fetch(`${base}/api/ventas`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ sucursal_id: 1, lineas: [] }),
    });
    assert.strictEqual(r.status, 503);
    const cuerpo = await r.json();
    assert.strictEqual(cuerpo.mantenimiento, true);
    assert.match(cuerpo.error, /Restaurando|mantenimiento/i);
  } finally {
    mantenimiento.desactivar();
  }
});

test("en mantenimiento las LECTURAS siguen pasando (para poder ver por qué)", async () => {
  const token = firmarToken({ id: 1, nombre: "Victor", rol_id: 1, sucursal_id: null });
  mantenimiento.activar("Restaurando");
  try {
    const r = await fetch(`${base}/api/respaldos/estado`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.strictEqual(r.status, 200);
    const cuerpo = await r.json();
    assert.strictEqual(cuerpo.mantenimiento.activo, true);
  } finally {
    mantenimiento.desactivar();
  }
});

test("apagado el mantenimiento, las escrituras vuelven solas", async () => {
  const token = firmarToken({ id: 1, nombre: "Victor", rol_id: 1, sucursal_id: null });
  mantenimiento.activar("x");
  mantenimiento.desactivar();
  const r = await fetch(`${base}/api/ventas`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ sucursal_id: 1, lineas: [] }),
  });
  assert.notStrictEqual(r.status, 503, "el bloqueo se quedó pegado");
});
```

> Ajusta el nombre del helper de token y de `base` a como los tenga ya el archivo de
> pruebas de rutas; lo que no se negocia son los tres comportamientos: **503 al
> escribir, 200 al leer, y que se destrabe al apagarlo.**

**Verificación por mutación:** quitar el `app.use` del middleware debe poner roja la
primera prueba. Si no la pone, el middleware quedó colgado después de las rutas —
en Express el orden de registro ES el comportamiento. Revertir.

- [ ] **Step 7: Agregar las 6 rutas**

Junto a las rutas de depósitos (`backend/server.js:1325`):

```js
// ---------- Respaldos y punto de restauración ----------

app.get("/api/respaldos", requiereLogin, requierePermiso("ver_respaldos", resolverPermisosDeRol), (req, res) => {
  // Sin alcance de sucursal: un respaldo es de toda la empresa.
  res.json(
    [...DB.respaldos.copias]
      .sort((a, b) => b.fecha_hora.localeCompare(a.fecha_hora))
      .map(({ drive_file_id, ...resto }) => resto) // el id de Drive no sale al frontend
  );
});

app.get("/api/respaldos/estado", requiereLogin, requierePermiso("ver_respaldos", resolverPermisosDeRol), (req, res) => {
  res.json({
    ...estadoRespaldos(DB),
    respaldo_configurado: !!LLAVE_RESPALDO,
    restauracion_habilitada: claveRestauracionConfigurada(),
    mantenimiento: mantenimiento.estado(),
  });
});

app.post("/api/respaldos/ahora", requiereLogin, requierePermiso("ver_respaldos", resolverPermisosDeRol), requiereAlcanceGlobal(resolverPermisosDeRol), async (req, res) => {
  try {
    if (!LLAVE_RESPALDO) throw new Error("RESPALDO_LLAVE no está configurada en el servidor");
    const copia = await crearRespaldo(DB, drive, { tipo: "hora", llave: LLAVE_RESPALDO, usuario: req.usuarioToken });
    res.json(copia);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get("/api/respaldos/:id/comparar", requiereLogin, requierePermiso("restaurar_respaldo", resolverPermisosDeRol), requiereAlcanceGlobal(resolverPermisosDeRol), (req, res) => {
  try {
    const copia = DB.respaldos.copias.find((c) => c.id === Number(req.params.id));
    if (!copia) throw new Error("Respaldo no encontrado");
    res.json({ copia: { ...copia, drive_file_id: undefined }, ...compararConEstadoActual(DB, copia) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/api/respaldos/:id/restaurar", requiereLogin, requierePermiso("restaurar_respaldo", resolverPermisosDeRol), requiereAlcanceGlobal(resolverPermisosDeRol), async (req, res) => {
  const usuario = req.usuarioToken?.usuario || `id:${req.usuarioToken?.id}`;
  try {
    // El bloqueo se consulta ANTES de tocar la clave, igual que en el login.
    const bloqueo = estaBloqueado(intentosRestauracion, usuario);
    if (bloqueo.bloqueado) {
      return res.status(429).json({
        error: `Demasiados intentos fallidos. Vuelve a intentar en ${Math.ceil(bloqueo.restanteMs / 60000)} minutos.`,
      });
    }
    if (!LLAVE_RESPALDO) throw new Error("RESPALDO_LLAVE no está configurada en el servidor");

    const resultado = await restaurar(DB, drive, {
      copiaId: req.params.id,
      llave: LLAVE_RESPALDO,
      clave: req.body?.clave,
      confirmacion: req.body?.confirmacion,
      usuario: req.usuarioToken,
    });
    registrarExito(intentosRestauracion, usuario);
    res.json({
      ok: true,
      restaurado_a: `${resultado.copia.fecha} ${resultado.copia.hora_local}`,
      respaldo_previo: resultado.pre_restauracion.nombre_archivo,
      aviso: "Todos los usuarios conectados tienen que volver a iniciar sesión.",
    });
  } catch (e) {
    // Solo un fallo de CLAVE cuenta para el bloqueo. Un archivo corrupto o un
    // Drive caído no son un ataque, y contarlos dejaría a Victor fuera de su
    // propio botón justo el día que lo necesita.
    if (/clave de restauración/i.test(e.message)) registrarFallo(intentosRestauracion, usuario);
    res.status(400).json({ error: e.message });
  }
});

/**
 * Descarga cruda para el script de la PC de Victor. Sin sesión, porque la corre
 * una tarea programada de Windows sin nadie enfrente.
 *
 * Es segura porque: (a) devuelve SOLO bytes cifrados — sin RESPALDO_LLAVE son
 * ruido; (b) el token se compara en tiempo constante; (c) sin la variable
 * configurada responde 404, no 401: no confirma ni que la ruta exista.
 */
app.get("/api/respaldos/:id/descargar", async (req, res) => {
  const esperado = process.env.TOKEN_DESCARGA_RESPALDOS;
  const dado = req.get("X-Token-Respaldo") || "";
  if (!esperado || !dado) return res.status(404).json({ error: "No encontrado" });

  const a = crypto.createHash("sha256").update(dado).digest();
  const b = crypto.createHash("sha256").update(esperado).digest();
  if (!crypto.timingSafeEqual(a, b)) return res.status(404).json({ error: "No encontrado" });

  try {
    const copia = DB.respaldos.copias.find((c) => c.id === Number(req.params.id));
    if (!copia || !copia.drive_file_id) return res.status(404).json({ error: "No encontrado" });
    const bytes = await drive.descargarArchivoDeDrive(DB, copia.drive_file_id);
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${copia.nombre_archivo}"`);
    res.send(bytes);
  } catch (e) { res.status(500).json({ error: "No se pudo descargar" }); }
});
```

> **Confirmado por lectura del código:** `server.js` **no** requiere `crypto` hoy. Hay que agregar `const crypto = require("crypto");` junto a los demás requires, o estas rutas revientan al primer llamado.
>
> **También confirmado:** `firmarToken` sí está exportado desde `backend/auth.js` (línea 283) y `server.js` ya termina con `module.exports = app` (línea 1626), así que las pruebas de rutas pueden requerirlo sin abrir el puerto.

- [ ] **Step 8: Correr las pruebas de rutas y la suite completa**

Run: `cd backend && node --test respaldosRutas.test.js`
Expected: PASS

Run: `cd backend && node --test`
Expected: PASS — las 559 anteriores + las nuevas.

- [ ] **Step 9: Arrancar el servidor de verdad y confirmar los avisos**

```bash
cd backend && node server.js
```
Expected en consola: `⚠️  RESPALDO_LLAVE no está configurada: EL SISTEMA NO SE ESTÁ RESPALDANDO.` y `⚠️  CLAVE_RESTAURACION no está configurada: restaurar está DESHABILITADO.`
Luego con la llave puesta:
```bash
cd backend && RESPALDO_LLAVE=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") node server.js
```
Expected: `✅ Respaldos automáticos activos (cada hora, cifrados)`. Cortar con Ctrl+C y confirmar que el proceso **termina** (si se queda colgado, falta el `unref()`).

- [ ] **Step 10: Commit**

```bash
git add backend/server.js backend/respaldosRutas.test.js
git commit -m "feat(respaldos): rutas REST, ciclo automatico cada hora y avisos de arranque"
```

---

## Task 8: La pantalla

**Files:**
- Create: `src/Respaldos.jsx`
- Modify: `src/Dashboard.jsx`, `src/App.jsx`, `src/EncabezadoModulo.jsx`

**Interfaces:**
- Consumes: `apiFetch`, `API` de `src/api.js`; las 5 rutas con sesión de la Task 7
- Produces: componente `<Respaldos onVolver permisos usuario />`

**El repo no tiene arnés de pruebas de frontend** (convención existente). La verificación es el build limpio + la vuelta manual del Task 9.

- [ ] **Step 1: Crear `src/Respaldos.jsx`**

Seguir la estructura de `src/EstadoCuenta.jsx` (encabezado, tabla, modal). Requisitos que **no** se negocian:

1. **Semáforo arriba**, leyendo `GET /api/respaldos/estado`:
   - 🟢 `Último respaldo hace {minutos_desde_ultimo} minutos` cuando `alerta === false`
   - 🔴 `Sin respaldar desde hace {n} horas` cuando `alerta === true` **y `minutos_desde_ultimo !== null`**
   - 🔴 `Nunca se ha hecho un respaldo` cuando `minutos_desde_ultimo === null` — es el caso de un sistema recién desplegado, y es **el primer momento en que alguien va a mirar esta pantalla**. Sin este caso aparte, el renglón dice "hace null horas" o "hace NaN horas" (agregado por el escaneo previo del 2026-08-12).
   - El estado viene con `total_copias` (número), **no** con `copias` ni con `conectado` — la revisión de la Task 3 confirmó los campos reales: `{ ultimo_exitoso, ultimo_intento, minutos_desde_ultimo, alerta, total_copias }`. Si hace falta mostrar si Drive está conectado, eso sale aparte de `drive.js`, no de aquí.
   - 🔴 `El sistema NO se está respaldando — falta configurar la llave en el servidor` cuando `respaldo_configurado === false`
2. **Dos listas**: "Puntos de restauración (30 días)" filtrando `tipo !== "hora"`, y "Detalle por hora (7 días)" filtrando `tipo === "hora"`. Columnas: fecha, hora, tamaño, ventas, productos, clientes, verificado.
3. **Ningún botón de borrar.** La única forma de que un respaldo desaparezca es la rueda de retención.
4. **Botón "Restaurar"** por renglón **en LAS DOS listas** — tanto en los puntos de restauración de 30 días como en el detalle por hora de 7 días, con el mismo gate de permisos. El diseño promete que Victor puede "afinar por hora" y el backend no distingue por `tipo`; dejar la lista por hora sin botón rompería ese requisito en silencio (aclarado por el escaneo previo del 2026-08-12). Solo se muestra **si** `permisos.includes("restaurar_respaldo") && permisos.includes("ver_todas_las_sucursales") && estado.restauracion_habilitada`. Si `restauracion_habilitada === false`, mostrar en su lugar el texto: *"Restaurar está deshabilitado: falta configurar la clave en el servidor."*
   > **El gate del frontend debe coincidir EXACTAMENTE con el de la ruta** (`requierePermiso("restaurar_respaldo")` + `requiereAlcanceGlobal`, Task 7). Un botón visible que rebota con 403, o un botón escondido a quien sí puede usarlo, son las dos mitades del mismo defecto.
5. **Modal de restauración** con `max-h-[92vh] flex flex-col overflow-hidden`, cuerpo `flex-1 min-h-0 overflow-y-auto`, encabezado y pie `shrink-0`. Contiene, en orden:
   - El resultado de `GET /api/respaldos/:id/comparar`: *"Vas a volver al estado del {fecha} {hora}."* y el `resumen`.
   - Aviso en rojo: **"Al restaurar, todos los usuarios conectados tienen que volver a entrar. Si hay cajeras vendiendo, se les corta la venta."**
   - Campo de **clave de restauración** (`type="password"`, `autoComplete="off"`).
   - Campo donde hay que escribir `RESTAURAR`.
   - Botón rojo **deshabilitado** hasta que el texto sea exactamente `RESTAURAR` y la clave no esté vacía. Con `type="submit"` explícito.
6. **Botón "Respaldar ahora"** contra `POST /api/respaldos/ahora`, visible solo si `permisos.includes("ver_respaldos") && permisos.includes("ver_todas_las_sucursales")` — el mismo par que exige la ruta (`requierePermiso("ver_respaldos")` + `requiereAlcanceGlobal`). No usar `restaurar_respaldo` aquí: es otro permiso y produciría un botón que rebota.
7. La clave **nunca** se guarda en estado persistente ni en `localStorage`; se limpia al cerrar el modal.
7bis. **El botón de restaurar se deshabilita mientras la petición está en vuelo** (un doble clic dispararía dos restauraciones y dos respaldos previos). Y si la ruta responde **429** (Task 7 bloquea tras 5 intentos de clave fallidos), mostrar el mensaje que devuelve el servidor — los minutos que faltan — dentro del modal, sin cerrarlo y sin borrar lo que Victor ya escribió, salvo la clave (agregado por el escaneo previo del 2026-08-12).
8. Tras una restauración exitosa, mostrar el aviso devuelto y **mandar al login** (`localStorage.removeItem("token")` + recargar), porque los usuarios y roles acaban de cambiar.
9. **Aviso de mantenimiento** (decisión de Victor, 2026-08-12): `GET /api/respaldos/estado` ahora devuelve también `mantenimiento: { activo, motivo, desde }`. Cuando `activo === true`, mostrar una banda amarilla fija arriba con el `motivo` y **deshabilitar los botones "Restaurar" y "Respaldar ahora"** — el backend ya rechaza esas peticiones con 503, esto solo evita que Victor las apriete en balde. El aviso en rojo del modal (punto 5) se queda: dice lo que VA a pasar; esta banda dice lo que ESTÁ pasando.

- [ ] **Step 2: Agregar el tile al Dashboard**

En `src/Dashboard.jsx`, agregar `DatabaseBackup` al import de `lucide-react` y al arreglo `MODULOS`, después de `roles`:

```js
  { id: "respaldos",  nombre: "Respaldos",              icono: DatabaseBackup, disponible: true, modulo: "respaldos", permiso: "ver_respaldos" },
```

- [ ] **Step 3: Enrutar la vista**

En `src/App.jsx`: importar `Respaldos from "./Respaldos.jsx"`, agregar `"respaldos"` al arreglo `MODULOS` (línea 18), y agregar el bloque:

```jsx
        {vista === "respaldos" && (
          <Respaldos onVolver={() => setVista("dashboard")} permisos={usuario.permisos} usuario={usuario} />
        )}
```

En `src/EncabezadoModulo.jsx`, agregar a `TITULOS`: `respaldos: "Respaldos",`

- [ ] **Step 4: Build limpio**

Run: `npm run build`
Expected: sin errores ni advertencias nuevas.

- [ ] **Step 5: Commit**

```bash
git add src/Respaldos.jsx src/Dashboard.jsx src/App.jsx src/EncabezadoModulo.jsx
git commit -m "feat(respaldos): pantalla de vigilancia con semaforo y restauracion protegida"
```

---

## Task 9: La copia local en la PC de Victor

**Files:**
- Create: `scripts/respaldo-local.mjs`, `scripts/respaldo-local.cmd`, `docs/RESPALDOS.md`

**Interfaces:**
- Consumes: `GET /api/respaldos` y `GET /api/respaldos/:id/descargar` (Task 7)

**Se pone al corriente:** si la PC estuvo apagada tres días, baja las tres diarias que faltaron, no solo la de hoy. Es casi el mismo trabajo y quita el hueco.

**Los archivos locales quedan CIFRADOS.** Para abrirlos hace falta `RESPALDO_LLAVE`, que Victor tiene anotada en papel. Es a propósito: una laptop robada no entrega la empresa.

- [ ] **Step 1: Escribir `scripts/respaldo-local.mjs`**

```js
/**
 * respaldo-local.mjs — Baja a esta PC los puntos de restauración que le falten.
 *
 * Se pone AL CORRIENTE: compara lo que hay en la carpeta local contra lo que
 * hay en el servidor y baja todo lo que falte. Si la máquina estuvo apagada
 * tres días, al prender recupera los tres, no solo el de hoy.
 *
 * Los archivos quedan CIFRADOS. Para leerlos hace falta RESPALDO_LLAVE, que
 * Victor tiene anotada aparte. Una laptop robada no entrega la empresa.
 *
 * Configuración: archivo respaldo-local.config.json junto a este script:
 *   { "api": "https://punto-de-venta-backend.onrender.com/api",
 *     "token": "...",                      // TOKEN_DESCARGA_RESPALDOS de Render
 *     "carpeta": "C:\\Respaldos CORPUNISOUND",
 *     "diasAConservar": 90 }
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RUTA_CONFIG = path.join(AQUI, "respaldo-local.config.json");

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function main() {
  let config;
  try {
    config = JSON.parse(await fs.readFile(RUTA_CONFIG, "utf8"));
  } catch (e) {
    log(`ERROR: no se pudo leer ${RUTA_CONFIG} — ${e.message}`);
    process.exit(1);
  }
  const { api, token, carpeta, diasAConservar = 90 } = config;
  if (!api || !token || !carpeta) {
    log("ERROR: la configuración necesita api, token y carpeta.");
    process.exit(1);
  }

  await fs.mkdir(carpeta, { recursive: true });
  const yaTengo = new Set(await fs.readdir(carpeta));

  // El índice se pide con el token de descarga, igual que los archivos.
  const r = await fetch(`${api}/respaldos/indice`, { headers: { "X-Token-Respaldo": token } });
  if (!r.ok) {
    log(`ERROR: el servidor respondió ${r.status} al pedir el índice.`);
    process.exit(1);
  }
  const copias = await r.json();

  // Solo los puntos de restauración (los del día y los pre_restauracion). El
  // detalle por hora vive 7 días en Drive y no vale la pena duplicarlo aquí.
  const aBajar = copias
    .filter((c) => c.tipo !== "hora" && c.estado === "ok")
    .filter((c) => !yaTengo.has(c.nombre_archivo));

  if (!aBajar.length) {
    log(`Al corriente: ${yaTengo.size} respaldos locales, nada nuevo que bajar.`);
  }

  let bajados = 0;
  for (const c of aBajar) {
    try {
      const rr = await fetch(`${api}/respaldos/${c.id}/descargar`, { headers: { "X-Token-Respaldo": token } });
      if (!rr.ok) { log(`AVISO: ${c.nombre_archivo} respondió ${rr.status}, se salta.`); continue; }
      const bytes = Buffer.from(await rr.arrayBuffer());
      // Se escribe a un temporal y se renombra: así un corte a media descarga
      // nunca deja un archivo a medias con nombre de archivo bueno.
      const temporal = path.join(carpeta, `.${c.nombre_archivo}.parcial`);
      await fs.writeFile(temporal, bytes);
      await fs.rename(temporal, path.join(carpeta, c.nombre_archivo));
      log(`Bajado ${c.nombre_archivo} (${bytes.length} bytes)`);
      bajados++;
    } catch (e) {
      log(`AVISO: falló ${c.nombre_archivo} — ${e.message}`);
    }
  }

  // Limpieza local, con la misma red que el servidor: nunca dejar la carpeta
  // vacía. Si algo sale mal con las fechas, mejor archivos de más.
  // OJO (corregido por el escaneo previo, 2026-08-12): la versión anterior de
  // este bloque prometía "nunca dejar la carpeta vacía" y NO lo cumplía.
  // Comparaba `archivos.length > 1` dentro del loop contra una foto fija tomada
  // ANTES de empezar a borrar: ese número nunca bajaba, así que con 5 archivos
  // todos vencidos borraba los 5 y dejaba la carpeta vacía — justo el caso en
  // que la protección importa. Ahora se ordena por fecha y el índice 0 (el más
  // nuevo) queda fuera del loop: no hay conteo del que depender.
  const limite = Date.now() - diasAConservar * 24 * 60 * 60 * 1000;
  const nombres = (await fs.readdir(carpeta)).filter((n) => n.endsWith(".respaldo"));
  const conFecha = await Promise.all(
    nombres.map(async (n) => ({
      n,
      mtimeMs: (await fs.stat(path.join(carpeta, n))).mtimeMs,
    }))
  );
  conFecha.sort((a, b) => b.mtimeMs - a.mtimeMs); // el más nuevo primero
  for (let i = 1; i < conFecha.length; i++) {      // el índice 0 NUNCA se toca
    if (conFecha[i].mtimeMs < limite) {
      await fs.unlink(path.join(carpeta, conFecha[i].n));
      log(`Borrado por antigüedad: ${conFecha[i].n}`);
    }
  }

  log(`Listo. ${bajados} nuevos, ${(await fs.readdir(carpeta)).length} en total.`);
}

main().catch((e) => { log("ERROR: " + e.message); process.exit(1); });
```

- [ ] **Step 2: Agregar la ruta del índice al backend**

El script necesita listar sin sesión. En `backend/server.js`, junto a la ruta de descarga, **reutilizando el mismo candado**:

```js
/** Índice para el script de la PC. Mismo token y mismo 404-si-no-cuadra que la
 *  ruta de descarga. Devuelve solo lo que el script necesita para decidir qué
 *  bajar — ningún dato del negocio. */
app.get("/api/respaldos/indice", (req, res) => {
  const esperado = process.env.TOKEN_DESCARGA_RESPALDOS;
  const dado = req.get("X-Token-Respaldo") || "";
  if (!esperado || !dado) return res.status(404).json({ error: "No encontrado" });
  const a = crypto.createHash("sha256").update(dado).digest();
  const b = crypto.createHash("sha256").update(esperado).digest();
  if (!crypto.timingSafeEqual(a, b)) return res.status(404).json({ error: "No encontrado" });

  res.json(DB.respaldos.copias.map((c) => ({
    id: c.id, tipo: c.tipo, fecha: c.fecha, hora_local: c.hora_local,
    nombre_archivo: c.nombre_archivo, bytes: c.bytes, estado: c.estado,
  })));
});
```

> **Cuidado con el orden de las rutas en Express:** `/api/respaldos/indice` debe declararse **ANTES** que `/api/respaldos/:id/descargar`, o `indice` se leerá como un `:id`.

- [ ] **Step 3: Escribir el envoltorio `scripts/respaldo-local.cmd`**

```bat
@echo off
REM Copia local diaria de los respaldos de CORPUNISOUND.
REM La corre la tarea programada CORPUNISOUND-Respaldo-Local.
cd /d "%~dp0"
node respaldo-local.mjs >> "%~dp0respaldo-local.log" 2>&1
```

- [ ] **Step 4: Probar el script a mano contra producción**

```bash
cd "C:/Users/Victor/Desktop/CORPUNISOUND/scripts" && node respaldo-local.mjs
```
Expected: baja los puntos de restauración a la carpeta configurada y los lista en el log. Correrlo **dos veces**: la segunda debe decir *"Al corriente"* y no bajar nada.

- [ ] **Step 5: Crear la tarea programada de Windows**

Mismo patrón que `CORPUNISOUND-Graphify-Daily`. Victor la corre en PowerShell **como administrador**:

```powershell
schtasks /Create /TN "CORPUNISOUND-Respaldo-Local" /TR "C:\Users\Victor\Desktop\CORPUNISOUND\scripts\respaldo-local.cmd" /SC DAILY /ST 20:00 /RL HIGHEST /F
```

Y para que se ejecute al prender si la PC estaba apagada a esa hora:

```powershell
schtasks /Change /TN "CORPUNISOUND-Respaldo-Local" /Z /V1
```

> **Ojo:** esta tarea vive **fuera de git**, a nivel del sistema operativo. Si Victor cambia de PC o reinstala Windows, hay que recrearla — igual que la de graphify.

- [ ] **Step 6: Escribir `docs/RESPALDOS.md`**

Documento para Victor, en español claro, con:
1. **Qué se respalda y qué no** (los comprobantes ya están en Drive; el catálogo SAT se rebaja solo).
2. **Cómo generar `RESPALDO_LLAVE`** y **dónde anotarla** — papel en caja fuerte **y** gestor de contraseñas. Con la advertencia: *sin esa llave, ningún respaldo se puede abrir; ni Google ni nadie puede recuperarla.*
3. **Cómo poner `CLAVE_RESTAURACION`** en Render, y que sin ella el botón de restaurar no existe.
4. **Cómo restaurar** paso a paso, con la advertencia de que corta las sesiones.
5. **Cómo se deshace una restauración equivocada**: buscar el respaldo `pre_restauracion` de esa fecha y restaurarlo.
6. **Qué hacer si el semáforo está rojo**: revisar la conexión de Drive en Roles y Personal, revisar el correo de Sentry, revisar que `RESPALDO_LLAVE` siga puesta en Render.
7. **El hueco que sigue abierto:** las llaves del sistema no están respaldadas y no hay instructivo para levantar todo en un servidor nuevo. Con enlace al spec.

- [ ] **Step 7: Commit**

```bash
git add scripts/respaldo-local.mjs scripts/respaldo-local.cmd docs/RESPALDOS.md backend/server.js
git commit -m "feat(respaldos): copia local diaria que se pone al corriente, e instructivo para Victor"
```

---

## Cierre de la rama

- [ ] Correr la suite completa: `cd backend && node --test` — **todo verde**
- [ ] Build de frontend: `npm run build` — **limpio**
- [ ] Arrancar el backend de verdad y confirmar los tres avisos de arranque
- [ ] **Revisión final de toda la rama** con un revisor independiente (`superpowers:requesting-code-review`). No saltársela aunque cada tarea ya haya pasado la suya: es la que atrapa lo que cruza varias tareas — fue la que encontró el bug CRITICAL de la carrera de folio en Gastos y el `total_sin_resolver` mal definido en el reporte de garantías.
- [ ] **Antes de desplegar, Victor configura en Render:** `RESPALDO_LLAVE`, `CLAVE_RESTAURACION` y `TOKEN_DESCARGA_RESPALDOS`. Sin la primera el sistema arranca pero **no respalda**.
- [ ] **⚠️ NO tocar `render.yaml`.** El servicio está marcado "Blueprint managed" y el archivo del repo está desactualizado (`plan: free`, sin disco). Cualquier edición puede disparar una resincronización que **borre el disco con todos los datos**. Las variables se agregan **desde el panel de Render**, a mano.
- [ ] Tras el deploy, dar una vuelta manual: ver el semáforo en verde, apretar "Respaldar ahora", abrir la carpeta `Respaldos del Sistema` en Drive, y correr el script local dos veces.

---

## Auto-revisión del plan

**Cobertura del spec** — cada requisito tiene tarea:

| Requisito del spec | Tarea |
|---|---|
| Copias cada hora, reloj en el backend | 2, 7 |
| Reloj que confía en el registro | 2 |
| Puntos del día 4pm/5pm hora de Chiapas | 2 |
| Cifrado AES-256-GCM, llave en Render | 1, 7 |
| Falla ruidoso si falta `RESPALDO_LLAVE` | 7 |
| Compresión antes de cifrar | 1 |
| Etiqueta de identidad con conteos | 3 |
| `version_formato` y rechazo de versión desconocida | 5 |
| Carpeta `Respaldos del Sistema` en Drive | 3 |
| Retención 30 días / 7 días por hora | 4 |
| Nunca borrar el más reciente | 4 |
| Módulo `respaldos` + 2 permisos propios | 7 |
| `requiereAlcanceGlobal` en restaurar | 7 |
| Clave de restauración fuera del sistema | 6, 7 |
| Falla cerrado sin `CLAVE_RESTAURACION` | 6, 7 |
| Comparación de tiempo constante | 6 |
| Bloqueo tras 5 intentos, registro propio | 7 |
| Aviso de qué se pierde | 6, 8 |
| Auto-respaldo `pre_restauracion` previo | 6 |
| Escribir `RESTAURAR` | 6, 8 |
| Bitácora de quién y cuándo | 6 |
| `DB.respaldos` no se restaura | 6 |
| Validar todo antes de mutar nada | 5, 6 |
| Aviso de que caen las sesiones | 8 |
| Pantalla de vigilancia con semáforo | 8 |
| Sin botón de borrar | 8 |
| Verificación al crear y diaria contra Drive | 3, 5, 7 |
| Errores a Sentry, nunca tumbar el backend | 7 |
| Copia local diaria que se pone al corriente | 9 |
| Instructivo para Victor | 9 |

**Consistencia de nombres** — verificada de punta a punta: `empaquetar`/`desempaquetar` (T1) se usan igual en T3/T5; `debeRespaldar` devuelve `{respaldar, tipo, motivo}` y T7 lee `veredicto.tipo` y `veredicto.motivo`; `crearRespaldo(DB, drive, {tipo, llave, usuario})` con la misma firma en T3, T6 y T7; `copia.hora_local` en formato `"HH:MM"` lo produce T3 y lo consumen T2 (`.slice(0,2)`), T6 y T8; `COLECCIONES_RESPALDADAS` se define en T3 y la usan T5 y T6.

**Sin placeholders:** todo paso de código trae el código real. Las dos únicas indicaciones sin código literal son la pantalla (Task 8) y el instructivo (Task 9 Step 6), ambas con requisitos numerados y explícitos, siguiendo la convención del repo de no tener arnés de pruebas de frontend.

**Riesgo señalado:** el nombre del archivo lleva `-${id}` al final para garantizar unicidad bajo concurrencia (la prueba de 12 respaldos simultáneos lo exige). Eso hace el nombre ligeramente menos limpio que el `unisound-2026-08-11-1600.respaldo` del spec, pero conserva la fecha y hora en claro, que es lo que el spec pedía de verdad: poder mirar la carpeta y confirmar de un vistazo que hay una copia de cada hora.
