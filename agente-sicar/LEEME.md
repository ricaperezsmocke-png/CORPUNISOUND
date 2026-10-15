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
