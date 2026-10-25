# Seguimiento de facturas — Fases A (traspasos) y B (facturas por llegar) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que cada tienda mande sus traspasos de SICAR (enviados, recibidos, cancelados) y CORPUNISOUND los muestre con
alertas; y que la administradora registre facturas por llegar desde el XML.

**Architecture:** Colección opcional nueva `traspasos` en el lote SICAR (molde: `cortes`, commits a72c69f/c80446a),
tablas `sicar_*` en la misma SQLite con respaldo; facturas por llegar en tablas propias de la misma SQLite, con rutas y
pantalla aparte.

**Tech Stack:** Node (agente `mysql2`; servidor Express + better-sqlite3), React + Vite, `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-25-seguimiento-facturas-design.md` (secciones 3, 4, 5, 6, 9, 10). Fases C y D
quedan fuera.

## Global Constraints
- Sin dependencias nuevas; líneas ≤ 200 en `src/`/`backend/`; staging explícito; commits sin acentos; sin
  push/merge/rebase; suites en 0 fallas; eslint 0 errores.
- SICAR solo lectura por `validarSQL` (sin comillas: textos como parámetro; sin `SUM`).
- Interruptor `"traspasos"` en `config.json`, booleano, apagado si no es `true`. Nada de esto puede frenar las ventas.
- Traspasos sin nombres de sucursal (`aliasOri`/`aliasDes` no se mandan).
- Importes con 2 decimales, cantidades con 4, exactos (BigInt / texto), igual que `ventas`.
- Alcance: sin `ver_todas_las_sucursales`, solo lo de la tienda del token (regla 5).
- uuid normalizado: mayúsculas y sin espacios, al guardar y al comparar.

## Review Focus
1. Un traspaso que pasa de "enviado" a "recibido" o "cancelado" después de mandado se actualiza (no queda viejo) → T4.
2. Un XML de nota de crédito, complemento de pago o sin uuid no entra como factura por llegar → T2.
3. Mismo uuid en mayúsculas/minúsculas o ya recibido como compra → no se duplica / queda `llegó` → T2.
4. Un usuario sin "ver todas" no ve traspasos de otra tienda aunque pida `?sucursal_id=` → T5.
5. Respaldos viejos (generación actual de 26 tablas, con y sin bandeja) siguen restaurando → T3.

---

### Task 1: Contrato y recepción de `traspasos`
**Files:** `backend/sicarIngesta.js`, `backend/sicarRepositorio.js`, `docs/sicar-contrato-v1.md` y las 4 pruebas
espejo (molde a72c69f).
**Interfaces:**
- Fila: `{ tra_id, folio, suc_origen, suc_destino, fecha (YYYY-MM-DD), estado ('enviado'|'recibido'|'cancelado'),
  fecha_aplicado (YYYY-MM-DDTHH:MM:SS|null), fecha_cancelado (…|null), total (2 dec), detalle: [{ art_id, cantidad (4
  dec), precio_sin (2 dec), precio_con (2 dec) }] }`. `tra_id`, `art_id`, `suc_origen`, `suc_destino` ids texto; `folio`
  texto ≤ 45; ≤ 100 traspasos y ≤ 1,000 renglones por lote; sin `tra_id` repetido; detalle ≤ 500 sin `art_id` repetido.
- Tablas `sicar_traspasos` (PK `sucursal_id`, `tra_id`; columnas de la fila; `total_centavos`; `actualizado_en`) y
  `sicar_traspasos_detalle` (PK `sucursal_id`, `tra_id`, `art_id`; `cantidad` texto; `precio_sin_centavos`,
  `precio_con_centavos`). Upsert; reenviar reemplaza el detalle en la misma transacción. Recibo `aceptados.traspasos`.
- En el mismo esquema se crean (vacías, las usa Task 5) `sicar_sucursales_mapa (sicar_sucursal TEXT PK, sucursal_id
  INTEGER, asignado_por TEXT, asignado_en TEXT)` y `sicar_sucursales_mapa_historial (id INTEGER PK, sicar_sucursal,
  anterior, nuevo, actor, fecha)`.
- [ ] Pruebas rojas (validación, repositorio, contrato) → implementar → suites en 0 → **Commit**
  `feat(sicar): coleccion opcional traspasos con su detalle`

### Task 2: Facturas por llegar (backend)
**Files:** `backend/cfdi.js` (+ test), Create `backend/facturasPorLlegar.js` (+ test), `backend/permisosCatalogo.js`,
`backend/server.js` (rutas), `backend/sicarRepositorio.js` (tablas en el mismo `CREATE`).
**Interfaces:**
- `parsearFacturaXML` agrega `total` (texto de `Comprobante.Total`) y `tipoComprobante` sin cambiar lo demás (la prueba
  de Recepción de Compras sigue igual).
- Tablas `facturas_por_llegar (id INTEGER PK, uuid TEXT UNIQUE, rfc_emisor, nombre_emisor, fecha_emision, total_centavos,
  conceptos_json, estado CHECK in ('por_llegar','llego','cancelada'), creada_por, creada_en, llego_en, llego_por, motivo)`
  y `facturas_por_llegar_historial (id, factura_id, accion, actor, fecha, detalle)`.
- Rutas: `POST /api/facturas-por-llegar` (`registrar_facturas_por_llegar`; cuerpo `{ xml }`), `GET` lista
  (`ver_facturas_por_llegar`; filtros estado; `dias_espera`; aviso si `por_llegar` > 15 días),
  `POST /:id/llego` y `POST /:id/cancelar` (`registrar_facturas_por_llegar`; cancelar exige motivo 3–200).
- Al registrar y al listar: si `DB.inventario.compras` tiene el mismo uuid (normalizado) → `llego` automático con
  `llego_por: 'recepcion'`.
- [ ] Pruebas rojas: XML válido Ingreso entra; tipo `E`/`P`/`N` → 400; sin uuid → 400; XML ilegible → 400; uuid repetido
  (otra capitalización) → 409; compra ya recibida con ese uuid → queda `llego`; permisos con roles vecinos; historial de
  cada acción → implementar → suites → **Commit** `feat(compras): facturas por llegar desde el XML del proveedor`

### Task 3: Respaldo con las tablas nuevas
**Files:** `backend/sicarRespaldo.js` (+ tests; molde e0d018f).
- Agregar al final de `TABLAS`: `sicar_traspasos`, `sicar_traspasos_detalle`, `sicar_sucursales_mapa`,
  `sicar_sucursales_mapa_historial` (creadas en Task 1),
  `facturas_por_llegar`, `facturas_por_llegar_historial`; congelar la forma actual (26) con y sin bandeja; nuevas
  generaciones al final.
- [ ] Pruebas: respaldo de 26 (con y sin bandeja) restaura y deja vacías las nuevas; uno nuevo las conserva; manifiesto
  incoherente se rechaza → **Commit** `feat(sicar): traspasos y facturas por llegar en el respaldo`

### Task 4: Agente — traspasos
**Files:** `agente-sicar/mapeo.js`, `formato.js`, `estado.js`, `corrida.js`, `configuracion.js`, `index.js`,
`config.ejemplo.json`, `LEEME.md` + pruebas.
**Interfaces:**
- `COLUMNAS_TRASPASOS = { traspaso: ['tra_id','folio','sucOri','sucDes','fecha','total','status','fechaApl','fechaCan'],
  detallet: ['tra_id','art_id','cantidad','precioSin','precioCon'] }`; opcional (falta → `TRASPASOS_NO_DISPONIBLES`).
- `status` 2 → `recibido`, 1 → `enviado`, −1 → `cancelado`; otro valor → omitido (`TRASPASO_OMITIDO`), sin frenar.
- Cursor `traspasos_cursor` por `tra_id`; en cada corrida además releer: todos los `status = 1` y los de `fecha`,
  `fechaApl` o `fechaCan` en los últimos 30 días; vuelta completa semanal de noche (`traspasos_semana`). Va al final de
  `ejecutar`, después de cortes y mostrador.
- `--verificar`: columnas, faltantes, total, abiertos.
- [ ] Pruebas rojas: alta, cambio de 1→2 y 1→−1 reenviado, cursor solo con confirmación, interruptor apagado sin clave,
  lote de solo traspasos atorado se descarta como cortes/existencias, fechas imposibles → omitido → **Commit**
  `feat(agente-sicar): traspasos enviados, recibidos y cancelados`

### Task 5: Consultas de traspasos, mapa de sucursales y permisos
**Files:** Create `backend/sicarTraspasos.js` (+ test); `backend/sicarRutas.js`; `backend/permisosCatalogo.js`.
**Interfaces:**
- Usa las tablas `sicar_sucursales_mapa` e historial creadas en Task 1.
- `GET /api/sicar/traspasos?desde=&hasta=&estado=` (`ver_traspasos_sicar`, módulo `inventario`; alcance por token; tope
  366 días) → lista con `origen`/`destino` (nombre de tienda si está en el mapa, si no "SICAR N"), `dias_en_transito`,
  alertas: `sin_recibir_3_dias`, `cancelado`; y, cuando el mismo traspaso existe en las dos puntas (unido por `folio`,
  `suc_origen`, `suc_destino`), diferencias por artículo enviado vs recibido.
- `GET/PUT /api/sicar/sucursales-mapa` (GET `ver_traspasos_sicar`; PUT `administrar_sucursales`, con historial).
- [ ] Pruebas rojas (alcance, permisos vecinos, alertas, diferencias, mapa) → **Commit**
  `feat(sicar): traspasos con alertas y mapa de sucursales`

### Task 6: Pantallas
**Files:** Create `src/sicar/TraspasosSicar.jsx`, `src/sicar/traspasosSicar.js` (+ test), `src/compras/FacturasPorLlegar.jsx`,
`src/compras/facturasPorLlegar.js` (+ test); `src/menuCategorias.js`, `src/App.jsx`, `src/BarraLateral.jsx`.
- Traspasos SICAR (Operación, `ver_traspasos_sicar`): filtros, tabla, alertas arriba, desglose por artículo, mapa de
  sucursales (solo con `administrar_sucursales`). Manda siempre su propio `sucursal_id` (como CortesSicar).
- Facturas por llegar (Operación, `ver_facturas_por_llegar`): subir XML (con `registrar_facturas_por_llegar`), lista con
  días de espera y aviso > 15 días, marcar llegó / cancelar con motivo; nota "El sistema no valida la factura ante el SAT".
- [ ] Pruebas puras + menú → eslint, build → prueba en navegador (controlador) → **Commit**
  `feat(compras): pantallas de traspasos SICAR y facturas por llegar`
