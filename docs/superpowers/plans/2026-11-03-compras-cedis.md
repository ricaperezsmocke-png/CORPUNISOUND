# Compras de CEDIS y unión con facturas por llegar — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El agente de CEDIS manda las compras de SICAR y el servidor las une solas con las facturas por llegar
según las reglas aprobadas por Victor; lo dudoso se confirma a mano y lo que no cuadra sale en rojo.

**Architecture:** Colección nueva `compras` en `agente-sicar` (mismo patrón que `traspasos`: cursor + relectura +
vuelta completa + omitidas), tablas `sicar_compras*` en la base SQLite de SICAR, y un módulo nuevo
`backend/facturasCompras.js` que decide la unión. La pantalla `src/compras/FacturasPorLlegar.jsx` muestra uniones,
"Por confirmar" y los rojos.

**Tech Stack:** Node (`node --test`), Express, better-sqlite3 (ya en el repo), React/Vite. **Ninguna dependencia nueva.**

**Spec:** `docs/superpowers/specs/2026-11-03-compras-cedis-design.md` (léelo completo antes de la Task 1).

## Global Constraints

- Rama `feature/compras-cedis`, worktree `C:\Users\Victor\Desktop\CORPUNISOUND\.claude\worktrees\compras-cedis`, base
  `master` a2573fd + spec d179e04. Un solo responsable de escritura en este worktree.
- Prohibido: dependencias nuevas, `git add .`, push/merge/rebase, tocar `render.yaml`, subir archivos al disco de
  Render, líneas de más de 200 caracteres en `.js`/`.jsx` de `src/`, `backend/` y `agente-sicar/`.
- Commits sin acentos; código e interfaz con acentos (UTF-8 real: revisar que no salga mojibake como `Ã©`).
- Pruebas del agente: `cd agente-sicar && node --preserve-symlinks --preserve-symlinks-main --test`.
  Backend: `cd backend && node --test`. Pantallas: `node --test src/compras/*.test.js`. `npx eslint src backend agente-sicar`
  con 0 errores. El equipo tiene 8 GB: corre cada suite en un comando aparte.
- Dinero en **centavos enteros**. Fechas solas con `fechaLocal()`; marcas completas ISO UTC.
- Toda decisión de unión ocurre **en el servidor**. La pantalla solo muestra y manda la elección.
- Reglas de unión (verbatim del spec): RFC; total con margen máximo **$1.00 (100 centavos)**; folio; compra del mismo
  día o posterior a la emisión y **dentro de 60 días**; si hay duda no une sola; rojo a los **15 días**.
- Permiso nuevo `conciliar_facturas` (módulo `inventario`) en `backend/permisosCatalogo.js`. Ver sigue con
  `ver_facturas_por_llegar`.
- El agente es solo lectura: no tocar la lista de prohibidos de `agente-sicar/seguridad.js`; toda consulta nueva debe
  pasar `seguridad.js` tal como está.
- Prueba roja antes de implementar en cada task. Si mutas código para verla, revierte en el mismo turno.
- **Detente y reporta** (no improvises) si: una prueba existente se rompe y no es por tu cambio; necesitas cambiar el
  contrato de una colección que ya existe (que no sea agregar `rfc` opcional a proveedores); o una task exige tocar un
  archivo fuera de su lista.

## Review Focus

1. **Compra con descuento global o redondeo raro:** el total que manda el agente es la suma de `importeCon` del detalle;
   si difiere del XML por más de $1 no se une sola y queda sin candidata. Prueba en Task 4: diferencia de 101 centavos
   → sin candidata; de 100 → candidata.
2. **RFC con minúsculas, espacios o guiones en SICAR** (`"abc-010101 xy9 "`): debe unir igual que `ABC010101XY9`.
   Prueba en Task 1 (normalización en el agente) y Task 4 (comparación en el servidor).
3. **Folio con serie o ceros** (`"A-000123"` en SICAR contra serie `A` folio `123` del XML): coincide. Folio vacío en
   SICAR: nunca une sola. Prueba en Task 4.
4. **Compra cancelada en SICAR después de unida** llega en una relectura: la factura vuelve a `por_llegar`, queda en el
   historial y sale en rojo. Prueba en Task 4.
5. **Proveedor sin RFC** (o RFC que la columna no trae porque SICAR no la tiene): la compra nunca es candidata y su
   proveedor aparece en "Proveedores sin RFC" con su número de compras. Prueba en Task 4 y Task 5.

---

### Task 1: Agente — lectura de compras de SICAR y RFC de proveedores

**Files:**
- Modify: `agente-sicar/mapeo.js` (columnas, `comprasDisponibles`, `compras()`, `rfc` opcional en `proveedores()`)
- Modify: `agente-sicar/formato.js` (`compraSegura`, `rfc` en `proveedorSeguro`)
- Modify: `agente-sicar/configuracion.js` (interruptor `compras`)
- Test: `agente-sicar/mapeo.test.js`, `agente-sicar/formato.test.js`, `agente-sicar/configuracion.test.js`
  (si un archivo de prueba no existe con ese nombre, usa el que ya prueba `traspasos` en ese módulo)

**Interfaces:**
- Produces:
  - `fuente.comprasDisponibles: boolean` (como `traspasosDisponibles`). Columnas requeridas:
    `compra: com_id, fecha, pro_id, folio, comentario, status`; `detallec: com_id, art_id, cantidad, precioSin,
    precioCon, importeCon`. Si falta alguna: `comprasFaltantes` con `tabla.columna` y aviso `COMPRAS_NO_DISPONIBLES`
    en `--verificar` (sección `compras` en el resumen de verificación, como `proveedores`).
  - `fuente.compras(cursor: string, limite: number, desde: string|null) → { compras: fila[], detalles: fila[],
    cancelaciones: { id, fecha }[] }`. Una sola página/transacción como `traspasos()`. Sin `desde`: `com_id > cursor`
    por orden de `com_id`. Con `desde` (`YYYY-MM-DD`): relectura de las de `fecha >= desde` con `com_id > cursor`.
    `cancelaciones`: `historial` con `tabla = ?` (parámetro `'Compra'`) y `movimiento = 2` para esos `com_id`.
    Tope por página: `MAXIMO_COMPRAS = 100`.
  - `fuente.proveedores()` agrega `rfc` **solo si** la columna `proveedor.rfc` existe (se detecta en la misma
    verificación de columnas); si no existe, las filas salen sin `rfc` y no hay aviso nuevo.
  - `compraSegura({ compra, detalles, cancelaciones }) → { compra, omitida: null } | { compra: null, omitida: { com_id,
    codigo } }`. `compra` = `{ com_id: string, fecha: 'YYYY-MM-DDTHH:MM:SS', pro_id: string, folio: string (≤ 60,
    recortado), comentario: string (≤ 200), estado: 'vigente'|'cancelada', cancelada_en: string|null, total_con: string
    decimal con 2 cifras (suma de importeCon del detalle), detalle: [{ art_id, cantidad, precio_sin, precio_con,
    importe_con }] }`. Códigos de omitida: `FECHA_INVALIDA`, `STATUS_DESCONOCIDO` (status distinto de 1 y −1),
    `SIN_DETALLE`, `DEMASIADOS_RENGLONES` (> 500), `IMPORTE_INVALIDO`.
  - `proveedorSeguro` normaliza `rfc`: mayúsculas, sin espacios ni guiones; si no cumple `/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/`
    se manda `rfc: null`.
  - `configuracion`: `compras` opcional; si viene y no es boolean → `CONFIGURACION_INVALIDA`. Apagado por defecto.

- [ ] **Step 1: Pruebas rojas.** `compraSegura`: compra vigente con dos renglones → `total_con` igual a la suma de
  `importeCon` (`'1160.00'` con `580.00 + 580.00`); `status -1` con cancelación en historial → `estado 'cancelada'` y
  `cancelada_en` con esa fecha; `status 3` → omitida `STATUS_DESCONOCIDO`; sin renglones → `SIN_DETALLE`; 501 renglones
  → `DEMASIADOS_RENGLONES`. `proveedorSeguro` con `rfc ' abc-010101 xy9 '` → `'ABC010101XY9'`; con `'XAXX'` → `null`.
  `mapeo`: con `proveedor.rfc` ausente, `proveedores()` no pide la columna; con `detallec.importeCon` ausente,
  `comprasDisponibles === false` y `compras()` lanza `COMPRAS_NO_DISPONIBLES`. Configuración `compras: 'si'` → error.
  Las consultas nuevas pasan `seguridad.js` (prueba que las construya con el lector falso que ya usan las de traspasos).
- [ ] **Step 2: Correr y ver rojo.**
- [ ] **Step 3: Implementar** con el mismo estilo de `traspasos` en `mapeo.js` y `traspasoSeguro` en `formato.js`.
- [ ] **Step 4: Suite del agente completa en verde.**
- [ ] **Step 5: Commit** `feat(agente-sicar): lectura de compras y rfc de proveedores` (solo los archivos de arriba).

### Task 2: Agente — envío de compras en la corrida

**Files:**
- Modify: `agente-sicar/corrida.js` (paso `compras`, armado del lote), `agente-sicar/estado.js` (estado de compras)
- Test: `agente-sicar/corrida.test.js`, `agente-sicar/estado.test.js`

**Interfaces:**
- Consumes: Task 1 (`fuente.compras`, `fuente.comprasDisponibles`, `compraSegura`, `config.compras`).
- Produces (contrato del lote que Task 3 valida):
  - `lote.compras: compra[]` (forma de Task 1) y `lote.compras_omitidas: { com_id, codigo }[]`.
  - Estado nuevo: `compras_cursor: '0'`, `compras_semana: null`, `compras_vuelta: null`, `compras_firmas: {}`, con la
    misma validación que los de traspasos en `estado.js`.
- Comportamiento (copiar la lógica de traspasos de `corrida.js:520-600`, con estas diferencias):
  - Solo si `config.compras === true`; si `!fuente.comprasDisponibles` → `avisarUnaVez('COMPRAS_NO_DISPONIBLES')`.
  - Relectura de las de los **últimos 60 días** (traspasos usa 30).
  - Vuelta completa semanal; **de día si `compras_semana` es null o de hace más de 8 días** (la primera carga, ~1,400
    compras, sí corre de día). No hay bandera `--compras-ahora`.
  - Un lote de solo compras/omitidas es `descartable` como uno de traspasos.
  - Huellas (`firma`) para no reenviar compras que no cambiaron, como traspasos.

- [ ] **Step 1: Pruebas rojas.** Con `compras` apagado no se lee nada; prendido y primera vez (semana null) a mediodía:
  manda la vuelta completa y deja `compras_semana` = hoy; con semana de ayer: solo nuevas + relectura de 60 días; una
  compra releída sin cambios no se reenvía; una que pasa a cancelada sí; una omitida viaja en `compras_omitidas`;
  `comprasDisponibles false` → aviso una sola vez y la corrida sigue con ventas.
- [ ] **Step 2: Ver rojo. Step 3: Implementar. Step 4: suite del agente en verde.**
- [ ] **Step 5: Commit** `feat(agente-sicar): envia compras de dia con relectura de 60 dias`.

### Task 3: Servidor — recibir y guardar compras y RFC

**Files:**
- Modify: `backend/sicarIngesta.js` (validar `compras`, `compras_omitidas`, `rfc` en proveedores)
- Modify: `backend/sicarRepositorio.js` (tablas, migración de `rfc`, escrituras)
- Modify: `backend/sicarRespaldo.js` (tablas nuevas en el respaldo, generación nueva)
- Test: `backend/sicarIngesta.test.js`, `backend/sicarRepositorio.test.js`, `backend/sicarRespaldo.test.js`,
  `backend/sicarMigracion.test.js`

**Interfaces:**
- Consumes: contrato del lote de Task 2.
- Produces:
  - `sicar_compras (sucursal_id, com_id, fecha TEXT, pro_id TEXT, folio TEXT, comentario TEXT, estado TEXT CHECK IN
    ('vigente','cancelada'), cancelada_en TEXT, total_centavos INTEGER CHECK integer, primera_vez TEXT, actualizado_en
    TEXT, PK (sucursal_id, com_id))`. `primera_vez` = cuándo la recibió el servidor por primera vez (no cambia en
    upserts): sirve para el rojo de "compra sin factura" desde que se prende.
  - `sicar_compras_detalle (sucursal_id, com_id, art_id, cantidad TEXT, precio_sin_centavos, precio_con_centavos,
    importe_con_centavos)`, PK (sucursal_id, com_id, art_id) — si SICAR repite `art_id` en una compra, se suman en un
    renglón **(Claude)**.
  - `sicar_compras_omitidas` igual que `sicar_traspasos_omitidos` (sin llave foránea, mismo motivo).
  - `sicar_proveedores.rfc TEXT` (migración `ALTER TABLE ... ADD COLUMN` si no existe; un proveedor que llega sin `rfc`
    no borra uno guardado: deja el valor como está **(Claude)**).
  - Hook después de guardar un lote con compras: `alGuardarCompras(sucursalId, comIds: string[])`, opcional en
    `crearRepositorioSicar(sqlite, { ..., alGuardarCompras })`. Task 4 lo conecta.
- Validación: `compras` arreglo ≤ 100, `com_id` numérico como texto, `estado` solo de la lista, `total_con` y precios
  decimales con 2 cifras ≥ 0, `detalle` 1..500, `fecha` válida. Rechazo cerrando (contra lista de permitidos).

- [ ] **Step 1: Pruebas rojas:** lote válido se guarda con centavos enteros; reenvío de la misma compra cancelada
  cambia `estado` y conserva `primera_vez`; `estado: 'CANCELADA '` → 400; detalle con 501 → 400; proveedor sin `rfc`
  conserva el RFC guardado; base vieja sin columna `rfc` migra sin perder proveedores; respaldo y restauración incluyen
  las tablas nuevas; `alGuardarCompras` se llama con los `com_id` del lote.
- [ ] **Step 2: Ver rojo. Step 3: Implementar. Step 4: suite backend completa en verde.**
- [ ] **Step 5: Commit** `feat(sicar): recibe compras de cedis y rfc de proveedores`.

### Task 4: Servidor — la unión factura ↔ compra

**Files:**
- Modify: `backend/cfdi.js` (agregar `serie` y `folio`; lo demás igual)
- Modify: `backend/facturasPorLlegar.js` (guardar `serie`/`folio`; llamar a la unión al registrar)
- Modify: `backend/sicarRepositorio.js` (columnas `serie`, `folio` en `facturas_por_llegar`; tabla `facturas_compras`)
- Create: `backend/facturasCompras.js`
- Modify: `backend/permisosCatalogo.js` (`conciliar_facturas`), `backend/server.js` (conectar módulo, rutas, revisión
  diaria con el temporizador que ya usen otras tareas diarias del servidor)
- Test: `backend/cfdi.test.js`, `backend/facturasPorLlegar.test.js`, `backend/facturasCompras.test.js` (nuevo)

**Interfaces:**
- Consumes: tablas de Task 3; `normalizarUuid`, `centavosDeTexto` de `facturasPorLlegar.js`.
- Produces:
  - `facturas_compras (id PK, factura_id INTEGER UNIQUE, sucursal_id INTEGER, com_id TEXT, modo TEXT CHECK IN
    ('automatica','manual'), actor TEXT, fecha TEXT, total_al_unir_centavos INTEGER, UNIQUE (sucursal_id, com_id))`.
  - `crearFacturasCompras({ sqlite }) → { candidatas(facturaId), revisar(), confirmar(facturaId,
    {sucursal_id, com_id}, actor), ninguna(facturaId, motivo, actor), desunir(facturaId, motivo, actor),
    alGuardarCompras(sucursalId, comIds), resumen() }`.
  - `normalizarRfc(texto) → string|null`, `folioCoincide(folioSicar, { serie, folio }) → boolean` (exportadas).
- Reglas (spec §6, verbatim en las pruebas):
  - Candidatas: factura `por_llegar`, `moneda = 'MXN'`; compra `vigente`, sin unir, de una sucursal cuyo proveedor
    (`sicar_proveedores` de la **misma** `sucursal_id`, `prv_id = pro_id`) tiene `normalizarRfc(rfc) =
    normalizarRfc(rfc_emisor)`; `|total_centavos − total_factura| ≤ 100`; `fecha` de la compra (día) entre el día de
    `fecha_emision` y 60 días después, ambos incluidos.
  - `folioCoincide`: quitar espacios y guiones, mayúsculas, quitar ceros a la izquierda del número; coincide con `folio`
    o con `serie + folio`. Folio vacío en cualquiera de los dos → `false`.
  - Une sola solo si: una candidata, esa compra es candidata de una sola factura, y `folioCoincide`. Entonces
    `estado 'llego'`, `llego_por 'sicar'`, `llego_en` = fecha de la compra, unión `automatica`, historial `'unir'`.
  - Si no: queda `por_llegar`; `candidatas(id)` la reporta para "Por confirmar".
  - `alGuardarCompras`: compra unida que llega `cancelada` → borrar unión, factura a `por_llegar`, historial
    `'desunir_cancelada'` (actor `'sicar'`), y queda en `resumen().canceladas_despues`; compra unida cuyo total se sale
    del margen respecto a `total_al_unir_centavos` → unión se queda, aparece en `resumen().cambiaron`. Luego `revisar()`.
  - `confirmar`: solo una compra que esté en `candidatas(facturaId)`; si no → 409. `ninguna`: motivo obligatorio,
    historial, la factura sigue `por_llegar` y no se vuelve a proponer esa misma lista **(Claude: se guarda la marca en
    el historial; si aparece una compra nueva candidata, vuelve a "Por confirmar")**. `desunir`: motivo obligatorio.
  - `resumen()`: `{ por_confirmar: [...], facturas_sin_compra_15: [...], compras_sin_factura_15: [...] (solo
    primera_vez desde que se prendió: compras con `primera_vez` ≥ la `primera_vez` más vieja de esa sucursal + 1 día —
    la carga inicial queda fuera **(Claude)**), compras_viejas_sin_factura: number, canceladas_despues: [...],
    cambiaron: [...], proveedores_sin_rfc: [{ prv_id, nombre, compras }] }`.
  - Rutas (todas `requiereLogin`): `GET /api/facturas-compras/resumen` y `GET /api/facturas-por-llegar/:id/candidatas`
    con `ver_facturas_por_llegar`; `POST /api/facturas-por-llegar/:id/confirmar`, `/ninguna`, `/desunir` con
    `conciliar_facturas`. `actor` del token; ids con `Number(...)`; `com_id` como texto.
  - `facturasPorLlegar.registrar` y el `listar` existentes devuelven además `serie`, `folio` y, si está unida, `compra:
    { sucursal_id, com_id, fecha, folio, total_centavos, comentario, modo, actor }`.

- [ ] **Step 1: Pruebas rojas** (`facturasCompras.test.js`, con `prepararDB()` local como `backend/cajas.test.js`):
  1. RFC, total exacto, folio y fecha → une sola, `llego_por 'sicar'`.
  2. Total con 100 centavos de diferencia → une; con 101 → sin candidata.
  3. Compra un día antes de la emisión → no; el día 60 → sí; el 61 → no.
  4. RFC `'abc-010101 xy9'` en SICAR contra `ABC010101XY9` → une.
  5. `'A-000123'` contra serie `A` folio `123` → une; folio vacío en SICAR → "Por confirmar", no une.
  6. Dos facturas del mismo proveedor y total, una compra → ninguna une sola; las dos en "Por confirmar".
  7. Compra unida que llega cancelada → factura `por_llegar`, historial `desunir_cancelada`, en `canceladas_despues`.
  8. Compra unida cuyo total sube $50 → sigue unida, en `cambiaron`.
  9. `confirmar` con una compra que no es candidata → 409; con candidata → unión `manual` con actor.
  10. Proveedor sin RFC → su compra no es candidata y aparece en `proveedores_sin_rfc` con `compras: 1`.
  11. Factura en USD → nunca candidata.
  12. Rutas: rol con `ver_facturas_por_llegar` y `registrar_facturas_por_llegar` pero sin `conciliar_facturas` → 403
      en confirmar; rol con `conciliar_facturas` → 200.
  13. Carga inicial: compras recibidas el primer día no salen en `compras_sin_factura_15`; una recibida 20 días después
      y sin factura sí.
  `cfdi.test.js`: `serie` y `folio` del `Comprobante`; ausentes → `null`; lo demás que ya devuelve, igual.
- [ ] **Step 2: Ver rojo. Step 3: Implementar. Step 4: suite backend completa en verde, eslint 0 errores.**
- [ ] **Step 5: Commit** `feat(facturas): une facturas por llegar con compras de cedis`.

### Task 5: Pantalla — uniones, "Por confirmar" y rojos

**Files:**
- Modify: `src/compras/FacturasPorLlegar.jsx`
- Create: `src/compras/conciliacion.js` (funciones puras de texto y orden para la pantalla) y
  `src/compras/conciliacion.test.js`

**Interfaces:**
- Consumes: rutas de Task 4. Permisos del usuario como ya los lee la pantalla.
- Textos exactos:
  - Unida: `Llegó · compra SICAR {folio} del {fecha} · {total}` y `Unida sola` o `Confirmada por {nombre}`.
  - Sección `Por confirmar`: cada factura con sus candidatas (fecha, folio SICAR, total, comentario) y botones
    `Es esta compra` y `Ninguna de estas` (solo con `conciliar_facturas`; sin él, la sección se ve sin botones).
    `Ninguna de estas` y `Desunir` piden motivo; sin motivo el botón no manda.
  - Rojos: `Factura sin compra en SICAR desde hace {n} días`, `Compra de SICAR sin factura desde hace {n} días`,
    `La compra se canceló en SICAR después de unida`, `La compra cambió en SICAR después de unida: antes {a}, ahora {b}`.
  - `Proveedores sin RFC en SICAR` con nombre y número de compras, y la nota `Llénalo en SICAR de CEDIS; aquí se
    actualiza solo.`
  - Compras viejas: `{n} compras anteriores sin factura (no se marcan en rojo)`.
- Modales con scroll y botones `type="button"` salvo el de enviar; ninguna `className` de más de 200 caracteres
  (constantes).

- [ ] **Step 1: Pruebas rojas** de `conciliacion.js`: textos de arriba con montos en formato de la app; orden de rojos
  (más días primero); botones ocultos sin `conciliar_facturas`.
- [ ] **Step 2: Ver rojo. Step 3: Implementar. Step 4: `node --test src/compras/*.test.js`, eslint, `npx vite build`.**
- [ ] **Step 5: Commit** `feat(facturas): pantalla de union con compras de cedis`.

---

**Después de la Task 5 (Claude, no Codex):** revisión de toda la rama, prueba en navegador con base de prueba (subir un
XML, mandar un lote de compras por la ruta del agente con llave de prueba, ver la unión sola, un "Por confirmar", una
cancelación y los rojos), y reporte a Victor. Despliegue en el orden de spec §10, solo con autorización de Victor.
