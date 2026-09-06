# Antifraude del punto de venta — Plan de implementación

> **Para agentes ejecutores:** SUB-SKILL REQUERIDA: usar `superpowers:subagent-driven-development` (recomendado) o `superpowers:executing-plans` para implementar tarea por tarea. Los pasos usan casillas (`- [ ]`) para seguimiento.

**Goal:** Cerrar los huecos por los que hoy se puede sacar dinero o mercancía de Unisound sin que el sistema lo delate, empezando por los que cualquier cajera puede usar sola.

**Architecture:** Casi todo es **dejar de confiar en el navegador** y **registrar quién hizo qué**. No se construyen módulos nuevos: se validan en el servidor cosas que hoy se validan solo en la pantalla, y se guarda identidad donde hoy no se guarda. La única excepción es apagar el crédito, que es quitar una función que hoy miente.

**Tech Stack:** Node.js + Express (datos en memoria sobre `DB`, persistidos en SQLite), React 18 + Vite + Tailwind. Pruebas con `node --test`. **Sin dependencias nuevas.**

**Spec:** este plan sale de dos documentos, ambos en el repositorio:
- `docs/superpowers/auditorias/2026-09-04-auditoria-fraude-pos-codex.md` — la auditoría de Codex.
- La verificación independiente de esa auditoría (2026-09-04): 11 hallazgos confirmados, 5 exagerados, 1 falso. **Este plan solo ataca los confirmados**, y en el orden en que de verdad pueden costar dinero.

**Rama:** este trabajo necesita **su propio worktree**, creado desde `feature/cajas-pos` (que es donde vive la auditoría y el código más nuevo). Crear la rama y el worktree es una operación de Victor; hacerlo al empezar, no antes.

## Global Constraints

- **Sin dependencias nuevas.** Pruebas con `node --test`.
- **Línea base a no romper:** `cd backend && node --test` da 1239/1239 y `npx eslint src backend` da 0 errores (455 warnings preexistentes).
- **Nunca `git add .`** — staging por rutas explícitas.
- **Nada de push, merge ni rebase.** Eso lo hace Victor.
- **Un implementador a la vez.** Los revisores pueden ir en paralelo.
- Fechas solas con `fechaLocal()`; marcas completas ISO en UTC.
- **Sin acentos en los mensajes de commit.** En el código y en la interfaz, los acentos SÍ van.
- **Toda validación de dinero va en el SERVIDOR.** Una comprobación que solo vive en `src/` no es una comprobación: es una sugerencia, y quien manda la petición a mano se la salta.

## Decisiones ya tomadas por Victor — no volver a abrirlas

1. **El crédito se apaga ya y se construye después.** No se hacen cuentas por cobrar en este plan. Vender a crédito deja de ser posible hasta que exista un módulo que genere la deuda de verdad.
2. **Las cancelaciones se vuelven visibles, no se autorizan.** Se muestra y se exporta quién canceló, cuándo y por cuánto. No se agrega un flujo de aprobación, y **la mercancía sigue volviendo al inventario al cancelar** — no se cambia cómo se cancela una venta normal todos los días.

## Lo que este plan NO ataca, y por qué

La verificación tumbó o matizó cinco hallazgos de la auditoría. Quedan fuera **a propósito**:

- **"Un gerente puede crearse una cuenta Administrador"** — FALSO. `backend/roles.js:73-79` excluye `dar_alta_personal` del rol Gerente. Verificado en el código y en la base.
- **Depósitos falsos, traspasos como escondite, borrar gastos de garantía** — los mecanismos existen, pero hoy **solo el Administrador** tiene esos permisos. Son endurecimiento para antes de repartir permisos, no fugas abiertas. Se anotan al final.

---

## Fases, ordenadas por quién puede explotarlas

| Fase | Qué cubre | Quién puede hacerlo hoy |
|---|---|---|
| **1** | Crédito y precios | **Cualquier cajera**, desde la pantalla normal |
| **2** | Cancelaciones e identidad | El **gerente** de tienda |
| **3** | Fugas accidentales | Nadie de mala fe — el sistema solo |

Cada fase se revisa antes de la siguiente.

---

# FASE 1 — Lo que una cajera puede hacer sola, hoy

## API real de las pruebas — VERIFICADA, usa esto y nada más

Un intento anterior se detuvo porque este plan citaba helpers de prueba que no existen. Estas son
las firmas reales, comprobadas en el código el 2026-09-04:

```js
crearVenta(DB, datos)                 // DOS argumentos, no cuatro
crearCliente(DB, datos)               // DOS
actualizarCliente(DB, id, datos)      // TRES: sin usuario y sin alcance
```

- **`backend/ventas.test.js` NO EXISTE.** No lo busques.
- **`backend/testHelpers.js` exporta solo `construirDBPrueba` y `sembrarCuentas`.** No existen
  `datosVentaDePrueba`, `usuarioDePrueba`, `datosClienteDePrueba`, `alcanceDePrueba` ni `driveFalso`.
- El patrón a seguir es el de `backend/cajas.test.js`: un `prepararDB()` local dentro del propio
  archivo de prueba. Cópialo de ahí:

```js
const { construirDBPrueba } = require("./testHelpers");
const { sembrarCajas } = require("./cajas");
const { crearVenta } = require("./ventas");

function prepararDB() {
  const DB = construirDBPrueba();
  DB.pos.ventas = [];
  DB.pos.venta_detalle = [];
  DB.pos.cortes_caja = [];
  DB.pos.apartado_abonos = [];
  DB.pos.cajas = [];
  sembrarCajas(DB);
  return DB;
}
```

- Una venta se arma así — ojo con `precio_unitario`, que no se llama `precio`:

```js
crearVenta(DB, {
  sucursal_id: 4,
  lineas: [{ descripcion: "Servicio", cantidad: 1, precio_unitario: 100 }],
  total: 100,
});
```

- **Las líneas sin `producto_id` son "productos rápidos" / piezas especiales**: no tienen catálogo
  contra el cual recalcular, y hay que respetarlas tal cual.
- `DB.pos.configuracion = { permitir_ventas_sin_existencia: true }` es la bandera que usan las
  pruebas existentes para no chocar con el inventario.

---

### Task 1: Apagar el crédito

**Por qué.** Verificado ejecutándolo: **nadie escribe nunca `cliente.saldo`.** Se inicializa en cero (`backend/clientes.js:52`) y ahí se queda. `crearVenta` (`backend/ventas.js:25`) no busca al cliente ni una sola vez. Una cajera da de alta un cliente, le pone el límite que quiera, vende "a crédito", se lleva la mercancía, y el cliente sigue debiendo $0 — sin faltante de caja, porque el efectivo nunca bajó. También se acepta crédito a "Público en General" (id 0).

Es el hueco más caro y el único abierto a la cajera estándar. El techo es todo el inventario.

**Files:**
- Modify: `backend/ventas.js` (`crearVenta`)
- Modify: `src/PuntoDeVenta.jsx` (las formas de pago ofrecidas)
- Test: `backend/creditoApagado.test.js` (nuevo)

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

const LINEA = { descripcion: "Servicio", cantidad: 1, precio_unitario: 100 };

/**
 * El credito no genera deuda: `cliente.saldo` se inicializa en cero y ninguna
 * linea de produccion lo sube. Aceptar una venta a credito es regalar la
 * mercancia y decir que todo cuadra. Se apaga en el SERVIDOR, no en la pantalla:
 * el boton escondido no detiene a quien manda la peticion a mano.
 */
test("una venta a credito se rechaza", () => {
  const DB = prepararDB();
  assert.throws(
    () => crearVenta(DB, { sucursal_id: 4, metodo_pago: "CRÉDITO", lineas: [LINEA], total: 100 }),
    /cr[eé]dito/i
  );
  assert.strictEqual(DB.pos.ventas.length, 0, "no se guarda nada");
});

/**
 * En el repo el credito se escribe "CRÉDITO" con acento (condicionesPago.js:14,
 * apartados.js:54 y :169) y cortes.js:131 acepta las dos formas. Un rechazo que
 * solo atrape una de las dos deja el agujero abierto y las pruebas en verde.
 */
test("se rechaza sin importar acento, mayusculas ni espacios", () => {
  for (const forma of ["credito", "Crédito", "CRÉDITO", "CREDITO", "  crédito  "]) {
    const DB = prepararDB();
    assert.throws(
      () => crearVenta(DB, { sucursal_id: 4, metodo_pago: forma, lineas: [LINEA], total: 100 }),
      /cr[eé]dito/i,
      `no rechazo "${forma}"`
    );
  }
});

test("las demas formas de pago siguen funcionando", () => {
  for (const forma of ["EFECTIVO", "TARJETA", "TRANSFERENCIA"]) {
    const DB = prepararDB();
    const venta = crearVenta(DB, { sucursal_id: 4, metodo_pago: forma, lineas: [LINEA], total: 100 });
    assert.strictEqual(venta.estatus, "cerrada", `se rompio ${forma}`);
  }
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `cd backend && node --test creditoApagado.test.js`
Expected: FAIL — hoy la venta a crédito se acepta.

- [ ] **Step 3: Rechazar en el servidor**

En `crearVenta`, **antes** de construir la venta y antes de tocar el inventario:

```js
  // El credito esta APAGADO a proposito (decision de Victor, 2026-09-04). El
  // sistema aceptaba la venta pero NUNCA generaba la deuda: `cliente.saldo` se
  // inicializa en cero y ninguna linea lo sube, asi que una venta a credito era
  // mercancia regalada con la caja cuadrada. Se vuelve a encender el dia que
  // existan cuentas por cobrar de verdad, y no antes.
  const formaPago = String(datos.metodo_pago || "EFECTIVO").trim().toUpperCase();
  if (formaPago.normalize("NFD").replace(/[̀-ͯ]/g, "") === "CREDITO") {
    throw new Error("Las ventas a crédito están deshabilitadas: el sistema todavía no lleva cuentas por cobrar");
  }
```

- [ ] **Step 4: Quitar el botón de la pantalla**

En `src/PuntoDeVenta.jsx`, quitar CRÉDITO de las formas de pago ofrecidas. La regla vive en el servidor (paso 3); esto solo evita que alguien lo intente y se lleve un error.

- [ ] **Step 5: Correr y verificar que pasan**

Run: `cd backend && node --test creditoApagado.test.js cajas.test.js corteSellado.test.js`
Expected: PASS. Si alguna prueba existente arma una venta a crédito, **actualízala** y deja escrito en su comentario que el cambio fue deliberado, con fecha.

- [ ] **Step 6: Suite y commit**

```bash
cd backend && node --test
cd .. && npx eslint src backend
git add backend/ventas.js backend/creditoApagado.test.js src/PuntoDeVenta.jsx
git commit -m "fix(ventas): apagar el credito, que entrega mercancia sin generar deuda"
```

---

### Task 2: Cerrar la puerta trasera de los clientes

**Por qué.** `actualizarCliente` (`backend/clientes.js:67-70`) hace `{ ...actual, ...datos, id }` sin lista blanca. Quien tenga `editar_cliente` —**y el gerente sí lo tiene**— puede fijar por HTTP `limite_credito`, `sujeto_credito`, `saldo` y `monedero` sobre cualquier cliente. Es la puerta trasera de la Tarea 1, y sigue abierta aunque el crédito esté apagado: `monedero` y `saldo` son dinero.

**Files:**
- Modify: `backend/clientes.js` (`actualizarCliente`)
- Test: `backend/clientesListaBlanca.test.js` (nuevo)

- [ ] **Step 1: Escribir la prueba que falla**

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { crearCliente, actualizarCliente } = require("./clientes");

/**
 * Asignacion en masa: el cuerpo de la peticion se copiaba entero sobre el
 * cliente. Los campos de dinero no los escribe una persona desde una pantalla:
 * los calcula el sistema.
 */
test("editar un cliente no puede tocar los campos de dinero", () => {
  const DB = construirDBPrueba();
  const cliente = crearCliente(DB, { nombre: "Cliente de prueba", sucursal_id: 1 });
  const limiteOriginal = cliente.limite_credito;

  actualizarCliente(DB, cliente.id, {
    nombre: "Nombre corregido",
    saldo: -999999,
    monedero: 50000,
    limite_credito: 900000,
    sujeto_credito: true,
  });

  const guardado = DB.crm.clientes.find((c) => c.id === cliente.id);
  assert.strictEqual(guardado.nombre, "Nombre corregido", "los campos normales si se editan");
  assert.strictEqual(guardado.saldo, 0);
  assert.strictEqual(guardado.monedero, 0);
  assert.strictEqual(guardado.limite_credito, limiteOriginal);
});
```

Comprueba primero cómo se llama la colección de clientes dentro de `construirDBPrueba` y ajusta la
aserción a la real; **no lo supongas**.

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd backend && node --test clientesListaBlanca.test.js`
Expected: FAIL — hoy los cuatro campos se sobrescriben.

- [ ] **Step 3: Implementar la lista blanca**

Sustituir el spread por una lista explícita de campos editables. **Léela del objeto que construye
`crearCliente`** (`backend/clientes.js:32-52`) para no dejar fuera ninguno legítimo, y excluye a mano
los de dinero:

```js
// Los campos de dinero (saldo, monedero, limite_credito, sujeto_credito) NO se
// editan desde aqui: los calcula el sistema. Con el spread entero, quien tenia
// `editar_cliente` podia fijarse un limite de credito o un monedero por HTTP.
const CAMPOS_EDITABLES = [/* copiar de crearCliente, menos los de dinero */];
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `cd backend && node --test clientesListaBlanca.test.js`

- [ ] **Step 5: Quitar los campos de crédito del alta rápida**

En la pantalla de alta rápida de clientes del POS, quitar límite de crédito y sujeto a crédito:
mientras el crédito esté apagado no significan nada y solo invitan a llenarlos.

- [ ] **Step 6: Suite y commit**

```bash
cd backend && node --test
cd .. && npx eslint src backend
git add backend/clientes.js backend/clientesListaBlanca.test.js src/
git commit -m "fix(clientes): editar un cliente ya no puede fijarle saldo, monedero ni credito"
```

---

### Task 3: El servidor decide el precio, no el navegador

**Por qué.** Verificado: `crearVenta` guarda `subtotal`, `descuento` y `total` **tal como se los manda la pantalla**. Un artículo de $12,000 se puede registrar en $1, y un descuento de 99.99% se acepta. El límite está solo en la interfaz, y la ruta solo pide `cerrar_venta`.

Se lleva el margen completo de cada ticket y **no deja ninguna señal**: en los reportes se ve como una venta barata legítima.

**NO INVENTES UN PORCENTAJE MÁXIMO.** Se buscó y **no existe ninguno** en el repo. El control de esta tarea es otro: el servidor exige el permiso **`aplicar_descuentos_articulos_venta`** (`backend/permisosCatalogo.js:21`, que hoy solo se comprueba en la pantalla) para aceptar cualquier descuento mayor que cero. El tope porcentual es una decisión pendiente de Victor y **no entra aquí**.

**Files:**
- Modify: `backend/ventas.js` (`crearVenta`), `backend/server.js` (pasar los permisos de quien vende)
- Test: `backend/ventaPrecioServidor.test.js` (nuevo)

- [ ] **Step 1: Escribir las pruebas que fallan**

Cubrir tres cosas, usando el `prepararDB()` de arriba y un producto real de
`DB["catalogo-productos"].productos`:

1. Una línea **con `producto_id`** y un precio manipulado se registra al precio del catálogo, no al enviado.
2. Una línea **sin `producto_id`** (producto rápido) se respeta tal cual — no hay catálogo contra el cual recalcular.
3. Un descuento mayor que cero **sin el permiso** `aplicar_descuentos_articulos_venta` se rechaza; **con** el permiso se acepta.

- [ ] **Step 2: Correr y verificar que fallan.**

- [ ] **Step 3: Implementar el recálculo** — por cada línea con `producto_id`, tomar el precio del catálogo, aplicar el descuento solo si quien vende tiene el permiso, y calcular `subtotal`, `descuento` y `total` desde ahí. Lo que venga en el cuerpo para esos tres campos se ignora.

- [ ] **Step 4: Correr la suite entera.** Aquí es donde más probable es romper algo: cualquier prueba que arme una venta con totales a mano va a cambiar. **Actualízala solo si el nuevo total es el correcto**; si no cuadra, el recálculo está mal.

- [ ] **Step 5: Commit**

```bash
git add backend/ventas.js backend/server.js backend/ventaPrecioServidor.test.js
git commit -m "fix(ventas): el precio y el total los decide el servidor, no el navegador"
```

---

# FASE 2 — Lo que un gerente puede hacer

### Task 4: Que se vea quién canceló

**Por qué.** Verificado ejecutándolo: vender, cobrar, entregar y cancelar antes del corte deja **la caja y el inventario cuadrados los dos**. El efectivo esperado baja exactamente lo cobrado y la existencia vuelve al valor previo. `cancelada_por` **sí se guarda** (`backend/ventas.js:196`) pero —comprobado por grep— **no se muestra en ninguna pantalla ni reporte**: `src/ConsultasVentas.jsx:424` solo pinta el motivo.

Un fraude que nadie puede ver es un fraude que se repite. Uno visible casi no se hace.

**Files:**
- Modify: `src/ConsultasVentas.jsx` (columna y detalle)
- Modify: `backend/reportes.js` + su pantalla (reporte de cancelaciones)
- Test: `backend/reporteCancelaciones.test.js` (nuevo)

- [ ] **Step 1: Escribir la prueba que falla**

```js
test("el reporte de cancelaciones dice quien, cuando y cuanto", () => {
  const DB = construirDBPrueba();
  DB.pos.ventas = [{
    id: 1, folio: "T-0001", sucursal_id: 1, estatus: "cancelada", total: 8000,
    fecha: "2026-09-04", cancelada_por: "Gerente Ocosingo",
    fecha_hora_cancelacion: "2026-09-04T21:00:00.000Z", motivo_cancelacion: "cliente se arrepintio",
  }];

  const [fila] = reporteCancelaciones(DB, { fecha_inicio: "2026-09-04", fecha_fin: "2026-09-04" }, { verTodas: true, sucursalId: null });

  assert.strictEqual(fila.cancelada_por, "Gerente Ocosingo");
  assert.strictEqual(fila.total, 8000);
  assert.ok(fila.fecha_hora_cancelacion);
});
```

- [ ] **Step 2: Correr y verificar que falla** — la función no existe.

- [ ] **Step 3: El reporte**

Un reporte nuevo en `backend/reportes.js` siguiendo exactamente el patrón de los que ya existen (mismo tipo de filtros, mismo `alcance`, mismas filas enriquecidas). Registrar su permiso en `backend/permisosCatalogo.js` si los demás reportes tienen el suyo — **mira cómo lo hacen los vecinos** y no inventes un patrón nuevo.

- [ ] **Step 4: Que se vea en Consultas de Ventas**

En el detalle de una venta cancelada, mostrar quién la canceló y cuándo, junto al motivo que ya se muestra. Y añadir esos campos a la exportación a CSV.

- [ ] **Step 5: Correr, lint y commit**

```bash
cd backend && node --test
cd .. && npx eslint src backend
git add backend/reportes.js backend/reporteCancelaciones.test.js backend/permisosCatalogo.js src/
git commit -m "feat(ventas): quien cancelo, cuando y por cuanto deja de ser invisible"
```

---

### Task 5: Cancelar un apartado deja rastro

**Por qué.** Es el mismo fraude de la Tarea 4 **pero sin ningún rastro, y además se dispara solo.** Verificado ejecutándolo: un apartado de $20,000 con anticipo de $12,000 en efectivo ya contado en un corte; al cancelarlo, `cancelada_por` y `fecha_hora_cancelacion` quedan en `undefined` — la ruta (`backend/server.js:1626`) llama a `cancelarApartado(DB, id, motivo)` **sin pasar el usuario**, a diferencia de `cancelarVenta`. La mercancía vuelve completa al inventario y los $12,000 ya cortados se convierten en `cliente.monedero` (`backend/apartados.js:226-229`), un número que —comprobado por grep— **no se puede gastar en ninguna parte**.

Y `procesarVencimientos` (`backend/apartados.js:233-240`) hace todo esto **automáticamente a los 60 días**, cada vez que alguien abre la pantalla de Apartados, sin usuario y sin aviso. Basta con dejar vencer un apartado grande.

**Files:**
- Modify: `backend/server.js:1626` (pasar el usuario)
- Modify: `backend/apartados.js` (`cancelarApartado`, `procesarVencimientos`)
- Test: `backend/apartadoCancelacion.test.js` (nuevo)

- [ ] **Step 1: Escribir las pruebas que fallan**

```js
test("cancelar un apartado registra quien y cuando", () => {
  const DB = construirDBPrueba();
  const apartado = crearApartadoDePrueba(DB, { anticipo: 12000 });

  cancelarApartado(DB, apartado.id, "cliente no volvio", usuarioDePrueba());

  const guardado = DB.pos.ventas.find((v) => v.id === apartado.id);
  assert.strictEqual(guardado.cancelada_por, usuarioDePrueba().nombre);
  assert.ok(guardado.fecha_hora_cancelacion, "tiene que quedar la hora");
});

/**
 * El vencimiento automatico corre solo, sin que nadie lo pida. Si no dice que
 * fue el sistema, un apartado grande que se deja vencer se lee igual que uno
 * cancelado por una persona — o peor, que uno que nadie cancelo.
 */
test("el vencimiento automatico se registra como del sistema", () => {
  const DB = construirDBPrueba();
  const apartado = crearApartadoDePrueba(DB, { anticipo: 12000, fecha_limite: "2026-01-01" });

  procesarVencimientos(DB);

  const guardado = DB.pos.ventas.find((v) => v.id === apartado.id);
  assert.match(String(guardado.cancelada_por), /sistema/i);
  assert.ok(guardado.fecha_hora_cancelacion);
});
```

- [ ] **Step 2: Correr y verificar que fallan** — hoy los dos campos quedan en `undefined`.

- [ ] **Step 3: Implementar**

- `cancelarApartado` recibe el usuario y escribe `cancelada_por` y `fecha_hora_cancelacion`, **igual que `cancelarVenta`** — mira cómo lo hace y sigue ese patrón, no inventes otro.
- La ruta de `server.js:1626` pasa `req.usuarioToken`.
- `procesarVencimientos` marca `cancelada_por: "Sistema (vencimiento automático)"`.

- [ ] **Step 4: Que los apartados cancelados salgan en el reporte de la Tarea 4**

Un apartado cancelado es una cancelación. Comprobar que el reporte los incluye y que la columna dice de qué tipo de documento se trata.

- [ ] **Step 5: Correr, y commit** — `cd backend && node --test apartadoCancelacion.test.js apartados.test.js apartadosCorteCaja.test.js`

```bash
git add backend/apartados.js backend/server.js backend/apartadoCancelacion.test.js
git commit -m "fix(apartados): cancelar un apartado ya no borra el rastro de quien lo hizo"
```

**Anotado para después, NO en este plan:** el dinero ya cortado que se convierte en `monedero` sigue siendo un saldo que no se puede gastar en ninguna parte. Decidir qué hacer con él es una pregunta de negocio para Victor, no una tarea de programación.

---

### Task 6: Un ajuste de inventario dice quién lo hizo

**Por qué.** `backend/productos.js:388-396`: el movimiento de inventario guarda producto, sucursal, fecha, tipo, cantidad y un texto libre — **ningún usuario**. La ruta (`backend/server.js:995`) tampoco pasa identidad. El gerente sí tiene `ajustar_existencia`. Alguien puede bajar la existencia de un producto caro y no hay a quién preguntarle.

**Files:**
- Modify: `backend/productos.js` (el registro del movimiento), `backend/server.js:995`
- Test: `backend/movimientoInventarioUsuario.test.js` (nuevo)

- [ ] **Step 1: Prueba que falla**

```js
test("un ajuste de existencia guarda quien lo hizo", () => {
  const DB = construirDBPrueba();
  const producto = DB["catalogo-productos"].productos[0];

  ajustarExistencia(DB, { producto_id: producto.id, sucursal_id: 1, cantidad: -5, motivo: "merma" }, usuarioDePrueba());

  const [mov] = DB.inventario.movimientos_inventario.slice(-1);
  assert.strictEqual(mov.usuario, usuarioDePrueba().nombre);
});
```

Ajusta el nombre de la función y de la colección a los reales del repo.

- [ ] **Step 2: Correr y verificar que falla.**

- [ ] **Step 3: Implementar** — el movimiento guarda `usuario`, y la ruta lo pasa desde `req.usuarioToken`. **Los movimientos ya guardados no se tocan**: quedan sin usuario, y eso es correcto — no se puede inventar quién los hizo.

- [ ] **Step 4: Mostrarlo** en el historial de movimientos del producto, o el dato no sirve de nada.

- [ ] **Step 5: Suite y commit**

```bash
cd backend && node --test
git add backend/productos.js backend/server.js backend/movimientoInventarioUsuario.test.js src/
git commit -m "feat(inventario): un ajuste de existencia ya dice quien lo hizo"
```

---

### Task 7: El alta de un producto con piezas deja movimiento

**Por qué.** `backend/productos.js:231-239` escribe `cantidad_actual` directo al dar de alta un producto, **sin generar movimiento y sin usuario**. Es la única forma de meter existencia al sistema sin dejar huella, y ya es un problema conocido del repo (es la razón por la que `rastroHistorico` tuvo que mirar la existencia además de los movimientos).

**Files:**
- Modify: `backend/productos.js` (`crearProducto`)
- Test: `backend/altaProductoMovimiento.test.js` (nuevo)

- [ ] **Step 1: Prueba que falla** — dar de alta un producto con existencia inicial y comprobar que existe un movimiento de tipo alta, con usuario, por esa cantidad.
- [ ] **Step 2: Correr y verificar que falla.**
- [ ] **Step 3: Implementar** — generar el movimiento en la misma operación que crea el producto.
- [ ] **Step 4: Correr la suite entera.** `rastroHistorico` (el guard de baja de productos) mira los movimientos: con este cambio, un producto recién dado de alta con piezas **empieza a tener rastro**, así que su comportamiento al darlo de baja cambia. Comprobar `productosBaja.test.js` y actualizar lo que haga falta **entendiendo por qué**, no para que pase.
- [ ] **Step 5: Commit**

```bash
git add backend/productos.js backend/altaProductoMovimiento.test.js
git commit -m "feat(inventario): el alta con existencia inicial deja movimiento y usuario"
```

---

# FASE 3 — Fugas que no necesitan mala fe

### Task 8: Una venta que no descuenta inventario deja de callarse

**Por qué.** Verificado ejecutándolo: una venta en Palenque de un producto que no tiene fila de existencia allí **se registra igual, con cero movimientos de inventario**, porque la excepción se traga en silencio (`backend/ventas.js:112-118`). Mismo patrón en `ventas.js:202-206` y `apartados.js:216-221`. Nadie se entera de que el inventario y las ventas dejaron de contar la misma historia.

- [ ] **Step 1: Prueba que falla** — vender un producto sin existencia en esa sucursal y comprobar que la venta **no** queda registrada en silencio: o falla con un error claro, o se registra dejando constancia visible de que el inventario no se movió.
- [ ] **Step 2: Correr y verificar que falla.**
- [ ] **Step 3: Implementar.** **Decisión que hay que preguntarle a Victor antes de escribir esto:** ¿una venta cuyo inventario no se puede descontar debe rechazarse, o cobrarse igual y quedar marcada? Cobrar es lo que pasa hoy; rechazar podría frenar una venta real en el mostrador. **No lo decidas tú.**
- [ ] **Step 4: Correr la suite y commitear.**

---

### Task 9: MercadoLibre no importa lo que no está pagado

**Por qué.** `backend/mercadolibre.js:239-243` trae la orden y **nunca mira `orden.status` ni los pagos**; la crea con `estatus: "cerrada"` (`:315-341`). Y `:358` recorta el stock con `Math.max(0, ...)` **sin generar movimiento de inventario** — lo contrario de lo que dice el propio comentario de `productos.js:381-385`. El daño es inventario y utilidad, no faltante de caja: `metodo_pago: "mercadolibre"` cae en transferencias.

- [ ] **Step 1: Pruebas que fallan** — una orden cancelada o no pagada no se importa; un recorte de stock genera su movimiento con motivo.
- [ ] **Step 2: Correr y verificar que fallan.**
- [ ] **Step 3: Implementar** — comprobar el estado de la orden antes de crear la venta, y que todo cambio de existencia pase por la misma función que registra movimientos.
- [ ] **Step 4: Suite y commit.**

---

### Task 10: Una compra no puede tener costo cero o negativo

**Por qué.** `backend/compras.js:61-64` no valida el costo de los renglones, y `:95` solo actualiza el costo del producto si es mayor que cero — así que el detalle de la compra queda en cero o negativo mientras el producto conserva otro costo. Los reportes de utilidad quedan mintiendo.

- [ ] **Step 1: Prueba que falla** — una recepción con costo cero o negativo se rechaza entera, antes de tocar existencias.
- [ ] **Step 2: Correr y verificar que falla.**
- [ ] **Step 3: Implementar** — validar junto a las validaciones que ya corren antes de la primera mutación (`compras.js:54-69`), que es donde corresponde.
- [ ] **Step 4: Suite y commit.**

---

### Task 11: El mapa de permisos deja de ser público

**Por qué.** `GET /api/roles` (`backend/server.js:1245`) responde **sin login** y devuelve el arreglo completo de permisos de cada rol. Es el modelo de autorización entero, publicado en internet. No es dinero directo, pero es el mapa que usa cualquiera que quiera buscar por dónde entrar.

- [ ] **Step 1: Prueba que falla** — una petición sin token recibe 401, y con token sin permiso de administrar roles no recibe el detalle de permisos.
- [ ] **Step 2: Correr y verificar que falla.**
- [ ] **Step 3: Implementar** — `requiereLogin`, y devolver solo lo que la pantalla de login de verdad necesita. **Comprobar qué usa el frontend de esa ruta antes de recortarla**, o se rompe el login.
- [ ] **Step 4: Suite, prueba en navegador del login, y commit.**

---

### Task 12: Los gastos de garantía entran en alguna caja

**Por qué.** `backend/garantiasGastos.js:47-58` guarda el gasto **sin forma de pago, sin sucursal, sin caja y sin corte**, y la pantalla tampoco lo pregunta (`src/Garantias.jsx:43`). Es dinero que sale y no aparece en ningún corte ni en la utilidad. Además se pueden borrar (`:79-91`), dejando solo una nota de texto.

Esta tarea **depende de la decisión que Victor ya tiene pendiente** desde el módulo de Gastos: si los gastos de garantía deben restarse de la utilidad y del corte, o quedarse como cifras separadas. **Preguntar antes de implementar.**

---

## Endurecimiento anotado, fuera de este plan

Los mecanismos existen pero hoy **solo el Administrador** tiene esos permisos. Valen la pena antes de repartir permisos, no como fuga abierta:

- **Depósitos sin comprobante** (`backend/depositos.js:76-114`) que suman al estado de cuenta sin ficha. Ojo: en una instancia sembrada de cero el Gerente **sí** los recibiría (`roles.js:73`).
- **Traspasos sin cancelación, rechazo ni vencimiento** (`backend/traspasos.js:57-98`): el origen se descuenta de inmediato y el dinero puede quedarse "en tránsito" para siempre.
- **Borrar un gasto de garantía** (`garantiasGastos.js:79-91`).
- **`crearUsuario` acepta cualquier `rol_id` y `sucursal_id`** sin comprobar el alcance de quien crea, y sin bitácora (`backend/usuarios.js:142-155`). Hoy no hay escalada porque solo el Administrador puede; es una bomba armada para el día que le des `dar_alta_personal` a un gerente.
- **El nivel de precio del cliente no se usa nunca** (`clientes.js:48` lo guarda, nadie lo lee; `src/PuntoDeVenta.jsx:361` usa siempre `precio_venta`). Campo muerto: o se conecta o se quita.

---

## Verificación final, antes de que Victor apruebe el merge

- `cd backend && node --test` — sin regresiones.
- `npx eslint src backend` — 0 errores.
- `git diff --check` limpio y sin archivos inesperados.
- **Revisión independiente de todo el diff** — despachada a Codex, y **revisada por alguien que no sea Codex**, porque este plan sale de una auditoría suya.
- **Prueba en navegador:**

1. **El crédito ya no se puede.** Intentar cobrar una venta a crédito desde el punto de venta: el botón no debe estar, y si se manda la petición a mano debe rechazarse.
2. **El precio no se puede cambiar por debajo.** Cobrar una venta normal y comprobar que el total es el del catálogo. Intentar un descuento por encima del máximo y comprobar que se rechaza.
3. **Editar un cliente no toca su dinero.** Cambiarle el nombre a un cliente y comprobar que se guarda; comprobar que ya no hay campos de crédito en el alta rápida.
4. **La cancelación se ve.** Cancelar una venta y comprobar que en Consultas de Ventas aparece quién la canceló y cuándo, y que sale en el CSV y en el reporte nuevo.
5. **El apartado también.** Cancelar un apartado y comprobar lo mismo.
6. **El ajuste de inventario dice quién.** Ajustar la existencia de un producto y ver el nombre en el historial.
7. **Vender sigue funcionando.** Una venta normal en efectivo, de principio a fin, con su ticket — la prueba de que nada de esto rompió el trabajo de todos los días.
