# Auditoría de la zona de permisos — octubre 2026

Rama auditada: `master` en `45e8f9c` (2026-10-27). Auditor independiente; no se tocó código de la aplicación.
Reproducciones: `docs/auditorias/2026-10-permisos/reproducciones.test.cjs` (13 pruebas, todas en verde; **cada una pasa
porque el hueco existe**). Se corren desde `backend/` con:

```
node --test ../docs/auditorias/2026-10-permisos/reproducciones.test.cjs
```

Levantan la app real (`server.js`) en un puerto efímero, con base desechable, y le pegan por HTTP como lo haría el
navegador o alguien con la pestaña de Red abierta.

## 1. Resumen

1. **18 hallazgos: 1 crítico, 3 altos, 5 medios, 9 bajos.** 13 reproducidos contra el servidor real y 5 solo leídos.
2. **El peor:** una cajera con el permiso normal de "Cerrar Venta" puede pagar mercancía con el saldo de monedero de
   *cualquier* cliente de la cadena, también de otra tienda. Su cajón cuadra y la venta no guarda quién la cobró.
3. Los altos: (a) con solo "Dar de Alta Personal" se crea una cuenta de Administrador; (b) cualquiera en internet puede
   cambiar la cuenta de Google Drive y la de MercadoLibre del negocio; (c) ninguna venta guarda quién la cobró.
4. Los medios tienen que ver con contraseñas y con cambios que no dejan rastro: probar contraseñas sin freno desde la
   cancelación, cambios de precio, importaciones y de roles sin autor, y un GPS que manda el propio navegador.
5. Suite completa: 3433 pruebas, 3426 pasan, 5 fallan y 2 quedan como `todo`. Las 5 fallas vienen del entorno (falta el
   archivo del catálogo SAT en un clon nuevo) y no tienen que ver con permisos. Detalle en la sección 4.

## 2. Hallazgos (de más a menos grave)

### C1. Cobrar con el monedero de cualquier cliente, incluso de otra tienda — CRÍTICA — REPRODUCIDO

- **Quién:** cualquiera con `cerrar_venta`, que es el permiso básico del rol Cajero. No hace falta ningún permiso de
  monedero (no existe ninguno).
- **Qué hace:**
  - *En pantalla* (su propia tienda): en Punto de Venta elige a un cliente que tenga saldo de monedero y aprieta
    "Aplicar monedero". El cliente no tiene que estar presente y nada se lo pide.
  - *Por petición* (cualquier tienda): `POST /api/ventas` con `cliente_id` de un cliente de otra sucursal y
    `monedero_aplicado` igual a su saldo. El servidor no revisa a qué tienda pertenece el cliente.
- **Cuánto:** todo el saldo de monedero de cualquier cliente de la cadena. Ese saldo es el dinero de los apartados
  cancelados. Reproducido: una cajera de Ocosingo se lleva $100 de mercancía pagados con el monedero de un cliente de
  Yajalón. El monedero baja de $3,000 a $2,900 y la venta queda con `monedero_aplicado = total`.
- **Qué queda registrado:** la venta en Ocosingo con el cliente de Yajalón. El corte cobra `total - monedero_aplicado` =
  $0, así que **el cajón cuadra** y nadie ve un faltante. El dinero que falta es del cliente, y aparece el día que
  quiera usar su saldo. La venta **no tiene ningún campo de quién la cobró** (ver A3). El único rastro de la persona es
  el movimiento de inventario de cada producto, y no existe si la línea es un artículo rápido.
- **Dónde:** `backend/ventas.js:295-311` (toma `cliente_id` del cuerpo y descuenta su monedero sin mirar sucursal ni
  permiso); `backend/server.js:2017-2032` (la ruta solo pide `cerrar_venta`); `src/PuntoDeVenta.jsx:373` (en pantalla
  el botón aparece para cualquiera que tenga cliente con saldo).
- **Prueba:** `H3` en el archivo de reproducciones.
- **Cómo se cierra:** usar el monedero tiene que estar en el servidor, con lista de lo permitido: el cliente debe estar
  dentro del alcance de quien cobra (regla 5, por token). Victor tiene que decidir si basta con un permiso propio o si
  además hace falta una autorización como la de las cancelaciones.

### A1. Con solo "Dar de Alta Personal" se crea un Administrador — ALTA — REPRODUCIDO

- **Quién:** cualquier rol con `dar_alta_personal`, aunque esté amarrado a una tienda. Hoy solo lo trae el
  Administrador (el Gerente lo tiene excluido en `backend/roles.js:77`), así que **es una escalada por configuración**: se
  abre el día que Victor le dé ese permiso a un gerente para que dé de alta a sus cajeras.
- **Qué hace:** en Roles y Personal → "Dar de alta personal" el formulario solo ofrece los roles que ve, pero la
  petición `POST /api/usuarios` acepta cualquier `rol_id`, incluido el `1` (Administrador), y cualquier `sucursal_id`.
  Después se entra con esa cuenta nueva: como es Administrador, el login ni siquiera revisa GPS.
- **Cuánto:** todo. La cuenta nueva ve todas las tiendas, administra roles, restaura respaldos y puede subirle el rol a
  la cuenta original (reproducido).
- **Qué queda registrado:** nada sobre quién creó la cuenta. El usuario no guarda `creado_por` ni hay bitácora de altas.
- **Dónde:** `backend/server.js:1508-1510` (sin `requiereAlcanceGlobal` y sin límite de rol);
  `backend/usuarios.js:111-163` (`crearUsuario` copia `rol_id` y `sucursal_id` del cuerpo). Del mismo tipo:
  `POST /api/roles` (`server.js:1489`) solo pide `administrar_roles`, sin alcance global, y deja crear un rol con
  `ver_todas_las_sucursales` y cualquier otro permiso. En cambio editar, borrar y clonar roles sí piden alcance global
  (`server.js:1494-1502`).
- **Prueba:** `H1`.
- **Cómo se cierra:** el alta con rol de alcance global, y crear roles, tienen que exigir alcance global en el servidor.
  Quien no lo tenga solo puede dar de alta en su tienda y con roles que no den más de lo que tiene él. Y el alta guarda
  quién la hizo.

### A2. Cualquiera puede reemplazar la cuenta de Google Drive y la de MercadoLibre — ALTA — REPRODUCIDO (con Google y ML simulados)

- **Quién:** cualquier persona, **sin sesión**. Necesita el identificador público de la app de Google (o de ML), que
  aparece en la dirección que abre el botón "Conectar". Ese botón lo tiene el Gerente: `conectar_cuenta_drive` y
  `conectar_cuenta_ml` no están en su lista de exclusiones.
- **Qué hace:** abre la pantalla de autorización de Google con ese identificador, entra con **su propia** cuenta de
  Google, y Google lo regresa a `GET /api/drive/callback?code=...` del sistema. Esa ruta no pide sesión ni comprueba un
  `state` (el código que liga el regreso con quien empezó la conexión), así que guarda la cuenta del intruso como la
  cuenta del negocio. Con MercadoLibre es igual en `GET /api/ml/callback`.
- **Cuánto:**
  - Desde ese momento los **respaldos** (cifrados), los **expedientes de personal** (identificaciones, contratos) y los
    comprobantes de gastos, depósitos y garantías se suben al Drive del intruso. El negocio deja de tener respaldos y no
    se entera: el estado de Drive dice "conectado".
  - En ML el sistema queda leyendo publicaciones y órdenes de otra cuenta, y "Importar orden" crearía ventas en la
    sucursal 5 con mercancía de la tienda.
- **Qué queda registrado:** solo `conectado_en`, la fecha. No hay quién conectó.
- **Dónde:** `backend/server.js:1590-1603` y `3450-3463` (callbacks sin `requiereLogin` ni `state`);
  `backend/drive.js:27-49` y `105-116`; `backend/mercadolibre.js:28-51` y `80-83`.
- **Prueba:** `H2` y `H2b`. Se simula la respuesta de Google y de ML; lo reproducido es que el servidor acepta
  cualquier código y reemplaza la cuenta.
- **Límite de lo reproducido:** si la app de Google está en modo "prueba", Google solo deja autorizar a los correos de
  prueba registrados. Eso se ve en la consola de Google Cloud, a la que no tuve acceso. En ML no conozco una restricción
  equivalente.
- **Cómo se cierra:** el botón genera un `state` aleatorio ligado a la sesión de quien lo aprieta, y el callback rechaza
  lo que no lo traiga. Además se guarda quién conectó, y conectar o desconectar exige alcance global.

### A3. Las ventas no guardan quién las cobró — ALTA — REPRODUCIDO

- **Quién:** afecta a todas las ventas, del POS y las importadas de ML.
- **Qué pasa:** el registro de la venta (`DB.pos.ventas`) tiene sucursal, caja, vendedor, cliente y totales, pero
  **ningún usuario**. La persona que cobró solo aparece en los movimientos de inventario de los productos de catálogo.
  Las líneas de artículo rápido no dejan ningún rastro de persona, y las ventas importadas de ML se firman como
  "MercadoLibre".
- **Por qué importa:** el vendedor que se elige en caja es un dato de comisión, no de quién tocó la caja, y cualquiera
  con `cambiar_vendedor` (la Cajera lo trae) lo elige. Ante un faltante, una venta sospechosa o un uso de monedero (C1),
  la pregunta "¿quién la cobró?" no tiene respuesta en el sistema. Las cancelaciones sí guardan `cancelada_por` y
  autorizador, y los cortes, gastos y depósitos sí guardan usuario: la venta es el hueco.
- **Dónde:** `backend/ventas.js:314-335` (el objeto venta); `backend/ventas.js:167` y `356` (el usuario solo viaja al
  movimiento de inventario); `backend/mercadolibre.js:551`.
- **Prueba:** `H3` (afirma que la venta no tiene ningún campo de usuario o cajero).
- **Cómo se cierra:** guardar en la venta el id y el nombre del usuario **del token** (nunca del cuerpo), igual que ya se
  hace en cortes y gastos.

### M1. El campo "autorizador" de la cancelación sirve para adivinar contraseñas sin freno — MEDIA — REPRODUCIDO

- **Quién:** cualquiera con `cancelar_ventas` (el Gerente lo trae) y la pantalla Punto de Venta encendida.
- **Qué hace:** manda `PUT /api/ventas/<cualquier folio>/cancelar` con `autorizador: { usuario: "victor", password:
  "<intento>" }`, una y otra vez. El folio puede no existir: la contraseña se revisa antes de buscar la venta.
- **Cuánto:** la contraseña del Administrador o de cualquier cuenta con `autorizar_cancelaciones`. Las respuestas
  distinguen el error del acierto (403 contra 400), así que sirve de oráculo. Reproducido: 8 intentos fallidos seguidos,
  el noveno acierta, y el login de Victor **no** quedó bloqueado. Este campo no pasa por el freno de 5 intentos del login.
  bcrypt deja hacer unos 10 intentos por segundo por conexión: una contraseña débil cae en horas.
- **Qué queda registrado:** nada. Ni intentos fallidos ni bloqueo.
- **Dónde:** `backend/server.js:2050-2058`.
- **Prueba:** `H4`.
- **Cómo se cierra:** la verificación del autorizador tiene que contar fallos en el mismo cerrojo del login (o en uno
  propio por cuenta autorizadora), buscar la venta antes de mirar la contraseña y registrar los intentos fallidos.

### M2. El gerente de una tienda cambia el precio y el costo que usan las seis, sin dejar autor — MEDIA — REPRODUCIDO

- **Quién:** cualquiera con `editar_producto`. El Gerente lo trae, y está amarrado a su tienda.
- **Qué hace:** en Inventario → Productos edita los precios, o manda `PUT /api/productos/:id` con `precios`.
- **Cuánto:** el catálogo es uno solo para toda la cadena y el POS cobra siempre `precio_venta`
  (`backend/ventas.js:182-190`). Reproducido: el gerente de Yajalón dejó en $1 un producto que se vende en Ocosingo. Con
  eso cualquier cajera vende legalmente a ese precio, y después se puede regresar el precio original. El costo
  (`precio_compra`) también se cambia, y eso mueve la Utilidad de todas las tiendas.
- **Qué queda registrado:** el precio nuevo. **No** quién lo cambió, ni cuándo, ni el precio anterior. Borrar un producto
  ya exige alcance global por esta misma razón (`server.js:1164-1176`); editar su precio no.
- **Dónde:** `backend/server.js:1147-1162`; `backend/productos.js:265-322` (sin usuario).
- **Prueba:** `H5`.
- **Cómo se cierra:** Victor tiene que decidir si un gerente amarrado puede cambiar precios de toda la cadena. Si no,
  alcance global como en eliminar. En cualquier caso, cada cambio de precio o costo guarda quién, cuándo y el valor
  anterior.

### M3. Migración de Datos ajusta existencias y precios sin el permiso de ajuste y firma como "Importación SICAR" — MEDIA — REPRODUCIDO

- **Quién:** cualquiera con `migrar_datos`. El Gerente lo trae.
- **Qué hace:** en Migración de Datos sube un Excel de artículos, o manda `POST /api/migracion/aplicar` con
  `filas: [{ clave, existencia: 0 }]`.
- **Cuánto:** pone cualquier existencia de su tienda en el número que quiera, sin tener `ajustar_existencia`.
  Reproducido con un rol que solo tiene `migrar_datos`: 200 piezas pasaron a 0. Las mismas filas cambian precios y
  costos de todo el catálogo (pasan por `actualizarProducto`, ver M2).
- **Qué queda registrado:** un movimiento de inventario firmado `"Importación SICAR"`, no la persona que subió el archivo.
  El comentario del código lo hace a propósito: `backend/migracion.js:344-347`.
- **Dónde:** `backend/server.js:1342-1358`; `backend/migracion.js:336-349`.
- **Prueba:** `H6`.
- **Cómo se cierra:** la importación conserva la firma del proceso pero agrega quién subió el archivo (del token). Victor
  decide si cambiar existencias por importación debe exigir también `ajustar_existencia`.

### M4. Los cambios de roles, de personal, de configuración y de cuentas externas no dejan quién los hizo — MEDIA — REPRODUCIDO (roles y configuración) / SOLO LEÍDO (lo demás)

- **Quién:** cualquiera con los permisos de esas pantallas.
- **Qué pasa:** cambiarle el rol o la sucursal a una persona, darle un permiso a un rol, desactivar o borrar una cuenta,
  cambiar la configuración del POS y conectar o desconectar Drive o ML: ninguna de estas acciones deja registro de quién
  la hizo ni del valor anterior. Si mañana una cajera aparece con permiso de descuentos, el sistema no puede decir quién
  se lo dio. Por contraste, las coordenadas de las sucursales y las pantallas de caja sí llevan historial con usuario
  (`server.js:1836-1840`, `pantallasCaja.js:103`): el patrón ya existe.
- **Dónde:** `backend/roles.js:28-55`; `backend/usuarios.js:165-215` y `217-222`; `backend/configuracion.js:53-57`;
  `backend/server.js:3465-3469`.
- **Prueba:** `H12` (rol de usuario) y `H10` (configuración).
- **Cómo se cierra:** una bitácora de administración (quién, cuándo, antes y después) para roles, usuarios,
  configuración y cuentas externas.

### M5. El GPS del login lo manda el navegador — MEDIA — REPRODUCIDO

- **Quién:** cualquier usuario amarrado a una tienda.
- **Qué hace:** desde su casa, con la pestaña de Red o con `curl`, manda `POST /api/auth/login` con las coordenadas de
  la tienda (salen en Google Maps). El servidor solo compara los números que recibe.
- **Cuánto:** anula el control "solo se entra desde la tienda". Con eso puede hacer desde fuera todo lo que su rol
  permita.
- **Qué queda registrado:** un login normal. Los intentos bloqueados por GPS sí se guardan, pero este no se bloquea.
- **Dónde:** `backend/auth.js:311-350`; `backend/server.js:1422-1469`.
- **Prueba:** `H8`.
- **Cómo se cierra:** en el servidor no se puede verificar de verdad la posición de un navegador. Hay que decirle a
  Victor que el GPS es un disuasivo y no una barrera. Si se necesita una barrera real, hay que ligarla a algo que el
  empleado no pueda inventar, como la red de la tienda o un dispositivo registrado. Es decisión de Victor.

### B1. El token conserva la tienda vieja hasta 12 horas después de mover a alguien — BAJA — REPRODUCIDO

- **Quién:** una persona a la que se cambia de sucursal mientras tiene sesión abierta.
- **Qué pasa:** `requiereLogin` refresca el rol desde la base en cada petición, pero la sucursal no: la toma del token.
  Reproducido: una cajera movida de Ocosingo a Palenque sigue viendo y cobrando en Ocosingo con su sesión abierta.
- **Dónde:** `backend/auth.js:117-121` (decisión comentada en el código); `server.js:652-656`.
- **Prueba:** `H7`.
- **Cómo se cierra:** refrescar también `sucursal_id` en `configurarRevisionDeCuenta`, o invalidar la sesión al cambiar
  la sucursal de una cuenta.

### B2. Rutas por `:id` que todavía deciden el alcance con el selector del encabezado (regla 5) — BAJA — REPRODUCIDO

- **Quién:** afecta al Administrador, o a cualquiera con `ver_todas_las_sucursales`.
- **Qué pasa:** estas rutas usan `resolverAlcance(req)`, que lee `?sucursal_id=` (lo inyecta `src/api.js:49-51`). Con el
  encabezado en una tienda, el Administrador recibe "no encontrado" para registros de otra tienda que sí ve en las
  listas. **Falla cerrando**: no deja ver ni tocar de más a nadie. Es la misma trampa de la regla 5, del lado que niega.
- **Rutas:** `GET/PUT /api/clientes/:id` (`server.js:1631`, `1681`), `/api/crm/clientes/:id`, su estado y sus contactos
  (`1859-1899`), `GET /api/ventas/:id` (`2007`), `PUT /api/ventas/:id/caja` (`2070`), la cancelación de un Apartado por
  `/api/ventas/:id/cancelar` (`2036`), `/api/apartados/:id/abonos` y `/cancelar` (`2098`, `2109`), las seis rutas
  `/api/garantias/:id/*` (`2140-2183`), `PUT /api/gastos/:id/origen` y `/cancelar` (`2339`, `2348`, vía
  `alcanceSucursal`), `/api/depositos/:id/*` (`2413`, `2420`) y `PUT /api/condiciones-pago/:id` (`3363`).
- **Prueba:** `H9` (ventas y clientes).
- **Cómo se cierra:** usar `resolverAlcanceAutorizado` (que ya existe en `server.js:693`) en todas las rutas por `:id`.

### B3. La configuración del POS es global y la cambia un gerente amarrado, con cualquier llave — BAJA — REPRODUCIDO

- **Quién:** cualquiera con `editar_configuracion_pos` (el Gerente lo trae).
- **Qué pasa:** por ejemplo, apaga "permitir ventas sin existencia" en las seis tiendas. Además `actualizarConfiguracion`
  guarda cualquier llave que llegue (se probó con `campo_inventado`), salvo las de pantallas, que se rechazan a mano.
  Hoy ninguna llave de esa configuración mueve dinero directo, pero una llave nueva entraría abierta.
- **Dónde:** `backend/server.js:2226-2233`; `backend/configuracion.js:53-57`.
- **Prueba:** `H10`.
- **Cómo se cierra:** lista de llaves permitidas en el servidor; alcance global si la configuración es de toda la
  cadena; bitácora (M4).

### B4. Un permiso de VER predicciones escribe el historial de ventas — BAJA — REPRODUCIDO

- **Quién:** cualquiera con `ver_predicciones`.
- **Qué pasa:** `POST /api/predicciones/historial/aplicar` reemplaza el historial mensual de ventas de su tienda.
  Reproducido: 9,999 piezas de un producto en enero, sin usuario. No mueve dinero, pero sí lo que el sistema recomienda
  comprar. Es un permiso prestado de "ver" para escribir.
- **Dónde:** `backend/server.js:1093-1119`.
- **Prueba:** `H11`.
- **Cómo se cierra:** permiso propio para importar historial, registrado en el catálogo.

### B5. El asistente de IA predice con las ventas de todas las tiendas aunque el usuario esté amarrado — BAJA — SOLO LEÍDO

- **Quién:** cualquiera con `usar_asistente_ia` (la Cajera lo trae).
- **Qué pasa:** la herramienta `predecir_demanda` del chat recibe el DB completo, sin el recorte por sucursal que sí hace
  `GET /api/predicciones`. Una cajera le pregunta al asistente cuánto se vende de un producto y la respuesta mezcla las
  seis tiendas.
- **Dónde:** `backend/server.js:3408` (contra `1070-1090`).
- **Cómo se cierra:** pasarle a la herramienta el mismo DB recortado que usa la ruta de predicciones.
- **No reproducido** porque requiere la llave de Anthropic.

### B6. Las órdenes de MercadoLibre, con datos de compradores, las lee cualquier sesión — BAJA — SOLO LEÍDO

- **Quién:** cualquier usuario con sesión, sin permiso de ML.
- **Qué pasa:** `GET /api/ml/ordenes` devuelve las órdenes tal como las entrega ML (con el comprador incluido) y solo pide
  sesión. `GET /api/ml/publicaciones` es igual.
- **Dónde:** `backend/server.js:3471-3478` y `3495-3498`; `backend/mercadolibre.js:231-241`.
- **Cómo se cierra:** exigir `importar_ordenes_ml` (o un permiso de ver ML) en esas lecturas.
- **No reproducido** porque requiere una cuenta de ML conectada.

### B7. "Es Administrador" se decide por el NOMBRE del rol en SICAR, y la lista de personal no tiene alcance — BAJA — SOLO LEÍDO

- **Qué pasa:**
  - El permiso de SICAR para resolver vínculos ajenos pregunta si el rol **se llama** "Administrador" en vez de mirar
    sus permisos (`backend/server.js:708`, usado en `backend/sicarVinculos.js:121`). Cualquier rol creado con ese nombre
    —y crear roles no exige alcance global (A1)— pasa ese control.
  - `GET /api/usuarios` (`server.js:1505`) devuelve todo el personal de las seis tiendas a quien tenga
    `administrar_roles`, aunque esté amarrado.
- **Cómo se cierra:** decidir por permiso (`ver_todas_las_sucursales`) y no por nombre, y recortar la lista de personal
  por alcance de token.

### B8. Permisos prestados en el catálogo de inventario — BAJA — SOLO LEÍDO

- **Qué pasa:** crear categorías, proveedores y departamentos usa `crear_producto` (`backend/server.js:1385`, `1391`,
  `1401`). No mueve dinero, pero va contra la convención del repo: cada acción, su permiso.
- **Cómo se cierra:** permiso propio en `permisosCatalogo.js`, o dejarlo así con una decisión explícita de Victor.

### B9. Cancelar un apartado no pide autorizador; cancelar una venta sí — BAJA — SOLO LEÍDO

- **Quién:** cualquiera con `gestionar_apartados` (por `/api/apartados/:id/cancelar`) o con `cancelar_ventas` (si el
  folio es un Apartado).
- **Qué pasa:** el anticipo pasa al monedero del cliente y la mercancía regresa a existencia sin segunda firma. La
  cancelación sí guarda `cancelada_por` (`backend/apartados.js:362`). Solo se vuelve grave combinado con C1: alguien
  cancela el apartado de un cliente y luego gasta ese monedero.
- **Dónde:** `backend/server.js:2043-2045` y `2109-2118`.
- **Cómo se cierra:** que Victor decida si la cancelación de apartados requiere el mismo autorizador que la de ventas.
  Puede ser una decisión ya tomada; no la encontré escrita.

## 3. Lo que se revisó y está bien

Para que no se vuelva a revisar:

- **Sesión viva.** `requiereLogin` (`backend/auth.js:85-128`) consulta la cuenta en cada petición: desactivar o borrar a
  alguien lo saca a la siguiente petición, y el cambio de rol surte efecto inmediato (salvo la sucursal, B1). Restaurar
  un respaldo invalida todos los tokens (`server.js:3250`).
- **Token.** Firmado con `JWT_SECRET` del entorno o aleatorio por arranque, nunca uno fijo en el repo (`auth.js:27`).
  Usuario y rol salen del token, no del cuerpo, en ventas, cortes, gastos, depósitos, ajustes, traspasos, cancelaciones,
  garantías y objetivos (por ejemplo `server.js:1227`, `2282`, `2327`, `2405`).
- **Freno de fuerza bruta en el login:** 5 fallos y 15 minutos, por usuario normalizado (`backend/intentosLogin.js`).
  Restaurar respaldos y la descarga por token tienen su propio freno (`server.js:460`, `3290-3308`). Solo falta el del
  autorizador (M1).
- **Alcance para escribir:** `sucursalDeEscritura` (`auth.js:237-246`) fuerza la tienda del token a quien está
  amarrado. `alcanceSucursal` falla cerrando con basura en `?sucursal_id=` (`auth.js:197-215`). Gastos y depósitos
  toman la sucursal del token, y la caja declarada se valida contra ella.
- **Rutas con alcance global obligatorio:** eliminar y reactivar producto, editar, borrar y clonar roles, editar y
  borrar usuarios, alta de sucursal, coordenadas, respaldar ahora, comparar y restaurar (ver la tabla del anexo).
- **Validaciones de POS en el servidor:** descuento (`ventas.js:168`, `232-239`), artículo rápido (`ventas.js:202`),
  tipo de documento (`ventas.js:42`), precio contra catálogo (`ventas.js:182-190`), vendedor de la misma tienda
  (`ventas.js:139-146`). La cancelación de una venta normal exige un autorizador distinto de quien cancela, con
  `autorizar_cancelaciones` y de la misma tienda o global (`server.js:2050-2064`).
- **Alcance por token (regla 5 bien aplicada):** expedientes (`server.js:1549-1568`), vendedores y Gerencia de Ventas
  (`server.js:2431-2511`), objetivos (`server.js:2609-2613`), CRM v2 (`server.js:1922-1930`), bandeja
  (`bandejaRutas.js:15-31`), SICAR (`sicarRutas.js:116-208`), Cinco Caminos, supervisión y metas.
- **Rutas sin sesión** (todas revisadas): `/api/salud`, `/api/auth/necesita-setup`, `/api/auth/setup-inicial` (solo
  responde si no existe ningún usuario), `/api/auth/login`, `/api/sucursales` (oculta coordenadas salvo con
  `administrar_roles`), `/api/respaldos/indice` y `/descargar` (token en tiempo constante, freno, 404 indistinguible) y
  los dos callbacks de OAuth (A2). El agente SICAR (`/api/integraciones/sicar`) usa llave por tienda con ritmo limitado.
- **Asistente IA:** `consultarModulo` solo expone tablas permitidas, sin `admin.usuarios` ni tokens de Drive o ML
  (`server.js:557-562`). La excepción es B5.
- **Validador de arranque y catálogo:** todos los módulos tienen permisos y todos los permisos apuntan a un módulo
  existente (`backend/validarPermisos.js`). La reconciliación solo del rol Administrador es una decisión tomada y no se
  reporta.

## 4. Lo que no se pudo revisar

- **Prueba en navegador.** En esta sesión en la nube no hay Claude in Chrome. Las pantallas se compararon solo leyendo
  `src/` (`src/api.js`, `src/PuntoDeVenta.jsx`, `src/AdminRoles.jsx`). C1 en su versión "en pantalla" (botón "Aplicar
  monedero" con un cliente de la propia tienda) está leído, no clicado.
- **OAuth real.** A2 se reprodujo simulando la respuesta de Google y de ML. No pude ver si la app de Google está en modo
  "prueba" (eso limitaría quién puede autorizar). Lo tiene que revisar Victor en la consola de Google Cloud.
- **Configuración real de roles en producción.** No tuve acceso a la base de producción. La gravedad de A1, M2, M3, B3 y
  B4 depende de a quién le haya dado Victor esos permisos. Los roles de fábrica están en `backend/roles.js:63-105`.
- **Asistente IA y MercadoLibre en vivo** (B5, B6): sin llaves de Anthropic ni de ML.
- **El agente SICAR del lado de la tienda** (`agente-sicar/`) y la lógica interna de dinero: fuera de alcance por
  instrucción.
- **Suite completa:** `cd backend && node --test` dio 3433 pruebas: 3426 pasan, 5 fallan y 2 quedan como `todo`. Las 5
  fallas son `clavesSat.test.js` (4) y "ARRANQUE REAL: en desarrollo SÍ se tolera" de `arranquePersistencia.test.js`.
  Todas dicen `SQLITE_CANTOPEN: unable to open database file`: falta la base del catálogo SAT, que no viene en un clon
  nuevo. No las investigué más porque no son de permisos, pero **no es la línea base de 0 fallas** que pide `CLAUDE.md`.
- La tabla del anexo se armó con un script que lee las líneas de cada ruta. Revisé a mano todas las marcadas, pero en las
  rutas donde la columna "Alcance" dice "—" el alcance puede resolverse dentro de la función de dominio (por ejemplo
  metas, supervisión o la junta de Cinco Caminos, que revisé y sí lo resuelven por token).

## Anexo. Tabla ruta → permiso → alcance

Leyenda de la columna "Alcance":

- `token`: el alcance sale de quien pregunta (correcto para `:id`).
- `global`: exige `ver_todas_las_sucursales`.
- `selector/token`: `alcanceSucursal` (amarrado → token; global → filtra por el encabezado). Correcto para listas.
- `SELECTOR (:id)`: `resolverAlcance(req)`, que lee el encabezado. En rutas por `:id` es el defecto B2.
- `escritura`: `sucursalDeEscritura`.
- `formulario`: `sucursalDelFormulario`.
- `—`: no se detectó en la línea de la ruta.

Marcas de hallazgo:

| Ruta | Hallazgo |
|---|---|
| `POST /api/ventas` | C1, A3 |
| `POST /api/usuarios`, `POST /api/roles` | A1 |
| `GET /api/drive/callback`, `GET /api/ml/callback` | A2 |
| `PUT /api/ventas/:id/cancelar` | M1 |
| `PUT /api/productos/:id` | M2 |
| `POST /api/migracion/aplicar` | M3 |
| `PUT /api/configuracion` | B3 |
| `POST /api/predicciones/historial/aplicar` | B4 |
| `POST /api/chat` | B5 |
| `GET /api/ml/ordenes`, `GET /api/ml/publicaciones` | B6 |
| `GET /api/usuarios`, rutas SICAR de vínculos | B7 |
| `POST /api/categorias`, `/proveedores`, `/departamentos` | B8 |
| Filas `SELECTOR (:id)` en rutas por `:id` | B2 |

| Archivo:línea | Método | Ruta | Sesión | Permiso | Alcance |
|---|---|---|---|---|---|
| server.js:700 | GET | `/api/sicar/respaldo` | sí | ver_sincronizacion_sicar | — |
| server.js:749 | GET | `/api/salud` | **NO** | — | — |
| server.js:798 | GET | `/api/radar-demanda/proveedores` | sí | registrar_demanda o ver_radar_demanda | — |
| server.js:803 | GET | `/api/radar-demanda` | sí | ver_radar_demanda | SELECTOR (:id) |
| server.js:808 | GET | `/api/radar-demanda/meta` | sí | ver_radar_demanda | — |
| server.js:816 | POST | `/api/radar-demanda` | sí | registrar_demanda | SELECTOR (:id) + escritura |
| server.js:842 | GET | `/api/radar-demanda/resumen` | sí | ver_resumen_demanda | SELECTOR (:id) |
| server.js:847 | GET | `/api/radar-demanda/analisis` | sí | ver_resumen_demanda | SELECTOR (:id) |
| server.js:966 | GET | `/api/radar-demanda/inteligencia` | sí | ver_resumen_demanda | SELECTOR (:id) |
| server.js:985 | GET | `/api/radar-demanda/pedidos-marcados` | sí | ver_resumen_demanda | token |
| server.js:995 | POST | `/api/radar-demanda/pedidos-marcados` | sí | marcar_pedido_proveedor | token |
| server.js:1007 | DELETE | `/api/radar-demanda/pedidos-marcados` | sí | marcar_pedido_proveedor | token |
| server.js:1023 | GET | `/api/radar-demanda/:id/ventas-candidatas` | sí | cerrar_demanda | token |
| server.js:1030 | GET | `/api/radar-demanda/:id` | sí | ver_radar_demanda | token |
| server.js:1038 | PATCH | `/api/radar-demanda/:id` | sí | dar_seguimiento_demanda / cerrar_demanda | token |
| server.js:1054 | POST | `/api/radar-demanda/:id/seguimientos` | sí | dar_seguimiento_demanda | token |
| server.js:1062 | GET | `/api/radar-demanda/:id/historial` | sí | ver_radar_demanda | token |
| server.js:1070 | GET | `/api/predicciones` | sí | ver_predicciones | selector/token |
| server.js:1093 | POST | `/api/predicciones/historial/previsualizar` | sí | ver_predicciones | — |
| server.js:1103 | POST | `/api/predicciones/historial/aplicar` | sí | ver_predicciones | formulario |
| server.js:1122 | GET | `/api/productos` | sí | — | selector/token |
| server.js:1135 | POST | `/api/productos` | sí | crear_producto | selector/token + escritura |
| server.js:1147 | PUT | `/api/productos/:id` | sí | editar_producto | selector/token + escritura |
| server.js:1174 | DELETE | `/api/productos/:id` | sí | eliminar_producto | global |
| server.js:1181 | POST | `/api/productos/:id/reactivar` | sí | eliminar_producto | global |
| server.js:1186 | POST | `/api/productos/:id/clonar` | sí | clonar_producto | selector/token + escritura |
| server.js:1205 | GET | `/api/productos/:id/movimientos` | sí | — | selector/token |
| server.js:1216 | POST | `/api/productos/:id/ajustar` | sí | ajustar_existencia | selector/token + escritura |
| server.js:1231 | GET | `/api/productos/generar-clave` | sí | — | — |
| server.js:1234 | GET | `/api/traspasos` | sí | realizar_traspasos | selector/token |
| server.js:1239 | POST | `/api/traspasos` | sí | realizar_traspasos | selector/token + escritura |
| server.js:1252 | POST | `/api/traspasos/:id/recibir` | sí | realizar_traspasos | selector/token |
| server.js:1262 | GET | `/api/compras` | sí | recibir_compra | selector/token |
| server.js:1267 | POST | `/api/compras` | sí | recibir_compra | selector/token + escritura |
| server.js:1278 | POST | `/api/compras/importar-xml` | sí | recibir_compra | — |
| server.js:1286 | POST | `/api/compras/importar-ia` | sí | recibir_compra | — |
| server.js:1314 | POST | `/api/migracion/previsualizar` | sí | migrar_datos | formulario |
| server.js:1342 | POST | `/api/migracion/aplicar` | sí | migrar_datos | formulario |
| server.js:1360 | GET | `/api/migracion/exportar` | sí | migrar_datos | formulario |
| server.js:1380 | GET | `/api/productos/:id/historial-costo` | sí | recibir_compra | — |
| server.js:1384 | GET | `/api/categorias` | sí | — | — |
| server.js:1385 | POST | `/api/categorias` | sí | crear_producto | — |
| server.js:1390 | GET | `/api/proveedores` | sí | — | — |
| server.js:1391 | POST | `/api/proveedores` | sí | crear_producto | — |
| server.js:1396 | GET | `/api/sat/claves` | sí | — | — |
| server.js:1400 | GET | `/api/departamentos` | sí | — | — |
| server.js:1401 | POST | `/api/departamentos` | sí | crear_producto | — |
| server.js:1408 | GET | `/api/auth/necesita-setup` | **NO** | — | — |
| server.js:1410 | POST | `/api/auth/setup-inicial` | **NO** | — | — |
| server.js:1422 | POST | `/api/auth/login` | **NO** | — | — |
| server.js:1471 | GET | `/api/auth/yo` | sí | — | — |
| server.js:1480 | GET | `/api/permisos-catalogo` | sí | administrar_roles | — |
| server.js:1488 | GET | `/api/roles` | sí | administrar_roles | — |
| server.js:1489 | POST | `/api/roles` | sí | administrar_roles | — |
| server.js:1494 | PUT | `/api/roles/:id` | sí | administrar_roles | global |
| server.js:1497 | DELETE | `/api/roles/:id` | sí | administrar_roles | global |
| server.js:1500 | POST | `/api/roles/:id/clonar` | sí | administrar_roles | global |
| server.js:1505 | GET | `/api/usuarios` | sí | administrar_roles | — |
| server.js:1508 | POST | `/api/usuarios` | sí | dar_alta_personal | — |
| server.js:1513 | PUT | `/api/usuarios/:id` | sí | administrar_roles | global |
| server.js:1522 | DELETE | `/api/usuarios/:id` | sí | administrar_roles | global |
| server.js:1570 | GET | `/api/drive/estado` | sí | — | — |
| server.js:1582 | GET | `/api/drive/auth-url` | sí | conectar_cuenta_drive | — |
| server.js:1590 | GET | `/api/drive/callback` | **NO** | — | — |
| server.js:1605 | POST | `/api/usuarios/:id/documentos` | sí | gestionar_expedientes | token |
| server.js:1613 | GET | `/api/usuarios/:id/documentos` | sí | gestionar_expedientes | token |
| server.js:1618 | DELETE | `/api/usuarios/:id/documentos/:documentoId` | sí | gestionar_expedientes | token |
| server.js:1627 | GET | `/api/clientes` | sí | — | selector/token |
| server.js:1631 | GET | `/api/clientes/:id` | sí | — | SELECTOR (:id) |
| server.js:1658 | POST | `/api/clientes` | sí | crear_cliente | token + selector/token + escritura |
| server.js:1681 | PUT | `/api/clientes/:id` | sí | editar_cliente | token + SELECTOR (:id) |
| server.js:1734 | GET | `/api/vendedores` | sí | (dentro) editar_objetivos_venta | token |
| server.js:1765 | GET | `/api/sucursales` | **NO** | (dentro) administrar_roles | — |
| server.js:1779 | POST | `/api/sucursales` | sí | administrar_sucursales | global |
| server.js:1808 | GET | `/api/cajas` | sí | — | selector/token |
| server.js:1820 | PUT | `/api/sucursales/:id/ubicacion` | sí | administrar_roles | global |
| server.js:1849 | GET | `/api/intentos-bloqueados` | sí | administrar_roles | — |
| server.js:1855 | GET | `/api/crm/clientes` | sí | — | selector/token |
| server.js:1859 | GET | `/api/crm/clientes/:id` | sí | — | SELECTOR (:id) |
| server.js:1870 | PUT | `/api/crm/clientes/:id/estado` | sí | cambiar_estado_cliente | SELECTOR (:id) |
| server.js:1883 | GET | `/api/crm/clientes/:id/contactos` | sí | — | SELECTOR (:id) |
| server.js:1891 | POST | `/api/crm/clientes/:id/contactos` | sí | registrar_contacto_cliente | SELECTOR (:id) |
| server.js:1901 | GET | `/api/crm/resumen-sucursales` | sí | — | selector/token |
| server.js:1905 | GET | `/api/crm/postventa-pendientes` | sí | — | selector/token |
| server.js:1910 | GET | `/api/crm/apartados-por-vencer` | sí | — | selector/token |
| server.js:1914 | GET | `/api/crm/ranking-vendedores` | sí | — | selector/token |
| server.js:1941 | GET | `/api/crm/v2/clientes` | sí | — | token |
| server.js:1942 | GET | `/api/crm/v2/clientes/:ref` | sí | — | token |
| server.js:1943 | GET | `/api/crm/v2/clientes/:ref/compras` | sí | — | token |
| server.js:1945 | GET | `/api/crm/v2/compras/:ref` | sí | — | token |
| server.js:1946 | GET | `/api/crm/v2/resumen` | sí | — | token |
| server.js:2000 | GET | `/api/ventas` | sí | ver_lista_ventas | selector/token |
| server.js:2007 | GET | `/api/ventas/:id` | sí | mostrar_detalle_venta | SELECTOR (:id) |
| server.js:2017 | POST | `/api/ventas` | sí | cerrar_venta | selector/token + escritura |
| server.js:2033 | PUT | `/api/ventas/:id/cancelar` | sí | cancelar_ventas | token + SELECTOR (:id) |
| server.js:2070 | PUT | `/api/ventas/:id/caja` | sí | cambiar_caja_venta | SELECTOR (:id) |
| server.js:2083 | GET | `/api/apartados` | sí | gestionar_apartados | selector/token |
| server.js:2087 | POST | `/api/apartados` | sí | gestionar_apartados | selector/token + escritura |
| server.js:2098 | POST | `/api/apartados/:id/abonos` | sí | gestionar_apartados | SELECTOR (:id) |
| server.js:2109 | PUT | `/api/apartados/:id/cancelar` | sí | gestionar_apartados | SELECTOR (:id) |
| server.js:2121 | GET | `/api/garantias` | sí | gestionar_garantias | SELECTOR (:id) |
| server.js:2126 | POST | `/api/garantias` | sí | gestionar_garantias | SELECTOR (:id) + escritura |
| server.js:2140 | PUT | `/api/garantias/:id/enviar` | sí | gestionar_garantias | SELECTOR (:id) |
| server.js:2148 | PUT | `/api/garantias/:id/ubicacion` | sí | gestionar_garantias | SELECTOR (:id) |
| server.js:2156 | PUT | `/api/garantias/:id/resolucion` | sí | gestionar_garantias | SELECTOR (:id) |
| server.js:2164 | PUT | `/api/garantias/:id/recibir` | sí | gestionar_garantias | SELECTOR (:id) |
| server.js:2172 | PUT | `/api/garantias/:id/entregar-cliente` | sí | gestionar_garantias | SELECTOR (:id) |
| server.js:2185 | GET | `/api/garantias/:id/gastos` | sí | gestionar_garantias | token |
| server.js:2192 | POST | `/api/garantias/:id/gastos` | sí | gestionar_garantias | token |
| server.js:2202 | DELETE | `/api/garantias/:id/gastos/:gastoId` | sí | gestionar_garantias | token |
| server.js:2210 | GET | `/api/garantias/:id/cobros` | sí | gestionar_garantias | token |
| server.js:2216 | POST | `/api/garantias/:id/cobros` | sí | gestionar_garantias | token |
| server.js:2225 | GET | `/api/configuracion` | sí | — | — |
| server.js:2226 | PUT | `/api/configuracion` | sí | editar_configuracion_pos | — |
| server.js:2234 | GET | `/api/configuracion/pantallas` | sí | (dentro) activar_pantallas_caja | — |
| server.js:2239 | PUT | `/api/configuracion/pantallas` | sí | activar_pantallas_caja | — |
| server.js:2247 | GET | `/api/cortes/en-curso` | sí | — | selector/token + escritura |
| server.js:2263 | GET | `/api/cortes` | sí | ver_historial_cortes | selector/token |
| server.js:2267 | POST | `/api/cortes` | sí | realizar_corte_caja | selector/token + escritura |
| server.js:2291 | GET | `/api/gastos` | sí | ver_gastos | selector/token |
| server.js:2297 | POST | `/api/gastos` | sí | registrar_gastos | token |
| server.js:2339 | PUT | `/api/gastos/:id/origen` | sí | registrar_gasto_caja_fuerte | selector/token |
| server.js:2348 | PUT | `/api/gastos/:id/cancelar` | sí | cancelar_gastos | selector/token |
| server.js:2363 | GET | `/api/gastos/categorias` | sí | (dentro) ver_gastos o ver_reportes | — |
| server.js:2371 | POST | `/api/gastos/categorias` | sí | administrar_categorias_gastos | — |
| server.js:2376 | PUT | `/api/gastos/categorias/:id` | sí | administrar_categorias_gastos | — |
| server.js:2383 | GET | `/api/gastos/:id/movimientos` | sí | ver_gastos | selector/token |
| server.js:2392 | GET | `/api/estado-cuenta` | sí | ver_estado_cuenta | selector/token |
| server.js:2397 | GET | `/api/depositos` | sí | ver_estado_cuenta | selector/token |
| server.js:2402 | POST | `/api/depositos` | sí | registrar_depositos | token |
| server.js:2413 | POST | `/api/depositos/:id/comprobante` | sí | registrar_depositos | selector/token |
| server.js:2420 | PUT | `/api/depositos/:id/cancelar` | sí | cancelar_depositos | selector/token |
| server.js:2431 | GET | `/api/vendedores/catalogo` | sí | administrar_vendedores | token |
| server.js:2440 | POST | `/api/vendedores` | sí | administrar_vendedores | token |
| server.js:2451 | PUT | `/api/vendedores/:id` | sí | administrar_vendedores | token |
| server.js:2463 | PUT | `/api/vendedores/:id/desactivar` | sí | administrar_vendedores | token |
| server.js:2513 | GET | `/api/gerente-ventas/:vendedorId` | sí | usar_gerente_ventas | token |
| server.js:2536 | GET | `/api/gerente-ventas/mi/vendedor` | sí | usar_gerente_ventas | — |
| server.js:2543 | PUT | `/api/gerente-ventas/:vendedorId/tareas/:tareaId` | sí | usar_gerente_ventas | token |
| server.js:2553 | PUT | `/api/gerente-ventas/:vendedorId/meta` | sí | editar_objetivos_venta | token |
| server.js:2572 | GET | `/api/gerente-ventas/:vendedorId/sugerencia-meta` | sí | editar_objetivos_venta | token |
| server.js:2586 | GET | `/api/gerente-ventas` | sí | editar_objetivos_venta | token |
| server.js:2668 | GET | `/api/objetivos/catalogo-actividades` | sí | usar_gerente_ventas | — |
| server.js:2672 | GET | `/api/objetivos/catalogo/:lista` | sí | (dentro) editar_objetivos_venta o usar_gerente_ventas | — |
| server.js:2684 | POST | `/api/objetivos/catalogo/:lista` | sí | editar_objetivos_venta | — |
| server.js:2693 | POST | `/api/objetivos/catalogo/:lista/:id/desactivar` | sí | editar_objetivos_venta | — |
| server.js:2703 | GET | `/api/objetivos/financieras` | sí | usar_gerente_ventas | — |
| server.js:2707 | GET | `/api/objetivos/mis-tiendas/:mes` | sí | usar_gerente_ventas | — |
| server.js:2723 | GET | `/api/objetivos/:mes/:sucursalId/avance` | sí | usar_gerente_ventas | token |
| server.js:2752 | GET | `/api/objetivos/:mes/:sucursalId` | sí | usar_gerente_ventas | token |
| server.js:2811 | POST | `/api/objetivos` | sí | editar_objetivos_venta | token |
| server.js:2824 | POST | `/api/objetivos/retirar` | sí | editar_objetivos_venta | token |
| server.js:2834 | GET | `/api/objetivos/:mes/:sucursalId/historial/:vendedorId` | sí | editar_objetivos_venta | token |
| server.js:2844 | GET | `/api/objetivos/:mes/:sucursalId/sugerencia` | sí | editar_objetivos_venta | token |
| server.js:2853 | POST | `/api/objetivos/plantilla` | sí | editar_objetivos_venta | token |
| server.js:2863 | POST | `/api/objetivos/plantilla/:id/baja` | sí | editar_objetivos_venta | token |
| server.js:2875 | GET | `/api/objetivos/:mes/:sucursalId/capturas/:vendedorId` | sí | usar_gerente_ventas | token |
| server.js:2910 | POST | `/api/objetivos/captura` | sí | usar_gerente_ventas | token |
| server.js:2923 | POST | `/api/objetivos/captura/:id/corregir` | sí | usar_gerente_ventas | token |
| server.js:2939 | GET | `/api/objetivos/:mes/:sucursalId/creditos/:vendedorId` | sí | usar_gerente_ventas | token |
| server.js:2958 | GET | `/api/objetivos/:mes/:sucursalId/creditos` | sí | (dentro) editar_objetivos_venta o cerrar_mes_objetivos | token |
| server.js:2981 | POST | `/api/objetivos/credito` | sí | usar_gerente_ventas | token |
| server.js:2994 | POST | `/api/objetivos/credito/:id/anular` | sí | usar_gerente_ventas | token |
| server.js:3008 | GET | `/api/objetivos/:mes/:sucursalId/actividades/:vendedorId` | sí | usar_gerente_ventas | token |
| server.js:3030 | GET | `/api/objetivos/:mes/:sucursalId/actividades` | sí | (dentro) editar_objetivos_venta o cerrar_mes_objetivos | token |
| server.js:3053 | POST | `/api/objetivos/actividad` | sí | usar_gerente_ventas | token |
| server.js:3069 | POST | `/api/objetivos/actividad/:id/anular` | sí | usar_gerente_ventas | token |
| server.js:3083 | POST | `/api/objetivos/actividad/:id/resultado` | sí | usar_gerente_ventas | token |
| server.js:3096 | GET | `/api/objetivos/:mes/:sucursalId/retiradas` | sí | cerrar_mes_objetivos | token |
| server.js:3105 | GET | `/api/objetivos/:mes/:sucursalId/previo-cierre` | sí | cerrar_mes_objetivos | token |
| server.js:3113 | GET | `/api/objetivos/:mes/:sucursalId/cierre` | sí | cerrar_mes_objetivos | token |
| server.js:3124 | POST | `/api/objetivos/cierre` | sí | cerrar_mes_objetivos | token |
| server.js:3135 | POST | `/api/objetivos/cierre/:id/rectificar` | sí | cerrar_mes_objetivos | token |
| server.js:3174 | GET | `/api/respaldos` | sí | ver_respaldos | — |
| server.js:3183 | GET | `/api/respaldos/estado` | sí | ver_respaldos | — |
| server.js:3192 | POST | `/api/respaldos/ahora` | sí | crear_respaldo | global |
| server.js:3204 | GET | `/api/respaldos/:id/comparar` | sí | restaurar_respaldo | global |
| server.js:3212 | POST | `/api/respaldos/:id/restaurar` | sí | restaurar_respaldo | global |
| server.js:3313 | GET | `/api/respaldos/indice` | **NO** | — | — |
| server.js:3332 | GET | `/api/respaldos/:id/descargar` | **NO** | — | — |
| server.js:3351 | GET | `/api/condiciones-pago` | sí | — | SELECTOR (:id) |
| server.js:3363 | PUT | `/api/condiciones-pago/:id` | sí | editar_configuracion_pos | SELECTOR (:id) |
| server.js:3368 | POST | `/api/chat` | sí | usar_asistente_ia | selector/token |
| server.js:3432 | GET | `/api/ml/estado` | sí | — | — |
| server.js:3442 | GET | `/api/ml/auth-url` | sí | conectar_cuenta_ml | — |
| server.js:3450 | GET | `/api/ml/callback` | **NO** | — | — |
| server.js:3465 | DELETE | `/api/ml/desconectar` | sí | conectar_cuenta_ml | — |
| server.js:3471 | GET | `/api/ml/publicaciones` | sí | — | — |
| server.js:3476 | GET | `/api/ml/publicaciones/locales` | sí | — | — |
| server.js:3480 | POST | `/api/ml/publicar` | sí | gestionar_publicaciones_ml | — |
| server.js:3485 | PUT | `/api/ml/publicaciones/:itemId/stock` | sí | gestionar_publicaciones_ml | — |
| server.js:3490 | PUT | `/api/ml/publicaciones/:itemId` | sí | gestionar_publicaciones_ml | — |
| server.js:3495 | GET | `/api/ml/ordenes` | sí | — | — |
| server.js:3500 | POST | `/api/ml/ordenes/:ordenId/importar` | sí | importar_ordenes_ml | — |
| server.js:3505 | GET | `/api/ml/pendientes-vinculo` | sí | importar_ordenes_ml | — |
| server.js:3511 | POST | `/api/ml/pendientes-vinculo/:id/vincular` | sí | importar_ordenes_ml | — |
| server.js:3519 | GET | `/api/ml/item-imagen/:itemId` | sí | — | — |
| server.js:3536 | GET | `/api/reportes/ventas` | sí | ver_reportes | selector/token |
| server.js:3542 | GET | `/api/reportes/utilidad` | sí | ver_reportes | selector/token |
| server.js:3548 | GET | `/api/reportes/compras` | sí | ver_reportes | selector/token |
| server.js:3554 | GET | `/api/reportes/cortes-caja` | sí | ver_reportes | selector/token |
| server.js:3560 | GET | `/api/reportes/cancelaciones` | sí | ver_reportes | selector/token |
| server.js:3566 | GET | `/api/reportes/existencias` | sí | ver_reportes | selector/token |
| server.js:3572 | GET | `/api/reportes/clientes` | sí | ver_reportes | selector/token |
| server.js:3578 | GET | `/api/reportes/movimientos-caja` | sí | ver_reportes | selector/token |
| server.js:3584 | GET | `/api/reportes/gastos-garantias` | sí | ver_reportes | selector/token |
| server.js:3590 | GET | `/api/reportes/gastos` | sí | ver_reportes | selector/token |
| sicarRutas.js:132 | GET | `/api/sicar/vinculos` | sí | resolver_vinculos_sicar | token |
| sicarRutas.js:135 | POST | `/api/sicar/vinculos/:sucursal/:cliId/resolver` | sí | resolver_vinculos_sicar | token |
| sicarRutas.js:139 | GET | `/api/sicar/llaves` | sí | administrar_llaves_sicar | token |
| sicarRutas.js:142 | POST | `/api/sicar/llaves` | sí | administrar_llaves_sicar | token |
| sicarRutas.js:155 | POST | `/api/sicar/llaves/:id/revocar` | sí | administrar_llaves_sicar | token |
| sicarRutas.js:161 | GET | `/api/sicar/envios` | sí | ver_sincronizacion_sicar | token |
| sicarRutas.js:170 | GET | `/api/sicar/existencias` | sí | ver_existencias_sicar | token |
| sicarRutas.js:178 | GET | `/api/sicar/traspasos` | sí | ver_traspasos_sicar | token |
| sicarRutas.js:182 | GET | `/api/sicar/sucursales-mapa` | sí | ver_traspasos_sicar | token |
| sicarRutas.js:187 | PUT | `/api/sicar/sucursales-mapa` | sí | administrar_sucursales | token |
| sicarRutas.js:192 | GET | `/api/sicar/cortes` | sí | ver_cortes_sicar | token |
| sicarRutas.js:196 | GET | `/api/sicar/personal` | sí | ver_cortes_sicar | token |
| sicarRutas.js:202 | PUT | `/api/sicar/personal/:sucursal_id/:usu_id` | sí | asignar_cajeros_sicar | token |
| crmSeguimientoRutas.js:7 | PUT | `/api/crm/v2/clientes/:ref/estado` | sí | cambiar_estado_cliente | token |
| crmComprasPerfilRutas.js:6 | GET | `/api/crm/v2/clientes/:ref/que-compra` | sí | — | token |
| crmComprasPerfilRutas.js:8 | PUT | `/api/crm/v2/clientes/:ref/cuenta-interna` | sí | marcar_cuenta_interna | token |
| bandejaRutas.js:41 | GET | `/api/mensajes/conversaciones` | sí | ver_bandeja | token |
| bandejaRutas.js:43 | GET | `/api/mensajes/conversaciones/:id` | sí | ver_bandeja | token |
| bandejaRutas.js:46 | POST | `/api/mensajes/conversaciones/:id/mensajes` | sí | responder_mensajes | token |
| bandejaRutas.js:56 | POST | `/api/mensajes/conversaciones/:id/tomar` | sí | responder_mensajes | token |
| bandejaRutas.js:64 | PUT | `/api/mensajes/clientes/:id/responsable` | sí | reasignar_conversaciones | token |
| bandejaRutas.js:69 | POST | `/api/mensajes/traspasos` | sí | traspasar_cartera | token |
| bandejaRutas.js:76 | POST | `/api/mensajes/identidades/:id/ligar` | sí | ligar_identidades | token |
| bandejaRutas.js:84 | GET | `/api/mensajes/clientes/:id/historial` | sí | ver_bandeja | — |
| bandejaRutas.js:91 | POST | `/api/mensajes/simulado/entrante` | sí | conectar_canales_mensajes | token |
| metasRutas.js:45 | GET | `/api/metas/tablero` | sí | usar_gerente_ventas | token |
| metasRutas.js:51 | GET | `/api/metas/personas-corporativo` | sí | administrar_metas_personalizadas | — |
| metasRutas.js:54 | GET | `/api/metas/fuentes` | sí | administrar_metas_personalizadas | — |
| metasRutas.js:57 | GET | `/api/metas/admin` | sí | administrar_metas_personalizadas | — |
| metasRutas.js:62 | GET | `/api/metas/revision` | sí | anular_capturas_metas | — |
| metasRutas.js:72 | GET | `/api/metas/sello` | sí | administrar_metas_personalizadas | — |
| metasRutas.js:77 | GET | `/api/metas/sello/previo` | sí | administrar_metas_personalizadas | — |
| metasRutas.js:78 | POST | `/api/metas/sello` | sí | administrar_metas_personalizadas | — |
| metasRutas.js:80 | POST | `/api/metas/sello/:id/rectificar` | sí | administrar_metas_personalizadas | — |
| metasRutas.js:83 | POST | `/api/metas/okr` | sí | administrar_metas_personalizadas | — |
| metasRutas.js:84 | POST | `/api/metas/okr/:clave/editar` | sí | administrar_metas_personalizadas | — |
| metasRutas.js:86 | POST | `/api/metas/okr/:clave/retirar` | sí | administrar_metas_personalizadas | — |
| metasRutas.js:89 | POST | `/api/metas/captura/:id/anular` | sí | usar_gerente_ventas | — |
| metasRutas.js:102 | POST | `/api/metas/captura/:id/revisada` | sí | anular_capturas_metas | — |
| metasRutas.js:112 | GET | `/api/metas/plan-ia` | sí | administrar_metas_personalizadas | — |
| metasRutas.js:113 | POST | `/api/metas/plan-ia` | sí | administrar_metas_personalizadas | — |
| metasRutas.js:124 | POST | `/api/metas/plan-ia/:id/ajustar` | sí | administrar_metas_personalizadas | — |
| metasRutas.js:137 | POST | `/api/metas/plan-ia/:id/validar` | sí | administrar_metas_personalizadas | — |
| metasRutas.js:139 | POST | `/api/metas/plan-ia/:id/descartar` | sí | administrar_metas_personalizadas | — |
| metasRutas.js:142 | POST | `/api/metas` | sí | administrar_metas_personalizadas | — |
| metasRutas.js:143 | POST | `/api/metas/:clave/editar` | sí | administrar_metas_personalizadas | — |
| metasRutas.js:145 | POST | `/api/metas/:clave/retirar` | sí | administrar_metas_personalizadas | — |
| metasRutas.js:147 | GET | `/api/metas/:clave/historial` | sí | administrar_metas_personalizadas | — |
| metasRutas.js:150 | POST | `/api/metas/:clave/captura` | sí | usar_gerente_ventas | — |
| cincoCaminos/rutas.js:80 | GET | `/api/cinco-caminos/tablero` | sí | ver_cinco_caminos | token |
| cincoCaminos/rutas.js:98 | GET | `/api/cinco-caminos/categorias` | sí | ver_cinco_caminos | token |
| cincoCaminos/rutas.js:102 | GET | `/api/cinco-caminos/categorias/disponibles` | sí | ver_cinco_caminos | token |
| cincoCaminos/rutas.js:109 | PUT | `/api/cinco-caminos/categorias` | sí | administrar_manual_tacticas | token |
| cincoCaminos/rutas.js:138 | GET | `/api/cinco-caminos/manual` | sí | ver_cinco_caminos | token |
| cincoCaminos/rutas.js:142 | POST | `/api/cinco-caminos/manual` | sí | administrar_manual_tacticas | token |
| cincoCaminos/rutas.js:147 | PUT | `/api/cinco-caminos/manual/:id` | sí | administrar_manual_tacticas | token |
| cincoCaminos/rutas.js:152 | POST | `/api/cinco-caminos/manual/:id/retirar` | sí | administrar_manual_tacticas | token |
| cincoCaminos/rutas.js:159 | POST | `/api/cinco-caminos/manual/:id/reactivar` | sí | administrar_manual_tacticas | token |
| cincoCaminos/rutas.js:166 | GET | `/api/cinco-caminos/manual/:id/historial` | sí | ver_cinco_caminos | token |
| cincoCaminos/rutas.js:190 | GET | `RUTA_JUNTA` | sí | ver_cinco_caminos | token |
| cincoCaminos/rutas.js:201 | POST | `${RUTA_JUNTA}/compromisos` | sí | marcar_junta_cinco_caminos | — |
| cincoCaminos/rutas.js:205 | POST | `${RUTA_JUNTA}/compromisos/:id/hecho` | sí | marcar_junta_cinco_caminos | — |
| cincoCaminos/rutas.js:210 | POST | `${RUTA_JUNTA}/compromisos/:id/cancelar` | sí | marcar_junta_cinco_caminos | — |
| cincoCaminos/rutas.js:216 | POST | `${RUTA_JUNTA}/hecha` | sí | marcar_junta_cinco_caminos | — |
| cincoCaminos/rutas.js:238 | GET | `RUTA_PLAN` | sí | ver_cinco_caminos | token |
| cincoCaminos/rutas.js:272 | GET | `${RUTA_PLAN}/borradores` | sí | administrar_metas_personalizadas | — |
| cincoCaminos/rutas.js:279 | POST | `${RUTA_PLAN}/proponer` | sí | administrar_metas_personalizadas | — |
| cincoCaminos/rutas.js:294 | POST | `${RUTA_PLAN}/:id/validar` | sí | administrar_metas_personalizadas | — |
| cincoCaminos/rutas.js:297 | POST | `${RUTA_PLAN}/:id/descartar` | sí | administrar_metas_personalizadas | — |
| facturasPorLlegar.js:137 | POST | `/api/facturas-por-llegar` | sí | registrar_facturas_por_llegar | token |
| facturasPorLlegar.js:139 | GET | `/api/facturas-por-llegar` | sí | ver_facturas_por_llegar | token |
| facturasPorLlegar.js:141 | POST | `/api/facturas-por-llegar/:id/llego` | sí | registrar_facturas_por_llegar | token |
| facturasPorLlegar.js:143 | POST | `/api/facturas-por-llegar/:id/cancelar` | sí | registrar_facturas_por_llegar | token |
| supervisionRutas.js:65 | GET | `/api/supervision/checklist` | sí | realizar_visitas_tienda | — |
| supervisionRutas.js:67 | POST | `/api/supervision/checklist` | sí | administrar_checklist_visitas | — |
| supervisionRutas.js:71 | GET | `/api/supervision/responsables` | sí | realizar_visitas_tienda | token |
| supervisionRutas.js:81 | POST | `/api/supervision/visitas` | sí | realizar_visitas_tienda | token |
| supervisionRutas.js:87 | GET | `/api/supervision/visitas` | sí | realizar_visitas_tienda o ver_supervision | token |
| supervisionRutas.js:93 | POST | `/api/supervision/visitas/:id/puntos` | sí | realizar_visitas_tienda | — |
| supervisionRutas.js:102 | POST | `/api/supervision/visitas/:id/terminar` | sí | realizar_visitas_tienda | — |
| supervisionRutas.js:109 | GET | `/api/supervision/mis-fallas` | sí | atender_fallas_visita | — |
| supervisionRutas.js:111 | GET | `/api/supervision/fallas` | sí | ver_supervision | token |
| supervisionRutas.js:115 | POST | `/api/supervision/fallas/:id/pasos/:indice` | sí | atender_fallas_visita | — |
| supervisionRutas.js:121 | POST | `/api/supervision/fallas/:id/resolver` | sí | atender_fallas_visita | — |
| supervisionRutas.js:130 | POST | `/api/supervision/fallas/:id/reasignar` | sí | realizar_visitas_tienda | — |
| supervisionRutas.js:136 | POST | `/api/supervision/fallas/:id/cancelar` | sí | realizar_visitas_tienda | — |
