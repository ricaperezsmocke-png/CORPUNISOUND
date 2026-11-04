# Seguimiento por factura de CEDIS — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** De cada compra de CEDIS (la factura) desde el día de arranque: cuánto se vendió y cuánto queda, en dinero y
en piezas, dónde está, y qué hacer (traslado a 45 días; margen 75 % a 60; 50 % a 90; a costo a 120).

**Architecture:** Un motor FIFO puro (`backend/seguimientoFactura/motor.js`) recibe, por clave de artículo, los
movimientos en orden (foto de arranque, compras CEDIS, traspasos, ventas) y devuelve cuánto de cada lote se vendió, dónde
está y qué quedó por aclarar. Un lector arma esos movimientos desde las tablas `sicar_*`; un ciclo recalcula y guarda
el resultado. Las estrategias son funciones puras sobre ese resultado. Rutas con permisos propios y una pantalla nueva.

**Tech Stack:** Node (`node --test`), Express, better-sqlite3 (ya en el repo), React/Vite. **Ninguna dependencia nueva.**

**Spec:** `docs/superpowers/specs/2026-11-04-seguimiento-factura-cedis-design.md` (leer completo, incluido §11).

## Global Constraints

- Rama `feature/seguimiento-factura`, worktree `C:\Users\Victor\Desktop\CORPUNISOUND\.claude\worktrees\seguimiento-factura`,
  base `master` 16856f1 + spec 3f5d664. Un solo responsable de escritura.
- Prohibido: dependencias nuevas, `git add .`, push/merge/rebase, `render.yaml`, archivos al disco de Render, líneas
  de más de 200 caracteres en `.js/.jsx` de `src/`, `backend/` y `agente-sicar/`. Commits sin acentos; interfaz con
  acentos UTF-8 reales.
- **Nada de esto cambia precios, existencias, catálogo ni traspasos.** Solo lee `sicar_*` y escribe sus propias tablas
  `seguimiento_*`.
- Cantidades en **diezmilésimas enteras** (`aDiezmilesimas` de `backend/sicarTraspasos.js:105`), dinero en **centavos
  enteros**, sin float. Fechas solas con `fechaLocal()`; marcas ISO UTC.
- Números de sucursal SICAR se traducen con `sicar_sucursales_mapa`; CEDIS es la sucursal 6 de CORPUNISOUND.
- Valores iniciales (configurables, tabla `seguimiento_config`): etapas **45/60/90/120 días**; ganancia conservada
  **75 % / 50 % / 0 %**; traslado: ventana **8 semanas** (y 4 informativa), destino **≥ 2×** velocidad, ventas en
  **≥ 2 semanas** distintas, cobertura destino **< 4 semanas**, reserva origen **2 semanas**.
- Permisos nuevos `ver_seguimiento_facturas` y `gestionar_seguimiento_facturas` (módulo `inventario`).
- Pruebas: agente `cd agente-sicar && node --preserve-symlinks --preserve-symlinks-main --test`; backend archivo por
  archivo con las mismas banderas (la suite completa la corre el controlador); `node --test src/seguimiento/*.test.js`;
  `npx eslint src backend agente-sicar`; `npx vite build`. Uno por comando (8 GB).
- Prueba roja antes de implementar; si mutas código para verla, revierte en el mismo turno.
- **Detente y reporta** si: necesitas un archivo fuera de la lista de tu task; una prueba existente se rompe sin ser
  un conteo de tablas; o el spec contradice la task.

## Review Focus

1. **Venta vieja vs factura nueva:** un artículo con existencia en la foto de arranque y una compra nueva: las primeras
   ventas descuentan la foto, no la factura (Task 4).
2. **Empaque:** compra de 1 bolsa con factor 36 = 36 piezas y costo por pieza = importe/36; un traspaso de 36 piezas
   la vacía en CEDIS (Tasks 1, 2, 4).
3. **Tienda sin agente:** lo que CEDIS le mandó queda en gris, nunca vendido ni "queda", y no genera avisos (Tasks 4, 6).
4. **Traspaso visto por dos SICAR** cuenta una vez; diferencia de cantidad = "en tránsito por aclarar" (Tasks 3, 4).
5. **Venta cancelada o a cuenta interna** no descuenta nada (Task 3).

---

### Task 1: Agente — piezas por empaque (`factor`) en compras

**Files:** Modify `agente-sicar/mapeo.js`, `agente-sicar/formato.js` y pruebas (`mapeo.test.js`, `formato.test.js`).

**Interfaces — Produces:** cada renglón de `compra.detalle` agrega `factor: string` decimal (ej. `'36.0000'`); si la
columna `detallec.factor` no existe en ese SICAR, `'1.0000'` sin aviso nuevo (columna **opcional**, como `proveedor.rfc`).
Factor ≤ 0 o inválido → compra omitida `IMPORTE_INVALIDO`.

- [ ] Rojo: renglón `cantidad '1', factor '36'` → `factor '36.0000'`; sin columna → `'1.0000'` y la consulta no la pide;
  `factor '0'` → omitida. Las consultas pasan `seguridad.js`.
- [ ] Implementar; suite del agente verde; commit `feat(agente-sicar): manda piezas por empaque en compras`.

### Task 2: Servidor — guardar `factor` y tablas del seguimiento

**Files:** Modify `backend/sicarIngesta.js` (validar `factor` opcional, decimal > 0, ≤ 4 decimales),
`backend/sicarRepositorio.js` (columna `factor_diezmilesimas INTEGER NOT NULL DEFAULT 10000` en
`sicar_compras_detalle`, migración; tablas nuevas), `backend/sicarRespaldo.js` (tablas nuevas en el respaldo, generación
nueva), pruebas de esos archivos. Si cambian conteos de tablas en pruebas existentes, solo el número.

**Interfaces — Produces (tablas):**
- `seguimiento_config (clave TEXT PRIMARY KEY, valor TEXT NOT NULL, actor TEXT, fecha TEXT)` con los valores de
  Global Constraints y `fecha_arranque` (NULL = no ha arrancado).
- `seguimiento_foto (sucursal_id INTEGER, clave TEXT, piezas_diezmilesimas INTEGER, PRIMARY KEY (sucursal_id, clave))`.
- `seguimiento_resultado (sucursal_id INTEGER, com_id TEXT, renglon INTEGER, clave TEXT, datos_json TEXT, version TEXT,
  calculado_en TEXT, PRIMARY KEY (sucursal_id, com_id, renglon))`.
- `seguimiento_avisos (id INTEGER PRIMARY KEY, sucursal_id INTEGER, com_id TEXT, etapa TEXT, estado TEXT CHECK IN
  ('nuevo','revisado','pospuesto'), pospuesto_hasta TEXT, motivo TEXT, actor TEXT, fecha TEXT,
  UNIQUE (sucursal_id, com_id, etapa))`.
- Lote sin `factor` (agente viejo) se guarda con factor 1. Reenvío idempotente igual que hoy.

- [ ] Rojo: compra con `factor '36'` se guarda 360000; sin `factor` → 10000; `factor '0'` → 400; migración de base vieja
  sin la columna conserva compras; respaldo nuevo conserva las tablas `seguimiento_*`, uno viejo restaura vacías.
- [ ] Implementar; archivos verdes; commit `feat(sicar): factor de empaque y tablas del seguimiento por factura`.

### Task 3: Lector de movimientos y arranque

**Files:** Create `backend/seguimientoFactura/lector.js`, `backend/seguimientoFactura/arranque.js` y sus pruebas.

**Interfaces — Produces:**
- `arrancar(sqlite, { fecha, actor })`: si `fecha_arranque` es NULL, guarda la fecha y llena `seguimiento_foto` con la
  existencia actual de cada sucursal con agente (`sicar_existencias` → clave por `sicar_articulos`); si ya arrancó → 409.
  Clave repetida en una tienda → esa clave se marca ambigua (no entra a la foto, se reporta).
- `movimientosPorClave(sqlite, clave, { desde })` → arreglo ordenado de
  `{ tipo: 'foto'|'compra'|'salida'|'recepcion'|'venta', fecha, orden, sucursal_id, piezas, costo_pieza_centavos?,
     lote?: { sucursal_id, com_id, renglon }, traspaso?: { folio, origen, destino }, por_aclarar?: string }`:
  - `compra`: renglones de compras **vigentes** de CEDIS con fecha ≥ arranque; piezas = cantidad × factor;
    costo_pieza = importe_con sin IVA / piezas (usa `precio_sin` × cantidad / piezas, en centavos enteros, redondeo
    mitad hacia arriba).
  - `salida`/`recepcion`: traspasos no cancelados; la salida la dicta el SICAR origen, la recepción el destino;
    mismo traspaso en ambos se une por (folio, suc_origen, suc_destino) y cuenta una vez; diferencia de cantidad →
    `por_aclarar`. Destino sin agente → la salida llega a "sin agente".
  - `venta`: `sicar_detalles` + `sicar_detalles_mostrador` con encabezado vigente, sin cuentas internas (`NO_INTERNA`
    de `backend/sicarVentaReal.js`), fecha ≥ arranque, por art_id de cada tienda → clave.
  - Orden: por día; dentro del día, compras primero, luego salidas/recepciones, luego ventas; desempate estable por id.
- `clavesConFacturas(sqlite)` → claves con al menos un renglón de compra desde el arranque.

- [ ] Rojo: venta cancelada y venta a cuenta interna no aparecen; traspaso visto por dos SICAR aparece una vez;
  diferencia de cantidad marca `por_aclarar`; destino sin agente; compra con factor; orden dentro del día; arranque
  dos veces → 409; clave ambigua reportada.
- [ ] Implementar; verdes; commit `feat(seguimiento): lector de movimientos y arranque con foto`.

### Task 4: Motor FIFO

**Files:** Create `backend/seguimientoFactura/motor.js` y `motor.test.js` (puro, sin base de datos).

**Interfaces — Consumes:** movimientos de Task 3. **Produces:** `calcular(movimientos)` →
`{ lotes: [{ lote, comprado, vendido, por_sucursal: { [sucursal_id]: { queda, vendido } }, transito, sin_agente,
por_aclarar, costo_pieza_centavos }], anterior: { [sucursal_id]: piezas }, incierto: bool }` (piezas en diezmilésimas).
- La foto es el lote "anterior" de cada sucursal y se consume primero; salidas consumen el lote más viejo de su origen;
  recepciones lo vuelven disponible en destino; ventas consumen FIFO de su tienda; nunca se consume un lote futuro; una
  venta sin piezas disponibles marca `incierto` (no inventa).

- [ ] Rojo (cada uno su prueba): foto antes que factura nueva; dos compras con costos distintos se consumen en orden;
  empaque de 36; salida a tienda sin agente → `sin_agente`; enviado sin recibir → `transito`; traslado entre tiendas
  conserva la factura y no reinicia fecha; venta sin existencia → `incierto`; conservación: comprado = vendido + queda +
  tránsito + sin_agente + por_aclarar.
- [ ] Implementar; verdes; commit `feat(seguimiento): motor FIFO por factura`.

### Task 5: Estrategias

**Files:** Create `backend/seguimientoFactura/estrategias.js` y prueba (puro).

**Interfaces — Produces:** `etapa(dias, config)` → `'sin_aviso'|'traslado'|'margen_75'|'margen_50'|'liquidar'`;
`sugerirTraslado({ porSucursal, velocidades, existencias, transito, config })` →
`[{ de, a, piezas, razon }]` o `[]` con `razon:'informacion_insuficiente'`; `textoMargen({ costo_pieza, ultimo_precio,
etapa, config })` → texto con la regla y, si hay último precio vendido, marcado "referencia"; `avisoArticuloCompartido`
cuando hay piezas del mismo artículo de compras de menos de 45 días.
- Fórmulas de Global Constraints y spec §5; velocidad = piezas vendidas en las últimas N semanas completas / N.

- [ ] Rojo: límites exactos 44/45, 59/60, 89/90, 119/120; traslado con destino 2× y cobertura < 4 semanas; cantidad =
  mínimo de los tres topes; destino sin agente nunca es candidato; sin datos → informacion_insuficiente; texto de margen
  75/50/0 con costo $X; nunca precio debajo del costo.
- [ ] Implementar; verdes; commit `feat(seguimiento): estrategias de traslado y margen`.

### Task 6: Cálculo guardado, rutas y permisos

**Files:** Create `backend/seguimientoFactura/servicio.js` y prueba; Modify `backend/permisosCatalogo.js`,
`backend/server.js` (rutas y ciclo).

**Interfaces — Produces:**
- `recalcular(sqlite)`: para cada clave de `clavesConFacturas`, lee, calcula y guarda `seguimiento_resultado` en una
  transacción con `version` y `calculado_en`; crea `seguimiento_avisos` 'nuevo' por cambio de etapa (UNIQUE evita
  duplicados). Ciclo cada 15 min con `setInterval(...).unref()` y try/catch que registre `SEGUIMIENTO_FALLO`.
- Rutas (todas `requiereLogin`): `GET /api/seguimiento-facturas` (lista paginada, filtros: proveedor, folio, clave,
  desde, hasta, tienda, etapa, solo_aviso, ocultar_agotadas) y `GET /api/seguimiento-facturas/:sucursal/:com_id`
  (detalle) con `ver_seguimiento_facturas`; `POST /api/seguimiento-facturas/arrancar`, `POST
  /api/seguimiento-facturas/avisos/:id` (`{ estado: 'revisado'|'pospuesto', motivo, pospuesto_hasta? }`) y `PUT
  /api/seguimiento-facturas/config` con `gestionar_seguimiento_facturas`. Actor del token; ids con `Number(...)`;
  motivo obligatorio al posponer; config solo claves de la lista y valores válidos.
- Respuesta de la lista por factura: proveedor, folio, fecha, días, etapa, `dinero: { comprado, vendido, queda, gris }`,
  `piezas: { ... }`, siguiente acción, aviso vigente.

- [ ] Rojo: permisos vecinos (rol con `ver_facturas_por_llegar` → 403); con `ver_seguimiento_facturas` → 200 sin poder
  arrancar ni posponer; posponer sin motivo → 400; config con clave desconocida → 400; recalcular dos veces no duplica
  avisos; un fallo del cálculo no tumba el servidor.
- [ ] Implementar; archivos verdes; commit `feat(seguimiento): calculo guardado, rutas y permisos`.

### Task 7: Pantalla "Seguimiento de facturas CEDIS"

**Files:** Create `src/seguimiento/SeguimientoFacturas.jsx`, `src/seguimiento/seguimiento.js` (funciones puras de
texto/barra) y `src/seguimiento/seguimiento.test.js`; Modify `src/App.jsx` y el menú (entrada junto a Existencias/
Traspasos SICAR, visible con `ver_seguimiento_facturas`).

- Lista con barra de tres tramos (vendido / queda / gris) mostrando **dinero y piezas**, etapa y siguiente acción;
  filtros del spec §6; detalle por artículo y tienda; estrategias con botones "Revisado" y "Posponer" (solo con
  `gestionar_seguimiento_facturas`; posponer pide motivo y fecha). Botón "Arrancar seguimiento" visible solo si no ha
  arrancado y con el permiso, con confirmación que explica la foto de existencias.
- Textos: encabezado "Asignación estimada en orden de llegada (FIFO) según SICAR"; gris "Enviado, venta no
  comprobada"; "Movimientos por aclarar"; "Información insuficiente".

- [ ] Rojo de las funciones puras (porcentajes y textos de barra, etapa, botones ocultos sin permiso).
- [ ] Implementar; `node --test src/seguimiento/*.test.js`, eslint, build; commit `feat(seguimiento): pantalla`.

---

**Después de la Task 7 (Claude):** revisión de rama completa, prueba en navegador con copia de base (arrancar, compra con
empaque, traspaso a tienda con y sin agente, ventas, etapas forzando fechas, posponer), reporte a Victor. Despliegue
con autorización de Victor: servidor, luego agente de CEDIS (factor), luego "Arrancar seguimiento" desde la pantalla.
