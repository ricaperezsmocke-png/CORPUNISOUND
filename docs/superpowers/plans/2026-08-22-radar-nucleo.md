# Radar de Demanda — núcleo nuevo: plan de implementación

> **Para agentes ejecutores:** SUB-SKILL REQUERIDA: usar `superpowers:subagent-driven-development` (recomendada) o `superpowers:executing-plans` para ejecutar este plan tarea por tarea. Los pasos usan casillas (`- [ ]`) para seguimiento.

**Objetivo:** Rehacer el núcleo backend de Radar de Demanda en capas, arreglando los tres defectos verificados (consentimiento falsificable, CONVERTIDA sin venta, dos fórmulas de conversión) sin tocar las pantallas ni el contrato HTTP.

**Arquitectura:** El archivo de 743 líneas se parte en `backend/radar/`, una responsabilidad por pieza, y `radarDemanda.js` queda como fachada que exporta exactamente lo que `server.js` ya importa. Los datos siguen en el documento JSON (`DB.radar_demanda`). Cada arreglo crea la capa que le corresponde, así que no hay un refactor grande sin comportamiento.

**Tech Stack:** Node.js 20, Express, `node --test` (runner nativo), `better-sqlite3` solo como almacén del documento JSON. **Sin dependencias nuevas.**

**Spec:** `docs/superpowers/specs/2026-08-22-radar-nucleo-design.md`

## Restricciones globales

- **Rama:** `feature/radar-nucleo`. **Worktree:** `C:\Users\Victor\Desktop\CORPUNISOUND-nucleo`. **Commit base:** `6bd5836` (spec) sobre `5b0ef2f`.
- **Baseline verificado el 2026-08-22:** los nueve archivos de prueba de Radar dan **193 pruebas, 193 PASS, 0 FAIL**. Ese es el número contra el que se compara, no un total histórico.
- Todo en **español**: mensajes de error, comentarios y nombres de prueba.
- **Sin dependencias nuevas.** Nada de `npm install <paquete>`.
- Las pruebas se corren desde `backend/`: `node --test <archivo>`.
- **Nunca `git add .`** — siempre rutas explícitas.
- **Prohibido** hacer merge, push, rebase o desplegar. Los commits de cada tarea sí están autorizados en esta rama.
- **Prohibido tocar:** `src/**` (las pantallas no se tocan), `backend/radarDemandaInteligencia.js`, `backend/radarDemandaReglas.js`, `backend/persistencia.js`, `render.yaml`, `.agents/`, `.claude/`, `graphify-out/`, `skills-lock.json`.
- **Prohibido modificar una prueba para que pase.** La única prueba existente que se corrige es `radarDemandaCincoSucursales.test.js:66`, en la Tarea 2, y el motivo se explica en el commit.

### Detenerse e informar si

- hace falta modificar un archivo que no esté en la lista de autorizados de la tarea;
- aparece una decisión de negocio que el spec no cubre;
- una prueba existente falla por algo que no sea el cambio deliberado de la Tarea 2;
- se necesita una dependencia nueva;
- aparecen cambios ajenos en el worktree;
- el contrato HTTP tendría que cambiar más allá de los dos cambios ya aprobados.

### Corrección al spec aplicada en este plan

El spec ya se corrigió en este mismo commit: campo **ausente** (`undefined`) o `null` significa `false`; campo **presente con un valor que no es booleano** se rechaza con 400. La versión anterior del spec decía que `undefined` también se rechazaba, lo que habría roto toda captura normal.

---

## Estructura de archivos

| Archivo | Responsabilidad | Tarea |
|---|---|---|
| `backend/radar/errores.js` | `ErrorRadar` con código HTTP propio | 1 |
| `backend/radar/entrada.js` | Validación estricta de lo que llega de fuera | 1 |
| `backend/radar/metricas.js` | La única definición de conversión y recuperación | 2 |
| `backend/radar/reglasEstado.js` | Transiciones e invariantes de cierre | 3 |
| `backend/radar/vinculoCrm.js` | Alta y enlace del prospecto en CRM | 4 |
| `backend/radar/modelo.js` | Forma del registro, normalización, ids, copia | 5 |
| `backend/radar/consultas.js` | Listados, filtros y alcance por sucursal | 5 |
| `backend/radarDemanda.js` | Fachada: exporta lo que `server.js` ya importa | 1-5 |

---

### Tarea 1: Consentimiento que no se puede falsear

**Archivos:**
- Crear: `backend/radar/errores.js`
- Crear: `backend/radar/entrada.js`
- Crear: `backend/radarEntrada.test.js`
- Modificar: `backend/radarDemanda.js` (`crearDemanda`, `crearDemandaConCRM`)
- Modificar: `backend/server.js` (solo `responderErrorRadar`, líneas 625-634)
- Modificar: `backend/radarDemandaRutas.test.js` (agregar casos, no cambiar los existentes)

**Interfaces:**
- Produce: `ErrorRadar(mensaje, estatus = 400)` con propiedad `.estatus`; `booleanoEstricto(valor, campo) -> boolean`.
- Consume: nada de tareas anteriores.

- [ ] **Paso 1: Escribir la prueba que falla**

Crear `backend/radarEntrada.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");

const { booleanoEstricto } = require("./radar/entrada");
const { ErrorRadar } = require("./radar/errores");

test("un booleano de verdad pasa tal cual", () => {
  assert.equal(booleanoEstricto(true, "intencion_compra"), true);
  assert.equal(booleanoEstricto(false, "intencion_compra"), false);
});

test("el campo ausente significa que no, no un error", () => {
  assert.equal(booleanoEstricto(undefined, "intencion_compra"), false);
  assert.equal(booleanoEstricto(null, "intencion_compra"), false);
});

test('la cadena "false" NO es verdadera: se rechaza', () => {
  assert.throws(() => booleanoEstricto("false", "consentimiento_aviso"), ErrorRadar);
});

test("ninguna cadena ni número cuela como booleano", () => {
  for (const valor of ["true", "0", "1", "", 0, 1, [], {}]) {
    assert.throws(
      () => booleanoEstricto(valor, "intencion_compra"),
      ErrorRadar,
      `debería rechazar ${JSON.stringify(valor)}`
    );
  }
});

test("el error dice qué campo y trae 400", () => {
  try {
    booleanoEstricto("false", "consentimiento_aviso");
    assert.fail("debió lanzar");
  } catch (error) {
    assert.equal(error.estatus, 400);
    assert.match(error.message, /consentimiento_aviso/);
  }
});
```

- [ ] **Paso 2: Correr la prueba y verificar que falla**

Correr: `node --test radarEntrada.test.js`
Esperado: FALLA con `Cannot find module './radar/entrada'`.

- [ ] **Paso 3: Escribir la implementación mínima**

Crear `backend/radar/errores.js`:

```js
/**
 * Error de dominio de Radar con su propio código HTTP.
 *
 * Antes el código HTTP se adivinaba con una expresión regular sobre el texto
 * del mensaje en server.js. Eso obliga a redactar los mensajes para engañar a
 * la regex. Con esta clase el dominio dice explícitamente qué código quiere.
 */
class ErrorRadar extends Error {
  constructor(mensaje, estatus = 400) {
    super(mensaje);
    this.name = "ErrorRadar";
    this.estatus = estatus;
  }
}

module.exports = { ErrorRadar };
```

Crear `backend/radar/entrada.js`:

```js
const { ErrorRadar } = require("./errores");

/**
 * Un booleano que viene de fuera tiene que ser un booleano de verdad.
 *
 * En JavaScript la cadena "false" es verdadera. Aceptarla significaba dar de
 * alta un prospecto en el CRM y registrar que el cliente aceptó recibir el
 * aviso cuando nunca lo aceptó. El campo ausente sí es válido: quiere decir
 * que no.
 */
function booleanoEstricto(valor, campo) {
  if (valor === undefined || valor === null) return false;
  if (typeof valor !== "boolean") {
    throw new ErrorRadar(
      `${campo} debe ser verdadero o falso, no ${JSON.stringify(valor)}`,
      400
    );
  }
  return valor;
}

module.exports = { booleanoEstricto };
```

- [ ] **Paso 4: Correr la prueba y verificar que pasa**

Correr: `node --test radarEntrada.test.js`
Esperado: PASA, 5 pruebas.

- [ ] **Paso 5: Usarlo en el dominio**

En `backend/radarDemanda.js`, agregar el require arriba junto a `crearCliente`:

```js
const { booleanoEstricto } = require("./radar/entrada");
const { ErrorRadar } = require("./radar/errores");
```

En `crearDemanda`, sustituir estas dos líneas:

```js
    intencion_compra: !!datos.intencion_compra,
    consentimiento_aviso: !!datos.consentimiento_aviso,
```

por:

```js
    intencion_compra: booleanoEstricto(datos.intencion_compra, "intencion_compra"),
    consentimiento_aviso: booleanoEstricto(datos.consentimiento_aviso, "consentimiento_aviso"),
```

En `crearDemandaConCRM`, sustituir:

```js
    if (!datos?.intencion_compra) return crearDemanda(DB, datos || {}, contexto);
    if (!datos.consentimiento_aviso) throw new Error("Confirma el consentimiento del cliente para recibir el aviso");
```

por:

```js
    const intencion = booleanoEstricto(datos?.intencion_compra, "intencion_compra");
    const consentimiento = booleanoEstricto(datos?.consentimiento_aviso, "consentimiento_aviso");
    if (!intencion) return crearDemanda(DB, datos || {}, contexto);
    if (!consentimiento) {
      throw new ErrorRadar("Confirma el consentimiento del cliente para recibir el aviso", 400);
    }
```

- [ ] **Paso 6: Que la ruta responda 400**

En `backend/server.js`, dentro de `responderErrorRadar`, agregar como **primera** línea del cuerpo (antes del `const mensaje`):

```js
  if (error && typeof error.estatus === "number") {
    return res.status(error.estatus).json({ error: error.message });
  }
```

La regex existente se queda como está: sigue cubriendo los errores viejos que no usan `ErrorRadar`.

**Ojo:** la ruta `POST /api/radar-demanda` (línea 655) también decide con `if (req.body?.intencion_compra)` para exigir el permiso `crear_cliente`. Sustituir esa condición por `if (booleanoEstricto(req.body?.intencion_compra, "intencion_compra"))` **dentro del `try`**, para que el 400 salga por `responderErrorRadar` y no reviente la ruta.

- [ ] **Paso 7: Prueba de ruta de punta a punta**

Agregar al final de `backend/radarDemandaRutas.test.js`, usando los helpers que ya existen ahí (`pedir`, `demandaValida`, `tokenS1`):

```js
test('la cadena "false" no crea prospecto ni consentimiento', async () => {
  const clientesAntes = (await pedir("/api/crm/clientes", { token: tokenAdmin })).cuerpo.length;
  const r = await pedir("/api/radar-demanda", {
    token: tokenS1,
    method: "POST",
    body: demandaValida({
      intencion_compra: "false",
      consentimiento_aviso: "false",
      nombre_contacto: "Nadie",
      telefono_contacto: "9615550000",
    }),
  });
  assert.equal(r.status, 400);
  assert.match(r.cuerpo.error, /intencion_compra/);
  const clientesDespues = (await pedir("/api/crm/clientes", { token: tokenAdmin })).cuerpo.length;
  assert.equal(clientesDespues, clientesAntes, "el CRM no debió cambiar");
});
```

Si la ruta `/api/crm/clientes` necesita otro permiso o forma distinta en ese archivo, usar el helper que ya emplean las pruebas de CRM del mismo archivo en vez de inventar uno.

- [ ] **Paso 8: Correr todas las pruebas de Radar**

Correr desde `backend/`:

```bash
node --test radarEntrada.test.js radarDemanda.test.js radarDemandaAnalisis.test.js radarDemandaCincoSucursales.test.js radarDemandaCrm.test.js radarDemandaInteligencia.test.js radarDemandaInteligenciaRutas.test.js radarDemandaReglas.test.js radarDemandaRutas.test.js radarDemandaSucursal.test.js
```

Esperado: 0 FAIL. El total sube de 193 por las pruebas nuevas.

- [ ] **Paso 9: Commit**

```bash
git add backend/radar/errores.js backend/radar/entrada.js backend/radarEntrada.test.js backend/radarDemanda.js backend/server.js backend/radarDemandaRutas.test.js
git commit -m "fix(radar): la cadena \"false\" ya no cuenta como consentimiento del cliente"
```

---

### Tarea 2: Una sola fórmula de conversión

**Archivos:**
- Crear: `backend/radar/metricas.js`
- Crear: `backend/radarMetricas.test.js`
- Modificar: `backend/radarDemanda.js` (`porcentaje`, `metricasRegistros`, `obtenerResumen`)
- Modificar: `backend/radarDemandaCincoSucursales.test.js` (línea 66 — corrección deliberada)

**Interfaces:**
- Consume: nada de la Tarea 1.
- Produce: `calcularMetricas(registros) -> { total, cantidad_solicitada, pendientes, convertidas, no_convertidas, canceladas, tasa_conversion, tasa_recuperacion, conversion_detalle: {numerador, denominador}, recuperacion_detalle: {numerador, denominador} }` y `ESTADOS_PENDIENTES`.

- [ ] **Paso 1: Escribir la prueba que falla**

Crear `backend/radarMetricas.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");

const { calcularMetricas } = require("./radar/metricas");

const registro = (estado, cantidad = 1) => ({ estado, cantidad });

test("la conversión solo mira cierres decididos", () => {
  const m = calcularMetricas([
    registro("CONVERTIDA"), registro("NO_CONVERTIDA"), registro("REGISTRADA"),
  ]);
  assert.equal(m.tasa_conversion, 50);
  assert.deepEqual(m.conversion_detalle, { numerador: 1, denominador: 2 });
});

test("la recuperación sí cuenta los pendientes", () => {
  const m = calcularMetricas([
    registro("CONVERTIDA"), registro("NO_CONVERTIDA"), registro("REGISTRADA"),
  ]);
  assert.equal(m.tasa_recuperacion, 33.33);
  assert.deepEqual(m.recuperacion_detalle, { numerador: 1, denominador: 3 });
});

test("las canceladas no entran en ninguna tasa", () => {
  const m = calcularMetricas([registro("CONVERTIDA"), registro("CANCELADA")]);
  assert.equal(m.tasa_conversion, 100);
  assert.equal(m.tasa_recuperacion, 100);
  assert.equal(m.canceladas, 1);
});

test("sin denominador devuelve cero, nunca NaN", () => {
  const m = calcularMetricas([registro("CANCELADA")]);
  assert.equal(m.tasa_conversion, 0);
  assert.equal(m.tasa_recuperacion, 0);
});

test("una lista vacía no rompe nada", () => {
  const m = calcularMetricas([]);
  assert.equal(m.total, 0);
  assert.equal(m.tasa_conversion, 0);
  assert.equal(m.cantidad_solicitada, 0);
});
```

- [ ] **Paso 2: Correr la prueba y verificar que falla**

Correr: `node --test radarMetricas.test.js`
Esperado: FALLA con `Cannot find module './radar/metricas'`.

- [ ] **Paso 3: Escribir la implementación**

Crear `backend/radar/metricas.js`:

```js
/**
 * La única definición de conversión y recuperación de Radar.
 *
 * Antes había dos: /resumen dividía las convertidas entre TODOS los registros
 * y /analisis entre los cierres decididos. Con los mismos datos, un tablero
 * decía 10% y el otro 100%. Las fórmulas de aquí son las aprobadas, y se
 * devuelve numerador y denominador para que el número se pueda comprobar a
 * mano.
 */

const ESTADOS_PENDIENTES = new Set([
  "REGISTRADA", "EN_SEGUIMIENTO", "PRODUCTO_DISPONIBLE", "CLIENTE_CONTACTADO",
]);

function porcentaje(numerador, denominador) {
  return denominador ? Math.round((numerador / denominador) * 10000) / 100 : 0;
}

function calcularMetricas(registros) {
  let pendientes = 0, convertidas = 0, noConvertidas = 0, canceladas = 0, cantidad = 0;
  for (const item of registros) {
    cantidad += Number(item.cantidad) || 0;
    if (ESTADOS_PENDIENTES.has(item.estado)) pendientes += 1;
    else if (item.estado === "CONVERTIDA") convertidas += 1;
    else if (item.estado === "NO_CONVERTIDA") noConvertidas += 1;
    else if (item.estado === "CANCELADA") canceladas += 1;
  }
  const denominadorConversion = convertidas + noConvertidas;
  const denominadorRecuperacion = pendientes + convertidas + noConvertidas;
  return {
    total: registros.length,
    cantidad_solicitada: cantidad,
    pendientes,
    convertidas,
    no_convertidas: noConvertidas,
    canceladas,
    tasa_conversion: porcentaje(convertidas, denominadorConversion),
    tasa_recuperacion: porcentaje(convertidas, denominadorRecuperacion),
    conversion_detalle: { numerador: convertidas, denominador: denominadorConversion },
    recuperacion_detalle: { numerador: convertidas, denominador: denominadorRecuperacion },
  };
}

module.exports = { ESTADOS_PENDIENTES, porcentaje, calcularMetricas };
```

- [ ] **Paso 4: Correr la prueba y verificar que pasa**

Correr: `node --test radarMetricas.test.js`
Esperado: PASA, 5 pruebas.

- [ ] **Paso 5: Que el dominio use la única fórmula**

En `backend/radarDemanda.js`:

1. Agregar arriba: `const { calcularMetricas, porcentaje, ESTADOS_PENDIENTES } = require("./radar/metricas");`
2. **Borrar** la constante local `ESTADOS_PENDIENTES` (líneas 69-71) y la función local `porcentaje` (líneas 576-578).
3. Sustituir el cuerpo de `metricasRegistros(registros)` por `return calcularMetricas(registros);`.
4. En `obtenerResumen`, sustituir la línea del cálculo:

```js
    tasa_conversion: registros.length ? Math.round((convertidas / registros.length) * 10000) / 100 : 0,
```

por la mezcla con las métricas únicas, conservando las agrupaciones que ya devuelve:

```js
  const metricas = calcularMetricas(registros);
  return {
    total: registros.length,
    cantidad_solicitada: cantidadSolicitada,
    convertidas,
    tasa_conversion: metricas.tasa_conversion,
    conversion_detalle: metricas.conversion_detalle,
    tasa_recuperacion: metricas.tasa_recuperacion,
    recuperacion_detalle: metricas.recuperacion_detalle,
    por_estado: porEstado,
    por_motivo: porMotivo,
    por_sucursal: porSucursal,
  };
```

- [ ] **Paso 6: Corregir la prueba que consagra el error**

`backend/radarDemandaCincoSucursales.test.js:66` recalcula dentro de la prueba la fórmula defectuosa:

```js
    tasa_conversion: registros.length ? Math.round((convertidas / registros.length) * 10000) / 100 : 0,
```

Ese archivo lleva su propia copia de `obtenerResumen` y cuenta por `por_estado`, así que la corrección exacta es esta. Sustituir esa línea por:

```js
    tasa_conversion: ((por_estado.CONVERTIDA || 0) + (por_estado.NO_CONVERTIDA || 0))
      ? Math.round(((por_estado.CONVERTIDA || 0) /
          ((por_estado.CONVERTIDA || 0) + (por_estado.NO_CONVERTIDA || 0))) * 10000) / 100
      : 0,
```

**No** tocar ninguna otra prueba: si otra falla, detenerse e informar.

**Ampliación autorizada por Victor el 2026-08-22.** Al ejecutar la tarea, Codex
se detuvo con la prueba `Radar mantiene aislamiento integral entre cinco
sucursales` en rojo, y tenía razón: ese archivo compara con `assert.deepEqual`
el objeto **completo** de `/resumen` contra uno que construye a mano en
`resumenEsperado` (línea 50), así que las tres claves nuevas del contrato
aprobado lo rompen. El plan original solo autorizaba la línea 66.

Queda autorizado completar `resumenEsperado` con `conversion_detalle`,
`tasa_recuperacion` y `recuperacion_detalle`, calculadas dentro de la propia
prueba. **Ninguna aserción se modifica** y el propósito de la prueba no cambia:
sigue comprobando que un usuario limitado ve solo su sucursal.

- [ ] **Paso 7: Comprobar que los dos endpoints coinciden**

Agregar al final de `backend/radarDemandaRutas.test.js`:

```js
test("/resumen usa la fórmula aprobada y lo demuestra con su denominador", async () => {
  const r = await pedir("/api/radar-demanda/resumen", { token: tokenAdmin });
  assert.equal(r.status, 200);
  const esperado = (r.cuerpo.por_estado.CONVERTIDA || 0) + (r.cuerpo.por_estado.NO_CONVERTIDA || 0);
  assert.equal(
    r.cuerpo.conversion_detalle.denominador, esperado,
    "el denominador son los cierres decididos, no todos los registros"
  );
  assert.equal(r.cuerpo.conversion_detalle.numerador, r.cuerpo.por_estado.CONVERTIDA || 0);
});
```

Se comprueba la fórmula contra su propio denominador y **no** contra `/analisis`: ese endpoint filtra por rango de fechas (`obtenerAnalisis` usa `fecha_fin = fechaLocal()` por omisión) mientras que `/resumen` no filtra, así que comparar sus números crudos sería una prueba frágil. Lo que el spec exige es que ambos usen la misma fórmula, y eso ya lo garantiza `calcularMetricas`, cubierto por `radarMetricas.test.js`.

- [ ] **Paso 8: Correr toda la suite de Radar**

Correr el mismo comando del Paso 8 de la Tarea 1, agregando `radarMetricas.test.js`.
Esperado: 0 FAIL.

- [ ] **Paso 9: Commit**

```bash
git add backend/radar/metricas.js backend/radarMetricas.test.js backend/radarDemanda.js backend/radarDemandaCincoSucursales.test.js backend/radarDemandaRutas.test.js
git commit -m "fix(radar): una sola formula de conversion para resumen y analisis"
```

El commit debe explicar en el cuerpo que `radarDemandaCincoSucursales.test.js` se corrigió porque recalculaba la fórmula equivocada, no para hacerla pasar.

---

### Tarea 3: CONVERTIDA exige venta, y una venta no recupera dos demandas

**Archivos:**
- Crear: `backend/radar/reglasEstado.js`
- Crear: `backend/radarReglasEstado.test.js`
- Modificar: `backend/radarDemanda.js` (`validarVenta`, `cambiarEstado`, `actualizarDemanda`)
- Modificar: `backend/radarDemandaRutas.test.js` (agregar casos)

**Interfaces:**
- Consume: `ErrorRadar` de la Tarea 1.
- Produce: `exigirVentaParaConvertir(nuevoEstado, ventaId)`; `validarVenta(DB, ventaId, sucursalId, { demandaId })` con el parámetro nuevo.

- [ ] **Paso 1: Escribir la prueba que falla**

Crear `backend/radarReglasEstado.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");

const { crearDemanda, cambiarEstado } = require("./radarDemanda");

function construirDB() {
  return {
    pos: {
      sucursales: [{ id: 1, nombre: "Ocosingo" }],
      vendedores: [{ id: 10, nombre: "Ana", sucursal_id: 1 }],
      ventas: [
        { id: 500, sucursal_id: 1, estatus: "cerrada" },
        { id: 501, sucursal_id: 1, estatus: "cerrada" },
      ],
    },
    admin: { usuarios: [{ id: 100, nombre: "Ana", sucursal_id: 1, vendedor_id: 10, activo: true }] },
    crm: { clientes: [{ id: 0, nombre: "Público en General", sucursal_id: 1 }] },
    "catalogo-productos": { productos: [{ id: 30, sku: "GTR-001", nombre: "Guitarra Roja" }] },
    radar_demanda: { registros: [], seguimientos: [], ultimo_id: 0, ultimo_seguimiento_id: 0 },
  };
}

const contexto = { usuarioId: 100, sucursalId: 1 };
const alcance = { verTodas: true };
const datos = { producto_id: 30, cantidad: 1, motivo_no_venta: "SIN_EXISTENCIA" };

test("no se puede dar por convertida una demanda sin venta", () => {
  const DB = construirDB();
  const demanda = crearDemanda(DB, datos, contexto);
  assert.throws(
    () => cambiarEstado(DB, demanda.id, "CONVERTIDA", {}, alcance, 100),
    /venta/i
  );
  assert.equal(DB.radar_demanda.registros[0].estado, "REGISTRADA", "el estado no debió moverse");
});

test("con su venta sí se convierte", () => {
  const DB = construirDB();
  const demanda = crearDemanda(DB, datos, contexto);
  const cerrada = cambiarEstado(DB, demanda.id, "CONVERTIDA", { venta_recuperada_id: 500 }, alcance, 100);
  assert.equal(cerrada.estado, "CONVERTIDA");
  assert.equal(cerrada.venta_recuperada_id, 500);
});

test("la misma venta no puede recuperar dos demandas", () => {
  const DB = construirDB();
  const primera = crearDemanda(DB, datos, contexto);
  const segunda = crearDemanda(DB, datos, contexto);
  cambiarEstado(DB, primera.id, "CONVERTIDA", { venta_recuperada_id: 500 }, alcance, 100);
  assert.throws(
    () => cambiarEstado(DB, segunda.id, "CONVERTIDA", { venta_recuperada_id: 500 }, alcance, 100),
    /ya est/i
  );
  assert.equal(DB.radar_demanda.registros[1].estado, "REGISTRADA");
});

test("una demanda puede conservar su propia venta al editarse", () => {
  const DB = construirDB();
  const demanda = crearDemanda(DB, datos, contexto);
  cambiarEstado(DB, demanda.id, "CONVERTIDA", { venta_recuperada_id: 501 }, alcance, 100);
  const { actualizarDemanda } = require("./radarDemanda");
  const editada = actualizarDemanda(DB, demanda.id, { notas: "cliente feliz" }, alcance);
  assert.equal(editada.venta_recuperada_id, 501, "su propia venta no es un duplicado");
});

test("NO_CONVERTIDA no necesita venta", () => {
  const DB = construirDB();
  const demanda = crearDemanda(DB, datos, contexto);
  const cerrada = cambiarEstado(DB, demanda.id, "NO_CONVERTIDA", {}, alcance, 100);
  assert.equal(cerrada.estado, "NO_CONVERTIDA");
});
```

- [ ] **Paso 2: Correr la prueba y verificar que falla**

Correr: `node --test radarReglasEstado.test.js`
Esperado: FALLAN al menos "no se puede dar por convertida una demanda sin venta" y "la misma venta no puede recuperar dos demandas".

- [ ] **Paso 3: Escribir las reglas**

Crear `backend/radar/reglasEstado.js`:

```js
const { ErrorRadar } = require("./errores");

/**
 * CONVERTIDA significa que el cliente volvió y compró.
 *
 * Sin venta ligada, "convertida" es una afirmación sin respaldo: inflaría la
 * recuperación sin haber vendido nada. La demanda que no se recuperó tiene su
 * propio estado: NO_CONVERTIDA.
 */
function exigirVentaParaConvertir(nuevoEstado, ventaId) {
  if (nuevoEstado === "CONVERTIDA" && (ventaId === null || ventaId === undefined)) {
    throw new ErrorRadar(
      "Para dar por convertida la demanda hay que ligar la venta con la que se recuperó",
      400
    );
  }
  return ventaId;
}

/**
 * Una venta no puede figurar como recuperación de dos demandas distintas: se
 * contaría dos veces en los indicadores.
 */
function exigirVentaNoUsada(registros, ventaId, demandaId) {
  if (ventaId === null || ventaId === undefined) return ventaId;
  const ocupada = registros.find(
    (item) => Number(item.venta_recuperada_id) === Number(ventaId) && item.id !== demandaId
  );
  if (ocupada) {
    throw new ErrorRadar(
      `Esa venta ya está ligada a la demanda ${ocupada.id}`,
      409
    );
  }
  return ventaId;
}

module.exports = { exigirVentaParaConvertir, exigirVentaNoUsada };
```

- [ ] **Paso 4: Conectarlas en el dominio**

En `backend/radarDemanda.js`:

1. Agregar: `const { exigirVentaParaConvertir, exigirVentaNoUsada } = require("./radar/reglasEstado");`

2. Ampliar `validarVenta` para que también compruebe la unicidad. Sustituir la función completa (líneas 182-190) por:

```js
function validarVenta(DB, ventaId, sucursalId, opciones = {}) {
  const id = enteroOpcional(ventaId, "La venta recuperada");
  if (id == null) return null;
  const venta = (DB.pos?.ventas || []).find((item) => item.id === id);
  if (!venta || Number(venta.sucursal_id) !== Number(sucursalId)) {
    throw new Error("Venta recuperada no encontrada");
  }
  const radar = normalizarRadarDemanda(DB);
  exigirVentaNoUsada(radar.registros, id, opciones.demandaId ?? null);
  return id;
}
```

3. En `cambiarEstado`, sustituir el bloque de la venta:

```js
  const incluyeVenta = datos && Object.prototype.hasOwnProperty.call(datos, "venta_recuperada_id");
  const ventaRecuperadaId = incluyeVenta
    ? validarVenta(DB, datos.venta_recuperada_id, demanda.sucursal_id)
    : demanda.venta_recuperada_id;
```

por:

```js
  const incluyeVenta = datos && Object.prototype.hasOwnProperty.call(datos, "venta_recuperada_id");
  const ventaRecuperadaId = incluyeVenta
    ? validarVenta(DB, datos.venta_recuperada_id, demanda.sucursal_id, { demandaId: demanda.id })
    : demanda.venta_recuperada_id;
  exigirVentaParaConvertir(nuevoEstado, ventaRecuperadaId);
```

**Importante:** `exigirVentaParaConvertir` va **después** de calcular la venta y **antes** de tocar `demanda.estado`, para que una demanda rechazada no quede a medias.

4. En `actualizarDemanda`, pasar la propia demanda para que su venta no se lea como duplicada:

```js
  candidato.venta_recuperada_id = validarVenta(
    DB, candidato.venta_recuperada_id, demanda.sucursal_id, { demandaId: demanda.id }
  );
```

- [ ] **Paso 5: Correr la prueba y verificar que pasa**

Correr: `node --test radarReglasEstado.test.js`
Esperado: PASA, 5 pruebas.

- [ ] **Paso 6: Prueba de ruta**

Agregar al final de `backend/radarDemandaRutas.test.js`:

```js
test("la API rechaza cerrar como CONVERTIDA sin venta", async () => {
  const creada = await pedir("/api/radar-demanda", {
    token: tokenS1, method: "POST", body: demandaValida(),
  });
  const r = await pedir(`/api/radar-demanda/${creada.cuerpo.id}`, {
    token: tokenS1, method: "PATCH", body: { estado: "CONVERTIDA" },
  });
  assert.equal(r.status, 400);
  assert.match(r.cuerpo.error, /venta/i);
});
```

- [ ] **Paso 7: Correr toda la suite de Radar**

Mismo comando de la Tarea 1 más `radarMetricas.test.js` y `radarReglasEstado.test.js`.
Esperado: 0 FAIL.

**Atención:** si alguna prueba existente daba por convertida una demanda sin venta, **no la cambies**. Detente e informa: es una decisión de negocio, no un detalle técnico.

- [ ] **Paso 8: Commit**

```bash
git add backend/radar/reglasEstado.js backend/radarReglasEstado.test.js backend/radarDemanda.js backend/radarDemandaRutas.test.js
git commit -m "fix(radar): convertida exige su venta y una venta no recupera dos demandas"
```

---

### Tarea 4: CRM con dato crudo — de dónde vino y si de verdad compró

**Archivos:**
- Crear: `backend/radar/vinculoCrm.js`
- Crear: `backend/radarVinculoCrm.test.js`
- Modificar: `backend/clientes.js` (`crearCliente`, para que conserve `origen`)
- Modificar: `backend/radarDemanda.js` (`crearDemandaConCRM`, para mandar `origen: "radar"`)
- Modificar: `backend/crm.js` (`listarClientesCRM` y el conteo de convertidos de la línea 187)
- Modificar: `backend/crm.test.js` si existe y cubre convertidos

**Interfaces:**
- Consume: `booleanoEstricto` (Tarea 1).
- Produce: campo `origen` en el cliente; campo derivado `ya_compro` en la lista enriquecida del CRM.

- [ ] **Paso 1: Escribir la prueba que falla**

Crear `backend/radarVinculoCrm.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");

const { crearDemandaConCRM } = require("./radarDemanda");

function construirDB() {
  return {
    pos: {
      sucursales: [{ id: 1, nombre: "Ocosingo" }],
      vendedores: [{ id: 10, nombre: "Ana", sucursal_id: 1 }],
      ventas: [],
    },
    admin: { usuarios: [{ id: 100, nombre: "Ana", sucursal_id: 1, vendedor_id: 10, activo: true }] },
    crm: { clientes: [{ id: 0, nombre: "Público en General", sucursal_id: 1 }] },
    "catalogo-productos": { productos: [{ id: 30, sku: "GTR-001", nombre: "Guitarra Roja" }] },
    radar_demanda: { registros: [], seguimientos: [], ultimo_id: 0, ultimo_seguimiento_id: 0 },
  };
}

const contexto = { usuarioId: 100, sucursalId: 1 };

test("el prospecto que entra por Radar queda marcado como tal", () => {
  const DB = construirDB();
  crearDemandaConCRM(DB, {
    producto_id: 30, cantidad: 1, motivo_no_venta: "SIN_EXISTENCIA",
    intencion_compra: true, consentimiento_aviso: true,
    nombre_contacto: "María López", telefono_contacto: "9612223344",
  }, contexto);
  const nuevo = DB.crm.clientes[1];
  assert.equal(nuevo.origen, "radar");
  assert.equal(nuevo.estado, "interesado");
});

test("a un cliente que ya existía no se le inventa un origen", () => {
  const DB = construirDB();
  DB.crm.clientes.push({
    id: 7, nombre: "Cliente Viejo", celular: "9613334455", sucursal_id: 1, estado: "contactado",
  });
  crearDemandaConCRM(DB, {
    producto_id: 30, cantidad: 1, motivo_no_venta: "SIN_EXISTENCIA",
    intencion_compra: true, consentimiento_aviso: true,
    nombre_contacto: "Cliente Viejo", telefono_contacto: "9613334455",
  }, contexto);
  assert.equal(DB.crm.clientes.length, 2, "no debió crear otro");
  assert.equal(DB.crm.clientes[1].origen, undefined);
});
```

- [ ] **Paso 2: Correr la prueba y verificar que falla**

Correr: `node --test radarVinculoCrm.test.js`
Esperado: FALLA la primera con `undefined !== "radar"`.

- [ ] **Paso 3: Que el cliente conserve su origen**

En `backend/clientes.js`, dentro del objeto que arma `crearCliente`, agregar junto a `estado`:

```js
    origen: datos.origen || "",
```

- [ ] **Paso 4: Que Radar lo mande**

En `backend/radarDemanda.js`, en `crearDemandaConCRM`, en la llamada a `crearCliente`, agregar el campo:

```js
        clienteId = crearCliente(DB, {
          nombre, representante: nombre, celular: telefono, sucursal_id: sucursalId,
          vendedor_asignado_id: usuario.vendedor_id, estado: "interesado",
          origen: "radar",
        }).id;
```

- [ ] **Paso 5: Correr la prueba y verificar que pasa**

Correr: `node --test radarVinculoCrm.test.js`
Esperado: PASA, 2 pruebas.

- [ ] **Paso 6: Que "ya compró" salga de las ventas, no de la etiqueta**

En `backend/crm.js`:

1. En `listarClientesCRM`, donde ya se calcula `const compras = comprasDeCliente(DB, c.id);` (línea 91), agregar al objeto que devuelve:

```js
      ya_compro: compras.length > 0,
      origen: c.origen || "",
```

2. En el resumen por sucursal (línea 187), sustituir:

```js
convertidos: cs.filter((c) => c.estado === "compro").length
```

por:

```js
convertidos: cs.filter((c) => comprasDeCliente(DB, c.id).length > 0).length
```

- [ ] **Paso 7: Prueba de que el dato es crudo**

Agregar a `backend/radarVinculoCrm.test.js`:

```js
const { listarClientesCRM } = require("./crm");

test('"ya compró" sale de las ventas, no de la etiqueta', () => {
  const DB = construirDB();
  DB.crm.clientes.push(
    { id: 7, nombre: "Dice que compró", sucursal_id: 1, estado: "compro" },
    { id: 8, nombre: "Sí compró", sucursal_id: 1, estado: "interesado" }
  );
  DB.pos.ventas.push({ id: 900, cliente_id: 8, sucursal_id: 1, estatus: "cerrada", fecha: "2026-08-01", total: 100 });

  const lista = listarClientesCRM(DB, { verTodas: true });
  const etiquetado = lista.find((c) => c.id === 7);
  const real = lista.find((c) => c.id === 8);

  assert.equal(etiquetado.ya_compro, false, "la etiqueta no basta");
  assert.equal(real.ya_compro, true, "la venta sí");
});
```

Si `listarClientesCRM` necesita más campos en el DB de prueba (por ejemplo `DB.pos.ventas[].productos`), completarlos siguiendo lo que ya usan las pruebas de CRM existentes.

- [ ] **Paso 8: Correr la suite completa del backend**

Correr desde `backend/`: `npm test`

Esperado: los únicos fallos permitidos son los 5 de entorno ya documentados (4 de `clavesSat` por falta de `datos.sqlite`, 1 de `arranquePersistencia` por el worktree). **Cualquier otro fallo se investiga; no se ajusta la prueba.**

Atención especial a las pruebas de CRM: el conteo de convertidos cambia a propósito. Si una prueba de CRM esperaba el conteo por etiqueta, **detente e informa** en vez de cambiarla.

- [ ] **Paso 9: Commit**

```bash
git add backend/radar/vinculoCrm.js backend/radarVinculoCrm.test.js backend/clientes.js backend/radarDemanda.js backend/crm.js
git commit -m "feat(radar): el CRM distingue de donde vino el cliente y si de verdad compro"
```

Si al terminar la tarea el archivo `backend/radar/vinculoCrm.js` no llegó a hacer falta porque la lógica quedó en `radarDemanda.js`, **no lo crees vacío**: quítalo de la lista del commit y anótalo en el informe.

---

### Tarea 5: Las capas que faltan y la fachada

**Archivos:**
- Crear: `backend/radar/modelo.js`
- Crear: `backend/radar/consultas.js`
- Modificar: `backend/radarDemanda.js` (queda como fachada)

**Interfaces:**
- Consume: todo lo anterior.
- Produce: `radarDemanda.js` sigue exportando **exactamente** las mismas 17 claves que hoy: `MOTIVOS_DEMANDA`, `ESTADOS_DEMANDA`, `TRANSICIONES_PERMITIDAS`, `normalizarRadarDemanda`, `crearDemanda`, `crearDemandaConCRM`, `listarDemandas`, `obtenerDemanda`, `actualizarDemanda`, `agregarSeguimiento`, `cambiarEstado`, `obtenerHistorial`, `obtenerResumen`, `obtenerAnalisis`, `enriquecerDemanda`, `enriquecerHistorial`, `listarVentasCandidatas`.

Esta tarea **no cambia comportamiento**. Es la única del plan donde la prueba de que salió bien es que **nada** cambió.

- [ ] **Paso 1: Anotar el contrato antes de mover nada**

Correr desde `backend/`:

```bash
node -e "const e=Object.keys(require('./radarDemanda')).sort(); console.log(e.length); console.log(e.join(','))"
```

Esperado: `17` y la lista de nombres. Anotar esa salida: es contra lo que se compara al final del Paso 7.

- [ ] **Paso 2: Mover el modelo**

Crear `backend/radar/modelo.js` con, movidas **tal cual** desde `radarDemanda.js`: `MOTIVOS_DEMANDA`, `ESTADOS_DEMANDA`, `TRANSICIONES_PERMITIDAS`, `CAMPOS_INMUTABLES`, `CAMPOS_EDITABLES`, `normalizarRadarDemanda`, `copiar`, `texto`, `siguienteId`.

Exportarlas todas. En `radarDemanda.js`, sustituir las definiciones por el `require` correspondiente.

- [ ] **Paso 3: Correr toda la suite de Radar**

Mismo comando de la Tarea 3.
Esperado: 0 FAIL. **Si algo falla, el movimiento cambió comportamiento: revertir y revisar.**

- [ ] **Paso 4: Commit del modelo**

```bash
git add backend/radar/modelo.js backend/radarDemanda.js
git commit -m "refactor(radar): mover el modelo del registro a su propia capa"
```

- [ ] **Paso 5: Mover las consultas**

Crear `backend/radar/consultas.js` con: `estaDentroDeAlcance`, `buscarRegistro`, `listarDemandas`, `obtenerDemanda`, `listarVentasCandidatas`.

En `radarDemanda.js`, sustituir por el `require` y reexportar desde la fachada.

- [ ] **Paso 6: Correr toda la suite de Radar**

Esperado: 0 FAIL.

- [ ] **Paso 7: Verificar que el contrato no se movió**

```bash
node -e "const esperado='ESTADOS_DEMANDA,MOTIVOS_DEMANDA,TRANSICIONES_PERMITIDAS,actualizarDemanda,agregarSeguimiento,cambiarEstado,crearDemanda,crearDemandaConCRM,enriquecerDemanda,enriquecerHistorial,listarDemandas,listarVentasCandidatas,normalizarRadarDemanda,obtenerAnalisis,obtenerDemanda,obtenerHistorial,obtenerResumen'; const real=Object.keys(require('./radarDemanda')).sort().join(','); console.log(real===esperado?'CONTRATO INTACTO':'CAMBIO:\n'+real)"
```

Esperado: `CONTRATO INTACTO`. Si imprime otra cosa, la fachada perdió o ganó exportaciones: corregir antes de seguir.

- [ ] **Paso 8: Commit de las consultas**

```bash
git add backend/radar/consultas.js backend/radarDemanda.js
git commit -m "refactor(radar): mover listados y alcance a su propia capa"
```

- [ ] **Paso 9: Cierre**

Correr desde `backend/`: `npm test`
Esperado: solo los 5 fallos de entorno documentados.

Correr desde la raíz del worktree: `npm install && npm run build`
Esperado: build PASS. (El frontend no se tocó; esto comprueba que sigue compilando.)

Verificar y reportar:

```bash
git status --short --untracked-files=all
git diff --check
git log --oneline 6bd5836..HEAD
```

---

## Entrega esperada al terminar

- archivos creados y modificados, uno por uno;
- conteo de pruebas antes (193) y después, por archivo;
- resultado de `npm test` completo, con los 5 fallos de entorno identificados por nombre;
- resultado de `npm run build`;
- `node --check` de cada archivo nuevo;
- `git diff --check`, `git diff --stat`, `git status`;
- la comparación de exportaciones de la Tarea 5;
- qué pruebas se corrigieron y **por qué el comportamiento que fijaban estaba mal**;
- riesgos y cualquier cosa donde el plan se haya quedado corto.

## Lo que NO entra en este plan

- Fase B: detector de llegada de mercancía y aviso automático por WhatsApp.
- Fase C: pedido especial / express.
- Cualquier cambio en `src/**`.
- Merge, push o despliegue.
