# Seguimiento por factura de CEDIS — plan de implementación (v2, revisado con Codex)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** De cada compra de CEDIS (la factura) posterior al arranque: cuánto se vendió y cuánto queda, en dinero y en
piezas, dónde está, y qué hacer (traslado a 45 días; margen 75 % a 60; 50 % a 90; a costo a 120).

**Architecture:** Un motor FIFO puro recibe, por clave de artículo, movimientos ya ordenados y devuelve el reparto de
cada lote (vendido, queda por tienda, tránsito, gris, por aclarar) en piezas exactas y centavos exactos. Un lector arma
esos movimientos desde `sicar_*` respetando el corte de cada tienda. Un servicio recalcula solo las claves pendientes y
guarda resultados completos por factura. Estrategias puras, rutas con permisos propios y una pantalla nueva.

**Tech Stack:** Node (`node --test`), Express, better-sqlite3 (ya en el repo), React/Vite. **Ninguna dependencia nueva.**

**Spec:** `docs/superpowers/specs/2026-11-04-seguimiento-factura-cedis-design.md` — leer completo, en especial §11 y §12
(contratos que mandan sobre cualquier texto anterior del spec).

## Global Constraints

- Rama `feature/seguimiento-factura`, worktree `C:\Users\Victor\Desktop\CORPUNISOUND\.claude\worktrees\seguimiento-factura`.
  Un solo responsable de escritura. **El implementador no commitea** (el sandbox de Codex no escribe en `.git`): deja
  el árbol listo y el controlador hace el commit con el mensaje de la task. El controlador corre la suite completa.
- Prohibido: dependencias nuevas, `git add .`, push/merge/rebase, `render.yaml`, archivos al disco de Render, líneas
  de más de 200 caracteres en `.js/.jsx` de `src/`, `backend/`, `agente-sicar/`. Interfaz con acentos UTF-8 reales.
- **Nada cambia precios, existencias, catálogo ni traspasos de SICAR.** Solo se lee `sicar_*` y se escriben tablas
  `seguimiento_*`. Única excepción: la columna `factor_diezmilesimas` de `sicar_compras_detalle` (Task 2).
- Piezas en **diezmilésimas exactas** (BigInt donde haga falta; en JSON como texto). Dinero en **centavos enteros**
  con reparto proporcional y residuos asignados en orden fijo (spec §12.3). Fechas solas con `fechaLocal()`.
- Ids de SICAR (`com_id`, `art_id`, `tra_id`, `ven_id`) son **texto** (hasta 128 dígitos): nunca `Number(...)`. Solo los
  ids propios del sistema (sucursal_id, id de aviso) se normalizan con `Number(...)`.
- Uniones: detalle→encabezado por `(sucursal_id, ven_id|com_id|tra_id)`; artículo→clave por `(sucursal_id, art_id)`
  en `sicar_articulos` de **esa** tienda; sucursal SICAR→CORPUNISOUND por `sicar_sucursales_mapa.sicar_sucursal`
  (TEXT); proveedor por `(sucursal_id, prv_id = pro_id)`. Mapa ausente o contradictorio = por aclarar. No copiar el
  comparador de `sicarTraspasos.js` (compara `art_id` entre tiendas).
- Valores iniciales configurables: etapas **45/60/90/120**; ganancia conservada **75 / 50 / 0 %**; traslado: **8**
  semanas (4 informativa), destino **≥ 2×**, ventas en **≥ 2** semanas, cobertura destino **< 4** semanas, reserva
  origen **2** semanas; datos atrasados = más de **2 días**; foto vieja = más de **24 h**.
- Permisos `ver_seguimiento_facturas` y `gestionar_seguimiento_facturas` (módulo `inventario`).
- Comandos (uno por llamada, 8 GB): agente `cd agente-sicar && node --preserve-symlinks --preserve-symlinks-main --test`;
  backend por archivo con las mismas banderas; `node --preserve-symlinks --preserve-symlinks-main --test src/seguimiento/*.test.js`;
  `npx eslint src backend agente-sicar` (0 errores); `npx vite build`.
- Prueba roja antes de implementar; si mutas código para verla, revierte en el mismo turno. No editar pruebas
  existentes salvo conteos de tablas (decirlo).
- **Detente y reporta** si necesitas un archivo fuera de tu task o el spec contradice la task.

## Review Focus

1. **Corte de arranque:** una venta de la mañana ya incluida en la foto no se descuenta otra vez (Task 4).
2. **Dinero al centavo:** 1 bolsa de $100 con 36 piezas vendida en partes: vendido + queda = $100.00 exactos (Task 5).
3. **Tienda sin agente / incorporada después:** lo enviado antes de incorporarla queda gris para siempre (Tasks 4, 5).
4. **Traspaso contradictorio** (origen cancelado, destino recibido; recepción menor) = por aclarar, nunca vendido (Task 4).
5. **Resultado obsoleto:** compra cancelada después borra sus resultados y avisos (Task 7).

---

### Task 1: Agente — piezas por empaque

**Files:** Modify `agente-sicar/mapeo.js`, `agente-sicar/formato.js`; pruebas `mapeo.test.js`, `formato.test.js`.

**Produces:** renglón de compra con `factor` texto decimal 4 cifras (`'36.0000'`); columna `detallec.factor` opcional
(sin ella `'1.0000'`, sin aviso nuevo); factor ≤ 0 o inválido → compra omitida `IMPORTE_INVALIDO`.

- [ ] Rojo: `factor '36'` → `'36.0000'`; sin columna → `'1.0000'` y la consulta no la pide; `'0'` → omitida; consultas
  pasan `seguridad.js`.
- [ ] Implementar; suite del agente verde. Commit (controlador): `feat(agente-sicar): manda piezas por empaque en compras`.

### Task 2: Servidor — factor de empaque

**Files:** Modify `backend/sicarIngesta.js`, `backend/sicarRepositorio.js` (columna `factor_diezmilesimas INTEGER NOT
NULL DEFAULT 10000` + migración), `backend/sicarRespaldo.js` (restaurar respaldo viejo con factor 10000); pruebas.
Create `backend/cantidades.js` exportando `aDiezmilesimas` (BigInt, movido desde `backend/sicarTraspasos.js:49`, que
pasa a importarlo; sin cambiar su comportamiento).

- [ ] Rojo: `factor '36'` → 360000; sin `factor` → 10000; `'0'` → 400; base vieja migra sin perder compras; respaldo
  viejo restaura con 10000; pruebas existentes de traspasos siguen verdes.
- [ ] Implementar. Commit: `feat(sicar): factor de empaque en compras`.

### Task 3: Tablas del seguimiento e incorporación de tiendas

**Files:** Modify `backend/sicarRepositorio.js` (tablas), `backend/sicarRespaldo.js` (en el respaldo, generación
nueva; si cambian conteos de tablas en pruebas existentes, solo el número); Create `backend/seguimientoFactura/incorporar.js`
y prueba.

**Produces (tablas):** `seguimiento_config (clave TEXT PK, valor TEXT NOT NULL, actor, fecha)` + `seguimiento_config_historial`;
`seguimiento_tiendas (sucursal_id PK, corte TEXT NOT NULL, actor, fecha)`; `seguimiento_foto (sucursal_id, clave,
piezas_diezmilesimas TEXT, PRIMARY KEY (sucursal_id, clave))`; `seguimiento_foto_problemas (sucursal_id, clave, motivo)`;
`seguimiento_pendientes (clave TEXT PK, desde TEXT)`; `seguimiento_resultado (sucursal_id, com_id, renglon, clave,
datos_json, version, calculado_en, PK (sucursal_id, com_id, renglon))`; `seguimiento_avisos (id PK, sucursal_id, com_id,
etapa, estado CHECK IN ('nuevo','revisado','pospuesto','retirado'), pospuesto_hasta, UNIQUE (sucursal_id, com_id, etapa))`
+ `seguimiento_avisos_historial (aviso_id, estado, motivo, actor, fecha)`.

**Produces (funciones):** `revisarFoto(sqlite, sucursal_id)` → `{ corte, claves, problemas: [{ clave, motivo }],
vieja: bool }` (corte = max `actualizado_en` de `sicar_existencias` de esa tienda; problemas: clave repetida, sin clave,
existencia negativa); `incorporar(sqlite, { sucursal_id, actor, ahora })` → guarda corte, foto y problemas; 409 si ya
está incorporada; 409 si la foto es vieja (> 24 h); 400 si la tienda no tiene agente.

- [ ] Rojo: foto con clave repetida la reporta y no la mete a la foto; existencia negativa reportada; foto de 25 h → 409;
  doble incorporación → 409; respaldo nuevo conserva tablas, viejo restaura vacías.
- [ ] Implementar. Commit: `feat(seguimiento): tablas e incorporacion de tiendas con foto`.

### Task 4: Lector de movimientos

**Files:** Create `backend/seguimientoFactura/lector.js` y prueba.

**Produces:** `movimientosPorClave(sqlite, clave)` → `{ movimientos, calidad }`. Cada movimiento:
`{ tipo: 'foto'|'compra'|'salida'|'recepcion'|'venta', fecha, sucursal_id, piezas (BigInt diezmilésimas),
valor_centavos? (compra), lote?: { sucursal_id, com_id, renglon }, traspaso?: { origen, destino, folio },
por_aclarar?: motivo }`. `calidad` = `{ datos_al, atrasadas: [sucursal_id], problemas: [...] }`.
- `foto`: de `seguimiento_foto` de cada tienda incorporada, en su corte.
- `compra`: renglones de compras **vigentes** de CEDIS con fecha-hora > corte de CEDIS; piezas = cantidad × factor;
  valor = `precio_sin_centavos × cantidad` (exacto).
- `salida`/`recepcion`: traspasos leídos **incluidos cancelados**; salida = origen (fecha, cantidad, estado);
  recepción = destino (`fecha_aplicado`, cantidad); mismo traspaso por (folio, suc_origen, suc_destino); contradicción,
  recepción menor/mayor, folio con varias coincidencias, mapa ausente o fecha del mismo día del corte → `por_aclarar`.
  Destino no incorporado → la salida va a "sin agente".
- `venta`: `sicar_detalles` + `sicar_detalles_mostrador` con encabezado `vigente`, sin cuentas internas (`NO_INTERNA` de
  `backend/sicarVentaReal.js`), fecha-hora > corte de esa tienda, clave por el catálogo de esa tienda.
- Orden: fecha; dentro del mismo día compras, luego salidas/recepciones, luego ventas; desempate estable por ids.

- [ ] Rojo: venta antes del corte no aparece; venta cancelada y a cuenta interna no aparecen; traspaso visto por dos
  SICAR aparece una vez; origen cancelado/destino recibido → por_aclarar; recepción menor → por_aclarar la diferencia;
  traspaso del mismo día del corte → por_aclarar; destino no incorporado → sin agente; compra con factor; mapa ausente.
- [ ] Implementar. Commit: `feat(seguimiento): lector de movimientos con corte por tienda`.

### Task 5: Motor FIFO

**Files:** Create `backend/seguimientoFactura/motor.js` y `motor.test.js` (puro).

**Produces:** `calcular(movimientos)` → `{ lotes: [{ lote, comprado, valor_centavos, vendido, por_sucursal: { [id]:
{ queda, vendido } }, transito, sin_agente, por_aclarar, dinero: { vendido, queda, transito, gris, por_aclarar } }],
anterior: { [sucursal_id]: piezas }, incierto: [motivo] }` (piezas como texto de diezmilésimas en la salida).
- La foto es el lote "anterior" de cada tienda y se consume primero; salidas consumen el lote más viejo del origen;
  recepciones lo hacen disponible en destino; ventas consumen FIFO de su tienda; nunca un lote futuro; venta sin piezas
  → `incierto`; traslados entre tiendas y retornos a CEDIS conservan la factura y su fecha.
- Dinero: reparto proporcional a piezas con residuos en orden fijo (spec §12.3).

- [ ] Rojo: foto antes que factura nueva; dos compras con costo distinto; bolsa $100 / 36 piezas vendida 10 + 10 + 16
  → dinero exacto $100.00; salida a no incorporada → gris; enviado sin recibir → tránsito; traslado conserva factura;
  venta sin existencia → incierto; conservación de piezas y de centavos en todos los casos.
- [ ] Implementar. Commit: `feat(seguimiento): motor FIFO con dinero exacto`.

### Task 6: Estrategias

**Files:** Create `backend/seguimientoFactura/estrategias.js` y prueba (puro).

**Produces:** `etapa(dias, config)`; `velocidades(ventasPorSemana, config)` → `{ [sucursal_id]: { v8, v4, semanas_con_venta } }`;
`sugerirTraslados({ saldoViejo, velocidades, existencias, transito, atrasadas, config })` → `[{ de, a, piezas, razon }]`
(las sugerencias de una misma clave **no compiten**: cada pieza se sugiere una sola vez; tienda atrasada o no
incorporada nunca es candidata; sin datos → `informacion_insuficiente`); `textoMargen({ costo_pieza_centavos,
ultimo_precio_centavos?, etapa, config })` (último precio solo como "referencia"; nunca abajo del costo);
`avisoArticuloCompartido(piezasRecientes)`.

- [ ] Rojo: límites 44/45, 59/60, 89/90, 119/120; destino 2× con cobertura < 4 semanas; cantidad = mínimo de los tres
  topes; dos destinos no se reparten la misma pieza dos veces; atrasada no candidata; textos 75/50/0.
- [ ] Implementar. Commit: `feat(seguimiento): estrategias de traslado y margen`.

### Task 7: Servicio de recálculo

**Files:** Create `backend/seguimientoFactura/servicio.js` y prueba; Modify `backend/sicarRepositorio.js` (al guardar un
lote del agente, marcar claves pendientes de compras, traspasos, ventas y existencias, dentro de la misma transacción).

**Produces:** `marcarPendientes(sqlite, sucursal_id, art_ids)`; `procesarPendientes(sqlite, { limite })` (lee, calcula,
reemplaza **todos** los renglones de cada factura afectada en una transacción, borra resultados de facturas canceladas o
sin claves, crea/retira avisos por etapa, guarda historial); `vueltaCompleta(sqlite)`; vencimiento de posposiciones.

- [ ] Rojo: lote con venta marca su clave; procesar dos veces no duplica avisos; compra cancelada borra resultados y
  retira aviso; posposición vencida vuelve a `nuevo`; un error a la mitad no deja una factura a medias.
- [ ] Implementar. Commit: `feat(seguimiento): recalculo por claves pendientes`.

### Task 8: Rutas y permisos

**Files:** Create `backend/seguimientoFactura/rutas.js` y `rutas.test.js`; Modify `backend/permisosCatalogo.js`,
`backend/server.js` (registrar rutas y ciclos con `setInterval(...).unref()` + try/catch `SEGUIMIENTO_FALLO`: pendientes
cada 5 min, vuelta completa diaria).

**Produces (todas `requiereLogin`):** con `ver_seguimiento_facturas`: `GET /api/seguimiento-facturas` (paginada,
filtros proveedor, folio, clave, desde, hasta, tienda, etapa, solo_aviso, ocultar_agotadas; orden inicial mayor costo
pendiente en aviso), `GET /api/seguimiento-facturas/:sucursal_id/:com_id`, `GET /api/seguimiento-facturas/tiendas`
(incorporadas y revisión de foto de las no incorporadas). Con `gestionar_seguimiento_facturas`:
`POST /api/seguimiento-facturas/tiendas/:sucursal_id/incorporar`, `POST /api/seguimiento-facturas/avisos/:id`
(`{ estado, motivo, pospuesto_hasta? }`; motivo obligatorio), `GET|PUT /api/seguimiento-facturas/config` (solo claves
conocidas y valores válidos, con historial). Actor del token.

- [ ] Rojo: rol con `ver_facturas_por_llegar` → 403; con `ver_seguimiento_facturas` → 200 pero 403 al incorporar,
  posponer y configurar; posponer sin motivo → 400; config desconocida → 400; `com_id` de 20 dígitos llega intacto.
- [ ] Implementar. Commit: `feat(seguimiento): rutas y permisos`.

### Task 9: Pantalla

**Files:** Create `src/seguimiento/SeguimientoFacturas.jsx`, `src/seguimiento/seguimiento.js` y `seguimiento.test.js`;
Modify `src/App.jsx` y el menú (entrada junto a Existencias/Traspasos SICAR, con `ver_seguimiento_facturas`).

- Lista: proveedor, folio, fecha, días, **barra de tramos vendido / queda / tránsito / gris / por aclarar en dinero y en
  piezas**, etapa, siguiente acción, comentario "COMPRA {TIENDA}" como referencia, "datos al {fecha}".
- Detalle por artículo y tienda con motivos de incertidumbre; estrategias con "Revisado" / "Posponer" (motivo y fecha)
  e historial.
- Sección "Tiendas en el seguimiento": incorporadas y, para las demás, hora de su foto, claves y problemas, con botón
  "Incorporar" (solo con permiso; deshabilitado si la foto es vieja) y confirmación que explica la foto.
- Sección "Configuración" con los valores y su historial (solo con permiso).
- Textos fijos: "Asignación estimada en orden de llegada (FIFO) según SICAR"; "Enviado, venta no comprobada";
  "Movimientos por aclarar"; "Información insuficiente".

- [ ] Rojo de funciones puras (porcentajes y textos de tramos, etapas, botones ocultos sin permiso, foto vieja).
- [ ] Implementar; pruebas, eslint, build. Commit: `feat(seguimiento): pantalla`.

### Task 10: Prueba integrada

**Files:** Create `backend/seguimientoFactura/integracion.test.js`.

- [ ] Flujo de punta a punta sobre base en memoria: incorporar CEDIS y Ocosingo → compra con empaque → traspaso a
  Ocosingo con recepción parcial → ventas → cancelación de una venta → recálculo → respaldo y restauración; verificar
  piezas, dinero al centavo, por aclarar e incertidumbre. Medir que `procesarPendientes` con 30,000 ventas de una tienda
  no bloquee más de 1 s por bloque (reportar el tiempo).
- [ ] Commit: `test(seguimiento): flujo integrado`.

---

**Después (Claude):** revisión de la rama completa, prueba en navegador con copia de base y reporte a Victor.
Despliegue con su autorización: servidor → agente de CEDIS (factor) → incorporar CEDIS, Ocosingo y San Cristóbal desde
la pantalla.
