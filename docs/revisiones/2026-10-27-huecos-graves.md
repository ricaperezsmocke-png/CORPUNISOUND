# Revisión independiente — `fix/huecos-graves-2026-10`

**Veredicto: APROBABLE CON UN ARREGLO.** Los seis huecos originales quedaron cerrados de verdad, y no se rompió nada
de lo que antes funcionaba. Antes de mergear conviene cerrar un camino nuevo (R1): con una cuenta títere, una persona
se autoriza su propio monedero. Ese camino hoy no está abierto, porque solo el Administrador da de alta personal.

Rama revisada: `origin/fix/huecos-graves-2026-10` en `8d4dc54` (9 commits sobre `master` `45e8f9c`). Revisor
independiente: no escribí este código y no lo arreglé. Pruebas de esta revisión:
`docs/revisiones/2026-10-27-huecos-graves/` (fuera de la suite).

## En corto, para Victor

- **Lo que se pidió está cerrado.** Corrí contra esta rama las pruebas con las que la auditoría demostró cada hueco. Las
  seis fallan ahora, que es lo correcto: nadie de fuera puede cambiar la cuenta de Drive ni la de MercadoLibre, una
  cajera ya no gasta el monedero de cualquier cliente, la venta guarda quién la cobró, con "Dar de alta personal" ya no
  se crea un Administrador, el campo de contraseña del autorizador tiene freno, y los intentos SICAR anónimos ya no
  llenan el disco.
- **Con el monedero, si algo falla el saldo del cliente no se mueve.** Probé diez maneras de que la venta salga mal
  (sin permiso, cliente de otra tienda, sin autorizador, contraseña mala, autorizarse a sí misma escribiendo su usuario
  en mayúsculas, autorizador de otra tienda, caja o línea inválidas después de autorizar). En ninguna bajó el saldo y en
  ninguna se creó la venta. El corte sigue cobrando el total menos el monedero, así que no le inventa faltante a la
  cajera.
- **Lo que hay que arreglar antes de mergear (R1):** el día que le dé "Dar de alta personal" a un gerente que también
  puede autorizar monedero, ese gerente puede crear una cuenta "de mentira" con su mismo rol. Con esa cuenta se autoriza
  a sí mismo el monedero o una cancelación, y la regla de "otra persona autoriza" deja de valer. La cuenta de mentira sí
  queda firmada con quién la creó, así que se puede rastrear. El arreglo es corto: que el sistema no acepte como
  autorizador a alguien que dio de alta la misma persona que pide la autorización.
- **Tres detalles menores** (R2, R3 y R4, abajo): ninguno mueve dinero. Se pueden dejar para después.
- **Lo que sigue pendiente:** la prueba en navegador, que en esta revisión no pude hacer (en la nube no hay Chrome). Y
  después del merge tiene que darle a mano los permisos "Aplicar monedero" y "Autorizar uso de monedero". Hasta que lo
  haga, solo el Administrador puede cobrar con monedero.

## Hallazgos, de más a menos grave

Convención de mis pruebas: las marcadas **DEFECTO** pasan mientras el defecto existe (igual que las reproducciones de
la auditoría). Las marcadas **CONTROL** pasan si el arreglo se porta bien.

### R1. Una cuenta títere rompe la regla de "otra persona autoriza" — MEDIA — REPRODUCIDO

- **Quién:** cualquiera sin alcance global que tenga `dar_alta_personal` y a la vez `autorizar_monedero` (o
  `autorizar_cancelaciones`). Por ejemplo, un gerente al que Victor le da altas para que registre a sus cajeras, que es
  el escenario que la auditoría A1 llamó probable. **Hoy no está abierto:** solo el Administrador trae
  `dar_alta_personal` (`backend/roles.js`). Es una escalada por configuración, igual que el A1 original.
- **Qué hace:** da de alta en su tienda una cuenta con **su mismo rol**. La regla nueva solo exige que el rol "no dé más
  de lo que uno tiene" (`backend/server.js:1517` y `1538-1540`), y un rol idéntico cumple eso. Con esa cuenta teclea
  usuario y contraseña en "quien autoriza" y gasta el monedero de un cliente de su tienda, o cancela una venta. Con un
  rol global pasa lo mismo, en cualquier tienda.
- **Cuánto:** el saldo de monedero de los clientes de su tienda, y cualquier venta suya que quiera cancelar (devolución
  de efectivo).
- **Qué queda registrado:** la venta dice quién cobró (él) y quién autorizó (la títere), y la títere guarda
  `creado_por_id` igual a él. Se puede rastrear, pero nada lo impide.
- **Dónde:** `backend/autorizador.js:93-97` solo compara que el autorizador no sea **la misma cuenta** que pide.
- **Prueba:** `huecos.revision.js` → "DEFECTO R1". Pasa: alta 200, venta 200, saldo de $500 a $450,
  `monedero_autorizado_por_nombre: "Titere"`, `creado_por_id: 60`.
- **Cómo se cierra:** en `verificarAutorizador`, rechazar también (sin contar como adivinanza) cuando
  `Number(autorizador.creado_por_id) === Number(solicitante.id)`. Con eso se cierra para cancelaciones y monedero a la
  vez. Las cuentas viejas tienen `creado_por_id` vacío y no se afectan. Como refuerzo, en el alta sin alcance global se
  puede excluir `autorizar_monedero` y `autorizar_cancelaciones` de lo que se puede conceder, igual que ya se excluyen
  `ver_todas_las_sucursales` y `administrar_roles`.

### R2. Desviación 1: no contar los rechazos con contraseña correcta deja un oráculo lento — BAJA — REPRODUCIDO

- **Respuesta a la pregunta 5:** sí abre un oráculo, pero no supera el freno. La respuesta es siempre el mismo 403.
  Pero si la contraseña adivinada es correcta y la cuenta no tiene el permiso (una cajera cualquiera), el intento no
  cuenta (`backend/autorizador.js:93`). Si es incorrecta, sí cuenta. Al quinto fallo el freno bloquea, y un intento
  bloqueado responde **sin correr bcrypt** (`autorizador.js:85`). Así, el tiempo de la respuesta siguiente dice si la
  adivinanza fue buena.
- **Medido:** la mediana de esa respuesta fue de 184 ms después de un acierto y de 111 ms después de un fallo
  (`huecos.revision.js` → "DEFECTO R5").
- **Cuánto vale:** permite probar la contraseña de **cualquier** cuenta, aunque no autorice nada, a unas 5 adivinanzas
  cada 15 minutos por cuenta. Eso se suma a las 5 del login, y estas no quedan registradas en ningún lado. No es fuerza
  bruta, pero sí es un segundo canal sin rastro.
- **Cómo se cierra:** correr siempre `verificarPassword` contra un hash ficticio cuando la cuenta no existe o está
  bloqueada, para que todas las respuestas tarden lo mismo. Eso también cierra R3. No hace falta tocar
  `dineroH4Rutas.test.js`.

### R3. Saber si una cuenta existe midiendo el tiempo de respuesta — BAJA — REPRODUCIDO (anterior a la rama)

- Con un usuario que no existe, el autorizador responde sin bcrypt (`autorizador.js:88`). La mediana fue de 105 ms
  contra 183 ms con un usuario que sí existe ("DEFECTO R6"). Ya pasaba en la cancelación de `master`. La rama lo extiende
  a la ruta del monedero. Se cierra con lo mismo que R2.

### R4. La retención SICAR deja que un desconocido borre el historial real de una tienda — BAJA — REPRODUCIDO

- **Quién:** cualquiera que conozca el `key_id` de una tienda. Es la mitad pública de la llave: el hallazgo A2 de la
  auditoría SICAR, que la entrega reconoce como abierto.
- **Qué pasa ahora:** un envío con `key_id` real y secreto falso sigue escribiendo fila a nombre de esa tienda, porque
  la regla de no escribir fila solo aplica cuando no hay llave (`backend/sicarRutas.js:58`, con la llave buscada en
  `:90` antes de autenticar). Lo nuevo es el tope de 5,000 filas por tienda (`backend/sicarRepositorio.js:555`): cada
  intento falso ya **borra el intento real más viejo** de esa tienda. Con unas 5,000 peticiones, "Envíos SICAR" de esa
  tienda queda lleno de rechazos falsos y sin un solo registro real del agente.
- **Límite:** el freno deja 12 por minuto por origen, así que son horas de envíos. No toca ventas ni dinero, solo el
  diagnóstico. El disco ya no se llena: eso sí quedó cerrado.
- **Prueba:** `sicar.revision.js` → "DEFECTO S1".
- **Cómo se cierra:** no escribir fila en ningún 401 (`sinFila = status === 429 || status === 401`). O escribirla sin
  `sucursal_id` ni `key_id`, y entonces la cuenta el tope de las filas sin tienda. Las dos opciones cierran también A2.

### Observaciones (sin gravedad)

- El freno del autorizador lo puede usar alguien a propósito para bloquear a un autorizador (por ejemplo a Victor)
  15 minutos, en cancelaciones y monedero a la vez. Es una decisión aceptada en la desviación 2 y es igual que en el
  login. Lo menciono porque ahora un bloqueo frena dos operaciones de caja.
- Después de restaurar un respaldo SICAR, las tablas se reconstruyen sin índices hasta el siguiente arranque
  (`sicarRespaldo.js:293`). Ya pasaba con `sicar_intentos_hora`. Con el índice nuevo, el conteo por inserción recorre
  la tabla, que tiene tope, así que no pesa.
- `cobrada_por_nombre` sale del nombre que trae la sesión. Si a alguien le cambian el nombre, sus ventas de esa sesión
  quedan con el nombre viejo. El id es el dato fiable.

## Reproducciones originales contra esta rama

| Hallazgo | Prueba original | Resultado en esta rama | Por qué falla (la afirmación del hueco) |
|---|---|---|---|
| Permisos A1 | `H1` | **falla** ✔ | alta con rol 1: esperaba 200, recibió **403** |
| Permisos A2 (Drive) | `H2` | **falla** ✔ | el callback redirige a `?drive=error&msg=estado_invalido` y no toca la cuenta |
| Permisos A2 (ML) | `H2b` | **falla** ✔ | la cuenta de ML sigue siendo la del negocio (`111`, no la del intruso `999`) |
| Permisos C1 y A3 | `H3` | **falla** ✔ | monedero de cliente de Yajalón desde Ocosingo: esperaba 200, recibió **403** |
| Permisos M1 | `H4` | **falla** ✔ | tras 8 fallos, la contraseña buena recibe **403** (bloqueado), no 400 |
| SICAR A1 | `sicarIntentos.auditoria.js` A1 | **pasa** ✔ (escrita al revés: pasa cuando se cierra) | 40 anónimas: 0 filas nuevas |

Comando: `cd backend && node --test ../docs/auditorias/2026-10-permisos/reproducciones.test.cjs` (5 fallan, las 8 de
hallazgos que esta rama no toca siguen pasando, como debe ser) y
`node --preserve-symlinks --preserve-symlinks-main --test auditoria/sicarIntentos.auditoria.js` (A1 pasa; A2 sigue
fallando porque no está en el alcance). Revisé que cada falla fuera por la afirmación del hueco y no por un error de la
prueba. B1 y D1 de SICAR siguen abiertos, fuera de alcance.

## Suite, eslint y largo de líneas

- `cd backend && node --test`: **3489 pruebas, 3482 pasan, 5 fallan, 2 todo.** Las 5 son exactamente las ambientales
  conocidas: "ARRANQUE REAL: en desarrollo SÍ se tolera" y 4 de `buscarClavesSat`/`contarClavesSat`. Coincide con lo
  que dice la entrega.
- `npx eslint src backend`: **0 errores**, 842 warnings (uno menos que `master`).
- No hay ninguna línea nueva de más de 200 caracteres en `src/` ni en `backend/`.
- Mis pruebas: `huecos.revision.js` 8/8 y `sicar.revision.js` 3/3, en el sentido descrito arriba.

## Lo revisado que está bien

Respuesta a cada pregunta, con evidencia:

1. **Caminos alternos.**
   - `crearVenta` tiene un solo llamador (`server.js:2107`).
   - Ninguna otra ruta baja `cliente.monedero`: solo lo sube la cancelación de apartados.
   - La importación de ML no usa monedero.
   - Crear roles (`POST`) ya pide alcance global, igual que editar y clonar.
   - Editar y borrar usuarios ya pedían alcance global.
   - No hay ruta para cambiarse el rol propio.
   - Los únicos callbacks OAuth son los de Drive y ML.
   - La única escritura de `sicar_intentos` es `registrarIntento`.
2. **Monedero.**
   - Todo se verifica antes de `crearVenta`, y `crearVenta` valida la caja antes de tocar el saldo. Entre el
     descuento del saldo y el `push` de la venta no hay nada que pueda fallar (`ventas.js:295-344`). Lo comprueba
     "CONTROL R2" con 10 casos.
   - El cliente se busca con `Number(...)` en la ruta y en `crearVenta` de la misma forma (`"7"`, `" 7 "` y `"7abc"`
     se tratan igual en los dos lados).
   - El alcance sale del token (`resolverAlcanceAutorizado`) y no del selector.
   - Autorizarse a sí misma con el usuario en mayúsculas o con espacios: 403.
   - El autorizador tiene que ser de la tienda de la venta.
   - El servidor topa el monto al saldo ("CONTROL R3": se pidieron 9,999 y se aplicaron 80).
   - La contraseña se separa del cuerpo antes de `crearVenta` y nunca se guarda en la venta. En la pantalla se borra
     al terminar el cobro.
   - El corte (`cortes.js:178-179`) no cambió. Las pruebas de corte con monedero están verdes.
3. **OAuth.**
   - El `state` es de 32 bytes aleatorios, de un solo uso, se quema aunque falle, vence a los 10 minutos y está ligado
     a proveedor y usuario. Un `state` de Drive probado en ML queda quemado también para Drive ("CONTROL R8").
   - Un `state` vacío, inventado, repetido o mandado como arreglo se rechaza sin tocar la cuenta.
   - El `state` no aparece en logs ni en los redireccionamientos de error.
   - `refrescarToken` modifica la cuenta en su lugar, así que el dato de "conectado por" se conserva.
   - Desconectar ML guarda quién lo hizo. Drive no tiene ruta para desconectar.
4. **Alta y roles.** Sin alcance global se rechazan: rol `"1"` o `" 1 "` como texto, otra sucursal (también en texto o
   basura), un rol que no existe, y crear un rol con `ver_todas_las_sucursales` ("CONTROL R7"). Lo único abierto es R1.
5. **Freno del autorizador.** Funciona en cancelar y en monedero con el mismo registro: 5 fallos en cancelar bloquean
   al mismo autorizador en el monedero, aunque lo pida otra persona y venga la contraseña buena. Variar mayúsculas,
   espacios o un tabulador no lo esquiva ("CONTROL R4"). El oráculo de la desviación 1 está en R2.
6. **SICAR.**
   - Mismos códigos y cuerpos de respuesta: 401 `LLAVE_INVALIDA` y 429 `RITMO_EXCEDIDO` con `Retry-After: 60`
     ("CONTROL S2").
   - El único cambio visible: un 401 o 429 ya no se convierte en 503 si falla el disco. El contrato
     (`docs/sicar-contrato-v1.md`) no promete ese 503 para esos casos, y para el agente es una mejora.
   - Una base existente sin el índice nuevo arranca y lo crea. La limpieza de 30 días no toca filas recientes ni otras
     tablas ("CONTROL S3").
   - Lo único que puede borrar de más es lo que describe R4.
7. **Lo que antes funcionaba.**
   - Cancelaciones: siguen verdes `dineroH4Rutas.test.js` y las demás, sin cambios.
   - Importar orden de ML: el refactor de `c2da119` es equivalente.
   - Alta normal por el Administrador: sin cambios en el servidor. En pantalla, `usuario.ver_todas` existe
     (`sesion.js:22`) y `App.jsx:169` le pasa `usuario` a la pantalla, así que el Administrador sigue viendo todos los
     roles y todas las sucursales.
   - Respaldos: no se tocaron.

## Lo que no se pudo revisar

- **Prueba en navegador:** en esta sesión no hay Claude in Chrome. La ventana de cobro con usuario y contraseña de quien
  autoriza, a 390 px, sigue sin probarse.
- **OAuth real con Google y ML:** se probó con el `state` y el servidor real, sin intercambiar códigos de verdad.
