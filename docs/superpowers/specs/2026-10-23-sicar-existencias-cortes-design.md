# Existencias y cortes de caja desde SICAR — diseño

Fecha: 2026-10-23. Victor aprobó hacer "existencias y cortes" y pidió arrancar sin preguntas: las decisiones
marcadas **(Claude)** son de Claude y Victor las revisa al leer este documento.

Base: `master` 442dc9f. Rama `feature/sicar-existencias-cortes`, worktree
`.claude/worktrees/sicar-existencias-cortes`. Reconocimiento de SICAR en la PC de Ocosingo:
`C:\UnisoundSICAR\reconocimiento-f0.md` y `reconocimiento-f1.md` (resumen en la sección 6).

Son dos entregas independientes que comparten el mismo camino (agente → lote → servidor → pantalla). Se construyen
y se pueden mergear por separado: **E1 existencias, E2 cortes**.

## 1. Para qué

- **Existencias:** que Victor y la administración vean desde CORPUNISOUND cuántas piezas hay de cada producto en
  cada tienda que cobra en SICAR, sin pedirle a nadie que se asome a la PC de la tienda. Que una existencia negativa
  (se vendió algo que el sistema decía que no había) salte a la vista.
- **Cortes:** la auditoría de cajeras del plan corporativo (F7). Ver, por tienda, caja, día y cajera, lo que SICAR
  calculó, lo que se contó, la diferencia y el retiro de cada corte, y el acumulado por cajera en un periodo.

**Éxito:**
- Una venta cobrada en SICAR Ocosingo a las 10:00 baja la existencia en CORPUNISOUND a más tardar ~10:05.
- Un corte hecho en SICAR aparece en CORPUNISOUND en la siguiente corrida del agente (≤ 5 min).
- Victor asigna una sola vez "el usuario 3 de SICAR Ocosingo es Fulana", y desde entonces los cortes salen con ese
  nombre, incluidos los viejos.

## 2. Principios (no negociables)

- **Solo observar.** Nada de esto toca el catálogo, las existencias, los cortes ni la caja de CORPUNISOUND. Los datos
  SICAR viven en tablas `sicar_*` aparte (igual que clientes, ventas, artículos y proveedores).
- **SICAR en solo lectura.** El agente solo hace SELECT/SHOW por la guardia de `agente-sicar/seguridad.js`.
- **Ningún nombre de empleado sale de la PC de la tienda.** El agente manda el número de usuario de SICAR (`usu_id`),
  nunca el nombre. El nombre lo pone Victor en CORPUNISOUND (sección 4.4).
- **No inventarle faltantes a una cajera honesta.** La pantalla dice "según SICAR", muestra la diferencia tal cual la
  guardó SICAR (sin recalcularla con otras reglas) y no usa palabras como "robo" o "le falta".
- **Opcional y apagado por defecto en el agente.** Cada colección nueva tiene su interruptor en `config.json`
  (`"existencias"`, `"cortes"`), igual que `articulos` y `proveedores`: un servidor viejo rechaza la llave nueva con
  400 y eso detendría las ventas.
- **La tienda sale de la llave**, nunca del lote (como hoy).

## 3. E1 — Existencias

### 3.1 Agente

- **Qué lee (confirmado en Ocosingo):** `SELECT art_id, existencia FROM articulo WHERE status = 1 AND servicio = 0
  AND art_id > ? ORDER BY art_id LIMIT ?`. `status` 1 vigente / -1 borrado; `servicio` 1 = servicio (31 en total).
  Un solo almacén. La lectura completa (6,420 filas) tarda 7–12 ms en la PC de Ocosingo: leerla cada 5 min no pesa.
  Hoy ninguna existencia vigente trae decimales (rango -1 a 290), pero se mandan los 4 decimales tal cual.
  Columnas nuevas en el diccionario: `COLUMNAS_EXISTENCIAS` en `mapeo.js`, opcionales como `COLUMNAS_ARTICULOS`: si
  falta una, se sigue con todo lo demás y se avisa `EXISTENCIAS_NO_DISPONIBLES`.
- **Cuándo:** en cada corrida (cada 5 min), al final, después de ventas, historial, ventana 48 h y listas diarias.
- **Cómo manda solo cambios (Claude):** SICAR no guarda cuándo cambió una existencia. El agente lee la lista completa
  de vigentes (≈ 6,400 filas en páginas de 500) y la compara contra la última existencia **confirmada por el
  servidor**, que guarda en `estado.json` (`existencias: { art_id: "3.0000" }`). Manda solo:
  - los artículos cuyo valor cambió o que no estaban;
  - los que estaban y ya no son vigentes (borrados o vueltos servicio) con `existencia: null` → el servidor borra la
    fila.
  La copia local se actualiza **solo cuando el lote se confirma**, con el mismo mecanismo `pendiente.cambios` que ya
  usan los cursores: si el envío falla, se reintenta lo mismo y no se pierde un cambio.
- **Vuelta completa diaria:** una vez al día, de noche (mismo horario que las listas), y con `--existencias-ahora`,
  manda **todas** las vigentes aunque no hayan cambiado. Cada fila reenviada renueva su `actualizado_en` en el
  servidor. Marca `existencias_dia`.
- **Filas huérfanas (Claude):** si el servidor tiene una fila que el agente ya no recuerda (se borró `estado.json`,
  se reinstaló el agente o se restauró un respaldo), la vuelta diaria no la toca. No se borra nada en automático: la
  pantalla muestra en gris "sin confirmar desde <fecha>" toda fila cuyo `actualizado_en` sea más viejo que 36 h, y la
  excluye de los totales. Sin cambio de contrato.
- **Tamaño:** primera corrida ≈ 13 lotes; después, típicamente 0–1 lote por corrida. Respeta el límite del servidor
  de 12 lotes por minuto por llave y el `MAXIMO_LOTES_POR_CORRIDA` existente.
- **Formato:** fila `{ "art_id": "123", "existencia": "-1.0000" }`; `existencia` es texto decimal **con signo** y 4
  decimales, o `null`. El agente no redondea (SICAR guarda 4 decimales).
- **`--verificar`** reporta columnas, faltantes, cuántas vigentes y cuánto tardó la lectura completa.

### 3.2 Contrato (`docs/sicar-contrato-v1.md`)

- `existencias`: colección opcional nueva, mismas reglas que `articulos`/`proveedores`: puede ser el único contenido
  del lote, hasta 500 por lote, sin `art_id` repetido, no cambia `schema_version`, recibo con
  `aceptados.existencias`. Fila exactamente `{ art_id, existencia }`; `existencia` es `null` o cumple
  `^-?\d{1,16}\.\d{4}$`. Cualquier otra cosa: 422 `IMPORTE_INVALIDO` (falla cerrando).

### 3.3 Servidor

- Tabla `sicar_existencias (sucursal_id, art_id, existencia_diezmilesimas INTEGER, actualizado_en TEXT,
  PRIMARY KEY (sucursal_id, art_id))`. Se guarda como entero en diezmilésimas (sin aritmética binaria, como los
  centavos). `null` → `DELETE`.
- Entra al respaldo SICAR en Drive (`sicarRespaldo.js`): tabla nueva = generación nueva; los respaldos viejos se
  siguen pudiendo restaurar (la tabla queda vacía) — mismo patrón que `sicar_proveedores`.
- `GET /api/sicar/existencias?q=&solo=con|negativas|todas&pagina=`:
  - Permiso nuevo `ver_existencias_sicar` (módulo `inventario`), dado de alta en `permisosCatalogo.js`.
  - **Alcance (Claude):** quien tiene el permiso ve **todas** las tiendas con agente. Es información de inventario,
    no de clientes, y su uso principal es "¿hay en otra tienda?". El alcance no sale del encabezado ni de
    `?sucursal_id=`; la columna por tienda es solo presentación.
  - Junta con `sicar_articulos` (clave, descripción, categoría, departamento) por `(sucursal_id, art_id)` y agrupa por
    **clave** entre tiendas (los `art_id` no son los mismos de una tienda a otra). Sin clave: renglón por tienda.
  - Devuelve por tienda la hora de la última actualización de existencias.
  - Paginado (50 por página), búsqueda por clave o descripción sin acentos.

### 3.4 Pantalla

- "Existencias SICAR" en el menú de Inventario, visible con `ver_existencias_sicar`.
- Buscador; filtros "Con existencia" (default), "Negativas", "Todas".
- Tabla: Clave · Descripción · Departamento/Categoría · una columna por tienda con agente · Total.
- Negativas en rojo con la nota "SICAR registra existencia negativa: se vendió sin existencia".
- Arriba, por tienda (Claude): "Último contacto del agente: hace 3 min" (= `sicar_tiendas.ultima_recepcion`, que se
  mueve con cualquier lote: ventas, clientes, existencias…) y "Último cambio de existencias: hoy 10:42". Sin aviso
  ámbar por horario: el sistema no conoce el horario de cada tienda y una tarde sin ventas no manda lotes. Si el
  último contacto pasa de 24 h, aviso ámbar "el agente de esta tienda no ha enviado nada desde <fecha>".
- Solo lectura: ningún botón cambia nada.

## 4. E2 — Cortes de caja

### 4.1 Qué hay en SICAR (confirmado en Ocosingo)

- `cortecaja`: `cor_id` bigint PK creciente con el tiempo (8,001 cortes, del 1 al 8,006), `fecha` datetime, `contado`,
  `calculado`, `diferencia`, `retiro` decimal(20,2), `caj_id` int.
- `cortetipopago`: PK (`cor_id`, `tpa_id`) con `contado`, `calculado`, `diferencia`, `retiro` por forma de pago.
  `tipopago`: 1 Efectivo, 2 Cheque, 3 Crédito, 4 Transferencia, 5 Vales, 6 Tarjeta, 7 Anticipo, 8 SICAR Pagos.
- Cajero: `historial` con `tabla = 'CorteCaja' AND movimiento = 0 AND id = cor_id` → `usu_id`. **Exactamente uno por
  corte** en los 8,001. Se escribe entre 0 y 22 s después del corte.
- **Un corte no se edita ni se reabre**: en `historial` CorteCaja solo hay altas (movimiento 0).
- **Signo:** `diferencia = contado - calculado`, sin excepción (7,629 cortes con diferencia ≠ 0; 5,293 sobrantes,
  2,336 faltantes). Lo mismo por forma de pago, y la suma por forma de pago = la del corte. Casi todas son de
  centavos (ej. +0.50, -0.33).
- **El `usu_id` del corte es quien lo CERRÓ, no la cajera del turno.** En 52 de 59 cortes recientes con ventas cobró
  más de una persona o una distinta a la que cerró. Quién dio de alta cada venta sale de `historial` (tabla `Venta`,
  movimiento 0, `id = ven_id`) y la venta se liga al turno con `venta.rcc_id` → `resumencortecaja.cor_id`.
- SICAR también corta entre jornadas, no solo al cierre (~1.4 cortes/día; cajas 1 y 3 activas, la 2 borrada).
- `usuario` trae nombre, domicilio, teléfonos, contraseña, foto y huella: **el agente no lee esa tabla**.

### 4.2 Agente

- Cursor `cortes_cor_id`. En cada corrida lee cortes con `cor_id > cursor` (páginas de 500), y para esos ids sus
  renglones de `cortetipopago` y su `usu_id` de `historial` (consultas por lista de ids, como `porIds`).
- **Corte sin su renglón de historial todavía** (llega hasta 22 s después): si el corte tiene menos de 10 min, el
  cursor **se detiene antes de él** y se reintenta en la siguiente corrida; si es más viejo, se manda con
  `usu_id: null` y se anota `CORTE_SIN_CAJERO cor_id=…` (Claude).
- Como un corte no cambia, no hay relectura ni ventana: solo cursor. La carga histórica (~8,000 cortes ≈ 17 lotes)
  sale sola en las primeras corridas, respetando el tope por corrida.
- **Quién cobró en el turno:** para cada corte, el agente suma por `usu_id` las ventas del turno (`venta.rcc_id` del
  resumen de ese corte, alta en `historial` Venta movimiento 0): cuántas ventas y su total (vigentes; las canceladas
  aparte). Solo números.
- Fila: `{ cor_id, caj_id, fecha_local, usu_id, contado, calculado, diferencia, retiro, pagos: [ { tpa_id, contado,
  calculado, diferencia, retiro } ], cobros: [ { usu_id, ventas, total, canceladas, total_canceladas } ] }`. Importes en texto con signo y 2 decimales (`^-?\d{1,16}\.\d{2}$`);
  `pagos` solo con los renglones que no son todos cero (Claude: la mayoría de las 7 formas vienen en 0).
- No manda nombres de usuario ni de caja. El nombre de la caja (p. ej. "Caja 1") no es dato personal pero no hace
  falta en E2: la pantalla muestra "Caja 1"/"Caja 3" por número (Claude).
- `COLUMNAS_CORTES` en `mapeo.js`, opcional: si falta algo, `CORTES_NO_DISPONIBLES` y sigue todo lo demás.

### 4.3 Contrato

- `cortes`: colección opcional nueva, hasta 100 por lote, sin `cor_id` repetido, `pagos` hasta 8 sin `tpa_id`
  repetido; `fecha_local` con el formato de `ventas`; `usu_id` id o `null`; recibo con `aceptados.cortes`. Un importe
  fuera del patrón: 422 `IMPORTE_INVALIDO`.

### 4.4 Servidor

- `sicar_cortes (sucursal_id, cor_id, caj_id, fecha_local, usu_id, contado_centavos, calculado_centavos,
  diferencia_centavos, retiro_centavos, actualizado_en, PRIMARY KEY (sucursal_id, cor_id))` y
  `sicar_cortes_pagos (sucursal_id, cor_id, tpa_id, contado_centavos, calculado_centavos, diferencia_centavos,
  retiro_centavos, PRIMARY KEY (sucursal_id, cor_id, tpa_id))` y `sicar_cortes_cobros (sucursal_id, cor_id, usu_id,
  ventas, total_centavos, canceladas, total_canceladas_centavos, PRIMARY KEY (sucursal_id, cor_id, usu_id))`.
  Upsert; un corte reenviado reemplaza sus pagos y cobros.
  Centavos con signo, enteros (sin aritmética binaria).
- `sicar_cajeros (sucursal_id, usu_id, nombre, asignado_por, asignado_en, PRIMARY KEY (sucursal_id, usu_id))` y
  `sicar_cajeros_historial (id, sucursal_id, usu_id, nombre_anterior, nombre_nuevo, actor, fecha)`.
- Todas al respaldo SICAR en Drive (generación nueva, compatible con las viejas).
- Permisos nuevos en `permisosCatalogo.js`, módulo `admin` (Claude: es auditoría, no operación de caja):
  `ver_cortes_sicar` y `asignar_cajeros_sicar`, separados (ver no da para cambiar a quién se atribuye un corte).
- Alcance: con `ver_todas_las_sucursales` todas las tiendas; sin él, solo la `sucursal_id` de su token. Nunca del
  encabezado ni de `?sucursal_id=` (regla 5).
- `GET /api/sicar/cortes?desde=&hasta=&sucursal_id=&caj_id=&usu_id=` (el filtro de tienda se interseca con el
  alcance), `GET /api/sicar/cajeros`, `PUT /api/sicar/cajeros/:sucursal_id/:usu_id` (`Number(...)` en los ids;
  nombre 2–80 caracteres, sin controles).

### 4.5 Pantallas

**Regla de atribución (Claude, por el principio de no inventar faltantes):** una diferencia es **del turno**, no de
una persona. Solo se atribuye a alguien cuando esa persona fue la **única** que cobró en el turno. Si cobraron varias,
la diferencia sale como "compartida" con la lista de quiénes cobraron y cuánto cada una; nunca se reparte ni se le
carga a quien cerró el corte.

- "Cortes SICAR": filtros tienda, desde/hasta (default últimos 30 días), caja, persona. Tabla por corte: fecha y
  hora, caja, **cerró** (nombre asignado o "Usuario SICAR 52 — sin nombre"; con nombre, siempre se ve también el
  número), **cobraron** (nombres con su número de ventas y total), calculado, contado, diferencia, retiro; se
  despliega el desglose por forma de pago. Diferencia = contado − calculado: positiva = sobrante (azul), negativa =
  faltante (ámbar), 0 normal. Rótulo fijo: "Cifras según SICAR".
- **Centavos (Claude):** 95% de los cortes tienen diferencia distinta de 0, casi siempre de centavos. Las diferencias
  se muestran todas, pero los contadores del resumen cuentan solo las de **$1.00 o más** ("faltantes de $1 o más"),
  con el umbral visible en pantalla.
- Resumen por persona en el periodo (agrupado por tienda + `usu_id`, no por nombre: dos usuarios con el mismo nombre
  no se suman): turnos en que cobró, ventas y total cobrado, turnos que cerró, y diferencias de los turnos en que
  **fue la única que cobró** (suma, faltantes de $1 o más, sobrantes de $1 o más). Aparte: total de diferencias
  compartidas en las que participó, sin atribuir.
- "Personal de SICAR" (con `asignar_cajeros_sicar`): `usu_id` vistos por tienda (en cortes o cobros), cuántos turnos,
  el último, nombre asignado y botón para cambiarlo; historial de cambios visible ahí mismo.

## 5. Cómo se abusa y qué queda

- **Atribuir un faltante a otra persona** cambiando el nombre de un `usu_id`: permiso aparte, historial de cada
  cambio, y la pantalla muestra siempre el número de SICAR junto al nombre.
- **Culpar a quien cerró el corte:** el corte lo cierra quien sea; la diferencia solo se atribuye a quien fue la única
  en cobrar en ese turno. Si no, es compartida.
- **Llave de una tienda escribiendo existencias o cortes de otra:** imposible, la tienda sale de la llave.
- **Existencias falsas desde fuera:** solo con una llave SICAR válida; nada de esto alimenta inventario ni dinero de
  CORPUNISOUND.
- **Faltante inventado por el sistema:** no recalculamos; mostramos lo que SICAR guardó, rotulado "según SICAR".

## 6. Datos confirmados en SICAR Ocosingo (2026-10-23, solo lectura)

- MySQL 5.6.47 (sin funciones de ventana). En SICAR, Ocosingo es la sucursal 2 de su red de traspasos.
- Existencia: `articulo.existencia decimal(20,4)` (y `existenciaActivo`), un almacén, sin fecha de modificación.
  Vigentes sin servicios 6,420 (742 con > 0, 1 negativa, 5,677 en 0); borrados 7,206, todos en 0.
  SICAR toma una foto diaria ~08:00 (`inventariofecha` + `inventariofechaarticulo`, desde 2022) — fuera de alcance
  aquí; útil para historia más adelante.
- Cortes: ver 4.1. Ejemplo real: cor 8006, caja 1, 2026-10-23 17:53, contado = calculado = retiro = 18,242.59,
  diferencia 0; efectivo 12,486.85 y tarjeta 5,755.74. `venta.caj_id` y
  `venta.rcc_id` → `resumencortecaja.cor_id`; un resumen con `cor_id` NULL = turno abierto. Las salidas "POR CORTE
  DE CAJA" de `movimiento` son el retiro del corte (verificado al centavo en 27 casos).

## 7. Lo que no entra

- Traspasos, proveedor por artículo y el SICAR de CEDIS (siguientes entregas).
- Historia de existencias día por día (la foto diaria de SICAR).
- Avisos por WhatsApp/correo; tableros de metas con estos datos.
- Comparar cortes SICAR contra el corte de CORPUNISOUND (las tiendas cobran en SICAR).

## 8. Lo que queda al constructor

- Nombres de funciones, archivos de prueba y orden de tareas (TDD, una prueba roja antes de cada cambio).
- Textos exactos de la pantalla, siguiendo el estilo de las pantallas SICAR existentes.
- Ajuste fino de paginado y tiempos dentro de los límites de arriba.
