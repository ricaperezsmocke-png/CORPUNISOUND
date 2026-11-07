# Entrega — huecos graves de las auditorías de octubre 2026

Rama `fix/huecos-graves-2026-10`, creada desde `master` en `45e8f9c`. Plan:
`docs/superpowers/plans/2026-10-27-huecos-graves.md`. Implementado en la nube por Claude Code. **No está revisado por
nadie más ni probado en navegador**: las dos cosas faltan antes de mergear (CLAUDE.md: nadie valida su propio trabajo).

## Qué cambia para el negocio, en corto

| # | Antes | Ahora |
|---|---|---|
| 1 | Cualquiera en internet podía cambiar la cuenta de Google Drive (a dónde van los respaldos) y la de MercadoLibre. | Solo se conecta desde el botón, por alguien con alcance global, y queda quién lo conectó. |
| 2 | Una cajera cobraba con el monedero de cualquier cliente de cualquier tienda. | Necesita el permiso nuevo "Aplicar monedero", el cliente tiene que ser de su tienda, y **otra persona** con "Autorizar uso de monedero" teclea su contraseña. |
| 3 | Las ventas no guardaban quién las cobró. | Cada venta nueva guarda quién la cobró (de la sesión, no de lo que mande el navegador). Se ve en el detalle de la venta como "Cobró:". |
| 4 | Con "Dar de alta personal" se podía crear un Administrador. Crear roles no pedía alcance global. | Sin alcance global solo se da de alta en su tienda y con roles que no den más de lo que uno tiene. Crear roles pide alcance global. Cada alta guarda quién la hizo. |
| 5 | Un desconocido llenaba el disco de Render con intentos SICAR falsos. | Los intentos anónimos y frenados ya no escriben nada en disco. Los de una llave real se guardan con tope de 5,000 por tienda y 30 días. |
| M1 | El campo "autorizador" servía para adivinar contraseñas sin límite. | Tras 5 contraseñas malas, ese autorizador y quien lo intenta quedan bloqueados 15 minutos (responde igual que una contraseña mala). |

## Commits

```
563f5ee docs(seguridad): plan de los huecos graves de las auditorias de octubre
285f043 fix(seguridad): drive y mercadolibre solo se conectan con state de quien lo pidio   (Task 1)
dd2855a fix(ventas): cada venta guarda quien la cobro                                       (Task 2)
d8a4716 fix(seguridad): freno al autorizador y una sola verificacion                        (Task 3)
381be91 fix(monedero): permiso propio y autorizacion de otra persona                        (Task 4)
fbc8617 fix(personal): alta de usuarios y roles sin escalada y con autor                    (Task 5)
8e6bc44 fix(sicar): intentos anonimos sin fila y retencion por tienda                       (Task 6)
c2da119 refactor(seguridad): sin warnings nuevos de eslint en autorizador y mercadolibre
```

El último commit no está en el plan: parte en funciones chicas `verificarAutorizador` e `importarOrdenComoVenta`
porque mis cambios les habían subido la complejidad por encima del límite de eslint (warnings nuevos). No cambia
comportamiento; las mismas pruebas siguen verdes.

## Validaciones

### Línea base (master `45e8f9c`, antes de tocar código)

- `cd backend && node --test`: **3433 pruebas, 3426 pasan, 5 fallan, 2 todo.** Las 5 son ambientales:
  "ARRANQUE REAL: en desarrollo SÍ se tolera" (sin `.env`) y 4 de `buscarClavesSat`/`contarClavesSat`.
- `node --test "src/**/*.test.js"`: **354 pruebas, 353 pasan, 1 falla** (ambiental: "HistorialMetas conserva la versión
  retirada…", zona horaria UTC).
- `npx eslint src backend`: **0 errores, 843 warnings.**

### Resultado final (rama, `c2da119`)

- `cd backend && node --test`:
  ```
  # tests 3489
  # pass 3482
  # fail 5
  # todo 2
  ```
  Las 5 fallas son exactamente las 5 ambientales de la línea base (`not ok … ARRANQUE REAL: en desarrollo SÍ se tolera`,
  `not ok … buscarClavesSat` ×3, `not ok … contarClavesSat`). 56 pruebas nuevas, todas verdes. Cero fallas nuevas.
- `node --test "src/**/*.test.js"`:
  ```
  # tests 354
  # pass 353
  # fail 1
  ```
  La misma falla ambiental de HistorialMetas.
- `npx vite build`: `✓ built in 9.89s` (sin errores; solo el aviso de tamaño de chunk que ya existía).
- `npx eslint src backend`: `✖ 842 problems (0 errors, 842 warnings)` — uno menos que master.
- Ninguna línea nueva de más de 200 caracteres en `src/` ni `backend/`.

**TDD:** cada prueba nueva de comportamiento se vio ROJA antes de implementar (las de rutas contra el servidor real). Las
pruebas nuevas de pantalla del monedero se comprobaron rojas restaurando temporalmente `PuntoDeVenta.jsx` de `HEAD` y se
devolvió el archivo en el mismo paso. Las pruebas unitarias de `oauthEstado.js` y `autorizador.js` se escribieron junto
con el módulo nuevo (no existía nada que pudiera estar rojo); lo que prueba el hueco es la prueba de ruta de cada Task.

## Archivos tocados

Nuevos:
- `backend/oauthEstado.js` + `oauthEstado.test.js` — registro del `state` de OAuth.
- `backend/oauthCallbackRutas.test.js` — Task 1 contra las rutas reales.
- `backend/ventaCobradaPor.test.js` — Task 2.
- `backend/autorizador.js` + `autorizador.test.js` — Task 3.
- `backend/monederoAutorizacion.test.js` — Task 4.
- `backend/altaPersonalEscalada.test.js` — Task 5.
- `backend/sicarIntentosRetencion.test.js` — Task 6.

Modificados:
- `backend/server.js` — rutas de Drive y ML (auth-url, callback, desconectar ML), `POST /api/ventas`, cancelación,
  importar orden de ML, `POST /api/roles`, `POST /api/usuarios`.
- `backend/drive.js`, `backend/mercadolibre.js` — la URL de autorización lleva `state`; la venta importada guarda quién.
- `backend/ventas.js` — `cobrada_por_*` y `monedero_autorizado_por_*` en la venta.
- `backend/usuarios.js` — `crearUsuario(DB, datos, autor)` guarda `creado_por_*` y `creado_en`.
- `backend/permisosCatalogo.js` — `aplicar_monedero` y `autorizar_monedero` (módulo `pos`).
- `backend/roles.js` — el Gerente sembrado NO recibe los dos permisos de monedero.
- `backend/sicarRutas.js`, `backend/sicarRepositorio.js` — intentos sin fila, contador en memoria, retención, índice.
- `backend/monederoPantalla.test.js` — ver desviaciones.
- `src/PuntoDeVenta.jsx` — botón "Aplicar monedero" con permiso; usuario y contraseña de quien autoriza en la ventana de
  cobro.
- `src/AdminRoles.jsx` — alta de personal solo ofrece roles y sucursal permitidos; mensaje claro si el regreso de Drive
  trae un `state` inválido.
- `src/MercadoLibre.jsx` — mismo mensaje para MercadoLibre.
- `src/ConsultasVentas.jsx` — "Cobró: <nombre>" en el detalle ("Sin dato" para ventas viejas).

No se tocaron `render.yaml`, `package.json`, `package-lock.json`, `agente-sicar/` ni Cinco Caminos. No se agregaron
dependencias.

## Desviaciones del plan y por qué

1. **Task 3 — qué cuenta como fallo.** El plan dice "cada fallo cuenta". Cuentan solo los intentos de **adivinar**:
   contraseña mala, usuario que no existe o inactivo. No cuentan los rechazos con la contraseña **correcta** (es la misma
   persona, no tiene el permiso, es de otra tienda) ni los datos vacíos. Por qué: `dineroH4Rutas.test.js` manda 11
   rechazos seguidos con la misma cajera y luego espera una cancelación válida; contando todo, la cajera quedaba
   bloqueada y esa prueba se ponía roja, y el plan pide que siga verde sin tocarla. Además, contar esos casos no protege
   ninguna contraseña: la respuesta es la misma 403 genérica, así que no sirven de oráculo.
2. **Task 3 — dos contadores, no uno por par.** Hay un contador por usuario autorizador tecleado y otro por quien pide;
   basta que cualquiera llegue a 5 para bloquear. Es más estricto que "el par": impide que varias personas se repartan
   los intentos contra Victor y que una persona vaya cambiando de víctima. Costo aceptado: igual que en el login, alguien
   puede dejar bloqueado 15 minutos a un autorizador a propósito. El contador vive en memoria (un reinicio lo borra),
   igual que el del login.
3. **Task 3 — no se busca la venta antes de la contraseña.** La auditoría lo sugería; el plan pide no cambiar el
   comportamiento visible de la cancelación. Con el freno, el oráculo deja de servir: tras 5 fallos, la buena también
   responde 403.
4. **Task 4 — no hay ventana nueva; los campos van en la ventana de cobro.** La cancelación pide al autorizador con dos
   campos dentro de su propia ventana, y eso se copió: usuario y contraseña aparecen en la ventana de "Importe" cuando hay
   monedero aplicado. Esa ventana ya tiene scroll (`max-h-[92vh] overflow-y-auto`) y ancho `w-full` con margen, así que
   cabe en 390 px. El botón "Confirmar cobro" se dejó como estaba (no `type="submit"`): la prueba existente de la
   pantalla lo aprieta por `onClick` y cambiarlo exigía reescribirla. Como en la cancelación, la pantalla no bloquea con
   los campos vacíos: el servidor responde "La autorización no es válida" y el aviso lo muestra. La contraseña se borra
   del estado al terminar el cobro, salga bien o mal.
5. **Task 4 — `monederoPantalla.test.js` sí se tocó, pero no sus pruebas.** Se agregó un parámetro opcional `props` al
   ayudante `prepararPantalla` y se guarda el último cuerpo enviado, para dos pruebas NUEVAS (sin permiso no aparece el
   botón; con monedero se manda el autorizador). Las 5 pruebas existentes no cambiaron ni una línea.
6. **Task 4 — un `monedero_aplicado` que no es número** (por ejemplo `"abc"`) también exige el permiso: la guarda corre
   con cualquier valor distinto de cero, para fallar cerrando.
7. **Task 1 — desconectar Drive.** No existe ruta para desconectar Drive, así que solo se cubrió la de MercadoLibre. Al
   desconectar ML se guarda `DB.ml.ultima_desconexion = { por_id, por_nombre, en }`.
8. **Task 6 — el contador en memoria no se muestra en pantalla.** "Envíos SICAR" sí lee intentos, pero agregar el
   contador a esa respuesta cambiaría lo que la pantalla recibe; el plan deja como suficiente el `console.warn` una vez
   por minuto al pasar de 100, y eso es lo que hay (`crearContadorRechazosSicar` en `sicarRutas.js`, con `resumen()`
   listo por si después se quiere pintar).
9. **Task 6 — también los 429 de `TIENDA_OCUPADA` dejan de escribir fila**, aunque vengan de una llave real: el plan dice
   "no se escribe fila para respuestas 429". Efecto lateral (mejora): antes, si el disco fallaba al registrar un 429, la
   respuesta se volvía 503; ahora siempre es 429. Las respuestas y códigos del contrato del agente no cambian.
10. **Task 2 — la ruta de importación de ML ya manda el usuario**; la "importación automática" no existe hoy en el
    código, pero `importarOrdenComoVenta` sin usuario ya firma como "MercadoLibre (automático)" por si aparece.

## Lo que quedó sin hacer

- **Prueba en navegador** (la hace Claude en la máquina de Victor). Lo que hay que recorrer:
  1. Cobrar con monedero como cajera con "Aplicar monedero": la ventana de cobro pide usuario y contraseña; con la
     contraseña de una supervisora con "Autorizar uso de monedero" de la misma tienda, entra; con una mala, sale el
     aviso y el saldo del cliente no baja. Revisar a 390 px.
  2. Una cajera sin "Aplicar monedero" no ve el botón.
  3. Detalle de una venta nueva en Consultas de Ventas: "Cobró: <nombre>". Una vieja: "Cobró: Sin dato".
  4. Conectar Google Drive y MercadoLibre desde sus botones (con la cuenta de Victor): debe conectar normal.
  5. Dar de alta personal con un usuario sin alcance global (si existe alguno con ese permiso): solo ve su tienda y los
     roles permitidos.
- **Revisión independiente** del diff (no puede ser Claude de esta sesión).
- Fuera de este plan, siguen abiertos los demás hallazgos de las auditorías (M2–M5, B1–B9 de permisos; A2 y siguientes
  de sicar-crm). En particular A2 de SICAR: un intento con una llave real y secreto falso **sigue** quedando a nombre de
  esa tienda.

## Lo que Victor tiene que hacer después del merge

1. **Dar los permisos de monedero a mano** en Roles y Personal. Hasta que lo haga, **nadie salvo el Administrador puede
   cobrar con monedero**:
   - "Aplicar monedero de un cliente" (`aplicar_monedero`) → a quien cobra (cajeras, gerentes que cobren).
   - "Autorizar uso de monedero" (`autorizar_monedero`) → a quien autoriza (gerente o encargada), que debe ser de la
     misma tienda o tener alcance global. Tiene que ser otra persona: nadie se autoriza a sí mismo.
   El rol Administrador los recibe solo al arrancar.
2. **Drive y MercadoLibre no hay que reconectarlos**: las cuentas ya conectadas siguen igual; el cambio aplica la próxima
   vez que alguien apriete "Conectar". Desde ahora solo puede hacerlo una cuenta con alcance global (un Gerente ya no).
   Si alguien estaba a medio conectar justo cuando se reinició el servidor, que vuelva a apretar el botón.
3. **Crear roles** ahora requiere alcance global: si un gerente lo hacía, ya no puede.
4. Revisar en la consola de Google Cloud si la app de Drive está en modo "prueba" (lo pidió la auditoría; no se puede
   ver desde aquí).

## Correcciones de la revisión

Revisión independiente: `origin/revision/huecos-graves-2026-10`, `docs/revisiones/2026-10-27-huecos-graves.md`
(veredicto: aprobable con un arreglo, R1). Se corrigieron R1 a R4 sobre `8d4dc54`, un commit por punto.

### En corto, para Victor

- **R1 (cuenta títere), cerrado de dos lados.** Un gerente sin alcance global ya no puede dar de alta a nadie con un
  rol que autorice monedero o cancelaciones (la pantalla tampoco se los ofrece). Y aunque la cuenta exista, el
  autorizador rechaza a cualquier cuenta que haya dado de alta la misma persona que pide la autorización. Las cuentas
  viejas, que no guardan quién las creó, siguen autorizando igual.
- **R2 y R3 (pistas por el tiempo de respuesta), cerrados.** Si la cuenta no existe, está dada de baja o está
  bloqueada, el sistema hace igual la comparación de contraseña (contra una falsa) antes de responder: todas las
  respuestas tardan lo mismo.
- **R4 (historial SICAR), cerrado.** Un envío con llave mala ya no deja ninguna fila, así que no puede borrar el
  historial real de una tienda. El agente recibe exactamente las mismas respuestas que antes.
- **Nuevo después del merge:** si quiere que un gerente dé de alta a una encargada que autorice monedero o
  cancelaciones, esa alta la tiene que hacer usted (o alguien con alcance global).

### Commits

| Commit | Punto |
|---|---|
| `69acaa3` | fix(seguridad): una cuenta creada por quien pide no puede autorizarle (R1) |
| `eaa69f7` | fix(seguridad): el autorizador tarda lo mismo exista o no la cuenta (R2 y R3) |
| `dc36bdd` | fix(sicar): ningun intento rechazado por llave escribe fila (R4) |

Qué cambió:

- `backend/autorizador.js`: `creadaPorQuienPide` rechaza con el 403 genérico, sin contar como adivinanza, cuando
  `Number(creado_por_id) === Number(solicitante.id)`; solo si `creado_por_id` es un entero positivo (`null`, ausente
  o vacío no cuentan, porque `Number(null)` es 0). `HASH_FICTICIO` se genera una vez al cargar el módulo (bcrypt,
  costo 10, contraseña al azar) y se compara contra él, descartando el resultado, cuando la cuenta no existe, está
  inactiva o el par está bloqueado. `opciones.verificarPassword` es inyectable solo para las pruebas.
- `backend/server.js`: `PERMISOS_SOLO_ALTA_GLOBAL` suma `autorizar_monedero` y `autorizar_cancelaciones`.
- `src/AdminRoles.jsx`: la misma lista, para que la pantalla de alta no ofrezca roles que el servidor rechaza.
- `backend/sicarRutas.js`: `sinFila = status === 429 || status === 401`.
- Pruebas nuevas: `backend/autorizadorTitere.test.js` (5, contra las rutas reales), 5 en `backend/autorizador.test.js`
  y 1 en `backend/sicarIntentosRetencion.test.js`. Todas se vieron ROJAS antes del arreglo (4 de R1, 3 de R2/R3,
  1 de R4).

### Validación (sobre `dc36bdd`)

- `cd backend && node --test`: `# tests 3500`, `# pass 3493`, `# fail 5`, `# todo 2`. Las 5 son las ambientales
  conocidas: "ARRANQUE REAL: en desarrollo SÍ se tolera — se queda vivo, avisando" y 4 de
  `buscarClavesSat`/`contarClavesSat`. Ninguna otra. `dineroH4Rutas.test.js` sigue verde sin tocarse.
- `node --test "src/**/*.test.js"`: `# tests 354`, `# pass 353`, `# fail 1`: "HistorialMetas conserva la versión
  retirada e informa quién, fecha y motivo" (la ambiental conocida).
- `npx vite build`: `✓ built in 8.49s`.
- `npx eslint src backend`: `✖ 842 problems (0 errors, 842 warnings)`; los mismos 842 que en `8d4dc54`.
- Ninguna línea nueva de más de 200 caracteres.

Pruebas de la revisión contra este código (copiadas a `docs/revisiones/` solo para correrlas, sin commitear):

| Prueba | Antes | Ahora | Por qué |
|---|---|---|---|
| DEFECTO R1 | pasa | **ya no pasa** ✔ | el alta de la títere recibe 403 (`403 !== 200`) |
| DEFECTO R5 (R2) | pasa | **ya no pasa** ✔ | sonda tras acierto 113.9 ms, tras fallo 122.8 ms: no distingue |
| DEFECTO R6 (R3) | pasa | **ya no pasa** ✔ | existe 116.0 ms, no existe 132.0 ms: no distingue |
| DEFECTO S1 (R4) | pasa | **ya no pasa** ✔ | la última fila de Yajalón sigue siendo la real (`'200'`, no `'401'`) |
| CONTROL R2, R3, R4, R7, R8, S2, S3 | pasan | pasan | nada se rompió |

### Desviaciones

1. **La A2 de `origin/auditoria/sicar-crm-2026-10` no pasa, y con el arreglo pedido no puede pasar tal como está
   escrita.** Falla con `TypeError: Cannot read properties of undefined (reading 'sucursal_id')`, no por su
   aserción: lee la última fila de `sicar_intentos` esperando que exista con `sucursal_id` nulo, y con "ningún 401
   escribe fila" la tabla queda vacía. Esa prueba estaba pensada para la otra salida que proponía la revisión
   (escribir la fila sin tienda). Comprobado:
   - Corrida sola con el código viejo, falla por la aserción (la fila queda a nombre de la tienda 2): el defecto.
   - Con el código nuevo no hay fila: lo que la prueba exige ("no debe quedar registrada como intento de esa
     tienda") se cumple.
   - Con la prueba completa, la petición de A2 recibe 429 (freno de ritmo tras las 40 de A1), así que en esa
     corrida A2 nunca llega a probar la llave, ni antes ni ahora.
   No la modifiqué: está en otra rama y no es mía. La cobertura real del caso es la prueba nueva "S1 invertida" en
   `sicarIntentosRetencion.test.js`, que se vio roja con el código viejo.
2. **`sicarRutas.test.js` ("secreto se muestra una vez y llave inválida o revocada obtiene 401") sigue verde, sin
   tocarla, pero su última aserción perdió fuerza.** Comprobaba que el 401 de una llave revocada dejaba fila. Ahora
   no la deja, y la prueba pasa porque la última fila es la del `GET /estado` anterior, hecho con la misma llave. El
   rastro de una llave revocada que sigue intentando queda solo en el contador en memoria (`anonimos_401`), igual
   que cualquier 401. Es el costo aceptado de "ningún 401 escribe fila".
3. **Además de lo pedido en R1**, la pantalla de alta (`src/AdminRoles.jsx`) usa la misma lista de exclusión que el
   servidor, para no ofrecer roles que se rechazarían. Es el mismo criterio que ya tenía con
   `ver_todas_las_sucursales` y `administrar_roles`.

### Sigue pendiente

- La prueba en navegador de toda la rama, con lo de la sección "Lo que quedó sin hacer". En esta sesión no hay Chrome.
- B1 y D1 de SICAR y el resto de los hallazgos fuera de alcance.
