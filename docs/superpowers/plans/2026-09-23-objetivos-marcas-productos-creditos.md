# Mi Objetivo de Venta — Entrega 2b: metas de marca, producto y crédito — Plan (parte servidor)

> **Para quien implementa:** trabaja tarea por tarea, en orden, con TDD. Cada tarea termina con sus
> pruebas en verde y se detiene para que Claude la revise y la commitee. Los pasos usan casillas.

**Objetivo:** que el gerente fije metas de tienda por **marca** (pesos), por **producto** (piezas) y por
**crédito** (Coppel Pay / Atrato, en número de créditos), las reparta entre su plantilla; que cada
persona capture a mano lo suyo; y que el cierre de mes lo cruce contra lo real y lo selle.

**Esta parte cubre SOLO el servidor** (Tasks 1–6). Las pantallas se hacen después, junto con el
rediseño visual de "Mi Objetivo de Venta" que está en análisis, para no construirlas dos veces.

**Spec de origen:** `docs/superpowers/specs/2026-09-13-mi-objetivo-de-venta-design.md` (en el repo
principal, sin trackear; ruta absoluta
`C:/Users/Victor/Desktop/CORPUNISOUND/docs/superpowers/specs/2026-09-13-mi-objetivo-de-venta-design.md`).
Lee "Decisiones de Victor" (sobre todo la 14), "Lo verificable y lo declarado no valen igual" y "El
sello tiene que congelar TODO". **Este plan manda donde difieran.**

**Referencia de estilo:** la entrega 2a (actividades) ya está en `master`. Copia sus patrones:
`backend/objetivos.js` (metas con `tipo` + `actividad`), `backend/objetivosActividades.js`
(registros con anular y validación de fecha/plantilla), `backend/objetivosCierre.js` y las rutas
`/api/objetivos` de `backend/server.js`. Plan anterior:
`docs/superpowers/plans/2026-09-22-objetivos-actividades.md`.

## Restricciones globales

- **Ninguna dependencia nueva.** No toques ningún `package.json` ni lock.
- **Nada se borra.** Lo equivocado se corrige o se anula con motivo, y queda visible.
- **El mes cerrado no se toca:** toda escritura pasa por `validarMesObjetivosAbierto`.
- **La identidad sale del token y del registro original**, nunca del cuerpo. Solo la propia persona
  captura, corrige o anula lo suyo (igual que la venta y las actividades).
- **Alcance por sucursal** igual que las rutas existentes. Fuera de alcance: **404**, nunca 403.
- **El selector de tienda del encabezado NO es un permiso**: nunca decidas con `?sucursal_id=`.
- **Ids del cuerpo pueden llegar como texto**: normaliza con `idDeObjetivos` / `Number(...)`.
- **Compatibilidad:** los registros ya guardados en producción (metas de venta y de actividad,
  capturas de venta, cierres) no tienen los campos nuevos. Todo debe seguir funcionando igual con
  ellos. Cada tarea lleva una prueba explícita con un registro "viejo".
- **Acentos en UTF-8 correcto** (nada de `Ã¡`, `Ã³`, `Â·`). Ninguna línea de más de 200 caracteres.

## Decisiones de Victor (2026-09-23) — no las re-decidas

1. **Marcas y productos salen de listas propias del módulo de objetivos**, no del catálogo de
   productos (en producción el catálogo aún no está cargado). El gerente **elige de la lista**, nunca
   escribe a mano. Dar de alta o desactivar un elemento de la lista exige `editar_objetivos_venta`
   **y** `ver_todas_las_sucursales` (un gerente de una sola tienda no puede). **Nunca se borran**: se
   desactivan; lo ya capturado conserva su nombre.
2. **Meta de marca: en PESOS.** Meta de tienda por marca, repartida entre la plantilla igual que la
   de venta. **Captura manual diaria**: junto a su venta del día, la persona anota cuántos pesos
   fueron de cada marca.
3. **Candado de marca:** la suma de lo capturado por marcas de una persona en un día **nunca puede
   pasar su venta vigente de ese día**. Aplica al capturar marca, al corregir marca, y al **corregir la
   venta a la baja** (si la venta corregida quedaría debajo de lo ya capturado en marcas, se rechaza
   con un mensaje que dice que primero corrija las marcas). Para capturar una marca de un día, antes
   debe existir la captura de venta de ese día.
4. **Meta de producto: en PIEZAS** (enteros ≥ 0). Misma mecánica que la marca (lista propia, meta de
   tienda repartida, captura manual diaria por producto), **sin** candado contra la venta en pesos.
   Ejemplo de elementos de la lista: "Teclados", "Guitarras eléctricas".
5. **Meta de crédito: en NÚMERO DE CRÉDITOS**, Coppel Pay y Atrato **por separado** (claves fijas
   `coppel_pay` y `atrato`). Meta de tienda por financiera, repartida.
6. **Qué cuenta como crédito:** una venta financiada aprobada, registrada **una por una** por la
   persona con: financiera, fecha, monto (> 0) y **folio de la financiera** (obligatorio), nota
   opcional. **El mismo folio de la misma financiera no puede estar vigente dos veces en toda la
   empresa**, en ningún mes (folio normalizado: sin espacios, en mayúsculas). Un crédito equivocado se
   **anula con motivo**; anulado deja de contar y su folio se libera.
7. **Cierre:** además del real de SICAR de la venta, la administradora teclea por persona:
   - el real de SICAR **por marca** (pesos),
   - el real de SICAR **por producto** (piezas),
   - el real **por financiera** (número de créditos que reporta Coppel Pay / Atrato).
   Es **obligatorio** para cada marca/producto/financiera en que esa persona tenga meta vigente o
   algo capturado ese mes. Se guarda la diferencia de cada uno, se sella todo y se puede rectificar
   después con motivo, igual que la venta.
8. **Fuera de este plan:** Coppel Pay y Atrato como forma de pago del punto de venta (sigue
   aplazado); ligar marcas/productos al catálogo; las pantallas (van con el rediseño).

## Coordenadas

- **Worktree, único lugar donde escribes:** `C:/Users/Victor/Desktop/CORPUNISOUND/.claude/worktrees/objetivos-marcas`
- **Rama:** `feature/objetivos-marcas-creditos` · **Commit base:** el commit de este plan, sobre `54b5dbc`.
- **Pruebas, SIEMPRE por archivo** (la suite completa la corre Claude):
  `node --preserve-symlinks --preserve-symlinks-main --test backend/<archivo>.test.js`
- **No commitees**, no `git add`, no `stash`, no push/merge/rebase. Claude commitea por rutas.

### Archivos autorizados

- Crear: `backend/objetivosCatalogos.js` (+ `.test.js`), `backend/objetivosCreditos.js` (+ `.test.js`),
  `backend/objetivosFechas.js` (+ `.test.js`), `backend/objetivosMarcasRutas.test.js`.
- Modificar: `backend/objetivos.js`, `backend/objetivos.test.js`, `backend/objetivosCaptura.js`,
  `backend/objetivosCaptura.test.js`, `backend/objetivosActividades.js` (solo para usar
  `objetivosFechas.js`), `backend/objetivosActividades.test.js`, `backend/objetivosCierre.js`,
  `backend/objetivosCierre.test.js`, `backend/server.js` (solo colecciones por defecto, `require` y
  rutas `/api/objetivos`), `backend/objetivosRutas.test.js`.

### Prohibidos

Todo lo demás, en particular `backend/auth.js`, `backend/roles.js`, `backend/permisosCatalogo.js`
(**no hace falta permiso nuevo**), `backend/persistencia.js`, `backend/ventas.js`,
`backend/condicionesPago.js`, `backend/cortes.js`, `src/**`, `render.yaml`.

### Detente y reporta si

- necesitas un archivo no autorizado o una dependencia;
- una decisión de negocio no está escrita aquí;
- una prueba existente contradice este plan (dilo; no la cambies por tu cuenta);
- el código real no coincide con lo que describe el plan.

---

## Modelo de datos

**Llave de una meta.** Hoy una meta es `{ tipo, actividad, mes, sucursal_id, vendedor_id }`. Se
agrega una sola llave genérica para lo nuevo:

| tipo | campo de referencia | unidad del `monto` |
|---|---|---|
| `venta` | (ninguno) | pesos, finito ≥ 0 |
| `actividad` | `actividad` (clave del catálogo, ya existe) | entero ≥ 0 |
| `marca` | `marca_id` (id de `DB.pos.objetivo_marcas`) | pesos, finito ≥ 0 |
| `producto` | `producto_meta_id` (id de `DB.pos.objetivo_productos`) | entero ≥ 0 |
| `credito` | `financiera` (`"coppel_pay"` o `"atrato"`) | entero ≥ 0 |

Un campo de referencia que no corresponde al tipo debe venir `null`/ausente; si viene, error.
Registros viejos sin esos campos equivalen a `null`.

**Colecciones nuevas** (default `[]` en `server.js`, junto a `objetivo_actividades`):
`objetivo_marcas`, `objetivo_productos`, `objetivo_creditos`.

---

### Task 1: Listas de marcas y productos

**Archivos:** crear `backend/objetivosCatalogos.js` y su prueba.

**Interfaz:**
```js
function listarElementos(DB, lista, { incluirInactivos = false } = {})  // lista: "marcas" | "productos"
function altaElemento(DB, lista, { nombre }, usuario)                  // -> elemento
function desactivarElemento(DB, lista, id, { motivo }, usuario)        // -> elemento
function elementoActivo(DB, lista, id)                                 // -> elemento o null
```
Elemento: `{ id, nombre, activo, creado_por, creado_en, desactivado_por, desactivado_en, motivo_desactivacion }`.

**Reglas:** nombre recortado, 1–60 caracteres; **no se permiten dos activos con el mismo nombre**
comparando sin acentos, sin mayúsculas y con espacios colapsados ("Yamaha", " yamaha ", "YAMAHA"
son el mismo); desactivar exige motivo y no se puede desactivar dos veces; reactivar **no** existe en
este plan (se da de alta de nuevo si hace falta y el nombre ya no choca con uno activo);
`lista` distinta de `"marcas"`/`"productos"` → error. Lectura no muta.

- [ ] Pruebas rojas: alta; duplicado por mayúsculas/acentos/espacios rechazado; nombre vacío y de
  61 caracteres rechazados; desactivar con y sin motivo; desactivado no aparece en la lista normal y
  sí con `incluirInactivos`; listar no modifica DB.
- [ ] Implementa, verde, detente y reporta.

---

### Task 2: Metas de marca, producto y crédito

**Archivos:** `backend/objetivos.js`, `backend/objetivos.test.js`.

**Cambios:**
- `fijarObjetivo` acepta los tipos `marca`, `producto`, `credito` con su campo de referencia y la
  unidad de la tabla. `marca_id` / `producto_meta_id` deben existir **y estar activos** al fijar la meta.
  `financiera` solo `coppel_pay` o `atrato`.
- `mismaCombinacion` compara también `marca_id`, `producto_meta_id` y `financiera` (con `?? null`).
- `objetivoVigente`, `historialObjetivo`, `repartoSugerido`, `estadoDelReparto` aceptan los campos
  nuevos. `repartoSugerido` reparte en **enteros** para `producto`/`credito` (como actividad) y en
  pesos con `Math.floor` para `marca` (como venta; conserva el total).
- Recomendación: una función interna `llaveDeMeta(datos)` que normalice y valide la llave, usada por
  todas; así no se desalinean.

- [ ] Pruebas rojas: cada tipo nuevo se guarda con su referencia; metas de distinta marca / producto /
  financiera no se reemplazan entre sí ni a la de venta/actividad; referencia de otro tipo rechazada
  (`tipo: "marca"` con `financiera`, `tipo: "venta"` con `marca_id`); marca inexistente o desactivada
  rechazada; `producto` y `credito` con monto decimal rechazados; `marca` acepta decimales; reparto
  sugerido conserva el total en los tres; **una meta de venta y una de actividad guardadas sin los
  campos nuevos siguen siendo las vigentes**.
- [ ] Implementa, verde (`objetivos.test.js` y, con las mismas banderas, `objetivosActividades.test.js`,
  `objetivosCierre.test.js`, `objetivosRutas.test.js`), detente y reporta.

---

### Task 3: Captura diaria de marca y producto

**Archivos:** crear `backend/objetivosFechas.js` (+ prueba); modificar `backend/objetivosCaptura.js`,
`backend/objetivosCaptura.test.js`, `backend/objetivosActividades.js`.

**`objetivosFechas.js`:** mueve aquí la validación de fecha + plantilla que hoy está repetida en
`objetivosCaptura.js` (`validarDatosCaptura`) y en `objetivosActividades.js`
(`validarFechaYPlantilla`), y haz que **las dos la usen**. Los mensajes de error no cambian. Las
pruebas existentes de captura y de actividades deben seguir verdes **sin tocarlas**.

**Captura:** `capturarDia` y `corregirCaptura` aceptan:
- `tipo: "marca"` con `marca_id` y `monto` en pesos (finito ≥ 0);
- `tipo: "producto"` con `producto_meta_id` y `monto` en piezas (entero ≥ 0).
La marca/producto debe estar **activa** al capturar (al corregir basta con que exista).
**Una captura vigente por persona + día + tipo + referencia** (hoy la unicidad es persona + día + tipo;
agrega la referencia sin romper la de venta).

**Candado de marca (decisión 3):**
- capturar/corregir marca: `suma de marcas vigentes del día (con el nuevo valor) ≤ venta vigente del
  día`; si no hay captura de venta ese día → error "Primero captura tu venta de ese día".
- corregir **venta**: si el nuevo monto < suma de marcas vigentes del día → error
  "Tu venta quedaría por debajo de lo que ya capturaste por marca; corrige primero las marcas".
- `capturadoDelMes` sigue devolviendo **solo venta** cuando no se le pide otro tipo (compatibilidad).
  Agrega `capturadoDelMesPor(DB, { mes, sucursal_id, vendedor_id, tipo, marca_id, producto_meta_id })`.
- `diasSinCapturar` sigue siendo **solo de venta**.

- [ ] Pruebas rojas: marca con venta del día; marca sin venta del día rechazada; dos marcas que juntas
  pasan la venta rechazadas; corregir marca hacia arriba sobre la venta rechazado; corregir venta a la
  baja debajo de las marcas rechazado y sin mutar nada; producto en piezas (decimal rechazado);
  unicidad por referencia (Yamaha y Casio el mismo día sí; Yamaha dos veces no); marca desactivada no
  se puede capturar; capturas de venta viejas (sin campos nuevos) siguen contando en
  `capturadoDelMes` y en la unicidad; un traslado entre tiendas sigue funcionando.
- [ ] Implementa, verde (`objetivosCaptura.test.js`, `objetivosFechas.test.js`,
  `objetivosActividades.test.js`), detente y reporta.

---

### Task 4: Créditos Coppel Pay y Atrato

**Archivos:** crear `backend/objetivosCreditos.js` y su prueba.

**Interfaz:**
```js
const FINANCIERAS = [{ clave: "coppel_pay", etiqueta: "Coppel Pay" }, { clave: "atrato", etiqueta: "Atrato" }];
function registrarCredito(DB, { mes, fecha, sucursal_id, vendedor_id, financiera, folio, monto, nota }, usuario)
function anularCredito(DB, id, motivo, usuario)
function creditosDelMes(DB, { mes, sucursal_id, vendedor_id? })    // vigentes y anulados
function resumenCreditos(DB, { mes, sucursal_id, vendedor_id? })   // [{ financiera, etiqueta, registrados }] solo vigentes
```
Registro: `{ id, mes, fecha, sucursal_id, vendedor_id, financiera, folio, monto, nota, registrado_por,
registrado_en, vigente, anulado_por, anulado_en, motivo_anulacion }`.

**Reglas:** fecha/mes/plantilla con `objetivosFechas.js`; financiera solo de `FINANCIERAS`; folio
obligatorio, normalizado (`trim`, sin espacios internos, mayúsculas), 3–40 caracteres; monto finito
> 0; nota ≤ 300; **folio + financiera único entre VIGENTES de toda la empresa y de cualquier mes** (el
mensaje dice quién lo registró y qué día; si fue de otra tienda, solo dice "ya registrado en otra
tienda"); anular exige motivo; anulado no cuenta y libera el folio.

- [ ] Pruebas rojas: registro válido con folio normalizado (`" cp 123 "` → `"CP123"`); mismo folio
  otra persona rechazado; mismo folio otra financiera aceptado; mismo folio otra tienda rechazado sin
  nombre; folio de un mes anterior rechazado; tras anular, el folio se puede volver a registrar;
  financiera inválida, monto 0/negativo/NaN/Infinity y folio vacío rechazados; fecha futura y persona
  fuera de plantilla rechazadas; resumen cuenta solo vigentes.
- [ ] Implementa, verde, detente y reporta.

---

### Task 5: Rutas HTTP

**Archivos:** `backend/server.js`, crear `backend/objetivosMarcasRutas.test.js` (copia el arranque de
servidor real de `backend/objetivosActividadesRutas.test.js`), `backend/objetivosRutas.test.js`.

**Colecciones por defecto:** `objetivo_marcas`, `objetivo_productos`, `objetivo_creditos` (prueba que
una base guardada sin ellas arranca con `[]`).

**Rutas nuevas** (declara las de un solo segmento ANTES de `GET /api/objetivos/:mes/:sucursalId`):
- `GET /api/objetivos/catalogo/:lista` (`marcas` | `productos`, `?inactivos=1` solo para quien puede
  administrarlas) — permiso `usar_gerente_ventas` o `editar_objetivos_venta`.
- `POST /api/objetivos/catalogo/:lista` y `POST /api/objetivos/catalogo/:lista/:id/desactivar` —
  `editar_objetivos_venta` **y** alcance global (`requiereAlcanceGlobal`, ya existe en `auth.js`); sin
  alcance global → 404.
- `GET /api/objetivos/financieras` → `FINANCIERAS`.
- `POST /api/objetivos/credito`, `POST /api/objetivos/credito/:id/anular` — solo la propia persona,
  mes abierto; identidad y tienda del registro original al anular.
- `GET /api/objetivos/:mes/:sucursalId/creditos/:vendedorId` → `{ registros, resumen }`, mismo
  control de acceso que `.../capturas/:vendedorId`.
- `GET /api/objetivos/:mes/:sucursalId/creditos` → lista de tienda, solo jefatura o cierre con alcance.

**Rutas existentes que cambian:**
- `POST /api/objetivos` acepta los tipos nuevos (motivo obligatorio al cambiar una existente, igual).
- `historial` y `sugerencia` aceptan `?tipo=marca&marca_id=…`, `?tipo=producto&producto_meta_id=…`,
  `?tipo=credito&financiera=…` (validados como en actividades).
- `GET /api/objetivos/:mes/:sucursalId` agrega `marcas`, `productos` y `creditos` con el mismo
  formato que ya tiene `actividades` (por elemento: `meta_tienda`, `asignado`, `sin_asignar`,
  `lineas`), **solo de elementos con meta de tienda o de persona vigente ese mes**. Para quien no es
  jefatura con alcance: solo sus líneas y sin totales de tienda (igual que venta y actividades).
- `POST /api/objetivos/captura` y `.../captura/:id/corregir` aceptan marca y producto.
- `GET .../capturas/:vendedorId` devuelve también las capturas de marca y producto (el
  `total_capturado` y `dias_sin_capturar` siguen siendo solo de venta; agrega
  `total_por_marca` y `total_por_producto`).

- [ ] Pruebas rojas (servidor real): gerente de una tienda no puede dar de alta marcas (404) y Victor
  sí; vendedor no ve metas de marca de su compañero; ids como texto; `?sucursal_id=` no cambia nada;
  crédito de otro vendedor rechazado; folio duplicado → 400 con mensaje; mes cerrado → 400 en todo lo
  que escribe; `GET /api/objetivos/catalogo/marcas` y `/financieras` no caen en `/:mes/:sucursalId`;
  base sin colecciones nuevas arranca.
- [ ] Implementa, verde (`objetivosMarcasRutas.test.js`, `objetivosRutas.test.js`,
  `objetivosActividadesRutas.test.js`), detente y reporta.

---

### Task 6: El cierre cruza y sella marcas, productos y créditos

**Archivos:** `backend/objetivosCierre.js`, `backend/objetivosCierre.test.js`, rutas de cierre en
`backend/server.js`.

**Cambios:**
- `previoCierre`: participan también quienes tengan meta o captura de marca/producto o créditos
  vigentes. Cada línea gana `marcas: [{ marca_id, nombre, meta, capturado }]`,
  `productos: [{ producto_meta_id, nombre, meta, capturado }]`,
  `creditos: [{ financiera, meta, registrados }]` — solo los elementos con meta o captura de esa
  persona ese mes.
- `cerrarMes(DB, { mes, sucursal_id, reales })`: cada real sigue siendo
  `{ vendedor_id, real_sicar }` y ahora puede traer
  `marcas: [{ marca_id, real }]`, `productos: [{ producto_meta_id, real }]`,
  `creditos: [{ financiera, real }]`. **Obligatorio** para cada elemento que aparezca en el previo de
  esa persona; un elemento que no aparece → error; repetido → error; `real` de marca finito ≥ 0,
  de producto y crédito entero ≥ 0. Cada línea guarda por elemento `meta`, `capturado`/`registrados`,
  `real` y `diferencia` (capturado − real).
- La `foto` agrega `creditos` (todos los del mes/tienda, vigentes y anulados) y los elementos de las
  listas usados ese mes (id y nombre), para que el sello no dependa de una lista que después cambie.
- `rectificarCierre`: además de `meta`, `capturado`, `real_sicar`, acepta rectificar
  `{ campo: "real" | "meta" | "capturado", marca_id | producto_meta_id | financiera }` de un elemento
  existente en la línea; motivo obligatorio; valor anterior leído del cierre; nunca toca `lineas` ni
  `foto`.
- **Compatibilidad:** un cierre viejo sin estos campos se sigue leyendo y rectificando igual.

- [ ] Pruebas rojas: persona con solo créditos aparece y exige sus reales; falta un real de marca →
  error y DB intacta; real de un elemento que no está en el previo → error; diferencias correctas; la
  foto no cambia si después se anula un crédito o se desactiva una marca; rectificar un real de marca
  con motivo; cierre viejo (sin campos nuevos) se rectifica como antes.
- [ ] Implementa, verde (`objetivosCierre.test.js`, `objetivosRutas.test.js`,
  `objetivosMarcasRutas.test.js`), detente y reporta.

---

## Evidencia de entrega (por cada task)

1. Archivos creados/modificados.
2. Salida de los archivos de prueba de esa task (no de la suite completa).
3. Qué pruebas viste en rojo y por qué fallaban.
4. Qué del plan no coincidió con el código real.
5. Confirmación de que no tocaste dependencias ni archivos prohibidos.

## Después de este plan (no es parte de él)

Pantallas de vendedor, gerente (incluida la administración de las listas) y cierre, diseñadas junto
con el rediseño visual; prueba en navegador; revisión independiente; merge de Victor.
