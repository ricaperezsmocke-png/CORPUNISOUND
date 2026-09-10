# Fugas de dinero de la auditoría del 2026-09-08 — plan de implementación

> **Para quien lo ejecute:** usa `superpowers:subagent-driven-development` o `superpowers:executing-plans` para implementarlo tarea por tarea. Los pasos usan casillas `- [ ]`.

**Goal:** Cerrar las siete fugas de dinero que la auditoría del 2026-09-08 comprobó ejecutando código, y que hoy están abiertas en `master`.

**Architecture:** No hay módulos nuevos. Cada tarea lleva a un módulo que ya existe la validación que su módulo vecino ya tiene: `apartados.js` recibe el mismo blindaje de servidor que `ventas.js` recibió el 2026-09-04, la corrección de gastos recibe el alcance de sucursal que el resto de las puertas ya usa, y dos reportes se ponen al día con `monedero_aplicado`. Todo lo que valida dinero vive en el servidor.

**Tech Stack:** Node.js/CommonJS, Express, DB en memoria persistida a SQLite con `better-sqlite3`; React 18 + Vite + Tailwind; pruebas con `node:test` y `node:assert/strict`. Ninguna dependencia nueva.

**Auditoría de origen:** `docs/superpowers/auditorias/2026-09-08-estado-real-de-los-planes.md` — leerla antes de empezar. Cada tarea de abajo cita el hallazgo que cierra.

**Base:** rama `master`, commit `d345bdf`. Suite en verde: 1447/1447. Eslint: 0 errores, 456 warnings preexistentes.

**Preparar el worktree ANTES de correr la suite (deuda ambiental, resuelta y comprobada el 2026-09-10).**
Un worktree recién creado no puede correr la suite: le faltan cuatro cosas que git ignora y que solo
existen en el repo principal. Sin ellas fallan ~69 pruebas con `MODULE_NOT_FOUND`, `SQLITE_CANTOPEN`
y siembras que devuelven 400 — **ninguno de esos fallos tiene que ver con el código que estés tocando.**

1. `node_modules` de la raíz (180 MB) — **copiarlo, NO enlazarlo.** Varias pruebas de pantalla cargan
   `../node_modules/react` por ruta relativa, así que no basta con que Node resuelva hacia arriba.
2. `backend/node_modules` (75 MB) — copiarlo también. Ahí viven `bcryptjs`, `@sentry/node`, `dotenv`,
   `better-sqlite3`, `xlsx` y `fast-xml-parser`.
3. `backend/.env` — copiarlo. `server.js` hace `require("dotenv").config()`; sin él, sembrar un
   usuario devuelve 400 y caen las 6 pruebas de expedientes.
4. `backend/datos.sqlite` — copiarlo. Enlazada, las pruebas escribirían en la base real de trabajo.

**Por qué copia y no junction:** con un junction, Node resuelve la ruta real del módulo fuera del
worktree y toca `C:\Users\Victor`. El sandbox de Codex lo prohíbe (`EPERM`) y entonces Codex no puede
correr ni una sola prueba. Con copias reales, todo queda dentro del worktree y Codex trabaja normal.
Se probó de las dos formas el 2026-09-10; la copia es la única que sirve para los dos.

```powershell
$R = "C:\Users\Victor\Desktop\CORPUNISOUND"; $W = "$R\.claude\worktrees\<tu-worktree>"
robocopy "$R\node_modules" "$W\node_modules" /E /MT:16 /NFL /NDL /NJH /NJS /NP
robocopy "$R\backend\node_modules" "$W\backend\node_modules" /E /MT:16 /NFL /NDL /NJH /NJS /NP
Copy-Item "$R\backend\.env" "$W\backend\.env"; Copy-Item "$R\backend\datos.sqlite" "$W\backend\datos.sqlite"
```

**Aun así, Codex no puede correr la suite completa ni hacer `git commit` en un worktree:** el `.git`
real vive en el repo principal, fuera de su workspace, y el sandbox le niega `index.lock`. El reparto
que funciona: Codex implementa y corre su archivo de pruebas; Claude corre la suite completa y commitea.

Las cuatro están en `.gitignore`, así que no ensucian el commit. Baseline comprobado el 2026-09-10:
**1447/1447 en verde en el repo principal**; 1453/1453 con la Task 1, 1457/1457 con la Task 2 , 1462/1462 con la Task 3 y 1467/1467 con la Task 4.

**Estado de producción (Victor, 2026-09-08):** el sistema está desplegado pero **las cajeras todavía no lo usan**. Ninguna de estas fugas se ha explotado. Eso quita la urgencia de horas, no la de arreglarlo antes de que entren.

## Global Constraints

Copiadas textualmente de `CLAUDE.md`; no son reglas nuevas de este plan.

> - **No agregar dependencias.** Ninguna. Las pruebas usan el runner integrado de Node (`node --test`).
> - **No `git add .`** — el repo tiene ~527 archivos sin seguimiento. Siempre staging por rutas explícitas.
> - **No push, no merge, no rebase.** Eso lo hace Victor, siempre. Commits en la rama de trabajo, sí.
> - **Mensajes de commit sin acentos** (el terminal de Windows los rompe). En el código y en la interfaz, los acentos sí van.

> **1. Toda validación de dinero va en el SERVIDOR.** Una comprobación que solo vive en `src/` no es una comprobación: es una sugerencia.
>
> **2. Las guardas fallan CERRANDO, no abriendo.** Valida contra la lista de lo permitido, no contra la de lo prohibido.
>
> **4. Los ids que llegan del cuerpo HTTP pueden ser TEXTO.** `"9" === 9` es falso. Normaliza con `Number(...)`, cuidando que `Number(null)` es `0`.
>
> **5. El selector de sucursal del encabezado es un FILTRO de listas, nunca la fuente del alcance.** Para un guard por `:id`, resuelve el alcance solo de quien pregunta: su permiso `ver_todas_las_sucursales` y la `sucursal_id` de su token.

Firmas reales, verificadas en el árbol el 2026-09-08 — **no las inventes**:

```js
crearVenta(DB, datos, opciones = {})            // opciones: { permisos, usuario }
crearApartado(DB, datos, sucursalId, usuario, cajaId)
registrarAbono(DB, ventaId, datos, usuario, cajaId)
cancelarApartado(DB, ventaId, motivo, usuario)
corregirOrigenGasto(DB, id, cambios, usuario)   // hoy NO recibe alcance
estadoCuenta(DB, filtros, alcance)
reporteMovimientosCaja(DB, filtros, alcance)
listarCondiciones(DB, sucursal_id = 1)
eliminarGasto(DB, garantiaId, gastoId, usuario, alcance, drive)
```

`backend/testHelpers.js` exporta **solo** `construirDBPrueba` y `sembrarCuentas`. El patrón es un `prepararDB()` local dentro del propio archivo de prueba; cópialo de `backend/monederoCorte.test.js`.

**Cada prueba se corre en ROJO antes de implementar.** Una prueba que nunca falló no prueba nada.

---

### Task 1: Una venta no puede tener cantidad negativa

**Por qué.** Comprobado ejecutando el código: una venta con `cantidad: -1` de un artículo de $32 se cierra con total **−$32**, y el efectivo que el corte le pide a la cajera baja a **−$32**. Quien lo haga puede sacar $32 del cajón y el corte sigue cuadrando. Es la fuga más barata de explotar de toda la lista: una línea con signo menos.

**Files:**
- Modify: `backend/ventas.js` (dentro de `crearVenta`, donde hoy se lee `Number(l.cantidad) || 0`)
- Test: `backend/ventaCantidadInvalida.test.js` (nuevo)

**Interfaces:**
- Consume: `crearVenta(DB, datos, opciones)` tal como está.
- Produce: nada nuevo hacia afuera. `crearVenta` lanza `Error` ante una cantidad no positiva o no finita.

- [x] **Paso 1: Escribir las pruebas que fallan**

```js
test("una venta con cantidad negativa se rechaza", () => {
  const DB = prepararDB();
  assert.throws(
    () => crearVenta(DB, { sucursal_id: 1, cliente_id: 1, metodo_pago: "EFECTIVO",
      lineas: [{ producto_id: 3, cantidad: -1 }] }),
    /cantidad/i
  );
});

test("cantidad cero tampoco: una linea que no vende nada no es una venta", () => {
  const DB = prepararDB();
  assert.throws(() => crearVenta(DB, { sucursal_id: 1, cliente_id: 1, metodo_pago: "EFECTIVO",
    lineas: [{ producto_id: 3, cantidad: 0 }] }), /cantidad/i);
});

test("cantidad de TEXTO negativa tambien se rechaza: el cuerpo HTTP manda texto", () => {
  const DB = prepararDB();
  assert.throws(() => crearVenta(DB, { sucursal_id: 1, cliente_id: 1, metodo_pago: "EFECTIVO",
    lineas: [{ producto_id: 3, cantidad: "-5" }] }), /cantidad/i);
});

test("basura en la cantidad se rechaza, no se convierte en cero en silencio", () => {
  const DB = prepararDB();
  for (const cantidad of [null, undefined, "", "abc", NaN, Infinity, {}]) {
    assert.throws(() => crearVenta(DB, { sucursal_id: 1, cliente_id: 1, metodo_pago: "EFECTIVO",
      lineas: [{ producto_id: 3, cantidad }] }), /cantidad/i, `paso con cantidad: ${String(cantidad)}`);
  }
});

test("la red: una venta normal de 2 piezas sigue funcionando", () => {
  const DB = prepararDB();
  const v = crearVenta(DB, { sucursal_id: 1, cliente_id: 1, metodo_pago: "EFECTIVO",
    lineas: [{ producto_id: 3, cantidad: 2 }] });
  assert.equal(v.total > 0, true);
});

test("el corte nunca recibe un efectivo esperado negativo por una venta", () => {
  const DB = prepararDB();
  try { crearVenta(DB, { sucursal_id: 1, cliente_id: 1, metodo_pago: "EFECTIVO",
    lineas: [{ producto_id: 3, cantidad: -1 }] }); } catch { /* se espera el rechazo */ }
  assert.equal(calcularCorteEnCurso(DB, 1).calculado.EFECTIVO, 0);
});
```

- [x] **Paso 2: Correrlas y verificar que fallan.** `cd backend && node --test ventaCantidadInvalida.test.js > salida.txt 2>&1`. Esperado en rojo: la 1, la 2, la 3, la 4 y la 6. La quinta ("la red") debe PASAR desde el principio: es la red de seguridad, no se fuerza a fallar. **No pipees a `tail`**: la salida completa va al archivo o se pierden los detalles.

- [x] **Paso 3: Implementar.** En `crearVenta`, **antes** de calcular nada, validar cada línea. Falla cerrando: se acepta solo lo que es un número finito mayor que cero.

```js
const cantidad = Number(l.cantidad);
if (!Number.isFinite(cantidad) || cantidad <= 0) {
  throw new Error(`La cantidad de "${l.descripcion || producto?.nombre || "el articulo"}" debe ser mayor que cero`);
}
```

Cuidado: hoy el código usa `Number(l.cantidad) || 0` en dos lugares (la comprobación de existencia y el cálculo de líneas). El `|| 0` convierte la basura en cero **en silencio** — quítalo en ambos y usa la variable validada.

- [x] **Paso 4: Correr la suite entera.** `cd backend && node --test > salida.txt 2>&1`. Este cambio toca el archivo del dinero; si algo se rompe, sale aquí. Revisa que ninguna prueba existente dependiera de cantidad cero. Conteo esperado al terminar: 1453/1453 (las 1447 de la base mas las 6 nuevas).

- [x] **Paso 5: Commit.**

```bash
git add backend/ventas.js backend/ventaCantidadInvalida.test.js
git commit -m "fix(ventas): rechaza cantidades no positivas

Una venta de cantidad -1 dejaba el efectivo esperado del corte en negativo:
quien la hiciera podia sacar esa cantidad del cajon y el corte cuadraba."
```

---

### Task 2: El reporte de Movimientos de Caja deja de contradecir al corte

**Por qué.** Comprobado ejecutando el código: una venta de $32 con $10 de monedero deja el corte esperando **$22**, pero `reporteMovimientosCaja` informa **$32** de entradas. Son $10 de diferencia contra la cajera. Quien audite con el reporte en la mano —el contador, o Victor— va a reclamarle dinero que nunca entró al cajón.

**Este defecto lo introdujimos nosotros el 2026-09-07** al hacer gastable el monedero: se actualizó `cortes.js` y no este reporte. Es exactamente el error que costó el descuento por forma de pago dos días antes.

**Files:**
- Modify: `backend/reportes.js` (`reporteMovimientosCaja`, línea ~364)
- Test: `backend/movimientosCajaMonedero.test.js` (nuevo)

**Interfaces:**
- Consume: `reporteMovimientosCaja(DB, filtros, alcance)`, misma firma.
- Produce: las entradas de venta valen `venta.total - (venta.monedero_aplicado || 0)`, igual que en `backend/cortes.js:178`.

- [x] **Paso 1: Escribir las pruebas que fallan**

```js
test("el reporte informa lo que entro al cajon, no el valor de la venta", () => {
  const DB = prepararDB();
  DB.crm.clientes.find((c) => c.id === 1).monedero = 10;
  crearVenta(DB, { sucursal_id: 1, cliente_id: 1, metodo_pago: "EFECTIVO",
    monedero_aplicado: 10, lineas: [{ producto_id: 3, cantidad: 1 }] });
  const r = reporteMovimientosCaja(DB, {}, { verTodas: true, sucursalId: null });
  const efectivo = r.entradas.find((e) => e.forma_pago === "EFECTIVO");
  assert.equal(efectivo.total, 22, "el corte espera 22; el reporte tiene que decir lo mismo");
});

test("el reporte y el corte dan la MISMA cifra de efectivo", () => {
  const DB = prepararDB();
  DB.crm.clientes.find((c) => c.id === 1).monedero = 10;
  crearVenta(DB, { sucursal_id: 1, cliente_id: 1, metodo_pago: "EFECTIVO",
    monedero_aplicado: 10, lineas: [{ producto_id: 3, cantidad: 1 }] });
  const r = reporteMovimientosCaja(DB, {}, { verTodas: true, sucursalId: null });
  const delReporte = r.entradas.find((e) => e.forma_pago === "EFECTIVO").total;
  const delCorte = calcularCorteEnCurso(DB, 1).calculado.EFECTIVO;
  assert.equal(delReporte, delCorte, "dos pantallas no pueden contar historias distintas del mismo cajon");
});

test("la red: una venta SIN monedero sigue valiendo su total completo", () => {
  const DB = prepararDB();
  crearVenta(DB, { sucursal_id: 1, cliente_id: 1, metodo_pago: "EFECTIVO",
    lineas: [{ producto_id: 3, cantidad: 1 }] });
  const r = reporteMovimientosCaja(DB, {}, { verTodas: true, sucursalId: null });
  assert.equal(r.entradas.find((e) => e.forma_pago === "EFECTIVO").total, 32);
});

test("una venta pagada ENTERA con monedero no suma nada al cajon", () => {
  const DB = prepararDB();
  DB.crm.clientes.find((c) => c.id === 1).monedero = 500;
  crearVenta(DB, { sucursal_id: 1, cliente_id: 1, metodo_pago: "EFECTIVO",
    monedero_aplicado: 500, lineas: [{ producto_id: 3, cantidad: 1 }] });
  const r = reporteMovimientosCaja(DB, {}, { verTodas: true, sucursalId: null });
  const efectivo = r.entradas.find((e) => e.forma_pago === "EFECTIVO");
  assert.equal(efectivo ? efectivo.total : 0, 0);
});
```

- [x] **Paso 2: Correrlas y verificar que fallan.**

- [x] **Paso 3: Implementar.** En `reporteMovimientosCaja`, donde acumula el total de cada venta, restar el monedero aplicado, con el mismo comentario de intención que lleva `cortes.js`:

```js
// EL MONEDERO NO ES EFECTIVO: solo se cobro el resto. Esta cifra tiene que
// coincidir con la del corte o se le reclama a la cajera dinero que nunca entro.
const entrado = redondear(Number(v.total) - (Number(v.monedero_aplicado) || 0));
```

Las ventas anteriores no tienen el campo y valen su total completo — sin migrar nada.

- [x] **Paso 4: Barrer el resto de los reportes.** `grep -rn "\.total" backend/reportes.js` y revisar **cada** función que sume ventas: si alguna más informa dinero que se supone que entró a la caja, tiene el mismo defecto. Si encuentras otra, añádele su prueba en este mismo archivo y arréglala aquí; si no encuentras ninguna, dilo en el commit.

- [x] **Paso 5: Suite completa y commit.**

```bash
git add backend/reportes.js backend/movimientosCajaMonedero.test.js
git commit -m "fix(reportes): Movimientos de Caja resta el monedero, igual que el corte

El reporte informaba 32 donde el corte esperaba 22: diez pesos de reclamo
contra una cajera que nunca los recibio. Regresion del monedero del 2026-09-07."
```

---

### Task 3: Un apartado no puede pagarse con una forma de pago inventada

**Por qué.** Es la fuga más cara. Comprobado ejecutando el código: un apartado de $640 con anticipo de **$500 declarado como `MERCADOLIBRE`** se acepta; el corte espera **$0** de efectivo (nadie metió un billete); al cancelarlo, el cliente queda con **$500 de monedero**; y desde el 2026-09-07 ese monedero se gasta en el punto de venta. Resultado reproducido: **$640 de mercancía a cambio de $140 de dinero real.**

Hoy `crearApartado` y `registrarAbono` solo prohíben "crédito" (`apartados.js:65`, `:185`). Eso es una lista negra, y las listas negras fallan abriendo. `ventas.js` ya resolvió esto validando contra las condiciones de pago configuradas; aquí se hace igual.

**Files:**
- Modify: `backend/apartados.js` (`crearApartado`, `registrarAbono`)
- Test: `backend/apartadoFormaPago.test.js` (nuevo)

**Interfaces:**
- Consume: `listarCondiciones(DB, sucursal_id)` de `backend/condicionesPago.js`; el helper `esCredito` que ya vive en `apartados.js`.
- Produce: `crearApartado` y `registrarAbono` lanzan `Error` ante una forma de pago que no esté en las condiciones configuradas de esa sucursal.

- [x] **Paso 1: Escribir las pruebas que fallan**

```js
test("un anticipo con una forma de pago inventada se rechaza", () => {
  const DB = prepararDB();
  assert.throws(() => crearApartado(DB, { cliente_id: 1, anticipo_monto: 500,
    anticipo_forma_pago: "MERCADOLIBRE",
    lineas: [{ producto_id: 3, cantidad: 20, precio_unitario: 32 }] }, 1, { nombre: "Ana" }),
    /forma de pago/i);
});

test("EL CIRCUITO COMPLETO: no se puede fabricar monedero sin que entre dinero", () => {
  const DB = prepararDB();
  const antes = Number(DB.crm.clientes.find((c) => c.id === 1).monedero) || 0;
  assert.throws(() => crearApartado(DB, { cliente_id: 1, anticipo_monto: 500,
    anticipo_forma_pago: "MERCADOLIBRE",
    lineas: [{ producto_id: 3, cantidad: 20, precio_unitario: 32 }] }, 1, { nombre: "Ana" }));
  assert.equal(Number(DB.crm.clientes.find((c) => c.id === 1).monedero) || 0, antes,
    "el saldo del cliente no se movio ni un peso");
});

test("un abono con forma de pago inventada tambien se rechaza", () => {
  const DB = prepararDB();
  const a = crearApartado(DB, { cliente_id: 1, anticipo_monto: 100, anticipo_forma_pago: "EFECTIVO",
    lineas: [{ producto_id: 3, cantidad: 20, precio_unitario: 32 }] }, 1, { nombre: "Ana" });
  assert.throws(() => registrarAbono(DB, a.id, { monto: 100, forma_pago: "MERCADOLIBRE" },
    { nombre: "Ana" }), /forma de pago/i);
});

test("el credito sigue rechazado, y tambien con el acento mal codificado", () => {
  const DB = prepararDB();
  for (const forma of ["CREDITO", "CRÉDITO", "cr�dito"]) {
    assert.throws(() => crearApartado(DB, { cliente_id: 1, anticipo_monto: 100,
      anticipo_forma_pago: forma,
      lineas: [{ producto_id: 3, cantidad: 20, precio_unitario: 32 }] }, 1, { nombre: "Ana" }),
      undefined, `paso con la forma: ${forma}`);
  }
});

test("la red: EFECTIVO y TRANSFERENCIA siguen funcionando", () => {
  for (const forma of ["EFECTIVO", "TRANSFERENCIA"]) {
    const DB = prepararDB();
    const a = crearApartado(DB, { cliente_id: 1, anticipo_monto: 100, anticipo_forma_pago: forma,
      lineas: [{ producto_id: 3, cantidad: 20, precio_unitario: 32 }] }, 1, { nombre: "Ana" });
    assert.equal(a.estatus, "apartado");
  }
});
```

- [x] **Paso 2: Correrlas y verificar que fallan.**

- [x] **Paso 3: Implementar.** Copiar el patrón de `crearVenta` (`backend/ventas.js`, donde arma `permitidas`): normalizar la forma declarada, construir la lista de las condiciones configuradas de esa sucursal quitando el crédito, y **rechazar todo lo que no esté en esa lista**. No compares contra "lo prohibido".

```js
const condiciones = listarCondiciones(DB, sucursalId);
const permitidas = condiciones.map((c) => sinAcentos(c.nombre)).filter((n) => n !== "CREDITO");
if (!permitidas.includes(declarada)) {
  throw new Error(`Forma de pago no valida para un apartado: elige una de ${permitidas.join(", ")}`);
}
```

`registrarAbono` no recibe `sucursalId`: sácalo de la venta que ya busca (`venta.sucursal_id`), **no** del cuerpo de la petición.

- [x] **Paso 4: Suite completa y commit.**

```bash
git add backend/apartados.js backend/apartadoFormaPago.test.js
git commit -m "fix(apartados): la forma de pago se valida contra lista blanca

Un anticipo declarado como MERCADOLIBRE no metia un peso al cajon y al
cancelar se convertia en monedero gastable: 640 de mercancia por 140 reales."
```

---

### Task 4: El servidor decide el precio de un apartado

**Por qué.** Comprobado: un artículo de catálogo de $32 se guardó en un apartado a **$1**. Los precios salen del cuerpo de la petición (`apartados.js:99`) sin recálculo y **sin exigir el permiso de descuento** que sí piden las ventas normales. Es la misma fuga que se cerró en `ventas.js` el 2026-09-04 y que en apartados quedó abierta.

**Files:**
- Modify: `backend/apartados.js` (`crearApartado`), `backend/server.js` (la ruta `POST /api/apartados`, línea ~1689, para pasar permisos y usuario)
- Test: `backend/apartadoPrecioServidor.test.js` (nuevo)

**Interfaces:**
- Consume: el catálogo `DB["catalogo-productos"].productos`; el patrón de `lineasCalculadas` de `backend/ventas.js`.
- Produce: `crearApartado(DB, datos, sucursalId, usuario, cajaId, opciones = {})` — el sexto argumento lleva `{ permisos }`, igual que `crearVenta`. **Las llamadas existentes sin ese argumento siguen funcionando** y se comportan como si no hubiera permiso de descuento.

- [x] **Paso 1: Escribir las pruebas que fallan**

```js
test("el precio sale del catalogo, no del cuerpo de la peticion", () => {
  const DB = prepararDB();
  const catalogo = DB["catalogo-productos"].productos.find((p) => p.id === 3).precio_venta;
  const a = crearApartado(DB, { cliente_id: 1, anticipo_monto: 1, anticipo_forma_pago: "EFECTIVO",
    lineas: [{ producto_id: 3, cantidad: 1, precio_unitario: 1 }] }, 1, { nombre: "Ana" });
  assert.equal(a.total, catalogo, "el $1 que mando el navegador se ignora");
});

test("sin permiso de descuento, el descuento que llega se ignora", () => {
  const DB = prepararDB();
  const catalogo = DB["catalogo-productos"].productos.find((p) => p.id === 3).precio_venta;
  const a = crearApartado(DB, { cliente_id: 1, anticipo_monto: 1, anticipo_forma_pago: "EFECTIVO",
    lineas: [{ producto_id: 3, cantidad: 1, precio_unitario: catalogo, descuento_pct: 90 }] },
    1, { nombre: "Ana" }, null, { permisos: [] });
  assert.equal(a.total, catalogo);
});

test("CON permiso de descuento si se aplica: no se le quita la herramienta a quien la tiene", () => {
  const DB = prepararDB();
  const catalogo = DB["catalogo-productos"].productos.find((p) => p.id === 3).precio_venta;
  const a = crearApartado(DB, { cliente_id: 1, anticipo_monto: 1, anticipo_forma_pago: "EFECTIVO",
    lineas: [{ producto_id: 3, cantidad: 1, precio_unitario: catalogo, descuento_pct: 50 }] },
    1, { nombre: "Ana" }, null, { permisos: ["aplicar_descuentos_articulos_venta"] });
  assert.equal(a.total, catalogo / 2);
});

test("una cantidad negativa en un apartado tambien se rechaza", () => {
  const DB = prepararDB();
  assert.throws(() => crearApartado(DB, { cliente_id: 1, anticipo_monto: 1,
    anticipo_forma_pago: "EFECTIVO", lineas: [{ producto_id: 3, cantidad: -5 }] },
    1, { nombre: "Ana" }), /cantidad/i);
});

test("el anticipo sigue sin poder superar el total recalculado", () => {
  const DB = prepararDB();
  assert.throws(() => crearApartado(DB, { cliente_id: 1, anticipo_monto: 9999,
    anticipo_forma_pago: "EFECTIVO", lineas: [{ producto_id: 3, cantidad: 1, precio_unitario: 9999 }] },
    1, { nombre: "Ana" }), /anticipo/i);
});
```

- [x] **Paso 2: Correrlas y verificar que fallan.**

- [x] **Paso 3: Implementar.** Copiar el bloque `lineasCalculadas` de `crearVenta`: por cada línea con `producto_id`, tomar `precio_venta` del catálogo; aplicar `descuento_pct` **solo** si `opciones.permisos` incluye `aplicar_descuentos_articulos_venta`; rechazar productos con `precio_venta <= 0` por nombre. Recalcular el total **antes** de la comprobación del anticipo, que hoy vive en `apartados.js:103` — si no, el anticipo se valida contra un total falso.

En `backend/server.js`, la ruta pasa los permisos como ya lo hace la de ventas:

```js
res.json(crearApartado(DB, req.body, sucursal_id, usuario, req.query.caja_id,
  { permisos: resolverPermisosDeRol(req.usuarioToken.rol_id) }));
```

- [x] **Paso 4: Suite completa y commit.**

```bash
git add backend/apartados.js backend/server.js backend/apartadoPrecioServidor.test.js
git commit -m "fix(apartados): el servidor recalcula el precio desde el catalogo

Un articulo de 32 se apartaba en 1. Mismo blindaje que ventas recibio el 04."
```

---

### Task 5: Un apartado exige un cliente que exista

**Por qué.** Comprobado: se creó un apartado a nombre del cliente `999999`, que no existe. `crearApartado` solo comprueba que el id convertido a número no sea cero (`apartados.js:57`). Al cancelarlo, el monedero **no se le acredita a nadie** (`:258` no encuentra al cliente): el anticipo que esa persona pagó de verdad se evapora sin dejar saldo a favor. Le pega a un cliente honesto, no al defraudador.

**Files:**
- Modify: `backend/apartados.js` (`crearApartado`)
- Test: `backend/apartadoClienteReal.test.js` (nuevo)

**Interfaces:**
- Consume: `DB.crm.clientes`.
- Produce: `crearApartado` lanza `Error` si el cliente no existe.

- [ ] **Paso 1: Escribir las pruebas que fallan**

```js
test("un apartado a nombre de un cliente inexistente se rechaza", () => {
  const DB = prepararDB();
  assert.throws(() => crearApartado(DB, { cliente_id: 999999, anticipo_monto: 100,
    anticipo_forma_pago: "EFECTIVO", lineas: [{ producto_id: 3, cantidad: 20 }] },
    1, { nombre: "Ana" }), /cliente/i);
});

test("un id de TEXTO de un cliente que si existe se acepta: el cuerpo HTTP manda texto", () => {
  const DB = prepararDB();
  const a = crearApartado(DB, { cliente_id: "1", anticipo_monto: 100,
    anticipo_forma_pago: "EFECTIVO", lineas: [{ producto_id: 3, cantidad: 20 }] },
    1, { nombre: "Ana" });
  assert.equal(Number(a.cliente_id), 1);
});

test("Publico en General sigue sin poder apartar", () => {
  const DB = prepararDB();
  assert.throws(() => crearApartado(DB, { cliente_id: 0, anticipo_monto: 100,
    anticipo_forma_pago: "EFECTIVO", lineas: [{ producto_id: 3, cantidad: 20 }] },
    1, { nombre: "Ana" }), /cliente/i);
});

test("cancelar un apartado real SI acredita el monedero a su dueno", () => {
  const DB = prepararDB();
  const a = crearApartado(DB, { cliente_id: 1, anticipo_monto: 100, anticipo_forma_pago: "EFECTIVO",
    lineas: [{ producto_id: 3, cantidad: 20 }] }, 1, { nombre: "Ana" });
  cancelarApartado(DB, a.id, "prueba", { nombre: "Ana" });
  assert.equal(DB.crm.clientes.find((c) => c.id === 1).monedero, 100);
});
```

- [ ] **Paso 2: Correrlas y verificar que fallan.**

- [ ] **Paso 3: Implementar.** Junto a la comprobación que ya existe, buscar al cliente y rechazar si no aparece. Normaliza con `Number(...)` antes de comparar — el id llega como texto desde HTTP.

```js
const cliente = DB.crm.clientes.find((c) => Number(c.id) === cliente_id);
if (!cliente) throw new Error("El cliente del apartado no existe");
```

- [ ] **Paso 4: Suite completa y commit.**

---

### Task 6: Corregir el origen de un gasto respeta la sucursal, y valida antes de tocar nada

**Por qué.** Tres defectos en la misma puerta, todos comprobados:

1. **Sin alcance.** `corregirOrigenGasto(DB, id, cambios, usuario)` **no recibe alcance** y busca el gasto solo por id; la ruta (`server.js:1921`) pide el permiso pero nunca calcula el alcance. Un usuario de Ocosingo cambió el origen de un gasto de Yajalón. Si un gasto que sí salió del cajón se reclasifica como caja fuerte, el corte deja de descontarlo y **le exige a esa cajera efectivo que ya se pagó**.
2. **Muta antes de validar.** Asigna `gasto.origen` y después valida `caja_id`. Con una caja inexistente lanza error, pero el objeto en memoria **ya quedó cambiado** y sin bitácora.
3. **Protección histórica incompleta.** Solo mira `gasto.corte_id != null`; un gasto anterior al último corte pero sin sellar todavía se puede corregir.

**Files:**
- Modify: `backend/gastos.js` (`corregirOrigenGasto`), `backend/server.js` (ruta `PUT /api/gastos/:id/origen`)
- Test: `backend/gastoOrigenAlcance.test.js` (nuevo)

**Interfaces:**
- Consume: `alcanceSucursal(req, permisos)` y `dentroDeAlcance(sucursalId, alcance)` de `backend/auth.js`; `esDeEstaCaja` de `backend/cajas.js`.
- Produce: `corregirOrigenGasto(DB, id, cambios, usuario, alcance)` — **quinto argumento nuevo, obligatorio**. Sin alcance válido, falla cerrando.

- [ ] **Paso 1: Escribir las pruebas que fallan**

```js
test("no se puede corregir el origen de un gasto de otra sucursal", () => {
  const DB = prepararDB();
  const g = crearGastoDePrueba(DB, { sucursal_id: 2, origen: "CAJA_FUERTE" });
  assert.throws(() => corregirOrigenGasto(DB, g.id, { origen: "CAJON" },
    { id: 9, nombre: "Ana" }, { verTodas: false, sucursalId: 1 }), /no encontrado/i);
  assert.equal(DB.gastos.gastos.find((x) => x.id === g.id).origen, "CAJA_FUERTE",
    "y el gasto no se toco");
});

test("el administrador que ve todas SI puede corregirlo", () => {
  const DB = prepararDB();
  const g = crearGastoDePrueba(DB, { sucursal_id: 2, origen: "CAJA_FUERTE" });
  const r = corregirOrigenGasto(DB, g.id, { origen: "CAJON" }, { id: 1, nombre: "Victor" },
    { verTodas: true, sucursalId: null });
  assert.equal(r.origen, "CAJON");
});

test("sin alcance falla CERRANDO, no abriendo", () => {
  const DB = prepararDB();
  const g = crearGastoDePrueba(DB, { sucursal_id: 2, origen: "CAJA_FUERTE" });
  for (const alcance of [undefined, null, {}, { verTodas: false, sucursalId: null }]) {
    assert.throws(() => corregirOrigenGasto(DB, g.id, { origen: "CAJON" },
      { id: 9, nombre: "Ana" }, alcance));
  }
});

test("si la caja es invalida, el origen NO queda cambiado a medias", () => {
  const DB = prepararDB();
  const g = crearGastoDePrueba(DB, { sucursal_id: 1, origen: "CAJA_FUERTE" });
  assert.throws(() => corregirOrigenGasto(DB, g.id, { origen: "CAJON", caja_id: 99999 },
    { id: 1, nombre: "Victor" }, { verTodas: true, sucursalId: null }));
  assert.equal(DB.gastos.gastos.find((x) => x.id === g.id).origen, "CAJA_FUERTE",
    "el objeto vivo no puede quedar mutado tras un error");
});

test("un gasto anterior al ultimo corte no se corrige aunque no tenga sello", () => {
  const DB = prepararDB();
  const g = crearGastoDePrueba(DB, { sucursal_id: 1, origen: "CAJA_FUERTE" });
  g.corte_id = null;
  g.fecha_hora = "2026-01-01T10:00:00.000Z";
  DB.pos.cortes_caja.push({ id: 1, sucursal_id: 1, caja_id: 1,
    fecha_hora: "2026-02-01T10:00:00.000Z" });
  assert.throws(() => corregirOrigenGasto(DB, g.id, { origen: "CAJON" },
    { id: 1, nombre: "Victor" }, { verTodas: true, sucursalId: null }), /corte/i);
});

test("toda correccion deja bitacora con quien la hizo", () => {
  const DB = prepararDB();
  const g = crearGastoDePrueba(DB, { sucursal_id: 1, origen: "CAJA_FUERTE" });
  corregirOrigenGasto(DB, g.id, { origen: "CAJON" }, { id: 1, nombre: "Victor" },
    { verTodas: true, sucursalId: null });
  const movs = DB.gastos.gasto_movimientos.filter((m) => m.gasto_id === g.id);
  assert.ok(movs.some((m) => String(m.usuario).includes("Victor")),
    "una operacion de dinero sin nombre encima no se puede explicar despues");
});
```

Nota sobre `crearGastoDePrueba`: **no existe en `testHelpers.js`** — escríbelo como función local en tu archivo de prueba, o usa `crearGasto` real (es `async`, firma `crearGasto(DB, datos, sucursalId, usuario, drive, cajaId)`).

- [ ] **Paso 2: Correrlas y verificar que fallan.**

- [ ] **Paso 3: Implementar.**
  - Añadir el quinto parámetro `alcance` y buscar con guarda: si el gasto no existe **o** no está dentro del alcance, el mensaje es el mismo ("Gasto no encontrado") — no confirmes la existencia de registros de otra tienda.
  - **Validar todo antes de mutar nada:** calcular el nuevo origen y la nueva caja, comprobarlos, y solo entonces asignar.
  - Extender la protección histórica: además de `corte_id != null`, rechazar si existe un corte cerrado de esa sucursal y caja **posterior** a la fecha del gasto. Reutiliza `esDeEstaCaja` para decidir de qué caja es; no escribas una comparación suelta de `caja_id`.
  - En la ruta, calcular el alcance de **quien pregunta** (su permiso `ver_todas_las_sucursales` y la `sucursal_id` de su token), nunca de `?sucursal_id=`:

```js
const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
res.json(corregirOrigenGasto(DB, req.params.id, req.body, req.usuarioToken, alcance));
```

- [ ] **Paso 4: Suite completa y commit.**

---

### Task 7: La pantalla de Gastos permite corregir el origen y filtrar por él

**Por qué.** La corrección existe en el servidor y **no hay forma de usarla desde la pantalla**: `src/Gastos.jsx` no llama a `/origen`. Un gasto con el origen equivocado es un faltante permanente a nombre de quien cerró esa caja, y hoy no hay manera de arreglarlo sin tocar la base. También falta el filtro Todos/Cajón/Caja fuerte que pedía la Tarea 4 del plan del 2026-09-04.

**Files:**
- Modify: `src/Gastos.jsx`
- Test: `backend/gastoOrigenPantalla.test.js` (nuevo) — sigue el patrón de `backend/depositoSinFichaPantalla.test.js`, que ejecuta el componente real con esbuild + `vm`.

**Interfaces:**
- Consume: `PUT /api/gastos/:id/origen`, ya existente y ya blindada en la Tarea 6.
- Produce: nada hacia el backend.

- [ ] **Paso 1: Escribir las pruebas que fallan** — que exista el filtro por origen con sus tres opciones; que un gasto activo y sin sellar ofrezca la acción de corregir; que un gasto ya sellado en un corte **no** la ofrezca.
- [ ] **Paso 2: Correrlas y verificar que fallan.**
- [ ] **Paso 3: Implementar** el filtro y un modal de corrección que pida el origen y, cuando toque, la caja. El mensaje de error del servidor se muestra tal cual: ya explica por qué se rechazó.
- [ ] **Paso 4: `npx eslint src backend`** — 0 errores, y los warnings no suben de 456. Commit.

---

### Task 8: El Estado de Cuenta solo cobra la mercancía que vino del CEDIS

**Por qué.** Comprobado: un traspaso recibido de Ocosingo a Yajalón por $200 le generó a Yajalón una deuda de **$200 con la cuenta común**, sin que el CEDIS participara. Si esa mercancía ya se le cargó a Ocosingo cuando llegó del CEDIS, **las dos tiendas quedan cargadas por el mismo recorrido**. El plan del 2026-08-05 dice "recibida del CEDIS" en su texto; el filtro nunca comprobó el origen.

No mueve dinero del banco, pero corrompe el saldo con el que se le reclama a una tienda lo que debe.

**Files:**
- Modify: `backend/estadoCuenta.js`
- Test: `backend/estadoCuentaOrigenCedis.test.js` (nuevo)

**Interfaces:**
- Consume: `DB.inventario.traspasos`, campo `sucursal_origen_id`. El CEDIS es la sucursal **6**; no escribas el 6 a pelo: sácalo del catálogo de sucursales o de una constante nombrada.
- Produce: `estadoCuenta(DB, filtros, alcance)`, misma firma y misma forma de salida.

- [ ] **Paso 1: Escribir las pruebas que fallan**

```js
test("un traspaso entre tiendas NO genera deuda con la cuenta comun", () => {
  const DB = prepararDB();
  recibirTraspasoDePrueba(DB, { origen: 1, destino: 2, cantidad: 2, costo: 100 });
  const ec = estadoCuenta(DB, {}, { verTodas: true, sucursalId: null });
  const yajalon = ec.resumen.find((r) => r.sucursal_id === 2);
  assert.equal(yajalon ? yajalon.recibido : 0, 0, "esa mercancia no vino del CEDIS");
});

test("un traspaso DESDE el CEDIS si genera deuda", () => {
  const DB = prepararDB();
  recibirTraspasoDePrueba(DB, { origen: 6, destino: 2, cantidad: 2, costo: 100 });
  const ec = estadoCuenta(DB, {}, { verTodas: true, sucursalId: null });
  assert.equal(ec.resumen.find((r) => r.sucursal_id === 2).recibido, 200);
});

test("la misma mercancia no se cobra dos veces por reenviarse", () => {
  const DB = prepararDB();
  recibirTraspasoDePrueba(DB, { origen: 6, destino: 1, cantidad: 2, costo: 100 });
  recibirTraspasoDePrueba(DB, { origen: 1, destino: 2, cantidad: 2, costo: 100 });
  const ec = estadoCuenta(DB, {}, { verTodas: true, sucursalId: null });
  assert.equal(ec.totales.recibido, 200, "un solo recorrido desde el CEDIS, un solo cargo");
});
```

- [ ] **Paso 2: Correrlas y verificar que fallan.**
- [ ] **Paso 3: Implementar** el filtro por origen CEDIS en la selección de `recibidos`, con un comentario que diga por qué: la deuda con la cuenta común nace de lo que compró el CEDIS, no de mover mercancía entre tiendas.
- [ ] **Paso 4: Suite completa y commit.**

---

### Task 9: Un gasto de garantía no se borra mientras se cierra el corte

**Por qué.** Comprobado por la auditoría: el corte conserva $300 de gasto de garantía y su registro desaparece. Queda un corte que descontó dinero cuyo respaldo ya no existe — y nadie puede explicar después de dónde salió esa diferencia.

**Files:**
- Modify: `backend/garantiasGastos.js` (`eliminarGasto`)
- Test: `backend/garantiaGastoCorte.test.js` (nuevo)

**Interfaces:**
- Consume: `eliminarGasto(DB, garantiaId, gastoId, usuario, alcance, drive)`, misma firma; el sello `corte_id` que ya usan los gastos y las ventas.
- Produce: `eliminarGasto` rechaza borrar un gasto que ya entró en un corte cerrado.

- [ ] **Paso 1: Escribir la prueba que falla** — un gasto de garantía con `corte_id` asignado no se puede eliminar, y el mensaje dice por qué. Añadir una segunda que compruebe que un gasto **sin** sellar sí se sigue pudiendo borrar: no le quites la herramienta a quien capturó mal.
- [ ] **Paso 2: Correrlas y verificar que fallan.**
- [ ] **Paso 3: Implementar** la guarda, con la misma regla que ya usan `cancelarVenta` y `corregirOrigenGasto`: "ya lo contó un corte" es la misma frontera en todo el sistema.
- [ ] **Paso 4: Suite completa y commit.**

---

## Fuera de alcance de este plan

De la auditoría del 2026-09-08 quedan pendientes que **no son fugas de dinero** y no entran aquí:

- Los remates de Respaldos (`2026-08-15-fixes-auditoria-respaldos.md`), incluido el mensaje que confunde un respaldo previo con una restauración exitosa. Es riesgo de recuperación, no de caja: merece su propio plan.
- Las tareas 4–6 del Gerente de Ventas IA, dejadas expresamente como fase posterior.
- Los arreglos de estilo pendientes (`2026-08-25`).
- El Tablero de Dinero, que tiene su propio plan (`2026-09-07-tablero-dinero.md`).

## Verificación final

- `cd backend && node --test > salida.txt 2>&1` — sin regresiones, con la salida guardada en archivo. Línea base al empezar: **1447/1447**.
- `npx eslint src backend` — 0 errores; los warnings no suben de 456.
- `git diff --check` limpio y sin archivos inesperados.
- **Revisión independiente**, y no por quien implementó. Si lo implementó Codex, la revisión no puede ir a Codex.
- **Prueba en navegador** de las dos pantallas que cambian: un apartado completo (crear, abonar, cancelar) y la corrección de origen de un gasto.
- **La prueba que resume todo este plan:** intentar el circuito de la Tarea 3 de punta a punta —apartado con pago inventado, cancelarlo, gastar el monedero— y comprobar que **se detiene en el primer paso**.
