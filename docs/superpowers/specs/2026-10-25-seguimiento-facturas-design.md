# Seguimiento de facturas, traspasos y rezago — diseño

Fecha: 2026-10-25. Base `master` a020537. Rama `feature/seguimiento-facturas`.
Antecedentes: plan corporativo F4–F6 ([[project_metas_corporativo]]), rotación por factura
([[project_rotacion_facturas]]), reconocimiento SICAR Ocosingo F0/F1 (`C:\UnisoundSICAR\reconocimiento-f1.md`).
Lo marcado **(Claude)** lo decidió Claude; lo marcado **(por confirmar en CEDIS)** se confirma al revisar el SICAR de
CEDIS (acceso prometido por Victor para 2026-10-26).

## 1. Para qué
Saber, de cada factura de compra, cuánto queda sin vender, en qué tienda y desde cuándo; avisar cuándo bajar precio;
y detectar mercancía que sale de CEDIS y no llega completa a la tienda.

## 2. Decisiones de Victor (no volver a preguntar)
- La administradora captura las compras en el **SICAR de CEDIS** (PC aparte) y reparte con **traspasos** de SICAR.
- Se miden las dos cosas: **la factura que entra a CEDIS** (Compras) y **los traspasos a cada tienda + sus ventas**
  (encargado de tienda).
- **Dos antigüedades:** para **bajar precio**, desde que la factura llegó a CEDIS (−15% a 3 meses, −30% a 4, a costo a 5);
  para **medir al encargado**, desde que su tienda recibió el traspaso.
- **Facturas por llegar:** la administradora registra el XML cuando el proveedor la manda, antes de que llegue.
- `compra.fecha` = cuando llega la factura (la mercancía).

## 3. Principios
- Solo observar SICAR (solo lectura). Nada de esto mueve existencias, precios ni compras de CORPUNISOUND: el precio
  se cambia en SICAR.
- Datos SICAR en tablas `sicar_*`; la tienda sale de la llave.
- Ninguna parte frena las ventas del agente (colecciones opcionales con interruptor, como mostrador/cortes).
- No inventar faltantes: una diferencia enviado/recibido se muestra "según SICAR" y con el folio, nunca como acusación.

## 4. Fases
| Fase | Qué | Depende de CEDIS |
|---|---|---|
| A | **Traspasos** de cada tienda (enviados y recibidos) desde su SICAR: colección `traspasos` | No (Ocosingo ya confirmado) |
| B | **Facturas por llegar** en CORPUNISOUND (XML) | No |
| C | **Compras con factura** desde el SICAR de CEDIS: colección `compras` | Sí |
| D | **Lotes y rezago:** cada factura es un lote; traspasos y ventas consumen FIFO; semáforo 3/4/5 meses | Sí |

Este diseño cubre todo; el primer plan construye **A y B**.

## 5. Fase A — Traspasos

### 5.1 SICAR (confirmado en Ocosingo)
- `traspaso`: `tra_id` PK, `folio`, `sucOri`, `sucDes`, `fecha` (date), `total`, `status` (2 aplicado/recibido con
  `fechaApl`; 1 enviado sin recibir; −1 cancelado con `sucCan`, `fechaCan`), `UNIQUE(folio, sucOri, sucDes)`.
- `detallet`: PK (`tra_id`, `art_id`), `cantidad` decimal(20,4), `precioSin`/`precioCon` decimal(20,2), importes.
- En la red de SICAR, Ocosingo es la sucursal **2** y CEDIS la **6** (números de SICAR, no de CORPUNISOUND).
- Un traspaso cambia de estado después de creado (1 → 2 o −1): hay que **releerlos**.

### 5.2 Agente
- Interruptor `"traspasos"`. Cursor por `tra_id` + **relectura** de los traspasos con status 1 (abiertos) en cada corrida
  y de los modificados en los últimos 30 días (Claude: no hay columna de modificación; se releen los que tienen
  `fecha` o `fechaApl`/`fechaCan` en los últimos 30 días).
- Fila: `{ tra_id, folio, suc_origen, suc_destino, fecha, estado ('enviado'|'recibido'|'cancelado'), fecha_aplicado |
  null, fecha_cancelado | null, total, detalle: [{ art_id, cantidad, precio_sin, precio_con }] }`. Sin nombres
  (`aliasOri/aliasDes` no se mandan; Claude).
- Carga histórica completa (≈2,500 traspasos en Ocosingo) de noche.

### 5.3 Servidor
- Tablas `sicar_traspasos` (PK `sucursal_id`, `tra_id`) y `sicar_traspasos_detalle`; upsert, reemplaza detalle; respaldo.
- **Mapa de números de sucursal SICAR → tienda CORPUNISOUND** (Claude): tabla de configuración que llena el gerente/
  dueño (p. ej. SICAR 2 = Ocosingo, 6 = CEDIS). Sin mapa, se muestra "SICAR 6".
- **Conciliación (cuando ambas puntas tengan agente):** el mismo traspaso existe en el SICAR que envía y en el que
  recibe, unido por (`folio`, `suc_origen`, `suc_destino`). Se compara por artículo lo enviado contra lo recibido.
  Mientras solo una punta tenga agente, se muestra solo esa punta.

### 5.4 Pantalla "Traspasos SICAR" (permiso `ver_traspasos_sicar`, módulo `inventario`)
- Lista por tienda y periodo: folio, origen → destino, fecha, estado, días en tránsito, total.
- **Alertas:** enviados sin recibir hace más de 3 días (Claude); cancelados; y (con ambas puntas) diferencias por
  artículo entre enviado y recibido.
- Por tienda: "mercancía recibida de CEDIS" con su antigüedad desde la recepción (insumo de la Fase D).

## 6. Fase B — Facturas por llegar
- Pantalla para que la administradora suba el **XML** del proveedor (reusa `backend/cfdi.js`). Queda una factura
  **por llegar**: folio fiscal (uuid), proveedor (RFC y nombre), fecha de emisión, total, conceptos.
- Duplicado por uuid: rechazado (igual que Recepción de Compras).
- Estados: `por_llegar` → `llegó` (cuando la compra con ese uuid aparece en SICAR de CEDIS — Fase C; mientras tanto se
  marca a mano con fecha y quién) → o `cancelada` (con motivo).
- Lista con días de espera y aviso cuando pasa de N días (Claude: 15) sin llegar.
- Permisos `registrar_facturas_por_llegar` y `ver_facturas_por_llegar` (módulo `inventario`); historial de cada cambio.
- Guardado: en SQLite propia con respaldo (Claude), no en el JSON principal.

## 7. Fase C — Compras con factura (por confirmar en CEDIS)
- Agente en la PC de CEDIS, colección `compras`: compra (id, fecha de llegada, proveedor id, uuid/folio fiscal si SICAR
  lo guarda — Ocosingo tiene 74 compras con uuid —, total, estado) y detalle (art_id, cantidad, costo).
- **Por confirmar en CEDIS:** tablas `compra`/`detallec`, dónde guarda el uuid, cómo marca canceladas, y **cómo se
  relaciona un artículo de CEDIS con el mismo artículo de cada tienda** (probable: por `clave`). Si la clave no une
  bien, la Fase D no se puede hacer por tienda.
- La compra que llega con un uuid de "facturas por llegar" la marca `llegó` sola.

## 8. Fase D — Lotes y rezago (por confirmar en CEDIS)
- Cada renglón de compra = **lote** (factura, artículo, cantidad, costo, fecha de llegada a CEDIS).
- Los traspasos de CEDIS a cada tienda consumen lotes **FIFO** por artículo (el más viejo primero); las ventas de cada
  tienda consumen FIFO lo recibido por esa tienda. Resultado: de cada factura, cuántas piezas quedan, en qué tienda y con
  qué antigüedad (desde CEDIS y desde la tienda).
- Semáforo para **bajar precio** por antigüedad desde CEDIS: 3 meses −15%, 4 meses −30%, 5 meses a costo. Para el
  **encargado**: antigüedad desde que su tienda recibió.
- Existencia inicial sin factura (lo que ya había antes): "antigüedad desconocida", aparte.
- Se conecta con Cinco Caminos: la táctica "rematar lo de más de 180 días" y metas de Compras de rotación.

## 9. Cómo se abusa y qué queda
- **Traspaso que "se pierde" en el camino:** alerta de enviado sin recibir y diferencia por artículo, con folio y fechas.
- **Recibir menos de lo enviado sin avisar:** diferencia visible por artículo; el sistema no acusa, muestra lo que dice
  cada SICAR.
- **Subir una factura falsa por llegar:** uuid único, XML real (CFDI), historial con quién la subió.

## 10. Decisiones de Claude tras la revisión del constructor (2026-10-25)
1. **Alcance.** `ver_traspasos_sicar`: sin `ver_todas_las_sucursales`, solo los traspasos de la llave de **su** tienda
   (los que su SICAR mandó), alcance por token (regla 5), nunca del encabezado. Facturas por llegar son de la empresa
   (CEDIS): lista global para quien tenga `ver_facturas_por_llegar`; ese permiso es de corporativo y expone costos.
2. **Dónde se guarda:** tablas nuevas en la misma base SQLite de `sicar_*` (`persistencia.js`), dentro del respaldo
   SICAR con generación nueva. Nada de archivos aparte.
3. **XML:** se amplía `backend/cfdi.js` **sin cambiar lo que ya devuelve** (solo agrega `total` desde
   `Comprobante.Total` y `tipoComprobante`). Facturas por llegar rechaza: sin folio fiscal (uuid), tipo distinto de
   `I` (Ingreso), o XML ilegible. Se aclara en pantalla que el sistema no valida la factura ante el SAT.
4. **uuid normalizado** (mayúsculas, sin espacios) al guardar y al comparar. Si ya existe una compra recibida en
   CORPUNISOUND (`DB.inventario.compras`) con ese uuid, la factura por llegar queda `llegó` sola; en la Fase C, también
   cuando aparezca en el SICAR de CEDIS.
5. **Mapa de sucursales SICAR → tienda:** solo lo edita quien tenga `administrar_sucursales`, con historial (quién,
   cuándo, antes y después).
6. **Relectura de traspasos:** abiertos (status 1) en cada corrida; los de los últimos 30 días en cada corrida; y una
   **vuelta completa semanal de noche** para corregir cambios viejos.
7. **Orden de despliegue:** primero el servidor en producción, después prender `"traspasos"` en el agente (un servidor
   viejo rechaza la colección).

## 11. Lo que no entra en el primer plan
Fases C y D (requieren CEDIS); avisos automáticos por WhatsApp; cambios de precio desde CORPUNISOUND.
