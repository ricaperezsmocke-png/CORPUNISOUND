# Centro Omnicanal de Leads — decisiones congeladas (Fases 1-3)

**Rama:** `feature/centro-leads`
**Commit documentado:** `be8e606 feat(centro-leads): add auditable attribution and assignment`
**Base:** `a3f7f2a` (master)
**Fecha:** 2026-08-22
**Estado:** Fases 1, 2 y 3 cerradas. Fase 4 no iniciada.

## Por qué existe este documento

Las Fases 1-3 se construyeron con Codex sin spec escrito: las decisiones vivían
solo en esa conversación. Este documento las congela **verificadas contra el
código**, no transcritas de un resumen. Cada regla trae su archivo y línea.

Regla operativa: **si una fase futura necesita contradecir algo de aquí, se
detiene y se decide con Victor.** No se cambia sobre la marcha.

## 1. Persistencia

Centro de Leads **comparte** `datos.sqlite` con el resto de CORPUNISOUND
(`backend/persistencia.js:43`). No hay segunda base de datos.

- El documento JSON de la fila `estado` (POS, CRM, inventario, roles) **no se
  toca**. Centro de Leads usa tablas relacionales propias con prefijo `lead_`.
- Los IDs de cliente, vendedor, usuario, sucursal, producto, venta y cotización
  son **referencias lógicas sin FOREIGN KEY**, porque esas entidades siguen
  viviendo en el JSON. Solo las relaciones entre tablas `lead_*` usan FK reales.
- `inicializarPersistenciaCentroLeads` se ejecuta **antes** de crear la tabla
  `estado`, es idempotente y corre dentro de una transacción.
- Versión de esquema en `centro_leads_schema_version`. Las migraciones se aplican
  **estrictamente en secuencia**: si falta una versión intermedia, aborta con
  error en vez de improvisar.
- **Efecto global:** se activa `PRAGMA foreign_keys = ON` sobre la conexión
  compartida. Hoy es inocuo — la persistencia principal solo define la tabla
  `estado`, sin FK — pero cualquier tabla relacional que se agregue en el futuro
  al resto del sistema heredará esa restricción.
- Sin dependencias nuevas.

### Migraciones

- **V1**: 20 tablas + 13 índices. Incluye tablas ya creadas pero **aún sin uso**:
  `lead_posibles_duplicados`, `lead_fusiones`, `lead_zonas`, `lead_reglas_zona`,
  `lead_reglas_asignacion`, `lead_sla_configuracion`,
  `lead_relaciones_cotizaciones`, `lead_relaciones_ventas`.
- **V2**: columnas de contacto en `leads` (`nombre`, `telefono_normalizado`,
  `email_normalizado`, `interes`, `ubicacion`, `origen`) y `proxima_fecha` en
  seguimientos.
- **V3**: atribución auditable, enlaces rastreados e índices de unicidad.

### Invariantes garantizados por índice único (V3)

| Invariante | Índice |
|---|---|
| Un solo origen activo por lead | `ux_lead_atribucion_origen_activa` |
| Una sola asignación activa por lead | `ux_lead_asignacion_activa` |
| Una interacción por evento externo | `ux_lead_interaccion_evento_externo` |
| Idempotencia de atribución | `ux_lead_atribuciones_clave_idempotencia` |

Son la última línea de defensa contra duplicados por webhook repetido: viven en
la base, no en el código. **No se eliminan ni se relajan.**

## 2. Máquina de estados (`centroLeads/validaciones.js:22-34`)

```
NUEVO       -> ASIGNADO, NO_CALIFICADO, DUPLICADO
ASIGNADO    -> CONTACTADO, NO_RESPONDE, NO_CALIFICADO, PERDIDO, DUPLICADO
CONTACTADO  -> CALIFICADO, NO_RESPONDE, NO_CALIFICADO, PERDIDO, DUPLICADO
CALIFICADO  -> COTIZACION, PERDIDO, DUPLICADO
COTIZACION  -> NEGOCIACION, GANADO, PERDIDO, DUPLICADO
NEGOCIACION -> GANADO, PERDIDO, DUPLICADO
```

**Estados terminales, sin ninguna transición de salida:** `GANADO`, `PERDIDO`,
`NO_RESPONDE`, `NO_CALIFICADO`, `DUPLICADO`.

**No existe reapertura.** Si algún día se necesita, debe ser una operación
explícita y aparte: con permiso propio, motivo obligatorio, actor identificado e
historial. **Nunca** una edición normal ni una transición nueva en esta tabla.

Al entrar a un estado terminal se sella `cerrado_en`.

## 3. Campos del lead (`centroLeads/leads.js`)

**Editables:** `nombre`, `telefono`, `email`, `cliente_id`, `producto_id`,
`interes`, `ubicacion`, `prioridad`.

**Protegidos — el dominio lanza `CAMPO_PROTEGIDO` si se intentan editar:**
`id`, `estado`, `creado_en`, `actualizado_en`, `ultima_interaccion_en`,
`cerrado_en`, `origen`, `vendedor_origen_id`, `sucursal_origen_id`,
`vendedor_asignado_id`, `sucursal_asignada_id`, `historial`,
`atribucion_origen_id`.

Consecuencia deliberada: **el mérito (origen) y la asignación no se editan como
datos.** Solo cambian por sus operaciones propias, que dejan historial.

Normalización: teléfono a dígitos con prefijo `+` opcional, 7-15 dígitos; email
en minúsculas con formato validado. Un dato inválido **falla**, no se guarda sucio.

## 4. Atribución (`centroLeads/atribuciones.js`)

### Política congelada

```
ATRIBUCION  !=  ASIGNACION
vendedor_origen_id  !=  vendedor_asignado_id
sucursal_origen_id  !=  sucursal_asignada_id
```

Quién **generó** el lead y quién lo **atiende** son datos distintos y se
almacenan por separado. Reasignar no mueve el mérito.

### Jerarquía de métodos (`atribuciones.js:18-22`)

```
DESCONOCIDA 1 < DECLARADA 2 < CAMPAÑA 3 < ENLACE_RASTREADO 4 < DIRECTA 5
```

`METODOS_TECNICOS` = `DIRECTA`, `ENLACE_RASTREADO`, `CAMPAÑA`.

### Reglas

- **Solo los métodos técnicos materializan** `vendedor_origen_id` /
  `sucursal_origen_id` en el lead. `DECLARADA` y `DESCONOCIDA` pueden ser el
  origen activo, pero **no producen snapshot técnico**: lo que alguien afirma no
  se vuelve un hecho del sistema.
- Evidencia técnica posterior **puede superar** una `DECLARADA` o una
  `DESCONOCIDA` (líneas 120-122).
- **Una `DIRECTA` comprobada nunca se reemplaza automáticamente** (línea 120).
  Solo cede ante una corrección humana explícita.
- La atribución superada pasa a `estado = SUPERADA` conservando
  `superada_por_atribucion_id`, `superada_por_usuario_id`, `superada_en` y
  `motivo_superacion`. **Nunca se borra ni se sobrescribe.**
- Otros recorridos se conservan con `rol = ASISTIDA`.
- Cada método exige su evidencia mínima: `DIRECTA` requiere evento externo y
  contenido; `ENLACE_RASTREADO` requiere contenido y `enlace_id`; `CAMPAÑA`
  requiere fuente o contenido; `DECLARADA` requiere un actor usuario.

### Corrección explícita (`corregirAtribucionLead`)

Exige las cinco cosas, validadas en `validarAutorizacionCorreccion`:

1. permiso `corregir_atribucion_lead` en `contexto.permisos`;
2. motivo obligatorio no vacío;
3. `usuario_id` del actor;
4. alcance sobre la sucursal del lead;
5. **alcance global (`verTodas`) si la corrección cambia de sucursal de origen.**

Solo se corrige un origen técnico ya comprobado, y la corrección debe aportar
evidencia técnica. Deja evento `ATRIBUCION_CORREGIDA` en el historial.

## 5. Asignación (`centroLeads/asignaciones.js`)

- Una sola asignación activa por lead (garantizado por índice único).
- Asignar un lead `NUEVO` lo mueve a `ASIGNADO`.
- **Reasignar exige motivo** (línea 144).
- Reasignar **no toca la atribución ni el mérito histórico**: el módulo no lee ni
  escribe `lead_atribuciones`.
- Reconoce el snapshot legado de la Fase 2.
- Rollback completo si falla el historial.
- **No existe motor automático de asignación.** `evaluarCreadorPrioritario`
  solo *evalúa* un candidato y devuelve motivo (`CREADOR_PRIORITARIO`,
  `SIN_CAPACIDAD`, `VENDEDOR_NO_DISPONIBLE`, `FUERA_DE_ALCANCE`, ...). No asigna.

## 6. Enlaces rastreados (`centroLeads/enlacesRastreados.js`)

- Se persiste **únicamente el SHA-256** del token; el texto plano se devuelve una
  sola vez al crearlo y no vuelve a existir en la base.
- Token mínimo de 32 bytes o se rechaza por `TOKEN_DEBIL`.
- `resolverEnlaceRastreado` valida activo, no expirado y contenido no archivado.
- El QR reutiliza el mismo mecanismo; no hay un segundo camino.
- Destinos permitidos: `WHATSAPP`, `MESSENGER`, `LANDING`.

## 7. Fuentes y contenidos

- Idempotencia por identificador externo (`UNIQUE (proveedor,
  identificador_externo)`).
- `validarMetadataNoSensible` **rechaza** metadata con claves que parezcan
  secretos (`token`, `secret`, `password`, `api_key`, `oauth`, `authorization`,
  `cookie`, `credencial`) y limita el tamaño a 4096 bytes. Ningún token de Meta
  o WhatsApp puede terminar guardado ahí por descuido.

## 8. Historial (`centroLeads/historial.js`)

Append-only. Sin update ni delete. Orden estable por `ocurrido_en, id`.
Si `usuario_id` es nulo, el actor se registra como `sistema`.

**Consecuencia para la API:** toda acción disparada por una persona debe pasar
`contexto.usuario_id`. Si no se pasa, la auditoría dirá "sistema" y el rastro se
pierde sin que nada falle.

## 9. Fechas

Centro de Leads guarda **marcas de tiempo completas en UTC ISO**
(`normalizarFechaUtc`). Es consistente con la decisión del proyecto: los
timestamps van en UTC y solo las **fechas solas** usan la fecha local de la
tienda vía `backend/fechas.js`.

**Riesgo para fases futuras:** cualquier reporte que agrupe leads "por día" debe
usar `fechas.js`, no cortar el ISO en UTC. Si no, reaparece el bug de fecha
corrida que ya se corrigió en el resto del sistema (merge `9b03f25`).

## 10. Lo que el dominio DELEGA a la capa HTTP

**Esta es la sección de mayor riesgo de la Fase 4.**

Salvo `corregirAtribucionLead`, **ninguna función del dominio valida permisos ni
alcance de sucursal.** `obtenerLead`, `actualizarLead`, `cambiarEstadoLead`,
`asignarLead` y `reasignarLead` confían por completo en quien las llama.

Por lo tanto la capa HTTP **debe**, sin excepción:

1. **Filtrar por alcance en toda lectura y escritura.** Hoy nada impide leer el
   lead de otra sucursal si la ruta no lo verifica.
2. **Nunca aceptar `vendedor_origen_id` ni `sucursal_origen_id` del cuerpo de la
   petición sin comprobarlos.** `crearLead` los acepta tal cual: si la API los
   copia del request, un vendedor puede atribuirse el mérito de otro. Es
   irreversible por diseño — esos campos ya no se pueden editar después.
3. **Derivar el alcance del token, jamás de `?sucursal_id=`.** Ya existe el
   precedente documentado del proyecto: `alcanceSucursal` falló abriendo el
   alcance y se corrigió en el merge `de38cba`. Reutilizar ese helper, no
   escribir uno nuevo.
4. **Pasar siempre `contexto.usuario_id`** para que el historial no diga
   "sistema".
5. **Dar de alta los permisos nuevos en `backend/permisosCatalogo.js`.**
   `corregir_atribucion_lead` se exige en el dominio pero **no existe en el
   catálogo**. Recordatorio del proyecto: `reconciliarRoles` solo actualiza al
   Administrador — cualquier rol ya existente necesita que Victor le habilite el
   permiso a mano, como pasó con `realizar_traspasos` y `usar_gerente_ventas`.
6. **Devolver 404, no 403, ante un lead fuera de alcance**, para no confirmar que
   existe. Es el criterio ya adoptado en el módulo Gerente de Ventas.

## 11. Lo que NO existe todavía

Backend puro. `backend/server.js` **no menciona `centroLeads`**: la superficie
HTTP es cero.

No existe: endpoints, frontend, permisos en catálogo, conexión con CRM/clientes,
conexión con ventas, APIs de Meta, Messenger, WhatsApp, Instagram, TikTok,
webhooks, tracking real de clics, redirección HTTP, deduplicación, fusión de
leads, asignación automática, zonas, SLA, despliegue ni push.

Varias tablas están creadas y vacías esperando esas fases (sección 1).

## 12. Baseline de pruebas

Archivos de prueba de la rama: `centroLeadsPersistencia.test.js`,
`centroLeadsNucleo.test.js`, `centroLeadsAtribucion.test.js`,
`centroLeadsAsignacion.test.js`.

Conteos documentados por Codex al cerrar la Fase 3:

| Suite | PASS |
|---|---|
| Fase 1 persistencia | 11 |
| Fase 2 núcleo | 23 |
| Fase 3 atribución | 23 |
| Fase 3 asignación | 10 |
| Matriz Fase 1-3 | 67 |

Suite completa del backend en este worktree, reejecutada por Claude el
2026-08-22 **con dependencias instaladas** (`npm install` en `backend/`):
**969 pruebas, 964 PASS, 5 FAIL**.

Los 5 fallos son de entorno, están identificados y **no se ocultan modificando
pruebas**:

| Prueba | Causa | Evidencia |
|---|---|---|
| `clavesSat.test.js` (4 pruebas) | `SQLITE_CANTOPEN`: falta `backend/datos.sqlite` con el catálogo SAT, excluido por `.gitignore` (`*.sqlite`) | El servidor lo autoimporta al arrancar (commit `835b89e`); en el worktree nunca se sembró |
| `arranquePersistencia.test.js:174` | La prueba levanta un backend real en carpeta temporal; en un worktree enlazado no resuelve el módulo nativo | **El mismo archivo pasa 12/12 en el checkout principal** — no es defecto del código |

El total del backend se mide contra la suite del día, no contra un número fijo.
