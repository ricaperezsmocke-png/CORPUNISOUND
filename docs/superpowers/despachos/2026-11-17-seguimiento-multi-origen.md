# Despacho: Seguimiento de facturas con más de un origen (CEDIS + Innotec) — Entrega B del plan Innotec

**Rama:** `feature/seguimiento-multi-origen` — **worktree:**
`C:\Users\Victor\Desktop\CORPUNISOUND\.claude\worktrees\seguimiento-mejoras` — **commit base:** el HEAD de la rama al
recibir este despacho (árbol limpio, = master `c26ed12` + este documento). Un solo responsable de escritura: tú.
Lee primero `CLAUDE.md` de la raíz y el spec del seguimiento en `docs/superpowers/specs/` (el de seguimiento por factura).

**Pruebas (obligatorio con estas banderas):**
`cd backend && node --preserve-symlinks --preserve-symlinks-main --test seguimientoFactura/lector.test.js
seguimientoFactura/motor.test.js seguimientoFactura/servicio.test.js seguimientoFactura/consultas.test.js
seguimientoFactura/estrategias.test.js seguimientoFactura/rutas.test.js seguimientoFactura/incorporar.test.js
seguimientoFactura/integracion.test.js seguimientoFactura/respaldo.test.js ../src/seguimiento/seguimiento.test.js`
Si alguna falla con EPERM al crear temporales en tu sandbox, escribe la prueba igual y reporta cuál no pudiste correr.
NO corras la suite completa. Al final `npx eslint src backend --quiet`: 0 errores. No puedes hacer `git add`/`commit`.
NO abras navegador ni levantes servidores.

## Contexto de negocio

Hoy el seguimiento solo conoce un origen: **CEDIS (sucursal 6)**. La factura se compra en CEDIS y viaja por traspasos a
las tiendas; el motor FIFO (`motor.js`, NO se toca) reparte cada pieza en vendido / queda / tránsito / gris / por
aclarar. **Innotec (sucursal 7 en CORPUNISOUND)** es otra razón social: compra en su propio SICAR, vende ahí mismo y
**no hace traspasos**. Victor decidió (2026-11-16):
- Las facturas de Innotec se siguen igual que las de CEDIS, con **las mismas políticas** (45/60/90/120 días).
- A los 45 días, como Innotec no traslada, el aviso dice **"Revisar"** en vez de sugerir traslado; 60/90/120 igual que CEDIS.
- Lo ven los mismos que ven CEDIS (sin permiso nuevo).
- **El dinero no se mezcla:** los totales de Innotec van aparte de los de Unisound; nunca una cifra que sume los dos.
- Innotec nunca es destino ni origen de un traslado sugerido para mercancía de CEDIS (otra razón social).

Innotec todavía NO tiene agente ni está incorporado: con este cambio, **mientras solo CEDIS esté incorporado todo debe dar
exactamente lo mismo que hoy**. Innotec empieza a contar el día que se incorpore (foto de existencias = "anterior", igual
que se hizo con CEDIS).

`CEDIS = 6` está escrito a mano en `lector.js`, `servicio.js` y `consultas.js` (≈30 lugares). El motor ya es genérico:
una compra entra en la tienda de `m.sucursal_id` y las ventas de cada tienda consumen solo su existencia.

## Qué construir (TDD: cada prueba se ve ROJA antes de implementar)

1. **Lista de orígenes en un solo lugar** (`backend/seguimientoFactura/config.js`, exportado):
   `ORIGENES = Object.freeze([{ sucursal_id: 6, nombre: 'CEDIS', traslada: true }, { sucursal_id: 7, nombre: 'Innotec',
   traslada: false }])` y `TIENDAS_APARTE = Object.freeze([7])` (tiendas de otra razón social: nunca entran en traslados
   sugeridos de mercancía de otro origen, ni como destino ni como origen). Un origen **cuenta solo si está incorporado**
   (`seguimiento_tiendas`). Ningún otro archivo vuelve a escribir 6 o 7 a mano para esto.
2. **`lector.js`**:
   - `leerCompras`: lee las compras vigentes de **cada origen incorporado** posteriores a **su propio** corte
     (`c.sucursal_id = origen AND c.fecha > corte local de ese origen`); el movimiento y su `lote` llevan la
     `sucursal_id` real del origen (hoy está fijo en 6).
   - Rescate (`tiendasElegibles` / `conRescate`): el `inicio` sigue siendo el corte de CEDIS; **ningún origen** (6 ni 7)
     es tienda elegible para rescate, ni ninguna de `TIENDAS_APARTE`.
3. **`servicio.js`**: resultados, avisos, la búsqueda de compras de una clave (~línea 103) y `vueltaCompleta` usan el
   origen real de cada compra; la vuelta diaria marca las claves de las compras de **todos** los orígenes incorporados,
   cada uno desde su propio corte. Las tablas ya tienen `sucursal_id`: **sin tablas ni columnas nuevas, sin tocar el
   respaldo**.
4. **`consultas.js`** — **NOMBRES (corrección 2026-11-17, segunda parada de Codex):** en `enCamino` el campo `origen` ya
   significa "tienda que envía el traspaso" y NO cambia. En TODO este despacho, donde dice `origen`/`origen_nombre` como
   campo nuevo de una factura o renglón, y el filtro por query `origen`, léase **`origen_factura`**,
   **`origen_factura_nombre`** y query **`origen_factura`** (en `listar` y en `enCamino` por igual). `totales_por_origen`,
   `origenes` y `origen_no_traslada` se quedan con esos nombres.
   - Todos los mapas hoy indexados solo por `com_id` (encabezados, renglones esperados, avisos activos, resultados) se
     indexan por **(sucursal_id, com_id)**: dos SICAR distintos pueden repetir número de compra y no se pueden pisar.
   - `listar` y `enCamino`: cada factura/renglón trae `origen` (sucursal_id) y `origen_nombre`. Filtro nuevo por query
     `origen` (validado contra `ORIGENES`; cualquier otro valor → 400). **No** uses `sucursal_id` como nombre del filtro
     (el navegador lo inyecta en toda petición: regla 5 de CLAUDE.md).
   - Totales de dinero: si hoy la respuesta trae totales, se mantienen con el mismo significado cuando hay un solo
     origen incorporado, y se agrega `totales_por_origen: { "<sucursal_id>": { …mismos campos… } }`. Con más de un
     origen y sin filtro `origen`, ningún campo de dinero suma orígenes distintos: decide la forma mínima y dila en el
     reporte (por ejemplo, el total general queda `null` y la pantalla usa `totales_por_origen`).
   - `detalle(sqlite, sucursal_id, com_id)`: acepta cualquier origen **incorporado** (`/7/<com_id>`); un número que no
     es origen incorporado → 404 como hoy.
   - `estrategias`: para una factura de un origen con `traslada: false` no hay sugerencias de traslado (lista vacía) y se
     marca `origen_no_traslada: true`; para una factura de CEDIS, las tiendas de `TIENDAS_APARTE` no entran en las
     velocidades/existencias candidatas (ni destino ni origen). Las etapas (`etapa()` en `estrategias.js`) no cambian:
     a los 45 días la etapa sigue llamándose `traslado` (los filtros no cambian); solo cambia el texto mostrado.
   - **Precios por cadena (decidido 2026-11-17, a raíz de la parada de Codex):** `ultimoPrecio()` (~línea 408) y el
     aviso de "SICAR cambia el precio por artículo" (`avisoArticuloCompartido` y las piezas recientes que lo alimentan)
     se calculan **solo con la cadena del origen de la factura**: para una factura de CEDIS, ventas y compras de las
     tiendas que NO están en `TIENDAS_APARTE`; para una de Innotec, solo las de Innotec (su propio SICAR cambia su
     precio por artículo de forma independiente). Regla general para cualquier otra consulta de `estrategias` que mire
     varias tiendas: misma separación. Define el helper una sola vez (p. ej. `tiendasDeLaCadena(origen)` en
     `config.js`) y úsalo en todas.
   - `tiendas()` (pestaña Tiendas) y la respuesta de la lista exponen qué orígenes están incorporados
     (`origenes: [{ sucursal_id, nombre, traslada }]`), para que la pantalla no repita la lista.
5. **`rutas.js`**: sin rutas nuevas ni permisos nuevos; solo pasar el filtro `origen`.
6. **Pantalla** (`src/seguimiento/SeguimientoFacturas.jsx`; textos y formato en `src/seguimiento/seguimiento.js` con
   prueba):
   - Título: **"Seguimiento de facturas"** (hoy dice "… CEDIS").
   - Lista y "En el camino y por aclarar": columna **"Origen"** (nombre) y un selector "Origen" (Todos + los orígenes
     incorporados que manda el servidor). Si solo hay un origen incorporado, el selector no se muestra y la columna
     puede omitirse (decide y dilo).
   - Totales: uno por origen, rotulado ("CEDIS: $…", "Innotec: $…"), nunca un total sumado.
   - Etapa `traslado` de una factura con `origen_no_traslada`: el aviso dice exactamente
     **"Revisar: Innotec no traslada a otras tiendas. Decide si conviene bajar el precio o moverla en la tienda."**
     (usa `origen_nombre`, no el texto fijo "Innotec").
   - Textos que hoy dicen "facturas de CEDIS" pasan a genéricos o usan el nombre del origen (línea ~406 "Mercancía de
     facturas de CEDIS…" → "Mercancía de facturas…"; ~559 confirmación de incorporar: si la tienda que se incorpora es un
     origen que no traslada, el texto dice "Desde ahora sus compras se siguen como facturas de <nombre> y sus ventas
     cuentan contra ellas. No se puede deshacer."; las demás, igual que hoy). `seguimiento.js:122` "catálogo de CEDIS"
     → "catálogo del origen" o el nombre del origen.
   - El detalle se abre con la `sucursal_id` del origen de esa factura (ya no 6 fijo).
   - `type="button"` explícito en botones nuevos; ninguna línea de más de 200 caracteres (classNames largos a constante).

## Archivos autorizados

`backend/seguimientoFactura/{config,lector,servicio,consultas,estrategias,rutas}.js` y sus `.test.js`;
`backend/seguimientoFactura/integracion.test.js`; `src/seguimiento/SeguimientoFacturas.jsx`, `src/seguimiento/seguimiento.js`,
`src/seguimiento/seguimiento.test.js`.
**Prohibido** todo lo demás: `motor.js`, `incorporar.js` (ya es genérico; si no lo fuera, detente y reporta),
`pendientes.js`, `sicar*.js`, `server.js`, `permisosCatalogo.js`, el respaldo, `render.yaml`, `agente-sicar/`.

## Reglas

- Sin dependencias nuevas. Acentos en UTF-8 real. Dinero en BigInt/texto, nunca float. Piezas en diezmilésimas BigInt.
- **El cuadre al centavo no cambia**: comprado = vendido + queda + tránsito + gris + por aclarar, por factura.
- Si mutas código para ver una prueba roja, revierte en el mismo paso.

## Pruebas mínimas

- **Regresión:** con solo CEDIS incorporado, todas las pruebas existentes pasan sin cambiar expectativas (salvo
  agregar `origen`, `origen_nombre`, `origenes`, `totales_por_origen` u `origen_no_traslada` a comparaciones de objeto
  completo: autorizado, lístalas).
- **Mismo número de compra en dos orígenes:** CEDIS compra `com_id 100` de la clave A y Innotec compra `com_id 100` de
  la clave A; ventas en Innotec bajan solo la factura de Innotec; ventas de una tienda Unisound abastecida por traspaso
  de CEDIS bajan solo la de CEDIS. Lista, detalle `/6/100` y `/7/100`, avisos y resultados no se pisan.
- Innotec incorporado con corte posterior: sus compras anteriores a su corte no se leen; las posteriores sí.
- Innotec sin incorporar: sus compras no aparecen aunque existan en `sicar_compras`.
- Factura de Innotec con 45+ días y saldo: etapa `traslado`, sin sugerencias, `origen_no_traslada: true`; a 60/90/120
  los mismos textos de margen/liquidar que CEDIS.
- Factura de CEDIS: Innotec (7) incorporado y con mucha venta de la clave **no** aparece como destino sugerido.
- Precios: costo $100, última venta Unisound $200, última venta Innotec $300 de la misma clave → la referencia de margen
  de la factura de CEDIS usa $200 y la de Innotec $300; el aviso de artículo compartido de cada una cuenta solo piezas
  de su cadena.
- Rescate: Innotec incorporado después del inicio con mostrador cargado **no** es elegible.
- Filtro `origen=7` solo trae Innotec; `origen=5` o `origen=abc` → 400. `totales_por_origen` correctos y separados.
- `detalle` con `/7/x` sin Innotec incorporado → 404.
- Pantalla: textos de "Revisar" y totales rotulados por origen en `seguimiento.test.js`.

## Detente y reporta (no improvises) si

- Hace falta tocar `motor.js`, `incorporar.js` u otro archivo prohibido, o agregar tablas/columnas.
- Una prueba existente cambia de expectativa por algo distinto a agregar las claves nuevas listadas arriba.
- Encuentras un lugar donde la suposición "solo hay un origen" cambia una cifra y no está cubierto aquí: descríbelo.

## Entrega

Conteo de pruebas por archivo, evidencia rojo→verde, eslint, `git status --short`, `git diff --stat`, pruebas que no
pudiste correr, pruebas existentes que ajustaste, decisiones no cubiertas (forma de los totales, selector con un solo
origen) y qué hay que probar en el navegador. Confirma que no dejas procesos corriendo.
