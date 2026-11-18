# Resurtido mín/máx (JR y Solcor) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que el sistema calcule por tienda el mínimo y el máximo de cada producto JR y Solcor, arme solo el pedido
mensual con visto bueno, y avise entre pedidos proponiendo pasar de otra tienda o pedir extra.

**Architecture:** módulo nuevo `backend/resurtido/` con el mismo patrón que `backend/seguimientoFactura/` (config,
lector, cálculo puro, servicio con ciclo nocturno, consultas, rutas) sobre las tablas SICAR que ya llegan del agente.
Tablas propias en el SQLite de SICAR, dentro del respaldo SICAR. Pantalla nueva `src/resurtido/`. Nada se escribe en
SICAR.

**Tech Stack:** Node/Express, better-sqlite3, React/Vite, `node --test`. Sin dependencias nuevas.

**Spec:** `docs/superpowers/specs/2026-11-18-resurtido-minmax-design.md`

## Global Constraints

- Sin dependencias nuevas. Líneas de máximo 200 caracteres en `src/` y `backend/`. Commits sin acentos, staging por
  ruta explícita.
- Tiendas del módulo: 1 Ocosingo, 2 Yajalón, 3 San Cristóbal, 4 Palenque. **Innotec (7) fuera; CEDIS (6) sin
  mín/máx.**
- Marcas: departamento SICAR `'JR'` y `'SOLCOR'` (`sicar_articulos.departamento`, comparación exacta tras `trim()` y
  mayúsculas).
- Producto entre tiendas = **`clave`** (el `art_id` cambia por tienda).
- Cantidades en **diezmilésimas enteras** (como `sicar_existencias.existencia_diezmilesimas`); el cable por metro se
  maneja en metros con la misma unidad.
- Valores por omisión: plazo de entrega **20** días, ciclo de pedido **30** días, nivel de servicio **z = 1.65**,
  ventana de historia **365** días.
- Alcance de tienda **solo del token** (`ver_todas_las_sucursales` o `sucursal_id` del usuario), nunca de
  `?sucursal_id=` (regla 5 de CLAUDE.md). Permisos nuevos en `backend/permisosCatalogo.js`.
- Fechas de día con `fechaLocal()` de `backend/fechas.js`; marcas completas en ISO UTC.
- El sistema **nunca envía** nada al proveedor; **nunca escribe** en SICAR.

## Review Focus

1. **Tienda con agente caído** (existencia de hace días): no debe entrar al pedido con existencia vieja; se marca
   "datos atrasados" y se excluye. Prueba en Task 6 y Task 9.
2. **Dos `art_id` con la misma clave en una tienda**: ventas y existencia se suman bajo la clave, no se pierde una.
   Prueba en Task 3.
3. **Existencia negativa en SICAR**: cuenta como 0 para lo que falta y se marca; nunca infla el pedido. Prueba en
   Task 4 y Task 9.
4. **Producto que dejó de ser JR/Solcor con un ajuste manual vivo**: el ajuste no se borra; la fila sale como "ya no
   es de la marca" y no genera pedido. Prueba en Task 7.
5. **Venta cancelada después de calculada**: solo cuentan ventas `vigente`; el siguiente recálculo la quita. Prueba en
   Task 3.

---

## Entrega 1 — Mínimos y máximos calculados, con pantalla y corrección a mano

### Task 1: Tablas, configuración, permisos y respaldo

**Files:**
- Modify: `backend/sicarRepositorio.js` (bloque de `CREATE TABLE`, junto a las de `seguimiento_*`)
- Modify: `backend/sicarRespaldo.js` (agregar tablas al final de `TABLAS` y una generación nueva)
- Modify: `backend/permisosCatalogo.js`
- Create: `backend/resurtido/config.js`
- Test: `backend/resurtido/config.test.js`, `backend/sicarRespaldo.test.js` (caso nuevo)

**Interfaces:**
- Produces:
  - Tablas: `resurtido_config(clave PK, valor, actor, fecha)`, `resurtido_config_historial(id, clave, anterior, nuevo,
    actor, fecha)`, `resurtido_existencia_diaria(sucursal_id, clave, dia, piezas_diezmilesimas INTEGER, origen TEXT
    CHECK IN ('foto','reconstruida'), PK(sucursal_id, clave, dia))`, `resurtido_minmax(sucursal_id, clave, marca,
    minimo, maximo, venta_diaria_diezmilesimas, dias_validos, dias_en_cero, lista CHECK IN
    ('calculado','sin_historia','no_se_mueve'), calculado_en, PK(sucursal_id, clave))`, `resurtido_ajustes(sucursal_id,
    clave, minimo, maximo, motivo, actor, fecha, PK(sucursal_id, clave))`, `resurtido_ajustes_historial(id,
    sucursal_id, clave, accion CHECK IN ('poner','quitar'), minimo, maximo, motivo, actor, fecha)`. Mínimo y máximo en
    diezmilésimas enteras.
  - `config.js`: `TIENDAS = [1,2,3,4]`, `MARCAS = ['JR','SOLCOR']`, `VALORES_INICIALES = { plazo_dias: 20, ciclo_dias:
    30, z_servicio_centesimas: 165, dias_historia: 365, dias_validos_minimos: 30, proporcion_cero_sin_historia: 80,
    dias_datos_atrasados: 2 }`, `leerConfig(sqlite) -> objeto`, `cambiarConfig(sqlite, cambios, actor, ahora) -> objeto`
    (rangos enteros validados, historial por cambio, igual que `seguimientoFactura/rutas.js` `RANGOS`).
  - Permisos (módulo `inventario`): `ver_resurtido`, `corregir_minimos_resurtido`, `configurar_resurtido`,
    `dar_visto_bueno_resurtido`, `aprobar_pedido_resurtido` (los dos últimos `implementado: false` hasta Entrega 2).

- [ ] **Step 1: Pruebas rojas**: `leerConfig` en base vacía devuelve `VALORES_INICIALES`; `cambiarConfig({plazo_dias:
  0})` lanza 400; `cambiarConfig({plazo_dias: 25})` deja un renglón en historial con anterior `20`; una copia de
  respaldo de la generación anterior (sin tablas `resurtido_*`) se lee y deja las tablas nuevas vacías; una copia nueva
  con `resurtido_ajustes` llenos los restaura.
- [ ] **Step 2:** `cd backend && node --test resurtido/config.test.js sicarRespaldo.test.js` → FAIL.
- [ ] **Step 3:** Implementar. En `sicarRespaldo.js`: las tablas nuevas van **al final** de `TABLAS`; se agrega la
  constante de la generación anterior (`TABLAS` actual) a `GENERACIONES` siguiendo el comentario "cada forma de copia
  que ya existe en Drive se queda escrita tal cual".
- [ ] **Step 4:** Mismo comando → PASS. Arrancar `node server.js` 5 s: el guard de permisos no tumba el arranque.
- [ ] **Step 5:** Commit `feat(resurtido): tablas, configuracion, permisos y respaldo`.

### Task 2: Temporada por marca

**Files:**
- Create: `backend/resurtido/temporada.js`
- Test: `backend/resurtido/temporada.test.js`

**Interfaces:**
- Produces: `indicesTemporada(ventasMensuales: Map<'YYYY-MM', number>, hoyMes: 'YYYY-MM') -> { indices: number[12],
  anios: number }`; `factorPara(indices, mes: 1..12) -> number`.

Regla: solo años calendario **completos** anteriores a `hoyMes`; índice del mes = promedio de ese mes / promedio
mensual general; acotado a **[0.5, 1.5]**; con menos de **2** años completos todos los índices son 1.0 y `anios` dice
cuántos hubo.

- [ ] **Step 1: Pruebas rojas**: con 2022–2025 donde octubre vende 130 y el resto 100 → índice 10 ≈ 1.27 (±0.01);
  un mes con 0 → 0.5 (acotado); solo 2025 completo → todos 1.0, `anios: 1`; el año en curso (2026) no entra.
- [ ] **Step 2–4:** `node --test resurtido/temporada.test.js` FAIL → implementar → PASS.
- [ ] **Step 5:** Commit `feat(resurtido): indices de temporada por marca`.

### Task 3: Lector de ventas y existencias por clave

**Files:**
- Create: `backend/resurtido/lector.js`
- Test: `backend/resurtido/lector.test.js`

**Interfaces:**
- Produces:
  - `clavesDeMarca(sqlite, sucursal_id) -> Map<clave, { marca, descripcion, art_ids: string[] }>` (departamento
    JR/SOLCOR; claves vacías o nulas se omiten y se cuentan en `omitidas`).
  - `ventasDiarias(sqlite, sucursal_id, desde: 'YYYY-MM-DD') -> Map<clave, Map<dia, diezmilesimas>>`: suma
    `sicar_detalles` (unidas a `sicar_ventas` con `estado='vigente'`, día = `fecha_local`) y `sicar_detalles_mostrador`
    (unidas a `sicar_ventas_mostrador` vigente), llevando `art_id` → `clave` con `sicar_articulos` de esa tienda.
  - `existenciaActual(sqlite, sucursal_id) -> { porClave: Map<clave, diezmilesimas>, actualizado: ISO|null }`.
  - `ventasMensualesMarca(sqlite, marca, tiendas) -> Map<'YYYY-MM', number>` (para Task 2, las 4 tiendas juntas).

- [ ] **Step 1: Pruebas rojas** (base con `crearTablas` del repositorio y filas sembradas): dos `art_id` con la misma
  clave suman ventas y existencia; una venta `cancelada` no cuenta; una venta de mostrador y una con cliente el mismo
  día suman; un artículo de departamento `STEREN` no aparece; cantidad `'2.5000'` (metros) da 25000.
- [ ] **Step 2–4:** FAIL → implementar con consultas agrupadas por día (sin traer renglón por renglón a JS) → PASS.
- [ ] **Step 5:** Commit `feat(resurtido): lector de ventas y existencias por clave`.

### Task 4: Existencia diaria (foto nocturna + reconstrucción inicial)

**Files:**
- Create: `backend/resurtido/existenciaDiaria.js`
- Test: `backend/resurtido/existenciaDiaria.test.js`

**Interfaces:**
- Consumes: `clavesDeMarca`, `ventasDiarias`, `existenciaActual` (Task 3).
- Produces:
  - `tomarFoto(sqlite, dia, ahora) -> { tiendas, filas }`: guarda la existencia actual de cada clave de marca como
    `origen='foto'`; no pisa una foto ya tomada ese día.
  - `reconstruir(sqlite, sucursal_id, desde, hasta) -> { filas, rara: number }`: hacia atrás desde la existencia actual,
    día por día: `existencia(d-1) = existencia(d) - entradas(d) + ventas(d) + salidas(d)`, con entradas/salidas de
    traspasos aplicados de esa tienda (origen/destino traducidos con `sicar_sucursales_mapa`, sin contar dos veces el
    mismo traspaso reportado por las dos puntas: deduplicar por `(folio, suc_origen, suc_destino)` como hace
    `seguimientoFactura/lector.js`). Solo escribe días **sin** foto, con `origen='reconstruida'`. `rara` cuenta claves
    que bajan de −2 unidades (señal de ajustes de inventario no vistos); en esas claves se escribe `max(0, valor)`.
  - `diasEnCero(sqlite, sucursal_id, clave, desde, hasta) -> Set<dia>` (existencia ≤ 0 ese día).

- [ ] **Step 1: Pruebas rojas**: existencia hoy 5, venta ayer 3, traspaso recibido anteayer 10 → ayer 8, anteayer
  −2 → 0 con `rara` 0 (−2 no pasa el umbral) y la víspera 0; una foto existente no se pisa; traspaso reportado por
  CEDIS y por la tienda cuenta una vez; existencia negativa hoy se guarda como está pero `diasEnCero` la cuenta.
- [ ] **Step 2–4:** FAIL → implementar → PASS.
- [ ] **Step 5:** Commit `feat(resurtido): existencia diaria por foto y reconstruccion`.

### Task 5: Cálculo puro de mínimo y máximo

**Files:**
- Create: `backend/resurtido/calculo.js`
- Test: `backend/resurtido/calculo.test.js`

**Interfaces:**
- Produces: `calcularMinMax({ ventasPorDia: Map<dia, n>, diasEnCero: Set<dia>, desde, hasta, factor: number,
  config }) -> { minimo, maximo, venta_diaria, dias_validos, dias_en_cero, lista }` (todo en diezmilésimas enteras
  salvo `factor`).

Algoritmo (no lo determinan las firmas):

```
dias = cada día de desde..hasta
valido(d) = !diasEnCero.has(d) || ventas(d) > 0        // si vendió, había
dias_validos = cuenta(valido); total = Σ ventas(d) sobre válidos
si total == 0:
  lista = (dias_en_cero / dias.length * 100 >= proporcion_cero_sin_historia) ? 'sin_historia' : 'no_se_mueve'
  sin_historia -> minimo 1 unidad, maximo 2 unidades; no_se_mueve -> 0 y 0
si dias_validos < dias_validos_minimos -> lista 'sin_historia', mismo 1/2
si no: lista 'calculado'
  d = total / dias_validos;  s = desviación estándar de ventas diarias en días válidos
  minimo = ceilUnidad(d*factor*plazo + z*s*sqrt(plazo));  maximo = minimo + ceilUnidad(d*factor*ciclo)
  minimo >= 1 unidad; maximo >= minimo + 1 unidad
ceilUnidad redondea hacia arriba a unidad entera (10000)
```

- [ ] **Step 1: Pruebas rojas** (con los números de San Cristóbal del spec §3):
  - 73 piezas repartidas parejo en 249 días válidos y 116 en cero, factor 1.0, plazo 20, ciclo 30, z 1.65 →
    `venta_diaria` ≈ 0.293 pz, `minimo` ≥ 6 y ≤ 12, `maximo - minimo` = 9, `dias_en_cero` 116. **Si los 116 días se
    contaran como válidos, el mínimo bajaría:** una segunda aserción lo fija.
  - factor 1.3 (octubre Solcor) sube mínimo y máximo respecto de 1.0 con los mismos datos.
  - sin ventas y 300/365 en cero → `sin_historia`, 1 y 2; sin ventas y 10 en cero → `no_se_mueve`, 0 y 0.
  - metros: ventas de 2.5 m redondean el mínimo hacia arriba a metro entero.
- [ ] **Step 2–4:** FAIL → implementar → PASS.
- [ ] **Step 5:** Commit `feat(resurtido): calculo de minimo y maximo`.

### Task 6: Servicio y ciclo nocturno

**Files:**
- Create: `backend/resurtido/servicio.js`
- Modify: `backend/server.js` (junto al registro del seguimiento, línea ~3296)
- Test: `backend/resurtido/servicio.test.js`

**Interfaces:**
- Consumes: Tasks 2–5.
- Produces: `recalcular(sqlite, ahora) -> { tiendas: [{ sucursal_id, claves, atrasada: bool }], ms }` (por tienda:
  foto del día, reconstrucción la primera vez, cálculo de cada clave, `INSERT OR REPLACE` en `resurtido_minmax`, todo
  en una transacción por tienda); `iniciarCicloResurtido(sqlite)` (una vuelta al arrancar y una por día después de las
  02:00 locales; `setTimeout(...).unref()`; nunca dos a la vez).
- Una tienda cuya `sicar_tiendas.ultima_recepcion` tenga más de `dias_datos_atrasados` días **no se recalcula** y sale
  `atrasada: true` (Review Focus 1).

- [ ] **Step 1: Pruebas rojas**: dos tiendas sembradas → filas en `resurtido_minmax` para las dos; tienda atrasada →
  sin filas nuevas y `atrasada`; segunda corrida el mismo día no duplica fotos; Innotec (7) y CEDIS (6) nunca aparecen.
- [ ] **Step 2–4:** FAIL → implementar → PASS. Medir con 500 claves × 4 tiendas × 365 días sembrados: < 10 s.
- [ ] **Step 5:** Commit `feat(resurtido): recalculo nocturno`.

### Task 7: Consultas, ajustes a mano y rutas

**Files:**
- Create: `backend/resurtido/consultas.js`, `backend/resurtido/rutas.js`
- Modify: `backend/server.js`
- Test: `backend/resurtido/consultas.test.js`, `backend/resurtido/rutas.test.js`

**Interfaces:**
- Produces:
  - `listar(sqlite, { sucursal_id, marca, lista, estado, q, pagina }) -> { filas, total, tiendas_atrasadas,
    calculado_en }`; fila: `{ sucursal_id, clave, descripcion, marca, existencia, minimo, maximo, minimo_calculado,
    maximo_calculado, ajuste: { minimo, maximo, motivo, actor, fecha } | null, venta_mes, dias_en_cero, lista, estado:
    'agotado'|'bajo_minimo'|'bien'|'sobre_maximo', ya_no_es_marca: bool }`. Página de 100.
  - `ponerAjuste(sqlite, { sucursal_id, clave, minimo, maximo, motivo }, actor, ahora)`: enteros en unidades ≥ 0,
    `maximo >= minimo`, motivo de 3 a 200 caracteres; historial `poner`. `quitarAjuste(sqlite, { sucursal_id, clave,
    motivo }, actor, ahora)`: historial `quitar`.
  - Rutas: `GET /api/resurtido` (`ver_resurtido`), `PUT /api/resurtido/ajuste` y `DELETE /api/resurtido/ajuste`
    (`corregir_minimos_resurtido`), `GET/PUT /api/resurtido/config` (`configurar_resurtido`). `registrarRutasResurtido(app,
    { sqlite, requiereLogin, requierePermiso, resolverPermisosDeRol, resolverAlcanceAutorizado })`.
  - Alcance: sin `ver_todas_las_sucursales`, `listar` y los ajustes se limitan a la `sucursal_id` del token; pedir otra
    da 403.

- [ ] **Step 1: Pruebas rojas**: el ajuste gana sobre el calculado y queda quién/cuándo/por qué; quitarlo regresa al
  calculado; `maximo < minimo` → 400; motivo vacío → 400; usuario de San Cristóbal pidiendo `sucursal_id=1` → 403
  (con `?sucursal_id=` en la URL y en el cuerpo); clave que cambió de departamento con ajuste vivo → sale con
  `ya_no_es_marca: true`; existencia −3 → estado `agotado`.
- [ ] **Step 2–4:** FAIL → implementar → PASS. Prueba de permisos con roles que tienen permisos vecinos del módulo
  (no `permisos: []`).
- [ ] **Step 5:** Commit `feat(resurtido): consultas, ajustes y rutas`.

### Task 8: Pantalla de mínimos y máximos

**Files:**
- Create: `src/resurtido/Resurtido.jsx`, `src/resurtido/resurtido.js`, `src/resurtido/resurtido.test.js`
- Modify: `src/menuCategorias.js` (entrada "Resurtido" en Inventario, permiso `ver_resurtido`), el ruteo donde se
  montan las pantallas del menú

**Interfaces:**
- Consumes: `GET/PUT/DELETE /api/resurtido*` (Task 7).
- Produces: `textoEstado(fila)`, `formatoCantidad(diezmilesimas, esMetro)` en `resurtido.js`.

Pantalla: selector de tienda (solo si el usuario ve todas), filtros marca / lista ("Calculados", "Revisar: sin
historia por falta de existencia", "No se mueve") / estado; tabla con Clave, Producto, Hay, Mínimo, Máximo, Vende al
mes, Días en cero (año), Estado; ícono "corregido a mano" con quién y motivo; botón "Corregir" (con permiso) que abre un
modal con scroll, mínimo, máximo y motivo obligatorio; "Quitar corrección". Aviso ámbar si hay tiendas atrasadas y la
fecha del último cálculo.

- [ ] **Step 1: Pruebas rojas de `resurtido.js`**: `formatoCantidad(25000, true)` = `'2.5 m'`; `textoEstado` de
  agotado/bajo mínimo/sobre máximo.
- [ ] **Step 2–4:** FAIL → implementar → PASS. `npx eslint src backend --quiet` 0 errores; `npx vite build` OK.
- [ ] **Step 5: Navegador** (copia local, datos sembrados de dos tiendas): ver lista, corregir un mínimo con motivo,
  ver la marca de corrección, quitarla, entrar como usuario de una tienda y no poder ver la otra.
- [ ] **Step 6:** Commit `feat(resurtido): pantalla de minimos y maximos`.

**Cierre de Entrega 1:** suite completa `cd backend && node --test --test-concurrency=2` 0 fallas; revisión
independiente; Victor revisa en producción los números de San Cristóbal contra §3 del spec **antes** de empezar la
Entrega 2.

---

## Entrega 2 — Pedido mensual con visto bueno

### Task 9: Borrador del pedido

**Files:** Create `backend/resurtido/pedido.js` + test; tablas nuevas en `sicarRepositorio.js` y respaldo (misma
regla que Task 1): `resurtido_pedidos(id, marca, estado CHECK IN ('borrador','en_revision','aprobado','surtido',
'cancelado'), creado_en, aprobado_por, aprobado_en, cerrado_en)`, `resurtido_pedido_renglones(pedido_id, sucursal_id,
clave, sugerido, pedido, visto_bueno_por, visto_bueno_en, motivo_cambio, llegado, PK(pedido_id, sucursal_id, clave))`,
`resurtido_pedido_historial`, `resurtido_empaques(clave PK, tamano_diezmilesimas, actor, fecha)`.

**Interfaces:** `armarBorrador(sqlite, marca, ahora) -> pedido_id`; `enCamino(sqlite, sucursal_id, clave) ->
diezmilesimas` (traspasos CEDIS → tienda `enviado` sin aplicar + renglones de pedidos `aprobado` aún no llegados, con
tope de 45 días).

Regla (revisión periódica hasta el máximo): por tienda no atrasada y clave con `lista` distinta de `no_se_mueve`,
`pedido = max(0, maximo_efectivo - max(existencia, 0) - enCamino)`, en unidades enteras. Total por clave redondeado
hacia arriba al empaque si hay `resurtido_empaques`; el sobrante va a la tienda con más `venta_mes`. Un solo borrador
abierto por marca.

- [ ] Pruebas rojas: existencia −2 cuenta como 0 y no como −2; tienda atrasada no entra; rollo de 100 m con pedidos
  30+25+20 → total 100 y sobrante 25 a la que más vende; traspaso enviado sin aplicar reduce el pedido; segundo
  borrador de la misma marca → 409.
- [ ] FAIL → implementar → PASS → commit `feat(resurtido): borrador de pedido mensual`.

### Task 10: Visto bueno por tienda, aprobación y salida al proveedor

**Files:** Modify `pedido.js`, `rutas.js`; test.

**Interfaces:** `vistoBuenoTienda(sqlite, pedido_id, sucursal_id, cambios[{clave, pedido, motivo}], actor)`
(`dar_visto_bueno_resurtido`, solo su tienda); `aprobar(sqlite, pedido_id, actor)` (`aprobar_pedido_resurtido`, exige
visto bueno de todas las tiendas con renglones); `listaProveedor(sqlite, pedido_id) -> { texto, renglones }`;
`hojaReparto(sqlite, pedido_id) -> [{ sucursal, renglones }]`.

Contra abuso: un cambio que **suba** un renglón más de 2× lo sugerido exige motivo y queda marcado para quien aprueba;
todo cambio va al historial con antes/después.

- [ ] Pruebas rojas: encargado de Yajalón no puede tocar renglones de Ocosingo (403); aprobar sin todos los vistos
  buenos → 409; subir de 4 a 20 sin motivo → 400 y con motivo queda `marcado`; `listaProveedor` agrupa por clave con
  descripción; después de aprobar nadie puede cambiar renglones.
- [ ] FAIL → implementar → PASS → commit `feat(resurtido): visto bueno, aprobacion y lista al proveedor`.

### Task 11: Cierre por compra y traspasos

**Files:** Modify `pedido.js`, `servicio.js`; test.

**Interfaces:** `revisarLlegadas(sqlite, ahora)`: por pedido `aprobado`, suma a `llegado` los traspasos CEDIS → tienda
**aplicados** después de `aprobado_en` por clave y tienda (sin pasar de lo pedido); pasa a `surtido` cuando todos los
renglones llegaron o a los 45 días (queda la diferencia visible). La compra de CEDIS al proveedor (proveedor de
`sicar_proveedores` de la sucursal 6 cuyo nombre coincide con el de la marca en `config`) se muestra como "llegó a
CEDIS" con fecha.

- [ ] Pruebas rojas: llegada parcial deja diferencia; traspaso cancelado no cuenta; traspaso anterior a la aprobación
  no cuenta; a los 45 días se cierra con faltante visible.
- [ ] FAIL → implementar → PASS → commit `feat(resurtido): cierre del pedido por llegadas`.

### Task 12: Pantalla del pedido

**Files:** `src/resurtido/Pedido.jsx` (+ funciones puras en `resurtido.js` y prueba).

Pestaña "Pedido" en Resurtido: borrador por marca, columnas por tienda, edición solo de la propia tienda, botón "Doy
visto bueno", botón "Aprobar pedido" (con permiso), "Copiar para WhatsApp" e "Imprimir" de la lista al proveedor, y la
hoja de reparto. Navegador: flujo completo con dos usuarios de tienda y uno con permiso de aprobar.

- [ ] eslint, build, navegador, commit `feat(resurtido): pantalla del pedido`.

---

## Entrega 3 — Avisos entre pedidos

### Task 13: Avisos con "pasar de otra tienda" o "pedir extra"

**Files:** Create `backend/resurtido/avisos.js` + test; tablas `resurtido_avisos(id, sucursal_id, clave, creado_en,
estado CHECK IN ('abierto','resuelto','descartado'), propuesta_json, decision, actor, cerrado_en)` y respaldo.

**Interfaces:** `revisarAvisos(sqlite, ahora)` (en el ciclo diario y tras cada recálculo): abre aviso si `existencia +
enCamino < minimo_efectivo` en tienda no atrasada; propuesta "pasar" desde tiendas donantes con `existencia >
maximo_efectivo`, cantidad = `min(lo que falta para el mínimo, existencia_donante - maximo_donante)` — **nunca deja a la
donante abajo de su máximo**; propuesta "pedir extra" con lo que falta para el máximo. Se cierra solo
(`resuelto`) cuando la existencia vuelve al mínimo. `decidirAviso(sqlite, id, { decision: 'pasar'|'pedir'|'esperar',
motivo }, actor)` (`dar_visto_bueno_resurtido`, su tienda). "Pedir" agrega renglones a un pedido corto de la marca
(Entrega 2, mismo visto bueno).

- [ ] Pruebas rojas: donante con 12 y máximo 10 ofrece 2, no más; ninguna donante sobre su máximo → solo "pedir";
  aviso se cierra al llegar la existencia; no se abren dos avisos para la misma tienda/clave.
- [ ] FAIL → implementar → PASS → pantalla "Avisos" (lista por tienda, tres botones) → navegador → commit
  `feat(resurtido): avisos entre pedidos`.

---

## Entrega 4 — Historial de mostrador antes de 2025 (agente)

### Task 14: Fecha de inicio de mostrador configurable

**Files:** Modify `agente-sicar/mapeo.js`, `agente-sicar/configuracion.js`, `agente-sicar/LEEME.md`; tests del agente.

**Interfaces:** `config.mostrador_desde` opcional `'YYYY-MM-DD'` (por omisión `'2025-01-01'`, sin cambio de conducta);
fecha inválida → `CONFIGURACION_INVALIDA`. Verificar en `backend/sicarRepositorio.js` que el servidor acepta ventas de
mostrador anteriores a 2025 sin rechazarlas; si las rechaza, el ajuste del servidor entra en esta misma tarea.

- [ ] Pruebas rojas del agente → implementar → `cd agente-sicar && node --test` → commit
  `feat(agente): fecha de inicio de mostrador configurable`.
- [ ] Operación (con Victor, una tienda a la vez, de noche): actualizar el agente, poner `mostrador_desde:
  "2021-01-01"`, `--mostrador-ahora`, vigilar RAM como en Innotec.

---

## Orden y verificación

Entrega 1 → Victor revisa números → Entrega 2 → Entrega 3. La Entrega 4 puede ir en paralelo a la 2 (otro worktree,
otro responsable). Cada entrega: suite completa 0 fallas, eslint 0 errores, `vite build`, revisión independiente (si
implementa Codex, revisa Claude), navegador, merge y push solo con autorización de Victor.
