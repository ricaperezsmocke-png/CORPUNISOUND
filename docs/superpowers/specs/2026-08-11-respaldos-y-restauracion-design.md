# Respaldos y Punto de Restauración — Diseño

**Fecha:** 2026-08-11
**Estado:** Aprobado por Victor (brainstorming), pendiente de plan de implementación.

## Objetivo

Que **nunca se pierda la información del negocio**, pase lo que pase con el servidor.

Victor lo pidió así: *"quiero que nos protejamos para la pérdida de datos, ya nos ha pasado. Si algún día sucede algo, tener copias que nos restauren todo completamente desde el inicio, jamás perder un solo bit de información."*

Los cuatro desastres que marcó como reales:

1. **Se pierde el servidor completo** — Render borra el disco, se cae el servicio, se vence la tarjeta.
2. **Alguien borró o arruinó datos por error** — se cancela lo que no era, se importa un Excel a la tienda equivocada.
3. **Los datos se corrompen sin que nadie note** — un bug escribe basura y pasan días antes de verlo.
4. **Alguien de adentro se lleva o borra información** — robo o sabotaje.

## Punto de partida (verificado en el código, 2026-08-11)

- **Toda la base de datos es UN solo texto JSON** en una sola fila de `datos.sqlite` (tabla `estado`, ver `backend/persistencia.js`). Un respaldo completo es copiar ese texto: es chico y se comprime muchísimo. Esto es lo que vuelve todo el diseño barato.
- **Los comprobantes y expedientes ya viven en Google Drive**, no en el servidor. Ya están fuera de Render y quedan fuera del alcance de este diseño.
- **El catálogo del SAT (~52,500 claves) vive en el mismo archivo** pero en su propia tabla (`claves_sat`), y se vuelve a descargar solo al arrancar. Queda fuera del respaldo a propósito.
- **El sistema no tiene ningún proceso automático hoy** — no hay un solo `setInterval` ni cron en `backend/`. Este es el primero, y ese hecho manda en el diseño del reloj.
- Existe `backend/fechas.js` con `fechaLocal()` y `ahora()` para la hora de Chiapas (`America/Mexico_City`). Se usa aquí.
- Existe `backend/intentosLogin.js` con el bloqueo por intentos fallidos. Se reutiliza para la clave de restauración.
- Sentry está integrado y funcionando (`backend/instrument.js`). Es el canal de aviso cuando un respaldo falla.
- El plan de Render es **Starter con disco de 1 GB en `/data`**: el servicio **no se duerme**, así que un reloj dentro del proceso corre 24/7.

## Decisiones (confirmadas con Victor)

1. **Copias cada hora**, no una al día. El peor caso aceptado es perder **una hora** de ventas, no un día de las 5 tiendas.
2. **El reloj vive dentro del backend** (enfoque A de los tres evaluados). Costo $0. Se descartó un Render Cron Job aparte porque cuesta $7/mes y duplica configuración; se descartó que el reloj viviera en la PC de Victor porque solo respaldaría con la máquina prendida.
3. **El respaldo lo hace el servidor solo**, sin usuario conectado, sin sesión iniciada y sin la PC de Victor prendida. Palabras de Victor: *"sin importar usuario ni nada"*.
4. **Puntos de restauración del día a las 4:00 pm y 5:00 pm** (hora de Chiapas), las horas que pidió Victor.
5. **Los respaldos se cifran.** Quien entre al Google Drive encuentra un archivo ilegible. La llave vive en Render, como `JWT_SECRET`, **y Victor la anota en papel y en su gestor de contraseñas** — dos lugares físicos distintos.
   - Razonamiento que llevó a esto: quien tenga acceso al panel de Render **ya tiene la base de datos viva**, así que cifrar contra esa persona no protege nada. La amenaza real contra la que sirve el cifrado es que alguien entre a la **cuenta de Google Drive** (teléfono con sesión abierta, contraseña filtrada). Poner la llave en Render defiende completamente ese escenario sin el riesgo de que los respaldos se vuelvan un ladrillo.
6. **Retención de 30 días en rueda**, sobreescribiendo lo más viejo. Victor escoge **uno de esos 30 días** y el sistema vuelve a como estaba ese día. Además, para **los últimos 7 días** puede afinar por hora.
7. **Hay un botón de restaurar dentro del sistema.** Victor lo eligió a sabiendas de que no cubre el caso "murió el servidor".
8. **Restaurar exige una clave que solo Victor tiene**, aparte del permiso. La clave **no vive dentro del sistema**: es una variable de entorno de Render.
9. **La copia local en la PC de Victor corre una vez al día a hora fija.** Mejora incluida sobre lo que eligió: si la máquina estuvo apagada varios días, la tarea se baja también las diarias que le faltaron, no solo la del día.

## Fuera de alcance (decidido explícitamente)

- **Respaldo de la aplicación** (llaves/variables de entorno + instructivo de levantar todo en un servidor nuevo). Victor eligió *"solo los datos ahora, la app después"*. **Queda como pendiente con su propio diseño.** Ver "Hueco conocido que este diseño NO cierra" al final.
- **Segunda cuenta de Google para respaldos verdaderamente imborrables.** Victor: *"la agregaremos después"*.
- **Bitácora de cambios continua** (respaldar cada venta en el momento, el único "ni un bit" literal). Se evaluó y se descartó por complejidad; se puede construir después encima de esto.
- **Respaldo de los archivos de Drive** (comprobantes, expedientes). Ya están fuera del servidor.

---

## Arquitectura

### Módulo nuevo: `backend/respaldos.js`

Sigue el patrón de `gastos.js` y `garantias.js`: funciones planas que reciben `DB`, sin estado global escondido, con el guard de seguridad **dentro del módulo** y no en la capa de rutas (la lección de Apartados vs. Garantías).

Piezas separadas, cada una probable por su cuenta:

| Pieza | Responsabilidad única |
|---|---|
| `armarFoto(DB)` | Arma el objeto que se va a respaldar (datos + etiqueta de identidad). No sabe de cifrado ni de Drive. |
| `cifrar(texto, llave)` / `descifrar(bin, llave)` | AES-256-GCM. No saben de respaldos ni de Drive. |
| `crearRespaldo(DB, drive, opciones)` | Orquesta: foto → comprimir → cifrar → verificar → subir → registrar. |
| `debeRespaldar(DB, ahora)` | **Función pura**: dado el registro y la hora, responde si toca respaldar y de qué tipo. El corazón del reloj, probable sin tocar red ni disco. |
| `limpiarViejos(DB, drive, ahora)` | Aplica la retención de 30 días / 7 días por hora. |
| `restaurar(DB, drive, respaldoId, claveDada, usuario)` | La operación destructiva, con sus cuatro candados. |
| `verificarRespaldo(DB, drive, respaldoId)` | Baja de Drive, descifra, cuenta registros. |

### El reloj: confía en el registro, no en el reloj

**Esta es la pieza que vuelve confiable todo lo demás.** No se programa "a las 3:00 en punto". El backend se pregunta cada 5 minutos una sola cosa:

> ¿Cuánto hace que no respaldo?

Si pasó más de una hora, respalda. Consecuencias buscadas:

- Un **reinicio o redespliegue** a media tarde no deja un hueco: al volver, el proceso se da cuenta de que va atrasado y se pone al corriente solo.
- Un servidor **ocupado** que se salta el minuto exacto no pierde el ciclo.
- **No hace dos respaldos de la misma hora** aunque el proceso reinicie tres veces seguidas (el registro dice que esa hora ya está cubierta).

El estado del reloj (`DB.respaldos.ultimo_exitoso`, `ultimo_intento`) **se persiste con el resto de la base**, así que sobrevive al reinicio. `debeRespaldar` es una función pura que recibe ese estado y la hora: se prueba sin levantar nada.

### Modelo de datos

#### Colección nueva: `DB.respaldos`

```
DB.respaldos = {
  copias: [],            // el índice de lo que existe en Drive
  movimientos: [],       // bitácora: creado / verificado / fallido / restaurado / borrado
  ultimo_id: 0,          // contador SÍNCRONO (ver "carrera de folio")
  ultimo_exitoso: null,  // ISO UTC del último respaldo que sí subió
  ultimo_intento: null,  // ISO UTC del último intento, haya salido o no
  carpeta_drive_id: null // id de la carpeta "Respaldos del Sistema"
}
```

**Registro de copia:**

| Campo | Tipo | Nota |
|---|---|---|
| `id` | number | del contador síncrono |
| `tipo` | `"hora"` \| `"dia"` \| `"pre_restauracion"` | manda en la retención |
| `fecha` | string `YYYY-MM-DD` | **fecha local de la tienda** (`fechaLocal()`) |
| `fecha_hora` | string ISO UTC | instante real (`ahora()`) |
| `hora_local` | string `HH:MM` | para mostrar en la pantalla sin recalcular |
| `drive_file_id` | string | dónde vive en Drive |
| `nombre_archivo` | string | `unisound-2026-08-11-1600.respaldo` |
| `bytes` | number | tamaño del archivo cifrado |
| `conteos` | objeto | `{ ventas, productos, clientes, gastos, garantias, apartados, depositos, usuarios }` |
| `hash` | string | SHA-256 del contenido sin cifrar, para detectar corrupción |
| `verificado_en` | string ISO \| null | cuándo se comprobó bajándolo de Drive |
| `estado` | `"ok"` \| `"fallido"` | |

> **Carrera de folio — lección ya aprendida en este repo.** El `id` y el nombre del archivo se reservan **de forma síncrona, antes de cualquier `await`**, con `DB.respaldos.ultimo_id`. En el módulo de Gastos, reservar el folio antes del `await` de Drive pero hacer el `push` después provocó que dos capturas concurrentes recibieran el mismo folio (bug CRITICAL, commit de la revisión final de rama). Aquí el riesgo es menor pero la regla es la misma y no se negocia.

### El archivo de respaldo

Orden de operaciones: **armar → comprimir → cifrar → subir**. Comprimir antes de cifrar, porque lo cifrado ya no se comprime.

```
unisound-2026-08-11-1600.respaldo
```

La fecha y hora van **en claro en el nombre a propósito**: Victor debe poder abrir la carpeta de Drive y confirmar de un vistazo que hay una copia de cada hora, sin descifrar nada. El contenido es ilegible sin la llave.

Dentro, además del JSON completo de la base, va una **etiqueta de identidad**:

```
{
  version_formato: 1,
  generado_en: "2026-08-11T22:00:04.001Z",
  fecha_local: "2026-08-11",
  tipo: "dia",
  conteos: { ventas: 4213, productos: 6229, clientes: 1935, ... },
  hash: "sha256:...",
  datos: { ...toda la base... }
}
```

Sirve para dos cosas concretas: **detectar un archivo corrompido antes de usarlo**, y **mostrar qué se va a restaurar sin tener que abrirlo**.

`version_formato` existe para que un respaldo viejo se pueda leer cuando el formato cambie. Hoy solo hay versión 1; restaurar un archivo con una versión que el sistema no conoce **se rechaza con un mensaje claro**, nunca se intenta a medias.

### Cifrado

- **AES-256-GCM** del módulo `crypto` de Node. Sin dependencias nuevas.
- GCM y no CBC **porque autentica**: si el archivo fue alterado o está corrupto, el descifrado **falla** en vez de devolver basura silenciosa. Ese es justo el desastre #3.
- Llave en la variable de entorno **`RESPALDO_LLAVE`** (32 bytes en hexadecimal). Se genera una vez con `crypto.randomBytes(32).toString("hex")`.
- **Un IV aleatorio nuevo por archivo**, guardado al principio del archivo junto al tag de autenticación.
- **Si `RESPALDO_LLAVE` no está configurada, el sistema NO respalda** y lo grita en el arranque y en la pantalla. Falla ruidoso, no en silencio: el peor final posible es creer que hay respaldos y que no los haya. (Mismo espíritu que el aviso de `DB_PATH` en `persistencia.js`.)

### Dónde queda

- **Drive:** carpeta nueva `Respaldos del Sistema` en la raíz, aparte de los comprobantes. Se crea con el mismo patrón `asegurarCarpeta*` que ya usa `drive.js`, y su id se guarda en `DB.respaldos.carpeta_drive_id`.
- **PC de Victor:** carpeta que él elija. La llena una **tarea programada de Windows** a hora fija, con el mismo patrón que la tarea `CORPUNISOUND-Graphify-Daily` que ya existe. Si la máquina estuvo apagada, Windows corre la tarea al prender **y el script se baja todas las diarias que le falten**, no solo la del día.

### Retención

| Tipo | Cuánto vive | Para qué |
|---|---|---|
| **Por hora** | 7 días | "Regrésame al martes a las 3 pm" |
| **Del día** (4pm y 5pm) | **30 días, en rueda** | La lista de la que Victor escoge |
| **Pre-restauración** | 30 días | Deshacer una restauración equivocada |

Al pasar los 30 días se sobreescribe lo más viejo. Total: ~230 archivos (60 puntos del día + ~168 por hora) de pocos MB cada uno. Cabe de sobra en los 15 GB gratis de Google.

La limpieza **nunca borra el respaldo más reciente**, aunque las reglas de retención lo indiquen. Es la última red: mejor un archivo de más que quedarse sin ninguno por un error de fechas.

---

## El botón de restaurar

### Módulo y permisos

Módulo nuevo **`respaldos`** — el décimo del sistema. Se registra en **dos** lugares distintos: `MODULOS_SISTEMA` en `backend/permisosCatalogo.js` y `MODULOS_QUE_REQUIEREN_PERMISOS` en `backend/validarPermisos.js`. Si falta cualquiera de los dos, el guardia de arranque `validarSistemaDePermisos()` (llamado en `backend/server.js`) tumba el backend — regla ya aprendida con el módulo de ML.

Dos permisos **propios**, nunca prestados de otro módulo:

- **`ver_respaldos`** — la pantalla de vigilancia.
- **`restaurar_respaldo`** — el botón rojo.

`reconciliarRoles()` se los da **solo al rol Administrador** en el arranque, como hace con todos los permisos nuevos. A ningún otro rol, nunca, automáticamente.

La ruta de restaurar lleva además **`requiereAlcanceGlobal`** (el guard que ya existe desde el merge `de38cba`): restaurar afecta a las 5 tiendas, así que un usuario amarrado a una sucursal no puede dispararlo aunque alguien le diera el permiso por error.

### Los cuatro candados

**1. La clave de restauración, que solo tiene Victor.**

Variable de entorno **`CLAVE_RESTAURACION`** en el panel de Render. Se compara con la que se teclea en la pantalla.

Vive fuera del sistema por tres razones, todas concretas:

- **Sobrevive a una restauración.** Si viviera en la base de datos, restaurar una foto vieja devolvería la clave vieja y Victor podría quedar fuera de su propio botón sin entender por qué.
- **Nadie la cambia desde adentro.** Ni un administrador, ni un bug, ni un agente.
- **Si se olvida, Victor mismo la cambia** entrando a Render, sin depender de nadie.

Detalles que no se negocian:

- **Si `CLAVE_RESTAURACION` no está configurada, restaurar está apagado por completo** — la ruta responde que no está habilitada y el botón no se dibuja. **Falla cerrado:** mientras Victor no la ponga a propósito, nadie puede restaurar nada.
- La comparación es **de tiempo constante** (`crypto.timingSafeEqual`), no `===`.
- **Bloqueo tras 5 intentos fallidos, 15 minutos.** `backend/intentosLogin.js` ya expone `crearRegistroIntentos()`, una **fábrica** que devuelve un registro independiente: se crea uno propio para restaurar, separado del que cuida el login. Así un ataque contra el botón de restaurar no bloquea a nadie de su sesión, y al revés. La clave no se adivina a fuerza de intentos.
- La clave **nunca** se escribe en la bitácora, en un log, ni en Sentry.

**2. Se dice exactamente qué se va a perder, antes.**

No un "¿estás seguro?" genérico. La pantalla compara la foto contra el estado actual y lo dice en español:

> Vas a volver al estado del **11 de agosto, 4:00 pm**.
> Se perderán **23 ventas**, **4 cortes de caja**, **2 gastos** y **1 depósito** capturados después de esa hora.

Sale de restar los `conteos` de la foto contra los conteos actuales. Es una **estimación por conteo, no un listado** — se dice así en la pantalla para no prometer precisión que no da.

**3. El sistema se respalda a sí mismo antes de restaurar.**

Automáticamente, sin preguntar, se crea una copia `pre_restauracion` del estado actual. **Este es el candado más importante:** vuelve reversible el peor error posible. Si Victor restaura el día equivocado, se restaura de vuelta y no se perdió nada.

**Si ese respaldo previo falla, la restauración se cancela.** No se toca un solo dato sin la red puesta.

**4. Hay que escribir la palabra.**

Teclear `RESTAURAR` para que el botón se active. Nadie lo aprieta por accidente ni "a ver qué hace".

Y queda **escrito en bitácora quién, cuándo y qué respaldo** se aplicó, para siempre.

### Cómo se aplica la restauración

Se descifra, se valida (`version_formato`, hash, que las colecciones esperadas existan) y **solo entonces** se reemplaza el contenido de `DB` colección por colección, y se persiste.

**Se valida TODO antes de mutar NADA** — el mismo principio que salvó a la migración de SICAR de dejar datos a medias. Un archivo que no pasa la validación se rechaza entero con un mensaje claro; nunca se restaura a medias.

**`DB.respaldos` NO se restaura.** Se conserva el índice actual, porque restaurar el índice viejo borraría de la vista los respaldos hechos después de esa foto — incluido el `pre_restauracion` que acaba de salvarle la vida a Victor.

**Advertencia visible en la pantalla:** al restaurar, **todos los usuarios conectados tienen que volver a entrar**, porque los usuarios y roles se reemplazan. Si hay cajeras vendiendo en ese momento, se les corta la venta. Restaurar es para cuando el sistema ya está parado, no a media tarde de un sábado.

---

## La pantalla de vigilancia

Es lo que Victor ve el 99% de los días. Tile propio en el Dashboard, ícono `DatabaseBackup`.

**Arriba, un semáforo grande:**

- 🟢 **"Último respaldo hace 23 minutos"**
- 🔴 **"Sin respaldar desde hace 4 horas"**

**Esa alerta es la mitad del valor del sistema.** Un respaldo silenciosamente roto es peor que no tener respaldos, porque genera una confianza falsa.

**Abajo, dos listas:** los 30 días (la principal) y, para los últimos 7 días, las copias por hora. Cada renglón: fecha, hora, tamaño, cuántas ventas/productos/clientes tenía, y si está verificado.

**Nadie puede borrar un respaldo desde la pantalla.** La única forma de que un respaldo desaparezca es que la retención lo rote.

---

## Verificación: un respaldo que nunca se probó no es un respaldo

Dos niveles:

1. **En cada respaldo (barato):** se descifra lo que se acaba de cifrar y se comprueba que salga idéntico al original. **Un archivo que no pasa esto no se sube.**
2. **Una vez al día (la que de verdad cuenta):** se **baja un respaldo de Drive**, se descifra y se cuentan los registros contra lo que dice su etiqueta. Es la única forma de saber que lo que está guardado en Drive sirve. Se marca `verificado_en` y se ve en la pantalla.

---

## Manejo de errores

| Qué falla | Qué pasa |
|---|---|
| Drive no responde | Reintenta con espera creciente. Si vuelve a fallar, se marca `fallido` y **se sigue con el ciclo siguiente** — nunca se deja de intentar. |
| Falla varias veces seguidas | Se reporta a **Sentry** (ya funcionando) → le llega correo a Victor. Y la pantalla se pone roja. |
| `RESPALDO_LLAVE` sin configurar | No respalda. Lo grita en el arranque y en la pantalla. |
| Token de Drive muerto | Mismo mensaje que ya usa el sistema, y la pantalla en rojo con el aviso de reconectar. |
| Archivo corrupto al restaurar | El descifrado GCM falla → se rechaza entero, con mensaje claro. Nunca se restaura a medias. |
| El respaldo previo a restaurar falla | **Se cancela la restauración.** |

**Un respaldo que falla nunca tumba el backend ni interrumpe una venta.** Corre aparte y sus errores se atrapan: la tienda siempre puede seguir vendiendo.

---

## Pruebas

Suite nueva junto a las 559 que ya corren. Lo que se prueba, y por qué cada una gana su lugar:

**Cifrado**
- Cifrar y descifrar devuelve exactamente el mismo objeto, sin perder un dato.
- Con la llave equivocada **falla** — no devuelve basura silenciosa.
- Un archivo alterado un byte **falla** (es lo que GCM compra).

**El reloj (`debeRespaldar`, función pura)**
- Sin respaldos previos, respalda.
- A los 30 minutos del último, no respalda.
- A los 61 minutos, sí.
- Tras "reiniciar" tres veces en el mismo minuto, **no** hace tres respaldos de la misma hora.
- A las 4 pm y 5 pm hora de Chiapas marca la copia como `dia`, y no lo hace a las 4 pm UTC (la trampa de zona horaria que este repo ya pagó una vez).

**Retención**
- Borra lo viejo y **nunca** borra el punto del día dentro de los 30.
- **Nunca borra el respaldo más reciente**, aunque las reglas lo indicaran.
- Las copias por hora de hace 8 días se van; las del día de hace 8 días se quedan.

**Restauración**
- Restaurar deja la base exactamente igual a la foto.
- El respaldo `pre_restauracion` se crea **ANTES** de tocar nada — verificado por mutación: si falla, la base queda intacta.
- `DB.respaldos` **no** se pisa con el índice viejo.
- Un archivo con `version_formato` desconocida se rechaza con mensaje claro.
- Un archivo al que le falta una colección se rechaza **entero**, sin mutación parcial.

**Seguridad**
- Sin `restaurar_respaldo` → 403.
- Con el permiso pero **sin la clave correcta** → falla, y no muta nada.
- Sin `CLAVE_RESTAURACION` configurada → restaurar está apagado.
- Al 6º intento fallido → bloqueado 15 minutos.
- Un usuario amarrado a una sucursal no puede restaurar (`requiereAlcanceGlobal`).
- La clave no aparece en la bitácora ni en ningún mensaje de error.

**Verificación por mutación en las tres pruebas críticas** (el respaldo previo, el guard de permiso, el guard de clave): quitar la protección debe poner la prueba en rojo. Una prueba que pasa con y sin la protección no está probando nada — la lección de `POST /api/ventas`, donde el status seguía siendo 400 y solo el mensaje delataba la diferencia.

## Cómo se construye

Con **subagent-driven-development**: implementador y revisor independiente por tarea, más la **revisión final de toda la rama**. Es el proceso que en la migración de SICAR, en Gastos y en Estado de Cuenta encontró bugs reales antes de que Victor los viera — incluido el bug CRITICAL de la carrera de folio, que ninguna revisión por tarea podía atrapar.

## Hueco conocido que este diseño NO cierra

**Las llaves del sistema no están respaldadas en ningún lado.** Trece variables de entorno viven **únicamente en el panel de Render**: `JWT_SECRET`, `GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI`, `ML_CLIENT_ID/SECRET/REDIRECT_URI`, `ANTHROPIC_API_KEY`, `SENTRY_DSN`, `DB_PATH`, `FRONTEND_URL`, `PORT`, `NODE_ENV`. Y ahora se suman `RESPALDO_LLAVE` y `CLAVE_RESTAURACION`.

Ninguna es irrecuperable por separado, pero **recuperarlas todas en medio de una crisis son horas de buscar en cinco paneles distintos con las tiendas paradas**.

El código de la aplicación **sí** está respaldado: vive completo en GitHub (`ricaperezsmocke-png/CORPUNISOUND`).

Victor eligió *"solo los datos ahora, la app después"*. Este hueco necesita su propio diseño, y con él un **instructivo escrito de cómo levantar CORPUNISOUND desde cero en un servidor nuevo**, que termine justo en apretar el botón de restaurar que define este documento. Sin ese instructivo, el escenario que Victor marcó primero — "se pierde el servidor completo" — sigue descubierto.
