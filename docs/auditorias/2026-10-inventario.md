# Auditoría de la zona de inventario — CORPUNISOUND, octubre 2026

Auditor independiente. Base revisada: `master` en el commit `45e8f9c`. Fecha: 2026-10-27.
No se modificó código de la aplicación. Las reproducciones viven en
`docs/auditorias/2026-10-inventario/` y se corren así:

```bash
cd backend
node --test ../docs/auditorias/2026-10-inventario/reproducciones.test.cjs ../docs/auditorias/2026-10-inventario/rutas.test.cjs
```

Cada prueba de esa carpeta **pasa mientras el defecto exista**. Cuando se arregle, la prueba se pone roja:
eso es lo esperado, y se borra o se invierte junto con el arreglo. Resultado hoy: **18 de 18 pasan**.

---

## 1. Resumen

1. **14 hallazgos: 0 críticos, 3 altos, 6 medios, 5 bajos.** 11 reproducidos con prueba; 3 solo leídos.
2. **El peor:** publicar un producto en MercadoLibre **reemplaza** la existencia de la sucursal 5 con la cantidad que se teclea al publicar (la pantalla trae **1** por defecto), sin dejar movimiento ni nombre de quién lo hizo.
3. Hay dos caminos más para que salga o cambie mercancía sin dejar rastro en el historial del producto: una **garantía registrada a nombre de cualquier cliente** (aunque no exista) y la **Migración de Datos**, que fija existencias con la firma "Importación SICAR" y sin el nombre de quien subió el archivo.
4. Pregunta B (faltantes inventados a un encargado honesto): **sí pasa**. Una recepción de compra capturada dos veces (CEDIS), un traspaso al que le llegó menos (la tienda destino) y un pendiente de MercadoLibre resuelto después de cancelar la venta (sucursal 5).
5. Aparte: de fábrica, el sistema **deja vender lo que no hay en existencia**. No pude ver cómo está esa casilla en la base real; Victor debe revisarla en Configuración.

**Quién puede hacer qué.** Casi todos los hallazgos piden permisos que el rol **"Gerente de sucursal" sembrado de fábrica**
trae completos (`backend/roles.js:68-87`: todos los permisos menos una lista corta, y esa lista no incluye
`gestionar_publicaciones_ml`, `gestionar_garantias`, `migrar_datos`, `recibir_compra`, `realizar_traspasos`,
`ajustar_existencia` ni `agregar_articulo_rapido`). El rol **"Cajero"** de fábrica no tiene ninguno de ellos. Los roles
de la base real pueden ser distintos: Victor lo confirma en **Roles y Personal**.

---

## 2. Hallazgos (de más a menos grave)

### H1 · Publicar en MercadoLibre reemplaza la existencia de la sucursal 5, sin movimiento — ALTA

- **Estado:** REPRODUCIDO — `reproducciones.test.cjs`, prueba "H1" (con la llamada a MercadoLibre simulada).
- **Quién:** cualquiera con `gestionar_publicaciones_ml` (Gerente de fábrica, Administrador).
- **Qué hace:** en MercadoLibre ▸ Publicar, elige un producto y aprieta Publicar. El campo "cantidad" trae **1** por defecto
  (`src/MercadoLibre.jsx:58`). Por petición: `POST /api/ml/publicar` con `{ producto_id, cantidad }`.
- **Cuánto:** la existencia de la sucursal 5 (MercadoLibre) **pasa a valer exactamente esa cantidad**, haya lo que haya.
  En la prueba: CEDIS traspasa 10 piezas a ML; se publica con la cantidad por defecto y la existencia queda en **1**:
  **9 piezas desaparecen** del sistema. Al publicar con 50, aparecen **49 piezas de la nada**. No hay tope: depende del
  producto. Con un bajo de $9,000 son $81,000 de mercancía que el sistema deja de ver, o que inventa.
- **Qué queda registrado:** **nada** en el historial del producto. No hay movimiento de inventario ni usuario. Solo queda
  la publicación local, con su cantidad.
- **Consecuencias:** si borró piezas, las siguientes órdenes de ML de ese producto se **rechazan** por "no alcanza la
  existencia" (`mercadolibre.js:323-343`) y la venta no entra al corte de la sucursal 5 hasta que alguien ajuste. Si
  inventó piezas, el sistema "tiene" mercancía que no existe, y el faltante le cae a quien cuenta.
- **Dónde:** `backend/mercadolibre.js:160-168` (escribe `cantidad_actual = item.available_quantity` directamente, con el
  comentario "Descontar del inventario ML"). Ruta: `backend/server.js:3480-3483`.
- **Cómo se cierra:** publicar no debe tocar la existencia local. La cantidad que se anuncia en ML y la existencia de la
  sucursal 5 son dos cosas distintas, y la existencia solo se mueve por traspaso, venta o ajuste, con su movimiento.

### H2 · Una garantía a nombre de cualquier cliente saca una pieza de la tienda sin bajar la existencia — ALTA

- **Estado:** REPRODUCIDO — funciones (`reproducciones.test.cjs`, prueba "H2") y ruta HTTP con el token de un gerente
  amarrado a Ocosingo (`rutas.test.cjs`, prueba "RUTA H2").
- **Quién:** cualquiera con `gestionar_garantias`.
- **Qué hace:** registra una garantía de un producto **de la tienda** y le pone un cliente. Por petición se acepta
  **cualquier número de cliente, aunque no exista** (en la prueba, el 424242), y un número de venta que tampoco se
  revisa. Después: Enviar → Resolución "reemplazo" → Recibir → Entregar al cliente.
- **Cuánto:** una pieza por garantía, del precio que sea. La pieza sale físicamente ("se envía al proveedor") y luego se
  "entrega al cliente", y la existencia **nunca baja**. En el conteo aparece un faltante sin ningún movimiento que lo
  explique.
- **Qué queda registrado:** el expediente de la garantía, con su bitácora y el nombre del usuario. En el **historial
  del producto** (donde busca quien investiga un faltante) no aparece nada.
- **Por qué pasa:** el sistema decide si la pieza es "de la tienda" o "del cliente" solo por si el campo cliente viene
  vacío (`backend/garantias.js:116-118`). Si viene lleno, no descuenta al enviar ni reintegra al recibir
  (`garantias.js:183-186`, `243-246`). `cliente_id` y `venta_id` no se validan (`garantias.js:151-152`).
  Ruta: `backend/server.js:2126-2138`.
- **Cómo se cierra:** una garantía "del cliente" tiene que apoyarse en una venta real a ese cliente que incluya ese
  producto, validada en el servidor. Sin esa venta, se trata como stock propio y descuenta.

### H3 · La Migración de Datos fija existencias a cualquier número y no dice quién lo hizo — ALTA

- **Estado:** REPRODUCIDO — funciones ("H3") y ruta HTTP con un gerente amarrado ("RUTA H3").
- **Quién:** cualquiera con `migrar_datos` (el Gerente de fábrica lo trae), en su propia sucursal. El Administrador, en
  la que elija.
- **Qué hace:** en Migración de Datos ▸ Artículos sube un Excel con la columna Existencia. Por petición:
  `POST /api/migracion/aplicar` con `{ tipo: "articulos", filas: [{ clave, existencia }], nombre_archivo }`. Las filas
  **las manda el navegador**: el servidor no vuelve a leer el archivo (`server.js:1344`).
- **Cuánto:** la existencia **se reemplaza** por la del archivo, sin límite. También acepta **negativos** (la prueba deja
  -5). Caso honesto y probable: alguien vuelve a subir un Excel de SICAR de la semana pasada, y todo lo que se vendió
  o se recibió desde entonces se "deshace" en el inventario. En la prueba, Ocosingo baja de 120 a 80: **40 piezas de
  faltante** para la encargada, sin que ella haya hecho nada.
- **Qué queda registrado:** un movimiento con usuario **"Importación SICAR"** y el nombre de archivo que manda la
  petición (puede ser cualquier texto) (`backend/migracion.js:338-349`). **No queda en ningún lado quién lo subió**: la
  ruta no le pasa el usuario a la importación (`server.js:1342-1357`). Los productos nuevos que se dan de alta por
  migración con piezas quedan con usuario "—" (`migracion.js:352`).
- **Cómo se cierra:** la importación debe firmar cada movimiento con la persona que la ejecutó (además de "Importación
  SICAR") y no aceptar existencias negativas. Conviene también exigir que la existencia de un producto que ya existe
  solo se fije con una confirmación explícita de "sobreescribir".

### H4 · La misma recepción de compra entra dos veces y la existencia sube dos veces — MEDIA

- **Estado:** REPRODUCIDO — funciones ("H4") y ruta HTTP ("RUTA H4").
- **Quién:** cualquiera con `recibir_compra` (normalmente CEDIS).
- **Qué hace:** registra dos veces la misma factura del mismo proveedor (porque la capturó otra persona, o porque una
  pestaña quedó abierta). La pantalla bloquea el doble clic mientras guarda (`src/RecepcionCompras.jsx:518`), pero
  el servidor no revisa nada si no viene folio fiscal.
- **Cuánto:** la cantidad completa de la factura, otra vez. En la prueba, 30 piezas recibidas quedan en 60. El folio
  fiscal (UUID) solo se compara letra por letra: el mismo folio en mayúsculas, en minúsculas o con un espacio adelante
  pasa como si fuera otro. La prueba mete **la misma factura 5 veces: 150 piezas por 30**.
- **Pregunta B:** el sistema dice 60 y en bodega hay 30. **El encargado de CEDIS carga un faltante de 30 piezas** que no
  existe. Además, las piezas fantasma pueden tapar un robo real.
- **Qué queda registrado:** dos recepciones con usuario. Se puede rastrear, pero nadie lo va a buscar.
- **Dónde:** `backend/compras.js:30-33` (solo revisa el UUID, solo si viene, y comparándolo exacto); `87-110`.
  Ruta: `backend/server.js:1267-1276`.
- **Cómo se cierra:** el servidor debe rechazar (o pedir confirmación explícita para) una segunda recepción con el mismo
  proveedor y el mismo número de factura. El UUID se compara sin espacios y sin distinguir mayúsculas.

### H5 · Traspaso: la tienda destino solo puede confirmar la cantidad completa, aunque le llegue menos — MEDIA

- **Estado:** REPRODUCIDO ("H5").
- **Quién:** le pasa a la encargada de la tienda **destino**, por hacer su trabajo bien.
- **Qué hace:** le llega un traspaso de 5 piezas y en la caja vienen 4. Solo tiene un botón: confirmar. El sistema le
  suma **5**, y lo que pasó solo puede escribirlo en el comentario.
- **Cuánto:** las piezas que se perdieron en el camino. Esas piezas **le quedan como faltante a la tienda destino**, no a
  quien envió ni al transporte. La salida de la tienda origen sí es correcta.
- **Qué queda registrado:** el comentario de recepción, en texto libre. Ningún reporte lo suma.
- **Dónde:** `backend/traspasos.js:4-8` y `88-93`. Es una exclusión **escrita en el spec**
  (`docs/superpowers/specs/2026-07-08-inventario-traspasos-design.md:19-20`; cancelar un traspaso en tránsito tampoco
  existe, `:151`). No es una de las decisiones de Victor registradas en `CLAUDE.md`. Por eso lo reporto: la consecuencia
  es justo la de la pregunta B.
- **Cómo se cierra:** que Victor decida si la recepción puede registrar "llegaron N". Si se decide que sí, la diferencia
  queda como incidencia del traspaso (con quién envió y quién recibió), no dentro de la existencia del destino.

### H6 · La validación "no vender más de lo que hay" viene apagada de fábrica — MEDIA

- **Estado:** REPRODUCIDO para la base nueva ("H6"). **SOLO LEÍDO para producción**: no tengo acceso a la base real, así
  que no sé cómo está ahí la casilla.
- **Quién:** cualquier cajera que cierre una venta o un apartado.
- **Qué hace:** vende 5 piezas de un producto que tiene 3. La venta entra y la existencia queda en **-2**.
- **Dónde:** `backend/configuracion.js:20` (`permitir_ventas_sin_existencia: true` en los valores de fábrica). La revisan
  `backend/ventas.js:115` y `backend/apartados.js:107`, y en la pantalla `src/PuntoDeVenta.jsx:385`. No encontré
  documentada la decisión de encenderla de fábrica.
- **Por qué importa:** con la casilla encendida, ninguna de las validaciones de existencia de venta y apartado corre. Eso
  incluye la que agrupa el mismo producto en dos renglones, que sí funciona cuando la casilla está apagada (lo comprobé:
  prueba "OK venta"). Las existencias negativas son la señal de que algo no cuadra, pero el sistema no le pide a nadie
  que la explique.
- **Cómo se cierra:** que Victor revise en **Configuración ▸ "Permitir Ventas de Artículos Sin Existencia"** cómo está hoy
  y decida. Si se apaga, que el valor de fábrica también quede apagado.

### H7 · Mercancía real vendida como "artículo rápido": se cobra y la existencia no baja — MEDIA

- **Estado:** REPRODUCIDO ("H7").
- **Quién:** cualquiera con `agregar_articulo_rapido` (el Gerente de fábrica lo trae; el Cajero no).
- **Qué hace:** en vez de buscar el producto, captura una línea rápida que dice "Arroz 1kg" (o "Bajo eléctrico").
- **Cuánto:** las piezas que se lleven. El dinero entra completo, pero la existencia no se mueve: el sistema sigue
  diciendo que la pieza está en el anaquel. El faltante aparece en el siguiente conteo, y nada lo une con esa venta.
- **Qué queda registrado:** la venta, con la descripción escrita a mano. Ningún movimiento de inventario.
- **Dónde:** `backend/ventas.js:118` (las líneas sin producto no se validan) y `354` (no descuentan). El código reconoce
  la puerta y la deja controlada solo por el permiso (`ventas.js:193-204`). Es diseño para servicios y piezas
  especiales; lo reporto porque es la venta que no descuenta de la pregunta A.
- **Cómo se cierra:** dar el permiso solo a quien lo necesite y que el reporte de ventas muestre aparte las líneas
  rápidas por vendedor, para revisarlas. Si Victor lo quiere más cerrado: no permitir una línea rápida cuya descripción
  coincida con un producto del catálogo.

### H8 · Venta de ML cancelada y después "vinculada": descuenta una pieza de una venta que ya no existe — MEDIA

- **Estado:** REPRODUCIDO ("H8").
- **Quién:** cualquiera con `importar_ordenes_ml`, sin mala intención.
- **Qué hace:** una orden de ML llega con un SKU que no está en el catálogo. Se importa y queda en "pendientes de
  vínculo" (correcto). El comprador devuelve y la venta se cancela; esa línea no reintegra nada, porque nunca descontó
  (también correcto). Pero **el pendiente sigue en la lista**, y días después alguien lo vincula.
- **Cuánto:** las piezas de esa línea. En la prueba, la existencia de la sucursal 5 baja de 3 a 2 con la pieza en la
  bodega: **faltante inventado** en MercadoLibre.
- **Qué queda registrado:** un movimiento "Venta MercadoLibre — orden N (vinculada después)" con el usuario, apuntando a
  una venta cancelada.
- **Dónde:** `backend/mercadolibre.js:381-421` (no revisa el estatus de la venta). La lista de pendientes no filtra las
  ventas canceladas (`backend/server.js:3505-3508`).
- **Cómo se cierra:** al vincular, si la venta está cancelada, el pendiente se cierra sin descontar. La lista de
  pendientes no debe ofrecer los de ventas canceladas.

### H9 · MercadoLibre: un SKU numérico puede descontar otro producto — MEDIA

- **Estado:** REPRODUCIDO ("H9"), con una condición: que en el catálogo haya claves numéricas que coincidan con el número
  interno de otro producto. No pude ver el catálogo real para saber si pasa.
- **Quién:** nadie lo provoca; pasa solo al importar una orden.
- **Qué hace:** al importar, el sistema busca el producto por "clave igual al SKU **o** número interno igual al SKU", y se
  queda con el primero que encuentra (`backend/mercadolibre.js:277-280`). Si el producto con número interno 2 está
  antes en la lista que el producto con clave "2", la orden del segundo descuenta el primero.
- **Cuánto:** las piezas de cada orden afectada: faltante en un producto y sobrante en el otro, los dos en la sucursal 5.
- **Qué queda registrado:** un movimiento de venta ML en el producto **equivocado**.
- **Cómo se cierra:** buscar primero por clave exacta, y usar el número interno solo si ninguna clave coincide.
  Todavía mejor: guardar el vínculo de cada publicación de ML con su producto (la colección `DB.ml.publicaciones` ya
  existe) y usarlo.

### H10 · Traspaso a una sucursal que no existe — BAJA

- **Estado:** REPRODUCIDO ("H10" y "RUTA H10", con un gerente amarrado a Ocosingo).
- **Quién:** cualquiera con `realizar_traspasos`. Desde la pantalla no se puede elegir una sucursal inexistente: hace
  falta mandar la petición a mano (`POST /api/traspasos` con `sucursal_destino_id: 99`).
- **Cuánto:** las piezas salen del origen y quedan "en tránsito" para siempre. Solo un usuario global puede
  "recibirlas", y entonces se crea existencia en una sucursal 99 que ninguna pantalla muestra.
- **Qué queda registrado:** el traspaso y la salida del origen, con usuario. Se ve en la lista de pendientes del origen,
  así que no es invisible.
- **Dónde:** `backend/traspasos.js:21`, `28-29` (no revisa que la sucursal destino exista). Ruta: `server.js:1239-1260`.
- **Cómo se cierra:** validar en el servidor que la sucursal destino exista y esté activa.

### H11 · Ajuste de existencia a un producto que no existe; el siguiente producto dado de alta lo hereda — BAJA

- **Estado:** REPRODUCIDO ("H11" y "RUTA H11").
- **Quién:** cualquiera con `ajustar_existencia`, por petición directa (`POST /api/productos/987654/ajustar`).
- **Qué hace:** el ajuste responde 200 aunque el producto no exista y crea una fila de existencia huérfana
  (`backend/productos.js:400-416`). Como el número del siguiente producto es "el más alto + 1"
  (`productos.js:182-184`), si se ajusta el número que sigue, **el próximo producto que se dé de alta aparece con esas
  piezas** (en la prueba, una guitarra recién capturada aparece con 50 en Ocosingo).
- **Además:** el motivo del ajuste es texto libre de la petición (`server.js:1227`). Puede decir "Venta — folio 1" o
  "Compra #1", y en el historial se ve como si viniera de un documento. El usuario sí sale del token (correcto,
  `server.js:1224-1226`).
- **Cómo se cierra:** rechazar ajustes a productos que no existen. Que el motivo de un ajuste manual quede siempre
  marcado como "Ajuste manual: …".

### H12 · Garantía de stock propio "rechazada": la pieza queda descontada para siempre — BAJA

- **Estado:** SOLO LEÍDO — `backend/garantias.js:226-231`.
- **Qué pasa:** al enviar una pieza de la tienda se descuenta 1. Si el proveedor la **rechaza**, la garantía se cierra
  directo y la pieza nunca se reintegra. Normalmente la pieza rechazada **regresa** a la tienda: el sistema dice una
  menos de las que hay (sobrante, no faltante).
- Es diseño del spec (`docs/superpowers/specs/2026-07-22-garantias-design.md:80`: "no hay producto físico de
  regreso"). Lo dejo para que Victor confirme si eso es cierto en la práctica. Con "nota de crédito" sí es correcto.

### H13 · MercadoLibre: la protección contra importar dos veces compara el texto de la dirección — BAJA

- **Estado:** SOLO LEÍDO — `backend/mercadolibre.js:435` y `562`.
- **Qué pasa:** la lista de órdenes ya importadas guarda el número **tal como viene en la dirección de la petición**, no
  el número de orden que devuelve MercadoLibre. Si MercadoLibre contestara la misma orden con el número escrito de
  otra forma, entraría dos veces y descontaría dos veces. No pude probar contra MercadoLibre real si eso es posible.
- **Cómo se cierra:** guardar y comparar `orden.id` (lo que contesta ML), normalizado a número.

### H14 · Crear un apartado se traga en silencio un error de inventario — BAJA

- **Estado:** SOLO LEÍDO — `backend/apartados.js:258-262`: `catch (e) { }` vacío.
- **Qué pasa:** hoy no se dispara, porque `ajustarExistencia` ya crea la fila que falte y la sucursal se valida antes. Pero
  si algún día falla, el apartado queda sin descontar y nadie se entera. `ventas.js:357-364` ya resolvió lo mismo con un
  aviso en la consola.
- **Cómo se cierra:** el mismo trato que en ventas: al menos dejar el aviso.

---

## 3. Lo que revisé y está bien (para no volver a revisarlo)

- **Venta** (`ventas.js:32-369`): con la validación de existencia encendida, agrupa el mismo producto en varios renglones
  y normaliza ids de texto (comprobado, prueba "OK venta"). Valida todo antes de escribir. Descuenta en la sucursal de
  la venta, con el usuario. La sucursal sale del token para usuarios amarrados (`server.js:2017-2032`).
- **Cancelación de venta:** no reintegra dos veces (comprobado, prueba "OK cancelar"). Reintegra a la sucursal de la
  venta. La ruta pide autorizador con contraseña, que no sea quien cancela, con `autorizar_cancelaciones` y de la misma
  sucursal (`server.js:2033-2068`). Si el folio es un apartado, lo manda a `cancelarApartado`.
- **Apartados:** descuentan al crear y reintegran una sola vez al cancelar o vencer (`apartados.js:340-394`). Un apartado
  liquidado no se puede cancelar por ninguna de las dos rutas.
- **Traspasos:** no se reciben dos veces (comprobado). Para un usuario amarrado, el origen sale de su token y solo recibe
  si su tienda es el destino (`server.js:1239-1260`, `traspasos.js:69-75`). Exigen piezas enteras y existencia en el
  origen.
- **Recepción de compras:** valida todos los renglones (producto existente, piezas enteras, costo mayor que cero) antes
  de escribir nada, y cada entrada deja movimiento con usuario.
- **Ajuste manual:** el usuario sale del token, no del cuerpo (`server.js:1224-1227`), y exige piezas enteras distintas de
  cero (`productos.js:470-473`).
- **Alta de producto:** la existencia inicial entra con movimiento y usuario (`productos.js:248-261`). La excepción es la
  migración (H3).
- **Baja de producto:** desactiva si tiene cualquier rastro, existencia incluida, comparando con `Number`
  (`productos.js:70-137`), y la ruta exige alcance global (`server.js:1174`).
- **Importación de órdenes ML:** solo importa órdenes pagadas. Rechaza sin escribir nada si un producto vinculado no
  alcanza. No hay espera entre la revisión de "ya importada" y la marca (`mercadolibre.js:430-443`). Los SKU sin
  vincular quedan visibles en pendientes, y un pendiente no se resuelve dos veces.
- **Garantías de stock propio:** descuentan 1 al enviar y reintegran 1 al recibir. Cada acción por `:id` pasa por la
  guarda de alcance (`garantias.js:123-130`).
- **Piezas enteras:** todas las entradas que llegan a `ajustarExistencia` pasan por `exigirPiezasEnteras` /
  `exigirCantidad` (venta, apartado, traspaso, compra, ajuste, alta, orden ML) o mueven ±1 (garantías). La migración
  valida enteros (`migracion.js:153-158`). Al arrancar, `limpiarExistenciasFraccionarias` corrige decimales viejos, con
  movimiento (`productos.js:450-467`).
- **Existencias de SICAR:** son de solo lectura. Ningún código fuera de `sicarRepositorio.js` / `sicarRespaldo.js` /
  `sicarExistencias.js` las lee, y nada las escribe en `DB.inventario` (búsqueda en `backend/` y `src/`). Solo las
  muestra la pantalla `src/sicar/ExistenciasSicar.jsx`.
- **Quién escribe existencias:** solo `productos.js` (alta, ajuste, limpieza), los flujos de arriba, y el caso de H1. La
  búsqueda de escrituras directas a `cantidad_actual` y a `existencias.push` no encontró otros lugares.
- **Restaurar respaldo:** pide clave, palabra de confirmación y alcance global, y toma un respaldo previo
  (`respaldos.js:595-645`, `server.js:3212-3262`). Reemplaza ventas e inventario **juntos**, así que la foto es
  coherente. Consecuencia que hay que saber: todo lo vendido o recibido después de la foto se pierde del sistema
  (las piezas reales no regresan), así que después de restaurar hay que hacer un conteo.

## 4. Lo que no pude revisar y por qué

- **La base real:** no tengo acceso. No sé cómo está la casilla de H6 ni qué permisos tienen los roles reales, así que
  "quién puede" está medido contra los roles de fábrica.
- **La prueba en navegador:** esta sesión no tiene Claude in Chrome ni datos reales. Reproduje todo por funciones y, para
  H2, H3, H4, H10 y H11, por peticiones HTTP al servidor real levantado en memoria. Falta ver en pantalla H1 (Publicar
  con la cantidad por defecto) y H2 (el formulario de garantías ofrece la lista de clientes y un campo libre de venta).
- **MercadoLibre real:** las llamadas a la API se simularon. No sé si ML acepta números de orden escritos de otra forma
  (H13) ni con qué cantidad contesta al publicar.
- **El agente SICAR de Windows (`agente-sicar/`) y los traspasos SICAR (`sicarTraspasos.js`):** solo comprobé que no
  escriben en `DB.inventario`. No revisé su lógica interna.
- **Ids reciclados al borrar un producto sin rastro:** la colección de vínculos SICAR podría apuntar a un id que se
  reutiliza. No lo revisé.
- **Los traspasos en tránsito:** mientras están en camino no aparecen en la existencia de ninguna tienda. No lo revisé en
  los reportes de existencias ni en el estado de cuenta (este último es zona de dinero).

## 5. Suite completa

`cd backend && node --test` (después de `npm ci` en `backend/` y en la raíz):
**3,433 pruebas; 3,426 pasan, 5 fallan, 2 marcadas como pendientes (TODO).** Las 5 fallas son del entorno de esta sesión,
no de la aplicación: las 4 de `buscarClavesSat` / `contarClavesSat` y la de "ARRANQUE REAL: en desarrollo SÍ se tolera"
fallan con `unable to open database file`, porque en este contenedor no existe `backend/datos.sqlite` (la tabla de claves
SAT). Sin el `npm ci` de la raíz fallan 10 más (no encuentran `react`). Las 18 reproducciones de esta auditoría no están
dentro de `backend/`, así que la suite no las corre.
