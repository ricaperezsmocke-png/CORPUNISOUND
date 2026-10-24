# Existencias desde SICAR (E1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El agente de la tienda manda la existencia de cada artículo vigente de SICAR (solo cambios cada 5 min,
completa una vez al día) y CORPUNISOUND la muestra en una pantalla de solo consulta "Existencias SICAR".

**Architecture:** Colección opcional nueva `existencias` en el lote SICAR, con el mismo camino que `articulos` y
`proveedores` (molde exacto: commits `fc74b13` agente y `7ce15bb` servidor/respaldo). El agente compara contra la
última existencia confirmada que guarda en `estado.json`. El servidor la guarda en `sicar_existencias` (diezmilésimas
enteras) y la sirve agrupada por clave entre tiendas.

**Tech Stack:** Node (agente: `mysql2`; servidor: Express + better-sqlite3), React + Vite, pruebas `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-23-sicar-existencias-cortes-design.md` (secciones 2, 3, 5, 6). E2 (cortes)
tiene su propio plan aparte.

## Global Constraints

- Ninguna dependencia nueva. Pruebas con `node --test`.
- Ninguna línea de más de 200 caracteres en `.js`/`.jsx` de `src/` o `backend/`.
- Staging por rutas explícitas, nunca `git add .`. Mensajes de commit sin acentos. Sin push, merge ni rebase.
- Solo observar: nada toca catálogo, existencias, caja ni cortes de CORPUNISOUND; datos en tablas `sicar_*`.
- SICAR solo lectura: toda consulta pasa `validarSQL` (`agente-sicar/seguridad.js`).
- Interruptor `"existencias"` en `config.json`, booleano, apagado si no es `true`.
- La tienda sale de la llave autenticada; el alcance de las rutas de lectura, del token (regla 5 de `CLAUDE.md`).
- Fila del contrato exactamente `{ art_id, existencia }`; `existencia` es `null` o cumple `^-?\d{1,16}\.\d{4}$`;
  otra cosa → 422 `IMPORTE_INVALIDO`. Hasta 500 por lote, sin `art_id` repetido, recibo `aceptados.existencias`.
- Lectura en SICAR: `articulo` con `status = 1 AND servicio = 0`.
- Fila del servidor sin confirmar en más de 36 h → gris "sin confirmar desde <fecha>" y fuera de totales.
- Aviso ámbar solo si el último contacto del agente (`sicar_tiendas.ultima_recepcion`) pasa de 24 h.
- Permiso nuevo `ver_existencias_sicar` (módulo `inventario`); quien lo tiene ve todas las tiendas con agente.
- Línea base: backend 0 fallas, agente 0 fallas, `npx eslint src backend` 0 errores.

## Review Focus

1. Un lote de existencias que falla al enviarse (HTTP 5xx, red) no debe marcar esos valores como confirmados: el
   siguiente intento reenvía lo mismo → prueba en Task 3.
2. Un `estado.json` de la versión anterior (sin `existencias`) arranca con mapa vacío; uno con mapa corrupto
   (valor no decimal, id no numérico) se rechaza con `ESTADO_INVALIDO` → prueba en Task 3.
3. `-0.0000`, `"3"` (sin decimales), `"3.12345"` (5 decimales) y un número JS en vez de texto: el agente normaliza o
   salta con `EXISTENCIA_OMITIDA`, el servidor rechaza lo que no cumpla el patrón → pruebas en Tasks 1 y 3.
4. Restaurar un respaldo de Drive de una generación anterior (sin `sicar_existencias`) sigue funcionando y deja la
   tabla vacía → prueba en Task 2.
5. `GET /api/sicar/existencias` con `?sucursal_id=` de otra tienda o con `q` con acentos/comodines SQL (`%`, `_`) no
   cambia el alcance ni rompe la búsqueda → pruebas en Task 4.

---

### Task 1: Contrato y recepción en el servidor

**Files:**
- Modify: `backend/sicarIngesta.js` (sobre acepta `existencias`; `validarExistencia`)
- Modify: `backend/sicarRepositorio.js` (tabla, sentencias upsert/delete, recibo)
- Modify: `docs/sicar-contrato-v1.md` (párrafo de la colección, junto a `proveedores`)
- Test: `backend/sicarIngesta.test.js`, `backend/sicarRepositorio.test.js`, `backend/sicarContrato.test.js`,
  `agente-sicar/contrato.test.js` (mismos lugares donde `7ce15bb` probó `proveedores`)

**Interfaces:**
- Produces: tabla `sicar_existencias (sucursal_id INTEGER NOT NULL, art_id TEXT NOT NULL,
  existencia_diezmilesimas INTEGER NOT NULL CHECK (typeof(existencia_diezmilesimas) = 'integer'), actualizado_en TEXT
  NOT NULL, PRIMARY KEY (sucursal_id, art_id), FOREIGN KEY (sucursal_id) REFERENCES sicar_tiendas(sucursal_id))`;
  recibo con `aceptados.existencias` (cuenta filas, incluidas las `null`); `repo.listarExistencias()` →
  `[{ sucursal_id, art_id, existencia_diezmilesimas, actualizado_en }]`.

- [ ] **Step 1: Pruebas rojas de validación** en `sicarIngesta.test.js`:
  - `existencias: [{ art_id: '7', existencia: '-1.0000' }, { art_id: '8', existencia: null }]` pasa.
  - 422 `IMPORTE_INVALIDO` para `'3'`, `'3.12345'`, `'1.000'`, `3` (número), `'+1.0000'`, `' 1.0000'`,
    `'99999999999999999.0000'` (17 enteros).
  - 422 `ID_DUPLICADO` con el mismo `art_id` dos veces; `LIMITE_ENTIDADES` con 501; 400 `PROPIEDAD_NO_DECLARADA` con
    una llave extra en la fila (`{ art_id, existencia, clave }`).
  - Un lote con solo `existencias` (clientes y ventas vacíos) pasa.
- [ ] **Step 2:** `cd backend && node --test sicarIngesta.test.js` → FAIL (propiedad no declarada en el sobre).
- [ ] **Step 3:** Implementar `validarExistencia(e)` y agregar `'existencias'` a `validarSobreSicar` y a
  `validarLoteSicar` (mismo bloque que `proveedores`). Patrón exacto `^-?\d{1,16}\.\d{4}$` y además
  `BigInt` sin el punto ≤ `Number.MAX_SAFE_INTEGER` en valor absoluto.
- [ ] **Step 4: Pruebas rojas del repositorio** en `sicarRepositorio.test.js`:
  - aplicar `{ art_id: '7', existencia: '-1.0000' }` guarda `-10000`; reaplicar `'2.5000'` deja `25000` y renueva
    `actualizado_en`; `{ art_id: '7', existencia: null }` borra la fila; `null` de un `art_id` que no existe no falla.
  - `'-0.0000'` se guarda `0`.
  - la tienda es la de la llave: el mismo `art_id` en dos tiendas son dos filas.
  - recibo trae `aceptados.existencias = 2` cuando el lote trae 2 filas y no trae la llave si el lote no la trae.
- [ ] **Step 5:** Implementar en `sicarRepositorio.js` (crear tabla en el `CREATE` inicial, sentencias `existencia`
  y `borrarExistencia`, ciclo en `aplicar` igual que `proveedores`, `listarExistencias`). Conversión a diezmilésimas
  con `BigInt` del texto sin punto, nunca `Number(parseFloat)`.
- [ ] **Step 6:** Contrato: párrafo nuevo en `docs/sicar-contrato-v1.md` (mismas reglas que `proveedores`, fila
  exacta, `null` = ya no vigente, recibo, "un servidor anterior rechaza la llave con 400: el agente la manda solo con
  `\"existencias\": true`"). Agregar los casos de contrato espejo en `sicarContrato.test.js` y
  `agente-sicar/contrato.test.js` como hizo `7ce15bb`.
- [ ] **Step 7:** `cd backend && node --test` → 0 fallas; `cd agente-sicar && node --test` → 0 fallas.
- [ ] **Step 8: Commit** `feat(sicar): coleccion opcional existencias y tabla sicar_existencias`

### Task 2: Respaldo en Drive con la tabla nueva

**Files:**
- Modify: `backend/sicarRespaldo.js:7-23`
- Test: `backend/sicarRespaldo.test.js`, `backend/leadsRespaldo.test.js` (donde `7ce15bb` agregó generaciones)

**Interfaces:**
- Consumes: tabla `sicar_existencias` de Task 1.
- Produces: `TABLAS` termina en `'sicar_existencias'`; `GENERACIONES` conserva **todas** las formas anteriores tal
  cual (la de 16 tablas SICAR y la de 16 + bandeja) y agrega al final las dos nuevas (17 y 17 + bandeja).

- [ ] **Step 1: Pruebas rojas:** un respaldo tomado con la versión actual (16 tablas, con y sin bandeja) se restaura
  y deja `sicar_existencias` vacía; uno nuevo con existencias las conserva al restaurar; un manifiesto con
  `sicar_existencias` pero sin `sicar_proveedores` se rechaza (no es una generación conocida).
- [ ] **Step 2:** `cd backend && node --test sicarRespaldo.test.js leadsRespaldo.test.js` → FAIL.
- [ ] **Step 3:** Agregar la tabla al final de `TABLAS`, congelar `TABLAS_16 = TABLAS.slice(0, 16)` y armar
  `GENERACIONES = [...las 5 primeras actuales, TABLAS_16, [...TABLAS_16, ...TABLAS_LEADS], TABLAS, TODAS]`.
- [ ] **Step 4:** `cd backend && node --test` → 0 fallas.
- [ ] **Step 5: Commit** `feat(sicar): sicar_existencias en el respaldo con generaciones anteriores restaurables`

### Task 3: Agente — leer, comparar y mandar existencias

**Files:**
- Modify: `agente-sicar/mapeo.js` (`COLUMNAS_EXISTENCIAS`, `existenciasDisponibles`, `existencias(cursor, limite)`,
  sección `existencias` de `verificar()`)
- Modify: `agente-sicar/formato.js` (`existenciaSegura`, `cabe` con `existencias ≤ 500`)
- Modify: `agente-sicar/estado.js` (estado inicial y `cargar`: `existencias`, `existencias_dia`; eventos)
- Modify: `agente-sicar/corrida.js` (`agregar`, `vacio`, paso de existencias al final de `ejecutar`)
- Modify: `agente-sicar/configuracion.js` (interruptor `existencias`), `agente-sicar/index.js` (`--existencias-ahora`,
  impresión de `--verificar`), `agente-sicar/config.ejemplo.json` (`"existencias": false`), `agente-sicar/LEEME.md`
- Test: `mapeo.test.js`, `formato.test.js`, `estado.test.js`, `corrida.test.js`, `configuracion.test.js`

**Interfaces:**
- Consumes: contrato de Task 1.
- Produces:
  - `COLUMNAS_EXISTENCIAS = { articulo: ['art_id', 'existencia', 'status', 'servicio'] }`.
  - `fuente.existencias(cursor: string, limite: number) → Promise<Array<{ art_id, existencia }>>` con
    `SELECT a.\`art_id\`, a.\`existencia\` FROM \`articulo\` a WHERE a.\`art_id\` > ? AND a.\`status\` = 1 AND
    a.\`servicio\` = 0 ORDER BY a.\`art_id\` LIMIT ?` (límite `Math.min(limite, lector.tamano * 5)`).
  - `fuente.existenciasDisponibles: boolean`; `verificar().existencias = { columnas, faltantes, total, ms }`.
  - `existenciaSegura(fila) → { existencia: { art_id, existencia } | null, omitido: { art_id, codigo } | null }`:
    `existencia` normalizada con `decimal` de 4 decimales aceptando signo; `'-0.0000'` → `'0.0000'`.
  - Estado: `existencias: { [art_id]: '3.0000' }` (lo último **confirmado** por el servidor) y
    `existencias_dia: 'YYYY-MM-DD' | null`.
  - Eventos nuevos: `EXISTENCIA_OMITIDA`, `EXISTENCIAS_NO_DISPONIBLES`, `EXISTENCIAS_AUTORIZADAS_DE_DIA`.

- [ ] **Step 1: Pruebas rojas de mapeo** (patrón de los tests de proveedores): con las cuatro columnas,
  `existenciasDisponibles = true` y la consulta generada es exactamente la de arriba y pasa `validarSQL`; sin
  `articulo.servicio` queda apagado con `faltantes: ['articulo.servicio']` y no consulta la tabla; `verificar()`
  trae `total` (COUNT con el mismo `WHERE`) y `ms` numérico.
- [ ] **Step 2: Pruebas rojas de formato:** `'3.0000'` → `'3.0000'`; `'-1.0000'` → `'-1.0000'`; `'-0.0000'` →
  `'0.0000'`; `'3'` → `'3.0000'`; `'3.12345'` → omitido `PRECISION_NO_PACTADA`; `3` (número) → omitido
  `DECIMAL_INVALIDO`; `art_id` inválido lanza (no se omite).
- [ ] **Step 3: Pruebas rojas de estado:** estado sin `existencias` carga con `{}` y `existencias_dia: null`;
  `existencias: { '7': 'x' }` o `{ 'a': '1.0000' }` → `ESTADO_INVALIDO`.
- [ ] **Step 4: Pruebas rojas de corrida** (con la fuente falsa de `corrida.test.js`, interruptor en `true`):
  - primera corrida de día (fuera de 20–07): manda todas las vigentes en lotes de ≤ 500 y, al confirmarse, el mapa
    del estado queda igual a lo leído;
  - segunda corrida sin cambios: no manda ningún lote de existencias;
  - cambia un artículo y otro deja de ser vigente: el lote trae exactamente esos dos (`'5.0000'` y `null`) y tras
    confirmar el segundo desaparece del mapa;
  - el envío falla (HTTP 503): el mapa no cambia y la siguiente corrida reenvía lo mismo (Review Focus 1);
  - de noche con `existencias_dia !== hoy`, o con `existenciasAhora`, manda todas aunque no cambiaran y marca
    `existencias_dia = hoy`;
  - interruptor apagado o `existenciasDisponibles = false`: no lee existencias (y avisa `EXISTENCIAS_NO_DISPONIBLES`
    solo en el segundo caso); ventas siguen igual;
  - 1,200 vigentes → 3 lotes, y cada lote confirmado actualiza el mapa con sus filas (no al final de todo).
- [ ] **Step 5:** Correr esas pruebas → FAIL.
- [ ] **Step 6:** Implementar. El paso de existencias va **después** de la lista de proveedores en `ejecutar`, con
  `modo 'incremental'`. Lee todas las páginas (cursor en memoria), arma el mapa actual, calcula los items (todos si
  toca vuelta completa; si no, cambiados + `null` para ids del mapa confirmado que ya no aparecen), los parte en
  tramos de 500 y llama `transmitir(items, cambios, 'incremental')` **por tramo** con
  `cambios = { existencias: <mapa confirmado + este tramo aplicado (null = borrar)> }`, y en el último tramo de una
  vuelta completa también `existencias_dia: hoy`. `agregar` usa `'existencia' in elemento` (el valor puede ser
  `null` dentro de la fila, el elemento no).
- [ ] **Step 7:** Configuración, `--existencias-ahora` (registra `EXISTENCIAS_AUTORIZADAS_DE_DIA`), impresión de
  `--verificar` ("Existencias: N artículos vigentes, lectura en X ms" o "Existencias APAGADAS, faltan columnas: …"),
  `config.ejemplo.json` y una sección en `LEEME.md` como la de proveedores (cómo se prende y qué significa cada
  evento). Pruebas en `configuracion.test.js` para el interruptor no booleano.
- [ ] **Step 8:** `cd agente-sicar && node --test` → 0 fallas.
- [ ] **Step 9: Commit** `feat(agente-sicar): existencias por cambios cada corrida y completas una vez al dia`

### Task 4: Ruta de consulta y permiso

**Files:**
- Modify: `backend/permisosCatalogo.js` (`ver_existencias_sicar`, módulo `inventario`, `implementado: true`)
- Create: `backend/sicarExistencias.js` (`consultarExistenciasSicar`)
- Modify: `backend/sicarRutas.js` (`GET /api/sicar/existencias` en `registrarRutasSicar`)
- Modify: `backend/sicarRepositorio.js` (consulta de lectura para la pantalla, si no basta `listarExistencias`)
- Test: `backend/sicarExistencias.test.js`

**Interfaces:**
- Consumes: `sicar_existencias`, `sicar_articulos`, `sicar_tiendas.ultima_recepcion`.
- Produces: `consultarExistenciasSicar(sqlite, { q, solo, pagina }, ahora: Date) →
  { tiendas: [{ id, nombre, ultimo_contacto, ultimo_cambio, sin_contacto_24h }], renglones: [{ clave, descripcion,
  departamento, categoria, por_tienda: { [sucursal_id]: { existencia: '3.0000', sin_confirmar_desde: string|null } },
  total: '3.0000' }], pagina, paginas }` (50 por página). `existencia` sale como texto con 4 decimales desde las
  diezmilésimas.

- [ ] **Step 1: Pruebas rojas** (`prepararDB()` local como `backend/cajas.test.js`; sembrar tiendas, artículos y
  existencias por el repositorio):
  - agrupa por `clave` entre tiendas; sin clave, un renglón por tienda con la descripción;
  - `solo=con` (default) solo renglones con total > 0; `negativas` los que tienen alguna tienda < 0; `todas` todos;
  - fila con `actualizado_en` de hace 37 h → `sin_confirmar_desde` lleno y fuera del `total`; de hace 35 h cuenta;
  - `q='guitarra'` encuentra `Guitárra`; `q='%'` y `q='_'` se buscan literalmente;
  - `sin_contacto_24h` verdadero cuando `ultima_recepcion` tiene más de 24 h;
  - por la ruta: sin `ver_existencias_sicar` → 403 aunque tenga `ver_clientes_sicar` (rol con permisos vecinos del
    módulo, no `[]`); con el permiso y `?sucursal_id=` de otra tienda, la respuesta es la misma que sin él.
- [ ] **Step 2:** `cd backend && node --test sicarExistencias.test.js` → FAIL.
- [ ] **Step 3:** Implementar. Búsqueda sin acentos en JS sobre los renglones del grupo o con `LIKE ... ESCAPE`
  normalizado; la decisión es del implementador mientras pasen las pruebas. Nada de `sucursal_id` del query.
- [ ] **Step 4:** `cd backend && node --test` → 0 fallas (incluye el guard de arranque `validarSistemaDePermisos`).
- [ ] **Step 5: Commit** `feat(sicar): consulta de existencias SICAR con permiso ver_existencias_sicar`

### Task 5: Pantalla "Existencias SICAR"

**Files:**
- Create: `src/sicar/ExistenciasSicar.jsx`, `src/sicar/existenciasSicar.js` (funciones puras: texto de "hace X
  min", clase de color por valor, aviso de tienda)
- Modify: `src/menuCategorias.js` (entrada en OPERACIÓN: `{ id: "existencias_sicar", nombre: "Existencias SICAR",
  modulo: "inventario", permiso: "ver_existencias_sicar" }`), `src/App.jsx` (vista), `src/BarraLateral.jsx` (icono)
- Test: `src/sicar/existenciasSicar.test.js`, `src/menuCategorias.test.js`

**Interfaces:**
- Consumes: respuesta de `GET /api/sicar/existencias` (Task 4) vía `apiFetch('/sicar/existencias?...')`.

- [ ] **Step 1: Pruebas rojas puras:** `haceCuanto(iso, ahora)` → "hace 3 min" / "hace 2 h" / "el 21/10 18:04";
  `claseExistencia('-1.0000')` → rojo, `'0.0000'` → gris claro, positiva → normal, con `sin_confirmar_desde` → gris;
  la entrada del menú solo aparece con `ver_existencias_sicar` y el módulo `inventario`.
- [ ] **Step 2:** `node --test src/sicar/existenciasSicar.test.js src/menuCategorias.test.js` → FAIL.
- [ ] **Step 3:** Implementar la pantalla según la sección 3.4 del spec: buscador, filtros "Con existencia" (default)
  / "Negativas" / "Todas", tabla Clave · Descripción · Departamento/Categoría · una columna por tienda · Total,
  negativas en rojo con la nota "SICAR registra existencia negativa: se vendió sin existencia", encabezado por tienda
  "Último contacto del agente: hace X" y "Último cambio de existencias: …", aviso ámbar a las 24 h, paginación.
  Sin botones que cambien nada. Clases de Tailwind largas en constantes.
- [ ] **Step 4:** pruebas de `src` → 0 fallas; `npx eslint src backend` → 0 errores; `npx vite build` OK.
- [ ] **Step 5: Prueba en navegador** (Claude in Chrome; base temporal como `servidor_radar.js` de la sesión
  19970ce5): sembrar 2 tiendas, artículos con existencias positivas, una negativa y una de hace 40 h; entrar con un
  usuario de prueba con `ver_existencias_sicar` y sin `ver_todas_las_sucursales`; verificar filtros, búsqueda con
  acento, rojo, gris y que otro usuario sin el permiso no ve la entrada del menú ni puede abrir la ruta (403).
- [ ] **Step 6: Commit** `feat(sicar): pantalla Existencias SICAR de solo consulta`
