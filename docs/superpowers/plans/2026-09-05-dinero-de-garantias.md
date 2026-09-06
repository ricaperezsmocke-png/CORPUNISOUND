# El dinero de las garantías entra a la caja — Plan de implementación

> **Para agentes ejecutores:** SUB-SKILL REQUERIDA: usar `superpowers:subagent-driven-development` (recomendado) o `superpowers:executing-plans` para implementar tarea por tarea. Los pasos usan casillas (`- [ ]`).

**Goal:** Que el dinero de una garantía —el que el cliente paga y el que la tienda desembolsa— deje de ser invisible para el corte de caja.

**Architecture:** No se construye un módulo nuevo. Un gasto de garantía gana los tres campos que ya tienen todos los movimientos de dinero del sistema (`forma_pago`, `sucursal_id`, `caja_id`), y aparece un **cobro** al cliente con los mismos campos. El corte de caja los suma y los resta como ya hace con los gastos normales, sin tocar su lógica.

**Tech Stack:** Node.js + Express (datos en memoria sobre `DB`, persistidos en SQLite), React 18 + Vite + Tailwind. Pruebas con `node --test`. **Sin dependencias nuevas.**

**Spec:** la decisión de fondo está en `docs/superpowers/plans/2026-09-04-antifraude-punto-de-venta.md`, Tarea 12, con la respuesta de Victor del 2026-09-04. Este plan la ejecuta.

**Rama:** `fix/antifraude-pos` · **Worktree:** `C:/Users/Victor/Desktop/CORPUNISOUND/.claude/worktrees/cajas-pos`

## Global Constraints

- **Sin dependencias nuevas.**
- **Línea base:** `cd backend && node --test` da 1283/1283 y `npx eslint src backend` 0 errores. **Corre la suite guardando la salida en un archivo** (`node --test > salida.txt 2>&1`): ya se perdió dos veces el detalle de un fallo por no hacerlo.
- **Nunca `git add .`** — staging por rutas explícitas.
- **Nada de push, merge ni rebase.** Eso lo hace Victor.
- **Mensajes de commit sin acentos.** En el código y la interfaz, los acentos sí van.
- Las reglas de dinero de `CLAUDE.md` aplican enteras, en particular: validar en el servidor, y que las guardas fallen cerrando.

## El problema, en los términos de la tienda

Victor confirmó el 2026-09-04: **el gasto de una garantía lo paga el cliente, y ese dinero pasa por la caja.** Son dos movimientos, y hoy el sistema no registra ninguno:

1. **El cliente paga** el flete o la reparación → **entra efectivo al cajón** que el corte no espera.
2. **La tienda paga** al proveedor o al fletero → **sale efectivo del cajón** que el corte no sabe.

Si las dos cosas caen en el mismo turno y por el mismo monto se cancelan y nadie nota nada. En cuanto se separan —el cliente paga hoy, el flete se paga la semana que viene— la cajera aparece con un **sobrante** el primer día y un **faltante** el segundo, por dinero que manejó bien.

Y el lado de fraude: **ese ingreso el sistema no lo espera nunca.** Si quien lo recibe se lo queda, no se produce ningún faltante, porque nadie registró que entró. Es dinero invisible por diseño.

Verificado en el código: `backend/garantiasGastos.js:47-58` guarda el gasto **sin `forma_pago`, sin `sucursal_id`, sin `caja_id` y sin `corte_id`**; la pantalla tampoco lo pregunta (`src/Garantias.jsx:43`, `FORM_GASTO = { tipo, monto, descripcion }`); y el corte solo resta gastos del módulo general (`backend/cortes.js`).

## Decisiones ya tomadas — no volver a abrirlas

1. **El cobro al cliente es un ingreso a una caja; el pago es un gasto de esa misma caja.** Los dos con `caja_id`, los dos entrando al corte.
2. **No se reescribe nada de lo ya capturado.** Los gastos de garantía existentes se quedan sin caja y fuera del corte: cambiarlos movería cortes ya firmados.
3. **Sigue ABIERTO y lo decide Victor, y por eso NO entra en este plan:** si estos importes además deben restarse de la **Utilidad**. Son preguntas distintas — el cajón tiene que cuadrar en cualquier caso; lo contable es aparte. **Si el ejecutor llega a un punto donde esto importa, se detiene y pregunta.**

---

## Estructura de archivos

| Archivo | Responsabilidad | Tareas |
|---|---|---|
| `backend/garantiasGastos.js` | Los tres campos nuevos en el gasto, y el cobro al cliente | 1, 2 |
| `backend/cortes.js` | Que el corte los sume y los reste | 3 |
| `backend/server.js` | Las rutas pasan caja y usuario | 1, 2 |
| `src/Garantias.jsx` | Preguntar forma de pago y caja; mostrarlo | 4 |

**Orden:** la 1 y la 2 crean los datos; sin ellas la 3 no tiene qué sumar. La 4 es lo único que ve quien atiende el mostrador.

---

### Task 1: El gasto de garantía dice de qué caja salió

**Por qué.** Es la mitad que ya existe pero está ciega: el gasto se registra y no toca ninguna caja. Sin `caja_id` el corte no puede restarlo, y sin `forma_pago` no se sabe siquiera si salió efectivo del cajón o fue una transferencia.

**Files:**
- Modify: `backend/garantiasGastos.js` (`crearGastoGarantia`)
- Modify: `backend/server.js` (la ruta que lo crea)
- Test: `backend/garantiasDinero.test.js` (nuevo)

**Interfaces:**
- Consumes: `resolverCajaDeSucursal(DB, sucursalId, cajaId)` de `backend/cajas.js` — ya valida existencia y pertenencia, y cae en la predeterminada si no se declara caja.
- Produces: `gasto.forma_pago` (`"EFECTIVO"` | `"TARJETA"` | `"TRANSFERENCIA"`), `gasto.sucursal_id`, `gasto.caja_id`, `gasto.corte_id` (null al nacer).

- [ ] **Step 1: Escribir las pruebas que fallan**

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { sembrarCajas } = require("./cajas");
const { crearGarantia } = require("./garantias");
const { crearGastoGarantia } = require("./garantiasGastos");

const USUARIO = { id: 1, nombre: "Ana" };
const TODAS = { verTodas: true, sucursalId: null };

function prepararDB() {
  const DB = construirDBPrueba();
  DB.pos.cajas = [];
  sembrarCajas(DB);
  return DB;
}

/**
 * El dinero de una garantia pasa por la caja de la tienda (confirmado por
 * Victor el 2026-09-04). Sin caja ni forma de pago, el corte no puede restarlo
 * y la cajera acaba con un faltante que no cometio.
 */
test("un gasto de garantia guarda su forma de pago, sucursal y caja", async () => {
  const DB = prepararDB();
  const caja = DB.pos.cajas.find((c) => c.sucursal_id === 1 && !c.predeterminada);
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);

  const gasto = await crearGastoGarantia(DB, g.id, {
    tipo: "traslado", monto: 300, forma_pago: "EFECTIVO", caja_id: caja.id,
  }, USUARIO, driveFalso(), TODAS);

  assert.strictEqual(gasto.forma_pago, "EFECTIVO");
  assert.strictEqual(gasto.sucursal_id, 1);
  assert.strictEqual(gasto.caja_id, caja.id);
  assert.strictEqual(gasto.corte_id, null);
});

test("sin caja declarada cae en la predeterminada de su sucursal", async () => {
  const DB = prepararDB();
  const administrativa = DB.pos.cajas.find((c) => c.sucursal_id === 1 && c.predeterminada);
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);

  const gasto = await crearGastoGarantia(DB, g.id, { tipo: "traslado", monto: 300, forma_pago: "EFECTIVO" }, USUARIO, driveFalso(), TODAS);

  assert.strictEqual(gasto.caja_id, administrativa.id);
});

test("una forma de pago invalida se rechaza", async () => {
  const DB = prepararDB();
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);

  await assert.rejects(
    () => crearGastoGarantia(DB, g.id, { tipo: "traslado", monto: 300, forma_pago: "PAGARE" }, USUARIO, driveFalso(), TODAS),
    /forma de pago/i
  );
});
```

**Ojo:** `driveFalso()` **no existe** — mira cómo simula Drive `backend/garantias.test.js` y reutiliza ese mismo mecanismo. No inventes helpers (ver `CLAUDE.md`).

- [ ] **Step 2: Correr y verificar que fallan**

Run: `cd backend && node --test garantiasDinero.test.js`
Expected: FAIL — hoy el gasto no guarda ninguno de esos campos.

- [ ] **Step 3: Implementar**

En `crearGastoGarantia`, validar la forma de pago contra una lista explícita (falla cerrando, igual que `crearVenta`), resolver la caja con `resolverCajaDeSucursal` sobre la sucursal de la garantía, y guardar los cuatro campos en el objeto del gasto junto a los que ya tiene.

La sucursal sale de **la garantía**, no del encabezado: es donde se atendió el caso.

- [ ] **Step 4: La ruta pasa la caja declarada**

En `backend/server.js`, la ruta que crea el gasto pasa `req.body.caja_id`. **Del cuerpo, no del query** — es la misma trampa del encabezado que ya mordió en gastos: la sucursal sale de la garantía y la caja del selector serían dos fuentes para una decisión.

- [ ] **Step 5: Correr y verificar que pasan** — `cd backend && node --test garantiasDinero.test.js garantias.test.js`

- [ ] **Step 6: Commit**

```bash
git add backend/garantiasGastos.js backend/server.js backend/garantiasDinero.test.js
git commit -m "feat(garantias): el gasto dice de que caja salio el dinero"
```

---

### Task 2: El cobro al cliente entra a la caja

**Por qué.** Es la mitad que **no existe**: cuando el cliente paga el flete, ese dinero entra al cajón y el sistema no lo registra en ninguna parte. El corte no lo espera, así que si quien lo recibe se lo queda **no se produce ningún faltante**. Es la única parte de este trabajo que cierra un hueco de fraude y no solo un descuadre.

**Files:**
- Modify: `backend/garantiasGastos.js` (función nueva `crearCobroGarantia`)
- Modify: `backend/server.js` (ruta nueva)
- Test: `backend/garantiasDinero.test.js`

**Interfaces:**
- Produces: `crearCobroGarantia(DB, garantiaId, datos, usuario, alcance)` → registro en `DB.inventario.garantia_cobros` con `garantia_id`, `monto`, `forma_pago`, `sucursal_id`, `caja_id`, `corte_id: null`, `usuario`, `fecha`, `descripcion`.

- [ ] **Step 1: Escribir las pruebas que fallan**

Cubrir: que el cobro guarda caja, forma de pago y usuario; que un monto cero o negativo se rechaza; que cae en la predeterminada si no se declara caja; y que queda constancia en la bitácora de la garantía (`pushMovimiento`, el mismo que ya usan los gastos).

- [ ] **Step 2: Correr y verificar que fallan.**

- [ ] **Step 3: Implementar** siguiendo la forma de `crearGastoGarantia` — mismas validaciones, misma bitácora, misma resolución de caja. **No dupliques la validación de forma de pago ni la de caja**: extráelas a un helper del propio archivo y úsalo en las dos.

- [ ] **Step 4: La ruta**, con el mismo permiso que ya usa el gasto de garantía. **No inventes un permiso nuevo** sin comprobar antes qué usa la ruta vecina.

- [ ] **Step 5: Correr y commitear.**

---

### Task 3: El corte suma el cobro y resta el gasto

**Por qué.** Sin esto las dos tareas anteriores solo guardan datos bonitos. El corte tiene que contar ese dinero como cuenta el resto.

**Files:**
- Modify: `backend/cortes.js`
- Test: `backend/garantiasCorteCaja.test.js` (nuevo)

- [ ] **Step 1: Escribir las pruebas que fallan**

Con la caja Administrativa de una tienda:

1. Un **cobro** de garantía en efectivo **sube** el efectivo esperado del turno.
2. Un **gasto** de garantía en efectivo lo **baja**.
3. Uno en **transferencia** no toca el efectivo del cajón.
4. Los de **otra caja** no entran en este corte.
5. Los **anteriores a las cajas** (`caja_id` null) los absorbe la predeterminada — igual que todo lo demás, vía `esDeEstaCaja`.
6. Al cerrar el corte quedan **sellados** con su `corte_id` y no vuelven a contarse en el siguiente.

- [ ] **Step 2: Correr y verificar que fallan.**

- [ ] **Step 3: Implementar** reutilizando la maquinaria que ya existe: `esDeEstaCaja` para la pertenencia y el mismo sellado por `corte_id` que usan ventas, abonos y gastos. **No escribas una regla de pertenencia nueva** — en este repo, cada vez que una regla de dinero ha vivido en dos lugares, los dos han acabado discrepando.

- [ ] **Step 4: Correr la suite entera guardando la salida**, y commitear.

---

### Task 4: La pantalla pregunta, y muestra

**Por qué.** Hoy el formulario solo pide tipo, monto y descripción. Si no pregunta la forma de pago y la caja, las tres tareas anteriores no reciben datos.

**Files:**
- Modify: `src/Garantias.jsx`

- [ ] **Step 1: El formulario de gasto** gana forma de pago y, cuando es efectivo, el selector de caja — el mismo patrón que quedó en Gastos: se sugiere la caja del encabezado y se puede cambiar, con un aviso que diga de qué caja se va a descontar.

- [ ] **Step 2: Un formulario de cobro** al cliente, con monto, forma de pago y caja. Que se lea distinto del de gasto: uno es dinero que entra y otro que sale, y confundirlos descuadra la caja en el sentido contrario.

- [ ] **Step 3: Mostrar el saldo del caso** — cuánto cobró la tienda, cuánto pagó, y la diferencia. Es la cifra que contesta "¿esta garantía nos costó dinero?".

- [ ] **Step 4: Lint y commit.**

**Verificación en navegador (obligatoria):** ver abajo.

---

## Verificación final, antes de que Victor apruebe

- `cd backend && node --test > salida.txt 2>&1` — sin regresiones, y **con la salida guardada**.
- `npx eslint src backend` — 0 errores.
- `git diff --check` limpio y sin archivos inesperados.
- **Revisión independiente**, y no por quien implementó.
- **Prueba en navegador:**

1. **El cobro sube el cajón.** Registrar un cobro de $300 en efectivo en una garantía y comprobar que el Corte de Caja de esa caja espera $300 **más**.
2. **El gasto lo baja.** Registrar el pago del flete por $300 en efectivo y comprobar que el corte vuelve a donde estaba.
3. **Separados en el tiempo, que es el caso que hoy descuadra.** Cobrar hoy, cerrar el corte, y pagar el flete mañana: el primer corte debe pedir $300 más y el segundo $300 menos. **Ninguno de los dos debe aparecer como sobrante o faltante inexplicado.**
4. **La otra caja no se entera.** Con la Fiscal seleccionada, comprobar que ese dinero no aparece en su corte.
5. **Lo viejo sigue igual.** Una garantía con gastos capturados antes de este cambio no debe alterar ningún corte.
