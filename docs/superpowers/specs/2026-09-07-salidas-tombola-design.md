# Salidas de tómbola y Tablero de Dinero — diseño

Fecha: 2026-09-07. Base inspeccionada: `9b5e98fa677c7eb4d446fdfabc1f8468c06821b0`, rama `docs/plan-tablero-dinero`, worktree `C:/Users/Victor/Desktop/CORPUNISOUND`.

Este documento diseña trabajo futuro. No afirma que exista el tablero. Lo ejecuta `docs/superpowers/plans/2026-09-07-tablero-dinero.md`. Mandan `CLAUDE.md` y las decisiones explícitas de Victor del despacho del 2026-09-07.

## 1. Decisiones y alcance

1. Una salida es un concepto propio: `DEPOSITO`, `NOMINA`, `SERVICIO` u `OTRO`. Tiene identificación, caja, evidencia y bitácora. Un depósito es un tipo de salida, nunca un gasto de operación.
2. Primero se construye ese concepto. `deposito.caja_id` aparece dentro de su única migración; no hay una migración previa de depósitos a cajas.
3. El servidor rechaza una segunda captura de la misma erogación entre salidas y gastos en efectivo. La reserva cubre la espera de Drive. Un segundo usuario autorizado puede destrabar una coincidencia legítima una sola vez, para una operación concreta; no puede autorizar que un mismo pago real se reste dos veces.

Las decisiones de una sola puerta y depósitos separados del spec del 2026-09-04 son antecedentes documentales, sustituidos por este encargo. El código permite conservar Gastos y Estado de Cuenta como puertas de compatibilidad hacia el concepto nuevo; no existe una incompatibilidad técnica con las tres decisiones actuales. No se vuelve a implementar el filtro de origen ya construido.

No entran conciliación bancaria, cuentas por cobrar, traslados entre tiendas, retiros extraordinarios del cajón, cambios al cálculo/sellado del corte, saldos iniciales inventados ni reescritura de cortes. El tablero muestra **efectivo esperado según registros** y **depósitos registrados al banco**. No puede afirmar cuánto hay hoy en una cuenta bancaria: el sistema no conoce su saldo inicial, todas sus salidas ni las liquidaciones del adquirente.

## 2. Evidencia del estado actual y afirmaciones sustituidas

| Afirmación anterior | Evidencia leída en esta base | Consecuencia |
|---|---|---|
| Todo gasto efectivo resta al cajón; no existe origen | `backend/gastos.js`: `ORIGENES_GASTO`, `crearGasto`, `corregirOrigenGasto`, filtro `g.origen !== "CAJA_FUERTE"` | Riesgo cerrado para gastos correctamente marcados. Se conserva la regresión. |
| No se puede registrar ninguna salida de resguardo distinta del depósito | Gastos ya captura `CAJA_FUERTE`; `src/Gastos.jsx` ofrece origen y caja | Esos gastos existentes deben descontarse del resguardo una vez; ignorarlos inflaría la tómbola. Falta el concepto unificado de salida, no la distinción de origen. |
| La decisión de impedir doble captura sigue abierta | Decisión expresa del 2026-09-07 | Rechazo obligatorio, no advertencia. |
| Caja en depósitos primero, salidas al final | Decisión expresa del 2026-09-07 | Migración única dentro de salidas. |
| `alcanceSucursal` sirve sin matices para cualquier guarda | `backend/auth.js` incorpora `req.query.sucursal_id`; `dentroDeAlcance` acepta incluso alcance ausente | Por identificador se construye alcance desde permiso y token, se exige objeto válido dentro del dominio. Query solo filtra listas. |
| Basta añadir el permiso al catálogo | `backend/validarPermisos.js` tiene además `MODULOS_QUE_REQUIEREN_PERMISOS` | Registrar el módulo en las dos listas y comprobar el arranque real. |
| El total de cortes dice cuánto se vendió hoy | `backend/cortes.js`: `total_calculado` incluye otras formas, abonos, gastos y garantías; un turno puede comenzar otro día | Informar cortes cerrados hoy y su efectivo contado/retirado. No rotularlo ventas del día. |
| Cualquier depósito baja efectivo resguardado | `backend/depositos.js`: `EFECTIVO` y `TRANSFERENCIA` válidos; `estadoCuenta.js` acredita ambos | Solo EFECTIVO baja tómbola. TRANSFERENCIA es movimiento bancario registrado, sin efecto físico. |
| El tablero puede mostrar montos a cualquier capturista | `filtrarCorteEnCursoPorPermiso` oculta esperado sin `ver_montos_corte` | Separar registrar de ver; el permiso de ver tablero concede conocimiento del esperado y debe asignarse conscientemente. |

Comprobaciones adicionales que afectan a este trabajo: `crearVenta` hoy declara `crearVenta(DB, datos, opciones = {})`, aunque el ejemplo simplificado de `CLAUDE.md` muestra dos argumentos. Las pruebas de cajas usan el tercero para declarar `agregar_articulo_rapido`. El tablero no necesita crear ventas mediante esa función: sus fixtures pueden insertar movimientos completos. `calcularCorteEnCurso(DB, sucursal_id, caja_id, incluirMovimientos = false)` ya devuelve movimientos exactos cuando se pide `true`, y ya incluye dinero de garantías y monedero aplicado. No copiar de documentación anterior que eso falta. `ORIGENES_GASTO` existe como constante local; hoy no se exporta.

Se leyó entero `backend/depositos.js`: alta y reserva de folio síncronas antes del primer `await`, archivo opcional validado antes del alta, `adjuntosEnCurso` como `WeakSet`, comprobante no reemplazable, cancelación conserva Drive. Se mantienen esas decisiones. La adjunción posterior ya existe: no crear otra versión.

## 3. Modelo de datos: una erogación, una contabilización

Se agrega `DB.cuenta_comun.tombola`, dentro de una colección ya respaldada. No se necesita otra base ni dependencia.

```js
{
  version: 1,
  salidas: [], movimientos: [], reservas: [], solicitudes: [],
  ultimo_id: 0, ultimo_movimiento_id: 0, ultimo_solicitud_id: 0,
  migracion: { fecha_hora: ahoraISO, depositos: 0, gastos_fuerte: 0 }
}
```

`SalidaVinculo = { id, folio, tipo, fuente_tipo, fuente_id, fecha_hora_vinculacion, historica }`. `folio` nuevo usa `ST-0001`; `fuente_tipo` admite únicamente `deposito` o `gasto`. La identidad `(fuente_tipo, fuente_id)` es única. El vínculo es persistente, no una unión de listas que desaparece al reiniciar.

La salida se lee como `Salida = { ...vinculo, folio_fuente, sucursal_id, caja_id, origen, monto, forma_pago, fecha, fecha_hora, estatus, concepto, referencia, nota, usuario_id, usuario_nombre, nombre_archivo, drive_file_id, drive_link, motivo_cancelacion, erogacion, operacion_id }`. Es una **proyección**: monto, caja, estado y comprobante se leen del registro fuente, no se mantienen dos copias monetarias editables. Un gasto y su vínculo representan la misma operación. La consulta de tómbola solo suma salidas; jamás vuelve a sumar sus gastos o depósitos fuente.

- Depósito: conserva registro, `id`, folio `DEP-`, forma, monto, usuario, fechas, nota, referencia, comprobante y movimientos existentes. Gana `caja_id` y `salida_id`. Si es EFECTIVO, origen de la proyección `CAJA_FUERTE`; si es TRANSFERENCIA, `BANCO`. Se presenta en la lista como “Depósito por transferencia — no salió efectivo de la tómbola”.
- Nómina/servicio/otro nuevo: fuente `gasto`, con `origen: "CAJA_FUERTE"`, `forma_pago: "EFECTIVO"`, categoría de gasto válida y comprobante obligatorio. El registro fuente mantiene el reporte de gastos/utilidad existente una sola vez. Gana `usuario_id`, `usuario_nombre`, `salida_id`, `operacion_id`, `erogacion`. Ningún depósito genera un gasto.
- Gastos fuertes históricos: se vinculan como `OTRO`, con `historica: true`, conservando concepto/categoría original. No se adivina que fueron nómina por el nombre de una categoría. El detalle dice “Gasto de caja fuerte anterior al tablero”.
- Gastos con TRANSFERENCIA/TARJETA y `origen: "CAJA_FUERTE"`: ese origen hoy puede estar guardado aun cuando la forma no es efectivo. No crear una salida física ni restarla de la tómbola. Mantener el gasto y mostrarlo en información histórica de calidad, con impacto físico cero.

## 4. Migración única, arranque y restauración

`migrarSalidasTombola(DB, ahoraISO)` prepara cambios sin `await`. Valida primero todas las relaciones y cajas; si hay un id explícito inválido, una forma desconocida o un vínculo duplicado, devuelve error concreto sin migrar parcialmente. No corrige dinero por intuición.

Para cada depósito, activo o cancelado, crea un vínculo y agrega `salida_id`; si faltaba `caja_id`, agrega `null`. **No escribe el id de Administrativa como si alguien lo hubiera elegido**: `esDeEstaCaja` atribuye el histórico a la predeterminada. En la pantalla: “Administrativa — atribución histórica por caja predeterminada”. Id de caja explícito válido se conserva, incluidos ids de texto normalizables en lecturas. El contador DEP nunca se reinicia.

Para cada gasto histórico EFECTIVO/CAJA_FUERTE crea un vínculo sin alterar ningún campo preexistente del gasto. Agrega solo `salida_id`. Los demás gastos no se migran. Nóminas históricas sin origen o con CAJON **siguen siendo gastos del cajón**; no se inferirán nuevas salidas, no se devolverá dinero virtual a una cajera y no se recalcularán cortes firmados. Una nota visible explica la cobertura histórica y que los cortes viejos afectados quedan como están.

La bitácora de migración se agrega en `tombola.movimientos` con actor `sistema`, fecha de migración, fuente y campos añadidos. No se mezcla con el actor/fecha originales. Comparar todos los campos originales y ambas bitácoras antes/después con `deepStrictEqual`.

Se ejecuta después de sembrar/reparar cajas, tanto al arrancar como en `reconciliarTrasRestaurar(db)`. Repetir no crea vínculos ni eventos adicionales. El seed de `server.js` debe declarar `cuenta_comun.tombola` para que el cargador de tablas la restaure. Se actualiza el conteo de respaldos para salidas/reservas/solicitudes, conservando la compatibilidad con manifiestos anteriores que no declaraban esas claves. Eliminar una versión del código sin este seed perdería las nuevas tablas al guardar: volver a código viejo exige restaurar con el procedimiento de respaldos, no un redespliegue ciego.

## 5. Qué significa “la misma erogación”

No basta comparar texto libre, caja o nombre de archivo. No se promete identificar pagos que alguien oculta deliberadamente cambiando todos sus datos. Se combinan identidad documental y una coincidencia conservadora que no se puede eludir solo eligiendo otra categoría/caja.

Todas las altas nuevas de gastos EFECTIVO y salidas llevan `operacion_id` UUID generado al abrir el formulario y conservado al reintentar. Los depósitos solo necesitan UUID; no son erogaciones de nómina/servicio y no participan en sus coincidencias. Los gastos nuevos en efectivo y salidas que son gastos llevan además:

```js
erogacion = {
  tipo: "NOMINA" | "SERVICIO" | "OTRO",
  fecha_pago: "YYYY-MM-DD",
  empleado_id: null, periodo_inicio: null, periodo_fin: null,
  proveedor_id: null, referencia_pago: ""
}
```

NOMINA requiere empleado existente en `DB.admin.usuarios`, misma sucursal o cuenta global, y periodo válido inclusivo. No se exige cuenta activa para pagar un finiquito. SERVICIO requiere proveedor existente en `DB["catalogo-productos"].proveedores` y referencia de recibo/factura; si el proveedor no la emite, usar referencia estable del servicio y periodo, escrita en el comprobante. OTRO conserva concepto/categoría/comprobante. El servidor valida fecha real de calendario, no posterior a `fechaLocal()`, y orden de periodo. Normaliza texto con NFKC, trim, mayúsculas y espacios consecutivos a uno; no elimina todos los signos de una factura porque puede unir referencias distintas.

El monto se valida como número o cadena decimal finita, positivo, expresable en centavos, dentro de entero seguro; rechazar booleanos, objetos, vacío, cero redondeado y decimales con más de dos posiciones. Se compara y suma en centavos enteros. Los valores históricos se convierten sin reescribirlos y una anomalía impide presentar su subtotal como confirmado.

**Rechazo por cualquiera de estas coincidencias, dentro de la sucursal autorizada:**

1. Misma identidad documental: NOMINA por empleado y periodo; SERVICIO por proveedor y referencia normalizada. Ignora monto, fecha de captura y caja. Un segundo pago legítimo parcial puede necesitar la autorización de otra persona.
2. Igual monto en centavos e igual `fecha_pago` entre una salida NOMINA/SERVICIO y cualquier gasto EFECTIVO o salida nueva de tipo gasto, incluso si el segundo se declaró OTRO, cambió de caja, proveedor o concepto. Para un gasto histórico sin metadatos se usa su `fecha` original como fecha comparativa, sin modificarlo. Un vínculo histórico OTRO se trata conservadoramente como candidato fuerte en esta regla para que no sea una vía libre. Depósitos y formas electrónicas no participan en esta coincidencia.
3. Una misma `operacion_id` no crea nada nuevo: con el mismo usuario y huella devuelve el resultado confirmado; si está reservada, 409 `OPERACION_EN_CURSO`; con datos distintos, 409 `OPERACION_REUTILIZADA`. Esto es idempotencia, no una autorización de duplicado.

La búsqueda es simétrica: gasto primero y salida después, salida primero y gasto después, dos salidas y dos gastos NOMINA/SERVICIO. Deduplicar por fuente: no comparar un gasto con su propio vínculo. Un gasto OTRO frente a otro gasto OTRO no se bloquea solo por monto/fecha. Se revisan registros activos y reservas; las cancelaciones se conservan en la evidencia pero no siguen bloqueando. No se compara caja para decidir si fue el mismo pago: Administrativa/Fiscal son atribuciones, no identidades del pago.

**Límite visible:** el histórico sin identidad documental solo permite coincidencia de monto/fecha. Una captura tardía con fecha o importe falseados puede evadir esa coincidencia. El sistema registra fecha real de captura, fecha declarada, actor, comprobante y rechazos; el contador tiene el filtro de autorizaciones y capturas históricas para revisarlo. No atribuir a la cajera una acusación automática a partir de esa heurística.

El error 409 `EROGACION_COINCIDENTE` persiste una solicitud con la huella de los datos y los ids coincidentes antes de responder. El mensaje:

> “No se guardó este pago: coincide con ST-0007 / GA-0012 por $800.00, pagado el 07/09/2026. Si es el mismo pago, abre ese registro y adjunta ahí el comprobante que falte. Si el origen está equivocado, pide su corrección antes del corte. Si son dos pagos distintos, solicita a otro encargado con permiso Autorizar pago coincidente que revise la solicitud SOL-0003. No cambies fecha, monto ni caja para evitar el rechazo.”

Los folios, monto y fecha son los reales de esa coincidencia. Al capturista se muestra solo el resumen necesario de su sucursal y sus propias solicitudes, no otros sueldos ni saldos. Si no tiene permiso de lectura del documento, la acción es “Solicitar revisión” y quien autoriza abre la evidencia.

## 6. Reserva, comprobantes y persistencia

Node trabaja sobre una DB en memoria en un proceso; `persistencia.js` guarda una fotografía JSON en SQLite. Un índice SQL sobre una tabla de gastos inexistente no arreglaría esta carrera. La exclusión se hace en una sección síncrona antes de cualquier espera, y se persiste. Este diseño requiere mantener un solo proceso escritor de esta DB; no autoriza escalado con workers/cluster.

`Reserva = { operacion_id, huella, usuario_id, sucursal_id, caja_id, origen, erogacion, monto_centavos, fuente_prevista, estado, fecha_hora, vence_en, autorizacion_id, resultado }`. Estados: `reservada`, `confirmada`, `fallida`, `interrumpida`. `resultado` identifica fuente y salida, nunca contiene base64. La huella SHA-256 incluye los campos normalizados de negocio, destino, usuario y digest del archivo; excluye ids de autorización y ruido HTTP.

Flujo de gasto o nómina/servicio:

1. Validar identidad, permiso/alcance, categoría, caja y comprobante completo sin tocar DB ni Drive.
2. En un tramo síncrono buscar duplicados, reservar operación/folio y marcar autorización `en_uso`. Persistir ANTES de llamar a Drive. Si la persistencia falla, no comenzar la subida.
3. Subir comprobante usando `asegurarCarpetaGastosSucursal(DB, sucursal)` y `subirArchivoADrive(DB, opciones)`. Máximo 120 segundos de espera; una promesa tardía no puede confirmar ni modificar registros.
4. Tras la espera revalidar reserva, generación de DB (restauración), cuenta activa, permisos vigentes, alcance, caja, categoría y nuevas coincidencias. Sin `await` entre revalidar, crear gasto/vínculo/evento, marcar operación confirmada y autorización consumida y guardar. Solo entonces responder éxito.
5. Si falla Drive, no crear gasto/salida ni evento de alta. La reserva pasa a fallida con el motivo. La autorización queda ligada a esa misma operación; solo permite reintentar esa huella mientras no venza. No autoriza otra operación. No elimina el rastro del intento.

Una reserva activa excluye al competidor durante toda la subida, no se libera porque la UI deje de esperar. Si vence el plazo, se invalida primero; cualquier respuesta tardía se ignora y el archivo remoto puede quedar huérfano. Al reiniciar/restaurar, las reservas no confirmadas pasan a interrumpidas y sus autorizaciones se revocan: el usuario obtiene instrucciones para revisar y reintentar, no una salida medio creada. Nunca expirar una operación confirmada.

Una reserva fallida/interrumpida puede volver a reservada solo por el mismo actor, UUID y huella y después de repetir las comprobaciones de conflictos y permisos. Conserva sus eventos de intentos anteriores. Las interrumpidas no recuperan aprobaciones revocadas; si el conflicto persiste requieren una nueva solicitud aprobada. Una reserva confirmada nunca vuelve al estado reservada, ni siquiera si se canceló posteriormente la fuente.

Mientras un gasto **del CAJON** está subiendo su comprobante, la ruta de guardar corte de esa misma caja rechaza con 409 `GASTO_EN_REGISTRO`: “Hay un gasto del cajón terminando de guardarse. Espera su resultado y vuelve a cargar el corte antes de cerrarlo”. Comprueba reservas con sucursal y `esDeEstaCaja`, usando exactamente la sucursal/caja ya resueltas para ese corte; no cambia el cálculo ni los sellos. Así no firma un faltante mientras el gasto todavía no existe. Una salida fuerte pendiente no bloquea el corte porque no afecta ese cajón. Al fallar/subir el gasto se libera esa espera según su estado; el aviso indica revisar si el pago necesita recapturarse, sin crear un gasto artificial. El conteo físico y la confirmación de la persona siguen siendo necesarios.

Depósitos conservan su particularidad: validación de archivo síncrona, reserva de folio, alta de depósito + vínculo + confirmación persistidos **antes** de subir el comprobante opcional. Una falla de Drive no deshace dinero registrado. El `WeakSet` sigue protegido antes de `await`, y se revalida después de cada espera antes de aplicar el enlace, también durante el alta original. Reintentar devuelve el mismo DEP/ST, no crea otro. Adjuntar después exige archivo, no permite reemplazarlo y la falla sí se comunica como error.

`configurarPersistenciaTombola(DB, guardar)` registra un callback síncrono en un `WeakMap` fuera de DB; en el servidor es obligatorio configurarlo antes de aceptar rutas. Las pruebas de dominio trabajan explícitamente en memoria o inyectan un callback capturador. `cambioTombola(DB, cambiar)` ofrece un diario de undo (`tx.asignar(objeto, clave, valor)` y `tx.agregar(lista, registro)`): muta, guarda y, si guardar lanza, deshace únicamente ese tramo síncrono conservando identidad de objetos para el WeakSet. Prohibido restaurar una foto anterior a Drive por encima de operaciones ajenas.

El middleware actual guarda después de `res.json` y solo con estatus menor de 400; no basta para las reservas ni el rechazo auditado. Estas rutas marcan `res.locals.tombolaPersistida = true` después del guardado explícito y el middleware omite su segundo guardado. La consulta no muta ni guarda. Un 409 con solicitud debe quedar persistido aunque no sea una respuesta exitosa. Las reservas y autorizaciones no se serializan como campos del comprobante ni exponen datos a listas públicas.

## 7. Quién destraba y qué puede autorizar

`Solicitud = { id, folio, operacion_id, huella, solicitante_id, sucursal_id, coincidencias, estado, creada_en, autorizador_id, motivo, autorizada_en, vence_en, consumida_en, datos_propuestos, archivo_sha256, nombre_archivo, drive_file_id, drive_link }`. `datos_propuestos` guarda los datos normalizados de negocio que el segundo actor debe revisar, sin base64. Estados: `pendiente`, `autorizada`, `en_uso`, `consumida`, `rechazada`, `revocada`. Folio `SOL-0001`. Una solicitud repetida para la misma operación/huella reutiliza el registro; cada rechazo nuevo queda como evento.

El 409 no sube automáticamente el archivo del pago rechazado. El capturista pulsa “Enviar comprobante a revisión”: `POST /api/erogaciones/solicitudes/:id/comprobante` exige que sea su solicitud pendiente, los permisos de la operación propuesta y un archivo cuyo SHA-256 coincida con el capturado en la huella. Lo sube a la carpeta existente de Gastos como `SOL-0003 - nombre`, con límite/MIME y candado de adjunción; no crea gasto, no resta dinero ni reemplaza evidencia. Revalida después de Drive y persiste el enlace/evento. No aprobar hasta que el solicitante aporte esa evidencia. Para una corrección de un pago existente, `datos_propuestos` incluye el antes/después y se referencia su comprobante actual, sin pedir una foto nueva. Al confirmar la captura autorizada se puede reutilizar ese archivo ya verificado de la solicitud; no hace falta subirlo dos veces.

La persona con `autorizar_erogacion_repetida` revisa ambos comprobantes/datos y escribe un motivo de al menos 15 caracteres explicando **por qué son pagos distintos**. Se autentica en su propia sesión; no se introduce una contraseña ni un `autorizador_id` en el formulario del capturista. Se comparan ids normalizados: `"9"` y `9` son la misma persona y no puede autorizarse. No admitir cuenta inactiva, fuera de alcance ni permiso revocado.

La aprobación vence a los 15 minutos y se vincula al solicitante, operación, huella y conjunto de conflictos. Se reclama síncronamente. Dos peticiones no pueden consumirla dos veces; un conflicto nuevo obliga a nueva revisión. Si vence/revocan una solicitud se crea una nueva SOL para la misma operación todavía no confirmada, conservando la anterior y sin cambiar el UUID del pago. Ni la aprobación ni la reserva restan dinero. Solo la confirmación lo hace. Si la tienda no tiene otro encargado con ese permiso, Victor o el contador autorizado revisa desde su sesión; mientras tanto el pago queda **sin registrar**, nunca convertido silenciosamente en gasto del cajón.

No se permite cancelar el registro correcto solo para vencer la guarda. La UI explica que cancelar corrige una captura y no acredita por sí mismo devolución de dinero físico. Todas las cancelaciones conservan comprobantes y quedan visibles. Sin responsable autorizado no hay bypass administrativo oculto.

## 8. Permisos, alcance y puertas existentes

Módulo nuevo `tablero_dinero` en `permisosCatalogo.js`, en `MODULOS_SISTEMA` y en `MODULOS_QUE_REQUIEREN_PERMISOS`:

| Clave | Qué concede |
|---|---|
| `ver_tablero_dinero` | Ver cifras, componentes y evidencia del tablero dentro del alcance. Concede conocer el esperado del cajón. |
| `registrar_salidas_tombola` | Iniciar salidas; no concede saldos ni cancelación. |
| `cancelar_salidas_tombola` | Cancelar una salida con motivo; no concede registrar otra. |
| `adjuntar_comprobantes_tombola` | Adjuntar evidencia faltante a una salida; no reemplazarla. |
| `corregir_salidas_tombola` | Corregir atribución de origen/caja con las restricciones de cortes e historial. |
| `autorizar_erogacion_repetida` | Consultar y resolver solicitudes de su alcance, nunca las propias. |

Administrador se reconcilia automáticamente; los demás roles los asigna Victor en Roles y Personal. No regalar estos permisos a cajeras/gerentes al migrar. El contador que solo consulta recibe `ver_tablero_dinero`; quien captura y hace corte a ciegas puede recibir registrar sin ver. No exigir `ver_montos_corte` además: el permiso explícito del tablero ya concede ese conocimiento; la etiqueta y ayuda deben advertirlo.

Las altas desde Gastos siguen necesitando `registrar_gastos`; para EFECTIVO/CAJA_FUERTE se exige también `registrar_gasto_caja_fuerte` y `registrar_salidas_tombola`. Depósitos sigue exigiendo `registrar_depositos`; EFECTIVO requiere además `registrar_salidas_tombola`. La ruta nueva de salidas exige su permiso propio más los permisos de fuente anteriores según tipo; TRANSFERENCIA se permite como tipo DEPOSITO, sin descontar tómbola. No hay rutas antiguas con privilegios menores que dejen saltar las guardas.

Cancelar una salida, incluso por `/depositos/:id/cancelar` o `/gastos/:id/cancelar`, exige `cancelar_salidas_tombola` más el permiso fuente; adjuntar un depósito exige `adjuntar_comprobantes_tombola` además de `registrar_depositos`. Corregir un gasto vinculado o convertir CAJON a CAJA_FUERTE exige `corregir_salidas_tombola` y `registrar_gasto_caja_fuerte`. Los permisos se revisan con `permisosDeRol(DB, usuario.rol_id)` dentro del servicio y otra vez tras Drive, además de los middlewares. Los adaptadores no reciben booleanos de confianza desde HTTP.

`alcanceActor(DB, usuario)` devuelve `{ verTodas: true, sucursalId: null }` exclusivamente con `ver_todas_las_sucursales`; en otro caso exige id positivo del token. No recibe query. `exigirAlcance(alcance)` rechaza objeto ausente/inválido antes de `dentroDeAlcance`. Por id, ajeno e inexistente responden el mismo 404 sin revelar evidencia.

Las altas siguen escribiendo la **sucursal del token**, incluso para el administrador, como Gastos y Depósitos actuales. La caja se declara explícitamente en el cuerpo y se valida contra esa sucursal, nunca contra el encabezado. La pantalla muestra esa sucursal fija en el formulario y carga sus cajas con query explícito; se puede consultar otra tienda sin impedir capturar en la propia con una explicación clara. No ampliar este encargo a escritura global.

Para elegir empleado/proveedor/categoría sin regalar permisos administrativos se crea `GET /api/salidas-tombola/catalogos`: permite a quien registra salidas o gastos consultar solo `{cajas,empleados,proveedores,categorias}` de captura. Empleados se reducen a id/nombre/sucursal/activo de la sucursal de sesión (incluye inactivos para finiquito); no devuelve contraseñas, expedientes, domicilios ni roles. Proveedores y categorías exponen solo id/nombre y datos de jerarquía para seleccionar una hoja válida. Hoy `/api/usuarios` exige `administrar_roles`; no darle ese permiso a una cajera para llenar la nómina. Los empleados globales se incluyen solo si el capturista también tiene alcance global. La validación usa el mismo criterio en el servidor.

En listas, el filtro explícito `sucursal_id=todas` o id válido intersecta el alcance del actor. Sin permiso global no ensancha la propia. En resumen del tablero se ignora `caja_id` inyectado por `apiFetch`: siempre aparecen ambas cajas. En detalle se usa `:cajaId`, validado dentro de `:sucursalId`, no el query del encabezado.

`corregirOrigenGasto` hoy no recibe alcance, solo comprueba sello y puede mutar origen antes de fallar por caja inválida. La tarea de integración cierra esos huecos como requisito del nuevo camino: prevalidación completa, alcance obligatorio y cambio atómico. Para gastos históricos que ya quedaron antes de un corte, consultar `esDeLaEraSellada` y `esDeEstaCaja`; no confundir ausencia de sello histórico con permiso de reescritura. Los gastos ya cortados, sellados o históricos, quedan congelados.

Corregir usa un nuevo UUID de operación con propuesta antes/después, sin sustituir el UUID del alta ni la identidad del pago. El servidor excluye exclusivamente la fuente que está corrigiendo al buscar coincidencias; el cuerpo no puede elegir exclusiones. Si hay otro pago/reserva coincidente, la corrección también exige rechazo y aprobación de segundo actor. El cambio sigue siendo síncrono y no crea un gasto adicional.

## 9. Cifras, componentes y conciliación

Cada cifra devuelve `importe_centavos` y `componentes[]` de `{ fuente_tipo, fuente_id, folio, fecha, concepto, importe_centavos, usuario_nombre, evidencia_disponible }`. Componentes firmados: sumarlos reproduce exactamente la cifra. Los totales de sucursal/cadena referencian las cifras hijas de esa misma respuesta. Los detalles conservan fuentes canceladas como evidencia con contribución cero, separadas del listado de sumandos.

| Cifra | Fórmula exacta y significado |
|---|---|
| Cajón esperado por caja | Último corte de esa sucursal/caja: `contado.EFECTIVO - retiro.EFECTIVO`, más `calcularCorteEnCurso(DB, sucursalId, caja.id, true).calculado.EFECTIVO`. Si no existe corte, fondo documentado 0 con aviso “Sin fondo inicial registrado”. |
| Fondo retenido | Solo la diferencia del último corte, nunca la suma de fondos de todos los cortes. Se abre el corte que la soporta. |
| Neto del turno | Solo EFECTIVO. Componentes de `movimientos_incluidos` de la función real: ventas efectivas menos monedero, abonos reales, cobros de garantía, gastos del cajón y gastos de garantía con signo negativo. No recortar por fecha de hoy. |
| Tómbola por caja | Suma histórica completa de `retiro.EFECTIVO` de los cortes menos salidas activas con origen CAJA_FUERTE/EFECTIVO. Incluye gastos fuertes vinculados al migrar. |
| Disponible en tienda | Cajón esperado + tómbola. Nunca depósitos bancarios, tarjeta, cheques, vales, MercadoLibre, crédito o monedero. |
| Depositado al banco | Suma de depósitos activos, una vez por fuente; desglose EFECTIVO y TRANSFERENCIA. Es flujo registrado acumulado, no saldo disponible bancario. Se conserva atribución histórica a predeterminada y se aclara que la cuenta común no está físicamente separada por caja. |
| Cortes cerrados hoy | `fecha === fechaLocal(ahoraISO)`, por sucursal/caja: cantidad, suma `contado.EFECTIVO`, suma `retiro.EFECTIVO` y suma `diferencia.EFECTIVO` como dato firmado. No usar `total_calculado` como ventas. No sumar estas cifras al saldo de nuevo. |
| Total visible | Sumar únicamente las tiendas incluidas en la respuesta autorizada. Texto “Total de las tiendas mostradas”; “Toda la cadena” solo al consultar todas con permiso global. |

Al agrupar cualquier registro se filtra primero sucursal y después **siempre** `esDeEstaCaja(registro, caja)`. El tablero exige catálogo consistente; no sumar “todo” una vez por cada caja si el catálogo falta. Devuelve 409 `CAJAS_INCONSISTENTES`, no ceros. Una fecha/monto/fuente histórica inválida marca el subtotal afectado `null` y lista las incidencias; no convertir valores corruptos a cero ni omitirlos silenciosamente del total.

**Cuidado del fondo:** el corte existente calcula neto del turno; no incorpora el fondo retenido del corte anterior. El tablero sí lo agrega para estimar billetes presentes. Mostrar ambos componentes y explicar la diferencia. No exigir que el cajón esperado del tablero sea igual al calculado del formulario de corte. No reclasificar la diferencia ya firmada como robo o faltante causado por la cajera. Tampoco añadir dos veces el fondo a un corte cuyo contado ya lo incluye.

No truncar resguardo negativo a cero, ni rechazar una salida solo por ese saldo calculado: el histórico puede carecer de entradas. Mostrar la etiqueta “Resguardo según registros”, el monto negativo real y el mensaje “Revisar entradas y salidas”, con evidencia. No se autoriza inventar un ajuste de apertura para cuadrarlo. Un saldo negativo no se envía al corte de ninguna cajera. El corte sigue intacto.

Identidades de comprobación, no de contabilidad general: un retiro de $800 baja el cajón y sube tómbola $800; un depósito efectivo baja tómbola y sube depositado efectivo $800; una nómina baja tómbola y aumenta gasto $800; una transferencia registrada solo sube depositado por transferencia. Nunca sumar el banco al disponible de tienda. Un conteo distinto del esperado queda como diferencia firmada, no como entrada artificial al negocio.

`obtenerTableroDinero(DB, filtros, alcance, ahoraISO)` calcula una respuesta síncrona con `generado_en`, `fecha_local`, `sucursales`, `totales` e `incidencias`. Los componentes viajan en la misma respuesta autorizada; al abrir una cifra no se mezcla con una consulta posterior. La UI indica hora y tiene Actualizar. La lectura de evidencia por id revalida alcance actual. No usar un filtro de fechas de movimientos para recortar un saldo acumulado; este primer tablero solo consulta estado actual y cortes del día local.

## 10. Matriz de abuso, rastro y a quién afecta

| Cifra u operación | Cómo se abusa o se equivoca | Qué queda registrado / control | A quién aparecería la diferencia si sale mal |
|---|---|---|---|
| Cajón/fondo/neto | Ocultar ventas históricas, sumar tarjeta, contar dos veces el fondo, leer esperado en corte ciego | Componentes, corte fuente, permiso explícito, misma función de turno | Cajera de esa caja; nunca trasladarla a otra por un filtro. |
| Tómbola | Omitir un gasto fuerte o inventar una salida | Vínculos únicos, actor/id, comprobante, saldo negativo visible | Resguardo de la sucursal/caja atribuida; no el cajón. |
| Disponible/total visible | Sumar banco o sucursales ajenas; mostrar error como cero | Sumas de hijos, alcance, hora y estado de carga/error | Victor dispone de dinero inexistente; no convertirlo en deuda de cajera. |
| Banco efectivo/transferencia | Declarar depósito ficticio o restar transferencia de tómbola | DEP/ST, forma, ficha, actor, conciliación pendiente explícita | Banco sobrestimado y, solo si EFECTIVO, resguardo subestimado. |
| Cortes de hoy/diferencia | Confundir neto con ventas o reinterpretar cortes firmados | Fecha local y datos originales del corte | Firmante del corte; se muestra contexto sin nueva imputación. |
| Migración | Reasignar historia o crear duplicados | Evento de sistema y comparación campo por campo, vínculos únicos | Caja predeterminada solo como atribución histórica, sin recalcular cortes. |
| Alta/salida | Elegir caja ajena, pago falso, doble clic o dos personas | Validación en servidor, idempotencia, reserva y evento de confirmación | Resguardo si salida; cajera solo si gasto real del cajón. |
| Gasto duplicado | Capturar de nuevo una nómina ya pagada | Rechazo 409 y solicitud persistida antes de Drive | Ninguna diferencia nueva: no se guarda el segundo. |
| Adjuntar | Sustituir evidencia mientras sube otra ficha | WeakSet, guardas antes/después, evento con id Drive; no reemplazo | Ningún saldo cambia; la atribución del pago queda rastreable. |
| Cancelar | Borrar salida sin devolver físicamente el dinero | Permiso separado, motivo, antes/después y conservación del archivo | Resguardo esperado sube y puede aparecer diferencia allí; no al cajón. |
| Corregir origen/caja | Descargar una obligación en otra cajera | Alcance, prevalidación, corte congelado, evento de antes/después | Caja de origen/destino mostradas; solo turno abierto cambia de expectativa. |
| Autorizar coincidencia | Autorización propia, prestada o reutilizada | Segundo usuario, motivo, huella, caducidad y consumo atómico | Si eran el mismo pago, el doble registro autorizado afecta al origen declarado; responsables quedan identificados. |
| Reserva/reintento/restaurar | Liberar durante Drive, repetir al reiniciar, confirmar sobre otra foto | Estados durables, generación de DB y resultado idempotente | Sin movimiento hasta confirmar; no inventar faltante por una operación pendiente. |

## 11. Pantallas y aceptación

Tablero en Administración, con pestañas “Dinero”, “Salidas” y “Pagos por revisar”. Cada permiso habilita su sección; se puede registrar sin ver el esperado. Formularios con sucursal de sesión visible, selector de caja propio y aviso de efecto: “Baja la tómbola de Fiscal; no cambia el corte de la cajera”. TRANSFERENCIA dice “Movimiento bancario; no retira efectivo de la tienda”.

Los permisos de operar sin ver deben tener una puerta útil: `GET /api/salidas-tombola/operables` permite a quien registra/cancela/adjunta/corrige listar datos mínimos de salidas de su alcance (ST, DEP/GA, caja, tipo, monto, estado, acciones permitidas), sin cifras del cajón ni datos del tablero. No requiere `ver_tablero_dinero`; sí la acción que justifica cada resultado. Quien solo registra ve sus propias salidas; quien cancela/adjunta/corrige puede localizar las de su alcance y consultar su evidencia puntual para esa acción. Es acceso a las operaciones individuales que administra, no acceso al efectivo esperado. El endpoint `/api/salidas-tombola/:id/operacion` revalida exactamente esa regla y devuelve comprobante/bitácora para la acción autorizada.

Estado de Cuenta conserva lista DEP, referencia, nota y comprobante posterior. Gastos conserva las erogaciones en sus reportes; el alta EFECTIVO/CAJA_FUERTE crea fuente y salida juntas, y ofrece ir a ST. No se pide capturar un gasto adicional después de registrar una nómina. Las autorizaciones se resuelven desde otra sesión; el capturista consulta estado y reintenta el mismo formulario, sin reescribirlo.

Estados cargando/error/sin movimientos son distintos. Un error de carga reemplaza las cifras por “No disponible” y un botón Reintentar; una respuesta vieja no puede pisar otra sucursal seleccionada después. Cada cifra es un botón accesible por teclado con concepto/monto/fecha/autor y comprobante si tiene permiso. El comprobante no disponible no se dibuja como pago inexistente.

Aceptación decisiva: con $1,000 contados, retiro $800 y ventas posteriores de $500 en efectivo, el tablero dice cajón $700 y tómbola $800. Mientras sube la ficha de una nómina fuerte de $300, un segundo usuario intenta el gasto $300 de la misma erogación: 409, sin gasto adicional ni cambio al corte. Al terminar de subir se confirma la nómina y quedan cajón $700 y tómbola $500. Un servicio legítimo distinto de igual fecha/monto, **pagado realmente desde el CAJON**, solo pasa con otra persona, una autorización y un solo consumo: cajón $400, tómbola $500. Depositar $200 efectivo deja tómbola $300 y depositado efectivo $200; registrar $400 de transferencia deja cajón $400, tómbola $300 y depositado total $600. Todas las cifras se abren y suman. El servicio es otro gasto real: el cajón solo baja cuando ese segundo pago distinto se confirma, nunca por el intento rechazado.

La implementación termina con suite Node y lint, revisión independiente por alguien distinto del implementador (si implementa Codex, no revisa Codex) y prueba real en navegador con dos sesiones. Este despacho solo escribe diseño/plan; no constituye esa revisión ni una prueba de funcionamiento.
