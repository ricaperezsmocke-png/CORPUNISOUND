# Compras de CEDIS y unión con facturas por llegar — diseño

Fecha: 2026-11-03. Base `master` a2573fd. Rama `feature/compras-cedis`.
Continúa la Fase C de `2026-10-25-seguimiento-facturas-design.md` (A traspasos y B facturas por llegar ya están en
producción). Reconocimiento solo lectura del SICAR de CEDIS: `C:\UnisoundSICAR\reconocimiento-cedis-compras.md` (PC
de CEDIS, 2026-11-03). Lo marcado **(Claude)** lo decidió Claude; todo lo demás lo decidió Victor.

## 1. Para qué
Que cada factura del proveedor quede unida, sola, con la compra que la administradora captura en SICAR de CEDIS, sin
subir nada dos veces. Que se vea en rojo la factura que no llega y la compra que no tiene factura. Y dejar listas las
compras con costo y artículo para la Fase D (cuánto queda de cada compra, en qué tienda y desde cuándo).

## 2. Decisiones de Victor (no volver a preguntar)
- **Opción C.** La administradora sigue capturando la compra **a mano en SICAR, sin XML** (SICAR confunde proveedores
  con descripción o código parecido). El XML se sube **una sola vez**, en CORPUNISOUND → "Facturas por llegar".
- **Reglas de unión aprobadas:**
  1. Proveedor por **RFC** (el del XML contra el del proveedor en SICAR). Nunca por nombre ni descripción.
  2. **Total** igual, con margen máximo de **$1.00** (redondeo).
  3. **Folio** del XML contra el folio tecleado en SICAR.
  4. La compra en SICAR debe ser **del mismo día o posterior** a la emisión de la factura y **dentro de 60 días**.
  5. **Si hay duda no une sola:** muestra las candidatas y una persona con permiso confirma; queda quién y cuándo.
  6. En rojo: factura con más de **15 días** sin compra; compra de SICAR sin factura.

## 3. Lo que dice el SICAR de CEDIS (reconocimiento 2026-11-03)
- MySQL 5.6.47, SICAR 4.0. Tablas `compra` y `detallec`. 1,399 compras (2023-12-28 a hoy), 493 en 12 meses.
- `compra.fecha` (datetime) es la de **captura**; no hay fecha de llegada. Se toma como llegada (`compra.fecha` =
  llegada, decisión ya tomada en el diseño del 2026-10-25).
- `compra.folio`: folio del proveedor, tecleado a mano. `compra.comentario`: en 485 de 493 empieza "COMPRA <TIENDA>, …".
- `compra.uuid` / `xcf_id`: **0 de 493** con UUID en 12 meses. SICAR no sirve como fuente del folio fiscal.
- `status` 1 vigente, −1 cancelada (`can_caj_id`, `can_rcc_id`); `historial` tabla='Compra' (movimiento 0 alta,
  2 cancelación, con `usu_id` y fecha).
- `compra.pro_id → proveedor.pro_id`, sin huérfanas. `proveedor.rfc`: 41 de 60 lo tienen; 338 de 493 compras son de
  proveedores con RFC → **155 compras de 19 proveedores no se pueden unir solas** hasta que se llene su RFC en SICAR.
- `detallec`: `art_id`, `clave`, `descripcion`, `cantidad`, `factor`, `precioSin`, `precioCon` (razón 1.16 exacta),
  importes. Sin lotes ni caducidad (tabla `lote` vacía). Devoluciones a proveedor: `notacreditopro` vacía (nunca usada).
- `articulo.clave` es **única**: 0 vacías, 0 repetidas. Llave entre SICARs = `articulo.clave` por `art_id` (no
  `detallec.clave`: 7 claves cambiaron después de la compra).
- Numeración de sucursales igual a Ocosingo (1 SC, 2 Ocosingo, 4 Yajalón, 5 Innotec, 6 CEDIS, 8 Palenque; 3 y 7 viejas).
- **Por confirmar con `--verificar` en CEDIS** (antes de prender): nombre exacto de la columna del total de la compra y
  si trae IVA; si `folio` puede venir con serie.

## 4. Agente (`agente-sicar`)
- Colección nueva **`compras`**, con interruptor `"compras"` en `config.json` (apagado por defecto; solo se prende en
  CEDIS). Si faltan columnas, aviso `COMPRAS_NO_DISPONIBLES` y no frena lo demás (mismo patrón que proveedores).
- Fila: `{ com_id, fecha, pro_id, folio, comentario, total_con, estado ('vigente'|'cancelada'), cancelada_en | null,
  detalle: [{ art_id, cantidad, precio_sin, precio_con }] }`. `cancelada_en` sale de `historial` (movimiento 2).
  Sin `usu_id` de captura en este plan **(Claude)**: no se usa para unir y evita mandar nombres de personal.
- Cursor por `com_id` + **relectura** de las compras con `fecha` en los últimos 60 días en cada corrida (una compra
  puede cancelarse o corregirse después) + **vuelta completa semanal**; de día si la última tiene más de 8 días (la PC
  de CEDIS también se apaga al cierre; misma regla que traspasos).
- Carga histórica completa (≈1,400 compras): cabe de día **(Claude)**, en lotes.
- **Proveedores:** se agrega `rfc` como columna **opcional** de la lista de proveedores (si la columna no existe, se
  manda sin RFC y no falla). RFC normalizado: mayúsculas, sin espacios ni guiones.
- Solo lectura, como todo el agente (`seguridad.js` sigue prohibiendo `INTO`, `OUTFILE`, `LOAD_FILE`, etc.).

## 5. Servidor
- Tablas `sicar_compras` (PK `sucursal_id`, `com_id`) y `sicar_compras_detalle`; upsert, reemplaza el detalle; dentro
  del respaldo SICAR (generación nueva). `sicar_proveedores` gana columna `rfc` (migración sin perder datos).
- Dinero en centavos enteros, como en traspasos.
- `facturas_por_llegar` gana `serie` y `folio` (del `Comprobante.Serie` / `Comprobante.Folio` del XML).
  `cfdi.js` se amplía **sin cambiar lo que ya devuelve** (solo agrega `serie` y `folio`). Las facturas ya registradas
  quedan sin folio: se unen solo por confirmación a mano **(Claude)**.
- Tabla `facturas_compras` (unión): `factura_id` UNIQUE, (`sucursal_id`, `com_id`) UNIQUE, `modo` ('automatica' |
  'manual'), `actor`, `fecha`. Una factura ↔ una compra **(Claude)**: una factura partida en dos compras, o dos
  facturas en una compra, no se unen solas y se resuelven a mano como "sin unir" con nota (ver §8).
- Historial en `facturas_por_llegar_historial` (ya existe) de cada unión, desunión y confirmación.

## 6. La unión, paso por paso
**Candidatas** de una factura `por_llegar` en MXN: compras **vigentes** de CEDIS, sin unir, cuyo proveedor en SICAR
tiene el mismo RFC, con `|total_con − total_factura| ≤ 100 centavos`, y con fecha de compra entre el día de emisión y
60 días después.

**Folio que coincide** **(Claude)**: se comparan quitando espacios, guiones y ceros a la izquierda, sin distinguir
mayúsculas; coincide si el folio de SICAR es igual al `folio` del XML o a `serie`+`folio`.

**Se une sola** solo si se cumplen las tres:
1. La factura tiene **una sola** candidata.
2. Esa compra es candidata de **una sola** factura.
3. El **folio coincide**.

Entonces la factura pasa a `llegó` (`llego_por = 'sicar'`, `llego_en` = fecha de la compra) y queda la unión
`automatica`.

**Por confirmar** (no se une sola): hay candidatas pero falla alguna de las tres (dos facturas del mismo proveedor con
el mismo total, folio distinto o vacío en SICAR, factura sin folio). La pantalla muestra la factura con sus candidatas
(fecha, folio de SICAR, total, comentario "COMPRA <TIENDA>") y quien tenga el permiso escoge una o dice "ninguna".

**Cuándo corre:** al registrar una factura, al recibir compras del agente y en una revisión diaria. Siempre en el
servidor, nunca en la pantalla.

**Después de unida:**
- Si la compra se **cancela** en SICAR: se deshace la unión sola, la factura vuelve a `por_llegar`, queda en el
  historial y sale en rojo "la compra se canceló en SICAR".
- Si el **total de la compra cambia** y se sale del margen: la unión se queda, pero sale en rojo "la compra cambió
  después de unida" con antes y después **(Claude)**.
- **Desunir a mano:** con el permiso, con motivo obligatorio y en el historial.

## 7. Pantalla (dentro de "Facturas por llegar")
- Cada factura muestra su estado y, si llegó, la compra de SICAR (fecha, folio, total, comentario) y si fue automática
  o confirmada por quién.
- Sección **"Por confirmar"**: facturas con candidatas, con el botón de escoger.
- **En rojo:**
  - Factura con más de 15 días sin compra (ya existe; ahora también se quita sola cuando aparece la compra).
  - **Compra de SICAR sin factura** con más de 15 días **(Claude: mismo plazo)**, solo compras capturadas **desde el día
    que se prende la colección** **(Claude)**: las 1,399 viejas nunca tuvieron factura en el sistema y llenarían la
    lista de rojo falso. Las viejas se ven aparte, sin rojo.
  - La compra cancelada después de unida y la que cambió de total.
- **Proveedores sin RFC en SICAR:** lista de los proveedores sin RFC con cuántas compras tienen, para que la
  administradora los llene en SICAR. Se vacía sola cuando el agente manda el RFC.
- Factura en USD: sigue prohibida como en la Fase B (registrada en rojo); nunca se une sola.

## 8. Permisos y quién ve qué
- Ver: `ver_facturas_por_llegar` (ya existe; corporativo; expone costos).
- **Confirmar, escoger "ninguna" y desunir:** permiso nuevo `conciliar_facturas` (módulo `inventario`). Separado de
  `registrar_facturas_por_llegar` **(Claude)**: quien sube la factura y captura la compra no debería ser quien declara
  que coinciden. Se recomienda dárselo a Victor o al contador.
- El administrador recibe los permisos nuevos solo (`reconciliarRoles`); los demás roles no.

## 9. Cómo se abusa y qué queda
- **Compra capturada en SICAR sin mercancía ni factura real** (sube existencia de CEDIS de mentira): sale en rojo
  "compra sin factura" a los 15 días, con folio, proveedor y total.
- **Factura que nunca llega** (se pagó y no llegó la mercancía): rojo a los 15 días, ya existe.
- **Unir a mano una factura con la compra equivocada** para tapar otra: queda quién lo hizo, cuándo y qué candidatas
  había; la compra sobrante sigue en rojo.
- **Cancelar la compra en SICAR después de unida:** la unión se deshace sola y sale en rojo.
- Nada de esto mueve existencias, costos, precios ni pagos de CORPUNISOUND. Solo observa SICAR.
- No se acusa a nadie: los avisos dicen "según SICAR" con folio y fechas.

## 10. Orden de despliegue
1. Servidor en producción (tablas, unión, pantalla, permiso).
2. Actualizar el agente de CEDIS y correr `--verificar` (confirma columnas de §3 y RFC de proveedores).
3. Prender `"compras": true` en CEDIS. Un servidor viejo rechaza la colección: por eso el servidor va primero.
4. Victor da `conciliar_facturas` a quien decida. La administradora llena el RFC de los 19 proveedores en SICAR.

## 11. Fase D (siguiente diseño, no entra en este plan)
Cada renglón de compra es un lote (compra, artículo por `articulo.clave`, cantidad, costo, fecha). Los traspasos de
CEDIS consumen lotes FIFO por artículo; las ventas de cada tienda consumen FIFO lo que esa tienda recibió. Semáforo
para bajar precio desde la llegada a CEDIS (−15% 3 meses, −30% 4, a costo 5) y antigüedad desde la tienda para el
encargado. Existencia anterior sin compra: "antigüedad desconocida". Necesita: compras (este plan) + traspasos (ya) +
ventas por tienda (ya) + la clave en los artículos de cada tienda (ya llega en `sicar_articulos`).

## 12. Lo que no entra
Descarga de facturas del SAT o del correo; cargar XML en SICAR; cambios de precio desde CORPUNISOUND; Fase D.
