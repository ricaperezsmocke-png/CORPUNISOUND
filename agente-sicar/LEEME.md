# Agente SICAR → CORPUNISOUND

Este programa corre en la PC de la tienda donde está el MySQL de SICAR. Lee los clientes con nombre y sus
ventas **sin escribir nada en SICAR**, y los manda al CRM de CORPUNISOUND. El público en general no entra al CRM: si se
prende `"mostrador"` (ver "Ventas de mostrador"), sus ventas se mandan aparte, sin ningún dato de persona.

Cada vez que corre hace una sola pasada y termina. El Programador de tareas de Windows lo arranca cada 5 minutos.

- **Carga inicial** (todos los clientes y todas las ventas): solo de **20:00 a 07:00**, para no alentar el cobro.
  Si la tienda cierra a las 18:00, la carga completa de Ocosingo tarda una o dos noches.
- **Después**: cada 5 minutos manda las ventas nuevas y vuelve a leer las últimas 48 horas por si hubo cancelaciones.

## 1. Lo que se necesita

- Windows con **Node.js 20 o más nuevo** (`node -v` en una ventana de comandos).
- La contraseña del usuario `consultas` de MySQL y el nombre de la base de datos de SICAR.
- La **llave de la tienda**: la genera un Administrador en CORPUNISOUND → CRM → SICAR. Se muestra **una sola
  vez**; cópiala en ese momento.

## 2. Instalar

1. Copia esta carpeta `agente-sicar` (con su `node_modules`) a `C:\UnisoundSICAR\agente-sicar`.
   Si no trae `node_modules`, abre una ventana de comandos en esa carpeta y corre `npm ci`.
2. Copia `config.ejemplo.json` a **`C:\UnisoundSICAR\config.json`** (afuera de la carpeta del agente) y llénalo:
   - `database`: nombre de la base de SICAR.
   - `password`: contraseña de `consultas`.
   - `llave`: la llave de la tienda.
   - `estado`: déjalo como está. Ahí el agente apunta hasta dónde ya mandó.
   - `host` tiene que quedarse en `127.0.0.1`: el agente se niega a conectarse a otra máquina.
3. Protege el archivo: clic derecho en `config.json` → Propiedades → Seguridad. Que solo lo puedan leer el usuario
   que corre la tarea y los administradores. **Nunca** lo mandes por WhatsApp ni lo subas a ningún lado.

## 3. Verificar antes de mandar nada

En una ventana de comandos:

```
C:\UnisoundSICAR\agente-sicar\correr.cmd --verificar
```

Esto se conecta, revisa que existan todas las columnas que usa, y cuenta los clientes y las ventas con nombre.
**No manda nada.** Lee todas las ventas por páginas y tarda varios minutos: córrelo **después del cierre**, no en horario de cobro.

- Debe decir algo cercano a **5,097 clientes** y **10,918 ventas** en Ocosingo.
- `Ventas que se saltarían por datos raros`: cuántas ventas no van a llegar al CRM y las primeras 20 con su motivo.
  Si son muchas, avisa antes de la carga.
- `PRIVILEGIOS_AMPLIOS` es esperado mientras `consultas` tenga permiso FILE (ver sección 6).
- `Falta columna ...` o `FALLO ESQUEMA_INVALIDO columna=...`: avisa a quien mantiene CORPUNISOUND con ese texto.

### Configurar las cancelaciones antiguas (historial)

`--verificar` muestra en pantalla las columnas de la tabla `historial` y las 3 cancelaciones más recientes.
Busca cuál columna trae el número de la venta cancelada (compáralo contra un ticket que sepas que se canceló) y
ponlo en `config.json`:

```
"historial": { "columna_referencia": "NOMBRE_DE_ESA_COLUMNA" }
```

Mientras no esté puesto, todo funciona, pero cada corrida avisa
`cancelaciones antiguas sin vigilar: falta configurar historial`: si alguien cancela hoy un ticket de hace meses,
el CRM no se entera. No se pierde nada: cuando se configure, el agente revisa el historial desde el principio
(por partes, con pausas, a lo largo de varias corridas).

### Carga completa de día (solo si Victor lo autoriza)

Si la tienda está tranquila y Victor lo aprueba, la carga inicial se puede correr a mano a cualquier hora:

```
C:\UnisoundSICAR\agente-sicar\correr.cmd --historico-ahora
```

Solo vale para esa corrida; la tarea programada nunca la usa. Si la caja se alenta, ciérralo con Ctrl+C: retoma
donde se quedó sin duplicar. Repite el comando hasta que el registro deje de mostrar `LOTE_CONFIRMADO` nuevos.

### Lista de artículos (departamento y categoría)

Ya terminada la carga inicial, el agente manda **una vez al día, de noche (20:00-07:00)**, la lista completa de
artículos de SICAR con su departamento y su categoría; el CRM la usa para agrupar lo que compra cada cliente. Va en
lotes aparte, después de las ventas, y si una corrida no la acaba, la siguiente sigue donde se quedó.

- **Viene apagada.** Se prende poniendo `"articulos": true` en `config.json`, y solo después de dos cosas: que el
  servidor de CORPUNISOUND ya tenga esta versión (uno viejo rechaza la lista y el agente se detendría, ventas
  incluidas) y que `--verificar` confirme las columnas.
- `--verificar` muestra qué columnas encontró en `articulo`, `categoria` y `departamento` y cuántos artículos hay.
  Si dice `Artículos APAGADOS, faltan columnas`, el agente sigue mandando clientes y ventas, pero no artículos:
  hay que ajustar `COLUMNAS_ARTICULOS` en `mapeo.js` con los nombres reales.
- La primera vez se puede mandar de día, a mano: `C:\UnisoundSICAR\agente-sicar\correr.cmd --articulos-ahora`.
- Un artículo con datos que el CRM no acepta (sin descripción, texto demasiado largo) se salta y queda
  `ARTICULO_OMITIDO art_id=...` en el registro. No detiene nada.

### Lista de proveedores (Radar de Demanda)

Igual que los artículos, el agente manda **una vez al día, de noche (20:00-07:00)**, la lista de proveedores de SICAR
(solo su número y su nombre). El Radar de Demanda la usa para que el vendedor diga con qué proveedor se consigue lo
que pidió el cliente, y Compras ve lo pendiente agrupado por proveedor. Va en lotes aparte, después de los artículos.
Los proveedores borrados en SICAR (`status` -1) no se mandan. En SICAR la tabla es `proveedor` y su número `pro_id`.

- **Viene apagada.** Se prende poniendo `"proveedores": true` en `config.json`, y solo después de dos cosas: que el
  servidor de CORPUNISOUND ya tenga esta versión (uno viejo rechaza la lista y el agente se detendría, ventas
  incluidas) y que `--verificar` confirme las columnas. Es independiente de `"articulos"`.
- `--verificar` muestra qué columnas encontró en la tabla `proveedor` y cuántos proveedores hay. Si dice
  `Proveedores APAGADOS, faltan columnas`, el agente sigue mandando clientes, ventas y artículos, pero no
  proveedores: hay que ajustar `COLUMNAS_PROVEEDORES` en `mapeo.js` con el nombre real de la tabla, de su número
  y de su nombre.
- La primera vez se puede mandar de día, a mano: `C:\UnisoundSICAR\agente-sicar\correr.cmd --proveedores-ahora`.
- Un proveedor sin nombre o con un nombre de más de 250 letras se salta y queda `PROVEEDOR_OMITIDO prv_id=...` en
  el registro. No detiene nada.

### Existencias

El agente manda cuántas piezas hay de cada artículo **vigente** de SICAR (`articulo.status` = 1 y que no sea servicio,
`articulo.servicio` = 0), para verlas en CORPUNISOUND → Inventario → Existencias SICAR. Solo número de artículo y
existencia, con signo y 4 decimales tal cual las guarda SICAR (una negativa se manda negativa).

- **En cada corrida (cada 5 min), al final**, después de ventas y listas: lee todas las vigentes (~6,400 en Ocosingo,
  unos 10 ms) y las compara con lo último que el servidor **confirmó** (guardado en `estado.json`). Manda solo las que
  cambiaron y, como "sin existencia" (`null`), las que dejaron de ser vigentes (borradas o vueltas servicio): el
  servidor borra esa fila. Si no cambió nada, no manda nada. Si el envío falla, la copia local no cambia y la
  siguiente corrida reenvía lo mismo: no se pierde un cambio. Si ese reenvío también falla (servidor caído, sin
  internet), el paquete de existencias se descarta (`EXISTENCIAS_DESCARTADAS`) para no frenar las ventas, y las
  existencias se vuelven a comparar y mandar cuando el servidor responda. Los artículos de ese paquete se vuelven a
  mandar aunque en SICAR hayan regresado al valor de antes (por si el servidor sí alcanzó a recibirlo).
- **Una vez al día, de noche (20:00-07:00)**, manda todas aunque no hayan cambiado, para que el servidor sepa que
  siguen al día. La primera vez manda todas (~13 paquetes). En una tienda que apaga la PC de noche, si la última
  vuelta completa fue antes de ayer, la manda de día en la primera corrida.
- **Viene apagada.** Se prende poniendo `"existencias": true` en `config.json`, solo después de que el servidor de
  CORPUNISOUND tenga esta versión (uno viejo rechaza la colección y el agente se detendría, ventas incluidas) y de
  que `--verificar` confirme las columnas. Es independiente de `"articulos"` y `"proveedores"`.
- `--verificar` dice `Existencias: N artículos vigentes, lectura en X ms`. Si dice `Existencias APAGADAS, faltan
  columnas`, el agente sigue con todo lo demás pero no manda existencias: hay que ajustar `COLUMNAS_EXISTENCIAS` en
  `mapeo.js`.
- A mano, de día: `C:\UnisoundSICAR\agente-sicar\correr.cmd --existencias-ahora` manda la vuelta completa en ese
  momento (sirve tras restaurar un respaldo en CORPUNISOUND —una vez quitado el alto de `SECUENCIA_RETROCEDIO`— o tras
  borrar `estado.json`).
- Una existencia que el agente no sabe leer (más de 4 decimales, vacía) se salta y queda
  `EXISTENCIA_OMITIDA art_id=...` en el registro. Ese artículo conserva en CORPUNISOUND lo último que se confirmó y, si
  no se vuelve a confirmar, la pantalla lo muestra en gris pasadas 36 horas. No detiene nada.

### Cortes de caja

El agente manda cada corte de caja de SICAR para verlo en CORPUNISOUND con la etiqueta "Cifras según SICAR": caja,
fecha y hora, contado, calculado, diferencia (contado − calculado, tal cual la guardó SICAR: negativa es faltante) y
retiro; las formas de pago que tuvieron algún importe; quién lo **cerró** y, por cada usuario que dio de alta ventas en
ese turno, cuántas ventas y cuánto, y cuántas canceladas y cuánto. Solo números de usuario (`usu_id`): **el agente no
lee la tabla de usuarios ni manda nombres**. Los nombres se asignan en CORPUNISOUND.

- **En cada corrida (cada 5 min), al final**, después de las existencias: lee los cortes nuevos (por número de corte)
  y los manda en paquetes de hasta 100. Lo que ya se mandó lo recuerda `estado.json` (`cortes_cursor`) y solo avanza
  cuando el servidor confirma: si el envío falla, la siguiente corrida reenvía los mismos cortes. Si ese reenvío
  también falla (servidor caído, sin internet), el paquete de cortes se descarta (`CORTES_DESCARTADOS`) **para no
  frenar las ventas**, igual que las existencias. No se pierde ningún corte: como el servidor no confirmó, el cursor
  no avanzó y esos cortes se vuelven a leer y mandar en las siguientes corridas. Un paquete que trae clientes, ventas,
  artículos o proveedores nunca se descarta.
- Cada corrida relee también los últimos 50 números de corte bajo el cursor: si otra caja guardó tarde un corte de
  número menor, sale en la siguiente corrida. Los ya mandados no se repiten (`estado.json` recuerda los 50 más altos,
  `cortes_enviados`, solo cuando el servidor confirma).
- SICAR guarda el corte en varios pasos: primero el corte, luego quién lo cerró (0-22 s) y enseguida el resumen del
  turno (1 s). Por eso **ningún corte se manda antes de 2 minutos** de cerrado (va en la siguiente corrida). Si a un
  corte de menos de 10 minutos todavía le falta quién lo cerró o el resumen, el agente lo espera (y con él los que
  vengan después). Pasados 10 minutos se manda como esté: sin quién lo cerró queda `CORTE_SIN_CAJERO cor_id=...`; sin
  resumen se manda sin ventas por usuario y queda `CORTE_SIN_RESUMEN cor_id=...`. Un número de usuario raro (por
  ejemplo 0) se manda como "sin persona", nunca se le carga a otra.
- Un corte que salió **sin quién lo cerró o sin resumen no queda como resuelto**: mientras siga entre los 50 bajo el
  cursor, cada corrida lo vuelve a leer y lo vuelve a mandar, y en cuanto SICAR ya tiene esos datos sale completo una
  última vez. El servidor lo reescribe por número de corte (no lo duplica) y el cursor no se mueve hacia atrás.
- Si la fecha del corte va más de 10 minutos adelantada respecto al reloj de esta PC (reloj de SICAR mal puesto), no
  se espera: se manda como esté y queda `CORTE_FECHA_FUTURA cor_id=...`, para que no congele los cortes siguientes.
- **Revisar que el reloj de las PCs de SICAR esté bien** (fecha, hora y zona horaria), el de esta PC incluido. Las
  esperas de 2 y 10 minutos se miden comparando la hora que SICAR guardó en el corte con la de esta PC: un reloj
  atrasado hace que un corte a medias (sin quién lo cerró o sin resumen) salga antes de tiempo, y uno adelantado
  hace que los cortes esperen de más.
- **Tras restaurar un respaldo del servidor de CORPUNISOUND**, el agente **primero va a estar detenido** por
  `SECUENCIA_RETROCEDIO` (el servidor perdió paquetes que ya había confirmado) y no manda nada, ventas incluidas, hasta
  que quien mantiene el sistema le quite el alto (campo `detenido` en `estado.json`, ver la sección de errores). Eso va
  antes que lo demás. Luego, para volver a mandar todos los cortes: con la tarea
  pausada, en `estado.json` poner `"cortes_cursor": "0"` y `"cortes_enviados": []`, y volver a prender la tarea. La
  siguiente corrida manda toda la historia de cortes otra vez (el servidor no los duplica). Para las existencias, lo
  equivalente es correr a mano `correr.cmd --existencias-ahora`.
- **Vienen apagados.** Se prenden poniendo `"cortes": true` en `config.json`, solo después de que el servidor de
  CORPUNISOUND tenga esta versión (uno viejo rechaza la colección y el agente se detendría, ventas incluidas) y de que
  `--verificar` confirme las columnas. Es independiente de las demás listas. La primera vez manda todos los cortes de
  la historia de SICAR, 100 por paquete y 6 segundos entre paquetes (Ocosingo va en el corte 8,006: unos 80 paquetes, **estimado**, no medido).
- `--verificar` dice `Cortes en SICAR: N, lectura de ventas de 100 cortes en X ms`. Si dice `Cortes APAGADOS, faltan columnas`, el agente sigue con todo lo
  demás pero no manda cortes: hay que ajustar `COLUMNAS_CORTES` en `mapeo.js`.
- Un corte con un dato que el agente no sabe leer (importe con 3 decimales, fecha imposible) se salta y queda
  `CORTE_OMITIDO cor_id=... codigo=...` en el registro. Ese corte **no se vuelve a intentar**: hay que avisar.
- **Avisos una vez al día**: `EXISTENCIA_OMITIDA`, `EXISTENCIAS_NO_DISPONIBLES`, `CORTE_OMITIDO`, `CORTE_SIN_CAJERO`,
  `CORTE_SIN_RESUMEN` y `CORTE_FECHA_FUTURA` quedan en el registro la primera vez de cada día por artículo o corte (o
  por evento), no en cada corrida. El recuerdo vive en `estado.json` (`avisos_dia`, `avisos`); si se borra o está raro,
  solo se vuelven a anotar los de hoy. Nada se calla: al día siguiente se vuelven a anotar.

### Ventas de mostrador (público en general)

Con `"mostrador": true` el agente manda también las ventas de **público en general**, aparte del CRM, para medir la
tienda completa (tablero Cinco Caminos). De cada venta solo va: número de venta, fecha y hora, vigente o cancelada,
total y, por renglón, número de artículo, cantidad, importe y descuento. **Nunca** cliente, nombre, teléfono,
descripción ni clave del artículo. No llegan al CRM ni a la lista de clientes.

- **Qué cuenta como público**: la venta sin cliente, o con cliente sin nombre, o con uno de los números de público
  (`1, 2, 3, 13, 21, 33, 4566, 4567, 4572`, lista `PUBLICOS` en `formato.js`), o con un nombre que empiece con
  "PÚBLICO EN GENERAL". **Antes de prenderlo en cada tienda, confirmar en su SICAR cuáles son sus números de
  público**: la lista se armó con Ocosingo. Un número de público que falte hace que esas ventas se cuenten como
  cliente en el CRM (como hoy) y no como mostrador; uno de más saca del CRM a un cliente real.
- **En cada corrida**, junto con las ventas: las de público salen en el mismo paquete que las de cliente. La relectura
  de 48 horas y el historial de cancelaciones también mandan su cancelación. Si una venta pasa de público a cliente,
  se manda como venta con cliente y el servidor la quita de mostrador; si pasa de cliente a público, se manda como
  "excluida" del CRM y como mostrador en el mismo paquete. Ninguna venta cuenta dos veces.
- **Carga desde el 1 de enero de 2025, una sola vez**: de noche (20:00-07:00), al final de cada corrida y después de
  todo lo demás, el agente lee las ventas desde la primera de 2025 hasta la última ya mandada y manda solo las de
  público, a lo más 10 páginas (unas 1,000 ventas revisadas) por corrida para no alentar la corrida siguiente. Avanza
  (`mostrador_cursor` en `estado.json`) solo cuando el servidor confirma; si el envío falla, la siguiente corrida
  reenvía lo mismo. Al alcanzar las ventas ya mandadas termina (`mostrador_terminado`) y no vuelve a correr.
  De día se puede adelantar a mano, un tramo por vez: `C:\UnisoundSICAR\agente-sicar\correr.cmd --mostrador-ahora`
  (queda `MOSTRADOR_AUTORIZADO_DE_DIA` en el registro).
- **Viene apagado.** Se prende poniendo `"mostrador": true` en `config.json`, solo después de que el servidor de
  CORPUNISOUND tenga esta versión (uno viejo rechaza el paquete con `HTTP_400` y **el agente se detendría, ventas
  incluidas**) y de revisar `--verificar`. Solo `true` lo prende.
- `--verificar` dice `Ventas de público en general desde 2025: N por número de cliente, desde la venta X` y, al final,
  cuántas son revisando también el nombre, con una línea que explica por qué pueden diferir: la primera solo mira los
  números de público y la fecha; la segunda (la regla del agente) también cuenta al cliente sin nombre y al llamado
  "PÚBLICO EN GENERAL", y va por número de venta (una venta con la fecha de SICAR mal puesta cae distinto). Si las dos
  cifras se alejan mucho, hay clientes llamados "PÚBLICO EN GENERAL" con otro número: avisar para agregarlo a la lista.
- **`estado.json` no crece para siempre**: recuerda qué ventas ya se mandaron (`enviadas`, `mostrador_enviadas`) y
  olvida las fechadas hace más de 90 días que ya quedaron fuera de las 200 que se releen bajo el cursor. Nunca olvida
  una de la relectura de 48 horas, una sin fecha válida, ni nada mientras la carga desde 2025 esté prendida y sin
  terminar. Una venta olvidada que se cancela después todavía sale cancelada si SICAR la tiene completa; solo una
  cancelada con datos raros o una que pasó a público, de hace más de 90 días, ya no saca su aviso corto.
- Si se apaga y se vuelve a prender, las ventas de público del tiempo apagado no se mandan solas: con la tarea
  pausada, en `estado.json` poner `"mostrador_terminado": false` y `"mostrador_cursor": "0"`, y volver a prender la
  tarea (la carga vuelve a pasar desde 2025; el servidor no las duplica).
- Una venta de público con un dato que el agente no sabe leer se salta y queda `VENTA_OMITIDA ven_id=... codigo=...`.

## 4. Programar la tarea

En una ventana de comandos **como administrador** (cambia `USUARIO` por el usuario de Windows de esa PC):

```
schtasks /Create /TN "Unisound SICAR" /SC MINUTE /MO 5 /RU USUARIO /RP * ^
  /TR "C:\UnisoundSICAR\agente-sicar\correr.cmd"
```

Para correrla a mano: `schtasks /Run /TN "Unisound SICAR"`. Para pararla: `schtasks /Change /TN "Unisound SICAR" /DISABLE`.

## 5. Revisar cómo va

Todo queda en **`C:\UnisoundSICAR\agente-sicar.log`**, con fecha y hora (UTC). Lo normal es ver `LOTE_CONFIRMADO`.
En CORPUNISOUND → CRM → SICAR se ven los envíos recibidos.

| Si dice | Qué pasa | Qué hacer |
|---|---|---|
| `LOTE_CONFIRMADO` | Se mandó y se recibió. | Nada. |
| `FUERA_DE_HORARIO` | La carga inicial espera a las 20:00. | Nada. |
| `TOPE_DE_CORRIDA` | Ya mandó 300 paquetes en esta corrida. | Nada: la siguiente sigue donde se quedó. |
| `OTRA_CORRIDA_ACTIVA` | La anterior no ha terminado. | Nada. Si dura más de 6 horas, el agente la da por muerta solo. |
| `RED_NO_DISPONIBLE`, `HTTP_429`, `HTTP_503`, `HTTP_5XX` | Internet o el servidor (por ejemplo, Render reiniciando). | Nada: reenvía lo mismo sin duplicar. Si dura más de un día, avisar. Si `HTTP_503` se repite por más de una hora, apagar `existencias` en `config.json` (`"existencias": false`) para que las ventas salgan sin estorbo, y avisar. |
| `CAMPO_OMITIDO cli_id=… campo=…` | Un teléfono, correo o RFC mal capturado en SICAR. Se mandó el cliente sin ese dato. | Corregirlo en SICAR si importa. |
| `HISTORIAL_SIN_CONFIGURAR` / `cancelaciones antiguas sin vigilar` | Falta la sección 3. | Configurar `historial`. |
| `HTTP_401` | Llave incorrecta o revocada. **El agente se detiene.** | Pedir llave nueva y avisar a quien mantiene el sistema. |
| `HTTP_400`, `HTTP_409`, `HTTP_413`, `HTTP_422` | El servidor rechazó un paquete. **El agente se detiene.** | Avisar con la línea del registro. |
| `SECUENCIA_RETROCEDIO` | El servidor perdió paquetes que ya había confirmado (por ejemplo, se restauró un respaldo). **El agente se detiene** para no dejar huecos. | Avisar: hay que decidir si se reenvía todo. |
| `VENTA_OMITIDA ven_id=… codigo=…` | Una venta de SICAR trae un dato que el agente no sabe leer (importe con 3 decimales, negativo, sin artículos…). **Se salta**, la carga sigue y esa venta no aparece en el CRM (si ya estaba, se quita). | Revisar esa venta en SICAR. `--verificar` dice cuántas hay antes de la carga. |
| `ARTICULO_OMITIDO art_id=… codigo=…` | Un artículo de SICAR sin descripción o con texto muy largo. **Se salta**; sus ventas salen como "Sin departamento". | Revisar ese artículo en SICAR. |
| `ARTICULOS_NO_DISPONIBLES` | No encontró las columnas de artículo, categoría o departamento. Clientes y ventas siguen normales. | Correr `--verificar` y ajustar `COLUMNAS_ARTICULOS`. |
| `PROVEEDOR_OMITIDO prv_id=… codigo=…` | Un proveedor de SICAR sin nombre o con nombre muy largo. **Se salta**; no aparece en la lista del Radar. | Revisar ese proveedor en SICAR. |
| `PROVEEDORES_NO_DISPONIBLES` | No encontró las columnas de la tabla de proveedores. Clientes, ventas y artículos siguen normales. | Correr `--verificar` y ajustar `COLUMNAS_PROVEEDORES`. |
| `EXISTENCIA_OMITIDA art_id=… codigo=…` | Un artículo con una existencia que el agente no sabe leer (por ejemplo, más de 4 decimales). **Se salta**; en CORPUNISOUND queda lo último confirmado. | Revisar ese artículo en SICAR. |
| `EXISTENCIAS_NO_DISPONIBLES` | `"existencias": true` pero no encontró las columnas de existencia. Sale una vez al día. Todo lo demás sigue normal. | Correr `--verificar` y ajustar `COLUMNAS_EXISTENCIAS`, o apagar `"existencias"`. |
| `EXISTENCIAS_DESCARTADAS` | Un paquete de solo existencias (o de existencias y cortes) no se pudo mandar tras sus reintentos (servidor caído o sin internet). Se tiró **para que las ventas sigan saliendo**; no se pierde nada: la siguiente corrida vuelve a comparar y manda lo que falte. | Nada. Si sale en muchas corridas seguidas, ver `HTTP_503`. |
| `CORTES_DESCARTADOS` | Un paquete de solo cortes (o de cortes y existencias) no se pudo mandar tras sus reintentos. Se tiró **para que las ventas sigan saliendo**; no se pierde ningún corte: el cursor no avanzó y se vuelven a mandar en las siguientes corridas. | Nada. Si sale en muchas corridas seguidas, ver `HTTP_503`. |
| `MOSTRADOR_AUTORIZADO_DE_DIA` | Alguien corrió `--mostrador-ahora`: se adelantó de día un tramo de la carga de mostrador desde 2025. | Nada. |
| `EXISTENCIAS_AUTORIZADAS_DE_DIA` | Alguien corrió `--existencias-ahora`: se mandó la vuelta completa de día. | Nada. |
| `CORTE_SIN_CAJERO cor_id=…` | SICAR no anotó quién cerró ese corte (o anotó a dos). Se mandó igual, sin quién lo cerró. | Nada si es raro. Si sale en todos los cortes, avisar. |
| `CORTE_SIN_RESUMEN cor_id=…` | Pasados 10 minutos, SICAR no tenía el resumen de ese corte. Se mandó sin las ventas por usuario. | Revisar ese corte en SICAR; si sale seguido, avisar. |
| `CORTE_FECHA_FUTURA cor_id=…` | La fecha del corte va más de 10 minutos adelantada respecto a esta PC. Se mandó sin esperar. | Revisar la hora de la PC de SICAR y la de esta PC. |
| `CORTE_OMITIDO cor_id=… codigo=…` | Un corte con un dato que el agente no sabe leer. **Se saltó** y no aparece en CORPUNISOUND. | Avisar con la línea del registro. |
| `CORTES_NO_DISPONIBLES` | `"cortes": true` pero no encontró las columnas de cortes. Sale en cada corrida. Todo lo demás sigue normal. | Correr `--verificar` y ajustar `COLUMNAS_CORTES`, o apagar `"cortes"`. |
| `CLIENTE_OMITIDO cli_id=… codigo=…` | Igual, con un cliente (por ejemplo, un nombre de más de 250 letras). | Revisar ese cliente en SICAR. |
| `FALLO ...` | Algo que no es un dato raro (configuración, MySQL, servidor). La corrida termina sin avanzar. | Avisar con la línea completa. |
| `FALLO MYSQL_ACCESO_DENEGADO` / `MYSQL_NO_DISPONIBLE` | Contraseña de MySQL o MySQL apagado. | Revisar `config.json` y que SICAR esté abierto. |

Cuando el agente se detiene por un error, **no vuelve a intentar solo**: así no manda datos malos. Quien mantiene el
sistema revisa, corrige y le quita el alto (campo `detenido` en `estado.json`).

## 6. Seguridad

- El usuario `consultas` **sí puede escribir archivos** en esta PC y MySQL acepta conexiones desde afuera. Así
  estaba antes del agente. Victor decidió usarlo porque SICAR no entrega la contraseña root.
- El agente solo hace consultas de lectura: rechaza cualquier instrucción que escriba, saque archivos o bloquee
  tablas, y abre cada lectura en modo "solo lectura".
- Nunca lee las huellas, muestras ni fotos de los clientes.
- La contraseña y la llave nunca aparecen en el registro.
- Pendiente cuando haya root: crear un usuario de solo lectura y cerrar MySQL a esta misma PC.
