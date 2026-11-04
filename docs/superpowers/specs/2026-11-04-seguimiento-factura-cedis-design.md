# Seguimiento por factura de CEDIS — diseño

Fecha: 2026-11-04. Base `master` 16856f1. Rama `feature/seguimiento-factura`.
Armado entre Claude y Codex a partir de la idea de Victor (`.superpowers/sdd/seguimiento-factura-idea.md` en el
worktree compras-cedis). Lo marcado **(Claude/Codex)** es propuesta técnica; todo lo demás lo decidió Victor.
Reemplaza la Fase D del diseño `2026-10-25-seguimiento-facturas-design.md` (§8) y sus reglas −15/−30/costo.

## 1. Para qué

Victor quiere saber, de cada factura que llega a CEDIS: **cuánto se ha vendido y cuánto queda**, **a qué tiendas se
movió** y **qué hacer** con lo que no se vende, sin capturar nada extra. Que el sistema le diga a tiempo cuándo
trasladar, cuándo bajar margen y cuándo liquidar.

## 2. Decisiones de Victor (no volver a preguntar)

- **Nunca se sube XML.** La factura es la **compra que la administradora captura en SICAR de CEDIS** (`sicar_compras`,
  folio del proveedor en `folio`). Nada de esto usa "Facturas por llegar" ni `facturas_compras`.
- **Algo simple:** una **barra de cuánto queda** de cada factura, **en dinero (costo) y en piezas** — las dos.
- **Estrategias por antigüedad** (días desde la fecha de la compra en CEDIS):
  - **45 días:** avisos; **primera estrategia, traslado** a la tienda donde ese producto se vende rápido, **antes de
    bajar márgenes**.
  - **60 días:** bajar el margen: conservar **75 %** de la ganancia de la pieza.
  - **90 días:** otro descuento: conservar **50 %** de la ganancia.
  - **120 días:** **liquidar a costo** (0 % de ganancia). Vender abajo del costo no lo sugiere el sistema.
  - Los cuatro plazos y los tres porcentajes son configurables después (valores iniciales los de arriba).
- **El sistema solo avisa y sugiere.** No cambia precios, existencias, catálogo ni traspasos: eso se hace en SICAR.
- **Quién ve:** Victor y Compras (corporativo), con un permiso nuevo. Avisos en pantalla. Más adelante se abrirá a
  encargados (solo su tienda, sin costos); no entra ahora.
- **Tiendas sin agente** (Yajalón, Palenque, Innotec): estamos en fase de pruebas; Victor les instalará el agente
  cuando esto esté completo. Mientras, lo enviado ahí se muestra como **"enviado, venta no comprobada"** (tramo gris);
  al instalarles el agente sus ventas empiezan a contar solas.
- **Orden de salida:** lo primero que llegó a CEDIS es lo primero que sale y lo primero que se vende (FIFO), ya
  aprobado en el diseño del 2026-10-25.

## 3. Datos que ya llegan (master 16856f1) — reconocimiento de Codex

- **Compras CEDIS:** `sicar_compras` (sucursal_id, com_id, fecha local 'YYYY-MM-DDTHH:MM:SS', pro_id, folio,
  comentario, estado vigente|cancelada, total_centavos) y `sicar_compras_detalle` por renglón (art_id, cantidad texto
  decimal, precio_sin/precio_con/importe_con en centavos). CEDIS es la sucursal 6 de CORPUNISOUND.
- **Traspasos:** `sicar_traspasos` + `sicar_traspasos_detalle` de cada SICAR con agente (Ocosingo, San Cristóbal,
  CEDIS). Lo que sale de CEDIS se ve completo desde el SICAR de CEDIS (`sucursal_id=6`, `suc_origen` = número SICAR de
  CEDIS, `suc_destino` = número SICAR de la tienda). **`suc_destino` usa numeración de SICAR**: se traduce con
  `sicar_sucursales_mapa`, nunca se toma como id de CORPUNISOUND (`sicarTraspasos.js:67`). Estados: enviado, recibido,
  cancelado. Un mismo traspaso visto por los dos SICAR se une por (folio, suc_origen, suc_destino) (`sicarTraspasos.js:103`).
- **Ventas por artículo:** `sicar_detalles` (con cliente) y `sicar_detalles_mostrador` (público en general), con
  encabezado vigente y **sin cuentas internas** (`NO_INTERNA`, como `sicarVentaReal.js` y Cinco Caminos
  `tablero.js:75`). El mostrador no trae clave: se une por art_id. La ingesta ya evita duplicar cliente/mostrador.
- **Existencias:** `sicar_existencias.existencia_diezmilesimas` por tienda con agente.
- **Llave entre SICARs:** `sicar_articulos.clave` actual por (sucursal_id, art_id). No hay índice único de clave por
  tienda: una clave repetida en una tienda se trata como **ambigua** (no se adivina).
- **Cantidades** en texto decimal: convertir a diezmilésimas como `aDiezmilesimas` (`sicarTraspasos.js:105`), sin float.
- **No llegan hoy:** devoluciones/notas de crédito, ajustes de inventario, precio vigente de catálogo, `factor` de
  conversión de compra. Se documentan como límite; no se inventan.

## 4. Cómo se calcula "cuánto queda" (Claude/Codex)

Por **artículo (clave)**, recorriendo en orden de fecha todos sus movimientos (desempate estable por id y renglón):

1. **Lotes:** cada renglón de compra CEDIS vigente es un lote (cantidad, costo unitario sin IVA, fecha). Compra
   cancelada no crea lote.
2. **Salidas de CEDIS** (traspasos con origen CEDIS, no cancelados) consumen los lotes más viejos en CEDIS y los
   mueven al destino conservando de qué factura son. **Enviado** = en tránsito; **recibido** = disponible en la tienda.
3. **Ventas** de cada tienda con agente consumen FIFO lo que esa tienda tiene de esos lotes. Ventas directas en CEDIS
   consumen en CEDIS. Traspasos entre tiendas y retornos a CEDIS mueven piezas conservando la factura.
4. **Lo que llegó a una tienda sin agente** queda como **"enviado, venta no comprobada"**: no se cuenta vendido ni
   como que sigue ahí.
5. **Existencia anterior a la primera compra registrada** (2023-12) o a cualquier lote: se consume **antes** que las
   compras posteriores como lote "sin factura / antigüedad desconocida". Si no se puede saber con certeza, la factura
   se marca **"atribución incierta"**, nunca se supone saldo inicial cero. **(Codex)**
6. **Nunca** una venta consume una compra futura; un traslado **no** reinicia la antigüedad.

**La barra de cada factura** muestra tres tramos, en **dinero (costo sin IVA)** y en **piezas**:
- **Vendido** (comprobado), **Queda** (en CEDIS, en tránsito o en tiendas con agente) y **gris "enviado, venta no
  comprobada"**. Porcentaje "queda" = queda / comprado. Si el costo falta o es cero: "no calculable".
- Se compara el saldo calculado contra la existencia de SICAR de cada tienda; una diferencia se muestra como
  **"movimientos por aclarar"**, nunca como faltante del encargado.

## 5. Avisos y estrategias (Claude/Codex con los plazos de Victor)

- **Etapa** de cada factura con saldo: menos de 45 días = sin aviso; 45 = traslado; 60 = margen 75 %; 90 = margen 50 %;
  120 = liquidar a costo. Un aviso por **cambio de etapa**, agrupado por factura.
- **Traslado primero** (desde 45 días, y se sigue mostrando a 60/90/120 si sigue siendo viable):
  - Velocidad de venta por tienda: piezas vendidas en las **últimas 8 semanas completas** / 8 (se muestra también la de
    4 semanas).
  - Tienda destino candidata: velocidad **al menos el doble** que el origen, ventas en **al menos 2 semanas
    distintas** y cobertura (existencia / velocidad) **menor a 4 semanas**.
  - Cantidad sugerida = mínimo de: saldo viejo de esa factura en el origen; lo que sobra en el origen dejando **2
    semanas** de su venta; lo que le falta al destino para **4 semanas** (descontando su existencia y lo que trae en
    tránsito).
  - Sin datos suficientes (tienda sin agente, clave ambigua, existencia atrasada) no se sugiere cantidad: "revisar".
  - Texto de ejemplo: "Revisar traslado de 2 piezas de {clave} {descripción}: Ocosingo → San Cristóbal. En 8 semanas
    vendieron 2 y 16; San Cristóbal tiene 6 y nada en tránsito. Confirmar antes de mover en SICAR."
  - Las 8/4/2 semanas y el "doble" son valores iniciales configurables **(Codex)**; se validan contra facturas reales
    antes de dar por buenas las cantidades.
- **Margen:** como el precio vigente no llega de SICAR, el aviso dice la regla con números de la factura:
  "Bajar el precio para conservar el 75 % de la ganancia: costo $X; precio sugerido = costo + 75 % de la ganancia
  actual". Si el precio actual no se conoce, muestra la fórmula con el costo y el último precio vendido como
  referencia, marcado como referencia. **No inventa** un precio vigente.
- **Advertencia obligatoria:** SICAR cambia el precio **por artículo**, no por factura; si hay piezas del mismo
  artículo de compras recientes, el aviso lo dice ("también bajaría el precio de N piezas compradas hace D días").
- **Gestión del aviso:** "revisado" o "posponer hasta {fecha}" con motivo; queda quién y cuándo. No existe "marcar
  vendido": nada limpia la barra salvo ventas reales.

## 6. Pantalla "Seguimiento de facturas CEDIS"

- **Lista:** proveedor, folio, fecha de compra, días, **barra** (dinero y piezas, con tramo gris), etapa y siguiente
  acción. Orden inicial: mayor costo pendiente entre las que ya están en aviso. Filtros: proveedor, folio o clave,
  rango de fechas, tienda destino, etapa, "solo con aviso", ocultar agotadas.
- **Detalle de una factura:** por artículo: comprado, vendido, queda (en CEDIS / tránsito / por tienda), enviado sin
  comprobar, existencia SICAR y "movimientos por aclarar"; las estrategias sugeridas con su gestión.
- Encabezado fijo: "Asignación estimada en orden de llegada (FIFO) según SICAR". El comentario "COMPRA {TIENDA}" se
  muestra como referencia, no como destino real.
- Acceso desde el menú, junto a Existencias/Traspasos SICAR.

## 7. Permisos

- `ver_seguimiento_facturas` (módulo `inventario`): ver lista, detalle y avisos. Expone costos: solo corporativo.
- `gestionar_seguimiento_facturas` (módulo `inventario`): marcar revisado/posponer y cambiar los valores configurables.
- Registrados en `backend/permisosCatalogo.js`; el Administrador los recibe solo; los demás roles los da Victor.
  Ninguna ruta presta otro permiso.

## 8. Rendimiento y consistencia (Codex)

- better-sqlite3 es síncrono: **no** se recalcula todo en cada petición. Se calcula por artículo con consultas
  agrupadas y se guarda el resultado derivado con versión y fecha de sus fuentes; se recalcula solo el artículo
  afectado cuando llegan compras, traspasos, ventas, cancelaciones o cambios de clave (y una vuelta diaria completa).
  Lista paginada.
- Cada cálculo se publica completo: no se mezclan saldos nuevos con ventas viejas.
- Medir con datos del tamaño real (decenas de miles de ventas) antes de dar por buena la velocidad.

## 9. Cómo se abusa y qué queda

- **Traslado de papel para "rejuvenecer" mercancía:** la antigüedad no se reinicia con traslados.
- **Cancelar una venta para mover la barra:** las canceladas no cuentan.
- **Posponer avisos para siempre:** cada posposición lleva motivo, fecha límite y quién; la lista las muestra.
- **Rojo falso contra un encargado:** datos incompletos dan "información insuficiente" o "movimientos por aclarar",
  nunca "producto inmóvil" ni faltante. La asignación FIFO no sirve para cobrar faltantes.

## 10. Lo que no entra

Avisos por WhatsApp; vista para encargados; cambiar precios o mover inventario desde CORPUNISOUND; devoluciones y
notas de crédito (no llegan); instalar el agente en Yajalón/Palenque/Innotec (lo hará Victor después).
