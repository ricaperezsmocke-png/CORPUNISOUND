# Auditoría de seguridad: integración SICAR + CRM

**Fecha:** 2026-10-27 · **Base auditada:** `master` en `45e8f9c` · **Tipo:** solo lectura y pruebas; no se arregló nada.

## Resumen en 5 líneas

1. **Lo más serio:** cualquier persona en internet, sin cuenta ni llave, puede escribir filas sin límite en la bitácora de envíos SICAR. Así puede ir llenando el disco de 1 GB de Render (A1).
2. Una tienda **no** puede meter, cambiar ni borrar datos SICAR de otra tienda: la tienda sale siempre de la llave, y la repetición, la secuencia y los lotes malos están bien cerrados.
3. Hay **una fuga entre tiendas**, chica: la ficha de un cliente SICAR muestra la marca "cuenta interna" (motivo y nombre de quien la puso) de un cliente de **otra** tienda (B1).
4. El agente de la tienda no puede escribir en SICAR, ni conectarse fuera de la PC, ni dejar datos o contraseñas en el log. Lo único flojo es que el aviso de "usuario MySQL con demasiados permisos" no detecta permisos de escritura (C1).
5. Restaurar un respaldo **borra la llave activa** que una tienda haya recibido después de la foto, y esa tienda deja de mandar ventas hasta que alguien le instale otra (D1).

Cinco hallazgos REPRODUCIDOS con pruebas que fallan en `master`, y cinco menores SOLO LEÍDOS.

---

## Cómo correr las pruebas de reproducción

Están en archivos `*.auditoria.js`, **no** `*.test.js`, a propósito. Así `cd backend && node --test` no las recoge y la
suite no se pone roja por ellas. Cada una **falla en master** y dejará de fallar cuando se cierre su hueco.

```
cd backend
node --preserve-symlinks --preserve-symlinks-main --test auditoria/sicarIntentos.auditoria.js            # A1 y A2
node --preserve-symlinks --preserve-symlinks-main --test auditoria/crmInternaOtraTienda.auditoria.js      # B1
node --preserve-symlinks --preserve-symlinks-main --test auditoria/sicarRestauracionLlaves.auditoria.js   # D1
cd ../agente-sicar
node --preserve-symlinks --preserve-symlinks-main --test auditoria/privilegios.auditoria.js               # C1
```

Resultado en master: 0 pasan y 7 fallan (2 + 1 + 1 + 3), todas por la afirmación que describe el hueco, no por un error de la prueba.

---

## Hallazgos, de más a menos grave

### A1 — Un desconocido puede llenar el disco de Render con intentos SICAR falsos · ALTA · REPRODUCIDO

- **Quién:** cualquiera en internet. No necesita cuenta, llave ni contraseña.
- **Qué hace:** manda peticiones `POST /api/integraciones/sicar/v1/lotes` sin llave, una tras otra.
  El servidor las rechaza (401, y después 429 por el freno de ritmo), pero **cada rechazo, incluidos los del freno,
  escribe una fila** permanente en la tabla `sicar_intentos`. El freno corta la respuesta, no la escritura.
  - `backend/sicarRutas.js:19-29`: `responder()` llama `repo.registrarIntento(...)` en **toda** respuesta.
  - `backend/sicarRutas.js:53`: el 429 del freno pasa por ese mismo `responder()`.
  - `backend/sicarRepositorio.js:606-608`: inserción sin tope. No hay ninguna limpieza de `sicar_intentos` en el código
    (se buscó: solo se inserta y se lee).
  - `backend/sicarRespaldo.js:8`: la tabla además viaja completa en cada respaldo SICAR a Drive.
- **Cuánto cuesta:** cada fila pesa unos **83 bytes** (medido). El disco de Render es de **1 GB** (`render.yaml`) y ahí
  vive **la misma base SQLite donde se guardan las ventas** (el JSON del negocio y las tablas SICAR comparten conexión).
  - Con ~9 millones de peticiones la base pasa de 750 MB. Desde ese momento el respaldo SICAR se niega a correr
    (`backend/sicarRespaldo.js:97`, "No hay reserva de espacio…").
  - Un poco más adelante el disco se llena y el sistema ya no puede guardar nada: ni ventas, ni cortes.
  - A unos cientos de peticiones por segundo, eso son horas, no días.
- **Qué queda registrado:** las propias filas, con hora y código. **No se guarda la IP**, así que no hay forma de saber
  quién fue.
- **Prueba:** `backend/auditoria/sicarIntentos.auditoria.js`, prueba A1. Manda 40 peticiones anónimas y quedan
  40 filas permanentes, aunque el freno ya estaba contestando 429.
- **Cómo se cierra (para quien implemente):**
  - No registrar fila por cada 429 ni por cada 401 anónimo. Basta un contador por minuto.
  - Poner retención: borrar intentos de más de N días, o conservar solo los últimos N por tienda.
  - Decidir si `sicar_intentos` debe ir en el respaldo.

### B1 — La ficha de un cliente SICAR muestra la "cuenta interna" de un cliente de otra tienda · MEDIA · REPRODUCIDO

- **Quién:** cualquier vendedor o gerente de la tienda A con el permiso `ver_clientes_sicar`.
- **Qué hace:** abre en Clientes (`GET /api/crm/v2/clientes/sicar:A:<id>`) a un cliente SICAR de su tienda. El agente
  ya lo unió **solo**, por teléfono y en estado "pendiente", sin que nadie lo confirmara, con un cliente nativo de la
  tienda B que alguien de B marcó como cuenta interna.
- **Qué expone:** el **motivo** que escribió la tienda B (texto libre, por ejemplo "Cuenta personal del gerente de
  Yajalón"), la fecha y el **nombre de la persona de B** que lo marcó. Además, como la marca se hereda, ese cliente
  sale de los totales de la tienda A y no puede ser VIP en A, por una decisión que tomó otra tienda.
  - `backend/crmFuentes.js:154-156`: para una identidad unida a un nativo que quien pregunta **no** ve, copia
    `cuenta_interna` del nativo de la otra tienda.
  - `backend/crmCuentasInternas.js:104`: la ficha agrega el nombre de quien marcó.
  - Contradice el plan `docs/superpowers/plans/2026-10-13-crm-clientes-sicar.md` §8: "Para vínculo cruzado pendiente,
    mostrar en tienda fuente solamente ficha/datos SICAR propios y aviso genérico".
- **Qué queda registrado:** nada. Es una lectura.
- **Prueba:** `backend/auditoria/crmInternaOtraTienda.auditoria.js`. La ficha de Ocosingo trae
  `{"motivo":"Cuenta personal del gerente de Yajalon", …, "usuario_nombre":"Gerente Yajalon"}`.
- **Cómo se cierra:** en `externas`, usar solo la marca SICAR propia (`f.interna_*`) y nunca la del nativo de otra tienda.

### A2 — Cualquiera puede hacer que en "Envíos SICAR" parezca que el agente de una tienda está fallando · MEDIA-BAJA · REPRODUCIDO

- **Quién:** cualquiera que conozca el `key_id` de una tienda. Es la primera mitad de la llave (lo que va antes del
  punto), no es secreto en sí. Está en el `config.json` de la PC de la tienda, en la pantalla de Llaves y en cada
  petición del agente.
- **Qué hace:** manda lotes con ese `key_id` y cualquier secreto inventado.
- **Qué expone o daña:** el servidor busca la llave **antes** de comprobar el secreto y apunta el intento fallido a
  nombre de **esa tienda y esa llave**.
  - `backend/sicarRutas.js:49-50`: busca la llave antes de autenticar.
  - `backend/sicarRutas.js:25`: guarda el intento con la tienda y la llave de quien dice ser.
  - La pantalla muestra solo los **últimos 100** intentos (`backend/sicarRepositorio.js:586-587`). Con 100 peticiones
    falsas se pueden esconder los fallos reales del agente, o hacer creer que una tienda tiene la llave mal.
  - Combinado con A1, cada una de esas filas también se queda para siempre.
- **Qué queda registrado:** filas de 401 o 429 a nombre de la tienda víctima, sin IP.
- **Prueba:** `backend/auditoria/sicarIntentos.auditoria.js`, prueba A2. El intento con secreto falso queda con
  `sucursal_id = 2`.
- **Cómo se cierra:** llenar `sucursal_id` y `key_id` del intento solo después de que la llave se autenticó. Los fallidos
  van sin tienda, o en una lista aparte.

### D1 — Restaurar un respaldo borra la llave activa que una tienda recibió después de la foto · MEDIA-BAJA · REPRODUCIDO

- **Quién:** pasa sin que nadie lo pida. Lo dispara el administrador al restaurar, con `CLAVE_RESTAURACION`.
- **Qué hace:** la restauración conserva las llaves **revocadas** después de la foto, y eso está bien. Pero a las
  llaves **activas** que no estaban en la foto las borra.
  - `backend/sicarRespaldo.js:337-345`: solo copia `WHERE revocada IS NOT NULL` y luego reemplaza `sicar_llaves` entera.
  - El caso más probable es justo el más delicado. Se sospecha que la llave de Ocosingo se filtró, se revoca y se le
    instala una nueva. Días después se restaura un respaldo. La vieja sigue revocada, como debe, pero la nueva
    **desaparece**. Ocosingo se queda sin ninguna llave válida y su agente se detiene con `HTTP_401`.
  - La prueba existente `sicarRespaldo.test.js:256` ("servidor de reemplazo con llave nueva…") solo revisa que la vieja
    quede revocada. No revisa que la nueva sobreviva.
- **Cuánto cuesta:** no se pierden ventas, porque el agente guarda su lote y lo reenvía. Pero la tienda deja de mandar
  hasta que alguien genere otra llave y vaya a la PC de la tienda a ponerla en `config.json`. Esto se suma al alto
  `SECUENCIA_RETROCEDIO`, que ya está documentado en `agente-sicar/LEEME.md`.
- **Qué queda registrado:** el aviso de restauración, nada más. La llave borrada no deja rastro.
- **Prueba:** `backend/auditoria/sicarRestauracionLlaves.auditoria.js`.
- **Cómo se cierra:** en `aplicar()`, copiar también las llaves vigentes que no están en la foto, igual que ya se hace
  con las revocadas.

### C1 — El aviso PRIVILEGIOS_AMPLIOS no detecta que el usuario MySQL pueda escribir · BAJA · REPRODUCIDO

- **Quién:** nadie lo explota directamente. Es una alarma que falla abriendo (regla 2 de `CLAUDE.md`).
- **Qué hace:** `--verificar` revisa `SHOW GRANTS` y solo avisa si ve `FILE` o `GRANT OPTION` (`agente-sicar/index.js:13`).
  No avisa con un usuario que tenga `ALL PRIVILEGES`, ni `INSERT, UPDATE, DELETE` sobre la base de SICAR, ni `DROP`.
  Es decir, un usuario que puede cambiar o borrar ventas en SICAR pasa sin aviso.
- **Qué expone:** nada por sí mismo. El agente sigue protegido por otras dos barreras que sí funcionan:
  `validarSQL`, que solo deja pasar SELECT/SHOW, y la transacción `READ ONLY` (`agente-sicar/seguridad.js`). Hoy el aviso
  sale siempre porque `consultas` tiene FILE (decisión documentada en `LEEME.md` §6). Lo que falla es el día en que se
  cree el usuario de solo lectura "cuando haya root": si se crea mal, la alarma se queda callada.
- **Qué queda registrado:** nada. Ese es el problema.
- **Prueba:** `agente-sicar/auditoria/privilegios.auditoria.js`, 3 casos y los 3 fallan.
- **Cómo se cierra:** validar contra lo permitido (`SELECT`, `SHOW VIEW`, `USAGE`) y avisar ante cualquier otra cosa.

### Menores, SOLO LEÍDOS (no se escribió prueba)

- **L1 · Bandeja: el historial de un cliente lo ve cualquier vendedor de la tienda.** Se refiere a
  `GET /api/mensajes/clientes/:id/historial` (`backend/bandejaRutas.js:84`, `backend/bandeja/consultas.js:166-177`).
  Solo pide `ver_bandeja` y que el cliente sea de su tienda, no que sea su cliente. Muestra lista de conversaciones
  (canal y hora), responsables, estados y eventos. **No** muestra el texto de los mensajes: abrir la conversación sí
  está cerrado por `puedeVer`. El spec 2026-10-18 dice "vendedor no ve conversaciones de otro vendedor". Baja.
- **L2 · Bandeja: ligar un contacto puede jalar a otra tienda una conversación.** La identidad externa es una sola por
  número (`backend/bandeja/mensajes.js:101-102`), aunque ese número haya escrito a canales de dos tiendas. La
  conversación pertenece a la tienda del cliente ligado (`consultas.js:139`). Si un vendedor de A liga ese número a un
  cliente de A, la conversación que el cliente tuvo con el canal de B pasa a verse en A. Hoy no tiene efecto, porque en
  producción no entra ningún mensaje real: el canal simulado está apagado y el proveedor real es la fase F4. Baja.
- **L3 · Traspaso de cartera sin revisar la tienda de cada cliente.** `backend/bandeja/responsable.js:94` mueve todos
  los clientes del vendedor origen. Valida el destino solo contra la tienda **del vendedor**, no la de cada cliente.
  Un cliente que se cambió de tienda conservando su vendedor acaba asignado a un vendedor de otra tienda. Baja
  (integridad, no fuga).
- **L4 · Las rutas viejas del CRM usan el selector del encabezado para autorizar.** Son `GET /api/crm/clientes/:id`,
  `PUT …/estado`, `GET/POST …/contactos` (`backend/server.js:1859-1899`) y `GET/PUT /api/clientes/:id`
  (`server.js:1631`, `1681`), vía `resolverAlcance`, que lee `?sucursal_id=` (`backend/auth.js:197-214`). Falla
  cerrando: al administrador con otra tienda en el encabezado le sale "no encontrado". No es fuga, pero es la regla 5.
  Las rutas v2 sí lo hacen bien. Baja.
- **L5 · `POST /api/sicar/llaves` responde 403 y no 404 para una tienda fuera de alcance** (`backend/sicarRutas.js:151`).
  No revela nada que no se sepa (la lista de tiendas). Muy baja.

---

## Para que Victor decida (no son defectos: son decisiones tomadas, pero conviene saber lo que implican)

- **El alta de cliente sirve para buscar teléfonos de otras tiendas.** Al dar de alta un cliente con un teléfono o
  correo que ya existe en **cualquier** tienda, el sistema contesta con su **nombre y tienda**
  (`backend/clientes.js:216-224`). Así se decidió en el commit `d856543` del 2026-09-28. La consecuencia es que una
  cajera de Ocosingo con `crear_cliente` puede escribir números y averiguar de quién son en Palenque. No queda registro
  de esas búsquedas, porque el alta rechazada no se guarda.
- **Las listas del CRM solo piden haber iniciado sesión.** `GET /api/crm/v2/clientes` y la ficha piden solo login, no un
  permiso de CRM (así lo dice el spec 2026-10-15 de "qué compra"). Cualquier cuenta de la tienda, incluida una cajera,
  puede bajar por la API la lista de clientes **de su tienda** con teléfonos. Los datos SICAR sí piden
  `ver_clientes_sicar`. No es fuga entre tiendas.

---

## Lo revisado que está bien

**Entrada de SICAR (pregunta A):**
- La tienda de un lote sale **solo** de la llave (`llave.sucursal_id`), nunca del cuerpo. No hay forma de que la llave
  de Ocosingo escriba en Yajalón: todas las tablas llevan `sucursal_id` en la llave primaria.
- Las llaves se guardan como hash SHA-256 de un secreto aleatorio de 256 bits. La comparación es de tiempo constante
  (`timingSafeEqual`) e incluye la llave inexistente (compara contra ceros).
- Una llave revocada se rechaza, y se vuelve a comprobar al **terminar** de recibir el cuerpo: revocar a media subida
  sí funciona.
- Repetir un lote viejo devuelve el recibo guardado sin aplicar nada. El mismo `batch_id` con otro contenido da 409
  (`CONFLICTO_BATCH`) y la secuencia equivocada da 409 (`SECUENCIA_INCORRECTA`). Todo dentro de una transacción
  `IMMEDIATE`.
- Límites: cuerpo de 1 MB (por encabezado y contando bytes), 30 s para recibirlo, 100 clientes, 100 ventas y 1,000
  renglones, sin compresión. Propiedades no declaradas, texto mal decodificado (`�`), importes con más de dos
  decimales y fechas imposibles se rechazan contra lista de lo permitido.
- Un lote malo (validación o llave foránea) no deja nada a medias: falla antes o hace rollback completo.
- Una tienda a la vez por candado. Freno de 12 por minuto por llave.
- La pantalla de envíos y la de llaves resuelven el alcance del token.

**Clientes y CRM (pregunta B):**
- `crmFuentes.js` filtra las identidades SICAR por tienda **antes** de sumar. Compras, detalle de compra
  (`sicar:<tienda>:<venta>`), "qué compra" y resumen respetan el alcance del token. Una referencia de otra tienda da 404.
- El selector del encabezado solo recorta (`contextoCRM`).
- Las uniones por teléfono quedan "pendiente" y solo un humano las confirma. Confirmar una unión con un cliente de otra
  tienda exige administrador (`sicarVinculos.js:117-123`). Si cambia el teléfono del cliente nativo, una unión
  confirmada vuelve a "pendiente"; si cambia el de SICAR, queda un aviso para revisarla.
- Estado y cuenta interna desde la ficha: pasan por `ficha()` (alcance) antes de escribir. Una identidad unida no se
  marca por la vía SICAR.
- Cortes, personal y traspasos SICAR: el alcance sale del token. El mapa de sucursales solo se cambia con alcance
  total. Existencias de todas las tiendas para quien tenga el permiso es decisión escrita en el código y en el spec
  2026-10-23.

**Agente (pregunta C):**
- Solo `127.0.0.1`/`localhost`, usuario fijo `consultas`, sin varias sentencias por consulta.
- `validarSQL` rechaza comillas, comentarios, `INTO`/`OUTFILE`/`LOAD_FILE`/`UPDATE`/`LOCK`, `;`, `@`, `*` (salvo
  `COUNT(*)`) y cualquier función fuera de una lista corta. Encima, la sesión y cada página corren en transacción
  `READ ONLY`.
- Destino fijo `https://…onrender.com` con `redirect: 'error'`.
- El log solo escribe códigos conocidos e ids numéricos validados con patrón: nunca el mensaje de MySQL, ni la
  contraseña, ni la llave. Rota a 5 MB y se crea con permisos `0600`.
- `config.json` y `estado.json` deben estar **fuera** del repositorio.

**Bandeja (pregunta B):**
- El canal simulado solo existe con `NODE_ENV` igual a `development` o `test`. Render no lo declara, así que en
  producción la ruta no existe. Falla cerrando.
- Ver una conversación de otra tienda o de otro vendedor da 404. Tomar, reasignar y traspasar validan que el vendedor
  sea activo y de la tienda del cliente o del vendedor origen. Ligar exige que el contacto y el cliente estén en el
  alcance.
- No hay rutas públicas del centro de leads.

**Respaldos (pregunta D):**
- AES-256-GCM con IV nuevo por archivo y autenticación (un archivo alterado no se descifra). La llave solo vive en
  variable de entorno y su nombre de variable está pensado para el filtro de Sentry.
- Restaurar exige alcance global, `CLAVE_RESTAURACION` (tiempo constante) y la palabra de confirmación. Es una sola a
  la vez, bloquea escrituras y antes crea el respaldo `pre_restauracion`.
- La copia SICAR se valida entera (manifiesto, hash por trozo, conteos) **antes** de tocar nada.
- No hay mezcla de tiendas: la restauración es de la base completa. Una llave revocada nunca revive.
- La descarga sin sesión entrega solo bytes cifrados, con token en tiempo constante y 404 si no cuadra.

**Metas y supervisión:**
- Capturas, revisión y anulación con alcance de token. Las metas del corporativo solo las ve su dueño o quien ve todas.
  Administrar metas es solo del Administrador.
- Supervisión: visitas y fallas fuera de alcance dan 404. El responsable debe ser cuenta activa de esa tienda. Las
  fotos van a Drive (nunca a disco) y se borran si la operación falla. Los archivos de Drive no se comparten (no hay
  llamadas a `permissions`).

---

## Lo que no se revisó y por qué

- **Prueba en navegador:** no se levantó la interfaz. La auditoría fue del servidor y del agente, y los hallazgos se
  prueban mejor por API.
- **Configuración real de Render:** si hay `trust proxy`, cuántas IPs de origen ve el freno, y el `NODE_ENV` real.
  No se tocó producción, por instrucción. La conclusión de A1 no depende de eso.
- **Permisos reales del usuario `consultas` en cada tienda y si MySQL escucha hacia afuera.** `LEEME.md` §6 dice que sí
  escucha y que `consultas` puede escribir archivos (decisión de Victor mientras no haya root). Sin acceso a las PCs no
  se pudo medir.
- **Fuera de alcance:** punto de venta y corte de caja (ya auditados en septiembre).
- **Revisado solo por encima** (de la sección "ligero" y del centro de leads): el planeador IA de metas,
  `centroLeads/atribuciones.js` y `enlacesRastreados.js`. Se confirmó que no tienen rutas públicas, pero no se leyó
  su lógica completa.
- **La suite completa de `backend/` ya trae 5 fallas en master en este entorno, ajenas a esta auditoría** (no se cambió
  código):
  - 4 de `clavesSat.test.js` ("unable to open database file", falta el archivo de claves SAT en el entorno).
  - 1 de `arranquePersistencia.test.js:204` (arranque en desarrollo, sensible a tiempos).
  - Resultado: 3,433 pruebas, 3,426 pasan.
