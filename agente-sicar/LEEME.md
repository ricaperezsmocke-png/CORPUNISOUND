# Agente SICAR → CORPUNISOUND

Este programa corre en la PC de la tienda donde está el MySQL de SICAR. Lee los clientes con nombre y sus
ventas **sin escribir nada en SICAR**, y los manda al CRM de CORPUNISOUND. El público en general no se manda.

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
  existencias se vuelven a comparar y mandar cuando el servidor responda.
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
  momento (sirve tras restaurar un respaldo en CORPUNISOUND o tras borrar `estado.json`).
- Una existencia que el agente no sabe leer (más de 4 decimales, vacía) se salta y queda
  `EXISTENCIA_OMITIDA art_id=...` en el registro. Ese artículo conserva en CORPUNISOUND lo último que se confirmó y, si
  no se vuelve a confirmar, la pantalla lo muestra en gris pasadas 36 horas. No detiene nada.

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
| `RED_NO_DISPONIBLE`, `HTTP_429`, `HTTP_503`, `HTTP_5XX` | Internet o el servidor (por ejemplo, Render reiniciando). | Nada: reenvía lo mismo sin duplicar. Si dura más de un día, avisar. |
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
| `EXISTENCIAS_NO_DISPONIBLES` | `"existencias": true` pero no encontró las columnas de existencia. Sale en cada corrida. Todo lo demás sigue normal. | Correr `--verificar` y ajustar `COLUMNAS_EXISTENCIAS`, o apagar `"existencias"`. |
| `EXISTENCIAS_DESCARTADAS` | Un paquete de solo existencias no se pudo mandar tras sus reintentos (servidor caído o sin internet). Se tiró **para que las ventas sigan saliendo**; no se pierde nada: la siguiente corrida vuelve a comparar y manda lo que falte. | Nada. Si sale en muchas corridas seguidas, ver `HTTP_503`. |
| `EXISTENCIAS_AUTORIZADAS_DE_DIA` | Alguien corrió `--existencias-ahora`: se mandó la vuelta completa de día. | Nada. |
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
