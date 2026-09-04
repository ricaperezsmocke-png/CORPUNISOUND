# Arreglos de la revisión de Cajas — Plan de implementación

> **Para agentes ejecutores:** SUB-SKILL REQUERIDA: usar `superpowers:subagent-driven-development` (recomendado) o `superpowers:executing-plans` para implementar tarea por tarea. Los pasos usan casillas (`- [ ]`) para seguimiento.

**Goal:** Cerrar los diez hallazgos de la revisión independiente de `feature/cajas-pos` y hacer que la cajera declare de qué caja salió el dinero de un gasto, en vez de heredarla en silencio del encabezado.

**Architecture:** Todos los arreglos son de perímetro; el núcleo de cajas (`esDeEstaCaja`, la época sellada, el sellado por `corte_id`) se queda como está — la revisión lo encontró correcto y en un punto mejor que el plan original. Se trabaja sobre la misma rama `feature/cajas-pos`, que aún no está en master, para que los arreglos viajen con el defecto que corrigen.

**Tech Stack:** Node.js + Express (datos en memoria sobre objeto `DB`, persistidos en SQLite), React 18 + Vite + Tailwind. Pruebas con el runner integrado de Node (`node --test`). **Sin dependencias nuevas.**

**Spec:** `docs/superpowers/specs/2026-09-01-cajas-punto-de-venta-design.md` (el diseño original de las cajas). Los requisitos de ESTE plan salen de la revisión independiente de la rama, y están escritos íntegros en cada tarea: el ejecutor no necesita leer los informes.

**Rama:** `feature/cajas-pos` · **Base:** `ca8b512` · **Worktree:** `C:/Users/Victor/Desktop/CORPUNISOUND/.claude/worktrees/cajas-pos`

## Global Constraints

- **Sin dependencias nuevas.** Pruebas con `node --test`, nada de jest/supertest/mocha.
- **Línea base a no romper:** `cd backend && node --test` da 1239/1239, y `npx eslint src backend` da 0 errores (455 warnings preexistentes en `src/reportes/*`). Cualquier tarea que baje ese número no está terminada.
- **Nunca `git add .`** — el repo tiene ~527 archivos sin seguimiento. Staging por rutas explícitas.
- **Nada de push, merge ni rebase.** Eso lo hace Victor. Commits en la rama, sí.
- **Un implementador a la vez** sobre estos archivos. Los revisores pueden ir en paralelo.
- **Las fechas solas** (`fecha`) usan `fechaLocal()` de `backend/fechas.js` (zona `America/Mexico_City`). Las marcas completas (`fecha_hora`) son ISO en UTC. No mezclar.
- **Todo módulo nuevo** se registra en `backend/permisosCatalogo.js`; hay un guard de arranque que tumba el backend si falta. Este plan no crea módulos nuevos.
- **Sin acentos en los mensajes de commit** (convención de la rama, por el mojibake de Windows). En el código y en la interfaz, los acentos SÍ van.

## Decisiones ya tomadas por Victor — no volver a abrirlas

1. **El gasto pregunta de qué CAJA salió el dinero, y por ahora solo ofrece las dos cajas** (Administrativa / Fiscal). La opción "de la caja fuerte / tómbola" queda para la Fase 4 del Tablero de Dinero, no entra aquí.
2. **El arranque sigue siendo estricto:** si el catálogo de cajas está torcido, el backend NO enciende. Se blinda en cambio la vía por la que se ensuciaba — restaurar un respaldo — para que la puerta de emergencia nunca se cierre (Tarea 1).
3. El sistema está **en fase de pruebas**, no en producción con datos reales. Restaurar respaldos va a pasar seguido; por eso la Tarea 1 va primera.

---

## Estructura de archivos

| Archivo | Responsabilidad | Tareas |
|---|---|---|
| `backend/cajas.js` | La regla de pertenencia y el catálogo. Se le suma `repararCajas` y se endurece `esDeEstaCaja`. | 1, 8 |
| `backend/reconciliarRestauracion.js` | Lo que se rehace tras restaurar. Pasa de rechazar a reparar. | 1 |
| `backend/apartados.js` | Una línea: la venta del apartado guarda su caja. | 2 |
| `backend/ventas.js` | `cambiarCajaVenta` rechaza lo que no es un ticket cerrado. | 3 |
| `backend/gastos.js` | `crearGasto` recibe la caja declarada; la lista la expone. | 4 |
| `backend/server.js` | La ruta de gastos deja de leer la caja del query. | 4 |
| `backend/cortes.js` | El aviso de cancelación deja de estar ciego para lo histórico. | 6 |
| `backend/reportes.js` | El Reporte de Cortes distingue las dos cajas. | 10 |
| `src/Gastos.jsx` | Selector de caja en el formulario y columna en la lista. | 5 |
| `src/ConsultasVentas.jsx` | El botón "Cambiar caja" solo sobre tickets cerrados. | 3 |
| `src/CorteCaja.jsx` | Pintar el aviso de dinero cancelado. | 7 |

**Orden:** la Tarea 1 va primera porque protege todas las demás pruebas manuales (restaurar respaldos es lo que más se va a hacer en fase de pruebas). Las Tareas 2, 3 y 4-5 son las que evitan un descuadre a nombre de una cajera. Las demás pueden ir después sin bloquear el merge.

---

### Task 1: Restaurar un respaldo repara el catálogo de cajas en vez de rechazarlo

**Por qué.** Hoy `validarAntesDeRestaurar` ensaya la reconciliación sobre una copia y, si el catálogo de cajas viene torcido, lanza — el respaldo se rechaza entero (`respaldos.test.js:717`). Combinado con que el arranque también muere ante lo mismo, un solo campo booleano mal puesto deja la tienda sin sistema **y sin la vía de escape**. Victor decidió mantener el arranque estricto y blindar el restore: es la vía realista por la que el catálogo se ensucia.

El catálogo de cajas **no es dato del negocio**: es derivable de la lista de sucursales (dos cajas por tienda, `Administrativa` predeterminada). Lo único que no se puede tocar son los `id`, porque las ventas, los abonos, los gastos y los cortes los referencian.

**Files:**
- Modify: `backend/cajas.js` (agregar `repararCajas`, exportarla)
- Modify: `backend/reconciliarRestauracion.js:27-51` (usar `repararCajas`), `:57-60` (`validarAntesDeRestaurar` deja de lanzar por cajas)
- Test: `backend/reconciliarRestauracion.test.js` (agregar casos)

**Interfaces:**
- Produces: `repararCajas(DB) -> { reparaciones: string[] }` — completa las cajas que falten, deja exactamente una predeterminada por sucursal (la `Administrativa`), y devuelve la lista legible de lo que reparó. No lanza nunca.
- Consumes: `sembrarCajas(DB)`, `cajasDeSucursal(DB, sucursalId)`, `estadoDeCajas(DB, sucursalId)` de `backend/cajas.js`.

- [ ] **Step 1: Escribir la prueba que falla**

En `backend/reconciliarRestauracion.test.js`:

```js
test("una foto con dos predeterminadas se repara al restaurar, no se rechaza", () => {
  const DB = construirDBPrueba();
  DB.pos.cajas = sembrarCajas(DB);
  // La foto viene torcida: las dos cajas de Ocosingo marcadas como la de por defecto.
  for (const caja of DB.pos.cajas.filter((c) => c.sucursal_id === 1)) caja.predeterminada = true;

  // No debe lanzar: restaurar es la puerta de emergencia y no se puede cerrar.
  assert.doesNotThrow(() => validarAntesDeRestaurar(DB));

  const { reparaciones } = reconciliarTrasRestaurar(DB);
  const deOcosingo = DB.pos.cajas.filter((c) => c.sucursal_id === 1);
  assert.strictEqual(deOcosingo.filter((c) => c.predeterminada).length, 1);
  assert.strictEqual(deOcosingo.find((c) => c.predeterminada).nombre, "Administrativa");
  assert.ok(reparaciones.some((r) => r.includes("Ocosingo")), `reparaciones: ${reparaciones}`);
});

test("una foto sin ninguna predeterminada tambien se repara", () => {
  const DB = construirDBPrueba();
  DB.pos.cajas = sembrarCajas(DB);
  for (const caja of DB.pos.cajas.filter((c) => c.sucursal_id === 1)) caja.predeterminada = false;

  reconciliarTrasRestaurar(DB);
  const deOcosingo = DB.pos.cajas.filter((c) => c.sucursal_id === 1);
  assert.strictEqual(deOcosingo.filter((c) => c.predeterminada).length, 1);
  assert.strictEqual(deOcosingo.find((c) => c.predeterminada).nombre, "Administrativa");
});

/**
 * Los ids de caja NO se pueden renumerar: las ventas, los abonos, los gastos y
 * los cortes los referencian. Reparar la marca de "predeterminada" es seguro;
 * reasignar ids convertiria el dinero de una caja en dinero de otra.
 */
test("reparar no cambia los ids de las cajas existentes", () => {
  const DB = construirDBPrueba();
  DB.pos.cajas = sembrarCajas(DB);
  const idsAntes = DB.pos.cajas.map((c) => c.id).sort((a, b) => a - b);
  for (const caja of DB.pos.cajas.filter((c) => c.sucursal_id === 1)) caja.predeterminada = true;

  reconciliarTrasRestaurar(DB);

  assert.deepStrictEqual(DB.pos.cajas.map((c) => c.id).sort((a, b) => a - b), idsAntes);
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd backend && node --test reconciliarRestauracion.test.js`
Expected: FAIL — hoy `validarAntesDeRestaurar` lanza `La sucursal Ocosingo debe tener exactamente una caja predeterminada; tiene 2`, y `reconciliarTrasRestaurar` no devuelve `reparaciones`.

- [ ] **Step 3: Implementar `repararCajas` en `backend/cajas.js`**

Junto a `sembrarCajas`, sin cambiar lo que el arranque espera de ella:

```js
/**
 * Deja el catalogo de cajas en un estado valido SIN lanzar, y cuenta lo que
 * arreglo. Es la version para restaurar; `sembrarCajas` es la del arranque, que
 * grita a proposito (decision de Victor, 2026-09-04).
 *
 * La diferencia importa: el arranque puede permitirse morir porque hay una
 * salida —restaurar—, pero restaurar NO puede morir, porque es la salida. Un
 * catalogo torcido no es dato del negocio: las cajas son derivables de la lista
 * de sucursales. Lo unico intocable son los `id`, que las ventas, los abonos,
 * los gastos y los cortes referencian; reasignarlos convertiria el dinero de una
 * caja en dinero de otra.
 */
function repararCajas(DB) {
  const reparaciones = [];
  sembrarCajasSinValidar(DB);

  for (const sucursal of DB.pos?.sucursales || []) {
    const cajas = cajasDeSucursal(DB, sucursal.id);
    const predeterminadas = cajas.filter((c) => c.predeterminada === true);
    if (predeterminadas.length === 1) continue;

    const administrativa = cajas.find((c) => c.nombre === "Administrativa");
    if (!administrativa) continue; // sembrarCajasSinValidar ya la habria creado
    for (const caja of cajas) caja.predeterminada = caja.id === administrativa.id;
    reparaciones.push(
      `${sucursal.nombre}: tenia ${predeterminadas.length} cajas predeterminadas; se dejo "Administrativa".`
    );
  }

  return { reparaciones };
}
```

Y separar de `sembrarCajas` la parte que completa, para que las dos la compartan:

```js
/** Completa las dos cajas que falten. No valida nada: eso lo decide quien llama. */
function sembrarCajasSinValidar(DB) { /* el cuerpo actual de sembrarCajas SIN la validacion final */ }

/** Completa las dos cajas que falten y valida la predeterminada (arranque). */
function sembrarCajas(DB) {
  sembrarCajasSinValidar(DB);
  for (const sucursal of DB.pos?.sucursales || []) validarPredeterminadaDeSucursal(DB, sucursal.id);
  return DB.pos.cajas;
}
```

Exportar `repararCajas` en `module.exports`.

- [ ] **Step 4: Usar `repararCajas` en la restauración**

En `backend/reconciliarRestauracion.js`, cambiar el `require` y el bloque de cajas:

```js
const { repararCajas } = require("./cajas");
// ...
  if (!Array.isArray(db.pos.cajas)) db.pos.cajas = [];
  const { reparaciones } = repararCajas(db);
```

y devolver las `reparaciones` junto al `db`. **Elige una sola forma de devolverlas y úsala igual en los dos llamadores** (`respaldos.js` y `server.js`). Actualizar el comentario de cabecera del archivo para decir que restaurar repara y el arranque grita, y por qué.

- [ ] **Step 5: Correr las pruebas**

Run: `cd backend && node --test reconciliarRestauracion.test.js respaldos.test.js cajas.test.js`
Expected: PASS. **`respaldos.test.js:717` va a fallar**: hoy afirma que una foto con dos predeterminadas se rechaza. Esa prueba consagra el comportamiento que Victor decidió cambiar — actualízala para que afirme lo contrario (que se restaura y se repara) y deja escrito en su comentario que el cambio fue deliberado, con fecha.

- [ ] **Step 6: Que las reparaciones se vean**

El resultado de la restauración ya viaja a la pantalla. Sumar las `reparaciones` a ese resultado y mostrarlas. Una reparación invisible es la mitad del defecto que estamos cerrando.

- [ ] **Step 7: Suite completa y commit**

```bash
cd backend && node --test
cd .. && npx eslint src backend
git add backend/cajas.js backend/reconciliarRestauracion.js backend/reconciliarRestauracion.test.js backend/respaldos.test.js backend/respaldos.js
git commit -m "fix(respaldos): restaurar repara el catalogo de cajas en vez de rechazar la foto"
```

---

### Task 2: El apartado guarda la caja donde se cobró

**Por qué.** El abono de un apartado guarda su `caja_id` (`apartados.js:146`), pero el documento de venta que lo representa se crea sin ese campo (`apartados.js:99-115`). Verificado. Consecuencia: el corte de la Fiscal **cobra** el anticipo, pero Consultas de Ventas filtrada por Fiscal **no lo lista**, y filtrada por Administrativa lista un apartado cuyo dinero nunca entró en su corte — porque `esDeEstaCaja` trata el `caja_id` ausente como histórico y se lo da a la predeterminada. Quien investigue un descuadre de apartados saca la conclusión contraria a la verdad.

No cambia ningún cálculo: `ventasDelTurno` excluye los apartados por `tipo_documento`.

**Files:**
- Modify: `backend/apartados.js:99-115`
- Test: `backend/apartadosCorteCaja.test.js`

- [ ] **Step 1: Escribir la prueba que falla**

```js
test("el apartado se lista en la misma caja donde se cobro su anticipo", () => {
  const DB = construirDBPrueba();
  DB.pos.cajas = sembrarCajas(DB);
  const fiscal = DB.pos.cajas.find((c) => c.sucursal_id === 1 && !c.predeterminada);
  const administrativa = DB.pos.cajas.find((c) => c.sucursal_id === 1 && c.predeterminada);

  crearApartado(DB, datosApartadoDePrueba({ anticipo_monto: 200, anticipo_forma_pago: "EFECTIVO" }), 1, usuarioDePrueba(), fiscal.id);

  // La consulta tiene que contar la misma historia que el corte.
  assert.strictEqual(listarVentas(DB, { sucursal_id: 1, caja_id: fiscal.id }).length, 1);
  assert.strictEqual(listarVentas(DB, { sucursal_id: 1, caja_id: administrativa.id }).length, 0);
});
```

Ajusta `datosApartadoDePrueba` / `usuarioDePrueba` a los helpers que ya use `apartadosCorteCaja.test.js`; no inventes helpers nuevos si ya existen.

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd backend && node --test apartadosCorteCaja.test.js`
Expected: FAIL — el apartado sale bajo Administrativa (1) y no bajo Fiscal (0).

- [ ] **Step 3: Implementar**

En el objeto `venta` de `crearApartado`, junto a `sucursal_id`:

```js
    sucursal_id,
    caja_id: caja?.id ?? null,
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `cd backend && node --test apartadosCorteCaja.test.js listarVentasCaja.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/apartados.js backend/apartadosCorteCaja.test.js
git commit -m "fix(apartados): la venta del apartado guarda la caja donde se cobro"
```

---

### Task 3: "Cambiar caja" solo sobre tickets cerrados

**Por qué.** `cambiarCajaVenta` (`ventas.js:232`) no mira `tipo_documento` ni `estatus`, y solo escribe `venta.caja_id`. El dinero de un apartado vive en `DB.pos.apartado_abonos`, cada abono con su propia caja: mover el documento **no mueve el dinero**. Peor, `ventaQuedaDespuesDelUltimoCorte` (`ventas.js:212-225`) construye una vista forzando `tipo_documento: "Ticket"` y `estatus: "cerrada"`, o sea evalúa el apartado bajo una premisa falsa para decidir si autoriza el cambio. La encargada corrige un anticipo mal cobrado, el sistema le dice "movida a Fiscal", y no movió nada.

El spec dice explícitamente que no se toca la lógica de apartados. Por lo tanto: se **rechaza**, no se extiende.

**Files:**
- Modify: `backend/ventas.js` (dentro de `cambiarCajaVenta`, antes de resolver las cajas)
- Modify: `src/ConsultasVentas.jsx` (la barra, donde hoy se muestra el botón "Cambiar caja")
- Test: `backend/cambiarCajaVenta.test.js`

- [ ] **Step 1: Escribir las pruebas que fallan**

```js
test("no se puede cambiar la caja de un apartado: su dinero vive en los abonos", () => {
  const DB = construirDBPrueba();
  DB.pos.cajas = sembrarCajas(DB);
  const fiscal = DB.pos.cajas.find((c) => c.sucursal_id === 1 && !c.predeterminada);
  DB.pos.ventas = [{ id: 1, sucursal_id: 1, caja_id: null, tipo_documento: "Apartado", estatus: "apartado", fecha: "2026-09-04", total: 500 }];

  assert.throws(
    () => cambiarCajaVenta(DB, 1, fiscal.id, usuarioDePrueba()),
    /apartado/i
  );
});

test("no se puede cambiar la caja de una venta cancelada", () => {
  const DB = construirDBPrueba();
  DB.pos.cajas = sembrarCajas(DB);
  const fiscal = DB.pos.cajas.find((c) => c.sucursal_id === 1 && !c.predeterminada);
  DB.pos.ventas = [{ id: 2, sucursal_id: 1, caja_id: null, tipo_documento: "Ticket", estatus: "cancelada", fecha: "2026-09-04", total: 500 }];

  assert.throws(() => cambiarCajaVenta(DB, 2, fiscal.id, usuarioDePrueba()), /cancelada/i);
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `cd backend && node --test cambiarCajaVenta.test.js`
Expected: FAIL — hoy las dos operaciones se permiten.

- [ ] **Step 3: Implementar el rechazo en el backend**

En `cambiarCajaVenta`, justo después de encontrar la venta:

```js
  // El dinero de un apartado NO vive en la venta: vive en `apartado_abonos`,
  // cada abono con su propia caja. Mover el documento diria "movida a Fiscal"
  // sin mover un peso, y quien lo hizo creeria que corrigio. El spec deja los
  // apartados fuera de alcance: aqui se rechaza, no se extiende.
  if (venta.tipo_documento === "Apartado") {
    throw new Error("La caja de un apartado no se corrige aqui: su dinero esta en los abonos, no en el documento");
  }
  if (venta.estatus !== "cerrada") {
    throw new Error(`Solo se puede cambiar la caja de una venta cerrada; esta esta ${venta.estatus}`);
  }
```

- [ ] **Step 4: Correr y verificar que pasan**

Run: `cd backend && node --test cambiarCajaVenta.test.js`
Expected: PASS, y las pruebas que ya existían siguen pasando.

- [ ] **Step 5: Esconder el botón en la pantalla**

En `src/ConsultasVentas.jsx`, la barra ya condiciona por permiso. Condicionar además por la venta seleccionada, para que el botón no ofrezca algo que el backend va a rechazar:

```jsx
{puede("cambiar_caja_venta") && seleccionada?.tipo_documento !== "Apartado" && seleccionada?.estatus === "cerrada" && (
  <BotonBarra icono={ArrowLeftRight} etiqueta="Cambiar caja" onClick={abrirCambiarCaja} />
)}
```

La regla vive en el backend (paso 3); esto solo evita el rebote. No quitar la del backend.

- [ ] **Step 6: Suite y commit**

```bash
cd backend && node --test
cd .. && npx eslint src backend
git add backend/ventas.js backend/cambiarCajaVenta.test.js src/ConsultasVentas.jsx
git commit -m "fix(cajas): cambiar de caja solo un ticket cerrado, nunca un apartado"
```

---

### Task 4: El gasto declara de qué caja salió el dinero (backend)

**Por qué.** Hoy la ruta toma la sucursal del **token** y la caja de `?caja_id=`, que `apiFetch` inyecta desde `localStorage` (la caja de la sucursal del **encabezado**). Verificado en `server.js:1832` → `gastos.js:111` → `cajas.js:104`. Dos consecuencias reales:

- **Se bloquea:** con el encabezado en una tienda distinta a la del usuario, registrar un gasto falla con "La caja indicada no pertenece a la sucursal de la sesión", y no hay nada que hacer desde la pantalla.
- **Se equivoca en silencio, que es peor:** dentro de la propia tienda, el gasto se carga a la caja que hubiera arriba. La cajera se cambia a Fiscal para cobrar algo, captura después los $800 de gasolina, y al cortar la Administrativa el sistema le pide $800 de más. **Faltante a su nombre por dinero que sí salió y sí está capturado.**

La decisión de Victor: que la cajera **declare** la caja, en vez de heredarla. El gasto se sigue registrando en la sucursal del token — eso no cambia y es correcto.

**Files:**
- Modify: `backend/server.js:1832` (leer del body, no del query)
- Modify: `backend/gastos.js` (dentro del `.map()` de `listarGastos`)
- Test: `backend/gastos.test.js`

**Interfaces:**
- Consumes: `resolverCajaDeSucursal(DB, sucursalId, cajaId)` de `backend/cajas.js` — ya lanza si la caja no existe o no es de esa sucursal, y cae en la predeterminada cuando `cajaId` viene vacío.
- Produces: cada fila de `listarGastos` incluye `caja_nombre` (string) además del `caja_id` que ya guarda el registro.

- [ ] **Step 1: Escribir las pruebas que fallan**

```js
/**
 * La caja la declara quien captura, y se valida contra la sucursal del TOKEN,
 * que es donde el gasto se registra. Antes la caja venia del encabezado y la
 * sucursal del token: dos fuentes distintas para una sola decision, que es
 * exactamente la trampa que ya mordio tres veces en este repo.
 */
test("el gasto se carga a la caja declarada en el cuerpo, no a la del encabezado", async () => {
  const DB = construirDBPrueba();
  DB.pos.cajas = sembrarCajas(DB);
  const fiscal = DB.pos.cajas.find((c) => c.sucursal_id === 1 && !c.predeterminada);

  const gasto = await crearGasto(DB, { ...datosGastoDePrueba(), caja_id: fiscal.id }, 1, usuarioDePrueba(), driveFalso(), fiscal.id);

  assert.strictEqual(gasto.caja_id, fiscal.id);
});

test("un gasto sin caja declarada cae en la predeterminada de su sucursal", async () => {
  const DB = construirDBPrueba();
  DB.pos.cajas = sembrarCajas(DB);
  const administrativa = DB.pos.cajas.find((c) => c.sucursal_id === 1 && c.predeterminada);

  const gasto = await crearGasto(DB, datosGastoDePrueba(), 1, usuarioDePrueba(), driveFalso(), undefined);

  assert.strictEqual(gasto.caja_id, administrativa.id);
});

test("la lista de gastos dice de que caja salio cada uno", async () => {
  const DB = construirDBPrueba();
  DB.pos.cajas = sembrarCajas(DB);
  const fiscal = DB.pos.cajas.find((c) => c.sucursal_id === 1 && !c.predeterminada);
  await crearGasto(DB, datosGastoDePrueba(), 1, usuarioDePrueba(), driveFalso(), fiscal.id);

  const [fila] = listarGastos(DB, {}, { verTodas: true, sucursalId: null });
  assert.strictEqual(fila.caja_nombre, "Fiscal");
});
```

Ajusta `datosGastoDePrueba` / `driveFalso` a los helpers que ya use `gastos.test.js`.

- [ ] **Step 2: Correr y verificar que fallan**

Run: `cd backend && node --test gastos.test.js`
Expected: FAIL en la tercera (`listarGastos` no expone `caja_nombre`). Las dos primeras pueden pasar ya: sirven de red para que el paso 3 no las rompa.

- [ ] **Step 3: Implementar**

En `backend/server.js`, la ruta pasa a leer del cuerpo:

```js
    // La caja la DECLARA quien captura (cuerpo), no la hereda del encabezado.
    // Con `?caja_id=` la sucursal salia del token y la caja del selector: dos
    // fuentes para una sola decision, y el gasto acababa en la caja equivocada
    // —o rebotaba— segun donde estuviera mirando la barra de arriba.
    const gasto = await crearGasto(DB, req.body, req.usuarioToken.sucursal_id, req.usuarioToken, drive, req.body.caja_id);
```

En `backend/gastos.js`, dentro del `.map()` de `listarGastos`, junto a `sucursal_nombre`:

```js
        caja_nombre: (DB.pos.cajas || []).find((c) => c.id === g.caja_id)?.nombre || "—",
```

- [ ] **Step 4: Correr y verificar que pasan**

Run: `cd backend && node --test gastos.test.js gastosCorteCaja.test.js`
Expected: PASS.

- [ ] **Step 5: Suite y commit**

```bash
cd backend && node --test
git add backend/server.js backend/gastos.js backend/gastos.test.js
git commit -m "fix(gastos): la caja del gasto se declara, ya no se hereda del encabezado"
```

---

### Task 5: El gasto declara de qué caja salió el dinero (pantalla)

**Por qué.** Sin esto la Tarea 4 no le sirve a nadie: el formulario no manda `caja_id` y la lista no dice en qué caja quedó cada gasto. El aviso actual dice "se descontará del efectivo esperado en el corte de caja de tu turno" sin decir de cuál.

**Files:**
- Modify: `src/Gastos.jsx` (estado del formulario, selector, aviso, columna de la tabla)

**Interfaces:**
- Consumes: `GET /api/cajas` devuelve `[{ id, nombre, sucursal_id, predeterminada }]` de la sucursal del encabezado; y `listarGastos` ahora devuelve `caja_nombre` por fila (Tarea 4).

- [ ] **Step 1: Cargar las cajas y sugerir la activa**

En `src/Gastos.jsx`, junto a los demás catálogos:

```jsx
const [cajas, setCajas] = useState([]);

useEffect(() => {
  apiFetch("/cajas")
    .then((r) => (r.ok ? r.json() : []))
    .then((datos) => {
      setCajas(datos);
      // Se SUGIERE la caja del encabezado, no se impone: quien captura decide.
      const sugerida = datos.find((c) => String(c.id) === String(cajaActiva())) || datos.find((c) => c.predeterminada);
      if (sugerida) setForm((f) => ({ ...f, caja_id: String(sugerida.id) }));
    })
    .catch(() => setCajas([]));
}, []);
```

Importar `cajaActiva` desde `./api`. Añadir `caja_id: ""` al estado inicial de `form`.

- [ ] **Step 2: El selector, solo cuando el gasto sale de la caja**

Justo debajo del bloque de "Forma de pago", reemplazando el aviso actual:

```jsx
{form.forma_pago === "EFECTIVO" && (
  <div>
    <label className="text-xs text-slate-500 block mb-1">¿De qué caja salió el dinero? *</label>
    <select required value={form.caja_id} onChange={(e) => setForm({ ...form, caja_id: e.target.value })} className={inputCls}>
      {cajas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
    </select>
    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 mt-1.5">
      Este gasto se descontará del efectivo esperado en el corte de la caja <strong>{cajas.find((c) => String(c.id) === String(form.caja_id))?.nombre || "seleccionada"}</strong>.
      Si el dinero salió de la otra caja, cámbialo aquí antes de guardar.
    </p>
  </div>
)}
```

Solo para `EFECTIVO`: una transferencia o una tarjeta no tocan el cajón, y preguntar por la caja ahí confundiría.

- [ ] **Step 3: La columna en la lista**

En el `<thead>`, después de `Forma de pago`:

```jsx
<th className="py-2 px-3 text-left font-medium">Caja</th>
```

Y en la fila correspondiente del `<tbody>`, en la misma posición:

```jsx
<td className="py-2 px-3">{g.forma_pago === "EFECTIVO" ? (g.caja_nombre || "—") : "—"}</td>
```

- [ ] **Step 4: Verificar que no rompe el envío**

`guardar()` ya manda `...form`, así que `caja_id` viaja solo. Confirmar leyendo el cuerpo de `guardar()` que no hay una lista blanca de campos que lo deje fuera.

- [ ] **Step 5: Lint y commit**

```bash
npx eslint src backend
git add src/Gastos.jsx
git commit -m "feat(gastos): la cajera declara de que caja salio el dinero"
```

**Verificación en navegador (obligatoria, esta tarea no tiene pruebas automáticas):** registrar un gasto en efectivo con la Fiscal elegida en el formulario, ir al Corte de Caja de la Administrativa y comprobar que **no** aparece, y al de la Fiscal y comprobar que **sí**.

---

### Task 6: El aviso de dinero cancelado deja de estar ciego para lo histórico

**Por qué.** `canceladoDeCortesAnteriores` (`cortes.js:105`) filtra `.filter((v) => v.corte_id != null)`. Verificado: `corte_id` solo lo tienen los movimientos sellados por esta rama, así que **ninguna venta de la base actual lo tiene**. El aviso existe para explicar un faltante cuando se cancela una venta que un corte anterior ya contó — y está apagado justo durante las primeras semanas, que es cuando la base es casi toda histórica y cuando más probable es que se cancele algo viejo. La cajera carga con el faltante y el sistema calla.

**Files:**
- Modify: `backend/cortes.js:102-112`
- Test: `backend/cancelacionTrasCorte.test.js`

- [ ] **Step 1: Escribir la prueba que falla**

```js
/**
 * Todo lo que hay hoy en la base es historico: sin `corte_id`, porque ese sello
 * nacio con esta rama. Si el aviso solo mira lo sellado, esta apagado justo el
 * primer mes — que es cuando mas falta hace.
 */
test("una venta historica ya contada y cancelada despues si produce el aviso", () => {
  const DB = construirDBPrueba();
  DB.pos.cajas = sembrarCajas(DB);
  const administrativa = DB.pos.cajas.find((c) => c.sucursal_id === 1 && c.predeterminada);
  DB.pos.corte_epoca = "2026-09-01T00:00:00.000Z";
  DB.pos.ventas = [{
    id: 1, sucursal_id: 1, caja_id: null, corte_id: null,
    tipo_documento: "Ticket", estatus: "cancelada", metodo_pago: "EFECTIVO",
    fecha: "2026-08-20", fecha_hora: "2026-08-20T18:00:00.000Z", total: 500,
  }];

  const aviso = canceladoDeCortesAnteriores(DB, 1, "2026-08-25T00:00:00.000Z", administrativa);

  assert.strictEqual(aviso, 500);
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd backend && node --test cancelacionTrasCorte.test.js`
Expected: FAIL con `0 !== 500`.

- [ ] **Step 3: Implementar**

Sustituir el filtro `.filter((v) => v.corte_id != null)` por uno que acepte las dos eras, usando la misma frontera que ya usa `ventasDelTurno` en su rama histórica:

```js
    .filter((v) => {
      const marca = v.fecha_hora || `${v.fecha}T00:00:00.000Z`;
      // Era sellada: lo conto un corte si lleva su sello.
      if (esDeLaEraSellada(marca, DB)) return v.corte_id != null;
      // Era historica: no hay sello, asi que "ya lo conto un corte" se deduce
      // del reloj, con la MISMA frontera que usa ventasDelTurno para incluirla.
      return desde ? marca <= desde : false;
    })
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `cd backend && node --test cancelacionTrasCorte.test.js corteSellado.test.js cortes.test.js`
Expected: PASS, sin romper los escenarios sellados que ya existían.

- [ ] **Step 5: Commit**

```bash
git add backend/cortes.js backend/cancelacionTrasCorte.test.js
git commit -m "fix(cortes): el aviso de cancelaciones ya ve las ventas anteriores a las cajas"
```

---

### Task 7: El aviso de dinero cancelado se ve en la pantalla del corte

**Por qué.** El valor se calcula, se filtra por el permiso `ver_montos_corte` y viaja en `/api/cortes/en-curso` como `cancelado_de_cortes_anteriores`. Pero `grep -rn "cancelado_de_cortes" src` no devuelve nada: **ninguna pantalla lo muestra.** Es media función construida, y la mitad que falta es la única que ve la cajera.

**Files:**
- Modify: `src/CorteCaja.jsx` (junto al renglón de "Gastos del turno")

- [ ] **Step 1: Pintar el renglón, solo cuando hay algo que decir**

```jsx
{Number(turno?.cancelado_de_cortes_anteriores) > 0 && (
  <div className="text-xs bg-amber-50 border border-amber-300 text-amber-900 rounded px-2 py-1.5">
    ⚠ Se cancelaron {pesos(turno.cancelado_de_cortes_anteriores)} de ventas que un corte anterior ya había contado.
    Si te falta ese dinero, esta es la razón — no es un faltante tuyo.
  </div>
)}
```

Usar el mismo helper de formato de moneda que ya usa el archivo — no inventar otro. Confirmar cómo se llama el objeto del turno en ese componente antes de escribir `turno?.`.

- [ ] **Step 2: Verificar a mano**

No hay pruebas de interfaz en este repo. Verificar en navegador con el escenario 3 de la lista de abajo.

- [ ] **Step 3: Lint y commit**

```bash
npx eslint src backend
git add src/CorteCaja.jsx
git commit -m "fix(cortes): la cajera ve por que le falta dinero cuando se cancelo una venta ya cortada"
```

---

### Task 8: `esDeEstaCaja` endurecida contra un `caja_id` de texto

**Por qué.** Los caminos de escritura actuales son seguros (verificado: todos guardan `caja.id`, que es número). Pero si algún día llegara un `caja_id: "7"` —una foto restaurada editada a mano, o una ruta futura que persista `req.query.caja_id` crudo—, `"7" === 7` es falso y `"7" == null` también: **la venta no la reclama ninguna de las dos cajas**. Dinero que desaparece sin dejar rastro es peor que dinero contado dos veces, porque nadie lo va a buscar. Es la misma trampa documentada de `producto_id`.

**Files:**
- Modify: `backend/cajas.js:123`
- Test: `backend/cajas.test.js`

- [ ] **Step 1: Escribir la prueba que falla**

```js
test("un caja_id de texto pertenece a su caja, no desaparece", () => {
  const DB = construirDBPrueba();
  DB.pos.cajas = sembrarCajas(DB);
  const fiscal = DB.pos.cajas.find((c) => c.sucursal_id === 1 && !c.predeterminada);
  const administrativa = DB.pos.cajas.find((c) => c.sucursal_id === 1 && c.predeterminada);
  const registro = { caja_id: String(fiscal.id) };

  assert.strictEqual(esDeEstaCaja(registro, fiscal), true);
  assert.strictEqual(esDeEstaCaja(registro, administrativa), false);
});

test("un registro sin caja sigue siendo de la predeterminada y solo de ella", () => {
  const DB = construirDBPrueba();
  DB.pos.cajas = sembrarCajas(DB);
  const fiscal = DB.pos.cajas.find((c) => c.sucursal_id === 1 && !c.predeterminada);
  const administrativa = DB.pos.cajas.find((c) => c.sucursal_id === 1 && c.predeterminada);

  assert.strictEqual(esDeEstaCaja({ caja_id: null }, administrativa), true);
  assert.strictEqual(esDeEstaCaja({}, administrativa), true);
  assert.strictEqual(esDeEstaCaja({ caja_id: null }, fiscal), false);
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd backend && node --test cajas.test.js`
Expected: FAIL — el primer `assert` da `false`.

- [ ] **Step 3: Implementar, cuidando el orden**

`Number(null)` es `0`, así que la comprobación de nulo va **antes** de convertir:

```js
function esDeEstaCaja(registro, caja) {
  if (!caja) return true;
  if (registro.caja_id == null) return caja.predeterminada === true;
  return Number(registro.caja_id) === caja.id;
}
```

Conservar el comentario de cabecera que ya tiene la función; sigue siendo cierto.

- [ ] **Step 4: Correr la suite entera**

Run: `cd backend && node --test`
Expected: 1239/1239 + las nuevas. Esta función la usan ventas, abonos, gastos y cortes: si algo se rompe, sale aquí.

- [ ] **Step 5: Commit**

```bash
git add backend/cajas.js backend/cajas.test.js
git commit -m "fix(cajas): un caja_id de texto ya no hace desaparecer el dinero de las dos cajas"
```

---

### Task 9: La prueba del permiso prueba el permiso

**Por qué.** `cambiarCajaVenta.test.js:159` crea el rol de prueba con `permisos: []`. Esa prueba pasaría igual si la ruta exigiera `cancelar_ventas` o cualquier otra clave: un rol sin ningún permiso recibe 403 contra cualquier `requierePermiso`. **No verifica lo que su nombre promete**, justo donde el proyecto tiene una regla de oro escrita.

**Files:**
- Modify: `backend/cambiarCajaVenta.test.js:159`

- [ ] **Step 1: Darle al rol permisos vecinos del mismo módulo**

```js
  // Con `permisos: []` esta prueba pasaba con CUALQUIER clave: un rol sin nada
  // recibe 403 contra cualquier `requierePermiso`. Con vecinos del mismo modulo,
  // se pone roja el dia que alguien cambie la clave por una prestada.
  permisos: ["ver_lista_ventas", "cancelar_ventas"],
```

- [ ] **Step 2: Verificar que sigue dando 403**

Run: `cd backend && node --test cambiarCajaVenta.test.js`
Expected: PASS — sigue siendo 403, pero ahora por la razón correcta.

- [ ] **Step 3: Comprobar que la prueba sirve (verificación por mutación)**

Cambiar temporalmente en `server.js` el permiso de la ruta `PUT /api/ventas/:id/caja` a `"cancelar_ventas"` y correr la prueba: **debe ponerse roja**. **Revertir la mutación en este mismo turno** — hay precedente de dos sesiones muertas dejando código mutado sin commitear, y una costó una sesión entera de diagnóstico.

- [ ] **Step 4: Commit**

```bash
git add backend/cambiarCajaVenta.test.js
git commit -m "test(cajas): la prueba del permiso ahora si prueba ese permiso"
```

---

### Task 10: El Reporte de Cortes distingue las dos cajas

**Por qué.** `reportes.js:213-219` no incluye la caja en las filas. A partir de esta rama habrá dos cortes por tienda y por día, indistinguibles en el reporte. Los totales suman bien; la lectura no. (El historial de `CorteCaja.jsx` sí la muestra.)

**Files:**
- Modify: `backend/reportes.js:213-219`
- Modify: la pantalla del reporte en `src/reportes/`
- Test: `backend/reportes.test.js` (si no existe, crear el archivo con este único caso)

- [ ] **Step 1: Escribir la prueba que falla**

```js
test("el reporte de cortes dice de que caja es cada corte", () => {
  const DB = construirDBPrueba();
  DB.pos.cajas = sembrarCajas(DB);
  const fiscal = DB.pos.cajas.find((c) => c.sucursal_id === 1 && !c.predeterminada);
  DB.pos.cortes = [{ id: 1, sucursal_id: 1, caja_id: fiscal.id, fecha: "2026-09-04", contado: 700, calculado: 700, retiro: 0 }];

  const [fila] = reporteCortesCaja(DB, { fecha_inicio: "2026-09-04", fecha_fin: "2026-09-04" }, { verTodas: true, sucursalId: null });

  assert.strictEqual(fila.caja_nombre, "Fiscal");
});
```

Ajustar el nombre de la función al que exporte `reportes.js` para este reporte.

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd backend && node --test reportes.test.js`
Expected: FAIL — `caja_nombre` es `undefined`.

- [ ] **Step 3: Implementar**

Añadir `caja_nombre` a la fila, igual que ya se hace con `sucursal_nombre`:

```js
      caja_nombre: (DB.pos.cajas || []).find((c) => c.id === corte.caja_id)?.nombre || "—",
```

- [ ] **Step 4: Correr, y añadir la columna en la pantalla**

Run: `cd backend && node --test reportes.test.js`
Expected: PASS. Después, añadir la columna "Caja" en la pantalla del reporte, junto a la de Sucursal.

- [ ] **Step 5: Lint y commit**

```bash
npx eslint src backend
git add backend/reportes.js backend/reportes.test.js src/reportes/
git commit -m "feat(reportes): el reporte de cortes distingue las dos cajas"
```

---

## Menores que NO entran en este plan

Se dejan anotados a propósito, para que nadie los "arregle" creyendo que se olvidaron:

- **F5 deja de recargar la página** en Consultas de Ventas. Es coherente con SICAR y probablemente deliberado. Si molesta en la prueba en navegador, se quita.
- **Botones que se apagan de más** en `MercadoLibre.jsx:377` y `Garantias.jsx:213-249`: protegen de más, no rompen nada.
- **`comprobarConservacion` usa `>` donde el código usa `>=`** (`corteSellado.test.js:67`). Falla segura: hoy rompería la prueba en vez de esconder un fallo.
- **`corte.desde` ya no acota lo que el corte incluye** en la era sellada. El dato es correcto; el rótulo de la pantalla puede confundir.
- **La venta de MercadoLibre tiene `fecha` vieja y `fecha_hora` de hoy** (`mercadolibre.js:320-322`). Impacto nulo en el cajón; recordarlo el día que alguien concilie el corte con el Reporte de Ventas.
- **`validarAntesDeRestaurar` pasa un segundo argumento que `reconciliarTrasRestaurar` no recibe** (`reconciliarRestauracion.js:59`). Inofensivo; se limpia solo en la Tarea 1.

---

## Verificación final, antes de que Victor apruebe el merge

- `cd backend && node --test` — 1239/1239 más las pruebas nuevas, sin regresiones.
- `npx eslint src backend` — 0 errores.
- `git diff --check` limpio y sin archivos inesperados.
- **Revisión independiente del diff completo de la rama** — despachada a Codex, no a subagentes de Claude.
- **Prueba en navegador**, que nadie ha hecho todavía y que ninguna prueba automática sustituye:

1. **El gasto va a la caja que se declara.** Registrar un gasto en efectivo eligiendo **Fiscal** en el formulario, con el encabezado en **Administrativa**. Comprobar que el Corte de la Administrativa **no** lo descuenta y el de la Fiscal **sí**. Es el paso que habría destapado el defecto original.
2. **El gasto ya no rebota.** Con el encabezado en una tienda distinta a la propia, registrar un gasto y comprobar que **guarda**, en vez de decir "La caja indicada no pertenece a la sucursal de la sesión".
3. **El aviso de cancelación se ve.** Vender $500 en efectivo, cerrar el corte, cancelar esa venta, y comprobar que el siguiente corte **avisa en pantalla** de los $500 cancelados.
4. **Las dos cajas no se roban dinero.** Vender $300 en Administrativa y $700 en Fiscal; cada corte debe mostrar lo suyo y el ticket debe decir el nombre de la caja.
5. **Las ventas viejas siguen ahí.** En una base con datos previos: la Administrativa debe traer todo el historial y la Fiscal empezar en cero. Si la Administrativa muestra menos que antes, **detener todo y no cerrar ningún corte**.
6. **El apartado se ve donde cobra.** Crear un apartado con anticipo en Fiscal y comprobar que Consultas de Ventas filtrada por Fiscal lo muestra, y que el botón "Cambiar caja" **no aparece** al seleccionarlo.
7. **Restaurar no cierra la puerta.** Restaurar un respaldo y comprobar que el sistema queda usable y que, si hubo reparaciones del catálogo de cajas, la pantalla las dice.
8. **Un rol sin el permiso.** Crear un rol con "Ver Lista de Ventas" y "Cancelar Ventas" pero sin "Cambiar Caja de una Venta", y comprobar que el botón no aparece.
