# El monedero se puede gastar — Plan de implementación

> **Para agentes ejecutores:** SUB-SKILL REQUERIDA: usar `superpowers:subagent-driven-development` (recomendado) o `superpowers:executing-plans`. Los pasos usan casillas (`- [ ]`).

**Goal:** Que el saldo a favor de un cliente —hoy visible y ni gastable— se pueda aplicar a su compra, sin que un solo peso falso entre al cajón de la cajera.

**Architecture:** El monedero **no** es una forma de pago: es un importe que se descuenta del total antes de cobrar. La venta gana un campo, el cliente ve bajar su saldo, y el corte cuenta solo el resto. No se toca `esDeEstaCaja`, ni la época sellada, ni el sellado por `corte_id`.

**Tech Stack:** Node.js + Express (datos en memoria sobre `DB`, persistidos en SQLite), React 18 + Vite + Tailwind. Pruebas con `node --test`. **Sin dependencias nuevas.**

**Spec:** `docs/superpowers/specs/2026-09-07-monedero-como-pago-design.md` — léelo antes de la primera tarea.

**Rama:** crear `feature/monedero-pago` desde master.

## Global Constraints

- **Sin dependencias nuevas.**
- **Línea base:** `cd backend && node --test` da **1391/1391** y `npx eslint src backend` **0 errores** (456 warnings preexistentes). **Corre la suite guardando la salida en un archivo** y busca `^not ok`.
- **Prueba floja conocida:** `expedientesAlcance.test.js` a veces falla dentro de la suite completa con "no se pudo sembrar el empleado" y pasa 6/6 sola. Es ambiental y está identificada, **no es tuya**: si la ves, vuelve a correr la suite y dilo.
- **Nunca `git add .`** — staging por rutas explícitas.
- **Nada de push, merge ni rebase.** Eso lo hace Victor.
- **Mensajes de commit sin acentos.** En el código y la interfaz, los acentos SÍ van.
- Lee `CLAUDE.md`: reglas de dinero y **cómo se escriben pruebas aquí**. `backend/testHelpers.js` solo exporta `construirDBPrueba` y `sembrarCuentas`; el patrón es un `prepararDB()` local copiado de `backend/cajas.test.js`. **No inventes helpers.**

## La regla que no se puede equivocar

**EL MONEDERO NO ES EFECTIVO Y NO SUMA AL CAJÓN.** Cuando un cliente paga $120 con su saldo, no entra un peso a la caja: se salda una deuda que la tienda ya tenía con él. Si el corte lo sumara al efectivo esperado, la cajera terminaría el día con un faltante **exactamente igual a todo el monedero aplicado** — el mismo error que costó el descuento por forma de pago el 2026-09-05.

---

### Task 1: La venta aplica el monedero, y el servidor decide cuánto

**Files:**
- Modify: `backend/ventas.js` (`crearVenta`)
- Test: `backend/monederoPago.test.js` (nuevo)

**Interfaces:**
- Consumes: `DB.crm.clientes` — el saldo vive en `cliente.monedero`.
- Produces: `venta.monedero_aplicado` (número, 0 cuando no se usó). `cliente.monedero` baja en esa cantidad.

- [ ] **Step 1: Escribir las pruebas que fallan**

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { sembrarCajas } = require("./cajas");
const { crearVenta } = require("./ventas");

function prepararDB() {
  const DB = construirDBPrueba();
  DB.pos.ventas = [];
  DB.pos.venta_detalle = [];
  DB.pos.cajas = [];
  sembrarCajas(DB);
  DB.pos.configuracion = { permitir_ventas_sin_existencia: true };
  return DB;
}
const saldoDe = (DB, id) => DB.crm.clientes.find((c) => c.id === id).monedero;

/**
 * El servidor decide cuanto se aplica, igual que con el precio: lo que manda el
 * navegador es una propuesta. Toma el MENOR entre lo pedido, el saldo del
 * cliente y el total de la venta.
 */
test("se aplica lo pedido cuando el saldo alcanza", () => {
  const DB = prepararDB();
  DB.crm.clientes.find((c) => c.id === 1).monedero = 500;

  const venta = crearVenta(DB, {
    sucursal_id: 1, metodo_pago: "TARJETA", cliente_id: 1,
    lineas: [{ producto_id: 3, cantidad: 10 }], // 32 c/u = 320
    monedero_aplicado: 120,
  });

  assert.strictEqual(venta.monedero_aplicado, 120);
  assert.strictEqual(saldoDe(DB, 1), 380);
});

test("no se aplica mas de lo que el cliente tiene", () => {
  const DB = prepararDB();
  DB.crm.clientes.find((c) => c.id === 1).monedero = 120;

  const venta = crearVenta(DB, {
    sucursal_id: 1, metodo_pago: "TARJETA", cliente_id: 1,
    lineas: [{ producto_id: 3, cantidad: 10 }],
    monedero_aplicado: 9999,
  });

  assert.strictEqual(venta.monedero_aplicado, 120);
  assert.strictEqual(saldoDe(DB, 1), 0);
});

test("no se aplica mas que el total de la venta", () => {
  const DB = prepararDB();
  DB.crm.clientes.find((c) => c.id === 1).monedero = 500;

  const venta = crearVenta(DB, {
    sucursal_id: 1, metodo_pago: "TARJETA", cliente_id: 1,
    lineas: [{ producto_id: 3, cantidad: 1 }], // 32
    monedero_aplicado: 500,
  });

  assert.strictEqual(venta.monedero_aplicado, 32);
  assert.strictEqual(saldoDe(DB, 1), 468, "el resto sigue siendo suyo");
});

/** Publico en General no tiene monedero y no puede recibir uno. */
test("no se puede aplicar monedero a Publico en General", () => {
  const DB = prepararDB();
  assert.throws(
    () => crearVenta(DB, {
      sucursal_id: 1, metodo_pago: "TARJETA", cliente_id: 0,
      lineas: [{ producto_id: 3, cantidad: 1 }], monedero_aplicado: 10,
    }),
    /cliente/i
  );
});

/** La red: una venta sin monedero no cambia en nada. */
test("una venta normal sigue igual y con monedero_aplicado en cero", () => {
  const DB = prepararDB();
  const venta = crearVenta(DB, {
    sucursal_id: 1, metodo_pago: "TARJETA", cliente_id: 1,
    lineas: [{ producto_id: 3, cantidad: 1 }],
  });
  assert.strictEqual(venta.monedero_aplicado, 0);
  assert.strictEqual(venta.total, 32);
});
```

- [ ] **Step 2: Correr y verificar que fallan** — `cd backend && node --test monederoPago.test.js`

- [ ] **Step 3: Implementar**

En `crearVenta`, **después** de calcular `totalCalculado` y antes de construir la venta:

```js
  // EL MONEDERO NO ES UNA FORMA DE PAGO: es un importe que se descuenta contra un
  // saldo a favor que el cliente ya tenia (nace de un apartado cancelado). Se
  // modela asi y no como forma de pago porque el sistema no tiene pago mixto, y
  // "monedero como forma de pago" solo serviria si el saldo cubriera la venta
  // entera — el caso normal es que no.
  //
  // El servidor decide CUANTO se aplica: lo que manda el navegador es una
  // propuesta, igual que con el precio.
  let monederoAplicado = 0;
  const pedido = Number(datos.monedero_aplicado) || 0;
  if (pedido > 0) {
    const clienteId = Number(datos.cliente_id) || 0;
    if (!clienteId) throw new Error("Elige un cliente para aplicar su monedero: Público en General no tiene saldo");
    const cliente = DB.crm.clientes.find((c) => c.id === clienteId);
    if (!cliente) throw new Error("El cliente de la venta no existe");
    monederoAplicado = redondear(Math.min(pedido, Number(cliente.monedero) || 0, totalCalculado));
    cliente.monedero = redondear((Number(cliente.monedero) || 0) - monederoAplicado);
  }
```

Y en el objeto `venta`, junto a `total`:

```js
    // Es el unico rastro de por que esta venta cobro menos de lo que suman sus
    // lineas. Sin el, un descuadre aparente no se podria explicar.
    monedero_aplicado: monederoAplicado,
```

**El `total` de la venta NO cambia**: sigue siendo lo que valen las líneas. Lo que cambia es cuánto se cobra por la forma de pago, y de eso se encarga la Tarea 2.

- [ ] **Step 4: Correr y verificar que pasan.**
- [ ] **Step 5: Suite completa y commit.**

```bash
git add backend/ventas.js backend/monederoPago.test.js
git commit -m "feat(ventas): el monedero del cliente se puede aplicar a su compra"
```

---

### Task 2: El corte cuenta solo lo que de verdad entró al cajón

**Por qué.** Es la tarea donde se gana o se pierde todo. Hoy `ventasDelTurno` acumula `venta.total` por su forma de pago. Si una venta de $320 aplicó $120 de monedero, la cajera solo cobró **$200** — y eso es lo que el corte tiene que esperar.

**Files:**
- Modify: `backend/cortes.js`
- Test: `backend/monederoCorte.test.js` (nuevo)

- [ ] **Step 1: Escribir las pruebas que fallan**

Cubrir, con la caja Administrativa de una sucursal:

1. Venta de $320 con $120 de monedero en **EFECTIVO** → el efectivo esperado sube **$200**, no $320.
2. Lo mismo en **TARJETA** → el acumulado de tarjeta sube $200.
3. Una venta pagada **entera** con monedero → el efectivo esperado **no se mueve**, y la venta sí entra en el turno.
4. El corte informa el monedero aplicado en su propia cifra, como ya hace con transferencias.
5. **La red:** una venta sin monedero sigue sumando su total completo.

- [ ] **Step 2: Correr y verificar que fallan.**

- [ ] **Step 3: Implementar.** Donde el corte acumula el total de cada venta, usar el importe realmente cobrado: `venta.total - (venta.monedero_aplicado || 0)`. Las ventas anteriores no tienen el campo y valen su total completo — sin migrar nada.

Añadir al resultado `monedero_aplicado` (suma del turno), **informativo y nunca sumado al calculado**, junto a `transferencias` y `credito`. Y llevarlo al corte guardado, como se hizo con `garantias_cobros_efectivo`.

- [ ] **Step 4: Correr la suite entera** — este cambio toca el archivo del dinero; si algo se rompe, sale aquí.
- [ ] **Step 5: Commit.**

---

### Task 3: Cancelar una venta devuelve el monedero

**Por qué.** Sin esto, cancelar le roba el saldo al cliente: la mercancía vuelve al inventario, el dinero se le devuelve… y los $120 de su monedero se quedan gastados en una venta que ya no existe.

**Files:**
- Modify: `backend/ventas.js` (`cancelarVenta`)
- Test: `backend/monederoPago.test.js`

- [ ] **Step 1: Prueba que falla** — vender aplicando $120, cancelar, y comprobar que el cliente vuelve a tener su saldo. Y una segunda: cancelar dos veces no lo devuelve dos veces.
- [ ] **Step 2: Correr y verificar que falla.**
- [ ] **Step 3: Implementar** en `cancelarVenta`, junto al reintegro de inventario que ya hace.
- [ ] **Step 4: Correr y commitear.**

---

### Task 4: La pantalla

**Files:**
- Modify: `src/PuntoDeVenta.jsx`

- [ ] **Step 1:** Donde hoy solo se muestra "Monedero: $120.00" (línea ~868), permitir **aplicarlo**: un campo o botón que proponga usar el saldo, limitado al menor entre el saldo y el total.
- [ ] **Step 2:** Que el total a cobrar muestre claramente **cuánto se aplicó del monedero y cuánto queda por cobrar**. La cajera tiene que ver el número que va a pedirle al cliente, sin restarlo de cabeza.
- [ ] **Step 3:** Solo cuando hay un cliente real elegido. Con Público en General no se ofrece.
- [ ] **Step 4:** Lint y commit.

**Verificación en navegador (obligatoria):** vender a un cliente con saldo, aplicar parte, cobrar el resto en efectivo, y comprobar que **el corte pide exactamente lo que la cajera cobró** — ni un peso más.

---

## Verificación final

- `cd backend && node --test > salida.txt 2>&1` — sin regresiones, con la salida guardada.
- `npx eslint src backend` — 0 errores.
- `git diff --check` limpio y sin archivos inesperados.
- **Revisión independiente**, y no por quien implementó.
- La prueba en navegador de arriba.
