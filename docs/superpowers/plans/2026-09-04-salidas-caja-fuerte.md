# Salidas de la caja fuerte — Plan de implementación

> **Para agentes ejecutores:** SUB-SKILL REQUERIDA: usar `superpowers:subagent-driven-development` (recomendado) o `superpowers:executing-plans` para implementar tarea por tarea. Los pasos usan casillas (`- [ ]`) para seguimiento.

**Goal:** Que un gasto pagado desde la caja fuerte deje de restarle al cajón de la cajera, sin que exista una segunda pantalla donde equivocarse.

**Architecture:** Un campo nuevo (`gasto.origen`) y **una sola condición** en la función que decide qué le resta al cajón. El corte, el sellado por `corte_id` y la época sellada no se tocan. El origen solo lo puede escribir quien tenga un permiso propio, porque marcar un gasto como pagado desde el resguardo baja ese saldo sin descuadrar el corte de nadie.

**Tech Stack:** Node.js + Express (datos en memoria sobre `DB`, persistidos en SQLite), React 18 + Vite + Tailwind. Pruebas con `node --test`. **Sin dependencias nuevas.**

**Spec:** `docs/superpowers/specs/2026-09-04-salidas-caja-fuerte-design.md` — léelo antes de la primera tarea; este plan argumenta desde ahí.

**Rama:** `feature/tablero-dinero` · **Worktree:** `C:/Users/Victor/Desktop/CORPUNISOUND/.claude/worktrees/tablero-dinero`

## Global Constraints

- **Sin dependencias nuevas.** Pruebas con `node --test`, nada de jest/supertest/mocha.
- **Nunca `git add .`** — staging por rutas explícitas.
- **Nada de push, merge ni rebase.** Eso lo hace Victor. Commits en la rama, sí.
- **Un implementador a la vez.** Los revisores pueden ir en paralelo.
- **Un módulo nuevo o un permiso nuevo se registra en `backend/permisosCatalogo.js`**, o el guard de arranque tumba el backend.
- Fechas solas con `fechaLocal()` (`backend/fechas.js`); marcas completas ISO en UTC.
- **Sin acentos en los mensajes de commit.** En el código y en la interfaz, los acentos SÍ van.

## BLOQUEO — leer antes de empezar

Este plan **no se puede empezar todavía**. Depende de las Tareas 4 y 5 de
`docs/superpowers/plans/2026-09-04-arreglos-revision-cajas.md`, donde el gasto pasa a declarar su
caja en el cuerpo de la petición en vez de heredarla del encabezado. Este plan agrega la tercera
pieza al mismo control.

Además, la rama `feature/tablero-dinero` está construida sobre un punto intermedio de
`feature/cajas-pos` y le faltan sus últimos commits. **Ponerla al día es una operación de Victor.**

Antes de la Tarea 1, comprobar que existe el selector de caja en `src/Gastos.jsx` y que
`POST /api/gastos` lee `req.body.caja_id`. Si no están, **detenerse y reportar** en vez de
reimplementarlos aquí.

## Decisiones ya tomadas por Victor — no volver a abrirlas

1. **Una sola puerta de captura:** Gastos. No se crea una pantalla de "Salidas de caja fuerte".
2. **Los depósitos se quedan aparte**, con su folio `DEP-`. Un depósito no es un gasto.
3. **Los traslados de efectivo entre tiendas no entran** — son el sub-proyecto 3.
4. **No se bloquea una salida mayor al resguardo disponible:** nadie calcula ese saldo todavía. Llega con el sub-proyecto 2.
5. **Los gastos ya capturados no se reescriben.** Los cortes viejos con un faltante falso se quedan como están.

---

## Estructura de archivos

| Archivo | Responsabilidad | Tareas |
|---|---|---|
| `backend/gastos.js` | El campo `origen`, la regla del corte, y la corrección | 1, 3 |
| `backend/permisosCatalogo.js` | Alta del permiso `registrar_gasto_caja_fuerte` | 2 |
| `backend/server.js` | Rechazar el origen sin permiso; ruta de corrección | 2, 3 |
| `src/Gastos.jsx` | La casilla, el aviso, la columna y el filtro | 4 |

**Orden:** la Tarea 1 sola no protege nada (cualquiera podría mandar el origen a mano), así que la
Tarea 2 es obligatoria antes de considerar esto mergeable. La 3 evita que un gasto mal capturado
quede como un faltante permanente. La 4 es lo único que ve la cajera.

---

### Task 1: El campo `origen` y la regla que arregla el faltante falso

**Por qué.** `gastosEfectivoDelTurnoLista` (`backend/gastos.js`) resta del cajón todo gasto activo en
`EFECTIVO` de esa sucursal y esa caja dentro del turno. No existe ningún concepto de origen del
dinero. Una nómina pagada desde la caja fuerte le resta a la cajera dinero que nunca salió de su
cajón, y le inventa un faltante en su corte.

**Files:**
- Modify: `backend/gastos.js` (`crearGasto`, `gastosEfectivoDelTurnoLista`)
- Test: `backend/gastosCajaFuerte.test.js` (nuevo)

**Interfaces:**
- Consumes: `esDeEstaCaja(registro, caja)` y `resolverCajaDeSucursal(DB, sucursalId, cajaId)` de `backend/cajas.js`.
- Produces: `gasto.origen` con valores `"CAJON"` o `"CAJA_FUERTE"`. **Ausente o `null` significa `"CAJON"`** — así todo lo ya capturado se comporta igual que antes, sin migrar un solo registro.

- [ ] **Step 1: Escribir las pruebas que fallan**

Crear `backend/gastosCajaFuerte.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");

const { crearGasto, gastosEfectivoDelTurno } = require("./gastos");
const { sembrarCajas } = require("./cajas");
const { construirDBPrueba } = require("./testHelpers");

/**
 * El defecto que este archivo existe para cerrar: una nomina pagada desde la
 * caja fuerte le restaba al cajon de la cajera dinero que nunca salio de ahi, y
 * le inventaba un faltante en su corte.
 */
test("un gasto pagado desde la caja fuerte NO le resta al cajon", async () => {
  const DB = construirDBPrueba();
  DB.pos.cajas = sembrarCajas(DB);
  const administrativa = DB.pos.cajas.find((c) => c.sucursal_id === 1 && c.predeterminada);

  await crearGasto(DB, { ...datosGastoDePrueba(), monto: 800, forma_pago: "EFECTIVO", origen: "CAJA_FUERTE" }, 1, usuarioDePrueba(), driveFalso(), administrativa.id);

  assert.strictEqual(gastosEfectivoDelTurno(DB, 1, null, administrativa), 0);
});

test("un gasto pagado del cajon SI le resta, como siempre", async () => {
  const DB = construirDBPrueba();
  DB.pos.cajas = sembrarCajas(DB);
  const administrativa = DB.pos.cajas.find((c) => c.sucursal_id === 1 && c.predeterminada);

  await crearGasto(DB, { ...datosGastoDePrueba(), monto: 800, forma_pago: "EFECTIVO", origen: "CAJON" }, 1, usuarioDePrueba(), driveFalso(), administrativa.id);

  assert.strictEqual(gastosEfectivoDelTurno(DB, 1, null, administrativa), 800);
});

/**
 * Ningun gasto de los ya capturados tiene `origen`. Si la ausencia no se tratara
 * como "del cajon", el primer corte despues de desplegar esto dejaria de
 * descontar TODOS los gastos historicos y le sobraria dinero a la cajera.
 */
test("un gasto sin origen cuenta como del cajon", async () => {
  const DB = construirDBPrueba();
  DB.pos.cajas = sembrarCajas(DB);
  const administrativa = DB.pos.cajas.find((c) => c.sucursal_id === 1 && c.predeterminada);

  await crearGasto(DB, { ...datosGastoDePrueba(), monto: 500, forma_pago: "EFECTIVO" }, 1, usuarioDePrueba(), driveFalso(), administrativa.id);

  assert.strictEqual(gastosEfectivoDelTurno(DB, 1, null, administrativa), 500);
});

/**
 * El resguardo tambien se lleva POR CAJA: sin esto, el tablero del sub-proyecto
 * 2 no podria dar el desglose Administrativa/Fiscal.
 */
test("el origen respeta la caja: la caja fuerte de la Fiscal no toca el corte de la Administrativa", async () => {
  const DB = construirDBPrueba();
  DB.pos.cajas = sembrarCajas(DB);
  const administrativa = DB.pos.cajas.find((c) => c.sucursal_id === 1 && c.predeterminada);
  const fiscal = DB.pos.cajas.find((c) => c.sucursal_id === 1 && !c.predeterminada);

  await crearGasto(DB, { ...datosGastoDePrueba(), monto: 300, forma_pago: "EFECTIVO", origen: "CAJA_FUERTE" }, 1, usuarioDePrueba(), driveFalso(), fiscal.id);

  assert.strictEqual(gastosEfectivoDelTurno(DB, 1, null, administrativa), 0);
  assert.strictEqual(gastosEfectivoDelTurno(DB, 1, null, fiscal), 0);
  const [gasto] = DB.gastos.gastos;
  assert.strictEqual(gasto.caja_id, fiscal.id);
  assert.strictEqual(gasto.origen, "CAJA_FUERTE");
});

test("un origen que no existe se rechaza en vez de guardarse", async () => {
  const DB = construirDBPrueba();
  DB.pos.cajas = sembrarCajas(DB);
  await assert.rejects(
    () => crearGasto(DB, { ...datosGastoDePrueba(), origen: "TOMBOLA" }, 1, usuarioDePrueba(), driveFalso(), undefined),
    /origen/i
  );
});
```

Reutiliza los helpers (`datosGastoDePrueba`, `usuarioDePrueba`, `driveFalso`) que ya use
`gastos.test.js`; impórtalos de donde estén y **no crees copias nuevas**.

- [ ] **Step 2: Correr y verificar que fallan**

Run: `cd backend && node --test gastosCajaFuerte.test.js`
Expected: FAIL — la primera da `800 !== 0`: hoy el gasto de caja fuerte sí resta.

- [ ] **Step 3: Implementar el campo**

En `backend/gastos.js`, junto a `FORMAS_PAGO_GASTO`:

```js
const ORIGENES_GASTO = ["CAJON", "CAJA_FUERTE"];
```

En `crearGasto`, después de validar la forma de pago:

```js
  // Ausente = "CAJON": todos los gastos ya capturados son del cajon, que es como
  // se han venido tratando. La absorcion de lo historico se hace por defecto, sin
  // reescribir un solo registro — mismo criterio que uso `caja_id` con las cajas.
  const origen = (datos.origen || "CAJON").toUpperCase();
  if (!ORIGENES_GASTO.includes(origen)) {
    throw new Error("El origen del dinero debe ser el cajon o la caja fuerte");
  }
```

Y guardarlo en el registro, junto a `caja_id`:

```js
    origen,
```

- [ ] **Step 4: Implementar la regla — una condición, un lugar**

En `gastosEfectivoDelTurnoLista`, junto a los filtros que ya existen:

```js
    // Lo que salio de la CAJA FUERTE no estaba en el cajon, asi que no puede
    // restarle a lo que la cajera tiene que contar. Sin esto, una nomina pagada
    // del resguardo le inventa un faltante a quien cerro la caja.
    .filter((g) => (g.origen || "CAJON") !== "CAJA_FUERTE")
```

Y sumar la condición a la lista de condiciones deliberadas del comentario de cabecera de la función
—ese comentario es el índice de la regla y tiene que quedar completo.

- [ ] **Step 5: Correr y verificar que pasan**

Run: `cd backend && node --test gastosCajaFuerte.test.js gastos.test.js gastosCorteCaja.test.js`
Expected: PASS, sin regresiones en los dos archivos que ya existían.

- [ ] **Step 6: Suite completa y commit**

```bash
cd backend && node --test
cd .. && npx eslint src backend
git add backend/gastos.js backend/gastosCajaFuerte.test.js
git commit -m "fix(gastos): lo que sale de la caja fuerte ya no le resta al cajon de la cajera"
```

---

### Task 2: El permiso propio para marcar un gasto como pagado desde la caja fuerte

**Por qué.** Quien marca un gasto como pagado desde el resguardo **baja ese saldo sin que el corte de
nadie se descuadre** — precisamente porque ese gasto no le resta a ninguna cajera. Con un comprobante
falso, es la forma más limpia de sacar dinero de la caja fuerte sin dejar una señal contable.
Separarlo del permiso de registrar gastos cuesta una línea y cierra el hueco desde el principio.

Sin la Tarea 2, la Tarea 1 no protege nada: cualquiera podría mandar el origen a mano.

**Files:**
- Modify: `backend/permisosCatalogo.js`
- Modify: `backend/server.js` (ruta `POST /api/gastos`)
- Test: `backend/gastosCajaFuerte.test.js`

**Interfaces:**
- Consumes: `resolverPermisosDeRol(rolId)` devuelve un arreglo de claves de permiso.
- Produces: permiso `registrar_gasto_caja_fuerte`, módulo `gastos`.

- [ ] **Step 1: Escribir las pruebas que fallan**

```js
/**
 * Se RECHAZA, no se degrada a "CAJON" en silencio. Guardar algo distinto de lo
 * que la persona declaro es peor que negarse: el gasto quedaria restandole a una
 * cajera que no lo pago, y quien lo capturo creeria que hizo lo correcto.
 */
test("sin el permiso, un origen de caja fuerte mandado a mano se rechaza", async () => {
  const { servidor, token } = await levantarServidorDePrueba({ permisos: ["registrar_gastos"] });
  const r = await fetch(`${servidor}/api/gastos`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ...datosGastoDePrueba(), origen: "CAJA_FUERTE" }),
  });

  assert.strictEqual(r.status, 403);
});

test("con el permiso, el gasto de caja fuerte se registra", async () => {
  const { servidor, token } = await levantarServidorDePrueba({
    permisos: ["registrar_gastos", "registrar_gasto_caja_fuerte"],
  });
  const r = await fetch(`${servidor}/api/gastos`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ...datosGastoDePrueba(), origen: "CAJA_FUERTE" }),
  });

  assert.strictEqual(r.status, 200);
  assert.strictEqual((await r.json()).origen, "CAJA_FUERTE");
});

test("un gasto normal sigue necesitando solo registrar_gastos", async () => {
  const { servidor, token } = await levantarServidorDePrueba({ permisos: ["registrar_gastos"] });
  const r = await fetch(`${servidor}/api/gastos`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(datosGastoDePrueba()),
  });

  assert.strictEqual(r.status, 200);
});
```

Usa el helper de servidor de prueba que ya exista en el repo (`cajasRuta.test.js` levanta uno; sigue
ese patrón). **No inventes uno nuevo si ya hay.**

- [ ] **Step 2: Correr y verificar que fallan**

Run: `cd backend && node --test gastosCajaFuerte.test.js`
Expected: FAIL — la primera devuelve 200 en vez de 403.

- [ ] **Step 3: Dar de alta el permiso**

En `backend/permisosCatalogo.js`, junto a los demás del módulo `gastos`, siguiendo exactamente la
forma que ya tengan los vecinos:

```js
  { clave: "registrar_gasto_caja_fuerte", nombre: "Registrar Gasto Pagado desde la Caja Fuerte", modulo: "gastos" },
```

- [ ] **Step 4: Rechazar en la ruta**

En `backend/server.js`, dentro de `POST /api/gastos`, antes de llamar a `crearGasto`:

```js
    // El origen "CAJA_FUERTE" baja el dinero resguardado SIN descuadrar el corte
    // de nadie: no le resta a ninguna cajera. Por eso lleva permiso propio, y por
    // eso se RECHAZA en vez de degradarse a "CAJON" en silencio.
    if (String(req.body.origen || "").toUpperCase() === "CAJA_FUERTE") {
      const permisos = resolverPermisosDeRol(req.usuarioToken.rol_id);
      if (!Array.isArray(permisos) || !permisos.includes("registrar_gasto_caja_fuerte")) {
        return res.status(403).json({ error: "No tienes permiso para registrar un gasto pagado desde la caja fuerte" });
      }
    }
```

- [ ] **Step 5: Correr y verificar que pasan**

Run: `cd backend && node --test gastosCajaFuerte.test.js`
Expected: PASS, los tres casos.

- [ ] **Step 6: Comprobar que la prueba sirve (verificación por mutación)**

Cambiar temporalmente la clave del `includes` por `"registrar_gastos"` y correr: **la primera prueba
debe ponerse roja**. **Revertir la mutación en este mismo turno** — hay precedente de dos sesiones
muertas dejando código mutado sin commitear, y una costó una sesión entera de diagnóstico.

- [ ] **Step 7: Comprobar que el arranque no se cae**

Run: `cd backend && node --test arranquePersistencia.test.js`
Expected: PASS. El guard `validarSistemaDePermisos` tumba el backend si un permiso queda mal dado de
alta; esta es la prueba que lo detecta.

- [ ] **Step 8: Commit**

```bash
git add backend/permisosCatalogo.js backend/server.js backend/gastosCajaFuerte.test.js
git commit -m "feat(gastos): permiso propio para marcar un gasto como pagado desde la caja fuerte"
```

---

### Task 3: Corregir un gasto mal capturado, mientras no se haya cortado

**Por qué.** Sin esto, un gasto marcado con el origen equivocado es un faltante permanente a nombre de
alguien. Es el mismo trato que ya reciben las ventas con `cambiar_caja_venta`, y por la misma razón:
después de un corte cerrado no se puede tocar, porque cambiaría un corte ya firmado.

**Files:**
- Modify: `backend/gastos.js` (función nueva `corregirOrigenGasto`)
- Modify: `backend/server.js` (ruta nueva)
- Test: `backend/gastosCajaFuerte.test.js`

**Interfaces:**
- Produces: `corregirOrigenGasto(DB, id, { origen, caja_id }, usuario)` — devuelve el gasto corregido; lanza si el gasto ya entró en un corte cerrado.

- [ ] **Step 1: Escribir las pruebas que fallan**

```js
test("un gasto pendiente se corrige y queda en bitacora", async () => {
  const DB = construirDBPrueba();
  DB.pos.cajas = sembrarCajas(DB);
  const administrativa = DB.pos.cajas.find((c) => c.sucursal_id === 1 && c.predeterminada);
  const gasto = await crearGasto(DB, { ...datosGastoDePrueba(), monto: 800, forma_pago: "EFECTIVO" }, 1, usuarioDePrueba(), driveFalso(), administrativa.id);

  // Antes de corregir le resta al cajon; despues, no.
  assert.strictEqual(gastosEfectivoDelTurno(DB, 1, null, administrativa), 800);
  corregirOrigenGasto(DB, gasto.id, { origen: "CAJA_FUERTE" }, usuarioDePrueba());
  assert.strictEqual(gastosEfectivoDelTurno(DB, 1, null, administrativa), 0);

  const bitacora = DB.gastos.gasto_movimientos.filter((m) => m.gasto_id === gasto.id);
  assert.ok(bitacora.some((m) => /origen/i.test(m.descripcion)), "la correccion tiene que dejar rastro");
});

/**
 * Un gasto sellado ya lo conto un corte cerrado. Cambiarlo ahora moveria el
 * calculado de un corte que alguien ya firmo.
 */
test("un gasto ya sellado por un corte no se puede corregir", async () => {
  const DB = construirDBPrueba();
  DB.pos.cajas = sembrarCajas(DB);
  const administrativa = DB.pos.cajas.find((c) => c.sucursal_id === 1 && c.predeterminada);
  const gasto = await crearGasto(DB, { ...datosGastoDePrueba(), forma_pago: "EFECTIVO" }, 1, usuarioDePrueba(), driveFalso(), administrativa.id);
  gasto.corte_id = 7; // lo conto el corte 7

  assert.throws(() => corregirOrigenGasto(DB, gasto.id, { origen: "CAJA_FUERTE" }, usuarioDePrueba()), /cort/i);
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `cd backend && node --test gastosCajaFuerte.test.js`
Expected: FAIL — `corregirOrigenGasto` no existe.

- [ ] **Step 3: Implementar**

En `backend/gastos.js`. **Reutiliza la regla de "ya se cortó" que ya exista** (la misma que usa
`gastosEfectivoDelTurnoLista`: `corte_id == null` en la era sellada, y la ventana de tiempo en la
histórica). No la copies a mano: si la regla acaba escrita dos veces, las dos van a discrepar — ya
pasó dos veces en este repo.

```js
/**
 * Corrige el origen (y opcionalmente la caja) de un gasto que todavia no ha
 * entrado en un corte cerrado. Despues de un corte no se puede: cambiaria el
 * calculado de un corte que alguien ya firmo.
 *
 * Sin esto, un gasto marcado mal es un faltante permanente a nombre de quien
 * cerro la caja ese dia.
 */
function corregirOrigenGasto(DB, id, cambios, usuario) {
  const gasto = DB.gastos.gastos.find((g) => g.id === Number(id));
  if (!gasto) throw new Error("Gasto no encontrado");
  if (gasto.estatus !== "activo") throw new Error("Un gasto cancelado ya no se corrige");
  if (yaLoContoUnCorte(DB, gasto)) {
    throw new Error("Este gasto ya entro en un corte cerrado y su origen no se puede cambiar");
  }

  const antes = { origen: gasto.origen || "CAJON", caja_id: gasto.caja_id };
  if (cambios.origen !== undefined) {
    const origen = String(cambios.origen).toUpperCase();
    if (!ORIGENES_GASTO.includes(origen)) throw new Error("El origen del dinero debe ser el cajon o la caja fuerte");
    gasto.origen = origen;
  }
  if (cambios.caja_id !== undefined) {
    gasto.caja_id = resolverCajaDeSucursal(DB, gasto.sucursal_id, cambios.caja_id).id;
  }

  pushMovimientoGasto(DB, gasto, "correccion",
    `Origen: ${antes.origen} -> ${gasto.origen}; caja: ${antes.caja_id} -> ${gasto.caja_id}`, usuario);
  return gasto;
}
```

Ajusta `pushMovimientoGasto` al nombre real del helper de bitácora de `gastos.js`, y escribe
`yaLoContoUnCorte` reutilizando la lógica existente en vez de duplicarla.

- [ ] **Step 4: La ruta**

En `backend/server.js`, con el **mismo** permiso de la Tarea 2:

```js
app.put("/api/gastos/:id/origen", requiereLogin, requierePermiso("registrar_gasto_caja_fuerte", resolverPermisosDeRol), (req, res) => {
  try {
    res.json(corregirOrigenGasto(DB, req.params.id, req.body, req.usuarioToken));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
```

- [ ] **Step 5: Correr y verificar que pasan**

Run: `cd backend && node --test gastosCajaFuerte.test.js gastosCorteCaja.test.js`
Expected: PASS.

- [ ] **Step 6: Suite y commit**

```bash
cd backend && node --test
git add backend/gastos.js backend/server.js backend/gastosCajaFuerte.test.js
git commit -m "feat(gastos): corregir el origen de un gasto mientras no se haya cortado"
```

---

### Task 4: La pantalla

**Por qué.** Es lo único que ve la cajera, y es donde se decide si el diseño funciona: si la casilla
no se entiende, el gasto acaba en el sitio equivocado y el descuadre vuelve por el otro lado.

**Files:**
- Modify: `src/Gastos.jsx`

**Interfaces:**
- Consumes: `permisos` ya llega al componente (se usa con el helper `puede(...)` en las demás pantallas — sigue ese patrón); `listarGastos` devuelve `origen` por fila.

- [ ] **Step 1: La casilla, solo para quien puede**

Debajo del selector de caja que ya construyó el plan de arreglos, dentro del bloque de `EFECTIVO`:

```jsx
{puede("registrar_gasto_caja_fuerte") && (
  <label className="flex items-center gap-2 text-xs text-slate-600 mt-1.5">
    <input
      type="checkbox"
      checked={form.origen === "CAJA_FUERTE"}
      onChange={(e) => setForm({ ...form, origen: e.target.checked ? "CAJA_FUERTE" : "CAJON" })}
    />
    Salió de la caja fuerte, no del cajón
  </label>
)}
```

Añadir `origen: "CAJON"` al estado inicial de `form`.

- [ ] **Step 2: El aviso cambia con lo elegido**

Sustituir el aviso fijo por uno que diga la verdad en cada caso:

```jsx
{form.origen === "CAJA_FUERTE" ? (
  <p className="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded px-2 py-1.5">
    Este gasto <strong>no</strong> se le descuenta a nadie en su corte: baja el dinero
    resguardado de la caja {nombreCajaElegida || "seleccionada"}.
  </p>
) : (
  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
    Este gasto se descontará del efectivo esperado en el corte de la caja <strong>{nombreCajaElegida || "seleccionada"}</strong>.
    Si el dinero salió de la otra caja, cámbialo aquí antes de guardar.
  </p>
)}
```

`nombreCajaElegida` sale de la lista de cajas que ya se carga para el selector; no la vuelvas a pedir.

- [ ] **Step 3: La columna y el filtro en la lista**

En el `<thead>`, después de la columna Caja:

```jsx
<th className="py-2 px-3 text-left font-medium">Origen</th>
```

Y en la fila:

```jsx
<td className="py-2 px-3">{g.forma_pago === "EFECTIVO" ? ((g.origen || "CAJON") === "CAJA_FUERTE" ? "Caja fuerte" : "Cajón") : "—"}</td>
```

Más un filtro de Origen junto a los que ya existen (Todos / Cajón / Caja fuerte), que filtre la lista
ya cargada — no hace falta una ruta nueva.

- [ ] **Step 4: Lint y commit**

```bash
npx eslint src backend
git add src/Gastos.jsx
git commit -m "feat(gastos): la pantalla distingue lo que sale del cajon de lo que sale de la caja fuerte"
```

**Verificación en navegador (obligatoria, esta tarea no tiene pruebas automáticas):** ver la lista de
abajo.

---

## Verificación final, antes de que Victor apruebe el merge

- `cd backend && node --test` — sin regresiones.
- `npx eslint src backend` — 0 errores.
- `git diff --check` limpio y sin archivos inesperados.
- **Revisión independiente de todo el diff** — despachada a Codex, no a subagentes de Claude.
- **Prueba en navegador**, que ninguna prueba automática sustituye:

1. **La que importa.** Registrar un gasto en efectivo de $800 marcando "Salió de la caja fuerte", y comprobar que el Corte de Caja de esa cajera **no se mueve ni un peso**. Sin la casilla marcada, el mismo gasto sí le debe restar $800.
2. **La cajera no ve la casilla.** Entrar con un usuario que tenga "Registrar Gastos" pero no el permiso nuevo, y comprobar que la casilla **no aparece** y que la pantalla es la de siempre.
3. **Corregir.** Capturar un gasto en efectivo sin marcar la casilla, corregirlo a caja fuerte antes de cortar, y comprobar que el corte deja de pedirlo. Después cerrar el corte e intentar corregir otro ya cortado: debe rechazarse con un mensaje entendible.
4. **Los gastos viejos siguen igual.** En una base con gastos anteriores, comprobar que el corte los sigue descontando como siempre — ninguno tiene origen, y todos tienen que contar como del cajón.
5. **El permiso aparece donde debe.** En Roles y Personal, dentro de Gastos, comprobar que existe "Registrar Gasto Pagado desde la Caja Fuerte" y que el rol Administrador lo tiene sin que nadie lo haya tocado a mano.
