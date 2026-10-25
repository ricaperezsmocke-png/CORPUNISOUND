# Cinco Caminos P1: ventas de mostrador + tablero semanal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El agente manda las ventas a público en general sin datos de persona, y CORPUNISOUND muestra en Objetivos un
tablero semanal por tienda con los números de los cinco caminos (sin margen).

**Architecture:** Colección opcional nueva `mostrador` en el lote SICAR, armada en el mismo flujo de ventas del agente
(mismo cursor `ven_id`, misma ventana de 48 h e historial de cancelaciones) más una carga histórica desde 2025-01-01. El
servidor la guarda en tablas aparte que el CRM nunca lee. Un módulo de cálculo arma los números por semana desde
SQLite y el Radar; una pestaña nueva en Objetivos los muestra.

**Tech Stack:** Node (agente `mysql2`; servidor Express + better-sqlite3 + JSON DB), React + Vite, `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-24-cinco-caminos-design.md` (secciones 3, 4.1, 4.3, 7, 7.1, 8, 9). Fuera de este
plan: manual de tácticas, metas automáticas, planeador, cierre del mes, vendedor y costo (planes P2–P4).

## Global Constraints

- Sin dependencias nuevas; líneas ≤ 200 en `.js/.jsx` de `src/` y `backend/`; staging explícito; commits sin acentos;
  sin push/merge/rebase; suites en 0 fallas; `npx eslint src backend` 0 errores.
- Solo observar SICAR; la guardia `validarSQL` aplica a toda consulta del agente.
- **Ninguna venta de mostrador lleva cliente, nombre, teléfono, descripción ni clave del artículo.** Nunca se escribe en
  `sicar_ventas`, `sicar_clientes` ni nada que lea el CRM.
- Fila del contrato `mostrador`: `{ ven_id, fecha_local, estado, total, detalle: [{ art_id, cantidad, importe_con,
  descuento_total }] }`; `estado` ∈ `vigente|cancelada`; una cancelación ya enviada puede ir como `{ ven_id, estado:
  'cancelada' }`; importes con los mismos patrones que `ventas` (`total`/`importe_con`/`descuento_total` 2 decimales,
  `cantidad` 4); hasta 100 filas y 1,000 renglones por lote; sin `ven_id` repetido.
- Interruptor `"mostrador"` en `config.json`, booleano, apagado si no es `true`.
- Una venta nunca cuenta dos veces: si llega como venta con cliente se borra de mostrador; si llega a mostrador la venta
  con cliente ya enviada se marca `excluida` (como hoy).
- Semana = lunes a domingo `America/Mexico_City`. "Misma semana de 2025" = la semana cuyo lunes es 364 días antes.
  "Sin dato" con menos de 30 ventas vigentes en la semana o tienda sin `sicar_tiendas`.
- Conversión del Radar sobre lo registrado entre 60 y 30 días antes del domingo de la semana; registros por cada 10
  tickets de la semana; si caen más de 30% contra su promedio de 8 semanas, la conversión sale `no_confiable`.
- Permisos nuevos módulo `pos`: `ver_cinco_caminos`, `administrar_manual_tacticas`. Alcance por token (regla 5).

## Review Focus

1. Una venta que pasa de público a cliente (o al revés) en la ventana de 48 h termina en una sola tabla → prueba en
   Task 1 y Task 3.
2. Una venta de público cancelada después de enviada queda `cancelada` en mostrador y sale del tablero → Task 1 y 3.
3. Semana sin ventas, tienda sin agente, o categorías sin configurar → "sin dato"/"sin configurar", nunca división
   entre cero ni 0% → Task 4.
4. La carga histórica de mostrador no frena las ventas nuevas (va de noche y al final de la corrida) → Task 3.
5. Usuario sin `ver_todas_las_sucursales` pide el tablero de otra tienda por `?sucursal_id=` → solo ve la suya → Task 4.

---

### Task 1: Contrato y recepción de `mostrador`

**Files:** `backend/sicarIngesta.js`, `backend/sicarRepositorio.js`, `docs/sicar-contrato-v1.md`; pruebas
`backend/sicarIngesta.test.js`, `backend/sicarRepositorio.test.js`, `backend/sicarContrato.test.js`,
`agente-sicar/contrato.test.js` (molde: commits 9fc2c51 `existencias` y a72c69f `cortes`).

**Interfaces:**
- Tablas: `sicar_ventas_mostrador (sucursal_id, ven_id TEXT, fecha_local TEXT, estado TEXT CHECK in
  ('vigente','cancelada'), total_centavos INTEGER CHECK integer, actualizado_en TEXT, PRIMARY KEY (sucursal_id, ven_id),
  FK sicar_tiendas)` y `sicar_detalles_mostrador (sucursal_id, ven_id, renglon INTEGER, art_id TEXT, cantidad TEXT,
  importe_centavos INTEGER, descuento_centavos INTEGER, PRIMARY KEY (sucursal_id, ven_id, renglon), FK a la venta)`.
  `cantidad` se guarda como texto de 4 decimales (igual que `sicar_detalles`).
- Recibo `aceptados.mostrador`. `repo.listarMostrador()` para pruebas.

- [ ] **Step 1:** Pruebas rojas de validación: fila completa pasa; cancelación corta `{ven_id, estado:'cancelada'}`
  pasa; fila con `cli_id`, `nombre`, `clave` o `descripcion` → 400 `PROPIEDAD_NO_DECLARADA`; `estado:'excluida'` → 422
  `ESTADO_INVALIDO`; importe `'1.5'` → 422 `IMPORTE_INVALIDO`; 101 filas o 1,001 renglones → `LIMITE_ENTIDADES`;
  `ven_id` repetido → `ID_DUPLICADO`; lote con solo `mostrador` pasa.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar validación (`validarMostrador`).
- [ ] **Step 4:** Pruebas rojas de repositorio: guarda centavos y renglones; reenviar reemplaza renglones; cancelación
  corta cambia a `cancelada` sin tocar total; **una venta con cliente vigente/cancelada con el mismo `ven_id` borra la
  fila de mostrador y sus renglones** en la misma transacción; una fila de mostrador **no** toca `sicar_ventas`; misma
  `ven_id` en dos tiendas son dos filas; recibo `aceptados.mostrador`.
- [ ] **Step 5:** Implementar. **Step 6:** Contrato + pruebas espejo; suites → 0 fallas.
- [ ] **Step 7: Commit** `feat(sicar): coleccion opcional mostrador con ventas de publico en general sin datos de persona`

### Task 2: Respaldo con las tablas de mostrador

**Files:** `backend/sicarRespaldo.js`, `backend/sicarRespaldo.test.js`, `backend/leadsRespaldo.test.js`,
`backend/crmInternasRepositorio.test.js` (molde: 98612aa y e0d018f).

**Interfaces:** `TABLAS` agrega al final `'sicar_ventas_mostrador'`, `'sicar_detalles_mostrador'`; congelar la forma
actual como `TABLAS_22` (con y sin bandeja) y agregar las dos nuevas generaciones.

- [ ] **Step 1:** Pruebas rojas: respaldo de 22 tablas (con y sin bandeja) restaura y deja mostrador vacío; uno de 24
  conserva ventas y renglones de mostrador; manifiesto con detalles sin ventas de mostrador se rechaza.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar. **Step 4:** suite backend → 0. **Step 5: Commit**
  `feat(sicar): ventas de mostrador en el respaldo con generaciones anteriores restaurables`

### Task 3: Agente — mandar ventas de mostrador

**Files:** `agente-sicar/formato.js`, `corrida.js`, `estado.js`, `configuracion.js`, `index.js`, `mapeo.js`
(solo `verificar`), `config.ejemplo.json`, `LEEME.md`; pruebas correspondientes.

**Interfaces:**
- `ventaSegura(...)` (formato.js) agrega una salida: cuando el cliente es público en general (la regla actual de
  `cliente()` devuelve `null`), devuelve además `mostrador: { ven_id, fecha_local, estado, total, detalle }` con
  renglones `{ art_id, cantidad, importe_con, descuento_total }` (mismos `decimal` que hoy). Si ya se había enviado como
  venta con cliente, sigue devolviendo también `{ ven_id, estado: 'excluida' }` para `ventas`.
- `elementos()` (corrida.js) devuelve `{ venta, cliente, mostrador }`; `agregar()` pone `mostrador` en
  `lote.mostrador` solo si `config.mostrador === true`; `cabe()` limita 100 filas de mostrador y cuenta sus renglones
  en el tope de 1,000.
- El estado `enviadas` registra también los `ven_id` mandados a mostrador (para que la ventana de 48 h y el historial de
  cancelaciones manden su `cancelada`), con un mapa aparte `mostrador_enviadas` (Claude: no mezclar con `enviadas`, que
  decide la tumba `excluida` de `ventas`).
- **Carga histórica:** estado `mostrador_cursor` (`'0'` inicial, luego el último `ven_id` revisado) y
  `mostrador_desde_ven_id` (el primer `ven_id` con `fecha >= '2025-01-01 00:00:00'`, que `fuente` obtiene con
  `SELECT MIN(v.ven_id) AS desde FROM venta v WHERE v.fecha >= ?`). Paso nocturno (mismo horario que las listas
  diarias, o con `--mostrador-ahora`) al final de `ejecutar`: lee páginas de ventas con `ven_id` en
  `(max(mostrador_cursor, desde-1), ven_id_actual]`, manda solo las de público, avanza el cursor al confirmar; al
  alcanzar el cursor de ventas termina y no vuelve a correr.
- `verificar()` agrega `mostrador: { desde_ven_id, total_publico_desde_2025 }` (COUNT con la misma regla de público
  hecha en SQL por ids `PUBLICOS`; Claude: el nombre "PÚBLICO EN GENERAL" se revisa en JS como hoy).
- Eventos: `MOSTRADOR_AUTORIZADO_DE_DIA`.

- [ ] **Step 1:** Pruebas rojas de formato: venta de cliente 1 (público) → `mostrador` sin `cli_id`/descripción/clave;
  venta de público ya enviada como venta con cliente → `excluida` + `mostrador`; venta de cliente normal → sin
  `mostrador`.
- [ ] **Step 2:** Pruebas rojas de corrida: con interruptor apagado ningún lote trae `mostrador` (ventas idénticas a
  hoy); prendido, una página mezclada manda ventas y mostrador en el mismo lote; venta de público cancelada en la
  ventana de 48 h se manda `cancelada`; venta que pasa de público a cliente se manda como venta (y el servidor borra
  mostrador — eso lo prueba Task 1); carga histórica solo de noche o con `--mostrador-ahora`, después de todo lo demás,
  avanzando `mostrador_cursor` solo con confirmación, y termina al alcanzar el cursor de ventas; un fallo de envío no
  mueve el cursor.
- [ ] **Step 3:** FAIL. **Step 4:** Implementar (estado inicial y `cargar` con los campos nuevos validados;
  `--mostrador-ahora`; `--verificar`; interruptor; `config.ejemplo.json` `"mostrador": false`; sección en LEEME con la
  advertencia de confirmar los ids de público de cada tienda).
- [ ] **Step 5:** `cd agente-sicar && node --test` → 0 fallas. **Step 6: Commit**
  `feat(agente-sicar): ventas de publico en general como mostrador y carga desde 2025`

### Task 4: Cálculo del tablero, categorías y permisos

**Files:** Create `backend/cincoCaminos/tablero.js`, `backend/cincoCaminos/semanas.js`, `backend/cincoCaminos/rutas.js`;
modify `backend/permisosCatalogo.js`, `backend/server.js` (semilla `DB.pos.cinco_caminos = { categorias: [] }` y
registro de rutas), tests `backend/cincoCaminos/*.test.js`.

**Interfaces:**
- `semanas.js`: `semanaDe(fecha: 'YYYY-MM-DD') → { lunes, domingo }`; `semanaAnterior(lunes)`; `mismaSemanaAnio(lunes)`
  (lunes − 364 días); `ultimasSemanas(lunes, n)`.
- `tablero.js`: `numerosSemana(sqlite, DB, { sucursal_id, lunes }) → { sucursal_id, lunes, domingo, sin_dato: bool,
  venta_centavos, ventas, pct_con_cliente, clientes_nuevos, recompra_90, ticket_promedio_centavos, articulos_por_ticket,
  pct_instrumento_con_accesorio | 'sin_configurar', radar: { conversion, registros_por_10_tickets, no_confiable } }`.
  Porcentajes con un decimal (número); dinero en centavos enteros.
  - ventas = vigentes de `sicar_ventas` + `sicar_ventas_mostrador` en la semana; `pct_con_cliente` = con cliente ÷ total.
  - `clientes_nuevos` = `cli_id` cuya primera venta vigente (en toda la historia de `sicar_ventas`) cae en la semana.
  - `recompra_90` = de los `cli_id` con venta en la semana, % con otra venta vigente en los 90 días previos al lunes.
  - artículos e instrumento/accesorio desde `sicar_detalles` + `sicar_detalles_mostrador` con `sicar_articulos`
    (categoría/departamento) y `DB.pos.cinco_caminos.categorias` = `[{ departamento, categoria, tipo:
    'instrumento'|'accesorio' }]` (categoría `null` = todo el departamento).
  - Radar: registros de `DB.radar_demanda.registros` de la tienda con `fecha_registro` entre domingo−60 y domingo−30
    días, clasificados con `clasificarEstadoDemanda` existente.
- `tableroTienda(sqlite, DB, { sucursal_id, lunes }) → { actual, anterior, mismo_2025, promedio_8 }` (cada uno el objeto
  de `numerosSemana`; `promedio_8` con los promedios numéricos de las 8 semanas previas).
- Rutas: `GET /api/cinco-caminos/tablero?sucursal_id=&semana=YYYY-MM-DD` (`ver_cinco_caminos`; sin
  `ver_todas_las_sucursales` siempre la tienda del token; default la última semana completa);
  `GET/PUT /api/cinco-caminos/categorias` (GET con `ver_cinco_caminos`, PUT con `administrar_manual_tacticas`; valida
  `tipo` y que departamento/categoría sean texto ≤ 100). Lista de departamentos/categorías disponibles:
  `GET /api/cinco-caminos/categorias/disponibles` (distintos de `sicar_articulos`).

- [ ] **Step 1:** Pruebas rojas (sembrar `sicar_ventas`, mostrador, detalles, artículos y Radar con fechas conocidas):
  semana con 20 ventas con cliente y 20 de mostrador → `pct_con_cliente` 50.0 y `ticket_promedio` = total/40; semana con
  29 ventas → `sin_dato: true`; cliente cuya primera compra fue la semana → nuevo, cliente con compra hace 40 días →
  recompra; instrumento+accesorio en 3 de 4 ventas con instrumento → 75.0; sin categorías → `'sin_configurar'`; Radar:
  registro de hace 45 días convertido cuenta, uno de hace 10 días no; registros caen 40% → `no_confiable`; venta
  cancelada no cuenta; `mismaSemanaAnio('2026-10-19')` → `'2025-10-20'`.
- [ ] **Step 2:** Pruebas rojas de rutas: sin `ver_cinco_caminos` → 403 (rol con permisos vecinos de `pos`); con el
  permiso y sin "ver todas", `?sucursal_id=` de otra tienda devuelve la del token; PUT categorías sin
  `administrar_manual_tacticas` → 403; `tipo:'otro'` → 400.
- [ ] **Step 3:** FAIL. **Step 4:** Implementar (consultas SQL agregadas, no cargar todas las filas en JS; permisos en
  el catálogo; semilla). **Step 5:** suite backend → 0 (guard de permisos incluido). **Step 6: Commit**
  `feat(objetivos): tablero semanal de los cinco caminos por tienda`

### Task 5: Pantalla "Cinco caminos"

**Files:** Create `src/metas/CincoCaminos.jsx`, `src/metas/cincoCaminos.js` (puras), `src/metas/CategoriasCincoCaminos.jsx`;
modify `src/metas/pestanasObjetivos.js` (pestaña `{ clave: "cinco-caminos", etiqueta: "Cinco caminos", icono: "Route",
grupo: "tienda" }` visible con `ver_cinco_caminos`), `src/GerenciaVentas.jsx`; tests `src/metas/cincoCaminos.test.js`,
`src/metas/pestanasObjetivos.test.js`.

- [ ] **Step 1:** Pruebas rojas puras: `semaforo(valor, base)` → verde si ≥ base, ámbar hasta −5%, rojo peor, `null`
  sin base; `flecha(actual, anterior)`; `formatoNumero` para % (un decimal), pesos (desde centavos) y "sin dato" /
  "sin configurar" / "no confiable"; la pestaña aparece solo con `ver_cinco_caminos`.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar: selector de tienda (solo con "ver todas") y de semana (default la última
  completa); una tarjeta por número con valor, flecha contra la semana anterior, misma semana de 2025, promedio de 8
  semanas y semáforo (base = 2025, o promedio 8 si no hay); arriba la venta de la semana como contexto; nota "Ventas con
  cliente y de mostrador. Cifras según SICAR". Sub-pantalla de categorías (con `administrar_manual_tacticas`): lista de
  departamentos/categorías disponibles con selector instrumento/accesorio/ninguno.
- [ ] **Step 4:** pruebas src, eslint 0, `npx vite build`. **Step 5: Prueba en navegador** (controlador). **Step 6:
  Commit** `feat(objetivos): pantalla Cinco caminos con tablero semanal y categorias`
